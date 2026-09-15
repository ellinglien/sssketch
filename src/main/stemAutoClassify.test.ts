// src/main/stemAutoClassify.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { classifyAutoCategoryBatch } from './stemAutoClassify'
import { getAllAutoCategorizedStemCIDs, getAutoCategorizedStemCIDs } from './stemAutoCategoryStore'
import * as categoryCentroidStore from './categoryCentroidStore'
import { emptyCategoryCentroidStore, recordConfirmedCategory } from '@shared/categoryCentroids'
import type { StemFeatures } from '@shared/stemFeatures'

// The centroid/feature pass reads app.getPath('userData') via
// loadCategoryCentroidStore -- mock just that narrow surface, same
// established convention as discoverCandidates.test.ts used before this
// classification logic moved here. Pointed at a path that won't exist, so
// loadCategoryCentroidStore falls back to its own documented "empty store"
// behavior unless a test explicitly spies in a trained one.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/stemAutoClassify-test-userdata' }
}))

afterEach(() => {
  vi.restoreAllMocks()
})

function freshDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE StemCategories (
      StemCID TEXT PRIMARY KEY, ArrangeRole TEXT, DrumSubRole TEXT, BusId TEXT,
      Source TEXT NOT NULL, SourceProject TEXT, UpdatedAt INTEGER NOT NULL
    );
    CREATE TABLE StemEmbeddingCache (
      StemCID TEXT PRIMARY KEY, EmbeddingJSON TEXT NOT NULL, ExtractedAt INTEGER NOT NULL
    );
    CREATE TABLE StemFeatureCache (
      StemCID TEXT PRIMARY KEY, FeaturesJSON TEXT NOT NULL, ExtractedAt INTEGER NOT NULL
    );
    CREATE TABLE StemAutoCategory (
      StemCID TEXT PRIMARY KEY, ArrangeRole TEXT NOT NULL, Source TEXT NOT NULL,
      ComputedAt INTEGER NOT NULL
    );
  `)
  return db
}

function seedConfirmed(db: Database.Database, stemCID: string, arrangeRole: string): void {
  db.prepare(
    `INSERT INTO StemCategories (StemCID, ArrangeRole, DrumSubRole, BusId, Source, SourceProject, UpdatedAt)
     VALUES (?, ?, NULL, NULL, 'tidyup', NULL, 1000)`
  ).run(stemCID, arrangeRole)
}

function seedEmbedding(db: Database.Database, stemCID: string, embedding: number[]): void {
  db.prepare(
    `INSERT INTO StemEmbeddingCache (StemCID, EmbeddingJSON, ExtractedAt) VALUES (?, ?, 1000)`
  ).run(stemCID, JSON.stringify(embedding))
}

function seedFeatures(
  db: Database.Database,
  stemCID: string,
  overrides: Partial<StemFeatures> = {}
): void {
  const features: StemFeatures = {
    transientDensity: 0,
    bassEnergyRatio: 0,
    spectralCentroidHz: 0,
    zcrBrightness: 0,
    voicedFraction: 0,
    pitchVarianceCents: 0,
    mfcc: new Array(13).fill(0),
    ...overrides
  }
  db.prepare(
    `INSERT INTO StemFeatureCache (StemCID, FeaturesJSON, ExtractedAt) VALUES (?, ?, 1000)`
  ).run(stemCID, JSON.stringify(features))
}

/** 3 confirmed 'drums' embeddings near (1,0,0), 3 confirmed 'bass' near
 * (0,1,0) -- the minimum suggestCategoryFromEmbedding needs per category
 * (MIN_SAMPLES_PER_CATEGORY=3) with 2 categories trained
 * (MIN_CATEGORIES_FOR_SUGGESTION=2). */
function seedTrainedEmbeddings(db: Database.Database): void {
  for (let i = 0; i < 3; i++) {
    seedConfirmed(db, `train-drums-${i}`, 'drums')
    seedEmbedding(db, `train-drums-${i}`, [1, 0, 0])
    seedConfirmed(db, `train-bass-${i}`, 'bass')
    seedEmbedding(db, `train-bass-${i}`, [0, 1, 0])
  }
}

describe('classifyAutoCategoryBatch', () => {
  it('returns processed=0, remaining=0 when there is nothing to classify', async () => {
    const db = freshDb()
    expect(await classifyAutoCategoryBatch(db)).toEqual({ processed: 0, remaining: 0 })
  })

  it('classifies an unconfirmed embedded stem via the embedding pass and persists it', async () => {
    const db = freshDb()
    seedTrainedEmbeddings(db)
    seedEmbedding(db, 'guessed-1', [0.9, 0.1, 0]) // near the drums cluster

    const result = await classifyAutoCategoryBatch(db)
    expect(result.processed).toBe(1)
    expect(getAutoCategorizedStemCIDs(db, 'drums')).toEqual(new Set(['guessed-1']))
    const row = db
      .prepare(`SELECT Source FROM StemAutoCategory WHERE StemCID = ?`)
      .get('guessed-1') as {
      Source: string
    }
    expect(row.Source).toBe('embedding')
  })

  it('skips a stem already confirmed for any role', async () => {
    const db = freshDb()
    seedTrainedEmbeddings(db)
    seedConfirmed(db, 'already-confirmed', 'bass')
    seedEmbedding(db, 'already-confirmed', [0.9, 0.1, 0]) // embeds near drums, but confirmed bass

    const result = await classifyAutoCategoryBatch(db)
    // Only the un-confirmed stems in seedTrainedEmbeddings itself get
    // classified -- none, since every seeded stem there is confirmed.
    expect(result.processed).toBe(0)
    expect(getAllAutoCategorizedStemCIDs(db)).toEqual(new Set())
  })

  it('skips a stem already present in StemAutoCategory', async () => {
    const db = freshDb()
    seedTrainedEmbeddings(db)
    seedEmbedding(db, 'guessed-1', [0.9, 0.1, 0])

    const first = await classifyAutoCategoryBatch(db)
    expect(first.processed).toBe(1)

    const second = await classifyAutoCategoryBatch(db)
    expect(second.processed).toBe(0)
    expect(second.remaining).toBe(0)
  })

  it('counts pending embeddings as remaining, without spending a classify call, when nothing is trained on the embedding axis yet', async () => {
    const db = freshDb()
    // No confirmed StemCategories rows at all -- getConfirmedEmbeddings
    // returns [], so suggestCategoryFromEmbedding could never confidently
    // classify anything yet.
    seedEmbedding(db, 'untrained-1', [1, 0, 0])

    const result = await classifyAutoCategoryBatch(db)
    expect(result.processed).toBe(0)
    expect(result.remaining).toBe(1)
    expect(getAllAutoCategorizedStemCIDs(db)).toEqual(new Set())
  })

  it('falls back to the centroid/feature classifier when no embedding exists for the stem', async () => {
    const db = freshDb()
    let store = emptyCategoryCentroidStore()
    const zeros = new Array(13).fill(0)
    for (let i = 0; i < 3; i++) {
      store = recordConfirmedCategory(store, 'arrangeRole', 'drums', [1, 0, 0, 0, 0, 0, ...zeros])
      store = recordConfirmedCategory(store, 'arrangeRole', 'bass', [0, 1, 0, 0, 0, 0, ...zeros])
    }
    vi.spyOn(categoryCentroidStore, 'loadCategoryCentroidStore').mockReturnValue(store)

    seedFeatures(db, 'unconfirmed-1', { transientDensity: 0.9, bassEnergyRatio: 0.1 })

    const result = await classifyAutoCategoryBatch(db)
    expect(result.processed).toBe(1)
    expect(getAutoCategorizedStemCIDs(db, 'drums')).toEqual(new Set(['unconfirmed-1']))
    const row = db
      .prepare(`SELECT Source FROM StemAutoCategory WHERE StemCID = ?`)
      .get('unconfirmed-1') as {
      Source: string
    }
    expect(row.Source).toBe('centroid')
  })

  it('prefers the embedding classifier over the centroid one when a stem has both, and never re-attempts it in the feature pass', async () => {
    const db = freshDb()
    seedTrainedEmbeddings(db)
    // Centroid store trained the OPPOSITE way round -- if the feature pass
    // ran on this stem too, it would classify it 'bass' instead.
    let store = emptyCategoryCentroidStore()
    const zeros = new Array(13).fill(0)
    for (let i = 0; i < 3; i++) {
      store = recordConfirmedCategory(store, 'arrangeRole', 'drums', [0, 1, 0, 0, 0, 0, ...zeros])
      store = recordConfirmedCategory(store, 'arrangeRole', 'bass', [1, 0, 0, 0, 0, 0, ...zeros])
    }
    vi.spyOn(categoryCentroidStore, 'loadCategoryCentroidStore').mockReturnValue(store)

    seedEmbedding(db, 'both-1', [0.9, 0.1, 0]) // near the drums embedding cluster
    seedFeatures(db, 'both-1', { transientDensity: 0.9, bassEnergyRatio: 0.1 }) // near the 'bass' centroid, per the swapped store above

    const result = await classifyAutoCategoryBatch(db)
    expect(result.processed).toBe(1)
    expect(getAutoCategorizedStemCIDs(db, 'drums')).toEqual(new Set(['both-1']))
    const row = db
      .prepare(`SELECT Source FROM StemAutoCategory WHERE StemCID = ?`)
      .get('both-1') as {
      Source: string
    }
    expect(row.Source).toBe('embedding')
  })

  it('leaves an unclassifiable stem out of StemAutoCategory rather than marking it tried-and-failed', async () => {
    const db = freshDb()
    seedTrainedEmbeddings(db)
    // Equidistant between the drums and bass clusters -- no confident
    // margin, suggestCategoryFromEmbedding returns null.
    seedEmbedding(db, 'ambiguous-1', [0.5, 0.5, 0])

    const result = await classifyAutoCategoryBatch(db)
    expect(result.processed).toBe(0)
    expect(getAllAutoCategorizedStemCIDs(db)).toEqual(new Set())
  })

  it('bounds one call to BATCH_SIZE (200), leaving the rest as remaining', async () => {
    const db = freshDb()
    seedTrainedEmbeddings(db)
    for (let i = 0; i < 201; i++) {
      seedEmbedding(db, `guessed-${i}`, [0.9, 0.1, 0])
    }

    const result = await classifyAutoCategoryBatch(db)
    expect(result.processed).toBe(200)
    expect(result.remaining).toBe(1)
    expect(getAllAutoCategorizedStemCIDs(db).size).toBe(200)
  })

  // Real bug, caught in review before this shipped: a stem past index
  // BATCH_SIZE in the embedding pass's own pending list is DEFERRED, not
  // written -- so it must not fall through to the feature/centroid pass in
  // the SAME call. Without excluding it there too, it would get
  // permanently classified (possibly WRONGLY) by the less-accurate
  // classifier, and once written, never reconsidered by the embedding pass
  // on any later call. This is the normal case for a real multi-thousand-
  // stem library on first run, not an edge case.
  it('does not let an embedding pass overflow (deferred past BATCH_SIZE) fall through to the centroid pass in the same call', async () => {
    const db = freshDb()
    seedTrainedEmbeddings(db)
    for (let i = 0; i < 201; i++) {
      seedEmbedding(db, `guessed-${i}`, [0.9, 0.1, 0]) // all near the drums cluster
    }
    // Centroid store trained the OPPOSITE way round from the embeddings --
    // if the overflowed 201st embedding stem fell through to this pass, it
    // would get classified 'bass' instead of the 'drums' its own embedding
    // would give it.
    let store = emptyCategoryCentroidStore()
    const zeros = new Array(13).fill(0)
    for (let i = 0; i < 3; i++) {
      store = recordConfirmedCategory(store, 'arrangeRole', 'drums', [0, 1, 0, 0, 0, 0, ...zeros])
      store = recordConfirmedCategory(store, 'arrangeRole', 'bass', [1, 0, 0, 0, 0, 0, ...zeros])
    }
    vi.spyOn(categoryCentroidStore, 'loadCategoryCentroidStore').mockReturnValue(store)
    // Every one of the 201 embedded stems also has a feature vector that
    // would classify 'bass' via the (swapped) centroid store above.
    for (let i = 0; i < 201; i++) {
      seedFeatures(db, `guessed-${i}`, { transientDensity: 0.9, bassEnergyRatio: 0.1 })
    }

    const result = await classifyAutoCategoryBatch(db)
    // Exactly 200 processed via the embedding pass; the 201st stays
    // untouched by either pass this call.
    expect(result.processed).toBe(200)
    expect(getAllAutoCategorizedStemCIDs(db).size).toBe(200)
    for (const row of db.prepare(`SELECT Source FROM StemAutoCategory`).all() as {
      Source: string
    }[]) {
      expect(row.Source).toBe('embedding')
    }
  })

  // Real live bug, root-caused from a user report ("stuck" at a small
  // fraction of a real ~45,000-stem backlog, never advancing across
  // repeated checks): the original code always took the SAME leading
  // BATCH_SIZE ids, in stable table order, every call. A run of
  // permanently-unclassifiable stems at the head of the table (larger
  // than BATCH_SIZE) could therefore starve every classifiable stem
  // located anywhere AFTER it, forever -- this test reproduces exactly
  // that shape: 250 stems whose own features sit ambiguously between the
  // two trained centroids (never classify), inserted BEFORE 10 genuinely
  // classifiable ones. Under the old deterministic slice, this call would
  // process exactly 0 of the 10 classifiable stems, every single time.
  it('does not let an unclassifiable run larger than BATCH_SIZE permanently starve classifiable stems later in the table (starvation regression)', async () => {
    const db = freshDb()
    let store = emptyCategoryCentroidStore()
    const zeros = new Array(13).fill(0)
    for (let i = 0; i < 3; i++) {
      store = recordConfirmedCategory(store, 'arrangeRole', 'drums', [1, 0, 0, 0, 0, 0, ...zeros])
      store = recordConfirmedCategory(store, 'arrangeRole', 'bass', [0, 1, 0, 0, 0, 0, ...zeros])
    }
    vi.spyOn(categoryCentroidStore, 'loadCategoryCentroidStore').mockReturnValue(store)

    for (let i = 0; i < 250; i++) {
      seedFeatures(db, `ambiguous-${i}`, { transientDensity: 0.5, bassEnergyRatio: 0.5 })
    }
    for (let i = 0; i < 10; i++) {
      seedFeatures(db, `classifiable-${i}`, { transientDensity: 0.9, bassEnergyRatio: 0.1 })
    }

    const result = await classifyAutoCategoryBatch(db)
    expect(result.processed).toBeGreaterThan(0)
    for (const stemCID of getAutoCategorizedStemCIDs(db, 'drums')) {
      expect(stemCID).toMatch(/^classifiable-/)
    }
  })
})
