# Auto-Arrange: Fully Automated Build — Design

## Goal

Replace Auto-Arrange's interactive, step-by-step candidate-picking screen with a fully
automated build: confirm roles, then the arrangement builds and applies itself immediately.
Elling's own words: "auto-arrangement can go completely automated maybe? instead of step by
step. i find the step by step tedious for now." Since this removes all per-step manual
control, three new upfront controls replace it: a target length, a choice of arc shape, and
(with no new UI at all) the ability to get a different result by simply re-running.

## Background — what exists today

`AutoArrangeWizard.tsx` orchestrates two screens: `AutoArrangeRoleStep.tsx` (confirm each
placed stem's role/drum-sub-role/frequency/included, pooling every stem from every rifff
currently placed on the timeline) → `AutoArrangeBuildStep.tsx` (the interactive build step —
one 4-bar "section" at a time, showing weighted candidates for the user to select and apply,
with next/back navigation and a "finish now" escape hatch).

The weighted engine (`src/shared/autoArrangeEngine.ts`) drives a five-phase guided arc —
`PHASE_ORDER = ['intro', 'build', 'peak', 'breakdown', 'outro']`, each phase permitting
specific move types (`PHASE_MOVE_TYPES`: intro→enter, build→enter+fill, peak→fill,
breakdown→exit, outro→exit) and running for `PHASE_STEP_TARGETS` steps (currently a fixed
2/3/2/2/1, summing to 10 sections = 40 bars at today's `ARRANGE_STEP_BARS = 4`).
`computeCandidates(stems, buildState, stepIndex)` returns every currently-legal weighted
move; `applyCandidate` (in `autoArrangeBuildStep.ts`) applies one and stays on the same
step (multi-move-per-step); `advanceToNextStep` bumps the step and rolls phases via the
engine's own `advancePhase`; `isArrangementComplete` is `phase === 'outro' &&
activeStemKeys.length === 0`. `selectTopCandidates(candidates, max)` sorts by weight
descending and caps at `MAX_CANDIDATES_SHOWN = 3`, currently used to limit what the UI shows
a human.

This design reuses every one of those pieces completely unchanged. Nothing in
`autoArrangeEngine.ts` needs to change.

## Non-goals

- **No preview/scrub screen for the built result.** The automated build applies directly to
  the timeline the moment it finishes, exactly like today's "finish now" and Draw
  Arrangement's "apply arrangement" already do. Undo (Cmd+Z) or simply re-running (which
  already warns that it starts fresh) are how you back out of a result you don't like — this
  was deliberately confirmed with Elling rather than assumed, since it's the one part of this
  design that could have gone either way.
- **No moving position indicator on Draw Arrangement's own "preview section" button.**
  Elling separately noticed that button has no visual feedback for where playback currently
  is. That's real, but scoped as its own small follow-up task after this one, not part of
  this spec — confirmed directly with him.
- **No changes to `autoArrangeEngine.ts`.** Every new behavior (target length, arc shape,
  regeneration) is achieved entirely from the outside: a new orchestration function chooses
  the *starting* `ArrangeBuildState`, a *scaled* `PHASE_STEP_TARGETS`-equivalent, and *which*
  candidate to apply at each step — the engine's own candidate weighting, phase advancement,
  and completion check are consumed exactly as they exist today.

## Design

### 1. Flow

`AutoArrangeWizard.tsx` collapses from two screens to one. `AutoArrangeBuildStep.tsx` is
deleted entirely (nothing will render it once this ships — no dead code left behind).
`handleRoleConfirm` still does its existing async density/fill-score extraction (unchanged,
still needed as candidate-weighting input), then calls the new automated runner
synchronously, then dispatches the result immediately via the same
`buildArrangeReplaceActions` + `SET_ARRANGER_MODE: 'normal'` + `onClose()` sequence
`AutoArrangeWizard.tsx`'s own `handleBuildComplete` already uses today. The wizard no longer
needs its own `WizardStep` union/`useState` at all — it always renders `AutoArrangeRoleStep`,
and confirming it finishes the whole flow.

### 2. New controls on the role-confirm screen

Two new controls join the existing per-stem role/drum-sub-role/frequency/included list on
`AutoArrangeRoleStep.tsx`, and the existing "too few stems" advisory (`MIN_STEMS_FOR_FULL_ARC`,
currently shown on the now-deleted build screen) moves here too, next to the existing "starts
fresh" warning banner.

**Target length.** A numeric readout in minutes:seconds (e.g. "0:40"), draggable up/down —
reusing `dragUtils.ts`'s existing `startPointerDrag` helper verbatim (the same shared drag
primitive `SketchStrip.tsx`'s own draggable bar-count control already uses: cumulative delta
from drag start, live preview while dragging with the readout switching to the accent color
`--ra-stretch-on`, committed only on release). The underlying value the drag actually changes
is a **section count** (the engine's real unit, `ARRANGE_STEP_BARS` = 4 bars each) — the
displayed minutes:seconds is *derived* from that section count via the project's own bpm,
reusing `elapsedLabel`'s existing `secPerBar = (60/bpm)*4` formula (`src/shared/visuals.ts`)
rather than inventing a second conversion. Range: 1 section up to `DRAW_ARRANGE_SECTIONS`
(16, i.e. `AUTO_ARRANGE_MAX_BARS`/`ARRANGE_STEP_BARS` — the same ceiling Draw Arrangement's
own grid already shares), with the actual minimum selectable value depending on which arc
shape is currently chosen (see below). Default: 10 sections (40 bars) — identical to today's
fixed total, so a user who never touches this control gets the same length they get today.

**Arc shape.** A three-way choice, default "build up" (matches today's only behavior
exactly):

- **build up** — unchanged from today. Starts with `activeStemKeys: []` at `phase: 'intro'`,
  and the phase proportions scale from today's fixed 2/3/2/2/1 (sum 10) to fit whatever
  target length is chosen — e.g. requesting 6 sections scales those five numbers down
  proportionally, each phase kept at a minimum of 1 step (so all five phases still get a
  turn), with any rounding remainder resolved by adjusting the phase with the largest raw
  share. Minimum selectable length: 5 sections (one section is the absolute floor per phase).
- **stay busy** — same starting state and same five phases as build up, but reweighted
  proportions favoring `build`/`peak` and shrinking `breakdown` (illustrative first-pass
  numbers, in the same "tune after a real walkthrough" spirit as the engine's own existing
  `ENTER_SPARSITY_WEIGHT`-style constants: intro 1, build 4, peak 3, breakdown 1, outro 1).
  Same 5-section minimum as build up.
- **start full** — begins with `activeStemKeys` seeded to *every included stem* and
  `phase: 'breakdown'` directly, **skipping `intro`/`build`/`peak` entirely** rather than
  giving them a token step budget. This isn't a workaround — it's the honest reflection of
  what those phases would do with nothing to enter and nothing inactive to fill: `intro`/
  `build` only ever offer `'enter'` candidates (nothing to enter, everything's already
  active), and `peak`'s only candidate source (`bestFillCandidate`) explicitly returns `null`
  the moment there's no inactive stem left to fill from — so all three would produce zero
  real moves regardless, and skipping them spends the whole requested length on breakdown/
  outro's actual thinning-out work instead of silently wasting sections on nothing.
  Proportions split roughly 60/40 between `breakdown`/`outro`. Minimum selectable length: 2
  sections (one each). Because "start full" seeds every included stem active up front,
  emptying it out within a *short* requested length and a *large* stem count can legitimately
  need more exit-capacity than the requested length provides — `isArrangementComplete`
  (`phase === 'outro' && activeStemKeys.length === 0`) is what actually ends the build, not
  the requested length itself, and the existing `MAX_BUILD_STEPS = 64` safety net (already
  relied on today) is what stops it if it can't finish. In that case the automated build will
  run a little longer than requested rather than leave stems stuck active with no exit — this
  is pre-existing engine behavior, not something new this design introduces, but is more
  likely to actually be visible under "start full" than under the other two shapes.

### 3. Regeneration, with no new UI

Since there's no more per-candidate manual picking, the automated build would otherwise be
fully deterministic — same roles in, same result out, every time. Rather than adding a
"regenerate" button (and the preview screen it would imply, which was deliberately ruled
out above), candidate selection at each step becomes **weighted-random** instead of
strictly-top-weighted: at each pick, take the current top `MAX_CANDIDATES_SHOWN` (3)
candidates (freshly recomputed after every apply, exactly as today), and choose among them
with probability proportional to weight — so the single best-weighted candidate is still the
*most likely* pick every time, but not the *only possible* one. Re-running auto-arrange
(already possible today, and already warns that it starts fresh) now naturally gives a
genuinely different result if the first one didn't land right, with zero new UI surface.

The new automated-runner function takes an injectable `random: () => number` (defaulting to
`Math.random`), matching this codebase's existing convention for testable non-determinism —
tests supply a fixed sequence to assert exact, reproducible candidate choices.

### 4. What gets deleted

`AutoArrangeBuildStep.tsx` in full — its build-progress grid, per-candidate audio preview,
next/back/finish-now controls, and the `autoArrangeBuildStep.ts` step-orchestration functions
it alone drove (`applyCandidate`/`advanceToNextStep`/`retreatToPreviousStep`/
`selectTopCandidates`) get superseded by the new automated runner, which needs the same
underlying pieces but drives them itself rather than from click handlers. `stemLabelsByKey`/
`ROLE_LABELS` (`autoArrangeLabels.ts`) stay — Draw Arrangement's own wizard still uses them.

### 5. Testing

The new automated-runner function is real `src/shared/` pure logic — TDD'd per this
codebase's convention, covering: it terminates for every arc shape without hitting
`MAX_BUILD_STEPS`; the produced `totalSteps` matches the requested target length for build
up/stay busy; "start full" seeds every included stem active in its very first move-derived
window; the too-few-stems and zero-included-stems edge cases; and that an injected fake
`random` produces a specific, assertable sequence of picks (proving the weighted-random
selection is real, not just "trust me it's random"). The role-confirm screen's own two new
controls (length drag, shape picker) are typecheck+lint-verified only, per this codebase's
standing convention for React components with no way to click-test a drag gesture in this
environment — the drag interaction itself needs Elling's own manual walkthrough, same as
Draw Arrangement's own drag-paint gesture did.
