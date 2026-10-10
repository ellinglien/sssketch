// The Discover candidate -> local stem resolver, shared by DiscoverPanel and DiscoverSlotRow (moved verbatim from DiscoverPanel.tsx, radio view plan Task 4).
import { instrumentMaskToSoundType } from '@shared/riffLibraryTypes'
import { guessSoundTypeFromPresetName } from '@shared/presetNames'
import { type SoundType } from '@shared/types'
import type { DiscoverCandidate } from '../../../main/discoverCandidates'
import { candidatePhaseBars, type DiscoverSeedPhase } from '@shared/discoverSeedPhase'
import {
  bakeToPhaseJob,
  matchBakeResults,
  phaseLineage,
  rotationSecForBars,
  type ReoneBakeJob
} from '@shared/reonedRotation'
import { createBakeBatcher, type BakeBatchResult } from '@shared/bakeBatcher'
import { candidateNotAlignedText, createNoticeThrottle } from '@shared/reoneNotices'
import { showReoneNotice } from '../state/reoneNotice'

export interface ResolvedCandidateStem {
  author: string
  name: string
  type: SoundType
  path: string
  durationSec: number
  barLength: number
  phaseSourcePath?: string
  phaseBars?: number
  /** The owning riff's own creation time (RiffLibraryResolvedRiff.
   * creationTime, Unix seconds) -- see @shared/types's Stem.creationTime
   * doc comment. Undefined only if the resolved riff itself predates this
   * field (the live Endlesss API path). */
  creationTime?: number
}

// Speed: DiscoverSlotRow's own preview resolve effect and resolveDiscoverRifff
// (called from both addToTimeline and addToShelf) both call resolveCandidateStem
// for the SAME candidate -- a row resolves it once already just to show its
// waveform, then resolveDiscoverRifff re-resolves the identical riffCID/stemCID
// from scratch (a real IPC round trip PLUS, often, the exact download
// riffLibraryDownloadMissingStems just did moments earlier). Cached by promise
// (not just by settled result), same "cache the in-flight promise itself"
// convention peakCache.ts already established -- this also dedupes two
// callers that happen to ask for the same candidate concurrently (row
// preview + a fast add-to-timeline/add-to-shelf click) into one
// real request instead of two. Evicted on a null (failed) result, same
// "don't let a transient failure permanently poison the cache" reasoning
// peakCache.ts's own eviction-on-rejection uses -- resolveCandidateStem
// itself never throws (see its own doc comment), so eviction keys off a
// null return here instead of a caught rejection.
const resolvedCandidateCache = new Map<string, Promise<ResolvedCandidateStem | null>>()
/** The SETTLED half of resolvedCandidateCache, readable without an await.
 *
 * A promise can only be read a microtask later, so a row whose candidate
 * had been resolved a whole interval ago (radio's armRadioPick warms it)
 * still drew its "resolving" placeholder for the first render after the
 * commit, and the new waveform arrived one resolve later -- 20 to 150ms
 * behind a swap the engine had already made on the beat. Same keys, same
 * lifetime: written when the promise settles non-null, dropped with it. */
const settledCandidateStems = new Map<string, ResolvedCandidateStem>()

/** The cache key: the candidate, and the rotation it is resolved at when the seed's phase
 * reaches it (candidatePhaseBars). A rotated candidate is a different file from the raw one. */
function candidateKey(candidate: DiscoverCandidate, phase: DiscoverSeedPhase | null): string {
  const bars = candidatePhaseBars(phase, candidate)
  const key = `${candidate.riffCID}:${candidate.stemCID}`
  return bars === null ? key : `${key}@${bars}`
}

export function peekResolvedCandidateStem(
  candidate: DiscoverCandidate,
  phase: DiscoverSeedPhase | null = null
): ResolvedCandidateStem | null {
  return settledCandidateStems.get(candidateKey(candidate, phase)) ?? null
}

/** Caches `make()`'s promise under `key`, the settled stem alongside, and drops both on null. */
function cachedResolve(
  key: string,
  make: () => Promise<ResolvedCandidateStem | null>
): Promise<ResolvedCandidateStem | null> {
  const cached = resolvedCandidateCache.get(key)
  if (cached) return cached
  const promise = make()
  resolvedCandidateCache.set(key, promise)
  void promise.then((result) => {
    if (result === null) resolvedCandidateCache.delete(key)
    else settledCandidateStems.set(key, result)
  })
  return promise
}

export type CandidateBake = (
  jobs: ReoneBakeJob[]
) => Promise<{ path: string; bakedPath: string; durationSec: number }[]>

/** A resolved candidate baked to `bars` in total from its original, for a candidate from the
 * seed's own jam (src/shared/discoverSeedPhase.ts). Through the re-oned copies path: the copy is
 * named by its recipe, so the same stem at the same phase, in any later roll, audition or
 * project, is one file, and baking it again only finds that file. Rendered, never adopted: like
 * a Cross parent or a Discover seed, nothing in the project changes. null when the bake fails:
 * the row reads as unresolved (rerolling picks another) rather than playing at the wrong phase.
 * A rotation that wraps to nothing (whole loops) needs no copy. */
