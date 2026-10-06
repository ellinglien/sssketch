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
 * null when the table has no rowid (count alone then).
 *
 * `count` is the expensive part (a full COUNT is 0.5-1.3 s cold on the USB
 * archive), so it is memoised per connection and table (CountMemo below)
 * and re-taken only when the cheap part says the table could have moved. */
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

/** What a COUNT was taken against, so the next read can tell whether the
 * table could have changed since -- one per (connection, table), shared by
 * every cache that change-checks that table (background scan audit item 1,
 * 2026-10-05). Before it, up to seven caches each ran their own COUNT on
 * their own 30 s clock: 562 ms (Riffs) / 1,342 ms (Stems) cold on Elling's
 * USB archive, synchronous on the main process.
 *
 * The guard is exact, not a time window, so a cache sees a change exactly
 * as soon as it did before:
 * - every connection: MAX(rowid), data_version (another connection
 *   committed to the FILE) and this process's own write count;
 * - a read-write connection also: total_changes() (every row THIS
 *   connection has inserted/updated/deleted, in any table). A read-only
 *   connection cannot write, so any change to its rows is another
 *   connection's commit, which data_version already sees.
 * Nothing moved, so no row was added, removed or changed by anyone: the
 * count is the count. Anything moved (the classifier writing ownDb's cache
 * tables moves total_changes every few seconds): count again. */
interface CountMemo {
  maxRowid: number | null
  dataVersion: number
  writes: number
  totalChanges: number | null
  count: number
}
const countMemos = new WeakMap<Database.Database, Map<ChangeSignalTable, CountMemo>>()

function memoFor(db: Database.Database, table: ChangeSignalTable): CountMemo | undefined {
  return countMemos.get(db)?.get(table)
}

function remember(db: Database.Database, table: ChangeSignalTable, memo: CountMemo): void {
  let perTable = countMemos.get(db)
  if (!perTable) {
    perTable = new Map()
    countMemos.set(db, perTable)
  }
  perTable.set(table, memo)
}

/** Counts being taken elsewhere right now: tableCountSeed.ts counts the
 * archive's Riffs/Stems on a worker thread at startup and primes the memo
 * above when it's back. A reader that counted meanwhile would block the main
 * process on the very statement the worker is there to take off it (1.7-2.3 s
 * cold on Elling's USB archive; review of the faster-startup commits,
 * 2026-10-06). Readers wait (readTableSignalSettled, whenTableCountsSettled,
 * whenAllTableCountsSettled); a cached scan's check is put off
 * (isScanCacheCurrent); one that counts anyway is noted (countedSignal). */
const countsInFlight = new WeakMap<Database.Database, Map<ChangeSignalTable, Promise<void>>>()
const allCountsInFlight = new Set<Promise<void>>()

/** Records that `count` (which never needs to resolve to anything) is taking
 * `table`'s row count for `db` and will prime it: until it settles,
 * isTableCountInFlight is true and the waits below wait for it. */
export function noteCountInFlight(
  db: Database.Database,
  table: ChangeSignalTable,
  count: Promise<unknown>
): void {
  let perTable = countsInFlight.get(db)
  if (!perTable) {
    perTable = new Map()
    countsInFlight.set(db, perTable)
  }
  const tables = perTable
  const settled: Promise<void> = count.then(
    () => forget(),
    () => forget()
  )
  function forget(): void {
    if (tables.get(table) === settled) tables.delete(table)
    allCountsInFlight.delete(settled)
  }
  tables.set(table, settled)
  allCountsInFlight.add(settled)
}

export function isTableCountInFlight(db: Database.Database, table: ChangeSignalTable): boolean {
  return countsInFlight.get(db)?.has(table) ?? false
}

/** Resolves once every count in flight for `db` (or for `tables` of it) has
 * settled -- at once when none is. Never rejects. */
