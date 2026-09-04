# Auto-Arrange: Guided Phases + Multi-Move-Per-Step Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Auto-Arrange's binary build/release split with a five-phase guided arc
(intro/build/peak/breakdown/outro) with per-phase step targets and allowed move types, and let
several moves land on one step instead of exactly one.

**Architecture:** `src/shared/autoArrangeEngine.ts` gets a new `ArrangePhase` model replacing
`peakReached`, with `computeCandidates` gated by `PHASE_MOVE_TYPES` (fresh entry and re-entry
gated on *different* phase permissions -- see Task 1). `src/shared/autoArrangeBuildStep.ts`
splits its single `applyBuildStep` into `applyCandidate` (apply a move, stay on the step) and
`advanceToNextStep` (advance the step, roll the phase). `AutoArrangeBuildStep.tsx` wires both in,
adds a "next step" button, and surfaces the phase in its header.

**Tech Stack:** TypeScript, React, Vitest (TDD for `src/shared/`), Electron renderer.

---

## Spec

Read `docs/superpowers/specs/2026-09-04-auto-arrange-phases-multimove-design.md` in full before
starting -- it has the complete rationale, including why re-entry must be gated by `'exit'`
permission rather than `'enter'` permission (Task 1 depends on getting this right).

## Files

- Modify: `src/shared/autoArrangeEngine.ts` -- phase model, gated `computeCandidates`, new
  `advancePhase`, rewritten `isArrangementComplete`, `PEAK_ACTIVE_FRACTION` removed.
- Modify: `src/shared/autoArrangeEngine.test.ts` -- full rewrite for the phase model.
- Modify: `src/shared/autoArrangeBuildStep.ts` -- `applyBuildStep` splits into `applyCandidate` +
  `advanceToNextStep`.
- Modify: `src/shared/autoArrangeBuildStep.test.ts` -- full rewrite for the split.
- Modify: `src/renderer/src/components/AutoArrangeBuildStep.tsx` -- wiring, phase-aware eyebrow,
  new "next step" button, `MIN_STEMS_FOR_FULL_ARC` warning.
- **Not touched:** `src/shared/autoArrangeApply.ts` (already step-index-agnostic to how many
  moves share a step), `src/renderer/src/components/AutoArrangeWizard.tsx` (no `peakReached`
  reference exists there -- confirmed by repo-wide grep before writing this plan).

---

### Task 1: Phase model in `autoArrangeEngine.ts`

**Files:**
- Modify: `src/shared/autoArrangeEngine.ts`
- Test: `src/shared/autoArrangeEngine.test.ts`

- [ ] **Step 1: Replace the test file with the full rewrite below**

```typescript
import { describe, expect, it } from 'vitest'
import {
  advanceBuildState,
  advancePhase,
  computeCandidates,
  isArrangementComplete,
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
})

describe('isArrangementComplete', () => {
  it('is false while any stem is active, even in outro', () => {
    expect(isArrangementComplete(buildState({ phase: 'outro', activeStemKeys: ['a'] }))).toBe(
      false
    )
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/shared/autoArrangeEngine.test.ts`
Expected: FAIL -- `advancePhase`/`PHASE_ORDER`/`PHASE_STEP_TARGETS` don't exist yet, and every
`ArrangeBuildState` literal is missing `phase`/`stepsInPhase` per the OLD type (TypeScript errors
alongside test failures).

- [ ] **Step 3: Replace `src/shared/autoArrangeEngine.ts` with the full rewrite below**

