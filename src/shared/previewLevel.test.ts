import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PREVIEW_LEVEL,
  normalizePreviewLevel,
  previewLevelGain,
  previewLevelLabel
} from './previewLevel'

describe('previewLevelGain', () => {
  it('is unity at 100%, the default, so previews sound as they always have', () => {
    expect(DEFAULT_PREVIEW_LEVEL).toBe(100)
    expect(previewLevelGain(100)).toBe(1)
  })

  it('is silent at 0', () => {
    expect(previewLevelGain(0)).toBe(0)
  })

  it('follows a squared taper, so the dial turns down evenly by ear', () => {
    expect(previewLevelGain(50)).toBeCloseTo(0.25)
    expect(previewLevelGain(10)).toBeCloseTo(0.01)
  })

  it('only ever turns down: out-of-range levels are clamped', () => {
    expect(previewLevelGain(150)).toBe(1)
    expect(previewLevelGain(-20)).toBe(0)
  })

  it('rises with the level', () => {
    for (let level = 1; level <= 100; level++) {
      expect(previewLevelGain(level)).toBeGreaterThan(previewLevelGain(level - 1))
    }
  })
})

describe('normalizePreviewLevel', () => {
  it('keeps a stored level in range, whole', () => {
    expect(normalizePreviewLevel(40)).toBe(40)
    expect(normalizePreviewLevel(40.6)).toBe(41)
    expect(normalizePreviewLevel(0)).toBe(0)
  })

  it('clamps one out of range', () => {
    expect(normalizePreviewLevel(250)).toBe(100)
    expect(normalizePreviewLevel(-1)).toBe(0)
  })

  it('falls back to the default for anything that is not a number', () => {
    for (const raw of [undefined, null, '40', NaN, Infinity, {}]) {
      expect(normalizePreviewLevel(raw)).toBe(DEFAULT_PREVIEW_LEVEL)
    }
  })
})

describe('previewLevelLabel', () => {
  it('says what the dial does to the sound, not where the knob sits', () => {
    // 50 on the dial is a quarter of the gain, so "50%" would mislead.
    expect(previewLevelLabel(50)).toBe('−12 dB')
    expect(previewLevelLabel(25)).toBe('−24 dB')
    expect(previewLevelLabel(71)).toBe('−6 dB')
  })

  it('reads the ends in words', () => {
    expect(previewLevelLabel(100)).toBe('full level')
    expect(previewLevelLabel(0)).toBe('silent')
  })

  it('never reads a turned-down dial as full', () => {
    expect(previewLevelLabel(99)).toBe('−0.2 dB')
  })
})
