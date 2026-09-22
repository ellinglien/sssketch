/** Pushes a live volume value straight to the native engine, bypassing
 * the full buildEngineProject/engineLoadProject reload path entirely -- see
 * docs/superpowers/specs/2026-08-04-live-param-fast-path-design.md. Call
 * this directly from a drag handler's onMove callback, alongside (not
 * instead of) the existing SET_DRAG_PREVIEW dispatch that drives the visual
 * preview.
 *
 * Coalesces via requestAnimationFrame: multiple calls for different keys
 * arriving before the next frame are all remembered (keyed by
 * `${field}:${key}`, latest value wins per key) and flushed together, once
 * per frame -- so e.g. a group-volume drag's fan-out across several stems
 * updates them all in the same frame rather than staggered across several.
 * A fast mouse can fire far more often than the display refreshes, so this
 * caps the actual IPC traffic at ~60Hz regardless of drag speed.
 *
 * No "dirty during in-flight" concern the way StoreContext.tsx's own
 * full-reload throttle needs (see its own doc comment) -- each
 * engineSetLiveParam call is a small, synchronous socket write plus a tiny
 * native map rebuild, not an async chain that can meaningfully overlap
 * itself; there's nothing to guard against by the time the next frame's
 * flush would run. */

/** Only 'volume' now: the per-clip fade this once also carried is gone (a
 * clip's fades are part of its automation lane's own volume curve -- see
 * applyEdgeFade in src/shared/automationEdit.ts), and a curve edit is a
 * committed edit, not a live-dragged scalar. The engine's own set-live-param
 * handler still understands the old field names; nothing sends them. */
type LiveParamField = 'volume'

const pending = new Map<string, { field: LiveParamField; key: string; value: number }>()
let flushScheduled = false

export function scheduleLiveParamSync(field: LiveParamField, key: string, value: number): void {
  pending.set(`${field}:${key}`, { field, key, value })
  if (flushScheduled) return
  flushScheduled = true
  requestAnimationFrame(() => {
    flushScheduled = false
    const toSend = Array.from(pending.values())
    pending.clear()
    for (const entry of toSend) {
      void window.rifffApi.engineSetLiveParam(entry.field, entry.key, entry.value)
    }
  })
}
