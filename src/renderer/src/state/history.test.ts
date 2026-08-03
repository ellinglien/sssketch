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

  // PLAY/PAUSE/STOP/SET_POS used to be tested here too — they're no longer
  // part of Action at all (see store.ts's own comment on Action), having
  // moved to StoreContext.tsx's own transport state entirely outside this
  // reducer, so there's nothing for historyReducer to filter for them
  // anymore. TOGGLE_VOLUME_DRAG_MODE/SET_ARRANGER_MODE are what's left in
  // TRANSIENT_ACTION_TYPES, covered below.
  it('does not push history for transient UI-mode actions', () => {
    let h = createHistoryState(initialState)
    h = historyReducer(h, { type: 'ADD_TO_SHELF', rifff })
    const pastLengthAfterRealEdit = h.past.length
    h = historyReducer(h, { type: 'TOGGLE_VOLUME_DRAG_MODE' })
    h = historyReducer(h, { type: 'SET_ARRANGER_MODE', mode: 'sketch' })
    expect(h.past).toHaveLength(pastLengthAfterRealEdit)
    expect(h.present.volumeDragMode).toBe(true)
    expect(h.present.mode).toBe('sketch')
  })

  it('does not push history for SET_AVAILABLE_INPUT_DEVICES', () => {
    // A pure IPC-fetch side effect (App.tsx's input-device dropdown
    // re-fetches on every focus while the list is still empty) -- without
    // this, a machine with no input devices would push a fresh checkpoint
    // on every single dropdown focus, eating undo-stack slack for nothing
    // the user would ever want to undo.
    let h = createHistoryState(initialState)
    h = historyReducer(h, { type: 'ADD_TO_SHELF', rifff })
    const pastLengthAfterRealEdit = h.past.length
    h = historyReducer(h, { type: 'SET_AVAILABLE_INPUT_DEVICES', devices: ['mic'] })
    expect(h.past).toHaveLength(pastLengthAfterRealEdit)
    expect(h.present.availableInputDevices).toEqual(['mic'])
  })

  it('undoing past a transient action lands on the last real edit, not a stale UI-mode state', () => {
    let h = createHistoryState(initialState)
    h = historyReducer(h, { type: 'ADD_TO_SHELF', rifff })
    h = historyReducer(h, { type: 'TOGGLE_VOLUME_DRAG_MODE' }) // transient, no new checkpoint
    h = historyReducer(h, { type: 'SET_TEMPO', bpm: 100 }) // real edit, checkpoints the volumeDragMode=true state
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

  it('undo/redo never changes armedChannelId, even across a checkpoint that captured a stale value', () => {
    // Regression test: ARM/DISARM_RECORDING_CHANNEL are transient (no
    // checkpoint of their own), but armedChannelId is an ordinary AppState
    // field, so it still rides along inside whatever the NEXT real edit's
    // checkpoint happens to capture. Left unhandled, undoing back past
    // that checkpoint would silently re-arm a stale channel the engine
    // isn't actually capturing into anymore -- see history.ts's own
    // comment on this fix for the full failure scenario (a disarm click
    // would then misattribute the REAL armed channel's committed audio
    // onto the wrong channel's row, since disarm-recording takes no
    // channelId parameter).
    let h = createHistoryState(initialState)
    h = historyReducer(h, { type: 'ARM_RECORDING_CHANNEL', channelId: 'A' }) // transient
    h = historyReducer(h, { type: 'SET_TEMPO', bpm: 100 }) // real edit, checkpoints armedChannelId: 'A'
    h = historyReducer(h, { type: 'ARM_RECORDING_CHANNEL', channelId: 'B' }) // transient, overwrites present only
    expect(h.present.armedChannelId).toBe('B')

    h = historyReducer(h, { type: 'UNDO' })
    expect(h.present.bpm).toBe(80) // the real edit was undone
    expect(h.present.armedChannelId).toBe('B') // but armedChannelId must NOT revert to the stale 'A'

    h = historyReducer(h, { type: 'REDO' })
    expect(h.present.bpm).toBe(100)
    expect(h.present.armedChannelId).toBe('B') // still not reverted by redo either
  })

  it('caps history length rather than growing unboundedly', () => {
    let h = createHistoryState(initialState)
    for (let i = 0; i < 150; i++) {
      h = historyReducer(h, { type: 'SET_TEMPO', bpm: 80 + (i % 40) })
    }
    expect(h.past.length).toBeLessThanOrEqual(100)
  })
})
