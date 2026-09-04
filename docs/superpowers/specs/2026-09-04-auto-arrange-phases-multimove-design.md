# Auto-Arrange: Guided Phases + Multi-Move-Per-Step — Design

## Goal

Two changes to the interactive build step of Auto-Arrange (`AutoArrangeBuildStep.tsx` and its
supporting `src/shared/` engine), both from Elling's real-app feedback after using the shipped
feature:

1. **Multi-move per step** — today, applying a candidate immediately advances to the next
   4-bar step, forcing exactly one move per step. Elling: this makes step size do double duty as
   both "how granular is a transition" and "how fast does density change," so steps feel either
   abrupt or slow. Decoupling "apply a move" from "advance the step" lets several moves land on
   one step.
2. **Guide toward a real track** — Elling chose the fuller of three options presented: an
   explicit five-phase structural template (intro/build/peak/breakdown/outro) with target step
   lengths, where the engine's own candidate generation steers toward each phase's intent, not
   just a label on today's binary build/release split.

## Background — current state

`src/shared/autoArrangeEngine.ts`'s `ArrangeBuildState` currently tracks a single boolean,
`peakReached`, flipped once `activeStemKeys.length / includedStems.length >= PEAK_ACTIVE_FRACTION`
(0.75). Before that flip, `computeCandidates` only proposes `enter`/`fill` moves; after, only
`exit`/`fill` (plus frequency-gated re-entry). `isArrangementComplete` is
`peakReached && activeStemKeys.length === 0`.

`src/shared/autoArrangeBuildStep.ts`'s `applyBuildStep` does three things in one call: appends a
move record, calls `advanceBuildState` (updates `activeStemKeys`/`lastExitStep`), and advances
`stepIndex` implicitly (the caller, `AutoArrangeBuildStep.tsx`, calls `setStepIndex(stepIndex + 1)`
right after). One pick = one step, always.

`src/shared/autoArrangeApply.ts` (`activeRangesForStem`, `activeStemKeysPerStep`) already groups
`ArrangeMoveRecord[]` by `stepIndex` and handles multiple moves sharing one step correctly — this
file needs **no changes** for multi-move-per-step to work.

## Non-goals

- No pre-build configuration UI for phase target lengths — hardcoded defaults for v1, in the same
  "one place to look when tuning" spot as `ENTER_SPARSITY_WEIGHT` etc.
- No manual "skip to next phase" override — phase transitions happen automatically once a phase's
  step target is reached, via the same "next step" action multi-move-per-step introduces. Simpler
  for v1; add manual override later only if it proves necessary.
- No phase-specific reweighting of *which* stem is favored within an allowed move type (e.g. no
  "prefer sparser stems specifically during intro") — phase gates *which move types* are offered,
  reusing today's existing density/diversity/frequency weighting unchanged for whichever move
  types a phase allows.
- No visual phase-coloring of the build-progress grid — the grid's underlying data needs no
  change; a phase-aware color treatment is a natural follow-up, not required for this pass.

## Design

### 1. Phase model

Replaces `peakReached: boolean` with an explicit five-phase sequence:

```ts
export type ArrangePhase = 'intro' | 'build' | 'peak' | 'breakdown' | 'outro'

export const PHASE_ORDER: ArrangePhase[] = ['intro', 'build', 'peak', 'breakdown', 'outro']

export const PHASE_STEP_TARGETS: Record<ArrangePhase, number> = {
  intro: 2,
  build: 3,
  peak: 2,
  breakdown: 2,
  outro: 1
}

export const PHASE_MOVE_TYPES: Record<ArrangePhase, ArrangeMoveType[]> = {
  intro: ['enter'],
  build: ['enter', 'fill'],
  peak: ['fill'],
  breakdown: ['exit'],
  outro: ['exit']
}
```

`peak` deliberately allows only `fill`: peak should *hold*, not keep growing (that's `build`'s
job) or start shrinking (that's `breakdown`'s job) — a `fill` can still flicker something in
briefly without changing the held-steady layer.

**Re-entry is gated separately from fresh entry, not by the same rule.** Phases only ever move
forward through `PHASE_ORDER`, and `'exit'` is only ever allowed in `breakdown`/`outro` — both of
which come *after* `build`, the last phase where `'enter'` is allowed. If a re-entry candidate
(a previously-exited, frequency-eligible stem — see `REENTRY_COOLDOWN_STEPS`/
`FREQUENCY_WEIGHT_MULTIPLIER`) required `'enter' ∈ PHASE_MOVE_TYPES[phase]` the same way a fresh
entry does, no stem could ever satisfy it — nothing can have exited yet during `intro`/`build`,
and `'enter'` is never allowed again after them. That would silently turn the entire
`frequency`/re-entry feature (StemFrequency, the `MOVE_TO_CHANNEL` multi-window consolidation it
drives in `buildArrangeReplaceActions`) into dead code — every stem would behave as `'once'`
regardless of its actual `frequency`, with no visible failure.

