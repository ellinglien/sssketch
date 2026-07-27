import { useAppState, useDispatch } from '../state/StoreContext'
import { clipGeometry } from '../state/selectors'
import type { Rifff } from '@shared/types'
import { typeColorVar } from '../theme/typeColor'
import { StemSubRow } from './StemSubRow'

const PPB = 24

function identityColor(rifff: Rifff): string {
  return typeColorVar(rifff.stems[0]?.type ?? 'fx')
}

export function RifffBlockRow({ groupId }: { groupId: string }): React.JSX.Element {
  const state = useAppState()
  const dispatch = useDispatch()
  const rifff = state.rifffs[groupId]
  const selected = state.sel === groupId
  const expanded = !!state.exp[groupId]
  const color = identityColor(rifff)
  const geo = clipGeometry(state, groupId, PPB)

  return (
    <div style={{ borderBottom: '1px solid var(--ra-border-soft)' }}>
      <div style={{ display: 'flex', height: 52 }}>
        <div
          onClick={() => dispatch({ type: 'SELECT', groupId })}
          style={{
            width: 212,
            flexShrink: 0,
            borderRight: '1px solid var(--ra-border)',
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            padding: '0 10px',
            background: selected ? 'var(--ra-bg-row-active)' : 'var(--ra-bg-row)',
            cursor: 'pointer'
          }}
        >
          <button
            onClick={(e) => {
              e.stopPropagation()
              dispatch({ type: 'TOGGLE_EXPAND', groupId })
            }}
            style={{
              width: 18,
              height: 18,
              borderRadius: 4,
              border: '1px solid var(--ra-border)',
              background: 'var(--ra-bg-row-active)',
              fontSize: 9
            }}
          >
            {expanded ? '▾' : '▸'}
          </button>
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: '50%',
              background: color,
              opacity: 0.55,
              flexShrink: 0
            }}
          />
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

        <div style={{ flex: 1, position: 'relative' }}>
          <div
            style={{
              position: 'absolute',
              top: 4,
              bottom: 4,
              left: geo.leftPx,
              width: geo.widthPx,
              borderRadius: 4,
              border: `1px solid color-mix(in srgb, ${color} 55%, transparent)`,
              background: 'rgba(255,255,255,0.03)'
            }}
          >
            <div
              style={{
                height: 12,
                background: 'rgba(255,255,255,0.05)',
                fontSize: 9,
                color,
                padding: '0 4px',
                display: 'flex',
                alignItems: 'center'
              }}
            >
              linked · {rifff.stems.length} stems
            </div>
          </div>
        </div>
      </div>

      {expanded &&
        rifff.stems.map((stem) => (
          <StemSubRow key={stem.slot} groupId={groupId} slot={stem.slot} />
        ))}
    </div>
  )
}
