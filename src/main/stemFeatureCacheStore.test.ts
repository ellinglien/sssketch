import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import type { StemFeatures } from '@shared/stemFeatures'
import { getStemFeatureCache, setStemFeatureCache } from './stemFeatureCacheStore'
import { getTraitQuantileTables } from './traitQuantileCache'

function freshDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE StemFeatureCache (
      StemCID TEXT PRIMARY KEY, FeaturesJSON TEXT NOT NULL, ExtractedAt INTEGER NOT NULL
    );
    CREATE TABLE Stems (StemCID TEXT PRIMARY KEY);
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

describe('stemFeatureCacheStore', () => {
  it('returns null for a path with no cached row yet', () => {
    const db = freshDb()
    db.prepare(`INSERT INTO Stems (StemCID) VALUES (?)`).run('cid-1')
    expect(getStemFeatureCache(db, '/lib/cid-1')).toBe(null)
  })

  it('round-trips a written feature set back out', () => {
    const db = freshDb()
    db.prepare(`INSERT INTO Stems (StemCID) VALUES (?)`).run('cid-1')
    const features = fakeFeatures()
    setStemFeatureCache(db, '/lib/cid-1', features, 1000)
    expect(getStemFeatureCache(db, '/lib/cid-1')).toEqual(features)
  })

  it('a later write overwrites an earlier one for the same stem', () => {
    const db = freshDb()
    db.prepare(`INSERT INTO Stems (StemCID) VALUES (?)`).run('cid-1')
    setStemFeatureCache(db, '/lib/cid-1', fakeFeatures(), 1000)
    const updated = { ...fakeFeatures(), transientDensity: 0.9 }
    setStemFeatureCache(db, '/lib/cid-1', updated, 2000)
    expect(getStemFeatureCache(db, '/lib/cid-1')?.transientDensity).toBe(0.9)
  })

  it('silently skips writing for a path whose basename is not a real StemCID', () => {
    const db = freshDb()
    setStemFeatureCache(db, '/local/one-shot.wav', fakeFeatures(), 1000)
    expect(getStemFeatureCache(db, '/local/one-shot.wav')).toBe(null)
    const count = db.prepare(`SELECT COUNT(*) as n FROM StemFeatureCache`).get() as { n: number }
    expect(count.n).toBe(0)
  })

  it('validates and writes a stem via an extra candidate db when the primary db does not have it', () => {
    const db = freshDb()
    const externalDb = freshDb()
    externalDb.prepare(`INSERT INTO Stems (StemCID) VALUES (?)`).run('cid-external')
    const features = fakeFeatures()
    setStemFeatureCache(db, '/lore-archive/cid-external', features, 1000, [externalDb])
    // The row is written into `db` (the primary/own warehouse), even
    // though the StemCID was only validated against `externalDb`.
    expect(getStemFeatureCache(db, '/lore-archive/cid-external', [externalDb])).toEqual(features)
    const ownRow = db
      .prepare(`SELECT COUNT(*) as n FROM StemFeatureCache WHERE StemCID = ?`)
      .get('cid-external') as { n: number }
    expect(ownRow.n).toBe(1)
  })

  it('re-extracted (version 2) writes let the trait quantile tables rebuild', async () => {
    const db = freshDb()
    for (let i = 0; i < 20; i++) {
      db.prepare(`INSERT INTO Stems (StemCID) VALUES (?)`).run(`cid-${i}`)
      setStemFeatureCache(db, `/lib/cid-${i}`, fakeFeatures(), 1000)
    }
    const first = await getTraitQuantileTables(db)
    expect(first.rhythmicStrength).toBeUndefined()
    for (let i = 0; i < 20; i++) {
      setStemFeatureCache(
        db,
        `/lib/cid-${i}`,
        {
          ...fakeFeatures(),
          rhythmicStrength: i / 20,
          spectralCentroidFftHz: 2000,
          featureVersion: 2
        },
        2000
      )
    }
    const rebuilt = await getTraitQuantileTables(db)
    expect(rebuilt).not.toBe(first)
    expect(rebuilt.rhythmicStrength).toBeDefined()
  })
})
