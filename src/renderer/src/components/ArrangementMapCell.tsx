import { COACH_MAP_LOCKED_CELL_HINT } from '@shared/coachLines'
import type { SoundType } from '@shared/types'
import { typeColorVar } from '../theme/typeColor'

export const MAP_CELL_WIDTH = 16
export const MAP_CELL_HEIGHT = 20
export const MAP_CELL_GAP = 1

/**
 * One pass of one row.
 *
 * Colour: an ON cell on a STEM row is the app's documented chip recipe in
 * that stem's own type colour -- background at 14%, border at 50%
 * (tokens.css's alpha recipe). That is colour spent on something carrying
 * audio information, which is the only kind this app allows.
 *
 * A riser row has NO sound type and must not be given one (RiserBlock.tsx
 * says so directly), so `soundType` is null there and the cell falls back to
 * the monochrome fill. That riser rows read as grey while stem rows read as
 * coloured is the point: it is the same distinction the arranger already
 * draws, and it is what makes "this row is not something the map can put
 * back" visible without a legend.
 *
 * A LOCKED cell is a clip that runs past the section's edge (coachMapEdit's
 * clipsCrossingSectionEdge). Dashed, not-allowed, and its tooltip says where
 * to go instead. Nothing is ever destroyed by a refusal.
 */
export function ArrangementMapCell({
  on,
  locked,
  editable,
  soundType,
  dimmed,
  label,
  onToggle
}: {
  on: boolean
  locked: boolean
  /** False for riser and other rows -- there is no stem the map could put
   * back, so the cell reports and does not act. */
  editable: boolean
  soundType: SoundType | null
  /** True for every column that is not the one being walked. */
  dimmed: boolean
  label: string
  onToggle: () => void
}): React.JSX.Element {
  const colour = soundType === null ? null : typeColorVar(soundType)
  const background = !on
    ? 'var(--ra-bg-row)'
    : colour === null
      ? 'var(--ra-bg-row-active)'
      : `color-mix(in srgb, ${colour} 14%, transparent)`
  const border = !on
    ? '1px solid var(--ra-border-soft)'
    : colour === null
      ? '1px solid var(--ra-border-strong)'
      : `1px solid color-mix(in srgb, ${colour} 50%, transparent)`

  return (
    <button
      type="button"
      disabled={!editable || locked}
      onClick={onToggle}
      data-tooltip={locked ? COACH_MAP_LOCKED_CELL_HINT : label}
      style={{
        width: MAP_CELL_WIDTH,
        height: MAP_CELL_HEIGHT,
        flex: 'none',
        padding: 0,
        borderRadius: 0,
        background,
        border: locked ? '1px dashed var(--ra-border-strong)' : border,
        opacity: dimmed ? 0.45 : 1,
        cursor: !editable ? 'default' : locked ? 'not-allowed' : 'pointer'
      }}
    />
  )
}
