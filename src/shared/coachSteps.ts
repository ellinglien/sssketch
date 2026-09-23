/**
 * What the guided flow IS, as plain data.
 *
 * Every place the flow can be is a row in COACH_STEPS below -- the state
 * machine in ./coach.ts only ever walks this table. What each row SAYS is
 * not here: its `lines` come from COACH_SCRIPT.steps (./coachScript.ts),
 * which holds the whole of sssketchy's copy in one editable place.
 *
 * Phase one -- eight rows that walked the user through assembling a climax
 * loop in Discover -- was DELETED on 2026-09-23 (spec:
 * docs/superpowers/specs/2026-09-23-arrangement-map-design.md, "Phase one
 * solved a problem nobody has"). Elling: "building a loop for the climax...
 * that is the easy part for people, honestly." Nothing reorders this table
 * any more, no step asks the user a question of its own, and no step adds a
 * Discover slot. If you are adding one of those back, read the spec first.
 */

import { COACH_SCRIPT } from './coachScript'
import type { CoachExportOp, CoachTensionOp, CoachTransportOp } from './coachTension'

export type CoachPhase = 'arrangement' | 'polish'

export interface CoachPhaseDef {
  id: CoachPhase
  /** Shown in the checklist. Lowercase, like all UI copy in this app. */
  label: string
  /** The spec's own phase targets ("loop 60-90 min, arrangement 2-3 h,
   * polish 45-60 min"), in minutes. Shown in the checklist as a target, and
   * never enforced: the timer in this feature nudges, it never blocks and
   * never auto-advances. */
  targetMinMinutes: number
  targetMaxMinutes: number
}

const COACH_PHASE_BY_ID: Record<CoachPhase, CoachPhaseDef> = {
  arrangement: {
    id: 'arrangement',
    label: 'the arrangement',
    targetMinMinutes: 120,
    targetMaxMinutes: 180
  },
  polish: { id: 'polish', label: 'polish and export', targetMinMinutes: 45, targetMaxMinutes: 60 }
}

/** The two phases in the order the method runs them -- the checklist's
 * own order, and the only place that order is written down. */
const COACH_PHASE_ORDER: readonly CoachPhase[] = ['arrangement', 'polish']

export const COACH_PHASES: readonly CoachPhaseDef[] = COACH_PHASE_ORDER.map((phase) =>
  coachPhaseDef(phase)
)

/** Total, by construction -- CoachPhase is a closed union over the record's
 * own keys, so there is no "unknown phase" branch to get wrong. The one way
 * to turn a phase id into its label and targets, including for COACH_PHASES
 * itself just above. */
export function coachPhaseDef(phase: CoachPhase): CoachPhaseDef {
  return COACH_PHASE_BY_ID[phase]
}

/** Every step the flow can be on. A closed union rather than a bare string
 * so a typo in a later phase plan is a typecheck failure -- persisted
 * values are validated back into it by isCoachStepId (a .sssketchproj is
 * plain JSON people can and do hand-edit; a load must never throw).
 *
 * The eight 'p1-' rows were deleted on 2026-09-23 with phase one itself, so
 * a project saved on one of them loads with an unknown stepId and is
 * repaired back to the first step -- see sanitiseLoadedCoach, which is the
 * same path every earlier placeholder took. */
export type CoachStepId =
  'p2-first' | 'p2-section' | 'p2-next' | 'p3-tension' | 'p3-balance' | 'p3-export'

/** What a move actually DOES, as data rather than as a callback -- the
 * renderer switches on `kind` and nothing in src/shared/ knows that
 * Discover, React or Electron exist.
 * 'lock-climax' freezes the loop (see ./coachClimax.ts);
 * 'tension-op' presses one of the
 * phase-three panel's (./coachTension.ts); 'transport-op' is the balance
 * step simply starting playback, which is a machine fact rather than a
 * musical decision; 'export-op' opens one of the export menu's own three
 * entries. Every one of them is a button that already exists somewhere,
 * restated as data, so the bubble's "stuck?" list and the panel can never
 * offer two different sets of moves. */
