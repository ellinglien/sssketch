import { describe, expect, it } from 'vitest'
import {
  AUTOMATION_HIT_RADIUS_PX,
  addStrokeSample,
  applyStroke,
  barToX,
  curvePolyline,
  hitTestPoint,
  insertPoint,
  movePoint,
  rampStroke,
  removePoint,
  simplifyCurve,
  snapBar,
  valueToY,
  xToBar,
  yToValue
} from './automationEdit'
import type { AutomationPoint } from './toolkit'

const PPB = 24
const LANE = 80

describe('lane geometry', () => {
  it('maps bars to pixels with the caller-supplied pixels-per-bar', () => {
    expect(barToX(0, PPB)).toBe(0)
    expect(barToX(4, PPB)).toBe(96)
    expect(xToBar(96, PPB)).toBe(4)
  })

  it('never divides by a zero scale', () => {
    expect(xToBar(96, 0)).toBe(0)
    expect(yToValue(10, 0)).toBe(0)
  })

  it('puts 0 at the bottom of the lane and 1 at the top', () => {
    expect(valueToY(1, LANE)).toBe(0)
    expect(valueToY(0, LANE)).toBe(LANE)
    expect(valueToY(0.5, LANE)).toBe(LANE / 2)
    expect(yToValue(0, LANE)).toBe(1)
    expect(yToValue(LANE, LANE)).toBe(0)
  })

  it('clamps values outside 0..1 rather than letting a drag past the lane edge escape', () => {
    expect(valueToY(1.4, LANE)).toBe(0)
    expect(valueToY(-0.2, LANE)).toBe(LANE)
    expect(yToValue(-30, LANE)).toBe(1)
    expect(yToValue(LANE + 30, LANE)).toBe(0)
  })
})

describe('snapBar', () => {
  it('snaps to the nearest whole bar by default', () => {
    expect(snapBar(3.4, true)).toBe(3)
    expect(snapBar(3.6, true)).toBe(4)
  })

  it('keeps a fine position when snapping is overridden, rounded to a sane resolution', () => {
    expect(snapBar(3.4, false)).toBe(3.4)
    expect(snapBar(3.4567891, false)).toBe(3.457)
  })

  it('never goes negative', () => {
    expect(snapBar(-2.2, true)).toBe(0)
    expect(snapBar(-0.4, false)).toBe(0)
  })
})

describe('hitTestPoint', () => {
  const points: AutomationPoint[] = [
    { bar: 0, value: 1 },
    { bar: 4, value: 0.5 },
    { bar: 8, value: 0 }
  ]

  it('finds a point under the cursor', () => {
    // bar 4 -> x 96; value 0.5 -> y 40
    expect(hitTestPoint(points, 96, 40, PPB, LANE)).toBe(1)
    expect(hitTestPoint(points, 98, 42, PPB, LANE)).toBe(1)
  })

  it('returns -1 when nothing is close enough', () => {
    expect(hitTestPoint(points, 96, 70, PPB, LANE)).toBe(-1)
    expect(hitTestPoint([], 0, 0, PPB, LANE)).toBe(-1)
  })

  it('picks the nearest when two are within the radius', () => {
    const crowded: AutomationPoint[] = [
      { bar: 4, value: 0.5 },
      { bar: 4.1, value: 0.5 }
    ]
    expect(hitTestPoint(crowded, 98.3, 40, PPB, LANE, AUTOMATION_HIT_RADIUS_PX)).toBe(1)
    expect(hitTestPoint(crowded, 96.1, 40, PPB, LANE, AUTOMATION_HIT_RADIUS_PX)).toBe(0)
  })
})

describe('insertPoint', () => {
  it('adds a point and keeps the curve sorted', () => {
    const next = insertPoint([{ bar: 8, value: 0 }], 2, 0.75)
    expect(next).toEqual([
      { bar: 2, value: 0.75 },
      { bar: 8, value: 0 }
    ])
  })

  it('replaces an existing point at the same bar rather than stacking a second one there', () => {
    const next = insertPoint(
      [
        { bar: 0, value: 1 },
        { bar: 4, value: 0.2 }
      ],
      4,
      0.9
    )
    expect(next).toEqual([
      { bar: 0, value: 1 },
      { bar: 4, value: 0.9 }
    ])
  })

  it('clamps the inserted value into 0..1', () => {
    expect(insertPoint([], 1, 3)).toEqual([{ bar: 1, value: 1 }])
    expect(insertPoint([], 1, -3)).toEqual([{ bar: 1, value: 0 }])
  })

  it('does not mutate its input', () => {
    const points: AutomationPoint[] = [{ bar: 0, value: 1 }]
    insertPoint(points, 2, 0.5)
    expect(points).toEqual([{ bar: 0, value: 1 }])
  })
})

