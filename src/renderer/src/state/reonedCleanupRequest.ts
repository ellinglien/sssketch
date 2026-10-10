// The gear menu's "clean up unused stem copies…" asks the notice (ReonedCopiesNotice.tsx) to
// run, without threading a prop through App.
const listeners = new Set<() => void>()

export function requestReonedCleanup(): void {
  for (const listener of listeners) listener()
}

export function subscribeReonedCleanupRequest(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
