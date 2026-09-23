import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PHRASE_FRAME_COUNT } from '@shared/phrasePeriod'

const decodeStemFile = vi.fn()
vi.mock('./decodeStemFile', () => ({ decodeStemFile: (path: string) => decodeStemFile(path) }))

/** The one AudioBuffer method this module touches. */
function fakeBuffer(samples: Float32Array): { getChannelData: () => Float32Array } {
  return { getChannelData: () => samples }
}

function loud(length: number): Float32Array {
  const samples = new Float32Array(length)
  for (let i = 0; i < length; i += 1) samples[i] = i % 2 === 0 ? 0.9 : -0.9
  return samples
}

describe('phraseCache', () => {
  beforeEach(() => {
    vi.resetModules()
    decodeStemFile.mockReset()
  })

  it('decodes a path once and serves both series from that one decode', async () => {
    const { getStemPhraseFrames } = await import('./phraseCache')
    decodeStemFile.mockResolvedValue(fakeBuffer(loud(8192)))
    const first = await getStemPhraseFrames('/a.wav')
    const second = await getStemPhraseFrames('/a.wav')
    expect(decodeStemFile).toHaveBeenCalledTimes(1)
    expect(first).toBe(second)
    expect(first.envelope).toHaveLength(PHRASE_FRAME_COUNT)
    expect(first.brightness).toHaveLength(PHRASE_FRAME_COUNT)
  })

  it('evicts on rejection so a transient failure does not poison the path', async () => {
    const { getStemPhraseFrames } = await import('./phraseCache')
    decodeStemFile.mockRejectedValueOnce(new Error('mid-copy read'))
    await expect(getStemPhraseFrames('/b.wav')).rejects.toThrow('mid-copy read')
    decodeStemFile.mockResolvedValue(fakeBuffer(loud(8192)))
    const frames = await getStemPhraseFrames('/b.wav')
    expect(frames.envelope).toHaveLength(PHRASE_FRAME_COUNT)
    expect(decodeStemFile).toHaveBeenCalledTimes(2)
  })

  it('answers a verdict for a bar count without decoding again', async () => {
    const { getStemPhrase, getStemPhraseFrames } = await import('./phraseCache')
    decodeStemFile.mockResolvedValue(fakeBuffer(loud(8192)))
    await getStemPhraseFrames('/c.wav')
    const reading = await getStemPhrase('/c.wav', 8)
    expect(decodeStemFile).toHaveBeenCalledTimes(1)
    expect(reading.path).toBe('/c.wav')
    expect(reading.nominalBars).toBe(8)
    expect(reading.verdict.kind === 'period' || reading.verdict.kind === 'inconclusive').toBe(true)
  })

  it('reads one path at two bar counts off the SAME decode', async () => {
    // The bar count is not part of the cache key: PhraseFrames is a fixed
    // reduction of the whole file and measurePhrasePeriod works out the
    // bar-relative resolution itself.
    const { getStemPhrase } = await import('./phraseCache')
    decodeStemFile.mockResolvedValue(fakeBuffer(loud(8192)))
    await getStemPhrase('/d.wav', 8)
    await getStemPhrase('/d.wav', 4)
    expect(decodeStemFile).toHaveBeenCalledTimes(1)
  })

  it('peeks at nothing before anything has resolved', async () => {
    const { peekStemPhraseFrames } = await import('./phraseCache')
    expect(peekStemPhraseFrames('/never.wav')).toBeNull()
  })
})
