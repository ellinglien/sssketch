// src/main/libraryScanWork.ts
//
// What the library scan has to look at (background scan audit 3; merge-
// background-scans plan b21ea5a2, Task 6): which locally downloaded library
// stems still need any analysis -- worked out from what needs work FIRST,
// and only then checked against the disk, asynchronously.
//
// Before, every DiscoverLibraryScan mount (each launch with consent) loaded
// all ~980k cached stem/jam pairs, resolved ~1M paths, listed ~2,000 folders
// with readdirSync (1,359 on the USB archive, up to 626 ms each cold, on the
// main thread), sent ~146k targets over IPC and asked needs for every one --
// almost all of which ends in "nothing to do" once the backfill is done --
// and read and warned about the 2,361 0-byte placeholders every session.
//
// Now, per source db (in `jams` order, grouped by connection -- jams share
// one db):
// 1. refresh the persisted pairs (scanTargetCache.ts: extend or rebuild);
// 2. never or partly analysed: the pairs whose StemCID lacks a peaks,
//    embedding or feature row, by SQL anti-join in ownDb, read in key
//    windows of `windowSize` pairs (default 2,000; each statement bounded, a
//    yield between. Measured read-only 2026-10-06 on Elling's ownDb with
//    windows of 5,000: 179 of them for the 894k external pairs, at most 23 ms
//    each -- the default's windows are smaller still);
// 3. analysed but needing work: stemCIDsNeedingRework (stemAnalysisNeeds.ts:
//    stale features or level from the trait value table's versions, and
//    zero-shot pending) -- those with all three rows, their pairs by IN-list;
// 4. the first allowed pair -- min (RiffCID, slot) among pairs whose jam is
//    in `jams` -- decides each stem's path, as listLibraryScanTargets'
//    first-seen rule always has; a stem with an allowed pair in an earlier db
//    is that db's (checked by IN-list against the earlier dbs' pairs);
// 5. existence: present by name in its folder (one async listing per folder,
//    2 at a time), and for a stem with no feature row a `stat` with size > 0
//    (8 at a time), so placeholders drop out. A stem with a feature row was
//    decoded before and is never stat-ed.
// A db the pair cache can't hold (in-memory, no rowid) is walked as
// listLibraryScanTargets walks it, with the same needs and existence steps.
//
// Exact against today's answer (listLibraryScanTargets, then needs, minus
// placeholders), up to order: the work list is in StemCID order per db, not
// RiffCID order (plan decision 6: processing order only). The only extra
// items possible are stems whose name is not a library stem name (contains
// `.`; none exist, measured) lacking an embedding -- the renderer still asks
// needs per page, so an extra costs one needs row, never a decode.
//
// Order (2026-10-06, Elling: own stems first): with `priority`, the list is
// then stably partitioned -- his own stems, his favourites, the rest
// (@shared/stemPriorityOrder; the sets from stemPriority.ts), each group in
// the order above. One pass over the finished list, no extra SQL here. The
// priority may arrive as a promise: it is read while the list is built, and
// only the final partition waits for it.
//
// Main-process rules: `.all()` per bounded statement, never `.iterate()`
// across an await; JS slices of at most 8 ms (yieldSlice); per-db SQL, never
// per jam.
import { stat as statAsync } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import type Database from 'better-sqlite3'
import { resolveStemPath } from './riffLibraryStore'
import {
  createAsyncDirListing,
  walkAllowedRiffStems,
  type LibraryScanTarget
} from './discoverLibraryStems'
import {
  readPairsForStemCIDs,
  refreshStemJamPairs,
  scanTargetSourceKey,
  type PositionedStemJamPair
} from './scanTargetCache'
import { stemCIDsNeedingRework, type YamnetAvailability } from './stemAnalysisNeeds'
import { awaitTraitQuantileBuild, prewarmTraitQuantileTables } from './traitQuantileCache'
import { countWork } from './workCounters'
import { orderByStemPriority, type StemPrioritySets } from '@shared/stemPriorityOrder'

interface JamDbPair {
  jamCID: string
  dbForJam: Database.Database
}

export interface LibraryScanWork {
  /** Locally present library stems that need at least one analysis. */
  work: LibraryScanTarget[]
  /** Present by name, never analysed, but 0 bytes: unfinished downloads. */
  placeholdersSkipped: number
}

