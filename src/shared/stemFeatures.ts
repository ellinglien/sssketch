export interface StemFeatures {
  transientDensity: number
  bassEnergyRatio: number
  /** Weighted-average spectral centroid, in Hz -- derived from
   * computeBandEnergy's per-frame bass/mid/treble energies (see
   * stemFeaturesCache.ts for the exact derivation) using each band's own
   * geometric-mean center frequency as its representative Hz value. */
  spectralCentroidHz: number
  /** Mean zero-crossing-rate brightness across the stem, in [0, 1] --
   * averaged from peakCache.ts's own getBrightness (128 per-bucket
   * values), not recomputed independently. */
  zcrBrightness: number
  voicedFraction: number
  pitchVarianceCents: number
  /** 13 MFCC coefficients -- see mfcc.ts's computeMfcc. */
  mfcc: number[]

  // ---- Phase 3 (docs/superpowers/specs/2026-09-22-discover-promise-vs-
  // delivery-design.md), all optional: rows extracted before version 2 lack
  // them. NOT part of toFeatureArray -- the overnight classifier's trained
  // centroids and clustering keep reading only the fields above, unchanged.

  /** True magnitude-weighted spectral centroid, in Hz, averaged over the
   * MFCC pass's own FFT frames (mfcc.ts's computeMfccAndCentroid; silent
   * frames skipped; 0 for silence). Discover's bright/warm prefer this over
   * the 3-band spectralCentroidHz approximation. */
  spectralCentroidFftHz?: number
  /** How evenly spaced the detected onsets are, [0, 1]: 1 - coefficient of
   * variation of the inter-onset intervals, clamped; < 3 onsets -> 0
   * (onsetRhythm.ts's onsetRegularity). */
  onsetRegularity?: number
  /** min(1, transientDensity / 4) * onsetRegularity, [0, 1] -- a steady
   * busy groove scores high, random noise bursts low (onsetRhythm.ts's
   * rhythmicStrength). Discover's rhythmic prefers this over
   * transientDensity. */
  rhythmicStrength?: number
  /** Which extraction produced this row; absent = version 1. Rows below
   * STEM_FEATURE_VERSION get re-extracted by the ambient background scans
   * (stemFeaturesCache.ts's requireCurrentVersion). */
  featureVersion?: number
}

/** Current StemFeatures extraction version. 2 = Phase 3 fields added
 * (spectralCentroidFftHz, onsetRegularity, rhythmicStrength). */
export const STEM_FEATURE_VERSION = 2

/** A row's extraction version -- rows without a (valid) featureVersion are
 * version 1. */
export function stemFeatureVersionOf(features: StemFeatures): number {
  const v = features.featureVersion
  return typeof v === 'number' && Number.isFinite(v) ? v : 1
}

/** True when a row is at least STEM_FEATURE_VERSION (nothing to re-extract). */
export function isCurrentStemFeatureVersion(features: StemFeatures): boolean {
  return stemFeatureVersionOf(features) >= STEM_FEATURE_VERSION
}

/** Flattens a StemFeatures into a single plain number array, in a FIXED
 * order every caller must agree on (used identically by
 * standardizeFeatures below and by the clustering algorithm that
 * consumes its output) -- 6 scalar features followed by all 13 MFCC
 * coefficients, 19 numbers total. */
export function toFeatureArray(f: StemFeatures): number[] {
  return [
    f.transientDensity,
    f.bassEnergyRatio,
    f.spectralCentroidHz,
    f.zcrBrightness,
    f.voicedFraction,
    f.pitchVarianceCents,
    ...f.mfcc
  ]
}

/**
 * Z-score standardizes each feature DIMENSION independently across the
 * whole population of vectors -- raw feature scales differ wildly
 * (transientDensity is roughly 0-1, MFCC coefficients can be tens in
 * either direction), and clustering on unstandardized features would let
 * the largest-magnitude feature dominate the Euclidean distance metric.
 * A dimension with zero spread (identical value across every input, or a
 * single-vector population) standardizes to a flat 0 for every vector
 * rather than dividing by a zero stddev -- there's no information in a
 * dimension nothing varies along anyway.
 */
export function standardizeFeatures(vectors: number[][]): number[][] {
  if (vectors.length === 0) return []
  const numDims = vectors[0].length

  const means = new Array<number>(numDims).fill(0)
  for (const v of vectors) for (let d = 0; d < numDims; d++) means[d] += v[d]
  for (let d = 0; d < numDims; d++) means[d] /= vectors.length

  const stddevs = new Array<number>(numDims).fill(0)
  for (const v of vectors) for (let d = 0; d < numDims; d++) stddevs[d] += (v[d] - means[d]) ** 2
  for (let d = 0; d < numDims; d++) stddevs[d] = Math.sqrt(stddevs[d] / vectors.length)

  return vectors.map((v) =>
    v.map((value, d) => (stddevs[d] > 1e-10 ? (value - means[d]) / stddevs[d] : 0))
  )
}
