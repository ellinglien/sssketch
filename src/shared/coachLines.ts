/**
 * sssketchy's vocabulary, and the one rule for choosing from it.
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
 * Everything here therefore describes the METHOD or the flow's own
 * mechanics. Nothing here has an opinion about the user's music.
 */

/** The variant at `seed`, wrapping, and tolerant of a negative or
 * out-of-range seed (lineSeed is persisted, so a hand-edited project file
 * can hand us anything). '' for an empty table, so a caller renders nothing
 * rather than crashing. */
export function pickLineVariant(variants: readonly string[], seed: number): string {
  if (variants.length === 0) return ''
  const index = ((Math.trunc(seed) % variants.length) + variants.length) % variants.length
  return variants[index]
}

/** The ~10-minute nudge. Triggered by elapsed clock time, which is "a fact,
 * not a guess about the music" (spec) -- the single exception to "the step
 * triggers him, not a heuristic". Every one of these offers only the step
 * actions the bubble already has. */
export const COACH_STUCK_LINES: readonly string[] = [
  'stuck? try "do it for me", or move on.',
  'been a while on this one. "do it for me" is there, and skipping is fine.',
  'no rush. there is a "do it for me" up there, and skip costs you nothing.',
  'this one can be done for you, or skipped. both are ok.'
]

/** What "stuck?" says on a step that genuinely has no moves to offer. Says
 * so plainly rather than inventing one. */
export const COACH_NO_MOVES_LINES: readonly string[] = [
  'nothing i can do for you on this step yet.',
  'no moves on this one. next or skip when you are ready.',
  'no shortcuts here yet. this one is yours.',
  'nothing automatic on this step.'
]

/** The end of the flow. */
export const COACH_DONE_LINES: readonly string[] = [
  'that is the whole method. the rest is listening.',
  'flow finished. everything here is ordinary material now, edit it however you like.',
  'done. nothing here is locked, it is all normal clips.',
  'that is a v1. go and listen to it.'
]

/** What the bubble says once the current step's own completion condition is
 * met -- "a step completes when a slot with those kinds resolves" (spec).
 * It reports the CONDITION, never the result: nothing here says the stem is
 * good, or that the step's work is finished, because only the person
 * listening knows that. next and skip stay available either way. */
export const COACH_STEP_SATISFIED_LINES: readonly string[] = [
  'this step has what it asked for. next when you are ready.',
  'that is the slot this step was after. next, or keep rerolling it.',
  'covered. move on whenever you like.',
  'the step is satisfied. whether it is finished is your call, not mine.'
]

/** The phrase report. {nominal} is the loop's nominal bar count, {phrase}
 * the measured one; the caller only ever calls this when the two differ
 * (loopPhraseIsWorthSaying), so every variant can say so plainly.
 *
 * Note what these do NOT do: none of them tells the user to change
 * anything. The finding is a fact about the audio; what to do about it is
 * his, and the third variant says so out loud. The advice this enables is
 * the ignorable kind -- "you could halve this loop and get twice the
 * arrangement out of the same material" -- never an instruction. */
export const COACH_PHRASE_LINE_TEMPLATES: readonly string[] = [
  'this {nominal}-bar loop is really the same {phrase} bars twice.',
  '{nominal} bars, but it repeats every {phrase}. worth knowing before we size anything.',
  'the phrase in here is {phrase} bars, inside a {nominal}-bar loop. your call which one we use.',
  'measured: {phrase} bars of material in a {nominal}-bar loop.'
]

/** What he says once a map has arrived pre-filled. Elling's condition for
 * the pre-fill being allowed at all (spec, "The map arrives pre-filled, and
 * says so"): he states that HE made the call, and states the way out. The
 * first variant is the spec's own wording. */
export const COACH_PREFILLED_LINE_TEMPLATES: readonly string[] = [
  'that is the usual shape. cmd+z puts everything back on if you would rather start full.',
  'i filled this in from the usual shape. one cmd+z and every cell comes back on.',
  'pre-filled, by me, from the standard arrangement. undo once for the everything-on version.',
  'this is a guess at the shape, not a rule. cmd+z if you would rather start from full.'
]

