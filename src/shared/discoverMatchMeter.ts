// src/shared/discoverMatchMeter.ts
//
// The per-slot match meter -- docs/superpowers/specs/2026-09-22-discover-
// promise-vs-delivery-design.md, Phase 2. Pure formatting only: which
// entries a slot row shows for its picked stem, their text, and their hover
// text. DiscoverPanel's DiscoverSlotRow renders the result.
import { ARRANGE_ROLE_OPTIONS, type ArrangeRole } from './stemRole'
import {
  DISCOVER_MASK_SLOT_KINDS,
  DISCOVER_SLOT_KIND_LABEL,
  discoverSlotKindToArrangeRole,
  isMaskSlotKind,
  isTraitSlotKind,
  normalizeSlotKinds,
  type DiscoverKindSource,
  type DiscoverKindSources,
  type DiscoverMaskKind,
  type DiscoverSlotKind,
  type DiscoverTraitKind
} from './discoverSlotKind'
import { DEFAULT_TRAIT_BAR } from './traitBar'
import type { TraitPercentiles } from './traitQuantiles'

export const MATCH_METER_STEPS = 5

export interface MatchMeterMaskEntry {
  type: 'mask'
  /** null for a reclassified role none of the slot's kinds covers. */
  kind: DiscoverMaskKind | null
  label: string
  source: DiscoverKindSource
  text: string
  tooltip: string
}

export interface MatchMeterTraitEntry {
  type: 'trait'
  kind: DiscoverTraitKind
  label: string
  /** 0..MATCH_METER_STEPS */
  filled: number
  bars: string
  text: string
  tooltip: string
}

export type MatchMeterEntry = MatchMeterMaskEntry | MatchMeterTraitEntry

const SOURCE_DESCRIPTION: Record<DiscoverKindSource, string> = {
  confirmed: 'confirmed by you',
  tag: 'endlesss instrument tag',
  guess: "the overnight classifier's guess"
}

const TRAIT_COMPARATIVE: Record<DiscoverTraitKind, string> = {
  bassHeavy: 'more bass-heavy',
  rhythmic: 'busier',
  bright: 'brighter',
  warm: 'warmer'
}

/** Filled steps for a library percentile: ceil(p * 5), so any stem above
 * the 80th percentile fills all five. Unknown/invalid -> 0. */
export function traitBarsFilled(percentile: number | null | undefined): number {
  if (typeof percentile !== 'number' || !Number.isFinite(percentile)) return 0
  const clamped = Math.min(1, Math.max(0, percentile))
  return Math.ceil(clamped * MATCH_METER_STEPS)
}

function barsString(filled: number): string {
  return '▮'.repeat(filled) + '▯'.repeat(MATCH_METER_STEPS - filled)
}

function maskEntry(
  kind: DiscoverMaskKind | null,
  label: string,
  source: DiscoverKindSource
): MatchMeterMaskEntry {
  return {
    type: 'mask',
    kind,
    label,
    source,
    text: `${label}: ${source}`,
    tooltip: `${label}: ${SOURCE_DESCRIPTION[source]} · click to reclassify`
  }
}

function traitEntry(
  kind: DiscoverTraitKind,
  percentile: number | null | undefined,
  barUsed: number | null
): MatchMeterTraitEntry {
  const label = DISCOVER_SLOT_KIND_LABEL[kind]
  const filled = traitBarsFilled(percentile)
  const bars = barsString(filled)
  if (typeof percentile !== 'number' || !Number.isFinite(percentile)) {
    return {
      type: 'trait',
      kind,
      label,
      filled,
      bars,
      text: `${label} ${bars}`,
      tooltip: `${label}: not analysed yet`
    }
  }
  const pct = Math.round(Math.min(1, Math.max(0, percentile)) * 100)
  let tooltip = `${label}: ${TRAIT_COMPARATIVE[kind]} than ${pct}% of your library`
  if (barUsed !== null && barUsed < DEFAULT_TRAIT_BAR) {
    tooltip += ` · bar relaxed to top ${Math.round((1 - barUsed) * 100)}% because few stems matched`
  }
  return { type: 'trait', kind, label, filled, bars, text: `${label} ${bars}`, tooltip }
}

