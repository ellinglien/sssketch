import { describe, expect, it, vi, beforeEach } from 'vitest'

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

  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    setYamnetZeroShotCategoryMock = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('window', {
      rifffApi: {
        getStemEmbeddingCache: vi.fn().mockResolvedValue(null),
        setStemEmbeddingCache: vi.fn().mockResolvedValue(undefined),
        setYamnetZeroShotCategory: setYamnetZeroShotCategoryMock,
        readAudioFile: vi.fn().mockResolvedValue(new Uint8Array())
      }
    })
    mockGetAudioContext.mockReturnValue({
      decodeAudioData: vi.fn().mockResolvedValue({})
    })
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
})
