// src/renderer/src/state/pendingPluginStates.ts -- two module-level pieces StoreContext shares
// with what sits outside it (kept out of StoreContext.tsx so that file exports only components
// and hooks).
import type { PluginStatesMap } from '@shared/pluginStates'
import {
  initialPluginSwitchState,
  pluginSlotKey,
  withFreshChoice,
  type PluginSlotTarget,
  type PluginSwitchState
} from '@shared/pluginSwitch'
import { clearPluginsTouched } from './pluginsTouched'

/** The project's saved plugin settings the engine hasn't been handed yet -- see pluginStates.ts's
 * own doc comment for why this deliberately lives OUTSIDE the reducer/AppState. An entry stays
 * until the engine reports a successful load of that plugin carrying it (@shared/pluginSwitch,
 * driven by StoreContext). Module-level (StoreProvider is mounted once) so a save can read what is
 * still pending: with plugins off (the advanced features switch, @shared/features), or a plugin
 * the catalog doesn't list, nothing is loaded into the engine, so these blobs are the ONLY copy
 * of those settings, and a save must write them back rather than an empty engine capture
 * (serializeForSave, mergePendingPluginStates). */
export const pendingPluginStatesRef: { current: PluginStatesMap } = { current: {} }

/** What @shared/pluginSwitch says the engine holds of the project's plugins -- owned by
 * StoreContext (the only writer bar markFreshPluginChoice), read by a save (App.tsx's serializeForSave, through
 * slotsEngineHolds) to know which slots' captured settings are this project's. */
export const pluginSwitchStateRef: { current: PluginSwitchState } = {
  current: initialPluginSwitchState
}

/** A plugin picked for `target` by hand (the slot's menu, the plugin browser), called just before
 * the chain edit is dispatched: it starts at its defaults, whatever a removal of the same plugin
 * there left parked -- those settings are for an undo only (@shared/pluginSwitch's
 * withFreshChoice). StoreContext's next step reads the ref, so nothing is lost between. */
export function markFreshPluginChoice(target: PluginSlotTarget): void {
  pluginSwitchStateRef.current = withFreshChoice(
    pluginSwitchStateRef.current,
    pluginSlotKey(target)
  )
}

// Bumped by each replacement below (a project opened, a new one started): the project
// generation @shared/pluginSwitch is given, so nothing the engine holds or reads back for one
// project is taken as another's.
let pendingGeneration = 0

// The latest capture of this project's plugin settings (a save's or the autosave's: only the
// slots the engine held for it), for an engine restart to reload a slot whose saved settings
// were already handed over (@shared/pluginSwitch's engine-restarted `fallback`), and for a save
// to fill such a slot until it has (saveSerialization.ts). This project's only.
let captureFallback: PluginStatesMap = {}

/** The project's saved plugin settings, replaced wholesale: a project was opened (its own), or a
 * new one started (none). Also starts its plugin settings from scratch: no capture of the old
 * project is kept, and nothing has been touched since its "save". */
export function replacePendingPluginStates(pluginStates: PluginStatesMap): void {
  pendingPluginStatesRef.current = pluginStates
  pendingGeneration += 1
  captureFallback = {}
  clearPluginsTouched()
}

export function pendingPluginStatesGeneration(): number {
  return pendingGeneration
}

/** A capture taken at `generation` (slots the engine held only): merged into the fallback, unless
 * another project was opened since. */
export function recordPluginCapture(captured: PluginStatesMap, generation: number): void {
  if (generation !== pendingGeneration) return
  captureFallback = { ...captureFallback, ...captured }
}

export function pluginCaptureFallback(): PluginStatesMap {
  return captureFallback
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

/** 'held' (@shared/pluginSwitch): plugins were switched off, but their settings couldn't be read
 * back, so they were left loaded rather than lost. 'retrying': StoreContext asks again, backing
 * off (heldRetryDelayMs); 'gave-up': it stopped asking. Shown by PluginsHeldNotice. */
export type PluginsHeldStatus = 'none' | 'retrying' | 'gave-up'

let heldStatus: PluginsHeldStatus = 'none'
const heldListeners = new Set<() => void>()

export function setPluginsHeldStatus(status: PluginsHeldStatus): void {
  if (status === heldStatus) return
  heldStatus = status
  for (const listener of heldListeners) listener()
}

export function pluginsHeldStatus(): PluginsHeldStatus {
  return heldStatus
}

export function subscribePluginsHeld(listener: () => void): () => void {
  heldListeners.add(listener)
  return () => heldListeners.delete(listener)
}
