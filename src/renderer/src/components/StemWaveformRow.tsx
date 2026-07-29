import { useState } from 'react'
import { useDispatch, useAppState } from '../state/StoreContext'
import { stemKey } from '@shared/types'
import { stemGeometry, resolveOffsetKey, resolvePlayedBars } from '../state/selectors'
import { typeColorVar } from '../theme/typeColor'
import { Waveform } from './Waveform'
import { PPB } from './Ruler'
import { startPointerDrag } from './dragUtils'

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
  const playedBarsKey = resolveOffsetKey(state, groupId, slot)
  const muted = !!state.mute[key]
  const unlinked = !!state.unlinked[groupId]
  const volume = state.vol[key] ?? 1
  const fadeIn = state.fadeIn[groupId] ?? 0
  const fadeOut = state.fadeOut[groupId] ?? 0

  const [dragPlayedBars, setDragPlayedBars] = useState<number | null>(null)
  const resolvedPlayedBars = resolvePlayedBars(state, groupId, slot)
  const displayedPlayedBars = dragPlayedBars ?? resolvedPlayedBars

  const stemGeo = stemGeometry(state, groupId, slot, PPB)
  // While actively dragging, use the in-progress width instead of the
  // committed-state one, so the row visibly resizes in real time.
  const widthPx = dragPlayedBars !== null ? dragPlayedBars * PPB : stemGeo.widthPx

  const fadeInPx = fadeIn * PPB
  const fadeOutPx = fadeOut * PPB
  const plateauY = ROW_HEIGHT * (1 - volume)
  const envelopePath = buildEnvelopePath(widthPx, ROW_HEIGHT, fadeInPx, fadeOutPx, plateauY)

  function handleResizeStart(e: React.MouseEvent): void {
    const startPlayedBars = resolvedPlayedBars
    startPointerDrag(
      e,
      (deltaX) => {
        const next = Math.max(0.25, startPlayedBars + deltaX / PPB)
        setDragPlayedBars(next)
      },
      () => {
        setDragPlayedBars((current) => {
          if (current !== null) {
            dispatch({ type: 'SET_PLAYED_BARS', key: playedBarsKey, bars: current })
          }
          return null
        })
      }
    )
  }

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
            width: widthPx,
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

          {/* Resize handle: right edge only (see architecture note — left-edge
              trim would require also moving the stem's start, a separate
              mechanism, so it's deliberately out of scope). Drags update local
              state only, and dispatch SET_PLAYED_BARS exactly once on mouseup
              (see dragUtils.startPointerDrag) so a long drag can't flood undo
              history. */}
          <div
            onMouseDown={handleResizeStart}
            title={`${displayedPlayedBars.toFixed(2)} bars`}
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              right: 0,
              width: 5,
              cursor: 'ew-resize',
              background: '#fff',
              opacity: 0.55,
              zIndex: 3
            }}
          />
        </div>
      </div>
    </div>
  )
}