```typescript
import type { StemFrequency } from './stemRole'

export type ArrangeMoveType = 'enter' | 'exit' | 'fill'

// The five-phase guided arc a build progresses through, replacing the old
// binary peakReached. Phases only ever move FORWARD through PHASE_ORDER --
// there's no looping back, and no manual skip for v1 (see the design spec's
// own Non-goals).
export type ArrangePhase = 'intro' | 'build' | 'peak' | 'breakdown' | 'outro'

export const PHASE_ORDER: ArrangePhase[] = ['intro', 'build', 'peak', 'breakdown', 'outro']

// How many "next step" advances (advancePhase calls) to spend in each phase
// before automatically rolling to the next one -- hardcoded defaults for v1,
// kept here as the one place to look when tuning (same convention as
// ENTER_SPARSITY_WEIGHT etc. below).
export const PHASE_STEP_TARGETS: Record<ArrangePhase, number> = {
  intro: 2,
  build: 3,
  peak: 2,
  breakdown: 2,
  outro: 1
}

// Which move types computeCandidates may propose in each phase. 'peak'
// deliberately allows ONLY 'fill' -- peak should hold, not keep growing
// (build's job) or start shrinking (breakdown's job); a fill can still
// flicker something in briefly without changing the held-steady layer.
//
// Re-entry (a previously-exited, frequency-eligible stem becoming an
// 'enter' candidate again) is NOT gated by this table the same way a fresh
// entry is -- see computeCandidates below. Gating it by 'enter' membership
// would make re-entry structurally impossible (phases only move forward,
// and 'exit' only becomes allowed in phases that come after every phase
// permitting 'enter'), silently turning the whole frequency/re-entry
// feature into dead code. Re-entry is instead gated by 'exit' membership --
// allowed exactly where fresh exits are also happening.
export const PHASE_MOVE_TYPES: Record<ArrangePhase, ArrangeMoveType[]> = {
  intro: ['enter'],
  build: ['enter', 'fill'],
  peak: ['fill'],
  breakdown: ['exit'],
  outro: ['exit']
}

// Below this many included stems, the full five-phase arc has too little
// material to say much -- AutoArrangeBuildStep.tsx uses this for its own
// advisory (non-blocking) warning.
export const MIN_STEMS_FOR_FULL_ARC = 4

export interface ArrangeStemInput {
  stemKey: string
  // Opaque grouping key for role diversity -- the ArrangeRole string
  // StemRoleInfo resolved. The engine only compares equality, it doesn't
  // need to know the concrete type.
  role: string
  densityScore: number // 0..1, from computeDensityScore
  fillScore: number // 0..1, from computeFillScore
  included: boolean
  // Re-entry/priority preference -- see StemFrequency's own doc comment.
  frequency: StemFrequency
}

export interface ArrangeBuildState {
  activeStemKeys: string[]
  phase: ArrangePhase
  // How many advancePhase calls have happened since the CURRENT phase
  // started -- resets to 0 whenever advancePhase rolls to a new phase.
  stepsInPhase: number
  // stepIndex at which each stem last exited -- absent for a stem that has
  // never exited (either still active, or never entered at all). Used to
  // gate re-entry eligibility by REENTRY_COOLDOWN_STEPS.
  lastExitStep: Record<string, number>
}

export interface ArrangeCandidate {
  stemKey: string
  moveType: ArrangeMoveType
  weight: number
  reason: string
}

// Enter-candidate weighting: how much a stem's own sparsity vs. its role's
// under-representation among active stems should drive the pick. A first
// pass, expected to be retuned after a real manual walkthrough -- keep these
// as the one place to look when tuning.
const ENTER_SPARSITY_WEIGHT = 0.6
const ENTER_DIVERSITY_WEIGHT = 0.4
// Above this diversity bonus, a stem's role is treated as "not yet
// represented" for the candidate's explanatory reason text -- kept in sync
// with ENTER_DIVERSITY_WEIGHT's meaning, not an independent tuning knob.
const DIVERSITY_NOTABLE_THRESHOLD = 0.5

// Re-entry cooldown (in build steps) before an exited stem becomes eligible
// to enter again -- lower for higher-frequency preferences, so a
// "veryFrequent" stem can cycle back in almost immediately while "occasional"
// waits longer.
export const REENTRY_COOLDOWN_STEPS: Record<Exclude<StemFrequency, 'once'>, number> = {
  occasional: 3,
  frequent: 2,
  veryFrequent: 1
}

// Multiplies a stem's enter-candidate weight (both its FIRST entry and any
// re-entry) -- this is the "priority" half of the frequency preference: among
// two competing stems with similar density/diversity scores, the
// higher-frequency one is favored more often. 'once' is the neutral/current
// baseline.
export const FREQUENCY_WEIGHT_MULTIPLIER: Record<StemFrequency, number> = {
  once: 1.0,
  occasional: 1.2,
  frequent: 1.4,
  veryFrequent: 1.7
}

function includedStems(stems: ArrangeStemInput[]): ArrangeStemInput[] {
  return stems.filter((s) => s.included)
}

function enterWeight(densityScore: number, diversity: number): number {
  return (1 - densityScore) * ENTER_SPARSITY_WEIGHT + diversity * ENTER_DIVERSITY_WEIGHT
}

function roleDiversityBonus(
  role: string,
  activeStemKeys: string[],
  stems: ArrangeStemInput[]
): number {
  if (activeStemKeys.length === 0) return 1
  const activeWithSameRole = activeStemKeys.filter((key) => {
    const s = stems.find((stem) => stem.stemKey === key)
    return s?.role === role
  }).length
  return 1 - activeWithSameRole / activeStemKeys.length
}

function bestFillCandidate(
  candidateStems: ArrangeStemInput[],
  activeStemKeys: string[]
): ArrangeCandidate | null {
  const inactive = candidateStems.filter((s) => !activeStemKeys.includes(s.stemKey))
  if (inactive.length === 0) return null
  const best = inactive.reduce((a, b) => (b.fillScore > a.fillScore ? b : a))
  return {
    stemKey: best.stemKey,
    moveType: 'fill',
    weight: best.fillScore,
    reason: 'bright, transient material -- good fill candidate'
  }
}

export function computeCandidates(
  stems: ArrangeStemInput[],
  buildState: ArrangeBuildState,
  stepIndex: number
): ArrangeCandidate[] {
  const candidateStems = includedStems(stems)
  const candidates: ArrangeCandidate[] = []
  const allowed = PHASE_MOVE_TYPES[buildState.phase]

  if (allowed.includes('enter')) {
    // Fresh entries only -- a stem that has never exited. Re-entry (below)
    // is gated separately, on 'exit' permission, not 'enter'.
    for (const stem of candidateStems) {
      if (buildState.activeStemKeys.includes(stem.stemKey)) continue
      if (buildState.lastExitStep[stem.stemKey] !== undefined) continue
      const diversity = roleDiversityBonus(stem.role, buildState.activeStemKeys, stems)
      candidates.push({
        stemKey: stem.stemKey,
        moveType: 'enter',
        weight:
          enterWeight(stem.densityScore, diversity) * FREQUENCY_WEIGHT_MULTIPLIER[stem.frequency],
        reason:
          diversity > DIVERSITY_NOTABLE_THRESHOLD
            ? 'sparse and a role not yet represented'
            : 'sparse -- good early/building material'
      })
    }
  }

  if (allowed.includes('exit')) {
    for (const stem of candidateStems) {
      if (buildState.activeStemKeys.includes(stem.stemKey)) {
        candidates.push({
          stemKey: stem.stemKey,
          moveType: 'exit',
          weight: stem.densityScore,
          reason: 'dense -- good candidate to thin out first'
        })
        continue
      }

      // Re-entry: an inactive stem that has exited before, has a
      // re-entry-eligible frequency preference, and has cleared its
      // cooldown since that exit. Gated by 'exit' membership (this same
      // `if`), not 'enter' membership -- see PHASE_MOVE_TYPES's own doc
      // comment for why.
      if (stem.frequency === 'once') continue
      const lastExit = buildState.lastExitStep[stem.stemKey]
      if (lastExit === undefined) continue
      if (stepIndex - lastExit < REENTRY_COOLDOWN_STEPS[stem.frequency]) continue

      const diversity = roleDiversityBonus(stem.role, buildState.activeStemKeys, stems)
      candidates.push({
        stemKey: stem.stemKey,
        moveType: 'enter',
        weight:
          enterWeight(stem.densityScore, diversity) * FREQUENCY_WEIGHT_MULTIPLIER[stem.frequency],
        reason: `re-entering -- ${stem.frequency} preference`
      })
    }
  }

  if (allowed.includes('fill')) {
    const fill = bestFillCandidate(candidateStems, buildState.activeStemKeys)
    if (fill) candidates.push(fill)
  }

  return candidates
}

export function advanceBuildState(
  buildState: ArrangeBuildState,
  stems: ArrangeStemInput[],
  chosen: ArrangeCandidate,
  stepIndex: number
): ArrangeBuildState {
  let activeStemKeys = buildState.activeStemKeys
  let lastExitStep = buildState.lastExitStep
  if (chosen.moveType === 'enter') {
    activeStemKeys = [...activeStemKeys, chosen.stemKey]
  } else if (chosen.moveType === 'exit') {
    activeStemKeys = activeStemKeys.filter((k) => k !== chosen.stemKey)
    lastExitStep = { ...lastExitStep, [chosen.stemKey]: stepIndex }
  }
  // 'fill' does not change the persistent active set -- it's a brief blip,
  // handled entirely at the apply-to-timeline stage.

  return { ...buildState, activeStemKeys, lastExitStep }
}

// Advances the build by one step: bumps stepsInPhase, and rolls to the next
// PHASE_ORDER entry (resetting stepsInPhase to 0) once the current phase's
// PHASE_STEP_TARGETS has been reached. Once already at the last phase
// ('outro'), further calls just keep incrementing stepsInPhase with no
// further transition -- the build's real end condition is
// isArrangementComplete, not running out of phases. Pure, no other
// arguments needed: phase targets are fixed constants, not stem-count- or
// stepIndex-dependent.
export function advancePhase(buildState: ArrangeBuildState): ArrangeBuildState {
  const nextStepsInPhase = buildState.stepsInPhase + 1
  const currentIndex = PHASE_ORDER.indexOf(buildState.phase)
  const isLastPhase = currentIndex === PHASE_ORDER.length - 1
  if (!isLastPhase && nextStepsInPhase >= PHASE_STEP_TARGETS[buildState.phase]) {
    return { ...buildState, phase: PHASE_ORDER[currentIndex + 1], stepsInPhase: 0 }
  }
  return { ...buildState, stepsInPhase: nextStepsInPhase }
}

export function isArrangementComplete(buildState: ArrangeBuildState): boolean {
  return buildState.phase === 'outro' && buildState.activeStemKeys.length === 0
}
```

