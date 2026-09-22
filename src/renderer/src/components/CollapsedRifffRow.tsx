import { useMemo, useState } from 'react'
import { useAppSelector, useDispatch, usePlaying, useZoom } from '../state/StoreContext'
import { MIN_PLAYED_BARS, SNAP_DIVS } from '../state/store'
import { stemKey } from '@shared/types'
import { dbLabel } from '@shared/visuals'
import {
  busIfAssignedFromBusOf,
  clipGeometryFromFields,
  resolvedPlayedBarsFromFields,
  tileOffsetsPx
} from '../state/selectors'
import { stemDisplayColorVar } from '../theme/typeColor'
import { AutomationLane } from './AutomationLane'
import { Waveform } from './Waveform'
import { ROW_HEIGHT } from './StemWaveformRow'
import {
  FADE_MAX,
  FADE_DRAG_SLOWDOWN,
  TOOLTIP_HEIGHT,
  TOOLTIP_GAP,
  envelopeKnees,
  envelopeCurveD,
  combinedClipPath
} from './envelope'
import { startPointerDrag } from './dragUtils'
import { scheduleLiveParamSync } from './liveParamSync'
import { markManualSeek } from '../state/manualSeek'
import {
  trimRightEdge,
  trimLeftEdge,
  targetDurationForRightEdgeStretch,
  targetDurationForLeftEdgeStretch,
  stretchRatioForTargetDuration,
  oneShotWidthBars
} from './oneShotResize'

/** Tiles one stem's waveform across the collapsed block's width, repeating
 * every stemBarLength bars — that STEM's own native loop length, which can
 * be (and often is) shorter than the rifff's overall barLength (e.g. an
 * 8-bar stem tiled 4x within a 32-bar rifff). Mirrors StemWaveformRow's own
 * tiling formula exactly (`widthPx * (stem.barLength / playedBars)`) rather
 * than a simplified `barLength * PPB`, which was wrong on two counts: it
 * used the rifff's overall barLength instead of the stem's own, and it
 * silently assumed stretch is always on (ignoring the rifff.bpm/bpm
 * scaling baked into widthPx when it's off). */
