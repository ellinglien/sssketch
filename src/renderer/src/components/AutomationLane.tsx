import { useRef, useState } from 'react'
import {
  AUTOMATION_PARAMS,
  AUTOMATION_PARAM_LABEL,
  AUTOMATION_PARAM_SHORT_LABEL,
  type AutomationParam,
  type AutomationPoint
} from '@shared/toolkit'
import {
  AUTOMATION_SIMPLIFY_TOLERANCE,
  addStrokeSample,
  applyStroke,
  barToX,
  curvePolyline,
  hitTestPoint,
  insertPoint,
  movePoint,
  rampStroke,
  removePoint,
  simplifyCurve,
  snapBar,
  valueToY,
  xToBar,
  yToValue
} from '@shared/automationEdit'
import { startPointerDrag } from './dragUtils'
import { useAppSelector, useDispatch, useZoom } from '../state/StoreContext'

/** The SVG viewBox's vertical extent. Arbitrary (nothing reads it as
 * pixels): the lane is drawn in a non-uniformly-scaled viewBox so the
 * polyline can be laid out without the component ever measuring its own
 * rendered height, and 100 makes each unit one percent of the lane, which
 * is also exactly what the breakpoint squares' own `top: N%` wants.
 *
 * The HORIZONTAL axis is deliberately NOT scaled like that any more. The SVG
 * gets an explicit pixel width equal to the lane's own width, matching the
 * viewBox's width exactly, so one viewBox x unit is one CSS pixel and the
 * polyline lands in the same coordinate space as the absolutely-positioned
 * breakpoint squares (which are placed with a raw `left: barToX(...)` px).
 * That is the fix for the reported "dots aren't on the line" bug: the lane
 * used to be `width="100%"` over a viewBox sized to the WHOLE timeline, and
 * the row's real box is `minWidth: 100%` of the viewport (App.tsx's
 * Timeline), so on any project narrower than the window the two axes were
 * scaled by different factors and the line drifted off its own points. */
const VIEWBOX_HEIGHT = 100

/** Breakpoints are small squares -- sharp corners, monochrome, per
 * tokens.css. 5px matches AUTOMATION_HIT_RADIUS_PX, so "looks like I'm on
 * it" and "grabs it" agree. */
const POINT_SIZE = 5

/** Below this the picker is hidden entirely: it would cover the whole lane,
 * leaving nothing to draw on. The lane itself still works (it keeps whatever
 * parameter it was last set to) -- zooming in brings the picker back. */
const PICKER_MIN_LANE_WIDTH_PX = 54

/** A stable identity for "this lane has no curve", so the useAppSelector
 * below can compare with Object.is and not re-render every dispatch. */
const EMPTY_CURVE: AutomationPoint[] = []

const selectStyle: React.CSSProperties = {
  fontFamily: 'inherit',
  fontSize: 9,
  padding: '0 2px',
  background: 'var(--ra-bg-row)',
  border: '1px solid var(--ra-border)',
  borderRadius: 0,
  color: 'var(--ra-text-2)',
  minWidth: 0,
  // Wide enough for the longest short label ("verb") plus the native
  // disclosure arrow, narrow enough to leave a two-bar clip drawable.
  maxWidth: 46,
  appearance: 'none',
  cursor: 'pointer'
}

const clearButtonStyle: React.CSSProperties = {
  fontFamily: 'inherit',
  fontSize: 9,
  lineHeight: '11px',
  padding: '0 3px',
  background: 'var(--ra-bg-row-active)',
  border: '1px solid var(--ra-border)',
  borderRadius: 0,
  color: 'var(--ra-text-2)',
  cursor: 'pointer'
}

/** Where a lane's edit goes. A clip that is EXPANDED shows one lane per stem,
 * each writing only its own curve; a COLLAPSED clip draws its stems as one
 * block, so its single lane writes the same curve to all of them -- the same
 * rule SET_GROUP_VOLUME/SET_GROUP_MUTE already follow for the collapsed
 * view, rather than a third convention. Either way the curve is STORED per
 * stem (state.stemAutomation, keyed by stemKey), so expanding a collapsed
 * clip afterwards reveals per-stem lanes that can then diverge freely. */
export type AutomationLaneTarget =
  | { kind: 'stem'; stemKey: string }
  | { kind: 'group'; groupId: string; representativeStemKey: string }

