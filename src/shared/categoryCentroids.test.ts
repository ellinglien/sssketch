import { describe, expect, it } from 'vitest'
import {
  emptyCategoryCentroidStore,
  recordConfirmedCategory,
  suggestCategory
} from './categoryCentroids'

const DIM = 19
function vec(fillValue: number): number[] {
  return new Array(DIM).fill(fillValue)
}

describe('emptyCategoryCentroidStore', () => {
  it('starts with no trained categories on any axis and zeroed global stats', () => {
    const store = emptyCategoryCentroidStore()
    expect(store.buses).toEqual({})
    expect(store.arrangeRoles).toEqual({})
    expect(store.drumSubRoles).toEqual({})
    expect(store.global.count).toBe(0)
    expect(store.global.mean).toEqual(vec(0))
  })
})

describe('recordConfirmedCategory', () => {
  it('is a no-op for a non-trainable category on the bus axis (aux) -- store reference unchanged', () => {
    const store = emptyCategoryCentroidStore()
    const result = recordConfirmedCategory(store, 'bus', 'aux', vec(5))
    expect(result).toBe(store)
  })

  it('is a no-op for a non-trainable category on the arrangeRole axis (aux)', () => {
    const store = emptyCategoryCentroidStore()
    const result = recordConfirmedCategory(store, 'arrangeRole', 'aux', vec(5))
    expect(result).toBe(store)
  })

  it('is a no-op for a non-trainable category on the drumSubRole axis (perc)', () => {
    const store = emptyCategoryCentroidStore()
    const result = recordConfirmedCategory(store, 'drumSubRole', 'perc', vec(5))
    expect(result).toBe(store)
  })

  it('tracks a running mean per category across multiple confirms, on the bus axis', () => {
    let store = emptyCategoryCentroidStore()
    store = recordConfirmedCategory(store, 'bus', 'drums', vec(0))
    store = recordConfirmedCategory(store, 'bus', 'drums', vec(10))
    expect(store.buses.drums?.count).toBe(2)
    expect(store.buses.drums?.mean).toEqual(vec(5))
  })

  it('tracks a running mean per category on the arrangeRole axis, independently of the bus axis', () => {
    let store = emptyCategoryCentroidStore()
    store = recordConfirmedCategory(store, 'bus', 'drums', vec(0))
    store = recordConfirmedCategory(store, 'arrangeRole', 'vocal', vec(10))
    expect(store.buses.drums?.mean).toEqual(vec(0))
    expect(store.arrangeRoles.vocal?.mean).toEqual(vec(10))
    expect(store.buses.vocal).toBeUndefined()
    expect(store.arrangeRoles.drums).toBeUndefined()
  })

  it('tracks a running mean per category on the drumSubRole axis', () => {
    let store = emptyCategoryCentroidStore()
    store = recordConfirmedCategory(store, 'drumSubRole', 'kick', vec(0))
    store = recordConfirmedCategory(store, 'drumSubRole', 'kick', vec(10))
    expect(store.drumSubRoles.kick?.count).toBe(2)
    expect(store.drumSubRoles.kick?.mean).toEqual(vec(5))
  })

  it('updates ONE shared global stats structure regardless of which axis/category the stem went to', () => {
    let store = emptyCategoryCentroidStore()
    store = recordConfirmedCategory(store, 'bus', 'drums', vec(0))
    store = recordConfirmedCategory(store, 'arrangeRole', 'vocal', vec(10))
    store = recordConfirmedCategory(store, 'drumSubRole', 'kick', vec(20))
    expect(store.global.count).toBe(3)
    expect(store.global.mean).toEqual(vec(10))
  })
})

describe('suggestCategory', () => {
  it('returns null when no category on that axis has enough trained samples yet', () => {
    let store = emptyCategoryCentroidStore()
    store = recordConfirmedCategory(store, 'bus', 'drums', vec(0))
    store = recordConfirmedCategory(store, 'bus', 'drums', vec(1))
    expect(suggestCategory(store, 'bus', vec(0))).toBeNull()
  })

  it('declines to guess when only one category on the axis has enough samples, even for a query right on top of it', () => {
    // Regression test for a real bug (2026-09-14): with only one trained
    // category, the old code had nothing to compare it against, so it
    // returned that category unconditionally for every query, however far
    // away -- observed live as an arrangeRole axis that had only just
    // crossed the sample threshold for 'bass' suggesting "bass" for every
    // single stem regardless of actual fit. A real classification needs at
    // least two real candidates to discriminate between.
    let store = emptyCategoryCentroidStore()
    for (let i = 0; i < 5; i++) store = recordConfirmedCategory(store, 'bus', 'drums', vec(0))
    expect(suggestCategory(store, 'bus', vec(1))).toBeNull()
    expect(suggestCategory(store, 'bus', vec(500))).toBeNull()
  })

  it('suggests the nearest of two trained categories once both have enough samples', () => {
    let store = emptyCategoryCentroidStore()
    for (let i = 0; i < 5; i++) store = recordConfirmedCategory(store, 'bus', 'drums', vec(0))
    for (let i = 0; i < 5; i++) store = recordConfirmedCategory(store, 'bus', 'bass', vec(20))
    expect(suggestCategory(store, 'bus', vec(1))).toBe('drums')
  })

  it('picks the closer of two well-separated trained categories on the arrangeRole axis', () => {
    let store = emptyCategoryCentroidStore()
    for (let i = 0; i < 5; i++)
      store = recordConfirmedCategory(store, 'arrangeRole', 'drums', vec(0))
    for (let i = 0; i < 5; i++)
      store = recordConfirmedCategory(store, 'arrangeRole', 'vocal', vec(20))
    expect(suggestCategory(store, 'arrangeRole', vec(1))).toBe('drums')
    expect(suggestCategory(store, 'arrangeRole', vec(19))).toBe('vocal')
  })

  it('returns null (declines to guess) for a query roughly equidistant between two trained categories', () => {
    let store = emptyCategoryCentroidStore()
    for (let i = 0; i < 5; i++) store = recordConfirmedCategory(store, 'bus', 'drums', vec(0))
    for (let i = 0; i < 5; i++) store = recordConfirmedCategory(store, 'bus', 'bass', vec(20))
    expect(suggestCategory(store, 'bus', vec(10))).toBeNull()
  })

  it('a category with a variance of zero across every trained sample does not blow up standardization', () => {
    let store = emptyCategoryCentroidStore()
    for (let i = 0; i < 5; i++)
      store = recordConfirmedCategory(store, 'drumSubRole', 'kick', vec(3))
    for (let i = 0; i < 5; i++)
      store = recordConfirmedCategory(store, 'drumSubRole', 'snare', vec(30))
    expect(() => suggestCategory(store, 'drumSubRole', vec(3))).not.toThrow()
    expect(suggestCategory(store, 'drumSubRole', vec(3))).toBe('kick')
  })

  it('querying one axis never returns a category trained only on a different axis', () => {
    let store = emptyCategoryCentroidStore()
    for (let i = 0; i < 5; i++) store = recordConfirmedCategory(store, 'bus', 'drums', vec(0))
    expect(suggestCategory(store, 'arrangeRole', vec(0))).toBeNull()
    expect(suggestCategory(store, 'drumSubRole', vec(0))).toBeNull()
  })
})
