import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

const mockExtractEmbedding = vi.fn()
vi.mock('./yamnetClient', () => ({
  extractEmbedding: (...args: unknown[]) => mockExtractEmbedding(...args)
}))

const mockGetAudioContext = vi.fn()
vi.mock('./peakCache', () => ({ getAudioContext: () => mockGetAudioContext() }))

vi.mock('./resampleTo16kMono', () => ({
  resampleTo16kMono: vi.fn().mockResolvedValue(new Float32Array())
}))

describe('getOrExtractStemEmbedding', () => {
  let setStemEmbeddingCacheMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    setStemEmbeddingCacheMock = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('window', {
      rifffApi: {
        getStemEmbeddingCache: vi.fn().mockResolvedValue(null),
        setStemEmbeddingCache: setStemEmbeddingCacheMock,
        // Non-empty: 0 bytes now reads as a stem not downloaded yet
        // (decodeStemFile), and never reaches the decode.
        readAudioFile: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3, 4]))
      }
    })
    mockGetAudioContext.mockReturnValue({
      decodeAudioData: vi.fn().mockResolvedValue({})
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('persists the embedding after a successful extraction', async () => {
    mockExtractEmbedding.mockResolvedValue({ embedding: [1, 2, 3] })

    const { getOrExtractStemEmbedding } = await import('./stemEmbeddingCache')
    expect(await getOrExtractStemEmbedding('/some/path.wav')).toEqual([1, 2, 3])

    expect(setStemEmbeddingCacheMock).toHaveBeenCalledWith('/some/path.wav', [1, 2, 3])
  })

  it('persists nothing when extraction fails outright', async () => {
    mockExtractEmbedding.mockResolvedValue(null)

    const { getOrExtractStemEmbedding } = await import('./stemEmbeddingCache')
    expect(await getOrExtractStemEmbedding('/some/path.wav')).toBeNull()

    expect(setStemEmbeddingCacheMock).not.toHaveBeenCalled()
  })
})
