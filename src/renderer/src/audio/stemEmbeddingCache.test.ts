import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

const mockExtractEmbeddingAndTopClass = vi.fn()
vi.mock('./yamnetClient', () => ({
  extractEmbeddingAndTopClass: (...args: unknown[]) => mockExtractEmbeddingAndTopClass(...args)
}))

const mockGetAudioContext = vi.fn()
vi.mock('./peakCache', () => ({ getAudioContext: () => mockGetAudioContext() }))

vi.mock('./resampleTo16kMono', () => ({
  resampleTo16kMono: vi.fn().mockResolvedValue(new Float32Array())
}))

describe('getOrExtractStemEmbedding', () => {
  let setYamnetZeroShotCategoryMock: ReturnType<typeof vi.fn>
  let markYamnetZeroShotAttemptedMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    setYamnetZeroShotCategoryMock = vi.fn().mockResolvedValue(undefined)
    markYamnetZeroShotAttemptedMock = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('window', {
      rifffApi: {
        getStemEmbeddingCache: vi.fn().mockResolvedValue(null),
        setStemEmbeddingCache: vi.fn().mockResolvedValue(undefined),
        setYamnetZeroShotCategory: setYamnetZeroShotCategoryMock,
        markYamnetZeroShotAttempted: markYamnetZeroShotAttemptedMock,
        readAudioFile: vi.fn().mockResolvedValue(new Uint8Array())
      }
    })
    mockGetAudioContext.mockReturnValue({
      decodeAudioData: vi.fn().mockResolvedValue({})
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('persists the zero-shot category alongside the embedding when a top class is present', async () => {
    mockExtractEmbeddingAndTopClass.mockResolvedValue({ embedding: [1, 2, 3], topClassIndex: 162 })

    const { getOrExtractStemEmbedding } = await import('./stemEmbeddingCache')
    await getOrExtractStemEmbedding('/some/path.wav')

    expect(setYamnetZeroShotCategoryMock).toHaveBeenCalledWith('/some/path.wav', 162)
  })

  it('does not call setYamnetZeroShotCategory when topClassIndex is null', async () => {
    mockExtractEmbeddingAndTopClass.mockResolvedValue({ embedding: [1, 2, 3], topClassIndex: null })

    const { getOrExtractStemEmbedding } = await import('./stemEmbeddingCache')
    await getOrExtractStemEmbedding('/some/other/path.wav')

    expect(setYamnetZeroShotCategoryMock).not.toHaveBeenCalled()
  })

  it('marks the stem attempted on a successful extraction, even when topClassIndex is null', async () => {
    mockExtractEmbeddingAndTopClass.mockResolvedValue({ embedding: [1, 2, 3], topClassIndex: null })

    const { getOrExtractStemEmbedding } = await import('./stemEmbeddingCache')
    await getOrExtractStemEmbedding('/some/path.wav')

    expect(markYamnetZeroShotAttemptedMock).toHaveBeenCalledWith('/some/path.wav')
  })

  it('does not mark the stem attempted when extraction fails outright', async () => {
    mockExtractEmbeddingAndTopClass.mockResolvedValue(null)

    const { getOrExtractStemEmbedding } = await import('./stemEmbeddingCache')
    await getOrExtractStemEmbedding('/some/path.wav')

    expect(markYamnetZeroShotAttemptedMock).not.toHaveBeenCalled()
  })
})

describe('adoptZeroShotFromBuffer', () => {
  let setYamnetZeroShotCategoryMock: ReturnType<typeof vi.fn>
  let markYamnetZeroShotAttemptedMock: ReturnType<typeof vi.fn>
  let setStemEmbeddingCacheMock: ReturnType<typeof vi.fn>
  let setStemAnalysisResultsMock: ReturnType<typeof vi.fn>
  const buffer = Promise.resolve({} as AudioBuffer)

  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    setYamnetZeroShotCategoryMock = vi.fn().mockResolvedValue(undefined)
    markYamnetZeroShotAttemptedMock = vi.fn().mockResolvedValue(undefined)
    setStemEmbeddingCacheMock = vi.fn().mockResolvedValue(undefined)
    setStemAnalysisResultsMock = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('window', {
      rifffApi: {
        setYamnetZeroShotCategory: setYamnetZeroShotCategoryMock,
        markYamnetZeroShotAttempted: markYamnetZeroShotAttemptedMock,
        setStemEmbeddingCache: setStemEmbeddingCacheMock,
        setStemAnalysisResults: setStemAnalysisResultsMock
      }
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /** The batched writes (B7) the queue sent, after flushing it. */
  async function flushed(): Promise<unknown[]> {
    await (await import('./analysisWriteQueue')).flushStemAnalysisWrites()
    return setStemAnalysisResultsMock.mock.calls.flatMap(([batch]) => batch as unknown[])
  }

  it('marks attempted and writes the category when classification succeeds with a mapped class', async () => {
    mockExtractEmbeddingAndTopClass.mockResolvedValue({ embedding: [1, 2, 3], topClassIndex: 157 })

    const { adoptZeroShotFromBuffer } = await import('./stemEmbeddingCache')
    expect(await adoptZeroShotFromBuffer('/some/path.wav', buffer)).toBe(true)

    // The cached embedding is left alone.
    expect(await flushed()).toEqual([
      { path: '/some/path.wav', zeroShotAttempted: true, zeroShotClassIndex: 157 }
    ])
    expect(setStemEmbeddingCacheMock).not.toHaveBeenCalled()
  })

  it('marks attempted but does not write a category when topClassIndex is null', async () => {
    mockExtractEmbeddingAndTopClass.mockResolvedValue({ embedding: [1, 2, 3], topClassIndex: null })

    const { adoptZeroShotFromBuffer } = await import('./stemEmbeddingCache')
    await adoptZeroShotFromBuffer('/some/path.wav', buffer)

    expect(await flushed()).toEqual([{ path: '/some/path.wav', zeroShotAttempted: true }])
    expect(setYamnetZeroShotCategoryMock).not.toHaveBeenCalled()
  })

  it('does not mark attempted when extraction fails outright, and allows a retry', async () => {
    mockExtractEmbeddingAndTopClass.mockResolvedValue(null)

    const { adoptZeroShotFromBuffer, hasZeroShotEntry } = await import('./stemEmbeddingCache')
    expect(await adoptZeroShotFromBuffer('/some/path.wav', buffer)).toBe(false)

    expect(await flushed()).toEqual([])
    expect(hasZeroShotEntry('/some/path.wav')).toBe(false)
  })

  it('does not reject when decoding itself failed', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const failed = Promise.reject(new Error('decode failed'))
    failed.catch(() => {})
    const { adoptZeroShotFromBuffer } = await import('./stemEmbeddingCache')
    await expect(adoptZeroShotFromBuffer('/some/path.wav', failed)).resolves.toBe(false)
    errSpy.mockRestore()
  })

  it('starts nothing for a path already in flight or done', async () => {
    mockExtractEmbeddingAndTopClass.mockResolvedValue({ embedding: [1], topClassIndex: null })
    const { adoptZeroShotFromBuffer } = await import('./stemEmbeddingCache')
    const first = adoptZeroShotFromBuffer('/p.wav', buffer)
    expect(adoptZeroShotFromBuffer('/p.wav', buffer)).toBeNull()
    await first
    expect(adoptZeroShotFromBuffer('/p.wav', buffer)).toBeNull()
    expect(mockExtractEmbeddingAndTopClass).toHaveBeenCalledTimes(1)
  })
})
