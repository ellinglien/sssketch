import type { BusId } from './types'

// Matches toFeatureArray's own fixed layout (stemFeatures.ts) -- every raw
// vector this module ever receives is expected to already be in that order.
const FEATURE_DIM = 19

// 'aux' is deliberately never trained -- it's this app's existing "no
// confident answer" bucket (see busCentroids's own callers), not a real
// sound category with a coherent acoustic signature of its own. Training
// on it would blur its centroid across everything nobody could place
// anywhere else, making it drift toward the middle of the whole feature
// space -- exactly the wrong direction for a useful classifier.
const TRAINABLE_BUS_IDS: BusId[] = ['drums', 'bass', 'lead', 'backing']

interface BusCentroid {
  /** Running mean of every RAW (unstandardized) feature vector confirmed
   * into this bus so far -- kept in raw space specifically so it never goes
   * stale as `global` below evolves: a centroid stored pre-standardized
   * would need re-deriving every time global stats shifted, or comparisons
   * against it would silently drift out of alignment with fresh queries. */
  mean: number[]
  count: number
}

interface GlobalStats {
  mean: number[]
  /** Welford's running sum of squared deviations from the mean -- variance
   * is m2/count, computed lazily at standardize() time rather than stored
   * directly, so accumulating more samples never needs to "undo" a
   * previously-computed variance. */
  m2: number[]
  count: number
}

/**
 * Cross-project, incrementally-trained classifier state: for each real bus,
 * a running mean of every confirmed stem's raw feature vector, plus a
 * single set of GLOBAL per-dimension mean/variance (across every confirmed
 * stem, any bus) used to standardize both stored centroids and new queries
 * at comparison time -- see standardize()'s own doc comment for why this
 * has to happen at query time rather than once at storage time.
 */
export interface BusCentroidStore {
  buses: Partial<Record<BusId, BusCentroid>>
  global: GlobalStats
}

export function emptyBusCentroidStore(): BusCentroidStore {
  return {
    buses: {},
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

function updateRunningMean(centroid: BusCentroid | undefined, vector: number[]): BusCentroid {
  if (!centroid) return { mean: vector.slice(), count: 1 }
  const count = centroid.count + 1
  const mean = centroid.mean.map((m, d) => m + (vector[d] - m) / count)
  return { mean, count }
}

/**
 * Folds one more confirmed (stem -> bus) assignment into the store --
 * updates that bus's own running centroid AND the shared global stats, both
 * incrementally (no need to replay every past vector). A no-op for 'aux'
 * (see TRAINABLE_BUS_IDS's own doc comment) -- returns the SAME store
 * reference unchanged, not a copy, so a caller folding many stems in a
 * batch loop can cheaply skip persisting when nothing actually changed.
 */
export function recordConfirmedStem(
  store: BusCentroidStore,
  busId: BusId,
  rawFeatureVector: number[]
): BusCentroidStore {
  if (!TRAINABLE_BUS_IDS.includes(busId)) return store
  return {
    buses: { ...store.buses, [busId]: updateRunningMean(store.buses[busId], rawFeatureVector) },
    global: updateWelford(store.global, rawFeatureVector)
  }
}

// A bus needs at least this many confirmed samples before its centroid is
// trusted enough to suggest from -- an early centroid built from 1-2 points
// is really just "whatever those points happened to be," not a real
// acoustic signature yet.
const MIN_SAMPLES_PER_BUS = 3

// The nearest bus must be at least this much closer than the SECOND-nearest
// to count as a confident suggestion (0.7 = nearest distance must be at
// most 70% of second-nearest's) -- guards against forcing a coin-flip guess
// when a stem genuinely sits between two trained sounds, matching this
// feature's own pre-decided "fall back to aux rather than force a bad
// guess" rule (see the phase 2 design spec).
const CONFIDENCE_RATIO = 0.7

/** Standardizes `vector` using GLOBAL stats, not the population it happened
 * to arrive with -- unlike stemFeatures.ts's own standardizeFeatures (which
 * is deliberately per-clustering-run, relative to just that run's own
 * stems), this store's whole point is comparing vectors across DIFFERENT
 * imports/projects over time, so there's no single fixed population to
 * standardize against up front. Both a stored bus centroid and a fresh
 * query vector get standardized this same way, at comparison time, using
 * whatever the CURRENT global stats are -- so a centroid trained months
 * ago never goes stale relative to today's stats the way pre-standardizing
 * it once at storage time would. */
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
 * Nearest-centroid classification for one new stem's raw feature vector --
 * returns null (not a forced guess) when fewer than MIN_SAMPLES_PER_BUS
 * samples back the nearest bus, or when the nearest and second-nearest
 * buses are too close together to call confidently (see CONFIDENCE_RATIO).
 * A caller should fall back to 'aux' (or the existing DSP-clustering flow)
 * on null, exactly as an unassigned stem already does today.
 */
export function suggestBus(store: BusCentroidStore, rawFeatureVector: number[]): BusId | null {
  const trainedBusIds = TRAINABLE_BUS_IDS.filter(
    (id) => (store.buses[id]?.count ?? 0) >= MIN_SAMPLES_PER_BUS
  )
  if (trainedBusIds.length === 0) return null

  const query = standardize(rawFeatureVector, store.global)
  const distances = trainedBusIds
    .map((busId) => ({
      busId,
      distance: euclideanDistance(query, standardize(store.buses[busId]!.mean, store.global))
    }))
    .sort((a, b) => a.distance - b.distance)

  const [nearest, secondNearest] = distances
  if (secondNearest && nearest.distance > CONFIDENCE_RATIO * secondNearest.distance) return null
  return nearest.busId
}
