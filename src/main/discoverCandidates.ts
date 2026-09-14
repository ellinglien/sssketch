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
 * repeat that mistake here. */
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
  const categoryStmt = ownDb.prepare(
    `SELECT ArrangeRole, DrumSubRole FROM StemCategories WHERE StemCID = ? AND ArrangeRole = ?`
  )
  const out: DiscoverCandidate[] = []

  for (const { jamCID, dbForJam } of jams) {
    let riffRows: RiffCandidateRow[]
    try {
      riffRows = dbForJam
        .prepare(
          `SELECT RiffCID, BPMrnd,
                  StemCID_1, StemCID_2, StemCID_3, StemCID_4,
                  StemCID_5, StemCID_6, StemCID_7, StemCID_8
           FROM Riffs WHERE OwnerJamCID = ?`
        )
        .all(jamCID) as RiffCandidateRow[]
    } catch {
      // A jam whose own db lacks even Riffs/Stems (shouldn't happen for a
      // real synced db, but this function is also exercised against
      // ad-hoc in-memory test dbs) -- skip rather than throw, same
      // resilience convention as getConfirmedEmbeddings' own corrupted-row
      // handling.
      continue
    }

    const stemStmt = dbForJam.prepare(
      `SELECT PresetName, CreatorUserName FROM Stems WHERE StemCID = ?`
    )

    for (const riff of riffRows) {
      const stemCIDs: string[] = []
      for (let slot = 1; slot <= 8; slot++) {
        const cid = riff[`StemCID_${slot}` as keyof RiffCandidateRow] as string | null
        if (cid) stemCIDs.push(cid)
      }
      for (const stemCID of stemCIDs) {
        let category: { ArrangeRole: string; DrumSubRole: string | null } | undefined
        try {
          category = categoryStmt.get(stemCID, arrangeRole) as
            | { ArrangeRole: string; DrumSubRole: string | null }
            | undefined
        } catch {
          // ownDb genuinely should always have this table -- but a test or
          // a not-yet-migrated db shouldn't crash the whole scan over one
          // missing table.
          continue
        }
        if (!category) continue

        const stemRow = stemStmt.get(stemCID) as
          | { PresetName: string | null; CreatorUserName: string | null }
          | undefined
        if (!stemRow) continue

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
