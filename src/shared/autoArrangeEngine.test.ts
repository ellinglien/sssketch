import { describe, expect, it } from 'vitest'
import {
  advanceBuildState,
  computeCandidates,
  isArrangementComplete,
  type ArrangeBuildState,
  type ArrangeStemInput
} from './autoArrangeEngine'

const emptyState: ArrangeBuildState = { activeStemKeys: [], peakReached: false }

function stemInput(overrides: Partial<ArrangeStemInput>): ArrangeStemInput {
  return {
    stemKey: 's1',
    role: 'drums',
    densityScore: 0.5,
    fillScore: 0.5,
    included: true,
    ...overrides
  }
}

describe('computeCandidates - building phase', () => {
  it('only proposes enter/fill candidates for inactive stems while peak is not reached', () => {
    const stems = [stemInput({ stemKey: 'a' }), stemInput({ stemKey: 'b' })]
    const candidates = computeCandidates(stems, emptyState)
    expect(candidates.every((c) => c.moveType === 'enter' || c.moveType === 'fill')).toBe(true)
  })

  it('never proposes a candidate for an excluded stem', () => {
    const stems = [stemInput({ stemKey: 'a', included: false })]
    const candidates = computeCandidates(stems, emptyState)
    expect(candidates.find((c) => c.stemKey === 'a')).toBeUndefined()
  })

  it('never proposes an enter candidate for an already-active stem', () => {
    const stems = [stemInput({ stemKey: 'a' })]
    const state: ArrangeBuildState = { activeStemKeys: ['a'], peakReached: false }
    const candidates = computeCandidates(stems, state)
    expect(candidates.find((c) => c.stemKey === 'a' && c.moveType === 'enter')).toBeUndefined()
  })

  it('weights sparser stems higher than denser stems for entering', () => {
    const stems = [
      stemInput({ stemKey: 'sparse', densityScore: 0.1 }),
      stemInput({ stemKey: 'dense', densityScore: 0.9 })
    ]
    const candidates = computeCandidates(stems, emptyState)
    const sparse = candidates.find((c) => c.stemKey === 'sparse' && c.moveType === 'enter')!
    const dense = candidates.find((c) => c.stemKey === 'dense' && c.moveType === 'enter')!
    expect(sparse.weight).toBeGreaterThan(dense.weight)
  })

  it('boosts a role not yet represented among active stems over one that already is', () => {
    const stems = [
      stemInput({ stemKey: 'active-drums', role: 'drums' }),
      stemInput({ stemKey: 'new-drums', role: 'drums', densityScore: 0.5 }),
      stemInput({ stemKey: 'new-bass', role: 'bass', densityScore: 0.5 })
    ]
    const state: ArrangeBuildState = { activeStemKeys: ['active-drums'], peakReached: false }
    const candidates = computeCandidates(stems, state)
    const newDrums = candidates.find((c) => c.stemKey === 'new-drums' && c.moveType === 'enter')!
    const newBass = candidates.find((c) => c.stemKey === 'new-bass' && c.moveType === 'enter')!
    expect(newBass.weight).toBeGreaterThan(newDrums.weight)
  })

  it('proposes at most one fill candidate, from the highest fillScore inactive stem', () => {
    const stems = [
      stemInput({ stemKey: 'bright', fillScore: 0.9 }),
      stemInput({ stemKey: 'dull', fillScore: 0.1 })
    ]
    const candidates = computeCandidates(stems, emptyState)
    const fills = candidates.filter((c) => c.moveType === 'fill')
    expect(fills).toHaveLength(1)
    expect(fills[0].stemKey).toBe('bright')
  })
})

