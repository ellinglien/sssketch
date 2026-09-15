// src/main/discoverCandidates.ts
import type Database from 'better-sqlite3'
import { SOUND_TYPE_TO_ARRANGE_ROLE, type ArrangeRole, type DrumSubRole } from '@shared/stemRole'
import { suggestCategoryFromEmbedding } from '@shared/embeddingMatch'
import { instrumentMaskToSoundType } from '@shared/riffLibraryTypes'
import { getConfirmedEmbeddings } from './embeddingMatch'

/** One library-wide candidate for a Discover slot -- a stem that's EITHER
 * human-confirmed (StemCategories) for the requested ArrangeRole, or whose
 * own embedding confidently CLASSIFIES as that role even without
 * confirmation (getEmbeddingGuessedStemCIDs, added 2026-09-15 to widen a
 * too-small confirmed-only pool), or whose own Endlesss instrument
 * category maps to that role (getInstrumentMatchedStemCIDs, added the same
 * day -- real ground truth requiring no prior confirmation OR background
 * scan at all, unlike the embedding path). */
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

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

/** Every StemCID, library-wide, that ISN'T confirmed (StemCategories) for
 * ANY ArrangeRole -- not just the one being queried -- but whose own
 * cached embedding (StemEmbeddingCache, populated by the whole-library
 * scan -- DiscoverLibraryScan.tsx) classifies confidently as `arrangeRole`
 * anyway -- suggestCategoryFromEmbedding (@shared/embeddingMatch), the
 * SAME k-NN-over-confirmed-embeddings classifier Tidy Up's own per-stem
 * suggestions already use, trained here on getConfirmedEmbeddings(ownDb,
 * 'arrangeRole') (exactly the axis Discover's own candidates care about).
 *
 * The any-role exclusion (not just "not already confirmed for THIS role")
 * is an explicit, self-contained guard -- independent review found that a
 * stem confirmed for a DIFFERENT role is ALSO implicitly protected today,
 * since its own embedding sits in the classifier's own training set with
 * a trivial 1.0 self-similarity nothing else can beat, so it can only ever
 * classify back to its own real confirmed category. That protection is an
 * emergent property of suggestCategoryFromEmbedding's own math, though,
 * not a documented contract -- if that function ever changed to exclude
 * self-matches from its own training data, cross-role leakage would
 * become real with nothing here to catch it. Querying this explicitly
 * keeps correctness independent of that classifier's internals.
 *
 * Returns an empty set immediately when nothing is trained yet on this
 * axis (getConfirmedEmbeddings returns nothing, or too few
 * categories/samples for suggestCategoryFromEmbedding to ever return
 * non-null) -- no point walking the whole embedding table for a
 * classifier that can't classify anything yet.
 *
 * Uses `.all()`, NOT `.iterate()` -- real, LIVE crash found 2026-09-15
 * (not theoretical): better-sqlite3 throws "TypeError: This database
 * connection is busy executing a query" when ANYTHING else tries to run a
 * statement -- specifically a db.transaction() -- against the SAME
 * connection while a `.iterate()` generator from a prior statement hasn't
 * been fully drained. `ownDb` is a single cached connection shared by the
 * WHOLE main process (openOwnRiffLibraryDb), including the riff-library
 * background sync (syncSharedFeed -> upsertRiffSkeletons, its own
 * db.transaction()), which runs independently on its own schedule. An
 * earlier version of this function used `.iterate()` specifically so
 * `await yieldToEventLoop()` between rows wouldn't require eagerly
 * materializing the whole table first -- but every `await` inside that
 * loop left the iterate()'s own statement handle OPEN AND UNFINISHED
 * across the yield, and the background sync firing during exactly that
 * window threw the error above, observed live in this app's own stderr.
 * `.all()` fully executes and CLOSES its statement synchronously before
 * this function ever awaits anything -- by the time the classify loop
 * below yields, the connection is completely idle, so a concurrent
 * db.transaction() elsewhere can run without conflict. This does mean the
 * whole StemEmbeddingCache table is read into one JS array up front
 * (independent review's own original concern) -- a real, but strictly
 * smaller and less severe risk than a confirmed crash: at CURRENT
 * real-world scan progress (a fraction of a 50k+-stem library, described
 * elsewhere as taking HOURS to fully complete) this read alone is fast:
 * only the CLASSIFY loop after it does real per-row work, and that part
 * still yields.
 *
 * Cached per role for GUESSED_CACHE_TTL_MS: confirmed live 2026-09-15 (real
 * user report, not the earlier "deliberately not built preemptively"
 * guess this comment used to make) that a real library's worth of
 * StemEmbeddingCache rows makes one uncached call take on the order of
 * 20 real seconds -- yielding keeps the app responsive DURING that time
 * (no beachball), but paying it again on every single roll/reroll click is
 * still a bad wait. A short TTL, not an invalidate-on-write scheme: the
 * writers that would invalidate this (Tidy Up confirmations, the
 * whole-library scan's own embedding writes) are spread across several
 * other modules, and wiring an explicit invalidation callback into all of
 * them is real cross-module coupling for a cache that's fine to just be
 * up to a minute stale -- a fresh confirmation or newly-scanned stem
 * shows up in Discover's own pool within GUESSED_CACHE_TTL_MS regardless,
 * without needing to track every writer.
 *
 * Keyed by `ownDb` INSTANCE first (a WeakMap, not a flat module-level
 * cache) -- production only ever has one real ownDb (openOwnRiffLibraryDb's
 * own cached singleton), so this is behaviorally identical to a flat cache
 * there, but it keeps this file's own tests (each constructing a fresh
 * in-memory db per test) from reading a stale result cached against a
 * DIFFERENT db instance from an earlier test -- a flat `Map<ArrangeRole,
 * ...>` would otherwise leak cached state across every test in this file
 * that happens to query the same role. */
