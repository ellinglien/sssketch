// src/main/discoverCandidates.ts
import type Database from 'better-sqlite3'
import { type DrumSubRole } from '@shared/stemRole'
import {
  instrumentMaskToSoundType,
  soundSourceMatchesFilter,
  type DiscoverSoundSourceFilter
} from '@shared/riffLibraryTypes'
import {
  DISCOVER_MASK_SLOT_KINDS,
  discoverSlotKindToArrangeRole,
  isMaskSlotKind,
  isTraitSlotKind,
  normalizeSlotKinds,
  type DiscoverKindSource,
  type DiscoverMaskKind,
  type DiscoverSlotKind,
  type DiscoverTraitKind
} from '@shared/discoverSlotKind'
import {
  traitFieldValuesFromFeatures,
  traitValuesFromFeatures,
  type TraitFieldValues,
  type TraitValues
} from '@shared/discoverTraits'
import { traitPercentilesFromValues } from '@shared/traitQuantiles'
import {
  INTENSITY_INPUT_FIELDS,
  stemIntensityScore,
  type IntensityValues
} from '@shared/radioIntensity'
import { getTraitQuantileTables, getTraitValueTable } from './traitQuantileCache'
import { countWork } from './workCounters'
import type { StemFeatures } from '@shared/stemFeatures'
import {
  invalidateRiffIndexCache,
  loadCachedRiffIndex,
  loadCachedRiffOpenRowids,
  persistRiffIndexPage,
  readRiffIndexMeta,
  readRiffIndexEntryCount,
  recordRiffIndexEntryCount,
  resetRiffIndexCache,
  loadCachedInstrumentRows,
  persistInstrumentRowsPage,
  readInstrumentRowsMeta,
  resetInstrumentRowsCache,
  type IndexCacheMeta
} from './discoverIndexCache'
import { getStemClassificationVersion } from './stemClassificationVersion'
import {
  createInstrumentRowsLookup,
  rowsNotIn,
  type InstrumentRowsLookup
} from './instrumentRowsLookup'
import { emptyRiffIndexState, walkRiffs, type RiffIndexState } from './riffIndexWalk'
import { canExtendByRowidSliced, keyAtRowid, type RowidWatermark } from './rowidWatermark'
import { sortInstrumentRowsSliced, walkStems } from './stemsTableWalk'
import { buildOwnStemIndex, type OwnStemIndex } from './ownStemIndex'
import { seedTableCounts } from './tableCountSeed'
import { createLoadStageTracker, type LibraryIndexProgress } from '@shared/libraryIndexProgress'
import {
  isScanCacheCurrent,
  isTableCountInFlight,
  newScanCacheState,
  readTableHead,
  readTableSignal,
  whenTableCountsSettled,
  type ScanCacheState
} from './tableChangeSignal'
import { loadUnavailableStemCIDs } from './stemUnavailableStore'
import { stemIsUsable } from '@shared/stemAvailability'
import { hasExtraStemSlotsTable } from './riffStemsExtra'
import type { DiscoverCandidate } from '@shared/discoverCandidate'

export type { DiscoverCandidate } from '@shared/discoverCandidate'

/** Stems whose audio can no longer be fetched (see @shared/stemAvailability
 * and stemUnavailableStore.ts -- one of Endlesss's storage buckets now 403s
 * every anonymous GET). Every candidate pool in this file filters by this:
 * a roll that offers one of them produces a slot that can never resolve and
 * reads as a bare "no match."
 *
 * The check here is list-only, with no filesystem probe for an unavailable
 * stem that might have arrived on disk by some other route (an external
 * LORE archive sync, say) -- a pool at this stage has no resolved path to
 * probe, and the real download path already prefers local audio over
 * anything this list says (downloadOneStem) while a successful download
 * clears the row. So the only cost is that a stem which failed once and was
 * later acquired elsewhere stays out of rolls until something downloads it
 * again -- out of hundreds of thousands, and self-healing. */
function unavailableStems(ownDb: Database.Database | undefined): ReadonlySet<string> {
  return ownDb ? loadUnavailableStemCIDs(ownDb) : EMPTY_UNAVAILABLE
}

const EMPTY_UNAVAILABLE: ReadonlySet<string> = new Set<string>()

interface JamDbPair {
  jamCID: string
  dbForJam: Database.Database
}

/** One progress update from prewarmDiscoverCandidateCaches's own two-phase,
 * per-db scan (below) -- pushed to the renderer (main/index.ts) so
 * StartupGate.tsx and BackgroundWorkIndicator.tsx (which replaced
 * LibraryWarmupIndicator.tsx) can show real numbers instead of a static
 * "indexing library…" message. `phase` names which table this update is
 * for; `dbIndex`/`dbCount` are 0-indexed/total for the OUTER per-db loop
 * (almost always 1 or 2 in practice -- the own warehouse, plus an external
 * LORE archive if one's configured); `completed`/`total` are ROW counts
 * for THIS specific phase+db's own scan. Deliberately not a single
 * unified 0-100% across every phase/db at once -- the two phases have
 * genuinely different real costs (a riff has up to 8 stem slots to walk,
 * a stem row is flat), so a naive combined percentage would be
 * misleading about how much real time is actually left; showing "phase X
 * of Y, N / M rows" and letting the renderer derive its own ETA from
 * elapsed-time-so-far is more honest than pretending to know the total
 * cost upfront. */
// The shape lives in @shared/libraryIndexProgress (2026-10-07), with the
// wording and time-left estimate StartupGate and BackgroundWorkIndicator use:
// `completed`/`total` count one unit per phase (riffs for a riff walk,
// stems otherwise), and a load carries its place in the loading stage.
export type PrewarmScanProgress = LibraryIndexProgress

/** How a startup or in-session read of an index may be answered while that
 * index is still being walked (faster startup plan,
 * docs/superpowers/plans/2026-10-06-faster-startup.md):
 * - a loaded saved copy that is being extended answers every read (it is a
 *   subset of the live table: the shared rule only extends a copy nothing
 *   below the watermark was deleted from);
 * - the own-only index a rebuild serves first answers only a read whose
 *   stems all belong to its user (`ownStemsOf`);
 * - `complete` waits for the finished index whatever is served (a point
 *   lookup that must not say "not found" too early). */
export interface IndexScope {
  ownStemsOf?: string
  complete?: boolean
}

interface ServedIndex<T> {
  scope: 'extending' | 'own'
  /** 'own' only: whose stems. */
  username?: string
  value: T
}

/** What getRiffIndexForDb / getInstrumentRowsForDb answer while their walk
 * runs (IndexScope above). Set by the prewarm (a loaded copy, or the own
 * index) and by an in-session extension; deleted when the walk installs the
 * finished index, and by a forget. */
const servedRiffIndex = new WeakMap<Database.Database, ServedIndex<Map<string, RiffIndexEntry>>>()
const servedInstrumentRows = new WeakMap<Database.Database, ServedIndex<InstrumentRow[]>>()

function servedFor<T>(served: ServedIndex<T> | undefined, scope: IndexScope): T | undefined {
  if (!served || scope.complete) return undefined
  if (served.scope === 'extending') return served.value
  return scope.ownStemsOf !== undefined && served.username === scope.ownStemsOf
    ? served.value
    : undefined
}

/** Whether a startup step kept its saved copy (complete, or served while
 * it is extended) or has to rebuild. */
type WarmDecision = 'complete' | 'extending' | 'rebuild'

/** One gated startup step: it decides (and loads) at once, then waits for
 * `walk` before any walk or rebuild -- the gate opens in between. */
interface WarmPhase {
  decided: (decision: WarmDecision) => void
  walk: Promise<void>
  /** The archive's row counts (tableCountSeed.ts): a saved copy that may be
   * kept is loaded while they are still being taken, then decided. */
  counted?: Promise<void>
}

/** Whether a saved copy could still be kept (current or extendable), from
 * the head alone, with no count: false when the table's top fell below the
 * copy's watermark or the row at the watermark changed (a rebuild). Lets
 * the load overlap the archive's count; the real decision is still made
 * after it. A legacy copy (no watermark) is not guessed at. */
function mayKeepSavedCopy(
  db: Database.Database,
  table: 'Riffs' | 'Stems',
  keyColumn: 'RiffCID' | 'StemCID',
  meta: IndexCacheMeta | null
): boolean {
  const w = meta?.watermark
  if (!w) return false
  if (w.maxRowid === null) return true
  const head = readTableHead(db, table)
  if (!head || head.maxRowid === null || head.maxRowid < w.maxRowid) return false
  return keyAtRowid(db, table, keyColumn, w.maxRowid) === w.keyAtMax
}

function sameSavedCopy(a: IndexCacheMeta, b: IndexCacheMeta | null): boolean {
  return (
    b !== null &&
    a.count === b.count &&
    a.watermark?.maxRowid === b.watermark?.maxRowid &&
    a.watermark?.keyAtMax === b.watermark?.keyAtMax
  )
}

type PrewarmProgressCallback = (progress: PrewarmScanProgress) => void

// Both buildRiffIndex and getInstrumentRowsForDb are single-phase,
// single-db scans -- they don't know their own phase name or their
// dbIndex/dbCount context within the outer multi-db loop, so they report
// bare (completed, total) pairs; prewarmDiscoverCandidateCaches (below) is
// the one place that knows enough to wrap that into a full
// PrewarmScanProgress before forwarding to its own caller's onProgress.
// `loading`: the update is from reading a saved copy back (no walk of the
// table), which the gate words differently (StartupGate.tsx).
type ScanProgressCallback = (completed: number, total: number, loading?: boolean) => void

/** For loading a saved copy: the same callback, each update marked. */
function asLoading(onProgress: ScanProgressCallback): ScanProgressCallback {
  return (completed, total) => onProgress(completed, total, true)
}

// Real bug this guards against, learned the hard way earlier this same
// session (see discoverLibraryStems.ts's own YIELD_EVERY): the Electron
// main process is single-threaded, and comparing every unconfirmed
// embedded stem against every confirmed one (suggestCategoryFromEmbedding,
// a real O(unconfirmed x confirmed) cosine-similarity loop) is genuine
// synchronous CPU work that scales with how much of the whole-library scan
// has completed -- left unbroken, it would eventually block every OTHER
// IPC call (menus, saves, everything) for however long classification
// takes, the exact same beachball this session already fixed once.
const CLASSIFY_YIELD_EVERY = 200

// The startup walks (riff index, instrument rows) used to page with
// `LIMIT/OFFSET` here (PREWARM_CHUNK_SIZE, 2026-09-18, after one un-chunked
// SELECT * blocked the main process for minutes). They now page by rowid in
// riffIndexWalk.ts and stemsTableWalk.ts (scan plan b21ea5a2 Tasks 2-3):
// an OFFSET re-skips everything before each page, seconds per deep page on
// the USB archive.

// Real crash, found live via a full macOS crash report: SQLite trapping
// (EXC_BREAKPOINT, inside sqlite3CodeRhsOfIN/sqlite3FindInIndex) while
// COMPILING a query whose `StemCID_N IN (...)` clauses (8 of them, OR'd
// together, each repeating the SAME placeholder list) had grown to
// `8 * confirmedStemCIDs.length` bound parameters -- once the widened
// pool (embedding-guessed + instrument-matched, on top of confirmed) grew
// into the thousands, that single statement became too large for SQLite
// to compile at all. See getMaskDiscoverCandidates's own main loop, below,
// for where this bounds every query regardless of pool size.
const CANDIDATE_QUERY_CHUNK_SIZE = 200
// Real per-chunk SQL round trips (not cheap JS-only work like
// CLASSIFY_YIELD_EVERY's own loop) -- a much smaller threshold, so a
// library with many jams times many chunks still yields often enough to
// stay non-blocking.
const RIFF_QUERY_YIELD_EVERY = 20

// Real perf bug, found live (root cause of a FOURTH "stuck rolling"
// report -- confirmed unchanged, ~80s, even AFTER collapsing the query
// count from ~130 to ~5 the same day): the dominant cost was never the
// NUMBER of queries -- it's evaluating an unindexed `StemCID_N IN (...)`
// clause (8 columns, up to 200 placeholders each) against EVERY row of a
// genuinely huge, externally-synced, READ-ONLY Riffs table (5,057 jams;
// no index possible there, see getRiffIndexForDb's own doc comment
// below). Confirmed by a real, live comparison: getRandomLibraryCandidate
// (below) touches the SAME table but with no such WHERE clause at all
// (small per-jam, unfiltered reads) and was reported "much faster" on the
// exact same real library. Fetching the whole table with NO WHERE clause
// at all (a plain sequential scan -- no per-row predicate to evaluate)
// and building an in-memory index ONCE, cached for a while, turns every
// SUBSEQUENT roll's own lookup into a plain JS Map.get() -- see
// getRiffIndexForDb, below.
//
// Background efficiency B3 (2026-09-22): these caches used to expire after
// a plain 5-minute TTL even when nothing had changed, forcing a full
// rescan on a schedule. Now they're kept until a cheap change check says
// the table moved -- see tableChangeSignal.ts (readTableSignal /
// isScanCacheCurrent), which this file introduced and which
// riffLibraryStore.ts's own jam-list cache now shares.

export interface RiffIndexEntry {
  riffCID: string
  ownerJamCID: string
  bpmRnd: number
  creationTime: number | null
}

// `walk` holds what an extension needs (open riffs, rowid watermark --
// riffIndexWalk.ts); `index` is walk.index.
const riffIndexCache = new WeakMap<
  Database.Database,
  { index: Map<string, RiffIndexEntry>; state: ScanCacheState; walk: RiffIndexState }
>()

// In-flight de-duplication -- direct request, 2026-09-16 ("can we take a
// good look at the things we just added... and see if we can improve the
// speed"): findRiffForStemPath (discoverAdjacency.ts) calls
// getRiffIndexForDb once per seedStem-only Discover slot, and a
// Shelf-sourced seed can easily have 8 of those mounting at once. Without
// this, 8 concurrent calls landing before the FIRST one's scan finishes
// (and thus before riffIndexCache has anything to serve) would each
// independently kick off the SAME expensive full table scan -- up to 8x
// the real work, right at the exact moment (just after seeding) the app
// most needs to stay responsive. Cleared once the scan settles (success
// or failure) so a later call, once the cache is stale, starts a fresh
// scan rather than reusing a long-finished promise forever.
// Each entry carries the forget generation its walk started at (below): a
// walk restarted after a forget joins only an entry from the current one.
const riffIndexInFlight = new WeakMap<
  Database.Database,
  { promise: Promise<Map<string, RiffIndexEntry>>; generation: number }
>()

/** Bumped by dropInMemoryRiffIndex (forgetDiscoveredRifff). A riff-index walk
 * records it at its start: one that finishes after a forget holds the
 * pre-forget index (the kept group folded in by appendToInMemoryDiscoverCaches)
 * and a watermark that never counted the forgotten riff, so the shared rule
 * would extend it as current for the whole session. Such a walk neither
 * installs its index nor leaves a saved meta behind (review of bc6baef0 fix 2). */
const riffIndexForgets = new WeakMap<Database.Database, number>()

function riffIndexForgetGeneration(db: Database.Database): number {
  return riffIndexForgets.get(db) ?? 0
}

/** Every StemCID in `db`'s own Riffs table, mapped to its owning riff's
 * {RiffCID, OwnerJamCID, BPMrnd} -- built via ONE unfiltered `SELECT *`
 * (no per-row WHERE-clause evaluation at all, the cheapest possible shape
 * for a full scan), then cached in memory until its Riffs table changes
 * (isScanCacheCurrent -- background efficiency B3).
 * `db` may be the EXTERNAL, READ-ONLY LORE archive connection
 * (riffLibraryStore.ts's own getRiffLibraryDb, opened `readonly: true` by
 * deliberate design) -- no index can be added there, so this in-memory
 * cache is the only lever available to avoid re-paying a real, large
 * table scan's cost on every single roll. Concurrent callers for the same
 * `db` share one in-flight scan (riffIndexInFlight, above) rather than
 * each starting their own. */