export function whenTableCountsSettled(
  db: Database.Database,
  tables?: readonly ChangeSignalTable[]
): Promise<void> {
  const perTable = countsInFlight.get(db)
  if (!perTable || perTable.size === 0) return Promise.resolve()
  const waits = [...perTable]
    .filter(([table]) => !tables || tables.includes(table))
    .map(([, settled]) => settled)
  return waits.length === 0 ? Promise.resolve() : Promise.all(waits).then(() => undefined)
}

/** whenTableCountsSettled for every db: for a reader that can't name its dbs
 * before reading (listJamsWithDb, the IPC handlers built on it). */
export function whenAllTableCountsSettled(): Promise<void> {
  if (allCountsInFlight.size === 0) return Promise.resolve()
  return Promise.all([...allCountsInFlight]).then(() => undefined)
}

/** readTableSignal once any count in flight for `db`'s `table` is back -- so
 * it answers from that count instead of taking its own. */
export async function readTableSignalSettled(
  db: Database.Database,
  table: ChangeSignalTable
): Promise<TableSignal | null> {
  await whenTableCountsSettled(db, [table])
  return readTableSignal(db, table)
}

const warnedDuringSeed = new WeakMap<Database.Database, Set<ChangeSignalTable>>()

/** A COUNT about to run while the same count is being taken elsewhere: a
 * reader that should have waited. Counted for the dev [work] line, and
 * logged once per db and table with where it came from. */
function noteCountDuringSeed(db: Database.Database, table: ChangeSignalTable): void {
  countWork(`sql:signal-count-during-seed.${table}`)
  let warned = warnedDuringSeed.get(db)
  if (!warned) {
    warned = new Set()
    warnedDuringSeed.set(db, warned)
  }
  if (warned.has(table)) return
  warned.add(table)
  console.warn(
    `readTableSignal(${table}): counting on the main thread while the worker counts -- ` +
      `this reader should wait (readTableSignalSettled):\n${new Error().stack ?? ''}`
  )
}

/** The live TableSignal for `table`, or null when it can't be read (a
 * broken/foreign db missing the table -- same "not an error" convention as
 * every other query in this area). Runs `COUNT(*) AS n FROM <table>` only
 * when the cheap half of the signal (CountMemo above) says the table could
 * have changed since the last count on this connection.
 *
 * Synchronous, so it can't wait for a count in flight elsewhere
 * (noteCountInFlight): a reader that may run while one is should use
 * readTableSignalSettled, or wait first. */
export function readTableSignal(
  db: Database.Database,
  table: ChangeSignalTable
): TableSignal | null {
  const started = performance.now()
  try {
    return readSignal(db, table)
  } finally {
    countWork(`ms:signal.${table}`, Math.round(performance.now() - started))
  }
}

/** The cheap half of a table's signal, with no COUNT: MAX(rowid),
 * data_version (another connection committed to the file) and this
 * process's own writes to the table (tableWriteVersion.ts -- every writer
 * of Jams/Riffs/Stems here bumps it). None moved: no row of the table was
 * added, removed or changed by anyone, whatever else the connection wrote
 * (the classifier's own-db analysis tables move total_changes(), which
 * the COUNT memo below has to respect; a caller that only asks "did this
 * table move?" need not). Null when the table has no rowid or can't be
 * read. */
export interface TableHead {
  maxRowid: number | null
  dataVersion: number
  writes: number
}

export function readTableHead(db: Database.Database, table: ChangeSignalTable): TableHead | null {
  // Taken before the query, as readTableSignal always has.
  const writes = getTableWriteVersion(db, table)
  try {
    const head = db
      .prepare(
        `SELECT MAX(rowid) AS maxRowid,
                (SELECT data_version FROM pragma_data_version) AS dataVersion FROM ${table}`
      )
      .get() as { maxRowid: number | null; dataVersion: number }
    return { maxRowid: head.maxRowid, dataVersion: head.dataVersion, writes }
  } catch {
    return null
  }
}

export function sameTableHead(a: TableHead, b: TableHead): boolean {
  return a.maxRowid === b.maxRowid && a.dataVersion === b.dataVersion && a.writes === b.writes
}

