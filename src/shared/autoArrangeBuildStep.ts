import {
  advanceBuildState,
  isArrangementComplete,
  type ArrangeBuildState,
  type ArrangeCandidate,
  type ArrangeStemInput
} from './autoArrangeEngine'
import type { ArrangeMoveRecord } from './autoArrangeApply'

export const MAX_CANDIDATES_SHOWN = 3
// Safety cap so a pathological weighting (or a single included stem that can
// never trigger the 75% peak threshold) can't loop forever.
export const MAX_BUILD_STEPS = 64

export interface BuildStepResult {
  moves: ArrangeMoveRecord[]
  buildState: ArrangeBuildState
  complete: boolean
}

// Applies one chosen candidate to an in-progress build: appends its move
// record, advances buildState via the engine, and decides whether the build
// should stop here -- either because isArrangementComplete says the
// build/breakdown arc reached its natural end (peak was reached and every
// stem has since exited), or because MAX_BUILD_STEPS was hit as a safety
// net. Pulled out of AutoArrangeBuildStep.tsx so this stop condition -- a
// real correctness question, since stopping one step early leaves a stem
// stuck active forever and stopping late is a silent no-op past completion
// -- gets real test coverage instead of only being exercised by manually
// clicking through the wizard.
export function applyBuildStep(
  moves: ArrangeMoveRecord[],
  buildState: ArrangeBuildState,
  stems: ArrangeStemInput[],
  stepIndex: number,
  candidate: ArrangeCandidate
): BuildStepResult {
  const nextMoves: ArrangeMoveRecord[] = [
    ...moves,
    { stepIndex, stemKey: candidate.stemKey, moveType: candidate.moveType }
  ]
  const nextState = advanceBuildState(buildState, stems, candidate, stepIndex)
  const complete = isArrangementComplete(nextState) || stepIndex + 1 >= MAX_BUILD_STEPS
  return { moves: nextMoves, buildState: nextState, complete }
}

// Top-N candidates by weight, for capping how many choices the build-step UI
// shows per step. Array.prototype.sort is stable per spec, so equal-weight
// candidates keep computeCandidates' own emission order (enter/exit
// candidates in stem order, with the single fill candidate -- if any -- last)
// rather than shuffling unpredictably between renders.
export function selectTopCandidates(
  candidates: ArrangeCandidate[],
  max: number = MAX_CANDIDATES_SHOWN
): ArrangeCandidate[] {
  return [...candidates].sort((a, b) => b.weight - a.weight).slice(0, max)
}
