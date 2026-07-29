import { useState } from 'react'
import { useDispatch, useAppState } from '../state/StoreContext'
import { MIN_PLAYED_BARS } from '../state/store'
import { stemKey } from '@shared/types'
import { dbLabel } from '@shared/visuals'
import { stemGeometry, resolveOffsetKey, resolvePlayedBars, stemStartBar } from '../state/selectors'
import { typeColorVar } from '../theme/typeColor'
import { Waveform } from './Waveform'
import { PPB } from './Ruler'
import { startPointerDrag } from './dragUtils'

export const ROW_HEIGHT = 44
const FADE_MAX = 4 // bars — matches the value the (now-removed) Inspector panel used to clamp fades
const TOOLTIP_HEIGHT = 18 // volume tooltip's measured rendered height + small margin
const TOOLTIP_GAP = 4 // gap between the tooltip and the plateau line it's anchored to

/** Where the envelope curve's two knees (fade-in-ends-here, fade-out-starts-here)
 * sit in the row's own pixel coordinates, clamped so they can never cross past
 * the midpoint even under oversized fade values. The single source of truth
 * for this position — used by `buildEnvelopePath` (the curve itself) AND by
 * the fade-knee drag handles' own on-screen position, so the two can never
 * drift apart the way two independently-maintained copies of this formula
 * could. */
function envelopeKnees(
  width: number,
  fadeInPx: number,
  fadeOutPx: number
): { fiEnd: number; foStart: number } {
  return {
    fiEnd: Math.min(fadeInPx, width / 2),
    foStart: Math.max(width - fadeOutPx, width / 2)
  }
}

/** Builds the SVG path `d` for the envelope curve itself — an OPEN path from
 * (0,height) through the fade-in ease, the flat plateau, and the fade-out
 * ease, to (width,height). Shared by buildEnvelopePath (which closes it into
 * a fillable region for the clip-path mask below) and the thin stroke line
 * drawn directly on top of the waveform, so the mask and the visible line can
 * never drift apart the way two independently-maintained curves could. */
function envelopeCurveD(
  width: number,
  height: number,
  fadeInPx: number,
  fadeOutPx: number,
  plateauY: number
): string {
  const { fiEnd, foStart } = envelopeKnees(width, fadeInPx, fadeOutPx)
  const c1x = fiEnd * 0.35
  const c2x = fiEnd * 0.65
  const c3x = foStart + (width - foStart) * 0.35
  const c4x = foStart + (width - foStart) * 0.65
  return (
    `M0,${height} ` +
    `C${c1x},${height} ${c2x},${plateauY} ${fiEnd},${plateauY} ` +
    `L${foStart},${plateauY} ` +
    `C${c3x},${plateauY} ${c4x},${height} ${width},${height}`
  )
}

/** Builds the SVG path `d` for the "below the envelope" region — the curve
 * above, closed off along the bottom edge. Used as a CSS clip-path on the
 * full-color waveform layer; everything outside this region (above the
 * curve) shows only the always-visible gray layer underneath. */
