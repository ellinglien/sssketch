import {
  advanceBuildState,
  advancePhase,
  isArrangementComplete,
  type ArrangeBuildState,
  type ArrangeCandidate,
  type ArrangeStemInput
} from './autoArrangeEngine'
import type { ArrangeMoveRecord } from './autoArrangeApply'

export const MAX_CANDIDATES_SHOWN = 3
// Safety cap so a pathological weighting (or a single included stem that can
// never reach outro) can't loop forever.
export const MAX_BUILD_STEPS = 64

export interface ApplyCandidateResult {
  moves: ArrangeMoveRecord[]
  buildState: ArrangeBuildState
  complete: boolean
}

// Applies one chosen candidate WITHOUT advancing the step -- appends its
// move record (stamped with the CURRENT stepIndex) and advances buildState
// via the engine, but leaves stepIndex/phase alone. Multi-move-per-step: the
// caller can apply several candidates in a row at the same stepIndex before
// calling advanceToNextStep below, since computeCandidates recomputes fresh
// against the updated buildState each time. Completion can still happen
// mid-step -- e.g. the last exit during 'outro' brings the active set to
// zero -- so isArrangementComplete is still checked here, not only in
// advanceToNextStep.
export function applyCandidate(
  moves: ArrangeMoveRecord[],
  buildState: ArrangeBuildState,
  stems: ArrangeStemInput[],
  stepIndex: number,
  candidate: ArrangeCandidate
): ApplyCandidateResult {
  const nextMoves: ArrangeMoveRecord[] = [
    ...moves,
    { stepIndex, stemKey: candidate.stemKey, moveType: candidate.moveType }
  ]
  const nextState = advanceBuildState(buildState, stems, candidate, stepIndex)
  return { moves: nextMoves, buildState: nextState, complete: isArrangementComplete(nextState) }
}

export interface AdvanceStepResult {
  buildState: ArrangeBuildState
  stepIndex: number
  complete: boolean
}

// Advances to the next step: bumps stepIndex, calls the engine's
// advancePhase (which may roll to the next phase once its own target is
// reached), and checks completion -- either the natural
// isArrangementComplete end, or MAX_BUILD_STEPS as a safety net (moved here
// from the old combined applyBuildStep, since stepIndex only ever changes
// via this function now).
export function advanceToNextStep(
  buildState: ArrangeBuildState,
  stepIndex: number
): AdvanceStepResult {
  const nextStepIndex = stepIndex + 1
  const nextState = advancePhase(buildState)
  const complete = isArrangementComplete(nextState) || nextStepIndex >= MAX_BUILD_STEPS
  return { buildState: nextState, stepIndex: nextStepIndex, complete }
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
