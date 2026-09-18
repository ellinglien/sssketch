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
