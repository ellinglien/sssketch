import { useAppSelector, useDispatch, usePlaying } from '../state/StoreContext'
import { MIN_PLAYED_BARS, SNAP_DIVS } from '../state/store'
import { stemKey } from '@shared/types'
import { dbLabel } from '@shared/visuals'
import { sqrtGain } from '@shared/mixGain'
import {
  clipGeometryFromFields,
  resolvedPlayedBarsFromFields,
  tileOffsetsPx
} from '../state/selectors'
import { stemColorVar } from '../theme/typeColor'
import { Waveform } from './Waveform'
import { startPointerDrag } from './dragUtils'
import { scheduleLiveParamSync } from './liveParamSync'
import { mouseBarFromDragEvent } from './dragGrabOffset'
import { useFrameScale } from '../state/FrameScaleContext'
import { markManualSeek } from '../state/manualSeek'
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
  const dispatch = useDispatch()
  const playing = usePlaying()
  const frameScale = useFrameScale()
  const key = stemKey(groupId, slot)
  // Each field read individually via useAppSelector, not one broad
  // useAppState() call -- see
  // docs/superpowers/specs/2026-08-03-fine-grained-state-selectors-design.md.
  const rifff = useAppSelector((s) => s.rifffs[groupId])
  const muted = useAppSelector((s) => !!s.mute[key])
  const volumeDragMode = useAppSelector((s) => s.volumeDragMode)
  const volume = useAppSelector((s) => s.vol[key] ?? 1)
  const fadeIn = useAppSelector((s) => s.fadeIn[groupId] ?? 0)
  const fadeOut = useAppSelector((s) => s.fadeOut[groupId] ?? 0)
  const playedBarsOverride = useAppSelector((s) => s.playedBars[groupId])
  const offsetSteps = useAppSelector((s) => s.off[groupId] ?? 0)
  const leftCropBars = useAppSelector((s) => s.leftCrop[groupId] ?? 0)
  const snapIdx = useAppSelector((s) => s.snapIdx)
  const stretchOn = useAppSelector((s) => s.stretch[groupId] ?? true)
  const bpm = useAppSelector((s) => s.bpm)
  const muteRegions = useAppSelector((s) => s.muteRegions[key] ?? [])
  const regionSelection = useAppSelector((s) => s.regionSelection)
  const stem = rifff.stems.find((s) => s.slot === slot)!
  const color = stemColorVar(stem)
  const playedBarsKey = groupId

  // Shared, store-backed live preview -- NOT local useState -- so every
  // StemWaveformRow instance sharing this groupId (every stem in the same
  // expanded rifff) sees the SAME in-progress value while ANY one of them
  // is being dragged, not just the row actually under the mouse. See
  // docs/superpowers/specs/2026-08-04-live-drag-preview-design.md.
  const dragPlayedBars = useAppSelector((s) => s.dragPlayedBars[groupId] ?? null)
  const dragLeftCropBars = useAppSelector((s) => s.dragLeftCropBars[groupId] ?? null)
  const dragFadeIn = useAppSelector((s) => s.dragFadeIn[groupId] ?? null)
  const dragFadeOut = useAppSelector((s) => s.dragFadeOut[groupId] ?? null)
  const dragVolume = useAppSelector((s) => s.dragVol[key] ?? null)

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

  const resolvedPlayedBars = resolvedPlayedBarsFromFields(playedBarsOverride, rifff.barLength)
  const displayedPlayedBars = dragPlayedBars ?? resolvedPlayedBars
  const displayedFadeIn = dragFadeIn ?? fadeIn
  const displayedFadeOut = dragFadeOut ?? fadeOut
  const displayedVolume = dragVolume ?? volume

  const stemGeo = clipGeometryFromFields({
    startBar: rifff.startBar ?? 0,
    offsetSteps,
    snapDiv: SNAP_DIVS[snapIdx],
    playedBarsOverride,
    leftCropBars,
    rifffBarLength: rifff.barLength,
    stretchOn,
    rifffBpm: rifff.bpm,
    stateBpm: bpm,
    ppb
  })
  const baseStartBar = rifff.startBar ?? 0
  const displayedLeftCropBars = dragLeftCropBars ?? leftCropBars
  // Live preview during a left-edge drag uses the EXACT SAME formula real
  // (committed) rendering uses -- unlike the old startBar-based preview this
  // replaces, there's no separate reconciliation needed, since neither
  // startBar nor offsetSteps ever moves for this drag anymore.
  const previewGeo =
    dragLeftCropBars !== null
      ? clipGeometryFromFields({
          startBar: baseStartBar,
          offsetSteps,
          snapDiv: SNAP_DIVS[snapIdx],
          playedBarsOverride,
          leftCropBars: dragLeftCropBars,
          rifffBarLength: rifff.barLength,
          stretchOn,
          rifffBpm: rifff.bpm,
          stateBpm: bpm,
          ppb
        })
      : stemGeo
  const leftPx = previewGeo.leftPx
  // While actively dragging, use the in-progress width instead of the
  // committed-state one, so the row visibly resizes in real time.
  const widthPx = dragPlayedBars !== null ? dragPlayedBars * ppb : previewGeo.widthPx

  // The native engine always loops a stem from its own beginning every
  // stem.barLength bars -- playedBars beyond that adds more repeats (or
  // truncates the last one), it never slows the audio down. One stretched
  // Waveform image would visually read as "slowed down," which contradicts
  // that -- so the waveform is tiled instead. tileOffsetsPx also accounts
  // for displayedLeftCropBars, shifting every tile so the correct mid-loop
  // content lines up with what's actually audible (see its own doc comment).
  const tileOffsets = tileOffsetsPx(
    widthPx,
    stem.barLength,
    displayedPlayedBars,
    displayedLeftCropBars
  )
  const tileWidthPx = widthPx * (stem.barLength / (displayedPlayedBars - displayedLeftCropBars))

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
    // Captured in a plain closure variable, not read back out of store state
    // in onEnd -- same reasoning as before this preview moved into the
    // store: onMove/onEnd both fire outside React's render cycle, so a
    // value threaded through the closure is simpler and cheaper than a
    // round-trip through useAppSelector, and avoids a one-render-late read
    // if onEnd fired before the dispatch above it had a chance to commit.
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
        dispatch({
          type: 'SET_DRAG_PREVIEW',
          field: 'playedBars',
          key: playedBarsKey,
          value: finalPlayedBars
        })
      },
      (moved) => {
        if (moved) {
          dispatch({ type: 'SET_PLAYED_BARS', key: playedBarsKey, bars: finalPlayedBars })
        }
        dispatch({
          type: 'SET_DRAG_PREVIEW',
          field: 'playedBars',
          key: playedBarsKey,
          value: undefined
        })
      }
    )
  }

  function handleLeftResizeStart(e: React.MouseEvent): void {
    const startLeftCropBars = leftCropBars
    const startPlayedBars = resolvedPlayedBars
    const startPosBar = baseStartBar
    let finalLeftCropBars = startLeftCropBars
    startPointerDrag(
      e,
      (deltaX) => {
        // Dragging right crops more off the left (leftCropBars grows);
        // dragging left extends further left (leftCropBars shrinks, can go
        // negative). Snapped to whole bars, same as the right handle.
        // Clamped so the window never collapses below MIN_PLAYED_BARS wide
        // and never extends before the project's own bar 0 -- both bounds
        // computed from the drag-start snapshot, matching this codebase's
        // existing convention for the right handle's own clamp.
        const requestedLeftCropBars = startLeftCropBars + Math.round(deltaX / ppb)
        finalLeftCropBars = Math.max(
          -startPosBar,
          Math.min(startPlayedBars - MIN_PLAYED_BARS, requestedLeftCropBars)
        )
        dispatch({
          type: 'SET_DRAG_PREVIEW',
          field: 'leftCropBars',
          key: groupId,
          value: finalLeftCropBars
        })
      },
      (moved) => {
        if (moved) {
          dispatch({ type: 'SET_LEFT_CROP_BARS', groupId, bars: finalLeftCropBars })
        }
        dispatch({
          type: 'SET_DRAG_PREVIEW',
          field: 'leftCropBars',
          key: groupId,
          value: undefined
        })
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
          Math.min(FADE_MAX, startFadeIn + deltaX / (ppb * FADE_DRAG_SLOWDOWN))
        )
        dispatch({ type: 'SET_DRAG_PREVIEW', field: 'fadeIn', key: groupId, value: finalFadeIn })
        scheduleLiveParamSync('fadeIn', groupId, finalFadeIn)
      },
      (moved) => {
        // Load-bearing beyond the obvious "commit the real edit": this is
        // also what indirectly clears the native live override this drag
        // set via scheduleLiveParamSync above -- SET_FADE_IN triggers
        // StoreContext.tsx's full-reload effect, and IpcServer.cpp's
        // load-project handler clears every live override right after
        // that reload lands. Removing this dispatch (e.g. thinking
        // scheduleLiveParamSync alone now covers it) would leave the
        // engine stuck on this drag's last live value forever. See
        // docs/superpowers/specs/2026-08-04-live-param-fast-path-design.md's
        // "Handoff at drag-end" section.
        if (moved) dispatch({ type: 'SET_FADE_IN', groupId, bars: finalFadeIn })
        dispatch({ type: 'SET_DRAG_PREVIEW', field: 'fadeIn', key: groupId, value: undefined })
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
        dispatch({ type: 'SET_DRAG_PREVIEW', field: 'fadeOut', key: groupId, value: finalFadeOut })
        scheduleLiveParamSync('fadeOut', groupId, finalFadeOut)
      },
      (moved) => {
        // Load-bearing beyond the obvious "commit the real edit" -- see
        // handleFadeInStart's identical comment above for why (indirectly
        // clears the native live override this drag set via
        // scheduleLiveParamSync).
        if (moved) dispatch({ type: 'SET_FADE_OUT', groupId, bars: finalFadeOut })
        dispatch({ type: 'SET_DRAG_PREVIEW', field: 'fadeOut', key: groupId, value: undefined })
      }
    )
  }

  // Mousedown anywhere on the waveform body (that isn't a resize handle or
  // fade dot): if it lands inside an already-muted region, immediately
  // selects that region's exact bounds (mode 'unmute') -- no drag needed,
  // matching "clicking a muted span re-selects it" from the design spec.
  // Otherwise starts an Ableton-style drag-to-select (mode 'mute'); if the
  // drag never actually moved (a plain click), falls back to the original
  // click-to-scrub behavior instead of leaving a zero-width selection
  // behind. Skipped while volumeDragMode is on, which repurposes this same
  // surface for volume dragging instead (unchanged from before).
  function handleRegionMouseDown(e: React.MouseEvent): void {
    if (volumeDragMode) {
      handleVolumeStart(e)
      return
    }
    const mouseBar = mouseBarFromDragEvent(e, ppb, frameScale)
    if (mouseBar === null) return

    const existingRegion = muteRegions.find((r) => mouseBar >= r.startBar && mouseBar < r.endBar)
    if (existingRegion) {
      e.preventDefault()
      e.stopPropagation()
      dispatch({
        type: 'SET_REGION_SELECTION',
        selection: {
          stemKeys: [key],
          startBar: existingRegion.startBar,
          endBar: existingRegion.endBar,
          mode: 'unmute'
        }
      })
      return
    }

    const startBar = mouseBar
    startPointerDrag(
      e,
      (deltaX) => {
        const currentBar = Math.max(0, startBar + deltaX / ppb)
        dispatch({
          type: 'SET_REGION_SELECTION',
          selection: {
            stemKeys: [key],
            startBar: Math.min(startBar, currentBar),
            endBar: Math.max(startBar, currentBar),
            mode: 'mute'
          }
        })
      },
      (moved) => {
        if (moved) return
        // Not a real drag -- same click-to-scrub behavior this surface
        // always had, and clear any selection this click might have
        // started (there shouldn't be one yet at this point, but keeps
        // this handler self-contained regardless of call order).
        dispatch({ type: 'SET_REGION_SELECTION', selection: null })
        dispatch({ type: 'SELECT', groupId })
        dispatch({ type: 'SET_POS', pos: startBar })
        if (playing) {
          markManualSeek()
          void window.rifffApi.engineSetPosition(startBar)
        }
      }
    )
  }

  function handleVolumeStart(e: React.MouseEvent): void {
    const startVolume = volume
    let finalVolume = startVolume
    startPointerDrag(
      e,
      // Up (negative deltaY) increases volume — hence the subtraction.
      (_dx, deltaY) => {
        finalVolume = Math.max(0, Math.min(1, startVolume - deltaY / ROW_HEIGHT))
        dispatch({ type: 'SET_DRAG_PREVIEW', field: 'volume', key, value: finalVolume })
        scheduleLiveParamSync('volume', key, finalVolume)
      },
      (moved) => {
        // Load-bearing beyond the obvious "commit the real edit" -- see
        // handleFadeInStart's identical comment above for why (indirectly
        // clears the native live override this drag set via
        // scheduleLiveParamSync).
        if (moved) dispatch({ type: 'SET_VOLUME', stemKey: key, volume: finalVolume })
        dispatch({ type: 'SET_DRAG_PREVIEW', field: 'volume', key, value: undefined })
      }
    )
  }

  return (
    <div style={{ display: 'flex', height: ROW_HEIGHT, borderTop: '1px solid var(--ra-bg-row)' }}>
      <div style={{ flex: 1, position: 'relative' }}>
        <div
          data-rifff-clip
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
          {tileOffsets.length > 1 &&
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
              mute.

              The mousedown-catching box (16px) is wider than the visible
              tinted strip (5px) -- a hit target exactly as wide as the
              visible affordance was easy to miss by a couple of pixels and
              grab the whole-clip move/scrub surface underneath instead
              (reported as "resize handles are hard to find, defaults to
              grab mode"). The extra width extends INWARD from the clip's
              true edge, not outward -- outward would encroach on whatever's
              immediately to the left/right (another clip, or empty space
              that should still pan/scrub), which isn't this handle's to
              claim. */}
          <div
            onMouseDown={handleLeftResizeStart}
            onContextMenu={(e) => e.stopPropagation()}
            title={`${displayedPlayedBars} bars`}
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: 0,
              width: 16,
              cursor: 'ew-resize',
              zIndex: 3
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: 0,
                width: 5,
                background: 'var(--ra-text)',
                opacity: 0.12,
                pointerEvents: 'none'
              }}
            />
          </div>
          <div
            onMouseDown={handleResizeStart}
            onContextMenu={(e) => e.stopPropagation()}
            title={`${displayedPlayedBars} bars`}
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              right: 0,
              width: 16,
              cursor: 'ew-resize',
              zIndex: 3
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                right: 0,
                width: 5,
                background: 'var(--ra-text)',
                opacity: 0.12,
                pointerEvents: 'none'
              }}
            />
          </div>

          {/* Fade-in/fade-out knee handles: small dots at the envelope curve's
              plateau corners, draggable to adjust fadeIn/fadeOut. Positioned
              via the same envelopeKnees() helper buildEnvelopePath itself
              uses, so the dots can never visually drift off the curve they
              sit on. onContextMenu stopPropagation, same reason as the
              resize handles above.

              The actual mousedown-catching box (14x14) is deliberately much
              bigger than the visible 7x7 dot -- at default settings (no
              fade, near-full volume) these sit almost exactly on top of the
              resize handles' own corner, which span the full row height; a
              hit target the same size as the dot itself was too easy to
              miss by a pixel and grab the resize handle underneath instead
              (reported as "can't grab the fade dots, it just resizes the
              clip"). Centered the same way via translate(-50%,-50%), so it
              only grows the invisible margin around the dot, never shifting
              the dot's own visual position.

              pointerEvents flips to 'none' outside envelope mode (volumeDragMode)
              -- the dot used to stay grabbable at all times, which meant its own
              hit box (bigger than the visible dot, right above) competed with the
              resize handles' for the same top-of-clip real estate even when fade
              wasn't the thing being adjusted, making resize noticeably less
              reliable specifically near the top of the clip. Outside envelope
              mode there's nothing here to drag anyway (fadeIn/fadeOut are only
              meant to be adjusted in that mode), so letting clicks pass straight
              through to the resize handle/scrub surface underneath is strictly
              better than shadowing them. The visual dot itself is unaffected --
              still drawn at all times, only its own interactivity is gated. */}
          <div
            onMouseDown={handleFadeInStart}
            onContextMenu={(e) => e.stopPropagation()}
            title={`fade in: ${displayedFadeIn.toFixed(2)} bars`}
            style={{
              position: 'absolute',
              left: fiEnd,
              top: plateauY,
              transform: 'translate(-50%, -50%)',
              width: 14,
              height: 14,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              zIndex: 4,
              pointerEvents: volumeDragMode ? 'auto' : 'none'
            }}
          >
            <div
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: 'var(--ra-text)',
                pointerEvents: 'none'
              }}
            />
          </div>
          <div
            onMouseDown={handleFadeOutStart}
            onContextMenu={(e) => e.stopPropagation()}
            title={`fade out: ${displayedFadeOut.toFixed(2)} bars`}
            style={{
              position: 'absolute',
              left: foStart,
              top: plateauY,
              transform: 'translate(-50%, -50%)',
              width: 14,
              height: 14,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              zIndex: 4,
              pointerEvents: volumeDragMode ? 'auto' : 'none'
            }}
          >
            <div
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: 'var(--ra-text)',
                pointerEvents: 'none'
              }}
            />
          </div>

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
            onMouseDown={handleRegionMouseDown}
            title={
              volumeDragMode
                ? 'drag to adjust volume · right-click to mute'
                : 'click to scrub playhead · drag to select a region (delete to mute) · right-click to mute'
            }
            style={{
              position: 'absolute',
              inset: 0,
              cursor: volumeDragMode ? 'ns-resize' : 'crosshair',
              zIndex: 2
            }}
          />

          {/* Muted regions: a diagonal hatch replacing the waveform for that
              span. Purely visual (pointerEvents none) -- handleRegionMouseDown
              on the full-body surface above already does its own bar-based
              lookup against muteRegions, so this never needs its own
              separate mousedown handler. Positioned relative to the clip's
              own left edge (leftPx), matching every other per-pixel overlay
              in this component (fade dots, envelope curve). */}
          {muteRegions.map((region, i) => (
            <div
              key={i}
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: region.startBar * ppb - leftPx,
                width: (region.endBar - region.startBar) * ppb,
                background:
                  'repeating-linear-gradient(45deg, color-mix(in srgb, var(--ra-mute-on) 55%, transparent) 0 3px, transparent 3px 8px)',
                zIndex: 1,
                pointerEvents: 'none'
              }}
            />
          ))}

          {/* Live/pending region selection -- shown while dragging, and
              after release until Delete/Backspace commits it or it's
              cancelled. */}
          {regionSelection && regionSelection.stemKeys.includes(key) && (
            <div
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: regionSelection.startBar * ppb - leftPx,
                width: (regionSelection.endBar - regionSelection.startBar) * ppb,
                background: 'color-mix(in srgb, var(--ra-text) 15%, transparent)',
                border: '1px solid var(--ra-text)',
                zIndex: 1,
                pointerEvents: 'none'
              }}
            />
          )}

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
