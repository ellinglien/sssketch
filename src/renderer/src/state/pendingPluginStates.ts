// src/renderer/src/state/pendingPluginStates.ts -- two module-level pieces StoreContext shares
// with what sits outside it (kept out of StoreContext.tsx so that file exports only components
// and hooks).
import type { PluginStatesMap } from '@shared/pluginStates'

/** The project's saved plugin settings the engine hasn't been handed yet -- see pluginStates.ts's
 * own doc comment for why this deliberately lives OUTSIDE the reducer/AppState. An entry stays
 * until the engine reports a successful load of that plugin carrying it (@shared/pluginSwitch,
 * driven by StoreContext). Module-level (StoreProvider is mounted once) so a save can read what is
 * still pending: with plugins off (the advanced features switch, @shared/features), or a plugin
 * the catalog doesn't list, nothing is loaded into the engine, so these blobs are the ONLY copy
 * of those settings, and a save must write them back rather than an empty engine capture
 * (serializeForSave, mergePendingPluginStates). */
export const pendingPluginStatesRef: { current: PluginStatesMap } = { current: {} }

// Bumped by each replacement below (a project opened, a new one started), so the plugin switch's
// capture can tell that what it read back belongs to a project no longer open
// (@shared/pluginSwitch's capture-done `projectReplaced`).
let pendingGeneration = 0

/** The project's saved plugin settings, replaced wholesale: a project was opened (its own), or a
 * new one started (none). */
export function replacePendingPluginStates(pluginStates: PluginStatesMap): void {
  pendingPluginStatesRef.current = pluginStates
  pendingGeneration += 1
}

export function pendingPluginStatesGeneration(): number {
  return pendingGeneration
}

// Counts projects opened through StoreContext's restoreState (a sketch, a file, the autosave),
// for what reacts to an OPENING rather than to every edit -- PluginsOffNotice.
let projectOpenCount = 0
const projectOpenListeners = new Set<() => void>()

export function announceProjectOpened(): void {
  projectOpenCount += 1
  for (const listener of projectOpenListeners) listener()
}

export function subscribeProjectOpened(listener: () => void): () => void {
  projectOpenListeners.add(listener)
  return () => projectOpenListeners.delete(listener)
}

export function projectOpenedCount(): number {
  return projectOpenCount
}
