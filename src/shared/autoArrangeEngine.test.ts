import { describe, expect, it } from 'vitest'
import {
  advanceBuildState,
  advancePhase,
  computeCandidates,
  isArrangementComplete,
  retreatPhase,
  FREQUENCY_WEIGHT_MULTIPLIER,
  PHASE_ORDER,
  PHASE_STEP_TARGETS,
  REENTRY_COOLDOWN_STEPS,
  type ArrangeBuildState,
  type ArrangePhase,
  type ArrangeStemInput
} from './autoArrangeEngine'

function buildState(overrides: Partial<ArrangeBuildState> = {}): ArrangeBuildState {
  return {
    activeStemKeys: [],
    phase: 'intro',
    stepsInPhase: 0,
    lastExitStep: {},
    ...overrides
  }
}

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

describe('computeCandidates - phase gating', () => {
  it('intro only proposes enter candidates', () => {
    const stems = [stemInput({ stemKey: 'a' }), stemInput({ stemKey: 'b' })]
    const candidates = computeCandidates(stems, buildState({ phase: 'intro' }), 0)
    expect(candidates.every((c) => c.moveType === 'enter')).toBe(true)
    expect(candidates.length).toBeGreaterThan(0)
  })

  it('build proposes enter and fill candidates, never exit', () => {
    const stems = [stemInput({ stemKey: 'a' }), stemInput({ stemKey: 'b' })]
    const candidates = computeCandidates(
      stems,
      buildState({ phase: 'build', activeStemKeys: ['a'] }),
      0
    )
    expect(candidates.every((c) => c.moveType === 'enter' || c.moveType === 'fill')).toBe(true)
  })

  it('peak proposes only fill candidates, never enter or exit', () => {
    const stems = [stemInput({ stemKey: 'a' }), stemInput({ stemKey: 'b' })]
    const candidates = computeCandidates(
      stems,
      buildState({ phase: 'peak', activeStemKeys: ['a'] }),
      0
    )
    expect(candidates.every((c) => c.moveType === 'fill')).toBe(true)
  })

  it('breakdown proposes only exit candidates for active stems', () => {
    const stems = [stemInput({ stemKey: 'a' }), stemInput({ stemKey: 'b' })]
    const candidates = computeCandidates(
      stems,
      buildState({ phase: 'breakdown', activeStemKeys: ['a', 'b'] }),
      0
    )
    expect(candidates.every((c) => c.moveType === 'exit')).toBe(true)
    expect(candidates).toHaveLength(2)
  })

  it('outro proposes only exit candidates', () => {
    const stems = [stemInput({ stemKey: 'a' })]
    const candidates = computeCandidates(
      stems,
      buildState({ phase: 'outro', activeStemKeys: ['a'] }),
      0
    )
    expect(candidates.every((c) => c.moveType === 'exit')).toBe(true)
  })

  it('never proposes a candidate for an excluded stem, in any phase', () => {
    const stems = [stemInput({ stemKey: 'a', included: false })]
    const candidates = computeCandidates(stems, buildState({ phase: 'intro' }), 0)
    expect(candidates.find((c) => c.stemKey === 'a')).toBeUndefined()
  })

  it('never proposes a fresh enter candidate for an already-active stem', () => {
    const stems = [stemInput({ stemKey: 'a' })]
    const candidates = computeCandidates(
      stems,
      buildState({ phase: 'intro', activeStemKeys: ['a'] }),
      0
    )
    expect(candidates.find((c) => c.stemKey === 'a' && c.moveType === 'enter')).toBeUndefined()
  })

  it('weights sparser stems higher than denser stems for entering', () => {
    const stems = [
      stemInput({ stemKey: 'sparse', densityScore: 0.1 }),
      stemInput({ stemKey: 'dense', densityScore: 0.9 })
    ]
    const candidates = computeCandidates(stems, buildState({ phase: 'intro' }), 0)
    const sparse = candidates.find((c) => c.stemKey === 'sparse')!
    const dense = candidates.find((c) => c.stemKey === 'dense')!
    expect(sparse.weight).toBeGreaterThan(dense.weight)
  })

  it('boosts a role not yet represented among active stems over one that already is', () => {
    const stems = [
      stemInput({ stemKey: 'active-drums', role: 'drums' }),
      stemInput({ stemKey: 'new-drums', role: 'drums', densityScore: 0.5 }),
      stemInput({ stemKey: 'new-bass', role: 'bass', densityScore: 0.5 })
    ]
    const candidates = computeCandidates(
      stems,
      buildState({ phase: 'intro', activeStemKeys: ['active-drums'] }),
      0
    )
    const newDrums = candidates.find((c) => c.stemKey === 'new-drums')!
    const newBass = candidates.find((c) => c.stemKey === 'new-bass')!
    expect(newBass.weight).toBeGreaterThan(newDrums.weight)
  })

  it('proposes zero fill candidates when fill is allowed but every stem is already active', () => {
    const stems = [
      stemInput({ stemKey: 'bright', fillScore: 0.9 }),
      stemInput({ stemKey: 'dull', fillScore: 0.1 })
    ]
    const candidates = computeCandidates(
      stems,
      buildState({ phase: 'build', activeStemKeys: ['bright', 'dull'] }),
      0
    )
    expect(candidates.filter((c) => c.moveType === 'fill')).toHaveLength(0)
  })

  it('proposes a fill candidate from the highest fillScore inactive stem when fill is allowed', () => {
    const stems = [
      stemInput({ stemKey: 'bright', fillScore: 0.9 }),
      stemInput({ stemKey: 'dull', fillScore: 0.1 })
    ]
    const candidates = computeCandidates(stems, buildState({ phase: 'build' }), 0)
    const fills = candidates.filter((c) => c.moveType === 'fill')
    expect(fills).toHaveLength(1)
    expect(fills[0].stemKey).toBe('bright')
  })

  it('weights a higher-frequency stem higher than an otherwise-identical lower-frequency stem', () => {
    const stems = [
      stemInput({ stemKey: 'once-stem', frequency: 'once' }),
      stemInput({ stemKey: 'very-frequent-stem', frequency: 'veryFrequent' })
    ]
    const candidates = computeCandidates(stems, buildState({ phase: 'intro' }), 0)
    const once = candidates.find((c) => c.stemKey === 'once-stem')!
    const veryFrequent = candidates.find((c) => c.stemKey === 'very-frequent-stem')!
    expect(veryFrequent.weight).toBeGreaterThan(once.weight)
    expect(veryFrequent.weight).toBeCloseTo(
      once.weight * (FREQUENCY_WEIGHT_MULTIPLIER.veryFrequent / FREQUENCY_WEIGHT_MULTIPLIER.once)
    )
  })

  it('weights denser active stems higher than sparser ones for exiting', () => {
    const stems = [
      stemInput({ stemKey: 'sparse', densityScore: 0.1 }),
      stemInput({ stemKey: 'dense', densityScore: 0.9 })
    ]
    const candidates = computeCandidates(
      stems,
      buildState({ phase: 'breakdown', activeStemKeys: ['sparse', 'dense'] }),
      0
    )
    const sparse = candidates.find((c) => c.stemKey === 'sparse' && c.moveType === 'exit')!
    const dense = candidates.find((c) => c.stemKey === 'dense' && c.moveType === 'exit')!
    expect(dense.weight).toBeGreaterThan(sparse.weight)
  })

  it('never proposes an exit candidate for an already-inactive stem', () => {
    const stems = [stemInput({ stemKey: 'a' })]
    const candidates = computeCandidates(stems, buildState({ phase: 'breakdown' }), 0)
    expect(candidates.find((c) => c.stemKey === 'a' && c.moveType === 'exit')).toBeUndefined()
  })
})

