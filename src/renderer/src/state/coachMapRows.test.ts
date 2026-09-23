import { describe, expect, it } from 'vitest'
import { startCoach } from '@shared/coach'
import type { LockedClimax } from '@shared/coachClimax'
import { createRiser } from '@shared/riser'
import type { ArrangeRole } from '@shared/stemRole'
import type { Rifff, SoundType } from '@shared/types'
import { initialState, type AppState } from './store'
import { coachMapRows } from './coachMapRows'

function rifff(groupId: string, path: string, startBar: number, type: SoundType = 'drums'): Rifff {
  return {
    groupId,
    name: path,
    bpm: 120,
    barLength: 4,
    folderPath: '/x',
    startBar,
    stems: [{ slot: 1, author: 'e', name: path, type, path, durationSec: 4, barLength: 4 }]
  }
}

/** A climax as the auto-arranger's role step leaves it: every stem recorded
 * through audio-in (which is what real Endlesss material looks like), the
 * role the only thing that tells them apart. */
function climaxOf(roles: Record<string, ArrangeRole>): LockedClimax {
  return {
    bpm: 120,
    barLength: 4,
    lockedAt: 0,
    stems: Object.entries(roles).map(([path, role]) => ({
      path,
      name: 'audio in',
      author: 'e',
      type: 'audioIn' as SoundType,
      durationSec: 4,
      barLength: 4,
      kinds: [],
      role,
      gain: 1
    }))
  }
}

/** A state whose map laid out one channel per path, with the given climax. */
function laidOutState(paths: string[], climax: LockedClimax | null): AppState {
  const rifffs = paths.map((path, i) => rifff(`c${i}`, path, 0, 'audioIn'))
  return stateWith(rifffs, {
    coach: {
      ...startCoach(0),
      lockedClimax: climax,
      sections: [
        {
          id: 's1',
          type: 'drop' as const,
          name: 'drop',
          passes: 1,
          cells: {},
          startBar: 0,
          placedGroupIds: Object.fromEntries(paths.map((path, i) => [path, `c${i}`]))
        }
      ]
    }
  })
}

function stateWith(rifffs: Rifff[], extra: Partial<AppState> = {}): AppState {
  return {
    ...initialState,
    rifffs: Object.fromEntries(rifffs.map((r) => [r.groupId, r])),
    channelOf: Object.fromEntries(rifffs.map((r) => [r.groupId, r.groupId])),
    channelOrder: rifffs.map((r) => r.groupId),
    ...extra
  }
}

describe('coachMapRows', () => {
  it('produces one row per arranger channel, in the arranger own order', () => {
    const state = stateWith([rifff('a', '/kick.wav', 0), rifff('b', '/bass.wav', 0)])
    expect(coachMapRows(state).map((row) => row.channelId)).toEqual(['a', 'b'])
  })

  it('measures a clip from its cropped start to its played end', () => {
    const state = stateWith([rifff('a', '/kick.wav', 8)], {
      playedBars: { a: 16 },
      leftCrop: { a: 2 }
    })
    expect(coachMapRows(state)[0].clips).toEqual([{ groupId: 'a', startBar: 10, endBar: 24 }])
  })

  it('falls back to the rifff own bar length when nothing set playedBars', () => {
    const state = stateWith([rifff('a', '/kick.wav', 0)])
    expect(coachMapRows(state)[0].clips[0].endBar).toBe(4)
  })

  it('leaves an unplaced rifff out entirely', () => {
    const shelf = { ...rifff('a', '/kick.wav', 0), startBar: undefined }
    const state = { ...initialState, rifffs: { a: shelf } }
    expect(coachMapRows(state)).toEqual([])
  })

  it('reads a riser row as a riser, with its own name and no sound type', () => {
    const riser = createRiser({ id: 'r1', channelId: 'chan-r', startBar: 12 })
    const state = { ...initialState, risers: { r1: { ...riser, name: 'lift' } } }
    const rows = coachMapRows(state)
    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('riser')
    expect(rows[0].label).toBe('lift')
    expect(rows[0].soundType).toBeNull()
    expect(rows[0].path).toBeNull()
    expect(rows[0].clips[0].startBar).toBe(12)
  })

  it('names a row the map laid out by the stem it was laid out for', () => {
    const state = stateWith([rifff('a', '/kick.wav', 0)], {
      coach: {
        ...startCoach(0),
        sections: [
          {
            id: 's1',
            type: 'drop' as const,
            name: 'drop',
            passes: 1,
            cells: {},
            startBar: 0,
            placedGroupIds: { '/kick.wav': 'a' }
          }
        ]
      }
    })
    const row = coachMapRows(state)[0]
    expect(row.kind).toBe('stem')
    expect(row.path).toBe('/kick.wav')
  })

  it('calls a row the map did NOT lay out other, so nothing pretends to own it', () => {
    const state = stateWith([rifff('a', '/kick.wav', 0)])
    expect(coachMapRows(state)[0].kind).toBe('other')
    expect(coachMapRows(state)[0].path).toBeNull()
  })

  it('names a laid-out row by the role the user confirmed, not the raw sound type', () => {
    // Every Endlesss stem here is recorded through audio-in and named
    // "audio in" -- the confirmed role is the only thing that says anything.
    const state = laidOutState(['/one.wav'], climaxOf({ '/one.wav': 'bass' }))
    expect(coachMapRows(state)[0].label).toBe('bass')
  })

  it('numbers rows that share a role so two drums are tellable apart', () => {
    const state = laidOutState(
      ['/one.wav', '/two.wav', '/three.wav'],
      climaxOf({ '/one.wav': 'drums', '/two.wav': 'drums', '/three.wav': 'vocal' })
    )
    expect(coachMapRows(state).map((row) => row.label)).toEqual(['drums 1', 'drums 2', 'vocal'])
  })

  it('spells a role the way every other picker spells it', () => {
    const state = laidOutState(['/one.wav'], climaxOf({ '/one.wav': 'textureFx' }))
    expect(coachMapRows(state)[0].label).toBe('texture/fx')
  })

  it('falls back to the stem own name when the climax has no role for that path', () => {
    const state = laidOutState(['/one.wav'], climaxOf({ '/other.wav': 'bass' }))
    expect(coachMapRows(state)[0].label).toBe('/one.wav')
  })

  it('leaves a riser row named by the riser, never by a role', () => {
    const riser = createRiser({ id: 'r1', channelId: 'chan-r', startBar: 12 })
    const state = {
      ...initialState,
      risers: { r1: { ...riser, name: 'lift' } },
      coach: { ...startCoach(0), lockedClimax: climaxOf({ '/one.wav': 'bass' }) }
    }
    expect(coachMapRows(state)[0].label).toBe('lift')
  })

  it('reads a stem that leaves and comes back as two clips on one row', () => {
    // Two clips sharing a channel -- the shape one stem's map row really
    // takes once a cell in the middle has been switched off.
    const first = rifff('a', '/kick.wav', 0)
    const second = { ...rifff('b', '/kick.wav', 8), name: '/kick.wav' }
    const state = stateWith([first, second], { channelOf: { a: 'a', b: 'a' }, channelOrder: ['a'] })
    const rows = coachMapRows(state)
    expect(rows).toHaveLength(1)
    expect(rows[0].clips).toEqual([
      { groupId: 'a', startBar: 0, endBar: 4 },
      { groupId: 'b', startBar: 8, endBar: 12 }
    ])
  })
})
