// src/shared/backgroundWork.ts
//
// One summary line for everything the app is doing in the background --
// direct request, 2026-09-30: "give a warning to the user when there is a
// background process in the app." Discover had felt sluggish while the
// whole-library stem analysis decoded audio in the renderer, and nothing on
// screen said so. BackgroundWorkIndicator.tsx gathers each process's state
// (from IPC, context, or the registry below) and this module turns them
// into the one line it shows. Pure, so the wording and the "which one leads"
// rule are tested here rather than eyeballed in the app.

/** Every background process the indicator knows about. */
export type BackgroundWorkKind =
  | 'stemAnalysis' // DiscoverLibraryScan: whole-library decode + analysis, renderer
  | 'placedAnalysis' // BackgroundFeatureScan: placed stems' decode + analysis, renderer
  | 'libraryIndex' // prewarmDiscoverCandidateCaches: startup table scan, main
  | 'autoClassify' // stemAutoClassifyScheduler: categorizing analysed stems, main
  | 'pluginScan' // runFullScan: one subprocess per plugin, main
  | 'librarySync' // riffLibrarySync: downloading a jam or the shared feed, main

export interface BackgroundWork {
  kind: BackgroundWorkKind
  /** Items finished so far, when known. */
  done?: number
  /** Items in the whole pass, when known. */
  total?: number
  /** Items still to go -- for open-ended work that knows its backlog but not a total. */
  left?: number
  /** Held off right now (a user pause, or radio holding the scans). */
  paused?: boolean
  /** Whether the indicator may offer pause/resume for this one. */
  pausable?: boolean
  /** A short aside after the progress, e.g. 'your stems ready' while the
   * library index rebuilds but his own stems can already roll. */
  note?: string
  /** What done/total count, e.g. 'riffs' -- only where both count the same
   * thing (the library index, @shared/libraryIndexProgress). */
  unit?: string
  /** A rough estimate of the time left, already worded (e.g. 'about 3 min
   * left', @shared/libraryIndexProgress's formatTimeLeft), shown after the
   * progress. */
  timeLeft?: string
  /** Overrides the kind's own verb, e.g. 'loading library' while a saved
   * index is read back rather than walked. */
  verb?: string
}

export interface BackgroundWorkSummary {
  /** The process the line leads with. */
  kind: BackgroundWorkKind
  label: string
  /** '+2' when other processes are running too, else null. */
  more: string | null
  /** Every process's own label, one per line, leader first. */
  title: string
  /** Whether the leading process is paused. */
  paused: boolean
  /** Whether any listed process can be paused. */
  pausable: boolean
}

const VERB: Record<BackgroundWorkKind, string> = {
  stemAnalysis: 'analysing stems',
  placedAnalysis: 'analysing placed stems',
  libraryIndex: 'indexing library',
  autoClassify: 'categorizing stems',
  pluginScan: 'scanning plugins',
  librarySync: 'syncing library'
}

/** Higher = costs the user more right now. Renderer-side analysis leads:
 * it decodes audio on the same thread that draws the UI, so it is the one
 * that makes clicks lag. The startup index blocks main-process IPC. The
 * rest are main-process or subprocess work the UI mostly doesn't feel. */
const COST: Record<BackgroundWorkKind, number> = {
  stemAnalysis: 6,
  placedAnalysis: 5,
  libraryIndex: 4,
  autoClassify: 3,
  pluginScan: 2,
  librarySync: 1
}

/** The ones worth the "may slow things down" heads-up. */
const SLOWS_UI: ReadonlySet<BackgroundWorkKind> = new Set([
  'stemAnalysis',
  'placedAnalysis',
  'libraryIndex'
])

/** 1240 -> '1,240'. Locale-independent on purpose: the label is tested,
 * and the app's copy should not change with the machine's region. */
export function formatCount(n: number): string {
  const whole = Math.max(0, Math.round(n))
  return String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function progressPart(work: BackgroundWork): string | null {
  if (work.done !== undefined && work.total !== undefined && work.total > 0) {
    const count = `${formatCount(work.done)} of ${formatCount(work.total)}`
    return work.unit ? `${count} ${work.unit}` : count
  }
  if (work.left !== undefined) return `${formatCount(work.left)} left`
  // A sync never knows its total up front (riffLibrarySync's own progress
  // reports total === done), so a running count is all there is.
  if (work.done !== undefined && work.kind === 'librarySync') {
    return `${formatCount(work.done)} riffs`
  }
  return null
}

/** One process's own line, e.g. 'analysing stems · 1,240 left · may slow things down'. */
export function describeBackgroundWork(work: BackgroundWork): string {
  const parts = [work.verb ?? VERB[work.kind]]
  const progress = progressPart(work)
  if (progress) parts.push(progress)
  if (progress && work.timeLeft) parts.push(work.timeLeft)
  if (work.note) parts.push(work.note)
  if (work.paused) parts.push('paused')
  else if (SLOWS_UI.has(work.kind)) parts.push('may slow things down')
  if (parts.length === 1) return `${parts[0]}…`
  return parts.join(' · ')
}

function rank(work: BackgroundWork): number {
  // A running process always outranks a paused one: a paused process is
  // not what is slowing anything down right now.
  return (work.paused ? 0 : 100) + COST[work.kind]
}

/** Merges every active process into one line, or null when nothing is running. */
export function summarizeBackgroundWork(
  works: readonly (BackgroundWork | null | undefined)[]
): BackgroundWorkSummary | null {
  const active = works.filter((w): w is BackgroundWork => w != null)
  if (active.length === 0) return null
  const ordered = [...active].sort((a, b) => rank(b) - rank(a))
  const leader = ordered[0]
  const label = describeBackgroundWork(leader)
  return {
    kind: leader.kind,
    label,
    more: ordered.length > 1 ? `+${ordered.length - 1}` : null,
    title: ordered.map(describeBackgroundWork).join('\n'),
    paused: leader.paused === true,
    pausable: ordered.some((w) => w.pausable === true)
  }
}

export interface BackgroundWorkRegistry {
  /** Sets (or, with null, clears) this kind's current state. */
  report: (kind: BackgroundWorkKind, work: BackgroundWork | null) => void
  /** Current entries -- the same array until something changes, so React's
   * useSyncExternalStore can use it directly. */
  snapshot: () => readonly BackgroundWork[]
  subscribe: (listener: () => void) => () => void
}

/** Where renderer-side processes (the two analysis scans) report their
 * state, since they run in components that render nothing near the
 * indicator. One entry per kind. */
export function createBackgroundWorkRegistry(): BackgroundWorkRegistry {
  const entries = new Map<BackgroundWorkKind, BackgroundWork>()
  const listeners = new Set<() => void>()
  let current: readonly BackgroundWork[] = []
  return {
    report(kind, work) {
      if (work === null && !entries.has(kind)) return
      if (work === null) entries.delete(kind)
      else entries.set(kind, work)
      current = [...entries.values()]
      for (const listener of listeners) listener()
    },
    snapshot() {
      return current
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  }
}
