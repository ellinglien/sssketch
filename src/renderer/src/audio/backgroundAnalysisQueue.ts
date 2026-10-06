// src/renderer/src/audio/backgroundAnalysisQueue.ts
//
// ONE queue for the renderer's ambient analysis (background scan audit 7;
// merge-background-scans plan b21ea5a2, Task 7, decision 11). Before, the
// placed-stem scan (BackgroundFeatureScan) and the library scan
// (DiscoverLibraryScan) each ran their own loop, 3 wide with a 500 ms gap:
// up to 6 reads and decodes (and 6 inference jobs) at once, mostly random
// reads on the USB archive, and the placed stems -- the ones a screen is
// about to want -- competed with a library walk of hours instead of going
// first.
//
// Now there is one loop, one gate (backgroundScanGate: deferred, never
// skipped), one cap of BATCH_SIZE analyses in flight, and BATCH_DELAY_MS
// after each batch's real work. Tiers, highest first:
// - placed: the paths on the timeline (setPlaced, from BackgroundFeatureScan);
// - artist: Discover artist mode's "analyse overnight" queue (a source);
// - library: the whole-library walk (a source).
// The producers pull: a source is asked for the next few items only when its
// tier is the highest with work. A source answering 'idle' rests
// IDLE_REST_MS (a wake ends it early: the artist enqueue event); 'done'
// removes it. DiscoverLibraryScan installs both sources and removes them on
// unmount, so turning consent off leaves only the placed tier.
//
// Needs: an item that comes with its needs (the library's needs pages) asks
// none; items without them (placed paths, artist downloads) get one
// get-stem-analysis-needs call per batch, covering up to NEEDS_PAGE_SIZE
// placed paths at a time, so each placed path is asked once. A path needing
// nothing is never decoded. A path analysed once this session, in any tier,
// is not analysed again (its source still hears it as done).
//
// Pure and injectable (createBackgroundAnalysisQueue); the app-wide instance
// below wires the real analysis, needs IPC, gate and timers.
import { needsAnyAnalysis, type StemAnalysisNeeds } from '@shared/stemAnalysisNeeds'
import { analyzeStemOnce, fetchStemAnalysisNeeds } from './analyzeStemOnce'
import { backgroundScanGate } from './backgroundScanGate'
import { countWork } from '../perf/workCounters'

/** Analyses in flight at once, across every tier. */
export const BATCH_SIZE = 3
/** The gap after each batch's real work (and the gate's re-check interval). */
export const BATCH_DELAY_MS = 500
/** How long an idle source rests before it is asked again. */
export const IDLE_REST_MS = 30_000
/** Placed paths per needs call. Matches main's own SQL chunk. */
export const NEEDS_PAGE_SIZE = 500

export type AnalysisSourceKind = 'artist' | 'library'
export type AnalysisTier = 'placed' | AnalysisSourceKind

export interface AnalysisWorkItem {
  /** The source's own key (StemCID), handed back through done(). */
  key: string
  path: string
  needs?: StemAnalysisNeeds
}

/** A producer the queue pulls from. `next(n)`: up to n items, 'idle' (nothing
 * now -- rest), or 'done' (finished -- removed). `done(keys)`: every key of a
 * taken batch, once its analyses settled (or it needed nothing). */
export interface AnalysisSource {
  next(n: number): Promise<AnalysisWorkItem[] | 'idle' | 'done'>
  done(keys: string[]): void | Promise<void>
}

export interface BackgroundAnalysisQueueDeps {
  /** Never rejects (analyzeStemOnce logs its own failures). */
  analyze: (path: string, needs: StemAnalysisNeeds) => Promise<unknown>
  fetchNeeds: (paths: string[]) => Promise<StemAnalysisNeeds[]>
  gate: { mayRun: (at: number) => boolean }
  setTimeout: (fn: () => void, ms: number) => unknown
  clearTimeout: (handle: unknown) => void
  now: () => number
}

export interface BackgroundAnalysisQueue {
  /** Replaces the placed tier (de-duplicated, minus paths analysed already). */
  setPlaced(paths: readonly string[]): void
  /** Installs or (null) removes a source. A batch in flight finishes. */
  setSource(kind: AnalysisSourceKind, source: AnalysisSource | null): void
  /** Ends a source's rest and runs the loop now, if it is waiting. */
  wake(kind?: AnalysisSourceKind): void
  /** The placed tier's work left (known to need analysis, plus in flight).
   * The source tiers' progress stays with their producer, which knows its
   * totals. Returns an unsubscribe. */
  onProgress(listener: (kind: 'placed', left: number) => void): () => void
}

interface PlacedItem {
  path: string
  needs?: StemAnalysisNeeds
}