Note: `PEAK_ACTIVE_FRACTION` is gone entirely (confirmed via repo-wide grep before writing this
plan that nothing else references it) -- phase transitions are now purely step-count-driven via
`advancePhase`, not density-driven.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/shared/autoArrangeEngine.test.ts`
Expected: PASS, all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/shared/autoArrangeEngine.ts src/shared/autoArrangeEngine.test.ts
git commit -m "Replace peakReached with a five-phase guided arc in autoArrangeEngine

Gates computeCandidates by PHASE_MOVE_TYPES per phase (peak allows only
fill; intro/build allow enter; breakdown/outro allow exit). Re-entry is
gated by 'exit' permission rather than 'enter' permission -- gating it the
same way as fresh entry would make re-entry structurally impossible under
forward-only phase progression, silently breaking the frequency/re-entry
feature. New advancePhase walks PHASE_ORDER once each phase's
PHASE_STEP_TARGETS is reached. isArrangementComplete is now phase===outro
with nothing active. PEAK_ACTIVE_FRACTION removed (superseded by step-count
targets)."
```

---

### Task 2: Split `applyBuildStep` in `autoArrangeBuildStep.ts`

**Files:**
- Modify: `src/shared/autoArrangeBuildStep.ts`
- Test: `src/shared/autoArrangeBuildStep.test.ts`

