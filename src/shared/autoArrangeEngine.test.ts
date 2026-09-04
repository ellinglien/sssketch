import { describe, expect, it } from 'vitest'
import {
  advanceBuildState,
  computeCandidates,
  isArrangementComplete,
  FREQUENCY_WEIGHT_MULTIPLIER,
  REENTRY_COOLDOWN_STEPS,
  type ArrangeBuildState,
  type ArrangeStemInput
} from './autoArrangeEngine'

const emptyState: ArrangeBuildState = { activeStemKeys: [], peakReached: false, lastExitStep: {} }

function stemInput(overrides: Partial<ArrangeStemInput>): ArrangeStemInput {
  return {
    stemKey: 's1',
    role: 'drums',
    densityScore: 0.5,
    fillScore: 0.5,
    included: true,
    frequency: 'once',
    ...overrides
  }
}

describe('computeCandidates - building phase', () => {
  it('only proposes enter/fill candidates for inactive stems while peak is not reached', () => {
    const stems = [stemInput({ stemKey: 'a' }), stemInput({ stemKey: 'b' })]
    const candidates = computeCandidates(stems, emptyState, 0)
    expect(candidates.every((c) => c.moveType === 'enter' || c.moveType === 'fill')).toBe(true)
  })

  it('never proposes a candidate for an excluded stem', () => {
    const stems = [stemInput({ stemKey: 'a', included: false })]
    const candidates = computeCandidates(stems, emptyState, 0)
    expect(candidates.find((c) => c.stemKey === 'a')).toBeUndefined()
  })

  it('never proposes an enter candidate for an already-active stem', () => {
    const stems = [stemInput({ stemKey: 'a' })]
    const state: ArrangeBuildState = { activeStemKeys: ['a'], peakReached: false, lastExitStep: {} }
    const candidates = computeCandidates(stems, state, 0)
    expect(candidates.find((c) => c.stemKey === 'a' && c.moveType === 'enter')).toBeUndefined()
  })

  it('weights sparser stems higher than denser stems for entering', () => {
    const stems = [
      stemInput({ stemKey: 'sparse', densityScore: 0.1 }),
      stemInput({ stemKey: 'dense', densityScore: 0.9 })
    ]
    const candidates = computeCandidates(stems, emptyState, 0)
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
    const state: ArrangeBuildState = {
      activeStemKeys: ['active-drums'],
      peakReached: false,
      lastExitStep: {}
    }
    const candidates = computeCandidates(stems, state, 0)
    const newDrums = candidates.find((c) => c.stemKey === 'new-drums' && c.moveType === 'enter')!
    const newBass = candidates.find((c) => c.stemKey === 'new-bass' && c.moveType === 'enter')!
    expect(newBass.weight).toBeGreaterThan(newDrums.weight)
  })

  it('proposes at most one fill candidate, from the highest fillScore inactive stem', () => {
    const stems = [
      stemInput({ stemKey: 'bright', fillScore: 0.9 }),
      stemInput({ stemKey: 'dull', fillScore: 0.1 })
    ]
    const candidates = computeCandidates(stems, emptyState, 0)
    const fills = candidates.filter((c) => c.moveType === 'fill')
    expect(fills).toHaveLength(1)
    expect(fills[0].stemKey).toBe('bright')
  })

  it('weights a higher-frequency stem higher than an otherwise-identical lower-frequency stem', () => {
    const stems = [
      stemInput({ stemKey: 'once-stem', frequency: 'once' }),
      stemInput({ stemKey: 'very-frequent-stem', frequency: 'veryFrequent' })
    ]
    const candidates = computeCandidates(stems, emptyState, 0)
    const once = candidates.find((c) => c.stemKey === 'once-stem' && c.moveType === 'enter')!
    const veryFrequent = candidates.find(
      (c) => c.stemKey === 'very-frequent-stem' && c.moveType === 'enter'
    )!
    expect(veryFrequent.weight).toBeGreaterThan(once.weight)
    expect(veryFrequent.weight).toBeCloseTo(
      once.weight * (FREQUENCY_WEIGHT_MULTIPLIER.veryFrequent / FREQUENCY_WEIGHT_MULTIPLIER.once)
    )
  })
})

