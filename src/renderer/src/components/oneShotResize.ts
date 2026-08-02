// src/renderer/src/components/oneShotResize.ts

/** Never trim/stretch a one-shot to literally nothing -- a 10ms floor. */
export const MIN_ONE_SHOT_SEC = 0.01

/** Plain drag on the RIGHT edge: shrinks trimEndSec. Left edge/start stays
 * fixed -- the caller doesn't need to touch startBar for this one.
 * deltaSec is signed (negative = dragged left = shorter). Clamped so
 * trimEndSec never exceeds durationSec and never drops below
 * trimStartSec + MIN_ONE_SHOT_SEC. */
export function trimRightEdge(
  startTrimEndSec: number,
  deltaSec: number,
  trimStartSec: number,
  durationSec: number
): number {
  const requested = startTrimEndSec + deltaSec
  return Math.max(trimStartSec + MIN_ONE_SHOT_SEC, Math.min(durationSec, requested))
}

/** Plain drag on the LEFT edge: grows trimStartSec. The caller is
 * responsible for moving the clip's startBar forward by the bar-equivalent
 * of the same delta, so the right edge (end-of-playback point) stays fixed
 * in time. deltaSec positive = dragged right = trims more off the start.
 * Clamped so trimStartSec never goes negative and never reaches
 * trimEndSec. */
export function trimLeftEdge(
  startTrimStartSec: number,
  deltaSec: number,
  trimEndSec: number
): number {
  const requested = startTrimStartSec + deltaSec
  return Math.max(0, Math.min(trimEndSec - MIN_ONE_SHOT_SEC, requested))
}

/** Ctrl+drag on the RIGHT edge: dragging right grows the target duration
 * (stretches longer), dragging left shrinks it. */
export function targetDurationForRightEdgeStretch(
  nativeDurationSec: number,
  deltaSec: number
): number {
  return Math.max(MIN_ONE_SHOT_SEC, nativeDurationSec + deltaSec)
}

/** Ctrl+drag on the LEFT edge: mirror image of the right edge -- dragging
 * left (negative deltaSec) grows the target duration, dragging right
 * shrinks it. */
export function targetDurationForLeftEdgeStretch(
  nativeDurationSec: number,
  deltaSec: number
): number {
  return Math.max(MIN_ONE_SHOT_SEC, nativeDurationSec - deltaSec)
}

/** The rubberband --tempo ratio a target duration implies, given the
 * sample's own native duration. ratio > 1 speeds up (shorter output),
 * ratio < 1 slows down (longer output) -- same convention
 * rubberband.ts's own renderStretched already documents and relies on.
 * The target is clamped against MIN_ONE_SHOT_SEC first so this never
 * divides by (near) zero. */
export function stretchRatioForTargetDuration(
  nativeDurationSec: number,
  targetDurationSec: number
): number {
  const clampedTarget = Math.max(MIN_ONE_SHOT_SEC, targetDurationSec)
  return nativeDurationSec / clampedTarget
}

/** How many bars wide a one-shot clip's on-screen box should be at the
 * project's current tempo -- unlike a normal rifff, a one-shot's on-screen
 * width must represent its own REAL duration (durationSec, adjusted for
 * any trim), never state.stretch/rifff.bpm-based scaling (clipGeometry's
 * own formula, which a one-shot's cosmetic bpm/barLength would otherwise
 * feed nonsense into). Same (60/bpm)*4 = secPerBar formula this codebase
 * already duplicates inline in several other files (buildRifff.ts,
 * reOneScoring.ts, buildEngineProject.ts) rather than centralizing. */
export function oneShotWidthBars(durationSec: number, projectBpm: number): number {
  const secPerBar = (60 / projectBpm) * 4
  return durationSec / secPerBar
}
