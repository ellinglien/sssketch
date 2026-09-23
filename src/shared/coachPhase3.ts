/**
 * Phase three's own transitions: switching one tension move on or off, and
 * marking the project once a v1 has really come out.
 *
 * Everything here is pure and every function takes the whole CoachState and
 * returns a new one, the same shape ./coachPhase1.ts and ./coachPhase2.ts
 * use.
 *
 * THE RULE (spec): **offers are offers.** Nothing below is ever called by
 * the reducer, a constructor, or an effect -- every one of these runs from
 * a click. applyCoachTension in particular is the ONLY function in this
 * codebase that puts an entry into CoachState.tension, and it exists to be
 * dispatched by a toggle the user pressed.
 *
 * Note what does NOT take a `now`: switching a toggle is not a step change
 * and must not move the clock or rotate the line, exactly like
 * setCoachSectionName in phase two. Only markCoachV1Exported takes one, and
 * that is a timestamp it stores rather than a clock it moves.
 */

import type { CoachState } from './coach'
import {
  COACH_TENSION_LINE_TEMPLATES,
  COACH_TENSION_NONE_LINES,
  COACH_V1_EXPORTED_LINES,
  pickLineVariant
} from './coachLines'
import {
  coachSectionBoundaries,
  tensionIsApplied,
  type CoachSectionBoundary,
  type CoachTensionKind
} from './coachTension'

/** Every join the flow's own placed sections make that the NAMES ask
 * something of. Derived, never stored: rename or resize a section and the
 * offers follow. */
export function coachBoundaries(state: CoachState): CoachSectionBoundary[] {
  return coachSectionBoundaries(state.sections)
}

/**
 * One tension move switched on.
 *
 * `riserId` is the id of the riser the caller just placed, for the 'riser'
 * move only -- the caller has already built the real ADD_RISER and is
 * dispatching both in one BATCH, so this records what REALLY happened
 * rather than recomputing it (the same rule placeCoachSection follows).
 *
 * A move on a boundary the flow does not have is IGNORED rather than
 * stored: such an entry would be invisible in the panel and would survive
 * in the saved project forever.
 */
export function applyCoachTension(
  state: CoachState,
  sectionIndex: number,
  kind: CoachTensionKind,
  riserId: string | null
): CoachState {
  if (sectionIndex < 0 || sectionIndex >= state.sections.length) return state
  if (tensionIsApplied(state.tension, sectionIndex, kind)) return state
  return { ...state, tension: [...state.tension, { sectionIndex, kind, riserId }] }
}

/** The same toggle, switched off. The caller has already built the actions
 * that take the curve or the riser back off the arrangement. */
export function clearCoachTension(
  state: CoachState,
  sectionIndex: number,
  kind: CoachTensionKind
): CoachState {
  if (!tensionIsApplied(state.tension, sectionIndex, kind)) return state
  return {
    ...state,
    tension: state.tension.filter(
      (entry) => entry.sectionIndex !== sectionIndex || entry.kind !== kind
    )
  }
}

/**
 * "the project is marked 'V1 exported'" (spec).
 *
 * Deliberately does NOT advance the step, for the same reason
 * lockCoachClimax does not: next and skip stay the user's, and exporting a
 * v1 and then deciding to export the stems as well should not have cost
 * them the step.
 *
 * Set once. A later export is another export, not another v1.
 */
export function markCoachV1Exported(state: CoachState, now: number): CoachState {
  if (state.v1ExportedAt !== null) return state
  return { ...state, v1ExportedAt: now }
}

/** "one join" / "two joins" -- a ready-made phrase, so the line templates
 * do not have to carry a plural rule. Words up to four because those are
 * the counts a guided track actually produces; anything above reads
 * perfectly well as a numeral. */
const JOIN_WORDS: readonly string[] = ['no', 'one', 'two', 'three', 'four']

function joinsPhrase(count: number): string {
  const word = count < JOIN_WORDS.length ? JOIN_WORDS[count] : String(count)
  return `${word} ${count === 1 ? 'join' : 'joins'}`
}

/**
 * The phase-three thought on screen, or null when the flow is somewhere
 * else (the caller then falls back to coachSectionLine, ./coachPhase2.ts,
 * and then to coachLineFor, ./coachPhase1.ts).
 *
 * Returns ONE string, like every other line in this feature -- "a new
 * step's text replaces the old one; nothing stacks" (spec).
 *
 * Only two cases need a line of their own: the tension pass, whose line
 * counts the joins, and an export step that has really produced a file,
 * whose line would otherwise be the generic "the step is satisfied". The
 * balance step and an unexported export step read their own rows'
 * hand-written lines, which is why they return null here.
 */
export function coachPhase3Line(state: CoachState): string | null {
  if (state.status === 'finished') return null
  if (state.stepId === 'p3-tension') {
    const boundaries = coachBoundaries(state)
    if (boundaries.length === 0) {
      return pickLineVariant(COACH_TENSION_NONE_LINES, state.lineSeed)
    }
    return pickLineVariant(COACH_TENSION_LINE_TEMPLATES, state.lineSeed).replace(
      '{joins}',
      joinsPhrase(boundaries.length)
    )
  }
  if (state.stepId === 'p3-export' && state.v1ExportedAt !== null) {
    return pickLineVariant(COACH_V1_EXPORTED_LINES, state.lineSeed)
  }
  return null
}
