import { useAppState, useDispatch } from '../state/StoreContext'
import { stemKey } from '@shared/types'
import { stemGeometry } from '../state/selectors'
import { typeColorVar } from '../theme/typeColor'
import { Waveform } from './Waveform'
import { PolarGlyph } from './PolarGlyph'
import { PPB } from './Ruler'
import { ROW_HEIGHT } from './StemWaveformRow'
import { computeGrabOffsetBars, setGrabOffsetBars, mouseBarFromDragEvent } from './dragGrabOffset'

/** Tiles one representative stem's waveform across the collapsed block's
 * width, repeating every rifff.barLength — same non-stretching-loop rationale
 * as StemWaveformRow's own tiling (see that file's comment), simplified here
 * since a collapsed block isn't individually resizable: one tile is
 * barLength bars wide in pixels, repeated across widthPx (the rifff's
 * current played length, from stemGeometry — see this file's own comment
 * below for why that's the right geometry source here). */
function CollapsedTiles({
  path,
  color,
  widthPx,
  barLength
}: {
  path: string
  color: string
  widthPx: number
  barLength: number
}): React.JSX.Element {
  const tileWidthPx = barLength * PPB
  const tileCount = Math.max(1, Math.ceil(widthPx / tileWidthPx))
  const tileOffsets = Array.from({ length: tileCount }, (_, i) => i * tileWidthPx)
  return (
    <>
      {tileOffsets.map((left) => (
        <div
          key={left}
          style={{ position: 'absolute', top: 0, bottom: 0, left, width: tileWidthPx }}
        >
          <Waveform path={path} color={color} opacity={1} />
        </div>
      ))}
    </>
  )
}

export function CollapsedRifffRow({
  groupId,
  selected
}: {
  groupId: string
  selected: boolean
}): React.JSX.Element {
  const state = useAppState()
  const dispatch = useDispatch()
  const rifff = state.rifffs[groupId]
  const firstStem = rifff.stems[0]
  const color = typeColorVar(firstStem?.type ?? 'fx')

  // stemGeometry (not clipGeometry) so an active playedBars resize is
  // reflected here too — clipGeometry predates the resize feature and always
  // uses rifff.barLength, silently ignoring one. For a stem in a linked
  // group this resolves to the same group-level position/width clipGeometry
  // was trying to compute (resolveOffsetKey/resolvePlayedBars both key on
  // groupId while linked) — correct for the common case, and a reasonable
  // "represents the first stem" fallback if collapsed while unlinked.
  const geo = stemGeometry(state, groupId, firstStem.slot, PPB)
  const fadeIn = state.fadeIn[groupId] ?? 0
  const fadeOut = state.fadeOut[groupId] ?? 0
  const fadeInPx = Math.min(geo.widthPx / 2, fadeIn * PPB)
  const fadeOutPx = Math.min(geo.widthPx / 2, fadeOut * PPB)

  return (
    <div
      draggable
      onDragStart={(e) => {
        // Always moves the whole group, regardless of link state — unlike
        // the expanded view's per-stem grab targets. Collapsing hides
        // per-stem detail; a summary block dragging "part of itself"
        // independently would be confusing with nothing on screen to show
        // which stem moved.
        e.dataTransfer.setData('text/rifff-group-id', groupId)
        const mouseBar = mouseBarFromDragEvent(e)
        if (mouseBar !== null) {
          setGrabOffsetBars(computeGrabOffsetBars(mouseBar, rifff.startBar ?? 0))
        }
      }}
      style={{
        display: 'flex',
        height: ROW_HEIGHT,
        borderTop: '1px solid var(--ra-bg-row)',
        cursor: 'grab'
      }}
    >
      <div
        style={{
          width: 212,
          flexShrink: 0,
          padding: '0 10px',
          display: 'flex',
          alignItems: 'center',
          gap: 8
        }}
      >
        <PolarGlyph stems={rifff.stems} identityColor={color} size={26} />
        <div style={{ overflow: 'hidden' }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
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
            top: 0,
            bottom: 0,
            left: geo.leftPx,
            width: geo.widthPx,
            borderRadius: 3,
            border: `1px solid color-mix(in srgb, ${color} ${selected ? 70 : 40}%, transparent)`,
            background: 'var(--ra-bg-row-sub)',
            overflow: 'hidden'
          }}
        >
          <CollapsedTiles
            path={firstStem.path}
            color={color}
            widthPx={geo.widthPx}
            barLength={rifff.barLength}
          />
          {fadeInPx > 0 && (
            <div
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: 0,
                width: fadeInPx,
                background: 'linear-gradient(to right, rgba(0,0,0,0.6), transparent)',
                pointerEvents: 'none'
              }}
            />
          )}
          {fadeOutPx > 0 && (
            <div
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                right: 0,
                width: fadeOutPx,
                background: 'linear-gradient(to left, rgba(0,0,0,0.6), transparent)',
                pointerEvents: 'none'
              }}
            />
          )}
          {/* Mini mute-dot row: one per stem, same filled/hollow convention as
              the expanded view's mute button. stopPropagation so clicking a dot
              doesn't also start a drag on this block. */}
          <div
            style={{ position: 'absolute', left: 6, top: 6, display: 'flex', gap: 4, zIndex: 2 }}
          >
            {rifff.stems.map((stem) => {
              const key = stemKey(groupId, stem.slot)
              const muted = !!state.mute[key]
              return (
                <button
                  key={stem.slot}
                  onClick={(e) => {
                    e.stopPropagation()
                    dispatch({ type: 'TOGGLE_MUTE', stemKey: key })
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  title={`${stem.name}: ${muted ? 'unmute' : 'mute'}`}
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: '50%',
                    border: '1px solid rgba(201,191,232,0.6)',
                    background: muted ? 'transparent' : 'var(--ra-text-2)',
                    padding: 0,
                    cursor: 'pointer'
                  }}
                />
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
