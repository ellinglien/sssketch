import { useEffect, useRef } from 'react'
import {
  dialAngleDeg,
  dialArcPath,
  dialPointAt,
  dialTrackPath,
  dialValueAfterDrag,
  dialValueAfterWheel
} from './dialMath'
import { suppressNextSyntheticClick } from './dragUtils'

/** How long the wheel has to be still before a scroll counts as finished
 * and `onCommit` fires. A wheel gesture has no "up" event to end it, so
 * without this a fast scroll would commit once per notch -- for a caller
 * whose commit is an undo checkpoint (see RowGainDial) that's dozens of
 * checkpoints for one gesture. */
const WHEEL_COMMIT_DELAY_MS = 200

/** Round hardware-style knob for a 0-100 value -- direct request,
 * 2026-09-22, replacing Discover's native (round blue, browser-styled)
 * range slider, which didn't fit the monochrome pixel design. Drag up/down
 * (DAW-knob convention, pointer-captured so the drag survives leaving the
 * knob), scroll, or arrow keys (shift = x10); double-click resets to
 * `defaultValue`. Geometry/clamping lives in dialMath.ts (tested).
 *
 * **The gesture is self-contained, and has to be.** This is the only
 * drag-driven control in the app that doesn't run through
 * startPointerDrag, so it is the only one that used to leak its gesture
 * outward, and every knob in the arranger sits inside Timeline's own
 * click-to-scrub area (App.tsx's handleBackgroundClick). Reported by
 * Elling on the filter lane's resonance knob: "resonance knob is not
 * accessible.. it thinks I am moving the playhead" -- the trailing
 * synthetic click a finished drag produces was reaching that handler and
 * jumping the transport to wherever the knob was released. A call site
 * wrapping the knob in a `stopPropagation` mousedown guard (AutomationLane
 * and RiserBlock both do) never fixed that: mousedown is not the event
 * that escapes. So the guard lives here instead, and mirrors exactly what
 * startPointerDrag already does for every other drag in this codebase:
 * preventDefault + stopPropagation at press time, and
 * suppressNextSyntheticClick() once a real turn ends -- see dragUtils.ts,
 * whose own doc comment names this same bug ("a resize/fade/volume drag
 * jumping playback to the release point").
 *
 * The drag is also ended defensively from onLostPointerCapture, not just
 * onPointerUp: if the capture goes away mid-turn (the node re-created
 * under the pointer, a native drag starting, the window losing the
 * pointer) there is no pointerup to end on, and without this the knob
 * would stay stuck mid-gesture and the release would fall through to the
 * scrub. */
