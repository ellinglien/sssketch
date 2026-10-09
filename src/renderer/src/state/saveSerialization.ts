// src/renderer/src/state/saveSerialization.ts -- the two shapes of a project's JSON: what a save
// writes (with plugin settings) and what the unsaved-changes check compares (without).
import type { AppState } from './store'
import { serializeProject } from './serialize'
import {
  buildPluginStatesMap,
  mergePendingPluginStates,
  type PluginStatesMap,
  type RawPluginStatesCapture
} from '@shared/pluginStates'
import type { PluginChains } from '@shared/pluginSwitch'

/** The engine's settings for the slots it holds for this project (`held`, from
 * @shared/pluginSwitch's slotsEngineHolds) and no others: a slot it doesn't hold may have
 * another project's instance of the same plugin, the plugin it held before an edit, or nothing
 * yet. `raw` null (no answer, or not asked): none. */
export function liveSettingsForSave(
  raw: RawPluginStatesCapture | null,
  chains: PluginChains,
  held: ReadonlySet<string>
): PluginStatesMap {
  if (raw === null) return {}
  const captured = buildPluginStatesMap(raw, chains.masterChain, chains.channelPlugins)
  for (const slotKey of Object.keys(captured)) if (!held.has(slotKey)) delete captured[slotKey]
  return captured
}

/** The JSON every save path writes (save, save a copy, duplicate, rename, the crash-recovery
 * autosave). Per slot, still holding the same plugin: the engine's live settings (`live`, see
 * liveSettingsForSave), else the project's saved settings not yet handed to the engine
 * (`pending`), else the latest capture of this project's settings (`fallback`: a slot whose saved
 * settings were handed over but whose plugin the engine doesn't hold right now, after an engine
 * restart, say). So no save drops what the project read (mergePendingPluginStates). */
export function projectJsonForSave(
  state: AppState,
  live: PluginStatesMap,
  pending: PluginStatesMap,
  fallback: PluginStatesMap
): string {
  return serializeProject(
    state,
    mergePendingPluginStates(
      live,
      { ...fallback, ...pending },
      state.masterChain,
      state.channelPlugins
    )
  )
}

/** The JSON the unsaved-changes check compares, on BOTH sides (the live project and "last
 * saved"): never with plugin settings. They live in the engine and change without an edit, and
 * comparing a file's JSON (with them) against the live one (without) read every project with
 * plugins as unsaved right after it was opened or saved. A plugin settings change is tracked
 * apart (pluginsTouched.ts). */
export function dirtyCheckJson(state: AppState): string {
  return serializeProject(state)
}

/** A completed write may have saved exactly what it started with while the
 * user made newer edits during an awaited plugin capture or disk write. Such
 * a write is successful as a snapshot, but it is not current enough to
 * authorize discarding the live project on quit. */
export function saveCompletionIsCurrent(
  savedDirtyJson: string,
  currentDirtyJson: string,
  pluginsTouchedVersionAtStart: number,
  pluginsTouchedVersionNow: number
): boolean {
  return (
    savedDirtyJson === currentDirtyJson && pluginsTouchedVersionAtStart === pluginsTouchedVersionNow
  )
}

/** The crash-recovery autosave's generation: bumped by a save, a discard and a clear, so an
 * autosave that started before one (it waits on the engine) never lands after it and brings back
 * what was just saved or thrown away. */
export function createAutosaveGate(): {
  bump: () => void
  begin: () => number
  isCurrent: (token: number) => boolean
} {
  let generation = 0
  return {
    bump: () => {
      generation += 1
    },
    begin: () => generation,
    isCurrent: (token) => token === generation
  }
}

/** How long the crash-recovery autosave waits, `now`, when the project has had changes not yet
 * autosaved since `unsavedSince`: the debounce, but never past `maxWaitMs` after the first of
 * them -- a plugin whose editor reports changes every 750 ms (or someone editing non-stop) would
 * otherwise restart the debounce forever and nothing would ever be autosaved. */
export function autosaveDelayMs(
  now: number,
  unsavedSince: number,
  debounceMs: number,
  maxWaitMs: number
): number {
  return Math.max(0, Math.min(debounceMs, unsavedSince + maxWaitMs - now))
}

/** What the autosave timer does when it fires: write the recovery file while something is
 * unsaved; with nothing unsaved (just saved, or edited back to the saved state), clear the one
 * this session wrote, if any -- it would only offer, at the next launch, what is already on disk.
 * A file this session never wrote is left alone: it may be a previous session's crash recovery. */
export function autosaveAction(
  unsaved: boolean,
  wroteSinceClear: boolean
): 'write' | 'clear' | 'skip' {
  if (unsaved) return 'write'
  return wroteSinceClear ? 'clear' : 'skip'
}
