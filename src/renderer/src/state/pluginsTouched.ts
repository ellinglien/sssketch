// src/renderer/src/state/pluginsTouched.ts -- "a plugin's settings may have changed since the
// last save". Plugin settings live in the engine and are left out of the unsaved-changes check
// (saveSerialization.ts's dirtyCheckJson), and a knob is only reachable in a plugin's editor
// window, so opening one, or the engine reporting a parameter change in an open one
// ('plugin-edited'), sets this. It makes the project unsaved (unsavedChanges.ts), so the quit
// prompt and the discard guard ask, and it restarts the crash-recovery autosave's debounce
// (`version`). A save clears it, and so does opening or starting a project
// (replacePendingPluginStates).
import { useSyncExternalStore } from 'react'

interface Snapshot {
  touched: boolean
  /** Bumped on every change. */
  version: number
}

let snapshot: Snapshot = { touched: false, version: 0 }
const listeners = new Set<() => void>()

function set(touched: boolean): void {
  snapshot = { touched, version: snapshot.version + 1 }
  for (const listener of listeners) listener()
}

export function markPluginsTouched(): void {
  set(true)
}

/** `ifVersion`: a save passes the version it started at, so a touch while it was writing (after
 * its capture) stays unsaved. */
export function clearPluginsTouched(ifVersion?: number): void {
  if (ifVersion !== undefined && ifVersion !== snapshot.version) return
  if (!snapshot.touched) return
  set(false)
}

export function pluginsTouchedSnapshot(): Snapshot {
  return snapshot
}

export function subscribePluginsTouched(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function usePluginsTouched(): Snapshot {
  return useSyncExternalStore(subscribePluginsTouched, pluginsTouchedSnapshot)
}
