import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RIFF_STEMS_EXTRA_DDL } from './riffStemsExtra'
import type { DiscoveredMemberInput } from './discoveredLibrary'
import { CACHE_CHANGE_CHECK_INTERVAL_MS } from './tableChangeSignal'

let userDataDir: string

vi.mock('electron', () => ({
  app: {
    getPath: () => userDataDir
  }
}))

/** The subset of riffLibrarySchema.ts's SCHEMA_SQL these tests actually
 * touch -- same convention as riffLibraryWriter.test.ts, which duplicates
 * the DDL rather than opening the real db. */
function freshOwnDb(path = ':memory:'): Database.Database {
  const db = new Database(path)
  db.exec(`
    CREATE TABLE Jams (JamCID TEXT PRIMARY KEY, PublicName TEXT NOT NULL, SyncComplete INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE Riffs (
      RiffCID TEXT PRIMARY KEY, OwnerJamCID TEXT NOT NULL, CreationTime INTEGER,
      Root INTEGER, Scale INTEGER, BPMrnd REAL, BarLength INTEGER, UserName TEXT,
      StemCID_1 TEXT, StemCID_2 TEXT, StemCID_3 TEXT, StemCID_4 TEXT,
      StemCID_5 TEXT, StemCID_6 TEXT, StemCID_7 TEXT, StemCID_8 TEXT,
      GainsJSON TEXT, AppVersion INTEGER
    );
    CREATE TABLE Stems (
      StemCID TEXT PRIMARY KEY, OwnerJamCID TEXT NOT NULL, CreationTime INTEGER,
      FileEndpoint TEXT, FileBucket TEXT, FileKey TEXT, BPMrnd REAL, Instrument INTEGER,
      Length16s REAL, PresetName TEXT, CreatorUserName TEXT
    );
    CREATE TABLE Tags (RiffCID TEXT PRIMARY KEY, OwnerJamCID TEXT, Favour INTEGER, Note TEXT);
    CREATE TABLE DiscoverRiffIndexCache (
      SourceDbKey TEXT NOT NULL, StemCID TEXT NOT NULL, RiffCID TEXT NOT NULL,
      OwnerJamCID TEXT NOT NULL, BPMrnd REAL NOT NULL, CreationTime INTEGER,
      PRIMARY KEY (SourceDbKey, StemCID)
    );
    CREATE TABLE DiscoverRiffIndexCacheMeta (
      SourceDbKey TEXT PRIMARY KEY, RiffCount INTEGER NOT NULL, ComputedAt INTEGER NOT NULL
    );
    CREATE TABLE DiscoverInstrumentRowsCache (
      SourceDbKey TEXT NOT NULL, StemCID TEXT NOT NULL, Instrument INTEGER,
      OwnerJamCID TEXT NOT NULL, PRIMARY KEY (SourceDbKey, StemCID)
    );
    CREATE TABLE DiscoverInstrumentRowsCacheMeta (
      SourceDbKey TEXT PRIMARY KEY, StemCount INTEGER NOT NULL, ComputedAt INTEGER NOT NULL
    );
  `)
  db.exec(RIFF_STEMS_EXTRA_DDL)
  return db
}

/** A real cached stem file whose basename IS its StemCID, the convention
 * stemCIDForPath depends on. */
function seedStemOnDisk(stemCID: string): string {
  const dir = join(userDataDir, 'source-stems')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, stemCID)
  writeFileSync(path, Buffer.from([1, 2, 3, 4]))
  return path
}

