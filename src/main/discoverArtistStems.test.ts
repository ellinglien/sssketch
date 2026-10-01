// src/main/discoverArtistStems.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { getArtistStemCIDs, getArtistStemRows, readArtistStemRows } from './discoverArtistStems'

function archive(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE Stems (StemCID TEXT PRIMARY KEY, OwnerJamCID TEXT NOT NULL,
    CreatorUserName TEXT);
    CREATE INDEX Stems_IndexUser ON Stems (CreatorUserName);`)
  return db
}
function seed(db: Database.Database, stemCID: string, jam: string, user: string | null): void {
  db.prepare(`INSERT INTO Stems (StemCID, OwnerJamCID, CreatorUserName) VALUES (?, ?, ?)`).run(
    stemCID,
    jam,
    user
  )
}

afterEach(() => vi.useRealTimers())

describe('readArtistStemRows', () => {
  it('reads every row for the artist across several pages', async () => {
    const db = archive()
    for (let i = 0; i < 25; i++) seed(db, `t${i}`, 'jam1', 'tpj')
    seed(db, 'e1', 'jam1', 'elling')
    const rows = await readArtistStemRows(db, 'tpj', 10)
    expect(rows.map((r) => r.stemCID).sort()).toEqual(
      Array.from({ length: 25 }, (_, i) => `t${i}`).sort()
    )
    expect(rows.every((r) => r.jamCID === 'jam1')).toBe(true)
  })

  it('returns [] for a db with no Stems table rather than throwing', async () => {
    expect(await readArtistStemRows(new Database(':memory:'), 'tpj')).toEqual([])
  })
})

describe('getArtistStemRows', () => {
  it('merges dbs, first db wins a duplicate StemCID', async () => {
    const a = archive()
    const b = archive()
    seed(a, 's1', 'jamA', 'tpj')
    seed(b, 's1', 'jamB', 'tpj')
    seed(b, 's2', 'jamB', 'tpj')
    const rows = await getArtistStemRows([a, b], 'tpj')
    expect(rows).toEqual([
      { stemCID: 's1', jamCID: 'jamA' },
      { stemCID: 's2', jamCID: 'jamB' }
    ])
  })

  it('serves the cache, then refreshes once the Stems table moves', async () => {
    // Date only -- readArtistStemRows yields through setImmediate.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-01T12:00:00Z'))
    const db = archive()
    seed(db, 's1', 'jam1', 'tpj')
    expect([...(await getArtistStemCIDs([db], 'tpj'))]).toEqual(['s1'])
    seed(db, 's2', 'jam1', 'tpj')
    // Inside the signal check interval: still the cached answer.
    expect([...(await getArtistStemCIDs([db], 'tpj'))]).toEqual(['s1'])
    vi.setSystemTime(new Date('2026-10-01T12:01:00Z'))
    expect([...(await getArtistStemCIDs([db], 'tpj'))].sort()).toEqual(['s1', 's2'])
  })
})
