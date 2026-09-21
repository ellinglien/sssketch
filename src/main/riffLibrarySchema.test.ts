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
      'Riffs',
      'StemAutoCategory',
      'StemCategories',
      'StemEmbeddingCache',
      'StemFavourite',
      'StemFeatureCache',
      'StemLedger',
      'StemPeaksCache',
      'StemYamnetZeroShotAttempted',
      'Stems',
      'Tags'
    ])
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
})
