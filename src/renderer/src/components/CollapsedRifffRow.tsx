import { useState } from 'react'
import { useAppState, useDispatch } from '../state/StoreContext'
import { MIN_PLAYED_BARS } from '../state/store'
import { stemKey } from '@shared/types'
import { dbLabel } from '@shared/visuals'
import { stemGeometry, resolveOffsetKey, resolvePlayedBars, stemStartBar } from '../state/selectors'
import { typeColorVar } from '../theme/typeColor'
import { Waveform } from './Waveform'
import { PPB } from './Ruler'
import { ROW_HEIGHT } from './StemWaveformRow'
import {
  FADE_MAX,
  FADE_DRAG_SLOWDOWN,
  TOOLTIP_HEIGHT,
  TOOLTIP_GAP,
  envelopeKnees,
  envelopeCurveD,
  buildEnvelopePath
} from './envelope'
import { startPointerDrag } from './dragUtils'
import { computeGrabOffsetBars, setGrabOffsetBars, mouseBarFromDragEvent } from './dragGrabOffset'

/** Tiles one stem's waveform across the collapsed block's width, repeating
 * every stemBarLength bars — that STEM's own native loop length, which can
 * be (and often is) shorter than the rifff's overall barLength (e.g. an
 * 8-bar stem tiled 4x within a 32-bar rifff). Mirrors StemWaveformRow's own
 * tiling formula exactly (`widthPx * (stem.barLength / playedBars)`) rather
 * than a simplified `barLength * PPB`, which was wrong on two counts: it
 * used the rifff's overall barLength instead of the stem's own, and it
 * silently assumed stretch is always on (ignoring the rifff.bpm/state.bpm
 * scaling baked into widthPx when it's off). */
