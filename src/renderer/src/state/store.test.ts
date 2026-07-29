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

  it('applying a bake repoints every stem at its baked path and resets offsets to 0', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
    state = reducer(state, { type: 'SET_OFFSET_STEPS', key: 'r1', steps: -6 })
    state = reducer(state, {
      type: 'APPLY_BAKE',
      groupId: 'r1',
      results: [
        { path: '/x/1.wav', bakedPath: '/x/1.baked.wav' },
        { path: '/x/6.wav', bakedPath: '/x/6.baked.wav' }
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
      results: [{ path: '/x/1.wav', bakedPath: '/x/1.baked.wav' }] // slot 6's file failed to bake
    })
    expect(state.rifffs.r1.stems.find((s) => s.slot === 1)?.path).toBe('/x/1.baked.wav')
    expect(state.rifffs.r1.stems.find((s) => s.slot === 6)?.path).toBe('/x/6.wav')
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

  it('unlink copies the group offset onto each stem key and flags unlinked', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
    state = reducer(state, { type: 'NUDGE_OFFSET', key: 'r1', delta: 3 })
    state = reducer(state, { type: 'UNLINK', groupId: 'r1' })
    expect(state.unlinked.r1).toBe(true)
    expect(state.off['r1:1']).toBe(3)
    expect(state.off['r1:6']).toBe(3)
  })

  it('unlink seeds each stem’s independent start at the group’s current position', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 6 })
    state = reducer(state, { type: 'UNLINK', groupId: 'r1' })
    expect(state.stemStart['r1:1']).toBe(6)
    expect(state.stemStart['r1:6']).toBe(6)
  })

  it('relink clears the unlinked flag', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
    state = reducer(state, { type: 'UNLINK', groupId: 'r1' })
    state = reducer(state, { type: 'RELINK', groupId: 'r1' })
    expect(state.unlinked.r1).toBe(false)
  })

  it('sets an independent stem start, clamped to 0', () => {
    let state = reducer(initialState, { type: 'SET_STEM_START', key: 'r1:1', startBar: 9 })
    expect(state.stemStart['r1:1']).toBe(9)
    state = reducer(state, { type: 'SET_STEM_START', key: 'r1:1', startBar: -3 })
    expect(state.stemStart['r1:1']).toBe(0)
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
    it('while linked, sets playedBars on the group key and moves the rifff’s own startBar', () => {
      let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 6 })
      state = reducer(state, {
        type: 'RESIZE_LEFT',
        groupId: 'r1',
        slot: 1,
        bars: 10,
        startBar: 4
      })
      expect(state.playedBars.r1).toBe(10)
      expect(state.rifffs.r1.startBar).toBe(4)
    })

    it('while unlinked, sets playedBars and stemStart on the stem’s own keys, leaving the rifff’s startBar untouched', () => {
      let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 6 })
      state = reducer(state, { type: 'UNLINK', groupId: 'r1' })
      state = reducer(state, {
        type: 'RESIZE_LEFT',
        groupId: 'r1',
        slot: 1,
        bars: 10,
        startBar: 4
      })
      expect(state.playedBars['r1:1']).toBe(10)
      expect(state.stemStart['r1:1']).toBe(4)
      expect(state.rifffs.r1.startBar).toBe(6)
    })

    it('clamps playedBars to a minimum of 0.25 and startBar to a minimum of 0', () => {
      let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 6 })
      state = reducer(state, {
        type: 'RESIZE_LEFT',
        groupId: 'r1',
        slot: 1,
        bars: -3,
        startBar: -2
      })
      expect(state.playedBars.r1).toBe(0.25)
      expect(state.rifffs.r1.startBar).toBe(0)
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

  it('pauses', () => {
    let state = reducer(initialState, { type: 'PLAY' })
    state = reducer(state, { type: 'PAUSE' })
    expect(state.playing).toBe(false)
  })

  it('stop resets position and pauses', () => {
    let state = reducer(initialState, { type: 'PLAY' })
    state = reducer(state, { type: 'SET_POS', pos: 12.5 })
    state = reducer(state, { type: 'STOP' })
    expect(state.playing).toBe(false)
    expect(state.pos).toBe(0)
  })

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
})
