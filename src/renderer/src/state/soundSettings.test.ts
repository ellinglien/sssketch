// The project's sound settings in the renderer (native radio sound plan, Task 2): the reducer
// action, undo, save/load (a legacy project opens with the app-wide defaults), unsaved changes.
import { describe, expect, it } from 'vitest'
import { initialState, reducer, type AppState } from './store'
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

  it('on a state with none, starts from the defaults', () => {
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
