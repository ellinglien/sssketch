// src/main/discoverArtistIndex.test.ts
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { STEMS_WALK_PAGE_SIZE } from './stemsTableWalk'
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

/** Pages of Stems walked for pairs -- since scan plan Task 4 the shared walk
 * (stemsTableWalk.ts), counted as `walk:instrument-rows.page`. */
function pairPages(): number {
  return vi.mocked(countWork).mock.calls.filter(([kind]) => kind === 'walk:instrument-rows.page')
    .length
}

/** The old, separate pairs walk's own pages: should never run now. */
function oldPairWalkPages(): number {
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

  // Scan plan Task 13 M2 (audit minor): StemFeatureCache's count moves on
  // every write while scanning, so the cache keyed on it missed on every
  // picker poll and re-ran every IN-COUNT chunk. The trait value table
  // already knows which stems have a row.
  it('with the trait value table current: the same answer, no chunked count', async () => {
    const { getTraitQuantileTables, noteStemFeatureRowWritten } =
      await import('./traitQuantileCache')
    const own = ownDb()
    const db = archive()
    for (let i = 0; i < 10; i++) seed(db, `t${i}`, 'j1', 'tpj')
    seed(db, 'e0', 'j1', 'elling')
    own
      .prepare(
        `INSERT INTO StemFeatureCache VALUES ('t0', '{}', 1), ('t1', 'null', 1),
         ('t2', '{not json', 1), ('e0', '{}', 1)`
      )
      .run()
    const viaSql = await getArtistAnalysed(own, [db], 'tpj')
    expect(viaSql).toEqual({ analysed: 3, total: 10 })
    resetArtistIndexForTests()

    await getTraitQuantileTables(own)
    vi.mocked(countWork).mockClear()
    expect(await getArtistAnalysed(own, [db], 'tpj')).toEqual(viaSql)
    // a write through the app's own store moves the answer at once
    own.prepare(`INSERT INTO StemFeatureCache VALUES ('t3', '{}', 1)`).run()
    noteStemFeatureRowWritten(own, {} as never, 't3')
    expect(await getArtistAnalysed(own, [db], 'tpj')).toEqual({ analysed: 4, total: 10 })
    const kinds = vi.mocked(countWork).mock.calls.map(([kind]) => kind)
    expect(kinds).not.toContain('sql:discover.artist-analysed-chunk')
  })

  it('falls back to the chunked count when the table is behind', async () => {
    const { getTraitQuantileTables } = await import('./traitQuantileCache')
    const own = ownDb()
    const db = archive()
    seed(db, 't0', 'j1', 'tpj')
    seed(db, 't1', 'j1', 'tpj')
    await getTraitQuantileTables(own)
    own.prepare(`INSERT INTO StemFeatureCache VALUES ('t0', '{}', 1)`).run() // behind its back
    vi.mocked(countWork).mockClear()
    expect(await getArtistAnalysed(own, [db], 'tpj')).toEqual({ analysed: 1, total: 2 })
    const kinds = vi.mocked(countWork).mock.calls.map(([kind]) => kind)
    expect(kinds).toContain('sql:discover.artist-analysed-chunk')
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
      if (!sql.includes('rowid AS rid')) return stmt
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

  it('on quit, a running walk adds nothing more; what was saved is a whole-page prefix', async () => {
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
    // Saved page by page (scan plan Task 4): at most the pages read before
    // the quit, and the meta names exactly the last of them -- a valid
    // watermark the next launch extends from.
    const meta = own
      .prepare(`SELECT StemCount, MaxRowid FROM DiscoverJamUserPairsMeta WHERE SourceDbKey = ?`)
      .get(db.name) as { StemCount: number; MaxRowid: number } | undefined
    if (meta) {
      expect(meta.StemCount % STEMS_WALK_PAGE_SIZE).toBe(0)
      expect(meta.MaxRowid).toBe(meta.StemCount)
    }
    expect((await getArtistIndex(own, [db], 'elling')).jammedWith).toBeNull()
  })
})

// Scan plan b21ea5a2 Task 4: the pairs ride the one shared Stems walk and
// extend from a rowid watermark.
describe('pairs from the shared Stems walk (scan plan Task 4)', () => {
  async function settled(own: Database.Database, dbs: Database.Database[]): Promise<void> {
    await getArtistIndex(own, dbs, 'elling')
    await vi.waitFor(async () => {
      expect((await getArtistIndex(own, dbs, 'elling')).jammedWithPending).toBe(false)
    })
  }
  function many(db: Database.Database, from: number, to: number): void {
    const insert = db.prepare(`INSERT INTO Stems VALUES (?, ?, ?)`)
    db.transaction(() => {
      for (let i = from; i < to; i++) insert.run(`s${i}`, `jam${i % 40}`, `user${i % 23}`)
    })()
  }
  async function fullWalkPairs(db: Database.Database): Promise<Set<string>> {
    return new Set((await readJamUserPairs(db)).map(([j, u]) => `${j}|${u}`))
  }
  async function savedPairs(own: Database.Database, db: Database.Database): Promise<Set<string>> {
    const rows = own
      .prepare(`SELECT JamCID, User FROM DiscoverJamUserPairs WHERE SourceDbKey = ?`)
      .all(db.name) as { JamCID: string; User: string }[]
    return new Set(rows.map((r) => `${r.JamCID}|${r.User}`))
  }

  it('after the prewarm walk the picker has its pairs with no walk of its own', async () => {
    const { prewarmDiscoverCandidateCaches } = await import('./discoverCandidates')
    const own = ownDb()
    own.exec(`
      CREATE TABLE IF NOT EXISTS Riffs (RiffCID TEXT PRIMARY KEY, OwnerJamCID TEXT NOT NULL, CreationTime INTEGER,
        BPMrnd REAL, StemCID_1 TEXT, StemCID_2 TEXT, StemCID_3 TEXT, StemCID_4 TEXT, StemCID_5 TEXT,
        StemCID_6 TEXT, StemCID_7 TEXT, StemCID_8 TEXT);
      CREATE TABLE DiscoverRiffIndexCache (SourceDbKey TEXT NOT NULL, StemCID TEXT NOT NULL,
        RiffCID TEXT NOT NULL, OwnerJamCID TEXT NOT NULL, BPMrnd REAL NOT NULL, CreationTime INTEGER,
        PRIMARY KEY (SourceDbKey, StemCID));
      CREATE TABLE DiscoverRiffIndexCacheMeta (SourceDbKey TEXT PRIMARY KEY, RiffCount INTEGER NOT NULL,
        ComputedAt INTEGER NOT NULL);
      CREATE TABLE DiscoverInstrumentRowsCache (SourceDbKey TEXT NOT NULL, StemCID TEXT NOT NULL,
        Instrument INTEGER, OwnerJamCID TEXT NOT NULL, PRIMARY KEY (SourceDbKey, StemCID));
      CREATE TABLE DiscoverInstrumentRowsCacheMeta (SourceDbKey TEXT PRIMARY KEY, StemCount INTEGER NOT NULL,
        ComputedAt INTEGER NOT NULL);`)
    const db = archive()
    db.exec(`CREATE TABLE Riffs (RiffCID TEXT PRIMARY KEY, OwnerJamCID TEXT NOT NULL, CreationTime INTEGER,
      BPMrnd REAL, StemCID_1 TEXT, StemCID_2 TEXT, StemCID_3 TEXT, StemCID_4 TEXT, StemCID_5 TEXT,
      StemCID_6 TEXT, StemCID_7 TEXT, StemCID_8 TEXT)`)
    many(db, 0, 4_500)
    getArtistIndex(own, [], 'elling') // the picker module is loaded (its sink installed)
    vi.mocked(countWork).mockClear()
    await prewarmDiscoverCandidateCaches([{ jamCID: 'jam0', dbForJam: db }], own)
    const walkPages = pairPages()
    expect(walkPages).toBe(Math.ceil(4_500 / STEMS_WALK_PAGE_SIZE))
    const prepareSpy = vi.spyOn(db, 'prepare')
    const index = await getArtistIndex(own, [db], 'elling')
    expect(index.jammedWithPending).toBe(false)
    expect(index.jammedWith).not.toBeNull()
    expect(pairPages()).toBe(walkPages) // no second walk
    expect(oldPairWalkPages()).toBe(0)
    expect(prepareSpy.mock.calls.some(([sql]) => sql.includes('rowid AS rid'))).toBe(false)
    expect(await savedPairs(own, db)).toEqual(await fullWalkPairs(db))
  })

  it('a poll after 50 new Stems rows extends: only rows past the watermark, pairs equal a full walk', async () => {
    const own = ownDb()
    const db = archive()
    many(db, 0, 3_000)
    await settled(own, [db])
    many(db, 3_000, 3_050)
    db.prepare(`INSERT INTO Stems VALUES ('fresh', 'newjam', 'newuser')`).run()
    resetArtistIndexForTests() // a relaunch, so the saved pairs are the base
    vi.mocked(countWork).mockClear()
    await settled(own, [db])
    expect(pairPages()).toBe(1)
    expect(
      vi
        .mocked(countWork)
        .mock.calls.filter(([kind]) => kind === 'walk:stems.rows')
        .reduce((n, [, k]) => n + (k ?? 1), 0)
    ).toBe(51)
    expect(await savedPairs(own, db)).toEqual(await fullWalkPairs(db))
    const index = await getArtistIndex(own, [db], 'user1')
    expect(index.jammedWith).not.toBeNull()
  })

  it('in session, a moved table extends the in-memory pairs from their watermark', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const own = ownDb()
    const db = archive()
    many(db, 0, 2_100)
    await settled(own, [db])
    db.prepare(`INSERT INTO Stems VALUES ('late', 'jamlate', 'elling')`).run()
    db.prepare(`INSERT INTO Stems VALUES ('late2', 'jamlate', 'latecomer')`).run()
    vi.setSystemTime(Date.now() + 60_000)
    vi.mocked(countWork).mockClear()
    await settled(own, [db])
    expect(pairPages()).toBe(1)
    const index = await getArtistIndex(own, [db], 'elling')
    expect(index.jammedWith?.some((j) => j.user === 'latecomer')).toBe(true)
  })

  it("a page whose pairs fail to save stops the saving: the saved copy never skips that page's pairs", async () => {
    const own = ownDb()
    const db = archive()
    const insert = db.prepare(`INSERT INTO Stems VALUES (?, ?, ?)`)
    db.transaction(() => {
      // Three pages; the second page's pair appears nowhere else.
      for (let i = 0; i < 6_000; i++) {
        const page = Math.floor(i / STEMS_WALK_PAGE_SIZE)
        insert.run(`s${i}`, `jam${page}`, page === 1 ? 'only-page-2' : `user${i % 5}`)
      }
    })()
    const realPrepare = own.prepare.bind(own)
    let pairInserts = 0
    vi.spyOn(own, 'prepare').mockImplementation(((sql: string) => {
      if (sql.includes('INSERT OR IGNORE INTO DiscoverJamUserPairs') && ++pairInserts === 2) {
        throw new Error('disk full')
      }
      return realPrepare(sql)
    }) as typeof own.prepare)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await settled(own, [db])
    vi.restoreAllMocks()
    const meta = own
      .prepare(`SELECT StemCount FROM DiscoverJamUserPairsMeta WHERE SourceDbKey = ?`)
      .get(db.name) as { StemCount: number }
    expect(meta.StemCount).toBe(STEMS_WALK_PAGE_SIZE) // the last page saved whole
    // The next launch extends from there, and the saved copy is whole again.
    resetArtistIndexForTests()
    await settled(own, [db])
    expect(await savedPairs(own, db)).toEqual(await fullWalkPairs(db))
  })

  it('a walk that does not start where the pairs stand reads the saved pairs once, not per page', async () => {
    const { walkStems } = await import('./stemsTableWalk')
    const own = ownDb()
    const db = archive()
    many(db, 0, 6_500)
    await settled(own, [db])
    resetArtistIndexForTests() // nothing in memory: only the saved copy could align
    const spy = vi.spyOn(own, 'prepare')
    // E.g. an instrument-row walk from a watermark the pairs never stood at.
    await walkStems(db, { count: 1, maxRowid: 1, keyAtMax: 's0' }, { ownDb: own })
    const loads = spy.mock.calls.filter(([sql]) =>
      sql.includes('SELECT JamCID, User FROM DiscoverJamUserPairs')
    ).length
    expect(loads).toBeLessThanOrEqual(1)
  })

  it('a delete rebuilds', async () => {
    const own = ownDb()
    const db = archive()
    many(db, 0, 2_500)
    await settled(own, [db])
    db.prepare(`DELETE FROM Stems WHERE rowid = 7`).run()
    resetArtistIndexForTests()
    vi.mocked(countWork).mockClear()
    await settled(own, [db])
    expect(pairPages()).toBe(Math.ceil(2_500 / STEMS_WALK_PAGE_SIZE)) // the whole table again
    expect(await savedPairs(own, db)).toEqual(await fullWalkPairs(db))
  })

  it('the in-place UPDATE gap is unchanged (and still documented in the store header)', async () => {
    const own = ownDb()
    const db = archive()
    many(db, 0, 10)
    await settled(own, [db])
    db.prepare(`UPDATE Stems SET CreatorUserName = 'renamed' WHERE StemCID = 's1'`).run()
    resetArtistIndexForTests()
    const index = await getArtistIndex(own, [db], 'elling')
    expect(index.jammedWith?.some((j) => j.user === 'renamed') ?? false).toBe(false)
    const { readFileSync } = await import('node:fs')
    expect(readFileSync(join(__dirname, 'discoverJamUserPairsStore.ts'), 'utf8')).toMatch(
      /KNOWN GAP: an in-place UPDATE/
    )
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