describe('computeCandidates - re-entry gating', () => {
  it('re-entry is allowed during breakdown (exit is allowed there), not gated by enter permission', () => {
    const stems = [stemInput({ stemKey: 'a', frequency: 'veryFrequent' })]
    const state = buildState({ phase: 'breakdown', activeStemKeys: [], lastExitStep: { a: 0 } })
    const candidates = computeCandidates(stems, state, 10)
    expect(candidates.find((c) => c.stemKey === 'a' && c.moveType === 'enter')).toBeDefined()
  })

  it('re-entry is allowed during outro too', () => {
    const stems = [stemInput({ stemKey: 'a', frequency: 'veryFrequent' })]
    const state = buildState({ phase: 'outro', activeStemKeys: [], lastExitStep: { a: 0 } })
    const candidates = computeCandidates(stems, state, 10)
    expect(candidates.find((c) => c.stemKey === 'a' && c.moveType === 'enter')).toBeDefined()
  })

  it('re-entry never appears during peak, even for an eligible, cooled-down stem', () => {
    const stems = [stemInput({ stemKey: 'a', frequency: 'veryFrequent' })]
    const state = buildState({ phase: 'peak', activeStemKeys: [], lastExitStep: { a: 0 } })
    const candidates = computeCandidates(stems, state, 10)
    expect(candidates.find((c) => c.stemKey === 'a' && c.moveType === 'enter')).toBeUndefined()
  })

  it('a "once" stem never appears as a re-entry candidate, even long after exiting', () => {
    const stems = [stemInput({ stemKey: 'a', frequency: 'once' })]
    const state = buildState({ phase: 'breakdown', activeStemKeys: [], lastExitStep: { a: 0 } })
    const candidates = computeCandidates(stems, state, 1000)
    expect(candidates.find((c) => c.stemKey === 'a' && c.moveType === 'enter')).toBeUndefined()
  })

  it('an "occasional" stem does not re-enter before its cooldown has elapsed, but does once it has', () => {
    const stems = [stemInput({ stemKey: 'a', frequency: 'occasional' })]
    const cooldown = REENTRY_COOLDOWN_STEPS.occasional
    const state = buildState({ phase: 'breakdown', activeStemKeys: [], lastExitStep: { a: 5 } })
    const tooSoon = computeCandidates(stems, state, 5 + cooldown - 1)
    expect(tooSoon.find((c) => c.stemKey === 'a' && c.moveType === 'enter')).toBeUndefined()

    const eligible = computeCandidates(stems, state, 5 + cooldown)
    expect(eligible.find((c) => c.stemKey === 'a' && c.moveType === 'enter')).toBeDefined()
  })

  it('a stem that has never exited never appears as a re-entry candidate, regardless of frequency', () => {
    const stems = [stemInput({ stemKey: 'a', frequency: 'veryFrequent' })]
    const state = buildState({ phase: 'breakdown', activeStemKeys: [], lastExitStep: {} })
    const candidates = computeCandidates(stems, state, 100)
    expect(candidates.find((c) => c.stemKey === 'a' && c.moveType === 'enter')).toBeUndefined()
  })

  it('a re-entry candidate is weighted using enterWeight scaled by the frequency multiplier, with a re-entering reason', () => {
    const stems = [
      stemInput({ stemKey: 'a', frequency: 'frequent', densityScore: 0.3 }),
      stemInput({ stemKey: 'b', densityScore: 0.9 }) // still-active exit candidate for contrast
    ]
    const state = buildState({ phase: 'breakdown', activeStemKeys: ['b'], lastExitStep: { a: 0 } })
    const candidates = computeCandidates(stems, state, REENTRY_COOLDOWN_STEPS.frequent)
    const reentry = candidates.find((c) => c.stemKey === 'a' && c.moveType === 'enter')!
    expect(reentry).toBeDefined()
    expect(reentry.reason.toLowerCase()).toContain('re-entering')
  })
})

