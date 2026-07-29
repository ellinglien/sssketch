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
    <div style={{ borderBottom: '1px solid var(--ra-border-soft)' }}>
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
          width: 212,
          flexShrink: 0,
          borderRight: '1px solid var(--ra-border)',
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          padding: '0 10px',
          height: 44,
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
