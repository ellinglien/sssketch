import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearPluginsTouched,
  editorOpenMarksUnsaved,
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

  it('a clear is not a new version: it never restarts the autosave (a save then writes no stale recovery file)', () => {
    markPluginsTouched()
    const v = pluginsTouchedSnapshot().version
    const listener = vi.fn()
    const unsubscribe = subscribePluginsTouched(listener)
    clearPluginsTouched(v)
    expect(pluginsTouchedSnapshot().touched).toBe(false)
    expect(pluginsTouchedSnapshot().version).toBe(v)
    expect(listener).toHaveBeenCalledTimes(1) // still told: the unsaved dot goes
    unsubscribe()
  })

  it('a save started before a clear still sees its own version (a clear by an open between)', () => {
    markPluginsTouched()
    const atSaveStart = pluginsTouchedSnapshot().version
    clearPluginsTouched() // a project opened meanwhile
    clearPluginsTouched(atSaveStart)
    expect(pluginsTouchedSnapshot().touched).toBe(false)
  })

  it('only a bridged plugin`s editor marks the project unsaved by opening (the engine cannot watch it)', () => {
    expect(editorOpenMarksUnsaved('x86_64')).toBe(true)
    expect(editorOpenMarksUnsaved('arm64')).toBe(false)
    expect(editorOpenMarksUnsaved('universal')).toBe(false)
    expect(editorOpenMarksUnsaved(undefined)).toBe(false)
  })

  it('a snapshot is stable between changes (useSyncExternalStore)', () => {
    expect(pluginsTouchedSnapshot()).toBe(pluginsTouchedSnapshot())
  })
})
