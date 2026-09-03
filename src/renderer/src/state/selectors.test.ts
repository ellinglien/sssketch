import { describe, expect, it } from 'vitest'
import { initialState, reducer } from './store'
import {
  resolvePlayedBars,
  resolvedPlayedBarsFromFields,
  clipGeometry,
  clipGeometryFromFields,
  stretchRatio,
  loopLengthBars,
  placedTimelineSpanBars,
  offsetStepsForBeatIndex,
  rotationSecondsForStem,
  pasteRifffAction,
  pasteStemAction,
  placedRifffsInOrder,
  channelsInOrder,
  isSketchEligible,
  nextArrangerMode,
  groupIdAtPosition,
  tileOffsetsPx
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

describe('resolvedPlayedBarsFromFields', () => {
  it('returns the override when one is set', () => {
    expect(resolvedPlayedBarsFromFields(12, 8)).toBe(12)
  })

  it('falls back to the rifff bar length when no override is set', () => {
    expect(resolvedPlayedBarsFromFields(undefined, 8)).toBe(8)
  })
})

describe('resolvePlayedBars', () => {
  it('falls back to rifff.barLength when unset', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 4 })
    expect(resolvePlayedBars(state, 'r1')).toBe(8)
  })

  it('uses the resize override once one is set', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 4 })
    const withOverride = { ...state, playedBars: { r1: 16 } }
    expect(resolvePlayedBars(withOverride, 'r1')).toBe(16)
  })
})

describe('stretchRatio', () => {
  it('is projectBpm / rifffBpm', () => {
    const state = { ...reducer(initialState, { type: 'ADD_TO_SHELF', rifff }), bpm: 75 }
    expect(stretchRatio(state, 'r1')).toBeCloseTo(0.5, 10)
  })
})

describe('clipGeometryFromFields', () => {
  it('matches clipGeometry exactly for a plain, unstretched-off, no-offset clip', () => {
    const bars = clipGeometryFromFields({
      startBar: 4,
      offsetSteps: 0,
      snapDiv: 4,
      playedBarsOverride: undefined,
      leftCropBars: 0,
      rifffBarLength: 8,
      stretchOn: true,
      rifffBpm: 150,
      stateBpm: 150,
      ppb: 24
    })
    expect(bars).toEqual({ leftPx: 96, widthPx: 192 })
  })

  it('applies the sub-bar nudge offset', () => {
    // offsetSteps=-8 at snapDiv=4 is -2 bars -> leftPx shifts by -2*24=-48
    const bars = clipGeometryFromFields({
      startBar: 4,
      offsetSteps: -8,
      snapDiv: 4,
      playedBarsOverride: undefined,
      leftCropBars: 0,
      rifffBarLength: 8,
      stretchOn: true,
      rifffBpm: 150,
      stateBpm: 150,
      ppb: 24
    })
    expect(bars.leftPx).toBe(96 - 48)
  })

  it('scales widthPx by the bpm ratio when stretch is off', () => {
    // stretch off: shownBars = playedBars * (rifffBpm/stateBpm) = 8 * (150/100) = 12
    const bars = clipGeometryFromFields({
      startBar: 0,
      offsetSteps: 0,
      snapDiv: 4,
      playedBarsOverride: undefined,
      leftCropBars: 0,
      rifffBarLength: 8,
      stretchOn: false,
      rifffBpm: 150,
      stateBpm: 100,
      ppb: 24
    })
    expect(bars.widthPx).toBe(12 * 24)
  })

  it('uses the playedBars override over the rifff bar length', () => {
    const bars = clipGeometryFromFields({
      startBar: 0,
      offsetSteps: 0,
      snapDiv: 4,
      playedBarsOverride: 16,
      leftCropBars: 0,
      rifffBarLength: 8,
      stretchOn: true,
      rifffBpm: 150,
      stateBpm: 150,
      ppb: 24
    })
    expect(bars.widthPx).toBe(16 * 24)
  })

  it('shrinks the width and shifts leftPx right when cropped from the left', () => {
    // leftCropBars=2 at ppb=24: leftPx shifts by +2*24=48, width shrinks by
    // the same 2 bars' worth of pixels.
    const bars = clipGeometryFromFields({
      startBar: 4,
      offsetSteps: 0,
      snapDiv: 4,
      playedBarsOverride: undefined,
      leftCropBars: 2,
      rifffBarLength: 8,
      stretchOn: true,
      rifffBpm: 150,
      stateBpm: 150,
      ppb: 24
    })
    expect(bars.leftPx).toBe(96 + 48) // (4+2)*24
    expect(bars.widthPx).toBe((8 - 2) * 24)
  })

  it('extends the width and shifts leftPx left when leftCropBars is negative', () => {
    const bars = clipGeometryFromFields({
      startBar: 4,
      offsetSteps: 0,
      snapDiv: 4,
      playedBarsOverride: undefined,
      leftCropBars: -1,
      rifffBarLength: 8,
      stretchOn: true,
      rifffBpm: 150,
      stateBpm: 150,
      ppb: 24
    })
    expect(bars.leftPx).toBe(96 - 24) // (4-1)*24
    expect(bars.widthPx).toBe((8 + 1) * 24)
  })
})

