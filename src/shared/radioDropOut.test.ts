import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RADIO_DROP_OUTS,
  buildDropOutCurve,
  DROP_OUT_ELIGIBLE_KINDS,
  RADIO_DROP_OUT_CHANCE,
  RADIO_DROP_OUT_OPTIONS,
  normalizeRadioDropOuts,
  pickDropOutBeats,
  pickDropOutSlotId,
  rollIntervalDropOut,
  shouldScheduleDropOut,
  type DropOutCandidate
} from './radioDropOut'
import {
  advanceRadioClock,
  createRadioClock,
  nextRadioIntervalBarsInWindow,
  radioChangeDueAtNextWrap,
  radioChangeLandsAtBar,
  restartRadioInterval
} from './radioSchedule'

/** A deterministic generator that walks a fixed list and then repeats it. */
function seeded(values: number[]): () => number {
  let i = 0
  return (): number => values[i++ % values.length]
}

describe('drop-out rate', () => {
  it('offers off, rare and often, and defaults to rare', () => {
    expect(RADIO_DROP_OUT_OPTIONS).toEqual(['off', 'rare', 'often'])
    expect(DEFAULT_RADIO_DROP_OUTS).toBe('rare')
  })

  it('normalizes anything unrecognised to rare', () => {
    expect(normalizeRadioDropOuts('always')).toBe('rare')
    expect(normalizeRadioDropOuts(undefined)).toBe('rare')
    expect(normalizeRadioDropOuts(1)).toBe('rare')
  })

  it('is sparse by default -- about one every eighty bars at mid pace', () => {
    // mid draws 8-16 bars (retuned 0eab8b4), mean 12. 12 / 0.15 = 80 bars,
    // nearly three minutes at 120bpm, and longer still once the `loop end`
    // grid rounds each interval up to the next loop top. Elling: "rarely i
    // think. since it's working quite well currently."
    expect(RADIO_DROP_OUT_CHANCE.rare).toBe(0.15)
    expect(RADIO_DROP_OUT_CHANCE.often).toBe(0.4)
    expect(RADIO_DROP_OUT_CHANCE.off).toBe(0)
  })

  it('never schedules one when off', () => {
    expect(shouldScheduleDropOut('off', seeded([0]))).toBe(false)
    expect(shouldScheduleDropOut('off', seeded([0.99]))).toBe(false)
  })

  it('schedules one only below the rate', () => {
    expect(shouldScheduleDropOut('rare', seeded([0.1]))).toBe(true)
    expect(shouldScheduleDropOut('rare', seeded([0.2]))).toBe(false)
    expect(shouldScheduleDropOut('often', seeded([0.2]))).toBe(true)
  })
})

describe('which layer drops out', () => {
  it('is drums or bass and nothing else', () => {
    expect(DROP_OUT_ELIGIBLE_KINDS).toEqual(['drums', 'bass'])
  })

  it('ignores a lead, a pad and a trait-only layer', () => {
    const pool = [
      { id: 'a', kinds: ['lead' as const] },
      { id: 'b', kinds: ['warm' as const] },
      { id: 'c', kinds: ['rhythmic' as const] }
    ]
    expect(pickDropOutSlotId(pool, seeded([0]))).toBeNull()
  })

  it('returns null rather than dropping the only audible layer', () => {
    expect(pickDropOutSlotId([{ id: 'a', kinds: ['drums' as const] }], seeded([0]))).toBeNull()
  })

  it('weights drums three to one over bass', () => {
    const pool = [
      { id: 'd', kinds: ['drums' as const] },
      { id: 'b', kinds: ['bass' as const] }
    ]
    // Total weight 3 + 1 = 4. A draw below 0.75 lands on drums.
    expect(pickDropOutSlotId(pool, seeded([0.74]))).toBe('d')
    expect(pickDropOutSlotId(pool, seeded([0.76]))).toBe('b')
  })

  it('treats a combination slot containing drums as drums', () => {
    const pool = [
      { id: 'd', kinds: ['drums' as const, 'rhythmic' as const] },
      { id: 'x', kinds: ['lead' as const] }
    ]
    expect(pickDropOutSlotId(pool, seeded([0.5]))).toBe('d')
  })
})

