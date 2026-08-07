import { describe, expect, it, vi } from 'vitest'

describe('runWithConcurrency', () => {
  it('calls the worker exactly once for every item', async () => {
    const { runWithConcurrency } = await import('./endlesssSync')
    const seen: number[] = []
    await runWithConcurrency([1, 2, 3, 4, 5], 2, async (item) => {
      seen.push(item)
    })
    expect(seen.slice().sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5])
  })

  it('never runs more than `limit` workers concurrently', async () => {
    const { runWithConcurrency } = await import('./endlesssSync')
    let inFlight = 0
    let maxInFlight = 0
    await runWithConcurrency(
      Array.from({ length: 10 }, (_, i) => i),
      3,
      async () => {
        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 5))
        inFlight--
      }
    )
    expect(maxInFlight).toBeLessThanOrEqual(3)
  })

  it('handles an empty item list without error', async () => {
    const { runWithConcurrency } = await import('./endlesssSync')
    const worker = vi.fn()
    await runWithConcurrency([], 3, worker)
    expect(worker).not.toHaveBeenCalled()
  })
})
