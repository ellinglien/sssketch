import { describe, expect, it } from 'vitest'
import { buildPluginStatesMap, stateForSlot, type RawPluginStatesCapture } from './pluginStates'

describe('buildPluginStatesMap', () => {
  it('includes a master slot only when both a pluginId and a non-empty captured state exist', () => {
    const raw: RawPluginStatesCapture = {
      masterChain: ['AQIDBA==', '', '', ''],
      channelChains: []
    }
    const masterChain: (string | null)[] = ['reverb-plugin', null, null, null]
    const map = buildPluginStatesMap(raw, masterChain, {})
    expect(map).toEqual({
      'master:0': { pluginId: 'reverb-plugin', stateBase64: 'AQIDBA==' }
    })
  })

  it('omits a slot when the engine captured a state but AppState has no pluginId there (race/stale)', () => {
    const raw: RawPluginStatesCapture = {
      masterChain: ['AQIDBA==', '', '', ''],
      channelChains: []
    }
    const masterChain: (string | null)[] = [null, null, null, null]
    const map = buildPluginStatesMap(raw, masterChain, {})
    expect(map).toEqual({})
  })

  it('omits a slot when AppState has a pluginId but the engine captured no state (empty slot, or capture legitimately empty)', () => {
    const raw: RawPluginStatesCapture = {
      masterChain: ['', '', '', ''],
      channelChains: []
    }
    const masterChain: (string | null)[] = ['reverb-plugin', null, null, null]
    const map = buildPluginStatesMap(raw, masterChain, {})
    expect(map).toEqual({})
  })

  it('includes channel chain slots, keyed by channel:<channelId>:<slot>', () => {
    const raw: RawPluginStatesCapture = {
      masterChain: ['', '', '', ''],
      channelChains: [{ channelId: 'kick', slots: ['Q0FUUw==', ''] }]
    }
    const channelPlugins: Record<string, [string | null, string | null]> = {
      kick: ['comp-plugin', null]
    }
    const map = buildPluginStatesMap(raw, [null, null, null, null], channelPlugins)
    expect(map).toEqual({
      'channel:kick:0': { pluginId: 'comp-plugin', stateBase64: 'Q0FUUw==' }
    })
  })

  it('ignores a channel chain entry for a channelId AppState no longer knows about', () => {
    const raw: RawPluginStatesCapture = {
      masterChain: ['', '', '', ''],
      channelChains: [{ channelId: 'stale-channel', slots: ['AQ==', ''] }]
    }
    const map = buildPluginStatesMap(raw, [null, null, null, null], {})
    expect(map).toEqual({})
  })
})

describe('stateForSlot', () => {
  it('returns the blob when the captured pluginId matches what is being loaded', () => {
    const pluginStates = { 'master:0': { pluginId: 'reverb-plugin', stateBase64: 'AQIDBA==' } }
    expect(stateForSlot(pluginStates, 'master:0', 'reverb-plugin')).toBe('AQIDBA==')
  })

  it('returns undefined when the pluginId does not match (a different plugin is being loaded into this slot)', () => {
    const pluginStates = { 'master:0': { pluginId: 'reverb-plugin', stateBase64: 'AQIDBA==' } }
    expect(stateForSlot(pluginStates, 'master:0', 'other-plugin')).toBeUndefined()
  })

  it('returns undefined when there is no entry for this slot at all', () => {
    expect(stateForSlot({}, 'master:0', 'reverb-plugin')).toBeUndefined()
  })

  it('returns undefined when pluginId being loaded is null (an unload/empty-slot request)', () => {
    const pluginStates = { 'master:0': { pluginId: 'reverb-plugin', stateBase64: 'AQIDBA==' } }
    expect(stateForSlot(pluginStates, 'master:0', null)).toBeUndefined()
  })
})
