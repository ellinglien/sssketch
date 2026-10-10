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

/** A retry's news on copies still missing: their reason now (a failed render stops retrying). */
export function updateReonedMissingReasons(entries: readonly ReonedMissing[]): void {
  const reasons = new Map(entries.map((e) => [e.path, e.reason]))
  if (!missing.some((m) => reasons.has(m.path) && reasons.get(m.path) !== m.reason)) return
  publish(missing.map((m) => ({ ...m, reason: reasons.get(m.path) ?? m.reason })))
}

/** Keeps only the copies a stem in `rifffs` still names. Every retry round runs it against the
 * open project (a stem or riff deleted since takes its entry with it), and so does an open that
 * failed after its repair set the new project's copies. When none remain the set clears, which
 * stops the retry timer. */
export function reconcileReonedMissing(
  rifffs: Readonly<Record<string, { stems: readonly { path: string }[] }>>
): void {
  if (missing.length === 0) return
  const named = new Set<string>()
  for (const rifff of Object.values(rifffs)) for (const stem of rifff.stems) named.add(stem.path)
  if (missing.every((m) => named.has(m.path))) return
  publish(missing.filter((m) => named.has(m.path)))
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
