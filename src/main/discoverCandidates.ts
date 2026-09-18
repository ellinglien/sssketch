// src/main/discoverCandidates.ts
import type Database from 'better-sqlite3'
import { SOUND_TYPE_TO_ARRANGE_ROLE, type ArrangeRole, type DrumSubRole } from '@shared/stemRole'
import { instrumentMaskToSoundType } from '@shared/riffLibraryTypes'
import { getAutoCategorizedStemCIDs } from './stemAutoCategoryStore'

/** One library-wide candidate for a Discover slot -- a stem that's EITHER
 * human-confirmed (StemCategories) for the requested ArrangeRole, or
 * PRE-classified as that role by the background "categorize the whole
 * library overnight" scan (StemAutoCategory -- stemAutoClassify.ts,
 * stemAutoClassifyScheduler.ts; direct request 2026-09-15, "why not just
 * do a prelim scan that pre-categorizes the stems"), or whose own Endlesss
 * instrument category maps to that role (getInstrumentMatchedStemCIDs,
 * below -- real ground truth requiring no prior confirmation OR
 * background scan at all).
 *
 * The embedding/centroid CLASSIFIERS themselves used to run HERE, at query
 * time, on every single roll -- moved out to the background scan (same
 * day, after repeated real reports that even cached/parallelized/
 * short-circuited runtime classification still made a cold roll slow).
 * This file now only ever reads their ALREADY-COMPUTED results via a
 * plain, fast SELECT (getAutoCategorizedStemCIDs) -- no classifier math at
 * query time at all. */
export interface DiscoverCandidate {
  stemCID: string
  jamCID: string
  riffCID: string
  presetName: string
  creatorUserName: string
  arrangeRole: ArrangeRole
  drumSubRole: DrumSubRole | null
  /** The OWNING RIFF's own BPM (Riffs.BPMrnd) -- the compatibility signal
   * this plan's own ranking (Task 3) actually scores against, since a
   * riff's BPM is always populated, unlike a stem's own (Stems.BPMrnd is
   * frequently null in real data -- LORE's own resolveRiff falls back to
   * the riff's BPM for exactly this reason, riffLibraryTypes.ts). */
  riffBpm: number
}

interface JamDbPair {
  jamCID: string
  dbForJam: Database.Database
}

