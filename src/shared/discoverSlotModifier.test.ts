import { describe, expect, it } from 'vitest'
import {
  DISCOVER_SLOT_MODIFIER_LABEL,
  DISCOVER_SLOT_MODIFIER_OPTIONS,
  drawSoundSource,
  slotRollOptions,
  soundSourceForLean,
  toggleSlotModifier
} from './discoverSlotModifier'

describe('DISCOVER_SLOT_MODIFIER_OPTIONS', () => {
  it('lists the 4 modifiers in canonical order', () => {
    expect(DISCOVER_SLOT_MODIFIER_OPTIONS).toEqual(['preferFaves', 'endlesss', 'other', 'mine'])
  })

  it('has lowercase display labels', () => {
    expect(DISCOVER_SLOT_MODIFIER_LABEL).toEqual({
      preferFaves: 'prefer faves',
      endlesss: 'endlesss sounds',
      other: 'other sounds',
      mine: 'my sounds'
    })
  })
})

describe('toggleSlotModifier', () => {
  it('turns a modifier on, keeping canonical order', () => {
    expect(toggleSlotModifier(['mine'], 'endlesss')).toEqual(['endlesss', 'mine'])
  })

  it('turns a modifier off, including the last one', () => {
    expect(toggleSlotModifier(['other', 'mine'], 'other')).toEqual(['mine'])
    expect(toggleSlotModifier(['mine'], 'mine')).toEqual([])
  })

  it('dedupes', () => {
    expect(toggleSlotModifier(['mine', 'mine'], 'endlesss')).toEqual(['endlesss', 'mine'])
  })

  it('endlesss and other are independent (both may be on)', () => {
    expect(toggleSlotModifier(['endlesss'], 'other')).toEqual(['endlesss', 'other'])
  })
})

describe('slotRollOptions', () => {
  const withUser = { hasUsername: true }

  it('defaults to both sound sources, no ownership filter, no favourite preference', () => {
    expect(slotRollOptions([], withUser)).toEqual({
      soundSource: { endlesss: true, audioIn: true },
      onlyOwnStems: false,
      preferFavourites: false
    })
  })

  it("'endlesss' alone restricts to endlesss sounds", () => {
    expect(slotRollOptions(['endlesss'], withUser).soundSource).toEqual({
      endlesss: true,
      audioIn: false
    })
  })

  it("'other' alone restricts to non-endlesss sounds", () => {
    expect(slotRollOptions(['other'], withUser).soundSource).toEqual({
      endlesss: false,
      audioIn: true
    })
  })

  it('both sources selected means both', () => {
    expect(slotRollOptions(['endlesss', 'other'], withUser).soundSource).toEqual({
      endlesss: true,
      audioIn: true
    })
  })

  it("'mine' sets onlyOwnStems only with a username", () => {
    expect(slotRollOptions(['mine'], withUser).onlyOwnStems).toBe(true)
    expect(slotRollOptions(['mine'], { hasUsername: false }).onlyOwnStems).toBe(false)
  })

  it("'preferFaves' sets preferFavourites", () => {
    expect(slotRollOptions(['preferFaves'], withUser).preferFavourites).toBe(true)
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

  it('clamps a value outside 0-100 to the nearest end', () => {
    expect(drawSoundSource(-5, () => 0).fallback).toBeNull()
    expect(drawSoundSource(140, () => 0.99).first).toEqual(OTHER_ONLY)
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
})
