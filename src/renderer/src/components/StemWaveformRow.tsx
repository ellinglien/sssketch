import { useState } from 'react'
import { useDispatch, useAppState } from '../state/StoreContext'
import { MIN_PLAYED_BARS } from '../state/store'
import { stemKey } from '@shared/types'
import { dbLabel } from '@shared/visuals'
import { sqrtGain } from '@shared/mixGain'
import { stemGeometry, resolveOffsetKey, resolvePlayedBars, stemStartBar } from '../state/selectors'
import { typeColorVar } from '../theme/typeColor'
import { Waveform } from './Waveform'
import { PPB } from './Ruler'
import { startPointerDrag } from './dragUtils'
import { computeGrabOffsetBars, setGrabOffsetBars, mouseBarFromDragEvent } from './dragGrabOffset'
import {
  FADE_MAX,
  FADE_DRAG_SLOWDOWN,
  TOOLTIP_HEIGHT,
  TOOLTIP_GAP,
  envelopeKnees,
  envelopeCurveD,
  buildEnvelopePath
} from './envelope'

export const ROW_HEIGHT = 44

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
  const volumeDragMode = state.volumeDragMode
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
      // foStart = width - fadeOutPx, so a LONGER fade-out means a SMALLER
      // foStart, which means the knee needs to move LEFT. deltaX moving left
      // is negative, so subtracting it (startFadeOut - deltaX) is what makes
      // "drag left" translate to "fadeOutPx grows" — the mirror image of
      // fade-in's `startFadeIn + deltaX`, where dragging right grows fadeIn.
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

  // Default (volumeDragMode off): the waveform body is a native HTML5 drag
  // target, moving the clip — same linked/unlinked branching as everywhere
  // else in this app (whole rifff when linked, just this stem when
  // unlinked), just exposed on a wider surface than the label column alone.
  // When volumeDragMode is on, this never fires: the browser only initiates
  // a native drag from a mousedown that wasn't already preventDefault'd, and
  // handleVolumeStart (wired below) calls preventDefault via
  // startPointerDrag whenever volumeDragMode is on.
  function handleWaveformDragStart(e: React.DragEvent): void {
    const mouseBar = mouseBarFromDragEvent(e)
    if (unlinked) {
      e.dataTransfer.setData('text/rifff-stem-key', key)
      if (mouseBar !== null) setGrabOffsetBars(computeGrabOffsetBars(mouseBar, baseStartBar))
    } else {
      e.dataTransfer.setData('text/rifff-group-id', groupId)
      if (mouseBar !== null) {
        setGrabOffsetBars(computeGrabOffsetBars(mouseBar, rifff.startBar ?? 0))
      }
    }
  }

  return (
    <div style={{ display: 'flex', height: ROW_HEIGHT, borderTop: '1px solid var(--ra-bg-row)' }}>
      <div style={{ flex: 1, position: 'relative' }}>
        <div
          draggable
          onDragStart={handleWaveformDragStart}
          onDoubleClick={() => {
            // Mirrors the import-time default seeded in store.ts's
            // ADD_TO_SHELF case, so double-clicking resets volume back to
            // where it started when this stem's rifff was first added to the
            // shelf. Guarded against a no-op dispatch: SET_VOLUME isn't in
            // history.ts's TRANSIENT_ACTION_TYPES, so every dispatch pushes an
            // undo-stack entry — without this check, double-clicking a stem
            // already at its default would flood undo history for nothing.
            const target = sqrtGain(rifff.stems.length)
            if (volume !== target) dispatch({ type: 'SET_VOLUME', stemKey: key, volume: target })
          }}
          title="double-click to reset volume"
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: leftPx,
            width: widthPx,
            borderRadius: 0,
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

          {/* Full-color layer on top — suppressed entirely while muted, since
              mute always wins over the envelope. Clipped to the envelope
              (showing the gray layer above the volume line) only while
              envelope drag mode is engaged; otherwise unclipped/full height,
              so the waveform reads normally instead of looking dimmed
              whenever volume is below unity. Same tiling as the gray layer
              underneath, so the two stay in visual sync at every tile
              boundary. */}
          {!muted && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                clipPath: volumeDragMode ? `path("${envelopePath}")` : undefined
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

          {/* Thin white line tracing the envelope curve itself — only shown
              alongside the clipping above, while envelope drag mode is
              engaged (the saturation split it traces isn't happening
              otherwise). */}
          {volumeDragMode && (
            <svg
              width={widthPx}
              height={ROW_HEIGHT}
              style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
            >
              <path
                d={envelopeCurve}
                fill="none"
                stroke="var(--ra-text)"
                strokeWidth={1}
                opacity={0.5}
              />
            </svg>
          )}

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
              background: 'var(--ra-text)',
              opacity: 0.12,
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
              background: 'var(--ra-text)',
              opacity: 0.12,
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
              background: 'var(--ra-text)',
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
              background: 'var(--ra-text)',
              cursor: 'pointer',
              zIndex: 4
            }}
          />

          {/* Volume drag surface: spans the whole waveform body while
              volumeDragMode is on (see the V-key toggle in App.tsx/TransportBar),
              repurposing the same open area that defaults to "drag to move
              the clip" (handleWaveformDragStart above). While off, this does
              nothing on mousedown — the event is left alone so the browser's
              native drag (from the container's own `draggable`) proceeds
              normally instead. zIndex stays below the resize handles (3) and
              fade dots (4) in BOTH modes — this covers the entire row, so at
              equal z-index its own later DOM position would otherwise let it
              physically sit on top of those small edge targets and swallow
              their mousedown before it ever reaches them, not just visually
              overlap them. */}
          <div
            onMouseDown={(e) => {
              if (volumeDragMode) handleVolumeStart(e)
            }}
            title={volumeDragMode ? 'drag to adjust volume' : undefined}
            style={{
              position: 'absolute',
              inset: 0,
              cursor: volumeDragMode ? 'ns-resize' : 'grab',
              zIndex: 2
            }}
          />

          {/* Mute dot, overlaid directly on the waveform (matching
              CollapsedRifffRow's own mute-dot styling/position): filled =
              unmuted (active), hollow = muted (off). stopPropagation on both
              handlers so a click/drag here never also moves the clip or
              starts a volume-mode drag. */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              dispatch({ type: 'TOGGLE_MUTE', stemKey: key })
            }}
            onMouseDown={(e) => e.stopPropagation()}
            title={`${stem.name}: ${muted ? 'unmute' : 'mute'}`}
            style={{
              position: 'absolute',
              left: 6,
              top: '50%',
              transform: 'translateY(-50%)',
              width: 9,
              height: 9,
              borderRadius: '50%',
              border: '1px solid rgba(201,191,232,0.6)',
              background: muted ? 'transparent' : 'var(--ra-text-2)',
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
                borderRadius: 0,
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