function CollapsedTiles({
  path,
  color,
  opacity,
  widthPx,
  stemBarLength,
  playedBars,
  leftCropBars
}: {
  path: string
  color: string
  opacity: number
  widthPx: number
  stemBarLength: number
  playedBars: number
  leftCropBars: number
}): React.JSX.Element {
  const tileOffsets = tileOffsetsPx(widthPx, stemBarLength, playedBars, leftCropBars)
  const tileWidthPx = widthPx * (stemBarLength / (playedBars - leftCropBars))
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
      {/* One thin line at every point the underlying loop restarts (skipping
          the first, at the block's own left edge) — see StemWaveformRow's
          identical marker for why: makes how long the stem's own native loop
          actually is legible at a glance. */}
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
  const dispatch = useDispatch()
  const playing = usePlaying()
  // Shadows the name every existing PPB reference in this file already
  // uses -- see zoomMath.ts/useZoom's own doc comments for what this value
  // actually is (base PPB * the current zoom multiplier).
  const PPB = useZoom()
  // Each field read individually via useAppSelector, not one broad
  // useAppState() call -- see
  // docs/superpowers/specs/2026-08-03-fine-grained-state-selectors-design.md.
  // `mute` is read as the whole map (not per-stem) because allMuted below
  // needs every one of this rifff's own stems' mute values together --
  // still narrower than before, since this only re-renders on a mute
  // change now, not on every dispatch.
  const rifff = useAppSelector((s) => s.rifffs[groupId])
  // Which stem's stored curve the collapsed lane DISPLAYS. A group lane
  // writes the identical curve to every stem, so any of them is a faithful
  // representative; the first is the same one identityColor/CollapsedTiles
  // already treat as the rifff's stand-in.
  const firstStemKey = rifff.stems[0] ? stemKey(groupId, rifff.stems[0].slot) : null
  const bpm = useAppSelector((s) => s.bpm)
  const volumeDragMode = useAppSelector((s) => s.volumeDragMode)
  const mute = useAppSelector((s) => s.mute)
  const automationMode = useAppSelector((s) => s.mode === 'automation')
  const busOf = useAppSelector((s) => s.busOf)
  const muteRegionsByStem = useAppSelector((s) => s.muteRegions)
  const regionSelection = useAppSelector((s) => s.regionSelection)
  // The collapsed view shows the UNION of every stem's own muted spans --
  // a region only needs ONE stem to have it for the block to visibly show
  // it as muted, since the whole point of collapsed view is "one summary
  // block for this rifff." Deduped by exact (startBar,endBar) match.
  const muteRegions = useMemo(() => {
    const seen = new Set<string>()
    const out: { startBar: number; endBar: number }[] = []
    for (const stem of rifff.stems) {
      const key = stemKey(groupId, stem.slot)
      for (const region of muteRegionsByStem[key] ?? []) {
        const dedupeKey = `${region.startBar}:${region.endBar}`
        if (seen.has(dedupeKey)) continue
        seen.add(dedupeKey)
        out.push(region)
      }
    }
    return out
  }, [rifff.stems, groupId, muteRegionsByStem])
  const firstStem = rifff.stems[0]
  const color = stemDisplayColorVar(
    firstStem,
    busIfAssignedFromBusOf(busOf, groupId, firstStem.slot)
  )
  const isOneShot = rifff.stems.length === 1 && !!firstStem.oneShot
  const oneShotStem = isOneShot ? firstStem : null
  const secPerBar = (60 / bpm) * 4
  // One button for the whole group rather than exposing each stem's own mute
  // individually (unlike the expanded view) — collapsing already hides
  // per-stem detail, so "all muted" / "not all muted" is the only distinction
  // that makes sense at this level. Filled = at least one stem still
  // unmuted (clicking mutes everything); hollow = the whole group is
  // already muted (clicking unmutes everything) — same filled-means-active
  // convention as every other mute dot in this app.
  const allMuted = rifff.stems.every((stem) => mute[stemKey(groupId, stem.slot)])
  // Representative volume for the envelope's own drag-start/display value —
  // same "first stem stands in for the group" convention as the geometry
  // below. Actually adjusting the envelope dispatches SET_GROUP_VOLUME,
  // which sets every stem to the same value in one atomic edit, so this
  // representative value becomes exactly correct the moment it's touched.
  const volume = useAppSelector((s) => s.vol[stemKey(groupId, firstStem.slot)] ?? 1)

  // Shared, store-backed live preview, not local useState -- this row is
  // the one place a live volume/fade/length/crop preview needs to be
  // readable from OUTSIDE this component (StoreContext.tsx's engine-sync
  // effect, wired up in a later task, and StemWaveformRow's own sibling
  // instances in the expanded view) rather than trapped in per-component
  // state. See docs/superpowers/specs/2026-08-04-live-drag-preview-design.md.
  const dragPlayedBars = useAppSelector((s) => s.dragPlayedBars[groupId] ?? null)
  const dragLeftCropBars = useAppSelector((s) => s.dragLeftCropBars[groupId] ?? null)
  const dragFadeIn = useAppSelector((s) => s.dragFadeIn[groupId] ?? null)
  const dragFadeOut = useAppSelector((s) => s.dragFadeOut[groupId] ?? null)
  const dragVolume = useAppSelector((s) => s.dragVol[stemKey(groupId, firstStem.slot)] ?? null)
  // One-shot-only live drag preview -- separate from dragPlayedBars/
  // dragLeftCropBars above, which a one-shot never uses (its resize handles
  // are unsnapped seconds-based trim/stretch, not bar-snapped playedBars).
  // trimStartSec/isStretch feed the waveform's own crop-vs-scale rendering
  // below -- trimming must crop a fixed-scale waveform (the audio didn't
  // change speed), while stretching should visibly scale it (a preview of
  // the real re-render that commits on release).
  const [oneShotDragPreview, setOneShotDragPreview] = useState<{
    durationSec: number
    startBar: number
    trimStartSec: number
    isStretch: boolean
  } | null>(null)

  // Right-click anywhere on the block toggles the whole group's mute —
  // moved off plain click, same as StemWaveformRow's identical change, since
  // an accidental click meant for something else used to silently mute the
  // whole group. Ctrl+right-click solos this rifff instead (see
  // SOLO_GROUP) — cmd dropped from this gesture per user request, since
  // cmd+right-click wasn't reliably reaching the app on their system.
  function handleBlockContextMenu(e: React.MouseEvent): void {
    e.preventDefault()
    if (e.ctrlKey) {
      dispatch({ type: 'SOLO_GROUP', groupId })
      return
    }
    dispatch({ type: 'SET_GROUP_MUTE', groupId, muted: !allMuted })
  }

  // For a collapsed row, geometry is simply the group's own clipGeometry —
  // there's exactly one shared position/width for the whole rifff to show
  // here, same value every stem's own row would use if expanded instead.
  const playedBarsKey = groupId
  const playedBarsOverride = useAppSelector((s) => s.playedBars[groupId])
  const offsetSteps = useAppSelector((s) => s.off[groupId] ?? 0)
  const leftCropBars = useAppSelector((s) => s.leftCrop[groupId] ?? 0)
  const snapIdx = useAppSelector((s) => s.snapIdx)
  const stretchOn = useAppSelector((s) => s.stretch[groupId] ?? true)
  const resolvedPlayedBars = resolvedPlayedBarsFromFields(playedBarsOverride, rifff.barLength)
  const displayedPlayedBars = dragPlayedBars ?? resolvedPlayedBars
  const baseStartBar = rifff.startBar ?? 0

  const geo = clipGeometryFromFields({
    startBar: baseStartBar,
    offsetSteps,
    snapDiv: SNAP_DIVS[snapIdx],
    playedBarsOverride,
    leftCropBars,
    rifffBarLength: rifff.barLength,
    stretchOn,
    rifffBpm: rifff.bpm,
    stateBpm: bpm,
    ppb: PPB
  })
  const displayedLeftCropBars = dragLeftCropBars ?? leftCropBars
  // Live preview during a drag (non-one-shot case) on EITHER edge uses the
  // EXACT SAME formula real (committed) rendering uses -- one
  // clipGeometryFromFields call handling both dragPlayedBars (right edge)
  // and dragLeftCropBars (left edge) via their own overrides. See
  // StemWaveformRow's identical fix: the right edge used to shortcut to a
  // bare `dragPlayedBars * PPB` below (skipping the `- leftCropBars` and
  // stretch/bpm-scaling terms this formula applies), making the live-drag
  // width visibly wrong whenever leftCropBars was already nonzero or
  // stretch was off, snapping back to correct only once the drag
  // committed. Reported 2026-08-22: "waveform stretches" during a
  // right-edge trim.
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
    ppb: PPB
  })
  const oneShotCommittedDurationSec =
    oneShotStem != null
      ? (oneShotStem.trimEndSec ?? oneShotStem.durationSec) - (oneShotStem.trimStartSec ?? 0)
      : 0
  const displayedStartBar = isOneShot
    ? (oneShotDragPreview?.startBar ?? baseStartBar)
    : baseStartBar
  const leftPx = isOneShot
    ? displayedStartBar * PPB + (geo.leftPx - baseStartBar * PPB)
    : previewGeo.leftPx
  const widthPx = isOneShot
    ? oneShotWidthBars(oneShotDragPreview?.durationSec ?? oneShotCommittedDurationSec, bpm) * PPB
    : previewGeo.widthPx

  // One-shot waveform geometry: trimming must CROP a fixed-scale waveform
  // (the audio's own duration/speed hasn't changed, only how much of it
  // plays), never rescale it -- rescaling is what made a trim drag visually
  // read as "stretching" even though the underlying crop was correct. A
  // live stretch preview is the one case that SHOULD visibly scale (a
  // preview of the real re-render that commits on release), so it uses the
  // live target duration as its own "native" width instead of the stem's
  // actual (not-yet-changed) one, with no trim offset (stretch always
  // discards trim on commit -- see SET_ONE_SHOT_STRETCHED).
  const oneShotIsStretchDragging = oneShotDragPreview?.isStretch ?? false
  const oneShotWaveformNativeSec = oneShotIsStretchDragging
    ? (oneShotDragPreview?.durationSec ?? oneShotStem?.durationSec ?? 0)
    : (oneShotStem?.durationSec ?? 0)
  const oneShotWaveformNativeWidthPx = oneShotWidthBars(oneShotWaveformNativeSec, bpm) * PPB
  const oneShotWaveformTrimStartSec = oneShotIsStretchDragging
    ? 0
    : (oneShotDragPreview?.trimStartSec ?? oneShotStem?.trimStartSec ?? 0)
  const oneShotWaveformTrimStartPx = oneShotWidthBars(oneShotWaveformTrimStartSec, bpm) * PPB

  const fadeIn = useAppSelector((s) => s.fadeIn[groupId] ?? 0)
  const fadeOut = useAppSelector((s) => s.fadeOut[groupId] ?? 0)
  const displayedFadeIn = dragFadeIn ?? fadeIn
  const displayedFadeOut = dragFadeOut ?? fadeOut
  const displayedVolume = dragVolume ?? volume

  const fadeInPx = displayedFadeIn * PPB
  const fadeOutPx = displayedFadeOut * PPB
  const plateauY = ROW_HEIGHT * (1 - displayedVolume)
  const colorClipPath = combinedClipPath(
    widthPx,
    ROW_HEIGHT,
    volumeDragMode,
    fadeInPx,
    fadeOutPx,
    plateauY,
    muteRegions,
    PPB,
    leftPx
  )
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
        const requestedLeftCropBars = startLeftCropBars + Math.round(deltaX / PPB)
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

  function handleOneShotRightEdgeStart(e: React.MouseEvent): void {
    if (!oneShotStem) return
    // Only the primary button starts a resize -- without this, macOS's own
    // long-standing "Control-click = secondary click" system convention
    // meant a Control+click here could arrive as a button-2 mousedown
    // rather than a button-0 mousedown with ctrlKey set, making plain drag
    // and "ctrl+drag" indistinguishable in practice. altKey (Option) has no
    // such OS-level override, so it's used for stretch instead of ctrlKey.
    if (e.button !== 0) return
    const isStretch = e.altKey
    const trimStartSec = oneShotStem.trimStartSec ?? 0
    const committedTrimEndSec = oneShotStem.trimEndSec ?? oneShotStem.durationSec
    const nativeDurationSec = oneShotStem.durationSec
    let finalDurationSec = committedTrimEndSec - trimStartSec
    let finalTrimEndSec = committedTrimEndSec
    startPointerDrag(
      e,
      (deltaX) => {
        const deltaSec = (deltaX / PPB) * secPerBar
        if (isStretch) {
          finalDurationSec = targetDurationForRightEdgeStretch(nativeDurationSec, deltaSec)
        } else {
          finalTrimEndSec = trimRightEdge(
            committedTrimEndSec,
            deltaSec,
            trimStartSec,
            nativeDurationSec
          )
          finalDurationSec = finalTrimEndSec - trimStartSec
        }
        setOneShotDragPreview({
          durationSec: finalDurationSec,
          startBar: baseStartBar,
          trimStartSec,
          isStretch
        })
      },
      (moved) => {
        if (moved) {
          if (isStretch) {
            const ratio = stretchRatioForTargetDuration(nativeDurationSec, finalDurationSec)
            void window.rifffApi
              .renderStretched(oneShotStem.path, ratio)
              .then((result) => {
                dispatch({
                  type: 'SET_ONE_SHOT_STRETCHED',
                  groupId,
                  path: result.path,
                  durationSec: result.durationSec,
                  startBar: baseStartBar
                })
              })
              .catch((err) => {
                // Fails safely -- no dispatch, so the clip's trim/stretch
                // state is left exactly as it was before this drag. Same
                // "fails safely, no partial state" precedent as the
                // existing bake-stem error path.
                console.error('One-shot ctrl-drag stretch failed:', err)
              })
          } else {
            dispatch({
              type: 'SET_ONE_SHOT_TRIM',
              groupId,
              trimStartSec,
              trimEndSec: finalTrimEndSec,
              startBar: baseStartBar
            })
          }
        }
        setOneShotDragPreview(null)
      }
    )
  }

  function handleOneShotLeftEdgeStart(e: React.MouseEvent): void {
    if (!oneShotStem) return
    // See handleOneShotRightEdgeStart's own comment -- same button/modifier
    // reasoning, mirrored here.
    if (e.button !== 0) return
    const isStretch = e.altKey
    const committedTrimStartSec = oneShotStem.trimStartSec ?? 0
    const trimEndSec = oneShotStem.trimEndSec ?? oneShotStem.durationSec
    const committedDurationSec = trimEndSec - committedTrimStartSec
    const nativeDurationSec = oneShotStem.durationSec
    const startPosBar = baseStartBar
    let finalDurationSec = committedDurationSec
    let finalTrimStartSec = committedTrimStartSec
    let finalStartBar = startPosBar
    startPointerDrag(
      e,
      (deltaX) => {
        const deltaSec = (deltaX / PPB) * secPerBar
        if (isStretch) {
          finalDurationSec = targetDurationForLeftEdgeStretch(nativeDurationSec, deltaSec)
        } else {
          finalTrimStartSec = trimLeftEdge(committedTrimStartSec, deltaSec, trimEndSec)
          finalDurationSec = trimEndSec - finalTrimStartSec
        }
        // The right edge (end-of-playback point) must stay fixed in
        // absolute time -- startBar shifts by exactly the change in
        // duration, so only the visible LEFT edge appears to move. This is
        // the exact anchor invariant the manual walkthrough's step 8 checks.
        finalStartBar = Math.max(
          0,
          startPosBar + oneShotWidthBars(committedDurationSec - finalDurationSec, bpm)
        )
        setOneShotDragPreview({
          durationSec: finalDurationSec,
          startBar: finalStartBar,
          // Stretch always discards trim on commit (see SET_ONE_SHOT_STRETCHED),
          // so a live stretch preview's trimStartSec is irrelevant -- the
          // renderer below forces trimStartPx to 0 whenever isStretch is
          // true regardless of what's passed here.
          trimStartSec: isStretch ? committedTrimStartSec : finalTrimStartSec,
          isStretch
        })
      },
      (moved) => {
        if (moved) {
          if (isStretch) {
            const ratio = stretchRatioForTargetDuration(nativeDurationSec, finalDurationSec)
            void window.rifffApi
              .renderStretched(oneShotStem.path, ratio)
              .then((result) => {
                dispatch({
                  type: 'SET_ONE_SHOT_STRETCHED',
                  groupId,
                  path: result.path,
                  durationSec: result.durationSec,
                  startBar: finalStartBar
                })
              })
              .catch((err) => {
                console.error('One-shot ctrl-drag stretch failed:', err)
              })
          } else {
            dispatch({
              type: 'SET_ONE_SHOT_TRIM',
              groupId,
              trimStartSec: finalTrimStartSec,
              trimEndSec,
              startBar: finalStartBar
            })
          }
        }
        setOneShotDragPreview(null)
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
        dispatch({ type: 'SET_DRAG_PREVIEW', field: 'fadeIn', key: groupId, value: finalFadeIn })
        scheduleLiveParamSync('fadeIn', groupId, finalFadeIn)
      },
      (moved) => {
        // Load-bearing beyond the obvious "commit the real edit" -- also
        // indirectly clears the native live override this drag set via
        // scheduleLiveParamSync above (SET_FADE_IN triggers the full-reload
        // effect, whose native load-project handler clears every live
        // override once it lands). See docs/superpowers/specs/
        // 2026-08-04-live-param-fast-path-design.md's "Handoff at
        // drag-end" section.
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
      (deltaX) => {
        finalFadeOut = Math.max(
          0,
          Math.min(FADE_MAX, startFadeOut - deltaX / (PPB * FADE_DRAG_SLOWDOWN))
        )
        dispatch({ type: 'SET_DRAG_PREVIEW', field: 'fadeOut', key: groupId, value: finalFadeOut })
        scheduleLiveParamSync('fadeOut', groupId, finalFadeOut)
      },
      (moved) => {
        // Load-bearing beyond the obvious "commit the real edit" -- see
        // handleFadeInStart's identical comment above (indirectly clears
        // the native live override this drag set via scheduleLiveParamSync).
        if (moved) dispatch({ type: 'SET_FADE_OUT', groupId, bars: finalFadeOut })
        dispatch({ type: 'SET_DRAG_PREVIEW', field: 'fadeOut', key: groupId, value: undefined })
      }
    )
  }

  // Mousedown anywhere on the waveform body (that isn't a resize handle or
  // fade dot): if it lands inside an already-muted region, immediately
  // selects that region's exact bounds (mode 'unmute') -- no drag needed,
  // matching "clicking a muted span re-selects it" from the design spec.
  // Otherwise starts an Ableton-style drag-to-select (mode 'mute'), scoped to
  // EVERY stem in this rifff at once (unlike StemWaveformRow's single-stem
  // scope) -- collapsing hides per-stem detail, so muting here mutes the
  // whole group. If the drag never actually moved (a plain click), falls
  // back to the original click-to-scrub behavior instead of leaving a
  // zero-width selection behind. Skipped while volumeDragMode is on, which
  // repurposes this same surface for volume dragging instead (unchanged from
  // before).
  function handleRegionMouseDown(e: React.MouseEvent): void {
    // Right-click (button 2) is handled entirely by onContextMenu above
    // (handleBlockContextMenu, toggling whole-group mute) -- see
    // StemWaveformRow.tsx's identical guard for why this is needed: left
    // unfiltered, a right-click's own mousedown fell through to the
    // click-to-scrub branch below and seeked the playhead as an unwanted
    // side effect of what should have been a mute-only action.
    if (e.button !== 0) return
    if (volumeDragMode) {
      handleVolumeStart(e)
      return
    }
    const rect = e.currentTarget.getBoundingClientRect()
    const startBar = Math.max(0, leftPx / PPB + (e.clientX - rect.left) / PPB)

    const stemKeys = rifff.stems.map((s) => stemKey(groupId, s.slot))
    const existingRegion = muteRegions.find((r) => startBar >= r.startBar && startBar < r.endBar)
    if (existingRegion) {
      e.preventDefault()
      e.stopPropagation()
      dispatch({
        type: 'SET_REGION_SELECTION',
        selection: {
          stemKeys,
          startBar: existingRegion.startBar,
          endBar: existingRegion.endBar,
          mode: 'unmute'
        }
      })
      return
    }

    startPointerDrag(
      e,
      (deltaX) => {
        const currentBar = Math.max(0, startBar + deltaX / PPB)
        dispatch({
          type: 'SET_REGION_SELECTION',
          selection: {
            stemKeys,
            startBar: Math.min(startBar, currentBar),
            endBar: Math.max(startBar, currentBar),
            mode: 'mute'
          }
        })
      },
      (moved) => {
        if (moved) return
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
      (_dx, deltaY) => {
        finalVolume = Math.max(0, Math.min(1, startVolume - deltaY / ROW_HEIGHT))
        dispatch({ type: 'SET_DRAG_PREVIEW_GROUP_VOLUME', groupId, value: finalVolume })
        // Fans out to every stem in the rifff, matching
        // SET_DRAG_PREVIEW_GROUP_VOLUME's own fan-out -- this drag
        // controls the whole rifff's volume together, so every stem's own
        // live override needs updating, not just one.
        for (const stem of rifff.stems) {
          scheduleLiveParamSync('volume', stemKey(groupId, stem.slot), finalVolume)
        }
      },
      (moved) => {
        // Load-bearing beyond the obvious "commit the real edit" -- also
        // indirectly clears every stem's native live override this drag
        // fanned out to above (SET_GROUP_VOLUME triggers the full-reload
        // effect, and IpcServer.cpp's load-project handler clears the
        // ENTIRE live-override map once that reload lands -- not just one
        // key -- so this single dispatch correctly clears all of them, not
        // just the first). See docs/superpowers/specs/
        // 2026-08-04-live-param-fast-path-design.md's "Handoff at
        // drag-end" section.
        if (moved) dispatch({ type: 'SET_GROUP_VOLUME', groupId, volume: finalVolume })
        dispatch({ type: 'SET_DRAG_PREVIEW_GROUP_VOLUME', groupId, value: undefined })
      }
    )
  }

  return (
    <div style={{ display: 'flex', height: ROW_HEIGHT, borderTop: '1px solid var(--ra-bg-row)' }}>
      <div style={{ flex: 1, position: 'relative' }}>
        <div
          data-rifff-clip
          data-tour-id="tour-mute"
          onContextMenu={handleBlockContextMenu}
          title="right-click to mute group · ctrl+right-click to solo"
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: leftPx,
            width: widthPx,
            borderRadius: 0,
            border: selected
              ? `2px solid ${color}`
              : `1px solid color-mix(in srgb, ${color} 40%, transparent)`,
            background: 'var(--ra-bg-row-sub)',
            overflow: 'hidden',
            cursor: 'grab'
          }}
        >
          {/* One tiled layer per stem, overlaid — colored by each stem's
              OWN tidy-up bus once it has one, else its raw Endlesss-derived
              SoundType (stemDisplayColorVar + busIfAssignedFromBusOf), not
              a single color for the whole rifff, so a clip mixing stems
              from different buses/types still reads each one at a glance
              rather than averaging into one representative color. Same no-blend-
              mode convention as PolarGlyph's own rings. Opacity raised to
              0.85 (was 0.55, matching PolarGlyph's rings) since the
              collapsed view is what most
              stems are seen through by default (expanding is a click away),
              and 0.55 read as too dark there. So the collapsed block's
              waveform reads as a mix of all its stems
              rather than just one representative one. Each stem's own mute
              state (independent of the single group-mute button, which just
              sets all of them at once) still suppresses that one stem's own
              layer. Clipped by the shared group envelope, same "full color
              under the curve" idea as StemWaveformRow's own color layer —
              only while envelope drag mode is engaged for that part -- plus
              a hole for any muted region regardless of drag mode, same "gray
              means quieter/off" language as the envelope itself (see
              combinedClipPath). Otherwise unclipped, so the waveform reads
              normally instead of looking dimmed whenever volume is below
              unity. */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              clipPath: colorClipPath
            }}
          >
            {isOneShot && oneShotStem
              ? !mute[stemKey(groupId, oneShotStem.slot)] && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 0,
                      bottom: 0,
                      left: -oneShotWaveformTrimStartPx,
                      width: oneShotWaveformNativeWidthPx
                    }}
                  >
                    <Waveform
                      path={oneShotStem.path}
                      color={stemDisplayColorVar(
                        oneShotStem,
                        busIfAssignedFromBusOf(busOf, groupId, oneShotStem.slot)
                      )}
                      opacity={0.85}
                    />
                  </div>
                )
              : rifff.stems
                  .filter((stem) => !mute[stemKey(groupId, stem.slot)])
                  .map((stem) => (
                    <CollapsedTiles
                      key={stem.slot}
                      path={stem.path}
                      color={stemDisplayColorVar(
                        stem,
                        busIfAssignedFromBusOf(busOf, groupId, stem.slot)
                      )}
                      opacity={0.85}
                      widthPx={widthPx}
                      stemBarLength={stem.barLength}
                      playedBars={displayedPlayedBars}
                      leftCropBars={displayedLeftCropBars}
                    />
                  ))}
          </div>

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

          {/* Resize handles, both edges — same behavior as StemWaveformRow's
              own (right grows the loop forward from a fixed start, left
              grows it backward from a fixed end), just scoped to the
              representative first stem/group here instead of a specific
              slot. startPointerDrag already calls preventDefault/
              stopPropagation, which blocks this block's own native drag
              from initiating on the same mousedown.

              The mousedown-catching box (16px) is wider than the visible
              tinted strip (5px) -- see StemWaveformRow's own identical fix
              for why (a hit target the same size as the visible affordance
              was too easy to miss and grab the whole-clip move/scrub
              surface instead). Extra width extends INWARD from the clip's
              true edge only. */}
          <div
            onMouseDown={isOneShot ? handleOneShotLeftEdgeStart : handleLeftResizeStart}
            onContextMenu={(e) => e.stopPropagation()}
            title={
              isOneShot ? 'drag to trim · option+drag to stretch' : `${displayedPlayedBars} bars`
            }
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
            onMouseDown={isOneShot ? handleOneShotRightEdgeStart : handleResizeStart}
            onContextMenu={(e) => e.stopPropagation()}
            title={
              isOneShot ? 'drag to trim · option+drag to stretch' : `${displayedPlayedBars} bars`
            }
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

          {/* Fade-in/fade-out knee handles. onContextMenu stopPropagation so
              right-clicking here doesn't also bubble up and toggle the
              group mute.

              The actual mousedown-catching box (14x14) is deliberately much
              bigger than the visible 7x7 dot -- see StemWaveformRow's own
              identical fix for why (at default settings these sit almost
              exactly on top of the resize handles' own corner, and a hit
              target the same size as the dot was too easy to miss by a
              pixel and grab the resize handle instead). Centered the same
              way via translate(-50%,-50%), so it only grows the invisible
              margin around the dot, never shifting its visual position.

              Not rendered at all outside envelope mode (volumeDragMode) --
              see StemWaveformRow's own identical fix for why (they aren't
              clickable there, so showing them was just visual noise with no
              affordance behind it). */}
          {volumeDragMode && (
            <>
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
                  zIndex: 4
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
                  zIndex: 4
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
            </>
          )}

          {/* Volume drag surface: spans the whole waveform body while
              volumeDragMode is on, repurposing the same open area that
              otherwise right-clicks to mute the group or drags to select a
              mute region. While off, this does nothing on mousedown — the
              event is left alone so the outer container's own drag handling
              proceeds normally instead. zIndex stays below the resize
              handles (3) and fade dots (4) in both modes — see
              StemWaveformRow's identical fix (a full-coverage div at the
              same z-index as those small edge targets would otherwise
              physically sit on top of them and swallow their mousedown
              before it ever reaches them). */}
          <div
            onMouseDown={handleRegionMouseDown}
            title={
              volumeDragMode
                ? 'drag to adjust group volume · right-click to mute'
                : 'click to scrub playhead · drag to select a region (delete to mute) · right-click to mute'
            }
            style={{
              position: 'absolute',
              inset: 0,
              cursor: volumeDragMode ? 'ns-resize' : 'default',
              zIndex: 2
            }}
          />

          {/* Already-committed mute regions (union across every stem -- see
              this file's own muteRegions useMemo above) -- same translucent
              red wash + border treatment as StemWaveformRow's identical
              region (see its own doc comment re: the Ableton reference this
              is approximating), so a muted span reads as "audio used to be
              here" rather than a flat gray patch. */}
          {muteRegions.map((r, i) => (
            <div
              key={i}
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: r.startBar * PPB - leftPx,
                width: (r.endBar - r.startBar) * PPB,
                background: 'color-mix(in srgb, var(--ra-mute-on) 20%, transparent)',
                border: '1px solid var(--ra-mute-on)',
                zIndex: 1,
                pointerEvents: 'none'
              }}
            />
          ))}

          {/* Live/pending region selection -- shown while dragging, and
              after release until Delete/Backspace commits it or it's
              cancelled. Visible whenever the active selection touches ANY of
              this rifff's own stems -- see this file's own Step 5 doc
              comment in the plan for why `.some(...)` is used here instead
              of StemWaveformRow's single-key `.includes(key)` check (there's
              no single `key` variable in this file). */}
          {regionSelection &&
            regionSelection.stemKeys.some((k) =>
              rifff.stems.some((s) => stemKey(groupId, s.slot) === k)
            ) && (
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: regionSelection.startBar * PPB - leftPx,
                  width: (regionSelection.endBar - regionSelection.startBar) * PPB,
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
              {dbLabel(displayedVolume)}
            </div>
          )}

          {/* The clip's own automation lane -- LAST child of the collapsed
              block, so it covers exactly the wave area (not the row, not the
              rifff's name bar). A collapsed clip draws every stem as ONE
              block, so it gets ONE lane, which writes the same curve to all
              of them -- the same whole-rifff treatment SET_GROUP_VOLUME and
              SET_GROUP_MUTE already give the collapsed view. Expanding the
              clip reveals a lane per stem (StemWaveformRow), which can then
              diverge freely; the curves are always STORED per stem either
              way. See the spec's section 2b. */}
          {automationMode && firstStemKey && (
            <AutomationLane
              laneId={groupId}
              target={{
                kind: 'group',
                groupId,
                representativeStemKey: firstStemKey
              }}
              widthPx={widthPx}
            />
          )}
        </div>
      </div>
    </div>
  )
}
