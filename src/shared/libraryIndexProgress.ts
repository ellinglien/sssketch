// src/shared/libraryIndexProgress.ts
//
// The words and the time-left estimate for the startup library index
// (discoverCandidates.ts's prewarmDiscoverCandidateCaches), shown by
// StartupGate.tsx while the saved copies load and by BackgroundWorkIndicator
// while the walks run. Direct request, 2026-10-07: "loading library…" alone
// gave people no clue how long it would take.
//
// The one rule that matters: the count and its total count the same thing.
// 04a6a7e7 dropped the old count because it read "761,929 / 900,041" --
// riff-index entries (one per stem that is in a riff) against the Riffs
// count -- and then the total dropped. So:
// - a riff WALK counts Riffs rows, against the live Riffs count: "riffs";
// - a riff-index LOAD counts its saved entries, against the entry count the
//   copy was saved with: "stems";
// - the instrument rows count Stems rows, walked or loaded: "stems".
// Pure, so the wording and the estimate are tested here.

import { formatCount } from './backgroundWork'

export type LibraryIndexPhase = 'riffIndex' | 'instrumentRows' | 'ownStems'

/** Where one load sits among every saved copy read back before the gate
 * opens: step `part` of `parts`, and how much of all of them is loaded, in
 * weighted entries (createLoadStageTracker). Lets the time left cover the
 * whole wait, not one copy; never shown as a count. */
export interface LibraryLoadStage {
  part: number
  parts: number
  completed: number
  total: number
}

/** One progress update from the startup library index. `phase` names the
 * table; `dbIndex`/`dbCount` the source db (the archive, the own db);
 * `completed`/`total` count this phase's own unit (libraryProgressUnit).
 * `total` 0: a running count with no known end. */
export interface LibraryIndexProgress {
  /** 'ownStems': the own-only index a rebuild serves first (faster startup,
   * ownStemIndex.ts) -- a running count only. */
  phase: LibraryIndexPhase
  dbIndex: number
  dbCount: number
  completed: number
  total: number
  /** Some db is serving only its user's own stems until this walk ends. */
  ownOnly?: boolean
  /** Reading a saved copy back, not walking the table: "loading library",
   * "indexing" only for a walk. */
  loading?: boolean
  /** Loads only: this load's place in the whole loading stage. */
  stage?: LibraryLoadStage
}

export function libraryProgressUnit(progress: LibraryIndexProgress): 'riffs' | 'stems' {
  return progress.phase === 'riffIndex' && !progress.loading ? 'riffs' : 'stems'
}

/** '412,000 of 891,062 stems', a running '12,000 stems' with no total, or
 * null before the first item. */
export function describeLibraryProgressCount(progress: LibraryIndexProgress): string | null {
  const unit = libraryProgressUnit(progress)
  if (progress.total > 0) {
    // A saved total can be a little behind the copy (one written by an
    // older version); never show "900 of 800".
    const total = Math.max(progress.total, progress.completed)
    return `${formatCount(progress.completed)} of ${formatCount(total)} ${unit}`
  }
  if (progress.completed > 0) return `${formatCount(progress.completed)} ${unit}`
  return null
}

/** StartupGate's status line. */
export function describeStartupStatus(
  engineDone: boolean,
  progress: LibraryIndexProgress | null
): string {
  if (!engineDone) return 'starting engine…'
  if (!progress) return 'loading library…'
  const count = describeLibraryProgressCount(progress)
  if (progress.phase === 'ownStems') {
    return count ? `indexing your stems first · ${count}` : 'indexing your stems first…'
  }
  if (progress.loading) {
    const parts = ['loading library']
    if (count) parts.push(count)
    const stage = progress.stage
    if (stage && stage.parts > 1) parts.push(`step ${stage.part} of ${stage.parts}`)
    return parts.length === 1 ? 'loading library…' : parts.join(' · ')
  }
  const parts = ['indexing library']
  if (count) parts.push(count)
  if (progress.dbCount > 1) parts.push(`db ${progress.dbIndex + 1} of ${progress.dbCount}`)
  return parts.length === 1 ? 'indexing library…' : parts.join(' · ')
}

/** No estimate until this long after the first sample: the first pages of
 * a load or walk are the coldest, and a rate from them alone jumps around. */
const MIN_RATE_ELAPSED_MS = 1000

/** Time left at the rate measured since `start` (the first sample of this
 * phase, which need not be at 0: an extension starts near the end), or null
 * while there is no rate yet or nothing is left. */
export function estimateRemainingMs(
  start: { at: number; completed: number },
  now: { at: number; completed: number },
  total: number
): number | null {
  const elapsed = now.at - start.at
  const progressed = now.completed - start.completed
  if (total <= 0 || elapsed < MIN_RATE_ELAPSED_MS || progressed <= 0) return null
  const left = total - now.completed
  if (left <= 0) return null
  return Math.round(left / (progressed / elapsed))
}

/** 'a few seconds left', 'about 45 s left', 'about 3 min left',
 * 'about 1 h 20 min left'. Rough on purpose: it's a clue, not a promise. */
export function formatTimeLeft(ms: number): string {
  const seconds = ms / 1000
  if (seconds < 10) return 'a few seconds left'
  const roundedSeconds = Math.round(seconds / 5) * 5
  if (roundedSeconds < 60) return `about ${roundedSeconds} s left`
  const minutes = Math.max(1, Math.round(seconds / 60))
  if (minutes < 60) return `about ${minutes} min left`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `about ${hours} h left` : `about ${hours} h ${rest} min left`
}

export interface EtaSample {
  /** What is being timed: a new key starts a new rate. */
  key: string
  completed: number
  total: number
}

