// src/main/stemAutoClassify.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CLASSIFIER_VERSION, classifyAutoCategoryBatch } from './stemAutoClassify'
import { getAutoCategorizedStemCIDs } from './stemAutoCategoryStore'
import type { StemFeatures } from '@shared/stemFeatures'
import { setStemEmbeddingCache } from './stemEmbeddingCacheStore'
import { setStemFeatureCache } from './stemFeatureCacheStore'
import { noteAutoClassifyTrainingChanged } from './stemAutoClassifyWake'
import { bumpTableWriteVersion } from './tableWriteVersion'
import type { StemCategoryModel } from '@shared/stemCategoryModel'
import {
  MAX_TRIED_FINGERPRINTS_PER_STEM,
  STEM_AUTO_CLASSIFY_TRIED_DDL,
  pruneStemsTriedSlice
} from './stemAutoClassifyTried'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'auto-classify-'))
})
afterEach(() => {
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

function freshDb(path = ':memory:'): Database.Database {
  const db = new Database(path)
  db.exec(STEM_AUTO_CLASSIFY_TRIED_DDL)
  db.exec(`
    CREATE TABLE IF NOT EXISTS StemCategories (
      StemCID TEXT PRIMARY KEY, ArrangeRole TEXT, DrumSubRole TEXT, BusId TEXT,
      Source TEXT NOT NULL, SourceProject TEXT, UpdatedAt INTEGER NOT NULL,
      SubcategoryNote TEXT
    );
    CREATE TABLE IF NOT EXISTS StemEmbeddingCache (
      StemCID TEXT PRIMARY KEY, EmbeddingJSON TEXT NOT NULL, ExtractedAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS StemFeatureCache (
      StemCID TEXT PRIMARY KEY, FeaturesJSON TEXT NOT NULL, ExtractedAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS StemAutoCategory (
      StemCID TEXT PRIMARY KEY, ArrangeRole TEXT NOT NULL, Source TEXT NOT NULL,
      ComputedAt INTEGER NOT NULL, FrontScore REAL
    );
    CREATE TABLE IF NOT EXISTS Stems (
      StemCID TEXT PRIMARY KEY, OwnerJamCID TEXT NOT NULL, Instrument INTEGER
    );
  `)
  return db
}

const DRUMS_BIT = 1 << 1
const NOTES_BIT = 1 << 2
const BASS_BIT = 1 << 3
const AUDIO_IN_BIT = 1 << 4

function seedInstrument(db: Database.Database, stemCID: string, instrument: number): void {
  db.prepare(`INSERT INTO Stems (StemCID, OwnerJamCID, Instrument) VALUES (?, 'jam1', ?)`).run(
    stemCID,
    instrument
  )
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

/** A 3-dim test model (the shipped one is 1024): logits drums = 10·x0,
 * bass = 10·x1, back = 5, front = 10·x2. So [0.9, 0.1, 0] is drums,
 * [0.1, 0.9, 0] bass, [0, 0, 0] back and [0, 0, 1] front. */
function testModel(version: number, weights: number[][], bias: number[]): StemCategoryModel {
  return {
    version,
    dims: 3,
    classes: ['drums', 'bass', 'back', 'front'],
    mean: [0, 0, 0],
    scale: [1, 1, 1],
    weights,
    bias
  }
}
const TEST_MODEL = testModel(
  1,
  [
    [10, 0, 0],
    [0, 10, 0],
    [0, 0, 0],
    [0, 0, 10]
  ],
  [0, 0, 5, 0]
)
const UNTRAINED_MODEL: StemCategoryModel = { ...TEST_MODEL, version: 0 }
/** The same probabilities (drums, bass, back, front) whatever the embedding. */
function fixedProbsModel(p: [number, number, number, number]): StemCategoryModel {
  const zeros = [0, 0, 0]
  return testModel(1, [zeros, zeros, zeros, zeros], p.map(Math.log))
}
/** Wrong length for the test model: one it can't read, so never placed. */
const UNPLACEABLE = [0.5, 0.5]

function classify(
  db: Database.Database,
  stemDbs: Database.Database[] = [db],
  options: Parameters<typeof classifyAutoCategoryBatch>[2] = {}
): ReturnType<typeof classifyAutoCategoryBatch> {
  return classifyAutoCategoryBatch(db, stemDbs, { model: TEST_MODEL, ...options })
}

function autoRow(
  db: Database.Database,
  stemCID: string
): { ArrangeRole: string; Source: string; FrontScore: number | null } | undefined {
  return db
    .prepare(`SELECT ArrangeRole, Source, FrontScore FROM StemAutoCategory WHERE StemCID = ?`)
    .get(stemCID) as { ArrangeRole: string; Source: string; FrontScore: number | null } | undefined
}

function triedStemCIDs(db: Database.Database): string[] {
  return (
    db.prepare(`SELECT StemCID FROM StemAutoClassifyTried ORDER BY StemCID`).all() as {
      StemCID: string
    }[]
  ).map((r) => r.StemCID)
}

/** Every StemCID in StemAutoCategory, regardless of role -- a direct
 * query rather than a production helper, since classifyAutoCategoryBatch
 * itself no longer materializes this set (see its own doc comment on why:
 * a real live perf bug from reading it in full on every call). */
function allClassifiedStemCIDs(db: Database.Database): Set<string> {
  const rows = db.prepare(`SELECT StemCID FROM StemAutoCategory`).all() as { StemCID: string }[]
  return new Set(rows.map((r) => r.StemCID))
}

describe('classifyAutoCategoryBatch', () => {
  it('returns processed=0, remaining=0 when there is nothing to classify', async () => {
    const db = freshDb()
    expect(await classify(db)).toEqual({ processed: 0, remaining: 0 })
  })

  it('classifies an unconfirmed embedded stem via the model and persists it', async () => {
    const db = freshDb()
    seedEmbedding(db, 'guessed-1', [0.9, 0.1, 0])

    const result = await classify(db)
    expect(result.processed).toBe(1)
    expect(getAutoCategorizedStemCIDs(db, 'drums')).toEqual(new Set(['guessed-1']))
    expect(autoRow(db, 'guessed-1')?.Source).toBe('model')
  })

  it('skips a stem already confirmed for any role', async () => {
    const db = freshDb()
    seedConfirmed(db, 'already-confirmed', 'bass')
    seedEmbedding(db, 'already-confirmed', [0.9, 0.1, 0]) // the model says drums, but confirmed bass

    const result = await classify(db)
    expect(result.processed).toBe(0)
    expect(allClassifiedStemCIDs(db)).toEqual(new Set())
  })

  it('skips a stem already present in StemAutoCategory', async () => {
    const db = freshDb()
    seedEmbedding(db, 'guessed-1', [0.9, 0.1, 0])

    const first = await classify(db)
    expect(first.processed).toBe(1)

    const second = await classify(db)
    expect(second.processed).toBe(0)
    expect(second.remaining).toBe(0)
  })

  it('places a stem with both an embedding and features by the model; the feature pass never fetches it', async () => {
    const db = freshDb()
    seedEmbedding(db, 'both-1', [0.9, 0.1, 0])
    seedFeatures(db, 'both-1', { transientDensity: 0.9, bassEnergyRatio: 0.1 })
    const featureFetch = vi.spyOn(db, 'prepare')

    const result = await classify(db)
    expect(result).toEqual({ processed: 1, remaining: 0 })
    expect(autoRow(db, 'both-1')?.Source).toBe('model')
    expect(
      featureFetch.mock.calls.filter(([sql]) =>
        String(sql).includes('SELECT f.StemCID AS StemCID FROM StemFeatureCache f')
      )
    ).toEqual([])
  })

  it('leaves a stem whose embedding the model cannot read (wrong length) out of StemAutoCategory', async () => {
    const db = freshDb()
    seedEmbedding(db, 'unreadable-1', UNPLACEABLE)

    const result = await classify(db)
    expect(result.processed).toBe(0)
    expect(allClassifiedStemCIDs(db)).toEqual(new Set())
  })

  it('bounds one call to BATCH_SIZE (200), leaving the rest as remaining', async () => {
    const db = freshDb()
    for (let i = 0; i < 201; i++) {
      seedEmbedding(db, `guessed-${i}`, [0.9, 0.1, 0])
    }

    const result = await classify(db)
    expect(result.processed).toBe(200)
    expect(result.remaining).toBe(1)
    expect(allClassifiedStemCIDs(db).size).toBe(200)
  })

  // A stem past BATCH_SIZE in the embedding pass's own pending list is
  // DEFERRED, not written -- it must not be tried by the feature pass in the
  // same call (which can't place it, and would record it as tried).
  it('does not let an embedding pass overflow (deferred past BATCH_SIZE) fall through to the feature pass in the same call', async () => {
    const db = freshDb()
    for (let i = 0; i < 201; i++) {
      seedEmbedding(db, `guessed-${i}`, [0.9, 0.1, 0])
      seedFeatures(db, `guessed-${i}`, { transientDensity: 0.9, bassEnergyRatio: 0.1 })
    }

    const result = await classify(db)
    expect(result).toEqual({ processed: 200, remaining: 1 })
    expect(allClassifiedStemCIDs(db).size).toBe(200)
    expect(triedStemCIDs(db)).toEqual([])
    const second = await classify(db)
    expect(second).toEqual({ processed: 1, remaining: 0 })
    for (const row of db.prepare(`SELECT Source FROM StemAutoCategory`).all() as {
      Source: string
    }[]) {
      expect(row.Source).toBe('model')
    }
  })

  // Real live bug, root-caused from a user report ("stuck" at a small
  // fraction of a real ~45,000-stem backlog): the original code always took
  // the SAME leading BATCH_SIZE ids, in stable table order, every call. A
  // run of unplaceable stems at the head of the table (larger than
  // BATCH_SIZE) could starve every placeable stem after it, forever.
  it('does not let an unplaceable run larger than BATCH_SIZE permanently starve placeable stems later in the table (starvation regression)', async () => {
    const db = freshDb()
    for (let i = 0; i < 250; i++) {
      seedEmbedding(db, `unreadable-${i}`, UNPLACEABLE)
    }
    for (let i = 0; i < 10; i++) {
      seedEmbedding(db, `classifiable-${i}`, [0.9, 0.1, 0])
    }

    const result = await classify(db)
    expect(result.processed).toBeGreaterThan(0)
    for (const stemCID of getAutoCategorizedStemCIDs(db, 'drums')) {
      expect(stemCID).toMatch(/^classifiable-/)
    }
  })

  // Real perf bug, found live: each classified stem used to be written via
  // its own separate upsertStemAutoCategory call, with no explicit
  // transaction -- one fsync per row. One transaction per pass instead.
  it('writes each pass batch inside a single transaction, not one commit per row', async () => {
    const db = freshDb()
    for (let i = 0; i < 5; i++) {
      seedEmbedding(db, `guessed-embedding-${i}`, [0.9, 0.1, 0])
    }
    for (let i = 0; i < 5; i++) {
      seedFeatures(db, `guessed-feature-${i}`, { transientDensity: 0.9, bassEnergyRatio: 0.1 })
      seedInstrument(db, `guessed-feature-${i}`, DRUMS_BIT)
    }

    const transactionSpy = vi.spyOn(db, 'transaction')

    const result = await classify(db)
    expect(result.processed).toBe(10)
    expect(transactionSpy).toHaveBeenCalledTimes(2)
  })

  // Endlesss's drums and bass bits are performer-set ground truth (direct
  // correction, 2026-09-18); audioIn can be anything. Since 2026-11-14 the
  // notes bit no longer decides: it says "melodic", not front or back.
  describe('instrument-mask short-circuit', () => {
    it('classifies a drums-masked stem directly via the mask, never the model', async () => {
      const db = freshDb()
      // The model would call this 'bass'.
      seedEmbedding(db, 'masked-drums-1', [0, 1, 0])
      seedInstrument(db, 'masked-drums-1', DRUMS_BIT)

      const result = await classify(db, [db])
      expect(result.processed).toBe(1)
      expect(getAutoCategorizedStemCIDs(db, 'drums')).toEqual(new Set(['masked-drums-1']))
      expect(autoRow(db, 'masked-drums-1')?.Source).toBe('instrumentMask')
    })

    it('classifies a bass-masked stem directly via the mask', async () => {
      const db = freshDb()
      seedEmbedding(db, 'masked-bass-1', [0.9, 0.1, 0]) // the model would say drums
      seedInstrument(db, 'masked-bass-1', BASS_BIT)

      await classify(db, [db])
      expect(getAutoCategorizedStemCIDs(db, 'bass')).toEqual(new Set(['masked-bass-1']))
    })

    it('does NOT short-circuit an audioIn-masked stem -- audioIn can genuinely be anything', async () => {
      const db = freshDb()
      seedEmbedding(db, 'masked-audioin-1', [0.9, 0.1, 0])
      seedInstrument(db, 'masked-audioin-1', AUDIO_IN_BIT)

      const result = await classify(db, [db])
      expect(result.processed).toBe(1)
      expect(getAutoCategorizedStemCIDs(db, 'drums')).toEqual(new Set(['masked-audioin-1']))
      expect(autoRow(db, 'masked-audioin-1')?.Source).toBe('model')
    })

    it('does NOT short-circuit a stem with no Instrument row at all', async () => {
      const db = freshDb()
      seedEmbedding(db, 'no-mask-1', [0.9, 0.1, 0])

      const result = await classify(db, [db])
      expect(result.processed).toBe(1)
      expect(autoRow(db, 'no-mask-1')?.Source).toBe('model')
    })

    it('resolves a mask-confident stem even when the model is untrained', async () => {
      const db = freshDb()
      seedEmbedding(db, 'masked-drums-2', [0, 0, 1])
      seedInstrument(db, 'masked-drums-2', DRUMS_BIT)

      const result = await classify(db, [db], { model: UNTRAINED_MODEL })
      expect(result).toEqual({ processed: 1, remaining: 0 })
      expect(getAutoCategorizedStemCIDs(db, 'drums')).toEqual(new Set(['masked-drums-2']))
    })

    it('applies the same short-circuit in the feature pass', async () => {
      const db = freshDb()
      seedFeatures(db, 'masked-bass-feature-1', { transientDensity: 0.9, bassEnergyRatio: 0.1 })
      seedInstrument(db, 'masked-bass-feature-1', BASS_BIT)

      const result = await classify(db, [db])
      expect(result.processed).toBe(1)
      expect(autoRow(db, 'masked-bass-feature-1')).toEqual({
        ArrangeRole: 'bass',
        Source: 'instrumentMask',
        FrontScore: null
      })
    })

    // A stem's own "Stems" row can live in a DIFFERENT db than the one
    // StemEmbeddingCache/StemAutoCategory live in (an external, read-only
    // LORE archive). `stemDbs` must be searched in full, not just `ownDb`.
    it('finds the Instrument mask in a SEPARATE db from ownDb', async () => {
      const own = freshDb()
      seedEmbedding(own, 'external-drums-1', [0.1, 0.9, 0]) // the model would say bass

      const external = new Database(':memory:')
      external.exec(
        `CREATE TABLE Stems (StemCID TEXT PRIMARY KEY, OwnerJamCID TEXT NOT NULL, Instrument INTEGER)`
      )
      seedInstrument(external, 'external-drums-1', DRUMS_BIT)

      const result = await classify(own, [own, external])
      expect(result.processed).toBe(1)
      expect(getAutoCategorizedStemCIDs(own, 'drums')).toEqual(new Set(['external-drums-1']))
    })
  })
})

// Background scan audit item 2b: masks from the instrument rows already in
// memory (discoverCandidates.ts's getInstrumentMaskLookup, injected by the
// scheduler) rather than a USB IN query per batch.
describe('classifyAutoCategoryBatch (instrument masks from memory)', () => {
  function stemsDb(masks: Record<string, number | null>): Database.Database {
    const db = new Database(':memory:')
    db.exec(`CREATE TABLE Stems (StemCID TEXT PRIMARY KEY, OwnerJamCID TEXT, Instrument INTEGER)`)
    for (const [stemCID, instrument] of Object.entries(masks)) {
      db.prepare(`INSERT INTO Stems VALUES (?, 'jam1', ?)`).run(stemCID, instrument)
    }
    return db
  }

  function maskQueries(db: Database.Database): () => number {
    const spy = vi.spyOn(db, 'prepare')
    return () =>
      spy.mock.calls.filter(([sql]) => String(sql).includes('FROM Stems WHERE StemCID IN')).length
  }

  /** What the in-memory rows would say: exactly the archive's own table. */
  function memoryOf(masks: Record<string, number | null>) {
    return (stemCID: string): number | null | undefined =>
      stemCID in masks ? masks[stemCID] : undefined
  }

  function seedMixed(own: Database.Database): void {
    seedEmbedding(own, 'arch-drums', [0.1, 0.9, 0]) // the model says bass; the mask says drums
    seedEmbedding(own, 'arch-mic', [0.1, 0.9, 0]) // audioIn: the model decides (bass)
    seedEmbedding(own, 'own-bass', [0.9, 0.1, 0]) // only ownDb has its row
    seedInstrument(own, 'own-bass', BASS_BIT)
  }
  const ARCHIVE = { 'arch-drums': DRUMS_BIT, 'arch-mic': AUDIO_IN_BIT }

  it('classifies exactly as the SQL lookup does, without querying the archive', async () => {
    const reference = freshDb()
    seedMixed(reference)
    await classify(reference, [stemsDb(ARCHIVE), reference])

    const own = freshDb()
    seedMixed(own)
    const archive = stemsDb(ARCHIVE)
    const queried = maskQueries(archive)
    await classify(own, [archive, own], {
      instrumentLookup: (db) => (db === archive ? memoryOf(ARCHIVE) : null)
    })
    expect(queried()).toBe(0)
    const all = (db: Database.Database): unknown[] =>
      db.prepare(`SELECT StemCID, ArrangeRole, Source FROM StemAutoCategory ORDER BY StemCID`).all()
    expect(all(own)).toEqual(all(reference))
    expect(getAutoCategorizedStemCIDs(own, 'drums')).toEqual(new Set(['arch-drums']))
    expect(getAutoCategorizedStemCIDs(own, 'bass')).toEqual(new Set(['arch-mic', 'own-bass']))
  })

  it('asks SQL for a db whose rows are not in memory (or not current)', async () => {
    const own = freshDb()
    seedMixed(own)
    const archive = stemsDb(ARCHIVE)
    const queried = maskQueries(archive)
    await classify(own, [archive, own], { instrumentLookup: () => null })
    expect(queried()).toBe(1)
    expect(getAutoCategorizedStemCIDs(own, 'drums')).toEqual(new Set(['arch-drums']))
  })

  it('moves on to the next db for a stem the rows have with no mask, as SQL did', async () => {
    const own = freshDb()
    seedEmbedding(own, 'split', [0.1, 0.9, 0])
    seedInstrument(own, 'split', DRUMS_BIT)
    const archive = stemsDb({ split: null })
    await classify(own, [archive, own], {
      instrumentLookup: (db) => (db === archive ? memoryOf({ split: null }) : null)
    })
    expect(getAutoCategorizedStemCIDs(own, 'drums')).toEqual(new Set(['split']))
  })
})

// Background efficiency B4: the eligible ids are read once into a shuffled
// in-memory pending list and consumed a batch at a time, instead of a
// COUNT(*) + ORDER BY RANDOM() per batch.
describe('classifyAutoCategoryBatch (pending list)', () => {
  function pendingBuildCount(db: Database.Database): () => number {
    const spy = vi.spyOn(db, 'prepare')
    return () => spy.mock.calls.filter(([sql]) => String(sql).includes('ORDER BY t.StemCID')).length
  }

  async function runToCompletion(db: Database.Database): Promise<number> {
    let calls = 0
    for (;;) {
      calls += 1
      const { remaining } = await classify(db)
      if (remaining === 0 || calls > 100) return calls
    }
  }

  function classifications(db: Database.Database): string[] {
    return (
      db.prepare(`SELECT StemCID, ArrangeRole, Source FROM StemAutoCategory`).all() as {
        StemCID: string
        ArrangeRole: string
        Source: string
      }[]
    )
      .map((r) => `${r.StemCID}:${r.ArrangeRole}:${r.Source}`)
      .sort()
  }

  /** A mixed library: embedding stems the model places as drums / bass /
   * can't read, feature-only stems (unmasked, notes-masked: never placed)
   * and drums-masked feature-only stems. */
  function seedLibrary(db: Database.Database, prefix: string, n: number): void {
    for (let i = 0; i < n; i++) {
      seedEmbedding(db, `${prefix}-emb-drums-${i}`, [0.9, 0.1, 0])
      seedEmbedding(db, `${prefix}-emb-bass-${i}`, [0.1, 0.9, 0])
      seedEmbedding(db, `${prefix}-emb-unreadable-${i}`, UNPLACEABLE)
      seedFeatures(db, `${prefix}-feat-${i}`, { transientDensity: 0.9, bassEnergyRatio: 0.1 })
      seedInstrument(db, `${prefix}-feat-notes-${i}`, NOTES_BIT)
      seedFeatures(db, `${prefix}-feat-notes-${i}`, { transientDensity: 0.9, bassEnergyRatio: 0.1 })
      seedInstrument(db, `${prefix}-mask-drums-${i}`, DRUMS_BIT)
      seedFeatures(db, `${prefix}-mask-drums-${i}`, { transientDensity: 0.9, bassEnergyRatio: 0.1 })
    }
  }

  it('builds the eligible id list once and consumes it across batches', async () => {
    const db = freshDb()
    seedLibrary(db, 'a', 150) // 450 embedding ids + 450 feature ids
    const builds = pendingBuildCount(db)

    const calls = await runToCompletion(db)
    expect(calls).toBe(3) // 450 ids per list / BATCH_SIZE 200
    // One build = one keyset page per table.
    expect(builds()).toBe(2)
    expect(classifications(db)).toHaveLength(150 * 3)
  })

  it('yields the same classifications as a from-scratch run, with rows arriving mid-pass through the cache stores', async () => {
    // Reference: everything present up front.
    const reference = freshDb()
    seedLibrary(reference, 'a', 120)
    seedLibrary(reference, 'b', 40)
    await runToCompletion(reference)

    // Same data, but the 'b' rows arrive between batches via the real
    // store writers (which note them for the pending list).
    const db = freshDb()
    seedLibrary(db, 'a', 120)
    const builds = pendingBuildCount(db)
    await classify(db)

    const late = freshDb()
    seedLibrary(late, 'b', 40)
    const embeddings = late
      .prepare(`SELECT StemCID, EmbeddingJSON FROM StemEmbeddingCache`)
      .all() as {
      StemCID: string
      EmbeddingJSON: string
    }[]
    const features = late.prepare(`SELECT StemCID, FeaturesJSON FROM StemFeatureCache`).all() as {
      StemCID: string
      FeaturesJSON: string
    }[]
    const masks = late.prepare(`SELECT StemCID, Instrument FROM Stems`).all() as {
      StemCID: string
      Instrument: number
    }[]
    const maskByStem = new Map(masks.map((m) => [m.StemCID, m.Instrument]))
    const addStem = (stemCID: string): void => {
      db.prepare(
        `INSERT OR IGNORE INTO Stems (StemCID, OwnerJamCID, Instrument) VALUES (?, 'jam1', ?)`
      ).run(stemCID, maskByStem.get(stemCID) ?? null)
    }
    for (const row of embeddings) {
      addStem(row.StemCID)
      setStemEmbeddingCache(db, `/x/${row.StemCID}`, JSON.parse(row.EmbeddingJSON), 1000)
    }
    for (const row of features) {
      addStem(row.StemCID)
      setStemFeatureCache(db, `/x/${row.StemCID}`, JSON.parse(row.FeaturesJSON), 1000)
    }
    await runToCompletion(db)

    expect(classifications(db)).toEqual(classifications(reference))
    // New rows joined the existing list -- no rebuild for them.
    expect(builds()).toBe(2)
  })

  it('goes back to the eligibility query only once the list is exhausted and nothing new was noted', async () => {
    const db = freshDb()
    seedEmbedding(db, 'unreadable-1', UNPLACEABLE)
    const builds = pendingBuildCount(db)

    expect(await classify(db)).toEqual({ processed: 0, remaining: 0 })
    expect(builds()).toBe(2)
    // The scheduler's safety wake: rebuilt (one query per table), but the
    // unclassifiable stem was already tried under this training -- not
    // re-attempted (see the next test).
    expect(await classify(db)).toEqual({ processed: 0, remaining: 0 })
    expect(builds()).toBe(4)
  })

  // Background scan audit item 2 (2026-10-05): every 10-minute safety
  // rebuild used to bring back the ~20k embedded stems neither classifier
  // can place, and re-ran all of them (EmbeddingJSON parse, cosine kNN, a
  // USB mask lookup) to reach the answer of 10 minutes before.
  function embeddingFetches(db: Database.Database): () => string[][] {
    const spy = vi.spyOn(db, 'prepare')
    return () =>
      spy.mock.calls
        .map(([sql]) => String(sql))
        .filter((sql) => sql.includes('e.EmbeddingJSON AS EmbeddingJSON'))
        .map((sql) => [sql])
  }

  it('does not re-attempt a stem already tried under the same training on the safety rebuild', async () => {
    const db = freshDb()
    seedEmbedding(db, 'unreadable-1', UNPLACEABLE)
    seedFeatures(db, 'feat-only-1', { transientDensity: 0.5, bassEnergyRatio: 0.5 })
    await classify(db)
    expect(triedStemCIDs(db)).toEqual(['feat-only-1', 'unreadable-1'])
    const fetches = embeddingFetches(db)
    const featureFetch = vi.spyOn(db, 'prepare')

    expect(await classify(db)).toEqual({ processed: 0, remaining: 0 })
    expect(await classify(db)).toEqual({ processed: 0, remaining: 0 })
    expect(fetches()).toEqual([])
    expect(
      featureFetch.mock.calls.filter(([sql]) =>
        String(sql).includes('SELECT f.StemCID AS StemCID FROM StemFeatureCache f')
      )
    ).toEqual([])
  })

  it('a batch that throws part-way leaves its stems untried, so the next rebuild retries them', async () => {
    const db = freshDb()
    seedEmbedding(db, 'drums-1', [0.9, 0.1, 0])
    vi.spyOn(db, 'transaction').mockImplementationOnce(() => {
      throw new Error('SQLITE_BUSY')
    })
    await expect(classify(db)).rejects.toThrow('SQLITE_BUSY')

    // The scheduler's next tick: the list is spent and nothing was noted, so
    // it rebuilds -- and the stem the failed batch took is back in it.
    expect(await classify(db)).toEqual({ processed: 1, remaining: 0 })
    expect(allClassifiedStemCIDs(db)).toEqual(new Set(['drums-1']))
  })

  it('still picks up a row written outside the stores at the safety rebuild (a new id)', async () => {
    const db = freshDb()
    seedEmbedding(db, 'unreadable-1', UNPLACEABLE)
    await classify(db)

    seedEmbedding(db, 'late-drums', [0.9, 0.1, 0]) // no store, so no wake note
    expect(await classify(db)).toEqual({ processed: 1, remaining: 0 })
    expect(allClassifiedStemCIDs(db)).toEqual(new Set(['late-drums']))
  })

  it('re-attempts tried stems once the model changes (new weights, a new version)', async () => {
    const db = freshDb()
    seedEmbedding(db, 'leans-lead', [0, 0, 1])
    const untrained = { model: UNTRAINED_MODEL }
    expect((await classify(db, [db], untrained)).processed).toBe(0)
    expect((await classify(db, [db], untrained)).processed).toBe(0)

    expect((await classify(db)).processed).toBe(1)
    expect(getAutoCategorizedStemCIDs(db, 'lead')).toEqual(new Set(['leans-lead']))
  })

  it('re-attempts a tried stem whose embedding a store rewrote', async () => {
    const db = freshDb()
    seedEmbedding(db, 'unreadable-1', UNPLACEABLE)
    seedInstrument(db, 'unreadable-1', AUDIO_IN_BIT) // a Stems row, so the store resolves it
    await classify(db)
    await classify(db)

    setStemEmbeddingCache(db, '/x/unreadable-1', [0.9, 0.1, 0], 2000)
    expect(await classify(db)).toEqual({ processed: 1, remaining: 0 })
    expect(getAutoCategorizedStemCIDs(db, 'drums')).toEqual(new Set(['unreadable-1']))
  })

  it('re-attempts a tried stem once the writer fills in its mask (NULL -> drums)', async () => {
    const db = freshDb()
    seedEmbedding(db, 'late-mask', UNPLACEABLE)
    db.prepare(
      `INSERT INTO Stems (StemCID, OwnerJamCID, Instrument) VALUES ('late-mask', 'jam1', NULL)`
    ).run()
    expect((await classify(db, [db])).processed).toBe(0)
    expect((await classify(db, [db])).processed).toBe(0)

    // In place, as riffLibraryWriter.ts fills a stem in: same count and
    // MAX(rowid), its per-table write counter moves.
    db.prepare(`UPDATE Stems SET Instrument = ? WHERE StemCID = 'late-mask'`).run(DRUMS_BIT)
    bumpTableWriteVersion(db, 'Stems')
    expect((await classify(db, [db])).processed).toBe(1)
    expect(getAutoCategorizedStemCIDs(db, 'drums')).toEqual(new Set(['late-mask']))
  })

  it('re-attempts a tried stem once another connection fills in its mask in the read-only archive', async () => {
    const own = freshDb()
    seedEmbedding(own, 'arch-late', UNPLACEABLE)
    const path = join(dir, 'archive.db')
    const writer = new Database(path)
    writer.exec(
      `CREATE TABLE Stems (StemCID TEXT PRIMARY KEY, OwnerJamCID TEXT, Instrument INTEGER)`
    )
    writer.prepare(`INSERT INTO Stems VALUES ('arch-late', 'jam1', NULL)`).run()
    const archive = new Database(path, { readonly: true })
    expect((await classify(own, [archive, own])).processed).toBe(0)
    expect((await classify(own, [archive, own])).processed).toBe(0)

    writer.prepare(`UPDATE Stems SET Instrument = ? WHERE StemCID = 'arch-late'`).run(BASS_BIT)
    expect((await classify(own, [archive, own])).processed).toBe(1)
    expect(getAutoCategorizedStemCIDs(own, 'bass')).toEqual(new Set(['arch-late']))
  })

  it('re-attempts tried stems when the mask dbs change (an archive connected)', async () => {
    const own = freshDb()
    seedEmbedding(own, 'archive-drums', UNPLACEABLE)
    expect((await classify(own, [own])).processed).toBe(0)

    const archive = new Database(join(dir, 'archive.db'))
    archive.exec(
      `CREATE TABLE Stems (StemCID TEXT PRIMARY KEY, OwnerJamCID TEXT, Instrument INTEGER)`
    )
    seedInstrument(archive, 'archive-drums', DRUMS_BIT)
    expect((await classify(own, [archive, own])).processed).toBe(1)
  })

  // The model doesn't train on device: a confirmation still rebuilds the
  // lists (it changes who is eligible), but nothing tried under the same
  // model is tried again.
  it('a training change noted by the stores rebuilds the lists without re-trying stems tried under the same model', async () => {
    const db = freshDb()
    seedFeatures(db, 'feat-1', { transientDensity: 0.9, bassEnergyRatio: 0.1 })
    seedEmbedding(db, 'unreadable-1', UNPLACEABLE)
    expect((await classify(db)).processed).toBe(0)
    const builds = vi.spyOn(db, 'prepare')
    const featureFetches = (): number =>
      builds.mock.calls.filter(([sql]) =>
        String(sql).includes('SELECT f.StemCID AS StemCID FROM StemFeatureCache f')
      ).length

    noteAutoClassifyTrainingChanged()
    expect(await classify(db)).toEqual({ processed: 0, remaining: 0 })
    expect(
      builds.mock.calls.filter(([sql]) => String(sql).includes('ORDER BY t.StemCID')).length
    ).toBe(2)
    expect(featureFetches()).toBe(0)
  })

  // 2026-10-07: the tried record lived only in memory, so every launch
  // re-tried the ~20,452-stem residue (~10 min, ~4 min of main CPU, 0
  // placed), and any write to the own db's Stems table (a Shared Feed sync)
  // re-tried it mid-session. Now persisted (StemAutoClassifyTried).
  describe('tried stems persist across launches', () => {
    function tried(db: Database.Database): string[] {
      return (
        db.prepare(`SELECT StemCID FROM StemAutoClassifyTried ORDER BY StemCID`).all() as {
          StemCID: string
        }[]
      ).map((r) => r.StemCID)
    }

    function featureFetches(db: Database.Database): () => number {
      const spy = vi.spyOn(db, 'prepare')
      return () =>
        spy.mock.calls.filter(([sql]) =>
          String(sql).includes('SELECT f.StemCID AS StemCID FROM StemFeatureCache f')
        ).length
    }

    it('a relaunch does not re-try a stem tried under the same training', async () => {
      const path = join(dir, 'own.db')
      const first = freshDb(path)
      seedEmbedding(first, 'unreadable-1', UNPLACEABLE)
      seedInstrument(first, 'unreadable-1', AUDIO_IN_BIT)
      seedFeatures(first, 'feat-only-1', { transientDensity: 0.5, bassEnergyRatio: 0.5 })
      expect(await classify(first)).toEqual({ processed: 0, remaining: 0 })
      expect(tried(first)).toEqual(['feat-only-1', 'unreadable-1'])
      first.close()

      // A new process: a new connection, nothing in memory.
      const db = freshDb(path)
      const fetches = embeddingFetches(db)
      const features = featureFetches(db)
      expect(await classify(db)).toEqual({ processed: 0, remaining: 0 })
      expect(fetches()).toEqual([])
      expect(features()).toBe(0)
    })

    it('a write to the Stems table (a Shared Feed sync) does not re-try tried stems', async () => {
      const db = freshDb()
      seedEmbedding(db, 'unreadable-1', UNPLACEABLE)
      seedInstrument(db, 'unreadable-1', AUDIO_IN_BIT)
      await classify(db, [db])

      seedInstrument(db, 'synced-from-feed', NOTES_BIT)
      bumpTableWriteVersion(db, 'Stems')
      const fetches = embeddingFetches(db)
      expect(await classify(db, [db])).toEqual({ processed: 0, remaining: 0 })
      expect(fetches()).toEqual([])
    })

    it('a relaunch re-tries them only once the model changed', async () => {
      const path = join(dir, 'own.db')
      const first = freshDb(path)
      seedEmbedding(first, 'leans-lead', [0, 0, 1])
      expect((await classify(first, [first], { model: UNTRAINED_MODEL })).processed).toBe(0)
      expect(tried(first)).toEqual(['leans-lead'])
      first.close()

      const same = freshDb(path)
      expect((await classify(same, [same], { model: UNTRAINED_MODEL })).processed).toBe(0)
      same.close()

      const db = freshDb(path)
      expect((await classify(db)).processed).toBe(1) // new weights shipped
      expect(getAutoCategorizedStemCIDs(db, 'lead')).toEqual(new Set(['leans-lead']))
      expect(tried(db)).toEqual([])
    })

    it('re-tries a tried stem whose own mask changed, after a relaunch too', async () => {
      const path = join(dir, 'own.db')
      const first = freshDb(path)
      seedEmbedding(first, 'late-mask', UNPLACEABLE)
      first
        .prepare(
          `INSERT INTO Stems (StemCID, OwnerJamCID, Instrument) VALUES ('late-mask', 'j', NULL)`
        )
        .run()
      expect((await classify(first, [first])).processed).toBe(0)
      first.prepare(`UPDATE Stems SET Instrument = ? WHERE StemCID = 'late-mask'`).run(DRUMS_BIT)
      first.close()

      const db = freshDb(path)
      expect((await classify(db, [db])).processed).toBe(1)
      expect(getAutoCategorizedStemCIDs(db, 'drums')).toEqual(new Set(['late-mask']))
    })

    it('writes the record in the batch transaction: a batch that throws records nothing', async () => {
      const db = freshDb()
      seedEmbedding(db, 'unreadable-1', UNPLACEABLE)
      const realTransaction = db.transaction.bind(db)
      vi.spyOn(db, 'transaction').mockImplementationOnce((fn) =>
        realTransaction(() => {
          ;(fn as () => number)()
          throw new Error('SQLITE_FULL')
        })
      )
      await expect(classify(db)).rejects.toThrow('SQLITE_FULL')
      expect(tried(db)).toEqual([])
    })

    it('a store rewriting the row forgets it, so a relaunch re-tries it', async () => {
      const path = join(dir, 'own.db')
      const first = freshDb(path)
      seedEmbedding(first, 'unreadable-1', UNPLACEABLE)
      seedInstrument(first, 'unreadable-1', AUDIO_IN_BIT) // so the store resolves the path
      await classify(first)
      // Re-extracted, and the app quits before the classifier's next batch.
      setStemEmbeddingCache(first, '/x/unreadable-1', [0.9, 0.1, 0], 2000)
      expect(tried(first)).toEqual([])
      first.close()

      const db = freshDb(path)
      expect((await classify(db)).processed).toBe(1)
    })

    // Review of 0adc41ca, important 1: the dev and packaged apps share the
    // own db but can ship different weights, so their fingerprints differ;
    // keyed on StemCID alone, each app's record overwrote the other's and
    // every switch re-tried the whole residue.
    it('two model versions against one db keep their own records: no re-try after switching back', async () => {
      const path = join(dir, 'own.db')
      const modelA = { model: TEST_MODEL }
      const modelB = { model: { ...TEST_MODEL, version: 2 } }
      const seed = freshDb(path)
      seedFeatures(seed, 'feat-only-1', { transientDensity: 0.5, bassEnergyRatio: 0.5 })
      seed.close()

      const dev = freshDb(path)
      expect(await classify(dev, [dev], modelA)).toEqual({ processed: 0, remaining: 0 })
      expect(tried(dev)).toEqual(['feat-only-1'])
      dev.close()

      // the packaged app: its own weights, tried afresh
      const packaged = freshDb(path)
      const packagedFetches = featureFetches(packaged)
      expect(await classify(packaged, [packaged], modelB)).toEqual({ processed: 0, remaining: 0 })
      expect(packagedFetches()).toBe(1)
      packaged.close()

      const devAgain = freshDb(path)
      const devFetches = featureFetches(devAgain)
      expect(await classify(devAgain, [devAgain], modelA)).toEqual({ processed: 0, remaining: 0 })
      expect(devFetches()).toBe(0)
    })

    // Review of 0adc41ca, important 2: a classifier change (a threshold, the
    // mask rule, the feature layout) can place a stem the old one couldn't,
    // so it must move the fingerprint like a retrain does.
    it('a relaunch re-tries stems tried by an older classifier version', async () => {
      const path = join(dir, 'own.db')
      const first = freshDb(path)
      seedEmbedding(first, 'unreadable-1', UNPLACEABLE)
      await classify(first)
      const [{ f }] = first
        .prepare(`SELECT TrainingFingerprint AS f FROM StemAutoClassifyTried`)
        .all() as { f: string }[]
      expect(f.startsWith(`c${CLASSIFIER_VERSION}|`)).toBe(true)
      // as an older classifier would have written it
      first
        .prepare(`UPDATE StemAutoClassifyTried SET TrainingFingerprint = ?`)
        .run(f.replace(`c${CLASSIFIER_VERSION}|`, `c${CLASSIFIER_VERSION - 1}|`))
      first.close()

      const db = freshDb(path)
      const fetches = embeddingFetches(db)
      await classify(db)
      expect(fetches()).toHaveLength(1)
    })

    it('placing a stem drops its records under every fingerprint', async () => {
      const db = freshDb()
      seedEmbedding(db, 'late-mask', UNPLACEABLE)
      db.prepare(
        `INSERT INTO Stems (StemCID, OwnerJamCID, Instrument) VALUES ('late-mask', 'j', NULL)`
      ).run()
      // tried by the other app, under its own training
      db.prepare(
        `INSERT INTO StemAutoClassifyTried (StemCID, TrainingFingerprint, Mask, TriedAt)
         VALUES ('late-mask', 'the-other-app', NULL, 1)`
      ).run()
      db.prepare(`UPDATE Stems SET Instrument = ? WHERE StemCID = 'late-mask'`).run(DRUMS_BIT)
      expect((await classify(db, [db])).processed).toBe(1)
      expect(tried(db)).toEqual([])
    })

    // Review of 0adc41ca: a stem placed by another source (a confirmation,
    // the other app's model) or whose cache rows are gone kept its rows forever.
    describe('pruning records nobody will read', () => {
      function seedTried(db: Database.Database, stemCIDs: string[]): void {
        const insert = db.prepare(
          `INSERT INTO StemAutoClassifyTried (StemCID, TrainingFingerprint, Mask, TriedAt)
           VALUES (?, 'f', NULL, 1)`
        )
        for (const id of stemCIDs) insert.run(id)
      }

      it('a rebuild drops the rows of stems placed elsewhere, confirmed, or with no input left', async () => {
        const db = freshDb()
        seedEmbedding(db, 'placed-elsewhere', UNPLACEABLE)
        db.prepare(
          `INSERT INTO StemAutoCategory (StemCID, ArrangeRole, Source, ComputedAt)
           VALUES ('placed-elsewhere', 'drums', 'model', 1)`
        ).run()
        seedEmbedding(db, 'confirmed', UNPLACEABLE)
        seedConfirmed(db, 'confirmed', 'bass')
        // no embedding or feature row any more
        seedEmbedding(db, 'still-waiting', UNPLACEABLE)
        seedTried(db, ['placed-elsewhere', 'confirmed', 'gone', 'still-waiting'])
        await classify(db)
        // (still-waiting is recorded again under this training, beside 'f')
        expect(new Set(tried(db))).toEqual(new Set(['still-waiting']))
      })

      // An older app's guess doesn't count as placed (the model guesses it
      // again), so its record must stay, or every rebuild would re-try it.
      it.each([
        ['embedding', 'drums'],
        ['instrumentMask', 'lead']
      ])(
        "keeps the record of a stem whose only row is an older app's guess (%s, %s)",
        async (source, role) => {
          const db = freshDb()
          seedEmbedding(db, 'old-guess', UNPLACEABLE)
          db.prepare(
            `INSERT INTO StemAutoCategory (StemCID, ArrangeRole, Source, ComputedAt)
             VALUES ('old-guess', ?, ?, 1)`
          ).run(role, source)
          await classify(db)
          expect(tried(db)).toEqual(['old-guess'])
          const fetches = embeddingFetches(db)
          expect(await classify(db)).toEqual({ processed: 0, remaining: 0 }) // the safety rebuild
          expect(tried(db)).toEqual(['old-guess'])
          expect(fetches()).toEqual([])
        }
      )

      it('looks at a bounded slice of rows per call, carrying on where it left off', () => {
        const db = freshDb()
        seedTried(db, ['gone-1', 'gone-2', 'gone-3', 'gone-4', 'gone-5'])
        let cursor = pruneStemsTriedSlice(db, 0, 2)
        expect(tried(db)).toEqual(['gone-3', 'gone-4', 'gone-5'])
        cursor = pruneStemsTriedSlice(db, cursor, 2)
        expect(tried(db)).toEqual(['gone-5'])
        cursor = pruneStemsTriedSlice(db, cursor, 2)
        expect(tried(db)).toEqual([])
        expect(cursor).toBe(0) // the end: the next slice starts over
      })
    })

    it('keeps at most a few fingerprints per stem, dropping the oldest', async () => {
      const db = freshDb()
      seedEmbedding(db, 'unreadable-1', UNPLACEABLE)
      const insert = db.prepare(
        `INSERT INTO StemAutoClassifyTried (StemCID, TrainingFingerprint, Mask, TriedAt)
         VALUES ('unreadable-1', ?, NULL, ?)`
      )
      for (let i = 0; i < 10; i++) insert.run(`old-${i}`, 100 + i)
      await classify(db)
      const fingerprints = (
        db
          .prepare(
            `SELECT TrainingFingerprint AS f FROM StemAutoClassifyTried ORDER BY TriedAt DESC`
          )
          .all() as { f: string }[]
      ).map((r) => r.f)
      expect(fingerprints).toHaveLength(MAX_TRIED_FINGERPRINTS_PER_STEM)
      // the one just recorded is kept, then the newest of the old ones
      expect(fingerprints[0]).not.toMatch(/^old-/)
      expect(fingerprints.slice(1)).toEqual(
        Array.from({ length: MAX_TRIED_FINGERPRINTS_PER_STEM - 1 }, (_, i) => `old-${9 - i}`)
      )
    })

    // Review of 0adc41ca: a stem nobody recorded was fetched again at every
    // rebuild and launch. The embedding pass records an unplaced stem itself,
    // feature row or not: the feature pass never sees a stem with an embedding.
    it('the embedding pass records an unplaced stem itself, with or without a feature row', async () => {
      const path = join(dir, 'own.db')
      const first = freshDb(path)
      seedEmbedding(first, 'embedding-only', UNPLACEABLE)
      seedEmbedding(first, 'both', UNPLACEABLE)
      seedFeatures(first, 'both', { transientDensity: 0.9, bassEnergyRatio: 0.1 })
      expect(await classify(first)).toEqual({ processed: 0, remaining: 0 })
      expect(tried(first)).toEqual(['both', 'embedding-only'])
      first.close()

      const db = freshDb(path)
      const fetches = embeddingFetches(db)
      const features = featureFetches(db)
      expect(await classify(db)).toEqual({ processed: 0, remaining: 0 })
      expect(fetches()).toEqual([])
      expect(features()).toBe(0)
    })
  })

  it('drops a listed id that was confirmed after the list was built', async () => {
    const db = freshDb()
    for (let i = 0; i < 201; i++) seedEmbedding(db, `g-${i}`, [0.9, 0.1, 0])
    const first = await classify(db)
    expect(first).toEqual({ processed: 200, remaining: 1 })
    const [leftover] = (
      db
        .prepare(
          `SELECT StemCID FROM StemEmbeddingCache e WHERE e.StemCID LIKE 'g-%'
           AND NOT EXISTS (SELECT 1 FROM StemAutoCategory a WHERE a.StemCID = e.StemCID)`
        )
        .all() as { StemCID: string }[]
    ).map((r) => r.StemCID)
    // Confirmed directly (no store) -- the fetch-time eligibility check
    // still skips it. Confirmed WITHOUT an embedding change, so the
    // fingerprint moves and the list rebuilds; either way it's skipped.
    seedConfirmed(db, leftover, 'bass')
    const second = await classify(db)
    expect(second.processed).toBe(0)
    expect(allClassifiedStemCIDs(db).has(leftover)).toBe(false)
  })
})

describe('classifyAutoCategoryBatch (own stems first, 2026-10-06)', () => {
  function classified(db: Database.Database): string[] {
    return [...allClassifiedStemCIDs(db)].filter((cid) => !cid.startsWith('train-'))
  }

  function seedGroup(db: Database.Database, prefix: string, n: number): string[] {
    const ids = Array.from({ length: n }, (_, i) => `${prefix}-${i}`)
    for (const id of ids) seedEmbedding(db, id, [0.9, 0.1, 0])
    return ids
  }

  it('takes own stems first, then favourites, then the rest', async () => {
    const db = freshDb()
    seedGroup(db, 'rest', 300)
    const own = seedGroup(db, 'own', 150)
    const favs = seedGroup(db, 'fav', 100)
    const priority = { own: new Set(own), favourites: new Set(favs) }

    await classify(db, [db], { priority })
    const first = classified(db)
    expect(first.filter((c) => c.startsWith('own-'))).toHaveLength(150)
    expect(first.filter((c) => c.startsWith('fav-'))).toHaveLength(50)
    expect(first.filter((c) => c.startsWith('rest-'))).toHaveLength(0)

    await classify(db, [db], { priority })
    const second = classified(db)
    expect(second.filter((c) => c.startsWith('fav-'))).toHaveLength(100)
    expect(second.filter((c) => c.startsWith('rest-'))).toHaveLength(150)
  })

  it('applies to the feature pass too', async () => {
    const db = freshDb()
    // feature-only, drums-masked stems: the feature pass places them by the mask
    const ids = (prefix: string, n: number): string[] =>
      Array.from({ length: n }, (_, i) => `${prefix}-${i}`)
    for (const id of [...ids('rest', 250), ...ids('own', 120)]) {
      seedFeatures(db, id, { transientDensity: 0.9, bassEnergyRatio: 0.1 })
      seedInstrument(db, id, DRUMS_BIT)
    }
    const priority = { own: new Set(ids('own', 120)), favourites: new Set<string>() }
    await classify(db, [db], { priority })
    const first = classified(db)
    expect(first.filter((c) => c.startsWith('own-'))).toHaveLength(120)
    expect(first.filter((c) => c.startsWith('rest-'))).toHaveLength(80)
  })

  it('a stem noted mid-pass joins its own group', async () => {
    const db = freshDb()
    seedGroup(db, 'rest', 500)
    const own = seedGroup(db, 'own', 150)
    const priority = { own: new Set([...own, 'own-late']), favourites: new Set<string>() }
    await classify(db, [db], { priority })
    // the store resolves a path to a StemCID through a Stems row
    seedInstrument(db, 'own-late', AUDIO_IN_BIT)
    seedInstrument(db, 'rest-late', AUDIO_IN_BIT)
    setStemEmbeddingCache(db, '/x/own-late', [0.9, 0.1, 0], 1000)
    // and a rest stem noted at the same time stays behind the own one
    setStemEmbeddingCache(db, '/x/rest-late', [0.9, 0.1, 0], 1000)
    // Each noted stem lands at a random place in its group's segment: pinned
    // to the segment's far end (taken last), so neither can be taken by luck
    // -- the own one is taken only because its segment comes first, and the
    // rest one, behind 450 others in a batch of 199 more, is not.
    const random = vi.spyOn(Math, 'random').mockReturnValue(0)
    try {
      await classify(db, [db], { priority })
    } finally {
      random.mockRestore()
    }
    expect(allClassifiedStemCIDs(db).has('own-late')).toBe(true)
    expect(allClassifiedStemCIDs(db).has('rest-late')).toBe(false)
  })

  // Review of 147dca78: the lists were keyed by username and set SIZES, so
  // a star swapped for another (or an own stem for another) kept the old
  // layout.
  it('a favourite swapped for another at the same size lays the lists out again', async () => {
    const db = freshDb()
    seedGroup(db, 'rest', 400)
    const favA = seedGroup(db, 'favA', 100)
    const favB = seedGroup(db, 'favB', 100)
    const none = new Set<string>()
    await classify(db, [db], {
      priority: { own: none, favourites: new Set(favA) }
    })
    expect(classified(db).filter((c) => c.startsWith('favA-'))).toHaveLength(100)
    await classify(db, [db], {
      priority: { own: none, favourites: new Set(favB) }
    })
    // every favB left was taken before any more of the rest
    expect(classified(db).filter((c) => c.startsWith('favB-'))).toHaveLength(100)
  })

  it('a priority arriving after the list was built reorders it, without a rebuild', async () => {
    const db = freshDb()
    seedGroup(db, 'rest', 600)
    const own = seedGroup(db, 'own', 100)
    const spy = vi.spyOn(db, 'prepare')
    const builds = (): number =>
      spy.mock.calls.filter(([sql]) => String(sql).includes('ORDER BY t.StemCID')).length

    await classify(db) // no priority yet (no username reported)
    const before = classified(db).filter((c) => c.startsWith('own-')).length
    const buildsBefore = builds()
    await classify(db, [db], {
      priority: { own: new Set(own), favourites: new Set<string>() }
    })
    expect(classified(db).filter((c) => c.startsWith('own-'))).toHaveLength(100)
    expect(before).toBeLessThan(100)
    expect(builds()).toBe(buildsBefore)
  })
})

// 2026-11-14 (four categories): one shipped model decides a row.
describe('classifyAutoCategoryBatch (the one model)', () => {
  it('places a drums-masked stem by the mask, with no dial', async () => {
    const db = freshDb()
    seedEmbedding(db, 'm', [0, 1, 0]) // the model would say bass
    seedInstrument(db, 'm', DRUMS_BIT)
    expect((await classify(db)).processed).toBe(1)
    expect(autoRow(db, 'm')).toEqual({
      ArrangeRole: 'drums',
      Source: 'instrumentMask',
      FrontScore: null
    })
  })

  it('places a notes-masked stem by the model, with its dial', async () => {
    const db = freshDb()
    seedEmbedding(db, 'n', [0, 0, 0])
    seedInstrument(db, 'n', NOTES_BIT)
    await classify(db, [db], { model: fixedProbsModel([0.1, 0.1, 0.6, 0.2]) })
    const row = autoRow(db, 'n')!
    expect(row.ArrangeRole).toBe('backing')
    expect(row.Source).toBe('model')
    expect(row.FrontScore).toBeCloseTo(0.25, 9)
  })

  it('a confident drums guess has no dial', async () => {
    const db = freshDb()
    seedEmbedding(db, 'd', [0, 0, 0])
    await classify(db, [db], { model: fixedProbsModel([0.85, 0.05, 0.05, 0.05]) })
    expect(autoRow(db, 'd')).toEqual({ ArrangeRole: 'drums', Source: 'model', FrontScore: null })
  })

  it('with an untrained model, a stem with an embedding and no reliable mask is tried, not placed', async () => {
    const db = freshDb()
    seedEmbedding(db, 'u', [0.9, 0.1, 0])
    seedInstrument(db, 'u', NOTES_BIT)
    expect(await classify(db, [db], { model: UNTRAINED_MODEL })).toEqual({
      processed: 0,
      remaining: 0
    })
    expect(autoRow(db, 'u')).toBeUndefined()
    expect(triedStemCIDs(db)).toEqual(['u'])
  })

  it("an older app's guess (Source = 'embedding') is guessed again by the model", async () => {
    const db = freshDb()
    seedEmbedding(db, 'old', [0, 0, 1])
    db.prepare(
      `INSERT INTO StemAutoCategory (StemCID, ArrangeRole, Source, ComputedAt)
       VALUES ('old', 'drums', 'embedding', 1)`
    ).run()
    expect((await classify(db)).processed).toBe(1)
    const row = autoRow(db, 'old')!
    expect(row.ArrangeRole).toBe('lead')
    expect(row.Source).toBe('model')
    expect(row.FrontScore).toBeGreaterThan(0.5)
  })

  it("the packaged 1.6.1 app's notes-bit row ('lead', 'instrumentMask') is guessed again by the model", async () => {
    const db = freshDb()
    seedEmbedding(db, 'notes', [0, 0, 0])
    seedInstrument(db, 'notes', NOTES_BIT)
    db.prepare(
      `INSERT INTO StemAutoCategory (StemCID, ArrangeRole, Source, ComputedAt)
       VALUES ('notes', 'lead', 'instrumentMask', 1)`
    ).run()
    expect((await classify(db)).processed).toBe(1)
    expect(autoRow(db, 'notes')).toMatchObject({ ArrangeRole: 'backing', Source: 'model' })
  })

  it('a stem with features but no embedding and no reliable mask is tried, not placed', async () => {
    const db = freshDb()
    seedFeatures(db, 'f', { transientDensity: 0.9, bassEnergyRatio: 0.1 })
    seedInstrument(db, 'f', NOTES_BIT)
    expect(await classify(db)).toEqual({ processed: 0, remaining: 0 })
    expect(autoRow(db, 'f')).toBeUndefined()
    expect(triedStemCIDs(db)).toEqual(['f'])
  })
})