describe('discoveredLibrary', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'sssketch-discovered-test-'))
  })

  afterEach(async () => {
    vi.useRealTimers()
    const { setRiffLibraryRootForTests } = await import('./riffLibraryStore')
    setRiffLibraryRootForTests(null)
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('writes a Riffs row in the discovered room, with the jam created lazily', async () => {
    const { saveDiscoveredRifff } = await import('./discoveredLibrary')
    const db = freshOwnDb()
    db.prepare(
      `INSERT INTO Stems (StemCID, OwnerJamCID, Instrument, PresetName, CreatorUserName, BPMrnd, Length16s,
                          FileEndpoint, FileBucket, FileKey)
       VALUES ('aaa111', 'j1', 1, 'thud', 'elling', 120, 64, 'ep', 'bk', 'ky')`
    ).run()
    const path = seedStemOnDisk('aaa111')

    const result = saveDiscoveredRifff(db, [], {
      members: [{ path, gain: 0.8, name: 'thud', author: 'elling', barLength: 1, durationSec: 2 }],
      bpm: 140,
      barLength: 2,
      creationTime: 5000
    })

    expect(result?.duplicate).toBe(false)
    expect(result?.name).toContain(' library')
    const jam = db.prepare(`SELECT PublicName FROM Jams WHERE JamCID = 'discovered'`).get()
    expect(jam).toEqual({ PublicName: 'discovered' })
    const riff = db
      .prepare(
        `SELECT OwnerJamCID, BPMrnd, BarLength, UserName, Root, Scale, CreationTime, GainsJSON, StemCID_1
         FROM Riffs WHERE RiffCID = ?`
      )
      .get(result!.riffCID) as Record<string, unknown>
    expect(riff.OwnerJamCID).toBe('discovered')
    expect(riff.BPMrnd).toBe(140)
    expect(riff.BarLength).toBe(2)
    expect(riff.UserName).toBe('discovered')
    expect(riff.Root).toBe(null)
    expect(riff.Scale).toBe(null)
    expect(riff.CreationTime).toBe(5000)
    expect(riff.GainsJSON).toBe('{"1":0.8}')
    expect(riff.StemCID_1).toBe('aaa111')
    db.close()
  })

  it('copies the stem to the discovered path, keeping the StemCID as the basename', async () => {
    const { saveDiscoveredRifff } = await import('./discoveredLibrary')
    const { discoveredStemPath } = await import('./riffLibraryStore')
    const db = freshOwnDb()
    db.prepare(`INSERT INTO Stems (StemCID, OwnerJamCID) VALUES ('bbb222', 'j1')`).run()
    const path = seedStemOnDisk('bbb222')

    saveDiscoveredRifff(db, [], {
      members: [{ path, gain: 1, name: 'n', author: 'a', barLength: 1, durationSec: 1 }],
      bpm: 120,
      barLength: 1,
      creationTime: 1
    })

    expect(existsSync(discoveredStemPath('bbb222'))).toBe(true)
    db.close()
  })

  it('does not null out a real synced stem download columns', async () => {
    const { saveDiscoveredRifff } = await import('./discoveredLibrary')
    const db = freshOwnDb()
    db.prepare(
      `INSERT INTO Stems (StemCID, OwnerJamCID, FileEndpoint, FileBucket, FileKey)
       VALUES ('ccc333', 'j1', 'ams3.example', 'endlesss', 'attachments/ccc333.ogg')`
    ).run()
    const path = seedStemOnDisk('ccc333')

    saveDiscoveredRifff(db, [], {
      members: [{ path, gain: 1, name: 'n', author: 'a', barLength: 1, durationSec: 1 }],
      bpm: 120,
      barLength: 1,
      creationTime: 1
    })

    const row = db
      .prepare(`SELECT FileEndpoint, FileBucket, FileKey FROM Stems WHERE StemCID = 'ccc333'`)
      .get()
    expect(row).toEqual({
      FileEndpoint: 'ams3.example',
      FileBucket: 'endlesss',
      FileKey: 'attachments/ccc333.ogg'
    })
    db.close()
  })

  it('reports a duplicate without writing a second row', async () => {
    const { saveDiscoveredRifff } = await import('./discoveredLibrary')
    const db = freshOwnDb()
    db.prepare(`INSERT INTO Stems (StemCID, OwnerJamCID) VALUES ('d1', 'j1')`).run()
    db.prepare(`INSERT INTO Stems (StemCID, OwnerJamCID) VALUES ('d2', 'j1')`).run()
    const p1 = seedStemOnDisk('d1')
    const p2 = seedStemOnDisk('d2')
    const input = (order: string[]): Parameters<typeof saveDiscoveredRifff>[2] => ({
      members: order.map((p, i) => ({
        path: p,
        gain: i === 0 ? 0.3 : 0.9,
        name: 'n',
        author: 'a',
        barLength: 1,
        durationSec: 1
      })),
      bpm: 120,
      barLength: 1,
      creationTime: 1
    })

    const first = saveDiscoveredRifff(db, [], input([p1, p2]))
    const second = saveDiscoveredRifff(db, [], input([p2, p1]))

    expect(second?.duplicate).toBe(true)
    expect(second?.riffCID).toBe(first!.riffCID)
    const { n } = db
      .prepare(`SELECT COUNT(*) AS n FROM Riffs WHERE OwnerJamCID = 'discovered'`)
      .get() as { n: number }
    expect(n).toBe(1)
    db.close()
  })

  it('mints a StemCID and a real Stems row for a path with no library stem behind it', async () => {
    const { saveDiscoveredRifff } = await import('./discoveredLibrary')
    const db = freshOwnDb()
    const dir = join(userDataDir, 'dropped')
    mkdirSync(dir, { recursive: true })
    const path = join(dir, 'my-loop.wav')
    writeFileSync(path, Buffer.from([9, 9]))

    const result = saveDiscoveredRifff(db, [], {
      members: [{ path, gain: 1, name: 'my loop', author: 'me', barLength: 1, durationSec: 1 }],
      bpm: 120,
      barLength: 1,
      creationTime: 1
    })

    const riff = db
      .prepare(`SELECT StemCID_1 FROM Riffs WHERE RiffCID = ?`)
      .get(result!.riffCID) as {
      StemCID_1: string
    }
    expect(riff.StemCID_1.startsWith('discovered-')).toBe(true)
    const stem = db.prepare(`SELECT OwnerJamCID FROM Stems WHERE StemCID = ?`).get(riff.StemCID_1)
    expect(stem).toEqual({ OwnerJamCID: 'discovered' })
    db.close()
  })

  it('appends to the persisted discover caches instead of moving them out of date', async () => {
    const { saveDiscoveredRifff } = await import('./discoveredLibrary')
    const { getCachedRiffCount, getCachedStemCount } = await import('./discoverIndexCache')
    const db = freshOwnDb()
    db.prepare(`INSERT INTO Stems (StemCID, OwnerJamCID, Instrument) VALUES ('e1', 'j1', 1)`).run()
    const path = seedStemOnDisk('e1')
    db.prepare(
      `INSERT INTO DiscoverRiffIndexCacheMeta (SourceDbKey, RiffCount, ComputedAt) VALUES (?, 0, 1)`
    ).run(db.name)
    db.prepare(
      `INSERT INTO DiscoverInstrumentRowsCacheMeta (SourceDbKey, StemCount, ComputedAt) VALUES (?, 1, 1)`
    ).run(db.name)

    const result = saveDiscoveredRifff(db, [], {
      members: [{ path, gain: 1, name: 'n', author: 'a', barLength: 1, durationSec: 1 }],
      bpm: 120,
      barLength: 1,
      creationTime: 1
    })

    expect(getCachedRiffCount(db, db.name)).toBe(1)
    expect(getCachedStemCount(db, db.name)).toBe(1)
    const cached = db
      .prepare(`SELECT RiffCID FROM DiscoverRiffIndexCache WHERE StemCID = 'e1'`)
      .get() as { RiffCID: string }
    expect(cached.RiffCID).toBe(result!.riffCID)
    db.close()
  })

  it('reports the rows the caller must fold into the in-memory caches', async () => {
    const { saveDiscoveredRifff } = await import('./discoveredLibrary')
    const db = freshOwnDb()
    db.prepare(`INSERT INTO Stems (StemCID, OwnerJamCID, Instrument) VALUES ('h1', 'j1', 2)`).run()
    const path = seedStemOnDisk('h1')
    const result = saveDiscoveredRifff(db, [], {
      members: [{ path, gain: 1, name: 'n', author: 'a', barLength: 1, durationSec: 1 }],
      bpm: 120,
      barLength: 1,
      creationTime: 7
    })
    expect(result?.indexRows).toEqual([
      {
        stemCID: 'h1',
        entry: { riffCID: result!.riffCID, ownerJamCID: 'discovered', bpmRnd: 120, creationTime: 7 }
      }
    ])
    // h1 already had a Stems row in the own db, so it is NOT a new
    // instrument row -- that is the point of this assertion.
    expect(result?.newInstrumentRows).toEqual([])
    db.close()
  })

  it('forget deletes the riff row and the copy no other kept group still uses', async () => {
    const { saveDiscoveredRifff, forgetDiscoveredRifff } = await import('./discoveredLibrary')
    const { discoveredStemPath } = await import('./riffLibraryStore')
    const db = freshOwnDb()
    db.prepare(`INSERT INTO Stems (StemCID, OwnerJamCID) VALUES ('f1', 'j1')`).run()
    db.prepare(`INSERT INTO Stems (StemCID, OwnerJamCID) VALUES ('f2', 'j1')`).run()
    const p1 = seedStemOnDisk('f1')
    const p2 = seedStemOnDisk('f2')
    const a = saveDiscoveredRifff(db, [], {
      members: [{ path: p1, gain: 1, name: 'n', author: 'a', barLength: 1, durationSec: 1 }],
      bpm: 120,
      barLength: 1,
      creationTime: 1
    })
    saveDiscoveredRifff(db, [], {
      members: [
        { path: p1, gain: 1, name: 'n', author: 'a', barLength: 1, durationSec: 1 },
        { path: p2, gain: 1, name: 'n', author: 'a', barLength: 1, durationSec: 1 }
      ],
      bpm: 120,
      barLength: 1,
      creationTime: 2
    })

    forgetDiscoveredRifff(db, a!.riffCID)

    expect(db.prepare(`SELECT 1 FROM Riffs WHERE RiffCID = ?`).get(a!.riffCID)).toBe(undefined)
    expect(existsSync(discoveredStemPath('f1'))).toBe(true)
    expect(db.prepare(`SELECT 1 FROM Stems WHERE StemCID = 'f1'`).get()).toEqual({ 1: 1 })
    db.close()
  })

  it('forget leaves no index entry for the forgotten group, in memory or after a relaunch', async () => {
    const { saveDiscoveredRifff, forgetDiscoveredRifff } = await import('./discoveredLibrary')
    const { appendToInMemoryDiscoverCaches, getRiffIndexForDb, prewarmDiscoverCandidateCaches } =
      await import('./discoverCandidates')
    const path = join(userDataDir, 'own.db')
    const db = freshOwnDb(path)
    db.prepare(
      `INSERT INTO Riffs (RiffCID, OwnerJamCID, BPMrnd, StemCID_1) VALUES ('r1', 'j1', 120, 'old1')`
    ).run()
    db.prepare(`INSERT INTO Stems (StemCID, OwnerJamCID) VALUES ('k1', 'j1')`).run()
    await prewarmDiscoverCandidateCaches([{ jamCID: 'j1', dbForJam: db }], db)

    // Keep, then forget before any launch extends the saved index over the keep:
    // the Riffs count, MAX(rowid) and the RiffCID at it are back where the
    // saved index's watermark stands, so it would read as current.
    const kept = saveDiscoveredRifff(db, [], {
      members: [
        {
          path: seedStemOnDisk('k1'),
          gain: 1,
          name: 'n',
          author: 'a',
          barLength: 1,
          durationSec: 1
        }
      ],
      bpm: 120,
      barLength: 1,
      creationTime: 1
    })
    appendToInMemoryDiscoverCaches(db, kept!.indexRows, kept!.newInstrumentRows)
    expect((await getRiffIndexForDb(db)).get('k1')?.riffCID).toBe(kept!.riffCID)
    forgetDiscoveredRifff(db, kept!.riffCID)

    expect((await getRiffIndexForDb(db)).get('k1')).toBeUndefined()
    expect((await getRiffIndexForDb(db)).get('old1')?.riffCID).toBe('r1')
    db.close()
    const relaunched = new Database(path)
    await prewarmDiscoverCandidateCaches([{ jamCID: 'j1', dbForJam: relaunched }], relaunched)
    expect((await getRiffIndexForDb(relaunched)).get('k1')).toBeUndefined()
    expect((await getRiffIndexForDb(relaunched)).get('old1')?.riffCID).toBe('r1')
    relaunched.close()
  })

  // Review of bc6baef0 fix 2: a forget that lands while a riff-index walk is
  // running. The walk holds the pre-forget index (with the kept group folded
  // in) and a watermark that never counted the kept riff, so without a guard
  // it put that index back in memory -- and the prewarm's walk re-wrote the
  // meta forget had just deleted, so the stale rows persisted too.
  // Synchronous on purpose: the keep and the forget must land between two of
  // the walk's awaits, not after it.
  function keepOne(
    save: typeof import('./discoveredLibrary').saveDiscoveredRifff,
    db: Database.Database,
    stemCID: string
  ): ReturnType<typeof save> {
    return save(db, [], {
      members: [
        {
          path: seedStemOnDisk(stemCID),
          gain: 1,
          name: 'n',
          author: 'a',
          barLength: 1,
          durationSec: 1
        }
      ],
      bpm: 120,
      barLength: 1,
      creationTime: 1
    })
  }

  it('forget during an in-session extension: the walk does not restore the forgotten group', async () => {
    const { saveDiscoveredRifff, forgetDiscoveredRifff } = await import('./discoveredLibrary')
    const { appendToInMemoryDiscoverCaches, getRiffIndexForDb, prewarmDiscoverCandidateCaches } =
      await import('./discoverCandidates')
    const db = freshOwnDb(join(userDataDir, 'own.db'))
    db.prepare(
      `INSERT INTO Riffs (RiffCID, OwnerJamCID, BPMrnd, StemCID_1) VALUES ('r1', 'j1', 120, 'old1')`
    ).run()
    db.prepare(`INSERT INTO Stems (StemCID, OwnerJamCID) VALUES ('k1', 'j1')`).run()
    await prewarmDiscoverCandidateCaches([{ jamCID: 'j1', dbForJam: db }], db)
    db.prepare(
      `INSERT INTO Riffs (RiffCID, OwnerJamCID, BPMrnd, StemCID_1) VALUES ('r2', 'j1', 120, 'new2')`
    ).run()
    // past the change-check interval, so the next read sees r2 and extends
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + CACHE_CHANGE_CHECK_INTERVAL_MS + 1_000)

    // The extension starts (and reads r2) up to its first await...
    const extending = getRiffIndexForDb(db)
    // ...then, before it finishes, a keep folds in and is forgotten.
    const kept = keepOne(saveDiscoveredRifff, db, 'k1')
    appendToInMemoryDiscoverCaches(db, kept!.indexRows, kept!.newInstrumentRows)
    forgetDiscoveredRifff(db, kept!.riffCID)
    const fromWalk = await extending

    expect(fromWalk.get('k1')).toBeUndefined()
    const after = await getRiffIndexForDb(db)
    expect(after.get('k1')).toBeUndefined()
    expect(after.get('old1')?.riffCID).toBe('r1')
    expect(after.get('new2')?.riffCID).toBe('r2')
    vi.useRealTimers()
    db.close()
  })

  // Review of T5-T7: the stale walk's fresh restart ran outside
  // riffIndexInFlight, so a caller arriving after the forget started a second
  // whole walk beside it. Now the restart joins a walk registered since the
  // forget (or registers itself): one walk, one index.
  it('forget during a walk: the restarted walk and a caller arriving after the forget share one walk', async () => {
    const { saveDiscoveredRifff, forgetDiscoveredRifff } = await import('./discoveredLibrary')
    const { appendToInMemoryDiscoverCaches, getRiffIndexForDb, prewarmDiscoverCandidateCaches } =
      await import('./discoverCandidates')
    const db = freshOwnDb(join(userDataDir, 'own.db'))
    db.prepare(
      `INSERT INTO Riffs (RiffCID, OwnerJamCID, BPMrnd, StemCID_1) VALUES ('r1', 'j1', 120, 'old1')`
    ).run()
    db.prepare(`INSERT INTO Stems (StemCID, OwnerJamCID) VALUES ('k1', 'j1')`).run()
    await prewarmDiscoverCandidateCaches([{ jamCID: 'j1', dbForJam: db }], db)
    db.prepare(
      `INSERT INTO Riffs (RiffCID, OwnerJamCID, BPMrnd, StemCID_1) VALUES ('r2', 'j1', 120, 'new2')`
    ).run()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + CACHE_CHANGE_CHECK_INTERVAL_MS + 1_000)

    const extending = getRiffIndexForDb(db)
    const kept = keepOne(saveDiscoveredRifff, db, 'k1')
    appendToInMemoryDiscoverCaches(db, kept!.indexRows, kept!.newInstrumentRows)
    forgetDiscoveredRifff(db, kept!.riffCID)
    const late = getRiffIndexForDb(db)
    const [fromWalk, fromLate] = await Promise.all([extending, late])

    expect(fromWalk).toBe(fromLate)
    expect(fromWalk.get('k1')).toBeUndefined()
    expect(fromWalk.get('new2')?.riffCID).toBe('r2')
    expect(await getRiffIndexForDb(db)).toBe(fromWalk)
    vi.useRealTimers()
    db.close()
  })

  it("forget during the prewarm's extension: neither restored in memory nor persisted", async () => {
    const { saveDiscoveredRifff, forgetDiscoveredRifff } = await import('./discoveredLibrary')
    const { getRiffIndexForDb, prewarmDiscoverCandidateCaches } =
      await import('./discoverCandidates')
    const path = join(userDataDir, 'own.db')
    const first = freshOwnDb(path)
    first
      .prepare(
        `INSERT INTO Riffs (RiffCID, OwnerJamCID, BPMrnd, StemCID_1) VALUES ('r1', 'j1', 120, 'old1')`
      )
      .run()
    first.prepare(`INSERT INTO Stems (StemCID, OwnerJamCID) VALUES ('k1', 'j1')`).run()
    await prewarmDiscoverCandidateCaches([{ jamCID: 'j1', dbForJam: first }], first)
    first.close()

    // A relaunch: the saved index extends over r2. While it is loading the
    // saved copy, a keep lands (its index rows appended to the saved copy)
    // and is forgotten (the meta deleted).
    const db = new Database(path)
    db.prepare(
      `INSERT INTO Riffs (RiffCID, OwnerJamCID, BPMrnd, StemCID_1) VALUES ('r2', 'j1', 120, 'new2')`
    ).run()
    let landed = false
    await prewarmDiscoverCandidateCaches([{ jamCID: 'j1', dbForJam: db }], db, (progress) => {
      if (landed || progress.phase !== 'riffIndex') return
      landed = true
      const kept = keepOne(saveDiscoveredRifff, db, 'k1')
      forgetDiscoveredRifff(db, kept!.riffCID)
    })
    expect(landed).toBe(true)
    expect((await getRiffIndexForDb(db)).get('k1')).toBeUndefined()
    db.close()

    const relaunched = new Database(path)
    await prewarmDiscoverCandidateCaches([{ jamCID: 'j1', dbForJam: relaunched }], relaunched)
    const index = await getRiffIndexForDb(relaunched)
    expect(index.get('k1')).toBeUndefined()
    expect(index.get('old1')?.riffCID).toBe('r1')
    expect(index.get('new2')?.riffCID).toBe('r2')
    relaunched.close()
  })

  it('forget removes a copy nothing else references', async () => {
    const { saveDiscoveredRifff, forgetDiscoveredRifff } = await import('./discoveredLibrary')
    const { discoveredStemPath } = await import('./riffLibraryStore')
    const db = freshOwnDb()
    db.prepare(`INSERT INTO Stems (StemCID, OwnerJamCID) VALUES ('g1', 'j1')`).run()
    const path = seedStemOnDisk('g1')
    const a = saveDiscoveredRifff(db, [], {
      members: [{ path, gain: 1, name: 'n', author: 'a', barLength: 1, durationSec: 1 }],
      bpm: 120,
      barLength: 1,
      creationTime: 1
    })

    forgetDiscoveredRifff(db, a!.riffCID)

    expect(existsSync(discoveredStemPath('g1'))).toBe(false)
    db.close()
  })

  it('saves all twelve members of a group, not the first eight', async () => {
    const { saveDiscoveredRifff, listDiscoveredGroups } = await import('./discoveredLibrary')
    const db = freshOwnDb()
    const members = Array.from({ length: 12 }, (_, i) => ({
      path: seedStemOnDisk(`cid_${i + 1}`),
      gain: 1,
      name: `stem ${i + 1}`,
      author: 'elling',
      barLength: 4,
      durationSec: 2
    }))
    for (let i = 1; i <= 12; i++) {
      db.prepare(`INSERT INTO Stems (StemCID, OwnerJamCID) VALUES (?, 'jam_1')`).run(`cid_${i}`)
    }

    const saved = saveDiscoveredRifff(db, [], { members, bpm: 120, barLength: 4, creationTime: 1 })
    expect(saved).not.toBeNull()
    const groups = listDiscoveredGroups(db)
    expect(groups[0].stemCIDs).toHaveLength(12)
    db.close()
  })

  it('a twelve-stem group is a duplicate of itself, and an eight-stem prefix of it is not', async () => {
    const { saveDiscoveredRifff } = await import('./discoveredLibrary')
    const db = freshOwnDb()
    const member = (n: number): DiscoveredMemberInput => ({
      path: seedStemOnDisk(`cid_${n}`),
      gain: 1,
      name: `stem ${n}`,
      author: 'elling',
      barLength: 4,
      durationSec: 2
    })
    for (let i = 1; i <= 12; i++) {
      db.prepare(`INSERT INTO Stems (StemCID, OwnerJamCID) VALUES (?, 'jam_1')`).run(`cid_${i}`)
    }
    const twelve = Array.from({ length: 12 }, (_, i) => member(i + 1))

    saveDiscoveredRifff(db, [], { members: twelve, bpm: 120, barLength: 4, creationTime: 1 })
    expect(
      saveDiscoveredRifff(db, [], { members: twelve, bpm: 120, barLength: 4, creationTime: 2 })
        ?.duplicate
    ).toBe(true)
    expect(
      saveDiscoveredRifff(db, [], {
        members: twelve.slice(0, 8),
        bpm: 120,
        barLength: 4,
        creationTime: 3
      })?.duplicate
    ).toBe(false)
    db.close()
  })

  it('forgetting one group never deletes a copy another group holds past its eighth slot', async () => {
    const { saveDiscoveredRifff, forgetDiscoveredRifff, listDiscoveredGroups } =
      await import('./discoveredLibrary')
    const { discoveredStemPath } = await import('./riffLibraryStore')
    const db = freshOwnDb()
    for (let i = 1; i <= 12; i++) {
      db.prepare(`INSERT INTO Stems (StemCID, OwnerJamCID) VALUES (?, 'jam_1')`).run(`cid_${i}`)
    }
    const member = (n: number): DiscoveredMemberInput => ({
      path: seedStemOnDisk(`cid_${n}`),
      gain: 1,
      name: `stem ${n}`,
      author: 'elling',
      barLength: 4,
      durationSec: 2
    })
    const a = saveDiscoveredRifff(db, [], {
      members: Array.from({ length: 12 }, (_, i) => member(i + 1)),
      bpm: 120,
      barLength: 4,
      creationTime: 1
    })
    saveDiscoveredRifff(db, [], {
      members: [member(12), member(1)],
      bpm: 120,
      barLength: 4,
      creationTime: 2
    })

    forgetDiscoveredRifff(db, a!.riffCID)
    expect(existsSync(discoveredStemPath('cid_12'))).toBe(true)
    expect(listDiscoveredGroups(db)).toHaveLength(1)
    const { n } = db
      .prepare(`SELECT COUNT(*) AS n FROM RiffStemsExtra WHERE RiffCID = ?`)
      .get(a!.riffCID) as { n: number }
    expect(n).toBe(0)
    db.close()
  })
})
