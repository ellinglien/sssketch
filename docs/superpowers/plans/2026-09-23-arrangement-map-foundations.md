# Arrangement map — FOUNDATIONS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the data and logic the arrangement map stands on — delete phase one outright, measure each stem's real phrase period from its audio and **report** it, re-express section length as a count of phrase passes instead of hardcoded bars, make a single pass of a single stem in a single section independently addressable, and produce a pre-filled section list from a shape template — without building the map UI, the section walk, or sssketchy's copy on the map.

**Architecture:** Every decision is a pure function or a plain table in `src/shared/`, TDD'd. The only renderer-side audio work is one path-keyed cache that decodes a stem once and returns two frame series from that single decode, exactly as `peakCache.ts` does. The existing arranger write path (`coachSectionPlacement.ts`) is re-pointed from "one clip per section" to "one clip per contiguous run of on-passes", which is the half of the map↔arrangement round trip that belongs in this plan. **No native-engine changes at all** — nothing here reaches the engine except through `buildEngineProject`, whose shape is untouched.

**Tech Stack:** TypeScript, React 19, Electron renderer, Web Audio `decodeAudioData`, vitest.

**Spec:** `docs/superpowers/specs/2026-09-23-arrangement-map-design.md` (approved 2026-09-23). It supersedes most of `docs/superpowers/specs/2026-09-22-sssketchy-guided-track-design.md`.

**Previous plans:** `docs/superpowers/plans/2026-09-22-sssketchy-framework.md`, `…-phase1.md`, `…-phase2.md`, `…-phase3.md`. Phase 1's is being **deleted** by this plan; phases 2 and 3's findings about the arranger write path, undo batching and persistence all still hold and are restated below where they matter.

**Baseline before you start:** 2388 tests / 157 files passing, `npm run typecheck` clean, `npm run lint` at 0 errors + **4 pre-existing prettier warnings in unrelated files**. That is the baseline, not something this plan fixes. Any *new* warning is yours.

---

## Findings that shaped this plan (read these first)

1. **THE USER DECIDES THE PHRASE LENGTH. This is a direct instruction from Elling** ("loop in the user in those decisions though about the loop length"), and it is the single rule most likely to be "helpfully" broken by an implementer. The measurement is **REPORTED, never applied**:
   - Nothing is halved, trimmed, resized, re-cropped or re-tiled because of a measurement.
   - `CoachState.phrase` — the number section sizing actually uses — is only ever written by `COACH_SET_PHRASE`, which only ever comes from a user gesture.
   - Changing it later **re-sizes** the existing map (`resizeCoachMapToPhrase`, Task 9) — it never rebuilds it, so names, types and cell edits survive.
   - If the measurement is inconclusive, `coachPhraseLine` returns **null** and nothing is said.

   If you find yourself writing `phrase: { bars: reading.phraseBars … }` inside a *constructor*, a reducer case that is not `COACH_SET_PHRASE`, a `useEffect`, or a cache callback — stop. Task 5 and Task 9 each have a test asserting precisely this. Do not weaken them.

2. **PRE-FILLED IS DELIBERATE, AND IT REVERSES PHASE 2's RULE.** Phase 2's `coachSections.ts` opens with a large comment saying *"everything is on, and the user subtracts… If you are reading this because you are about to seed it from the table, don't."* That rule is **dead as of this plan**. The spec (§ "The map arrives pre-filled, and says so") reverses it on purpose: *"eight identical sections is the blank page again, and the whole value of paint-by-numbers is that it does the imagining the user cannot do yet."* What makes it legitimate is that the map shows the entire song at once, so nothing is removed invisibly, plus sssketchy stating he made the call and stating the way out (cmd+z).

   **Task 6 Step 1 rewrites that comment.** Do not skip it and do not "restore consistency" by inverting the default back. A later agent who reads a stale comment will undo this feature.

3. **A section's length is a count of PASSES, not bars.** Today `coachSections.ts` hardcodes `defaultBars` (intro 8, build 16, drop 16…) and nudges of ±4/±8 bars with **no relationship to the loop at all** — Elling caught this ("the starting loop will be different lengths… are you taking number of bars into account"). A 6-bar loop in a 16-bar verse gives two passes and a two-bar stump cut mid-idea. So `passes` replaces `bars` everywhere in the coach layer, nudges become ±1/±2 passes, and the template's bar counts become **targets that round to whole passes** (`passesForTargetBars`). Bars are derived at the edges only: `sectionBars(passes, phraseBars)`.

4. **Per-pass cells are sparse overrides on top of a computed template, not a dense grid.** See "How per-pass cells are modelled" below for the full reasoning. The short version: a section stores only the cells the **user changed**; everything else is answered by a pure template function. This is what makes re-sizing free and the pre-fill un-driftable.

5. **The phrase measurement is measurement, not taste — and it must be able to say nothing.** Comparing a stem against itself at candidate periods (1, 2, 4, 8 bars) finds the smallest period that explains it. Per stem, because a kick repeating every bar is fine while a lead repeating every 2 bars in an 8-bar loop is what makes a track feel stuck. The loop's real phrase length is the **LONGEST** true period across its stems. `{ kind: 'inconclusive' }` is a first-class verdict, not an error.

6. **Follow the analysis conventions exactly** (CLAUDE.md, "Analysis caches"): pure maths in `src/shared/` with real tests; decode/caching in `src/renderer/src/audio/` keyed by **path**, with **eviction on rejection** so a transient failure does not permanently poison the path. `peakCache.ts` deliberately computes peaks AND zero-crossing brightness from the **same decode** — `phraseCache.ts` does the same thing: one decode, one `PhraseFrames` carrying both an RMS envelope and a ZCR brightness series. Do not split it into two decodes for two cheap derived values.

7. **sssketchy is a gentle coach, not a teacher or a drill sergeant.** Goals, not dictates. He states what a section is *for*, offers a way in, and is comfortable being ignored — and **he may say a section needs nothing** ("nothing has to change here. it already does its job."). The test to apply to every line: *could a friend say this while leaning over your shoulder, without it being annoying?* Copy: lowercase, no emoji, no exclamation marks, 3–4 rotated variants, chosen with `pickLineVariant(table, state.lineSeed)` — **never `Math.random`** (`coachLines.ts` explains why: a random pick would rewrite the bubble under the reader on every re-render, and no test could pin a string). The existing copy avoids contractions ("there is a…", "that is the whole method") — match it.

   Only **two** new copy tables land in this plan: the phrase report and the pre-filled disclosure. Everything sssketchy says **on the map**, and the section walk itself, is the later plan.

8. **React components are not unit-tested in this codebase** (CLAUDE.md, "Testing conventions"). Tasks 2 and 11 have **no component tests**, deliberately. They are verified by `npm run typecheck` + `npm run lint` + the pure logic's own tests, and then by Elling's manual walkthrough. This environment has no GUI or audio tooling — **do not claim any UI behaviour was tested, and do not claim the phrase measurement is right on real Endlesss loops.** Only Elling can hear that.

9. **ANOTHER AGENT IS WORKING IN THIS TREE RIGHT NOW.** The riser-own-row plan (`docs/superpowers/plans/2026-09-23-riser-own-row.md`) is being implemented concurrently and touches `src/renderer/src/components/RiserBlock.tsx`, `RowGainDial.tsx`, `ChannelRow.tsx`, `SssketchyTensionPanel.tsx`, and — overlapping with this plan — `src/renderer/src/App.tsx`, `src/renderer/src/state/store.ts`, `src/renderer/src/state/serialize.ts` and `src/renderer/src/state/coachTensionApply.ts`. **Re-read every React file and every one of those four shared files immediately before editing it.** Where this plan touches them it describes the change as *behaviour plus exact integration point*, not as a pasteable whole-file diff.

10. **After this plan, sssketchy has no entry point at all.** The project-menu button is deleted here (spec: *"The project-menu entry point — deleted. The auto-arranger is the only way in."*) and the auto-arranger entry point is in the **later** map plan. That is a deliberate intermediate state on this branch, not a bug. The store actions, the reducer cases and the panel all still work and are still tested; nothing in the UI dispatches `COACH_START` any more. Say so in the commit message; do not "fix" it by re-adding the button.

11. **`CoachSectionType` gains `'verse'`.** The spec's shape letters are `A` intro/outro · `B` **verse** · `C` build · `D` drop · `E` breakdown, and today's union has no verse. Adding it touches `COACH_SECTION_DROP_SETS`, `COACH_SECTION_TRANSITIONS`, the label table, the sanitisers and `tensionOffersAt`'s callers. A verse's suggested drop is the **hook only** (`['lead', 'bright']`), which is the spec's own good-line example made into data: *"the verse should hint at the drop without giving it away."*

12. **The wire format twin is NOT involved.** `EngineProject` / `buildEngineProject.ts` are a hand-synced pair (CLAUDE.md) and this plan changes neither. The coach layer reaches the engine only by dispatching ordinary reducer actions that place ordinary clips. **If you conclude a native-engine change is needed, STOP and report it rather than planning one.**

13. **Persistence is opt-out.** `serializeProject` rest-destructures the transient fields and stringifies the rest; `deserializeProject` builds `{ ...initialState, ...projectData }` and then runs `sanitiseLoadedCoach` (`src/renderer/src/state/serialize.ts:379`). Four new `CoachState` fields therefore persist for free — and a project saved **before this change** has none of them, plus sections in the **old** `{ bars, droppedPaths }` shape. Task 9 migrates those in the sanitiser. That is the pattern phase 2's Task 4 established.

14. **`history.ts` pins `coach` across undo EXCEPT `sections` and `tension`** — the two fields that name real timeline material. Every new field in this plan is an **answer or a measurement**, not material, so **all four go on the pinned side**: undoing a clip edit must not un-answer "what is this loop?" or throw away a phrase measurement. `sections` keeps its existing snapshot-side treatment, and its new `cells`/`passes`/`id` ride along inside it.

