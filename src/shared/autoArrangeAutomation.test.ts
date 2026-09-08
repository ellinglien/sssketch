import { describe, expect, it } from 'vitest'
import {
  minSectionsForShape,
  phaseStepTargetsForShape,
  initialBuildStateForShape,
  pickWeightedRandomCandidate,
  runAutoArrangeBuild,
  MAX_AUTO_MOVES_PER_SECTION
} from './autoArrangeAutomation'
import {
  PHASE_STEP_TARGETS,
  type ArrangeStemInput,
  type ArrangeCandidate
} from './autoArrangeEngine'

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

describe('minSectionsForShape', () => {
  it('is 5 for buildUp and stayBusy -- one section per phase they both use', () => {
    expect(minSectionsForShape('buildUp')).toBe(5)
    expect(minSectionsForShape('stayBusy')).toBe(5)
  })

  it('is 2 for startFull -- it only uses breakdown and outro', () => {
    expect(minSectionsForShape('startFull')).toBe(2)
  })
})

describe('phaseStepTargetsForShape', () => {
  it("buildUp at target 10 reproduces today's exact fixed PHASE_STEP_TARGETS", () => {
    expect(phaseStepTargetsForShape('buildUp', 10)).toEqual(PHASE_STEP_TARGETS)
  })

  it('buildUp scales down to a shorter target, every phase still >= 1, summing to the target exactly', () => {
    const targets = phaseStepTargetsForShape('buildUp', 5)
    expect(targets.intro).toBeGreaterThanOrEqual(1)
    expect(targets.build).toBeGreaterThanOrEqual(1)
    expect(targets.peak).toBeGreaterThanOrEqual(1)
    expect(targets.breakdown).toBeGreaterThanOrEqual(1)
    expect(targets.outro).toBeGreaterThanOrEqual(1)
    expect(targets.intro + targets.build + targets.peak + targets.breakdown + targets.outro).toBe(5)
  })

  it('buildUp scales up to a longer target, still summing exactly', () => {
    const targets = phaseStepTargetsForShape('buildUp', 16)
    expect(targets.intro + targets.build + targets.peak + targets.breakdown + targets.outro).toBe(
      16
    )
  })

  it('startFull only ever assigns breakdown/outro -- intro/build/peak are always 0', () => {
    const targets = phaseStepTargetsForShape('startFull', 8)
    expect(targets.intro).toBe(0)
    expect(targets.build).toBe(0)
    expect(targets.peak).toBe(0)
    expect(targets.breakdown).toBeGreaterThanOrEqual(1)
    expect(targets.outro).toBeGreaterThanOrEqual(1)
    expect(targets.breakdown + targets.outro).toBe(8)
  })

  it('startFull at its own minimum (2) gives exactly one section to each of breakdown/outro', () => {
    const targets = phaseStepTargetsForShape('startFull', 2)
    expect(targets.breakdown).toBe(1)
    expect(targets.outro).toBe(1)
  })

  it('stayBusy sums exactly to the target too, at a value other than its own base-weight total', () => {
    const targets = phaseStepTargetsForShape('stayBusy', 7)
    expect(targets.intro + targets.build + targets.peak + targets.breakdown + targets.outro).toBe(7)
  })

  it('stayBusy at its own minimum (5) gives every phase exactly 1 -- exercises the negative-remainder clawback branch', () => {
    // stayBusy's weights [1,4,3,1,1] (sum 10) at target 5: raw shares are
    // [0.5, 2, 1.5, 0.5, 0.5]; floored-with-min-1 is [1,2,1,1,1] (sum 6),
    // one MORE than the target -- scaleToTarget's negative-remainder branch
    // has to claw one back from build (its own largest floor) to land on
    // [1,1,1,1,1]. Every other existing test in this describe block only
    // ever needs the POSITIVE-remainder (hand out extra) branch or exactly
    // zero adjustment, so without this test a broken clawback branch could
    // regress silently.
    expect(phaseStepTargetsForShape('stayBusy', 5)).toEqual({
      intro: 1,
      build: 1,
      peak: 1,
      breakdown: 1,
      outro: 1
    })
  })
})

