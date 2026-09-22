import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('analysisWriteQueue (B7)', () => {
  let setStemAnalysisResults: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    setStemAnalysisResults = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('window', { rifffApi: { setStemAnalysisResults } })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("merges a stem's writes and flushes them as one batch after the delay", async () => {
    const q = await import('./analysisWriteQueue')
    q.queueStemAnalysisWrite('/a', { peaks: { peaks: [1], brightness: [2] } })
    q.queueStemAnalysisWrite('/a', { embedding: [3], zeroShotAttempted: true })
    q.queueStemAnalysisWrite('/b', { features: { mfcc: [] } as never })

    await vi.advanceTimersByTimeAsync(q.FLUSH_DELAY_MS - 1)
    expect(setStemAnalysisResults).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(setStemAnalysisResults).toHaveBeenCalledTimes(1)
    expect(setStemAnalysisResults).toHaveBeenCalledWith([
      {
        path: '/a',
        peaks: { peaks: [1], brightness: [2] },
        embedding: [3],
        zeroShotAttempted: true
      },
      { path: '/b', features: { mfcc: [] } }
    ])
    expect(q.pendingStemAnalysisWriteCount()).toBe(0)
  })

  it('flushes as soon as FLUSH_STEM_COUNT stems are waiting', async () => {
    const q = await import('./analysisWriteQueue')
    for (let i = 0; i < q.FLUSH_STEM_COUNT - 1; i++)
      q.queueStemAnalysisWrite(`/s${i}`, { embedding: [i] })
    expect(setStemAnalysisResults).not.toHaveBeenCalled()
    q.queueStemAnalysisWrite('/last', { embedding: [9] })
    expect(setStemAnalysisResults).toHaveBeenCalledTimes(1)
    expect((setStemAnalysisResults.mock.calls[0][0] as unknown[]).length).toBe(q.FLUSH_STEM_COUNT)

    // The size-triggered flush cancelled the timer -- nothing more later.
    await vi.advanceTimersByTimeAsync(q.FLUSH_DELAY_MS * 2)
    expect(setStemAnalysisResults).toHaveBeenCalledTimes(1)
  })

  it('does not count the same stem twice towards the size trigger', async () => {
    const q = await import('./analysisWriteQueue')
    for (let i = 0; i < q.FLUSH_STEM_COUNT * 2; i++)
      q.queueStemAnalysisWrite('/same', { embedding: [i] })
    expect(setStemAnalysisResults).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(q.FLUSH_DELAY_MS)
    expect(setStemAnalysisResults).toHaveBeenCalledWith([
      { path: '/same', embedding: [q.FLUSH_STEM_COUNT * 2 - 1] }
    ])
  })

  it('flush with nothing queued sends nothing, and a failed send never rejects', async () => {
    const q = await import('./analysisWriteQueue')
    await q.flushStemAnalysisWrites()
    expect(setStemAnalysisResults).not.toHaveBeenCalled()

    setStemAnalysisResults.mockRejectedValueOnce(new Error('main gone'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    q.queueStemAnalysisWrite('/a', { embedding: [1] })
    await expect(q.flushStemAnalysisWrites()).resolves.toBeUndefined()
    errSpy.mockRestore()
  })

  it('flushes when the page is hidden or unloaded', async () => {
    const docListeners = new Map<string, () => void>()
    const winListeners = new Map<string, () => void>()
    const doc = {
      visibilityState: 'visible',
      addEventListener: (type: string, fn: () => void) => docListeners.set(type, fn)
    }
    vi.stubGlobal('document', doc)
    vi.stubGlobal('window', {
      rifffApi: { setStemAnalysisResults },
      addEventListener: (type: string, fn: () => void) => winListeners.set(type, fn)
    })
    const q = await import('./analysisWriteQueue')

    q.queueStemAnalysisWrite('/a', { embedding: [1] })
    doc.visibilityState = 'hidden'
    docListeners.get('visibilitychange')?.()
    expect(setStemAnalysisResults).toHaveBeenCalledTimes(1)

    q.queueStemAnalysisWrite('/b', { embedding: [2] })
    winListeners.get('pagehide')?.()
    expect(setStemAnalysisResults).toHaveBeenCalledTimes(2)
  })
})
