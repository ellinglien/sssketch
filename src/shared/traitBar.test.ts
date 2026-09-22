import { describe, it, expect } from 'vitest'
import { applyTraitBar } from './traitBar'
import type { TraitPercentiles } from './traitQuantiles'

interface Item {
  id: string
  traitPercentiles: TraitPercentiles
}

function item(id: string, traitPercentiles: TraitPercentiles): Item {
  return { id, traitPercentiles }
}

/** n analysed items with bright percentile evenly spread over [0, 1). */
function spread(n: number): Item[] {
  return Array.from({ length: n }, (_, i) => item(`s${i}`, { bright: i / n }))
}

describe('applyTraitBar', () => {
  it('no target traits -> the pool untouched, barUsed null', () => {
    const pool = [item('a', {}), item('b', { bright: 0.1 })]
    expect(applyTraitBar(pool, [])).toEqual({ pool, barUsed: null })
  })

  it('keeps only analysed candidates at or above a 0.6 bar', () => {
    const items = spread(100)
    const { pool, barUsed } = applyTraitBar(items, ['bright'], { bar: 0.6 })
    expect(barUsed).toBe(0.6)
    expect(pool).toHaveLength(40)
    expect(pool.every((c) => c.traitPercentiles.bright! >= 0.6)).toBe(true)
  })

  it('preserves input order', () => {
    const items = [item('x', { bright: 0.9 }), ...spread(50), item('y', { bright: 0.7 })]
    const { pool } = applyTraitBar(items, ['bright'], { bar: 0.6, minPool: 1 })
    expect(pool[0].id).toBe('x')
    expect(pool[pool.length - 1].id).toBe('y')
  })

  it('every requested trait must pass (AND)', () => {
    const items = [
      item('both', { bright: 0.9, rhythmic: 0.9 }),
      item('onlyBright', { bright: 0.9, rhythmic: 0.1 }),
      item('onlyRhythmic', { bright: 0.1, rhythmic: 0.9 })
    ]
    const { pool, barUsed } = applyTraitBar(items, ['bright', 'rhythmic'], { bar: 0.6, minPool: 1 })
    expect(pool.map((c) => c.id)).toEqual(['both'])
    expect(barUsed).toBe(0.6)
  })

  it('drops unanalysed candidates (missing or null percentile for any requested trait)', () => {
    const items = [
      ...spread(100),
      item('missing', {}),
      item('nullOne', { bright: null }),
      item('partial', { bright: 0.99 })
    ]
    const { pool } = applyTraitBar(items, ['bright'])
    expect(pool.find((c) => c.id === 'missing')).toBeUndefined()
    expect(pool.find((c) => c.id === 'nullOne')).toBeUndefined()
    expect(pool.find((c) => c.id === 'partial')).toBeDefined()

    const combo = applyTraitBar([...items], ['bright', 'rhythmic'])
    // nothing has rhythmic -> nothing analysed -> everything kept (relax)
    expect(combo.pool).toHaveLength(items.length)
  })

  it('relaxes the bar in 0.1 steps until minPool pass', () => {
    // 20 analysed, percentiles 0, 0.05, ... 0.95. >=0.6: 8; >=0.5: 10; >=0.4: 12.
    const items = spread(20)
    const { pool, barUsed } = applyTraitBar(items, ['bright'], { bar: 0.6 })
    expect(barUsed).toBeCloseTo(0.4)
    expect(pool).toHaveLength(12)
  })

  it('custom bar/minPool/step are honoured', () => {
    const items = spread(100)
    const { pool, barUsed } = applyTraitBar(items, ['bright'], {
      bar: 0.9,
      minPool: 25,
      step: 0.05
    })
    expect(barUsed).toBeCloseTo(0.75)
    expect(pool).toHaveLength(25)
  })

  it('bar reaches exactly 0 (no floating-point drift below it)', () => {
    const items = spread(5)
    const { pool, barUsed } = applyTraitBar(items, ['bright'])
    expect(barUsed).toBe(0)
    expect(pool).toHaveLength(5)
  })

  it('too few analysed even at bar 0 -> analysed first, then unanalysed appended', () => {
    const items = [item('u1', {}), ...spread(3), item('u2', { bright: null })]
    const { pool, barUsed } = applyTraitBar(items, ['bright'])
    expect(barUsed).toBe(0)
    expect(pool.map((c) => c.id)).toEqual(['s0', 's1', 's2', 'u1', 'u2'])
  })

  it('enough analysed at bar 0 -> unanalysed stay dropped', () => {
    const items = [item('u1', {}), ...spread(12)]
    const { pool, barUsed } = applyTraitBar(items, ['bright'])
    expect(barUsed).toBe(0)
    expect(pool).toHaveLength(12)
    expect(pool.find((c) => c.id === 'u1')).toBeUndefined()
  })

  it('empty input -> empty pool', () => {
    expect(applyTraitBar([], ['bright'])).toEqual({ pool: [], barUsed: 0 })
  })
})

describe('trait match setting helpers', () => {
  it('defaults to top 25% (0.75)', async () => {
    const { DEFAULT_TRAIT_BAR } = await import('./traitBar')
    expect(DEFAULT_TRAIT_BAR).toBe(0.75)
    const items = spread(100)
    expect(applyTraitBar(items, ['bright']).barUsed).toBe(0.75)
  })

  it('labels a bar as the share of the library it keeps', async () => {
    const { traitMatchBarLabel } = await import('./traitBar')
    expect(traitMatchBarLabel(0.75)).toBe('top 25%')
    expect(traitMatchBarLabel(0.9)).toBe('top 10%')
    expect(traitMatchBarLabel(0.5)).toBe('top 50%')
  })

  it('cycles loosest to strictest, then wraps; an unknown value starts at the default', async () => {
    const { nextTraitMatchBar, normalizeTraitMatchBar } = await import('./traitBar')
    expect(nextTraitMatchBar(0.5)).toBe(0.6)
    expect(nextTraitMatchBar(0.6)).toBe(0.75)
    expect(nextTraitMatchBar(0.75)).toBe(0.9)
    expect(nextTraitMatchBar(0.9)).toBe(0.5)
    expect(normalizeTraitMatchBar(0.33)).toBe(0.75)
    expect(normalizeTraitMatchBar(undefined)).toBe(0.75)
    expect(normalizeTraitMatchBar(0.9)).toBe(0.9)
  })
})
