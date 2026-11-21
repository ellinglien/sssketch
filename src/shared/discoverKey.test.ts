import { describe, expect, it } from 'vitest'
import { rankBalanceFor, rankKeyFor, rowKeyLabel } from './discoverKey'
import type { DiscoverSlotKind } from './discoverSlotKind'

const row = (
  id: string,
  kinds: DiscoverSlotKind[],
  root: number | null,
  scale: number | null
): Parameters<typeof rankKeyFor>[0][number] => ({
  id,
  kinds,
  candidate: root === null && scale === null ? null : { riffRoot: root, riffScale: scale }
})

describe('rankKeyFor', () => {
  const rows = [
    row('a', ['drums'], 0, 0),
    row('b', ['bass'], 9, 5),
    row('c', ['front'], 4, 5),
    row('d', ['back'], null, null)
  ]
  it('takes every other non-drums row that has a candidate', () => {
    expect(rankKeyFor(rows, 'c', ['front'])).toEqual({
      others: [{ root: 9, scale: 5 }],
      exempt: false
    })
  })
  it('a drums slot is exempt', () => {
    expect(rankKeyFor(rows, 'a', ['drums']).exempt).toBe(true)
  })
  it('a drums slot with a trait is still exempt', () => {
    expect(rankKeyFor(rows, 'a', ['drums', 'bright']).exempt).toBe(true)
  })
  it('a drums row with a trait is still left out of the others', () => {
    const mixed = [row('e', ['drums', 'bright'], 2, 0), row('f', ['back'], 7, 1)]
    expect(rankKeyFor(mixed, 'g', ['bass']).others).toEqual([{ root: 7, scale: 1 }])
  })
  it('a candidate without the key fields is an unknown key', () => {
    const bare = [{ id: 'h', kinds: ['bass' as const], candidate: {} }]
    expect(rankKeyFor(bare, 'g', ['front']).others).toEqual([{ root: null, scale: null }])
  })
})

describe('rowKeyLabel', () => {
  it('names a known key in lowercase', () => expect(rowKeyLabel(5, 5)).toBe('f minor (aeolian)'))
  it('is undefined for unknown or chromatic', () => {
    expect(rowKeyLabel(null, 5)).toBeUndefined()
    expect(rowKeyLabel(undefined, undefined)).toBeUndefined()
    expect(rowKeyLabel(0, 17)).toBeUndefined()
  })
})

describe('rankBalanceFor', () => {
  const p = (
    id: string,
    kinds: DiscoverSlotKind[],
    presence?: number | null
  ): Parameters<typeof rankBalanceFor>[0][number] => ({ id, kinds, candidate: { presence } })
  const rows = [
    p('a', ['drums'], 0.8),
    p('b', ['bass'], 0.6),
    p('c', ['front'], 0.3),
    p('d', ['back'], null),
    p('e', ['back']),
    { id: 'f', kinds: ['front' as const], candidate: null }
  ]
  it('counts the other rows with a presence, bass among them, drums left out', () => {
    expect(rankBalanceFor(rows, 'c', ['front'])).toEqual({ others: [0.6], exempt: false })
    expect(rankBalanceFor(rows, 'new', ['back']).others).toEqual([0.6, 0.3])
  })
  it('counts drum rows with countDrums', () => {
    expect(rankBalanceFor(rows, 'c', ['front'], true).others).toEqual([0.8, 0.6])
  })
  it('a drums slot is exempt, unless drums count', () => {
    expect(rankBalanceFor(rows, 'a', ['drums', 'bright']).exempt).toBe(true)
    expect(rankBalanceFor(rows, 'a', ['drums'], true)).toEqual({
      others: [0.6, 0.3],
      exempt: false
    })
  })
  it('leaves out a presence that is not a finite number', () => {
    expect(rankBalanceFor([p('g', ['bass'], NaN)], 'new', ['front']).others).toEqual([])
  })
})
