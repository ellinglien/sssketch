import { useAppState } from '../state/StoreContext'
import { stemKey } from '@shared/types'
import { stemGeometry } from '../state/selectors'
import { typeColorVar } from '../theme/typeColor'
import { Waveform } from './Waveform'
import { PPB } from './Ruler'

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
  const color = typeColorVar(stem.type)
  const key = stemKey(groupId, slot)
  const muted = !!state.mute[key]
  const unlinked = !!state.unlinked[groupId]

  // Identical to the group's own geometry while linked (or before a drag);
  // anchored to this stem's own independent position once unlinked and moved.
  const stemGeo = stemGeometry(state, groupId, slot, PPB)
  const repetitions = Math.max(1, Math.round(rifff.barLength / stem.barLength))
  // Divide the clip's actual width evenly across repetitions, rather than scaling
  // each segment independently from the stem/rifff bar-length ratio — the latter
  // only tiles exactly when barLength divides evenly (e.g. 8/2), and silently
  // overshoots or leaves a gap otherwise (e.g. an 8-bar rifff with a 3-bar stem:
  // round(8/3)=3 reps at (3/8)*width each overshoots by a full bar).
  const repWidthPx = stemGeo.widthPx / repetitions

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
        <div
          draggable={unlinked}
          onDragStart={(e) => {
            if (!unlinked) return
            e.dataTransfer.setData('text/rifff-stem-key', key)
          }}
          title={unlinked ? 'drag to move this stem independently' : undefined}
          style={{
            position: 'absolute',
            top: 3,
            bottom: 3,
            left: stemGeo.leftPx,
            width: stemGeo.widthPx,
            cursor: unlinked ? 'grab' : 'default'
          }}
        >
          {Array.from({ length: repetitions }, (_, i) => (
            <div
              key={i}
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: i * repWidthPx,
                width: repWidthPx,
                borderRadius: 2,
                border: `1px solid color-mix(in srgb, ${color} 50%, transparent)`,
                background: `color-mix(in srgb, ${color} 7%, transparent)`,
                opacity: muted ? 0.35 : 1,
                overflow: 'hidden'
              }}
            >
              <Waveform path={stem.path} color={color} opacity={1} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
