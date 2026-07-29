import { useAppState, useDispatch } from '../state/StoreContext'
import type { Rifff } from '@shared/types'
import { typeColorVar } from '../theme/typeColor'
import { StemWaveformRow } from './StemWaveformRow'
import { PolarGlyph } from './PolarGlyph'

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
  const color = identityColor(rifff)

  return (
    <div style={{ borderBottom: '1px solid var(--ra-border-soft)', position: 'relative' }}>
      {/* Absolutely positioned (rather than a normal-flow row of its own) so it
          spans the FULL height of every stem row stacked below, not just the
          first one's 44px — a plain in-flow div here would only ever be as
          tall as its own content, leaving rows 2+ with a blank left gutter
          and no visible tie back to this rifff's identity. The wrapper above
          has no explicit height, so it's sized purely by the in-flow stem
          rows below; this being taken out of flow (position: absolute) is
          exactly what lets it stretch to match that height via top/bottom:0
          rather than fighting over who determines it. */}
      <div
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('text/rifff-group-id', groupId)
        }}
        onClick={() => dispatch({ type: 'SELECT', groupId })}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          dispatch({ type: 'SELECT', groupId })
          onOpenContextMenu(e.clientX, e.clientY, groupId)
        }}
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: 0,
          width: 212,
          flexShrink: 0,
          borderRight: '1px solid var(--ra-border)',
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          padding: '0 10px',
          minHeight: 44,
          background: selected ? 'var(--ra-bg-row-active)' : 'var(--ra-bg-row)',
          cursor: 'grab'
        }}
      >
        <PolarGlyph stems={rifff.stems} identityColor={color} size={30} />
        <div style={{ overflow: 'hidden' }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              whiteSpace: 'nowrap',
              textOverflow: 'ellipsis',
              overflow: 'hidden'
            }}
          >
            {rifff.name}
          </div>
          <div style={{ fontSize: 9, color: 'var(--ra-text-3)' }}>
            {rifff.stems.length} stems · {rifff.barLength} bars · {rifff.bpm} bpm
          </div>
        </div>
      </div>

      {rifff.stems.map((stem) => (
        <StemWaveformRow key={stem.slot} groupId={groupId} slot={stem.slot} />
      ))}
    </div>
  )
}
