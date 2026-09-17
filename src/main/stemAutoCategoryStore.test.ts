// src/main/stemAutoCategoryStore.test.ts
import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import {
  getAutoCategorizedStemCIDs,
  getStemAutoClassifyProgress,
  isStemEligibleForAutoCategory,
  upsertStemAutoCategory
} from './stemAutoCategoryStore'

function freshDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE StemAutoCategory (
      StemCID TEXT PRIMARY KEY, ArrangeRole TEXT NOT NULL, Source TEXT NOT NULL,
      ComputedAt INTEGER NOT NULL
    );
    CREATE TABLE StemEmbeddingCache (
      StemCID TEXT PRIMARY KEY, EmbeddingJSON TEXT NOT NULL, ExtractedAt INTEGER NOT NULL
    );
    CREATE TABLE StemFeatureCache (
      StemCID TEXT PRIMARY KEY, FeaturesJSON TEXT NOT NULL, ExtractedAt INTEGER NOT NULL
    );
    CREATE TABLE StemCategories (
      StemCID TEXT PRIMARY KEY, ArrangeRole TEXT, DrumSubRole TEXT, BusId TEXT,
      Source TEXT NOT NULL, SourceProject TEXT, UpdatedAt INTEGER NOT NULL
    );
  `)
  return db
}

function seedEmbedding(db: Database.Database, stemCID: string): void {
  db.prepare(
    `INSERT INTO StemEmbeddingCache (StemCID, EmbeddingJSON, ExtractedAt) VALUES (?, '[]', 1000)`
  ).run(stemCID)
}

function seedFeatures(db: Database.Database, stemCID: string): void {
  db.prepare(
    `INSERT INTO StemFeatureCache (StemCID, FeaturesJSON, ExtractedAt) VALUES (?, '{}', 1000)`
  ).run(stemCID)
}

function seedConfirmed(db: Database.Database, stemCID: string, arrangeRole: string): void {
  db.prepare(
    `INSERT INTO StemCategories (StemCID, ArrangeRole, DrumSubRole, BusId, Source, SourceProject, UpdatedAt)
     VALUES (?, ?, NULL, NULL, 'tidyup', NULL, 1000)`
  ).run(stemCID, arrangeRole)
}

describe('upsertStemAutoCategory / getAutoCategorizedStemCIDs', () => {
  it('inserts a new row, readable by role', () => {
    const db = freshDb()
    upsertStemAutoCategory(db, 's1', 'drums', 'embedding', 1000)
    expect(getAutoCategorizedStemCIDs(db, 'drums')).toEqual(new Set(['s1']))
    expect(getAutoCategorizedStemCIDs(db, 'bass')).toEqual(new Set())
  })

  it('overwrites an existing row on conflict rather than throwing', () => {
    const db = freshDb()
    upsertStemAutoCategory(db, 's1', 'drums', 'embedding', 1000)
    upsertStemAutoCategory(db, 's1', 'bass', 'centroid', 2000)

    expect(getAutoCategorizedStemCIDs(db, 'drums')).toEqual(new Set())
    expect(getAutoCategorizedStemCIDs(db, 'bass')).toEqual(new Set(['s1']))

    const row = db
      .prepare(`SELECT Source, ComputedAt FROM StemAutoCategory WHERE StemCID = ?`)
      .get('s1') as {
      Source: string
      ComputedAt: number
    }
    expect(row).toEqual({ Source: 'centroid', ComputedAt: 2000 })
  })
})

describe('getStemAutoClassifyProgress', () => {
  it('returns zero/zero when nothing has been extracted or classified', () => {
    const db = freshDb()
    expect(getStemAutoClassifyProgress(db)).toEqual({ classified: 0, eligible: 0 })
  })

  it('counts embedded and featured stems (deduped) toward eligible, and StemAutoCategory rows toward classified', () => {
    const db = freshDb()
    seedEmbedding(db, 's1')
    seedFeatures(db, 's2')
    seedEmbedding(db, 's3')
    seedFeatures(db, 's3') // both -- counted once, not twice
    upsertStemAutoCategory(db, 's1', 'drums', 'embedding', 1000)

    expect(getStemAutoClassifyProgress(db)).toEqual({ classified: 1, eligible: 3 })
  })

  it('excludes a stem confirmed for any role from eligible, even if it has an embedding', () => {
    const db = freshDb()
    seedEmbedding(db, 's1')
    seedConfirmed(db, 's1', 'bass')
    seedEmbedding(db, 's2') // unconfirmed -- still eligible

    expect(getStemAutoClassifyProgress(db)).toEqual({ classified: 0, eligible: 1 })
  })
})

describe('isStemEligibleForAutoCategory', () => {
  it('returns true for a stem with neither a StemCategories confirmation nor any StemAutoCategory row', () => {
    const db = freshDb()
    expect(isStemEligibleForAutoCategory(db, 's1')).toBe(true)
  })

  it('returns false for a stem already confirmed in StemCategories (ArrangeRole IS NOT NULL)', () => {
    const db = freshDb()
    seedConfirmed(db, 's1', 'bass')
    expect(isStemEligibleForAutoCategory(db, 's1')).toBe(false)
  })

  it.each(['embedding', 'centroid', 'yamnet-zeroshot'] as const)(
    'returns false for a stem that already has a StemAutoCategory row (source: %s)',
    (source) => {
      const db = freshDb()
      upsertStemAutoCategory(db, 's1', 'drums', source, 1000)
      expect(isStemEligibleForAutoCategory(db, 's1')).toBe(false)
    }
  )
})
