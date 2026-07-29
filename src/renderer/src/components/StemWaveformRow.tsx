import { useDispatch, useAppState } from '../state/StoreContext'
import { stemKey } from '@shared/types'
import { stemGeometry } from '../state/selectors'
import { typeColorVar } from '../theme/typeColor'
import { Waveform } from './Waveform'
import { PPB } from './Ruler'

const ROW_HEIGHT = 44

/** Builds the SVG path `d` for the "below the envelope" region — a closed shape
 * bounded above by a curve that eases from silence at the very start, up to the
 * volume plateau by fadeInPx, holds flat until foStart, then eases back down to
 * silence by the very end. Used as a CSS clip-path on the full-color waveform
 * layer; everything outside this region (above the curve) shows only the
 * always-visible gray layer underneath. */
function buildEnvelopePath(
  width: number,
  height: number,
  fadeInPx: number,
  fadeOutPx: number,
  plateauY: number
): string {
  const fiEnd = Math.min(fadeInPx, width / 2)
  const foStart = Math.max(width - fadeOutPx, width / 2)
  const c1x = fiEnd * 0.35
  const c2x = fiEnd * 0.65
  const c3x = foStart + (width - foStart) * 0.35
  const c4x = foStart + (width - foStart) * 0.65
  return (
    `M0,${height} ` +
    `C${c1x},${height} ${c2x},${plateauY} ${fiEnd},${plateauY} ` +
    `L${foStart},${plateauY} ` +
    `C${c3x},${plateauY} ${c4x},${height} ${width},${height} ` +
    `Z`
  )
}

export function StemWaveformRow({
  groupId,
  slot
}: {
  groupId: string
  slot: number
}): React.JSX.Element {
  const state = useAppState()
  const dispatch = useDispatch()
  const rifff = state.rifffs[groupId]
  const stem = rifff.stems.find((s) => s.slot === slot)!
  const color = typeColorVar(stem.type)
  const key = stemKey(groupId, slot)
  const muted = !!state.mute[key]
  const unlinked = !!state.unlinked[groupId]
  const volume = state.vol[key] ?? 1
  const fadeIn = state.fadeIn[groupId] ?? 0
  const fadeOut = state.fadeOut[groupId] ?? 0

  const stemGeo = stemGeometry(state, groupId, slot, PPB)
  const fadeInPx = fadeIn * PPB
  const fadeOutPx = fadeOut * PPB
  const plateauY = ROW_HEIGHT * (1 - volume)
  const envelopePath = buildEnvelopePath(stemGeo.widthPx, ROW_HEIGHT, fadeInPx, fadeOutPx, plateauY)

  return (
    <div style={{ display: 'flex', height: ROW_HEIGHT, borderTop: '1px solid var(--ra-bg-row)' }}>
      <div style={{ width: 212, flexShrink: 0 }} />
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
            top: 0,
            bottom: 0,
            left: stemGeo.leftPx,
            width: stemGeo.widthPx,
            cursor: unlinked ? 'grab' : 'default',
            borderRadius: 3,
            border: `1px solid color-mix(in srgb, ${color} 40%, transparent)`,
            background: 'var(--ra-bg-row-sub)',
            overflow: 'hidden'
          }}
        >
          {/* Always-visible gray layer underneath */}
          <Waveform path={stem.path} color="var(--ra-text-3)" opacity={1} />

          {/* Full-color layer on top, clipped to the envelope — suppressed
              entirely while muted, since mute always wins over the envelope. */}
          {!muted && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                clipPath: `path("${envelopePath}")`
              }}
            >
              <Waveform path={stem.path} color={color} opacity={1} />
            </div>
          )}

          {/* Mute dot: filled = unmuted (active), hollow = muted (off). Bigger
              than a typical small control, vertically centered on the row. */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              dispatch({ type: 'TOGGLE_MUTE', stemKey: key })
            }}
            title={muted ? 'unmute' : 'mute'}
            style={{
              position: 'absolute',
              top: '50%',
              left: 7,
              transform: 'translateY(-50%)',
              width: 12,
              height: 12,
              borderRadius: '50%',
              border: '1.5px solid rgba(201,191,232,0.6)',
              background: muted ? 'transparent' : 'var(--ra-text-2)',
              padding: 0,
              cursor: 'pointer',
              zIndex: 3
            }}
          />
        </div>
      </div>
    </div>
  )
}
