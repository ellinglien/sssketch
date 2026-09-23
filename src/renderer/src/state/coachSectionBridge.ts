/**
 * The one imperative wire from sssketchy's bubble into the phase-two panel.
 *
 * Same shape, and the same reason, as the Discover bridge that stood
 * beside it until phase one was deleted (2026-09-23): the bubble's
 * "stuck?" list and "do it for me" offer the step's own moves, and phase
 * two's moves are buttons only SssketchySectionPanel can press (they close
 * over the engine preview, the current AppState and the placement builder).
 *
 * No queue, unlike that one had: there is nothing to open and wait for.
 * The panel is mounted exactly while p2-first/p2-section/p2-next are
 * current, so a request that finds no handler is a request that should not
 * have been made, and dropping it is better than storing it for a panel
 * that may open on a different section.
 *
 * Module-level mutable state, like the resolved-candidate and peak caches
 * elsewhere in the renderer -- with the same dev-only wrinkle Vite's Fast
 * Refresh brings: editing THIS file resets `handler` to null until the panel
 * remounts.
 */

import type { CoachSectionOp } from '@shared/coachSections'

export type CoachSectionOpHandler = (op: CoachSectionOp) => void

let handler: CoachSectionOpHandler | null = null

/** Called by SssketchySectionPanel on mount. Returns its own teardown, which
 * only clears the registration if it is still the current one -- React can
 * mount the next instance before unmounting the previous one (Strict Mode),
 * and a late teardown must not unregister the live panel. */
export function registerCoachSectionOp(next: CoachSectionOpHandler): () => void {
  handler = next
  return () => {
    if (handler === next) handler = null
  }
}

export function coachSectionPanelIsOpen(): boolean {
  return handler !== null
}

/** Presses one of the panel's own buttons, if it is on screen. */
export function requestCoachSectionOp(op: CoachSectionOp): void {
  handler?.(op)
}

/** Tests only. */
export function resetCoachSectionBridge(): void {
  handler = null
}