const GUESSED_CACHE_TTL_MS = 60_000
const guessedStemCIDsCache = new WeakMap<
  Database.Database,
  Map<ArrangeRole, { guessed: Set<string>; computedAt: number }>
>()

async function getEmbeddingGuessedStemCIDs(
  ownDb: Database.Database,
  arrangeRole: ArrangeRole
): Promise<Set<string>> {
  const dbCache = guessedStemCIDsCache.get(ownDb) ?? new Map()
  guessedStemCIDsCache.set(ownDb, dbCache)

  const cached = dbCache.get(arrangeRole)
  if (cached && Date.now() - cached.computedAt < GUESSED_CACHE_TTL_MS) return cached.guessed

  const confirmed = getConfirmedEmbeddings(ownDb, 'arrangeRole')
  const guessed = new Set<string>()
  if (confirmed.length === 0) {
    dbCache.set(arrangeRole, { guessed, computedAt: Date.now() })
    return guessed
  }

  const confirmedAnyRole = new Set(
    (
      ownDb.prepare(`SELECT StemCID FROM StemCategories WHERE ArrangeRole IS NOT NULL`).all() as {
        StemCID: string
      }[]
    ).map((r) => r.StemCID)
  )

  // Fully executed and closed by the time this line returns -- no
  // statement remains open on `ownDb` past this point, so the classify
  // loop below can safely await/yield without risking the "connection is
  // busy" error a live .iterate() generator would.
  const rows = ownDb.prepare(`SELECT StemCID, EmbeddingJSON FROM StemEmbeddingCache`).all() as {
    StemCID: string
    EmbeddingJSON: string
  }[]

  let sinceYield = 0
  for (const row of rows) {
    if (!confirmedAnyRole.has(row.StemCID)) {
      try {
        const embedding = JSON.parse(row.EmbeddingJSON) as number[]
        if (suggestCategoryFromEmbedding(confirmed, embedding) === arrangeRole) {
          guessed.add(row.StemCID)
        }
      } catch {
        // Corrupted row -- skip, same defensive handling
        // getConfirmedEmbeddings itself already uses for the same table.
      }
    }
    sinceYield += 1
    if (sinceYield >= CLASSIFY_YIELD_EVERY) {
      sinceYield = 0
      await yieldToEventLoop()
    }
  }
  dbCache.set(arrangeRole, { guessed, computedAt: Date.now() })
  return guessed
}

