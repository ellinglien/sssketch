import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computeBandEnergy } from '@shared/bandEnergy'
import { glyphBandsFrom, GLYPH_BAND_POINTS } from '@shared/glyphBands'

function fakeBytes(): Uint8Array {
  return new Uint8Array([1, 2, 3, 4])
}

const samples = (() => {
  const n = 8192
  const data = new Float32Array(n)
  for (let i = 0; i < n; i++) data[i] = Math.sin((2 * Math.PI * 220 * i) / 44100) * 0.5
  return data
})()

function fakeAudioBuffer(): { getChannelData: () => Float32Array; sampleRate: number } {
  return { getChannelData: () => samples, sampleRate: 44100 }
}

describe('bandEnergyCache', () => {
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

    const { getGlyphBands } = await import('./bandEnergyCache')

    const [a, b] = await Promise.all([
      getGlyphBands('/some/path.wav'),
      getGlyphBands('/some/path.wav')
    ])

    expect(a).toBe(b)
    expect(getStemGlyphCacheMock).toHaveBeenCalledTimes(1)
    expect(readAudioFileMock).toHaveBeenCalledTimes(1)
    expect(decodeAudioDataMock).toHaveBeenCalledTimes(1)
  })

  it('evicts a rejected decode so a later call retries', async () => {
    readAudioFileMock
      .mockRejectedValueOnce(new Error('permission denied'))
      .mockResolvedValueOnce(fakeBytes())
    decodeAudioDataMock.mockResolvedValue(fakeAudioBuffer())

    const { getGlyphBands } = await import('./bandEnergyCache')

    await expect(getGlyphBands('/some/path.wav')).rejects.toThrow('permission denied')

    const result = await getGlyphBands('/some/path.wav')
    expect(result.bass).toHaveLength(GLYPH_BAND_POINTS)
    expect(readAudioFileMock).toHaveBeenCalledTimes(2)
  })

  it('a miss decodes once, computes the glyph-resolution bands and writes them once', async () => {
    readAudioFileMock.mockResolvedValue(fakeBytes())
    decodeAudioDataMock.mockResolvedValue(fakeAudioBuffer())

    const { getGlyphBands } = await import('./bandEnergyCache')
    const result = await getGlyphBands('/some/path.wav')

    expect(result).toEqual(glyphBandsFrom(computeBandEnergy(samples, 44100)))
    expect(decodeAudioDataMock).toHaveBeenCalledTimes(1)
    expect(setStemGlyphCacheMock).toHaveBeenCalledTimes(1)
    expect(setStemGlyphCacheMock).toHaveBeenCalledWith('/some/path.wav', { bands: result })
  })

  it('a persisted hit decodes nothing and writes nothing', async () => {
    const bands = glyphBandsFrom(computeBandEnergy(samples, 44100))
    getStemGlyphCacheMock.mockResolvedValue({ bands, pitch: null })

    const { getGlyphBands } = await import('./bandEnergyCache')
    expect(await getGlyphBands('/some/path.wav')).toEqual(bands)
    expect(readAudioFileMock).not.toHaveBeenCalled()
    expect(decodeAudioDataMock).not.toHaveBeenCalled()
    expect(setStemGlyphCacheMock).not.toHaveBeenCalled()
  })

  it('a failed persisted read counts as a miss', async () => {
    getStemGlyphCacheMock.mockRejectedValue(new Error('ipc down'))
    readAudioFileMock.mockResolvedValue(fakeBytes())
    decodeAudioDataMock.mockResolvedValue(fakeAudioBuffer())

    const { getGlyphBands } = await import('./bandEnergyCache')
    expect((await getGlyphBands('/some/path.wav')).mid).toHaveLength(GLYPH_BAND_POINTS)
    expect(decodeAudioDataMock).toHaveBeenCalledTimes(1)
  })

  it('a primed path reads, decodes and writes nothing', async () => {
    const bands = glyphBandsFrom(computeBandEnergy(samples, 44100))
    const { getGlyphBands, primeGlyphBands } = await import('./bandEnergyCache')
    primeGlyphBands('/some/path.wav', bands)
    expect(await getGlyphBands('/some/path.wav')).toBe(bands)
    expect(getStemGlyphCacheMock).not.toHaveBeenCalled()
    expect(decodeAudioDataMock).not.toHaveBeenCalled()
    expect(setStemGlyphCacheMock).not.toHaveBeenCalled()
  })

  it('bands and pitch for the same path share one persisted read', async () => {
    const bands = glyphBandsFrom(computeBandEnergy(samples, 44100))
    getStemGlyphCacheMock.mockResolvedValue({
      bands,
      pitch: { numFrames: 2, bytes: new Uint8Array(new Float32Array([110, 0]).buffer) }
    })
    const { getGlyphBands } = await import('./bandEnergyCache')
    const { getPitchContour } = await import('./pitchCache')
    const [b, p] = await Promise.all([getGlyphBands('/x'), getPitchContour('/x')])
    expect(b).toEqual(bands)
    expect(Array.from(p.freqHz)).toEqual([110, 0])
    expect(getStemGlyphCacheMock).toHaveBeenCalledTimes(1)
    expect(decodeAudioDataMock).not.toHaveBeenCalled()
  })

  it('keeps at most PRIMED_ENTRY_CAP primed bands; requested ones survive; an evicted one recomputes once', async () => {
    readAudioFileMock.mockResolvedValue(fakeBytes())
    decodeAudioDataMock.mockResolvedValue(fakeAudioBuffer())
    const bands = glyphBandsFrom(computeBandEnergy(samples, 44100))
    const { getGlyphBands, primeGlyphBands } = await import('./bandEnergyCache')
    const { PRIMED_ENTRY_CAP } = await import('./primedEntries')

    const requested = { ...bands }
    primeGlyphBands('/requested', requested)
    expect(await getGlyphBands('/requested')).toBe(requested)
    for (let i = 0; i <= PRIMED_ENTRY_CAP; i++) primeGlyphBands(`/p${i}`, { ...bands })

    expect(await getGlyphBands('/requested')).toBe(requested)
    await getGlyphBands('/p1')
    expect(decodeAudioDataMock).not.toHaveBeenCalled()
    await Promise.all([getGlyphBands('/p0'), getGlyphBands('/p0')])
    await getGlyphBands('/p0')
    expect(decodeAudioDataMock).toHaveBeenCalledTimes(1)
  })
})