/** One progress update from prewarmDiscoverCandidateCaches's own two-phase,
 * per-db scan (below) -- pushed to the renderer (main/index.ts) so
 * LibraryWarmupIndicator.tsx can show real numbers instead of a static
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
export interface PrewarmScanProgress {
  phase: 'riffIndex' | 'instrumentRows'
  dbIndex: number
  dbCount: number
  completed: number
  total: number
}

type PrewarmProgressCallback = (progress: PrewarmScanProgress) => void

// Both buildRiffIndex and getInstrumentRowsForDb are single-phase,
// single-db scans -- they don't know their own phase name or their
// dbIndex/dbCount context within the outer multi-db loop, so they report
// bare (completed, total) pairs; prewarmDiscoverCandidateCaches (below) is
// the one place that knows enough to wrap that into a full
// PrewarmScanProgress before forwarding to its own caller's onProgress.
type ScanProgressCallback = (completed: number, total: number) => void

interface RiffCandidateRow {
  RiffCID: string
  OwnerJamCID: string
  BPMrnd: number
  StemCID_1: string | null
  StemCID_2: string | null
  StemCID_3: string | null
  StemCID_4: string | null
  StemCID_5: string | null
  StemCID_6: string | null
  StemCID_7: string | null
  StemCID_8: string | null
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

// Direct request, 2026-09-18 ("ideally it would also show a progress bar
// or meter, or something telling details about what is happening and how
// long to expect"): rows-per-page for buildRiffIndex/getInstrumentRowsForDb's
// own table scans, below. Real report on the SAME day ("still
// hanging... 5 minutes") root-caused to these two functions each doing
// ONE single, un-chunked `SELECT * FROM <table>` -- entirely synchronous,
// no yield point reachable until the WHOLE fetch (372,297 rows on
// Elling's real external archive) finished, which blocked the single-
// threaded main process for that whole stretch (moving the caller to only
// start after the window shows, see main/index.ts's own fix, stopped this
// from blocking the WINDOW specifically, but the scan itself was still
// one giant synchronous chunk once it started). Paginating via LIMIT/
// OFFSET, yielding between pages, bounds any ONE synchronous fetch to
// roughly PREWARM_CHUNK_SIZE rows' worth of work, AND gives onProgress
// something real to report between chunks -- both problems share the same
// fix.
const PREWARM_CHUNK_SIZE = 5000

// Real crash, found live via a full macOS crash report: SQLite trapping
// (EXC_BREAKPOINT, inside sqlite3CodeRhsOfIN/sqlite3FindInIndex) while
// COMPILING a query whose `StemCID_N IN (...)` clauses (8 of them, OR'd
// together, each repeating the SAME placeholder list) had grown to
// `8 * confirmedStemCIDs.length` bound parameters -- once the widened
// pool (embedding-guessed + instrument-matched, on top of confirmed) grew
// into the thousands, that single statement became too large for SQLite
// to compile at all. See getDiscoverCandidates's own main loop, below,
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
const RIFF_INDEX_CACHE_TTL_MS = 5 * 60_000

export interface RiffIndexEntry {
  riffCID: string
  ownerJamCID: string
  bpmRnd: number
}

const riffIndexCache = new WeakMap<
  Database.Database,
  { index: Map<string, RiffIndexEntry>; computedAt: number }
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
// or failure) so a later call, after the TTL has expired, starts a fresh
// scan rather than reusing a long-finished promise forever.
const riffIndexInFlight = new WeakMap<Database.Database, Promise<Map<string, RiffIndexEntry>>>()

/** Every StemCID in `db`'s own Riffs table, mapped to its owning riff's
 * {RiffCID, OwnerJamCID, BPMrnd} -- built via ONE unfiltered `SELECT *`
 * (no per-row WHERE-clause evaluation at all, the cheapest possible shape
 * for a full scan), then cached in memory for RIFF_INDEX_CACHE_TTL_MS.
 * `db` may be the EXTERNAL, READ-ONLY LORE archive connection
 * (riffLibraryStore.ts's own getRiffLibraryDb, opened `readonly: true` by
 * deliberate design) -- no index can be added there, so this in-memory
 * cache is the only lever available to avoid re-paying a real, large
 * table scan's cost on every single roll. Concurrent callers for the same
 * `db` share one in-flight scan (riffIndexInFlight, above) rather than
 * each starting their own. */
export async function getRiffIndexForDb(
  db: Database.Database,
  onProgress?: ScanProgressCallback
): Promise<Map<string, RiffIndexEntry>> {
  const cached = riffIndexCache.get(db)
  if (cached && Date.now() - cached.computedAt < RIFF_INDEX_CACHE_TTL_MS) return cached.index

  const inFlight = riffIndexInFlight.get(db)
  if (inFlight) return inFlight

  const promise = buildRiffIndex(db, onProgress).finally(() => {
    riffIndexInFlight.delete(db)
  })
  riffIndexInFlight.set(db, promise)
  return promise
}

/** The actual scan, split out from getRiffIndexForDb itself so that
 * function's own cache/in-flight checks stay simple early-returns rather
 * than wrapping this whole body in an extra layer of indirection. A stem
 * that appears in more than one riff (shouldn't normally happen, but a
 * hand-edited or corrupted archive could) keeps whichever riff this scan
 * saw FIRST -- an arbitrary but stable, good-enough tiebreak for what's
 * fundamentally an edge case.
 *
 * Paginates via `ORDER BY RiffCID LIMIT/OFFSET` (PREWARM_CHUNK_SIZE rows
 * at a time, yielding between pages) rather than one single `SELECT *` --
 * see that constant's own doc comment for the real live incident this
 * fixes (a single un-chunked fetch of the whole table blocked the main
 * process, including window creation, for minutes on a large external
 * archive). The explicit ORDER BY (code review, 2026-09-18) matters
 * because `db` can be the app's OWN always-on riff-sync db, which DOES
 * receive concurrent writes/deletes from other IPC handlers while this
 * scan runs (the app stays usable during warmup, by design) -- LIMIT/
 * OFFSET with no stable ordering can silently skip a row that a
 * concurrent delete shifts backward across an already-consumed OFFSET
 * boundary. A cheap `SELECT COUNT(*)` upfront gives onProgress a real
 * `total` to report against from the very first page, rather than only
 * knowing the true total once the last page comes back short.
 *
 * Also yields WITHIN a page, not just between pages (code review,
 * 2026-09-18): a page can hold up to PREWARM_CHUNK_SIZE=5000 riffs, each
 * walking 8 stem slots -- up to 40,000 synchronous Map operations with no
 * yield point, well past CLASSIFY_YIELD_EVERY's own established "safe
 * cap for cheap JS-only work" threshold elsewhere in this file. Reuses
 * that same constant so both loops share one definition of "too much
 * synchronous work without yielding." */