So `computeCandidates` gates the two kinds of `'enter'` candidate on *different* phase
permissions: a **fresh** entry (a stem never yet active) still requires
`'enter' ∈ PHASE_MOVE_TYPES[phase]` (`intro`/`build` only). A **re-entry** (a stem with an entry
in `lastExitStep`) instead requires `'exit' ∈ PHASE_MOVE_TYPES[phase]` — i.e. it's allowed exactly
where fresh exits are also happening (`breakdown`/`outro`), using the exact same
cooldown/frequency-weighting math as today. Both still produce an `ArrangeCandidate` with
`moveType: 'enter'` (there's no separate `ArrangeMoveType` for re-entry) — only the *gating check*
inside `computeCandidates` differs by branch. Musically this reads well too: breakdown/outro can
have some things dropping out while a favorite texture briefly cycles back in, a natural
wind-down callback. `peak` still allows neither kind of `'enter'` (holds steady, as designed), and
`intro`/`build` still can't produce a re-entry candidate in practice (nothing could have exited
yet that early) even though the gate technically permits it — a harmless, never-triggered
consequence of reusing the same `'exit'`-permission check, not a special case that needs its own
guard.

`isArrangementComplete` becomes:

```ts
export function isArrangementComplete(buildState: ArrangeBuildState): boolean {
  return buildState.phase === 'outro' && buildState.activeStemKeys.length === 0
}
```

### 2. Multi-move-per-step

Applying a candidate no longer advances the step — it updates the active set and stays on the
same `stepIndex`, so `computeCandidates` immediately recomputes against the new state and the user
can keep picking. A new, separate **next step** action is what advances `stepIndex` — and, via
`advancePhase` below, checks whether the current phase's target has been reached.

### 3. Engine changes (`src/shared/autoArrangeEngine.ts`)

```ts
export interface ArrangeBuildState {
  activeStemKeys: string[]
  phase: ArrangePhase
  stepsInPhase: number
  lastExitStep: Record<string, number>
}
```

