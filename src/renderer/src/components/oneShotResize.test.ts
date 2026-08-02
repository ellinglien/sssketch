import { describe, expect, it } from 'vitest'
import {
  MIN_ONE_SHOT_SEC,
  trimRightEdge,
  trimLeftEdge,
  targetDurationForRightEdgeStretch,
  targetDurationForLeftEdgeStretch,
  stretchRatioForTargetDuration,
  oneShotWidthBars
} from './oneShotResize'

describe('trimRightEdge', () => {
  it('shrinks trimEndSec by the dragged amount', () => {
    expect(trimRightEdge(0.6, -0.2, 0, 0.6)).toBeCloseTo(0.4)
  })

  it("never exceeds the sample's natural duration", () => {
    expect(trimRightEdge(0.6, 0.5, 0, 0.6)).toBe(0.6)
  })

  it('never drops below trimStartSec + the minimum floor', () => {
    expect(trimRightEdge(0.6, -10, 0.2, 0.6)).toBeCloseTo(0.2 + MIN_ONE_SHOT_SEC)
  })
})

describe('trimLeftEdge', () => {
  it('grows trimStartSec by the dragged amount', () => {
    expect(trimLeftEdge(0, 0.15, 0.6)).toBeCloseTo(0.15)
  })

  it('never goes negative', () => {
    expect(trimLeftEdge(0.1, -5, 0.6)).toBe(0)
  })

  it('never reaches trimEndSec', () => {
    expect(trimLeftEdge(0.1, 10, 0.6)).toBeCloseTo(0.6 - MIN_ONE_SHOT_SEC)
  })
})

describe('targetDurationForRightEdgeStretch', () => {
  it('extending right grows duration', () => {
    expect(targetDurationForRightEdgeStretch(0.6, 0.4)).toBeCloseTo(1.0)
  })

  it('never drops below the minimum floor', () => {
    expect(targetDurationForRightEdgeStretch(0.6, -10)).toBe(MIN_ONE_SHOT_SEC)
  })
})

describe('targetDurationForLeftEdgeStretch', () => {
  it('dragging left (negative delta) grows duration -- mirror image of the right edge', () => {
    expect(targetDurationForLeftEdgeStretch(0.6, -0.4)).toBeCloseTo(1.0)
  })

  it('never drops below the minimum floor', () => {
    expect(targetDurationForLeftEdgeStretch(0.6, 10)).toBe(MIN_ONE_SHOT_SEC)
  })
})

describe('stretchRatioForTargetDuration', () => {
  it("a shorter target duration means a ratio > 1 (speed up), matching rubberband.ts's own convention", () => {
    expect(stretchRatioForTargetDuration(1.0, 0.5)).toBeCloseTo(2.0)
  })

  it('a longer target duration means a ratio < 1 (slow down)', () => {
    expect(stretchRatioForTargetDuration(1.0, 2.0)).toBeCloseTo(0.5)
  })

  it('clamps the target against the minimum floor rather than dividing by ~0', () => {
    expect(stretchRatioForTargetDuration(1.0, 0)).toBeCloseTo(1.0 / MIN_ONE_SHOT_SEC)
  })
})

describe('oneShotWidthBars', () => {
  it("converts a real duration into bars at the project tempo, independent of the rifff's own cosmetic bpm/barLength", () => {
    // 120bpm -> secPerBar = (60/120)*4 = 2s/bar. A 0.6s one-shot is 0.3 bars wide.
    expect(oneShotWidthBars(0.6, 120)).toBeCloseTo(0.3)
  })

  it('a longer duration produces proportionally more bars', () => {
    expect(oneShotWidthBars(4.0, 120)).toBeCloseTo(2.0)
  })
})
