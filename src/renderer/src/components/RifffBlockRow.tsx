import { useAppSelector, useDispatch, useZoom } from '../state/StoreContext'
import type { Rifff } from '@shared/types'
import { stemColorVar } from '../theme/typeColor'
import { StemWaveformRow } from './StemWaveformRow'
import { CollapsedRifffRow } from './CollapsedRifffRow'
import { computeGrabOffsetBars, setGrabOffsetBars, mouseBarFromDragEvent } from './dragGrabOffset'
import { clipGeometryFromFields } from '../state/selectors'
import { SNAP_DIVS } from '../state/store'
import { ROW_HEIGHT } from './StemWaveformRow'
import { suppressNextSyntheticClick } from './dragUtils'
import { useFrameScale } from '../state/FrameScaleContext'

export const NAME_BAR_HEIGHT = 18

function identityColor(rifff: Rifff): string {
  return stemColorVar(rifff.stems[0])
}

export function RifffBlockRow({
  groupId,
  onOpenContextMenu
}: {
  groupId: string
  onOpenContextMenu: (x: number, y: number, groupId: string) => void
}): React.JSX.Element {
  const dispatch = useDispatch()
  // Each field read individually via useAppSelector, not one broad
  // useAppState() call -- see
  // docs/superpowers/specs/2026-08-03-fine-grained-state-selectors-design.md.
  const rifff = useAppSelector((s) => s.rifffs[groupId])
  const selected = useAppSelector((s) => s.sel === groupId)
  const expandedFlag = useAppSelector((s) => !!s.exp[groupId])
  const offsetSteps = useAppSelector((s) => s.off[groupId] ?? 0)
  const leftCropBars = useAppSelector((s) => s.leftCrop[groupId] ?? 0)
  const snapIdx = useAppSelector((s) => s.snapIdx)
  const stretchOn = useAppSelector((s) => s.stretch[groupId] ?? true)
  const bpm = useAppSelector((s) => s.bpm)
  const playedBarsOverride = useAppSelector((s) => s.playedBars[groupId])
  // A one-shot always has exactly one stem (enforced by importOneShot) --
  // there's nothing extra an expanded per-stem view would show that
  // CollapsedRifffRow doesn't already, and CollapsedRifffRow is the only
  // place the one-shot-aware trim/stretch resize handles are wired (see
  // oneShotResize.ts) -- StemWaveformRow's own handles are still the
  // bar-snapped playedBars/RESIZE_LEFT ones, which would be wrong for a
  // one-shot.
  const isOneShot = rifff.stems.length === 1 && !!rifff.stems[0].oneShot
  const expanded = expandedFlag && !isOneShot
  const color = identityColor(rifff)
  const ppb = useZoom()
  const frameScale = useFrameScale()
  const geo = clipGeometryFromFields({
    startBar: rifff.startBar ?? 0,
    offsetSteps,
    snapDiv: SNAP_DIVS[snapIdx],
    playedBarsOverride,
    leftCropBars,
    rifffBarLength: rifff.barLength,
    stretchOn,
    rifffBpm: rifff.bpm,
    stateBpm: bpm,
    ppb
  })

  return (
    <div style={{ position: 'relative', borderBottom: '1px solid var(--ra-border-soft)' }}>
      {/* Spacer reserving the row's vertical space for the name bar below,
          which is positioned absolutely over it instead of sitting in
          normal flow. */}
      <div style={{ height: NAME_BAR_HEIGHT }} />
      {/* Name bar, positioned directly above the clip's own wave (leftPx/
          widthPx from clipGeometry) rather than spanning the row's full
          width from bar 0 — it used to sit at the timeline's left edge
          regardless of where the clip itself was placed, so a clip parked
          far right needed scrolling all the way back to the left just to
          find its own expand/collapse control. Selecting here is enough to
          show this rifff's fuller detail (glyph, stem list, tempo, etc.) in
          the always-visible Inspector — nothing here needs to duplicate
          that. */}
      <div
        data-rifff-clip
        draggable
        onDragStart={(e) => {
          suppressNextSyntheticClick()
          e.dataTransfer.setData('text/rifff-group-id', groupId)
          const mouseBar = mouseBarFromDragEvent(e, ppb, frameScale)
          if (mouseBar !== null) {
            setGrabOffsetBars(computeGrabOffsetBars(mouseBar, rifff.startBar ?? 0))
          }
        }}
        onClick={(e) => {
          // Stops the click from also bubbling up to Timeline's own
          // background click-to-scrub handler in App.tsx — expanding/
          // collapsing a rifff shouldn't also jump the playhead.
          e.stopPropagation()
          dispatch({ type: 'SELECT', groupId })
          dispatch({ type: 'TOGGLE_EXPAND', groupId })
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          if (e.ctrlKey) {
            dispatch({ type: 'SOLO_GROUP', groupId })
            return
          }
          dispatch({ type: 'SELECT', groupId })
          onOpenContextMenu(e.clientX, e.clientY, groupId)
        }}
        title={(expanded ? 'click to collapse' : 'click to expand') + ' · ctrl+right-click to solo'}
        style={{
          position: 'absolute',
          top: 0,
          left: geo.leftPx,
          width: geo.widthPx,
          height: NAME_BAR_HEIGHT,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '0 8px',
          cursor: 'grab',
          overflow: 'hidden',
          background: selected ? 'var(--ra-bg-row-active)' : 'var(--ra-bg-row)'
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            color,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}
        >
          {rifff.name}
        </span>
      </div>

      {expanded ? (
        rifff.stems.map((stem) => (
          <StemWaveformRow key={stem.slot} groupId={groupId} slot={stem.slot} ppb={ppb} />
        ))
      ) : (
        <CollapsedRifffRow groupId={groupId} selected={selected} />
      )}

      {/* Selection outline, wrapping the whole clip (name bar + every stem
          row) — expanded mode has no other selection cue on the stem rows
          themselves (only the name bar's background shifts), which read as
          too subtle to tell which rifff is selected at a glance. A plain
          overlay rather than styling each row individually, so it doesn't
          have to thread `selected` through StemWaveformRow. */}
      {selected && expanded && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: geo.leftPx,
            width: geo.widthPx,
            height: NAME_BAR_HEIGHT + rifff.stems.length * ROW_HEIGHT,
            border: `2px solid ${color}`,
            pointerEvents: 'none'
          }}
        />
      )}
    </div>
  )
}
