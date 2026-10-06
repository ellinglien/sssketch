// src/shared/stemPriorityOrder.test.ts
import { describe, expect, it } from 'vitest'
import {
  STEM_PRIORITY_FAVOURITE,
  STEM_PRIORITY_OWN,
  STEM_PRIORITY_REST,
  orderByStemPriority,
  stemPriorityRank
} from './stemPriorityOrder'

const priority = {
  own: new Set(['o1', 'o2', 'both']),
  favourites: new Set(['f1', 'both'])
}

describe('stemPriorityRank', () => {
  it('own first, then favourites, then the rest; own wins over a favourite', () => {
    expect(stemPriorityRank(priority, 'o1')).toBe(STEM_PRIORITY_OWN)
    expect(stemPriorityRank(priority, 'both')).toBe(STEM_PRIORITY_OWN)
    expect(stemPriorityRank(priority, 'f1')).toBe(STEM_PRIORITY_FAVOURITE)
    expect(stemPriorityRank(priority, 'x')).toBe(STEM_PRIORITY_REST)
  })
})

describe('orderByStemPriority', () => {
  it('a stable partition: own, favourites, rest, each in the order given', () => {
    const items = ['x3', 'f1', 'o2', 'x1', 'both', 'o1', 'x2'].map((key) => ({ key }))
    expect(orderByStemPriority(items, (i) => i.key, priority).map((i) => i.key)).toEqual([
      'o2',
      'both',
      'o1',
      'f1',
      'x3',
      'x1',
      'x2'
    ])
  })

  it('no priority (no username, no favourites): the order given, as a copy', () => {
    const items = ['b', 'a', 'c']
    const empty = { own: new Set<string>(), favourites: new Set<string>() }
    const out = orderByStemPriority(items, (k) => k, empty)
    expect(out).toEqual(['b', 'a', 'c'])
    expect(out).not.toBe(items)
  })
})
