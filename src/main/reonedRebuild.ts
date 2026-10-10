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
  type ReonedMissingReason,
  type ReonedRepairBatch,
  type ReonedRepairOutcome
} from '@shared/reonedRepair'
import { rotationSecForBars } from '@shared/reonedRotation'
import { bakeOffsetDetailed } from './bakeOffset'
import { resolveRecipe } from './reonedRecipe'
import { bakeAssetsDir, isDefaultLibraryRoot, libraryRootPath } from './projectLibrary'

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
  /** The default root may be made when it isn't there, as the bake handler allows (a fresh
   * install that hasn't saved yet). A custom root that is missing is an unplugged drive. */
  mayCreateRoot?: boolean
}

type StemMetadataDurationLookup = (sourcePath: string) => number | null
let stemMetadataDuration: StemMetadataDurationLookup | null = null

/** How the stem's durationSec was set before its first bake, from its own LORE row (BPMrnd,
 * Length16s), or null when no library knows it. index.ts sets it: reading the library pulls in
 * better-sqlite3, which this module must not import (its test stays off the CI exclude list). */
export function setStemMetadataDurationLookup(lookup: StemMetadataDurationLookup | null): void {
  stemMetadataDuration = lookup
}

/** The renderer's candidates, with the riff-bpm one replaced by the stem's own LORE metadata
 * when main knows it: a Discover collage's riff bpm is another stem's. */
function rotationCandidates(stem: ReonedRepairBatch['stems'][number]): number[] {
  let metadataDurationSec: number | null = null
  try {
    metadataDurationSec = stemMetadataDuration?.(stem.sourcePath) ?? null
  } catch (err) {
    console.error('reonedRebuild: the stem metadata lookup failed:', err)
  }
  if (metadataDurationSec === null || !(metadataDurationSec > 0)) return stem.rotationSecCandidates
  const own = rotationSecForBars(stem.phaseBars, {
    barLength: stem.barLength,
    durationSec: metadataDurationSec
  })
  const [measured] = stem.rotationSecCandidates
  return measured === undefined || measured === own ? [own] : [measured, own]
}

/** Which candidate rotation made the copy the project names (decision D5 in the plan): the one
 * whose recipe name is the missing file's name; else the first. null when the original can't be
 * read, so the stem stays missing. */
async function chooseRotation(stem: ReonedRepairBatch['stems'][number]): Promise<number | null> {
  const candidates = rotationCandidates(stem)
  try {
    for (const candidate of candidates) {
      if ((await resolveRecipe(stem.sourcePath, candidate)).name === basename(stem.path)) {
        return candidate
      }
    }
    return candidates[0] ?? null
  } catch {
    return null
  }
}

/** Checks each batch's copies (async, so a slow library drive never blocks the main thread)
 * and rebuilds the missing ones. A riff whose missing copies can't all be rebuilt (an original
 * away, the library drive unplugged, a failed render) rebuilds none of them, and each says why:
 * `unreachable` (worth retrying once the drive is back) or `render-failed`. */
export async function rebuildReonedCopies(
  batches: readonly ReonedRepairBatch[],
  dirs?: RebuildDirs
): Promise<ReonedRepairOutcome[][]> {
  const all: ReonedRepairOutcome[][] = []
  // Sequential on purpose: a copy two riffs share is rebuilt by the first and found by the second.
  for (const batch of batches) {
    const present = await Promise.all(batch.stems.map((s) => exists(s.path)))
    const needed = batch.stems.filter((_, i) => !present[i])
    let reason: ReonedMissingReason = 'unreachable'
    const rebuilt = new Map<string, { bakedPath: string; durationSec: number }>()
    if (needed.length > 0) {
      // Resolved only when something is missing: the defaults read app.getPath.
      dirs ??= {
        outputDir: bakeAssetsDir(),
        libraryRoot: libraryRootPath(),
        mayCreateRoot: isDefaultLibraryRoot()
      }
      if (dirs.mayCreateRoot || (await exists(dirs.libraryRoot))) {
        const rotations = await Promise.all(needed.map(chooseRotation))
        if (rotations.every((r): r is number => r !== null)) {
          const outcome = await bakeOffsetDetailed(
            needed.map((s, i) => ({
              path: s.path,
              rotationSec: 0,
              recipe: { sourcePath: s.sourcePath, rotationSec: rotations[i] },
              recipeOnly: true
            })),
            dirs.outputDir,
            { mayCreateRoot: dirs.mayCreateRoot }
          )
          if (outcome.ok && outcome.results.length === needed.length) {
            for (const r of outcome.results) rebuilt.set(r.path, r)
          } else if (!outcome.ok && outcome.reason === 'render-failed') {
            reason = 'render-failed'
          }
        }
      }
    }
    all.push(
      batch.stems.map((s, i): ReonedRepairOutcome => {
        if (present[i]) return { path: s.path, status: 'present' }
        const r = rebuilt.get(s.path)
        return r
          ? { path: s.path, status: 'rebuilt', bakedPath: r.bakedPath, durationSec: r.durationSec }
          : { path: s.path, status: 'missing', reason }
      })
    )
  }
  return all
}

/** For the export choke points (decision D6): the state with every missing copy a placed riff
 * names rebuilt (an export renders nothing from the shelf), repointed only where a rebuild
 * landed under a new name. A copy still missing is left as is: that stem renders silent, as a
 * missing file always has. Returns `state` itself when nothing moved. */
export async function ensureReonedCopiesForState(state: AppState): Promise<AppState> {
  const batches = planReonedRepair(state.rifffs, { placedOnly: true })
  if (batches.length === 0) return state
  const outcomes = await rebuildReonedCopies(batches)
  const { rifffs, missing } = applyReonedRepair(state.rifffs, outcomes)
  if (missing.length > 0) {
    console.error(`ensureReonedCopiesForState: ${missing.length} re-oned copies still missing`)
  }
  return rifffs === state.rifffs ? state : { ...state, rifffs: rifffs as AppState['rifffs'] }
}