export function Dial({
  value,
  onChange,
  onCommit,
  defaultValue = 50,
  size = 26,
  ariaLabel,
  tooltip
}: {
  value: number
  onChange: (value: number) => void
  /** Called once per finished GESTURE, with its final value -- pointer-up
   * after a drag, the moment a key or a double-click lands, or a short
   * while after the last wheel notch. `onChange` fires continuously and is
   * the live/preview half; this is the "the user is done, commit it" half,
   * which is what lets a caller keep a drag out of the undo stack (see
   * StemWaveformRow's own SET_DRAG_PREVIEW/SET_VOLUME split). Omitted by a
   * caller whose onChange is already the commit (Discover's own dials). */
  onCommit?: (value: number) => void
  defaultValue?: number
  size?: number
  ariaLabel: string
  tooltip?: string
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ startY: number; startValue: number; latestValue: number } | null>(null)
  // Latest value/onChange/onCommit for the native wheel listener below,
  // which is attached once (it must be non-passive to preventDefault page
  // scroll, which React's own onWheel can't do).
  const latest = useRef({ value, onChange, onCommit })
  useEffect(() => {
    latest.current = { value, onChange, onCommit }
  }, [value, onChange, onCommit])

  const wheelCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    function handleWheel(e: WheelEvent): void {
      e.preventDefault()
      // ...and kept off the timeline's own wheel handler, which would
      // otherwise zoom or pan the arranger at the same time as the knob
      // turns (App.tsx's handleTimelineWheel, on the scroll container).
      e.stopPropagation()
      const next = dialValueAfterWheel(latest.current.value, e.deltaY)
      if (next === latest.current.value) return
      latest.current.onChange(next)
      if (wheelCommitTimerRef.current !== null) clearTimeout(wheelCommitTimerRef.current)
      wheelCommitTimerRef.current = setTimeout(() => {
        wheelCommitTimerRef.current = null
        latest.current.onCommit?.(next)
      }, WHEEL_COMMIT_DELAY_MS)
    }
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => {
      el.removeEventListener('wheel', handleWheel)
      if (wheelCommitTimerRef.current !== null) clearTimeout(wheelCommitTimerRef.current)
    }
  }, [])

  /** Ends whatever turn is in progress, from wherever the browser tells us
   * it ended. Commits only a turn that actually moved -- which is what
   * keeps a plain click on a knob out of the undo stack -- and arms the
   * synthetic-click suppressor for exactly that case, since a click that
   * never moved is already stopped by onClick below. */
  function endDrag(): void {
    const drag = dragRef.current
    dragRef.current = null
    if (!drag || drag.latestValue === drag.startValue) return
    suppressNextSyntheticClick()
    onCommit?.(drag.latestValue)
  }

  const r = size / 2 - 3
  const pointer = dialPointAt(dialAngleDeg(value), r - 2)
  const half = size / 2

  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      data-tooltip={tooltip}
      onPointerDown={(e) => {
        // preventDefault kills the press's own default action (a text
        // selection dragged out from under the knob, and on a knob nested
        // in a draggable ancestor a native drag that would cancel the
        // capture outright); stopPropagation keeps the press off every
        // ancestor gesture -- the lane's own draw, a riser's move, the
        // timeline's cmd-pan.
        e.preventDefault()
        e.stopPropagation()
        // preventDefault also suppresses the focus the press would
        // normally give this element, and the arrow keys below need it.
        e.currentTarget.focus()
        e.currentTarget.setPointerCapture(e.pointerId)
        dragRef.current = { startY: e.clientY, startValue: value, latestValue: value }
      }}
      onMouseDown={(e) => {
        // The compatibility mouse event for the same press. Stopped here
        // so this knob needs no `stopPropagation` wrapper at its call
        // sites -- every ancestor drag in this app starts on mousedown.
        e.preventDefault()
        e.stopPropagation()
      }}
      onPointerMove={(e) => {
        const drag = dragRef.current
        if (!drag) return
        const next = dialValueAfterDrag(drag.startValue, e.clientY - drag.startY)
        if (next === drag.latestValue) return
        drag.latestValue = next
        onChange(next)
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      onClick={(e) => {
        // A press that never moved still produces a click; it must not
        // reach Timeline's click-to-scrub. A press that DID move is
        // covered by endDrag's suppressor instead, since that click can
        // land on an ancestor rather than on the knob.
        e.stopPropagation()
      }}
      onContextMenu={(e) => e.stopPropagation()}
      onDoubleClick={(e) => {
        e.stopPropagation()
        if (value === defaultValue) return
        onChange(defaultValue)
        onCommit?.(defaultValue)
      }}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 10 : 1
        let next: number | null = null
        if (e.key === 'ArrowUp' || e.key === 'ArrowRight') next = value + step
        if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') next = value - step
        if (next === null) return
        e.preventDefault()
        const clamped = Math.max(0, Math.min(100, next))
        if (clamped === value) return
        onChange(clamped)
        // A key press is its own finished gesture: one step, one commit.
        onCommit?.(clamped)
      }}
      style={{ width: size, height: size, cursor: 'ns-resize', touchAction: 'none' }}
    >
      <svg width={size} height={size} viewBox={`${-half} ${-half} ${size} ${size}`}>
        <path d={dialTrackPath(r)} fill="none" stroke="var(--ra-border-strong)" strokeWidth={2} />
        <path d={dialArcPath(value, r)} fill="none" stroke="var(--ra-text)" strokeWidth={2} />
        <line
          x1={0}
          y1={0}
          x2={pointer.x}
          y2={pointer.y}
          stroke="var(--ra-text)"
          strokeWidth={1.5}
        />
      </svg>
    </div>
  )
}
