// Spec part 1, at open: every stem whose path is a missing re-oned copy is rebuilt before the
// project reaches the engine (restoreState is what triggers the first engine load, decision
// D6). A repair is not an edit: a copy rebuilt under its own name changes nothing, so the
// project isn't marked unsaved; one rebuilt under a new name is, which is true.
import {
  applyReonedRepair,
  planReonedRepair,
  type ReonedRepairBatch,
  type ReonedRepairOutcome
} from '@shared/reonedRepair'
import type { AppState } from './store'
import { dirtyCheckJson } from './saveSerialization'
import { setReonedMissing } from './reonedMissing'

export type RebuildReonedCopies = (batches: ReonedRepairBatch[]) => Promise<ReonedRepairOutcome[][]>

const rebuildThroughMain: RebuildReonedCopies = (batches) =>
  window.rifffApi.rebuildReonedCopies(batches)

/** The project with its missing copies rebuilt, `loaded` itself when no path moved. Sets the
 * session's missing set to this project's. Never throws: a failed rebuild opens the project as
 * saved. */
export async function repairReonedCopiesOnOpen(
  loaded: AppState,
  rebuild: RebuildReonedCopies = rebuildThroughMain
): Promise<AppState> {
  setReonedMissing([])
  const batches = planReonedRepair(loaded.rifffs)
  if (batches.length === 0) return loaded
  try {
    const { rifffs, missing } = applyReonedRepair(loaded.rifffs, await rebuild(batches))
    setReonedMissing(missing)
    return rifffs === loaded.rifffs ? loaded : { ...loaded, rifffs: rifffs as AppState['rifffs'] }
  } catch (err) {
    console.error('repairReonedCopiesOnOpen: rebuild failed; opening as saved:', err)
    return loaded
  }
}

/** What every project load in App does: the state to restore, and the saved baseline for the
 * unsaved mark, which is the file as saved (`loaded`), not the repaired state. */
export async function openWithReonedRepair(
  loaded: AppState,
  rebuild: RebuildReonedCopies = rebuildThroughMain
): Promise<{ state: AppState; savedJson: string }> {
  const state = await repairReonedCopiesOnOpen(loaded, rebuild)
  return { state, savedJson: dirtyCheckJson(loaded) }
}
