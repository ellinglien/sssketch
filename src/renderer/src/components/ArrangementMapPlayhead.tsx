import { coachMapBarToX, type CoachMapSpan } from '@shared/coachMapGeometry'
import { usePos } from '../state/StoreContext'

/**
 * Where playback is, on the map.
 *
 * ITS OWN COMPONENT FOR ONE REASON: the engine pushes a position ~30 times
 * a second, and usePos() is a context read, so whatever calls it re-renders
 * that often. Keeping the call down here means a tick re-renders one
 * absolutely-positioned div and nothing else -- not the rows, not the cells,
 * not the section headers. Exactly what Playhead.tsx does for the arranger,
 * and for exactly the same reason. Do not move usePos() up into
 * ArrangementMap.
 *
 * `spans` comes from the parent because only the parent knows what it drew.
 * It changes when the map changes, which is not 30 times a second.
 *
 * A position that is not on the map -- before the first section, past the
 * last -- draws nothing at all rather than parking the line at the edge,
 * where it would claim playback is somewhere it is not.
 */
export function ArrangementMapPlayhead({
  spans,
  left
}: {
  spans: readonly CoachMapSpan[]
  /** The grid's own origin: the row headers sit to the left of it. */
  left: number
}): React.JSX.Element | null {
  const pos = usePos()
  const x = coachMapBarToX(spans, pos)
  if (x === null) return null
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: left + x,
        width: 1,
        background: 'var(--ra-playhead)',
        pointerEvents: 'none'
      }}
    />
  )
}