/**
 * ONE placed clip's automation lane, laid over exactly that clip's waveform
 * rect -- see section 2b of
 * docs/superpowers/specs/2026-09-22-builtin-sound-toolkit-design.md, the
 * revision that moved the toolkit from per channel to per clip after the
 * first live walkthrough ("the automation should be limited to the wave
 * area... it should be fixed to the placement. if the stem is moved, have
 * the envelope go with it").
 *
 * Three things follow from that and are worth stating plainly:
 * - The lane is mounted INSIDE the clip's own waveform box (StemWaveformRow /
 *   CollapsedRifffRow), so it is sized and positioned by that box rather than
 *   by anything measured here. It cannot overlap another row, and a clip that
 *   moves takes its lane with it for free.
 * - Bars are CLIP-RELATIVE: x=0 is this clip's left edge, and `clipBars`
 *   (the lane's own width in bars) is the right edge. snapBar clamps every
 *   drawn position into [0, clipBars], so drawing past the audio is not
 *   possible rather than merely discouraged.
 * - It also doubles as the dimming scrim for the clip underneath. In
 *   automation mode ChannelRow makes its clips inert (pointer-events: none)
 *   but does NOT dim them itself: dimming here means only the clips that
 *   actually have a lane recede, and the lane's own chrome stays at full
 *   contrast.
 *
 * Deliberately thin otherwise: every geometric and editing decision lives in
 * src/shared/automationEdit.ts, where it's tested. What's here is the DOM
 * events, the in-progress gesture, and the drawing.
 *
 * **Gesture -> undo.** The curve being drawn lives in this component's own
 * `gesture` state for the whole drag and is dispatched ONCE, on release, as a
 * single SET_STEM_AUTOMATION / SET_GROUP_AUTOMATION. So a freehand drag that
 * sampled two hundred positions is one undo step and one engine reload, not
 * two hundred of each -- the same split the volume/fade drags use (preview
 * during, commit on release), minus their transient store action, since
 * nothing outside this lane needs to see a half-drawn curve.
 *
 * **Input map.** Drag on empty lane draws freehand (simplified on release);
 * shift-drag draws a straight ramp; click adds a point; drag a point moves
 * it; double-click a point deletes it; right-click (or the small "x" button)
 * clears the lane. Snap-to-bar is on by default; hold Option to position
 * freely. Option rather than Control/Command for the reason
 * CollapsedRifffRow.tsx already documents at length: macOS turns a
 * Control-click into a secondary click, which makes ctrl+drag and plain drag
 * indistinguishable, and Option has no such OS-level override.
 */
