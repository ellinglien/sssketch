// src/main/tableCountSeed.ts
//
// The archive's Stems/Riffs row counts at startup without one long COUNT
// (faster startup plan, docs/superpowers/plans/2026-10-06-faster-startup.md).
//
// readTableSignal (tableChangeSignal.ts) needs a live count -- the shared
// extend-or-rebuild rule (rowidWatermark.ts) rests on it, it is how a delete
// below a watermark is seen -- and it memoises the count per connection.
// But the first count of a launch is one synchronous statement: measured
// 1.7-2.3 s cold on Elling's USB archive (891k Stems, 900k Riffs), the
// longest block of the whole startup. This module fills that memo first:
// - the archive FILE is unchanged since a count saved in ownDb (its
//   fingerprint: the SQLite header's file-change counter, which every commit
//   bumps in rollback-journal mode, plus the db's and any -wal's size and
//   mtime) and MAX(rowid) agrees: that count is the count. No SQL beyond
//   the head. Most launches don't follow a sync.
// - otherwise it counts in key-range slices (slicedKeyRangeCount), each a
//   covering-index range count, yielding between them: measured 5.5-6.5 s
//   in total cold, against 2.3 s for the one statement, but never more than
//   about 100 ms at once with 256 ranges (4,096 are used). A count is only
//   primed when no other connection committed while the slices ran
//   (data_version and MAX(rowid) unchanged, and the fingerprint too).
//
// Read-only connections only (the external archive): the own db's counts
// are a few ms on the internal SSD, and its writes are this process's own.
import type Database from 'better-sqlite3'
import { closeSync, fstatSync, openSync, readSync, statSync } from 'node:fs'
import { primeTableCount, readTableHead } from './tableChangeSignal'
import type { ChangeSignalTable } from './tableWriteVersion'
import { countWork } from './workCounters'

type SeededTable = 'Riffs' | 'Stems'

const KEY_COLUMN: Record<SeededTable, string> = { Riffs: 'RiffCID', Stems: 'StemCID' }

/** Main-process budget for slices between yields. */
const SLICE_MS = 8
/** Attempts at a count no commit tore, before leaving it to readTableSignal. */
const MAX_ATTEMPTS = 3

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

/** The file's identity for "has anything been committed since": the SQLite
 * header's file-change counter (bytes 24-27), the db's size and mtime, and
 * the -wal's size and mtime when one exists. Null when `path` is not a file
 * (an in-memory or temporary db, a missing file) or can't be read. */
export function readFileFingerprint(path: string): string | null {
  if (path === '' || path === ':memory:') return null
  let fd: number | null = null
  try {
    fd = openSync(path, 'r')
    const header = Buffer.alloc(100)
    if (readSync(fd, header, 0, 100, 0) < 100) return null
    const db = fstatSync(fd)
    let wal = '-'
    try {
      const w = statSync(`${path}-wal`)
      wal = `${w.size}@${w.mtimeMs}`
    } catch {
      // No -wal: a rollback-journal db, or a WAL db with nothing pending.
    }
    return `${header.readUInt32BE(24)}:${db.size}@${db.mtimeMs}:${wal}`
  } catch {
    return null
  } finally {
    if (fd !== null) closeSync(fd)
  }
}

export interface SlicedCountOptions {
  /** Ranges are the 16^hexDigits key prefixes (default 3: 4,096 ranges). */
  hexDigits?: number
}

/** COUNT(*) of `table`, as key-range counts with yields between them. Every
 * value has exactly one range, whatever its shape: `< b1`, `[b_i, b_i+1)`,
 * `>= b_last` (numbers sort below text and blobs above it in SQLite, so
 * they land in the first and last range), plus `IS NULL`. Throws what a
 * slice throws (a missing table or column). */
