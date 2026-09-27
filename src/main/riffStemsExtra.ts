// src/main/riffStemsExtra.ts
import type Database from 'better-sqlite3'
import { LORE_STEM_COLUMN_COUNT, type StemSlotRef } from '@shared/riffStemSlots'

/** The one sssketch-exclusive table that lets a rifff carry more than the
 * eight stems Riffs.StemCID_1..8 can address.
 *
 * Slots 9 and up ONLY -- the eight columns remain the sole source of truth
 * for slots 1-8, so there is never a question of which side wins. That is
 * enforced here, by CHECK, rather than left to convention.
 *
 * No FOREIGN KEY to Riffs, deliberately: SQLite only enforces one when
 * PRAGMA foreign_keys is ON, and this codebase never sets it anywhere, so
 * a declared FK would read as a guarantee and enforce nothing. It would
 * also point a sssketch-exclusive table AT the LORE-compatible one, which
 * is backwards -- Riffs is OUROVEON's shape and our extension must never
 * be able to fail a write to it. Deletion is explicit instead
 * (deleteExtraStemSlotsForRiff / ForJam), and a dangling row is harmless
 * because every read is driven FROM Riffs and simply never reaches it.
 *
 * The ceiling (MAX_RIFFF_STEM_SLOTS, currently 20) is deliberately NOT a
 * CHECK: SQLite cannot ALTER one, so encoding a product number here would
 * mean a table rebuild the first time twenty is not enough. The lower
 * bound is an invariant; the upper bound is a decision. */
export const RIFF_STEMS_EXTRA_DDL = `
CREATE TABLE IF NOT EXISTS RiffStemsExtra (
  RiffCID TEXT NOT NULL,
  Slot INTEGER NOT NULL CHECK (Slot >= ${LORE_STEM_COLUMN_COUNT + 1}),
  StemCID TEXT NOT NULL,
  PRIMARY KEY (RiffCID, Slot)
);
-- deleteJamRows asks "is this stem still referenced by ANY riff" once per
-- candidate stem; without this that question is a full scan of this table.
CREATE INDEX IF NOT EXISTS idx_riffstemsextra_stem ON RiffStemsExtra(StemCID);
`

/** Chunk size for an IN (...) bind list. SQLite's default
 * SQLITE_MAX_VARIABLE_NUMBER is 32766 on modern bundled versions; 900
 * keeps every statement in this file far away from it without anyone
 * having to think about page sizes again. */
const BIND_CHUNK = 900

/** Whether `db` carries the sssketch extension at all.
 *
 * This is THE question, and it is deliberately a question about the
 * SCHEMA, not about the connection. An external OUROVEON/LORE warehouse
 * does not have this table and is opened read-only (riffLibraryStore.ts's
 * getRiffLibraryDb), so it can never be given one -- that is the
 * constraint this whole module is shaped around.
 *
 * Two plausible alternatives are both wrong here. `Database#readonly`
 * fails in the DEFAULT configuration, because getRiffLibraryDb opens
 * whatever root is configured read-only and the default configured root IS
 * sssketch's own library -- so the own warehouse is normally open twice and
 * the read-only handle would be misread as external. Comparing db.name to
 * ownRiffLibraryDbPath() answers "which file is this" rather than "does
 * this database carry the extension", and the two come apart on an own
 * warehouse opened before the migration ran.
 *
 * Same cheap PRAGMA idiom riffLibrarySchema.ts already uses twice, against
 * the connection's in-memory schema. Called once per read operation --
 * never per riff, never per stem. */
export function hasExtraStemSlotsTable(db: Database.Database): boolean {
  return db.prepare(`PRAGMA table_info(RiffStemsExtra)`).all().length > 0
}

interface ExtraRow {
  RiffCID: string
  Slot: number
  StemCID: string
}

function collect(rows: ExtraRow[], into: Map<string, StemSlotRef[]>): void {
  for (const row of rows) {
    const list = into.get(row.RiffCID)
    const ref = { slot: row.Slot, stemCID: row.StemCID }
    if (list) list.push(ref)
    else into.set(row.RiffCID, [ref])
  }
}

/** Slots 9+ for each of `riffCIDs` that has any, batched -- never one
 * query per riff. Returns an EMPTY MAP when the table is absent, which is
 * the whole external-LORE story: no caller branches on it, so no caller
 * can forget it, and a <=8-stem rifff there falls out of the same code path
 * as everything else.
 *
 * .all(), never .iterate() -- callers include async page loops, and
 * .iterate() across an await caused a real live crash. */
