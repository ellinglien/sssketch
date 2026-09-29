import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RADIO_LOOP_END_BARS,
  DEFAULT_RADIO_PACE,
  DEFAULT_RADIO_PHRASE_BARS,
  DEFAULT_RADIO_SETTINGS,
  DEFAULT_RADIO_TURNOVER,
  RADIO_CHANNELS_MAX,
  DEFAULT_RADIO_CHANNELS,
  RADIO_CHANNELS_MIN,
  RADIO_LOOP_END_OPTIONS,
  RADIO_PACE_BARS,
  RADIO_PACE_OPTIONS,
  RADIO_PACE_WINDOW_MAX,
  RADIO_PACE_WINDOW_MIN,
  RADIO_PHRASE_OPTIONS,
  RADIO_TURNOVER_OPTIONS,
  adjustRadioPaceWindow,
  advanceRadioClock,
  createRadioClock,
  isRadioEligibleSlot,
  nextRadioIntervalBars,
  nextRadioIntervalBarsInWindow,
  normalizeRadioLoopEndBars,
  normalizeRadioPace,
  normalizeRadioPaceWindow,
  normalizeRadioPhraseBars,
  normalizeRadioSettings,
  normalizeRadioTurnover,
  pickRadioSlotId,
  radioChangeBars,
  radioGridBars,
  restartRadioInterval,
  radioPaceWindowPreset,
  radioPhraseLaps,
  radioStarterKinds,
  radioChangeDueAtNextWrap,
  type RadioClock
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

  it('steps back from the first retune, which he heard as too frenetic', () => {
    // 2026-09-28, after listening: "the transitions are a little too
    // frenetic by default now". The first retune put mid at 6-12 (~21s
    // realised); this is the retreat Phase A's own simulation named.
    // Not a strict 3x ladder any more -- mid is the number that was
    // actually judged by ear, and the neighbours are spaced around it
    // rather than the other way round.
    expect(RADIO_PACE_BARS.fast).toEqual({ min: 3, max: 6 })
    expect(RADIO_PACE_BARS.mid).toEqual({ min: 8, max: 16 })
    expect(RADIO_PACE_BARS.slow).toEqual({ min: 24, max: 48 })
  })

  it('keeps each pace at least twice the one below it, so they stay distinct', () => {
    expect(RADIO_PACE_BARS.mid.min / RADIO_PACE_BARS.fast.min).toBeGreaterThanOrEqual(2)
    expect(RADIO_PACE_BARS.slow.min / RADIO_PACE_BARS.mid.min).toBeGreaterThanOrEqual(2)
  })
})