describe('computeCandidates - releasing phase', () => {
  it('only proposes exit/fill candidates once peak is reached, for stems with no prior exit', () => {
    const stems = [stemInput({ stemKey: 'a' }), stemInput({ stemKey: 'b' })]
    const state: ArrangeBuildState = {
      activeStemKeys: ['a', 'b'],
      peakReached: true,
      lastExitStep: {}
    }
    const candidates = computeCandidates(stems, state, 0)
    expect(candidates.every((c) => c.moveType === 'exit' || c.moveType === 'fill')).toBe(true)
  })

  it('weights denser active stems higher than sparser ones for exiting', () => {
    const stems = [
      stemInput({ stemKey: 'sparse', densityScore: 0.1 }),
      stemInput({ stemKey: 'dense', densityScore: 0.9 })
    ]
    const state: ArrangeBuildState = {
      activeStemKeys: ['sparse', 'dense'],
      peakReached: true,
      lastExitStep: {}
    }
    const candidates = computeCandidates(stems, state, 0)
    const sparse = candidates.find((c) => c.stemKey === 'sparse' && c.moveType === 'exit')!
    const dense = candidates.find((c) => c.stemKey === 'dense' && c.moveType === 'exit')!
    expect(dense.weight).toBeGreaterThan(sparse.weight)
  })

  it('never proposes an exit candidate for an already-inactive stem', () => {
    const stems = [stemInput({ stemKey: 'a' })]
    const state: ArrangeBuildState = { activeStemKeys: [], peakReached: true, lastExitStep: {} }
    const candidates = computeCandidates(stems, state, 0)
    expect(candidates.find((c) => c.stemKey === 'a' && c.moveType === 'exit')).toBeUndefined()
  })

  it('a "once" stem never appears as a re-entry candidate, even long after exiting', () => {
    const stems = [stemInput({ stemKey: 'a', frequency: 'once' })]
    const state: ArrangeBuildState = {
      activeStemKeys: [],
      peakReached: true,
      lastExitStep: { a: 0 }
    }
    const candidates = computeCandidates(stems, state, 1000)
    expect(candidates.find((c) => c.stemKey === 'a' && c.moveType === 'enter')).toBeUndefined()
  })

  it('an "occasional" stem does not re-enter before its cooldown has elapsed, but does once it has', () => {
    const stems = [stemInput({ stemKey: 'a', frequency: 'occasional' })]
    const cooldown = REENTRY_COOLDOWN_STEPS.occasional
    const stateJustExited: ArrangeBuildState = {
      activeStemKeys: [],
      peakReached: true,
      lastExitStep: { a: 5 }
    }
    const tooSoon = computeCandidates(stems, stateJustExited, 5 + cooldown - 1)
    expect(tooSoon.find((c) => c.stemKey === 'a' && c.moveType === 'enter')).toBeUndefined()

    const eligible = computeCandidates(stems, stateJustExited, 5 + cooldown)
    expect(eligible.find((c) => c.stemKey === 'a' && c.moveType === 'enter')).toBeDefined()
  })

  it('a "veryFrequent" stem becomes re-entry-eligible after just 1 step', () => {
    const stems = [stemInput({ stemKey: 'a', frequency: 'veryFrequent' })]
    expect(REENTRY_COOLDOWN_STEPS.veryFrequent).toBe(1)
    const state: ArrangeBuildState = {
      activeStemKeys: [],
      peakReached: true,
      lastExitStep: { a: 10 }
    }
    const candidates = computeCandidates(stems, state, 11)
    expect(candidates.find((c) => c.stemKey === 'a' && c.moveType === 'enter')).toBeDefined()
  })

  it('a stem that has never exited never appears as a re-entry candidate, regardless of frequency', () => {
    const stems = [stemInput({ stemKey: 'a', frequency: 'veryFrequent' })]
    const state: ArrangeBuildState = { activeStemKeys: [], peakReached: true, lastExitStep: {} }
    const candidates = computeCandidates(stems, state, 100)
    expect(candidates.find((c) => c.stemKey === 'a' && c.moveType === 'enter')).toBeUndefined()
  })

  it('a re-entry candidate is weighted using enterWeight scaled by the frequency multiplier', () => {
    const stems = [
      stemInput({ stemKey: 'a', frequency: 'frequent', densityScore: 0.3 }),
      stemInput({ stemKey: 'b', densityScore: 0.9 }) // still-active exit candidate for contrast
    ]
    const state: ArrangeBuildState = {
      activeStemKeys: ['b'],
      peakReached: true,
      lastExitStep: { a: 0 }
    }
    const candidates = computeCandidates(stems, state, REENTRY_COOLDOWN_STEPS.frequent)
    const reentry = candidates.find((c) => c.stemKey === 'a' && c.moveType === 'enter')!
    expect(reentry).toBeDefined()
    expect(reentry.reason.toLowerCase()).toContain('re-entering')
  })
})