export async function getRiffIndexForDb(
  db: Database.Database,
  scope: IndexScope = {}
): Promise<Map<string, RiffIndexEntry>> {
  // A build reads the Riffs signal: after the startup worker's count, if one
  // is running (tableCountSeed.ts). Only then, so no other call yields here.
  if (isTableCountInFlight(db, 'Riffs')) await whenTableCountsSettled(db, ['Riffs'])
  const served = servedFor(servedRiffIndex.get(db), scope)
  if (served) return served

  const inFlight = riffIndexInFlight.get(db)
  if (inFlight) return inFlight.promise

  const cached = riffIndexCache.get(db)
  if (cached && isScanCacheCurrent(db, 'Riffs', cached.state)) return cached.index

  return shareRiffIndexBuild(db, () => buildRiffIndex(db, cached?.walk))
}

/** Starts `start` (a walk, which records the forget generation first thing)
 * and registers it in riffIndexInFlight with that generation. */
function shareRiffIndexBuild(
  db: Database.Database,
  start: () => Promise<Map<string, RiffIndexEntry>>
): Promise<Map<string, RiffIndexEntry>> {
  const generation = riffIndexForgetGeneration(db)
  const promise: Promise<Map<string, RiffIndexEntry>> = start().finally(() => {
    // Only its own entry: a forget mid-walk drops it, and a newer build may
    // have registered meanwhile.
    if (riffIndexInFlight.get(db)?.promise === promise) riffIndexInFlight.delete(db)
  })
  riffIndexInFlight.set(db, { promise, generation })
  return promise
}

/** A walk that finished after a forget starts afresh, shared (review of
 * T5-T7: run outside riffIndexInFlight, a caller arriving after the forget
 * walked the whole table beside it). It joins a walk registered since the
 * latest forget; otherwise it registers its own, replacing any entry from
 * before the forget -- which may be this very walk's (a forget that landed
 * before the walk was registered, e.g. from the prewarm's progress callback,
 * deleted nothing), and it must not wait on itself. */
function restartRiffIndexAfterForget(
  db: Database.Database,
  onProgress?: ScanProgressCallback
): Promise<Map<string, RiffIndexEntry>> {
  const inFlight = riffIndexInFlight.get(db)
  if (inFlight && inFlight.generation === riffIndexForgetGeneration(db)) return inFlight.promise
  return shareRiffIndexBuild(db, () => buildRiffIndex(db, undefined, onProgress))
}

/** The in-session refresh (no ownDb, nothing persisted -- the next launch's
 * prewarm extends the saved copy itself): extends `previous` from its rowid
 * watermark when the shared rule allows (rowidWatermark.ts), else walks the
 * whole table. Either way by rowid, page by page (riffIndexWalk.ts: why
 * rowid order, and why the result is the old RiffCID-ordered walk's
 * exactly). The signal is read BEFORE the walk, so a riff added mid-walk
 * reads as a change next time. */
async function buildRiffIndex(
  db: Database.Database,
  previous: RiffIndexState | undefined,
  onProgress?: ScanProgressCallback
): Promise<Map<string, RiffIndexEntry>> {
  const generation = riffIndexForgetGeneration(db)
  const signal = readTableSignal(db, 'Riffs')
  const state = newScanCacheState(signal)
  if (!signal) {
    // `db` may be an external file missing even a core table. Cache the
    // empty result so a broken db doesn't retry this scan on every call.
    const walk = emptyRiffIndexState()
    riffIndexCache.set(db, { index: walk.index, state, walk })
    return walk.index
  }
  const walk =
    previous?.watermark &&
    (await canExtendByRowidSliced(db, 'Riffs', 'RiffCID', previous.watermark, signal))
      ? previous
      : emptyRiffIndexState()
  // Forgotten while the extend check yielded: this walk would extend the
  // pre-forget index (and serve it) -- start afresh at once instead.
  if (riffIndexForgetGeneration(db) !== generation)
    return restartRiffIndexAfterForget(db, onProgress)
  countWork(walk === previous ? 'riff-index:extend' : 'riff-index:rebuild')
  // An extension serves the index it grows in place meanwhile (faster
  // startup): entries are only added, or moved to a smaller RiffCID.
  const served = walk === previous ? { scope: 'extending' as const, value: walk.index } : undefined
  if (served) servedRiffIndex.set(db, served)
  try {
    await walkRiffs(db, walk, { onProgress, total: signal.count })
  } finally {
    if (served && servedRiffIndex.get(db) === served) servedRiffIndex.delete(db)
  }
  // Forgotten mid-walk: this index is the pre-forget one -- start afresh.
  if (riffIndexForgetGeneration(db) !== generation)
    return restartRiffIndexAfterForget(db, onProgress)
  riffIndexCache.set(db, { index: walk.index, state, walk })
  return walk.index
}

/** Reads the saved riff index back, reporting against the entry count it
 * was saved with (null for a copy saved before that was kept: a running
 * count). When the count found differs, it is recorded for the next load. */
async function loadSavedRiffIndex(
  ownDb: Database.Database,
  key: string,
  onProgress: ScanProgressCallback
): Promise<Map<string, RiffIndexEntry>> {
  const entries = readRiffIndexEntryCount(ownDb, key)
  const index = await loadCachedRiffIndex(ownDb, key, asLoading(onProgress), entries ?? 0)
  if (entries !== index.size) recordRiffIndexEntryCount(ownDb, key, index.size)
  return index
}

/** The prewarm's half for the riff index, against the copy saved in ownDb
 * (scan plan Task 2):
 * 1. saved and current (same count, MAX(rowid) and RiffCID at it; a legacy
 *    row without a watermark: same count) -> load it;
 * 2. saved with a watermark the live table extends (rowidWatermark.ts) ->
 *    load it, then walk only the open riffs and the riffs past it,
 *    persisting page by page;
 * 3. otherwise -> start the saved copy over and walk the whole table,
 *    persisting page by page -- so an interrupted rebuild is case 2 on the
 *    next launch, and resumes.
 * Saves are time-budgeted transactions (discoverIndexCache.ts), never the
 * one 844k-row INSERT the whole-index save was.
 *
 * Gated (faster startup, 2026-10-06): it tells `phase.decided` which case it
 * is as soon as it knows -- after the load in cases 1-2, where case 2's copy
 * is served meanwhile (servedRiffIndex) -- and waits for `phase.walk` (the
 * gate has opened) before any walk, or case 3's reset of the old copy. */
async function warmRiffIndex(
  db: Database.Database,
  ownDb: Database.Database,
  onProgress: ScanProgressCallback,
  phase: WarmPhase
): Promise<Map<string, RiffIndexEntry>> {
  const key = db.name
  const generation = riffIndexForgetGeneration(db)
  const forgotten = (): boolean => riffIndexForgetGeneration(db) !== generation
  let preloaded: { meta: IndexCacheMeta; index: Map<string, RiffIndexEntry> } | undefined
  if (phase.counted) {
    const early = readRiffIndexMeta(ownDb, key)
    // The total is the copy's own entry count, never the meta's Riffs count:
    // one entry per stem (his library: 900,041 riffs, 761,929 entries), so
    // the gate read "761,929 / 900,041" and then the total dropped.
    if (early && mayKeepSavedCopy(db, 'Riffs', 'RiffCID', early)) {
      preloaded = { meta: early, index: await loadSavedRiffIndex(ownDb, key, onProgress) }
    }
    await phase.counted
  }
  const live = readTableSignal(db, 'Riffs')
  if (!live) {
    phase.decided('complete')
    return buildRiffIndex(db, undefined, onProgress)
  }
  const meta = readRiffIndexMeta(ownDb, key)
  const state = newScanCacheState(live)
  const current =
    meta !== null &&
    meta.count === live.count &&
    (meta.watermark === null ||
      (meta.watermark.maxRowid === live.maxRowid &&
        (live.maxRowid === null ||
          keyAtRowid(db, 'Riffs', 'RiffCID', live.maxRowid) === meta.watermark.keyAtMax)))
  const extendable =
    !current &&
    meta?.watermark != null &&
    (await canExtendByRowidSliced(db, 'Riffs', 'RiffCID', meta.watermark, live))

  let walk: RiffIndexState
  let served: ServedIndex<Map<string, RiffIndexEntry>> | undefined
  if (current || extendable) {
    walk = {
      index:
        preloaded && sameSavedCopy(preloaded.meta, meta)
          ? preloaded.index
          : await loadSavedRiffIndex(ownDb, key, onProgress),
      open: loadCachedRiffOpenRowids(ownDb, key),
      watermark: meta!.watermark
    }
    // A current copy still re-reads its open (skeleton) riffs: the sync fills
    // them in place, which moves no count, MAX(rowid) or RiffCID at it. With
    // nothing past the watermark that is the open riffs plus one empty page.
    if (current && (walk.watermark === null || walk.open.size === 0)) {
      riffIndexCache.set(db, { index: walk.index, state, walk })
      phase.decided('complete')
      return walk.index
    }
    // Served while it is extended (faster startup): a copy the shared rule
    // extends is a subset of the live table, and the walk only adds entries
    // or moves one to a smaller RiffCID.
    // (Not after a forget: that copy is the pre-forget one, and this walk
    // restarts once it ends.)
    if (!forgotten()) {
      served = { scope: 'extending', value: walk.index }
      servedRiffIndex.set(db, served)
    }
    phase.decided('extending')
    await phase.walk
  } else {
    // Never served: rows below its watermark were deleted (or it has none).
    phase.decided('rebuild')
    await phase.walk
    countWork('riff-index:rebuild')
    walk = emptyRiffIndexState()
  }
  try {
    // Inside the try: a reset that throws must still drop the own index the
    // rebuild served (below), not leave it served for the whole session.
    if (!current && !extendable) await resetRiffIndexCache(ownDb, key)
    if (extendable) countWork('riff-index:extend')
    await walkRiffs(db, walk, {
      onProgress,
      total: live.count,
      // Once forgotten, nothing more is saved: a page's meta would re-create
      // the one forget just deleted.
      onPage: async (page) => {
        if (!forgotten()) await persistRiffIndexPage(ownDb, key, page)
      }
    })
  } finally {
    // The extended copy, or the own index a rebuild served: either way the
    // walk has ended. (A forget already deleted it.)
    const now = servedRiffIndex.get(db)
    if (now && (now === served || now.scope === 'own')) servedRiffIndex.delete(db)
  }
  if (forgotten()) {
    // A page saved across the forget (its sliced transactions yield) may
    // have written the meta again: drop it, so the next launch rebuilds.
    invalidateRiffIndexCache(ownDb, key)
    return restartRiffIndexAfterForget(db, onProgress)
  }
  riffIndexCache.set(db, { index: walk.index, state, walk })
  return walk.index
}

/** Kicks off getRiffIndexForDb (above) for every unique db connection in
 * `jams`, in the BACKGROUND, well before anyone actually rolls -- direct
 * live report: even after caching made every roll AFTER the first one
 * fast, the very FIRST roll of a fresh app session still had to pay the
 * real, one-time table-scan cost (confirmed live: 57+ seconds on a
 * 5,057-jam real library) on the user's own critical path, right as they
 * opened Discover for the first time. Call this once, at app startup
 * (main/index.ts's own app.whenReady()) -- by the time a real user
 * actually opens Discover and clicks roll, the cache is very likely
 * already warm, so that first click pays nothing extra. Errors are
 * logged, never thrown -- a failed pre-warm just means the FIRST real
 * roll pays the cost itself instead, same as if this were never called;
 * it must never be allowed to affect app startup's own success.
 *
 * Direct report, 2026-09-18: even with the above, this in-memory cache
 * (riffIndexCache/instrumentRowsCache, both plain WeakMaps keyed to the
 * live db CONNECTION object) is process-lifetime-only -- a fresh app
 * launch always starts cold, so the real ~4-5 minute scan cost (372,297
 * riffs on Elling's own external LORE archive) ran on EVERY single
 * launch, not just the first ever. `ownDb` (sssketch's own always-on,
 * writable warehouse -- see discoverIndexCache.ts's own doc comment for
 * why the cache lives there even for an external archive's own data) is
 * now checked FIRST for each db+phase: a cheap `SELECT COUNT(*)`
 * (readTableSignal above) against the row count the cache was last saved
 * with tells us whether the archive has actually changed since. An
 * unchanged archive loads straight from `ownDb` (fast -- same disk as
 * everything else this app already reads/writes, and for the riff index
 * specifically, already in the fully-resolved per-stem shape, skipping
 * buildRiffIndex's own per-riff 8-slot loop entirely) instead of
 * re-scanning the real source db. A changed (or never-cached) archive
 * still does the real scan as before, then persists the fresh result for
 * next launch's benefit.
 *
 * Faster startup (approved 2026-10-06, docs/superpowers/plans/
 * 2026-10-06-faster-startup.md), in three steps:
 * 0. the archive's row counts (tableCountSeed.ts: no long COUNT when the
 *    file hasn't changed since the last launch);
 * 1. usable: per db, each index decides and loads its saved copy; where one
 *    has to be rebuilt, the user's own-only index (ownStemIndex.ts) is built
 *    and served to rolls restricted to that user -- then options.onUsable;
 * 2. complete: the extensions and rebuilds, one walk at a time. */
export interface PrewarmOptions {
  /** The user whose own-only index a rebuild serves first (faster startup);
   * read when a rebuild needs it. Null or absent: no own stage. */
  ownUsername?: () => string | null | undefined
  /** Called once, when every db's indexes can answer reads: saved copies
   * loaded (complete, or served while they are extended), or the own index
   * built where a copy has to be rebuilt. The walks run after it. */
  onUsable?: () => void
  /** Each own-only index built (a db that has to be rebuilt): index.ts hands
   * its stems to stemPriority.ts, so "only my stems" doesn't read them again. */
  onOwnIndex?: (db: Database.Database, own: OwnStemIndex) => void
}

/** A WarmPhase whose walk waits for open(), and whose decision is known as
 * soon as the step makes it (or fails). */
function gatedWarmStep<T>(
  counted: Promise<void>,
  run: (phase: WarmPhase) => Promise<T>
): {
  promise: Promise<T>
  decided: Promise<WarmDecision>
  open: () => void
} {
  let open!: () => void
  const walk = new Promise<void>((resolve) => {
    open = resolve
  })
  let decide!: (decision: WarmDecision) => void
  const decided = new Promise<WarmDecision>((resolve) => {
    decide = resolve
  })
  const promise = run({ decided: decide, walk, counted })
  // A step that failed before deciding: nothing to serve, nothing to wait for.
  promise.then(
    () => decide('complete'),
    () => decide('complete')
  )
  return { promise, decided, open }
}

/** How many entries a launch's load of the saved riff index will read: its
 * entry count, or for a copy saved before that was kept the saved Stems rows
 * (an upper bound: 891,062 stems for 761,929 entries on his archive) -- only
 * for timing the loading stage, never shown as a total. 0: nothing saved. */
function plannedRiffIndexLoad(ownDb: Database.Database, key: string): number {
  return plannedOrZero(() => {
    const meta = readRiffIndexMeta(ownDb, key)
    if (!meta || meta.count === 0) return 0
    return (
      readRiffIndexEntryCount(ownDb, key) ?? readInstrumentRowsMeta(ownDb, key)?.count ?? meta.count
    )
  })
}

/** Planning only times the wait: an ownDb without the cache tables (the
 * steps cope with that themselves) plans nothing rather than throwing. */
function plannedOrZero(read: () => number): number {
  try {
    return read()
  } catch {
    return 0
  }
}

