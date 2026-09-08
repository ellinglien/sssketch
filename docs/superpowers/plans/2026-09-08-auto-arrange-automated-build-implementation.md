# Auto-Arrange Automated Build Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Auto-Arrange's interactive step-by-step build screen with a fully automated
build (target length + arc shape chosen upfront, applied immediately), and make undo treat a
whole arrangement apply as one checkpoint so "undo, then run again" is a real, usable way to
get a different result.

**Architecture:** A new pure `src/shared/autoArrangeAutomation.ts` module drives the existing
weighted engine (`autoArrangeEngine.ts`) and existing step-orchestration (`autoArrangeBuildStep.ts`)
in a loop instead of from click handlers, with weighted-random candidate selection instead of
always-the-top-pick. `AutoArrangeRoleStep.tsx` grows two new controls (length, shape) shared
conditionally with Draw Arrangement's own reuse of that same component. A new `BATCH`
`HistoryAction` in `history.ts` makes `historyReducer` push one undo checkpoint for an
arbitrary list of wrapped actions instead of one per action — used by both `AutoArrangeWizard.tsx`
(new) and `DrawArrangeWizard.tsx` (small change) wherever they currently loop-dispatch
`buildArrangeReplaceActions`' output.

**Tech Stack:** TypeScript, React, Vitest. No native-engine or Electron-main changes.

