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
 * The eight 'p1-' rows are phase one, the climax loop (build order step 2,
 * 2026-09-22). The three 'p2-' rows are phase two, shipped 2026-09-22 (build
 * order step 3); 'finish' is still a one-row PLACEHOLDER for build order
 * step 4, so the shell can be stepped through end to end before that phase
 * exists. Every line carries real, hand-written copy
 * rather than lorem, because the copy is the part that has to be reviewed by
 * a person, and every line is true by construction (they describe the STEP,
 * never the user's music -- see the spec's "What he is allowed to say").
 */

import type { CoachSectionOp } from './coachSections'
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

/** The three phases in the order the method runs them -- the checklist's
 * own order, and the only place that order is written down. */
const COACH_PHASE_ORDER: readonly CoachPhase[] = ['loop', 'arrangement', 'polish']

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
 * The 'p1-' rows are phase one, shipped 2026-09-22 (build order step 2);
 * they replaced the framework's single 'climax-loop' placeholder, so a
 * project saved by that build loads with an unknown stepId and is repaired
 * back to the first step -- see sanitiseLoadedCoach. The 'p2-' rows are
 * phase two, shipped 2026-09-22 (build order step 3); they replaced the
 * single 'sections' placeholder the same way. 'finish' is still a
 * placeholder, for build order step 4. */
export type CoachStepId =
  | 'p1-flavour'
  | 'p1-low-end'
  | 'p1-harmony'
  | 'p1-drums'
  | 'p1-supporting'
  | 'p1-hook'
  | 'p1-balance'
  | 'p1-lock'
  | 'p2-first'
  | 'p2-section'
  | 'p2-next'
  | 'finish'

/** What a move actually DOES, as data rather than as a callback -- the
 * renderer switches on `kind` and nothing in src/shared/ knows that
 * Discover, React or Electron exist. 'add-slot' adds one Discover slot
 * targeting `kinds`; 'lock-climax' freezes the loop (see ./coachClimax.ts);
 * 'section-op' presses one of the phase-two panel's own buttons (see
 * ./coachSections.ts's CoachSectionOp), so the bubble's "stuck?" list and
 * the panel can never offer two different sets of moves. */
export type CoachMoveAction =
  | { kind: 'add-slot'; kinds: readonly DiscoverSlotKind[] }
  | { kind: 'lock-climax' }
  | { kind: 'section-op'; op: CoachSectionOp }

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
   * groove question. Only two rows have one, and only for GROOVE: the low
   * end (which on a groove is the bass and the kick together, so it carries
   * a second move and a second satisfying kind set) and drums (whose groove
   * order puts it after that, so the step is aimed at the busier layer).
   * Everything else reads the same either way, and duplicating it into
   * twelve rows would just be two copies of the same copy to keep in sync.
   *
   * An override exists for what a step DOES differently, never for a
   * different story about what the user has by now -- next/skip mean no
   * step can assume the step before it produced anything. See
   * coachSteps.test.ts's "never asserts what is already in the project". */
  byFlavour?: Partial<Record<CoachFlavour, CoachStepOverride>>
}

/** Every phase-one step stands next to Discover's own add row -- the
 * arm-then-fire chip row this whole phase drives (DiscoverPanel.tsx's own
 * pendingAddKinds). One constant so a rename of the attribute is a single
 * edit here and one in DiscoverPanel.tsx. */
const DISCOVER_ADD_ROW = '[data-coach-anchor="discover-add-row"]'

/** Every phase-two step stands next to the arranger's own scrolling
 * timeline -- which is also what makes him WALK when phase one ends
 * (spec: "walk = moving to another area (Discover -> timeline)"). The
 * attribute is on App.tsx's timeline scroll container. */
const TIMELINE = '[data-coach-anchor="timeline"]'

/** One button per flavour, in COACH_FLAVOURS' own order (groove first).
 * The label is the flavour itself -- these are the two words the question
 * asks with. */
const FLAVOUR_OFFERS: readonly CoachOffer[] = COACH_FLAVOURS.map((flavour) => ({
  id: `flavour-${flavour}`,
  label: flavour,
  action: { kind: 'set-flavour', flavour }
}))

/** The spec's own third way in: "offers 'start from a riff you love'
 * (existing Discover seeding)". Not a flavour -- it opens the riff library,
 * and the answer to the question still has to be given afterwards. */
const SEED_FROM_RIFF_OFFER: CoachOffer = {
  id: 'seed-from-riff',
  label: 'start from a riff you love',
  action: { kind: 'open-riff-browser' }
}

