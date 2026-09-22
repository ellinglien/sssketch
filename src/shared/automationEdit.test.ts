import { describe, expect, it } from 'vitest'
import {
  AUTOMATION_HIT_RADIUS_PX,
  addStrokeSample,
  applyEdgeFade,
  applyStroke,
  barToX,
  curvePolyline,
  edgeFadeState,
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

  it("never goes past the clip's own length -- drawing beyond the wave is impossible", () => {
    // "don't even allow to draw beyond where the wave is" (Elling, spec 2b).
    expect(snapBar(9.4, true, 8)).toBe(8)
    expect(snapBar(12, false, 8)).toBe(8)
  })

  it('clamps AFTER snapping, so a fractional-length clip can end exactly on its edge', () => {
    // A clip 6.5 bars long: snapping 6.4 to bar 6 is fine, but a drag past
    // the end must land ON 6.5, not back at whole bar 6 -- otherwise the
    // last half-bar of audio could never be automated at all.
    expect(snapBar(6.4, true, 6.5)).toBe(6)
    expect(snapBar(7.2, true, 6.5)).toBe(6.5)
  })

  it('still behaves as before when no limit is given', () => {
    expect(snapBar(99.6, true)).toBe(100)
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

// The "dots aren't on the line" bug, pinned as an invariant. AutomationLane
// draws a breakpoint as an absolutely-positioned square at `left:
// barToX(bar, ppb)` px and `top: valueToY(value, 100)%`, and the curve as an
// SVG polyline inside a viewBox of `0 0 widthPx 100`. Those two agree only
// if the SVG's rendered width equals widthPx (one viewBox x unit == one CSS
// pixel) -- the old lane was `width="100%"` over a viewBox sized to the
// whole timeline while its box was `minWidth: 100%` of the viewport, so on
// any project narrower than the window the line drifted off its own points.
// These assert the mapping itself; the component now passes an explicit
// pixel width so the premise holds.
describe('one coordinate space for the line and its points', () => {
  const points: AutomationPoint[] = [
    { bar: 0, value: 1 },
    { bar: 2, value: 0.25 },
    { bar: 4, value: 0 }
  ]

  it("every polyline vertex sits at exactly its own point's x pixel", () => {
    const widthPx = 4 * PPB
    const vertices = curvePolyline(points, { ppb: PPB, widthPx, heightUnits: 100 })
    for (const point of points) {
      const vertex = vertices.find((v) => v.x === barToX(point.bar, PPB))
      expect(vertex).toBeDefined()
    }
  })

  it("a vertex y in viewBox units is the same FRACTION of the lane as the square's top %", () => {
    // valueToY is scale-free: the polyline uses heightUnits=100 (so y IS a
    // percentage) and the square uses the same call for its `top: N%`, which
    // is the whole reason the vertical axis can stay non-uniformly scaled
    // while the horizontal one cannot.
    for (const point of points) {
      const asPercent = valueToY(point.value, 100)
      const asPixels = valueToY(point.value, LANE)
      expect(asPixels / LANE).toBeCloseTo(asPercent / 100, 12)
    }
  })

  it("the trailing hold reaches the CLIP's right edge, not the timeline's", () => {
    // The lane is the clip's waveform rect now, so widthPx is the clip's own
    // width -- a curve whose last point is mid-clip holds flat to the clip
    // edge and stops there.
    const clipWidthPx = 3 * PPB
    const vertices = curvePolyline([{ bar: 1, value: 0.5 }], {
      ppb: PPB,
      widthPx: clipWidthPx,
      heightUnits: 100
    })
    expect(vertices[vertices.length - 1].x).toBe(clipWidthPx)
  })
})

// The edge grabbers: "have the grabbers behave exactly like the fade in and
// fade out action.. where you drag it horiz to create a fade from 0
// (beginning) or end (to zero)" (Elling). applyEdgeFade is the write side
// (splice a fade onto the curve's own edge, reusing applyStroke's inside/
// outside rule so hand-drawn points beyond the fade region survive);
// edgeFadeState is the read side the grabber's own on-screen position comes
// from, reading the fade the CURVE's shape already implies rather than
// tracking a separate fadeIn/fadeOut number the way the old per-clip
// envelope did (there is nowhere to store one per parameter per stem).
describe('applyEdgeFade', () => {
  const LENGTH = 12

  it('fades in from 0 at bar 0 up to the level the curve already holds at N, on an empty lane', () => {
    // Empty lane -> 1.0, "a plain fade in" (spec).
    expect(applyEdgeFade([], { edge: 'start', bars: 4, lengthBars: LENGTH })).toEqual([
      { bar: 0, value: 0 },
      { bar: 4, value: 1 }
    ])
  })

  it('fades out to 0 at the clip end, holding the level the curve already had before the fade', () => {
    expect(applyEdgeFade([], { edge: 'end', bars: 4, lengthBars: LENGTH })).toEqual([
      { bar: 8, value: 1 },
      { bar: 12, value: 0 }
    ])
  })

  it('reads the "top" from whatever the curve already does at that bar, not always 1.0', () => {
    const drawn: AutomationPoint[] = [
      { bar: 0, value: 0.6 },
      { bar: 12, value: 0.6 }
    ]
    expect(applyEdgeFade(drawn, { edge: 'start', bars: 4, lengthBars: LENGTH })).toEqual([
      { bar: 0, value: 0 },
      { bar: 4, value: 0.6 },
      { bar: 12, value: 0.6 }
    ])
  })

  it('dragging back to 0 bars removes the fade -- returns the input curve untouched', () => {
    const drawn: AutomationPoint[] = [
      { bar: 0, value: 0.6 },
      { bar: 12, value: 0.6 }
    ]
    expect(applyEdgeFade(drawn, { edge: 'start', bars: 0, lengthBars: LENGTH })).toEqual(drawn)
    expect(applyEdgeFade(drawn, { edge: 'end', bars: 0, lengthBars: LENGTH })).toEqual(drawn)
  })

  it('preserves points between the fade region and the rest of the curve', () => {
    const drawn: AutomationPoint[] = [
      { bar: 0, value: 1 },
      { bar: 6, value: 0.5 },
      { bar: 12, value: 0 }
    ]
    // Fading in the first 2 bars shouldn't disturb the hand-drawn point at
    // bar 6 or the curve's own end.
    expect(applyEdgeFade(drawn, { edge: 'start', bars: 2, lengthBars: LENGTH })).toEqual([
      { bar: 0, value: 0 },
      // top = curve's own value at bar 2, interpolated between (0,1) and (6,0.5)
      { bar: 2, value: 1 - (0.5 * 2) / 6 },
      { bar: 6, value: 0.5 },
      { bar: 12, value: 0 }
    ])
  })

  it('clamps bars into the clip length -- cannot fade past the clip', () => {
    expect(applyEdgeFade([], { edge: 'start', bars: 999, lengthBars: LENGTH })).toEqual([
      { bar: 0, value: 0 },
      { bar: 12, value: 1 }
    ])
    expect(applyEdgeFade([], { edge: 'start', bars: -5, lengthBars: LENGTH })).toEqual([])
  })

  it('the two fades meet in the middle without crossing when they overlap -- the later edit wins the overlap', () => {
    const faded = applyEdgeFade([], { edge: 'start', bars: 5, lengthBars: LENGTH })
    // faded: [{0,0},{5,1}]. Now fade out the last 8 bars (region [4,12]),
    // which eats into the start fade's own endpoint at bar 5.
    const both = applyEdgeFade(faded, { edge: 'end', bars: 8, lengthBars: LENGTH })
    // The end-fade's own top is read off the start-fade's ramp at bar 4:
    // linear from (0,0) to (5,1) -> 0.8 at bar 4.
    expect(both).toEqual([
      { bar: 0, value: 0 },
      { bar: 4, value: 0.8 },
      { bar: 12, value: 0 }
    ])
    // Monotonic, single-valued curve -- nothing to "cross": every bar has
    // exactly one value, by construction (AutomationPoint[] can't represent
    // two lines at once).
    for (let i = 1; i < both.length; i += 1) {
      expect(both[i].bar).toBeGreaterThan(both[i - 1].bar)
    }
  })

  it('does not mutate its input', () => {
    const points: AutomationPoint[] = [{ bar: 0, value: 1 }]
    applyEdgeFade(points, { edge: 'start', bars: 2, lengthBars: LENGTH })
    expect(points).toEqual([{ bar: 0, value: 1 }])
  })
})

describe('edgeFadeState', () => {
  const LENGTH = 12

  it("reports no fade and the curve's own resting level on an empty lane", () => {
    expect(edgeFadeState([], 'start', LENGTH)).toEqual({ bars: 0, level: 1 })
    expect(edgeFadeState([], 'end', LENGTH)).toEqual({ bars: 0, level: 1 })
  })

  it('reports no fade and the resting level on a flat hand-drawn curve', () => {
    const drawn: AutomationPoint[] = [{ bar: 3, value: 0.4 }]
    // Holds flat before the first point, so bar 0's own level is 0.4.
    expect(edgeFadeState(drawn, 'start', LENGTH)).toEqual({ bars: 0, level: 0.4 })
    expect(edgeFadeState(drawn, 'end', LENGTH)).toEqual({ bars: 0, level: 0.4 })
  })

  it('round-trips with applyEdgeFade: reading back what was just written', () => {
    const start = applyEdgeFade([], { edge: 'start', bars: 3, lengthBars: LENGTH })
    expect(edgeFadeState(start, 'start', LENGTH)).toEqual({ bars: 3, level: 1 })

    const end = applyEdgeFade([], { edge: 'end', bars: 5, lengthBars: LENGTH })
    expect(edgeFadeState(end, 'end', LENGTH)).toEqual({ bars: 5, level: 1 })
  })

  it('is unfooled by a plain drawn point that merely happens to sit at 0 with value 0', () => {
    // A single point at (0,0) has no "top" to report a fade length from.
    expect(edgeFadeState([{ bar: 0, value: 0 }], 'start', LENGTH)).toEqual({ bars: 0, level: 0 })
  })
})
