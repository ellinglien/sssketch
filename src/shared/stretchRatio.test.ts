// src/shared/stretchRatio.test.ts
import { describe, expect, it } from 'vitest'
import { stretchRatioForStem } from './stretchRatio'

describe('stretchRatioForStem', () => {
  // Extracted 2026-09-28 so radio's prefetch can warm the SAME stretch the
  // build will later ask for. Reported: "the transitions are a bit
  // delayed... the actual audio doesn't always start on the loop point, it
  // takes a second to start", and then "pre-load?". Radio warmed the
  // download a whole interval early but never the stretch, so rubberband
  // ran at commit time. The cache is keyed on (path, ratio), so a prefetch
  // computing this even slightly differently warms the wrong file and
  // silently does the work twice -- which is why there is now one function
  // and this test, rather than the formula written out in two places.
  it('is 1 when the stem was recorded at the project tempo', () => {
    // 8 bars at 120bpm is 16s, so a 16s 8-bar stem needs no stretching.
    expect(stretchRatioForStem(16, 8, 120)).toBeCloseTo(1)
    expect(stretchRatioForStem(8, 4, 120)).toBeCloseTo(1)
  })

  it('is above 1 when the stem is slower than the project', () => {
    // Recorded at 100bpm, played at 120: it must be squeezed.
    expect(stretchRatioForStem(19.2, 8, 120)).toBeCloseTo(1.2)
  })

  it('is below 1 when the stem is faster than the project', () => {
    expect(stretchRatioForStem(8, 8, 120)).toBeCloseTo(0.5)
    // 4 bars in 6s = 160bpm; at 120bpm those bars take 8s.
    expect(stretchRatioForStem(6, 4, 120)).toBeCloseTo(0.75)
  })

  it('scales with the project tempo, not just the stem', () => {
    expect(stretchRatioForStem(16, 8, 60)).toBeCloseTo(0.5)
    expect(stretchRatioForStem(16, 8, 240)).toBeCloseTo(2)
  })

  it('refuses to invent a ratio from a stem it cannot measure', () => {
    // A zero or missing bar length would divide by zero and poison the
    // cache key with Infinity/NaN; 1 means "do not stretch".
    expect(stretchRatioForStem(16, 0, 120)).toBe(1)
    expect(stretchRatioForStem(0, 8, 120)).toBe(1)
    expect(stretchRatioForStem(16, 8, 0)).toBe(1)
    expect(stretchRatioForStem(8, 0, 120)).toBe(1)
    expect(stretchRatioForStem(8, 4, 0)).toBe(1)
    expect(stretchRatioForStem(Number.NaN, 8, 120)).toBe(1)
  })
})