describe('tileOffsetsPx', () => {
  it('tiles from pixel 0 when there is no crop', () => {
    // 2 bars played, 1-bar stem, ppb=24 -> tileWidthPx=24, 2 tiles at [0, 24]
    expect(tileOffsetsPx(48, 1, 2, 0)).toEqual([0, 24])
  })

  it('shifts every tile left by the wrapped crop amount, so the correct mid-loop content lands at pixel 0', () => {
    // 1-bar stem, cropped 0.5 bars from the left, played to 2 bars total,
    // width = (2-0.5)*24 = 36. tileWidthPx = 36 * (1/1.5) = 24. Each tile
    // shifts left by 0.5 bars' worth of pixels: 0.5*24 = 12.
    expect(tileOffsetsPx(36, 1, 2, 0.5)).toEqual([-12, 12, 36])
  })

  it('wraps a crop amount larger than one stem bar into [0, stemBarLength)', () => {
    // leftCropBars=2.5 with a 1-bar stem wraps to 0.5 bars of phase shift --
    // same shift as the test above, despite a much larger raw crop amount.
    // playedBars=4.0 keeps visibleBars (4.0-2.5=1.5) and therefore
    // tileWidthPx identical to the test above, so the expected output is
    // the exact same array -- isolating "wrapping" as the only thing this
    // test is actually checking.
    expect(tileOffsetsPx(36, 1, 4.0, 2.5)).toEqual([-12, 12, 36])
  })

  it('wraps a negative crop amount into [0, stemBarLength) the same way', () => {
    // leftCropBars=-0.5 wraps to 0.5 bars too ((-0.5 % 1) + 1) % 1 = 0.5).
    // playedBars=1.0 again keeps visibleBars (1.0-(-0.5)=1.5) matching the
    // first test's own 1.5, for the same reason as above.
    expect(tileOffsetsPx(36, 1, 1.0, -0.5)).toEqual([-12, 12, 36])
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
    state = reducer(state, { type: 'SET_SNAP_IDX', snapIdx: 4 }) // 1/16, independent of the default
    state = reducer(state, { type: 'NUDGE_OFFSET', key: 'r1', delta: 4 }) // +4/16 steps
    const geo = clipGeometry(state, 'r1', 24)
    // offsetPx = steps * ppb / snapDiv = 4 * 24 / 16 = 6
    expect(geo.leftPx).toBe(6)
  })

  it('reflects a playedBars resize override, not just raw rifff.barLength', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 4 })
    const withOverride = { ...state, playedBars: { r1: 16 } } // rifff.barLength is 8
    const geo = clipGeometry(withOverride, 'r1', 24)
    expect(geo.widthPx).toBe(16 * 24)
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

describe('loopLengthBars with a playedBars override', () => {
  it('extends the loop for a rifff resized beyond rifff.barLength', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 4 })
    const withOverride = { ...state, playedBars: { r1: 16 } } // rifff.barLength is 8
    expect(loopLengthBars(withOverride)).toBe(rifff.startBar! + 16)
  })
})

