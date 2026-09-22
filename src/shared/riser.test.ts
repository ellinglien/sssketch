import { describe, expect, it } from 'vitest'
import {
  MIN_RISER_LENGTH_BARS,
  RISER_DEFAULTS,
  createRiser,
  defaultRiserCurve,
  normaliseRiser,
  riserCutoffAt,
  riserEndBar,
  riserEnvelopeAt,
  risersOnChannel
} from './riser'

describe('createRiser', () => {
  it('drops a riser at the asked-for bar with the default sweep', () => {
    const riser = createRiser({ id: 'r1', channelId: 'ch1', startBar: 8 })
    expect(riser).toMatchObject({
      id: 'r1',
      channelId: 'ch1',
      startBar: 8,
      lengthBars: RISER_DEFAULTS.lengthBars,
      startCutoffValue: RISER_DEFAULTS.startCutoffValue,
      endCutoffValue: RISER_DEFAULTS.endCutoffValue,
      level: RISER_DEFAULTS.level
    })
  })

  it('seeds the drawable curve with the ramp the riser would play anyway', () => {
    const riser = createRiser({ id: 'r1', channelId: 'ch1', startBar: 0, lengthBars: 4 })
    expect(riser.curve).toEqual([
      { bar: 0, value: RISER_DEFAULTS.startCutoffValue },
      { bar: 4, value: RISER_DEFAULTS.endCutoffValue }
    ])
  })

  it('never places a riser before bar 0 or shorter than the minimum', () => {
    const riser = createRiser({ id: 'r1', channelId: 'ch1', startBar: -3, lengthBars: 0 })
    expect(riser.startBar).toBe(0)
    expect(riser.lengthBars).toBe(MIN_RISER_LENGTH_BARS)
  })
})

describe('defaultRiserCurve', () => {
  it('is exactly two points -- the two ends of the sweep', () => {
    expect(defaultRiserCurve(0.2, 0.9, 8)).toEqual([
      { bar: 0, value: 0.2 },
      { bar: 8, value: 0.9 }
    ])
  })
})

describe('normaliseRiser', () => {
  it('clamps every normalised field into [0,1]', () => {
    const riser = normaliseRiser({
      ...createRiser({ id: 'r1', channelId: 'ch1', startBar: 0 }),
      startCutoffValue: -4,
      endCutoffValue: 9,
      level: 3
    })
    expect(riser.startCutoffValue).toBe(0)
    expect(riser.endCutoffValue).toBe(1)
    expect(riser.level).toBe(1)
  })

  it('sorts and clamps the drawn curve the same way every other curve is', () => {
    const riser = normaliseRiser({
      ...createRiser({ id: 'r1', channelId: 'ch1', startBar: 0 }),
      curve: [
        { bar: 3, value: 2 },
        { bar: 1, value: -1 },
        { bar: Number.NaN, value: 0.5 }
      ]
    })
    expect(riser.curve).toEqual([
      { bar: 1, value: 0 },
      { bar: 3, value: 1 }
    ])
  })

  it('repairs a non-finite or negative geometry rather than passing it on', () => {
    const riser = normaliseRiser({
      ...createRiser({ id: 'r1', channelId: 'ch1', startBar: 0 }),
      startBar: Number.NaN,
      lengthBars: -2
    })
    expect(riser.startBar).toBe(0)
    expect(riser.lengthBars).toBe(MIN_RISER_LENGTH_BARS)
  })
})

describe('riserEndBar', () => {
  it('is the bar the riser stops sounding on', () => {
    const riser = createRiser({ id: 'r1', channelId: 'ch1', startBar: 6, lengthBars: 4 })
    expect(riserEndBar(riser)).toBe(10)
  })
})

describe('riserCutoffAt', () => {
  const riser = createRiser({ id: 'r1', channelId: 'ch1', startBar: 0, lengthBars: 4 })

  it('follows the drawn curve when there is one', () => {
    const drawn = {
      ...riser,
      curve: [
        { bar: 0, value: 0.1 },
        { bar: 4, value: 0.5 }
      ]
    }
    expect(riserCutoffAt(drawn, 0)).toBeCloseTo(0.1, 10)
    expect(riserCutoffAt(drawn, 2)).toBeCloseTo(0.3, 10)
    expect(riserCutoffAt(drawn, 4)).toBeCloseTo(0.5, 10)
  })

  it('falls back to a straight start->end ramp when the curve is cleared', () => {
    const cleared = { ...riser, curve: [], startCutoffValue: 0.2, endCutoffValue: 0.8 }
    expect(riserCutoffAt(cleared, 0)).toBeCloseTo(0.2, 10)
    expect(riserCutoffAt(cleared, 2)).toBeCloseTo(0.5, 10)
    expect(riserCutoffAt(cleared, 4)).toBeCloseTo(0.8, 10)
  })

  it('holds flat outside the cleared ramp rather than extrapolating past it', () => {
    const cleared = { ...riser, curve: [], startCutoffValue: 0.2, endCutoffValue: 0.8 }
    expect(riserCutoffAt(cleared, -1)).toBeCloseTo(0.2, 10)
    expect(riserCutoffAt(cleared, 99)).toBeCloseTo(0.8, 10)
  })
})

describe('riserEnvelopeAt', () => {
  it('starts at silence and reaches full level at the very end', () => {
    expect(riserEnvelopeAt(0)).toBe(0)
    expect(riserEnvelopeAt(1)).toBe(1)
  })

  it('swells -- it is below a straight line for the whole middle', () => {
    for (const p of [0.25, 0.5, 0.75]) {
      expect(riserEnvelopeAt(p)).toBeLessThan(p)
      expect(riserEnvelopeAt(p)).toBeGreaterThan(0)
    }
  })

  it('never leaves [0,1], including off the ends', () => {
    expect(riserEnvelopeAt(-1)).toBe(0)
    expect(riserEnvelopeAt(4)).toBe(1)
    expect(riserEnvelopeAt(Number.NaN)).toBe(0)
  })
})

describe('risersOnChannel', () => {
  it("returns that channel's risers in start-bar order", () => {
    const risers = {
      a: createRiser({ id: 'a', channelId: 'ch1', startBar: 12 }),
      b: createRiser({ id: 'b', channelId: 'ch2', startBar: 0 }),
      c: createRiser({ id: 'c', channelId: 'ch1', startBar: 4 })
    }
    expect(risersOnChannel(risers, 'ch1').map((r) => r.id)).toEqual(['c', 'a'])
    expect(risersOnChannel(risers, 'ch2').map((r) => r.id)).toEqual(['b'])
    expect(risersOnChannel(risers, 'nope')).toEqual([])
  })
})
