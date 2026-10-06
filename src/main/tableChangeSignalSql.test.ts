// src/main/tableChangeSignalSql.test.ts
//
// readTableSignal against real SQLite: the shared per-(db, table) COUNT memo
// (background scan audit item 1). Opens databases, so it is on
// vitest.config.ts's CI exclusion list; the pure decision lives in
// tableChangeSignal.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readTableSignal } from './tableChangeSignal'
import { bumpTableWriteVersion } from './tableWriteVersion'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'table-signal-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function seeded(rows: number): string {
  const path = join(dir, 'lib.db')
  const db = new Database(path)
  db.exec(`CREATE TABLE Riffs (RiffCID TEXT PRIMARY KEY, Note TEXT);
           CREATE TABLE Other (X INTEGER);
           CREATE TABLE Jams (JamCID TEXT); INSERT INTO Jams VALUES ('j1'), ('j2')`)
  const insert = db.prepare(`INSERT INTO Riffs (RiffCID) VALUES (?)`)
  for (let i = 0; i < rows; i++) insert.run(`r${i}`)
  db.close()
  return path
}

/** How many full-table counts `db` has run since the spy went on. */
function counts(db: Database.Database, table = 'Riffs'): () => number {
  const spy = vi.spyOn(db, 'prepare')
  return () =>
    spy.mock.calls.filter(([sql]) => String(sql).includes(`COUNT(*) AS n FROM ${table}`)).length
}

describe('readTableSignal on a read-only connection (the external archive)', () => {
  it('counts once, then answers from the cheap signal while nothing moved', () => {
    const ro = new Database(seeded(5), { readonly: true })
    const counted = counts(ro)
    const first = readTableSignal(ro, 'Riffs')
    const second = readTableSignal(ro, 'Riffs')
    const third = readTableSignal(ro, 'Riffs')
    expect(first).toEqual({ count: 5, maxRowid: 5, writes: 0, dataVersion: expect.any(Number) })
    expect(second).toEqual(first)
    expect(third).toEqual(first)
    expect(counted()).toBe(1)
  })

  it('sees another connection append (MAX(rowid) and data_version move)', () => {
    const path = seeded(5)
    const ro = new Database(path, { readonly: true })
    const before = readTableSignal(ro, 'Riffs')
    const rw = new Database(path)
    rw.prepare(`INSERT INTO Riffs (RiffCID) VALUES ('new')`).run()
    const after = readTableSignal(ro, 'Riffs')
    expect(after?.count).toBe(6)
    expect(after?.maxRowid).toBe(6)
    expect(after?.dataVersion).not.toBe(before?.dataVersion)
  })

  it('sees another connection delete a middle row (MAX(rowid) unchanged)', () => {
    const path = seeded(5)
    const ro = new Database(path, { readonly: true })
    readTableSignal(ro, 'Riffs')
    const rw = new Database(path)
    rw.prepare(`DELETE FROM Riffs WHERE RiffCID = 'r2'`).run()
    const after = readTableSignal(ro, 'Riffs')
    expect(after?.count).toBe(4)
    expect(after?.maxRowid).toBe(5)
  })

  it('a foreign write to ANOTHER table re-counts (data_version is per file) but stays right', () => {
    const path = seeded(5)
    const ro = new Database(path, { readonly: true })
    const counted = counts(ro)
    readTableSignal(ro, 'Riffs')
    new Database(path).prepare(`INSERT INTO Other (X) VALUES (1)`).run()
    expect(readTableSignal(ro, 'Riffs')?.count).toBe(5)
    expect(counted()).toBe(2)
  })

  it('carries this process’s own write count fresh, every read', () => {
    const ro = new Database(seeded(3), { readonly: true })
    expect(readTableSignal(ro, 'Riffs')?.writes).toBe(0)
    bumpTableWriteVersion(ro, 'Riffs')
    expect(readTableSignal(ro, 'Riffs')?.writes).toBe(1)
  })
})