export function readExtraStemSlots(
  db: Database.Database,
  riffCIDs: readonly string[]
): Map<string, StemSlotRef[]> {
  const out = new Map<string, StemSlotRef[]>()
  if (riffCIDs.length === 0 || !hasExtraStemSlotsTable(db)) return out
  for (let i = 0; i < riffCIDs.length; i += BIND_CHUNK) {
    const chunk = riffCIDs.slice(i, i + BIND_CHUNK)
    const placeholders = chunk.map(() => '?').join(',')
    const rows = db
      .prepare(
        `SELECT RiffCID, Slot, StemCID FROM RiffStemsExtra
         WHERE RiffCID IN (${placeholders}) ORDER BY RiffCID, Slot`
      )
      .all(...chunk) as ExtraRow[]
    collect(rows, out)
  }
  return out
}

/** The whole table, in one pass. For the three readers that walk ALL of
 * Riffs in pages (scanTargetCache.ts, discoverCandidates.ts,
 * discoverLibraryStems.ts): call this ONCE per database connection and
 * hold the map. Do NOT re-query it per page and never per riff -- jams
 * share one database, and per-jam loop-requerying is the pattern that
 * caused two real bugs in a day (CLAUDE.md).
 *
 * Free against an external archive, which has no such table, and small
 * against sssketch's own: only a rifff with more than eight stems has any
 * rows here at all. */
export function readAllExtraStemSlots(db: Database.Database): Map<string, StemSlotRef[]> {
  const out = new Map<string, StemSlotRef[]>()
  if (!hasExtraStemSlotsTable(db)) return out
  const rows = db
    .prepare(`SELECT RiffCID, Slot, StemCID FROM RiffStemsExtra ORDER BY RiffCID, Slot`)
    .all() as ExtraRow[]
  collect(rows, out)
  return out
}

/** Replaces this riff's slots 9+ wholesale -- delete then insert, so an
 * upsert that SHRINKS a rifff cannot leave a stale row behind pointing at
 * a stem the riff no longer has.
 *
 * Takes no transaction of its own: the one caller (writeRiffDetail) is
 * already inside one, and the Riffs row and these rows must commit or fail
 * together.
 *
 * A db with no such table is a no-op with one warning, not a throw. In
 * production that cannot happen -- openOwnRiffLibraryDb always creates the
 * table and an external archive is never written to -- so this branch only
 * ever sees a test fixture that did not paste the DDL. Dropping the extras
 * there is the same answer as reading them back as absent. */
export function writeExtraStemSlots(
  db: Database.Database,
  riffCID: string,
  extras: readonly StemSlotRef[]
): void {
  if (!hasExtraStemSlotsTable(db)) {
    if (extras.length > 0) {
      console.warn(
        `writeExtraStemSlots: no RiffStemsExtra table on ${db.name}; ` +
          `dropped ${extras.length} slot(s) past ${LORE_STEM_COLUMN_COUNT} for riff ${riffCID}`
      )
    }
    return
  }
  db.prepare(`DELETE FROM RiffStemsExtra WHERE RiffCID = ?`).run(riffCID)
  const insert = db.prepare(`INSERT INTO RiffStemsExtra (RiffCID, Slot, StemCID) VALUES (?, ?, ?)`)
  for (const extra of extras) insert.run(riffCID, extra.slot, extra.stemCID)
}

export function deleteExtraStemSlotsForRiff(db: Database.Database, riffCID: string): void {
  if (!hasExtraStemSlotsTable(db)) return
  db.prepare(`DELETE FROM RiffStemsExtra WHERE RiffCID = ?`).run(riffCID)
}

/** Every distinct StemCID a jam's riffs reference from slot 9 up. One
 * query via a subselect on Riffs -- NOT a riffCID list bound from JS,
 * which on a 20,000-riff jam would be 23 chunked statements for no reason.
 *
 * Must be called BEFORE the jam's Riffs rows are deleted; the subselect
 * depends on them. */
export function extraStemCIDsForJam(db: Database.Database, jamCID: string): string[] {
  if (!hasExtraStemSlotsTable(db)) return []
  const rows = db
    .prepare(
      `SELECT DISTINCT StemCID FROM RiffStemsExtra
       WHERE RiffCID IN (SELECT RiffCID FROM Riffs WHERE OwnerJamCID = ?)`
    )
    .all(jamCID) as { StemCID: string }[]
  return rows.map((row) => row.StemCID)
}

/** Same ordering requirement as extraStemCIDsForJam: before the Riffs
 * delete, or the subselect finds nothing and the rows are orphaned. */
export function deleteExtraStemSlotsForJam(db: Database.Database, jamCID: string): void {
  if (!hasExtraStemSlotsTable(db)) return
  db.prepare(
    `DELETE FROM RiffStemsExtra
     WHERE RiffCID IN (SELECT RiffCID FROM Riffs WHERE OwnerJamCID = ?)`
  ).run(jamCID)
}
