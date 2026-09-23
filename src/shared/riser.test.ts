import { describe, expect, it } from 'vitest'
import {
  MIN_RISER_LENGTH_BARS,
  RISER_DEFAULTS,
  RISER_NAME_PREFIX,
  RISER_TAIL_BARS,
  audibleRisers,
  createRiser,
  defaultRiserCurve,
  nextRiserName,
  normaliseLoadedRisers,
  normaliseRiser,
  riserCutoffAt,
  riserEndBar,
  riserEnvelopeAt,
  riserSoundingEndBar,
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
  it('is the bar the riser peaks on -- its right edge, not the end of its tail', () => {
    const riser = createRiser({ id: 'r1', channelId: 'ch1', startBar: 6, lengthBars: 4 })
    expect(riserEndBar(riser)).toBe(10)
  })
})

describe('riserSoundingEndBar', () => {
  it('is the riser plus its tail, which rings on past the end bar', () => {
    const riser = createRiser({ id: 'r1', channelId: 'ch1', startBar: 6, lengthBars: 4 })
    expect(riserSoundingEndBar(riser)).toBeCloseTo(10 + RISER_TAIL_BARS, 12)
  })

  it('has a tail short enough to be a tail and long enough to be heard', () => {
    // Pinned as a note value rather than a number of milliseconds, because
    // that is the reason it is measured in bars at all: an eighth note rings
    // over the drop in time with it at any tempo. The engine's own
    // kRiserTailBars (native-engine/Source/NoiseRiser.h) is this same
    // number -- a hand-synced pair, like everything else on this boundary.
    expect(RISER_TAIL_BARS).toBe(0.125)
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

describe('riser names', () => {
  it('leaves a new riser unnamed, for the reducer to number', () => {
    expect(createRiser({ id: 'r1', channelId: 'ch1', startBar: 0 }).name).toBe('')
  })

  it('takes a name when one is handed to it', () => {
    const riser = createRiser({ id: 'r1', channelId: 'ch1', startBar: 0, name: 'lift' })
    expect(riser.name).toBe('lift')
  })

  it('numbers from one when nothing is named yet', () => {
    expect(nextRiserName({})).toBe(`${RISER_NAME_PREFIX} 1`)
  })

  it('skips every number already taken, whatever order they are in', () => {
    const risers = {
      a: { ...createRiser({ id: 'a', channelId: 'c', startBar: 0 }), name: 'riser 2' },
      b: { ...createRiser({ id: 'b', channelId: 'c', startBar: 0 }), name: 'riser 1' }
    }
    expect(nextRiserName(risers)).toBe('riser 3')
  })

  it('ignores a hand-typed name that is not a default one', () => {
    const risers = {
      a: { ...createRiser({ id: 'a', channelId: 'c', startBar: 0 }), name: 'the big one' }
    }
    expect(nextRiserName(risers)).toBe('riser 1')
  })

  it('trims a name and keeps an empty one empty', () => {
    const base = createRiser({ id: 'r1', channelId: 'ch1', startBar: 0 })
    expect(normaliseRiser({ ...base, name: '  lift  ' }).name).toBe('lift')
    expect(normaliseRiser({ ...base, name: '   ' }).name).toBe('')
  })
})

describe('riser mute', () => {
  it('starts unmuted', () => {
    expect(createRiser({ id: 'r1', channelId: 'ch1', startBar: 0 }).muted).toBe(false)
  })

  it('normalises anything that is not literally true to false', () => {
    const base = createRiser({ id: 'r1', channelId: 'ch1', startBar: 0 })
    expect(normaliseRiser({ ...base, muted: true }).muted).toBe(true)
    expect(normaliseRiser({ ...base, muted: false }).muted).toBe(false)
  })
})

describe('audibleRisers', () => {
  it('leaves out every muted riser', () => {
    const risers = {
      a: createRiser({ id: 'a', channelId: 'ch1', startBar: 0 }),
      b: { ...createRiser({ id: 'b', channelId: 'ch2', startBar: 4 }), muted: true }
    }
    expect(audibleRisers(risers).map((riser) => riser.id)).toEqual(['a'])
  })

  it('sorts by start bar, then by id, so a render never drifts by a few ULPs', () => {
    const risers = {
      late: createRiser({ id: 'late', channelId: 'ch1', startBar: 32 }),
      zz: createRiser({ id: 'zz', channelId: 'ch1', startBar: 0 }),
      aa: createRiser({ id: 'aa', channelId: 'ch1', startBar: 0 })
    }
    expect(audibleRisers(risers).map((riser) => riser.id)).toEqual(['aa', 'zz', 'late'])
  })

  it('normalises on the way out', () => {
    const risers = {
      bad: { ...createRiser({ id: 'bad', channelId: 'ch1', startBar: 0 }), lengthBars: NaN }
    }
    expect(audibleRisers(risers)[0].lengthBars).toBe(MIN_RISER_LENGTH_BARS)
  })
})

describe('normaliseLoadedRisers', () => {
  it('gives a save from before names existed a numbered one, deterministically', () => {
    const saved = {
      b: {
        id: 'b',
        channelId: 'chb',
        startBar: 4,
        lengthBars: 4,
        startCutoffValue: 0.3,
        endCutoffValue: 0.95,
        curve: [],
        level: 0.6
      },
      a: {
        id: 'a',
        channelId: 'cha',
        startBar: 0,
        lengthBars: 4,
        startCutoffValue: 0.3,
        endCutoffValue: 0.95,
        curve: [],
        level: 0.6
      }
    }
    const loaded = normaliseLoadedRisers(saved)
    expect(loaded.a.name).toBe('riser 1')
    expect(loaded.b.name).toBe('riser 2')
    expect(loaded.a.muted).toBe(false)
  })

  it('keeps a name that is already there and numbers around it', () => {
    const saved = {
      a: {
        id: 'a',
        channelId: 'cha',
        startBar: 0,
        lengthBars: 4,
        startCutoffValue: 0.3,
        endCutoffValue: 0.95,
        curve: [],
        level: 0.6,
        name: 'riser 1',
        muted: true
      },
      b: {
        id: 'b',
        channelId: 'chb',
        startBar: 4,
        lengthBars: 4,
        startCutoffValue: 0.3,
        endCutoffValue: 0.95,
        curve: [],
        level: 0.6
      }
    }
    const loaded = normaliseLoadedRisers(saved)
    expect(loaded.a.name).toBe('riser 1')
    expect(loaded.a.muted).toBe(true)
    expect(loaded.b.name).toBe('riser 2')
  })

  it('gives a riser with no channel a row of its own rather than dropping it', () => {
    const loaded = normaliseLoadedRisers({ a: { id: 'a', startBar: 0 } })
    expect(loaded.a.channelId).toBe('a')
    expect(loaded.a.lengthBars).toBe(RISER_DEFAULTS.lengthBars)
  })

  it('returns an empty record for a project saved before risers existed', () => {
    expect(normaliseLoadedRisers(undefined)).toEqual({})
  })
})
