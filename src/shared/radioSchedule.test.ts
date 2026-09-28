import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RADIO_GRID,
  DEFAULT_RADIO_PACE,
  RADIO_GRID_OPTIONS,
  RADIO_PACE_BARS,
  RADIO_PACE_OPTIONS,
  advanceRadioClock,
  createRadioClock,
  isRadioEligibleSlot,
  nextRadioIntervalBars,
  normalizeRadioGrid,
  normalizeRadioPace,
  pickRadioSlotId,
  radioGridBars
} from './radioSchedule'

describe('radio paces', () => {
  it('offers exactly slow, mid and fast, in that order', () => {
    expect(RADIO_PACE_OPTIONS).toEqual(['slow', 'mid', 'fast'])
  })

  it('defaults to mid', () => {
    expect(DEFAULT_RADIO_PACE).toBe('mid')
  })

  it('gives every pace a 2:1 bar window', () => {
    for (const pace of RADIO_PACE_OPTIONS) {
      const { min, max } = RADIO_PACE_BARS[pace]
      expect(max).toBe(min * 2)
    }
  })

  it('orders the paces slowest to fastest', () => {
    expect(RADIO_PACE_BARS.slow.min).toBeGreaterThan(RADIO_PACE_BARS.mid.min)
    expect(RADIO_PACE_BARS.mid.min).toBeGreaterThan(RADIO_PACE_BARS.fast.min)
  })

  it('normalizes an unknown value to the default', () => {
    expect(normalizeRadioPace('glacial')).toBe('mid')
    expect(normalizeRadioPace(undefined)).toBe('mid')
    expect(normalizeRadioPace(7)).toBe('mid')
    expect(normalizeRadioPace(null)).toBe('mid')
  })

  it('passes a known pace through untouched', () => {
    expect(normalizeRadioPace('fast')).toBe('fast')
    expect(normalizeRadioPace('slow')).toBe('slow')
  })

  it('sits every pace on a 3x ladder, retuned now the quantisation is gone', () => {
    expect(RADIO_PACE_BARS.fast).toEqual({ min: 2, max: 4 })
    expect(RADIO_PACE_BARS.mid).toEqual({ min: 6, max: 12 })
    expect(RADIO_PACE_BARS.slow).toEqual({ min: 18, max: 36 })
  })
})

describe('nextRadioIntervalBars', () => {
  it('returns the window minimum when random() is 0', () => {
    expect(nextRadioIntervalBars('mid', () => 0)).toBe(6)
  })

  it('returns the window maximum when random() is just under 1', () => {
    expect(nextRadioIntervalBars('mid', () => 0.9999)).toBe(12)
  })

  it('returns a whole number of bars inside the window, for every pace', () => {
    for (const pace of RADIO_PACE_OPTIONS) {
      const { min, max } = RADIO_PACE_BARS[pace]
      for (const r of [0, 0.1, 0.25, 0.5, 0.75, 0.9999]) {
        const bars = nextRadioIntervalBars(pace, () => r)
        expect(Number.isInteger(bars)).toBe(true)
        expect(bars).toBeGreaterThanOrEqual(min)
        expect(bars).toBeLessThanOrEqual(max)
      }
    }
  })

  it('actually varies across the window rather than returning one value', () => {
    const seen = new Set<number>()
    for (let i = 0; i < 13; i++) seen.add(nextRadioIntervalBars('mid', () => i / 13))
    expect(seen.size).toBeGreaterThan(5)
  })
})

