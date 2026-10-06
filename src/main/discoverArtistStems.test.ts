// src/main/discoverArtistStems.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import {
  abortArtistStemWalks,
  discoverStemRestriction,
  getArtistStemCIDs,
  getArtistStemRows,
  readArtistStemRows,
  MAX_CACHED_ARTISTS,
  resetArtistStemAbortForTests
} from './discoverArtistStems'
import { MAX_COMBINED_ARTISTS } from '@shared/artistSelection'
import { countWork } from './workCounters'
import { readTableSignal } from './tableChangeSignal'
import { getStemPriority, getStemPriorityUsername, type StemPriority } from './stemPriority'

// Pass-through spy: countWork is a no-op in tests (counters never enabled),
// so recording the calls changes nothing else.
vi.mock('./workCounters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./workCounters')>()
  return { ...actual, countWork: vi.fn() }
})

vi.mock('./tableChangeSignal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./tableChangeSignal')>()
  return { ...actual, readTableSignal: vi.fn(actual.readTableSignal) }
})

// The app's own-stem set (stemPriority.ts): no username configured unless a
// test says so.
vi.mock('./stemPriority', () => ({
  getStemPriorityUsername: vi.fn(() => null),
  getStemPriority: vi.fn()
}))

function pageReads(): number {
  return vi
    .mocked(countWork)
    .mock.calls.filter(([kind]) => kind === 'sql:discover.artist-stems-page').length
}

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

afterEach(() => {
  vi.useRealTimers()
  resetArtistStemAbortForTests()
  vi.mocked(getStemPriorityUsername).mockReset().mockReturnValue(null)
  vi.mocked(getStemPriority).mockReset()
})

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

describe('concurrent reads and the shared Stems signal', () => {
  it('two concurrent calls for one artist share one walk', async () => {
    const db = archive()
    // 4,500 rows = 3 pages of 2,000.
    const insert = db.prepare(
      `INSERT INTO Stems (StemCID, OwnerJamCID, CreatorUserName) VALUES (?, 'jam1', 'tpj')`
    )
    db.transaction(() => {
      for (let i = 0; i < 4500; i++) insert.run(`t${i}`)
    })()
    vi.mocked(countWork).mockClear()
    const [a, b] = await Promise.all([
      getArtistStemRows([db], 'tpj'),
      getArtistStemRows([db], 'tpj')
    ])
    expect(a).toHaveLength(4500)
    expect(b).toEqual(a)
    expect(pageReads()).toBe(3)
    // Settled: the next call is a cache hit, no page read.
    await getArtistStemRows([db], 'tpj')
    expect(pageReads()).toBe(3)
  })

  it('a later call after a settled walk is not stuck on the old promise', async () => {
    const db = archive()
    seed(db, 's1', 'jam1', 'tpj')
    await getArtistStemRows([db], 'tpj')
    vi.mocked(countWork).mockClear()
    // A different artist on the same db walks again.
    expect(await getArtistStemRows([db], 'nobody')).toEqual([])
    expect(pageReads()).toBe(1)
  })

  it('one Stems change refreshes every cached artist on that db', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-01T12:00:00Z'))
    const db = archive()
    seed(db, 'a1', 'jam1', 'tpj')
    seed(db, 'b1', 'jam1', 'honeydisco')
    await getArtistStemCIDs([db], 'tpj')
    await getArtistStemCIDs([db], 'honeydisco')
    seed(db, 'a2', 'jam1', 'tpj')
    seed(db, 'b2', 'jam1', 'honeydisco')
    vi.setSystemTime(new Date('2026-10-01T12:01:00Z'))
    vi.mocked(countWork).mockClear()
    expect([...(await getArtistStemCIDs([db], 'tpj'))].sort()).toEqual(['a1', 'a2'])
    expect([...(await getArtistStemCIDs([db], 'honeydisco'))].sort()).toEqual(['b1', 'b2'])
    // One signal check per db, not one per artist.
    const checks = vi
      .mocked(countWork)
      .mock.calls.filter(([kind]) => kind === 'sql:cache-check.Stems').length
    expect(checks).toBe(1)
  })
})