15. **Lint rules that will bite.** This repo **errors** on a synchronous `setState` inside a React effect (`react-hooks/set-state-in-effect`) and on render-time impurity (`react-hooks/purity` — a bare `Date.now()` in a component body; see `SssketchySectionPanel.tsx`'s `startSection` `useCallback` for the established workaround), and requires an **explicit return type on every function**, including inline ones. All code below already satisfies all three. Prettier: `singleQuote: true`, `semi: false`, `printWidth: 100`, `trailingComma: none` — every code block below is already inside 100 columns.

16. **Design tokens are the law** (`src/renderer/src/styles/tokens.css`, `docs/design.md`): near-black shell, Silkscreen, **no `border-radius` anywhere**, colour spent only on things carrying audio information. The only UI change in this plan is inside an existing panel and reuses its existing styles.

---

## How per-pass cells are modelled, and why

**The requirement** (spec, "Cells split per pass"): *"A section runs for N passes of the loop, and **each pass is its own cell**… stems arrive and leave across a section, so four passes of a four-bar loop stop being four identical bars."* The map UI and the round trip both sit on this shape, so it is worth getting right once.

**The shape chosen.** A cell is addressed by `(section, passIndex, stemPath)`. A section owns a **sparse record of the cells the user has changed**:

```ts
type CoachCells = Record<string, boolean>   // key: `${passIndex}|${path}`
```

and every cell with no entry is answered by a **pure template function** of `(sectionType, stem's rank in the row order, passIndex, passes)`.

**Why sparse-over-a-template rather than a dense grid, a per-pass `droppedPaths[]`, or an entry/exit range:**

1. **Re-sizing is free, which the spec demands.** "He can change it afterwards; the map re-sizes, it does not rebuild." Growing a section from 2 passes to 4 adds two columns that simply read the template. Shrinking and growing back **restores the user's edits**, because nothing was ever destroyed. A dense `boolean[][]` has to truncate or invent on every resize, and a truncating resize loses work silently.
2. **The pre-fill cannot drift.** The template is computed, never stored, so "what the template says" has exactly one implementation and one set of tests. What is on disk is only what the user *changed* — which also makes a saved project readable: a fresh map is `cells: {}`.
3. **The round trip has somewhere to land.** Reading the timeline back into the map produces a resolved boolean per cell; writing those straight into `cells` is legal, because the record accepts explicit values that happen to agree with the template. There is no "unset vs. on" ambiguity to resolve at the boundary — `cellIsOn` takes the fallback as an argument and always returns a boolean.
4. **The write path is a run, not a cell.** `cellRuns(cells, passes, path, fallback)` collapses a stem's on-passes into contiguous `{ startPass, passCount }` runs, and `runsToCells` is its exact inverse (Task 7 has a round-trip test). One clip per run is what actually goes on the timeline, so a stem that plays passes 1–3 of a 4-pass section is **one** clip three passes long, not three clips — which is both what a human would draw and what keeps the clip count sane.
5. **Reordering and renaming sections is free**, because the key is scoped *inside* a section (`passIndex|path`), not global (`sectionId|passIndex|path`). Sections carry a stable `id` for the map UI to key React rows off, but the cell keys never mention it.

**What is explicitly NOT in this plan:** the map component, the column walk, the toggle gesture, and the renderer-side "measure the live timeline and read it back into cells" direction of the round trip. The pure inverse (`runsToCells`) lands here so the later plan has both halves already tested.

---

## File map

| File | Change |
|---|---|
| `src/shared/coachPhase1.ts` | **DELETED** — `coachLineFor`, `coachStepSatisfied` and `lockCoachClimax` move to `coach.ts`; everything else goes |
| `src/shared/coachPhase1.test.ts` | **DELETED** |
| `src/renderer/src/state/coachDiscoverBridge.ts` | **DELETED** |
| `src/renderer/src/state/coachDiscoverBridge.test.ts` | **DELETED** |
| `src/shared/coachSteps.ts` | eight `p1-` rows, `CoachFlavour`, `byFlavour`, `CoachOffer`/`CoachOfferAction`, `satisfiedBy`, `add-slot`, the `'loop'` phase and `DISCOVER_ADD_ROW` all deleted |
| `src/shared/coachSteps.test.ts` | rewritten for the six surviving rows |
| `src/shared/coach.ts` | `flavour`/`seededKinds` deleted; `phraseReading`/`phrase`/`loopIs`/`shape` added; `coachLineFor`, `coachStepSatisfied`, `lockCoachClimax` adopted |
| `src/shared/coach.test.ts` | updated throughout |
| `src/shared/coachLines.ts` | `COACH_SEEDED_LINE_TEMPLATES` deleted; `COACH_PHRASE_LINE_TEMPLATES`, `COACH_PREFILLED_LINE_TEMPLATES` added |
| `src/shared/coachLines.test.ts` | table list updated |
| `src/shared/phrasePeriod.ts` (new) | `phraseFramesFromChannel`, `periodSimilarity`, `measurePhrasePeriod` |
| `src/shared/phrasePeriod.test.ts` (new) | full TDD |
| `src/shared/coachPhrase.ts` (new) | `readLoopPhrase`, `loopPhraseIsWorthSaying`, `phraseAnswerOptions`, `coachPhraseLine`, the two sanitisers |
| `src/shared/coachPhrase.test.ts` (new) | full TDD |
| `src/shared/coachPasses.ts` (new) | pass arithmetic, nudges, `passesForTargetBars`, `sectionBars` |
| `src/shared/coachPasses.test.ts` (new) | full TDD |
| `src/shared/coachCells.ts` (new) | cell keys, `cellIsOn`, `setCell`, `setStemAcrossPasses`, `cellRuns`, `runsToCells`, `sanitiseCoachCells` |
| `src/shared/coachCells.test.ts` (new) | full TDD incl. the run round trip |
| `src/shared/coachShapes.ts` (new) | the three shape tables, the loop question's answers, target bars |
| `src/shared/coachShapes.test.ts` (new) | full TDD |
| `src/shared/coachMapTemplate.ts` (new) | row order, arrival table, `templateCellOn`, `buildCoachMapSections`, `resizeCoachMapToPhrase`, `relayoutCoachSections` |
| `src/shared/coachMapTemplate.test.ts` (new) | full TDD |
| `src/shared/coachSections.ts` | `'verse'` added; `bars`→`passes`; `droppedPaths`→`cells`; `id`; bar constants and `nudgeSectionBars` deleted; legacy migration |
| `src/shared/coachSections.test.ts` | updated throughout |
| `src/shared/coachPhase2.ts` | `nudgeCoachSectionPasses`, `toggleCoachSectionCell`, `toggleCoachSectionStem` over cells; `dropSuggestedCoachSectionStems` deleted |
| `src/shared/coachPhase2.test.ts` | updated throughout |
| `src/shared/coachTension.ts` | `coachSectionBoundaries(sections, phraseBars)` |
| `src/shared/coachTension.test.ts` | updated |
| `src/shared/coachPhase3.ts` | `coachBoundaries(state)` reads `state.phrase` |
| `src/shared/coachPhase3.test.ts` | updated |
| `src/renderer/src/audio/phraseCache.ts` (new) | one decode → `PhraseFrames`; `getStemPhrase`, `peekStemPhraseFrames` |
| `src/renderer/src/audio/phraseCache.test.ts` (new) | cache hit, eviction on rejection |
| `src/renderer/src/state/store.ts` | `COACH_SET_FLAVOUR` deleted; five actions added/renamed |
| `src/renderer/src/state/store.test.ts` | reducer tests for all of them |
| `src/renderer/src/state/history.ts` | transient list updated; pinned-field comment extended |
| `src/renderer/src/state/history.test.ts` | new pinning tests |
| `src/renderer/src/state/serialize.test.ts` | round trip + a pre-map project |
| `src/renderer/src/state/coachSectionPlacement.ts` | one clip per **run**, not per section |
| `src/renderer/src/state/coachSectionPlacement.test.ts` | run-based placement tests |
| `src/renderer/src/state/useCoachSectionPreview.ts` | passes, cells |
| `src/renderer/src/state/coachTensionApply.ts` | section bars derived from passes |
| `src/renderer/src/state/coachTensionApply.test.ts` | updated |
| `src/renderer/src/components/SssketchySectionPanel.tsx` | pass nudges, cell-aware stem toggles, suggested-drop button removed |
| `src/renderer/src/components/SssketchyCoach.tsx` | offers row and seeded note removed; `coachLineFor` import moved |
| `src/renderer/src/components/SssketchyChecklist.tsx` | no `flavour` argument |
| `src/renderer/src/components/DiscoverPanel.tsx` | `CoachAddSlotBridge`, `coachArmedKinds`, `data-coach-anchor="discover-add-row"` removed |
| `src/renderer/src/components/LibraryBrowser.tsx` | `coachArmedKinds` prop removed from the chain |
| `src/renderer/src/App.tsx` | sssketchy button, `handleCoachOffer`, `openDiscoverForCoach`, `openRiffBrowserForCoach`, `coachArmKey`/`coachArmedKinds` removed |

## Commands used throughout (run from the repo root, `/Users/nickel/Claudecode/sssketch`)

```bash
npx vitest run src/shared/phrasePeriod.test.ts   # one file
npx vitest run                                   # the whole suite
npm run typecheck                                # tsc, node + web configs
npm run lint                                     # eslint --cache . (4 known prettier warnings)
```

---

### Task 1: Delete phase one — the shared half

Eight step rows, the melodic-or-groove question and everything that hung off it. Three functions survive and move: `coachLineFor` (the bubble reads it), `coachStepSatisfied` and `lockCoachClimax` (phase 2/3 still need a locked climax).

**Files:**
- Delete: `src/shared/coachPhase1.ts`
- Delete: `src/shared/coachPhase1.test.ts`
- Modify: `src/shared/coachSteps.ts`
- Modify: `src/shared/coachSteps.test.ts`
- Modify: `src/shared/coach.ts`
- Modify: `src/shared/coach.test.ts`
- Modify: `src/shared/coachLines.ts`
- Modify: `src/shared/coachLines.test.ts`

- [ ] **Step 1: Grep every call site before deleting anything**

```bash
grep -rn "coachPhase1\|CoachFlavour\|isCoachFlavour\|COACH_FLAVOURS\|byFlavour\|flavour" src --include='*.ts' --include='*.tsx'
grep -rn "seededKinds\|coachSeededLine\|COACH_SEEDED_LINE_TEMPLATES" src --include='*.ts' --include='*.tsx'
grep -rn "satisfiedBy\|slotCoversKindSet\|stepSatisfiedBySlots\|seededCoveredStepIds" src
grep -rn "'add-slot'\|CoachOffer\|coachStepArmKinds\|p1-" src --include='*.ts' --include='*.tsx'
```

Write the list down. Every hit is either deleted in this task, deleted in Task 2 (renderer), or is `kindsCoverSet` in `coachClimax.ts` — which **stays**, because `isSuggestedDrop` in `coachSections.ts` uses it.

- [ ] **Step 2: Write the failing test for the new step table**

Replace the whole of `src/shared/coachSteps.test.ts` with a version that knows about six rows and no flavour. The essential assertions:

```ts
import { describe, expect, it } from 'vitest'
import {
  COACH_PHASES,
  COACH_STEPS,
  FIRST_COACH_STEP_ID,
  coachStepById,
  coachStepOrder,
  coachStepPrimaryMove,
  coachStepsInPhase,
  isCoachStepId
} from './coachSteps'

describe('the step table after phase one', () => {
  it('has exactly the six surviving rows, in order', () => {
    expect(COACH_STEPS.map((step) => step.id)).toEqual([
      'p2-first',
      'p2-section',
      'p2-next',
      'p3-tension',
      'p3-balance',
      'p3-export'
    ])
  })

  it('starts on the first arrangement step', () => {
    expect(FIRST_COACH_STEP_ID).toBe('p2-first')
  })

  it('has no phase-one ids left', () => {
    expect(isCoachStepId('p1-flavour')).toBe(false)
    expect(isCoachStepId('p1-lock')).toBe(false)
  })

  it('has only two phases -- the loop phase went with phase one', () => {
    expect(COACH_PHASES.map((phase) => phase.id)).toEqual(['arrangement', 'polish'])
  })

  it('walks one flat order with no answer to reorder it', () => {
    expect(coachStepOrder()).toEqual(COACH_STEPS.map((step) => step.id))
  })

  it('offers no step an answer of its own any more', () => {
    for (const step of COACH_STEPS) expect('offers' in step).toBe(false)
  })

  it('never proposes adding a discover slot', () => {
    for (const step of COACH_STEPS) {
      for (const move of step.moves) expect(move.action.kind).not.toBe('add-slot')
    }
  })

  it('leaves the two question steps with no moves, so nothing decides for the user', () => {
    expect(coachStepById('p2-first')!.moves).toEqual([])
    expect(coachStepById('p2-next')!.moves).toEqual([])
    expect(coachStepPrimaryMove(coachStepById('p2-first')!)).toBeNull()
  })

  it('puts every arrangement step in the arrangement phase', () => {
    expect(coachStepsInPhase('arrangement').map((s) => s.id)).toEqual([
      'p2-first',
      'p2-section',
      'p2-next'
    ])
  })
})
```

- [ ] **Step 3: Run it to watch it fail**

Run: `npx vitest run src/shared/coachSteps.test.ts`
Expected: FAIL — `COACH_STEPS` still has fourteen rows and `coachStepOrder` still wants an argument.

- [ ] **Step 4: Cut phase one out of `coachSteps.ts`**

In `src/shared/coachSteps.ts`:

- Delete the eight step objects from `'p1-flavour'` through `'p1-lock'` inclusive.
- Delete `CoachFlavour`, `COACH_FLAVOURS`, `isCoachFlavour`, `FLAVOUR_OFFERS`, `SEED_FROM_RIFF_OFFER`, `CoachOffer`, `CoachOfferAction`, `CoachStepOverride`, `DISCOVER_ADD_ROW`, `PHASE1_GROOVE_ORDER`, `PHASE1_MELODIC_ORDER`, `resolveCoachStep`, `coachStepArmKinds`.
- Delete the `offers`, `satisfiedBy` and `byFlavour` fields from `CoachStepDef`.
- Delete the `{ kind: 'add-slot'; kinds: readonly DiscoverSlotKind[] }` member of `CoachMoveAction`, and the now-unused `DiscoverSlotKind` import.
- Delete `'loop'` from `CoachPhase`, from `COACH_PHASE_BY_ID` and from `COACH_PHASE_ORDER`.
- Simplify the order functions:

```ts
/** The whole flow, in the one order it runs in. Phase one used to reorder
 * two of its steps from the melodic-or-groove answer; with phase one gone
 * there is nothing left to reorder, so this is simply the table's own
 * order -- kept as a function because `coach.ts` walks it and a later
 * plan may well branch it again. */
export function coachStepOrder(): readonly CoachStepId[] {
  return COACH_STEPS.map((step) => step.id)
}

export function nextCoachStepId(id: CoachStepId): CoachStepId | null {
  const order = coachStepOrder()
  const index = order.indexOf(id)
  if (index < 0 || index >= order.length - 1) return null
  return order[index + 1]
}

/** This phase's steps, in order -- the checklist renders these directly. */
export function coachStepsInPhase(phase: CoachPhase): readonly CoachStepDef[] {
  return COACH_STEPS.filter((step) => step.phase === phase)
}

/** The move "do it for me" runs, or null when this step has none. */
export function coachStepPrimaryMove(step: CoachStepDef): CoachMove | null {
  if (step.primaryMoveId === undefined) return null
  return step.moves.find((move) => move.id === step.primaryMoveId) ?? null
}
```

- Replace the module doc comment's first two paragraphs with:

```ts
/**
 * What the guided flow IS, as plain data.
 *
 * Everything sssketchy can say and every place the flow can be is a row in
 * COACH_STEPS below -- the state machine in ./coach.ts only ever walks this
 * table.
 *
 * Phase one -- eight rows that walked the user through assembling a climax
 * loop in Discover -- was DELETED on 2026-09-23 (spec:
 * docs/superpowers/specs/2026-09-23-arrangement-map-design.md, "Phase one
 * solved a problem nobody has"). Elling: "building a loop for the climax...
 * that is the easy part for people, honestly." Nothing reorders this table
 * any more, no step asks the user a question of its own, and no step adds a
 * Discover slot. If you are adding one of those back, read the spec first.
 */
```

- [ ] **Step 5: Move the three survivors into `coach.ts`**

Add to `src/shared/coach.ts` (and delete `src/shared/coachPhase1.ts` and its test file entirely):

```ts
/** Whether the current step's own completion condition is met.
 *
 * One step is left with an automatic check. Phase one had several, all
 * derived from Discover's slots; those went with it. Whether the tension
 * pass or the balance check is "done" is a person listening, and the app
 * has no way to know -- so they are not here, and that is deliberate.
 */
export function coachStepSatisfied(state: CoachState): boolean {
  return state.stepId === 'p3-export' && state.v1ExportedAt !== null
}

/** The one thought on screen. The satisfied line REPLACES the step's own
 * line rather than joining it -- "a new step's text replaces the old one;
 * nothing stacks" (spec) applies just as much inside a step.
 *
 * Lived in coachPhase1.ts until 2026-09-23; it is the bubble's own entry
 * point and has nothing to do with phase one, so it came here rather than
 * dying with it. */
export function coachLineFor(state: CoachState): string {
  if (state.status === 'finished') return coachLine(state)
  if (coachStepSatisfied(state)) {
    return pickLineVariant(COACH_STEP_SATISFIED_LINES, state.lineSeed)
  }
  return coachLine(state)
}

/**
 * Freezes the loop's stems, roles and gains onto the flow -- the material
 * the map is carved from.
 *
 * Lived in coachPhase1.ts, but it is not phase one's: phases two and three
 * both read `lockedClimax`, and the map cannot be built without it. The
 * step that used to dispatch it (p1-lock) is gone; the auto-arranger
 * dispatches it in the map plan.
 *
 * A lock with nothing resolved leaves the flow exactly as it was, rather
 * than storing an empty climax the map would then have to special-case.
 */
export function lockCoachClimax(
  state: CoachState,
  now: number,
  slots: readonly CoachSlotSnapshot[],
  bpm: number
): CoachState {
  const lockedClimax = lockClimaxFromSlots(slots, bpm, now)
  if (lockedClimax === null) return state
  return { ...state, lockedClimax }
}
```

`coach.ts` already imports from `./coachClimax`; extend that import to `lockClimaxFromSlots` and `type CoachSlotSnapshot`, and extend the `./coachLines` import with `COACH_STEP_SATISFIED_LINES`. Then delete from `coach.ts`: the `flavour` and `seededKinds` fields on `CoachState`, their initialisers in `startCoach`, their handling in `sanitiseLoadedCoach` (including the `repairedStep` variable, which existed only to null the flavour), the `seededKinds: []` line in `advanceCoach` / `dismissCoach`, and the `flavour` argument everywhere `coachStepOrder` / `nextCoachStepId` / `coachStepById(...).phase` is called. `resolveCoachStep` is gone, so `coachLine` becomes:

```ts
export function coachLine(state: CoachState): string {
  const step = coachStepById(state.stepId)
  if (state.status === 'finished' || step === undefined) {
    return pickLineVariant(COACH_DONE_LINES, state.lineSeed)
  }
  return pickLineVariant(step.lines, state.lineSeed)
}
```

`nextUncoveredStepId` existed only to skip phase-one steps a seeded start had already covered. Delete it; `advanceCoach` calls `nextCoachStepId(banked.stepId)` directly.

`emptyPhaseElapsed` loses its `loop` key:

```ts
function emptyPhaseElapsed(): Record<CoachPhase, number> {
  return { arrangement: 0, polish: 0 }
}
```

and `sanitiseLoadedCoach`'s `phaseElapsedMs` block drops its `loop:` line. A project saved with a `loop` figure simply loses that number, which is correct: there is no phase for it to belong to.

- [ ] **Step 6: Delete `COACH_SEEDED_LINE_TEMPLATES`**

Remove the table from `src/shared/coachLines.ts` and its entry from the `tables` array in `src/shared/coachLines.test.ts`.

- [ ] **Step 7: Update `coach.test.ts`**

Every `p1-*` id in `src/shared/coach.test.ts` becomes a surviving id, every `flavour:`/`seededKinds:` in a state literal goes, and the `answerCoachFlavour` / seeded-start describe blocks are deleted outright. Add one test that pins the deletion:

```ts
it('no longer carries an answer to a question that does not exist', () => {
  const state = startCoach(T0)
  expect('flavour' in state).toBe(false)
  expect('seededKinds' in state).toBe(false)
})

it('starts on the first arrangement step, not on a loop-building one', () => {
  expect(startCoach(T0).stepId).toBe('p2-first')
})
```

- [ ] **Step 8: Run the shared suite**

Run: `npx vitest run src/shared`
Expected: PASS for `coach.test.ts`, `coachSteps.test.ts`, `coachLines.test.ts`. `coachSections`/`coachPhase2`/`coachPhase3` may still pass here — they are reshaped in Tasks 6 and 8. Renderer tests will still be red; Task 2 fixes them.

- [ ] **Step 9: Commit**

```bash
git add -A src/shared
git commit -m "$(cat <<'EOF'
Phase one leaves, and takes the question with it

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

### Task 2: Delete phase one — the renderer half

The Discover pre-arming, its bridge, the seeded note, the offers row and the project-menu entry point. **No component tests** (Finding 8); verification is typecheck + lint + the shared suite.

**Files:**
- Delete: `src/renderer/src/state/coachDiscoverBridge.ts`
- Delete: `src/renderer/src/state/coachDiscoverBridge.test.ts`
- Modify: `src/renderer/src/components/DiscoverPanel.tsx`
- Modify: `src/renderer/src/components/LibraryBrowser.tsx`
- Modify: `src/renderer/src/components/SssketchyCoach.tsx`
- Modify: `src/renderer/src/components/SssketchyChecklist.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/state/store.ts`
- Modify: `src/renderer/src/state/store.test.ts`
- Modify: `src/renderer/src/state/history.ts`
- Modify: `src/renderer/src/state/serialize.test.ts`

- [ ] **Step 1: Re-read every file in this task before editing it**

The riser agent is in `App.tsx` and `store.ts` (Finding 9). Read each file fresh; the line numbers below are from 2026-09-23 and will have moved.

- [ ] **Step 2: `DiscoverPanel.tsx` — remove the pre-arming and the bridge**

- Delete the `CoachAddSlotBridge` component (its own function, around line 169) and its `<CoachAddSlotBridge addSlot={addSlot} />` render (around line 2603).
- Delete the `registerCoachAddSlot` import.
- Delete the `coachArmedKinds` prop from the destructure and from the props interface, and the `coachArmKey` / `appliedCoachArmKey` render-time block that calls `setPendingAddKinds` (around lines 1395–1402), together with its preceding comment.
- Delete the `data-coach-anchor="discover-add-row"` attribute from the add-row `<div>` (around line 2604).
- **Keep** `onCoachSlotsChange` and the effect that publishes `CoachSlotSnapshot[]` upward. It is how a locked climax is produced, and phases 2/3 need one (Finding, spec: "Anything phase 2/3 still needs must survive"). The auto-arranger takes it over in the map plan.

- [ ] **Step 3: `LibraryBrowser.tsx` — drop the prop from the chain**

Remove `coachArmedKinds` from the destructure, the props interface and the `<DiscoverPanel …>` call. Keep `onCoachSlotsChange` in all three.

- [ ] **Step 4: `App.tsx` — remove the entry point and the offers**

- Delete the whole `sssketchy` `<button>` in the project-menu row, `handleSssketchy`, `coach` / `coachFinished` / `coachResumable`, and the long doc comment above them. The spec is explicit: *"The project-menu entry point — deleted. The auto-arranger is the only way in."* Nothing replaces it in this plan (Finding 10).
- Delete `handleCoachOffer`, `openDiscoverForCoach`, `openRiffBrowserForCoach`, `coachArmKey`, `coachArmedKinds`, and the `coachArmedKinds={…}` prop on `<LibraryBrowser>`.
- Delete the `coachIsComplete`, `coachStepArmKinds`, `coachStepById`, `CoachOfferAction`, `isDiscoverSlotKind`, `coachDiscoverIsOpen`, `requestCoachAddSlot` and `slotKindsKey` imports if they become unused (check each — several are used elsewhere in the file).
- In `handleCoachMove`, delete the `case 'add-slot':` arm. **Keep** `case 'lock-climax':` — the action survives and the map plan dispatches it from the auto-arranger.
- In `<SssketchyCoach …>`, delete the `onOffer={handleCoachOffer}` prop.

- [ ] **Step 5: `SssketchyCoach.tsx` — remove the offers row and the seeded note**

- Change the `coachLineFor` import from `'@shared/coachPhase1'` to `'@shared/coach'` (it is now exported there — Task 1 Step 5) and drop the `coachSeededLine` import.
- `coachLineFor` takes no slots now: `const line = coachPhase3Line(coach) ?? coachSectionLine(coach) ?? coachLineFor(coach)`.
- Delete `seededLine`, its `<div>`, and the `seededLine === null` condition on the stuck-nudge `<div>` (the nudge is now the only thing that can appear in that slot).
- Delete the `offers` variable, the whole offers `<div>` block, the `onOffer` prop from both the panel's props and `SssketchyCoach`'s, and the `CoachOfferAction` import.
- `resolveCoachStep` is gone: `const step = coachStepById(coach.stepId)` and `const primaryMove = step === undefined ? null : coachStepPrimaryMove(step)`. Delete the now-unused `rawStep`.
- **Keep** `moveBlockedReason` and `canLockClimax`: `lock-climax` is still a `CoachMoveAction` and the map plan re-lists it.

- [ ] **Step 6: `SssketchyChecklist.tsx` — drop the flavour argument**

`coachStepsInPhase(phase.id, coach.flavour)` becomes `coachStepsInPhase(phase.id)`. Nothing else changes; the checklist now renders two phases instead of three, for free.

- [ ] **Step 7: `store.ts` and `history.ts` — remove `COACH_SET_FLAVOUR`**

- Delete the `COACH_SET_FLAVOUR` member of the `Action` union, its reducer case, and the `CoachFlavour` import.
- Change the `lockCoachClimax` import from `'@shared/coachPhase1'` to `'@shared/coach'`; delete the `answerCoachFlavour` import.
- Update the action-union comment above `COACH_LOCK_CLIMAX`:

```ts
  // Carries the Discover slots as a plain snapshot rather than reading them
  // from AppState, because Discover's slots are App.tsx's own React state,
  // not reducer state. Its own step (p1-lock) went with phase one on
  // 2026-09-23; the auto-arranger dispatches this in the map plan.
  | { type: 'COACH_LOCK_CLIMAX'; now: number; slots: readonly CoachSlotSnapshot[]; bpm: number }
```

- Delete `'COACH_SET_FLAVOUR'` from `TRANSIENT_ACTION_TYPES` in `history.ts`.

- [ ] **Step 8: Fix the three renderer test files**

`store.test.ts`, `serialize.test.ts` and `history.test.ts` all reference `p1-*` ids and `flavour`. Replace every `'p1-lock'` with `'p2-section'`, every `'p1-flavour'`/`'p1-low-end'`/`'p1-harmony'`/`'p1-drums'` with a surviving id, delete the `COACH_SET_FLAVOUR` describe block from `store.test.ts`, and delete `flavour:` / `seededKinds:` from every state literal.

- [ ] **Step 9: Verify**

```bash
npx vitest run && npm run typecheck && npm run lint
grep -rn "coachPhase1\|coachDiscoverBridge\|CoachAddSlotBridge\|discover-add-row" src
grep -rn "flavour\|seededKinds" src --include='*.ts' --include='*.tsx'
```
Expected: suite green, typecheck clean, lint at its 4 known warnings, and **no hits** from either grep.

- [ ] **Step 10: Commit**

```bash
git add -A src
git commit -m "$(cat <<'EOF'
The add row is nobody's step now, and the menu loses its button

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

### Task 3: The phrase measurement, as pure maths

Per stem, the smallest period (1, 2, 4, 8 bars) that explains the audio — self-similarity against itself at candidate periods. Pure, no DOM, no decode, fully tested against synthetic signals.

**Files:**
- Create: `src/shared/phrasePeriod.ts`
- Create: `src/shared/phrasePeriod.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/shared/phrasePeriod.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  PHRASE_FRAME_COUNT,
  PHRASE_MATCH_THRESHOLD,
  PHRASE_PERIOD_CANDIDATES,
  measurePhrasePeriod,
  periodSimilarity,
  phraseFramesFromChannel,
  type PhraseFrames
} from './phrasePeriod'

/** A frame series that repeats `pattern` end to end, filling PHRASE_FRAME_COUNT
 * frames. `pattern` is one period's worth of values, 0..1. */
function framesRepeating(pattern: number[]): PhraseFrames {
  const envelope = new Float32Array(PHRASE_FRAME_COUNT)
  const brightness = new Float32Array(PHRASE_FRAME_COUNT)
  for (let i = 0; i < PHRASE_FRAME_COUNT; i += 1) {
    envelope[i] = pattern[i % pattern.length]
    brightness[i] = pattern[i % pattern.length] * 0.5
  }
  return { envelope, brightness }
}

/** One period's worth of values for a `bars`-bar pattern inside an
 * 8-bar loop, at PHRASE_FRAME_COUNT/8 frames per bar. */
function periodPattern(bars: number, values: number[]): number[] {
  const framesPerBar = PHRASE_FRAME_COUNT / 8
  const out: number[] = []
  for (let bar = 0; bar < bars; bar += 1) {
    for (let f = 0; f < framesPerBar; f += 1) out.push(values[bar % values.length])
  }
  return out
}

describe('phraseFramesFromChannel', () => {
  it('produces both series from one pass over the samples', () => {
    const samples = new Float32Array(PHRASE_FRAME_COUNT * 10)
    for (let i = 0; i < samples.length; i += 1) samples[i] = Math.sin(i / 3)
    const frames = phraseFramesFromChannel(samples)
    expect(frames.envelope).toHaveLength(PHRASE_FRAME_COUNT)
    expect(frames.brightness).toHaveLength(PHRASE_FRAME_COUNT)
  })

  it('reports a loud half and a quiet half as such', () => {
    const samples = new Float32Array(PHRASE_FRAME_COUNT * 10)
    for (let i = 0; i < samples.length / 2; i += 1) samples[i] = 1
    const frames = phraseFramesFromChannel(samples)
    expect(frames.envelope[0]).toBeGreaterThan(0.9)
    expect(frames.envelope[PHRASE_FRAME_COUNT - 1]).toBeLessThan(0.1)
  })

  it('survives an empty buffer rather than throwing', () => {
    const frames = phraseFramesFromChannel(new Float32Array(0))
    expect(frames.envelope).toHaveLength(PHRASE_FRAME_COUNT)
    expect(frames.envelope[0]).toBe(0)
  })
})

describe('periodSimilarity', () => {
  it('is ~1 for a signal that really does repeat at that period', () => {
    const frames = framesRepeating(periodPattern(2, [1, 0.2]))
    expect(periodSimilarity(frames, 8, 2)!).toBeGreaterThan(PHRASE_MATCH_THRESHOLD)
  })

  it('is well below the threshold when it does not', () => {
    const frames = framesRepeating(periodPattern(8, [1, 0.2, 0.4, 0.9, 0.1, 0.7, 0.3, 0.6]))
    expect(periodSimilarity(frames, 8, 2)!).toBeLessThan(PHRASE_MATCH_THRESHOLD)
  })

  it('returns null for a period that does not divide the loop', () => {
    expect(periodSimilarity(framesRepeating([1, 0]), 6, 4)).toBeNull()
  })
})

describe('measurePhrasePeriod', () => {
  it('finds the SMALLEST period that explains the stem', () => {
    // Repeats every bar, so it also repeats every 2, 4 and 8 -- 1 wins.
    const frames = framesRepeating(periodPattern(1, [1]))
    expect(measurePhrasePeriod(frames, 8)).toEqual({ kind: 'period', bars: 1, confidence: 1 })
  })

  it('calls an 8-bar loop that is the same 4 bars twice a 4-bar phrase', () => {
    const frames = framesRepeating(periodPattern(4, [1, 0.2, 0.7, 0.3]))
    const verdict = measurePhrasePeriod(frames, 8)
    expect(verdict.kind).toBe('period')
    expect(verdict.kind === 'period' && verdict.bars).toBe(4)
  })

  it('reports the nominal length when nothing shorter explains it', () => {
    const frames = framesRepeating(periodPattern(8, [1, 0.2, 0.4, 0.9, 0.1, 0.7, 0.3, 0.6]))
    const verdict = measurePhrasePeriod(frames, 8)
    expect(verdict.kind).toBe('period')
    expect(verdict.kind === 'period' && verdict.bars).toBe(8)
  })

  it('says nothing about a one-bar loop -- there is no shorter period to find', () => {
    expect(measurePhrasePeriod(framesRepeating([1, 0.5]), 1)).toEqual({ kind: 'inconclusive' })
  })

  it('says nothing about silence rather than calling it a one-bar phrase', () => {
    const frames: PhraseFrames = {
      envelope: new Float32Array(PHRASE_FRAME_COUNT),
      brightness: new Float32Array(PHRASE_FRAME_COUNT)
    }
    expect(measurePhrasePeriod(frames, 8)).toEqual({ kind: 'inconclusive' })
  })

  it('says nothing when a shorter period sits right on the fence', () => {
    // Two bars that are ALMOST the same: the 2-bar answer and the 4-bar
    // answer are a coin flip, so there is no honest report to make.
    const pattern = periodPattern(4, [1, 0.2, 0.96, 0.24])
    const verdict = measurePhrasePeriod(framesRepeating(pattern), 8)
    expect(verdict).toEqual({ kind: 'inconclusive' })
  })

  it('only ever considers 1, 2, 4 and 8 bars', () => {
    expect([...PHRASE_PERIOD_CANDIDATES]).toEqual([1, 2, 4, 8])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/shared/phrasePeriod.test.ts`
Expected: FAIL — `Cannot find module './phrasePeriod'`.

- [ ] **Step 3: Write the implementation**

Create `src/shared/phrasePeriod.ts`:

```ts
/**
 * How long a stem's musical phrase really is, measured against itself.
 *
 * A loop's NOMINAL length is not necessarily its phrase: an 8-bar loop can
 * be the same 4 bars twice. Comparing a stem against itself at candidate
 * periods finds the smallest period that explains it (spec:
 * docs/superpowers/specs/2026-09-23-arrangement-map-design.md, "The phrase
 * pass, and who decides").
 *
 * THE RULE THIS FILE SERVES: **this is a measurement, and it is REPORTED,
 * never applied.** Nothing here resizes, halves or trims anything. It
 * returns a verdict; a person decides what to do about it. That is a direct
 * instruction from Elling ("loop in the user in those decisions though
 * about the loop length"), and it is why 'inconclusive' is a first-class
 * answer rather than an error: when the measurement is a coin flip, the
 * honest output is nothing at all.
 *
 * Per STEM, not per loop, because the two say different things: a kick
 * repeating every bar is fine, while a lead repeating every 2 bars in an
 * 8-bar loop is what makes a track feel stuck. ./coachPhrase.ts combines
 * the per-stem verdicts into the loop's own answer.
 */

/** How many frames the whole stem is reduced to, whatever its length. A
 * fixed total (rather than a fixed frames-per-bar) is what lets the
 * renderer cache one PhraseFrames per PATH -- exactly like peakCache.ts's
 * own 128 buckets -- while the bar-relative resolution is worked out at
 * read time from the nominal bar count. 512 gives 64 frames per bar on an
 * 8-bar loop and 128 on a 4-bar one, which is far finer than any of the
 * periods below. */
export const PHRASE_FRAME_COUNT = 512

/** The periods worth testing. Deliberately just powers of two: Endlesss
 * rifffs and loop packs are authored that way, the same assumption
 * loopBarGuess.ts's LOOP_BAR_CANDIDATES already makes. */
export const PHRASE_PERIOD_CANDIDATES: readonly number[] = [1, 2, 4, 8]

/** How alike two passes have to be before one is called a repeat of the
 * other. A first pass, expected to be retuned after Elling's own
 * walkthrough on real loops -- kept here as the one place to look when
 * tuning, the same convention autoArrangeEngine.ts's own
 * ENTER_SPARSITY_WEIGHT follows. */
export const PHRASE_MATCH_THRESHOLD = 0.88

/** How close to the threshold counts as "could go either way". A candidate
 * SHORTER than the answer that lands inside this band makes the whole
 * measurement inconclusive, because reporting one of two near-equal answers
 * as a fact would be exactly the overreach this feature avoids. */
export const PHRASE_AMBIGUITY_MARGIN = 0.03

/** Below this peak level the stem is treated as silence, and silence has no
 * phrase. */
export const PHRASE_SILENCE_FLOOR = 0.02

/** How far past the threshold a similarity has to sit to read as fully
 * confident. Display only -- nothing branches on `confidence`. */
const PHRASE_CONFIDENCE_SPAN = 0.08

/** The fewest frames a segment can have and still be worth comparing. */
const MIN_SEGMENT_FRAMES = 4

/** How much each series counts toward a segment comparison. The envelope
 * carries the rhythm, which is what a repeat mostly is; brightness catches
 * a lead that plays the same rhythm with different notes. Another
 * tune-after-a-walkthrough pair. */
const ENVELOPE_WEIGHT = 0.7
const BRIGHTNESS_WEIGHT = 0.3

/** One stem, reduced to two same-length series. BOTH come from ONE decode
 * and one pass over the samples -- see phraseFramesFromChannel, and see
 * peakCache.ts's own WaveformAnalysis for the pattern this follows. */
export interface PhraseFrames {
  /** Per-frame RMS, 0..1 (normalised to the stem's own loudest frame). */
  envelope: Float32Array
  /** Per-frame zero-crossing rate, 0..1 -- "how much high-frequency
   * content is here", the same cheap brightness proxy zcrFromChannel
   * computes for the waveform. */
  brightness: Float32Array
}

export type PhrasePeriodVerdict =
  | { kind: 'period'; bars: number; confidence: number }
  | { kind: 'inconclusive' }

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

/**
 * Both series, from ONE pass over the samples.
 *
 * Splitting this into an RMS pass and a ZCR pass would mean two reads of
 * the same array for two cheap derived values, which is precisely what
 * peakCache.ts's own comment tells you not to do.
 *
 * Always returns exactly `frameCount` frames, zero-filled for an empty or
 * short buffer, so every caller can index it without a length check.
 */
export function phraseFramesFromChannel(
  samples: Float32Array,
  frameCount: number = PHRASE_FRAME_COUNT
): PhraseFrames {
  const envelope = new Float32Array(frameCount)
  const brightness = new Float32Array(frameCount)
  if (samples.length === 0 || frameCount <= 0) return { envelope, brightness }

  const per = samples.length / frameCount
  let loudest = 0
  for (let f = 0; f < frameCount; f += 1) {
    const from = Math.floor(f * per)
    const to = Math.max(from + 1, Math.floor((f + 1) * per))
    let sumSquares = 0
    let crossings = 0
    let previous = samples[from]
    for (let i = from; i < to && i < samples.length; i += 1) {
      const value = samples[i]
      sumSquares += value * value
      if ((value >= 0) !== (previous >= 0)) crossings += 1
      previous = value
    }
    const count = Math.max(1, Math.min(to, samples.length) - from)
    const rms = Math.sqrt(sumSquares / count)
    envelope[f] = rms
    if (rms > loudest) loudest = rms
    // Halved because a crossing needs two samples, then clamped: a fully
    // noisy frame saturates at 1 rather than running off the scale.
    brightness[f] = clamp01(crossings / count / 0.5)
  }
  if (loudest > 0) {
    for (let f = 0; f < frameCount; f += 1) envelope[f] = envelope[f] / loudest
  }
  return { envelope, brightness }
}

/** Cosine similarity of two equal-length windows, clamped to 0..1. Two
 * windows that are both silent are reported as identical, which they are;
 * a whole-stem silence check upstream stops that from mattering. */
function windowSimilarity(
  series: Float32Array,
  aStart: number,
  bStart: number,
  length: number
): number {
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < length; i += 1) {
    const a = series[aStart + i] ?? 0
    const b = series[bStart + i] ?? 0
    dot += a * b
    normA += a * a
    normB += b * b
  }
  if (normA <= 0 && normB <= 0) return 1
  if (normA <= 0 || normB <= 0) return 0
  return clamp01(dot / Math.sqrt(normA * normB))
}

/**
 * How well `periodBars` explains this stem: the mean similarity of every
 * later pass to the first one.
 *
 * null when the period is not a whole divisor of the nominal length (a
 * 4-bar period cannot explain a 6-bar loop) or the segments would be too
 * short to compare.
 */
export function periodSimilarity(
  frames: PhraseFrames,
  nominalBars: number,
  periodBars: number
): number | null {
  if (!Number.isFinite(nominalBars) || nominalBars <= 0) return null
  if (periodBars <= 0 || periodBars >= nominalBars) return null
  if (nominalBars % periodBars !== 0) return null
  const total = frames.envelope.length
  const segment = Math.floor((total * periodBars) / nominalBars)
  if (segment < MIN_SEGMENT_FRAMES) return null
  const repeats = nominalBars / periodBars

  let sum = 0
  let pairs = 0
  for (let r = 1; r < repeats; r += 1) {
    const start = r * segment
    if (start + segment > total) break
    sum +=
      ENVELOPE_WEIGHT * windowSimilarity(frames.envelope, 0, start, segment) +
      BRIGHTNESS_WEIGHT * windowSimilarity(frames.brightness, 0, start, segment)
    pairs += 1
  }
  return pairs === 0 ? null : sum / pairs
}

function peakOf(series: Float32Array): number {
  let peak = 0
  for (let i = 0; i < series.length; i += 1) {
    if (series[i] > peak) peak = series[i]
  }
  return peak
}

/**
 * The smallest period that explains this stem, the nominal length when
 * nothing shorter does, or 'inconclusive'.
 *
 * Inconclusive, specifically, when: the loop is too short to have a
 * shorter period at all; the stem is silent; or a candidate SHORTER than
 * the answer landed within PHRASE_AMBIGUITY_MARGIN of the threshold, which
 * makes the answer a coin flip. In every one of those cases the caller
 * says nothing (coachPhraseLine, ./coachPhrase.ts).
 */
export function measurePhrasePeriod(
  frames: PhraseFrames,
  nominalBars: number
): PhrasePeriodVerdict {
  if (!Number.isFinite(nominalBars) || nominalBars < 2) return { kind: 'inconclusive' }
  if (peakOf(frames.envelope) < PHRASE_SILENCE_FLOOR) return { kind: 'inconclusive' }

  const scored: { period: number; similarity: number }[] = []
  for (const period of PHRASE_PERIOD_CANDIDATES) {
    const similarity = periodSimilarity(frames, nominalBars, period)
    if (similarity !== null) scored.push({ period, similarity })
  }
  if (scored.length === 0) return { kind: 'inconclusive' }

  const hit = scored.find((entry) => entry.similarity >= PHRASE_MATCH_THRESHOLD)
  const answer = hit?.period ?? nominalBars
  // A shorter candidate sitting on the fence means two answers are equally
  // defensible. Report neither.
  const fenceSitter = scored.some(
    (entry) =>
      entry.period < answer &&
      entry.similarity < PHRASE_MATCH_THRESHOLD &&
      entry.similarity >= PHRASE_MATCH_THRESHOLD - PHRASE_AMBIGUITY_MARGIN
  )
  if (fenceSitter) return { kind: 'inconclusive' }

  const margin =
    hit === undefined
      ? PHRASE_MATCH_THRESHOLD - Math.max(...scored.map((entry) => entry.similarity))
      : hit.similarity - PHRASE_MATCH_THRESHOLD
  return { kind: 'period', bars: answer, confidence: clamp01(margin / PHRASE_CONFIDENCE_SPAN) }
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/shared/phrasePeriod.test.ts`
Expected: PASS. If the "fence" test is flaky against the constants, adjust the **test's** pattern values (make the two bars closer or further apart) rather than loosening `PHRASE_AMBIGUITY_MARGIN` — the constant is the product decision, the fixture is not.

- [ ] **Step 5: Commit**

```bash
git add src/shared/phrasePeriod.ts src/shared/phrasePeriod.test.ts
git commit -m "$(cat <<'EOF'
Ask a stem how often it repeats itself

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

### Task 4: The phrase cache — one decode, two series

Path-keyed, evicting on rejection, exactly `peakCache.ts`'s shape. This is the only new renderer-side audio work in the plan.

**Files:**
- Create: `src/renderer/src/audio/phraseCache.ts`
- Create: `src/renderer/src/audio/phraseCache.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/audio/phraseCache.test.ts`, following `src/renderer/src/audio/bandEnergyCache.test.ts`'s own mocking shape (read it first — it mocks `./decodeStemFile`, which is the one narrow surface this module needs):

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PHRASE_FRAME_COUNT } from '@shared/phrasePeriod'

const decodeStemFile = vi.fn()
vi.mock('./decodeStemFile', () => ({ decodeStemFile: (path: string) => decodeStemFile(path) }))

/** The one AudioBuffer method this module touches. */
function fakeBuffer(samples: Float32Array): { getChannelData: () => Float32Array } {
  return { getChannelData: () => samples }
}

function loud(length: number): Float32Array {
  const samples = new Float32Array(length)
  for (let i = 0; i < length; i += 1) samples[i] = i % 2 === 0 ? 0.9 : -0.9
  return samples
}

describe('phraseCache', () => {
  beforeEach(async () => {
    vi.resetModules()
    decodeStemFile.mockReset()
  })

  it('decodes a path once and serves both series from that one decode', async () => {
    const { getStemPhraseFrames } = await import('./phraseCache')
    decodeStemFile.mockResolvedValue(fakeBuffer(loud(8192)))
    const first = await getStemPhraseFrames('/a.wav')
    const second = await getStemPhraseFrames('/a.wav')
    expect(decodeStemFile).toHaveBeenCalledTimes(1)
    expect(first).toBe(second)
    expect(first.envelope).toHaveLength(PHRASE_FRAME_COUNT)
    expect(first.brightness).toHaveLength(PHRASE_FRAME_COUNT)
  })

  it('evicts on rejection so a transient failure does not poison the path', async () => {
    const { getStemPhraseFrames } = await import('./phraseCache')
    decodeStemFile.mockRejectedValueOnce(new Error('mid-copy read'))
    await expect(getStemPhraseFrames('/b.wav')).rejects.toThrow('mid-copy read')
    decodeStemFile.mockResolvedValue(fakeBuffer(loud(8192)))
    const frames = await getStemPhraseFrames('/b.wav')
    expect(frames.envelope).toHaveLength(PHRASE_FRAME_COUNT)
    expect(decodeStemFile).toHaveBeenCalledTimes(2)
  })

  it('answers a verdict for a bar count without decoding again', async () => {
    const { getStemPhrase, getStemPhraseFrames } = await import('./phraseCache')
    decodeStemFile.mockResolvedValue(fakeBuffer(loud(8192)))
    await getStemPhraseFrames('/c.wav')
    const reading = await getStemPhrase('/c.wav', 8)
    expect(decodeStemFile).toHaveBeenCalledTimes(1)
    expect(reading.path).toBe('/c.wav')
    expect(reading.nominalBars).toBe(8)
    expect(reading.verdict.kind === 'period' || reading.verdict.kind === 'inconclusive').toBe(true)
  })

  it('peeks at nothing before anything has resolved', async () => {
    const { peekStemPhraseFrames } = await import('./phraseCache')
    expect(peekStemPhraseFrames('/never.wav')).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/renderer/src/audio/phraseCache.test.ts`
Expected: FAIL — `Cannot find module './phraseCache'`.

- [ ] **Step 3: Write the implementation**

Create `src/renderer/src/audio/phraseCache.ts`:

```ts
import {
  measurePhrasePeriod,
  phraseFramesFromChannel,
  type PhraseFrames
} from '@shared/phrasePeriod'
import type { StemPhraseReading } from '@shared/coachPhrase'
import { decodeStemFile } from './decodeStemFile'
import { countWork } from '../perf/workCounters'

/**
 * Per-path phrase-frame cache, mirroring peakCache.ts's own shape and
 * eviction-on-rejection behaviour.
 *
 * ONE decode produces BOTH series (the envelope and the brightness), the
 * same choice peakCache.ts makes for peaks and zero-crossing brightness and
 * for the same reason: the two are cheap derivations of one read, and
 * splitting them would pay for the file twice.
 *
 * Keyed by PATH and by path only. The bar count a stem is read AGAINST is
 * not part of the key -- PhraseFrames is a fixed PHRASE_FRAME_COUNT-long
 * reduction of the whole file, and measurePhrasePeriod works out the
 * bar-relative resolution itself. So a stem read at 8 bars and then at 4
 * costs one decode, not two, and the cache cannot be polluted by a stale
 * bar count.
 */
const cache = new Map<string, Promise<PhraseFrames>>()
const settled = new Map<string, PhraseFrames>()

export function getStemPhraseFrames(path: string): Promise<PhraseFrames> {
  const cached = cache.get(path)
  if (cached) return cached

  const promise = (async () => {
    try {
      const audioBuffer = await decodeStemFile(path)
      countWork('analysis:phrase')
      const frames = phraseFramesFromChannel(audioBuffer.getChannelData(0))
      settled.set(path, frames)
      return frames
    } catch (err) {
      // Don't let a transient failure (mid-copy read, permission hiccup,
      // corrupt file) permanently blacklist this path -- evict so a future
      // call retries instead of reusing a forever-rejected promise.
      cache.delete(path)
      throw err
    }
  })()

  cache.set(path, promise)
  return promise
}

/**
 * One stem's reading: its frames, and the verdict for the bar count it is
 * being read at. A REPORT -- nothing downstream of this resizes anything
 * because of it (see phrasePeriod.ts's own module doc).
 */
export async function getStemPhrase(path: string, nominalBars: number): Promise<StemPhraseReading> {
  const frames = await getStemPhraseFrames(path)
  return { path, nominalBars, verdict: measurePhrasePeriod(frames, nominalBars) }
}

/** Synchronous peek at an already-decoded path, if any -- null when nothing
 * has resolved for it yet (still in flight, never requested, or failed).
 * Same reason peekPeaks exists: a lazy initialiser can skip the "renders
 * nothing until the next microtask" gap for a path something else already
 * decoded. */
export function peekStemPhraseFrames(path: string): PhraseFrames | null {
  return settled.get(path) ?? null
}
```

Add `'analysis:phrase'` to the counter union in `src/renderer/src/perf/workCounters.ts` if that file types its keys — read it first; if `countWork` takes a bare string, nothing to do.

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/renderer/src/audio/phraseCache.test.ts`
Expected: PASS. (It will not pass until Task 5 exports `StemPhraseReading`; if you are running tasks in order, write Task 5 first or temporarily inline the type. Prefer running Task 5 first — the two are one commit's worth of work.)

- [ ] **Step 5: Commit** (after Task 5, as one commit — see Task 5 Step 6)

---

### Task 5: The loop's own reading, and the line that reports it

The loop's real phrase length is the **LONGEST** true period across its stems. The report is one line or nothing at all.

**Files:**
- Create: `src/shared/coachPhrase.ts`
- Create: `src/shared/coachPhrase.test.ts`
- Modify: `src/shared/coachLines.ts`
- Modify: `src/shared/coachLines.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/shared/coachPhrase.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  coachPhraseLine,
  loopPhraseIsWorthSaying,
  phraseAnswerOptions,
  readLoopPhrase,
  sanitiseCoachPhrase,
  sanitiseLoopPhraseReading,
  type StemPhraseReading
} from './coachPhrase'

