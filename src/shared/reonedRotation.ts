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

/** The rotations a rebuild of a missing copy may have been made with, most likely first
 * (decision D5 in the plan): from the stem's current durationSec, then from LORE metadata
 * (barLength × 60/bpm × 4, how riffLibraryStore/endlesssApi set durationSec before APPLY_BAKE
 * replaced it with the measured length). Main keeps the one whose recipe name matches the
 * missing file. */
export function rebuildRotationCandidates(stem: Stem, rifffBpm: number): number[] {
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
