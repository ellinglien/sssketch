// src/main/tableCountSeed.test.ts
//
// The archive's row counts known at startup without one long COUNT on the
// main thread (faster
// startup plan, docs/superpowers/plans/2026-10-06-faster-startup.md). Opens
// databases, so it is on vitest.config.ts's CI exclusion list.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readTableSignal } from './tableChangeSignal'
import {
  countRowsInWorker,
  readFileFingerprint,
  seedTableCounts,
  whenTableCountsSeeded
} from './tableCountSeed'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'table-count-seed-'))
})
afterEach(() => {
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

function hex(i: number): string {
  return (i * 2654435761).toString(16).padStart(8, '0').slice(-8) + 'abcdef0123456789abcdef01'
}

/** A LORE-shaped archive (rollback journal, as his is) with `stems` Stems and
 * `riffs` Riffs rows. */
function archive(stems: number, riffs: number): string {
  const path = join(dir, 'archive.db')
  const db = new Database(path)
  db.pragma('journal_mode = DELETE')
  db.exec(`CREATE TABLE Stems (StemCID TEXT NOT NULL UNIQUE, Note TEXT, PRIMARY KEY(StemCID));
           CREATE TABLE Riffs (RiffCID TEXT NOT NULL UNIQUE, Note TEXT, PRIMARY KEY(RiffCID))`)
  const s = db.prepare(`INSERT INTO Stems (StemCID) VALUES (?)`)
  const r = db.prepare(`INSERT INTO Riffs (RiffCID) VALUES (?)`)
  db.transaction(() => {
    for (let i = 0; i < stems; i++) s.run(hex(i))
    for (let i = 0; i < riffs; i++) r.run(`r${hex(i)}`)
  })()
  db.close()
  return path
}

function ownDb(): Database.Database {
  return new Database(join(dir, 'own.db'))
}

/** How many full-table counts `db` has run since the spy went on. */
function fullCounts(db: Database.Database): () => number {
  const spy = vi.spyOn(db, 'prepare')
  return () =>
    spy.mock.calls.filter(([sql]) => /COUNT\(\*\) AS n FROM (Stems|Riffs)$/.test(String(sql)))
      .length
}

describe('countRowsInWorker', () => {
  it("counts on a worker thread's own read-only connection", async () => {
    const path = archive(1234, 56)
    expect(await countRowsInWorker(path, 'Stems')).toBe(1234)
    expect(await countRowsInWorker(path, 'Riffs')).toBe(56)
  })

  it('rejects for a table the file lacks, or a file that is not there', async () => {
    const path = archive(1, 1)
    await expect(countRowsInWorker(path, 'Jams')).rejects.toThrow()
    await expect(countRowsInWorker(join(dir, 'missing.db'), 'Stems')).rejects.toThrow()
  })
})

describe('readFileFingerprint', () => {
  it('moves with a commit, stays put for reads, and is null for a db with no file', () => {
    const path = archive(10, 10)
    const before = readFileFingerprint(path)
    expect(before).not.toBeNull()
    const ro = new Database(path, { readonly: true })
    ro.prepare(`SELECT COUNT(*) FROM Stems`).get()
    expect(readFileFingerprint(path)).toBe(before)
    const rw = new Database(path)
    rw.prepare(`INSERT INTO Stems (StemCID) VALUES ('x')`).run()
    expect(readFileFingerprint(path)).not.toBe(before)
    expect(readFileFingerprint('')).toBeNull()
    expect(readFileFingerprint(':memory:')).toBeNull()
    expect(readFileFingerprint(join(dir, 'missing.db'))).toBeNull()
  })
})

describe('seedTableCounts', () => {
  it('counts off the main thread the first time, then reuses the saved count while the file is unchanged', async () => {
    const path = archive(300, 200)
    const own = ownDb()
    const first = new Database(path, { readonly: true })
    const firstCounts = fullCounts(first)
    await seedTableCounts(first, own)
    expect(readTableSignal(first, 'Stems')?.count).toBe(300)
    expect(readTableSignal(first, 'Riffs')?.count).toBe(200)
    expect(firstCounts()).toBe(0)
    first.close()

    // Next launch: a new connection, nothing in memory.
    const second = new Database(path, { readonly: true })
    const prepare = vi.spyOn(second, 'prepare')
    await seedTableCounts(second, own)
    expect(prepare.mock.calls.some(([sql]) => String(sql).includes('COUNT(*)'))).toBe(false)
    expect(readTableSignal(second, 'Stems')?.count).toBe(300)
    expect(readTableSignal(second, 'Riffs')?.count).toBe(200)
  })

  it('counts again when the file changed since the saved count (a sync)', async () => {
    const path = archive(300, 200)
    const own = ownDb()
    const first = new Database(path, { readonly: true })
    await seedTableCounts(first, own)
    first.close()
    const rw = new Database(path)
    // A delete below the top and an insert: same MAX(rowid) shape is not enough.
    rw.prepare(`DELETE FROM Stems WHERE rowid = 10`).run()
    rw.prepare(`INSERT INTO Stems (StemCID) VALUES ('zz-new')`).run()
    rw.close()
    const second = new Database(path, { readonly: true })
    const counted = fullCounts(second)
    await seedTableCounts(second, own)
    expect(readTableSignal(second, 'Stems')?.count).toBe(300)
    expect(counted()).toBe(0)
  })

  it('a commit landing during the count is not primed from a torn count', async () => {
    const path = archive(300, 0)
    const own = ownDb()
    const ro = new Database(path, { readonly: true })
    const rw = new Database(path)
    let calls = 0
    // Counts, then a commit lands before the count is back: twice.
    const countRows = async (file: string, table: string): Promise<number> => {
      const n = await countRowsInWorker(file, table as 'Stems')
      if (calls++ < 2) rw.prepare(`INSERT INTO Stems (StemCID) VALUES (?)`).run(`late${calls}`)
      return n
    }
    const counted = fullCounts(ro)
    await seedTableCounts(ro, own, { tables: ['Stems'], countRows })
    expect(calls).toBe(3)
    expect(readTableSignal(ro, 'Stems')?.count).toBe(302)
    expect(counted()).toBe(0)
  })

  it('a worker that fails: counted once on the main thread, and saved for the next launch', async () => {
    const path = archive(300, 0)
    const own = ownDb()
    const ro = new Database(path, { readonly: true })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const counted = fullCounts(ro)
    await seedTableCounts(ro, own, {
      tables: ['Stems'],
      countRows: () => Promise.reject(new Error('no worker here'))
    })
    expect(readTableSignal(ro, 'Stems')?.count).toBe(300)
    expect(counted()).toBe(1)
    ro.close()

    // Next launch, the worker still failing: the saved count, no COUNT at all.
    const next = new Database(path, { readonly: true })
    const nextCounted = fullCounts(next)
    const countRows = vi.fn(() => Promise.reject(new Error('no worker here')))
    await seedTableCounts(next, own, { tables: ['Stems'], countRows })
    expect(countRows).not.toHaveBeenCalled()
    expect(readTableSignal(next, 'Stems')?.count).toBe(300)
    expect(nextCounted()).toBe(0)
  })

  it('leaves a read-write connection (the own db) to readTableSignal', async () => {
    const path = archive(5, 5)
    const rw = new Database(path)
    const own = ownDb()
    const prepare = vi.spyOn(rw, 'prepare')
    await seedTableCounts(rw, own)
    expect(prepare).not.toHaveBeenCalled()
  })

  it('a db missing a table seeds the others and never throws', async () => {
    const path = join(dir, 'stems-only.db')
    const db = new Database(path)
    db.exec(`CREATE TABLE Stems (StemCID TEXT PRIMARY KEY); INSERT INTO Stems VALUES ('a'), ('b')`)
    db.close()
    const ro = new Database(path, { readonly: true })
    await expect(seedTableCounts(ro, ownDb())).resolves.toBeUndefined()
    const counted = fullCounts(ro)
    expect(readTableSignal(ro, 'Stems')?.count).toBe(2)
    expect(counted()).toBe(0)
  })
})

describe('seedTableCounts once per connection', () => {
  it('primes a saved count synchronously, and a second call shares the first', async () => {
    const path = archive(30, 20)
    const own = ownDb()
    await seedTableCounts(new Database(path, { readonly: true }), own)
    const ro = new Database(path, { readonly: true })
    const first = seedTableCounts(ro, own)
    // Before any await: the reuse path has already primed both tables.
    const counted = fullCounts(ro)
    expect(readTableSignal(ro, 'Stems')?.count).toBe(30)
    expect(readTableSignal(ro, 'Riffs')?.count).toBe(20)
    expect(counted()).toBe(0)
    expect(seedTableCounts(ro, own)).toBe(first)
    expect(whenTableCountsSeeded(ro)).toBe(first)
    await first
  })
})
