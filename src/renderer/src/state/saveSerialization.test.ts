import { describe, expect, it } from 'vitest'
import { initialState, reducer, type AppState } from './store'
import { deserializeProject } from './serialize'
import {
  autosaveAction,
  autosaveDelayMs,
  createAutosaveGate,
  dirtyCheckJson,
  liveSettingsForSave,
  projectJsonForSave,
  saveCompletionIsCurrent,
  saveOutcomeNotice
} from './saveSerialization'
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

describe('saveOutcomeNotice', () => {
  it('says nothing after a save that holds the newest edits', () => {
    expect(saveOutcomeNotice({ kind: 'saved' }, 'save')).toBeNull()
    expect(saveOutcomeNotice({ kind: 'saved' }, 'leaving')).toBeNull()
  })

  it('always reports a failed save, with its error', () => {
    expect(saveOutcomeNotice({ kind: 'failed', error: 'disk full' }, 'save')).toBe(
      'Save failed: disk full'
    )
    expect(saveOutcomeNotice({ kind: 'failed', error: 'disk full' }, 'leaving')).toBe(
      'Save failed: disk full'
    )
  })

  it('explains a save that went stale only when it stops a quit, New or open', () => {
    expect(saveOutcomeNotice({ kind: 'changed' }, 'save')).toBeNull()
    expect(saveOutcomeNotice({ kind: 'changed' }, 'leaving')).toMatch(/changed while it was saving/)
  })
})

describe('saveCompletionIsCurrent', () => {
  it('rejects newer project or plugin edits made while a save was awaiting', () => {
    expect(saveCompletionIsCurrent('saved', 'saved', 4, 4)).toBe(true)
    expect(saveCompletionIsCurrent('saved', 'newer project', 4, 4)).toBe(false)
    expect(saveCompletionIsCurrent('saved', 'saved', 4, 5)).toBe(false)
  })
})

function withPlugins(): AppState {
  let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff })
  state = reducer(state, { type: 'SET_MASTER_CHAIN_PLUGIN', slot: 0, pluginId: 'verb' })
  state = reducer(state, { type: 'SET_MASTER_CHAIN_PLUGIN', slot: 1, pluginId: 'comp' })
  return state
}

const chainsOf = (
  state: AppState
): { masterChain: (string | null)[]; channelPlugins: AppState['channelPlugins'] } => ({
  masterChain: state.masterChain,
  channelPlugins: state.channelPlugins
})

describe('liveSettingsForSave', () => {
  it('takes the engine`s settings only for the slots it holds for this project', () => {
    const state = withPlugins()
    const raw: RawPluginStatesCapture = {
      masterChain: ['VERB-LIVE', 'COMP-LIVE', '', ''],
      channelChains: []
    }
    expect(liveSettingsForSave(raw, chainsOf(state), new Set(['master:0']))).toEqual({
      'master:0': { pluginId: 'verb', stateBase64: 'VERB-LIVE' }
    })
    expect(liveSettingsForSave(null, chainsOf(state), new Set(['master:0']))).toEqual({})
  })
})

