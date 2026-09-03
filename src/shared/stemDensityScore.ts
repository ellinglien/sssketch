import type { StemFeatures } from './stemFeatures'

export type DensityLabel = 'sparse' | 'steady' | 'dense'

// transientDensity is an unbounded rate (attacks/sec, real busy material scores 3+ --
// see typeGuess.test.ts), unlike bassEnergyRatio/zcrBrightness which are genuinely
// bounded [0,1] already. x / (x + HALF_SATURATION) saturates it into [0,1) without a
// hard ceiling that would just flatten every busy stem to the same score.
// HALF_SATURATION = 4 means 4 attacks/sec (a moderately busy stem) maps to 0.5.
const TRANSIENT_HALF_SATURATION = 4

function normalizeTransientDensity(attacksPerSec: number): number {
  return attacksPerSec / (attacksPerSec + TRANSIENT_HALF_SATURATION)
}

export function computeDensityScore(features: StemFeatures): number {
  const transient = normalizeTransientDensity(features.transientDensity)
  return transient * 0.7 + features.bassEnergyRatio * 0.3
}

export function densityLabel(score: number): DensityLabel {
  if (score < 0.33) return 'sparse'
  if (score < 0.66) return 'steady'
  return 'dense'
}

// Fills want crisp, transient, bright material (percussion hits, one-shots) --
// not sustained pads/bass, which is what computeDensityScore favors instead.
export function computeFillScore(features: StemFeatures): number {
  const transient = normalizeTransientDensity(features.transientDensity)
  return features.zcrBrightness * 0.5 + transient * 0.5
}
