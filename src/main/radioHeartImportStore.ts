// src/main/radioHeartImportStore.ts
//
// RadioHeartImport (riffLibrarySchema.ts): which ell.ing/radio heart combos
// "fetch radio hearts" has brought home, and the "♥ n · misty kestrel"
// label each kept riff shows. RadioLikeImport: which liked single stems. Own db only. Its own module, apart from
// radioHeartsImport.ts, so riffLibraryStore.ts can read a label without
// importing the module that imports it.
import type Database from 'better-sqlite3'
import { friendlyRiffName } from '@shared/friendlyRiffName'
import { heartRiffName } from '@shared/radioHearts'

/** Every combo a previous fetch already brought home. */
export function listImportedHeartCombos(ownDb: Database.Database): Set<string> {
  const rows = ownDb.prepare(`SELECT Combo FROM RadioHeartImport`).all() as { Combo: string }[]
  return new Set(rows.map((r) => r.Combo))
}

export function recordHeartImport(
  ownDb: Database.Database,
  row: { combo: string; riffCID: string; count: number; at: number }
): void {
  ownDb
    .prepare(
      `INSERT INTO RadioHeartImport (Combo, RiffCID, Name, ImportedAt) VALUES (?, ?, ?, ?)
       ON CONFLICT(Combo) DO NOTHING`
    )
    .run(row.combo, row.riffCID, heartRiffName(row.count, friendlyRiffName(row.riffCID)), row.at)
}

/** Brings an already-imported combo's label up to its current heart count.
 * Returns whether anything changed. The friendly pair is re-derived from
 * the stored RiffCID, so it can never drift from the riff's own name. */
export function refreshHeartCount(ownDb: Database.Database, combo: string, count: number): boolean {
  const row = ownDb
    .prepare(`SELECT RiffCID, Name FROM RadioHeartImport WHERE Combo = ?`)
    .get(combo) as { RiffCID: string; Name: string } | undefined
  if (!row) return false
  const name = heartRiffName(count, friendlyRiffName(row.RiffCID))
  if (name === row.Name) return false
  ownDb.prepare(`UPDATE RadioHeartImport SET Name = ? WHERE Combo = ?`).run(name, combo)
  return true
}

/** The ♥ label for a kept riff, or null. Read side only: for a db without
 * the table (an external LORE archive, an older fixture) it is simply null.
 * Two combos can land on one riff (one of them missing a stem the other
 * never had) -- the most recent import's label wins. */
export function heartNameForRiff(db: Database.Database, riffCID: string): string | null {
  try {
    const row = db
      .prepare(
        `SELECT Name FROM RadioHeartImport WHERE RiffCID = ? ORDER BY ImportedAt DESC LIMIT 1`
      )
      .get(riffCID) as { Name: string } | undefined
    return row?.Name ?? null
  } catch (err) {
    // Only a db without the table at all means "no name". Anything else --
    // a locked or corrupt db, a closed handle -- is a real fault and must
    // not be dressed up as an unnamed riff.
    if (err instanceof Error && /no such table/i.test(err.message)) return null
    throw err
  }
}

/** Every liked stem a previous fetch already brought home. */
export function listImportedLikes(ownDb: Database.Database): Set<string> {
  const rows = ownDb.prepare(`SELECT Stem FROM RadioLikeImport`).all() as { Stem: string }[]
  return new Set(rows.map((r) => r.Stem))
}

export function recordLikeImports(
  ownDb: Database.Database,
  stems: readonly string[],
  at: number
): void {
  const insert = ownDb.prepare(
    `INSERT INTO RadioLikeImport (Stem, ImportedAt) VALUES (?, ?) ON CONFLICT(Stem) DO NOTHING`
  )
  for (const stem of stems) insert.run(stem, at)
}