function reading(path: string, bars: number | null): StemPhraseReading {
  return {
    path,
    nominalBars: 8,
    verdict: bars === null ? { kind: 'inconclusive' } : { kind: 'period', bars, confidence: 1 }
  }
}

describe('readLoopPhrase', () => {
  it('takes the LONGEST true period across the stems', () => {
    const loop = readLoopPhrase([reading('/kick', 1), reading('/lead', 4)], 8)
    expect(loop.phraseBars).toBe(4)
    expect(loop.measuredStems).toBe(2)
    expect(loop.inconclusiveStems).toBe(0)
  })

  it('ignores the stems it could not read, and counts them', () => {
    const loop = readLoopPhrase([reading('/kick', 2), reading('/pad', null)], 8)
    expect(loop.phraseBars).toBe(2)
    expect(loop.inconclusiveStems).toBe(1)
  })

  it('is inconclusive overall when every stem is', () => {
    const loop = readLoopPhrase([reading('/a', null), reading('/b', null)], 8)
    expect(loop.phraseBars).toBeNull()
  })

  it('is inconclusive for an empty loop rather than guessing', () => {
    expect(readLoopPhrase([], 8).phraseBars).toBeNull()
  })

  it('keeps the nominal length alongside the measurement', () => {
    expect(readLoopPhrase([reading('/a', 4)], 8).nominalBars).toBe(8)
  })
})

