// The rotation a Discover seed carries, for the candidates that share its clock. A riff re-oned
// in the project seeds Discover with its re-oned copies; a candidate rolled from the same jam
// comes from the library at its raw Endlesss phase, so it played out of phase with the seed's
// own jam-mates (the 2026-10-08 call triage, B1 path 1). Riffs of one jam share a clock phase
// (the batch import re-ones them together on that basis), so a candidate from the seed's jam is
// baked by the seed's rotation. A candidate from any other jam has no phase relation to the seed
// at all, and stays as it is.
import { phaseLineage, sharedPhaseBars } from './reonedRotation'
import type { Stem } from './types'

export interface DiscoverSeedPhase {
  /** The seed's rotation (bars from the originals, as phaseBars) per jam its stems come from. */
  byJam: Record<string, number>
  /** Each seed stem's own rotation, by the StemCID of its original: a candidate that is one of
   * the seed's own stems (from another riff of the jam) takes exactly that. */
  byStem: Record<string, number>
}

type SeedStem = Pick<Stem, 'path' | 'phaseSourcePath' | 'phaseBars'>

/** The library StemCID an original's file is named after (no extension), or null. */
function stemCIDOf(path: string): string | null {
  const name = path.slice(path.lastIndexOf('/') + 1)
  return name.length > 0 && !name.includes('.') ? name : null
}

/** `jamOfPath`: each seed original's jam (riffLibraryStemJams), keyed by the original's path. null
 * when no seed stem is rotated: its jam-mates are already at its phase. */
export function discoverSeedPhase(
  stems: readonly SeedStem[],
  jamOfPath: Readonly<Record<string, string>>
): DiscoverSeedPhase | null {
  if (stems.every((stem) => phaseLineage(stem).bars === 0)) return null
  const byStem: Record<string, number> = {}
  const stemsByJam = new Map<string, SeedStem[]>()
  for (const stem of stems) {
    const { sourcePath, bars } = phaseLineage(stem)
    const stemCID = stemCIDOf(sourcePath)
    if (stemCID !== null) byStem[stemCID] = bars
    const jam = jamOfPath[sourcePath]
    if (jam !== undefined) stemsByJam.set(jam, [...(stemsByJam.get(jam) ?? []), stem])
  }
  const byJam: Record<string, number> = {}
  for (const [jam, jamStems] of stemsByJam) {
    const bars = sharedPhaseBars(jamStems)
    if (bars !== null) byJam[jam] = bars
  }
  return { byJam, byStem }
}

/** The rotation to bake a candidate to, in bars, or null to leave it at its own phase. */
export function candidatePhaseBars(
  phase: DiscoverSeedPhase | null,
  candidate: { stemCID: string; jamCID: string }
): number | null {
  if (phase === null) return null
  const bars = phase.byStem[candidate.stemCID] ?? phase.byJam[candidate.jamCID]
  return bars === undefined || bars === 0 ? null : bars
}