export interface LibraryScanWorkOptions extends YamnetAvailability {
  /** Pairs per anti-join window (default 2000). */
  windowSize?: number
  readdirFn?: (dir: string) => Promise<string[]>
  statFn?: (path: string) => Promise<{ size: number; isFile(): boolean }>
  /** Own stems, then favourites, first (stemPriority.ts). Absent: the
   * order above. May still be on its way (main's first build takes seconds
   * on the USB archive): the listing runs meanwhile, and the order is
   * applied once both are done. One that fails leaves the order above. */
  priority?: StemPrioritySets | PromiseLike<StemPrioritySets | undefined>
}

const DEFAULT_WINDOW_SIZE = 2000
const ID_CHUNK = 500
const LISTING_CONCURRENCY = 2
const STAT_CONCURRENCY = 8
const YIELD_SLICE_BUDGET_MS = 8

/** A stem that needs work, with its deciding pair. */
interface Candidate {
  stemCID: string
  jamCID: string
  /** Has a StemFeatureCache row: decoded before, so never stat-ed. */
  hasFeatures: boolean
}

/** What an earlier db holds, for the cross-db rule. */
type EarlierDb =
  | { kind: 'cached'; key: string; allowed: ReadonlySet<string> }
  | { kind: 'walked'; decided: ReadonlySet<string> }

const MISSING_A_ROW = `(
  NOT EXISTS (SELECT 1 FROM StemPeaksCache p WHERE p.StemCID = t.StemCID)
  OR NOT EXISTS (SELECT 1 FROM StemEmbeddingCache e WHERE e.StemCID = t.StemCID)
  OR NOT EXISTS (SELECT 1 FROM StemFeatureCache f WHERE f.StemCID = t.StemCID))`

/** MISSING_A_ROW without the YAMNet model: an embedding row can never be
 * written, so its absence is not work (stemAnalysisNeeds.ts YamnetAvailability). */
const MISSING_A_ROW_NO_YAMNET = `(
  NOT EXISTS (SELECT 1 FROM StemPeaksCache p WHERE p.StemCID = t.StemCID)
  OR NOT EXISTS (SELECT 1 FROM StemFeatureCache f WHERE f.StemCID = t.StemCID))`

const WINDOW_COLUMNS = `t.StemCID AS StemCID, t.OwnerJamCID AS OwnerJamCID, t.RiffCID AS RiffCID,
  t.Slot AS Slot, EXISTS (SELECT 1 FROM StemFeatureCache f WHERE f.StemCID = t.StemCID) AS HasFeatures`

interface WindowRow {
  StemCID: string
  OwnerJamCID: string
  RiffCID: string
  Slot: number
  HasFeatures: number
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

/** The first allowed pair of one stem's pairs: min (RiffCID, slot) among
 * those whose jam is allowed. Undefined when none is. */
function firstAllowed(
  pairs: readonly PositionedStemJamPair[],
  allowed: ReadonlySet<string>
): PositionedStemJamPair | undefined {
  let best: PositionedStemJamPair | undefined
  for (const pair of pairs) {
    if (!allowed.has(pair.jamCID)) continue
    if (
      !best ||
      pair.riffCID < best.riffCID ||
      (pair.riffCID === best.riffCID && pair.slot < best.slot)
    ) {
      best = pair
    }
  }
  return best
}

/** Runs `fn` over `items`, at most `limit` at once. */
async function forEachLimited<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let next = 0
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++])
  })
  await Promise.all(lanes)
}

/** StemCIDs (of these) present in each of the three cache tables -- the
 * fully analysed-rows test, one IN-list per table per chunk, calling
 * `between` after each chunk (the caller's slice check). */
