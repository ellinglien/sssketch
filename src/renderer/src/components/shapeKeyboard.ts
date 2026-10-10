export function shapeOwnsKey(key: string, code: string, command: boolean): boolean {
  return (
    code === 'Space' ||
    key === 'Escape' ||
    key === '0' ||
    key === 'Delete' ||
    key === 'Backspace' ||
    (command && ['1', '2', 'c', 'd', 'e', 's', 'v', 'z'].includes(key.toLowerCase()))
  )
}

export function adjustShapeSnapIndex(
  index: number,
  lastGridIndex: number,
  direction: 'narrower' | 'wider'
): number {
  if (direction === 'narrower') return Math.min(lastGridIndex, index + 1)
  return Math.max(0, Math.min(lastGridIndex, index) - 1)
}

export function shapePlaybackStartBar(
  selectedClipStarts: readonly number[],
  stoppedBar: number,
  continueFromStop: boolean
): number {
  if (continueFromStop) return stoppedBar
  return selectedClipStarts.length > 0 ? Math.min(...selectedClipStarts) : 0
}

export function shapeGridSizePct(loopBars: number, snapBars: number): number | null {
  if (!(loopBars > 0) || !(snapBars > 0)) return null
  return (snapBars / loopBars) * 100
}

/** The start shown by Shape's lightweight clip-drag preview and used by the
 * eventual drop. Keeping this arithmetic outside the pointer handler makes
 * the preview and the committed edit share one quantized, in-bounds answer. */
export function shapeClipDragDestination(
  rawStartBars: number,
  clipLengthBars: number,
  snapBars: number,
  loopBars: number
): number {
  if (![rawStartBars, clipLengthBars, snapBars, loopBars].every(Number.isFinite)) return 0
  const snapped = snapBars > 0 ? Math.round(rawStartBars / snapBars) * snapBars : rawStartBars
  return Math.max(0, Math.min(Math.max(0, loopBars - clipLengthBars), snapped))
}

/** Ableton-style clip-edge destination: absolute-grid snapping, bounded by
 * the riff and by how much original source material exists beyond the
 * visible edge. Command-drag calls this with snapBars=0. */
export function shapeClipResizeDestination({
  rawBar,
  edge,
  clipStart,
  clipEnd,
  sourceStart,
  sourceEnd,
  rate = 1,
  reversed,
  snapBars,
  loopBars
}: {
  rawBar: number
  edge: 'left' | 'right'
  clipStart: number
  clipEnd: number
  sourceStart: number
  sourceEnd: number
  rate?: number
  reversed: boolean
  snapBars: number
  loopBars: number
}): number {
  if (
    ![rawBar, clipStart, clipEnd, sourceStart, sourceEnd, rate, snapBars, loopBars].every(
      Number.isFinite
    ) ||
    clipEnd <= clipStart ||
    rate <= 0
  )
    return edge === 'left' ? clipStart : clipEnd
  const snapped = snapBars > 0 ? Math.round(rawBar / snapBars) * snapBars : rawBar
  const minimumLength = snapBars > 0 ? Math.min(snapBars, clipEnd - clipStart) : 1e-6
  if (edge === 'left') {
    const availableBefore = (reversed ? loopBars - sourceEnd : sourceStart) / rate
    return Math.max(
      Math.max(0, clipStart - Math.max(0, availableBefore)),
      Math.min(clipEnd - minimumLength, snapped)
    )
  }
  const availableAfter = (reversed ? sourceStart : loopBars - sourceEnd) / rate
  return Math.min(
    Math.min(loopBars, clipEnd + Math.max(0, availableAfter)),
    Math.max(clipStart + minimumLength, snapped)
  )
}