describe('movePoint', () => {
  const points: AutomationPoint[] = [
    { bar: 0, value: 1 },
    { bar: 4, value: 0.5 },
    { bar: 8, value: 0 }
  ]

  it('moves a point and reports where it ended up', () => {
    const moved = movePoint(points, 1, 5, 0.25)
    expect(moved.points).toEqual([
      { bar: 0, value: 1 },
      { bar: 5, value: 0.25 },
      { bar: 8, value: 0 }
    ])
    expect(moved.index).toBe(1)
  })

  it('tracks the dragged point across its neighbours when it is dragged past one', () => {
    const moved = movePoint(points, 1, 9, 0.25)
    expect(moved.points).toEqual([
      { bar: 0, value: 1 },
      { bar: 8, value: 0 },
      { bar: 9, value: 0.25 }
    ])
    expect(moved.index).toBe(2)
  })

  it('leaves the curve alone for an index that is not there', () => {
    expect(movePoint(points, 7, 1, 1)).toEqual({ points, index: -1 })
  })
})

describe('removePoint', () => {
  it('drops the point at the given index', () => {
    expect(
      removePoint(
        [
          { bar: 0, value: 1 },
          { bar: 4, value: 0.5 }
        ],
        0
      )
    ).toEqual([{ bar: 4, value: 0.5 }])
  })

  it('ignores an out-of-range index', () => {
    const points: AutomationPoint[] = [{ bar: 0, value: 1 }]
    expect(removePoint(points, 4)).toEqual(points)
    expect(removePoint(points, -1)).toEqual(points)
  })
})

describe('addStrokeSample', () => {
  it('appends each new sample', () => {
    let stroke = addStrokeSample([], 0, 1)
    stroke = addStrokeSample(stroke, 1, 0.8)
    expect(stroke).toEqual([
      { bar: 0, value: 1 },
      { bar: 1, value: 0.8 }
    ])
  })

  it('replaces the previous sample when the cursor has not left its bar -- what keeps a snapped drag from stacking a hundred points on one bar', () => {
    let stroke = addStrokeSample([], 2, 0.9)
    stroke = addStrokeSample(stroke, 2, 0.4)
    stroke = addStrokeSample(stroke, 2, 0.1)
    expect(stroke).toEqual([{ bar: 2, value: 0.1 }])
  })

  it('clamps sampled values', () => {
    expect(addStrokeSample([], 0, 2)).toEqual([{ bar: 0, value: 1 }])
  })
})

describe('rampStroke', () => {
  it('is the two endpoints of a shift-drag', () => {
    expect(rampStroke(2, 0.2, 6, 0.9)).toEqual([
      { bar: 2, value: 0.2 },
      { bar: 6, value: 0.9 }
    ])
  })

  it('orders by bar when the drag went right-to-left, keeping each end its own value', () => {
    expect(rampStroke(6, 0.9, 2, 0.2)).toEqual([
      { bar: 2, value: 0.2 },
      { bar: 6, value: 0.9 }
    ])
  })

  it('collapses to a single point for a zero-length drag', () => {
    expect(rampStroke(3, 0.5, 3, 0.7)).toEqual([{ bar: 3, value: 0.7 }])
  })
})