describe('nextRadioIntervalBars', () => {
  it('returns the window minimum when random() is 0', () => {
    expect(nextRadioIntervalBars('mid', () => 0)).toBe(8)
  })

  it('returns the window maximum when random() is just under 1', () => {
    expect(nextRadioIntervalBars('mid', () => 0.9999)).toBe(16)
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

describe('the loop-end threshold', () => {
  it('offers two, four and eight bars, then always, in that order', () => {
    // A threshold, not a grid: at or under it a stem may turn over on its
    // own cycle, over it the change waits for the loop top. 0 is `always`
    // -- no stem is under it, so everything waits, which is exactly what
    // `loop end` did.
    expect(RADIO_LOOP_END_OPTIONS).toEqual([2, 4, 8, 0])
  })

  it('defaults to four bars, so a fast pace can actually be fast', () => {
    // Elling, listening at `fast` (3-6 bars) with the old `loop end`
    // default: "even fast feels quite slow now.. i think it's the
    // transition rules". He was right -- every drawn interval rounded up
    // to the next whole loop, so on an 8-bar loop `fast` could only ever
    // produce 8 bars. Four bars leaves every ordinary Endlesss layer (1,
    // 2 or 4 bars) free to turn over on its own cycle and still holds
    // anything longer to the loop top.
    expect(DEFAULT_RADIO_LOOP_END_BARS).toBe(4)
  })

  it('normalizes anything unrecognised to the default', () => {
    expect(normalizeRadioLoopEndBars(16)).toBe(4)
    expect(normalizeRadioLoopEndBars(undefined)).toBe(4)
    expect(normalizeRadioLoopEndBars(null)).toBe(4)
    // A string that looks like a number is still not one.
    expect(normalizeRadioLoopEndBars('2')).toBe(4)
    expect(normalizeRadioLoopEndBars(2)).toBe(2)
    expect(normalizeRadioLoopEndBars(0)).toBe(0)
    expect(normalizeRadioLoopEndBars(8)).toBe(8)
  })

  it('migrates every stored change-on word rather than throwing', () => {
    expect(normalizeRadioLoopEndBars(undefined, 'loop end')).toBe(0)
    expect(normalizeRadioLoopEndBars(undefined, 'own loop')).toBe(DEFAULT_RADIO_LOOP_END_BARS)
    expect(normalizeRadioLoopEndBars(undefined, '8 bars')).toBe(8)
    expect(normalizeRadioLoopEndBars(undefined, '4 bars')).toBe(4)
    expect(normalizeRadioLoopEndBars(undefined, '2 bars')).toBe(2)
    expect(normalizeRadioLoopEndBars(undefined, 'nonsense')).toBe(DEFAULT_RADIO_LOOP_END_BARS)
    expect(normalizeRadioLoopEndBars(undefined, null)).toBe(DEFAULT_RADIO_LOOP_END_BARS)
    // A stored threshold always wins over the word it replaced.
    expect(normalizeRadioLoopEndBars(8, 'loop end')).toBe(8)
  })

  it('sends everything to the loop end at always -- exactly what shipped 2026-09-26', () => {
    expect(radioGridBars(0, 8, 2)).toBe(8)
    expect(radioGridBars(0, 3, 1)).toBe(3)
  })

  it('lets a stem at or under the threshold change on its own cycle', () => {
    expect(radioGridBars(4, 8, 2)).toBe(2)
    expect(radioGridBars(4, 8, 4)).toBe(4)
  })

  it('holds a stem over the threshold to the loop end', () => {
    expect(radioGridBars(2, 8, 4)).toBe(8)
    expect(radioGridBars(4, 16, 8)).toBe(16)
    expect(radioGridBars(8, 16, 12)).toBe(16)
    expect(radioGridBars(8, 16, 9)).toBe(16)
  })

  it('falls back to the whole loop when the bar length is unknown', () => {
    expect(radioGridBars(4, 8, null)).toBe(8)
    expect(radioGridBars(4, 8, 0)).toBe(8)
    // A fractional length (2.5 bars) has no boundary to land on -- flooring
    // it to 2 would invent one the stem does not have.
    expect(radioGridBars(4, 8, 2.5)).toBe(8)
    expect(radioGridBars(4, 0, 2)).toBe(0)
  })

  it('caps a stem longer than the loop to the loop', () => {
    expect(radioGridBars(8, 4, 8)).toBe(4)
    expect(radioGridBars(8, 4, 5)).toBe(4)
  })

  it('steps down to the largest divisor of the loop, as the phone does', () => {
    // remotePage.ts:995-1002 -- 4 over a 6-bar loop becomes 3, 8 over a
    // 12-bar loop becomes 6, 4 over an 8-bar loop stays 4.
    expect(radioGridBars(4, 6, 4)).toBe(3)
    expect(radioGridBars(8, 12, 8)).toBe(6)
    expect(radioGridBars(4, 8, 4)).toBe(4)
  })

  it('never steps below 1, which divides everything', () => {
    expect(radioGridBars(2, 5, 2)).toBe(1)
    expect(radioGridBars(4, 7, 3)).toBe(1)
  })

  it('handles a non-integer loop by falling back to the loop', () => {
    expect(radioGridBars(4, 6.5, 2)).toBe(6.5)
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

describe('advanceRadioClock on a grid', () => {
  it('reproduces the old behaviour exactly when the grid IS the loop', () => {
    // The safety property of the whole change: gridBars === loopBars must
    // be byte-for-byte what shipped 2026-09-26.
    const clock = { barsElapsed: 7.9, intervalBars: 6, lastPos: 7.9, lapsSincePhrase: 0 }
    const notYet = advanceRadioClock(clock, 7.95, 8, 8)
    expect(notYet.due).toBe(false)
    const atWrap = advanceRadioClock(clock, 0.05, 8, 8)
    expect(atWrap.wrapped).toBe(true)
    expect(atWrap.due).toBe(true)
  })

  it('commits at a sub-loop boundary once the interval has elapsed', () => {
    // 8-bar loop, 2-bar grid, interval 3 bars: the old code would have
    // waited for bar 8. This lands at bar 4.
    const clock = { barsElapsed: 3.1, intervalBars: 3, lastPos: 3.9, lapsSincePhrase: 0 }
    const step = advanceRadioClock(clock, 4.02, 8, 2)
    expect(step.wrapped).toBe(false)
    expect(step.due).toBe(true)
  })

  it('does NOT commit at a grid boundary before the interval has elapsed', () => {
    // The grid is a gate, not a trigger -- it can never make changes more
    // frequent than the pace asked for.
    const clock = { barsElapsed: 1.9, intervalBars: 6, lastPos: 3.9, lapsSincePhrase: 0 }
    const step = advanceRadioClock(clock, 4.02, 8, 2)
    expect(step.due).toBe(false)
  })

  it('treats the wrap as a grid boundary, because 0 is always on the grid', () => {
    const clock = { barsElapsed: 9, intervalBars: 3, lastPos: 7.9, lapsSincePhrase: 0 }
    const step = advanceRadioClock(clock, 0.02, 8, 3)
    expect(step.wrapped).toBe(true)
    expect(step.due).toBe(true)
  })

  it('does not fire twice inside one grid cell', () => {
    const clock = { barsElapsed: 5, intervalBars: 3, lastPos: 4.1, lapsSincePhrase: 0 }
    expect(advanceRadioClock(clock, 4.5, 8, 2).due).toBe(false)
  })

  it('defaults the grid to the whole loop when it is not given', () => {
    const clock = { barsElapsed: 9, intervalBars: 3, lastPos: 3.9, lapsSincePhrase: 0 }
    expect(advanceRadioClock(clock, 4.02, 8).due).toBe(false)
  })
})

describe('the phrase grid', () => {
  // Elling, 2026-09-28: "any way to keep track of the beat and to make
  // sure it transitions on 16 or 32". A different axis from the loop-end
  // threshold: that one is a FLOOR (the smallest boundary a change may
  // land on, capped at the loop), this one is a CEILING (however eager
  // the pace and however short the layer, only a 16 or a 32).
  it('offers loop, sixteen bars and thirty-two bars', () => {
    expect(RADIO_PHRASE_OPTIONS).toEqual([0, 16, 32])
  })

  it('is off by default, because a phrase grid swallows the pace', () => {
    // At 120bpm a 16-bar phrase is 32 seconds and a 32-bar one is over a
    // minute, so a phrase grid plus `fast` means `fast` does nothing --
    // the pace stops being how often and becomes which sixteen it picks.
    // That is the opposite of the complaint that drove the pace work the
    // same day, so it has to be opt-in.
    expect(DEFAULT_RADIO_PHRASE_BARS).toBe(0)
    expect(DEFAULT_RADIO_SETTINGS.phraseBars).toBe(0)
  })

  it('normalizes anything unrecognised to loop rather than throwing', () => {
    expect(normalizeRadioPhraseBars(0)).toBe(0)
    expect(normalizeRadioPhraseBars(16)).toBe(16)
    expect(normalizeRadioPhraseBars(32)).toBe(32)
    expect(normalizeRadioPhraseBars(undefined)).toBe(0)
    expect(normalizeRadioPhraseBars(null)).toBe(0)
    expect(normalizeRadioPhraseBars(24)).toBe(0)
    expect(normalizeRadioPhraseBars('32')).toBe(0)
    expect(normalizeRadioPhraseBars({ bars: 16 })).toBe(0)
  })

  it('reads a phrase out of a stored settings object, and absent is loop', () => {
    expect(normalizeRadioSettings({ phraseBars: 32 }).phraseBars).toBe(32)
    // A file written before this field existed keeps today's behaviour.
    expect(normalizeRadioSettings({ pace: 'fast' }).phraseBars).toBe(0)
  })
})

describe('radioPhraseLaps', () => {
  // A phrase is counted in WHOLE LAPS of the loop, not in bars off a
  // float accumulator. Two reasons, and both are load-bearing:
  //   - a lap is an integer the clock already spots exactly (pos went
  //     down), so the grid cannot drift by a tick's worth of float over a
  //     twenty-minute listen;
  //   - it makes every phrase boundary a loop top, which is the boundary
  //     that is safe to change on (see DEFAULT_RADIO_LOOP_END_BARS).
  it('is off when there is no phrase grid', () => {
    expect(radioPhraseLaps(0, 8)).toBe(0)
  })

  it('counts an ordinary Endlesss loop into the phrase exactly', () => {
    expect(radioPhraseLaps(16, 8)).toBe(2)
    expect(radioPhraseLaps(32, 8)).toBe(4)
    expect(radioPhraseLaps(16, 4)).toBe(4)
    expect(radioPhraseLaps(16, 2)).toBe(8)
    expect(radioPhraseLaps(16, 1)).toBe(16)
  })

  it('takes the nearest whole lap when the loop does not divide the phrase', () => {
    // A three-bar loop has no sixteen-bar boundary that is also a loop
    // top, and a boundary that is not a loop top is not a boundary radio
    // may use. Five laps -- fifteen bars -- is the nearest honest answer.
    expect(radioPhraseLaps(16, 3)).toBe(5)
    expect(radioPhraseLaps(16, 6)).toBe(3)
    expect(radioPhraseLaps(32, 6)).toBe(5)
  })

  it('never goes below one lap, so the loop top is always the floor', () => {
    expect(radioPhraseLaps(16, 32)).toBe(1)
    expect(radioPhraseLaps(16, 64)).toBe(1)
  })

  it('is off for a loop length that is not a real length', () => {
    expect(radioPhraseLaps(16, 0)).toBe(0)
    expect(radioPhraseLaps(16, -4)).toBe(0)
    expect(radioPhraseLaps(16, Number.NaN)).toBe(0)
  })
})

describe('advanceRadioClock on a phrase grid', () => {
  /** Runs the clock over `bars` of real playback at roughly the engine's
   * own 30Hz and returns the bar count at each change -- the same shape
   * as "effectively rounds the interval up to a whole number of loops"
   * above, but long enough to see the grid rather than one firing. */
  function changesOver(opts: {
    interval: number
    loopBars: number
    gridBars: number
    phraseBars: number
    bars: number
  }): number[] {
    let clock = createRadioClock(opts.interval, 0)
    const fired: number[] = []
    let total = 0
    let pos = 0
    const tick = 0.02
    while (total < opts.bars) {
      total += tick
      pos = (pos + tick) % opts.loopBars
      const step = advanceRadioClock(clock, pos, opts.loopBars, opts.gridBars, opts.phraseBars)
      clock = step.clock
      if (step.due) {
        fired.push(Math.round(total))
        clock = restartRadioInterval(step.clock, opts.interval, pos)
      }
    }
    return fired
  }

  it('leaves the pace alone when the phrase is loop, which is why that is the default', () => {
    // The safety property: 0 must change nothing at all. A `mid` interval
    // on a 2-bar grid lands roughly every eight bars, on the fine grid --
    // the pace, not a phrase. (Not an exact bar list: which 2-bar cell a
    // landing falls in is decided by where barsElapsed crosses the
    // interval, so it is a tick-resolution detail rather than a rule.)
    const off = changesOver({ interval: 8, loopBars: 8, gridBars: 2, phraseBars: 0, bars: 60 })
    expect(off.length).toBeGreaterThanOrEqual(5)
    for (const bar of off) expect(bar % 2).toBe(0)
  })

  it('holds a change back to the sixteen even when the layer could turn over sooner', () => {
    // Two-bar hat, eight-bar loop, mid: without a phrase grid this lands
    // in the eights. With one it can only land on a sixteen.
    expect(
      changesOver({ interval: 8, loopBars: 8, gridBars: 2, phraseBars: 16, bars: 70 })
    ).toEqual([16, 32, 48, 64])
  })

  it('makes a change WAIT for the phrase rather than dropping it', () => {
    // `fast` (3-6 bars) against a 16-bar phrase is still one change per
    // phrase. Dropping the ones that fall between would make `slow` plus
    // `32 bars` nearly silent, which is not a setting anyone wants.
    expect(
      changesOver({ interval: 3, loopBars: 8, gridBars: 2, phraseBars: 16, bars: 50 })
    ).toEqual([16, 32, 48])
  })

  it('lands on the first phrase boundary at or after a long interval, with no special case', () => {
    // `slow` is 24-48 bars against a 16-bar phrase. 24 simply rounds up
    // to 32 -- the interval still has to elapse first, and the phrase is
    // a gate on top of it.
    expect(
      changesOver({ interval: 24, loopBars: 8, gridBars: 8, phraseBars: 16, bars: 70 })
    ).toEqual([32, 64])
  })

  it('counts a thirty-two the same way, on a shorter loop', () => {
    expect(
      changesOver({ interval: 8, loopBars: 4, gridBars: 4, phraseBars: 32, bars: 80 })
    ).toEqual([32, 64])
  })

  it('keeps the phrase origin across a change, so the grid does not walk', () => {
    // restartRadioInterval is the whole reason lapsSincePhrase lives on
    // the clock rather than being reset with it: createRadioClock starts
    // a NEW phrase (radio starting, a course change), this one starts a
    // new interval inside the phrase that is already running.
    const clock = restartRadioInterval(
      { barsElapsed: 9, intervalBars: 8, lastPos: 4, lapsSincePhrase: 1 },
      12,
      4
    )
    expect(clock).toEqual({ barsElapsed: 0, intervalBars: 12, lastPos: 4, lapsSincePhrase: 1 })
  })

  it('starts a fresh phrase when radio itself starts', () => {
    expect(createRadioClock(8, 2.5).lapsSincePhrase).toBe(0)
  })

  it('anchors the phrase to a loop top, not to the moment radio was switched on', () => {
    // Started at bar 2.5 of an 8-bar loop. The first phrase boundary is
    // still a loop top -- bar 16 of the loop's own counting, not bar 18.5
    // -- because otherwise a change would land mid-bar and the incoming
    // stem would enter partway through itself.
    let clock = createRadioClock(4, 2.5)
    let pos = 2.5
    let total = 0
    let fired: { pos: number; total: number } | null = null
    while (total < 40 && fired === null) {
      total += 0.02
      pos = (pos + 0.02) % 8
      const step = advanceRadioClock(clock, pos, 8, 2, 16)
      clock = step.clock
      if (step.due) fired = { pos, total }
    }
    expect(fired).not.toBeNull()
    // On a loop top, not mid-bar.
    expect((fired as { pos: number }).pos).toBeLessThan(0.05)
    // The SECOND loop top after the switch-on, i.e. 5.5 + 8. The phrase
    // origin is the loop top radio started inside, so it is two laps of
    // an 8-bar loop later -- never 16 bars measured from bar 2.5.
    expect((fired as { total: number }).total).toBeCloseTo(13.5, 1)
  })

  it('still reports every loop top as a wrap, because gestures are anchored there', () => {
    // The drop-out is anchored to the loop top and stays there: a phrase
    // grid governs CHANGES, not gestures.
    const clock = { barsElapsed: 1, intervalBars: 8, lastPos: 7.9, lapsSincePhrase: 0 }
    const step = advanceRadioClock(clock, 0.02, 8, 8, 32)
    expect(step.wrapped).toBe(true)
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

describe('radioChangeBars', () => {
  // The half of the phase argument that the outgoing layer's length alone
  // does not cover. 687641a's bad case is an 8-bar stem ENTERING at bar 4
  // of an 8-bar loop, and the entering stem is not the one being
  // replaced: a slot holding a 2-bar hat can draw an 8-bar pad next. So
  // both lengths decide the boundary, and the longer one wins -- at a
  // multiple of the longer, a shorter power-of-two cycle is at its own
  // zero too.
  it('is the longer of the outgoing and the incoming layer', () => {
    expect(radioChangeBars(2, 8)).toBe(8)
    expect(radioChangeBars(8, 2)).toBe(8)
    expect(radioChangeBars(4, 4)).toBe(4)
  })

  it('is unknown when either side is, so the change waits for the loop top', () => {
    expect(radioChangeBars(null, 4)).toBeNull()
    expect(radioChangeBars(4, null)).toBeNull()
    expect(radioChangeBars(null, null)).toBeNull()
    // Which is what radioGridBars does with a null.
    expect(radioGridBars(4, 8, radioChangeBars(2, null))).toBe(8)
  })

  it('sends a long incoming layer to the loop top even when the outgoing one is short', () => {
    // The whole point: a 2-bar hat being replaced by an 8-bar pad is the
    // cut he described, and the threshold has to catch it.
    expect(radioGridBars(4, 8, radioChangeBars(2, 8))).toBe(8)
    expect(radioGridBars(4, 8, radioChangeBars(2, 2))).toBe(2)
  })
})

describe('the threshold and long phrases', () => {
  // Reported 2026-09-28, listening: "it cut off just now... can the
  // transitions for the stems longer than 8 bars be the complete loop
  // only?" A short layer swapped on its own cycle is unremarkable -- a
  // two-bar hat turning over at bar 2 of 8 reads as a variation. A long
  // phrase is a musical statement, and cutting one partway through the
  // loop is audible however cleanly the boundary is hit. That rule used
  // to be the hardcoded GRID_LONG_PHRASE_BARS; it is now the setting
  // itself, which is the whole point of the change.
  it('gives a long stem the whole loop, not its own shorter cycle', () => {
    expect(radioGridBars(8, 16, 12)).toBe(16)
    expect(radioGridBars(8, 16, 9)).toBe(16)
  })

  it('leaves short stems on their own cycle, which is the point of the threshold', () => {
    expect(radioGridBars(8, 16, 2)).toBe(2)
    expect(radioGridBars(8, 16, 4)).toBe(4)
    expect(radioGridBars(8, 16, 8)).toBe(8)
  })

  it('moves the ceiling with the setting rather than fixing it at eight', () => {
    // The old constant was 8 for everyone. At `2 bars` a four-bar layer is
    // long, and at `8 bars` it is not.
    expect(radioGridBars(2, 16, 4)).toBe(16)
    expect(radioGridBars(8, 16, 4)).toBe(4)
  })

  it('still caps to the loop when the loop is itself short', () => {
    expect(radioGridBars(8, 4, 12)).toBe(4)
  })
})

describe('a pace window he can set himself', () => {
  it('is one bar at the tightest and sixty-four at the loosest', () => {
    // Elling, 2026-09-28: "maybe allow for a specific range selection
    // instead of just slow mid and fast?". The presets stay as starting
    // points; this is where he settles. 64 bars is over two minutes at
    // 120bpm, which is further than `slow` goes and far enough.
    expect(RADIO_PACE_WINDOW_MIN).toBe(1)
    expect(RADIO_PACE_WINDOW_MAX).toBe(64)
  })

  it('falls back to the named preset window when nothing is stored', () => {
    expect(normalizeRadioPaceWindow(undefined, 'mid')).toEqual(RADIO_PACE_BARS.mid)
    expect(normalizeRadioPaceWindow(null, 'fast')).toEqual(RADIO_PACE_BARS.fast)
    expect(normalizeRadioPaceWindow('nonsense', 'slow')).toEqual(RADIO_PACE_BARS.slow)
    expect(normalizeRadioPaceWindow({ min: 'a', max: 'b' }, 'mid')).toEqual(RADIO_PACE_BARS.mid)
  })

  it('keeps a stored window he set himself', () => {
    expect(normalizeRadioPaceWindow({ min: 5, max: 9 }, 'mid')).toEqual({ min: 5, max: 9 })
  })

  it('clamps, floors and orders rather than throwing', () => {
    expect(normalizeRadioPaceWindow({ min: 0, max: 900 }, 'mid')).toEqual({ min: 1, max: 64 })
    expect(normalizeRadioPaceWindow({ min: 6.7, max: 9.2 }, 'mid')).toEqual({ min: 6, max: 9 })
    // A max below the min is a stored value that got crossed over; the
    // min wins, because that is the one he was most recently dragging
    // toward.
    expect(normalizeRadioPaceWindow({ min: 12, max: 4 }, 'mid')).toEqual({ min: 12, max: 12 })
  })

  it('names the preset a window matches, and null for one he tuned', () => {
    expect(radioPaceWindowPreset(RADIO_PACE_BARS.slow)).toBe('slow')
    expect(radioPaceWindowPreset(RADIO_PACE_BARS.mid)).toBe('mid')
    expect(radioPaceWindowPreset(RADIO_PACE_BARS.fast)).toBe('fast')
    expect(radioPaceWindowPreset({ min: 5, max: 9 })).toBeNull()
  })

  it('steps one edge at a time and never lets them cross', () => {
    expect(adjustRadioPaceWindow({ min: 8, max: 16 }, 'min', 1)).toEqual({ min: 9, max: 16 })
    expect(adjustRadioPaceWindow({ min: 8, max: 16 }, 'max', -1)).toEqual({ min: 8, max: 15 })
    // A min pushed past the max drags the max with it, and vice versa --
    // an inverted window would draw no interval at all.
    expect(adjustRadioPaceWindow({ min: 16, max: 16 }, 'min', 1)).toEqual({ min: 17, max: 17 })
    expect(adjustRadioPaceWindow({ min: 8, max: 8 }, 'max', -1)).toEqual({ min: 7, max: 7 })
  })

  it('stops at the ends rather than wrapping', () => {
    expect(adjustRadioPaceWindow({ min: 1, max: 4 }, 'min', -1)).toEqual({ min: 1, max: 4 })
    expect(adjustRadioPaceWindow({ min: 4, max: 64 }, 'max', 1)).toEqual({ min: 4, max: 64 })
  })

  it('draws an interval from a window, the same way a pace does', () => {
    expect(nextRadioIntervalBarsInWindow({ min: 5, max: 9 }, () => 0)).toBe(5)
    expect(nextRadioIntervalBarsInWindow({ min: 5, max: 9 }, () => 0.999)).toBe(9)
    expect(nextRadioIntervalBarsInWindow({ min: 7, max: 7 }, () => 0.5)).toBe(7)
    // The preset path is the window path with the preset's own numbers.
    expect(nextRadioIntervalBarsInWindow(RADIO_PACE_BARS.mid, () => 0)).toBe(
      nextRadioIntervalBars('mid', () => 0)
    )
  })
})

describe('RadioSettings', () => {
  it('defaults to mid, the mid window, four bars, no phrase grid, four channels, subtle, rare and even', () => {
    expect(DEFAULT_RADIO_SETTINGS).toEqual({
      pace: 'mid',
      paceBars: { min: 8, max: 16 },
      loopEndOverBars: 4,
      phraseBars: 0,
      channels: 4,
      transitions: 'subtle',
      dropOuts: 'rare',
      turnover: 'even'
    })
  })

  it('normalizes a whole object, field by field, never throwing', () => {
    expect(normalizeRadioSettings({ pace: 'fast', loopEndOverBars: 2, channels: 6 })).toEqual({
      ...DEFAULT_RADIO_SETTINGS,
      pace: 'fast',
      paceBars: RADIO_PACE_BARS.fast,
      loopEndOverBars: 2,
      channels: 6
    })
    expect(normalizeRadioSettings(null)).toEqual(DEFAULT_RADIO_SETTINGS)
    expect(normalizeRadioSettings('nonsense')).toEqual(DEFAULT_RADIO_SETTINGS)
    expect(normalizeRadioSettings({ pace: 'glacial', loopEndOverBars: 99 })).toEqual(
      DEFAULT_RADIO_SETTINGS
    )
  })

  it('migrates a stored change-on grid to the threshold that means the same', () => {
    // 1.3.x wrote a `grid` word. Nobody's settings file may throw or
    // silently change what they were hearing more than the new model
    // forces: `loop end` is `always`, and the three explicit grids keep
    // their number. `own loop` has no threshold that means it, so it takes
    // the default.
    expect(normalizeRadioSettings({ grid: 'loop end' }).loopEndOverBars).toBe(0)
    expect(normalizeRadioSettings({ grid: '8 bars' }).loopEndOverBars).toBe(8)
    expect(normalizeRadioSettings({ grid: '4 bars' }).loopEndOverBars).toBe(4)
    expect(normalizeRadioSettings({ grid: '2 bars' }).loopEndOverBars).toBe(2)
    expect(normalizeRadioSettings({ grid: 'own loop' }).loopEndOverBars).toBe(
      DEFAULT_RADIO_LOOP_END_BARS
    )
    expect(normalizeRadioSettings({}).loopEndOverBars).toBe(DEFAULT_RADIO_LOOP_END_BARS)
  })

  it('takes the stored window over the preset when there is one', () => {
    expect(normalizeRadioSettings({ pace: 'fast', paceBars: { min: 5, max: 9 } }).paceBars).toEqual(
      { min: 5, max: 9 }
    )
  })

  it('clamps the channel count to two through eight', () => {
    // 2026-09-28: "can we adjust settings to include 2 and 3 stems only".
    // The floor moved; the DEFAULT deliberately did not. They were one
    // constant until this change, and reusing the floor would have turned
    // the starting bed from a band into a duo as a side effect of adding
    // an option nobody asked to have chosen for them.
    expect(RADIO_CHANNELS_MIN).toBe(2)
    expect(RADIO_CHANNELS_MAX).toBe(8)
    expect(DEFAULT_RADIO_CHANNELS).toBe(4)
    expect(normalizeRadioSettings({ channels: 1 }).channels).toBe(2)
    expect(normalizeRadioSettings({ channels: 2 }).channels).toBe(2)
    expect(normalizeRadioSettings({ channels: 3 }).channels).toBe(3)
    expect(normalizeRadioSettings({ channels: 40 }).channels).toBe(8)
    expect(normalizeRadioSettings({ channels: 6.5 }).channels).toBe(6)
    // Not a number at all is not a clamp -- it is no answer, so it takes
    // the default rather than the floor.
    expect(normalizeRadioSettings({ channels: 'six' }).channels).toBe(4)
  })

  it('migrates a pre-2026-09-28 settings file, which stored the pace flat', () => {
    // Anyone running 1.3.0 has { radioPace: 'fast' } on disk and no
    // `radio` object at all. That value must survive, not throw and not
    // silently reset -- and it has to bring its window with it, since a
    // window is what the clock now draws from.
    expect(normalizeRadioSettings(undefined, 'fast')).toEqual({
      ...DEFAULT_RADIO_SETTINGS,
      pace: 'fast',
      paceBars: RADIO_PACE_BARS.fast
    })
    expect(normalizeRadioSettings(undefined, 'glacial').pace).toBe('mid')
    expect(normalizeRadioSettings({ pace: 'slow' }, 'fast').pace).toBe('slow')
  })

  it('offers even and random turnover, defaulting to even', () => {
    expect(RADIO_TURNOVER_OPTIONS).toEqual(['even', 'random'])
    expect(DEFAULT_RADIO_TURNOVER).toBe('even')
    expect(normalizeRadioTurnover('fair')).toBe('even')
  })
})

describe('radioStarterKinds', () => {
  it('lays down the shipped four at four', () => {
    expect(radioStarterKinds(4)).toEqual(['drums', 'bass', 'lead', 'warm'])
  })

  it('adds a second drum layer fifth -- a groove gets its top end from perc', () => {
    expect(radioStarterKinds(5)).toEqual(['drums', 'bass', 'lead', 'warm', 'drums'])
  })

  it('grows from the left, so every prefix still sounds like a band', () => {
    expect(radioStarterKinds(8)).toEqual([
      'drums',
      'bass',
      'lead',
      'warm',
      'drums',
      'bright',
      'rhythmic',
      'lead'
    ])
    for (let n = 4; n <= 8; n++) {
      expect(radioStarterKinds(n)).toEqual(radioStarterKinds(8).slice(0, n))
    }
  })

  it('clamps out of range rather than throwing', () => {
    // Zero is a number, so it clamps to the floor -- which is 2 since
    // 2026-09-28, not the default 4. Only a non-number takes the default.
    expect(radioStarterKinds(0)).toHaveLength(2)
    expect(radioStarterKinds(99)).toHaveLength(8)
  })

  it('makes a band out of every small bed, not just the big ones', () => {
    // The starter ORDER already carries this -- its own comment insists
    // every prefix has to stand alone -- so 2 and 3 needed no special
    // case, only a lower floor.
    expect(radioStarterKinds(2)).toEqual(['drums', 'bass'])
    expect(radioStarterKinds(3)).toEqual(['drums', 'bass', 'lead'])
  })
})

describe('radioChangeDueAtNextWrap', () => {
  // The predicate the staged swap is built on: can the renderer tell,
  // DURING a lap, that the next change comes due at the wrap that ends it?
  // Only then can it push the project early and have the engine make it
  // real exactly at the loop top.
  const clockAt = (barsElapsed: number, intervalBars: number, lapsSincePhrase = 0): RadioClock => ({
    barsElapsed,
    intervalBars,
    lastPos: 0,
    lapsSincePhrase
  })

  it('says yes when the interval runs out exactly at the wrap', () => {
    // 8-bar loop, grid is the whole loop, 4 bars still to run and 4 bars
    // of lap left.
    expect(radioChangeDueAtNextWrap(clockAt(8, 12), 4, 8, 8, 0)).toBe(true)
  })

  it('says yes when the interval has ALREADY run out and the grid is the loop', () => {
    expect(radioChangeDueAtNextWrap(clockAt(14, 12), 2, 8, 8, 0)).toBe(true)
  })

  it('says no when the interval cannot run out before the wrap', () => {
    // 6 bars still to run, only 4 bars of lap left.
    expect(radioChangeDueAtNextWrap(clockAt(6, 12), 4, 8, 8, 0)).toBe(false)
  })

  it('says no when a finer grid gives the change an earlier boundary', () => {
    // A 2-bar grid in an 8-bar loop: the interval runs out at bar 5, so the
    // change comes due crossing bar 6, not at the wrap.
    expect(radioChangeDueAtNextWrap(clockAt(11, 12), 4, 8, 2, 0)).toBe(false)
  })

  it('says yes on a finer grid when the LAST cell of the lap is the one', () => {
    // Same 2-bar grid, but the interval only runs out at bar 7 -- the next
    // boundary crossed is the wrap itself.
    expect(radioChangeDueAtNextWrap(clockAt(11, 12), 6, 8, 2, 0)).toBe(true)
  })

  it('agrees with advanceRadioClock about where the change actually lands', () => {
    // The property that matters: whenever this says yes, running the clock
    // forward at 30Hz really does produce `due` on the wrap tick and on no
    // tick before it.
    const loopBars = 8
    const gridBars = 2
    const tick = 1 / 60 // bars per 30Hz tick at 120bpm
    for (let startPos = 0; startPos < loopBars; startPos += 0.25) {
      for (let barsElapsed = 0; barsElapsed <= 16; barsElapsed += 0.5) {
        let clock: RadioClock = {
          barsElapsed,
          intervalBars: 12,
          lastPos: startPos,
          lapsSincePhrase: 0
        }
        const predicted = radioChangeDueAtNextWrap(clock, startPos, loopBars, gridBars, 0)
        let pos = startPos
        let dueBeforeWrap = false
        let dueAtWrap = false
        for (;;) {
          pos += tick
          const wrapped = pos >= loopBars
          if (wrapped) pos -= loopBars
          const step = advanceRadioClock(clock, pos, loopBars, gridBars, 0)
          clock = step.clock
          if (step.due) {
            if (step.wrapped) dueAtWrap = true
            else dueBeforeWrap = true
          }
          if (wrapped) break
        }
        expect(predicted).toBe(dueAtWrap && !dueBeforeWrap)
      }
    }
  })

  it('holds a change to a wrap that is on the phrase, and refuses one that is not', () => {
    // 16-bar phrase over an 8-bar loop is two laps. One lap in, the coming
    // wrap IS the phrase boundary; fresh out of one, it is not.
    expect(radioChangeDueAtNextWrap(clockAt(14, 12, 1), 4, 8, 8, 16)).toBe(true)
    expect(radioChangeDueAtNextWrap(clockAt(14, 12, 0), 4, 8, 8, 16)).toBe(false)
  })

  it('ignores a finer grid entirely while a phrase grid is running', () => {
    // With a phrase grid on, only a loop top can ever be a landing, so the
    // change grid cannot pull the change earlier.
    expect(radioChangeDueAtNextWrap(clockAt(11, 12, 1), 4, 8, 2, 16)).toBe(true)
  })

  it('refuses nonsense rather than guessing', () => {
    expect(radioChangeDueAtNextWrap(clockAt(8, 12), 4, 0, 8, 0)).toBe(false)
    expect(radioChangeDueAtNextWrap(clockAt(8, 12), Number.NaN, 8, 8, 0)).toBe(false)
    expect(radioChangeDueAtNextWrap(clockAt(8, 12), 9, 8, 8, 0)).toBe(false)
  })
})
