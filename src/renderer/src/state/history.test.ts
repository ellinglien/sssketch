import { describe, expect, it } from 'vitest'
import { createHistoryState, historyReducer } from './history'
import { initialState } from './store'
import type { Rifff } from '@shared/types'

const rifff: Rifff = {
  groupId: 'r1',
  name: 'test',
  bpm: 150,
  barLength: 8,
  folderPath: '/x',
  stems: [
    { slot: 1, author: 'e', name: 'a', type: 'fx', path: '/a.wav', durationSec: 1, barLength: 8 }
  ]
}

describe('historyReducer', () => {
  it('undoes a regular action back to the previous state', () => {
    let h = createHistoryState(initialState)
    h = historyReducer(h, { type: 'ADD_TO_SHELF', rifff })
    expect(h.present.rifffs.r1).toBeDefined()
    h = historyReducer(h, { type: 'UNDO' })
    expect(h.present.rifffs.r1).toBeUndefined()
  })

  it('redoes back to the state undo moved away from', () => {
    let h = createHistoryState(initialState)
    h = historyReducer(h, { type: 'ADD_TO_SHELF', rifff })
    h = historyReducer(h, { type: 'UNDO' })
    h = historyReducer(h, { type: 'REDO' })
    expect(h.present.rifffs.r1).toBeDefined()
  })

  it('undo on an empty past is a no-op', () => {
    const h = createHistoryState(initialState)
    expect(historyReducer(h, { type: 'UNDO' })).toBe(h)
  })

  it('redo on an empty future is a no-op', () => {
    const h = createHistoryState(initialState)
    expect(historyReducer(h, { type: 'REDO' })).toBe(h)
  })

  it('a new action after undo clears the redo stack', () => {
    let h = createHistoryState(initialState)
    h = historyReducer(h, { type: 'ADD_TO_SHELF', rifff })
    h = historyReducer(h, { type: 'UNDO' })
    h = historyReducer(h, { type: 'SET_TEMPO', bpm: 100 })
    expect(h.future).toHaveLength(0)
    // and redo now does nothing, since there's nothing to redo into
    const afterRedo = historyReducer(h, { type: 'REDO' })
    expect(afterRedo).toBe(h)
  })

  it('does not push history for transient transport actions', () => {
    let h = createHistoryState(initialState)
    h = historyReducer(h, { type: 'ADD_TO_SHELF', rifff })
    const pastLengthAfterRealEdit = h.past.length
    h = historyReducer(h, { type: 'PLAY' })
    h = historyReducer(h, { type: 'SET_POS', pos: 1.5 })
    h = historyReducer(h, { type: 'PAUSE' })
    h = historyReducer(h, { type: 'STOP' })
    expect(h.past).toHaveLength(pastLengthAfterRealEdit)
    expect(h.present.playing).toBe(false)
    expect(h.present.pos).toBe(0) // STOP resets pos
  })

  it('undoing past a transient action lands on the last real edit, not a stale playhead state', () => {
    let h = createHistoryState(initialState)
    h = historyReducer(h, { type: 'ADD_TO_SHELF', rifff })
    h = historyReducer(h, { type: 'PLAY' }) // transient, no new checkpoint
    h = historyReducer(h, { type: 'SET_TEMPO', bpm: 100 }) // real edit, checkpoints the playing=true state
    h = historyReducer(h, { type: 'UNDO' })
    expect(h.present.bpm).toBe(80) // back before the tempo change
    expect(h.present.rifffs.r1).toBeDefined() // the shelf add is still there
  })

  it('loading a project starts a fresh history', () => {
    let h = createHistoryState(initialState)
    h = historyReducer(h, { type: 'ADD_TO_SHELF', rifff })
    h = historyReducer(h, { type: 'LOAD_STATE', state: initialState })
    expect(h.past).toHaveLength(0)
    expect(h.future).toHaveLength(0)
    expect(historyReducer(h, { type: 'UNDO' })).toBe(h) // nothing to undo into
  })

  it('caps history length rather than growing unboundedly', () => {
    let h = createHistoryState(initialState)
    for (let i = 0; i < 150; i++) {
      h = historyReducer(h, { type: 'SET_TEMPO', bpm: 80 + (i % 40) })
    }
    expect(h.past.length).toBeLessThanOrEqual(100)
  })
})
