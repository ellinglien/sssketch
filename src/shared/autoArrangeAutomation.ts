import type { ArrangeBuildState, ArrangePhase, ArrangeStemInput } from './autoArrangeEngine'

export type ArrangeShape = 'buildUp' | 'stayBusy' | 'startFull'

// Relative weights per shape, only for the phases that shape actually uses
// -- phaseStepTargetsForShape turns these into real per-phase step counts
// once a target length is known (scaleToTarget below). 'startFull' omits
// intro/build/peak entirely -- see initialBuildStateForShape's own doc
// comment for why those three would never produce a real move anyway when
// everything starts already active, so giving them a token weight would
// just steal budget from breakdown/outro's actual thinning-out work.
// Illustrative first-pass numbers for stayBusy/startFull, in the same
// "tune after a real walkthrough" spirit as this file's neighbor
// autoArrangeEngine.ts's own ENTER_SPARSITY_WEIGHT-style constants.
const SHAPE_PHASE_WEIGHTS: Record<ArrangeShape, Partial<Record<ArrangePhase, number>>> = {
  buildUp: { intro: 2, build: 3, peak: 2, breakdown: 2, outro: 1 },
  stayBusy: { intro: 1, build: 4, peak: 3, breakdown: 1, outro: 1 },
  startFull: { breakdown: 3, outro: 2 }
}

// The fewest sections a shape can be asked to build -- one per phase it
// actually uses, since scaleToTarget's own minimum-1-per-phase floor can't
// be satisfied below that. UI callers use this to clamp their own length
// control's minimum whenever the selected shape changes.
export function minSectionsForShape(shape: ArrangeShape): number {
  return Object.keys(SHAPE_PHASE_WEIGHTS[shape]).length
}

// Scales `weights` (relative proportions for the phases in `phases`, same
// order) to whole numbers summing to exactly `targetTotal`, with a floor of
// 1 per phase -- "largest remainder" apportionment, the same well-known,
// deterministic method used for proportional seat allocation: floor each
// phase's raw share (never below 1), then hand out (or claw back) whatever
// whole-number remainder is left, one at a time, to the phases with the
// largest fractional share first. Callers must ensure
// `targetTotal >= phases.length` (minSectionsForShape's own job) -- below
// that there's no way to keep every phase at its floor of 1, and this
// function does not guard against it.
function scaleToTarget(phases: ArrangePhase[], weights: number[], targetTotal: number): number[] {
  const totalWeight = weights.reduce((a, b) => a + b, 0)
  const raw = weights.map((w) => (w / totalWeight) * targetTotal)
  const floors = raw.map((r) => Math.max(1, Math.floor(r)))
  const byFractionDesc = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac)

  let remainder = targetTotal - floors.reduce((a, b) => a + b, 0)
  let cursor = 0
  while (remainder > 0) {
    floors[byFractionDesc[cursor % byFractionDesc.length].i]++
    remainder--
    cursor++
  }
  cursor = 0
  while (remainder < 0) {
    const i = byFractionDesc[byFractionDesc.length - 1 - (cursor % byFractionDesc.length)].i
    if (floors[i] > 1) {
      floors[i]--
      remainder++
    }
    cursor++
  }
  return floors
}

// Real per-phase step counts for `shape`, scaled to `targetSections` total.
// Always a full 5-key record (advancePhase's own Record<ArrangePhase,
// number> parameter type requires it) -- a phase this shape doesn't use
// gets 0, which is never actually read: advancePhase only ever consults
// the CURRENT phase's own target, and phase order only ever moves forward
// from wherever initialBuildStateForShape started it, so an earlier,
// unused phase's target is structurally unreachable, not just
// conventionally ignored.
export function phaseStepTargetsForShape(
  shape: ArrangeShape,
  targetSections: number
): Record<ArrangePhase, number> {
  const weights = SHAPE_PHASE_WEIGHTS[shape]
  const phases = Object.keys(weights) as ArrangePhase[]
  const scaled = scaleToTarget(
    phases,
    phases.map((p) => weights[p]!),
    targetSections
  )
  const targets: Record<ArrangePhase, number> = {
    intro: 0,
    build: 0,
    peak: 0,
    breakdown: 0,
    outro: 0
  }
  phases.forEach((p, i) => {
    targets[p] = scaled[i]
  })
  return targets
}

// Where a build for `shape` starts. 'startFull' seeds every included stem
// as already active and starts directly at 'breakdown' -- 'intro'/'build'
// only ever offer 'enter' candidates (nothing to enter, everything's
// already active), and 'peak's only candidate source (bestFillCandidate,
// autoArrangeEngine.ts) explicitly returns null once there's no inactive
// stem left to fill from -- so all three would produce zero real moves
// regardless, and starting past them spends the whole requested length on
// breakdown/outro's actual thinning-out instead of silently wasting
// sections on nothing. PHASE_ORDER traversal itself is completely
// untouched (advancePhase only ever walks forward from wherever it's
// told to start) -- this needs no engine changes beyond the optional
// phaseStepTargets parameter already added to advancePhase.
export function initialBuildStateForShape(
  shape: ArrangeShape,
  stems: ArrangeStemInput[]
): ArrangeBuildState {
  if (shape === 'startFull') {
    return {
      activeStemKeys: stems.filter((s) => s.included).map((s) => s.stemKey),
      phase: 'breakdown',
      stepsInPhase: 0,
      lastExitStep: {}
    }
  }
  return { activeStemKeys: [], phase: 'intro', stepsInPhase: 0, lastExitStep: {} }
}
