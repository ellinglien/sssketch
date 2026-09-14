// src/main/discoverCandidates.ts
import type Database from 'better-sqlite3'
import type { ArrangeRole, DrumSubRole } from '@shared/stemRole'

/** One library-wide candidate for a Discover slot -- a stem that ALREADY has
 * a human-confirmed StemCategories row for the requested ArrangeRole. See
 * this plan's own header for why the candidate pool is scoped to confirmed
 * rows only, not a live per-stem auto-guess. */
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
 * this inversion doesn't touch that. */
export function getDiscoverCandidates({
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
}): DiscoverCandidate[] {
  // No inner try/catch here (removed 2026-09-15, finding 1): StemCategories
  // on ownDb is guaranteed present by a real migration that runs on every
  // app start, same established convention as embeddingMatch.ts's own
  // getConfirmedEmbeddings. A real SQL error here (e.g. a typo) should
  // throw, not silently produce an empty Discover pool with no diagnostic
  // trail.
  const confirmedRows = ownDb
    .prepare(`SELECT StemCID, ArrangeRole, DrumSubRole FROM StemCategories WHERE ArrangeRole = ?`)
    .all(arrangeRole) as { StemCID: string; ArrangeRole: string; DrumSubRole: string | null }[]

  if (confirmedRows.length === 0) return []

  const categoryByStemCID = new Map(confirmedRows.map((row) => [row.StemCID, row]))
  const confirmedStemCIDs = confirmedRows.map((row) => row.StemCID)
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
