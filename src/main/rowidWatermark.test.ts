// src/main/rowidWatermark.test.ts -- opens sqlite: on vitest.config.ts's CI
// exclude list.
import { describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import {
  canExtendByRowid,
  canExtendByRowidSliced,
  keyAtRowid,
  type RowidWatermark
} from './rowidWatermark'

function source(keys: string[]): Database.Database {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE Riffs (RiffCID TEXT NOT NULL UNIQUE, Other TEXT)`)
  const insert = db.prepare(`INSERT INTO Riffs (RiffCID) VALUES (?)`)
  for (const k of keys) insert.run(k)
  return db
}

/** The watermark a cache built over every row of `db` right now carries. */
function builtOver(db: Database.Database): RowidWatermark {
  const row = db.prepare(`SELECT COUNT(*) AS n, MAX(rowid) AS m FROM Riffs`).get() as {
    n: number
    m: number | null
  }
  return {
    count: row.n,
    maxRowid: row.m,
    keyAtMax: row.m === null ? null : keyAtRowid(db, 'Riffs', 'RiffCID', row.m)
  }
}

function live(db: Database.Database): { count: number; maxRowid: number | null } {
  const row = db.prepare(`SELECT COUNT(*) AS n, MAX(rowid) AS m FROM Riffs`).get() as {
    n: number
    m: number | null
  }
  return { count: row.n, maxRowid: row.m }
}

const extendable = (db: Database.Database, meta: RowidWatermark): boolean =>
  canExtendByRowid(db, 'Riffs', 'RiffCID', meta, live(db))

describe('canExtendByRowid', () => {
  it('extends over an append', () => {
    const db = source(['a', 'b', 'c'])
    const meta = builtOver(db)
    db.prepare(`INSERT INTO Riffs (RiffCID) VALUES ('d'), ('e')`).run()
    expect(extendable(db, meta)).toBe(true)
  })

  it('extends when nothing changed', () => {
    const db = source(['a', 'b'])
    expect(extendable(db, builtOver(db))).toBe(true)
  })

  it('rebuilds after a delete', () => {
    const db = source(['a', 'b', 'c'])
    const meta = builtOver(db)
    db.prepare(`DELETE FROM Riffs WHERE RiffCID = 'b'`).run()
    expect(extendable(db, meta)).toBe(false)
  })

  it('rebuilds after a delete and an insert that leave the count unchanged', () => {
    const db = source(['a', 'b', 'c'])
    const meta = builtOver(db)
    db.prepare(`DELETE FROM Riffs WHERE RiffCID = 'a'`).run()
    db.prepare(`INSERT INTO Riffs (RiffCID) VALUES ('z')`).run()
    expect(extendable(db, meta)).toBe(false)
  })

  it('rebuilds for a replaced file (a different key at the watermark rowid)', () => {
    const meta = builtOver(source(['a', 'b', 'c']))
    expect(extendable(source(['x', 'y', 'z', 'w']), meta)).toBe(false)
  })

  it('rebuilds when cached count + rows past the watermark is not the live count', () => {
    const db = source(['a', 'b', 'c'])
    expect(extendable(db, { ...builtOver(db), count: 2 })).toBe(false)
  })

  it('an empty cache extends only while the watermark is empty too', () => {
    const empty = source([])
    const meta = builtOver(empty)
    expect(meta).toEqual({ count: 0, maxRowid: null, keyAtMax: null })
    expect(extendable(empty, meta)).toBe(true)
    empty.prepare(`INSERT INTO Riffs (RiffCID) VALUES ('a')`).run()
    expect(extendable(empty, meta)).toBe(true)
  })

  it('a null watermark extends only from a cached count of 0', () => {
    const db = source(['a'])
    expect(extendable(db, { count: 1, maxRowid: null, keyAtMax: null })).toBe(false)
  })

  it('a partial walk (watermark below MAX(rowid)) extends: it is a valid base', () => {
    const db = source(['a', 'b', 'c', 'd'])
    const meta = { count: 2, maxRowid: 2, keyAtMax: keyAtRowid(db, 'Riffs', 'RiffCID', 2) }
    expect(extendable(db, meta)).toBe(true)
  })
})

describe('canExtendByRowidSliced (faster startup: the rows past the watermark counted in windows)', () => {
  it('agrees with canExtendByRowid on every case above', async () => {
    const cases: [Database.Database, RowidWatermark][] = []
    const append = source(['a', 'b', 'c'])
    cases.push([append, builtOver(append)])
    append.prepare(`INSERT INTO Riffs (RiffCID) VALUES ('d'), ('e')`).run()
    const deleted = source(['a', 'b', 'c'])
    cases.push([deleted, builtOver(deleted)])
    deleted.prepare(`DELETE FROM Riffs WHERE RiffCID = 'b'`).run()
    const swapped = source(['a', 'b', 'c'])
    cases.push([swapped, builtOver(swapped)])
    swapped.prepare(`DELETE FROM Riffs WHERE RiffCID = 'a'`).run()
    swapped.prepare(`INSERT INTO Riffs (RiffCID) VALUES ('z')`).run()
    cases.push([source(['x', 'y', 'z', 'w']), builtOver(source(['a', 'b', 'c']))])
    const short = source(['a', 'b', 'c'])
    cases.push([short, { ...builtOver(short), count: 2 }])
    const empty = source([])
    cases.push([empty, builtOver(empty)])
    for (const [db, meta] of cases) {
      expect(await canExtendByRowidSliced(db, 'Riffs', 'RiffCID', meta, live(db), 2)).toBe(
        canExtendByRowid(db, 'Riffs', 'RiffCID', meta, live(db))
      )
    }
  })

  it('counts a big append in bounded windows, never one statement over all of it', async () => {
    const db = source(['a'])
    const meta = builtOver(db)
    const insert = db.prepare(`INSERT INTO Riffs (RiffCID) VALUES (?)`)
    for (let i = 0; i < 5000; i++) insert.run(`n${i}`)
    const prepare = vi.spyOn(db, 'prepare')
    expect(await canExtendByRowidSliced(db, 'Riffs', 'RiffCID', meta, live(db), 1000)).toBe(true)
    const windowed = prepare.mock.calls.filter(([sql]) => String(sql).includes('rowid <= ?'))
    expect(windowed.length).toBeGreaterThan(0)
    expect(prepare.mock.calls.some(([sql]) => /WHERE rowid > \?$/.test(String(sql).trim()))).toBe(
      false
    )
  })
})
