import { describe, it, expect } from 'vitest'
import {
  QUANTILE_BREAKPOINTS,
  buildQuantileTable,
  percentileOf,
  traitPercentilesFromValues,
  TRAIT_FIELDS
} from './traitQuantiles'

function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i)
}

describe('buildQuantileTable', () => {
  it('returns null for an empty input or one with no finite values', () => {
    expect(buildQuantileTable([])).toBeNull()
    expect(buildQuantileTable([Number.NaN, Infinity, -Infinity])).toBeNull()
  })

  it('has 101 breakpoints, index i = the value at the i-th percentile', () => {
    const table = buildQuantileTable(range(101))!
    expect(table).toHaveLength(QUANTILE_BREAKPOINTS)
    expect(table[0]).toBe(0)
    expect(table[50]).toBe(50)
    expect(table[100]).toBe(100)
  })

  it('interpolates between sorted values and ignores input order and non-finite values', () => {
    const table = buildQuantileTable([10, Number.NaN, 0, Infinity])!
    expect(table[0]).toBe(0)
    expect(table[50]).toBeCloseTo(5)
    expect(table[100]).toBe(10)
  })

  it('a single value gives a flat table', () => {
    const table = buildQuantileTable([7])!
    expect(table.every((v) => v === 7)).toBe(true)
  })

  it('is non-decreasing', () => {
    const values = Array.from({ length: 500 }, () => Math.random() * 1000)
    const table = buildQuantileTable(values)!
    for (let i = 1; i < table.length; i++) expect(table[i]).toBeGreaterThanOrEqual(table[i - 1])
  })
})

describe('percentileOf', () => {
  const table = buildQuantileTable(range(101))!

  it('returns null for a missing/empty table or a null/non-finite value', () => {
    expect(percentileOf(null, 5)).toBeNull()
    expect(percentileOf(undefined, 5)).toBeNull()
    expect(percentileOf([], 5)).toBeNull()
    expect(percentileOf(table, null)).toBeNull()
    expect(percentileOf(table, undefined)).toBeNull()
    expect(percentileOf(table, Number.NaN)).toBeNull()
  })

  it('maps exact breakpoints and interpolates between them', () => {
    expect(percentileOf(table, 0)).toBe(0)
    expect(percentileOf(table, 40)).toBeCloseTo(0.4)
    expect(percentileOf(table, 40.5)).toBeCloseTo(0.405)
    expect(percentileOf(table, 100)).toBe(1)
  })

  it('clamps outside the table range', () => {
    expect(percentileOf(table, -50)).toBe(0)
    expect(percentileOf(table, 1e9)).toBe(1)
  })

  it('a value sitting on a run of duplicate breakpoints gets the middle of that run', () => {
    // 31 zeros then 70 values 1..70: breakpoints 0..30 are all 0.
    const dupTable = buildQuantileTable([...Array(31).fill(0), ...range(70).map((i) => i + 1)])!
    expect(dupTable[30]).toBe(0)
    expect(dupTable[31]).toBeGreaterThan(0)
    expect(percentileOf(dupTable, 0)).toBeCloseTo(0.15)
  })

  it('is monotone non-decreasing across a table with duplicate runs', () => {
    const dupTable = buildQuantileTable([
      ...Array(40).fill(0),
      ...Array(20).fill(5),
      ...range(41).map((i) => 5 + i)
    ])!
    let prev = -1
    for (let v = -1; v <= 50; v += 0.25) {
      const p = percentileOf(dupTable, v)!
      expect(p).toBeGreaterThanOrEqual(prev)
      expect(p).toBeGreaterThanOrEqual(0)
      expect(p).toBeLessThanOrEqual(1)
      prev = p
    }
  })

  it('a flat table maps its own value to 0.5, below to 0, above to 1', () => {
    const flat = buildQuantileTable([3])!
    expect(percentileOf(flat, 3)).toBeCloseTo(0.5)
    expect(percentileOf(flat, 2)).toBe(0)
    expect(percentileOf(flat, 4)).toBe(1)
  })
})

describe('traitPercentilesFromValues', () => {
  const tables = {
    bassEnergyRatio: buildQuantileTable(range(101).map((i) => i / 100))!,
    transientDensity: buildQuantileTable(range(101).map((i) => i / 100))!,
    spectralCentroidHz: buildQuantileTable(range(101).map((i) => i * 100))!
  }

  it('maps each present trait through its field table, direction-adjusted', () => {
    const p = traitPercentilesFromValues({ bassHeavy: 0.8, bright: 9000, warm: 9000 }, tables)
    expect(p.bassHeavy).toBeCloseTo(0.8)
    expect(p.bright).toBeCloseTo(0.9)
    // warm wants a LOW centroid: 1 - percentile
    expect(p.warm).toBeCloseTo(0.1)
  })

  it('only returns kinds present in the values; null value or missing table -> null', () => {
    const p = traitPercentilesFromValues(
      { rhythmic: null, bassHeavy: 0.5 },
      { spectralCentroidHz: tables.spectralCentroidHz }
    )
    expect(p).toEqual({ rhythmic: null, bassHeavy: null })
  })

  it('empty values -> {}', () => {
    expect(traitPercentilesFromValues({}, tables)).toEqual({})
  })
})

describe('traitPercentilesFromValues -- preferred field with fallback (Phase 3)', () => {
  // Deliberately different scales per field, so a lookup in the wrong
  // table would give a visibly wrong percentile.
  const tables = {
    transientDensity: buildQuantileTable(range(101).map((i) => i / 10))!, // 0..10
    rhythmicStrength: buildQuantileTable(range(101).map((i) => i / 100))!, // 0..1
    spectralCentroidHz: buildQuantileTable(range(101).map((i) => i * 100))!, // 0..10000
    spectralCentroidFftHz: buildQuantileTable(range(101).map((i) => i * 200))! // 0..20000
  }

  it('TRAIT_FIELDS lists all five fields', () => {
    expect([...TRAIT_FIELDS].sort()).toEqual([
      'bassEnergyRatio',
      'rhythmicStrength',
      'spectralCentroidFftHz',
      'spectralCentroidHz',
      'transientDensity'
    ])
  })

  it("a stem with the preferred field is placed by the preferred field's table", () => {
    const p = traitPercentilesFromValues({ rhythmic: 0.9, warm: 4000 }, tables, {
      rhythmicStrength: 0.9,
      transientDensity: 1,
      spectralCentroidFftHz: 4000,
      spectralCentroidHz: 9000
    })
    expect(p.rhythmic).toBeCloseTo(0.9)
    expect(p.warm).toBeCloseTo(0.8) // 1 - 0.2
  })

  it("a stem without it is placed by the fallback field's table", () => {
    const p = traitPercentilesFromValues({ rhythmic: 3 }, tables, {
      rhythmicStrength: null,
      transientDensity: 3
    })
    expect(p.rhythmic).toBeCloseTo(0.3)
  })

  it('mid-rescan, before the preferred field has a table, the fallback table is used', () => {
    const { rhythmicStrength: _omit, ...noPreferred } = tables
    void _omit
    const p = traitPercentilesFromValues({ rhythmic: 0.9 }, noPreferred, {
      rhythmicStrength: 0.9,
      transientDensity: 3
    })
    expect(p.rhythmic).toBeCloseTo(0.3)
  })

  it('without field values, the value is read against the fallback table (legacy callers)', () => {
    expect(traitPercentilesFromValues({ rhythmic: 3 }, tables).rhythmic).toBeCloseTo(0.3)
  })
})