describe('advanceBuildState', () => {
  it('adds the stem to activeStemKeys on an enter move', () => {
    const next = advanceBuildState(
      buildState(),
      [stemInput({ stemKey: 'a' })],
      { stemKey: 'a', moveType: 'enter', weight: 1, reason: 'test' },
      0
    )
    expect(next.activeStemKeys).toContain('a')
  })

  it('removes the stem from activeStemKeys on an exit move', () => {
    const state = buildState({ phase: 'breakdown', activeStemKeys: ['a'] })
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
      buildState(),
      [stemInput({ stemKey: 'a' })],
      { stemKey: 'a', moveType: 'fill', weight: 1, reason: 'test' },
      0
    )
    expect(next.activeStemKeys).toEqual([])
  })

  it('does not touch phase or stepsInPhase', () => {
    const state = buildState({ phase: 'build', stepsInPhase: 1 })
    const next = advanceBuildState(
      state,
      [stemInput({ stemKey: 'a' })],
      { stemKey: 'a', moveType: 'enter', weight: 1, reason: 'test' },
      0
    )
    expect(next.phase).toBe('build')
    expect(next.stepsInPhase).toBe(1)
  })

  it('records lastExitStep[stemKey] = stepIndex when an exit move is chosen', () => {
    const state = buildState({ phase: 'breakdown', activeStemKeys: ['a'] })
    const next = advanceBuildState(
      state,
      [stemInput({ stemKey: 'a' })],
      { stemKey: 'a', moveType: 'exit', weight: 1, reason: 'test' },
      7
    )
    expect(next.lastExitStep.a).toBe(7)
  })

  it('does not touch lastExitStep on an enter move', () => {
    const state = buildState({ lastExitStep: { b: 2 } })
    const next = advanceBuildState(
      state,
      [stemInput({ stemKey: 'a' })],
      { stemKey: 'a', moveType: 'enter', weight: 1, reason: 'test' },
      9
    )
    expect(next.lastExitStep).toEqual({ b: 2 })
  })

  it('does not touch lastExitStep on a fill move', () => {
    const state = buildState({ lastExitStep: { b: 2 } })
    const next = advanceBuildState(
      state,
      [stemInput({ stemKey: 'a' })],
      { stemKey: 'a', moveType: 'fill', weight: 1, reason: 'test' },
      9
    )
    expect(next.lastExitStep).toEqual({ b: 2 })
  })
})

