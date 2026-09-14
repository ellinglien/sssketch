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

  beforeEach(() => {
    vi.resetModules()
    readAudioFileMock = vi.fn()
    decodeAudioDataMock = vi.fn()
    getStemFeatureCacheMock = vi.fn().mockResolvedValue(null)
    setStemFeatureCacheMock = vi.fn().mockResolvedValue(undefined)

    vi.stubGlobal('window', {
      rifffApi: {
        readAudioFile: readAudioFileMock,
        getStemFeatureCache: getStemFeatureCacheMock,
        setStemFeatureCache: setStemFeatureCacheMock
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
})
