import { describe, expect, it } from 'vitest'
import { initialState, reducer, type AppState } from './store'
import { serializeProject, deserializeProject, type LegacyPersistedProject } from './serialize'
import type { Rifff } from '@shared/types'
import { edgeFadeState } from '@shared/automationEdit'

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
    const { state: restored } = deserializeProject(JSON.parse(json))

    expect(restored.bpm).toBe(96)
    expect(restored.off.r1).toBe(2)
    expect(restored.rifffs.r1.name).toBe('test')
    // playing/pos aren't part of AppState at all anymore (they're
    // StoreContext.tsx's own transport state, never touched by serialization)
    // — nothing to assert here now the way there used to be.
  })

  it('does not persist the arranger mode — always reopens in the normal arranger', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff })
    state = reducer(state, { type: 'SET_ARRANGER_MODE', mode: 'automation' })
    expect(state.mode).toBe('automation')

    const json = serializeProject(state)
    expect(JSON.parse(json).mode).toBeUndefined()

    // Which mode a load lands in is decided by the load rules (see
    // deserializeProject), never by what was showing when it was saved.
    const { state: restored } = deserializeProject(JSON.parse(json))
    expect(restored.mode).not.toBe('automation')
  })

  it('does not persist inspectorCollapsed — always reopens with it expanded', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff })
    state = reducer(state, { type: 'TOGGLE_INSPECTOR_COLLAPSED' })
    expect(state.inspectorCollapsed).toBe(true)

    const json = serializeProject(state)
    expect(JSON.parse(json).inspectorCollapsed).toBeUndefined()

    const { state: restored } = deserializeProject(JSON.parse(json))
    expect(restored.inspectorCollapsed).toBe(false)
  })

  it('does not persist gatedRecordingTargetGroupId -- always reopens with nothing targeted', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff })
    state = reducer(state, { type: 'SET_GATED_RECORDING_TARGET', groupId: 'r1' })
    expect(state.gatedRecordingTargetGroupId).toBe('r1')

    const json = serializeProject(state)
    expect(JSON.parse(json).gatedRecordingTargetGroupId).toBeUndefined()

    const { state: restored } = deserializeProject(JSON.parse(json))
    expect(restored.gatedRecordingTargetGroupId).toBeNull()
  })

  it('does not persist pendingLockInConfirm -- always reopens with the confirm dialog hidden', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff })
    state = reducer(state, { type: 'SET_PENDING_LOCK_IN_CONFIRM', pending: true })
    expect(state.pendingLockInConfirm).toBe(true)

    const json = serializeProject(state)
    expect(JSON.parse(json).pendingLockInConfirm).toBeUndefined()

    const { state: restored } = deserializeProject(JSON.parse(json))
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

    const { state: restored } = deserializeProject(parsed)
    expect(restored.tidiedView).toBe(initialState.tidiedView)
    expect(restored.gatedRecordingEnabled).toBe(initialState.gatedRecordingEnabled)
    expect(restored.gatedRecordingChannelId).toBe(initialState.gatedRecordingChannelId)
  })

  it('persists drawn automation curves but not which parameter each lane was showing', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff })
    state = reducer(state, {
      type: 'SET_STEM_AUTOMATION',
      stemKey: 'r1:1',
      param: 'filterCutoff',
      points: [
        { bar: 0, value: 1 },
        { bar: 8, value: 0 }
      ]
    })
    state = reducer(state, { type: 'SET_AUTOMATION_PARAM', laneId: 'r1:1', param: 'reverbSend' })

    const parsed = JSON.parse(serializeProject(state))
    expect(parsed.automationParamOf).toBeUndefined()

    const { state: restored } = deserializeProject(parsed)
    expect(restored.stemAutomation['r1:1'].filterCutoff).toEqual([
      { bar: 0, value: 1 },
      { bar: 8, value: 0 }
    ])
    expect(restored.automationParamOf).toEqual({})
  })
})