export const COACH_STEPS: readonly CoachStepDef[] = [
  {
    id: 'p1-flavour',
    phase: 'loop',
    label: 'melodic or groove',
    lines: [
      'two ways in. melodic, or groove? it only sets the order of the next few steps.',
      'first question: melodic or groove. nothing rides on it except what we stack first.',
      'melodic or groove. either way you end up with the same loop, built in a different order.',
      'pick a way in -- melodic or groove -- or start from a riff you love.'
    ],
    // Deliberately empty. "do it for me" is disabled here, and that is the
    // point: answering this for you would be the app making a decision
    // about your track, which is the one thing this feature does not do.
    moves: [],
    // Mapped from COACH_FLAVOURS rather than written out, so "the two
    // flavours" is stated once: a third one (if there is ever a reason for
    // one) becomes a button here by existing, and cannot be added to the
    // union while quietly missing from the question that asks for it.
    offers: [...FLAVOUR_OFFERS, SEED_FROM_RIFF_OFFER],
    anchorSelector: DISCOVER_ADD_ROW
  },
  {
    id: 'p1-low-end',
    phase: 'loop',
    label: 'the low end',
    lines: [
      'the low end. a bassish stem, armed in the add row.',
      'this step is the bottom of the loop. bassish is armed below.',
      'low end next. one bassish stem; reroll it as often as you like.',
      'the floor of the loop goes in here. the add row is set to bassish.'
    ],
    moves: [
      {
        id: 'low-end-bass',
        label: 'add a bassish one',
        action: { kind: 'add-slot', kinds: ['bass'] }
      }
    ],
    primaryMoveId: 'low-end-bass',
    satisfiedBy: [['bass']],
    anchorSelector: DISCOVER_ADD_ROW,
    byFlavour: {
      groove: {
        label: 'the low end -- bass and kick',
        lines: [
          'grooves get built from underneath. bass and kick first, everything else sits on those.',
          'low end first. one bassish, one drummy -- both are under "stuck".',
          'start at the bottom: a bassish stem and a drummy one. that pair is the floor.',
          'this step is the low end, which for a groove means the bass and the kick together.'
        ],
        moves: [
          {
            id: 'low-end-bass',
            label: 'add a bassish one',
            action: { kind: 'add-slot', kinds: ['bass'] }
          },
          {
            id: 'low-end-drums',
            label: 'add a drummy one',
            action: { kind: 'add-slot', kinds: ['drums'] }
          }
        ],
        primaryMoveId: 'low-end-bass',
        satisfiedBy: [['bass'], ['drums']]
      }
      // No melodic override any more. The one it had existed only to say
      // the bass goes "under the harmony you just picked" -- which the
      // melodic ORDER makes likely and next/skip make false whenever the
      // harmony step was skipped. The base row above says what this step
      // is for without claiming anything about the project, and reads
      // correctly on every route into it.
    }
  },
  {
    id: 'p1-harmony',
    phase: 'loop',
    label: 'harmony',
    lines: [
      'harmony next. the add row is armed for leadesque and buttery together.',
      'this is the chords step. leadesque \u00b7 buttery, as one slot.',
      'something to hold the chords: leadesque, on the buttery side.',
      'harmony now. one slot, both kinds -- and a plain leadesque one is under "stuck".'
    ],
    moves: [
      {
        id: 'harmony-warm-lead',
        label: 'add a leadesque \u00b7 buttery one',
        action: { kind: 'add-slot', kinds: ['lead', 'warm'] }
      },
      {
        id: 'harmony-lead',
        label: 'add a plain leadesque one',
        action: { kind: 'add-slot', kinds: ['lead'] }
      }
    ],
    primaryMoveId: 'harmony-warm-lead',
    satisfiedBy: [['lead']],
    anchorSelector: DISCOVER_ADD_ROW
  },
  {
    id: 'p1-drums',
    phase: 'loop',
    label: 'drums',
    lines: [
      'drums now. the add row is armed for drummy.',
      'time for the kit. this step is one drummy stem.',
      'this step is drums. add one, reroll it as many times as you like.',
      'drums go in here. drummy is armed below.'
    ],
    moves: [
      {
        id: 'drums-plain',
        label: 'add a drummy one',
        action: { kind: 'add-slot', kinds: ['drums'] }
      }
    ],
    primaryMoveId: 'drums-plain',
    satisfiedBy: [['drums']],
    anchorSelector: DISCOVER_ADD_ROW,
    byFlavour: {
      groove: {
        label: 'drums, filled out',
        lines: [
          'this step is the busy end of the kit -- drummy, on the rhythmic side.',
          'drums that move. the add row is armed for drummy \u00b7 rhythmic.',
          'the kit fills out here. drummy \u00b7 rhythmic is armed; a plain drummy one is under "stuck".',
          'this one is for the part of the kit that keeps moving. reroll it as often as you like.'
        ],
        moves: [
          {
            id: 'drums-rhythmic',
            label: 'add a drummy \u00b7 rhythmic one',
            action: { kind: 'add-slot', kinds: ['drums', 'rhythmic'] }
          },
          {
            id: 'drums-plain',
            label: 'add a plain drummy one',
            action: { kind: 'add-slot', kinds: ['drums'] }
          }
        ],
        primaryMoveId: 'drums-rhythmic',
        satisfiedBy: [['drums', 'rhythmic']]
      }
    }
  },
  {
    id: 'p1-supporting',
    phase: 'loop',
    label: 'supporting parts',
    lines: [
      'supporting parts. chonky, rhythmic or sparkly -- one of the three, whichever you fancy.',
      'this step is the layer between the parts: chonky, rhythmic, sparkly.',
      'something to sit in the gaps. the add row is armed for chonky; the other two are under "stuck".',
      'supporting layer now. three kinds to choose from, one slot.'
    ],
    moves: [
      {
        id: 'supporting-chonky',
        label: 'add a chonky one',
        action: { kind: 'add-slot', kinds: ['bassHeavy'] }
      },
      {
        id: 'supporting-rhythmic',
        label: 'add a rhythmic one',
        action: { kind: 'add-slot', kinds: ['rhythmic'] }
      },
      {
        id: 'supporting-sparkly',
        label: 'add a sparkly one',
        action: { kind: 'add-slot', kinds: ['bright'] }
      }
    ],
    primaryMoveId: 'supporting-chonky',
    // A drummy \u00b7 rhythmic stem from the previous step is also a superset of
    // ['rhythmic'], so on a groove this step can read as satisfied the
    // moment it starts. That is honest: the tick reports a fact about the
    // slots, not a claim that the step's work is done -- and next/skip are
    // always there either way.
    satisfiedBy: [['bassHeavy'], ['rhythmic'], ['bright']],
    anchorSelector: DISCOVER_ADD_ROW
  },
  {
    id: 'p1-hook',
    phase: 'loop',
    label: 'the hook',
    lines: [
      'the hook. roll three or four of them and pick between them -- comparing is the whole step.',
      'hook step. add one, then add another, then another. the point is having options.',
      'this one is the hook. try three or four before you settle on one.',
      'the hook goes here. leadesque \u00b7 sparkly is armed; reroll it a few times.'
    ],
    moves: [
      {
        id: 'hook-first',
        label: 'add a leadesque \u00b7 sparkly one',
        action: { kind: 'add-slot', kinds: ['lead', 'bright'] }
      },
      {
        id: 'hook-another',
        label: 'add another one to compare',
        action: { kind: 'add-slot', kinds: ['lead', 'bright'] }
      }
    ],
    primaryMoveId: 'hook-first',
    satisfiedBy: [['lead', 'bright']],
    anchorSelector: DISCOVER_ADD_ROW
  },
  {
    id: 'p1-balance',
    phase: 'loop',
    label: 'rough balance',
    lines: [
      'rough balance. drag a slot waveform up or down to set its level -- it carries onto the timeline.',
      'levels now. each slot has its own gain, set by dragging on its waveform.',
      'set a rough balance while the loop plays. nothing here is permanent.',
      'this is the last step before the loop gets locked. rough is fine.'
    ],
    // Nothing to automate: a balance is the user listening. The bubble says
    // so plainly (COACH_NO_MOVES_LINES) rather than inventing a move.
    moves: [],
    anchorSelector: DISCOVER_ADD_ROW
  },
  {
    id: 'p1-lock',
    phase: 'loop',
    label: 'lock in the climax',
    lines: [
      'lock the loop in. its stems, roles and levels become the material the next phase carves from.',
      'this is the freeze. locking keeps a copy of the loop as it stands right now.',
      'lock in the climax. nothing is destroyed -- it just gives phase two something to subtract from.',
      'ready to lock? the loop as it is becomes the full version of every section.'
    ],
    moves: [{ id: 'lock-climax', label: 'lock the loop in', action: { kind: 'lock-climax' } }],
    primaryMoveId: 'lock-climax',
    anchorSelector: DISCOVER_ADD_ROW
  },
  {
    id: 'p2-first',
    phase: 'arrangement',
    label: 'what comes first',
    lines: [
      'phase two: sections, one at a time. what comes first -- an intro, or straight into a build?',
      'now you carve. an intro is the usual opening; a build is the short-sketch opening.',
      'first section. intro eases in, build gets to the drop sooner. either is a fine start.',
      'pick what opens the track. nothing is permanent -- every section is ordinary clips after.'
    ],
    // No moves, deliberately: which section opens the track is an answer
    // only the user can give, exactly like the melodic-or-groove question.
    // "do it for me" stays disabled here and that is the point.
    moves: [],
    anchorSelector: TIMELINE
  },
  {
    id: 'p2-section',
    phase: 'arrangement',
    label: 'carve a section',
    lines: [
      'every stem from the locked loop is on. switch off what this section does not need.',
      'this section starts as the whole climax loop. subtracting is the only thing that changes it.',
      'name it, set its length, then turn things off. nothing comes out unless you take it out.',
      'nothing is off yet. the marked ones are what this kind of section usually loses.'
    ],
    // The panel's own three buttons, restated here so the bubble's "stuck?"
    // list and "do it for me" can never offer a different set of moves than
    // the panel shows. "drop the suggested ones" is the primary one because
    // it is the single shortcut the spec names -- and it still only ever
    // runs on a click, leaving the everything-on default until then.
    moves: [
      {
        id: 'section-drop-suggested',
        label: 'drop the suggested ones',
        action: { kind: 'section-op', op: 'drop-suggested' }
      },
      {
        id: 'section-preview',
        label: 'loop just this section',
        action: { kind: 'section-op', op: 'preview' }
      },
      {
        id: 'section-place',
        label: 'put it on the timeline',
        action: { kind: 'section-op', op: 'place' }
      }
    ],
    primaryMoveId: 'section-drop-suggested',
    anchorSelector: TIMELINE
  },
  {
    id: 'p2-next',
    phase: 'arrangement',
    label: 'what comes next',
    // Nothing here says a section went down. The placed case has its own
    // line, built from the section's real name (coachSectionLine,
    // ./coachPhase2.ts); these show on the route that reaches this step
    // WITHOUT placing anything, which is skip from the section step.
    lines: [
      'what comes next? the panel lists the usual follow-ons.',
      'pick what follows, or stop here -- skip ends phase two.',
      'another section, or call the arrangement done and move on to polish.',
      'this step is the question: one more section, or out to phase three. an outro ends it.'
    ],
    // Same reasoning as p2-first: what follows is the user's call.
    moves: [],
    anchorSelector: TIMELINE
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

/** Phase one in groove order. Also the order COACH_STEPS itself is written
 * in, and the order used before the question has been answered -- the two
 * differ only in whether the low end or the harmony comes first, so a
 * checklist opened before answering shows a real order, not a guess, and
 * reorders itself the moment an answer lands. */
const PHASE1_GROOVE_ORDER: readonly CoachStepId[] = [
  'p1-flavour',
  'p1-low-end',
  'p1-harmony',
  'p1-drums',
  'p1-supporting',
  'p1-hook',
  'p1-balance',
  'p1-lock'
]

const PHASE1_MELODIC_ORDER: readonly CoachStepId[] = [
  'p1-flavour',
  'p1-harmony',
  'p1-low-end',
  'p1-drums',
  'p1-supporting',
  'p1-hook',
  'p1-balance',
  'p1-lock'
]

/** Phase two's own loop plus phase three's remaining placeholder. The
 * answer to the melodic-or-groove question does not reach them.
 *
 * p2-section repeats: the flow walks p2-first -> p2-section -> p2-next and
 * then goes BACK to p2-section for as long as the user keeps choosing
 * another section (startCoachSection, ./coachPhase2.ts). This flat order is
 * still what advanceCoach's next/skip walks, so skipping from p2-next lands
 * on 'finish' -- which is exactly "stop arranging and go to polish". */
const LATER_PHASE_ORDER: readonly CoachStepId[] = ['p2-first', 'p2-section', 'p2-next', 'finish']

/** The whole flow, in the order this answer puts it in. */
export function coachStepOrder(flavour: CoachFlavour | null): readonly CoachStepId[] {
  const phase1 = flavour === 'melodic' ? PHASE1_MELODIC_ORDER : PHASE1_GROOVE_ORDER
  return [...phase1, ...LATER_PHASE_ORDER]
}

/** The next step in this flavour's own order, or null when this is the last
 * one -- which is what ends the flow (see advanceCoach in ./coach.ts).
 * `flavour` is required rather than defaulted on purpose: a caller that
 * forgets it would silently walk a melodic flow in groove order, and a
 * typecheck failure is a much cheaper way to find that out. */
export function nextCoachStepId(id: CoachStepId, flavour: CoachFlavour | null): CoachStepId | null {
  const order = coachStepOrder(flavour)
  const index = order.indexOf(id)
  if (index < 0 || index >= order.length - 1) return null
  return order[index + 1]
}

/** This phase's steps, in this flavour's order, with per-flavour overrides
 * already applied -- the checklist renders these directly. */
export function coachStepsInPhase(
  phase: CoachPhase,
  flavour: CoachFlavour | null = null
): readonly CoachStepDef[] {
  const steps: CoachStepDef[] = []
  for (const id of coachStepOrder(flavour)) {
    const step = coachStepById(id)
    if (step === undefined || step.phase !== phase) continue
    steps.push(resolveCoachStep(step, flavour))
  }
  return steps
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