export type CoachMoveAction =
  | { kind: 'lock-climax' }
  | { kind: 'tension-op'; op: CoachTensionOp }
  | { kind: 'transport-op'; op: CoachTransportOp }
  | { kind: 'export-op'; op: CoachExportOp }

/** One concrete move a step can make on the user's behalf. Surfaced by the
 * bubble's "stuck?" button, which "surfaces concrete moves this step can
 * make... It never produces a judgement" (spec), and -- for the step's
 * `primaryMoveId` -- by "do it for me". */
export interface CoachMove {
  id: string
  /** Phrased as an offer, e.g. 'add a bassish one'. Lowercase. */
  label: string
  action: CoachMoveAction
}

export interface CoachStepDef {
  id: CoachStepId
  phase: CoachPhase
  /** The checklist's own one-liner for this step. */
  label: string
  /** 3-4 hand-written variants of this step's bubble line, rotated
   * deterministically by CoachState.lineSeed (see ./coachLines.ts's
   * pickLineVariant). "Repeating himself word-for-word is most of what
   * makes a character feel dead" (spec).
   *
   * THE WORDS THEMSELVES ARE NOT IN THIS FILE. Every row below reads its
   * lines from COACH_SCRIPT.steps (./coachScript.ts), where the whole of
   * sssketchy's copy sits in one place under the tone rules. This table
   * keeps what a step DOES; the script keeps what he says. */
  lines: readonly string[]
  /** Every concrete move this step can make. Empty on a step with nothing
   * to automate -- an invented move would be a lie in the one part of this
   * feature that must never guess. */
  moves: readonly CoachMove[]
  /** Which of `moves` the bubble's "do it for me" runs. Absent when doing
   * it for you would be a decision only the user can make (which section
   * opens the track), which is what disables that button. */
  primaryMoveId?: string
  /** CSS selector for the element this step is about -- sssketchy stands on
   * the bottom edge near it, and WALKS when it changes between steps (spec:
   * "walk = moving to another area (Discover -> timeline)"). Same
   * look-it-up-fresh approach TourOverlay.tsx already uses for the same
   * reason: targets live in unrelated components with no shared parent
   * worth threading refs through. */
  anchorSelector?: string
}

/** Every phase-two step stands next to the arranger's own scrolling
 * timeline -- which is also what makes him WALK when phase one ends
 * (spec: "walk = moving to another area (Discover -> timeline)"). The
 * attribute is on App.tsx's timeline scroll container. */
const TIMELINE = '[data-coach-anchor="timeline"]'

/**
 * This step's lines, out of the script (./coachScript.ts).
 *
 * A FUNCTION rather than a bare `COACH_SCRIPT.steps['p2-first']` on each
 * row, and the reason is worth keeping: this project sets
 * `noImplicitAny: false`, which suppresses TS7053 -- so indexing the
 * record with a misspelled key compiles clean and hands back `any`, and
 * the first anyone would know is sssketchy standing there with an empty
 * bubble. Passed as an ARGUMENT, a misspelled id is an ordinary
 * argument-type error, which no compiler setting here switches off.
 */
function stepLines(id: CoachStepId): readonly string[] {
  return COACH_SCRIPT.steps[id]
}

