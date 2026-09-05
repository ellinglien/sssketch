# Draw Arrangement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A second, direct way to build an arrangement from every stem currently placed on the
timeline — draw directly on a fixed grid which stem is active in which section, instead of
stepping through Auto-Arrange's weighted candidates.

**Architecture:** A new `DrawArrangeWizard.tsx` orchestrates a reused `AutoArrangeRoleStep.tsx`
(extended with two small optional props) → a new `DrawArrangeGridStep.tsx` (a fixed
`DRAW_ARRANGE_SECTIONS`-column paint/erase grid) → the exact same, completely unmodified
`buildArrangeReplaceActions` Auto-Arrange itself already uses. A new pure function converts the
drawn grid into the same `ArrangeMoveRecord[]` shape the weighted engine already produces, so the
whole apply-to-timeline layer needs zero changes.

**Tech Stack:** TypeScript, React, Vitest (TDD for the one new `src/shared/` pure function),
Electron renderer.

---

## Spec

Read `docs/superpowers/specs/2026-09-05-draw-arrangement-design.md` in full before starting. One
deliberate refinement made during planning, not present in the spec's own literal text: the spec's
`AutoArrangeRoleStep.tsx` prop was named `onSkip?: () => void`, with its *presence* (not actually
calling it) controlling whether a skip button renders, and that button's own `onClick` calling
`onConfirm(roles)` directly. That's a confusing shape for a prop typed as a callback that's never
actually invoked as one. This plan renames it to `skippable?: boolean` — an honest boolean flag —
with identical behavior (skip button renders when `true`, its `onClick` calls `onConfirm(roles)`).
Every task below uses `skippable`, not `onSkip`.

## Files

- Modify: `src/shared/autoArrangeApply.ts` — `AUTO_ARRANGE_MAX_BARS` (moved in from `App.tsx`),
  `DRAW_ARRANGE_SECTIONS`, `movesFromDrawnGrid`.
- Modify: `src/shared/autoArrangeApply.test.ts` — tests for `movesFromDrawnGrid`.
- Modify: `src/renderer/src/components/AutoArrangeRoleStep.tsx` — `showFrequency`/`skippable` props.
- Create: `src/renderer/src/components/autoArrangeLabels.ts` — `ROLE_LABELS`/`stemLabelsByKey`,
  extracted out of `AutoArrangeBuildStep.tsx` so both that component and the new
  `DrawArrangeWizard.tsx` can share them (a component file can't also export a plain function/const
  — react-refresh's `only-export-components` lint rule forbids it, same reason
  `autoArrangeStyles.ts` already exists as its own file).
- Modify: `src/renderer/src/components/AutoArrangeBuildStep.tsx` — import
  `ROLE_LABELS`/`stemLabelsByKey` instead of defining them locally; no behavior change.
- Create: `src/renderer/src/components/DrawArrangeGridStep.tsx` — the paint/erase grid.
- Create: `src/renderer/src/components/DrawArrangeWizard.tsx` — orchestrates role step → grid step
  → dispatch.
- Modify: `src/renderer/src/App.tsx` — `AUTO_ARRANGE_MAX_BARS` import (not local const), new
  `"draw arrangement"` gear-menu item, new `drawArrangeOpen` state + conditional mount.

---

### Task 1: Share `AUTO_ARRANGE_MAX_BARS`

**Files:**
- Modify: `src/shared/autoArrangeApply.ts`
- Modify: `src/renderer/src/App.tsx`

No test file — this is a pure constant move, no new logic to test.

- [ ] **Step 1: Add the shared constant**

Modify `src/shared/autoArrangeApply.ts`. Immediately after the existing
`ARRANGE_FILL_BARS >= ARRANGE_STEP_BARS` validation block (the `if (...) { throw new Error(...) }`
that currently ends right before `export interface ArrangeMoveRecord`), insert:

```typescript
// The auto-arrange gear-menu trigger's own eligibility cap (App.tsx) -- also
// shared by Draw Arrangement (DRAW_ARRANGE_SECTIONS below) so both features
// stay tied to one real limit rather than two independently-tunable numbers
// that could silently drift apart. Raised from an original 32 (2026-09) --
// real use hit that immediately, a plain 32-bar rifff already sat right at
// the old limit.
export const AUTO_ARRANGE_MAX_BARS = 64
```

- [ ] **Step 2: Point `App.tsx` at the shared constant instead of its own local one**

Modify `src/renderer/src/App.tsx`. Find the existing import block's `@shared/` imports (e.g. the
line `import { buildPluginStatesMap } from '@shared/pluginStates'`) and add, alongside it:

```typescript
import { AUTO_ARRANGE_MAX_BARS } from '@shared/autoArrangeApply'
```

Then replace:

```typescript
  // Auto-arrange pools every stem from every rifff placed on the timeline
  // (usePlacedFlatStems.ts) -- per Elling, only offered for "relatively
  // short arrangements", guarded here at 64 bars of real timeline span
  // (raised from an original 32, which real use hit immediately -- a plain
  // 32-bar rifff already sat right at that old limit) rather than left to
  // open a wizard that's unusable/misleading on a large project.
  // placedTimelineSpanBars (not loopLengthBars) specifically because
  // loopLengthBars falls back to a 32-bar *default* when nothing is placed
  // at all -- using that here would silently treat an empty timeline as
  // "right at the limit" for the wrong reason. Nothing placed (span 0) is
  // also disabled: there's nothing to arrange, and disabling here beats
  // opening a wizard just to show its own "no rifffs on the timeline yet"
  // empty state.
  const AUTO_ARRANGE_MAX_BARS = 64
  const autoArrangeSpanBars = placedTimelineSpanBars(state)
```

with:

```typescript
  // Auto-arrange (and Draw Arrangement, DrawArrangeWizard.tsx) pool every
  // stem from every rifff placed on the timeline (usePlacedFlatStems.ts) --
  // per Elling, only offered for "relatively short arrangements", guarded
  // here at AUTO_ARRANGE_MAX_BARS (shared/autoArrangeApply.ts) bars of real
  // timeline span rather than left to open a wizard that's
  // unusable/misleading on a large project. placedTimelineSpanBars (not
  // loopLengthBars) specifically because loopLengthBars falls back to a
  // 32-bar *default* when nothing is placed at all -- using that here would
  // silently treat an empty timeline as "right at the limit" for the wrong
  // reason. Nothing placed (span 0) is also disabled: there's nothing to
  // arrange, and disabling here beats opening a wizard just to show its own
  // "no rifffs on the timeline yet" empty state.
  const autoArrangeSpanBars = placedTimelineSpanBars(state)
```

- [ ] **Step 3: Confirm no other reference to the old local constant remains**

Run: `grep -n "const AUTO_ARRANGE_MAX_BARS" src/renderer/src/App.tsx`
Expected: no output (the only declaration now lives in `src/shared/autoArrangeApply.ts`).

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: clean, 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/shared/autoArrangeApply.ts src/renderer/src/App.tsx
git commit -m "Share AUTO_ARRANGE_MAX_BARS so Draw Arrangement can reuse it