describe('advancePhase', () => {
  it('stays in the current phase and increments stepsInPhase while below the target', () => {
    expect(PHASE_STEP_TARGETS.intro).toBe(2)
    const next = advancePhase(buildState({ phase: 'intro', stepsInPhase: 0 }))
    expect(next.phase).toBe('intro')
    expect(next.stepsInPhase).toBe(1)
  })

  it('rolls to the next phase and resets stepsInPhase once the target is reached', () => {
    const next = advancePhase(buildState({ phase: 'intro', stepsInPhase: 1 }))
    expect(next.phase).toBe('build')
    expect(next.stepsInPhase).toBe(0)
  })

  it('walks the full PHASE_ORDER in sequence as targets are reached', () => {
    let state = buildState({ phase: 'intro', stepsInPhase: 0 })
    const seenPhases: ArrangePhase[] = [state.phase]
    const totalCalls =
      PHASE_STEP_TARGETS.intro +
      PHASE_STEP_TARGETS.build +
      PHASE_STEP_TARGETS.peak +
      PHASE_STEP_TARGETS.breakdown +
      1
    for (let i = 0; i < totalCalls; i++) {
      state = advancePhase(state)
      if (seenPhases[seenPhases.length - 1] !== state.phase) seenPhases.push(state.phase)
    }
    expect(seenPhases).toEqual(PHASE_ORDER)
  })

  it('keeps incrementing stepsInPhase forever once already at outro, without wrapping around', () => {
    const atOutro = buildState({ phase: 'outro', stepsInPhase: PHASE_STEP_TARGETS.outro })
    const next = advancePhase(atOutro)
    expect(next.phase).toBe('outro')
    expect(next.stepsInPhase).toBe(PHASE_STEP_TARGETS.outro + 1)
  })

  it('does not touch activeStemKeys or lastExitStep', () => {
    const state = buildState({ activeStemKeys: ['a'], lastExitStep: { b: 2 } })
    const next = advancePhase(state)
    expect(next.activeStemKeys).toEqual(['a'])
    expect(next.lastExitStep).toEqual({ b: 2 })
  })

  it('uses a custom phaseStepTargets record when one is provided, instead of the default', () => {
    const custom = { intro: 1, build: 1, peak: 1, breakdown: 1, outro: 1 }
    const next = advancePhase(buildState({ phase: 'intro', stepsInPhase: 0 }), custom)
    // Default PHASE_STEP_TARGETS.intro is 2 -- with a custom target of 1,
    // a single advance should already cross into 'build'.
    expect(next.phase).toBe('build')
    expect(next.stepsInPhase).toBe(0)
  })

  it('omitting phaseStepTargets keeps using the default PHASE_STEP_TARGETS, unchanged', () => {
    const next = advancePhase(buildState({ phase: 'intro', stepsInPhase: 0 }))
    expect(next.phase).toBe('intro')
    expect(next.stepsInPhase).toBe(1)
  })
})

