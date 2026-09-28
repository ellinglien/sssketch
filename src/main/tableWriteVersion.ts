// src/main/tableWriteVersion.ts
//
// In-process, PER-TABLE write counter -- bumped by this app's own writers
// (riffLibraryWriter.ts), read by tableChangeSignal.ts as the "was this
// table written in place?" half of a cache's change signal.
//
// Exists because the thing it replaces could not be scoped to a table.
// tableChangeSignal.ts used to detect in-place writes with SQLite's
// `total_changes()`, which counts every row the CONNECTION has modified
// since it was opened, across ALL tables. Jams/Riffs/Stems and the
// classifier's StemAutoCategory/StemFeatureCache/StemEmbeddingCache/
// StemPeaksCache all live in ONE schema, ONE file, behind ONE cached
// connection (riffLibrarySchema.ts's openOwnRiffLibraryDb), and the
// background classifier writes those analysis tables continuously -- so
// `total_changes()` moved every few seconds no matter what, the
// "written in place" test was permanently true, and every cache guarded
// by it silently degraded to a plain SCAN_CACHE_INPLACE_TTL_MS timer.
// Measured 2026-09-28 on Elling's own archive: listJamsWithDb still
// costing 177-690ms on the calls that re-checked, which is exactly what
// 8d81f22 set out to stop.
//
// O(1) both ways. The Database object is used ONLY as a WeakMap key, never
// as a connection -- which is also what keeps this module (and its test)
// free of the better-sqlite3 addon. Same shape and same reasoning as
// stemClassificationVersion.ts, just keyed per table as well as per db.
import type Database from 'better-sqlite3'

/** The tables anything in this app currently change-checks. Deliberately a
 * closed union rather than a plain string: tableChangeSignal.ts
 * interpolates the name straight into SQL (a bound parameter cannot name
 * a table), so the type is what keeps that interpolation safe. */
export type ChangeSignalTable = 'Jams' | 'Riffs' | 'Stems'

const versions = new WeakMap<Database.Database, Map<ChangeSignalTable, number>>()

/** Records that this process wrote to `table` on `db`. Call it for an
 * in-place UPDATE as well as an INSERT/DELETE: inserts and deletes are
 * already visible to a row count, but an update is exactly what a count
 * cannot see, and is the reason this counter exists. */
export function bumpTableWriteVersion(db: Database.Database, table: ChangeSignalTable): void {
  let perTable = versions.get(db)
  if (!perTable) {
    perTable = new Map()
    versions.set(db, perTable)
  }
  perTable.set(table, (perTable.get(table) ?? 0) + 1)
}

export function getTableWriteVersion(db: Database.Database, table: ChangeSignalTable): number {
  return versions.get(db)?.get(table) ?? 0
}
