// src/shared/guessBpmFromFilename.ts

// A plausible musical tempo range -- deliberately conservative (real loop
// packs skew 60-180, this leaves headroom for halftime/DnB naming like
// "174") so a 2-3 digit number that's clearly NOT a tempo (a year
// fragment, a catalog number, a single-digit index) doesn't get mistaken
// for one.
const MIN_PLAUSIBLE_BPM = 60
const MAX_PLAUSIBLE_BPM = 200

/** Best-effort BPM extraction from an arbitrary sample-pack filename --
 * NOT Endlesss's own strict export format (see parseFilename.ts's
 * STEM_FILENAME_RE for that, which requires an exact " - "-delimited
 * shape real Endlesss exports have and arbitrary downloaded packs never
 * will). Real examples this was built against (direct request,
 * 2026-09-18, "collecting info about them from the filenames"): Rhythm
 * Lab/Amen Breaks Compilation's own "cw_amen08_165.wav" (BPM 165, no
 * "bpm" suffix at all), and ChaosEvolution's own "Halftime Dnb Drums
 * 1.wav" (no BPM info present -- correctly returns null rather than
 * mistaking the "1").
 *
 * Two passes: first, a number immediately followed by literal "bpm" text
 * (unambiguous when present, e.g. "Break_174bpm_02.wav"); otherwise, the
 * LAST plausible bare 2-3-digit number in the filename (sample-pack
 * naming conventions overwhelmingly put tempo at or near the end, and a
 * name can otherwise contain other numbers -- track/take numbers, years --
 * that aren't tempo). BOTH passes apply the same digit-run-boundary
 * guard below. A number is only ever considered "plausible" within
 * MIN_PLAUSIBLE_BPM..MAX_PLAUSIBLE_BPM, and the digit run itself must be
 * bounded by a non-digit before it and a non-digit after (so "2023" is
 * never mistaken for "202" plus a stray "3" -- the lookaround requires the
 * FULL run of digits to be exactly 2-3 long, not just a substring of a
 * longer run). The leading boundary also excludes a preceding "." (so a
 * decimal's fractional part is never re-matched as its own integer), but
 * the TRAILING boundary allows one -- a number immediately followed by a
 * file extension's leading "." (e.g. "cw_amen08_165.wav") is the single
 * most common real shape this needs to match, not something to reject.
 *
 * Returns null (never guesses beyond this) when nothing plausible is
 * found -- same "decline rather than force a close call" discipline this
 * session's own classifier work already established (categoryCentroids.ts's
 * CONFIDENCE_RATIO, embeddingMatch.ts's SIMILARITY_MARGIN, audiosetClasses.ts's
 * deliberately narrow table) -- a wrong BPM guess would silently mis-tile
 * a loop, worse than no guess at all (falls back to guessLoopBars's own
 * project-tempo-relative heuristic, loopBarGuess.ts). */
export function guessBpmFromFilename(filename: string): number | null {
  // (?<![\d.]) before the digits -- same digit-run-boundary reasoning as
  // the bare-number pass below (code review, 2026-09-18: this pass
  // originally had no such guard, so "Track99174bpm.wav" would match
  // "174bpm" as if it were a clean token, silently ignoring that it's
  // really a substring of the longer run "99174"). (?![a-z]), not \b,
  // after "bpm" -- a trailing \b requires a transition between a word
  // char and a non-word char, but underscore (very common as a
  // sample-pack filename separator, e.g. "174bpm_take_99.wav") IS a word
  // char, so \b would wrongly refuse to match "bpm" immediately followed
  // by "_". Only reject when "bpm" is itself part of a longer word (e.g.
  // "bpmx"), not when it's followed by a separator/digit/dot.
  const withBpmSuffix = /(?<![\d.])(\d{2,3}(?:\.\d+)?)\s*bpm(?![a-z])/i.exec(filename)
  if (withBpmSuffix) {
    const bpm = parseFloat(withBpmSuffix[1])
    if (bpm >= MIN_PLAUSIBLE_BPM && bpm <= MAX_PLAUSIBLE_BPM) return bpm
  }

  const bareNumbers = [...filename.matchAll(/(?<![\d.])(\d{2,3})(?!\d)/g)]
    .map((m) => parseInt(m[1], 10))
    .filter((n) => n >= MIN_PLAUSIBLE_BPM && n <= MAX_PLAUSIBLE_BPM)
  return bareNumbers.length > 0 ? bareNumbers[bareNumbers.length - 1] : null
}