**One deliberate, load-bearing deviation from the design spec, flagged here so it isn't
mistaken for drift:** the spec's Non-goals section claims "No changes to
`autoArrangeEngine.ts`." That's not quite achievable — `advancePhase` reads the module-level
`PHASE_STEP_TARGETS` constant directly, not as a parameter, so there is no way to make it use
a *scaled* set of targets without touching it. Task 1 below adds a single optional parameter
(default = today's exact constant) to `advancePhase` and to `autoArrangeBuildStep.ts`'s
`advanceToNextStep` — every existing call site keeps working completely unchanged (they don't
pass the new argument), and the only new caller that ever supplies a different value is the
automated runner built in Task 6. This is the smallest change that makes the rest of the spec
possible; everything else in the spec's Non-goals section holds as written.

---

### Task 1: Parameterize `advancePhase`/`advanceToNextStep` with scalable phase targets

**Files:**
- Modify: `src/shared/autoArrangeEngine.ts`
- Modify: `src/shared/autoArrangeEngine.test.ts`
- Modify: `src/shared/autoArrangeBuildStep.ts`
- Modify: `src/shared/autoArrangeBuildStep.test.ts`

- [ ] **Step 1: Write the failing test for `advancePhase`'s new optional parameter**

Add to `src/shared/autoArrangeEngine.test.ts`, inside the existing `describe('advancePhase', ...)` block (find it — currently starts around line 329):

```typescript
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
```

- [ ] **Step 2: Run the tests to verify the first one fails**

Run: `npx vitest run src/shared/autoArrangeEngine.test.ts -t "phaseStepTargets"`
Expected: the first new test FAILs (TS error or wrong `phase`/`stepsInPhase`, since `advancePhase` doesn't accept a second argument yet); the second passes already (it's really just re-asserting current default behavior).

- [ ] **Step 3: Add the optional parameter to `advancePhase`**

In `src/shared/autoArrangeEngine.ts`, change:

```typescript
export function advancePhase(buildState: ArrangeBuildState): ArrangeBuildState {
  const nextStepsInPhase = buildState.stepsInPhase + 1
  const currentIndex = PHASE_ORDER.indexOf(buildState.phase)
  const isLastPhase = currentIndex === PHASE_ORDER.length - 1
  if (!isLastPhase && nextStepsInPhase >= PHASE_STEP_TARGETS[buildState.phase]) {
    return { ...buildState, phase: PHASE_ORDER[currentIndex + 1], stepsInPhase: 0 }
  }
  return { ...buildState, stepsInPhase: nextStepsInPhase }
}
```

to:

```typescript
// phaseStepTargets defaults to the module's own PHASE_STEP_TARGETS, so
// every existing caller keeps its exact current behavior unchanged. The
// automated build (autoArrangeAutomation.ts) is the only caller that ever
// passes a different record -- a scaled-to-fit-a-requested-length version
// of these same five numbers, computed by phaseStepTargetsForShape there.
export function advancePhase(
  buildState: ArrangeBuildState,
  phaseStepTargets: Record<ArrangePhase, number> = PHASE_STEP_TARGETS
): ArrangeBuildState {
  const nextStepsInPhase = buildState.stepsInPhase + 1
  const currentIndex = PHASE_ORDER.indexOf(buildState.phase)
  const isLastPhase = currentIndex === PHASE_ORDER.length - 1
  if (!isLastPhase && nextStepsInPhase >= phaseStepTargets[buildState.phase]) {
    return { ...buildState, phase: PHASE_ORDER[currentIndex + 1], stepsInPhase: 0 }
  }
  return { ...buildState, stepsInPhase: nextStepsInPhase }
}
```

- [ ] **Step 4: Run the tests to verify both pass**

Run: `npx vitest run src/shared/autoArrangeEngine.test.ts -t "phaseStepTargets"`
Expected: PASS (2/2)

- [ ] **Step 5: Write the failing test for `advanceToNextStep`'s new optional parameter**

Add to `src/shared/autoArrangeBuildStep.test.ts`, inside the existing `describe('advanceToNextStep', ...)` block (currently starts around line 198):

```typescript
  it('forwards a custom phaseStepTargets through to advancePhase', () => {
    const custom = { intro: 1, build: 1, peak: 1, breakdown: 1, outro: 1 }
    const result = advanceToNextStep(buildState({ phase: 'intro', stepsInPhase: 0 }), 0, custom)
    expect(result.buildState.phase).toBe('build')
  })
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npx vitest run src/shared/autoArrangeBuildStep.test.ts -t "forwards a custom phaseStepTargets"`
Expected: FAIL (extra argument has no effect yet, since `advanceToNextStep` still calls `advancePhase(buildState)` with no second argument — `result.buildState.phase` is `'intro'`, not `'build'`)

- [ ] **Step 7: Forward the parameter through `advanceToNextStep`**

In `src/shared/autoArrangeBuildStep.ts`, change:

```typescript
export function advanceToNextStep(
  buildState: ArrangeBuildState,
  stepIndex: number
): AdvanceStepResult {
  const nextStepIndex = stepIndex + 1
  const nextState = advancePhase(buildState)
  const complete = isArrangementComplete(nextState) || nextStepIndex >= MAX_BUILD_STEPS
  return { buildState: nextState, stepIndex: nextStepIndex, complete }
}
```

to:

```typescript
export function advanceToNextStep(
  buildState: ArrangeBuildState,
  stepIndex: number,
  phaseStepTargets?: Record<ArrangePhase, number>
): AdvanceStepResult {
  const nextStepIndex = stepIndex + 1
  const nextState = advancePhase(buildState, phaseStepTargets)
  const complete = isArrangementComplete(nextState) || nextStepIndex >= MAX_BUILD_STEPS
  return { buildState: nextState, stepIndex: nextStepIndex, complete }
}
```

This needs `type ArrangePhase` added to the existing import from `./autoArrangeEngine` at the
top of `autoArrangeBuildStep.ts` (currently `import { advanceBuildState, advancePhase,
isArrangementComplete, retreatPhase, type ArrangeBuildState, type ArrangeCandidate, type
ArrangeStemInput } from './autoArrangeEngine'` — add `type ArrangePhase` to that list; leave
`retreatPhase` alone for now, Task 2 removes it).

- [ ] **Step 8: Run the test to verify it passes**

Run: `npx vitest run src/shared/autoArrangeBuildStep.test.ts -t "forwards a custom phaseStepTargets"`
Expected: PASS

- [ ] **Step 9: Run both files' full test suites and typecheck**

Run: `npx vitest run src/shared/autoArrangeEngine.test.ts src/shared/autoArrangeBuildStep.test.ts && npm run typecheck`
Expected: all PASS, clean typecheck (confirms every existing call site — which never passes
the new argument — is completely unaffected)

- [ ] **Step 10: Commit**

```bash
git add src/shared/autoArrangeEngine.ts src/shared/autoArrangeEngine.test.ts src/shared/autoArrangeBuildStep.ts src/shared/autoArrangeBuildStep.test.ts
git commit -m "Add an optional phaseStepTargets override to advancePhase/advanceToNextStep

Defaults to the existing PHASE_STEP_TARGETS constant, so every current
caller is unaffected. Needed by the upcoming automated auto-arrange build,
which scales phase targets to a user-chosen length -- advancePhase
otherwise has no way to use anything but the fixed default."
```

---

### Task 2: Delete `retreatPhase`/`retreatToPreviousStep` (now-dead code)

**Files:**
- Modify: `src/shared/autoArrangeEngine.ts`
- Modify: `src/shared/autoArrangeEngine.test.ts`
- Modify: `src/shared/autoArrangeBuildStep.ts`
- Modify: `src/shared/autoArrangeBuildStep.test.ts`

Both functions exist solely to support the interactive build screen's "back" button. That
screen is deleted in Task 9 of this plan, and nothing else calls either function — confirm
this with a repo-wide grep before deleting (`grep -rn "retreatPhase\|retreatToPreviousStep" src/`
should, after this task, show zero matches outside these four files' own history).

- [ ] **Step 1: Remove `retreatPhase` from `autoArrangeEngine.ts`**

Delete this whole function (including its own doc comment, currently right before
`isArrangementComplete`):

```typescript
// The exact inverse of advancePhase -- for a "back" control that steps back
// one "next step"/"next section" click's worth of phase progress, in case
// the user advances by accident. If stepsInPhase > 0, this phase absorbs
// the step back (plain decrement, no transition -- the precise inverse of
// advancePhase's own "below target" branch). If stepsInPhase === 0, this
// phase was JUST entered by the last forward call, so retreating rolls back
// to the PREVIOUS PHASE_ORDER entry with stepsInPhase set to THAT phase's
// own PHASE_STEP_TARGETS - 1 -- exactly the state advancePhase's own
// boundary-crossing branch transitioned FROM. Already at 'intro' with
// stepsInPhase === 0 is the very start of the build (nothing recorded
// happened yet) -- a no-op, returning buildState unchanged. Callers should
// also guard on stepIndex > 0 before invoking this (see
// autoArrangeBuildStep.ts's retreatToPreviousStep), since retreating the
// phase without also decrementing stepIndex would desync the two.
export function retreatPhase(buildState: ArrangeBuildState): ArrangeBuildState {
  if (buildState.stepsInPhase > 0) {
    return { ...buildState, stepsInPhase: buildState.stepsInPhase - 1 }
  }
  const currentIndex = PHASE_ORDER.indexOf(buildState.phase)
  if (currentIndex === 0) return buildState
  const previousPhase = PHASE_ORDER[currentIndex - 1]
  return {
    ...buildState,
    phase: previousPhase,
    stepsInPhase: PHASE_STEP_TARGETS[previousPhase] - 1
  }
}
```

- [ ] **Step 2: Remove its test coverage from `autoArrangeEngine.test.ts`**

Delete the entire `describe('retreatPhase', ...)` block (currently lines 374-444, seven `it`s,
immediately before `describe('isArrangementComplete', ...)`), and remove `retreatPhase` from
the import list at the top of the file (`import { advanceBuildState, advancePhase,
computeCandidates, isArrangementComplete, retreatPhase, FREQUENCY_WEIGHT_MULTIPLIER,
PHASE_ORDER, PHASE_STEP_TARGETS, REENTRY_COOLDOWN_STEPS, ... } from './autoArrangeEngine'` —
drop just `retreatPhase,` from that list).

- [ ] **Step 3: Remove `retreatToPreviousStep` from `autoArrangeBuildStep.ts`**

Delete this whole function and its `RetreatStepResult` interface (both currently right before
`selectTopCandidates`):

```typescript
export interface RetreatStepResult {
  buildState: ArrangeBuildState
  stepIndex: number
}

// The inverse of advanceToNextStep -- for a "back" control that undoes an
// accidental "next section" click. Decrements stepIndex and calls the
// engine's retreatPhase (which may roll back a phase boundary), symmetric
// to how advanceToNextStep calls advancePhase. Deliberately does NOT touch
// `moves` or the moves-derived parts of buildState (activeStemKeys/
// lastExitStep) -- those are governed entirely by applyCandidate, a
// separate action; going back only rewinds which section new picks land
// in, it never un-applies a move that was already committed. No `complete`
// field: retreating can never itself finish the build, only advancing can.
// A no-op (same buildState reference, unchanged stepIndex) at stepIndex 0 --
// callers should also disable their own "back" control there rather than
// relying on this alone, matching retreatPhase's own equivalent guard.
export function retreatToPreviousStep(
  buildState: ArrangeBuildState,
  stepIndex: number
): RetreatStepResult {
  if (stepIndex <= 0) return { buildState, stepIndex }
  return { buildState: retreatPhase(buildState), stepIndex: stepIndex - 1 }
}
```

Also remove `retreatPhase` from this file's own import line (`import { advanceBuildState,
advancePhase, isArrangementComplete, retreatPhase, type ArrangeBuildState, type ArrangeCandidate,
type ArrangePhase, type ArrangeStemInput } from './autoArrangeEngine'` — drop just
`retreatPhase,`).

- [ ] **Step 4: Remove its test coverage from `autoArrangeBuildStep.test.ts`**

Delete the entire `describe('retreatToPreviousStep', ...)` block (currently lines 247-278,
five `it`s, immediately before `describe('selectTopCandidates', ...)`), and remove
`retreatToPreviousStep` from the import list at the top of the file (`import {
advanceToNextStep, applyCandidate, retreatToPreviousStep, MAX_BUILD_STEPS, selectTopCandidates
} from './autoArrangeBuildStep'` — drop just `retreatToPreviousStep,`).

- [ ] **Step 5: Confirm nothing else references either function**

Run: `grep -rn "retreatPhase\|retreatToPreviousStep" src/`
Expected: no matches at all (both functions and their tests are now fully gone)

- [ ] **Step 6: Run the full test suite and typecheck**

Run: `npx vitest run src/shared/autoArrangeEngine.test.ts src/shared/autoArrangeBuildStep.test.ts && npm run typecheck`
Expected: PASS, clean

- [ ] **Step 7: Commit**

```bash
git add src/shared/autoArrangeEngine.ts src/shared/autoArrangeEngine.test.ts src/shared/autoArrangeBuildStep.ts src/shared/autoArrangeBuildStep.test.ts
git commit -m "Delete retreatPhase/retreatToPreviousStep -- only used by the interactive build screen's back button, which this same effort is replacing with an automated build. Confirmed no other callers via repo-wide grep."
```

---

### Task 3: Rename `MAX_CANDIDATES_SHOWN` to `TOP_CANDIDATE_POOL_SIZE`

**Files:**
- Modify: `src/shared/autoArrangeBuildStep.ts`

The old name and doc comment describe "how many the UI shows a human" — that UI is going
away in Task 9. The constant's real remaining job (used by both `selectTopCandidates`, kept,
and the new weighted-random picker in Task 6) is "how many top-weighted candidates are even
in consideration for a pick," which deserves an accurate name. This is a rename only — no
test file references it by name (confirmed: `grep -n "MAX_CANDIDATES_SHOWN"
src/shared/autoArrangeBuildStep.test.ts` returns nothing), so no test changes are needed.

- [ ] **Step 1: Rename the constant and update its doc comment**

In `src/shared/autoArrangeBuildStep.ts`, change:

```typescript
export const MAX_CANDIDATES_SHOWN = 3
```

to:

```typescript
// How many of the current top-weighted candidates are even in consideration
// for a pick -- used both by selectTopCandidates below (today's only
// caller) and by the automated build's weighted-random selection
// (autoArrangeAutomation.ts's pickWeightedRandomCandidate).
export const TOP_CANDIDATE_POOL_SIZE = 3
```

And update `selectTopCandidates`'s own default parameter:

```typescript
export function selectTopCandidates(
  candidates: ArrangeCandidate[],
  max: number = MAX_CANDIDATES_SHOWN
): ArrangeCandidate[] {
```

to:

```typescript
export function selectTopCandidates(
  candidates: ArrangeCandidate[],
  max: number = TOP_CANDIDATE_POOL_SIZE
): ArrangeCandidate[] {
```

- [ ] **Step 2: Confirm no other reference to the old name survives**

Run: `grep -rn "MAX_CANDIDATES_SHOWN" src/`
Expected: no matches

- [ ] **Step 3: Run typecheck and the file's own tests**

Run: `npm run typecheck && npx vitest run src/shared/autoArrangeBuildStep.test.ts`
Expected: PASS, clean (the tests never referenced the constant by name, only through
`selectTopCandidates`'s own default behavior, which is unchanged)

- [ ] **Step 4: Commit**

```bash
git add src/shared/autoArrangeBuildStep.ts
git commit -m "Rename MAX_CANDIDATES_SHOWN to TOP_CANDIDATE_POOL_SIZE

The old name described 'how many the UI shows a human' -- accurate today,
but about to become misleading once the interactive build screen (the only
UI that ever showed candidates to anyone) is replaced by an automated
build. The value's real remaining job is 'how many top-weighted candidates
are even in consideration for a pick', used by both selectTopCandidates and
the upcoming weighted-random selection."
```

---

### Task 4: Add a `BATCH` `HistoryAction` so undo treats a whole apply as one checkpoint

**Files:**
- Modify: `src/renderer/src/state/history.ts`
- Test: `src/renderer/src/state/history.test.ts` (create if it doesn't already exist — check
  first with `ls src/renderer/src/state/history.test.ts`; if a test file for this reducer
  already exists under a different name, add to that one instead and use its existing import/
  setup conventions rather than creating a duplicate)

- [ ] **Step 1: Check for an existing test file, and read `history.ts`'s exact current imports**

Run: `ls src/renderer/src/state/history.test.ts 2>/dev/null; grep -n "^import\|^export" src/renderer/src/state/history.ts`

If a test file exists, read it in full before proceeding, and match its existing setup
helpers (a fixture `AppState`, a way to construct a `HistoryState`, etc.) rather than
duplicating them. The steps below assume no existing file; adapt accordingly if one exists.

- [ ] **Step 2: Write the failing tests**

Create `src/renderer/src/state/history.test.ts` (or add to the existing one):

```typescript
import { describe, expect, it } from 'vitest'
import { createHistoryState, historyReducer } from './history'
import type { AppState } from './store'

// A minimal-but-real AppState fixture -- only the fields these tests
// actually touch matter; every other field just needs to satisfy the type.
// If store.ts's AppState shape has drifted since this was written, update
// this fixture to match rather than casting past it.
function baseAppState(overrides: Partial<AppState> = {}): AppState {
  return {
    rifffs: {},
    channelOf: {},
    busOf: {},
    playedBars: {},
    leftCrop: {},
    stretch: {},
    mode: 'normal',
    bpm: 120,
    tidiedView: false,
    ...overrides
  } as AppState
}

describe('historyReducer BATCH', () => {
  it('applies every wrapped action, producing the same present state as dispatching them one at a time', () => {
    const start = createHistoryState(baseAppState({ bpm: 120 }))
    const batched = historyReducer(start, {
      type: 'BATCH',
      actions: [
        { type: 'SET_BPM', bpm: 140 },
        { type: 'TOGGLE_TIDIED_VIEW' }
      ]
    })

    let sequential = start
    sequential = historyReducer(sequential, { type: 'SET_BPM', bpm: 140 })
    sequential = historyReducer(sequential, { type: 'TOGGLE_TIDIED_VIEW' })

    expect(batched.present).toEqual(sequential.present)
  })

  it('pushes exactly ONE past entry for the whole batch, not one per wrapped action', () => {
    const start = createHistoryState(baseAppState())
    const batched = historyReducer(start, {
      type: 'BATCH',
      actions: [
        { type: 'SET_BPM', bpm: 121 },
        { type: 'SET_BPM', bpm: 122 },
        { type: 'SET_BPM', bpm: 123 }
      ]
    })
    expect(batched.past).toHaveLength(1)
    expect(batched.past[0]).toEqual(start.present)
  })

  it('one UNDO after a batch restores the exact pre-batch state, not just the last wrapped action undone', () => {
    const start = createHistoryState(baseAppState({ bpm: 120, tidiedView: false }))
    const batched = historyReducer(start, {
      type: 'BATCH',
      actions: [
        { type: 'SET_BPM', bpm: 140 },
        { type: 'TOGGLE_TIDIED_VIEW' }
      ]
    })
    const undone = historyReducer(batched, { type: 'UNDO' })
    expect(undone.present.bpm).toBe(120)
    expect(undone.present.tidiedView).toBe(false)
    expect(undone.past).toHaveLength(0)
  })

  it('clears future, same as any other tracked action', () => {
    const start = createHistoryState(baseAppState({ bpm: 100 }))
    const afterOneEdit = historyReducer(start, { type: 'SET_BPM', bpm: 110 })
    const afterUndo = historyReducer(afterOneEdit, { type: 'UNDO' })
    expect(afterUndo.future).toHaveLength(1)
    const afterBatch = historyReducer(afterUndo, {
      type: 'BATCH',
      actions: [{ type: 'SET_BPM', bpm: 130 }]
    })
    expect(afterBatch.future).toHaveLength(0)
  })

  it('a batch containing a normally-transient action type still counts toward the batch\'s single checkpoint, not silently dropped', () => {
    const start = createHistoryState(baseAppState({ mode: 'sketch', bpm: 100 }))
    const batched = historyReducer(start, {
      type: 'BATCH',
      actions: [
        { type: 'SET_BPM', bpm: 105 },
        // SET_ARRANGER_MODE is in TRANSIENT_ACTION_TYPES -- dispatched on
        // its own it wouldn't push a checkpoint at all. Inside a batch, it
        // must still be APPLIED (present.mode changes), just without
        // contributing a SEPARATE checkpoint of its own.
        { type: 'SET_ARRANGER_MODE', mode: 'normal' }
      ]
    })
    expect(batched.present.mode).toBe('normal')
    expect(batched.present.bpm).toBe(105)
    expect(batched.past).toHaveLength(1)
  })

  it('an empty actions array is a no-op that still pushes a checkpoint (present unchanged)', () => {
    const start = createHistoryState(baseAppState({ bpm: 150 }))
    const batched = historyReducer(start, { type: 'BATCH', actions: [] })
    expect(batched.present).toEqual(start.present)
    expect(batched.past).toHaveLength(1)
  })
})
```

Before running these, verify `SET_BPM`/`TOGGLE_TIDIED_VIEW`/`SET_ARRANGER_MODE` are real
action types with these exact shapes in `store.ts`'s `Action` union (`grep -n "'SET_BPM'\|'TOGGLE_TIDIED_VIEW'\|'SET_ARRANGER_MODE'" src/renderer/src/state/store.ts`)
— if any differ, adjust the test fixtures to use real, currently-existing action shapes
instead (the specific actions chosen here don't matter; what matters is that one is ordinary/
tracked and one — `SET_ARRANGER_MODE` — is in `TRANSIENT_ACTION_TYPES`).

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/renderer/src/state/history.test.ts`
Expected: FAIL — `historyReducer` doesn't recognize `action.type === 'BATCH'` yet, so it falls
through to the default branch and either throws (calling the inner `reducer` with an unknown
action type) or produces wrong results.

- [ ] **Step 4: Add the `BATCH` action type and handle it in `historyReducer`**

In `src/renderer/src/state/history.ts`, change:

```typescript
export type HistoryAction = Action | { type: 'UNDO' } | { type: 'REDO' }
```

to:

```typescript
export type HistoryAction =
  | Action
  | { type: 'UNDO' }
  | { type: 'REDO' }
  // Applies every action in `actions`, in order, but pushes exactly ONE
  // `past` checkpoint for the whole group -- for any caller that dispatches
  // several real edits as one logical operation (e.g. buildArrangeReplaceActions'
  // own PASTE_RIFFF-per-clip-copy-plus-one-DELETE_RIFFFS output) and wants
  // undo to treat it as one step, not N. `reducer`/`Action` itself never
  // needs to know this exists -- entirely a history-layer concept, same as
  // UNDO/REDO/LOAD_STATE below.
  | { type: 'BATCH'; actions: Action[] }
```

Then, in `historyReducer`, add a new branch. Insert it right after the existing `LOAD_STATE`
check (before the `TRANSIENT_ACTION_TYPES` check):

```typescript
  if (action.type === 'BATCH') {
    const past = [...state.past, state.present].slice(-MAX_HISTORY)
    const present = action.actions.reduce((s, a) => reducer(s, a), state.present)
    return { past, present, future: [] }
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/renderer/src/state/history.test.ts`
Expected: PASS (6/6)

- [ ] **Step 6: Verify `useDispatch()` accepts a `HistoryAction`, not just `Action`**

Run: `grep -n "useDispatch\|HistoryAction" src/renderer/src/state/StoreContext.tsx`

Confirm the dispatch function's own type signature is (or is compatible with) `Dispatch<HistoryAction>`,
not narrowed to `Dispatch<Action>` — `UNDO`/`REDO` must already be dispatched from somewhere
in the app (search `dispatch({ type: 'UNDO'` / `dispatch({ type: 'REDO'` if unsure where), so
this should already work; if the type is narrower than expected, widen it to `HistoryAction`
here (this is the one place in the codebase where that decision should live) rather than
casting at each new call site in Tasks 8/9.

- [ ] **Step 7: Run the full test suite and typecheck**

Run: `npm run typecheck && npx vitest run`
Expected: all PASS, clean

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/state/history.ts src/renderer/src/state/history.test.ts
git commit -m "Add a BATCH HistoryAction so a multi-action operation is one undo checkpoint

historyReducer previously pushed one snapshot per non-transient action --
fine for a single edit, but a real arrangement apply (buildArrangeReplaceActions'
own output: one PASTE_RIFFF/SET_FADE_IN/SET_FADE_OUT/ASSIGN_TO_BUS/
MOVE_TO_CHANNEL/TOGGLE_STRETCH per clip copy, plus one DELETE_RIFFFS) could
cost 15-30+ individual undo presses to unwind. BATCH folds an arbitrary
list of actions through the same reducer but pushes exactly one checkpoint.
General-purpose, not specific to any one feature -- the upcoming automated
auto-arrange build and Draw Arrangement's own apply both switch to it."
```

---

### Task 5: `autoArrangeAutomation.ts` — arc shapes, phase-target scaling, initial state

**Files:**
- Create: `src/shared/autoArrangeAutomation.ts`
- Test: `src/shared/autoArrangeAutomation.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/shared/autoArrangeAutomation.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import {
  minSectionsForShape,
  phaseStepTargetsForShape,
  initialBuildStateForShape,
  type ArrangeShape
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
    expect(
      targets.intro + targets.build + targets.peak + targets.breakdown + targets.outro
    ).toBe(5)
  })

  it('buildUp scales up to a longer target, still summing exactly', () => {
    const targets = phaseStepTargetsForShape('buildUp', 16)
    expect(
      targets.intro + targets.build + targets.peak + targets.breakdown + targets.outro
    ).toBe(16)
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
    expect(
      targets.intro + targets.build + targets.peak + targets.breakdown + targets.outro
    ).toBe(7)
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/shared/autoArrangeAutomation.test.ts`
Expected: FAIL with "Cannot find module './autoArrangeAutomation'" (the file doesn't exist yet)

- [ ] **Step 3: Create `src/shared/autoArrangeAutomation.ts` with the shape/scaling/initial-state pieces**

```typescript
import {
  PHASE_ORDER,
  type ArrangeBuildState,
  type ArrangePhase,
  type ArrangeStemInput
} from './autoArrangeEngine'

export type ArrangeShape = 'buildUp' | 'stayBusy' | 'startFull'

// Relative weights per shape, only for the phases that shape actually uses
// -- phaseStepTargetsForShape turns these into real per-phase step counts
// once a target length is known (scaleToTarget below). 'startFull' omits
// intro/build/peak entirely -- see initialBuildStateForShape's own doc
// comment for why those three would never produce a real move anyway when
// everything starts already active, so giving them a token weight would
// just steal budget from breakdown/outro's actual thinning-out work.
// Illustrative first-pass numbers for stayBusy/startFull, in the same
// "tune after a real walkthrough" spirit as this file's neighbor
// autoArrangeEngine.ts's own ENTER_SPARSITY_WEIGHT-style constants.
const SHAPE_PHASE_WEIGHTS: Record<ArrangeShape, Partial<Record<ArrangePhase, number>>> = {
  buildUp: { intro: 2, build: 3, peak: 2, breakdown: 2, outro: 1 },
  stayBusy: { intro: 1, build: 4, peak: 3, breakdown: 1, outro: 1 },
  startFull: { breakdown: 3, outro: 2 }
}

// The fewest sections a shape can be asked to build -- one per phase it
// actually uses, since scaleToTarget's own minimum-1-per-phase floor can't
// be satisfied below that. UI callers use this to clamp their own length
// control's minimum whenever the selected shape changes.
export function minSectionsForShape(shape: ArrangeShape): number {
  return Object.keys(SHAPE_PHASE_WEIGHTS[shape]).length
}

// Scales `weights` (relative proportions for the phases in `phases`, same
// order) to whole numbers summing to exactly `targetTotal`, with a floor of
// 1 per phase -- "largest remainder" apportionment, the same well-known,
// deterministic method used for proportional seat allocation: floor each
// phase's raw share (never below 1), then hand out (or claw back) whatever
// whole-number remainder is left, one at a time, to the phases with the
// largest fractional share first. Callers must ensure
// `targetTotal >= phases.length` (minSectionsForShape's own job) -- below
// that there's no way to keep every phase at its floor of 1, and this
// function does not guard against it.
function scaleToTarget(phases: ArrangePhase[], weights: number[], targetTotal: number): number[] {
  const totalWeight = weights.reduce((a, b) => a + b, 0)
  const raw = weights.map((w) => (w / totalWeight) * targetTotal)
  const floors = raw.map((r) => Math.max(1, Math.floor(r)))
  const byFractionDesc = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac)

  let remainder = targetTotal - floors.reduce((a, b) => a + b, 0)
  let cursor = 0
  while (remainder > 0) {
    floors[byFractionDesc[cursor % byFractionDesc.length].i]++
    remainder--
    cursor++
  }
  cursor = 0
  while (remainder < 0) {
    const i = byFractionDesc[byFractionDesc.length - 1 - (cursor % byFractionDesc.length)].i
    if (floors[i] > 1) {
      floors[i]--
      remainder++
    }
    cursor++
  }
  return floors
}

// Real per-phase step counts for `shape`, scaled to `targetSections` total.
// Always a full 5-key record (advancePhase's own Record<ArrangePhase,
// number> parameter type requires it) -- a phase this shape doesn't use
// gets 0, which is never actually read: advancePhase only ever consults
// the CURRENT phase's own target, and phase order only ever moves forward
// from wherever initialBuildStateForShape started it, so an earlier,
// unused phase's target is structurally unreachable, not just
// conventionally ignored.
export function phaseStepTargetsForShape(
  shape: ArrangeShape,
  targetSections: number
): Record<ArrangePhase, number> {
  const weights = SHAPE_PHASE_WEIGHTS[shape]
  const phases = Object.keys(weights) as ArrangePhase[]
  const scaled = scaleToTarget(
    phases,
    phases.map((p) => weights[p]!),
    targetSections
  )
  const targets: Record<ArrangePhase, number> = {
    intro: 0,
    build: 0,
    peak: 0,
    breakdown: 0,
    outro: 0
  }
  phases.forEach((p, i) => {
    targets[p] = scaled[i]
  })
  return targets
}

// Where a build for `shape` starts. 'startFull' seeds every included stem
// as already active and starts directly at 'breakdown' -- 'intro'/'build'
// only ever offer 'enter' candidates (nothing to enter, everything's
// already active), and 'peak's only candidate source (bestFillCandidate,
// autoArrangeEngine.ts) explicitly returns null once there's no inactive
// stem left to fill from -- so all three would produce zero real moves
// regardless, and starting past them spends the whole requested length on
// breakdown/outro's actual thinning-out instead of silently wasting
// sections on nothing. PHASE_ORDER traversal itself is completely
// untouched (advancePhase only ever walks forward from wherever it's
// told to start) -- this needs no engine changes beyond Task 1's own.
export function initialBuildStateForShape(
  shape: ArrangeShape,
  stems: ArrangeStemInput[]
): ArrangeBuildState {
  if (shape === 'startFull') {
    return {
      activeStemKeys: stems.filter((s) => s.included).map((s) => s.stemKey),
      phase: 'breakdown',
      stepsInPhase: 0,
      lastExitStep: {}
    }
  }
  return { activeStemKeys: [], phase: 'intro', stepsInPhase: 0, lastExitStep: {} }
}

// Re-exported so PHASE_ORDER's own presence here doesn't trip an unused-
// import lint error in builds that only need the shape/scaling helpers
// above -- Task 6 (the same file) is what actually consumes PHASE_ORDER,
// added in this same task's import line for that upcoming use.
export { PHASE_ORDER }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/shared/autoArrangeAutomation.test.ts`
Expected: PASS (all)

- [ ] **Step 5: Run typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: clean. If lint flags the `export { PHASE_ORDER }` re-export as unused right now
(since nothing outside this file imports it from here yet), remove that re-export line and
the `PHASE_ORDER` import from Step 3 instead — Task 6 (below, same file) will add it back
naturally when it's actually used; don't leave a speculative re-export in place if lint
objects to it.

- [ ] **Step 6: Commit**

```bash
git add src/shared/autoArrangeAutomation.ts src/shared/autoArrangeAutomation.test.ts
git commit -m "Add arc-shape scaling and initial-state logic for the automated auto-arrange build

New src/shared/autoArrangeAutomation.ts: three shapes (buildUp/stayBusy/
startFull), each a set of relative phase-step weights scaled to a
requested target length via a largest-remainder apportionment (whole
numbers, minimum 1 per used phase, exact sum). startFull seeds every
included stem active and starts at 'breakdown' directly, skipping
intro/build/peak entirely since they'd produce zero real moves anyway once
nothing's left to enter or fill from. No autoArrangeEngine.ts changes
beyond Task 1's own optional-parameter addition -- computeCandidates/
applyCandidate/advanceToNextStep are consumed exactly as they exist."
```

---

### Task 6: Weighted-random candidate selection + the automated build loop

**Files:**
- Modify: `src/shared/autoArrangeAutomation.ts`
- Modify: `src/shared/autoArrangeAutomation.test.ts`

- [ ] **Step 1: Write the failing tests for `pickWeightedRandomCandidate`**

Add to `src/shared/autoArrangeAutomation.test.ts`, and add `pickWeightedRandomCandidate`,
`runAutoArrangeBuild`, `MAX_AUTO_MOVES_PER_SECTION` to the existing import from
`'./autoArrangeAutomation'`, and `type ArrangeCandidate` to the existing import from
`'./autoArrangeEngine'`:

```typescript
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/shared/autoArrangeAutomation.test.ts -t "pickWeightedRandomCandidate"`
Expected: FAIL ("pickWeightedRandomCandidate is not a function" / import error)

- [ ] **Step 3: Add `pickWeightedRandomCandidate` to `autoArrangeAutomation.ts`**

Add this import to the top of `src/shared/autoArrangeAutomation.ts` (alongside the existing
one from `./autoArrangeEngine`):

```typescript
import { applyCandidate, advanceToNextStep, selectTopCandidates, TOP_CANDIDATE_POOL_SIZE } from './autoArrangeBuildStep'
import type { ArrangeCandidate } from './autoArrangeEngine'
import type { ArrangeMoveRecord } from './autoArrangeApply'
```

(merge `type ArrangeCandidate` into the existing `from './autoArrangeEngine'` import line
rather than duplicating it as a separate import statement)

Then add:

```typescript
// Picks one candidate from the current top TOP_CANDIDATE_POOL_SIZE (by
// weight), with probability proportional to weight -- the single
// best-weighted candidate is still the *most likely* pick, but not the
// *only possible* one. This is what makes an undo-then-rerun (see the
// design spec's own §4) actually produce a different result instead of
// deterministically reproducing the same build every time. Returns
// undefined for an empty candidate list (nothing to pick).
export function pickWeightedRandomCandidate(
  candidates: ArrangeCandidate[],
  random: () => number
): ArrangeCandidate | undefined {
  const pool = selectTopCandidates(candidates, TOP_CANDIDATE_POOL_SIZE)
  if (pool.length === 0) return undefined
  const totalWeight = pool.reduce((sum, c) => sum + c.weight, 0)
  // Every candidate's weight is non-negative by construction (see
  // autoArrangeEngine.ts's own weight formulas) -- a zero total means every
  // candidate in the pool weighs exactly 0, so fall back to a plain
  // uniform pick rather than dividing by zero.
  if (totalWeight <= 0) {
    return pool[Math.floor(random() * pool.length)]
  }
  const draw = random() * totalWeight
  let cumulative = 0
  for (const c of pool) {
    cumulative += c.weight
    if (draw < cumulative) return c
  }
  return pool[pool.length - 1] // floating-point safety net
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/shared/autoArrangeAutomation.test.ts -t "pickWeightedRandomCandidate"`
Expected: PASS (5/5)

- [ ] **Step 5: Write the failing tests for `runAutoArrangeBuild`**

Add to `src/shared/autoArrangeAutomation.test.ts`:

```typescript
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
    const result = runAutoArrangeBuild(
      [stemInput({ stemKey: 'only-one' })],
      'buildUp',
      5,
      () => 0
    )
    expect(result.totalSteps).toBeLessThan(64)
  })

  it('defaults random to Math.random when omitted -- does not throw, produces a plausible result', () => {
    const stems = [stemInput({ stemKey: 'a' }), stemInput({ stemKey: 'b' })]
    const result = runAutoArrangeBuild(stems, 'buildUp', 5)
    expect(result.totalSteps).toBeGreaterThan(0)
    expect(result.totalSteps).toBeLessThan(64)
  })
})
```

- [ ] **Step 6: Run the tests to verify they fail**

Run: `npx vitest run src/shared/autoArrangeAutomation.test.ts -t "runAutoArrangeBuild"`
Expected: FAIL ("runAutoArrangeBuild is not a function" / import error)

- [ ] **Step 7: Add `MAX_AUTO_MOVES_PER_SECTION` and `runAutoArrangeBuild` to `autoArrangeAutomation.ts`**

```typescript
export interface AutomatedBuildResult {
  moves: ArrangeMoveRecord[]
  totalSteps: number
}

