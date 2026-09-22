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

  it('an Endlesss drum stem does NOT match drums while endlesss is off', () => {
    expect(stemMatchesSlotKinds(DRUM, ['drums'], { endlesss: false, audioIn: true })).toBe(false)
  })

  // Direct request, 2026-09-22: audio-in/mic stems must be able to show up
  // under drums/bass/lead, via the overnight classifier's guess.
  it('a mic stem auto-classified drums matches drums, even with endlesss off', () => {
    const micOnly = { endlesss: false, audioIn: true }
    expect(stemMatchesSlotKinds(MIC, ['drums'], micOnly, { autoRole: 'drums' })).toBe(true)
    expect(stemMatchesSlotKinds(MIC, ['drums'], both, { autoRole: 'drums' })).toBe(true)
    expect(stemMatchesSlotKinds(MIC, ['bass'], both, { autoRole: 'drums' })).toBe(false)
  })

  it('a mic stem auto-classified drums is dropped by an endlesss-only filter', () => {
    expect(
      stemMatchesSlotKinds(
        MIC,
        ['drums'],
        { endlesss: true, audioIn: false },
        { autoRole: 'drums' }
      )
    ).toBe(false)
  })

  it('an unmasked stem auto-classified drums counts as Endlesss for the sound-source filter', () => {
    expect(stemMatchesSlotKinds(null, ['drums'], both, { autoRole: 'drums' })).toBe(true)
    expect(
      stemMatchesSlotKinds(
        null,
        ['drums'],
        { endlesss: false, audioIn: true },
        { autoRole: 'drums' }
      )
    ).toBe(false)
  })

  it('an Endlesss-placed mask is ground truth: an auto guess never moves it to another kind', () => {
    expect(stemMatchesSlotKinds(DRUM, ['drums'], both, { autoRole: 'bass' })).toBe(true)
    expect(stemMatchesSlotKinds(DRUM, ['bass'], both, { autoRole: 'bass' })).toBe(false)
  })

  it('a confirmed role overrides the mask, any mask', () => {
    expect(stemMatchesSlotKinds(DRUM, ['bass'], both, { confirmedRole: 'bass' })).toBe(true)
    expect(stemMatchesSlotKinds(MIC, ['lead'], both, { confirmedRole: 'lead' })).toBe(true)
  })

  it('a stem confirmed for another role is excluded, even if its mask or auto guess match', () => {
    expect(stemMatchesSlotKinds(DRUM, ['drums'], both, { confirmedRole: 'bass' })).toBe(false)
    expect(
      stemMatchesSlotKinds(MIC, ['drums'], both, { confirmedRole: 'aux', autoRole: 'drums' })
    ).toBe(false)
  })

  it('a confirmed stem still obeys the sound-source filter', () => {
    expect(
      stemMatchesSlotKinds(
        DRUM,
        ['drums'],
        { endlesss: false, audioIn: true },
        {
          confirmedRole: 'drums'
        }
      )
    ).toBe(false)
  })

  it('both sources off matches nothing', () => {
    const none = { endlesss: false, audioIn: false }
    expect(stemMatchesSlotKinds(MIC, ['drums'], none, { autoRole: 'drums' })).toBe(false)
    expect(stemMatchesSlotKinds(DRUM, ['warm'], none)).toBe(false)
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
