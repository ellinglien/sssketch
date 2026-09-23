/**
 * The one imperative wire from sssketchy's bubble into the export menu.
 *
 * Same shape as ./coachTensionBridge.ts, for the same reason and with one
 * difference worth knowing: the handler is registered by ProjectMenu, which
 * is mounted for the whole life of the app, so this bridge is effectively
 * always reachable. The flow therefore does NOT build a second export path
 * of its own -- "Export V1: the existing export picker" (spec) means the
 * same three menu entries, opened from somewhere else.
 */

import type { CoachExportOp } from '@shared/coachTension'

export type CoachExportHandler = (op: CoachExportOp) => void

let handler: CoachExportHandler | null = null

/** Called by ProjectMenu on mount; returns its own teardown, which only
 * clears the registration if it is still the current one. */
export function registerCoachExport(next: CoachExportHandler): () => void {
  handler = next
  return () => {
    if (handler === next) handler = null
  }
}

export function coachExportIsReachable(): boolean {
  return handler !== null
}

/** Opens one of the export menu's own three entries. */
export function requestCoachExport(op: CoachExportOp): void {
  handler?.(op)
}

/** Tests only. */
export function resetCoachExportBridge(): void {
  handler = null
}
