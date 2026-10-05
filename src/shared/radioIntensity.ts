// src/shared/radioIntensity.ts
//
// THE PER-STEM INTENSITY SCORE, and the lean it puts on radio's picks
// (docs/superpowers/specs/2026-10-05-radio-intensity-arc-design.md sections 2.1-2.3).
//
// Elling, 2026-10-05: intensity is led by rhythm -- busier drums and heavier bass drive it
// ("that's where the buildups come from"); loudness, fullness and brightness ride along. So a
// stem's score is four parts, each a LIBRARY PERCENTILE (percentileOf over the same quantile
// tables traits use, built over the whole library on the desktop, over the exported stems on the
// web), weighted 0.40 busy, 0.35 low, 0.15 full, 0.10 bright. A missing input drops out of its
// part and a missing part out of the score, both renormalised; with neither busy nor low the
// stem is unscored (null).
//
// The lean (section 2.3) runs only while radio runs with density `intensity`: a band draw that
// keeps the candidates whose RANK in the pool is near the arc's target (applyIntensityBand), and a
// ranking term toward it (rankCandidates' `intensity`, RankIntensity). Ranks are inside the pool,
// so "busier" means "busier among what this slot can play". Both are weighted by the slot's role:
// most on drums and bass rows. Pure; the band's one draw comes from the caller's random.

import type { DiscoverCandidate } from './discoverCandidate'
import type { DiscoverSlotKind } from './discoverSlotKind'
import {
  INTENSITY_FIELDS,
  percentileOf,
  type QuantileField,
  type TraitQuantileTables
} from './traitQuantiles'

export { INTENSITY_FIELDS }

/** Every StemFeatures field the score reads. */
export type IntensityInputField = Extract<
  QuantileField,
  | 'transientDensity'
  | 'rhythmicStrength'
  | 'bassEnergyRatio'
  | 'lowLevelDb'
  | 'loudnessLufs'
  | 'activeFraction'
  | 'spectralCentroidHz'
  | 'spectralCentroidFftHz'
>

export const INTENSITY_INPUT_FIELDS: readonly IntensityInputField[] = [
  'transientDensity',
  'rhythmicStrength',
  'bassEnergyRatio',
  'lowLevelDb',
  'loudnessLufs',
  'activeFraction',
  'spectralCentroidHz',
  'spectralCentroidFftHz'
]

/** A stem's raw values for the score (absent, null or non-finite: missing). */
export type IntensityValues = Partial<Record<IntensityInputField, number | null>>

export type IntensityPart = 'busy' | 'low' | 'full' | 'bright'

/** The parts' weights (Decision 1: rhythm and low end 0.75, the rest 0.25). [INF] */
export const INTENSITY_WEIGHTS: Readonly<Record<IntensityPart, number>> = {
  busy: 0.4,
  low: 0.35,
  full: 0.15,
  bright: 0.1
}

/** Inside each part: its inputs and their weights. `bright` is one percentile: the FFT centroid
 * when the stem has it and its table exists, else the 3-band centroid (the bright trait's rule). */
const PART_INPUTS: Readonly<
  Record<Exclude<IntensityPart, 'bright'>, readonly (readonly [IntensityInputField, number])[]>
> = {
  busy: [
    ['transientDensity', 0.6],
    ['rhythmicStrength', 0.4]
  ],
  low: [
    ['bassEnergyRatio', 0.5],
    ['lowLevelDb', 0.5]
  ],
  full: [
    ['loudnessLufs', 0.5],
    ['activeFraction', 0.5]
  ]
}

const finite = (v: number | null | undefined): v is number =>
  typeof v === 'number' && Number.isFinite(v)

/** One input's library percentile, or null when the stem lacks it or no table exists yet. */
function pct(
  values: IntensityValues,
  tables: TraitQuantileTables,
  field: IntensityInputField
): number | null {
  const v = values[field]
  return finite(v) ? percentileOf(tables[field], v) : null
}

