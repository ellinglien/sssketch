import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('decodeStemFile', () => {
  let readAudioFileMock: ReturnType<typeof vi.fn>
  let decodeAudioDataMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    // Fresh module instance per test so the in-flight map doesn't leak
    // between tests -- same reasoning as peakCache.test.ts's own reset.
    vi.resetModules()
    readAudioFileMock = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3, 4]))
    decodeAudioDataMock = vi.fn().mockResolvedValue({ decoded: true })
    vi.stubGlobal('window', { rifffApi: { readAudioFile: readAudioFileMock } })
    class FakeAudioContext {
      decodeAudioData = decodeAudioDataMock
    }
    vi.stubGlobal('AudioContext', FakeAudioContext)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads and decodes once for concurrent callers of the same path', async () => {
    const { decodeStemFile } = await import('./decodeStemFile')
    const [a, b, c] = await Promise.all([
      decodeStemFile('/stem.wav'),
      decodeStemFile('/stem.wav'),
      decodeStemFile('/stem.wav')
    ])
    // The bug this fixes: peakCache, pitchCache, bandEnergyCache and
    // phraseCache each used to read + copy + decode the SAME file
    // independently, so one stem appearing in the UI cost up to four full
    // decodes -- megabytes apiece, all live at once.
    expect(readAudioFileMock).toHaveBeenCalledTimes(1)
    expect(decodeAudioDataMock).toHaveBeenCalledTimes(1)
    expect(a).toBe(b)
    expect(b).toBe(c)
  })

  it('keeps separate paths separate', async () => {
    const { decodeStemFile } = await import('./decodeStemFile')
    await Promise.all([decodeStemFile('/a.wav'), decodeStemFile('/b.wav')])
    expect(decodeAudioDataMock).toHaveBeenCalledTimes(2)
  })

  it('does NOT retain the decoded buffer once every caller has it', async () => {
    const { decodeStemFile } = await import('./decodeStemFile')
    await decodeStemFile('/stem.wav')
    await decodeStemFile('/stem.wav')
    // Deliberately two decodes, not one. This shares work between
    // callers that overlap in time; it is not a buffer cache. An
    // AudioBuffer is megabytes, and holding every stem ever decoded is
    // how the renderer reached a 4GB heap -- the per-path caches keep the
    // small derived arrays, and the buffer is released.
    expect(decodeAudioDataMock).toHaveBeenCalledTimes(2)
  })

  it('hands the whole buffer straight to the decoder instead of copying it', async () => {
    const { decodeStemFile } = await import('./decodeStemFile')
    const bytes = new Uint8Array([1, 2, 3, 4])
    readAudioFileMock.mockResolvedValue(bytes)
    await decodeStemFile('/stem.wav')
    // Not a copy: a defensive slice of a multi-megabyte file doubles the
    // allocation, and both halves then sit in the heap until the next
    // collection. decodeAudioData detaches what it is given, so passing
    // the original releases it promptly instead.
    expect(decodeAudioDataMock.mock.calls[0][0]).toBe(bytes.buffer)
  })

  it('still copies when the view is a window onto a larger buffer', async () => {
    const { decodeStemFile } = await import('./decodeStemFile')
    const backing = new ArrayBuffer(16)
    readAudioFileMock.mockResolvedValue(new Uint8Array(backing, 4, 8))
    await decodeStemFile('/stem.wav')
    const passed = decodeAudioDataMock.mock.calls[0][0] as ArrayBuffer
    expect(passed).not.toBe(backing)
    expect(passed.byteLength).toBe(8)
  })

  it('lets a later call retry after a failure, and does not strand the sharers', async () => {
    const { decodeStemFile } = await import('./decodeStemFile')
    decodeAudioDataMock.mockRejectedValueOnce(new Error('corrupt'))
    await expect(
      Promise.all([decodeStemFile('/stem.wav'), decodeStemFile('/stem.wav')])
    ).rejects.toThrow('corrupt')
    decodeAudioDataMock.mockResolvedValue({ decoded: true })
    await expect(decodeStemFile('/stem.wav')).resolves.toEqual({ decoded: true })
  })
})