function CollapsedTiles({
  path,
  color,
  opacity,
  widthPx,
  stemBarLength,
  playedBars
}: {
  path: string
  color: string
  opacity: number
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
          <Waveform path={path} color={color} opacity={opacity} />
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
  const volumeDragMode = state.volumeDragMode
  // One button for the whole group rather than exposing each stem's own mute
  // individually (unlike the expanded view) — collapsing already hides
  // per-stem detail, so "all muted" / "not all muted" is the only distinction
  // that makes sense at this level. Filled = at least one stem still
  // unmuted (clicking mutes everything); hollow = the whole group is
  // already muted (clicking unmutes everything) — same filled-means-active
  // convention as every other mute dot in this app.
  const allMuted = rifff.stems.every((stem) => state.mute[stemKey(groupId, stem.slot)])
  // Representative volume for the envelope's own drag-start/display value —
  // same "first stem stands in for the group" convention as the geometry
  // below. Actually adjusting the envelope dispatches SET_GROUP_VOLUME,
  // which sets every stem to the same value in one atomic edit, so this
  // representative value becomes exactly correct the moment it's touched.
  const volume = state.vol[stemKey(groupId, firstStem.slot)] ?? 1

  const [dragPlayedBars, setDragPlayedBars] = useState<number | null>(null)
  const [dragLeftResize, setDragLeftResize] = useState<{
    playedBars: number
    startBar: number
  } | null>(null)
  const [dragFadeIn, setDragFadeIn] = useState<number | null>(null)
  const [dragFadeOut, setDragFadeOut] = useState<number | null>(null)
  const [dragVolume, setDragVolume] = useState<number | null>(null)

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
  const displayedFadeIn = dragFadeIn ?? fadeIn
  const displayedFadeOut = dragFadeOut ?? fadeOut
  const displayedVolume = dragVolume ?? volume

  const fadeInPx = displayedFadeIn * PPB
  const fadeOutPx = displayedFadeOut * PPB
  const plateauY = ROW_HEIGHT * (1 - displayedVolume)
  const envelopePath = buildEnvelopePath(widthPx, ROW_HEIGHT, fadeInPx, fadeOutPx, plateauY)
  const envelopeCurve = envelopeCurveD(widthPx, ROW_HEIGHT, fadeInPx, fadeOutPx, plateauY)
  const { fiEnd, foStart } = envelopeKnees(widthPx, fadeInPx, fadeOutPx)
  const tooltipTop = Math.max(
    0,
    Math.min(ROW_HEIGHT - TOOLTIP_HEIGHT, plateauY - TOOLTIP_HEIGHT - TOOLTIP_GAP)
  )

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

  function handleFadeInStart(e: React.MouseEvent): void {
    const startFadeIn = fadeIn
    let finalFadeIn = startFadeIn
    startPointerDrag(
      e,
      (deltaX) => {
        finalFadeIn = Math.max(
          0,
          Math.min(FADE_MAX, startFadeIn + deltaX / (PPB * FADE_DRAG_SLOWDOWN))
        )
        setDragFadeIn(finalFadeIn)
      },
      (moved) => {
        if (moved) dispatch({ type: 'SET_FADE_IN', groupId, bars: finalFadeIn })
        setDragFadeIn(null)
      }
    )
  }

  function handleFadeOutStart(e: React.MouseEvent): void {
    const startFadeOut = fadeOut
    let finalFadeOut = startFadeOut
    startPointerDrag(
      e,
      (deltaX) => {
        finalFadeOut = Math.max(
          0,
          Math.min(FADE_MAX, startFadeOut - deltaX / (PPB * FADE_DRAG_SLOWDOWN))
        )
        setDragFadeOut(finalFadeOut)
      },
      (moved) => {
        if (moved) dispatch({ type: 'SET_FADE_OUT', groupId, bars: finalFadeOut })
        setDragFadeOut(null)
      }
    )
  }

  function handleVolumeStart(e: React.MouseEvent): void {
    const startVolume = volume
    let finalVolume = startVolume
    startPointerDrag(
      e,
      (_dx, deltaY) => {
        finalVolume = Math.max(0, Math.min(1, startVolume - deltaY / ROW_HEIGHT))
        setDragVolume(finalVolume)
      },
      (moved) => {
        if (moved) dispatch({ type: 'SET_GROUP_VOLUME', groupId, volume: finalVolume })
        setDragVolume(null)
      }
    )
  }

  return (
    <div style={{ display: 'flex', height: ROW_HEIGHT, borderTop: '1px solid var(--ra-bg-row)' }}>
      <div style={{ flex: 1, position: 'relative' }}>
        <div
          draggable
          onDragStart={(e) => {
            // Always moves the whole group, regardless of link state —
            // unlike the expanded view's per-stem grab targets. Collapsing
            // hides per-stem detail; a summary block dragging "part of
            // itself" independently would be confusing with nothing on
            // screen to show which stem moved.
            e.dataTransfer.setData('text/rifff-group-id', groupId)
            const mouseBar = mouseBarFromDragEvent(e)
            if (mouseBar !== null) {
              setGrabOffsetBars(computeGrabOffsetBars(mouseBar, rifff.startBar ?? 0))
            }
          }}
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: leftPx,
            width: widthPx,
            borderRadius: 3,
            border: `1px solid color-mix(in srgb, ${color} ${selected ? 70 : 40}%, transparent)`,
            background: 'var(--ra-bg-row-sub)',
            overflow: 'hidden',
            cursor: 'grab'
          }}
        >
          {/* One tiled layer per stem, overlaid — same color-per-sound-type
              and opacity convention as PolarGlyph's own rings (fill =
              typeColorVar(stem.type), opacity 0.55, no blend mode), so the
              collapsed block's waveform reads as a mix of all its stems
              rather than just one representative one. Each stem's own mute
              state (independent of the single group-mute button, which just
              sets all of them at once) still suppresses that one stem's own
              layer. The whole stack is clipped by the shared group envelope
              below, same "full color under the curve" idea as
              StemWaveformRow's own color layer. */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              clipPath: `path("${envelopePath}")`
            }}
          >
            {rifff.stems
              .filter((stem) => !state.mute[stemKey(groupId, stem.slot)])
              .map((stem) => (
                <CollapsedTiles
                  key={stem.slot}
                  path={stem.path}
                  color={typeColorVar(stem.type)}
                  opacity={0.55}
                  widthPx={widthPx}
                  stemBarLength={stem.barLength}
                  playedBars={displayedPlayedBars}
                />
              ))}
          </div>

          {/* Thin white line tracing the envelope curve itself — same
              rationale as StemWaveformRow's own: the saturation-based volume
              cue can read as invisible wherever the underlying audio is
              quiet, so this gives a visible reference regardless of what's
              playing underneath. */}
          <svg
            width={widthPx}
            height={ROW_HEIGHT}
            style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
          >
            <path d={envelopeCurve} fill="none" stroke="#fff" strokeWidth={1} opacity={0.5} />
          </svg>

          {/* Resize handles, both edges — same behavior as StemWaveformRow's
              own (right grows the loop forward from a fixed start, left
              grows it backward from a fixed end), just scoped to the
              representative first stem/group here instead of a specific
              slot. startPointerDrag already calls preventDefault/
              stopPropagation, which blocks this block's own native drag
              from initiating on the same mousedown. */}
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

          {/* Fade-in/fade-out knee handles — always active regardless of
              envelope/volumeDragMode, same as StemWaveformRow's own (fade is
              a separate, dedicated small target, not gated by the mode
              switch the way the broad volume drag surface below is). */}
          <div
            onMouseDown={handleFadeInStart}
            title={`fade in: ${displayedFadeIn.toFixed(2)} bars`}
            style={{
              position: 'absolute',
              left: fiEnd,
              top: plateauY,
              transform: 'translate(-50%, -50%)',
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: '#fff',
              cursor: 'pointer',
              zIndex: 4
            }}
          />
          <div
            onMouseDown={handleFadeOutStart}
            title={`fade out: ${displayedFadeOut.toFixed(2)} bars`}
            style={{
              position: 'absolute',
              left: foStart,
              top: plateauY,
              transform: 'translate(-50%, -50%)',
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: '#fff',
              cursor: 'pointer',
              zIndex: 4
            }}
          />

          {/* Volume drag surface: spans the whole waveform body while
              volumeDragMode is on, repurposing the same open area that
              defaults to "drag to move the clip." While off, this does
              nothing on mousedown — the event is left alone so the native
              drag (from the container's own `draggable`) proceeds normally
              instead. zIndex stays below the resize handles (3) and fade
              dots (4) in both modes — see StemWaveformRow's identical fix
              (a full-coverage div at the same z-index as those small edge
              targets would otherwise physically sit on top of them and
              swallow their mousedown before it ever reaches them). */}
          <div
            onMouseDown={(e) => {
              if (volumeDragMode) handleVolumeStart(e)
            }}
            title={volumeDragMode ? 'drag to adjust group volume' : undefined}
            style={{
              position: 'absolute',
              inset: 0,
              cursor: volumeDragMode ? 'ns-resize' : 'grab',
              zIndex: 2
            }}
          />

          {/* Single group-mute button, overlaid on the waveform, top-left
              corner — same filled/hollow convention and position as each
              stem's own mute dot in the expanded view. */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              dispatch({ type: 'SET_GROUP_MUTE', groupId, muted: !allMuted })
            }}
            onMouseDown={(e) => e.stopPropagation()}
            title={allMuted ? 'unmute group' : 'mute group'}
            style={{
              position: 'absolute',
              left: 6,
              top: '50%',
              transform: 'translateY(-50%)',
              width: 9,
              height: 9,
              borderRadius: '50%',
              border: '1px solid rgba(201,191,232,0.6)',
              background: allMuted ? 'transparent' : 'var(--ra-text-2)',
              padding: 0,
              cursor: 'pointer',
              zIndex: 3
            }}
          />

          {dragVolume !== null && (
            <div
              style={{
                position: 'absolute',
                left: '50%',
                top: tooltipTop,
                transform: 'translateX(-50%)',
                padding: '2px 6px',
                background: 'var(--ra-mute-on)',
                color: 'var(--ra-mute-on-ink)',
                fontSize: 10,
                fontWeight: 700,
                borderRadius: 4,
                zIndex: 5,
                whiteSpace: 'nowrap',
                pointerEvents: 'none'
              }}
            >
              {dbLabel(displayedVolume)}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