describe('computeCandidates - releasing phase', () => {
  it('only proposes exit/fill candidates once peak is reached', () => {
    const stems = [stemInput({ stemKey: 'a' }), stemInput({ stemKey: 'b' })]
    const state: ArrangeBuildState = { activeStemKeys: ['a', 'b'], peakReached: true }
    const candidates = computeCandidates(stems, state)
    expect(candidates.every((c) => c.moveType === 'exit' || c.moveType === 'fill')).toBe(true)
  })

  it('weights denser active stems higher than sparser ones for exiting', () => {
    const stems = [
      stemInput({ stemKey: 'sparse', densityScore: 0.1 }),
      stemInput({ stemKey: 'dense', densityScore: 0.9 })
    ]
    const state: ArrangeBuildState = { activeStemKeys: ['sparse', 'dense'], peakReached: true }
    const candidates = computeCandidates(stems, state)
    const sparse = candidates.find((c) => c.stemKey === 'sparse' && c.moveType === 'exit')!
    const dense = candidates.find((c) => c.stemKey === 'dense' && c.moveType === 'exit')!
    expect(dense.weight).toBeGreaterThan(sparse.weight)
  })

  it('never proposes an exit candidate for an already-inactive stem', () => {
    const stems = [stemInput({ stemKey: 'a' })]
    const state: ArrangeBuildState = { activeStemKeys: [], peakReached: true }
    const candidates = computeCandidates(stems, state)
    expect(candidates.find((c) => c.stemKey === 'a' && c.moveType === 'exit')).toBeUndefined()
  })
})

describe('advanceBuildState', () => {
  it('adds the stem to activeStemKeys on an enter move', () => {
    const next = advanceBuildState(emptyState, [stemInput({ stemKey: 'a' })], {
      stemKey: 'a',
      moveType: 'enter',
      weight: 1,
      reason: 'test'
    })
    expect(next.activeStemKeys).toContain('a')
  })

  it('removes the stem from activeStemKeys on an exit move', () => {
    const state: ArrangeBuildState = { activeStemKeys: ['a'], peakReached: true }
    const next = advanceBuildState(state, [stemInput({ stemKey: 'a' })], {
      stemKey: 'a',
      moveType: 'exit',
      weight: 1,
      reason: 'test'
    })
    expect(next.activeStemKeys).not.toContain('a')
  })

  it('does not change activeStemKeys on a fill move', () => {
    const next = advanceBuildState(emptyState, [stemInput({ stemKey: 'a' })], {
      stemKey: 'a',
      moveType: 'fill',
      weight: 1,
      reason: 'test'
    })
    expect(next.activeStemKeys).toEqual(emptyState.activeStemKeys)
  })

  it('sets peakReached once active count reaches 75% of included stems', () => {
    const stems = [
      stemInput({ stemKey: 'a' }),
      stemInput({ stemKey: 'b' }),
      stemInput({ stemKey: 'c' }),
      stemInput({ stemKey: 'd' })
    ]
    const state: ArrangeBuildState = { activeStemKeys: ['a', 'b'], peakReached: false }
    const next = advanceBuildState(state, stems, {
      stemKey: 'c',
      moveType: 'enter',
      weight: 1,
      reason: 'test'
    })
    expect(next.peakReached).toBe(true)
  })

  it('never un-sets peakReached once true', () => {
    const state: ArrangeBuildState = { activeStemKeys: ['a', 'b', 'c'], peakReached: true }
    const next = advanceBuildState(state, [stemInput({ stemKey: 'a' })], {
      stemKey: 'a',
      moveType: 'exit',
      weight: 1,
      reason: 'test'
    })
    expect(next.peakReached).toBe(true)
  })
})

describe('isArrangementComplete', () => {
  it('is false while any stem is active', () => {
    expect(isArrangementComplete({ activeStemKeys: ['a'], peakReached: true })).toBe(false)
  })

  it('is true once no stems remain active', () => {
    expect(isArrangementComplete({ activeStemKeys: [], peakReached: true })).toBe(true)
  })

  it('is false at the very start, before peak is reached, even with zero active stems', () => {
    expect(isArrangementComplete({ activeStemKeys: [], peakReached: false })).toBe(false)
  })
})
