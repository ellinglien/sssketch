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
  shouldScheduleDropOut
} from './radioDropOut'

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