export function AutomationLane({
  laneId,
  target,
  widthPx
}: {
  /** This lane's identity for the session-only parameter picker
   * (state.automationParamOf) -- the stemKey for a per-stem lane, the
   * groupId for a collapsed clip's whole-rifff one. */
  laneId: string
  target: AutomationLaneTarget
  /** The clip's own drawn width in pixels -- i.e. exactly the waveform rect
   * this lane covers (clipGeometryFromFields's widthPx). Both the drawing
   * and the right-edge clamp derive from this, so the lane can never extend
   * past the audio. */
  widthPx: number
}): React.JSX.Element {
  const dispatch = useDispatch()
  const ppb = useZoom()
  const param = useAppSelector(
    (s) => s.automationParamOf[laneId] ?? AUTOMATION_PARAMS[0]
  ) as AutomationParam
  const sourceStemKey = target.kind === 'stem' ? target.stemKey : target.representativeStemKey
  const committed = useAppSelector((s) => s.stemAutomation[sourceStemKey]?.[param]) ?? EMPTY_CURVE

  // The curve as it looks mid-gesture. null when no gesture is running, in
  // which case the committed curve is what's drawn.
  const [gesture, setGesture] = useState<AutomationPoint[] | null>(null)
  const [hovered, setHovered] = useState(false)
  const surfaceRef = useRef<HTMLDivElement>(null)

  const points = gesture ?? committed
  // The clip's own length in bars, from its own drawn width -- NOT
  // resolvePlayedBars, because a stretch-off clip is drawn (and plays)
  // tempo-scaled and the lane has to agree with the pixels it sits on. The
  // same number the engine reconstructs from the other side via
  // buildEngineProject's clipOriginBar.
  const clipBars = ppb > 0 ? widthPx / ppb : 0

  function commit(next: AutomationPoint[]): void {
    if (target.kind === 'stem') {
      dispatch({ type: 'SET_STEM_AUTOMATION', stemKey: target.stemKey, param, points: next })
    } else {
      dispatch({ type: 'SET_GROUP_AUTOMATION', groupId: target.groupId, param, points: next })
    }
  }

  /** Lane-local pixel position of an event, plus the lane's own current
   * height -- read at event time (rather than kept in state) because it's
   * the one thing here that depends on layout. */
  function surfaceAt(e: React.MouseEvent): { x: number; y: number; height: number } | null {
    const rect = surfaceRef.current?.getBoundingClientRect()
    if (!rect) return null
    return { x: e.clientX - rect.left, y: e.clientY - rect.top, height: rect.height }
  }

  function handleMouseDown(e: React.MouseEvent<HTMLDivElement>): void {
    // Only the primary button draws; the secondary one clears, via
    // onContextMenu below.
    if (e.button !== 0) return
    const at = surfaceAt(e)
    if (!at) return
    const { x, y, height } = at
    // Both modifiers are read ONCE, here at press time, and the drag runs on
    // that decision for its whole length -- partly because a shift-drag is
    // defined as "a straight line from press to release" (letting go of
    // shift halfway through shouldn't turn the line into a scribble), and
    // partly because the move/end callbacks below run after this handler
    // has returned, where re-reading the event's modifier flags is not
    // something to rely on.
    const snap = !e.altKey
    const isRamp = e.shiftKey
    const startBar = snapBar(xToBar(x, ppb), snap, clipBars)
    const startValue = yToValue(y, height)

    const grabbed = hitTestPoint(committed, x, y, ppb, height)
    if (grabbed >= 0) {
      // Moving an existing breakpoint. `current`/`index` are plain closure
      // variables, never setState updaters -- see dragUtils.ts's warning
      // about StrictMode double-invoking those.
      let current = committed
      let index = grabbed
      startPointerDrag(
        e,
        (dx, dy) => {
          const moved = movePoint(
            current,
            index,
            snapBar(xToBar(x + dx, ppb), snap, clipBars),
            yToValue(y + dy, height)
          )
          current = moved.points
          index = moved.index
          setGesture(current)
        },
        (didMove) => {
          setGesture(null)
          if (didMove) commit(current)
        }
      )
      return
    }

    // Drawing. A press that never moves is a click, and a click on an empty
    // lane adds a single point -- handled in onEnd, so the same mousedown
    // can turn out to be either.
    let stroke = addStrokeSample([], startBar, startValue)
    startPointerDrag(
      e,
      (dx, dy) => {
        const bar = snapBar(xToBar(x + dx, ppb), snap, clipBars)
        const value = yToValue(y + dy, height)
        stroke = isRamp
          ? rampStroke(startBar, startValue, bar, value)
          : addStrokeSample(stroke, bar, value)
        setGesture(applyStroke(committed, stroke))
      },
      (didMove) => {
        setGesture(null)
        if (!didMove) {
          commit(insertPoint(committed, startBar, startValue))
          return
        }
        // A ramp is already exactly two points; only a freehand stroke needs
        // thinning. barScale puts the simplification in lane heights -- what
        // the user actually sees -- so the tolerance means the same thing at
        // every zoom level.
        const finished = isRamp
          ? stroke
          : simplifyCurve(stroke, AUTOMATION_SIMPLIFY_TOLERANCE, ppb / Math.max(1, height))
        commit(applyStroke(committed, finished))
      }
    )
  }

  function handleDoubleClick(e: React.MouseEvent<HTMLDivElement>): void {
    const at = surfaceAt(e)
    if (!at) return
    const hit = hitTestPoint(committed, at.x, at.y, ppb, at.height)
    if (hit < 0) return
    e.preventDefault()
    e.stopPropagation()
    commit(removePoint(committed, hit))
  }

  function handleContextMenu(e: React.MouseEvent<HTMLDivElement>): void {
    // Always swallowed, so a right-click in a lane never falls through to
    // the arranger's own clip/paste menu -- in this mode the lane owns the
    // clip. Only dispatches when there's actually something to clear, so
    // right-clicking an empty lane doesn't push a no-op undo step.
    e.preventDefault()
    e.stopPropagation()
    if (committed.length > 0) commit([])
  }

  const polyline = curvePolyline(points, {
    ppb,
    widthPx,
    heightUnits: VIEWBOX_HEIGHT
  })
    .map((vertex) => `${vertex.x},${vertex.y}`)
    .join(' ')

  const showPicker = widthPx >= PICKER_MIN_LANE_WIDTH_PX

  return (
    <div
      ref={surfaceRef}
      data-automation-lane={laneId}
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      // A press that doesn't move still produces a trailing click, which
      // would otherwise bubble to the Timeline's own click-to-scrub.
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 4,
        cursor: 'crosshair',
        // Re-enables input for the lane alone: ChannelRow turns pointer
        // events off for the whole clip stack in automation mode (so a drag
        // can't move a clip you meant to draw on), and a descendant opting
        // back in is exactly how that is meant to be undone.
        pointerEvents: 'auto',
        // Doubles as the dim over the clip underneath -- see this
        // component's own doc comment.
        background: 'color-mix(in srgb, var(--ra-bg-row-sub) 72%, transparent)'
      }}
    >
      {showPicker && (
        // Pinned to the lane's own top-left corner, not the viewport's: the
        // lane IS the clip now, so there is nothing to scroll away from (the
        // old channel-wide lane needed a sticky anchor for exactly that
        // reason). Held at low contrast until the pointer is over this clip,
        // so a dense arrangement in automation mode reads as waveforms with
        // curves on them rather than as a wall of dropdowns.
        <div
          style={{
            position: 'absolute',
            left: 2,
            top: 2,
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            zIndex: 6,
            opacity: hovered ? 1 : 0.3,
            transition: 'opacity 120ms linear'
          }}
        >
          <select
            value={param}
            aria-label={`automation parameter for ${laneId}`}
            title={`which parameter this lane edits (${AUTOMATION_PARAM_LABEL[param]})`}
            onChange={(e) =>
              dispatch({
                type: 'SET_AUTOMATION_PARAM',
                laneId,
                param: e.target.value as AutomationParam
              })
            }
            onMouseDown={(e) => e.stopPropagation()}
            style={selectStyle}
          >
            {AUTOMATION_PARAMS.map((option) => (
              <option key={option} value={option}>
                {AUTOMATION_PARAM_SHORT_LABEL[option]}
              </option>
            ))}
          </select>
          {committed.length > 0 && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                commit([])
              }}
              onMouseDown={(e) => e.stopPropagation()}
              aria-label={`clear ${AUTOMATION_PARAM_LABEL[param]} automation on ${laneId}`}
              title="clear this lane (right-clicking the lane does the same)"
              style={clearButtonStyle}
            >
              x
            </button>
          )}
        </div>
      )}
      <svg
        // An explicit pixel width matching the viewBox's own width (rather
        // than "100%") is what keeps the polyline in the SAME coordinate
        // space as the breakpoint squares below -- see VIEWBOX_HEIGHT's doc
        // comment for the bug this fixes. Height stays proportional: the y
        // axis IS deliberately scaled, and the squares' own `top: N%`
        // tracks it exactly because VIEWBOX_HEIGHT is 100.
        width={Math.max(1, widthPx)}
        height="100%"
        viewBox={`0 0 ${Math.max(1, widthPx)} ${VIEWBOX_HEIGHT}`}
        preserveAspectRatio="none"
        style={{ position: 'absolute', left: 0, top: 0, display: 'block', pointerEvents: 'none' }}
      >
        {polyline && (
          // vectorEffect keeps this a true 1px hairline despite the viewBox's
          // non-uniform scale -- without it the y scale would stretch the
          // stroke into a wedge.
          <polyline
            points={polyline}
            fill="none"
            stroke="var(--ra-text)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      {points.map((point, i) => (
        <div
          key={`${point.bar}:${i}`}
          style={{
            position: 'absolute',
            left: barToX(point.bar, ppb),
            top: `${valueToY(point.value, VIEWBOX_HEIGHT)}%`,
            width: POINT_SIZE,
            height: POINT_SIZE,
            transform: 'translate(-50%, -50%)',
            background: 'var(--ra-text)',
            pointerEvents: 'none'
          }}
        />
      ))}
    </div>
  )
}
