import { useAppSelector, useDispatch, usePlaying } from '../state/StoreContext'
import { MIN_PLAYED_BARS, SNAP_DIVS } from '../state/store'
import { stemKey } from '@shared/types'
import { sqrtGain } from '@shared/mixGain'
import {
  busIfAssignedFromBusOf,
  clipGeometryFromFields,
  resolvedPlayedBarsFromFields,
  tileOffsetsPx
} from '../state/selectors'
import { stemDisplayColorVar } from '../theme/typeColor'
import { AutomationLane } from './AutomationLane'
import { Waveform } from './Waveform'
import { startPointerDrag } from './dragUtils'
import { mouseBarFromDragEvent } from './dragGrabOffset'
import { markManualSeek } from '../state/manualSeek'
import { muteRegionsClipPath } from './muteClipPath'

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
  const key = stemKey(groupId, slot)
  // Each field read individually via useAppSelector, not one broad
  // useAppState() call -- see
  // docs/superpowers/specs/2026-08-03-fine-grained-state-selectors-design.md.
  const rifff = useAppSelector((s) => s.rifffs[groupId])
  const muted = useAppSelector((s) => !!s.mute[key])
  const volume = useAppSelector((s) => s.vol[key] ?? 1)
  const playedBarsOverride = useAppSelector((s) => s.playedBars[groupId])
  const offsetSteps = useAppSelector((s) => s.off[groupId] ?? 0)
  const leftCropBars = useAppSelector((s) => s.leftCrop[groupId] ?? 0)
  const snapIdx = useAppSelector((s) => s.snapIdx)
  const stretchOn = useAppSelector((s) => s.stretch[groupId] ?? true)
  const bpm = useAppSelector((s) => s.bpm)
  const muteRegions = useAppSelector((s) => s.muteRegions[key] ?? [])
  const automationMode = useAppSelector((s) => s.mode === 'automation')
  const regionSelection = useAppSelector((s) => s.regionSelection)
  const busOf = useAppSelector((s) => s.busOf)
  const stem = rifff.stems.find((s) => s.slot === slot)!
  const color = stemDisplayColorVar(stem, busIfAssignedFromBusOf(busOf, groupId, slot))
  const playedBarsKey = groupId

  // Shared, store-backed live preview -- NOT local useState -- so every
  // StemWaveformRow instance sharing this groupId (every stem in the same
  // expanded rifff) sees the SAME in-progress value while ANY one of them
  // is being dragged, not just the row actually under the mouse. See
  // docs/superpowers/specs/2026-08-04-live-drag-preview-design.md.
  const dragPlayedBars = useAppSelector((s) => s.dragPlayedBars[groupId] ?? null)
  const dragLeftCropBars = useAppSelector((s) => s.dragLeftCropBars[groupId] ?? null)

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

  const baseStartBar = rifff.startBar ?? 0
  const displayedLeftCropBars = dragLeftCropBars ?? leftCropBars
  // Live preview during EITHER edge's drag uses the EXACT SAME formula real
  // (committed) rendering uses -- one clipGeometryFromFields call handling
  // both dragPlayedBars (right edge) and dragLeftCropBars (left edge) via
  // their own overrides, rather than the right edge previously shortcutting
  // to a bare `dragPlayedBars * ppb` that skipped the `- leftCropBars` and
  // stretch/bpm-scaling terms the real formula applies -- that shortcut
  // made the live-drag width visibly wrong (too wide, or wrong-scaled)
  // whenever the clip already had a nonzero leftCropBars or stretch was
  // off, snapping back to the correct width only once the drag committed.
  // Reported 2026-08-22: "waveform stretches" during a right-edge trim.
  const previewGeo = clipGeometryFromFields({
    startBar: baseStartBar,
    offsetSteps,
    snapDiv: SNAP_DIVS[snapIdx],
    playedBarsOverride: dragPlayedBars ?? playedBarsOverride,
    leftCropBars: dragLeftCropBars ?? leftCropBars,
    rifffBarLength: rifff.barLength,
    stretchOn,
    rifffBpm: rifff.bpm,
    stateBpm: bpm,
    ppb
  })
  const leftPx = previewGeo.leftPx
  const widthPx = previewGeo.widthPx

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

  const colorClipPath = muteRegionsClipPath(widthPx, ROW_HEIGHT, muteRegions, ppb, leftPx)

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

  // Mousedown anywhere on the waveform body (that isn't a resize handle or
  // fade dot): if it lands inside an already-muted region, immediately
  // selects that region's exact bounds (mode 'unmute') -- no drag needed,
  // matching "clicking a muted span re-selects it" from the design spec.
  // Otherwise starts an Ableton-style drag-to-select (mode 'mute'); if the
  // drag never actually moved (a plain click), falls back to the original
  // click-to-scrub behavior instead of leaving a zero-width selection
  // behind.
  function handleRegionMouseDown(e: React.MouseEvent): void {
    // Right-click (button 2) is handled entirely by onContextMenu above
    // (handleWaveformContextMenu, toggling whole-stem mute) -- left
    // unfiltered here, a right-click's own mousedown fell through to the
    // click-to-scrub branch below (since a right-click doesn't move the
    // mouse, `moved` stayed false), seeking the playhead as an unwanted
    // side effect of what should have been a mute-only action.
    if (e.button !== 0) return
    const mouseBar = mouseBarFromDragEvent(e, ppb)
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
          // Direct request, 2026-09-20: "date could be a tooltip on
          // hover.. in discovery and in arranger or sketch" -- appended to
          // this box's EXISTING title (not a second, separate
          // data-tooltip -- mixing both tooltip mechanisms on one element
          // would show two overlapping tooltips) rather than a new
          // element, since stem.creationTime is undefined for a one-shot/
          // recorded-in-app/live-API-resolved stem, or any import
          // predating this field -- gracefully just omits the date suffix
          // rather than showing a wrong one.
          title={
            stem.creationTime
              ? `right-click to mute · double-click to reset volume · ${new Date(
                  stem.creationTime * 1000
                ).toLocaleDateString(undefined, {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric'
                })}`
              : 'right-click to mute · double-click to reset volume'
          }
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
              mute always wins. Punched through wherever a mute region sits
              (see muteRegionsClipPath's own doc comment for why holing out
              the color layer, rather than drawing a separate hatch on top,
              is this app's "gray means quieter/off" visual language), and
              otherwise unclipped/full height, so the waveform reads normally
              instead of looking dimmed whenever the clip's gain is below
              unity. Same tiling as the gray layer underneath, so the two stay
              in visual sync at every tile boundary. */}
          {!muted && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                clipPath: colorClipPath
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

          {/* The region-select / click-to-scrub surface: spans the whole
              waveform body. zIndex stays below the resize handles (3) --
              this covers the entire row, so at equal z-index its own later
              DOM position would otherwise let it physically sit on top of
              those small edge targets and swallow their mousedown before it
              ever reaches them, not just visually overlap them. */}
          <div
            onMouseDown={handleRegionMouseDown}
            title="click to scrub playhead · drag to select a region (delete to mute) · right-click to mute"
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 2
            }}
          />

          {/* Already-committed mute regions -- a translucent red wash plus
              border, same treatment as the live/pending region-selection
              div below (just mute-red instead of white) rather than relying
              solely on combinedClipPath's gray-layer cutout underneath.
              Per an Ableton reference screenshot: its own clip selection
              keeps the waveform peaks fully visible and instead tints the
              BACKGROUND behind them a distinct pale color -- this wash
              approximates that same "recolor the backdrop, don't hide the
              peaks" language, layered on top of (not instead of) the
              existing gray-waveform mute treatment. */}
          {muteRegions.map((r, i) => (
            <div
              key={i}
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: r.startBar * ppb - leftPx,
                width: (r.endBar - r.startBar) * ppb,
                background: 'color-mix(in srgb, var(--ra-mute-on) 20%, transparent)',
                border: '1px solid var(--ra-mute-on)',
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

          {/* The clip's own automation lane -- LAST child of the waveform
              box, so it covers exactly the wave area (not the row, not the
              rifff's name bar) and sits above everything in it. One per
              placed stem, which is the whole point of the per-clip rescope:
              an expanded rifff shows a lane per stem rather than one shared
              lane for the row (see the spec's section 2b). */}
          {automationMode && (
            <AutomationLane
              laneId={key}
              target={{ kind: 'stem', stemKey: key }}
              widthPx={widthPx}
            />
          )}
        </div>
      </div>
    </div>
  )
}