- [ ] **Step 1: Replace the test file with the full rewrite below**

```typescript
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/shared/autoArrangeBuildStep.test.ts`
Expected: FAIL -- `applyCandidate`/`advanceToNextStep` don't exist yet (`applyBuildStep` does, but
nothing imports it any more).

- [ ] **Step 3: Replace `src/shared/autoArrangeBuildStep.ts` with the full rewrite below**

```typescript
import {
  advanceBuildState,
  advancePhase,
  isArrangementComplete,
  type ArrangeBuildState,
  type ArrangeCandidate,
  type ArrangeStemInput
} from './autoArrangeEngine'
import type { ArrangeMoveRecord } from './autoArrangeApply'

export const MAX_CANDIDATES_SHOWN = 3
// Safety cap so a pathological weighting (or a single included stem that can
// never reach outro) can't loop forever.
export const MAX_BUILD_STEPS = 64

export interface ApplyCandidateResult {
  moves: ArrangeMoveRecord[]
  buildState: ArrangeBuildState
  complete: boolean
}

// Applies one chosen candidate WITHOUT advancing the step -- appends its
// move record (stamped with the CURRENT stepIndex) and advances buildState
// via the engine, but leaves stepIndex/phase alone. Multi-move-per-step: the
// caller can apply several candidates in a row at the same stepIndex before
// calling advanceToNextStep below, since computeCandidates recomputes fresh
// against the updated buildState each time. Completion can still happen
// mid-step -- e.g. the last exit during 'outro' brings the active set to
// zero -- so isArrangementComplete is still checked here, not only in
// advanceToNextStep.
export function applyCandidate(
  moves: ArrangeMoveRecord[],
  buildState: ArrangeBuildState,
  stems: ArrangeStemInput[],
  stepIndex: number,
  candidate: ArrangeCandidate
): ApplyCandidateResult {
  const nextMoves: ArrangeMoveRecord[] = [
    ...moves,
    { stepIndex, stemKey: candidate.stemKey, moveType: candidate.moveType }
  ]
  const nextState = advanceBuildState(buildState, stems, candidate, stepIndex)
  return { moves: nextMoves, buildState: nextState, complete: isArrangementComplete(nextState) }
}

export interface AdvanceStepResult {
  buildState: ArrangeBuildState
  stepIndex: number
  complete: boolean
}

// Advances to the next step: bumps stepIndex, calls the engine's
// advancePhase (which may roll to the next phase once its own target is
// reached), and checks completion -- either the natural
// isArrangementComplete end, or MAX_BUILD_STEPS as a safety net (moved here
// from the old combined applyBuildStep, since stepIndex only ever changes
// via this function now).
export function advanceToNextStep(
  buildState: ArrangeBuildState,
  stepIndex: number
): AdvanceStepResult {
  const nextStepIndex = stepIndex + 1
  const nextState = advancePhase(buildState)
  const complete = isArrangementComplete(nextState) || nextStepIndex >= MAX_BUILD_STEPS
  return { buildState: nextState, stepIndex: nextStepIndex, complete }
}

// Top-N candidates by weight, for capping how many choices the build-step UI
// shows per step. Array.prototype.sort is stable per spec, so equal-weight
// candidates keep computeCandidates' own emission order (enter/exit
// candidates in stem order, with the single fill candidate -- if any -- last)
// rather than shuffling unpredictably between renders.
export function selectTopCandidates(
  candidates: ArrangeCandidate[],
  max: number = MAX_CANDIDATES_SHOWN
): ArrangeCandidate[] {
  return [...candidates].sort((a, b) => b.weight - a.weight).slice(0, max)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/shared/autoArrangeBuildStep.test.ts`
