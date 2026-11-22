// src/shared/discoverRanking.ts
import type { DiscoverCandidate } from './discoverCandidate'
import {
  DISCOVER_TRAIT_DIRECTION,
  DISCOVER_TRAIT_FIELD,
  DISCOVER_TRAIT_PREFERRED_FIELD
} from './discoverTraits'
import { isDialKind, type DiscoverRankKind, type DiscoverTraitKind } from './discoverSlotKind'
import { radioClashBedScore, radioClashTraitScore, type RankClash } from './radioClash'
import { DIG_WEIGHT, radioDigCloseness, type RankDig } from './radioDig'
import { hasKey, keyFit, type RiffKey } from './keyFit'
import { intensityTerms, type RankIntensity } from './radioIntensity'
import { coverOf, mixCovered, type Cover } from './radioCover'

// A fitting key outweighs a favourite (1.5): a strong lean, not a rule (spec 2026-11-21, 1). At
// the default matching a fitting stem is drawn about three times as often as a clashing one of
// the same tempo; discoverRanking.test.ts measures it.
export const KEY_WEIGHT = 2

/** The keys a pick will sound with (every other row that isn't drums). `exempt`: the slot
 * being filled is drums, which has no key. */
export interface RankKey {
  others: readonly RiffKey[]
  exempt?: boolean
}

// A trait's weight: balance shapes a pick as much as "bright" does, under key (2) and a
// favourite (1.5). Spec 2026-11-21-picking-key-level-groove-design, 3.
export const BALANCE_WEIGHT = 1

/** The presences (a candidate's `presence`, 0 sparse and quiet to 1 busy and loud) of the rows a
 * pick will sound with that count toward the balance. `exempt`: the slot being filled doesn't
 * count (drums). */
export interface RankBalance {
  others: readonly number[]
  exempt?: boolean
}

// No long silence (@shared/radioCover): the fewest candidates the cover rule may leave. Under it
// the pool is too small to draw from without repeats (the intensity band's own floor), so the
// whole pool stays and leans to the fuller stems instead.
export const COVER_POOL_MIN = 8
// That lean: as strong as a fitting key.
export const COVER_WEIGHT = 2

/** The covers (a candidate's `cover`; null: unknown) of the rows a pick will sound with, drums
 * among them. */
export interface RankCover {
  others: readonly Cover[]
}

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
// kind of live-data tuning pass once there's a real
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

/** A favourite weight in [0, 1]; anything non-finite counts as 0. */
function clampWeight(w: number): number {
  return Number.isFinite(w) ? Math.max(0, Math.min(1, w)) : 0
}

/** Scores every candidate by BPM closeness, plus an optional favourites
 * boost, plus one score per requested trait kind, summed (combination
 * slots: trait kinds AND together). A trait's score is the candidate's own
 * library percentile (traitPercentiles, [0, 1]) when it has one; only a
 * candidate lacking it falls back to pool-relative min-max (traitScore). Descending score order.
 * Never throws; an empty input returns an empty ranking. */
