// src/shared/traitBar.ts
//
// The trait "bar" -- docs/superpowers/specs/2026-09-22-discover-promise-vs-
// delivery-design.md, Phase 1. Applied in the renderer between
// getDiscoverCandidates and rankCandidates, so a slot labelled "sparkly"
// only draws from stems that are sparkly in LIBRARY terms (top 40% by
// default), not merely the sparkliest of whatever slice was drawn.
import type { DiscoverTraitKind } from './discoverSlotKind'
import type { TraitPercentiles } from './traitQuantiles'

/** The spec's bar (user choice: top 40%) -- a requested trait needs a
 * library percentile >= this unless too few candidates pass. */
export const DEFAULT_TRAIT_BAR = 0.6

export interface TraitBarOptions {
  /** Starting bar: a requested trait needs percentile >= this. */
  bar?: number
  /** Relax the bar until at least this many candidates pass. */
  minPool?: number
  /** How much each relaxation lowers the bar. */
  step?: number
}

export interface TraitBarResult<T> {
  pool: T[]
  /** The bar actually applied (Phase 2's meter shows it); null when no
   * trait was requested. */
  barUsed: number | null
}

function isAnalysed(p: TraitPercentiles, traits: readonly DiscoverTraitKind[]): boolean {
  return traits.every((k) => {
    const v = p[k]
    return typeof v === 'number' && Number.isFinite(v)
  })
}

function minPercentile(p: TraitPercentiles, traits: readonly DiscoverTraitKind[]): number {
  let min = Infinity
  for (const k of traits) min = Math.min(min, p[k] as number)
  return min
}

/** Keeps analysed candidates (a non-null percentile for EVERY requested
 * trait) that clear the bar on every requested trait (AND). Too few pass
 * (< minPool) -> lower the bar by `step` until enough do, down to 0. Still
 * too few analysed at 0 -> the unanalysed candidates are appended after
 * them (relax, don't fail). Input order is preserved within each group. */
export function applyTraitBar<T extends { traitPercentiles: TraitPercentiles }>(
  candidates: T[],
  targetTraits: readonly DiscoverTraitKind[],
  { bar = DEFAULT_TRAIT_BAR, minPool = 12, step = 0.1 }: TraitBarOptions = {}
): TraitBarResult<T> {
  if (targetTraits.length === 0) return { pool: candidates, barUsed: null }

  const analysed: { candidate: T; min: number }[] = []
  const unanalysed: T[] = []
  for (const c of candidates) {
    if (isAnalysed(c.traitPercentiles, targetTraits)) {
      analysed.push({ candidate: c, min: minPercentile(c.traitPercentiles, targetTraits) })
    } else {
      unanalysed.push(c)
    }
  }

  // A non-positive step would never reach 0 -- jump straight there instead.
  const safeStep = step > 0 ? step : Math.max(bar, 1)
  // Integer step counter + rounding, so repeated subtraction never drifts
  // (0.6 - 0.1 * 6 would be a hair off 0).
  for (let k = 0; ; k++) {
    const current = Math.max(0, Math.round((bar - k * safeStep) * 1e9) / 1e9)
    const passing = analysed.filter((a) => a.min >= current).map((a) => a.candidate)
    if (passing.length >= minPool) return { pool: passing, barUsed: current }
    if (current === 0) {
      return { pool: [...passing, ...unanalysed], barUsed: 0 }
    }
  }
}