describe('deserializeProject mode fallback', () => {
  it('defaults to sketch mode for a plain (sketch-eligible) loaded arrangement', () => {
    const persisted = JSON.parse(serializeProject(initialState))
    expect(deserializeProject(persisted).state.mode).toBe('sketch')
  })

  it('falls back to normal mode when the loaded arrangement is not sketch-eligible', () => {
    let state = reducer(initialState, {
      type: 'ADD_TO_SHELF',
      rifff: { ...rifff, startBar: undefined }
    })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
    state = reducer(state, { type: 'NUDGE_OFFSET', key: 'r1', delta: 1 }) // disqualifies sketch
    const persisted = JSON.parse(serializeProject(state))
    expect(deserializeProject(persisted).state.mode).toBe('normal')
  })

  it('leaves automation mode alone -- only sketch has an eligibility requirement', () => {
    // mode isn't persisted, so this has to be forced onto the parsed object
    // the way a hand-edited .sssketchproj could; the point is that the
    // sketch-eligibility fallback doesn't kick a non-sketch mode to normal.
    const persisted = {
      ...JSON.parse(serializeProject(reducer(initialState, { type: 'ADD_TO_SHELF', rifff }))),
      mode: 'automation'
    } as unknown as import('./serialize').PersistedProject
    expect(deserializeProject(persisted).state.mode).toBe('automation')
  })
})

describe('deserializeProject snapIdx clamp', () => {
  it('clamps an out-of-range snapIdx down to 4 (1/16, the current array bound)', () => {
    // SNAP_DIVS is now [1, 2, 4, 8, 16] (see store.ts) -- a save carrying an
    // out-of-range snapIdx (e.g. a pre-1/32-cap save's snapIdx: 3, from back
    // when SNAP_DIVS was [4, 8, 16, 32]) would read back as undefined
    // everywhere SNAP_DIVS[state.snapIdx] is used without this clamp.
    const persisted = {
      ...JSON.parse(serializeProject(reducer(initialState, { type: 'ADD_TO_SHELF', rifff }))),
      snapIdx: 7
    } as unknown as import('./serialize').PersistedProject

    const { state: restored } = deserializeProject(persisted)
    expect(restored.snapIdx).toBe(4)
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

    const { state: restored } = deserializeProject(persisted)
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

    const { state: restored } = deserializeProject(persisted)
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

    const { state: restored } = deserializeProject(persisted)
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
    const { state: restored } = deserializeProject(legacy)
    expect(restored.channelOrder).toEqual(['r1', 'r2'])
    expect(restored.channelOf).toEqual({ r1: 'r1', r2: 'r2' })
    expect(restored.rifffs.r1.startBar).toBe(0)
    expect(restored.rifffs.r2.startBar).toBe(4)
  })

  it('does not re-migrate a project that already has channelOrder', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
    const persisted = JSON.parse(serializeProject(state))
    const { state: restored } = deserializeProject(persisted)
    expect(restored.channelOrder).toEqual(['r1'])
    expect(restored.channelOf).toEqual({ r1: 'r1' })
  })
})