describe('loopPhraseIsWorthSaying', () => {
  it('is true only when the measurement differs from the nominal length', () => {
    expect(loopPhraseIsWorthSaying(readLoopPhrase([reading('/a', 4)], 8))).toBe(true)
    expect(loopPhraseIsWorthSaying(readLoopPhrase([reading('/a', 8)], 8))).toBe(false)
    expect(loopPhraseIsWorthSaying(readLoopPhrase([reading('/a', null)], 8))).toBe(false)
  })
})

describe('phraseAnswerOptions', () => {
  it('offers the measured value and the nominal one, measured first', () => {
    expect(phraseAnswerOptions(readLoopPhrase([reading('/a', 4)], 8))).toEqual([
      { bars: 4, source: 'measured' },
      { bars: 8, source: 'nominal' }
    ])
  })

  it('offers only the nominal length when there is nothing to compare it to', () => {
    expect(phraseAnswerOptions(readLoopPhrase([reading('/a', null)], 8))).toEqual([
      { bars: 8, source: 'nominal' }
    ])
  })
})

describe('coachPhraseLine', () => {
  it('states the measurement as the fact it is', () => {
    const line = coachPhraseLine(readLoopPhrase([reading('/a', 4)], 8), 0)
    expect(line).toContain('8')
    expect(line).toContain('4')
  })

  it('says NOTHING when the measurement is inconclusive', () => {
    expect(coachPhraseLine(readLoopPhrase([reading('/a', null)], 8), 0)).toBeNull()
  })

  it('says NOTHING when the loop is already its own phrase', () => {
    expect(coachPhraseLine(readLoopPhrase([reading('/a', 8)], 8), 0)).toBeNull()
  })

  it('rotates deterministically on the seed, never at random', () => {
    const loop = readLoopPhrase([reading('/a', 4)], 8)
    expect(coachPhraseLine(loop, 0)).toBe(coachPhraseLine(loop, 0))
    expect(coachPhraseLine(loop, 1)).not.toBe(coachPhraseLine(loop, 0))
  })
})

