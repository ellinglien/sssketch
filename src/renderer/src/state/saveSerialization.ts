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

/** The JSON every save path writes (save, save a copy, duplicate, rename, the crash-recovery
 * autosave): the engine's live plugin settings for the plugins it holds, plus the saved settings
 * of every plugin it doesn't -- all of them while the advanced features switch has plugins off --
 * so no save drops what the project read (mergePendingPluginStates). `raw` null (the engine didn't
 * answer) writes the saved settings alone; a user's explicit save refuses that instead (App.tsx
 * serializeForSave). */
export function projectJsonForSave(
  state: AppState,
  raw: RawPluginStatesCapture | null,
  pending: PluginStatesMap
): string {
  const live =
    raw === null ? {} : buildPluginStatesMap(raw, state.masterChain, state.channelPlugins)
  return serializeProject(
    state,
    mergePendingPluginStates(live, pending, state.masterChain, state.channelPlugins)
  )
}

/** The JSON the unsaved-changes check compares, on BOTH sides (the live project and "last
 * saved"): never with plugin settings. They live in the engine and change without an edit, and
 * comparing a file's JSON (with them) against the live one (without) read every project with
 * plugins as unsaved right after it was opened or saved. */
export function dirtyCheckJson(state: AppState): string {
  return serializeProject(state)
}
