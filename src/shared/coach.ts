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

import { COACH_DONE_LINES, COACH_STEP_SATISFIED_LINES, pickLineVariant } from './coachLines'
import {
  COACH_STEPS,
  FIRST_COACH_STEP_ID,
  coachStepById,
  coachStepOrder,
  isCoachStepId,
  nextCoachStepId,
  type CoachPhase,
  type CoachStepId
} from './coachSteps'
import {
  lockClimaxFromSlots,
  sanitiseLockedClimax,
  type CoachSlotSnapshot,
  type LockedClimax
} from './coachClimax'
import {
  sanitiseCoachSectionDraft,
  sanitiseCoachSections,
  type CoachSection,
  type CoachSectionDraft
} from './coachSections'
import { sanitiseCoachTension, type CoachTensionApplied } from './coachTension'
import {
  sanitiseCoachPhrase,
  sanitiseLoopPhraseReading,
  type CoachPhrase,
  type LoopPhraseReading
} from './coachPhrase'
import {
  isCoachLoopAnswer,
  isCoachShapeId,
  type CoachLoopAnswer,
  type CoachShapeId
} from './coachShapes'

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
  /** The frozen climax loop: stems, roles and gains, as the material phase
   * two carves from (spec, phase 1 step 5). null until the lock-in step
   * runs. Real persisted project data, like the rest of this state. */
  lockedClimax: LockedClimax | null
  /** WHAT THE APP MEASURED about the loop's phrase -- reported once,
   * before the map is built, and then left alone. Never the number
   * anything is sized by: that is `phrase` below, which only the user
   * writes. Kept on the flow (rather than recomputed) so the offer
   * survives a reload and he can still change his mind next week.
   *
   * Pinned across undo (history.ts): a measurement of a file on disk is
   * not an arrangement edit, and no undo can un-measure it. */
  phraseReading: LoopPhraseReading | null
  /** THE USER'S ANSWER, and the only number section sizing ever reads.
   * Written by exactly one reducer case (COACH_SET_PHRASE), which is
   * only ever dispatched from a click. Changing it RE-SIZES the map
   * (resizeCoachMapToPhrase) rather than rebuilding it -- names, types
   * and cell edits all survive. */
  phrase: CoachPhrase | null
  /** "What is this loop?" -- drop / verse / intro / not sure. Decides
   * where the material he already has lands in the structure, which is
   * the move that replaced all six of phase one's steps. */
  loopIs: CoachLoopAnswer | null
  /** "How long a journey?" -- short / standard / long. */
  shape: CoachShapeId | null
  /** The map's sections, in timeline order -- what each one is, how many
   * passes it runs for, and which cells the user has changed. Real
   * persisted project data: a half-finished guided track resumes with its
   * arrangement intact and the flow knowing where the next section goes. */
  sections: CoachSection[]
  /** The section currently being carved, or null when none is open.
   *
   * Its `cells` starts EMPTY, which does not mean "nothing plays" -- it
   * means "nothing has been overridden", so every cell reads the template
   * (./coachMapTemplate.ts). That is the deliberate 2026-09-23 reversal of
   * the old everything-on/user-subtracts rule; see ./coachSections.ts's own
   * module comment before changing it. */
  draftSection: CoachSectionDraft | null
  /** Phase three's applied tension moves -- what is switched ON at which
   * section boundary. A flat list rather than a keyed record so a later
   * change needs no migration, exactly like `outcomes`: an entry that is
   * not there is a toggle that is off. Real persisted project data; the
   * toggles' on/off state must survive a save, because the curves and
   * risers themselves do.
   *
   * Like `sections`, this describes REAL TIMELINE MATERIAL rather than
   * where sssketchy is, which is why history.ts takes it from the snapshot
   * being restored instead of pinning it across undo/redo -- see the note
   * on pinnedCoach there. */
  tension: CoachTensionApplied[]
  /** When an export first really wrote a file -- "the project is marked
   * 'V1 exported'" (spec). null until then. Set once and never rewritten:
   * the FIRST file out is the v1, and a later export is just another
   * export. Pinned across undo/redo like the rest of the flow: it records a
   * file on disk, which no undo can take back. */
  v1ExportedAt: number | null
}

