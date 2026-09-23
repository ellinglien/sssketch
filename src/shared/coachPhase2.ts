/**
 * Phase two's own transitions: opening a section, editing it, and putting it
 * down.
 *
 * Everything here is pure and every function takes the whole CoachState and
 * returns a new one. Time is injected
 * (`now`), never read from the clock -- see ./coach.ts's module doc.
 *
 * THE RULE, AS OF 2026-09-23: **a draft arrives PRE-FILLED from the
 * template.** It opens with `cells: {}`, which does not mean "nothing
 * plays" -- it means "nothing has been overridden", so every cell reads
 * whatever ./coachMapTemplate.ts says for that section type. This is the
 * deliberate reversal of the old everything-on/user-subtracts rule (spec:
 * docs/superpowers/specs/2026-09-23-arrangement-map-design.md, "The map
 * arrives pre-filled, and says so"), and dropSuggestedCoachSectionStems --
 * the button that used to apply the suggestion table by hand -- went with
 * it, because with a pre-filled map the table is already applied and a
 * button that applies it again is meaningless.
 *
 * The loop back is here rather than in advanceCoach: phase two walks
 * p2-first -> p2-section -> p2-next and then RETURNS to p2-section for as
 * long as the user keeps choosing another section. startCoachSection is that
 * return, and it works from either question step because both do the same
 * thing -- mark the question answered and open a fresh draft.
 */

import { pauseCoach, type CoachOutcome, type CoachState } from './coach'
import {
  COACH_NEXT_SECTION_LINE_TEMPLATES,
  COACH_SECTION_LINE_TEMPLATES,
  pickLineVariant
} from './coachLines'
import { cellIsOn, setCell, setStemAcrossPasses } from './coachCells'
import { templateFallbackFor } from './coachMapTemplate'
import { nudgeSectionPasses, passesForTargetBars } from './coachPasses'
import { newCoachSectionDraft, type CoachSection, type CoachSectionType } from './coachSections'
import { COACH_LOOP_HOME_TYPE, targetBarsFor } from './coachShapes'
import type { LockedClimaxStem } from './coachClimax'

/** Which section type the user's own loop IS. 'drop' until he answers,
 * which is COACH_LOOP_HOME_TYPE's own default and the place the method
 * puts unattributed material. */
function homeTypeOf(state: CoachState): CoachSectionType {
  return state.loopIs === null ? 'drop' : COACH_LOOP_HOME_TYPE[state.loopIs]
}

/** The template's answer for the open draft, or "everything plays" when
 * there is no locked climax to read (in which case nothing can be toggled
 * anyway -- every mutator below refuses without one). */
function draftFallback(state: CoachState): (stem: LockedClimaxStem, passIndex: number) => boolean {
  const draft = state.draftSection
  if (draft === null || state.lockedClimax === null) return () => true
  return templateFallbackFor(draft, homeTypeOf(state), state.lockedClimax)
}

/**
 * Opens a fresh section. Dispatched by the panel from p2-first ("what comes
 * first") and from p2-next ("what comes next"), which are the same
 * transition seen twice.
 *
 * Refuses without a locked climax: there would be nothing to carve, and
 * storing a draft against no material would only produce a panel with an
 * empty stem list.
 */
export function startCoachSection(
  state: CoachState,
  now: number,
  type: CoachSectionType
): CoachState {
  if (state.lockedClimax === null) return state
  const banked = pauseCoach(state, now)
  // The length comes from the shape template's TARGET for this type, at the
  // phrase the user answered -- never a hardcoded bar count.
  const ordinal = banked.sections.filter((section) => section.type === type).length
  const passes = passesForTargetBars(targetBarsFor(type, ordinal), banked.phrase?.bars ?? 1)
  return {
    ...banked,
    outcomes: { ...banked.outcomes, [banked.stepId]: 'done' as CoachOutcome },
    stepId: 'p2-section',
    // Pre-filled from the template. See this module's own doc comment.
    draftSection: newCoachSectionDraft(type, banked.sections, passes),
    stepElapsedMs: 0,
    runningSince: now,
    lineSeed: banked.lineSeed + 1
  }
}

/** Takes no `now`: typing a name is not a step change and must not move the
 * clock or the line. */
export function setCoachSectionName(state: CoachState, name: string): CoachState {
  if (state.draftSection === null) return state
  return { ...state, draftSection: { ...state.draftSection, name } }
}

/** The spec's "+/-1 and +/-2 passes", clamped by nudgeSectionPasses.
 * Returns the state untouched when the nudge would change nothing, so a
 * button held at the clamp does not churn React.
 *
 * Growing a section costs nothing: the new passes simply read the template,
 * and every cell the user already edited is still there (./coachCells.ts).
 * Shrinking destroys nothing either -- an override for a pass that is out of
 * range comes back if he grows it again. */
export function nudgeCoachSectionPasses(state: CoachState, delta: number): CoachState {
  if (state.draftSection === null) return state
  const passes = nudgeSectionPasses(state.draftSection.passes, delta)
  if (passes === state.draftSection.passes) return state
  return { ...state, draftSection: { ...state.draftSection, passes } }
}