describe('advanceBuildState', () => {
  it('adds the stem to activeStemKeys on an enter move', () => {
    const next = advanceBuildState(
      emptyState,
      [stemInput({ stemKey: 'a' })],
      { stemKey: 'a', moveType: 'enter', weight: 1, reason: 'test' },
      0
    )
    expect(next.activeStemKeys).toContain('a')
  })

  it('removes the stem from activeStemKeys on an exit move', () => {
    const state: ArrangeBuildState = { activeStemKeys: ['a'], peakReached: true, lastExitStep: {} }
    const next = advanceBuildState(
      state,
      [stemInput({ stemKey: 'a' })],
      { stemKey: 'a', moveType: 'exit', weight: 1, reason: 'test' },
      3
    )
    expect(next.activeStemKeys).not.toContain('a')
  })

  it('does not change activeStemKeys on a fill move', () => {
    const next = advanceBuildState(
      emptyState,
      [stemInput({ stemKey: 'a' })],
      { stemKey: 'a', moveType: 'fill', weight: 1, reason: 'test' },
      0
    )
    expect(next.activeStemKeys).toEqual(emptyState.activeStemKeys)
  })

  it('sets peakReached once active count reaches 75% of included stems', () => {
    const stems = [
      stemInput({ stemKey: 'a' }),
      stemInput({ stemKey: 'b' }),
      stemInput({ stemKey: 'c' }),
      stemInput({ stemKey: 'd' })
    ]
    const state: ArrangeBuildState = {
      activeStemKeys: ['a', 'b'],
      peakReached: false,
      lastExitStep: {}
    }
    const next = advanceBuildState(
      state,
      stems,
      { stemKey: 'c', moveType: 'enter', weight: 1, reason: 'test' },
      2
    )
    expect(next.peakReached).toBe(true)
  })

  it('never un-sets peakReached once true', () => {
    const state: ArrangeBuildState = {
      activeStemKeys: ['a', 'b', 'c'],
      peakReached: true,
      lastExitStep: {}
    }
    const next = advanceBuildState(
      state,
      [stemInput({ stemKey: 'a' })],
      { stemKey: 'a', moveType: 'exit', weight: 1, reason: 'test' },
      5
    )
    expect(next.peakReached).toBe(true)
  })

  it('records lastExitStep[stemKey] = stepIndex when an exit move is chosen', () => {
    const state: ArrangeBuildState = { activeStemKeys: ['a'], peakReached: true, lastExitStep: {} }
    const next = advanceBuildState(
      state,
      [stemInput({ stemKey: 'a' })],
      { stemKey: 'a', moveType: 'exit', weight: 1, reason: 'test' },
      7
    )
    expect(next.lastExitStep.a).toBe(7)
  })

  it('does not touch lastExitStep on an enter move', () => {
    const state: ArrangeBuildState = {
      activeStemKeys: [],
      peakReached: false,
      lastExitStep: { b: 2 }
    }
    const next = advanceBuildState(
      state,
      [stemInput({ stemKey: 'a' })],
      { stemKey: 'a', moveType: 'enter', weight: 1, reason: 'test' },
      9
    )
    expect(next.lastExitStep).toEqual({ b: 2 })
  })

  it('does not touch lastExitStep on a fill move', () => {
    const state: ArrangeBuildState = {
      activeStemKeys: [],
      peakReached: false,
      lastExitStep: { b: 2 }
    }
    const next = advanceBuildState(
      state,
      [stemInput({ stemKey: 'a' })],
      { stemKey: 'a', moveType: 'fill', weight: 1, reason: 'test' },
      9
    )
    expect(next.lastExitStep).toEqual({ b: 2 })
  })
})

describe('isArrangementComplete', () => {
  it('is false while any stem is active', () => {
    expect(
      isArrangementComplete({ activeStemKeys: ['a'], peakReached: true, lastExitStep: {} })
    ).toBe(false)
  })

  it('is true once no stems remain active', () => {
    expect(isArrangementComplete({ activeStemKeys: [], peakReached: true, lastExitStep: {} })).toBe(
      true
    )
  })

  it('is false at the very start, before peak is reached, even with zero active stems', () => {
    expect(
      isArrangementComplete({ activeStemKeys: [], peakReached: false, lastExitStep: {} })
    ).toBe(false)
  })
})
