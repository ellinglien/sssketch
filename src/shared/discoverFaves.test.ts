// src/shared/discoverFaves.test.ts
import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_FAVES,
  FAVES_LABEL,
  FAVES_TOOLTIP,
  LEGACY_PREFER_FAVES,
  NO_FAVE_FITS,
  favesBoostScale,
  favesDraw,
  normalizeFaves,
  restrictStems
} from './discoverFaves'

/** mulberry32 -- a small seeded PRNG. */
function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('the faves dial copy', () => {
  it('is lowercase and says what it does', () => {
    expect(FAVES_LABEL).toBe('faves')
    expect(FAVES_TOOLTIP).toBe('how much to stick to liked stems')
    expect(NO_FAVE_FITS).toBe('no fave fits')
    expect(DEFAULT_FAVES).toBe(0)
  })
})

describe('normalizeFaves', () => {
  it('clamps and rounds a number to 0..100', () => {
    expect(normalizeFaves(37.4)).toBe(37)
    expect(normalizeFaves(-5)).toBe(0)
    expect(normalizeFaves(250)).toBe(100)
  })

  it('anything that is not a number is the default', () => {
    expect(normalizeFaves(undefined)).toBe(0)
    expect(normalizeFaves('50')).toBe(0)
    expect(normalizeFaves(NaN)).toBe(0)
  })

  it('migrates a saved prefer faves: on to 50, off to 0; a saved faves wins', () => {
    expect(LEGACY_PREFER_FAVES).toBe(50)
    expect(normalizeFaves(undefined, true)).toBe(50)
    expect(normalizeFaves(undefined, false)).toBe(0)
    expect(normalizeFaves(undefined, 'yes')).toBe(0)
    expect(normalizeFaves(20, true)).toBe(20)
  })
})

describe('favesDraw', () => {
  it('never draws at the ends: 0 is normal, 100 is only, and random is not called', () => {
    const random = vi.fn(() => 0.5)
    expect(favesDraw(0, random)).toBe('normal')
    expect(favesDraw(100, random)).toBe('only')
    expect(favesDraw(-3, random)).toBe('normal')
    expect(favesDraw(140, random)).toBe('only')
    expect(random).not.toHaveBeenCalled()
  })

  it('in between, draws once per pick: only with probability faves/100', () => {
    for (const faves of [10, 30, 50, 80]) {
      const random = seeded(faves)
      let only = 0
      const n = 20_000
      for (let i = 0; i < n; i++) if (favesDraw(faves, random) === 'only') only++
      expect(only / n).toBeGreaterThan(faves / 100 - 0.02)
      expect(only / n).toBeLessThan(faves / 100 + 0.02)
    }
  })

  it('uses the random it is given', () => {
    expect(favesDraw(50, () => 0.49)).toBe('only')
    expect(favesDraw(50, () => 0.5)).toBe('normal')
  })
})

describe('favesBoostScale', () => {
  it('is faves/100: none at 0, the full boost at 100', () => {
    expect(favesBoostScale(0)).toBe(0)
    expect(favesBoostScale(50)).toBe(0.5)
    expect(favesBoostScale(100)).toBe(1)
    expect(favesBoostScale(Number.NaN)).toBe(0)
  })
})

describe('restrictStems', () => {
  it('no restriction from either side is none', () => {
    expect(restrictStems(undefined, undefined)).toBeUndefined()
  })

  it('one side alone is that side', () => {
    const a = new Set(['x'])
    expect(restrictStems(a, undefined)).toBe(a)
    expect(restrictStems(undefined, a)).toBe(a)
  })

  it('both sides intersect', () => {
    expect([...restrictStems(new Set(['x', 'y']), new Set(['y', 'z']))!]).toEqual(['y'])
  })
})
