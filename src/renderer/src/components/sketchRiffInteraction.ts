import type { Action } from '../state/store'

export type SketchRiffClickAction =
  'ignore-drag' | 'select-only' | 'select-and-play' | 'select-and-stop' | 'select-and-switch'

/** The glyph is an inscribed circle inside its square selection tile. A
 * click in one of the square's exposed corners selects the riff without
 * touching transport; only points inside this circle are playback gestures. */
export function sketchRiffPlaybackHit(
  localX: number,
  localY: number,
  width: number,
  height: number
): boolean {
  const radius = Math.min(width, height) / 2
  const dx = localX - width / 2
  const dy = localY - height / 2
  return dx * dx + dy * dy <= radius * radius
}

/** Plain-click behavior for a circular riff in Sketch view. Selection and
 * transport playback are deliberately independent: stopping the active riff
 * keeps it selected, while clicking it again from idle starts it from its
 * beginning. The square area outside the inscribed glyph only selects.
 * Native drags are ignored even if the browser emits a trailing synthetic
 * click. */
export function sketchRiffClickAction(
  playing: boolean,
  clickedRiffIsPlaying: boolean,
  dragging: boolean,
  playbackHit: boolean
): SketchRiffClickAction {
  if (dragging) return 'ignore-drag'
  if (!playbackHit) return 'select-only'
  if (playing && clickedRiffIsPlaying) return 'select-and-stop'
  return playing ? 'select-and-switch' : 'select-and-play'
}

/** Sketch and Shelf Cmd/Ctrl-click both start from the plain-click anchor
 * when their local batch is still empty. Without that seed, clicking A then
 * Cmd-clicking B selects only B, so the UI can never reach the two-riff
 * state that exposes Cross. */
export function toggleRiffBatchSelection(
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

/** Resolve a global Delete/Backspace gesture to riffs that are actually
 * placed in Sketch. Shared Shelf/Sketch selection may also contain shelf-only
 * riffs, which must never be treated as Sketch removal targets. */
export function sketchRemovalTargets(
  selectedIds: ReadonlySet<string>,
  selectedRiffId: string | null,
  placedIds: readonly string[]
): Set<string> {
  const placed = new Set(placedIds)
  const targets = new Set([...selectedIds].filter((id) => placed.has(id)))
  if (targets.size === 0 && selectedRiffId && placed.has(selectedRiffId)) {
    targets.add(selectedRiffId)
  }
  return targets
}

/** Build the ordered edits for one atomic history BATCH. */
export function sketchRemovalActions(
  sequenceIds: readonly string[],
  targetIds: ReadonlySet<string>
): Action[] {
  return [
    ...[...targetIds].map((groupId): Action => ({ type: 'REMOVE_FROM_TIMELINE', groupId })),
    { type: 'SEQUENCE_RIFFFS', groupIds: sequenceIds.filter((id) => !targetIds.has(id)) }
  ]
}
