import { describe, expect, it } from 'vitest'
import { initialState, reducer } from './store'
import {
  resolveOffsetKey,
  resolvePlayedBars,
  clipGeometry,
  stemGeometry,
  stemStartBar,
  stretchRatio,
  loopLengthBars,
  offsetStepsForBeatIndex,
  rotationSecondsForStem,
  pasteRifffAction,
  placedRifffsInOrder,
  channelMuteLetters
} from './selectors'
import type { Rifff, Stem } from '@shared/types'

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

describe('resolveOffsetKey', () => {
  it('returns the groupId when linked', () => {
    const state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff })
    expect(resolveOffsetKey(state, 'r1', 1)).toBe('r1')
  })
  it('returns the stem key when unlinked', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff })
    state = reducer(state, { type: 'UNLINK', groupId: 'r1' })
    expect(resolveOffsetKey(state, 'r1', 1)).toBe('r1:1')
  })
})

describe('channelMuteLetters', () => {
  it("assigns one channel per stem, in stems-array order (matching RifffBlockRow's own render order), while a rifff is expanded", () => {
    const stems: Stem[] = [
      { slot: 6, author: 'e', name: 'b', type: 'fx', path: '/b.wav', durationSec: 1, barLength: 8 },
      { slot: 1, author: 'e', name: 'a', type: 'fx', path: '/a.wav', durationSec: 1, barLength: 8 }
    ]
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: { ...rifff, stems } })
    state = { ...state, exp: { r1: true } }
    expect(channelMuteLetters(state)).toEqual({ 'r1:6': 'q', 'r1:1': 'w' })
  })

  it('assigns a single whole-group channel while a rifff is collapsed', () => {
    const state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff })
    expect(channelMuteLetters(state)).toEqual({ r1: 'q' })
  })

  it('numbers channels globally across every placed rifff, not reset per rifff', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff })
    state = reducer(state, { type: 'ADD_TO_SHELF', rifff: { ...rifff, groupId: 'r2' } })
    // Both collapsed (default): r1 gets one channel, r2 gets the next.
    expect(channelMuteLetters(state)).toEqual({ r1: 'q', r2: 'w' })
  })

  it('excludes rifffs still sitting in the shelf, unplaced', () => {
    const unplaced: Rifff = { ...rifff, startBar: undefined }
    const state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: unplaced })
    expect(channelMuteLetters(state)).toEqual({})
  })

  it('leaves channels beyond the 10-key row without a shortcut', () => {
    let state = initialState
    for (let i = 0; i < 12; i++) {
      state = reducer(state, { type: 'ADD_TO_SHELF', rifff: { ...rifff, groupId: `r${i}` } })
    }
    const letters = channelMuteLetters(state)
    expect(Object.keys(letters)).toHaveLength(10)
    expect(letters.r10).toBeUndefined()
    expect(letters.r11).toBeUndefined()
  })

  it('returns no channels at all in compact mode, which has no mixing controls', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff })
    state = { ...state, compactMode: true }
    expect(channelMuteLetters(state)).toEqual({})
  })
})

describe('resolvePlayedBars', () => {
  it('falls back to rifff.barLength when unset', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 4 })
    expect(resolvePlayedBars(state, 'r1', 1)).toBe(8)
  })

  it('uses the group-shared value while linked', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 4 })
    const withOverride = { ...state, playedBars: { r1: 16 } }
    expect(resolvePlayedBars(withOverride, 'r1', 1)).toBe(16)
  })

  it('uses the per-stem value while unlinked', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 4 })
    state = reducer(state, { type: 'UNLINK', groupId: 'r1' })
    const withOverride = { ...state, playedBars: { 'r1:1': 20 } }
    expect(resolvePlayedBars(withOverride, 'r1', 1)).toBe(20)
  })
})

describe('stretchRatio', () => {
  it('is projectBpm / rifffBpm', () => {
    const state = { ...reducer(initialState, { type: 'ADD_TO_SHELF', rifff }), bpm: 75 }
    expect(stretchRatio(state, 'r1')).toBeCloseTo(0.5, 10)
  })
})

