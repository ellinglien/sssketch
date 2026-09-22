import type { DiscoverSoundSourceFilter } from './riffLibraryTypes'

/** Discover's four roll filters (prefer favourites, endlesss / other sound
 * source, only my stems). Briefly per-slot on 2026-09-22, then moved back
 * to GLOBAL sticky [x] toggles under the add row the same day: every roll
 * and reroll of every slot reads the panel's current set via
 * slotRollOptions. */
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

/** Dedupes and returns canonical order. */
function normalizeSlotModifiers(
  modifiers: readonly DiscoverSlotModifier[]
): DiscoverSlotModifier[] {
  const set = new Set(modifiers)
  return DISCOVER_SLOT_MODIFIER_OPTIONS.filter((m) => set.has(m))
}

/** One toggle click, keeping canonical order. Zero modifiers is valid. */
export function toggleSlotModifier(
  modifiers: readonly DiscoverSlotModifier[],
  modifier: DiscoverSlotModifier
): DiscoverSlotModifier[] {
  return modifiers.includes(modifier)
    ? normalizeSlotModifiers(modifiers.filter((m) => m !== modifier))
    : normalizeSlotModifiers([...modifiers, modifier])
}

export interface DiscoverSlotRollOptions {
  soundSource: DiscoverSoundSourceFilter
  onlyOwnStems: boolean
  preferFavourites: boolean
}

/** What the modifier set means for a roll. Neither sound source picked
 * means no source filtering (both on); picking one restricts to it;
 * picking both is the same as neither. 'mine' only takes effect with a
 * username to match against (same as the old global toggle, which was
 * disabled without one). */
export function slotRollOptions(
  modifiers: readonly DiscoverSlotModifier[],
  { hasUsername }: { hasUsername: boolean }
): DiscoverSlotRollOptions {
  const set = new Set(modifiers)
  const endlesss = set.has('endlesss')
  const other = set.has('other')
  const anySource = !endlesss && !other
  return {
    soundSource: { endlesss: anySource || endlesss, audioIn: anySource || other },
    onlyOwnStems: set.has('mine') && hasUsername,
    preferFavourites: set.has('preferFaves')
  }
}
