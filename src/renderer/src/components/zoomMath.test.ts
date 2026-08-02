import { describe, it, expect } from 'vitest'
import {
  MIN_ZOOM_MULTIPLIER,
  MAX_ZOOM_MULTIPLIER,
  DEFAULT_ZOOM_MULTIPLIER,
  clampZoomMultiplier,
  zoomMultiplierForWheelDelta,
  scrollLeftForZoomChange,
  isVerticalDominant
} from './zoomMath'

describe('clampZoomMultiplier', () => {
  it('leaves a value inside the range unchanged', () => {
    expect(clampZoomMultiplier(1.5)).toBe(1.5)
  })

  it('clamps a value below MIN_ZOOM_MULTIPLIER up to the minimum', () => {
    expect(clampZoomMultiplier(0.01)).toBe(MIN_ZOOM_MULTIPLIER)
  })

  it('clamps a value above MAX_ZOOM_MULTIPLIER down to the maximum', () => {
    expect(clampZoomMultiplier(100)).toBe(MAX_ZOOM_MULTIPLIER)
  })
})

describe('zoomMultiplierForWheelDelta', () => {
  it('increases the multiplier for a negative deltaY (scroll up = zoom in)', () => {
    const result = zoomMultiplierForWheelDelta(DEFAULT_ZOOM_MULTIPLIER, -10)
    expect(result).toBeGreaterThan(DEFAULT_ZOOM_MULTIPLIER)
  })

  it('decreases the multiplier for a positive deltaY (scroll down = zoom out)', () => {
    const result = zoomMultiplierForWheelDelta(DEFAULT_ZOOM_MULTIPLIER, 10)
    expect(result).toBeLessThan(DEFAULT_ZOOM_MULTIPLIER)
  })

  it('never goes below MIN_ZOOM_MULTIPLIER even with a huge positive deltaY', () => {
    expect(zoomMultiplierForWheelDelta(DEFAULT_ZOOM_MULTIPLIER, 100000)).toBe(MIN_ZOOM_MULTIPLIER)
  })

  it('never goes above MAX_ZOOM_MULTIPLIER even with a huge negative deltaY', () => {
    expect(zoomMultiplierForWheelDelta(DEFAULT_ZOOM_MULTIPLIER, -100000)).toBe(MAX_ZOOM_MULTIPLIER)
  })
})

describe('scrollLeftForZoomChange', () => {
  it('keeps the bar under the cursor at the same screen position after zooming in', () => {
    // scrollLeft=0, cursor at 100px, old ppb=24 -- bar under cursor is
    // (0+100)/24 = 4.1666...; zooming to ppb=48 should put that same bar's
    // pixel position (4.1666*48=200) at cursorX (100), so scrollLeft=100.
    const result = scrollLeftForZoomChange(0, 100, 24, 48)
    expect(result).toBeCloseTo(100, 5)
  })

  it('round-trips back to the original scrollLeft when zooming back out', () => {
    const zoomedIn = scrollLeftForZoomChange(0, 100, 24, 48)
    const zoomedBackOut = scrollLeftForZoomChange(zoomedIn, 100, 48, 24)
    expect(zoomedBackOut).toBeCloseTo(0, 5)
  })

  it('never returns a negative scrollLeft', () => {
    // Cursor near the very start, zooming out -- the naive formula would
    // go negative; must clamp to 0.
    const result = scrollLeftForZoomChange(0, 5, 48, 6)
    expect(result).toBe(0)
  })
})

describe('isVerticalDominant', () => {
  it('is true when the vertical delta is larger', () => {
    expect(isVerticalDominant(2, 10)).toBe(true)
  })

  it('is false when the horizontal delta is larger', () => {
    expect(isVerticalDominant(10, 2)).toBe(false)
  })

  it('is false for a perfect tie (ambiguous gesture defaults to pan, not zoom)', () => {
    expect(isVerticalDominant(5, 5)).toBe(false)
  })

  it('ignores sign, only compares magnitude', () => {
    expect(isVerticalDominant(-2, -10)).toBe(true)
    expect(isVerticalDominant(-10, -2)).toBe(false)
  })
})