describe('clipGeometry', () => {
  it('positions a clip at startBar * ppb with no offset, full width when stretched', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 4 })
    const geo = clipGeometry(state, 'r1', 24)
    expect(geo.leftPx).toBe(96) // 4 * 24
    expect(geo.widthPx).toBe(192) // 8 bars * 24, stretched to project length
  })

  it('shrinks/grows width when stretch is off, following native bar length', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
    state = { ...state, bpm: 75, stretch: { ...state.stretch, r1: false } }
    const geo = clipGeometry(state, 'r1', 24)
    // native length drifts: barLength * (rifffBpm / projectBpm) = 8 * (150/75) = 16 bars
    expect(geo.widthPx).toBe(384)
  })

  it('shifts left by the grid-step offset', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
    state = reducer(state, { type: 'NUDGE_OFFSET', key: 'r1', delta: 4 }) // +4/16 steps
    const geo = clipGeometry(state, 'r1', 24)
    // offsetPx = steps * ppb / snapDiv = 4 * 24 / 16 = 6
    expect(geo.leftPx).toBe(6)
  })
})

describe('stemStartBar / stemGeometry', () => {
  it('follows the group startBar while linked', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 4 })
    expect(stemStartBar(state, 'r1', 1)).toBe(4)
  })

  it('still follows the group startBar right after unlinking, before any drag', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 4 })
    state = reducer(state, { type: 'UNLINK', groupId: 'r1' })
    expect(stemStartBar(state, 'r1', 1)).toBe(4)
  })

  it('diverges from the group once unlinked and dragged', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 4 })
    state = reducer(state, { type: 'UNLINK', groupId: 'r1' })
    state = reducer(state, { type: 'SET_STEM_START', key: 'r1:1', startBar: 12 })
    expect(stemStartBar(state, 'r1', 1)).toBe(12)
    // the group itself is untouched
    expect(state.rifffs.r1.startBar).toBe(4)
  })

  it('a drag is ignored again after relinking', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 4 })
    state = reducer(state, { type: 'UNLINK', groupId: 'r1' })
    state = reducer(state, { type: 'SET_STEM_START', key: 'r1:1', startBar: 12 })
    state = reducer(state, { type: 'RELINK', groupId: 'r1' })
    expect(stemStartBar(state, 'r1', 1)).toBe(4)
  })

  it('stemGeometry reflects the diverged position in leftPx', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
    state = reducer(state, { type: 'UNLINK', groupId: 'r1' })
    state = reducer(state, { type: 'SET_STEM_START', key: 'r1:1', startBar: 5 })
    const geo = stemGeometry(state, 'r1', 1, 24)
    expect(geo.leftPx).toBe(120) // 5 * 24
  })
})

describe('stemGeometry width with a playedBars override', () => {
  it('reflects the resolved playedBars, not rifff.barLength', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 4 })
    state = reducer(state, { type: 'UNLINK', groupId: 'r1' })
    const withOverride = { ...state, playedBars: { 'r1:1': 16 } }
    const geo = stemGeometry(withOverride, 'r1', 1, 24)
    expect(geo.widthPx).toBe(16 * 24) // 16 bars at ppb=24, stretch stays on
  })
})

describe('loopLengthBars', () => {
  it('falls back to the default when nothing is placed on the timeline', () => {
    expect(loopLengthBars(initialState)).toBe(32)
  })

  it('fits to the latest end bar among placed clips', () => {
    const second: Rifff = { ...rifff, groupId: 'r2', barLength: 4 }
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff })
    state = reducer(state, { type: 'ADD_TO_SHELF', rifff: second })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 2 }) // ends at 10
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r2', startBar: 20 }) // ends at 24
    expect(loopLengthBars(state)).toBe(24)
  })

  it('ignores rifffs still sitting in the shelf, unplaced', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff })
    const shelfOnly: Rifff = { ...rifff, groupId: 'r2', barLength: 200, startBar: undefined }
    state = reducer(state, { type: 'ADD_TO_SHELF', rifff: shelfOnly })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 }) // ends at 8
    expect(loopLengthBars(state)).toBe(8)
  })

  it('extends to cover an unlinked stem dragged past the group’s own span', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff }) // barLength 8
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 }) // ends at 8
    state = reducer(state, { type: 'UNLINK', groupId: 'r1' })
    state = reducer(state, { type: 'SET_STEM_START', key: 'r1:1', startBar: 20 }) // ends at 28
    expect(loopLengthBars(state)).toBe(28)
  })
})

