import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let userDataDir: string

vi.mock('electron', () => ({
  app: {
    getPath: () => userDataDir
  }
}))

/** The subset of riffLibrarySchema.ts's SCHEMA_SQL these tests actually
 * touch -- same convention as riffLibraryWriter.test.ts, which duplicates
 * the DDL rather than opening the real db. */
function freshOwnDb(): Database.Database {
  const db = new Database(':memory:')
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
})
