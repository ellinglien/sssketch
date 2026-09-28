import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RADIO_DROP_OUTS,
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
