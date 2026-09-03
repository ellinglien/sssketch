import { describe, expect, it } from 'vitest'
import { computeDensityScore, computeFillScore, densityLabel } from './stemDensityScore'
import type { StemFeatures } from './stemFeatures'

function features(overrides: Partial<StemFeatures>): StemFeatures {
  return {
    transientDensity: 0,
    bassEnergyRatio: 0,
    spectralCentroidHz: 1000,
    zcrBrightness: 0,
    voicedFraction: 0,
    pitchVarianceCents: 0,
    mfcc: new Array(13).fill(0),
    ...overrides
  }
}

describe('computeDensityScore', () => {
  it('scores silence/no-transients material near zero', () => {
    const score = computeDensityScore(features({ transientDensity: 0, bassEnergyRatio: 0 }))
    expect(score).toBeCloseTo(0, 5)
  })

  it('saturates high transient density instead of exceeding 1', () => {
    const busy = computeDensityScore(features({ transientDensity: 20, bassEnergyRatio: 1 }))
    expect(busy).toBeGreaterThan(0)
    expect(busy).toBeLessThanOrEqual(1)
  })

  it('weights transient density more than bass energy ratio', () => {
    const transientHeavy = computeDensityScore(
      features({ transientDensity: 8, bassEnergyRatio: 0 })
    )
    const bassHeavy = computeDensityScore(features({ transientDensity: 0, bassEnergyRatio: 1 }))
    expect(transientHeavy).toBeGreaterThan(bassHeavy)
  })

  it('4 attacks/sec (the half-saturation point) scores around the midpoint of the transient term', () => {
    // normalizeTransientDensity(4) === 0.5 exactly, weighted 0.7 in the total score
    const score = computeDensityScore(features({ transientDensity: 4, bassEnergyRatio: 0 }))
    expect(score).toBeCloseTo(0.5 * 0.7, 5)
  })
})

describe('densityLabel', () => {
  it('labels below 0.33 as sparse', () => {
    expect(densityLabel(0)).toBe('sparse')
    expect(densityLabel(0.32)).toBe('sparse')
  })

  it('labels 0.33 to 0.66 as steady', () => {
    expect(densityLabel(0.33)).toBe('steady')
    expect(densityLabel(0.65)).toBe('steady')
  })

  it('labels 0.66 and above as dense', () => {
    expect(densityLabel(0.66)).toBe('dense')
    expect(densityLabel(1)).toBe('dense')
  })
})

describe('computeFillScore', () => {
  it('favors bright, transient-dense material over sustained low material', () => {
    const percussive = computeFillScore(features({ zcrBrightness: 0.9, transientDensity: 10 }))
    const pad = computeFillScore(features({ zcrBrightness: 0.1, transientDensity: 0.2 }))
    expect(percussive).toBeGreaterThan(pad)
  })

  it('stays within [0,1]', () => {
    const score = computeFillScore(features({ zcrBrightness: 1, transientDensity: 100 }))
    expect(score).toBeLessThanOrEqual(1)
    expect(score).toBeGreaterThanOrEqual(0)
  })
})
