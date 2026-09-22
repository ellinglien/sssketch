import type { DiscoverSoundSourceFilter } from './riffLibraryTypes'
import { slotKindsLabel, type DiscoverSlotKind } from './discoverSlotKind'

/** Per-slot roll modifiers (2026-09-22, mockup "option A"): what used to be
 * four GLOBAL Discover toolbar toggles (prefer favourites, endlesss / other
 * sound source, only my stems) now live on each slot, chosen in the add row
 * alongside the kinds and editable afterwards in the kind picker. Unlike
 * kinds, a slot may carry zero modifiers -- that's today's default roll
 * (both sound sources, anyone's stems, no favourite boost). */
export type DiscoverSlotModifier = 'preferFaves' | 'endlesss' | 'other' | 'mine'

export const DISCOVER_SLOT_MODIFIER_OPTIONS: DiscoverSlotModifier[] = [
  'preferFaves',
  'endlesss',
  'other',
  'mine'
]

export const DISCOVER_SLOT_MODIFIER_LABEL: Record<DiscoverSlotModifier, string> = {
  preferFaves: 'prefer faves',
  endlesss: 'endlesss sounds',
  other: 'other sounds',
  mine: 'my sounds'
}

/** Dedupes and returns canonical order. `undefined` (a slot object from
 * before modifiers existed) reads as none. */
export function normalizeSlotModifiers(
  modifiers: readonly DiscoverSlotModifier[] | undefined
): DiscoverSlotModifier[] {
  const set = new Set(modifiers ?? [])
  return DISCOVER_SLOT_MODIFIER_OPTIONS.filter((m) => set.has(m))
}

/** One chip click. No last-chip guard -- zero modifiers is valid. */
export function toggleSlotModifier(
  modifiers: readonly DiscoverSlotModifier[],
  modifier: DiscoverSlotModifier
): DiscoverSlotModifier[] {
  return modifiers.includes(modifier)
    ? normalizeSlotModifiers(modifiers.filter((m) => m !== modifier))
    : normalizeSlotModifiers([...modifiers, modifier])
}

/** Stable string identity for a modifier set (cache keys, effect deps). */
export function slotModifiersKey(modifiers: readonly DiscoverSlotModifier[] | undefined): string {
  return normalizeSlotModifiers(modifiers).join('+')
}

/** A slot's full display label: kinds, then modifiers, ' · '-joined. */
export function slotLabel(
  kinds: readonly DiscoverSlotKind[],
  modifiers: readonly DiscoverSlotModifier[] | undefined
): string {
  return [
    slotKindsLabel(kinds),
    ...normalizeSlotModifiers(modifiers).map((m) => DISCOVER_SLOT_MODIFIER_LABEL[m])
  ].join(' · ')
}

export interface DiscoverSlotRollOptions {
  soundSource: DiscoverSoundSourceFilter
  onlyOwnStems: boolean
  preferFavourites: boolean
}

/** What a slot's modifiers mean for a roll. Neither sound source picked
 * means no source filtering (both on); picking one restricts to it;
 * picking both is the same as neither. 'mine' only takes effect with a
 * username to match against (same as the old global toggle, which was
 * disabled without one). */
export function slotRollOptions(
  modifiers: readonly DiscoverSlotModifier[] | undefined,
  { hasUsername }: { hasUsername: boolean }
): DiscoverSlotRollOptions {
  const set = new Set(modifiers ?? [])
  const endlesss = set.has('endlesss')
  const other = set.has('other')
  const anySource = !endlesss && !other
  return {
    soundSource: { endlesss: anySource || endlesss, audioIn: anySource || other },
    onlyOwnStems: set.has('mine') && hasUsername,
    preferFavourites: set.has('preferFaves')
  }
}
