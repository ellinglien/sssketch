import type { StemFeatures } from './stemFeatures'
import { stemKey, type Stem } from './types'

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

/** Turns a Promise.allSettled result set (one settled density score per
 * `stems[i]`, in the same order) into a stemKey-keyed map -- the shape
 * AutoArrangeRoleStep.tsx's UI actually consumes. A rejected result (e.g. a
 * corrupt/unreadable stem file -- see stemFeaturesCache.ts's own doc comment
 * on getStemFeatures rejecting) falls back to 0 (`densityLabel(0)` ===
 * 'sparse'), the least presumptuous default, rather than excluding the stem
 * -- unlike ClusterStemsBrowser.tsx's own Promise.allSettled use, a stem
 * here still needs a row in the UI even when its density can't be scored. */
export function buildDensityMap(
  stems: Stem[],
  groupId: string,
  results: readonly PromiseSettledResult<number>[]
): Record<string, number> {
  const map: Record<string, number> = {}
  stems.forEach((stem, i) => {
    const result = results[i]
    map[stemKey(groupId, stem.slot)] = result.status === 'fulfilled' ? result.value : 0
  })
  return map
}
