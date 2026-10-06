// src/main/startupBackfillGate.ts
//
// What the synchronous startup passes have already done (background scan
// audit "Minor"; merge-background-scans plan Task 13 M1). Both run on every
// launch before the window opens:
// - backfillStemCategoriesFromProjectLibrary parsed every project file in
//   the library (51 files, 8 MB of JSON on Elling's machine) each time;
// - migrateEndlesssStemCache listed the old source-partitioned stem dirs
//   (and lstat'ed every entry) each time, long after the migration finished.
//
// One small table in ownDb, StartupBackfillSeen(Path PK, Stamp), remembers
// both: a project file's `size:mtimeMs` stamp once it has been backfilled
// (unchanged -> not parsed again), and a done-marker row once a migration
// pass found nothing left to move (-> the old dirs are never listed again).
import type Database from 'better-sqlite3'

/** The marker row's key for migrateEndlesssStemCache. Not a path, so it can
 * never collide with a project file's row. */
export const STEM_CACHE_MIGRATION_MARKER = 'migration:endlesss-stem-cache'
export const MIGRATION_DONE_STAMP = 'done'

const schemaReady = new WeakSet<Database.Database>()

function ensureSchema(db: Database.Database): void {
  if (schemaReady.has(db)) return
  db.exec(`CREATE TABLE IF NOT EXISTS StartupBackfillSeen (
    Path TEXT PRIMARY KEY,
    Stamp TEXT NOT NULL
  )`)
  if (!db.inTransaction) schemaReady.add(db)
}

/** A file's stamp: changes whenever its size or mtime does. */
export function fileStamp(stat: { size: number; mtimeMs: number }): string {
  return `${stat.size}:${stat.mtimeMs}`
}

/** The stamp recorded for `key`, or undefined when none. */
export function seenStamp(db: Database.Database, key: string): string | undefined {
  ensureSchema(db)
  const row = db.prepare(`SELECT Stamp FROM StartupBackfillSeen WHERE Path = ?`).get(key) as
    { Stamp: string } | undefined
  return row?.Stamp
}

/** Every recorded stamp, in one statement (the backfill asks for each
 * project file; a Map beats a SELECT per file). */
export function seenStamps(db: Database.Database): Map<string, string> {
  ensureSchema(db)
  const rows = db.prepare(`SELECT Path, Stamp FROM StartupBackfillSeen`).all() as {
    Path: string
    Stamp: string
  }[]
  return new Map(rows.map((row) => [row.Path, row.Stamp]))
}

export function recordSeen(db: Database.Database, key: string, stamp: string): void {
  ensureSchema(db)
  db.prepare(
    `INSERT INTO StartupBackfillSeen (Path, Stamp) VALUES (?, ?)
     ON CONFLICT(Path) DO UPDATE SET Stamp = excluded.Stamp`
  ).run(key, stamp)
}