describe('radioGridBars', () => {
  it('offers the same five options, in the same words, as the phone', () => {
    expect(RADIO_GRID_OPTIONS).toEqual(['own loop', 'loop end', '8 bars', '4 bars', '2 bars'])
  })

  it('defaults to the changing slot own loop', () => {
    expect(DEFAULT_RADIO_GRID).toBe('own loop')
  })

  it('normalizes anything unrecognised to the default', () => {
    expect(normalizeRadioGrid('16 bars')).toBe('own loop')
    expect(normalizeRadioGrid(undefined)).toBe('own loop')
    expect(normalizeRadioGrid(4)).toBe('own loop')
    expect(normalizeRadioGrid(null)).toBe('own loop')
  })

  it('loop end is the whole loop -- exactly what shipped 2026-09-26', () => {
    expect(radioGridBars('loop end', 8, 2)).toBe(8)
    expect(radioGridBars('loop end', 3, 1)).toBe(3)
  })

  it('own loop is the changing slot own bar length', () => {
    expect(radioGridBars('own loop', 8, 2)).toBe(2)
    expect(radioGridBars('own loop', 8, 4)).toBe(4)
  })

  it('falls back to the whole loop when the slot bar length is unknown', () => {
    expect(radioGridBars('own loop', 8, null)).toBe(8)
    expect(radioGridBars('own loop', 8, 0)).toBe(8)
    expect(radioGridBars('own loop', 8, 2.5)).toBe(8)
    expect(radioGridBars('4 bars', 0, 2)).toBe(0)
  })

  it('caps a grid longer than the loop to the loop', () => {
    expect(radioGridBars('8 bars', 4, 1)).toBe(4)
    expect(radioGridBars('own loop', 4, 8)).toBe(4)
  })

  it('steps down to the largest divisor of the loop, as the phone does', () => {
    // remotePage.ts:995-1002 -- 4 over a 6-bar loop becomes 3, 8 over a
    // 12-bar loop becomes 6, 4 over an 8-bar loop stays 4.
    expect(radioGridBars('4 bars', 6, 1)).toBe(3)
    expect(radioGridBars('8 bars', 12, 1)).toBe(6)
    expect(radioGridBars('4 bars', 8, 1)).toBe(4)
  })

  it('never steps below 1, which divides everything', () => {
    expect(radioGridBars('2 bars', 5, 1)).toBe(1)
    expect(radioGridBars('own loop', 7, 3)).toBe(1)
  })

  it('handles a non-integer loop by falling back to the loop', () => {
    expect(radioGridBars('4 bars', 6.5, 2)).toBe(6.5)
  })
})

describe('advanceRadioClock', () => {
  it('starts with no elapsed bars and the interval it was given', () => {
    const clock = createRadioClock(16)
    expect(clock.barsElapsed).toBe(0)
    expect(clock.intervalBars).toBe(16)
    expect(clock.lastPos).toBe(0)
  })

  it('accumulates forward motion inside one loop pass', () => {
    let clock = createRadioClock(16)
    clock = advanceRadioClock(clock, 1, 4).clock
    clock = advanceRadioClock(clock, 2.5, 4).clock
    expect(clock.barsElapsed).toBeCloseTo(2.5)
    expect(clock.lastPos).toBe(2.5)
  })

  it('counts the bars across a loop wrap without losing the tail', () => {
    let clock = createRadioClock(16)
    clock = advanceRadioClock(clock, 3.9, 4).clock
    // wrapped: 0.1 bars left in the old pass, plus 0.2 into the new one
    const step = advanceRadioClock(clock, 0.2, 4)
    expect(step.wrapped).toBe(true)
    expect(step.clock.barsElapsed).toBeCloseTo(4.2)
  })

  it('is not due before the interval has elapsed, even at a wrap', () => {
    let clock = createRadioClock(16)
    clock = advanceRadioClock(clock, 3.9, 4).clock
    const step = advanceRadioClock(clock, 0.0, 4)
    expect(step.wrapped).toBe(true)
    expect(step.due).toBe(false)
  })

  it('is not due past the interval when it is mid-loop', () => {
    let clock = createRadioClock(4)
    clock = advanceRadioClock(clock, 3.9, 4).clock
    clock = advanceRadioClock(clock, 0.0, 4).clock // wrap, 4 bars elapsed but interval is 4
    const step = advanceRadioClock(clock, 2, 4)
    expect(step.clock.barsElapsed).toBeCloseTo(6)
    expect(step.wrapped).toBe(false)
    expect(step.due).toBe(false)
  })

  it('is due at the first wrap at or after the interval', () => {
    let clock = createRadioClock(6)
    // one full 4-bar pass
    clock = advanceRadioClock(clock, 3.9, 4).clock
    expect(advanceRadioClock(clock, 0.0, 4).due).toBe(false) // 4 elapsed, interval 6
    clock = advanceRadioClock(clock, 0.0, 4).clock
    clock = advanceRadioClock(clock, 3.9, 4).clock // 7.9 elapsed
    const step = advanceRadioClock(clock, 0.0, 4)
    expect(step.wrapped).toBe(true)
    expect(step.due).toBe(true)
  })

  it('effectively rounds the interval up to a whole number of loops', () => {
    // interval 6, loop 4 -> fires at 8
    let clock = createRadioClock(6)
    let firedAt: number | null = null
    let pos = 0
    for (let tick = 0; tick < 400 && firedAt === null; tick++) {
      pos = (pos + 0.05) % 4
      const step = advanceRadioClock(clock, pos, 4)
      clock = step.clock
      if (step.due) firedAt = step.clock.barsElapsed
    }
    expect(firedAt).not.toBeNull()
    expect(firedAt as number).toBeCloseTo(8, 1)
  })

  it('resets elapsed bars and takes a fresh interval on restart', () => {
    let clock = createRadioClock(4)
    clock = advanceRadioClock(clock, 2.5, 4).clock
    const restarted = createRadioClock(20, clock.lastPos)
    expect(restarted.barsElapsed).toBe(0)
    expect(restarted.intervalBars).toBe(20)
    expect(restarted.lastPos).toBe(2.5)
  })

  it('treats a non-positive loop length as no motion rather than dividing by it', () => {
    const clock = createRadioClock(8)
    const step = advanceRadioClock(clock, 2, 0)
    expect(step.clock.barsElapsed).toBe(0)
    expect(step.due).toBe(false)
  })
})

