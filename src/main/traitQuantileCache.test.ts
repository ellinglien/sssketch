import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { percentileOf } from '@shared/traitQuantiles'
import {
  getTraitQuantileTables,
  noteStemFeatureRowWritten,
  PREFERRED_TABLE_MIN_ROWS,
  TRAIT_QUANTILE_PAGE_SIZE
} from './traitQuantileCache'

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

/** A new connection over the same rows (the table cache is per db object),
 * via an in-memory backup. */
function freshCopy(db: Database.Database): Database.Database {
  return new Database(db.serialize())
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

  describe('Phase 3 fields', () => {
    function rescan(db: Database.Database, from: number, to: number, note = true): void {
      const stmt = db.prepare(`UPDATE StemFeatureCache SET FeaturesJSON = ? WHERE StemCID = ?`)
      for (let i = from; i < to; i++) {
        const features = {
          transientDensity: i,
          bassEnergyRatio: i / 1000,
          spectralCentroidHz: i * 10,
          zcrBrightness: 0,
          voicedFraction: 0,
          pitchVarianceCents: 0,
          mfcc: [],
          spectralCentroidFftHz: i * 20,
          onsetRegularity: 0.5,
          rhythmicStrength: i / 1000,
          featureVersion: 2
        }
        stmt.run(JSON.stringify(features), `stem${String(i).padStart(6, '0')}`)
        if (note) noteStemFeatureRowWritten(db, features)
      }
    }

    it('builds tables for the new fields once every row has them (small library)', async () => {
      const db = freshDb()
      insert(db, 0, 50)
      rescan(db, 0, 50, false)
      const tables = await getTraitQuantileTables(db)
      expect(tables.rhythmicStrength![100]).toBeCloseTo(49 / 1000)
      expect(tables.spectralCentroidFftHz![100]).toBe(49 * 20)
      expect(tables.transientDensity![100]).toBe(49)
    })

    it("a new field's table waits for min(PREFERRED_TABLE_MIN_ROWS, half the rows) rows -- none from a handful of rescanned stems", async () => {
      const db = freshDb()
      const n = PREFERRED_TABLE_MIN_ROWS * 2
      insert(db, 0, n)
      rescan(db, 0, 10, false)
      const tables = await getTraitQuantileTables(db)
      expect(tables.rhythmicStrength).toBeUndefined()
      expect(tables.spectralCentroidFftHz).toBeUndefined()
      expect(tables.transientDensity).toBeDefined()
    })

    it('a small library gets the new tables once half its rows carry them', async () => {
      const db = freshDb()
      insert(db, 0, 40)
      rescan(db, 0, 19, false)
      expect((await getTraitQuantileTables(freshCopy(db))).rhythmicStrength).toBeUndefined()
      rescan(db, 19, 20, false)
      expect((await getTraitQuantileTables(freshCopy(db))).rhythmicStrength).toBeDefined()
    })

    it('rebuilds once rows with the new fields grew >= 5% (row count unchanged)', async () => {
      const db = freshDb()
      insert(db, 0, 100)
      const first = await getTraitQuantileTables(db)
      rescan(db, 0, 4) // 4 of a 100-row base
      expect(await getTraitQuantileTables(db)).toBe(first)
      rescan(db, 4, 5) // 5%
      const rebuilt = await getTraitQuantileTables(db)
      expect(rebuilt).not.toBe(first)
    })

    it('the growth rule tracks the rescan: after a rebuild, growth is measured from the new count', async () => {
      const db = freshDb()
      insert(db, 0, 100)
      rescan(db, 0, 100, false)
      const first = await getTraitQuantileTables(db) // 100 rows with the new fields
      expect(first.rhythmicStrength).toBeDefined()
      rescan(db, 0, 4) // rewrites count as growth (cheap in-memory counter): 4%
      expect(await getTraitQuantileTables(db)).toBe(first)
      rescan(db, 4, 5)
      expect(await getTraitQuantileTables(db)).not.toBe(first)
    })

    it('writes of old-version rows do not count as new-field growth', async () => {
      const db = freshDb()
      insert(db, 0, 100)
      const first = await getTraitQuantileTables(db)
      for (let i = 0; i < 20; i++) {
        noteStemFeatureRowWritten(db, {
          transientDensity: 0,
          bassEnergyRatio: 0,
          spectralCentroidHz: 0,
          zcrBrightness: 0,
          voicedFraction: 0,
          pitchVarianceCents: 0,
          mfcc: []
        })
      }
      expect(await getTraitQuantileTables(db)).toBe(first)
    })
  })
})
