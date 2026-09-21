import { describe, expect, it } from 'vitest'
import {
  DISCOVER_SLOT_KIND_OPTIONS,
  DISCOVER_MASK_SLOT_KINDS,
  DISCOVER_TRAIT_SLOT_KINDS,
  discoverSlotKindToArrangeRole,
  DISCOVER_SLOT_KIND_LABEL,
  isMaskSlotKind,
  isTraitSlotKind,
  normalizeSlotKinds,
  toggleSlotKind,
  slotKindsLabel,
  slotKindsKey
} from './discoverSlotKind'

describe('DISCOVER_SLOT_KIND_OPTIONS', () => {
  it('lists exactly the 7 kinds, mask kinds first', () => {
    expect(DISCOVER_SLOT_KIND_OPTIONS).toEqual([
      'drums',
      'bass',
      'lead',
      'bassHeavy',
      'rhythmic',
      'bright',
      'warm'
    ])
  })

  it('DISCOVER_MASK_SLOT_KINDS and DISCOVER_TRAIT_SLOT_KINDS partition it with no overlap', () => {
    const all = new Set(DISCOVER_SLOT_KIND_OPTIONS)
    const mask = new Set(DISCOVER_MASK_SLOT_KINDS)
    const trait = new Set(DISCOVER_TRAIT_SLOT_KINDS)
    expect(mask.size + trait.size).toBe(all.size)
    for (const kind of mask) expect(trait.has(kind)).toBe(false)
    expect(new Set([...mask, ...trait])).toEqual(all)
  })
})

describe('discoverSlotKindToArrangeRole', () => {
  it('is identity for the 3 mask kinds', () => {
    expect(discoverSlotKindToArrangeRole('drums')).toBe('drums')
    expect(discoverSlotKindToArrangeRole('bass')).toBe('bass')
    expect(discoverSlotKindToArrangeRole('lead')).toBe('lead')
  })

  it('maps the 4 trait kinds to a fixed approximation', () => {
    expect(discoverSlotKindToArrangeRole('bassHeavy')).toBe('bass')
    expect(discoverSlotKindToArrangeRole('rhythmic')).toBe('drums')
    expect(discoverSlotKindToArrangeRole('bright')).toBe('lead')
    expect(discoverSlotKindToArrangeRole('warm')).toBe('aux')
  })

  it('covers every DiscoverSlotKind with no missing entry', () => {
    for (const kind of DISCOVER_SLOT_KIND_OPTIONS) {
      expect(() => discoverSlotKindToArrangeRole(kind)).not.toThrow()
    }
  })
})

describe('isMaskSlotKind / isTraitSlotKind', () => {
  it('splits the 7 kinds into 3 mask + 4 trait', () => {
    expect(['drums', 'bass', 'lead'].every((k) => isMaskSlotKind(k as never))).toBe(true)
    expect(
      ['bassHeavy', 'rhythmic', 'bright', 'warm'].every((k) => isTraitSlotKind(k as never))
    ).toBe(true)
    expect(isMaskSlotKind('warm')).toBe(false)
    expect(isTraitSlotKind('drums')).toBe(false)
  })
})

describe('normalizeSlotKinds', () => {
  it('dedupes and puts mask kinds first, in DISCOVER_SLOT_KIND_OPTIONS order', () => {
    expect(normalizeSlotKinds(['warm', 'drums', 'rhythmic', 'drums'])).toEqual([
      'drums',
      'rhythmic',
      'warm'
    ])
  })

  it('keeps whichever of bright/warm comes first in the input, never both', () => {
    expect(normalizeSlotKinds(['warm', 'bright'])).toEqual(['warm'])
    expect(normalizeSlotKinds(['bright', 'warm'])).toEqual(['bright'])
  })

  it('returns [] for []', () => {
    expect(normalizeSlotKinds([])).toEqual([])
  })
})

describe('toggleSlotKind', () => {
  it('adds a kind that is off', () => {
    expect(toggleSlotKind(['drums'], 'warm')).toEqual(['drums', 'warm'])
  })

  it('removes a kind that is on', () => {
    expect(toggleSlotKind(['drums', 'warm'], 'drums')).toEqual(['warm'])
  })

  it('never removes the last remaining kind', () => {
    expect(toggleSlotKind(['warm'], 'warm')).toEqual(['warm'])
  })

  it("allowEmpty: the last kind CAN be turned off (the add row's pending selection)", () => {
    expect(toggleSlotKind(['warm'], 'warm', { allowEmpty: true })).toEqual([])
    expect(toggleSlotKind([], 'drums', { allowEmpty: true })).toEqual(['drums'])
  })

  it('turning bright on turns warm off, and vice versa', () => {
    expect(toggleSlotKind(['drums', 'warm'], 'bright')).toEqual(['drums', 'bright'])
    expect(toggleSlotKind(['bright'], 'warm')).toEqual(['warm'])
  })
})

describe('slotKindsLabel / slotKindsKey', () => {
  it('joins display labels with a middle dot, canonical order', () => {
    expect(slotKindsLabel(['warm', 'bassHeavy', 'drums'])).toBe('drums · bass-heavy · warm')
  })

  it('key is order-independent', () => {
    expect(slotKindsKey(['warm', 'drums'])).toBe(slotKindsKey(['drums', 'warm']))
    expect(slotKindsKey(['warm', 'drums'])).toBe('drums+warm')
  })

  it('DISCOVER_SLOT_KIND_LABEL hyphenates the camelCase kind', () => {
    expect(DISCOVER_SLOT_KIND_LABEL.bassHeavy).toBe('bass-heavy')
  })
})
