// src/renderer/src/audio/libraryScanSource.ts
//
// The library tier's AnalysisSource (DiscoverLibraryScan.tsx): main's work
// list, handed to the background analysis queue a needs page at a time,
// and re-ranked in place when the username changes mid-session (own stems
// first, stemPriority.ts). Split out of the component so the page/re-rank
// interleavings can be tested without React.
//
// A re-rank asks main for the ranks of everything left: the buffered page,
// any page whose needs are still loading, and the targets not yet paged.
// Its answer is kept (`applied`) and every page that lands later is ordered
// by it, so a page in flight across the re-rank is ranked like the rest
// (review of 06eecbdc). Only the newest re-rank's answer is applied: one
// that a newer re-rank overtook is dropped, whenever it arrives.
import { needsAnyAnalysis, type StemAnalysisNeeds } from '@shared/stemAnalysisNeeds'
import { orderByStemPriority, type StemPrioritySets } from '@shared/stemPriorityOrder'
import type { AnalysisSource, AnalysisWorkItem } from './backgroundAnalysisQueue'

export interface LibraryScanTargetRef {
  key: string
  path: string
}

export interface LibraryScanSourceDeps {
  /** What is left to look at, in main's order. */
  targets: readonly LibraryScanTargetRef[]
  /** Targets per needs call. */
  pageSize: number
  fetchNeeds: (paths: string[]) => Promise<StemAnalysisNeeds[]>
  isCancelled: () => boolean
  /** Targets a page reported as needing nothing: completed straight away. */
  onAlreadyDone: (keys: string[]) => void
  /** A taken batch settled (the queue's done()). */
  onDone: (keys: string[]) => void
  /** A needs page failed: this session's pass stops. */
  onNeedsFailed: (err: unknown) => void
}

/** What a re-rank did: applied, overtaken by a newer one (its answer
 * dropped), or the source was cancelled meanwhile. */
export type RerankOutcome = 'applied' | 'superseded' | 'cancelled'

export interface LibraryScanSource extends AnalysisSource {
  /** Ranks what is left through `ranksFor` (one StemPriorityRank per key)
   * and reorders it, each rank group keeping the order it had. Rejects when
   * `ranksFor` does. */
  rerank(ranksFor: (keys: string[]) => Promise<number[]>): Promise<RerankOutcome>
}

export function createLibraryScanSource(deps: LibraryScanSourceDeps): LibraryScanSource {
  let toScan = deps.targets.slice()
  let nextPageStart = 0
  let buffer: AnalysisWorkItem[] = []
  /** Keys of pages whose needs are loading: off toScan, not yet buffered. */
  const loading = new Set<string>()
  /** The newest applied re-rank's answer: pages landing later sort by it. */
  let applied: StemPrioritySets | null = null
  /** Bumped by every re-rank; an answer for an older one is dropped. */
  let rerankSeq = 0

  return {
    async next(n) {
      while (buffer.length === 0) {
        if (deps.isCancelled() || nextPageStart >= toScan.length) return 'done'
        const page = toScan.slice(nextPageStart, nextPageStart + deps.pageSize)
        // Advanced before the await, so a re-rank meanwhile (which reorders
        // only toScan from nextPageStart on) can't move this page's targets
        // under it.
        nextPageStart += page.length
        for (const target of page) loading.add(target.key)
        let needs: StemAnalysisNeeds[]
        try {
          needs = await deps.fetchNeeds(page.map((t) => t.path))
        } catch (err) {
          deps.onNeedsFailed(err)
          return 'done'
        } finally {
          for (const target of page) loading.delete(target.key)
        }
        if (deps.isCancelled()) return 'done'
        const alreadyDone: string[] = []
        page.forEach((target, i) => {
          const targetNeeds = needs[i]
          if (targetNeeds && needsAnyAnalysis(targetNeeds)) {
            buffer.push({ key: target.key, path: target.path, needs: targetNeeds })
          } else {
            alreadyDone.push(target.key)
          }
        })
        if (alreadyDone.length > 0) deps.onAlreadyDone(alreadyDone)
        // Ranked with the rest when a re-rank ran while it was loading.
        if (applied) buffer = orderByStemPriority(buffer, (item) => item.key, applied)
      }
      const taken = buffer.slice(0, n)
      buffer = buffer.slice(n)
      return taken
    },

    done(keys) {
      deps.onDone(keys)
    },

    async rerank(ranksFor) {
      const seq = ++rerankSeq
      const keys = [
        ...buffer.map((item) => item.key),
        ...loading,
        ...toScan.slice(nextPageStart).map((t) => t.key)
      ]
      const ranks = await ranksFor(keys)
      if (deps.isCancelled()) return 'cancelled'
      if (seq !== rerankSeq) return 'superseded'
      const own = new Set<string>()
      const favourites = new Set<string>()
      keys.forEach((key, i) => {
        if (ranks[i] === 0) own.add(key)
        else if (ranks[i] === 1) favourites.add(key)
      })
      // Applied to whatever is left NOW (pages may have been taken during
      // the call); keys not ranked count as the rest.
      const priority: StemPrioritySets = { own, favourites }
      applied = priority
      buffer = orderByStemPriority(buffer, (item) => item.key, priority)
      toScan = [
        ...toScan.slice(0, nextPageStart),
        ...orderByStemPriority(toScan.slice(nextPageStart), (t) => t.key, priority)
      ]
      return 'applied'
    }
  }
}
