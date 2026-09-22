/**
 * The geometry and editing rules behind the automation lane's free-draw tool
 * -- step 3 of docs/superpowers/specs/2026-09-22-builtin-sound-toolkit-design.md.
 *
 * Everything here is pure: bars and normalised [0,1] values in, bars and
 * values out, with pixels only ever appearing as an explicit `ppb` /
 * `laneHeight` scale the caller supplies. AutomationLane.tsx is deliberately
 * a thin shell over this -- it owns the DOM events and the in-progress
 * gesture, and every decision about WHERE a point lands, whether a drag hit
 * one, and how many points a freehand stroke is worth keeping is made here,
 * where it can be tested without a renderer.
 *
 * Curves stay in the same shape src/shared/toolkit.ts defines and
 * normaliseAutomationCurve enforces (sorted by bar, values clamped into
 * [0,1]), so anything produced here can go straight into the store and out
 * over the wire without a second cleanup pass.
 */

import { evaluateAutomation, normaliseAutomationCurve, type AutomationPoint } from './toolkit'

/** How close (in screen pixels) the cursor has to be to a breakpoint to
 * grab it. Points render as 5px squares, so this is roughly "anywhere on
 * the square, plus a pixel of slop." */
export const AUTOMATION_HIT_RADIUS_PX = 5

/** Ramer--Douglas--Peucker tolerance for a released freehand stroke,
 * expressed in lane heights (the caller's barScale puts both axes in the
 * same unit -- see simplifyCurve). 0.02 is 2% of the lane's vertical
 * travel: small enough that a deliberate wiggle survives, large enough
 * that a 400-sample drag collapses to a handful of points. */
export const AUTOMATION_SIMPLIFY_TOLERANCE = 0.02

/** Fine (snap-overridden) positions are rounded to a thousandth of a bar.
 * Nothing audible lives below that -- a thousandth of a bar at 120bpm is
 * 2ms -- and it keeps a hand-drawn curve from writing 17 significant
 * figures per point into the .sssketchproj JSON. */
const FINE_BAR_RESOLUTION = 1000

/** Two bars closer than this are "the same bar" for every merge/replace
 * decision below. Matches the tolerance elsewhere in the toolkit for the
 * same reason: a value that survived a JSON round trip can land a hair off. */
const BAR_EPSILON = 1e-6

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

export function barToX(bar: number, ppb: number): number {
  return bar * ppb
}

export function xToBar(x: number, ppb: number): number {
  if (!(ppb > 0)) return 0
  return x / ppb
}

/** The lane's vertical extent maps 0 at the BOTTOM to 1 at the top -- the
 * way every DAW draws an automation lane, and the opposite of the screen's
 * own y axis, which is exactly why this conversion is worth naming. */
export function valueToY(value: number, laneHeight: number): number {
  return (1 - clamp01(value)) * laneHeight
}

export function yToValue(y: number, laneHeight: number): number {
  if (!(laneHeight > 0)) return 0
  return clamp01(1 - y / laneHeight)
}

/**
 * Where a bar position actually lands: on the nearest whole bar by default,
 * or at a fine position when the snap override modifier is held (Option --
 * see AutomationLane.tsx for why that key specifically).
 *
 * Confined to [0, maxBar]. Never negative: dragging off the left edge parks
 * at bar 0 rather than writing points into negative time, which nothing
 * downstream expects. And never past `maxBar` -- the clip's own length in
 * bars -- which is the direct answer to "don't even allow to draw beyond
 * where the wave is" (Elling, spec section 2b): a curve belongs to its clip,
 * so a point outside the audio it automates is not a thing that can exist.
 * The clamp runs AFTER the snap deliberately, so a clip whose length isn't a
 * whole number of bars still gets a breakpoint exactly ON its right edge
 * rather than at the last whole bar before it.
 */
export function snapBar(bar: number, snapEnabled: boolean, maxBar = Infinity): number {
  const clamped = Math.max(0, Number.isFinite(bar) ? bar : 0)
  const snapped = snapEnabled
    ? Math.round(clamped)
    : Math.round(clamped * FINE_BAR_RESOLUTION) / FINE_BAR_RESOLUTION
  const limit = Number.isFinite(maxBar) ? Math.max(0, maxBar) : Infinity
  return Math.min(snapped, limit)
}

/**
 * Index of the breakpoint under a lane-local (x, y) pixel position, or -1.
 * Nearest wins when several are in range, so a dense cluster still grabs the
 * one actually being pointed at rather than whichever happens to be first.
 */