/**
 * One stem switched off, or back on. The ONLY per-stem change in phase two,
 * and it is always the user's own gesture.
 *
 * A path that is not in the locked climax is ignored rather than stored: a
 * dropped path that matches nothing would be invisible in the panel and
 * would survive in the saved project forever.
 *
 * Switching off the LAST stem is allowed. A silent section is a real
 * musical move (a bar of nothing before a drop), the placement builder
 * handles it by placing no clips, and the next section still starts after
 * it -- see nextCoachSectionStartBar.
 */
export function toggleCoachSectionStem(state: CoachState, path: string): CoachState {
  const draft = state.draftSection
  if (draft === null || state.lockedClimax === null) return state
  const stem = state.lockedClimax.stems.find((candidate) => candidate.path === path)
  if (stem === undefined) return state
  // Reads its current state from pass 0's RESOLVED value -- the template's
  // answer unless the user already overrode it -- then writes the opposite
  // explicitly into every pass. Whole-row, which is what a checkbox means.
  const on = cellIsOn(draft.cells, 0, path, draftFallback(state)(stem, 0))
  return {
    ...state,
    draftSection: { ...draft, cells: setStemAcrossPasses(draft.cells, draft.passes, path, !on) }
  }
}

/**
 * ONE cell switched off, or back on -- the map's own gesture, one pass of
 * one stem.
 *
 * Same refusals as the whole-row toggle above: a path that is not in the
 * locked climax is ignored rather than stored, because such a cell would be
 * invisible in the map and would survive in the saved project forever.
 */
export function toggleCoachSectionCell(
  state: CoachState,
  passIndex: number,
  path: string
): CoachState {
  const draft = state.draftSection
  if (draft === null || state.lockedClimax === null) return state
  const stem = state.lockedClimax.stems.find((candidate) => candidate.path === path)
  if (stem === undefined) return state
  const on = cellIsOn(draft.cells, passIndex, path, draftFallback(state)(stem, passIndex))
  return {
    ...state,
    draftSection: { ...draft, cells: setCell(draft.cells, passIndex, path, !on) }
  }
}

/**
 * The draft becomes a placed section.
 *
 * `startBar` and `placedGroupIds` come from the caller, which has just built
 * the real arranger actions (buildCoachSectionActions,
 * src/renderer/src/state/coachSectionPlacement.ts) -- this records what
 * REALLY happened rather than recomputing it, so the flow's own idea of the
 * arrangement can never drift from the timeline.
 *
 * An outro ends phase two (spec: "Choosing outro ends phase 2") -- but only
 * once it has actually been built and placed, because an outro is a section
 * like any other, with its own suggested drops.
 */
export function placeCoachSection(
  state: CoachState,
  now: number,
  startBar: number,
  placedGroupIds: Record<string, string>
): CoachState {
  const draft = state.draftSection
  if (draft === null) return state
  const banked = pauseCoach(state, now)
  const section: CoachSection = {
    id: `section-${banked.sections.length}`,
    type: draft.type,
    name: draft.name,
    passes: draft.passes,
    cells: { ...draft.cells },
    startBar,
    placedGroupIds
  }
  const finishing = draft.type === 'outro'
  const outcomes: Record<string, CoachOutcome> = { ...banked.outcomes, 'p2-section': 'done' }
  if (finishing) outcomes['p2-next'] = 'done'
  return {
    ...banked,
    sections: [...banked.sections, section],
    draftSection: null,
    outcomes,
    // Placing an outro hands straight over to phase three's first step.
    // This used to name the single 'finish' placeholder; that row was
    // replaced by three real 'p3-' ones (./coachSteps.ts), and the one this
    // hand-off means is the first of them -- "stop arranging and go to
    // polish", the same thing skipping from p2-next does.
    stepId: finishing ? 'p3-tension' : 'p2-next',
    stepElapsedMs: 0,
    runningSince: now,
    lineSeed: banked.lineSeed + 1
  }
}

/**
 * The phase-two thought on screen, or null when the flow is somewhere else
 * (the caller then falls back to coachLineFor, ./coach.ts).
 *
 * Returns ONE string, like every other line in this feature -- "a new step's
 * text replaces the old one; nothing stacks" (spec) applies just as much
 * inside phase two.
 */
export function coachSectionLine(state: CoachState): string | null {
  if (state.status === 'finished') return null
  if (state.stepId === 'p2-section' && state.draftSection !== null) {
    return pickLineVariant(COACH_SECTION_LINE_TEMPLATES, state.lineSeed).replace(
      '{section}',
      state.draftSection.name
    )
  }
  if (state.stepId === 'p2-next' && state.sections.length > 0) {
    const last = state.sections[state.sections.length - 1]
    return pickLineVariant(COACH_NEXT_SECTION_LINE_TEMPLATES, state.lineSeed).replace(
      '{section}',
      last.name
    )
  }
  return null
}