/** A part from its present inputs, their weights renormalised; null when none is present. */
function part(
  values: IntensityValues,
  tables: TraitQuantileTables,
  inputs: readonly (readonly [IntensityInputField, number])[]
): number | null {
  let sum = 0
  let weight = 0
  for (const [field, w] of inputs) {
    const p = pct(values, tables, field)
    if (p === null) continue
    sum += w * p
    weight += w
  }
  return weight > 0 ? sum / weight : null
}

/** Each part's value for a stem (null: missing). */
export function stemIntensityParts(
  values: IntensityValues,
  tables: TraitQuantileTables
): Record<IntensityPart, number | null> {
  const fft = finite(values.spectralCentroidFftHz) && tables.spectralCentroidFftHz !== undefined
  return {
    busy: part(values, tables, PART_INPUTS.busy),
    low: part(values, tables, PART_INPUTS.low),
    full: part(values, tables, PART_INPUTS.full),
    bright: pct(values, tables, fft ? 'spectralCentroidFftHz' : 'spectralCentroidHz')
  }
}

/** The score, in [0, 1], or null (unscored: neither busy nor low). Pure, no randomness. */
export function stemIntensityScore(
  values: IntensityValues,
  tables: TraitQuantileTables
): number | null {
  const parts = stemIntensityParts(values, tables)
  if (parts.busy === null && parts.low === null) return null
  let sum = 0
  let weight = 0
  for (const k of Object.keys(INTENSITY_WEIGHTS) as IntensityPart[]) {
    const p = parts[k]
    if (p === null) continue
    sum += INTENSITY_WEIGHTS[k] * p
    weight += INTENSITY_WEIGHTS[k]
  }
  return sum / weight
}

/** The score rounded to 3 places (the web index's `x`), or null. */
export function roundIntensity(score: number | null): number | null {
  return score === null || !Number.isFinite(score) ? null : Math.round(score * 1000) / 1000
}

// ---- the lean on picks (section 2.3) ----

/** How much the lean counts on a slot, by kind (the largest over its kinds). [INF] */
export const INTENSITY_ROLE_WEIGHT: Readonly<Record<DiscoverSlotKind, number>> = {
  drums: 1,
  bass: 1,
  bassHeavy: 0.8,
  rhythmic: 0.8,
  lead: 0.35,
  bright: 0.35,
  warm: 0.25
}

export function radioIntensityRoleWeight(kinds: readonly DiscoverSlotKind[]): number {
  let w = 0
  for (const k of kinds) w = Math.max(w, INTENSITY_ROLE_WEIGHT[k] ?? 0)
  return w
}

/** The band draw's chance at full role weight and full drama. */
export const INTENSITY_BAND_CHANCE = 0.5
/** How far from the target a rank may sit and stay in the band. */
export const INTENSITY_BAND_HALF_WIDTH = 0.25
/** The band backs off when fewer than max(this, ceil(pool / 8)) candidates would remain. */
export const INTENSITY_BAND_MIN = 8
/** The ranking term's most (one trait's worth, under the favourite boost's 1.5). */
export const INTENSITY_WEIGHT = 1
/** The term's closeness for an unscored candidate: neutral. */
export const INTENSITY_UNSCORED_CLOSENESS = 0.5

/** What rankCandidates needs for the term: the arc's target and the slot's weight
 * (radioIntensityRankOf). */
export interface RankIntensity {
  target: number
  weight: number
}

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0)

/** The term's input for a slot: weight = w * (0.4 + 0.6 d), d = drama / 100. */
export function radioIntensityRankOf(
  target: number,
  kinds: readonly DiscoverSlotKind[],
  drama: number
): RankIntensity {
  const d = clamp01(drama / 100)
  return { target: clamp01(target), weight: radioIntensityRoleWeight(kinds) * (0.4 + 0.6 * d) }
}

/**
 * Each scored candidate's rank by score inside `pool`, in [0, 1]: 0 the lowest, 1 the highest;
 * a run of equal scores takes the middle of its run (as percentileOf does); a lone scored
 * candidate is 0.5. Unscored candidates (intensity null or absent) have no rank. Keyed by
 * position in `pool`.
 */
