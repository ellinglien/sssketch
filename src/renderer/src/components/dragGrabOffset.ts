import { toLogicalX } from '../state/FrameScaleContext'

// Pure: where within the clip (in bars) it was grabbed, given the mouse's own
// bar position and the clip's start bar, both at drag-start.
export function computeGrabOffsetBars(mouseBar: number, clipStartBar: number): number {
  return mouseBar - clipStartBar
}

// Pure inverse of computeGrabOffsetBars: given the mouse's bar position at
// drop (or during a dragover preview) and a previously captured grab offset,
// the clip's resulting start bar. Rounded to the nearest whole bar — every
// other placement path in this app (barForClientX, resize-handle drags) snaps
// to whole bars, and mouseBar here is already a whole number (it comes from
// barForClientX's own rounding); subtracting a precise, non-rounded
// offsetBars from it would otherwise produce a fractional result that can
// never land exactly on bar 1 (or anywhere else on the grid) no matter how
// carefully the drag is aimed. Clamped to >= 0 for the same reason
// PLACE_ON_TIMELINE/MOVE_TO_CHANNEL clamp their own startBar the same way —
// a clip can't start before the timeline's own beginning.
export function applyGrabOffset(mouseBar: number, offsetBars: number): number {
  return Math.max(0, Math.round(mouseBar - offsetBars))
}

// Carries the offset itself from a drag's onDragStart to Timeline's
// handleDragOver/handleDrop in App.tsx — NOT via dataTransfer, deliberately.
// The HTML5 Drag and Drop spec puts DataTransfer into "protected mode" for
// every event except dragstart and drop: dataTransfer.getData() always
// returns an empty string during dragover, regardless of same-window/
// same-origin. A value stashed via dataTransfer.setData at dragstart
// genuinely can't be read back during dragover — only at drop. Since the
// live preview line (shown during dragover, before drop) needs this offset
// too, it has to travel some other way. dragstart and dragover/drop all run
// synchronously in the same renderer process for an in-app drag, so a plain
// module-level variable works fine and sidesteps the restriction entirely.
let grabOffsetBars = 0

export function setGrabOffsetBars(bars: number): void {
  grabOffsetBars = bars
}

export function getGrabOffsetBars(): number {
  return grabOffsetBars
}

/** The bar position under the mouse, relative to the timeline's own left
 * edge — shared by every onDragStart handler that needs to compute a grab
 * offset (RifffBlockRow's header, StemWaveformRow's label column, and its
 * waveform body), so this "find the [data-timeline] ancestor and convert
 * clientX to a bar position" math exists in exactly one place. Returns null
 * if there's no [data-timeline] ancestor to measure against — shouldn't
 * happen in practice, every drag source here is rendered inside Timeline.
 *
 * Both `ppb` and `frameScale` are required, not defaulted — this function
 * used to default `ppb` to a fixed constant, and one caller (CollapsedRifffRow)
 * relied on that default by omitting the argument entirely, silently ignoring
 * the real current zoom level (only correct at the default zoom) until it was
 * caught by a real "drop lands in the wrong place" report. Requiring both
 * explicitly means a missing one is a compile error, not a silent wrong
 * answer. `frameScale` corrects for the fact that `clientX`/getBoundingClientRect
 * report real screen pixels, while `ppb` is defined in logical, pre-scale
 * pixels (see FrameScaleContext's own doc comment for the full picture) --
 * without it, this drifts off target the moment the window isn't at its
 * default size. */
export function mouseBarFromDragEvent(
  e: {
    currentTarget: EventTarget
    clientX: number
  },
  ppb: number,
  frameScale: number
): number | null {
  const target = e.currentTarget as HTMLElement
  const rect = target.closest('[data-timeline]')?.getBoundingClientRect()
  if (!rect) return null
  return Math.max(0, toLogicalX(e.clientX - rect.left, frameScale) / ppb)
}
