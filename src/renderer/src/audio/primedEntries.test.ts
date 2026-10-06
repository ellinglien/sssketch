import { describe, expect, it } from 'vitest'
import { createPrimedEntries } from './primedEntries'

describe('createPrimedEntries', () => {
  it('evicts the oldest primed path once the cap is passed', () => {
    const evicted: string[] = []
    const primed = createPrimedEntries((p) => evicted.push(p), 3)
    for (const p of ['a', 'b', 'c', 'd', 'e']) primed.add(p)
    expect(evicted).toEqual(['a', 'b'])
    expect(primed.size()).toBe(3)
  })

  it('a promoted (requested) path is never evicted', () => {
    const evicted: string[] = []
    const primed = createPrimedEntries((p) => evicted.push(p), 2)
    primed.add('a')
    primed.add('b')
    primed.promote('a')
    primed.add('c')
    primed.add('d')
    expect(evicted).toEqual(['b'])
    expect(evicted).not.toContain('a')
  })

  it('re-priming a path moves it to the newest end; a forgotten path is not evicted later', () => {
    const evicted: string[] = []
    const primed = createPrimedEntries((p) => evicted.push(p), 2)
    primed.add('a')
    primed.add('b')
    primed.add('a')
    primed.forget('b')
    primed.add('c')
    primed.add('d')
    expect(evicted).toEqual(['a'])
  })
})
