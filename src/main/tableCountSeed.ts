// src/main/tableCountSeed.ts
//
// The archive's Stems/Riffs row counts at startup without one long COUNT on
// the main thread (faster startup plan,
// docs/superpowers/plans/2026-10-06-faster-startup.md).
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
// - otherwise the same COUNT runs on a worker thread with its own read-only
//   connection, so the main process never waits on it. It is primed only
//   when no other connection committed meanwhile (the main connection's
//   MAX(rowid) and data_version, and the fingerprint, unchanged); else it
//   counts again, three times at most. A worker that can't run (it fails to
//   start or load the addon, e.g. in a packaged build that can't reach
//   better-sqlite3 from a worker -- not verifiable without running one)
//   counts on the main thread instead, as readTableSignal would have, and
//   saves that count too, so the next launch on an unchanged file reuses it.
//   A torn count (three commits in a row) leaves the memo alone:
//   readTableSignal counts, as before this module.
//   (Counting on the main thread in key-range slices was measured too:
//   about 6 s per table instead of 2, the CID indexes being much larger
//   than the small index SQLite counts with. Not kept.)
//
// Read-only connections only (the external archive): the own db's counts
// are a few ms on the internal SSD, and its writes are this process's own.
import type Database from 'better-sqlite3'
import { closeSync, fstatSync, openSync, readSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { Worker } from 'node:worker_threads'
import { noteCountInFlight, primeTableCount, readTableHead } from './tableChangeSignal'
import type { ChangeSignalTable } from './tableWriteVersion'
import { countWork } from './workCounters'

type SeededTable = 'Riffs' | 'Stems'

/** Attempts at a count no commit tore, before leaving it to readTableSignal. */
const MAX_ATTEMPTS = 3
/** A worker count still running after this is given up on (terminated). */
const WORKER_TIMEOUT_MS = 60_000

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

/** The worker's whole program: one read-only connection, one COUNT. */
const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads')
const Database = require(workerData.module)
const db = new Database(workerData.path, { readonly: true, fileMustExist: true })
try {
  const row = db.prepare('SELECT COUNT(*) AS n FROM ' + workerData.table).get()
  parentPort.postMessage(row.n)
} finally {
  db.close()
}
`

let addonPath: string | null = null

/** `table`'s COUNT(*) in the db file at `path`, counted on a worker thread
 * (its own read-only connection). Rejects when the worker can't run, the
 * count fails, or it takes longer than WORKER_TIMEOUT_MS. */
export function countRowsInWorker(path: string, table: SeededTable | 'Jams'): Promise<number> {
  return new Promise((resolve, reject) => {
    let worker: Worker
    try {
      addonPath ??= createRequire(__filename).resolve('better-sqlite3')
      worker = new Worker(WORKER_SOURCE, {
        eval: true,
        workerData: { module: addonPath, path, table }
      })
    } catch (err) {
      reject(err)
      return
    }
    let settled = false
    const timer = setTimeout(() => {
      settled = true
      void worker.terminate()
      reject(new Error(`countRowsInWorker(${table}): timed out`))
    }, WORKER_TIMEOUT_MS)
    timer.unref()
    worker.once('message', (n: unknown) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (typeof n === 'number') resolve(n)
      else reject(new Error(`countRowsInWorker(${table}): no count`))
    })
    worker.once('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(err)
    })
    worker.once('exit', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new Error(`countRowsInWorker(${table}): worker exited (${code})`))
    })
  })
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

export interface SeedTableCountsOptions {
  tables?: readonly SeededTable[]
  /** Tests: how a count is taken off the main thread (countRowsInWorker). */
  countRows?: (path: string, table: SeededTable) => Promise<number>
}

const seeding = new WeakMap<Database.Database, Promise<void>>()

/** Fills readTableSignal's count memo for `db`'s Riffs and Stems (or
 * `tables`) without a full COUNT on the main thread -- see the module
 * comment. Once per connection: a later call gets the first call's promise.
 * A saved count the file still matches is primed synchronously, before this
 * returns, so calling it right after the archive is opened (index.ts)
 * spares every later reader the COUNT; a worker count resolves later.
 * Never rejects: whatever it can't seed is left to readTableSignal. */
export function seedTableCounts(
  db: Database.Database,
  ownDb: Database.Database,
  options: SeedTableCountsOptions = {}
): Promise<void> {
  if (!db.readonly) return Promise.resolve()
  const running = seeding.get(db)
  if (running) return running
  // The tables' workers run side by side. Each is noted as in flight
  // (tableChangeSignal.ts): until it is back, readers wait for it, or put
  // their check off, instead of counting on the main thread themselves.
  const promise = Promise.all(
    (options.tables ?? (['Riffs', 'Stems'] as const)).map((table) => {
      const one = seedOne(db, ownDb, table, options).catch((err) => {
        console.error(`seedTableCounts(${table}) failed; readTableSignal will count:`, err)
      })
      noteCountInFlight(db, table, one)
      return one
    })
  ).then(() => undefined)
  seeding.set(db, promise)
  return promise
}

/** Resolves once seedTableCounts for `db` has finished (at once when none
 * was started): a reader about to call readTableSignal on the archive at
 * startup waits for the worker's count instead of taking its own on the
 * main thread. */
export function whenTableCountsSeeded(db: Database.Database): Promise<void> {
  return seeding.get(db) ?? Promise.resolve()
}

async function seedOne(
  db: Database.Database,
  ownDb: Database.Database,
  table: SeededTable,
  options: SeedTableCountsOptions
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
    let count: number
    try {
      count = await (options.countRows ?? countRowsInWorker)(db.name, table)
    } catch (err) {
      countWork(`table-count:worker-failed.${table}`)
      console.error(`seedTableCounts(${table}): counting off the main thread failed:`, err)
      countOnMainThread(db, ownDb, table)
      return
    }
    // No other connection committed while the worker counted: the file,
    // MAX(rowid) and data_version are where they were. primeTableCount
    // re-checks the head in the same synchronous step that records it.
    if (readFileFingerprint(db.name) !== printBefore) continue
    if (!primeTableCount(db, signalTable, count, before)) continue
    countWork(`table-count:worker.${table}`)
    saveCount(ownDb, db.name, table, printBefore, before.maxRowid, count)
    return
  }
  countWork(`table-count:torn.${table}`)
}

/** The worker couldn't count (it can't start or load the addon -- possible
 * in a packaged build, unverified): the same COUNT on the main thread, the
 * one readTableSignal's first reader would otherwise take -- and saved, so
 * the next launch on an unchanged file takes none (review of the
 * faster-startup commits, 2026-10-06: it used to be left to readTableSignal,
 * which can't save it, so every such launch paid it again). Readers wait for
 * this seed meanwhile. */
function countOnMainThread(
  db: Database.Database,
  ownDb: Database.Database,
  table: SeededTable
): void {
  const before = readTableHead(db, table)
  const printBefore = readFileFingerprint(db.name)
  if (!before || printBefore === null) return
  let count: number
  try {
    countWork(`table-count:main-thread.${table}`)
    count = (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n
  } catch (err) {
    console.error(`seedTableCounts(${table}): counting on the main thread failed:`, err)
    return
  }
  // One statement, but a commit could land between the head and it.
  if (readFileFingerprint(db.name) !== printBefore) return
  if (!primeTableCount(db, table, count, before)) return
  saveCount(ownDb, db.name, table, printBefore, before.maxRowid, count)
}

function saveCount(
  ownDb: Database.Database,
  key: string,
  table: SeededTable,
  fingerprint: string,
  maxRowid: number | null,
  count: number
): void {
  ownDb
    .prepare(
      `INSERT INTO SourceTableCountCache
         (SourceDbKey, TableName, Fingerprint, MaxRowid, RowCount, ComputedAt)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(SourceDbKey, TableName) DO UPDATE SET
         Fingerprint = excluded.Fingerprint, MaxRowid = excluded.MaxRowid,
         RowCount = excluded.RowCount, ComputedAt = excluded.ComputedAt`
    )
    .run(key, table, fingerprint, maxRowid, count, Date.now())
}
