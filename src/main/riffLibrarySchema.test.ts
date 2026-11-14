import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import Database from 'better-sqlite3'

let musicDir: string

vi.mock('electron', () => ({
  app: {
    getPath: () => musicDir
  }
}))

describe('riffLibrarySchema', () => {
  beforeEach(() => {
    musicDir = mkdtempSync(join(tmpdir(), 'sssketch-rifflib-schema-test-'))
  })

  afterEach(async () => {
    const { closeOwnRiffLibraryDb } = await import('./riffLibrarySchema')
    closeOwnRiffLibraryDb()
    rmSync(musicDir, { recursive: true, force: true })
  })

  it("ownRiffLibraryDbPath lives under <music>/sssketch/library/cache/common, matching riffLibraryStore.ts's own join convention", async () => {
    const { ownRiffLibraryDbPath } = await import('./riffLibrarySchema')
    expect(ownRiffLibraryDbPath()).toBe(
      join(musicDir, 'sssketch', 'library', 'cache', 'common', 'warehouse.db3')
    )
  })

  it('openOwnRiffLibraryDb creates the db file and every expected table', async () => {
    const { openOwnRiffLibraryDb, ownRiffLibraryDbPath } = await import('./riffLibrarySchema')
    const db = openOwnRiffLibraryDb()
    expect(existsSync(ownRiffLibraryDbPath())).toBe(true)
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
      .all() as { name: string }[]
    expect(tables.map((t) => t.name)).toEqual([
      'DiscoverInstrumentRowsCache',
      'DiscoverInstrumentRowsCacheMeta',
      'DiscoverRiffIndexCache',
      'DiscoverRiffIndexCacheMeta',
      'Jams',
      'LoopFiles',
      'LoopFolders',
      'RadioHeartImport',
      'RadioLikeImport',
      'RiffStemsExtra',
      'Riffs',
      'StemAutoCategory',
      'StemAutoClassifyTried',
      'StemCategories',
      'StemEmbeddingCache',
      'StemFavourite',
      'StemFeatureCache',
      'StemLedger',
      'StemPeaksCache',
      'StemUnavailable',
      'StemYamnetZeroShotAttempted',
      'Stems',
      'Tags'
    ])
  })

  it('indexes RadioHeartImport by RiffCID, for the kept-riff name lookup', async () => {
    const { openOwnRiffLibraryDb } = await import('./riffLibrarySchema')
    const db = openOwnRiffLibraryDb()
    const plan = db
      .prepare(`EXPLAIN QUERY PLAN SELECT Name FROM RadioHeartImport WHERE RiffCID = ?`)
      .all('r1') as { detail: string }[]
    expect(plan.map((p) => p.detail).join(' ')).toContain('idx_radio_heart_import_riff')
  })

  it('opening twice returns the same cached connection, not a second one', async () => {
    const { openOwnRiffLibraryDb } = await import('./riffLibrarySchema')
    const first = openOwnRiffLibraryDb()
    const second = openOwnRiffLibraryDb()
    expect(first).toBe(second)
  })

  it('closeOwnRiffLibraryDb followed by a re-open works (re-creates the schema idempotently)', async () => {
    const { openOwnRiffLibraryDb, closeOwnRiffLibraryDb } = await import('./riffLibrarySchema')
    openOwnRiffLibraryDb()
    closeOwnRiffLibraryDb()
    expect(() => openOwnRiffLibraryDb()).not.toThrow()
  })

  it('opening a db whose DiscoverRiffIndexCache predates CreationTime adds the column and clears the (now-unrecoverable) stale cache rather than crashing', async () => {
    const { ownRiffLibraryDbPath } = await import('./riffLibrarySchema')
    const path = ownRiffLibraryDbPath()
    // Simulates a real pre-existing db from before this column existed --
    // a raw connection, not openOwnRiffLibraryDb() itself (which would
    // already create the CURRENT, post-migration schema). Directory
    // creation normally happens inside openOwnRiffLibraryDb() itself, so
    // it's replicated here for this raw connection.
    mkdirSync(dirname(path), { recursive: true })
    const raw = new Database(path)
    raw.exec(`
      CREATE TABLE DiscoverRiffIndexCache (
        SourceDbKey TEXT NOT NULL, StemCID TEXT NOT NULL, RiffCID TEXT NOT NULL,
        OwnerJamCID TEXT NOT NULL, BPMrnd REAL NOT NULL,
        PRIMARY KEY (SourceDbKey, StemCID)
      );
      CREATE TABLE DiscoverRiffIndexCacheMeta (
        SourceDbKey TEXT PRIMARY KEY, RiffCount INTEGER NOT NULL, ComputedAt INTEGER NOT NULL
      );
    `)
    raw
      .prepare(
        `INSERT INTO DiscoverRiffIndexCache (SourceDbKey, StemCID, RiffCID, OwnerJamCID, BPMrnd)
         VALUES ('db-a', 's1', 'r1', 'j1', 128)`
      )
      .run()
    raw
      .prepare(
        `INSERT INTO DiscoverRiffIndexCacheMeta (SourceDbKey, RiffCount, ComputedAt) VALUES ('db-a', 1, 0)`
      )
      .run()
    raw.close()

    const { openOwnRiffLibraryDb } = await import('./riffLibrarySchema')
    const db = openOwnRiffLibraryDb()

    const columns = db.prepare(`PRAGMA table_info(DiscoverRiffIndexCache)`).all() as {
      name: string
    }[]
    expect(columns.some((c) => c.name === 'CreationTime')).toBe(true)

    // The stale row (and its Meta sibling's stale RiffCount, which would
    // otherwise wrongly read the now-empty table as still fresh) must both
    // be gone -- the whole point of dropping rather than a no-op ALTER.
    const rowCount = (
      db.prepare(`SELECT COUNT(*) AS n FROM DiscoverRiffIndexCache`).get() as { n: number }
    ).n
    expect(rowCount).toBe(0)
    const metaRow = db
      .prepare(`SELECT RiffCount FROM DiscoverRiffIndexCacheMeta WHERE SourceDbKey = 'db-a'`)
      .get()
    expect(metaRow).toBeUndefined()
  })

  it('opening a db whose StemAutoClassifyTried is keyed on StemCID alone recreates it keyed on (StemCID, TrainingFingerprint)', async () => {
    const { ownRiffLibraryDbPath } = await import('./riffLibrarySchema')
    const path = ownRiffLibraryDbPath()
    mkdirSync(dirname(path), { recursive: true })
    const raw = new Database(path)
    // 0adc41ca's shape: one row per stem
    raw.exec(`
      CREATE TABLE StemAutoClassifyTried (
        StemCID TEXT PRIMARY KEY, TrainingFingerprint TEXT NOT NULL, Mask INTEGER
      );
      INSERT INTO StemAutoClassifyTried VALUES ('s1', 'old', NULL);
    `)
    raw.close()

    const { openOwnRiffLibraryDb } = await import('./riffLibrarySchema')
    const db = openOwnRiffLibraryDb()
    const pk = (
      db.prepare(`PRAGMA table_info(StemAutoClassifyTried)`).all() as {
        name: string
        pk: number
      }[]
    )
      .filter((c) => c.pk > 0)
      .sort((a, b) => a.pk - b.pk)
      .map((c) => c.name)
    expect(pk).toEqual(['StemCID', 'TrainingFingerprint'])
    // a record under an older classifier: nothing in it is worth keeping
    expect(db.prepare(`SELECT COUNT(*) AS n FROM StemAutoClassifyTried`).get()).toEqual({ n: 0 })
    // two fingerprints for one stem now fit
    const insert = db.prepare(
      `INSERT INTO StemAutoClassifyTried (StemCID, TrainingFingerprint, Mask, TriedAt) VALUES ('s1', ?, NULL, 1)`
    )
    insert.run('dev')
    insert.run('packaged')
  })

  it('opening a db whose StemCategories predates SubcategoryNote adds the column WITHOUT touching existing rows -- real Tidy Up assignments, unlike DiscoverRiffIndexCache, must survive', async () => {
    const { ownRiffLibraryDbPath } = await import('./riffLibrarySchema')
    const path = ownRiffLibraryDbPath()
    mkdirSync(dirname(path), { recursive: true })
    const raw = new Database(path)
    raw.exec(`
      CREATE TABLE StemCategories (
        StemCID TEXT PRIMARY KEY, ArrangeRole TEXT, DrumSubRole TEXT, BusId TEXT,
        Source TEXT NOT NULL, SourceProject TEXT, UpdatedAt INTEGER NOT NULL
      );
    `)
    raw
      .prepare(
        `INSERT INTO StemCategories (StemCID, ArrangeRole, DrumSubRole, BusId, Source, SourceProject, UpdatedAt)
         VALUES ('s1', 'drums', 'kick', 'drums', 'tidyup', 'my-sketch', 1000)`
      )
      .run()
    raw.close()

    const { openOwnRiffLibraryDb } = await import('./riffLibrarySchema')
    const db = openOwnRiffLibraryDb()

    const columns = db.prepare(`PRAGMA table_info(StemCategories)`).all() as { name: string }[]
    expect(columns.some((c) => c.name === 'SubcategoryNote')).toBe(true)

    // Unlike the DiscoverRiffIndexCache migration above, the pre-existing
    // row must survive completely intact -- this table is real user data,
    // not a rebuildable cache.
    const row = db.prepare(`SELECT * FROM StemCategories WHERE StemCID = 's1'`).get() as {
      ArrangeRole: string
      DrumSubRole: string
      BusId: string
      Source: string
      SourceProject: string
      UpdatedAt: number
      SubcategoryNote: string | null
    }
    expect(row.ArrangeRole).toBe('drums')
    expect(row.DrumSubRole).toBe('kick')
    expect(row.BusId).toBe('drums')
    expect(row.Source).toBe('tidyup')
    expect(row.SourceProject).toBe('my-sketch')
    expect(row.UpdatedAt).toBe(1000)
    expect(row.SubcategoryNote).toBeNull()
  })

  function seedOldStemAutoCategory(path: string, withFrontScore: boolean): void {
    mkdirSync(dirname(path), { recursive: true })
    const raw = new Database(path)
    raw.exec(`
      CREATE TABLE StemAutoCategory (
        StemCID TEXT PRIMARY KEY, ArrangeRole TEXT NOT NULL, Source TEXT NOT NULL,
        ComputedAt INTEGER NOT NULL${withFrontScore ? ', FrontScore REAL' : ''}
      );
      CREATE TABLE StemCategories (
        StemCID TEXT PRIMARY KEY, ArrangeRole TEXT, DrumSubRole TEXT, BusId TEXT,
        Source TEXT NOT NULL, SourceProject TEXT, UpdatedAt INTEGER NOT NULL
      );
    `)
    const insert = raw.prepare(
      `INSERT INTO StemAutoCategory (StemCID, ArrangeRole, Source, ComputedAt) VALUES (?, ?, ?, 1)`
    )
    insert.run('maskDrums', 'drums', 'instrumentMask')
    insert.run('maskBass', 'bass', 'instrumentMask')
    insert.run('maskLead', 'lead', 'instrumentMask')
    insert.run('emb', 'drums', 'embedding')
    insert.run('cent', 'backing', 'centroid')
    insert.run('zero', 'lead', 'yamnet-zeroshot')
    raw
      .prepare(
        `INSERT INTO StemCategories (StemCID, ArrangeRole, DrumSubRole, BusId, Source, SourceProject, UpdatedAt)
         VALUES ('label', 'lead', NULL, NULL, 'tidyup', NULL, 1)`
      )
      .run()
    raw.close()
  }

  function autoRows(db: Database.Database): string[] {
    return (
      db.prepare(`SELECT StemCID FROM StemAutoCategory ORDER BY StemCID`).all() as {
        StemCID: string
      }[]
    ).map((r) => r.StemCID)
  }

  it('opening a db whose StemAutoCategory lacks FrontScore adds it and clears every old guess except mask drums/bass, once', async () => {
    const { openOwnRiffLibraryDb, closeOwnRiffLibraryDb, ownRiffLibraryDbPath } =
      await import('./riffLibrarySchema')
    seedOldStemAutoCategory(ownRiffLibraryDbPath(), false)
    const db = openOwnRiffLibraryDb()
    const columns = db.prepare(`PRAGMA table_info(StemAutoCategory)`).all() as { name: string }[]
    expect(columns.some((c) => c.name === 'FrontScore')).toBe(true)
    expect(autoRows(db)).toEqual(['maskBass', 'maskDrums'])
    // Labels are never touched.
    expect(db.prepare(`SELECT COUNT(*) AS n FROM StemCategories`).get()).toEqual({ n: 1 })

    db.prepare(
      `INSERT INTO StemAutoCategory (StemCID, ArrangeRole, Source, ComputedAt, FrontScore)
       VALUES ('model1', 'backing', 'model', 2, 0.3), ('old', 'lead', 'embedding', 2, NULL)`
    ).run()
    closeOwnRiffLibraryDb()
    const reopened = openOwnRiffLibraryDb()
    expect(autoRows(reopened)).toEqual(['maskBass', 'maskDrums', 'model1', 'old'])
  })

  it('a StemAutoCategory that already has FrontScore (the other app migrated first) is left alone', async () => {
    const { openOwnRiffLibraryDb, ownRiffLibraryDbPath } = await import('./riffLibrarySchema')
    seedOldStemAutoCategory(ownRiffLibraryDbPath(), true)
    const db = openOwnRiffLibraryDb()
    expect(autoRows(db)).toEqual(['cent', 'emb', 'maskBass', 'maskDrums', 'maskLead', 'zero'])
  })

  it('opening the own db creates RiffStemsExtra, and doing it twice is a no-op', async () => {
    const { openOwnRiffLibraryDb, closeOwnRiffLibraryDb } = await import('./riffLibrarySchema')
    const db = openOwnRiffLibraryDb()
    const columns = db.prepare(`PRAGMA table_info(RiffStemsExtra)`).all() as { name: string }[]
    expect(columns.map((c) => c.name)).toEqual(['RiffCID', 'Slot', 'StemCID'])

    db.prepare(`INSERT INTO RiffStemsExtra (RiffCID, Slot, StemCID) VALUES ('r1', 9, 's9')`).run()
    closeOwnRiffLibraryDb()
    const reopened = openOwnRiffLibraryDb()
    const { n } = reopened.prepare(`SELECT COUNT(*) AS n FROM RiffStemsExtra`).get() as {
      n: number
    }
    expect(n).toBe(1)
  })

  it('the table refuses a slot the eight columns already own', async () => {
    const { openOwnRiffLibraryDb } = await import('./riffLibrarySchema')
    const db = openOwnRiffLibraryDb()
    expect(() =>
      db.prepare(`INSERT INTO RiffStemsExtra (RiffCID, Slot, StemCID) VALUES ('r2', 8, 's8')`).run()
    ).toThrow()
  })
})
