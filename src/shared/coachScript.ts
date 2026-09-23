/**
 * ============================================================================
 * SSSKETCHY'S SCRIPT
 * ============================================================================
 *
 * Every user-visible line sssketchy speaks, in the order a user meets them,
 * and nothing else. If you want to change a word he says, it is in this
 * file. No other file in the app holds his copy.
 *
 * Read from the top and it runs like a screenplay: the two opening
 * questions, the phrase report, the pre-fill note, the map, the section
 * walk and its goals, leaving the walk, the tension pass, the balance
 * check, export and sign-off, then the stuck nudge and the generic
 * fallbacks he falls back on anywhere.
 *
 * ----------------------------------------------------------------------------
 * THE RULES. READ THESE BEFORE EDITING A LINE.
 * ----------------------------------------------------------------------------
 *
 * From the spec, docs/superpowers/specs/2026-09-23-arrangement-map-design.md,
 * "Tone: a gentle coach, not a teacher or a drill sergeant" -- Elling's own
 * words, and "the hardest part of this to get right":
 *
 *   - **Not a drill sergeant.** No imperatives aimed at the user, no
 *     checklists of what they must do next, no counting what they have not
 *     finished. He never chases.
 *   - **Not a teacher.** He is not explaining music theory, and a step is
 *     not a lesson. If a line could open with "remember that...", it is
 *     wrong.
 *   - **A gentle coach.** He says what a section is for, offers a way in,
 *     and is comfortable being ignored. He is at ease with the user
 *     skipping, leaving, or doing the opposite.
 *
 * The spec's own table of what each one sounds like:
 *
 *   | drill sergeant | "add a riser here. next: thin out the verse."        |
 *   | teacher        | "a verse, by definition, establishes the melodic     |
 *   |                |  motif before the drop."                            |
 *   | gentle coach   | "this one is the lift into the drop. want to try     |
 *   |                |  taking the hook out?"                              |
 *   | gentle coach   | "nothing has to change here. it already does its     |
 *   |                |  job."                                              |
 *
 * That last row matters: **he is allowed to say a section needs nothing.**
 * "A coach who always has a suggestion is a drill sergeant with better
 * manners."
 *
 * THE TEST TO APPLY TO EVERY LINE: *could a friend say this while leaning
 * over your shoulder, without it being annoying?*
 *
 * And the governing rule for the section walk (spec, twice): **goals, not
 * dictates. advice, not rules.**
 *
 *   - Good: "the verse should hint at the drop without giving it away."
 *   - Good: "this is where it lifts."
 *   - Bad: "add a riser at bar 48."
 *   - Bad: anything asserting his track needs something.
 *
 * A goal is a statement about song structure, which is true regardless of
 * what the user made -- so it cannot be wrong about music the app has not
 * heard. He has not heard it. Nothing here may have an opinion about it.
 *
 * The mechanical rules, carried over unchanged from the superseded spec:
 *
 *   - One thought at a time; a new step's text replaces the old. No stack.
 *   - Copy is hand-written, **3-4 rotated variants**, **lowercase**, **no
 *     emoji**, **no exclamation marks**.
 *   - The step triggers him; he never decides when to speak and never
 *     judges the music.
 *
 * All of the above is enforced by ./coachScript.test.ts and
 * ./coachLines.test.ts, which sweep this whole object. A line that breaks
 * a rule fails `npx vitest run`, it does not ship quietly.
 *
 * ----------------------------------------------------------------------------
 * HOW THE ROTATION WORKS
 * ----------------------------------------------------------------------------
 *
 * Each table holds 3-4 variants of the same thought. Which one shows is
 * chosen by `pickLineVariant` (./coachLines.ts) as a modulo index over
 * `CoachState.lineSeed`, which is bumped exactly once per step transition
 * -- **seeded, never Math.random**, so a line is stable for as long as its
 * thought is, and rotates when the thought does. Add or remove a variant
 * freely; the rotation simply gets longer or shorter.
 *
 * Some lines carry a `{placeholder}`, filled in by the caller. Each one is
 * named where it appears below. A placeholder that is not filled in is
 * shown to the user literally, braces and all, so spell them exactly.
 */

