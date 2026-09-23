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
  readonly retiredSectionCarve: readonly string[]
  readonly retiredNextSection: readonly string[]
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
   * trapdoor. */
  loopQuestion: [
    'before anything else: what is this loop, to you? the drop, a verse, or an intro.',
    'one question first. is this the drop, a verse, or an intro? not sure is a real answer.',
    'where does this loop live in a track? drop, verse, intro -- or leave it to me.',
    'what is this, as a section? say not sure and i will treat it as the drop.'
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
    'how long a journey? short is about two minutes, standard about four, long about six.',
    'pick a length. the letters are the sections in order -- a is the intro and the outro.',
    'how far do you want to travel? the same order underneath, just more of it.',
    'length next. any of these is a fine shape; you can move all of it afterwards.'
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
    '{nominal} bars, but it repeats every {phrase}. worth knowing before we size anything.',
    'the phrase in here is {phrase} bars, inside a {nominal}-bar loop. your call which one we use.',
    'measured: {phrase} bars of material in a {nominal}-bar loop.'
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
    'that is the usual shape. cmd+z puts everything back on if you would rather start full.',
    'i filled this in from the usual shape. one cmd+z and every cell comes back on.',
    'pre-filled, by me, from the standard arrangement. undo once for the everything-on version.',
    'this is a guess at the shape, not a rule. cmd+z if you would rather start from full.'
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
      'there is the whole song. one column per section, one square per time round the loop.',
      'the map is the arrangement, seen from further back. the toggle up top swaps the two.',
      'that is the usual shape, laid out. it is all ordinary clips underneath.',
      'a shape to push against. nothing on it is settled, and none of it has to stay.'
    ],

    /** WALK THE SECTIONS, when he is on the walk step but not standing on
     * a column (the walk's own per-section goals, section 6 below, replace
     * this the moment he is). */
    'p2-section': [
      'the map is the whole song at once. one column per section, one square per pass.',
      'every square is ordinary clips underneath. switch one off and the clip goes.',
      'this is the shape, filled in. change anything you like, or leave it.',
      'the map and the timeline are the same arrangement. the toggle up top swaps them.'
    ],

    /** WHEN YOU ARE DONE HERE -- the hand-off out of the arrangement phase.
     * Nothing here chases: when the arrangement is finished is the user's
     * call. */
    'p2-next': [
      'the map keeps working long after this. leaving the walk changes nothing on it.',
      'stay on the map as long as it is useful, or carry on to polish whenever.',
      'the arrangement is yours now. next is the joins, the levels and a v1 out.',
      'nothing here is waiting on you. polish is the next thing, when you want it.'
    ],

    /** THE TENSION PASS, first step of the polish phase. Replaced by the
     * join-counting line (section 7 below) as soon as the flow has any
     * section boundaries to count. */
    'p3-tension': [
      'phase three. the joins between sections first -- a sweep into a drop, a fade into a breakdown.',
      'last phase. start at the seams: what is offered there comes from the names you gave.',
      'tension pass. nothing is on until you switch it on, and what it makes is an ordinary curve.',
      'this step is the joins. a drop gets a sweep and a swell; a build into a drop also gets a riser.'
    ],

    /** THE BALANCE CHECK. He can start it playing and nothing else --
     * what the levels should be is a person listening, and the third
     * variant says so. */
    'p3-balance': [
      'balance check. play the whole thing through and set the levels while it runs.',
      'one listen, top to bottom, with the row gains to hand.',
      'this step is levels. what they should be is yours -- i can only start it playing.',
      'play it through. the gain on each row is the only control this step is about.'
    ],

    /** EXPORT A V1, the last step. Replaced by the exported line (section 8
     * below) once a file has really come out. */
    'p3-export': [
      'last step. a mix, the stems, or an ableton or reaper project -- whichever you want a v1 in.',
      'export time. the usual picker, and the project gets marked once a file really comes out.',
      'get a v1 out. a mix is the quickest; the daw projects carry the curves across as well.',
      'this is the end of the method: export something you can listen to away from here.'
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
    'i will go through the sections one at a time. leave whenever you like -- the map stays.',
    'section by section, then. stepping out keeps everything exactly as it is.',
    'we can walk these in order. the map is yours either way.',
    'one section at a time from here. leaving does not undo anything.'
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
      'this one is the way in. it does not have to do much.',
      'an intro is for getting someone into the room. two or three parts is plenty.',
      'the opening. the less it gives away, the further the rest has to travel.',
      'this is the way in. nothing has to change here if you like it as it is.'
    ],

    /** Standing on a verse column. The first variant is the spec's own
     * example of a good goal. */
    verse: [
      'the verse should hint at the drop without giving it away.',
      'this one carries the track between the big moments. it can be quieter than you think.',
      'a verse is room to breathe. want to try taking the hook out?',
      'the stretch between the big moments. nothing has to change here if it already carries.'
    ],

    /** Standing on a build column. */
    build: [
      'this is where it lifts.',
      'this one is the lift into the drop. the fewer parts it has, the more the drop adds.',
      'a build is a climb. taking something away here often lifts harder than adding.',
      'this is the run-up. nothing has to change if it already pulls.'
    ],

    /** Standing on a drop column -- usually the loop the user arrived
     * with, which is why none of these ask for anything. */
    drop: [
      'this is the payoff. everything you have is welcome here.',
      'the drop. this is the loop you built, doing what it does.',
      'this one is the top of the track. it already does its job.',
      'the big one. nothing has to come out here unless you want it to.'
    ],

    /** Standing on a breakdown column (the long shape only). */
    breakdown: [
      'a breakdown empties the room out for a moment.',
      'this one is the drop again with the floor taken away.',
      'the quiet stretch. the less that is in here, the bigger what follows feels.',
      'this is space. it can be very little and still work, so nothing has to change here.'
    ],

    /** Standing on an outro column -- the last one in every shape. */
    outro: [
      'the way out. parts leaving one at a time is usually enough.',
      'an outro lets go. it does not need a new idea.',
      'this is the end of the journey. thinning out is the whole move.',
      'the last stretch. nothing has to change here.'
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
    'end of the walk. everything here is ordinary clips now.',
    'through to the end. move any of it, or leave it.',
    'that is the whole shape. the rest is listening.'
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
    'the tension pass. {joins} where the names you gave say what usually goes in.',
    'joins next. {joins} here, each carrying what that pair of names asks for.',
    'this step is the seams between sections. {joins} to look at, nothing on yet.',
    '{joins} between your sections. nothing goes in until you switch it on.'
  ],

  /** The same step when the section names ask for nothing -- no drop and no
   * breakdown to lead into. Says so plainly rather than inventing an offer,
   * which is the same choice the no-moves lines make. */
  tensionNone: [
    'none of your joins run into a drop or a breakdown, so there is nothing to offer here.',
    'nothing for this step to do: the names either side of every join ask for nothing.',
    'no drops and no breakdowns to lead into. skip this one.',
    'this pass reads section names, and yours do not ask for anything. next when you like.'
  ],

  // ==========================================================================
  // 9. EXPORT, AND THE SIGN-OFF
  // ==========================================================================

  /** On the p3-export step, after an export has really written a file.
   * Reports the file, which is a fact, and says the material is still
   * ordinary -- never that the track is any good, which is the one thing he
   * does not know. */
  v1Exported: [
    'that is a v1, out of the app and onto disk. go and listen to it somewhere else.',
    'v1 exported. the project is marked, and everything in here is still ordinary material.',
    'exported. that is the whole method, top to bottom.',
    'v1 is out. nothing here is locked -- open it again and keep going whenever you like.'
  ],

  /** The closing bubble, once the last step is behind him. Its one button
   * is "done". */
  done: [
    'that is the whole method. the rest is listening.',
    'flow finished. everything here is ordinary material now, edit it however you like.',
    'done. nothing here is locked, it is all normal clips.',
    'that is a v1. go and listen to it.'
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
    'stuck? try "do it for me", or move on.',
    'been a while on this one. "do it for me" is there, and skipping is fine.',
    'no rush. there is a "do it for me" up there, and skip costs you nothing.',
    'this one can be done for you, or skipped. both are ok.'
  ],

  /** What the "stuck?" list says on a step that genuinely has no moves to
   * offer. Says so plainly rather than inventing one. */
  noMoves: [
    'nothing i can do for you on this step yet.',
    'no moves on this one. next or skip when you are ready.',
    'no shortcuts here yet. this one is yours.',
    'nothing automatic on this step.'
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
    'this step has what it asked for. next when you are ready.',
    'that is the slot this step was after. next, or keep rerolling it.',
    'covered. move on whenever you like.',
    'the step is satisfied. whether it is finished is your call, not mine.'
  ],

  // ==========================================================================
  // 12. RETIRED -- WRITTEN, TESTED, AND NOT CURRENTLY ON ANY SCREEN
  //     These two tables belonged to the one-section-at-a-time carve flow
  //     that the arrangement map replaced on 2026-09-23 (the map arrives
  //     whole and pre-filled, so there is nothing left to carve one at a
  //     time and nothing left to place). No code path reaches them today.
  //     They are kept here, held to the same copy rules as everything
  //     above, rather than deleted -- deleting the author's copy is his
  //     call, not an agent's.
  // ==========================================================================

  /** What the bubble used to say while a section was being carved.
   * `{section}` is the section's own name. Nothing here claims a stem has
   * been removed: nothing had been. */
  retiredSectionCarve: [
    'the {section}. every stem from the loop is on -- switch off what it does not need.',
    '{section} next. the full climax loop is playing; take things out of it.',
    'this one is the {section}. it stays the whole loop until you turn something off.',
    'carving the {section}. marked stems are what this kind of section usually loses.'
  ],

  /** What the bubble used to say once a section was on the timeline and the
   * flow was asking what followed. `{section}` is the section's own name.
   * Reports the placement, which is a fact, and asks a question -- never an
   * opinion about what the track now needs. */
  retiredNextSection: [
    'the {section} is down, as ordinary clips. what comes next?',
    '{section} placed. pick what follows, or stop here.',
    'that is the {section} on the timeline. move it, resize it, redraw it -- or keep going.',
    '{section} done. an outro ends this phase; anything else keeps it running.'
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
