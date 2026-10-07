import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearPluginsTouched,
  markPluginsTouched,
  pluginsTouchedSnapshot,
  subscribePluginsTouched
} from './pluginsTouched'

describe('pluginsTouched', () => {
  beforeEach(() => clearPluginsTouched())

  it('is set by opening or using a plugin editor, and cleared by a save or an open', () => {
    expect(pluginsTouchedSnapshot().touched).toBe(false)
    markPluginsTouched()
    expect(pluginsTouchedSnapshot().touched).toBe(true)
    clearPluginsTouched()
    expect(pluginsTouchedSnapshot().touched).toBe(false)
  })

  it('a save clears it only if nothing was touched while it was writing', () => {
    markPluginsTouched()
    const atSaveStart = pluginsTouchedSnapshot().version
    markPluginsTouched() // a knob turned during the save's round trip to the engine
    clearPluginsTouched(atSaveStart)
    expect(pluginsTouchedSnapshot().touched).toBe(true)
    clearPluginsTouched(pluginsTouchedSnapshot().version)
    expect(pluginsTouchedSnapshot().touched).toBe(false)
  })

  it('every touch is a new version (it restarts the autosave`s debounce) and tells subscribers', () => {
    const listener = vi.fn()
    const unsubscribe = subscribePluginsTouched(listener)
    const v0 = pluginsTouchedSnapshot().version
    markPluginsTouched()
    markPluginsTouched()
    expect(pluginsTouchedSnapshot().version).toBe(v0 + 2)
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
    markPluginsTouched()
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('a snapshot is stable between changes (useSyncExternalStore)', () => {
    expect(pluginsTouchedSnapshot()).toBe(pluginsTouchedSnapshot())
  })
})
