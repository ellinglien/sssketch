import { useAppState, useDispatch } from '../state/StoreContext'
import { PolarGlyph } from './PolarGlyph'
import { typeColorVar } from '../theme/typeColor'
import { PPB } from './Ruler'
import { computeGrabOffsetBars, setGrabOffsetBars, mouseBarFromDragEvent } from './dragGrabOffset'

export const COMPACT_ROW_HEIGHT = 40
const TILE_SIZE = 32

/**
 * Compact mode's per-rifff rendering (toggled arrangement-wide by Tab, see
 * App.tsx's Frame) — a small fixed-size glyph tile at the rifff's real
 * timeline position, rather than a duration-proportional waveform block.
 * Deliberately has no mute/volume/fade/resize controls: it's a positional
 * overview, not another place to edit the mix. Drag to move, click to
 * select (which surfaces the full detail in the always-visible Inspector).
 */
export function CompactRifffBlock({
  groupId,
  onOpenContextMenu
}: {
  groupId: string
  onOpenContextMenu: (x: number, y: number, groupId: string) => void
}): React.JSX.Element {
  const state = useAppState()
  const dispatch = useDispatch()
  const rifff = state.rifffs[groupId]
  const selected = state.sel === groupId
  const leftPx = (rifff.startBar ?? 0) * PPB

  return (
    <div
      style={{
        display: 'flex',
        height: COMPACT_ROW_HEIGHT,
        borderTop: '1px solid var(--ra-bg-row)'
      }}
    >
      <div style={{ flex: 1, position: 'relative' }}>
        <div
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('text/rifff-group-id', groupId)
            const mouseBar = mouseBarFromDragEvent(e)
            if (mouseBar !== null) {
              setGrabOffsetBars(computeGrabOffsetBars(mouseBar, rifff.startBar ?? 0))
            }
          }}
          onClick={() => dispatch({ type: 'SELECT', groupId })}
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
            dispatch({ type: 'SELECT', groupId })
            onOpenContextMenu(e.clientX, e.clientY, groupId)
          }}
          title={rifff.name}
          style={{
            position: 'absolute',
            left: leftPx,
            top: (COMPACT_ROW_HEIGHT - TILE_SIZE) / 2,
            width: TILE_SIZE,
            height: TILE_SIZE,
            cursor: 'grab',
            border: 'none',
            background: 'var(--ra-bg-row)',
            // No border to mark selection anymore — opacity carries that
            // instead (same convention as the shelf's own tiles).
            opacity: selected ? 1 : 0.72,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <PolarGlyph
            stems={rifff.stems}
            identityColor={typeColorVar(rifff.stems[0]?.type ?? 'fx')}
            size={TILE_SIZE - 8}
          />
        </div>
      </div>
    </div>
  )
}