describe('readTableSignal on a read-write connection (sssketch’s own warehouse)', () => {
  it('reuses the count only while the connection wrote nothing at all', () => {
    const db = new Database(seeded(5))
    const counted = counts(db)
    readTableSignal(db, 'Riffs')
    readTableSignal(db, 'Riffs')
    expect(counted()).toBe(1)
  })

  it('sees a raw delete on the same connection that bypassed the writer (no bump)', () => {
    const db = new Database(seeded(5))
    readTableSignal(db, 'Riffs')
    db.prepare(`DELETE FROM Riffs WHERE RiffCID = 'r1'`).run()
    expect(readTableSignal(db, 'Riffs')).toMatchObject({ count: 4, maxRowid: 5, writes: 0 })
  })

  it('a write to another table on the same connection re-counts but stays right', () => {
    const db = new Database(seeded(5))
    const counted = counts(db)
    readTableSignal(db, 'Riffs')
    db.prepare(`INSERT INTO Other (X) VALUES (1)`).run()
    expect(readTableSignal(db, 'Riffs')?.count).toBe(5)
    expect(counted()).toBe(2)
  })

  it('never remembers a count taken inside a transaction that then rolls back', () => {
    const db = new Database(seeded(5))
    readTableSignal(db, 'Riffs')
    const rollback = new Error('rollback')
    expect(() =>
      db.transaction(() => {
        db.prepare(`DELETE FROM Riffs WHERE RiffCID = 'r1'`).run()
        expect(readTableSignal(db, 'Riffs')?.count).toBe(4)
        throw rollback
      })()
    ).toThrow(rollback)
    expect(readTableSignal(db, 'Riffs')?.count).toBe(5)
  })

  it('keeps one memo per table', () => {
    const db = new Database(seeded(5), { readonly: true })
    expect(readTableSignal(db, 'Riffs')?.count).toBe(5)
    expect(readTableSignal(db, 'Jams')?.count).toBe(2)
    expect(readTableSignal(db, 'Riffs')?.count).toBe(5)
  })
})

describe('readTableSignal edge cases (unchanged behaviour)', () => {
  it('is null for a db without the table', () => {
    const db = new Database(':memory:')
    expect(readTableSignal(db, 'Stems')).toBeNull()
  })

  it('counts a table without rowid, maxRowid and dataVersion null', () => {
    const db = new Database(':memory:')
    db.exec(`CREATE TABLE Stems (StemCID TEXT PRIMARY KEY) WITHOUT ROWID;
             INSERT INTO Stems VALUES ('a'), ('b')`)
    expect(readTableSignal(db, 'Stems')).toEqual({
      count: 2,
      maxRowid: null,
      writes: 0,
      dataVersion: null
    })
    db.prepare(`INSERT INTO Stems VALUES ('c')`).run()
    expect(readTableSignal(db, 'Stems')?.count).toBe(3)
  })

  it('is null, never a throw, when the COUNT fails after the cheap half read fine', () => {
    const db = new Database(seeded(5))
    const real = db.prepare.bind(db)
    vi.spyOn(db, 'prepare').mockImplementation(((sql: string) => {
      if (sql.includes('COUNT(*)')) throw new Error('SQLITE_IOERR: disk went away')
      return real(sql)
    }) as typeof db.prepare)
    expect(readTableSignal(db, 'Riffs')).toBeNull()
  })

  it('is null, never a throw, when total_changes() fails', () => {
    const db = new Database(seeded(5))
    const real = db.prepare.bind(db)
    vi.spyOn(db, 'prepare').mockImplementation(((sql: string) => {
      if (sql.includes('total_changes()')) throw new Error('SQLITE_BUSY')
      return real(sql)
    }) as typeof db.prepare)
    expect(readTableSignal(db, 'Riffs')).toBeNull()
  })

  it('an empty table reads count 0, maxRowid null', () => {
    const db = new Database(':memory:')
    db.exec(`CREATE TABLE Jams (JamCID TEXT)`)
    expect(readTableSignal(db, 'Jams')).toMatchObject({ count: 0, maxRowid: null })
  })
})
