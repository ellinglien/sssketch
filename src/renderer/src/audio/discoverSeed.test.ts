import { describe, expect, it } from 'vitest'
import {
  buildSeedSlotsFromStems,
  buildSeedSlotsFromCandidates,
  discoverHasRealContent
} from './discoverSeed'
import type { Stem } from '@shared/types'
import type { DiscoverCandidate } from '../../../main/discoverCandidates'
import type { DiscoverSlot } from '../components/DiscoverPanel'

function fixtureStem(overrides: Partial<Stem> = {}): Stem {
  return {
    slot: 1,
    author: 'elling',
    name: 'a stem',
    type: 'drums',
    path: '/a.wav',
    durationSec: 4,
    barLength: 4,
    ...overrides
  }
}

function fixtureCandidate(overrides: Partial<DiscoverCandidate> = {}): DiscoverCandidate {
  return {
    stemCID: 'stem-1',
    jamCID: 'jam-1',
    riffCID: 'riff-1',
    presetName: 'a preset',
    creatorUserName: 'elling',
    slotKinds: ['drums'],
    drumSubRole: null,
    riffBpm: 120,
    traitValues: {},
    riffCreationTime: null,
    ...overrides
  }
}

describe('buildSeedSlotsFromStems', () => {
  it('returns one slot per stem, in order, each locked: false', () => {
    const stems = [
      fixtureStem({ name: 'kick', type: 'drums' }),
      fixtureStem({ name: 'bassline', type: 'bass' })
    ]
    const slots = buildSeedSlotsFromStems(stems)
    expect(slots).toHaveLength(2)
    expect(slots[0].seedStem?.name).toBe('kick')
    expect(slots[1].seedStem?.name).toBe('bassline')
    expect(slots.every((s) => s.locked === false)).toBe(true)
  })

  it('infers kind from stem type via discoverSlotKindForSoundType', () => {
    const slots = buildSeedSlotsFromStems([fixtureStem({ type: 'bass', name: 'a random name' })])
    expect(slots[0].kinds).toEqual(['bass'])
  })

  it('falls back to the bright trait kind for a stem type with no reliable mask signal', () => {
    const slots = buildSeedSlotsFromStems([fixtureStem({ type: 'fx' })])
    expect(slots[0].kinds).toEqual(['bright'])
  })

  it('each slot has candidate: null and hasRerolled: true, gain: 1', () => {
    const slots = buildSeedSlotsFromStems([fixtureStem()])
    expect(slots[0].candidate).toBeNull()
    expect(slots[0].hasRerolled).toBe(true)
    expect(slots[0].gain).toBe(1)
  })

  it('starts every slot with no modifiers', () => {
    const slots = buildSeedSlotsFromStems([fixtureStem()])
    expect(slots[0].modifiers).toEqual([])
  })

  it('gives every slot a fresh, distinct id', () => {
    const slots = buildSeedSlotsFromStems([fixtureStem(), fixtureStem()])
    expect(slots[0].id).not.toBe(slots[1].id)
  })

  it('caps at 8 slots even if given more stems', () => {
    const stems = Array.from({ length: 10 }, (_, i) => fixtureStem({ name: `stem-${i}` }))
    const slots = buildSeedSlotsFromStems(stems)
    expect(slots).toHaveLength(8)
    expect(slots[0].seedStem?.name).toBe('stem-0')
    expect(slots[7].seedStem?.name).toBe('stem-7')
  })

  it('returns an empty array for an empty input', () => {
    expect(buildSeedSlotsFromStems([])).toEqual([])
  })
})

describe('buildSeedSlotsFromCandidates', () => {
  it('returns one slot per candidate, in order, with that candidate set and kind from it', () => {
    const candidates = [
      fixtureCandidate({ stemCID: 'a', slotKinds: ['drums'] }),
      fixtureCandidate({ stemCID: 'b', slotKinds: ['bass'] })
    ]
    const slots = buildSeedSlotsFromCandidates(candidates)
    expect(slots).toHaveLength(2)
    expect(slots[0].candidate?.stemCID).toBe('a')
    expect(slots[0].kinds).toEqual(['drums'])
    expect(slots[1].candidate?.stemCID).toBe('b')
    expect(slots[1].kinds).toEqual(['bass'])
  })

  it('starts every slot with no modifiers', () => {
    const slots = buildSeedSlotsFromCandidates([fixtureCandidate({ slotKinds: ['drums'] })])
    expect(slots[0].modifiers).toEqual([])
  })

  it('each slot has seedStem: undefined, locked: false, hasRerolled: true, gain: 1', () => {
    const slots = buildSeedSlotsFromCandidates([fixtureCandidate()])
    expect(slots[0].seedStem).toBeUndefined()
    expect(slots[0].locked).toBe(false)
    expect(slots[0].hasRerolled).toBe(true)
    expect(slots[0].gain).toBe(1)
  })

  it('caps at 8 slots even if given more candidates', () => {
    const candidates = Array.from({ length: 10 }, (_, i) =>
      fixtureCandidate({ stemCID: `stem-${i}` })
    )
    expect(buildSeedSlotsFromCandidates(candidates)).toHaveLength(8)
  })

  it('returns an empty array for an empty input', () => {
    expect(buildSeedSlotsFromCandidates([])).toEqual([])
  })
})

function fixtureSlot(overrides: Partial<DiscoverSlot> = {}): DiscoverSlot {
  return {
    id: 'slot-1',
    kinds: ['drums'],
    modifiers: [],
    locked: false,
    candidate: null,
    hasRerolled: false,
    gain: 1,
    ...overrides
  }
}

// Direct bug, code review, 2026-09-17: an earlier commit's own two fresh
// "does Discover have real content" checks used `candidate !== null` alone,
// which silently treats every Shelf-seeded slot (seedStem set, candidate
// always null -- see buildSeedSlotsFromStems' own doc comment above) as
// empty. This predicate has now regressed once already; these tests exist
// specifically so extracting it into a shared function actually prevents
// that, not just reduces how many places it could happen again.
describe('discoverHasRealContent', () => {
  it('is true for a slot with a real candidate', () => {
    expect(discoverHasRealContent([fixtureSlot({ candidate: fixtureCandidate() })])).toBe(true)
  })

  it('is true for a seedStem-only slot (candidate: null) -- the exact case that regressed', () => {
    const [seeded] = buildSeedSlotsFromStems([fixtureStem()])
    expect(seeded.candidate).toBeNull()
    expect(seeded.seedStem).toBeDefined()
    expect(discoverHasRealContent([seeded])).toBe(true)
  })

  it('is false for a never-touched slot (no candidate, no seedStem)', () => {
    expect(discoverHasRealContent([fixtureSlot()])).toBe(false)
  })

  it('is false for a slot whose reroll found no match (candidate: null after rolling)', () => {
    expect(discoverHasRealContent([fixtureSlot({ candidate: null, hasRerolled: true })])).toBe(
      false
    )
  })

  it('is false for an empty array', () => {
    expect(discoverHasRealContent([])).toBe(false)
  })

  it('is true if ANY slot among several has real content', () => {
    const slots = [fixtureSlot(), fixtureSlot({ candidate: fixtureCandidate() }), fixtureSlot()]
    expect(discoverHasRealContent(slots)).toBe(true)
  })
})
