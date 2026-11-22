import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// No OfflineAudioContext / Worker under vitest's node environment: the
// resample and the YAMNet worker are replaced by deterministic functions
// OF THEIR INPUT, so equal outputs prove both paths fed them the same data.
vi.mock('./resampleTo16kMono', () => ({
  resampleTo16kMono: vi.fn(async (buffer: AudioBuffer) => buffer.getChannelData(0).slice(0, 64))
}))
vi.mock('./yamnetClient', () => ({
  extractEmbedding: vi.fn(async (pcm: Float32Array) => ({
    embedding: Array.from(pcm.slice(0, 16), (v) => v + 1),
    topClassIndex: 7
  }))
}))

const ALL = { peaks: true, features: true, embedding: true }

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
      setStemAnalysisResults: vi.fn().mockResolvedValue(undefined)
    }
    vi.stubGlobal('window', { rifffApi: api })
    class FakeAudioContext {
      decodeAudioData = decodeAudioDataMock
    }
    vi.stubGlobal('AudioContext', FakeAudioContext)
  })

  afterEach(async () => {
    // Nothing queued may leak into the next test's stubbed api.
    await (await import('./analysisWriteQueue')).flushStemAnalysisWrites()
    vi.unstubAllGlobals()
  })

  /** Flushes the batched write queue (B7) and returns every write sent so
   * far, merged per path. */
  async function flushedWrites(): Promise<Map<string, Record<string, unknown>>> {
    await (await import('./analysisWriteQueue')).flushStemAnalysisWrites()
    const out = new Map<string, Record<string, unknown>>()
    for (const [batch] of api.setStemAnalysisResults.mock.calls as [{ path: string }[]][]) {
      for (const write of batch) out.set(write.path, { ...out.get(write.path), ...write })
    }
    return out
  }

  function expectNoSingleWrites(): void {
    expect(api.setStemPeaksCache).not.toHaveBeenCalled()
    expect(api.setStemFeatureCache).not.toHaveBeenCalled()
    expect(api.setStemEmbeddingCache).not.toHaveBeenCalled()
  }

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
    // Was 3 -- peaks, features and embedding each decoded the same file
    // separately. Now 1: decodeStemFile de-duplicates a read+decode
    // already in flight for a path (2026-09-28), and oldPathOutputs asks
    // for all four CONCURRENTLY, so they share one. analyzeStemOnce still
    // earns its keep below -- it also shares across calls that do NOT
    // overlap in time, and persists one batched write instead of three.
    expect(decodeAudioDataMock).toHaveBeenCalledTimes(1)

    vi.resetModules()
    decodeAudioDataMock.mockClear()
    for (const fn of Object.values(api)) fn.mockClear()

    const { analyzeStemOnce } = await import('./analyzeStemOnce')
    const result = await analyzeStemOnce('/lib/cid-1', ALL)
    expect(result).toEqual({
      peaks: 'done',
      features: 'done',
      embedding: 'done'
    })
    expect(decodeAudioDataMock).toHaveBeenCalledTimes(1)
    expect(api.readAudioFile).toHaveBeenCalledTimes(1)

    // Every output persisted with the same values the old per-module IPCs
    // sent -- now as ONE batched write (B7).
    expect((await flushedWrites()).get('/lib/cid-1')).toEqual({
      path: '/lib/cid-1',
      peaks: { peaks: before.peaks, brightness: before.brightness },
      features: before.features,
      embedding: before.embedding
    })
    expect(api.setStemAnalysisResults).toHaveBeenCalledTimes(1)
    expectNoSingleWrites()

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
      embedding: true
    })
    expect(result).toEqual({
      peaks: 'skipped',
      features: 'skipped',
      embedding: 'done'
    })
    expect(Object.keys((await flushedWrites()).get('/lib/cid-3') ?? {}).sort()).toEqual([
      'embedding',
      'path'
    ])

    expect(await analyzeStemOnce('/lib/cid-4', { ...ALL, peaks: false, embedding: false })).toEqual(
      { peaks: 'skipped', features: 'done', embedding: 'skipped' }
    )
    // Brightness came from the same decode; the peaks row wasn't missing, so not re-persisted.
    expect(Object.keys((await flushedWrites()).get('/lib/cid-4') ?? {}).sort()).toEqual([
      'features',
      'path'
    ])
    expect(decodeAudioDataMock).toHaveBeenCalledTimes(2)
    expectNoSingleWrites()
  })

  it('needs nothing -> no read, no decode', async () => {
    const { analyzeStemOnce } = await import('./analyzeStemOnce')
    const result = await analyzeStemOnce('/lib/cid-5', {
      peaks: false,
      features: false,
      embedding: false
    })
    expect(result).toEqual({
      peaks: 'skipped',
      features: 'skipped',
      embedding: 'skipped'
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
    vi.mocked(yamnet.extractEmbedding).mockRejectedValueOnce(new Error('worker died'))
    const { analyzeStemOnce } = await import('./analyzeStemOnce')
    const result = await analyzeStemOnce('/lib/cid-7', ALL)
    expect(result).toEqual({
      peaks: 'done',
      features: 'done',
      embedding: 'failed'
    })
    const firstWrite = (await flushedWrites()).get('/lib/cid-7') ?? {}
    expect(firstWrite.peaks).toBeDefined()
    expect(firstWrite.features).toBeDefined()
    expect(firstWrite.embedding).toBeUndefined()

    const retry = await analyzeStemOnce('/lib/cid-7', ALL)
    expect(retry).toEqual({
      peaks: 'skipped',
      features: 'skipped',
      embedding: 'done'
    })
    expect((await flushedWrites()).get('/lib/cid-7')?.embedding).toBeDefined()
  })

  it('a decode failure leaves every output retryable', async () => {
    decodeAudioDataMock.mockRejectedValueOnce(new Error('corrupt wav'))
    const { analyzeStemOnce } = await import('./analyzeStemOnce')
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await analyzeStemOnce('/lib/cid-8', ALL)
    expect(result).toEqual({
      peaks: 'failed',
      features: 'failed',
      embedding: 'failed'
    })
    const retry = await analyzeStemOnce('/lib/cid-8', ALL)
    expect(retry).toEqual({
      peaks: 'done',
      features: 'done',
      embedding: 'done'
    })
    errSpy.mockRestore()
  })

  // Real, 2026-10-01: each 0-byte placeholder in the archive logged three
  // stack traces (peaks, features, embedding), flooding the console.
  it('a 0-byte stem is not decoded and logs one short line, not one per output', async () => {
    api.readAudioFile.mockResolvedValueOnce(new Uint8Array(0))
    const { analyzeStemOnce } = await import('./analyzeStemOnce')
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await analyzeStemOnce('/lore/e/e22be9a0', ALL)
    const lines = [...errSpy.mock.calls, ...warnSpy.mock.calls]
    errSpy.mockRestore()
    warnSpy.mockRestore()
    expect(decodeAudioDataMock).not.toHaveBeenCalled()
    expect(result).toEqual({
      peaks: 'failed',
      features: 'failed',
      embedding: 'failed'
    })
    expect(lines).toHaveLength(1)
    // One line: plain strings, no Error object (whose stack would print).
    expect(lines[0].every((part) => typeof part === 'string')).toBe(true)
    expect(lines[0].join(' ')).toContain('/lore/e/e22be9a0')
    // Still retryable once the real audio lands.
    const retry = await analyzeStemOnce('/lore/e/e22be9a0', ALL)
    expect(retry.peaks).toBe('done')
  })

  it('a corrupt file also logs just one line for all its outputs', async () => {
    decodeAudioDataMock.mockRejectedValueOnce(new Error('Unable to decode audio data'))
    const { analyzeStemOnce } = await import('./analyzeStemOnce')
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await analyzeStemOnce('/lib/cid-bad', ALL)
    const lines = [...errSpy.mock.calls, ...warnSpy.mock.calls]
    errSpy.mockRestore()
    warnSpy.mockRestore()
    expect(lines).toHaveLength(1)
    expect(lines[0].join(' ')).toContain('Unable to decode audio data')
  })
})
