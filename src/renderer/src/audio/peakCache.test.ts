import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function fakeBytes(): Uint8Array {
  return new Uint8Array([1, 2, 3, 4])
}

function fakeAudioBuffer(): { getChannelData: () => Float32Array } {
  return { getChannelData: () => new Float32Array([0.1, 0.5, 0.9, 0.2]) }
}

describe('peakCache', () => {
  let readAudioFileMock: ReturnType<typeof vi.fn>
  let decodeAudioDataMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    // Fresh module instance per test so the internal cache Map (and sharedContext)
    // don't leak state between tests.
    vi.resetModules()
    readAudioFileMock = vi.fn()
    decodeAudioDataMock = vi.fn()

    vi.stubGlobal('window', { rifffApi: { readAudioFile: readAudioFileMock } })
    class FakeAudioContext {
      decodeAudioData = decodeAudioDataMock
    }
    vi.stubGlobal('AudioContext', FakeAudioContext)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reuses the same in-flight promise across concurrent callers for the same path (fan-out prevention)', async () => {
    readAudioFileMock.mockResolvedValue(fakeBytes())
    decodeAudioDataMock.mockResolvedValue(fakeAudioBuffer())

    const { getPeaks } = await import('./peakCache')

    const [a, b] = await Promise.all([getPeaks('/some/path.wav'), getPeaks('/some/path.wav')])

    expect(a).toEqual(b)
    // The whole point of the cache: two overlapping callers for the same path must
    // not each trigger their own IPC read + decode.
    expect(readAudioFileMock).toHaveBeenCalledTimes(1)
    expect(decodeAudioDataMock).toHaveBeenCalledTimes(1)
  })

  it('evicts a rejected decode from the cache so a later call retries instead of reusing the dead promise', async () => {
    readAudioFileMock
      .mockRejectedValueOnce(new Error('permission denied'))
      .mockResolvedValueOnce(fakeBytes())
    decodeAudioDataMock.mockResolvedValue(fakeAudioBuffer())

    const { getPeaks } = await import('./peakCache')

    await expect(getPeaks('/some/path.wav')).rejects.toThrow('permission denied')

    // A transient failure must not permanently poison the cache: the next call for
    // the same path should attempt a fresh read rather than reusing the dead promise.
    const peaks = await getPeaks('/some/path.wav')
    expect(Array.isArray(peaks)).toBe(true)
    expect(readAudioFileMock).toHaveBeenCalledTimes(2)
  })

  it('does not permanently cache a rejection even when the failure is in decodeAudioData rather than the read', async () => {
    readAudioFileMock.mockResolvedValue(fakeBytes())
    decodeAudioDataMock
      .mockRejectedValueOnce(new Error('corrupt wav'))
      .mockResolvedValueOnce(fakeAudioBuffer())

    const { getPeaks } = await import('./peakCache')

    await expect(getPeaks('/some/path.wav')).rejects.toThrow('corrupt wav')

    const peaks = await getPeaks('/some/path.wav')
    expect(Array.isArray(peaks)).toBe(true)
    expect(decodeAudioDataMock).toHaveBeenCalledTimes(2)
  })

  it('getBrightness shares the same decode as getPeaks for the same path (no second read+decode)', async () => {
    readAudioFileMock.mockResolvedValue(fakeBytes())
    decodeAudioDataMock.mockResolvedValue(fakeAudioBuffer())

    const { getPeaks, getBrightness } = await import('./peakCache')

    const [peaks, brightness] = await Promise.all([
      getPeaks('/some/path.wav'),
      getBrightness('/some/path.wav')
    ])

    expect(Array.isArray(peaks)).toBe(true)
    expect(Array.isArray(brightness)).toBe(true)
    expect(readAudioFileMock).toHaveBeenCalledTimes(1)
    expect(decodeAudioDataMock).toHaveBeenCalledTimes(1)
  })

  it('getBrightness returns 128 buckets, each within [0, 1]', async () => {
    readAudioFileMock.mockResolvedValue(fakeBytes())
    decodeAudioDataMock.mockResolvedValue(fakeAudioBuffer())

    const { getBrightness } = await import('./peakCache')
    const brightness = await getBrightness('/some/path.wav')

    expect(brightness).toHaveLength(128)
    for (const v of brightness) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })
})