async function fullyRowed(
  ownDb: Database.Database,
  stemCIDs: readonly string[],
  between: () => Promise<void>,
  yamnetAvailable: boolean
): Promise<{
  all: Set<string>
  features: Set<string>
}> {
  const present = (table: string, chunk: readonly string[]): Set<string> => {
    try {
      const rows = ownDb
        .prepare(
          `SELECT StemCID FROM ${table} WHERE StemCID IN (${chunk.map(() => '?').join(',')})`
        )
        .all(...chunk) as { StemCID: string }[]
      return new Set(rows.map((r) => r.StemCID))
    } catch {
      return new Set()
    }
  }
  const all = new Set<string>()
  const features = new Set<string>()
  for (let i = 0; i < stemCIDs.length; i += ID_CHUNK) {
    const chunk = stemCIDs.slice(i, i + ID_CHUNK)
    countWork('sql:library-scan-work.rows')
    const peaks = present('StemPeaksCache', chunk)
    const embeddings = yamnetAvailable ? present('StemEmbeddingCache', chunk) : null
    const feats = present('StemFeatureCache', chunk)
    for (const cid of chunk) {
      if (feats.has(cid)) features.add(cid)
      if (peaks.has(cid) && (embeddings?.has(cid) ?? true) && feats.has(cid)) all.add(cid)
    }
    await between()
  }
  return { all, features }
}

/**
 * The library scan's work list: every locally present library stem (in an
 * allowed jam, by the first-allowed-pair path rule) that still needs at
 * least one analysis -- see the file header. `jams` comes from
 * listJamsWithDb; `ownDb` holds the analysis caches and the pair cache.
 */
