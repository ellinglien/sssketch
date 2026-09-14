import type { BusId } from './types'
import type { ArrangeRole, DrumSubRole } from './stemRole'

// Matches toFeatureArray's own fixed layout (stemFeatures.ts) -- every raw
// vector this module ever receives is expected to already be in that order.
const FEATURE_DIM = 19

/** Which classification signal a confirmed stem is being trained/queried
 * against. Three independent axes, one shared feature-space/global-stats
 * population (see GlobalStats' own doc comment below for why sharing is
 * correct here). */
export type CategoryAxis = 'bus' | 'arrangeRole' | 'drumSubRole'

// 'aux' (bus and arrangeRole) and 'perc' (drumSubRole) are each their own
// axis's "no confident answer" catch-all -- training on them would blur
// their centroid across everything nobody could place anywhere else,
// exactly the wrong direction for a useful classifier. Mirrors
// TRAINABLE_BUS_IDS' own original reasoning (this module's own predecessor,
// busCentroids.ts), now applied consistently to the other two axes too.
const TRAINABLE_BUS_IDS: BusId[] = ['drums', 'bass', 'lead', 'backing']
const TRAINABLE_ARRANGE_ROLES: ArrangeRole[] = [
  'drums',
  'bass',
  'lead',
  'backing',
  'textureFx',
  'fill',
  'vocal'
]
const TRAINABLE_DRUM_SUB_ROLES: DrumSubRole[] = ['kick', 'snare', 'hihat', 'clap']

function trainableCategoriesFor(axis: CategoryAxis): string[] {
  switch (axis) {
    case 'bus':
      return TRAINABLE_BUS_IDS
    case 'arrangeRole':
      return TRAINABLE_ARRANGE_ROLES
    case 'drumSubRole':
      return TRAINABLE_DRUM_SUB_ROLES
  }
}

type StoreKey = 'buses' | 'arrangeRoles' | 'drumSubRoles'

function storeKeyFor(axis: CategoryAxis): StoreKey {
  switch (axis) {
    case 'bus':
      return 'buses'
    case 'arrangeRole':
      return 'arrangeRoles'
    case 'drumSubRole':
      return 'drumSubRoles'
  }
}

interface Centroid {
  /** Running mean of every RAW (unstandardized) feature vector confirmed
   * into this category so far -- kept in raw space specifically so it
   * never goes stale as `global` below evolves. */
  mean: number[]
  count: number
}

/** ONE shared global stats structure across all three axes, not three
 * separate ones -- global stats describe "what does a typical confirmed
 * stem in this library look like, dimension by dimension," a property of
 * the stem population itself, not of any one classification axis. Sharing
 * means every confirmed stem (whichever axis it was confirmed on)
 * contributes to a single, faster-converging population estimate, rather
 * than needing 3x the samples to get each axis's own estimate up to a
 * useful size. */
export interface GlobalStats {
  mean: number[]
  m2: number[]
  count: number
}

/**
 * Cross-project, incrementally-trained, multi-axis classifier state --
 * generalizes busCentroids.ts's own BusId-only architecture (already live
 * in Tidy Up) to also cover ArrangeRole and DrumSubRole, so the same
 * running-centroid-plus-global-Welford-stats mechanism serves every axis
 * `resolveStemRole` needs a stronger-than-keyword-table signal for.
 */
export interface CategoryCentroidStore {
  buses: Partial<Record<BusId, Centroid>>
  arrangeRoles: Partial<Record<ArrangeRole, Centroid>>
  drumSubRoles: Partial<Record<DrumSubRole, Centroid>>
  global: GlobalStats
}

export function emptyCategoryCentroidStore(): CategoryCentroidStore {
  return {
    buses: {},
    arrangeRoles: {},
    drumSubRoles: {},
    global: { mean: new Array(FEATURE_DIM).fill(0), m2: new Array(FEATURE_DIM).fill(0), count: 0 }
  }
}

function updateWelford(stats: GlobalStats, vector: number[]): GlobalStats {
  const count = stats.count + 1
  const mean = stats.mean.slice()
  const m2 = stats.m2.slice()
  for (let d = 0; d < FEATURE_DIM; d++) {
    const delta = vector[d] - mean[d]
    mean[d] += delta / count
    const delta2 = vector[d] - mean[d]
    m2[d] += delta * delta2
  }
  return { mean, m2, count }
}

function updateRunningMean(centroid: Centroid | undefined, vector: number[]): Centroid {
  if (!centroid) return { mean: vector.slice(), count: 1 }
  const count = centroid.count + 1
  const mean = centroid.mean.map((m, d) => m + (vector[d] - m) / count)
  return { mean, count }
}

/**
 * Folds one more confirmed (stem -> category) assignment into the store,
 * on the given axis -- updates that category's own running centroid AND
 * the shared global stats, both incrementally. A no-op for a non-trainable
 * category on that axis (returns the SAME store reference unchanged, not
 * a copy) -- see the module-level TRAINABLE_* lists above.
 */
export function recordConfirmedCategory(
  store: CategoryCentroidStore,
  axis: CategoryAxis,
  category: string,
  rawFeatureVector: number[]
): CategoryCentroidStore {
  if (!trainableCategoriesFor(axis).includes(category)) return store
  const key = storeKeyFor(axis)
  return {
    ...store,
    [key]: {
      ...store[key],
      [category]: updateRunningMean(
        (store[key] as Record<string, Centroid | undefined>)[category],
        rawFeatureVector
      )
    },
    global: updateWelford(store.global, rawFeatureVector)
  }
}

// A category needs at least this many confirmed samples before its
// centroid is trusted enough to suggest from.
const MIN_SAMPLES_PER_CATEGORY = 3

// The nearest category must be at least this much closer than the
// SECOND-nearest (on the SAME axis) to count as a confident suggestion.
const CONFIDENCE_RATIO = 0.7

function standardize(vector: number[], stats: GlobalStats): number[] {
  return vector.map((v, d) => {
    const variance = stats.count > 0 ? stats.m2[d] / stats.count : 0
    const stddev = Math.sqrt(variance)
    return stddev > 1e-10 ? (v - stats.mean[d]) / stddev : 0
  })
}

function euclideanDistance(a: number[], b: number[]): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2
  return Math.sqrt(sum)
}

/**
 * Nearest-centroid classification for one new stem's raw feature vector,
 * on the given axis only -- never returns a category trained on a
 * different axis. Returns null (not a forced guess) when fewer than
 * MIN_SAMPLES_PER_CATEGORY samples back the nearest category on this axis,
 * or when the nearest and second-nearest are too close to call
 * confidently.
 */
export function suggestCategory(
  store: CategoryCentroidStore,
  axis: CategoryAxis,
  rawFeatureVector: number[]
): string | null {
  const key = storeKeyFor(axis)
  const bucket = store[key] as Record<string, Centroid | undefined>
  const trainedCategories = trainableCategoriesFor(axis).filter(
    (c) => (bucket[c]?.count ?? 0) >= MIN_SAMPLES_PER_CATEGORY
  )
  if (trainedCategories.length === 0) return null

  const query = standardize(rawFeatureVector, store.global)
  const distances = trainedCategories
    .map((c) => ({
      category: c,
      distance: euclideanDistance(query, standardize(bucket[c]!.mean, store.global))
    }))
    .sort((a, b) => a.distance - b.distance)

  const [nearest, secondNearest] = distances
  if (secondNearest && nearest.distance > CONFIDENCE_RATIO * secondNearest.distance) return null
  return nearest.category
}
