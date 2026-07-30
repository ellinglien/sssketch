import { useState } from 'react'
import { startPointerDrag } from './dragUtils'

const SIZE = 20
const CENTER = SIZE / 2
const RADIUS = SIZE / 2 - 2
// 270° sweep (-135° at value 0 to +135° at value 1), the standard audio-knob
// convention — leaves a gap at the bottom so the indicator's position always
// reads unambiguously, unlike a full 360° sweep.
const MIN_DEG = -135
const MAX_DEG = 135
// Drag distance (px) mapped to the full 0-1 range — matches
// StemWaveformRow's handleVolumeStart's own vertical-drag-to-value pattern,
// just with its own tuned sensitivity since knobs are much smaller targets.
const DRAG_RANGE_PX = 120

function angleFor(value: number): number {
  return MIN_DEG + value * (MAX_DEG - MIN_DEG)
}

export function SendKnob({
  value,
  onChange,
  disabled,
  title
}: {
  value: number
  onChange: (value: number) => void
  disabled?: boolean
  title?: string
}): React.JSX.Element {
  const [dragValue, setDragValue] = useState<number | null>(null)
  const displayed = dragValue ?? value
  const angle = angleFor(displayed)
  const rad = (angle * Math.PI) / 180
  // SVG y-axis grows downward, and angle 0 should point straight up — hence
  // the -cos/sin swap (a plain sin/cos pair would point angle 0 rightward).
  const tickX = CENTER + RADIUS * Math.sin(rad)
  const tickY = CENTER - RADIUS * Math.cos(rad)

  function handleMouseDown(e: React.MouseEvent): void {
    if (disabled) return
    const startValue = value
    let finalValue = startValue
    startPointerDrag(
      e,
      (_dx, deltaY) => {
        finalValue = Math.max(0, Math.min(1, startValue - deltaY / DRAG_RANGE_PX))
        setDragValue(finalValue)
      },
      (moved) => {
        if (moved) onChange(finalValue)
        setDragValue(null)
      }
    )
  }

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}
      title={title}
    >
      <svg
        width={SIZE}
        height={SIZE}
        onMouseDown={handleMouseDown}
        onDoubleClick={() => !disabled && onChange(0)}
        shapeRendering="crispEdges"
        style={{
          cursor: disabled ? 'not-allowed' : 'ns-resize',
          opacity: disabled ? 0.3 : 1
        }}
      >
        <circle
          cx={CENTER}
          cy={CENTER}
          r={RADIUS}
          fill="var(--ra-bg-row-active)"
          stroke="var(--ra-border-strong)"
          strokeWidth={1}
        />
        <line
          x1={CENTER}
          y1={CENTER}
          x2={tickX}
          y2={tickY}
          stroke={displayed > 0 ? 'var(--ra-text)' : 'var(--ra-text-3)'}
          strokeWidth={1.5}
        />
      </svg>
      <span style={{ fontSize: 8, color: 'var(--ra-text-3)', minWidth: 14, textAlign: 'center' }}>
        {Math.round(displayed * 100)}
      </span>
    </div>
  )
}
