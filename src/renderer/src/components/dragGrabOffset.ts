// Pure: where within the clip (in bars) it was grabbed, given the mouse's own
// bar position and the clip's start bar, both at drag-start.
export function computeGrabOffsetBars(mouseBar: number, clipStartBar: number): number {
  return mouseBar - clipStartBar
}

// Pure inverse of computeGrabOffsetBars: given the mouse's bar position at
// drop (or during a dragover preview) and a previously captured grab offset,
// the clip's resulting start bar.
export function applyGrabOffset(mouseBar: number, offsetBars: number): number {
  return mouseBar - offsetBars
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
