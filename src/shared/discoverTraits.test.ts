import { describe, expect, it } from 'vitest'
import { traitValuesFromFeatures, stemMatchesSlotKinds } from './discoverTraits'
import type { StemFeatures } from './stemFeatures'

function features(overrides: Partial<StemFeatures> = {}): StemFeatures {
  return {
    transientDensity: 0.4,
    bassEnergyRatio: 0.7,
    spectralCentroidHz: 1200,
    zcrBrightness: 0.3,
    voicedFraction: 0,
    pitchVarianceCents: 0,
    mfcc: new Array(13).fill(0),
    ...overrides
  }
}

describe('traitValuesFromFeatures', () => {
  it('reads each requested trait kind from its own field', () => {
    expect(traitValuesFromFeatures(features(), ['bassHeavy', 'rhythmic', 'warm'])).toEqual({
      bassHeavy: 0.7,
      rhythmic: 0.4,
      warm: 1200
    })
  })

  it('bright and warm read the same field', () => {
    const v = traitValuesFromFeatures(features(), ['bright'])
    expect(v.bright).toBe(1200)
  })

  it('a non-finite field value becomes null, not NaN', () => {
    expect(traitValuesFromFeatures(features({ spectralCentroidHz: Number.NaN }), ['warm'])).toEqual(
      { warm: null }
    )
  })

  it('returns {} for no kinds', () => {
    expect(traitValuesFromFeatures(features(), [])).toEqual({})
  })
})

describe('stemMatchesSlotKinds', () => {
  const both = { endlesss: true, audioIn: true }
  const DRUM = 1 << 1
  const BASS = 1 << 3
  const MIC = 1 << 4

  it('mask kinds OR together', () => {
    expect(stemMatchesSlotKinds(DRUM, ['drums', 'bass'], both)).toBe(true)
    expect(stemMatchesSlotKinds(BASS, ['drums', 'bass'], both)).toBe(true)
    expect(stemMatchesSlotKinds(MIC, ['drums', 'bass'], both)).toBe(false)
  })

  it('a mask kind in the set means nothing matches while endlesss is off', () => {
    expect(stemMatchesSlotKinds(DRUM, ['drums'], { endlesss: false, audioIn: true })).toBe(false)
  })

  it('trait-only sets accept any stem the sound-source filter allows, tagged or not', () => {
    expect(stemMatchesSlotKinds(DRUM, ['warm'], both)).toBe(true)
    expect(stemMatchesSlotKinds(null, ['warm'], both)).toBe(true)
    expect(stemMatchesSlotKinds(MIC, ['warm'], { endlesss: true, audioIn: false })).toBe(false)
  })

  it('mixed sets filter by the mask kinds only', () => {
    expect(stemMatchesSlotKinds(DRUM, ['drums', 'warm'], both)).toBe(true)
    expect(stemMatchesSlotKinds(null, ['drums', 'warm'], both)).toBe(false)
  })
})
