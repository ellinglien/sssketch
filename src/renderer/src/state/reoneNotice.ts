// Re-ones that couldn't be applied this session, as lines for ReoneNotice.tsx (texts from
// @shared/reoneNotices). Session-only: not saved, not undoable, not in AppState. Stays until the
// user dismisses it, because the riffs it names stay unrotated until they act.
import { useSyncExternalStore } from 'react'

let lines: readonly string[] = []
const listeners = new Set<() => void>()

function publish(next: readonly string[]): void {
  lines = next
  for (const listener of listeners) listener()
}

export function showReoneNotice(line: string): void {
  publish([...lines.filter((l) => l !== line), line])
}

export function dismissReoneNotice(): void {
  if (lines.length > 0) publish([])
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useReoneNotice(): readonly string[] {
  return useSyncExternalStore(subscribe, () => lines)
}
