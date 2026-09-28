import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RADIO_TRANSITIONS,
  RADIO_TRANSITIONS_OPTIONS,
  buildBloomCurve,
  buildDuckCurve,
  buildFilterInCurve,
  buildTransitionRiser,
  normalizeRadioTransitions,
  pickTransition,
  radioGestureLeadsChange
} from './radioTransition'

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

describe('which gestures lead their change', () => {
  it('holds the change back for the two that announce one', () => {
    expect(radioGestureLeadsChange('hole')).toBe(true)
    expect(radioGestureLeadsChange('riser')).toBe(true)
  })

  it('lets the change land on time for the three that are an arrival', () => {
    expect(radioGestureLeadsChange('cut')).toBe(false)
    expect(radioGestureLeadsChange('filter in')).toBe(false)
    expect(radioGestureLeadsChange('bloom')).toBe(false)
    expect(radioGestureLeadsChange('duck')).toBe(false)
  })
})
