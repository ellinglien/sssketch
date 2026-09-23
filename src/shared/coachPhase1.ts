/**
 * Phase one's own decisions: what completes a step, what a seeded start
 * already covers, and the two transitions the framework's six actions do
 * not cover (answering the question, locking the climax).
 *
 * Everything here is pure and takes its view of Discover as a list of
 * CoachSlotSnapshots, which DiscoverPanel publishes upward -- see
 * ./coachClimax.ts. Nothing here knows that React, Electron or a
 * DiscoverCandidate exist.
 *
 * The rule that shapes all of it (spec, "What he is allowed to say"): every
 * check below is a fact about the SLOTS, never a judgement about the audio.
 * "A slot targeting drummy has resolved" is true or false and the app can
 * see it; "the drums are right" is not, and he never says it.
 */

import { coachLine, pauseCoach, type CoachOutcome, type CoachState } from './coach'
import { kindsCoverSet, lockClimaxFromSlots, type CoachSlotSnapshot } from './coachClimax'
import {
  COACH_SEEDED_LINE_TEMPLATES,
  COACH_STEP_SATISFIED_LINES,
  pickLineVariant
} from './coachLines'
import {
  coachStepById,
  coachStepOrder,
  resolveCoachStep,
  type CoachFlavour,
  type CoachStepDef,
  type CoachStepId
} from './coachSteps'
import {
  DISCOVER_SLOT_KIND_LABEL,
  normalizeSlotKinds,
  type DiscoverSlotKind
} from './discoverSlotKind'

/** One slot against one wanted kind set: the slot must have really resolved
 * ("a step completes when a slot with those kinds resolves", spec) and its
 * own kinds must be a SUPERSET of the wanted set. Superset, not overlap, is
 * what keeps a {leadesque, buttery} harmony slot from completing the hook
 * step, which wants {leadesque, sparkly} -- normalizeSlotKinds allows at
 * most one of sparkly/buttery in a set, so the two can never collide. */
export function slotCoversKindSet(
  slot: CoachSlotSnapshot,
  want: readonly DiscoverSlotKind[]
): boolean {
  if (slot.stem === null) return false
  return kindsCoverSet(slot.kinds, want)
}

/** Whether any current slot completes this step. A step with no
 * `satisfiedBy` (the balance pass) is never completed automatically -- that
 * one is a person listening, and the app has no way to know. */
export function stepSatisfiedBySlots(
  step: CoachStepDef,
  flavour: CoachFlavour | null,
  slots: readonly CoachSlotSnapshot[]
): boolean {
  const sets = resolveCoachStep(step, flavour).satisfiedBy ?? []
  return sets.some((want) => slots.some((slot) => slotCoversKindSet(slot, want)))
}

/** The current step's completion check. Two steps are answered by the flow
 * itself rather than by the slots: the question (answered when there is an
 * answer) and the lock-in (answered when there is a locked climax). */
export function coachStepSatisfied(
  state: CoachState,
  slots: readonly CoachSlotSnapshot[]
): boolean {
  if (state.stepId === 'p1-flavour') return state.flavour !== null
  if (state.stepId === 'p1-lock') return state.lockedClimax !== null
  const step = coachStepById(state.stepId)
  if (step === undefined) return false
  return stepSatisfiedBySlots(step, state.flavour, slots)
}

/** The phase-one steps a start from an existing riff already covers, in
 * this flavour's own order. Derived entirely from the kind sets Discover
 * tagged each slot with (buildSeedSlotsFromStems /
 * buildSeedSlotsFromCandidates in the renderer) -- never from stem order or
 * channel index, which the spec rules out. */
export function seededCoveredStepIds(
  flavour: CoachFlavour,
  slots: readonly CoachSlotSnapshot[]
): CoachStepId[] {
  const covered: CoachStepId[] = []
  for (const id of coachStepOrder(flavour)) {
    const step = coachStepById(id)
    if (step === undefined || step.phase !== 'loop' || id === 'p1-flavour') continue
    if (stepSatisfiedBySlots(step, flavour, slots)) covered.push(id)
  }
  return covered
}

