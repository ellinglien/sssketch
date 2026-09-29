import { describe, expect, it } from 'vitest'
import {
  radioApproachBarsLeft,
  radioApproachFor,
  radioApproachLabel,
  radioApproachProgress,
  type RadioApproach
} from './radioApproach'

describe('radioApproachBarsLeft', () => {
  it('rounds up, so "1 bar" always means it has not happened yet', () => {
    expect(radioApproachBarsLeft(0, 8)).toBe(8)
    expect(radioApproachBarsLeft(4, 8)).toBe(4)
    expect(radioApproachBarsLeft(7.5, 8)).toBe(1)
    expect(radioApproachBarsLeft(7.01, 8)).toBe(1)
  })

  it('never goes below zero, however far past the boundary the tick lands', () => {
    expect(radioApproachBarsLeft(8, 8)).toBe(0)
    expect(radioApproachBarsLeft(9.4, 8)).toBe(0)
  })

  it('answers null rather than a number it cannot stand behind', () => {
    expect(radioApproachBarsLeft(0, 0)).toBeNull()
    expect(radioApproachBarsLeft(0, -4)).toBeNull()
    expect(radioApproachBarsLeft(Number.NaN, 8)).toBeNull()
    expect(radioApproachBarsLeft(0, Number.POSITIVE_INFINITY)).toBeNull()
  })
})

describe('radioApproachProgress', () => {
  it('is the fraction of the wait already run', () => {
    expect(radioApproachProgress(0, 8)).toBe(0)
    expect(radioApproachProgress(2, 8)).toBe(0.25)
    expect(radioApproachProgress(8, 8)).toBe(1)
  })

  it('clamps rather than overshooting when a tick lands past the boundary', () => {
    expect(radioApproachProgress(12, 8)).toBe(1)
    expect(radioApproachProgress(-1, 8)).toBe(0)
  })

  it('is zero when there is no interval to be a fraction of', () => {
    expect(radioApproachProgress(4, 0)).toBe(0)
    expect(radioApproachProgress(Number.NaN, 8)).toBe(0)
  })
})

describe('radioApproachFor', () => {
  const interval = { progress: 0.25, barsLeft: 6 }
  const loop = { progress: 0.75, barsLeft: 2 }

  it('says nothing at all about a slot radio is not about to change', () => {
    expect(
      radioApproachFor({
        slotId: 'c',
        armedSlotId: 'a',
        heldSlotId: 'b',
        interval,
        loop
      })
    ).toBeNull()
  })

  it('reads the armed slot against the interval clock', () => {
    expect(
      radioApproachFor({ slotId: 'a', armedSlotId: 'a', heldSlotId: null, interval, loop })
    ).toEqual({ state: 'armed', progress: 0.25, barsLeft: 6 })
  })

  it('reads the held slot against the loop, because that is what it waits for', () => {
    expect(
      radioApproachFor({ slotId: 'b', armedSlotId: null, heldSlotId: 'b', interval, loop })
    ).toEqual({ state: 'held', progress: 0.75, barsLeft: 2 })
  })

  it('lets held win, because a decided change outranks a coming one', () => {
    expect(
      radioApproachFor({ slotId: 'a', armedSlotId: 'a', heldSlotId: 'a', interval, loop })
    ).toEqual({ state: 'held', progress: 0.75, barsLeft: 2 })
  })

  it('clamps whatever progress it is handed', () => {
    expect(
      radioApproachFor({
        slotId: 'a',
        armedSlotId: 'a',
        heldSlotId: null,
        interval: { progress: 1.4, barsLeft: 0 },
        loop
      })
    ).toEqual({ state: 'armed', progress: 1, barsLeft: 0 })
  })
})

describe('radioApproachLabel', () => {
  const armed = (barsLeft: number | null): RadioApproach => ({
    state: 'armed',
    progress: 0.5,
    barsLeft
  })

  it('says where a held change lands, not how long it is', () => {
    expect(radioApproachLabel({ state: 'held', progress: 0.5, barsLeft: 3 })).toBe('at loop top')
  })

  it('counts the bars down, singular at one', () => {
    expect(radioApproachLabel(armed(12))).toBe('in 12 bars')
    expect(radioApproachLabel(armed(2))).toBe('in 2 bars')
    expect(radioApproachLabel(armed(1))).toBe('in 1 bar')
  })

  it('stops counting rather than saying "in 0 bars"', () => {
    expect(radioApproachLabel(armed(0))).toBe('this bar')
  })

  it('falls back to a length-free phrase when the bars are not known', () => {
    expect(radioApproachLabel(armed(null))).toBe('change coming')
  })

  it('never writes more than three words, whatever it is handed', () => {
    for (const bars of [null, 0, 1, 2, 48]) {
      expect(radioApproachLabel(armed(bars)).split(' ').length).toBeLessThanOrEqual(3)
    }
    expect(
      radioApproachLabel({ state: 'held', progress: 0, barsLeft: null }).split(' ').length
    ).toBe(3)
  })
})