export async function listLibraryScanWork(
  jams: readonly JamDbPair[],
  ownDb: Database.Database,
  options: LibraryScanWorkOptions = {}
): Promise<LibraryScanWork> {
  // Handled at once, so one that fails while the listing runs is never an
  // unhandled rejection.
  const priorityReady: Promise<StemPrioritySets | undefined> = Promise.resolve(
    options.priority
  ).then(
    (priority) => priority,
    (err: unknown) => {
      console.error('listLibraryScanWork: stem priority failed (unordered list):', err)
      return undefined
    }
  )
  const windowSize = Math.max(1, options.windowSize ?? DEFAULT_WINDOW_SIZE)
  const statFn = options.statFn ?? ((path: string) => statAsync(path))
  const listing = createAsyncDirListing({
    concurrency: LISTING_CONCURRENCY,
    readdirFn: options.readdirFn
  })
  const work: LibraryScanTarget[] = []
  let placeholdersSkipped = 0

  let sliceStart = Date.now()
  const sliceSpent = (): boolean => Date.now() - sliceStart >= YIELD_SLICE_BUDGET_MS
  async function yieldSlice(): Promise<void> {
    await yieldToEventLoop()
    sliceStart = Date.now() // after the await: see listLibraryScanTargets
  }

  // The analysed half (3): the value table's versions when it is current --
  // its first build (or one in flight) is the same parse the needs would
  // otherwise do, so wait for it rather than parse twice.
  await prewarmTraitQuantileTables(ownDb)
  await awaitTraitQuantileBuild(ownDb)
  const yamnetAvailable = options.yamnetAvailable !== false
  const missingARow = yamnetAvailable ? MISSING_A_ROW : MISSING_A_ROW_NO_YAMNET
  const rework = await stemCIDsNeedingRework(ownDb, { yamnetAvailable })
  // ...only those with all three rows: a stem missing one is the anti-join's.
  const maybeYield = async (): Promise<void> => {
    if (sliceSpent()) await yieldSlice()
  }
  const reworkAnalysed = [
    ...(await fullyRowed(ownDb, [...rework], maybeYield, yamnetAvailable)).all
  ].sort()
  countWork('library-scan-work.rework', reworkAnalysed.length)

  const earlier: EarlierDb[] = []

  /** Drops candidates an earlier db decides (it has an allowed pair). */
  function notDecidedEarlier(candidates: Candidate[]): Candidate[] {
    if (earlier.length === 0 || candidates.length === 0) return candidates
    const taken = new Set<string>()
    const ids = candidates.map((c) => c.stemCID)
    for (const db of earlier) {
      if (db.kind === 'walked') {
        for (const id of ids) if (db.decided.has(id)) taken.add(id)
        continue
      }
      for (const pair of readPairsForStemCIDs(ownDb, db.key, ids)) {
        if (db.allowed.has(pair.jamCID)) taken.add(pair.stemCID)
      }
    }
    return taken.size === 0 ? candidates : candidates.filter((c) => !taken.has(c.stemCID))
  }

  /** Steps 4-5 for a batch of decided candidates: earlier dbs, then the disk. */
  async function settle(batch: Candidate[]): Promise<void> {
    const candidates = notDecidedEarlier(batch)
    if (candidates.length === 0) return
    const byDir = new Map<string, { candidate: Candidate; path: string }[]>()
    for (const candidate of candidates) {
      const path = resolveStemPath(candidate.jamCID, candidate.stemCID)
      const dir = dirname(path)
      const list = byDir.get(dir)
      if (list) list.push({ candidate, path })
      else byDir.set(dir, [{ candidate, path }])
      if (sliceSpent()) await yieldSlice()
    }
    const present: { candidate: Candidate; path: string }[] = []
    await Promise.all(
      [...byDir].map(async ([dir, items]) => {
        const names = await listing.list(dir)
        if (!names) return
        for (const item of items) if (names.has(basename(item.path))) present.push(item)
      })
    )
    const unstatted = present.filter((p) => !p.candidate.hasFeatures)
    const usable = new Set<string>()
    await forEachLimited(unstatted, STAT_CONCURRENCY, async ({ candidate, path }) => {
      countWork('fs:stat.library-scan-work')
      try {
        const s = await statFn(path)
        if (s.isFile() && s.size > 0) usable.add(candidate.stemCID)
        else placeholdersSkipped += 1
      } catch {
        // gone since the listing: nothing to analyse
      }
    })
    // in the batch's (StemCID) order, whatever order the listings finished in
    const kept = new Set(
      present
        .filter((p) => p.candidate.hasFeatures || usable.has(p.candidate.stemCID))
        .map((p) => p.candidate.stemCID)
    )
    for (const candidate of candidates) {
      if (!kept.has(candidate.stemCID)) continue
      work.push({
        key: candidate.stemCID,
        path: resolveStemPath(candidate.jamCID, candidate.stemCID)
      })
    }
  }

  /** Step 2: the anti-join windows over one db's cached pairs. Pairs of a
   * stem come together (keyset on the PK, StemCID first); a stem whose pairs
   * straddle a window boundary is carried into the next window. */
  async function neverOrPartlyAnalysed(key: string, allowed: ReadonlySet<string>): Promise<void> {
    const boundary = ownDb.prepare(
      `SELECT StemCID, OwnerJamCID FROM DiscoverScanTargetCache
       WHERE SourceDbKey = ? AND (StemCID, OwnerJamCID) > (?, ?)
       ORDER BY StemCID, OwnerJamCID LIMIT 1 OFFSET ${windowSize - 1}`
    )
    const windowed = ownDb.prepare(
      `SELECT ${WINDOW_COLUMNS} FROM DiscoverScanTargetCache t
       WHERE t.SourceDbKey = ? AND (t.StemCID, t.OwnerJamCID) > (?, ?)
         AND (t.StemCID, t.OwnerJamCID) <= (?, ?) AND ${missingARow}
       ORDER BY t.StemCID, t.OwnerJamCID`
    )
    const lastWindow = ownDb.prepare(
      `SELECT ${WINDOW_COLUMNS} FROM DiscoverScanTargetCache t
       WHERE t.SourceDbKey = ? AND (t.StemCID, t.OwnerJamCID) > (?, ?) AND ${missingARow}
       ORDER BY t.StemCID, t.OwnerJamCID`
    )
    let after: [string, string] = ['', '']
    let carried: { pairs: PositionedStemJamPair[]; hasFeatures: boolean } | null = null
    for (;;) {
      const started = performance.now()
      const upper = boundary.get(key, after[0], after[1]) as
        { StemCID: string; OwnerJamCID: string } | undefined
      const rows = (
        upper
          ? windowed.all(key, after[0], after[1], upper.StemCID, upper.OwnerJamCID)
          : lastWindow.all(key, after[0], after[1])
      ) as WindowRow[]
      countWork('sql:library-scan-work.window')
      countWork('ms:library-scan-work.window', Math.round(performance.now() - started))
      countWork('library-scan-work.unanalysed-pairs', rows.length)

      const batch: Candidate[] = []
      const decide = (group: { pairs: PositionedStemJamPair[]; hasFeatures: boolean }): void => {
        const pair = firstAllowed(group.pairs, allowed)
        if (pair) {
          batch.push({ stemCID: pair.stemCID, jamCID: pair.jamCID, hasFeatures: group.hasFeatures })
        }
      }
      for (const row of rows) {
        const pair = {
          stemCID: row.StemCID,
          jamCID: row.OwnerJamCID,
          riffCID: row.RiffCID,
          slot: row.Slot
        }
        if (carried && carried.pairs[0].stemCID === row.StemCID) {
          carried.pairs.push(pair)
        } else {
          if (carried) decide(carried)
          carried = { pairs: [pair], hasFeatures: row.HasFeatures === 1 }
        }
      }
      // The last stem of a window may continue in the next one.
      if (!upper && carried) {
        decide(carried)
        carried = null
      }
      await settle(batch)
      if (!upper) return
      after = [upper.StemCID, upper.OwnerJamCID]
      await yieldSlice()
    }
  }

  /** Step 3: analysed stems that still need work, by IN-list. */
  async function analysedNeedingWork(key: string, allowed: ReadonlySet<string>): Promise<void> {
    for (let i = 0; i < reworkAnalysed.length; i += ID_CHUNK) {
      const ids = reworkAnalysed.slice(i, i + ID_CHUNK)
      const byStem = new Map<string, PositionedStemJamPair[]>()
      for (const pair of readPairsForStemCIDs(ownDb, key, ids)) {
        const list = byStem.get(pair.stemCID)
        if (list) list.push(pair)
        else byStem.set(pair.stemCID, [pair])
      }
      const batch: Candidate[] = []
      for (const id of ids) {
        const pairs = byStem.get(id)
        const pair = pairs && firstAllowed(pairs, allowed)
        if (pair) batch.push({ stemCID: id, jamCID: pair.jamCID, hasFeatures: true })
      }
      await settle(batch)
      await yieldSlice()
    }
  }

  /** A db the pair cache can't hold: walked as listLibraryScanTargets does,
   * then the same needs (rows + rework) and existence steps. */
  async function walked(db: Database.Database, allowed: ReadonlySet<string>): Promise<void> {
    countWork('library-scan-work.walked-db')
    const decided = new Map<string, string>()
    await walkAllowedRiffStems(
      db,
      allowed,
      (stemCID, jamCID) => {
        if (!decided.has(stemCID)) decided.set(stemCID, jamCID)
        return sliceSpent()
      },
      yieldSlice
    )
    const ids = [...decided.keys()].sort()
    for (let i = 0; i < ids.length; i += ID_CHUNK) {
      const chunk = ids.slice(i, i + ID_CHUNK)
      const rows = await fullyRowed(ownDb, chunk, maybeYield, yamnetAvailable)
      const batch: Candidate[] = []
      for (const id of chunk) {
        if (rows.all.has(id) && !rework.has(id)) continue // analysed, nothing to do
        batch.push({ stemCID: id, jamCID: decided.get(id)!, hasFeatures: rows.features.has(id) })
      }
      await settle(batch)
      await yieldSlice()
    }
    earlier.push({ kind: 'walked', decided: new Set(ids) })
  }

  const allowedByDb = new Map<Database.Database, Set<string>>()
  for (const { jamCID, dbForJam } of jams) {
    const existing = allowedByDb.get(dbForJam)
    if (existing) existing.add(jamCID)
    else allowedByDb.set(dbForJam, new Set([jamCID]))
  }

  for (const [db, allowed] of allowedByDb) {
    let cached = false
    try {
      cached = await refreshStemJamPairs(ownDb, db)
    } catch (err) {
      console.error('listLibraryScanWork: scan-target cache failed, walking instead:', err)
    }
    if (!cached) {
      await walked(db, allowed)
      continue
    }
    const key = scanTargetSourceKey(db)
    await neverOrPartlyAnalysed(key, allowed)
    await analysedNeedingWork(key, allowed)
    earlier.push({ kind: 'cached', key, allowed })
  }

  countWork('library-scan-work.work', work.length)
  countWork('library-scan-work.placeholders', placeholdersSkipped)
  const priority = await priorityReady
  if (!priority) return { work, placeholdersSkipped }
  const started = performance.now()
  const ordered = orderByStemPriority(work, (t) => t.key, priority)
  countWork('ms:library-scan-work.order', Math.round(performance.now() - started))
  return { work: ordered, placeholdersSkipped }
}
