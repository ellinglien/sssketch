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
  // anymore. SET_ARRANGER_MODE/SET_AUTOMATION_PARAM are what's left in
  // TRANSIENT_ACTION_TYPES, covered below.
  it('does not push history for transient UI-mode actions', () => {
    let h = createHistoryState(initialState)
    h = historyReducer(h, { type: 'ADD_TO_SHELF', rifff })
    const pastLengthAfterRealEdit = h.past.length
    h = historyReducer(h, { type: 'SET_ARRANGER_MODE', mode: 'sketch' })
    h = historyReducer(h, { type: 'SET_AUTOMATION_PARAM', laneId: 'r1:1', param: 'volume' })
    expect(h.past).toHaveLength(pastLengthAfterRealEdit)
    expect(h.present.mode).toBe('sketch')
    expect(h.present.automationParamOf['r1:1']).toBe('volume')
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
    h = historyReducer(h, { type: 'SET_ARRANGER_MODE', mode: 'automation' }) // transient, no new checkpoint
    h = historyReducer(h, { type: 'SET_TEMPO', bpm: 100 }) // real edit, checkpoints the mode='automation' state
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

  it('does not push history for SET_GATED_RECORDING_TARGET', () => {
    let h = createHistoryState(initialState)
    h = historyReducer(h, { type: 'ADD_TO_SHELF', rifff })
    const pastLengthAfterRealEdit = h.past.length
    h = historyReducer(h, { type: 'SET_GATED_RECORDING_TARGET', groupId: 'r1' })
    expect(h.past).toHaveLength(pastLengthAfterRealEdit)
    expect(h.present.gatedRecordingTargetGroupId).toBe('r1')
  })

  it('does not push history for SET_PENDING_LOCK_IN_CONFIRM', () => {
    let h = createHistoryState(initialState)
    h = historyReducer(h, { type: 'ADD_TO_SHELF', rifff })
    const pastLengthAfterRealEdit = h.past.length
    h = historyReducer(h, { type: 'SET_PENDING_LOCK_IN_CONFIRM', pending: true })
    expect(h.past).toHaveLength(pastLengthAfterRealEdit)
    expect(h.present.pendingLockInConfirm).toBe(true)
  })

  it('DOES push history for ADD_STEM_TO_RIFFF -- it is a real, undo-able edit', () => {
    let h = createHistoryState(initialState)
    h = historyReducer(h, { type: 'ADD_TO_SHELF', rifff })
    const pastLengthAfterRealEdit = h.past.length
    h = historyReducer(h, {
      type: 'ADD_STEM_TO_RIFFF',
      groupId: 'r1',
      stem: {
        slot: 7,
        author: '',
        name: 'take',
        type: 'audioIn',
        path: '/x.wav',
        durationSec: 4,
        barLength: 4
      }
    })
    expect(h.past.length).toBeGreaterThan(pastLengthAfterRealEdit)
    expect(h.present.rifffs.r1.stems).toHaveLength(2)
    h = historyReducer(h, { type: 'UNDO' })
    expect(h.present.rifffs.r1.stems).toHaveLength(1)
  })

  it('DOES push history for PLACE_LOOP_ON_TIMELINE, and it is exactly one undo step for however many stems the loop has', () => {
    let h = createHistoryState(initialState)
    const pastLengthAfterInitial = h.past.length
    h = historyReducer(h, {
      type: 'PLACE_LOOP_ON_TIMELINE',
      startBar: 0,
      stems: [
        {
          groupId: 'a',
          name: 'a',
          bpm: 120,
          barLength: 4,
          folderPath: '',
          stems: [
            {
              slot: 1,
              author: 'elling',
              name: 'a.wav',
              path: '/tmp/a.wav',
              type: 'drums',
              durationSec: 2,
              barLength: 4
            }
          ]
        },
        {
          groupId: 'b',
          name: 'b',
          bpm: 120,
          barLength: 4,
          folderPath: '',
          stems: [
            {
              slot: 1,
              author: 'elling',
              name: 'b.wav',
              path: '/tmp/b.wav',
              type: 'bass',
              durationSec: 2,
              barLength: 4
            }
          ]
        },
        {
          groupId: 'c',
          name: 'c',
          bpm: 120,
          barLength: 4,
          folderPath: '',
          stems: [
            {
              slot: 1,
              author: 'elling',
              name: 'c.wav',
              path: '/tmp/c.wav',
              type: 'notes',
              durationSec: 2,
              barLength: 4
            }
          ]
        }
      ]
    })
    expect(h.past.length).toBe(pastLengthAfterInitial + 1)
    expect(Object.keys(h.present.rifffs)).toHaveLength(3)
    h = historyReducer(h, { type: 'UNDO' })
    expect(Object.keys(h.present.rifffs)).toHaveLength(0)
  })

  it('caps history length rather than growing unboundedly', () => {
    let h = createHistoryState(initialState)
    for (let i = 0; i < 150; i++) {
      h = historyReducer(h, { type: 'SET_TEMPO', bpm: 80 + (i % 40) })
    }
    expect(h.past.length).toBeLessThanOrEqual(100)
  })
})