export const COACH_STEPS: readonly CoachStepDef[] = [
  {
    id: 'p2-first',
    phase: 'arrangement',
    label: 'the map',
    lines: stepLines('p2-first'),
    // No moves, deliberately: what the sections should become is not the
    // app's call. "do it for me" stays disabled here and that is the point.
    moves: [],
    anchorSelector: TIMELINE
  },
  {
    id: 'p2-section',
    phase: 'arrangement',
    label: 'walk the sections',
    lines: stepLines('p2-section'),
    // No moves. He is naming what a section is FOR, and doing it for you
    // would be exactly the dictate the spec forbids: "goals, not dictates.
    // advice, not rules." The walk's own back/next/leave buttons are
    // navigation, not moves, so they live on the bubble rather than here.
    moves: [],
    anchorSelector: TIMELINE
  },
  {
    id: 'p2-next',
    phase: 'arrangement',
    label: 'when you are done here',
    lines: stepLines('p2-next'),
    // Same reasoning as p2-first: when the arrangement is done is the
    // user's call, and a move here would be the app deciding it.
    moves: [],
    anchorSelector: TIMELINE
  },
  {
    id: 'p3-tension',
    phase: 'polish',
    label: 'the tension pass',
    lines: stepLines('p3-tension'),
    // The panel's own two controls, restated here so the bubble's "stuck?"
    // list and "do it for me" can never offer a different set of moves than
    // the panel shows. "add all of these" is the primary one for the same
    // reason "drop the suggested ones" is phase two's -- it is the single
    // shortcut worth having, and it still only ever runs on a click.
    moves: [
      {
        id: 'tension-add-all',
        label: 'add all of these',
        action: { kind: 'tension-op', op: 'add-all' }
      },
      {
        id: 'tension-listen',
        label: 'play the first join',
        action: { kind: 'tension-op', op: 'listen' }
      }
    ],
    primaryMoveId: 'tension-add-all',
    anchorSelector: TIMELINE
  },
  {
    id: 'p3-balance',
    phase: 'polish',
    label: 'the balance check',
    lines: stepLines('p3-balance'),
    // Pressing play is a machine fact, not a musical decision, which is why
    // this step has a move at all where phase one's balance step did not:
    // that one asked the app to judge a mix, this one asks it to hit space.
    moves: [
      {
        id: 'balance-play',
        label: 'play the whole thing from the top',
        action: { kind: 'transport-op', op: 'play-from-top' }
      }
    ],
    primaryMoveId: 'balance-play',
    anchorSelector: TIMELINE
  },
  {
    id: 'p3-export',
    phase: 'polish',
    label: 'export a v1',
    lines: stepLines('p3-export'),
    moves: [
      { id: 'export-mix', label: 'export a mix', action: { kind: 'export-op', op: 'mix' } },
      { id: 'export-stems', label: 'export the stems', action: { kind: 'export-op', op: 'stems' } },
      {
        id: 'export-project',
        label: 'export an ableton or reaper project',
        action: { kind: 'export-op', op: 'project' }
      }
    ],
    primaryMoveId: 'export-mix',
    anchorSelector: TIMELINE
  }
]

export const FIRST_COACH_STEP_ID: CoachStepId = COACH_STEPS[0].id

const COACH_STEP_IDS = new Set<string>(COACH_STEPS.map((step) => step.id))

export function isCoachStepId(value: unknown): value is CoachStepId {
  return typeof value === 'string' && COACH_STEP_IDS.has(value)
}

/** Takes a bare string (not a CoachStepId) because the caller is often
 * reading a persisted value; returns undefined rather than throwing. */
export function coachStepById(id: string): CoachStepDef | undefined {
  return COACH_STEPS.find((step) => step.id === id)
}

/** The whole flow, in the one order it runs in. Phase one used to reorder
 * two of its steps from the melodic-or-groove answer; with phase one gone
 * there is nothing left to reorder, so this is simply the table's own
 * order -- kept as a function because `coach.ts` walks it and a later
 * plan may well branch it again. */
export function coachStepOrder(): readonly CoachStepId[] {
  return COACH_STEPS.map((step) => step.id)
}

export function nextCoachStepId(id: CoachStepId): CoachStepId | null {
  const order = coachStepOrder()
  const index = order.indexOf(id)
  if (index < 0 || index >= order.length - 1) return null
  return order[index + 1]
}

/** This phase's steps, in order -- the checklist renders these directly. */
export function coachStepsInPhase(phase: CoachPhase): readonly CoachStepDef[] {
  return COACH_STEPS.filter((step) => step.phase === phase)
}

/** The move "do it for me" runs, or null when this step has none. */
export function coachStepPrimaryMove(step: CoachStepDef): CoachMove | null {
  if (step.primaryMoveId === undefined) return null
  return step.moves.find((move) => move.id === step.primaryMoveId) ?? null
}
