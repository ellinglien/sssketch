import { useEffect, useRef } from 'react'
import {
  dialAngleDeg,
  dialArcPath,
  dialPointAt,
  dialTrackPath,
  dialValueAfterDrag,
  dialValueAfterWheel
} from './dialMath'

/** Round hardware-style knob for a 0-100 value -- direct request,
 * 2026-09-22, replacing Discover's native (round blue, browser-styled)
 * range slider, which didn't fit the monochrome pixel design. Drag up/down
 * (DAW-knob convention, pointer-captured so the drag survives leaving the
 * knob), scroll, or arrow keys (shift = x10); double-click resets to
 * `defaultValue`. Geometry/clamping lives in dialMath.ts (tested). */
export function Dial({
  value,
  onChange,
  defaultValue = 50,
  size = 26,
  ariaLabel,
  tooltip
}: {
  value: number
  onChange: (value: number) => void
  defaultValue?: number
  size?: number
  ariaLabel: string
  tooltip?: string
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ startY: number; startValue: number } | null>(null)
  // Latest value/onChange for the native wheel listener below, which is
  // attached once (it must be non-passive to preventDefault page scroll,
  // which React's own onWheel can't do).
  const latest = useRef({ value, onChange })
  useEffect(() => {
    latest.current = { value, onChange }
  }, [value, onChange])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    function handleWheel(e: WheelEvent): void {
      e.preventDefault()
      const next = dialValueAfterWheel(latest.current.value, e.deltaY)
      if (next !== latest.current.value) latest.current.onChange(next)
    }
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
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
        dragRef.current = { startY: e.clientY, startValue: value }
      }}
      onPointerMove={(e) => {
        const drag = dragRef.current
        if (!drag) return
        const next = dialValueAfterDrag(drag.startValue, e.clientY - drag.startY)
        if (next !== value) onChange(next)
      }}
      onPointerUp={() => {
        dragRef.current = null
      }}
      onPointerCancel={() => {
        dragRef.current = null
      }}
      onDoubleClick={() => onChange(defaultValue)}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 10 : 1
        let next: number | null = null
        if (e.key === 'ArrowUp' || e.key === 'ArrowRight') next = value + step
        if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') next = value - step
        if (next === null) return
        e.preventDefault()
        onChange(Math.max(0, Math.min(100, next)))
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
