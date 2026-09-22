// src/shared/onsetRhythm.ts
//
// Rhythm measurements over detected onsets (typeGuess.ts's detectOnsetTimes)
// -- docs/superpowers/specs/2026-09-22-discover-promise-vs-delivery-design.md,
// Phase 3. transientDensity alone counts attacks, so noise bursts scored as
// high as a groove; these add HOW EVENLY the attacks are spaced.

/** Onsets per second at which density stops adding to rhythmicStrength --
 * straight 8th notes at 120 BPM. Anything at least this busy counts as
 * fully dense, and regularity alone decides between them. */
export const RHYTHMIC_DENSITY_REF = 4

/** How evenly spaced onsets are, in [0, 1]: 1 - the coefficient of
 * variation (population stddev / mean) of the inter-onset intervals,
 * clamped to [0, 1]. Perfectly even = 1; Poisson-like random spacing has a
 * CV near 1, so it lands near 0. Fewer than 3 onsets (fewer than 2
 * intervals) -> 0. Input times in seconds, any order.
 *
 * Known limitation: a syncopated groove mixing note values (8ths + 16ths)
 * scores lower than a straight one, though still well above random hits. */
export function onsetRegularity(onsetTimes: readonly number[]): number {
  if (onsetTimes.length < 3) return 0
  const sorted = [...onsetTimes].sort((a, b) => a - b)
  const intervals: number[] = []
  for (let i = 1; i < sorted.length; i++) intervals.push(sorted[i] - sorted[i - 1])
  const mean = intervals.reduce((s, d) => s + d, 0) / intervals.length
  if (!(mean > 0)) return 0
  const variance = intervals.reduce((s, d) => s + (d - mean) ** 2, 0) / intervals.length
  const cv = Math.sqrt(variance) / mean
  return Math.min(1, Math.max(0, 1 - cv))
}

/** Steady-groove strength, in [0, 1]: min(1, transientDensity /
 * RHYTHMIC_DENSITY_REF) * onsetRegularity. A steady, busy pattern scores
 * near 1; sparse or randomly spaced hits score low. Non-finite or negative
 * inputs -> 0. */
export function rhythmicStrength(transientDensity: number, regularity: number): number {
  if (!Number.isFinite(transientDensity) || !Number.isFinite(regularity)) return 0
  const density = Math.min(1, Math.max(0, transientDensity) / RHYTHMIC_DENSITY_REF)
  return density * Math.min(1, Math.max(0, regularity))
}