describe('pickRadioSlotId', () => {
  it('returns null when nothing is eligible', () => {
    expect(pickRadioSlotId([], null, () => 0)).toBeNull()
  })

  it('returns the only eligible slot', () => {
    expect(pickRadioSlotId(['a'], null, () => 0)).toBe('a')
  })

  it('returns the only eligible slot even when it changed last', () => {
    expect(pickRadioSlotId(['a'], 'a', () => 0)).toBe('a')
  })

  it('never picks the slot that changed last when another is eligible', () => {
    for (const r of [0, 0.2, 0.4, 0.6, 0.8, 0.9999]) {
      expect(pickRadioSlotId(['a', 'b', 'c'], 'b', () => r)).not.toBe('b')
    }
  })

  it('can reach every other eligible slot', () => {
    const seen = new Set<string | null>()
    for (const r of [0, 0.34, 0.67, 0.9999]) {
      seen.add(pickRadioSlotId(['a', 'b', 'c'], 'a', () => r))
    }
    expect(seen).toEqual(new Set(['b', 'c']))
  })

  it('ignores a lastChangedId that is no longer eligible', () => {
    const seen = new Set<string | null>()
    for (const r of [0, 0.34, 0.67, 0.9999]) {
      seen.add(pickRadioSlotId(['a', 'b', 'c'], 'gone', () => r))
    }
    expect(seen).toEqual(new Set(['a', 'b', 'c']))
  })

  it('never returns an id that was not eligible', () => {
    for (let i = 0; i < 50; i++) {
      const picked = pickRadioSlotId(['x', 'y'], 'x', Math.random)
      expect(['x', 'y']).toContain(picked)
    }
  })
})

describe('isRadioEligibleSlot', () => {
  const base = {
    locked: false,
    audible: true,
    hasCandidate: true,
    hasSeedStem: false,
    rerolling: false
  }

  it('lets radio turn over an ordinary rolled layer', () => {
    expect(isRadioEligibleSlot(base)).toBe(true)
  })

  // The bug, reported live 2026-09-28: "if i start radio with stems
  // already there.. it seems to not transition". A slot seeded from a
  // rifff or the shelf carries a seedStem and NO candidate until it is
  // first rerolled, so a candidate-only test makes every pre-existing
  // layer permanently ineligible and radio idles forever with nothing it
  // is allowed to touch. Exactly the filter resolveDiscoverRifff had to
  // fix on 2026-09-16 for the same reason.
  it('turns over a seeded layer that has never been rerolled', () => {
    expect(isRadioEligibleSlot({ ...base, hasCandidate: false, hasSeedStem: true })).toBe(true)
  })

  it('leaves a locked layer alone, which is what the padlock is for', () => {
    expect(isRadioEligibleSlot({ ...base, locked: true })).toBe(false)
  })

  it('leaves a muted layer alone, because it is not part of what he hears', () => {
    expect(isRadioEligibleSlot({ ...base, audible: false })).toBe(false)
  })

  it('leaves a layer that is already mid-roll alone', () => {
    expect(isRadioEligibleSlot({ ...base, rerolling: true })).toBe(false)
  })

  it('skips a layer holding no stem at all, which has nothing to turn over', () => {
    expect(isRadioEligibleSlot({ ...base, hasCandidate: false, hasSeedStem: false })).toBe(false)
  })
})