// BATCH -- folds an arbitrary list of Actions through the same reducer but
// pushes exactly ONE checkpoint for the whole group, for any caller (e.g.
// an auto-arrange/Draw-Arrangement "apply") that dispatches several real
// edits as one logical operation and wants undo to treat it as one step.
describe('historyReducer BATCH', () => {
  it('applies every wrapped action, producing the same present state as dispatching them one at a time', () => {
    const start = createHistoryState(initialState)
    const batched = historyReducer(start, {
      type: 'BATCH',
      actions: [{ type: 'SET_TEMPO', bpm: 140 }, { type: 'TOGGLE_TIDIED_VIEW' }]
    })

    let sequential = start
    sequential = historyReducer(sequential, { type: 'SET_TEMPO', bpm: 140 })
    sequential = historyReducer(sequential, { type: 'TOGGLE_TIDIED_VIEW' })

    expect(batched.present).toEqual(sequential.present)
  })

  it('pushes exactly ONE past entry for the whole batch, not one per wrapped action', () => {
    const start = createHistoryState(initialState)
    const batched = historyReducer(start, {
      type: 'BATCH',
      actions: [
        { type: 'SET_TEMPO', bpm: 121 },
        { type: 'SET_TEMPO', bpm: 122 },
        { type: 'SET_TEMPO', bpm: 123 }
      ]
    })
    expect(batched.past).toHaveLength(1)
    expect(batched.past[0]).toEqual(start.present)
  })

  it('one UNDO after a batch restores the exact pre-batch state, not just the last wrapped action undone', () => {
    const start = createHistoryState(initialState)
    const batched = historyReducer(start, {
      type: 'BATCH',
      actions: [{ type: 'SET_TEMPO', bpm: 140 }, { type: 'TOGGLE_TIDIED_VIEW' }]
    })
    const undone = historyReducer(batched, { type: 'UNDO' })
    expect(undone.present.bpm).toBe(80)
    expect(undone.present.tidiedView).toBe(false)
    expect(undone.past).toHaveLength(0)
  })

  it('clears future, same as any other tracked action', () => {
    const start = createHistoryState(initialState)
    const afterOneEdit = historyReducer(start, { type: 'SET_TEMPO', bpm: 110 })
    const afterUndo = historyReducer(afterOneEdit, { type: 'UNDO' })
    expect(afterUndo.future).toHaveLength(1)
    const afterBatch = historyReducer(afterUndo, {
      type: 'BATCH',
      actions: [{ type: 'SET_TEMPO', bpm: 130 }]
    })
    expect(afterBatch.future).toHaveLength(0)
  })

  it("a batch containing a normally-transient action type still counts toward the batch's single checkpoint, not silently dropped", () => {
    const start = createHistoryState({ ...initialState, mode: 'sketch' })
    const batched = historyReducer(start, {
      type: 'BATCH',
      actions: [
        { type: 'SET_TEMPO', bpm: 105 },
        // SET_ARRANGER_MODE is in TRANSIENT_ACTION_TYPES -- dispatched on
        // its own it wouldn't push a checkpoint at all. Inside a batch, it
        // must still be APPLIED (present.mode changes), just without
        // contributing a SEPARATE checkpoint of its own.
        { type: 'SET_ARRANGER_MODE', mode: 'normal' }
      ]
    })
    expect(batched.present.mode).toBe('normal')
    expect(batched.present.bpm).toBe(105)
    expect(batched.past).toHaveLength(1)
  })

  it('an empty actions array is a no-op that still pushes a checkpoint (present unchanged)', () => {
    const start = createHistoryState(initialState)
    const batched = historyReducer(start, { type: 'BATCH', actions: [] })
    expect(batched.present).toEqual(start.present)
    expect(batched.past).toHaveLength(1)
  })
})

