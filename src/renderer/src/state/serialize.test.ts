import { describe, expect, it } from 'vitest'
import { initialState, reducer } from './store'
import { serializeProject, deserializeProject } from './serialize'
import type { Rifff } from '@shared/types'

const rifff: Rifff = {
  groupId: 'r1',
  name: 'test',
  bpm: 150,
  barLength: 8,
  folderPath: '/x',
  startBar: 4,
  stems: [
    { slot: 1, author: 'e', name: 'a', type: 'fx', path: '/a.wav', durationSec: 1, barLength: 8 }
  ]
}

describe('project serialization', () => {
  it('round-trips app state through JSON', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff })
    state = reducer(state, { type: 'SET_TEMPO', bpm: 96 })
    state = reducer(state, { type: 'NUDGE_OFFSET', key: 'r1', delta: 2 })

    const json = serializeProject(state)
    const restored = deserializeProject(JSON.parse(json))

    expect(restored.bpm).toBe(96)
    expect(restored.off.r1).toBe(2)
    expect(restored.rifffs.r1.name).toBe('test')
    expect(restored.playing).toBe(false) // never restore a playing state
    expect(restored.pos).toBe(0) // always reopen at the top
  })

  it('does not persist volumeDragMode — always reopens with it off', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff })
    state = reducer(state, { type: 'TOGGLE_VOLUME_DRAG_MODE' })
    expect(state.volumeDragMode).toBe(true)

    const json = serializeProject(state)
    expect(JSON.parse(json).volumeDragMode).toBeUndefined()

    const restored = deserializeProject(JSON.parse(json))
    expect(restored.volumeDragMode).toBe(false)
  })
})
