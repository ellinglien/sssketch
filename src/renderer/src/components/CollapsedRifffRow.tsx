import { useState } from 'react'
import { useAppState, useDispatch } from '../state/StoreContext'
import { MIN_PLAYED_BARS } from '../state/store'
import { stemKey } from '@shared/types'
import { stemGeometry, resolveOffsetKey, resolvePlayedBars, stemStartBar } from '../state/selectors'
import { typeColorVar } from '../theme/typeColor'
import { Waveform } from './Waveform'
import { PolarGlyph } from './PolarGlyph'
import { PPB } from './Ruler'
import { ROW_HEIGHT } from './StemWaveformRow'
import { startPointerDrag } from './dragUtils'
import { computeGrabOffsetBars, setGrabOffsetBars, mouseBarFromDragEvent } from './dragGrabOffset'

/** Tiles one representative stem's waveform across the collapsed block's
 * width, repeating every stemBarLength bars — the STEM's own native loop
 * length, which can be (and often is) shorter than the rifff's overall
 * barLength (e.g. an 8-bar stem tiled 4x within a 32-bar rifff). Mirrors
 * StemWaveformRow's own tiling formula exactly (`widthPx * (stem.barLength /
 * playedBars)`) rather than a simplified `barLength * PPB`, which was wrong
 * on two counts: it used the rifff's overall barLength instead of the
 * stem's own, and it silently assumed stretch is always on (ignoring the
 * rifff.bpm/state.bpm scaling baked into widthPx when it's off). */
function CollapsedTiles({
  path,
  color,
  widthPx,
  stemBarLength,
  playedBars
}: {
  path: string
  color: string
  widthPx: number
  stemBarLength: number
  playedBars: number
}): React.JSX.Element {
  const tileWidthPx = widthPx * (stemBarLength / playedBars)
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

  const [dragPlayedBars, setDragPlayedBars] = useState<number | null>(null)
  const [dragLeftResize, setDragLeftResize] = useState<{
    playedBars: number
    startBar: number
  } | null>(null)

  // stemGeometry (not clipGeometry) so an active playedBars resize is
  // reflected here too — clipGeometry predates the resize feature and always
  // uses rifff.barLength, silently ignoring one. For a stem in a linked
  // group this resolves to the same group-level position/width clipGeometry
  // was trying to compute (resolveOffsetKey/resolvePlayedBars both key on
  // groupId while linked) — correct for the common case, and a reasonable
  // "represents the first stem" fallback if collapsed while unlinked. The
  // same applies to the resize handles below: resizing here dispatches
  // through resolveOffsetKey/RESIZE_LEFT exactly like StemWaveformRow's own
  // handles, so it resizes the whole group while linked (the common case).
  const playedBarsKey = resolveOffsetKey(state, groupId, firstStem.slot)
  const resolvedPlayedBars = resolvePlayedBars(state, groupId, firstStem.slot)
  const displayedPlayedBars = dragPlayedBars ?? dragLeftResize?.playedBars ?? resolvedPlayedBars
  const baseStartBar = stemStartBar(state, groupId, firstStem.slot)

  const geo = stemGeometry(state, groupId, firstStem.slot, PPB)
  // Sub-bar nudge offset (off[]) baked into geo.leftPx, isolated so a
  // left-resize preview can recompute leftPx from a new start bar while
  // preserving it — see StemWaveformRow's identical pattern.
  const nudgeOffsetPx = geo.leftPx - baseStartBar * PPB
  const displayedStartBar = dragLeftResize?.startBar ?? baseStartBar
  const leftPx = displayedStartBar * PPB + nudgeOffsetPx
  const widthPx =
    dragPlayedBars !== null
      ? dragPlayedBars * PPB
      : dragLeftResize !== null
        ? dragLeftResize.playedBars * PPB
        : geo.widthPx

  const fadeIn = state.fadeIn[groupId] ?? 0
  const fadeOut = state.fadeOut[groupId] ?? 0
  const fadeInPx = Math.min(widthPx / 2, fadeIn * PPB)
  const fadeOutPx = Math.min(widthPx / 2, fadeOut * PPB)

  function handleResizeStart(e: React.MouseEvent): void {
    const startPlayedBars = resolvedPlayedBars
    let finalPlayedBars = startPlayedBars
    startPointerDrag(
      e,
      (deltaX) => {
        finalPlayedBars = Math.max(MIN_PLAYED_BARS, Math.round(startPlayedBars + deltaX / PPB))
        setDragPlayedBars(finalPlayedBars)
      },
      (moved) => {
        if (moved) {
          dispatch({ type: 'SET_PLAYED_BARS', key: playedBarsKey, bars: finalPlayedBars })
        }
        setDragPlayedBars(null)
      }
    )
  }

  function handleLeftResizeStart(e: React.MouseEvent): void {
    const startPlayedBars = resolvedPlayedBars
    const startPosBar = baseStartBar
    let finalPlayedBars = startPlayedBars
    let finalStartBar = startPosBar
    startPointerDrag(
      e,
      (deltaX) => {
        const requestedGrow = -Math.round(deltaX / PPB)
        const grow = Math.max(
          MIN_PLAYED_BARS - startPlayedBars,
          Math.min(startPosBar, requestedGrow)
        )
        finalPlayedBars = startPlayedBars + grow
        finalStartBar = startPosBar - grow
        setDragLeftResize({ playedBars: finalPlayedBars, startBar: finalStartBar })
      },
      (moved) => {
        if (moved) {
          dispatch({
            type: 'RESIZE_LEFT',
            groupId,
            slot: firstStem.slot,
            bars: finalPlayedBars,
            startBar: finalStartBar
          })
        }
        setDragLeftResize(null)
      }
    )
  }

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
            left: leftPx,
            width: widthPx,
            borderRadius: 3,
            border: `1px solid color-mix(in srgb, ${color} ${selected ? 70 : 40}%, transparent)`,
            background: 'var(--ra-bg-row-sub)',
            overflow: 'hidden'
          }}
        >
          <CollapsedTiles
            path={firstStem.path}
            color={color}
            widthPx={widthPx}
            stemBarLength={firstStem.barLength}
            playedBars={displayedPlayedBars}
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
          {/* Resize handles, both edges — same behavior as StemWaveformRow's
              own (right grows the loop forward from a fixed start, left
              grows it backward from a fixed end), just scoped to the
              representative first stem/group here instead of a specific
              slot. stopPropagation isn't needed: startPointerDrag already
              calls preventDefault/stopPropagation, which blocks this block's
              own native drag from initiating on the same mousedown. */}
          <div
            onMouseDown={handleLeftResizeStart}
            title={`${displayedPlayedBars} bars`}
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: 0,
              width: 5,
              cursor: 'ew-resize',
              background: '#fff',
              opacity: 0.55,
              zIndex: 3
            }}
          />
          <div
            onMouseDown={handleResizeStart}
            title={`${displayedPlayedBars} bars`}
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
