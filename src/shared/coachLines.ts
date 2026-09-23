/**
 * How a line is CHOSEN, and the named way in to each of sssketchy's tables.
 *
 * **The copy itself is not here any more.** Every word he says lives in
 * ./coachScript.ts, in the order a user meets it, with the tone rules at the
 * top of that file -- so changing a line means opening one file and reading
 * one set of rules first. This module is the adapter the rest of the app
 * imports: the picker below, plus a named constant per table pointing at the
 * script.
 *
 * Two things are load-bearing here:
 *
 * 1. **The pick is SEEDED, never random.** Math.random would reshuffle the
 *    line on every React re-render, so the bubble would visibly rewrite
 *    itself while the user was reading it, and no test could pin a string.
 *    pickLineVariant is a modulo index over CoachState.lineSeed, which is
 *    bumped exactly once per step transition (see ./coach.ts) -- so a line
 *    is stable for as long as its thought is, and rotates when the thought
 *    does.
 *
 * 2. **The copy is hand-written.** An external model was considered and
 *    declined for this build (spec, "Considered and declined: an external
 *    LLM"): it cannot hear the audio, so it would paraphrase facts the app
 *    already has and occasionally invent one. Hand-written copy is wrong
 *    zero percent of the time, and "vocabulary is cheap... the one part of
 *    'alive' we can buy without any inference".
 *
 * Everything in the script therefore describes the METHOD or the flow's own
 * mechanics. Nothing there has an opinion about the user's music.
 */

import { COACH_SCRIPT } from './coachScript'

export { COACH_MAP_LOCKED_CELL_HINT } from './coachScript'

/** The variant at `seed`, wrapping, and tolerant of a negative or
 * out-of-range seed (lineSeed is persisted, so a hand-edited project file
 * can hand us anything). '' for an empty table, so a caller renders nothing
 * rather than crashing. */
export function pickLineVariant(variants: readonly string[], seed: number): string {
  if (variants.length === 0) return ''
  const index = ((Math.trunc(seed) % variants.length) + variants.length) % variants.length
  return variants[index]
}

/** The ~10-minute nudge -- script section 10. */
export const COACH_STUCK_LINES: readonly string[] = COACH_SCRIPT.stuck

/** "stuck?" on a step with no moves to offer -- script section 10. */
export const COACH_NO_MOVES_LINES: readonly string[] = COACH_SCRIPT.noMoves

/** The end of the flow -- script section 9. */
export const COACH_DONE_LINES: readonly string[] = COACH_SCRIPT.done

/** The generic "this step's condition is met" line -- script section 11. */
export const COACH_STEP_SATISFIED_LINES: readonly string[] = COACH_SCRIPT.stepSatisfied

/** The phrase report, {nominal} and {phrase} -- script section 2. */
export const COACH_PHRASE_LINE_TEMPLATES: readonly string[] = COACH_SCRIPT.phraseReport

/** The pre-fill note -- script section 3. */
export const COACH_PREFILLED_LINE_TEMPLATES: readonly string[] = COACH_SCRIPT.prefilled

/** The tension pass, {joins} -- script section 8. */
export const COACH_TENSION_LINE_TEMPLATES: readonly string[] = COACH_SCRIPT.tension

/** The tension pass with nothing to offer -- script section 8. */
export const COACH_TENSION_NONE_LINES: readonly string[] = COACH_SCRIPT.tensionNone

/** After an export has really written a file -- script section 9. */
export const COACH_V1_EXPORTED_LINES: readonly string[] = COACH_SCRIPT.v1Exported

/** "What is this loop?" -- script section 1. */
export const COACH_LOOP_QUESTION_LINES: readonly string[] = COACH_SCRIPT.loopQuestion

/** "How long a journey?" -- script section 1. */
export const COACH_SHAPE_QUESTION_LINES: readonly string[] = COACH_SCRIPT.shapeQuestion

/** What each kind of section is FOR -- script section 6.
 *
 * Deliberately typed by `string` key rather than by CoachSectionType: the
 * caller (coachWalkLine) reads it with a section type off a persisted
 * project and checks the result for undefined, and that check has to stay
 * meaningful. The script's own object IS exhaustive over CoachSectionType,
 * which is where the typecheck guarantee lives. */
export const COACH_SECTION_GOAL_LINES: Record<string, readonly string[]> = COACH_SCRIPT.sectionGoals

/** Entering the walk -- script section 5. */
export const COACH_WALK_START_LINES: readonly string[] = COACH_SCRIPT.walkStart

/** Leaving the walk -- script section 7. */
export const COACH_WALK_END_LINES: readonly string[] = COACH_SCRIPT.walkEnd
