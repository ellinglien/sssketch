import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RADIO_TRANSITIONS,
  RADIO_TRANSITIONS_OPTIONS,
  buildBloomCurve,
  buildDuckCurve,
  buildFilterInCurve,
  applyRiserCharacter,
  buildTransitionRiser,
  normalizeRadioTransitions,
  RISER_SWEEP_POINTS,
  pickTransition,
  radioArrivalGestureSpent,
  radioChangeWaitsForLoopTop,
  radioGestureLeadsChange
} from './radioTransition'
import { riserCutoffAt } from './riser'
import { RISER_BEFORE, riserCharacterForId } from './riserCharacter'

/** A deterministic generator that walks a fixed list and then repeats it. */
function seeded(values: number[]): () => number {
  let i = 0
  return (): number => values[i++ % values.length]
}

describe('transition temperament', () => {
  it('offers off, subtle and bold, defaulting to subtle', () => {
    expect(RADIO_TRANSITIONS_OPTIONS).toEqual(['off', 'subtle', 'bold'])
    expect(DEFAULT_RADIO_TRANSITIONS).toBe('subtle')
    expect(normalizeRadioTransitions('wild')).toBe('subtle')
  })

  it('is always a hard cut when off -- exactly what shipped', () => {
    expect(pickTransition('off', ['drums'], seeded([0]))).toBe('cut')
    expect(pickTransition('off', ['warm'], seeded([0.99]))).toBe('cut')
  })

  it('never blooms a drum layer, at any temperament', () => {
    for (const t of ['subtle', 'bold'] as const) {
      for (let i = 0; i < 20; i++) {
        expect(pickTransition(t, ['drums'], seeded([i / 20]))).not.toBe('bloom')
      }
    }
  })

  it('is mostly cut and hole on a drum layer at subtle', () => {
    const picks = Array.from({ length: 20 }, (_, i) =>
      pickTransition('subtle', ['drums'], seeded([i / 20]))
    )
    expect(picks.filter((p) => p === 'cut' || p === 'hole').length).toBeGreaterThan(14)
  })

  it('reaches for filter in and bloom on a pad', () => {
    const picks = new Set(
      Array.from({ length: 20 }, (_, i) => pickTransition('bold', ['warm'], seeded([i / 20])))
    )
    expect(picks.has('filter in')).toBe(true)
    expect(picks.has('bloom')).toBe(true)
  })

  it('only reaches riser and duck at bold', () => {
    const subtle = new Set(
      Array.from({ length: 40 }, (_, i) => pickTransition('subtle', ['lead'], seeded([i / 40])))
    )
    expect(subtle.has('riser')).toBe(false)
    expect(subtle.has('duck')).toBe(false)
    const bold = new Set(
      Array.from({ length: 40 }, (_, i) => pickTransition('bold', ['lead'], seeded([i / 40])))
    )
    expect(bold.has('riser') || bold.has('duck')).toBe(true)
  })

  it('falls back to cut for a kind set it has no opinion about', () => {
    expect(pickTransition('subtle', [], seeded([0.5]))).toBe('cut')
  })
})

describe('transition curves', () => {
  it('filter in opens from closed at the loop top', () => {
    const c = buildFilterInCurve(8, 1)
    expect(c[0]).toEqual({ bar: 0, value: 0 })
    expect(c[c.length - 1]).toEqual({ bar: 1, value: 1 })
  })

  it('bloom starts drenched and dries out', () => {
    const c = buildBloomCurve(8, 2)
    expect(c[0]).toEqual({ bar: 0, value: 0.7 })
    expect(c[c.length - 1]).toEqual({ bar: 2, value: 0 })
  })

  it('duck dips the other layers and recovers', () => {
    const c = buildDuckCurve(8, 1)
    expect(c[0]).toEqual({ bar: 0, value: 0.45 })
    expect(c[c.length - 1]).toEqual({ bar: 1, value: 1 })
  })

  it('clamps every curve to half the loop, so none runs into its own anchor', () => {
    expect(buildFilterInCurve(1, 4)[1].bar).toBe(0.5)
    expect(buildBloomCurve(1, 4)[1].bar).toBe(0.5)
    expect(buildDuckCurve(1, 4)[1].bar).toBe(0.5)
  })

  it('returns nothing for a loop it cannot place a gesture in', () => {
    expect(buildFilterInCurve(0, 1)).toEqual([])
    expect(buildBloomCurve(8, 0)).toEqual([])
    expect(buildDuckCurve(-1, 1)).toEqual([])
  })

  it('builds a riser that ENDS at the loop top it announces', () => {
    const r = buildTransitionRiser('chan-1', 8, 2)
    expect(r).not.toBeNull()
    expect(r!.startBar).toBe(6)
    expect(r!.lengthBars).toBe(2)
    expect(r!.endCutoffValue).toBeGreaterThan(r!.startCutoffValue)
    expect(r!.channelId).toBe('chan-1')
    expect(r!.muted).toBe(false)
  })

  it('will not build a riser longer than half the loop', () => {
    expect(buildTransitionRiser('c', 2, 4)!.lengthBars).toBe(1)
  })

  it('returns no riser for a loop it cannot place one in', () => {
    expect(buildTransitionRiser('c', 0, 2)).toBeNull()
    expect(buildTransitionRiser('c', 8, 0)).toBeNull()
  })
})

