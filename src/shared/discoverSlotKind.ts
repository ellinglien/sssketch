import type { ArrangeRole } from './stemRole'
import type { StemCategory } from './stemCategory'

/** Discover's own candidate-matching taxonomy -- replaces the old, fallible
 * ArrangeRole-classifier-driven slot model (see
 * docs/superpowers/specs/2026-09-18-discover-trait-based-matching-design.md),
 * then extended to combination slots (docs/superpowers/specs/2026-09-21-
 * discover-combo-slot-kinds-design.md): a slot carries a SET of these, not
 * one. The 4 mask kinds (the four categories: drums/bass/back/front) are an OR filter on a stem's
 * role: human confirmation first, else Endlesss's own reliable instrument
 * bitmask (instrumentMaskToSoundType, @shared/riffLibraryTypes), else --
 * only for stems that mask can't place (no mask, or audio-in) -- the
 * overnight classifier's guess (stemMatchesSlotKinds, discoverTraits.ts;
 * 2026-09-22). The endlesss/non-endlesss source filter (the source dial)
 * applies to every kind, by each stem's own mask (soundSourceMatchesFilter,
 * riffLibraryTypes.ts). The 4 trait kinds are
 * rankings, not a filter -- they score any stem with a cached
 * StemFeatureCache row (tagged or not) by cheap numeric fields; a set
 * combining a mask kind with a trait kind (e.g. {drums, bright}) filters by
 * the mask and ranks the mask's own pool by the trait, rather than drawing
 * from two disjoint pools. Literal string values double as their own UI
 * display text (matching ARRANGE_ROLE_OPTIONS' own established convention,
 * stemRole.ts) except for the camelCase ones, which this file's own
 * DISCOVER_SLOT_KIND_LABEL (below) maps to a display string.
 * 'lead' was the old name of 'front' (renamed 2026-11-14); parseSlotKind
 * reads it from saved or sent state. */
export type DiscoverSlotKind =
  'drums' | 'bass' | 'back' | 'front' | 'bassHeavy' | 'rhythmic' | 'bright' | 'warm'

export const DISCOVER_MASK_SLOT_KINDS: DiscoverSlotKind[] = ['drums', 'bass', 'back', 'front']
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
 * no longer resolves upfront. A category's representative stored role for
 * the 4 mask kinds (back is 'backing', front is 'lead'); a fixed, deliberately approximate table for
 * the 4 trait kinds -- same "cheap, good-enough, not perfect" tradeoff as
 * the instrument-mask short-circuit in stemAutoClassify.ts. */
const DISCOVER_SLOT_KIND_TO_ARRANGE_ROLE: Record<DiscoverSlotKind, ArrangeRole> = {
  drums: 'drums',
  bass: 'bass',
  back: 'backing',
  front: 'lead',
  bassHeavy: 'bass',
  rhythmic: 'drums',
  bright: 'lead',
  warm: 'backing'
}

export function discoverSlotKindToArrangeRole(kind: DiscoverSlotKind): ArrangeRole {
  return DISCOVER_SLOT_KIND_TO_ARRANGE_ROLE[kind]
}

/**
 * The other direction: the kinds an ArrangeRole stands for.
 *
 * Needed because the guided map can be entered from the AUTO-ARRANGER,
 * where the material is stems already on the timeline with roles the user
 * confirmed by hand. Everything downstream of a locked climax keys off
 * `kinds` (isSuggestedDrop, coachMapTemplate), so a role has to answer for
 * itself. Each role gives its category kind; fill and textureFx add a trait.
 *
 * No kind set here is the hook (['front', 'bright']): the app cannot tell a
 * plain lead apart from the hook, and under-flagging costs the user one
 * click while over-flagging is the app asserting something it has not
 * earned. back is never in a drop set, so aux and backing are never
 * suggested drops.
 */
export const ARRANGE_ROLE_SLOT_KINDS: Record<ArrangeRole, readonly DiscoverSlotKind[]> = {
  drums: ['drums'],
  fill: ['drums', 'rhythmic'],
  bass: ['bass'],
  lead: ['front'],
  vocal: ['front'],
  backing: ['back'],
  aux: ['back'],
  textureFx: ['back', 'warm']
}