interface Batch {
  tier: AnalysisTier
  source: AnalysisSource | null
  /** Taken items that need an analysis. */
  items: { path: string; needs: StemAnalysisNeeds }[]
  /** Every key of the source's batch, for done(). */
  keys: string[]
}

export function createBackgroundAnalysisQueue(
  deps: BackgroundAnalysisQueueDeps
): BackgroundAnalysisQueue {
  let placed: PlacedItem[] = []
  /** Paths analysed (or found to need nothing) this session, any tier. */
  const analysed = new Set<string>()
  const sources: Record<AnalysisSourceKind, AnalysisSource | null> = { artist: null, library: null }
  const restUntil: Record<AnalysisSourceKind, number> = { artist: 0, library: 0 }
  const listeners = new Set<(kind: 'placed', left: number) => void>()
  let placedInFlight = 0
  let lastPlacedReport: number | null = null

  // The loop: 'running' while a step is under way; else a timer is pending
  // ('delay': the batch gap or the gate; 'sleep': nothing to do until a rest
  // ends), or nothing is pending at all ('idle').
  let running = false
  /** A kick that landed while a step was under way: that step must not sleep. */
  let kickedWhileRunning = false
  let timer: unknown = null
  let timerKind: 'delay' | 'sleep' | null = null

  function reportPlaced(): void {
    // Only paths known to need work (the tier keeps no others) and those in
    // flight: a path whose needs aren't fetched yet isn't counted -- most
    // placed stems are analysed already, and the indicator mustn't count
    // them first.
    let left = placedInFlight
    for (const item of placed) if (item.needs) left += 1
    if (left === lastPlacedReport) return
    lastPlacedReport = left
    for (const listener of listeners) listener('placed', left)
  }

  function schedule(ms: number, kind: 'delay' | 'sleep'): void {
    if (timer !== null) deps.clearTimeout(timer)
    timerKind = kind
    timer = deps.setTimeout(() => {
      timer = null
      timerKind = null
      void step()
    }, ms)
  }

  /** Runs the loop now when it is idle or only sleeping. */
  function kick(): void {
    if (running) {
      kickedWhileRunning = true
      return
    }
    if (timerKind === 'delay') return
    schedule(0, 'delay')
  }

  /** The placed tier's next batch, fetching needs for the head first. Null
   * when the tier is empty; an empty batch when a needs fetch failed. */
  async function takePlaced(): Promise<Batch | null> {
    if (placed.length === 0) return null
    const unknown = placed.filter((item) => !item.needs).slice(0, NEEDS_PAGE_SIZE)
    if (unknown.length > 0 && placed[0].needs === undefined) {
      const paths = unknown.map((item) => item.path)
      let needs: StemAnalysisNeeds[]
      try {
        needs = await deps.fetchNeeds(paths)
      } catch (err) {
        // Not attempted: the next setPlaced with these paths retries them.
        console.error('backgroundAnalysisQueue: failed to load analysis needs:', err)
        const failed = new Set(paths)
        placed = placed.filter((item) => !failed.has(item.path))
        reportPlaced()
        return { tier: 'placed', source: null, items: [], keys: [] }
      }
      const byPath = new Map(paths.map((path, i) => [path, needs[i]]))
      placed = placed.filter((item) => {
        if (item.needs || !byPath.has(item.path)) return true
        const itemNeeds = byPath.get(item.path)
        if (itemNeeds && needsAnyAnalysis(itemNeeds)) {
          item.needs = itemNeeds
          return true
        }
        analysed.add(item.path) // nothing missing: done, no decode
        return false
      })
    }
    const items: Batch['items'] = []
    while (items.length < BATCH_SIZE && placed.length > 0 && placed[0].needs) {
      const item = placed.shift()!
      items.push({ path: item.path, needs: item.needs! })
    }
    return { tier: 'placed', source: null, items, keys: [] }
  }

  /** A source tier's next batch. Null when it has nothing now. */
  async function takeFrom(kind: AnalysisSourceKind): Promise<Batch | null> {
    const source = sources[kind]
    if (!source || deps.now() < restUntil[kind]) return null
    let answer: Awaited<ReturnType<AnalysisSource['next']>>
    try {
      answer = await source.next(BATCH_SIZE)
    } catch (err) {
      console.error(`backgroundAnalysisQueue: the ${kind} source failed:`, err)
      answer = 'idle'
    }
    if (sources[kind] !== source) return null // removed meanwhile: nothing more from it
    if (answer === 'done') {
      sources[kind] = null
      return null
    }
    if (answer === 'idle' || answer.length === 0) {
      restUntil[kind] = deps.now() + IDLE_REST_MS
      return null
    }
    const fresh = answer.filter((item) => !analysed.has(item.path))
    const unknown = fresh.filter((item) => !item.needs)
    let fetched = new Map<string, StemAnalysisNeeds>()
    if (unknown.length > 0) {
      try {
        const needs = await deps.fetchNeeds(unknown.map((item) => item.path))
        fetched = new Map(unknown.map((item, i) => [item.path, needs[i]]))
      } catch (err) {
        // Not finished: the source keeps these, and its tier rests.
        console.error(`backgroundAnalysisQueue: failed to load ${kind} needs:`, err)
        restUntil[kind] = deps.now() + IDLE_REST_MS
        return { tier: kind, source: null, items: [], keys: [] }
      }
    }
    const items: Batch['items'] = []
    for (const item of fresh) {
      const needs = item.needs ?? fetched.get(item.path)
      if (needs && needsAnyAnalysis(needs)) items.push({ path: item.path, needs })
      else analysed.add(item.path)
    }
    return { tier: kind, source, items, keys: answer.map((item) => item.key) }
  }

  async function take(): Promise<Batch | null> {
    return (await takePlaced()) ?? (await takeFrom('artist')) ?? (await takeFrom('library'))
  }

  async function step(): Promise<void> {
    running = true
    kickedWhileRunning = false
    /** The placed batch counted in placedInFlight and not yet settled. */
    let placedTaken: Batch['items'] = []
    try {
      // Yield to the user (backgroundScanGate.ts): deferred, never skipped --
      // fetching needs included.
      if (!deps.gate.mayRun(deps.now())) {
        schedule(BATCH_DELAY_MS, 'delay')
        return
      }
      const batch = await take()
      if (!batch) {
        if (kickedWhileRunning) {
          schedule(0, 'delay') // work arrived while this step looked
          return
        }
        // Nothing anywhere: sleep until the first rest ends (or a wake).
        const rests = (['artist', 'library'] as const)
          .filter((kind) => sources[kind] !== null)
          .map((kind) => restUntil[kind])
        if (rests.length > 0) schedule(Math.max(0, Math.min(...rests) - deps.now()), 'sleep')
        return
      }
      if (batch.items.length > 0) {
        countWork(`queue:batch.${batch.tier}`)
        countWork(`queue:in-flight.${batch.items.length}`)
        if (batch.tier === 'placed') {
          placedTaken = batch.items
          placedInFlight += batch.items.length
          reportPlaced()
        }
        // The batch's real work is awaited before the next one is scheduled
        // (DiscoverLibraryScan's 2026-09-18 regression): BATCH_SIZE is a real cap.
        await Promise.allSettled(
          batch.items.map(async ({ path, needs }) => {
            analysed.add(path)
            return deps.analyze(path, needs)
          })
        )
        if (batch.tier === 'placed') {
          placedTaken = []
          placedInFlight -= batch.items.length
          reportPlaced()
        }
      }
      if (batch.source && batch.keys.length > 0) {
        try {
          await batch.source.done(batch.keys)
        } catch (err) {
          console.error(`backgroundAnalysisQueue: finishing a ${batch.tier} batch failed:`, err)
        }
      }
      schedule(batch.items.length > 0 ? BATCH_DELAY_MS : 0, 'delay')
    } catch (err) {
      // Review of T7: nothing here may stop the loop for the session (a
      // throwing gate or progress listener). Undo the batch's in-flight
      // count, put back its placed paths that never started, try again later.
      console.error('backgroundAnalysisQueue: a step failed:', err)
      if (placedTaken.length > 0) {
        placedInFlight -= placedTaken.length
        const queued = new Set(placed.map((item) => item.path))
        const unstarted = placedTaken.filter(
          (item) => !analysed.has(item.path) && !queued.has(item.path)
        )
        placed = [...unstarted, ...placed]
        try {
          reportPlaced()
        } catch {
          // a listener throwing again: already logged once, the loop goes on
        }
      }
      schedule(BATCH_DELAY_MS, 'delay')
    } finally {
      running = false
    }
  }

  return {
    setPlaced(paths) {
      const known = new Map(placed.map((item) => [item.path, item]))
      placed = [...new Set(paths)]
        .filter((path) => !analysed.has(path))
        .map((path) => known.get(path) ?? { path })
      reportPlaced()
      kick()
    },
    setSource(kind, source) {
      sources[kind] = source
      restUntil[kind] = 0
      if (source) kick()
    },
    wake(kind) {
      if (kind) restUntil[kind] = 0
      kick()
    },
    onProgress(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  }
}

/** The app-wide queue: the real analysis, needs IPC, gate and timers. */
export const backgroundAnalysisQueue = createBackgroundAnalysisQueue({
  analyze: analyzeStemOnce,
  fetchNeeds: fetchStemAnalysisNeeds,
  gate: backgroundScanGate,
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (handle) => window.clearTimeout(handle as number),
  now: () => performance.now()
})
