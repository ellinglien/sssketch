import { describe, expect, it } from 'vitest'
import {
  DISCOVER_SLOT_KIND_OPTIONS,
  toggleSlotKind,
  type DiscoverSlotKind
} from './discoverSlotKind'
import {
  SLOT_KIND_MASK_COUNT,
  buildSlotKindToggleTable,
  maskToSlotKinds,
  slotKindsToMask
} from './discoverSlotKindMask'

function maskOf(kinds: readonly DiscoverSlotKind[]): number {
  return slotKindsToMask(kinds)
}

describe('slot kind masks', () => {
  it('has one bit per kind', () => {
    expect(SLOT_KIND_MASK_COUNT).toBe(1 << DISCOVER_SLOT_KIND_OPTIONS.length)
  })

  it('round-trips a kind set through a mask, in canonical order', () => {
    expect(maskToSlotKinds(maskOf(['bright', 'drums']))).toEqual(['drums', 'bright'])
  })

  it('reads an empty mask as no kinds', () => {
    expect(maskToSlotKinds(0)).toEqual([])
    expect(maskOf([])).toBe(0)
  })

  it('normalizes a mask that somehow carries both bright and warm', () => {
    const both =
      (1 << DISCOVER_SLOT_KIND_OPTIONS.indexOf('bright')) |
      (1 << DISCOVER_SLOT_KIND_OPTIONS.indexOf('warm'))
    expect(maskToSlotKinds(both)).toEqual(['bright'])
  })

  it('ignores bits that are not a kind', () => {
    expect(maskToSlotKinds(SLOT_KIND_MASK_COUNT | 1)).toEqual(maskToSlotKinds(1))
  })
})

describe('buildSlotKindToggleTable', () => {
  const table = buildSlotKindToggleTable()

  it('covers every reachable selection and every chip', () => {
    expect(table).toHaveLength(SLOT_KIND_MASK_COUNT)
    for (const row of table) expect(row).toHaveLength(DISCOVER_SLOT_KIND_OPTIONS.length)
  })

  it('is toggleSlotKind itself, not a second copy of its rules', () => {
    for (let mask = 0; mask < SLOT_KIND_MASK_COUNT; mask += 1) {
      const kinds = maskToSlotKinds(mask)
      DISCOVER_SLOT_KIND_OPTIONS.forEach((kind, index) => {
        expect(table[mask][index]).toBe(
          slotKindsToMask(toggleSlotKind(kinds, kind, { allowEmpty: true }))
        )
      })
    }
  })

  it('turns a kind on, and off again', () => {
    const drums = DISCOVER_SLOT_KIND_OPTIONS.indexOf('drums')
    const on = table[0][drums]
    expect(maskToSlotKinds(on)).toEqual(['drums'])
    expect(table[on][drums]).toBe(0)
  })

  it('combines a mask kind with a trait kind rather than replacing it', () => {
    const drums = DISCOVER_SLOT_KIND_OPTIONS.indexOf('drums')
    const rhythmic = DISCOVER_SLOT_KIND_OPTIONS.indexOf('rhythmic')
    expect(maskToSlotKinds(table[table[0][drums]][rhythmic])).toEqual(['drums', 'rhythmic'])
  })

  it('lets the newest of bright/warm win, because they are one field', () => {
    const bright = DISCOVER_SLOT_KIND_OPTIONS.indexOf('bright')
    const warm = DISCOVER_SLOT_KIND_OPTIONS.indexOf('warm')
    const brightOn = table[0][bright]
    expect(maskToSlotKinds(table[brightOn][warm])).toEqual(['warm'])
  })

  it('lets the last kind be turned off, since the phone starts from nothing', () => {
    const bass = DISCOVER_SLOT_KIND_OPTIONS.indexOf('bass')
    expect(table[table[0][bass]][bass]).toBe(0)
  })
})