export function intensityPoolRanks(
  pool: readonly Pick<DiscoverCandidate, 'intensity'>[]
): Map<number, number> {
  const scored: { i: number; v: number }[] = []
  pool.forEach((c, i) => {
    if (finite(c.intensity)) scored.push({ i, v: c.intensity })
  })
  const out = new Map<number, number>()
  if (scored.length === 0) return out
  if (scored.length === 1) {
    out.set(scored[0].i, 0.5)
    return out
  }
  scored.sort((a, b) => a.v - b.v)
  const last = scored.length - 1
  for (let lo = 0; lo < scored.length;) {
    let hi = lo
    while (hi + 1 < scored.length && scored[hi + 1].v === scored[lo].v) hi += 1
    const r = (lo + hi) / 2 / last
    for (let j = lo; j <= hi; j++) out.set(scored[j].i, r)
    lo = hi + 1
  }
  return out
}

/** The ranking term for each candidate of `pool` (rankCandidates adds it): INTENSITY_WEIGHT *
 * weight * closeness, closeness = 1 - |r - target| (unscored: 0.5). In [0, weight]. */
export function intensityTerms(
  pool: readonly Pick<DiscoverCandidate, 'intensity'>[],
  lean: RankIntensity
): number[] {
  const ranks = intensityPoolRanks(pool)
  const target = clamp01(lean.target)
  const weight = Number.isFinite(lean.weight) ? Math.max(0, lean.weight) : 0
  return pool.map((_, i) => {
    const r = ranks.get(i)
    const closeness = r === undefined ? INTENSITY_UNSCORED_CLOSENESS : 1 - Math.abs(r - target)
    return INTENSITY_WEIGHT * weight * closeness
  })
}

export interface IntensityBandResult<T> {
  pool: T[]
  /** The draw kept only the band. */
  banded: boolean
  /** The draw asked for the band but too few were in it: the pool as it was. */
  backedOff: boolean
}

/**
 * THE BAND DRAW, like the faves draw: ONE draw `< INTENSITY_BAND_CHANCE * w * d` keeps only the
 * candidates whose rank is within INTENSITY_BAND_HALF_WIDTH of the target -- unless fewer than
 * max(INTENSITY_BAND_MIN, ceil(pool / 8)) would remain, when the pool stays as it was
 * (`backedOff`; applyTraitBar's back-off). The draw is always made (one number) when called; the
 * caller calls it only while intensity runs, after dig's near draw. Order kept.
 */
export function applyIntensityBand<T extends Pick<DiscoverCandidate, 'intensity'>>(
  pool: readonly T[],
  o: { target: number; kinds: readonly DiscoverSlotKind[]; drama: number; random: () => number }
): IntensityBandResult<T> {
  const d = clamp01(o.drama / 100)
  const chance = INTENSITY_BAND_CHANCE * radioIntensityRoleWeight(o.kinds) * d
  if (!(o.random() < chance)) return { pool: [...pool], banded: false, backedOff: false }
  const ranks = intensityPoolRanks(pool)
  const target = clamp01(o.target)
  const kept = pool.filter((_, i) => {
    const r = ranks.get(i)
    return r !== undefined && Math.abs(r - target) <= INTENSITY_BAND_HALF_WIDTH + 1e-9
  })
  const least = Math.max(INTENSITY_BAND_MIN, Math.ceil(pool.length / 8))
  if (kept.length < least) return { pool: [...pool], banded: false, backedOff: true }
  return { pool: kept, banded: true, backedOff: false }
}

/** The bed's intensity (sims and tests): the role-weighted mean score of the sounding rows that
 * are scored; null when none is. */
export function radioBedIntensity(
  rows: readonly { kinds: readonly DiscoverSlotKind[]; score: number | null }[]
): number | null {
  let sum = 0
  let weight = 0
  for (const r of rows) {
    if (!finite(r.score)) continue
    const w = radioIntensityRoleWeight(r.kinds)
    sum += w * r.score
    weight += w
  }
  return weight > 0 ? sum / weight : null
}
