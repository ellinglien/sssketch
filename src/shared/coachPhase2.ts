/**
 * Phase two's own transitions: opening a section, editing it, and putting it
 * down.
 *
 * Everything here is pure and every function takes the whole CoachState and
 * returns a new one. Time is injected
 * (`now`), never read from the clock -- see ./coach.ts's module doc.
 *
 * THE RULE (spec): **everything is on, the user subtracts.** A draft opens
 * with droppedPaths empty and stays that way until somebody toggles a stem
 * or presses "drop the suggested ones". dropSuggestedCoachSectionStems below
 * is the ONLY function in this codebase that adds the suggestion table's
 * output to a draft, and it exists to be called from a click. Nothing in
 * startCoachSection, and nothing in the reducer, may pre-apply it: a
 * suggestion you ignore costs nothing when it is wrong, a pre-applied
 * default is a decision you have to notice and undo.
 *
 * The loop back is here rather than in advanceCoach: phase two walks
 * p2-first -> p2-section -> p2-next and then RETURNS to p2-section for as
 * long as the user keeps choosing another section. startCoachSection is that
 * return, and it works from either question step because both do the same
 * thing -- mark the question answered and open a fresh, everything-on draft.
 */

import { pauseCoach, type CoachOutcome, type CoachState } from './coach'
import {
  COACH_NEXT_SECTION_LINE_TEMPLATES,
  COACH_SECTION_LINE_TEMPLATES,
  pickLineVariant
} from './coachLines'
import {
  newCoachSectionDraft,
  nudgeSectionBars,
  suggestedDropPaths,
  type CoachSection,
  type CoachSectionType
} from './coachSections'

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
  return {
    ...banked,
    outcomes: { ...banked.outcomes, [banked.stepId]: 'done' as CoachOutcome },
    stepId: 'p2-section',
    // Everything on. See this module's own doc comment.
    draftSection: newCoachSectionDraft(type, banked.sections),
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

/** The spec's "+/-4/+/-8", clamped by nudgeSectionBars. Returns the state
 * untouched when the nudge would change nothing, so a button held at the
 * clamp does not churn React. */
export function nudgeCoachSectionBars(state: CoachState, delta: number): CoachState {
  if (state.draftSection === null) return state
  const bars = nudgeSectionBars(state.draftSection.bars, delta)
  if (bars === state.draftSection.bars) return state
  return { ...state, draftSection: { ...state.draftSection, bars } }
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
  if (!state.lockedClimax.stems.some((stem) => stem.path === path)) return state
  const droppedPaths = draft.droppedPaths.includes(path)
    ? draft.droppedPaths.filter((dropped) => dropped !== path)
    : [...draft.droppedPaths, path]
  return { ...state, draftSection: { ...draft, droppedPaths } }
}

/**
 * "drop the suggested ones" -- the one button that applies every flag at
 * once (spec).
 *
 * This is the only bulk subtraction in the feature, and it only ever runs
 * from a click. Merges with whatever the user already switched off (so
 * pressing it after some manual toggles never un-drops anything), and
 * returns the state untouched when this section type suggests nothing --
 * which is exactly the drop, "everything plays".
 */
export function dropSuggestedCoachSectionStems(state: CoachState): CoachState {
  const draft = state.draftSection
  if (draft === null || state.lockedClimax === null) return state
  const suggested = suggestedDropPaths(draft.type, state.lockedClimax)
  if (suggested.length === 0) return state
  const droppedPaths = [...new Set([...draft.droppedPaths, ...suggested])]
  if (droppedPaths.length === draft.droppedPaths.length) return state
  return { ...state, draftSection: { ...draft, droppedPaths } }
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
    type: draft.type,
    name: draft.name,
    bars: draft.bars,
    droppedPaths: [...draft.droppedPaths],
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
