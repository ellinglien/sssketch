import { describe, expect, it } from 'vitest'
import {
  computeGrabOffsetBars,
  applyGrabOffset,
  setGrabOffsetBars,
  getGrabOffsetBars
} from './dragGrabOffset'

describe('computeGrabOffsetBars', () => {
  it('is 0 when grabbed exactly at the clip start', () => {
    expect(computeGrabOffsetBars(6, 6)).toBe(0)
  })

  it('is positive when grabbed to the right of the clip start', () => {
    expect(computeGrabOffsetBars(9, 6)).toBe(3)
  })
})

describe('applyGrabOffset', () => {
  it('subtracts the offset back out', () => {
    expect(applyGrabOffset(12, 3)).toBe(9)
  })

  it('is the exact inverse of computeGrabOffsetBars for the same drag', () => {
    // Grabbed 3 bars into a clip starting at bar 6 (so at bar 9)...
    const offset = computeGrabOffsetBars(9, 6)
    // ...then dragged until the mouse is at bar 20 — the clip's new start
    // should be 17, i.e. still 3 bars behind the mouse, same as at grab time.
    expect(applyGrabOffset(20, offset)).toBe(17)
  })
})

describe('dragGrabOffset storage', () => {
  it('returns 0 before anything has been set', () => {
    expect(getGrabOffsetBars()).toBe(0)
  })

  it('returns whatever was last set', () => {
    setGrabOffsetBars(2.5)
    expect(getGrabOffsetBars()).toBe(2.5)
    setGrabOffsetBars(-1)
    expect(getGrabOffsetBars()).toBe(-1)
  })
})
