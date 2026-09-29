import { describe, expect, it } from 'vitest'
import type { CoachSlotSnapshot } from './coachClimax'
import {
  parseRemoteSlotAction,
  parseRemoteSlotKinds,
  remoteStateFromSlots,
  type RemoteSlotResponse,
  type RemoteStateResponse
} from './remoteState'

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
  it('carries the slot id, a kind label, the stem name, its sound type and whether it is muted', () => {
    const state = remoteStateFromSlots([slot()], {
      discoverOpen: true,
      playing: false,
      kept: 3,
      rolled: 11,
      lastKeptName: null,
      loopBars: 8
    })
    expect(state.slots).toEqual([
      {
        id: 's1',
        kindLabel: 'drummy',
        stemName: 'wooden thud',
        soundType: 'drums',
        muted: false,
        soloed: true,
        peaks: null
      }
    ])
  })

  it('inverts the snapshot\u2019s audible into the mute the phone actually shows', () => {
    const state = remoteStateFromSlots([slot({ audible: false })], {
      discoverOpen: true,
      playing: false,
      kept: 0,
      rolled: 0,
      lastKeptName: null,
      loopBars: 8
    })
    expect(state.slots[0].muted).toBe(true)
  })

  it('NEVER carries a filesystem path', () => {
    const state = remoteStateFromSlots([slot()], {
      discoverOpen: true,
      playing: true,
      kept: 0,
      rolled: 0,
      lastKeptName: null,
      loopBars: 8
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
      lastKeptName: null,
      loopBars: 8
    })
    expect(state.slots).toEqual([
      {
        id: 's1',
        kindLabel: 'drummy',
        stemName: '',
        soundType: null,
        muted: false,
        soloed: true,
        peaks: null
      }
    ])
  })

  it('labels a combination slot with both kinds', () => {
    const state = remoteStateFromSlots([slot({ kinds: ['drums', 'bassHeavy'] })], {
      discoverOpen: true,
      playing: false,
      kept: 0,
      rolled: 0,
      lastKeptName: null,
      loopBars: 8
    })
    expect(state.slots[0].kindLabel).toContain('drummy')
    expect(state.slots[0].kindLabel).toContain('chonky')
  })

  it('carries quantised peaks for a slot the mac has already analysed', () => {
    const state = remoteStateFromSlots(
      [slot()],
      { discoverOpen: true, playing: false, kept: 0, rolled: 0, lastKeptName: null, loopBars: 8 },
      new Map([['s1', [0, 0.5, 1, 0.25]]])
    )
    expect(state.slots[0].peaks).toHaveLength(64)
    expect(state.slots[0].peaks?.[0]).toBe(0)
    expect(state.slots[0].peaks?.[63]).toBe(25)
  })

  it('reads a slot with no analysis yet as no waveform, not an empty one', () => {
    const state = remoteStateFromSlots(
      [slot()],
      { discoverOpen: true, playing: false, kept: 0, rolled: 0, lastKeptName: null, loopBars: 8 },
      new Map()
    )
    expect(state.slots[0].peaks).toBeNull()
  })

  it('is keyed by slot id, so a path cannot enter through the new door either', () => {
    const state = remoteStateFromSlots(
      [slot()],
      { discoverOpen: true, playing: false, kept: 0, rolled: 0, lastKeptName: null, loopBars: 8 },
      new Map([['s1', [0.4, 0.9]]])
    )
    expect(JSON.stringify(state)).not.toContain('/Users/')
    expect(JSON.stringify(state)).not.toContain('abc123')
    for (const v of state.slots[0].peaks ?? []) {
      expect(Number.isInteger(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(100)
    }
  })

  it('reads the only audible slot in the mix as soloed', () => {
    // Exactly Discover's own predicate -- toggleSlotSolo decides whether a
    // second press restores the full mix by asking whether this slot is the
    // sole member of previewingSlotIds, which through CoachSlotSnapshot IS
    // "the only audible one". The phone gets that answer rather than its
    // own, so the row can tell which third of the tap cycle it is in.
    const state = remoteStateFromSlots(
      [slot({ id: 'a' }), slot({ id: 'b', audible: false }), slot({ id: 'c', audible: false })],
      { discoverOpen: true, playing: false, kept: 0, rolled: 0, lastKeptName: null, loopBars: 8 }
    )
    expect(state.slots.map((s) => s.soloed)).toEqual([true, false, false])
    expect(state.slots.map((s) => s.muted)).toEqual([false, true, true])
  })

  it('reads nothing as soloed while more than one slot is audible', () => {
    const state = remoteStateFromSlots(
      [slot({ id: 'a' }), slot({ id: 'b' }), slot({ id: 'c', audible: false })],
      { discoverOpen: true, playing: false, kept: 0, rolled: 0, lastKeptName: null, loopBars: 8 }
    )
    expect(state.slots.map((s) => s.soloed)).toEqual([false, false, false])
  })

  it('never reads a muted slot as soloed, even when the whole mix is out', () => {
    const state = remoteStateFromSlots(
      [slot({ id: 'a', audible: false }), slot({ id: 'b', audible: false })],
      { discoverOpen: true, playing: false, kept: 0, rolled: 0, lastKeptName: null, loopBars: 8 }
    )
    expect(state.slots.map((s) => s.soloed)).toEqual([false, false])
  })

  it('passes the counters and the open/playing flags straight through', () => {
    const state = remoteStateFromSlots([], {
      discoverOpen: false,
      playing: true,
      kept: 3,
      rolled: 11,
      lastKeptName: 'misty kestrel',
      loopBars: 8
    })
    expect(state).toEqual({
      discoverOpen: false,
      playing: true,
      kept: 3,
      rolled: 11,
      lastKeptName: 'misty kestrel',
      loopBars: 8,
      radio: null,
      slots: []
    })
  })
})