export function arrangeRoleToSlotKinds(role: ArrangeRole): readonly DiscoverSlotKind[] {
  return ARRANGE_ROLE_SLOT_KINDS[role]
}

export type DiscoverTraitKind = 'bassHeavy' | 'rhythmic' | 'bright' | 'warm'

/** The mask kinds are the four categories (stemCategory.ts). */
export type DiscoverMaskKind = StemCategory

/** back and front rank by the front/back dial (stemCategoryDial.ts). */
export type DiscoverDialKind = 'back' | 'front'
export type DiscoverRankKind = DiscoverTraitKind | DiscoverDialKind

/** Why a MASK kind admitted a stem (docs/superpowers/specs/2026-09-22-
 * discover-promise-vs-delivery-design.md, Phase 2): a human Tidy Up /
 * Discover confirmation (StemCategories), Endlesss's own instrument tag
 * (the mask), or the overnight classifier's guess (StemAutoCategory). */
export type DiscoverKindSource = 'confirmed' | 'tag' | 'guess'

export type DiscoverKindSources = Partial<Record<DiscoverMaskKind, DiscoverKindSource>>

/** Display text per kind, shared by slotKindsLabel, the add row and the
 * kind picker. The four categories are plain words since 2026-11-14; the
 * trait kinds keep their playful names (2026-09-22). */
export const DISCOVER_SLOT_KIND_LABEL: Record<DiscoverSlotKind, string> = {
  drums: 'drums',
  bass: 'bass',
  back: 'back',
  front: 'front',
  bassHeavy: 'chonky',
  rhythmic: 'rhythmic',
  bright: 'sparkly',
  warm: 'buttery'
}

/** Also takes a DiscoverRankKind (a subset of the slot kinds). */
export function isDialKind(kind: DiscoverSlotKind): kind is DiscoverDialKind {
  return kind === 'back' || kind === 'front'
}

/** What a kind set ranks by: its trait kinds and its dial kinds, in canonical order. */
export function rankKindsOf(kinds: readonly DiscoverSlotKind[]): DiscoverRankKind[] {
  return normalizeSlotKinds(kinds).filter(
    (k): k is DiscoverRankKind => isTraitSlotKind(k) || isDialKind(k)
  )
}

/** A kind from saved or sent state. 'lead' is the name `front` had before 2026-11-14. */
export function parseSlotKind(raw: unknown): DiscoverSlotKind | null {
  if (raw === 'lead') return 'front'
  return typeof raw === 'string' && (DISCOVER_SLOT_KIND_OPTIONS as string[]).includes(raw)
    ? (raw as DiscoverSlotKind)
    : null
}

export function isMaskSlotKind(kind: DiscoverSlotKind): boolean {
  return DISCOVER_MASK_SLOT_KINDS.includes(kind)
}

export function isTraitSlotKind(kind: DiscoverSlotKind): kind is DiscoverTraitKind {
  return DISCOVER_TRAIT_SLOT_KINDS.includes(kind)
}

// bright and warm are opposite ends of ONE field (spectralCentroidHz) --
// both in one set would cancel out, so a set holds at most one of them.
// back/front too: their dials are complements, so a set with both would pass only undecided stems.
const OPPOSITE_KIND: Partial<Record<DiscoverSlotKind, DiscoverSlotKind>> = {
  bright: 'warm',
  warm: 'bright',
  back: 'front',
  front: 'back'
}

/** Combination slots (docs/superpowers/specs/2026-09-21-discover-combo-
 * slot-kinds-design.md): dedupes, drops the later of bright/warm (or of
 * back/front) if both appear, and returns canonical order (DISCOVER_SLOT_KIND_OPTIONS -- mask
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
 * bright/warm or back/front opposite off; turning off the LAST kind is a no-op (a slot
 * always targets at least one kind) unless `allowEmpty` -- the add row's
 * pending selection, which starts empty and may go back to empty. */
export function toggleSlotKind(
  kinds: readonly DiscoverSlotKind[],
  kind: DiscoverSlotKind,
  { allowEmpty = false }: { allowEmpty?: boolean } = {}
): DiscoverSlotKind[] {
  if (kinds.includes(kind)) {
    if (kinds.length === 1 && !allowEmpty) return normalizeSlotKinds(kinds)
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
