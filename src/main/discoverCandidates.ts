// src/main/discoverCandidates.ts
import type Database from 'better-sqlite3'
import { type DrumSubRole } from '@shared/stemRole'
import {
  instrumentMaskToSoundType,
  soundSourceMatchesFilter,
  type DiscoverSoundSourceFilter
} from '@shared/riffLibraryTypes'
import {
  discoverSlotKindToArrangeRole,
  isMaskSlotKind,
  isTraitSlotKind,
  normalizeSlotKinds,
  type DiscoverKindSource,
  type DiscoverKindSources,
  type DiscoverMaskKind,
  type DiscoverSlotKind,
  type DiscoverTraitKind
} from '@shared/discoverSlotKind'
import { traitValuesFromFeatures, type TraitValues } from '@shared/discoverTraits'
import { traitPercentilesFromValues, type TraitPercentiles } from '@shared/traitQuantiles'
import { getTraitQuantileTables } from './traitQuantileCache'
import type { StemFeatures } from '@shared/stemFeatures'
import {
  getCachedRiffCount,
  getCachedStemCount,
  loadCachedRiffIndex,
  saveRiffIndexCache,
  loadCachedInstrumentRows,
  saveInstrumentRowsCache
} from './discoverIndexCache'
import { getAutoCategorizedStemCIDs } from './stemAutoCategoryStore'

/** One library-wide candidate for a Discover slot.
 *
 * For a MASK slot kind (drums/bass/lead -- DISCOVER_MASK_SLOT_KINDS), a
 * candidate comes from one of three sources (getMaskKindStemMasks, below):
 * human-confirmed (StemCategories) for the requested kind's own
 * ArrangeRole, any mask; its own Endlesss instrument category maps to that
 * kind (real ground truth, no confirmation needed); or -- ONLY for a stem
 * the mask can't place (no mask, or audio-in) -- the overnight classify
 * scan's own guess (StemAutoCategory, stemAutoClassify.ts). That last
 * source was dropped for mask kinds on 2026-09-18 and restored, scoped to
 * unplaceable stems, on 2026-09-22 (direct request: audio-in/mic stems
 * never appeared under drums/bass/lead). The endlesss/non-endlesss
 * checkboxes then filter the whole pool by each stem's own mask.
 *
 * For a TRAIT-ONLY slot kind set (bassHeavy/rhythmic/bright/warm), see
 * getTraitPoolCandidates -- any stem with a cached StemFeatureCache row,
 * tagged or not (combination slots, 2026-09-21 -- see
 * getDiscoverCandidates's own doc comment for the full combination-slot
 * rule, including why a mask+trait set is no longer a disjoint pool from
 * a mask-only one). */