// How many top-weighted picks the automated build applies within one
// section before moving to the next -- per direct feedback ("multiple
// moves per section, like a careful manual build"), not just one. Shares
// TOP_CANDIDATE_POOL_SIZE's own value rather than inventing a second magic
// number for a closely related idea, but stays its own independently-
// tunable constant since "how many candidates to consider" and "how many
// moves to commit per section" are different questions that could drift
// apart later.
export const MAX_AUTO_MOVES_PER_SECTION = TOP_CANDIDATE_POOL_SIZE

// Runs the weighted engine to completion with no per-step human input --
// see docs/superpowers/specs/2026-09-08-auto-arrange-automated-build-design.md
// for the full picture. Reuses computeCandidates/applyCandidate/
// advanceToNextStep completely unchanged; this function only decides the
// STARTING state (initialBuildStateForShape), the per-phase step BUDGET
// (phaseStepTargetsForShape), and WHICH candidate to apply at each pick
// (pickWeightedRandomCandidate) -- the engine itself has no idea any of
// this is automated.
export function runAutoArrangeBuild(
  stems: ArrangeStemInput[],
  shape: ArrangeShape,
  targetSections: number,
  random: () => number = Math.random
): AutomatedBuildResult {
  const phaseStepTargets = phaseStepTargetsForShape(shape, targetSections)
  let buildState = initialBuildStateForShape(shape, stems)
  let moves: ArrangeMoveRecord[] = []
  let stepIndex = 0

  for (;;) {
    for (let i = 0; i < MAX_AUTO_MOVES_PER_SECTION; i++) {
      const candidates = computeCandidates(stems, buildState, stepIndex)
      const picked = pickWeightedRandomCandidate(candidates, random)
      if (!picked) break
      const result = applyCandidate(moves, buildState, stems, stepIndex, picked)
      moves = result.moves
      buildState = result.buildState
      if (result.complete) return { moves, totalSteps: stepIndex + 1 }
    }
    const advanced = advanceToNextStep(buildState, stepIndex, phaseStepTargets)
    buildState = advanced.buildState
    stepIndex = advanced.stepIndex
    if (advanced.complete) return { moves, totalSteps: stepIndex + 1 }
  }
}
```

This needs `computeCandidates` added to the existing `./autoArrangeEngine` import line at the
top of the file (alongside `PHASE_ORDER`, `type ArrangeBuildState`, `type ArrangePhase`,
`type ArrangeCandidate`, `type ArrangeStemInput`).

If Step 5 of Task 5 removed the speculative `export { PHASE_ORDER }` re-export (because lint
flagged it as unused before this task existed), leave it removed here too — this task's own
code does not actually need `PHASE_ORDER` directly (it only calls `phaseStepTargetsForShape`/
`initialBuildStateForShape`, which already encapsulate any `PHASE_ORDER` use internally) —
re-check with a plain `grep -n "PHASE_ORDER" src/shared/autoArrangeAutomation.ts` after this
step and drop the import entirely if it's genuinely unused, rather than leaving a dead import.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run src/shared/autoArrangeAutomation.test.ts`
Expected: PASS (all — every test added in this task and Task 5)

