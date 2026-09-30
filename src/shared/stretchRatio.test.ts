import { describe, expect, it } from 'vitest'
import { stretchRatioForStem } from './stretchRatio'

describe('stretchRatioForStem', () => {
  it('is 1 when the stem is already at the tempo', () => {
    expect(stretchRatioForStem(8, 4, 120)).toBeCloseTo(1)
  })
  it('slows a faster stem down', () => {
    // 4 bars in 6s = 160bpm; at 120bpm those bars take 8s.
    expect(stretchRatioForStem(6, 4, 120)).toBeCloseTo(0.75)
  })
  it('is 1 for anything it cannot compute', () => {
    expect(stretchRatioForStem(0, 4, 120)).toBe(1)
    expect(stretchRatioForStem(8, 0, 120)).toBe(1)
    expect(stretchRatioForStem(8, 4, 0)).toBe(1)
  })
})
