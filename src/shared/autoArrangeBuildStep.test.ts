import { describe, expect, it } from 'vitest'
import {
  advanceToNextStep,
  applyCandidate,
  MAX_BUILD_STEPS,
  selectTopCandidates
} from './autoArrangeBuildStep'
import type { ArrangeBuildState, ArrangeCandidate, ArrangeStemInput } from './autoArrangeEngine'
import type { ArrangeMoveRecord } from './autoArrangeApply'

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

function buildState(overrides: Partial<ArrangeBuildState> = {}): ArrangeBuildState {
  return {
    activeStemKeys: [],
    phase: 'intro',
    stepsInPhase: 0,
    lastExitStep: {},
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

describe('applyCandidate', () => {
  it('appends a move record stamped with the given stepIndex', () => {
    const result = applyCandidate(
      [],
      buildState(),
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
    const result = applyCandidate(
      priorMoves,
      buildState({ phase: 'build', activeStemKeys: ['a'] }),
      [stemInput({ stemKey: 'a' }), stemInput({ stemKey: 'b' })],
      1,
      candidate({ stemKey: 'b', moveType: 'enter' })
    )
    expect(result.moves).toEqual<ArrangeMoveRecord[]>([
      { stepIndex: 0, stemKey: 'a', moveType: 'enter' },
      { stepIndex: 1, stemKey: 'b', moveType: 'enter' }
    ])
  })

  it('stamps a second move applied at the same stepIndex with that same stepIndex -- multi-move-per-step', () => {
    const result = applyCandidate(
      [{ stepIndex: 2, stemKey: 'a', moveType: 'enter' }],
      buildState({ phase: 'build', activeStemKeys: ['a'] }),
      [stemInput({ stemKey: 'a' }), stemInput({ stemKey: 'b' })],
      2,
      candidate({ stemKey: 'b', moveType: 'enter' })
    )
    expect(result.moves).toEqual<ArrangeMoveRecord[]>([
      { stepIndex: 2, stemKey: 'a', moveType: 'enter' },
      { stepIndex: 2, stemKey: 'b', moveType: 'enter' }
    ])
  })

  it('advances buildState using the real engine transition, without touching phase or stepsInPhase', () => {
    const stems = [stemInput({ stemKey: 'a' })]
    const result = applyCandidate(
      [],
      buildState({ phase: 'build', stepsInPhase: 1 }),
      stems,
      0,
      candidate({ stemKey: 'a', moveType: 'enter' })
    )
    expect(result.buildState).toEqual<ArrangeBuildState>({
      activeStemKeys: ['a'],
      phase: 'build',
      stepsInPhase: 1,
      lastExitStep: {}
    })
  })

  it('is not complete while stems remain active, even in outro', () => {
    const stems = [stemInput({ stemKey: 'a' }), stemInput({ stemKey: 'b' })]
    const result = applyCandidate(
      [],
      buildState({ phase: 'outro', activeStemKeys: ['b'] }),
      stems,
      3,
      candidate({ stemKey: 'a', moveType: 'exit', weight: 0.9 })
    )
    expect(result.complete).toBe(false)
  })

  it('is complete once the last active stem exits during outro', () => {
    const stems = [stemInput({ stemKey: 'a' })]
    const result = applyCandidate(
      [],
      buildState({ phase: 'outro', activeStemKeys: ['a'] }),
      stems,
      5,
      candidate({ stemKey: 'a', moveType: 'exit', weight: 0.9 })
    )
    expect(result.buildState.activeStemKeys).toEqual([])
    expect(result.buildState.lastExitStep.a).toBe(5)
    expect(result.complete).toBe(true)
  })

  it('a fill move does not change the active set and does not by itself complete the build', () => {
    const stems = [stemInput({ stemKey: 'a' }), stemInput({ stemKey: 'b' })]
    const result = applyCandidate(
      [],
      buildState({ phase: 'build', activeStemKeys: ['a'] }),
      stems,
      0,
      candidate({ stemKey: 'b', moveType: 'fill', weight: 0.3 })
    )
    expect(result.buildState.activeStemKeys).toEqual(['a'])
    expect(result.complete).toBe(false)
  })

  it('is a no-op when the identical stemKey+moveType is applied again at the same stepIndex', () => {
    // Guards against unbounded growth from a repeatedly-applied 'fill'
    // candidate: advanceBuildState leaves buildState unchanged for fill,
    // so computeCandidates would keep re-offering the exact same
    // candidate forever at a fixed stepIndex with nothing else to stop it.
    const stems = [stemInput({ stemKey: 'a' }), stemInput({ stemKey: 'b' })]
    const priorMoves: ArrangeMoveRecord[] = [{ stepIndex: 0, stemKey: 'b', moveType: 'fill' }]
    const priorState = buildState({ phase: 'build', activeStemKeys: ['a'] })
    const result = applyCandidate(
      priorMoves,
      priorState,
      stems,
      0,
      candidate({ stemKey: 'b', moveType: 'fill', weight: 0.3 })
    )
    expect(result.moves).toEqual(priorMoves)
    expect(result.moves).toBe(priorMoves)
    expect(result.buildState).toBe(priorState)
  })

  it('does not block a different moveType for the same stemKey at the same stepIndex', () => {
    const stems = [stemInput({ stemKey: 'a' }), stemInput({ stemKey: 'b' })]
    const priorMoves: ArrangeMoveRecord[] = [{ stepIndex: 0, stemKey: 'a', moveType: 'enter' }]
    const result = applyCandidate(
      priorMoves,
      buildState({ phase: 'outro', activeStemKeys: ['a'], stepsInPhase: 1 }),
      stems,
      0,
      candidate({ stemKey: 'a', moveType: 'exit', weight: 0.9 })
    )
    expect(result.moves).toEqual<ArrangeMoveRecord[]>([
      { stepIndex: 0, stemKey: 'a', moveType: 'enter' },
      { stepIndex: 0, stemKey: 'a', moveType: 'exit' }
    ])
  })

  it('does not block the same stemKey+moveType repeating at a different stepIndex', () => {
    // e.g. a stem exits, then re-enters later -- the dedup guard is scoped
    // to a single step, not global across the whole build.
    const stems = [stemInput({ stemKey: 'a' })]
    const priorMoves: ArrangeMoveRecord[] = [{ stepIndex: 0, stemKey: 'a', moveType: 'exit' }]
    const result = applyCandidate(
      priorMoves,
      buildState({ phase: 'build', activeStemKeys: [], lastExitStep: { a: 0 } }),
      stems,
      3,
      candidate({ stemKey: 'a', moveType: 'exit', weight: 0.5 })
    )
    expect(result.moves).toEqual<ArrangeMoveRecord[]>([
      { stepIndex: 0, stemKey: 'a', moveType: 'exit' },
      { stepIndex: 3, stemKey: 'a', moveType: 'exit' }
    ])
  })
})

describe('advanceToNextStep', () => {
  it('increments stepIndex by 1', () => {
    const result = advanceToNextStep(buildState(), 4)
    expect(result.stepIndex).toBe(5)
  })

  it('calls the engine advancePhase transition', () => {
    const result = advanceToNextStep(buildState({ phase: 'intro', stepsInPhase: 1 }), 0)
    expect(result.buildState.phase).toBe('build')
    expect(result.buildState.stepsInPhase).toBe(0)
  })

  it('is complete once advancing reaches outro with nothing active', () => {
    const result = advanceToNextStep(
      buildState({ phase: 'breakdown', stepsInPhase: 1, activeStemKeys: [] }),
      0
    )
    expect(result.buildState.phase).toBe('outro')
    expect(result.complete).toBe(true)
  })

  it('is not complete when reaching outro with stems still active', () => {
    const result = advanceToNextStep(
      buildState({ phase: 'breakdown', stepsInPhase: 1, activeStemKeys: ['a'] }),
      0
    )
    expect(result.buildState.phase).toBe('outro')
    expect(result.complete).toBe(false)
  })

  it('forces completion once stepIndex + 1 reaches MAX_BUILD_STEPS even if the arrangement never naturally completes', () => {
    // peak, one stem still active (so isArrangementComplete alone would be
    // false) -- only the step cap should force completion.
    const result = advanceToNextStep(
      buildState({ phase: 'peak', activeStemKeys: ['a'] }),
      MAX_BUILD_STEPS - 1
    )
    expect(result.complete).toBe(true)
  })

  it('does not force completion just below the step cap', () => {
    const result = advanceToNextStep(
      buildState({ phase: 'intro', activeStemKeys: ['a'] }),
      MAX_BUILD_STEPS - 2
    )
    expect(result.complete).toBe(false)
  })

  it('forwards a custom phaseStepTargets through to advancePhase', () => {
    const custom = { intro: 1, build: 1, peak: 1, breakdown: 1, outro: 1 }
    const result = advanceToNextStep(buildState({ phase: 'intro', stepsInPhase: 0 }), 0, custom)
    expect(result.buildState.phase).toBe('build')
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