- [ ] **Step 9: Run typecheck, lint, and the full test suite**

Run: `npm run typecheck && npm run lint && npx vitest run`
Expected: all clean, all PASS

- [ ] **Step 10: Commit**

```bash
git add src/shared/autoArrangeAutomation.ts src/shared/autoArrangeAutomation.test.ts
git commit -m "Add weighted-random candidate selection and the automated build loop

pickWeightedRandomCandidate picks among the current top TOP_CANDIDATE_POOL_SIZE
candidates with probability proportional to weight, injectable random for
testability. runAutoArrangeBuild drives computeCandidates/applyCandidate/
advanceToNextStep in a loop -- up to MAX_AUTO_MOVES_PER_SECTION picks per
section before advancing -- until isArrangementComplete or the existing
MAX_BUILD_STEPS safety net. This is the function AutoArrangeWizard.tsx
calls once role-confirm completes, replacing the old interactive
candidate-by-candidate build screen."
```

---

### Task 7: Extend `AutoArrangeRoleStep.tsx` with target length + arc shape controls

**Files:**
- Modify: `src/renderer/src/components/AutoArrangeRoleStep.tsx`

Re-read the file fresh before editing (`grep -n "interface Props\|export function AutoArrangeRoleStep\|onConfirm={() => onConfirm\|includedKeys\|stateBpm" src/renderer/src/components/AutoArrangeRoleStep.tsx`)
to confirm exact current line numbers, since this file has been edited several times this
session and may have shifted slightly since this plan was written.

