// Pure geometry/interaction math for Dial.tsx -- direct request, 2026-09-22:
// replace Discover's native tight/loose range slider with a round dial.
// Values are whole numbers in [0, 100], matching the old range input.

const MIN = 0
const MAX = 100
/** Total sweep of the dial, centred on straight up: -135deg (min) to
 * +135deg (max), the usual hardware-knob gap at the bottom. */
const SWEEP_DEG = 270
/** Pixels of vertical drag for a full min-to-max sweep. */
const DRAG_PX_FOR_FULL_RANGE = 150
/** One wheel notch nudges by this much. */
const WHEEL_STEP = 2

function clamp(value: number): number {
  return Math.max(MIN, Math.min(MAX, Math.round(value)))
}

/** Up (negative deltaY) turns it up, like every DAW knob. */
export function dialValueAfterDrag(startValue: number, deltaY: number): number {
  return clamp(startValue - (deltaY / DRAG_PX_FOR_FULL_RANGE) * (MAX - MIN))
}

export function dialValueAfterWheel(value: number, wheelDeltaY: number): number {
  if (wheelDeltaY === 0) return value
  return clamp(value + (wheelDeltaY < 0 ? WHEEL_STEP : -WHEEL_STEP))
}

/** 0deg = straight up, clockwise positive. */
export function dialAngleDeg(value: number): number {
  return -SWEEP_DEG / 2 + (clamp(value) / (MAX - MIN)) * SWEEP_DEG
}

function pointAt(angleDeg: number, radius: number): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180
  return { x: radius * Math.sin(rad), y: -radius * Math.cos(rad) }
}

const fmt = (n: number): string => n.toFixed(3)

/** SVG path for the filled arc from the min end to `value`, centred on
 * (0, 0) -- the caller's viewBox centres it. Empty string at the minimum
 * (a zero-length arc would render a stray dot). */
export function dialArcPath(value: number, radius: number): string {
  const end = dialAngleDeg(value)
  const start = -SWEEP_DEG / 2
  if (end - start <= 0) return ''
  const a = pointAt(start, radius)
  const b = pointAt(end, radius)
  const largeArc = end - start > 180 ? 1 : 0
  return `M ${fmt(a.x)} ${fmt(a.y)} A ${radius} ${radius} 0 ${largeArc} 1 ${fmt(b.x)} ${fmt(b.y)}`
}

/** The full-range background track -- same as a value of MAX. */
export function dialTrackPath(radius: number): string {
  return dialArcPath(MAX, radius)
}

export { pointAt as dialPointAt }
