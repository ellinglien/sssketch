import type { Rifff } from '@shared/types'
import { stemKey } from '@shared/types'
import { nextPhaseBars, reoneJob, type ReoneBakeJob } from '@shared/reonedRotation'

export interface CrossBakeResult {
  path: string
  bakedPath: string
  durationSec: number
}

/** Makes runtime Re-1 offsets physical for a Cross draft without changing
 * either parent riff in the open project. Cross has no runtime `off` map of
 * its own, so passing the original paths through would silently discard the
 * phase the musician is hearing in Sketch. Discover's seed from a project
 * riff uses it for the same reason: the bake is rendered but never adopted
 * into the project (no APPLY_BAKE), so neither opening leaves it unsaved. */
export async function rifffForSketchCross(
  rifff: Rifff,
  off: Readonly<Record<string, number>>,
  snapDiv: number,
  bakeOffset: (jobs: ReoneBakeJob[]) => Promise<CrossBakeResult[]>
): Promise<Rifff | null> {
  const groupSteps = off[rifff.groupId] ?? 0
  const steps = rifff.stems.map((stem) => off[stemKey(rifff.groupId, stem.slot)] ?? groupSteps)
  if (steps.every((value) => value === 0)) return rifff

  // Each job carries its recipe (the original at the total phase), so a riff auditioned again
  // at the same phase reuses the copies the last audition made instead of writing new ones.
  const results = await bakeOffset(
    rifff.stems.map((stem, index) => reoneJob(stem, steps[index], snapDiv))
  )
  // Each stem takes the result for its own path rather than trusting positions (the baker
  // used to return WAV stems before LORE ones). A path two stems share is handed out in
  // order, the order its jobs were sent in.
  const byPath = new Map<string, CrossBakeResult[]>()
  for (const result of results) {
    const queue = byPath.get(result.path) ?? []
    queue.push(result)
    byPath.set(result.path, queue)
  }
  const matched = rifff.stems.map((stem) => byPath.get(stem.path)?.shift())
  if (results.length !== rifff.stems.length || matched.some((result) => result === undefined)) {
    return null
  }

  return {
    ...rifff,
    stems: rifff.stems.map((stem, index) => ({
      ...stem,
      path: matched[index]!.bakedPath,
      durationSec: matched[index]!.durationSec,
      phaseSourcePath: stem.phaseSourcePath ?? stem.path,
      phaseBars: nextPhaseBars(stem, steps[index], snapDiv)
    }))
  }
}
