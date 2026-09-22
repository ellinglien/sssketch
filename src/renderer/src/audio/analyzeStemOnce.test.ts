import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// No OfflineAudioContext / Worker under vitest's node environment: the
// resample and the YAMNet worker are replaced by deterministic functions
// OF THEIR INPUT, so equal outputs prove both paths fed them the same data.
vi.mock('./resampleTo16kMono', () => ({
  resampleTo16kMono: vi.fn(async (buffer: AudioBuffer) => buffer.getChannelData(0).slice(0, 64))
}))
vi.mock('./yamnetClient', () => ({
  extractEmbeddingAndTopClass: vi.fn(async (pcm: Float32Array) => ({
    embedding: Array.from(pcm.slice(0, 16), (v) => v + 1),
    topClassIndex: 7
  }))
}))

const ALL = { peaks: true, features: true, embedding: true, zeroShot: false }

function fakeAudioBuffer(): AudioBuffer {
  const n = 8820
  const data = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    data[i] = Math.sin((2 * Math.PI * 220 * i) / 44100) * 0.5 + (i % 50 === 0 ? 0.4 : 0)
  }
  return {
    getChannelData: () => data,
    sampleRate: 44100,
    length: n,
    duration: n / 44100,
    numberOfChannels: 1
  } as unknown as AudioBuffer
}