describe('riser variety (native radio sound plan, Task 6)', () => {
  const today = {
    id: 'radio-riser-g',
    channelId: 'g',
    startBar: 6,
    lengthBars: 2,
    startCutoffValue: 0.2,
    endCutoffValue: 0.95,
    curve: [],
    level: 0.35,
    name: 'radio',
    muted: false
  }

  it("variety off is today's riser exactly, field for field", () => {
    expect(buildTransitionRiser('g', 8, 2)).toStrictEqual(today)
    expect(buildTransitionRiser('g', 8, 2, {})).toStrictEqual(today)
    expect(buildTransitionRiser('g', 8, 2, { variety: false })).toStrictEqual(today)
  })

  it('variety on draws the character seeded from the riser id, and puts it in the fields', () => {
    const r = buildTransitionRiser('g', 8, 2, { variety: true })!
    const c = riserCharacterForId('radio-riser-g')
    // the timing and identity are buildTransitionRiser's, always
    expect(r).toMatchObject({
      id: today.id,
      channelId: 'g',
      startBar: 6,
      lengthBars: 2,
      name: 'radio',
      muted: false
    })
    expect(r.level).toBeCloseTo(0.35 * Math.pow(10, c.levelDb / 20), 12)
    expect(r).toMatchObject({ q: c.q, colour: c.colour, stereo: c.stereo, send: c.send })
    expect(r.startCutoffValue).toBe(c.startCutoff)
    expect(r.endCutoffValue).toBe(c.endCutoff)
    // the sweep: start + (end - start) * p^curve as 17 points over the riser's length
    expect(r.curve).toHaveLength(RISER_SWEEP_POINTS)
    expect(r.curve[0]).toEqual({ bar: 0, value: c.startCutoff })
    expect(r.curve[16].bar).toBe(2)
    expect(r.curve[16].value).toBeCloseTo(c.endCutoff, 12)
    expect(r.curve[8].bar).toBe(1)
    expect(r.curve[8].value).toBeCloseTo(
      c.startCutoff + (c.endCutoff - c.startCutoff) * Math.pow(0.5, c.curve),
      12
    )
    // and the engine's riserCutoffAt follows it
    expect(riserCutoffAt(r, 0.5)).toBeCloseTo(
      c.startCutoff + (c.endCutoff - c.startCutoff) * Math.pow(0.25, c.curve),
      12
    )
  })

  it('the same id gives the same character (a re-sync redraws it); ids vary it', () => {
    expect(buildTransitionRiser('g', 8, 2, { variety: true })).toStrictEqual(
      buildTransitionRiser('g', 8, 2, { variety: true })
    )
    expect(riserCharacterForId('radio-riser-x')).toStrictEqual(riserCharacterForId('radio-riser-x'))
    const characters = Array.from({ length: 200 }, (_, i) =>
      riserCharacterForId(`radio-riser-${i}`)
    )
    expect(new Set(characters.map((c) => c.q)).size).toBeGreaterThan(150)
    expect(characters.some((c) => c.colour === 'pink')).toBe(true)
    expect(characters.some((c) => c.colour === 'white')).toBe(true)
    expect(characters.some((c) => c.stereo === 'mono')).toBe(true)
  })

  it('a riser armed once keeps its id and character across re-syncs (fresh groupIds); a new arming redraws', () => {
    // Discover mints a fresh groupId (the riser's channel) on every rebuild; the arming's key
    // is what stays.
    const first = buildTransitionRiser('group-a', 8, 2, { variety: true, armId: 'arm-1' })!
    const resync = buildTransitionRiser('group-b', 8, 2, { variety: true, armId: 'arm-1' })!
    expect(resync.id).toBe('radio-riser-arm-1')
    expect(resync.id).toBe(first.id)
    expect(resync.channelId).toBe('group-b') // still routed to the preview's channel
    expect({ ...resync, channelId: 'x' }).toStrictEqual({ ...first, channelId: 'x' })
    // different armings draw different characters (200 armings, nearly all distinct)
    const qs = new Set(
      Array.from(
        { length: 200 },
        (_, i) => buildTransitionRiser('group-a', 8, 2, { variety: true, armId: `arm-${i}` })!.q
      )
    )
    expect(qs.size).toBeGreaterThan(190)
  })

  it("variety off ignores the arming and keeps today's id (wire-identical); no armId falls back to the channel", () => {
    expect(buildTransitionRiser('g', 8, 2, { variety: false, armId: 'arm-1' })).toStrictEqual(today)
    expect(buildTransitionRiser('g', 8, 2, { variety: true, armId: '' })!.id).toBe('radio-riser-g')
    expect(buildTransitionRiser('g', 8, 2, { variety: true })!.id).toBe('radio-riser-g')
  })

  it("applying today's character keeps today's sound fields (Q 2, white, wide, no send, the same level and ends)", () => {
    const r = applyRiserCharacter(today, RISER_BEFORE)
    expect(r).toMatchObject({ q: 2, colour: 'white', stereo: 'wide', send: 0, level: 0.35 })
    expect(r.startCutoffValue).toBe(0.2)
    expect(r.endCutoffValue).toBe(0.95)
    for (let bar = 0; bar <= 2; bar += 0.125) {
      expect(riserCutoffAt(r, bar)).toBeCloseTo(riserCutoffAt(today, bar), 12)
    }
  })
})

