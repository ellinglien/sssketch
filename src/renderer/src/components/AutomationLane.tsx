import { useRef, useState } from 'react'
import {
  AUTOMATION_PARAMS,
  AUTOMATION_PARAM_LABEL,
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
 * is also exactly what the breakpoint squares' own `top: N%` wants. */
const VIEWBOX_HEIGHT = 100

/** Breakpoints are small squares -- sharp corners, monochrome, per
 * tokens.css. 5px matches AUTOMATION_HIT_RADIUS_PX, so "looks like I'm on
 * it" and "grabs it" agree. */
const POINT_SIZE = 5

/** A stable identity for "this lane has no curve", so the useAppSelector
 * below can compare with Object.is and not re-render every dispatch. */
const EMPTY_CURVE: AutomationPoint[] = []

const selectStyle: React.CSSProperties = {
  fontFamily: 'inherit',
  fontSize: 9,
  padding: 'var(--ra-s-0) 4px',
  background: 'var(--ra-bg-row)',
  border: '1px solid var(--ra-border)',
  borderRadius: 2,
  color: 'var(--ra-text-2)',
  minWidth: 0
}

const clearButtonStyle: React.CSSProperties = {
  fontFamily: 'inherit',
  fontSize: 9,
  padding: '1px 4px',
  background: 'var(--ra-bg-row-active)',
  border: '1px solid var(--ra-border)',
  borderRadius: 2,
  color: 'var(--ra-text-2)',
  cursor: 'pointer'
}

/**
 * One channel's automation lane, drawn over that channel's (dimmed) clips in
 * automation mode -- step 3 of
 * docs/superpowers/specs/2026-09-22-builtin-sound-toolkit-design.md.
 *
 * Deliberately thin: every geometric and editing decision lives in
 * src/shared/automationEdit.ts, where it's tested. What's here is the DOM
 * events, the in-progress gesture, and the drawing.
 *
 * **Gesture -> undo.** The curve being drawn lives in this component's own
 * `gesture` state for the whole drag and is dispatched ONCE, on release, as a
 * single SET_CHANNEL_AUTOMATION. So a freehand drag that sampled two hundred
 * positions is one undo step and one engine reload, not two hundred of each
 * -- the same split the volume/fade drags use (preview during, commit on
 * release), minus their transient store action, since nothing outside this
 * lane needs to see a half-drawn curve.
 *
 * **Input map.** Drag on empty lane draws freehand (simplified on release);
 * shift-drag draws a straight ramp; click adds a point; drag a point moves
 * it; double-click a point deletes it; right-click (or the small "clear"
 * button) clears the lane. Snap-to-bar is on by default; hold Option to
 * position freely. Option rather than Control/Command for the reason
 * CollapsedRifffRow.tsx already documents at length: macOS turns a
 * Control-click into a secondary click, which makes ctrl+drag and plain drag
 * indistinguishable, and Option has no such OS-level override.
 */
export function AutomationLane({
  channelId,
  widthPx
}: {
  channelId: string
  /** The arranger's full timeline width in pixels (App.tsx's Timeline owns
   * that number). Passed in rather than measured so the drawn polyline's
   * flat hold after the last breakpoint reaches the real right-hand edge
   * without this component ever touching layout. */
  widthPx: number
}): React.JSX.Element {
  const dispatch = useDispatch()
  const ppb = useZoom()
  const param = useAppSelector(
    (s) => s.automationParamOf[channelId] ?? AUTOMATION_PARAMS[0]
  ) as AutomationParam
  const committed = useAppSelector((s) => s.channelAutomation[channelId]?.[param]) ?? EMPTY_CURVE

  // The curve as it looks mid-gesture. null when no gesture is running, in
  // which case the committed curve is what's drawn.
  const [gesture, setGesture] = useState<AutomationPoint[] | null>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)

  const points = gesture ?? committed

  function commit(next: AutomationPoint[]): void {
    dispatch({ type: 'SET_CHANNEL_AUTOMATION', channelId, param, points: next })
  }

  /** Lane-local pixel position of an event, plus the lane's own current
   * height -- read at event time (rather than kept in state) because it's
   * the one thing here that depends on layout, and a channel row's height
   * changes with what's on it. */
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
    const startBar = snapBar(xToBar(x, ppb), snap)
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
            snapBar(xToBar(x + dx, ppb), snap),
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
        const bar = snapBar(xToBar(x + dx, ppb), snap)
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
    // whole row. Only dispatches when there's actually something to clear,
    // so right-clicking an empty lane doesn't push a no-op undo step.
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

  return (
    <div
      ref={surfaceRef}
      data-automation-lane={channelId}
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
      // A press that doesn't move still produces a trailing click, which
      // would otherwise bubble to the Timeline's own click-to-scrub.
      onClick={(e) => e.stopPropagation()}
      style={{ position: 'absolute', inset: 0, zIndex: 4, cursor: 'crosshair' }}
    >
      {/* Zero-height sticky anchor, the same technique ChannelRow's own
          m/s/fx stack uses on the right -- pins these controls to the
          visible left edge while the timeline scrolls horizontally, without
          adding anything to the lane's flow. It has to be the surface's
          FIRST child (a sticky box sticks from wherever it sits in normal
          flow), which is also why it lives in here rather than as a sibling
          at the end of the channel row. */}
      <div style={{ position: 'sticky', left: 0, top: 0, height: 0, zIndex: 6 }}>
        <div
          style={{
            position: 'absolute',
            left: 4,
            top: 4,
            display: 'flex',
            alignItems: 'center',
            gap: 4
          }}
        >
          <select
            value={param}
            aria-label={`automation parameter for channel ${channelId}`}
            title="which parameter this lane edits"
            onChange={(e) =>
              dispatch({
                type: 'SET_AUTOMATION_PARAM',
                channelId,
                param: e.target.value as AutomationParam
              })
            }
            onMouseDown={(e) => e.stopPropagation()}
            style={selectStyle}
          >
            {AUTOMATION_PARAMS.map((option) => (
              <option key={option} value={option}>
                {AUTOMATION_PARAM_LABEL[option]}
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
              aria-label={`clear ${AUTOMATION_PARAM_LABEL[param]} automation on channel ${channelId}`}
              title="clear this lane (right-clicking the lane does the same)"
              style={clearButtonStyle}
            >
              clear
            </button>
          )}
        </div>
      </div>
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${Math.max(1, widthPx)} ${VIEWBOX_HEIGHT}`}
        preserveAspectRatio="none"
        style={{ position: 'absolute', inset: 0, display: 'block', pointerEvents: 'none' }}
      >
        {polyline && (
          // vectorEffect keeps this a true 1px hairline despite the viewBox's
          // non-uniform scale -- without it the x and y scales would stretch
          // the stroke into a wedge.
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
