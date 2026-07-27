import { describe, expect, it } from 'vitest'
import { initialState, reducer } from './store'
import type { Rifff } from '@shared/types'

function makeRifff(overrides: Partial<Rifff> = {}): Rifff {
  return {
    groupId: 'r1',
    name: 'test rifff',
    bpm: 150,
    barLength: 8,
    folderPath: '/x',
    stems: [
      {
        slot: 1,
        author: 'elling',
        name: 'Highpass',
        type: 'fx',
        path: '/x/1.wav',
        durationSec: 12.8,
        barLength: 8
      },
      {
        slot: 6,
        author: 'elling',
        name: 'Freezer',
        type: 'fx',
        path: '/x/6.wav',
        durationSec: 3.2,
        barLength: 2
      }
    ],
    ...overrides
  }
}

describe('reducer', () => {
  it('adds a rifff to the shelf without placing it on the timeline', () => {
    const state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
    expect(state.rifffs.r1).toBeDefined()
    expect(state.rifffs.r1.startBar).toBeUndefined()
  })

  it('placing on the timeline sets startBar, selects, expands, and enables stretch', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 4 })
    expect(state.rifffs.r1.startBar).toBe(4)
    expect(state.sel).toBe('r1')
    expect(state.exp.r1).toBe(true)
    expect(state.stretch.r1).toBe(true)
  })

  it('clamps tempo to 40..200', () => {
    expect(reducer(initialState, { type: 'SET_TEMPO', bpm: 500 }).bpm).toBe(200)
    expect(reducer(initialState, { type: 'SET_TEMPO', bpm: 1 }).bpm).toBe(40)
    expect(reducer(initialState, { type: 'SET_TEMPO', bpm: 120 }).bpm).toBe(120)
  })

  it('cycles snap index through 0..3 and wraps', () => {
    let state = initialState // snapIdx starts at 2
    state = reducer(state, { type: 'CYCLE_SNAP' })
    expect(state.snapIdx).toBe(3)
    state = reducer(state, { type: 'CYCLE_SNAP' })
    expect(state.snapIdx).toBe(0) // wraps past the end of the array
    state = reducer(state, { type: 'CYCLE_SNAP' })
    expect(state.snapIdx).toBe(1)
    state = reducer(state, { type: 'CYCLE_SNAP' })
    expect(state.snapIdx).toBe(2) // back to start, full cycle confirmed
  })

  it('clamps nudged offset to -8..8', () => {
    let state = initialState
    for (let i = 0; i < 20; i++) {
      state = reducer(state, { type: 'NUDGE_OFFSET', key: 'r1', delta: 1 })
    }
    expect(state.off.r1).toBe(8)
    for (let i = 0; i < 20; i++) {
      state = reducer(state, { type: 'NUDGE_OFFSET', key: 'r1', delta: -1 })
    }
    expect(state.off.r1).toBe(-8)
  })

  it('unlink copies the group offset onto each stem key and flags unlinked', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
    state = reducer(state, { type: 'NUDGE_OFFSET', key: 'r1', delta: 3 })
    state = reducer(state, { type: 'UNLINK', groupId: 'r1' })
    expect(state.unlinked.r1).toBe(true)
    expect(state.off['r1:1']).toBe(3)
    expect(state.off['r1:6']).toBe(3)
  })

  it('relink clears the unlinked flag', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
    state = reducer(state, { type: 'UNLINK', groupId: 'r1' })
    state = reducer(state, { type: 'RELINK', groupId: 'r1' })
    expect(state.unlinked.r1).toBe(false)
  })

  it('cycles a stem sound-type through all 8 types and back to the start', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
    for (let i = 0; i < 8; i++) {
      state = reducer(state, { type: 'CYCLE_TYPE', groupId: 'r1', slot: 1 })
    }
    expect(state.rifffs.r1.stems.find((s) => s.slot === 1)?.type).toBe('fx')
  })

  it('stop resets position and pauses', () => {
    let state = reducer(initialState, { type: 'PLAY' })
    state = reducer(state, { type: 'SET_POS', pos: 12.5 })
    state = reducer(state, { type: 'STOP' })
    expect(state.playing).toBe(false)
    expect(state.pos).toBe(0)
  })
})