export function hitTestPoint(
  points: AutomationPoint[],
  x: number,
  y: number,
  ppb: number,
  laneHeight: number,
  radiusPx: number = AUTOMATION_HIT_RADIUS_PX
): number {
  let best = -1
  let bestDistanceSq = radiusPx * radiusPx
  for (let i = 0; i < points.length; i += 1) {
    const dx = barToX(points[i].bar, ppb) - x
    const dy = valueToY(points[i].value, laneHeight) - y
    const distanceSq = dx * dx + dy * dy
    if (distanceSq <= bestDistanceSq) {
      best = i
      bestDistanceSq = distanceSq
    }
  }
  return best
}

/**
 * Adds a breakpoint. A point already sitting on that bar is REPLACED rather
 * than joined -- clicking an empty lane twice at the same spot should move
 * the value there, not leave a stacked pair (which toolkit.ts's
 * evaluateAutomation reads as an instant step, a surprising thing to create
 * by accident).
 */
export function insertPoint(
  points: AutomationPoint[],
  bar: number,
  value: number
): AutomationPoint[] {
  const kept = points.filter((point) => Math.abs(point.bar - bar) > BAR_EPSILON)
  return normaliseAutomationCurve([...kept, { bar, value }])
}

/**
 * Moves one breakpoint, reporting the index it ended up at -- a drag that
 * carries a point past its neighbour reorders the curve underneath it, and
 * the caller needs to keep holding the SAME point, not whatever is now at
 * the old index. `index` of -1 back means there was nothing to move.
 */
export function movePoint(
  points: AutomationPoint[],
  index: number,
  bar: number,
  value: number
): { points: AutomationPoint[]; index: number } {
  if (index < 0 || index >= points.length) return { points, index: -1 }
  const tagged = points.map((point, i) => ({
    point: i === index ? { bar, value: clamp01(value) } : point,
    dragged: i === index
  }))
  // A stable sort (guaranteed by the spec since ES2019), for the same
  // reason normaliseAutomationCurve relies on one: dropping a point exactly
  // onto another keeps the drawn order, so the pair reads as a step.
  tagged.sort((a, b) => a.point.bar - b.point.bar)
  return {
    points: normaliseAutomationCurve(tagged.map((entry) => entry.point)),
    index: tagged.findIndex((entry) => entry.dragged)
  }
}

export function removePoint(points: AutomationPoint[], index: number): AutomationPoint[] {
  if (index < 0 || index >= points.length) return points
  return points.filter((_, i) => i !== index)
}

/**
 * Extends an in-progress freehand stroke by one sampled position.
 *
 * The sample landing on the bar the previous one already occupies REPLACES
 * it instead of appending. With snap on (the default) that is the whole
 * story: a slow drag across four bars fires dozens of mousemoves and stores
 * five points, not eighty. With snap overridden it still collapses the
 * stationary-cursor case; the rest is handled by simplifyCurve on release.
 */
export function addStrokeSample(
  stroke: AutomationPoint[],
  bar: number,
  value: number
): AutomationPoint[] {
  const sample = { bar, value: clamp01(value) }
  if (stroke.length === 0) return [sample]
  const last = stroke[stroke.length - 1]
  if (Math.abs(last.bar - bar) <= BAR_EPSILON) return [...stroke.slice(0, -1), sample]
  return [...stroke, sample]
}

/** A shift-drag: a straight line from press to release, as its two
 * endpoints. Ordered by bar (so a right-to-left drag still produces a valid
 * curve) with each end keeping its OWN value rather than being mirrored. */
export function rampStroke(
  fromBar: number,
  fromValue: number,
  toBar: number,
  toValue: number
): AutomationPoint[] {
  const from = { bar: fromBar, value: clamp01(fromValue) }
  const to = { bar: toBar, value: clamp01(toValue) }
  if (Math.abs(from.bar - to.bar) <= BAR_EPSILON) return [to]
  return from.bar < to.bar ? [from, to] : [to, from]
}

function perpendicularDistance(
  point: AutomationPoint,
  start: AutomationPoint,
  end: AutomationPoint,
  barScale: number
): number {
  const px = point.bar * barScale
  const ax = start.bar * barScale
  const bx = end.bar * barScale
  const dx = bx - ax
  const dy = end.value - start.value
  const lengthSq = dx * dx + dy * dy
  if (lengthSq === 0) {
    const ex = px - ax
    const ey = point.value - start.value
    return Math.sqrt(ex * ex + ey * ey)
  }
  return Math.abs(dy * (px - ax) - dx * (point.value - start.value)) / Math.sqrt(lengthSq)
}

