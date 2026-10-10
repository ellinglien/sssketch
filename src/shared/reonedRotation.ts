// How a re-one's bars become a rotation in seconds, the job each re-one sends to the baker, and
// the rotations a rebuild of a missing re-oned copy may have been made with. See
// docs/superpowers/specs/2026-10-09-reoned-copies-cleanup-design.md.
import type { Stem } from './types'

/** Where `bars` (clockwise, unwrapped, as phaseBars accumulates) lands inside the stem's own
 * loop, in seconds. The one formula: selectors.ts's rotationSecondsForStem delegates here. */
export function rotationSecForBars(
  bars: number,
  stem: Pick<Stem, 'barLength' | 'durationSec'>
): number {
  const wrapped = ((bars % stem.barLength) + stem.barLength) % stem.barLength
  return wrapped * (stem.durationSec / stem.barLength)
}

const isCopyPath = (path: string): boolean => path.toLowerCase().endsWith('.baked.wav')

/** Where the stem's audio really comes from, and how far it is rotated from there. The saved
 * lineage counts only while `path` is a re-oned copy: anything else that replaced the file (a
 * stretched one-shot's render, say) is a new original, so a stale lineage left on it would bake
 * the old audio with the new length. Then the lineage restarts at the stem's own file. */
export function phaseLineage(stem: Pick<Stem, 'path' | 'phaseSourcePath' | 'phaseBars'>): {
  sourcePath: string
  bars: number
} {
  if (stem.phaseSourcePath !== undefined && isCopyPath(stem.path)) {
    return { sourcePath: stem.phaseSourcePath, bars: stem.phaseBars ?? 0 }
  }
  return { sourcePath: stem.path, bars: 0 }
}

/** The stem's total rotation after a re-one by `steps` at `snapDiv`, in bars, unwrapped. */
export function nextPhaseBars(
  stem: Pick<Stem, 'path' | 'phaseSourcePath' | 'phaseBars'>,
  steps: number,
  snapDiv: number
): number {
  return phaseLineage(stem).bars - steps / snapDiv
}

export interface ReoneBakeJob {
  /** The stem's current file. Results come back keyed by it (APPLY_BAKE matches on it). */
  path: string
  /** This step's rotation of `path`: what the baker falls back to if the original is away. */
  rotationSec: number
  /** Bake from the original by the total instead, so the copy is named, reused and rebuilt by
   * its recipe. Absent when `path` is the original. */
  recipe?: { sourcePath: string; rotationSec: number }
}

/** The job every re-one, re-bake, Cross parent and Discover seed sends to bakeOffset. */
export function reoneJob(stem: Stem, steps: number, snapDiv: number): ReoneBakeJob {
  const job = { path: stem.path, rotationSec: rotationSecForBars(-steps / snapDiv, stem) }
  const { sourcePath } = phaseLineage(stem)
  if (sourcePath === stem.path) return job
  return {
    ...job,
    recipe: {
      sourcePath,
      rotationSec: rotationSecForBars(nextPhaseBars(stem, steps, snapDiv), stem)
    }
  }
}

/** Whether a stem at `stemBars` (its lineage) sounds at `bars`: the same place within its own
 * loop. 1 bar and 5 bars are one phase for a 4-bar stem, and any whole bar is no rotation at all
 * for a 1-bar stem. */
function sitsAt(stemBars: number, bars: number, barLength: number): boolean {
  if (!(barLength > 0)) return Math.abs(stemBars - bars) < PHASE_EPSILON_BARS
  const apart = (((bars - stemBars) % barLength) + barLength) % barLength
  return apart < PHASE_EPSILON_BARS || barLength - apart < PHASE_EPSILON_BARS
}

const PHASE_EPSILON_BARS = 1e-6

/** The rotation a riff's stems share, in bars from their originals (unwrapped, as phaseBars
 * accumulates), or null when that is no rotation. A stem that joins the riff later (a stem that
 * finished downloading after a re-one) is baked to this, so the riff stays at one phase.
 *
 * Each rotation a stem carries is scored by the stems that sound at it, compared within each
 * stem's own loop: a stem left as it is because the rotation wraps to nothing for it (a 1-bar
 * stem in a riff re-oned by whole bars has no copy and no lineage) agrees with that rotation
 * rather than outvoting it. The best score wins; a tie goes to a rotation some copy carries over
 * none (an unrotated stem in a re-oned riff is the one that missed it), then to the earlier
 * stem. Stems that disagree only come from per-stem offsets or a 1.5.0-era partial bake, and
 * get one console line. */