describe('initialBuildStateForShape', () => {
  const stems: ArrangeStemInput[] = [
    stemInput({ stemKey: 'a', included: true }),
    stemInput({ stemKey: 'b', included: true }),
    stemInput({ stemKey: 'c', included: false })
  ]

  it('buildUp starts empty, at intro', () => {
    const state = initialBuildStateForShape('buildUp', stems)
    expect(state.activeStemKeys).toEqual([])
    expect(state.phase).toBe('intro')
    expect(state.stepsInPhase).toBe(0)
    expect(state.lastExitStep).toEqual({})
  })

  it('stayBusy also starts empty, at intro -- same starting state as buildUp, only the proportions differ', () => {
    const state = initialBuildStateForShape('stayBusy', stems)
    expect(state.activeStemKeys).toEqual([])
    expect(state.phase).toBe('intro')
  })

  it('startFull seeds every INCLUDED stem active, and starts at breakdown', () => {
    const state = initialBuildStateForShape('startFull', stems)
    expect(state.activeStemKeys.sort()).toEqual(['a', 'b'])
    expect(state.phase).toBe('breakdown')
    expect(state.stepsInPhase).toBe(0)
  })

  it('startFull with zero included stems seeds an empty active set, still at breakdown', () => {
    const state = initialBuildStateForShape('startFull', [stemInput({ included: false })])
    expect(state.activeStemKeys).toEqual([])
    expect(state.phase).toBe('breakdown')
  })
})

function candidate(overrides: Partial<ArrangeCandidate>): ArrangeCandidate {
  return {
    stemKey: 's1',
    moveType: 'enter',
    weight: 0.5,
    reason: 'sparse -- good early/building material',
    ...overrides
  }
}

describe('pickWeightedRandomCandidate', () => {
  it('returns undefined for an empty candidate list', () => {
    expect(pickWeightedRandomCandidate([], () => 0)).toBeUndefined()
  })

  it('with random() returning 0, always picks the single highest-weighted candidate', () => {
    const candidates = [
      candidate({ stemKey: 'low', weight: 0.1 }),
      candidate({ stemKey: 'high', weight: 0.9 }),
      candidate({ stemKey: 'mid', weight: 0.5 })
    ]
    expect(pickWeightedRandomCandidate(candidates, () => 0)!.stemKey).toBe('high')
  })

  it('with random() returning just under 1, picks the lowest-weighted candidate in the top pool', () => {
    const candidates = [
      candidate({ stemKey: 'low', weight: 0.1 }),
      candidate({ stemKey: 'high', weight: 0.9 }),
      candidate({ stemKey: 'mid', weight: 0.5 })
    ]
    expect(pickWeightedRandomCandidate(candidates, () => 0.9999)!.stemKey).toBe('low')
  })

  it('only considers the current top TOP_CANDIDATE_POOL_SIZE candidates, never one ranked below it', () => {
    const candidates = Array.from({ length: 6 }, (_, i) =>
      candidate({ stemKey: `s${i}`, weight: i })
    ) // s0..s5, weight == index -- s0/s1/s2 are the bottom three, never in the top-3 pool
    for (const r of [0, 0.3, 0.6, 0.9999]) {
      const picked = pickWeightedRandomCandidate(candidates, () => r)!.stemKey
      expect(['s3', 's4', 's5']).toContain(picked)
    }
  })

  it('falls back to a uniform pick when every candidate in the pool has zero weight', () => {
    const candidates = [
      candidate({ stemKey: 'a', weight: 0 }),
      candidate({ stemKey: 'b', weight: 0 })
    ]
    expect(pickWeightedRandomCandidate(candidates, () => 0)!.stemKey).toBe('a')
    expect(pickWeightedRandomCandidate(candidates, () => 0.9999)!.stemKey).toBe('b')
  })
})

