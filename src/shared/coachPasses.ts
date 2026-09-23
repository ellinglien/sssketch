/**
 * A section's length, measured in PASSES OF THE LOOP rather than in bars.
 *
 * WHY THIS MODULE EXISTS (spec: "Sections are measured in phrases, not
 * bars"): section lengths used to be hardcoded -- intro 8, verse 16, drop
 * 16, nudged by 4 and 8 -- with **no relationship to the loop at all**.
 * Elling caught it: "the starting loop will be different lengths... are you
 * taking number of bars into account." A 6-bar loop in a 16-bar verse gives
 * two passes and a two-bar stump cut mid-idea; a 4-bar loop in a 16-bar
 * verse is four identical repeats and nothing notices.
 *
 * So a section is N passes, boundaries always land on phrase boundaries
 * whatever the loop's length is, and the template's bar counts become
 * TARGETS that round to whole passes (passesForTargetBars).
 *
 * Bars are derived at the edges only -- the timeline write path and the
 * tension pass, both of which genuinely need a bar number.
 */

/** One pass is the smallest section this flow will build. Sixteen is a
 * deliberately generous ceiling so the nudge buttons cannot run away: at a
 * 4-bar phrase that is a 64-bar section, which is the same ceiling the old
 * bar-based COACH_SECTION_MAX_BARS had. */
export const COACH_SECTION_MIN_PASSES = 1
export const COACH_SECTION_MAX_PASSES = 16

/** "the nudges are +/-1 and +/-2 passes" (spec), in the order the panel
 * renders them. */
export const COACH_SECTION_PASS_NUDGES: readonly number[] = [-2, -1, 1, 2]

export function nudgeSectionPasses(passes: number, delta: number): number {
  const next = Math.round(passes + delta)
  return Math.max(COACH_SECTION_MIN_PASSES, Math.min(COACH_SECTION_MAX_PASSES, next))
}

/** A template's target bar count, rounded to whole passes of this loop.
 * Rounds to NEAREST rather than down, so a 16-bar target on a 6-bar phrase
 * is three passes (18 bars) rather than two (12) -- the arrangement should
 * not silently shrink because the loop is an awkward length. */
export function passesForTargetBars(targetBars: number, phraseBars: number): number {
  if (!Number.isFinite(phraseBars) || phraseBars <= 0) return COACH_SECTION_MIN_PASSES
  if (!Number.isFinite(targetBars) || targetBars <= 0) return COACH_SECTION_MIN_PASSES
  return Math.max(
    COACH_SECTION_MIN_PASSES,
    Math.min(COACH_SECTION_MAX_PASSES, Math.round(targetBars / phraseBars))
  )
}

/** The one place passes become bars. Floors at 1 so no caller can end up
 * dividing by zero or placing a zero-length clip. */
export function sectionBars(passes: number, phraseBars: number): number {
  const safePasses = Number.isFinite(passes) ? Math.max(1, Math.round(passes)) : 1
  const safePhrase = Number.isFinite(phraseBars) ? Math.max(1, Math.round(phraseBars)) : 1
  return safePasses * safePhrase
}
