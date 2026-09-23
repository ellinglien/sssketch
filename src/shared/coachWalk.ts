/**
 * The section walk: where sssketchy is standing on the map, and the one
 * thought that goes with it.
 *
 * Replaces ./coachPhase2.ts, which walked the user through carving ONE
 * section at a time and placing it. That shape is gone: the map arrives
 * whole and pre-filled (spec, "The map arrives pre-filled, and says so"), so
 * there is nothing left to carve one at a time and nothing left to place.
 * What remains is the part Elling actually asked for -- "he walks the
 * sections with you, one at a time, highlighting that column and naming what
 * the section is FOR."
 *
 * TWO RULES:
 *
 * 1. **Leaving the walk keeps the map** (spec). endCoachWalk nulls one
 *    number and touches nothing else. There is no confirmation, no cleanup
 *    and nothing to lose, and that is why the offer to be walked is a
 *    gentle one rather than a commitment.
 * 2. **He states a GOAL, never a dictate** (spec, twice). Every line comes
 *    from COACH_SECTION_GOAL_LINES, keyed only by the section's TYPE -- so
 *    what he says is a statement about song structure, which is true
 *    regardless of what the user made. He has not heard the music and
 *    nothing here pretends otherwise.
 *
 * Time is injected (`now`), never read from the clock, exactly as ./coach.ts
 * requires of every transition in this layer.
 */

import { pauseCoach, type CoachState } from './coach'
import {
  COACH_LOOP_QUESTION_LINES,
  COACH_SECTION_GOAL_LINES,
  COACH_SHAPE_QUESTION_LINES,
  pickLineVariant
} from './coachLines'

/** An index off disk, checked against the sections it is supposed to name.
 * An index past the end would stand him on a column that is not there. */
export function sanitiseCoachWalkIndex(value: unknown, sectionCount: number): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null
  if (value < 0 || value >= sectionCount) return null
  return value
}

/**
 * Stands him on the first column.
 *
 * Refuses on an empty map rather than storing an index into nothing, and
 * moves the flow to the arrangement step so the checklist and the bubble
 * agree about where he is.
 */
export function startCoachWalk(state: CoachState, now: number): CoachState {
  if (state.sections.length === 0) return state
  const banked = pauseCoach(state, now)
  return {
    ...banked,
    stepId: 'p2-section',
    walkIndex: 0,
    stepElapsedMs: 0,
    runningSince: now,
    lineSeed: banked.lineSeed + 1
  }
}

/**
 * One step of the walk.
 *
 * Past the last section ENDS the walk rather than clamping, because "next"
 * on the last column has to mean something and stopping is the only honest
 * thing it can mean. Before the first clamps, because "back" from the start
 * is a mis-click, not a request to leave.
 */
export function walkCoachTo(state: CoachState, now: number, index: number): CoachState {
  if (state.walkIndex === null) return state
  if (index >= state.sections.length) return endCoachWalk(state, now)
  const next = Math.max(0, Math.round(index))
  if (next === state.walkIndex) return state
  const banked = pauseCoach(state, now)
  return {
    ...banked,
    walkIndex: next,
    stepElapsedMs: 0,
    runningSince: now,
    lineSeed: banked.lineSeed + 1
  }
}

/** Steps out. THE MAP IS UNTOUCHED -- see this module's own doc comment. */
export function endCoachWalk(state: CoachState, now: number): CoachState {
  if (state.walkIndex === null) return state
  const banked = pauseCoach(state, now)
  return { ...banked, walkIndex: null, runningSince: now, lineSeed: banked.lineSeed + 1 }
}

/**
 * The thought for the section he is standing on, or null when he is not
 * walking.
 *
 * The variant is picked on `lineSeed + walkIndex`, not on `lineSeed` alone,
 * so two sections of the same TYPE in one walk do not get the same sentence
 * about themselves -- a standard shape has two verses, two builds and two
 * drops, and hearing the same line twice is most of what makes a character
 * feel dead (./coachLines.ts).
 */
export function coachWalkLine(state: CoachState): string | null {
  if (state.status === 'finished' || state.walkIndex === null) return null
  const section = state.sections[state.walkIndex]
  if (section === undefined) return null
  const lines = COACH_SECTION_GOAL_LINES[section.type]
  if (lines === undefined || lines.length === 0) return null
  return pickLineVariant(lines, state.lineSeed + state.walkIndex)
}

/**
 * The opening question that has not been answered yet, or null.
 *
 * One thought at a time (spec): the setup screen shows both questions, but
 * he is only ever asking ONE of them -- whichever is still open. Once both
 * are answered he says nothing here, because the next thing worth saying is
 * the phrase report, which has its own line and may correctly be silent
 * (coachPhraseLine returns null when the measurement is inconclusive).
 */
export function coachSetupLine(state: CoachState): string | null {
  if (state.status === 'finished' || state.sections.length > 0) return null
  if (state.loopIs === null) return pickLineVariant(COACH_LOOP_QUESTION_LINES, state.lineSeed)
  if (state.shape === null) return pickLineVariant(COACH_SHAPE_QUESTION_LINES, state.lineSeed)
  return null
}