export async function prewarmDiscoverCandidateCaches(
  jams: JamDbPair[],
  ownDb: Database.Database,
  onProgress?: PrewarmProgressCallback,
  options: PrewarmOptions = {}
): Promise<void> {
  const uniqueDbs = [...new Set(jams.map((j) => j.dbForJam))]
  const ownOnly = (): boolean =>
    uniqueDbs.some(
      (db) =>
        servedRiffIndex.get(db)?.scope === 'own' || servedInstrumentRows.get(db)?.scope === 'own'
    )
  // Every saved copy this launch may read back before the gate opens, in
  // the order the steps run, so a load can say which step of how many it is
  // and the gate can time the whole wait (2026-10-07). A step that ends up
  // rebuilding instead counts as done when it decides.
  const loadStage = createLoadStageTracker(
    uniqueDbs.flatMap((db, dbIndex) => [
      {
        key: `riffIndex:${dbIndex}`,
        planned: plannedRiffIndexLoad(ownDb, db.name),
        // A saved riff-index entry loads slower than a stem row: 2.7x warm
        // on his data (762k entries 1.3 s, 891k rows 0.55 s, 2026-10-07),
        // 1.4x cold (3.8 s / 3.1 s, 2026-10-06).
        weight: 2
      },
      {
        key: `instrumentRows:${dbIndex}`,
        planned: plannedOrZero(() => readInstrumentRowsMeta(ownDb, db.name)?.count ?? 0)
      }
    ])
  )
  const reporter =
    (phase: PrewarmScanProgress['phase'], dbIndex: number) =>
    (completed: number, total: number, loading?: boolean): void => {
      const stage = loading ? loadStage.report(`${phase}:${dbIndex}`, completed) : undefined
      onProgress?.({
        phase,
        dbIndex,
        dbCount: uniqueDbs.length,
        completed,
        total,
        ...(ownOnly() ? { ownOnly: true } : {}),
        ...(loading ? { loading: true } : {}),
        ...(stage ? { stage } : {})
      })
    }

  // The archive's row counts, with no COUNT on the main thread
  // (tableCountSeed.ts; index.ts started them when the archive opened, and
  // this joins those): each step loads a copy it may keep meanwhile, then
  // decides once they are in.
  const counted = new Map(uniqueDbs.map((db) => [db, seedTableCounts(db, ownDb)]))

  // Usable phase: decide each index, load what is kept, and on a rebuild
  // build the own-only index -- then open the gate. Walks wait for it.
  const walks: { open: () => void; settled: Promise<unknown> }[] = []
  for (let dbIndex = 0; dbIndex < uniqueDbs.length; dbIndex++) {
    const db = uniqueDbs[dbIndex]
    let riffDecision: WarmDecision = 'complete'
    let rowsDecision: WarmDecision = 'complete'

    // Shared with any getRiffIndexForDb call that lands meanwhile.
    const pendingRiffs = riffIndexInFlight.get(db)
    if (pendingRiffs) {
      await pendingRiffs.promise.catch((err) =>
        console.error('prewarmDiscoverCandidateCaches: failed to warm riff index:', err)
      )
      loadStage.finish(`riffIndex:${dbIndex}`)
    } else {
      // Created inside shareRiffIndexBuild's start, which reads the forget
      // generation first: a forget landing in the step's synchronous start
      // (the load's progress callback) must leave the registered build older
      // than it, or the restarted walk would wait on itself.
      let step!: ReturnType<typeof gatedWarmStep<Map<string, RiffIndexEntry>>>
      void shareRiffIndexBuild(db, () => {
        step = gatedWarmStep(counted.get(db)!, (phase) =>
          warmRiffIndex(db, ownDb, reporter('riffIndex', dbIndex), phase)
        )
        return step.promise
      }).catch(() => undefined)
      riffDecision = await step.decided
      loadStage.finish(`riffIndex:${dbIndex}`)
      walks.push({
        open: step.open,
        settled: step.promise.catch((err) =>
          console.error('prewarmDiscoverCandidateCaches: failed to warm riff index:', err)
        )
      })
    }

    // One rowid-order Stems walk, persisted page by page, extended from its
    // watermark (scan plan Task 3); it also feeds stemsTableWalk.ts's sinks
    // (the artist pairs). getInstrumentRowsForDb swallows its own errors.
    const pendingRows = instrumentRowsInFlight.get(db)
    if (pendingRows) {
      await pendingRows.catch((err) =>
        console.error('prewarmDiscoverCandidateCaches: failed to warm instrument rows:', err)
      )
      loadStage.finish(`instrumentRows:${dbIndex}`)
    } else {
      const step = gatedWarmStep(counted.get(db)!, (phase) =>
        warmInstrumentRows(db, ownDb, reporter('instrumentRows', dbIndex), phase)
      )
      void shareInstrumentRowsBuild(db, step.promise).catch(() => undefined)
      rowsDecision = await step.decided
      loadStage.finish(`instrumentRows:${dbIndex}`)
      walks.push({
        open: step.open,
        settled: step.promise.catch((err) =>
          console.error('prewarmDiscoverCandidateCaches: failed to warm instrument rows:', err)
        )
      })
    }

    const username = options.ownUsername?.()?.trim()
    if (username && (riffDecision === 'rebuild' || rowsDecision === 'rebuild')) {
      try {
        const report = reporter('ownStems', dbIndex)
        const own = await buildOwnStemIndex(db, username, { onProgress: (n) => report(n, 0) })
        options.onOwnIndex?.(db, own)
        if (riffDecision === 'rebuild') {
          servedRiffIndex.set(db, { scope: 'own', username, value: own.riffIndex })
        }
        if (rowsDecision === 'rebuild') {
          servedInstrumentRows.set(db, { scope: 'own', username, value: own.rows })
        }
      } catch (err) {
        console.error('prewarmDiscoverCandidateCaches: own-only index failed:', err)
      }
    }
  }
  options.onUsable?.()

  // Complete phase: one walk at a time, in order (two walks of the USB
  // archive at once would only slow both).
  for (const walk of walks) {
    walk.open()
    await walk.settled
  }
}

// Real perf bug, found live: once the background classify scan
// (stemAutoClassify.ts) started actually succeeding at real scale
// (confidence thresholds loosened 2026-09-15 after diagnostic tuning),
// a popular role's own confirmed pool could grow into the TENS OF
// THOUSANDS -- e.g. 'drums', which had by far the most training samples.
// Resolving EVERY one of them into a full DiscoverCandidate, even with
// the per-db-batched, chunked query below (fixed earlier the same day),
// meant dozens to well over a hundred sequential round trips against
// Riffs/Stems -- confirmed live as a genuine multi-minute beachball
// (the whole app unresponsive, not just Discover). The caller
// (DiscoverPanel.tsx's own rankCandidates + pickReroll) only ever needs
// a reasonably-sized POOL to rank and pick ONE candidate from, never
// literally every possible match, so the pool is capped to a bounded
// RANDOM sample (pickRandomSample, below) BEFORE the expensive
// resolution work runs, rather than resolving everything and only then
// discarding most of it in the renderer.
const MAX_CANDIDATE_RESOLUTION_POOL = 1000

/** Partial Fisher-Yates (swap-to-end) -- shuffles only as many elements
 * as needed, not the whole (potentially tens-of-thousands-long) pool.
 * Same pattern as stemAutoClassify.ts's own pickRandomBatch, duplicated
 * locally rather than shared across main/ modules for one avoided
 * dependency between two otherwise-unrelated files. */
function pickRandomSample<T>(items: T[], size: number): T[] {
  if (items.length <= size) return items
  const pool = [...items]
  const picked: T[] = []
  for (let i = 0; i < size; i++) {
    const idx = Math.floor(Math.random() * pool.length)
    picked.push(pool[idx])
    pool[idx] = pool[pool.length - 1]
    pool.pop()
  }
  return picked
}

// Cache for getInstrumentRowsForDb, below -- a real library's worth of
// jams x stems walked fresh on EVERY roll click with no cache at all took
// minutes (confirmed live). Keyed by db INSTANCE (WeakMap, not a flat
// cache) specifically so tests using fresh in-memory dbs don't pollute
// each other -- same pattern this file used for the now-retired embedding/
// centroid caches before they moved to the background scan. Same
// change-detection rule as the riff index (isScanCacheCurrent, against
// the Stems table -- background efficiency B3; it used to share the riff
// index's 5-minute TTL).
// `watermark` (rowidWatermark.ts) is what an extension continues from; null
// only for rows loaded from a legacy saved copy, which can't be extended.
const instrumentRowsCache = new WeakMap<
  Database.Database,
  {
    rows: { StemCID: string; Instrument: number | null; OwnerJamCID: string }[]
    state: ScanCacheState
    watermark: RowidWatermark | null
  }
>()
const instrumentRowsInFlight = new WeakMap<Database.Database, Promise<InstrumentRow[]>>()

function shareInstrumentRowsBuild(
  db: Database.Database,
  build: Promise<InstrumentRow[]>
): Promise<InstrumentRow[]> {
  const promise = build.finally(() => instrumentRowsInFlight.delete(db))
  instrumentRowsInFlight.set(db, promise)
  return promise
}

/** An extension's rows appended to `base` -- a NEW array when anything was
 * added (the kind index is keyed by array identity and must rebuild), the
 * same one when nothing was. Rows appended out of StemCID order are the
 * mask lookup's small tail map; a big tail is sorted in instead.
 *
 * Walked rows `base` already holds are skipped (rowsNotIn): the walk past a
 * watermark re-reads a kept stem that appendInstrumentRows saved (so the
 * loaded copy has it), one appendToInMemoryDiscoverCaches folded in this
 * session, and the rows of a page a quit left saved in part. Appended
 * again, each would be in the array twice. */
const SORT_TAIL_LIMIT = 10_000

async function withWalkedRows(
  base: InstrumentRow[],
  walked: InstrumentRow[]
): Promise<InstrumentRow[]> {
  if (walked.length === 0) return base
  const fresh = await rowsNotIn(base, walked)
  if (fresh.length === 0) return base
  const rows = base.concat(fresh)
  return fresh.length > SORT_TAIL_LIMIT ? sortInstrumentRowsSliced(rows) : rows
}

/** The prewarm's half for the instrument rows -- warmRiffIndex's three cases
 * against the copy saved in ownDb, over Stems:
 * 1. saved and current (same count, MAX(rowid) and StemCID at it; a legacy
 *    copy without a watermark: same count) -> load it (StemCID order);
 * 2. saved with a watermark the live table extends -> load it, then walk
 *    only the stems past it, persisting page by page;
 * 3. otherwise -> start over and walk the whole table, persisting page by
 *    page (an interrupted rebuild is case 2 next launch), then sort the
 *    rowid-ordered rows by StemCID in slices for the mask lookup.
 * Whatever walk runs also feeds stemsTableWalk.ts's sinks (the artist
 * pairs, Task 4): one Stems walk per change. Gated like warmRiffIndex. */
async function warmInstrumentRows(
  db: Database.Database,
  ownDb: Database.Database,
  onProgress: ScanProgressCallback,
  phase: WarmPhase
): Promise<InstrumentRow[]> {
  const key = db.name
  let preloaded: { meta: IndexCacheMeta; rows: InstrumentRow[] } | undefined
  if (phase.counted) {
    const early = readInstrumentRowsMeta(ownDb, key)
    if (early && mayKeepSavedCopy(db, 'Stems', 'StemCID', early)) {
      preloaded = {
        meta: early,
        rows: await loadCachedInstrumentRows(ownDb, key, asLoading(onProgress), early.count)
      }
    }
    await phase.counted
  }
  const live = readTableSignal(db, 'Stems')
  if (!live) {
    phase.decided('complete')
    return buildInstrumentRows(db, undefined, onProgress)
  }
  const meta = readInstrumentRowsMeta(ownDb, key)
  const state = newScanCacheState(live)
  const current =
    meta !== null &&
    meta.count === live.count &&
    (meta.watermark === null ||
      (meta.watermark.maxRowid === live.maxRowid &&
        (live.maxRowid === null ||
          keyAtRowid(db, 'Stems', 'StemCID', live.maxRowid) === meta.watermark.keyAtMax)))
  const extendable =
    !current &&
    meta?.watermark != null &&
    (await canExtendByRowidSliced(db, 'Stems', 'StemCID', meta.watermark, live))

  let rows: InstrumentRow[]
  let watermark: RowidWatermark | null
  let served: ServedIndex<InstrumentRow[]> | undefined
  if (current || extendable) {
    rows =
      preloaded && sameSavedCopy(preloaded.meta, meta)
        ? preloaded.rows
        : await loadCachedInstrumentRows(ownDb, key, asLoading(onProgress), meta!.count)
    watermark = meta!.watermark && { ...meta!.watermark }
    if (current) {
      instrumentRowsCache.set(db, { rows, state, watermark })
      phase.decided('complete')
      return rows
    }
    // Served while it is extended (faster startup): Stems rows are written
    // once, and an extendable copy lost none below its watermark.
    served = { scope: 'extending', value: rows }
    servedInstrumentRows.set(db, served)
    phase.decided('extending')
    await phase.walk
  } else {
    phase.decided('rebuild')
    await phase.walk
    countWork('instrument-rows:rebuild')
    rows = []
    watermark = { count: 0, maxRowid: null, keyAtMax: null }
  }
  try {
    // Inside the try, as warmRiffIndex's: a failed reset still drops the own rows.
    if (!current && !extendable) await resetInstrumentRowsCache(ownDb, key)
    if (extendable) countWork('instrument-rows:extend')
    const walked = await walkStems(db, watermark!, {
      onProgress,
      total: live.count,
      ownDb,
      onPage: (page) => persistInstrumentRowsPage(ownDb, key, page.rows, page.watermark)
    })
    rows = extendable
      ? await withWalkedRows(rows, walked.rows)
      : await sortInstrumentRowsSliced(walked.rows)
    watermark = walked.watermark
  } finally {
    const now = servedInstrumentRows.get(db)
    if (now && (now === served || now.scope === 'own')) servedInstrumentRows.delete(db)
  }
  instrumentRowsCache.set(db, { rows, state, watermark })
  return rows
}

/** The in-session refresh (nothing persisted; the next launch's prewarm
 * extends the saved copy): extends `previous` from its watermark when the
 * shared rule allows, else walks the whole table. */
async function buildInstrumentRows(
  db: Database.Database,
  previous: { rows: InstrumentRow[]; watermark: RowidWatermark | null } | undefined,
  onProgress?: ScanProgressCallback
): Promise<InstrumentRow[]> {
  const signal = readTableSignal(db, 'Stems')
  const state = newScanCacheState(signal)
  if (!signal) {
    // An external db missing even a core table shouldn't abort the whole
    // multi-db scan. Cache the empty result so a broken db doesn't retry.
    instrumentRowsCache.set(db, { rows: [], state, watermark: null })
    return []
  }
  const extend =
    previous?.watermark != null &&
    (await canExtendByRowidSliced(db, 'Stems', 'StemCID', previous.watermark, signal))
  countWork(extend ? 'instrument-rows:extend' : 'instrument-rows:rebuild')
  const from = extend ? previous!.watermark! : { count: 0, maxRowid: null, keyAtMax: null }
  // An extension serves the rows it extends meanwhile (faster startup).
  const served = extend ? { scope: 'extending' as const, value: previous!.rows } : undefined
  if (served) servedInstrumentRows.set(db, served)
  try {
    const walked = await walkStems(db, from, { onProgress, total: signal.count })
    const rows = extend
      ? await withWalkedRows(previous!.rows, walked.rows)
      : await sortInstrumentRowsSliced(walked.rows)
    instrumentRowsCache.set(db, { rows, state, watermark: walked.watermark })
    return rows
  } finally {
    if (served && servedInstrumentRows.get(db) === served) servedInstrumentRows.delete(db)
  }
}

