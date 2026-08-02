// src/renderer/src/components/zoomMath.ts

export const MIN_ZOOM_MULTIPLIER = 0.25
export const MAX_ZOOM_MULTIPLIER = 4
export const DEFAULT_ZOOM_MULTIPLIER = 1

// Tuned by feel -- roughly a doubling in multiplier per ~70 units of wheel
// delta, which on a typical trackpad/mouse wheel reads as "a few brisk
// scroll ticks to go from min to max zoom," not an imperceptible creep or
// an overshoot-prone jump.
const ZOOM_WHEEL_SENSITIVITY = 0.01

export function clampZoomMultiplier(multiplier: number): number {
  return Math.max(MIN_ZOOM_MULTIPLIER, Math.min(MAX_ZOOM_MULTIPLIER, multiplier))
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