async function buildRiffIndex(
  db: Database.Database,
  onProgress?: ScanProgressCallback
): Promise<Map<string, RiffIndexEntry>> {
  const index = new Map<string, RiffIndexEntry>()
  let total: number
  try {
    total = (db.prepare(`SELECT COUNT(*) AS n FROM Riffs`).get() as { n: number }).n
  } catch {
    // Same defensive handling as the page-fetch loop below -- `db` may be
    // an external file missing even a core table. Cache the empty result
    // so a broken db doesn't retry this same expensive-to-fail scan on
    // every call within the TTL window.
    riffIndexCache.set(db, { index, computedAt: Date.now() })
    return index
  }

  let offset = 0
  while (offset < total) {
    let page: RiffCandidateRow[]
    try {
      page = db
        .prepare(
          `SELECT RiffCID, OwnerJamCID, BPMrnd,
                  StemCID_1, StemCID_2, StemCID_3, StemCID_4,
                  StemCID_5, StemCID_6, StemCID_7, StemCID_8
           FROM Riffs ORDER BY RiffCID LIMIT ? OFFSET ?`
        )
        .all(PREWARM_CHUNK_SIZE, offset) as RiffCandidateRow[]
    } catch {
      break
    }
    if (page.length === 0) break

    let sinceYield = 0
    for (const riff of page) {
      for (let slot = 1; slot <= 8; slot++) {
        const stemCID = riff[`StemCID_${slot}` as keyof RiffCandidateRow] as string | null
        if (!stemCID || index.has(stemCID)) continue
        index.set(stemCID, {
          riffCID: riff.RiffCID,
          ownerJamCID: riff.OwnerJamCID,
          bpmRnd: riff.BPMrnd
        })
      }
      sinceYield += 1
      if (sinceYield >= CLASSIFY_YIELD_EVERY) {
        sinceYield = 0
        await yieldToEventLoop()
      }
    }

    offset += page.length
    onProgress?.(offset, total)
    if (page.length < PREWARM_CHUNK_SIZE) break
    await yieldToEventLoop()
  }

  riffIndexCache.set(db, { index, computedAt: Date.now() })
  return index
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
 * it must never be allowed to affect app startup's own success. */
export async function prewarmDiscoverCandidateCaches(
  jams: JamDbPair[],
  onProgress?: PrewarmProgressCallback
): Promise<void> {
  const uniqueDbs = [...new Set(jams.map((j) => j.dbForJam))]
  for (let dbIndex = 0; dbIndex < uniqueDbs.length; dbIndex++) {
    const db = uniqueDbs[dbIndex]
    try {
      await getRiffIndexForDb(db, (completed, total) =>
        onProgress?.({
          phase: 'riffIndex',
          dbIndex,
          dbCount: uniqueDbs.length,
          completed,
          total
        })
      )
    } catch (err) {
      console.error('prewarmDiscoverCandidateCaches: failed to warm riff index:', err)
    }
    // Real perf bug, found live 2026-09-15 (see getInstrumentRowsForDb's
    // own doc comment): this only ever warmed the riff index, never the
    // instrument-matched scan's own cache (a SEPARATE, similarly-expensive
    // full Stems table scan against the same external archive) -- meaning
    // even with a fully warm riff index, the FIRST roll of the FIRST role
    // any given session still paid that second cold scan itself, on the
    // user's own critical path. Warmed here too now, same fire-and-forget/
    // never-block-startup discipline as the riff index above -- no
    // try/catch needed, getInstrumentRowsForDb already swallows its own
    // errors internally (an empty cached result, never a throw).
    await getInstrumentRowsForDb(db, (completed, total) =>
      onProgress?.({
        phase: 'instrumentRows',
        dbIndex,
        dbCount: uniqueDbs.length,
        completed,
        total
      })
    )
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

// TTL cache for getInstrumentRowsForDb, below -- a real library's worth of
// jams x stems walked fresh on EVERY roll click with no cache at all took
// minutes (confirmed live). Keyed by db INSTANCE (WeakMap, not a flat
// cache) specifically so tests using fresh in-memory dbs don't pollute
// each other -- same pattern this file used for the now-retired embedding/
// centroid caches before they moved to the background scan. Shares
// RIFF_INDEX_CACHE_TTL_MS's own 5-minute window (not the original 60s this
// used to carry) now that the cached unit is the raw table scan rather
// than one role's already-filtered result -- see this cache's own real
// perf bug, fixed 2026-09-15 below.
const instrumentRowsCache = new WeakMap<
  Database.Database,
  {
    rows: { StemCID: string; Instrument: number | null; OwnerJamCID: string }[]
    computedAt: number
  }
>()

/** The whole `Stems` table's own StemCID/Instrument/OwnerJamCID columns for
 * `db`, cached in memory -- the expensive, disk-bound part of
 * getInstrumentMatchedStemCIDs (below), split out on its own so it can be
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
 * getInstrumentMatchedStemCIDs, measured at ~50ms even for 367k rows) means
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
  onProgress?: ScanProgressCallback
): Promise<{ StemCID: string; Instrument: number | null; OwnerJamCID: string }[]> {
  const cached = instrumentRowsCache.get(db)
  if (cached && Date.now() - cached.computedAt < RIFF_INDEX_CACHE_TTL_MS) return cached.rows

  type Row = { StemCID: string; Instrument: number | null; OwnerJamCID: string }
  const rows: Row[] = []
  let total: number
  try {
    total = (db.prepare(`SELECT COUNT(*) AS n FROM Stems`).get() as { n: number }).n
  } catch {
    // Same defensive handling as every other per-db query in this file --
    // an external db missing even a core table shouldn't abort the whole
    // multi-db scan. Cache the empty result so a broken db doesn't retry
    // this same expensive-to-fail scan on every call within the TTL.
    instrumentRowsCache.set(db, { rows, computedAt: Date.now() })
    return rows
  }

  // Same PREWARM_CHUNK_SIZE/LIMIT-OFFSET pagination as buildRiffIndex, and
  // for the identical reason -- see PREWARM_CHUNK_SIZE's own doc comment.
  let offset = 0
  while (offset < total) {
    let page: Row[]
    try {
      page = db
        .prepare(
          `SELECT StemCID, Instrument, OwnerJamCID FROM Stems ORDER BY StemCID LIMIT ? OFFSET ?`
        )
        .all(PREWARM_CHUNK_SIZE, offset) as Row[]
    } catch {
      break
    }
    if (page.length === 0) break

    rows.push(...page)
    offset += page.length
    onProgress?.(offset, total)
    if (page.length < PREWARM_CHUNK_SIZE) break
    await yieldToEventLoop()
  }

  instrumentRowsCache.set(db, { rows, computedAt: Date.now() })
  return rows
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

/** Every StemCID, across the given jams, that isn't confirmed
 * (StemCategories) for ANY ArrangeRole -- not just the one being queried,
 * so a real human confirmation always wins over a raw instrument-bit
 * match -- but whose own Endlesss instrument category (Stems.Instrument,
 * a bitmask -- instrumentMaskToSoundType) maps to `arrangeRole` via
 * SOUND_TYPE_TO_ARRANGE_ROLE. Direct request, 2026-09-15: "can't we train
 * it with some basic data before handing it to someone?" -- this needs NO
 * prior confirmation and no background scan at all: instrument category
 * is real ground truth Endlesss itself recorded at jam time (see
 * instrumentMaskToSoundType's own doc comment -- "traced directly from
 * OUROVEON's own source, not guessed"), present on every synced stem the
 * moment it syncs. This is the SAME mapping resolveStemRole (stemRole.ts)
 * already uses as its own default/fallback arrangeRole for any stem
 * without a confirmed busId -- reusing it here for Discover's candidate
 * pool is consistent with that established precedent, not new risk. Stays
 * a LIVE query (unlike the embedding/centroid classifiers, moved out to a
 * background scan the same day) since it's already cheap: a bitmask
 * check, no classifier math, no external store to load.
 *
 * Reads each jam's own `Stems` table directly (not ownDb) for the
 * Instrument values themselves -- a stem's Instrument lives wherever its
 * Riffs/Stems rows do, same as the main per-jam loop below. `.all()`, not
 * `.iterate()`, for the "never leave a statement open across an await"
 * discipline this whole file follows after a real live crash (a
 * `.iterate()`-across-an-await once threw "This database connection is
 * busy executing a query" against a concurrent background-sync
 * transaction). Yields periodically since many-rows-is-real-synchronous-
 * work regardless of how cheap each individual check is.
 *
 * The raw per-db table scan is cached (getInstrumentRowsForDb, above) --
 * this function itself does NO SQL of its own beyond that and the small
 * ownDb StemCategories exclusion query, just an in-memory filter, so it's
 * cheap enough to run fresh on every call regardless of role or TTL. Real
 * perf bug, fixed 2026-09-15 (see getInstrumentRowsForDb's own doc comment
 * for the full story, found live via Elling's own question: "if 15,054
 * drum stems have been analyzed, why does it take 38 seconds on first
 * load?"): this used to cache its OWN already-filtered per-role result,
 * which meant the expensive raw scan above was re-run in full for every
 * role not yet individually cached -- rolling 'drums' then 'bass' paid the
 * same multi-second external-archive scan twice for identical rows.
 *
 * Also fixed the same day as a second, earlier perf bug (root cause of
 * "still slow, 10-12 seconds" on every role change or TTL expiry,
 * confirmed live on Elling's own 5,057-jam library): this function used to
 * query each jam's own Stems table separately (`WHERE OwnerJamCID = ?`),
 * one query PER JAM -- 5,057 separate round trips. Fixed the SAME way the
 * main candidate-resolution loop already was: group jams by db CONNECTION
 * (most share one, riffLibraryStore.ts's own dbForJam) and read each db's
 * Stems table ONCE (now via the shared getInstrumentRowsForDb cache),
 * filtering "is this jam one we're allowed to include" in JS
 * (allowedJamCIDs, below) instead of in SQL -- collapses O(jams) round
 * trips to O(uniqueDbs). */
async function getInstrumentMatchedStemCIDs(
  ownDb: Database.Database,
  jams: JamDbPair[],
  arrangeRole: ArrangeRole
): Promise<Set<string>> {
  const confirmedAnyRole = new Set(
    (
      ownDb.prepare(`SELECT StemCID FROM StemCategories WHERE ArrangeRole IS NOT NULL`).all() as {
        StemCID: string
      }[]
    ).map((r) => r.StemCID)
  )

  const jamCIDsByDb = new Map<Database.Database, Set<string>>()
  for (const { jamCID, dbForJam } of jams) {
    const existing = jamCIDsByDb.get(dbForJam)
    if (existing) existing.add(jamCID)
    else jamCIDsByDb.set(dbForJam, new Set([jamCID]))
  }

  const matched = new Set<string>()
  let sinceYield = 0
  for (const [db, allowedJamCIDs] of jamCIDsByDb) {
    const rows = await getInstrumentRowsForDb(db)
    for (const row of rows) {
      if (
        allowedJamCIDs.has(row.OwnerJamCID) &&
        row.Instrument !== null &&
        !confirmedAnyRole.has(row.StemCID) &&
        !matched.has(row.StemCID)
      ) {
        const soundType = instrumentMaskToSoundType(row.Instrument)
        if (soundType && SOUND_TYPE_TO_ARRANGE_ROLE[soundType] === arrangeRole) {
          matched.add(row.StemCID)
        }
      }
      sinceYield += 1
      if (sinceYield >= CLASSIFY_YIELD_EVERY) {
        sinceYield = 0
        await yieldToEventLoop()
      }
    }
  }
  return matched
}

/** Every stem, library-wide, already confirmed to the given ArrangeRole --
 * the data source Discover's own reroll (Task 3) samples from.
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
 * calling this once per slot's role is that the confirmed set is tiny next
 * to a 50k+-stem library, so the per-call cost should track the confirmed
 * set's size, not the library's (2026-09-15 code quality review, finding
 * 2). StemCategories is still read ONLY from ownDb, per the note above --
 * this inversion doesn't touch that.
 *
 * WIDENED (2026-09-15, direct request after real-world testing): confirmed-
 * only pools for a role Elling hasn't tagged much yet (e.g. only 1-2
 * confirmed "drums" stems) meant reroll kept landing the exact same stem
 * regardless of the chaos/safe slider -- there was nothing else to pick.
 * Two more sources now widen the pool: getAutoCategorizedStemCIDs reads
 * the background classify scan's own PRECOMPUTED results
 * (StemAutoCategory -- embedding or centroid classification, run once per
 * stem in the background, never at query time -- see
 * stemAutoClassify.ts), and getInstrumentMatchedStemCIDs reads Endlesss's
 * own recorded instrument category for each stem (a real bit traced from
 * OUROVEON's own source, not a guess -- instrumentMaskToSoundType's own
 * doc comment), mapped onto ArrangeRole via the exact same
 * SOUND_TYPE_TO_ARRANGE_ROLE table resolveStemRole (stemRole.ts) already
 * uses as its own default guess elsewhere in this app. Both need zero
 * classifier math at query time -- the whole reroll-was-slow saga earlier
 * the same day was BECAUSE the embedding/centroid classifiers used to run
 * live, right here, on every single roll. */
export async function getDiscoverCandidates({
  ownDb,
  jams,
  arrangeRole,
  onlyOwnStems = false,
  targetUser
}: {
  ownDb: Database.Database
  jams: JamDbPair[]
  arrangeRole: ArrangeRole
  onlyOwnStems?: boolean
  targetUser?: string
}): Promise<DiscoverCandidate[]> {
  // No inner try/catch here (removed 2026-09-15, finding 1): StemCategories
  // on ownDb is guaranteed present by a real migration that runs on every
  // app start, same established convention as embeddingMatch.ts's own
  // getConfirmedEmbeddings. A real SQL error here (e.g. a typo) should
  // throw, not silently produce an empty Discover pool with no diagnostic
  // trail.
  const confirmedRows = ownDb
    .prepare(`SELECT StemCID, ArrangeRole, DrumSubRole FROM StemCategories WHERE ArrangeRole = ?`)
    .all(arrangeRole) as { StemCID: string; ArrangeRole: string; DrumSubRole: string | null }[]

  const categoryByStemCID = new Map(confirmedRows.map((row) => [row.StemCID, row]))

  // Plain, fast SELECT against the background scan's own precomputed
  // results (stemAutoClassify.ts) -- no classifier math at query time at
  // all. Guarded against confirmedAnyRole, NOT just `!categoryByStemCID.has`
  // (a bug caught in review before this shipped): StemAutoCategory can go
  // stale relative to a LATER human confirmation of the same stem for a
  // DIFFERENT role (the classify scan only checks "confirmed for any role"
  // at WRITE time, not on every future read) -- if this only checked
  // categoryByStemCID (built from StemCategories WHERE ArrangeRole = THIS
  // role), a stem confirmed 'bass' with a stale StemAutoCategory row still
  // saying 'drums' would leak into the 'drums' pool. Same cross-role-
  // leakage guard getInstrumentMatchedStemCIDs already uses, below.
  const confirmedAnyRole = new Set(
    (
      ownDb.prepare(`SELECT StemCID FROM StemCategories WHERE ArrangeRole IS NOT NULL`).all() as {
        StemCID: string
      }[]
    ).map((r) => r.StemCID)
  )
  for (const stemCID of getAutoCategorizedStemCIDs(ownDb, arrangeRole)) {
    if (!confirmedAnyRole.has(stemCID)) {
      categoryByStemCID.set(stemCID, {
        StemCID: stemCID,
        ArrangeRole: arrangeRole,
        DrumSubRole: null
      })
    }
  }

  // Also live (not precomputed): cheap enough (a bitmask check, no
  // classifier) that persisting it wouldn't save anything worth the extra
  // moving part.
  const instrumentMatchedStemCIDs = await getInstrumentMatchedStemCIDs(ownDb, jams, arrangeRole)
  for (const stemCID of instrumentMatchedStemCIDs) {
    // getInstrumentMatchedStemCIDs already excludes anything confirmed for
    // ANY role (its own doc comment), so this can never overwrite a real
    // human confirmation.
    categoryByStemCID.set(stemCID, {
      StemCID: stemCID,
      ArrangeRole: arrangeRole,
      DrumSubRole: null
    })
  }

  if (categoryByStemCID.size === 0) return []

  const confirmedStemCIDs = pickRandomSample(
    [...categoryByStemCID.keys()],
    MAX_CANDIDATE_RESOLUTION_POOL
  )
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
  for (const [db, allowedJamCIDs] of jamCIDsByDb) {
    const riffIndex = await getRiffIndexForDb(db)
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
          arrangeRole: category.ArrangeRole as ArrangeRole,
          drumSubRole: (category.DrumSubRole as DrumSubRole | null) ?? null,
          riffBpm: riffInfo.bpmRnd
        })
      }

      // Real per-chunk SQL round trips, not cheap JS-only work like
      // CLASSIFY_YIELD_EVERY's own loop above -- a much smaller
      // threshold, so a library with many dbs/stem-chunks still yields
      // often enough to stay non-blocking.
      sinceYield += 1
      if (sinceYield >= RIFF_QUERY_YIELD_EVERY) {
        sinceYield = 0
        await yieldToEventLoop()
      }
    }
  }

  return out
}

