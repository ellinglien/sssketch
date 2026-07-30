import { useAppState, useDispatch } from '../state/StoreContext'
import { clipGeometry } from '../state/selectors'
import { typeColorVar } from '../theme/typeColor'
import { Waveform } from './Waveform'
import { PPB } from './Ruler'
import { computeGrabOffsetBars, setGrabOffsetBars, mouseBarFromDragEvent } from './dragGrabOffset'
import { stemKey } from '@shared/types'

// Real bar positions (the shared Ruler PPB, not a separate condensed
// scale) — a compact-only horizontal scale would also need Timeline's own
// drag-position math (barForClientX) and dragGrabOffset.ts's
// mouseBarFromDragEvent updated to match, both of which are shared,
// mode-agnostic utilities today. Compactness here comes entirely from row
// height instead: 12px vs. the expanded view's 44px per stem or the
// collapsed view's 40px per rifff, so many more rifffs fit on screen at
// once without needing a second horizontal scale to keep in sync
// everywhere a bar position gets computed.
export const COMPACT_ROW_HEIGHT = 12

/** Tiles one stem's waveform across the compact block's width, repeating
 * every stemBarLength bars — same tiling idea as CollapsedRifffRow's own
 * CollapsedTiles. Always tiled against the rifff's own barLength (not a
 * resolvePlayedBars override): compact mode has no resize affordance, so
 * there's never a playedBars value for it to diverge from. */
function CompactTiles({
  path,
  color,
  opacity,
  widthPx,
  stemBarLength,
  rifffBarLength
}: {
  path: string
  color: string
  opacity: number
  widthPx: number
  stemBarLength: number
  rifffBarLength: number
}): React.JSX.Element {
  const tileWidthPx = widthPx * (stemBarLength / rifffBarLength)
  const tileCount = Math.max(1, Math.ceil(widthPx / tileWidthPx))
  const tileOffsets = Array.from({ length: tileCount }, (_, i) => i * tileWidthPx)
  return (
    <>
      {tileOffsets.map((left) => (
        <div
          key={left}
          style={{ position: 'absolute', top: 0, bottom: 0, left, width: tileWidthPx }}
        >
          <Waveform path={path} color={color} opacity={opacity} />
        </div>
      ))}
    </>
  )
}

/**
 * Compact mode's per-rifff rendering (toggled arrangement-wide via Tab /
 * TransportBar's mode cycle — see App.tsx's Frame component). A real
 * horizontal waveform at the rifff's actual bar position, same idea as the
 * collapsed view, just at a much shorter row height and without any of the
 * collapsed view's editing affordances (resize/fade handles, envelope
 * drag, per-stem mute) — those need more vertical room than this is
 * willing to spend. Click to select, drag to move, right-click for the
 * same context menu (delete/duplicate/etc.) every other view's clip block
 * opens.
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
  const color = typeColorVar(rifff.stems[0]?.type ?? 'fx')
  const geo = clipGeometry(state, groupId, PPB)

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
            top: 0,
            bottom: 0,
            left: geo.leftPx,
            width: geo.widthPx,
            border: `1px solid color-mix(in srgb, ${color} ${selected ? 70 : 40}%, transparent)`,
            background: 'var(--ra-bg-row-sub)',
            overflow: 'hidden',
            cursor: 'grab'
          }}
        >
          {rifff.stems
            .filter((stem) => !state.mute[stemKey(groupId, stem.slot)])
            .map((stem) => (
              <CompactTiles
                key={stem.slot}
                path={stem.path}
                color={typeColorVar(stem.type)}
                opacity={0.55}
                widthPx={geo.widthPx}
                stemBarLength={stem.barLength}
                rifffBarLength={rifff.barLength}
              />
            ))}
        </div>
      </div>
    </div>
  )
}