Moved out of App.tsx's own component function into shared/autoArrangeApply.ts
alongside ARRANGE_STEP_BARS -- Draw Arrangement's own DRAW_ARRANGE_SECTIONS
(next commit) needs to derive from the exact same cap Auto-Arrange's gear-menu
eligibility check already uses, not a second, independently-drifting number.
Pure move, no behavior change to today's auto-arrange gating."
```

---

### Task 2: `DRAW_ARRANGE_SECTIONS` + `movesFromDrawnGrid`

**Files:**
- Modify: `src/shared/autoArrangeApply.ts`
- Test: `src/shared/autoArrangeApply.test.ts`

- [ ] **Step 1: Write the failing tests**

Modify `src/shared/autoArrangeApply.test.ts`. Add `movesFromDrawnGrid` to the existing import list
(currently `ARRANGE_FILL_BARS, ARRANGE_STEP_BARS, activeRangesForStem, activeStemKeysPerStep,
groupIdFromStemKey, type ArrangeMoveRecord`):

```typescript
import {
  ARRANGE_FILL_BARS,
  ARRANGE_STEP_BARS,
  activeRangesForStem,
  activeStemKeysPerStep,
  groupIdFromStemKey,
  movesFromDrawnGrid,
  type ArrangeMoveRecord
} from './autoArrangeApply'
```

Append a new `describe` block at the end of the file:

```typescript
describe('movesFromDrawnGrid', () => {
  it('returns an empty array for an empty grid', () => {
    expect(movesFromDrawnGrid({})).toEqual([])
  })

  it('returns an empty array for a stem with every section false', () => {
    expect(movesFromDrawnGrid({ a: [false, false, false] })).toEqual([])
  })

  it('a stem active from section 0 with no exit produces one enter, no exit', () => {
    const moves = movesFromDrawnGrid({ a: [true, true, true] })
    expect(moves).toEqual<ArrangeMoveRecord[]>([{ stepIndex: 0, stemKey: 'a', moveType: 'enter' }])
  })

  it('a stem that only becomes active partway through produces an enter at that section, not section 0', () => {
    const moves = movesFromDrawnGrid({ a: [false, false, true, true] })
    expect(moves).toEqual<ArrangeMoveRecord[]>([{ stepIndex: 2, stemKey: 'a', moveType: 'enter' }])
  })

  it('a stem active then inactive produces a matching enter and exit', () => {
    const moves = movesFromDrawnGrid({ a: [true, true, false, false] })
    expect(moves).toEqual<ArrangeMoveRecord[]>([
      { stepIndex: 0, stemKey: 'a', moveType: 'enter' },
      { stepIndex: 2, stemKey: 'a', moveType: 'exit' }
    ])
  })

  it('on/off/on-again produces two enters and one exit at the correct indices', () => {
    const moves = movesFromDrawnGrid({ a: [true, false, true] })
    expect(moves).toEqual<ArrangeMoveRecord[]>([
      { stepIndex: 0, stemKey: 'a', moveType: 'enter' },
      { stepIndex: 1, stemKey: 'a', moveType: 'exit' },
      { stepIndex: 2, stemKey: 'a', moveType: 'enter' }
    ])
  })

  it('multiple stems moves interleave in the grids own key order', () => {
    const moves = movesFromDrawnGrid({ a: [true, false], b: [false, true] })
    expect(moves).toEqual<ArrangeMoveRecord[]>([
      { stepIndex: 0, stemKey: 'a', moveType: 'enter' },
      { stepIndex: 1, stemKey: 'a', moveType: 'exit' },
      { stepIndex: 1, stemKey: 'b', moveType: 'enter' }
    ])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/shared/autoArrangeApply.test.ts`
Expected: FAIL — `movesFromDrawnGrid is not a function` (or a TypeScript import error).

- [ ] **Step 3: Implement `movesFromDrawnGrid`**

Modify `src/shared/autoArrangeApply.ts`. Add this exported function after `activeStemKeysPerStep`
(before the private `mergeOverlapping`):

```typescript
// Fixed section count for Draw Arrangement's own grid (DrawArrangeGridStep.tsx)
// -- derived from AUTO_ARRANGE_MAX_BARS/ARRANGE_STEP_BARS, never a hardcoded
// literal, so it can never silently drift from either. Currently 64/4 = 16.
export const DRAW_ARRANGE_SECTIONS = AUTO_ARRANGE_MAX_BARS / ARRANGE_STEP_BARS

// The inverse of activeStemKeysPerStep -- turns a directly-drawn grid (one
// boolean array per stemKey, section-by-section "is this stem active here")
// into the same ArrangeMoveRecord[] shape the weighted-candidate engine
// already produces, so buildArrangeReplaceActions (state/selectors.ts) needs
// ZERO changes to consume either source. Emits an 'enter' on every
// false->true transition and an 'exit' on every true->false transition,
// walking each stem's own row in section order.
export function movesFromDrawnGrid(grid: Record<string, boolean[]>): ArrangeMoveRecord[] {
  const moves: ArrangeMoveRecord[] = []
  for (const [stemKey, cells] of Object.entries(grid)) {
    let wasActive = false
    for (let stepIndex = 0; stepIndex < cells.length; stepIndex++) {
      const isActive = cells[stepIndex]
      if (isActive && !wasActive) {
        moves.push({ stepIndex, stemKey, moveType: 'enter' })
      } else if (!isActive && wasActive) {
        moves.push({ stepIndex, stemKey, moveType: 'exit' })
      }
      wasActive = isActive
    }
  }
  return moves
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/shared/autoArrangeApply.test.ts`
Expected: PASS, all tests green.

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add src/shared/autoArrangeApply.ts src/shared/autoArrangeApply.test.ts
git commit -m "Add DRAW_ARRANGE_SECTIONS and movesFromDrawnGrid

DRAW_ARRANGE_SECTIONS derives from AUTO_ARRANGE_MAX_BARS/ARRANGE_STEP_BARS
(currently 16) rather than a hardcoded literal. movesFromDrawnGrid is the
inverse of activeStemKeysPerStep -- converts Draw Arrangement's own drawn
grid into the same ArrangeMoveRecord[] shape the weighted-candidate engine
already produces, so buildArrangeReplaceActions needs no changes to consume
either source. TDD, 7 tests covering the empty/no-exit/mid-start/on-off/
on-off-on/multi-stem cases."
```

---

### Task 3: Extend `AutoArrangeRoleStep.tsx` with `showFrequency`/`skippable`

**Files:**
- Modify: `src/renderer/src/components/AutoArrangeRoleStep.tsx`

No test file — this codebase's established convention (root `CLAUDE.md`'s Testing conventions) is
typecheck+lint verification plus a real manual walkthrough for React components.

- [ ] **Step 1: Extend `Props` and the function signature**

Modify `src/renderer/src/components/AutoArrangeRoleStep.tsx:20-23`, replacing:

```typescript
interface Props {
  onConfirm: (roles: StemRoleInfo[]) => void
  onCancel: () => void
}
```

with:

```typescript
interface Props {
  onConfirm: (roles: StemRoleInfo[]) => void
  onCancel: () => void
  // Both optional -- omitting either preserves Auto-Arrange's own existing
  // behavior unchanged (frequency shown, no skip button). Draw Arrangement
  // (DrawArrangeWizard.tsx) is the only current caller passing either.
  showFrequency?: boolean
  // Renders a "skip" button (alongside cancel/continue) that calls
  // onConfirm(roles) directly, using whatever roles are currently resolved
  // (the auto-seeded defaults, un-reviewed) -- this is what makes the step
  // "skippable". A plain boolean, not a callback: nothing about "skipping"
  // needs its own distinct behavior beyond confirming with current values,
  // so there's nothing for a callback prop here to actually do beyond signal
  // whether the button should render.
  skippable?: boolean
}
```

Modify `src/renderer/src/components/AutoArrangeRoleStep.tsx:95`, replacing:

```typescript
export function AutoArrangeRoleStep({ onConfirm, onCancel }: Props): React.JSX.Element {
```

with:

```typescript
export function AutoArrangeRoleStep({
  onConfirm,
  onCancel,
  showFrequency = true,
  skippable = false
}: Props): React.JSX.Element {
```

- [ ] **Step 2: Hide the frequency row when `showFrequency` is false**

Modify `src/renderer/src/components/AutoArrangeRoleStep.tsx:549-578`, replacing:

```tsx
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                  title="how often this stem should re-enter during the release phase, and its priority relative to other stems"
                >
                  <input
                    className="arrange-frequency-slider"
                    type="range"
                    min={0}
                    max={FREQUENCY_LEVELS.length - 1}
                    step={1}
                    value={FREQUENCY_LEVELS.indexOf(role.frequency)}
                    onChange={(e) =>
                      updateRole(role.stemKey, {
                        frequency: FREQUENCY_LEVELS[Number(e.target.value)]
                      })
                    }
                    style={{
                      background: `linear-gradient(to right, var(--ra-stretch-on) ${
                        (FREQUENCY_LEVELS.indexOf(role.frequency) / (FREQUENCY_LEVELS.length - 1)) *
                        100
                      }%, var(--ra-border) ${
                        (FREQUENCY_LEVELS.indexOf(role.frequency) / (FREQUENCY_LEVELS.length - 1)) *
                        100
                      }%)`
                    }}
                  />
                  <span style={{ fontSize: 10, color: 'var(--ra-text-2)', minWidth: 62 }}>
                    {FREQUENCY_LABELS[role.frequency]}
                  </span>
                </div>
```

with:

```tsx
                {showFrequency && (
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                    title="how often this stem should re-enter during the release phase, and its priority relative to other stems"
                  >
                    <input
                      className="arrange-frequency-slider"
                      type="range"
                      min={0}
                      max={FREQUENCY_LEVELS.length - 1}
                      step={1}
                      value={FREQUENCY_LEVELS.indexOf(role.frequency)}
                      onChange={(e) =>
                        updateRole(role.stemKey, {
                          frequency: FREQUENCY_LEVELS[Number(e.target.value)]
                        })
                      }
                      style={{
                        background: `linear-gradient(to right, var(--ra-stretch-on) ${
                          (FREQUENCY_LEVELS.indexOf(role.frequency) /
                            (FREQUENCY_LEVELS.length - 1)) *
                          100
                        }%, var(--ra-border) ${
                          (FREQUENCY_LEVELS.indexOf(role.frequency) /
                            (FREQUENCY_LEVELS.length - 1)) *
                          100
                        }%)`
                      }}
                    />
                    <span style={{ fontSize: 10, color: 'var(--ra-text-2)', minWidth: 62 }}>
                      {FREQUENCY_LABELS[role.frequency]}
                    </span>
                  </div>
                )}
```

- [ ] **Step 3: Add the "skip" button**

Modify `src/renderer/src/components/AutoArrangeRoleStep.tsx:597-611` (the bottom button row's
opening and "cancel" button), replacing:

```tsx
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button
            onClick={onCancel}
            style={{
              height: 22,
              borderRadius: 0,
              padding: '0 10px',
              fontSize: 10,
              border: '1px solid var(--ra-border)',
              background: 'var(--ra-bg-row-active)',
              color: 'var(--ra-text-2)'
            }}
          >
            cancel
          </button>
```

with:

```tsx
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button
            onClick={onCancel}
            style={{
              height: 22,
              borderRadius: 0,
              padding: '0 10px',
              fontSize: 10,
              border: '1px solid var(--ra-border)',
              background: 'var(--ra-bg-row-active)',
              color: 'var(--ra-text-2)'
            }}
          >
            cancel
          </button>
          {skippable && (
            <button
              onClick={() => onConfirm(roles)}
              title="skip reviewing roles -- continue with the current auto-seeded values as-is"
              style={{
                height: 22,
                borderRadius: 0,
                padding: '0 10px',
                fontSize: 10,
                border: '1px solid var(--ra-border)',
                background: 'var(--ra-bg-row-active)',
                color: 'var(--ra-text-2)'
              }}
            >
              skip
            </button>
          )}
```

(the existing "continue" button right after this is unchanged)

- [ ] **Step 4: Confirm Auto-Arrange's own call site is unaffected**

Run: `grep -n "AutoArrangeRoleStep" src/renderer/src/components/AutoArrangeWizard.tsx`
Expected: `<AutoArrangeRoleStep onConfirm={handleRoleConfirm} onCancel={onClose} />` — neither new
prop present, confirming Auto-Arrange's own behavior (frequency shown, no skip button) is
unchanged. Do NOT modify `AutoArrangeWizard.tsx` in this task.

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/AutoArrangeRoleStep.tsx
git commit -m "Extend AutoArrangeRoleStep with showFrequency/skippable for Draw Arrangement

Both optional, both default to preserving Auto-Arrange's own existing
behavior exactly (frequency shown, no skip button) -- Draw Arrangement
(not yet wired in) will be the only caller passing either. showFrequency
hides the frequency slider row entirely, since re-entry cooldown/weighting
is a suggestion-engine-only concept with no meaning when the user is
directly drawing every entrance themselves. skippable renders a 'skip'
button whose onClick calls onConfirm(roles) directly using whatever roles
are currently resolved."
```

---

### Task 4: Extract `autoArrangeLabels.ts`

**Files:**
- Create: `src/renderer/src/components/autoArrangeLabels.ts`
- Modify: `src/renderer/src/components/AutoArrangeBuildStep.tsx`

No test file — this codebase's established convention treats React-adjacent display helpers like
this the same as the components they serve (typecheck+lint verified); the underlying algorithm
itself has no behavior change from this extraction (pure move, not a rewrite).

- [ ] **Step 1: Create the new shared file**

Create `src/renderer/src/components/autoArrangeLabels.ts`:

```typescript
// Shared label helpers for the auto-arrange/draw-arrangement wizards' own
// stem-labeling needs (AutoArrangeBuildStep.tsx, DrawArrangeWizard.tsx).
// Pulled out to its own non-component file because react-refresh's
// only-export-components lint rule forbids a component file from also
// exporting a plain function/const -- same pattern as autoArrangeStyles.ts.

// Stem names in real Endlesss material are frequently unintelligible
// (auto-generated/generic) and can't be relied on to identify a candidate --
// the stem's own arrangeRole (already user-confirmed in the role-confirm
// step) is a far more useful label here. Mirrors the friendly-label intent
// of AutoArrangeRoleStep.tsx's role dropdown, kept local there since that
// component shows the raw camelCase value in its own <option>s today.
// Includes DrumSubRole's own values (kick/snare/hihat/clap/perc) alongside
// the 8 ArrangeRole values -- engineRoleFor (shared/stemRole.ts) substitutes
// a drum sub-role in for the plain 'drums' bucket before either caller's
// engine-facing/label-facing code sees it, so `role` here (an opaque string
// as far as either caller's concerned) can genuinely be either.
export const ROLE_LABELS: Record<string, string> = {
  drums: 'drums',
  bass: 'bass',
  lead: 'lead',
  backing: 'backing',
  aux: 'aux',
  textureFx: 'texture/fx',
  fill: 'fill',
  vocal: 'vocal',
  kick: 'kick',
  snare: 'snare',
  hihat: 'hi-hat',
  clap: 'clap',
  perc: 'perc / other'
}

// Disambiguating label per stem (e.g. "drums 2" when 3 stems all share the
// "drums" role) -- shared by AutoArrangeBuildStep.tsx's build-progress grid
// and candidate/apply labels, and DrawArrangeWizard.tsx's own grid row
// labels, so the same stem reads as the same number everywhere rather than
// each caller computing its own (possibly different) numbering. Per Elling:
// a bare "bring in drums" is ambiguous whenever more than one drums stem is
// in play.
export function stemLabelsByKey(
  stems: Array<{ stemKey: string; role: string; included: boolean }>
): Map<string, string> {
  const included = stems.filter((s) => s.included)
  const totalByLabel = new Map<string, number>()
  for (const s of included) {
    const label = ROLE_LABELS[s.role] ?? s.role
    totalByLabel.set(label, (totalByLabel.get(label) ?? 0) + 1)
  }
  const seen = new Map<string, number>()
  const byKey = new Map<string, string>()
  for (const s of included) {
    const label = ROLE_LABELS[s.role] ?? s.role
    const total = totalByLabel.get(label) ?? 1
    if (total <= 1) {
      byKey.set(s.stemKey, label)
      continue
    }
    const index = (seen.get(label) ?? 0) + 1
    seen.set(label, index)
    byKey.set(s.stemKey, `${label} ${index}`)
  }
  return byKey
}
```

- [ ] **Step 2: Remove the local `ROLE_LABELS` from `AutoArrangeBuildStep.tsx` and import it instead**

Modify `src/renderer/src/components/AutoArrangeBuildStep.tsx:47-72`, deleting entirely (the whole
comment block and the `ROLE_LABELS` const it documents):

```typescript
// Stem names in real Endlesss material are frequently unintelligible
// (auto-generated/generic) and can't be relied on to identify a candidate --
// the stem's own arrangeRole (already user-confirmed in the previous wizard
// step) is a far more useful label here. Mirrors the friendly-label intent
// of AutoArrangeRoleStep.tsx's role dropdown, kept local since that
// component shows the raw camelCase value in its own <option>s today.
// Includes DrumSubRole's own values (kick/snare/hihat/clap/perc) alongside
// the 8 ArrangeRole values -- engineRoleFor (shared/stemRole.ts) substitutes
// a drum sub-role in for the plain 'drums' bucket before this ever reaches
// the engine, so `role` here (ArrangeStemInput.role, an opaque string as
// far as the engine's concerned) can genuinely be either.
const ROLE_LABELS: Record<string, string> = {
  drums: 'drums',
  bass: 'bass',
  lead: 'lead',
  backing: 'backing',
  aux: 'aux',
  textureFx: 'texture/fx',
  fill: 'fill',
  vocal: 'vocal',
  kick: 'kick',
  snare: 'snare',
  hihat: 'hi-hat',
  clap: 'clap',
  perc: 'perc / other'
}

```

(leave the blank line and the `PHASE_LABELS` const that follows it untouched)

Add the import — modify `src/renderer/src/components/AutoArrangeBuildStep.tsx:22-25`, after the
existing `import { useAppSelector, ... } from '../state/StoreContext'` line, adding:

```typescript
import { ROLE_LABELS, stemLabelsByKey } from './autoArrangeLabels'
```

- [ ] **Step 3: Replace the local `stemLabelByKey` computation with a call to the shared function**

Modify `src/renderer/src/components/AutoArrangeBuildStep.tsx:244-272`, replacing:

```typescript
  // Disambiguating label per stem (e.g. "drums 2" when 3 stems all share the
  // "drums" role) -- computed ONCE here and shared by the candidate list's
  // move labels, the apply button's own label, and the build-progress grid
  // (gridStems below), so the same stem always reads as the same number
  // everywhere rather than each computing its own (possibly different)
  // numbering. Per Elling: a bare "bring in drums" is ambiguous whenever
  // more than one drums stem is in play.
  const stemLabelByKey = (() => {
    const included = stems.filter((s) => s.included)
    const totalByLabel = new Map<string, number>()
    for (const s of included) {
      const label = ROLE_LABELS[s.role] ?? s.role
      totalByLabel.set(label, (totalByLabel.get(label) ?? 0) + 1)
    }
    const seen = new Map<string, number>()
    const byKey = new Map<string, string>()
    for (const s of included) {
      const label = ROLE_LABELS[s.role] ?? s.role
      const total = totalByLabel.get(label) ?? 1
      if (total <= 1) {
        byKey.set(s.stemKey, label)
        continue
      }
      const index = (seen.get(label) ?? 0) + 1
      seen.set(label, index)
      byKey.set(s.stemKey, `${label} ${index}`)
    }
    return byKey
  })()
```

with:

```typescript
  // Disambiguating label per stem (e.g. "drums 2" when 3 stems all share the
  // "drums" role) -- shared with DrawArrangeWizard.tsx via autoArrangeLabels.ts
  // (stemLabelsByKey's own doc comment), so the same stem reads as the same
  // number everywhere rather than each caller computing its own (possibly
  // different) numbering.
  const stemLabelByKey = stemLabelsByKey(stems)
```

- [ ] **Step 4: Confirm no other reference to the removed local `ROLE_LABELS` remains broken**

Run: `grep -n "ROLE_LABELS" src/renderer/src/components/AutoArrangeBuildStep.tsx`
Expected: two matches — the import line added in Step 2, and one prose comment ("matches
MOVE_LABELS/ROLE_LABELS's own convention") a few lines above the `PHASE_LABELS` const. That prose
comment is fine as-is (still true, just no longer a locally-defined symbol) — do not modify it.

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: both clean.

- [ ] **Step 6: Run the full test suite**

Run: `npx vitest run`
Expected: no regressions — this is a pure refactor of already-untested React-adjacent display
logic, so no test count change is expected either.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/autoArrangeLabels.ts src/renderer/src/components/AutoArrangeBuildStep.tsx
git commit -m "Extract ROLE_LABELS/stemLabelsByKey into a shared autoArrangeLabels.ts

Pure extraction, no behavior change -- AutoArrangeBuildStep.tsx's own
candidate/apply/grid labels are unaffected. Needed as its own non-component
file (react-refresh's only-export-components rule forbids a component file
from also exporting a plain function/const, same reason autoArrangeStyles.ts
already exists) so the not-yet-created DrawArrangeWizard.tsx can share the
exact same disambiguation logic instead of reimplementing it."
```

---

### Task 5: `DrawArrangeGridStep.tsx`

**Files:**
- Create: `src/renderer/src/components/DrawArrangeGridStep.tsx`

No test file — this codebase's established convention (root `CLAUDE.md`'s Testing conventions) is
typecheck+lint verification plus a real manual walkthrough for React components, and the drag-paint
gesture specifically has zero possible automated coverage in this environment.

- [ ] **Step 1: Create the component**

Create `src/renderer/src/components/DrawArrangeGridStep.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { DRAW_ARRANGE_SECTIONS, movesFromDrawnGrid } from '@shared/autoArrangeApply'
import type { ArrangeMoveRecord } from '@shared/autoArrangeApply'

export interface DrawArrangeStemInput {
  stemKey: string
  label: string
  typeColor: string
}

interface Props {
  stems: DrawArrangeStemInput[]
  onApply: (moves: ArrangeMoveRecord[], totalSteps: number) => void
  onCancel: () => void
}

type DrawMode = 'draw' | 'erase'

function initialGrid(stems: DrawArrangeStemInput[]): Record<string, boolean[]> {
  const grid: Record<string, boolean[]> = {}
  for (const s of stems) grid[s.stemKey] = new Array(DRAW_ARRANGE_SECTIONS).fill(false)
  return grid
}

/** Second step of the draw-arrangement wizard (DrawArrangeWizard.tsx) -- lets
 * the user directly paint which stems are active in which section, instead
 * of stepping through Auto-Arrange's own weighted candidates. A fixed
 * DRAW_ARRANGE_SECTIONS-column grid (64 bars / ARRANGE_STEP_BARS, sharing
 * Auto-Arrange's own eligibility cap -- see shared/autoArrangeApply.ts), one
 * row per included stem. Converts the drawn grid to an ArrangeMoveRecord[]
 * via movesFromDrawnGrid on "apply arrangement" -- this component has no
 * idea buildArrangeReplaceActions (or Auto-Arrange) exists at all, it only
 * ever produces plain move records for its own caller (DrawArrangeWizard.tsx)
 * to dispatch. Styled after AutoArrangeBuildStep.tsx's own build-progress
 * grid conventions: see docs/design.md. */
export function DrawArrangeGridStep({ stems, onApply, onCancel }: Props): React.JSX.Element {
  const [grid, setGrid] = useState<Record<string, boolean[]>>(() => initialGrid(stems))
  const [mode, setMode] = useState<DrawMode>('draw')
  // Transient drag-gesture flag -- NOT React state, since a pointerenter
  // firing many times a second while dragging shouldn't itself trigger a
  // re-render; only the actual cell toggles (via setGrid) need to.
  const paintingRef = useRef(false)

  function paintCell(stemKey: string, sectionIndex: number): void {
    const value = mode === 'draw'
    setGrid((prev) => {
      if (prev[stemKey][sectionIndex] === value) return prev
      const nextRow = [...prev[stemKey]]
      nextRow[sectionIndex] = value
      return { ...prev, [stemKey]: nextRow }
    })
  }

  function handlePointerDown(stemKey: string, sectionIndex: number): void {
    paintingRef.current = true
    paintCell(stemKey, sectionIndex)
  }

  function handlePointerEnter(stemKey: string, sectionIndex: number): void {
    if (!paintingRef.current) return
    paintCell(stemKey, sectionIndex)
  }

  // Document-level, not just this grid's own onPointerUp -- the drag can end
  // (mouse released) outside the grid's own bounds, and a listener scoped
  // only to a grid element would never see that release.
  useEffect(() => {
    function handlePointerUp(): void {
      paintingRef.current = false
    }
    document.addEventListener('pointerup', handlePointerUp)
    return () => document.removeEventListener('pointerup', handlePointerUp)
  }, [])

  const hasAnyDrawn = Object.values(grid).some((row) => row.some((cell) => cell))

  function handleApply(): void {
    onApply(movesFromDrawnGrid(grid), DRAW_ARRANGE_SECTIONS)
  }

  const modeButtonStyle = (active: boolean): React.CSSProperties => ({
    height: 22,
    borderRadius: 0,
    padding: '0 10px',
    fontSize: 10,
    fontWeight: active ? 700 : 400,
    border: `1px solid ${active ? 'var(--ra-stretch-on)' : 'var(--ra-border)'}`,
    background: active ? 'var(--ra-stretch-on)' : 'var(--ra-bg-row-active)',
    color: active ? 'var(--ra-play-on-ink)' : 'var(--ra-text-2)',
    cursor: 'pointer'
  })

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
          width: 560,
          maxHeight: '80vh',
          overflowY: 'auto'
        }}
      >
        <div className="ra-eyebrow" style={{ marginBottom: 8 }}>
          draw arrangement -- {DRAW_ARRANGE_SECTIONS} sections
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button
            onClick={() => setMode('draw')}
            title="draw -- click or drag to make a section active"
            style={modeButtonStyle(mode === 'draw')}
          >
            draw
          </button>
          <button
            onClick={() => setMode('erase')}
            title="erase -- click or drag to clear a section"
            style={modeButtonStyle(mode === 'erase')}
          >
            erase
          </button>
        </div>
        <div style={{ overflowX: 'auto', marginBottom: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, width: 'fit-content' }}>
            {stems.map(({ stemKey, label, typeColor }) => (
              <div key={stemKey} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <div
                  style={{
                    width: 62,
                    flexShrink: 0,
                    fontSize: 9,
                    color: 'var(--ra-text-3)',
                    textAlign: 'right',
                    paddingRight: 4,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                  }}
                  title={label}
                >
                  {label}
                </div>
                <div style={{ display: 'flex', gap: 2 }}>
                  {grid[stemKey].map((active, sectionIndex) => (
                    <div
                      key={sectionIndex}
                      onPointerDown={() => handlePointerDown(stemKey, sectionIndex)}
                      onPointerEnter={() => handlePointerEnter(stemKey, sectionIndex)}
                      title={`section ${sectionIndex + 1}`}
                      style={{
                        width: 14,
                        height: 14,
                        flexShrink: 0,
                        cursor: 'pointer',
                        background: active ? typeColor : 'transparent',
                        border: `1px solid ${active ? 'transparent' : 'var(--ra-border)'}`
                      }}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={handleApply}
            disabled={!hasAnyDrawn}
            title={hasAnyDrawn ? 'apply this arrangement' : 'draw at least one section first'}
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
              // ContextMenu.tsx): dim to 30% opacity + not-allowed cursor.
              cursor: hasAnyDrawn ? 'pointer' : 'not-allowed',
              opacity: hasAnyDrawn ? 1 : 0.3
            }}
          >
            apply arrangement
          </button>
          <div style={{ flex: 1 }} />
          <button
            onClick={onCancel}
            style={{
              height: 22,
              borderRadius: 0,
              padding: '0 10px',
              fontSize: 10,
              border: '1px solid var(--ra-border)',
              background: 'var(--ra-bg-row-active)',
              color: 'var(--ra-text-2)'
            }}
          >
            cancel
          </button>
        </div>
      </div>
    </div>
  )
}
```

Note on the drag-paint implementation: the design spec described this in terms of a single
top-level `pointermove` handler plus either `document.elementFromPoint` or manual cell-index math
to figure out which cell the pointer is over. This implementation instead gives every cell its own
`onPointerEnter` handler, which the browser fires natively as the pointer crosses into that
element during a drag (as long as nothing calls `setPointerCapture`, which nothing here does) --
functionally identical to what the spec asked for ("apply the mode's value to whichever cell is
now under the pointer"), just without hand-rolled hit-testing. The document-level `pointerup`
listener (ending the drag even when released outside the grid) is unchanged from the spec.

- [ ] **Step 2: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: both clean.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/DrawArrangeGridStep.tsx
git commit -m "Add DrawArrangeGridStep -- the paint/erase grid

Fixed DRAW_ARRANGE_SECTIONS-column grid, one row per included stem. Click or
click-and-drag always applies the current draw/erase mode's value (not
inferred from whichever cell a drag happens to start on) -- an explicit
mode toggle per Elling's own request, matching a real paint/eraser tool's
mental model. Converts to ArrangeMoveRecord[] via movesFromDrawnGrid on
apply; not wired into anything yet (DrawArrangeWizard.tsx, next commit)."
```

---

### Task 6: `DrawArrangeWizard.tsx`

**Files:**
- Create: `src/renderer/src/components/DrawArrangeWizard.tsx`

No test file — same convention as Task 5.

- [ ] **Step 1: Create the component**

Create `src/renderer/src/components/DrawArrangeWizard.tsx`:

```tsx
import { useState } from 'react'
import { useAppState, useDispatch } from '../state/StoreContext'
import { engineRoleFor, type StemRoleInfo } from '@shared/stemRole'
import { typeColorVar } from '../theme/typeColor'
import type { ArrangeMoveRecord } from '@shared/autoArrangeApply'
import { buildArrangeReplaceActions } from '../state/selectors'
import { stemLabelsByKey } from './autoArrangeLabels'
import { AutoArrangeRoleStep } from './AutoArrangeRoleStep'
import { DrawArrangeGridStep, type DrawArrangeStemInput } from './DrawArrangeGridStep'

interface Props {
  onClose: () => void
}

type WizardStep = { phase: 'role' } | { phase: 'grid'; stems: DrawArrangeStemInput[] }

/** Orchestrates AutoArrangeRoleStep.tsx (with showFrequency={false}/
 * skippable, since re-entry weighting and a mandatory review step are both
 * suggestion-engine-only concepts that don't apply here) -> DrawArrangeGridStep.tsx
 * -> the SAME buildArrangeReplaceActions AutoArrangeWizard.tsx's own
 * handleBuildComplete already dispatches to -- this component doesn't
 * change or duplicate that function, it just calls it with a differently-
 * sourced move list. See docs/superpowers/specs/2026-09-05-draw-arrangement-design.md. */
export function DrawArrangeWizard({ onClose }: Props): React.JSX.Element {
  const dispatch = useDispatch()
  const state = useAppState()

  const [step, setStep] = useState<WizardStep>({ phase: 'role' })

  function handleRoleConfirm(roles: StemRoleInfo[]): void {
    const included = roles.filter((r) => r.included)
    const labelByKey = stemLabelsByKey(
      included.map((r) => ({ stemKey: r.stemKey, role: engineRoleFor(r), included: true }))
    )
    const stems: DrawArrangeStemInput[] = included.map((r) => ({
      stemKey: r.stemKey,
      label: labelByKey.get(r.stemKey) ?? r.arrangeRole,
      typeColor: typeColorVar(r.soundType)
    }))
    setStep({ phase: 'grid', stems })
  }

  function handleApply(moves: ArrangeMoveRecord[], totalSteps: number): void {
    const actions = buildArrangeReplaceActions(state, moves, totalSteps)
    for (const action of actions) {
      dispatch(action)
    }
    // Same reasoning as AutoArrangeWizard.tsx's own handleBuildComplete:
    // sketch mode's isSketchEligible assumptions (one shared channel, plain
    // gapless sequence) break the same way for this apply step's output --
    // several channels, independently-varying lengths -- regardless of
    // whether the moves came from the weighted engine or a drawn grid.
    dispatch({ type: 'SET_ARRANGER_MODE', mode: 'normal' })
    onClose()
  }

  if (step.phase === 'role') {
    return (
      <AutoArrangeRoleStep
        onConfirm={handleRoleConfirm}
        onCancel={onClose}
        showFrequency={false}
        skippable
      />
    )
  }

  return <DrawArrangeGridStep stems={step.stems} onApply={handleApply} onCancel={onClose} />
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: both clean.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/DrawArrangeWizard.tsx
git commit -m "Add DrawArrangeWizard -- orchestrates role step -> grid -> dispatch

Mirrors AutoArrangeWizard.tsx's own structure. Passes showFrequency={false}
and skippable to AutoArrangeRoleStep (re-entry weighting and a mandatory
review step are both suggestion-engine-only concepts). handleApply calls
the exact same buildArrangeReplaceActions + SET_ARRANGER_MODE sequence
AutoArrangeWizard.tsx's own handleBuildComplete already uses -- not
duplicated logic, the same function called with a differently-sourced move
list. Not wired into the gear menu yet (App.tsx, next commit)."
```

---

### Task 7: Wire into `App.tsx`

**Files:**
- Modify: `src/renderer/src/App.tsx`

No test file — same convention as Tasks 5-6.

- [ ] **Step 1: Import `DrawArrangeWizard`**

Modify `src/renderer/src/App.tsx`. Alongside the existing
`import { AutoArrangeWizard } from './components/AutoArrangeWizard'` line, add:

```typescript
import { DrawArrangeWizard } from './components/DrawArrangeWizard'
```

- [ ] **Step 2: Add `onOpenDrawArrange` to `ProjectMenu`'s own props**

Modify `src/renderer/src/App.tsx`'s `ProjectMenu` props interface. Immediately after the existing:

```typescript
  /** Opens AutoArrangeWizard -- project-wide, same "no groupId" shape as
   * onOpenClusterStems above, wired to setAutoArrangeOpen(true) in Frame. */
  onOpenAutoArrange: () => void
```

add:

```typescript
  /** Opens DrawArrangeWizard -- same project-wide scope as onOpenAutoArrange
   * above, wired to setDrawArrangeOpen(true) in Frame. */
  onOpenDrawArrange: () => void
```

Then modify the destructured props at `ProjectMenu`'s own function signature (find
`onOpenAutoArrange` in the destructuring, immediately after it) to also destructure
`onOpenDrawArrange`.

- [ ] **Step 3: Add the second gear-menu item**

Modify the gear-menu `items` array (currently):

```tsx
          items={[
            { label: 'tidy up', onClick: onOpenClusterStems },
            {
              label: 'auto-arrange',
              onClick: onOpenAutoArrange,
              disabled: autoArrangeDisabledReason !== undefined,
              title: autoArrangeDisabledReason
            },
            {
              label: state.tidiedView ? 'tidy view: on' : 'tidy view: off',
              onClick: () => dispatch({ type: 'TOGGLE_TIDIED_VIEW' })
            }
          ]}
```

to:

```tsx
          items={[
            { label: 'tidy up', onClick: onOpenClusterStems },
            {
              label: 'auto-arrange',
              onClick: onOpenAutoArrange,
              disabled: autoArrangeDisabledReason !== undefined,
              title: autoArrangeDisabledReason
            },
            {
              label: 'draw arrangement',
              onClick: onOpenDrawArrange,
              disabled: autoArrangeDisabledReason !== undefined,
              title: autoArrangeDisabledReason
            },
            {
              label: state.tidiedView ? 'tidy view: on' : 'tidy view: off',
              onClick: () => dispatch({ type: 'TOGGLE_TIDIED_VIEW' })
            }
          ]}
```

(reusing the exact same `autoArrangeDisabledReason` value computed once in `ProjectMenu` -- not a
second, separately-computed reason)

- [ ] **Step 4: Add `drawArrangeOpen` state in `Frame`, pass the new prop, mount the wizard**

Modify `src/renderer/src/App.tsx:1418`, replacing:

```typescript
  const [autoArrangeOpen, setAutoArrangeOpen] = useState(false)
```

with:

```typescript
  const [autoArrangeOpen, setAutoArrangeOpen] = useState(false)
  const [drawArrangeOpen, setDrawArrangeOpen] = useState(false)
```

Modify the `<ProjectMenu>` call site, replacing:

```tsx
            <ProjectMenu
              currentSketch={currentSketch}
              setCurrentSketch={setCurrentSketch}
              handleNew={handleNew}
              handleSave={handleSave}
              onOpenLibrary={openLibraryBrowser}
              onOpenClusterStems={() => setClusterStemsOpen(true)}
              onOpenAutoArrange={() => setAutoArrangeOpen(true)}
            />
```

with:

```tsx
            <ProjectMenu
              currentSketch={currentSketch}
              setCurrentSketch={setCurrentSketch}
              handleNew={handleNew}
              handleSave={handleSave}
              onOpenLibrary={openLibraryBrowser}
              onOpenClusterStems={() => setClusterStemsOpen(true)}
              onOpenAutoArrange={() => setAutoArrangeOpen(true)}
              onOpenDrawArrange={() => setDrawArrangeOpen(true)}
            />
```

Modify the conditional-mount block, replacing:

```tsx
        {autoArrangeOpen && <AutoArrangeWizard onClose={() => setAutoArrangeOpen(false)} />}
```

with:

```tsx
        {autoArrangeOpen && <AutoArrangeWizard onClose={() => setAutoArrangeOpen(false)} />}
        {drawArrangeOpen && <DrawArrangeWizard onClose={() => setDrawArrangeOpen(false)} />}
```

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/App.tsx
git commit -m "Wire DrawArrangeWizard into the gear menu

New 'draw arrangement' item next to 'auto-arrange', reusing the exact same
autoArrangeDisabledReason (same 64-bar cap, same messaging) -- not a
separately-computed duplicate. drawArrangeOpen state and conditional mount
mirror autoArrangeOpen/AutoArrangeWizard exactly."
```

---

### Task 8: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck**

Run: `npm run typecheck`
Expected: clean, 0 errors.

- [ ] **Step 2: Full lint**

Run: `npm run lint`
Expected: 0 errors (the pre-existing unrelated `scripts/generate-x64-test-config.js` prettier
warning is fine).

- [ ] **Step 3: Full test suite**

Run: `npx vitest run`
Expected: every test file passes, including `movesFromDrawnGrid`'s 7 new tests from Task 2 --
confirm the total test count increased by exactly 7 over whatever the pre-this-plan baseline was,
with zero regressions elsewhere.

- [ ] **Step 4: Repo-wide grep for scope creep**

Run: `git diff --stat master...HEAD -- src/` (or the equivalent range covering just this plan's own
commits) and confirm only the files listed in this plan's own "Files" section were touched.

- [ ] **Step 5: Note the required manual walkthrough**

This plan's UI work (Tasks 3, 5, 6, 7) is typecheck+lint-verified only, per this codebase's
established convention (root `CLAUDE.md`'s Testing conventions) -- no coding agent can click
through this UI or perform a mouse-drag gesture here. Flag to Elling, don't claim it as tested: he
needs to run the app (`npm run dev`), open "draw arrangement" from the gear menu, confirm the role
step (frequency slider hidden, skip button present and working), draw a few sections across
several stems using both click and click-and-drag in both draw and erase mode, confirm "apply
arrangement" is disabled until something's drawn, and confirm the resulting timeline clips /
channel layout look right (same trimmed-clip-replacement behavior Auto-Arrange itself already
produces, just built from a directly-drawn shape instead of a suggested one).