- [ ] **Step 1: Extend `Props` and the function signature**

Change:

```typescript
interface Props {
  onConfirm: (roles: StemRoleInfo[]) => void
  onCancel: () => void
  showFrequency?: boolean
  skippable?: boolean
}
```

to:

```typescript
interface Props {
  onConfirm: (
    roles: StemRoleInfo[],
    buildOptions?: { targetSections: number; shape: ArrangeShape }
  ) => void
  onCancel: () => void
  showFrequency?: boolean
  skippable?: boolean
  // Default true -- Auto-Arrange's own call site (AutoArrangeWizard.tsx)
  // needs these; Draw Arrangement's (DrawArrangeWizard.tsx) explicitly
  // passes false, since a drawn arrangement's length/shape come from the
  // grid itself, not an upfront choice, and the warning text below
  // specifically references phases Draw Arrangement doesn't have.
  showLengthAndShape?: boolean
}
```

And the function signature:

```typescript
export function AutoArrangeRoleStep({
  onConfirm,
  onCancel,
  showFrequency = true,
  skippable = false
}: Props): React.JSX.Element {
```

to:

```typescript
export function AutoArrangeRoleStep({
  onConfirm,
  onCancel,
  showFrequency = true,
  skippable = false,
  showLengthAndShape = true
}: Props): React.JSX.Element {
```