describe('retreatPhase', () => {
  it('is the exact inverse of advancePhase within one phase (no boundary crossed)', () => {
    const state = buildState({ phase: 'intro', stepsInPhase: 1 })
    const forward = advancePhase(buildState({ phase: 'intro', stepsInPhase: 0 }))
    expect(forward).toEqual(state)
    expect(retreatPhase(forward)).toEqual(buildState({ phase: 'intro', stepsInPhase: 0 }))
  })

  it('is the exact inverse of advancePhase across a phase boundary', () => {
    // intro's own target is 2 -- advancing from stepsInPhase=1 crosses into
    // build. Retreating from the result must land exactly back on
    // {intro, stepsInPhase: 1}, not just "some earlier-looking state".
    const beforeBoundary = buildState({ phase: 'intro', stepsInPhase: 1 })
    const afterBoundary = advancePhase(beforeBoundary)
    expect(afterBoundary.phase).toBe('build')
    expect(afterBoundary.stepsInPhase).toBe(0)
    expect(retreatPhase(afterBoundary)).toEqual(beforeBoundary)
  })

  it('walks PHASE_ORDER backwards symmetrically to how advancePhase walks it forwards', () => {
    let state = buildState({ phase: 'intro', stepsInPhase: 0 })
    const totalForwardCalls =
      PHASE_STEP_TARGETS.intro +
      PHASE_STEP_TARGETS.build +
      PHASE_STEP_TARGETS.peak +
      PHASE_STEP_TARGETS.breakdown
    const history: ArrangeBuildState[] = [state]
    for (let i = 0; i < totalForwardCalls; i++) {
      state = advancePhase(state)
      history.push(state)
    }
    expect(state.phase).toBe('outro')
    // Walk back down the exact same history, one retreatPhase per forward
    // advancePhase call, and confirm each intermediate state matches exactly.
    for (let i = history.length - 1; i > 0; i--) {
      state = retreatPhase(state)
      expect(state).toEqual(history[i - 1])
    }
  })

  it('retreating within the terminal outro phase just decrements, no wraparound', () => {
    const deepInOutro = buildState({ phase: 'outro', stepsInPhase: 5 })
    const back = retreatPhase(deepInOutro)
    expect(back.phase).toBe('outro')
    expect(back.stepsInPhase).toBe(4)
  })

  it('retreating from outro at stepsInPhase 0 rolls back into breakdown', () => {
    const justEnteredOutro = buildState({ phase: 'outro', stepsInPhase: 0 })
    const back = retreatPhase(justEnteredOutro)
    expect(back.phase).toBe('breakdown')
    expect(back.stepsInPhase).toBe(PHASE_STEP_TARGETS.breakdown - 1)
  })

  it('is a no-op at the very start (intro, stepsInPhase 0) -- nothing to retreat to', () => {
    const veryStart = buildState({ phase: 'intro', stepsInPhase: 0 })
    expect(retreatPhase(veryStart)).toEqual(veryStart)
  })

  it('does not touch activeStemKeys or lastExitStep', () => {
    const state = buildState({
      phase: 'build',
      stepsInPhase: 1,
      activeStemKeys: ['a'],
      lastExitStep: { b: 2 }
    })
    const back = retreatPhase(state)
    expect(back.activeStemKeys).toEqual(['a'])
    expect(back.lastExitStep).toEqual({ b: 2 })
  })
})

describe('isArrangementComplete', () => {
  it('is false while any stem is active, even in outro', () => {
    expect(isArrangementComplete(buildState({ phase: 'outro', activeStemKeys: ['a'] }))).toBe(false)
  })

  it('is true once no stems remain active in outro', () => {
    expect(isArrangementComplete(buildState({ phase: 'outro', activeStemKeys: [] }))).toBe(true)
  })

  it('is false with zero active stems in any phase before outro', () => {
    expect(isArrangementComplete(buildState({ phase: 'intro', activeStemKeys: [] }))).toBe(false)
    expect(isArrangementComplete(buildState({ phase: 'build', activeStemKeys: [] }))).toBe(false)
    expect(isArrangementComplete(buildState({ phase: 'peak', activeStemKeys: [] }))).toBe(false)
    expect(isArrangementComplete(buildState({ phase: 'breakdown', activeStemKeys: [] }))).toBe(
      false
    )
  })
})