describe('the load repair', () => {
  it('drops a reading that is not an object', () => {
    expect(sanitiseLoopPhraseReading('nonsense')).toBeNull()
  })

  it('keeps a hand-edited reading only where every number is sane', () => {
    expect(sanitiseLoopPhraseReading({ nominalBars: 8, phraseBars: 4 })).toEqual({
      nominalBars: 8,
      phraseBars: 4,
      measuredStems: 0,
      inconclusiveStems: 0
    })
    expect(sanitiseLoopPhraseReading({ nominalBars: 0, phraseBars: 4 })).toBeNull()
    expect(sanitiseLoopPhraseReading({ nominalBars: 8, phraseBars: -1 })?.phraseBars).toBeNull()
  })

  it('drops an answer with an unusable bar count or an unknown source', () => {
    expect(sanitiseCoachPhrase({ bars: 4, source: 'measured' })).toEqual({
      bars: 4,
      source: 'measured'
    })
    expect(sanitiseCoachPhrase({ bars: 0, source: 'measured' })).toBeNull()
    expect(sanitiseCoachPhrase({ bars: 4, source: 'vibes' })).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/shared/coachPhrase.test.ts`
Expected: FAIL — `Cannot find module './coachPhrase'`.

- [ ] **Step 3: Add the copy table**

In `src/shared/coachLines.ts`, add (and add both names to the `tables` array in `coachLines.test.ts`):

```ts
/** The phrase report. {nominal} is the loop's nominal bar count, {phrase}
 * the measured one; the caller only ever calls this when the two differ
 * (loopPhraseIsWorthSaying), so every variant can say so plainly.
 *
 * Note what these do NOT do: none of them tells the user to change
 * anything. The finding is a fact about the audio; what to do about it is
 * his, and the third variant says so out loud. The advice this enables is
 * the ignorable kind -- "you could halve this loop and get twice the
 * arrangement out of the same material" -- never an instruction. */
export const COACH_PHRASE_LINE_TEMPLATES: readonly string[] = [
  'this {nominal}-bar loop is really the same {phrase} bars twice.',
  '{nominal} bars, but it repeats every {phrase}. worth knowing before we size anything.',
  'the phrase in here is {phrase} bars, inside a {nominal}-bar loop. your call which one we use.',
  'measured: {phrase} bars of material in a {nominal}-bar loop.'
]

/** What he says once a map has arrived pre-filled. Elling's condition for
 * the pre-fill being allowed at all (spec, "The map arrives pre-filled, and
 * says so"): he states that HE made the call, and states the way out. The
 * first variant is the spec's own wording. */
export const COACH_PREFILLED_LINE_TEMPLATES: readonly string[] = [
  'that is the usual shape. cmd+z puts everything back on if you would rather start full.',
  'i filled this in from the usual shape. one cmd+z and every cell comes back on.',
  'pre-filled, by me, from the standard arrangement. undo once for the everything-on version.',
  'this is a guess at the shape, not a rule. cmd+z if you would rather start from full.'
]
```

- [ ] **Step 4: Write the implementation**

Create `src/shared/coachPhrase.ts`:

```ts
/**
 * The loop's own phrase length, read off its stems' individual periods --
 * and the one line that reports it.
 *
 * THE RULE (spec, "The phrase pass, and who decides", and a direct
 * instruction from Elling): **the finding is REPORTED, once. Nothing is
 * halved, trimmed or resized automatically. He answers what the phrase
 * actually is, and section sizing follows HIS answer.** Nothing in this
 * file writes CoachState.phrase; only the COACH_SET_PHRASE reducer case
 * does, and only from a click.
 *
 * "The real phrase length is the LONGEST true period across the loop's
 * stems" (spec). A kick repeating every bar does not make the loop a
 * one-bar phrase -- the lead that takes four bars to say its piece does.
 */

import { COACH_PHRASE_LINE_TEMPLATES, pickLineVariant } from './coachLines'
import type { PhrasePeriodVerdict } from './phrasePeriod'

/** One stem's measurement, as ./phrasePeriod.ts produced it. */
export interface StemPhraseReading {
  path: string
  /** The bar count this stem was read AGAINST -- its own barLength. */
  nominalBars: number
  verdict: PhrasePeriodVerdict
}

/** Where a phrase length came from. 'measured' is the app's reading,
 * 'nominal' is the loop's stated length -- and the user picked between
 * them. There is no third value: a number nobody chose has no business
 * sizing anybody's arrangement. */
export type CoachPhraseSource = 'measured' | 'nominal'

/** The user's ANSWER. The only number section sizing ever reads. */
export interface CoachPhrase {
  bars: number
  source: CoachPhraseSource
}

/** What the app measured, which is a different thing from what the user
 * chose. Kept so the offer survives a reload: he can change his answer
 * later and the map re-sizes. */
export interface LoopPhraseReading {
  /** The loop's own nominal length -- the longest stem's barLength, the
   * same rule LockedClimax.barLength already uses. */
  nominalBars: number
  /** The measurement, or null when there is not an honest one to give. */
  phraseBars: number | null
  measuredStems: number
  inconclusiveStems: number
}

export function readLoopPhrase(
  readings: readonly StemPhraseReading[],
  nominalBars: number
): LoopPhraseReading {
  let phraseBars: number | null = null
  let measuredStems = 0
  let inconclusiveStems = 0
  for (const reading of readings) {
    if (reading.verdict.kind !== 'period') {
      inconclusiveStems += 1
      continue
    }
    measuredStems += 1
    // The LONGEST true period wins -- see this module's own doc comment.
    if (phraseBars === null || reading.verdict.bars > phraseBars) {
      phraseBars = reading.verdict.bars
    }
  }
  return { nominalBars, phraseBars, measuredStems, inconclusiveStems }
}

/** Whether there is anything worth saying. False when the measurement is
 * inconclusive AND false when it simply agrees with the nominal length:
 * "your 8-bar loop is 8 bars" is not a finding, it is noise. */
export function loopPhraseIsWorthSaying(reading: LoopPhraseReading): boolean {
  return reading.phraseBars !== null && reading.phraseBars < reading.nominalBars
}

/** The answers the user gets to choose between -- the measured value and
 * the nominal one, measured first because it is the one he has not already
 * seen. One option when there is nothing to compare. */
export function phraseAnswerOptions(reading: LoopPhraseReading): readonly CoachPhrase[] {
  const nominal: CoachPhrase = { bars: reading.nominalBars, source: 'nominal' }
  if (!loopPhraseIsWorthSaying(reading) || reading.phraseBars === null) return [nominal]
  return [{ bars: reading.phraseBars, source: 'measured' }, nominal]
}

/** The report, or null -- "if the measurement is inconclusive, sssketchy
 * says nothing rather than guessing" (spec). Deterministic on the seed; see
 * ./coachLines.ts for why this is never Math.random. */
export function coachPhraseLine(reading: LoopPhraseReading, seed: number): string | null {
  if (!loopPhraseIsWorthSaying(reading) || reading.phraseBars === null) return null
  return pickLineVariant(COACH_PHRASE_LINE_TEMPLATES, seed)
    .replace('{nominal}', String(reading.nominalBars))
    .replace('{phrase}', String(reading.phraseBars))
}

function positiveBars(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  return Math.max(1, Math.round(value))
}

function wholeCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0
  return Math.round(value)
}

/** Repair-rather-than-trust, like every other loader in this layer: a
 * `.sssketchproj` is plain JSON people can and do hand-edit, and a load
 * must never throw. A reading with no usable nominal length is dropped
 * entirely; an unusable measurement becomes null, which reads as
 * "inconclusive" everywhere downstream. */
export function sanitiseLoopPhraseReading(value: unknown): LoopPhraseReading | null {
  if (typeof value !== 'object' || value === null) return null
  const loose = value as Record<string, unknown>
  const nominalBars = positiveBars(loose.nominalBars)
  if (nominalBars === null) return null
  return {
    nominalBars,
    phraseBars: positiveBars(loose.phraseBars),
    measuredStems: wholeCount(loose.measuredStems),
    inconclusiveStems: wholeCount(loose.inconclusiveStems)
  }
}

/** The user's answer, repaired. An answer with no usable bar count, or one
 * claiming a source this build does not know, is dropped rather than
 * guessed at -- the map then simply has no phrase yet, which is a state it
 * already handles. */
export function sanitiseCoachPhrase(value: unknown): CoachPhrase | null {
  if (typeof value !== 'object' || value === null) return null
  const loose = value as Record<string, unknown>
  const bars = positiveBars(loose.bars)
  if (bars === null) return null
  if (loose.source !== 'measured' && loose.source !== 'nominal') return null
  return { bars, source: loose.source }
}
```

- [ ] **Step 5: Run both test files**

Run: `npx vitest run src/shared/coachPhrase.test.ts src/shared/coachLines.test.ts src/renderer/src/audio/phraseCache.test.ts`
Expected: all PASS.

- [ ] **Step 6: Commit Tasks 4 and 5 together**

```bash
git add src/shared/coachPhrase.ts src/shared/coachPhrase.test.ts src/shared/coachLines.ts \
        src/shared/coachLines.test.ts src/renderer/src/audio/phraseCache.ts \
        src/renderer/src/audio/phraseCache.test.ts
git commit -m "$(cat <<'EOF'
The longest phrase in the loop, said once and then left alone

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

### Task 6: Passes, not bars

Section length becomes a count of passes of the phrase. `'verse'` joins the section types. The everything-on comment is rewritten.

**Files:**
- Create: `src/shared/coachPasses.ts`
- Create: `src/shared/coachPasses.test.ts`
- Modify: `src/shared/coachSections.ts`
- Modify: `src/shared/coachSections.test.ts`

> **Ordering note:** Steps 4–6 of this task import `CoachCells`, `cellIsOn`, `setStemAcrossPasses` and `sanitiseCoachCells` from `src/shared/coachCells.ts`, which **Task 7 creates**. Steps 1–3 (the pass arithmetic) stand alone. If you are dispatching tasks in parallel, do **Task 7 before Task 6 Step 4**; if you are working straight through, do Steps 1–3, then Task 7, then come back for Steps 4–7. Do not stub `coachCells.ts` — write it once, properly, in Task 7.

- [ ] **Step 1: Write the failing test for the pass arithmetic**

Create `src/shared/coachPasses.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  COACH_SECTION_MAX_PASSES,
  COACH_SECTION_MIN_PASSES,
  COACH_SECTION_PASS_NUDGES,
  nudgeSectionPasses,
  passesForTargetBars,
  sectionBars
} from './coachPasses'

describe('the pass nudges', () => {
  it('are plus and minus one and two passes, in panel order', () => {
    expect([...COACH_SECTION_PASS_NUDGES]).toEqual([-2, -1, 1, 2])
  })

  it('clamps rather than running away', () => {
    expect(nudgeSectionPasses(COACH_SECTION_MIN_PASSES, -2)).toBe(COACH_SECTION_MIN_PASSES)
    expect(nudgeSectionPasses(COACH_SECTION_MAX_PASSES, 2)).toBe(COACH_SECTION_MAX_PASSES)
    expect(nudgeSectionPasses(4, 2)).toBe(6)
  })

  it('never goes below one pass -- a section of no passes is not a section', () => {
    expect(COACH_SECTION_MIN_PASSES).toBe(1)
  })
})

describe('passesForTargetBars', () => {
  it('rounds a target to the nearest whole number of passes', () => {
    expect(passesForTargetBars(16, 4)).toBe(4)
    expect(passesForTargetBars(16, 8)).toBe(2)
    expect(passesForTargetBars(16, 6)).toBe(3) // 2.67 -> 3
    expect(passesForTargetBars(8, 6)).toBe(1) // 1.33 -> 1
  })

  it('gives at least one pass even for a loop longer than the target', () => {
    expect(passesForTargetBars(8, 32)).toBe(1)
  })

  it('refuses to divide by a nonsense phrase length', () => {
    expect(passesForTargetBars(16, 0)).toBe(COACH_SECTION_MIN_PASSES)
  })
})

describe('sectionBars', () => {
  it('is simply the passes times the phrase', () => {
    expect(sectionBars(4, 4)).toBe(16)
    expect(sectionBars(3, 6)).toBe(18)
  })

  it('never returns zero, so nothing downstream divides by it', () => {
    expect(sectionBars(0, 0)).toBe(1)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/shared/coachPasses.test.ts`
Expected: FAIL — `Cannot find module './coachPasses'`.

- [ ] **Step 3: Write `coachPasses.ts`**

```ts
/**
 * A section's length, measured in PASSES OF THE LOOP rather than in bars.
 *
 * WHY THIS MODULE EXISTS (spec: "Sections are measured in phrases, not
 * bars"): section lengths used to be hardcoded -- intro 8, verse 16, drop
 * 16, nudged by 4 and 8 -- with **no relationship to the loop at all**.
 * Elling caught it: "the starting loop will be different lengths... are you
 * taking number of bars into account." A 6-bar loop in a 16-bar verse gives
 * two passes and a two-bar stump cut mid-idea; a 4-bar loop in a 16-bar
 * verse is four identical repeats and nothing notices.
 *
 * So a section is N passes, boundaries always land on phrase boundaries
 * whatever the loop's length is, and the template's bar counts become
 * TARGETS that round to whole passes (passesForTargetBars).
 *
 * Bars are derived at the edges only -- the timeline write path and the
 * tension pass, both of which genuinely need a bar number.
 */

/** One pass is the smallest section this flow will build. Sixteen is a
 * deliberately generous ceiling so the nudge buttons cannot run away: at a
 * 4-bar phrase that is a 64-bar section, which is the same ceiling the old
 * bar-based COACH_SECTION_MAX_BARS had. */
export const COACH_SECTION_MIN_PASSES = 1
export const COACH_SECTION_MAX_PASSES = 16

/** "the nudges are +/-1 and +/-2 passes" (spec), in the order the panel
 * renders them. */
export const COACH_SECTION_PASS_NUDGES: readonly number[] = [-2, -1, 1, 2]

export function nudgeSectionPasses(passes: number, delta: number): number {
  const next = Math.round(passes + delta)
  return Math.max(COACH_SECTION_MIN_PASSES, Math.min(COACH_SECTION_MAX_PASSES, next))
}

/** A template's target bar count, rounded to whole passes of this loop.
 * Rounds to NEAREST rather than down, so a 16-bar target on a 6-bar phrase
 * is three passes (18 bars) rather than two (12) -- the arrangement should
 * not silently shrink because the loop is an awkward length. */
export function passesForTargetBars(targetBars: number, phraseBars: number): number {
  if (!Number.isFinite(phraseBars) || phraseBars <= 0) return COACH_SECTION_MIN_PASSES
  if (!Number.isFinite(targetBars) || targetBars <= 0) return COACH_SECTION_MIN_PASSES
  return Math.max(
    COACH_SECTION_MIN_PASSES,
    Math.min(COACH_SECTION_MAX_PASSES, Math.round(targetBars / phraseBars))
  )
}

/** The one place passes become bars. Floors at 1 so no caller can end up
 * dividing by zero or placing a zero-length clip. */
export function sectionBars(passes: number, phraseBars: number): number {
  const safePasses = Number.isFinite(passes) ? Math.max(1, Math.round(passes)) : 1
  const safePhrase = Number.isFinite(phraseBars) ? Math.max(1, Math.round(phraseBars)) : 1
  return safePasses * safePhrase
}
```

- [ ] **Step 4: Reshape `coachSections.ts`**

Replace the module doc comment's first four paragraphs with:

```ts
/**
 * What a section IS, as plain data: its type, its length in passes of the
 * loop, which stems play in which pass, and what usually follows it.
 *
 * THE RULE THIS FILE USED TO ENCODE WAS THE OPPOSITE OF TODAY'S. Until
 * 2026-09-23 a section started as the full climax loop and the user
 * subtracted, and this comment told you never to seed a draft from the
 * suggestion table. **That rule is gone, deliberately** (spec:
 * docs/superpowers/specs/2026-09-23-arrangement-map-design.md, "The map
 * arrives pre-filled, and says so"): the map now arrives filled in from a
 * template -- intro sparse, drop full, build without the hook -- because
 * "eight identical sections is the blank page again, and the whole value of
 * paint-by-numbers is that it does the imagining the user cannot do yet."
 *
 * What makes the reversal legitimate is the map itself: it shows the entire
 * song at once, so nothing is removed invisibly, and sssketchy states that
 * he made the call and states the way out ("cmd+z puts everything back on
 * if you would rather start full"). If you are about to "restore
 * consistency" by inverting this back to everything-on, read the spec
 * first: the reversal IS the feature.
 *
 * The pre-fill itself lives in ./coachMapTemplate.ts, computed rather than
 * stored, so a section on disk only ever carries the cells the user
 * CHANGED (./coachCells.ts).
 *
 * The flags key off the kinds DISCOVER tagged each stem with, carried on the
 * locked climax (LockedClimaxStem.kinds) -- never stem order, never channel
 * index, which the spec rules out twice.
 */
```

Then, in the same file:

- Add `'verse'` to `CoachSectionType` and to `COACH_SECTION_TYPE_BY_ID` / `COACH_SECTION_TYPES` (between `intro` and `build`):

```ts
export type CoachSectionType = 'intro' | 'verse' | 'build' | 'drop' | 'breakdown' | 'outro'
```

- `CoachSectionTypeDef` loses `defaultBars` entirely — a section's length now comes from the shape template's target bars (`coachShapes.ts`), rounded to passes. The record becomes:

```ts
const COACH_SECTION_TYPE_BY_ID: Record<CoachSectionType, CoachSectionTypeDef> = {
  intro: { id: 'intro', label: 'intro' },
  verse: { id: 'verse', label: 'verse' },
  build: { id: 'build', label: 'build' },
  drop: { id: 'drop', label: 'drop' },
  breakdown: { id: 'breakdown', label: 'breakdown' },
  outro: { id: 'outro', label: 'outro' }
}
```

- Delete `COACH_SECTION_MIN_BARS`, `COACH_SECTION_MAX_BARS`, `COACH_SECTION_BAR_NUDGES`, `nudgeSectionBars` and `finiteBars`.
- `COACH_SECTION_DROP_SETS` gains a verse row:

```ts
export const COACH_SECTION_DROP_SETS: Record<
  CoachSectionType,
  readonly (readonly DiscoverSlotKind[])[]
> = {
  intro: [['lead']],
  // The hook only. "the verse should hint at the drop without giving it
  // away" is the spec's own example of a good line; this is that line as
  // data. Harmony stays -- a verse with no chords is a build.
  verse: [['lead', 'bright']],
  build: [['lead', 'bright']],
  drop: [],
  breakdown: [['drums'], ['bass']],
  outro: [['lead']]
}
```

- `COACH_SECTION_TRANSITIONS` gains a verse and routes through it:

```ts
export const COACH_SECTION_TRANSITIONS: Record<CoachSectionType, readonly CoachSectionType[]> = {
  intro: ['verse', 'build', 'drop'],
  verse: ['build', 'drop'],
  build: ['drop'],
  drop: ['verse', 'breakdown', 'outro'],
  breakdown: ['build', 'drop'],
  outro: []
}
```

- `CoachSection` and `CoachSectionDraft` are reshaped (the cells type arrives in Task 7; write this after it, or write `Record<string, boolean>` inline and tighten it in Task 7):

```ts
/** One section of the map. Plain, persisted data. */
export interface CoachSection {
  /** Stable across re-sizes, renames and reorders -- the map UI keys its
   * columns off this, and a cell edit must not follow the index when a
   * section is inserted before it. Never shown to the user. */
  id: string
  type: CoachSectionType
  /** The user's own name for it; defaults to the type's label. */
  name: string
  /** Its length, as a count of passes of the phrase (./coachPasses.ts).
   * Bars are derived -- sectionBars(passes, phraseBars) -- because the
   * phrase length is the user's answer and can change under a section
   * without rebuilding it. */
  passes: number
  /** The cells the USER changed, sparse (./coachCells.ts). Everything not
   * in here is answered by the template (./coachMapTemplate.ts). An empty
   * record is a section exactly as the template drew it, which is what a
   * freshly built map is made of. */
  cells: CoachCells
  /** Where it really went on the timeline. */
  startBar: number
  /** climax stem path -> the groupId that stem was placed as, which is also
   * the channel row it created. Later sections reuse these so one stem
   * keeps one lane -- see sectionLaneChannelIds. */
  placedGroupIds: Record<string, string>
}

/** The section currently being carved. Same shape minus everything that
 * only exists once it has really been placed. */
export interface CoachSectionDraft {
  type: CoachSectionType
  name: string
  passes: number
  cells: CoachCells
}
```

- `sectionKeptStems(climax, droppedPaths)` is replaced by a per-pass reader that takes the template's answer as a callback, so this module stays free of the template:

```ts
/** The stems that actually play in ONE PASS of this section, in the locked
 * climax's own row order. `fallback` answers a cell the user has not
 * touched -- the template's own answer (./coachMapTemplate.ts). */
export function sectionStemsInPass(
  climax: LockedClimax,
  section: { cells: CoachCells },
  passIndex: number,
  stems: readonly LockedClimaxStem[],
  fallback: (stem: LockedClimaxStem, passIndex: number) => boolean
): LockedClimaxStem[] {
  return stems.filter((stem) =>
    cellIsOn(section.cells, passIndex, stem.path, fallback(stem, passIndex))
  )
}
```

- `nextCoachSectionStartBar(sections, fallbackBar)` needs the phrase length now:

```ts
export function nextCoachSectionStartBar(
  sections: readonly CoachSection[],
  fallbackBar: number,
  phraseBars: number
): number {
  if (sections.length === 0) return Math.max(0, Math.round(fallbackBar))
  const last = sections[sections.length - 1]
  return last.startBar + sectionBars(last.passes, phraseBars)
}
```

- `newCoachSectionDraft` no longer defaults to everything-on; it defaults to the template, which means it defaults to **an empty `cells` record**:

```ts
/**
 * A new section, PRE-FILLED from the template.
 *
 * `cells: {}` does not mean "nothing plays" -- it means "nothing has been
 * overridden", so every cell reads whatever the template says for this
 * section type. That is the deliberate reversal of the old everything-on
 * rule; see this module's own doc comment before changing it.
 */
export function newCoachSectionDraft(
  type: CoachSectionType,
  sections: readonly CoachSection[],
  passes: number
): CoachSectionDraft {
  return { type, name: defaultSectionName(type, sections), passes, cells: {} }
}
```

- [ ] **Step 5: Migrate the loader**

`sanitiseCoachSections` and `sanitiseCoachSectionDraft` must read BOTH shapes. A project saved before this change has `bars` and `droppedPaths` and no `id`/`passes`/`cells`:

```ts
/** Sections saved before 2026-09-23 carried `bars` and `droppedPaths`.
 * They are brought up to today's shape here, once, on load: the bar count
 * becomes a pass count at the phrase length the project now has (or one
 * pass when it has none yet -- the map's own re-size fixes that the moment
 * he answers), and each dropped path becomes an explicit OFF cell in every
 * pass, which is exactly what it meant. */
function migratedPasses(loose: Record<string, unknown>, phraseBars: number): number {
  const passes = loose.passes
  if (typeof passes === 'number' && Number.isFinite(passes)) {
    return Math.max(COACH_SECTION_MIN_PASSES, Math.min(COACH_SECTION_MAX_PASSES, Math.round(passes)))
  }
  const bars = loose.bars
  if (typeof bars === 'number' && Number.isFinite(bars)) return passesForTargetBars(bars, phraseBars)
  return COACH_SECTION_MIN_PASSES
}

function migratedCells(loose: Record<string, unknown>, passes: number): CoachCells {
  const cells = sanitiseCoachCells(loose.cells)
  if (Object.keys(cells).length > 0 || !Array.isArray(loose.droppedPaths)) return cells
  let migrated: CoachCells = {}
  for (const path of loose.droppedPaths) {
    if (typeof path !== 'string') continue
    migrated = setStemAcrossPasses(migrated, passes, path, false)
  }
  return migrated
}
```

`sanitiseCoachSections(value, phraseBars)` and `sanitiseCoachSectionDraft(value, phraseBars)` both take the phrase length so the migration can do its arithmetic; the caller (`sanitiseLoadedCoach`) reads its own already-sanitised `phrase?.bars ?? 1`. Mint a missing `id` from the index: `` `section-${index}` `` — stable within a load, which is all it has to be.

- [ ] **Step 6: Update `coachSections.test.ts`**

Every `bars:` becomes `passes:`, every `droppedPaths:` becomes `cells:`, and add:

```ts
it('adds a verse, which loses the hook and keeps the harmony', () => {
  expect(COACH_SECTION_DROP_SETS.verse).toEqual([['lead', 'bright']])
  expect(isSuggestedDrop('verse', stem('/hook.wav', ['lead', 'bright']))).toBe(true)
  expect(isSuggestedDrop('verse', stem('/harmony.wav', ['lead', 'warm']))).toBe(false)
})

it('a fresh draft overrides NOTHING -- the template fills it in', () => {
  expect(newCoachSectionDraft('intro', [], 2).cells).toEqual({})
})

it('brings a pre-map section up to shape, dropped paths and all', () => {
  const loaded = sanitiseCoachSections(
    [{ type: 'intro', name: 'intro', bars: 16, droppedPaths: ['/hook.wav'], startBar: 0 }],
    4
  )
  expect(loaded[0].passes).toBe(4)
  expect(loaded[0].id).not.toBe('')
  expect(cellIsOn(loaded[0].cells, 0, '/hook.wav', true)).toBe(false)
  expect(cellIsOn(loaded[0].cells, 3, '/hook.wav', true)).toBe(false)
  expect(cellIsOn(loaded[0].cells, 0, '/kick.wav', true)).toBe(true)
})
```

- [ ] **Step 7: Run and commit**

Run: `npx vitest run src/shared/coachPasses.test.ts src/shared/coachSections.test.ts`
Expected: PASS. Other files are still red — Tasks 7–9 finish the reshape.

```bash
git add src/shared/coachPasses.ts src/shared/coachPasses.test.ts \
        src/shared/coachSections.ts src/shared/coachSections.test.ts
git commit -m "$(cat <<'EOF'
A section is however many times round the loop it is

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

### Task 7: Per-pass cells

The address of one pass of one stem in one section, and the runs it collapses to. Read "How per-pass cells are modelled" above before starting.

**Files:**
- Create: `src/shared/coachCells.ts`
- Create: `src/shared/coachCells.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/shared/coachCells.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  cellIsOn,
  cellRuns,
  coachCellKey,
  parseCoachCellKey,
  runsToCells,
  sanitiseCoachCells,
  setCell,
  setStemAcrossPasses,
  type CoachCells
} from './coachCells'

describe('the cell key', () => {
  it('round-trips a pass and a path', () => {
    const key = coachCellKey(3, '/stems/kick 01.wav')
    expect(parseCoachCellKey(key)).toEqual({ passIndex: 3, path: '/stems/kick 01.wav' })
  })

  it('survives a path containing the separator', () => {
    const key = coachCellKey(0, '/odd|name.wav')
    expect(parseCoachCellKey(key)).toEqual({ passIndex: 0, path: '/odd|name.wav' })
  })

  it('refuses a key it did not write', () => {
    expect(parseCoachCellKey('nonsense')).toBeNull()
    expect(parseCoachCellKey('x|/a.wav')).toBeNull()
    expect(parseCoachCellKey('-1|/a.wav')).toBeNull()
  })
})

describe('cellIsOn', () => {
  it('falls back to the template for a cell nobody touched', () => {
    expect(cellIsOn({}, 0, '/a.wav', true)).toBe(true)
    expect(cellIsOn({}, 0, '/a.wav', false)).toBe(false)
  })

  it('lets an explicit answer beat the template in both directions', () => {
    const off = setCell({}, 0, '/a.wav', false)
    expect(cellIsOn(off, 0, '/a.wav', true)).toBe(false)
    const on = setCell({}, 0, '/a.wav', true)
    expect(cellIsOn(on, 0, '/a.wav', false)).toBe(true)
  })

  it('keeps an override for a pass that is out of range right now', () => {
    // Shrink then grow: the edit was never destroyed.
    const cells = setCell({}, 5, '/a.wav', false)
    expect(cellIsOn(cells, 5, '/a.wav', true)).toBe(false)
  })
})

describe('setStemAcrossPasses', () => {
  it('writes one explicit answer per pass', () => {
    const cells = setStemAcrossPasses({}, 3, '/a.wav', false)
    expect(Object.keys(cells)).toHaveLength(3)
    for (let pass = 0; pass < 3; pass += 1) {
      expect(cellIsOn(cells, pass, '/a.wav', true)).toBe(false)
    }
  })

  it('leaves every other stem alone', () => {
    const cells = setStemAcrossPasses(setCell({}, 0, '/b.wav', false), 2, '/a.wav', true)
    expect(cellIsOn(cells, 0, '/b.wav', true)).toBe(false)
  })
})

describe('cellRuns', () => {
  const always = (): boolean => true
  const never = (): boolean => false

  it('collapses contiguous on-passes into one run', () => {
    let cells: CoachCells = {}
    cells = setCell(cells, 0, '/a.wav', false)
    expect(cellRuns(cells, 4, '/a.wav', always)).toEqual([{ startPass: 1, passCount: 3 }])
  })

  it('reports two runs for a stem that leaves and comes back', () => {
    let cells: CoachCells = {}
    cells = setCell(cells, 1, '/a.wav', false)
    expect(cellRuns(cells, 4, '/a.wav', always)).toEqual([
      { startPass: 0, passCount: 1 },
      { startPass: 2, passCount: 2 }
    ])
  })

  it('reports nothing for a stem that never plays', () => {
    expect(cellRuns({}, 4, '/a.wav', never)).toEqual([])
  })

  it('reports one whole-section run for a stem that always plays', () => {
    expect(cellRuns({}, 4, '/a.wav', always)).toEqual([{ startPass: 0, passCount: 4 }])
  })

  it('asks the template per PASS, so a staggered arrival reads as one run', () => {
    // The template brings this stem in on pass 2 and nothing overrides it.
    const arrivesLate = (passIndex: number): boolean => passIndex >= 2
    expect(cellRuns({}, 4, '/a.wav', arrivesLate)).toEqual([{ startPass: 2, passCount: 2 }])
  })
})

describe('runsToCells', () => {
  const always = (): boolean => true
  const never = (): boolean => false

  it('is the exact inverse of cellRuns', () => {
    let cells: CoachCells = {}
    cells = setCell(cells, 1, '/a.wav', false)
    cells = setCell(cells, 3, '/a.wav', false)
    const runs = cellRuns(cells, 5, '/a.wav', always)
    const rebuilt = runsToCells(runs, 5, '/a.wav')
    // Explicit in both directions, so NO template can change the answer.
    expect(cellRuns(rebuilt, 5, '/a.wav', always)).toEqual(runs)
    expect(cellRuns(rebuilt, 5, '/a.wav', never)).toEqual(runs)
  })

  it('writes an explicit answer for every pass, so no template can change it', () => {
    expect(Object.keys(runsToCells([{ startPass: 1, passCount: 2 }], 4, '/a.wav'))).toHaveLength(4)
  })
})

describe('sanitiseCoachCells', () => {
  it('keeps only real keys with real booleans', () => {
    expect(
      sanitiseCoachCells({ '0|/a.wav': false, 'x|/b.wav': true, '1|/c.wav': 'yes' })
    ).toEqual({ '0|/a.wav': false })
  })

  it('survives anything a hand-edited file can contain', () => {
    expect(sanitiseCoachCells(null)).toEqual({})
    expect(sanitiseCoachCells([1, 2, 3])).toEqual({})
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/shared/coachCells.test.ts`
Expected: FAIL — `Cannot find module './coachCells'`.

- [ ] **Step 3: Write the implementation**

Create `src/shared/coachCells.ts`:

```ts
/**
 * One pass of one stem in one section: the smallest thing the map can
 * toggle.
 *
 * WHY A CELL EXISTS AT ALL (spec, "Cells split per pass"): "A section runs
 * for N passes of the loop, and each pass is its own cell... stems arrive
 * and leave across a section, so four passes of a four-bar loop stop being
 * four identical bars."
 *
 * THE SHAPE, AND WHY IT IS SPARSE. A section stores only the cells the USER
 * CHANGED. Every other cell is answered by a pure template function
 * (./coachMapTemplate.ts), handed in here as `fallback`. Three things fall
 * out of that, all of them load-bearing:
 *
 * 1. **Re-sizing is free.** "He can change it afterwards; the map re-sizes,
 *    it does not rebuild" (spec). Growing a section adds passes that read
 *    the template; shrinking and growing back RESTORES the user's edits,
 *    because nothing was ever deleted. A dense grid has to truncate or
 *    invent on every resize, and a truncating resize loses work silently.
 * 2. **The pre-fill cannot drift.** There is exactly one implementation of
 *    "what the template says", and it is tested in one place. A fresh map
 *    is `{}` on disk.
 * 3. **The round trip has somewhere to land.** Reading the timeline back
 *    gives a resolved boolean per cell; writing those in explicitly is
 *    legal and unambiguous, because cellIsOn always takes a fallback and
 *    always returns a boolean. runsToCells below is that write.
 *
 * The key is scoped INSIDE a section (`passIndex|path`), never global, so
 * reordering or renaming sections costs nothing.
 */

export type CoachCells = Record<string, boolean>

/** One stem's uninterrupted stretch of on-passes within one section. This
 * is what actually becomes a clip: a stem playing passes 1-3 of a 4-pass
 * section is ONE clip three passes long, which is what a person would draw
 * and what keeps the clip count sane. */
export interface CoachCellRun {
  startPass: number
  passCount: number
}

export interface CoachCellRef {
  passIndex: number
  path: string
}

/** The pass index comes FIRST and the separator is the first '|' only, so a
 * path containing a pipe (rare, but files are files) still parses. */
export function coachCellKey(passIndex: number, path: string): string {
  return `${Math.max(0, Math.round(passIndex))}|${path}`
}

export function parseCoachCellKey(key: string): CoachCellRef | null {
  const split = key.indexOf('|')
  if (split <= 0) return null
  const passIndex = Number(key.slice(0, split))
  if (!Number.isInteger(passIndex) || passIndex < 0) return null
  const path = key.slice(split + 1)
  if (path === '') return null
  return { passIndex, path }
}

/** Whether this cell plays. `fallback` is the template's own answer, and is
 * required rather than defaulted: a caller that does not know what the
 * template says has no business asking this question. */
export function cellIsOn(
  cells: CoachCells,
  passIndex: number,
  path: string,
  fallback: boolean
): boolean {
  return cells[coachCellKey(passIndex, path)] ?? fallback
}

/** One cell set explicitly. Always writes -- there is no "same as the
 * template, so drop the entry" tidying, because that would make a later
 * template change silently rewrite a cell the user had already decided. */
export function setCell(
  cells: CoachCells,
  passIndex: number,
  path: string,
  on: boolean
): CoachCells {
  return { ...cells, [coachCellKey(passIndex, path)]: on }
}

/** One stem, every pass of this section -- the whole-row gesture. */
export function setStemAcrossPasses(
  cells: CoachCells,
  passes: number,
  path: string,
  on: boolean
): CoachCells {
  const next = { ...cells }
  for (let passIndex = 0; passIndex < passes; passIndex += 1) {
    next[coachCellKey(passIndex, path)] = on
  }
  return next
}

/** This stem's on-passes, collapsed into contiguous runs, in pass order.
 *
 * `fallback` is a FUNCTION OF THE PASS, not a single boolean, because the
 * template's answer genuinely varies across a section -- a stem that
 * arrives on pass 2 of an intro is off, off, on, on with nothing stored at
 * all (./coachMapTemplate.ts). A boolean here would have flattened exactly
 * the staggering this whole feature exists for. */
export function cellRuns(
  cells: CoachCells,
  passes: number,
  path: string,
  fallback: (passIndex: number) => boolean
): CoachCellRun[] {
  const runs: CoachCellRun[] = []
  let open: CoachCellRun | null = null
  for (let passIndex = 0; passIndex < passes; passIndex += 1) {
    if (cellIsOn(cells, passIndex, path, fallback(passIndex))) {
      if (open === null) open = { startPass: passIndex, passCount: 1 }
      else open.passCount += 1
    } else if (open !== null) {
      runs.push(open)
      open = null
    }
  }
  if (open !== null) runs.push(open)
  return runs
}

/**
 * Runs back into explicit cells -- the exact inverse of cellRuns, and the
 * half of the map<->arrangement round trip that lives in src/shared/.
 *
 * Writes EVERY pass, on and off, not just the on ones: the point of reading
 * the arrangement back is that the arrangement is now the truth, and a cell
 * left to the template would let the template overrule what is really on the
 * timeline.
 */
export function runsToCells(
  runs: readonly CoachCellRun[],
  passes: number,
  path: string
): CoachCells {
  const on = new Set<number>()
  for (const run of runs) {
    for (let i = 0; i < run.passCount; i += 1) on.add(run.startPass + i)
  }
  const cells: CoachCells = {}
  for (let passIndex = 0; passIndex < passes; passIndex += 1) {
    cells[coachCellKey(passIndex, path)] = on.has(passIndex)
  }
  return cells
}

/** Repair-rather-than-trust, like every other loader in this layer: a
 * `.sssketchproj` is plain JSON people can and do hand-edit, and a load must
 * never throw. A key this module did not write, or a value that is not a
 * boolean, is dropped rather than guessed at -- the cell then falls back to
 * the template, which is the safest thing an unreadable cell can do. */
export function sanitiseCoachCells(value: unknown): CoachCells {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const cells: CoachCells = {}
  for (const [key, on] of Object.entries(value as Record<string, unknown>)) {
    if (typeof on !== 'boolean') continue
    if (parseCoachCellKey(key) === null) continue
    cells[key] = on
  }
  return cells
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/shared/coachCells.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/coachCells.ts src/shared/coachCells.test.ts
git commit -m "$(cat <<'EOF'
Each time round the loop gets its own square

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

### Task 8: The shape templates and the pre-fill

`A B D A`, `A B C D B C D A`, `A B C D E C D A` — as tested tables — turning a locked climax, a phrase length and an answer to "what is this loop?" into a pre-filled section list.

**Files:**
- Create: `src/shared/coachShapes.ts`
- Create: `src/shared/coachShapes.test.ts`
- Create: `src/shared/coachMapTemplate.ts`
- Create: `src/shared/coachMapTemplate.test.ts`

- [ ] **Step 1: Write the failing test for the shapes**

Create `src/shared/coachShapes.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  COACH_LOOP_ANSWERS,
  COACH_LOOP_HOME_TYPE,
  COACH_SHAPES,
  coachShapeDef,
  isCoachLoopAnswer,
  isCoachShapeId,
  shapeSectionTypes,
  targetBarsFor
} from './coachShapes'

describe('the three shapes', () => {
  it('are exactly the spec table, in its own letters', () => {
    expect(COACH_SHAPES.map((shape) => [shape.id, shape.letters.join(' ')])).toEqual([
      ['short', 'A B D A'],
      ['standard', 'A B C D B C D A'],
      ['long', 'A B C D E C D A']
    ])
  })

  it('carry the rough durations the spec quotes', () => {
    expect(COACH_SHAPES.map((shape) => shape.approxMinutes)).toEqual([2, 4, 6])
  })

  it('turn the last A into an outro and the first into an intro', () => {
    expect(shapeSectionTypes('short')).toEqual(['intro', 'verse', 'drop', 'outro'])
    expect(shapeSectionTypes('standard')).toEqual([
      'intro',
      'verse',
      'build',
      'drop',
      'verse',
      'build',
      'drop',
      'outro'
    ])
    expect(shapeSectionTypes('long')).toEqual([
      'intro',
      'verse',
      'build',
      'drop',
      'breakdown',
      'build',
      'drop',
      'outro'
    ])
  })

  it('refuses a shape id it does not know', () => {
    expect(isCoachShapeId('standard')).toBe(true)
    expect(isCoachShapeId('epic')).toBe(false)
    expect(coachShapeDef('long').letters).toHaveLength(8)
  })
})

describe('the target bar counts', () => {
  it('follow the article: verse 16 then longer, build 8, drop 16', () => {
    expect(targetBarsFor('verse', 0)).toBe(16)
    expect(targetBarsFor('verse', 1)).toBe(24)
    expect(targetBarsFor('build', 0)).toBe(8)
    expect(targetBarsFor('build', 1)).toBe(8)
    expect(targetBarsFor('drop', 0)).toBe(16)
    expect(targetBarsFor('intro', 0)).toBe(8)
    expect(targetBarsFor('outro', 0)).toBe(8)
  })

  it('holds the last figure for a section beyond the table', () => {
    expect(targetBarsFor('verse', 9)).toBe(24)
  })
})

describe('what is this loop', () => {
  it('offers four answers, unsure included', () => {
    expect([...COACH_LOOP_ANSWERS]).toEqual(['drop', 'verse', 'intro', 'unsure'])
    expect(isCoachLoopAnswer('unsure')).toBe(true)
    expect(isCoachLoopAnswer('chorus')).toBe(false)
  })

  it('lands unsure on the drop, which is where the method puts the material', () => {
    expect(COACH_LOOP_HOME_TYPE.unsure).toBe('drop')
    expect(COACH_LOOP_HOME_TYPE.verse).toBe('verse')
  })
})
```

- [ ] **Step 2: Run it, watch it fail, then write `coachShapes.ts`**

```ts
/**
 * How long a journey, and where the material the user already has lands in
 * it.
 *
 * Both tables come straight from the spec
 * (docs/superpowers/specs/2026-09-23-arrangement-map-design.md, "Getting
 * started: two questions"), which in turn reads them off
 * edmprod.com/beatport-analysis. The finding that shapes this file: hardstyle,
 * future bass and big-room tracks all land on nearly the same section ORDER.
 * What actually differs by genre is section LENGTH. **That is why there is no
 * genre picker** -- a genre list would mostly be one template wearing six
 * names, and someone would have to be right about genres. Do not add one.
 */

import type { CoachSectionType } from './coachSections'

export type CoachShapeId = 'short' | 'standard' | 'long'

/** The article's own letter notation, kept as letters because that is how
 * the shapes are SHOWN to the user -- `A B C D B C D A` reads as a journey
 * in a way a list of six words does not. */
export type CoachShapeLetter = 'A' | 'B' | 'C' | 'D' | 'E'

/** A intro/outro · B verse · C build · D drop · E breakdown (spec). `A` maps
 * to intro here; shapeSectionTypes below turns the LAST one into an outro,
 * which is the only thing the letter leaves ambiguous. */
export const COACH_SHAPE_LETTER_TYPE: Record<CoachShapeLetter, CoachSectionType> = {
  A: 'intro',
  B: 'verse',
  C: 'build',
  D: 'drop',
  E: 'breakdown'
}

export interface CoachShapeDef {
  id: CoachShapeId
  /** Lowercase, like all UI copy in this app. */
  label: string
  letters: readonly CoachShapeLetter[]
  /** Roughly, at an ordinary tempo -- shown next to the letters so the
   * choice reads as a length rather than as a code. */
  approxMinutes: number
}

const COACH_SHAPE_BY_ID: Record<CoachShapeId, CoachShapeDef> = {
  short: { id: 'short', label: 'short', letters: ['A', 'B', 'D', 'A'], approxMinutes: 2 },
  standard: {
    id: 'standard',
    label: 'standard',
    letters: ['A', 'B', 'C', 'D', 'B', 'C', 'D', 'A'],
    approxMinutes: 4
  },
  long: {
    id: 'long',
    label: 'long',
    letters: ['A', 'B', 'C', 'D', 'E', 'C', 'D', 'A'],
    approxMinutes: 6
  }
}

export const COACH_SHAPES: readonly CoachShapeDef[] = [
  COACH_SHAPE_BY_ID.short,
  COACH_SHAPE_BY_ID.standard,
  COACH_SHAPE_BY_ID.long
]

export function coachShapeDef(shape: CoachShapeId): CoachShapeDef {
  return COACH_SHAPE_BY_ID[shape]
}

export function isCoachShapeId(value: unknown): value is CoachShapeId {
  return typeof value === 'string' && value in COACH_SHAPE_BY_ID
}

/** The shape as real section types. The only rule beyond the letter table
 * is that the FINAL `A` is an outro -- the same section kind at the other
 * end of the track, which is what the letter has always meant. */
export function shapeSectionTypes(shape: CoachShapeId): CoachSectionType[] {
  const letters = coachShapeDef(shape).letters
  return letters.map((letter, index) =>
    letter === 'A' && index === letters.length - 1 ? 'outro' : COACH_SHAPE_LETTER_TYPE[letter]
  )
}

/**
 * "Target lengths from the article, rounded to whole passes: intro/outro
 * 8-16 bars, verse 16 (second 16-32), build 8, drop 8-16 (second the same or
 * longer)" (spec).
 *
 * The spec gives RANGES; these are the single figures picked from them, and
 * the reasoning is written down so a later tune is a decision rather than a
 * rediscovery: intro/outro take the bottom of their range (an opening that
 * outstays its welcome is the commonest fault in a first arrangement), the
 * verse takes its stated 16 and then the midpoint of 16-32 for the second,
 * the build takes its one figure, and the drop takes the TOP of 8-16 because
 * it is the payoff. Every one of them is a TARGET -- passesForTargetBars
 * rounds it to whole passes of whatever the phrase turns out to be.
 *
 * Indexed by how many sections of that type are already down, so "the
 * second verse is longer" is data rather than a special case.
 */
export const COACH_SECTION_TARGET_BARS: Record<CoachSectionType, readonly number[]> = {
  intro: [8],
  verse: [16, 24],
  build: [8],
  drop: [16],
  breakdown: [16],
  outro: [8]
}

/** The target for the `ordinal`-th section of this type, holding the last
 * figure for anything beyond the table. */
export function targetBarsFor(type: CoachSectionType, ordinal: number): number {
  const targets = COACH_SECTION_TARGET_BARS[type]
  const index = Math.max(0, Math.min(targets.length - 1, Math.round(ordinal)))
  return targets[index]
}

/** "What is this loop?" -- drop / verse / intro / not sure (spec). It
 * "decides where the material the user already has lands in the structure",
 * and it replaces all six of phase one's steps. */
export type CoachLoopAnswer = 'drop' | 'verse' | 'intro' | 'unsure'

export const COACH_LOOP_ANSWERS: readonly CoachLoopAnswer[] = ['drop', 'verse', 'intro', 'unsure']

export function isCoachLoopAnswer(value: unknown): value is CoachLoopAnswer {
  return COACH_LOOP_ANSWERS.includes(value as CoachLoopAnswer)
}

/** Which section type the user's loop IS -- the one section the pre-fill
 * leaves completely full, because it is the thing he actually built.
 *
 * 'unsure' lands on the drop, and says so rather than pretending to know:
 * the method this whole feature follows builds the climax first and
 * subtracts from it, so the drop is where unattributed material belongs.
 * Choosing it is a default, not a claim about his track, and every cell it
 * produces is one toggle away from being wrong-and-fixed. */
export const COACH_LOOP_HOME_TYPE: Record<CoachLoopAnswer, CoachSectionType> = {
  drop: 'drop',
  verse: 'verse',
  intro: 'intro',
  unsure: 'drop'
}
```

- [ ] **Step 3: Write the failing test for the template**

Create `src/shared/coachMapTemplate.test.ts`. The headline test is the spec's own drawing:

```ts
import { describe, expect, it } from 'vitest'
import type { LockedClimax, LockedClimaxStem } from './coachClimax'
import { cellIsOn } from './coachCells'
import {
  buildCoachMapSections,
  coachMapRowOrder,
  relayoutCoachSections,
  resizeCoachMapToPhrase,
  templateCellOn
} from './coachMapTemplate'
import { sectionBars } from './coachPasses'

function stem(path: string, kinds: LockedClimaxStem['kinds'], role: LockedClimaxStem['role']) {
  return {
    path,
    name: path,
    author: 'e',
    type: 'fx' as const,
    durationSec: 4,
    barLength: 4,
    kinds,
    role,
    gain: 1
  }
}

const climax: LockedClimax = {
  bpm: 120,
  barLength: 4,
  lockedAt: 0,
  stems: [
    stem('/hook.wav', ['lead', 'bright'], 'lead'),
    stem('/kick.wav', ['drums'], 'drums'),
    stem('/lead.wav', ['lead', 'warm'], 'lead'),
    stem('/bass.wav', ['bass'], 'bass')
  ]
}

describe('coachMapRowOrder', () => {
  it('puts the foundation first whatever order the climax was locked in', () => {
    expect(coachMapRowOrder(climax).map((s) => s.path)).toEqual([
      '/kick.wav',
      '/bass.wav',
      '/hook.wav',
      '/lead.wav'
    ])
  })
})

describe('templateCellOn', () => {
  it('draws the spec own verse: four stems arriving across four passes', () => {
    const rows = coachMapRowOrder(climax)
    const grid = rows.map((row, rank) =>
      [0, 1, 2, 3]
        .map((pass) =>
          templateCellOn({
            type: 'verse',
            homeType: 'drop',
            stem: row,
            rank,
            playingCount: rows.length,
            passIndex: pass,
            passes: 4
          })
            ? 'x'
            : '.'
        )
        .join('')
    )
    // kick all four, bass from pass 1, then the leads -- exactly the map
    // drawn in the spec.
    expect(grid[0]).toBe('xxxx')
    expect(grid[1]).toBe('.xxx')
  })

  it('leaves the home section completely full -- it is the loop he built', () => {
    const rows = coachMapRowOrder(climax)
    for (const [rank, row] of rows.entries()) {
      expect(
        templateCellOn({
          type: 'drop',
          homeType: 'drop',
          stem: row,
          rank,
          playingCount: rows.length,
          passIndex: 0,
          passes: 2
        })
      ).toBe(true)
    }
  })

  it('takes the hook out of a build', () => {
    const rows = coachMapRowOrder(climax)
    const hook = rows.findIndex((row) => row.path === '/hook.wav')
    expect(
      templateCellOn({
        type: 'build',
        homeType: 'drop',
        stem: rows[hook],
        rank: hook,
        playingCount: rows.length,
        passIndex: 0,
        passes: 2
      })
    ).toBe(false)
  })

  it('thins an outro OUT, foundation last', () => {
    const rows = coachMapRowOrder(climax)
    expect(
      templateCellOn({
        type: 'outro',
        homeType: 'drop',
        stem: rows[0],
        rank: 0,
        playingCount: 2,
        passIndex: 3,
        passes: 4
      })
    ).toBe(true)
    expect(
      templateCellOn({
        type: 'outro',
        homeType: 'drop',
        stem: rows[1],
        rank: 1,
        playingCount: 2,
        passIndex: 3,
        passes: 4
      })
    ).toBe(false)
  })
})

describe('buildCoachMapSections', () => {
  it('lays out the shape, contiguously, with every section pre-filled', () => {
    const sections = buildCoachMapSections({
      shape: 'short',
      loopIs: 'drop',
      phraseBars: 4,
      climax,
      firstStartBar: 0
    })
    expect(sections.map((s) => s.type)).toEqual(['intro', 'verse', 'drop', 'outro'])
    // 8-bar intro target at a 4-bar phrase is two passes.
    expect(sections[0].passes).toBe(2)
    expect(sections[1].passes).toBe(4)
    expect(sections[0].startBar).toBe(0)
    expect(sections[1].startBar).toBe(8)
    expect(sections[2].startBar).toBe(24)
  })

  it('overrides NOTHING -- pre-filled means the template, not stored cells', () => {
    const sections = buildCoachMapSections({
      shape: 'standard',
      loopIs: 'unsure',
      phraseBars: 4,
      climax,
      firstStartBar: 0
    })
    for (const section of sections) expect(section.cells).toEqual({})
  })

  it('numbers repeated types the way a person would name them', () => {
    const sections = buildCoachMapSections({
      shape: 'standard',
      loopIs: 'drop',
      phraseBars: 4,
      climax,
      firstStartBar: 0
    })
    expect(sections.map((s) => s.name)).toEqual([
      'intro',
      'verse',
      'build',
      'drop',
      'verse 2',
      'build 2',
      'drop 2',
      'outro'
    ])
  })

  it('gives every section its own stable id', () => {
    const sections = buildCoachMapSections({
      shape: 'long',
      loopIs: 'drop',
      phraseBars: 8,
      climax,
      firstStartBar: 0
    })
    expect(new Set(sections.map((s) => s.id)).size).toBe(sections.length)
  })

  it('starts after whatever is already on the timeline', () => {
    const sections = buildCoachMapSections({
      shape: 'short',
      loopIs: 'drop',
      phraseBars: 4,
      climax,
      firstStartBar: 32
    })
    expect(sections[0].startBar).toBe(32)
  })
})

describe('resizeCoachMapToPhrase', () => {
  const built = buildCoachMapSections({
    shape: 'short',
    loopIs: 'drop',
    phraseBars: 8,
    climax,
    firstStartBar: 0
  })

  it('RE-SIZES rather than rebuilding: ids, names, types and cells all survive', () => {
    const edited = built.map((section, i) =>
      i === 1 ? { ...section, name: 'my verse', cells: { '0|/kick.wav': false } } : section
    )
    const resized = resizeCoachMapToPhrase(edited, 8, 4)
    expect(resized.map((s) => s.id)).toEqual(built.map((s) => s.id))
    expect(resized.map((s) => s.type)).toEqual(built.map((s) => s.type))
    expect(resized[1].name).toBe('my verse')
    expect(cellIsOn(resized[1].cells, 0, '/kick.wav', true)).toBe(false)
  })

  it('keeps each section about the same number of BARS at the new phrase', () => {
    const before = sectionBars(built[1].passes, 8)
    const resized = resizeCoachMapToPhrase(built, 8, 4)
    expect(sectionBars(resized[1].passes, 4)).toBe(before)
  })

  it('re-lays the sections out contiguously from the first one', () => {
    const resized = resizeCoachMapToPhrase(built, 8, 4)
    expect(resized[0].startBar).toBe(built[0].startBar)
    for (let i = 1; i < resized.length; i += 1) {
      expect(resized[i].startBar).toBe(resized[i - 1].startBar + sectionBars(resized[i - 1].passes, 4))
    }
  })
})

describe('relayoutCoachSections', () => {
  it('does nothing to an empty map', () => {
    expect(relayoutCoachSections([], 4, 0)).toEqual([])
  })
})
```

- [ ] **Step 4: Run it to verify it fails, then write `coachMapTemplate.ts`**

```ts
/**
 * The pre-fill: what the map looks like before anybody touches it.
 *
 * THE RULE (spec, "The map arrives pre-filled, and says so"): the map
 * arrives filled in -- intro sparse, drop full, build without the hook --
 * and this **deliberately reverses** the everything-on/user-subtracts rule
 * of the superseded phase two. "The reversal is the point: eight identical
 * sections is the blank page again, and the whole value of paint-by-numbers
 * is that it does the imagining the user cannot do yet."
 *
 * Two things keep that legitimate, and both are structural rather than
 * promised: the map shows the entire song at once, so nothing is removed
 * invisibly; and everything here is COMPUTED, never stored, so a section on
 * disk carries only the cells the user changed and undoing back to full is
 * one cmd+z (which sssketchy says out loud --
 * COACH_PREFILLED_LINE_TEMPLATES).
 *
 * What it does NOT do: it never reads a waveform, a trait or a gain. Its
 * whole input is a section TYPE, the kinds Discover already tagged each stem
 * with, and a rank in the row order. Every cell it draws is a statement
 * about song structure, which is true regardless of what the user made --
 * the spec's own test for a legitimate claim.
 */

import { cellIsOn, type CoachCells } from './coachCells'
import { isSuggestedDrop, defaultSectionName, type CoachSection, type CoachSectionType } from './coachSections'
import { passesForTargetBars, sectionBars } from './coachPasses'
import { COACH_LOOP_HOME_TYPE, shapeSectionTypes, targetBarsFor, type CoachLoopAnswer, type CoachShapeId } from './coachShapes'
import type { LockedClimax, LockedClimaxStem } from './coachClimax'
import type { ArrangeRole } from './stemRole'

/** Row order: the foundation at the top, the decoration at the bottom. The
 * same order the spec's own map is drawn in (kick, bass, lead, hook), and
 * the order the stagger below builds in. Ties keep the locked climax's own
 * order, which is Discover's, which is the order the user added them. */
export const COACH_MAP_ROW_RANK: Record<ArrangeRole, number> = {
  drums: 0,
  bass: 1,
  lead: 2,
  backing: 3,
  vocal: 4,
  fill: 5,
  textureFx: 6,
  aux: 7
}

export function coachMapRowOrder(climax: LockedClimax): LockedClimaxStem[] {
  return [...climax.stems]
    .map((stem, index) => ({ stem, index }))
    .sort((a, b) => {
      const rank = COACH_MAP_ROW_RANK[a.stem.role] - COACH_MAP_ROW_RANK[b.stem.role]
      return rank !== 0 ? rank : a.index - b.index
    })
    .map((entry) => entry.stem)
}

/** How the stems that play in a section ARRIVE across its passes. This is
 * the whole of "granular": four passes of a four-bar loop stop being four
 * identical bars because the parts come in (or go out) across them. */
export type CoachSectionArrival = 'together' | 'in' | 'out'

export const COACH_SECTION_ARRIVAL: Record<CoachSectionType, CoachSectionArrival> = {
  // An intro and a verse both build toward something, so their parts arrive.
  intro: 'in',
  verse: 'in',
  // A build is already the lift; staggering it would make it a second
  // verse. A drop is the payoff and a breakdown is a held state.
  build: 'together',
  drop: 'together',
  breakdown: 'together',
  // An outro is the only one that empties: the decoration leaves first and
  // the foundation leaves last, which is how a track ends.
  outro: 'out'
}

/** Which pass a stem of this rank arrives on (or, for an outro, how many
 * passes before the end it leaves). Spread evenly across the section, and
 * never later than its last pass -- a stem that never plays at all is not a
 * stagger, it is a drop, and the drop table decides that separately. */
function staggerOffset(rank: number, playingCount: number, passes: number): number {
  if (passes <= 1 || playingCount <= 1) return 0
  return Math.min(passes - 1, Math.floor((rank * passes) / playingCount))
}

export interface TemplateCellInput {
  type: CoachSectionType
  /** The section type the user's own loop IS (COACH_LOOP_HOME_TYPE). */
  homeType: CoachSectionType
  stem: LockedClimaxStem
  /** This stem's index among the stems that PLAY in this section, in row
   * order. */
  rank: number
  playingCount: number
  passIndex: number
  passes: number
}

/** Whether this stem plays at all in this section type. The home section --
 * the thing the user actually built -- keeps everything; every other
 * section reads the suggested-drop table, which keys off the kinds Discover
 * tagged, never stem order or channel index. */
export function templateStemPlays(
  type: CoachSectionType,
  homeType: CoachSectionType,
  stem: LockedClimaxStem
): boolean {
  if (type === homeType) return true
  return !isSuggestedDrop(type, stem)
}

/** One cell of the pre-fill. */
export function templateCellOn(input: TemplateCellInput): boolean {
  if (!templateStemPlays(input.type, input.homeType, input.stem)) return false
  if (input.type === input.homeType) return true
  const offset = staggerOffset(input.rank, input.playingCount, input.passes)
  switch (COACH_SECTION_ARRIVAL[input.type]) {
    case 'in':
      return input.passIndex >= offset
    case 'out':
      return input.passIndex < input.passes - offset
    default:
      return true
  }
}

/** The template's answer for one section, curried into the shape
 * ./coachSections.ts's sectionStemsInPass and ./coachCells.ts's cellRuns
 * both want -- so there is exactly one place that knows how a cell is
 * pre-filled. */
export function templateFallbackFor(
  section: { type: CoachSectionType; passes: number },
  homeType: CoachSectionType,
  climax: LockedClimax
): (stem: LockedClimaxStem, passIndex: number) => boolean {
  const rows = coachMapRowOrder(climax)
  const playing = rows.filter((stem) => templateStemPlays(section.type, homeType, stem))
  return (stem, passIndex) => {
    const rank = playing.findIndex((candidate) => candidate.path === stem.path)
    if (rank < 0) return false
    return templateCellOn({
      type: section.type,
      homeType,
      stem,
      rank,
      playingCount: playing.length,
      passIndex,
      passes: section.passes
    })
  }
}

/** Whether one cell of one section plays, template and overrides together.
 * The one function the map UI, the write path and the preview all call.
 *
 * Nothing in THIS plan calls it -- the write path works in runs
 * (templateFallbackFor + cellRuns) and the preview reads one pass. It is
 * here because the map grid is one `coachMapCellIsOn` per square, and
 * having the map plan reach for a second, subtly different implementation
 * is exactly how the pre-fill would start to drift. */
export function coachMapCellIsOn(
  section: CoachSection,
  homeType: CoachSectionType,
  climax: LockedClimax,
  stem: LockedClimaxStem,
  passIndex: number
): boolean {
  const fallback = templateFallbackFor(section, homeType, climax)
  return cellIsOn(section.cells, passIndex, stem.path, fallback(stem, passIndex))
}

export interface BuildCoachMapInput {
  shape: CoachShapeId
  loopIs: CoachLoopAnswer
  /** THE USER'S ANSWER, never a measurement this function took itself. */
  phraseBars: number
  climax: LockedClimax
  /** Where the first section goes -- the furthest bar anything placed
   * already reaches, measured by the caller (placedTimelineSpanBars). */
  firstStartBar: number
}

/**
 * A whole pre-filled section list, from a shape, a phrase length and an
 * answer to "what is this loop?".
 *
 * `cells` comes out EMPTY on every section, and that is the feature, not an
 * oversight: empty means "nothing overridden", so every cell reads the
 * template. See this module's own doc comment.
 */
export function buildCoachMapSections(input: BuildCoachMapInput): CoachSection[] {
  const types = shapeSectionTypes(input.shape)
  const sections: CoachSection[] = []
  const seen: { type: CoachSectionType }[] = []
  let startBar = Math.max(0, Math.round(input.firstStartBar))
  for (const [index, type] of types.entries()) {
    const ordinal = seen.filter((entry) => entry.type === type).length
    const passes = passesForTargetBars(targetBarsFor(type, ordinal), input.phraseBars)
    sections.push({
      id: `map-${index}-${type}`,
      type,
      // defaultSectionName takes only `{ type }[]`, which is all `seen` is
      // -- "drop", then "drop 2" the second time, counted by TYPE so a
      // rename never renumbers a later section.
      name: defaultSectionName(type, seen),
      passes,
      cells: {},
      startBar,
      placedGroupIds: {}
    })
    seen.push({ type })
    startBar += sectionBars(passes, input.phraseBars)
  }
  return sections
}

/** Every section laid end to end from `firstStartBar`. Called after any
 * change to a section's length. */
export function relayoutCoachSections(
  sections: readonly CoachSection[],
  phraseBars: number,
  firstStartBar: number
): CoachSection[] {
  let startBar = Math.max(0, Math.round(firstStartBar))
  return sections.map((section) => {
    const placed = { ...section, startBar }
    startBar += sectionBars(section.passes, phraseBars)
    return placed
  })
}

/**
 * The user changed his mind about the phrase length.
 *
 * "He can change it afterwards; the map RE-SIZES, it does not rebuild"
 * (spec). So: ids, types, names, cells and placedGroupIds all survive
 * untouched, and only the pass counts and the layout move. Each section
 * keeps its LENGTH IN BARS as closely as the new phrase allows, which is
 * what preserves a nudge the user made -- a verse he stretched to six
 * passes of four bars comes back as three passes of eight, not as the
 * template's four.
 */
export function resizeCoachMapToPhrase(
  sections: readonly CoachSection[],
  fromPhraseBars: number,
  toPhraseBars: number
): CoachSection[] {
  const resized = sections.map((section) => ({
    ...section,
    passes: passesForTargetBars(sectionBars(section.passes, fromPhraseBars), toPhraseBars)
  }))
  return relayoutCoachSections(resized, toPhraseBars, sections[0]?.startBar ?? 0)
}
```

- [ ] **Step 5: Run both test files**

Run: `npx vitest run src/shared/coachShapes.test.ts src/shared/coachMapTemplate.test.ts`
Expected: PASS. If the verse grid assertion does not match, print the grid and check `coachMapRowOrder` before touching `staggerOffset` — the order is the likelier bug.

- [ ] **Step 6: Commit**

```bash
git add src/shared/coachShapes.ts src/shared/coachShapes.test.ts \
        src/shared/coachMapTemplate.ts src/shared/coachMapTemplate.test.ts
git commit -m "$(cat <<'EOF'
Three journeys, and a first guess at what goes where

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

### Task 9: The state, the reducer, undo and persistence

Four new `CoachState` fields, five store actions, the pinning rules and the legacy migration.

**Files:**
- Modify: `src/shared/coach.ts`
- Modify: `src/shared/coach.test.ts`
- Modify: `src/shared/coachPhase2.ts`
- Modify: `src/shared/coachPhase2.test.ts`
- Modify: `src/renderer/src/state/store.ts`
- Modify: `src/renderer/src/state/store.test.ts`
- Modify: `src/renderer/src/state/history.ts`
- Modify: `src/renderer/src/state/history.test.ts`
- Modify: `src/renderer/src/state/serialize.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/shared/coach.test.ts`:

```ts
describe('the phrase, and who owns it', () => {
  it('starts with no measurement and no answer', () => {
    const state = startCoach(T0)
    expect(state.phraseReading).toBeNull()
    expect(state.phrase).toBeNull()
    expect(state.loopIs).toBeNull()
    expect(state.shape).toBeNull()
  })

  it('brings all four back off disk', () => {
    const loaded = sanitiseLoadedCoach({
      stepId: 'p2-first',
      phraseReading: { nominalBars: 8, phraseBars: 4 },
      phrase: { bars: 4, source: 'measured' },
      loopIs: 'drop',
      shape: 'standard'
    })
    expect(loaded?.phrase).toEqual({ bars: 4, source: 'measured' })
    expect(loaded?.phraseReading?.phraseBars).toBe(4)
    expect(loaded?.loopIs).toBe('drop')
    expect(loaded?.shape).toBe('standard')
  })

  it('loads a project that predates all four as having none of them', () => {
    const loaded = sanitiseLoadedCoach({ stepId: 'p2-first' })
    expect(loaded?.phrase).toBeNull()
    expect(loaded?.loopIs).toBeNull()
  })

  it('drops an answer or a shape this build does not know', () => {
    const loaded = sanitiseLoadedCoach({ stepId: 'p2-first', loopIs: 'chorus', shape: 'epic' })
    expect(loaded?.loopIs).toBeNull()
    expect(loaded?.shape).toBeNull()
  })
})
```

Add to `src/renderer/src/state/store.test.ts`:

```ts
describe('the phrase actions', () => {
  it('stores the ANSWER the user gave, measured or nominal', () => {
    const started = reducer({ ...initialState, coach: startCoach(T0) }, {
      type: 'COACH_SET_PHRASE',
      phrase: { bars: 4, source: 'measured' }
    })
    expect(started.coach?.phrase).toEqual({ bars: 4, source: 'measured' })
  })

  it('NEVER applies a measurement by itself -- recording a reading changes no sizing', () => {
    const state = reducer({ ...initialState, coach: startCoach(T0) }, {
      type: 'COACH_SET_PHRASE_READING',
      reading: { nominalBars: 8, phraseBars: 4, measuredStems: 2, inconclusiveStems: 0 }
    })
    expect(state.coach?.phraseReading?.phraseBars).toBe(4)
    expect(state.coach?.phrase).toBeNull()
  })

  it('re-sizes the map when the answer changes, keeping names and cells', () => {
    const coach = {
      ...startCoach(T0),
      phrase: { bars: 8, source: 'nominal' as const },
      sections: [
        {
          id: 'a',
          type: 'verse' as const,
          name: 'my verse',
          passes: 2,
          cells: { '0|/kick.wav': false },
          startBar: 0,
          placedGroupIds: {}
        }
      ]
    }
    const next = reducer({ ...initialState, coach }, {
      type: 'COACH_SET_PHRASE',
      phrase: { bars: 4, source: 'measured' }
    })
    expect(next.coach?.sections[0].id).toBe('a')
    expect(next.coach?.sections[0].name).toBe('my verse')
    expect(next.coach?.sections[0].passes).toBe(4) // 16 bars, now at a 4-bar phrase
    expect(next.coach?.sections[0].cells['0|/kick.wav']).toBe(false)
  })

  it('builds a pre-filled map from the two answers and the phrase', () => {
    const coach = {
      ...startCoach(T0),
      lockedClimax: climaxFixture,
      phrase: { bars: 4, source: 'measured' as const },
      loopIs: 'drop' as const,
      shape: 'short' as const
    }
    const next = reducer({ ...initialState, coach }, { type: 'COACH_BUILD_MAP', firstStartBar: 0 })
    expect(next.coach?.sections.map((s) => s.type)).toEqual(['intro', 'verse', 'drop', 'outro'])
    for (const section of next.coach!.sections) expect(section.cells).toEqual({})
  })

  it('refuses to build a map without a locked climax, a phrase and both answers', () => {
    const coach = { ...startCoach(T0), phrase: { bars: 4, source: 'nominal' as const } }
    const next = reducer({ ...initialState, coach }, { type: 'COACH_BUILD_MAP', firstStartBar: 0 })
    expect(next.coach?.sections).toEqual([])
  })

  it('toggles one cell without touching its neighbours', () => {
    const coach = {
      ...startCoach(T0),
      lockedClimax: climaxFixture,
      phrase: { bars: 4, source: 'measured' as const },
      loopIs: 'drop' as const,
      draftSection: { type: 'verse' as const, name: 'verse', passes: 4, cells: {} }
    }
    const next = reducer({ ...initialState, coach }, {
      type: 'COACH_TOGGLE_SECTION_CELL',
      passIndex: 1,
      path: '/kick.wav'
    })
    const cells = next.coach!.draftSection!.cells
    expect(Object.keys(cells)).toEqual(['1|/kick.wav'])
    expect(cells['1|/kick.wav']).toBe(false)
  })

  it('ignores a cell toggle for a path that is not in the locked climax', () => {
    const coach = {
      ...startCoach(T0),
      lockedClimax: climaxFixture,
      draftSection: { type: 'verse' as const, name: 'verse', passes: 4, cells: {} }
    }
    const next = reducer({ ...initialState, coach }, {
      type: 'COACH_TOGGLE_SECTION_CELL',
      passIndex: 0,
      path: '/not-in-the-loop.wav'
    })
    expect(next.coach!.draftSection!.cells).toEqual({})
  })
})
```

Add to `src/renderer/src/state/history.test.ts` (follow the existing `coach` pinning tests in that file for the fixture style — they already build a `HistoryState` and dispatch through `historyReducer`):

```ts
it('pins the phrase answer and the measurement across undo', () => {
  let history = createHistoryState({ ...initialState, coach: startCoach(T0) })
  // An ordinary, tracked edit -- this is the checkpoint undo will land on,
  // and it captures a coach with no phrase yet.
  history = historyReducer(history, { type: 'SET_BPM', bpm: 100 })
  history = historyReducer(history, {
    type: 'COACH_SET_PHRASE_READING',
    reading: { nominalBars: 8, phraseBars: 4, measuredStems: 2, inconclusiveStems: 0 }
  })
  history = historyReducer(history, {
    type: 'COACH_SET_PHRASE',
    phrase: { bars: 4, source: 'measured' }
  })
  history = historyReducer(history, { type: 'SET_BPM', bpm: 120 })
  history = historyReducer(history, { type: 'UNDO' })

  expect(history.present.bpm).toBe(100) // the edit walked back...
  expect(history.present.coach?.phrase).toEqual({ bars: 4, source: 'measured' }) // ...the answer did not
  expect(history.present.coach?.phraseReading?.phraseBars).toBe(4)
})

it('still walks sections back with the clips they name, cells and all', () => {
  const section = {
    id: 'a',
    type: 'verse' as const,
    name: 'verse',
    passes: 2,
    cells: { '0|/kick.wav': false },
    startBar: 0,
    placedGroupIds: {}
  }
  let history = createHistoryState({ ...initialState, coach: startCoach(T0) })
  // The placement and its record go out in one BATCH, exactly as
  // SssketchySectionPanel dispatches them -- one checkpoint for both.
  history = historyReducer(history, {
    type: 'BATCH',
    actions: [{ type: 'SET_BPM', bpm: 100 }]
  })
  history = historyReducer(history, {
    type: 'LOAD_STATE',
    state: { ...history.present, coach: { ...history.present.coach!, sections: [section] } }
  })
  expect(history.present.coach?.sections[0].cells).toEqual({ '0|/kick.wav': false })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/shared/coach.test.ts src/renderer/src/state/store.test.ts src/renderer/src/state/history.test.ts`
Expected: FAIL on the new cases.

- [ ] **Step 3: Add the four fields to `CoachState`**

In `src/shared/coach.ts`, on `CoachState`, after `lockedClimax`:

```ts
  /** WHAT THE APP MEASURED about the loop's phrase -- reported once,
   * before the map is built, and then left alone. Never the number
   * anything is sized by: that is `phrase` below, which only the user
   * writes. Kept on the flow (rather than recomputed) so the offer
   * survives a reload and he can still change his mind next week.
   *
   * Pinned across undo (history.ts): a measurement of a file on disk is
   * not an arrangement edit, and no undo can un-measure it. */
  phraseReading: LoopPhraseReading | null
  /** THE USER'S ANSWER, and the only number section sizing ever reads.
   * Written by exactly one reducer case (COACH_SET_PHRASE), which is
   * only ever dispatched from a click. Changing it RE-SIZES the map
   * (resizeCoachMapToPhrase) rather than rebuilding it -- names, types
   * and cell edits all survive. */
  phrase: CoachPhrase | null
  /** "What is this loop?" -- drop / verse / intro / not sure. Decides
   * where the material he already has lands in the structure, which is
   * the move that replaced all six of phase one's steps. */
  loopIs: CoachLoopAnswer | null
  /** "How long a journey?" -- short / standard / long. */
  shape: CoachShapeId | null
```

`startCoach` gets `phraseReading: null, phrase: null, loopIs: null, shape: null`. `sanitiseLoadedCoach` gets:

```ts
    phraseReading: sanitiseLoopPhraseReading(loose.phraseReading),
    phrase: sanitiseCoachPhrase(loose.phrase),
    loopIs: isCoachLoopAnswer(loose.loopIs) ? loose.loopIs : null,
    shape: isCoachShapeId(loose.shape) ? loose.shape : null,
```

and its `sections` / `draftSection` calls gain the phrase length, read from the answer it just repaired:

```ts
  const phrase = sanitiseCoachPhrase(loose.phrase)
  // …
    sections: sanitiseCoachSections(loose.sections, phrase?.bars ?? 1),
    draftSection: sanitiseCoachSectionDraft(loose.draftSection, phrase?.bars ?? 1),
```

- [ ] **Step 4: Update `coachPhase2.ts`**

- `nudgeCoachSectionBars` → `nudgeCoachSectionPasses`, calling `nudgeSectionPasses`.
- `toggleCoachSectionStem(state, path)` now flips the stem across **every pass** of the draft (`setStemAcrossPasses`), reading its current state from pass 0's resolved value. It still refuses a path that is not in the locked climax.
- Add `toggleCoachSectionCell(state, passIndex, path)` — the single-cell gesture the map will use, using `setCell` and the template's own fallback.
- Delete `dropSuggestedCoachSectionStems` entirely: with a pre-filled map, the suggestion table is already applied, so a button that applies it again is meaningless. Delete `COACH_DROP_SUGGESTED_LABEL` and `'drop-suggested'` from `CoachSectionOp`, and the `section-drop-suggested` move from the `p2-section` row in `coachSteps.ts`.
- `startCoachSection(state, now, type)` needs a pass count. Give it one from the template: `passesForTargetBars(targetBarsFor(type, ordinal), state.phrase?.bars ?? 1)`.
- `placeCoachSection` writes the new section shape, minting an id (`` `section-${banked.sections.length}` ``) and copying `passes`/`cells` off the draft.

- [ ] **Step 5: Add the store actions**

In `src/renderer/src/state/store.ts`'s `Action` union, replacing `COACH_NUDGE_SECTION_BARS` / `COACH_DROP_SUGGESTED_STEMS`:

```ts
  // The arrangement map (2026-09-23). COACH_SET_PHRASE_READING records what
  // the app MEASURED; COACH_SET_PHRASE records what the USER ANSWERED. They
  // are two actions rather than one on purpose: a measurement must never be
  // able to size anything by itself (spec, "The phrase pass, and who
  // decides" -- a direct instruction from Elling). Only the second one
  // re-sizes the map, and only a click dispatches it.
  | { type: 'COACH_SET_PHRASE_READING'; reading: LoopPhraseReading }
  | { type: 'COACH_SET_PHRASE'; phrase: CoachPhrase }
  | { type: 'COACH_SET_LOOP_ANSWER'; loopIs: CoachLoopAnswer }
  | { type: 'COACH_SET_SHAPE'; shape: CoachShapeId }
  /** Fills `sections` from the shape template. Needs a locked climax, a
   * phrase and both answers; without all four it is a no-op rather than a
   * half-built map. `firstStartBar` is placedTimelineSpanBars(state),
   * measured by the caller, so the map lands after anything already down. */
  | { type: 'COACH_BUILD_MAP'; firstStartBar: number }
  | { type: 'COACH_NUDGE_SECTION_PASSES'; delta: number }
  | { type: 'COACH_TOGGLE_SECTION_CELL'; passIndex: number; path: string }
```

and the matching reducer cases, each guarding `state.coach === null` exactly as its neighbours do. `COACH_SET_PHRASE`'s case is the one with real work:

```ts
    case 'COACH_SET_PHRASE': {
      if (state.coach === null) return state
      const from = state.coach.phrase?.bars ?? action.phrase.bars
      return {
        ...state,
        coach: {
          ...state.coach,
          phrase: action.phrase,
          // RE-SIZES, never rebuilds -- names, types, ids and every cell
          // edit survive a change of mind about the phrase length (spec).
          sections: resizeCoachMapToPhrase(state.coach.sections, from, action.phrase.bars)
        }
      }
    }
```

- [ ] **Step 6: Update `history.ts`**

In `TRANSIENT_ACTION_TYPES`, replace `'COACH_NUDGE_SECTION_BARS'`/`'COACH_DROP_SUGGESTED_STEMS'` with `'COACH_NUDGE_SECTION_PASSES'`/`'COACH_TOGGLE_SECTION_CELL'` and add the four new ones, with a comment:

```ts
  // The arrangement map's own answers and measurement (2026-09-23). Same
  // category as every other COACH_* entry: where the flow is and what the
  // user told it, not an edit to the project. COACH_BUILD_MAP is the one
  // that writes `sections`, and like COACH_PLACE_SECTION it is listed here
  // so a stray direct dispatch pushes no checkpoint of its own -- in real
  // use it arrives inside the BATCH that also places the clips.
  'COACH_SET_PHRASE_READING',
  'COACH_SET_PHRASE',
  'COACH_SET_LOOP_ANSWER',
  'COACH_SET_SHAPE',
  'COACH_BUILD_MAP',
  'COACH_NUDGE_SECTION_PASSES',
  'COACH_TOGGLE_SECTION_CELL',
```

The `pinnedCoach` construction itself needs **no change** — it spreads the live coach and overrides only `sections` and `tension`, so all four new fields are pinned for free. Extend its comment so the next reader knows that was a decision:

```ts
    // The map's four new fields (phraseReading, phrase, loopIs, shape) ride
    // along on the PINNED side by construction, and that is right: a
    // measurement of a file and an answer the user typed are not timeline
    // material, and undoing a clip edit must not un-answer "what is this
    // loop?". `sections` stays on the snapshot side as before -- it is the
    // one part of the flow that IS the work, cells and all.
```

- [ ] **Step 7: Update `serialize.test.ts`**

Add a round trip of all four fields plus a section with `cells`, and a "pre-map project" case:

```ts
it('brings a project saved before the map up to the map shape', () => {
  const { state } = deserializeProject(
    JSON.stringify({
      ...baseProject,
      coach: {
        stepId: 'p2-section',
        sections: [{ type: 'intro', name: 'intro', bars: 16, droppedPaths: ['/hook.wav'] }]
      }
    })
  )
  expect(state.coach?.phrase).toBeNull()
  expect(state.coach?.sections[0].passes).toBeGreaterThanOrEqual(1)
  expect(state.coach?.sections[0].cells['0|/hook.wav']).toBe(false)
  expect('bars' in state.coach!.sections[0]).toBe(false)
  expect('droppedPaths' in state.coach!.sections[0]).toBe(false)
})
```

- [ ] **Step 8: Run and commit**

Run: `npx vitest run src/shared src/renderer/src/state`
Expected: PASS.

```bash
git add src/shared src/renderer/src/state
git commit -m "$(cat <<'EOF'
The number he chose, kept separate from the number we measured

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

### Task 10: The write path — one clip per run

A stem that plays passes 1–3 of a 4-pass section becomes **one** clip three passes long. This is the half of the round trip that belongs in this plan.

**Files:**
- Modify: `src/renderer/src/state/coachSectionPlacement.ts`
- Modify: `src/renderer/src/state/coachSectionPlacement.test.ts`
- Modify: `src/renderer/src/state/useCoachSectionPreview.ts`
- Modify: `src/renderer/src/state/coachTensionApply.ts`
- Modify: `src/renderer/src/state/coachTensionApply.test.ts`
- Modify: `src/shared/coachTension.ts`
- Modify: `src/shared/coachTension.test.ts`
- Modify: `src/shared/coachPhase3.ts`
- Modify: `src/shared/coachPhase3.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/renderer/src/state/coachSectionPlacement.test.ts`, replace the section-spanning assertions with run-based ones:

```ts
it('places one clip per contiguous run, not one per section', () => {
  const draft = {
    type: 'verse' as const,
    name: 'verse',
    passes: 4,
    // kick plays passes 0 and 2-3; bass plays the whole thing.
    cells: { '1|/kick.wav': false }
  }
  const built = buildCoachSectionActions(state, climax, draft, [], 'drop', 4)
  const placed = built.actions.filter((a) => a.type === 'PLACE_LOOP_ON_TIMELINE')
  expect(placed).toHaveLength(1)
  const resizes = built.actions.filter((a) => a.type === 'SET_PLAYED_BARS')
  // kick: two runs (1 pass, then 2) -> 4 bars and 8 bars at a 4-bar phrase.
  expect(resizes.map((a) => a.bars)).toContain(4)
  expect(resizes.map((a) => a.bars)).toContain(8)
})

it('puts every run of one stem on that stem own row', () => {
  const draft = {
    type: 'verse' as const,
    name: 'verse',
    passes: 4,
    cells: { '1|/kick.wav': false } // kick plays pass 0, then passes 2-3
  }
  const built = buildCoachSectionActions(state, climax, draft, [], 'drop', 4)
  const lane = built.placedGroupIds['/kick.wav']
  expect(lane).toBeDefined()
  const moves = built.actions.filter(
    (a) => a.type === 'MOVE_TO_CHANNEL' && a.channelId === lane
  )
  // The first run OWNS the lane and needs no move; the second is moved onto
  // it, so the stem keeps one row rather than opening a staircase.
  expect(moves).toHaveLength(1)
})

it('places each run at its own bar, in ascending order', () => {
  const draft = {
    type: 'verse' as const,
    name: 'verse',
    passes: 4,
    cells: { '1|/kick.wav': false }
  }
  const built = buildCoachSectionActions(state, climax, draft, [], 'drop', 4)
  const bars = built.actions
    .filter((a) => a.type === 'PLACE_LOOP_ON_TIMELINE')
    .map((a) => (a as { startBar: number }).startBar)
  expect(bars).toEqual([...bars].sort((a, b) => a - b))
  expect(bars[0]).toBe(0)
})

it('places nothing at all for a section where nothing plays', () => {
  const draft = { type: 'intro' as const, name: 'intro', passes: 2, cells: {} }
  const allOff = {
    ...draft,
    cells: Object.fromEntries(
      climax.stems.flatMap((s) => [
        [`0|${s.path}`, false],
        [`1|${s.path}`, false]
      ])
    )
  }
  expect(buildCoachSectionActions(state, climax, allOff, [], 'drop', 4).actions).toEqual([])
})
```

- [ ] **Step 2: Run it to verify it fails, then rewrite the builder**

In `src/renderer/src/state/coachSectionPlacement.ts`, `buildCoachSectionActions` gains `homeType: CoachSectionType` and `phraseBars: number`, and its loop becomes run-based:

```ts
  const fallback = templateFallbackFor(draft, homeType, climax)
  const rows = coachMapRowOrder(climax)

  for (const stem of rows) {
    const runs = cellRuns(draft.cells, draft.passes, stem.path, (passIndex) =>
      fallback(stem, passIndex)
    )
    for (const [runIndex, run] of runs.entries()) {
      const assembly = assembleDiscoverRifff(
        `${draft.name} · ${stem.name}`,
        [{ stem: stemFromClimax(stem), gain: stem.gain }],
        state.bpm
      )
      if (assembly === null) continue
      const groupId = assembly.rifff.groupId
      const runStartBar = startBar + sectionBars(run.startPass, phraseBars)
      rifffs.push(assembly.rifff)
      Object.assign(vol, assembly.vol)
      // The FIRST run owns this stem's lane for the whole song -- every
      // later run in this section, and every run in every later section,
      // moves onto it. Without this a stem that leaves and comes back
      // would open a new row each time and the arrangement would read as
      // a staircase (the same reasoning buildArrangeReplaceActions'
      // firstCopyChannelId has).
      if (runIndex === 0 && lanes[stem.path] === undefined) placedGroupIds[stem.path] = groupId
      const lane = lanes[stem.path] ?? placedGroupIds[stem.path]
      if (lane !== undefined && lane !== groupId) {
        afterPlacement.push({ type: 'MOVE_TO_CHANNEL', groupId, startBar: runStartBar, channelId: lane })
      }
      afterPlacement.push({
        type: 'SET_PLAYED_BARS',
        key: groupId,
        bars: sectionBars(run.passCount, phraseBars)
      })
    }
  }
```

**Careful:** `PLACE_LOOP_ON_TIMELINE` takes one `startBar` for the whole batch, but runs start at different bars. Read the action's own doc comment in `store.ts` before writing this. If it cannot place clips at differing start bars in one call, emit **one `PLACE_LOOP_ON_TIMELINE` per distinct run start bar**, each carrying the rifffs that begin there, in ascending bar order — that keeps every clip an ordinary clip and the whole lot still goes out in one `BATCH`, so undo is still one step per section. Write a test that asserts the placements are in ascending `startBar` order.

Note the shape of `SET_PLAYED_BARS`: it takes the RUN's length (`sectionBars(run.passCount, phraseBars)`), not the section's, which is what tiles a 4-bar loop out across exactly the passes it plays.

- [ ] **Step 3: Thread the phrase length through the tension pass**

- `coachSectionBoundaries(sections, phraseBars)` in `coachTension.ts` computes `bar: from.startBar + sectionBars(from.passes, phraseBars)` and `leadBars: sectionBars(from.passes, phraseBars)`.
- `coachBoundaries(state)` in `coachPhase3.ts` reads `state.phrase?.bars ?? 1` and passes it in.
- `coachTensionApply.ts`'s two `section.bars` reads become `sectionBars(section.passes, phraseBars)` with the phrase read off the coach state. **Re-read this file first — the riser agent is in it.**

- [ ] **Step 4: Update the preview hook**

`useCoachSectionPreview.ts` previews **one pass** of the section, not the whole thing: build the rifff from the stems that play in pass 0 (`sectionStemsInPass`) and set `playedBars: { [groupId]: sectionBars(draft.passes, phraseBars) }`. Note honestly in its doc comment that the preview loops the whole section, so a staggered arrival is audible in it.

- [ ] **Step 5: Run and commit**

Run: `npx vitest run src/renderer/src/state src/shared`
Expected: PASS.

```bash
git add -A src
git commit -m "$(cat <<'EOF'
A stem that leaves and comes back is two clips on one row

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

### Task 11: The section panel, converted

The map replaces this panel in the later plan; here it is only brought into the new vocabulary so the branch stays coherent and typechecks. **No component tests** (Finding 8).

**Files:**
- Modify: `src/renderer/src/components/SssketchySectionPanel.tsx`

- [ ] **Step 1: Re-read the file** — the riser agent is not in it, but `SssketchyCoach.tsx` (its parent) moved in Task 2.

- [ ] **Step 2: Swap bars for passes**

- Import `COACH_SECTION_PASS_NUDGES` from `@shared/coachPasses` instead of `COACH_SECTION_BAR_NUDGES`.
- The nudge row dispatches `{ type: 'COACH_NUDGE_SECTION_PASSES', delta }`.
- The readout becomes both numbers, because passes alone do not tell you how long a section is:

```tsx
        <span style={{ fontSize: 10, color: 'var(--ra-text-3)' }}>
          {draft.passes} × {phraseBars} bars
        </span>
```

with `const phraseBars = coach.phrase?.bars ?? climax.barLength`.

- [ ] **Step 3: Make the stem list cell-aware**

Each checkbox still toggles a whole stem (`COACH_TOGGLE_SECTION_STEM`), but `checked` is read through the template rather than off `droppedPaths`:

```tsx
const fallback = templateFallbackFor(draft, homeType, climax)
// …
const on = cellIsOn(draft.cells, 0, stem.path, fallback(stem, 0))
```

with `const homeType = coach.loopIs === null ? 'drop' : COACH_LOOP_HOME_TYPE[coach.loopIs]`.

- [ ] **Step 4: Remove the suggested-drop button**

Delete the "drop the suggested ones" button, `nothingSuggested`, and the `COACH_DROP_SUGGESTED_LABEL` / `suggestedDropPaths` / `COACH_SUGGESTED_DROP_HINT` imports. The per-row hint goes too: with a pre-filled map, "usually out here" is no longer a mark on a still-playing stem — it is already applied, and saying it twice would be the app arguing with itself. The row's right-hand label falls back to `slotKindsLabel(stem.kinds)` unconditionally.

- [ ] **Step 5: Verify**

```bash
npm run typecheck && npm run lint
```
Expected: clean, 4 known warnings. **Say plainly in your report that this panel was not clicked** — no agent here can.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/SssketchySectionPanel.tsx
git commit -m "$(cat <<'EOF'
The panel counts times round the loop now

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

### Task 12: Whole-suite verification

**Files:** none.

- [ ] **Step 1: Run everything**

```bash
npx vitest run && npm run typecheck && npm run lint
```
Expected: suite green (it will be **fewer** than 2388 tests — phase one's went with it; note the new number), typecheck clean, lint at exactly its 4 pre-existing prettier warnings in unrelated files.

- [ ] **Step 2: Confirm nothing native changed**

```bash
git diff --stat master -- native-engine/
```
Expected: no output. This plan touches no C++ and requires no engine rebuild. If you found yourself needing one, you went off-plan — stop and report it.

- [ ] **Step 3: Confirm phase one is really gone**

```bash
grep -rn "p1-\|coachPhase1\|CoachFlavour\|flavour\|seededKinds\|coachDiscoverBridge\|add-slot" src
```
Expected: no hits.

- [ ] **Step 4: Confirm the measurement never sizes anything**

```bash
grep -rn "phraseReading" src | grep -v test
```
Expected: exactly the places that STORE or READ it — `coach.ts` (the field and its sanitiser), `store.ts` (`COACH_SET_PHRASE_READING`), `history.ts`'s comment. **If `phraseReading` appears anywhere that computes a pass count, a bar count or a section length, Finding 1 has been broken.**

```bash
grep -rn "resizeCoachMapToPhrase\|buildCoachMapSections" src | grep -v test
```
Expected: their own definitions plus exactly one reducer case each. Neither may be called from a constructor, an effect or a cache callback.

- [ ] **Step 5: Confirm the pre-fill is still a reversal, not a regression**

```bash
grep -rn "everything is on" src
```
Expected: no hits — Task 6 Step 4 rewrote that comment. If it is still there, a later agent will read it and undo this feature.

- [ ] **Step 6: Commit anything outstanding, then report**

---

## Manual walkthrough (for Elling — an agent cannot do this)

Run `npm run dev`. A renderer reload is enough; nothing native changed.

**Read this first:** after this plan, **the sssketchy button is gone from the project menu and nothing replaces it yet.** The auto-arranger entry point, the map itself and the section walk are the next plan. So this walkthrough is about what did *not* break, plus one thing that can only be judged by ear later.

1. Open an existing project that already has a guided flow saved in it. It should open normally, with no console errors, and the timeline unchanged. (The flow is there in the file; there is just no button to bring it back on screen.)
2. Open the riff library, run Discover, add a few slots and plunk a loop onto the timeline. The add row should behave exactly as it always did — **no chips pre-armed by anything**, since that was phase one's doing.
3. Auto-arrange and draw-arrange should both be untouched. Run one of each.
4. Save, quit, reopen. Everything should come back.
5. Export a mix and an Ableton or REAPER project from a project that has guided sections in it. Nothing in the export path changed, but the sections' shape did, so this is the cheap way to find out if anything downstream was reading `bars`.

**What only you can judge, and not yet:** whether the phrase measurement is RIGHT on real Endlesss loops. There is no way to see it until the map plan puts it on screen. When it lands, the test is: take an 8-bar rifff you know is really the same 4 bars twice, and see whether he says so — and take one that genuinely takes 8 bars to say its piece, and see whether he leaves it alone.

## Known limits, written down on purpose

- **sssketchy is unreachable after this plan.** Deliberate (Finding 10). The project-menu button is deleted per the spec; the auto-arranger entry point is the next plan. Every store action, reducer case and panel still works and is still tested.
- **The phrase measurement has never heard a real Endlesss loop.** Its thresholds (`PHRASE_MATCH_THRESHOLD`, `PHRASE_AMBIGUITY_MARGIN`, the 0.7/0.3 envelope/brightness split) are first-pass numbers tested against synthetic signals, kept together at the top of one file so tuning is one edit. They are the honest starting point, not a claim of accuracy.
- **The measurement is per stem and stops at 8 bars.** A 16-bar phrase reads as "the nominal length", which is the right answer for every loop this app actually handles but is a real ceiling. Widening `PHRASE_PERIOD_CANDIDATES` costs one array entry and a longer decode window.
- **`'unsure'` silently means `'drop'`.** Documented in `COACH_LOOP_HOME_TYPE`'s own comment and defended there: the method builds the climax first, so unattributed material belongs in the drop. It is a default, not a claim, and every cell it produces is one toggle from being fixed.
- **The suggested-drop table is a table, not analysis.** It knows what kinds of section usually lose what kinds of stem. It has never heard your track. What changed today is that it is now *applied* rather than merely *marked* — legitimate only because the map shows the whole song at once and cmd+z puts it all back.
- **A bare `leadesque` stem is not treated as the hook.** Unchanged from phase two: the app cannot tell a plain lead apart from the hook, so it says nothing rather than guessing. The consequence is that a verse or a build may keep a hook the app could not identify — one toggle, versus an assertion the app has not earned.
- **Only the pure half of the round trip is here.** `runsToCells` is the tested inverse of `cellRuns`; reading the *live timeline* back into cells (measuring what is actually placed, after the user has dragged things about) is the map plan's, because it needs the map on screen to be worth anything.
- **The section preview loops the whole section, not one pass.** So a staggered arrival is audible in it, which is right, but it means the preview is now as long as the section rather than as long as the loop.
- **No component tests.** `SssketchySectionPanel.tsx`, `SssketchyCoach.tsx`, `App.tsx` and `DiscoverPanel.tsx` are verified by typecheck, lint and the pure logic's own tests, then by the walkthrough above. This environment has no GUI or audio tooling and an agent cannot click through the app or hear it.
