import { describe, expect, it } from 'vitest'
import { dialFor, withDial } from './stemCategoryDial'
import { buildQuantileTable } from './traitQuantiles'

describe('dialFor', () => {
  const table = buildQuantileTable([0.2, 0.3, 0.4, 0.5, 0.6])
  it('a label sets the dial', () => {
    expect(dialFor({ kindSources: { front: 'confirmed' }, frontScore: null, table })).toBe(1)
    expect(dialFor({ kindSources: { back: 'confirmed' }, frontScore: 0.9, table })).toBe(0)
  })
  it('a guess is its place in the library', () => {
    expect(dialFor({ kindSources: { front: 'guess' }, frontScore: 0.6, table })).toBe(1)
    expect(dialFor({ kindSources: {}, frontScore: 0.2, table })).toBe(0)
  })
  it('no score, no dial; no table, the raw score', () => {
    expect(dialFor({ kindSources: {}, frontScore: null, table })).toBeNull()
    expect(
      dialFor({ kindSources: { front: 'tag', back: 'tag' }, frontScore: undefined, table })
    ).toBeNull()
    expect(dialFor({ kindSources: {}, frontScore: 0.3, table: null })).toBe(0.3)
  })
})

describe('withDial', () => {
  it('sets front and back as opposite ends, keeping trait percentiles', () => {
    const c = withDial({ traitPercentiles: { bright: 0.4 } }, 0.75)
    expect(c.traitPercentiles).toEqual({ bright: 0.4, front: 0.75, back: 0.25 })
    expect(withDial({ traitPercentiles: {} }, null).traitPercentiles).toEqual({
      front: null,
      back: null
    })
  })
})