describe('analyzeStemOnce', () => {
  let api: Record<string, ReturnType<typeof vi.fn>>
  let decodeAudioDataMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules()
    decodeAudioDataMock = vi.fn().mockImplementation(async () => fakeAudioBuffer())
    api = {
      readAudioFile: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3, 4])),
      getStemPeaksCache: vi.fn().mockResolvedValue(null),
      setStemPeaksCache: vi.fn().mockResolvedValue(undefined),
      getStemFeatureCache: vi.fn().mockResolvedValue(null),
      setStemFeatureCache: vi.fn().mockResolvedValue(undefined),
      getStemEmbeddingCache: vi.fn().mockResolvedValue(null),
      setStemEmbeddingCache: vi.fn().mockResolvedValue(undefined),
      markYamnetZeroShotAttempted: vi.fn().mockResolvedValue(undefined),
      setYamnetZeroShotCategory: vi.fn().mockResolvedValue(undefined)
    }
    vi.stubGlobal('window', { rifffApi: api })
    class FakeAudioContext {
      decodeAudioData = decodeAudioDataMock
    }
    vi.stubGlobal('AudioContext', FakeAudioContext)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function oldPathOutputs(path: string): Promise<{
    peaks: number[]
    brightness: number[]
    features: unknown
    embedding: number[] | null
  }> {
    const { getPeaks, getBrightness } = await import('./peakCache')
    const { getStemFeatures } = await import('./stemFeaturesCache')
    const { getOrExtractStemEmbedding } = await import('./stemEmbeddingCache')
    const [peaks, brightness, features, embedding] = await Promise.all([
      getPeaks(path),
      getBrightness(path),
      getStemFeatures(path),
      getOrExtractStemEmbedding(path)
    ])
    return { peaks, brightness, features, embedding }
  }

  it('decodes once for all three outputs, and each equals the old per-module result', async () => {
    const before = await oldPathOutputs('/lib/cid-1')
    // The old per-module paths: peaks, features, embedding each decoded.
    expect(decodeAudioDataMock).toHaveBeenCalledTimes(3)

    vi.resetModules()
    decodeAudioDataMock.mockClear()
    for (const fn of Object.values(api)) fn.mockClear()

    const { analyzeStemOnce } = await import('./analyzeStemOnce')
    const result = await analyzeStemOnce('/lib/cid-1', ALL)
    expect(result).toEqual({
      peaks: 'done',
      features: 'done',
      embedding: 'done',
      zeroShot: 'skipped'
    })
    expect(decodeAudioDataMock).toHaveBeenCalledTimes(1)
    expect(api.readAudioFile).toHaveBeenCalledTimes(1)

    expect(api.setStemPeaksCache).toHaveBeenCalledWith('/lib/cid-1', {
      peaks: before.peaks,
      brightness: before.brightness
    })
    expect(api.setStemFeatureCache).toHaveBeenCalledWith('/lib/cid-1', before.features)
    expect(api.setStemEmbeddingCache).toHaveBeenCalledWith('/lib/cid-1', before.embedding)
    expect(api.markYamnetZeroShotAttempted).toHaveBeenCalledWith('/lib/cid-1')
    expect(api.setYamnetZeroShotCategory).toHaveBeenCalledWith('/lib/cid-1', 7)

    // Every cache reader now answers from memory -- no decode, no persisted lookup.
    const after = await oldPathOutputs('/lib/cid-1')
    expect(after).toEqual(before)
    const { getPitchContour } = await import('./pitchCache')
    expect((await getPitchContour('/lib/cid-1')).numFrames).toBeGreaterThan(0)
    expect(decodeAudioDataMock).toHaveBeenCalledTimes(1)
    expect(api.getStemPeaksCache).not.toHaveBeenCalled()
    expect(api.getStemFeatureCache).not.toHaveBeenCalled()
    expect(api.getStemEmbeddingCache).not.toHaveBeenCalled()
  })

  it('interactive callers mid-analysis share the in-flight work instead of decoding again', async () => {
    const { analyzeStemOnce } = await import('./analyzeStemOnce')
    const { getPeaks } = await import('./peakCache')
    const { getStemFeatures } = await import('./stemFeaturesCache')
    const { getOrExtractStemEmbedding } = await import('./stemEmbeddingCache')
    const scan = analyzeStemOnce('/lib/cid-2', ALL)
    await Promise.all([
      getPeaks('/lib/cid-2'),
      getStemFeatures('/lib/cid-2'),
      getOrExtractStemEmbedding('/lib/cid-2'),
      scan
    ])
    expect(decodeAudioDataMock).toHaveBeenCalledTimes(1)
  })

  it('does only what needs asks for', async () => {
    const { analyzeStemOnce } = await import('./analyzeStemOnce')
    const result = await analyzeStemOnce('/lib/cid-3', {
      peaks: false,
      features: false,
      embedding: true,
      zeroShot: false
    })
    expect(result).toEqual({
      peaks: 'skipped',
      features: 'skipped',
      embedding: 'done',
      zeroShot: 'skipped'
    })
    expect(api.setStemPeaksCache).not.toHaveBeenCalled()
    expect(api.setStemFeatureCache).not.toHaveBeenCalled()
    expect(api.setStemEmbeddingCache).toHaveBeenCalledTimes(1)

    expect(await analyzeStemOnce('/lib/cid-4', { ...ALL, peaks: false, embedding: false })).toEqual(
      { peaks: 'skipped', features: 'done', embedding: 'skipped', zeroShot: 'skipped' }
    )
    // Brightness came from the same decode; the peaks row wasn't missing, so not re-persisted.
    expect(api.setStemPeaksCache).not.toHaveBeenCalled()
    expect(decodeAudioDataMock).toHaveBeenCalledTimes(2)
  })

  it('needs nothing -> no read, no decode', async () => {
    const { analyzeStemOnce } = await import('./analyzeStemOnce')
    const result = await analyzeStemOnce('/lib/cid-5', {
      peaks: false,
      features: false,
      embedding: false,
      zeroShot: false
    })
    expect(result).toEqual({
      peaks: 'skipped',
      features: 'skipped',
      embedding: 'skipped',
      zeroShot: 'skipped'
    })
    expect(api.readAudioFile).not.toHaveBeenCalled()
  })

  it('re-extracts an old-version in-memory feature entry, and skips a current one', async () => {
    const oldRow = {
      transientDensity: 0.7,
      bassEnergyRatio: 0.2,
      spectralCentroidHz: 900,
      zcrBrightness: 0.3,
      voicedFraction: 0.5,
      pitchVarianceCents: 15,
      mfcc: Array.from({ length: 13 }, (_, i) => i)
    }
    api.getStemFeatureCache.mockResolvedValue(oldRow)
    const { analyzeStemOnce } = await import('./analyzeStemOnce')
    const { getStemFeatures } = await import('./stemFeaturesCache')
    expect(await getStemFeatures('/lib/cid-6')).toEqual(oldRow)

    const first = await analyzeStemOnce('/lib/cid-6', { ...ALL, peaks: false, embedding: false })
    expect(first.features).toBe('done')
    const fresh = await getStemFeatures('/lib/cid-6')
    expect(fresh.featureVersion).toBeGreaterThanOrEqual(2)

    const second = await analyzeStemOnce('/lib/cid-6', { ...ALL, peaks: false, embedding: false })
    expect(second.features).toBe('skipped')
    expect(decodeAudioDataMock).toHaveBeenCalledTimes(1)
  })

  it('a failure in one output does not lose the others, and the failed one retries later', async () => {
    const yamnet = await import('./yamnetClient')
    vi.mocked(yamnet.extractEmbeddingAndTopClass).mockRejectedValueOnce(new Error('worker died'))
    const { analyzeStemOnce } = await import('./analyzeStemOnce')
    const result = await analyzeStemOnce('/lib/cid-7', ALL)
    expect(result).toEqual({
      peaks: 'done',
      features: 'done',
      embedding: 'failed',
      zeroShot: 'skipped'
    })
    expect(api.setStemPeaksCache).toHaveBeenCalledTimes(1)
    expect(api.setStemFeatureCache).toHaveBeenCalledTimes(1)
    expect(api.setStemEmbeddingCache).not.toHaveBeenCalled()

    const retry = await analyzeStemOnce('/lib/cid-7', ALL)
    expect(retry).toEqual({
      peaks: 'skipped',
      features: 'skipped',
      embedding: 'done',
      zeroShot: 'skipped'
    })
    expect(api.setStemEmbeddingCache).toHaveBeenCalledTimes(1)
  })

  it('a decode failure leaves every output retryable', async () => {
    decodeAudioDataMock.mockRejectedValueOnce(new Error('corrupt wav'))
    const { analyzeStemOnce } = await import('./analyzeStemOnce')
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await analyzeStemOnce('/lib/cid-8', ALL)
    expect(result).toEqual({
      peaks: 'failed',
      features: 'failed',
      embedding: 'failed',
      zeroShot: 'skipped'
    })
    const retry = await analyzeStemOnce('/lib/cid-8', ALL)
    expect(retry).toEqual({
      peaks: 'done',
      features: 'done',
      embedding: 'done',
      zeroShot: 'skipped'
    })
    errSpy.mockRestore()
  })
  it('zero-shot for an already-embedded stem shares the one decode, marks attempted, never re-writes the embedding', async () => {
    const { analyzeStemOnce } = await import('./analyzeStemOnce')
    const result = await analyzeStemOnce('/lib/cid-9', {
      peaks: true,
      features: false,
      embedding: false,
      zeroShot: true
    })
    expect(result).toEqual({
      peaks: 'done',
      features: 'skipped',
      embedding: 'skipped',
      zeroShot: 'done'
    })
    expect(decodeAudioDataMock).toHaveBeenCalledTimes(1)
    expect(api.markYamnetZeroShotAttempted).toHaveBeenCalledWith('/lib/cid-9')
    expect(api.setYamnetZeroShotCategory).toHaveBeenCalledWith('/lib/cid-9', 7)
    expect(api.setStemEmbeddingCache).not.toHaveBeenCalled()

    // Done this session -- a second ask is skipped without a decode.
    const again = await analyzeStemOnce('/lib/cid-9', {
      peaks: false,
      features: false,
      embedding: false,
      zeroShot: true
    })
    expect(again.zeroShot).toBe('skipped')
    expect(decodeAudioDataMock).toHaveBeenCalledTimes(1)
  })

  it('zero-shot: an inference failure is not marked attempted and retries later', async () => {
    const yamnet = await import('./yamnetClient')
    vi.mocked(yamnet.extractEmbeddingAndTopClass).mockResolvedValueOnce(null)
    const { analyzeStemOnce } = await import('./analyzeStemOnce')
    const needs = { peaks: false, features: false, embedding: false, zeroShot: true }
    expect((await analyzeStemOnce('/lib/cid-10', needs)).zeroShot).toBe('failed')
    expect(api.markYamnetZeroShotAttempted).not.toHaveBeenCalled()
    expect((await analyzeStemOnce('/lib/cid-10', needs)).zeroShot).toBe('done')
    expect(api.markYamnetZeroShotAttempted).toHaveBeenCalledTimes(1)
  })

  it('a fresh embedding covers zero-shot itself -- no second inference', async () => {
    const yamnet = await import('./yamnetClient')
    vi.mocked(yamnet.extractEmbeddingAndTopClass).mockClear()
    const { analyzeStemOnce } = await import('./analyzeStemOnce')
    const result = await analyzeStemOnce('/lib/cid-11', { ...ALL, zeroShot: true })
    expect(result.zeroShot).toBe('skipped')
    expect(vi.mocked(yamnet.extractEmbeddingAndTopClass)).toHaveBeenCalledTimes(1)
    expect(api.markYamnetZeroShotAttempted).toHaveBeenCalledTimes(1)
  })
})
