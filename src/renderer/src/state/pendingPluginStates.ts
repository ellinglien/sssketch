// src/renderer/src/state/pendingPluginStates.ts -- two module-level pieces StoreContext shares
// with what sits outside it (kept out of StoreContext.tsx so that file exports only components
// and hooks).
import type { PluginStatesMap } from '@shared/pluginStates'

/** Owns pluginStates BETWEEN "a project was just parsed off disk" and "StoreContext's
 * masterChain/channelPlugins diffing effects fire their engineLoadMasterPlugin/
 * engineLoadChannelPlugin calls for it" -- see pluginStates.ts's own doc comment for why this
 * deliberately lives OUTSIDE the reducer/AppState. Module-level (StoreProvider is mounted once)
 * so a save can read what is still pending: with plugins off (the advanced features switch,
 * @shared/features) nothing is loaded into the engine, so these blobs are the ONLY copy of the
 * project's plugin settings, and a save must write them back rather than an empty engine
 * capture (App.tsx handleSave, mergePendingPluginStates). */
export const pendingPluginStatesRef: { current: PluginStatesMap } = { current: {} }

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