describe('remoteStateFromSlots loop length', () => {
  it('carries how many bars long the loop is, so the phone can turn bars into seconds', () => {
    // Added 2026-09-27 for the phone's handover grid: "instead of it
    // playing only at the end of the loop, could we set it to update every
    // 4 bars, 8 bars, etc". The page divides the decoded buffer's own
    // duration by this to get seconds per bar. It is the SAME number the
    // renderer sends the engine as loopLengthBars, so the phone's grid and
    // the engine's loop are one grid rather than two that agree.
    const state = remoteStateFromSlots([slot()], {
      discoverOpen: true,
      playing: false,
      kept: 0,
      rolled: 0,
      lastKeptName: null,
      loopBars: 6
    })
    expect(state.loopBars).toBe(6)
  })

  it('reads anything that is not a whole number of bars as not knowing', () => {
    // 0 is what the Mac has before a single slot has resolved, and it is
    // also the only honest answer to a fractional or impossible count. The
    // page reads 0 as "swap at the end of the loop" -- the behaviour that
    // shipped before the grid existed -- so an unknown length can never
    // produce a wrong grid, only no grid.
    for (const bars of [0, -4, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const state = remoteStateFromSlots([slot()], {
        discoverOpen: true,
        playing: false,
        kept: 0,
        rolled: 0,
        lastKeptName: null,
        loopBars: bars
      })
      expect(state.loopBars).toBe(0)
    }
  })

  it('is a bar count and carries nothing else with it', () => {
    // The whole privacy argument for this field, asserted rather than
    // remembered: a count of bars identifies no file, names no jam and
    // cannot be turned back into a path.
    const state = remoteStateFromSlots([slot()], {
      discoverOpen: true,
      playing: false,
      kept: 0,
      rolled: 0,
      lastKeptName: null,
      loopBars: 8
    })
    expect(typeof state.loopBars).toBe('number')
    expect(JSON.stringify(state)).not.toContain('/Users/')
    expect(JSON.stringify(state)).not.toContain('abc123')
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
        lastKeptName: null,
        loopBars: 8
      }),
      loopId: '0123456789abcdef',
      // Main injects one of these per row, the way it injects loopId --
      // see RemoteSlotResponse.
      slots: [
        {
          ...remoteStateFromSlots([slot()], {
            discoverOpen: true,
            playing: false,
            kept: 0,
            rolled: 0,
            lastKeptName: null,
            loopBars: 8
          }).slots[0],
          stemId: null
        }
      ]
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
        lastKeptName: null,
        loopBars: 8
      }),
      loopId: null,
      slots: []
    }
    expect(response.loopId).toBeNull()
  })
})

describe('parseRemoteSlotKinds', () => {
  it('accepts the kinds the phone picker can actually send', () => {
    expect(parseRemoteSlotKinds(['drums', 'bright'])).toEqual(['drums', 'bright'])
  })

  it('normalizes rather than trusting the order or the set it was handed', () => {
    expect(parseRemoteSlotKinds(['bright', 'drums', 'drums'])).toEqual(['drums', 'bright'])
    expect(parseRemoteSlotKinds(['bright', 'warm'])).toEqual(['bright'])
  })

  it('rejects anything that is not a kind -- a path cannot ride in here', () => {
    expect(parseRemoteSlotKinds(['/Users/nickel/Music/secret/abc123'])).toBeNull()
    expect(parseRemoteSlotKinds(['drums', '../../etc/passwd'])).toBeNull()
    expect(parseRemoteSlotKinds(['DRUMS'])).toBeNull()
  })

  it('rejects an empty or missing selection -- a slot always targets something', () => {
    expect(parseRemoteSlotKinds([])).toBeNull()
    expect(parseRemoteSlotKinds(undefined)).toBeNull()
    expect(parseRemoteSlotKinds('drums')).toBeNull()
    expect(parseRemoteSlotKinds([1, 2])).toBeNull()
  })

  it('rejects a selection longer than the seven chips, whatever it contains', () => {
    expect(
      parseRemoteSlotKinds(['drums', 'drums', 'drums', 'drums', 'drums', 'drums', 'drums', 'drums'])
    ).toBeNull()
  })
})

