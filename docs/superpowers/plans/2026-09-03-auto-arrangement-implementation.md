# Auto-Arrangement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the interactive Auto-Arrange flow described in
`docs/superpowers/specs/2026-09-03-auto-arrangement-design.md`: confirm each stem's role, build
an extended arrangement step-by-step with weighted enter/exit/fill suggestions, then commit the
result to the timeline using only existing reducer actions.

**Architecture:** Pure logic (density/fill scoring, role resolution, the candidate-weighting
engine, and the moves-to-actions translator) lives in `src/shared/`, each with real vitest
coverage. Three new components in `src/renderer/src/components/` provide the role-confirmation
list, the step-by-step build UI, and a top-level wizard that orchestrates both and dispatches the
final actions — following the exact modal-mounting pattern already used by
`TidyUpNudgeModal.tsx`/`UnsavedChangesDialog.tsx` (plain boolean-gated conditional render from
`App.tsx`, no portal/provider machinery).

**Tech Stack:** TypeScript, React, vitest, this codebase's existing `stemFeaturesCache`/
`stemFeatures` DSP analysis and `busOf`/`ASSIGN_TO_BUS` clustering ("Tidy Up") output.

---

## Working branch

Everything in this plan happens directly on the already-checked-out `auto-arrangement-exploration`
branch (plain branch, not a worktree — created directly per Elling's request before brainstorming
started). Do not create a new worktree or a second branch.

## File Structure

```
src/shared/
  stemDensityScore.ts       (new) density/fill scoring from StemFeatures
  stemDensityScore.test.ts  (new)
  stemRole.ts                (new) role resolution (SoundType + BusId + uncertainty)
  stemRole.test.ts           (new)
  autoArrangeEngine.ts        (new) weighted candidate engine + build-state advance
  autoArrangeEngine.test.ts   (new)
  autoArrangeApply.ts         (new) moves -> dispatchable actions translator
  autoArrangeApply.test.ts    (new)

src/renderer/src/components/
  AutoArrangeRoleStep.tsx    (new) role confirmation list UI
  AutoArrangeBuildStep.tsx   (new) step-by-step build UI
  AutoArrangeWizard.tsx      (new) orchestrator, mounted from App.tsx

src/renderer/src/App.tsx     (modify) mount AutoArrangeWizard + trigger button
```

---

## Task 1: Density and fill scoring

**Files:**
- Create: `src/shared/stemDensityScore.ts`
- Test: `src/shared/stemDensityScore.test.ts`

`StemFeatures.transientDensity` (`src/shared/stemFeatures.ts`) is an **unbounded rate**
(attacks/sec — real busy percussive material scores 3+, confirmed by
`src/shared/typeGuess.test.ts:52` asserting `transientDensity > 3` for a 4-hits/sec impulse
train), despite its docstring's "roughly 0-1" claim. `bassEnergyRatio` and `zcrBrightness` are
genuinely bounded to `[0,1]` already (confirmed against their real computations in
`src/shared/typeGuess.ts:36-40` and `src/shared/visuals.ts:154-171`). `transientDensity` must be
saturated into `[0,1)` before combining with the other two, or it silently dominates/crushes the
score.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/shared/stemDensityScore.test.ts
import { describe, expect, it } from 'vitest'
import { computeDensityScore, computeFillScore, densityLabel } from './stemDensityScore'
import type { StemFeatures } from './stemFeatures'

function features(overrides: Partial<StemFeatures>): StemFeatures {
  return {
    transientDensity: 0,
    bassEnergyRatio: 0,
    spectralCentroidHz: 1000,
    zcrBrightness: 0,
    voicedFraction: 0,
    pitchVarianceCents: 0,
    mfcc: new Array(13).fill(0),
    ...overrides
  }
}

describe('computeDensityScore', () => {
  it('scores silence/no-transients material near zero', () => {
    const score = computeDensityScore(features({ transientDensity: 0, bassEnergyRatio: 0 }))
    expect(score).toBeCloseTo(0, 5)
  })

  it('saturates high transient density instead of exceeding 1', () => {
    const busy = computeDensityScore(features({ transientDensity: 20, bassEnergyRatio: 1 }))
    expect(busy).toBeGreaterThan(0)
    expect(busy).toBeLessThanOrEqual(1)
  })

  it('weights transient density more than bass energy ratio', () => {
    const transientHeavy = computeDensityScore(features({ transientDensity: 8, bassEnergyRatio: 0 }))
    const bassHeavy = computeDensityScore(features({ transientDensity: 0, bassEnergyRatio: 1 }))
    expect(transientHeavy).toBeGreaterThan(bassHeavy)
  })

  it('4 attacks/sec (the half-saturation point) scores around the midpoint of the transient term', () => {
    // normalizeTransientDensity(4) === 0.5 exactly, weighted 0.7 in the total score
    const score = computeDensityScore(features({ transientDensity: 4, bassEnergyRatio: 0 }))
    expect(score).toBeCloseTo(0.5 * 0.7, 5)
  })
})

describe('densityLabel', () => {
  it('labels below 0.33 as sparse', () => {
    expect(densityLabel(0)).toBe('sparse')
    expect(densityLabel(0.32)).toBe('sparse')
  })

  it('labels 0.33 to 0.66 as steady', () => {
    expect(densityLabel(0.33)).toBe('steady')
    expect(densityLabel(0.65)).toBe('steady')
  })

  it('labels 0.66 and above as dense', () => {
    expect(densityLabel(0.66)).toBe('dense')
    expect(densityLabel(1)).toBe('dense')
  })
})

