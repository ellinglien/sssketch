import type { StemFrequency } from './stemRole'

export type ArrangeMoveType = 'enter' | 'exit' | 'fill'

export interface ArrangeStemInput {
  stemKey: string
  // Opaque grouping key for role diversity -- the ArrangeRole string
  // StemRoleInfo resolved. The engine only compares equality, it doesn't
  // need to know the concrete type.
  role: string
  densityScore: number // 0..1, from computeDensityScore
  fillScore: number // 0..1, from computeFillScore
  included: boolean
  // Re-entry/priority preference -- see StemFrequency's own doc comment.
  frequency: StemFrequency
}

export interface ArrangeBuildState {
  activeStemKeys: string[]
  peakReached: boolean
  // stepIndex at which each stem last exited -- absent for a stem that has
  // never exited (either still active, or never entered at all). Used to
  // gate re-entry eligibility by REENTRY_COOLDOWN_STEPS.
  lastExitStep: Record<string, number>
}

export interface ArrangeCandidate {
  stemKey: string
  moveType: ArrangeMoveType
  weight: number
  reason: string
}

// Once at least this fraction of included stems are active, the arrangement
// switches from building (enter/fill only) to releasing (exit/fill only).
const PEAK_ACTIVE_FRACTION = 0.75

// Enter-candidate weighting: how much a stem's own sparsity vs. its role's
// under-representation among active stems should drive the pick. A first
// pass, expected to be retuned after a real manual walkthrough -- keep these
// (and PEAK_ACTIVE_FRACTION above) as the one place to look when tuning.
const ENTER_SPARSITY_WEIGHT = 0.6
const ENTER_DIVERSITY_WEIGHT = 0.4
// Above this diversity bonus, a stem's role is treated as "not yet
// represented" for the candidate's explanatory reason text -- kept in sync
// with ENTER_DIVERSITY_WEIGHT's meaning, not an independent tuning knob.
const DIVERSITY_NOTABLE_THRESHOLD = 0.5

// Re-entry cooldown (in build steps) before an exited stem becomes eligible
// to enter again -- lower for higher-frequency preferences, so a
// "veryFrequent" stem can cycle back in almost immediately while "occasional"
// waits longer.
export const REENTRY_COOLDOWN_STEPS: Record<Exclude<StemFrequency, 'once'>, number> = {
  occasional: 3,
  frequent: 2,
  veryFrequent: 1
}

// Multiplies a stem's enter-candidate weight (both its FIRST entry and any
// re-entry) -- this is the "priority" half of the frequency preference: among
// two competing stems with similar density/diversity scores, the
// higher-frequency one is favored more often. 'once' is the neutral/current
// baseline.
export const FREQUENCY_WEIGHT_MULTIPLIER: Record<StemFrequency, number> = {
  once: 1.0,
  occasional: 1.2,
  frequent: 1.4,
  veryFrequent: 1.7
}

function includedStems(stems: ArrangeStemInput[]): ArrangeStemInput[] {
  return stems.filter((s) => s.included)
}

function enterWeight(densityScore: number, diversity: number): number {
  return (1 - densityScore) * ENTER_SPARSITY_WEIGHT + diversity * ENTER_DIVERSITY_WEIGHT
}

function roleDiversityBonus(
  role: string,
  activeStemKeys: string[],
  stems: ArrangeStemInput[]
): number {
  if (activeStemKeys.length === 0) return 1
  const activeWithSameRole = activeStemKeys.filter((key) => {
    const s = stems.find((stem) => stem.stemKey === key)
    return s?.role === role
  }).length
  return 1 - activeWithSameRole / activeStemKeys.length
}

function bestFillCandidate(
  candidateStems: ArrangeStemInput[],
  activeStemKeys: string[]
): ArrangeCandidate | null {
  const inactive = candidateStems.filter((s) => !activeStemKeys.includes(s.stemKey))
  if (inactive.length === 0) return null
  const best = inactive.reduce((a, b) => (b.fillScore > a.fillScore ? b : a))
  return {
    stemKey: best.stemKey,
    moveType: 'fill',
    weight: best.fillScore,
    reason: 'bright, transient material -- good fill candidate'
  }
}

export function computeCandidates(
  stems: ArrangeStemInput[],
  buildState: ArrangeBuildState,
  stepIndex: number
): ArrangeCandidate[] {
  const candidateStems = includedStems(stems)
  const candidates: ArrangeCandidate[] = []

  if (!buildState.peakReached) {
    for (const stem of candidateStems) {
      if (buildState.activeStemKeys.includes(stem.stemKey)) continue
      const diversity = roleDiversityBonus(stem.role, buildState.activeStemKeys, stems)
      candidates.push({
        stemKey: stem.stemKey,
        moveType: 'enter',
        weight:
          enterWeight(stem.densityScore, diversity) * FREQUENCY_WEIGHT_MULTIPLIER[stem.frequency],
        reason:
          diversity > DIVERSITY_NOTABLE_THRESHOLD
            ? 'sparse and a role not yet represented'
            : 'sparse -- good early/building material'
      })
    }
  } else {
    for (const stem of candidateStems) {
      if (buildState.activeStemKeys.includes(stem.stemKey)) {
        candidates.push({
          stemKey: stem.stemKey,
          moveType: 'exit',
          weight: stem.densityScore,
          reason: 'dense -- good candidate to thin out first'
        })
        continue
      }

      // Re-entry: an inactive stem that has exited before, has a
      // re-entry-eligible frequency preference, and has cleared its
      // cooldown since that exit.
      if (stem.frequency === 'once') continue
      const lastExit = buildState.lastExitStep[stem.stemKey]
      if (lastExit === undefined) continue
      if (stepIndex - lastExit < REENTRY_COOLDOWN_STEPS[stem.frequency]) continue

      const diversity = roleDiversityBonus(stem.role, buildState.activeStemKeys, stems)
      candidates.push({
        stemKey: stem.stemKey,
        moveType: 'enter',
        weight:
          enterWeight(stem.densityScore, diversity) * FREQUENCY_WEIGHT_MULTIPLIER[stem.frequency],
        reason: `re-entering -- ${stem.frequency} preference`
      })
    }
  }

  const fill = bestFillCandidate(candidateStems, buildState.activeStemKeys)
  if (fill) candidates.push(fill)

  return candidates
}

export function advanceBuildState(
  buildState: ArrangeBuildState,
  stems: ArrangeStemInput[],
  chosen: ArrangeCandidate,
  stepIndex: number
): ArrangeBuildState {
  let activeStemKeys = buildState.activeStemKeys
  let lastExitStep = buildState.lastExitStep
  if (chosen.moveType === 'enter') {
    activeStemKeys = [...activeStemKeys, chosen.stemKey]
  } else if (chosen.moveType === 'exit') {
    activeStemKeys = activeStemKeys.filter((k) => k !== chosen.stemKey)
    lastExitStep = { ...lastExitStep, [chosen.stemKey]: stepIndex }
  }
  // 'fill' does not change the persistent active set -- it's a brief blip,
  // handled entirely at the apply-to-timeline stage (a later task).

  const total = includedStems(stems).length
  const peakReached =
    buildState.peakReached || (total > 0 && activeStemKeys.length / total >= PEAK_ACTIVE_FRACTION)

  return { activeStemKeys, peakReached, lastExitStep }
}

export function isArrangementComplete(buildState: ArrangeBuildState): boolean {
  return buildState.peakReached && buildState.activeStemKeys.length === 0
}
