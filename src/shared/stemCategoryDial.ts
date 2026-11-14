// src/shared/stemCategoryDial.ts
//
// The front/back dial as Discover ranks by it (spec 2026-11-14-four-categories-design, section 2):
// a label is 1 or 0, a guess is its FrontScore's place among every stored FrontScore, so the trait
// bar means "front-er than most of your library" rather than a raw probability.
import type { DiscoverKindSources } from './discoverSlotKind'
import { percentileOf, type QuantileTable, type TraitPercentiles } from './traitQuantiles'

export function dialFor({
  kindSources,
  frontScore,
  table
}: {
  kindSources: DiscoverKindSources | undefined
  frontScore: number | null | undefined
  table: QuantileTable | null
}): number | null {
  if (kindSources?.front === 'confirmed') return 1
  if (kindSources?.back === 'confirmed') return 0
  if (frontScore === null || frontScore === undefined || !Number.isFinite(frontScore)) return null
  return table ? percentileOf(table, frontScore) : frontScore
}

export function withDial<T extends { traitPercentiles: TraitPercentiles }>(
  c: T,
  dial: number | null
): T {
  return {
    ...c,
    traitPercentiles: { ...c.traitPercentiles, front: dial, back: dial === null ? null : 1 - dial }
  }
}
