/** Starts a window-level mouse drag from a React mousedown event. `onMove`
 * receives the CUMULATIVE delta from the drag's start point on every move
 * (not a frame-to-frame incremental delta) — callers should compute
 * `newValue = valueAtDragStart + delta / scale` rather than accumulating
 * incrementally, to avoid rounding drift across a long drag. Cleans up its
 * own listeners on mouseup and calls `onEnd` once, if provided. */
export function startPointerDrag(
  e: React.MouseEvent,
  onMove: (deltaX: number, deltaY: number) => void,
  onEnd?: () => void
): void {
  e.preventDefault()
  e.stopPropagation()
  const startX = e.clientX
  const startY = e.clientY

  function handleMove(ev: MouseEvent): void {
    onMove(ev.clientX - startX, ev.clientY - startY)
  }
  function handleUp(): void {
    window.removeEventListener('mousemove', handleMove)
    window.removeEventListener('mouseup', handleUp)
    onEnd?.()
  }
  window.addEventListener('mousemove', handleMove)
  window.addEventListener('mouseup', handleUp)
}