describe('simplifyCurve', () => {
  it('reduces a straight run of samples to its two endpoints', () => {
    const straight: AutomationPoint[] = Array.from({ length: 50 }, (_, i) => ({
      bar: i / 4,
      value: i / 49
    }))
    expect(simplifyCurve(straight, 0.02, 1)).toEqual([
      { bar: 0, value: 0 },
      { bar: 49 / 4, value: 1 }
    ])
  })

  it('keeps a real corner', () => {
    const peak: AutomationPoint[] = [
      { bar: 0, value: 0 },
      { bar: 1, value: 0.5 },
      { bar: 2, value: 1 },
      { bar: 3, value: 0.5 },
      { bar: 4, value: 0 }
    ]
    expect(simplifyCurve(peak, 0.02, 1)).toEqual([
      { bar: 0, value: 0 },
      { bar: 2, value: 1 },
      { bar: 4, value: 0 }
    ])
  })

  it('gets a long freehand drag down to a handful of points', () => {
    // A hand-drawn-ish wobble: 400 samples over 16 bars, tiny noise on a ramp.
    const drawn: AutomationPoint[] = Array.from({ length: 400 }, (_, i) => ({
      bar: (i / 399) * 16,
      value: i / 399 + Math.sin(i) * 0.004
    }))
    const simplified = simplifyCurve(drawn, 0.02, 24 / 80)
    expect(simplified.length).toBeLessThan(10)
    expect(simplified[0]).toEqual(drawn[0])
    expect(simplified[simplified.length - 1]).toEqual(drawn[drawn.length - 1])
  })

  it('leaves one- and two-point curves alone', () => {
    const two: AutomationPoint[] = [
      { bar: 0, value: 0 },
      { bar: 4, value: 1 }
    ]
    expect(simplifyCurve(two, 0.02, 1)).toEqual(two)
    expect(simplifyCurve([], 0.02, 1)).toEqual([])
  })

  it('weights the bar axis by barScale, so the same three points simplify differently at different zooms', () => {
    const kneed: AutomationPoint[] = [
      { bar: 0, value: 0 },
      { bar: 1, value: 0.9 },
      { bar: 2, value: 1 }
    ]
    // Zoomed way out, the bars collapse together: all three land on what is
    // visually one near-vertical jump, so the middle one carries nothing.
    expect(simplifyCurve(kneed, 0.05, 0.01)).toHaveLength(2)
    // Zoomed way in, the same points are a visible knee and it survives.
    expect(simplifyCurve(kneed, 0.05, 100)).toHaveLength(3)
  })
})

describe('applyStroke', () => {
  const existing: AutomationPoint[] = [
    { bar: 0, value: 1 },
    { bar: 4, value: 0.5 },
    { bar: 8, value: 0.25 },
    { bar: 12, value: 0 }
  ]

  it('replaces everything inside the span the stroke covers and keeps the rest', () => {
    const stroke: AutomationPoint[] = [
      { bar: 3, value: 0 },
      { bar: 9, value: 1 }
    ]
    expect(applyStroke(existing, stroke)).toEqual([
      { bar: 0, value: 1 },
      { bar: 3, value: 0 },
      { bar: 9, value: 1 },
      { bar: 12, value: 0 }
    ])
  })

  it('leaves the curve untouched for an empty stroke', () => {
    expect(applyStroke(existing, [])).toEqual(existing)
  })

  it('writes onto an empty lane', () => {
    const stroke: AutomationPoint[] = [
      { bar: 1, value: 0 },
      { bar: 2, value: 1 }
    ]
    expect(applyStroke([], stroke)).toEqual(stroke)
  })

  it('drops an existing point sitting exactly on the stroke edge rather than stacking two there', () => {
    const stroke: AutomationPoint[] = [
      { bar: 4, value: 0 },
      { bar: 8, value: 1 }
    ]
    expect(applyStroke(existing, stroke)).toEqual([
      { bar: 0, value: 1 },
      { bar: 4, value: 0 },
      { bar: 8, value: 1 },
      { bar: 12, value: 0 }
    ])
  })

  it('normalises whatever it is handed', () => {
    const stroke: AutomationPoint[] = [
      { bar: 9, value: 4 },
      { bar: 3, value: -1 }
    ]
    expect(applyStroke(existing, stroke)).toEqual([
      { bar: 0, value: 1 },
      { bar: 3, value: 0 },
      { bar: 9, value: 1 },
      { bar: 12, value: 0 }
    ])
  })
})

describe('curvePolyline', () => {
  it('holds flat before the first point and after the last, matching evaluateAutomation', () => {
    const points: AutomationPoint[] = [
      { bar: 2, value: 1 },
      { bar: 4, value: 0 }
    ]
    expect(curvePolyline(points, { ppb: PPB, widthPx: 240, heightUnits: 100 })).toEqual([
      { x: 0, y: 0 },
      { x: 48, y: 0 },
      { x: 96, y: 100 },
      { x: 240, y: 100 }
    ])
  })

  it('is empty for an un-automated lane', () => {
    expect(curvePolyline([], { ppb: PPB, widthPx: 240, heightUnits: 100 })).toEqual([])
  })

  it('adds no redundant hold vertex when a point already sits on the edge', () => {
    const points: AutomationPoint[] = [
      { bar: 0, value: 0.5 },
      { bar: 10, value: 0.5 }
    ]
    expect(curvePolyline(points, { ppb: PPB, widthPx: 240, heightUnits: 100 })).toEqual([
      { x: 0, y: 50 },
      { x: 240, y: 50 }
    ])
  })
})
