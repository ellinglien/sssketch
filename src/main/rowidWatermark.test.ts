// src/main/rowidWatermark.test.ts -- opens sqlite: on vitest.config.ts's CI
// exclude list.
import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { canExtendByRowid, keyAtRowid, type RowidWatermark } from './rowidWatermark'

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
