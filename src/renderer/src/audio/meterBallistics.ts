/** Peaks streamed from the engine are linear amplitude (0..~1) -- a plain
 * linear mapping onto a meter's fill fraction compresses ordinary
 * playing/talking level into a barely-visible sliver near the bottom
 * (most real audio sits well below 0dBFS), which reads as "the meter looks
 * dead" during completely normal use. This converts to dB and rescales
 * against a floor, so mid-level audio actually shows up mid-meter, the way
 * a real VU/level meter reads. */
const FLOOR_DB = -60
const CEILING_DB = 0

export function linearToMeterFraction(linearPeak: number): number {
  if (linearPeak <= 0) return 0
  const db = 20 * Math.log10(linearPeak)
  const fraction = (db - FLOOR_DB) / (CEILING_DB - FLOOR_DB)
  return Math.min(1, Math.max(0, fraction))
}

/** Classic VU-meter "peak-hold-and-decay" ballistics, expressed as one
 * step: jump up INSTANTLY to a louder reading (no attack smoothing --
 * transients should register immediately), but ease down toward a
 * quieter reading over roughly DECAY_MS rather than snapping to it, so
 * the display doesn't flicker between individual 30Hz engine polls.
 * `elapsedMs` is however long it's actually been since the last call
 * (not assumed fixed), so this still behaves correctly if polls arrive
 * at an uneven cadence. Both inputs/output are already-converted meter
 * fractions (0..1), not raw linear peaks -- call linearToMeterFraction
 * first. */
const DECAY_MS = 400

export function nextMeterValue(
  currentValue: number,
  targetValue: number,
  elapsedMs: number
): number {
  if (targetValue >= currentValue) return targetValue
  const decayFraction = Math.min(1, elapsedMs / DECAY_MS)
  const next = currentValue - (currentValue - targetValue) * decayFraction
  // Snap fully to target once close enough that continuing to ease would
  // never actually reach it (a pure exponential-style ease never lands
  // exactly on 0) -- matches real analog VU needles settling, not hovering
  // just above rest forever.
  return next - targetValue < 0.001 ? targetValue : next
}
