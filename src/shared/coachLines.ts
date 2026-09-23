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
