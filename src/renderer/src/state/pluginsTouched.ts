// src/renderer/src/state/pluginsTouched.ts -- "a plugin's settings may have changed since the
// last save". Plugin settings live in the engine and are left out of the unsaved-changes check
// (saveSerialization.ts's dirtyCheckJson), so the engine reports a knob turned in an open editor
// window ('plugin-edited': a parameter change made with a gesture, see PluginChain's EditWatch;
// or, as a fallback, an open editor's plugin state changing with no parameter saying so, an IR
// loaded, found when the editor closes, at a capture, an autosave or a quit: checkWatchedStates),
// and that sets this. Opening an editor does not, except a bridged plugin's, which the engine
// can't watch (editorOpenMarksUnsaved). It makes the project unsaved (unsavedChanges.ts), so the
// quit prompt and the discard guard ask, and each mark is a new `version`, which restarts the
// crash-recovery autosave's debounce. A save clears it, and so does opening or starting a project
// (replacePendingPluginStates); a clear is not a new version, so it never starts an autosave.
import { useSyncExternalStore } from 'react'

interface Snapshot {
  touched: boolean
  /** Bumped by every mark (not by a clear). */
  version: number
}

let snapshot: Snapshot = { touched: false, version: 0 }
const listeners = new Set<() => void>()

function set(next: Snapshot): void {
  snapshot = next
  for (const listener of listeners) listener()
}

export function markPluginsTouched(): void {
  set({ touched: true, version: snapshot.version + 1 })
}

/** `ifVersion`: a save passes the version it started at, so a touch while it was writing (after
 * its capture) stays unsaved. */
export function clearPluginsTouched(ifVersion?: number): void {
  if (ifVersion !== undefined && ifVersion !== snapshot.version) return
  if (!snapshot.touched) return
  set({ touched: false, version: snapshot.version })
}

/** Whether opening the editor of a plugin of this catalog `arch` marks the project unsaved by
 * itself: only a bridged one (x86_64, hosted by the Intel bridge), whose edits the engine can't
 * watch. Any other plugin's knob turns are reported by the engine ('plugin-edited'). */
export function editorOpenMarksUnsaved(arch: string | undefined): boolean {
  return arch === 'x86_64'
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
