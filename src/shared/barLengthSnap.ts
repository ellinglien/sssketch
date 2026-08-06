/**
 * Sample-quantization noise absorbed by snapToWholeBarIfNearlyExact below --
 * see that function's own comment for the full story. Chosen from a real
 * confirmed example: a barLength of 16.000003184020517 (error ~3.18e-6 bars)
 * came out of importRecordedStem for a take that was, by design, meant to
 * land on exactly 16. This epsilon (1e-4 bars) has roughly 30x margin above
 * that observed noise, so it comfortably absorbs realistic sample-boundary
 * rounding from ANY real recording, while staying far below the smallest
 * fractional barLength a genuine tempo compensation could plausibly produce
 * -- e.g. even a barely-perceptible 1% tempo mismatch on a short 4-bar loop
 * still shifts barLength by ~0.04, 400x this epsilon, so it's never at risk
 * of being mistaken for noise and incorrectly snapped away.
 */
export const BAR_LENGTH_SNAP_EPSILON = 1e-4

/**
 * durationSec-derived barLength computations (see importRecordedStem in
 * src/main/importOneShot.ts) are exact rational math on paper, but
 * durationSec itself comes from a real WAV's sample count divided by its
 * sample rate -- a division that frequently isn't exactly representable in
 * floating point (44100 isn't a power of two), and the WAV's own sample
 * count is itself already quantized to whole audio samples relative to
 * whatever "ideal" duration was intended. The result: a barLength that was
 * DESIGNED to land on a clean integer instead comes out as something like
 * 16.000003184020517 (a real, confirmed example from a real recording).
 *
 * That noise matters far more than its size suggests: ADD_STEM_TO_RIFFF's
 * reducer (src/renderer/src/state/store.ts) folds a new stem's barLength
 * into the WHOLE rifff's shared barLength via Math.max, so this one noisy
 * stem silently corrupts the tiling span every sibling stem measures itself
 * against. The native engine tiles each stem with
 * ceil(upperBound / stem.barLength) -- for any sibling whose own barLength
 * evenly divided the rifff's ORIGINAL (clean) span, that division now lands
 * a hair above the intended integer, and ceil() rounds up to one extra
 * phantom tile repetition every single loop pass, producing periodic
 * glitching on essentially the whole rifff.
 *
 * Used in two places:
 * - src/main/importOneShot.ts's importRecordedStem, snapping at the
 *   source -- before the noisy value can ever reach rifff.barLength for a
 *   newly-recorded stem.
 * - src/renderer/src/state/serialize.ts's deserializeProject, as a
 *   load-time migration -- the source-side snap above only prevents FUTURE
 *   occurrences; a project saved before that fix landed still has the raw
 *   noisy value baked into its JSON and needs the same correction applied
 *   on load.
 *
 * Only values within BAR_LENGTH_SNAP_EPSILON of a whole number are
 * touched; a genuinely fractional, deliberately tempo-compensated
 * barLength (e.g. 7.75) is left exactly as computed/stored.
 */
export function snapToWholeBarIfNearlyExact(barLength: number): number {
  const rounded = Math.round(barLength)
  return Math.abs(barLength - rounded) < BAR_LENGTH_SNAP_EPSILON ? rounded : barLength
}
