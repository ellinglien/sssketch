import { useAppState } from '../state/StoreContext'
import { stemKey } from '@shared/types'
import { clipGeometry } from '../state/selectors'
import { TYPE_COLOR } from './RifffBlockRow'

const PPB = 24

export function StemSubRow({
  groupId,
  slot
}: {
  groupId: string
  slot: number
}): React.JSX.Element {
  const state = useAppState()
  const rifff = state.rifffs[groupId]
  const stem = rifff.stems.find((s) => s.slot === slot)!
  const color = TYPE_COLOR[stem.type]
  const key = stemKey(groupId, slot)
  const muted = !!state.mute[key]

  const groupGeo = clipGeometry(state, groupId, PPB)
  const repetitions = Math.max(1, Math.round(rifff.barLength / stem.barLength))
  const repWidthPx = (stem.barLength / rifff.barLength) * groupGeo.widthPx

  return (
    <div
      style={{
        display: 'flex',
        height: 26,
        background: 'var(--ra-bg-row-sub)',
        borderTop: '1px solid var(--ra-bg-row)'
      }}
    >
      <div
        style={{
          width: 212,
          flexShrink: 0,
          padding: '0 10px 0 34px',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          opacity: muted ? 0.5 : 1
        }}
      >
        <div style={{ width: 6, height: 12, borderRadius: 2, background: color, flexShrink: 0 }} />
        <span style={{ fontSize: 9, color: 'var(--ra-text-3)' }}>{stem.slot}</span>
        <span
          style={{
            fontSize: 10,
            color: muted ? 'var(--ra-text-3)' : 'var(--ra-text)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}
        >
          {stem.name}
        </span>
      </div>
      <div style={{ flex: 1, position: 'relative' }}>
        {Array.from({ length: repetitions }, (_, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              top: 3,
              bottom: 3,
              left: groupGeo.leftPx + i * repWidthPx,
              width: repWidthPx,
              borderRadius: 2,
              border: `1px solid color-mix(in srgb, ${color} 50%, transparent)`,
              background: `color-mix(in srgb, ${color} 7%, transparent)`,
              opacity: muted ? 0.35 : 1
            }}
          />
        ))}
      </div>
    </div>
  )
}