describe('placedTimelineSpanBars', () => {
  it('is 0 when nothing is placed on the timeline, unlike loopLengthBars', () => {
    expect(placedTimelineSpanBars(initialState)).toBe(0)
  })

  it('fits to the latest end bar among placed clips', () => {
    const second: Rifff = { ...rifff, groupId: 'r2', barLength: 4 }
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff })
    state = reducer(state, { type: 'ADD_TO_SHELF', rifff: second })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 2 }) // ends at 10
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r2', startBar: 20 }) // ends at 24
    expect(placedTimelineSpanBars(state)).toBe(24)
  })

  it('ignores rifffs still sitting in the shelf, unplaced', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff })
    const shelfOnly: Rifff = { ...rifff, groupId: 'r2', barLength: 200, startBar: undefined }
    state = reducer(state, { type: 'ADD_TO_SHELF', rifff: shelfOnly })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 }) // ends at 8
    expect(placedTimelineSpanBars(state)).toBe(8)
  })
})

describe('placedRifffsInOrder', () => {
  // The shared `rifff` fixture above has startBar: 4 baked in (used by other
  // describe blocks that want an already-placed clip) — unsuitable here,
  // since these tests need genuinely unplaced-then-placed transitions to
  // exercise channelOrder. Each test below starts from its own startBar:
  // undefined copy instead.
  const unplaced: Rifff = { ...rifff, startBar: undefined }

  it('orders placed rifffs by channelOrder, not object-insertion order', () => {
    const second: Rifff = { ...unplaced, groupId: 'r2' }
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: unplaced }) // r1 added first
    state = reducer(state, { type: 'ADD_TO_SHELF', rifff: second })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r2', startBar: 0 }) // r2 placed first
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 8 })
    expect(placedRifffsInOrder(state).map((r) => r.groupId)).toEqual(['r2', 'r1'])
  })

  it('falls back to first-seen order for a placed rifff with no channel assignment', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: unplaced })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
    // Simulates a placed rifff that somehow has no channel entry — channelOf
    // and channelOrder both empty even though r1 is placed.
    const noChannel = { ...state, channelOf: {}, channelOrder: [] }
    expect(placedRifffsInOrder(noChannel).map((r) => r.groupId)).toEqual(['r1'])
  })

  it('excludes unplaced rifffs even if they linger in channelOrder', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: unplaced })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
    state = reducer(state, { type: 'REMOVE_FROM_TIMELINE', groupId: 'r1' })
    expect(placedRifffsInOrder(state)).toEqual([])
  })

  it('multiple clips on one channel all appear, in that channel’s own array order', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: unplaced })
    state = reducer(state, { type: 'ADD_TO_SHELF', rifff: { ...unplaced, groupId: 'r2' } })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r2', startBar: 4 })
    state = reducer(state, {
      type: 'MOVE_TO_CHANNEL',
      groupId: 'r2',
      startBar: 4,
      channelId: 'r1'
    })
    expect(placedRifffsInOrder(state).map((r) => r.groupId)).toEqual(['r1', 'r2'])
  })

  // placedRifffsInOrder is a thin flatMap over channelsInOrder's own output
  // (see its doc comment), so it inherits that selector's defensive dedup
  // for free rather than needing a second, separate guard -- this test
  // exercises that inheritance directly rather than assuming it.
  it('never returns a duplicate groupId even if channelOrder itself has a repeat', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: unplaced })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
    const withDuplicate = { ...state, channelOrder: [...state.channelOrder, 'r1'] }
    expect(placedRifffsInOrder(withDuplicate).map((r) => r.groupId)).toEqual(['r1'])
  })
})

