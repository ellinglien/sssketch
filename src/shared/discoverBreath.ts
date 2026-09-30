// src/shared/discoverBreath.ts
//
// How far through its breath a Discover row radio is about to change sits,
// 0 (dim) .. 1 (bright), from the transport position. Elling, 2026-09-30:
// "can the fade be a bit slower, and synchronized across all waves? right
// now they can be out of sync.. maybe even synced to half the tempo" --
// then, choosing between the options: one full breath (dim -> bright ->
// dim) every 4 bars, locked to the music. Every row reads the same number,
// so they breathe together, and a breath starts on a bar line.

/** One breath, dim -> bright -> dim, every this many bars. */
export const DISCOVER_BREATH_BARS = 4

/** `absBars` must keep counting across loop wraps (DiscoverPanel feeds it
 * lapIndex * loopBars + pos): a loop shorter than, or not a multiple of,
 * the period wraps partway through a breath, and wrapping the input there
 * would snap the breath back to dim. Cosine-eased, 0.5 - 0.5*cos(2 pi
 * phase), so it lingers at both ends the way the old ease-in-out keyframes
 * did. Non-finite input, or a period that is not positive, holds at the
 * midpoint -- the same value the panel shows while stopped. */
export function discoverBreath(absBars: number, periodBars = DISCOVER_BREATH_BARS): number {
  if (!Number.isFinite(absBars) || !Number.isFinite(periodBars) || !(periodBars > 0)) return 0.5
  const phase = (((absBars % periodBars) + periodBars) % periodBars) / periodBars
  return 0.5 - 0.5 * Math.cos(2 * Math.PI * phase)
}