import type { CoachSectionType } from './coachSections'
import type { CoachStepId } from './coachSteps'

/** The script's shape. `steps` and `sectionGoals` are keyed by the app's
 * own closed unions, so a mistyped or missing key is a `npm run typecheck`
 * failure rather than a silent runtime gap that leaves him mute. */
interface CoachScript {
  readonly loopQuestion: readonly string[]
  readonly shapeQuestion: readonly string[]
  readonly phraseReport: readonly string[]
  readonly prefilled: readonly string[]
  readonly steps: Readonly<Record<CoachStepId, readonly string[]>>
  readonly walkStart: readonly string[]
  readonly sectionGoals: Readonly<Record<CoachSectionType, readonly string[]>>
  readonly walkEnd: readonly string[]
  readonly tension: readonly string[]
  readonly tensionNone: readonly string[]
  readonly v1Exported: readonly string[]
  readonly done: readonly string[]
  readonly stuck: readonly string[]
  readonly noMoves: readonly string[]
  readonly stepSatisfied: readonly string[]
}

export const COACH_SCRIPT: CoachScript = {
  // ==========================================================================
  // 1. THE TWO OPENING QUESTIONS
  //    The auto-arranger's setup screen, before any map exists. One at a
  //    time: he asks whichever is still unanswered (coachSetupLine,
  //    ./coachWalk.ts).
  // ==========================================================================

  /** "What is this loop?" -- the first thing he ever says. Shown above the
   * drop / verse / intro / not sure buttons. It decides where the material
   * the user already has lands in the structure.
   *
   * Note what none of these do: none of them tells him what the loop IS.
   * The app has not heard it. Every variant asks, and the last one says
   * plainly what "not sure" will be taken to mean, so choosing it is not a
   * trapdoor.
   *
   * **Every variant also admits the flow is new and rough.** Said once, in
   * his own voice, here, because this is the first thing he ever says --
   * honest rather than apologetic, a coach admitting something rather than a
   * notice disclaiming anything. The route screen's "walk me through it"
   * button carries the same qualifier for anyone who never reaches this. */
  loopQuestion: [
    'new flow, still rough, so bear with me: is this loop a drop, a verse, or an intro?',
    'heads up, this one is new and rough, so: drop, verse, or intro?',
    "i should say up front that this walkthrough is new and it's rough in places, so treat everything i say as a suggestion. where does this loop live in a track: drop, verse, intro, or leave it to me?",
    'rough new flow, this. what is the loop to you, and if you are not sure i take it as the drop.'
  ],

  /** "How long a journey?" -- the second question, shown above the short /
   * standard / long buttons. The buttons carry the letter notation
   * (`A B C D B C D A`), which is why none of these spell the shapes out.
   *
   * There is deliberately no genre here and there must not be
   * (coachShapes.ts explains why at length): the section ORDER barely
   * varies by genre, so a genre list would be one template wearing six
   * names. */
  shapeQuestion: [
    'how long a journey: short is about two minutes, standard four, long six.',
    'a length, then.',
    'how far do you want to travel? the letters are the sections in order, a is the intro and the outro, and the same order holds however long you go.',
    'length next, and any of these is a fine shape; you can move all of it afterwards.'
  ],

  // ==========================================================================
  // 2. THE PHRASE REPORT
  //    Once, before the map is built, and only when the measurement found
  //    something worth saying (coachPhraseLine, ./coachPhrase.ts). If the
  //    measurement is inconclusive he says nothing here rather than
  //    guessing.
  // ==========================================================================

  /** `{nominal}` is the loop's nominal bar count, `{phrase}` the measured
   * one -- both filled in by coachPhraseLine. It is only ever shown when
   * the two differ, so every variant can say so plainly.
   *
   * Note what these do NOT do: none of them tells the user to change
   * anything. The finding is a fact about the audio; what to do about it is
   * his, and the third variant says so out loud. The advice this enables is
   * the ignorable kind -- "you could halve this loop and get twice the
   * arrangement out of the same material" -- never an instruction. */
  phraseReport: [
    'this {nominal}-bar loop is really the same {phrase} bars twice.',
    '{nominal} bars on paper, {phrase} in practice.',
    'the phrase in here is {phrase} bars, sitting inside a {nominal}-bar loop, which is worth knowing before we size anything -- your call which number we build on.',
    'measured: {phrase} bars of material, {nominal} bars of loop.'
  ],

  // ==========================================================================
  // 3. THE PRE-FILL NOTE
  //    On the auto-arranger's coach step (AutoArrangeCoachStep.tsx), the
  //    moment a map arrives with its cells already filled in from the
  //    template.
  // ==========================================================================

  /** Elling's condition for the pre-fill being allowed at all (spec, "The
   * map arrives pre-filled, and says so"): **he states that HE made the
   * call, and states the way out.** Every variant must name cmd+z or undo.
   * The first variant is the spec's own wording. */
  prefilled: [
    'that is the usual shape, and cmd+z brings every cell back on.',
    "i filled this in. one cmd+z and it's all back.",
    'pre-filled by me, from the standard arrangement, because a blank grid is a worse place to start than a wrong one -- undo once for the everything-on version.',
    "a guess at the shape, not a rule. cmd+z if you'd rather start from full."
  ],

  // ==========================================================================
  // 4. THE STEPS
  //    The bubble's own line on each of the six steps, in the one order the
  //    flow runs them. The behaviour of each step -- its moves, its anchor,
  //    its checklist label -- lives in ./coachSteps.ts, which reads its
  //    lines from here.
  //
  //    A step's line is what he says while you are standing on that step
  //    with nothing more specific to say: the walk, the phrase report and
  //    the tension count all override it when they apply.
  // ==========================================================================

  steps: {
    /** THE MAP, just arrived, whole. Nothing here tells the user to do
     * anything with it -- it says what the thing in front of them is. */
    'p2-first': [
      'there is the whole song, one column per section, one square per pass.',
      'that is the map.',
      'a shape to push against. nothing on it is settled.',
      'the arrangement seen from further back, all ordinary clips underneath, with the toggle up top swapping between this and the timeline.'
    ],

    /** WALK THE SECTIONS, when he is on the walk step but not standing on
     * a column (the walk's own per-section goals, section 6 below, replace
     * this the moment he is). */
    'p2-section': [
      'the whole song at once, a column per section, a square per pass.',
      'switch a square off and the clip goes.',
      'this is the shape, filled in. change what you like, or leave all of it.',
      'the map and the timeline are the same arrangement, two ways of looking at one thing, and the toggle up top swaps them.'
    ],

    /** WHEN YOU ARE DONE HERE -- the hand-off out of the arrangement phase.
     * Nothing here chases: when the arrangement is finished is the user's
     * call. */
    'p2-next': [
      'the map keeps working long after this.',
      'nothing here is waiting on you.',
      'stay on the map as long as it is useful, or carry on to polish whenever.',
      'the arrangement is yours now, and what is left is the joins, the levels and a v1 out -- leaving the walk changes nothing on the map.'
    ],

    /** THE TENSION PASS, first step of the polish phase. Replaced by the
     * join-counting line (section 7 below) as soon as the flow has any
     * section boundaries to count. */
    'p3-tension': [
      'phase three, and the joins come first: a sweep into a drop, a fade into a breakdown.',
      'the seams, now.',
      'nothing is on until you switch it on, and what it makes is an ordinary curve.',
      'this step reads the names you gave the sections: a drop gets a sweep and a swell, and a build into a drop also gets a riser.'
    ],

    /** THE BALANCE CHECK. He can start it playing and nothing else --
     * what the levels should be is a person listening, and the third
     * variant says so. */
    'p3-balance': [
      'balance check, and levels, while the whole thing runs.',
      'one listen, top to bottom, with the row gains to hand.',
      'this step is levels. what they should be is yours -- i can only start it playing.',
      'the gain on each row is the only control this step is about, and whether it is right is a person listening, not me.'
    ],

    /** EXPORT A V1, the last step. Replaced by the exported line (section 8
     * below) once a file has really come out. */
    'p3-export': [
      'last step: a v1.',
      'a mix, the stems, or an ableton or reaper project, whichever you want a v1 in.',
      'export time. the usual picker, and the project gets marked once a file really comes out.',
      'this is the end of the method, and what it ends with is something you can listen to away from here: a mix is quickest, the daw projects carry the curves across as well.'
    ]
  },

  // ==========================================================================
  // 5. ENTERING THE WALK
  //    When the user takes him up on walking the sections.
  // ==========================================================================

  /** Every variant states the way out in the same breath as the offer --
   * "leaving the walk keeps the map" (spec) is the single thing a user
   * needs to know before agreeing to be walked anywhere. */
  walkStart: [
    'section by section, then. stepping out keeps everything as it is.',
    'leave whenever you like, the map stays.',
    'we can walk these in order, and the map is yours either way.',
    "i will go through the sections one at a time, and if you've had enough of that halfway through, leaving does not undo anything."
  ],

  // ==========================================================================
  // 6. THE SECTION GOALS -- the whole of the walk's copy
  //    One per column he stands on, keyed ONLY by the section's TYPE. That
  //    is what keeps them honest: what he says is a statement about song
  //    structure, true regardless of what the user made.
  //
  //    The variant rotates on `lineSeed + walkIndex` rather than on
  //    `lineSeed` alone (coachWalkLine, ./coachWalk.ts), so the two verses
  //    and two drops of a standard shape do not get the same sentence
  //    about themselves.
  //
  //    **Every one of these six tables must keep at least one variant that
  //    says the section may need NOTHING.** That is not filler: "a coach
  //    who always has a suggestion is a drill sergeant with better
  //    manners" (spec). A table that loses its last one fails the tests.
  // ==========================================================================

  sectionGoals: {
    /** Standing on an intro column. */
    intro: [
      "the way in, and it doesn't have to do much.",
      'first thing anyone hears.',
      'the less the opening gives away, the further the rest of it has to travel.',
      'nothing has to change here if you like it as it is.'
    ],

    /** Standing on a verse column. The first variant is the spec's own
     * example of a good goal. */
    verse: [
      'the verse should hint at the drop without giving it away.',
      'want to try taking the hook out?',
      'the stretch between the big moments, which can be a lot quieter than you would think and still hold the whole thing together.',
      'nothing has to change here if it already carries.'
    ],

    /** Standing on a build column. */
    build: [
      'this is where it lifts.',
      'taking something away here often lifts harder than adding.',
      'the lift into the drop, and the fewer parts it has on the way up, the more the drop has left to add.',
      'nothing has to change if it already pulls.'
    ],

    /** Standing on a drop column -- usually the loop the user arrived
     * with, which is why none of these ask for anything. */
    drop: [
      'this is the payoff, and everything you have is welcome here.',
      'the big one.',
      "the top of the track, and usually the loop you arrived with, which is why i'm not going to ask it for anything -- it already does its job.",
      'nothing has to come out here unless you want it to.'
    ],

    /** Standing on a breakdown column (the long shape only). */
    breakdown: [
      'a breakdown empties the room out for a moment, which is most of why the thing after it lands.',
      'the drop with the floor taken out.',
      'the quiet stretch.',
      'this is space, and it can be very little and still work, so nothing has to change here.'
    ],

    /** Standing on an outro column -- the last one in every shape. */
    outro: [
      'the way out. parts leaving one at a time is usually enough.',
      "an outro lets go, and it doesn't need a new idea.",
      'thinning out is the whole move.',
      'the end of the journey, the last stretch of it, and nothing has to change here.'
    ]
  },

  // ==========================================================================
  // 7. LEAVING THE WALK
  // ==========================================================================

  /** Stepping out of the walk, at the end or early -- both use the same
   * table, because leaving early is not a failure. Reports the state of
   * things, which is a fact, and claims nothing about whether the track is
   * any good. */
  walkEnd: [
    'that is all of them. the map stays exactly as it is.',
    'end of the walk.',
    "through to the end -- move any of it, or leave it, and it's all ordinary clips now.",
    'that is the whole shape, and the rest is listening.'
  ],

  // ==========================================================================
  // 8. THE TENSION PASS
  //    The bubble on the p3-tension step, once the flow knows how many
  //    joins there are (coachPhase3Line, ./coachPhase3.ts).
  // ==========================================================================

  /** `{joins}` is a ready-made phrase -- "one join", "three joins" -- built
   * by the caller, so the template does not have to carry a plural rule.
   * Every variant states the same fact: the joins exist and their NAMES are
   * what is being read. Nothing here says a join needs anything. */
  tension: [
    'the tension pass, and {joins} where the names you gave say what usually goes in.',
    '{joins} here, nothing on yet.',
    'joins next: {joins}, each one carrying what that pair of names asks for.',
    'this step is the seams between sections, so {joins} to look at, and nothing goes in until you switch it on.'
  ],

  /** The same step when the section names ask for nothing -- no drop and no
   * breakdown to lead into. Says so plainly rather than inventing an offer,
   * which is the same choice the no-moves lines make. */
  tensionNone: [
    'none of your joins run into a drop or a breakdown, so there is nothing here to offer.',
    'nothing for this step to do.',
    'no drops and no breakdowns to lead into, so this one can just go by.',
    "this pass reads section names, and yours don't ask for anything, so it is a step you can walk straight past."
  ],

  // ==========================================================================
  // 9. EXPORT, AND THE SIGN-OFF
  // ==========================================================================

  /** On the p3-export step, after an export has really written a file.
   * Reports the file, which is a fact, and says the material is still
   * ordinary -- never that the track is any good, which is the one thing he
   * does not know. */
  v1Exported: [
    'that is a v1, out of the app and onto disk.',
    'v1 exported. the project is marked, and everything in here is still ordinary material.',
    'exported, and that is the whole method, top to bottom.',
    'a v1 is out, and nothing in here is locked -- open it again and keep going whenever you like.'
  ],

  /** The closing bubble, once the last step is behind him. Its one button
   * is "done". */
  done: [
    'that is the whole method, and the rest is listening.',
    'flow finished.',
    "nothing here is locked, it's all normal clips, edit it however you like.",
    "that is a v1. worth hearing somewhere that isn't this app."
  ],

  // ==========================================================================
  // 10. THE STUCK NUDGE
  //     Under the bubble's own line after ~10 minutes on one step, and only
  //     there. Triggered by elapsed clock time, which is "a fact, not a
  //     guess about the music" (spec) -- the single exception to "the step
  //     triggers him". It never blocks and never auto-advances.
  // ==========================================================================

  /** Every one of these offers only the step actions the bubble already
   * has, and every one of them says skipping is fine. Nothing here chases. */
  stuck: [
    'stuck? "do it for me" is up there, and skipping costs nothing.',
    'no rush.',
    'this one can be done for you, or skipped, and both are fine by me.',
    'if you\'d rather not sit with this: there is a "do it for me" button up there, and moving on without it is a perfectly ordinary thing to do.'
  ],

  /** What the "stuck?" list says on a step that genuinely has no moves to
   * offer. Says so plainly rather than inventing one. */
  noMoves: [
    'nothing i can do for you on this step yet.',
    'no moves on this one.',
    'no shortcuts here yet. this one is yours.',
    'nothing automatic on this step, so next or skip whenever you are ready.'
  ],

  // ==========================================================================
  // 11. THE GENERIC FALLBACK
  //     What the bubble says anywhere the current step's own completion
  //     condition is met and nothing more specific applies.
  // ==========================================================================

  /** It reports the CONDITION, never the result: nothing here says the stem
   * is good, or that the step's work is finished, because only the person
   * listening knows that. next and skip stay available either way. */
  stepSatisfied: [
    'this step has what it asked for, so next when you are ready.',
    'covered.',
    'that is the slot this step was after, so next, or keep rerolling it.',
    "the step is satisfied, though whether it's finished is your call, not mine."
  ]
}

// ============================================================================
// NOT A SPOKEN LINE
// ============================================================================

/** The map's tooltip on a cell it cannot toggle (ArrangementMapCell.tsx).
 * Deliberately flat and unrotated, and kept apart from COACH_SCRIPT above
 * for that reason: it is a tooltip on a control, not something sssketchy
 * says, so the 3-4-variants rule does not apply to it. The lowercase, no
 * emoji and no exclamation mark rules still do. */
export const COACH_MAP_LOCKED_CELL_HINT =
  'this clip runs past the edge of the section -- edit it on the timeline'
