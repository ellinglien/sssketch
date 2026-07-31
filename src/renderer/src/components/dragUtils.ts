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
    if (moved) suppressNextSyntheticClick()
    onEnd?.(moved)
  }
  window.addEventListener('mousemove', handleMove)
  window.addEventListener('mouseup', handleUp)
}

/** A real drag ending back over the page still makes the browser synthesize
 * a plain 'click' event afterward, targeted at whatever element is under the
 * cursor at release — not necessarily the one the drag started on. Left
 * unstopped, that click bubbles up and can trigger an unrelated ancestor
 * handler (e.g. the Timeline's own click-to-scrub, or a Shelf tile's own
 * click-to-preview) as if the user had deliberately clicked wherever they
 * happened to release the mouse. Two real bugs this fixes: a resize/fade/
 * volume drag (startPointerDrag, above) jumping playback to the release
 * point, and dragging an already-placed rifff — native HTML5 `draggable`,
 * not startPointerDrag, but the browser produces the exact same trailing
 * click regardless of which mechanism drove the drag — starting an
 * unrelated Shelf tile's preview if it happened to be released over one.
 * Callers using native drag-and-drop (`draggable`/`onDragStart`) should call
 * this from `onDragStart` itself, arming it right at the start of the drag
 * rather than waiting for `onDragEnd` — the relative order of a native
 * drag's own `dragend` and the trailing synthetic click isn't guaranteed
 * the way mouseup-then-click is for a plain pointer drag (see
 * startPointerDrag above), so arming as early as possible is the only way
 * to be sure the listener is in place before whichever fires first.
 *
 * Registered on the capture phase so it's swallowed before any handler
 * along the way sees it. Stays armed for a short window rather than
 * consuming exactly one event (`once: true`) — a single native drag has
 * been observed producing more than one trailing click in some cases, and
 * `once` would let the second one straight through. A genuinely new,
 * unrelated click arriving after the window still works normally. */
export function suppressNextSyntheticClick(): void {
  window.addEventListener('click', suppressSyntheticClick, { capture: true })
  window.setTimeout(() => {
    window.removeEventListener('click', suppressSyntheticClick, { capture: true })
  }, 300)
}

function suppressSyntheticClick(ev: MouseEvent): void {
  ev.stopPropagation()
  ev.preventDefault()
}
