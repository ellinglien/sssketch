// src/main/instrumentRowsLookup.test.ts -- pure, no database (stays in CI).
import { describe, expect, it } from 'vitest'
import { createInstrumentRowsLookup, rowsNotIn, type InstrumentRow } from './instrumentRowsLookup'

function row(StemCID: string, Instrument: number | null): InstrumentRow {
  return { StemCID, Instrument, OwnerJamCID: 'jam' }
}

describe('createInstrumentRowsLookup', () => {
  it('finds every row of a StemCID-ordered array, and nothing else', () => {
    const rows = Array.from({ length: 1000 }, (_, i) => row(`s${String(i).padStart(5, '0')}`, i))
    const lookup = createInstrumentRowsLookup(rows)
    for (const r of rows) expect(lookup(r.StemCID)).toBe(r.Instrument)
    expect(lookup('s')).toBeUndefined()
    expect(lookup('s00000x')).toBeUndefined()
    expect(lookup('zzz')).toBeUndefined()
    expect(lookup('')).toBeUndefined()
  })

  it('tells a present row with no mask (null) from an absent one (undefined)', () => {
    const lookup = createInstrumentRowsLookup([row('a', 2), row('b', null), row('c', 0)])
    expect(lookup('a')).toBe(2)
    expect(lookup('b')).toBeNull()
    expect(lookup('c')).toBe(0)
    expect(lookup('d')).toBeUndefined()
  })

  it('sees rows appended after it was made (a keep folding new stems into the cache)', () => {
    const rows = [row('b', 1), row('d', 2)]
    const lookup = createInstrumentRowsLookup(rows)
    expect(lookup('a')).toBeUndefined()
    rows.push(row('a', 4), row('c', 8))
    expect(lookup('a')).toBe(4)
    expect(lookup('c')).toBe(8)
    expect(lookup('b')).toBe(1)
    rows.push(row('e', 16))
    expect(lookup('e')).toBe(16)
  })

  it('is right for an array in no particular order', () => {
    const ids = ['m', 'c', 'x', 'a', 'q', 'b']
    const rows = ids.map((id, i) => row(id, i))
    const lookup = createInstrumentRowsLookup(rows)
    ids.forEach((id, i) => expect(lookup(id)).toBe(i))
    expect(lookup('n')).toBeUndefined()
  })

  it('first row wins for a repeated StemCID (Stems keys StemCID, so this is only defensive)', () => {
    const lookup = createInstrumentRowsLookup([row('a', 1), row('b', 2), row('b', 3), row('c', 4)])
    expect(lookup('b')).toBe(2)
  })

  it('an empty array finds nothing', () => {
    expect(createInstrumentRowsLookup([])('a')).toBeUndefined()
  })
})

describe('rowsNotIn', () => {
  it('drops candidates the rows already hold, in the sorted prefix or the unsorted tail', async () => {
    const rows = [
      ...Array.from({ length: 5000 }, (_, i) => row(`s${String(i).padStart(5, '0')}`, i)),
      row('kept-b', 1), // folded in at the end, out of order
      row('kept-a', 2)
    ]
    const candidates = [
      row('s00007', 7),
      row('kept-a', 2),
      row('new-1', 3),
      row('kept-b', 1),
      row('new-0', 4)
    ]
    expect((await rowsNotIn(rows, candidates)).map((r) => r.StemCID)).toEqual(['new-1', 'new-0'])
  })

  it('keeps every candidate against an empty base, and none against itself', async () => {
    const candidates = [row('b', 1), row('a', 2)]
    expect(await rowsNotIn([], candidates)).toEqual(candidates)
    expect(await rowsNotIn(candidates, candidates)).toEqual([])
  })
})