/** Every StemCID, across the given jams, that isn't confirmed
 * (StemCategories) for ANY ArrangeRole -- not just the one being queried,
 * same cross-role-leakage guard getEmbeddingGuessedStemCIDs's own doc
 * comment explains in detail -- but whose own Endlesss instrument category
 * (Stems.Instrument, a bitmask -- instrumentMaskToSoundType) maps to
 * `arrangeRole` via SOUND_TYPE_TO_ARRANGE_ROLE. Direct request, 2026-09-15:
 * "can't we train it with some basic data before handing it to someone?"
 * -- unlike the embedding classifier (getEmbeddingGuessedStemCIDs), this
 * needs NO prior confirmation and no background scan at all: instrument
 * category is real ground truth Endlesss itself recorded at jam time (see
 * instrumentMaskToSoundType's own doc comment -- "traced directly from
 * OUROVEON's own source, not guessed"), present on every synced stem the
 * moment it syncs. This is the SAME mapping resolveStemRole (stemRole.ts)
 * already uses as its own default/fallback arrangeRole for any stem
 * without a confirmed busId -- reusing it here for Discover's candidate
 * pool is consistent with that established precedent, not new risk.
 *
 * Reads each jam's own `Stems` table directly (not ownDb) for the
 * Instrument values themselves -- a stem's Instrument lives wherever its
 * Riffs/Stems rows do, same as the main per-jam loop below. `.all()`, not
 * `.iterate()`, for the exact same "never leave a statement open across an
 * await" reason getEmbeddingGuessedStemCIDs's own doc comment explains in
 * detail (a real live crash, not theoretical). Yields periodically for the
 * same many-rows-is-real-synchronous-work reason as that function too,
 * though a bitmask check is far cheaper per row than a cosine similarity. */
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

  const matched = new Set<string>()
  let sinceYield = 0
  for (const { dbForJam } of jams) {
    let rows: { StemCID: string; Instrument: number | null }[]
    try {
      rows = dbForJam.prepare(`SELECT StemCID, Instrument FROM Stems`).all() as typeof rows
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
 * getEmbeddingGuessedStemCIDs below adds every stem whose OWN embedding
 * confidently classifies as this role (suggestCategoryFromEmbedding, the
 * same k-NN-over-confirmed-embeddings classifier Tidy Up's own per-stem
 * suggestions already use), even though nobody has manually confirmed it
 * yet -- real variety instead of only what's already been hand-tagged.
 *
 * WIDENED AGAIN, same day: the embedding path above still needs at least 3
 * confirmed samples in 2+ categories before it can suggest ANYTHING
 * (suggestCategoryFromEmbedding's own MIN_SAMPLES_PER_CATEGORY) -- for a
 * role with 0-2 confirmed stems, it contributes nothing at all, which is
 * exactly the case a real user hit. getInstrumentMatchedStemCIDs adds a
 * THIRD source needing no confirmation and no background scan whatsoever:
 * Endlesss's own recorded instrument category for each stem (a real bit
 * traced from OUROVEON's own source, not a guess -- instrumentMaskToSoundType's
 * own doc comment), mapped onto ArrangeRole via the exact same
 * SOUND_TYPE_TO_ARRANGE_ROLE table resolveStemRole (stemRole.ts) already
 * uses as its own default guess elsewhere in this app. */
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

  const guessedStemCIDs = await getEmbeddingGuessedStemCIDs(ownDb, arrangeRole)
  for (const stemCID of guessedStemCIDs) {
    // A guessed (not human-confirmed) row -- DrumSubRole stays null since
    // the embedding classifier here only ever runs on the arrangeRole axis
    // (getConfirmedEmbeddings(ownDb, 'arrangeRole') below), never
    // drumSubRole. getEmbeddingGuessedStemCIDs already excludes anything
    // confirmed for ANY role, so this never overwrites a real confirmed
    // row.
    categoryByStemCID.set(stemCID, {
      StemCID: stemCID,
      ArrangeRole: arrangeRole,
      DrumSubRole: null
    })
  }

  const instrumentMatchedStemCIDs = await getInstrumentMatchedStemCIDs(ownDb, jams, arrangeRole)
  for (const stemCID of instrumentMatchedStemCIDs) {
    // getInstrumentMatchedStemCIDs already excludes anything confirmed for
    // ANY role (its own doc comment), so this can never overwrite a real
    // human confirmation. It CAN legitimately re-set a stemCID the
    // embedding path above already added for this SAME role -- harmless,
    // since both write the identical synthesized shape (same StemCID,
    // same arrangeRole, DrumSubRole always null for a non-confirmed row).
    categoryByStemCID.set(stemCID, {
      StemCID: stemCID,
      ArrangeRole: arrangeRole,
      DrumSubRole: null
    })
  }

  if (categoryByStemCID.size === 0) return []

  const confirmedStemCIDs = [...categoryByStemCID.keys()]
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
  // grows -- correctness first; more, smaller queries per jam is a fully
  // acceptable trade for never hitting this again.
  let sinceYield = 0
  for (const { jamCID, dbForJam } of jams) {
    for (const stemCIDChunk of chunk(confirmedStemCIDs, CANDIDATE_QUERY_CHUNK_SIZE)) {
      const placeholders = stemCIDChunk.map(() => '?').join(', ')
      const eightColumnWhere = [1, 2, 3, 4, 5, 6, 7, 8]
        .map((slot) => `StemCID_${slot} IN (${placeholders})`)
        .join(' OR ')

      let riffRows: RiffCandidateRow[]
      try {
        riffRows = dbForJam
          .prepare(
            `SELECT RiffCID, BPMrnd,
                    StemCID_1, StemCID_2, StemCID_3, StemCID_4,
                    StemCID_5, StemCID_6, StemCID_7, StemCID_8
             FROM Riffs WHERE OwnerJamCID = ? AND (${eightColumnWhere})`
          )
          .all(jamCID, ...Array<string[]>(8).fill(stemCIDChunk).flat()) as RiffCandidateRow[]
      } catch {
        // Kept defensive, unlike StemCategories-on-ownDb above: dbForJam is
        // an EXTERNAL file (could be a real synced LORE archive, or a
        // partial/corrupted one) whose lifecycle this app doesn't fully
        // control -- ownDb's migration guarantee doesn't extend to it. A
        // jam missing even a core table like Riffs shouldn't abort the
        // whole multi-jam scan; see the "does not crash the whole scan on
        // a jam with no Riffs table" test below for the case this
        // actually guards. Skips just this one chunk, not the whole jam --
        // a later chunk for the same jam still gets a fair try.
        continue
      }

      if (riffRows.length > 0) {
        const stemRows = dbForJam
          .prepare(
            `SELECT StemCID, PresetName, CreatorUserName FROM Stems WHERE StemCID IN (${placeholders})`
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
              jamCID,
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
      // CLASSIFY_YIELD_EVERY's own loop above -- a much smaller threshold,
      // so a library with many jams times many chunks still yields often
      // enough to stay non-blocking.
      sinceYield += 1
      if (sinceYield >= RIFF_QUERY_YIELD_EVERY) {
        sinceYield = 0
        await yieldToEventLoop()
      }
    }
  }

  return out
}
