// Part 1 of the re-oned copies spec: a copy a project names but that is gone is rebuilt from its
// stem's lineage, through the same baker, one all-or-nothing batch per riff. See
// docs/superpowers/specs/2026-10-09-reoned-copies-cleanup-design.md. No better-sqlite3 here,
// even transitively: its test must stay off vitest.config.ts's CI exclude list.
import { access } from 'node:fs/promises'
import { basename } from 'node:path'
import type { AppState } from '../renderer/src/state/store'
import {
  applyReonedRepair,
  planReonedRepair,
  type ReonedRepairBatch,
  type ReonedRepairOutcome
} from '@shared/reonedRepair'
import { bakeOffset } from './bakeOffset'
import { resolveRecipe } from './reonedRecipe'
import { bakeAssetsDir, libraryRootPath } from './projectLibrary'

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export interface RebuildDirs {
  outputDir: string
  libraryRoot: string
}

/** Which candidate rotation made the copy the project names (decision D5 in the plan): the one
 * whose recipe name is the missing file's name; else the first. null when the original can't be
 * read, so the stem stays missing. */
async function chooseRotation(stem: ReonedRepairBatch['stems'][number]): Promise<number | null> {
  try {
    for (const candidate of stem.rotationSecCandidates) {
      if ((await resolveRecipe(stem.sourcePath, candidate)).name === basename(stem.path)) {
        return candidate
      }
    }
    return stem.rotationSecCandidates[0] ?? null
  } catch {
    return null
  }
}

/** Checks each batch's copies (async, so a slow library drive never blocks the main thread)
 * and rebuilds the missing ones. A riff whose missing copies can't all be rebuilt (an original
 * away, the library drive unplugged, a failed render) rebuilds none of them. */
export async function rebuildReonedCopies(
  batches: readonly ReonedRepairBatch[],
  dirs?: RebuildDirs
): Promise<ReonedRepairOutcome[][]> {
  const all: ReonedRepairOutcome[][] = []
  // Sequential on purpose: a copy two riffs share is rebuilt by the first and found by the second.
  for (const batch of batches) {
    const present = await Promise.all(batch.stems.map((s) => exists(s.path)))
    const needed = batch.stems.filter((_, i) => !present[i])
    const out: ReonedRepairOutcome[] = batch.stems.map((s, i) =>
      present[i] ? { path: s.path, status: 'present' } : { path: s.path, status: 'missing' }
    )
    if (needed.length > 0) {
      // Resolved only when something is missing: the defaults read app.getPath.
      dirs ??= { outputDir: bakeAssetsDir(), libraryRoot: libraryRootPath() }
      if (await exists(dirs.libraryRoot)) {
        const rotations = await Promise.all(needed.map(chooseRotation))
        if (rotations.every((r): r is number => r !== null)) {
          const results = await bakeOffset(
            needed.map((s, i) => ({
              path: s.path,
              rotationSec: 0,
              recipe: { sourcePath: s.sourcePath, rotationSec: rotations[i] },
              recipeOnly: true
            })),
            dirs.outputDir
          )
          if (results.length === needed.length) {
            const byPath = new Map(results.map((r) => [r.path, r]))
            for (let i = 0; i < out.length; i++) {
              const r = byPath.get(out[i].path)
              if (r && out[i].status === 'missing') {
                out[i] = {
                  path: r.path,
                  status: 'rebuilt',
                  bakedPath: r.bakedPath,
                  durationSec: r.durationSec
                }
              }
            }
          }
        }
      }
    }
    all.push(out)
  }
  return all
}

/** For the export choke points (decision D6): the state with every missing copy rebuilt,
 * repointed only where a rebuild landed under a new name. A copy still missing is left as is:
 * that stem renders silent, as a missing file always has. Returns `state` itself when nothing
 * moved. */
export async function ensureReonedCopiesForState(state: AppState): Promise<AppState> {
  const batches = planReonedRepair(state.rifffs)
  if (batches.length === 0) return state
  const outcomes = await rebuildReonedCopies(batches)
  const { rifffs, missing } = applyReonedRepair(state.rifffs, outcomes)
  if (missing.length > 0) {
    console.error(`ensureReonedCopiesForState: ${missing.length} re-oned copies still missing`)
  }
  return rifffs === state.rifffs ? state : { ...state, rifffs: rifffs as AppState['rifffs'] }
}