describe('automation undo granularity', () => {
  it('pushes one checkpoint per completed gesture, and undo restores the previous curve', () => {
    let h = createHistoryState(initialState)
    h = historyReducer(h, {
      type: 'SET_STEM_AUTOMATION',
      stemKey: 'r1:0',
      param: 'filterCutoff',
      points: [{ bar: 0, value: 0.2 }]
    })
    h = historyReducer(h, {
      type: 'SET_STEM_AUTOMATION',
      stemKey: 'r1:0',
      param: 'filterCutoff',
      points: [
        { bar: 0, value: 0.2 },
        { bar: 4, value: 1 }
      ]
    })
    expect(h.past).toHaveLength(2)
    h = historyReducer(h, { type: 'UNDO' })
    expect(h.present.stemAutomation['r1:0'].filterCutoff).toEqual([{ bar: 0, value: 0.2 }])
    h = historyReducer(h, { type: 'UNDO' })
    expect(h.present.stemAutomation['r1:0']).toBeUndefined()
  })

  it('does not checkpoint the lane parameter picker -- that is a view, not an edit', () => {
    let h = createHistoryState(initialState)
    h = historyReducer(h, { type: 'SET_AUTOMATION_PARAM', laneId: 'r1:0', param: 'volume' })
    expect(h.past).toHaveLength(0)
    expect(h.present.automationParamOf['r1:0']).toBe('volume')
  })
})

describe('the guided flow across undo/redo', () => {
  const T0 = 1_700_000_000_000

  /** One resolved Discover slot, which is all lockCoachClimax needs to have
   * something real to freeze. */
  const resolvedSlot = {
    id: 's1',
    kinds: ['bass'] as const,
    stem: {
      path: '/bass.wav',
      name: 'bass',
      author: 'e',
      type: 'bass' as const,
      durationSec: 8,
      barLength: 8
    },
    gain: 1,
    audible: true,
    rolling: false
  }

  it('never rewinds the flow -- the locked climax and the current step survive an undo', () => {
    // Every COACH_* action is transient (no checkpoint of its own), but
    // `coach` is an ordinary AppState field, so it rides inside every
    // snapshot ANY other action pushes. Left unhandled, undoing an
    // ordinary edit made DURING the flow walks sssketchy back to whatever
    // step he was on when that checkpoint was taken -- throwing away the
    // locked climax, which is the material phase two carves from. Same
    // treatment, and the same reasoning, as armedChannelId above.
    let h = createHistoryState(initialState)
    h = historyReducer(h, { type: 'COACH_START', now: T0 })
    h = historyReducer(h, { type: 'COACH_SET_FLAVOUR', now: T0, flavour: 'groove', slots: [] })
    // An ordinary tracked edit made mid-flow: this is the checkpoint that
    // captures the flow standing on an early phase-one step.
    h = historyReducer(h, { type: 'ADD_TO_SHELF', rifff })
    let guard = 0
    while (h.present.coach?.stepId !== 'p1-lock') {
      h = historyReducer(h, { type: 'COACH_ADVANCE', now: T0, outcome: 'done' })
      expect((guard += 1)).toBeLessThan(20)
    }
    h = historyReducer(h, {
      type: 'COACH_LOCK_CLIMAX',
      now: T0,
      slots: [resolvedSlot],
      bpm: 120
    })
    expect(h.present.coach?.lockedClimax?.stems).toHaveLength(1)

    h = historyReducer(h, { type: 'UNDO' })
    expect(h.present.rifffs.r1).toBeUndefined() // the clip edit really was undone
    expect(h.present.coach?.stepId).toBe('p1-lock') // ...but the flow did not rewind
    expect(h.present.coach?.lockedClimax?.stems).toHaveLength(1)
    expect(h.present.coach?.flavour).toBe('groove')

    h = historyReducer(h, { type: 'REDO' })
    expect(h.present.rifffs.r1).toBeDefined()
    expect(h.present.coach?.stepId).toBe('p1-lock')
    expect(h.present.coach?.lockedClimax?.stems).toHaveLength(1)
  })

  it('DOES rewind the placed sections, because those are the work and not the flow', () => {
    // The converse of pinning. A section placement is deliberately an
    // ordinary undoable edit, so if `coach.sections` were pinned along with
    // the rest of the flow, undoing one would strip its clips off the
    // timeline while sssketchy still listed the section -- and the next
    // section's start bar is computed from that list, so the following
    // section would land in the gap the undo had just opened.
    let h = createHistoryState(initialState)
    h = historyReducer(h, { type: 'COACH_START', now: T0 })
    // A tracked edit BEFORE the section exists, so there is a checkpoint to
    // walk back to that predates it. (COACH_START is transient and pushes
    // none of its own.)
    h = historyReducer(h, { type: 'ADD_TO_SHELF', rifff })
    const withSection = {
      ...h.present,
      coach:
        h.present.coach === null
          ? null
          : {
              ...h.present.coach,
              sections: [
                {
                  type: 'intro' as const,
                  name: 'intro',
                  bars: 8,
                  // Empty: everything on. The full climax loop played in
                  // this section, which is the everything-on rule as data.
                  droppedPaths: [],
                  startBar: 0,
                  placedGroupIds: { '/bass.wav': 'g1' }
                }
              ]
            }
    }
    h = { ...h, present: withSection }
    // An ordinary tracked edit AFTER the section: its checkpoint captures
    // the flow with that section already recorded.
    h = historyReducer(h, { type: 'SET_TEMPO', bpm: 100 })
    expect(h.present.coach?.sections).toHaveLength(1)

    h = historyReducer(h, { type: 'UNDO' })
    // The step and the flow itself survive...
    expect(h.present.coach).not.toBeNull()
    // ...and so does the section, because this undo walked back past a
    // tempo change, not past the section placement.
    expect(h.present.coach?.sections).toHaveLength(1)

    h = historyReducer(h, { type: 'UNDO' })
    // This one DOES cross the point before the section existed.
    expect(h.present.coach).not.toBeNull()
    expect(h.present.coach?.sections).toHaveLength(0)

    h = historyReducer(h, { type: 'REDO' })
    expect(h.present.coach?.sections).toHaveLength(1)
  })

  it('never makes sssketchy vanish mid-flow by undoing past the moment he started', () => {
    let h = createHistoryState(initialState)
    h = historyReducer(h, { type: 'ADD_TO_SHELF', rifff }) // checkpoint taken with no flow at all
    h = historyReducer(h, { type: 'COACH_START', now: T0 })
    h = historyReducer(h, { type: 'SET_TEMPO', bpm: 100 })

    h = historyReducer(h, { type: 'UNDO' })
    expect(h.present.coach).not.toBeNull()
    h = historyReducer(h, { type: 'UNDO' })
    expect(h.present.rifffs.r1).toBeUndefined()
    expect(h.present.coach).not.toBeNull() // he is still on screen, mid-step
  })
})