Expected: PASS, all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/shared/autoArrangeBuildStep.ts src/shared/autoArrangeBuildStep.test.ts
git commit -m "Split applyBuildStep into applyCandidate + advanceToNextStep

applyCandidate applies one move and stays on the current step -- the
foundation for multi-move-per-step, since computeCandidates recomputes
fresh against the updated buildState without the step advancing.
advanceToNextStep is the only thing that now increments stepIndex, calling
the engine's advancePhase (which may roll to the next phase) and checking
MAX_BUILD_STEPS/completion at that boundary instead of after every single
move."
```

---

### Task 3: Wire phases + multi-move into `AutoArrangeBuildStep.tsx`

**Files:**
- Modify: `src/renderer/src/components/AutoArrangeBuildStep.tsx`

No test file -- this codebase's established convention (root `CLAUDE.md`'s Testing conventions)
is typecheck+lint verification plus a real manual walkthrough for React components; no coding
agent can click through this UI.

- [ ] **Step 1: Update the import block**

Modify `src/renderer/src/components/AutoArrangeBuildStep.tsx:1-17`, replacing:

```typescript
import { useMemo, useState } from 'react'
import {
  computeCandidates,
  type ArrangeBuildState,
  type ArrangeCandidate,
  type ArrangeStemInput
} from '@shared/autoArrangeEngine'
import { activeStemKeysPerStep, type ArrangeMoveRecord } from '@shared/autoArrangeApply'
import { applyBuildStep, selectTopCandidates } from '@shared/autoArrangeBuildStep'
```

with:

```typescript
import { useMemo, useState } from 'react'
import {
  computeCandidates,
  MIN_STEMS_FOR_FULL_ARC,
  PHASE_STEP_TARGETS,
  type ArrangeBuildState,
  type ArrangeCandidate,
  type ArrangePhase,
  type ArrangeStemInput
} from '@shared/autoArrangeEngine'
import { activeStemKeysPerStep, type ArrangeMoveRecord } from '@shared/autoArrangeApply'
import {
  advanceToNextStep,
  applyCandidate,
  selectTopCandidates
} from '@shared/autoArrangeBuildStep'
```

(the rest of the import block -- `StoreContext`, `usePlacedFlatStems`, `useStemPreviewPlayback`,
`selectors`, `Waveform`, `typeColorVar`, `stemKey as buildStemKey`, `playButtonStyle` -- is
unchanged)

- [ ] **Step 2: Add a `PHASE_LABELS` map next to `MOVE_LABELS`/`ROLE_LABELS`**

Modify `src/renderer/src/components/AutoArrangeBuildStep.tsx:41-50`, after the existing
`ROLE_LABELS` constant, insert:

```typescript
// Lowercase, no jargon -- matches MOVE_LABELS/ROLE_LABELS's own convention.
// 'build' reads as "building up" rather than the bare engine phase name,
// since "build" on its own reads more like a verb/button than a section
// name in the eyebrow's sentence context.
const PHASE_LABELS: Record<ArrangePhase, string> = {
  intro: 'intro',
  build: 'building up',
  peak: 'peak',
  breakdown: 'breakdown',
  outro: 'outro'
}
```

- [ ] **Step 3: Change the `buildState` initial value**

Modify `src/renderer/src/components/AutoArrangeBuildStep.tsx:174-179`, replacing:

```typescript
  const [buildState, setBuildState] = useState<ArrangeBuildState>({
    activeStemKeys: [],
    peakReached: false,
    lastExitStep: {}
  })
