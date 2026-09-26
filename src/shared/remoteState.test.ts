import { describe, expect, it } from 'vitest'
import type { CoachSlotSnapshot } from './coachClimax'
import { remoteStateFromSlots, type RemoteStateResponse } from './remoteState'

function slot(overrides: Partial<CoachSlotSnapshot> = {}): CoachSlotSnapshot {
  return {
    id: 's1',
    kinds: ['drums'],
    stem: {
      path: '/Users/nickel/Music/secret/abc123',
      name: 'wooden thud',
      author: 'elling',
      type: 'drums',
      durationSec: 2,
      barLength: 1
    },
    gain: 1,
    audible: true,
    rolling: false,
    ...overrides
  }
}

describe('remoteStateFromSlots', () => {
  it('carries the slot id, a kind label, the stem name and its sound type', () => {
    const state = remoteStateFromSlots([slot()], {
      discoverOpen: true,
      playing: false,
      kept: 3,
      rolled: 11,
      lastKeptName: null
    })
    expect(state.slots).toEqual([
      { id: 's1', kindLabel: 'drummy', stemName: 'wooden thud', soundType: 'drums' }
    ])
  })

  it('NEVER carries a filesystem path', () => {
    const state = remoteStateFromSlots([slot()], {
      discoverOpen: true,
      playing: true,
      kept: 0,
      rolled: 0,
      lastKeptName: null
    })
    expect(JSON.stringify(state)).not.toContain('/Users/')
    expect(JSON.stringify(state)).not.toContain('abc123')
  })

  it('reads an unresolved slot as empty rather than dropping the row', () => {
    const state = remoteStateFromSlots([slot({ stem: null })], {
      discoverOpen: true,
      playing: false,
      kept: 0,
      rolled: 0,
      lastKeptName: null
    })
    expect(state.slots).toEqual([{ id: 's1', kindLabel: 'drummy', stemName: '', soundType: null }])
  })

  it('labels a combination slot with both kinds', () => {
    const state = remoteStateFromSlots([slot({ kinds: ['drums', 'bassHeavy'] })], {
      discoverOpen: true,
      playing: false,
      kept: 0,
      rolled: 0,
      lastKeptName: null
    })
    expect(state.slots[0].kindLabel).toContain('drummy')
    expect(state.slots[0].kindLabel).toContain('chonky')
  })

  it('passes the counters and the open/playing flags straight through', () => {
    const state = remoteStateFromSlots([], {
      discoverOpen: false,
      playing: true,
      kept: 3,
      rolled: 11,
      lastKeptName: 'misty kestrel'
    })
    expect(state).toEqual({
      discoverOpen: false,
      playing: true,
      kept: 3,
      rolled: 11,
      lastKeptName: 'misty kestrel',
      slots: []
    })
  })
})

describe('RemoteStateResponse', () => {
  it('carries a loop id and still never carries a filesystem path', () => {
    const response: RemoteStateResponse = {
      ...remoteStateFromSlots([slot()], {
        discoverOpen: true,
        playing: false,
        kept: 0,
        rolled: 0,
        lastKeptName: null
      }),
      loopId: '0123456789abcdef'
    }
    expect(response.loopId).toMatch(/^[0-9a-f]{16}$/)
    expect(JSON.stringify(response)).not.toContain('/Users/')
    expect(JSON.stringify(response)).not.toContain('abc123')
  })

  it('reads a missing loop as null rather than an empty string', () => {
    const response: RemoteStateResponse = {
      ...remoteStateFromSlots([], {
        discoverOpen: false,
        playing: false,
        kept: 0,
        rolled: 0,
        lastKeptName: null
      }),
      loopId: null
    }
    expect(response.loopId).toBeNull()
  })
})
