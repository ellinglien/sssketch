import { useState } from 'react'
import { useAppState, useDispatch, usePlaying } from '../state/StoreContext'
import { MIN_PLAYED_BARS } from '../state/store'
import { stemKey } from '@shared/types'
import { dbLabel } from '@shared/visuals'
import {
  stemGeometry,
  resolveOffsetKey,
  resolvePlayedBars,
  stemStartBar,
  channelMuteLetters
} from '../state/selectors'
import { typeColorVar } from '../theme/typeColor'
import { Waveform } from './Waveform'
import { PPB } from './Ruler'
import { ROW_HEIGHT } from './StemWaveformRow'
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
import { startPointerDrag, suppressNextSyntheticClick } from './dragUtils'
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
      {/* One thin line at every point the underlying loop restarts (skipping
          the first, at the block's own left edge) — see StemWaveformRow's
          identical marker for why: makes how long the stem's own native loop
          actually is legible at a glance. */}
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
  const playing = usePlaying()
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
  // Whole-group channel — see channelMuteLetters' doc comment.
  const shiftHeld = useShiftHeld()
  const muteLetter = channelMuteLetters(state)[groupId]
  const showMuteShortcut = shiftHeld && !!muteLetter
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

  // Click anywhere on the waveform (that isn't a resize handle, fade dot, or
  // a real drag) moves the transport playhead to that exact point — same
  // free/unsnapped scrub Ruler already offers, reachable directly from the
  // clip itself. Skipped while volumeDragMode is on, since that mode
  // repurposes this same surface for volume dragging instead.
  function handleScrubClick(e: React.MouseEvent): void {
    if (volumeDragMode) return
    const rect = e.currentTarget.getBoundingClientRect()
    const bar = Math.max(0, leftPx / PPB + (e.clientX - rect.left) / PPB)
    dispatch({ type: 'SELECT', groupId })
    dispatch({ type: 'SET_POS', pos: bar })
    if (playing) void window.rifffApi.engineSetPosition(bar)
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
            suppressNextSyntheticClick()
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
          onContextMenu={handleBlockContextMenu}
          title="right-click to mute group · ctrl+right-click to solo"
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: leftPx,
            width: widthPx,
            borderRadius: 0,
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
              layer. Clipped by the shared group envelope, same "full color
              under the curve" idea as StemWaveformRow's own color layer —
              but only while envelope drag mode is engaged; otherwise
              unclipped, so the waveform reads normally instead of looking
              dimmed whenever volume is below unity. */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              clipPath: volumeDragMode ? `path("${envelopePath}")` : undefined
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
              from initiating on the same mousedown. */}
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

          {/* Fade-in/fade-out knee handles — always active regardless of
              envelope/volumeDragMode, same as StemWaveformRow's own (fade is
              a separate, dedicated small target, not gated by the mode
              switch the way the broad volume drag surface below is).
              onContextMenu stopPropagation so right-clicking here doesn't
              also bubble up and toggle the group mute. */}
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
              volumeDragMode is on, repurposing the same open area that
              otherwise right-clicks to mute the group or drags to move the
              clip. While off, this does nothing on mousedown — the event is
              left alone so the outer container's own drag handling proceeds
              normally instead. zIndex stays below the resize handles (3) and
              fade dots (4) in both modes — see StemWaveformRow's identical
              fix (a full-coverage div at the same z-index as those small
              edge targets would otherwise physically sit on top of them and
              swallow their mousedown before it ever reaches them). */}
          <div
            onMouseDown={(e) => {
              if (volumeDragMode) handleVolumeStart(e)
            }}
            onClick={handleScrubClick}
            title={
              volumeDragMode
                ? 'drag to adjust group volume · right-click to mute'
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
              {dbLabel(displayedVolume)}
            </div>
          )}
        </div>

        {/* Mute-shortcut channel badge — sticky to the left edge of the
            visible timeline viewport, same as StemWaveformRow's identical
            badge (see its doc comment for why sticky, not leftPx-relative).
            One badge for the whole group, matching this row's own single
            mute control (SET_GROUP_MUTE, not a per-stem TOGGLE_MUTE). */}
        {showMuteShortcut && (
          <button
            onClick={() => dispatch({ type: 'SET_GROUP_MUTE', groupId, muted: !allMuted })}
            title={`shift+${muteLetter} to mute group`}
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
              background: allMuted ? '#fff' : '#000',
              color: allMuted ? '#000' : '#fff',
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
