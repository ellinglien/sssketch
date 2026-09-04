import type { StemFrequency } from './stemRole'

export type ArrangeMoveType = 'enter' | 'exit' | 'fill'

// The five-phase guided arc a build progresses through, replacing the old
// binary peakReached. Phases only ever move FORWARD through PHASE_ORDER --
// there's no looping back, and no manual skip for v1 (see the design spec's
// own Non-goals).
export type ArrangePhase = 'intro' | 'build' | 'peak' | 'breakdown' | 'outro'

export const PHASE_ORDER: ArrangePhase[] = ['intro', 'build', 'peak', 'breakdown', 'outro']

// How many "next step" advances (advancePhase calls) to spend in each phase
// before automatically rolling to the next one -- hardcoded defaults for v1,
// kept here as the one place to look when tuning (same convention as
// ENTER_SPARSITY_WEIGHT etc. below).
export const PHASE_STEP_TARGETS: Record<ArrangePhase, number> = {
  intro: 2,
  build: 3,
  peak: 2,
  breakdown: 2,
  outro: 1
}

// Which move types computeCandidates may propose in each phase. 'peak'
// deliberately allows ONLY 'fill' -- peak should hold, not keep growing
// (build's job) or start shrinking (breakdown's job); a fill can still
// flicker something in briefly without changing the held-steady layer.
//
// Re-entry (a previously-exited, frequency-eligible stem becoming an
// 'enter' candidate again) is NOT gated by this table the same way a fresh
// entry is -- see computeCandidates below. Gating it by 'enter' membership
// would make re-entry structurally impossible (phases only move forward,
// and 'exit' only becomes allowed in phases that come after every phase
// permitting 'enter'), silently turning the whole frequency/re-entry
// feature into dead code. Re-entry is instead gated by 'exit' membership --
// allowed exactly where fresh exits are also happening.
export const PHASE_MOVE_TYPES: Record<ArrangePhase, ArrangeMoveType[]> = {
  intro: ['enter'],
  build: ['enter', 'fill'],
  peak: ['fill'],
  breakdown: ['exit'],
  outro: ['exit']
}

// Below this many included stems, the full five-phase arc has too little
// material to say much -- AutoArrangeBuildStep.tsx uses this for its own
// advisory (non-blocking) warning.
export const MIN_STEMS_FOR_FULL_ARC = 4

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
  phase: ArrangePhase
  // How many advancePhase calls have happened since the CURRENT phase
  // started -- resets to 0 whenever advancePhase rolls to a new phase.
  stepsInPhase: number
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

// Enter-candidate weighting: how much a stem's own sparsity vs. its role's
// under-representation among active stems should drive the pick. A first
// pass, expected to be retuned after a real manual walkthrough -- keep these
// as the one place to look when tuning.
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
  const allowed = PHASE_MOVE_TYPES[buildState.phase]

  if (allowed.includes('enter')) {
    // Fresh entries only -- a stem that has never exited. Re-entry (below)
    // is gated separately, on 'exit' permission, not 'enter'.
    for (const stem of candidateStems) {
      if (buildState.activeStemKeys.includes(stem.stemKey)) continue
      if (buildState.lastExitStep[stem.stemKey] !== undefined) continue
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
  }

  if (allowed.includes('exit')) {
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
      // cooldown since that exit. Gated by 'exit' membership (this same
      // `if`), not 'enter' membership -- see PHASE_MOVE_TYPES's own doc
      // comment for why.
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

  if (allowed.includes('fill')) {
    const fill = bestFillCandidate(candidateStems, buildState.activeStemKeys)
    if (fill) candidates.push(fill)
  }

  return candidates
}

export function advanceBuildState(
  buildState: ArrangeBuildState,
  _stems: ArrangeStemInput[],
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
  // handled entirely at the apply-to-timeline stage.

  return { ...buildState, activeStemKeys, lastExitStep }
}

// Advances the build by one step: bumps stepsInPhase, and rolls to the next
// PHASE_ORDER entry (resetting stepsInPhase to 0) once the current phase's
// PHASE_STEP_TARGETS has been reached. Once already at the last phase
// ('outro'), further calls just keep incrementing stepsInPhase with no
// further transition -- the build's real end condition is
// isArrangementComplete, not running out of phases. Pure, no other
// arguments needed: phase targets are fixed constants, not stem-count- or
// stepIndex-dependent.
export function advancePhase(buildState: ArrangeBuildState): ArrangeBuildState {
  const nextStepsInPhase = buildState.stepsInPhase + 1
  const currentIndex = PHASE_ORDER.indexOf(buildState.phase)
  const isLastPhase = currentIndex === PHASE_ORDER.length - 1
  if (!isLastPhase && nextStepsInPhase >= PHASE_STEP_TARGETS[buildState.phase]) {
    return { ...buildState, phase: PHASE_ORDER[currentIndex + 1], stepsInPhase: 0 }
  }
  return { ...buildState, stepsInPhase: nextStepsInPhase }
}

export function isArrangementComplete(buildState: ArrangeBuildState): boolean {
  return buildState.phase === 'outro' && buildState.activeStemKeys.length === 0
}