- [ ] **Step 2: Add the new imports**

Add to the existing import list at the top of the file:

```typescript
import { startPointerDrag } from './dragUtils'
import { elapsedLabel } from '@shared/visuals'
import { ARRANGE_STEP_BARS, DRAW_ARRANGE_SECTIONS } from '@shared/autoArrangeApply'
import { MIN_STEMS_FOR_FULL_ARC } from '@shared/autoArrangeEngine'
import {
  minSectionsForShape,
  type ArrangeShape
} from '@shared/autoArrangeAutomation'
```

(`MIN_STEMS_FOR_FULL_ARC` is defined in `src/shared/autoArrangeEngine.ts` — `export const
MIN_STEMS_FOR_FULL_ARC = 4` — confirmed by direct read this same session; merge this import
into the file's own existing `@shared/autoArrangeEngine` import if one is already present
rather than adding a second, separate import line for the same module.)

- [ ] **Step 3: Add state for length/shape and the drag handler**

Add alongside the component's existing `useState` calls (near `const [roles, setRoles] =
useState<StemRoleInfo[] | null>(null)`):

```typescript
  // Default 10 sections (40 bars) -- identical to today's fixed total, so a
  // user who never touches the drag control gets the same length auto-arrange
  // has always produced.
  const [targetSections, setTargetSections] = useState(10)
  const [shape, setShape] = useState<ArrangeShape>('buildUp')
  const [isDraggingLength, setIsDraggingLength] = useState(false)
  const targetSectionsAtDragStart = useRef(targetSections)

  // Switching shape can raise the minimum selectable length (e.g. from
  // startFull's 2 up to buildUp's 5) -- clamp up, never down, so a
  // previously-chosen longer length is never silently shortened just
  // because you changed shape.
  useEffect(() => {
    setTargetSections((prev) => Math.max(prev, minSectionsForShape(shape)))
  }, [shape])
```

This needs `useRef` added to the existing `import { useEffect, useMemo, useState } from
'react'` line (`import { useEffect, useMemo, useRef, useState } from 'react'`).

- [ ] **Step 4: Add the drag handler function**

Add alongside the component's other handler functions (e.g. near `togglePreviewStem`):

```typescript
  // Mirrors SketchStrip.tsx's own draggable-bar-count control: reuses the
  // same shared startPointerDrag helper (dragUtils.ts), drag up increases
  // the value (screen Y decreases upward, so -deltaY is positive going
  // up), committed live as you drag rather than only on release -- there's
  // no separate "confirm" step here the way SketchStrip's SET_PLAYED_BARS
  // dispatch needs, since nothing is dispatched until "continue"/"skip" is
  // clicked anyway.
  const LENGTH_DRAG_PX_PER_STEP = 20

  function handleLengthPointerDown(e: React.MouseEvent): void {
    targetSectionsAtDragStart.current = targetSections
    setIsDraggingLength(true)
    startPointerDrag(
      e,
      (_deltaX, deltaY) => {
        const stepsMoved = Math.round(-deltaY / LENGTH_DRAG_PX_PER_STEP)
        const min = minSectionsForShape(shape)
        const next = Math.max(
          min,
          Math.min(DRAW_ARRANGE_SECTIONS, targetSectionsAtDragStart.current + stepsMoved)
        )
        setTargetSections(next)
      },
      () => setIsDraggingLength(false)
    )
  }
