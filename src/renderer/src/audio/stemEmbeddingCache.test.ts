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

describe('ensureYamnetZeroShotClassified', () => {
  let setYamnetZeroShotCategoryMock: ReturnType<typeof vi.fn>
  let markYamnetZeroShotAttemptedMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    setYamnetZeroShotCategoryMock = vi.fn().mockResolvedValue(undefined)
    markYamnetZeroShotAttemptedMock = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('window', {
      rifffApi: {
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

  it('marks attempted and writes the category when classification succeeds with a mapped class', async () => {
    mockExtractEmbeddingAndTopClass.mockResolvedValue({ embedding: [1, 2, 3], topClassIndex: 157 })

    const { ensureYamnetZeroShotClassified } = await import('./stemEmbeddingCache')
    await ensureYamnetZeroShotClassified('/some/path.wav')

    expect(markYamnetZeroShotAttemptedMock).toHaveBeenCalledWith('/some/path.wav')
    expect(setYamnetZeroShotCategoryMock).toHaveBeenCalledWith('/some/path.wav', 157)
  })

  it('marks attempted but does not write a category when topClassIndex is null', async () => {
    mockExtractEmbeddingAndTopClass.mockResolvedValue({ embedding: [1, 2, 3], topClassIndex: null })

    const { ensureYamnetZeroShotClassified } = await import('./stemEmbeddingCache')
    await ensureYamnetZeroShotClassified('/some/path.wav')

    expect(markYamnetZeroShotAttemptedMock).toHaveBeenCalledWith('/some/path.wav')
    expect(setYamnetZeroShotCategoryMock).not.toHaveBeenCalled()
  })

  it('does not mark attempted when extraction fails outright', async () => {
    mockExtractEmbeddingAndTopClass.mockResolvedValue(null)

    const { ensureYamnetZeroShotClassified } = await import('./stemEmbeddingCache')
    await ensureYamnetZeroShotClassified('/some/path.wav')

    expect(markYamnetZeroShotAttemptedMock).not.toHaveBeenCalled()
    expect(setYamnetZeroShotCategoryMock).not.toHaveBeenCalled()
  })

  it('does not throw when decoding itself throws', async () => {
    mockGetAudioContext.mockReturnValue({
      decodeAudioData: vi.fn().mockRejectedValue(new Error('decode failed'))
    })

    const { ensureYamnetZeroShotClassified } = await import('./stemEmbeddingCache')
    await expect(ensureYamnetZeroShotClassified('/some/path.wav')).resolves.toBeUndefined()
  })
})
