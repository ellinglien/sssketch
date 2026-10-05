import { describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { STEM_FEATURE_VERSION, type StemFeatures } from '@shared/stemFeatures'
import { writeStemAnalysisResults } from './stemAnalysisResultsWriter'
import { setStemPeaksCache } from './stemPeaksCacheStore'
import { setStemFeatureCache } from './stemFeatureCacheStore'
import { setStemEmbeddingCache } from './stemEmbeddingCacheStore'
import { applyYamnetZeroShotCategory, markYamnetZeroShotAttempted } from './stemAutoCategoryStore'
import * as traitQuantileCache from './traitQuantileCache'
import * as wake from './stemAutoClassifyWake'

function freshDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE Stems (StemCID TEXT PRIMARY KEY, OwnerJamCID TEXT NOT NULL, Instrument INTEGER);
    CREATE TABLE StemFeatureCache (
      StemCID TEXT PRIMARY KEY, FeaturesJSON TEXT NOT NULL, ExtractedAt INTEGER NOT NULL
    );
    CREATE TABLE StemPeaksCache (
      StemCID TEXT PRIMARY KEY, PeaksJSON TEXT NOT NULL, BrightnessJSON TEXT NOT NULL,
      ExtractedAt INTEGER NOT NULL
    );
    CREATE TABLE StemEmbeddingCache (
      StemCID TEXT PRIMARY KEY, EmbeddingJSON TEXT NOT NULL, ExtractedAt INTEGER NOT NULL
    );
    CREATE TABLE StemYamnetZeroShotAttempted (StemCID TEXT PRIMARY KEY, AttemptedAt INTEGER NOT NULL);
    CREATE TABLE StemCategories (StemCID TEXT PRIMARY KEY, ArrangeRole TEXT, UpdatedAt INTEGER);
    CREATE TABLE StemAutoCategory (
      StemCID TEXT PRIMARY KEY, ArrangeRole TEXT NOT NULL, Source TEXT NOT NULL,
      ComputedAt INTEGER NOT NULL
    );
  `)
  return db
}

function addStem(db: Database.Database, stemCID: string): void {
  db.prepare(`INSERT INTO Stems VALUES (?, 'jam', NULL)`).run(stemCID)
}

function features(seed: number): StemFeatures {
  return {
    transientDensity: seed,
    bassEnergyRatio: 0.2,
    spectralCentroidHz: 900,
    zcrBrightness: 0.3,
    voicedFraction: 0.5,
    pitchVarianceCents: 15,
    mfcc: Array.from({ length: 13 }, (_, i) => i + seed),
    featureVersion: STEM_FEATURE_VERSION
  } as StemFeatures
}

const TABLES = [
  'StemPeaksCache',
  'StemFeatureCache',
  'StemEmbeddingCache',
  'StemYamnetZeroShotAttempted',
  'StemAutoCategory'
]

function dump(db: Database.Database): Record<string, unknown[]> {
  return Object.fromEntries(
    TABLES.map((t) => [t, db.prepare(`SELECT * FROM ${t} ORDER BY StemCID`).all()])
  )
}

// An AudioSet class that maps to an ArrangeRole (see audiosetClasses.ts) --
// found at runtime so the test doesn't hard-code the table.
async function mappedClassIndex(): Promise<number> {
  const { arrangeRoleForAudiosetClass } = await import('@shared/audiosetClasses')
  for (let i = 0; i < 600; i++) if (arrangeRoleForAudiosetClass(i)) return i
  throw new Error('no mapped class')
}

describe('writeStemAnalysisResults (B7)', () => {
  it('writes exactly the rows the single-write IPCs write', async () => {
    const classIndex = await mappedClassIndex()
    const single = freshDb()
    const batched = freshDb()
    for (const db of [single, batched]) {
      for (const cid of ['s1', 's2', 's3', 'confirmed']) addStem(db, cid)
      db.prepare(`INSERT INTO StemCategories VALUES ('confirmed', 'drums', 1)`).run()
    }

    // The old path: one call per output, in the order the renderer sent them.
    setStemPeaksCache(single, '/lib/j/s1', { peaks: [1, 2], brightness: [3, 4] }, 500)
    setStemFeatureCache(single, '/lib/j/s1', features(1), 500)
    setStemEmbeddingCache(single, '/lib/j/s1', [0.1, 0.2], 500)
    markYamnetZeroShotAttempted(single, 's1', 500)
    applyYamnetZeroShotCategory(single, 's1', classIndex, 500)
    setStemFeatureCache(single, '/lib/j/s2', features(2), 500)
    markYamnetZeroShotAttempted(single, 's3', 500)
    markYamnetZeroShotAttempted(single, 'confirmed', 500)
    applyYamnetZeroShotCategory(single, 'confirmed', classIndex, 500)

    await writeStemAnalysisResults(
      batched,
      [
        {
          path: '/lib/j/s1',
          peaks: { peaks: [1, 2], brightness: [3, 4] },
          features: features(1),
          embedding: [0.1, 0.2],
          zeroShotAttempted: true,
          zeroShotClassIndex: classIndex
        },
        { path: '/lib/j/s2', features: features(2) },
        { path: '/lib/j/s3', zeroShotAttempted: true },
        { path: '/lib/j/confirmed', zeroShotAttempted: true, zeroShotClassIndex: classIndex },
        // Not a library stem -- skipped, like the single writers skip it.
        { path: '/local/one-shot.wav', features: features(3), embedding: [1] }
      ],
      500
    )
    expect(dump(batched)).toEqual(dump(single))
    expect(
      (batched.prepare(`SELECT COUNT(*) AS n FROM StemAutoCategory`).get() as { n: number }).n
    ).toBe(1)
  })

  it('resolves StemCIDs against the extra candidate dbs too, writing into the own db', async () => {
    const own = freshDb()
    const external = new Database(':memory:')
    external.exec(`CREATE TABLE Stems (StemCID TEXT PRIMARY KEY, OwnerJamCID TEXT NOT NULL)`)
    external.prepare(`INSERT INTO Stems VALUES ('ext-1', 'jam')`).run()
    await writeStemAnalysisResults(own, [{ path: '/lore/j/ext-1', embedding: [1] }], 500, [
      external
    ])
    expect(own.prepare(`SELECT StemCID FROM StemEmbeddingCache`).all()).toEqual([
      { StemCID: 'ext-1' }
    ])
  })

  it('fires the same in-memory hooks (trait table / feature version, classifier wake) as the single writers', async () => {
    const db = freshDb()
    addStem(db, 's1')
    addStem(db, 's2')
    const traitSpy = vi.spyOn(traitQuantileCache, 'noteStemFeatureRowWritten')
    const wakeSpy = vi.spyOn(wake, 'noteAutoClassifyInputRow')
    await writeStemAnalysisResults(
      db,
      [
        { path: '/l/s1', features: features(1), embedding: [1] },
        { path: '/l/s2', peaks: { peaks: [], brightness: [] } }
      ],
      500
    )
    expect(traitSpy).toHaveBeenCalledTimes(1)
    expect(traitSpy).toHaveBeenCalledWith(db, features(1), 's1')
    expect(wakeSpy.mock.calls.map(([, kind, cid]) => `${kind}:${cid}`).sort()).toEqual([
      'embedding:s1',
      'feature:s1'
    ])
    traitSpy.mockRestore()
    wakeSpy.mockRestore()
  })

  it('writes a batch in one transaction, and resolves StemCIDs with one query (not per stem)', async () => {
    const db = freshDb()
    for (let i = 0; i < 40; i++) addStem(db, `s${i}`)
    const transactionSpy = vi.spyOn(db, 'transaction')
    const prepareSpy = vi.spyOn(db, 'prepare')
    await writeStemAnalysisResults(
      db,
      Array.from({ length: 40 }, (_, i) => ({ path: `/l/s${i}`, embedding: [i] })),
      500
    )
    expect(transactionSpy).toHaveBeenCalledTimes(1)
    const lookups = prepareSpy.mock.calls.filter(([sql]) => String(sql).includes('FROM Stems'))
    expect(lookups).toHaveLength(1)
    expect(db.prepare(`SELECT COUNT(*) AS n FROM StemEmbeddingCache`).get()).toEqual({ n: 40 })
  })

  it('splits a long batch into time-budgeted transactions, yielding between them', async () => {
    const db = freshDb()
    for (let i = 0; i < 30; i++) addStem(db, `s${i}`)
    // Every performance.now() call advances 10 ms, so the 16 ms budget is
    // exceeded after two rows.
    let t = 0
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => (t += 10))
    const transactionSpy = vi.spyOn(db, 'transaction')
    await writeStemAnalysisResults(
      db,
      Array.from({ length: 30 }, (_, i) => ({ path: `/l/s${i}`, embedding: [i] })),
      500
    )
    nowSpy.mockRestore()
    expect(transactionSpy.mock.calls.length).toBeGreaterThan(1)
    expect(db.prepare(`SELECT COUNT(*) AS n FROM StemEmbeddingCache`).get()).toEqual({ n: 30 })
  })
})

describe('the level backfill (spec 2026-10-05-radio-intensity-arc-design 7.3)', () => {
  const LEVEL = { loudnessLufs: -14.2, lowLevelDb: -21.5, activeFraction: 0.9, levelVersion: 1 }

  it('merges into the existing row, keeping every other field, featureVersion and ExtractedAt', async () => {
    const db = freshDb()
    addStem(db, 'cid-1')
    await writeStemAnalysisResults(db, [{ path: '/lib/cid-1', features: features(3) }], 111)
    const before = db.prepare(`SELECT * FROM StemFeatureCache`).get() as {
      FeaturesJSON: string
      ExtractedAt: number
    }
    await writeStemAnalysisResults(db, [{ path: '/lib/cid-1', level: LEVEL }], 222)
    const after = db.prepare(`SELECT * FROM StemFeatureCache`).get() as {
      FeaturesJSON: string
      ExtractedAt: number
    }
    expect(after.ExtractedAt).toBe(111)
    expect(JSON.parse(after.FeaturesJSON)).toEqual({ ...JSON.parse(before.FeaturesJSON), ...LEVEL })
  })

  it('merges only the four level fields, whatever else the write carries', async () => {
    const db = freshDb()
    addStem(db, 'cid-5')
    await writeStemAnalysisResults(db, [{ path: '/lib/cid-5', features: features(2) }], 1)
    const sneaky = { ...LEVEL, mfcc: [], featureVersion: 99 } as typeof LEVEL
    await writeStemAnalysisResults(db, [{ path: '/lib/cid-5', level: sneaky }], 2)
    const row = db.prepare(`SELECT FeaturesJSON FROM StemFeatureCache`).get() as {
      FeaturesJSON: string
    }
    expect(JSON.parse(row.FeaturesJSON)).toEqual({ ...features(2), ...LEVEL })
  })

  it('writes nothing without a current row to merge into', async () => {
    const db = freshDb()
    addStem(db, 'cid-2')
    addStem(db, 'cid-3')
    db.prepare(`INSERT INTO StemFeatureCache VALUES ('cid-3', '{"mfcc":[]}', 5)`).run()
    await writeStemAnalysisResults(
      db,
      [
        { path: '/lib/cid-2', level: LEVEL },
        { path: '/lib/cid-3', level: LEVEL }
      ],
      9
    )
    expect(db.prepare(`SELECT StemCID, FeaturesJSON FROM StemFeatureCache`).all()).toEqual([
      { StemCID: 'cid-3', FeaturesJSON: '{"mfcc":[]}' }
    ])
  })

  it('tells the value table, and does not wake the classifier', async () => {
    const db = freshDb()
    addStem(db, 'cid-4')
    await writeStemAnalysisResults(db, [{ path: '/lib/cid-4', features: features(1) }], 1)
    const noted = vi.spyOn(traitQuantileCache, 'noteStemFeatureRowWritten')
    const woke = vi.spyOn(wake, 'noteAutoClassifyInputRow')
    await writeStemAnalysisResults(db, [{ path: '/lib/cid-4', level: LEVEL }], 2)
    expect(noted).toHaveBeenCalledTimes(1)
    expect(noted.mock.calls[0][1]).toMatchObject(LEVEL)
    expect(woke).not.toHaveBeenCalled()
    noted.mockRestore()
    woke.mockRestore()
  })
})
