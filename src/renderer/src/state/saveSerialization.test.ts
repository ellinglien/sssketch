import { describe, expect, it } from 'vitest'
import { initialState, reducer, type AppState } from './store'
import { deserializeProject } from './serialize'
import { dirtyCheckJson, projectJsonForSave } from './saveSerialization'
import { hasUnsavedChanges } from './unsavedChanges'
import type { PluginStatesMap, RawPluginStatesCapture } from '@shared/pluginStates'
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

function withPlugins(): AppState {
  let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff })
  state = reducer(state, { type: 'SET_MASTER_CHAIN_PLUGIN', slot: 0, pluginId: 'verb' })
  state = reducer(state, { type: 'SET_MASTER_CHAIN_PLUGIN', slot: 1, pluginId: 'comp' })
  return state
}

const emptyCapture: RawPluginStatesCapture = { masterChain: ['', '', '', ''], channelChains: [] }

describe('projectJsonForSave', () => {
  it('writes the engine`s live settings for a loaded plugin, and the saved ones for a plugin not loaded', () => {
    const state = withPlugins()
    const pending: PluginStatesMap = {
      'master:1': { pluginId: 'comp', stateBase64: 'COMP-SAVED' }
    }
    const json = projectJsonForSave(
      state,
      { masterChain: ['VERB-LIVE', '', '', ''], channelChains: [] },
      pending
    )
    expect(JSON.parse(json).pluginStates).toEqual({
      'master:0': { pluginId: 'verb', stateBase64: 'VERB-LIVE' },
      'master:1': { pluginId: 'comp', stateBase64: 'COMP-SAVED' }
    })
  })

  it('with plugins off (an empty engine) writes back exactly the settings it read', () => {
    const state = withPlugins()
    const pending: PluginStatesMap = {
      'master:0': { pluginId: 'verb', stateBase64: 'V' },
      'master:1': { pluginId: 'comp', stateBase64: 'C' }
    }
    expect(JSON.parse(projectJsonForSave(state, emptyCapture, pending)).pluginStates).toEqual(
      pending
    )
  })

  it('with no engine answer at all (best effort, the crash-recovery autosave) still writes the saved settings', () => {
    const state = withPlugins()
    const pending: PluginStatesMap = { 'master:0': { pluginId: 'verb', stateBase64: 'V' } }
    expect(JSON.parse(projectJsonForSave(state, null, pending)).pluginStates).toEqual(pending)
  })
})

describe('dirtyCheckJson', () => {
  it('a project with plugin settings reads as saved right after it is opened, and right after a save', () => {
    const state = withPlugins()
    const pending: PluginStatesMap = { 'master:0': { pluginId: 'verb', stateBase64: 'V' } }
    const fileJson = projectJsonForSave(state, emptyCapture, pending)
    const { state: opened, pluginStates } = deserializeProject(JSON.parse(fileJson))
    expect(pluginStates).toEqual(pending)
    // What App.tsx records as "last saved" when opening it, and what it compares live:
    expect(hasUnsavedChanges(opened.rifffs, dirtyCheckJson(opened), dirtyCheckJson(opened))).toBe(
      false
    )
    // The file a save writes differs from the dirty check only by the plugin settings, so the
    // baseline a save records matches the live check.
    const { pluginStates: written, ...rest } = JSON.parse(fileJson)
    expect(written).toEqual(pending)
    expect(rest).toEqual(JSON.parse(dirtyCheckJson(state)))
  })
})
