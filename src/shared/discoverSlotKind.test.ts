import { describe, expect, it } from 'vitest'
import { ARRANGE_ROLE_OPTIONS } from './stemRole'
import { kindsCoverSet } from './coachClimax'
import {
  ARRANGE_ROLE_SLOT_KINDS,
  arrangeRoleToSlotKinds,
  DISCOVER_SLOT_KIND_OPTIONS,
  DISCOVER_MASK_SLOT_KINDS,
  DISCOVER_TRAIT_SLOT_KINDS,
  discoverSlotKindToArrangeRole,
  DISCOVER_SLOT_KIND_LABEL,
  isMaskSlotKind,
  isTraitSlotKind,
  normalizeSlotKinds,
  parseSlotKind,
  rankKindsOf,
  toggleSlotKind,
  slotKindsLabel,
  slotKindsKey
} from './discoverSlotKind'

describe('DISCOVER_SLOT_KIND_OPTIONS', () => {
  it('lists exactly the 8 kinds, mask kinds first', () => {
    expect(DISCOVER_SLOT_KIND_OPTIONS).toEqual([
      'drums',
      'bass',
      'back',
      'front',
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
  it('maps the 4 mask kinds to a stored role', () => {
    expect(discoverSlotKindToArrangeRole('drums')).toBe('drums')
    expect(discoverSlotKindToArrangeRole('bass')).toBe('bass')
    expect(discoverSlotKindToArrangeRole('back')).toBe('backing')
    expect(discoverSlotKindToArrangeRole('front')).toBe('lead')
  })

  it('maps the 4 trait kinds to a fixed approximation', () => {
    expect(discoverSlotKindToArrangeRole('bassHeavy')).toBe('bass')
    expect(discoverSlotKindToArrangeRole('rhythmic')).toBe('drums')
    expect(discoverSlotKindToArrangeRole('bright')).toBe('lead')
    expect(discoverSlotKindToArrangeRole('warm')).toBe('backing')
  })

  it('covers every DiscoverSlotKind with no missing entry', () => {
    for (const kind of DISCOVER_SLOT_KIND_OPTIONS) {
      expect(() => discoverSlotKindToArrangeRole(kind)).not.toThrow()
    }
  })
})

describe('isMaskSlotKind / isTraitSlotKind', () => {
  it('splits the 8 kinds into 4 mask + 4 trait', () => {
    expect(['drums', 'bass', 'back', 'front'].every((k) => isMaskSlotKind(k as never))).toBe(true)
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
    expect(slotKindsLabel(['warm', 'bassHeavy', 'drums'])).toBe('drums · chonky · buttery')
  })

  it('key is order-independent', () => {
    expect(slotKindsKey(['warm', 'drums'])).toBe(slotKindsKey(['drums', 'warm']))
    expect(slotKindsKey(['warm', 'drums'])).toBe('drums+warm')
  })

  it('DISCOVER_SLOT_KIND_LABEL: plain words for categories, playful for traits', () => {
    expect(DISCOVER_SLOT_KIND_LABEL).toEqual({
      drums: 'drums',
      bass: 'bass',
      back: 'back',
      front: 'front',
      bassHeavy: 'chonky',
      rhythmic: 'rhythmic',
      bright: 'sparkly',
      warm: 'buttery'
    })
  })
})

describe('arrangeRoleToSlotKinds', () => {
  it('gives each stored role its category kind', () => {
    expect(arrangeRoleToSlotKinds('lead')).toEqual(['front'])
    expect(arrangeRoleToSlotKinds('vocal')).toEqual(['front'])
    expect(arrangeRoleToSlotKinds('backing')).toEqual(['back'])
    expect(arrangeRoleToSlotKinds('aux')).toEqual(['back'])
    expect(arrangeRoleToSlotKinds('textureFx')).toEqual(['back', 'warm'])
    expect(arrangeRoleToSlotKinds('fill')).toEqual(['drums', 'rhythmic'])
  })

  it('never calls anything the hook -- the app cannot tell a hook apart', () => {
    for (const role of ARRANGE_ROLE_OPTIONS) {
      expect(kindsCoverSet(arrangeRoleToSlotKinds(role), ['front', 'bright'])).toBe(false)
    }
  })

  it('answers for every role the dropdown can produce', () => {
    for (const role of ARRANGE_ROLE_OPTIONS) {
      expect(ARRANGE_ROLE_SLOT_KINDS[role]).toBeDefined()
    }
  })
})

describe('four categories', () => {
  it('has the four categories as mask kinds', () => {
    expect(DISCOVER_MASK_SLOT_KINDS).toEqual(['drums', 'bass', 'back', 'front'])
    expect(DISCOVER_SLOT_KIND_LABEL.bright).toBe('sparkly')
  })

  it('reads a saved lead as front', () => {
    expect(parseSlotKind('lead')).toBe('front')
    expect(parseSlotKind('back')).toBe('back')
    expect(parseSlotKind('nope')).toBeNull()
    expect(parseSlotKind(3)).toBeNull()
  })

  it('ranks by traits and the dial', () => {
    expect(rankKindsOf(['front', 'bright', 'drums'])).toEqual(['front', 'bright'])
    expect(rankKindsOf(['drums'])).toEqual([])
  })

  it('orders mask kinds first', () => {
    expect(normalizeSlotKinds(['warm', 'front', 'drums'])).toEqual(['drums', 'front', 'warm'])
  })

  // Their dials are complements, so a set with both could only pass undecided stems.
  it('keeps whichever of back/front comes first, never both', () => {
    expect(normalizeSlotKinds(['front', 'back'])).toEqual(['front'])
    expect(normalizeSlotKinds(['back', 'drums', 'front'])).toEqual(['drums', 'back'])
  })

  it('turning front on turns back off, and vice versa', () => {
    expect(toggleSlotKind(['drums', 'back'], 'front')).toEqual(['drums', 'front'])
    expect(toggleSlotKind(['front'], 'back')).toEqual(['back'])
  })
})