describe('loopLengthBars with a playedBars override', () => {
  it('extends the loop for a linked group resized beyond rifff.barLength', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 4 })
    const withOverride = { ...state, playedBars: { r1: 16 } } // rifff.barLength is 8
    expect(loopLengthBars(withOverride)).toBe(rifff.startBar! + 16)
  })

  it('extends the loop for an unlinked stem resized beyond rifff.barLength', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 4 })
    state = reducer(state, { type: 'UNLINK', groupId: 'r1' })
    const withOverride = { ...state, playedBars: { 'r1:1': 20 } }
    expect(loopLengthBars(withOverride)).toBe(rifff.startBar! + 20)
  })
})

describe('placedRifffsInOrder', () => {
  // The shared `rifff` fixture above has startBar: 4 baked in (used by other
  // describe blocks that want an already-placed clip) — unsuitable here,
  // since these tests need genuinely unplaced-then-placed transitions to
  // exercise trackOrder. Each test below starts from its own startBar:
  // undefined copy instead.
  const unplaced: Rifff = { ...rifff, startBar: undefined }

  it('orders placed rifffs by trackOrder, not object-insertion order', () => {
    const second: Rifff = { ...unplaced, groupId: 'r2' }
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: unplaced }) // r1 added first
    state = reducer(state, { type: 'ADD_TO_SHELF', rifff: second })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r2', startBar: 0 }) // r2 placed first
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 8 })
    expect(placedRifffsInOrder(state).map((r) => r.groupId)).toEqual(['r2', 'r1'])
  })

  it('falls back to object order for a placed rifff missing from trackOrder (old save)', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: unplaced })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
    // Simulates a project saved before trackOrder existed — the field is empty
    // even though a rifff is placed.
    const legacyState = { ...state, trackOrder: [] }
    expect(placedRifffsInOrder(legacyState).map((r) => r.groupId)).toEqual(['r1'])
  })

  it('excludes unplaced rifffs even if they linger in trackOrder', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: unplaced })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
    state = reducer(state, { type: 'REMOVE_FROM_TIMELINE', groupId: 'r1' })
    expect(placedRifffsInOrder(state)).toEqual([])
  })
})

describe('offsetStepsForBeatIndex', () => {
  it('is zero for beat 0 — already on the downbeat', () => {
    expect(offsetStepsForBeatIndex(0, 4)).toBe(0)
  })

  it('shifts earlier (negative) as the clicked beat moves later into the buffer', () => {
    // snapDiv 4 == one step per beat, so beat 2 in should shift the clip 2 steps earlier
    expect(offsetStepsForBeatIndex(2, 4)).toBe(-2)
  })

  it('scales with a finer snap grid', () => {
    // snapDiv 16 == 4 steps per beat
    expect(offsetStepsForBeatIndex(2, 16)).toBe(-8)
  })
})

