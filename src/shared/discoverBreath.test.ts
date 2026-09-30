import { describe, expect, it } from 'vitest'
import { DISCOVER_BREATH_BARS, discoverBreath } from './discoverBreath'

describe('discoverBreath', () => {
  it('breathes once every 4 bars by default', () => {
    expect(DISCOVER_BREATH_BARS).toBe(4)
  })

  it('is 0 at the start of a breath, on a bar line', () => {
    expect(discoverBreath(0)).toBeCloseTo(0)
    expect(discoverBreath(8)).toBeCloseTo(0)
    expect(discoverBreath(400)).toBeCloseTo(0)
  })

  it('is 1 halfway through', () => {
    expect(discoverBreath(2)).toBeCloseTo(1)
    expect(discoverBreath(6)).toBeCloseTo(1)
  })

  it('is back to 0 at 4 bars', () => {
    expect(discoverBreath(4)).toBeCloseTo(0)
    expect(discoverBreath(4 - 1e-9)).toBeCloseTo(0)
  })

  it('eases in and out along a cosine', () => {
    expect(discoverBreath(1)).toBeCloseTo(0.5)
    expect(discoverBreath(3)).toBeCloseTo(0.5)
    expect(discoverBreath(0.5)).toBeCloseTo(0.5 - 0.5 * Math.cos(Math.PI / 4))
  })

  it('honours another period', () => {
    expect(discoverBreath(4, 8)).toBeCloseTo(1)
    expect(discoverBreath(8, 8)).toBeCloseTo(0)
  })

  it('is continuous across a loop wrap when fed absolute bars', () => {
    // A 3-bar loop: the lap wraps at 3, partway through a breath. Absolute
    // bars (lapIndex * loopBars + pos) carry on through it.
    const loopBars = 3
    const before = discoverBreath(0 * loopBars + (3 - 1e-6))
    const after = discoverBreath(1 * loopBars + 0)
    expect(Math.abs(after - before)).toBeLessThan(1e-4)
    // Three laps later the breath is not back where the loop started...
    expect(discoverBreath(1 * loopBars + 0)).toBeCloseTo(discoverBreath(3))
    // ...and four breaths of 3 bars line up with the loop top at 12.
    expect(discoverBreath(4 * loopBars + 0)).toBeCloseTo(0)
  })

  it('handles negative bars without jumping', () => {
    expect(discoverBreath(-2)).toBeCloseTo(1)
    expect(discoverBreath(-1)).toBeCloseTo(0.5)
  })

  it('returns a safe midpoint for non-finite input', () => {
    expect(discoverBreath(Number.NaN)).toBe(0.5)
    expect(discoverBreath(Number.POSITIVE_INFINITY)).toBe(0.5)
    expect(discoverBreath(2, Number.NaN)).toBe(0.5)
    expect(discoverBreath(2, 0)).toBe(0.5)
    expect(discoverBreath(2, -4)).toBe(0.5)
  })
})