/**
 * Ramer--Douglas--Peucker, run on release so a freehand drag stores a curve
 * rather than a transcript of the mouse.
 *
 * `barScale` converts a bar into the same unit as a value before distances
 * are measured -- pass `ppb / laneHeight` and the whole thing happens in
 * lane heights, i.e. in what the user actually sees, so `tolerance` means
 * the same amount of visible deviation at every zoom level. Endpoints are
 * always kept.
 *
 * Iterative rather than recursive on purpose: a long fine-positioned drag
 * can carry thousands of samples, and RDP's worst case (a monotonic curve)
 * recurses once per point.
 */
export function simplifyCurve(
  points: AutomationPoint[],
  tolerance: number = AUTOMATION_SIMPLIFY_TOLERANCE,
  barScale = 1
): AutomationPoint[] {
  if (points.length <= 2) return [...points]
  const keep = new Array<boolean>(points.length).fill(false)
  keep[0] = true
  keep[points.length - 1] = true
  const stack: [number, number][] = [[0, points.length - 1]]
  while (stack.length > 0) {
    const [first, last] = stack.pop() as [number, number]
    let furthest = -1
    let furthestDistance = tolerance
    for (let i = first + 1; i < last; i += 1) {
      const distance = perpendicularDistance(points[i], points[first], points[last], barScale)
      if (distance > furthestDistance) {
        furthest = i
        furthestDistance = distance
      }
    }
    if (furthest === -1) continue
    keep[furthest] = true
    stack.push([first, furthest], [furthest, last])
  }
  return points.filter((_, i) => keep[i])
}

/**
 * Commits a finished stroke onto the lane's existing curve: everything the
 * stroke spans is replaced by it, everything outside is left alone. That is
 * what makes redrawing one section of a curve feel like redrawing one
 * section rather than starting over -- and a point sitting exactly on the
 * stroke's own edge counts as inside, so the join is a single point, not a
 * stacked pair that would read as an instant jump.
 */
export function applyStroke(
  existing: AutomationPoint[],
  stroke: AutomationPoint[]
): AutomationPoint[] {
  const normalisedStroke = normaliseAutomationCurve(stroke)
  if (normalisedStroke.length === 0) return normaliseAutomationCurve(existing)
  const from = normalisedStroke[0].bar
  const to = normalisedStroke[normalisedStroke.length - 1].bar
  const kept = existing.filter(
    (point) => point.bar < from - BAR_EPSILON || point.bar > to + BAR_EPSILON
  )
  return normaliseAutomationCurve([...kept, ...normalisedStroke])
}

/** How close a value has to be to 0 to read as "this point IS the fade's
 * zero anchor" rather than a hand-drawn point that merely landed near it --
 * the value-axis counterpart of BAR_EPSILON, needed for the same reason
 * (round-tripping a curve through JSON can land an exact 0 a hair off). */
const VALUE_EPSILON = 1e-6

function isZeroValue(value: number): boolean {
  return Math.abs(value) <= VALUE_EPSILON
}

/**
 * Writes (or removes) a fade at one edge of the clip -- the edge grabbers'
 * own action, defined to feel identical to the existing clip-level fade
 * handles (StemWaveformRow.tsx's handleFadeInStart/handleFadeOutStart):
 * "drag it horiz to create a fade from 0 (beginning) or end (to zero)"
 * (Elling). The difference from that older mechanism is only WHERE the
 * result lives -- there's no separate fadeIn/fadeOut number per parameter
 * per stem to store, so the fade is written directly into the curve's own
 * points, at its own edge.
 *
 * `bars` is the fade's length, clamped into [0, lengthBars] -- dragging the
 * grabber back to 0 removes the fade entirely (returns `points` unchanged:
 * the edge region collapses to nothing, so there is nothing to splice).
 * Otherwise the edge region ([0,bars] for 'start', [lengthBars-bars,
 * lengthBars] for 'end') is rewritten to ramp between 0 and the "top" --
 * the level the curve ALREADY holds just past the fade's far end, read via
 * evaluateAutomation on the curve as it stood before this edit (so a fade
 * dragged out to meet a hand-drawn shape rises or falls to meet it, rather
 * than always aiming for 1.0). An empty lane's top is 1.0 -- "a plain fade
 * in" (spec).
 *
 * Reuses applyStroke's own inside/outside splice rule (same idea CLAUDE.md's
 * "reuse it if it fits" points at): anything the fade's own span covers is
 * replaced, everything outside -- including a hand-drawn point sitting
 * between the fade and the rest of the curve -- survives untouched. That
 * same rule is what makes two fades dragged far enough to overlap "meet in
 * the middle" rather than cross: whichever edge is edited last reads its
 * own top off whatever the curve (including the OTHER fade's ramp) already
 * does at its boundary bar, and its own splice simply overwrites that
 * region -- there is only ever one value per bar, so there is nothing to
 * cross by construction.
 */
