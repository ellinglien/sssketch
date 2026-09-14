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

/** Scores every candidate by BPM closeness to the target -- see this plan's
 * own header for why key/root-scale matching isn't included (no existing
 * normalized "project's own target key" value to compare against). Returns
 * candidates in descending score order. Never throws; an empty input
 * returns an empty ranking. */
export function rankCandidates(
  candidates: DiscoverCandidate[],
  { targetBpm }: { targetBpm: number }
): RankedCandidate[] {
  return candidates
    .map((candidate) => {
      const bpmDistance = Math.abs(candidate.riffBpm - targetBpm)
      const score = Math.max(0, 1 - bpmDistance / BPM_FALLOFF)
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