/** The spec's "after ~10 minutes on one step, a quiet nudge". Never blocks,
 * never auto-advances. */
export const COACH_STUCK_AFTER_MS = 10 * 60 * 1000

function emptyPhaseElapsed(): Record<CoachPhase, number> {
  return { arrangement: 0, polish: 0 }
}

export function startCoach(now: number): CoachState {
  return {
    status: 'active',
    stepId: FIRST_COACH_STEP_ID,
    outcomes: {},
    phaseElapsedMs: emptyPhaseElapsed(),
    stepElapsedMs: 0,
    runningSince: now,
    lineSeed: 0,
    lockedClimax: null,
    phraseReading: null,
    phrase: null,
    loopIs: null,
    shape: null,
    sections: [],
    draftSection: null,
    tension: [],
    v1ExportedAt: null
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

/**
 * Whether this flow ran all the way to the end.
 *
 * Derived from the LAST step's outcome rather than read off `status`,
 * because the two answer different questions: `status` is whether he is on
 * screen right now, and a finished flow can be put away (dismissCoach), at
 * which point its status is 'dismissed' like any other hidden flow. "Is
 * there anything left to resume" has to survive that, and the outcome of
 * the last step is the durable record of it -- it is already persisted, and
 * already what the checklist ticks.
 */
export function coachIsComplete(state: CoachState): boolean {
  if (state.status === 'finished') return true
  const order = coachStepOrder()
  return state.outcomes[order[order.length - 1]] !== undefined
}

/** The project-menu button's "resume a half-finished flow". Restarts the
 * clock only if it was stopped, so pressing the button while he is already
 * on screen is harmless. A completed flow has nothing to resume -- the
 * button starts a fresh one instead (App.tsx's handleSssketchy), whether
 * that flow is still showing its closing line or has already been put
 * away. */
export function resumeCoach(state: CoachState, now: number): CoachState {
  if (coachIsComplete(state)) return state
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
 * presence stop.
 *
 * A FINISHED flow dismisses too, and that is the only way the closing
 * bubble ever leaves the screen: its one button is "done", which dispatches
 * exactly this. Outcomes, the locked climax and the sections are all kept,
 * so nothing about having finished is lost -- coachIsComplete reads that
 * off the last step's outcome, not off `status`, so the project-menu button
 * still offers a fresh flow rather than resuming this one. */
export function dismissCoach(state: CoachState, now: number): CoachState {
  if (state.status === 'dismissed') return state
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

/** Whether the current step's own completion condition is met.
 *
 * One step is left with an automatic check. Phase one had several, all
 * derived from Discover's slots; those went with it. Whether the tension
 * pass or the balance check is "done" is a person listening, and the app
 * has no way to know -- so they are not here, and that is deliberate.
 */
export function coachStepSatisfied(state: CoachState): boolean {
  return state.stepId === 'p3-export' && state.v1ExportedAt !== null
}

/** The one thought on screen. The satisfied line REPLACES the step's own
 * line rather than joining it -- "a new step's text replaces the old one;
 * nothing stacks" (spec) applies just as much inside a step.
 *
 * Lived in coachPhase1.ts until 2026-09-23; it is the bubble's own entry
 * point and has nothing to do with phase one, so it came here rather than
 * dying with it. */
export function coachLineFor(state: CoachState): string {
  if (state.status === 'finished') return coachLine(state)
  if (coachStepSatisfied(state)) {
    return pickLineVariant(COACH_STEP_SATISFIED_LINES, state.lineSeed)
  }
  return coachLine(state)
}

/**
 * Freezes the loop's stems, roles and gains onto the flow -- the material
 * the map is carved from.
 *
 * Lived in coachPhase1.ts, but it is not phase one's: phases two and three
 * both read `lockedClimax`, and the map cannot be built without it. The
 * step that used to dispatch it (p1-lock) is gone; the auto-arranger
 * dispatches it in the map plan.
 *
 * A lock with nothing resolved leaves the flow exactly as it was, rather
 * than storing an empty climax the map would then have to special-case.
 */
export function lockCoachClimax(
  state: CoachState,
  now: number,
  slots: readonly CoachSlotSnapshot[],
  bpm: number
): CoachState {
  const lockedClimax = lockClimaxFromSlots(slots, bpm, now)
  if (lockedClimax === null) return state
  return { ...state, lockedClimax }
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
  /** A short window just after the ten-minute nudge LANDED -- not the
   * whole time it stands.
   *
   * isCoachStuck stays true from minute ten until the step changes, so
   * passing that straight in here pinned him to a four-frame hit loop for
   * the rest of the step (the minimised corner sprite included). The spec
   * asks for "a quiet nudge"; a character taking hits forever is the
   * loudest thing on the screen, and it is also the one animation that
   * reads as something being wrong. The nudge's LINE stays up the whole
   * time -- that is the part that is actually useful -- and only the
   * animation is a burst. See SssketchyCoach.tsx for where the burst is
   * timed. */
  justNudged: boolean
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
 * `justNudged` is last: it is the quietest signal and must never interrupt
 * a louder true one.
 */
export function coachAnimation(input: CoachAnimationInput): SssketchyAnimation {
  if (input.status === 'finished') return 'jump'
  if (input.working) return 'climb'
  if (input.moving) return 'walk'
  if (input.justAdvanced) return 'jump'
  if (input.justNudged) return 'hit'
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
  // A stepId this build does not know (a project saved by an earlier one,
  // or hand-edited, including every phase-one 'p1-' step) is repaired back
  // to the first step this build still has.
  const stepId = isCoachStepId(loose.stepId) ? loose.stepId : FIRST_COACH_STEP_ID
  // The ANSWER is repaired first, because the section migration below
  // measures a pre-map section's bar count against it.
  const phrase = sanitiseCoachPhrase(loose.phrase)
  return {
    status: loose.status === 'finished' ? 'finished' : 'dismissed',
    stepId,
    outcomes: loadedOutcomes(loose.outcomes),
    // A project saved with a `loop` figure simply loses that number, which
    // is correct: there is no phase for it to belong to any more.
    phaseElapsedMs: {
      arrangement: finiteMs(phase.arrangement),
      polish: finiteMs(phase.polish)
    },
    stepElapsedMs: finiteMs(loose.stepElapsedMs),
    runningSince: null,
    lineSeed:
      typeof loose.lineSeed === 'number' && Number.isFinite(loose.lineSeed)
        ? Math.trunc(loose.lineSeed)
        : 0,
    lockedClimax: sanitiseLockedClimax(loose.lockedClimax),
    phraseReading: sanitiseLoopPhraseReading(loose.phraseReading),
    phrase,
    loopIs: isCoachLoopAnswer(loose.loopIs) ? loose.loopIs : null,
    shape: isCoachShapeId(loose.shape) ? loose.shape : null,
    // A project with no answer yet migrates its sections at one pass each;
    // the map's own re-size fixes that the moment he answers.
    sections: sanitiseCoachSections(loose.sections, phrase?.bars ?? 1),
    draftSection: sanitiseCoachSectionDraft(loose.draftSection, phrase?.bars ?? 1),
    tension: sanitiseCoachTension(loose.tension),
    // Repaired rather than trusted, like every other number here: a
    // hand-edited or absent value must not leave the flow thinking a file
    // came out when none did. Zero and negatives are treated as "not
    // exported" -- there is no real export at the epoch.
    v1ExportedAt:
      typeof loose.v1ExportedAt === 'number' &&
      Number.isFinite(loose.v1ExportedAt) &&
      loose.v1ExportedAt > 0
        ? loose.v1ExportedAt
        : null
  }
}