describe('Task 3 review: in-flight walks and the signal', () => {
  it('concurrent first walks for two artists read the Stems signal once', async () => {
    const db = archive()
    seed(db, 'a1', 'jam1', 'tpj')
    seed(db, 'b1', 'jam1', 'honeydisco')
    vi.mocked(readTableSignal).mockClear()
    await Promise.all([getArtistStemRows([db], 'tpj'), getArtistStemRows([db], 'honeydisco')])
    expect(vi.mocked(readTableSignal)).toHaveBeenCalledTimes(1)
  })

  it('an invalidation drops in-flight walks: the next call does not join a stale one', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-01T12:00:00Z'))
    const db = archive()
    const insert = db.prepare(
      `INSERT INTO Stems (StemCID, OwnerJamCID, CreatorUserName) VALUES (?, 'jam1', 'tpj')`
    )
    db.transaction(() => {
      for (let i = 0; i < 4500; i++) insert.run(`t${i}`)
    })()
    // Fill the cache once so the db has a signal state to go stale.
    await getArtistStemRows([db], 'other')
    const stale = getArtistStemRows([db], 'tpj') // page 1 read, then yields
    db.prepare(`DELETE FROM Stems WHERE StemCID = 't0'`).run()
    vi.setSystemTime(new Date('2026-10-01T12:01:00Z'))
    const fresh = await getArtistStemRows([db], 'tpj')
    expect((await stale).some((r) => r.stemCID === 't0')).toBe(true)
    expect(fresh.some((r) => r.stemCID === 't0')).toBe(false)
    expect(fresh).toHaveLength(4499)
  })
})

describe('abort on quit', () => {
  it('stops a running walk at its next page', async () => {
    const db = archive()
    const insert = db.prepare(
      `INSERT INTO Stems (StemCID, OwnerJamCID, CreatorUserName) VALUES (?, 'jam1', 'tpj')`
    )
    db.transaction(() => {
      for (let i = 0; i < 4500; i++) insert.run(`t${i}`)
    })()
    vi.mocked(countWork).mockClear()
    const walk = getArtistStemRows([db], 'tpj') // page 1 read, then yields
    abortArtistStemWalks()
    await expect(walk).rejects.toThrow(/aborted/)
    expect(pageReads()).toBe(1)
  })
})

describe('combine artists', () => {
  it('a whole selection fits the per-db artist cache', () => {
    expect(MAX_CACHED_ARTISTS).toBeGreaterThanOrEqual(MAX_COMBINED_ARTISTS)
  })
})

// Review of 99b33f45: a "mine" roll read his ~69k rows in 2,000-row pages
// (~120-250 ms of main-process block each, cold off the USB archive), again
// after every sync, alongside stemPriority.ts reading the same rows.
describe('discoverStemRestriction: only my stems', () => {
  function priority(own: string[]): StemPriority {
    return { username: 'elling', own: new Set(own), favourites: new Set(), version: 1 }
  }

  it("the stem-priority username's roll takes its kept own set and reads no pages", async () => {
    const db = archive()
    seed(db, 'e1', 'jam1', 'elling')
    vi.mocked(getStemPriorityUsername).mockReturnValue('elling')
    vi.mocked(getStemPriority).mockResolvedValue(priority(['kept1', 'kept2']))
    vi.mocked(countWork).mockClear()
    const set = await discoverStemRestriction([db], { onlyOwnStems: true, targetUser: ' elling ' })
    expect([...(set ?? [])].sort()).toEqual(['kept1', 'kept2'])
    expect(pageReads()).toBe(0)
    // asked for that same name, so the kept set is never evicted
    expect(vi.mocked(getStemPriority)).toHaveBeenCalledWith('elling')
  })

  it('another name (the fallback) is read in pages of 500', async () => {
    const db = archive()
    const insert = db.prepare(
      `INSERT INTO Stems (StemCID, OwnerJamCID, CreatorUserName) VALUES (?, 'jam1', 'elling')`
    )
    db.transaction(() => {
      for (let i = 0; i < 1001; i++) insert.run(`e${i}`)
    })()
    vi.mocked(getStemPriorityUsername).mockReturnValue('someone')
    vi.mocked(countWork).mockClear()
    const set = await discoverStemRestriction([db], { onlyOwnStems: true, targetUser: 'elling' })
    expect(set?.size).toBe(1001)
    expect(pageReads()).toBe(3)
    expect(vi.mocked(getStemPriority)).not.toHaveBeenCalled()
  })
})
