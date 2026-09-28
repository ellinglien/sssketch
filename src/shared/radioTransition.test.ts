import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RADIO_TRANSITIONS,
  RADIO_TRANSITIONS_OPTIONS,
  normalizeRadioTransitions,
  pickTransition
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
