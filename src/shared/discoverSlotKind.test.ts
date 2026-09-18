import { describe, expect, it } from 'vitest'
import {
  DISCOVER_SLOT_KIND_OPTIONS,
  DISCOVER_MASK_SLOT_KINDS,
  DISCOVER_TRAIT_SLOT_KINDS,
  discoverSlotKindToArrangeRole
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