export async function slicedKeyRangeCount(
  db: Database.Database,
  table: SeededTable,
  options: SlicedCountOptions = {}
): Promise<number> {
  const key = KEY_COLUMN[table]
  const digits = options.hexDigits ?? 3
  const ranges = 16 ** digits
  const bound = (i: number): string => i.toString(16).padStart(digits, '0')
  const below = db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${key} < ?`)
  const between = db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${key} >= ? AND ${key} < ?`)
  const above = db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${key} >= ?`)
  const nulls = db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${key} IS NULL`)
  let total = (nulls.get() as { n: number }).n + (below.get(bound(1)) as { n: number }).n
  let started = performance.now()
  for (let i = 1; i < ranges - 1; i++) {
    total += (between.get(bound(i), bound(i + 1)) as { n: number }).n
    if (performance.now() - started >= SLICE_MS) {
      await yieldToEventLoop()
      started = performance.now()
    }
  }
  total += (above.get(bound(ranges - 1)) as { n: number }).n
  countWork(`table-count:sliced.${table}`)
  return total
}

function ensureSchema(ownDb: Database.Database): void {
  ownDb.exec(`CREATE TABLE IF NOT EXISTS SourceTableCountCache (
    SourceDbKey TEXT NOT NULL,
    TableName TEXT NOT NULL,
    Fingerprint TEXT NOT NULL,
    MaxRowid INTEGER,
    RowCount INTEGER NOT NULL,
    ComputedAt INTEGER NOT NULL,
    PRIMARY KEY (SourceDbKey, TableName)
  )`)
}

export interface SeedTableCountsOptions extends SlicedCountOptions {
  tables?: readonly SeededTable[]
}

/** Fills readTableSignal's count memo for `db`'s Riffs and Stems (or
 * `tables`) without a full COUNT -- see the module comment. Never throws:
 * whatever it can't seed is left to readTableSignal's own COUNT. */
export async function seedTableCounts(
  db: Database.Database,
  ownDb: Database.Database,
  options: SeedTableCountsOptions = {}
): Promise<void> {
  if (!db.readonly) return
  for (const table of options.tables ?? (['Riffs', 'Stems'] as const)) {
    try {
      await seedOne(db, ownDb, table, options)
    } catch (err) {
      console.error(`seedTableCounts(${table}) failed; readTableSignal will count:`, err)
    }
  }
}

async function seedOne(
  db: Database.Database,
  ownDb: Database.Database,
  table: SeededTable,
  options: SlicedCountOptions
): Promise<void> {
  ensureSchema(ownDb)
  const signalTable: ChangeSignalTable = table
  const head = readTableHead(db, signalTable)
  const fingerprint = readFileFingerprint(db.name)
  if (!head || fingerprint === null) return
  const saved = ownDb
    .prepare(
      `SELECT Fingerprint, MaxRowid, RowCount FROM SourceTableCountCache
       WHERE SourceDbKey = ? AND TableName = ?`
    )
    .get(db.name, table) as
    { Fingerprint: string; MaxRowid: number | null; RowCount: number } | undefined
  if (saved && saved.Fingerprint === fingerprint && saved.MaxRowid === head.maxRowid) {
    if (primeTableCount(db, signalTable, saved.RowCount, head)) {
      countWork(`table-count:reused.${table}`)
    }
    return
  }
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const before = readTableHead(db, signalTable)
    const printBefore = readFileFingerprint(db.name)
    if (!before || printBefore === null) return
    const count = await slicedKeyRangeCount(db, table, options)
    // No other connection committed while the slices ran: the file, MAX(rowid)
    // and data_version are where they were. primeTableCount re-checks the head
    // in the same synchronous step that records it.
    if (readFileFingerprint(db.name) !== printBefore) continue
    if (!primeTableCount(db, signalTable, count, before)) continue
    ownDb
      .prepare(
        `INSERT INTO SourceTableCountCache
           (SourceDbKey, TableName, Fingerprint, MaxRowid, RowCount, ComputedAt)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(SourceDbKey, TableName) DO UPDATE SET
           Fingerprint = excluded.Fingerprint, MaxRowid = excluded.MaxRowid,
           RowCount = excluded.RowCount, ComputedAt = excluded.ComputedAt`
      )
      .run(db.name, table, printBefore, before.maxRowid, count, Date.now())
    return
  }
  countWork(`table-count:torn.${table}`)
}
