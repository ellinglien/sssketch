/** The tempo ratio a stem needs to sit in a project, measured from the
 * audio rather than from anything declared.
 *
 * Extracted 2026-09-28 so radio's prefetch can warm the SAME stretch this
 * file will later ask for. The stretch cache is keyed on (path, ratio), so
 * a prefetch computing the ratio even slightly differently warms a file
 * nobody wants and leaves the real one to be rendered at commit time --
 * which is the bug it was meant to fix. One function, one formula.
 *
 * Returns 1 -- "do not stretch" -- for anything it cannot measure, rather
 * than dividing by zero and poisoning a cache key with NaN or Infinity.
 *
 * The oneShot and stretch-off cases are deliberately NOT handled here:
 * they are decisions about whether to stretch at all, and they live with
 * the caller that knows about rifffs and project state. */
export function stretchRatioForStem(durationSec: number, barLength: number, bpm: number): number {
  if (!(durationSec > 0) || !(barLength > 0) || !(bpm > 0)) return 1
  const secPerBarAtProjectTempo = (60 / bpm) * 4
  const stemNativeSecPerBar = durationSec / barLength
  const ratio = stemNativeSecPerBar / secPerBarAtProjectTempo
  return Number.isFinite(ratio) && ratio > 0 ? ratio : 1
}

/** How far from 1 a ratio has to be before it is worth rendering at all.
 * Shared so the prefetch skips exactly what the build would skip. */
export const STRETCH_RATIO_EPSILON = 0.001