export function sharedPhaseBars(
  stems: readonly Pick<Stem, 'path' | 'phaseSourcePath' | 'phaseBars' | 'barLength'>[]
): number | null {
  const lineages = stems.map((stem) => ({ bars: phaseLineage(stem).bars, loop: stem.barLength }))
  let best: { bars: number; score: number; carried: boolean } | null = null
  const seen: number[] = []
  for (const { bars } of lineages) {
    if (seen.some((other) => Math.abs(other - bars) < PHASE_EPSILON_BARS)) continue
    seen.push(bars)
    const score = lineages.filter((stem) => sitsAt(stem.bars, bars, stem.loop)).length
    const carried = bars !== 0
    if (best === null || score > best.score || (score === best.score && carried && !best.carried)) {
      best = { bars, score, carried }
    }
  }
  if (best === null) return null
  if (best.score < lineages.length) {
    console.warn(
      `sharedPhaseBars: stems disagree on the riff's rotation (${lineages
        .map((stem) => stem.bars)
        .join(', ')} bars); taking ${best.bars}`
    )
  }
  return best.bars === 0 ? null : best.bars
}

/** The job that bakes `stem` to `bars` in total from its original: the same shape as reoneJob,
 * for a target rotation rather than a step. A raw stem's job rotates its own file, which main
 * names by that recipe; a re-oned stem's job carries the recipe from its original at the total.
 * So a stem baked to a phase some other riff or audition already made reuses that copy. */
export function bakeToPhaseJob(stem: Stem, bars: number): ReoneBakeJob {
  const lineage = phaseLineage(stem)
  const job = { path: stem.path, rotationSec: rotationSecForBars(bars - lineage.bars, stem) }
  if (lineage.sourcePath === stem.path) return job
  return {
    ...job,
    recipe: { sourcePath: lineage.sourcePath, rotationSec: rotationSecForBars(bars, stem) }
  }
}

/** Each path's own bake result, in `paths` order. Results don't come back in job order (WAVs
 * render before LORE stems), so they are matched by path; a path several jobs share is handed
 * its results in the order those jobs were sent. null unless every path has exactly one result:
 * a bake is all or nothing. */
export function matchBakeResults<T extends { path: string }>(
  paths: readonly string[],
  results: readonly T[]
): T[] | null {
  if (results.length !== paths.length) return null
  const byPath = new Map<string, T[]>()
  for (const result of results) {
    const queue = byPath.get(result.path) ?? []
    queue.push(result)
    byPath.set(result.path, queue)
  }
  const matched: T[] = []
  for (const path of paths) {
    const result = byPath.get(path)?.shift()
    if (result === undefined) return null
    matched.push(result)
  }
  return matched
}

/** The rotations a rebuild of a missing copy may have been made with, most likely first
 * (decision D5 in the plan): from the stem's current durationSec, then from LORE metadata
 * (barLength × 60/bpm × 4, how riffLibraryStore/endlesssApi set durationSec before APPLY_BAKE
 * replaced it with the measured length). Main keeps the one whose recipe name matches the
 * missing file. The riff's bpm stands in for the stem's own here; main swaps in the stem's
 * own LORE bpm when its library knows the stem (reonedRebuild.ts). */
export function rebuildRotationCandidates(
  stem: Pick<Stem, 'phaseBars' | 'barLength' | 'durationSec'>,
  rifffBpm: number
): number[] {
  const bars = stem.phaseBars ?? 0
  const candidates = [rotationSecForBars(bars, stem)]
  if (rifffBpm > 0) {
    const metadataDuration = stem.barLength * (60 / rifffBpm) * 4
    candidates.push(
      rotationSecForBars(bars, { barLength: stem.barLength, durationSec: metadataDuration })
    )
  }
  return candidates.filter((c, i) => Number.isFinite(c) && candidates.indexOf(c) === i)
}
