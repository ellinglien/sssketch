// The project's sound settings in the renderer (native radio sound plan, Task 2): the reducer
// action, undo, save/load (a legacy project opens with the app-wide defaults), unsaved changes.
import { afterEach, describe, expect, it } from 'vitest'
import { initialState, reducer, startupState, type AppState } from './store'
import { appSoundDefaults, forgetAppSoundDefaults } from './appSoundDefaults'
import { createHistoryState, historyReducer } from './history'
import { deserializeProject, serializeProject } from './serialize'
import { hasUnsavedChanges } from './unsavedChanges'
import { DEFAULT_SOUND_SETTINGS, normalizeSoundSettings } from '@shared/radioSound'
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

const withSound = (): AppState => ({
  ...initialState,
  rifffs: { r1: rifff },
  sound: normalizeSoundSettings(undefined)
})

describe('SET_SOUND_SETTINGS', () => {
  it('merges a partial, stage by stage, leaving the rest as it was', () => {
    const next = reducer(withSound(), {
      type: 'SET_SOUND_SETTINGS',
      settings: { glue: { amount: 0.8 }, reverb: { room: 'zita' } }
    })
    expect(next.sound!.glue).toEqual({ on: true, amount: 0.8 })
    expect(next.sound!.reverb).toEqual({ room: 'zita', amount: 0.5 })
    expect(next.sound!.pump).toEqual(DEFAULT_SOUND_SETTINGS.pump)
  })

  it('clamps what it is given', () => {
    const next = reducer(withSound(), {
      type: 'SET_SOUND_SETTINGS',
      settings: { pump: { depthDb: 40 }, panning: { width: -1 } }
    })
    expect(next.sound!.pump.depthDb).toBe(8)
    expect(next.sound!.panning.width).toBe(0)
  })

  it('on a state with none, merges onto the app-wide defaults once they are known', async () => {
    const appDefaults = normalizeSoundSettings(undefined)
    appDefaults.pump.depthDb = 2
    await appSoundDefaults(async () => appDefaults)
    const next = reducer(initialState, {
      type: 'SET_SOUND_SETTINGS',
      settings: { tone: { on: false } }
    })
    expect(next.sound).toEqual({ ...appDefaults, tone: { on: false, amount: 0 } })
    forgetAppSoundDefaults()
  })

  it('on a state with none, before the app-wide defaults are known, starts from all on', () => {
    const next = reducer(initialState, {
      type: 'SET_SOUND_SETTINGS',
      settings: { tone: { on: false } }
    })
    expect(next.sound).toEqual({
      ...normalizeSoundSettings(undefined),
      tone: { on: false, amount: 0 }
    })
  })

  it('is undoable, like any project edit', () => {
    let h = createHistoryState(withSound())
    h = historyReducer(h, { type: 'SET_SOUND_SETTINGS', settings: { mastering: { on: false } } })
    expect(h.present.sound!.mastering.on).toBe(false)
    h = historyReducer(h, { type: 'UNDO' })
    expect(h.present.sound!.mastering.on).toBe(true)
  })
})

describe('the sound settings in a saved project', () => {
  it('round-trips', () => {
    const state = reducer(withSound(), {
      type: 'SET_SOUND_SETTINGS',
      settings: { saturation: { amount: 0.2 }, throws: { rate: 'often', level: 0.4 } }
    })
    const loaded = deserializeProject(JSON.parse(serializeProject(state))).state
    expect(loaded.sound).toEqual(state.sound)
  })

  it('a project saved before the radio sound opens with the app-wide defaults it is given', () => {
    const legacy = JSON.parse(serializeProject({ ...initialState, rifffs: { r1: rifff } }))
    expect('sound' in legacy).toBe(false)
    const appDefaults = normalizeSoundSettings(undefined)
    appDefaults.pump.on = false
    appDefaults.reverb.room = 'zita'
    expect(deserializeProject(legacy, appDefaults).state.sound).toEqual(appDefaults)
  })

  it('without app-wide defaults, a legacy project opens with every stage on', () => {
    const legacy = JSON.parse(serializeProject({ ...initialState, rifffs: { r1: rifff } }))
    expect(deserializeProject(legacy).state.sound).toEqual(DEFAULT_SOUND_SETTINGS)
  })

  it("a saved project's own settings win over the app-wide defaults", () => {
    const state = reducer(withSound(), {
      type: 'SET_SOUND_SETTINGS',
      settings: { glue: { on: false } }
    })
    const appDefaults = normalizeSoundSettings(undefined)
    appDefaults.glue.amount = 0.9
    const loaded = deserializeProject(JSON.parse(serializeProject(state)), appDefaults).state
    expect(loaded.sound!.glue).toEqual({ on: false, amount: 0.5 })
  })

  it('a hand-edited junk `sound` is normalised; missing fields come from the app-wide defaults', () => {
    const json = JSON.parse(serializeProject(withSound()))
    json.sound = { glue: { amount: 'lots' }, pump: { depthDb: 99 } }
    const appDefaults = normalizeSoundSettings(undefined)
    appDefaults.mastering.ceilingDb = -2
    const loaded = deserializeProject(json, appDefaults).state.sound!
    expect(loaded.glue).toEqual(DEFAULT_SOUND_SETTINGS.glue)
    expect(loaded.pump.depthDb).toBe(8)
    expect(loaded.mastering.ceilingDb).toBe(-2)
  })

  it('a settings edit is an unsaved change', () => {
    const state = withSound()
    const saved = serializeProject(state)
    const edited = reducer(state, {
      type: 'SET_SOUND_SETTINGS',
      settings: { tone: { amount: 0.5 } }
    })
    expect(hasUnsavedChanges(edited.rifffs, saved, saved)).toBe(false)
    expect(hasUnsavedChanges(edited.rifffs, serializeProject(edited), saved)).toBe(true)
  })
})

describe('the startup state (before any project is created or opened)', () => {
  afterEach(() => forgetAppSoundDefaults())

  it('has sound settings, all on, so a save from it carries them', () => {
    expect(startupState.sound).toEqual(DEFAULT_SOUND_SETTINGS)
    const saved = JSON.parse(serializeProject({ ...startupState, rifffs: { r1: rifff } }))
    expect(saved.sound).toEqual(DEFAULT_SOUND_SETTINGS)
  })

  it('ADOPT_APP_SOUND_DEFAULTS swaps in the app-wide defaults while the sound is untouched', () => {
    const appDefaults = normalizeSoundSettings(undefined)
    appDefaults.reverb.room = 'zita'
    const next = reducer(startupState, {
      type: 'ADOPT_APP_SOUND_DEFAULTS',
      sound: appDefaults,
      ifStill: startupState.sound!
    })
    expect(next.sound).toEqual(appDefaults)
  })

  it('...and not once the sound was edited or a project was loaded', () => {
    const edited = reducer(startupState, {
      type: 'SET_SOUND_SETTINGS',
      settings: { glue: { on: false } }
    })
    const appDefaults = normalizeSoundSettings(undefined)
    appDefaults.reverb.room = 'zita'
    const after = reducer(edited, {
      type: 'ADOPT_APP_SOUND_DEFAULTS',
      sound: appDefaults,
      ifStill: startupState.sound!
    })
    expect(after).toBe(edited)
  })

  it('is not an edit: no undo step', () => {
    let h = createHistoryState(startupState)
    h = historyReducer(h, {
      type: 'ADOPT_APP_SOUND_DEFAULTS',
      sound: normalizeSoundSettings(undefined),
      ifStill: startupState.sound!
    })
    expect(h.past).toHaveLength(0)
  })
})
