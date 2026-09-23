/**
 * The one imperative wire from sssketchy's bubble into Discover.
 *
 * Everything else the guided flow needs from Discover is declarative -- the
 * armed kinds go DOWN as a prop, the slot snapshots come UP as a callback.
 * But "do it for me" has to call DiscoverPanel's own `addSlot`, which
 * closes over that component's undo stack, roll options, project tempo and
 * trait bar. Re-implementing it in App.tsx would be a second, untested copy
 * of a function with a live bug history (see addSlot's own call to
 * pushUndoSnapshot). So DiscoverPanel registers its `addSlot` here while it
 * is mounted, and the bubble asks through this module.
 *
 * A request made while Discover is CLOSED is queued rather than dropped:
 * the bubble's own handler opens the library at the same moment, and
 * DiscoverPanel registers a tick later. Without the queue, the first "do it
 * for me" of a session would open Discover and add nothing, which reads as
 * a broken button. Capped, so a user clicking it repeatedly with the
 * library shut does not get a pile of slots when it finally opens.
 *
 * Module-level mutable state, like the resolved-candidate and peak caches
 * elsewhere in the renderer. Note the one dev-only wrinkle Vite's Fast
 * Refresh brings (the same one freshSlotId's own comment in
 * DiscoverPanel.tsx documents): editing THIS file resets `handler` to null,
 * and it stays null until DiscoverPanel remounts. Switching the library tab
 * fixes it; nothing about a packaged build is affected.
 */

import type { DiscoverSlotKind } from '@shared/discoverSlotKind'

export type CoachAddSlotHandler = (kinds: readonly DiscoverSlotKind[]) => void

/** Enough for a user who pressed the button a few times before the library
 * finished opening; small enough that nothing piles up. */
export const COACH_PENDING_ADD_LIMIT = 4

let handler: CoachAddSlotHandler | null = null
let pending: (readonly DiscoverSlotKind[])[] = []

/** Called by DiscoverPanel on mount. Returns its own teardown, which only
 * clears the registration if it is still the current one -- React can mount
 * the next instance before unmounting the previous one (Strict Mode,
 * a tab switch), and a late teardown must not unregister the live panel. */
export function registerCoachAddSlot(next: CoachAddSlotHandler): () => void {
  handler = next
  if (pending.length > 0) {
    const queued = pending
    pending = []
    for (const kinds of queued) next(kinds)
  }
  return () => {
    if (handler === next) handler = null
  }
}

export function coachDiscoverIsOpen(): boolean {
  return handler !== null
}

/** Adds one Discover slot targeting `kinds`, now or as soon as Discover is
 * on screen. */
export function requestCoachAddSlot(kinds: readonly DiscoverSlotKind[]): void {
  if (handler !== null) {
    handler(kinds)
    return
  }
  if (pending.length >= COACH_PENDING_ADD_LIMIT) return
  pending = [...pending, kinds]
}

/** Tests only. */
export function resetCoachDiscoverBridge(): void {
  handler = null
  pending = []
}