describe('channelsInOrder', () => {
  it('groups clips sharing a channel into one Channel entry', () => {
    const unplaced: Rifff = { ...rifff, startBar: undefined }
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: unplaced })
    state = reducer(state, { type: 'ADD_TO_SHELF', rifff: { ...unplaced, groupId: 'r2' } })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r2', startBar: 4 })
    state = reducer(state, {
      type: 'MOVE_TO_CHANNEL',
      groupId: 'r2',
      startBar: 4,
      channelId: 'r1'
    })
    const channels = channelsInOrder(state)
    expect(channels).toHaveLength(1)
    expect(channels[0].channelId).toBe('r1')
    expect(channels[0].rifffs.map((r) => r.groupId)).toEqual(['r1', 'r2'])
  })

  it('includes a recording channel with no clips yet, with an empty rifffs array', () => {
    const state = reducer(initialState, { type: 'ADD_RECORDING_CHANNEL', channelId: 'rec-1' })
    const channels = channelsInOrder(state)
    expect(channels).toHaveLength(1)
    expect(channels[0].channelId).toBe('rec-1')
    expect(channels[0].rifffs).toEqual([])
  })

  // Defense-in-depth: reducers now guard against ever producing a duplicate
  // entry in channelOrder (see store.ts's ADD_RECORDING_CHANNEL/
  // SEQUENCE_RIFFFS tests), but this selector is what actually turns
  // channelOrder into the list App.tsx renders one <ChannelRow> per entry
  // from -- a duplicate here means two literal React elements for the same
  // channel, showing the same clips twice. Constructs a state with an
  // artificially duplicated channelOrder directly (rather than via the
  // reducer, which can no longer produce one) specifically to exercise this
  // selector's own dedup in isolation.
  it('never returns a duplicate channelId even if channelOrder itself has a repeat', () => {
    let state = reducer(initialState, {
      type: 'ADD_TO_SHELF',
      rifff: { ...rifff, startBar: undefined }
    })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
    const withDuplicate = { ...state, channelOrder: [...state.channelOrder, 'r1'] }
    const channels = channelsInOrder(withDuplicate)
    expect(channels.map((c) => c.channelId)).toEqual(['r1'])
  })

  it('keeps a recording channel visible after its only clip is removed from the timeline', () => {
    let state = reducer(initialState, { type: 'ADD_RECORDING_CHANNEL', channelId: 'rec-1' })
    const unplaced: Rifff = { ...rifff, startBar: undefined }
    state = reducer(state, { type: 'ADD_TO_SHELF', rifff: unplaced })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
    state = reducer(state, {
      type: 'MOVE_TO_CHANNEL',
      groupId: 'r1',
      startBar: 0,
      channelId: 'rec-1'
    })
    state = reducer(state, { type: 'REMOVE_FROM_TIMELINE', groupId: 'r1' })
    const channels = channelsInOrder(state)
    expect(channels).toHaveLength(1)
    expect(channels[0].channelId).toBe('rec-1')
    expect(channels[0].rifffs).toEqual([])
  })

  describe('with tidiedView on', () => {
    it('packs non-overlapping same-bus rifffs onto one shared row instead of one row each', () => {
      let state = reducer(initialState, {
        type: 'ADD_TO_SHELF',
        rifff: { ...rifff, startBar: undefined }
      })
      state = reducer(state, {
        type: 'ADD_TO_SHELF',
        rifff: { ...rifff, groupId: 'r2', startBar: undefined }
      })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r2', startBar: 8 }) // r1 is 8 bars long -- adjacent, not overlapping
      state = reducer(state, { type: 'ASSIGN_STEMS_TO_BUS', stemKeys: ['r1:1'], busId: 'drums' })
      state = reducer(state, { type: 'ASSIGN_STEMS_TO_BUS', stemKeys: ['r2:1'], busId: 'drums' })
      state = { ...state, tidiedView: true }

      const channels = channelsInOrder(state)
      expect(channels).toHaveLength(1)
      expect(channels[0].channelId).toBe('tidied:drums:0')
      expect(channels[0].rifffs.map((r) => r.groupId)).toEqual(['r1', 'r2'])
    })

    it('splits overlapping same-bus rifffs onto separate tidied rows', () => {
      let state = reducer(initialState, {
        type: 'ADD_TO_SHELF',
        rifff: { ...rifff, startBar: undefined }
      })
      state = reducer(state, {
        type: 'ADD_TO_SHELF',
        rifff: { ...rifff, groupId: 'r2', startBar: undefined }
      })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r2', startBar: 2 }) // overlaps r1 (bars [0,8))
      state = reducer(state, { type: 'ASSIGN_STEMS_TO_BUS', stemKeys: ['r1:1'], busId: 'drums' })
      state = reducer(state, { type: 'ASSIGN_STEMS_TO_BUS', stemKeys: ['r2:1'], busId: 'drums' })
      state = { ...state, tidiedView: true }

      const channels = channelsInOrder(state)
      expect(channels).toHaveLength(2)
      expect(channels[0].channelId).toBe('tidied:drums:0')
      expect(channels[1].channelId).toBe('tidied:drums:1')
    })

    it('groups rifffs into separate rows per bus, unassigned stems falling back to aux', () => {
      let state = reducer(initialState, {
        type: 'ADD_TO_SHELF',
        rifff: { ...rifff, startBar: undefined }
      })
      state = reducer(state, {
        type: 'ADD_TO_SHELF',
        rifff: { ...rifff, groupId: 'r2', startBar: undefined }
      })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r2', startBar: 0 })
      state = reducer(state, { type: 'ASSIGN_STEMS_TO_BUS', stemKeys: ['r1:1'], busId: 'bass' })
      // r2 gets no bus assignment at all -- falls back to aux.
      state = { ...state, tidiedView: true }

      const channels = channelsInOrder(state)
      expect(channels.map((c) => c.channelId)).toEqual(['tidied:bass:0', 'tidied:aux:0'])
      expect(channels[0].rifffs.map((r) => r.groupId)).toEqual(['r1'])
      expect(channels[1].rifffs.map((r) => r.groupId)).toEqual(['r2'])
    })

    it('excludes unplaced rifffs and recording channels from the tidied layout', () => {
      let state = reducer(initialState, { type: 'ADD_RECORDING_CHANNEL', channelId: 'rec-1' })
      state = reducer(state, { type: 'ADD_TO_SHELF', rifff: { ...rifff, startBar: undefined } })
      state = { ...state, tidiedView: true }

      expect(channelsInOrder(state)).toEqual([])
    })
  })
})

