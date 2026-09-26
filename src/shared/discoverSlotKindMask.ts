import {
  DISCOVER_SLOT_KIND_OPTIONS,
  normalizeSlotKinds,
  toggleSlotKind,
  type DiscoverSlotKind
} from './discoverSlotKind'

/** The phone's kind picker, as data.
 *
 * The phone page (src/main/remotePage.ts) is a hand-written string of plain
 * browser JS with no bundler and no imports -- it cannot call
 * `toggleSlotKind`. Rather than write a second copy of the combination rules
 * there (dedupe, bright/warm exclusivity, canonical order) and let the two
 * drift, the page embeds a TABLE that this module builds by calling the real
 * `toggleSlotKind` for every reachable selection and every chip. The phone
 * then "toggles" by a single array lookup, so its picker is the desktop's
 * picker by construction.
 *
 * A selection is a bitmask over DISCOVER_SLOT_KIND_OPTIONS -- 7 kinds, so
 * 128 selections and 896 transitions, about 3KB of JSON next to the 5KB of
 * embedded font already in that page.
 */
export const SLOT_KIND_MASK_COUNT = 1 << DISCOVER_SLOT_KIND_OPTIONS.length

export function slotKindsToMask(kinds: readonly DiscoverSlotKind[]): number {
  let mask = 0
  for (const kind of normalizeSlotKinds(kinds)) {
    mask |= 1 << DISCOVER_SLOT_KIND_OPTIONS.indexOf(kind)
  }
  return mask
}

/** Always a normalized, canonically ordered set -- bits outside the seven
 * kinds are ignored, and a mask carrying both bright and warm (which no
 * transition in the table can produce) resolves the same way
 * `normalizeSlotKinds` resolves it rather than being rejected. */
export function maskToSlotKinds(mask: number): DiscoverSlotKind[] {
  return normalizeSlotKinds(DISCOVER_SLOT_KIND_OPTIONS.filter((_, i) => (mask & (1 << i)) !== 0))
}

/** `table[mask][chipIndex]` is the selection after tapping that chip.
 * `allowEmpty` because the phone's picker starts from nothing and may be
 * emptied again -- it is a pending selection, not a live slot. */
export function buildSlotKindToggleTable(): number[][] {
  const table: number[][] = []
  for (let mask = 0; mask < SLOT_KIND_MASK_COUNT; mask += 1) {
    const kinds = maskToSlotKinds(mask)
    table.push(
      DISCOVER_SLOT_KIND_OPTIONS.map((kind) =>
        slotKindsToMask(toggleSlotKind(kinds, kind, { allowEmpty: true }))
      )
    )
  }
  return table
}