```

with:

```typescript
  const [buildState, setBuildState] = useState<ArrangeBuildState>({
    activeStemKeys: [],
    phase: 'intro',
    stepsInPhase: 0,
    lastExitStep: {}
  })
```

- [ ] **Step 4: Replace the `tooFewStems` threshold**

Modify `src/renderer/src/components/AutoArrangeBuildStep.tsx:275-276`, replacing:

```typescript
  const includedCount = stems.filter((s) => s.included).length
  const tooFewStems = includedCount < 2
```

with:

```typescript
  const includedCount = stems.filter((s) => s.included).length
  const tooFewStems = includedCount < MIN_STEMS_FOR_FULL_ARC
```

- [ ] **Step 5: Update the too-few-stems warning message**

Modify `src/renderer/src/components/AutoArrangeBuildStep.tsx:443-448`, replacing:

```tsx
        {tooFewStems && (
          <div style={{ fontSize: 11, color: 'var(--ra-text-2)', marginBottom: 10 }}>
            only {includedCount} stem{includedCount === 1 ? '' : 's'} included -- not enough
            material for a real build/breakdown arc, this will be a trivial arrangement.
          </div>
        )}
```

with:

```tsx
        {tooFewStems && (
          <div style={{ fontSize: 11, color: 'var(--ra-text-2)', marginBottom: 10 }}>
            only {includedCount} stem{includedCount === 1 ? '' : 's'} included -- the full
            intro/build/peak/breakdown/outro arc works best with more variety; expect it to feel
            thin.
          </div>
        )}
```

- [ ] **Step 6: Rewrite `pick()` to use `applyCandidate` and stop advancing `stepIndex`**

Modify `src/renderer/src/components/AutoArrangeBuildStep.tsx:278-288`, replacing:

```typescript
  function pick(candidate: ArrangeCandidate): void {
    const result = applyBuildStep(moves, buildState, stems, stepIndex, candidate)
    setMoves(result.moves)
    setBuildState(result.buildState)

    if (result.complete) {
      onComplete(result.moves, stepIndex + 1)
      return
    }
    setStepIndex(stepIndex + 1)
  }
