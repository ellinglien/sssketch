import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { percentileOf } from '@shared/traitQuantiles'
import { getTraitQuantileTables, TRAIT_QUANTILE_PAGE_SIZE } from './traitQuantileCache'

function freshDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE StemFeatureCache (
      StemCID TEXT PRIMARY KEY, FeaturesJSON TEXT NOT NULL, ExtractedAt INTEGER NOT NULL
    );
  `)
  return db
}

function insert(db: Database.Database, from: number, to: number): void {
  const stmt = db.prepare(
    `INSERT INTO StemFeatureCache (StemCID, FeaturesJSON, ExtractedAt) VALUES (?, ?, 0)`
  )
  for (let i = from; i < to; i++) {
    stmt.run(
      `stem${String(i).padStart(6, '0')}`,
      JSON.stringify({
        transientDensity: i,
        bassEnergyRatio: i / 1000,
        spectralCentroidHz: i * 10,
        zcrBrightness: 0,
        voicedFraction: 0,
        pitchVarianceCents: 0,
        mfcc: []
      })
    )
  }
}

describe('getTraitQuantileTables', () => {
  it('builds one table per trait field over ALL rows, across several pages', async () => {
    const db = freshDb()
    const n = TRAIT_QUANTILE_PAGE_SIZE * 2 + 17
    insert(db, 0, n)
    const tables = await getTraitQuantileTables(db)
    expect(tables.transientDensity![0]).toBe(0)
    expect(tables.transientDensity![100]).toBe(n - 1)
    expect(tables.spectralCentroidHz![100]).toBe((n - 1) * 10)
    expect(tables.bassEnergyRatio![100]).toBeCloseTo((n - 1) / 1000)
    expect(percentileOf(tables.transientDensity, (n - 1) / 2)).toBeCloseTo(0.5)
  })

  it('skips malformed rows and non-numeric fields', async () => {
    const db = freshDb()
    insert(db, 0, 10)
    db.prepare(`INSERT INTO StemFeatureCache VALUES ('bad', 'not json', 0)`).run()
    db.prepare(
      `INSERT INTO StemFeatureCache VALUES ('partial', '{"transientDensity":"x"}', 0)`
    ).run()
    const tables = await getTraitQuantileTables(db)
    expect(tables.transientDensity![100]).toBe(9)
  })

  it('empty table -> no tables', async () => {
    expect(await getTraitQuantileTables(freshDb())).toEqual({})
  })

  it('a missing StemFeatureCache table -> no tables, never throws', async () => {
    expect(await getTraitQuantileTables(new Database(':memory:'))).toEqual({})
  })

  it('caches per db and only rebuilds once the row count grew >= 5%', async () => {
    const db = freshDb()
    insert(db, 0, 100)
    const first = await getTraitQuantileTables(db)
    insert(db, 100, 104) // +4%
    expect(await getTraitQuantileTables(db)).toBe(first)
    insert(db, 104, 105) // +5%
    const rebuilt = await getTraitQuantileTables(db)
    expect(rebuilt).not.toBe(first)
    expect(rebuilt.transientDensity![100]).toBe(104)
  })

  it('concurrent callers share one in-flight build', async () => {
    const db = freshDb()
    insert(db, 0, 50)
    const [a, b] = await Promise.all([getTraitQuantileTables(db), getTraitQuantileTables(db)])
    expect(a).toBe(b)
  })
})