describe('isSketchEligible', () => {
  it('is true for an empty timeline', () => {
    expect(isSketchEligible(initialState)).toBe(true)
  })

  it('is true for rifffs stacked contiguously from bar 0, in bar order', () => {
    let state = reducer(initialState, {
      type: 'ADD_TO_SHELF',
      rifff: { ...rifff, groupId: 'r1', barLength: 4, startBar: undefined }
    })
    state = reducer(state, {
      type: 'ADD_TO_SHELF',
      rifff: { ...rifff, groupId: 'r2', barLength: 8, startBar: undefined }
    })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r2', startBar: 4 })
    expect(isSketchEligible(state)).toBe(true)
  })

  it('is false if there is a gap between rifffs', () => {
    let state = reducer(initialState, {
      type: 'ADD_TO_SHELF',
      rifff: { ...rifff, groupId: 'r1', barLength: 4, startBar: undefined }
    })
    state = reducer(state, {
      type: 'ADD_TO_SHELF',
      rifff: { ...rifff, groupId: 'r2', barLength: 8, startBar: undefined }
    })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r2', startBar: 8 }) // gap: r1 ends at 4
    expect(isSketchEligible(state)).toBe(false)
  })

  it('is false if the first rifff does not start at bar 0', () => {
    let state = reducer(initialState, {
      type: 'ADD_TO_SHELF',
      rifff: { ...rifff, groupId: 'r1', barLength: 4, startBar: undefined }
    })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 2 })
    expect(isSketchEligible(state)).toBe(false)
  })

  it('is false if two rifffs overlap (e.g. both start at 0, a different track/row)', () => {
    let state = reducer(initialState, {
      type: 'ADD_TO_SHELF',
      rifff: { ...rifff, groupId: 'r1', barLength: 4, startBar: undefined }
    })
    state = reducer(state, {
      type: 'ADD_TO_SHELF',
      rifff: { ...rifff, groupId: 'r2', barLength: 4, startBar: undefined }
    })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r2', startBar: 0 })
    expect(isSketchEligible(state)).toBe(false)
  })

  it('is false if a rifff has a fade', () => {
    let state = reducer(initialState, {
      type: 'ADD_TO_SHELF',
      rifff: { ...rifff, groupId: 'r1', barLength: 4, startBar: undefined }
    })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
    state = reducer(state, { type: 'SET_FADE_IN', groupId: 'r1', bars: 1 })
    expect(isSketchEligible(state)).toBe(false)
  })

  it("a playedBars trim/extend does not disqualify by itself — sketch mode's own beat-count menu sets this same field", () => {
    let state = reducer(initialState, {
      type: 'ADD_TO_SHELF',
      rifff: { ...rifff, groupId: 'r1', barLength: 4, startBar: undefined }
    })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
    state = reducer(state, { type: 'SET_PLAYED_BARS', key: 'r1', bars: 2 })
    expect(isSketchEligible(state)).toBe(true)
  })

  it('checks contiguity against the playedBars-trimmed length, not raw barLength', () => {
    let state = reducer(initialState, {
      type: 'ADD_TO_SHELF',
      rifff: { ...rifff, groupId: 'r1', barLength: 4, startBar: undefined }
    })
    state = reducer(state, {
      type: 'ADD_TO_SHELF',
      rifff: { ...rifff, groupId: 'r2', barLength: 4, startBar: undefined }
    })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r2', startBar: 4 })
    state = reducer(state, { type: 'SET_PLAYED_BARS', key: 'r1', bars: 2 })
    // r1 now only plays 2 bars, so r2 starting at 4 leaves a gap.
    expect(isSketchEligible(state)).toBe(false)
    // Repacked against the trim (what SEQUENCE_RIFFFS itself would do).
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r2', startBar: 2 })
    expect(isSketchEligible(state)).toBe(true)
  })

  it('is false if a rifff has a nonzero offset', () => {
    let state = reducer(initialState, {
      type: 'ADD_TO_SHELF',
      rifff: { ...rifff, groupId: 'r1', barLength: 4, startBar: undefined }
    })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
    state = reducer(state, { type: 'NUDGE_OFFSET', key: 'r1', delta: 1 })
    expect(isSketchEligible(state)).toBe(false)
  })

  it('ignores mute and volume — those do not affect positioning', () => {
    let state = reducer(initialState, {
      type: 'ADD_TO_SHELF',
      rifff: { ...rifff, groupId: 'r1', barLength: 4, startBar: undefined }
    })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
    state = reducer(state, { type: 'TOGGLE_MUTE', stemKey: 'r1:1' })
    state = reducer(state, { type: 'SET_VOLUME', stemKey: 'r1:1', volume: 0.3 })
    expect(isSketchEligible(state)).toBe(true)
  })
})

