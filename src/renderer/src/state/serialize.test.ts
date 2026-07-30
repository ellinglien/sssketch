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
    // playing/pos aren't part of AppState at all anymore (they're
    // StoreContext.tsx's own transport state, never touched by serialization)
    // — nothing to assert here now the way there used to be.
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

  it('does not persist inspectorCollapsed — always reopens with it expanded', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff })
    state = reducer(state, { type: 'TOGGLE_INSPECTOR_COLLAPSED' })
    expect(state.inspectorCollapsed).toBe(true)

    const json = serializeProject(state)
    expect(JSON.parse(json).inspectorCollapsed).toBeUndefined()

    const restored = deserializeProject(JSON.parse(json))
    expect(restored.inspectorCollapsed).toBe(false)
  })
})

describe('deserializeProject mode fallback', () => {
  it('defaults to sketch mode for a plain (sketch-eligible) loaded arrangement', () => {
    const persisted = JSON.parse(serializeProject(initialState))
    expect(deserializeProject(persisted).mode).toBe('sketch')
  })

  it('falls back to normal mode when the loaded arrangement is not sketch-eligible', () => {
    let state = reducer(initialState, {
      type: 'ADD_TO_SHELF',
      rifff: { ...rifff, startBar: undefined }
    })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
    state = reducer(state, { type: 'SET_FADE_IN', groupId: 'r1', bars: 1 }) // disqualifies sketch
    const persisted = JSON.parse(serializeProject(state))
    expect(deserializeProject(persisted).mode).toBe('normal')
  })
})
