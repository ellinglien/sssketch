import { describe, expect, it } from 'vitest'
import {
  pendingPluginStatesGeneration,
  pluginCaptureFallback,
  recordPluginCapture,
  replacePendingPluginStates
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