// ---- built-in sound toolkit persistence ----
// docs/superpowers/specs/2026-09-22-builtin-sound-toolkit-design.md. The
// toolkit needs no serializer code of its own: serializeProject writes the
// whole AppState minus a named list of transient UI fields, and
// deserializeProject spreads the parsed data over initialState -- so new
// arrangement state persists and old files load with defaults automatically.
// These tests exist to pin that, since "no code needed" is exactly the kind
// of property a later refactor can quietly break.
describe('toolkit persistence', () => {
  const filters = { 'r1:1': { mode: 'highpass' as const, cutoff: 0.4, resonance: 0.6 } }
  const automation = {
    'r1:1': {
      filterCutoff: [
        { bar: 0, value: 0.1 },
        { bar: 8, value: 0.9 }
      ]
    }
  }

  it('round-trips per-clip filters, sends, automation and reverb settings', () => {
    const state = {
      ...initialState,
      stemFilters: filters,
      stemSends: { 'r1:1': 0.35 },
      stemAutomation: automation,
      reverb: { roomSize: 0.8, damping: 0.2, preDelayMs: 45 }
    }
    const { state: restored } = deserializeProject(JSON.parse(serializeProject(state)))
    expect(restored.stemFilters).toEqual(filters)
    expect(restored.stemSends).toEqual({ 'r1:1': 0.35 })
    expect(restored.stemAutomation).toEqual(automation)
    expect(restored.reverb).toEqual({ roomSize: 0.8, damping: 0.2, preDelayMs: 45 })
  })

  it('loads a project saved before the toolkit existed with neutral defaults', () => {
    // Exactly what an older .sssketchproj looks like: none of the four keys
    // present at all. It must load without complaint AND land on values
    // buildEngineProject drops from the wire entirely, so the engine takes
    // its pre-toolkit path and the project sounds identical to before.
    const legacy = JSON.parse(serializeProject(initialState))
    delete legacy.stemFilters
    delete legacy.stemSends
    delete legacy.stemAutomation
    delete legacy.reverb

    const { state: restored } = deserializeProject(legacy)
    expect(restored.stemFilters).toEqual({})
    expect(restored.stemSends).toEqual({})
    expect(restored.stemAutomation).toEqual({})
    expect(restored.reverb).toEqual({ roomSize: 0.5, damping: 0.5, preDelayMs: 20 })
  })

  it('DROPS the channel-scoped toolkit a project saved on 2026-09-22 may carry', () => {
    // The toolkit was per CHANNEL for one day before the live walkthrough
    // moved it to per CLIP (spec section 2b). There is no honest migration
    // -- a channel's curve belonged to every clip on that row at once, in
    // absolute bars -- so such a project loads with NO automation rather
    // than with wrong automation. The part that actually matters is that it
    // loads at all, and that the stale keys don't survive onto AppState
    // where nothing reads them.
    const saved = {
      ...JSON.parse(serializeProject(initialState)),
      channelFilters: { ch1: { mode: 'lowpass', cutoff: 0.3, resonance: 0.2 } },
      channelSends: { ch1: 0.5 },
      channelAutomation: { ch1: { volume: [{ bar: 0, value: 0.2 }] } }
    }
    const { state: restored } = deserializeProject(saved)
    expect(restored.stemFilters).toEqual({})
    expect(restored.stemSends).toEqual({})
    expect(restored.stemAutomation).toEqual({})
    expect('channelFilters' in restored).toBe(false)
    expect('channelSends' in restored).toBe(false)
    expect('channelAutomation' in restored).toBe(false)
  })
})

