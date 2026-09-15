// src/main/discoverCandidates.ts
import type Database from 'better-sqlite3'
import type { ArrangeRole, DrumSubRole } from '@shared/stemRole'
import { suggestCategoryFromEmbedding } from '@shared/embeddingMatch'
import { getConfirmedEmbeddings } from './embeddingMatch'

/** One library-wide candidate for a Discover slot -- a stem either
 * human-confirmed (StemCategories) for the requested ArrangeRole, or whose
 * own embedding confidently CLASSIFIES as that role even without
 * confirmation (getEmbeddingGuessedStemCIDs below, added 2026-09-15 to
 * widen a too-small confirmed-only pool). */
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
 * No cross-call cache: at CURRENT real-world scan progress this is fast.
 * If a much larger StemEmbeddingCache later makes this noticeably slow per
 * reroll click, revisit caching by role -- deliberately not built
 * preemptively for a cost that isn't confirmed to be real yet. */
async function getEmbeddingGuessedStemCIDs(
  ownDb: Database.Database,
  arrangeRole: ArrangeRole
): Promise<Set<string>> {
  const confirmed = getConfirmedEmbeddings(ownDb, 'arrangeRole')
  const guessed = new Set<string>()
  if (confirmed.length === 0) return guessed

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
  return guessed
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
 * yet -- real variety instead of only what's already been hand-tagged. */
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

  if (categoryByStemCID.size === 0) return []

  const confirmedStemCIDs = [...categoryByStemCID.keys()]
  const placeholders = confirmedStemCIDs.map(() => '?').join(', ')
  const eightColumnWhere = [1, 2, 3, 4, 5, 6, 7, 8]
    .map((slot) => `StemCID_${slot} IN (${placeholders})`)
    .join(' OR ')

  const out: DiscoverCandidate[] = []

  for (const { jamCID, dbForJam } of jams) {
    let riffRows: RiffCandidateRow[]
    try {
      riffRows = dbForJam
        .prepare(
          `SELECT RiffCID, BPMrnd,
                  StemCID_1, StemCID_2, StemCID_3, StemCID_4,
                  StemCID_5, StemCID_6, StemCID_7, StemCID_8
           FROM Riffs WHERE OwnerJamCID = ? AND (${eightColumnWhere})`
        )
        .all(jamCID, ...Array<string[]>(8).fill(confirmedStemCIDs).flat()) as RiffCandidateRow[]
    } catch {
      // Kept defensive, unlike StemCategories-on-ownDb above: dbForJam is an
      // EXTERNAL file (could be a real synced LORE archive, or a partial/
      // corrupted one) whose lifecycle this app doesn't fully control --
      // ownDb's migration guarantee doesn't extend to it. A jam missing
      // even a core table like Riffs shouldn't abort the whole multi-jam
      // scan; see the "does not crash the whole scan on a jam with no
      // Riffs table" test below for the case this actually guards.
      continue
    }

    if (riffRows.length === 0) continue

    const stemRows = dbForJam
      .prepare(
        `SELECT StemCID, PresetName, CreatorUserName FROM Stems WHERE StemCID IN (${placeholders})`
      )
      .all(...confirmedStemCIDs) as {
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

  return out
}