export function applyEdgeFade(
  points: AutomationPoint[],
  opts: { edge: 'start' | 'end'; bars: number; lengthBars: number }
): AutomationPoint[] {
  const lengthBars = Number.isFinite(opts.lengthBars) ? Math.max(0, opts.lengthBars) : 0
  const bars = Math.min(lengthBars, Math.max(0, Number.isFinite(opts.bars) ? opts.bars : 0))
  const normalised = normaliseAutomationCurve(points)
  if (bars <= BAR_EPSILON) return normalised

  if (opts.edge === 'start') {
    const top = evaluateAutomation(normalised, bars, 1)
    return applyStroke(normalised, [
      { bar: 0, value: 0 },
      { bar: bars, value: top }
    ])
  }

  const from = lengthBars - bars
  const top = evaluateAutomation(normalised, from, 1)
  return applyStroke(normalised, [
    { bar: from, value: top },
    { bar: lengthBars, value: 0 }
  ])
}

/**
 * The read side of an edge grabber: how long a fade the curve's CURRENT
 * shape already implies at that edge, and the level it fades toward -- what
 * the grabber's own on-screen position comes from (drawn at
 * `(barToX(bars, ppb), valueToY(level, ...))`, mirroring the old fade
 * handles' own knee position, held at a constant "plateau" height while it
 * slides). There's no stored fadeIn/fadeOut number to read the way
 * StemWaveformRow reads `state.fadeIn`/`state.fadeOut` -- automation curves
 * don't have a dedicated field per edge, so this reads the fade BACK OUT of
 * the points applyEdgeFade wrote: a fade is exactly "the edge's own point
 * sits at value 0", and the length is the distance to whatever point comes
 * next.
 *
 * A curve that was never touched by the grabber -- including an empty one,
 * or one with a single hand-drawn point that happens to sit at (0,0) with
 * nothing after it to read a "top" from -- reports `{ bars: 0, level }`,
 * where `level` is simply the curve's own resting value at that edge
 * (evaluateAutomation's hold-before-first/hold-after-last, so the grabber
 * rests wherever the curve already sits rather than snapping to 1.0 on a
 * curve that was deliberately drawn to start somewhere else).
 */
export function edgeFadeState(
  points: AutomationPoint[],
  edge: 'start' | 'end',
  lengthBars: number
): { bars: number; level: number } {
  const length = Number.isFinite(lengthBars) ? Math.max(0, lengthBars) : 0
  const normalised = normaliseAutomationCurve(points)
  const edgeBar = edge === 'start' ? 0 : length
  const restLevel = evaluateAutomation(normalised, edgeBar, 1)
  if (normalised.length < 2) return { bars: 0, level: restLevel }

  if (edge === 'start') {
    const [first, second] = normalised
    if (Math.abs(first.bar) <= BAR_EPSILON && isZeroValue(first.value)) {
      return { bars: second.bar, level: second.value }
    }
    return { bars: 0, level: restLevel }
  }

  const last = normalised[normalised.length - 1]
  const secondLast = normalised[normalised.length - 2]
  if (Math.abs(last.bar - length) <= BAR_EPSILON && isZeroValue(last.value)) {
    return { bars: length - secondLast.bar, level: secondLast.value }
  }
  return { bars: 0, level: restLevel }
}

/**
 * The lane's drawn polyline, in the lane's own coordinate space: x in
 * pixels (bars * ppb), y in `heightUnits` (the caller's SVG viewBox height,
 * so the component never has to measure its own rendered height to draw).
 *
 * Reproduces evaluateAutomation's shape exactly, hold-before-first and
 * hold-after-last included -- the drawn line has to agree with what is
 * heard, which is the same reason toolkit.ts reimplements the engine's own
 * evaluation rather than approximating it.
 */
export function curvePolyline(
  points: AutomationPoint[],
  opts: { ppb: number; widthPx: number; heightUnits: number }
): { x: number; y: number }[] {
  if (points.length === 0) return []
  const { ppb, widthPx, heightUnits } = opts
  const vertices = points.map((point) => ({
    x: barToX(point.bar, ppb),
    y: valueToY(point.value, heightUnits)
  }))
  const first = vertices[0]
  const last = vertices[vertices.length - 1]
  if (first.x > 0) vertices.unshift({ x: 0, y: first.y })
  if (last.x < widthPx) vertices.push({ x: widthPx, y: last.y })
  return vertices
}
