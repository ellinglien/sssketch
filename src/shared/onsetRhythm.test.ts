import { describe, expect, it } from 'vitest'
import { onsetRegularity, rhythmicStrength, RHYTHMIC_DENSITY_REF } from './onsetRhythm'

describe('onsetRegularity', () => {
  it('fewer than 3 onsets -> 0 (fewer than 2 intervals says nothing about spacing)', () => {
    expect(onsetRegularity([])).toBe(0)
    expect(onsetRegularity([0.5])).toBe(0)
    expect(onsetRegularity([0.5, 1.0])).toBe(0)
  })

  it('perfectly even spacing -> 1', () => {
    expect(onsetRegularity([0, 0.5, 1, 1.5, 2])).toBeCloseTo(1)
  })

  it('is 1 - coefficient of variation of the inter-onset intervals', () => {
    // intervals 1, 3 -> mean 2, population stddev 1 -> CV 0.5
    expect(onsetRegularity([0, 1, 4])).toBeCloseTo(0.5)
  })

  it('clamps to 0 for very uneven spacing (CV > 1)', () => {
    expect(onsetRegularity([0, 0.01, 0.02, 0.03, 10])).toBe(0)
  })

  it('unsorted input is sorted first', () => {
    expect(onsetRegularity([1.5, 0, 1, 0.5])).toBeCloseTo(1)
  })
})

describe('rhythmicStrength', () => {
  it('is min(1, density / RHYTHMIC_DENSITY_REF) * regularity', () => {
    expect(rhythmicStrength(RHYTHMIC_DENSITY_REF / 2, 0.8)).toBeCloseTo(0.4)
    expect(rhythmicStrength(RHYTHMIC_DENSITY_REF * 3, 0.8)).toBeCloseTo(0.8)
  })

  it('0 for no density or no regularity; never NaN for bad input', () => {
    expect(rhythmicStrength(0, 1)).toBe(0)
    expect(rhythmicStrength(5, 0)).toBe(0)
    expect(rhythmicStrength(Number.NaN, 1)).toBe(0)
    expect(rhythmicStrength(-1, 1)).toBe(0)
  })
})
