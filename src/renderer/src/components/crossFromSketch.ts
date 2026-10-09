import type { Rifff } from '@shared/types'
import { stemKey } from '@shared/types'
import { rotationSecondsForStem } from '../state/selectors'

export interface CrossBakeResult {
  path: string
  bakedPath: string
  durationSec: number
}

/** Makes runtime Re-1 offsets physical for a Cross draft without changing
 * either parent riff in the open project. Cross has no runtime `off` map of
 * its own, so passing the original paths through would silently discard the
 * phase the musician is hearing in Sketch. */
export async function rifffForSketchCross(
  rifff: Rifff,
  off: Readonly<Record<string, number>>,
  snapDiv: number,
  bakeOffset: (jobs: { path: string; rotationSec: number }[]) => Promise<CrossBakeResult[]>
): Promise<Rifff | null> {
  const groupSteps = off[rifff.groupId] ?? 0
  const steps = rifff.stems.map((stem) => off[stemKey(rifff.groupId, stem.slot)] ?? groupSteps)
  if (steps.every((value) => value === 0)) return rifff

  const results = await bakeOffset(
    rifff.stems.map((stem, index) => ({
      path: stem.path,
      rotationSec: rotationSecondsForStem(steps[index], snapDiv, stem)
    }))
  )
  if (
    results.length !== rifff.stems.length ||
    results.some((result, index) => result.path !== rifff.stems[index]?.path)
  ) {
    return null
  }

  return {
    ...rifff,
    stems: rifff.stems.map((stem, index) => ({
      ...stem,
      path: results[index].bakedPath,
      durationSec: results[index].durationSec,
      phaseSourcePath: stem.phaseSourcePath ?? stem.path,
      phaseBars: (stem.phaseBars ?? 0) - steps[index] / snapDiv
    }))
  }
}