```

with:

```typescript
  // Applies one candidate and stays on the CURRENT step -- multi-move-per-
  // step: computeCandidates below recomputes fresh against the updated
  // buildState on the next render, so another candidate can be picked and
  // applied immediately without leaving this step. nextStep() (below) is
  // the only thing that now advances stepIndex.
  function pick(candidate: ArrangeCandidate): void {
    const result = applyCandidate(moves, buildState, stems, stepIndex, candidate)
    setMoves(result.moves)
    setBuildState(result.buildState)

    if (result.complete) {
      onComplete(result.moves, stepIndex + 1)
    }
  }

  // Advances to the next step (and, once the current phase's target is
  // reached, rolls into the next phase) -- the explicit action multi-move-
  // per-step needs now that applying a candidate no longer does this by
  // itself.
  function nextStep(): void {
    const result = advanceToNextStep(buildState, stepIndex)
    setBuildState(result.buildState)
    setStepIndex(result.stepIndex)
    setSelectedCandidateKey(null)

    if (result.complete) {
      onComplete(moves, result.stepIndex + 1)
    }
  }
```

- [ ] **Step 7: Update the phase-aware eyebrow**

Modify `src/renderer/src/components/AutoArrangeBuildStep.tsx:333-335`, replacing:

```tsx
        <div className="ra-eyebrow" style={{ marginBottom: 8 }}>
          step {stepIndex + 1} -- {buildState.activeStemKeys.length} active
        </div>
```

with:

```tsx
        <div className="ra-eyebrow" style={{ marginBottom: 8 }}>
          {PHASE_LABELS[buildState.phase]} -- step {buildState.stepsInPhase + 1} of{' '}
          {PHASE_STEP_TARGETS[buildState.phase]} ({buildState.activeStemKeys.length} active)
        </div>
```

- [ ] **Step 8: Update the helper text below "hear the arrangement so far"**

Modify `src/renderer/src/components/AutoArrangeBuildStep.tsx:438-442`, replacing:

```tsx
        <div style={{ fontSize: 10, color: 'var(--ra-text-3)', marginBottom: 12 }}>
          select a candidate below (or play its small ▶, which selects it too), then use apply to
          commit it and continue -- that small ▶ previews just that one stem in isolation, it
          doesn&apos;t combine with the others
        </div>
```

with:

```tsx
        <div style={{ fontSize: 10, color: 'var(--ra-text-3)', marginBottom: 12 }}>
          select a candidate below (or play its small ▶, which selects it too), then use apply to
          commit it -- applying keeps you on this step, so you can layer or pull several moves
          together before using next step to move on. That small ▶ previews just that one stem in
          isolation, it doesn&apos;t combine with the others.
        </div>
```

- [ ] **Step 9: Add the "next step" button**

Modify `src/renderer/src/components/AutoArrangeBuildStep.tsx:600-622` (the bottom button row),
replacing:

```tsx
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16 }}>
          <button
            onClick={applySelected}
            disabled={!selectedCandidate}
            title={selectedCandidate ? applyLabel : 'select a candidate above first'}
            style={{
              height: 22,
              borderRadius: 0,
              padding: '0 10px',
              fontSize: 10,
              fontWeight: 700,
              border: '1px solid var(--ra-stretch-on)',
              background: 'var(--ra-stretch-on)',
              color: 'var(--ra-play-on-ink)',
              // This app's disabled convention (docs/design.md, mirrored in
              // ContextMenu.tsx): dim to 30% opacity + not-allowed cursor,
              // rather than swapping to a separate "disabled" palette.
              cursor: selectedCandidate ? 'pointer' : 'not-allowed',
              opacity: selectedCandidate ? 1 : 0.3
            }}
          >
            {applyLabel}
          </button>
          <div style={{ flex: 1 }} />