// How many jams to try, at most, before giving up and returning null --
// bounds the cost regardless of library size (see getRandomLibraryCandidate
// below's own doc comment for why trying jams one at a time, rather than
// one query over the whole library, is the deliberate design here).
const RANDOM_CANDIDATE_MAX_JAM_ATTEMPTS = 15

/** Direct request, 2026-09-15: "an option to just start with a completely
 * random stem of the user's from their library, then go from there" --
 * bypasses confirmed/embedding/instrument matching ENTIRELY, so it works
 * regardless of whether anything has been confirmed or scanned yet (the
 * exact "stuck at zero" case that prompted it). Labeled with the CALLER's
 * `arrangeRole` (the slot's own role) rather than anything inferred --
 * this is a real, unclassified stem the user picks to start from and can
 * later confirm/replace via Tidy Up, not a claim that it IS that role.
 *
 * Picks a RANDOM JAM first (not `ORDER BY RANDOM() LIMIT 1` over every
 * jam's Stems table unioned together), then a random stem WITHIN that one
 * jam -- scanning every jam's own table to pick one random row across the
 * whole library would cost as much as the exact full-library scan this
 * feature exists to avoid waiting on. Tries up to
 * RANDOM_CANDIDATE_MAX_JAM_ATTEMPTS different jams (shuffled) before
 * giving up, since a single jam might have no stems at all (rare) -- an
 * acceptable, bounded gamble for the UNFILTERED case, where nearly every
 * jam has SOME stem to offer.
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
 * the same as "no match" from the other candidate sources. */