export function rankCandidates(
  candidates: DiscoverCandidate[],
  {
    targetBpm,
    favouriteStemCIDs,
    favouriteWeight,
    favouriteScale = 1,
    targetTraits = [],
    clash,
    dig,
    intensity,
    key,
    balance,
    cover
  }: {
    targetBpm: number
    favouriteStemCIDs?: ReadonlySet<string>
    /** Optional per-stem favourite strength, clamped to [0, 1]: the boost
     * becomes FAVOURITE_BOOST * weight. For a crowd that hearts some stems
     * more than others (ell.ing/radio's ♥). A stem already in
     * favouriteStemCIDs keeps its full boost; absent, nothing changes. */
    favouriteWeight?: (stemCID: string) => number
    /** The faves dial's lean (@shared/discoverFaves favesBoostScale), clamped to [0, 1]:
     * multiplies the whole favourites boost. Absent: 1, the full boost, as before. 0: no boost
     * at all -- exactly the ranking without favourites. */
    favouriteScale?: number
    targetTraits?: readonly DiscoverRankKind[]
    /** Radio fold mode's `clash` (@shared/radioClash): a requested rhythmic or bright trait
     * turns toward its other end, and distance from the bed on those two traits scores. Absent
     * or amount 0: exactly the ranking without it. */
    clash?: RankClash
    /** Radio's dig (@shared/radioDig): every candidate gains DIG_WEIGHT * its closeness to the
     * dug stem (0 to 0.75). Absent: no term, exactly the ranking without it. */
    dig?: RankDig
    /** Radio's intensity lean (@shared/radioIntensity, spec 2026-10-05-radio-intensity-arc-design
     * 2.3): every candidate gains INTENSITY_WEIGHT * weight * (1 - |its rank by score in this pool
     * - target|), an unscored one the neutral 0.5 closeness. Absent: no term, exactly the ranking
     * without it. */
    intensity?: RankIntensity
    /** The key lean (@shared/keyFit, spec 2026-11-21, 1): every candidate gains KEY_WEIGHT * its
     * mean keyFit to the sounding rows' keys. Absent, exempt, or no other row with a known key:
     * no term, exactly the ranking without it. */
    key?: RankKey
    /** The balance lean (spec 2026-11-21, 3): a candidate with a presence gains BALANCE_WEIGHT *
     * (1 - |its presence - (1 - the strongest other row's)|), so a strong bed pulls sparse picks
     * up and a sparse bed strong ones. Absent, exempt, no other row with a presence, or a
     * candidate without one: no term, exactly the ranking without it. */
    balance?: RankBalance
    /** No long silence (@shared/radioCover): a candidate that would leave the mix covering less
     * than MIN_MIX_COVER is left out of the ranking. Fewer than COVER_POOL_MIN left (or than the
     * whole pool, when it is smaller): nobody is left out, and every candidate gains COVER_WEIGHT
     * * its cover. Absent, or no candidate with a measured cover: exactly the ranking without it. */
    cover?: RankCover
  }
): RankedCandidate[] {
  // Pool-relative values per kind, for candidates without a library
  // percentile. Phase 3: a pool can mix re-extracted rows (preferred field)
  // and old ones (fallback field only) -- different scales, so min-max
  // across both would be meaningless. The preferred field is used only when
  // every candidate with field values has it; otherwise everyone is ranked
  // on the fallback field, which every analysed row carries. Candidates
  // without field values (legacy constructors) use traitValues as-is.
  // A dial kind (back/front) has no pool fallback: only its percentile ranks.
  const traitKinds = targetTraits.filter((k): k is DiscoverTraitKind => !isDialKind(k))
  const poolValues = new Map<DiscoverTraitKind, (c: DiscoverCandidate) => number | null>()
  for (const kind of traitKinds) {
    const preferred = DISCOVER_TRAIT_PREFERRED_FIELD[kind]
    const fallback = DISCOVER_TRAIT_FIELD[kind]
    const allHavePreferred = candidates.every((c) => {
      if (!c.traitFieldValues) return true
      const fb = c.traitFieldValues[fallback]
      const pv = c.traitFieldValues[preferred]
      const hasFallback = typeof fb === 'number' && Number.isFinite(fb)
      return !hasFallback || (typeof pv === 'number' && Number.isFinite(pv))
    })
    const field = allHavePreferred ? preferred : fallback
    poolValues.set(kind, (c) =>
      c.traitFieldValues ? (c.traitFieldValues[field] ?? null) : (c.traitValues[kind] ?? null)
    )
  }

  const ranges = new Map<DiscoverTraitKind, { min: number; max: number }>()
  for (const kind of traitKinds) {
    const valueOf = poolValues.get(kind)!
    let min = Infinity
    let max = -Infinity
    for (const c of candidates) {
      const v = valueOf(c)
      if (v === null || !Number.isFinite(v)) continue
      if (v < min) min = v
      if (v > max) max = v
    }
    if (max > min) ranges.set(kind, { min, max })
  }

  const boost = FAVOURITE_BOOST * clampWeight(favouriteScale)
  const leaned = intensity ? intensityTerms(candidates, intensity) : null
  const keyOthers = key && !key.exempt ? key.others.filter(hasKey) : []
  const strongest =
    balance && !balance.exempt
      ? Math.max(-Infinity, ...balance.others.filter(Number.isFinite))
      : NaN
  const fills =
    cover && candidates.some((c) => Number.isFinite(c.cover))
      ? candidates.map((c) => mixCovered([...cover.others, c.cover]))
      : null
  const coverBars =
    fills !== null && fills.filter(Boolean).length >= Math.min(COVER_POOL_MIN, candidates.length)
  return candidates
    .map((candidate, i) => {
      const bpmDistance = Math.abs(candidate.riffBpm - targetBpm)
      let score = Math.max(0, 1 - bpmDistance / BPM_FALLOFF)
      if (favouriteStemCIDs?.has(candidate.stemCID)) score += boost
      else if (favouriteWeight) score += boost * clampWeight(favouriteWeight(candidate.stemCID))
      for (const kind of targetTraits) {
        // Library percentile (Phase 1 of the 2026-09-22 promise-vs-delivery
        // spec) when main attached one -- already direction-adjusted, and
        // comparable across rolls, unlike the pool's own min-max range.
        const percentile = candidate.traitPercentiles?.[kind]
        const hasPercentile = typeof percentile === 'number' && Number.isFinite(percentile)
        if (isDialKind(kind)) {
          if (hasPercentile) score += percentile * TRAIT_SCORE_WEIGHT
          continue
        }
        const trait = hasPercentile
          ? percentile
          : traitScore(
              poolValues.get(kind)!(candidate),
              DISCOVER_TRAIT_DIRECTION[kind],
              ranges.get(kind)
            )
        score += radioClashTraitScore(kind, trait, clash?.amount ?? 0) * TRAIT_SCORE_WEIGHT
      }
      if (clash) score += radioClashBedScore(candidate.traitPercentiles ?? {}, clash)
      if (dig) score += DIG_WEIGHT * radioDigCloseness(dig, candidate)
      if (keyOthers.length > 0) {
        const own = { root: candidate.riffRoot ?? null, scale: candidate.riffScale ?? null }
        let sum = 0
        for (const other of keyOthers) sum += keyFit(own, other)
        score += KEY_WEIGHT * (sum / keyOthers.length)
      }
      if (Number.isFinite(strongest) && Number.isFinite(candidate.presence)) {
        score += BALANCE_WEIGHT * (1 - Math.abs(candidate.presence! - (1 - strongest)))
      }
      if (leaned) score += leaned[i]
      if (fills !== null && !coverBars) score += COVER_WEIGHT * coverOf(candidate.cover)
      return { candidate, score }
    })
    .filter((_, i) => !coverBars || fills[i])
    .sort((a, b) => b.score - a.score)
}

