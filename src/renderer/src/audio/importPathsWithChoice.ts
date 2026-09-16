// src/renderer/src/audio/importPathsWithChoice.ts
import type { Rifff } from '@shared/types'
import type { LoopOrOneShotChoice } from '../components/LoopOrOneShotPrompt'

/** Performs the actual import IPC calls for LoopOrOneShotPrompt's own
 * resolved choice, across every pending dropped path -- shared by
 * Shelf.tsx's drop handler and Timeline's own drop handler (App.tsx), the
 * two places an external (non-Endlesss, non-internal-drag) file can be
 * dropped and this prompt shown. Returns the imported Rifff for each path
 * that succeeded, skipping any that came back null (same "can't import
 * this one, skip it rather than aborting the whole batch" convention both
 * call sites already used before this was extracted) -- and `[]` for a
 * cancelled choice. Placement (Shelf just adds to the library; Timeline
 * also places each result on the arranger at the drop position) stays
 * with each caller -- this function only knows how to turn paths + a
 * choice into Rifffs. */
export async function importPathsWithChoice(
  paths: string[],
  choice: LoopOrOneShotChoice
): Promise<Rifff[]> {
  if (choice.type === 'cancel') return []
  const results: Rifff[] = []
  for (const path of paths) {
    const rifff =
      choice.type === 'oneShot'
        ? await window.rifffApi.importOneShot(path)
        : await window.rifffApi.importLoop(path, choice.barCount)
    if (rifff) results.push(rifff)
  }
  return results
}