/** What to time for one update: a load is timed across the whole loading
 * stage (every saved copy before the gate opens), a walk across its own
 * phase and db. Null for a running count, which has no end to time. */
export function etaSampleOf(progress: LibraryIndexProgress | null): EtaSample | null {
  if (!progress) return null
  if (progress.loading && progress.stage && progress.stage.total > 0) {
    return { key: 'load', completed: progress.stage.completed, total: progress.stage.total }
  }
  if (progress.total <= 0 || progress.phase === 'ownStems') return null
  return {
    key: `${progress.phase}:${progress.dbIndex}${progress.loading ? ':load' : ''}`,
    completed: progress.completed,
    total: progress.total
  }
}

/** A key quiet this long starts a new rate when it reports again: the idle
 * time is not part of how fast it goes (a walk of the same table later on). */
const ETA_KEY_IDLE_MS = 10_000

/** Remembers the first sample of each key being timed; each update gives
 * the time left at that key's rate since then.
 *
 * Per key, not one (review of dc07ec69): an extension walk reporting while
 * a load runs used to restart the rate on every alternation, so neither got
 * a time left. A key restarts when its count goes backwards (a new walk of
 * the same table) or after ETA_KEY_IDLE_MS without a sample. A null sample
 * (a running count) gives null and leaves every rate alone. */
export function createEtaTracker(): {
  update: (sample: EtaSample | null, at: number) => number | null
} {
  const firsts = new Map<
    string,
    { at: number; completed: number; lastAt: number; lastCompleted: number }
  >()
  return {
    update(sample, at) {
      if (!sample) return null
      const first = firsts.get(sample.key)
      if (!first || sample.completed < first.lastCompleted || at - first.lastAt > ETA_KEY_IDLE_MS) {
        firsts.set(sample.key, {
          at,
          completed: sample.completed,
          lastAt: at,
          lastCompleted: sample.completed
        })
        return null
      }
      first.lastAt = at
      first.lastCompleted = sample.completed
      return estimateRemainingMs(first, { at, completed: sample.completed }, sample.total)
    }
  }
}

/** How long a load holds the status line against a walk's updates after its
 * own last one: a step that rebuilds instead never reports its load again. */
const LOAD_HOLD_MS = 5_000

function loadFinished(progress: LibraryIndexProgress): boolean {
  const { completed, total } = progress.stage ?? progress
  return total > 0 && completed >= total
}

/** What the status line shows for a stream of updates, and its time left
 * (StartupGate, BackgroundWorkIndicator).
 *
 * A walk can report while saved copies still load (review of dc07ec69: an
 * extension walk during a load), and showing the last update made the line
 * alternate between "loading library" and "indexing library". A load in
 * progress keeps the line -- it's what the gate waits for -- until it reaches
 * its stage total or has been quiet LOAD_HOLD_MS; the walk's rate is still
 * measured meanwhile, so it has a time left the moment it shows. The
 * own-stems count is never held back. */
export function createLibraryProgressView(): {
  update: (
    progress: LibraryIndexProgress | null,
    at: number
  ) => { progress: LibraryIndexProgress | null; timeLeftMs: number | null }
} {
  const eta = createEtaTracker()
  const timeLeftByKey = new Map<string, number | null>()
  let load: { progress: LibraryIndexProgress; at: number } | null = null
  return {
    update(progress, at) {
      if (!progress) {
        load = null
        return { progress: null, timeLeftMs: null }
      }
      const sample = etaSampleOf(progress)
      if (sample) timeLeftByKey.set(sample.key, eta.update(sample, at))
      if (progress.loading) load = { progress, at }
      const shown =
        !progress.loading &&
        progress.phase !== 'ownStems' &&
        load &&
        at - load.at < LOAD_HOLD_MS &&
        !loadFinished(load.progress)
          ? load.progress
          : progress
      const key = etaSampleOf(shown)?.key
      return { progress: shown, timeLeftMs: key ? (timeLeftByKey.get(key) ?? null) : null }
    }
  }
}

/** The loading stage's running total, for the prewarm: each step's planned
 * entries (the saved copy's size; 0 when nothing is saved, which is no
 * step), in the order they load. A step that ends without loading all of
 * them (it rebuilds instead, or its copy was a little smaller) counts as
 * whole once finished, so the stage never stalls short of its total.
 *
 * `weight` (default 1): what one entry of that step costs against a stem
 * row, so the time left isn't thrown by steps that load at different
 * speeds. The stage's completed/total are in these weighted units -- they
 * time the wait and are never shown as a count. */
export function createLoadStageTracker(
  plan: readonly { key: string; planned: number; weight?: number }[]
): {
  report: (key: string, completed: number) => LibraryLoadStage | undefined
  finish: (key: string) => void
} {
  const parts = plan
    .filter((p) => p.planned > 0)
    .map((p) => ({ key: p.key, planned: p.planned, weight: p.weight ?? 1 }))
  const total = parts.reduce((sum, p) => sum + p.planned * p.weight, 0)
  const finished = new Set<string>()
  const doneBefore = (index: number): number => {
    let sum = 0
    for (let i = 0; i < parts.length; i++) {
      if (i !== index && finished.has(parts[i].key)) sum += parts[i].planned * parts[i].weight
    }
    return sum
  }
  return {
    report(key, completed) {
      const index = parts.findIndex((p) => p.key === key)
      if (index < 0) return undefined
      const part = parts[index]
      const own = finished.has(key) ? part.planned : Math.min(completed, part.planned)
      return {
        part: index + 1,
        parts: parts.length,
        completed: doneBefore(index) + own * part.weight,
        total
      }
    },
    finish(key) {
      finished.add(key)
    }
  }
}
