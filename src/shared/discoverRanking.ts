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
 * eligible). Within the eligible pool, weights are inverse-rank (the top
 * of the pool is still more likely than the bottom of it, at every chaos
 * setting) rather than uniform, so "reroll" never feels like it ignores
 * the ranking entirely even at chaos=100. Returns null only for an empty
 * `ranked` list. */
export function pickReroll(ranked: RankedCandidate[], chaos: number): DiscoverCandidate | null {
  if (ranked.length === 0) return null
  const poolSize = poolSizeForChaos(ranked.length, chaos)
  const pool = ranked.slice(0, poolSize)
  if (pool.length === 1) return pool[0].candidate

  // Inverse-rank weighting: index 0 gets weight poolSize, the last gets
  // weight 1 -- a simple, stable-enough curve without needing to reason
  // about each candidate's own absolute score gaps.
  const weights = pool.map((_, i) => poolSize - i)
  const totalWeight = weights.reduce((a, b) => a + b, 0)
  let roll = Math.random() * totalWeight
  for (let i = 0; i < pool.length; i++) {
    roll -= weights[i]
    if (roll <= 0) return pool[i].candidate
  }
  return pool[pool.length - 1].candidate
}