describe('parseRemoteSlotAction', () => {
  it('accepts the six actions the phone can actually send', () => {
    expect(parseRemoteSlotAction('mute')).toBe('mute')
    expect(parseRemoteSlotAction('solo')).toBe('solo')
    expect(parseRemoteSlotAction('similar')).toBe('similar')
    expect(parseRemoteSlotAction('adjacent')).toBe('adjacent')
    expect(parseRemoteSlotAction('random')).toBe('random')
    expect(parseRemoteSlotAction('duplicate')).toBe('duplicate')
  })

  it('refuses anything else outright rather than best-guessing it', () => {
    // Same trust rule as parseRemoteSlotKinds: an unknown string fails the
    // whole request, so this field can never become a channel for a path.
    expect(parseRemoteSlotAction('MUTE')).toBeNull()
    expect(parseRemoteSlotAction('keep')).toBeNull()
    expect(parseRemoteSlotAction('/Users/nickel/Music/secret/abc123')).toBeNull()
    expect(parseRemoteSlotAction('')).toBeNull()
    expect(parseRemoteSlotAction(undefined)).toBeNull()
    expect(parseRemoteSlotAction(null)).toBeNull()
    expect(parseRemoteSlotAction(1)).toBeNull()
    expect(parseRemoteSlotAction(['mute'])).toBeNull()
  })
})

describe('remoteStateFromSlots and the stem id', () => {
  const meta = {
    discoverOpen: true,
    playing: false,
    kept: 0,
    rolled: 0,
    lastKeptName: null,
    loopBars: 8
  }

  it('still emits no stem id of its own, because main injects it', () => {
    // The whole point. This function does not see a resolvedPath and never
    // will; the stem id is derived in main from the EngineProject, exactly
    // the way loopId already is.
    const state = remoteStateFromSlots([slot({ id: 'a' })], meta)
    expect(Object.keys(state.slots[0])).not.toContain('stemId')
  })

  it('types a response row as a view plus the id main added', () => {
    const row: RemoteSlotResponse = {
      ...remoteStateFromSlots([slot({ id: 'a' })], meta).slots[0],
      stemId: 'abcdef0123456789'
    }
    expect(row.stemId).toBe('abcdef0123456789')
  })
})

describe('remoteStateFromSlots and radio', () => {
  const meta = {
    discoverOpen: true,
    playing: true,
    kept: 0,
    rolled: 0,
    lastKeptName: null,
    loopBars: 8
  }

  it('says nothing about radio when radio is not running', () => {
    expect(remoteStateFromSlots([slot({ id: 'a' })], meta).radio).toBeNull()
  })

  it('carries which row is armed', () => {
    const state = remoteStateFromSlots([slot({ id: 'a' }), slot({ id: 'b' })], {
      ...meta,
      radio: { armedSlotId: 'b', heldSlotId: null }
    })
    expect(state.radio).toEqual({ armedSlotId: 'b', heldSlotId: null })
  })

  it('carries a held row, the one that lands at the next wrap', () => {
    const state = remoteStateFromSlots([slot({ id: 'a' })], {
      ...meta,
      radio: { armedSlotId: null, heldSlotId: 'a' }
    })
    expect(state.radio).toEqual({ armedSlotId: null, heldSlotId: 'a' })
  })

  it('drops an id that names no row, so the phone can never be told to mark nothing', () => {
    const state = remoteStateFromSlots([slot({ id: 'a' })], {
      ...meta,
      radio: { armedSlotId: 'gone', heldSlotId: 'also-gone' }
    })
    expect(state.radio).toEqual({ armedSlotId: null, heldSlotId: null })
  })

  it('carries no fraction at all, because nothing on the phone draws one', () => {
    // The rule this fed went with the desktop's own on 2026-09-29; the
    // page's red playhead says when, and the row fades to say which.
    const state = remoteStateFromSlots([slot({ id: 'a' })], {
      ...meta,
      radio: { armedSlotId: 'a', heldSlotId: null }
    })
    expect(Object.keys(state.radio ?? {})).toEqual(['armedSlotId', 'heldSlotId'])
  })

  it('still lets no path, no cid and nothing about the library out', () => {
    const state = remoteStateFromSlots([slot({ id: 'a' })], {
      ...meta,
      radio: { armedSlotId: 'a', heldSlotId: null }
    })
    expect(JSON.stringify(state)).not.toContain('secret')
    expect(JSON.stringify(state)).not.toContain('/Users')
  })
})