/** The whole `Stems` table's own StemCID/Instrument/OwnerJamCID columns for
 * `db`, cached in memory -- the expensive, disk-bound part of
 * getMaskKindStemMasks (below), split out on its own so it can be
 * cached ONCE PER DB rather than once per (db, ArrangeRole).
 *
 * Real perf bug, found live 2026-09-15 via Elling's own question ("if
 * 15,054 drum stems have been analyzed, why does it take 38 seconds on
 * first load?") -- confirmed with real timing against his actual archive
 * (372,297-riff/367,019-stem external LORE db): this SAME unfiltered
 * `SELECT StemCID, Instrument, OwnerJamCID FROM Stems` (no per-role WHERE
 * clause -- the role filter only ever happens in JS, after the fetch) used
 * to be re-run from scratch for EVERY ArrangeRole not yet cached, even
 * though every role reads the exact same rows -- only the JS-side bitmask
 * check differs. Rolling 'drums' then 'bass' then 'lead' in the same
 * session each independently paid a real ~6.5s cold scan against the
 * external archive for identical data. Caching the raw rows here (fast
 * per-role JS filtering happens fresh every call in
 * getMaskKindStemMasks, measured at ~50ms even for 367k rows) means
 * only the FIRST role rolled in a session pays this cost; every other role
 * after it becomes a plain in-memory filter.
 *
 * Paginated the same way, for the same ORDER BY reason, as buildRiffIndex
 * above -- see that function's own doc comment. Each row here is O(1) to
 * process (a plain array push, no per-riff nested slot loop), so unlike
 * buildRiffIndex this doesn't need its own inner yield counter -- yielding
 * once per PREWARM_CHUNK_SIZE page is already well within
 * CLASSIFY_YIELD_EVERY's own established safe-cap territory. */
async function getInstrumentRowsForDb(
  db: Database.Database,
  scope: IndexScope = {}
): Promise<InstrumentRow[]> {
  if (isTableCountInFlight(db, 'Stems')) await whenTableCountsSettled(db, ['Stems'])
  const served = servedFor(servedInstrumentRows.get(db), scope)
  if (served) return served
  const pending = instrumentRowsInFlight.get(db)
  if (pending) return pending
  const cached = instrumentRowsCache.get(db)
  if (cached && isScanCacheCurrent(db, 'Stems', cached.state)) return cached.rows
  return shareInstrumentRowsBuild(db, buildInstrumentRows(db, cached))
}

const instrumentMaskLookups = new WeakMap<object, InstrumentRowsLookup>()

/** Stems.Instrument by StemCID from the instrument rows already in memory
 * for `db` (prewarm loads them at startup) -- for the overnight classifier,
 * which otherwise ran a 200-id IN query against the external archive on
 * USB for every batch (background scan audit item 2b, 2026-10-05). The
 * lookup answers the mask, null for a row without one, or undefined for a
 * stem `db` doesn't have: exactly what that query would have said.
 *
 * Null (ask SQL instead) unless the rows are exactly current: built, and
 * the Stems signal unchanged since in every part (count, MAX(rowid),
 * data_version, this process's writes) -- stricter than isScanCacheCurrent,
 * which trusts a cache for up to 30 s between checks; the signal read is
 * ~0.05 ms when nothing moved (tableChangeSignal.ts's shared count). Only a
 * read-only connection (the external archive): sssketch's own warehouse
 * is written all the time and its Stems IN query is an index lookup on the
 * internal disk (~0.5 ms), so it stays on SQL.
 *
 * Rows loaded from the saved copy at startup are trusted only when its
 * count, MAX(rowid) and the StemCID at it all match the live table (scan
 * plan Task 3; warmInstrumentRows), so a same-size delete + insert between
 * launches is seen. Stems rows are written once, never filled in place. */
