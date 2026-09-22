import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { STEM_FEATURE_VERSION } from '@shared/stemFeatures'
import { getStemAnalysisNeeds } from './stemAnalysisNeeds'

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

const current = JSON.stringify({ mfcc: [], featureVersion: STEM_FEATURE_VERSION })
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
      { peaks: true, features: true, embedding: true, zeroShot: false }
    ])
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

  it('returns an empty list for no paths without querying', async () => {
    expect(await getStemAnalysisNeeds(freshDb(), [])).toEqual([])
  })
})
