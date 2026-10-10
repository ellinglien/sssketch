export interface ShelfPreviewHandoff {
  playing: boolean
  pauseArrangement: () => void
  stopEngine: () => Promise<unknown>
}

/** Shelf previews use Web Audio while the arrangement uses the native
 * engine. Updating React's `playing` state alone stops the native engine in
 * a later effect, leaving a window where both can be heard. This handoff
 * makes the state change first, then waits for the native stop before a
 * caller starts its preview.
 *
 * Resolves true once the engine has confirmed silence and false when it
 * couldn't: a newer Play superseded the stop, or the engine didn't answer.
 * It never rejects, so no caller can leak an unhandled rejection; a caller
 * that gets false must not start Web Audio, which would recreate the
 * overlap this handoff exists to prevent. (A stopped or unplugged audio
 * device is not a failure: the engine acknowledges that as silence.) */
export async function pauseArrangementBeforeShelfPreview({
  playing,
  pauseArrangement,
  stopEngine
}: ShelfPreviewHandoff): Promise<boolean> {
  if (playing) pauseArrangement()
  // Always join the main process's shared stop barrier. A second tile can
  // be clicked after React state already says paused but while the native
  // engine is still fading the first stop; returning early in that state
  // would let the replacement preview overlap the tail.
  try {
    await stopEngine()
    return true
  } catch (err) {
    console.warn(
      'preview: the arrangement did not confirm it stopped, so the preview stays off:',
      err
    )
    return false
  }
}
