/** The keys EEEDIT takes for itself (capture phase, nothing else sees them). None while a
 * dialog or menu is open over it (`overlayOpen`): that overlay's own keys, Escape above all, must
 * reach it. Cmd+Z isn't one: EEEDIT claims it through the app's undo routing (useClaimUndo). */
export function shapeOwnsKey(
  key: string,
  code: string,
  command: boolean,
  overlayOpen = false
): boolean {
  if (overlayOpen) return false
  return (
    code === 'Space' ||
    key === 'Escape' ||
    key === '0' ||
    key === 'Delete' ||
    key === 'Backspace' ||
    (command && ['1', '2', 'c', 'd', 'e', 's', 'v'].includes(key.toLowerCase()))
  )
}

/** A dialog or menu open over EEEDIT: the app's confirmation dialogs (aria-modal) and context
 * menus (ContextMenu.tsx marks itself). */
export const SHAPE_OVERLAY_SELECTOR = '[aria-modal="true"], [data-ra-overlay]'

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

/** The selection after a lane's m or s is clicked: monitoring a lane also makes it the one being
 * edited, so treatments and transforms never go to a selected lane that is now silent. A
 * selection already inside that lane is kept as it is; anything else becomes the whole lane.
 * Selection isn't an undo step. */
export function selectionForLaneMonitor(
  current: Set<string>,
  laneFragmentIds: readonly string[]
): Set<string> {
  const lane = new Set(laneFragmentIds)
  if (current.size > 0 && [...current].every((id) => lane.has(id))) return current
  return lane
}