describe('nextArrangerMode', () => {
  it('toggles normal <-> sketch when sketch-eligible', () => {
    const state = { ...initialState, mode: 'normal' as const } // empty timeline: trivially eligible
    expect(nextArrangerMode(state)).toBe('sketch')
    expect(nextArrangerMode({ ...state, mode: 'sketch' })).toBe('normal')
  })

  it('stays on normal when the arrangement is not sketch-eligible', () => {
    let state = reducer(initialState, {
      type: 'ADD_TO_SHELF',
      rifff: { ...rifff, groupId: 'r1', barLength: 4, startBar: undefined }
    })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
    state = reducer(state, { type: 'SET_FADE_IN', groupId: 'r1', bars: 1 }) // disqualifies sketch
    expect(nextArrangerMode({ ...state, mode: 'normal' })).toBe('normal')
  })
})

describe('groupIdAtPosition', () => {
  it('finds which placed rifff contains a given position', () => {
    let state = reducer(initialState, {
      type: 'ADD_TO_SHELF',
      rifff: { ...rifff, groupId: 'r1', barLength: 4, startBar: undefined }
    })
    state = reducer(state, {
      type: 'ADD_TO_SHELF',
      rifff: { ...rifff, groupId: 'r2', barLength: 4, startBar: undefined }
    })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r2', startBar: 4 })
    expect(groupIdAtPosition(state, 0)).toBe('r1')
    expect(groupIdAtPosition(state, 3.9)).toBe('r1')
    expect(groupIdAtPosition(state, 4)).toBe('r2')
    expect(groupIdAtPosition(state, 7.5)).toBe('r2')
  })

  it("respects a playedBars trim, not the rifff's raw barLength", () => {
    let state = reducer(initialState, {
      type: 'ADD_TO_SHELF',
      rifff: { ...rifff, groupId: 'r1', barLength: 4, startBar: undefined }
    })
    state = reducer(state, {
      type: 'ADD_TO_SHELF',
      rifff: { ...rifff, groupId: 'r2', barLength: 4, startBar: undefined }
    })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r2', startBar: 2 })
    state = reducer(state, { type: 'SET_PLAYED_BARS', key: 'r1', bars: 2 })
    expect(groupIdAtPosition(state, 1)).toBe('r1')
    // Past r1's trimmed 2-bar window even though its raw barLength is 4.
    expect(groupIdAtPosition(state, 2)).toBe('r2')
  })

  it('returns null when the position is past every placed rifff', () => {
    let state = reducer(initialState, {
      type: 'ADD_TO_SHELF',
      rifff: { ...rifff, groupId: 'r1', barLength: 4, startBar: undefined }
    })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
    expect(groupIdAtPosition(state, 4)).toBeNull()
    expect(groupIdAtPosition(state, 100)).toBeNull()
  })

  it('returns null on an empty timeline', () => {
    expect(groupIdAtPosition(initialState, 0)).toBeNull()
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

describe('pasteStemAction', () => {
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

  it('returns null when the source rifff no longer exists', () => {
    expect(pasteStemAction(initialState, 'missing', 1, 0)).toBeNull()
  })

  it('returns null for a slot that does not exist on the source', () => {
    const state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: twoStemRifff })
    expect(pasteStemAction(state, 'r1', 99, 0)).toBeNull()
  })

  it('builds a PASTE_RIFFF action for a single-stem rifff at the requested startBar', () => {
    const state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: twoStemRifff })
    const action = pasteStemAction(state, 'r1', 2, 20)
    if (action?.type !== 'PASTE_RIFFF') throw new Error('expected PASTE_RIFFF')
    expect(action.rifff.groupId).not.toBe('r1')
    expect(action.rifff.startBar).toBe(20)
    expect(action.rifff.stems).toHaveLength(1)
    expect(action.rifff.stems[0].slot).toBe(2)
    expect(action.rifff.stems[0].path).toBe('/b.wav')
    expect(action.rifff.name).toBe('b') // the stem's own name, not the rifff's
    expect(action.rifff.bpm).toBe(150) // carried from the source rifff
  })

  it('sets barLength to the CURRENT resolved (possibly resized) length, not the source rifff’s own barLength', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: twoStemRifff })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 4 })
    state = reducer(state, { type: 'SET_PLAYED_BARS', key: 'r1', bars: 3 })

    const action = pasteStemAction(state, 'r1', 1, 20)
    if (action?.type !== 'PASTE_RIFFF') throw new Error('expected PASTE_RIFFF')
    expect(action.rifff.barLength).toBe(3) // the resized/trimmed length, not 8
  })

  it('carries over this stem’s own volume, mute, and the group’s offset', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: twoStemRifff })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 4 })
    state = reducer(state, { type: 'SET_VOLUME', stemKey: 'r1:1', volume: 0.4 })
    state = reducer(state, { type: 'TOGGLE_MUTE', stemKey: 'r1:1' })
    state = reducer(state, { type: 'SET_OFFSET_STEPS', key: 'r1', steps: 3 })

    const action = pasteStemAction(state, 'r1', 1, 0)
    if (action?.type !== 'PASTE_RIFFF') throw new Error('expected PASTE_RIFFF')
    const newGroupId = action.rifff.groupId
    expect(action.vol[`${newGroupId}:1`]).toBe(0.4)
    expect(action.mute[`${newGroupId}:1`]).toBe(true)
    expect(action.off[newGroupId]).toBe(3)
  })

  it('applying the action creates an independent, single-stem rifff', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: twoStemRifff })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 4 })
    const action = pasteStemAction(state, 'r1', 1, 20)
    if (!action) throw new Error('expected an action')
    state = reducer(state, action)

    const newGroupId = action.type === 'PASTE_RIFFF' ? action.rifff.groupId : ''
    expect(state.rifffs[newGroupId]).toBeDefined()
    expect(state.rifffs[newGroupId].stems).toHaveLength(1)
    expect(state.rifffs[newGroupId].startBar).toBe(20)
    // Original untouched — still has both its stems.
    expect(state.rifffs.r1.stems).toHaveLength(2)
  })
})
