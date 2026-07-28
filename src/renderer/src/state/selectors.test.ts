import { describe, expect, it } from 'vitest'
import { initialState, reducer } from './store'
import {
  resolveOffsetKey,
  clipGeometry,
  stretchRatio,
  loopLengthBars,
  offsetStepsForBeatIndex
} from './selectors'
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
