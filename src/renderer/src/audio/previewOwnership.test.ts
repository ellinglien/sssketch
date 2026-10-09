import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isActivePreview,
  registerActivePreview,
  stopActivePreview,
  unregisterActivePreview
} from './previewLoop'

describe('preview request ownership', () => {
  afterEach(() => stopActivePreview())

  it('lets transport Play cancel a request before it has started audio', () => {
    const stopPendingRequest = vi.fn()
    const token = registerActivePreview(stopPendingRequest)

    expect(isActivePreview(token)).toBe(true)
    stopActivePreview()

    expect(stopPendingRequest).toHaveBeenCalledOnce()
    expect(isActivePreview(token)).toBe(false)
  })

  it('invalidates the previous request before invoking its cleanup', () => {
    let firstWasCurrentDuringCleanup = true
    let firstToken = 0
    firstToken = registerActivePreview(() => {
      firstWasCurrentDuringCleanup = isActivePreview(firstToken)
      unregisterActivePreview(firstToken)
    })

    const secondStop = vi.fn()
    const secondToken = registerActivePreview(secondStop)

    expect(firstWasCurrentDuringCleanup).toBe(false)
    expect(isActivePreview(secondToken)).toBe(true)
    expect(secondStop).not.toHaveBeenCalled()
  })

  it('does not let stale cleanup unregister a newer request', () => {
    const firstToken = registerActivePreview(vi.fn())
    const secondStop = vi.fn()
    const secondToken = registerActivePreview(secondStop)

    unregisterActivePreview(firstToken)

    expect(isActivePreview(secondToken)).toBe(true)
    stopActivePreview()
    expect(secondStop).toHaveBeenCalledOnce()
  })
})
