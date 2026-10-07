import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import type { RiffLibraryResolvedRiff } from '@shared/riffLibraryTypes'
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
  listWarehouseFavourites,
  deleteJamRows,
  mergeSharedFeedCaseVariants
} from './riffLibraryWriter'
import { RIFF_STEMS_EXTRA_DDL, readExtraStemSlots } from './riffStemsExtra'
import { getTableWriteVersion } from './tableWriteVersion'

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
  db.exec(RIFF_STEMS_EXTRA_DDL)
  return db
}

function resolvedRiffFixture(
  overrides: Partial<RiffLibraryResolvedRiff> = {}
): RiffLibraryResolvedRiff {
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

describe('riffLibraryWriter', () => {
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

  it('deleteJamRows deletes the jam, its riffs, its tags, and orphaned stems', () => {
    upsertJam(db, 'jam_1', 'Jam One')
    writeRiffDetail(db, 'jam_1', { creationTime: 100, userName: 'elling' }, resolvedRiffFixture())
    toggleWarehouseFavourite(db, 'riff_1')

    const orphaned = deleteJamRows(db, 'jam_1')

    expect(orphaned).toEqual(['stem_1'])
    expect(db.prepare('SELECT * FROM Jams WHERE JamCID = ?').get('jam_1')).toBeUndefined()
    expect(db.prepare('SELECT * FROM Riffs WHERE RiffCID = ?').get('riff_1')).toBeUndefined()
    expect(db.prepare('SELECT * FROM Tags WHERE RiffCID = ?').get('riff_1')).toBeUndefined()
    expect(db.prepare('SELECT * FROM Stems WHERE StemCID = ?').get('stem_1')).toBeUndefined()
  })

  it('deleteJamRows keeps a stem still referenced by a riff in a different jam', () => {
    upsertJam(db, 'jam_1', 'Jam One')
    upsertJam(db, 'jam_2', 'Jam Two')
    writeRiffDetail(db, 'jam_1', { creationTime: 100, userName: 'elling' }, resolvedRiffFixture())
    writeRiffDetail(
      db,
      'jam_2',
      { creationTime: 200, userName: 'elling' },
      resolvedRiffFixture({ riffCID: 'riff_2' })
    )

    const orphaned = deleteJamRows(db, 'jam_1')

    expect(orphaned).toEqual([])
    expect(db.prepare('SELECT * FROM Riffs WHERE RiffCID = ?').get('riff_1')).toBeUndefined()
    expect(db.prepare('SELECT * FROM Riffs WHERE RiffCID = ?').get('riff_2')).toBeDefined()
    expect(db.prepare('SELECT * FROM Stems WHERE StemCID = ?').get('stem_1')).toBeDefined()
  })

  it('deleteJamRows is a safe no-op (returns []) for a jamCID with nothing synced', () => {
    expect(deleteJamRows(db, 'never_synced')).toEqual([])
  })

  it('writes the first eight stems to the columns and the rest to the side table', () => {
    const stems = Array.from({ length: 12 }, (_, i) => ({
      ...resolvedRiffFixture().stems[0],
      stemCID: `stem_${i + 1}`,
      slot: i + 1
    }))
    writeRiffDetail(
      db,
      'jam_1',
      { creationTime: 10, userName: 'elling' },
      { ...resolvedRiffFixture(), stems }
    )

    const row = db.prepare(`SELECT StemCID_8 FROM Riffs WHERE RiffCID = 'riff_1'`).get() as {
      StemCID_8: string
    }
    expect(row.StemCID_8).toBe('stem_8')
    expect(readExtraStemSlots(db, ['riff_1']).get('riff_1')).toEqual([
      { slot: 9, stemCID: 'stem_9' },
      { slot: 10, stemCID: 'stem_10' },
      { slot: 11, stemCID: 'stem_11' },
      { slot: 12, stemCID: 'stem_12' }
    ])
  })

  it('gives every stem past the eighth a real Stems row too', () => {
    const stems = Array.from({ length: 12 }, (_, i) => ({
      ...resolvedRiffFixture().stems[0],
      stemCID: `stem_${i + 1}`,
      slot: i + 1
    }))
    writeRiffDetail(
      db,
      'jam_1',
      { creationTime: 10, userName: 'elling' },
      { ...resolvedRiffFixture(), stems }
    )
    const { n } = db.prepare(`SELECT COUNT(*) AS n FROM Stems`).get() as { n: number }
    expect(n).toBe(12)
  })

  it('carries gains for slots past the eighth in GainsJSON, unchanged', () => {
    const stems = Array.from({ length: 10 }, (_, i) => ({
      ...resolvedRiffFixture().stems[0],
      stemCID: `stem_${i + 1}`,
      slot: i + 1,
      gain: (i + 1) / 10
    }))
    writeRiffDetail(
      db,
      'jam_1',
      { creationTime: 10, userName: 'elling' },
      { ...resolvedRiffFixture(), stems }
    )
    const row = db.prepare(`SELECT GainsJSON FROM Riffs WHERE RiffCID = 'riff_1'`).get() as {
      GainsJSON: string
    }
    expect((JSON.parse(row.GainsJSON) as Record<string, number>)['10']).toBeCloseTo(1.0)
  })

  it('an upsert that shrinks a rifff leaves no stale side rows', () => {
    const base = resolvedRiffFixture()
    const twelve = Array.from({ length: 12 }, (_, i) => ({
      ...base.stems[0],
      stemCID: `stem_${i + 1}`,
      slot: i + 1
    }))
    writeRiffDetail(
      db,
      'jam_1',
      { creationTime: 10, userName: 'elling' },
      { ...base, stems: twelve }
    )
    writeRiffDetail(
      db,
      'jam_1',
      { creationTime: 10, userName: 'elling' },
      { ...base, stems: twelve.slice(0, 5) }
    )
    expect(readExtraStemSlots(db, ['riff_1']).has('riff_1')).toBe(false)
  })

  it('collects a stem that only appears past the eighth slot as a candidate', () => {
    db.prepare(`INSERT INTO Jams (JamCID, PublicName) VALUES ('jam_1', 'one')`).run()
    db.prepare(
      `INSERT INTO Riffs (RiffCID, OwnerJamCID, StemCID_1) VALUES ('r1', 'jam_1', 'in_column')`
    ).run()
    db.prepare(`INSERT INTO RiffStemsExtra VALUES ('r1', 9, 'only_extra')`).run()
    db.prepare(`INSERT INTO Stems (StemCID, OwnerJamCID) VALUES ('in_column', 'jam_1')`).run()
    db.prepare(`INSERT INTO Stems (StemCID, OwnerJamCID) VALUES ('only_extra', 'jam_1')`).run()

    expect(deleteJamRows(db, 'jam_1').sort()).toEqual(['in_column', 'only_extra'])
  })

  it('keeps a stem another jam riff still holds past its eighth slot', () => {
    db.prepare(`INSERT INTO Jams (JamCID, PublicName) VALUES ('jam_1', 'one')`).run()
    db.prepare(`INSERT INTO Jams (JamCID, PublicName) VALUES ('jam_2', 'two')`).run()
    db.prepare(
      `INSERT INTO Riffs (RiffCID, OwnerJamCID, StemCID_1) VALUES ('r1', 'jam_1', 'shared')`
    ).run()
    db.prepare(`INSERT INTO Riffs (RiffCID, OwnerJamCID) VALUES ('r2', 'jam_2')`).run()
    db.prepare(`INSERT INTO RiffStemsExtra VALUES ('r2', 12, 'shared')`).run()
    db.prepare(`INSERT INTO Stems (StemCID, OwnerJamCID) VALUES ('shared', 'jam_1')`).run()

    expect(deleteJamRows(db, 'jam_1')).toEqual([])
    expect(db.prepare(`SELECT 1 FROM Stems WHERE StemCID = 'shared'`).get()).toBeDefined()
  })

  it('deletes the jam own side rows along with its riffs', () => {
    db.prepare(`INSERT INTO Jams (JamCID, PublicName) VALUES ('jam_1', 'one')`).run()
    db.prepare(`INSERT INTO Riffs (RiffCID, OwnerJamCID) VALUES ('r1', 'jam_1')`).run()
    db.prepare(`INSERT INTO RiffStemsExtra VALUES ('r1', 9, 'a')`).run()
    deleteJamRows(db, 'jam_1')
    const { n } = db.prepare(`SELECT COUNT(*) AS n FROM RiffStemsExtra`).get() as { n: number }
    expect(n).toBe(0)
  })
})

describe('mergeSharedFeedCaseVariants (a feed synced under a capitalised login, 2026-10-07)', () => {
  let db: Database.Database
  beforeEach(() => {
    db = freshDb()
  })
  afterEach(() => {
    db.close()
  })

  function ownerOf(table: 'Riffs' | 'Stems' | 'Tags', idColumn: string, id: string): string {
    const row = db.prepare(`SELECT OwnerJamCID FROM ${table} WHERE ${idColumn} = ?`).get(id) as {
      OwnerJamCID: string
    }
    return row.OwnerJamCID
  }

  it('moves every row of shared:Elling into shared:elling and drops the old jam row', () => {
    db.exec(`
      INSERT INTO Jams (JamCID, PublicName, SyncComplete) VALUES ('shared:Elling', 'Shared Feed', 1);
      INSERT INTO Jams (JamCID, PublicName, SyncComplete) VALUES ('shared:elling', 'Shared Feed', 0);
      INSERT INTO Riffs (RiffCID, OwnerJamCID) VALUES ('old_1', 'shared:Elling'), ('old_2', 'shared:Elling'),
        ('new_1', 'shared:elling');
      INSERT INTO Stems (StemCID, OwnerJamCID) VALUES ('s_old', 'shared:Elling');
      INSERT INTO Tags (RiffCID, OwnerJamCID, Favour) VALUES ('old_1', 'shared:Elling', 1);
      INSERT INTO Jams (JamCID, PublicName) VALUES ('shared:someoneelse', 'Shared Feed');
      INSERT INTO Riffs (RiffCID, OwnerJamCID) VALUES ('other', 'shared:someoneelse');
    `)

    expect(mergeSharedFeedCaseVariants(db, 'shared:elling')).toBe(1)

    const jams = db.prepare(`SELECT JamCID, SyncComplete FROM Jams ORDER BY JamCID`).all()
    expect(jams).toEqual([
      { JamCID: 'shared:elling', SyncComplete: 1 },
      { JamCID: 'shared:someoneelse', SyncComplete: 0 }
    ])
    expect(ownerOf('Riffs', 'RiffCID', 'old_1')).toBe('shared:elling')
    expect(ownerOf('Riffs', 'RiffCID', 'old_2')).toBe('shared:elling')
    expect(ownerOf('Riffs', 'RiffCID', 'new_1')).toBe('shared:elling')
    expect(ownerOf('Stems', 'StemCID', 's_old')).toBe('shared:elling')
    expect(ownerOf('Tags', 'RiffCID', 'old_1')).toBe('shared:elling')
    expect(ownerOf('Riffs', 'RiffCID', 'other')).toBe('shared:someoneelse')
  })

  // Review of 0e27db79: the Discover caches hold every source db's rows; the
  // fold is the own db's, so only the own db's rows move (and only their
  // primary-key range is read, not the archive's ~90% of the table).
  it("moves the Discover caches' rows for this db only, not another db's of the same name", () => {
    db.exec(`
      CREATE TABLE DiscoverRiffIndexCache (
        SourceDbKey TEXT NOT NULL, StemCID TEXT NOT NULL, RiffCID TEXT NOT NULL,
        OwnerJamCID TEXT NOT NULL, BPMrnd REAL NOT NULL, CreationTime INTEGER,
        PRIMARY KEY (SourceDbKey, StemCID)
      );
      CREATE TABLE DiscoverInstrumentRowsCache (
        SourceDbKey TEXT NOT NULL, StemCID TEXT NOT NULL, Instrument INTEGER,
        OwnerJamCID TEXT NOT NULL, PRIMARY KEY (SourceDbKey, StemCID)
      );
      INSERT INTO Jams (JamCID, PublicName) VALUES ('shared:Elling', 'Shared Feed');
    `)
    for (const source of [db.name, '/Volumes/archive/warehouse.db3']) {
      db.prepare(
        `INSERT INTO DiscoverRiffIndexCache VALUES (?, 's1', 'r1', 'shared:Elling', 120, 0)`
      ).run(source)
      db.prepare(
        `INSERT INTO DiscoverInstrumentRowsCache VALUES (?, 's1', 2, 'shared:Elling')`
      ).run(source)
    }
    mergeSharedFeedCaseVariants(db, 'shared:elling')
    for (const table of ['DiscoverRiffIndexCache', 'DiscoverInstrumentRowsCache']) {
      expect(
        db.prepare(`SELECT SourceDbKey, OwnerJamCID FROM ${table} ORDER BY SourceDbKey`).all()
      ).toEqual([
        { SourceDbKey: '/Volumes/archive/warehouse.db3', OwnerJamCID: 'shared:Elling' },
        { SourceDbKey: db.name, OwnerJamCID: 'shared:elling' }
      ])
    }
  })

  it('renames a capitalised feed when there is no lowercase one yet', () => {
    db.exec(`
      INSERT INTO Jams (JamCID, PublicName, SyncComplete) VALUES ('shared:Elling', 'Shared Feed', 1);
      INSERT INTO Riffs (RiffCID, OwnerJamCID) VALUES ('old_1', 'shared:Elling');
    `)
    expect(mergeSharedFeedCaseVariants(db, 'shared:elling')).toBe(1)
    expect(db.prepare(`SELECT JamCID, PublicName, SyncComplete FROM Jams`).all()).toEqual([
      { JamCID: 'shared:elling', PublicName: 'Shared Feed', SyncComplete: 1 }
    ])
    expect(ownerOf('Riffs', 'RiffCID', 'old_1')).toBe('shared:elling')
  })

  // Review of 0e27db79: the fold rewrites Tags.OwnerJamCID in place, which
  // no row count sees; every table it moves is announced.
  it('announces an in-place write to every table it moves, Tags included', () => {
    db.exec(`
      INSERT INTO Jams (JamCID, PublicName) VALUES ('shared:Elling', 'Shared Feed');
      INSERT INTO Tags (RiffCID, OwnerJamCID, Favour) VALUES ('old_1', 'shared:Elling', 1);
    `)
    const tables = ['Jams', 'Riffs', 'Stems', 'Tags'] as const
    const before = tables.map((t) => getTableWriteVersion(db, t))
    mergeSharedFeedCaseVariants(db, 'shared:elling')
    tables.forEach((t, i) => expect(getTableWriteVersion(db, t)).toBe(before[i] + 1))
  })

  it('runs once: a second call finds nothing to move', () => {
    db.exec(`INSERT INTO Jams (JamCID, PublicName) VALUES ('shared:Elling', 'Shared Feed');`)
    expect(mergeSharedFeedCaseVariants(db, 'shared:elling')).toBe(1)
    expect(mergeSharedFeedCaseVariants(db, 'shared:elling')).toBe(0)
  })

  it('is all or nothing: a failure part-way leaves every row where it was', () => {
    db.exec(`
      INSERT INTO Jams (JamCID, PublicName) VALUES ('shared:Elling', 'Shared Feed');
      INSERT INTO Riffs (RiffCID, OwnerJamCID) VALUES ('old_1', 'shared:Elling');
      INSERT INTO Stems (StemCID, OwnerJamCID) VALUES ('s_old', 'shared:Elling');
      CREATE TRIGGER fail_on_stem_move BEFORE UPDATE ON Stems
        BEGIN SELECT RAISE(ABORT, 'disk full'); END;
    `)
    expect(() => mergeSharedFeedCaseVariants(db, 'shared:elling')).toThrow(/disk full/)
    expect(db.prepare(`SELECT JamCID FROM Jams`).all()).toEqual([{ JamCID: 'shared:Elling' }])
    expect(ownerOf('Riffs', 'RiffCID', 'old_1')).toBe('shared:Elling')
  })
})
