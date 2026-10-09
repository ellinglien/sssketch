export type SketchRiffClickAction =
  'ignore-drag' | 'select-and-play' | 'select-and-stop' | 'select-and-switch'

/** Plain-click behavior for a circular riff in Sketch view. Selection and
 * transport playback are deliberately independent: stopping the active riff
 * keeps it selected, while clicking it again from idle starts it from its
 * beginning. Native drags are ignored even if the browser emits a trailing
 * synthetic click. */
export function sketchRiffClickAction(
  playing: boolean,
  clickedRiffIsPlaying: boolean,
  dragging: boolean
): SketchRiffClickAction {
  if (dragging) return 'ignore-drag'
  if (playing && clickedRiffIsPlaying) return 'select-and-stop'
  return playing ? 'select-and-switch' : 'select-and-play'
}

/** Cmd/Ctrl-click starts from the plain-click anchor when the batch is still
 * empty. Without that seed, clicking A then Cmd-clicking B selected only B,
 * so the UI could never reach the two-riff state that exposes Cross. */
export function toggleSketchBatchSelection(
  current: ReadonlySet<string>,
  anchorId: string | null,
  clickedId: string
): Set<string> {
  const next = new Set(current)
  if (next.size === 0 && anchorId) next.add(anchorId)
  if (next.has(clickedId)) next.delete(clickedId)
  else next.add(clickedId)
  return next
}
