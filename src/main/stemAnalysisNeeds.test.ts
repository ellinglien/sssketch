import { describe, expect, it, vi } from 'vitest'
import { needsAnyAnalysis } from '@shared/stemAnalysisNeeds'
import Database from 'better-sqlite3'
import { STEM_FEATURE_VERSION } from '@shared/stemFeatures'
import { STEM_LEVEL_VERSION } from '@shared/stemLevel'
import { getStemAnalysisNeeds, stemCIDsNeedingRework } from './stemAnalysisNeeds'
import { getTraitQuantileTables, getTraitValueTable } from './traitQuantileCache'
import { mergeStemFeatureLevelRow } from './stemFeatureCacheStore'
import { noteStemFeatureRowWritten } from './traitQuantileCache'
import { countWork } from './workCounters'

vi.mock('./workCounters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./workCounters')>()
  return { ...actual, countWork: vi.fn() }
})

function freshDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
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
    CREATE TABLE Stems (StemCID TEXT PRIMARY KEY, OwnerJamCID TEXT NOT NULL, Instrument INTEGER);
    CREATE TABLE StemYamnetZeroShotAttempted (StemCID TEXT PRIMARY KEY, AttemptedAt INTEGER NOT NULL);
    CREATE TABLE StemCategories (StemCID TEXT PRIMARY KEY, ArrangeRole TEXT, UpdatedAt INTEGER);
    CREATE TABLE StemAutoCategory (
      StemCID TEXT PRIMARY KEY, ArrangeRole TEXT NOT NULL, Source TEXT NOT NULL,
      ComputedAt INTEGER NOT NULL
    );
  `)
  return db
}

function addFeatures(db: Database.Database, stemCID: string, json: string): void {
  db.prepare(`INSERT INTO StemFeatureCache VALUES (?, ?, 0)`).run(stemCID, json)
}
function addPeaks(db: Database.Database, stemCID: string): void {
  db.prepare(`INSERT INTO StemPeaksCache VALUES (?, '[]', '[]', 0)`).run(stemCID)
}
function addEmbedding(db: Database.Database, stemCID: string): void {
  db.prepare(`INSERT INTO StemEmbeddingCache VALUES (?, '[1]', 0)`).run(stemCID)
}

const current = JSON.stringify({
  mfcc: [],
  featureVersion: STEM_FEATURE_VERSION,
  levelVersion: STEM_LEVEL_VERSION
})
const noLevel = JSON.stringify({ mfcc: [], featureVersion: STEM_FEATURE_VERSION })
const v1 = JSON.stringify({ mfcc: [] })

describe('getStemAnalysisNeeds', () => {
  it('reports each missing or stale analysis per path, index-aligned', async () => {
    const db = freshDb()
    addFeatures(db, 'done', current)
    addPeaks(db, 'done')
    addEmbedding(db, 'done')
    addFeatures(db, 'stale', v1)
    addPeaks(db, 'stale')
    addEmbedding(db, 'stale')
    addPeaks(db, 'peaks-only')
    addFeatures(db, 'corrupt', '{not json')

    const needs = await getStemAnalysisNeeds(db, [
      '/lib/jam/done',
      '/lib/jam/stale',
      '/lib/jam/peaks-only',
      '/lib/jam/never',
      '/lib/jam/corrupt',
      '/local/one-shot.wav'
    ])
    expect(needs).toEqual([
      { peaks: false, features: false, embedding: false, zeroShot: false },
      { peaks: false, features: true, embedding: false, zeroShot: false },
      { peaks: false, features: true, embedding: true, zeroShot: false },
      { peaks: true, features: true, embedding: true, zeroShot: false },
      { peaks: true, features: true, embedding: true, zeroShot: false },
      // not a library stem name: YAMNet's result could never be stored (audit 6)
      { peaks: true, features: true, embedding: false, zeroShot: false }
    ])
  })

  it('a baked stem with no rows needs peaks and features only (audit 6)', async () => {
    const db = freshDb()
    const needs = await getStemAnalysisNeeds(db, [
      '/projects/p/baked/0123456789abcdef0123456789abcdef.baked.wav'
    ])
    expect(needs).toEqual([{ peaks: true, features: true, embedding: false, zeroShot: false }])
  })

  it('answers across chunk boundaries and for duplicate paths', async () => {
    const db = freshDb()
    const paths: string[] = []
    for (let i = 0; i < 23; i++) {
      if (i % 2 === 0) {
        addFeatures(db, `cid-${i}`, current)
        addPeaks(db, `cid-${i}`)
        addEmbedding(db, `cid-${i}`)
      }
      paths.push(`/lib/j/cid-${i}`)
    }
    paths.push('/lib/other-jam/cid-0')
    const needs = await getStemAnalysisNeeds(db, paths, 5)
    expect(needs).toHaveLength(24)
    needs.forEach((n, i) => {
      const done = i === 23 || i % 2 === 0
      expect(n).toEqual({ peaks: !done, features: !done, embedding: !done, zeroShot: false })
    })
  })

  it('flags zero-shot only for embedded, never-attempted, unclassified stems with their own Stems row', async () => {
    const db = freshDb()
    const stems = ['pending', 'attempted', 'confirmed', 'auto', 'no-stems-row', 'no-embedding']
    for (const cid of stems) {
      addFeatures(db, cid, current)
      addPeaks(db, cid)
      if (cid !== 'no-embedding') addEmbedding(db, cid)
      if (cid !== 'no-stems-row') {
        db.prepare(`INSERT INTO Stems VALUES (?, 'jam', NULL)`).run(cid)
      }
    }
    db.prepare(`INSERT INTO StemYamnetZeroShotAttempted VALUES ('attempted', 1)`).run()
    db.prepare(`INSERT INTO StemCategories VALUES ('confirmed', 'drums', 1)`).run()
    db.prepare(`INSERT INTO StemAutoCategory VALUES ('auto', 'bass', 'centroid', 1)`).run()

    const needs = await getStemAnalysisNeeds(
      db,
      stems.map((cid) => `/lib/jam/${cid}`)
    )
    expect(needs.map((n) => n.zeroShot)).toEqual([true, false, false, false, false, false])
    // The one without an embedding needs the embedding (which runs the
    // zero-shot step itself), not a separate zero-shot pass.
    expect(needs[5].embedding).toBe(true)
  })

  it('asks for the level pass only on a current row without it (spec 2026-10-05 7.3)', async () => {
    const db = freshDb()
    addFeatures(db, 'done', current)
    addFeatures(db, 'unlevelled', noLevel)
    addFeatures(
      db,
      'old-level',
      JSON.stringify({ mfcc: [], featureVersion: STEM_FEATURE_VERSION, levelVersion: 0 })
    )
    addFeatures(db, 'stale', v1)
    const needs = await getStemAnalysisNeeds(db, [
      '/lib/jam/done',
      '/lib/jam/unlevelled',
      '/lib/jam/old-level',
      '/lib/jam/stale',
      '/lib/jam/never'
    ])
    expect(needs.map((n) => [n.features, n.level ?? false])).toEqual([
      [false, false],
      [false, true],
      [false, true],
      [true, false],
      [true, false]
    ])
  })

  // Background scan audit 4(b): while the trait value table accounts for every
  // StemFeatureCache row, its version columns answer `features` and `level` --
  // the same rule, read without parsing a single FeaturesJSON.
  it('answers identically from the trait value table and from the JSON, without parsing', async () => {
    const db = freshDb()
    const rows: [string, string][] = [
      ['current', current],
      ['no-level', noLevel],
      ['v1', v1],
      ['corrupt', '{not json'],
      ['json-null', 'null'],
      ['json-number', '5'],
      ['json-zero', '0'],
      ['odd-versions', JSON.stringify({ mfcc: [], featureVersion: 2.5, levelVersion: 0.5 })],
      ['negative', JSON.stringify({ mfcc: [], featureVersion: -1 })],
      ['huge', JSON.stringify({ mfcc: [], featureVersion: 1e9, levelVersion: 1e9 })],
      ['merged-later', noLevel]
    ]
    for (const [cid, json] of rows) {
      addFeatures(db, cid, json)
      addPeaks(db, cid)
    }
    await getTraitQuantileTables(db)
    expect(getTraitValueTable(db)).not.toBeNull()
    // the level backfill, after the build: merged and noted as the writer does
    const merged = mergeStemFeatureLevelRow(db, 'merged-later', {
      loudnessLufs: -14,
      lowLevelDb: -30,
      activeFraction: 0.9,
      levelVersion: STEM_LEVEL_VERSION
    })
    expect(merged).not.toBeNull()
    noteStemFeatureRowWritten(db, merged!, 'merged-later')
    expect(getTraitValueTable(db)).not.toBeNull()

    const paths = [...rows.map(([cid]) => `/lib/jam/${cid}`), '/lib/jam/missing']
    // the same rows on a connection with no value table: the JSON path
    const withoutTable = new Database(db.serialize())
    expect(getTraitValueTable(withoutTable)).toBeNull()
    const fromJson = await getStemAnalysisNeeds(withoutTable, paths)

    vi.mocked(countWork).mockClear()
    const prepare = vi.spyOn(db, 'prepare')
    const fromTable = await getStemAnalysisNeeds(db, paths)
    const sql = prepare.mock.calls.map(([text]) => String(text))
    prepare.mockRestore()

    expect(fromTable).toEqual(fromJson)
    expect(sql.filter((text) => text.includes('FeaturesJSON'))).toEqual([])
    expect(
      vi.mocked(countWork).mock.calls.filter(([kind]) => kind === 'parse:stem-features')
    ).toEqual([])
    // and the JSON path counts its parses
    vi.mocked(countWork).mockClear()
    await getStemAnalysisNeeds(withoutTable, paths)
    expect(vi.mocked(countWork).mock.calls.some(([kind]) => kind === 'parse:stem-features')).toBe(
      true
    )
    // spot-check the answer itself
    const byCid = new Map(paths.map((p, i) => [p.split('/').pop()!, fromTable[i]]))
    expect(byCid.get('current')).toMatchObject({ features: false })
    expect(byCid.get('current')!.level).toBeUndefined()
    expect(byCid.get('no-level')).toMatchObject({ features: false, level: true })
    expect(byCid.get('merged-later')!.features).toBe(false)
    expect(byCid.get('merged-later')!.level).toBeUndefined()
    for (const cid of [
      'v1',
      'corrupt',
      'json-null',
      'json-number',
      'json-zero',
      'negative',
      'missing'
    ]) {
      expect(byCid.get(cid)!.features, cid).toBe(true)
      expect(byCid.get(cid)!.level, cid).toBeUndefined()
    }
    expect(byCid.get('odd-versions')).toMatchObject({ features: false, level: true })
    expect(byCid.get('huge')!.features).toBe(false)
    expect(byCid.get('huge')!.level).toBeUndefined()
  })

  it('falls back to the JSON once the value table stops accounting for every row', async () => {
    const db = freshDb()
    addFeatures(db, 'a', current)
    await getTraitQuantileTables(db)
    expect(getTraitValueTable(db)).not.toBeNull()
    // written behind the table's back: it no longer accounts for every row
    addFeatures(db, 'b', noLevel)
    expect(getTraitValueTable(db)).toBeNull()
    const needs = await getStemAnalysisNeeds(db, ['/lib/j/a', '/lib/j/b'])
    expect(needs.map((n) => [n.features, n.level ?? false])).toEqual([
      [false, false],
      [false, true]
    ])
  })

  // Background scan audit 3: the library scan's analysed half. For a stem with
  // a peaks, embedding and feature row, "needs any analysis" must be exactly
  // "in this set" -- from the value table and from the JSON alike.
  it('stemCIDsNeedingRework: exactly the fully-rowed stems that still need work, table or JSON', async () => {
    const db = freshDb()
    const rows: [string, string][] = [
      ['current', current],
      ['no-level', noLevel],
      ['v1', v1],
      ['corrupt', '{not json'],
      ['json-null', 'null'],
      ['json-number', '5'],
      ['zero-shot', current],
      ['attempted', current]
    ]
    for (const [cid, json] of rows) {
      addFeatures(db, cid, json)
      addPeaks(db, cid)
      addEmbedding(db, cid)
    }
    for (const cid of ['zero-shot', 'attempted']) {
      db.prepare(`INSERT INTO Stems VALUES (?, 'jam', NULL)`).run(cid)
    }
    db.prepare(`INSERT INTO StemYamnetZeroShotAttempted VALUES ('attempted', 1)`).run()
    // features only: not fully rowed, but its row's state still counts
    addFeatures(db, 'feature-only-v1', v1)

    const fromJson = await stemCIDsNeedingRework(db)
    await getTraitQuantileTables(db)
    expect(getTraitValueTable(db)).not.toBeNull()
    vi.mocked(countWork).mockClear()
    const fromTable = await stemCIDsNeedingRework(db)
    expect(
      vi.mocked(countWork).mock.calls.filter(([kind]) => kind === 'parse:stem-features')
    ).toEqual([])
    expect(fromTable).toEqual(fromJson)
    expect([...fromTable].sort()).toEqual(
      [
        'corrupt',
        'feature-only-v1',
        'json-null',
        'json-number',
        'no-level',
        'v1',
        'zero-shot'
      ].sort()
    )
    const fullyRowed = rows.map(([cid]) => cid)
    const needs = await getStemAnalysisNeeds(
      db,
      fullyRowed.map((cid) => `/lib/j/${cid}`)
    )
    fullyRowed.forEach((cid, i) => {
      expect(fromTable.has(cid), cid).toBe(needsAnyAnalysis(needs[i]))
    })
  })

  it('stemCIDsNeedingRework: zero-shot windows span more than one window', async () => {
    const db = freshDb()
    for (let i = 0; i < 2005; i++) {
      const cid = `z${String(i).padStart(5, '0')}`
      addEmbedding(db, cid)
      if (i % 2 === 0) db.prepare(`INSERT INTO Stems VALUES (?, 'jam', NULL)`).run(cid)
    }
    const pending = await stemCIDsNeedingRework(db)
    expect(pending.size).toBe(1003)
    expect(pending.has('z02004')).toBe(true)
    expect(pending.has('z01999')).toBe(false)
  })

  it('with no YAMNet model, nothing needs the embedding or zero-shot step (audit B3)', async () => {
    const db = freshDb()
    // everything but the embedding: with no model, there is nothing left to do
    addFeatures(db, 'noembed', current)
    addPeaks(db, 'noembed')
    // zero-shot pending: an embedding from when the model was there
    addFeatures(db, 'zs', current)
    addPeaks(db, 'zs')
    addEmbedding(db, 'zs')
    db.prepare(`INSERT INTO Stems VALUES ('zs', 'jam', NULL)`).run()

    const paths = ['/lib/j/noembed', '/lib/j/zs', '/lib/j/never']
    const withModel = await getStemAnalysisNeeds(db, paths)
    expect(withModel.map((n) => [n.embedding, n.zeroShot])).toEqual([
      [true, false],
      [false, true],
      [true, false]
    ])
    const needs = await getStemAnalysisNeeds(db, paths, undefined, { yamnetAvailable: false })
    expect(needs).toEqual([
      { peaks: false, features: false, embedding: false, zeroShot: false },
      { peaks: false, features: false, embedding: false, zeroShot: false },
      { peaks: true, features: true, embedding: false, zeroShot: false }
    ])
    expect(needsAnyAnalysis(needs[0])).toBe(false)
    expect(needsAnyAnalysis(needs[1])).toBe(false)
  })

  it('stemCIDsNeedingRework: no zero-shot half with no YAMNet model', async () => {
    const db = freshDb()
    addFeatures(db, 'zs', current)
    addEmbedding(db, 'zs')
    db.prepare(`INSERT INTO Stems VALUES ('zs', 'jam', NULL)`).run()
    addFeatures(db, 'stale', v1)
    expect([...(await stemCIDsNeedingRework(db))].sort()).toEqual(['stale', 'zs'])
    expect([...(await stemCIDsNeedingRework(db, { yamnetAvailable: false }))]).toEqual(['stale'])
  })

  it('returns an empty list for no paths without querying', async () => {
    expect(await getStemAnalysisNeeds(freshDb(), [])).toEqual([])
  })
})