describe('loading a project saved with the old per-rifff edge fades', () => {
  // The shape a pre-2026-09-22 .sssketchproj actually has: a plain
  // serialized AppState from back then, i.e. today's minus the toolkit,
  // plus fadeIn/fadeOut keyed by groupId. Built by serializing a current
  // state and adding the old keys back, so the fixture can't drift away
  // from what deserializeProject really receives.
  function savedWithFades(
    fades: { fadeIn?: Record<string, number>; fadeOut?: Record<string, number> },
    build: (state: AppState) => AppState = (s) => s
  ): Parameters<typeof deserializeProject>[0] {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: twoStemRifff })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 4 })
    state = build(state)
    return { ...JSON.parse(serializeProject(state)), ...fades }
  }

  const twoStemRifff: Rifff = {
    ...rifff,
    barLength: 8,
    startBar: undefined,
    stems: [
      { slot: 1, author: 'e', name: 'a', type: 'fx', path: '/a.wav', durationSec: 1, barLength: 8 },
      { slot: 2, author: 'e', name: 'b', type: 'fx', path: '/b.wav', durationSec: 1, barLength: 8 }
    ]
  }

  it('rewrites a saved fade-in/fade-out as the same shape on every stem of that rifff', () => {
    const { state } = deserializeProject(savedWithFades({ fadeIn: { r1: 2 }, fadeOut: { r1: 1 } }))

    for (const key of ['r1:1', 'r1:2']) {
      const curve = state.stemAutomation[key]?.volume
      expect(curve).toBeDefined()
      // The clip is 8 bars long (barLength 8, no crop, stretch on), so a
      // 2-bar fade-in and a 1-bar fade-out are exactly what the lane's own
      // edge grabbers would read back out of these points.
      expect(edgeFadeState(curve!, 'start', 8)).toEqual({ bars: 2, level: 1 })
      expect(edgeFadeState(curve!, 'end', 8)).toEqual({ bars: 1, level: 1 })
    }
  })

  it('drops the old fields entirely rather than carrying them into state', () => {
    const { state } = deserializeProject(savedWithFades({ fadeIn: { r1: 2 } }))
    expect('fadeIn' in state).toBe(false)
    expect('fadeOut' in state).toBe(false)
  })

  it('leaves the clip gain alone -- the dial stays the level, the curve is only the shape', () => {
    const { state } = deserializeProject(
      savedWithFades({ fadeIn: { r1: 2 } }, (s) =>
        reducer(s, { type: 'SET_GROUP_VOLUME', groupId: 'r1', volume: 0.4 })
      )
    )
    expect(state.vol['r1:1']).toBe(0.4)
    // ...and the fade still rises to the curve's own full 1.0, not to 0.4:
    // the two multiply, they don't replace each other.
    expect(state.stemAutomation['r1:1']?.volume).toEqual([
      { bar: 0, value: 0 },
      { bar: 2, value: 1 }
    ])
  })

  it("measures the fade against the clip's own resized length, not its raw barLength", () => {
    const { state } = deserializeProject(
      savedWithFades({ fadeOut: { r1: 1 } }, (s) =>
        reducer(s, { type: 'SET_PLAYED_BARS', key: 'r1', bars: 4 })
      )
    )
    // A 4-bar clip: the fade-out's zero has to land on bar 4, the clip's
    // own right edge, not on bar 8.
    expect(state.stemAutomation['r1:1']?.volume).toEqual([
      { bar: 3, value: 1 },
      { bar: 4, value: 0 }
    ])
  })

  it('splices the fade onto a curve the project already had, leaving the rest of it alone', () => {
    const { state } = deserializeProject(
      savedWithFades({ fadeIn: { r1: 1 } }, (s) =>
        reducer(s, {
          type: 'SET_STEM_AUTOMATION',
          stemKey: 'r1:1',
          param: 'volume',
          points: [
            { bar: 4, value: 0.5 },
            { bar: 6, value: 0.5 }
          ]
        })
      )
    )
    // The fade rises to the level the curve ALREADY holds at its far end
    // (0.5 here, applyEdgeFade's own rule) rather than overshooting to 1.0
    // and dropping straight back down, and everything past the fade is
    // untouched.
    expect(state.stemAutomation['r1:1']?.volume).toEqual([
      { bar: 0, value: 0 },
      { bar: 1, value: 0.5 },
      { bar: 4, value: 0.5 },
      { bar: 6, value: 0.5 }
    ])
  })

  it('writes nothing at all for a project that never had a fade', () => {
    const { state } = deserializeProject(savedWithFades({}))
    expect(state.stemAutomation).toEqual({})
  })

  it('survives junk in the old fields, and a fade naming a rifff that is gone', () => {
    const { state } = deserializeProject(
      savedWithFades({
        fadeIn: { r1: Number.NaN, 'long-deleted': 2 },
        fadeOut: 'not a record' as unknown as Record<string, number>
      })
    )
    expect(state.stemAutomation).toEqual({})
    expect(state.rifffs.r1).toBeDefined()
  })
})