```

- [ ] **Step 5: Render the two new controls, gated on `showLengthAndShape`**

Find the existing "starts fresh" warning banner (currently: `<div style={{ fontSize: 10,
color: 'var(--ra-text-3)', marginBottom: 12 }}>this treats every stem currently placed on the
timeline as fresh material -- ...</div>`) and insert the new block immediately after it:

```tsx
        {showLengthAndShape && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 10, color: 'var(--ra-text-3)' }}>length</span>
                <span
                  onMouseDown={handleLengthPointerDown}
                  title="drag up/down to change the built arrangement's length"
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    cursor: 'ns-resize',
                    color: isDraggingLength ? 'var(--ra-stretch-on)' : 'var(--ra-text)',
                    userSelect: 'none'
                  }}
                >
                  {elapsedLabel(targetSections * ARRANGE_STEP_BARS, stateBpm)}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                {(
                  [
                    { value: 'buildUp', label: 'build up' },
                    { value: 'stayBusy', label: 'stay busy' },
                    { value: 'startFull', label: 'start full' }
                  ] as const
                ).map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => setShape(value)}
                    style={{
                      height: 20,
                      borderRadius: 0,
                      padding: '0 8px',
                      fontSize: 9,
                      border: `1px solid ${shape === value ? 'var(--ra-stretch-on)' : 'var(--ra-border)'}`,
                      background: shape === value ? 'var(--ra-stretch-on-bg)' : 'transparent',
                      color: shape === value ? 'var(--ra-stretch-on)' : 'var(--ra-text-2)',
                      cursor: 'pointer'
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {includedKeys.length < MIN_STEMS_FOR_FULL_ARC && (
              <div style={{ fontSize: 11, color: 'var(--ra-text-2)', marginBottom: 10 }}>
                only {includedKeys.length} stem{includedKeys.length === 1 ? '' : 's'} included --
                the full intro/build/peak/breakdown/outro arc works best with more variety;
                expect it to feel thin.
              </div>
            )}
          </>
        )}
```

`includedKeys` (an array of included stems' keys, `roles.filter((r) => r.included).map((r) =>
r.stemKey)`) already exists in this component, computed once — as of this plan being written
— right after the component's own `if (!roles) return ...` early-return guard, well before
the JSX return, for the existing "play all included" button. Reuse it directly rather than
computing a second, separate count; confirm it's still in scope at this point in the render
before writing this step (re-read the file fresh, per this task's own opening instruction).

- [ ] **Step 6: Pass `buildOptions` through both `onConfirm` call sites**

Change the "skip" button's `onClick`:

```typescript
              onClick={() => onConfirm(roles)}
```

(the one inside `{skippable && (...)}`) and the "continue" button's `onClick`:

```typescript
          onClick={() => onConfirm(roles)}
```

both to:

```typescript
          onClick={() =>
            onConfirm(roles, showLengthAndShape ? { targetSections, shape } : undefined)
          }
```

(there are two separate `onClick={() => onConfirm(roles)}` call sites — the skip button and
the continue button — update both identically; use enough surrounding context in each edit to
target the correct one uniquely, since the literal text `onClick={() => onConfirm(roles)}` is
not unique on its own)

- [ ] **Step 7: Confirm `AutoArrangeWizard.tsx`'s and `DrawArrangeWizard.tsx`'s existing call
sites still typecheck**

Both currently call `onConfirm` with a signature expecting only `(roles: StemRoleInfo[]) =>
void` (or `Promise<void>`). Adding an optional second parameter to the prop type is backward
compatible for the PROP itself, but each wizard's own `handleRoleConfirm` function signature
also needs to be able to accept the new second argument even if it ignores it — Task 8
(`AutoArrangeWizard.tsx`) and Task 9 below (`DrawArrangeWizard.tsx`'s own signature) update
these properly; for now, just run:

Run: `npm run typecheck`
Expected: likely FAILS at this point specifically on `AutoArrangeWizard.tsx`/`DrawArrangeWizard.tsx`'s
`handleRoleConfirm` signatures not matching the new expected `onConfirm` prop type — this is
expected and resolved by Task 8. Note the exact error text for cross-reference, then proceed.

- [ ] **Step 8: Run lint on this file only for now**

Run: `npx eslint src/renderer/src/components/AutoArrangeRoleStep.tsx`
Expected: clean (or only pre-existing warnings unrelated to this change)

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/components/AutoArrangeRoleStep.tsx
git commit -m "Add target-length drag control and arc-shape picker to AutoArrangeRoleStep

Length control mirrors SketchStrip.tsx's own draggable bar-count control
(same shared startPointerDrag helper), displayed in minutes:seconds via
the existing elapsedLabel formatter, internally stepping in whole sections
(the engine's real unit). Shape picker is a plain 3-way button group. Both
gated on a new showLengthAndShape prop (default true) so Draw Arrangement's
own reuse of this same component -- which explicitly passes false -- is
unaffected; the 'too few stems' advisory (formerly shown on the now-being-
deleted interactive build screen) moves here too, same gating.

onConfirm's signature grows an optional second (targetSections, shape)
argument -- AutoArrangeWizard.tsx (next task) and DrawArrangeWizard.tsx
both need small updates to their own handler signatures to typecheck
again; expected and addressed in the following tasks, not a regression to
chase down separately."
```

---

### Task 8: Rewrite `AutoArrangeWizard.tsx` — single screen, automated build, batched dispatch

**Files:**
- Modify: `src/renderer/src/components/AutoArrangeWizard.tsx`

- [ ] **Step 1: Replace the whole file**

`AutoArrangeWizard.tsx`'s current full content (for reference — re-read the real file first,
since it may have shifted since this plan was written) orchestrates `AutoArrangeRoleStep` →
`AutoArrangeBuildStep` via a `WizardStep` union and `useState`. Replace the entire file with:

```typescript
// src/renderer/src/components/AutoArrangeWizard.tsx
import { useAppState, useDispatch } from '../state/StoreContext'
import { usePlacedFlatStems } from '../state/usePlacedFlatStems'
import { computeDensityScore, computeFillScore } from '@shared/stemDensityScore'
import { getStemFeatures } from '../audio/stemFeaturesCache'
import { engineRoleFor, type StemRoleInfo } from '@shared/stemRole'
import type { ArrangeStemInput } from '@shared/autoArrangeEngine'
import { runAutoArrangeBuild, type ArrangeShape } from '@shared/autoArrangeAutomation'
import { buildArrangeReplaceActions } from '../state/selectors'
import { AutoArrangeRoleStep } from './AutoArrangeRoleStep'

interface Props {
  onClose: () => void
}

/** Confirms roles, then builds and applies the arrangement fully
 * automatically -- no more interactive candidate-by-candidate screen, see
 * docs/superpowers/specs/2026-09-08-auto-arrange-automated-build-design.md.
 * Scope unchanged from before: pools stems from EVERY rifff currently
 * placed on the timeline (usePlacedFlatStems.ts), same as
 * AutoArrangeRoleStep.tsx always has.
 *
 * Reuses buildArrangeReplaceActions (state/selectors.ts) completely
 * unchanged -- only how the moves[] it consumes gets produced has changed
 * (runAutoArrangeBuild instead of click-by-click candidate picking).
 * Dispatches the whole result (every PASTE_RIFFF/DELETE_RIFFFS/etc. plus
 * the SET_ARRANGER_MODE switch) as one BATCH action, so undoing a build is
 * one Cmd+Z, not fifteen-plus -- see the design spec's §3 for why this
 * matters: without it, re-running auto-arrange after a build you don't
 * like re-arranges its own output rather than your original material. */
export function AutoArrangeWizard({ onClose }: Props): React.JSX.Element {
  const dispatch = useDispatch()
  const state = useAppState()
  const { flatStemsByKey } = usePlacedFlatStems()

  async function handleRoleConfirm(
    roles: StemRoleInfo[],
    buildOptions?: { targetSections: number; shape: ArrangeShape }
  ): Promise<void> {
    // AutoArrangeRoleStep always renders this wizard's length/shape
    // controls -- this is the only call site that doesn't pass
    // showLengthAndShape={false} -- so buildOptions is always populated
    // by the time this handler runs.
    const { targetSections, shape } = buildOptions!

    const included = roles.filter((r) => r.included)
    // Promise.allSettled, not a plain await loop -- mirrors
    // AutoArrangeRoleStep.tsx's own handling of getStemFeatures, which is
    // documented (stemFeaturesCache.ts) as able to reject on a corrupt/
    // unreadable stem file. A rejected stem still gets a row here (density/
    // fill score 0, the least presumptuous default) rather than aborting
    // the whole build over one bad file.
    const results = await Promise.allSettled(
      included.map(async (role) => {
        const stem = flatStemsByKey.get(role.stemKey)?.stem
        if (!stem) throw new Error(`AutoArrangeWizard: no stem found for role ${role.stemKey}`)
        return getStemFeatures(stem.path)
      })
    )
    const stems: ArrangeStemInput[] = included.map((role, i) => {
      const result = results[i]
      if (result.status === 'rejected') {
        console.error(
          'AutoArrangeWizard: feature extraction failed for stem',
          role.stemKey,
          result.reason
        )
      }
      const densityScore = result.status === 'fulfilled' ? computeDensityScore(result.value) : 0
      const fillScore = result.status === 'fulfilled' ? computeFillScore(result.value) : 0
      return {
        stemKey: role.stemKey,
        role: engineRoleFor(role),
        densityScore,
        fillScore,
        included: true,
        frequency: role.frequency
      }
    })

    const { moves, totalSteps } = runAutoArrangeBuild(stems, shape, targetSections)
    const actions = buildArrangeReplaceActions(state, moves, totalSteps)
    // Sketch mode's own eligibility (isSketchEligible, selectors.ts) assumes
    // every placed rifff sits on one shared channel in a plain gapless
    // sequence -- exactly what this apply step breaks (a touched rifff's
    // stems land back on several channels, each with its own now-possibly-
    // different length). Unconditional, not gated on isSketchEligible(state)
    // -- per Elling, switch back to arrange mode after auto-arrange "just to
    // be safe" rather than trying to detect exactly when it's still
    // sketch-safe. Folded into the same BATCH as the arrangement itself
    // (rather than a separate dispatch after it) so the whole apply really
    // is one undo checkpoint.
    dispatch({
      type: 'BATCH',
      actions: [...actions, { type: 'SET_ARRANGER_MODE', mode: 'normal' }]
    })
    onClose()
  }

  return <AutoArrangeRoleStep onConfirm={handleRoleConfirm} onCancel={onClose} />
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: clean for this file and `AutoArrangeRoleStep.tsx`'s side of the `onConfirm` contract
(the earlier Task 7 typecheck failure specific to this file's old signature is now resolved).
`DrawArrangeWizard.tsx` may still fail at this point — that's Task 9's own fix, not this one's.

- [ ] **Step 3: Run lint on this file**

Run: `npx eslint src/renderer/src/components/AutoArrangeWizard.tsx`
Expected: clean

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/AutoArrangeWizard.tsx
git commit -m "Collapse AutoArrangeWizard to a single automated-build screen

Confirm roles (now including target length + arc shape, from Task 7),
then runAutoArrangeBuild + buildArrangeReplaceActions + one BATCH dispatch
-- no more WizardStep/useState, no more second interactive screen. Reuses
buildArrangeReplaceActions completely unchanged; the whole apply (every
paste/delete action plus the SET_ARRANGER_MODE switch) is now one undo
checkpoint instead of many."
```

