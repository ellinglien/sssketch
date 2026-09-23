import { describe, expect, it } from 'vitest'
import {
  distinctPlacedBarLengths,
  unguidedMapColumns,
  unguidedPhraseBars
} from './arrangementMapColumns'

describe('unguidedMapColumns', () => {
  it('gives one column per whole phrase', () => {
    const columns = unguidedMapColumns(16, 4)
    expect(columns.map((c) => c.startBar)).toEqual([0, 4, 8, 12])
    expect(columns.every((c) => c.passes === 1)).toBe(true)
  })

  it('names nothing -- a column header carries no text at all', () => {
    expect(unguidedMapColumns(8, 4).every((c) => c.name === null)).toBe(true)
  })

  it('gives stable, distinct ids so React keys do not collide', () => {
    const ids = unguidedMapColumns(12, 4).map((c) => c.id)
    expect(new Set(ids).size).toBe(3)
    expect(unguidedMapColumns(12, 4).map((c) => c.id)).toEqual(ids)
  })

  it('rounds a partial last phrase UP to a whole column', () => {
    expect(unguidedMapColumns(9, 4)).toHaveLength(3)
  })

  it('is empty for an empty timeline', () => {
    expect(unguidedMapColumns(0, 4)).toEqual([])
  })

  it('gives one column when the phrase is longer than the arrangement', () => {
    expect(unguidedMapColumns(3, 8)).toHaveLength(1)
  })

  it('treats a nonsense phrase as one bar rather than dividing by zero', () => {
    expect(unguidedMapColumns(4, 0)).toHaveLength(4)
    expect(unguidedMapColumns(4, Number.NaN)).toHaveLength(4)
  })
})

describe('unguidedPhraseBars', () => {
  it('is the EARLIEST placed loop bar length', () => {
    expect(
      unguidedPhraseBars([
        { startBar: 8, barLength: 2 },
        { startBar: 0, barLength: 4 },
        { startBar: 4, barLength: 16 }
      ])
    ).toBe(4)
  })

  it('breaks a startBar tie toward the longer loop, so squares are not too small', () => {
    expect(
      unguidedPhraseBars([
        { startBar: 0, barLength: 2 },
        { startBar: 0, barLength: 8 }
      ])
    ).toBe(8)
  })

  it('is null for nothing placed', () => {
    expect(unguidedPhraseBars([])).toBeNull()
  })

  it('ignores a loop with no usable bar length', () => {
    expect(
      unguidedPhraseBars([
        { startBar: 0, barLength: 0 },
        { startBar: 4, barLength: 4 }
      ])
    ).toBe(4)
  })
})

describe('distinctPlacedBarLengths', () => {
  it('reports the lengths actually present, ascending, deduplicated', () => {
    expect(
      distinctPlacedBarLengths([
        { startBar: 0, barLength: 4 },
        { startBar: 4, barLength: 8 },
        { startBar: 8, barLength: 4 }
      ])
    ).toEqual([4, 8])
  })

  it('reports one length when every loop agrees, so the caller can stay silent', () => {
    expect(distinctPlacedBarLengths([{ startBar: 0, barLength: 4 }])).toEqual([4])
  })

  it('never invents a length nobody placed', () => {
    expect(distinctPlacedBarLengths([])).toEqual([])
  })
})
