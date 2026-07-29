/** Starts a window-level mouse drag from a React mousedown event. `onMove`
 * receives the CUMULATIVE delta from the drag's start point on every move
 * (not a frame-to-frame incremental delta) — callers should compute
 * `newValue = valueAtDragStart + delta / scale` rather than accumulating
 * incrementally, to avoid rounding drift across a long drag. Cleans up its
 * own listeners on mouseup and calls `onEnd(moved)` once, where `moved` is
 * true only if `onMove` fired at least once (i.e. a real drag happened, not
 * just a click) — callers use this to skip dispatching a no-op edit.
 *
 * IMPORTANT: never dispatch (or perform any other side effect) from inside a
 * `setState` updater FUNCTION passed to a caller's own state setter — React's
 * StrictMode double-invokes updater functions in development specifically to
 * catch impure updaters, so a dispatch placed there fires twice per drag.
 * Read/write plain closure variables from `onMove`/`onEnd` instead (as this
 * function's own implementation does), and dispatch directly in `onEnd`'s
 * body, never through a setState callback. See git history for the real bug
 * this caused and its fix, before "simplifying" this away in a refactor. */
export function startPointerDrag(
  e: React.MouseEvent,
  onMove: (deltaX: number, deltaY: number) => void,
  onEnd?: (moved: boolean) => void
): void {
  e.preventDefault()
  e.stopPropagation()
  const startX = e.clientX
  const startY = e.clientY
  let moved = false

  function handleMove(ev: MouseEvent): void {
    moved = true
    onMove(ev.clientX - startX, ev.clientY - startY)
  }
  function handleUp(): void {
    window.removeEventListener('mousemove', handleMove)
    window.removeEventListener('mouseup', handleUp)
    onEnd?.(moved)
  }
  window.addEventListener('mousemove', handleMove)
  window.addEventListener('mouseup', handleUp)
}
