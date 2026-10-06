// src/main/stemsTableWalk.test.ts -- opens sqlite: on vitest.config.ts's CI
// exclude list.
import { afterEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import {
  addStemsWalkSink,
  sortInstrumentRowsSliced,
  walkStems,
  type StemsWalkPage
} from './stemsTableWalk'
import type { InstrumentRow } from './instrumentRowsLookup'

const EMPTY = { count: 0, maxRowid: null, keyAtMax: null }

function prng(seed: number): () => number {
  let x = seed
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648
    return x / 2147483648
  }
}

function stemsDb(n: number, seed = 1): Database.Database {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE Stems (StemCID TEXT NOT NULL UNIQUE, OwnerJamCID TEXT NOT NULL,
    Instrument INTEGER, CreatorUserName TEXT, PRIMARY KEY (StemCID))`)
  const rand = prng(seed)
  const insert = db.prepare(`INSERT INTO Stems VALUES (?, ?, ?, ?)`)
  db.transaction(() => {
    for (let i = 0; i < n; i++) {
      const user = i % 11 === 0 ? null : i % 13 === 0 ? '' : `user${i % 17}`
      insert.run(
        `${Math.floor(rand() * 1e12).toString(16)}-${i}`,
        `jam${i % 5}`,
        i % 9 === 0 ? null : i % 32,
        user
      )
    }
  })()
  return db
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('walkStems', () => {
  it('a full walk yields every row once, and the distinct non-empty (jam, user) pairs', async () => {
    const db = stemsDb(9_000)
    const pages: StemsWalkPage[] = []
    const result = await walkStems(db, EMPTY, { onPage: async (p) => void pages.push(p) })
    const all = db
      .prepare(`SELECT StemCID, Instrument, OwnerJamCID, CreatorUserName FROM Stems`)
      .all() as (InstrumentRow & {
      CreatorUserName: string | null
    })[]
    expect(result.rows).toHaveLength(9_000)
    expect(new Map(result.rows.map((r) => [r.StemCID, r]))).toEqual(
      new Map(
        all.map((r) => [
          r.StemCID,
          { StemCID: r.StemCID, Instrument: r.Instrument, OwnerJamCID: r.OwnerJamCID }
        ])
      )
    )
    const pairs = new Set(pages.flatMap((p) => p.pairs.map(([j, u]) => `${j}|${u}`)))
    const expected = new Set(
      all.filter((r) => r.CreatorUserName).map((r) => `${r.OwnerJamCID}|${r.CreatorUserName}`)
    )
    expect(pairs).toEqual(expected)
    expect(result.watermark.count).toBe(9_000)
    expect(result.watermark.maxRowid).toBe(9_000)
    // Rows with a NULL or empty user are still instrument rows.
    expect(
      result.rows.some((r) => all.find((a) => a.StemCID === r.StemCID)?.CreatorUserName === null)
    ).toBe(true)
  })

  it('two concurrent callers from the same point share one walk', async () => {
    const db = stemsDb(5_000)
    const spy = vi.spyOn(db, 'prepare')
    const [a, b] = await Promise.all([walkStems(db, EMPTY), walkStems(db, EMPTY)])
    expect(a).toBe(b)
    expect(spy.mock.calls.filter(([sql]) => sql.includes('FROM Stems')).length).toBe(1)
  })

  it('extending from rowid N reads only the rows past N', async () => {
    const db = stemsDb(3_000)
    const key = (
      db.prepare(`SELECT StemCID FROM Stems WHERE rowid = 2500`).get() as { StemCID: string }
    ).StemCID
    const result = await walkStems(db, { count: 2_500, maxRowid: 2_500, keyAtMax: key })
    expect(result.rows).toHaveLength(500)
    expect(result.watermark).toMatchObject({ count: 3_000, maxRowid: 3_000 })
  })

  it('every page also goes to the registered sinks', async () => {
    const db = stemsDb(4_100)
    const seen: number[] = []
    const remove = addStemsWalkSink((_db, page) => void seen.push(page.rows.length))
    await walkStems(db, EMPTY)
    remove()
    expect(seen).toEqual([2_000, 2_000, 100])
  })

  it('a failing onPage stops the walk; the result never includes the failed page', async () => {
    const db = stemsDb(4_100)
    let calls = 0
    await expect(
      walkStems(db, EMPTY, {
        onPage: async () => {
          if (++calls === 2) throw new Error('quit')
        }
      })
    ).rejects.toThrow('quit')
  })

  it('a db without a Stems table walks nothing', async () => {
    expect(await walkStems(new Database(':memory:'), EMPTY)).toEqual({ rows: [], watermark: EMPTY })
  })
})

describe('sortInstrumentRowsSliced', () => {
  it('sorts by StemCID exactly as a plain sort does, yielding along the way', async () => {
    const rand = prng(3)
    const rows: InstrumentRow[] = Array.from({ length: 50_000 }, (_, i) => ({
      StemCID: Math.floor(rand() * 1e15).toString(16) + `-${i}`,
      Instrument: i,
      OwnerJamCID: 'j'
    }))
    const before = rows.slice()
    const expected = rows.slice().sort((a, b) => (a.StemCID < b.StemCID ? -1 : 1))
    const yields = vi.spyOn(globalThis, 'setImmediate')
    const sorted = await sortInstrumentRowsSliced(rows)
    expect(sorted).toEqual(expected)
    expect(rows).toEqual(before) // the input is left as it was
    expect(yields).toHaveBeenCalled()
  })

  it('handles the small cases', async () => {
    expect(await sortInstrumentRowsSliced([])).toEqual([])
    const one = [{ StemCID: 'a', Instrument: 1, OwnerJamCID: 'j' }]
    expect(await sortInstrumentRowsSliced(one)).toEqual(one)
  })
})