describe('how long a drop-out is', () => {
  it('is two beats most of the time, one or four sometimes', () => {
    // weights 0.2 / 0.5 / 0.3 over [1, 2, 4]
    expect(pickDropOutBeats(seeded([0.1]))).toBe(1)
    expect(pickDropOutBeats(seeded([0.5]))).toBe(2)
    expect(pickDropOutBeats(seeded([0.8]))).toBe(4)
    expect(pickDropOutBeats(seeded([0.9999]))).toBe(4)
  })
})

describe('the drop-out curve', () => {
  it('returns to full gain at bar 0 -- the top of the loop IS the anchor', () => {
    const curve = buildDropOutCurve(8, 2)
    expect(curve[0]).toEqual({ bar: 0, value: 1 })
  })

  it('leaves two beats before the wrap on an 8-bar loop', () => {
    // 2 beats of a 4/4 bar = 0.5 bars, so full gain holds to bar 7.5.
    const curve = buildDropOutCurve(8, 2)
    expect(curve[1]).toEqual({ bar: 7.5, value: 1 })
  })

  it('ramps down rather than stepping -- a hard gain step on a sounding source pops', () => {
    const curve = buildDropOutCurve(8, 2)
    expect(curve[2].bar).toBeGreaterThan(7.5)
    expect(curve[2].bar).toBeLessThan(7.55)
    expect(curve[2].value).toBe(0)
  })

  it('holds silence right through to the wrap', () => {
    const curve = buildDropOutCurve(8, 2)
    expect(curve[curve.length - 1]).toEqual({ bar: 8, value: 0 })
  })

  it('measures a one-beat and a four-beat drop backwards from the same wrap', () => {
    expect(buildDropOutCurve(8, 1)[1].bar).toBe(7.75)
    expect(buildDropOutCurve(8, 4)[1].bar).toBe(7)
  })

  it('works on a short loop', () => {
    const curve = buildDropOutCurve(2, 2)
    expect(curve[0]).toEqual({ bar: 0, value: 1 })
    expect(curve[1]).toEqual({ bar: 1.5, value: 1 })
    expect(curve[curve.length - 1]).toEqual({ bar: 2, value: 0 })
  })

  it('refuses to drop more than half the loop', () => {
    // A 4-beat drop on a 1-bar loop would silence the whole lap. Clamped
    // to half, the same rule FadeGain.cpp:33-51 already applies to fades.
    const curve = buildDropOutCurve(1, 4)
    expect(curve[1].bar).toBe(0.5)
  })

  it('returns an empty curve for a loop it cannot place a gesture in', () => {
    expect(buildDropOutCurve(0, 2)).toEqual([])
    expect(buildDropOutCurve(8, 0)).toEqual([])
  })

  it('is ascending in bar, which is what normaliseAutomationCurve expects', () => {
    const curve = buildDropOutCurve(8, 2)
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i].bar).toBeGreaterThan(curve[i - 1].bar)
    }
  })
})

