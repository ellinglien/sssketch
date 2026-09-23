/**
 * What the guided flow IS, as plain data.
 *
 * Everything sssketchy can say and every place the flow can be is a row in
 * COACH_STEPS below -- the state machine in ./coach.ts only ever walks this
 * table, so the later phase plans (docs/superpowers/specs/
 * 2026-09-22-sssketchy-guided-track-design.md, build order 2/3/4) add their
 * steps by APPENDING ROWS and extending the CoachStepId union, without
 * reshaping the machine, the store, the persistence or the panel.
 *
 * The three steps shipped here are deliberate PLACEHOLDERS -- one per phase,
 * so the shell can be started, stepped through, minimised, dismissed and
 * resumed end to end before any phase logic exists. They carry real,
 * hand-written copy rather than lorem, because the copy is the part that has
 * to be reviewed by a person and the placeholder lines are all still true by
 * construction (they describe the METHOD, never the user's music -- see the
 * spec's "What he is allowed to say").
 */

import type { DiscoverSlotKind } from './discoverSlotKind'

export type CoachPhase = 'loop' | 'arrangement' | 'polish'

/**
 * The spec's opening question: "sssketchy asks melodic or groove". It is
 * the ONLY thing in this feature that reorders anything, and it reorders
 * exactly two steps (see COACH_STEP_ORDER below) -- it is a starting point,
 * not a genre, and nothing anywhere treats it as a claim about the music.
 */
export type CoachFlavour = 'melodic' | 'groove'

/** Groove first, matching the order the offers are rendered in. */
export const COACH_FLAVOURS: readonly CoachFlavour[] = ['groove', 'melodic']

export function isCoachFlavour(value: unknown): value is CoachFlavour {
  return value === 'groove' || value === 'melodic'
}

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
  loop: { id: 'loop', label: 'the climax loop', targetMinMinutes: 60, targetMaxMinutes: 90 },
  arrangement: {
    id: 'arrangement',
    label: 'the arrangement',
    targetMinMinutes: 120,
    targetMaxMinutes: 180
  },
  polish: { id: 'polish', label: 'polish and export', targetMinMinutes: 45, targetMaxMinutes: 60 }
}

export const COACH_PHASES: readonly CoachPhaseDef[] = [
  COACH_PHASE_BY_ID.loop,
  COACH_PHASE_BY_ID.arrangement,
  COACH_PHASE_BY_ID.polish
]

/** Total, by construction -- CoachPhase is a closed union over the record's
 * own keys, so there is no "unknown phase" branch to get wrong. */
export function coachPhaseDef(phase: CoachPhase): CoachPhaseDef {
  return COACH_PHASE_BY_ID[phase]
}

/** Every step the flow can be on. A closed union rather than a bare string
 * so a typo in a later phase plan is a typecheck failure -- persisted
 * values are validated back into it by isCoachStepId (a .sssketchproj is
 * plain JSON people can and do hand-edit; a load must never throw). */
export type CoachStepId = 'climax-loop' | 'sections' | 'finish'

/** What a move actually DOES, as data rather than as a callback -- the
 * renderer switches on `kind` and nothing in src/shared/ knows that
 * Discover, React or Electron exist. 'add-slot' adds one Discover slot
 * targeting `kinds`; 'lock-climax' freezes the loop (see ./coachClimax.ts). */
export type CoachMoveAction =
  { kind: 'add-slot'; kinds: readonly DiscoverSlotKind[] } | { kind: 'lock-climax' }

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

/** An answer only the user can give. Rendered as its own button row above
 * the bubble's fixed next/skip row -- deliberately NOT a move, because "do
 * it for me" must never pick one of these: choosing melodic or groove for
 * you would be exactly the kind of decision the spec keeps him out of. */
export type CoachOfferAction =
  { kind: 'set-flavour'; flavour: CoachFlavour } | { kind: 'open-riff-browser' }

export interface CoachOffer {
  id: string
  label: string
  action: CoachOfferAction
}

/** The overridable half of a step row -- see CoachStepDef.byFlavour. */
export interface CoachStepOverride {
  label?: string
  lines?: readonly string[]
  moves?: readonly CoachMove[]
  primaryMoveId?: string
  satisfiedBy?: readonly (readonly DiscoverSlotKind[])[]
}

