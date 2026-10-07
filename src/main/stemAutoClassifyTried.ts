// src/main/stemAutoClassifyTried.ts
//
// The overnight classifier's record of stems it tried and could not place
// (2026-10-07). Before this the record lived only in memory, so every launch
// re-tried the whole residue -- ~20,452 stems on Elling's library, ~10 min and
// ~4 min of main-process CPU, placing 0 -- and a session re-tried it too
// whenever any write moved the own db's Stems table (a Shared Feed sync).
//
// One row per stem: the training it was tried under (trainingFingerprintOf,
// stemAutoClassify.ts) and the Instrument mask it had then. The classifier
// leaves a stem out of its pending lists while both still match; a new
// confirmation or centroid retrain moves the fingerprint, and a mask arriving
// moves that stem's own mask. A placed stem's row is deleted; a store
// rewriting its embedding or feature row forgets it too (stemAutoClassifyWake.ts),
// since a re-extraction can change the answer.
import type Database from 'better-sqlite3'

/** Shared by riffLibrarySchema.ts and the tests' fixture dbs. New table, so
 * the migration is exactly this CREATE TABLE IF NOT EXISTS. sssketch-only,
 * on the own db, like StemAutoCategory. Mask is NULL for a stem with no mask
 * in any db. */
export const STEM_AUTO_CLASSIFY_TRIED_DDL = `
CREATE TABLE IF NOT EXISTS StemAutoClassifyTried (
  StemCID TEXT PRIMARY KEY,
  TrainingFingerprint TEXT NOT NULL,
  Mask INTEGER
);`

/** The masks of every stem tried under `fingerprint`. Ids and integers only,
 * one `.all()`. */
export function readStemsTriedUnder(
  db: Database.Database,
  fingerprint: string
): Map<string, number | null> {
  const rows = db
    .prepare(`SELECT StemCID, Mask FROM StemAutoClassifyTried WHERE TrainingFingerprint = ?`)
    .all(fingerprint) as { StemCID: string; Mask: number | null }[]
  return new Map(rows.map((r) => [r.StemCID, r.Mask]))
}

interface TriedStatements {
  record: Database.Statement
  forget: Database.Statement
}

// Prepared once per connection: the classifier records up to 200 a batch, and
// the stores forget one per row they write.
const statementsByDb = new WeakMap<Database.Database, TriedStatements | null>()

function statementsFor(db: Database.Database): TriedStatements | null {
  const cached = statementsByDb.get(db)
  if (cached !== undefined) return cached
  let statements: TriedStatements | null
  try {
    statements = {
      record: db.prepare(
        `INSERT INTO StemAutoClassifyTried (StemCID, TrainingFingerprint, Mask) VALUES (?, ?, ?)
         ON CONFLICT(StemCID) DO UPDATE SET
           TrainingFingerprint = excluded.TrainingFingerprint, Mask = excluded.Mask`
      ),
      forget: db.prepare(`DELETE FROM StemAutoClassifyTried WHERE StemCID = ?`)
    }
  } catch {
    // No such table: a db the stores write that isn't the own db (a test
    // fixture with its own schema). Nothing to record or forget there.
    statements = null
  }
  statementsByDb.set(db, statements)
  return statements
}

/** Inside the classifier's batch transaction, so the record commits with the
 * batch or not at all. */
export function recordStemTried(
  db: Database.Database,
  stemCID: string,
  fingerprint: string,
  mask: number | null
): void {
  statementsFor(db)?.record.run(stemCID, fingerprint, mask)
}

export function forgetStemTried(db: Database.Database, stemCID: string): void {
  statementsFor(db)?.forget.run(stemCID)
}