- `computeCandidates(stems, buildState, stepIndex)` — same signature. Internals replace the
  `if (!buildState.peakReached) { ... } else { ... }` branch with three independent checks against
  `PHASE_MOVE_TYPES[buildState.phase]` (see "Re-entry is gated separately from fresh entry" above
  for why fresh and re-entry aren't the same check): emit a **fresh** `enter` candidate for an
  inactive, never-exited stem only when `'enter'` is in the allowed set; emit a **re-entry**
  `enter` candidate for an inactive, previously-exited, frequency-eligible stem only when
  `'exit'` is in the allowed set; emit `exit` candidates only when `'exit'` is in the allowed set.
  The existing `enterWeight`/`roleDiversityBonus`/`FREQUENCY_WEIGHT_MULTIPLIER`/re-entry-cooldown
  logic is reused unchanged for whichever candidates are still allowed. `bestFillCandidate` is
  only called (and its result only included) when `'fill'` is in the phase's allowed set.
- `advanceBuildState(buildState, stems, chosen, stepIndex)` — unchanged responsibility (updates
  `activeStemKeys`/`lastExitStep` for the one chosen candidate), minus the inline
  `peakReached`-flip logic it used to compute — phase transitions move to the new function below,
  since they now happen at "next step" boundaries, not per-move.
- New `advancePhase(buildState: ArrangeBuildState): ArrangeBuildState` — pure, takes no other
  arguments (phase targets are fixed constants, not stem-count-dependent): increments
  `stepsInPhase`; if `stepsInPhase + 1 >= PHASE_STEP_TARGETS[phase]` AND `phase` isn't already the
  last entry in `PHASE_ORDER`, moves to the next phase in `PHASE_ORDER` and resets `stepsInPhase`
  to 0; otherwise just returns `{ ...buildState, stepsInPhase: stepsInPhase + 1 }`. Once in
  `'outro'` (last phase), further calls just keep incrementing `stepsInPhase` with no further
  transition — the build's real end condition is `isArrangementComplete`, not running out of
  phases.
- New `MIN_STEMS_FOR_FULL_ARC = 4` constant, alongside the phase tables, for the UI's warning
  (below) to import rather than hardcoding.

### 4. Build-step orchestration (`src/shared/autoArrangeBuildStep.ts`)

Today's single `applyBuildStep` splits into two exported functions:

```ts
export interface ApplyCandidateResult {
  moves: ArrangeMoveRecord[]
  buildState: ArrangeBuildState
  complete: boolean
}

export function applyCandidate(
  moves: ArrangeMoveRecord[],
  buildState: ArrangeBuildState,
  stems: ArrangeStemInput[],
  stepIndex: number,
  candidate: ArrangeCandidate
): ApplyCandidateResult
```

Appends the move record at the current `stepIndex` (unchanged shape), calls `advanceBuildState`,
and checks `isArrangementComplete` on the result — completion can still happen mid-step (e.g. the
last exit during `outro` brings the active set to zero) without needing an explicit "next step"
click. Does **not** touch `stepIndex` or call `advancePhase`.

```ts
export interface AdvanceStepResult {
  buildState: ArrangeBuildState
  stepIndex: number
  complete: boolean
}

export function advanceToNextStep(
  buildState: ArrangeBuildState,
  stepIndex: number
): AdvanceStepResult
```

Increments `stepIndex`, calls `advancePhase(buildState)`, and checks
`isArrangementComplete(nextBuildState) || stepIndex + 1 >= MAX_BUILD_STEPS` for `complete` — same
safety-net role `MAX_BUILD_STEPS` already plays today, just checked here instead of inside the old
combined function.

`selectTopCandidates`/`MAX_CANDIDATES_SHOWN`/`MAX_BUILD_STEPS` are unchanged.

### 5. UI (`src/renderer/src/components/AutoArrangeBuildStep.tsx`)

- `useState<ArrangeBuildState>({ activeStemKeys: [], peakReached: false, lastExitStep: {} })` →
  `{ activeStemKeys: [], phase: 'intro', stepsInPhase: 0, lastExitStep: {} }`.
- `pick()`/`applySelected()` call `applyCandidate` (not `applyBuildStep`) and stop calling
  `setStepIndex(stepIndex + 1)` — applying a move now keeps you on the same step, ready to pick
  another candidate against the freshly recomputed list.
- New `nextStep()` handler calling `advanceToNextStep(buildState, stepIndex)`, wired to a new
  **next step** button placed in the existing apply/cancel/finish-now row. `complete` is handled
  identically to how `pick()` already handles it (`onComplete(...)`).
- Eyebrow becomes phase-aware, e.g. `"build — step 2 of 3 (3 active)"`, via a small
  `PHASE_LABELS: Record<ArrangePhase, string>` map (lowercase, no jargon, matching
  `MOVE_LABELS`/`ROLE_LABELS`'s existing convention) — `{ intro: 'intro', build: 'building up',
  peak: 'peak', breakdown: 'breakdown', outro: 'outro' }`.
- The existing `tooFewStems` warning (`includedCount < 2`) is replaced by a phase-aware version
  using the new `MIN_STEMS_FOR_FULL_ARC` (4): *"only N stems included — the full
  intro/build/peak/breakdown/outro arc works best with more variety; expect it to feel thin."*
  Still advisory, not a hard block — the user can proceed regardless, same as today.
- The build-progress grid (`historyPerStep`/`activeStemKeysPerStep`, `previewStemKeys`) needs **no
  structural change** — it already reads `moves`/`buildState.activeStemKeys` directly, both of
  which keep working the same way under multi-move-per-step. "Hear the arrangement so far" / "hear
  with this pick" are likewise unaffected.

### 6. Testing

`src/shared/autoArrangeEngine.test.ts` and `src/shared/autoArrangeBuildStep.test.ts` get real
vitest TDD coverage per this codebase's convention (pure logic, no Electron/DOM):
`computeCandidates` gated correctly per phase (each phase only ever proposes its allowed move
types, including the `peak`-is-`fill`-only case and, critically, that a re-entry candidate is
gated by `'exit'`-permission rather than `'enter'`-permission — so a `veryFrequent` stem genuinely
CAN re-enter during `breakdown`/`outro`, not just theoretically),
`advancePhase`'s target-reached transition (including staying in `outro` once already there),
`isArrangementComplete`'s new definition, and `applyCandidate`/`advanceToNextStep`'s split
responsibilities (applying never touches `stepIndex`, advancing never appends a move record).

`AutoArrangeBuildStep.tsx` stays typecheck+lint-verified plus Elling's manual walkthrough, per this
codebase's established convention for React components.
