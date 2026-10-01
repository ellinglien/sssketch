// src/main/discoverArtistIndex.test.ts
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  abortArtistIndexWork,
  getArtistAnalysed,
  getArtistIndex,
  readArtistCounts,
  readJamUserPairs,
  resetArtistIndexForTests
} from './discoverArtistIndex'
import { DISCOVER_JAM_USER_PAIRS_DDL } from './discoverJamUserPairsStore'
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

// File-backed, each with its own name: saved pairs are keyed by db.name,
// and every in-memory db is called ':memory:'.
const dir = mkdtempSync(join(tmpdir(), 'artist-index-'))
let dbSerial = 0
const opened: Database.Database[] = []
function archive(): Database.Database {
  const db = new Database(join(dir, `db${dbSerial++}.db3`))
  opened.push(db)
  db.exec(`CREATE TABLE Stems (StemCID TEXT PRIMARY KEY, OwnerJamCID TEXT NOT NULL,
    CreatorUserName TEXT);
    CREATE INDEX Stems_IndexUser ON Stems (CreatorUserName);`)
  return db
}
function ownDb(): Database.Database {
  const db = archive()
  db.exec(`CREATE TABLE StemFeatureCache (StemCID TEXT PRIMARY KEY, FeaturesJSON TEXT NOT NULL,
    ExtractedAt INTEGER NOT NULL);`)
  db.exec(DISCOVER_JAM_USER_PAIRS_DDL)
  return db
}
function seed(db: Database.Database, stemCID: string, jam: string, user: string | null): void {
  db.prepare(`INSERT INTO Stems VALUES (?, ?, ?)`).run(stemCID, jam, user)
}