export function getInstrumentMaskLookup(db: Database.Database): InstrumentRowsLookup | null {
  if (!db.readonly) return null
  const cached = instrumentRowsCache.get(db)
  if (!cached || !cached.state.signal) return null
  const built = cached.state.signal
  const live = readTableSignal(db, 'Stems')
  if (
    !live ||
    live.count !== built.count ||
    live.maxRowid !== built.maxRowid ||
    live.dataVersion !== built.dataVersion ||
    live.writes !== built.writes
  ) {
    return null
  }
  let lookup = instrumentMaskLookups.get(cached.rows)
  if (!lookup) {
    lookup = createInstrumentRowsLookup(cached.rows)
    instrumentMaskLookups.set(cached.rows, lookup)
  }
  return lookup
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** The per-row loops below check the clock every CLASSIFY_YIELD_EVERY rows
 * (or RIFF_QUERY_YIELD_EVERY queries) but yield only once their slice has
 * run ROLL_SLICE_MS. Yielding on the count alone made a roll during a
 * startup walk crawl: each yield waits behind one walk slice (~100-150 ms on
 * the USB archive), so a "mine" roll over 68k own rows, a few hundred
 * yields, took ~90 s while the rebuild ran (faster startup, measured). */
const ROLL_SLICE_MS = 8

function newSlice(): { started: number } {
  return { started: performance.now() }
}

async function yieldIfSliceSpent(slice: { started: number }): Promise<void> {
  if (performance.now() - slice.started < ROLL_SLICE_MS) return
  await yieldToEventLoop()
  slice.started = performance.now()
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

/** Every StemCID, across the given jams, admitted to MASK kind `kind`'s
 * pool by the Endlesss mask or the overnight classifier -- mapped to its
 * own raw instrument mask (Stems.Instrument, null when unset) so the
 * caller can apply the endlesss/non-endlesss sound-source filter. Also
 * records the mask of every stem confirmed (StemCategories) for `kind`'s
 * own role that the walk passes, for the same reason -- the caller adds
 * those stems to the pool itself.
 *
 * A stem confirmed for ANY ArrangeRole is never admitted here -- a real
 * human confirmation always wins (confirmed for a different role excludes
 * it, confirmed for this role is the caller's own source). Otherwise:
 *
 * - Endlesss instrument mask (instrumentMaskToSoundType) resolving to
 *   drums/bass/notes: ground truth Endlesss itself recorded at jam time
 *   ("traced directly from OUROVEON's own source, not guessed"), present on
 *   every synced stem the moment it syncs -- direct request 2026-09-15:
 *   "can't we train it with some basic data before handing it to someone?"
 *   The mask decides alone; an auto guess never moves such a stem to
 *   another kind.
 * - A stem the mask CAN'T place (Instrument null, no recognised bit, or
 *   audio-in): admitted if the overnight classify scan's own precomputed
 *   guess (StemAutoCategory, on ownDb) is `kind`'s role. That classifier
 *   was dropped for mask kinds on 2026-09-18 (the Discover trait-based
 *   matching redesign stopped trusting it for anything the mask answers
 *   directly), and is back as of 2026-09-22 -- direct request: audio-in/mic
 *   stems never appeared under drums/bass/lead, since the mask has no
 *   answer for them at all. Scoped to exactly those stems, so the mask
 *   stays authoritative wherever it has something to say.
 *
 * Background efficiency B2: the admission rule above is applied ONCE per
 * db, for all three mask kinds in one pass over its cached instrument rows
 * (getMaskKindIndex, below), and reused by every roll until those rows are
 * rebuilt or the classification tables change -- a roll then only filters
 * the kind's own admitted list by the caller's jams (still keeping the
 * FIRST admitted row per StemCID, dbs in `jams` order, exactly as the old
 * per-roll walk did). Yields every CLASSIFY_YIELD_EVERY rows -- cheap per
 * row, but real synchronous work at library scale.
 *
 * Real perf bugs fixed here 2026-09-15 (found live via Elling's own
 * question: "if 15,054 drum stems have been analyzed, why does it take 38
 * seconds on first load?"): this used to cache its OWN already-filtered
 * per-role result, re-running the raw scan for every role not yet cached;
 * and before that it queried each jam's own Stems table separately (5,057
 * round trips). Jams are grouped by db CONNECTION (most share one --
 * riffLibraryStore.ts's own dbForJam), each db's Stems table is read ONCE
 * (the shared getInstrumentRowsForDb cache), and "is this jam one we're
 * allowed to include" is filtered in JS (allowedJamCIDs) -- O(uniqueDbs),
 * not O(jams). */
interface MaskKindAdmission {
  /** Stems.Instrument, null when unset. */
  instrument: number | null
  /** Which rule admitted the stem -- surfaced on the candidate as
   * kindSources (the match meter), never re-derived per stem. */
  source: DiscoverKindSource
}

async function getMaskKindStemMasks(
  ownDb: Database.Database,
  jams: JamDbPair[],
  kind: DiscoverSlotKind,
  scope: IndexScope = {}
): Promise<Map<string, MaskKindAdmission>> {
  const signature = readClassificationSignature(ownDb)

  const jamCIDsByDb = new Map<Database.Database, Set<string>>()
  for (const { jamCID, dbForJam } of jams) {
    const existing = jamCIDsByDb.get(dbForJam)
    if (existing) existing.add(jamCID)
    else jamCIDsByDb.set(dbForJam, new Set([jamCID]))
  }

  const maskByStemCID = new Map<string, MaskKindAdmission>()
  let sinceYield = 0
  const slice = newSlice()
  for (const [db, allowedJamCIDs] of jamCIDsByDb) {
    const rows = await getInstrumentRowsForDb(db, scope)
    const index = await getMaskKindIndex(db, rows, ownDb, signature)
    // The base list (confirmed + tag), then the guess list: disjoint by
    // StemCID within a db (one Stems row per StemCID), so the order between
    // them changes nothing but iteration order.
    for (const admitted of [
      index.byKind.get(kind as DiscoverMaskKind),
      index.guess.byKind.get(kind as DiscoverMaskKind)
    ]) {
      if (!admitted) continue
      countWork('scan:discover.kind-list-rows', admitted.rows.length)
      for (let i = 0; i < admitted.rows.length; i++) {
        const row = admitted.rows[i]
        if (allowedJamCIDs.has(row.OwnerJamCID) && !maskByStemCID.has(row.StemCID)) {
          maskByStemCID.set(row.StemCID, {
            instrument: row.Instrument,
            source: admitted.sources[i]
          })
        }
        sinceYield += 1
        if (sinceYield >= CLASSIFY_YIELD_EVERY) {
          sinceYield = 0
          await yieldIfSliceSpent(slice)
        }
      }
    }
  }
  return maskByStemCID
}

type InstrumentRow = { StemCID: string; Instrument: number | null; OwnerJamCID: string }

/** One mask kind's admitted rows (in instrument-row order) and the rule
 * that admitted each -- parallel arrays. */
interface MaskKindList {
  rows: InstrumentRow[]
  sources: DiscoverKindSource[]
}

/** Background efficiency B2: per db, every instrument row admitted to each
 * mask kind (getMaskKindStemMasks's own rule), computed once from the
 * cached instrument rows + ownDb's StemCategories/StemAutoCategory.
 *
 * In two layers since scan plan b21ea5a2 Task 10 (audit 9):
 * - the BASE (`byKind`: confirmed + tag, and `residue`: the rows neither
 *   confirmed nor placed by their mask) -- valid while `rows` is the same
 *   cached array (a rebuilt or extended instrument-row cache is a new
 *   array) and the confirmed signature hasn't moved;
 * - the GUESS layer (`guess.byKind`): residue rows whose overnight guess is
 *   the kind's role, rebuilt from the residue alone when only
 *   StemAutoCategory moved, at most once per GUESS_LAYER_MIN_MS. Guesses
 *   only ever add `guess` admissions for stems nothing else places, so a
 *   guess up to 10 s late in a pool is acceptable (decision 13);
 *   confirmations rebuild both at once. */
interface MaskKindIndex {
  rows: InstrumentRow[]
  ownDb: Database.Database
  confirmedSignature: string
  byKind: Map<DiscoverMaskKind, MaskKindList>
  residue: InstrumentRow[]
  guess: GuessLayer
  guessInFlight?: Promise<void>
}

interface GuessLayer {
  autoSignature: string
  builtAt: number
  byKind: Map<DiscoverMaskKind, MaskKindList>
}

/** The guess layer is rebuilt at most this often while StemAutoCategory
 * keeps moving (the classifier and zero-shot write about once a second
 * while they have work). */
export const GUESS_LAYER_MIN_MS = 10_000

interface ClassificationSignature {
  confirmed: string
  auto: string
}

const maskKindIndexCache = new WeakMap<Database.Database, MaskKindIndex>()
const maskKindIndexInFlight = new WeakMap<
  Database.Database,
  {
    rows: InstrumentRow[]
    ownDb: Database.Database
    confirmedSignature: string
    promise: Promise<MaskKindIndex>
  }
>()

/** Cheap change signal for the classification tables, read once per roll,
 * split per table (Task 10): the in-process write counter
 * (stemClassificationVersion.ts -- catches every write this app makes, even
 * one that leaves counts/timestamps alone) plus row counts and
 * UpdatedAt/ComputedAt aggregates (catches a write made straight to SQL).
 * One small query on ownDb; both tables are narrow. */
function readClassificationSignature(ownDb: Database.Database): ClassificationSignature {
  countWork('sql:discover.classification-signal')
  const row = ownDb
    .prepare(
      `SELECT
         (SELECT COUNT(ArrangeRole) FROM StemCategories) AS confirmedCount,
         (SELECT MAX(UpdatedAt) FROM StemCategories) AS confirmedMax,
         (SELECT TOTAL(UpdatedAt) FROM StemCategories) AS confirmedTotal,
         (SELECT COUNT(*) FROM StemAutoCategory) AS autoCount,
         (SELECT MAX(ComputedAt) FROM StemAutoCategory) AS autoMax,
         (SELECT TOTAL(ComputedAt) FROM StemAutoCategory) AS autoTotal`
    )
    .get() as Record<string, number | null>
  return {
    confirmed: [
      getStemClassificationVersion(ownDb, 'confirmed'),
      row.confirmedCount,
      row.confirmedMax,
      row.confirmedTotal
    ].join('|'),
    auto: [
      getStemClassificationVersion(ownDb, 'auto'),
      row.autoCount,
      row.autoMax,
      row.autoTotal
    ].join('|')
  }
}

async function getMaskKindIndex(
  db: Database.Database,
  rows: InstrumentRow[],
  ownDb: Database.Database,
  signature: ClassificationSignature
): Promise<MaskKindIndex> {
  const cached = maskKindIndexCache.get(db)
  if (
    cached &&
    cached.rows === rows &&
    cached.ownDb === ownDb &&
    cached.confirmedSignature === signature.confirmed
  ) {
    if (
      !cached.guessInFlight &&
      cached.guess.autoSignature !== signature.auto &&
      Date.now() - cached.guess.builtAt >= GUESS_LAYER_MIN_MS
    ) {
      // Shared by every roll that lands meanwhile.
      countWork('kind-index:guess-rebuild')
      cached.guessInFlight = buildGuessLayer(cached.residue, ownDb, signature.auto)
        .then((guess) => {
          cached.guess = guess
        })
        .finally(() => {
          cached.guessInFlight = undefined
        })
    }
    if (cached.guessInFlight) await cached.guessInFlight
    return cached
  }
  const inFlight = maskKindIndexInFlight.get(db)
  if (
    inFlight &&
    inFlight.rows === rows &&
    inFlight.ownDb === ownDb &&
    inFlight.confirmedSignature === signature.confirmed
  ) {
    return inFlight.promise
  }
  const promise = buildMaskKindIndex(rows, ownDb, signature)
    .then((index) => {
      maskKindIndexCache.set(db, index)
      return index
    })
    .finally(() => {
      if (maskKindIndexInFlight.get(db)?.promise === promise) maskKindIndexInFlight.delete(db)
    })
  maskKindIndexInFlight.set(db, {
    rows,
    ownDb,
    confirmedSignature: signature.confirmed,
    promise
  })
  return promise
}

function kindByRole(): Map<string, DiscoverMaskKind> {
  return new Map<string, DiscoverMaskKind>(
    DISCOVER_MASK_SLOT_KINDS.map((k) => [discoverSlotKindToArrangeRole(k), k as DiscoverMaskKind])
  )
}

function emptyKindLists(): Map<DiscoverMaskKind, MaskKindList> {
  return new Map<DiscoverMaskKind, MaskKindList>(
    DISCOVER_MASK_SLOT_KINDS.map((k) => [k as DiscoverMaskKind, { rows: [], sources: [] }])
  )
}

/** The base layer: one pass over `rows` for all three mask kinds.
 * StemCategories is read ONLY from ownDb (an external archive never has it
 * -- see getMaskDiscoverCandidates's own CRITICAL note). A stem confirmed
 * for any role is admitted only to that role's kind ('confirmed');
 * otherwise a mask that places it decides alone ('tag'); otherwise it is
 * residue, for the guess layer. `.all()`, never `.iterate()` across the
 * awaits below. */
async function buildMaskKindIndex(
  rows: InstrumentRow[],
  ownDb: Database.Database,
  signature: ClassificationSignature
): Promise<MaskKindIndex> {
  countWork('sql:discover.kind-index-build')
  const confirmedRoleByStemCID = new Map(
    (
      ownDb
        .prepare(`SELECT StemCID, ArrangeRole FROM StemCategories WHERE ArrangeRole IS NOT NULL`)
        .all() as { StemCID: string; ArrangeRole: string }[]
    ).map((r) => [r.StemCID, r.ArrangeRole])
  )
  const roles = kindByRole()
  const byKind = emptyKindLists()
  const residue: InstrumentRow[] = []
  const admit = (
    kind: DiscoverMaskKind | undefined,
    row: InstrumentRow,
    source: DiscoverKindSource
  ): void => {
    if (!kind) return
    const list = byKind.get(kind)!
    list.rows.push(row)
    list.sources.push(source)
  }

  countWork('scan:discover.kind-index-rows', rows.length)
  let sinceYield = 0
  const slice = newSlice()
  for (const row of rows) {
    const confirmedRole = confirmedRoleByStemCID.get(row.StemCID)
    if (confirmedRole !== undefined) {
      // Confirmed for a mask kind's role: that kind's own source.
      // Confirmed for any other role: excluded from every mask kind.
      admit(roles.get(confirmedRole), row, 'confirmed')
    } else {
      const soundType = row.Instrument === null ? null : instrumentMaskToSoundType(row.Instrument)
      if (soundType === 'drums') admit('drums', row, 'tag')
      else if (soundType === 'bass') admit('bass', row, 'tag')
      else if (soundType === 'notes') admit('lead', row, 'tag')
      else residue.push(row)
    }
    sinceYield += 1
    if (sinceYield >= CLASSIFY_YIELD_EVERY) {
      sinceYield = 0
      await yieldIfSliceSpent(slice)
    }
  }
  return {
    rows,
    ownDb,
    confirmedSignature: signature.confirmed,
    byKind,
    residue,
    guess: await buildGuessLayer(residue, ownDb, signature.auto)
  }
}

/** The guess layer: the residue rows whose overnight guess
 * (StemAutoCategory) is a mask kind's role -- a fresh read of that table
 * and one pass over the residue only. */
async function buildGuessLayer(
  residue: InstrumentRow[],
  ownDb: Database.Database,
  autoSignature: string
): Promise<GuessLayer> {
  countWork('sql:discover.kind-index-build')
  const autoRoleByStemCID = new Map(
    (
      ownDb.prepare(`SELECT StemCID, ArrangeRole FROM StemAutoCategory`).all() as {
        StemCID: string
        ArrangeRole: string
      }[]
    ).map((r) => [r.StemCID, r.ArrangeRole])
  )
  const roles = kindByRole()
  const byKind = emptyKindLists()
  let sinceYield = 0
  const slice = newSlice()
  for (const row of residue) {
    const kind = roles.get(autoRoleByStemCID.get(row.StemCID) ?? '')
    if (kind) {
      const list = byKind.get(kind)!
      list.rows.push(row)
      list.sources.push('guess')
    }
    sinceYield += 1
    if (sinceYield >= CLASSIFY_YIELD_EVERY) {
      sinceYield = 0
      await yieldIfSliceSpent(slice)
    }
  }
  return { autoSignature, builtAt: Date.now(), byKind }
}

/** Combination slots (docs/superpowers/specs/2026-09-21-discover-combo-
 * slot-kinds-design.md) -- ONE rule for every kind set: mask kinds
 * (drums/bass/lead) OR together, each drawing from human confirmation, the
 * Endlesss instrument mask, and -- for stems the mask can't place -- the
 * overnight classifier (getMaskKindStemMasks); a trait-only set draws from
 * every stem with cached features (tagged or not). The endlesss/
 * non-endlesss source filter then applies to EVERY candidate, of
 * any kind set, by its own instrument mask (soundSourceMatchesFilter):
 * endlesss = sounds made with Endlesss instruments/effects (an unmasked
 * stem counts here), non-endlesss = audio-in/mic. Direct request,
 * 2026-09-22: mask kinds used to return nothing while "endlesss" was off,
 * so audio-in/mic stems could never appear under drums/bass/lead. Trait
 * kinds never filter -- they only attach traitValues for rankCandidates to
 * rank by, in the renderer. The per-stem twin of this rule is
 * stemMatchesSlotKinds (@shared/discoverTraits). */
export async function getDiscoverCandidates({
  ownDb,
  jams,
  kinds,
  onlyOwnStems = false,
  targetUser,
  soundSource = { endlesss: true, audioIn: true },
  artistStemCIDs,
  alsoTraits = [],
  alsoIntensity = false,
  ownStemsOf
}: {
  ownDb: Database.Database
  jams: JamDbPair[]
  kinds: readonly DiscoverSlotKind[]
  onlyOwnStems?: boolean
  targetUser?: string
  /** Every stem this roll may draw belongs to this user (artist mode's
   * artist, or "only my stems"' target user): while the library index is
   * still being rebuilt at startup, the user's own-only index may answer
   * (faster startup, IndexScope). Undefined: only a complete or extending
   * index answers. */
  ownStemsOf?: string
  soundSource?: DiscoverSoundSourceFilter
  /** Discover artist mode (2026-10-01): ONLY these stems may enter any
   * pool, applied BEFORE each pool's bounded random sample -- see
   * docs/superpowers/plans/2026-10-01-discover-artist-mode.md, "READ THIS"
   * §2. Undefined (every `me` roll) takes today's path untouched. */
  artistStemCIDs?: ReadonlySet<string>
  /** Radio fold mode's clash (@shared/radioClash): trait kinds to attach values and library
   * percentiles for even though the slot does not ask for them, so the clash can measure every
   * candidate against the bed. They never filter and never change `slotKinds`; empty (every
   * other roll) takes today's path untouched. */
  alsoTraits?: readonly DiscoverTraitKind[]
  /** The radio's intensity arc (@shared/radioIntensity, spec 2026-10-05-radio-intensity-arc-design
   * 2.2): attach every candidate's `intensity` score. False (every other roll): nothing attached,
   * the payload as before. */
  alsoIntensity?: boolean
}): Promise<DiscoverCandidate[]> {
  const pool = await getDiscoverCandidatesPool({
    ownDb,
    jams,
    kinds,
    onlyOwnStems,
    targetUser,
    soundSource,
    artistStemCIDs,
    alsoTraits,
    scope: { ownStemsOf }
  })
  return alsoIntensity ? attachDiscoverIntensity(ownDb, pool) : pool
}

async function getDiscoverCandidatesPool({
  ownDb,
  jams,
  kinds,
  onlyOwnStems,
  targetUser,
  soundSource,
  artistStemCIDs,
  alsoTraits,
  scope
}: {
  ownDb: Database.Database
  jams: JamDbPair[]
  kinds: readonly DiscoverSlotKind[]
  onlyOwnStems: boolean
  targetUser?: string
  soundSource: DiscoverSoundSourceFilter
  artistStemCIDs?: ReadonlySet<string>
  alsoTraits: readonly DiscoverTraitKind[]
  scope: IndexScope
}): Promise<DiscoverCandidate[]> {
  const normalized = normalizeSlotKinds(kinds)
  const maskKinds = normalized.filter(isMaskSlotKind)
  const traitKinds = normalized.filter(isTraitSlotKind)
  // The slot's own trait kinds, then any the clash asks for on top (deduplicated, in order).
  const valueKinds = [...traitKinds, ...alsoTraits.filter((k) => !traitKinds.includes(k))]

  if (maskKinds.length === 0) {
    if (traitKinds.length === 0) return []
    const traitPool = await getTraitPoolCandidates({
      ownDb,
      jams,
      traitKinds,
      onlyOwnStems,
      targetUser,
      soundSource,
      artistStemCIDs,
      scope
    })
    // traitKinds IS the whole normalized set here (no mask kinds), so the
    // pool's own slotKinds already match it.
    return attachTraitPercentiles(
      ownDb,
      valueKinds.length > traitKinds.length
        ? attachTraitValues(ownDb, traitPool, valueKinds)
        : traitPool
    )
  }

  // Nothing can pass the sound-source filter -- skip the walk entirely.
  if (!soundSource.endlesss && !soundSource.audioIn) return []
  const indexByStemCID = new Map<string, number>()
  const pool: DiscoverCandidate[] = []
  for (const kind of maskKinds) {
    const perKind = await getMaskDiscoverCandidates({
      ownDb,
      jams,
      kind,
      onlyOwnStems,
      targetUser,
      soundSource,
      artistStemCIDs,
      scope
    })
    for (const candidate of perKind) {
      const existing = indexByStemCID.get(candidate.stemCID)
      if (existing !== undefined) {
        // Admitted by more than one mask kind of the set: keep the first
        // candidate, record every kind's own source for the meter.
        const kept = pool[existing]
        pool[existing] = {
          ...kept,
          kindSources: { ...kept.kindSources, ...candidate.kindSources }
        }
        continue
      }
      indexByStemCID.set(candidate.stemCID, pool.length)
      pool.push({ ...candidate, slotKinds: normalized })
    }
  }
  return valueKinds.length > 0
    ? attachTraitPercentiles(ownDb, attachTraitValues(ownDb, pool, valueKinds))
    : pool
}

/** Trait values for `kinds` (attachTraitValues) and their library percentiles
 * (attachTraitPercentiles) on a pool built elsewhere -- radio's dig near pool
 * (getAdjacentDiscoverCandidates' percentileTraits), so it is ranked and
 * barred on the same footing as getDiscoverCandidates' own. Same order, same
 * length; empty `kinds` returns the pool as it is. */
export async function attachDiscoverTraits(
  ownDb: Database.Database,
  pool: DiscoverCandidate[],
  kinds: readonly DiscoverTraitKind[]
): Promise<DiscoverCandidate[]> {
  if (kinds.length === 0 || pool.length === 0) return pool
  return attachTraitPercentiles(ownDb, attachTraitValues(ownDb, pool, kinds))
}

/** The radio's intensity score on every candidate of a pool (spec 2026-10-05-radio-intensity-arc-
 * design 2.2): its values from the in-memory value table (traitQuantileCache.ts, which carries the
 * level pass's fields too) or, until that table is current, ownDb's feature rows; the library
 * percentiles from the cached quantile tables. A stem with no row, or neither busy nor low, is
 * null (unscored). Same order, same length; yields like attachTraitPercentiles. Radio's dig near
 * pool (discoverAdjacency.ts) takes it too. */
export async function attachDiscoverIntensity(
  ownDb: Database.Database,
  pool: DiscoverCandidate[]
): Promise<DiscoverCandidate[]> {
  if (pool.length === 0) return pool
  const tables = await getTraitQuantileTables(ownDb)
  const valuesOf = intensityValueSource(
    ownDb,
    pool.map((c) => c.stemCID)
  )
  const out: DiscoverCandidate[] = []
  let sinceYield = 0
  const slice = newSlice()
  for (const c of pool) {
    const values = valuesOf(c.stemCID)
    out.push({ ...c, intensity: values === null ? null : stemIntensityScore(values, tables) })
    sinceYield += 1
    if (sinceYield >= CLASSIFY_YIELD_EVERY) {
      sinceYield = 0
      await yieldIfSliceSpent(slice)
    }
  }
  countWork('discover:intensity-attached', out.length)
  return out
}

/** Each stem's intensity inputs: from the value table when it is current, else read from ownDb's
 * StemFeatureCache (chunked, as attachTraitValues' fallback). Null: no (parseable) row. */
function intensityValueSource(
  ownDb: Database.Database,
  stemCIDs: readonly string[]
): (stemCID: string) => IntensityValues | null {
  const pick = (f: Record<string, unknown>): IntensityValues => {
    const v: IntensityValues = {}
    for (const field of INTENSITY_INPUT_FIELDS) {
      const x = f[field]
      if (typeof x === 'number' && Number.isFinite(x)) v[field] = x
    }
    return v
  }
  const table = getTraitValueTable(ownDb)
  if (table) {
    return (stemCID) => {
      const row = table.rowOf(stemCID)
      return row === undefined
        ? null
        : pick(table.features(row) as unknown as Record<string, unknown>)
    }
  }
  const rows = featureRowsByStemCID(ownDb, stemCIDs)
  return (stemCID) => {
    const f = rows.get(stemCID)
    // A row that parses to something other than an object reads as no row (as the value table's
    // build leaves it out).
    return f && typeof f === 'object' ? pick(f as unknown as Record<string, unknown>) : null
  }
}

/** Parsed StemFeatureCache rows for these stems, chunked; a malformed row is left out. */
function featureRowsByStemCID(
  ownDb: Database.Database,
  stemCIDs: readonly string[]
): Map<string, StemFeatures> {
  const featuresByStemCID = new Map<string, StemFeatures>()
  for (const cidChunk of chunk([...stemCIDs], CANDIDATE_QUERY_CHUNK_SIZE)) {
    const placeholders = cidChunk.map(() => '?').join(', ')
    let rows: FeatureCandidateRow[]
    try {
      countWork('sql:discover.feature-rows')
      rows = ownDb
        .prepare(
          `SELECT StemCID, FeaturesJSON FROM StemFeatureCache WHERE StemCID IN (${placeholders})`
        )
        .all(...cidChunk) as FeatureCandidateRow[]
    } catch {
      continue
    }
    countWork('parse:stem-features', rows.length)
    for (const row of rows) {
      try {
        featuresByStemCID.set(row.StemCID, JSON.parse(row.FeaturesJSON) as StemFeatures)
      } catch {
        // malformed row -- this stem just gets no values
      }
    }
  }
  return featuresByStemCID
}

/** Library-wide trait percentiles (docs/superpowers/specs/2026-09-22-
 * discover-promise-vs-delivery-design.md, Phase 1) for every candidate
 * that has trait values, from the cached quantile tables
 * (traitQuantileCache.ts -- built once, never per roll). A binary search
 * per requested trait per candidate; the pool is capped at
 * MAX_CANDIDATE_RESOLUTION_POOL per kind, but yields every
 * CLASSIFY_YIELD_EVERY anyway like every other per-row loop here. */
async function attachTraitPercentiles(
  ownDb: Database.Database,
  pool: DiscoverCandidate[]
): Promise<DiscoverCandidate[]> {
  if (pool.length === 0) return pool
  const tables = await getTraitQuantileTables(ownDb)
  const out: DiscoverCandidate[] = []
  let sinceYield = 0
  const slice = newSlice()
  for (const c of pool) {
    out.push({
      ...c,
      traitPercentiles: traitPercentilesFromValues(c.traitValues, tables, c.traitFieldValues)
    })
    sinceYield += 1
    if (sinceYield >= CLASSIFY_YIELD_EVERY) {
      sinceYield = 0
      await yieldIfSliceSpent(slice)
    }
  }
  return out
}

/** Mask + trait sets: attaches the requested trait values to each pooled
 * stem. A stem with no cached row (or a malformed one) keeps traitValues {}
 * -- it stays eligible and simply scores 0 on the trait terms.
 *
 * Background efficiency B1: values come from the in-memory trait value
 * table (traitQuantileCache.ts's getTraitValueTable -- built from the same
 * parse as the percentile tables, kept current by the feature-row write
 * hook), through the SAME traitValuesFromFeatures/
 * traitFieldValuesFromFeatures a parsed FeaturesJSON goes through. Until
 * that table exists (or if it no longer accounts for every row), reads
 * ownDb's StemFeatureCache as before -- primary-key lookups, chunked like
 * every other IN query in this file. */
function attachTraitValues(
  ownDb: Database.Database,
  pool: DiscoverCandidate[],
  traitKinds: readonly DiscoverTraitKind[]
): DiscoverCandidate[] {
  const table = getTraitValueTable(ownDb)
  if (table) {
    return pool.map((c) => {
      const row = table.rowOf(c.stemCID)
      if (row === undefined) return c
      const features = table.features(row)
      return {
        ...c,
        traitValues: traitValuesFromFeatures(features, traitKinds),
        traitFieldValues: traitFieldValuesFromFeatures(features, traitKinds)
      }
    })
  }

  const featuresByStemCID = featureRowsByStemCID(
    ownDb,
    pool.map((c) => c.stemCID)
  )
  return pool.map((c) => {
    const features = featuresByStemCID.get(c.stemCID)
    return features
      ? {
          ...c,
          traitValues: traitValuesFromFeatures(features, traitKinds),
          traitFieldValues: traitFieldValuesFromFeatures(features, traitKinds)
        }
      : c
  })
}

/** Every stem, library-wide, that's a candidate for the given MASK
 * DiscoverSlotKind (drums/bass/lead) -- the data source
 * getDiscoverCandidates (below) samples from for a set's mask kinds. Called
 * once per mask kind in the set and unioned there -- see
 * getDiscoverCandidates's own doc comment for the full combination-slot
 * rule.
 *
 * `jams` is caller-supplied (not computed here) so this function stays a
 * pure-ish query over whatever set of {jamCID, db} pairs the caller already
 * resolved via listJams()/dbForJam() (riffLibraryStore.ts) -- keeps this
 * module free of any dependency on riffLibraryStore.ts's own module-level
 * "currently configured root" state, which makes it trivially testable
 * with in-memory dbs (see this file's own test).
 *
 * CRITICAL: StemCategories is looked up ONLY against `ownDb`, regardless of
 * which db a given jam's own Riffs/Stems rows live in (`dbForJam`) -- an
 * external LORE archive db never has a StemCategories table at all (fixed
 * commit 14505a0 today, after this exact assumption caused a real
 * "SqliteError: no such table" crash in getConfirmedEmbeddings). Never
 * repeat that mistake here.
 *
 * SCAN DIRECTION: starts from StemCategories WHERE ArrangeRole = ? on ownDb
 * FIRST -- that table holds only human-confirmed rows (a few hundred, real
 * production scale) -- and only then looks up those specific StemCIDs'
 * owning riffs/stem rows per jam. This is the inverse of the naive "walk
 * every Riffs row in the whole library" shape: the whole point of Discover
 * calling this once per slot's kind is that the confirmed set is tiny next
 * to a 50k+-stem library, so the per-call cost should track the confirmed
 * set's size, not the library's (2026-09-15 code quality review, finding
 * 2). StemCategories is still read ONLY from ownDb, per the note above --
 * this inversion doesn't touch that.
 *
 * WIDENED (2026-09-15, direct request after real-world testing): confirmed-
 * only pools for a role Elling hasn't tagged much yet (e.g. only 1-2
 * confirmed "drums" stems) meant reroll kept landing the exact same stem
 * regardless of the chaos/safe slider -- there was nothing else to pick.
 * getMaskKindStemMasks widens the pool with Endlesss's own recorded
 * instrument category for each stem (a real bit traced from OUROVEON's own
 * source, not a guess -- instrumentMaskToSoundType's own doc comment) --
 * needs zero classifier math at query time.
 *
 * NARROWED (2026-09-18), then RE-WIDENED (2026-09-22): the background
 * classify scan's own precomputed guesses (StemAutoCategory) were dropped
 * for mask kinds in the Discover trait-based matching redesign, and are
 * back -- but ONLY for stems the Endlesss mask can't place (no mask, or
 * audio-in), per direct request (audio-in/mic stems never appeared under
 * drums/bass/lead). See getMaskKindStemMasks's own doc comment.
 *
 * SOUND SOURCE (2026-09-22): every pooled stem is filtered by its own
 * instrument mask (soundSourceMatchesFilter) before sampling -- a
 * confirmed stem the walk never passed has no known mask (undefined),
 * which counts as Endlesss, same semantics as everywhere else. */
async function getMaskDiscoverCandidates({
  ownDb,
  jams,
  kind,
  onlyOwnStems = false,
  targetUser,
  soundSource,
  artistStemCIDs,
  scope = {}
}: {
  ownDb: Database.Database
  jams: JamDbPair[]
  kind: DiscoverSlotKind
  onlyOwnStems?: boolean
  targetUser?: string
  soundSource: DiscoverSoundSourceFilter
  artistStemCIDs?: ReadonlySet<string>
  scope?: IndexScope
}): Promise<DiscoverCandidate[]> {
  // Human-confirmed StemCategories rows for this exact ArrangeRole still
  // win outright -- a real confirmation is trusted even over an ambiguous
  // or missing mask bit. Reuses the SAME ArrangeRole column StemCategories
  // has always had (untouched by this redesign) -- discoverSlotKindToArrangeRole
  // gives the identity mapping for the 3 mask kinds.
  //
  // No inner try/catch here (removed 2026-09-15, finding 1): StemCategories
  // on ownDb is guaranteed present by a real migration that runs on every
  // app start, same established convention as embeddingMatch.ts's own
  // getConfirmedEmbeddings. A real SQL error here (e.g. a typo) should
  // throw, not silently produce an empty Discover pool with no diagnostic
  // trail.
  const arrangeRole = discoverSlotKindToArrangeRole(kind)
  countWork('sql:discover.confirmed-role')
  const confirmedRows = ownDb
    .prepare(`SELECT StemCID, ArrangeRole, DrumSubRole FROM StemCategories WHERE ArrangeRole = ?`)
    .all(arrangeRole) as { StemCID: string; ArrangeRole: string; DrumSubRole: string | null }[]

  const categoryByStemCID = new Map(confirmedRows.map((row) => [row.StemCID, row]))
  // Every stem in categoryByStemCID at this point is human-confirmed.
  const sourceByStemCID = new Map<string, DiscoverKindSource>(
    confirmedRows.map((row) => [row.StemCID, 'confirmed'])
  )

  // Live mask match plus, for stems the mask can't place, the overnight
  // classifier's guess -- see getMaskKindStemMasks's own doc comment.
  const maskByStemCID = await getMaskKindStemMasks(ownDb, jams, kind, scope)
  for (const [stemCID, admission] of maskByStemCID) {
    // getMaskKindStemMasks only admits stems NOT confirmed for any role
    // (plus records masks for ones confirmed for THIS role, already
    // present), so this never overwrites a real human confirmation.
    if (categoryByStemCID.has(stemCID)) continue
    sourceByStemCID.set(stemCID, admission.source)
    categoryByStemCID.set(stemCID, {
      StemCID: stemCID,
      ArrangeRole: arrangeRole,
      DrumSubRole: null
    })
  }

  // The endlesss/non-endlesss source filter, applied by each stem's own mask
  // BEFORE sampling so the bounded sample isn't wasted on stems that would
  // be filtered out anyway.
  // Both filters run BEFORE sampling, so the bounded sample isn't spent on
  // stems that would be dropped anyway -- the endlesss/non-endlesss
  // source filter by each stem's own mask, and the "can this even be
  // downloaded" list (unavailableStems, above).
  const unavailable = unavailableStems(ownDb)
  const eligibleStemCIDs = [...categoryByStemCID.keys()].filter(
    (stemCID) =>
      (artistStemCIDs === undefined || artistStemCIDs.has(stemCID)) &&
      soundSourceMatchesFilter(maskByStemCID.get(stemCID)?.instrument, soundSource) &&
      stemIsUsable(stemCID, unavailable)
  )
  if (eligibleStemCIDs.length === 0) return []

  const confirmedStemCIDs = pickRandomSample(eligibleStemCIDs, MAX_CANDIDATE_RESOLUTION_POOL)
  const out: DiscoverCandidate[] = []

  // Real crash, found live via a full macOS crash report (EXC_BREAKPOINT in
  // sqlite3CodeRhsOfIN/sqlite3FindInIndex -- SQLite trapping while
  // COMPILING the query, not even running it yet): a query built with 8
  // `StemCID_N IN (...)` clauses (one per Riffs column) OR'd together,
  // each repeating the FULL placeholder list, produced `8 *
  // confirmedStemCIDs.length` bound parameters in a single statement --
  // once the widened pool grew into the thousands, that became too large
  // for SQLite to compile at all. CANDIDATE_QUERY_CHUNK_SIZE still bounds
  // the (now much smaller, Stems-only) query below at 200 placeholders,
  // same defense, cheap insurance even though it's no longer the same
  // 8-column query that originally needed it.
  //
  // FOURTH "stuck rolling" bug, found live at real scale (5,057 jams
  // sharing one external, READ-ONLY archive connection -- see
  // riffLibraryStore.ts's own getRiffLibraryDb, opened `readonly: true`
  // by deliberate design, so no index can ever be added there): grouping
  // by db connection, then dropping the redundant SQL-side jam filter
  // (both fixed earlier the same day) reduced the query COUNT by ~26x
  // with ZERO measured improvement -- still ~80 seconds, confirmed live,
  // unchanged. The dominant cost was never query count: it's SQLite
  // evaluating an unindexed 8-column `IN (...)` clause (up to 1,600
  // placeholders) against EVERY row of a genuinely huge table, EVERY
  // single roll. Confirmed by a real, live comparison on the exact same
  // library: getRandomLibraryCandidate (below), which touches the SAME
  // Riffs table but with no such WHERE clause, was reported "much
  // faster." Fixed by reading the WHOLE table ONCE per db connection with
  // NO WHERE clause at all (getRiffIndexForDb, above -- the cheapest
  // possible query shape, pure sequential scan, no per-row predicate) and
  // caching an in-memory StemCID -> riff index for several minutes --
  // every candidate lookup after the first becomes a plain JS Map.get(),
  // and the Stems table (PresetName/CreatorUserName) is now only queried
  // for the SMALL set of stems that actually matched, not the whole
  // candidate pool.
  const jamCIDsByDb = new Map<Database.Database, Set<string>>()
  for (const { jamCID, dbForJam } of jams) {
    const existing = jamCIDsByDb.get(dbForJam)
    if (existing) existing.add(jamCID)
    else jamCIDsByDb.set(dbForJam, new Set([jamCID]))
  }

  let sinceYield = 0

  const slice = newSlice()
  for (const [db, allowedJamCIDs] of jamCIDsByDb) {
    const riffIndex = await getRiffIndexForDb(db, scope)
    // In-memory lookups -- no SQL round trip for this part at all. Keeps
    // the "is this jam one we're allowed to include" filter (a jam
    // outside the caller's own `jams` list is still excluded, for the
    // rare case a future caller ever passes a genuine subset) as a cheap
    // Set.has() per candidate, same semantics the SQL-side version used
    // to enforce.
    const matchedStemCIDs = confirmedStemCIDs.filter((cid) => {
      const entry = riffIndex.get(cid)
      return entry !== undefined && allowedJamCIDs.has(entry.ownerJamCID)
    })
    if (matchedStemCIDs.length === 0) continue

    for (const stemCIDChunk of chunk(matchedStemCIDs, CANDIDATE_QUERY_CHUNK_SIZE)) {
      const stemPlaceholders = stemCIDChunk.map(() => '?').join(', ')

      let stemRows: { StemCID: string; PresetName: string | null; CreatorUserName: string | null }[]
      try {
        countWork('sql:discover.mask-pool-stems')
        stemRows = db
          .prepare(
            `SELECT StemCID, PresetName, CreatorUserName FROM Stems WHERE StemCID IN (${stemPlaceholders})`
          )
          .all(...stemCIDChunk) as typeof stemRows
      } catch {
        // Kept defensive, unlike StemCategories-on-ownDb above: `db` may
        // be an EXTERNAL file (a real synced LORE archive, or a
        // partial/corrupted one) whose lifecycle this app doesn't fully
        // control -- ownDb's migration guarantee doesn't extend to it.
        // Skips just this one chunk, not the whole db -- a later chunk
        // for the same db still gets a fair try.
        continue
      }
      const stemByCID = new Map(stemRows.map((row) => [row.StemCID, row]))

      for (const stemCID of stemCIDChunk) {
        // Always present -- stemCIDChunk is itself sliced from
        // matchedStemCIDs, which only ever contains ids the index above
        // already confirmed exist.
        const riffInfo = riffIndex.get(stemCID)!
        const category = categoryByStemCID.get(stemCID)
        if (!category) continue // this stem isn't confirmed for the requested role

        const stemRow = stemByCID.get(stemCID)
        if (!stemRow) continue // confirmed, but no resolvable Stems row (e.g. stale/orphaned data)

        if (onlyOwnStems && stemRow.CreatorUserName !== targetUser) continue

        out.push({
          stemCID,
          jamCID: riffInfo.ownerJamCID,
          riffCID: riffInfo.riffCID,
          presetName: stemRow.PresetName ?? '',
          creatorUserName: stemRow.CreatorUserName ?? '',
          slotKinds: [kind],
          drumSubRole: (category.DrumSubRole as DrumSubRole | null) ?? null,
          riffBpm: riffInfo.bpmRnd,
          traitValues: {},
          traitPercentiles: {},
          kindSources: { [kind as DiscoverMaskKind]: sourceByStemCID.get(stemCID) ?? 'confirmed' },
          riffCreationTime: riffInfo.creationTime
        })
      }

      // Real per-chunk SQL round trips, not cheap JS-only work like
      // CLASSIFY_YIELD_EVERY's own loop above -- a much smaller
      // threshold, so a library with many dbs/stem-chunks still yields
      // often enough to stay non-blocking.
      sinceYield += 1
      if (sinceYield >= RIFF_QUERY_YIELD_EVERY) {
        sinceYield = 0
        await yieldIfSliceSpent(slice)
      }
    }
  }

  return out
}

interface FeatureCandidateRow {
  StemCID: string
  FeaturesJSON: string
}

interface TraitSampledStem {
  stemCID: string
  traitValues: TraitValues
  traitFieldValues: TraitFieldValues
}

/** Distinct random integers in [0, n), `k` of them (k <= n), in uniformly
 * random ORDER. Floyd's algorithm picks the set in O(k), no n-sized scratch
 * array per roll, but its insertion order is biased (early insertions can
 * only come from [0, n-k+j]); downstream rankCandidates is a stable sort, so
 * ties at chaos 0 would favour early table rows. The result is therefore
 * Fisher-Yates shuffled with the same `random` source. */
export function sampleDistinctIndices(
  n: number,
  k: number,
  random: () => number = Math.random
): number[] {
  const picked = new Set<number>()
  for (let j = n - k; j < n; j++) {
    const t = Math.floor(random() * (j + 1))
    picked.add(picked.has(t) ? j : t)
  }
  const out = [...picked]
  for (let i = out.length - 1; i > 0; i--) {
    const r = Math.floor(random() * (i + 1))
    const tmp = out[i]
    out[i] = out[r]
    out[r] = tmp
  }
  return out
}

/** The trait-only pool's bounded random sample of stems with cached
 * features, with the requested trait values attached -- at most
 * MAX_CANDIDATE_RESOLUTION_POOL, before any sound-source/jam filtering
 * (same bound, same order of operations as ever).
 *
 * Background efficiency B1: sampled from the in-memory trait value table
 * (getTraitValueTable) when it's built and current -- no SQL page read, no
 * JSON parse. Otherwise the original path: a cheap COUNT + ONE random-
 * offset `ORDER BY StemCID LIMIT/OFFSET` page, parsed in JS (code review,
 * 2026-09-18) -- NOT `ORDER BY RANDOM() LIMIT`, which makes SQLite sort
 * EVERY row before LIMIT applies (the "one unbounded synchronous SQL
 * statement" freeze shape root-caused elsewhere in this file). A random
 * OFFSET into an `ORDER BY StemCID` scan (primary-key index) still gives
 * per-roll variety at a fraction of the cost. StemFeatureCache stores
 * features as one JSON blob (FeaturesJSON), not SQL columns, so there's no
 * SQL-level way to filter on a field without SQLite's JSON1 extension,
 * which nothing else in this codebase depends on. */
async function sampleTraitStems(
  ownDb: Database.Database,
  traitKinds: readonly DiscoverTraitKind[],
  artistStemCIDs?: ReadonlySet<string>
): Promise<TraitSampledStem[]> {
  if (artistStemCIDs !== undefined) {
    return sampleArtistTraitStems(ownDb, traitKinds, artistStemCIDs)
  }
  const table = getTraitValueTable(ownDb)
  if (table) {
    const indices = sampleDistinctIndices(
      table.size,
      Math.min(table.size, MAX_CANDIDATE_RESOLUTION_POOL)
    )
    return indices.map((row) => {
      const features = table.features(row)
      return {
        stemCID: table.stemCIDAt(row),
        traitValues: traitValuesFromFeatures(features, traitKinds),
        traitFieldValues: traitFieldValuesFromFeatures(features, traitKinds)
      }
    })
  }

  let total: number
  try {
    countWork('sql:discover.trait-pool-count')
    total = (ownDb.prepare(`SELECT COUNT(*) AS n FROM StemFeatureCache`).get() as { n: number }).n
  } catch {
    return []
  }
  if (total === 0) return []

  const offset =
    total > MAX_CANDIDATE_RESOLUTION_POOL
      ? Math.floor(Math.random() * (total - MAX_CANDIDATE_RESOLUTION_POOL))
      : 0
  let rows: FeatureCandidateRow[]
  try {
    countWork('sql:discover.trait-pool-page')
    rows = ownDb
      .prepare(
        `SELECT StemCID, FeaturesJSON FROM StemFeatureCache ORDER BY StemCID LIMIT ? OFFSET ?`
      )
      .all(MAX_CANDIDATE_RESOLUTION_POOL, offset) as FeatureCandidateRow[]
  } catch {
    return []
  }
  countWork('parse:stem-features', rows.length)

  const sampled: TraitSampledStem[] = []
  let sinceYield = 0
  const slice = newSlice()
  for (const row of rows) {
    try {
      const features = JSON.parse(row.FeaturesJSON) as StemFeatures
      sampled.push({
        stemCID: row.StemCID,
        traitValues: traitValuesFromFeatures(features, traitKinds),
        traitFieldValues: traitFieldValuesFromFeatures(features, traitKinds)
      })
    } catch {
      // malformed row -- not a candidate
    }
    sinceYield += 1
    if (sinceYield >= CLASSIFY_YIELD_EVERY) {
      sinceYield = 0
      await yieldIfSliceSpent(slice)
    }
  }
  return sampled
}

/** Artist mode's trait sample: the artist's ANALYSED stems only (most other
 * artists are a few % analysed -- spec "Context"), at most
 * MAX_CANDIDATE_RESOLUTION_POOL of them, uniformly random. From the
 * in-memory value table when it is current (Map lookups, no SQL);
 * otherwise chunked primary-key lookups on StemFeatureCache over a
 * shuffled id list, stopping once the bound is reached. */
async function sampleArtistTraitStems(
  ownDb: Database.Database,
  traitKinds: readonly DiscoverTraitKind[],
  artistStemCIDs: ReadonlySet<string>
): Promise<TraitSampledStem[]> {
  if (artistStemCIDs.size === 0) return []
  const table = getTraitValueTable(ownDb)
  if (table) {
    const rows: number[] = []
    for (const stemCID of artistStemCIDs) {
      const row = table.rowOf(stemCID)
      if (row !== undefined) rows.push(row)
    }
    const picked = sampleDistinctIndices(
      rows.length,
      Math.min(rows.length, MAX_CANDIDATE_RESOLUTION_POOL)
    )
    return picked.map((i) => {
      const features = table.features(rows[i])
      return {
        stemCID: table.stemCIDAt(rows[i]),
        traitValues: traitValuesFromFeatures(features, traitKinds),
        traitFieldValues: traitFieldValuesFromFeatures(features, traitKinds)
      }
    })
  }

  const ids = [...artistStemCIDs]
  const shuffled = sampleDistinctIndices(ids.length, ids.length).map((i) => ids[i])
  const sampled: TraitSampledStem[] = []
  // Prepared once per placeholder count: every chunk but the last is full
  // size, so a call prepares at most two statements.
  const statements = new Map<number, Database.Statement>()
  const statementFor = (n: number): Database.Statement => {
    let stmt = statements.get(n)
    if (!stmt) {
      stmt = ownDb.prepare(
        `SELECT StemCID, FeaturesJSON FROM StemFeatureCache
         WHERE StemCID IN (${new Array(n).fill('?').join(', ')})`
      )
      statements.set(n, stmt)
    }
    return stmt
  }
  for (const idChunk of chunk(shuffled, CANDIDATE_QUERY_CHUNK_SIZE)) {
    if (sampled.length >= MAX_CANDIDATE_RESOLUTION_POOL) break
    let rows: FeatureCandidateRow[]
    try {
      countWork('sql:discover.artist-trait-page')
      rows = statementFor(idChunk.length).all(...idChunk) as FeatureCandidateRow[]
    } catch {
      return sampled
    }
    for (const row of rows) {
      try {
        const features = JSON.parse(row.FeaturesJSON) as StemFeatures
        sampled.push({
          stemCID: row.StemCID,
          traitValues: traitValuesFromFeatures(features, traitKinds),
          traitFieldValues: traitFieldValuesFromFeatures(features, traitKinds)
        })
      } catch {
        // malformed row -- not a candidate
      }
    }
    await yieldToEventLoop()
  }
  return sampled.slice(0, MAX_CANDIDATE_RESOLUTION_POOL)
}

type TraitStemRow = {
  StemCID: string
  Instrument: number | null
  OwnerJamCID: string
  PresetName: string | null
  CreatorUserName: string | null
}

/** Candidate pool for a TRAIT-ONLY kind set -- any stem with a cached
 * StemFeatureCache row (tagged or not, since combination slots, 2026-09-21),
 * narrowed by the sound-source filter, the caller's jams and onlyOwnStems.
 * Trait values for every requested kind come with the sample
 * (sampleTraitStems).
 *
 * Each sampled stem's own Stems row (mask, owning jam, preset, creator) is
 * read with chunked primary-key `IN (...)` lookups, grouped by DB
 * CONNECTION (never by jam -- that would reintroduce the "one query per
 * jam" bug getMaskKindStemMasks's own doc comment documents: 5,057 round
 * trips on a real library). A stem's Stems row can live in a different db
 * than ownDb's own StemFeatureCache (external LORE archive stems still get
 * their features cached in ownDb); when more than one db has an allowed row
 * for it, the LAST db in `jams` order wins, as it always has. Background
 * efficiency B1: this replaced a walk of every db's whole cached
 * instrument-row list (~367k rows on a real archive) on every roll, plus a
 * second Stems query for the survivors' metadata -- one lookup now serves
 * both. */
async function getTraitPoolCandidates({
  ownDb,
  jams,
  traitKinds,
  onlyOwnStems,
  targetUser,
  soundSource = { endlesss: true, audioIn: true },
  artistStemCIDs,
  scope = {}
}: {
  ownDb: Database.Database
  jams: JamDbPair[]
  traitKinds: readonly DiscoverTraitKind[]
  onlyOwnStems: boolean
  targetUser?: string
  soundSource?: DiscoverSoundSourceFilter
  artistStemCIDs?: ReadonlySet<string>
  scope?: IndexScope
}): Promise<DiscoverCandidate[]> {
  const allSampled = await sampleTraitStems(ownDb, traitKinds, artistStemCIDs)
  // Dropped before the per-db Stems lookups below, not after, so the
  // chunked IN (...) queries stay as small as the real pool.
  const unavailable = unavailableStems(ownDb)
  const sampled = allSampled.filter((s) => stemIsUsable(s.stemCID, unavailable))
  if (sampled.length === 0) return []

  const jamCIDsByDb = new Map<Database.Database, Set<string>>()
  for (const { jamCID, dbForJam } of jams) {
    const existing = jamCIDsByDb.get(dbForJam)
    if (existing) existing.add(jamCID)
    else jamCIDsByDb.set(dbForJam, new Set([jamCID]))
  }

  const stemByCID = new Map<string, { db: Database.Database; row: TraitStemRow }>()
  let sinceYield = 0
  const slice = newSlice()
  for (const [db, allowedJamCIDs] of jamCIDsByDb) {
    for (const cidChunk of chunk(
      sampled.map((s) => s.stemCID),
      CANDIDATE_QUERY_CHUNK_SIZE
    )) {
      const placeholders = cidChunk.map(() => '?').join(', ')
      let rows: TraitStemRow[]
      try {
        countWork('sql:discover.trait-pool-stems')
        rows = db
          .prepare(
            `SELECT StemCID, Instrument, OwnerJamCID, PresetName, CreatorUserName
             FROM Stems WHERE StemCID IN (${placeholders})`
          )
          .all(...cidChunk) as TraitStemRow[]
      } catch {
        // `db` may be an EXTERNAL file this app doesn't control -- skip
        // just this chunk, same as every other per-db query here.
        continue
      }
      // A stem in more than one db (the Shared Feed holds archive stems, and
      // since 2026-10-07 the own db's jams sit beside the archive's): the
      // first db's row, which is the archive's -- listJamsWithDb lists its
      // pairs first, as the mask pool's first-db-wins already assumes.
      for (const row of rows) {
        if (allowedJamCIDs.has(row.OwnerJamCID) && !stemByCID.has(row.StemCID)) {
          stemByCID.set(row.StemCID, { db, row })
        }
      }
      sinceYield += 1
      if (sinceYield >= RIFF_QUERY_YIELD_EVERY) {
        sinceYield = 0
        await yieldIfSliceSpent(slice)
      }
    }
  }

  const riffIndexByDb = new Map<Database.Database, Map<string, RiffIndexEntry>>()
  const result: DiscoverCandidate[] = []
  for (const entry of sampled) {
    const found = stemByCID.get(entry.stemCID)
    if (!found) continue // not among the caller's own jams
    // Direct request, 2026-09-21: "a way to only enable audio in or
    // microphone stems." A NULL Instrument counts as Endlesss, not audioIn
    // (soundSourceMatchesFilter's own doc comment).
    if (!soundSourceMatchesFilter(found.row.Instrument, soundSource)) continue
    let riffIndex = riffIndexByDb.get(found.db)
    if (!riffIndex) {
      riffIndex = await getRiffIndexForDb(found.db, scope)
      riffIndexByDb.set(found.db, riffIndex)
    }
    const riffInfo = riffIndex.get(entry.stemCID)
    if (!riffInfo) continue
    if (onlyOwnStems && found.row.CreatorUserName !== targetUser) continue

    result.push({
      stemCID: entry.stemCID,
      jamCID: riffInfo.ownerJamCID,
      riffCID: riffInfo.riffCID,
      presetName: found.row.PresetName ?? '',
      creatorUserName: found.row.CreatorUserName ?? '',
      slotKinds: [...traitKinds],
      drumSubRole: null,
      riffBpm: riffInfo.bpmRnd,
      traitValues: entry.traitValues,
      traitFieldValues: entry.traitFieldValues,
      traitPercentiles: {},
      kindSources: {},
      riffCreationTime: riffInfo.creationTime
    })
  }
  return result
}

// Random stem probes getRandomLibraryCandidate tries against the cached
// instrument-row index before falling back to one filtered pass.
const RANDOM_STEM_PROBES = 200

// How many random own-stem rows getRandomOwnStemCandidate pulls per db
// before picking the first usable one -- see its own doc comment. Small
// enough to stay one cheap query, large enough that a handful of
// unavailable or out-of-jam rows doesn't cost the whole roll.
const RANDOM_OWN_STEM_PAGE = 50

// The mic-bit condition SQL-side, tied directly to soundSourceMatchesFilter's
// own semantics (@shared/riffLibraryTypes): a stem counts as "audioIn" only
// when its Instrument mask has the mic bit (1<<4 = 16) set AND none of the
// drum/note/bass bits (1<<1 | 1<<2 | 1<<3 = 14) are set -- mirroring
// instrumentMaskToSoundType's own drum-then-note-then-bass-then-mic
// resolution order. A NULL Instrument (no confident mask at all) is
// excluded here (not audioIn), same as soundSourceMatchesFilter treating a
// null/undefined mask as Endlesss.
const AUDIO_IN_INSTRUMENT_SQL =
  '(Instrument IS NOT NULL AND (Instrument & 16) != 0 AND (Instrument & 14) = 0)'

/** A SQL fragment (ANDed onto a query against a table with an `Instrument`
 * column) implementing soundSourceMatchesFilter's own semantics
 * (@shared/riffLibraryTypes) directly in SQL, for a caller that needs to
 * filter the DB query itself rather than post-filter a single already-
 * picked row -- see getRandomLibraryCandidate/getRandomOwnStemCandidate's
 * own doc comments for why post-filtering one random pick doesn't work
 * here (an audioIn-only filter would almost always come back empty after
 * a bounded number of jam/db attempts, since audioIn stems are a small
 * minority of a real library). Returns null when `soundSource` doesn't
 * need any filtering at all (both flags true, the default) -- callers skip
 * adding a WHERE clause entirely in that case rather than appending a
 * trivial always-true condition. Callers are expected to have already
 * handled the both-false case (return null / empty, no query at all)
 * before calling this. */
function soundSourceSqlFragment(soundSource: DiscoverSoundSourceFilter): string | null {
  if (soundSource.endlesss && soundSource.audioIn) return null
  return soundSource.audioIn ? AUDIO_IN_INSTRUMENT_SQL : `NOT ${AUDIO_IN_INSTRUMENT_SQL}`
}

/** Direct request, 2026-09-15: "an option to just start with a completely
 * random stem of the user's from their library, then go from there" --
 * bypasses confirmed/embedding/instrument-MASK-KIND matching ENTIRELY, so
 * it works regardless of whether anything has been confirmed or scanned
 * yet (the exact "stuck at zero" case that prompted it). Labeled with the
 * CALLER's `kinds` (the slot's own normalized kind set) rather than
 * anything inferred -- this is a real, unclassified stem the user picks to
 * start from and can later confirm/replace via Tidy Up, not a claim that
 * it IS that role. `kinds` never filters here (that's the whole point of
 * this escape hatch) -- but `soundSource` still does (direct bug report,
 * 2026-09-21: "unticked endlesss, still got a random Endlesss stem" --
 * random rolls stay kind-agnostic by design, but they must still honor the
 * endlesss/audioIn source filter like every other roll).
 *
 * Samples random STEMS from the cached per-db instrument-row index (see
 * the comment at the top of the body for the 2026-09-22 bug that replaced
 * the old "try 15 random jams" approach), filtered by the allowed jams and
 * the source filter, and resolved through the cached riff index.
 *
 * Real bug, found live 2026-09-15 (root cause of "no match for this
 * role" on EVERY role, for a brand-new empty project, right after
 * DiscoverPanel.tsx started routing an empty project's first roll through
 * this function): with `onlyOwnStems` on, that same "try up to 15 random
 * JAMS" gamble becomes a near-guaranteed miss on a real library where the
 * user's own content lives in only a small fraction of all jams (Elling's
 * own library: 11 "own" jams out of 5,057 total synced -- a ~0.2% chance
 * per random jam pick, so 15 attempts essentially never hit one). Delegates
 * to getRandomOwnStemCandidate (below) instead when onlyOwnStems is on --
 * a targeted, still-fast search rather than an unbounded-odds lottery.
 * Returns null (never throws) if nothing turns up; the caller treats this
 * the same as "no match" from the other candidate sources. Also returns
 * null immediately when `soundSource` disables both flags -- there's
 * nothing left to draw from. */
export async function getRandomLibraryCandidate({
  ownDb,
  jams,
  kinds,
  onlyOwnStems = false,
  targetUser,
  soundSource = { endlesss: true, audioIn: true }
}: {
  /** sssketch's own writable db -- read only for the unavailable-stem list
   * (unavailableStems, above). Optional purely because this function's
   * other jobs don't need it; the real IPC caller always passes it, and
   * omitting it just means no availability filtering. */
  ownDb?: Database.Database
  jams: JamDbPair[]
  kinds: readonly DiscoverSlotKind[]
  onlyOwnStems?: boolean
  targetUser?: string
  soundSource?: DiscoverSoundSourceFilter
}): Promise<DiscoverCandidate | null> {
  if (!soundSource.endlesss && !soundSource.audioIn) return null

  const unavailable = unavailableStems(ownDb)
  if (onlyOwnStems && targetUser) {
    return getRandomOwnStemCandidate(jams, kinds, targetUser, soundSource, unavailable)
  }

  // Real bug, 2026-09-22 ("deselecting my sounds turns up no results"):
  // this used to try RANDOM_CANDIDATE_MAX_JAM_ATTEMPTS random JAMS and give
  // up -- but an external archive can list thousands of jams with only a
  // handful actually synced (Elling's: 5,056 listed, 42 with stems), so
  // ~88% of rolls missed. Now samples random STEMS from the per-db
  // instrument-row index (getInstrumentRowsForDb -- already cached and
  // prewarmed at startup, so no full-table SQL here), resolving each hit's
  // riff through the equally-cached riff index. A bounded number of random
  // probes covers the common case; a single filtered pass is the fallback
  // for a rare filter (e.g. "other sounds" only), so a match that exists is
  // never missed.
  const jamCIDsByDb = new Map<Database.Database, Set<string>>()
  for (const { jamCID, dbForJam } of jams) {
    const existing = jamCIDsByDb.get(dbForJam)
    if (existing) existing.add(jamCID)
    else jamCIDsByDb.set(dbForJam, new Set([jamCID]))
  }
  const pools: {
    db: Database.Database
    allowed: Set<string>
    rows: { StemCID: string; Instrument: number | null; OwnerJamCID: string }[]
    riffIndex: Map<string, RiffIndexEntry>
  }[] = []
  let totalRows = 0
  for (const [db, allowed] of jamCIDsByDb) {
    const rows = await getInstrumentRowsForDb(db)
    if (rows.length === 0) continue
    pools.push({ db, allowed, rows, riffIndex: await getRiffIndexForDb(db) })
    totalRows += rows.length
  }
  if (totalRows === 0) return null

  const eligible = (
    pool: (typeof pools)[number],
    row: (typeof pools)[number]['rows'][number]
  ): boolean =>
    pool.allowed.has(row.OwnerJamCID) &&
    soundSourceMatchesFilter(row.Instrument, soundSource) &&
    stemIsUsable(row.StemCID, unavailable) &&
    pool.riffIndex.has(row.StemCID)

  let hit: { pool: (typeof pools)[number]; stemCID: string } | null = null
  for (let attempt = 0; attempt < RANDOM_STEM_PROBES && !hit; attempt++) {
    let index = Math.floor(Math.random() * totalRows)
    for (const pool of pools) {
      if (index < pool.rows.length) {
        const row = pool.rows[index]
        if (eligible(pool, row)) hit = { pool, stemCID: row.StemCID }
        break
      }
      index -= pool.rows.length
    }
  }
  if (!hit) {
    const all: { pool: (typeof pools)[number]; stemCID: string }[] = []
    for (const pool of pools) {
      for (const row of pool.rows) if (eligible(pool, row)) all.push({ pool, stemCID: row.StemCID })
      await yieldToEventLoop()
    }
    if (all.length === 0) return null
    hit = all[Math.floor(Math.random() * all.length)]
  }

  const riff = hit.pool.riffIndex.get(hit.stemCID)
  if (!riff) return null
  let stemRow: { PresetName: string | null; CreatorUserName: string | null } | undefined
  try {
    stemRow = hit.pool.db
      .prepare(`SELECT PresetName, CreatorUserName FROM Stems WHERE StemCID = ?`)
      .get(hit.stemCID) as typeof stemRow
  } catch {
    return null
  }
  if (!stemRow) return null
  return {
    stemCID: hit.stemCID,
    jamCID: riff.ownerJamCID,
    riffCID: riff.riffCID,
    presetName: stemRow.PresetName ?? '',
    creatorUserName: stemRow.CreatorUserName ?? '',
    slotKinds: normalizeSlotKinds(kinds),
    traitValues: {},
    traitPercentiles: {},
    kindSources: {},
    drumSubRole: null,
    riffBpm: riff.bpmRnd,
    riffCreationTime: riff.creationTime
  }
}

/** getRandomLibraryCandidate's own onlyOwnStems path -- see that function's
 * doc comment for the real bug this fixes (random-JAM-then-hope essentially
 * never lands on one of the user's own jams when they're a small fraction
 * of the whole library). Groups jams by db CONNECTION (same
 * "listJamsWithDb pairs most jams with ONE shared db" pattern this file
 * already uses elsewhere -- riffLibraryStore.ts's own dbForJam), shuffles
 * the UNIQUE DBs (typically just one or two: the own-synced library plus,
 * optionally, one external LORE archive), and for each tries ONE targeted
 * query -- `WHERE CreatorUserName = ? ORDER BY RANDOM() LIMIT 1` -- rather
 * than gambling on random jam picks. Stops at the first db that actually
 * has a matching stem, so the common case (the user's own content lives in
 * their own small self-synced db) resolves in one fast query; only a setup
 * where NONE of the user's own stems live in whichever db is tried first
 * pays a second db's own query cost. `soundSource` is applied the same way
 * as getRandomLibraryCandidate's own jam-scoped query -- SQL-side
 * (soundSourceSqlFragment), not by post-filtering the single picked row. */
async function getRandomOwnStemCandidate(
  jams: JamDbPair[],
  kinds: readonly DiscoverSlotKind[],
  targetUser: string,
  soundSource: DiscoverSoundSourceFilter,
  unavailable: ReadonlySet<string>
): Promise<DiscoverCandidate | null> {
  const soundSourceFragment = soundSourceSqlFragment(soundSource)
  const jamCIDsByDb = new Map<Database.Database, Set<string>>()
  for (const { jamCID, dbForJam } of jams) {
    const existing = jamCIDsByDb.get(dbForJam)
    if (existing) existing.add(jamCID)
    else jamCIDsByDb.set(dbForJam, new Set([jamCID]))
  }
  const shuffledDbs = [...jamCIDsByDb].sort(() => Math.random() - 0.5)

  for (const [db, allowedJamCIDs] of shuffledDbs) {
    type OwnStemRow = {
      StemCID: string
      OwnerJamCID: string
      PresetName: string | null
      CreatorUserName: string | null
    }
    let stemRows: OwnStemRow[]
    try {
      // Real ids can, in principle, be shared across many rows for a given
      // CreatorUserName -- ORDER BY RANDOM() here means a genuinely random
      // pick among ALL of this user's own stems in this db, not just
      // whichever happens to sort first. A small PAGE of random rows
      // rather than exactly one (2026-09-22): the first pick can now be
      // rejected -- for a jam outside the caller's set, as always, and now
      // also for a stem whose audio can no longer be downloaded -- and
      // "one random row, take it or leave it" would turn every such
      // rejection into a whole missed roll.
      stemRows = db
        .prepare(
          `SELECT StemCID, OwnerJamCID, PresetName, CreatorUserName FROM Stems
           WHERE CreatorUserName = ?${soundSourceFragment ? ` AND ${soundSourceFragment}` : ''}
           ORDER BY RANDOM() LIMIT ${RANDOM_OWN_STEM_PAGE}`
        )
        .all(targetUser) as OwnStemRow[]
    } catch {
      // Same defensive handling as every other per-db query in this file --
      // an external db missing even a core table shouldn't abort the whole
      // attempt, just this one db.
      continue
    }
    // The matched row's own jam might not be in THIS caller's allowed set
    // (jams is caller-supplied, see this file's own module doc comment) --
    // skip rather than return a candidate the caller never asked to see.
    const stemRow = stemRows.find(
      (row) => allowedJamCIDs.has(row.OwnerJamCID) && stemIsUsable(row.StemCID, unavailable)
    )
    if (!stemRow) continue

    let riffRow: { RiffCID: string; BPMrnd: number; CreationTime: number | null } | undefined
    try {
      // The side table is part of the answer to "which riff contains this
      // stem", not an afterthought -- a kept group's twelfth stem is in no
      // column at all. Built conditionally because an external
      // OUROVEON/LORE archive has no such table.
      const extraClause = hasExtraStemSlotsTable(db)
        ? ` OR RiffCID IN (SELECT RiffCID FROM RiffStemsExtra WHERE StemCID = ?)`
        : ''
      const slotParams = Array<string>(extraClause ? 9 : 8).fill(stemRow.StemCID)
      riffRow = db
        .prepare(
          `SELECT RiffCID, BPMrnd, CreationTime FROM Riffs WHERE OwnerJamCID = ? AND (
             StemCID_1 = ? OR StemCID_2 = ? OR StemCID_3 = ? OR StemCID_4 = ? OR
             StemCID_5 = ? OR StemCID_6 = ? OR StemCID_7 = ? OR StemCID_8 = ?${extraClause}
           ) LIMIT 1`
        )
        .get(stemRow.OwnerJamCID, ...slotParams) as typeof riffRow
    } catch {
      continue
    }
    // Same "stale/orphaned Stems row" tolerance as getRandomLibraryCandidate
    // itself -- try the next db rather than returning an unplaceable candidate.
    if (!riffRow) continue

    return {
      stemCID: stemRow.StemCID,
      jamCID: stemRow.OwnerJamCID,
      riffCID: riffRow.RiffCID,
      presetName: stemRow.PresetName ?? '',
      creatorUserName: stemRow.CreatorUserName ?? '',
      slotKinds: normalizeSlotKinds(kinds),
      traitValues: {},
      traitPercentiles: {},
      kindSources: {},
      drumSubRole: null,
      riffBpm: riffRow.BPMrnd,
      riffCreationTime: riffRow.CreationTime
    }
  }
  return null
}

/** Forgets `db`'s in-memory riff index, so the next read walks it afresh.
 * For forgetDiscoveredRifff: a kept group folded in by
 * appendToInMemoryDiscoverCaches leaves no trace in the index's watermark,
 * so once its Riffs row is deleted an extension would find nothing to
 * read (count and watermark agree again) and keep its stems pointing at a
 * riff that is gone. Forgetting is rare and outside the roll/keep loop; one
 * walk of the own db is the honest price. */
export function dropInMemoryRiffIndex(db: Database.Database): void {
  riffIndexCache.delete(db)
  servedRiffIndex.delete(db)
  // A walk already running holds the pre-forget index: it must not install
  // it (or save its meta), and later callers must not wait on it.
  riffIndexForgets.set(db, riffIndexForgetGeneration(db) + 1)
  riffIndexInFlight.delete(db)
}

/** After a shared-feed fold (riffLibraryWriter.ts mergeSharedFeedCaseVariants)
 * renamed a jam in `db` in place: forgets `db`'s in-memory riff index and
 * instrument rows, which name each stem's jam, so the next read walks them
 * afresh (review of 0e27db79). As with a forget, the change check can't do it:
 * the rename moves no count or rowid, so an extension would read nothing and
 * keep serving the old name, which the jam list no longer has -- those stems
 * would drop out of Discover until a relaunch. The saved copies were renamed
 * in the fold's own transaction. Once per capitalised feed, ever. */
export function dropInMemoryJamIndexes(db: Database.Database): void {
  dropInMemoryRiffIndex(db)
  instrumentRowsCache.delete(db)
  servedInstrumentRows.delete(db)
  // A walk in flight may have read pages before the rename: its callers get
  // its rows, then they are forgotten too.
  const pending = instrumentRowsInFlight.get(db)
  if (pending) void pending.finally(() => instrumentRowsCache.delete(db)).catch(() => undefined)
}

/** Tests only: `db`'s in-memory instrument rows, or null when none. */
export function instrumentRowsInMemoryForTests(
  db: Database.Database
): readonly InstrumentRow[] | null {
  return instrumentRowsCache.get(db)?.rows ?? null
}

/** Folds one just-committed riff into the IN-MEMORY caches, instead of
 * letting the write invalidate them.
 *
 * discoverIndexCache.ts's appendRiffIndexRows/appendInstrumentRows handle
 * the persisted half (read at startup). This is the half that matters
 * during a session: riffIndexCache/instrumentRowsCache are re-validated by
 * isScanCacheCurrent against a live TableSignal at most every
 * CACHE_CHANGE_CHECK_INTERVAL_MS (30s), so without this a keep makes the
 * next roll within half a minute pay a full rebuild of the own db's index
 * -- exactly the roll/keep/roll loop this is for.
 *
 * MUST BE CALLED AFTER THE TRANSACTION COMMITS. It refreshes each cache's
 * stored signal by re-reading the table, which has to see the new counts;
 * called inside the transaction it would record a stale signal and the
 * very next check would invalidate anyway.
 *
 * A stem already in the index keeps whichever riff it was first seen in --
 * the same first-seen-wins rule buildRiffIndex uses. `instrumentRows`
 * should carry ONLY stems that genuinely got a new Stems row (the caller
 * knows which; this does no dedup of its own, deliberately, so a keep
 * never scans a 367k-row array). A db whose caches were never built is
 * left alone: there is nothing to keep current. */
export function appendToInMemoryDiscoverCaches(
  db: Database.Database,
  riffEntries: readonly { stemCID: string; entry: RiffIndexEntry }[],
  instrumentRows: readonly { StemCID: string; Instrument: number | null; OwnerJamCID: string }[]
): void {
  const now = Date.now()
  const riffCached = riffIndexCache.get(db)
  if (riffCached) {
    for (const { stemCID, entry } of riffEntries) {
      if (!riffCached.index.has(stemCID)) riffCached.index.set(stemCID, entry)
    }
    riffCached.state.signal = readTableSignal(db, 'Riffs')
    riffCached.state.checkedAt = now
  }
  const stemCached = instrumentRowsCache.get(db)
  if (stemCached) {
    for (const row of instrumentRows) stemCached.rows.push(row)
    stemCached.state.signal = readTableSignal(db, 'Stems')
    stemCached.state.checkedAt = now
  }
}
