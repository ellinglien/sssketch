// The re-oned stem copies the open project names that couldn't be rebuilt (spec part 1: "the
// stem shows as missing"). Session-only: not saved, not undoable, not in AppState (decision D14).
// Set by the open-time repair, read by the pill and the Inspector, and drained by the retry
// loop (ReonedCopyMissingNotice.tsx), which retries only the `unreachable` ones.
import { useSyncExternalStore } from 'react'
import type { ReonedMissing } from '@shared/reonedRepair'

let missing: readonly ReonedMissing[] = []
const listeners = new Set<() => void>()

function publish(next: readonly ReonedMissing[]): void {
  missing = next
  for (const listener of listeners) listener()
}

/** Replaces the whole set: a project was opened (its own), or a new one started (none). */
export function setReonedMissing(next: readonly ReonedMissing[]): void {
  if (next.length === 0 && missing.length === 0) return
  publish([...next])
}

export function clearReonedMissing(paths: Iterable<string>): void {
  const gone = new Set(paths)
  if (!missing.some((m) => gone.has(m.path))) return
  publish(missing.filter((m) => !gone.has(m.path)))
}

export function reonedMissingPaths(): string[] {
  return missing.map((m) => m.path)
}

/** What can come back by itself: an original or library drive that was away. */
export function retryableReonedMissingPaths(): string[] {
  return missing.filter((m) => m.reason === 'unreachable').map((m) => m.path)
}

export function subscribeReonedMissing(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function snapshot(): readonly ReonedMissing[] {
  return missing
}

export function useReonedMissing(): readonly ReonedMissing[] {
  return useSyncExternalStore(subscribeReonedMissing, snapshot)
}
