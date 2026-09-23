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

import { COACH_DONE_LINES, pickLineVariant } from './coachLines'
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

/** Time on the current step: what is banked, plus the open span if the
 * clock is running. */
export function coachStepElapsedMs(state: CoachState, now: number): number {
  const open = state.runningSince === null ? 0 : Math.max(0, now - state.runningSince)
  return state.stepElapsedMs + open
}

/** Time in one phase. The open span counts only against the phase the
 * CURRENT step belongs to -- every other phase's number is already final. */
export function coachPhaseElapsedMs(state: CoachState, phase: CoachPhase, now: number): number {
  const banked = state.phaseElapsedMs[phase] ?? 0
  const currentPhase = coachStepById(state.stepId)?.phase
  const open =
    state.runningSince === null || currentPhase !== phase
      ? 0
      : Math.max(0, now - state.runningSince)
  return banked + open
}

/** Only ever true while he is actually on screen and working a step -- a
 * minimised sprite can still nudge (you are still on the step), a dismissed
 * or finished one cannot. */
export function isCoachStuck(state: CoachState, now: number): boolean {
  if (state.status !== 'active' && state.status !== 'minimised') return false
  return coachStepElapsedMs(state, now) >= COACH_STUCK_AFTER_MS
}

/** The one thought currently on screen. "A new step's text replaces the old
 * one; nothing stacks" (spec) -- which is enforced by this being a single
 * string derived from the single current step, with nowhere for a second
 * one to live. */
export function coachLine(state: CoachState): string {
  const step = coachStepById(state.stepId)
  if (state.status === 'finished' || step === undefined) {
    return pickLineVariant(COACH_DONE_LINES, state.lineSeed)
  }
  return pickLineVariant(step.lines, state.lineSeed)
}

/** The sprite frame sets that exist under
 * src/renderer/src/assets/sssketchy/. The spec's death frames are
 * deliberately not here: "Death frames unused." */
export type SssketchyAnimation = 'idle' | 'walk' | 'jump' | 'hit' | 'climb'

export interface CoachAnimationInput {
  status: CoachStatus
  /** The app is doing work on this step's behalf (building a section,
   * exporting). Always false in the framework build -- nothing here starts
   * work yet; the phase plans pass it for real. */
  working: boolean
  /** The sprite is travelling to a new anchor. */
  moving: boolean
  /** A short window just after a step was completed. */
  justAdvanced: boolean
  stuck: boolean
}

/**
 * The spec's animation table, in precedence order:
 * "idle = bob; walk = moving to another area; jump = step finished, big jump
 * at V1; hit = the 'stuck?' nudge and errors; climb = while the app works".
 *
 * The order matters where two are true at once, and this is the reasoning:
 * `working` wins over everything because it is the only one that reports a
 * fact about the machine rather than about the flow -- showing a walk while
 * a render is running would tell the user nothing is happening. `moving`
 * then wins over `justAdvanced` because a step that finished AND moved him
 * somewhere else is, from the user's point of view, mostly a journey.
 * `stuck` is last: it is the quietest signal and must never interrupt a
 * louder true one.
 */
export function coachAnimation(input: CoachAnimationInput): SssketchyAnimation {
  if (input.status === 'finished') return 'jump'
  if (input.working) return 'climb'
  if (input.moving) return 'walk'
  if (input.justAdvanced) return 'jump'
  if (input.stuck) return 'hit'
  return 'idle'
}

function finiteMs(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0
  return value
}

function loadedOutcomes(value: unknown): Record<string, CoachOutcome> {
  if (typeof value !== 'object' || value === null) return {}
  const out: Record<string, CoachOutcome> = {}
  for (const [id, outcome] of Object.entries(value as Record<string, unknown>)) {
    if (outcome === 'done' || outcome === 'skipped') out[id] = outcome
  }
  return out
}

/**
 * Turns whatever a `.sssketchproj` actually contains into a CoachState the
 * app can run, or null.
 *
 * Two deliberate, load-bearing rules:
 *
 * **A loaded flow is always hidden.** "Button only (Elling's decision) --
 * sssketchy never appears on his own, not even on an empty project." So a
 * flow saved mid-step comes back 'dismissed', and the project-menu button
 * resumes it exactly where it was. 'finished' is left alone: it is terminal
 * and already invisible in the same way.
 *
 * **A loaded flow's clock is always stopped.** `runningSince` is an absolute
 * timestamp from a previous session; keeping it would turn "I closed this
 * last Tuesday" into six days on one step and fire the stuck nudge the
 * instant the project opened. Everything BANKED survives, which is the part
 * that is actually about the user's work.
 *
 * Everything else is repaired rather than trusted, for the same reason
 * serialize.ts's own legacy readers are: a `.sssketchproj` is plain JSON
 * that people can and do hand-edit, and a load must never throw.
 */
export function sanitiseLoadedCoach(coach: unknown): CoachState | null {
  if (typeof coach !== 'object' || coach === null) return null
  const loose = coach as Record<string, unknown>
  const phase = (loose.phaseElapsedMs ?? {}) as Record<string, unknown>
  return {
    status: loose.status === 'finished' ? 'finished' : 'dismissed',
    stepId: isCoachStepId(loose.stepId) ? loose.stepId : FIRST_COACH_STEP_ID,
    outcomes: loadedOutcomes(loose.outcomes),
    phaseElapsedMs: {
      loop: finiteMs(phase.loop),
      arrangement: finiteMs(phase.arrangement),
      polish: finiteMs(phase.polish)
    },
    stepElapsedMs: finiteMs(loose.stepElapsedMs),
    runningSince: null,
    lineSeed:
      typeof loose.lineSeed === 'number' && Number.isFinite(loose.lineSeed)
        ? Math.trunc(loose.lineSeed)
        : 0
  }
}