describe('rotationSecondsForStem', () => {
  const stem: Stem = {
    slot: 1,
    author: 'e',
    name: 'a',
    type: 'fx',
    path: '/a.wav',
    durationSec: 16, // 8 bars @ 2 sec/bar
    barLength: 8
  }

  it('is zero offset -> zero rotation', () => {
    expect(rotationSecondsForStem(0, 4, stem)).toBe(0)
  })

  it('inverts offsetStepsForBeatIndex — picking beat 2 rotates by 2 beats of native time', () => {
    const steps = offsetStepsForBeatIndex(2, 4) // -2
    // 2 beats @ 4 beats/bar = 0.5 bar; 0.5 bar * 2 sec/bar = 1s
    expect(rotationSecondsForStem(steps, 4, stem)).toBeCloseTo(1, 10)
  })

  it('wraps by the stem’s own (shorter, tiling) bar length, not the rifff’s', () => {
    // A 2-bar stem tiling within a group whose offset implies 0.5 bar of shift —
    // 0.5 bar is already within its own loop, so no wrapping needed here; but the
    // conversion to seconds must use the 2-bar stem's own sec/bar, not the 8-bar one.
    const shortStem: Stem = { ...stem, durationSec: 4, barLength: 2 } // 2 sec/bar, same as above
    const steps = offsetStepsForBeatIndex(2, 4) // -2, implies 0.5 bar
    expect(rotationSecondsForStem(steps, 4, shortStem)).toBeCloseTo(1, 10)
  })

  it('wraps a rotation larger than the stem’s own loop length', () => {
    // offsetSteps implying 3 bars of shift, but this stem only loops every 2 bars —
    // 3 % 2 = 1 bar's worth of rotation, at 2 sec/bar = 2s.
    const shortStem: Stem = { ...stem, durationSec: 4, barLength: 2 }
    const steps = offsetStepsForBeatIndex(12, 4) // 12 beats = 3 bars
    expect(rotationSecondsForStem(steps, 4, shortStem)).toBeCloseTo(2, 10)
  })
})

describe('pasteRifffAction', () => {
  const twoStemRifff: Rifff = {
    groupId: 'r1',
    name: 'test',
    bpm: 150,
    barLength: 8,
    folderPath: '/x',
    startBar: 4,
    stems: [
      { slot: 1, author: 'e', name: 'a', type: 'fx', path: '/a.wav', durationSec: 1, barLength: 8 },
      {
        slot: 2,
        author: 'e',
        name: 'b',
        type: 'bass',
        path: '/b.wav',
        durationSec: 1,
        barLength: 8
      }
    ]
  }

  it('returns null when the source no longer exists', () => {
    expect(pasteRifffAction(initialState, 'missing', 0)).toBeNull()
  })

  it('builds a PASTE_RIFFF action with a fresh groupId at the requested startBar', () => {
    const state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: twoStemRifff })
    const action = pasteRifffAction(state, 'r1', 20)
    expect(action?.type).toBe('PASTE_RIFFF')
    if (action?.type !== 'PASTE_RIFFF') throw new Error('expected PASTE_RIFFF')
    expect(action.rifff.groupId).not.toBe('r1')
    expect(action.rifff.startBar).toBe(20)
    expect(action.rifff.stems.map((s) => s.path)).toEqual(['/a.wav', '/b.wav'])
  })

  it('carries over volume, mute, group offset, and stretch, keyed to the new groupId', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: twoStemRifff })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 4 }) // stretch -> true
    state = reducer(state, { type: 'SET_VOLUME', stemKey: 'r1:1', volume: 0.4 })
    state = reducer(state, { type: 'TOGGLE_MUTE', stemKey: 'r1:2' })
    state = reducer(state, { type: 'SET_OFFSET_STEPS', key: 'r1', steps: 3 })
    state = reducer(state, { type: 'TOGGLE_STRETCH', groupId: 'r1' }) // true -> false

    const action = pasteRifffAction(state, 'r1', 0)
    if (action?.type !== 'PASTE_RIFFF') throw new Error('expected PASTE_RIFFF')
    const newGroupId = action.rifff.groupId
    expect(action.vol[`${newGroupId}:1`]).toBe(0.4)
    expect(action.mute[`${newGroupId}:2`]).toBe(true)
    expect(action.off[newGroupId]).toBe(3)
    expect(action.stretch).toBe(false)
  })

  it('applying the action creates an independent, selected copy, not forced expanded', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: twoStemRifff })
    const action = pasteRifffAction(state, 'r1', 20)
    if (!action) throw new Error('expected an action')
    state = reducer(state, action)

    const newGroupId = action.type === 'PASTE_RIFFF' ? action.rifff.groupId : ''
    expect(state.rifffs[newGroupId]).toBeDefined()
    expect(state.rifffs[newGroupId].startBar).toBe(20)
    expect(state.rifffs.r1.startBar).toBe(4) // original untouched
    expect(state.sel).toBe(newGroupId)
    expect(state.exp[newGroupId]).toBeUndefined()
  })
})