describe('which gestures lead their change', () => {
  it('holds the change back for the two that announce one', () => {
    expect(radioGestureLeadsChange('hole')).toBe(true)
    expect(radioGestureLeadsChange('riser')).toBe(true)
  })

  it('arms the three arrival gestures on the change itself', () => {
    expect(radioGestureLeadsChange('cut')).toBe(false)
    expect(radioGestureLeadsChange('filter in')).toBe(false)
    expect(radioGestureLeadsChange('bloom')).toBe(false)
    expect(radioGestureLeadsChange('duck')).toBe(false)
  })
})

describe('which changes wait for the loop top', () => {
  it('never holds a cut -- it arms nothing, so it keeps the pace it was tuned to', () => {
    expect(radioChangeWaitsForLoopTop('cut', false)).toBe(false)
    expect(radioChangeWaitsForLoopTop('cut', true)).toBe(false)
  })

  it('always holds a leading gesture, even when the change was already due at the top', () => {
    // The gesture plays out over the lap BEFORE the change, so a hole due
    // at bar 0 announces the wrap after this one, not this one.
    expect(radioChangeWaitsForLoopTop('hole', true)).toBe(true)
    expect(radioChangeWaitsForLoopTop('hole', false)).toBe(true)
    expect(radioChangeWaitsForLoopTop('riser', true)).toBe(true)
    expect(radioChangeWaitsForLoopTop('riser', false)).toBe(true)
  })

  it('holds an arrival gesture only when the boundary is not the loop top', () => {
    expect(radioChangeWaitsForLoopTop('filter in', false)).toBe(true)
    expect(radioChangeWaitsForLoopTop('bloom', false)).toBe(true)
    expect(radioChangeWaitsForLoopTop('duck', false)).toBe(true)
  })

  it('lets an arrival gesture land on the spot when the boundary already IS the loop top', () => {
    // Its curve starts at bar 0, so nothing is lost and nothing is gained
    // by waiting a whole lap.
    expect(radioChangeWaitsForLoopTop('filter in', true)).toBe(false)
    expect(radioChangeWaitsForLoopTop('bloom', true)).toBe(false)
    expect(radioChangeWaitsForLoopTop('duck', true)).toBe(false)
  })
})

describe('when an arrival gesture has finished playing', () => {
  const bloom = { kind: 'bloom' as const, beats: 4, lapsLeft: 1 }

  it('is still playing inside its own curve', () => {
    // 4 beats = 1 bar: the curve runs bar 0 to bar 1.
    expect(radioArrivalGestureSpent(bloom, 0.5, 8)).toBe(false)
  })

  it('is spent once the playhead is past the curve, for every arrival kind', () => {
    expect(radioArrivalGestureSpent(bloom, 1, 8)).toBe(true)
    expect(radioArrivalGestureSpent({ ...bloom, kind: 'filter in' }, 3, 8)).toBe(true)
    expect(radioArrivalGestureSpent({ ...bloom, kind: 'duck' }, 7.9, 8)).toBe(true)
  })

  it('measures against the same half-loop clamp the curve was built with', () => {
    // 8 beats would be 2 bars, but a 2-bar loop clamps every curve to 1.
    expect(radioArrivalGestureSpent({ ...bloom, beats: 8 }, 1, 2)).toBe(true)
    expect(radioArrivalGestureSpent({ ...bloom, beats: 8 }, 1, 8)).toBe(false)
  })

  it('is never spent while it still has another lap to run', () => {
    expect(radioArrivalGestureSpent({ ...bloom, lapsLeft: 2 }, 7, 8)).toBe(false)
  })

  it('never calls a drop-out or a leading gesture spent -- those sit at the END of the lap', () => {
    expect(radioArrivalGestureSpent({ ...bloom, kind: 'drop-out' }, 7.9, 8)).toBe(false)
    expect(radioArrivalGestureSpent({ ...bloom, kind: 'hole' }, 7.9, 8)).toBe(false)
    expect(radioArrivalGestureSpent({ ...bloom, kind: 'riser' }, 7.9, 8)).toBe(false)
  })

  it('says no when it cannot place the curve at all', () => {
    expect(radioArrivalGestureSpent(bloom, 3, 0)).toBe(false)
    expect(radioArrivalGestureSpent(bloom, Number.NaN, 8)).toBe(false)
  })
})
