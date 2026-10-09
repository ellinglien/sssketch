// The rotation a Discover seed carries, for the candidates that share its clock. A riff re-oned
// in the project seeds Discover with its re-oned copies; a candidate rolled from the same jam
// comes from the library at its raw Endlesss phase, so it played out of phase with the seed's
// own jam-mates (the 2026-10-08 call triage, B1 path 1). Riffs of one jam share a clock phase
// (the batch import re-ones them together on that basis), so a candidate from the seed's jam is
// baked by the seed's rotation. A candidate from any other jam has no phase relation to the seed
// at all, and stays as it is.
//
// "Jam" means the same thing on both sides: the riff index's (src/main/stemJams.ts), the jam of
// the riff a stem is mapped to, which is what every candidate's jamCID carries. Only real jams
// count: the discovered room and the Shared Feed's jams collect stems from many jams, with no
// clock between them (isClockJam).
import { DISCOVERED_JAM_CID } from './discoveredRoom'
import { phaseLineage, sharedPhaseBars } from './reonedRotation'
import type { Stem } from './types'

export interface DiscoverSeedPhase {
  /** The seed's rotation (bars from the originals, as phaseBars) per jam its stems come from. */
  byJam: Record<string, number>
  /** Each seed stem's own rotation, by the StemCID of its original: a candidate that is one of
   * the seed's own stems (from another riff of the jam) takes exactly that. */
  byStem: Record<string, number>
  /** The names of the jams in byJam (Jams.PublicName), for the line that says a candidate from
   * one couldn't be lined up. A jam missing here is named generically. */
  jamNames: Record<string, string>
}

/** Whether `jamCID` is a real jam, whose riffs share one clock. The discovered room holds kept
 * groups, collages of many jams' stems (a kept aligned candidate is a new StemCID whose audio is
 * already rotated, so rotating it again doubles the rotation); a Shared Feed jam (`shared:`)
 * holds riffs posted from many jams. */
export function isClockJam(jamCID: string): boolean {
  return jamCID !== DISCOVERED_JAM_CID && !jamCID.startsWith('shared:')
}

type SeedStem = Pick<Stem, 'path' | 'phaseSourcePath' | 'phaseBars' | 'barLength'>

/** The library StemCID an original's file is named after (no extension), or null. */
function stemCIDOf(path: string): string | null {
  const name = path.slice(path.lastIndexOf('/') + 1)
  return name.length > 0 && !name.includes('.') ? name : null
}

/** `jamOfPath`: each seed original's jam (riffLibraryStemJams), keyed by the original's path;
 * `jamNames` names them. null when no seed stem is rotated: its jam-mates are already at its
 * phase. */
export function discoverSeedPhase(
  stems: readonly SeedStem[],
  jamOfPath: Readonly<Record<string, string>>,
  jamNames: Readonly<Record<string, string>> = {}
): DiscoverSeedPhase | null {
  if (stems.every((stem) => phaseLineage(stem).bars === 0)) return null
  const byStem: Record<string, number> = {}
  const stemsByJam = new Map<string, SeedStem[]>()
  for (const stem of stems) {
    const { sourcePath, bars } = phaseLineage(stem)
    const stemCID = stemCIDOf(sourcePath)
    if (stemCID !== null) byStem[stemCID] = bars
    const jam = jamOfPath[sourcePath]
    if (jam !== undefined && isClockJam(jam))
      stemsByJam.set(jam, [...(stemsByJam.get(jam) ?? []), stem])
  }
  const byJam: Record<string, number> = {}
  const names: Record<string, string> = {}
  for (const [jam, jamStems] of stemsByJam) {
    const bars = sharedPhaseBars(jamStems)
    if (bars === null) continue
    byJam[jam] = bars
    if (jamNames[jam] !== undefined) names[jam] = jamNames[jam]
  }
  return { byJam, byStem, jamNames: names }
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

/** The seed phase while it still describes something in Discover: a row holding one of the
 * seed's stems (`seedStem`). Once every seed row is removed or rerolled, nothing heard carries
 * the seed's rotation, and candidates from its jam come in at their own phase again; undo brings
 * a seed row back, and the phase with it. Not reset when a project opens: Discover's rows,
 * the seed's among them, stay through an open, and a phase dropped under them would put the
 * next candidates from the seed's jam out of phase with them. */
export function activeSeedPhase(
  phase: DiscoverSeedPhase | null,
  rows: readonly { seedStem?: unknown }[]
): DiscoverSeedPhase | null {
  return phase !== null && rows.some((row) => row.seedStem !== undefined) ? phase : null
}
