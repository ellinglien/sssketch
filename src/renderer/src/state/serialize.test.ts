import { describe, expect, it } from 'vitest'
import { initialState, reducer } from './store'
import { serializeProject, deserializeProject, type LegacyPersistedProject } from './serialize'
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

  it('does not persist gatedRecordingTargetGroupId -- always reopens with nothing targeted', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff })
    state = reducer(state, { type: 'SET_GATED_RECORDING_TARGET', groupId: 'r1' })
    expect(state.gatedRecordingTargetGroupId).toBe('r1')

    const json = serializeProject(state)
    expect(JSON.parse(json).gatedRecordingTargetGroupId).toBeUndefined()

    const restored = deserializeProject(JSON.parse(json))
    expect(restored.gatedRecordingTargetGroupId).toBeNull()
  })

  it('does not persist pendingLockInConfirm -- always reopens with the confirm dialog hidden', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff })
    state = reducer(state, { type: 'SET_PENDING_LOCK_IN_CONFIRM', pending: true })
    expect(state.pendingLockInConfirm).toBe(true)

    const json = serializeProject(state)
    expect(JSON.parse(json).pendingLockInConfirm).toBeUndefined()

    const restored = deserializeProject(JSON.parse(json))
    expect(restored.pendingLockInConfirm).toBe(false)
  })

  it('does not persist tidiedView/gatedRecordingEnabled/gatedRecordingChannelId -- always reopens at their defaults', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff })
    state = reducer(state, { type: 'TOGGLE_TIDIED_VIEW' })
    state = reducer(state, { type: 'SET_GATED_RECORDING_ENABLED', enabled: true })
    state = reducer(state, { type: 'SET_GATED_RECORDING_CHANNEL', channelId: 'r1' })
    expect(state.tidiedView).toBe(true)
    expect(state.gatedRecordingEnabled).toBe(true)
    expect(state.gatedRecordingChannelId).toBe('r1')

    const json = serializeProject(state)
    const parsed = JSON.parse(json)
    expect(parsed.tidiedView).toBeUndefined()
    expect(parsed.gatedRecordingEnabled).toBeUndefined()
    expect(parsed.gatedRecordingChannelId).toBeUndefined()

    const restored = deserializeProject(parsed)
    expect(restored.tidiedView).toBe(initialState.tidiedView)
    expect(restored.gatedRecordingEnabled).toBe(initialState.gatedRecordingEnabled)
    expect(restored.gatedRecordingChannelId).toBe(initialState.gatedRecordingChannelId)
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

describe('deserializeProject snapIdx clamp', () => {
  it('clamps an old save with snapIdx 3 (pre-cap 1/32) down to 2 (1/16, the new coarsest)', () => {
    // SNAP_DIVS was [4, 8, 16, 32] before the 1/32 division was removed; it's
    // now [4, 8, 16] (see store.ts), so a save from before that cap can carry
    // snapIdx: 3, which is out of range for the current SNAP_DIVS and would
    // read back as undefined everywhere SNAP_DIVS[state.snapIdx] is used.
    const persisted = {
      ...JSON.parse(serializeProject(reducer(initialState, { type: 'ADD_TO_SHELF', rifff }))),
      snapIdx: 3
    } as unknown as import('./serialize').PersistedProject

    const restored = deserializeProject(persisted)
    expect(restored.snapIdx).toBe(2)
  })
})

describe('deserializeProject barLength noise migration', () => {
  // Real confirmed example: importRecordedStem's tempo-compensation math
  // (src/main/importOneShot.ts, before the 033a1c7 source-side fix) could
  // produce a barLength polluted by sample-quantization noise instead of
  // the clean integer it was designed to land on. ADD_STEM_TO_RIFFF folds a
  // stem's barLength into the whole rifff's own barLength via Math.max, so
  // the noise corrupts both levels. The source-side fix only stops NEW
  // noise from being written; a project saved before it landed still has
  // the raw noisy value in its JSON and needs this load-time migration.
  const noisyBarLength = 16.000003184020517

  it('snaps a noisy near-integer rifff.barLength to the exact integer', () => {
    const persisted = {
      ...JSON.parse(serializeProject(reducer(initialState, { type: 'ADD_TO_SHELF', rifff }))),
      rifffs: { r1: { ...rifff, barLength: noisyBarLength } }
    } as unknown as import('./serialize').PersistedProject

    const restored = deserializeProject(persisted)
    expect(restored.rifffs.r1.barLength).toBe(16)
  })

  it('snaps a noisy near-integer stem.barLength (within a rifff) to the exact integer', () => {
    const persisted = {
      ...JSON.parse(serializeProject(reducer(initialState, { type: 'ADD_TO_SHELF', rifff }))),
      rifffs: {
        r1: {
          ...rifff,
          stems: [{ ...rifff.stems[0], barLength: noisyBarLength }]
        }
      }
    } as unknown as import('./serialize').PersistedProject

    const restored = deserializeProject(persisted)
    expect(restored.rifffs.r1.stems[0].barLength).toBe(16)
  })

  it('leaves a genuinely fractional barLength (real tempo compensation) untouched at both levels', () => {
    const persisted = {
      ...JSON.parse(serializeProject(reducer(initialState, { type: 'ADD_TO_SHELF', rifff }))),
      rifffs: {
        r1: {
          ...rifff,
          barLength: 7.75,
          stems: [{ ...rifff.stems[0], barLength: 7.75 }]
        }
      }
    } as unknown as import('./serialize').PersistedProject

    const restored = deserializeProject(persisted)
    expect(restored.rifffs.r1.barLength).toBe(7.75)
    expect(restored.rifffs.r1.stems[0].barLength).toBe(7.75)
  })
})

describe('deserializeProject migration from trackOrder', () => {
  it('migrates an old-shape project (trackOrder, no channelOrder/channelOf) into one channel per clip, same order', () => {
    const legacy = {
      rifffs: {
        r1: { ...rifff, startBar: 0 },
        r2: { ...rifff, groupId: 'r2', startBar: 4 }
      },
      trackOrder: ['r1', 'r2']
    } as unknown as LegacyPersistedProject
    const restored = deserializeProject(legacy)
    expect(restored.channelOrder).toEqual(['r1', 'r2'])
    expect(restored.channelOf).toEqual({ r1: 'r1', r2: 'r2' })
    expect(restored.rifffs.r1.startBar).toBe(0)
    expect(restored.rifffs.r2.startBar).toBe(4)
  })

  it('does not re-migrate a project that already has channelOrder', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
    const persisted = JSON.parse(serializeProject(state))
    const restored = deserializeProject(persisted)
    expect(restored.channelOrder).toEqual(['r1'])
    expect(restored.channelOf).toEqual({ r1: 'r1' })
  })
})
