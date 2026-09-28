// src/main/tableChangeSignal.ts
//
// "Has this table moved since I last read it?" -- the cheap change check
// that lets a main-process cache of an expensive read survive until its
// source actually changes, instead of expiring on a timer and paying the
// full cost again for an answer that did not change.
//
// Lived inside discoverCandidates.ts until 2026-09-28, where background
// efficiency B3 introduced it for the riff-index/instrument-row scans.
// Extracted when riffLibraryStore.ts's own listJamsWithDb needed the same
// treatment: importing the whole Discover candidate module from a core
// library-store module would be the wrong dependency direction, and this
// is a self-contained idea with one responsibility. No 'electron' import,
// so it stays testable from plain vitest -- same convention as
// stemClassificationVersion.ts.
import type Database from 'better-sqlite3'
import { countWork } from './workCounters'
import { getTableWriteVersion, type ChangeSignalTable } from './tableWriteVersion'

// Re-exported from its new home so existing importers are unaffected --
// the type moved to tableWriteVersion.ts only because that module needs
// it too and must not import from here (see its own doc comment).
export type { ChangeSignalTable }

/** How often a cached scan re-checks its source table -- a caller pays for
 * readTableSignal at most this often per db+table. */
export const CACHE_CHANGE_CHECK_INTERVAL_MS = 30_000

/** Upper bound for changes a row count cannot see: an in-place UPDATE (a
 * skeleton riff filled in by the sync, a renamed jam). A cache older than
 * this whose db reports in-place writes is treated as stale.
 *
 * Was RIFF_INDEX_CACHE_TTL_MS in discoverCandidates.ts, where it used to
 * be a plain expiry that forced a full rescan every 5 minutes even when
 * nothing had changed (background efficiency B3 made it the narrower thing
 * it is now). Same value, same meaning, just no longer riff-specific. */
export const SCAN_CACHE_INPLACE_TTL_MS = 5 * 60_000

/** A table's cheap change signal: row count + MAX(rowid) (inserts,
 * deletes), this process's own PER-TABLE write count (in-place updates --
 * tableWriteVersion.ts) and whether another connection committed to the
 * file (data_version).
 *
 * `writes` replaced SQLite's `total_changes()` on 2026-09-28. That
 * counter is per-CONNECTION and spans every table, and since the
 * background classifier writes StemAutoCategory/StemFeatureCache on the
 * very same connection that holds Jams/Riffs/Stems, it moved every few
 * seconds regardless of whether the guarded table had changed at all --
 * which quietly turned this whole mechanism back into the plain timer it
 * was built to replace. See tableWriteVersion.ts for the full account.
 * Measured on Elling's real external archive (2026-09-22, 372k riffs /
 * 367k stems, read-only, rowid tables): MAX(rowid) ~1 ms, the combined
 * query ~7 ms warm. Re-measured 2026-09-28 against the same archive with a
 * cold page cache -- it is a USB/ExFAT volume, so this matters: 300 ms for
 * Riffs, 5 ms for Jams, both ~1-7 ms once warm. Still an order of
 * magnitude under the read it protects. maxRowid/changes/dataVersion are
 * null when the table has no rowid (count alone then). */
export interface TableSignal {
  count: number
  maxRowid: number | null
  /** This process's own writes to THIS table (tableWriteVersion.ts). */
  writes: number
  dataVersion: number | null
}

/** When a scan cache was built, when it was last change-checked, and the
 * signal it was built against (null for a db missing the table). */
export interface ScanCacheState {
  builtAt: number
  checkedAt: number
  signal: TableSignal | null
}

/** The live TableSignal for `table`, or null when it can't be read (a
 * broken/foreign db missing the table -- same "not an error" convention as
 * every other query in this area). Its text keeps `COUNT(*) AS n FROM
 * <table>` so it reads as the count it mostly is. */
export function readTableSignal(
  db: Database.Database,
  table: ChangeSignalTable
): TableSignal | null {
  const writes = getTableWriteVersion(db, table)
  try {
    const row = db
      .prepare(
        `SELECT MAX(rowid) AS maxRowid,
                (SELECT data_version FROM pragma_data_version) AS dataVersion,
                COUNT(*) AS n FROM ${table}`
      )
      .get() as { maxRowid: number | null; dataVersion: number; n: number }
    return {
      count: row.n,
      maxRowid: row.maxRowid,
      writes,
      dataVersion: row.dataVersion
    }
  } catch {
    try {
      const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }
      return { count: row.n, maxRowid: null, writes, dataVersion: null }
    } catch {
      return null
    }
  }
}

/** The pure decision behind isScanCacheCurrent -- whether a cache built
 * against `built` is still good now that the table reads `live`.
 *
 * Split out so it can be tested without opening a database (every
 * better-sqlite3-touching test file has to be excluded from CI -- see
 * vitest.config.ts). Both null means "this db has never had this table,
 * and still doesn't," which is not a change. */
export function isTableSignalCurrent(
  built: TableSignal | null,
  live: TableSignal | null,
  builtAt: number,
  now: number
): boolean {
  if (!live || !built) return !live && !built
  if (live.count !== built.count || live.maxRowid !== built.maxRowid) return false
  // Ours, and exact: no grace period, because we know the write landed on
  // THIS table.
  if (live.writes !== built.writes) return false
  // Somebody else's, and unattributable: data_version says the FILE was
  // committed to by another connection, never which table. Kept as the
  // same soft signal it always was -- an external LORE sync writing the
  // archive out from under us is real, and count/maxRowid may not see it
  // if it only filled fields in.
  const foreignCommit = live.dataVersion !== built.dataVersion
  return !(foreignCommit && now - builtAt >= SCAN_CACHE_INPLACE_TTL_MS)
}

export function newScanCacheState(signal: TableSignal | null): ScanCacheState {
  const now = Date.now()
  return { builtAt: now, checkedAt: now, signal }
}

/** Whether a cached scan of `table` is still current -- true without any
 * query inside the check interval; otherwise one readTableSignal. Stale
 * when rows were added/removed (count or MAX(rowid) moved), or when the
 * table was written in place (write counters moved) and the cache is older
 * than SCAN_CACHE_INPLACE_TTL_MS.
 *
 * Mutates `state.checkedAt` as a deliberate part of its contract -- the
 * caller holds one ScanCacheState per cached scan and this is what rations
 * the checks to one per CACHE_CHANGE_CHECK_INTERVAL_MS. */
export function isScanCacheCurrent(
  db: Database.Database,
  table: ChangeSignalTable,
  state: ScanCacheState
): boolean {
  const now = Date.now()
  if (now - state.checkedAt < CACHE_CHANGE_CHECK_INTERVAL_MS) return true
  state.checkedAt = now
  countWork(`sql:cache-check.${table}`)
  return isTableSignalCurrent(state.signal, readTableSignal(db, table), state.builtAt, now)
}
