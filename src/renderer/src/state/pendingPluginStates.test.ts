import { describe, expect, it, vi } from 'vitest'
import { initialPluginSwitchState } from '@shared/pluginSwitch'
import {
  markFreshPluginChoice,
  pendingPluginStatesGeneration,
  pluginCaptureFallback,
  pluginsHeldStatus,
  pluginSwitchStateRef,
  recordPluginCapture,
  replacePendingPluginStates,
  setPluginsHeldStatus,
  subscribePluginsHeld
} from './pendingPluginStates'
import { markPluginsTouched, pluginsTouchedSnapshot } from './pluginsTouched'

const verb = (blob: string): { pluginId: string; stateBase64: string } => ({
  pluginId: 'verb',
  stateBase64: blob
})

describe('the capture fallback', () => {
  it('keeps the latest capture per slot, for the open project only', () => {
    replacePendingPluginStates({})
    const generation = pendingPluginStatesGeneration()
    recordPluginCapture({ 'master:0': verb('ONE'), 'master:1': verb('X') }, generation)
    recordPluginCapture({ 'master:0': verb('TWO') }, generation)
    expect(pluginCaptureFallback()).toEqual({ 'master:0': verb('TWO'), 'master:1': verb('X') })

    replacePendingPluginStates({}) // another project opened
    expect(pluginCaptureFallback()).toEqual({})
    // A capture that started before it landed afterwards: dropped.
    recordPluginCapture({ 'master:0': verb('OLD') }, generation)
    expect(pluginCaptureFallback()).toEqual({})
  })

  it('opening a project clears the plugins-touched flag', () => {
    markPluginsTouched()
    replacePendingPluginStates({})
    expect(pluginsTouchedSnapshot().touched).toBe(false)
  })
})

describe('markFreshPluginChoice', () => {
  it('marks the slot fresh in the switch state StoreContext steps next', () => {
    pluginSwitchStateRef.current = {
      ...initialPluginSwitchState,
      parked: { 'master:1': { verb: 'OLD' } }
    }
    markFreshPluginChoice({ kind: 'master', slot: 1 })
    expect(pluginSwitchStateRef.current.fresh).toEqual(['master:1'])
    expect(pluginSwitchStateRef.current.parked['master:1']).toBeUndefined()
    pluginSwitchStateRef.current = initialPluginSwitchState
  })
})

describe('the plugins-held notice status', () => {
  it('tells subscribers when it changes, and only then', () => {
    const listener = vi.fn()
    const unsubscribe = subscribePluginsHeld(listener)
    setPluginsHeldStatus('retrying')
    setPluginsHeldStatus('retrying')
    expect(pluginsHeldStatus()).toBe('retrying')
    setPluginsHeldStatus('gave-up')
    setPluginsHeldStatus('none')
    expect(listener).toHaveBeenCalledTimes(3)
    unsubscribe()
  })
})
