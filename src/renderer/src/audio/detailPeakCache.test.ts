import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const decodeStemFileMock = vi.fn()
vi.mock('./decodeStemFile', () => ({ decodeStemFile: decodeStemFileMock }))

function fakeBuffer(): AudioBuffer & { reads: () => number } {
  let reads = 0
  const samples = new Float32Array(4096).map((_, i) => (i % 64 === 0 ? 0.9 : 0.05))
  return {
    getChannelData: () => {
      reads++
      return samples
    },
    reads: () => reads
  } as unknown as AudioBuffer & { reads: () => number }
}

describe('detailPeakCache', () => {
  beforeEach(() => {
    vi.resetModules()
    decodeStemFileMock.mockReset()
    vi.stubGlobal('window', { rifffApi: {} })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('draws from a buffer the caller already decoded, at the asked resolution, without decoding again', async () => {
    const { getDetailWaveform } = await import('./detailPeakCache')
    const buf = fakeBuffer()
    const a = await getDetailWaveform('/a.ogg', 256, buf)
    expect(a.peaks).toHaveLength(256)
    expect(a.brightness).toHaveLength(256)
    expect(decodeStemFileMock).not.toHaveBeenCalled()
  })

  it('computes once per path and resolution', async () => {
    const { getDetailWaveform } = await import('./detailPeakCache')
    const buf = fakeBuffer()
    await getDetailWaveform('/a.ogg', 256, buf)
    const readsAfterFirst = buf.reads()
    await getDetailWaveform('/a.ogg', 256, buf)
    expect(buf.reads()).toBe(readsAfterFirst)
    await getDetailWaveform('/a.ogg', 512, buf)
    expect(buf.reads()).toBeGreaterThan(readsAfterFirst)
  })

  it('shares one decode between concurrent callers that bring no buffer', async () => {
    decodeStemFileMock.mockResolvedValue(fakeBuffer())
    const { getDetailWaveform } = await import('./detailPeakCache')
    const [a, b] = await Promise.all([
      getDetailWaveform('/a.ogg', 256),
      getDetailWaveform('/a.ogg', 256)
    ])
    expect(a).toBe(b)
    expect(decodeStemFileMock).toHaveBeenCalledTimes(1)
  })

  it('forgets a failed decode so the next call retries', async () => {
    decodeStemFileMock.mockRejectedValueOnce(new Error('mid-copy')).mockResolvedValue(fakeBuffer())
    const { getDetailWaveform } = await import('./detailPeakCache')
    await expect(getDetailWaveform('/a.ogg', 256)).rejects.toThrow('mid-copy')
    await expect(getDetailWaveform('/a.ogg', 256)).resolves.toBeTruthy()
    expect(decodeStemFileMock).toHaveBeenCalledTimes(2)
  })

  it('recomputes after an eviction (a re-bake rewrites the same path)', async () => {
    const { getDetailWaveform, evictDetailWaveform } = await import('./detailPeakCache')
    const buf = fakeBuffer()
    await getDetailWaveform('/a.ogg', 256, buf)
    const readsAfterFirst = buf.reads()
    evictDetailWaveform('/a.ogg')
    await getDetailWaveform('/a.ogg', 256, buf)
    expect(buf.reads()).toBeGreaterThan(readsAfterFirst)
  })

  it('keeps only the newest entries', async () => {
    const { getDetailWaveform, DETAIL_ENTRY_CAP } = await import('./detailPeakCache')
    const first = fakeBuffer()
    await getDetailWaveform('/0.ogg', 256, first)
    for (let i = 1; i <= DETAIL_ENTRY_CAP; i++) {
      await getDetailWaveform(`/${i}.ogg`, 256, fakeBuffer())
    }
    const readsBefore = first.reads()
    await getDetailWaveform('/0.ogg', 256, first)
    expect(first.reads()).toBeGreaterThan(readsBefore)
  })
})
