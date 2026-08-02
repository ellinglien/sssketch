// src/renderer/src/components/zoomMath.ts

export const MIN_ZOOM_MULTIPLIER = 0.25
export const MAX_ZOOM_MULTIPLIER = 4
export const DEFAULT_ZOOM_MULTIPLIER = 1

// Tuned by feel -- lower than an earlier pass, which felt jumpy rather than
// smooth (each tick's step was too large). Roughly a doubling in multiplier
// per ~115 units of wheel delta now.
const ZOOM_WHEEL_SENSITIVITY = 0.006

export function clampZoomMultiplier(multiplier: number): number {
  return Math.max(MIN_ZOOM_MULTIPLIER, Math.min(MAX_ZOOM_MULTIPLIER, multiplier))
}

/** Axis-locks a wheel gesture to whichever direction actually dominates it --
 * true when the vertical component is the bigger one, meaning this event
 * should drive zoom. A trackpad gesture is rarely perfectly axis-aligned, so
 * without this, a mostly-horizontal pan swipe done while the zoom modifier
 * happens to be held would jitter the zoom level from incidental deltaY
 * noise instead of just panning; the caller skips zoom (and its own
 * preventDefault) entirely when this is false, letting the gesture fall
 * through as a normal horizontal pan instead. */
export function isVerticalDominant(deltaX: number, deltaY: number): boolean {
  return Math.abs(deltaY) > Math.abs(deltaX)
}

/** Ableton-style: a negative deltaY (scrolling up/away from you) zooms in
 * (multiplier increases); a positive deltaY (scrolling down/toward you)
 * zooms out. */
export function zoomMultiplierForWheelDelta(currentMultiplier: number, deltaY: number): number {
  return clampZoomMultiplier(currentMultiplier * (1 - deltaY * ZOOM_WHEEL_SENSITIVITY))
}

/** The scrollLeft that keeps the bar currently under the cursor at the same
 * on-screen (local-to-container) x position after the pixels-per-bar scale
 * changes from oldPpb to newPpb -- the cursor-anchored zoom Ableton and most
 * other DAWs use. Clamped to never go negative (the DOM would silently clamp
 * a negative scrollLeft to 0 anyway, but computing it explicitly here keeps
 * this function's contract self-contained and testable on its own). */
export function scrollLeftForZoomChange(
  oldScrollLeft: number,
  cursorXInContainer: number,
  oldPpb: number,
  newPpb: number
): number {
  const barUnderCursor = (oldScrollLeft + cursorXInContainer) / oldPpb
  return Math.max(0, barUnderCursor * newPpb - cursorXInContainer)
}
