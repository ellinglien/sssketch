import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { percentileOf } from '@shared/traitQuantiles'
import { traitFieldValuesFromFeatures, traitValuesFromFeatures } from '@shared/discoverTraits'
import type { DiscoverTraitKind } from '@shared/discoverSlotKind'
import type { StemFeatures } from '@shared/stemFeatures'
import {
  getTraitQuantileTables,
  getTraitValueTable,
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

describe('trait value table (B1)', () => {
  const ALL_KINDS: DiscoverTraitKind[] = ['bassHeavy', 'rhythmic', 'bright', 'warm']

  function seedMixed(db: Database.Database): Record<string, string> {
    const rows: Record<string, string> = {
      old: JSON.stringify({ transientDensity: 3, bassEnergyRatio: 0.2, spectralCentroidHz: 900 }),
      v2: JSON.stringify({
        transientDensity: 4,
        bassEnergyRatio: 0.7,
        spectralCentroidHz: 1500,
        rhythmicStrength: 0.4,
        spectralCentroidFftHz: 1700,
        featureVersion: 2
      }),
      partial: '{"transientDensity":"x","bassEnergyRatio":null}',
      bad: 'not json',
      nulljson: 'null'
    }
    const stmt = db.prepare(`INSERT INTO StemFeatureCache VALUES (?, ?, 0)`)
    for (const [cid, json] of Object.entries(rows)) stmt.run(cid, json)
    return rows
  }

  it('is null until the quantile build has run', () => {
    const db = freshDb()
    insert(db, 0, 5)
    expect(getTraitValueTable(db)).toBeNull()
  })

  it('holds exactly the JSON-parsed trait values for every parseable row', async () => {
    const db = freshDb()
    insert(db, 0, TRAIT_QUANTILE_PAGE_SIZE + 3)
    const rows = seedMixed(db)
    await getTraitQuantileTables(db)
    const table = getTraitValueTable(db)!
    expect(table).not.toBeNull()

    const all = db.prepare(`SELECT StemCID, FeaturesJSON FROM StemFeatureCache`).all() as {
      StemCID: string
      FeaturesJSON: string
    }[]
    for (const { StemCID, FeaturesJSON } of all) {
      let parsed: StemFeatures | null = null
      try {
        parsed = JSON.parse(FeaturesJSON) as StemFeatures
      } catch {
        parsed = null
      }
      const row = table.rowOf(StemCID)
      if (!parsed) {
        expect(row).toBeUndefined()
        continue
      }
      expect(row).toBeDefined()
      const fromTable = table.features(row!)
      for (const kinds of [...ALL_KINDS.map((k) => [k]), ALL_KINDS]) {
        expect(traitValuesFromFeatures(fromTable, kinds)).toEqual(
          traitValuesFromFeatures(parsed, kinds)
        )
        expect(traitFieldValuesFromFeatures(fromTable, kinds)).toEqual(
          traitFieldValuesFromFeatures(parsed, kinds)
        )
      }
    }
    expect(Object.keys(rows)).toContain('bad')
  })

  it('stays current through noteStemFeatureRowWritten (new and rewritten rows)', async () => {
    const db = freshDb()
    insert(db, 0, 10)
    await getTraitQuantileTables(db)
    const upsert = db.prepare(
      `INSERT INTO StemFeatureCache VALUES (?, ?, 0)
       ON CONFLICT(StemCID) DO UPDATE SET FeaturesJSON = excluded.FeaturesJSON`
    )
    const write = (cid: string, features: Record<string, unknown>): void => {
      upsert.run(cid, JSON.stringify(features))
      noteStemFeatureRowWritten(db, features as unknown as StemFeatures, cid)
    }
    write('fresh', { transientDensity: 42, bassEnergyRatio: 0.5, spectralCentroidHz: 10 })
    write('stem000003', { transientDensity: 7, rhythmicStrength: 0.9, featureVersion: 2 })

    const table = getTraitValueTable(db)!
    expect(table).not.toBeNull()
    expect(traitValuesFromFeatures(table.features(table.rowOf('fresh')!), ['rhythmic'])).toEqual({
      rhythmic: 42
    })
    expect(
      traitValuesFromFeatures(table.features(table.rowOf('stem000003')!), ['rhythmic', 'bassHeavy'])
    ).toEqual({ rhythmic: 0.9, bassHeavy: null })
  })

  it('a row written behind its back (count moved, no note) makes the table unusable, not wrong', async () => {
    const db = freshDb()
    insert(db, 0, 10)
    await getTraitQuantileTables(db)
    insert(db, 10, 11)
    expect(getTraitValueTable(db)).toBeNull()
  })

  it('a write noted without a StemCID drops the table (callers fall back)', async () => {
    const db = freshDb()
    insert(db, 0, 10)
    await getTraitQuantileTables(db)
    noteStemFeatureRowWritten(db, { transientDensity: 1 } as unknown as StemFeatures)
    expect(getTraitValueTable(db)).toBeNull()
  })

  it('a write that lands while the build is in flight is applied once the build finishes', async () => {
    const db = freshDb()
    insert(db, 0, TRAIT_QUANTILE_PAGE_SIZE + 5)
    const building = getTraitQuantileTables(db)
    // The build yields after its first page -- this write lands mid-build,
    // on a StemCID the build has already read past.
    await new Promise((resolve) => setImmediate(resolve))
    const features = { transientDensity: 999, bassEnergyRatio: 0.1, spectralCentroidHz: 1 }
    db.prepare(`UPDATE StemFeatureCache SET FeaturesJSON = ? WHERE StemCID = ?`).run(
      JSON.stringify(features),
      'stem000000'
    )
    noteStemFeatureRowWritten(db, features as unknown as StemFeatures, 'stem000000')
    await building
    const table = getTraitValueTable(db)!
    expect(table).not.toBeNull()
    expect(
      traitValuesFromFeatures(table.features(table.rowOf('stem000000')!), ['rhythmic'])
    ).toEqual({ rhythmic: 999 })
  })
})
