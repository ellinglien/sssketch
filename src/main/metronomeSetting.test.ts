import { describe, expect, it, vi } from 'vitest'
import { createMetronomeSetting } from './metronomeSetting'

describe('createMetronomeSetting', () => {
  it('sends a change to the engine as it is made', () => {
    const send = vi.fn()
    createMetronomeSetting().apply(send, true, 0.8)
    expect(send).toHaveBeenCalledWith('set-metronome', { enabled: true, volume: 0.8 })
  })

  it('re-sends the latest setting to a respawned engine, which starts at its own defaults', () => {
    const setting = createMetronomeSetting()
    setting.apply(vi.fn(), true, 0.8)
    setting.apply(vi.fn(), false, 0.4)
    const respawned = vi.fn()
    setting.resend(respawned)
    expect(respawned).toHaveBeenCalledExactlyOnceWith('set-metronome', {
      enabled: false,
      volume: 0.4
    })
  })

  it('keeps a change made before the engine is up, and sends it once the engine starts', () => {
    const setting = createMetronomeSetting()
    setting.apply(undefined, true, 0.8)
    const started = vi.fn()
    setting.resend(started)
    expect(started).toHaveBeenCalledExactlyOnceWith('set-metronome', {
      enabled: true,
      volume: 0.8
    })
  })

  it('sends nothing on respawn before the renderer has set it', () => {
    const respawned = vi.fn()
    createMetronomeSetting().resend(respawned)
    expect(respawned).not.toHaveBeenCalled()
  })
})
