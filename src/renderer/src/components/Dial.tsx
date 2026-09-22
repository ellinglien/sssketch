import { useEffect, useRef } from 'react'
import {
  dialAngleDeg,
  dialArcPath,
  dialPointAt,
  dialTrackPath,
  dialValueAfterDrag,
  dialValueAfterWheel
} from './dialMath'

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
 * `defaultValue`. Geometry/clamping lives in dialMath.ts (tested). */
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
        e.currentTarget.setPointerCapture(e.pointerId)
        dragRef.current = { startY: e.clientY, startValue: value, latestValue: value }
      }}
      onPointerMove={(e) => {
        const drag = dragRef.current
        if (!drag) return
        const next = dialValueAfterDrag(drag.startValue, e.clientY - drag.startY)
        if (next === drag.latestValue) return
        drag.latestValue = next
        onChange(next)
      }}
      onPointerUp={() => {
        const drag = dragRef.current
        dragRef.current = null
        // Nothing to commit for a plain click that never moved -- which is
        // what keeps clicking a dial out of the undo stack entirely.
        if (drag && drag.latestValue !== drag.startValue) onCommit?.(drag.latestValue)
      }}
      onPointerCancel={() => {
        dragRef.current = null
      }}
      onDoubleClick={() => {
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
