import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getYamnetModel = vi.fn()

beforeEach(() => {
  vi.resetModules()
  getYamnetModel.mockReset()
  vi.stubGlobal('window', { rifffApi: { getYamnetModel } })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('extractEmbedding with no YAMNet model (share-readiness audit B3)', () => {
  it('asks main once, logs once, and answers null for every stem after', async () => {
    getYamnetModel.mockResolvedValue(null)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { extractEmbedding } = await import('./yamnetClient')
    // several stems in flight at once, then more after
    const first = await Promise.all([0, 1, 2].map(() => extractEmbedding(new Float32Array(16))))
    expect(first).toEqual([null, null, null])
    for (let i = 0; i < 4; i++) {
      expect(await extractEmbedding(new Float32Array(16))).toBeNull()
    }
    expect(getYamnetModel).toHaveBeenCalledTimes(1)
    expect(error.mock.calls.length + warn.mock.calls.length).toBe(1)
  })

  it('a failed ask (IPC error) is retried, not taken as "no model"', async () => {
    getYamnetModel.mockRejectedValueOnce(new Error('ipc hiccup')).mockResolvedValue(null)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { extractEmbedding } = await import('./yamnetClient')
    expect(await extractEmbedding(new Float32Array(16))).toBeNull()
    expect(await extractEmbedding(new Float32Array(16))).toBeNull()
    expect(await extractEmbedding(new Float32Array(16))).toBeNull()
    expect(getYamnetModel).toHaveBeenCalledTimes(2)
  })
})