/** Records `count` as `table`'s row count right now, as if readTableSignal
 * had just counted it: the next readTableSignal answers it with no COUNT
 * while the cheap half of the signal has not moved (CountMemo above). For a
 * count known without counting (tableCountSeed.ts: the archive file is
 * unchanged since a saved count, or a sliced count that just finished) --
 * the first COUNT of the archive's Stems is 2.3 s cold off the USB drive,
 * one synchronous statement. The caller vouches for the count; `expect`,
 * when given, is the head it was taken at: a head that has moved since
 * (another connection committed, or this process wrote the table) refuses.
 * False (nothing recorded) then, inside a transaction, or when the table
 * can't be read. */
export function primeTableCount(
  db: Database.Database,
  table: ChangeSignalTable,
  count: number,
  expect?: TableHead
): boolean {
  if (db.inTransaction) return false
  const read = readTableHead(db, table)
  if (!read || (expect && !sameTableHead(read, expect))) return false
  const { writes, ...head } = read
  try {
    const totalChanges = db.readonly
      ? null
      : (db.prepare(`SELECT total_changes() AS n`).get() as { n: number }).n
    remember(db, table, { ...head, writes, totalChanges, count })
    return true
  } catch {
    return false
  }
}

function readSignal(db: Database.Database, table: ChangeSignalTable): TableSignal | null {
  const read = readTableHead(db, table)
  if (!read) {
    // No rowid (or no table): the count alone, never memoised.
    try {
      countWork(`sql:signal-count.${table}`)
      const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }
      return {
        count: row.n,
        maxRowid: null,
        writes: getTableWriteVersion(db, table),
        dataVersion: null
      }
    } catch {
      return null
    }
  }
  const { writes, ...head } = read
  // Every read below can still fail (an I/O error on the USB volume, a
  // busy connection): null, the same "can't read it" answer as a missing
  // table -- callers treat that as no signal, never as an exception.
  try {
    return countedSignal(db, table, head, writes)
  } catch {
    return null
  }
}

function countedSignal(
  db: Database.Database,
  table: ChangeSignalTable,
  head: { maxRowid: number | null; dataVersion: number },
  writes: number
): TableSignal {
  const totalChanges = db.readonly
    ? null
    : (db.prepare(`SELECT total_changes() AS n`).get() as { n: number }).n
  // Inside an open transaction the rows may yet roll back, which
  // total_changes() would not undo: count, and don't remember it.
  const memo = db.inTransaction ? undefined : memoFor(db, table)
  let count: number
  if (
    memo &&
    memo.maxRowid === head.maxRowid &&
    memo.dataVersion === head.dataVersion &&
    memo.writes === writes &&
    memo.totalChanges === totalChanges
  ) {
    countWork(`signal:count-reused.${table}`)
    count = memo.count
  } else {
    if (isTableCountInFlight(db, table)) noteCountDuringSeed(db, table)
    countWork(`sql:signal-count.${table}`)
    count = (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n
    if (!db.inTransaction) remember(db, table, { ...head, writes, totalChanges, count })
  }
  return { count, maxRowid: head.maxRowid, writes, dataVersion: head.dataVersion }
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
 * the checks to one per CACHE_CHANGE_CHECK_INTERVAL_MS.
 *
 * While the table's count is in flight elsewhere (noteCountInFlight), the
 * check is put off, not taken: current for now, and `checkedAt` is left
 * alone so the first call after the count lands really checks. A few
 * seconds' grace, against a 30-second interval. */
export function isScanCacheCurrent(
  db: Database.Database,
  table: ChangeSignalTable,
  state: ScanCacheState
): boolean {
  const now = Date.now()
  if (now - state.checkedAt < CACHE_CHANGE_CHECK_INTERVAL_MS) return true
  if (isTableCountInFlight(db, table)) {
    countWork(`signal:check-deferred.${table}`)
    return true
  }
  state.checkedAt = now
  countWork(`sql:cache-check.${table}`)
  return isTableSignalCurrent(state.signal, readTableSignal(db, table), state.builtAt, now)
}