/** What the bubble says while a section is being carved. {section} is the
 * section's own name. Every variant states the same fact -- the whole loop
 * is playing and subtracting is the user's move -- because that fact is the
 * one thing about this step that is true of every track. Nothing here
 * claims a stem has been removed: nothing has been. */
export const COACH_SECTION_LINE_TEMPLATES: readonly string[] = [
  'the {section}. every stem from the loop is on -- switch off what it does not need.',
  '{section} next. the full climax loop is playing; take things out of it.',
  'this one is the {section}. it stays the whole loop until you turn something off.',
  'carving the {section}. marked stems are what this kind of section usually loses.'
]

/** What the bubble says once a section is on the timeline and the flow is
 * asking what follows. Reports the placement, which is a fact, and asks a
 * question -- never an opinion about what the track now needs. */
export const COACH_NEXT_SECTION_LINE_TEMPLATES: readonly string[] = [
  'the {section} is down, as ordinary clips. what comes next?',
  '{section} placed. pick what follows, or stop here.',
  'that is the {section} on the timeline. move it, resize it, redraw it -- or keep going.',
  '{section} done. an outro ends this phase; anything else keeps it running.'
]

/** What the bubble says on the tension pass. {joins} is a ready-made phrase
 * ("one join", "three joins") built by the caller, so the template does not
 * have to carry a plural rule. Every variant states the same fact -- the
 * joins exist and their NAMES are what is being read -- because that fact
 * is the only thing about this step that is true of every track. Nothing
 * here says a join needs anything. */
export const COACH_TENSION_LINE_TEMPLATES: readonly string[] = [
  'the tension pass. {joins} where the names you gave say what usually goes in.',
  'joins next. {joins} here, each carrying what that pair of names asks for.',
  'this step is the seams between sections. {joins} to look at, nothing on yet.',
  '{joins} between your sections. nothing goes in until you switch it on.'
]

/** The same step when the section names ask for nothing -- no drop and no
 * breakdown to lead into. Says so plainly rather than inventing an offer,
 * which is the same choice COACH_NO_MOVES_LINES makes. */
export const COACH_TENSION_NONE_LINES: readonly string[] = [
  'none of your joins run into a drop or a breakdown, so there is nothing to offer here.',
  'nothing for this step to do: the names either side of every join ask for nothing.',
  'no drops and no breakdowns to lead into. skip this one.',
  'this pass reads section names, and yours do not ask for anything. next when you like.'
]

/** After an export has really written a file. Reports the file, which is a
 * fact, and says the material is still ordinary -- never that the track is
 * any good, which is the one thing he does not know. */
export const COACH_V1_EXPORTED_LINES: readonly string[] = [
  'that is a v1, out of the app and onto disk. go and listen to it somewhere else.',
  'v1 exported. the project is marked, and everything in here is still ordinary material.',
  'exported. that is the whole method, top to bottom.',
  'v1 is out. nothing here is locked -- open it again and keep going whenever you like.'
]

/** "What is this loop?" -- the first of the two opening questions (spec,
 * "Getting started: two questions"). It decides where the material the user
 * already has lands in the structure, and it replaces all six of phase
 * one's steps.
 *
 * Note what none of these do: none of them tells him what the loop IS. The
 * app has not heard it. Every variant asks, and the last one says plainly
 * what "not sure" will be taken to mean, so choosing it is not a trapdoor. */
export const COACH_LOOP_QUESTION_LINES: readonly string[] = [
  'before anything else: what is this loop, to you? the drop, a verse, or an intro.',
  'one question first. is this the drop, a verse, or an intro? not sure is a real answer.',
  'where does this loop live in a track? drop, verse, intro -- or leave it to me.',
  'what is this, as a section? say not sure and i will treat it as the drop.'
]

/** "How long a journey?" -- the second question. Shown next to the article's
 * own letter notation, which is why none of these spell the shapes out: the
 * letters are on the buttons.
 *
 * There is deliberately no genre here and there must not be (coachShapes.ts
 * explains why at length): the section ORDER barely varies by genre, so a
 * genre list would be one template wearing six names. */
