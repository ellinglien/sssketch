// src/main/stemAutoClassifyTried.ts
//
// The overnight classifier's record of stems it tried and could not place
// (2026-10-07). Before this the record lived only in memory, so every launch
// re-tried the whole residue -- ~20,452 stems on Elling's library, ~10 min and
// ~4 min of main-process CPU, placing 0 -- and a session re-tried it too
// whenever any write moved the own db's Stems table (a Shared Feed sync).
//
// One row per (stem, training): the training it was tried under
// (trainingFingerprintOf, stemAutoClassify.ts), the Instrument mask it had
// then and when. The classifier leaves a stem out of its pending lists while
// a row under the current fingerprint still has the stem's current mask; a
// new confirmation or centroid retrain moves the fingerprint, and a mask
// arriving moves that stem's own mask. A placed stem's rows are deleted (every
// fingerprint); a store rewriting its embedding or feature row forgets them
// too (stemAutoClassifyWake.ts), since a re-extraction can change the answer.
//
// Keyed on (StemCID, TrainingFingerprint), not StemCID alone (review of
// 0adc41ca): the dev and the packaged app share the own db but each has its
// own busCentroids.json, so their fingerprints differ, and with one row per
// stem each app's record overwrote the other's -- every switch between them
// re-tried the whole residue. A stem keeps its MAX_TRIED_FINGERPRINTS_PER_STEM
// newest rows, so training that moves on doesn't grow the table without bound.
import type Database from 'better-sqlite3'

/** Shared by riffLibrarySchema.ts and the tests' fixture dbs. sssketch-only,
 * on the own db, like StemAutoCategory. Mask is NULL for a stem with no mask
 * in any db; TriedAt (ms) orders a stem's rows for the per-stem cap. The
 * TrainingFingerprint index serves readStemsTriedUnder; the primary key's
 * StemCID prefix serves the deletes by stem. An own db with 0adc41ca's
 * StemCID-keyed table is migrated by ensureStemAutoClassifyTriedSchema first. */
export const STEM_AUTO_CLASSIFY_TRIED_DDL = `
CREATE TABLE IF NOT EXISTS StemAutoClassifyTried (
  StemCID TEXT NOT NULL,
  TrainingFingerprint TEXT NOT NULL,
  Mask INTEGER,
  TriedAt INTEGER NOT NULL,
  PRIMARY KEY (StemCID, TrainingFingerprint)
);
CREATE INDEX IF NOT EXISTS idx_stem_auto_classify_tried_fingerprint
  ON StemAutoClassifyTried (TrainingFingerprint);`

/** How many trainings a stem's record is kept for: the dev and the packaged
 * app (one each), plus room for a retrain in either before the other runs
 * again. Older rows are dropped when a stem is recorded. */
export const MAX_TRIED_FINGERPRINTS_PER_STEM = 4

/** Before the DDL, on every open of the own db: 0adc41ca's table (StemCID
 * the whole key, no TriedAt) is dropped, so the DDL recreates it keyed on
 * (StemCID, TrainingFingerprint). Nothing in it is lost that matters: its
 * fingerprints predate CLASSIFIER_VERSION (stemAutoClassify.ts), so no
 * classifier would read them again, and a dropped record costs one re-try.
 * One PRAGMA when the table is already current. */
export function ensureStemAutoClassifyTriedSchema(db: Database.Database): void {
  const columns = db.prepare(`PRAGMA table_info(StemAutoClassifyTried)`).all() as {
    name: string
  }[]
  if (columns.length === 0 || columns.some((c) => c.name === 'TriedAt')) return
  db.exec(`DROP TABLE StemAutoClassifyTried`)
}

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
  cap: Database.Statement
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
        `INSERT INTO StemAutoClassifyTried (StemCID, TrainingFingerprint, Mask, TriedAt)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(StemCID, TrainingFingerprint) DO UPDATE SET
           Mask = excluded.Mask, TriedAt = excluded.TriedAt`
      ),
      // The stem's rows past its newest MAX_TRIED_FINGERPRINTS_PER_STEM: a
      // primary-key range read, a handful of rows.
      cap: db.prepare(
        `DELETE FROM StemAutoClassifyTried WHERE StemCID = ? AND rowid NOT IN (
           SELECT rowid FROM StemAutoClassifyTried WHERE StemCID = ?
           ORDER BY TriedAt DESC, rowid DESC LIMIT ${MAX_TRIED_FINGERPRINTS_PER_STEM}
         )`
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
 * batch or not at all. Leaves the stem's rows under other fingerprints (the
 * other app's) alone, past the per-stem cap. */
export function recordStemTried(
  db: Database.Database,
  stemCID: string,
  fingerprint: string,
  mask: number | null,
  now: number
): void {
  const statements = statementsFor(db)
  if (!statements) return
  statements.record.run(stemCID, fingerprint, mask, now)
  statements.cap.run(stemCID, stemCID)
}

/** Every fingerprint's record of `stemCID`: it was placed, or its input
 * changed. */
export function forgetStemTried(db: Database.Database, stemCID: string): void {
  statementsFor(db)?.forget.run(stemCID)
}

/** Rows per pruneStemsTriedSlice call: a rowid range of the table, each row
 * checked by primary-key lookups -- a few ms. */
export const TRIED_PRUNE_SLICE = 2000

/** Drops, from the rows after rowid `after` (up to `limit` of them), those no
 * classifier will read again (review of 0adc41ca): the stem was placed by
 * another source (StemAutoCategory: the zero-shot pass, the other app),
 * confirmed by hand (StemCategories), or has neither an embedding nor a
 * feature row left. The classifier calls it once per pending-list rebuild
 * (a launch, a training change, the 10-minute safety wake), so the whole
 * table is swept a slice at a time, bounded per call. Returns where the
 * next slice starts: 0 once the end is reached. Own db only (it reads the
 * classifier's tables); one autocommitted DELETE. */
export function pruneStemsTriedSlice(
  db: Database.Database,
  after: number,
  limit = TRIED_PRUNE_SLICE
): number {
  const slice = db
    .prepare(
      `SELECT COUNT(*) AS n, MAX(rowid) AS last FROM (
         SELECT rowid FROM StemAutoClassifyTried WHERE rowid > ? ORDER BY rowid LIMIT ?
       )`
    )
    .get(after, limit) as { n: number; last: number | null }
  if (slice.n === 0 || slice.last === null) return 0
  db.prepare(
    `DELETE FROM StemAutoClassifyTried AS t WHERE t.rowid > ? AND t.rowid <= ? AND (
       EXISTS (SELECT 1 FROM StemAutoCategory a WHERE a.StemCID = t.StemCID)
       OR EXISTS (SELECT 1 FROM StemCategories c
                  WHERE c.StemCID = t.StemCID AND c.ArrangeRole IS NOT NULL)
       OR (NOT EXISTS (SELECT 1 FROM StemEmbeddingCache e WHERE e.StemCID = t.StemCID)
           AND NOT EXISTS (SELECT 1 FROM StemFeatureCache f WHERE f.StemCID = t.StemCID))
     )`
  ).run(after, slice.last)
  return slice.n < limit ? 0 : slice.last
}
