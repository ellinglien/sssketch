import type { DiscoverSoundSourceFilter } from './riffLibraryTypes'

/** Discover's two remaining roll switches (prefer favourites, only my
 * stems). The endlesss/other source switches became the source dial on
 * 2026-09-29 -- see drawSoundSource. */
export type DiscoverSlotModifier = 'preferFaves' | 'mine'

export const DISCOVER_SLOT_MODIFIER_OPTIONS: DiscoverSlotModifier[] = ['preferFaves', 'mine']

export const DISCOVER_SLOT_MODIFIER_LABEL: Record<DiscoverSlotModifier, string> = {
  preferFaves: 'prefer faves',
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
  onlyOwnStems: boolean
  preferFavourites: boolean
}

/** What the switch set means for a roll. 'mine' only takes effect with a
 * username to match against. The sound source is not a switch any more --
 * each roll draws it from the dial (drawSoundSource). */
export function slotRollOptions(
  modifiers: readonly DiscoverSlotModifier[],
  { hasUsername }: { hasUsername: boolean }
): DiscoverSlotRollOptions {
  const set = new Set(modifiers)
  return {
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
// Also shared, so soundSourceForLean's in-between value is referentially
// stable (it lands in React props).
const BOTH_SOURCES: Readonly<DiscoverSoundSourceFilter> = Object.freeze({
  endlesss: true,
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
  return BOTH_SOURCES
}
