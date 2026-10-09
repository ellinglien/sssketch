export interface ShelfPreviewHandoff {
  playing: boolean
  pauseArrangement: () => void
  stopEngine: () => Promise<unknown>
}

/** Shelf previews use Web Audio while the arrangement uses the native
 * engine. Updating React's `playing` state alone stops the native engine in
 * a later effect, leaving a window where both can be heard. This handoff
 * makes the state change first, then waits for the native stop before a
 * caller starts its preview. */
export async function pauseArrangementBeforeShelfPreview({
  playing,
  pauseArrangement,
  stopEngine
}: ShelfPreviewHandoff): Promise<void> {
  if (playing) pauseArrangement()
  // Always join the main process's shared stop barrier. A second tile can
  // be clicked after React state already says paused but while the native
  // engine is still fading the first stop; returning early in that state
  // would let the replacement preview overlap the tail.
  await stopEngine()
}
