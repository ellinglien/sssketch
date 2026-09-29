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

/** The source dial's two ends. 0 is endlesss, 100 is other. */
export const SOURCE_LEAN_ENDLESSS = 0
export const SOURCE_LEAN_OTHER = 100
export const DEFAULT_SOURCE_LEAN = 50

// Frozen: these are shared by every roll, so a caller mutating a returned
// filter would corrupt all the later ones.
const ENDLESSS_ONLY: Readonly<DiscoverSoundSourceFilter> = Object.freeze({
  endlesss: true,
  audioIn: false
})
const OTHER_ONLY: Readonly<DiscoverSoundSourceFilter> = Object.freeze({
  endlesss: false,
  audioIn: true
})

function clampLean(lean: number): number {
  return Math.min(SOURCE_LEAN_OTHER, Math.max(SOURCE_LEAN_ENDLESSS, lean))
}

/** Which source ONE roll asks for, given the dial.
 *
 * Drawn per roll, before the candidate query, so the existing single-source
 * filter does all the real work and nothing in the main process changes.
 * `other` with probability lean/100: the middle is half and half whatever
 * the library holds (Elling, 2026-09-29, chose that over "library
 * proportion").
 *
 * The ends are HARD -- only that source, no fallback -- because an end
 * means "only". Anywhere in between, `fallback` is the other source, for
 * the caller to try when the drawn one has nothing for this slot: a kind
 * with no audio-in stems (common for bass) must never fail a roll because
 * the dial leaned the other way. */
export function drawSoundSource(
  lean: number,
  random: () => number = Math.random
): { first: DiscoverSoundSourceFilter; fallback: DiscoverSoundSourceFilter | null } {
  const l = clampLean(lean)
  if (l <= SOURCE_LEAN_ENDLESSS) return { first: ENDLESSS_ONLY, fallback: null }
  if (l >= SOURCE_LEAN_OTHER) return { first: OTHER_ONLY, fallback: null }
  return random() < l / 100
    ? { first: OTHER_ONLY, fallback: ENDLESSS_ONLY }
    : { first: ENDLESSS_ONLY, fallback: OTHER_ONLY }
}

/** The dial as a plain filter, for the one place that browses rather than
 * rolls -- the nearby-jam popover lists stems, it does not draw one. One
 * source at an end, both in between. */
export function soundSourceForLean(lean: number): DiscoverSoundSourceFilter {
  const l = clampLean(lean)
  if (l <= SOURCE_LEAN_ENDLESSS) return ENDLESSS_ONLY
  if (l >= SOURCE_LEAN_OTHER) return OTHER_ONLY
  return { endlesss: true, audioIn: true }
}
