/**
 * The guided flow's state machine -- pure, framework-agnostic, and the only
 * thing that decides where sssketchy is and what he is saying. The panel,
 * the sprite and the checklist are thin renderers over this (spec: "All step
 * transitions, suggestion tables and completion checks are pure functions
 * with tests; the panel/sprite is a thin renderer").
 *
 * Two shapes here are deliberate and worth reading before changing:
 *
 * **Time is injected, always.** Every transition and every getter takes
 * `now: number`. Nothing in this file calls Date.now(). That is what lets
 * the reducer's own tests (state/store.test.ts) pin a timestamp, and it is
 * why every coach Action carries a `now` field.
 *
 * **Elapsed time is an accumulator plus one open span.** `stepElapsedMs` and
 * `phaseElapsedMs` hold time already BANKED, and `runningSince` is the start
 * of the currently-open span, or null when the clock is stopped. Storing an
 * accumulator rather than a start timestamp is what makes the numbers
 * survive being saved to disk and reopened a week later: on load the open
 * span is simply dropped (sanitiseLoadedCoach) instead of turning into seven
 * days of "time on this step" and firing the stuck nudge instantly.
 */

import {
  COACH_STEPS,
  FIRST_COACH_STEP_ID,
  coachStepById,
  isCoachStepId,
  nextCoachStepId,
  type CoachPhase,
  type CoachStepId
} from './coachSteps'

/** 'active' shows the bubble; 'minimised' shows only the corner sprite (the
 * clock keeps running -- you are still on this step, just not looking at
 * him); 'dismissed' hides him entirely and stops the clock, resumable from
 * the project-menu button; 'finished' is the terminal state after the last
 * step. */
export type CoachStatus = 'active' | 'minimised' | 'dismissed' | 'finished'

/** How a step was left. Both are first-class: "next/skip always available"
 * (spec), and a skipped step is not a failure, just a step you did your own
 * way. */
export type CoachOutcome = 'done' | 'skipped'

export interface CoachState {
  status: CoachStatus
  stepId: CoachStepId
  /** step id -> how it was left. A plain Record (not a pair of arrays) so a
   * later phase plan adding steps needs no migration: an id that is not a
   * key simply has not been reached. */
  outcomes: Record<string, CoachOutcome>
  /** Time BANKED per phase, excluding the currently-open span. */
  phaseElapsedMs: Record<CoachPhase, number>
  /** Time BANKED on the current step, excluding the currently-open span. */
  stepElapsedMs: number
  /** Start of the currently-open span, or null when the clock is stopped. */
  runningSince: number | null
  /** Which variant of the current step's lines to show. Bumped once per
   * transition -- see ./coachLines.ts for why this is not Math.random. */
  lineSeed: number
}

/** The spec's "after ~10 minutes on one step, a quiet nudge". Never blocks,
 * never auto-advances. */
export const COACH_STUCK_AFTER_MS = 10 * 60 * 1000

function emptyPhaseElapsed(): Record<CoachPhase, number> {
  return { loop: 0, arrangement: 0, polish: 0 }
}

export function startCoach(now: number): CoachState {
  return {
    status: 'active',
    stepId: FIRST_COACH_STEP_ID,
    outcomes: {},
    phaseElapsedMs: emptyPhaseElapsed(),
    stepElapsedMs: 0,
    runningSince: now,
    lineSeed: 0
  }
}

/** Banks the currently-open span and stops the clock. Idempotent: a flow
 * whose clock is already stopped comes back unchanged. */
export function pauseCoach(state: CoachState, now: number): CoachState {
  if (state.runningSince === null) return state
  const span = Math.max(0, now - state.runningSince)
  const phase = coachStepById(state.stepId)?.phase ?? COACH_STEPS[0].phase
  return {
    ...state,
    stepElapsedMs: state.stepElapsedMs + span,
    phaseElapsedMs: { ...state.phaseElapsedMs, [phase]: state.phaseElapsedMs[phase] + span },
    runningSince: null
  }
}

/** The project-menu button's "resume a half-finished flow". Restarts the
 * clock only if it was stopped, so pressing the button while he is already
 * on screen is harmless. A finished flow has nothing to resume. */
export function resumeCoach(state: CoachState, now: number): CoachState {
  if (state.status === 'finished') return state
  return { ...state, status: 'active', runningSince: state.runningSince ?? now }
}

/** next (outcome 'done') and skip (outcome 'skipped') are the same
 * transition with a different record of how it happened -- the flow must
 * never treat skipping as an error path. */
export function advanceCoach(state: CoachState, now: number, outcome: CoachOutcome): CoachState {
  const banked = pauseCoach(state, now)
  const outcomes = { ...banked.outcomes, [banked.stepId]: outcome }
  const nextId = nextCoachStepId(banked.stepId)
  if (nextId === null) {
    return {
      ...banked,
      outcomes,
      status: 'finished',
      stepElapsedMs: 0,
      lineSeed: banked.lineSeed + 1
    }
  }
  return {
    ...banked,
    outcomes,
    stepId: nextId,
    stepElapsedMs: 0,
    runningSince: now,
    lineSeed: banked.lineSeed + 1
  }
}

/** Takes no `now`: minimising does not move the clock. You are still on this
 * step, he is just out of the way. */
export function minimiseCoach(state: CoachState): CoachState {
  return state.status === 'active' ? { ...state, status: 'minimised' } : state
}

/** The minimised sprite's way back to the bubble. Deliberately narrow --
 * bringing back a DISMISSED flow is resumeCoach, which is what the
 * project-menu button calls. */
export function restoreCoach(state: CoachState, now: number): CoachState {
  if (state.status !== 'minimised') return state
  return { ...state, status: 'active', runningSince: state.runningSince ?? now }
}

/** "he can be... dismissed (which ends the guided flow, resumable later)"
 * (spec). Everything about where you were is kept; only the clock and his
 * presence stop. */
export function dismissCoach(state: CoachState, now: number): CoachState {
  if (state.status === 'dismissed' || state.status === 'finished') return state
  return { ...pauseCoach(state, now), status: 'dismissed' }
}

/** Exported so ./coach.ts's own consumers can validate a persisted id
 * without importing two modules. */
export { isCoachStepId }