export interface CoachStepDef {
  id: CoachStepId
  phase: CoachPhase
  /** The checklist's own one-liner for this step. */
  label: string
  /** 3-4 hand-written variants of this step's bubble line, rotated
   * deterministically by CoachState.lineSeed (see ./coachLines.ts's
   * pickLineVariant). "Repeating himself word-for-word is most of what
   * makes a character feel dead" (spec). */
  lines: readonly string[]
  /** Every concrete move this step can make. Empty on a step with nothing
   * to automate -- an invented move would be a lie in the one part of this
   * feature that must never guess. */
  moves: readonly CoachMove[]
  /** Which of `moves` the bubble's "do it for me" runs. Absent when doing
   * it for you would be a decision only the user can make (the melodic-or-
   * groove question), which is what disables that button. */
  primaryMoveId?: string
  /** What "a step completes when a slot with those kinds resolves" (spec)
   * means for this step, as a list of kind SETS: the step is satisfied when
   * some resolved slot's own kinds are a superset of any one of them. One
   * rule covers alternatives (supporting: chonky OR rhythmic OR sparkly --
   * three single-kind sets) and combinations (the hook: one {leadesque,
   * sparkly} set). Empty/absent = never satisfied automatically, which is
   * right for a listening step. Satisfaction is DERIVED from the current
   * slots, never stored: delete the slot and the tick goes away. */
  satisfiedBy?: readonly (readonly DiscoverSlotKind[])[]
  /** Answers this step asks for. Only the flavour question has these. */
  offers?: readonly CoachOffer[]
  /** CSS selector for the element this step is about -- sssketchy stands on
   * the bottom edge near it, and WALKS when it changes between steps (spec:
   * "walk = moving to another area (Discover -> timeline)"). Same
   * look-it-up-fresh approach TourOverlay.tsx already uses for the same
   * reason: targets live in unrelated components with no shared parent
   * worth threading refs through. */
  anchorSelector?: string
  /** The parts of this row that change with the answer to the melodic-or-
   * groove question. Only two rows have one: the low end (groove wants a
   * kick alongside the bass; melodic wants bass under the harmony that is
   * already there) and drums (groove has already placed a kick, so its
   * drums step is the kit filling out). Everything else reads the same
   * either way, and duplicating it into twelve rows would just be two
   * copies of the same copy to keep in sync. */
  byFlavour?: Partial<Record<CoachFlavour, CoachStepOverride>>
}

export const COACH_STEPS: readonly CoachStepDef[] = [
  {
    id: 'climax-loop',
    phase: 'loop',
    label: 'build the climax loop',
    lines: [
      'phase one: the loudest bar of the track. build that loop first, everything else gets carved out of it.',
      'start at the drop. the fullest version of the song is the one you build first.',
      'phase one is the climax loop. every other section is this one with things taken away.',
      'first job: the part where everything is playing. that loop is the material for the rest.'
    ],
    moves: []
  },
  {
    id: 'sections',
    phase: 'arrangement',
    label: 'carve the sections',
    lines: [
      'phase two: sections, one at a time. each one is the climax loop with stems turned off.',
      'now you carve. name a section, pick its length, decide what drops out.',
      'phase two builds the arrangement section by section. everything is on until you subtract.',
      'one section at a time from here. the loop you locked is the full version of each one.'
    ],
    moves: []
  },
  {
    id: 'finish',
    phase: 'polish',
    label: 'finish and export a v1',
    lines: [
      'phase three: transitions, a balance pass, then a v1 out the door.',
      'last phase. smooth the joins, check the levels, export something you can listen to.',
      'phase three is finishing. risers into the drops, a balance check, then export.',
      'nearly there. tension at the boundaries, one listen through, then v1.'
    ],
    moves: []
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

/** The next row in the table, or null when this is the last step -- which
 * is what ends the flow (see advanceCoach in ./coach.ts). */
export function nextCoachStepId(id: CoachStepId): CoachStepId | null {
  const index = COACH_STEPS.findIndex((step) => step.id === id)
  if (index < 0 || index >= COACH_STEPS.length - 1) return null
  return COACH_STEPS[index + 1].id
}

export function coachStepsInPhase(phase: CoachPhase): readonly CoachStepDef[] {
  return COACH_STEPS.filter((step) => step.phase === phase)
}

/** Flattens a row's per-flavour override into the row itself. Everything
 * downstream (the bubble, the checklist, the satisfaction checks) reads
 * steps through this, so there is exactly one place that knows overrides
 * exist. Idempotent: the result carries no `byFlavour`, so resolving twice
 * cannot apply an override to an already-overridden row. */
export function resolveCoachStep(step: CoachStepDef, flavour: CoachFlavour | null): CoachStepDef {
  const override = flavour === null ? undefined : step.byFlavour?.[flavour]
  if (override === undefined) return step
  return { ...step, ...override, byFlavour: undefined }
}

/** The move "do it for me" runs, or null when this step has none. */
export function coachStepPrimaryMove(
  step: CoachStepDef,
  flavour: CoachFlavour | null
): CoachMove | null {
  const resolved = resolveCoachStep(step, flavour)
  if (resolved.primaryMoveId === undefined) return null
  return resolved.moves.find((move) => move.id === resolved.primaryMoveId) ?? null
}

/** The kinds this step pre-arms in Discover's add row -- deliberately
 * derived from the primary move rather than stored a second time, so "what
 * the row is armed with" and "what do-it-for-me adds" can never drift
 * apart. null for a step that arms nothing. */
export function coachStepArmKinds(
  step: CoachStepDef,
  flavour: CoachFlavour | null
): readonly DiscoverSlotKind[] | null {
  const move = coachStepPrimaryMove(step, flavour)
  if (move === null || move.action.kind !== 'add-slot') return null
  return move.action.kinds
}