/** The kinds those covered steps were actually about, for the seeded note.
 * Taken from the step's own wanted sets rather than from the slot's full
 * kind list, so the sentence names roles ("drummy and bassish") rather than
 * every trait a seeded stem happens to carry. */
function coveredKinds(
  covered: readonly CoachStepId[],
  flavour: CoachFlavour,
  slots: readonly CoachSlotSnapshot[]
): DiscoverSlotKind[] {
  const kinds = new Set<DiscoverSlotKind>()
  for (const id of covered) {
    const step = coachStepById(id)
    if (step === undefined) continue
    for (const want of resolveCoachStep(step, flavour).satisfiedBy ?? []) {
      if (!slots.some((slot) => slotCoversKindSet(slot, want))) continue
      for (const kind of want) kinds.add(kind)
    }
  }
  return normalizeSlotKinds([...kinds])
}

/**
 * The answer to "melodic or groove" (spec, phase 1 step 1), which is also
 * where a seeded start gets read: "seeded starts mark already-covered roles
 * done". Banks the time spent on the question, marks the covered steps
 * done, and lands on the first step that is genuinely still open.
 *
 * Asked once. A second answer returns the state untouched -- there is no
 * path to it in the UI (the offers only render on the question step), and
 * silently rewinding a flow that has moved on would be worse than ignoring
 * a dispatch that should not have happened.
 */
export function answerCoachFlavour(
  state: CoachState,
  now: number,
  flavour: CoachFlavour,
  slots: readonly CoachSlotSnapshot[]
): CoachState {
  if (state.flavour !== null) return state
  const covered = seededCoveredStepIds(flavour, slots)
  const order = coachStepOrder(flavour)
  const outcomes: Record<string, CoachOutcome> = { ...state.outcomes, 'p1-flavour': 'done' }
  for (const id of covered) outcomes[id] = 'done'
  const nextId =
    order.find((id) => id !== 'p1-flavour' && !covered.includes(id)) ?? order[order.length - 1]
  const banked = pauseCoach(state, now)
  return {
    ...banked,
    flavour,
    outcomes,
    stepId: nextId,
    stepElapsedMs: 0,
    runningSince: now,
    lineSeed: banked.lineSeed + 1,
    seededKinds: coveredKinds(covered, flavour, slots)
  }
}

/**
 * "lock in the climax" (spec, phase 1 step 5): freezes the loop's stems,
 * roles and gains onto the flow. Deliberately does NOT advance -- next and
 * skip stay the user's, and locking then changing your mind about the
 * balance should not have cost you the step.
 *
 * A lock with nothing resolved leaves the flow exactly as it was, rather
 * than storing an empty climax phase two would then have to special-case.
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

/** The one thought on screen. The satisfied line REPLACES the step's own
 * line rather than joining it -- "a new step's text replaces the old one;
 * nothing stacks" (spec) applies just as much inside a step. */
export function coachLineFor(state: CoachState, slots: readonly CoachSlotSnapshot[]): string {
  if (state.status === 'finished') return coachLine(state)
  if (coachStepSatisfied(state, slots)) {
    return pickLineVariant(COACH_STEP_SATISFIED_LINES, state.lineSeed)
  }
  return coachLine(state)
}

/** "you already have drummy and bassish. next: harmony." Returns null when
 * nothing was seeded, which is the common case. */
export function coachSeededLine(
  seededKinds: readonly DiscoverSlotKind[],
  nextStepLabel: string,
  seed: number
): string | null {
  if (seededKinds.length === 0) return null
  const names = seededKinds.map((kind) => DISCOVER_SLOT_KIND_LABEL[kind])
  const covered =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  return pickLineVariant(COACH_SEEDED_LINE_TEMPLATES, seed)
    .replace('{covered}', covered)
    .replace('{next}', nextStepLabel)
}
