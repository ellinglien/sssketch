import { describe, expect, it } from 'vitest'
import {
  minSectionsForShape,
  phaseStepTargetsForShape,
  initialBuildStateForShape
} from './autoArrangeAutomation'
import { PHASE_STEP_TARGETS, type ArrangeStemInput } from './autoArrangeEngine'

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