```

with:

```tsx
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16 }}>
          <button
            onClick={applySelected}
            disabled={!selectedCandidate}
            title={selectedCandidate ? applyLabel : 'select a candidate above first'}
            style={{
              height: 22,
              borderRadius: 0,
              padding: '0 10px',
              fontSize: 10,
              fontWeight: 700,
              border: '1px solid var(--ra-stretch-on)',
              background: 'var(--ra-stretch-on)',
              color: 'var(--ra-play-on-ink)',
              // This app's disabled convention (docs/design.md, mirrored in
              // ContextMenu.tsx): dim to 30% opacity + not-allowed cursor,
              // rather than swapping to a separate "disabled" palette.
              cursor: selectedCandidate ? 'pointer' : 'not-allowed',
              opacity: selectedCandidate ? 1 : 0.3
            }}
          >
            {applyLabel}
          </button>
          <button
            onClick={nextStep}
            title="move on to the next step -- rolls into the next phase once its target is reached"
            style={{
              height: 22,
              borderRadius: 0,
              padding: '0 10px',
              fontSize: 10,
              border: '1px solid var(--ra-border-strong)',
              background: 'var(--ra-bg-row-active)',
              color: 'var(--ra-text)'
            }}
          >
            next step
          </button>
          <div style={{ flex: 1 }} />
```

(`cancel` and `finish now`, immediately after this block, are unchanged)

- [ ] **Step 10: Confirm no `peakReached` reference remains**

Run: `grep -n "peakReached" src/renderer/src/components/AutoArrangeBuildStep.tsx`
Expected: no output (every reference was covered by Steps 3-9 above).

- [ ] **Step 11: Typecheck and lint**

Run: `npm run typecheck`
Expected: clean, 0 errors.

Run: `npm run lint`
Expected: 0 errors (the pre-existing unrelated `scripts/generate-x64-test-config.js` prettier
warning may still appear -- that's fine, it predates this branch).

- [ ] **Step 12: Commit**

```bash
git add src/renderer/src/components/AutoArrangeBuildStep.tsx
git commit -m "Wire multi-move-per-step and guided phases into the build-step UI

pick() now uses applyCandidate and stays on the current step instead of
auto-advancing -- a new explicit 'next step' button (nextStep(), wired to
advanceToNextStep) is what moves the step forward and rolls the phase.
Eyebrow becomes phase-aware ('building up -- step 2 of 3 (3 active)').
tooFewStems now uses MIN_STEMS_FOR_FULL_ARC(4) with wording specific to the
five-phase arc. The build-progress grid and hear-the-arrangement preview
needed no structural changes -- they already read moves/
buildState.activeStemKeys directly."
```

---

### Task 4: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Repo-wide grep for any remaining `peakReached` reference**

Run: `grep -rn "peakReached" src/`
Expected: no output.

- [ ] **Step 2: Full typecheck**

Run: `npm run typecheck`
Expected: clean, 0 errors.

- [ ] **Step 3: Full lint**

Run: `npm run lint`
Expected: 0 errors (same pre-existing unrelated warning as Task 3 Step 11 is fine).

- [ ] **Step 4: Full test suite**

Run: `npx vitest run`
Expected: every test file passes, including the two rewritten in Tasks 1-2. Compare the total test
count against the pre-this-plan baseline (1100 passed as of the last full run on this branch) --
Tasks 1-2 add roughly 20 new tests net (phase-gating, re-entry-gating, `advancePhase`,
`advanceToNextStep` cases) while removing a handful of now-obsolete `peakReached`-specific ones;
the exact final count isn't load-bearing, just confirm nothing regressed.

- [ ] **Step 5: Note the required manual walkthrough**

This plan's UI changes (Task 3) are typecheck+lint-verified only, per this codebase's established
convention (root `CLAUDE.md`'s Testing conventions) -- no coding agent can click through
AutoArrangeBuildStep.tsx here. Flag to Elling, don't claim it as tested: he needs to run the app
(`npm run dev`), place a multi-stem loop, confirm auto-arrange with at least `MIN_STEMS_FOR_FULL_ARC`
(4) stems, and walk through applying several moves at one step before clicking "next step,"
confirm the phase eyebrow reads correctly through the whole arc, and confirm a `frequent`/
`veryFrequent` stem genuinely re-enters during breakdown/outro (the bug this plan's Task 1 fixed
before it ever shipped).
