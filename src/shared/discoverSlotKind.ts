import type { ArrangeRole } from './stemRole'

/** Discover's own candidate-matching taxonomy -- replaces the old, fallible
 * ArrangeRole-classifier-driven slot model (see
 * docs/superpowers/specs/2026-09-18-discover-trait-based-matching-design.md).
 * The 3 mask kinds are filtered directly by Endlesss's own reliable
 * instrument bitmask (drums/bass/notes bits -- see
 * instrumentMaskToSoundType, @shared/riffLibraryTypes); the 4 trait kinds
 * are filtered/ranked by cheap, already-cached StemFeatureCache numeric
 * fields, restricted to stems the mask can't reliably place (audioIn or
 * unmasked) -- the two groups' candidate pools never overlap. Literal
 * string values double as their own UI display text (matching
 * ARRANGE_ROLE_OPTIONS' own established convention, stemRole.ts) except
 * for the 3 camelCase ones, which DiscoverPanel.tsx's own label rendering
 * maps to a hyphenated display string (see DISCOVER_SLOT_KIND_LABEL
 * there) since 'bassHeavy' isn't itself a valid display string. */
export type DiscoverSlotKind =
  'drums' | 'bass' | 'lead' | 'bassHeavy' | 'rhythmic' | 'bright' | 'warm'

export const DISCOVER_MASK_SLOT_KINDS: DiscoverSlotKind[] = ['drums', 'bass', 'lead']
export const DISCOVER_TRAIT_SLOT_KINDS: DiscoverSlotKind[] = [
  'bassHeavy',
  'rhythmic',
  'bright',
  'warm'
]
export const DISCOVER_SLOT_KIND_OPTIONS: DiscoverSlotKind[] = [
  ...DISCOVER_MASK_SLOT_KINDS,
  ...DISCOVER_TRAIT_SLOT_KINDS
]

/** Only ever consulted when a slot's stem is actually placed (added to
 * shelf/timeline) -- autoArrangeEngine's diversity weighting and DAW
 * export both need a real ArrangeRole/BusId, which Discover's own matching
 * no longer resolves upfront. Identity for the 3 mask kinds (the mask bit
 * already IS the right answer); a fixed, deliberately approximate table for
 * the 4 trait kinds -- same "cheap, good-enough, not perfect" tradeoff as
 * the instrument-mask short-circuit in stemAutoClassify.ts. */
const DISCOVER_SLOT_KIND_TO_ARRANGE_ROLE: Record<DiscoverSlotKind, ArrangeRole> = {
  drums: 'drums',
  bass: 'bass',
  lead: 'lead',
  bassHeavy: 'bass',
  rhythmic: 'drums',
  bright: 'lead',
  warm: 'aux'
}

export function discoverSlotKindToArrangeRole(kind: DiscoverSlotKind): ArrangeRole {
  return DISCOVER_SLOT_KIND_TO_ARRANGE_ROLE[kind]
}

export type DiscoverTraitKind = 'bassHeavy' | 'rhythmic' | 'bright' | 'warm'

/** Display text per kind -- the literal value except for the camelCase
 * trait kind. Moved here from DiscoverPanel.tsx so slotKindsLabel (and the
 * kind picker) share one table. */
export const DISCOVER_SLOT_KIND_LABEL: Record<DiscoverSlotKind, string> = {
  drums: 'drums',
  bass: 'bass',
  lead: 'lead',
  bassHeavy: 'bass-heavy',
  rhythmic: 'rhythmic',
  bright: 'bright',
  warm: 'warm'
}

export function isMaskSlotKind(kind: DiscoverSlotKind): boolean {
  return DISCOVER_MASK_SLOT_KINDS.includes(kind)
}

export function isTraitSlotKind(kind: DiscoverSlotKind): kind is DiscoverTraitKind {
  return DISCOVER_TRAIT_SLOT_KINDS.includes(kind)
}

// bright and warm are opposite ends of ONE field (spectralCentroidHz) --
// both in one set would cancel out, so a set holds at most one of them.
const OPPOSITE_KIND: Partial<Record<DiscoverSlotKind, DiscoverSlotKind>> = {
  bright: 'warm',
  warm: 'bright'
}

/** Combination slots (docs/superpowers/specs/2026-09-21-discover-combo-
 * slot-kinds-design.md): dedupes, drops the later of bright/warm if both
 * appear, and returns canonical order (DISCOVER_SLOT_KIND_OPTIONS -- mask
 * kinds first). Every stored/transmitted kind set goes through this so
 * {warm, drums} and {drums, warm} are the same slot. */
export function normalizeSlotKinds(kinds: readonly DiscoverSlotKind[]): DiscoverSlotKind[] {
  const kept = new Set<DiscoverSlotKind>()
  for (const kind of kinds) {
    const opposite = OPPOSITE_KIND[kind]
    if (opposite && kept.has(opposite)) continue
    kept.add(kind)
  }
  return DISCOVER_SLOT_KIND_OPTIONS.filter((k) => kept.has(k))
}

/** One chip click in the kind picker. Turning a kind on also turns its
 * bright/warm opposite off; turning off the LAST kind is a no-op (a slot
 * always targets at least one kind). */
export function toggleSlotKind(
  kinds: readonly DiscoverSlotKind[],
  kind: DiscoverSlotKind
): DiscoverSlotKind[] {
  if (kinds.includes(kind)) {
    if (kinds.length === 1) return normalizeSlotKinds(kinds)
    return normalizeSlotKinds(kinds.filter((k) => k !== kind))
  }
  const opposite = OPPOSITE_KIND[kind]
  return normalizeSlotKinds([...kinds.filter((k) => k !== opposite), kind])
}

export function slotKindsLabel(kinds: readonly DiscoverSlotKind[]): string {
  return normalizeSlotKinds(kinds)
    .map((k) => DISCOVER_SLOT_KIND_LABEL[k])
    .join(' · ')
}

/** Stable string identity for a kind set -- cache/result keys and effect
 * deps (an array prop is a new object every render). */
export function slotKindsKey(kinds: readonly DiscoverSlotKind[]): string {
  return normalizeSlotKinds(kinds).join('+')
}