describe('computeFillScore', () => {
  it('favors bright, transient-dense material over sustained low material', () => {
    const percussive = computeFillScore(features({ zcrBrightness: 0.9, transientDensity: 10 }))
    const pad = computeFillScore(features({ zcrBrightness: 0.1, transientDensity: 0.2 }))
    expect(percussive).toBeGreaterThan(pad)
  })

  it('stays within [0,1]', () => {
    const score = computeFillScore(features({ zcrBrightness: 1, transientDensity: 100 }))
    expect(score).toBeLessThanOrEqual(1)
    expect(score).toBeGreaterThanOrEqual(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/shared/stemDensityScore.test.ts`
Expected: FAIL — `stemDensityScore.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

```typescript
// src/shared/stemDensityScore.ts
import type { StemFeatures } from './stemFeatures'

export type DensityLabel = 'sparse' | 'steady' | 'dense'

// transientDensity is an unbounded rate (attacks/sec, real busy material scores 3+ --
// see typeGuess.test.ts), unlike bassEnergyRatio/zcrBrightness which are genuinely
// bounded [0,1] already. x / (x + HALF_SATURATION) saturates it into [0,1) without a
// hard ceiling that would just flatten every busy stem to the same score.
// HALF_SATURATION = 4 means 4 attacks/sec (a moderately busy stem) maps to 0.5.
const TRANSIENT_HALF_SATURATION = 4

function normalizeTransientDensity(attacksPerSec: number): number {
  return attacksPerSec / (attacksPerSec + TRANSIENT_HALF_SATURATION)
}

export function computeDensityScore(features: StemFeatures): number {
  const transient = normalizeTransientDensity(features.transientDensity)
  return transient * 0.7 + features.bassEnergyRatio * 0.3
}

export function densityLabel(score: number): DensityLabel {
  if (score < 0.33) return 'sparse'
  if (score < 0.66) return 'steady'
  return 'dense'
}

// Fills want crisp, transient, bright material (percussion hits, one-shots) --
// not sustained pads/bass, which is what computeDensityScore favors instead.
export function computeFillScore(features: StemFeatures): number {
  const transient = normalizeTransientDensity(features.transientDensity)
  return features.zcrBrightness * 0.5 + transient * 0.5
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/shared/stemDensityScore.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add src/shared/stemDensityScore.ts src/shared/stemDensityScore.test.ts
git commit -m "feat: add stem density/fill scoring for auto-arrangement"
```

---

## Task 2: Role resolution

**Files:**
- Create: `src/shared/stemRole.ts`
- Test: `src/shared/stemRole.test.ts`

Combines the two real, independent classification signals already in this codebase —
`Stem.type: SoundType` (semantic, Endlesss-metadata-driven when reliable) and
`state.busOf[stemKey]: BusId` (DSP-clustering-driven, from Tidy Up; `null`/absent means "never
tidied" — this is the established idiom per `TidyUpNudgeModal.tsx`'s own doc comment) — into one
record the role-confirmation UI can display and let the user adjust.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/shared/stemRole.test.ts
import { describe, expect, it } from 'vitest'
import { resolveStemRole } from './stemRole'
import type { Stem } from './types'

function stem(overrides: Partial<Stem>): Stem {
  return {
    slot: 0,
    author: 'test',
    name: 'test stem',
    type: 'fx',
    path: '/tmp/test.wav',
    durationSec: 4,
    barLength: 4,
    ...overrides
  }
}

describe('resolveStemRole', () => {
  it('is not uncertain when soundType is a real, non-default classification', () => {
    const role = resolveStemRole(stem({ type: 'drums' }), 'g1:0', null)
    expect(role.uncertain).toBe(false)
    expect(role.soundType).toBe('drums')
  })

  it('is not uncertain when busOf has a real assignment, even if soundType is the fx default', () => {
    const role = resolveStemRole(stem({ type: 'fx' }), 'g1:0', 'bass')
    expect(role.uncertain).toBe(false)
    expect(role.busId).toBe('bass')
  })

  it('is uncertain when soundType is still the fx default AND there is no bus assignment', () => {
    const role = resolveStemRole(stem({ type: 'fx' }), 'g1:0', null)
    expect(role.uncertain).toBe(true)
  })

  it('defaults included to true', () => {
    const role = resolveStemRole(stem({ type: 'drums' }), 'g1:0', null)
    expect(role.included).toBe(true)
  })

  it('carries the stemKey through unchanged', () => {
    const role = resolveStemRole(stem({}), 'g1:3', null)
    expect(role.stemKey).toBe('g1:3')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/shared/stemRole.test.ts`
Expected: FAIL — `stemRole.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

```typescript
// src/shared/stemRole.ts
import type { BusId, SoundType, Stem } from './types'

export interface StemRoleInfo {
  stemKey: string
  soundType: SoundType
  busId: BusId | null
  // True only when NEITHER signal has a real classification: soundType is still
  // the unresolved 'fx' default AND this stem has never been through Tidy Up
  // (busOf has no entry for it). The role-confirmation UI must flag this rather
  // than silently trust it, per the design spec.
  uncertain: boolean
  included: boolean
}

export function resolveStemRole(stem: Stem, stemKey: string, busId: BusId | null): StemRoleInfo {
  const uncertain = stem.type === 'fx' && busId === null
  return {
    stemKey,
    soundType: stem.type,
    busId,
    uncertain,
    included: true
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/shared/stemRole.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/shared/stemRole.ts src/shared/stemRole.test.ts
git commit -m "feat: add stem role resolution combining soundType and bus assignment"
```

---

## Task 3: Weighted candidate engine

**Files:**
- Create: `src/shared/autoArrangeEngine.ts`
- Test: `src/shared/autoArrangeEngine.test.ts`

The algorithmic core from the spec's "Interactive build" section: at each step, generate weighted
Enter/Exit/Fill candidates from the current build state, using density rank, role diversity, and
a peak-then-decline shape bias. Two phases: **building** (peak not yet reached — only
enter/fill candidates) and **releasing** (peak reached — only exit/fill candidates). Peak is
reached once at least 75% of included stems are active. The arrangement is complete once no
stems remain active (a natural return to silence — the spec's "outro" condition).

- [ ] **Step 1: Write the failing tests**

```typescript
// src/shared/autoArrangeEngine.test.ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/shared/autoArrangeEngine.test.ts`
Expected: FAIL — `autoArrangeEngine.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

```typescript
// src/shared/autoArrangeEngine.ts

export type ArrangeMoveType = 'enter' | 'exit' | 'fill'

export interface ArrangeStemInput {
  stemKey: string
  // Opaque grouping key for role diversity -- a BusId or SoundType string,
  // whichever StemRoleInfo resolved. The engine only compares equality, it
  // doesn't need to know the concrete type.
  role: string
  densityScore: number // 0..1, from computeDensityScore
  fillScore: number // 0..1, from computeFillScore
  included: boolean
}

export interface ArrangeBuildState {
  activeStemKeys: string[]
  peakReached: boolean
}

export interface ArrangeCandidate {
  stemKey: string
  moveType: ArrangeMoveType
  weight: number
  reason: string
}

// Once at least this fraction of included stems are active, the arrangement
// switches from building (enter/fill only) to releasing (exit/fill only).
const PEAK_ACTIVE_FRACTION = 0.75

function includedStems(stems: ArrangeStemInput[]): ArrangeStemInput[] {
  return stems.filter((s) => s.included)
}

function roleDiversityBonus(role: string, activeStemKeys: string[], stems: ArrangeStemInput[]): number {
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
  buildState: ArrangeBuildState
): ArrangeCandidate[] {
  const candidateStems = includedStems(stems)
  const candidates: ArrangeCandidate[] = []

  if (!buildState.peakReached) {
    for (const stem of candidateStems) {
      if (buildState.activeStemKeys.includes(stem.stemKey)) continue
      const diversity = roleDiversityBonus(stem.role, buildState.activeStemKeys, stems)
      candidates.push({
        stemKey: stem.stemKey,
        moveType: 'enter',
        weight: (1 - stem.densityScore) * 0.6 + diversity * 0.4,
        reason:
          diversity > 0.5
            ? 'sparse and a role not yet represented'
            : 'sparse -- good early/building material'
      })
    }
  } else {
    for (const stem of candidateStems) {
      if (!buildState.activeStemKeys.includes(stem.stemKey)) continue
      candidates.push({
        stemKey: stem.stemKey,
        moveType: 'exit',
        weight: stem.densityScore,
        reason: 'dense -- good candidate to thin out first'
      })
    }
  }

  const fill = bestFillCandidate(candidateStems, buildState.activeStemKeys)
  if (fill) candidates.push(fill)

  return candidates
}

export function advanceBuildState(
  buildState: ArrangeBuildState,
  stems: ArrangeStemInput[],
  chosen: ArrangeCandidate
): ArrangeBuildState {
  let activeStemKeys = buildState.activeStemKeys
  if (chosen.moveType === 'enter') {
    activeStemKeys = [...activeStemKeys, chosen.stemKey]
  } else if (chosen.moveType === 'exit') {
    activeStemKeys = activeStemKeys.filter((k) => k !== chosen.stemKey)
  }
  // 'fill' does not change the persistent active set -- it's a brief blip,
  // handled entirely at the apply-to-timeline stage (Task 4).

  const total = includedStems(stems).length
  const peakReached =
    buildState.peakReached || (total > 0 && activeStemKeys.length / total >= PEAK_ACTIVE_FRACTION)

  return { activeStemKeys, peakReached }
}

export function isArrangementComplete(buildState: ArrangeBuildState): boolean {
  return buildState.peakReached && buildState.activeStemKeys.length === 0
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/shared/autoArrangeEngine.test.ts`
Expected: PASS (16 tests)

- [ ] **Step 5: Commit**

```bash
git add src/shared/autoArrangeEngine.ts src/shared/autoArrangeEngine.test.ts
git commit -m "feat: add weighted candidate engine for interactive arrangement building"
```

---

## Task 4: Moves-to-actions translator

**Files:**
- Create: `src/shared/autoArrangeApply.ts`
- Test: `src/shared/autoArrangeApply.test.ts`

Translates a finalized sequence of `{stepIndex, stemKey, moveType}` records into the three real
existing reducer actions (`PLACE_ON_TIMELINE`, `SET_PLAYED_BARS`, `ADD_MUTE_REGION`), whose exact
shapes are confirmed against the live `src/renderer/src/state/store.ts`:

```typescript
| { type: 'PLACE_ON_TIMELINE'; groupId: string; startBar: number }
| { type: 'SET_PLAYED_BARS'; key: string; bars: number }
| { type: 'ADD_MUTE_REGION'; stemKeys: string[]; startBar: number; endBar: number }
```

For each stem, walk its moves in step order to build its active bar ranges (enter = active from
that step's start bar onward until the next exit; exit = inactive from that step's start bar
onward until the next enter; fill = active for just the last `ARRANGE_FILL_BARS` bars of that
step, regardless of surrounding enter/exit state), then emit `ADD_MUTE_REGION` for the complement
(the inactive ranges) — since a stem is muted everywhere except when explicitly active.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/shared/autoArrangeApply.test.ts
import { describe, expect, it } from 'vitest'
import { ARRANGE_FILL_BARS, ARRANGE_STEP_BARS, buildArrangeActions, type ArrangeMoveRecord } from './autoArrangeApply'

describe('buildArrangeActions', () => {
  it('places the rifff at the current playhead when not already placed', () => {
    const actions = buildArrangeActions('g1', [], 1, false, 10)
    expect(actions).toContainEqual({ type: 'PLACE_ON_TIMELINE', groupId: 'g1', startBar: 10 })
  })

  it('does not place the rifff when already placed', () => {
    const actions = buildArrangeActions('g1', [], 1, true, 10)
    expect(actions.find((a) => a.type === 'PLACE_ON_TIMELINE')).toBeUndefined()
  })

  it('sets playedBars to totalSteps * ARRANGE_STEP_BARS for every stem with at least one move', () => {
    const moves: ArrangeMoveRecord[] = [{ stepIndex: 0, stemKey: 'g1:0', moveType: 'enter' }]
    const actions = buildArrangeActions('g1', moves, 3, true, 0)
    expect(actions).toContainEqual({
      type: 'SET_PLAYED_BARS',
      key: 'g1:0',
      bars: 3 * ARRANGE_STEP_BARS
    })
  })

  it('a stem that only ever exits (never enters) is muted for the whole arrangement', () => {
    const moves: ArrangeMoveRecord[] = [{ stepIndex: 0, stemKey: 'g1:0', moveType: 'exit' }]
    const actions = buildArrangeActions('g1', moves, 2, true, 0)
    const muteRegions = actions.filter((a) => a.type === 'ADD_MUTE_REGION')
    expect(muteRegions).toContainEqual({
      type: 'ADD_MUTE_REGION',
      stemKeys: ['g1:0'],
      startBar: 0,
      endBar: 2 * ARRANGE_STEP_BARS
    })
  })

  it('a stem entering at step 1 is muted before that and active after', () => {
    const moves: ArrangeMoveRecord[] = [{ stepIndex: 1, stemKey: 'g1:0', moveType: 'enter' }]
    const actions = buildArrangeActions('g1', moves, 3, true, 0)
    const muteRegions = actions.filter((a) => a.type === 'ADD_MUTE_REGION')
    expect(muteRegions).toContainEqual({
      type: 'ADD_MUTE_REGION',
      stemKeys: ['g1:0'],
      startBar: 0,
      endBar: 1 * ARRANGE_STEP_BARS
    })
    // no mute region should cover any part of bars [8, 24) since it's active there
    expect(
      muteRegions.some((r) => r.type === 'ADD_MUTE_REGION' && r.startBar < 3 * ARRANGE_STEP_BARS && r.endBar > 1 * ARRANGE_STEP_BARS)
    ).toBe(false)
  })

  it('a stem entering then exiting produces two mute regions around the active window', () => {
    const moves: ArrangeMoveRecord[] = [
      { stepIndex: 1, stemKey: 'g1:0', moveType: 'enter' },
      { stepIndex: 2, stemKey: 'g1:0', moveType: 'exit' }
    ]
    const actions = buildArrangeActions('g1', moves, 4, true, 0)
    const muteRegions = actions.filter((a) => a.type === 'ADD_MUTE_REGION')
    expect(muteRegions).toContainEqual({
      type: 'ADD_MUTE_REGION',
      stemKeys: ['g1:0'],
      startBar: 0,
      endBar: 1 * ARRANGE_STEP_BARS
    })
    expect(muteRegions).toContainEqual({
      type: 'ADD_MUTE_REGION',
      stemKeys: ['g1:0'],
      startBar: 2 * ARRANGE_STEP_BARS,
      endBar: 4 * ARRANGE_STEP_BARS
    })
  })

  it('a fill at step 0 is active only for the last ARRANGE_FILL_BARS bars of that step', () => {
    const moves: ArrangeMoveRecord[] = [{ stepIndex: 0, stemKey: 'g1:0', moveType: 'fill' }]
    const actions = buildArrangeActions('g1', moves, 2, true, 0)
    const muteRegions = actions.filter((a) => a.type === 'ADD_MUTE_REGION')
    const fillActiveStart = ARRANGE_STEP_BARS - ARRANGE_FILL_BARS
    expect(muteRegions).toContainEqual({
      type: 'ADD_MUTE_REGION',
      stemKeys: ['g1:0'],
      startBar: 0,
      endBar: fillActiveStart
    })
    expect(muteRegions).toContainEqual({
      type: 'ADD_MUTE_REGION',
      stemKeys: ['g1:0'],
      startBar: ARRANGE_STEP_BARS,
      endBar: 2 * ARRANGE_STEP_BARS
    })
  })

  it('a stem with no moves at all is left alone entirely (no playedBars/mute actions for it)', () => {
    const moves: ArrangeMoveRecord[] = [{ stepIndex: 0, stemKey: 'g1:0', moveType: 'enter' }]
    const actions = buildArrangeActions('g1', moves, 2, true, 0)
    expect(actions.some((a) => a.type === 'SET_PLAYED_BARS' && a.key === 'g1:1')).toBe(false)
    expect(actions.some((a) => a.type === 'ADD_MUTE_REGION' && a.stemKeys.includes('g1:1'))).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/shared/autoArrangeApply.test.ts`
Expected: FAIL — `autoArrangeApply.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

```typescript
// src/shared/autoArrangeApply.ts
import type { ArrangeMoveType } from './autoArrangeEngine'

export const ARRANGE_STEP_BARS = 8
export const ARRANGE_FILL_BARS = 2

export interface ArrangeMoveRecord {
  stepIndex: number
  stemKey: string
  moveType: ArrangeMoveType
}

export type ArrangeAction =
  | { type: 'PLACE_ON_TIMELINE'; groupId: string; startBar: number }
  | { type: 'SET_PLAYED_BARS'; key: string; bars: number }
  | { type: 'ADD_MUTE_REGION'; stemKeys: string[]; startBar: number; endBar: number }

interface BarRange {
  startBar: number
  endBar: number
}

// Active windows for one stem, built by walking its moves in step order.
// Enter/exit set the PERSISTENT state from that step's start bar onward;
// fill is a one-off blip confined to the last ARRANGE_FILL_BARS bars of its
// own step, independent of the surrounding persistent state.
function activeRangesForStem(moves: ArrangeMoveRecord[], totalBars: number): BarRange[] {
  const sorted = [...moves].sort((a, b) => a.stepIndex - b.stepIndex)
  const ranges: BarRange[] = []
  let activeFrom: number | null = null

  for (const move of sorted) {
    const stepStartBar = move.stepIndex * ARRANGE_STEP_BARS
    if (move.moveType === 'enter') {
      if (activeFrom === null) activeFrom = stepStartBar
    } else if (move.moveType === 'exit') {
      if (activeFrom !== null) {
        ranges.push({ startBar: activeFrom, endBar: stepStartBar })
        activeFrom = null
      }
    } else {
      // fill
      const fillStart = stepStartBar + ARRANGE_STEP_BARS - ARRANGE_FILL_BARS
      const fillEnd = stepStartBar + ARRANGE_STEP_BARS
      ranges.push({ startBar: fillStart, endBar: fillEnd })
    }
  }

  if (activeFrom !== null) {
    ranges.push({ startBar: activeFrom, endBar: totalBars })
  }

  return mergeOverlapping(ranges)
}

function mergeOverlapping(ranges: BarRange[]): BarRange[] {
  const sorted = [...ranges].sort((a, b) => a.startBar - b.startBar)
  const merged: BarRange[] = []
  for (const r of sorted) {
    const last = merged[merged.length - 1]
    if (last && r.startBar <= last.endBar) {
      last.endBar = Math.max(last.endBar, r.endBar)
    } else {
      merged.push({ ...r })
    }
  }
  return merged
}

// The complement of a stem's active ranges within [0, totalBars) -- these
// become its ADD_MUTE_REGION spans, since a stem is muted everywhere except
// when explicitly active.
function inactiveRangesFrom(activeRanges: BarRange[], totalBars: number): BarRange[] {
  const inactive: BarRange[] = []
  let cursor = 0
  for (const r of activeRanges) {
    if (r.startBar > cursor) inactive.push({ startBar: cursor, endBar: r.startBar })
    cursor = Math.max(cursor, r.endBar)
  }
  if (cursor < totalBars) inactive.push({ startBar: cursor, endBar: totalBars })
  return inactive
}

export function buildArrangeActions(
  groupId: string,
  moves: ArrangeMoveRecord[],
  totalSteps: number,
  alreadyPlaced: boolean,
  playheadBar: number
): ArrangeAction[] {
  const actions: ArrangeAction[] = []
  const totalBars = totalSteps * ARRANGE_STEP_BARS

  if (!alreadyPlaced) {
    actions.push({ type: 'PLACE_ON_TIMELINE', groupId, startBar: playheadBar })
  }

  const stemKeys = [...new Set(moves.map((m) => m.stemKey))]
  for (const stemKey of stemKeys) {
    actions.push({ type: 'SET_PLAYED_BARS', key: stemKey, bars: totalBars })

    const stemMoves = moves.filter((m) => m.stemKey === stemKey)
    const activeRanges = activeRangesForStem(stemMoves, totalBars)
    const inactiveRanges = inactiveRangesFrom(activeRanges, totalBars)
    for (const range of inactiveRanges) {
      actions.push({
        type: 'ADD_MUTE_REGION',
        stemKeys: [stemKey],
        startBar: range.startBar,
        endBar: range.endBar
      })
    }
  }

  return actions
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/shared/autoArrangeApply.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/shared/autoArrangeApply.ts src/shared/autoArrangeApply.test.ts
git commit -m "feat: add moves-to-timeline-actions translator for auto-arrangement"
```

---

## Task 5: Role confirmation UI

**Files:**
- Create: `src/renderer/src/components/AutoArrangeRoleStep.tsx`

Styled after `TidyUpNudgeModal.tsx`'s real conventions (confirmed from the live file): explicit
inline styles throughout (this app's buttons/inputs have no usable default browser chrome),
`--ra-*` CSS custom properties for color, `borderRadius: 0` everywhere, lowercase copy, no
emoji/exclamation marks, `.ra-eyebrow` class for section labels.

- [ ] **Step 1: Locate the real props/hooks surface this component needs**

Run: `grep -n "useAppSelector\|useDispatch" src/renderer/src/components/ClusterStemsBrowser.tsx | head -5`

Confirm the exact import path for `useAppSelector`/`useDispatch` from `../state/StoreContext`
before writing the component (this plan assumes `../state/StoreContext` based on
`ClusterStemsBrowser.tsx`'s real usage — verify it matches before proceeding).

- [ ] **Step 2: Write the component**

```typescript
// src/renderer/src/components/AutoArrangeRoleStep.tsx
import { useMemo, useState } from 'react'
import { useAppSelector } from '../state/StoreContext'
import { computeDensityScore, densityLabel } from '@shared/stemDensityScore'
import { resolveStemRole, type StemRoleInfo } from '@shared/stemRole'
import { getStemFeatures } from '../audio/stemFeaturesCache'
import { stemKey as buildStemKey, type SoundType } from '@shared/types'

interface Props {
  groupId: string
  onConfirm: (roles: StemRoleInfo[]) => void
  onCancel: () => void
}

const SOUND_TYPE_OPTIONS: SoundType[] = [
  'drums',
  'notes',
  'bass',
  'extInst',
  'sampler',
  'fx',
  'extFx',
  'audioIn'
]

export function AutoArrangeRoleStep({ groupId, onConfirm, onCancel }: Props): JSX.Element {
  const rifff = useAppSelector((s) => s.rifffs[groupId])
  const busOf = useAppSelector((s) => s.busOf)

  const [roles, setRoles] = useState<StemRoleInfo[] | null>(null)
  const [densities, setDensities] = useState<Record<string, number>>({})

  useMemo(() => {
    let cancelled = false
    async function load(): Promise<void> {
      const resolved: StemRoleInfo[] = []
      const densityByKey: Record<string, number> = {}
      for (const stem of rifff.stems) {
        const key = buildStemKey(groupId, stem.slot)
        resolved.push(resolveStemRole(stem, key, busOf[key] ?? null))
        const features = await getStemFeatures(stem.path)
        densityByKey[key] = computeDensityScore(features)
      }
      if (!cancelled) {
        setRoles(resolved)
        setDensities(densityByKey)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [groupId, rifff, busOf])

  if (!roles) {
    return <div style={{ padding: 20, color: 'var(--ra-text-2)' }}>analyzing stems...</div>
  }

  function updateRole(stemKey: string, patch: Partial<StemRoleInfo>): void {
    setRoles((prev) => prev!.map((r) => (r.stemKey === stemKey ? { ...r, ...patch } : r)))
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <div
        style={{
          background: 'var(--ra-bg-bar)',
          border: '1px solid var(--ra-border-strong)',
          borderRadius: 0,
          padding: 20,
          width: 480,
          maxHeight: '80vh',
          overflowY: 'auto'
        }}
      >
        <div className="ra-eyebrow" style={{ marginBottom: 12 }}>
          confirm stem roles
        </div>
        {roles.map((role) => (
          <div
            key={role.stemKey}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '6px 0',
              borderBottom: '1px solid var(--ra-border-soft)'
            }}
          >
            <input
              type="checkbox"
              checked={role.included}
              onChange={(e) => updateRole(role.stemKey, { included: e.target.checked })}
            />
            <select
              value={role.soundType}
              onChange={(e) => updateRole(role.stemKey, { soundType: e.target.value as SoundType })}
              style={{
                height: 22,
                borderRadius: 0,
                fontSize: 10,
                border: '1px solid var(--ra-border)',
                background: 'var(--ra-bg-row-active)',
                color: 'var(--ra-text)'
              }}
            >
              {SOUND_TYPE_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <span style={{ fontSize: 10, color: 'var(--ra-text-3)' }}>
              {densityLabel(densities[role.stemKey] ?? 0)}
            </span>
            {role.uncertain && (
              <span style={{ fontSize: 10, color: 'var(--ra-mute-on)' }}>uncertain</span>
            )}
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button
            onClick={onCancel}
            style={{
              height: 22,
              borderRadius: 0,
              fontSize: 10,
              border: '1px solid var(--ra-border)',
              background: 'var(--ra-bg-row-active)',
              color: 'var(--ra-text-2)'
            }}
          >
            cancel
          </button>
          <button
            onClick={() => onConfirm(roles)}
            style={{
              height: 22,
              borderRadius: 0,
              fontSize: 10,
              border: '1px solid var(--ra-border-strong)',
              background: 'var(--ra-bg-row-active)',
              color: 'var(--ra-text)'
            }}
          >
            continue
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Verify it typechecks**

Run: `npm run typecheck`
Expected: PASS, no new errors from this file. If `useAppSelector`'s real generic signature or
`getStemFeatures`'s real return shape differs from what Step 1 confirmed, fix this file to match
the real signatures before proceeding — do not adjust the already-tested `src/shared/` modules to
fit a wrong assumption here.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/AutoArrangeRoleStep.tsx
git commit -m "feat: add role confirmation step UI for auto-arrangement"
```

---

## Task 6: Interactive build step UI

**Files:**
- Create: `src/renderer/src/components/AutoArrangeBuildStep.tsx`

Drives `computeCandidates`/`advanceBuildState`/`isArrangementComplete` from Task 3, presenting
the top 3 weighted candidates at each step for the user to pick from, accumulating the chosen
moves, and calling back once `isArrangementComplete` is true or the user manually ends it.

- [ ] **Step 1: Write the component**

```typescript
// src/renderer/src/components/AutoArrangeBuildStep.tsx
import { useState } from 'react'
import {
  advanceBuildState,
  computeCandidates,
  isArrangementComplete,
  type ArrangeBuildState,
  type ArrangeCandidate,
  type ArrangeStemInput
} from '@shared/autoArrangeEngine'
import type { ArrangeMoveRecord } from '@shared/autoArrangeApply'

interface Props {
  stems: ArrangeStemInput[]
  onComplete: (moves: ArrangeMoveRecord[], totalSteps: number) => void
  onCancel: () => void
}

const MAX_CANDIDATES_SHOWN = 3
// Safety cap so a pathological weighting (or a single included stem that can
// never trigger the 75% peak threshold) can't loop forever.
const MAX_STEPS = 64

export function AutoArrangeBuildStep({ stems, onComplete, onCancel }: Props): JSX.Element {
  const [stepIndex, setStepIndex] = useState(0)
  const [buildState, setBuildState] = useState<ArrangeBuildState>({
    activeStemKeys: [],
    peakReached: false
  })
  const [moves, setMoves] = useState<ArrangeMoveRecord[]>([])

  const candidates = computeCandidates(stems, buildState)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, MAX_CANDIDATES_SHOWN)

  const includedCount = stems.filter((s) => s.included).length
  const tooFewStems = includedCount < 2

  function pick(candidate: ArrangeCandidate): void {
    const nextMoves = [...moves, { stepIndex, stemKey: candidate.stemKey, moveType: candidate.moveType }]
    const nextState = advanceBuildState(buildState, stems, candidate)
    setMoves(nextMoves)
    setBuildState(nextState)

    if (isArrangementComplete(nextState) || stepIndex + 1 >= MAX_STEPS) {
      onComplete(nextMoves, stepIndex + 1)
      return
    }
    setStepIndex(stepIndex + 1)
  }

  function finishNow(): void {
    onComplete(moves, stepIndex + 1)
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <div
        style={{
          background: 'var(--ra-bg-bar)',
          border: '1px solid var(--ra-border-strong)',
          borderRadius: 0,
          padding: 20,
          width: 420
        }}
      >
        <div className="ra-eyebrow" style={{ marginBottom: 12 }}>
          step {stepIndex + 1} -- {buildState.activeStemKeys.length} active
        </div>
        {tooFewStems && (
          <div style={{ fontSize: 11, color: 'var(--ra-text-2)', marginBottom: 10 }}>
            only {includedCount} stem{includedCount === 1 ? '' : 's'} included -- not enough
            material for a real build/breakdown arc, this will be a trivial arrangement.
          </div>
        )}
        {candidates.length === 0 ? (
          <div style={{ fontSize: 11, color: 'var(--ra-text-2)' }}>no candidates -- finish below</div>
        ) : (
          candidates.map((c) => (
            <button
              key={`${c.stemKey}-${c.moveType}`}
              onClick={() => pick(c)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                marginBottom: 6,
                padding: '6px 8px',
                borderRadius: 0,
                fontSize: 11,
                border: '1px solid var(--ra-border)',
                background: 'var(--ra-bg-row-active)',
                color: 'var(--ra-text)'
              }}
            >
              {c.moveType} {c.stemKey} -- {c.reason}
            </button>
          ))
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button
            onClick={onCancel}
            style={{
              height: 22,
              borderRadius: 0,
              fontSize: 10,
              border: '1px solid var(--ra-border)',
              background: 'var(--ra-bg-row-active)',
              color: 'var(--ra-text-2)'
            }}
          >
            cancel
          </button>
          <button
            onClick={finishNow}
            style={{
              height: 22,
              borderRadius: 0,
              fontSize: 10,
              border: '1px solid var(--ra-border-strong)',
              background: 'var(--ra-bg-row-active)',
              color: 'var(--ra-text)'
            }}
          >
            finish now
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npm run typecheck`
Expected: PASS, no new errors from this file.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/AutoArrangeBuildStep.tsx
git commit -m "feat: add interactive step-by-step build UI for auto-arrangement"
```

---

## Task 7: Wizard orchestrator (role -> build -> apply, with re-run warning)

**Files:**
- Create: `src/renderer/src/components/AutoArrangeWizard.tsx`

Orchestrates Tasks 5 and 6, then applies the result via `buildArrangeActions` from Task 4. Before
applying, checks whether any target stem already has mute regions or an extended `playedBars`
(the re-run case from the spec) and shows a one-time warning naming how many existing mute
regions would be affected, per Elling's explicit choice — never silently clears, never silently
layers.

- [ ] **Step 1: Locate the real dispatch/state hooks and playhead selector**

Run: `grep -n "usePos\|useDispatch" src/renderer/src/components/ClusterStemsBrowser.tsx`

Confirm `usePos`'s real return shape (used for the playhead bar passed to `buildArrangeActions`)
before writing this component.

- [ ] **Step 2: Write the component**

```typescript
// src/renderer/src/components/AutoArrangeWizard.tsx
import { useState } from 'react'
import { useAppSelector, useDispatch, usePos } from '../state/StoreContext'
import { computeDensityScore, computeFillScore } from '@shared/stemDensityScore'
import { getStemFeatures } from '../audio/stemFeaturesCache'
import type { StemRoleInfo } from '@shared/stemRole'
import type { ArrangeStemInput } from '@shared/autoArrangeEngine'
import type { ArrangeMoveRecord } from '@shared/autoArrangeApply'
import { buildArrangeActions } from '@shared/autoArrangeApply'
import { AutoArrangeRoleStep } from './AutoArrangeRoleStep'
import { AutoArrangeBuildStep } from './AutoArrangeBuildStep'

interface Props {
  groupId: string
  onClose: () => void
}

type WizardStep =
  | { phase: 'role' }
  | { phase: 'build'; stems: ArrangeStemInput[] }
  | { phase: 'confirm-rerun'; pendingMoves: ArrangeMoveRecord[]; totalSteps: number; existingRegionCount: number }

export function AutoArrangeWizard({ groupId, onClose }: Props): JSX.Element {
  const dispatch = useDispatch()
  const muteRegions = useAppSelector((s) => s.muteRegions)
  const startBar = useAppSelector((s) => s.rifffs[groupId]?.startBar)
  const pos = usePos()

  const [step, setStep] = useState<WizardStep>({ phase: 'role' })

  async function handleRoleConfirm(roles: StemRoleInfo[]): Promise<void> {
    const included = roles.filter((r) => r.included)
    const stems: ArrangeStemInput[] = []
    for (const role of included) {
      // stem path isn't on StemRoleInfo -- look it up via groupId/stemKey through
      // the rifff's own stem list at the call site if getStemFeatures needs a
      // path rather than a stemKey. Verify getStemFeatures' real signature
      // (Task 5, Step 1) before assuming this call shape; adjust if it takes a
      // path instead of a stemKey.
      const features = await getStemFeatures(role.stemKey)
      stems.push({
        stemKey: role.stemKey,
        role: role.busId ?? role.soundType,
        densityScore: computeDensityScore(features),
        fillScore: computeFillScore(features),
        included: true
      })
    }
    setStep({ phase: 'build', stems })
  }

  function handleBuildComplete(moves: ArrangeMoveRecord[], totalSteps: number): void {
    const existingRegionCount = moves.reduce((count, m) => count + (muteRegions[m.stemKey]?.length ?? 0), 0)
    if (existingRegionCount > 0) {
      setStep({ phase: 'confirm-rerun', pendingMoves: moves, totalSteps, existingRegionCount })
      return
    }
    apply(moves, totalSteps)
  }

  function apply(moves: ArrangeMoveRecord[], totalSteps: number): void {
    const actions = buildArrangeActions(groupId, moves, totalSteps, startBar !== undefined, pos.bar)
    for (const action of actions) {
      dispatch(action)
    }
    onClose()
  }

  if (step.phase === 'role') {
    return <AutoArrangeRoleStep groupId={groupId} onConfirm={handleRoleConfirm} onCancel={onClose} />
  }

  if (step.phase === 'build') {
    return <AutoArrangeBuildStep stems={step.stems} onComplete={handleBuildComplete} onCancel={onClose} />
  }

  // confirm-rerun
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <div
        style={{
          background: 'var(--ra-bg-bar)',
          border: '1px solid var(--ra-border-strong)',
          borderRadius: 0,
          padding: 20,
          width: 360
        }}
      >
        <div style={{ fontSize: 11, color: 'var(--ra-text)', marginBottom: 16 }}>
          this will replace {step.existingRegionCount} existing mute region
          {step.existingRegionCount === 1 ? '' : 's'} on these stems.
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            onClick={onClose}
            style={{
              height: 22,
              borderRadius: 0,
              fontSize: 10,
              border: '1px solid var(--ra-border)',
              background: 'var(--ra-bg-row-active)',
              color: 'var(--ra-text-2)'
            }}
          >
            cancel
          </button>
          <button
            onClick={() => apply(step.pendingMoves, step.totalSteps)}
            style={{
              height: 22,
              borderRadius: 0,
              fontSize: 10,
              border: '1px solid var(--ra-border-strong)',
              background: 'var(--ra-bg-row-active)',
              color: 'var(--ra-text)'
            }}
          >
            replace and apply
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Verify getStemFeatures' real argument type and usePos'/useDispatch's real shapes**

Run: `grep -n "export function getStemFeatures\|export function usePos\|export function useDispatch" src/renderer/src/audio/stemFeaturesCache.ts src/renderer/src/state/StoreContext.tsx`

Fix any mismatch in `AutoArrangeWizard.tsx` between what this grep shows and what Step 2's code
assumed (particularly: does `getStemFeatures` take a stem's file path, in which case this
component needs the rifff's stem list to resolve `role.stemKey` back to a `path`, not just the
stemKey string) before proceeding.

- [ ] **Step 4: Verify it typechecks**

Run: `npm run typecheck`
Expected: PASS, no new errors from this file.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/AutoArrangeWizard.tsx
git commit -m "feat: add auto-arrangement wizard orchestrator with re-run warning"
```

---

## Task 8: Wire the trigger into the existing UI

**Files:**
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Locate the real Tidy Up trigger button and its mounting pattern**

Run: `grep -n "ClusterStemsBrowser\|onOpenClusterStems\|TidyUp" src/renderer/src/App.tsx`

This shows exactly how the existing Tidy button's open-state and conditional-render are wired
today (the "top row, open next to new" button from recent history) — mirror that exact pattern
for Auto-Arrange's own open-state and button, rather than inventing a new mounting convention.

- [ ] **Step 2: Add the wizard's open state and conditional mount**

Using the real pattern found in Step 1, add (adapting variable names to match what's actually
there):

```typescript
const [autoArrangeGroupId, setAutoArrangeGroupId] = useState<string | null>(null)
```

and, alongside the existing modal conditional renders (near `TidyUpNudgeModal`/
`UnsavedChangesDialog`'s own mount points found in Step 1):

```typescript
{autoArrangeGroupId && (
  <AutoArrangeWizard
    groupId={autoArrangeGroupId}
    onClose={() => setAutoArrangeGroupId(null)}
  />
)}
```

Add the import:

```typescript
import { AutoArrangeWizard } from './components/AutoArrangeWizard'
```

- [ ] **Step 3: Add a trigger button next to the existing Tidy button**

Using the exact button styling/placement found in Step 1's grep (match its real inline styles —
do not invent new ones), add a button that calls `setAutoArrangeGroupId(groupId)` for the
currently-relevant rifff, labeled `auto-arrange` (lowercase, no exclamation mark, per this app's
copy voice).

- [ ] **Step 4: Verify it typechecks and lints**

Run: `npm run typecheck && npm run lint`
Expected: PASS, no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/App.tsx
git commit -m "feat: wire auto-arrange trigger button into the main UI"
```

---

## Task 9: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS — all new `src/shared/` tests plus every pre-existing test, no regressions.

- [ ] **Step 2: Run typecheck and lint across the whole project**

Run: `npm run typecheck && npm run lint`
Expected: PASS, no errors.

- [ ] **Step 3: Document the required manual walkthrough**

This cannot be completed by an agent — this environment has no GUI/audio interaction tooling, and
whether a generated arrangement actually sounds musically good is a judgment call, not something
verifiable by typecheck/lint/vitest. Before considering this feature done, Elling needs to:

1. Import a real 8-stem Endlesss loop.
2. Run Auto-Arrange: confirm stem roles (including on at least one stem that lands in the
   "uncertain" state, to verify that flagging works), step through several build/fill/exit moves,
   and let it reach a natural finish (or use "finish now").
3. Listen to the result — check that section builds feel reasonable, fills land where expected,
   and mute-region transitions are click-free (per the existing automatic 3ms declick).
4. Re-run Auto-Arrange on the same rifff and confirm the "this will replace N existing mute
   regions" warning appears and works correctly in both the cancel and replace-and-apply paths.

- [ ] **Step 4: Commit anything from the walkthrough that needs fixing, otherwise done**

If the walkthrough surfaces issues, fix them as normal commits on this branch and re-verify.
Otherwise, this plan is complete — move to `superpowers:finishing-a-development-branch` for the
branch itself.