describe('projectJsonForSave', () => {
  it('writes the engine`s live settings for a loaded plugin, and the saved ones for a plugin not loaded', () => {
    const state = withPlugins()
    const pending: PluginStatesMap = {
      'master:1': { pluginId: 'comp', stateBase64: 'COMP-SAVED' }
    }
    const live = liveSettingsForSave(
      { masterChain: ['VERB-LIVE', '', '', ''], channelChains: [] },
      chainsOf(state),
      new Set(['master:0', 'master:1'])
    )
    const json = projectJsonForSave(state, live, pending, {})
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
    expect(JSON.parse(projectJsonForSave(state, {}, pending, {})).pluginStates).toEqual(pending)
  })

  it('never writes another project`s settings for the same plugin: a slot the engine does not hold for this project takes this project`s own', () => {
    // Project B open, same plugin in the same slot as project A, whose instance the engine
    // still has (held, or a capture/load in flight): slotsEngineHolds leaves master:0 out.
    const state = withPlugins()
    const bSaved: PluginStatesMap = { 'master:0': { pluginId: 'verb', stateBase64: 'B-VERB' } }
    const live = liveSettingsForSave(
      { masterChain: ['A-VERB', '', '', ''], channelChains: [] },
      chainsOf(state),
      new Set()
    )
    expect(JSON.parse(projectJsonForSave(state, live, bSaved, {})).pluginStates).toEqual(bSaved)
  })

  it('fills a slot neither held nor pending from the latest capture; saved settings beat it, live ones beat both', () => {
    const state = withPlugins()
    const fallback: PluginStatesMap = {
      'master:0': { pluginId: 'verb', stateBase64: 'VERB-CAPTURED' },
      'master:1': { pluginId: 'comp', stateBase64: 'COMP-CAPTURED' },
      'master:2': { pluginId: 'gone', stateBase64: 'NOT-IN-THE-SLOT' }
    }
    const pending: PluginStatesMap = { 'master:1': { pluginId: 'comp', stateBase64: 'COMP-SAVED' } }
    expect(JSON.parse(projectJsonForSave(state, {}, pending, fallback)).pluginStates).toEqual({
      'master:0': { pluginId: 'verb', stateBase64: 'VERB-CAPTURED' },
      'master:1': { pluginId: 'comp', stateBase64: 'COMP-SAVED' }
    })
    const live = { 'master:0': { pluginId: 'verb', stateBase64: 'VERB-LIVE' } }
    expect(
      JSON.parse(projectJsonForSave(state, live, pending, fallback)).pluginStates['master:0']
    ).toEqual(live['master:0'])
  })
})

describe('createAutosaveGate', () => {
  it('drops an autosave started before a save, a discard or a clear', () => {
    const gate = createAutosaveGate()
    const before = gate.begin()
    expect(gate.isCurrent(before)).toBe(true)
    gate.bump()
    expect(gate.isCurrent(before)).toBe(false)
    expect(gate.isCurrent(gate.begin())).toBe(true)
  })
})

describe('autosaveDelayMs', () => {
  it('is the debounce after a lone change', () => {
    expect(autosaveDelayMs(1000, 1000, 4000, 30_000)).toBe(4000)
  })

  it('never lets constant changes (a plugin reporting its own) put it off past the max wait', () => {
    // Unsaved since t=0, a change every 750 ms: each restart of the timer is shorter, and at
    // the max wait it fires at once.
    expect(autosaveDelayMs(27_000, 0, 4000, 30_000)).toBe(3000)
    expect(autosaveDelayMs(29_250, 0, 4000, 30_000)).toBe(750)
    expect(autosaveDelayMs(31_000, 0, 4000, 30_000)).toBe(0)
  })
})

describe('autosaveAction', () => {
  it('writes only while something is unsaved', () => {
    expect(autosaveAction(true, false)).toBe('write')
    expect(autosaveAction(true, true)).toBe('write')
  })

  it('with nothing unsaved: clears a recovery file this session wrote, else does nothing', () => {
    // Saved, or edited back to the saved state: a recovery file would only offer what is on disk.
    expect(autosaveAction(false, true)).toBe('clear')
    // Never wrote one (just opened, just saved): leave the disk alone -- a file there may be a
    // previous session's crash recovery, still waiting on the user.
    expect(autosaveAction(false, false)).toBe('skip')
  })
})

describe('dirtyCheckJson', () => {
  it('a project with plugin settings reads as saved right after it is opened, and right after a save', () => {
    const state = withPlugins()
    const pending: PluginStatesMap = { 'master:0': { pluginId: 'verb', stateBase64: 'V' } }
    const fileJson = projectJsonForSave(state, {}, pending, {})
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