/** mulberry32 -- a seeded generator, so the long runs below are the same
 * run every time. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return (): number => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const BED: DropOutCandidate[] = [
  { id: 'drums', kinds: ['drums'] },
  { id: 'bass', kinds: ['bass'] },
  { id: 'pad', kinds: ['rhythmic'] },
  { id: 'lead', kinds: ['lead'] }
]

describe('the interval roll', () => {
  const base = {
    rate: 'rare' as const,
    audible: BED,
    changedSlotId: 'pad',
    gestureArmed: false,
    clock: { intervalBars: 12, barsElapsed: 0 },
    pos: 0.02,
    loopBars: 8
  }

  it('drops a drums or bass row for a weighted number of beats when the roll hits', () => {
    expect(rollIntervalDropOut(base, seeded([0.1, 0.1, 0.5]))).toEqual({
      slotId: 'drums',
      beats: 2
    })
  })

  it('misses above the rate, and never rolls when off', () => {
    expect(rollIntervalDropOut(base, seeded([0.2]))).toBeNull()
    expect(rollIntervalDropOut({ ...base, rate: 'off' }, seeded([0]))).toBeNull()
  })

  it('never drops the row this interval turned over', () => {
    for (const r of [0, 0.3, 0.6, 0.99]) {
      const roll = rollIntervalDropOut({ ...base, changedSlotId: 'drums' }, seeded([0, r, 0.5]))
      expect(roll?.slotId).toBe('bass')
    }
  })

  it('never leaves silence -- the changed row does not count as audible company', () => {
    const two = [BED[0], BED[1]]
    expect(
      rollIntervalDropOut({ ...base, audible: two, changedSlotId: 'bass' }, seeded([0]))
    ).toBeNull()
  })

  it('gives the lap to a gesture already armed on it, without spending a draw', () => {
    let draws = 0
    const counting = (): number => {
      draws += 1
      return 0
    }
    expect(rollIntervalDropOut({ ...base, gestureArmed: true }, counting)).toBeNull()
    expect(draws).toBe(0)
  })

  it('never ends on the wrap the next change can land on -- one leading gesture per wrap', () => {
    // 9 bars left in the interval, 7.98 to the wrap: the change comes due
    // at the wrap after at the earliest, so this lap is free.
    expect(
      rollIntervalDropOut({ ...base, clock: { intervalBars: 9, barsElapsed: 0 } }, seeded([0]))
    ).not.toBeNull()
    // An interval exactly one lap long ends on the wrap, and which side of
    // it the change lands on is up to the 30Hz stream. The lap is the
    // change's.
    expect(
      rollIntervalDropOut({ ...base, clock: { intervalBars: 8, barsElapsed: 0 } }, seeded([0]))
    ).toBeNull()
    // A 16-bar loop, twelve bars to go: the next change lands in this
    // lap or on its wrap, whatever the grid.
    expect(
      rollIntervalDropOut(
        { ...base, loopBars: 16, clock: { intervalBars: 12, barsElapsed: 0 } },
        seeded([0])
      )
    ).toBeNull()
    // A held change landing a lap after its due tick: the clock restarted
    // back then, so most of the interval is already spent.
    expect(
      rollIntervalDropOut({ ...base, clock: { intervalBars: 12, barsElapsed: 8 } }, seeded([0]))
    ).toBeNull()
  })
})

/**
 * Radio's stage, reduced to the clock and the two moments a change can
 * happen. MIRRORS DiscoverPanel's stepRadioStage: (2) decides a change
 * early -- the wrap first (radioChangeDueAtNextWrap), then a bar in this
 * lap (radioChangeLandsAtBar), never while a gesture is armed, never on a
 * due tick -- and the wrap branch of the clock effect lands it, at the
 * wrap or on the bar it named. The due branch is kept as the fallback it
 * is. The order inside a tick is the panel's: landing, lap countdown,
 * early decision, due branch. Every pick is warm and every transition a
 * cut, which is the ordinary case: every change is decided early.
 *
 * Until this fix the panel rolled for a drop-out only in the due branch,
 * which an early decision pre-empts, so a run like this one heard none.
 *
 * `offGrid` moves the ticks off the bar grid: a random phase, and each
 * tick 1/60 bar +/- half of that, the way the 30Hz position stream
 * actually arrives. With it off every boundary is hit exactly.
 */
