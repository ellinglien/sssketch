import { describe, expect, it } from 'vitest'
import { initialState, reducer, type AppState } from './store'
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

  it('seeds each stem’s initial volume so the rifff’s stems don’t clip when they all play together', () => {
    // makeRifff() has 2 stems (slots 1 and 6) -> sqrtGain(2) = 1/sqrt(2)
    const state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
    expect(state.vol['r1:1']).toBeCloseTo(1 / Math.sqrt(2), 10)
    expect(state.vol['r1:6']).toBeCloseTo(1 / Math.sqrt(2), 10)
  })

  it('re-adding the same rifff (re-import) does not clobber a volume the user already adjusted', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
    state = reducer(state, { type: 'SET_VOLUME', stemKey: 'r1:1', volume: 0.3 })
    state = reducer(state, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
    expect(state.vol['r1:1']).toBe(0.3)
  })

  it('placing on the timeline sets startBar, selects, and enables stretch, without forcing it expanded', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 4 })
    expect(state.rifffs.r1.startBar).toBe(4)
    expect(state.sel).toBe('r1')
    expect(state.exp.r1).toBeUndefined()
    expect(state.stretch.r1).toBe(true)
  })

  it('placing on the timeline clamps a negative startBar to 0', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: -3 })
    expect(state.rifffs.r1.startBar).toBe(0)
  })

  it('the first clip placed on an empty timeline adopts its bpm as the project tempo', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff({ bpm: 150 }) })
    expect(state.bpm).toBe(80) // untouched default until something is actually placed
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
    expect(state.bpm).toBe(150)
  })

  it('a second clip placed alongside an already-placed one does not retrigger tempo adoption', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff({ bpm: 150 }) })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
    state = reducer(state, {
      type: 'ADD_TO_SHELF',
      rifff: makeRifff({ groupId: 'r2', bpm: 90 })
    })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r2', startBar: 8 })
    expect(state.bpm).toBe(150) // still the first clip's tempo, not the second's
  })

  it('repositioning an already-placed clip does not retrigger tempo adoption', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff({ bpm: 150 }) })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
    state = { ...state, bpm: 120 } // user manually changed tempo afterward
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 4 }) // dragged to a new spot
    expect(state.bpm).toBe(120)
  })

  describe('channels', () => {
    it('a placed rifff gets its own channel, added to the end of channelOrder', () => {
      let state = reducer(initialState, {
        type: 'ADD_TO_SHELF',
        rifff: makeRifff({ groupId: 'r1' })
      })
      state = reducer(state, { type: 'ADD_TO_SHELF', rifff: makeRifff({ groupId: 'r2' }) })
      // r2 was added to the shelf second, but placed on the timeline first —
      // channelOrder should reflect placement order, not shelf-add order.
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r2', startBar: 0 })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 4 })
      expect(state.channelOrder).toEqual(['r2', 'r1'])
      expect(state.channelOf).toEqual({ r2: 'r2', r1: 'r1' })
    })

    it('repositioning an already-placed clip (same PLACE_ON_TIMELINE action) leaves its channel untouched', () => {
      let state = reducer(initialState, {
        type: 'ADD_TO_SHELF',
        rifff: makeRifff({ groupId: 'r1' })
      })
      state = reducer(state, { type: 'ADD_TO_SHELF', rifff: makeRifff({ groupId: 'r2' }) })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r2', startBar: 4 })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 8 }) // dragged
      expect(state.channelOrder).toEqual(['r1', 'r2'])
      expect(state.channelOf).toEqual({ r1: 'r1', r2: 'r2' })
    })

    it('removing from the timeline drops its now-empty channel; re-placing gets a fresh one at the bottom', () => {
      let state = reducer(initialState, {
        type: 'ADD_TO_SHELF',
        rifff: makeRifff({ groupId: 'r1' })
      })
      state = reducer(state, { type: 'ADD_TO_SHELF', rifff: makeRifff({ groupId: 'r2' }) })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r2', startBar: 4 })
      state = reducer(state, { type: 'REMOVE_FROM_TIMELINE', groupId: 'r1' })
      expect(state.channelOrder).toEqual(['r2'])
      expect(state.channelOf.r1).toBeUndefined()
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
      expect(state.channelOrder).toEqual(['r2', 'r1'])
    })

    it('MOVE_TO_CHANNEL on a first-ever placement still adopts the clip’s own bpm as project tempo', () => {
      // Regression test: an earlier version of MOVE_TO_CHANNEL didn't share
      // PLACE_ON_TIMELINE's placeOnTimeline() logic and silently dropped
      // this — since a later task (Task 11) routes every Timeline drop
      // (including first-ever shelf placements) through MOVE_TO_CHANNEL when
      // a specific channel target is known, this must work here too, not
      // just via PLACE_ON_TIMELINE.
      let state = reducer(initialState, {
        type: 'ADD_TO_SHELF',
        rifff: makeRifff({ groupId: 'r1', bpm: 150 })
      })
      expect(state.bpm).toBe(80) // untouched default
      state = reducer(state, {
        type: 'MOVE_TO_CHANNEL',
        groupId: 'r1',
        startBar: 0,
        channelId: 'r1'
      })
      expect(state.bpm).toBe(150)
    })

    it('MOVE_TO_CHANNEL reassigns to an existing channel and drops the old one once it is empty', () => {
      let state = reducer(initialState, {
        type: 'ADD_TO_SHELF',
        rifff: makeRifff({ groupId: 'r1' })
      })
      state = reducer(state, { type: 'ADD_TO_SHELF', rifff: makeRifff({ groupId: 'r2' }) })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r2', startBar: 4 })
      state = reducer(state, {
        type: 'MOVE_TO_CHANNEL',
        groupId: 'r1',
        startBar: 6,
        channelId: 'r2'
      })
      expect(state.channelOf).toEqual({ r1: 'r2', r2: 'r2' })
      expect(state.channelOrder).toEqual(['r2']) // r1's own now-empty channel is gone
      expect(state.rifffs.r1.startBar).toBe(6)
      expect(state.sel).toBe('r1')
    })

    it('MOVE_TO_CHANNEL onto a brand new channel id creates it', () => {
      let state = reducer(initialState, {
        type: 'ADD_TO_SHELF',
        rifff: makeRifff({ groupId: 'r1' })
      })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
      state = reducer(state, {
        type: 'MOVE_TO_CHANNEL',
        groupId: 'r1',
        startBar: 0,
        channelId: 'fresh-channel'
      })
      expect(state.channelOf.r1).toBe('fresh-channel')
      expect(state.channelOrder).toEqual(['fresh-channel']) // r1's own default channel is gone, replaced
    })

    it('two clips can share one channel (MOVE_TO_CHANNEL onto an occupied one)', () => {
      let state = reducer(initialState, {
        type: 'ADD_TO_SHELF',
        rifff: makeRifff({ groupId: 'r1' })
      })
      state = reducer(state, { type: 'ADD_TO_SHELF', rifff: makeRifff({ groupId: 'r2' }) })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r2', startBar: 4 })
      state = reducer(state, {
        type: 'MOVE_TO_CHANNEL',
        groupId: 'r2',
        startBar: 8,
        channelId: 'r1'
      })
      expect(state.channelOf).toEqual({ r1: 'r1', r2: 'r1' })
      expect(state.channelOrder).toEqual(['r1'])
    })
  })

  it('selects a rifff', () => {
    const state = reducer(initialState, { type: 'SELECT', groupId: 'r1' })
    expect(state.sel).toBe('r1')
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

  it('zeroes an offset', () => {
    let state = reducer(initialState, { type: 'NUDGE_OFFSET', key: 'r1', delta: 5 })
    state = reducer(state, { type: 'ZERO_OFFSET', key: 'r1' })
    expect(state.off.r1).toBe(0)
  })

  it('sets an exact offset in steps, unclamped unlike NUDGE_OFFSET', () => {
    const state = reducer(initialState, { type: 'SET_OFFSET_STEPS', key: 'r1', steps: -40 })
    expect(state.off.r1).toBe(-40)
  })

  it('removing from timeline clears startBar but keeps the rifff (and its settings) around', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 4 })
    state = reducer(state, { type: 'SET_VOLUME', stemKey: 'r1:1', volume: 0.3 })
    state = reducer(state, { type: 'REMOVE_FROM_TIMELINE', groupId: 'r1' })
    expect(state.rifffs.r1.startBar).toBeUndefined()
    expect(state.rifffs.r1).toBeDefined()
    expect(state.vol['r1:1']).toBe(0.3)
  })

  it('removing the selected clip from the timeline also clears selection', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 4 })
    expect(state.sel).toBe('r1')
    state = reducer(state, { type: 'REMOVE_FROM_TIMELINE', groupId: 'r1' })
    expect(state.sel).toBeNull()
  })

  describe('DELETE_RIFFFS', () => {
    it('removes the rifff entirely, not just from the timeline', () => {
      let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
      state = reducer(state, { type: 'DELETE_RIFFFS', groupIds: ['r1'] })
      expect(state.rifffs.r1).toBeUndefined()
    })

    it('scrubs per-stem fields (vol, mute) for every stem of the deleted rifff', () => {
      let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
      state = reducer(state, { type: 'SET_VOLUME', stemKey: 'r1:1', volume: 0.3 })
      state = reducer(state, { type: 'TOGGLE_MUTE', stemKey: 'r1:6' })
      state = reducer(state, { type: 'DELETE_RIFFFS', groupIds: ['r1'] })
      expect(state.vol['r1:1']).toBeUndefined()
      expect(state.mute['r1:6']).toBeUndefined()
    })

    it('scrubs off/playedBars entries for the deleted rifff', () => {
      let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
      state = reducer(state, { type: 'NUDGE_OFFSET', key: 'r1', delta: 2 })
      state = reducer(state, { type: 'SET_PLAYED_BARS', key: 'r1', bars: 2 })
      state = reducer(state, { type: 'DELETE_RIFFFS', groupIds: ['r1'] })
      expect(state.off.r1).toBeUndefined()
      expect(state.playedBars.r1).toBeUndefined()
    })

    it('drops a deleted rifff’s channel from channelOrder if nothing else is on it', () => {
      let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
      state = reducer(state, { type: 'DELETE_RIFFFS', groupIds: ['r1'] })
      expect(state.channelOrder).toEqual([])
      expect(state.channelOf.r1).toBeUndefined()
    })

    it('clears selection only if the selected rifff was one of the deleted ones', () => {
      let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
      state = reducer(state, {
        type: 'ADD_TO_SHELF',
        rifff: makeRifff({ groupId: 'r2' })
      })
      state = reducer(state, { type: 'SELECT', groupId: 'r2' })
      state = reducer(state, { type: 'DELETE_RIFFFS', groupIds: ['r1'] })
      expect(state.sel).toBe('r2') // untouched — r2 wasn't deleted
      state = reducer(state, { type: 'DELETE_RIFFFS', groupIds: ['r2'] })
      expect(state.sel).toBeNull()
    })

    it('deletes multiple rifffs in one dispatch', () => {
      let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
      state = reducer(state, {
        type: 'ADD_TO_SHELF',
        rifff: makeRifff({ groupId: 'r2' })
      })
      state = reducer(state, { type: 'DELETE_RIFFFS', groupIds: ['r1', 'r2'] })
      expect(state.rifffs).toEqual({})
    })
  })

  it('applying a bake repoints every stem at its baked path and resets offsets to 0', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
    state = reducer(state, { type: 'SET_OFFSET_STEPS', key: 'r1', steps: -6 })
    state = reducer(state, {
      type: 'APPLY_BAKE',
      groupId: 'r1',
      results: [
        { path: '/x/1.wav', bakedPath: '/x/1.baked.wav', durationSec: 12.8 },
        { path: '/x/6.wav', bakedPath: '/x/6.baked.wav', durationSec: 3.2 }
      ]
    })
    expect(state.rifffs.r1.stems.find((s) => s.slot === 1)?.path).toBe('/x/1.baked.wav')
    expect(state.rifffs.r1.stems.find((s) => s.slot === 6)?.path).toBe('/x/6.baked.wav')
    expect(state.off.r1).toBe(0)
    expect(state.off['r1:1']).toBe(0)
    expect(state.off['r1:6']).toBe(0)
  })

  it('applying a bake leaves a stem untouched if its path is missing from the results', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
    state = reducer(state, {
      type: 'APPLY_BAKE',
      groupId: 'r1',
      // slot 6's file failed to bake
      results: [{ path: '/x/1.wav', bakedPath: '/x/1.baked.wav', durationSec: 12.8 }]
    })
    expect(state.rifffs.r1.stems.find((s) => s.slot === 1)?.path).toBe('/x/1.baked.wav')
    expect(state.rifffs.r1.stems.find((s) => s.slot === 6)?.path).toBe('/x/6.wav')
  })

  it("updates a stem's durationSec to the baked file's own real measured length, not left stale", () => {
    // Real bug this covers: a LORE stem's durationSec is derived from the
    // warehouse database's BPM/Length16s metadata, not measured from the
    // actual audio — after baking (which decodes the REAL file), leaving
    // the old value in place could desync the native engine's own
    // tile-boundary scheduling from what the baked file actually contains,
    // heard as clicking/stuttering right at tile boundaries.
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
    state = reducer(state, {
      type: 'APPLY_BAKE',
      groupId: 'r1',
      // Deliberately different from makeRifff's own defaults (12.8, 3.2) so
      // a test that silently kept the old value would fail loudly.
      results: [
        { path: '/x/1.wav', bakedPath: '/x/1.baked.wav', durationSec: 12.85 },
        { path: '/x/6.wav', bakedPath: '/x/6.baked.wav', durationSec: 3.19 }
      ]
    })
    expect(state.rifffs.r1.stems.find((s) => s.slot === 1)?.durationSec).toBe(12.85)
    expect(state.rifffs.r1.stems.find((s) => s.slot === 6)?.durationSec).toBe(3.19)
  })

  it("leaves a stem's durationSec unchanged if its path is missing from the results", () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
    state = reducer(state, {
      type: 'APPLY_BAKE',
      groupId: 'r1',
      results: [{ path: '/x/1.wav', bakedPath: '/x/1.baked.wav', durationSec: 12.85 }]
    })
    expect(state.rifffs.r1.stems.find((s) => s.slot === 1)?.durationSec).toBe(12.85)
    expect(state.rifffs.r1.stems.find((s) => s.slot === 6)?.durationSec).toBe(3.2) // unchanged default
  })

  it('preserves the runtime offset when a bake fails for every stem (e.g. LORE-sourced, not WAV)', () => {
    // bakeOffset silently skips any file it can't rewrite in place (Ogg
    // Vorbis LORE stems) rather than throwing — real bug this covers: the
    // reducer used to unconditionally zero every offset regardless, silently
    // discarding the picked downbeat correction for a riff that could never
    // actually be baked, with no other place that correction was captured.
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
    state = reducer(state, { type: 'SET_OFFSET_STEPS', key: 'r1', steps: -6 })
    state = reducer(state, { type: 'APPLY_BAKE', groupId: 'r1', results: [] })
    expect(state.rifffs.r1.stems.find((s) => s.slot === 1)?.path).toBe('/x/1.wav')
    expect(state.rifffs.r1.stems.find((s) => s.slot === 6)?.path).toBe('/x/6.wav')
    expect(state.off.r1).toBe(-6)
  })

  it("preserves the group offset when only some of a linked group's stems bake successfully", () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
    state = reducer(state, { type: 'SET_OFFSET_STEPS', key: 'r1', steps: -6 })
    state = reducer(state, {
      type: 'APPLY_BAKE',
      groupId: 'r1',
      results: [{ path: '/x/1.wav', bakedPath: '/x/1.baked.wav', durationSec: 12.8 }] // slot 6 failed
    })
    // The group key is what a linked group actually reads at playback time
    // (see resolveOffsetKey) — zeroing it while slot 6 is still relying on
    // the runtime shift would silently un-correct that stem, even though
    // slot 1 really did get baked.
    expect(state.off.r1).toBe(-6)
    expect(state.off['r1:1']).toBe(0)
    expect(state.off['r1:6']).toBeUndefined()
  })

  it('sets a stem volume', () => {
    const state = reducer(initialState, { type: 'SET_VOLUME', stemKey: 'r1:1', volume: 0.5 })
    expect(state.vol['r1:1']).toBe(0.5)
  })

  it('toggles mute', () => {
    let state = reducer(initialState, { type: 'TOGGLE_MUTE', stemKey: 'r1:1' })
    expect(state.mute['r1:1']).toBe(true)
    state = reducer(state, { type: 'TOGGLE_MUTE', stemKey: 'r1:1' })
    expect(state.mute['r1:1']).toBe(false)
  })

  it('toggles stretch', () => {
    let state = reducer(initialState, { type: 'TOGGLE_STRETCH', groupId: 'r1' })
    expect(state.stretch.r1).toBe(true)
    state = reducer(state, { type: 'TOGGLE_STRETCH', groupId: 'r1' })
    expect(state.stretch.r1).toBe(false)
  })

  describe('SET_ARRANGER_MODE', () => {
    it('sets the mode field directly', () => {
      let state = reducer(initialState, { type: 'SET_ARRANGER_MODE', mode: 'sketch' })
      expect(state.mode).toBe('sketch')
      state = reducer(state, { type: 'SET_ARRANGER_MODE', mode: 'normal' })
      expect(state.mode).toBe('normal')
    })
  })

  describe('SEQUENCE_RIFFFS', () => {
    it('repacks rifffs into contiguous bar positions in the given order, starting at 0', () => {
      let state = reducer(initialState, {
        type: 'ADD_TO_SHELF',
        rifff: makeRifff({ groupId: 'r1' })
      })
      state = reducer(state, {
        type: 'ADD_TO_SHELF',
        rifff: makeRifff({ groupId: 'r2', barLength: 4 })
      })
      state = reducer(state, {
        type: 'ADD_TO_SHELF',
        rifff: makeRifff({ groupId: 'r3', barLength: 2 })
      })
      state = reducer(state, { type: 'SEQUENCE_RIFFFS', groupIds: ['r2', 'r3', 'r1'] })
      expect(state.rifffs.r2.startBar).toBe(0)
      expect(state.rifffs.r3.startBar).toBe(4) // right after r2's 4 bars
      expect(state.rifffs.r1.startBar).toBe(6) // right after r3's 2 bars
    })

    it("packs against a playedBars trim, not raw barLength — sketch mode's own beat-count menu", () => {
      let state = reducer(initialState, {
        type: 'ADD_TO_SHELF',
        rifff: makeRifff({ groupId: 'r1', barLength: 4 })
      })
      state = reducer(state, {
        type: 'ADD_TO_SHELF',
        rifff: makeRifff({ groupId: 'r2', barLength: 4 })
      })
      state = { ...state, playedBars: { ...state.playedBars, r1: 2 } }
      state = reducer(state, { type: 'SEQUENCE_RIFFFS', groupIds: ['r1', 'r2'] })
      expect(state.rifffs.r1.startBar).toBe(0)
      expect(state.rifffs.r2.startBar).toBe(2) // right after r1's TRIMMED 2 bars, not its raw 4
    })

    it('replaces channelOrder with the new sequence order, one channel per clip', () => {
      let state = reducer(initialState, {
        type: 'ADD_TO_SHELF',
        rifff: makeRifff({ groupId: 'r1' })
      })
      state = reducer(state, { type: 'ADD_TO_SHELF', rifff: makeRifff({ groupId: 'r2' }) })
      state = reducer(state, { type: 'SEQUENCE_RIFFFS', groupIds: ['r2', 'r1'] })
      expect(state.channelOrder).toEqual(['r2', 'r1'])
      expect(state.channelOf).toEqual({ r2: 'r2', r1: 'r1' })
    })

    it('forces stretch on for every sequenced rifff, even one that had it off', () => {
      // Real bug: SEQUENCE_RIFFFS packs positions using each rifff's raw
      // barLength, which only matches clipGeometry's rendered width when
      // stretch is on. A rifff carried into a sketch sequence with stretch
      // off (e.g. via pasteRifffAction copying a stretch-off source) would
      // pack correctly here but then render at a different width once
      // viewed back in Normal/Compact mode, leaving a visible gap.
      let state = reducer(initialState, {
        type: 'ADD_TO_SHELF',
        rifff: makeRifff({ groupId: 'r1' })
      })
      state = reducer(state, { type: 'ADD_TO_SHELF', rifff: makeRifff({ groupId: 'r2' }) })
      state = { ...state, stretch: { ...state.stretch, r1: false } }
      state = reducer(state, { type: 'SEQUENCE_RIFFFS', groupIds: ['r1', 'r2'] })
      expect(state.stretch.r1).toBe(true)
      expect(state.stretch.r2).toBe(true)
    })
  })

  describe('initialState', () => {
    it('defaults mode to sketch', () => {
      expect(initialState.mode).toBe('sketch')
    })
  })

  describe('SET_PLAYED_BARS', () => {
    it('sets playedBars for the given key', () => {
      const next = reducer(initialState, { type: 'SET_PLAYED_BARS', key: 'r1', bars: 12 })
      expect(next.playedBars.r1).toBe(12)
    })

    it('clamps to a minimum of 0.25 bars', () => {
      const next = reducer(initialState, { type: 'SET_PLAYED_BARS', key: 'r1', bars: -3 })
      expect(next.playedBars.r1).toBe(0.25)
    })
  })

  describe('RESIZE_LEFT', () => {
    it('sets playedBars on the group key and moves the rifff’s own startBar', () => {
      let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 6 })
      state = reducer(state, { type: 'RESIZE_LEFT', groupId: 'r1', bars: 10, startBar: 4 })
      expect(state.playedBars.r1).toBe(10)
      expect(state.rifffs.r1.startBar).toBe(4)
    })

    it('clamps playedBars to a minimum of 0.25 and startBar to a minimum of 0', () => {
      let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 6 })
      state = reducer(state, { type: 'RESIZE_LEFT', groupId: 'r1', bars: -3, startBar: -2 })
      expect(state.playedBars.r1).toBe(0.25)
      expect(state.rifffs.r1.startBar).toBe(0)
    })
  })

  describe('UNGROUP', () => {
    it('splits every stem into its own independent, selected one-stem rifff', () => {
      let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 6 })
      state = reducer(state, { type: 'UNGROUP', groupId: 'r1' })

      expect(state.rifffs.r1).toBeUndefined()
      const newRifffs = Object.values(state.rifffs)
      expect(newRifffs).toHaveLength(2) // makeRifff() has 2 stems
      expect(newRifffs.every((r) => r.stems.length === 1)).toBe(true)
      expect(newRifffs.every((r) => r.startBar === 6)).toBe(true)
      expect(state.sel).toBe(newRifffs[0].groupId)
    })

    it('lands every new clip on the SAME channel the parent was on', () => {
      let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
      const parentChannel = state.channelOf.r1
      state = reducer(state, { type: 'UNGROUP', groupId: 'r1' })
      const newGroupIds = Object.keys(state.rifffs)
      expect(newGroupIds).toHaveLength(2)
      for (const groupId of newGroupIds) {
        expect(state.channelOf[groupId]).toBe(parentChannel)
      }
      expect(state.channelOrder).toContain(parentChannel)
    })

    it('carries over each stem’s own volume and mute, keyed to its new groupId', () => {
      let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
      state = reducer(state, { type: 'SET_VOLUME', stemKey: 'r1:1', volume: 0.4 })
      state = reducer(state, { type: 'TOGGLE_MUTE', stemKey: 'r1:6' })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
      state = reducer(state, { type: 'UNGROUP', groupId: 'r1' })

      const slot1Rifff = Object.values(state.rifffs).find((r) => r.stems[0].slot === 1)!
      const slot6Rifff = Object.values(state.rifffs).find((r) => r.stems[0].slot === 6)!
      expect(state.vol[`${slot1Rifff.groupId}:1`]).toBe(0.4)
      expect(state.mute[`${slot6Rifff.groupId}:6`]).toBe(true)
      expect(state.vol['r1:1']).toBeUndefined() // old keys scrubbed
      expect(state.mute['r1:6']).toBeUndefined()
    })

    it('copies group-level fade/stretch identically to every new clip', () => {
      let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
      state = reducer(state, { type: 'SET_FADE_IN', groupId: 'r1', bars: 2 })
      state = reducer(state, { type: 'SET_FADE_OUT', groupId: 'r1', bars: 1 })
      state = reducer(state, { type: 'UNGROUP', groupId: 'r1' })

      for (const groupId of Object.keys(state.rifffs)) {
        expect(state.fadeIn[groupId]).toBe(2)
        expect(state.fadeOut[groupId]).toBe(1)
        expect(state.stretch[groupId]).toBe(true)
      }
    })

    it('uses the group’s current resolved playedBars as each new clip’s own barLength', () => {
      let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() }) // barLength 8
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
      state = reducer(state, { type: 'SET_PLAYED_BARS', key: 'r1', bars: 3 })
      state = reducer(state, { type: 'UNGROUP', groupId: 'r1' })
      for (const rifff of Object.values(state.rifffs)) {
        expect(rifff.barLength).toBe(3)
      }
    })

    it('deletes the parent rifff’s own now-orphaned per-group state', () => {
      let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
      state = reducer(state, { type: 'SET_FADE_IN', groupId: 'r1', bars: 2 })
      state = reducer(state, { type: 'UNGROUP', groupId: 'r1' })
      expect(state.fadeIn.r1).toBeUndefined()
      expect(state.off.r1).toBeUndefined()
      expect(state.stretch.r1).toBeUndefined()
      expect(state.channelOf.r1).toBeUndefined()
    })
  })

  it('sets fade in/out bars, clamped to 0', () => {
    let state = reducer(initialState, { type: 'SET_FADE_IN', groupId: 'r1', bars: 1.5 })
    state = reducer(state, { type: 'SET_FADE_OUT', groupId: 'r1', bars: 2 })
    expect(state.fadeIn.r1).toBe(1.5)
    expect(state.fadeOut.r1).toBe(2)
    state = reducer(state, { type: 'SET_FADE_IN', groupId: 'r1', bars: -1 })
    expect(state.fadeIn.r1).toBe(0)
  })

  it('cycles a stem sound-type through all 8 types and back to the start', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
    for (let i = 0; i < 8; i++) {
      state = reducer(state, { type: 'CYCLE_TYPE', groupId: 'r1', slot: 1 })
    }
    expect(state.rifffs.r1.stems.find((s) => s.slot === 1)?.type).toBe('fx')
  })

  it('applies an auto-guessed stem type while it is still the untouched default', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
    state = reducer(state, { type: 'SET_STEM_TYPE', groupId: 'r1', slot: 1, soundType: 'bass' })
    expect(state.rifffs.r1.stems.find((s) => s.slot === 1)?.type).toBe('bass')
  })

  it('does not let an auto-guess clobber a type already changed by hand', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
    state = reducer(state, { type: 'CYCLE_TYPE', groupId: 'r1', slot: 1 }) // fx -> extFx
    state = reducer(state, { type: 'SET_STEM_TYPE', groupId: 'r1', slot: 1, soundType: 'bass' })
    expect(state.rifffs.r1.stems.find((s) => s.slot === 1)?.type).toBe('extFx')
  })

  it('renames a rifff', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
    state = reducer(state, { type: 'RENAME_RIFFF', groupId: 'r1', name: 'new name' })
    expect(state.rifffs.r1.name).toBe('new name')
  })

  it('renames a single stem, leaving the others alone', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
    state = reducer(state, { type: 'RENAME_STEM', groupId: 'r1', slot: 1, name: 'new stem name' })
    expect(state.rifffs.r1.stems.find((s) => s.slot === 1)?.name).toBe('new stem name')
    expect(state.rifffs.r1.stems.find((s) => s.slot === 6)?.name).toBe('Freezer')
  })

  // PLAY/PAUSE/STOP/SET_POS used to be tested here via reducer() directly —
  // they're no longer part of Action at all (see store.ts's own comment on
  // Action), having moved to StoreContext.tsx's own transport state
  // entirely outside this reducer.

  describe('TOGGLE_EXPAND', () => {
    it('starts undefined (collapsed) and toggles true/false', () => {
      let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
      expect(state.exp.r1).toBeUndefined()
      state = reducer(state, { type: 'TOGGLE_EXPAND', groupId: 'r1' })
      expect(state.exp.r1).toBe(true)
      state = reducer(state, { type: 'TOGGLE_EXPAND', groupId: 'r1' })
      expect(state.exp.r1).toBe(false)
    })
  })

  describe('TOGGLE_VOLUME_DRAG_MODE', () => {
    it('starts false and toggles true/false', () => {
      expect(initialState.volumeDragMode).toBe(false)
      let state = reducer(initialState, { type: 'TOGGLE_VOLUME_DRAG_MODE' })
      expect(state.volumeDragMode).toBe(true)
      state = reducer(state, { type: 'TOGGLE_VOLUME_DRAG_MODE' })
      expect(state.volumeDragMode).toBe(false)
    })
  })

  describe('TOGGLE_INSPECTOR_COLLAPSED', () => {
    it('starts false and toggles true/false', () => {
      expect(initialState.inspectorCollapsed).toBe(false)
      let state = reducer(initialState, { type: 'TOGGLE_INSPECTOR_COLLAPSED' })
      expect(state.inspectorCollapsed).toBe(true)
      state = reducer(state, { type: 'TOGGLE_INSPECTOR_COLLAPSED' })
      expect(state.inspectorCollapsed).toBe(false)
    })
  })

  function makeOneShotRifff(overrides: Partial<Rifff> = {}): Rifff {
    return {
      groupId: 'r1',
      name: 'kick',
      bpm: 120,
      barLength: 1,
      folderPath: '/x/kick.wav',
      stems: [
        {
          slot: 1,
          author: '',
          name: 'kick',
          type: 'fx',
          path: '/x/kick.wav',
          durationSec: 0.6,
          barLength: 1,
          oneShot: true
        }
      ],
      ...overrides
    }
  }

  describe('SET_ONE_SHOT_TRIM', () => {
    it('sets trimStartSec/trimEndSec on the stem and startBar on the rifff', () => {
      let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeOneShotRifff() })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
      state = reducer(state, {
        type: 'SET_ONE_SHOT_TRIM',
        groupId: 'r1',
        trimStartSec: 0.1,
        trimEndSec: 0.4,
        startBar: 2
      })
      const stem = state.rifffs.r1.stems[0]
      expect(stem.trimStartSec).toBe(0.1)
      expect(stem.trimEndSec).toBe(0.4)
      expect(state.rifffs.r1.startBar).toBe(2)
    })

    it('clamps a negative startBar to 0', () => {
      let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeOneShotRifff() })
      state = reducer(state, {
        type: 'SET_ONE_SHOT_TRIM',
        groupId: 'r1',
        trimStartSec: 0,
        trimEndSec: 0.5,
        startBar: -3
      })
      expect(state.rifffs.r1.startBar).toBe(0)
    })
  })

  describe('SET_ONE_SHOT_STRETCHED', () => {
    it("replaces the stem's path/durationSec, clears any prior trim, and updates startBar", () => {
      let state = reducer(initialState, {
        type: 'ADD_TO_SHELF',
        rifff: makeOneShotRifff({
          stems: [
            {
              slot: 1,
              author: '',
              name: 'kick',
              type: 'fx',
              path: '/x/kick.wav',
              durationSec: 0.6,
              barLength: 1,
              oneShot: true,
              trimStartSec: 0.1,
              trimEndSec: 0.4
            }
          ]
        })
      })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 4 })
      state = reducer(state, {
        type: 'SET_ONE_SHOT_STRETCHED',
        groupId: 'r1',
        path: '/x/kick-stretched.wav',
        durationSec: 0.9,
        startBar: 3
      })
      const stem = state.rifffs.r1.stems[0]
      expect(stem.path).toBe('/x/kick-stretched.wav')
      expect(stem.durationSec).toBe(0.9)
      expect(stem.trimStartSec).toBeUndefined()
      expect(stem.trimEndSec).toBeUndefined()
      expect(state.rifffs.r1.startBar).toBe(3)
    })
  })

  describe('SET_GROUP_MUTE', () => {
    it('mutes every stem in the rifff at once', () => {
      let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
      state = reducer(state, { type: 'SET_GROUP_MUTE', groupId: 'r1', muted: true })
      expect(state.mute['r1:1']).toBe(true)
      expect(state.mute['r1:6']).toBe(true)
    })

    it('unmutes every stem in the rifff at once', () => {
      let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
      state = reducer(state, { type: 'SET_GROUP_MUTE', groupId: 'r1', muted: true })
      state = reducer(state, { type: 'SET_GROUP_MUTE', groupId: 'r1', muted: false })
      expect(state.mute['r1:1']).toBe(false)
      expect(state.mute['r1:6']).toBe(false)
    })

    it('does not affect other rifffs', () => {
      let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
      state = reducer(state, {
        type: 'ADD_TO_SHELF',
        rifff: makeRifff({ groupId: 'r2' })
      })
      state = reducer(state, { type: 'SET_GROUP_MUTE', groupId: 'r1', muted: true })
      expect(state.mute['r1:1']).toBe(true)
      expect(state.mute['r2:1']).toBeUndefined()
    })
  })

  describe('SOLO_GROUP', () => {
    it('mutes every stem in every other PLACED rifff and unmutes every stem in this one', () => {
      let state = reducer(initialState, {
        type: 'ADD_TO_SHELF',
        rifff: makeRifff({ groupId: 'r1' })
      })
      state = reducer(state, { type: 'ADD_TO_SHELF', rifff: makeRifff({ groupId: 'r2' }) })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r2', startBar: 4 })
      state = reducer(state, { type: 'SOLO_GROUP', groupId: 'r1' })
      expect(state.mute['r1:1']).toBe(false)
      expect(state.mute['r1:6']).toBe(false)
      expect(state.mute['r2:1']).toBe(true)
      expect(state.mute['r2:6']).toBe(true)
    })

    it('force-unmutes the soloed rifff even if one of its stems was already individually muted', () => {
      let state = reducer(initialState, {
        type: 'ADD_TO_SHELF',
        rifff: makeRifff({ groupId: 'r1' })
      })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
      state = reducer(state, { type: 'TOGGLE_MUTE', stemKey: 'r1:1' })
      state = reducer(state, { type: 'SOLO_GROUP', groupId: 'r1' })
      expect(state.mute['r1:1']).toBe(false)
    })

    it('toggles back to fully unmuted when SOLO_GROUP is dispatched again for the already-soloed rifff', () => {
      let state = reducer(initialState, {
        type: 'ADD_TO_SHELF',
        rifff: makeRifff({ groupId: 'r1' })
      })
      state = reducer(state, { type: 'ADD_TO_SHELF', rifff: makeRifff({ groupId: 'r2' }) })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r2', startBar: 4 })
      state = reducer(state, { type: 'SOLO_GROUP', groupId: 'r1' })
      state = reducer(state, { type: 'SOLO_GROUP', groupId: 'r1' })
      expect(state.mute['r1:1']).toBe(false)
      expect(state.mute['r2:1']).toBe(false)
    })

    it('re-solos (does not toggle off) when dispatched for a DIFFERENT rifff than the one currently soloed', () => {
      let state = reducer(initialState, {
        type: 'ADD_TO_SHELF',
        rifff: makeRifff({ groupId: 'r1' })
      })
      state = reducer(state, { type: 'ADD_TO_SHELF', rifff: makeRifff({ groupId: 'r2' }) })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r2', startBar: 4 })
      state = reducer(state, { type: 'SOLO_GROUP', groupId: 'r1' })
      state = reducer(state, { type: 'SOLO_GROUP', groupId: 'r2' })
      expect(state.mute['r1:1']).toBe(true)
      expect(state.mute['r2:1']).toBe(false)
    })

    it('does not touch a rifff still sitting unplaced in the shelf — regression test for a real bug where soloing anything would silently mute every shelf-only rifff, so a brand new clip could arrive pre-muted the moment it was later dragged onto the timeline', () => {
      let state = reducer(initialState, {
        type: 'ADD_TO_SHELF',
        rifff: makeRifff({ groupId: 'r1' })
      })
      state = reducer(state, { type: 'ADD_TO_SHELF', rifff: makeRifff({ groupId: 'r2' }) })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
      // r2 is deliberately left unplaced, still sitting in the shelf.
      state = reducer(state, { type: 'SOLO_GROUP', groupId: 'r1' })
      expect(state.mute['r2:1']).toBeUndefined()
      expect(state.mute['r2:6']).toBeUndefined()
    })
  })

  describe('SET_CHANNEL_MUTE', () => {
    it('mutes every rifff currently assigned to the channel, even across several rifffs sharing one channel', () => {
      let state = reducer(initialState, {
        type: 'ADD_TO_SHELF',
        rifff: makeRifff({ groupId: 'r1' })
      })
      state = reducer(state, { type: 'ADD_TO_SHELF', rifff: makeRifff({ groupId: 'r2' }) })
      state = reducer(state, {
        type: 'MOVE_TO_CHANNEL',
        groupId: 'r1',
        startBar: 0,
        channelId: 'chan-a'
      })
      state = reducer(state, {
        type: 'MOVE_TO_CHANNEL',
        groupId: 'r2',
        startBar: 4,
        channelId: 'chan-a'
      })
      state = reducer(state, { type: 'SET_CHANNEL_MUTE', channelId: 'chan-a', muted: true })
      expect(state.mute['r1:1']).toBe(true)
      expect(state.mute['r2:1']).toBe(true)
    })

    it('does not affect a rifff on a different channel', () => {
      let state = reducer(initialState, {
        type: 'ADD_TO_SHELF',
        rifff: makeRifff({ groupId: 'r1' })
      })
      state = reducer(state, { type: 'ADD_TO_SHELF', rifff: makeRifff({ groupId: 'r2' }) })
      state = reducer(state, {
        type: 'MOVE_TO_CHANNEL',
        groupId: 'r1',
        startBar: 0,
        channelId: 'chan-a'
      })
      state = reducer(state, {
        type: 'MOVE_TO_CHANNEL',
        groupId: 'r2',
        startBar: 0,
        channelId: 'chan-b'
      })
      state = reducer(state, { type: 'SET_CHANNEL_MUTE', channelId: 'chan-a', muted: true })
      expect(state.mute['r1:1']).toBe(true)
      expect(state.mute['r2:1']).toBeUndefined()
    })
  })

  describe('SOLO_CHANNEL', () => {
    it('unmutes every rifff on this channel and mutes every rifff on every other channel', () => {
      let state = reducer(initialState, {
        type: 'ADD_TO_SHELF',
        rifff: makeRifff({ groupId: 'r1' })
      })
      state = reducer(state, { type: 'ADD_TO_SHELF', rifff: makeRifff({ groupId: 'r2' }) })
      state = reducer(state, { type: 'ADD_TO_SHELF', rifff: makeRifff({ groupId: 'r3' }) })
      state = reducer(state, {
        type: 'MOVE_TO_CHANNEL',
        groupId: 'r1',
        startBar: 0,
        channelId: 'chan-a'
      })
      state = reducer(state, {
        type: 'MOVE_TO_CHANNEL',
        groupId: 'r2',
        startBar: 4,
        channelId: 'chan-a'
      })
      state = reducer(state, {
        type: 'MOVE_TO_CHANNEL',
        groupId: 'r3',
        startBar: 0,
        channelId: 'chan-b'
      })
      state = reducer(state, { type: 'SOLO_CHANNEL', channelId: 'chan-a' })
      expect(state.mute['r1:1']).toBe(false)
      expect(state.mute['r2:1']).toBe(false)
      expect(state.mute['r3:1']).toBe(true)
    })

    it('toggles back to fully unmuted when dispatched again for the already-soloed channel', () => {
      let state = reducer(initialState, {
        type: 'ADD_TO_SHELF',
        rifff: makeRifff({ groupId: 'r1' })
      })
      state = reducer(state, { type: 'ADD_TO_SHELF', rifff: makeRifff({ groupId: 'r2' }) })
      state = reducer(state, {
        type: 'MOVE_TO_CHANNEL',
        groupId: 'r1',
        startBar: 0,
        channelId: 'chan-a'
      })
      state = reducer(state, {
        type: 'MOVE_TO_CHANNEL',
        groupId: 'r2',
        startBar: 0,
        channelId: 'chan-b'
      })
      state = reducer(state, { type: 'SOLO_CHANNEL', channelId: 'chan-a' })
      state = reducer(state, { type: 'SOLO_CHANNEL', channelId: 'chan-a' })
      expect(state.mute['r1:1']).toBe(false)
      expect(state.mute['r2:1']).toBe(false)
    })
  })

  describe('SET_GROUP_VOLUME', () => {
    it('sets every stem in the rifff to the same volume at once', () => {
      let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
      state = reducer(state, { type: 'SET_GROUP_VOLUME', groupId: 'r1', volume: 0.3 })
      expect(state.vol['r1:1']).toBe(0.3)
      expect(state.vol['r1:6']).toBe(0.3)
    })

    it('clamps to [0, 1]', () => {
      let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
      state = reducer(state, { type: 'SET_GROUP_VOLUME', groupId: 'r1', volume: 1.5 })
      expect(state.vol['r1:1']).toBe(1)
      state = reducer(state, { type: 'SET_GROUP_VOLUME', groupId: 'r1', volume: -1 })
      expect(state.vol['r1:1']).toBe(0)
    })

    it('does not affect other rifffs', () => {
      let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
      state = reducer(state, {
        type: 'ADD_TO_SHELF',
        rifff: makeRifff({ groupId: 'r2' })
      })
      state = reducer(state, { type: 'SET_GROUP_VOLUME', groupId: 'r1', volume: 0.3 })
      expect(state.vol['r1:1']).toBe(0.3)
      expect(state.vol['r2:1']).not.toBe(0.3)
    })
  })

  describe('SET_MASTER_CHAIN_PLUGIN', () => {
    it('sets the given slot to the given plugin id, leaving other slots untouched', () => {
      let state = reducer(initialState, {
        type: 'SET_MASTER_CHAIN_PLUGIN',
        slot: 1,
        pluginId: 'pro-q-3'
      })
      expect(state.masterChain).toEqual([null, 'pro-q-3', null, null])

      state = reducer(state, { type: 'SET_MASTER_CHAIN_PLUGIN', slot: 3, pluginId: 'soothe2' })
      expect(state.masterChain).toEqual([null, 'pro-q-3', null, 'soothe2'])
    })

    it('clears a slot back to null', () => {
      let state = reducer(initialState, {
        type: 'SET_MASTER_CHAIN_PLUGIN',
        slot: 0,
        pluginId: 'pro-q-3'
      })
      state = reducer(state, { type: 'SET_MASTER_CHAIN_PLUGIN', slot: 0, pluginId: null })
      expect(state.masterChain).toEqual([null, null, null, null])
    })
  })

  describe('SET_MASTER_CHAIN_PLUGIN (migration overwrite case)', () => {
    it('overwrites an old allowlist slug with a real catalog id', () => {
      let state = reducer(initialState, {
        type: 'SET_MASTER_CHAIN_PLUGIN',
        slot: 0,
        pluginId: 'solid-bus-comp'
      })
      state = reducer(state, {
        type: 'SET_MASTER_CHAIN_PLUGIN',
        slot: 0,
        pluginId: 'VST3-1234-real-identifier-string'
      })
      expect(state.masterChain[0]).toBe('VST3-1234-real-identifier-string')
    })
  })

  describe('SET_CHANNEL_CHAIN_PLUGIN', () => {
    it('sets the given channel+slot to the given plugin id, leaving other channels/slots untouched', () => {
      let state = reducer(initialState, {
        type: 'SET_CHANNEL_CHAIN_PLUGIN',
        channelId: 'ch-1',
        slot: 0,
        pluginId: 'pro-q-3'
      })
      expect(state.channelPlugins['ch-1']).toEqual(['pro-q-3', null])

      state = reducer(state, {
        type: 'SET_CHANNEL_CHAIN_PLUGIN',
        channelId: 'ch-1',
        slot: 1,
        pluginId: 'soothe2'
      })
      expect(state.channelPlugins['ch-1']).toEqual(['pro-q-3', 'soothe2'])
      expect(state.channelPlugins['ch-2']).toBeUndefined()
    })
  })

  describe('channelPlugins cleanup on channel removal', () => {
    it('REMOVE_FROM_TIMELINE deletes channelPlugins for a channel that becomes empty', () => {
      let state = reducer(initialState, {
        type: 'ADD_TO_SHELF',
        rifff: makeRifff({ groupId: 'r1' })
      })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
      state = reducer(state, {
        type: 'SET_CHANNEL_CHAIN_PLUGIN',
        channelId: 'r1',
        slot: 0,
        pluginId: 'pro-q-3'
      })
      expect(state.channelPlugins['r1']).toEqual(['pro-q-3', null])

      state = reducer(state, { type: 'REMOVE_FROM_TIMELINE', groupId: 'r1' })
      expect(state.channelPlugins['r1']).toBeUndefined()
    })

    it('DELETE_RIFFFS deletes channelPlugins for a channel that becomes empty', () => {
      let state = reducer(initialState, {
        type: 'ADD_TO_SHELF',
        rifff: makeRifff({ groupId: 'r1' })
      })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
      state = reducer(state, {
        type: 'SET_CHANNEL_CHAIN_PLUGIN',
        channelId: 'r1',
        slot: 0,
        pluginId: 'pro-q-3'
      })

      state = reducer(state, { type: 'DELETE_RIFFFS', groupIds: ['r1'] })
      expect(state.channelPlugins['r1']).toBeUndefined()
    })

    it('MOVE_TO_CHANNEL deletes channelPlugins for the previous channel once it becomes empty, keeps the destination channel untouched', () => {
      let state = reducer(initialState, {
        type: 'ADD_TO_SHELF',
        rifff: makeRifff({ groupId: 'r1' })
      })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
      state = reducer(state, {
        type: 'SET_CHANNEL_CHAIN_PLUGIN',
        channelId: 'r1',
        slot: 0,
        pluginId: 'pro-q-3'
      })
      state = reducer(state, {
        type: 'SET_CHANNEL_CHAIN_PLUGIN',
        channelId: 'other-channel',
        slot: 0,
        pluginId: 'soothe2'
      })

      state = reducer(state, {
        type: 'MOVE_TO_CHANNEL',
        groupId: 'r1',
        startBar: 0,
        channelId: 'other-channel'
      })
      expect(state.channelPlugins['r1']).toBeUndefined()
      expect(state.channelPlugins['other-channel']).toEqual(['soothe2', null])
    })

    // channelPlugins' own doc comment states it's "deleted in lockstep with
    // channelOrder's own cleanup ... never a separate pass" -- a recording
    // channel is exempt from that cleanup in channelOrder (see "a recording
    // channel survives..." below), so its channelPlugins must be exempt the
    // same way, or the two silently fall out of lockstep the moment a
    // recording channel's last clip is deleted this way.
    it('DELETE_RIFFFS keeps channelPlugins for a recording channel that becomes empty', () => {
      let state = reducer(initialState, { type: 'ADD_RECORDING_CHANNEL', channelId: 'rec-1' })
      state = reducer(state, {
        type: 'ADD_TO_SHELF',
        rifff: makeRifff({ groupId: 'r1' })
      })
      state = reducer(state, {
        type: 'MOVE_TO_CHANNEL',
        groupId: 'r1',
        startBar: 0,
        channelId: 'rec-1'
      })
      state = reducer(state, {
        type: 'SET_CHANNEL_CHAIN_PLUGIN',
        channelId: 'rec-1',
        slot: 0,
        pluginId: 'pro-q-3'
      })

      state = reducer(state, { type: 'DELETE_RIFFFS', groupIds: ['r1'] })
      expect(state.channelOrder).toContain('rec-1')
      expect(state.channelPlugins['rec-1']).toEqual(['pro-q-3', null])
    })
  })

  describe('SET_LOOP_REGION', () => {
    it('sets the loop region', () => {
      const next = reducer(initialState, {
        type: 'SET_LOOP_REGION',
        region: { startBar: 4, endBar: 12 }
      })
      expect(next.loopRegion).toEqual({ startBar: 4, endBar: 12 })
    })

    it('clears the loop region when given null', () => {
      const withRegion = reducer(initialState, {
        type: 'SET_LOOP_REGION',
        region: { startBar: 4, endBar: 12 }
      })
      const cleared = reducer(withRegion, { type: 'SET_LOOP_REGION', region: null })
      expect(cleared.loopRegion).toBeNull()
    })
  })

  describe('ADD_RECORDING_CHANNEL', () => {
    it('creates a new channel id, marked as a recording channel', () => {
      const next = reducer(initialState, { type: 'ADD_RECORDING_CHANNEL', channelId: 'rec-1' })
      expect(next.channelOrder).toContain('rec-1')
      expect(next.recordingChannelIds['rec-1']).toBe(true)
    })
  })

  describe('REMOVE_RECORDING_CHANNEL', () => {
    it('removes the channel from channelOrder and recordingChannelIds', () => {
      const withChannel = reducer(initialState, {
        type: 'ADD_RECORDING_CHANNEL',
        channelId: 'rec-1'
      })
      const next = reducer(withChannel, { type: 'REMOVE_RECORDING_CHANNEL', channelId: 'rec-1' })
      expect(next.channelOrder).not.toContain('rec-1')
      expect(next.recordingChannelIds['rec-1']).toBeUndefined()
    })

    it('disarms the channel first if it was armed', () => {
      const withChannel = reducer(initialState, {
        type: 'ADD_RECORDING_CHANNEL',
        channelId: 'rec-1'
      })
      const armed = reducer(withChannel, { type: 'ARM_RECORDING_CHANNEL', channelId: 'rec-1' })
      const next = reducer(armed, { type: 'REMOVE_RECORDING_CHANNEL', channelId: 'rec-1' })
      expect(next.armedChannelId).toBeNull()
    })
  })

  describe('a recording channel survives REMOVE_FROM_TIMELINE emptying it', () => {
    it('does not evict a recording channel from channelOrder just because its last clip left', () => {
      const withChannel = reducer(initialState, {
        type: 'ADD_RECORDING_CHANNEL',
        channelId: 'rec-1'
      })
      const rifff = { ...makeRifff({ groupId: 'g1' }), startBar: 0 }
      const withClip: AppState = {
        ...withChannel,
        rifffs: { g1: rifff },
        channelOf: { g1: 'rec-1' }
      }
      const next = reducer(withClip, { type: 'REMOVE_FROM_TIMELINE', groupId: 'g1' })
      expect(next.channelOrder).toContain('rec-1')
    })
  })

  describe('ARM_RECORDING_CHANNEL / DISARM_RECORDING_CHANNEL', () => {
    it('arms the given channel', () => {
      const withChannel = reducer(initialState, {
        type: 'ADD_RECORDING_CHANNEL',
        channelId: 'rec-1'
      })
      const next = reducer(withChannel, { type: 'ARM_RECORDING_CHANNEL', channelId: 'rec-1' })
      expect(next.armedChannelId).toBe('rec-1')
    })

    it('disarms back to null', () => {
      const withChannel = reducer(initialState, {
        type: 'ADD_RECORDING_CHANNEL',
        channelId: 'rec-1'
      })
      const armed = reducer(withChannel, { type: 'ARM_RECORDING_CHANNEL', channelId: 'rec-1' })
      const next = reducer(armed, { type: 'DISARM_RECORDING_CHANNEL' })
      expect(next.armedChannelId).toBeNull()
    })
  })
})
