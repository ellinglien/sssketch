import { describe, expect, it } from 'vitest'
import { applyBuildStep, MAX_BUILD_STEPS, selectTopCandidates } from './autoArrangeBuildStep'
import type { ArrangeBuildState, ArrangeCandidate, ArrangeStemInput } from './autoArrangeEngine'
import type { ArrangeMoveRecord } from './autoArrangeApply'

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

function candidate(overrides: Partial<ArrangeCandidate>): ArrangeCandidate {
  return {
    stemKey: 's1',
    moveType: 'enter',
    weight: 0.5,
    reason: 'sparse -- good early/building material',
    ...overrides
  }
}

describe('applyBuildStep', () => {
  it('appends a move record stamped with the given stepIndex', () => {
    const result = applyBuildStep(
      [],
      { activeStemKeys: [], peakReached: false },
      [stemInput({ stemKey: 'a' })],
      0,
      candidate({ stemKey: 'a', moveType: 'enter' })
    )
    expect(result.moves).toEqual<ArrangeMoveRecord[]>([
      { stepIndex: 0, stemKey: 'a', moveType: 'enter' }
    ])
  })

  it('preserves earlier moves rather than replacing them', () => {
    const priorMoves: ArrangeMoveRecord[] = [{ stepIndex: 0, stemKey: 'a', moveType: 'enter' }]
    const result = applyBuildStep(
      priorMoves,
      { activeStemKeys: ['a'], peakReached: false },
      [stemInput({ stemKey: 'a' }), stemInput({ stemKey: 'b' })],
      1,
      candidate({ stemKey: 'b', moveType: 'enter' })
    )
    expect(result.moves).toEqual<ArrangeMoveRecord[]>([
      { stepIndex: 0, stemKey: 'a', moveType: 'enter' },
      { stepIndex: 1, stemKey: 'b', moveType: 'enter' }
    ])
  })

  it('advances buildState using the real engine transition (peak reached at the enter that crosses 75% active)', () => {
    const stems = [stemInput({ stemKey: 'a' })]
    const result = applyBuildStep(
      [],
      { activeStemKeys: [], peakReached: false },
      stems,
      0,
      candidate({ stemKey: 'a', moveType: 'enter' })
    )
    expect(result.buildState).toEqual<ArrangeBuildState>({
      activeStemKeys: ['a'],
      peakReached: true
    })
  })

  it('is not complete while stems remain active even after peak is reached', () => {
    const stems = [stemInput({ stemKey: 'a' }), stemInput({ stemKey: 'b' })]
    const result = applyBuildStep(
      [],
      { activeStemKeys: ['b'], peakReached: true },
      stems,
      3,
      candidate({ stemKey: 'a', moveType: 'enter' })
    )
    expect(result.complete).toBe(false)
  })

  it('is complete once the last active stem exits after peak was reached', () => {
    const stems = [stemInput({ stemKey: 'a' })]
    const result = applyBuildStep(
      [],
      { activeStemKeys: ['a'], peakReached: true },
      stems,
      5,
      candidate({ stemKey: 'a', moveType: 'exit', weight: 0.9 })
    )
    expect(result.buildState).toEqual<ArrangeBuildState>({ activeStemKeys: [], peakReached: true })
    expect(result.complete).toBe(true)
  })

  it('a fill move does not change the active set and does not by itself complete the build', () => {
    const stems = [stemInput({ stemKey: 'a' }), stemInput({ stemKey: 'b' })]
    const result = applyBuildStep(
      [],
      { activeStemKeys: ['a'], peakReached: false },
      stems,
      0,
      candidate({ stemKey: 'b', moveType: 'fill', weight: 0.3 })
    )
    expect(result.buildState.activeStemKeys).toEqual(['a'])
    expect(result.complete).toBe(false)
  })

  it('forces completion once stepIndex + 1 reaches MAX_BUILD_STEPS even if the arrangement never naturally completes', () => {
    const stems = [stemInput({ stemKey: 'a' })]
    // peak already reached, one stem still active (so isArrangementComplete
    // alone would be false) -- only the step cap should force completion.
    const result = applyBuildStep(
      [],
      { activeStemKeys: ['a'], peakReached: true },
      stems,
      MAX_BUILD_STEPS - 1,
      candidate({ stemKey: 'a', moveType: 'enter', weight: 0.1 })
    )
    expect(result.complete).toBe(true)
  })

  it('does not force completion just below the step cap', () => {
    const stems = [stemInput({ stemKey: 'a' }), stemInput({ stemKey: 'b' })]
    const result = applyBuildStep(
      [],
      { activeStemKeys: ['a'], peakReached: false },
      stems,
      MAX_BUILD_STEPS - 2,
      candidate({ stemKey: 'b', moveType: 'enter', weight: 0.1 })
    )
    expect(result.complete).toBe(false)
  })
})

describe('selectTopCandidates', () => {
  it('returns candidates sorted by descending weight', () => {
    const candidates = [
      candidate({ stemKey: 'low', weight: 0.1 }),
      candidate({ stemKey: 'high', weight: 0.9 }),
      candidate({ stemKey: 'mid', weight: 0.5 })
    ]
    expect(selectTopCandidates(candidates).map((c) => c.stemKey)).toEqual(['high', 'mid', 'low'])
  })

  it('caps the result at the given max, defaulting to 3', () => {
    const candidates = Array.from({ length: 6 }, (_, i) =>
      candidate({ stemKey: `s${i}`, weight: i })
    )
    expect(selectTopCandidates(candidates)).toHaveLength(3)
    expect(selectTopCandidates(candidates, 2)).toHaveLength(2)
  })

  it('does not mutate the input array', () => {
    const candidates = [
      candidate({ stemKey: 'a', weight: 0.1 }),
      candidate({ stemKey: 'b', weight: 0.9 })
    ]
    const original = [...candidates]
    selectTopCandidates(candidates)
    expect(candidates).toEqual(original)
  })

  it('returns an empty array for an empty input', () => {
    expect(selectTopCandidates([])).toEqual([])
  })
})
