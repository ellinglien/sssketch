/**
 * The one imperative wire from sssketchy's bubble into the phase-three
 * panel.
 *
 * Same shape, and the same reason, as ./coachSectionBridge.ts: the bubble's
 * "stuck?" list and "do it for me" offer the step's own moves, and phase
 * three's moves are buttons only SssketchyTensionPanel can press (they
 * close over the current AppState, the tension write path and the
 * transport).
 *
 * No queue: the panel is mounted exactly while p3-tension is current, so a
 * request that finds no handler is a request that should not have been
 * made, and dropping it is better than storing it.
 *
 * Module-level mutable state, like the other two bridges -- with the same
 * dev-only wrinkle Vite's Fast Refresh brings: editing THIS file resets
 * `handler` to null until the panel remounts.
 */

import type { CoachTensionOp } from '@shared/coachTension'

export type CoachTensionOpHandler = (op: CoachTensionOp) => void

let handler: CoachTensionOpHandler | null = null

/** Called by SssketchyTensionPanel on mount. Returns its own teardown,
 * which only clears the registration if it is still the current one --
 * React can mount the next instance before unmounting the previous one
 * (Strict Mode), and a late teardown must not unregister the live panel. */
export function registerCoachTensionOp(next: CoachTensionOpHandler): () => void {
  handler = next
  return () => {
    if (handler === next) handler = null
  }
}

export function coachTensionPanelIsOpen(): boolean {
  return handler !== null
}

/** Presses one of the panel's own buttons, if it is on screen. */
export function requestCoachTensionOp(op: CoachTensionOp): void {
  handler?.(op)
}

/** Tests only. */
export function resetCoachTensionBridge(): void {
  handler = null
}