export const COACH_SHAPE_QUESTION_LINES: readonly string[] = [
  'how long a journey? short is about two minutes, standard about four, long about six.',
  'pick a length. the letters are the sections in order -- a is the intro and the outro.',
  'how far do you want to travel? the same order underneath, just more of it.',
  'length next. any of these is a fine shape; you can move all of it afterwards.'
]

/**
 * What each kind of section is FOR -- the whole of the section walk's copy.
 *
 * THE RULE (spec): **goals, not dictates. advice, not rules.** A goal is a
 * statement about song structure, which is true regardless of what the user
 * made -- so it cannot be wrong about music the app has not heard. An
 * instruction ("add a riser at bar 48") can be, and a lesson ("a verse, by
 * definition, establishes...") is a teacher, which he is not.
 *
 * Every one of these six tables carries at least one variant that says the
 * section may need NOTHING. That is not filler: "a coach who always has a
 * suggestion is a drill sergeant with better manners" (spec). The test to
 * apply before adding a line here: could a friend say this while leaning
 * over your shoulder, without it being annoying?
 */
export const COACH_SECTION_GOAL_LINES: Record<string, readonly string[]> = {
  intro: [
    'this one is the way in. it does not have to do much.',
    'an intro is for getting someone into the room. two or three parts is plenty.',
    'the opening. the less it gives away, the further the rest has to travel.',
    'this is the way in. nothing has to change here if you like it as it is.'
  ],
  verse: [
    'the verse should hint at the drop without giving it away.',
    'this one carries the track between the big moments. it can be quieter than you think.',
    'a verse is room to breathe. want to try taking the hook out?',
    'the stretch between the big moments. nothing has to change here if it already carries.'
  ],
  build: [
    'this is where it lifts.',
    'this one is the lift into the drop. the fewer parts it has, the more the drop adds.',
    'a build is a climb. taking something away here often lifts harder than adding.',
    'this is the run-up. nothing has to change if it already pulls.'
  ],
  drop: [
    'this is the payoff. everything you have is welcome here.',
    'the drop. this is the loop you built, doing what it does.',
    'this one is the top of the track. it already does its job.',
    'the big one. nothing has to come out here unless you want it to.'
  ],
  breakdown: [
    'a breakdown empties the room out for a moment.',
    'this one is the drop again with the floor taken away.',
    'the quiet stretch. the less that is in here, the bigger what follows feels.',
    'this is space. it can be very little and still work, so nothing has to change here.'
  ],
  outro: [
    'the way out. parts leaving one at a time is usually enough.',
    'an outro lets go. it does not need a new idea.',
    'this is the end of the journey. thinning out is the whole move.',
    'the last stretch. nothing has to change here.'
  ]
}

/** Entering the walk. Every variant states the way out in the same breath
 * as the offer -- "leaving the walk keeps the map" (spec) is the single
 * thing a user needs to know before agreeing to be walked anywhere. */
export const COACH_WALK_START_LINES: readonly string[] = [
  'i will go through the sections one at a time. leave whenever you like -- the map stays.',
  'section by section, then. stepping out keeps everything exactly as it is.',
  'we can walk these in order. the map is yours either way.',
  'one section at a time from here. leaving does not undo anything.'
]

/** Leaving the walk, at the end or early. Reports the state of things,
 * which is a fact, and claims nothing about whether the track is any good. */
export const COACH_WALK_END_LINES: readonly string[] = [
  'that is all of them. the map stays exactly as it is.',
  'end of the walk. everything here is ordinary clips now.',
  'through to the end. move any of it, or leave it.',
  'that is the whole shape. the rest is listening.'
]

/** What the map says about a cell it cannot toggle. Deliberately flat and
 * unrotated: it is a tooltip on a control, not something sssketchy says. */
export const COACH_MAP_LOCKED_CELL_HINT =
  'this clip runs past the edge of the section -- edit it on the timeline'
