import { useAppState, useDispatch } from '../state/StoreContext'
import type { Rifff } from '@shared/types'
import { typeColorVar } from '../theme/typeColor'
import { StemWaveformRow } from './StemWaveformRow'
import { CollapsedRifffRow } from './CollapsedRifffRow'
import { CompactRifffBlock } from './CompactRifffBlock'
import { computeGrabOffsetBars, setGrabOffsetBars, mouseBarFromDragEvent } from './dragGrabOffset'
import { clipGeometry } from '../state/selectors'
import { PPB, COMPACT_PPB } from './Ruler'
import { suppressNextSyntheticClick } from './dragUtils'

const NAME_BAR_HEIGHT = 18

function identityColor(rifff: Rifff): string {
  return typeColorVar(rifff.stems[0]?.type ?? 'fx')
}

export function RifffBlockRow({
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
  const expanded = !!state.exp[groupId]
  const color = identityColor(rifff)
  const compact = state.mode === 'compact'

  // Compact mode's own collapsed view (CompactRifffBlock) only covers the
  // "everything mixed into one thin row" case — expanding still needs the
  // full per-stem StemWaveformRow breakdown to actually mute/drag/resize
  // individual stems, same as Normal mode. Only the collapsed branch
  // bypasses this component's own name-bar/expand machinery below; once
  // expanded, compact mode falls through to the exact same structure Normal
  // mode uses, just at Compact's own horizontal scale (ppb below) so an
  // expanded rifff's stems stay aligned with everything else in the compact
  // timeline instead of quietly reverting to Normal mode's wider spacing.
  if (compact && !expanded) {
    return <CompactRifffBlock groupId={groupId} onOpenContextMenu={onOpenContextMenu} />
  }

  const ppb = compact ? COMPACT_PPB : PPB
  const geo = clipGeometry(state, groupId, ppb)

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
        draggable
        onDragStart={(e) => {
          suppressNextSyntheticClick()
          e.dataTransfer.setData('text/rifff-group-id', groupId)
          const mouseBar = mouseBarFromDragEvent(e, ppb)
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
        // Only reachable in Normal mode — compact mode's own collapsed
        // state already returned via CompactRifffBlock above.
        <CollapsedRifffRow groupId={groupId} selected={selected} />
      )}
    </div>
  )
}