describe('runAutoArrangeBuild', () => {
  it('terminates for buildUp with a small stem set, without hitting MAX_BUILD_STEPS', () => {
    const stems = [
      stemInput({ stemKey: 'a', densityScore: 0.2, role: 'drums' }),
      stemInput({ stemKey: 'b', densityScore: 0.8, role: 'bass' })
    ]
    const result = runAutoArrangeBuild(stems, 'buildUp', 5, () => 0)
    expect(result.moves.length).toBeGreaterThan(0)
    expect(result.totalSteps).toBeLessThan(64) // MAX_BUILD_STEPS
  })

  it('totalSteps is exactly one past the highest stepIndex any move actually touched -- not inflated by a phase-transition completion', () => {
    // Both stems enter at step 0, both exit at step 3 (breakdown's own
    // single step target at this scaled-down length) -- completion is then
    // discovered on the FOLLOWING advanceToNextStep call, at the
    // breakdown -> outro transition, not mid-section. Real bug this
    // regression-tests: totalSteps used to double-count that transition,
    // returning 5 instead of the correct 4 (moves only ever touch steps
    // 0..3 -- four real sections, not five).
    const stems = [
      stemInput({ stemKey: 'a', densityScore: 0.2, role: 'drums' }),
      stemInput({ stemKey: 'b', densityScore: 0.8, role: 'bass' })
    ]
    const result = runAutoArrangeBuild(stems, 'buildUp', 5, () => 0)
    const highestStepTouched = Math.max(...result.moves.map((m) => m.stepIndex))
    expect(result.totalSteps).toBe(highestStepTouched + 1)
    expect(result.totalSteps).toBe(4)
  })

  it('terminates for startFull too, without hitting MAX_BUILD_STEPS, for a small stem set', () => {
    const stems = [
      stemInput({ stemKey: 'a', densityScore: 0.2 }),
      stemInput({ stemKey: 'b', densityScore: 0.8 })
    ]
    const result = runAutoArrangeBuild(stems, 'startFull', 2, () => 0)
    expect(result.totalSteps).toBeLessThan(64)
  })

  it("startFull's every included stem has 'exit' as its EARLIEST move, never 'enter' -- confirms it truly starts active, not entering", () => {
    const stems = [
      stemInput({ stemKey: 'a', densityScore: 0.3 }),
      stemInput({ stemKey: 'b', densityScore: 0.7 })
    ]
    const result = runAutoArrangeBuild(stems, 'startFull', 4, () => 0)
    const earliestByStem = new Map<string, (typeof result.moves)[number]>()
    for (const move of result.moves) {
      const existing = earliestByStem.get(move.stemKey)
      if (!existing || move.stepIndex < existing.stepIndex) earliestByStem.set(move.stemKey, move)
    }
    for (const move of earliestByStem.values()) {
      expect(move.moveType).toBe('exit')
    }
  })

  it('a fake random sequence produces a genuinely different result than a different fake sequence, for the same input', () => {
    const stems = [
      stemInput({ stemKey: 'sparse', densityScore: 0.1, role: 'drums' }),
      stemInput({ stemKey: 'dense', densityScore: 0.9, role: 'bass' })
    ]
    const alwaysTop = runAutoArrangeBuild(stems, 'buildUp', 5, () => 0)
    const alwaysBottomOfPool = runAutoArrangeBuild(stems, 'buildUp', 5, () => 0.9999)
    // The very first move applied should differ: alwaysTop picks the
    // highest-weighted (sparsest) stem first every time; alwaysBottomOfPool
    // -- with only 2 stems, both always in the top-2 pool -- picks
    // whichever ranks LOWEST of the (at most 2) available each time,
    // meaning it picks the OTHER one first instead.
    expect(alwaysTop.moves[0].stemKey).not.toBe(alwaysBottomOfPool.moves[0].stemKey)
  })

  it('zero included stems produces zero moves and terminates quickly', () => {
    const result = runAutoArrangeBuild([stemInput({ included: false })], 'buildUp', 10, () => 0)
    expect(result.moves).toEqual([])
    expect(result.totalSteps).toBeLessThan(64)
  })

  it('fewer than MIN_STEMS_FOR_FULL_ARC stems still runs and terminates -- the "too few stems" warning is advisory only, not enforced here', () => {
    const result = runAutoArrangeBuild([stemInput({ stemKey: 'only-one' })], 'buildUp', 5, () => 0)
    expect(result.totalSteps).toBeLessThan(64)
  })

  it('defaults random to Math.random when omitted -- does not throw, produces a plausible result', () => {
    const stems = [stemInput({ stemKey: 'a' }), stemInput({ stemKey: 'b' })]
    const result = runAutoArrangeBuild(stems, 'buildUp', 5)
    expect(result.totalSteps).toBeGreaterThan(0)
    expect(result.totalSteps).toBeLessThan(64)
  })

  it('applies at most MAX_AUTO_MOVES_PER_SECTION moves within a single section before advancing', () => {
    const stems = Array.from({ length: 5 }, (_, i) =>
      stemInput({ stemKey: `s${i}`, densityScore: i / 10, role: `role${i}` })
    )
    const result = runAutoArrangeBuild(stems, 'buildUp', 10, () => 0)
    const movesInFirstSection = result.moves.filter((m) => m.stepIndex === 0)
    expect(movesInFirstSection.length).toBeLessThanOrEqual(MAX_AUTO_MOVES_PER_SECTION)
  })
})