function simulateRadio(
  loopBars: number,
  gridBars: number,
  totalBars: number,
  seed: number,
  offGrid = false
): { changes: number; late: number; dropOuts: number; collisions: number } {
  const random = mulberry32(seed)
  const jitter = mulberry32(seed ^ 0x5eed)
  const pace = { min: 8, max: 16 }
  const tickBars = 1 / 60 // 30Hz at 120bpm
  let t = offGrid ? jitter() * loopBars : 0
  let clock = createRadioClock(nextRadioIntervalBarsInWindow(pace, random), t % loopBars)
  let held: { atBars: number | null } | null = null
  let dropOut: { lapsLeft: number } | null = null
  let turn = 0
  const result = { changes: 0, late: 0, dropOuts: 0, collisions: 0 }
  const land = (pos: number): void => {
    result.changes += 1
    turn += 1
    clock = restartRadioInterval(clock, nextRadioIntervalBarsInWindow(pace, random), pos)
    dropOut = null // clearRadioGesture
    const roll = rollIntervalDropOut(
      {
        rate: 'rare',
        audible: BED,
        changedSlotId: BED[turn % BED.length].id,
        gestureArmed: false,
        clock,
        pos,
        loopBars
      },
      random
    )
    if (roll !== null) {
      dropOut = { lapsLeft: 1 }
      result.dropOuts += 1
    }
  }
  const end = t + totalBars
  let tick = 0
  while (t < end) {
    tick += 1
    t = offGrid ? t + tickBars * (0.5 + jitter()) : tick / 60
    const pos = offGrid ? t % loopBars : (tick % (loopBars * 60)) / 60
    const lastPos = clock.lastPos
    const step = advanceRadioClock(clock, pos, loopBars, gridBars, 0)
    clock = step.clock
    // A drop-out armed coming into a wrap ends ON that wrap; any change
    // landing there too, by either path, is the collision.
    const endingDropOut = step.wrapped && dropOut !== null
    // The held change lands: at the wrap, or on the bar it named.
    const h = held as { atBars: number | null } | null
    const crossedHeldBar =
      h !== null && h.atBars !== null && !step.wrapped && pos >= h.atBars && lastPos < h.atBars
    if (h !== null && (step.wrapped || crossedHeldBar)) {
      if (endingDropOut) result.collisions += 1
      held = null
      land(pos)
      continue
    }
    // The lap countdown.
    if (step.wrapped && dropOut !== null) {
      const d = dropOut as { lapsLeft: number }
      dropOut = d.lapsLeft <= 1 ? null : { lapsLeft: d.lapsLeft - 1 }
    }
    // stepRadioStage (2): a drop-out is never a spent arrival, so it holds
    // the early decision exactly as the panel's gate does.
    if (!step.due && held === null && dropOut === null) {
      if (radioChangeDueAtNextWrap(clock, pos, loopBars, gridBars, 0)) held = { atBars: null }
      else {
        const at = radioChangeLandsAtBar(clock, pos, loopBars, gridBars, 0)
        if (at !== null) held = { atBars: at }
      }
    }
    if (step.due && held === null) {
      // The due branch: a change that nothing decided early.
      if (endingDropOut) result.collisions += 1
      result.late += 1
      land(pos)
    }
  }
  return result
}

describe('drop-outs happen at the documented rate when every change is decided early', () => {
  // RADIO_DROP_OUT_CHANCE's own doc: rolled once per interval, so at `mid`
  // (8-16 bars, mean 12) about one every 80 bars -- somewhat rarer in
  // practice because the grid rounds each interval up to a boundary.
  for (const [loopBars, gridBars] of [
    [4, 4],
    [8, 8],
    [8, 2]
  ]) {
    it(`on a ${loopBars}-bar loop with a ${gridBars}-bar grid`, () => {
      const totalBars = 200_000
      const run = simulateRadio(loopBars, gridBars, totalBars, 7 * loopBars + gridBars)
      expect(run.late).toBe(0)
      expect(run.collisions).toBe(0)
      const perInterval = run.dropOuts / run.changes
      // Just under RADIO_DROP_OUT_CHANCE.rare: an interval exactly one lap
      // long gives its only lap to the change that ends it.
      expect(perInterval).toBeGreaterThan(0.12)
      expect(perInterval).toBeLessThan(0.17)
      const barsPerDropOut = totalBars / run.dropOuts
      expect(barsPerDropOut).toBeGreaterThan(70)
      expect(barsPerDropOut).toBeLessThan(130)
    })
  }

  it('and never at the cost of an early decision, even where most laps belong to a change', () => {
    // A 16-bar loop at mid pace: an interval that starts at a wrap always
    // ends on or before the next one, so only the ones a short layer's
    // 4-bar grid lands mid-lap have a lap of their own. Those still get
    // their drop-out, and no change is ever pushed onto the late path by
    // one.
    const run = simulateRadio(16, 4, 200_000, 99)
    expect(run.late).toBe(0)
    expect(run.collisions).toBe(0)
    expect(run.dropOuts).toBeGreaterThan(0)
  })

  for (const [loopBars, gridBars] of [
    [4, 4],
    [8, 8],
    [8, 2],
    [16, 4]
  ]) {
    it(`never ends on a change's wrap when the ticks are off the grid (${loopBars}/${gridBars})`, () => {
      // Where an interval that ends on a wrap falls is up to the tick; the
      // half-bar margin in rollIntervalDropOut is what keeps a drop-out
      // off that wrap whichever side it falls.
      const run = simulateRadio(loopBars, gridBars, 200_000, 31 * loopBars + gridBars, true)
      expect(run.dropOuts).toBeGreaterThan(0)
      expect(run.collisions).toBe(0)
    })
  }
})
