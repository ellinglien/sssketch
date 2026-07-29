import { describe, expect, it } from 'vitest'
import {
  computeGrabOffsetBars,
  applyGrabOffset,
  setGrabOffsetBars,
  getGrabOffsetBars,
  mouseBarFromDragEvent
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

// This suite's environment is plain Node (see vitest.config.ts — no jsdom/happy-dom
// dependency in this project), so these use minimal fake objects satisfying just the
// `.closest()`/`.getBoundingClientRect()` shape mouseBarFromDragEvent actually calls,
// rather than a real DOM.
describe('mouseBarFromDragEvent', () => {
  it('returns null when there is no [data-timeline] ancestor', () => {
    const target = { closest: () => null }
    const result = mouseBarFromDragEvent({
      currentTarget: target as unknown as EventTarget,
      clientX: 300
    })
    expect(result).toBeNull()
  })

  it('computes the bar position relative to the timeline origin', () => {
    // PPB=24, LANE_HEADER_WIDTH=212 (Ruler.tsx) — timeline's own left edge at
    // 0, so a click at clientX=452 is (452-0-212)/24 = 10 bars in.
    const timeline = { getBoundingClientRect: () => ({ left: 0 }) }
    const target = { closest: () => timeline }
    const result = mouseBarFromDragEvent({
      currentTarget: target as unknown as EventTarget,
      clientX: 452
    })
    expect(result).toBe(10)
  })

  it('clamps to 0 rather than going negative', () => {
    const timeline = { getBoundingClientRect: () => ({ left: 0 }) }
    const target = { closest: () => timeline }
    const result = mouseBarFromDragEvent({
      currentTarget: target as unknown as EventTarget,
      clientX: 0
    })
    expect(result).toBe(0)
  })
})
