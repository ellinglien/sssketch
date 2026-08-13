import { describe, expect, it } from 'vitest'
import { emptyBusCentroidStore, recordConfirmedStem, suggestBus } from './busCentroids'

const DIM = 19
function vec(fillValue: number): number[] {
  return new Array(DIM).fill(fillValue)
}

describe('emptyBusCentroidStore', () => {
  it('starts with no trained buses and zeroed global stats', () => {
    const store = emptyBusCentroidStore()
    expect(store.buses).toEqual({})
    expect(store.global.count).toBe(0)
    expect(store.global.mean).toEqual(vec(0))
  })
})

describe('recordConfirmedStem', () => {
  it('is a no-op for aux -- the store reference is returned unchanged', () => {
    const store = emptyBusCentroidStore()
    const result = recordConfirmedStem(store, 'aux', vec(5))
    expect(result).toBe(store)
  })

  it('tracks a running mean per bus across multiple confirms', () => {
    let store = emptyBusCentroidStore()
    store = recordConfirmedStem(store, 'drums', vec(0))
    store = recordConfirmedStem(store, 'drums', vec(10))
    // Mean of [0,0,...] and [10,10,...] is [5,5,...].
    expect(store.buses.drums?.count).toBe(2)
    expect(store.buses.drums?.mean).toEqual(vec(5))
  })

  it('updates global stats regardless of which trainable bus the stem went to', () => {
    let store = emptyBusCentroidStore()
    store = recordConfirmedStem(store, 'drums', vec(0))
    store = recordConfirmedStem(store, 'bass', vec(10))
    expect(store.global.count).toBe(2)
    expect(store.global.mean).toEqual(vec(5))
  })

  it('keeps each bus centroid independent of the others', () => {
    let store = emptyBusCentroidStore()
    store = recordConfirmedStem(store, 'drums', vec(0))
    store = recordConfirmedStem(store, 'bass', vec(100))
    expect(store.buses.drums?.mean).toEqual(vec(0))
    expect(store.buses.bass?.mean).toEqual(vec(100))
  })
})

describe('suggestBus', () => {
  it('returns null when no bus has enough trained samples yet', () => {
    let store = emptyBusCentroidStore()
    store = recordConfirmedStem(store, 'drums', vec(0))
    store = recordConfirmedStem(store, 'drums', vec(1))
    // Only 2 samples -- below MIN_SAMPLES_PER_BUS (3).
    expect(suggestBus(store, vec(0))).toBeNull()
  })

  it('suggests the nearest trained bus once it has enough samples, with only one bus trained', () => {
    let store = emptyBusCentroidStore()
    for (let i = 0; i < 5; i++) store = recordConfirmedStem(store, 'drums', vec(0))
    // Any nonzero query still resolves to the only trained bus -- nothing
    // to disambiguate against.
    expect(suggestBus(store, vec(1))).toBe('drums')
  })

  it('picks the closer of two well-separated trained buses', () => {
    let store = emptyBusCentroidStore()
    for (let i = 0; i < 5; i++) store = recordConfirmedStem(store, 'drums', vec(0))
    for (let i = 0; i < 5; i++) store = recordConfirmedStem(store, 'bass', vec(20))
    expect(suggestBus(store, vec(1))).toBe('drums')
    expect(suggestBus(store, vec(19))).toBe('bass')
  })

  it('returns null (declines to guess) for a query roughly equidistant between two trained buses', () => {
    let store = emptyBusCentroidStore()
    for (let i = 0; i < 5; i++) store = recordConfirmedStem(store, 'drums', vec(0))
    for (let i = 0; i < 5; i++) store = recordConfirmedStem(store, 'bass', vec(20))
    // Dead center between the two centroids -- equally "confident" about
    // both, which is exactly the case the ratio gate exists to catch.
    expect(suggestBus(store, vec(10))).toBeNull()
  })

  it('a bus with a variance of zero across every trained sample does not blow up standardization', () => {
    let store = emptyBusCentroidStore()
    // Every recorded vector is identical -- global stddev is 0 in every
    // dimension, which standardize() must treat as "no information here"
    // rather than dividing by zero.
    for (let i = 0; i < 5; i++) store = recordConfirmedStem(store, 'drums', vec(3))
    expect(() => suggestBus(store, vec(3))).not.toThrow()
    expect(suggestBus(store, vec(3))).toBe('drums')
  })
})