export interface DiscoverCandidate {
  stemCID: string
  jamCID: string
  riffCID: string
  presetName: string
  creatorUserName: string
  /** The slot's own normalized kind set this candidate was drawn for
   * (normalizeSlotKinds) -- combination slots, 2026-09-21. */
  slotKinds: DiscoverSlotKind[]
  drumSubRole: DrumSubRole | null
  /** The OWNING RIFF's own BPM (Riffs.BPMrnd) -- the compatibility signal
   * this plan's own ranking (Task 3) actually scores against, since a
   * riff's BPM is always populated, unlike a stem's own (Stems.BPMrnd is
   * frequently null in real data -- LORE's own resolveRiff falls back to
   * the riff's BPM for exactly this reason, riffLibraryTypes.ts). */
  riffBpm: number
  /** Raw StemFeatureCache field value per requested TRAIT kind, for
   * rankCandidates' trait terms. {} when the slot has no trait kinds or the
   * stem has no cached features. */
  traitValues: TraitValues
  /** Library-wide percentile per requested TRAIT kind, [0, 1], already
   * direction-adjusted (@shared/traitQuantiles) -- what applyTraitBar and
   * rankCandidates actually use. {} when the slot has no trait kinds or
   * the stem has no values; null per kind when unknown. */
  traitPercentiles: TraitPercentiles
  /** Per MASK kind of the slot that admitted this stem, which rule did it
   * (docs/superpowers/specs/2026-09-22-discover-promise-vs-delivery-
   * design.md, Phase 2 -- the slot's match meter): 'confirmed' (a human
   * StemCategories row for the kind's role -- always wins), 'tag' (the
   * Endlesss instrument mask), 'guess' (the overnight classifier, only for
   * stems the mask can't place). {} for trait-only sets and every non-
   * mask-pool constructor (random/adjacency/seeded). */
  kindSources: DiscoverKindSources
  /** The OWNING RIFF's own creation time (Riffs.CreationTime, Unix
   * seconds) -- same "riff-level, not stem-level, since it's always
   * populated" rationale as riffBpm above. Copied onto the eventual placed
   * Stem's own `creationTime` once this candidate is committed to the
   * shelf/timeline (see @shared/types's Stem.creationTime doc comment for
   * why THAT field is per-stem). Direct request, 2026-09-20: "date could
   * be a tooltip on hover.. in discovery and in arranger or sketch." */
  riffCreationTime: number | null
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
  CreationTime: number | null
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
const RIFF_INDEX_CACHE_TTL_MS = 5 * 60_000

export interface RiffIndexEntry {
  riffCID: string
  ownerJamCID: string
  bpmRnd: number
  creationTime: number | null
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
          `SELECT RiffCID, OwnerJamCID, BPMrnd, CreationTime,
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
          bpmRnd: riff.BPMrnd,
          creationTime: riff.CreationTime
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

/** Cheap, defensive `SELECT COUNT(*)` against `table` -- same "missing
 * table on a broken/foreign db is not an error" convention as every other
 * query in this file. Used only to decide cache freshness below (a real
 * scan still re-measures its own count via buildRiffIndex/
 * getInstrumentRowsForDb's own COUNT(*), redundant but cheap -- an index
 * scan of the count, not a full row read). */
function tryCountRows(db: Database.Database, table: 'Riffs' | 'Stems'): number | null {
  try {
    return (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n
  } catch {
    return null
  }
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
 * (tryCountRows above) against the row count the cache was last saved
 * with tells us whether the archive has actually changed since. An
 * unchanged archive loads straight from `ownDb` (fast -- same disk as
 * everything else this app already reads/writes, and for the riff index
 * specifically, already in the fully-resolved per-stem shape, skipping
 * buildRiffIndex's own per-riff 8-slot loop entirely) instead of
 * re-scanning the real source db. A changed (or never-cached) archive
 * still does the real scan as before, then persists the fresh result for
 * next launch's benefit. */
export async function prewarmDiscoverCandidateCaches(
  jams: JamDbPair[],
  ownDb: Database.Database,
  onProgress?: PrewarmProgressCallback
): Promise<void> {
  const uniqueDbs = [...new Set(jams.map((j) => j.dbForJam))]
  for (let dbIndex = 0; dbIndex < uniqueDbs.length; dbIndex++) {
    const db = uniqueDbs[dbIndex]
    const sourceDbKey = db.name
    const reportRiffIndexProgress = (completed: number, total: number): void =>
      onProgress?.({ phase: 'riffIndex', dbIndex, dbCount: uniqueDbs.length, completed, total })
    const reportInstrumentRowsProgress = (completed: number, total: number): void =>
      onProgress?.({
        phase: 'instrumentRows',
        dbIndex,
        dbCount: uniqueDbs.length,
        completed,
        total
      })

    try {
      const liveRiffCount = tryCountRows(db, 'Riffs')
      if (liveRiffCount !== null && getCachedRiffCount(ownDb, sourceDbKey) === liveRiffCount) {
        const index = await loadCachedRiffIndex(ownDb, sourceDbKey, reportRiffIndexProgress)
        riffIndexCache.set(db, { index, computedAt: Date.now() })
      } else {
        const index = await getRiffIndexForDb(db, reportRiffIndexProgress)
        if (liveRiffCount !== null) saveRiffIndexCache(ownDb, sourceDbKey, index, liveRiffCount)
      }
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
    // errors internally (an empty cached result, never a throw). Same
    // own-db cache check as the riff index above.
    const liveStemCount = tryCountRows(db, 'Stems')
    if (liveStemCount !== null && getCachedStemCount(ownDb, sourceDbKey) === liveStemCount) {
      const rows = await loadCachedInstrumentRows(ownDb, sourceDbKey, reportInstrumentRowsProgress)
      instrumentRowsCache.set(db, { rows, computedAt: Date.now() })
    } else {
      const rows = await getInstrumentRowsForDb(db, reportInstrumentRowsProgress)
      if (liveStemCount !== null) saveInstrumentRowsCache(ownDb, sourceDbKey, rows, liveStemCount)
    }
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
 * The StemAutoCategory stems for the role are loaded ONCE up front (one
 * query on ownDb), then the walk is a single pass over each db's cached
 * instrument rows (getInstrumentRowsForDb, above) -- no SQL of its own
 * beyond that and the two small ownDb queries. Reads each jam's own
 * `Stems` table (not ownDb) for the Instrument values, via that cache;
 * `.all()`, never `.iterate()`, per this file's own "never leave a
 * statement open across an await" rule (a real live crash). Yields every
 * CLASSIFY_YIELD_EVERY rows -- cheap per row, but real synchronous work at
 * library scale.
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
  kind: DiscoverSlotKind
): Promise<Map<string, MaskKindAdmission>> {
  const arrangeRole = discoverSlotKindToArrangeRole(kind)
  const confirmedRoleByStemCID = new Map(
    (
      ownDb
        .prepare(`SELECT StemCID, ArrangeRole FROM StemCategories WHERE ArrangeRole IS NOT NULL`)
        .all() as { StemCID: string; ArrangeRole: string }[]
    ).map((r) => [r.StemCID, r.ArrangeRole])
  )
  const autoForRole = getAutoCategorizedStemCIDs(ownDb, arrangeRole)

  const jamCIDsByDb = new Map<Database.Database, Set<string>>()
  for (const { jamCID, dbForJam } of jams) {
    const existing = jamCIDsByDb.get(dbForJam)
    if (existing) existing.add(jamCID)
    else jamCIDsByDb.set(dbForJam, new Set([jamCID]))
  }

  const maskByStemCID = new Map<string, MaskKindAdmission>()
  let sinceYield = 0
  for (const [db, allowedJamCIDs] of jamCIDsByDb) {
    const rows = await getInstrumentRowsForDb(db)
    for (const row of rows) {
      if (allowedJamCIDs.has(row.OwnerJamCID) && !maskByStemCID.has(row.StemCID)) {
        const confirmedRole = confirmedRoleByStemCID.get(row.StemCID)
        if (confirmedRole !== undefined) {
          // Confirmed for this role: record its mask for the caller's
          // sound-source filter. Confirmed for another role: excluded.
          if (confirmedRole === arrangeRole) {
            maskByStemCID.set(row.StemCID, { instrument: row.Instrument, source: 'confirmed' })
          }
        } else {
          const soundType =
            row.Instrument === null ? null : instrumentMaskToSoundType(row.Instrument)
          const maskPlaced = soundType === 'drums' || soundType === 'bass' || soundType === 'notes'
          const admitted = maskPlaced
            ? (soundType === 'drums' && kind === 'drums') ||
              (soundType === 'bass' && kind === 'bass') ||
              (soundType === 'notes' && kind === 'lead')
            : autoForRole.has(row.StemCID)
          if (admitted) {
            maskByStemCID.set(row.StemCID, {
              instrument: row.Instrument,
              source: maskPlaced ? 'tag' : 'guess'
            })
          }
        }
      }
      sinceYield += 1
      if (sinceYield >= CLASSIFY_YIELD_EVERY) {
        sinceYield = 0
        await yieldToEventLoop()
      }
    }
  }
  return maskByStemCID
}

/** Combination slots (docs/superpowers/specs/2026-09-21-discover-combo-
 * slot-kinds-design.md) -- ONE rule for every kind set: mask kinds
 * (drums/bass/lead) OR together, each drawing from human confirmation, the
 * Endlesss instrument mask, and -- for stems the mask can't place -- the
 * overnight classifier (getMaskKindStemMasks); a trait-only set draws from
 * every stem with cached features (tagged or not). The endlesss/
 * non-endlesss sound-source checkboxes then apply to EVERY candidate, of
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
  soundSource = { endlesss: true, audioIn: true }
}: {
  ownDb: Database.Database
  jams: JamDbPair[]
  kinds: readonly DiscoverSlotKind[]
  onlyOwnStems?: boolean
  targetUser?: string
  soundSource?: DiscoverSoundSourceFilter
}): Promise<DiscoverCandidate[]> {
  const normalized = normalizeSlotKinds(kinds)
  const maskKinds = normalized.filter(isMaskSlotKind)
  const traitKinds = normalized.filter(isTraitSlotKind)

  if (maskKinds.length === 0) {
    if (traitKinds.length === 0) return []
    // traitKinds IS the whole normalized set here (no mask kinds), so the
    // pool's own slotKinds already match it.
    return attachTraitPercentiles(
      ownDb,
      await getTraitPoolCandidates({
        ownDb,
        jams,
        traitKinds,
        onlyOwnStems,
        targetUser,
        soundSource
      })
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
      soundSource
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
  return traitKinds.length > 0
    ? attachTraitPercentiles(ownDb, attachTraitValues(ownDb, pool, traitKinds))
    : pool
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
  for (const c of pool) {
    out.push({ ...c, traitPercentiles: traitPercentilesFromValues(c.traitValues, tables) })
    sinceYield += 1
    if (sinceYield >= CLASSIFY_YIELD_EVERY) {
      sinceYield = 0
      await yieldToEventLoop()
    }
  }
  return out
}

/** Mask + trait sets: looks up each pooled stem's cached features (ownDb's
 * StemFeatureCache, primary-key lookups, chunked like every other IN query
 * in this file) and attaches the requested trait values. A stem with no
 * cached row (or a malformed one) keeps traitValues {} -- it stays
 * eligible and simply scores 0 on the trait terms. */
function attachTraitValues(
  ownDb: Database.Database,
  pool: DiscoverCandidate[],
  traitKinds: readonly DiscoverTraitKind[]
): DiscoverCandidate[] {
  const featuresByStemCID = new Map<string, StemFeatures>()
  for (const cidChunk of chunk(
    pool.map((c) => c.stemCID),
    CANDIDATE_QUERY_CHUNK_SIZE
  )) {
    const placeholders = cidChunk.map(() => '?').join(', ')
    let rows: FeatureCandidateRow[]
    try {
      rows = ownDb
        .prepare(
          `SELECT StemCID, FeaturesJSON FROM StemFeatureCache WHERE StemCID IN (${placeholders})`
        )
        .all(...cidChunk) as FeatureCandidateRow[]
    } catch {
      continue
    }
    for (const row of rows) {
      try {
        featuresByStemCID.set(row.StemCID, JSON.parse(row.FeaturesJSON) as StemFeatures)
      } catch {
        // malformed row -- this stem just gets no trait values
      }
    }
  }
  return pool.map((c) => {
    const features = featuresByStemCID.get(c.stemCID)
    return features ? { ...c, traitValues: traitValuesFromFeatures(features, traitKinds) } : c
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
  soundSource
}: {
  ownDb: Database.Database
  jams: JamDbPair[]
  kind: DiscoverSlotKind
  onlyOwnStems?: boolean
  targetUser?: string
  soundSource: DiscoverSoundSourceFilter
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
  const maskByStemCID = await getMaskKindStemMasks(ownDb, jams, kind)
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

  // The endlesss/non-endlesss checkboxes, applied by each stem's own mask
  // BEFORE sampling so the bounded sample isn't wasted on stems that would
  // be filtered out anyway.
  const eligibleStemCIDs = [...categoryByStemCID.keys()].filter((stemCID) =>
    soundSourceMatchesFilter(maskByStemCID.get(stemCID)?.instrument, soundSource)
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
        await yieldToEventLoop()
      }
    }
  }

  return out
}

interface FeatureCandidateRow {
  StemCID: string
  FeaturesJSON: string
}

interface TraitMatchedStem {
  stemCID: string
  jamCID: string
  traitValues: TraitValues
}

/** Candidate pool for a TRAIT-ONLY kind set -- any stem with a cached
 * StemFeatureCache row (tagged or not, since combination slots, 2026-09-21),
 * narrowed by the sound-source filter. Trait values for every requested
 * kind are attached from the same parse.
 *
 * StemFeatureCache stores each stem's own features as one JSON blob
 * (FeaturesJSON), not separate SQL columns -- same "fetch raw rows, parse
 * in JS" convention stemAutoClassify.ts's own fetchPendingFeatureBatch
 * already uses, since there's no SQL-level way to ORDER BY a JSON field
 * without relying on SQLite's JSON1 extension, which nothing else in this
 * codebase depends on.
 *
 * Bounded via a cheap COUNT + ONE random-offset `ORDER BY StemCID LIMIT/
 * OFFSET` page (code review, 2026-09-18) -- NOT `ORDER BY RANDOM() LIMIT`,
 * which was this function's own first-draft shape and is a real bug class
 * this file has already hit and fixed more than once elsewhere
 * (buildRiffIndex/getInstrumentRowsForDb's own doc comments): SQLite must
 * assign a sort key to and fully sort EVERY row before LIMIT ever applies,
 * so cost scales with the WHOLE table, not the requested pool size -- the
 * exact "one unbounded synchronous SQL statement" freeze shape already
 * root-caused at real scale in this same file. A random OFFSET into an
 * `ORDER BY StemCID` scan (which DOES use the primary-key index) gives
 * real per-roll variety -- a different contiguous slice of the table each
 * call -- at a fraction of the cost, same accepted "OFFSET cost grows with
 * how far in you land, still fast in practice" tradeoff
 * discoverIndexCache.ts's own pagination already relies on. */
async function getTraitPoolCandidates({
  ownDb,
  jams,
  traitKinds,
  onlyOwnStems,
  targetUser,
  soundSource = { endlesss: true, audioIn: true }
}: {
  ownDb: Database.Database
  jams: JamDbPair[]
  traitKinds: readonly DiscoverTraitKind[]
  onlyOwnStems: boolean
  targetUser?: string
  soundSource?: DiscoverSoundSourceFilter
}): Promise<DiscoverCandidate[]> {
  let total: number
  try {
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
    rows = ownDb
      .prepare(
        `SELECT StemCID, FeaturesJSON FROM StemFeatureCache ORDER BY StemCID LIMIT ? OFFSET ?`
      )
      .all(MAX_CANDIDATE_RESOLUTION_POOL, offset) as FeatureCandidateRow[]
  } catch {
    return []
  }
  if (rows.length === 0) return []

  // Merge Instrument-mask rows across every unique db in `jams` -- a
  // stem's own Stems row (and thus its mask) can live in a different db
  // than ownDb's own StemFeatureCache (external LORE archive stems still
  // get their features cached in ownDb). Reuses the SAME per-db cache the
  // mask-kind path already warms. dbByStemCID (not just jamCID) is
  // captured here too, so the second pass below can group survivors by DB
  // CONNECTION directly -- see that pass's own comment for why that
  // matters.
  const jamCIDsByDb = new Map<Database.Database, Set<string>>()
  for (const { jamCID, dbForJam } of jams) {
    const existing = jamCIDsByDb.get(dbForJam)
    if (existing) existing.add(jamCID)
    else jamCIDsByDb.set(dbForJam, new Set([jamCID]))
  }
  const instrumentByStemCID = new Map<string, number | null>()
  const dbByStemCID = new Map<string, Database.Database>()
  const jamCIDByStemCID = new Map<string, string>()
  for (const [db, allowedJamCIDs] of jamCIDsByDb) {
    const instrumentRows = await getInstrumentRowsForDb(db)
    for (const row of instrumentRows) {
      if (!allowedJamCIDs.has(row.OwnerJamCID)) continue
      instrumentByStemCID.set(row.StemCID, row.Instrument)
      dbByStemCID.set(row.StemCID, db)
      jamCIDByStemCID.set(row.StemCID, row.OwnerJamCID)
    }
  }

  const matched: TraitMatchedStem[] = []
  let sinceYield = 0
  for (const row of rows) {
    // A single `do {} while (false)` block with `break` on every
    // disqualifying condition -- so `sinceYield` below increments exactly
    // ONCE per row regardless of which condition (if any) disqualified it
    // (code review, 2026-09-18: the original version only incremented on
    // SOME of this loop's exit paths, an inconsistency with every other
    // yield-counted loop in this file).
    do {
      const instrument = instrumentByStemCID.get(row.StemCID)

      // Direct request, 2026-09-21: "a way to only enable audio in or
      // microphone stems." instrument may be undefined here (no known
      // Instrument row at all) or null (Stems.Instrument itself is NULL)
      // -- soundSourceMatchesFilter treats both the same as "no confident
      // mask," which counts as Endlesss, not audioIn (see its own doc
      // comment).
      if (!soundSourceMatchesFilter(instrument, soundSource)) break

      const jamCID = jamCIDByStemCID.get(row.StemCID)
      if (jamCID === undefined) break // not among the caller's own jams

      let features: StemFeatures
      try {
        features = JSON.parse(row.FeaturesJSON) as StemFeatures
      } catch {
        break
      }

      matched.push({
        stemCID: row.StemCID,
        jamCID,
        traitValues: traitValuesFromFeatures(features, traitKinds)
      })
      // Deliberate do/while(false), see comment above the `do {` for why.
      // eslint-disable-next-line no-constant-condition
    } while (false)

    sinceYield += 1
    if (sinceYield >= CLASSIFY_YIELD_EVERY) {
      sinceYield = 0
      await yieldToEventLoop()
    }
  }
  if (matched.length === 0) return []

  // Second pass: resolve riff/Stems metadata for exactly the stems that
  // survived filtering above -- grouped by DB CONNECTION (dbByStemCID,
  // captured above), NOT by jamCID (code review, 2026-09-18): grouping by
  // jamCID here would reintroduce the exact "one query per jam" bug
  // getMaskKindStemMasks's own doc comment already documents as a
  // real, previously-fixed live incident (5,057 separate round trips on a
  // real library) -- survivors drawn from a random slice of the whole
  // library will typically span many jams sharing one db connection.
  const byDb = new Map<Database.Database, TraitMatchedStem[]>()
  for (const entry of matched) {
    const db = dbByStemCID.get(entry.stemCID)
    if (!db) continue
    const list = byDb.get(db)
    if (list) list.push(entry)
    else byDb.set(db, [entry])
  }

  const result: DiscoverCandidate[] = []
  let sinceYield2 = 0
  for (const [db, entries] of byDb) {
    const riffIndex = await getRiffIndexForDb(db)

    for (const entryChunk of chunk(entries, CANDIDATE_QUERY_CHUNK_SIZE)) {
      const stemCIDs = entryChunk.map((e) => e.stemCID)
      const placeholders = stemCIDs.map(() => '?').join(', ')
      let stemRows: { StemCID: string; PresetName: string | null; CreatorUserName: string | null }[]
      try {
        stemRows = db
          .prepare(
            `SELECT StemCID, PresetName, CreatorUserName FROM Stems WHERE StemCID IN (${placeholders})`
          )
          .all(...stemCIDs) as typeof stemRows
      } catch {
        continue
      }
      const stemByCID = new Map(stemRows.map((r) => [r.StemCID, r]))

      for (const entry of entryChunk) {
        const riffInfo = riffIndex.get(entry.stemCID)
        if (!riffInfo) continue
        const stemRow = stemByCID.get(entry.stemCID)
        if (!stemRow) continue
        if (onlyOwnStems && stemRow.CreatorUserName !== targetUser) continue

        result.push({
          stemCID: entry.stemCID,
          jamCID: riffInfo.ownerJamCID,
          riffCID: riffInfo.riffCID,
          presetName: stemRow.PresetName ?? '',
          creatorUserName: stemRow.CreatorUserName ?? '',
          slotKinds: [...traitKinds],
          drumSubRole: null,
          riffBpm: riffInfo.bpmRnd,
          traitValues: entry.traitValues,
          traitPercentiles: {},
          kindSources: {},
          riffCreationTime: riffInfo.creationTime
        })
      }

      sinceYield2 += 1
      if (sinceYield2 >= RIFF_QUERY_YIELD_EVERY) {
        sinceYield2 = 0
        await yieldToEventLoop()
      }
    }
  }

  return result
}

// Random stem probes getRandomLibraryCandidate tries against the cached
// instrument-row index before falling back to one filtered pass.
const RANDOM_STEM_PROBES = 200

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
 * endlesss/audioIn checkboxes like every other roll).
 *
 * Samples random STEMS from the cached per-db instrument-row index (see
 * the comment at the top of the body for the 2026-09-22 bug that replaced
 * the old "try 15 random jams" approach), filtered by the allowed jams and
 * the soundSource checkboxes, and resolved through the cached riff index.
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
  jams,
  kinds,
  onlyOwnStems = false,
  targetUser,
  soundSource = { endlesss: true, audioIn: true }
}: {
  jams: JamDbPair[]
  kinds: readonly DiscoverSlotKind[]
  onlyOwnStems?: boolean
  targetUser?: string
  soundSource?: DiscoverSoundSourceFilter
}): Promise<DiscoverCandidate | null> {
  if (!soundSource.endlesss && !soundSource.audioIn) return null

  if (onlyOwnStems && targetUser) {
    return getRandomOwnStemCandidate(jams, kinds, targetUser, soundSource)
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
  soundSource: DiscoverSoundSourceFilter
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
           WHERE CreatorUserName = ?${soundSourceFragment ? ` AND ${soundSourceFragment}` : ''}
           ORDER BY RANDOM() LIMIT 1`
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

    let riffRow: { RiffCID: string; BPMrnd: number; CreationTime: number | null } | undefined
    try {
      riffRow = db
        .prepare(
          `SELECT RiffCID, BPMrnd, CreationTime FROM Riffs WHERE OwnerJamCID = ? AND (
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
