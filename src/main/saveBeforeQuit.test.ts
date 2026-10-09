import { describe, expect, it, vi } from 'vitest'
import { awaitSaveBeforeQuit } from './saveBeforeQuit'

describe('awaitSaveBeforeQuit', () => {
  it('reports the renderer result and unsubscribes', async () => {
    let complete: ((requestId: string, success: boolean) => void) | undefined
    const unsubscribe = vi.fn()
    const result = awaitSaveBeforeQuit(
      'request-1',
      (requestId) => complete?.(requestId, true),
      (callback) => {
        complete = callback
        return unsubscribe
      },
      1000
    )
    await expect(result).resolves.toBe('saved')
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('does not turn a failed save into permission to quit', async () => {
    let complete: ((requestId: string, success: boolean) => void) | undefined
    const result = awaitSaveBeforeQuit(
      'request-2',
      (requestId) => complete?.(requestId, false),
      (callback) => {
        complete = callback
        return () => {}
      },
      1000
    )
    await expect(result).resolves.toBe('failed')
  })

  it('reports timeout rather than treating a hung save as complete', async () => {
    vi.useFakeTimers()
    try {
      const unsubscribe = vi.fn()
      const result = awaitSaveBeforeQuit(
        'request-3',
        () => {},
        () => unsubscribe,
        5000
      )
      await vi.advanceTimersByTimeAsync(5000)
      await expect(result).resolves.toBe('timeout')
      expect(unsubscribe).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('ignores a late reply from an earlier timed-out request', async () => {
    let complete: ((requestId: string, success: boolean) => void) | undefined
    const result = awaitSaveBeforeQuit(
      'new-request',
      () => {
        complete?.('old-request', true)
        complete?.('new-request', false)
      },
      (callback) => {
        complete = callback
        return () => {}
      },
      1000
    )
    await expect(result).resolves.toBe('failed')
  })
})
