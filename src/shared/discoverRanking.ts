// src/shared/discoverRanking.ts
import type { DiscoverCandidate } from '../main/discoverCandidates'
import { DISCOVER_TRAIT_DIRECTION } from './discoverTraits'
import type { DiscoverTraitKind } from './discoverSlotKind'

export interface RankedCandidate {
  candidate: DiscoverCandidate
  score: number
}

// How many BPM away from the target counts as "completely incompatible"
// (score floors at 0 past this) -- wide enough that a half-time/double-time
// match (off by a clean factor of 2) still scores something, narrow enough
// that a genuinely unrelated tempo doesn't rank alongside a close one.
//
// NOT YET VALIDATED against real data (2026-09-14 code quality review) --
// this hasn't been checked against Elling's own actual riff-tempo
// distribution, only reasoned about in the abstract. Likely needs the same
// kind of live-data tuning pass CONFIDENCE_RATIO got (see
// categoryCentroids.ts's own 0.7->0.85 fix, 2026-09-14) once there's a real
// library of Discover picks to check it against -- don't treat 40 as tuned
// or final.
const BPM_FALLOFF = 40

// Added to a favourited candidate's own BPM-closeness score (max 1) before
// weighting -- direct request, 2026-09-16: "prefer favourite stems when
// randomizing." A SOFT boost, not a hard filter -- deliberately chosen
// over "only show favourites" after the exact lottery-odds bug this
// session already hit once for "only my stems" (near-impossible odds once
// the eligible pool shrinks to a handful of stems for a given role). 1.5
// is bigger than the max possible BPM score (1), so a favourite reliably
// outweighs a non-favourite regardless of tempo closeness, without ever
// making a non-favourite's weight hit exactly zero (pickReroll's own
// score-proportional draw still gives it real, if smaller, odds).
const FAVOURITE_BOOST = 1.5

// Added to a candidate's own BPM score before weighting, once per requested
// trait kind, same additive-with-tunable-weight shape as FAVOURITE_BOOST
// above -- direct request, 2026-09-18: rank trait-kind rolls (bassHeavy/
// rhythmic/bright/warm) by real closeness to the target end of their own
// StemFeatureCache field, on top of the existing BPM term (never a
// replacement for it). 1 (not larger, unlike FAVOURITE_BOOST's 1.5) -- a
// trait roll's WHOLE point is trait closeness, so it should be able to
// meaningfully outweigh a BPM-only near-miss, but doesn't need to be an
// even bigger gap than FAVOURITE_BOOST's own deliberately-dominant weight.
const TRAIT_SCORE_WEIGHT = 1

/** Pool-relative closeness for one trait: min-max scaled across the pool
 * being ranked (a fixed max can't normalize spectralCentroidHz, which is
 * raw Hz), then flipped for 'low'. A null value, or a trait with no spread
 * across the pool (range undefined), scores 0 -- never NaN, never a win. */
function traitScore(
  value: number | null | undefined,
  direction: 'high' | 'low',
  range: { min: number; max: number } | undefined
): number {
  if (value === null || value === undefined || !Number.isFinite(value) || !range) return 0
  const normalized = (value - range.min) / (range.max - range.min)
  return direction === 'high' ? normalized : 1 - normalized
}

/** Scores every candidate by BPM closeness, plus an optional favourites
 * boost, plus one pool-relative score per requested trait kind, summed
 * (combination slots: trait kinds AND together). Descending score order.
 * Never throws; an empty input returns an empty ranking. */
export function rankCandidates(
  candidates: DiscoverCandidate[],
  {
    targetBpm,
    favouriteStemCIDs,
    targetTraits = []
  }: {
    targetBpm: number
    favouriteStemCIDs?: Set<string>
    targetTraits?: readonly DiscoverTraitKind[]
  }
): RankedCandidate[] {
  const ranges = new Map<DiscoverTraitKind, { min: number; max: number }>()
  for (const kind of targetTraits) {
    let min = Infinity
    let max = -Infinity
    for (const c of candidates) {
      const v = c.traitValues[kind]
      if (v === null || v === undefined || !Number.isFinite(v)) continue
      if (v < min) min = v
      if (v > max) max = v
    }
    if (max > min) ranges.set(kind, { min, max })
  }

  return candidates
    .map((candidate) => {
      const bpmDistance = Math.abs(candidate.riffBpm - targetBpm)
      let score = Math.max(0, 1 - bpmDistance / BPM_FALLOFF)
      if (favouriteStemCIDs?.has(candidate.stemCID)) score += FAVOURITE_BOOST
      for (const kind of targetTraits) {
        score +=
          traitScore(
            candidate.traitValues[kind],
            DISCOVER_TRAIT_DIRECTION[kind],
            ranges.get(kind)
          ) * TRAIT_SCORE_WEIGHT
      }
      return { candidate, score }
    })
    .sort((a, b) => b.score - a.score)
}

// chaos=0 -> exactly the top 1 candidate (deterministic, "safe"). chaos=100
// -> up to the whole ranked list is eligible (loosest). Linear in between.
function poolSizeForChaos(rankedLength: number, chaos: number): number {
  const clamped = Math.max(0, Math.min(100, chaos))
  const size = Math.round(1 + (clamped / 100) * (rankedLength - 1))
  return Math.max(1, Math.min(rankedLength, size))
}

/** Picks one candidate from `ranked` (already sorted by rankCandidates,
 * descending score) for a reroll -- weighted toward the top of a pool
 * whose SIZE is controlled by `chaos` (0 = safest, only the single best
 * candidate is ever eligible; 100 = loosest, the whole ranked list is
 * eligible). Within the eligible pool, weights are proportional to each
 * candidate's own `score` (not its rank/position in the pool) -- the same
 * score-proportional approach as autoArrangeAutomation.ts's own
 * pickWeightedRandomCandidate, reused here rather than reinvented. This
 * means two candidates with nearly identical scores get odds close to a
 * coin flip regardless of which one happens to sort first, while a
 * candidate whose score is far below the pool's best is picked
 * correspondingly rarely -- rank position no longer has any effect except
 * through each candidate's own actual score. If every candidate in the
 * pool scores exactly 0 (possible once BPM distance passes BPM_FALLOFF for
 * all of them), falls back to a uniform pick within the pool rather than
 * dividing by a zero total weight. Returns null only for an empty
 * `ranked` list. */
export function pickReroll(ranked: RankedCandidate[], chaos: number): DiscoverCandidate | null {
  if (ranked.length === 0) return null
  const poolSize = poolSizeForChaos(ranked.length, chaos)
  const pool = ranked.slice(0, poolSize)
  if (pool.length === 1) return pool[0].candidate

  const totalWeight = pool.reduce((sum, c) => sum + c.score, 0)
  if (totalWeight <= 0) {
    return pool[Math.floor(Math.random() * pool.length)].candidate
  }
  const draw = Math.random() * totalWeight
  let cumulative = 0
  for (const c of pool) {
    cumulative += c.score
    if (draw < cumulative) return c.candidate
  }
  return pool[pool.length - 1].candidate // floating-point safety net
}
