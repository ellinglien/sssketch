import { describe, expect, it } from 'vitest'
import {
  DISCOVER_SLOT_MODIFIER_LABEL,
  DISCOVER_SLOT_MODIFIER_OPTIONS,
  DEFAULT_SOURCE_LEAN,
  drawSoundSource,
  slotRollOptions,
  soundSourceForLean,
  toggleSlotModifier
} from './discoverSlotModifier'

describe('DISCOVER_SLOT_MODIFIER_OPTIONS', () => {
  it('is just my sounds: prefer faves became the faves dial (2026-10-03)', () => {
    expect(DISCOVER_SLOT_MODIFIER_OPTIONS).toEqual(['mine'])
  })

  it('has lowercase display labels', () => {
    expect(DISCOVER_SLOT_MODIFIER_LABEL).toEqual({ mine: 'my sounds' })
  })
})

describe('toggleSlotModifier', () => {
  it('turns a modifier on and off, including the last one', () => {
    expect(toggleSlotModifier([], 'mine')).toEqual(['mine'])
    expect(toggleSlotModifier(['mine'], 'mine')).toEqual([])
  })

  it('dedupes', () => {
    expect(toggleSlotModifier(['mine', 'mine'], 'mine')).toEqual([])
  })
})

describe('slotRollOptions', () => {
  const withUser = { hasUsername: true }

  it('defaults to no ownership filter', () => {
    expect(slotRollOptions([], withUser)).toEqual({ onlyOwnStems: false })
  })

  it("'mine' sets onlyOwnStems only with a username", () => {
    expect(slotRollOptions(['mine'], withUser).onlyOwnStems).toBe(true)
    expect(slotRollOptions(['mine'], { hasUsername: false }).onlyOwnStems).toBe(false)
  })
})

const ENDLESSS_ONLY = { endlesss: true, audioIn: false }
const OTHER_ONLY = { endlesss: false, audioIn: true }

describe('drawSoundSource', () => {
  it('is always endlesss, with no fallback, at 0', () => {
    for (const r of [0, 0.5, 0.999]) {
      expect(drawSoundSource(0, () => r)).toEqual({ first: ENDLESSS_ONLY, fallback: null })
    }
  })

  it('is always other, with no fallback, at 100', () => {
    for (const r of [0, 0.5, 0.999]) {
      expect(drawSoundSource(100, () => r)).toEqual({ first: OTHER_ONLY, fallback: null })
    }
  })

  it('draws other with probability lean/100, and falls back to the other source', () => {
    expect(drawSoundSource(30, () => 0.29)).toEqual({ first: OTHER_ONLY, fallback: ENDLESSS_ONLY })
    expect(drawSoundSource(30, () => 0.3)).toEqual({ first: ENDLESSS_ONLY, fallback: OTHER_ONLY })
  })

  it('is half and half at the middle', () => {
    let other = 0
    const n = 1000
    for (let i = 0; i < n; i++) {
      // An even walk over [0, 1) -- deterministic, no seed library needed.
      if (drawSoundSource(50, () => (i + 0.5) / n).first.audioIn) other++
    }
    expect(other).toBe(n / 2)
  })

  it('is still a draw, with a fallback, just inside each end', () => {
    expect(drawSoundSource(1, () => 0)).toEqual({ first: OTHER_ONLY, fallback: ENDLESSS_ONLY })
    expect(drawSoundSource(99, () => 0.99)).toEqual({
      first: ENDLESSS_ONLY,
      fallback: OTHER_ONLY
    })
  })

  it('clamps a value outside 0-100 to the nearest end', () => {
    expect(drawSoundSource(-5, () => 0)).toEqual({ first: ENDLESSS_ONLY, fallback: null })
    expect(drawSoundSource(140, () => 0.99)).toEqual({ first: OTHER_ONLY, fallback: null })
  })

  it('returns frozen filters', () => {
    const draw = drawSoundSource(50, () => 0)
    expect(Object.isFrozen(drawSoundSource(0).first)).toBe(true)
    expect(draw.first).toEqual(OTHER_ONLY)
    expect(Object.isFrozen(draw.first)).toBe(true)
    // Object.isFrozen(null) is true, so pin the fallback down first.
    expect(draw.fallback).toEqual(ENDLESSS_ONLY)
    expect(Object.isFrozen(draw.fallback)).toBe(true)
  })
})

describe('soundSourceForLean', () => {
  it('is one source at each end, and both in between', () => {
    expect(soundSourceForLean(0)).toEqual(ENDLESSS_ONLY)
    expect(soundSourceForLean(100)).toEqual(OTHER_ONLY)
    expect(soundSourceForLean(1)).toEqual({ endlesss: true, audioIn: true })
    expect(soundSourceForLean(50)).toEqual({ endlesss: true, audioIn: true })
    expect(soundSourceForLean(99)).toEqual({ endlesss: true, audioIn: true })
  })

  it('returns frozen filters, one shared object for in between', () => {
    expect(Object.isFrozen(soundSourceForLean(0))).toBe(true)
    expect(Object.isFrozen(soundSourceForLean(50))).toBe(true)
    expect(Object.isFrozen(soundSourceForLean(100))).toBe(true)
    expect(soundSourceForLean(50)).toBe(soundSourceForLean(20))
  })
})

describe('DEFAULT_SOURCE_LEAN', () => {
  it("leans 95% toward other sounds -- Elling's own recordings (2026-09-30)", () => {
    expect(DEFAULT_SOURCE_LEAN).toBe(95)
  })
})
