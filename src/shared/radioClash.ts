// src/shared/radioClash.ts
//
// Fold mode's `clash` fader (docs/superpowers/specs/2026-10-02-radio-fold-mode-design.md, section
// 2): how mismatched the picks are. The clash lives in TIME and TIMBRE -- rhythmic strength and
// brightness -- and never in key: with no pitch control a key clash reads as a mistake, so bass
// energy and harmonic content (bassHeavy, warm) are left exactly as the picker always ranks them.
// The pair a clash makes is then held together by shared processing: a static low-pass on the
// brighter of the two, and, above 50, a little more master glue and saturation.
//
// Pure, shared by both radios' pickers (discoverRanking's rankCandidates) and their mixes.

import type { TraitPercentiles } from './traitQuantiles'

/** The traits a clash turns round. */
export type ClashTrait = 'rhythmic' | 'bright'
export const CLASH_TRAITS: readonly ClashTrait[] = ['rhythmic', 'bright']
/** Weight of the distance-from-the-bed term, per trait, at a full clash: as much as one trait
 * term, so a mismatch can outrank a close tempo but not a favourite (rankCandidates). */
export const CLASH_BED_WEIGHT = 1
/** The static low-pass on the brighter of a clashing pair (the toolkit's 0..1 cutoff; 0.5 is
 * about 630 Hz). */
export const CLASH_LOWPASS_CUTOFF = 0.5
/** Two rows clash when their brightness percentiles are at least this far apart. */
export const CLASH_PAIR_MIN_GAP = 0.4
/** The most the master glue and saturation lean in, over the listener's own amounts. */
export const CLASH_LEAN_MAX = 0.15

/** What rankCandidates needs: how much (0..1), and the bed's mean percentile per clash trait. */
export interface RankClash {
  amount: number
  bed: Partial<Record<ClashTrait, number>>
}

/** The clash as rankCandidates takes it: 0..1 while fold mode is on, 0 otherwise. */
export function radioClashAmount(foldMode: boolean, clash: number): number {
  if (!foldMode || !Number.isFinite(clash)) return 0
  return Math.min(1, Math.max(0, clash / 100))
}

/** The bed: the mean percentile of each clash trait over the rows playing (those that have one). */
export function radioClashBed(
  rows: readonly TraitPercentiles[]
): Partial<Record<ClashTrait, number>> {
  const out: Partial<Record<ClashTrait, number>> = {}
  for (const trait of CLASH_TRAITS) {
    const values = rows
      .map((r) => r[trait])
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    if (values.length > 0) out[trait] = values.reduce((a, b) => a + b, 0) / values.length
  }
  return out
}

/** A requested trait's term under the clash: a clash trait turns toward its other end
 * ((1 - a) * t + a * (1 - t)); every other trait is untouched. At amount 0 this is `t`. */
export function radioClashTraitScore(kind: string, t: number, amount: number): number {
  if (!(amount > 0) || !CLASH_TRAITS.includes(kind as ClashTrait)) return t
  return (1 - amount) * t + amount * (1 - t)
}

/** The mismatch term: how far a candidate sits from the bed on each clash trait both know,
 * times the amount. 0 at amount 0, with no bed, or with no percentiles. */
export function radioClashBedScore(percentiles: TraitPercentiles, clash: RankClash): number {
  if (!(clash.amount > 0)) return 0
  let score = 0
  for (const trait of CLASH_TRAITS) {
    const p = percentiles[trait]
    const b = clash.bed[trait]
    if (typeof p === 'number' && Number.isFinite(p) && typeof b === 'number') {
      score += Math.abs(p - b)
    }
  }
  return clash.amount * CLASH_BED_WEIGHT * score
}

/** The row that takes the clash low-pass: the brighter of the most mismatched pair, when they are
 * at least CLASH_PAIR_MIN_GAP apart and the clash is on. One row at most. */
export function radioClashLowpassRow(
  rows: readonly { id: string; bright: number | null | undefined }[],
  amount: number
): string | null {
  if (!(amount > 0)) return null
  const known = rows.filter(
    (r): r is { id: string; bright: number } =>
      typeof r.bright === 'number' && Number.isFinite(r.bright)
  )
  if (known.length < 2) return null
  let lo = known[0]
  let hi = known[0]
  for (const r of known) {
    if (r.bright < lo.bright) lo = r
    if (r.bright > hi.bright) hi = r
  }
  return hi.bright - lo.bright >= CLASH_PAIR_MIN_GAP ? hi.id : null
}

/** How far the master glue and saturation lean in: nothing up to `clash` 50, then up to
 * CLASH_LEAN_MAX at 100. Nothing while the mode is off. */
export function radioClashLean(foldMode: boolean, clash: number): number {
  if (!foldMode || !(clash > 50)) return 0
  return (CLASH_LEAN_MAX * (Math.min(100, clash) - 50)) / 50
}

/** A listener amount (0..1) with the lean on top, never past 1. */
export function radioClashLeaned(own: number, lean: number): number {
  return Math.min(1, own + Math.max(0, lean))
}
