// src/main/stemAutoCategoryStore.test.ts
import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { getStemAutoClassifyProgress, upsertStemAutoCategory } from './stemAutoCategoryStore'
import { getAutoCategorizedStemCIDs, isStemEligibleForAutoCategory } from './stemCategoryTestReads'

function freshDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE StemAutoCategory (
      StemCID TEXT PRIMARY KEY, ArrangeRole TEXT NOT NULL, Source TEXT NOT NULL,
      ComputedAt INTEGER NOT NULL, FrontScore REAL
    );
    CREATE TABLE StemEmbeddingCache (
      StemCID TEXT PRIMARY KEY, EmbeddingJSON TEXT NOT NULL, ExtractedAt INTEGER NOT NULL
    );
    CREATE TABLE StemFeatureCache (
      StemCID TEXT PRIMARY KEY, FeaturesJSON TEXT NOT NULL, ExtractedAt INTEGER NOT NULL
    );
    CREATE TABLE StemCategories (
      StemCID TEXT PRIMARY KEY, ArrangeRole TEXT, DrumSubRole TEXT, BusId TEXT,
      Source TEXT NOT NULL, SourceProject TEXT, UpdatedAt INTEGER NOT NULL,
      SubcategoryNote TEXT
    );
    CREATE TABLE StemAutoClassifyTried (
      StemCID TEXT NOT NULL, TrainingFingerprint TEXT NOT NULL, Mask INTEGER,
      TriedAt INTEGER NOT NULL, PRIMARY KEY (StemCID, TrainingFingerprint)
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
    upsertStemAutoCategory(db, 's1', 'drums', 'model:2.1', 1000)
    expect(getAutoCategorizedStemCIDs(db, 'drums')).toEqual(new Set(['s1']))
    expect(getAutoCategorizedStemCIDs(db, 'bass')).toEqual(new Set())
  })

  it('overwrites an existing row on conflict rather than throwing', () => {
    const db = freshDb()
    upsertStemAutoCategory(db, 's1', 'drums', 'model:2.1', 1000)
    upsertStemAutoCategory(db, 's1', 'bass', 'instrumentMask', 2000)

    expect(getAutoCategorizedStemCIDs(db, 'drums')).toEqual(new Set())
    expect(getAutoCategorizedStemCIDs(db, 'bass')).toEqual(new Set(['s1']))

    const row = db
      .prepare(`SELECT Source, ComputedAt FROM StemAutoCategory WHERE StemCID = ?`)
      .get('s1') as {
      Source: string
      ComputedAt: number
    }
    expect(row).toEqual({ Source: 'instrumentMask', ComputedAt: 2000 })
  })
})

describe('upsertStemAutoCategory FrontScore', () => {
  const frontScore = (db: Database.Database): unknown =>
    (
      db.prepare(`SELECT FrontScore FROM StemAutoCategory WHERE StemCID = 'S1'`).get() as {
        FrontScore: number | null
      }
    ).FrontScore

  it('writes the dial when given one', () => {
    const db = freshDb()
    upsertStemAutoCategory(db, 'S1', 'backing', 'model:2.1', 123, 0.25)
    expect(frontScore(db)).toBe(0.25)
  })

  it('writes NULL without one, and an overwrite clears an old dial', () => {
    const db = freshDb()
    upsertStemAutoCategory(db, 'S1', 'backing', 'model:2.1', 123, 0.25)
    upsertStemAutoCategory(db, 'S1', 'drums', 'instrumentMask', 124)
    expect(frontScore(db)).toBeNull()
  })
})

describe('getStemAutoClassifyProgress', () => {
  it('returns an empty caught-up snapshot when nothing has been extracted', async () => {
    const db = freshDb()
    expect(await getStemAutoClassifyProgress(db, 'model:2.1')).toEqual({
      categorized: 0,
      eligible: 0,
      terminalUnclassified: 0,
      pending: 0,
      processed: 0
    })
  })

  it('dedupes embedded/featured stems and counts categories only inside the eligible set', async () => {
    const db = freshDb()
    seedEmbedding(db, 's1')
    seedFeatures(db, 's2')
    seedEmbedding(db, 's3')
    seedFeatures(db, 's3') // both -- counted once, not twice
    upsertStemAutoCategory(db, 's1', 'drums', 'model:2.1', 1000)

    expect(await getStemAutoClassifyProgress(db, 'model:2.1')).toEqual({
      categorized: 1,
      eligible: 3,
      terminalUnclassified: 0,
      pending: 2,
      processed: 1
    })
  })

  it.each([
    ['centroid', 'lead'],
    ['instrumentMask', 'lead'],
    ['model', 'backing'], // this branch's first, untagged model rows
    ['model:2.0', 'lead'] // an older model's guess
  ])(
    "counts an older app's or model's guess (%s, %s) as still pending: the model guesses it again",
    async (source, role) => {
      const db = freshDb()
      seedEmbedding(db, 's1')
      db.prepare(
        `INSERT INTO StemAutoCategory (StemCID, ArrangeRole, Source, ComputedAt)
       VALUES ('s1', ?, ?, 1)`
      ).run(role, source)

      expect(await getStemAutoClassifyProgress(db, 'model:2.1')).toEqual({
        categorized: 0,
        eligible: 1,
        terminalUnclassified: 0,
        pending: 1,
        processed: 0
      })
    }
  )

  it('excludes a stem confirmed for any role from eligible, even if it has an embedding', async () => {
    const db = freshDb()
    seedEmbedding(db, 's1')
    seedConfirmed(db, 's1', 'bass')
    seedEmbedding(db, 's2') // unconfirmed -- still eligible

    expect(await getStemAutoClassifyProgress(db, 'model:2.1')).toEqual({
      categorized: 0,
      eligible: 1,
      terminalUnclassified: 0,
      pending: 1,
      processed: 0
    })
  })

  it('treats a current tried row as terminal only while its instrument mask still matches', async () => {
    const db = freshDb()
    seedEmbedding(db, 'same-mask')
    seedFeatures(db, 'changed-mask')
    db.prepare(`INSERT INTO StemAutoClassifyTried VALUES (?, 'training-1', ?, 1000)`).run(
      'same-mask',
      4
    )
    db.prepare(`INSERT INTO StemAutoClassifyTried VALUES (?, 'training-1', ?, 1000)`).run(
      'changed-mask',
      8
    )

    expect(
      await getStemAutoClassifyProgress(
        db,
        'model:2.1',
        'training-1',
        (ids) => new Map(ids.map((id) => [id, id === 'same-mask' ? 4 : 16]))
      )
    ).toEqual({
      categorized: 0,
      eligible: 2,
      terminalUnclassified: 1,
      pending: 1,
      processed: 1
    })
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

  it.each(['model:2.1', 'instrumentMask'] as const)(
    'returns false for a stem that already has a StemAutoCategory row (source: %s)',
    (source) => {
      const db = freshDb()
      upsertStemAutoCategory(db, 's1', 'drums', source, 1000)
      expect(isStemEligibleForAutoCategory(db, 's1')).toBe(false)
    }
  )
})
