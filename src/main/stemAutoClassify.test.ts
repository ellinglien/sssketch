// src/main/stemAutoClassify.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { classifyAutoCategoryBatch } from './stemAutoClassify'
import { getAutoCategorizedStemCIDs } from './stemAutoCategoryStore'
import * as categoryCentroidStore from './categoryCentroidStore'
import { emptyCategoryCentroidStore, recordConfirmedCategory } from '@shared/categoryCentroids'
import type { StemFeatures } from '@shared/stemFeatures'
import { setStemEmbeddingCache } from './stemEmbeddingCacheStore'
import { setStemFeatureCache } from './stemFeatureCacheStore'
import { noteAutoClassifyTrainingChanged } from './stemAutoClassifyWake'
import { bumpTableWriteVersion } from './tableWriteVersion'

// The centroid/feature pass reads app.getPath('userData') via
// loadCategoryCentroidStore -- mock just that narrow surface, same
// established convention as discoverCandidates.test.ts used before this
// classification logic moved here. Pointed at a path that won't exist, so
// loadCategoryCentroidStore falls back to its own documented "empty store"
// behavior unless a test explicitly spies in a trained one.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/stemAutoClassify-test-userdata' }
}))

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'auto-classify-'))
})
afterEach(() => {
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

function freshDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE StemCategories (
      StemCID TEXT PRIMARY KEY, ArrangeRole TEXT, DrumSubRole TEXT, BusId TEXT,
      Source TEXT NOT NULL, SourceProject TEXT, UpdatedAt INTEGER NOT NULL,
      SubcategoryNote TEXT
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
    CREATE TABLE Stems (
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
    expect(allClassifiedStemCIDs(db)).toEqual(new Set())
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

  it('leaves an untrained-axis, mask-unresolvable stem unclassified (not "remaining") when nothing is trained on the embedding axis yet', async () => {
    const db = freshDb()
    // No confirmed StemCategories rows at all -- getConfirmedEmbeddings
    // returns [], so suggestCategoryFromEmbedding could never confidently
    // classify anything yet. No Stems/Instrument row either, so the mask
    // short-circuit can't resolve it either.
    seedEmbedding(db, 'untrained-1', [1, 0, 0])

    const result = await classifyAutoCategoryBatch(db)
    expect(result.processed).toBe(0)
    // 0, not 1 -- real behavior change, 2026-09-18: this row IS still
    // fetched this call (the mask short-circuit needs to see its StemCID
    // regardless of embedding-axis training), just left unresolved. See
    // the embedding pass's own doc comment on why `remaining` now only
    // ever reflects rows past BATCH_SIZE, not "fetched but unresolved"
    // ones -- same accepted cost as an ambiguous embedding guess.
    expect(result.remaining).toBe(0)
    expect(allClassifiedStemCIDs(db)).toEqual(new Set())
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

  // Real live bug (root cause of a confirmed, reproducible-across-restarts
  // stall): a stem with an embedding used to be excluded from the
  // centroid pass UNCONDITIONALLY, even when the embedding axis was
  // completely untrained (no confirmed+embedded samples at all) -- since
  // extraction embeds nearly every stem, this meant almost the entire
  // backlog got permanently reserved for a classifier that would never
  // fire, with no fallback and no error. This test is the untrained-axis
  // mirror of "falls back to the centroid/feature classifier when no
  // embedding exists" above: same scenario, but the stem DOES have an
  // embedding too -- it must still fall through to centroid, since the
  // embedding classifier can never help it while untrained.
  it('falls back to the centroid classifier for a stem that HAS an embedding, when the embedding axis is untrained', async () => {
    const db = freshDb()
    let store = emptyCategoryCentroidStore()
    const zeros = new Array(13).fill(0)
    for (let i = 0; i < 3; i++) {
      store = recordConfirmedCategory(store, 'arrangeRole', 'drums', [1, 0, 0, 0, 0, 0, ...zeros])
      store = recordConfirmedCategory(store, 'arrangeRole', 'bass', [0, 1, 0, 0, 0, 0, ...zeros])
    }
    vi.spyOn(categoryCentroidStore, 'loadCategoryCentroidStore').mockReturnValue(store)

    // No seedTrainedEmbeddings here -- the embedding axis is completely
    // untrained (zero confirmed+embedded samples).
    seedEmbedding(db, 'both-1', [1, 0, 0])
    seedFeatures(db, 'both-1', { transientDensity: 0.9, bassEnergyRatio: 0.1 })

    const result = await classifyAutoCategoryBatch(db)
    expect(result.processed).toBe(1)
    expect(getAutoCategorizedStemCIDs(db, 'drums')).toEqual(new Set(['both-1']))
    const row = db
      .prepare(`SELECT Source FROM StemAutoCategory WHERE StemCID = ?`)
      .get('both-1') as {
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
    expect(allClassifiedStemCIDs(db)).toEqual(new Set())
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
    expect(allClassifiedStemCIDs(db).size).toBe(200)
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
    expect(allClassifiedStemCIDs(db).size).toBe(200)
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

  // Real perf bug, found live (root cause of a sustained, WORSENING
  // beachball once there was a real multi-thousand-stem backlog to work
  // through): each classified stem used to be written via its own
  // separate upsertStemAutoCategory call, with no explicit transaction --
  // better-sqlite3/SQLite auto-commits (and fsyncs) EVERY SINGLE INSERT
  // individually that way. Fixed by wrapping each pass's own batch of
  // writes in one ownDb.transaction(...) call. This test seeds enough
  // stems for BOTH passes to have real work and asserts exactly one
  // transaction() call happens per pass (two total), not one per row.
  it('writes each pass batch inside a single transaction, not one commit per row', async () => {
    const db = freshDb()
    seedTrainedEmbeddings(db)
    for (let i = 0; i < 5; i++) {
      seedEmbedding(db, `guessed-embedding-${i}`, [0.9, 0.1, 0])
    }
    let store = emptyCategoryCentroidStore()
    const zeros = new Array(13).fill(0)
    for (let i = 0; i < 3; i++) {
      store = recordConfirmedCategory(store, 'arrangeRole', 'drums', [1, 0, 0, 0, 0, 0, ...zeros])
      store = recordConfirmedCategory(store, 'arrangeRole', 'bass', [0, 1, 0, 0, 0, 0, ...zeros])
    }
    vi.spyOn(categoryCentroidStore, 'loadCategoryCentroidStore').mockReturnValue(store)
    for (let i = 0; i < 5; i++) {
      seedFeatures(db, `guessed-feature-${i}`, { transientDensity: 0.9, bassEnergyRatio: 0.1 })
    }

    const transactionSpy = vi.spyOn(db, 'transaction')

    const result = await classifyAutoCategoryBatch(db)
    expect(result.processed).toBe(10)
    expect(transactionSpy).toHaveBeenCalledTimes(2)
  })

  // Real finding, 2026-09-18: a direct query against Elling's real library
  // showed 5,462 of 20,176 embedding-classified 'drums' stems were mask-
  // tagged 'notes'/'bass'/other, not drums at all -- confirmed live with a
  // screenshot (a 'notes'-masked stem, wrong waveform color, sitting in the
  // drums slot). His own correction: audioIn is genuinely ambiguous
  // ("can indeed be drums") so it must stay excluded, but "otherwise we can
  // rely on the endlesss categories easily" -- and a follow-up request to
  // lean into the cheap, reliable signal over expensive audio-similarity
  // search wherever it cuts real processing cost. These tests cover the
  // mask short-circuit this drives: a stem confidently mask-tagged drums/
  // notes/bass skips the embedding/centroid comparison ENTIRELY and is
  // written directly via the mask -- both for accuracy (no fallible guess
  // to get wrong) and for cost (no comparison against the whole confirmed
  // pool at all).
  describe('instrument-mask short-circuit', () => {
    it('classifies a drums-masked stem directly via the mask, never touching the embedding comparison', async () => {
      const db = freshDb()
      seedTrainedEmbeddings(db)
      // Embeds near the BASS cluster -- if the mask short-circuit didn't
      // fire, the embedding classifier would call this 'bass', not 'drums'.
      seedEmbedding(db, 'masked-drums-1', [0, 1, 0])
      seedInstrument(db, 'masked-drums-1', DRUMS_BIT)

      const result = await classifyAutoCategoryBatch(db, [db])
      expect(result.processed).toBe(1)
      expect(getAutoCategorizedStemCIDs(db, 'drums')).toEqual(new Set(['masked-drums-1']))
      const row = db
        .prepare(`SELECT Source FROM StemAutoCategory WHERE StemCID = ?`)
        .get('masked-drums-1') as { Source: string }
      expect(row.Source).toBe('instrumentMask')
    })

    it('classifies a notes-masked stem as lead via the mask, never the (wrong) embedding guess', async () => {
      const db = freshDb()
      seedTrainedEmbeddings(db)
      // Embeds near the DRUMS cluster -- this is the exact real-world bug:
      // without the short-circuit, this notes-masked stem would land in
      // 'drums'.
      seedEmbedding(db, 'masked-notes-1', [0.9, 0.1, 0])
      seedInstrument(db, 'masked-notes-1', NOTES_BIT)

      const result = await classifyAutoCategoryBatch(db, [db])
      expect(result.processed).toBe(1)
      expect(getAutoCategorizedStemCIDs(db, 'lead')).toEqual(new Set(['masked-notes-1']))
      expect(getAutoCategorizedStemCIDs(db, 'drums')).toEqual(new Set())
    })

    it('classifies a bass-masked stem directly via the mask', async () => {
      const db = freshDb()
      seedTrainedEmbeddings(db)
      seedEmbedding(db, 'masked-bass-1', [0.9, 0.1, 0]) // embeds near drums
      seedInstrument(db, 'masked-bass-1', BASS_BIT)

      await classifyAutoCategoryBatch(db, [db])
      expect(getAutoCategorizedStemCIDs(db, 'bass')).toEqual(new Set(['masked-bass-1']))
    })

    it('does NOT short-circuit an audioIn-masked stem -- audioIn can genuinely be anything', async () => {
      const db = freshDb()
      seedTrainedEmbeddings(db)
      seedEmbedding(db, 'masked-audioin-1', [0.9, 0.1, 0]) // near the drums cluster
      seedInstrument(db, 'masked-audioin-1', AUDIO_IN_BIT)

      const result = await classifyAutoCategoryBatch(db, [db])
      expect(result.processed).toBe(1)
      // Falls through to the real embedding classifier, which calls it
      // 'drums' here -- audioIn genuinely can be drums (direct feedback),
      // so this is the classifier's own honest best guess, not vetoed.
      expect(getAutoCategorizedStemCIDs(db, 'drums')).toEqual(new Set(['masked-audioin-1']))
      const row = db
        .prepare(`SELECT Source FROM StemAutoCategory WHERE StemCID = ?`)
        .get('masked-audioin-1') as { Source: string }
      expect(row.Source).toBe('embedding')
    })

    it('does NOT short-circuit a stem with no Instrument row at all', async () => {
      const db = freshDb()
      seedTrainedEmbeddings(db)
      seedEmbedding(db, 'no-mask-1', [0.9, 0.1, 0])
      // No seedInstrument call -- no Stems row for this StemCID anywhere.

      const result = await classifyAutoCategoryBatch(db, [db])
      expect(result.processed).toBe(1)
      const row = db
        .prepare(`SELECT Source FROM StemAutoCategory WHERE StemCID = ?`)
        .get('no-mask-1') as { Source: string }
      expect(row.Source).toBe('embedding')
    })

    it('resolves a mask-confident stem even when the embedding axis is completely untrained', async () => {
      const db = freshDb()
      // No seedTrainedEmbeddings -- embeddingAxisTrained is false.
      seedEmbedding(db, 'masked-notes-2', [1, 0, 0])
      seedInstrument(db, 'masked-notes-2', NOTES_BIT)

      const result = await classifyAutoCategoryBatch(db, [db])
      expect(result.processed).toBe(1)
      expect(result.remaining).toBe(0)
      expect(getAutoCategorizedStemCIDs(db, 'lead')).toEqual(new Set(['masked-notes-2']))
    })

    it('applies the same short-circuit in the centroid/feature pass', async () => {
      const db = freshDb()
      let store = emptyCategoryCentroidStore()
      const zeros = new Array(13).fill(0)
      for (let i = 0; i < 3; i++) {
        store = recordConfirmedCategory(store, 'arrangeRole', 'drums', [1, 0, 0, 0, 0, 0, ...zeros])
        store = recordConfirmedCategory(store, 'arrangeRole', 'bass', [0, 1, 0, 0, 0, 0, ...zeros])
      }
      vi.spyOn(categoryCentroidStore, 'loadCategoryCentroidStore').mockReturnValue(store)
      // Centroid-classifies as 'drums' (transientDensity/bassEnergyRatio near
      // the drums cluster) -- the mask says notes, so 'lead' must win.
      seedFeatures(db, 'masked-notes-feature-1', { transientDensity: 0.9, bassEnergyRatio: 0.1 })
      seedInstrument(db, 'masked-notes-feature-1', NOTES_BIT)

      const result = await classifyAutoCategoryBatch(db, [db])
      expect(result.processed).toBe(1)
      expect(getAutoCategorizedStemCIDs(db, 'lead')).toEqual(new Set(['masked-notes-feature-1']))
    })

    // A stem's own "Stems" row can live in a DIFFERENT db than the one
    // StemEmbeddingCache/StemAutoCategory live in -- real-world shape:
    // stems from an external, read-only LORE archive still get their
    // embeddings cached in sssketch's own db, but their Instrument mask
    // only exists in the archive's own Stems table. `stemDbs` must be
    // searched in full, not just `ownDb`.
    it('finds the Instrument mask in a SEPARATE db from ownDb', async () => {
      const own = freshDb()
      seedTrainedEmbeddings(own)
      seedEmbedding(own, 'external-notes-1', [0.9, 0.1, 0]) // embeds near drums

      const external = new Database(':memory:')
      external.exec(
        `CREATE TABLE Stems (StemCID TEXT PRIMARY KEY, OwnerJamCID TEXT NOT NULL, Instrument INTEGER)`
      )
      seedInstrument(external, 'external-notes-1', NOTES_BIT)

      const result = await classifyAutoCategoryBatch(own, [own, external])
      expect(result.processed).toBe(1)
      expect(getAutoCategorizedStemCIDs(own, 'lead')).toEqual(new Set(['external-notes-1']))
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
    seedTrainedEmbeddings(own)
    seedEmbedding(own, 'arch-notes', [0.9, 0.1, 0]) // embeds near drums; the mask says notes
    seedEmbedding(own, 'arch-mic', [0.1, 0.9, 0]) // audioIn: the embedding decides (bass)
    seedEmbedding(own, 'own-bass', [0.9, 0.1, 0]) // only ownDb has its row
    seedInstrument(own, 'own-bass', BASS_BIT)
  }
  const ARCHIVE = { 'arch-notes': NOTES_BIT, 'arch-mic': AUDIO_IN_BIT }

  it('classifies exactly as the SQL lookup does, without querying the archive', async () => {
    const reference = freshDb()
    seedMixed(reference)
    await classifyAutoCategoryBatch(reference, [stemsDb(ARCHIVE), reference])

    const own = freshDb()
    seedMixed(own)
    const archive = stemsDb(ARCHIVE)
    const queried = maskQueries(archive)
    await classifyAutoCategoryBatch(own, [archive, own], {
      instrumentLookup: (db) => (db === archive ? memoryOf(ARCHIVE) : null)
    })
    expect(queried()).toBe(0)
    const all = (db: Database.Database): unknown[] =>
      db.prepare(`SELECT StemCID, ArrangeRole, Source FROM StemAutoCategory ORDER BY StemCID`).all()
    expect(all(own)).toEqual(all(reference))
    expect(getAutoCategorizedStemCIDs(own, 'lead')).toEqual(new Set(['arch-notes']))
    expect(getAutoCategorizedStemCIDs(own, 'bass')).toEqual(new Set(['arch-mic', 'own-bass']))
  })

  it('asks SQL for a db whose rows are not in memory (or not current)', async () => {
    const own = freshDb()
    seedMixed(own)
    const archive = stemsDb(ARCHIVE)
    const queried = maskQueries(archive)
    await classifyAutoCategoryBatch(own, [archive, own], { instrumentLookup: () => null })
    expect(queried()).toBe(1)
    expect(getAutoCategorizedStemCIDs(own, 'lead')).toEqual(new Set(['arch-notes']))
  })

  it('moves on to the next db for a stem the rows have with no mask, as SQL did', async () => {
    const own = freshDb()
    seedTrainedEmbeddings(own)
    seedEmbedding(own, 'split', [0.9, 0.1, 0])
    seedInstrument(own, 'split', NOTES_BIT)
    const archive = stemsDb({ split: null })
    await classifyAutoCategoryBatch(own, [archive, own], {
      instrumentLookup: (db) => (db === archive ? memoryOf({ split: null }) : null)
    })
    expect(getAutoCategorizedStemCIDs(own, 'lead')).toEqual(new Set(['split']))
  })
})

describe('classifyAutoCategoryBatch (confirmed-embedding cache)', () => {
  it('picks up confirmations added between calls on the same db -- the prepared set is reused, never stale', async () => {
    const db = freshDb()
    for (let i = 0; i < 3; i++) {
      seedConfirmed(db, `train-drums-${i}`, 'drums')
      seedEmbedding(db, `train-drums-${i}`, [1, 0, 0])
    }
    seedEmbedding(db, 'query', [0, 1, 0])

    // Only one trained category -- no suggestion possible yet.
    await classifyAutoCategoryBatch(db)
    expect(allClassifiedStemCIDs(db).has('query')).toBe(false)

    for (let i = 0; i < 3; i++) {
      seedConfirmed(db, `train-bass-${i}`, 'bass')
      seedEmbedding(db, `train-bass-${i}`, [0, 1, 0])
    }
    await classifyAutoCategoryBatch(db)
    expect(allClassifiedStemCIDs(db).has('query')).toBe(true)
  })
})

// Background efficiency B4: the eligible ids are read once into a shuffled
// in-memory pending list and consumed a batch at a time, instead of a
// COUNT(*) + ORDER BY RANDOM() per batch.
describe('classifyAutoCategoryBatch (pending list)', () => {
  function trainedCentroidStore(): void {
    let store = emptyCategoryCentroidStore()
    const zeros = new Array(13).fill(0)
    for (let i = 0; i < 3; i++) {
      store = recordConfirmedCategory(store, 'arrangeRole', 'drums', [1, 0, 0, 0, 0, 0, ...zeros])
      store = recordConfirmedCategory(store, 'arrangeRole', 'bass', [0, 1, 0, 0, 0, 0, ...zeros])
    }
    vi.spyOn(categoryCentroidStore, 'loadCategoryCentroidStore').mockReturnValue(store)
  }

  function pendingBuildCount(db: Database.Database): () => number {
    const spy = vi.spyOn(db, 'prepare')
    return () => spy.mock.calls.filter(([sql]) => String(sql).includes('ORDER BY t.StemCID')).length
  }

  async function runToCompletion(db: Database.Database): Promise<number> {
    let calls = 0
    for (;;) {
      calls += 1
      const { remaining } = await classifyAutoCategoryBatch(db)
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

  /** A mixed library: embedding stems near drums / near bass / ambiguous,
   * feature-only stems (classifiable and ambiguous), mask-tagged stems. */
  function seedLibrary(db: Database.Database, prefix: string, n: number): void {
    for (let i = 0; i < n; i++) {
      seedEmbedding(db, `${prefix}-emb-drums-${i}`, [0.9, 0.1, 0])
      seedEmbedding(db, `${prefix}-emb-bass-${i}`, [0.1, 0.9, 0])
      seedEmbedding(db, `${prefix}-emb-ambiguous-${i}`, [0.5, 0.5, 0])
      seedFeatures(db, `${prefix}-feat-drums-${i}`, { transientDensity: 0.9, bassEnergyRatio: 0.1 })
      seedFeatures(db, `${prefix}-feat-ambiguous-${i}`, {
        transientDensity: 0.5,
        bassEnergyRatio: 0.5
      })
      seedInstrument(db, `${prefix}-mask-notes-${i}`, NOTES_BIT)
      seedFeatures(db, `${prefix}-mask-notes-${i}`, { transientDensity: 0.9, bassEnergyRatio: 0.1 })
    }
  }

  it('builds the eligible id list once and consumes it across batches', async () => {
    const db = freshDb()
    seedTrainedEmbeddings(db)
    trainedCentroidStore()
    seedLibrary(db, 'a', 150) // 450 embedding ids + 450 feature ids
    const builds = pendingBuildCount(db)

    const calls = await runToCompletion(db)
    expect(calls).toBe(3) // 450 ids per list / BATCH_SIZE 200
    // One build = one keyset page per table.
    expect(builds()).toBe(2)
    expect(classifications(db)).toHaveLength(150 * 4)
  })

  it('yields the same classifications as a from-scratch run, with rows arriving mid-pass through the cache stores', async () => {
    // Reference: everything present up front.
    const reference = freshDb()
    seedTrainedEmbeddings(reference)
    trainedCentroidStore()
    seedLibrary(reference, 'a', 120)
    seedLibrary(reference, 'b', 40)
    await runToCompletion(reference)

    // Same data, but the 'b' rows arrive between batches via the real
    // store writers (which note them for the pending list).
    const db = freshDb()
    seedTrainedEmbeddings(db)
    seedLibrary(db, 'a', 120)
    const builds = pendingBuildCount(db)
    await classifyAutoCategoryBatch(db)

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
    seedTrainedEmbeddings(db)
    seedEmbedding(db, 'ambiguous-1', [0.5, 0.5, 0])
    const builds = pendingBuildCount(db)

    expect(await classifyAutoCategoryBatch(db)).toEqual({ processed: 0, remaining: 0 })
    expect(builds()).toBe(2)
    // The scheduler's safety wake: rebuilt (one query per table), but the
    // unclassifiable stem was already tried under this training -- not
    // re-attempted (see the next test).
    expect(await classifyAutoCategoryBatch(db)).toEqual({ processed: 0, remaining: 0 })
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
    seedTrainedEmbeddings(db)
    seedEmbedding(db, 'ambiguous-1', [0.5, 0.5, 0])
    seedFeatures(db, 'feat-ambiguous-1', { transientDensity: 0.5, bassEnergyRatio: 0.5 })
    await classifyAutoCategoryBatch(db)
    const fetches = embeddingFetches(db)
    const featureFetch = vi.spyOn(db, 'prepare')

    expect(await classifyAutoCategoryBatch(db)).toEqual({ processed: 0, remaining: 0 })
    expect(await classifyAutoCategoryBatch(db)).toEqual({ processed: 0, remaining: 0 })
    expect(fetches()).toEqual([])
    expect(
      featureFetch.mock.calls.filter(([sql]) => String(sql).includes('f.FeaturesJSON AS'))
    ).toEqual([])
  })

  it('a batch that throws part-way leaves its stems untried, so the next rebuild retries them', async () => {
    const db = freshDb()
    seedTrainedEmbeddings(db)
    seedEmbedding(db, 'drums-1', [0.9, 0.1, 0])
    vi.spyOn(db, 'transaction').mockImplementationOnce(() => {
      throw new Error('SQLITE_BUSY')
    })
    await expect(classifyAutoCategoryBatch(db)).rejects.toThrow('SQLITE_BUSY')

    // The scheduler's next tick: the list is spent and nothing was noted, so
    // it rebuilds -- and the stem the failed batch took is back in it.
    expect(await classifyAutoCategoryBatch(db)).toEqual({ processed: 1, remaining: 0 })
    expect(allClassifiedStemCIDs(db)).toEqual(new Set(['drums-1']))
  })

  it('still picks up a row written outside the stores at the safety rebuild (a new id)', async () => {
    const db = freshDb()
    seedTrainedEmbeddings(db)
    seedEmbedding(db, 'ambiguous-1', [0.5, 0.5, 0])
    await classifyAutoCategoryBatch(db)

    seedEmbedding(db, 'late-drums', [0.9, 0.1, 0]) // no store, so no wake note
    expect(await classifyAutoCategoryBatch(db)).toEqual({ processed: 1, remaining: 0 })
    expect(allClassifiedStemCIDs(db)).toEqual(new Set(['late-drums']))
  })

  it('re-attempts tried stems once a confirmation changes the training', async () => {
    const db = freshDb()
    seedTrainedEmbeddings(db)
    seedEmbedding(db, 'leans-lead', [0, 0, 1])
    // Only drums and bass are trained: nothing confident for (0, 0, 1).
    expect((await classifyAutoCategoryBatch(db)).processed).toBe(0)
    expect((await classifyAutoCategoryBatch(db)).processed).toBe(0)

    // Three confirmed 'lead' references (direct inserts: the fingerprint
    // moves without any store noting it).
    for (let i = 0; i < 3; i++) {
      seedConfirmed(db, `train-lead-${i}`, 'lead')
      seedEmbedding(db, `train-lead-${i}`, [0, 0, 1])
    }
    expect((await classifyAutoCategoryBatch(db)).processed).toBe(1)
    expect(getAutoCategorizedStemCIDs(db, 'lead')).toEqual(new Set(['leans-lead']))
  })

  it('re-attempts a tried stem whose embedding a store rewrote', async () => {
    const db = freshDb()
    seedTrainedEmbeddings(db)
    seedEmbedding(db, 'ambiguous-1', [0.5, 0.5, 0])
    seedInstrument(db, 'ambiguous-1', AUDIO_IN_BIT) // a Stems row, so the store resolves it
    await classifyAutoCategoryBatch(db)
    await classifyAutoCategoryBatch(db)

    setStemEmbeddingCache(db, '/x/ambiguous-1', [0.9, 0.1, 0], 2000)
    expect(await classifyAutoCategoryBatch(db)).toEqual({ processed: 1, remaining: 0 })
    expect(getAutoCategorizedStemCIDs(db, 'drums')).toEqual(new Set(['ambiguous-1']))
  })

  it('re-attempts a tried stem once the writer fills in its mask (NULL -> drums)', async () => {
    const db = freshDb()
    seedTrainedEmbeddings(db)
    seedEmbedding(db, 'late-mask', [0.5, 0.5, 0]) // ambiguous on the embedding axis
    db.prepare(
      `INSERT INTO Stems (StemCID, OwnerJamCID, Instrument) VALUES ('late-mask', 'jam1', NULL)`
    ).run()
    expect((await classifyAutoCategoryBatch(db, [db])).processed).toBe(0)
    expect((await classifyAutoCategoryBatch(db, [db])).processed).toBe(0)

    // In place, as riffLibraryWriter.ts fills a stem in: same count and
    // MAX(rowid), its per-table write counter moves.
    db.prepare(`UPDATE Stems SET Instrument = ? WHERE StemCID = 'late-mask'`).run(DRUMS_BIT)
    bumpTableWriteVersion(db, 'Stems')
    expect((await classifyAutoCategoryBatch(db, [db])).processed).toBe(1)
    expect(getAutoCategorizedStemCIDs(db, 'drums')).toEqual(new Set(['late-mask']))
  })

  it('re-attempts a tried stem once another connection fills in its mask in the read-only archive', async () => {
    const own = freshDb()
    seedTrainedEmbeddings(own)
    seedEmbedding(own, 'arch-late', [0.5, 0.5, 0])
    const path = join(dir, 'archive.db')
    const writer = new Database(path)
    writer.exec(
      `CREATE TABLE Stems (StemCID TEXT PRIMARY KEY, OwnerJamCID TEXT, Instrument INTEGER)`
    )
    writer.prepare(`INSERT INTO Stems VALUES ('arch-late', 'jam1', NULL)`).run()
    const archive = new Database(path, { readonly: true })
    expect((await classifyAutoCategoryBatch(own, [archive, own])).processed).toBe(0)
    expect((await classifyAutoCategoryBatch(own, [archive, own])).processed).toBe(0)

    writer.prepare(`UPDATE Stems SET Instrument = ? WHERE StemCID = 'arch-late'`).run(NOTES_BIT)
    expect((await classifyAutoCategoryBatch(own, [archive, own])).processed).toBe(1)
    expect(getAutoCategorizedStemCIDs(own, 'lead')).toEqual(new Set(['arch-late']))
  })

  it('re-attempts tried stems when the mask dbs change (an archive connected)', async () => {
    const own = freshDb()
    seedTrainedEmbeddings(own)
    seedEmbedding(own, 'archive-drums', [0.5, 0.5, 0])
    expect((await classifyAutoCategoryBatch(own, [own])).processed).toBe(0)

    const archive = new Database(join(dir, 'archive.db'))
    archive.exec(
      `CREATE TABLE Stems (StemCID TEXT PRIMARY KEY, OwnerJamCID TEXT, Instrument INTEGER)`
    )
    seedInstrument(archive, 'archive-drums', DRUMS_BIT)
    expect((await classifyAutoCategoryBatch(own, [archive, own])).processed).toBe(1)
  })

  it('rebuilds on a training change noted by the stores, re-attempting previously unclassifiable stems', async () => {
    const db = freshDb()
    seedFeatures(db, 'feat-1', { transientDensity: 0.9, bassEnergyRatio: 0.1 })
    seedFeatures(db, 'feat-2', { transientDensity: 0.9, bassEnergyRatio: 0.1 })
    // Untrained centroids -- nothing classifies yet.
    const first = await classifyAutoCategoryBatch(db)
    expect(first.processed).toBe(0)

    // A retrain elsewhere (saveCategoryCentroidStore notes it).
    trainedCentroidStore()
    noteAutoClassifyTrainingChanged()
    const second = await classifyAutoCategoryBatch(db)
    expect(second.processed).toBe(2)
  })

  it('drops a listed id that was confirmed after the list was built', async () => {
    const db = freshDb()
    seedTrainedEmbeddings(db)
    for (let i = 0; i < 201; i++) seedEmbedding(db, `g-${i}`, [0.9, 0.1, 0])
    const first = await classifyAutoCategoryBatch(db)
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
    const second = await classifyAutoCategoryBatch(db)
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
    seedTrainedEmbeddings(db)
    seedGroup(db, 'rest', 300)
    const own = seedGroup(db, 'own', 150)
    const favs = seedGroup(db, 'fav', 100)
    const priority = { own: new Set(own), favourites: new Set(favs) }

    await classifyAutoCategoryBatch(db, [db], { priority })
    const first = classified(db)
    expect(first.filter((c) => c.startsWith('own-'))).toHaveLength(150)
    expect(first.filter((c) => c.startsWith('fav-'))).toHaveLength(50)
    expect(first.filter((c) => c.startsWith('rest-'))).toHaveLength(0)

    await classifyAutoCategoryBatch(db, [db], { priority })
    const second = classified(db)
    expect(second.filter((c) => c.startsWith('fav-'))).toHaveLength(100)
    expect(second.filter((c) => c.startsWith('rest-'))).toHaveLength(150)
  })

  it('applies to the feature pass too', async () => {
    const db = freshDb()
    // untrained embedding axis: feature-only stems go to the centroid pass
    let store = emptyCategoryCentroidStore()
    const zeros = new Array(13).fill(0)
    for (let i = 0; i < 3; i++) {
      store = recordConfirmedCategory(store, 'arrangeRole', 'drums', [1, 0, 0, 0, 0, 0, ...zeros])
      store = recordConfirmedCategory(store, 'arrangeRole', 'bass', [0, 1, 0, 0, 0, 0, ...zeros])
    }
    vi.spyOn(categoryCentroidStore, 'loadCategoryCentroidStore').mockReturnValue(store)
    const ids = (prefix: string, n: number): string[] =>
      Array.from({ length: n }, (_, i) => `${prefix}-${i}`)
    for (const id of [...ids('rest', 250), ...ids('own', 120)])
      seedFeatures(db, id, { transientDensity: 0.9, bassEnergyRatio: 0.1 })
    const priority = { own: new Set(ids('own', 120)), favourites: new Set<string>() }
    await classifyAutoCategoryBatch(db, [db], { priority })
    const first = classified(db)
    expect(first.filter((c) => c.startsWith('own-'))).toHaveLength(120)
    expect(first.filter((c) => c.startsWith('rest-'))).toHaveLength(80)
  })

  it('a stem noted mid-pass joins its own group', async () => {
    const db = freshDb()
    seedTrainedEmbeddings(db)
    seedGroup(db, 'rest', 500)
    const own = seedGroup(db, 'own', 150)
    const priority = { own: new Set([...own, 'own-late']), favourites: new Set<string>() }
    await classifyAutoCategoryBatch(db, [db], { priority })
    // the store resolves a path to a StemCID through a Stems row
    seedInstrument(db, 'own-late', AUDIO_IN_BIT)
    seedInstrument(db, 'rest-late', AUDIO_IN_BIT)
    setStemEmbeddingCache(db, '/x/own-late', [0.9, 0.1, 0], 1000)
    // and a rest stem noted at the same time stays behind the own one
    setStemEmbeddingCache(db, '/x/rest-late', [0.9, 0.1, 0], 1000)
    await classifyAutoCategoryBatch(db, [db], { priority })
    expect(allClassifiedStemCIDs(db).has('own-late')).toBe(true)
  })

  // Review of 147dca78: the lists were keyed by username and set SIZES, so
  // a star swapped for another (or an own stem for another) kept the old
  // layout.
  it('a favourite swapped for another at the same size lays the lists out again', async () => {
    const db = freshDb()
    seedTrainedEmbeddings(db)
    seedGroup(db, 'rest', 400)
    const favA = seedGroup(db, 'favA', 100)
    const favB = seedGroup(db, 'favB', 100)
    const none = new Set<string>()
    await classifyAutoCategoryBatch(db, [db], {
      priority: { own: none, favourites: new Set(favA) }
    })
    expect(classified(db).filter((c) => c.startsWith('favA-'))).toHaveLength(100)
    await classifyAutoCategoryBatch(db, [db], {
      priority: { own: none, favourites: new Set(favB) }
    })
    // every favB left was taken before any more of the rest
    expect(classified(db).filter((c) => c.startsWith('favB-'))).toHaveLength(100)
  })

  it('a priority arriving after the list was built reorders it, without a rebuild', async () => {
    const db = freshDb()
    seedTrainedEmbeddings(db)
    seedGroup(db, 'rest', 600)
    const own = seedGroup(db, 'own', 100)
    const spy = vi.spyOn(db, 'prepare')
    const builds = (): number =>
      spy.mock.calls.filter(([sql]) => String(sql).includes('ORDER BY t.StemCID')).length

    await classifyAutoCategoryBatch(db) // no priority yet (no username reported)
    const before = classified(db).filter((c) => c.startsWith('own-')).length
    const buildsBefore = builds()
    await classifyAutoCategoryBatch(db, [db], {
      priority: { own: new Set(own), favourites: new Set<string>() }
    })
    expect(classified(db).filter((c) => c.startsWith('own-'))).toHaveLength(100)
    expect(before).toBeLessThan(100)
    expect(builds()).toBe(buildsBefore)
  })
})
