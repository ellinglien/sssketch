import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function fakeBytes(): Uint8Array {
  return new Uint8Array([1, 2, 3, 4])
}

function fakeAudioBuffer(): { getChannelData: () => Float32Array; sampleRate: number } {
  return {
    getChannelData: () => new Float32Array(256).fill(0.3),
    sampleRate: 44100
  }
}

describe('pitchCache', () => {
  let readAudioFileMock: ReturnType<typeof vi.fn>
  let decodeAudioDataMock: ReturnType<typeof vi.fn>
  let getStemGlyphCacheMock: ReturnType<typeof vi.fn>
  let setStemGlyphCacheMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules()
    readAudioFileMock = vi.fn()
    decodeAudioDataMock = vi.fn()
    getStemGlyphCacheMock = vi.fn().mockResolvedValue(null)
    setStemGlyphCacheMock = vi.fn().mockResolvedValue(undefined)

    vi.stubGlobal('window', {
      rifffApi: {
        readAudioFile: readAudioFileMock,
        getStemGlyphCache: getStemGlyphCacheMock,
        setStemGlyphCache: setStemGlyphCacheMock
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

  it('reuses the same in-flight promise across concurrent callers for the same path', async () => {
    readAudioFileMock.mockResolvedValue(fakeBytes())
    decodeAudioDataMock.mockResolvedValue(fakeAudioBuffer())

    const { getPitchContour } = await import('./pitchCache')

    const [a, b] = await Promise.all([
      getPitchContour('/some/path.wav'),
      getPitchContour('/some/path.wav')
    ])

    expect(a).toEqual(b)
    expect(readAudioFileMock).toHaveBeenCalledTimes(1)
    expect(decodeAudioDataMock).toHaveBeenCalledTimes(1)
  })

  it('evicts a rejected decode so a later call retries', async () => {
    readAudioFileMock
      .mockRejectedValueOnce(new Error('permission denied'))
      .mockResolvedValueOnce(fakeBytes())
    decodeAudioDataMock.mockResolvedValue(fakeAudioBuffer())

    const { getPitchContour } = await import('./pitchCache')

    await expect(getPitchContour('/some/path.wav')).rejects.toThrow('permission denied')

    const result = await getPitchContour('/some/path.wav')
    expect(result.freqHz.length).toBe(result.numFrames)
    expect(readAudioFileMock).toHaveBeenCalledTimes(2)
  })

  it('a persisted hit decodes nothing and writes nothing', async () => {
    const freqHz = new Float32Array([0, 220.5, 441.25])
    getStemGlyphCacheMock.mockResolvedValue({
      bands: null,
      pitch: { numFrames: 3, bytes: new Uint8Array(freqHz.buffer.slice(0)) }
    })

    const { getPitchContour } = await import('./pitchCache')
    const contour = await getPitchContour('/some/path.wav')
    expect(contour.numFrames).toBe(3)
    expect(Array.from(contour.freqHz)).toEqual(Array.from(freqHz))
    expect(readAudioFileMock).not.toHaveBeenCalled()
    expect(decodeAudioDataMock).not.toHaveBeenCalled()
    expect(setStemGlyphCacheMock).not.toHaveBeenCalled()
  })

  it('a miss decodes once and writes the full-resolution contour once', async () => {
    readAudioFileMock.mockResolvedValue(fakeBytes())
    decodeAudioDataMock.mockResolvedValue(fakeAudioBuffer())

    const { getPitchContour } = await import('./pitchCache')
    const contour = await getPitchContour('/some/path.wav')

    expect(decodeAudioDataMock).toHaveBeenCalledTimes(1)
    expect(setStemGlyphCacheMock).toHaveBeenCalledTimes(1)
    const [path, write] = setStemGlyphCacheMock.mock.calls[0]
    expect(path).toBe('/some/path.wav')
    expect(write.bands).toBeUndefined()
    expect(write.pitch.numFrames).toBe(contour.numFrames)
    expect(Array.from(new Float32Array(write.pitch.bytes.buffer))).toEqual(
      Array.from(contour.freqHz)
    )
  })

  it('a primed contour is not written', async () => {
    const { getPitchContour, primePitchContour } = await import('./pitchCache')
    const contour = { numFrames: 1, freqHz: new Float32Array([100]) }
    primePitchContour('/some/path.wav', contour)
    expect(await getPitchContour('/some/path.wav')).toBe(contour)
    expect(getStemGlyphCacheMock).not.toHaveBeenCalled()
    expect(setStemGlyphCacheMock).not.toHaveBeenCalled()
  })

  it('keeps at most PRIMED_ENTRY_CAP primed contours; requested ones survive; an evicted one recomputes once', async () => {
    readAudioFileMock.mockResolvedValue(fakeBytes())
    decodeAudioDataMock.mockResolvedValue(fakeAudioBuffer())
    const { getPitchContour, primePitchContour } = await import('./pitchCache')
    const { PRIMED_ENTRY_CAP } = await import('./primedEntries')
    const contour = (): { numFrames: number; freqHz: Float32Array } => ({
      numFrames: 1,
      freqHz: new Float32Array([100])
    })

    // a screen asks for a primed path (promoted), and computes another
    const requested = contour()
    primePitchContour('/requested', requested)
    expect(await getPitchContour('/requested')).toBe(requested)
    const computed = await getPitchContour('/computed')
    expect(decodeAudioDataMock).toHaveBeenCalledTimes(1)

    for (let i = 0; i <= PRIMED_ENTRY_CAP; i++) primePitchContour(`/p${i}`, contour())

    expect(await getPitchContour('/requested')).toBe(requested)
    expect(await getPitchContour('/computed')).toBe(computed)
    await getPitchContour('/p1')
    expect(decodeAudioDataMock).toHaveBeenCalledTimes(1)

    // /p0 was the oldest primed path: evicted, computed again once
    const [a, b] = await Promise.all([getPitchContour('/p0'), getPitchContour('/p0')])
    expect(a).toBe(b)
    await getPitchContour('/p0')
    expect(decodeAudioDataMock).toHaveBeenCalledTimes(2)
  })
})
