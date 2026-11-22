// src/shared/radioCover.test.ts
import { describe, expect, it } from 'vitest'
import { MIN_MIX_COVER, UNKNOWN_COVER, coverOf, mixCover, mixCovered } from './radioCover'

describe('mixCover', () => {
  it('an empty mix covers nothing', () => {
    expect(mixCover([])).toBe(0)
  })
  it('one row covers what it sounds; rows fill each other in as if independent', () => {
    expect(mixCover([0.4])).toBeCloseTo(0.4)
    expect(mixCover([0.5, 0.5])).toBeCloseTo(0.75)
    expect(mixCover([0.5, 0.5, 0.2])).toBeCloseTo(0.8)
    expect(mixCover([0.3, 1])).toBe(1)
  })
  it('an unknown cover counts as the neutral constant, a silent row as nothing', () => {
    expect(mixCover([null])).toBe(UNKNOWN_COVER)
    expect(mixCover([undefined, NaN])).toBeCloseTo(1 - (1 - UNKNOWN_COVER) ** 2)
    expect(mixCover([0, 0.4])).toBeCloseTo(0.4)
    expect(coverOf(2)).toBe(1)
    expect(coverOf(-1)).toBe(0)
  })
})

describe('mixCovered', () => {
  it('is the threshold: a mostly silent stem alone is not covered, two half-full ones are', () => {
    expect(mixCovered([0.3])).toBe(false)
    expect(mixCovered([0.5, 0.5])).toBe(true)
    expect(mixCovered([MIN_MIX_COVER])).toBe(true)
    expect(mixCovered([])).toBe(false)
  })
  it('never fires on what it does not know: an unmeasured stem alone passes', () => {
    expect(mixCovered([null])).toBe(true)
    expect(mixCovered([0, undefined])).toBe(true)
  })
})