afterEach(() => {
  resetArtistIndexForTests()
  vi.useRealTimers()
  vi.restoreAllMocks()
})
afterAll(() => {
  for (const db of opened) db.close()
  rmSync(dir, { recursive: true, force: true })
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

// Elling's decision (2026-10-01), as revised in review: each source db's
// (jam, user) pairs are saved to the own db, so a launch walks only a db
// that moved, and the list is rebuilt from the pairs.
describe('pairs saved to disk', () => {
  async function settled(
    own: Database.Database,
    dbs: Database.Database[],
    ownUsername = 'elling'
  ): Promise<void> {
    await getArtistIndex(own, dbs, ownUsername)
    await vi.waitFor(async () => {
      expect((await getArtistIndex(own, dbs, ownUsername)).jammedWithPending).toBe(false)
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

  it("writes each source db's pairs and its signal once its walk lands", async () => {
    const own = ownDb()
    const db = sharedArchive()
    await settled(own, [db])
    expect(
      own
        .prepare(
          `SELECT JamCID, User FROM DiscoverJamUserPairs WHERE SourceDbKey = ? ORDER BY JamCID, User`
        )
        .all(db.name)
    ).toEqual([
      { JamCID: 'j1', User: 'elling' },
      { JamCID: 'j1', User: 'tpj' },
      { JamCID: 'j2', User: 'bananepoep' },
      { JamCID: 'j2', User: 'elling' },
      { JamCID: 'j2', User: 'tpj' }
    ])
    expect(
      own
        .prepare(`SELECT StemCount, MaxRowid FROM DiscoverJamUserPairsMeta WHERE SourceDbKey = ?`)
        .get(db.name)
    ).toEqual({ StemCount: 5, MaxRowid: 5 })
  })

  it('on the next launch serves the list at once, with no walk', async () => {
    const own = ownDb()
    const db = sharedArchive()
    await settled(own, [db])
    resetArtistIndexForTests() // a relaunch: nothing in memory
    vi.mocked(countWork).mockClear()
    const next = await getArtistIndex(own, [db], 'elling')
    expect(next.jammedWith).toEqual(LIST)
    expect(next.jammedWithPending).toBe(false)
    expect(pairPages()).toBe(0)
  })

  it('a launch after one source moved re-walks only that db', async () => {
    const own = ownDb()
    const archiveDb = sharedArchive()
    const ownSource = archive()
    seed(ownSource, 'o1', 'j3', 'elling')
    seed(ownSource, 'o2', 'j3', 'seaweed')
    await settled(own, [archiveDb, ownSource])
    resetArtistIndexForTests()
    seed(ownSource, 'o3', 'j3', 'honeydisco') // a riff sync on the own db
    vi.mocked(countWork).mockClear()
    const first = await getArtistIndex(own, [archiveDb, ownSource], 'elling')
    // The moved db's old pairs are shown while it re-walks.
    expect(first.jammedWith).toEqual([
      { user: 'tpj', sharedJams: 2 },
      { user: 'bananepoep', sharedJams: 1 },
      { user: 'seaweed', sharedJams: 1 }
    ])
    expect(first.jammedWithPending).toBe(true)
    await vi.waitFor(async () => {
      const next = await getArtistIndex(own, [archiveDb, ownSource], 'elling')
      expect(next.jammedWithPending).toBe(false)
      expect(next.jammedWith).toEqual([
        { user: 'tpj', sharedJams: 2 },
        { user: 'bananepoep', sharedJams: 1 },
        { user: 'honeydisco', sharedJams: 1 },
        { user: 'seaweed', sharedJams: 1 }
      ])
    })
    // One small page: the own-db source only. The archive was not walked.
    expect(pairPages()).toBe(1)
  })

  it('pairs are user-independent: another own username gets its list at once', async () => {
    const own = ownDb()
    const db = sharedArchive()
    await settled(own, [db], 'elling')
    resetArtistIndexForTests()
    const other = await getArtistIndex(own, [db], 'tpj')
    expect(other.jammedWithPending).toBe(false)
    expect(other.jammedWith).toEqual([
      { user: 'elling', sharedJams: 2 },
      { user: 'bananepoep', sharedJams: 1 }
    ])
  })

  it('creates its tables on first use in an own db that lacks them', async () => {
    const own = new Database(':memory:')
    const db = sharedArchive()
    await settled(own, [db])
    expect(
      (own.prepare(`SELECT COUNT(*) AS n FROM DiscoverJamUserPairs`).get() as { n: number }).n
    ).toBe(5)
  })
})

describe('pairs walk: failure and quit', () => {
  it('backs off ~60 s after a failed walk instead of retrying on every poll', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-01T12:00:00Z'))
    const own = ownDb()
    const db = archive()
    seed(db, 's1', 'j1', 'elling')
    const realPrepare = db.prepare.bind(db)
    vi.spyOn(db, 'prepare').mockImplementation(((sql: string) => {
      const stmt = realPrepare(sql)
      if (!sql.includes('AS jam')) return stmt
      return {
        all: () => {
          throw new Error('disk gone')
        }
      } as unknown as Database.Statement
    }) as typeof db.prepare)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(countWork).mockClear()
    await getArtistIndex(own, [db], 'elling')
    await vi.waitFor(async () => {
      expect((await getArtistIndex(own, [db], 'elling')).jammedWithPending).toBe(false)
    })
    expect(pairPages()).toBe(1)
    vi.setSystemTime(new Date('2026-10-01T12:00:30Z'))
    const backingOff = await getArtistIndex(own, [db], 'elling')
    expect(backingOff).toMatchObject({ jammedWith: null, jammedWithPending: false })
    expect(pairPages()).toBe(1)
    vi.setSystemTime(new Date('2026-10-01T12:01:01Z'))
    expect((await getArtistIndex(own, [db], 'elling')).jammedWithPending).toBe(true)
    expect(pairPages()).toBe(2)
  })

  it('stops a running walk at its next page on quit and saves nothing', async () => {
    const own = ownDb()
    const db = archive()
    const insert = db.prepare(`INSERT INTO Stems VALUES (?, 'j1', ?)`)
    db.transaction(() => {
      for (let i = 0; i < 5000; i++) insert.run(`s${i}`, `user${i % 7}`)
    })()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(countWork).mockClear()
    const first = await getArtistIndex(own, [db], 'elling') // page 1 read, then yields
    expect(first.jammedWithPending).toBe(true)
    abortArtistIndexWork()
    await vi.waitFor(async () => {
      expect((await getArtistIndex(own, [db], 'elling')).jammedWithPending).toBe(false)
    })
    expect(pairPages()).toBe(1)
    expect(
      (own.prepare(`SELECT COUNT(*) AS n FROM DiscoverJamUserPairsMeta`).get() as { n: number }).n
    ).toBe(0)
  })
})

describe('getArtistIndex: shared work', () => {
  it('concurrent first calls share one counts read', async () => {
    const own = ownDb()
    const db = archive()
    seed(db, 's1', 'j1', 'elling')
    vi.mocked(countWork).mockClear()
    await Promise.all([getArtistIndex(own, [db], 'elling'), getArtistIndex(own, [db], 'elling')])
    const countPages = vi
      .mocked(countWork)
      .mock.calls.filter(([kind]) => kind === 'sql:discover.artist-counts-page').length
    expect(countPages).toBe(1)
  })
})

describe('abort on quit: quiet, and reaches every loop', () => {
  it('a counts read stopped by quit logs nothing', async () => {
    const own = ownDb()
    const db = archive()
    seed(db, 's1', 'j1', 'elling')
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    abortArtistIndexWork()
    const index = await getArtistIndex(own, [db], 'elling')
    expect(index.counts).toEqual([])
    expect(error).not.toHaveBeenCalled()
  })

  it('stops the artist-stems walk and the analysed loop', async () => {
    const own = ownDb()
    const db = archive()
    for (let i = 0; i < 10; i++) seed(db, `t${i}`, 'j1', 'tpj')
    vi.mocked(countWork).mockClear()
    abortArtistIndexWork()
    await expect(getArtistAnalysed(own, [db], 'tpj')).rejects.toThrow(/aborted/)
    const kinds = vi.mocked(countWork).mock.calls.map(([kind]) => kind)
    expect(kinds).not.toContain('sql:discover.artist-stems-page')
    expect(kinds).not.toContain('sql:discover.artist-analysed-chunk')
  })
})