---

### Task 9: Batch `DrawArrangeWizard.tsx`'s own apply too

**Files:**
- Modify: `src/renderer/src/components/DrawArrangeWizard.tsx`

Small, independent change: Draw Arrangement's own apply currently loop-dispatches
`buildArrangeReplaceActions`' output the same way `AutoArrangeWizard.tsx` used to. This gives
it the same one-undo-checkpoint benefit Task 8 gave the automated build, per the design
spec's own §3 ("this directly replaces both wizards' current loops").

- [ ] **Step 1: Replace the dispatch loop**

Re-read `DrawArrangeWizard.tsx` fresh first to confirm its exact current `handleApply`. Change:

```typescript
  function handleApply(moves: ArrangeMoveRecord[], totalSteps: number): void {
    const actions = buildArrangeReplaceActions(state, moves, totalSteps)
    for (const action of actions) {
      dispatch(action)
    }
    dispatch({ type: 'SET_ARRANGER_MODE', mode: 'normal' })
    onClose()
  }
```

to:

```typescript
  function handleApply(moves: ArrangeMoveRecord[], totalSteps: number): void {
    const actions = buildArrangeReplaceActions(state, moves, totalSteps)
    // One BATCH dispatch, not a loop -- see AutoArrangeWizard.tsx's own
    // identical change (and the design spec's §3) for why: without this,
    // undoing a drawn arrangement cost one Cmd+Z per pasted clip copy
    // instead of one for the whole apply.
    dispatch({
      type: 'BATCH',
      actions: [...actions, { type: 'SET_ARRANGER_MODE', mode: 'normal' }]
    })
    onClose()
  }
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: clean (this resolves the remaining failure noted in Task 8, Step 2, if `handleApply`
itself needed no other change — confirm no unrelated errors surface)

- [ ] **Step 3: Run lint on this file**

Run: `npx eslint src/renderer/src/components/DrawArrangeWizard.tsx`
Expected: clean

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/DrawArrangeWizard.tsx
git commit -m "Batch Draw Arrangement's own apply into one undo checkpoint too

Same BATCH dispatch AutoArrangeWizard.tsx's automated build now uses --
Draw Arrangement's apply produces the same shape of many-actions-per-apply
output from buildArrangeReplaceActions, and had the exact same many-undo-
presses problem."
```

---

### Task 10: Delete `AutoArrangeBuildStep.tsx`

**Files:**
- Delete: `src/renderer/src/components/AutoArrangeBuildStep.tsx`

- [ ] **Step 1: Confirm nothing still imports it**

Run: `grep -rn "AutoArrangeBuildStep" src/`
Expected: after `AutoArrangeWizard.tsx`'s Task 8 rewrite, this should show zero remaining
imports of the component (only, if anything, this plan file itself and the design spec, which
are docs, not source). If anything in `src/` still imports it, stop and investigate before
deleting — that means something wasn't fully migrated in an earlier task.

- [ ] **Step 2: Delete the file**

```bash
rm src/renderer/src/components/AutoArrangeBuildStep.tsx
```

- [ ] **Step 3: Run typecheck, lint, and the full test suite**

Run: `npm run typecheck && npm run lint && npx vitest run`
Expected: all clean, all PASS

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Delete AutoArrangeBuildStep.tsx -- superseded by the automated build

The interactive candidate-by-candidate screen it implemented is fully
replaced by AutoArrangeWizard.tsx's new single-screen automated flow
(Task 8). Confirmed via repo-wide grep that nothing else imports it."
```

---

### Task 11: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full suite, typecheck, lint**

Run: `npm run typecheck && npm run lint && npx vitest run`
Expected: all clean, all PASS. Note the total test count for the summary below.

- [ ] **Step 2: Repo-wide sanity grep**

Run: `grep -rn "MAX_CANDIDATES_SHOWN\|retreatPhase\|retreatToPreviousStep\|AutoArrangeBuildStep" src/`
Expected: no matches anywhere (confirms Tasks 2/3/10's cleanups are complete and nothing was
missed)

- [ ] **Step 3: Confirm the design spec's own testing section is fully covered**

Cross-check against `docs/superpowers/specs/2026-09-08-auto-arrange-automated-build-design.md`'s
§6 ("Testing"): automated-runner termination for every shape (Task 6), totalSteps matching
target length for buildUp/stayBusy (Task 5), startFull's active-seeding (Task 5 + Task 6),
too-few-stems/zero-included-stems edge cases (Task 6), injected-random producing an assertable
sequence (Task 6), BATCH's own coverage (Task 4). If any of these reads as under-covered once
the real tests exist, add the missing case now rather than leaving a gap.

- [ ] **Step 4: Write the manual-walkthrough note**

This environment cannot click through the Electron UI or perform a real mouse drag — per this
codebase's own standing convention, say so explicitly rather than claiming interactive
verification. The following need Elling's own manual walkthrough before this is considered
fully done, not just typecheck/lint/test-clean:

- The length control's drag gesture (does it feel right, does the minutes:seconds readout
  make sense, does switching shape mid-drag or after a drag behave sanely)
- The three arc shapes actually sounding meaningfully different from each other in practice
- A real undo (Cmd+Z) after an automated build genuinely restoring the original placed
  material in one press, including the "stack a bunch of clips in 32 bars" scenario Elling
  specifically asked about
- Undo-then-rerun genuinely producing a different result thanks to weighted-random selection
- Draw Arrangement's own apply also now being one undo step

- [ ] **Step 5: Report a summary**

No commit for this task (verification only) — report back: final test count, confirmation
every cleanup grep came back empty, and the manual-walkthrough list above, matching the
pattern used for every prior multi-task plan on this branch this session.