function buildEnvelopePath(
  width: number,
  height: number,
  fadeInPx: number,
  fadeOutPx: number,
  plateauY: number
): string {
  return `${envelopeCurveD(width, height, fadeInPx, fadeOutPx, plateauY)} Z`
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
  const [dragLeftResize, setDragLeftResize] = useState<{
    playedBars: number
    startBar: number
  } | null>(null)
  const [dragFadeIn, setDragFadeIn] = useState<number | null>(null)
  const [dragFadeOut, setDragFadeOut] = useState<number | null>(null)
  const [dragVolume, setDragVolume] = useState<number | null>(null)
  const resolvedPlayedBars = resolvePlayedBars(state, groupId, slot)
  const displayedPlayedBars = dragPlayedBars ?? dragLeftResize?.playedBars ?? resolvedPlayedBars
  const displayedFadeIn = dragFadeIn ?? fadeIn
  const displayedFadeOut = dragFadeOut ?? fadeOut
  const displayedVolume = dragVolume ?? volume

  const stemGeo = stemGeometry(state, groupId, slot, PPB)
  const baseStartBar = stemStartBar(state, groupId, slot)
  // The sub-bar nudge offset (off[]) baked into stemGeo.leftPx, isolated so a
  // left-resize preview can recompute leftPx from a new start bar while
  // preserving it — it doesn't change during a resize.
  const nudgeOffsetPx = stemGeo.leftPx - baseStartBar * PPB
  const displayedStartBar = dragLeftResize?.startBar ?? baseStartBar
  const leftPx = displayedStartBar * PPB + nudgeOffsetPx
  // While actively dragging, use the in-progress width instead of the
  // committed-state one, so the row visibly resizes in real time.
  const widthPx =
    dragPlayedBars !== null
      ? dragPlayedBars * PPB
      : dragLeftResize !== null
        ? dragLeftResize.playedBars * PPB
        : stemGeo.widthPx

  // The native engine always loops a stem from its own beginning every
  // stem.barLength bars — playedBars beyond that adds more repeats (or
  // truncates the last one), it never slows the audio down. One stretched
  // Waveform image would visually read as "slowed down," which contradicts
  // that — so the waveform is tiled instead, at stem.barLength's own width,
  // repeated across widthPx. The container's overflow:hidden (below) clips
  // both an oversized last tile and a single undersized tile for free, so no
  // per-tile clipping is needed here.
  const tileWidthPx = widthPx * (stem.barLength / displayedPlayedBars)
  const tileCount = Math.max(1, Math.ceil(displayedPlayedBars / stem.barLength))
  const tileOffsets = Array.from({ length: tileCount }, (_, i) => i * tileWidthPx)

  const fadeInPx = displayedFadeIn * PPB
  const fadeOutPx = displayedFadeOut * PPB
  const plateauY = ROW_HEIGHT * (1 - displayedVolume)
  const envelopePath = buildEnvelopePath(widthPx, ROW_HEIGHT, fadeInPx, fadeOutPx, plateauY)
  const envelopeCurve = envelopeCurveD(widthPx, ROW_HEIGHT, fadeInPx, fadeOutPx, plateauY)
  const { fiEnd, foStart } = envelopeKnees(widthPx, fadeInPx, fadeOutPx)
  // Volume tooltip's vertical position, clamped directly into the row's
  // bounds — correct for every plateauY value by construction (top is always
  // in [0, ROW_HEIGHT - TOOLTIP_HEIGHT]), rather than an above/below flip
  // threshold, which turned out to have no valid single value: for this
  // ROW_HEIGHT relative to the tooltip's own height, the "safe while above"
  // and "safe while below" zones don't overlap.
  const tooltipTop = Math.max(
    0,
    Math.min(ROW_HEIGHT - TOOLTIP_HEIGHT, plateauY - TOOLTIP_HEIGHT - TOOLTIP_GAP)
  )

  function handleResizeStart(e: React.MouseEvent): void {
    const startPlayedBars = resolvedPlayedBars
    // Captured in a plain closure variable rather than read back out of
    // dragPlayedBars state in onEnd: StrictMode double-invokes setState
    // updater FUNCTIONS in dev to catch impure updaters, so a dispatch
    // placed inside a `setDragPlayedBars((current) => ...)` callback would
    // fire twice per drag-release. Dispatching directly in onEnd, from a
    // value tracked outside React state, sidesteps that entirely — see
    // dragUtils.ts's own doc comment for the general rule this follows.
    let finalPlayedBars = startPlayedBars
    startPointerDrag(
      e,
      (deltaX) => {
        // Snapped to whole bars, matching App.tsx's barForClientX — the same
        // grid other timeline drags (placing/moving a clip) already snap to.
        // Extending a loop makes sense in whole-bar increments (you're adding
        // another repeat, not fine sub-bar precision), and it keeps the tiled
        // waveform below landing on clean tile boundaries most of the time.
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
        // Dragging left (negative deltaX) extends the loop backward:
        // playedBars grows and the start moves earlier by the same amount,
        // so the RIGHT edge — where the loop currently ends — stays exactly
        // in place. Snapped to whole bars, same as the right handle. The two
        // clamps below can never conflict: the floor is always <= 0
        // (MIN_PLAYED_BARS is always <= startPlayedBars already, since every
        // committed playedBars value is already clamped to that floor) and
        // startPosBar is always >= 0.
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
            slot,
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
    // Tracked in a plain closure variable, NOT read back out of dragFadeIn
    // state inside onEnd — see dragUtils.ts's doc comment for why a dispatch
    // can never live inside a setState updater function (StrictMode
    // double-invokes those in dev, already caused a real bug in the resize
    // handler above — don't reintroduce it here).
    let finalFadeIn = startFadeIn
    startPointerDrag(
      e,
      (deltaX) => {
        finalFadeIn = Math.max(0, Math.min(FADE_MAX, startFadeIn + deltaX / PPB))
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
      // foStart = width - fadeOutPx, so a LONGER fade-out means a SMALLER
      // foStart, which means the knee needs to move LEFT. deltaX moving left
      // is negative, so subtracting it (startFadeOut - deltaX) is what makes
      // "drag left" translate to "fadeOutPx grows" — the mirror image of
      // fade-in's `startFadeIn + deltaX`, where dragging right grows fadeIn.
      (deltaX) => {
        finalFadeOut = Math.max(0, Math.min(FADE_MAX, startFadeOut - deltaX / PPB))
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
    // Same closure-variable pattern as the handlers above: finalVolume is
    // tracked outside React state and dispatched directly in onEnd's body,
    // never from inside a setDragVolume updater function — see dragUtils.ts's
    // doc comment for why.
    let finalVolume = startVolume
    startPointerDrag(
      e,
      // Up (negative deltaY) increases volume — hence the subtraction.
      (_dx, deltaY) => {
        finalVolume = Math.max(0, Math.min(1, startVolume - deltaY / ROW_HEIGHT))
        setDragVolume(finalVolume)
      },
      (moved) => {
        if (moved) dispatch({ type: 'SET_VOLUME', stemKey: key, volume: finalVolume })
        setDragVolume(null)
      }
    )
  }

  return (
    <div style={{ display: 'flex', height: ROW_HEIGHT, borderTop: '1px solid var(--ra-bg-row)' }}>
      {/* Name + mute, and (while unlinked) the drag handle for repositioning
          this stem — moved off the waveform entirely so the fade/volume/resize
          controls layered on top of it don't compete with it for mousedown. */}
      <div
        draggable={unlinked}
        onDragStart={(e) => {
          if (!unlinked) return
          e.dataTransfer.setData('text/rifff-stem-key', key)
        }}
        title={unlinked ? 'drag to move this stem independently' : undefined}
        style={{
          width: 212,
          flexShrink: 0,
          padding: '0 10px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          cursor: unlinked ? 'grab' : 'default',
          opacity: muted ? 0.5 : 1
        }}
      >
        {/* Mute dot: filled = unmuted (active), hollow = muted (off). */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            dispatch({ type: 'TOGGLE_MUTE', stemKey: key })
          }}
          title={muted ? 'unmute' : 'mute'}
          style={{
            flexShrink: 0,
            width: 12,
            height: 12,
            borderRadius: '50%',
            border: '1.5px solid rgba(201,191,232,0.6)',
            background: muted ? 'transparent' : 'var(--ra-text-2)',
            padding: 0,
            cursor: 'pointer'
          }}
        />
        <span
          style={{
            fontSize: 10,
            color: 'var(--ra-text-2)',
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
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: leftPx,
            width: widthPx,
            borderRadius: 3,
            border: `1px solid color-mix(in srgb, ${color} 40%, transparent)`,
            background: 'var(--ra-bg-row-sub)',
            overflow: 'hidden'
          }}
        >
          {/* Always-visible gray layer underneath, tiled to show the loop
              repeating rather than one image stretched across the width. */}
          {tileOffsets.map((left) => (
            <div
              key={left}
              style={{ position: 'absolute', top: 0, bottom: 0, left, width: tileWidthPx }}
            >
              <Waveform path={stem.path} color="var(--ra-text-3)" opacity={1} />
            </div>
          ))}

          {/* Full-color layer on top, clipped to the envelope — suppressed
              entirely while muted, since mute always wins over the envelope.
              Same tiling as the gray layer underneath, so the two stay in
              visual sync at every tile boundary. */}
          {!muted && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                clipPath: `path("${envelopePath}")`
              }}
            >
              {tileOffsets.map((left) => (
                <div
                  key={left}
                  style={{ position: 'absolute', top: 0, bottom: 0, left, width: tileWidthPx }}
                >
                  <Waveform path={stem.path} color={color} opacity={1} />
                </div>
              ))}
            </div>
          )}

          {/* Thin white line tracing the envelope curve itself — the
              saturation split (full color below, gray above) already shows
              volume, but reads as invisible wherever the underlying audio is
              quiet, so this gives a visible reference regardless of what's
              playing underneath. */}
          <svg
            width={widthPx}
            height={ROW_HEIGHT}
            style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
          >
            <path d={envelopeCurve} fill="none" stroke="#fff" strokeWidth={1} opacity={0.5} />
          </svg>

          {/* Resize handles, both edges: dragging either extends/shrinks the
              loop (always tiled from the stem's own beginning — see the
              tiling note above), snapped to whole bars. The right handle
              grows the loop forward from a fixed start; the left handle grows
              it backward from a fixed end (see handleLeftResizeStart). Drags
              update local state only, and dispatch exactly once on mouseup
              (see dragUtils.startPointerDrag) so a long drag can't flood undo
              history. */}
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

          {/* Fade-in/fade-out knee handles: small dots at the envelope curve's
              plateau corners, draggable to adjust fadeIn/fadeOut. Positioned
              via the same envelopeKnees() helper buildEnvelopePath itself
              uses, so the dots can never visually drift off the curve they
              sit on. */}
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

          {/* Volume-plateau drag strip: invisible horizontal band spanning the
              flat top of the envelope between the two fade knees, positioned
              via the same fiEnd/foStart used by the fade-knee dots and the
              envelope path itself. Dragging it vertically adjusts volume. */}
          <div
            onMouseDown={handleVolumeStart}
            title="drag to adjust volume"
            style={{
              position: 'absolute',
              left: fiEnd,
              width: Math.max(0, foStart - fiEnd),
              top: plateauY - 4,
              height: 8,
              cursor: 'ns-resize',
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
              {muted ? 'mute' : dbLabel(displayedVolume)}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