describe('the phase-three flow bookkeeping', () => {
  const T3 = 1_700_000_000_000

  it('does not checkpoint on its own', () => {
    const started = historyReducer(createHistoryState(initialState), {
      type: 'COACH_START',
      now: T3
    })
    const after = historyReducer(started, { type: 'COACH_MARK_V1_EXPORTED', now: T3 + 1000 })
    expect(after.past.length).toBe(started.past.length)
  })

  it('rewinds the applied tension, because that IS the work -- like sections', () => {
    // `tension` names real timeline material: a curve on a section's clips,
    // or a riser clip. Both go out in the same BATCH as the
    // COACH_APPLY_TENSION that records them, so undoing the batch takes the
    // material off -- and if `tension` were pinned along with the rest of
    // the flow, the panel would keep showing that toggle ON over a curve
    // that is no longer there. Same trade, and same answer, as `sections`.
    let h = createHistoryState(initialState)
    h = historyReducer(h, { type: 'COACH_START', now: T3 })
    h = historyReducer(h, { type: 'ADD_TO_SHELF', rifff })
    h = {
      ...h,
      present: {
        ...h.present,
        coach:
          h.present.coach === null
            ? null
            : {
                ...h.present.coach,
                tension: [{ sectionIndex: 0, kind: 'filter-sweep' as const, riserId: null }]
              }
      }
    }
    h = historyReducer(h, { type: 'SET_TEMPO', bpm: 100 })
    expect(h.present.coach?.tension).toHaveLength(1)

    h = historyReducer(h, { type: 'UNDO' })
    // Walked back past a tempo change, not past the toggle: still on.
    expect(h.present.coach?.tension).toHaveLength(1)

    h = historyReducer(h, { type: 'UNDO' })
    // This one crosses the point before the toggle existed.
    expect(h.present.coach).not.toBeNull()
    expect(h.present.coach?.tension).toHaveLength(0)

    h = historyReducer(h, { type: 'REDO' })
    expect(h.present.coach?.tension).toHaveLength(1)
  })

  it('never rewinds the v1 mark -- no undo takes a written file back off disk', () => {
    let h = createHistoryState(initialState)
    h = historyReducer(h, { type: 'COACH_START', now: T3 })
    h = historyReducer(h, { type: 'ADD_TO_SHELF', rifff })
    h = historyReducer(h, { type: 'COACH_MARK_V1_EXPORTED', now: T3 + 1000 })
    h = historyReducer(h, { type: 'SET_TEMPO', bpm: 100 })

    h = historyReducer(h, { type: 'UNDO' })
    expect(h.present.coach?.v1ExportedAt).toBe(T3 + 1000)
    h = historyReducer(h, { type: 'UNDO' })
    expect(h.present.coach?.v1ExportedAt).toBe(T3 + 1000)
  })
})
