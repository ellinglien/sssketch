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
  let getStemPeaksCacheMock: ReturnType<typeof vi.fn>
  let setStemPeaksCacheMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    // Fresh module instance per test so the internal cache Map (and sharedContext)
    // don't leak state between tests.
    vi.resetModules()
    readAudioFileMock = vi.fn()
    decodeAudioDataMock = vi.fn()
    getStemPeaksCacheMock = vi.fn().mockResolvedValue(null)
    setStemPeaksCacheMock = vi.fn().mockResolvedValue(undefined)

    vi.stubGlobal('window', {
      rifffApi: {
        readAudioFile: readAudioFileMock,
        getStemPeaksCache: getStemPeaksCacheMock,
        setStemPeaksCache: setStemPeaksCacheMock
      }
    })
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

  it('returns a persisted peaks/brightness pair without decoding at all', async () => {
    const persisted = {
      peaks: Array.from({ length: 128 }, (_, i) => i / 128),
      brightness: Array.from({ length: 128 }, (_, i) => 1 - i / 128)
    }
    getStemPeaksCacheMock.mockResolvedValue(persisted)

    const { getPeaks, getBrightness } = await import('./peakCache')
    const peaks = await getPeaks('/some/path.wav')
    const brightness = await getBrightness('/some/path.wav')

    expect(peaks).toEqual(persisted.peaks)
    expect(brightness).toEqual(persisted.brightness)
    expect(readAudioFileMock).not.toHaveBeenCalled()
    expect(decodeAudioDataMock).not.toHaveBeenCalled()
  })

  it('persists a freshly decoded peaks/brightness pair via setStemPeaksCache', async () => {
    readAudioFileMock.mockResolvedValue(fakeBytes())
    decodeAudioDataMock.mockResolvedValue(fakeAudioBuffer())

    const { getPeaks } = await import('./peakCache')
    const peaks = await getPeaks('/some/path.wav')

    expect(setStemPeaksCacheMock).toHaveBeenCalledWith('/some/path.wav', {
      peaks,
      brightness: expect.any(Array)
    })
  })
  describe('getDecodedDuration', () => {
    it('is the length of the same decode the waveform used: one read, one decode', async () => {
      readAudioFileMock.mockResolvedValue(fakeBytes())
      decodeAudioDataMock.mockResolvedValue({ ...fakeAudioBuffer(), duration: 3.75 })

      const { getPeaks, getDecodedDuration } = await import('./peakCache')
      const [, duration] = await Promise.all([
        getPeaks('/loops/a.mp3'),
        getDecodedDuration('/loops/a.mp3')
      ])

      expect(duration).toBe(3.75)
      expect(readAudioFileMock).toHaveBeenCalledTimes(1)
      expect(decodeAudioDataMock).toHaveBeenCalledTimes(1)
    })

    it('a later call after the waveform settled reuses it rather than decoding again', async () => {
      readAudioFileMock.mockResolvedValue(fakeBytes())
      decodeAudioDataMock.mockResolvedValue({ ...fakeAudioBuffer(), duration: 2 })

      const { getPeaks, getDecodedDuration } = await import('./peakCache')
      await getPeaks('/loops/a.mp3')
      expect(await getDecodedDuration('/loops/a.mp3')).toBe(2)
      expect(decodeAudioDataMock).toHaveBeenCalledTimes(1)
    })

    it('rejects with a failed decode, and the next call retries', async () => {
      readAudioFileMock.mockResolvedValue(fakeBytes())
      decodeAudioDataMock
        .mockRejectedValueOnce(new Error('corrupt'))
        .mockResolvedValueOnce({ ...fakeAudioBuffer(), duration: 1.5 })

      const { getDecodedDuration } = await import('./peakCache')
      await expect(getDecodedDuration('/loops/a.mp3')).rejects.toThrow('corrupt')
      expect(await getDecodedDuration('/loops/a.mp3')).toBe(1.5)
      expect(decodeAudioDataMock).toHaveBeenCalledTimes(2)
    })

    it('is null when the peaks came from the persisted cache (no buffer was decoded)', async () => {
      getStemPeaksCacheMock.mockResolvedValue({ peaks: [0], brightness: [0] })

      const { getDecodedDuration } = await import('./peakCache')
      expect(await getDecodedDuration('/some/path.wav')).toBeNull()
      expect(decodeAudioDataMock).not.toHaveBeenCalled()
    })

    it('evictWaveform forgets the length along with the peaks', async () => {
      readAudioFileMock.mockResolvedValue(fakeBytes())
      decodeAudioDataMock
        .mockResolvedValueOnce({ ...fakeAudioBuffer(), duration: 1 })
        .mockResolvedValueOnce({ ...fakeAudioBuffer(), duration: 2 })

      const { getDecodedDuration, evictWaveform } = await import('./peakCache')
      expect(await getDecodedDuration('/loops/a.wav')).toBe(1)
      evictWaveform('/loops/a.wav')
      expect(await getDecodedDuration('/loops/a.wav')).toBe(2)
    })
  })
})
