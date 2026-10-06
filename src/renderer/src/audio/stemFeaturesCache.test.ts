import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function fakeBytes(): Uint8Array {
  return new Uint8Array([1, 2, 3, 4])
}

function fakeAudioBuffer(): { getChannelData: () => Float32Array; sampleRate: number } {
  const n = 4410
  const data = new Float32Array(n)
  for (let i = 0; i < n; i++) data[i] = Math.sin((2 * Math.PI * 220 * i) / 44100) * 0.5
  return { getChannelData: () => data, sampleRate: 44100 }
}

describe('stemFeaturesCache', () => {
  let readAudioFileMock: ReturnType<typeof vi.fn>
  let decodeAudioDataMock: ReturnType<typeof vi.fn>
  let getStemFeatureCacheMock: ReturnType<typeof vi.fn>
  let setStemFeatureCacheMock: ReturnType<typeof vi.fn>
  let getStemGlyphCacheMock: ReturnType<typeof vi.fn>
  let setStemGlyphCacheMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules()
    readAudioFileMock = vi.fn()
    decodeAudioDataMock = vi.fn()
    getStemFeatureCacheMock = vi.fn().mockResolvedValue(null)
    setStemFeatureCacheMock = vi.fn().mockResolvedValue(undefined)
    getStemGlyphCacheMock = vi.fn().mockResolvedValue(null)
    setStemGlyphCacheMock = vi.fn().mockResolvedValue(undefined)

    vi.stubGlobal('window', {
      rifffApi: {
        readAudioFile: readAudioFileMock,
        getStemFeatureCache: getStemFeatureCacheMock,
        setStemFeatureCache: setStemFeatureCacheMock,
        // getStemFeatures pulls getBrightness in from peakCache.ts, which
        // (2026-09-21) now also checks its own persisted cache first --
        // stubbed as a permanent miss so this file's own decode-path
        // tests keep exercising a real decode, same as before that change.
        getStemPeaksCache: vi.fn().mockResolvedValue(null),
        setStemPeaksCache: vi.fn().mockResolvedValue(undefined),
        getStemGlyphCache: getStemGlyphCacheMock,
        setStemGlyphCache: setStemGlyphCacheMock,
        setStemAnalysisResults: vi.fn().mockResolvedValue(undefined)
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

  it('returns a StemFeatures object with every expected field populated', async () => {
    readAudioFileMock.mockResolvedValue(fakeBytes())
    decodeAudioDataMock.mockResolvedValue(fakeAudioBuffer())

    const { getStemFeatures } = await import('./stemFeaturesCache')
    const features = await getStemFeatures('/some/stem.wav')

    expect(typeof features.transientDensity).toBe('number')
    expect(typeof features.bassEnergyRatio).toBe('number')
    expect(typeof features.spectralCentroidHz).toBe('number')
    expect(typeof features.zcrBrightness).toBe('number')
    expect(typeof features.voicedFraction).toBe('number')
    expect(typeof features.pitchVarianceCents).toBe('number')
    expect(features.mfcc).toHaveLength(13)
  })

  it('reuses the same in-flight promise across concurrent callers for the same path', async () => {
    readAudioFileMock.mockResolvedValue(fakeBytes())
    decodeAudioDataMock.mockResolvedValue(fakeAudioBuffer())

    const { getStemFeatures } = await import('./stemFeaturesCache')
    const [a, b] = await Promise.all([
      getStemFeatures('/some/stem.wav'),
      getStemFeatures('/some/stem.wav')
    ])
    expect(a).toEqual(b)
  })

  it('primes the pitch cache from its own analysis -- no second decode for pitch', async () => {
    readAudioFileMock.mockResolvedValue(fakeBytes())
    decodeAudioDataMock.mockResolvedValue(fakeAudioBuffer())

    const { getStemFeatures } = await import('./stemFeaturesCache')
    const { getPitchContour } = await import('./pitchCache')
    await getStemFeatures('/some/stem.wav')
    const contour = await getPitchContour('/some/stem.wav')
    expect(contour.numFrames).toBeGreaterThan(0)
    // One decode, total. Pitch used to cost a third separate decode of
    // this file and was fixed by priming; brightness (peakCache.ts) and
    // the analysis itself were still two, and are now one -- they run
    // concurrently inside getStemFeatures and decodeStemFile shares a
    // read+decode already in flight for the path (2026-09-28).
    expect(decodeAudioDataMock).toHaveBeenCalledTimes(1)
  })

  it('primes the glyph bands and pitch too: a later glyph neither decodes, reads nor writes (plan T9)', async () => {
    readAudioFileMock.mockResolvedValue(fakeBytes())
    decodeAudioDataMock.mockResolvedValue(fakeAudioBuffer())

    const { getStemFeatures } = await import('./stemFeaturesCache')
    const { getGlyphBands } = await import('./bandEnergyCache')
    const { getPitchContour } = await import('./pitchCache')
    const { computeBandEnergy } = await import('@shared/bandEnergy')
    const { glyphBandsFrom } = await import('@shared/glyphBands')
    await getStemFeatures('/some/stem.wav')
    const bands = await getGlyphBands('/some/stem.wav')
    await getPitchContour('/some/stem.wav')

    expect(bands).toEqual(
      glyphBandsFrom(computeBandEnergy(fakeAudioBuffer().getChannelData(), 44100))
    )
    expect(decodeAudioDataMock).toHaveBeenCalledTimes(1)
    expect(getStemGlyphCacheMock).not.toHaveBeenCalled()
    expect(setStemGlyphCacheMock).not.toHaveBeenCalled()
  })

  it('evicts a rejected computation from the cache so a later call retries', async () => {
    readAudioFileMock
      .mockRejectedValueOnce(new Error('permission denied'))
      .mockResolvedValue(fakeBytes())
    decodeAudioDataMock.mockResolvedValue(fakeAudioBuffer())

    const { getStemFeatures } = await import('./stemFeaturesCache')

    await expect(getStemFeatures('/some/stem.wav')).rejects.toThrow('permission denied')
    const features = await getStemFeatures('/some/stem.wav')
    expect(features.mfcc).toHaveLength(13)
  })

  it('returns a persisted feature set without decoding at all', async () => {
    const persisted = {
      transientDensity: 0.7,
      bassEnergyRatio: 0.2,
      spectralCentroidHz: 900,
      zcrBrightness: 0.3,
      voicedFraction: 0.5,
      pitchVarianceCents: 15,
      mfcc: Array.from({ length: 13 }, (_, i) => i)
    }
    getStemFeatureCacheMock.mockResolvedValue(persisted)

    const { getStemFeatures } = await import('./stemFeaturesCache')
    const features = await getStemFeatures('/some/stem.wav')

    expect(features).toEqual(persisted)
    expect(readAudioFileMock).not.toHaveBeenCalled()
    expect(decodeAudioDataMock).not.toHaveBeenCalled()
  })

  it('persists a freshly computed feature set via setStemFeatureCache', async () => {
    readAudioFileMock.mockResolvedValue(fakeBytes())
    decodeAudioDataMock.mockResolvedValue(fakeAudioBuffer())

    const { getStemFeatures } = await import('./stemFeaturesCache')
    const features = await getStemFeatures('/some/stem.wav')

    expect(setStemFeatureCacheMock).toHaveBeenCalledWith('/some/stem.wav', features)
  })

  describe('feature versions', () => {
    const oldRow = {
      transientDensity: 0.7,
      bassEnergyRatio: 0.2,
      spectralCentroidHz: 900,
      zcrBrightness: 0.3,
      voicedFraction: 0.5,
      pitchVarianceCents: 15,
      mfcc: Array.from({ length: 13 }, (_, i) => i)
    }

    it('an interactive caller still gets an old-version persisted row immediately', async () => {
      getStemFeatureCacheMock.mockResolvedValue(oldRow)
      const { getStemFeatures } = await import('./stemFeaturesCache')
      expect(await getStemFeatures('/some/stem.wav')).toEqual(oldRow)
      expect(decodeAudioDataMock).not.toHaveBeenCalled()
    })

    it('requireCurrentVersion re-extracts and re-persists an old-version row', async () => {
      getStemFeatureCacheMock.mockResolvedValue(oldRow)
      readAudioFileMock.mockResolvedValue(fakeBytes())
      decodeAudioDataMock.mockResolvedValue(fakeAudioBuffer())
      const { getStemFeatures } = await import('./stemFeaturesCache')
      const { STEM_FEATURE_VERSION } = await import('@shared/stemFeatures')

      const features = await getStemFeatures('/some/stem.wav', { requireCurrentVersion: true })
      expect(features.featureVersion).toBe(STEM_FEATURE_VERSION)
      expect(typeof features.rhythmicStrength).toBe('number')
      expect(setStemFeatureCacheMock).toHaveBeenCalledWith('/some/stem.wav', features)
    })

    it('requireCurrentVersion returns a current-version persisted row without decoding', async () => {
      const { STEM_FEATURE_VERSION } = await import('@shared/stemFeatures')
      const current = { ...oldRow, rhythmicStrength: 0.4, featureVersion: STEM_FEATURE_VERSION }
      getStemFeatureCacheMock.mockResolvedValue(current)
      const { getStemFeatures } = await import('./stemFeaturesCache')
      expect(await getStemFeatures('/some/stem.wav', { requireCurrentVersion: true })).toEqual(
        current
      )
      expect(decodeAudioDataMock).not.toHaveBeenCalled()
      expect(setStemFeatureCacheMock).not.toHaveBeenCalled()
    })

    it('an old row already in the session cache is refreshed for requireCurrentVersion, and later interactive calls get the fresh one', async () => {
      getStemFeatureCacheMock.mockResolvedValue(oldRow)
      readAudioFileMock.mockResolvedValue(fakeBytes())
      decodeAudioDataMock.mockResolvedValue(fakeAudioBuffer())
      const { getStemFeatures } = await import('./stemFeaturesCache')
      const { STEM_FEATURE_VERSION } = await import('@shared/stemFeatures')

      expect(await getStemFeatures('/some/stem.wav')).toEqual(oldRow)
      const fresh = await getStemFeatures('/some/stem.wav', { requireCurrentVersion: true })
      expect(fresh.featureVersion).toBe(STEM_FEATURE_VERSION)
      expect(await getStemFeatures('/some/stem.wav')).toBe(fresh)
    })

    it('concurrent requireCurrentVersion callers share one re-extraction', async () => {
      getStemFeatureCacheMock.mockResolvedValue(oldRow)
      readAudioFileMock.mockResolvedValue(fakeBytes())
      decodeAudioDataMock.mockResolvedValue(fakeAudioBuffer())
      const { getStemFeatures } = await import('./stemFeaturesCache')

      await getStemFeatures('/some/stem.wav')
      const [a, b] = await Promise.all([
        getStemFeatures('/some/stem.wav', { requireCurrentVersion: true }),
        getStemFeatures('/some/stem.wav', { requireCurrentVersion: true })
      ])
      expect(a).toBe(b)
      expect(setStemFeatureCacheMock).toHaveBeenCalledTimes(1)
    })
  })

  it('keeps at most PRIMED_ENTRY_CAP scan-adopted entries; requested ones survive; an evicted one is read again once', async () => {
    const tiny = new Float32Array(512).fill(0.25)
    const buffer = { getChannelData: () => tiny, sampleRate: 44100, numberOfChannels: 1 }
    const adopt = async (path: string): Promise<void> => {
      const { adoptStemFeaturesFromBuffer } = await import('./stemFeaturesCache')
      await adoptStemFeaturesFromBuffer(
        path,
        undefined,
        Promise.resolve(buffer as unknown as AudioBuffer),
        Promise.resolve([0.1])
      )
    }
    const { getStemFeatures, peekStemFeaturesEntry } = await import('./stemFeaturesCache')
    const { PRIMED_ENTRY_CAP } = await import('./primedEntries')

    await adopt('/requested')
    const requested = await getStemFeatures('/requested')
    for (let i = 0; i <= PRIMED_ENTRY_CAP; i++) await adopt(`/a${i}`)

    expect(peekStemFeaturesEntry('/a0')).toBeUndefined()
    expect(peekStemFeaturesEntry('/a1')).toBeDefined()
    expect(await getStemFeatures('/requested')).toBe(requested)
    expect(getStemFeatureCacheMock).not.toHaveBeenCalled()

    // main holds the row the adoption persisted: an evicted entry is read back, not decoded
    getStemFeatureCacheMock.mockResolvedValue(requested)
    await Promise.all([getStemFeatures('/a0'), getStemFeatures('/a0')])
    await getStemFeatures('/a0')
    expect(getStemFeatureCacheMock).toHaveBeenCalledTimes(1)
    expect(decodeAudioDataMock).not.toHaveBeenCalled()
  })
})