export async function alignCandidateStem(
  stem: ResolvedCandidateStem,
  bars: number,
  bake: CandidateBake
): Promise<ResolvedCandidateStem | null> {
  if (rotationSecForBars(bars, stem) === 0) return stem
  let results: Awaited<ReturnType<CandidateBake>>
  try {
    results = await bake([bakeToPhaseJob({ slot: 1, ...stem }, bars)])
  } catch (err) {
    console.error('alignCandidateStem: bake failed:', err)
    return null
  }
  const matched = matchBakeResults([stem.path], results)
  if (!matched) return null
  return {
    ...stem,
    path: matched[0].bakedPath,
    durationSec: matched[0].durationSec,
    phaseSourcePath: phaseLineage(stem).sourcePath,
    phaseBars: bars
  }
}

/** Resolves one Discover candidate down to a real, locally-downloaded
 * `Stem` -- reused verbatim by both this component's own slot-preview
 * rendering (Step 1 below) and Task 11's "plunk in arranger" placement,
 * since both need exactly the same download-then-resolve step, just for
 * different reasons (a waveform preview vs. a real placed clip).
 * Downloads the candidate's own riff's missing stems on demand (same
 * `riffLibraryDownloadMissingStems` call `LibraryBrowser.tsx`'s own
 * `ensureStemsDownloaded` already makes) -- a candidate isn't guaranteed
 * to be cached locally just because it's in the library-wide index (Task
 * 1's own query reads DB metadata only, never touches the filesystem).
 * Returns null (never throws) for a riff that fails to resolve/download
 * (network hiccup, since-deleted riff) -- callers treat that the same as
 * "no candidate yet" rather than surfacing an error for what's ultimately
 * a soft, retryable failure (reroll picks something else regardless).
 *
 * `phase` is the open Discover seed's (App's discoverSeedPhase): a candidate
 * from the seed's own jam resolves to a copy baked by the seed's rotation
 * (alignCandidateStem), so it plays in phase with the seed's jam-mates. Every
 * caller that resolves for Discover passes it, so a row, radio's warm-up and
 * add all land on one cache entry. */
export function resolveCandidateStem(
  candidate: DiscoverCandidate,
  phase: DiscoverSeedPhase | null = null
): Promise<ResolvedCandidateStem | null> {
  const bars = candidatePhaseBars(phase, candidate)
  if (bars === null) return resolveRawCandidateStem(candidate)
  return cachedResolve(candidateKey(candidate, phase), async () => {
    const session = alignSession
    const raw = await resolveRawCandidateStem(candidate)
    if (!raw || session !== alignSession) return null
    const aligned = await alignCandidateStem(raw, bars, bakeBatched)
    // Discover closed meanwhile: nobody is looking at this row, so no notice.
    if (!aligned && session === alignSession) {
      const line = candidateNotAlignedText(phase?.jamNames[candidate.jamCID] ?? null)
      if (mayShowNotAligned(line)) showReoneNotice(line)
    }
    return aligned
  })
}

/** Every alignment's bake, gathered (src/shared/bakeBatcher.ts): the rows of one roll resolve
 * together, and each bakeOffset call with a LORE stem spawns its own engine. */
const bakeOneBatched = createBakeBatcher<BakeBatchResult>((jobs) =>
  window.rifffApi.bakeOffset(jobs)
)
const bakeBatched: CandidateBake = async (jobs) => {
  const results = await Promise.all(jobs.map(bakeOneBatched))
  return results.every((result) => result !== null) ? (results as BakeBatchResult[]) : []
}

/** Bumped when Discover closes (cancelDiscoverAlignments): an alignment begun before it bakes
 * nothing it hasn't started, and says nothing if it fails. */
let alignSession = 0

/** Discover is closing: drop the alignments not yet baking, so they let go of the `.bakes` lock
 * sooner and nothing waits on them, and keep any that fail from saying so. A bake already
 * running may finish. Each dropped resolve is null, so it leaves the cache. */
export function cancelDiscoverAlignments(): void {
  alignSession++
  bakeOneBatched.cancel()
}

/** A failed alignment leaves its row unresolved, never out of phase, and says so: once a
 * minute per jam, since a jam whose originals are away fails on every roll. */
const mayShowNotAligned = createNoticeThrottle(60_000)

function resolveRawCandidateStem(
  candidate: DiscoverCandidate
): Promise<ResolvedCandidateStem | null> {
  return cachedResolve(candidateKey(candidate, null), async () => {
    try {
      const resolved = await window.rifffApi.riffLibraryResolveRiff(candidate.riffCID)
      if (!resolved) return null
      const withStems = resolved.stems.some((s) => s.path === null)
        ? ((await window.rifffApi.riffLibraryDownloadMissingStems(candidate.riffCID)) ?? resolved)
        : resolved
      const stem = withStems.stems.find((s) => s.stemCID === candidate.stemCID)
      if (!stem || stem.path === null) return null
      return {
        author: stem.creatorUserName,
        name: stem.presetName,
        type:
          instrumentMaskToSoundType(stem.instrumentMask) ??
          guessSoundTypeFromPresetName(stem.presetName) ??
          'fx',
        path: stem.path,
        durationSec: stem.durationSec,
        barLength: stem.barLength,
        creationTime: resolved.creationTime
      }
    } catch (err) {
      console.error('resolveCandidateStem: failed to resolve candidate', candidate.riffCID, err)
      return null
    }
  })
}