/** Where Discover's chaos starts, and where a double-click on the
 * "matching" dial (which shows 100 - chaos) puts it back. Elling,
 * 2026-10-01: matching about 25%. Was 0 (matching all the way up, direct
 * request 2026-09-22). A riff opened in Discover starts here too. */
export const DEFAULT_DISCOVER_CHAOS = 75 // Elling: matching ≈ 25

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
 * `ranked` list. `random` is the draw's generator -- Math.random unless a
 * caller (a test, or the web radio's seeded picker) injects one. */
export function pickReroll(
  ranked: RankedCandidate[],
  chaos: number,
  random: () => number = Math.random
): DiscoverCandidate | null {
  if (ranked.length === 0) return null
  const poolSize = poolSizeForChaos(ranked.length, chaos)
  const pool = ranked.slice(0, poolSize)
  if (pool.length === 1) return pool[0].candidate

  const totalWeight = pool.reduce((sum, c) => sum + c.score, 0)
  if (totalWeight <= 0) {
    return pool[Math.floor(random() * pool.length)].candidate
  }
  const draw = random() * totalWeight
  let cumulative = 0
  for (const c of pool) {
    cumulative += c.score
    if (draw < cumulative) return c.candidate
  }
  return pool[pool.length - 1].candidate // floating-point safety net
}
