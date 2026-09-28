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

/** The tables anything in this app currently change-checks. Deliberately a
 * closed union rather than a plain string: the name is interpolated
 * straight into SQL below (a bound parameter cannot name a table), so the
 * type is what keeps that interpolation safe. */
export type ChangeSignalTable = 'Jams' | 'Riffs' | 'Stems'

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
 * deletes) and, for in-place updates, the connection's own write count
 * (total_changes) and whether another connection committed (data_version).
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
  changes: number | null
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
  try {
    const row = db
      .prepare(
        `SELECT MAX(rowid) AS maxRowid, total_changes() AS changes,
                (SELECT data_version FROM pragma_data_version) AS dataVersion,
                COUNT(*) AS n FROM ${table}`
      )
      .get() as { maxRowid: number | null; changes: number; dataVersion: number; n: number }
    return {
      count: row.n,
      maxRowid: row.maxRowid,
      changes: row.changes,
      dataVersion: row.dataVersion
    }
  } catch {
    try {
      const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }
      return { count: row.n, maxRowid: null, changes: null, dataVersion: null }
    } catch {
      return null
    }
  }
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
  const live = readTableSignal(db, table)
  const built = state.signal
  if (!live || !built) return !live && !built
  if (live.count !== built.count || live.maxRowid !== built.maxRowid) return false
  const writtenInPlace = live.changes !== built.changes || live.dataVersion !== built.dataVersion
  return !(writtenInPlace && now - state.builtAt >= SCAN_CACHE_INPLACE_TTL_MS)
}
