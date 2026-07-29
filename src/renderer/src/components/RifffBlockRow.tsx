import { useAppState, useDispatch } from '../state/StoreContext'
import type { Rifff } from '@shared/types'
import { typeColorVar } from '../theme/typeColor'
import { StemWaveformRow } from './StemWaveformRow'
import { CollapsedRifffRow } from './CollapsedRifffRow'
import { computeGrabOffsetBars, setGrabOffsetBars, mouseBarFromDragEvent } from './dragGrabOffset'

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

  return (
    <div style={{ borderBottom: '1px solid var(--ra-border-soft)' }}>
      {/* Thin name bar, full width — replaces the old 212px-wide left column
          (name/glyph header + each stem's own label column), which fought
          over the exact same screen real estate across StemWaveformRow rows
          (a positioned sibling always painting over a non-positioned one,
          regardless of DOM order, made the first stem row's own controls
          unreachable — patched once, but removing the contested column
          entirely is the actual fix). Selecting here is enough to show this
          rifff's fuller detail (glyph, stem list, tempo, etc.) in the
          always-visible Inspector — nothing here needs to duplicate that. */}
      <div
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('text/rifff-group-id', groupId)
          const mouseBar = mouseBarFromDragEvent(e)
          if (mouseBar !== null) {
            setGrabOffsetBars(computeGrabOffsetBars(mouseBar, rifff.startBar ?? 0))
          }
        }}
        onClick={() => {
          dispatch({ type: 'SELECT', groupId })
          dispatch({ type: 'TOGGLE_EXPAND', groupId })
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          dispatch({ type: 'SELECT', groupId })
          onOpenContextMenu(e.clientX, e.clientY, groupId)
        }}
        title={expanded ? 'click to collapse' : 'click to expand'}
        style={{
          height: NAME_BAR_HEIGHT,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '0 8px',
          cursor: 'grab',
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
          <StemWaveformRow key={stem.slot} groupId={groupId} slot={stem.slot} />
        ))
      ) : (
        <CollapsedRifffRow groupId={groupId} selected={selected} />
      )}
    </div>
  )
}
