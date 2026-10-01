// src/main/discoverArtistIndex.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import {
  getArtistAnalysed,
  getArtistIndex,
  readArtistCounts,
  readJamUserPairs,
  resetArtistIndexForTests
} from './discoverArtistIndex'
import { DISCOVER_JAMMED_WITH_DDL } from './discoverJammedWithStore'
import { countWork } from './workCounters'

// Pass-through spy: countWork is a no-op in tests (counters never enabled).
vi.mock('./workCounters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./workCounters')>()
  return { ...actual, countWork: vi.fn() }
})

function pairPages(): number {
  return vi
    .mocked(countWork)
    .mock.calls.filter(([kind]) => kind === 'sql:discover.artist-pairs-page').length
}

function archive(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE Stems (StemCID TEXT PRIMARY KEY, OwnerJamCID TEXT NOT NULL,
    CreatorUserName TEXT);
    CREATE INDEX Stems_IndexUser ON Stems (CreatorUserName);`)
  return db
}
function ownDb(): Database.Database {
  const db = archive()
  db.exec(`CREATE TABLE StemFeatureCache (StemCID TEXT PRIMARY KEY, FeaturesJSON TEXT NOT NULL,
    ExtractedAt INTEGER NOT NULL);`)
  db.exec(DISCOVER_JAMMED_WITH_DDL)
  return db
}
function seed(db: Database.Database, stemCID: string, jam: string, user: string | null): void {
  db.prepare(`INSERT INTO Stems VALUES (?, ?, ?)`).run(stemCID, jam, user)
}

afterEach(() => {
  resetArtistIndexForTests()
  vi.useRealTimers()
})

describe('readArtistCounts', () => {
  it('counts per user across pages, skipping NULL and empty names', async () => {
    const db = archive()
    for (let i = 0; i < 7; i++) seed(db, `a${i}`, 'j', `user${i}`)
    seed(db, 'a7', 'j', 'user0')
    seed(db, 'n1', 'j', null)
    seed(db, 'n2', 'j', '')
    const counts = await readArtistCounts(db, 3)
    expect(counts.find((c) => c.user === 'user0')).toEqual({ user: 'user0', stems: 2 })
    expect(counts).toHaveLength(7)
  })
})

describe('readJamUserPairs', () => {
  it('returns each distinct (jam, user) pair once, across pages', async () => {
    const db = archive()
    seed(db, 's1', 'j1', 'elling')
    seed(db, 's2', 'j1', 'elling')
    seed(db, 's3', 'j1', 'tpj')
    seed(db, 's4', 'j2', 'tpj')
    seed(db, 's5', 'j2', null)
    expect((await readJamUserPairs(db, 2)).sort()).toEqual([
      ['j1', 'elling'],
      ['j1', 'tpj'],
      ['j2', 'tpj']
    ])
  })
})

describe('getArtistIndex', () => {
  it('returns counts at once and fills jammedWith after the background walk', async () => {
    const own = ownDb()
    const db = archive()
    seed(db, 's1', 'j1', 'elling')
    seed(db, 's2', 'j1', 'tpj')
    seed(db, 's3', 'j2', 'bananepoep')
    const first = await getArtistIndex(own, [db], 'elling')
    expect(first.counts).toHaveLength(3)
    expect(first.jammedWith).toBeNull()
    expect(first.jammedWithPending).toBe(true)
    await vi.waitFor(async () => {
      const next = await getArtistIndex(own, [db], 'elling')
      expect(next.jammedWith).toEqual([{ user: 'tpj', sharedJams: 1 }])
      expect(next.jammedWithPending).toBe(false)
    })
  })
})

describe('getArtistAnalysed', () => {
  it("is the share of the artist's stems with a StemFeatureCache row", async () => {
    const own = ownDb()
    const db = archive()
    for (let i = 0; i < 10; i++) seed(db, `t${i}`, 'j1', 'tpj')
    own.prepare(`INSERT INTO StemFeatureCache VALUES ('t0', '{}', 1), ('t1', '{}', 1)`).run()
    expect(await getArtistAnalysed(own, [db], 'tpj')).toEqual({ analysed: 2, total: 10 })
  })

  it('refreshes when StemFeatureCache grows', async () => {
    const own = ownDb()
    const db = archive()
    seed(db, 't0', 'j1', 'tpj')
    expect(await getArtistAnalysed(own, [db], 'tpj')).toEqual({ analysed: 0, total: 1 })
    own.prepare(`INSERT INTO StemFeatureCache VALUES ('t0', '{}', 1)`).run()
    expect(await getArtistAnalysed(own, [db], 'tpj')).toEqual({ analysed: 1, total: 1 })
  })
})

// Elling's decision (2026-10-01): jammed-with is saved to the own db and
// reused on launch until the archive's Stems signal moves.
describe('jammed-with saved to disk', () => {
  async function built(
    own: Database.Database,
    db: Database.Database,
    ownUsername = 'elling'
  ): Promise<void> {
    await getArtistIndex(own, [db], ownUsername)
    await vi.waitFor(async () => {
      expect((await getArtistIndex(own, [db], ownUsername)).jammedWithPending).toBe(false)
    })
  }
  function sharedArchive(): Database.Database {
    const db = archive()
    seed(db, 's1', 'j1', 'elling')
    seed(db, 's2', 'j1', 'tpj')
    seed(db, 's3', 'j2', 'elling')
    seed(db, 's4', 'j2', 'tpj')
    seed(db, 's5', 'j2', 'bananepoep')
    return db
  }
  const LIST = [
    { user: 'tpj', sharedJams: 2 },
    { user: 'bananepoep', sharedJams: 1 }
  ]

  it('writes the list to DiscoverJammedWith once the walk lands', async () => {
    const own = ownDb()
    const db = sharedArchive()
    await built(own, db)
    const rows = own
      .prepare(`SELECT User, SharedJams FROM DiscoverJammedWith ORDER BY SharedJams DESC`)
      .all()
    expect(rows).toEqual([
      { User: 'tpj', SharedJams: 2 },
      { User: 'bananepoep', SharedJams: 1 }
    ])
  })

  it('on the next launch serves the saved list at once, with no walk', async () => {
    const own = ownDb()
    const db = sharedArchive()
    await built(own, db)
    resetArtistIndexForTests() // a relaunch: nothing in memory
    vi.mocked(countWork).mockClear()
    const next = await getArtistIndex(own, [db], 'elling')
    expect(next.jammedWith).toEqual(LIST)
    expect(next.jammedWithPending).toBe(false)
    expect(pairPages()).toBe(0)
  })

  it('once the archive Stems moved: shows the saved list while it recomputes, then saves the new one', async () => {
    const own = ownDb()
    const db = sharedArchive()
    await built(own, db)
    resetArtistIndexForTests()
    seed(db, 's6', 'j1', 'honeydisco')
    const stale = await getArtistIndex(own, [db], 'elling')
    expect(stale.jammedWith).toEqual(LIST)
    expect(stale.jammedWithPending).toBe(true)
    const fresh = [
      { user: 'tpj', sharedJams: 2 },
      { user: 'bananepoep', sharedJams: 1 },
      { user: 'honeydisco', sharedJams: 1 }
    ]
    await vi.waitFor(async () => {
      const next = await getArtistIndex(own, [db], 'elling')
      expect(next.jammedWith).toEqual(fresh)
      expect(next.jammedWithPending).toBe(false)
    })
    resetArtistIndexForTests()
    expect((await getArtistIndex(own, [db], 'elling')).jammedWith).toEqual(fresh)
  })

  it('never serves a list saved for another own username', async () => {
    const own = ownDb()
    const db = sharedArchive()
    await built(own, db, 'elling')
    resetArtistIndexForTests()
    const other = await getArtistIndex(own, [db], 'tpj')
    expect(other.jammedWith).toBeNull()
    expect(other.jammedWithPending).toBe(true)
  })

  it('never serves a list saved for a different set of source dbs', async () => {
    const own = ownDb()
    const db = sharedArchive()
    await built(own, db)
    resetArtistIndexForTests()
    const second = archive()
    seed(second, 'x1', 'j9', 'elling')
    // Same name (':memory:') but a second source: the saved meta has one row.
    const next = await getArtistIndex(own, [db, second], 'elling')
    expect(next.jammedWithPending).toBe(true)
  })
})

describe('discoverJammedWithStore', () => {
  it('creates its tables on first use in an own db that lacks them', async () => {
    const own = new Database(':memory:')
    const db = archive()
    seed(db, 's1', 'j1', 'elling')
    seed(db, 's2', 'j1', 'tpj')
    await getArtistIndex(own, [db], 'elling')
    await vi.waitFor(async () => {
      expect((await getArtistIndex(own, [db], 'elling')).jammedWithPending).toBe(false)
    })
    expect(own.prepare(`SELECT User, SharedJams FROM DiscoverJammedWith`).all()).toEqual([
      { User: 'tpj', SharedJams: 1 }
    ])
  })
})
