import { describe, expect, it } from 'vitest'
import { buildSeedSlotsFromStems, buildSeedSlotsFromCandidates } from './discoverSeed'
import type { Stem } from '@shared/types'
import type { DiscoverCandidate } from '../../../main/discoverCandidates'

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
    arrangeRole: 'drums',
    drumSubRole: null,
    riffBpm: 120,
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

  it('infers role from stem type via the same guessing resolveStemRole already uses', () => {
    const slots = buildSeedSlotsFromStems([fixtureStem({ type: 'bass', name: 'a random name' })])
    expect(slots[0].role).toBe('bass')
  })

  it('each slot has candidate: null and hasRerolled: true, gain: 1', () => {
    const slots = buildSeedSlotsFromStems([fixtureStem()])
    expect(slots[0].candidate).toBeNull()
    expect(slots[0].hasRerolled).toBe(true)
    expect(slots[0].gain).toBe(1)
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
  it('returns one slot per candidate, in order, with that candidate set and role from it', () => {
    const candidates = [
      fixtureCandidate({ stemCID: 'a', arrangeRole: 'drums' }),
      fixtureCandidate({ stemCID: 'b', arrangeRole: 'bass' })
    ]
    const slots = buildSeedSlotsFromCandidates(candidates)
    expect(slots).toHaveLength(2)
    expect(slots[0].candidate?.stemCID).toBe('a')
    expect(slots[0].role).toBe('drums')
    expect(slots[1].candidate?.stemCID).toBe('b')
    expect(slots[1].role).toBe('bass')
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
