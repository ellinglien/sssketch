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

/** Named once, on the step a seeded start lands you on: "seeded starts mark
 * already-covered roles done ('you've got drums and bass, next: harmony')"
 * (spec). {covered} is the list of role names Discover itself tagged;
 * {next} is the label of the step you are now on. Templates rather than
 * finished lines so the copy rules still get tested here, in one place with
 * the rest of the vocabulary. */
export const COACH_SEEDED_LINE_TEMPLATES: readonly string[] = [
  'you already have {covered}. next: {next}.',
  '{covered} is already covered by that riff. next: {next}.',
  'that riff brings {covered} with it, so we skip ahead. next: {next}.',
  'marked done from the riff you started with: {covered}. next: {next}.'
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
