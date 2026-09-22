import { describe, it, expect } from 'vitest'
import {
  toFeatureArray,
  standardizeFeatures,
  isCurrentStemFeatureVersion,
  stemFeatureVersionOf,
  STEM_FEATURE_VERSION,
  type StemFeatures
} from './stemFeatures'

function makeFeatures(overrides: Partial<StemFeatures> = {}): StemFeatures {
  return {
    transientDensity: 0,
    bassEnergyRatio: 0,
    spectralCentroidHz: 0,
    zcrBrightness: 0,
    voicedFraction: 0,
    pitchVarianceCents: 0,
    mfcc: new Array(13).fill(0),
    ...overrides
  }
}

describe('toFeatureArray', () => {
  it('flattens every field into a single array in a fixed order', () => {
    const f = makeFeatures({
      transientDensity: 1,
      bassEnergyRatio: 2,
      spectralCentroidHz: 3,
      zcrBrightness: 4,
      voicedFraction: 5,
      pitchVarianceCents: 6,
      mfcc: [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]
    })
    expect(toFeatureArray(f)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19
    ])
  })
})

describe('toFeatureArray ignores the Phase 3 fields', () => {
  it('output is unchanged (still 19 numbers) when the new optional fields are present', () => {
    const base = makeFeatures({ transientDensity: 1, spectralCentroidHz: 3 })
    const withNew = {
      ...base,
      spectralCentroidFftHz: 5000,
      onsetRegularity: 0.9,
      rhythmicStrength: 0.7,
      featureVersion: STEM_FEATURE_VERSION
    }
    expect(toFeatureArray(withNew)).toEqual(toFeatureArray(base))
    expect(toFeatureArray(withNew)).toHaveLength(19)
  })
})

describe('feature versions', () => {
  it('a row without featureVersion is version 1', () => {
    expect(stemFeatureVersionOf(makeFeatures())).toBe(1)
    expect(isCurrentStemFeatureVersion(makeFeatures())).toBe(false)
  })

  it('a row at (or above) the current version is current', () => {
    expect(
      isCurrentStemFeatureVersion(makeFeatures({ featureVersion: STEM_FEATURE_VERSION }))
    ).toBe(true)
    expect(
      isCurrentStemFeatureVersion(makeFeatures({ featureVersion: STEM_FEATURE_VERSION + 1 }))
    ).toBe(true)
  })

  it('a malformed featureVersion counts as version 1', () => {
    expect(stemFeatureVersionOf({ featureVersion: 'x' } as unknown as StemFeatures)).toBe(1)
  })
})

describe('standardizeFeatures', () => {
  it('z-scores each dimension independently to mean 0, unit variance', () => {
    const vectors = [
      [0, 10],
      [2, 10],
      [4, 10]
    ]
    const result = standardizeFeatures(vectors)
    // Dimension 0 has real spread (0,2,4) -> should end up mean-0, unit-variance.
    const dim0 = result.map((v) => v[0])
    const mean0 = dim0.reduce((s, v) => s + v, 0) / dim0.length
    expect(mean0).toBeCloseTo(0, 10)
    const variance0 = dim0.reduce((s, v) => s + v ** 2, 0) / dim0.length
    expect(variance0).toBeCloseTo(1, 5)
  })

  it('does not divide by zero for a dimension with no spread at all (constant across every stem)', () => {
    const vectors = [
      [5, 1],
      [5, 2],
      [5, 3]
    ]
    const result = standardizeFeatures(vectors)
    // Dimension 0 is identical (5) for every input -- stddev is 0. Must not
    // produce NaN/Infinity; every stem's own value there should just
    // collapse to 0 (no information in a dimension with zero spread).
    for (const v of result) {
      expect(Number.isFinite(v[0])).toBe(true)
      expect(v[0]).toBe(0)
    }
  })

  it('preserves vector count and dimensionality', () => {
    const vectors = [
      [1, 2, 3],
      [4, 5, 6]
    ]
    const result = standardizeFeatures(vectors)
    expect(result).toHaveLength(2)
    expect(result[0]).toHaveLength(3)
  })

  it('returns an empty array for empty input', () => {
    expect(standardizeFeatures([])).toEqual([])
  })
})
