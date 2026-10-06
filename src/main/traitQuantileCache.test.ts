import { describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { percentileOf } from '@shared/traitQuantiles'
import { traitFieldValuesFromFeatures, traitValuesFromFeatures } from '@shared/discoverTraits'
import type { DiscoverTraitKind } from '@shared/discoverSlotKind'
import type { StemFeatures } from '@shared/stemFeatures'
import {
  awaitTraitQuantileBuild,
  getTraitQuantileBuildInfo,
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
    // Inserted behind the value table's back, so this rebuild re-reads SQL --
    // in the background, serving the existing tables meanwhile (audit item 4).
    expect(await getTraitQuantileTables(db)).toBe(first)
    await awaitTraitQuantileBuild(db)
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
        const stemCID = `stem${String(i).padStart(6, '0')}`
        stmt.run(JSON.stringify(features), stemCID)
        // With its StemCID, as the stores note it (so the value table stays
        // current and the rebuild comes from memory).
        if (note) noteStemFeatureRowWritten(db, features, stemCID)
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

describe('the level fields (spec 2026-10-05-radio-intensity-arc-design 2.1)', () => {
  function insertLevelled(db: Database.Database, from: number, to: number): void {
    const stmt = db.prepare(
      `INSERT INTO StemFeatureCache (StemCID, FeaturesJSON, ExtractedAt) VALUES (?, ?, 0)`
    )
    for (let i = from; i < to; i++) {
      stmt.run(
        `lvl${String(i).padStart(6, '0')}`,
        JSON.stringify({
          transientDensity: i,
          bassEnergyRatio: 0.1,
          spectralCentroidHz: 100,
          mfcc: [],
          loudnessLufs: -30 + (i % 20),
          lowLevelDb: -40 + (i % 30),
          activeFraction: (i % 10) / 10,
          levelVersion: 1
        })
      )
    }
  }

  it('get tables beside the trait fields once PREFERRED_TABLE_MIN_ROWS carry them', async () => {
    const db = freshDb()
    insert(db, 0, 1000)
    insertLevelled(db, 0, PREFERRED_TABLE_MIN_ROWS - 1)
    expect((await getTraitQuantileTables(db)).loudnessLufs).toBeUndefined()
    const more = freshDb()
    insert(more, 0, 1000)
    insertLevelled(more, 0, PREFERRED_TABLE_MIN_ROWS)
    const tables = await getTraitQuantileTables(more)
    for (const f of ['loudnessLufs', 'lowLevelDb', 'activeFraction'] as const) {
      expect(tables[f], f).toBeDefined()
    }
    expect(percentileOf(tables.loudnessLufs, -30)).toBeLessThan(0.1)
    expect(tables.transientDensity).toBeDefined()
  })

  it('the value table carries them, and a merged write updates them', async () => {
    const db = freshDb()
    insert(db, 0, 10)
    await getTraitQuantileTables(db)
    const table = getTraitValueTable(db)!
    const row = table.rowOf('stem000003')!
    expect(
      Number.isNaN((table.features(row) as unknown as { loudnessLufs: number }).loudnessLufs)
    ).toBe(true)
    noteStemFeatureRowWritten(
      db,
      {
        transientDensity: 3,
        loudnessLufs: -12,
        lowLevelDb: -20,
        activeFraction: 1
      } as StemFeatures,
      'stem000003'
    )
    expect(table.features(row)).toMatchObject({
      loudnessLufs: -12,
      lowLevelDb: -20,
      activeFraction: 1
    })
  })
})

// Background scan audit item 4 (2026-10-05): while the value table accounts
// for every row, a rebuild sorts its columns instead of re-parsing every
// FeaturesJSON (88.7 MB on Elling's library, ~20 times over the level
// backfill, each awaited inside a radio pick).
describe('rebuilding from the in-memory value table (audit item 4)', () => {
  /** Deterministic PRNG, so a failure reproduces. */
  function prng(seed: number): () => number {
    let x = seed
    return () => {
      x = (x * 1103515245 + 12345) % 2147483648
      return x / 2147483648
    }
  }

  const upsertSql = `INSERT INTO StemFeatureCache (StemCID, FeaturesJSON, ExtractedAt) VALUES (?, ?, 0)
     ON CONFLICT(StemCID) DO UPDATE SET FeaturesJSON = excluded.FeaturesJSON`

  /** What stemFeatureCacheStore.ts does: JSON.stringify into the row, then
   * the in-memory note with the same object. */
  function write(db: Database.Database, stemCID: string, features: Record<string, unknown>): void {
    db.prepare(upsertSql).run(stemCID, JSON.stringify(features))
    noteStemFeatureRowWritten(db, features as unknown as StemFeatures, stemCID)
  }

  /** A row the way an analysis pass would produce it, with the awkward
   * values: -0, NaN, Infinity (JSON writes null), missing fields, and the
   * Phase 3 and level fields on some rows only. */
  function features(rand: () => number): Record<string, unknown> {
    const pick = (): number => {
      const r = rand()
      if (r < 0.03) return -0
      if (r < 0.05) return NaN
      if (r < 0.06) return Infinity
      if (r < 0.1) return 0
      return Math.round(rand() * 1e6) / 1e3 - 200
    }
    const out: Record<string, unknown> = {
      transientDensity: pick(),
      bassEnergyRatio: pick(),
      spectralCentroidHz: pick(),
      zcrBrightness: pick(),
      voicedFraction: 0,
      pitchVarianceCents: 0,
      mfcc: []
    }
    if (rand() < 0.6) {
      out.spectralCentroidFftHz = pick()
      out.onsetRegularity = pick()
      out.rhythmicStrength = pick()
      out.featureVersion = 2
    }
    if (rand() < 0.5) {
      out.loudnessLufs = pick()
      out.lowLevelDb = pick()
      out.activeFraction = pick()
      out.levelVersion = 1
    }
    if (rand() < 0.05) delete out.transientDensity
    return out
  }

  function seedAwkward(db: Database.Database, rand: () => number, n: number): void {
    const stmt = db.prepare(`INSERT INTO StemFeatureCache VALUES (?, ?, 0)`)
    for (let i = 0; i < n; i++) {
      stmt.run(`s${String(i).padStart(6, '0')}`, JSON.stringify(features(rand)))
    }
    for (const [cid, json] of [
      ['bad', 'not json'],
      ['nulljson', 'null'],
      ['number', '5'],
      ['string', '"str"'],
      ['truthy', 'true'],
      ['array', '[1, 2]'],
      ['partial', '{"transientDensity":"x","bassEnergyRatio":null}'],
      ['negzero', '{"transientDensity":-0,"bassEnergyRatio":0.5,"spectralCentroidHz":-0}']
    ]) {
      stmt.run(cid, json)
    }
  }

  function featureJsonReads(db: Database.Database): () => number {
    const spy = vi.spyOn(db, 'prepare')
    return () => spy.mock.calls.filter(([sql]) => String(sql).includes('FeaturesJSON FROM')).length
  }

  it('gives exactly the tables a full DB rebuild gives, round after round, without reading FeaturesJSON', async () => {
    const rand = prng(7)
    const db = freshDb()
    seedAwkward(db, rand, 3000)
    let previous = await getTraitQuantileTables(db) // first build: from SQL
    expect(getTraitQuantileBuildInfo(db)).toEqual(getTraitQuantileBuildInfo(db))

    for (let round = 0; round < 6; round++) {
      // New rows, rewrites (a level merge, a re-extraction), and rewrites
      // of the malformed / non-object rows into real ones.
      for (let i = 0; i < 200; i++) write(db, `new${round}-${i}`, features(rand))
      for (let i = 0; i < 150; i++) {
        const cid = `s${String(Math.floor(rand() * 3000)).padStart(6, '0')}`
        write(db, cid, features(rand))
      }
      if (round === 2) {
        write(db, 'bad', features(rand))
        write(db, 'number', features(rand))
        write(db, 'array', features(rand))
      }
      const reads = featureJsonReads(db)
      const fromMemory = await getTraitQuantileTables(db)
      expect(fromMemory).not.toBe(previous) // it did rebuild
      expect(reads()).toBe(0)
      expect(getTraitValueTable(db)).not.toBeNull()

      const copy = freshCopy(db)
      const fromSql = await getTraitQuantileTables(copy)
      expect(fromMemory).toEqual(fromSql)
      expect(Object.keys(fromMemory).sort()).toEqual(Object.keys(fromSql).sort())
      for (const field of Object.keys(fromSql) as (keyof typeof fromSql)[]) {
        fromSql[field]!.forEach((v, i) => expect(Object.is(fromMemory[field]![i], v)).toBe(true))
      }
      expect(getTraitQuantileBuildInfo(db)).toEqual(getTraitQuantileBuildInfo(copy))
      previous = fromMemory
    }
  })

  it('counts parsed rows as the DB build does: a non-object row is not one (the half-the-rows rule)', async () => {
    // 40 object rows, 21 carrying rhythmicStrength: a preferred table needs
    // ceil(40 / 2) = 20 of them. Non-object rows ('5', '"x"', 'true') must
    // not raise that bar; an array parses to an object and does count.
    const db = freshDb()
    insert(db, 0, 1)
    await getTraitQuantileTables(db)
    for (let i = 0; i < 39; i++) {
      write(db, `obj${i}`, {
        transientDensity: i,
        bassEnergyRatio: 0.1,
        spectralCentroidHz: 100,
        ...(i < 21 ? { rhythmicStrength: i / 100, featureVersion: 2 } : {})
      })
    }
    for (const [cid, json] of [
      ['number', '5'],
      ['string', '"x"'],
      ['truthy', 'true']
    ]) {
      db.prepare(upsertSql).run(cid, json)
      noteStemFeatureRowWritten(db, JSON.parse(json) as StemFeatures, cid)
    }
    const reads = featureJsonReads(db)
    const fromMemory = await getTraitQuantileTables(db)
    expect(reads()).toBe(0)
    const fromSql = await getTraitQuantileTables(freshCopy(db))
    expect(fromSql.rhythmicStrength).toBeDefined()
    expect(fromMemory).toEqual(fromSql)

    // And a non-object row rewritten into a real one counts again.
    write(db, 'number', { transientDensity: 1, bassEnergyRatio: 0.1, spectralCentroidHz: 1 })
    expect(getTraitValueTable(db)).not.toBeNull()
  })

  it('a level-only merge (the backfill) rebuilds from memory once 5% of rows gained the fields', async () => {
    const db = freshDb()
    insert(db, 0, 1000)
    const first = await getTraitQuantileTables(db)
    const reads = featureJsonReads(db)
    const merge = (i: number): void => {
      const cid = `stem${String(i).padStart(6, '0')}`
      const row = db
        .prepare(`SELECT FeaturesJSON FROM StemFeatureCache WHERE StemCID = ?`)
        .get(cid) as { FeaturesJSON: string }
      const merged = {
        ...JSON.parse(row.FeaturesJSON),
        loudnessLufs: -20 - (i % 7),
        lowLevelDb: -30,
        activeFraction: 0.5,
        levelVersion: 1,
        spectralCentroidFftHz: i,
        rhythmicStrength: 0.1,
        onsetRegularity: 0.2,
        featureVersion: 2
      }
      db.prepare(`UPDATE StemFeatureCache SET FeaturesJSON = ? WHERE StemCID = ?`).run(
        JSON.stringify(merged),
        cid
      )
      noteStemFeatureRowWritten(db, merged as StemFeatures, cid)
    }
    for (let i = 0; i < 49; i++) merge(i)
    expect(await getTraitQuantileTables(db)).toBe(first)
    merge(49)
    const rebuilt = await getTraitQuantileTables(db)
    expect(rebuilt).not.toBe(first)
    expect(rebuilt).toEqual(await getTraitQuantileTables(freshCopy(db)))
    // Only merge()'s own single-row reads, never the build's page read.
    expect(reads()).toBe(50)
  })

  it('falls back to the DB rebuild when the value table no longer accounts for every row -- the same result', async () => {
    const db = freshDb()
    insert(db, 0, 100)
    const first = await getTraitQuantileTables(db)
    insert(db, 100, 110) // behind its back: no note
    expect(getTraitValueTable(db)).toBeNull()
    const reads = featureJsonReads(db)
    // An existing table is served while the DB rebuild runs: a pick never
    // waits on a full re-parse.
    expect(await getTraitQuantileTables(db)).toBe(first)
    await awaitTraitQuantileBuild(db)
    expect(reads()).toBeGreaterThan(0)
    const rebuilt = await getTraitQuantileTables(db)
    expect(rebuilt).not.toBe(first)
    expect(rebuilt).toEqual(await getTraitQuantileTables(freshCopy(db)))
    expect(getTraitValueTable(db)).not.toBeNull() // and the value table is current again
  })

  it('the very first build is still awaited (there is nothing to serve before it)', async () => {
    const db = freshDb()
    insert(db, 0, 10)
    expect((await getTraitQuantileTables(db)).transientDensity![100]).toBe(9)
  })
})

// Background scan audit 4(b): the value table carries each row's feature and
// level versions, so the analysis needs read them without parsing FeaturesJSON.
describe('versionsOf (audit 4(b))', () => {
  function add(db: Database.Database, stemCID: string, json: string): void {
    db.prepare(`INSERT INTO StemFeatureCache VALUES (?, ?, 0)`).run(stemCID, json)
  }

  it("after a build: the JSON path's versions, malformed rows marked, missing rows undefined", async () => {
    const db = freshDb()
    add(db, 'current', JSON.stringify({ featureVersion: 2, levelVersion: 1 }))
    add(db, 'no-level', JSON.stringify({ featureVersion: 2 }))
    add(db, 'v1', JSON.stringify({ mfcc: [] }))
    add(db, 'bad', '{not json')
    add(db, 'null', 'null')
    add(db, 'number', '5')
    add(db, 'negative', JSON.stringify({ featureVersion: -3, levelVersion: -1 }))
    add(db, 'fraction', JSON.stringify({ featureVersion: 2.5, levelVersion: 0.5 }))
    add(db, 'huge', JSON.stringify({ featureVersion: 1e9 }))
    await getTraitQuantileTables(db)
    const table = getTraitValueTable(db)!
    expect(table.versionsOf('current')).toEqual({ feature: 2, level: 1 })
    expect(table.versionsOf('no-level')).toEqual({ feature: 2, level: 0 })
    expect(table.versionsOf('v1')).toEqual({ feature: 1, level: 0 })
    expect(table.versionsOf('bad')).toBe('malformed')
    expect(table.versionsOf('null')).toBe('malformed')
    expect(table.versionsOf('number')).toEqual({ feature: 1, level: 0 })
    // clamped to [0, 65535] and floored: every comparison with an integer
    // version still answers as the JSON's own number would
    expect(table.versionsOf('negative')).toEqual({ feature: 0, level: 0 })
    expect(table.versionsOf('fraction')).toEqual({ feature: 2, level: 0 })
    expect(table.versionsOf('huge')).toEqual({ feature: 65535, level: 0 })
    expect(table.versionsOf('missing')).toBeUndefined()
  })

  it('follows applyWrite: a new row, a re-extraction, a malformed row written over', async () => {
    const db = freshDb()
    add(db, 'old', JSON.stringify({ mfcc: [] }))
    add(db, 'bad', '{not json')
    await getTraitQuantileTables(db)
    const table = getTraitValueTable(db)!
    noteStemFeatureRowWritten(db, { featureVersion: 2, levelVersion: 1 } as StemFeatures, 'new')
    noteStemFeatureRowWritten(db, { featureVersion: 2 } as StemFeatures, 'old')
    noteStemFeatureRowWritten(db, { featureVersion: 2, levelVersion: 1 } as StemFeatures, 'bad')
    expect(table.versionsOf('new')).toEqual({ feature: 2, level: 1 })
    expect(table.versionsOf('old')).toEqual({ feature: 2, level: 0 })
    expect(table.versionsOf('bad')).toEqual({ feature: 2, level: 1 })
  })

  it('a falsy write to a new stem is malformed, as the build would read it, and still counted', async () => {
    const db = freshDb()
    add(db, 'row', JSON.stringify({ featureVersion: 2, levelVersion: 1 }))
    await getTraitQuantileTables(db)
    const table = getTraitValueTable(db)!
    add(db, 'nothing', 'null')
    table.applyWrite('nothing', null)
    expect(table.versionsOf('nothing')).toBe('malformed')
    const seen: string[] = []
    table.forEachVersions((stemCID, versions) => {
      if (versions === 'malformed') seen.push(stemCID)
    })
    expect(seen).toEqual(['nothing'])
    expect(getTraitValueTable(db)).toBe(table) // rowsSeen still matches the db's count
    // and a later real write over it is a row again, counted once
    table.applyWrite('nothing', { featureVersion: 2, levelVersion: 1 })
    expect(table.versionsOf('nothing')).toEqual({ feature: 2, level: 1 })
    expect(getTraitValueTable(db)).toBe(table)
  })

  it('follows a level merge (the backfill) without touching the feature version', async () => {
    const db = freshDb()
    add(db, 'row', JSON.stringify({ featureVersion: 2, transientDensity: 4 }))
    await getTraitQuantileTables(db)
    const table = getTraitValueTable(db)!
    expect(table.versionsOf('row')).toEqual({ feature: 2, level: 0 })
    noteStemFeatureRowWritten(
      db,
      {
        featureVersion: 2,
        transientDensity: 4,
        loudnessLufs: -12,
        lowLevelDb: -20,
        activeFraction: 1,
        levelVersion: 1
      } as StemFeatures,
      'row'
    )
    expect(table.versionsOf('row')).toEqual({ feature: 2, level: 1 })
  })

  it('a write that lands mid-build carries its versions into the installed table', async () => {
    const db = freshDb()
    insert(db, 0, TRAIT_QUANTILE_PAGE_SIZE + 5)
    const building = getTraitQuantileTables(db)
    noteStemFeatureRowWritten(
      db,
      { featureVersion: 2, levelVersion: 1 } as StemFeatures,
      'stem000001'
    )
    await building
    expect(getTraitValueTable(db)!.versionsOf('stem000001')).toEqual({ feature: 2, level: 1 })
    expect(getTraitValueTable(db)!.versionsOf('stem000002')).toEqual({ feature: 1, level: 0 })
  })
})