/** One entry per requested kind of the slot, mask kinds first:
 * - a mask kind shows why it admitted the stem (`drummy: tag`), omitted
 *   when that kind didn't (another mask kind of the set did, or the stem
 *   was reclassified away from it);
 * - a trait kind shows 5-step bars from the stem's library percentile, with
 *   the exact number (and a relaxed-bar note when barUsed < the default
 *   bar) in the tooltip;
 * - `reclassified` (a Discover reclassify to a role none of the slot's
 *   mask kinds covers) adds one confirmed entry for that role, so the
 *   reclassify trigger is still there to change it again. */
export function buildMatchMeter({
  kinds,
  kindSources,
  traitPercentiles,
  barUsed,
  reclassified
}: {
  kinds: readonly DiscoverSlotKind[]
  kindSources: DiscoverKindSources
  traitPercentiles: TraitPercentiles
  barUsed: number | null
  reclassified?: { role: ArrangeRole; label: string }
}): MatchMeterEntry[] {
  const normalized = normalizeSlotKinds(kinds)
  const entries: MatchMeterEntry[] = []
  const maskKinds = normalized.filter(isMaskSlotKind) as DiscoverMaskKind[]
  for (const kind of maskKinds) {
    const source = kindSources[kind]
    if (source) entries.push(maskEntry(kind, DISCOVER_SLOT_KIND_LABEL[kind], source))
  }
  if (
    reclassified &&
    !maskKinds.some((k) => discoverSlotKindToArrangeRole(k) === reclassified.role)
  ) {
    entries.push(maskEntry(null, reclassified.label, 'confirmed'))
  }
  for (const kind of normalized) {
    if (isTraitSlotKind(kind)) entries.push(traitEntry(kind, traitPercentiles[kind], barUsed))
  }
  return entries
}

/** A Discover reclassify of the slot's stem to `role`: the slot's mask kind
 * for that role (if any) becomes 'confirmed'; every other mask kind loses
 * its source (a confirmation for another role excludes the stem from
 * them -- same rule the candidate pools apply), so the stem's previous
 * sources don't matter. */
export function reclassifyKindSources(
  kinds: readonly DiscoverSlotKind[],
  role: ArrangeRole
): DiscoverKindSources {
  const out: DiscoverKindSources = {}
  for (const kind of normalizeSlotKinds(kinds)) {
    if (isMaskSlotKind(kind) && discoverSlotKindToArrangeRole(kind) === role) {
      out[kind as DiscoverMaskKind] = 'confirmed'
    }
  }
  return out
}

function maskKindForRole(role: ArrangeRole): DiscoverSlotKind | undefined {
  return DISCOVER_MASK_SLOT_KINDS.find((k) => discoverSlotKindToArrangeRole(k) === role)
}

/** The reclassify picker's roles: Discover's own three mask kinds first
 * (drummy, bassish, leadesque), then every other Tidy Up role in
 * ARRANGE_ROLE_OPTIONS order. */
export const DISCOVER_RECLASSIFY_ROLES: ArrangeRole[] = [
  ...DISCOVER_MASK_SLOT_KINDS.map(discoverSlotKindToArrangeRole),
  ...ARRANGE_ROLE_OPTIONS.filter((r) => maskKindForRole(r) === undefined)
]

/** Display text for a role in Discover: a mask kind's playful label
 * (drums -> drummy) where one exists, else the caller's own label table
 * (the renderer's ROLE_LABELS -- textureFx -> texture/fx), else the raw
 * value. */
export function discoverRoleLabel(role: ArrangeRole, otherLabels: Record<string, string>): string {
  const kind = maskKindForRole(role)
  if (kind) return DISCOVER_SLOT_KIND_LABEL[kind]
  return otherLabels[role] ?? role
}
