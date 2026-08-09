import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import type { LoreResolvedRiff } from '@shared/loreLibrary'
import {
  upsertJam,
  markJamSyncComplete,
  upsertRiffSkeletons,
  writeRiffDetail,
  findRiffsNeedingDetail,
  markStemDownloadFailed,
  isStemLedgered,
  getWarehouseSyncStatus,
  areAllResolved,
  filterUnresolved,
  toggleWarehouseFavourite,
  listWarehouseFavourites
} from './loreWarehouseWriter'

// Same DDL as loreWarehouseSchema.ts's SCHEMA_SQL -- duplicated here
// (rather than importing openOwnWarehouseDb, which requires mocking
// electron's app.getPath for no benefit to these tests) so this test file
// can build an isolated in-memory DB with zero Electron dependency, one
// level below where loreWarehouseSchema.test.ts already covers the real
// path/open logic.
function freshDb(): Database.Database {
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
    CREATE TABLE Tags (RiffCID TEXT PRIMARY KEY, OwnerJamCID TEXT, Favour INTEGER NOT NULL DEFAULT 0, Note TEXT);
    CREATE TABLE StemLedger (StemCID TEXT PRIMARY KEY, Type TEXT NOT NULL, Note TEXT);
  `)
  return db
}

function resolvedRiffFixture(overrides: Partial<LoreResolvedRiff> = {}): LoreResolvedRiff {
  return {
    riffCID: 'riff_1',
    bpm: 120,
    barLength: 4,
    root: 4,
    scale: 5,
    stems: [
      {
        stemCID: 'stem_1',
        slot: 1,
        path: '/cache/stem_1',
        gain: 0.8,
        creatorUserName: 'elling',
        presetName: '808 Kick',
        instrumentMask: 2,
        durationSec: 8,
        barLength: 4,
        bpm: 120,
        downloadUrl: 'https://example.com/stem_1',
        fileEndpoint: 'example.com',
        fileKey: 'stem_1'
      }
    ],
    ...overrides
  }
}

describe('loreWarehouseWriter', () => {
  let db: Database.Database

  beforeEach(() => {
    db = freshDb()
  })

  afterEach(() => {
    db.close()
  })

  it('upsertJam inserts then updates PublicName on conflict', () => {
    upsertJam(db, 'jam_1', 'First Name')
    upsertJam(db, 'jam_1', 'Renamed')
    const row = db.prepare('SELECT PublicName FROM Jams WHERE JamCID = ?').get('jam_1') as {
      PublicName: string
    }
    expect(row.PublicName).toBe('Renamed')
  })

  it('markJamSyncComplete flips SyncComplete to 1', () => {
    upsertJam(db, 'jam_1', 'Jam')
    markJamSyncComplete(db, 'jam_1')
    const status = getWarehouseSyncStatus(db, 'jam_1')
    expect(status?.complete).toBe(true)
  })

  it('upsertRiffSkeletons inserts new rows and leaves existing detail untouched', () => {
    upsertJam(db, 'jam_1', 'Jam')
    writeRiffDetail(db, 'jam_1', { creationTime: 100, userName: 'elling' }, resolvedRiffFixture())
    upsertRiffSkeletons(db, 'jam_1', [
      { riffCID: 'riff_1', creationTime: 999 },
      { riffCID: 'riff_2', creationTime: 200 }
    ])
    const riff1 = db
      .prepare('SELECT CreationTime, AppVersion FROM Riffs WHERE RiffCID = ?')
      .get('riff_1') as {
      CreationTime: number
      AppVersion: number | null
    }
    // Already-detailed riff_1 keeps its real CreationTime (100) and
    // AppVersion (1) -- ON CONFLICT DO NOTHING, not an overwrite.
    expect(riff1).toEqual({ CreationTime: 100, AppVersion: 1 })
    const riff2 = db.prepare('SELECT AppVersion FROM Riffs WHERE RiffCID = ?').get('riff_2') as {
      AppVersion: number | null
    }
    expect(riff2.AppVersion).toBeNull()
  })

  it('writeRiffDetail persists every stem slot, gains, and root/scale', () => {
    upsertJam(db, 'jam_1', 'Jam')
    writeRiffDetail(db, 'jam_1', { creationTime: 100, userName: 'elling' }, resolvedRiffFixture())
    const riff = db.prepare('SELECT * FROM Riffs WHERE RiffCID = ?').get('riff_1') as Record<
      string,
      unknown
    >
    expect(riff.StemCID_1).toBe('stem_1')
    expect(riff.StemCID_2).toBeNull()
    expect(riff.Root).toBe(4)
    expect(riff.Scale).toBe(5)
    expect(JSON.parse(riff.GainsJSON as string)).toEqual({ '1': 0.8 })
    expect(riff.AppVersion).toBe(1)
    const stem = db.prepare('SELECT * FROM Stems WHERE StemCID = ?').get('stem_1') as Record<
      string,
      unknown
    >
    expect(stem.FileEndpoint).toBe('example.com')
    expect(stem.FileKey).toBe('stem_1')
    expect(stem.Length16s).toBe(64) // barLength 4 * 16
    expect(stem.CreationTime).toBe(100)
  })

  it('writeRiffDetail on an already-skeleton-inserted stem fills in its detail rather than erroring', () => {
    upsertJam(db, 'jam_1', 'Jam')
    // Simulate a prior riff having already referenced this same stemCID as
    // a bare skeleton (the real cross-riff-shared-stem case).
    db.prepare('INSERT INTO Stems (StemCID, OwnerJamCID) VALUES (?, ?)').run('stem_1', 'jam_1')
    writeRiffDetail(db, 'jam_1', { creationTime: 100, userName: 'elling' }, resolvedRiffFixture())
    const stem = db
      .prepare('SELECT CreatorUserName FROM Stems WHERE StemCID = ?')
      .get('stem_1') as {
      CreatorUserName: string
    }
    expect(stem.CreatorUserName).toBe('elling')
  })

  it('a mid-write failure inside writeRiffDetail leaves nothing committed (AppVersion stays a gap)', () => {
    upsertJam(db, 'jam_1', 'Jam')
    const fixture = resolvedRiffFixture()
    const riff = resolvedRiffFixture({
      stems: [
        { ...fixture.stems[0], stemCID: 'stem_1', slot: 1 },
        { ...fixture.stems[0], stemCID: 'stem_2', slot: 2 }
      ]
    })

    // Simulate the second stem's UPDATE throwing partway through the
    // function -- e.g. a real disk-full/interrupt scenario -- by spying on
    // db.prepare and making the "UPDATE Stems" statement's run() throw once
    // it sees stem_2. The first stem's writes (and the Riffs upsert before
    // it) must not survive this: the whole function is one transaction.
    const originalPrepare = db.prepare.bind(db)
    vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      const stmt = originalPrepare(sql)
      if (sql.startsWith('UPDATE Stems')) {
        const originalRun = stmt.run.bind(stmt)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(stmt as any).run = (...args: any[]) => {
          if (args[0]?.stemCID === 'stem_2') throw new Error('simulated mid-write failure')
          return originalRun(...args)
        }
      }
      return stmt
    })

    expect(() =>
      writeRiffDetail(db, 'jam_1', { creationTime: 100, userName: 'elling' }, riff)
    ).toThrow('simulated mid-write failure')

    vi.restoreAllMocks()

    const riffRow = db.prepare('SELECT AppVersion FROM Riffs WHERE RiffCID = ?').get(riff.riffCID)
    expect(riffRow).toBeUndefined()
    const stem1Row = db.prepare('SELECT * FROM Stems WHERE StemCID = ?').get('stem_1')
    expect(stem1Row).toBeUndefined()
    expect(findRiffsNeedingDetail(db, 'jam_1', 10)).toEqual([])
  })

  it('findRiffsNeedingDetail returns only rows with a NULL AppVersion, scoped to the jam', () => {
    upsertRiffSkeletons(db, 'jam_1', [
      { riffCID: 'r1', creationTime: 1 },
      { riffCID: 'r2', creationTime: 2 }
    ])
    upsertRiffSkeletons(db, 'jam_2', [{ riffCID: 'r3', creationTime: 3 }])
    upsertJam(db, 'jam_1', 'Jam 1')
    writeRiffDetail(
      db,
      'jam_1',
      { creationTime: 1, userName: 'elling' },
      resolvedRiffFixture({ riffCID: 'r1' })
    )
    expect(findRiffsNeedingDetail(db, 'jam_1', 10)).toEqual(['r2'])
    expect(findRiffsNeedingDetail(db, 'jam_2', 10)).toEqual(['r3'])
  })

  it('markStemDownloadFailed is idempotent and queryable via isStemLedgered', () => {
    expect(isStemLedgered(db, 'stem_1')).toBe(false)
    markStemDownloadFailed(db, 'stem_1')
    markStemDownloadFailed(db, 'stem_1')
    expect(isStemLedgered(db, 'stem_1')).toBe(true)
    const rows = db
      .prepare('SELECT COUNT(*) as n FROM StemLedger WHERE StemCID = ?')
      .get('stem_1') as { n: number }
    expect(rows.n).toBe(1)
  })

  it('getWarehouseSyncStatus reflects real riff count and completeness', () => {
    upsertJam(db, 'jam_1', 'Jam')
    upsertRiffSkeletons(db, 'jam_1', [
      { riffCID: 'r1', creationTime: 1 },
      { riffCID: 'r2', creationTime: 2 }
    ])
    expect(getWarehouseSyncStatus(db, 'jam_1')).toEqual({ riffCount: 2, complete: false })
    markJamSyncComplete(db, 'jam_1')
    expect(getWarehouseSyncStatus(db, 'jam_1')).toEqual({ riffCount: 2, complete: true })
  })

  it('getWarehouseSyncStatus returns null for an unknown jam', () => {
    expect(getWarehouseSyncStatus(db, 'nope')).toBeNull()
  })

  it('areAllResolved is true only when every given riffCID has a non-NULL AppVersion', () => {
    upsertJam(db, 'jam_1', 'Jam')
    writeRiffDetail(
      db,
      'jam_1',
      { creationTime: 1, userName: 'elling' },
      resolvedRiffFixture({ riffCID: 'r1' })
    )
    upsertRiffSkeletons(db, 'jam_1', [{ riffCID: 'r2', creationTime: 2 }])

    expect(areAllResolved(db, ['r1'])).toBe(true)
    expect(areAllResolved(db, ['r1', 'r2'])).toBe(false)
    expect(areAllResolved(db, ['r2'])).toBe(false)
    // Unknown riffCID (not even skeleton-inserted) also counts as a gap.
    expect(areAllResolved(db, ['r1', 'nope'])).toBe(false)
  })

  it('areAllResolved is true for an empty list', () => {
    expect(areAllResolved(db, [])).toBe(true)
  })

  it('filterUnresolved returns only the riffCIDs without a resolved Riffs row', () => {
    upsertJam(db, 'jam_1', 'Jam')
    writeRiffDetail(
      db,
      'jam_1',
      { creationTime: 1, userName: 'elling' },
      resolvedRiffFixture({ riffCID: 'r1' })
    )
    upsertRiffSkeletons(db, 'jam_1', [{ riffCID: 'r2', creationTime: 2 }])

    expect(filterUnresolved(db, ['r1', 'r2', 'nope'])).toEqual(['r2', 'nope'])
    expect(filterUnresolved(db, ['r1'])).toEqual([])
  })

  it('filterUnresolved returns an empty list for empty input', () => {
    expect(filterUnresolved(db, [])).toEqual([])
  })

  it('toggleWarehouseFavourite favourites a riff not yet in Tags, looking up its OwnerJamCID from Riffs if known', () => {
    upsertJam(db, 'jam_1', 'Jam')
    writeRiffDetail(db, 'jam_1', { creationTime: 100, userName: 'elling' }, resolvedRiffFixture())
    const ids = toggleWarehouseFavourite(db, 'riff_1')
    expect(ids).toEqual(['riff_1'])
    const row = db
      .prepare('SELECT OwnerJamCID, Favour FROM Tags WHERE RiffCID = ?')
      .get('riff_1') as {
      OwnerJamCID: string
      Favour: number
    }
    expect(row).toEqual({ OwnerJamCID: 'jam_1', Favour: 1 })
  })

  it('toggleWarehouseFavourite favourites a riff with unknown jam as null OwnerJamCID', () => {
    const ids = toggleWarehouseFavourite(db, 'unsynced_riff')
    expect(ids).toEqual(['unsynced_riff'])
    const row = db
      .prepare('SELECT OwnerJamCID FROM Tags WHERE RiffCID = ?')
      .get('unsynced_riff') as {
      OwnerJamCID: string | null
    }
    expect(row.OwnerJamCID).toBeNull()
  })

  it('toggleWarehouseFavourite un-favourites an already-favourited riff', () => {
    toggleWarehouseFavourite(db, 'riff_1')
    const ids = toggleWarehouseFavourite(db, 'riff_1')
    expect(ids).toEqual([])
    const row = db.prepare('SELECT Favour FROM Tags WHERE RiffCID = ?').get('riff_1') as {
      Favour: number
    }
    expect(row.Favour).toBe(0)
  })

  it('listWarehouseFavourites returns only riffCIDs with Favour = 1', () => {
    toggleWarehouseFavourite(db, 'riff_1')
    toggleWarehouseFavourite(db, 'riff_2')
    toggleWarehouseFavourite(db, 'riff_2') // un-favourite
    expect(listWarehouseFavourites(db).sort()).toEqual(['riff_1'])
  })
})