export async function getRandomLibraryCandidate({
  jams,
  arrangeRole,
  onlyOwnStems = false,
  targetUser
}: {
  jams: JamDbPair[]
  arrangeRole: ArrangeRole
  onlyOwnStems?: boolean
  targetUser?: string
}): Promise<DiscoverCandidate | null> {
  if (onlyOwnStems && targetUser) {
    return getRandomOwnStemCandidate(jams, arrangeRole, targetUser)
  }

  const shuffled = [...jams]
    .sort(() => Math.random() - 0.5)
    .slice(0, RANDOM_CANDIDATE_MAX_JAM_ATTEMPTS)

  for (const { jamCID, dbForJam } of shuffled) {
    let stemRow:
      { StemCID: string; PresetName: string | null; CreatorUserName: string | null } | undefined
    try {
      stemRow = dbForJam
        .prepare(
          `SELECT StemCID, PresetName, CreatorUserName FROM Stems
           WHERE OwnerJamCID = ? ORDER BY RANDOM() LIMIT 1`
        )
        .get(jamCID) as typeof stemRow
    } catch {
      // Same defensive handling as every other per-jam query in this file
      // -- an external jam db missing even a core table shouldn't abort
      // the whole attempt, just this one jam.
      continue
    }
    if (!stemRow) continue

    let riffRow: { RiffCID: string; BPMrnd: number } | undefined
    try {
      riffRow = dbForJam
        .prepare(
          `SELECT RiffCID, BPMrnd FROM Riffs WHERE OwnerJamCID = ? AND (
             StemCID_1 = ? OR StemCID_2 = ? OR StemCID_3 = ? OR StemCID_4 = ? OR
             StemCID_5 = ? OR StemCID_6 = ? OR StemCID_7 = ? OR StemCID_8 = ?
           ) LIMIT 1`
        )
        .get(jamCID, ...Array<string>(8).fill(stemRow.StemCID)) as typeof riffRow
    } catch {
      continue
    }
    // A Stems row with no owning Riffs row is stale/orphaned data (same
    // real-world case the main candidate query already tolerates) -- try
    // another jam rather than returning a candidate with no riff to place.
    if (!riffRow) continue

    return {
      stemCID: stemRow.StemCID,
      jamCID,
      riffCID: riffRow.RiffCID,
      presetName: stemRow.PresetName ?? '',
      creatorUserName: stemRow.CreatorUserName ?? '',
      arrangeRole,
      drumSubRole: null,
      riffBpm: riffRow.BPMrnd
    }
  }
  return null
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
 * pays a second db's own query cost. */
async function getRandomOwnStemCandidate(
  jams: JamDbPair[],
  arrangeRole: ArrangeRole,
  targetUser: string
): Promise<DiscoverCandidate | null> {
  const jamCIDsByDb = new Map<Database.Database, Set<string>>()
  for (const { jamCID, dbForJam } of jams) {
    const existing = jamCIDsByDb.get(dbForJam)
    if (existing) existing.add(jamCID)
    else jamCIDsByDb.set(dbForJam, new Set([jamCID]))
  }
  const shuffledDbs = [...jamCIDsByDb].sort(() => Math.random() - 0.5)

  for (const [db, allowedJamCIDs] of shuffledDbs) {
    let stemRow:
      | {
          StemCID: string
          OwnerJamCID: string
          PresetName: string | null
          CreatorUserName: string | null
        }
      | undefined
    try {
      // Real ids can, in principle, be shared across many rows for a given
      // CreatorUserName -- ORDER BY RANDOM() LIMIT 1 here means a genuinely
      // random pick among ALL of this user's own stems in this db, not
      // just whichever happens to sort first.
      stemRow = db
        .prepare(
          `SELECT StemCID, OwnerJamCID, PresetName, CreatorUserName FROM Stems
           WHERE CreatorUserName = ? ORDER BY RANDOM() LIMIT 1`
        )
        .get(targetUser) as typeof stemRow
    } catch {
      // Same defensive handling as every other per-db query in this file --
      // an external db missing even a core table shouldn't abort the whole
      // attempt, just this one db.
      continue
    }
    // The matched row's own jam might not be in THIS caller's allowed set
    // (jams is caller-supplied, see this file's own module doc comment) --
    // skip rather than return a candidate the caller never asked to see.
    if (!stemRow || !allowedJamCIDs.has(stemRow.OwnerJamCID)) continue

    let riffRow: { RiffCID: string; BPMrnd: number } | undefined
    try {
      riffRow = db
        .prepare(
          `SELECT RiffCID, BPMrnd FROM Riffs WHERE OwnerJamCID = ? AND (
             StemCID_1 = ? OR StemCID_2 = ? OR StemCID_3 = ? OR StemCID_4 = ? OR
             StemCID_5 = ? OR StemCID_6 = ? OR StemCID_7 = ? OR StemCID_8 = ?
           ) LIMIT 1`
        )
        .get(stemRow.OwnerJamCID, ...Array<string>(8).fill(stemRow.StemCID)) as typeof riffRow
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
      arrangeRole,
      drumSubRole: null,
      riffBpm: riffRow.BPMrnd
    }
  }
  return null
}
