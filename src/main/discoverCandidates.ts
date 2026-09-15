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

// TTL cache for getInstrumentMatchedStemCIDs, below -- a real library's
// worth of jams x stems walked fresh on EVERY roll click with no cache at
// all took minutes (confirmed live). Keyed by db INSTANCE (WeakMap, not a
// flat cache) specifically so tests using fresh in-memory dbs don't
// pollute each other -- same pattern this file used for the now-retired
// embedding/centroid caches before they moved to the background scan.
const GUESSED_CACHE_TTL_MS = 60_000
const instrumentMatchedStemCIDsCache = new WeakMap<
  Database.Database,
  Map<ArrangeRole, { matched: Set<string>; computedAt: number }>
>()

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
 * Cached per (db instance, role) for GUESSED_CACHE_TTL_MS -- missed on the
 * first pass (this function shipped without one, on the assumption a
 * bitmask check is cheap enough not to need it), then confirmed live: a
 * real library's worth of jams x stems, walked fresh on EVERY roll click
 * with no cache at all, took minutes. Keyed by `ownDb` only (not the full
 * `jams` array, which isn't a stable cache key) -- `jams` is, in practice,
 * stable for a given db/session. */
async function getInstrumentMatchedStemCIDs(
  ownDb: Database.Database,
  jams: JamDbPair[],
  arrangeRole: ArrangeRole
): Promise<Set<string>> {
  const dbCache = instrumentMatchedStemCIDsCache.get(ownDb) ?? new Map()
  instrumentMatchedStemCIDsCache.set(ownDb, dbCache)

  const cached = dbCache.get(arrangeRole)
  if (cached && Date.now() - cached.computedAt < GUESSED_CACHE_TTL_MS) return cached.matched

  const confirmedAnyRole = new Set(
    (
      ownDb.prepare(`SELECT StemCID FROM StemCategories WHERE ArrangeRole IS NOT NULL`).all() as {
        StemCID: string
      }[]
    ).map((r) => r.StemCID)
  )

  const matched = new Set<string>()
  let sinceYield = 0
  for (const { jamCID, dbForJam } of jams) {
    let rows: { StemCID: string; Instrument: number | null }[]
    try {
      // Real perf bug, found live (root cause of a "stuck rolling" report
      // that survived the TTL cache above -- the cache only helps a SECOND
      // call within 60s, not the first, cold one): every non-"shared:" jam
      // in `jams` shares the SAME db connection (dbForJam, resolved via
      // riffLibraryStore.ts's own dbForJam -- one archive db holds every
      // synced jam's Stems rows together, NOT one db per jam). Without
      // `WHERE OwnerJamCID = ?`, this previously re-read the library's
      // ENTIRE Stems table on EVERY iteration of the jams loop --
      // O(jamCount x totalStemCount) row reads for what should be
      // O(totalStemCount) total, since every jam past the first was
      // redundantly re-scanning stems it doesn't even own. On a real
      // multi-hundred-jam, 50k+-stem library (this feature's own stated
      // target scale) that's tens of millions of wasted row reads on the
      // very first, uncached roll of any role.
      rows = dbForJam
        .prepare(`SELECT StemCID, Instrument FROM Stems WHERE OwnerJamCID = ?`)
        .all(jamCID) as typeof rows
    } catch {
      // Same defensive handling as the main per-jam loop below -- an
      // external db missing even a core table shouldn't abort the whole
      // multi-jam scan.
      continue
    }
    for (const row of rows) {
      if (
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
  dbCache.set(arrangeRole, { matched, computedAt: Date.now() })
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
  // COMPILING the query, not even running it yet): the ORIGINAL version of
  // this loop built ONE query with 8 `StemCID_N IN (...)` clauses (one per
  // Riffs column) OR'd together, each repeating the FULL placeholder list
  // -- `8 * confirmedStemCIDs.length` bound parameters in a single
  // statement. That was safe back when this pool was confirmed-only ("a
  // few hundred, real production scale," this file's own earlier doc
  // comment) -- but the SAME widening that fixed the "no match" problem
  // (embedding-guessed + instrument-matched stems, potentially THOUSANDS
  // once a role's instrument category is common) can now push
  // confirmedStemCIDs into a range SQLite can't compile as one statement
  // at all. CANDIDATE_QUERY_CHUNK_SIZE bounds every query to at most
  // 8 * 200 = 1600 placeholders, regardless of how large the widened pool
  // grows -- correctness first; more, smaller queries per db/jam-chunk is
  // a fully acceptable trade for never hitting this again.
  //
  // Real perf bug, found live (root cause of a SECOND "stuck rolling"
  // report, after the background classify scan started producing
  // thousands of StemAutoCategory rows for a popular role): the original
  // version of this loop ran the query ONCE PER JAM (`WHERE OwnerJamCID =
  // ?`), even though most non-"shared:" jams share the exact SAME db
  // connection (riffLibraryStore.ts's own dbForJam -- one archive db holds
  // every synced jam's Riffs rows together, same fact that motivated the
  // instrument-matched query's own OwnerJamCID fix earlier the same day).
  // A candidate pool of a few thousand stems (25 chunks) times a few
  // hundred jams sharing one db meant tens of thousands of redundant
  // prepare+execute round trips for what should be a few dozen. Fixed by
  // grouping jams by their underlying db CONNECTION (not by jamCID) and
  // querying `WHERE OwnerJamCID IN (<jamCIDs sharing this db>)` once per
  // (db, jam-chunk, stem-chunk) -- collapses to O(uniqueDbs x chunks)
  // instead of O(jams x chunks), typically a 1-2 order of magnitude
  // reduction for a real single-archive library. OwnerJamCID is now
  // SELECTed directly (added to RiffCandidateRow) since a single query can
  // span multiple jams, so the loop variable can no longer supply it.
  const jamCIDsByDb = new Map<Database.Database, string[]>()
  for (const { jamCID, dbForJam } of jams) {
    const existing = jamCIDsByDb.get(dbForJam)
    if (existing) existing.push(jamCID)
    else jamCIDsByDb.set(dbForJam, [jamCID])
  }

  let sinceYield = 0
  for (const [db, jamCIDsForDb] of jamCIDsByDb) {
    for (const jamCIDChunk of chunk(jamCIDsForDb, CANDIDATE_QUERY_CHUNK_SIZE)) {
      const jamPlaceholders = jamCIDChunk.map(() => '?').join(', ')
      for (const stemCIDChunk of chunk(confirmedStemCIDs, CANDIDATE_QUERY_CHUNK_SIZE)) {
        const stemPlaceholders = stemCIDChunk.map(() => '?').join(', ')
        const eightColumnWhere = [1, 2, 3, 4, 5, 6, 7, 8]
          .map((slot) => `StemCID_${slot} IN (${stemPlaceholders})`)
          .join(' OR ')

        let riffRows: RiffCandidateRow[]
        try {
          riffRows = db
            .prepare(
              `SELECT RiffCID, OwnerJamCID, BPMrnd,
                      StemCID_1, StemCID_2, StemCID_3, StemCID_4,
                      StemCID_5, StemCID_6, StemCID_7, StemCID_8
               FROM Riffs WHERE OwnerJamCID IN (${jamPlaceholders}) AND (${eightColumnWhere})`
            )
            .all(
              ...jamCIDChunk,
              ...Array<string[]>(8).fill(stemCIDChunk).flat()
            ) as RiffCandidateRow[]
        } catch {
          // Kept defensive, unlike StemCategories-on-ownDb above: `db` may
          // be an EXTERNAL file (a real synced LORE archive, or a
          // partial/corrupted one) whose lifecycle this app doesn't fully
          // control -- ownDb's migration guarantee doesn't extend to it. A
          // db missing even a core table like Riffs shouldn't abort the
          // whole multi-db scan; see the "does not crash the whole scan on
          // a jam with no Riffs table" test below for the case this
          // actually guards. Skips just this one chunk, not the whole db --
          // a later chunk for the same db still gets a fair try.
          continue
        }

        if (riffRows.length > 0) {
          const stemRows = db
            .prepare(
              `SELECT StemCID, PresetName, CreatorUserName FROM Stems WHERE StemCID IN (${stemPlaceholders})`
            )
            .all(...stemCIDChunk) as {
            StemCID: string
            PresetName: string | null
            CreatorUserName: string | null
          }[]
          const stemByCID = new Map(stemRows.map((row) => [row.StemCID, row]))

          for (const riff of riffRows) {
            for (let slot = 1; slot <= 8; slot++) {
              const stemCID = riff[`StemCID_${slot}` as keyof RiffCandidateRow] as string | null
              if (!stemCID) continue

              const category = categoryByStemCID.get(stemCID)
              if (!category) continue // this slot's stem isn't confirmed for the requested role

              const stemRow = stemByCID.get(stemCID)
              if (!stemRow) continue // confirmed, but no resolvable Stems row (e.g. stale/orphaned data)

              if (onlyOwnStems && stemRow.CreatorUserName !== targetUser) continue

              out.push({
                stemCID,
                jamCID: riff.OwnerJamCID,
                riffCID: riff.RiffCID,
                presetName: stemRow.PresetName ?? '',
                creatorUserName: stemRow.CreatorUserName ?? '',
                arrangeRole: category.ArrangeRole as ArrangeRole,
                drumSubRole: (category.DrumSubRole as DrumSubRole | null) ?? null,
                riffBpm: riff.BPMrnd
              })
            }
          }
        }

        // Real per-chunk SQL round trips, not cheap JS-only work like
        // CLASSIFY_YIELD_EVERY's own loop above -- a much smaller
        // threshold, so a library with many dbs/jam-chunks/stem-chunks
        // still yields often enough to stay non-blocking.
        sinceYield += 1
        if (sinceYield >= RIFF_QUERY_YIELD_EVERY) {
          sinceYield = 0
          await yieldToEventLoop()
        }
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
 * giving up, since a single jam might have no stems at all (rare) or none
 * matching `onlyOwnStems` -- bounded, so a library with many "empty" jams
 * still returns quickly instead of trying every single one. Returns null
 * (never throws) if nothing turns up within that budget; the caller
 * treats this the same as "no match" from the other candidate sources. */
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
  const shuffled = [...jams]
    .sort(() => Math.random() - 0.5)
    .slice(0, RANDOM_CANDIDATE_MAX_JAM_ATTEMPTS)

  for (const { jamCID, dbForJam } of shuffled) {
    let stemRow:
      { StemCID: string; PresetName: string | null; CreatorUserName: string | null } | undefined
    try {
      stemRow =
        onlyOwnStems && targetUser
          ? (dbForJam
              .prepare(
                `SELECT StemCID, PresetName, CreatorUserName FROM Stems
                 WHERE OwnerJamCID = ? AND CreatorUserName = ? ORDER BY RANDOM() LIMIT 1`
              )
              .get(jamCID, targetUser) as typeof stemRow)
          : (dbForJam
              .prepare(
                `SELECT StemCID, PresetName, CreatorUserName FROM Stems
                 WHERE OwnerJamCID = ? ORDER BY RANDOM() LIMIT 1`
              )
              .get(jamCID) as typeof stemRow)
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
