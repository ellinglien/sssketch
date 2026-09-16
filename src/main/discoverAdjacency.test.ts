import { describe, expect, it, vi } from 'vitest'
import { walkAdjacentWindow } from './discoverAdjacency'

describe('walkAdjacentWindow', () => {
  it('walks outward from the center in both directions, closest first', async () => {
    // Ranks 0..6, center at index 3 (rank 3). Every row "matches" (returns
    // its own rank), so this just proves the walk order/direction split.
    const window = [0, 1, 2, 3, 4, 5, 6]
    const matcher = vi.fn(async (row: number) => row)

    const result = await walkAdjacentWindow(window, 3, matcher, 10)

    // newer = smaller rank than center, closest first: 2, 1, 0
    expect(result.newer).toEqual([2, 1, 0])
    // older = larger rank than center, closest first: 4, 5, 6
    expect(result.older).toEqual([4, 5, 6])
  })

  it('stops each direction once maxPerDirection matches are found, even if more rows remain', async () => {
    const window = [0, 1, 2, 3, 4, 5, 6, 7, 8]
    const matcher = vi.fn(async (row: number) => row)

    const result = await walkAdjacentWindow(window, 4, matcher, 2)

    expect(result.newer).toEqual([3, 2])
    expect(result.older).toEqual([5, 6])
    // Never called the matcher for rows past what was needed to find 2
    // matches per direction (rank 0, 1 on the newer side; rank 7, 8 on the
    // older side).
    expect(matcher).not.toHaveBeenCalledWith(1)
    expect(matcher).not.toHaveBeenCalledWith(0)
    expect(matcher).not.toHaveBeenCalledWith(7)
    expect(matcher).not.toHaveBeenCalledWith(8)
  })

  it('skips non-matching rows (matcher returns null) without counting them', async () => {
    const window = [0, 1, 2, 3, 4, 5, 6]
    // Only even ranks "match".
    const matcher = vi.fn(async (row: number) => (row % 2 === 0 ? row : null))

    const result = await walkAdjacentWindow(window, 3, matcher, 2)

    // newer direction from rank 3 outward: 2 (match), 1 (skip), 0 (match) -- 2 found
    expect(result.newer).toEqual([2, 0])
    // older direction from rank 3 outward: 4 (match), 5 (skip), 6 (match) -- 2 found
    expect(result.older).toEqual([4, 6])
  })

  it('returns fewer than maxPerDirection matches when the window runs out first', async () => {
    const window = [0, 1, 2, 3]
    const matcher = vi.fn(async (row: number) => row)

    // Center at rank 1 -- only one row (rank 0) available on the newer
    // side, three available on the older side.
    const result = await walkAdjacentWindow(window, 1, matcher, 5)

    expect(result.newer).toEqual([0])
    expect(result.older).toEqual([2, 3])
  })

  it('returns empty arrays for a center with nothing on either side', async () => {
    const window = [0]
    const matcher = vi.fn(async (row: number) => row)

    const result = await walkAdjacentWindow(window, 0, matcher, 5)

    expect(result.newer).toEqual([])
    expect(result.older).toEqual([])
    expect(matcher).not.toHaveBeenCalled()
  })
})
