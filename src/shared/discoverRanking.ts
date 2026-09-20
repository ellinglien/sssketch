// src/shared/discoverRanking.ts
import type { DiscoverCandidate } from '../main/discoverCandidates'

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

// Added to a trait-kind candidate's own BPM score before weighting, same
// additive-with-tunable-weight shape as FAVOURITE_BOOST above -- direct
// request, 2026-09-18: rank trait-kind rolls (bassHeavy/rhythmic/bright/
// warm) by real closeness to the target end of their own StemFeatureCache
// field, on top of the existing BPM term (never a replacement for it).
// 1 (not larger, unlike FAVOURITE_BOOST's 1.5) -- a trait roll's WHOLE
// point is trait closeness, so it should be able to meaningfully outweigh
// a BPM-only near-miss, but doesn't need to be an even bigger gap than
// FAVOURITE_BOOST's own deliberately-dominant weight.
const TRAIT_SCORE_WEIGHT = 1

export interface TraitTarget {
  /** Which end of the field's own real range this roll targets --
   * 'high' for bassHeavy/rhythmic/bright, 'low' for warm (see
   * DiscoverSlotKind's own doc comment: bright/warm share one field, two
   * opposite targets). */
  direction: 'high' | 'low'
  /** The field's own plausible max value, for normalizing distance into a
   * 0-1 score -- StemFeatures' own continuous fields are roughly 0-1 already
   * (bassEnergyRatio, transientDensity, zcrBrightness) except
   * spectralCentroidHz (real Hz values, a few hundred to a few thousand) --
   * callers pass whatever's appropriate for the field actually being
   * targeted. */
  maxValue: number
}

/** Normalized [0, 1] closeness to the trait target -- 1 at the extreme
 * (direction='high': traitValue === maxValue; direction='low':
 * traitValue === 0), degrading linearly toward 0 at the opposite extreme.
 * A null traitValue (a candidate somehow missing its own feature value)
 * scores 0 -- worst possible trait match, never a crash or a NaN leaking
 * into the final score. */
function traitScore(traitValue: number | null, target: TraitTarget): number {
  if (traitValue === null || target.maxValue <= 0) return 0
  const normalized = Math.max(0, Math.min(1, traitValue / target.maxValue))
  return target.direction === 'high' ? normalized : 1 - normalized
}

/** Scores every candidate by BPM closeness to the target, optionally
 * boosted for favourited stems and/or a trait-kind roll's own closeness to
 * a trait target -- see this plan's own header for why key/root-scale
 * matching isn't included (no existing normalized "project's own target
 * key" value to compare against). Returns candidates in descending score
 * order. Never throws; an empty input returns an empty ranking. */
export function rankCandidates(
  candidates: DiscoverCandidate[],
  {
    targetBpm,
    favouriteStemCIDs,
    targetTrait
  }: { targetBpm: number; favouriteStemCIDs?: Set<string>; targetTrait?: TraitTarget }
): RankedCandidate[] {
  return candidates
    .map((candidate) => {
      const bpmDistance = Math.abs(candidate.riffBpm - targetBpm)
      let score = Math.max(0, 1 - bpmDistance / BPM_FALLOFF)
      if (favouriteStemCIDs?.has(candidate.stemCID)) score += FAVOURITE_BOOST
      if (targetTrait) score += traitScore(candidate.traitValue, targetTrait) * TRAIT_SCORE_WEIGHT
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
