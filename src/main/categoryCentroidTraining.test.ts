import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { StemFeatures } from '@shared/stemFeatures'
import { emptyCategoryCentroidStore } from '@shared/categoryCentroids'
import type { StemRoleCategoryEntry } from './stemCategoriesStore'

let userDataDir: string

vi.mock('electron', () => ({
  app: {
    getPath: () => userDataDir
  }
}))

function freshDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE StemFeatureCache (
      StemCID TEXT PRIMARY KEY, FeaturesJSON TEXT NOT NULL, ExtractedAt INTEGER NOT NULL
    );
    CREATE TABLE Stems (StemCID TEXT PRIMARY KEY);
    CREATE TABLE StemCategories (
      StemCID TEXT PRIMARY KEY, ArrangeRole TEXT, DrumSubRole TEXT, BusId TEXT,
      Source TEXT NOT NULL, SourceProject TEXT, UpdatedAt INTEGER NOT NULL,
      SubcategoryNote TEXT
    );
  `)
  return db
}

function fakeFeatures(): StemFeatures {
  return {
    transientDensity: 0.5,
    bassEnergyRatio: 0.3,
    spectralCentroidHz: 1200,
    zcrBrightness: 0.4,
    voicedFraction: 0.1,
    pitchVarianceCents: 20,
    mfcc: Array.from({ length: 13 }, (_, i) => i * 0.1)
  }
}

function seedFeatures(db: Database.Database, stemCID: string): void {
  db.prepare(`INSERT INTO Stems (StemCID) VALUES (?)`).run(stemCID)
  db.prepare(
    `INSERT INTO StemFeatureCache (StemCID, FeaturesJSON, ExtractedAt) VALUES (?, ?, ?)`
  ).run(stemCID, JSON.stringify(fakeFeatures()), 1000)
}

function recordRoles(
  record: typeof import('./categoryCentroidTraining').recordStemCategoryRole,
  db: Database.Database,
  entries: StemRoleCategoryEntry[]
): void {
  record(db, entries, 'tidyup', null, 1000)
}

describe('categoryCentroidTraining', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'sssketch-category-centroid-training-test-'))
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('recordStemCategoryBus trains the bus axis from a stem with cached features', async () => {
    const db = freshDb()
    seedFeatures(db, 'cid-1')
    seedFeatures(db, 'cid-2')
    seedFeatures(db, 'cid-3')
    const { recordStemCategoryBus } = await import('./categoryCentroidTraining')
    const { loadCategoryCentroidStore } = await import('./categoryCentroidStore')
    recordStemCategoryBus(
      db,
      [
        { path: '/lib/cid-1', busId: 'drums' },
        { path: '/lib/cid-2', busId: 'drums' },
        { path: '/lib/cid-3', busId: 'drums' }
      ],
      'tidyup',
      null,
      1000
    )
    expect(loadCategoryCentroidStore().buses.drums?.count).toBe(3)
  })

  it('recordStemCategoryBus silently skips a stem with no cached features yet', async () => {
    const db = freshDb()
    db.prepare(`INSERT INTO Stems (StemCID) VALUES (?)`).run('cid-1')
    // No StemFeatureCache row for cid-1 -- never scanned yet.
    const { recordStemCategoryBus } = await import('./categoryCentroidTraining')
    const { loadCategoryCentroidStore } = await import('./categoryCentroidStore')
    expect(() =>
      recordStemCategoryBus(db, [{ path: '/lib/cid-1', busId: 'drums' }], 'tidyup', null, 1000)
    ).not.toThrow()
    expect(loadCategoryCentroidStore()).toEqual(emptyCategoryCentroidStore())
  })

  it('recordStemCategoryRole trains the arrangeRole axis', async () => {
    const db = freshDb()
    seedFeatures(db, 'cid-1')
    seedFeatures(db, 'cid-2')
    seedFeatures(db, 'cid-3')
    const { recordStemCategoryRole } = await import('./categoryCentroidTraining')
    const { loadCategoryCentroidStore } = await import('./categoryCentroidStore')
    recordRoles(recordStemCategoryRole, db, [
      { path: '/lib/cid-1', arrangeRole: 'vocal' },
      { path: '/lib/cid-2', arrangeRole: 'vocal' },
      { path: '/lib/cid-3', arrangeRole: 'vocal' }
    ])
    expect(loadCategoryCentroidStore().arrangeRoles.vocal?.count).toBe(3)
  })

  it('recordStemCategoryRole ALSO trains the drumSubRole axis when an entry has one', async () => {
    const db = freshDb()
    seedFeatures(db, 'cid-1')
    seedFeatures(db, 'cid-2')
    seedFeatures(db, 'cid-3')
    const { recordStemCategoryRole } = await import('./categoryCentroidTraining')
    const { loadCategoryCentroidStore } = await import('./categoryCentroidStore')
    recordRoles(recordStemCategoryRole, db, [
      { path: '/lib/cid-1', arrangeRole: 'drums', drumSubRole: 'kick' },
      { path: '/lib/cid-2', arrangeRole: 'drums', drumSubRole: 'kick' },
      { path: '/lib/cid-3', arrangeRole: 'drums', drumSubRole: 'kick' }
    ])
    const store = loadCategoryCentroidStore()
    expect(store.arrangeRoles.drums?.count).toBe(3)
    expect(store.drumSubRoles.kick?.count).toBe(3)
  })

  it('an entry with no drumSubRole trains only the arrangeRole axis', async () => {
    const db = freshDb()
    seedFeatures(db, 'cid-1')
    seedFeatures(db, 'cid-2')
    seedFeatures(db, 'cid-3')
    const { recordStemCategoryRole } = await import('./categoryCentroidTraining')
    const { loadCategoryCentroidStore } = await import('./categoryCentroidStore')
    recordRoles(recordStemCategoryRole, db, [
      { path: '/lib/cid-1', arrangeRole: 'drums' },
      { path: '/lib/cid-2', arrangeRole: 'drums' },
      { path: '/lib/cid-3', arrangeRole: 'drums' }
    ])
    const store = loadCategoryCentroidStore()
    expect(store.arrangeRoles.drums?.count).toBe(3)
    expect(store.drumSubRoles).toEqual({})
  })

  it('resolves a stem via extraCandidateDbs, then reads its cached features from the primary db (where StemFeatureCache rows always live)', async () => {
    const db = freshDb()
    const externalDb = freshDb()
    // The stem's real identity (Stems row) lives only in the external
    // archive's own database -- e.g. the user has pointed sssketch's
    // library root at a real, externally-built LORE/OUROVEON archive.
    for (const cid of ['cid-external', 'cid-external-2', 'cid-external-3']) {
      externalDb.prepare(`INSERT INTO Stems (StemCID) VALUES (?)`).run(cid)
      // Its cached StemFeatures, however, were already computed and
      // persisted into the OWN warehouse -- sssketch's own derived data is
      // always centralized there regardless of which archive a stem's raw
      // metadata came from (see getStemFeatureCache's own doc comment).
      db.prepare(
        `INSERT INTO StemFeatureCache (StemCID, FeaturesJSON, ExtractedAt) VALUES (?, ?, ?)`
      ).run(cid, JSON.stringify(fakeFeatures()), 1000)
    }
    const { recordStemCategoryBus } = await import('./categoryCentroidTraining')
    const { loadCategoryCentroidStore } = await import('./categoryCentroidStore')
    recordStemCategoryBus(
      db,
      [
        { path: '/lore-archive/cid-external', busId: 'bass' },
        { path: '/lore-archive/cid-external-2', busId: 'bass' },
        { path: '/lore-archive/cid-external-3', busId: 'bass' }
      ],
      'tidyup',
      null,
      1000,
      [externalDb]
    )
    expect(loadCategoryCentroidStore().buses.bass?.count).toBe(3)
  })
})
