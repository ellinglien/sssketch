import { useState } from 'react'
import { useDispatch, useAppState, usePlaying } from '../state/StoreContext'
import { MIN_PLAYED_BARS } from '../state/store'
import { stemKey } from '@shared/types'
import { dbLabel } from '@shared/visuals'
import { sqrtGain } from '@shared/mixGain'
import { clipGeometry, resolvePlayedBars, channelMuteLetters } from '../state/selectors'
import { typeColorVar } from '../theme/typeColor'
import { Waveform } from './Waveform'
import { startPointerDrag, suppressNextSyntheticClick } from './dragUtils'
import { computeGrabOffsetBars, setGrabOffsetBars, mouseBarFromDragEvent } from './dragGrabOffset'
import { useShiftHeld } from './useShiftHeld'
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
  slot,
  ppb
}: {
  groupId: string
  slot: number
  /** Horizontal scale, in pixels-per-bar -- the caller's own zoom-reactive
   * value (see RifffBlockRow, App.tsx's Timeline), threaded through rather
   * than read directly so every stem row in the arranger always agrees
   * with the Ruler/Playhead/clip blocks around it. */
  ppb: number
}): React.JSX.Element {
  const state = useAppState()
  const dispatch = useDispatch()
  const playing = usePlaying()
  const rifff = state.rifffs[groupId]
  const stem = rifff.stems.find((s) => s.slot === slot)!
  const color = typeColorVar(stem.type)
  const key = stemKey(groupId, slot)
  const playedBarsKey = groupId
  const muted = !!state.mute[key]
  const volumeDragMode = state.volumeDragMode
  const volume = state.vol[key] ?? 1
  const fadeIn = state.fadeIn[groupId] ?? 0
  const fadeOut = state.fadeOut[groupId] ?? 0
  // Every visible channel gets a shortcut now, not just the selected
  // rifff's own stems — see channelMuteLetters' doc comment and the
  // Shift+letter handler in App.tsx's Frame.
  const shiftHeld = useShiftHeld()
  const muteLetter = channelMuteLetters(state)[key]
  const showMuteShortcut = shiftHeld && !!muteLetter

  const [dragPlayedBars, setDragPlayedBars] = useState<number | null>(null)
  const [dragLeftResize, setDragLeftResize] = useState<{
    playedBars: number
    startBar: number
  } | null>(null)
  const [dragFadeIn, setDragFadeIn] = useState<number | null>(null)
  const [dragFadeOut, setDragFadeOut] = useState<number | null>(null)
  const [dragVolume, setDragVolume] = useState<number | null>(null)

  // Right-click anywhere on the waveform toggles mute — moved off plain
  // click (which now does nothing at this level) since an accidental click
  // meant for something else — selecting, starting a drag that didn't quite
  // register — used to silently mute a stem. Right-click has no other use
  // here, so it can dispatch immediately with no debounce/disambiguation
  // needed against the separate onDoubleClick (reset volume) handler below.
  // Ctrl+right-click solos this stem's whole rifff instead (see
  // SOLO_GROUP).
  function handleWaveformContextMenu(e: React.MouseEvent): void {
    e.preventDefault()
    if (e.ctrlKey) {
      dispatch({ type: 'SOLO_GROUP', groupId })
      return
    }
    dispatch({ type: 'TOGGLE_MUTE', stemKey: key })
  }

  const resolvedPlayedBars = resolvePlayedBars(state, groupId)
  const displayedPlayedBars = dragPlayedBars ?? dragLeftResize?.playedBars ?? resolvedPlayedBars
  const displayedFadeIn = dragFadeIn ?? fadeIn
  const displayedFadeOut = dragFadeOut ?? fadeOut
  const displayedVolume = dragVolume ?? volume

  const stemGeo = clipGeometry(state, groupId, ppb)
  const baseStartBar = rifff.startBar ?? 0
  // The sub-bar nudge offset (off[]) baked into stemGeo.leftPx, isolated so a
  // left-resize preview can recompute leftPx from a new start bar while
  // preserving it — it doesn't change during a resize.
  const nudgeOffsetPx = stemGeo.leftPx - baseStartBar * ppb
  const displayedStartBar = dragLeftResize?.startBar ?? baseStartBar
  const leftPx = displayedStartBar * ppb + nudgeOffsetPx
  // While actively dragging, use the in-progress width instead of the
  // committed-state one, so the row visibly resizes in real time.
  const widthPx =
    dragPlayedBars !== null
      ? dragPlayedBars * ppb
      : dragLeftResize !== null
        ? dragLeftResize.playedBars * ppb
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

  const fadeInPx = displayedFadeIn * ppb
  const fadeOutPx = displayedFadeOut * ppb
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
        finalPlayedBars = Math.max(MIN_PLAYED_BARS, Math.round(startPlayedBars + deltaX / ppb))
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
        const requestedGrow = -Math.round(deltaX / ppb)
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
          Math.min(FADE_MAX, startFadeIn + deltaX / (ppb * FADE_DRAG_SLOWDOWN))
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
          Math.min(FADE_MAX, startFadeOut - deltaX / (ppb * FADE_DRAG_SLOWDOWN))
        )
        setDragFadeOut(finalFadeOut)
      },
      (moved) => {
        if (moved) dispatch({ type: 'SET_FADE_OUT', groupId, bars: finalFadeOut })
        setDragFadeOut(null)
      }
    )
  }

  // Click anywhere on the waveform (that isn't a resize handle, fade dot, or
  // a real drag) moves the transport playhead to that exact point — the
  // same free/unsnapped scrub Ruler already offers, just reachable directly
  // from the clip itself instead of needing to find the matching spot on
  // the ruler above. Skipped while volumeDragMode is on, since that mode
  // repurposes this same surface for volume dragging instead.
  function handleScrubClick(e: React.MouseEvent): void {
    if (volumeDragMode) return
    const rect = e.currentTarget.getBoundingClientRect()
    const bar = Math.max(0, leftPx / ppb + (e.clientX - rect.left) / ppb)
    dispatch({ type: 'SELECT', groupId })
    dispatch({ type: 'SET_POS', pos: bar })
    if (playing) void window.rifffApi.engineSetPosition(bar)
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
  // target, moving the whole rifff — exposed on a wider surface than the
  // label column alone. When volumeDragMode is on, this never fires: the
  // browser only initiates a native drag from a mousedown that wasn't
  // already preventDefault'd, and handleVolumeStart (wired below) calls
  // preventDefault via startPointerDrag whenever volumeDragMode is on.
  function handleWaveformDragStart(e: React.DragEvent): void {
    suppressNextSyntheticClick()
    e.dataTransfer.setData('text/rifff-group-id', groupId)
    const mouseBar = mouseBarFromDragEvent(e, ppb)
    if (mouseBar !== null) {
      setGrabOffsetBars(computeGrabOffsetBars(mouseBar, rifff.startBar ?? 0))
    }
  }

  return (
    <div style={{ display: 'flex', height: ROW_HEIGHT, borderTop: '1px solid var(--ra-bg-row)' }}>
      <div style={{ flex: 1, position: 'relative' }}>
        <div
          draggable
          onDragStart={handleWaveformDragStart}
          onContextMenu={handleWaveformContextMenu}
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
          title="right-click to mute · double-click to reset volume"
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
                  <Waveform path={stem.path} color={color} opacity={1} showPitchLine />
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

          {/* One thin line at every point the underlying loop restarts (i.e.
              every tileOffsets entry after the first — the first is just the
              clip's own left edge, already visually bounded) — makes how
              long the stem's own native loop actually is legible at a
              glance: a short loop shows several closely-packed lines, a long
              one shows few or none within the clip's own width. Purely
              informational (pointer-events none), drawn under the resize/
              fade handles so it never competes with them for clicks. */}
          {tileCount > 1 &&
            tileOffsets.slice(1).map((left) => (
              <div
                key={left}
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left,
                  width: 1,
                  background: 'color-mix(in srgb, var(--ra-text) 35%, transparent)',
                  pointerEvents: 'none'
                }}
              />
            ))}

          {/* Resize handles, both edges: dragging either extends/shrinks the
              loop (always tiled from the stem's own beginning — see the
              tiling note above), snapped to whole bars. The right handle
              grows the loop forward from a fixed start; the left handle grows
              it backward from a fixed end (see handleLeftResizeStart). Drags
              update local state only, and dispatch exactly once on mouseup
              (see dragUtils.startPointerDrag) so a long drag can't flood undo
              history. onContextMenu stopPropagation so right-clicking here
              (e.g. to cancel a resize) doesn't also bubble up and toggle
              mute. */}
          <div
            onMouseDown={handleLeftResizeStart}
            onContextMenu={(e) => e.stopPropagation()}
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
            onContextMenu={(e) => e.stopPropagation()}
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
              sit on. onContextMenu stopPropagation, same reason as the
              resize handles above. */}
          <div
            onMouseDown={handleFadeInStart}
            onContextMenu={(e) => e.stopPropagation()}
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
            onContextMenu={(e) => e.stopPropagation()}
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
              repurposing the same open area that otherwise right-clicks to
              mute or drags to move the clip. While off, this does nothing on
              mousedown — the event is left alone so the outer container's
              own drag handling proceeds normally instead.
              zIndex stays below the resize handles (3) and fade dots (4) in
              BOTH modes — this covers the entire row, so at equal z-index
              its own later DOM position would otherwise let it physically
              sit on top of those small edge targets and swallow their
              mousedown before it ever reaches them, not just visually
              overlap them. */}
          <div
            onMouseDown={(e) => {
              if (volumeDragMode) handleVolumeStart(e)
            }}
            onClick={handleScrubClick}
            title={
              volumeDragMode
                ? 'drag to adjust volume · right-click to mute'
                : 'click to scrub playhead · drag to move clip · right-click to mute'
            }
            style={{
              position: 'absolute',
              inset: 0,
              cursor: volumeDragMode ? 'ns-resize' : 'grab',
              zIndex: 2
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

        {/* Mute-shortcut channel badge — sticky (not positioned against the
            clip's own leftPx, which can easily be scrolled off-screen) so it
            stays pinned to the left edge of the visible timeline viewport
            regardless of horizontal scroll or where this stem's clip
            actually starts. Shown only while Shift is held. Clickable
            itself now (not just a visual hint) — right-click-anywhere on the
            waveform (handleWaveformContextMenu above) still works too.
            Max-contrast black/white rather than the app's usual off-black/
            off-white tokens, and inverted between mute states, so the
            letter stays legible and doubles as a mute-state cue on its own. */}
        {showMuteShortcut && (
          <button
            onClick={() => dispatch({ type: 'TOGGLE_MUTE', stemKey: key })}
            title={`shift+${muteLetter} to mute`}
            style={{
              position: 'sticky',
              left: 6,
              top: 0,
              marginTop: (ROW_HEIGHT - 18) / 2,
              width: 18,
              height: 18,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: 'none',
              padding: 0,
              background: muted ? '#fff' : '#000',
              color: muted ? '#000' : '#fff',
              fontSize: 12,
              fontWeight: 700,
              lineHeight: 1,
              cursor: 'pointer',
              zIndex: 6
            }}
          >
            {muteLetter!.toUpperCase()}
          </button>
        )}
      </div>
    </div>
  )
}
