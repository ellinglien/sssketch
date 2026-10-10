// The one line said after a save-menu copy (@shared/saveCopyText): which file you're working in
// now. Session-only and short-lived, like the other notices' state modules; SaveCopyNotice.tsx
// shows it until it's clicked away or times out.
import { useSyncExternalStore } from 'react'

const SHOW_MS = 8000

let line: string | null = null
let timer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<() => void>()

function publish(next: string | null): void {
  line = next
  for (const listener of listeners) listener()
}

export function showSaveCopyNotice(text: string): void {
  if (timer !== null) clearTimeout(timer)
  timer = setTimeout(() => dismissSaveCopyNotice(), SHOW_MS)
  publish(text)
}

export function dismissSaveCopyNotice(): void {
  if (timer !== null) clearTimeout(timer)
  timer = null
  if (line !== null) publish(null)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useSaveCopyNotice(): string | null {
  return useSyncExternalStore(subscribe, () => line)
}
