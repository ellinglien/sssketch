# Arrangement map — UI AND THE SECTION WALK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put sssketchy inside the auto-arranger and give him the map — two opening questions, a phrase report he states but never applies, a pre-filled grid of rows × sections × passes that **edits the real clips when you toggle a cell**, a view toggle between map and timeline, and a gentle section-by-section walk that can be left at any time without losing anything.

**Architecture:** The map is a **projection of the timeline, not a second model**. Every cell it draws is read back out of `state.rifffs` / `state.risers` by pure functions in `src/shared/`, and every toggle is planned by another pure function and dispatched as one `BATCH` of ordinary clip actions. There is no commit step, nothing to keep in sync, and undo works because undo already works on clips. The two halves — `readRowPasses` (timeline → grid) and `planCellToggle` (grid → clip actions) — are TDD'd against each other in the same test file.

**Tech Stack:** TypeScript, React 19, Electron renderer, vitest. **No native-engine changes at all** — nothing here reaches the engine except through `buildEngineProject`, whose shape is untouched.

**Spec:** `docs/superpowers/specs/2026-09-23-arrangement-map-design.md` (approved 2026-09-23).

**DECISION AFTER THIS PLAN WAS WRITTEN — the one-shot build STAYS.** This plan as drafted made
the guided flow the only route through the auto-arranger, which would have retired "confirm roles
→ build the whole arrangement instantly, no questions" as a user-reachable feature. Elling was
asked directly and chose to keep both ("b for now"): the wizard offers **build it for me** (the
existing one-shot `runAutoArrangeBuild` path, unchanged) alongside **walk me through it** (the
guided map). So Task 10 must add a branch, not a replacement — `AutoArrangeWizard` keeps its
current behaviour behind one button and gains the coach behind the other, and none of
`runAutoArrangeBuild`'s imports in that file become dead. The reasoning for keeping it: the
one-shot build is already written and tested, so it costs a button and a branch, and it leaves a
way to compare whether the guided version actually produces better arrangements than the instant
one. Do not "tidy up" the one-shot path out of existence while implementing Task 10.

**This plan sits on:** `docs/superpowers/plans/2026-09-23-arrangement-map-foundations.md`, which builds `coachCells.ts`, `coachShapes.ts`, `coachMapTemplate.ts`, `coachPasses.ts`, `coachPhrase.ts`, `phrasePeriod.ts`, `phraseCache.ts` and the four new `CoachState` fields. **That plan is being implemented by another agent right now.** Its module and function names are the contract this plan was written against, but names may have shifted slightly during implementation — **re-read every file this plan touches immediately before editing it**, and prefer what is actually on disk over what is quoted here.

**Baseline:** foundations reports 2387 tests / 157 files passing before its own work (it will end with fewer — phase one's tests went with it; take whatever number it reports as your baseline). `npm run typecheck` clean. `npm run lint` at 0 errors + **4 pre-existing prettier warnings in unrelated files**. Any *new* warning is yours.

---

## Findings that shaped this plan (read these first)

1. **THE MAP IS A PROJECTION OF THE TIMELINE. THIS IS THE WHOLE DESIGN.** The spec: *"Toggling a cell edits the real clips — there is no commit step and no second model to drift out of sync."* Taken literally, that forbids the obvious implementation (store a grid, write clips from it). So: **after a map has been built, nothing reads `CoachSection.cells` for display.** What a cell shows is computed from the clips that are actually on that row at that bar, every render. `cells` survives only as the record of what the map was **built** from, which is what makes the pre-fill and the phrase re-size work. Task 14 has a grep that fails the build if `cells` is read anywhere else.

   The payoff is large and worth stating: moving a clip, resizing it, deleting it, dragging it to another row, and **undo** all read back into the map for free, because there is nothing else to update.

2. **A cell is ON when the row's material covers more than half that pass.** Not "any overlap" (a clip nudged one bar would light two cells) and not "covers the downbeat" (a clip starting one bar late would go dark for a pass it plays most of). `MAP_CELL_MIN_COVERAGE = 0.5`, strictly greater, ties resolve to OFF. It is one constant in one file; Task 1 tests every edge of it.

3. **The map reads where material IS, never where it is AUDIBLE.** `state.mute`, `muteRegions` and `RiserClip.muted` are deliberately **not** read. A mute region is a hand-drawn hole inside a clip; if the map treated it as an off cell, toggling that cell back on would have to delete the region, and a hand-drawn edit would vanish behind a single click on a grid. The map answers "is this row's material here", the mute buttons answer "can you hear it", and conflating the two is how the map would start destroying work. `leftCrop` **is** read — a left-cropped clip genuinely starts later, and that is presence, not audibility.

4. **A clip that crosses a section's edge locks its cells rather than being edited.** The toggle rewrites clips inside one section's bar window. A clip reaching outside that window cannot be deleted without silently taking material out of the neighbouring section, and cannot be trimmed without guessing. So `planCellToggle` refuses, returns the offending groupIds in `blockedGroupIds`, and the cell renders dashed and `not-allowed` with a title saying so. Nothing is ever destroyed by a refusal. This only happens to clips the **user** made — the map's own layout never straddles.

5. **RISER ROWS ARE READ-ONLY ON THE MAP, AND MONOCHROME.** Risers are first-class rows now (`RiserClip` carries its own `channelId`, `name`, `muted` and `level`). They appear on the map — the map showing the *entire song at once* is the whole legitimacy argument for the pre-fill, so hiding rows would undercut it — but their cells cannot be toggled. Three reasons, all structural:
   - A riser has **no `SoundType`**, and `RiserBlock.tsx` says so at length: *"typeColorVar's only legitimate input is a SoundType -- which a riser does not have, and must not be given one just to have a hue."* So a riser row's on-cells are `--ra-bg-row-active` + `--ra-border-strong`, the same monochrome every other piece of chrome gets. That the riser rows look different from the stem rows is the point, not a compromise.
   - A riser is a single shaped one-shot with a drawn curve, not a loop that tiles per pass. Chopping it into passes would be a lie about what it is.
   - Toggling a riser cell ON would mean *inventing* a riser, which is the spec's own named bad line ("add a riser at bar 48"). Risers arrive at the joins, in the tension pass, on a click — Task 13.

6. **Rows are `channelsInOrder(state)`, and the build lays them out in map order.** The spec says rows are the arranger's own channel rows, so the map reads them straight off `channelsInOrder`. That only matches `coachMapRowOrder(climax)` if the lanes are *created* in row order — and `PLACE_LOOP_ON_TIMELINE` pushes each fresh groupId onto `channelOrder` as it places it. So Task 6's builder iterates **rows outer, sections inner**, emitting placements row by row. Placing section-by-section (which is what the old one-section-at-a-time flow did) would order the arranger's rows by which section a stem first appears in, and the map would disagree with the timeline behind it on the very first screen.

7. **The auto-arranger REPLACES the material it read.** `buildArrangeReplaceActions` places its new clips and then emits one `DELETE_RIFFFS` of every source groupId, in that order — and the order matters, because `placeOnTimeline` adopts `rifff.bpm` as `state.bpm` when it is the *first* placement on an empty timeline. The map build does exactly the same thing: place, then delete the sources. `firstStartBar` is **0**, not `placedTimelineSpanBars(state)`, because the source material is the thing being replaced.

8. **`buildCoachSectionActions` changes shape, and its only caller is being deleted.** Foundations Task 10 rewrites it to place one clip per run and derives `startBar` from `nextCoachSectionStartBar`. This plan needs it to place at a section's **own** `startBar` and to thread a shared lane map across sections, so Task 6 rewrites it again into `src/renderer/src/state/coachMapPlacement.ts` and deletes the old file. Foundations' Task 11 conversion of `SssketchySectionPanel.tsx` is likewise deleted by Task 12 here. **That is not wasted work** — it is what kept the branch typechecking between two plans, and it is much cheaper than either plan trying to land both halves at once.

9. **`PLACE_LOOP_ON_TIMELINE` carries ONE `startBar` for the whole call.** Verified in the reducer: `for (const rifff of action.stems) rifffs[rifff.groupId] = { ...rifff, startBar: action.startBar }`. So N runs at N bars is N dispatches. They all go in one `BATCH`, and `history.ts` checkpoints a BATCH exactly once — its `BATCH` branch runs **before** the transient check, which is what makes a batch of purely transient coach actions still push one undo step.

10. **`history.ts` pins `coach` across undo EXCEPT `sections` and `tension`.** `walkIndex` (Task 4) is *where sssketchy is standing*, not material, so it rides on the **pinned** side by construction — undoing a clip edit must not throw the user out of the walk. `sections` stays on the snapshot side, unchanged.

11. **A view toggle is not an ArrangerMode.** `state.mode` ('normal' | 'sketch' | 'automation') is about how clips are *drawn and edited*, is cycled by Tab, and gates on `isSketchEligible`. The map is a different **view of the same arrangement**, so it gets its own boolean `mapView` with its own action, listed transient (a view toggle is not an undo step) and excluded from persistence, matching `state.mode`'s own treatment.

12. **sssketchy is a gentle coach, not a teacher or a drill sergeant.** Goals, not dictates. He states what a section is *for*, offers a way in, and is comfortable being ignored — and **he may say a section needs nothing**. The test for every line in Task 3: *could a friend say this while leaning over your shoulder, without it being annoying?* Copy rules: hand-written, lowercase, no emoji, no exclamation marks, no contractions ("there is a…", not "there's a"), 3–4 rotated variants, chosen with `pickLineVariant(table, seed)` — **never `Math.random`**. Every new table goes into `coachLines.ts` and into `coachLines.test.ts`'s own `tables` array, which is where the copy rules are actually enforced.

13. **React components are not unit-tested in this codebase** (CLAUDE.md). Tasks 7, 8, 9, 10 and 13 have **no component tests**, deliberately. They are verified by `npm run typecheck` + `npm run lint` + the pure logic's own tests, then by Elling's manual walkthrough. This environment has no GUI or audio tooling — **do not claim any UI behaviour was tested, and do not claim the map "feels" like anything.**

14. **Lint rules that will bite.** This repo **errors** on a synchronous `setState` inside a React effect (`react-hooks/set-state-in-effect`), on render-time impurity (`react-hooks/purity` — a bare `Date.now()` in a component body; the established workaround is a `useCallback`, see `SssketchySectionPanel.tsx`'s `startSection`), and requires an **explicit return type on every function**, including inline ones outside JSX. Prettier: `singleQuote: true`, `semi: false`, `printWidth: 100`, `trailingComma: none` — every code block below is already inside 100 columns.

15. **Design tokens are the law** (`src/renderer/src/styles/tokens.css`, `docs/design.md`): near-black shell, Silkscreen, **no `border-radius` anywhere**, colour spent only on things carrying audio information. The map spends colour in exactly one place — an ON cell on a **stem** row uses that stem's own type colour through the app's documented chip recipe (`C @ 14%` background, `C @ 50%` border) via `typeColorVar(stem.type)`. Everything else on the map is greyscale. **Do not invent a second colour table, and do not give a riser a colour.**

16. **Tooltips are one attribute.** `data-tooltip="…"` on the trigger, and nothing else — `global.css` resolves it with CSS anchor positioning and six placement fallbacks, so there is no alignment attribute, no wrapper and no component. Its own comment: *"If a tooltip ever needs a placement the six options above do not cover, add a seventh option to that list; do not reintroduce a per-call-site attribute."* Never put `title` and `data-tooltip` on the same node.

17. **`Dial` guards its own gestures.** Do **not** wrap a `RowGainDial` in a `stopPropagation` mousedown handler — `Dial.tsx` already does `preventDefault` + `stopPropagation` at press time and `suppressNextSyntheticClick()` at release, precisely because call-site guards never fixed the bug they were added for. The map does not render dials, but Task 8's row headers sit next to the arranger's, so this is worth not re-deriving.

18. **The wire format twin is NOT involved.** `EngineProject` / `buildEngineProject.ts` are a hand-synced pair (CLAUDE.md) and this plan changes neither. The map reaches the engine only by dispatching ordinary reducer actions that place ordinary clips. **If you conclude a native-engine change is needed, STOP and report it rather than planning one.**

---

## How the round trip works, end to end

Read this before Task 1. Everything below is the reasoning the tests encode.

**One pass of one row is one cell.** A section starts at `section.startBar` and runs for `section.passes` passes of `phraseBars` bars each, so pass `p` owns bars `[startBar + p·phraseBars, startBar + (p+1)·phraseBars)`. That window is the only geometry in the whole feature.

**Timeline → grid.** Every row contributes a list of bar windows: a stem row's clips (`[startBar + leftCrop, startBar + resolvePlayedBars)`), a riser row's risers (`[startBar, startBar + lengthBars)`). `readRowPasses` unions those windows inside each pass window, and calls the cell ON when the union covers more than half the pass. It is pure over bar numbers — no `AppState`, no `Rifff`, no React — so it is tested in `src/shared/` with plain integers.

**Grid → timeline.** `planCellToggle` takes the row's clips, the section, the pass and the value the user asked for, and returns `{ removeGroupIds, addRuns, blockedGroupIds }`. It never touches passes outside the one contiguous run the toggle disturbs, so a clip the user nudged three columns away keeps its nudge. The caller turns `addRuns` into the same `PLACE_LOOP_ON_TIMELINE` + `MOVE_TO_CHANNEL` + `SET_PLAYED_BARS` triple the build uses, puts `DELETE_RIFFFS` next to it, and dispatches the lot as one `BATCH`.

**Why that closes.** `planCellToggle` is specified as the inverse of `readRowPasses` and Task 2 tests it that way: build a row's windows, read the grid, toggle a cell, apply the plan to the windows, read again, and assert the grid is the one that was asked for. Four ordinary timeline edits get the same treatment in Task 1 — move, resize, delete, and a whole-row drag to another channel.

**Undo needs no code at all.** Every map edit is one `BATCH`, so `history.ts` pushes one checkpoint; undo restores `state.rifffs`, and the next render re-reads the map from them. `coach.sections` walks back with the clips (it is on the snapshot side), and `walkIndex` does not (it is pinned). There is nothing else to restore because there is nothing else.

**What the map is NOT.** It is not a second arrangement, it does not own the clips, and its section columns do **not** follow the music: a section's window is the coach's own `startBar`/`passes`, so dragging a whole section's clips one section to the right shows them in the *next* column. That is honest — the map reports where material sits against the structure the user agreed to — but it is a real limit and it is written down in "Known limits" at the bottom.

---

## File map

| File | Change |
|---|---|
| `src/shared/coachMapRead.ts` (new) | `MapBarWindow`, `MAP_CELL_MIN_COVERAGE`, `passBarWindow`, `sectionBarWindow`, `coveredBars`, `readRowPasses`, `rowPassesToCells` |
| `src/shared/coachMapRead.test.ts` (new) | full TDD, incl. the four ordinary-edit read-backs |
| `src/shared/coachMapEdit.ts` (new) | `MapClip`, `CoachMapRowPlan`, `clipsCrossingSectionEdge`, `passIsLocked`, `planCellToggle`, `remapCellsToPhrase` |
| `src/shared/coachMapEdit.test.ts` (new) | full TDD, incl. the read→toggle→apply→read round trip |
| `src/shared/coachLines.ts` | five new copy tables |
| `src/shared/coachLines.test.ts` | the new tables added to the `tables` array |
| `src/shared/coachWalk.ts` (new) | `startCoachWalk`, `walkCoachTo`, `endCoachWalk`, `coachSetupLine`, `coachWalkLine`, `sanitiseCoachWalkIndex` |
| `src/shared/coachWalk.test.ts` (new) | full TDD |
| `src/shared/coach.ts` | `walkIndex` field, its initialiser and its sanitiser |
| `src/shared/coach.test.ts` | `walkIndex` cases |
| `src/shared/coachClimax.ts` | `CoachClimaxStemInput`, `lockClimaxFromArrangeRoles` |
| `src/shared/coachClimax.test.ts` | cases for the new constructor |
| `src/shared/discoverSlotKind.ts` | `ARRANGE_ROLE_SLOT_KINDS`, `arrangeRoleToSlotKinds` |
| `src/shared/discoverSlotKind.test.ts` | the inverse table's own tests |
| `src/renderer/src/state/coachMapRows.ts` (new) | `CoachMapRow`, `coachMapRows(state)` — a plain function over `AppState`, not a hook |
| `src/renderer/src/state/coachMapRows.test.ts` (new) | full TDD against a synthetic `AppState` |
| `src/renderer/src/state/coachMapPlacement.ts` (new) | `buildCoachMapActions`, `buildCellToggleActions`, `buildMapRebuildActions` |
| `src/renderer/src/state/coachMapPlacement.test.ts` (new) | full TDD |
| `src/renderer/src/state/coachSectionPlacement.ts` | **DELETED** — replaced by `coachMapPlacement.ts` |
| `src/renderer/src/state/coachSectionPlacement.test.ts` | **DELETED** |
| `src/renderer/src/state/store.ts` | `mapView`; `SET_MAP_VIEW`, `COACH_RECORD_MAP_PLACEMENT`, `COACH_START_WALK`, `COACH_WALK_TO`, `COACH_END_WALK`; the section-draft actions deleted |
| `src/renderer/src/state/store.test.ts` | reducer tests for all of them |
| `src/renderer/src/state/history.ts` | the five new action types listed transient; the pinned-coach comment extended |
| `src/renderer/src/state/history.test.ts` | `walkIndex` pinning test |
| `src/renderer/src/state/serialize.ts` | `mapView` added to the transient rest-destructure |
| `src/renderer/src/state/serialize.test.ts` | `mapView` never reaches disk; `walkIndex` round trip |
| `src/renderer/src/components/ArrangementMap.tsx` (new) | the grid itself |
| `src/renderer/src/components/ArrangementMapCell.tsx` (new) | one square |
| `src/renderer/src/components/AutoArrangeCoachStep.tsx` (new) | the two questions, the phrase report, the build button |
| `src/renderer/src/components/AutoArrangeWizard.tsx` | roles → sssketchy → the map; the silent build goes |
| `src/renderer/src/components/SssketchyCoach.tsx` | walk line in the chain; the section panel unmounted |
| `src/renderer/src/components/Titlebar.tsx` | the `map` / `timeline` toggle |
| `src/renderer/src/App.tsx` | the toggle wired; `ArrangementMap` swapped for `Timeline`; the wizard's `onClose` |
| `src/renderer/src/components/SssketchySectionPanel.tsx` | **DELETED** |
| `src/renderer/src/state/coachSectionBridge.ts` (+ test) | **DELETED** |
| `src/renderer/src/state/useCoachSectionPreview.ts` (+ test) | **DELETED** |
| `src/shared/coachPhase2.ts` (+ test) | **DELETED** — `coachWalk.ts` replaces it |
| `src/shared/coachSections.ts` | `draftSection` support and `CoachSectionOp` removed; `CoachSectionDraft` kept |
| `src/shared/coachSteps.ts` | `p2-*` rows re-pointed at the map; `section-op` move kind removed |

## Commands used throughout (run from the repo root, `/Users/nickel/Claudecode/sssketch`)

```bash
npx vitest run src/shared/coachMapRead.test.ts   # one file
npx vitest run                                   # the whole suite
npm run typecheck                                # tsc, node + web configs
npm run lint                                     # eslint --cache . (4 known warnings)
```

---

### Task 1: Timeline → grid, as pure bar arithmetic

The read-back half. Pure over integers: no `AppState`, no `Rifff`, no React.

**Files:**
- Create: `src/shared/coachMapRead.ts`
- Create: `src/shared/coachMapRead.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/shared/coachMapRead.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  MAP_CELL_MIN_COVERAGE,
  coveredBars,
  passBarWindow,
  readRowPasses,
  rowPassesToCells,
  sectionBarWindow,
  type MapBarWindow
} from './coachMapRead'

/** A 4-pass section starting at bar 8, on a 4-bar phrase: bars 8..24. */
const SECTION = { startBar: 8, passes: 4 }
const PHRASE = 4

function window(startBar: number, endBar: number): MapBarWindow {
  return { startBar, endBar }
}

/** The grid as a string, so a failure prints something readable. */
function grid(windows: readonly MapBarWindow[]): string {
  return readRowPasses(windows, SECTION, PHRASE)
    .map((on) => (on ? 'x' : '.'))
    .join('')
}

describe('the geometry', () => {
  it('gives each pass its own window', () => {
    expect(passBarWindow(SECTION, PHRASE, 0)).toEqual({ startBar: 8, endBar: 12 })
    expect(passBarWindow(SECTION, PHRASE, 3)).toEqual({ startBar: 20, endBar: 24 })
  })

  it('gives the section its whole window', () => {
    expect(sectionBarWindow(SECTION, PHRASE)).toEqual({ startBar: 8, endBar: 24 })
  })

  it('never produces a zero-length window, so nothing downstream divides by it', () => {
    expect(passBarWindow({ startBar: 0, passes: 0 }, 0, 0)).toEqual({ startBar: 0, endBar: 1 })
  })
})

describe('coveredBars', () => {
  it('unions overlapping windows rather than counting them twice', () => {
    expect(coveredBars([window(0, 3), window(2, 4)], 0, 4)).toBe(4)
  })

  it('adds two halves of a pass together', () => {
    expect(coveredBars([window(8, 10), window(10, 12)], 8, 12)).toBe(4)
  })

  it('clips to the window it was asked about', () => {
    expect(coveredBars([window(0, 100)], 8, 12)).toBe(4)
  })

  it('is zero for windows that miss entirely', () => {
    expect(coveredBars([window(0, 8), window(12, 20)], 8, 12)).toBe(0)
  })
})

describe('readRowPasses', () => {
  it('reads a clip covering the whole section as every pass on', () => {
    expect(grid([window(8, 24)])).toBe('xxxx')
  })

  it('reads nothing as every pass off', () => {
    expect(grid([])).toBe('....')
  })

  it('reads one clip of one pass as one cell', () => {
    expect(grid([window(12, 16)])).toBe('.x..')
  })

  it('reads two clips with a hole between them as two runs', () => {
    expect(grid([window(8, 12), window(16, 24)])).toBe('x.xx')
  })

  it('ignores material outside the section entirely', () => {
    expect(grid([window(0, 8), window(24, 40)])).toBe('....')
  })

  // The four ordinary timeline edits, each read straight back.
  it('reads a clip nudged one bar as the same cells', () => {
    expect(grid([window(9, 25)])).toBe('xxxx')
  })

  it('reads a clip moved a whole pass as shifted cells', () => {
    expect(grid([window(12, 16)])).toBe('.x..')
    expect(grid([window(16, 20)])).toBe('..x.')
  })

  it('reads a clip resized one pass shorter as one fewer cell', () => {
    expect(grid([window(8, 20)])).toBe('xxx.')
  })

  it('reads a deleted clip as an empty row', () => {
    expect(grid([])).toBe('....')
  })

  it('needs MORE than half a pass, so a clip covering exactly half stays off', () => {
    expect(MAP_CELL_MIN_COVERAGE).toBe(0.5)
    expect(grid([window(8, 10)])).toBe('....')
    expect(grid([window(8, 11)])).toBe('x...')
  })

  it('reads a left-cropped clip as starting where it really starts', () => {
    // The caller passes the cropped window; this is the shape it takes.
    expect(grid([window(12, 24)])).toBe('.xxx')
  })
})

describe('rowPassesToCells', () => {
  it('writes an explicit answer for every pass, on and off', () => {
    expect(rowPassesToCells([true, false], '/kick.wav')).toEqual({
      '0|/kick.wav': true,
      '1|/kick.wav': false
    })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/shared/coachMapRead.test.ts`
Expected: FAIL — `Cannot find module './coachMapRead'`.

- [ ] **Step 3: Write the implementation**

Create `src/shared/coachMapRead.ts`:

```ts
/**
 * The map, read back off the timeline.
 *
 * THE RULE THIS FILE SERVES (spec, "The map"): **"toggling a cell edits the
 * real clips -- there is no commit step and no second model to drift out of
 * sync."** Taken literally that forbids storing a grid and writing clips
 * from it, so the map is a PROJECTION: what a cell shows is computed from
 * the material that is actually on that row at that bar, every render.
 * CoachSection.cells records what the map was BUILT from and is not read
 * for display afterwards.
 *
 * What falls out of that, and why it is worth the arithmetic below: moving a
 * clip, resizing it, deleting it, dragging it to another row and UNDO all
 * read back into the map for free. There is nothing else to keep up to date.
 *
 * Pure over bar numbers -- no AppState, no Rifff, no React -- so the risky
 * half of this feature is tested with plain integers. The renderer's own
 * ./../renderer/src/state/coachMapRows.ts turns clips and risers into the
 * MapBarWindows below; it is the only thing that knows what a clip is.
 *
 * What is deliberately NOT read here: state.mute, muteRegions, and
 * RiserClip.muted. This answers "is this row's material here", never "can
 * you hear it". A mute region is a hand-drawn hole inside a clip, and if an
 * off cell could mean one, toggling that cell back on would have to delete
 * it -- a hand-drawn edit vanishing behind one click on a grid. leftCrop IS
 * read, by the caller, because a cropped clip genuinely starts later and
 * that is presence rather than audibility.
 */

import { coachCellKey, type CoachCells } from './coachCells'

/** A half-open bar range, `startBar` inclusive and `endBar` exclusive --
 * the same convention CoachSectionBoundary's own bar numbers use. */
export interface MapBarWindow {
  startBar: number
  endBar: number
}

/**
 * How much of a pass has to carry material before the cell reads ON, as a
 * fraction of the pass. Strictly greater than, so a clip covering exactly
 * half a pass stays off.
 *
 * Half, rather than the two obvious alternatives, for reasons worth keeping:
 * "any overlap at all" lights two cells for a clip nudged a single bar, and
 * "covers the pass's downbeat" goes dark for a clip that starts one bar late
 * and plays the rest of the pass. Both are wrong in the direction the user
 * would notice. This one is wrong only about a clip that covers exactly
 * half, where there is no right answer.
 */
export const MAP_CELL_MIN_COVERAGE = 0.5

function safePhrase(phraseBars: number): number {
  return Number.isFinite(phraseBars) ? Math.max(1, Math.round(phraseBars)) : 1
}

function safePasses(passes: number): number {
  return Number.isFinite(passes) ? Math.max(1, Math.round(passes)) : 1
}

/** One pass's own bar window. */
export function passBarWindow(
  section: { startBar: number; passes: number },
  phraseBars: number,
  passIndex: number
): MapBarWindow {
  const phrase = safePhrase(phraseBars)
  const start = section.startBar + Math.max(0, Math.round(passIndex)) * phrase
  return { startBar: start, endBar: start + phrase }
}

/** The whole section's bar window -- the edge beyond which a toggle refuses
 * to act (./coachMapEdit.ts). */
export function sectionBarWindow(
  section: { startBar: number; passes: number },
  phraseBars: number
): MapBarWindow {
  const phrase = safePhrase(phraseBars)
  return {
    startBar: section.startBar,
    endBar: section.startBar + safePasses(section.passes) * phrase
  }
}

/**
 * How many bars of `[from, to)` are covered by the UNION of `windows`.
 *
 * The union, not the sum, because two clips on one row can overlap (the user
 * dragged one on top of another) and because two clips meeting end to end
 * cover a pass between them that neither covers alone. Bars are whole
 * numbers everywhere in this app, but this works on fractions too, which is
 * what lets a left-cropped clip be measured honestly.
 */
export function coveredBars(
  windows: readonly MapBarWindow[],
  from: number,
  to: number
): number {
  if (to <= from) return 0
  const clipped: MapBarWindow[] = []
  for (const w of windows) {
    const startBar = Math.max(from, w.startBar)
    const endBar = Math.min(to, w.endBar)
    if (endBar > startBar) clipped.push({ startBar, endBar })
  }
  if (clipped.length === 0) return 0
  clipped.sort((a, b) => a.startBar - b.startBar)

  let covered = 0
  let openStart = clipped[0].startBar
  let openEnd = clipped[0].endBar
  for (let i = 1; i < clipped.length; i += 1) {
    const next = clipped[i]
    if (next.startBar > openEnd) {
      covered += openEnd - openStart
      openStart = next.startBar
      openEnd = next.endBar
    } else if (next.endBar > openEnd) {
      openEnd = next.endBar
    }
  }
  return covered + (openEnd - openStart)
}

/**
 * One row of the map, read off the material that is really there: one
 * boolean per pass of this section.
 *
 * The inverse of ./coachMapEdit.ts's planCellToggle, and tested against it
 * there -- read, toggle, apply, read again, and the grid is the one that was
 * asked for.
 */
export function readRowPasses(
  windows: readonly MapBarWindow[],
  section: { startBar: number; passes: number },
  phraseBars: number
): boolean[] {
  const phrase = safePhrase(phraseBars)
  const passes = safePasses(section.passes)
  const out: boolean[] = []
  for (let passIndex = 0; passIndex < passes; passIndex += 1) {
    const w = passBarWindow(section, phrase, passIndex)
    out.push(coveredBars(windows, w.startBar, w.endBar) > phrase * MAP_CELL_MIN_COVERAGE)
  }
  return out
}

/** A read row, written back as explicit cells -- every pass, on and off, so
 * no template can overrule what is really on the timeline. Used only when
 * the phrase length changes and the map has to be re-laid (./coachMapEdit's
 * remapCellsToPhrase), never for display. */
export function rowPassesToCells(passes: readonly boolean[], path: string): CoachCells {
  const cells: CoachCells = {}
  for (let passIndex = 0; passIndex < passes.length; passIndex += 1) {
    cells[coachCellKey(passIndex, path)] = passes[passIndex]
  }
  return cells
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/shared/coachMapRead.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/coachMapRead.ts src/shared/coachMapRead.test.ts
git commit -m "$(cat <<'EOF'
Ask the timeline what the map should say

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

### Task 2: Grid → timeline, and the round trip that closes

The write half, specified as the exact inverse of Task 1 and tested that way.

**Files:**
- Create: `src/shared/coachMapEdit.ts`
- Create: `src/shared/coachMapEdit.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/shared/coachMapEdit.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { cellIsOn } from './coachCells'
import { readRowPasses, type MapBarWindow } from './coachMapRead'
import {
  clipsCrossingSectionEdge,
  passIsLocked,
  planCellToggle,
  remapCellsToPhrase,
  type MapClip
} from './coachMapEdit'

/** A 4-pass section starting at bar 8, on a 4-bar phrase: bars 8..24. */
const SECTION = { startBar: 8, passes: 4 }
const PHRASE = 4

function clip(groupId: string, startBar: number, endBar: number): MapClip {
  return { groupId, startBar, endBar }
}

/** Applies a plan to a clip list the way the reducer will: drop the removed
 * ones, add one clip per run. Lets a test close the loop without a store. */
function apply(clips: readonly MapClip[], plan: ReturnType<typeof planCellToggle>): MapClip[] {
  const kept = clips.filter((c) => !plan.removeGroupIds.includes(c.groupId))
  const added = plan.addRuns.map((run, i): MapClip => {
    const startBar = SECTION.startBar + run.startPass * PHRASE
    return { groupId: `new-${i}`, startBar, endBar: startBar + run.passCount * PHRASE }
  })
  return [...kept, ...added]
}

function grid(clips: readonly MapClip[]): string {
  const windows: MapBarWindow[] = clips.map((c) => ({ startBar: c.startBar, endBar: c.endBar }))
  return readRowPasses(windows, SECTION, PHRASE)
    .map((on) => (on ? 'x' : '.'))
    .join('')
}

describe('planCellToggle', () => {
  it('does nothing at all when the cell already says what was asked', () => {
    const clips = [clip('a', 8, 24)]
    const plan = planCellToggle({ clips, section: SECTION, phraseBars: PHRASE, passIndex: 0, on: true })
    expect(plan).toEqual({ removeGroupIds: [], addRuns: [], blockedGroupIds: [] })
  })

  it('turning off the END of a run shortens it rather than splitting it', () => {
    const clips = [clip('a', 8, 24)]
    const plan = planCellToggle({ clips, section: SECTION, phraseBars: PHRASE, passIndex: 3, on: false })
    expect(plan.removeGroupIds).toEqual(['a'])
    expect(plan.addRuns).toEqual([{ startPass: 0, passCount: 3 }])
  })

  it('turning off the MIDDLE of a run leaves two runs', () => {
    const clips = [clip('a', 8, 24)]
    const plan = planCellToggle({ clips, section: SECTION, phraseBars: PHRASE, passIndex: 1, on: false })
    expect(plan.removeGroupIds).toEqual(['a'])
    expect(plan.addRuns).toEqual([
      { startPass: 0, passCount: 1 },
      { startPass: 2, passCount: 2 }
    ])
  })

  it('turning a cell ON between two runs merges all three into one clip', () => {
    const clips = [clip('a', 8, 12), clip('b', 16, 24)]
    const plan = planCellToggle({ clips, section: SECTION, phraseBars: PHRASE, passIndex: 1, on: true })
    expect(plan.removeGroupIds.sort()).toEqual(['a', 'b'])
    expect(plan.addRuns).toEqual([{ startPass: 0, passCount: 4 }])
  })

  it('turning a cell ON on an empty row adds one clip and removes nothing', () => {
    const plan = planCellToggle({ clips: [], section: SECTION, phraseBars: PHRASE, passIndex: 2, on: true })
    expect(plan.removeGroupIds).toEqual([])
    expect(plan.addRuns).toEqual([{ startPass: 2, passCount: 1 }])
  })

  it('leaves a run the toggle did not touch completely alone', () => {
    // Two separate clips; the toggle only disturbs the second.
    const clips = [clip('a', 8, 12), clip('b', 16, 24)]
    const plan = planCellToggle({ clips, section: SECTION, phraseBars: PHRASE, passIndex: 3, on: false })
    expect(plan.removeGroupIds).toEqual(['b'])
    expect(plan.addRuns).toEqual([{ startPass: 2, passCount: 1 }])
  })

  it('keeps a nudged clip in an untouched run, nudge and all', () => {
    // 'a' was dragged a bar late by hand. The toggle is three passes away.
    const clips = [clip('a', 9, 12), clip('b', 20, 24)]
    const plan = planCellToggle({ clips, section: SECTION, phraseBars: PHRASE, passIndex: 3, on: false })
    expect(plan.removeGroupIds).toEqual(['b'])
    expect(plan.addRuns).toEqual([])
  })
})

describe('a clip that crosses the section edge', () => {
  const straddling = [clip('long', 4, 24)]

  it('is named rather than acted on', () => {
    expect(clipsCrossingSectionEdge(straddling, SECTION, PHRASE)).toEqual(['long'])
  })

  it('locks every pass it touches', () => {
    expect(passIsLocked(straddling, SECTION, PHRASE, 0)).toBe(true)
    expect(passIsLocked(straddling, SECTION, PHRASE, 3)).toBe(true)
    expect(passIsLocked([clip('a', 8, 12)], SECTION, PHRASE, 0)).toBe(false)
  })

  it('makes the toggle a refusal, never a deletion', () => {
    const plan = planCellToggle({
      clips: straddling,
      section: SECTION,
      phraseBars: PHRASE,
      passIndex: 1,
      on: false
    })
    expect(plan.removeGroupIds).toEqual([])
    expect(plan.addRuns).toEqual([])
    expect(plan.blockedGroupIds).toEqual(['long'])
  })

  it('does not block a toggle in a run it is nowhere near', () => {
    const clips = [clip('long', 4, 12), clip('b', 16, 24)]
    const plan = planCellToggle({ clips, section: SECTION, phraseBars: PHRASE, passIndex: 3, on: false })
    expect(plan.blockedGroupIds).toEqual([])
    expect(plan.removeGroupIds).toEqual(['b'])
  })
})

describe('the round trip', () => {
  // The single most important test in this plan: read the grid, toggle a
  // cell, apply the plan, read the grid again, and get what was asked for.
  const cases: { name: string; clips: MapClip[]; passIndex: number; on: boolean; want: string }[] = [
    { name: 'off at the end', clips: [clip('a', 8, 24)], passIndex: 3, on: false, want: 'xxx.' },
    { name: 'off in the middle', clips: [clip('a', 8, 24)], passIndex: 1, on: false, want: 'x.xx' },
    { name: 'off at the start', clips: [clip('a', 8, 24)], passIndex: 0, on: false, want: '.xxx' },
    { name: 'on from empty', clips: [], passIndex: 2, on: true, want: '..x.' },
    {
      name: 'on between two runs',
      clips: [clip('a', 8, 12), clip('b', 16, 24)],
      passIndex: 1,
      on: true,
      want: 'xxxx'
    },
    {
      name: 'off the only pass of a run',
      clips: [clip('a', 8, 12), clip('b', 16, 24)],
      passIndex: 0,
      on: false,
      want: '..xx'
    }
  ]

  for (const c of cases) {
    it(`survives ${c.name}`, () => {
      const plan = planCellToggle({
        clips: c.clips,
        section: SECTION,
        phraseBars: PHRASE,
        passIndex: c.passIndex,
        on: c.on
      })
      expect(grid(apply(c.clips, plan))).toBe(c.want)
    })
  }

  it('is idempotent -- toggling to the value it already has changes nothing', () => {
    const clips = [clip('a', 8, 24)]
    const plan = planCellToggle({ clips, section: SECTION, phraseBars: PHRASE, passIndex: 2, on: true })
    expect(grid(apply(clips, plan))).toBe(grid(clips))
  })

  it('goes back where it started when a toggle is reversed', () => {
    const clips = [clip('a', 8, 24)]
    const off = planCellToggle({ clips, section: SECTION, phraseBars: PHRASE, passIndex: 1, on: false })
    const afterOff = apply(clips, off)
    expect(grid(afterOff)).toBe('x.xx')
    const on = planCellToggle({
      clips: afterOff,
      section: SECTION,
      phraseBars: PHRASE,
      passIndex: 1,
      on: true
    })
    expect(grid(apply(afterOff, on))).toBe('xxxx')
  })
})

describe('remapCellsToPhrase', () => {
  it('splits every pass in two when the phrase halves', () => {
    const cells = { '0|/a.wav': true, '1|/a.wav': false }
    const remapped = remapCellsToPhrase(cells, ['/a.wav'], 2, 4)
    expect(cellIsOn(remapped, 0, '/a.wav', false)).toBe(true)
    expect(cellIsOn(remapped, 1, '/a.wav', false)).toBe(true)
    expect(cellIsOn(remapped, 2, '/a.wav', true)).toBe(false)
    expect(cellIsOn(remapped, 3, '/a.wav', true)).toBe(false)
  })

  it('takes the first of each pair when the phrase doubles', () => {
    const cells = { '0|/a.wav': true, '1|/a.wav': false, '2|/a.wav': false, '3|/a.wav': false }
    const remapped = remapCellsToPhrase(cells, ['/a.wav'], 4, 2)
    expect(cellIsOn(remapped, 0, '/a.wav', false)).toBe(true)
    expect(cellIsOn(remapped, 1, '/a.wav', true)).toBe(false)
  })

  it('leaves a path it was not given alone', () => {
    const remapped = remapCellsToPhrase({ '0|/b.wav': false }, ['/a.wav'], 2, 4)
    expect(remapped['0|/b.wav']).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/shared/coachMapEdit.test.ts`
Expected: FAIL — `Cannot find module './coachMapEdit'`.

- [ ] **Step 3: Write the implementation**

Create `src/shared/coachMapEdit.ts`:

```ts
/**
 * What one click on the map actually does to the timeline.
 *
 * The exact inverse of ./coachMapRead.ts's readRowPasses, and tested against
 * it: read the grid, toggle a cell, apply the plan, read again, and the grid
 * is the one that was asked for (./coachMapEdit.test.ts, "the round trip").
 *
 * TWO RULES, BOTH ABOUT NOT DESTROYING WORK:
 *
 * 1. **A toggle rewrites one RUN, never a row and never a section.** The
 *    plan below finds the single contiguous stretch of passes the toggle
 *    disturbs and touches nothing outside it. A clip the user nudged, faded
 *    or resized three columns away keeps every bit of that, because the plan
 *    never names it. The obvious alternative -- regenerate the row's clips
 *    for the whole section -- is two lines shorter and quietly eats hand
 *    edits, which is exactly the thing the map is not allowed to do.
 *
 * 2. **A clip reaching outside the section is REFUSED, not trimmed.** It
 *    cannot be deleted without silently taking material out of the
 *    neighbouring section, and it cannot be resized without guessing which
 *    end the user meant. So planCellToggle returns it in `blockedGroupIds`
 *    and does nothing, passIsLocked lets the map draw that cell as
 *    untouchable, and the user is sent to the timeline, where both edges are
 *    visible. The map's own layout never straddles a section edge, so this
 *    only ever fires on a clip a person made.
 *
 * Everything here is pure over bar numbers and groupIds. Turning a plan into
 * real actions is ../renderer/src/state/coachMapPlacement.ts's job.
 */

import { coachCellKey, type CoachCellRun, type CoachCells } from './coachCells'
import { readRowPasses, sectionBarWindow } from './coachMapRead'

/** One clip on one map row, as the map needs to see it. `endBar` is
 * exclusive and already accounts for leftCrop -- the renderer resolves both
 * (coachMapRows.ts). */
export interface MapClip {
  groupId: string
  startBar: number
  endBar: number
}

/** What one toggle asks the timeline for. */
export interface CoachMapRowPlan {
  /** Clips that must go -- DELETE_RIFFFS. Only ever clips lying wholly
   * inside this section. */
  removeGroupIds: string[]
  /** Runs that must appear, as pass ranges inside this section. One clip
   * each, which is what a person would draw. */
  addRuns: CoachCellRun[]
  /** Clips the toggle refused to touch because they reach outside this
   * section. Non-empty means the plan is a NO-OP and the caller says why. */
  blockedGroupIds: string[]
}

function clipWindows(clips: readonly MapClip[]): { startBar: number; endBar: number }[] {
  return clips.map((clip) => ({ startBar: clip.startBar, endBar: clip.endBar }))
}

function overlaps(clip: MapClip, startBar: number, endBar: number): boolean {
  return clip.startBar < endBar && clip.endBar > startBar
}

/** Every clip on this row that overlaps the section but is not wholly
 * inside it, in the order it was given. */
export function clipsCrossingSectionEdge(
  clips: readonly MapClip[],
  section: { startBar: number; passes: number },
  phraseBars: number
): string[] {
  const window = sectionBarWindow(section, phraseBars)
  return clips
    .filter(
      (clip) =>
        overlaps(clip, window.startBar, window.endBar) &&
        (clip.startBar < window.startBar || clip.endBar > window.endBar)
    )
    .map((clip) => clip.groupId)
}

/** The maximal contiguous stretch of `flags` containing `passIndex`, or null
 * when that pass is false. */
function runAround(flags: readonly boolean[], passIndex: number): CoachCellRun | null {
  if (flags[passIndex] !== true) return null
  let startPass = passIndex
  while (startPass > 0 && flags[startPass - 1]) startPass -= 1
  let endPass = passIndex
  while (endPass + 1 < flags.length && flags[endPass + 1]) endPass += 1
  return { startPass, passCount: endPass - startPass + 1 }
}

/** Every contiguous stretch of `flags` that is true, restricted to
 * `[from, from + count)`. */
function runsWithin(flags: readonly boolean[], from: number, count: number): CoachCellRun[] {
  const runs: CoachCellRun[] = []
  let open: CoachCellRun | null = null
  for (let passIndex = from; passIndex < from + count; passIndex += 1) {
    if (flags[passIndex]) {
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

/** Whether this cell cannot be toggled, because a clip covering it reaches
 * outside the section. The map draws these dashed. */
export function passIsLocked(
  clips: readonly MapClip[],
  section: { startBar: number; passes: number },
  phraseBars: number,
  passIndex: number
): boolean {
  const blocked = new Set(clipsCrossingSectionEdge(clips, section, phraseBars))
  if (blocked.size === 0) return false
  const flags = readRowPasses(clipWindows(clips), section, phraseBars)
  const affected = runAround(flags, passIndex) ?? { startPass: passIndex, passCount: 1 }
  const from = section.startBar + affected.startPass * Math.max(1, Math.round(phraseBars))
  const to = from + affected.passCount * Math.max(1, Math.round(phraseBars))
  return clips.some((clip) => blocked.has(clip.groupId) && overlaps(clip, from, to))
}

export interface PlanCellToggleInput {
  /** Every clip on this map row, anywhere in the project. */
  clips: readonly MapClip[]
  section: { startBar: number; passes: number }
  phraseBars: number
  passIndex: number
  /** The value the user just asked for -- not a flip, an assertion. A
   * caller that passes what the cell already says gets an empty plan, which
   * is what makes a double-dispatch harmless. */
  on: boolean
}

/**
 * One cell's worth of timeline edit.
 *
 * Reads the row as it really is, applies the one change, finds the single
 * contiguous run the change disturbs, and rewrites only that. Everything
 * outside it is untouched by construction.
 */
export function planCellToggle(input: PlanCellToggleInput): CoachMapRowPlan {
  const empty: CoachMapRowPlan = { removeGroupIds: [], addRuns: [], blockedGroupIds: [] }
  const phrase = Number.isFinite(input.phraseBars) ? Math.max(1, Math.round(input.phraseBars)) : 1
  const before = readRowPasses(clipWindows(input.clips), input.section, phrase)
  if (input.passIndex < 0 || input.passIndex >= before.length) return empty
  if (before[input.passIndex] === input.on) return empty

  const after = [...before]
  after[input.passIndex] = input.on

  // The affected stretch is the union of the run the pass was in and the run
  // it is now in -- which covers both directions with one rule: turning off
  // shrinks or splits the old run, turning on merges into a new one.
  const wasIn = runAround(before, input.passIndex)
  const nowIn = runAround(after, input.passIndex)
  const startPass = Math.min(wasIn?.startPass ?? input.passIndex, nowIn?.startPass ?? input.passIndex)
  const endPass = Math.max(
    (wasIn?.startPass ?? input.passIndex) + (wasIn?.passCount ?? 1),
    (nowIn?.startPass ?? input.passIndex) + (nowIn?.passCount ?? 1)
  )
  const fromBar = input.section.startBar + startPass * phrase
  const toBar = input.section.startBar + endPass * phrase

  const blocked = new Set(clipsCrossingSectionEdge(input.clips, input.section, phrase))
  const touched = input.clips.filter((clip) => overlaps(clip, fromBar, toBar))
  const blockedHere = touched.filter((clip) => blocked.has(clip.groupId)).map((c) => c.groupId)
  // A refusal, never a partial edit: nothing is removed and nothing is added.
  if (blockedHere.length > 0) return { ...empty, blockedGroupIds: blockedHere }

  return {
    removeGroupIds: touched.map((clip) => clip.groupId),
    addRuns: runsWithin(after, startPass, endPass - startPass),
    blockedGroupIds: []
  }
}

/**
 * Cell edits, carried across a change of phrase length.
 *
 * "He can change it afterwards; the map re-sizes, it does not rebuild"
 * (spec). A section that was 2 passes of 8 bars becomes 4 passes of 4, so
 * each new pass inherits from the old pass it sits INSIDE -- proportional,
 * floor-rounded, and total in both directions. Halving loses the finer
 * half of a pair, which is unavoidable: there is no 8-bar answer that
 * remembers two different 4-bar ones.
 *
 * Only ever called with cells that were just READ off the timeline
 * (rowPassesToCells), never with the build-time ones -- the timeline is the
 * truth, and a re-size that carried stale build-time cells would throw away
 * every edit made since.
 */
export function remapCellsToPhrase(
  cells: CoachCells,
  paths: readonly string[],
  fromPasses: number,
  toPasses: number
): CoachCells {
  const from = Math.max(1, Math.round(fromPasses))
  const to = Math.max(1, Math.round(toPasses))
  const out: CoachCells = {}
  for (const path of paths) {
    for (let passIndex = 0; passIndex < to; passIndex += 1) {
      const source = Math.min(from - 1, Math.floor((passIndex * from) / to))
      const value = cells[coachCellKey(source, path)]
      if (value !== undefined) out[coachCellKey(passIndex, path)] = value
    }
  }
  return out
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/shared/coachMapEdit.test.ts src/shared/coachMapRead.test.ts`
Expected: PASS, both files.

- [ ] **Step 5: Commit**

```bash
git add src/shared/coachMapEdit.ts src/shared/coachMapEdit.test.ts
git commit -m "$(cat <<'EOF'
One square, one run, and nothing else touched

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

### Task 3: What he says on the map

Five copy tables. Read Finding 12 and the spec's own tone table before writing a word of this, and check every line against it.

**Files:**
- Modify: `src/shared/coachLines.ts`
- Modify: `src/shared/coachLines.test.ts`

- [ ] **Step 1: Read the tone table and the existing tables**

Open `docs/superpowers/specs/2026-09-23-arrangement-map-design.md` § "Tone: a gentle coach, not a teacher or a drill sergeant" and read the four worked examples. Then read `src/shared/coachLines.ts` end to end for the voice: no contractions, lowercase, a fact and then a way in, never a claim about the user's music.

- [ ] **Step 2: Add the tables**

Append to `src/shared/coachLines.ts`:

```ts
/** "What is this loop?" -- the first of the two opening questions (spec,
 * "Getting started: two questions"). It decides where the material the user
 * already has lands in the structure, and it replaces all six of phase
 * one's steps.
 *
 * Note what none of these do: none of them tells him what the loop IS. The
 * app has not heard it. Every variant asks, and the last one says plainly
 * what "not sure" will be taken to mean, so choosing it is not a trapdoor. */
export const COACH_LOOP_QUESTION_LINES: readonly string[] = [
  'before anything else: what is this loop, to you? the drop, a verse, or an intro.',
  'one question first. is this the drop, a verse, or an intro? not sure is a real answer.',
  'where does this loop live in a track? drop, verse, intro -- or leave it to me.',
  'what is this, as a section? say not sure and i will treat it as the drop.'
]

/** "How long a journey?" -- the second question. Shown next to the article's
 * own letter notation, which is why none of these spell the shapes out: the
 * letters are on the buttons.
 *
 * There is deliberately no genre here and there must not be (coachShapes.ts
 * explains why at length): the section ORDER barely varies by genre, so a
 * genre list would be one template wearing six names. */
export const COACH_SHAPE_QUESTION_LINES: readonly string[] = [
  'how long a journey? short is about two minutes, standard about four, long about six.',
  'pick a length. the letters are the sections in order -- a is the intro and the outro.',
  'how far do you want to travel? the same order underneath, just more of it.',
  'length next. any of these is a fine shape; you can move all of it afterwards.'
]

/**
 * What each kind of section is FOR -- the whole of the section walk's copy.
 *
 * THE RULE (spec): **goals, not dictates. advice, not rules.** A goal is a
 * statement about song structure, which is true regardless of what the user
 * made -- so it cannot be wrong about music the app has not heard. An
 * instruction ("add a riser at bar 48") can be, and a lesson ("a verse, by
 * definition, establishes...") is a teacher, which he is not.
 *
 * Every one of these six tables carries at least one variant that says the
 * section may need NOTHING. That is not filler: "a coach who always has a
 * suggestion is a drill sergeant with better manners" (spec). The test to
 * apply before adding a line here: could a friend say this while leaning
 * over your shoulder, without it being annoying?
 */
export const COACH_SECTION_GOAL_LINES: Record<string, readonly string[]> = {
  intro: [
    'this one is the way in. it does not have to do much.',
    'an intro is for getting someone into the room. two or three parts is plenty.',
    'the opening. the less it gives away, the further the rest has to travel.',
    'this is the way in. nothing has to change here if you like it as it is.'
  ],
  verse: [
    'the verse should hint at the drop without giving it away.',
    'this one carries the track between the big moments. it can be quieter than you think.',
    'a verse is room to breathe. want to try taking the hook out?',
    'this section holds the middle. it is allowed to be less than the drop.'
  ],
  build: [
    'this is where it lifts.',
    'this one is the lift into the drop. the fewer parts it has, the more the drop adds.',
    'a build is a climb. taking something away here often lifts harder than adding.',
    'this is the run-up. nothing has to change if it already pulls.'
  ],
  drop: [
    'this is the payoff. everything you have is welcome here.',
    'the drop. this is the loop you built, doing what it does.',
    'this one is the top of the track. it already does its job.',
    'the big one. nothing has to come out here unless you want it to.'
  ],
  breakdown: [
    'a breakdown empties the room out for a moment.',
    'this one is the drop again with the floor taken away.',
    'the quiet stretch. the less that is in here, the bigger what follows feels.',
    'this is space. it can be very little and still work.'
  ],
  outro: [
    'the way out. parts leaving one at a time is usually enough.',
    'an outro lets go. it does not need a new idea.',
    'this is the end of the journey. thinning out is the whole move.',
    'the last stretch. nothing has to change here.'
  ]
}

/** Entering the walk. Every variant states the way out in the same breath
 * as the offer -- "leaving the walk keeps the map" (spec) is the single
 * thing a user needs to know before agreeing to be walked anywhere. */
export const COACH_WALK_START_LINES: readonly string[] = [
  'i will go through the sections one at a time. leave whenever you like -- the map stays.',
  'section by section, then. stepping out keeps everything exactly as it is.',
  'we can walk these in order. the map is yours either way.',
  'one section at a time from here. leaving does not undo anything.'
]

/** Leaving the walk, at the end or early. Reports the state of things,
 * which is a fact, and claims nothing about whether the track is any good. */
export const COACH_WALK_END_LINES: readonly string[] = [
  'that is all of them. the map stays exactly as it is.',
  'end of the walk. everything here is ordinary clips now.',
  'through to the end. move any of it, or leave it.',
  'that is the whole shape. the rest is listening.'
]

/** What the map says about a cell it cannot toggle. Deliberately flat and
 * unrotated: it is a tooltip on a control, not something sssketchy says. */
export const COACH_MAP_LOCKED_CELL_HINT =
  'this clip runs past the edge of the section -- edit it on the timeline'
```

- [ ] **Step 3: Add them to the copy-rule test**

Open `src/shared/coachLines.test.ts`, find its `tables` array (the list every copy rule is checked against) and add the four flat tables plus every value of the goal record:

```ts
  ['COACH_LOOP_QUESTION_LINES', COACH_LOOP_QUESTION_LINES],
  ['COACH_SHAPE_QUESTION_LINES', COACH_SHAPE_QUESTION_LINES],
  ['COACH_WALK_START_LINES', COACH_WALK_START_LINES],
  ['COACH_WALK_END_LINES', COACH_WALK_END_LINES],
  ...Object.entries(COACH_SECTION_GOAL_LINES).map(
    ([type, lines]): [string, readonly string[]] => [`COACH_SECTION_GOAL_LINES.${type}`, lines]
  ),
```

and add one test that pins the rule the spec cares most about:

```ts
describe('the section goals', () => {
  it('covers every section type the shapes can produce', () => {
    for (const type of ['intro', 'verse', 'build', 'drop', 'breakdown', 'outro']) {
      expect(COACH_SECTION_GOAL_LINES[type]?.length ?? 0).toBeGreaterThanOrEqual(3)
    }
  })

  it('always leaves him a way to say a section needs nothing', () => {
    // "a coach who always has a suggestion is a drill sergeant with better
    // manners" (spec). Every type has at least one variant that lets the
    // section stand as it is.
    for (const lines of Object.values(COACH_SECTION_GOAL_LINES)) {
      expect(lines.some((line) => /nothing|already|does not need|plenty/.test(line))).toBe(true)
    }
  })

  it('never tells the user to do something at a bar number', () => {
    // The spec's own drill-sergeant example is "add a riser at bar 48".
    for (const lines of Object.values(COACH_SECTION_GOAL_LINES)) {
      for (const line of lines) expect(line).not.toMatch(/\bbar \d/)
    }
  })
})
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/shared/coachLines.test.ts`
Expected: PASS. If the existing copy rules reject a line (an exclamation mark, a capital, a contraction), **fix the line**, not the rule.

- [ ] **Step 5: Commit**

```bash
git add src/shared/coachLines.ts src/shared/coachLines.test.ts
git commit -m "$(cat <<'EOF'
What each stretch of a song is for, said like a friend

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

### Task 4: The walk, as a state machine

Where he is standing on the map, and the one thought that goes with it. Replaces `coachPhase2.ts`'s one-section-at-a-time transitions.

**Files:**
- Create: `src/shared/coachWalk.ts`
- Create: `src/shared/coachWalk.test.ts`
- Modify: `src/shared/coach.ts`
- Modify: `src/shared/coach.test.ts`

- [ ] **Step 1: Re-read `coach.ts`** — foundations added four fields to `CoachState` and rewrote `sanitiseLoadedCoach`. Work from what is on disk.

- [ ] **Step 2: Write the failing test**

Create `src/shared/coachWalk.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { startCoach, type CoachState } from './coach'
import type { CoachSection } from './coachSections'
import {
  coachSetupLine,
  coachWalkLine,
  endCoachWalk,
  sanitiseCoachWalkIndex,
  startCoachWalk,
  walkCoachTo
} from './coachWalk'

const T0 = 1_000

function section(id: string, type: CoachSection['type'], name: string): CoachSection {
  return { id, type, name, passes: 2, cells: {}, startBar: 0, placedGroupIds: {} }
}

function flowWith(sections: CoachSection[]): CoachState {
  return { ...startCoach(T0), sections }
}

const THREE = [
  section('a', 'intro', 'intro'),
  section('b', 'verse', 'verse'),
  section('c', 'drop', 'drop')
]

describe('starting the walk', () => {
  it('stands him on the first section', () => {
    expect(startCoachWalk(flowWith(THREE), T0).walkIndex).toBe(0)
  })

  it('refuses to start on a map that does not exist yet', () => {
    expect(startCoachWalk(flowWith([]), T0).walkIndex).toBeNull()
  })

  it('puts him on the arrangement step, wherever he was', () => {
    const state = { ...flowWith(THREE), stepId: 'p3-balance' as const }
    expect(startCoachWalk(state, T0).stepId).toBe('p2-section')
  })
})

describe('walking', () => {
  it('moves to the section asked for and rotates the line', () => {
    const walking = startCoachWalk(flowWith(THREE), T0)
    const next = walkCoachTo(walking, T0 + 10, 1)
    expect(next.walkIndex).toBe(1)
    expect(next.lineSeed).toBe(walking.lineSeed + 1)
  })

  it('ends the walk when asked to step past the last section', () => {
    const walking = walkCoachTo(startCoachWalk(flowWith(THREE), T0), T0, 2)
    const past = walkCoachTo(walking, T0 + 10, 3)
    expect(past.walkIndex).toBeNull()
  })

  it('refuses to step before the first section rather than wrapping', () => {
    const walking = startCoachWalk(flowWith(THREE), T0)
    expect(walkCoachTo(walking, T0 + 10, -1).walkIndex).toBe(0)
  })

  it('does not move the clock backwards when nothing changed', () => {
    const walking = startCoachWalk(flowWith(THREE), T0)
    expect(walkCoachTo(walking, T0 + 10, 0)).toBe(walking)
  })
})

describe('leaving the walk', () => {
  it('KEEPS THE MAP -- sections are untouched', () => {
    const walking = startCoachWalk(flowWith(THREE), T0)
    const left = endCoachWalk(walking, T0 + 10)
    expect(left.walkIndex).toBeNull()
    expect(left.sections).toEqual(THREE)
  })

  it('leaves a flow that was not walking exactly as it was', () => {
    const state = flowWith(THREE)
    expect(endCoachWalk(state, T0)).toBe(state)
  })
})

describe('coachWalkLine', () => {
  it('says what the section he is standing on is FOR', () => {
    const walking = startCoachWalk(flowWith(THREE), T0)
    expect(coachWalkLine(walking)).not.toBeNull()
  })

  it('says something different about a verse than about a drop', () => {
    const walking = startCoachWalk(flowWith(THREE), T0)
    expect(coachWalkLine(walkCoachTo(walking, T0, 1))).not.toBe(
      coachWalkLine(walkCoachTo(walking, T0, 2))
    )
  })

  it('is deterministic on the seed, never random', () => {
    const walking = startCoachWalk(flowWith(THREE), T0)
    expect(coachWalkLine(walking)).toBe(coachWalkLine(walking))
  })

  it('varies two sections of the SAME type, so a walk does not repeat itself', () => {
    const twoVerses = flowWith([section('a', 'verse', 'verse'), section('b', 'verse', 'verse 2')])
    const walking = startCoachWalk(twoVerses, T0)
    expect(coachWalkLine(walking)).not.toBe(coachWalkLine(walkCoachTo(walking, T0, 1)))
  })

  it('says NOTHING when he is not walking', () => {
    expect(coachWalkLine(flowWith(THREE))).toBeNull()
  })
})

describe('coachSetupLine', () => {
  it('asks what the loop is until that is answered', () => {
    const line = coachSetupLine(startCoach(T0))
    expect(line).not.toBeNull()
    expect(line).toContain('loop')
  })

  it('asks about length once the loop is answered', () => {
    const answered = { ...startCoach(T0), loopIs: 'drop' as const }
    expect(coachSetupLine(answered)).not.toBe(coachSetupLine(startCoach(T0)))
  })

  it('says NOTHING once both are answered -- the phrase report speaks for itself', () => {
    const both = { ...startCoach(T0), loopIs: 'drop' as const, shape: 'standard' as const }
    expect(coachSetupLine(both)).toBeNull()
  })

  it('says NOTHING once a map exists', () => {
    const built = { ...flowWith(THREE), loopIs: 'drop' as const }
    expect(coachSetupLine(built)).toBeNull()
  })
})

describe('the load repair', () => {
  it('drops an index that names no section', () => {
    expect(sanitiseCoachWalkIndex(7, 3)).toBeNull()
    expect(sanitiseCoachWalkIndex(-1, 3)).toBeNull()
    expect(sanitiseCoachWalkIndex('two', 3)).toBeNull()
    expect(sanitiseCoachWalkIndex(1, 3)).toBe(1)
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/shared/coachWalk.test.ts`
Expected: FAIL — `Cannot find module './coachWalk'`.

- [ ] **Step 4: Add `walkIndex` to `CoachState`**

In `src/shared/coach.ts`, after the four fields foundations added:

```ts
  /** WHICH SECTION COLUMN HE IS STANDING ON, or null when he is not
   * walking. "He walks the sections with you, one at a time, highlighting
   * that column and naming what the section is FOR" (spec).
   *
   * Pinned across undo (history.ts), and the reason is the same one the
   * phrase answer has: this is WHERE SSSKETCHY IS, not timeline material.
   * Undoing a clip edit must not throw the user out of the walk -- it is
   * the single most likely moment for an undo to happen. `sections` walks
   * back with the clips it names; this does not.
   *
   * "Leaving the walk keeps the map" (spec), which is why this is a
   * separate field from `sections` rather than a flag on one of them:
   * nulling it changes nothing about the arrangement at all. */
  walkIndex: number | null
```

`startCoach` gets `walkIndex: null`. `sanitiseLoadedCoach` gets, after its `sections:` line:

```ts
    // Repaired against the sections it was just given, not against the raw
    // JSON -- an index pointing past the end would put him on a column that
    // is not there.
    walkIndex: sanitiseCoachWalkIndex(loose.walkIndex, sections.length),
```

which means `sanitiseLoadedCoach` must hoist its sections into a local first:

```ts
  const phrase = sanitiseCoachPhrase(loose.phrase)
  const sections = sanitiseCoachSections(loose.sections, phrase?.bars ?? 1)
```

and then use `sections` in the returned object. Import `sanitiseCoachWalkIndex` from `./coachWalk`.

Add to `src/shared/coach.test.ts`:

```ts
it('starts with nobody being walked anywhere', () => {
  expect(startCoach(T0).walkIndex).toBeNull()
})

it('drops a walk position that names no section on load', () => {
  expect(sanitiseLoadedCoach({ stepId: 'p2-first', walkIndex: 4 })?.walkIndex).toBeNull()
})
```

- [ ] **Step 5: Write `coachWalk.ts`**

Create `src/shared/coachWalk.ts`:

```ts
/**
 * The section walk: where sssketchy is standing on the map, and the one
 * thought that goes with it.
 *
 * Replaces ./coachPhase2.ts, which walked the user through carving ONE
 * section at a time and placing it. That shape is gone: the map arrives
 * whole and pre-filled (spec, "The map arrives pre-filled, and says so"), so
 * there is nothing left to carve one at a time and nothing left to place.
 * What remains is the part Elling actually asked for -- "he walks the
 * sections with you, one at a time, highlighting that column and naming what
 * the section is FOR."
 *
 * TWO RULES:
 *
 * 1. **Leaving the walk keeps the map** (spec). endCoachWalk nulls one
 *    number and touches nothing else. There is no confirmation, no cleanup
 *    and nothing to lose, and that is why the offer to be walked is a
 *    gentle one rather than a commitment.
 * 2. **He states a GOAL, never a dictate** (spec, twice). Every line comes
 *    from COACH_SECTION_GOAL_LINES, keyed only by the section's TYPE -- so
 *    what he says is a statement about song structure, which is true
 *    regardless of what the user made. He has not heard the music and
 *    nothing here pretends otherwise.
 *
 * Time is injected (`now`), never read from the clock, exactly as ./coach.ts
 * requires of every transition in this layer.
 */

import { pauseCoach, type CoachState } from './coach'
import {
  COACH_LOOP_QUESTION_LINES,
  COACH_SECTION_GOAL_LINES,
  COACH_SHAPE_QUESTION_LINES,
  pickLineVariant
} from './coachLines'

/** An index off disk, checked against the sections it is supposed to name.
 * An index past the end would stand him on a column that is not there. */
export function sanitiseCoachWalkIndex(value: unknown, sectionCount: number): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null
  if (value < 0 || value >= sectionCount) return null
  return value
}

/**
 * Stands him on the first column.
 *
 * Refuses on an empty map rather than storing an index into nothing, and
 * moves the flow to the arrangement step so the checklist and the bubble
 * agree about where he is.
 */
export function startCoachWalk(state: CoachState, now: number): CoachState {
  if (state.sections.length === 0) return state
  const banked = pauseCoach(state, now)
  return {
    ...banked,
    stepId: 'p2-section',
    walkIndex: 0,
    stepElapsedMs: 0,
    runningSince: now,
    lineSeed: banked.lineSeed + 1
  }
}

/**
 * One step of the walk.
 *
 * Past the last section ENDS the walk rather than clamping, because "next"
 * on the last column has to mean something and stopping is the only honest
 * thing it can mean. Before the first clamps, because "back" from the start
 * is a mis-click, not a request to leave.
 */
export function walkCoachTo(state: CoachState, now: number, index: number): CoachState {
  if (state.walkIndex === null) return state
  if (index >= state.sections.length) return endCoachWalk(state, now)
  const next = Math.max(0, Math.round(index))
  if (next === state.walkIndex) return state
  const banked = pauseCoach(state, now)
  return {
    ...banked,
    walkIndex: next,
    stepElapsedMs: 0,
    runningSince: now,
    lineSeed: banked.lineSeed + 1
  }
}

/** Steps out. THE MAP IS UNTOUCHED -- see this module's own doc comment. */
export function endCoachWalk(state: CoachState, now: number): CoachState {
  if (state.walkIndex === null) return state
  const banked = pauseCoach(state, now)
  return { ...banked, walkIndex: null, runningSince: now, lineSeed: banked.lineSeed + 1 }
}

/**
 * The thought for the section he is standing on, or null when he is not
 * walking.
 *
 * The variant is picked on `lineSeed + walkIndex`, not on `lineSeed` alone,
 * so two sections of the same TYPE in one walk do not get the same sentence
 * about themselves -- a standard shape has two verses, two builds and two
 * drops, and hearing the same line twice is most of what makes a character
 * feel dead (./coachLines.ts).
 */
export function coachWalkLine(state: CoachState): string | null {
  if (state.status === 'finished' || state.walkIndex === null) return null
  const section = state.sections[state.walkIndex]
  if (section === undefined) return null
  const lines = COACH_SECTION_GOAL_LINES[section.type]
  if (lines === undefined || lines.length === 0) return null
  return pickLineVariant(lines, state.lineSeed + state.walkIndex)
}

/**
 * The opening question that has not been answered yet, or null.
 *
 * One thought at a time (spec): the setup screen shows both questions, but
 * he is only ever asking ONE of them -- whichever is still open. Once both
 * are answered he says nothing here, because the next thing worth saying is
 * the phrase report, which has its own line and may correctly be silent
 * (coachPhraseLine returns null when the measurement is inconclusive).
 */
export function coachSetupLine(state: CoachState): string | null {
  if (state.status === 'finished' || state.sections.length > 0) return null
  if (state.loopIs === null) return pickLineVariant(COACH_LOOP_QUESTION_LINES, state.lineSeed)
  if (state.shape === null) return pickLineVariant(COACH_SHAPE_QUESTION_LINES, state.lineSeed)
  return null
}
```

- [ ] **Step 6: Run and commit**

Run: `npx vitest run src/shared/coachWalk.test.ts src/shared/coach.test.ts`
Expected: PASS. `coachPhase2.test.ts` may go red here — Task 12 deletes it.

```bash
git add src/shared/coachWalk.ts src/shared/coachWalk.test.ts src/shared/coach.ts \
        src/shared/coach.test.ts
git commit -m "$(cat <<'EOF'
He stands on one column at a time, and stepping away costs nothing

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

### Task 5: A locked climax from confirmed roles

sssketchy's material used to come from Discover's slots. In the auto-arranger it comes from the stems already on the timeline, with roles the user just confirmed.

**Files:**
- Modify: `src/shared/discoverSlotKind.ts`
- Modify: `src/shared/discoverSlotKind.test.ts`
- Modify: `src/shared/coachClimax.ts`
- Modify: `src/shared/coachClimax.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/shared/discoverSlotKind.test.ts`:

```ts
describe('arrangeRoleToSlotKinds', () => {
  it('is the identity for the three mask roles', () => {
    expect(arrangeRoleToSlotKinds('drums')).toEqual(['drums'])
    expect(arrangeRoleToSlotKinds('bass')).toEqual(['bass'])
    expect(arrangeRoleToSlotKinds('lead')).toEqual(['lead'])
  })

  it('calls a backing part the harmony, which is what an intro loses', () => {
    expect(arrangeRoleToSlotKinds('backing')).toEqual(['lead', 'warm'])
  })

  it('never calls anything the hook -- the app cannot tell a hook apart', () => {
    for (const role of ARRANGE_ROLE_OPTIONS) {
      expect(kindsCoverSet(arrangeRoleToSlotKinds(role), ['lead', 'bright'])).toBe(false)
    }
  })

  it('gives the generic catch-all nothing, so it is never a suggested drop', () => {
    expect(arrangeRoleToSlotKinds('aux')).toEqual([])
  })
})
```

Add to `src/shared/coachClimax.test.ts`:

```ts
describe('lockClimaxFromArrangeRoles', () => {
  const stem = (path: string, barLength: number): CoachStemSnapshot => ({
    path,
    name: path,
    author: 'e',
    type: 'fx',
    durationSec: 4,
    barLength
  })

  it('keeps the role the user confirmed rather than re-deriving it', () => {
    const locked = lockClimaxFromArrangeRoles(
      [{ stem: stem('/pad.wav', 4), role: 'textureFx', gain: 0.8 }],
      120,
      0
    )
    expect(locked?.stems[0].role).toBe('textureFx')
    expect(locked?.stems[0].gain).toBe(0.8)
  })

  it('takes the LONGEST member bar length, like a placed discover rifff does', () => {
    const locked = lockClimaxFromArrangeRoles(
      [
        { stem: stem('/a.wav', 4), role: 'drums', gain: 1 },
        { stem: stem('/b.wav', 8), role: 'bass', gain: 1 }
      ],
      120,
      0
    )
    expect(locked?.barLength).toBe(8)
  })

  it('tags each stem with the kinds its role stands for', () => {
    const locked = lockClimaxFromArrangeRoles(
      [{ stem: stem('/kick.wav', 4), role: 'drums', gain: 1 }],
      120,
      0
    )
    expect(locked?.stems[0].kinds).toEqual(['drums'])
  })

  it('refuses an empty list rather than locking nothing', () => {
    expect(lockClimaxFromArrangeRoles([], 120, 0)).toBeNull()
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/shared/discoverSlotKind.test.ts src/shared/coachClimax.test.ts`
Expected: FAIL — neither function exists.

- [ ] **Step 3: Add the inverse table**

In `src/shared/discoverSlotKind.ts`, directly below `DISCOVER_SLOT_KIND_TO_ARRANGE_ROLE`:

```ts
/**
 * The other direction: the kinds an ArrangeRole stands for.
 *
 * Needed because the guided map can now be entered from the AUTO-ARRANGER,
 * where the material is stems already on the timeline with roles the user
 * confirmed by hand -- not Discover slots, which arrive already tagged.
 * Everything downstream of a locked climax keys off `kinds`
 * (isSuggestedDrop, coachMapTemplate), so a role has to be able to answer
 * for itself.
 *
 * NOT a strict inverse of the table above, and it cannot be: three roles
 * map to 'lead' there. It is its own deliberately conservative table, and
 * the conservatism is the point --
 *
 * - **Nothing here is ever the hook** (['lead', 'bright']). The app cannot
 *   tell a plain lead apart from the hook, and coachSections.ts already
 *   settles what to do about that: under-flagging costs the user one click,
 *   over-flagging is the app asserting something it has not earned. So a
 *   'lead' or a 'vocal' keeps its place in a build rather than being taken
 *   out of one on a guess.
 * - **'backing' is the harmony** (['lead', 'warm']), which is exactly the
 *   pair phase one used to arm for the harmony step -- and it is what
 *   an intro and an outro drop, which is right.
 * - **'aux' gets nothing**, so kindsCoverSet can never match it and a
 *   generic part is never a suggested drop anywhere.
 */
export const ARRANGE_ROLE_SLOT_KINDS: Record<ArrangeRole, readonly DiscoverSlotKind[]> = {
  drums: ['drums'],
  bass: ['bass'],
  lead: ['lead'],
  backing: ['lead', 'warm'],
  aux: [],
  textureFx: ['warm'],
  fill: ['rhythmic'],
  vocal: ['lead']
}

export function arrangeRoleToSlotKinds(role: ArrangeRole): readonly DiscoverSlotKind[] {
  return ARRANGE_ROLE_SLOT_KINDS[role]
}
```

- [ ] **Step 4: Add the constructor**

In `src/shared/coachClimax.ts`, below `lockClimaxFromSlots`:

```ts
/** One stem on its way into a locked climax, as the auto-arranger's own
 * role step knows it. */
export interface CoachClimaxStemInput {
  stem: CoachStemSnapshot
  /** The role the USER confirmed in AutoArrangeRoleStep -- kept verbatim,
   * never re-derived from the kinds below. */
  role: ArrangeRole
  /** 0-1, the stem's own committed gain off state.vol. */
  gain: number
}

/**
 * A locked climax built from the auto-arranger's confirmed roles rather than
 * from Discover's slots.
 *
 * The two constructors differ in which field is authoritative, and it
 * matters: lockClimaxFromSlots DERIVES the role from the kinds Discover
 * tagged, because there the kinds are the real signal. Here the ROLE is the
 * real signal -- a person just chose it from a dropdown -- and the kinds are
 * derived from it (ARRANGE_ROLE_SLOT_KINDS). Deriving the role back out of
 * those kinds would squash 'backing', 'textureFx', 'fill' and 'vocal' into
 * 'lead' or 'aux' and throw away the one piece of information the user gave
 * by hand.
 *
 * barLength is the longest member's, the same rule the other constructor and
 * assembleDiscoverRifff both use, so a section built from this tiles exactly
 * as the source material did.
 */
export function lockClimaxFromArrangeRoles(
  stems: readonly CoachClimaxStemInput[],
  bpm: number,
  now: number
): LockedClimax | null {
  if (stems.length === 0) return null
  const locked: LockedClimaxStem[] = stems.map((entry) => ({
    ...entry.stem,
    kinds: [...arrangeRoleToSlotKinds(entry.role)],
    role: entry.role,
    gain: clampGain(entry.gain)
  }))
  const barLength = Math.max(...locked.map((stem) => (stem.barLength > 0 ? stem.barLength : 1)))
  return { bpm, barLength, stems: locked, lockedAt: now }
}
```

Extend the `./discoverSlotKind` import with `arrangeRoleToSlotKinds`.

- [ ] **Step 5: Run and commit**

Run: `npx vitest run src/shared/discoverSlotKind.test.ts src/shared/coachClimax.test.ts`
Expected: PASS.

```bash
git add src/shared/discoverSlotKind.ts src/shared/discoverSlotKind.test.ts \
        src/shared/coachClimax.ts src/shared/coachClimax.test.ts
git commit -m "$(cat <<'EOF'
The roles you just confirmed are the material he carves from

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

### Task 6: Rows, and the actions that build them

The renderer's half of the round trip: turning `AppState` into map rows, and turning a plan into real clip actions.

**Files:**
- Create: `src/renderer/src/state/coachMapRows.ts`
- Create: `src/renderer/src/state/coachMapRows.test.ts`
- Create: `src/renderer/src/state/coachMapPlacement.ts`
- Create: `src/renderer/src/state/coachMapPlacement.test.ts`
- Delete: `src/renderer/src/state/coachSectionPlacement.ts`
- Delete: `src/renderer/src/state/coachSectionPlacement.test.ts`

- [ ] **Step 1: Re-read `coachSectionPlacement.ts` before replacing it**

Foundations Task 10 rewrote it to place one clip per run. Read it fresh — `assembleDiscoverRifff`'s call shape, `stemFromClimax`, and the `vol` record are all being carried over verbatim and the details will have moved.

```bash
sed -n '1,200p' src/renderer/src/state/coachSectionPlacement.ts
grep -n "export" src/renderer/src/state/selectors.ts | grep -i "resolvePlayedBars\|placedTimelineSpanBars\|channelsInOrder"
```

- [ ] **Step 2: Write the failing test for the rows**

Create `src/renderer/src/state/coachMapRows.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createRiser } from '@shared/riser'
import type { Rifff } from '@shared/types'
import { initialState, type AppState } from './store'
import { coachMapRows } from './coachMapRows'

function rifff(groupId: string, path: string, startBar: number): Rifff {
  return {
    groupId,
    name: path,
    bpm: 120,
    barLength: 4,
    folderPath: '/x',
    startBar,
    stems: [
      { slot: 1, author: 'e', name: path, type: 'drums', path, durationSec: 4, barLength: 4 }
    ]
  }
}

function stateWith(rifffs: Rifff[], extra: Partial<AppState> = {}): AppState {
  return {
    ...initialState,
    rifffs: Object.fromEntries(rifffs.map((r) => [r.groupId, r])),
    channelOf: Object.fromEntries(rifffs.map((r) => [r.groupId, r.groupId])),
    channelOrder: rifffs.map((r) => r.groupId),
    ...extra
  }
}

describe('coachMapRows', () => {
  it('produces one row per arranger channel, in the arranger own order', () => {
    const state = stateWith([rifff('a', '/kick.wav', 0), rifff('b', '/bass.wav', 0)])
    expect(coachMapRows(state).map((row) => row.channelId)).toEqual(['a', 'b'])
  })

  it('measures a clip from its cropped start to its played end', () => {
    const state = stateWith([rifff('a', '/kick.wav', 8)], {
      playedBars: { a: 16 },
      leftCrop: { a: 2 }
    })
    expect(coachMapRows(state)[0].clips).toEqual([{ groupId: 'a', startBar: 10, endBar: 24 }])
  })

  it('falls back to the rifff own bar length when nothing set playedBars', () => {
    const state = stateWith([rifff('a', '/kick.wav', 0)])
    expect(coachMapRows(state)[0].clips[0].endBar).toBe(4)
  })

  it('leaves an unplaced rifff out entirely', () => {
    const shelf = { ...rifff('a', '/kick.wav', 0), startBar: undefined }
    const state = { ...initialState, rifffs: { a: shelf } }
    expect(coachMapRows(state)).toEqual([])
  })

  it('reads a riser row as a riser, with its own name and no sound type', () => {
    const riser = createRiser({ id: 'r1', channelId: 'chan-r', startBar: 12 })
    const state = { ...initialState, risers: { r1: { ...riser, name: 'lift' } } }
    const rows = coachMapRows(state)
    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('riser')
    expect(rows[0].label).toBe('lift')
    expect(rows[0].soundType).toBeNull()
    expect(rows[0].path).toBeNull()
    expect(rows[0].clips[0].startBar).toBe(12)
  })

  it('names a row the map laid out by the stem it was laid out for', () => {
    const state = stateWith([rifff('a', '/kick.wav', 0)], {
      coach: {
        ...initialState.coach!,
        sections: [
          {
            id: 's1',
            type: 'drop' as const,
            name: 'drop',
            passes: 1,
            cells: {},
            startBar: 0,
            placedGroupIds: { '/kick.wav': 'a' }
          }
        ]
      }
    })
    const row = coachMapRows(state)[0]
    expect(row.kind).toBe('stem')
    expect(row.path).toBe('/kick.wav')
  })

  it('calls a row the map did NOT lay out other, so nothing pretends to own it', () => {
    const state = stateWith([rifff('a', '/kick.wav', 0)])
    expect(coachMapRows(state)[0].kind).toBe('other')
    expect(coachMapRows(state)[0].path).toBeNull()
  })
})
```

`initialState.coach` is `null`; the test above needs a real flow, so build one with `startCoach(0)` rather than spreading `initialState.coach!`. Fix that line when you write the test for real — it is called out here so you do not copy a null-assertion into the suite.

- [ ] **Step 3: Write `coachMapRows.ts`**

Create `src/renderer/src/state/coachMapRows.ts`:

```ts
import { risersOnChannel, riserEndBar } from '@shared/riser'
import { sectionLaneChannelIds } from '@shared/coachSections'
import type { MapClip } from '@shared/coachMapEdit'
import type { SoundType } from '@shared/types'
import { channelsInOrder, resolvePlayedBars } from './selectors'
import type { AppState } from './store'

/**
 * The arranger's rows, as the map needs to see them.
 *
 * A PLAIN FUNCTION over AppState, not a hook, deliberately:
 * usePlacedFlatStems.ts's own doc comment records the same choice being
 * forced once already ("it needs to be a plain function testable directly
 * against an AppState in selectors.test.ts without React"). The map's read
 * path is the riskiest thing in this feature and it has to be testable
 * without mounting anything.
 *
 * Rows come from channelsInOrder(state), which is what the arranger itself
 * draws -- "rows are the arranger's own channel rows" (spec). Three kinds,
 * and the difference is only about what the map may DO to them:
 *
 * - **stem** -- a row the guided map laid out, so the map knows which stem
 *   belongs on it and can put one back. Toggleable.
 * - **riser** -- a row whose content is a riser. READ-ONLY, and monochrome:
 *   a riser has no SoundType and RiserBlock.tsx is explicit that it "must
 *   not be given one just to have a hue". Toggling one on would mean
 *   INVENTING a riser, which is the spec's own named bad line ("add a riser
 *   at bar 48"). Risers arrive at the joins, in the tension pass, on a
 *   click.
 * - **other** -- clips the map did not lay out. Shown, because the map
 *   showing the whole song at once is what makes the pre-fill legitimate,
 *   but read-only: there is no stem the map could honestly put back.
 */
export type CoachMapRowKind = 'stem' | 'riser' | 'other'

export interface CoachMapRow {
  channelId: string
  kind: CoachMapRowKind
  /** The row's own label -- the stem's name, the riser's name, or the first
   * clip's name. */
  label: string
  /** The climax stem this row was laid out for. null for riser and other
   * rows, which is exactly what makes them read-only. */
  path: string | null
  /** For the one legitimate colour on the map (typeColorVar). null for a
   * riser, which has no sound type and must not be given one. */
  soundType: SoundType | null
  /** Every piece of material on this row, as bar windows. leftCrop is
   * already applied to startBar; mute and muteRegions deliberately are not
   * (see coachMapRead.ts's module doc). */
  clips: MapClip[]
}

export function coachMapRows(state: AppState): CoachMapRow[] {
  const lanes = sectionLaneChannelIds(state.coach?.sections ?? [])
  const pathByChannel: Record<string, string> = {}
  for (const [path, channelId] of Object.entries(lanes)) pathByChannel[channelId] = path

  return channelsInOrder(state).map((channel): CoachMapRow => {
    const channelRisers = risersOnChannel(state.risers, channel.channelId)
    const clips: MapClip[] = channel.rifffs
      .filter((rifff) => rifff.startBar !== undefined)
      .map((rifff): MapClip => {
        const startBar = (rifff.startBar ?? 0) + (state.leftCrop[rifff.groupId] ?? 0)
        return {
          groupId: rifff.groupId,
          startBar,
          endBar: (rifff.startBar ?? 0) + resolvePlayedBars(state, rifff.groupId)
        }
      })
    for (const riser of channelRisers) {
      clips.push({ groupId: riser.id, startBar: riser.startBar, endBar: riserEndBar(riser) })
    }

    const path = pathByChannel[channel.channelId]
    if (path !== undefined) {
      const stem = channel.rifffs[0]?.stems.find((s) => s.path === path) ?? channel.rifffs[0]?.stems[0]
      return {
        channelId: channel.channelId,
        kind: 'stem',
        label: stem?.name ?? path,
        path,
        soundType: stem?.type ?? null,
        clips
      }
    }
    if (channel.rifffs.length === 0 && channelRisers.length > 0) {
      return {
        channelId: channel.channelId,
        kind: 'riser',
        label: channelRisers[0].name,
        path: null,
        soundType: null,
        clips
      }
    }
    return {
      channelId: channel.channelId,
      kind: 'other',
      label: channel.rifffs[0]?.name ?? channel.channelId,
      path: null,
      soundType: channel.rifffs[0]?.stems[0]?.type ?? null,
      clips
    }
  })
}
```

- [ ] **Step 4: Write the failing test for the placement builder**

Create `src/renderer/src/state/coachMapPlacement.test.ts`. Build a small `LockedClimax` (kick, bass, hook) with `lockClimaxFromArrangeRoles`, a `short` map with `buildCoachMapSections`, and assert:

```ts
describe('buildCoachMapActions', () => {
  it('places every section at its OWN start bar, not one after another', () => {
    const built = buildCoachMapActions(state, coach, sections)
    const bars = built.actions
      .filter((a) => a.type === 'PLACE_LOOP_ON_TIMELINE')
      .map((a) => (a as { startBar: number }).startBar)
    expect(bars).toContain(sections[0].startBar)
    expect(bars).toContain(sections[1].startBar)
  })

  it('creates the lanes in MAP ROW ORDER, so the arranger rows match the map', () => {
    // Rows outer, sections inner -- see Finding 6. The first clip placed for
    // each stem is the one that makes its lane, and channelOrder takes them
    // in the order they are placed. So: walk the placements in order, resolve
    // each groupId back to the path it was placed for, and keep the first
    // sighting of each path. That sequence must be the map's row order.
    const built = buildCoachMapActions(state, coach, sections)
    const pathByGroupId: Record<string, string> = {}
    for (const perSection of Object.values(built.placedGroupIds)) {
      for (const [path, groupId] of Object.entries(perSection)) pathByGroupId[groupId] = path
    }
    const firstSighting: string[] = []
    for (const action of built.actions) {
      if (action.type !== 'PLACE_LOOP_ON_TIMELINE') continue
      for (const rifff of action.stems) {
        const path = pathByGroupId[rifff.groupId] ?? rifff.stems[0]?.path
        if (path !== undefined && !firstSighting.includes(path)) firstSighting.push(path)
      }
    }
    expect(firstSighting).toEqual(coachMapRowOrder(climax).map((stem) => stem.path))
  })

  it('gives one stem ONE row for the whole song', () => {
    const built = buildCoachMapActions(state, coach, sections)
    const lanes = new Set(
      built.actions
        .filter((a) => a.type === 'MOVE_TO_CHANNEL')
        .map((a) => (a as { channelId: string }).channelId)
    )
    for (const channelId of lanes) {
      expect(Object.values(built.placedGroupIds).some((m) => Object.values(m).includes(channelId)))
        .toBe(true)
    }
  })

  it('sets each clip length from its RUN, not from its section', () => {
    // A stem that plays 2 of a 4-pass section gets a 2-pass clip.
    const built = buildCoachMapActions(state, coach, sections)
    const resizes = built.actions.filter((a) => a.type === 'SET_PLAYED_BARS')
    expect(resizes.length).toBeGreaterThan(0)
    for (const resize of resizes) {
      expect((resize as { bars: number }).bars % PHRASE_BARS).toBe(0)
    }
  })

  it('records a groupId per path per SECTION ID, for the round trip to read', () => {
    const built = buildCoachMapActions(state, coach, sections)
    expect(Object.keys(built.placedGroupIds)).toEqual(sections.map((s) => s.id))
  })

  it('deletes the material it replaced, AFTER placing -- never before', () => {
    const built = buildCoachMapActions(state, coach, sections)
    const deleteIndex = built.actions.findIndex((a) => a.type === 'DELETE_RIFFFS')
    const lastPlace = built.actions.map((a) => a.type).lastIndexOf('PLACE_LOOP_ON_TIMELINE')
    expect(deleteIndex).toBeGreaterThan(lastPlace)
  })

  it('places nothing at all when the climax is empty', () => {
    expect(buildCoachMapActions(state, { ...coach, lockedClimax: null }, sections).actions)
      .toEqual([])
  })
})

describe('buildCellToggleActions', () => {
  it('turns a plan into a delete plus one placement per run', () => {
    const actions = buildCellToggleActions(state, row, section, plan, climax, PHRASE_BARS)
    expect(actions.filter((a) => a.type === 'DELETE_RIFFFS')).toHaveLength(1)
    expect(actions.filter((a) => a.type === 'PLACE_LOOP_ON_TIMELINE')).toHaveLength(
      plan.addRuns.length
    )
  })

  it('puts every new clip on the row own channel', () => {
    const actions = buildCellToggleActions(state, row, section, plan, climax, PHRASE_BARS)
    for (const move of actions.filter((a) => a.type === 'MOVE_TO_CHANNEL')) {
      expect((move as { channelId: string }).channelId).toBe(row.channelId)
    }
  })

  it('does nothing at all for a blocked plan', () => {
    const blocked = { removeGroupIds: [], addRuns: [], blockedGroupIds: ['x'] }
    expect(buildCellToggleActions(state, row, section, blocked, climax, PHRASE_BARS)).toEqual([])
  })
})
```

Build the fixtures at the top of the file with the real constructors, so nothing above is hand-waved:

```ts
const PHRASE_BARS = 4

function stemSnapshot(path: string): CoachStemSnapshot {
  return { path, name: path, author: 'e', type: 'fx', durationSec: 4, barLength: 4 }
}

const climax = lockClimaxFromArrangeRoles(
  [
    { stem: stemSnapshot('/kick.wav'), role: 'drums', gain: 1 },
    { stem: stemSnapshot('/bass.wav'), role: 'bass', gain: 1 },
    { stem: stemSnapshot('/hook.wav'), role: 'lead', gain: 1 }
  ],
  120,
  0
)!

const sections = buildCoachMapSections({
  shape: 'short',
  loopIs: 'drop',
  phraseBars: PHRASE_BARS,
  climax,
  firstStartBar: 0
})

const coach = {
  ...startCoach(0),
  lockedClimax: climax,
  loopIs: 'drop' as const,
  shape: 'short' as const,
  phrase: { bars: PHRASE_BARS, source: 'nominal' as const },
  sections
}

const state: AppState = { ...initialState, bpm: 120, coach }
```

`row`, `section` and `plan` for the `buildCellToggleActions` block are `coachMapRows(afterBuild)[0]`, `sections[1]`, and a `planCellToggle` over that row — apply `built.actions` to `initialState` through `reducer` to get `afterBuild`, which is also the cheapest way to check the build really produces a readable map.

- [ ] **Step 5: Write `coachMapPlacement.ts`**

Create `src/renderer/src/state/coachMapPlacement.ts`. It replaces `coachSectionPlacement.ts` wholesale; carry `stemFromClimax` and the `assembleDiscoverRifff` call over verbatim from it.

```ts
import { assembleDiscoverRifff } from './discoverRifffAssembly'
import { cellRuns, type CoachCellRun } from '@shared/coachCells'
import { sectionBars } from '@shared/coachPasses'
import { COACH_LOOP_HOME_TYPE } from '@shared/coachShapes'
import { coachMapRowOrder, templateFallbackFor } from '@shared/coachMapTemplate'
import type { CoachMapRowPlan } from '@shared/coachMapEdit'
import type { CoachSection } from '@shared/coachSections'
import type { CoachState } from '@shared/coach'
import type { LockedClimax, LockedClimaxStem } from '@shared/coachClimax'
import type { Rifff, Stem } from '@shared/types'
import type { CoachMapRow } from './coachMapRows'
import type { Action, AppState } from './store'

/**
 * Turning the map into real clips, and one cell edit into real clip actions.
 *
 * Replaces coachSectionPlacement.ts, whose whole shape assumed sections
 * arriving one at a time and being appended after whatever was already down.
 * The map arrives WHOLE, and the auto-arranger it is entered from REPLACES
 * the material it read -- so sections are placed at their own start bars,
 * from bar zero, and the source clips are deleted afterwards.
 *
 * TWO ORDERING RULES, both load-bearing:
 *
 * 1. **Rows outer, sections inner.** PLACE_LOOP_ON_TIMELINE pushes each
 *    fresh groupId onto channelOrder as it places it, so the order lanes are
 *    CREATED in is the order the arranger draws its rows in. Placing
 *    section-by-section would order the rows by which section a stem first
 *    appears in, and the map would disagree with the timeline behind it on
 *    the very first screen. Iterating rows first makes the two agree by
 *    construction -- and coachMapRows.ts reads channelsInOrder, so there is
 *    nothing to keep in sync.
 * 2. **Place, then delete.** buildArrangeReplaceActions already does this,
 *    and the reason is placeOnTimeline's own quirk: the FIRST placement on
 *    an empty timeline adopts the rifff's bpm as the project's. Deleting
 *    first would empty the timeline and hand the project's tempo to whatever
 *    clip happened to land next.
 *
 * PLACE_LOOP_ON_TIMELINE carries ONE startBar for the whole call, so one
 * call per (row, bar). They all go out in one BATCH and history.ts
 * checkpoints a BATCH exactly once, so the whole map is one undo step --
 * which is what lets sssketchy say "cmd+z puts everything back on".
 */

export interface CoachMapPlacement {
  actions: Action[]
  /** section id -> (climax stem path -> the groupId it was placed as). The
   * FIRST groupId per path per section, which is the one that owns the
   * lane -- sectionLaneChannelIds keeps the first, not the newest. */
  placedGroupIds: Record<string, Record<string, string>>
}

function stemFromClimax(stem: LockedClimaxStem): Omit<Stem, 'slot'> {
  return {
    author: stem.author,
    name: stem.name,
    type: stem.type,
    path: stem.path,
    durationSec: stem.durationSec,
    barLength: stem.barLength
  }
}

/** One run of one stem, as a placed clip plus the actions that shape it. */
function placeRun(
  state: AppState,
  stem: LockedClimaxStem,
  label: string,
  startBar: number,
  barCount: number,
  lane: string | null
): { rifff: Rifff; vol: Record<string, number>; after: Action[] } | null {
  const assembly = assembleDiscoverRifff(
    `${label} · ${stem.name}`,
    [{ stem: stemFromClimax(stem), gain: stem.gain }],
    state.bpm
  )
  if (assembly === null) return null
  const groupId = assembly.rifff.groupId
  const after: Action[] = []
  // The first clip for a stem keeps PLACE_LOOP_ON_TIMELINE's own fresh lane
  // (channelOf[groupId] = groupId); every later one is moved onto it, so a
  // stem that leaves and comes back stays one row rather than opening a
  // staircase.
  if (lane !== null && lane !== groupId) {
    after.push({ type: 'MOVE_TO_CHANNEL', groupId, startBar, channelId: lane })
  }
  after.push({ type: 'SET_PLAYED_BARS', key: groupId, bars: barCount })
  return { rifff: assembly.rifff, vol: assembly.vol, after }
}

/** Every section of the map, as one batch of ordinary clip actions. */
export function buildCoachMapActions(
  state: AppState,
  coach: CoachState,
  sections: readonly CoachSection[]
): CoachMapPlacement {
  const climax = coach.lockedClimax
  const phraseBars = coach.phrase?.bars ?? climax?.barLength ?? 1
  const empty: CoachMapPlacement = { actions: [], placedGroupIds: {} }
  if (climax === null || coach.loopIs === null || sections.length === 0) return empty

  const homeType = COACH_LOOP_HOME_TYPE[coach.loopIs]
  const rows = coachMapRowOrder(climax)
  const placedGroupIds: CoachMapPlacement['placedGroupIds'] = {}
  for (const section of sections) placedGroupIds[section.id] = {}

  const actions: Action[] = []
  const lanes: Record<string, string> = {}

  for (const stem of rows) {
    for (const section of sections) {
      const fallback = templateFallbackFor(section, homeType, climax)
      const runs: CoachCellRun[] = cellRuns(section.cells, section.passes, stem.path, (passIndex) =>
        fallback(stem, passIndex)
      )
      for (const run of runs) {
        const startBar = section.startBar + sectionBars(run.startPass, phraseBars)
        const placed = placeRun(
          state,
          stem,
          section.name,
          startBar,
          sectionBars(run.passCount, phraseBars),
          lanes[stem.path] ?? null
        )
        if (placed === null) continue
        if (lanes[stem.path] === undefined) lanes[stem.path] = placed.rifff.groupId
        if (placedGroupIds[section.id][stem.path] === undefined) {
          placedGroupIds[section.id][stem.path] = placed.rifff.groupId
        }
        actions.push({
          type: 'PLACE_LOOP_ON_TIMELINE',
          stems: [placed.rifff],
          startBar,
          vol: placed.vol
        })
        actions.push(...placed.after)
      }
    }
  }
  if (actions.length === 0) return empty

  // Last, never first -- see this module's own doc comment.
  const sourceGroupIds = Object.values(state.rifffs)
    .filter((rifff) => rifff.startBar !== undefined)
    .map((rifff) => rifff.groupId)
  if (sourceGroupIds.length > 0) actions.push({ type: 'DELETE_RIFFFS', groupIds: sourceGroupIds })

  return { actions, placedGroupIds }
}

/**
 * One cell toggle, as real clip actions.
 *
 * A refusal (blockedGroupIds) produces NOTHING -- the map says why in the
 * cell's own tooltip rather than doing something approximate. See
 * coachMapEdit.ts's own rule 2.
 */
export function buildCellToggleActions(
  state: AppState,
  row: CoachMapRow,
  section: CoachSection,
  plan: CoachMapRowPlan,
  climax: LockedClimax,
  phraseBars: number
): Action[] {
  if (plan.blockedGroupIds.length > 0) return []
  if (row.path === null) return []
  const stem = climax.stems.find((candidate) => candidate.path === row.path)
  if (stem === undefined) return []

  const actions: Action[] = []
  for (const run of plan.addRuns) {
    const startBar = section.startBar + sectionBars(run.startPass, phraseBars)
    const placed = placeRun(
      state,
      stem,
      section.name,
      startBar,
      sectionBars(run.passCount, phraseBars),
      row.channelId
    )
    if (placed === null) continue
    actions.push({
      type: 'PLACE_LOOP_ON_TIMELINE',
      stems: [placed.rifff],
      startBar,
      vol: placed.vol
    })
    actions.push(...placed.after)
  }
  // After the placements, for the same reason the build deletes last.
  if (plan.removeGroupIds.length > 0) {
    actions.push({ type: 'DELETE_RIFFFS', groupIds: [...plan.removeGroupIds] })
  }
  return actions
}
```

- [ ] **Step 6: Delete the old placement module**

```bash
git rm src/renderer/src/state/coachSectionPlacement.ts \
       src/renderer/src/state/coachSectionPlacement.test.ts
grep -rn "coachSectionPlacement\|buildCoachSectionActions" src
```
Expected after Task 12: no hits. Until then `SssketchySectionPanel.tsx` still imports it — that is fine and Task 12 removes it; if you are running tasks strictly in order, leave the panel's import broken and note it, or do Task 12 first.

- [ ] **Step 7: Run and commit**

Run: `npx vitest run src/renderer/src/state/coachMapRows.test.ts src/renderer/src/state/coachMapPlacement.test.ts`
Expected: PASS.

```bash
git add -A src/renderer/src/state
git commit -m "$(cat <<'EOF'
Rows in the order the map draws them, clips in the order they sound

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

### Task 7: The store — the view, the walk and the placement record

**Files:**
- Modify: `src/renderer/src/state/store.ts`
- Modify: `src/renderer/src/state/store.test.ts`
- Modify: `src/renderer/src/state/history.ts`
- Modify: `src/renderer/src/state/history.test.ts`
- Modify: `src/renderer/src/state/serialize.ts`
- Modify: `src/renderer/src/state/serialize.test.ts`

- [ ] **Step 1: Re-read `store.ts`'s coach action block and `history.ts`** — foundations added five coach actions and reshaped `TRANSIENT_ACTION_TYPES`.

- [ ] **Step 2: Write the failing tests**

Add to `src/renderer/src/state/store.test.ts`:

```ts
describe('the map view', () => {
  it('starts on the timeline', () => {
    expect(initialState.mapView).toBe(false)
  })

  it('switches to the map and back', () => {
    const on = reducer(initialState, { type: 'SET_MAP_VIEW', on: true })
    expect(on.mapView).toBe(true)
    expect(reducer(on, { type: 'SET_MAP_VIEW', on: false }).mapView).toBe(false)
  })
})

describe('the map placement record', () => {
  it('writes each section own placed group ids by section id', () => {
    const coach = {
      ...startCoach(T0),
      sections: [{ id: 's1', type: 'drop' as const, name: 'drop', passes: 1, cells: {},
        startBar: 0, placedGroupIds: {} }]
    }
    const next = reducer({ ...initialState, coach }, {
      type: 'COACH_RECORD_MAP_PLACEMENT',
      placedGroupIds: { s1: { '/kick.wav': 'g1' } }
    })
    expect(next.coach?.sections[0].placedGroupIds).toEqual({ '/kick.wav': 'g1' })
  })

  it('ignores a section id the flow does not have', () => {
    const coach = { ...startCoach(T0), sections: [] }
    const next = reducer({ ...initialState, coach }, {
      type: 'COACH_RECORD_MAP_PLACEMENT',
      placedGroupIds: { nope: { '/kick.wav': 'g1' } }
    })
    expect(next.coach?.sections).toEqual([])
  })
})

describe('the walk actions', () => {
  const withMap = {
    ...startCoach(T0),
    sections: [
      { id: 'a', type: 'intro' as const, name: 'intro', passes: 1, cells: {}, startBar: 0,
        placedGroupIds: {} },
      { id: 'b', type: 'drop' as const, name: 'drop', passes: 1, cells: {}, startBar: 4,
        placedGroupIds: {} }
    ]
  }

  it('starts him on the first column', () => {
    const next = reducer({ ...initialState, coach: withMap }, { type: 'COACH_START_WALK', now: T0 })
    expect(next.coach?.walkIndex).toBe(0)
  })

  it('steps along', () => {
    const started = reducer({ ...initialState, coach: withMap }, { type: 'COACH_START_WALK', now: T0 })
    expect(reducer(started, { type: 'COACH_WALK_TO', now: T0 + 1, index: 1 }).coach?.walkIndex).toBe(1)
  })

  it('LEAVES THE MAP ALONE when he steps out', () => {
    const started = reducer({ ...initialState, coach: withMap }, { type: 'COACH_START_WALK', now: T0 })
    const left = reducer(started, { type: 'COACH_END_WALK', now: T0 + 1 })
    expect(left.coach?.walkIndex).toBeNull()
    expect(left.coach?.sections).toEqual(withMap.sections)
  })
})
```

Add to `src/renderer/src/state/history.test.ts`:

```ts
it('pins the walk position across undo -- an undo must not end the walk', () => {
  const withMap = {
    ...startCoach(T0),
    sections: [{ id: 'a', type: 'drop' as const, name: 'drop', passes: 1, cells: {},
      startBar: 0, placedGroupIds: {} }]
  }
  let history = createHistoryState({ ...initialState, coach: withMap })
  history = historyReducer(history, { type: 'SET_BPM', bpm: 100 })
  history = historyReducer(history, { type: 'COACH_START_WALK', now: T0 })
  history = historyReducer(history, { type: 'SET_BPM', bpm: 120 })
  history = historyReducer(history, { type: 'UNDO' })

  expect(history.present.bpm).toBe(100)
  expect(history.present.coach?.walkIndex).toBe(0)
})

it('never makes a view toggle an undo step', () => {
  let history = createHistoryState(initialState)
  history = historyReducer(history, { type: 'SET_BPM', bpm: 100 })
  const depth = history.past.length
  history = historyReducer(history, { type: 'SET_MAP_VIEW', on: true })
  expect(history.past.length).toBe(depth)
})
```

Add to `src/renderer/src/state/serialize.test.ts`:

```ts
it('never writes the map view to disk -- it is a view, not a project', () => {
  const json = serializeProject({ ...baseState, mapView: true })
  expect(JSON.parse(json).mapView).toBeUndefined()
})

it('brings a walk position back off disk, repaired against the sections', () => {
  const { state } = deserializeProject(
    JSON.stringify({
      ...baseProject,
      coach: { stepId: 'p2-section', walkIndex: 1, sections: [] }
    })
  )
  expect(state.coach?.walkIndex).toBeNull()
})
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run src/renderer/src/state`
Expected: FAIL on the new cases.

- [ ] **Step 4: Add `mapView` and the actions**

In `src/renderer/src/state/store.ts`:

On `AppState`, next to `mode`:

```ts
  /**
   * Whether the arranger is showing the MAP rather than the timeline.
   *
   * Deliberately NOT a fourth ArrangerMode. `mode` is about how clips are
   * drawn and edited, is cycled by Tab, and gates on isSketchEligible; the
   * map is a different VIEW of the same arrangement, with the same clips
   * underneath and the same edits reaching them. Folding it into `mode`
   * would put "which view am I in" and "how do clips behave" behind one
   * three-way cycle that already has two meanings.
   *
   * Like `mode`: not persisted (serialize.ts drops it) and not undoable
   * (history.ts lists SET_MAP_VIEW transient). A view toggle is not an edit.
   */
  mapView: boolean
```

`initialState` gets `mapView: false`.

In the `Action` union, next to the coach actions:

```ts
  | { type: 'SET_MAP_VIEW'; on: boolean }
  /** What the map REALLY placed, recorded right after the clips go down and
   * inside the same BATCH -- the same "record what happened rather than
   * recompute it" rule COACH_PLACE_SECTION followed. Keyed by section id
   * (not index) so a later reorder cannot shift a section's lanes onto its
   * neighbour. */
  | { type: 'COACH_RECORD_MAP_PLACEMENT'; placedGroupIds: Record<string, Record<string, string>> }
  | { type: 'COACH_START_WALK'; now: number }
  | { type: 'COACH_WALK_TO'; now: number; index: number }
  | { type: 'COACH_END_WALK'; now: number }
```

and the reducer cases, each guarding `state.coach === null` exactly as its neighbours do:

```ts
    case 'SET_MAP_VIEW':
      return state.mapView === action.on ? state : { ...state, mapView: action.on }

    case 'COACH_RECORD_MAP_PLACEMENT': {
      if (state.coach === null) return state
      return {
        ...state,
        coach: {
          ...state.coach,
          sections: state.coach.sections.map((section) => {
            const placed = action.placedGroupIds[section.id]
            return placed === undefined ? section : { ...section, placedGroupIds: placed }
          })
        }
      }
    }

    case 'COACH_START_WALK':
      return state.coach === null
        ? state
        : { ...state, coach: startCoachWalk(state.coach, action.now) }

    case 'COACH_WALK_TO':
      return state.coach === null
        ? state
        : { ...state, coach: walkCoachTo(state.coach, action.now, action.index) }

    case 'COACH_END_WALK':
      return state.coach === null
        ? state
        : { ...state, coach: endCoachWalk(state.coach, action.now) }
```

Delete the draft-section actions and their cases (`COACH_START_SECTION`, `COACH_SET_SECTION_NAME`, `COACH_NUDGE_SECTION_PASSES`, `COACH_TOGGLE_SECTION_STEM`, `COACH_TOGGLE_SECTION_CELL`, `COACH_PLACE_SECTION`) together with the `@shared/coachPhase2` import — Task 12 removes their last callers, and leaving dead reducer cases behind is how a later agent rebuilds a surface that was deliberately retired.

- [ ] **Step 5: `history.ts`**

Add to `TRANSIENT_ACTION_TYPES`, replacing the six deleted coach entries:

```ts
  // The map's own view toggle and walk (2026-09-23). Same category as every
  // other COACH_* entry: where sssketchy is and which view is showing, not
  // an edit to the project. COACH_RECORD_MAP_PLACEMENT is here for the same
  // reason COACH_PLACE_SECTION was -- in real use it arrives inside the
  // BATCH that also places the clips, and a stray direct dispatch should
  // push no checkpoint of its own.
  'SET_MAP_VIEW',
  'COACH_RECORD_MAP_PLACEMENT',
  'COACH_START_WALK',
  'COACH_WALK_TO',
  'COACH_END_WALK',
```

Extend the `pinnedCoach` comment:

```ts
    // walkIndex rides along on the PINNED side by construction, and that is
    // right: it is WHERE SSSKETCHY IS STANDING, not timeline material.
    // Undoing a clip edit in the middle of the walk -- which is the single
    // likeliest moment for an undo to happen -- must not also throw the user
    // out of the walk. `sections` stays on the snapshot side as before.
```

- [ ] **Step 6: `serialize.ts`**

Add `mapView` to the rest-destructure of transient fields in `serializeProject`, next to `mode`. If `mode` is handled by an explicit omit list rather than a destructure, add it there instead — read the function first.

- [ ] **Step 7: Run and commit**

Run: `npx vitest run src/renderer/src/state && npm run typecheck`
Expected: the state suite PASSes; typecheck will still fail on `SssketchySectionPanel.tsx` until Task 12. Note that and move on.

```bash
git add src/renderer/src/state
git commit -m "$(cat <<'EOF'
A view is not an edit, and a walk is not material

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

### Task 8: The map itself

The grid. **No component tests** (Finding 13).

**Files:**
- Create: `src/renderer/src/components/ArrangementMapCell.tsx`
- Create: `src/renderer/src/components/ArrangementMap.tsx`

- [ ] **Step 1: Read `tokens.css` and `docs/design.md` before writing any style**

Non-negotiable for this task: no `border-radius` anywhere (`--ra-r-*` are all `0px`), Silkscreen via `--ra-font`, lowercase copy, no emoji, no exclamation marks, and **colour only where it carries audio information**. The map's one legitimate colour is a stem's own type colour on an ON cell, through the documented chip recipe.

- [ ] **Step 2: Write `ArrangementMapCell.tsx`**

```tsx
import { typeColorVar } from '../theme/typeColor'
import { COACH_MAP_LOCKED_CELL_HINT } from '@shared/coachLines'
import type { SoundType } from '@shared/types'

export const MAP_CELL_WIDTH = 16
export const MAP_CELL_HEIGHT = 20
export const MAP_CELL_GAP = 1

/**
 * One pass of one row.
 *
 * Colour: an ON cell on a STEM row is the app's documented chip recipe in
 * that stem's own type colour -- background at 14%, border at 50%
 * (tokens.css's alpha recipe). That is colour spent on something carrying
 * audio information, which is the only kind this app allows.
 *
 * A riser row has NO sound type and must not be given one (RiserBlock.tsx
 * says so directly), so `soundType` is null there and the cell falls back to
 * the monochrome fill. That riser rows read as grey while stem rows read as
 * coloured is the point: it is the same distinction the arranger already
 * draws, and it is what makes "this row is not something the map can put
 * back" visible without a legend.
 *
 * A LOCKED cell is a clip that runs past the section's edge (coachMapEdit's
 * clipsCrossingSectionEdge). Dashed, not-allowed, and its tooltip says where
 * to go instead. Nothing is ever destroyed by a refusal.
 */
export function ArrangementMapCell({
  on,
  locked,
  editable,
  soundType,
  dimmed,
  label,
  onToggle
}: {
  on: boolean
  locked: boolean
  /** False for riser and other rows -- there is no stem the map could put
   * back, so the cell reports and does not act. */
  editable: boolean
  soundType: SoundType | null
  /** True for every column that is not the one being walked. */
  dimmed: boolean
  label: string
  onToggle: () => void
}): React.JSX.Element {
  const colour = soundType === null ? null : typeColorVar(soundType)
  const background =
    !on
      ? 'var(--ra-bg-row)'
      : colour === null
        ? 'var(--ra-bg-row-active)'
        : `color-mix(in srgb, ${colour} 14%, transparent)`
  const border =
    !on
      ? '1px solid var(--ra-border-soft)'
      : colour === null
        ? '1px solid var(--ra-border-strong)'
        : `1px solid color-mix(in srgb, ${colour} 50%, transparent)`

  return (
    <button
      type="button"
      disabled={!editable || locked}
      onClick={onToggle}
      data-tooltip={locked ? COACH_MAP_LOCKED_CELL_HINT : label}
      style={{
        width: MAP_CELL_WIDTH,
        height: MAP_CELL_HEIGHT,
        flex: 'none',
        padding: 0,
        borderRadius: 0,
        background,
        border: locked ? '1px dashed var(--ra-border-strong)' : border,
        opacity: dimmed ? 0.45 : 1,
        cursor: !editable ? 'default' : locked ? 'not-allowed' : 'pointer'
      }}
    />
  )
}
```

- [ ] **Step 3: Write `ArrangementMap.tsx`**

```tsx
import { useCallback, useMemo } from 'react'
import { useAppState, useDispatch } from '../state/StoreContext'
import { coachMapRows, type CoachMapRow } from '../state/coachMapRows'
import { buildCellToggleActions } from '../state/coachMapPlacement'
import { passIsLocked, planCellToggle } from '@shared/coachMapEdit'
import { readRowPasses } from '@shared/coachMapRead'
import { sectionBars } from '@shared/coachPasses'
import { coachSectionBoundaries } from '@shared/coachTension'
import { typeColorVar } from '../theme/typeColor'
import type { CoachSection } from '@shared/coachSections'
import {
  ArrangementMapCell,
  MAP_CELL_GAP,
  MAP_CELL_HEIGHT,
  MAP_CELL_WIDTH
} from './ArrangementMapCell'

const ROW_HEADER_WIDTH = 168
const SECTION_GAP = 8

/**
 * The arrangement map: rows are the arranger's own channel rows, columns are
 * sections, and a section subdivides into one cell per pass (spec, "The
 * map").
 *
 * THE THING TO UNDERSTAND BEFORE CHANGING ANYTHING HERE: **this component
 * holds no state and owns no grid.** Every cell it draws is read out of the
 * live timeline (coachMapRows + readRowPasses) and every click dispatches
 * ordinary clip actions (planCellToggle + buildCellToggleActions). There is
 * no commit step, nothing to keep in sync, and undo works because undo
 * already works on clips. If you find yourself adding a useState for the
 * grid, or reading CoachSection.cells here, stop and read
 * src/shared/coachMapRead.ts's own doc comment.
 *
 * Which rows can be EDITED is decided by coachMapRows: a 'stem' row knows
 * which stem belongs on it, so a cell can put one back; a 'riser' row and an
 * 'other' row do not, so they report and do not act. A riser also has no
 * SoundType, so its cells are monochrome -- see ArrangementMapCell.
 */
export function ArrangementMap(): React.JSX.Element {
  const state = useAppState()
  const dispatch = useDispatch()
  const coach = state.coach
  const sections = coach?.sections ?? []
  const climax = coach?.lockedClimax ?? null
  const phraseBars = coach?.phrase?.bars ?? climax?.barLength ?? 1
  const walkIndex = coach?.walkIndex ?? null

  const rows = useMemo(() => coachMapRows(state), [state])
  // Derived, never stored: rename or resize a section and the joins follow.
  // The same list phase three's own panel reads, so the map and the tension
  // pass can never disagree about where a join is.
  const boundaries = useMemo(() => coachSectionBoundaries(sections, phraseBars), [
    sections,
    phraseBars
  ])
  const boundaryAfter = useMemo(
    () => new Set(boundaries.map((boundary) => boundary.index)),
    [boundaries]
  )

  const toggle = useCallback(
    (row: CoachMapRow, section: CoachSection, passIndex: number, on: boolean): void => {
      if (climax === null || row.path === null) return
      const plan = planCellToggle({ clips: row.clips, section, phraseBars, passIndex, on })
      const actions = buildCellToggleActions(state, row, section, plan, climax, phraseBars)
      if (actions.length === 0) return
      // ONE batch, so one cell is one undo step -- and so the map's own
      // edits are the same kind of thing as every other edit in the app.
      dispatch({ type: 'BATCH', actions })
    },
    [climax, dispatch, phraseBars, state]
  )

  if (sections.length === 0) {
    return (
      <div style={{ padding: 'var(--ra-s-7)', fontSize: 11, color: 'var(--ra-text-3)' }}>
        no map yet. run the auto-arranger to build one.
      </div>
    )
  }

  return (
    <div style={{ padding: 'var(--ra-s-5)', overflowX: 'auto' }}>
      {/* Column headers: the section names, with the walked one bright and
          the rest stepped back. No colour -- a section is structure, not
          audio information. */}
      <div style={{ display: 'flex', alignItems: 'flex-end', marginBottom: 'var(--ra-s-2)' }}>
        <div style={{ width: ROW_HEADER_WIDTH, flex: 'none' }} />
        {sections.map((section, index) => (
          <div
            key={section.id}
            style={{
              flex: 'none',
              marginRight: boundaryAfter.has(index) ? SECTION_GAP + 2 : SECTION_GAP,
              borderRight: boundaryAfter.has(index) ? '1px solid var(--ra-border-strong)' : undefined,
              paddingRight: boundaryAfter.has(index) ? SECTION_GAP : 0,
              width: section.passes * (MAP_CELL_WIDTH + MAP_CELL_GAP),
              fontSize: 10,
              lineHeight: 'var(--ra-lh-tight)',
              color: walkIndex === index ? 'var(--ra-text)' : 'var(--ra-text-3)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
            data-tooltip={`${section.passes} × ${phraseBars} bars, from bar ${section.startBar}`}
          >
            {section.name}
          </div>
        ))}
      </div>

      {rows.map((row) => (
        <div
          key={row.channelId}
          style={{ display: 'flex', alignItems: 'center', marginBottom: MAP_CELL_GAP }}
        >
          <div
            style={{
              width: ROW_HEADER_WIDTH,
              flex: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--ra-s-2)',
              fontSize: 10,
              color: row.kind === 'stem' ? 'var(--ra-text-2)' : 'var(--ra-text-3)',
              overflow: 'hidden'
            }}
          >
            {/* The one colour in a row header, and the legitimate one: a
                stem's own identity. A riser has no sound type, so it gets no
                swatch rather than a borrowed hue. */}
            <span
              style={{
                width: 6,
                height: 6,
                flex: 'none',
                background:
                  row.soundType === null ? 'var(--ra-border-strong)' : typeColorVar(row.soundType)
              }}
            />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {row.label}
            </span>
          </div>

          {sections.map((section, sectionIndex) => {
            const passes = readRowPasses(row.clips, section, phraseBars)
            return (
              <div
                key={section.id}
                style={{
                  display: 'flex',
                  gap: MAP_CELL_GAP,
                  flex: 'none',
                  marginRight: boundaryAfter.has(sectionIndex) ? SECTION_GAP + 2 : SECTION_GAP,
                  borderRight: boundaryAfter.has(sectionIndex)
                    ? '1px solid var(--ra-border-strong)'
                    : undefined,
                  paddingRight: boundaryAfter.has(sectionIndex) ? SECTION_GAP : 0,
                  background: walkIndex === sectionIndex ? 'var(--ra-bg-row-sub)' : undefined
                }}
              >
                {passes.map((on, passIndex) => (
                  <ArrangementMapCell
                    key={passIndex}
                    on={on}
                    locked={passIsLocked(row.clips, section, phraseBars, passIndex)}
                    editable={row.kind === 'stem'}
                    soundType={row.soundType}
                    dimmed={walkIndex !== null && walkIndex !== sectionIndex}
                    label={`${row.label} · ${section.name} · pass ${passIndex + 1} of ${
                      section.passes
                    }`}
                    onToggle={() => toggle(row, section, passIndex, !on)}
                  />
                ))}
              </div>
            )
          })}
        </div>
      ))}

      <div style={{ marginTop: 'var(--ra-s-6)', fontSize: 9, color: 'var(--ra-text-3)' }}>
        every square is ordinary clips. one undo takes any of it back.
        {rows.some((row) => row.kind !== 'stem')
          ? ' grey rows are risers and clips the map did not lay out -- edit those on the timeline.'
          : ''}
      </div>
      <div style={{ fontSize: 9, color: 'var(--ra-text-3)' }}>
        total {sectionBars(
          sections.reduce((sum, section) => sum + section.passes, 0),
          phraseBars
        )}{' '}
        bars
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Verify**

```bash
npm run typecheck && npm run lint
```
Expected: clean apart from what Task 12 still owes. **Say plainly in your report that this component was not clicked** — no agent here can.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/ArrangementMap.tsx \
        src/renderer/src/components/ArrangementMapCell.tsx
git commit -m "$(cat <<'EOF'
The whole song, one square per time round the loop

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

### Task 9: The view toggle

**Files:**
- Modify: `src/renderer/src/components/Titlebar.tsx`
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Re-read both files** — the riser work and foundations have both been through `App.tsx`.

- [ ] **Step 2: Add the toggle to `Titlebar.tsx`**

Next to the existing mode-cycle button (which stays exactly as it is — Tab still cycles `ArrangerMode`), add two props and one button:

```tsx
  mapView: boolean
  onToggleMapView: () => void
```

```tsx
        {/* A view, not a mode: the mode button next to this one decides how
            clips behave, this one decides which way you are looking at the
            same arrangement. Two labels rather than one cycling label,
            because there are only two and naming both is clearer than making
            the user press it to find out. Active is the app's own toggle
            treatment -- a grey fill and bright ink, never a colour
            (tokens.css: colour is spent only on audio information). */}
        <button
          onClick={onToggleMapView}
          aria-label="Show the arrangement map"
          data-tooltip="switch between the map and the timeline"
          style={{
            ...buttonStyle,
            width: 72,
            background: mapView ? 'var(--ra-stretch-on-bg)' : buttonStyle.background,
            color: mapView ? 'var(--ra-stretch-on)' : 'var(--ra-text-2)'
          }}
        >
          {mapView ? 'map' : 'timeline'}
        </button>
```

- [ ] **Step 3: Wire it in `App.tsx`**

At the `<Titlebar …>` call (around line 2544, next to `mode={state.mode}`):

```tsx
          mapView={state.mapView}
          onToggleMapView={handleToggleMapView}
```

and next to `handleCycleArrangerMode`:

```tsx
  function handleToggleMapView(): void {
    dispatch({ type: 'SET_MAP_VIEW', on: !state.mapView })
  }
```

- [ ] **Step 4: Swap the timeline for the map**

Inside the scroll container that carries `data-coach-anchor="timeline"` (around line 2585), render one or the other:

```tsx
              {state.mapView ? (
                <ArrangementMap />
              ) : (
                <Timeline
                  onOpenClipMenu={openClipMenu}
                  onOpenRiserMenu={openRiserMenu}
                  onOpenPasteMenu={openPasteMenu}
                  onBackgroundMouseDown={handlePanMouseDown}
                />
              )}
```

Keep the `data-coach-anchor="timeline"` attribute on the scroll container itself, not on either child: it is where sssketchy stands for the whole arrangement phase (`coachSteps.ts`'s `TIMELINE`), and he must not jump across the screen when the view flips.

- [ ] **Step 5: Verify and commit**

```bash
npm run typecheck && npm run lint
```

```bash
git add src/renderer/src/components/Titlebar.tsx src/renderer/src/App.tsx
git commit -m "$(cat <<'EOF'
Two ways of looking at one arrangement

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

### Task 10: The two questions, the phrase report, and the build

sssketchy's own step inside the auto-arranger. **No component tests** (Finding 13).

**Files:**
- Create: `src/renderer/src/components/AutoArrangeCoachStep.tsx`
- Modify: `src/renderer/src/components/AutoArrangeWizard.tsx`

- [ ] **Step 1: Write `AutoArrangeCoachStep.tsx`**

One screen, three blocks appearing in turn, and **exactly one thought at a time** in the bubble line above them.

```tsx
import { useCallback, useEffect, useState } from 'react'
import { useAppState, useDispatch } from '../state/StoreContext'
import { getStemPhrase } from '../audio/phraseCache'
import { buildCoachMapActions } from '../state/coachMapPlacement'
import { buildCoachMapSections } from '@shared/coachMapTemplate'
import { COACH_LOOP_ANSWERS, COACH_SHAPES } from '@shared/coachShapes'
import { COACH_PREFILLED_LINE_TEMPLATES, pickLineVariant } from '@shared/coachLines'
import {
  coachPhraseLine,
  phraseAnswerOptions,
  readLoopPhrase,
  type LoopPhraseReading,
  type StemPhraseReading
} from '@shared/coachPhrase'
import { coachSetupLine } from '@shared/coachWalk'
import { SssketchySprite } from './SssketchySprite'
import type { LockedClimax } from '@shared/coachClimax'
import type { Action } from '../state/store'

const PANEL_WIDTH = 560

const buttonStyle: React.CSSProperties = {
  height: 22,
  borderRadius: 0,
  padding: '0 10px',
  fontSize: 10,
  border: '1px solid var(--ra-border)',
  background: 'var(--ra-bg-row-active)',
  color: 'var(--ra-text-2)',
  cursor: 'pointer'
}

function chosenStyle(on: boolean): React.CSSProperties {
  return {
    ...buttonStyle,
    border: `1px solid ${on ? 'var(--ra-stretch-on)' : 'var(--ra-border)'}`,
    background: on ? 'var(--ra-stretch-on-bg)' : 'var(--ra-bg-row-active)',
    color: on ? 'var(--ra-stretch-on)' : 'var(--ra-text-2)'
  }
}

const LOOP_ANSWER_LABEL: Record<string, string> = {
  drop: 'the drop',
  verse: 'a verse',
  intro: 'an intro',
  unsure: 'not sure'
}

/**
 * sssketchy inside the auto-arranger -- the only place he lives now (spec:
 * "A standalone flow is the wrong home. sssketchy lives in the auto-arranger
 * now, and nowhere else").
 *
 * THREE BLOCKS, ONE THOUGHT. The screen shows both opening questions and,
 * when there is one, the phrase report -- but his LINE is only ever about
 * the question still open (coachSetupLine), which is what keeps "one thought
 * at a time" true on a surface that is a form rather than a bubble.
 *
 * THE PHRASE RULE, which is the one most likely to be helpfully broken:
 * **the measurement is REPORTED, never applied.** Nothing here writes
 * `phrase` except the click on one of the two buttons, and if the
 * measurement is inconclusive coachPhraseLine returns null and the whole
 * block stays off the screen -- he says nothing rather than guessing. The
 * measurement also never blocks: if it has not landed by the time both
 * questions are answered, the build simply uses the nominal length, which is
 * the answer the user would have given anyway.
 */
export function AutoArrangeCoachStep({
  climax,
  onCancel,
  onBuilt
}: {
  climax: LockedClimax
  onCancel: () => void
  onBuilt: () => void
}): React.JSX.Element {
  const state = useAppState()
  const dispatch = useDispatch()
  const coach = state.coach
  const [reading, setReading] = useState<LoopPhraseReading | null>(null)

  // Measured while the user answers the two questions above it. The setState
  // is inside the promise callback, never in the effect body -- a
  // synchronous one there is a lint error in this repo
  // (react-hooks/set-state-in-effect) as well as a cascading render.
  useEffect(() => {
    let cancelled = false
    const paths = climax.stems.map((stem) => ({ path: stem.path, bars: stem.barLength }))
    void Promise.allSettled(paths.map((p) => getStemPhrase(p.path, p.bars))).then((results) => {
      if (cancelled) return
      const readings: StemPhraseReading[] = results
        .filter((r): r is PromiseFulfilledResult<StemPhraseReading> => r.status === 'fulfilled')
        .map((r) => r.value)
      setReading(readLoopPhrase(readings, climax.barLength))
    })
    return () => {
      cancelled = true
    }
  }, [climax])

  // Recorded on the flow as soon as it lands -- a MEASUREMENT, which sizes
  // nothing by itself. COACH_SET_PHRASE is the only thing that sizes, and
  // only a click dispatches it.
  useEffect(() => {
    if (reading === null) return
    dispatch({ type: 'COACH_SET_PHRASE_READING', reading })
  }, [dispatch, reading])

  const build = useCallback((): void => {
    if (coach === null || coach.loopIs === null || coach.shape === null) return
    const phraseBars = coach.phrase?.bars ?? climax.barLength
    // Built here AND rebuilt by the reducer from the same pure function over
    // the same inputs, so the two cannot disagree -- which is what lets
    // COACH_BUILD_MAP stay a four-field action instead of carrying a whole
    // section list through the store.
    const sections = buildCoachMapSections({
      shape: coach.shape,
      loopIs: coach.loopIs,
      phraseBars,
      climax,
      firstStartBar: 0
    })
    const built = buildCoachMapActions(state, { ...coach, sections }, sections)
    const actions: Action[] = [
      { type: 'COACH_BUILD_MAP', firstStartBar: 0 },
      ...built.actions,
      { type: 'COACH_RECORD_MAP_PLACEMENT', placedGroupIds: built.placedGroupIds },
      { type: 'SET_ARRANGER_MODE', mode: 'normal' },
      { type: 'SET_MAP_VIEW', on: true },
      { type: 'COACH_START_WALK', now: Date.now() }
    ]
    // ONE batch: the whole map, the clips under it and the walk it starts
    // are one undo step -- which is what makes "cmd+z puts everything back
    // on" true rather than a figure of speech.
    dispatch({ type: 'BATCH', actions })
    onBuilt()
  }, [climax, coach, dispatch, onBuilt, state])

  if (coach === null) return <div style={{ padding: 20 }}>no flow</div>

  const line = coachSetupLine(coach)
  const phraseLine = reading === null ? null : coachPhraseLine(reading, coach.lineSeed)
  const options = reading === null ? [] : phraseAnswerOptions(reading)
  const ready = coach.loopIs !== null && coach.shape !== null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--ra-backdrop)',
        zIndex: 'var(--ra-z-modal)',
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
          width: PANEL_WIDTH,
          maxHeight: '80vh',
          overflowY: 'auto'
        }}
      >
        <div style={{ display: 'flex', gap: 'var(--ra-s-5)', alignItems: 'flex-start' }}>
          <SssketchySprite animation="idle" size={48} onClick={() => {}} title="sssketchy" />
          <div style={{ flex: 1, fontSize: 11, lineHeight: 'var(--ra-lh-body)', minHeight: 34 }}>
            {line ?? (ready ? 'ready when you are.' : '')}
          </div>
        </div>

        <div className="ra-eyebrow" style={{ marginTop: 'var(--ra-s-7)' }}>
          what is this loop
        </div>
        <div style={{ display: 'flex', gap: 'var(--ra-s-1)', marginTop: 'var(--ra-s-2)' }}>
          {COACH_LOOP_ANSWERS.map((answer) => (
            <button
              key={answer}
              type="button"
              onClick={() => dispatch({ type: 'COACH_SET_LOOP_ANSWER', loopIs: answer })}
              style={chosenStyle(coach.loopIs === answer)}
            >
              {LOOP_ANSWER_LABEL[answer] ?? answer}
            </button>
          ))}
        </div>

        {coach.loopIs !== null && (
          <>
            <div className="ra-eyebrow" style={{ marginTop: 'var(--ra-s-7)' }}>
              how long a journey
            </div>
            <div style={{ display: 'flex', gap: 'var(--ra-s-1)', marginTop: 'var(--ra-s-2)' }}>
              {COACH_SHAPES.map((shape) => (
                <button
                  key={shape.id}
                  type="button"
                  onClick={() => dispatch({ type: 'COACH_SET_SHAPE', shape: shape.id })}
                  style={{ ...chosenStyle(coach.shape === shape.id), height: 'auto', padding: 6 }}
                >
                  {/* The article's own letters, which read as a journey in a
                      way a list of six words does not. */}
                  <div>{shape.letters.join(' ')}</div>
                  <div style={{ marginTop: 2, fontSize: 9, color: 'var(--ra-text-3)' }}>
                    {shape.label} · about {shape.approxMinutes} min
                  </div>
                </button>
              ))}
            </div>
          </>
        )}

        {/* Silent when the measurement is inconclusive or simply agrees with
            the loop's stated length -- "if the measurement is inconclusive,
            sssketchy says nothing rather than guessing" (spec). */}
        {phraseLine !== null && (
          <>
            <div className="ra-eyebrow" style={{ marginTop: 'var(--ra-s-7)' }}>
              the phrase
            </div>
            <div
              style={{
                marginTop: 'var(--ra-s-2)',
                fontSize: 11,
                lineHeight: 'var(--ra-lh-body)',
                color: 'var(--ra-text)'
              }}
            >
              {phraseLine}
            </div>
            <div style={{ display: 'flex', gap: 'var(--ra-s-1)', marginTop: 'var(--ra-s-2)' }}>
              {options.map((option) => (
                <button
                  key={`${option.bars}-${option.source}`}
                  type="button"
                  onClick={() => dispatch({ type: 'COACH_SET_PHRASE', phrase: option })}
                  style={chosenStyle(coach.phrase?.bars === option.bars)}
                >
                  {option.bars} bars
                </button>
              ))}
            </div>
          </>
        )}

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            marginTop: 'var(--ra-s-7)'
          }}
        >
          <button type="button" onClick={onCancel} style={buttonStyle}>
            cancel
          </button>
          <button
            type="button"
            onClick={build}
            disabled={!ready}
            title={ready ? undefined : 'answer both questions first'}
            style={{
              ...buttonStyle,
              border: '1px solid var(--ra-border-strong)',
              color: 'var(--ra-text)',
              opacity: ready ? 1 : 0.3,
              cursor: ready ? 'pointer' : 'not-allowed'
            }}
          >
            build the map
          </button>
        </div>

        {/* Said before the map is built rather than after, so the way out is
            known before there is anything to undo. Elling's own condition
            for the pre-fill being allowed at all. */}
        {ready && (
          <div style={{ marginTop: 'var(--ra-s-5)', fontSize: 10, color: 'var(--ra-text-3)' }}>
            {pickLineVariant(COACH_PREFILLED_LINE_TEMPLATES, coach.lineSeed)}
          </div>
        )}
      </div>
    </div>
  )
}
```

**Note the escaped middle dot:** inside JSX text, write `{'·'}` rather than a bare `·` — fix that when you type it in; the block above shows where it goes, not the exact escape.

- [ ] **Step 2: Rewire `AutoArrangeWizard.tsx`**

Replace the one-shot build. The wizard becomes two steps: confirm roles, then sssketchy.

```tsx
export function AutoArrangeWizard({ onClose, currentSketch }: Props): React.JSX.Element {
  const dispatch = useDispatch()
  const state = useAppState()
  const { flatStemsByKey } = usePlacedFlatStems()
  const [climax, setClimax] = useState<LockedClimax | null>(null)

  /**
   * Confirming the roles no longer BUILDS anything.
   *
   * It used to run runAutoArrangeBuild and dispatch the whole arrangement in
   * one go -- "confirm roles, then build everything silently". That is the
   * flow this replaces (spec: sssketchy "lives in the auto-arranger now, and
   * nowhere else"). What the roles produce now is the MATERIAL: a locked
   * climax carrying the role the user just confirmed for every stem, which
   * the map is carved from.
   *
   * showLengthAndShape is false on the role step now, because length and
   * shape are sssketchy's own two questions and asking them twice, in two
   * vocabularies, would be the app arguing with itself.
   */
  const handleRoleConfirm = useCallback(
    (roles: StemRoleInfo[]): void => {
      const included = roles.filter((role) => role.included)
      recordRoleCategorization(roles, flatStemsByKey, 'autoarrange', currentSketch)
      const inputs: CoachClimaxStemInput[] = []
      for (const role of included) {
        const flat = flatStemsByKey.get(role.stemKey)
        if (flat === undefined) continue
        inputs.push({
          stem: {
            path: flat.stem.path,
            name: flat.stem.name,
            author: flat.stem.author,
            type: flat.stem.type,
            durationSec: flat.stem.durationSec,
            barLength: flat.stem.barLength
          },
          role: engineRoleFor(role),
          gain: state.vol[flat.stemKey] ?? 1
        })
      }
      const locked = lockClimaxFromArrangeRoles(inputs, state.bpm, Date.now())
      if (locked === null) return
      dispatch({ type: 'COACH_START', now: Date.now() })
      setClimax(locked)
    },
    [currentSketch, dispatch, flatStemsByKey, state.bpm, state.vol]
  )

  if (climax !== null) {
    return (
      <AutoArrangeCoachStep climax={climax} onCancel={onClose} onBuilt={onClose} />
    )
  }
  return (
    <AutoArrangeRoleStep
      onConfirm={handleRoleConfirm}
      onCancel={onClose}
      showLengthAndShape={false}
    />
  )
}
```

`COACH_START` does not carry a climax, and `COACH_LOCK_CLIMAX` takes `CoachSlotSnapshot[]`, which this path does not have — the roles came from the timeline, not from Discover. So add one action alongside them in `store.ts`:

```ts
  // The auto-arranger's own lock-in. COACH_LOCK_CLIMAX next to this one
  // freezes DISCOVER's slots and derives each stem's role from the kinds
  // Discover tagged; this one takes a climax that is already built, because
  // the auto-arranger's material comes off the timeline with a role the user
  // confirmed BY HAND (lockClimaxFromArrangeRoles), and re-deriving that role
  // from kinds would throw the hand-made half away. Both are transient: a
  // lock is where the flow is, not an edit to the project.
  | { type: 'COACH_SET_CLIMAX'; climax: LockedClimax }
```

```ts
    case 'COACH_SET_CLIMAX':
      return state.coach === null
        ? state
        : { ...state, coach: { ...state.coach, lockedClimax: action.climax } }
```

with `'COACH_SET_CLIMAX'` added to `TRANSIENT_ACTION_TYPES`, and the wizard dispatching both in one batch so starting a flow and giving it its material is one step:

```ts
      dispatch({
        type: 'BATCH',
        actions: [
          { type: 'COACH_START', now: Date.now() },
          { type: 'COACH_SET_CLIMAX', climax: locked }
        ]
      })
```

Add to `store.test.ts`:

```ts
it('takes a climax that was built from confirmed roles, role and all', () => {
  const locked = lockClimaxFromArrangeRoles(
    [{ stem: stemSnapshot('/pad.wav'), role: 'textureFx', gain: 1 }],
    120,
    T0
  )!
  const next = reducer({ ...initialState, coach: startCoach(T0) }, {
    type: 'COACH_SET_CLIMAX',
    climax: locked
  })
  expect(next.coach?.lockedClimax?.stems[0].role).toBe('textureFx')
})

it('ignores a climax when there is no flow to give it to', () => {
  expect(reducer(initialState, { type: 'COACH_SET_CLIMAX', climax: climaxFixture }).coach).toBeNull()
})
```

The now-unused imports (`runAutoArrangeBuild`, `buildArrangeReplaceActions`, `computeDensityScore`, `computeFillScore`, `getStemFeatures`, `ArrangeStemInput`, `ArrangeShape`) go. `runAutoArrangeBuild` itself and its tests **stay** — `DrawArrangeWizard` is a separate surface and this plan does not touch it. Check that with a grep before deleting anything in `src/shared/`:

```bash
grep -rn "runAutoArrangeBuild\|buildArrangeReplaceActions" src --include='*.tsx' --include='*.ts'
```

- [ ] **Step 3: Verify and commit**

```bash
npm run typecheck && npm run lint
```

```bash
git add src/renderer/src/components/AutoArrangeCoachStep.tsx \
        src/renderer/src/components/AutoArrangeWizard.tsx src/renderer/src/state
git commit -m "$(cat <<'EOF'
He lives in the auto-arranger now, and he asks two things first

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

### Task 11: The walk on screen

**Files:**
- Modify: `src/renderer/src/components/SssketchyCoach.tsx`

- [ ] **Step 1: Re-read the file** — foundations Task 2 removed the offers row and the seeded note from it.

- [ ] **Step 2: Put the walk line in the chain**

```tsx
  // Phase three first (an exported v1 has its own thing to say), then the
  // walk, then the step's own line. coachWalkLine returns null whenever he
  // is not standing on a column, so nothing else is affected.
  const line = coachPhase3Line(coach) ?? coachWalkLine(coach) ?? coachLineFor(coach)
```

Delete the `<SssketchySectionPanel />` render and its import — the map is phase two's surface now.

- [ ] **Step 3: Add the walk's own three buttons**

Inside the bubble's button row, only while he is walking, before the fixed next/skip row:

```tsx
          {/* The walk's own controls. "back" clamps at the first column and
              "next" past the last one ENDS the walk (walkCoachTo), so the
              last press does the obvious thing rather than nothing. "leave
              the walk" is spelled out rather than shrunk to a close box:
              "leaving the walk keeps the map" (spec) is the whole reason it
              is safe to press, and a glyph cannot say that. */}
          {coach.walkIndex !== null && !finished && (
            <div style={{ ...rowStyle, marginTop: 'var(--ra-s-5)' }}>
              <span style={{ flex: 1, fontSize: 9, color: 'var(--ra-text-3)' }}>
                {coach.sections[coach.walkIndex]?.name ?? ''} ({coach.walkIndex + 1} of{' '}
                {coach.sections.length})
              </span>
              <button type="button" onClick={onWalkBack} style={bubbleButtonStyle}>
                back
              </button>
              <button type="button" onClick={onWalkNext} style={bubbleButtonStyle}>
                next section
              </button>
              <button
                type="button"
                onClick={onLeaveWalk}
                style={bubbleButtonStyle}
                title="stop walking -- the map stays exactly as it is"
              >
                leave the walk
              </button>
            </div>
          )}
```

with the three handlers wired in `SssketchyCoach`'s own gate component:

```tsx
        onWalkBack={() =>
          dispatch({ type: 'COACH_WALK_TO', now: Date.now(), index: (coach.walkIndex ?? 0) - 1 })
        }
        onWalkNext={() =>
          dispatch({ type: 'COACH_WALK_TO', now: Date.now(), index: (coach.walkIndex ?? 0) + 1 })
        }
        onLeaveWalk={() => dispatch({ type: 'COACH_END_WALK', now: Date.now() })}
```

- [ ] **Step 4: Offer the walk back once it has been left**

On a flow that has a map but no `walkIndex`, the bubble's row gets one more button, so leaving is reversible and the offer is never pushy:

```tsx
          {coach.walkIndex === null && coach.sections.length > 0 && !finished && (
            <button type="button" onClick={onStartWalk} style={bubbleButtonStyle}>
              walk the sections
            </button>
          )}
```

- [ ] **Step 5: Verify and commit**

```bash
npm run typecheck && npm run lint
```

```bash
git add src/renderer/src/components/SssketchyCoach.tsx
git commit -m "$(cat <<'EOF'
One column at a time, and leaving keeps every square

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

### Task 12: The old carving surface leaves

The one-section-at-a-time panel and everything that only existed for it. Read the memory note this repo already carries — *grep ALL call sites before splitting a class's removal across tasks* — and do the greps in Step 1 before deleting a line.

**Files:**
- Delete: `src/renderer/src/components/SssketchySectionPanel.tsx`
- Delete: `src/renderer/src/state/coachSectionBridge.ts` (+ its test)
- Delete: `src/renderer/src/state/useCoachSectionPreview.ts` (+ its test)
- Delete: `src/shared/coachPhase2.ts` (+ its test)
- Modify: `src/shared/coachSections.ts`
- Modify: `src/shared/coachSections.test.ts`
- Modify: `src/shared/coachSteps.ts`
- Modify: `src/shared/coachSteps.test.ts`
- Modify: `src/shared/coach.ts`

- [ ] **Step 1: Grep every call site first**

```bash
grep -rn "SssketchySectionPanel\|coachSectionBridge\|registerCoachSectionOp\|useCoachSectionPreview" src
grep -rn "coachPhase2\|coachSectionLine\|startCoachSection\|placeCoachSection\|draftSection" src
grep -rn "CoachSectionOp\|'section-op'\|COACH_SECTION_OPS\|nextSectionTypeSuggestions" src
grep -rn "COACH_DROP_SUGGESTED_LABEL\|COACH_SUGGESTED_DROP_HINT\|suggestedDropPaths" src
```

Write the list down. `isSuggestedDrop` and `COACH_SECTION_DROP_SETS` **stay** — `coachMapTemplate.ts`'s `templateStemPlays` is built on them and they are the whole pre-fill. `suggestedDropPaths` and the two label constants go with the panel.

- [ ] **Step 2: Delete the four modules**

```bash
git rm src/renderer/src/components/SssketchySectionPanel.tsx \
       src/renderer/src/state/coachSectionBridge.ts \
       src/renderer/src/state/coachSectionBridge.test.ts \
       src/renderer/src/state/useCoachSectionPreview.ts \
       src/renderer/src/state/useCoachSectionPreview.test.ts \
       src/shared/coachPhase2.ts src/shared/coachPhase2.test.ts
```

(Any of the test files that do not exist: skip them, and say which in your report.)

- [ ] **Step 3: Drop the draft from `coach.ts` and `coachSections.ts`**

- `CoachState.draftSection` and its initialiser and sanitiser go.
- `sanitiseCoachSectionDraft` goes. `CoachSectionDraft` **stays** as a type — it is still the shape "a section before it was placed", which is what `buildCoachMapSections` produces on its way into `buildCoachMapActions`.
- `CoachSectionOp`, `COACH_DROP_SUGGESTED_LABEL`, `COACH_SUGGESTED_DROP_HINT`, `suggestedDropPaths`, `COACH_FIRST_SECTION_TYPES`, `nextSectionTypeSuggestions` and `newCoachSectionDraft` go.
- `COACH_SECTION_TRANSITIONS` **stays**: `tensionOffersAt` reads it.

Replace `coachSections.ts`'s module doc comment's opening paragraph (foundations rewrote it once already) with a line saying where the draft went:

```ts
 * The one-section-at-a-time DRAFT this file used to carry went with the map
 * on 2026-09-23: sections now arrive whole and pre-filled
 * (./coachMapTemplate.ts) and are edited on the map, which writes real clips
 * (../renderer/src/state/coachMapPlacement.ts). CoachSectionDraft survives
 * as a plain shape -- a section before it has been placed -- and nothing
 * stores one any more.
```

- [ ] **Step 4: Re-point the three arrangement steps**

In `src/shared/coachSteps.ts`, the three `p2-` rows are no longer about carving one section. Rewrite their lines and moves:

- `p2-first` — the map has just arrived. Lines from the map's own vocabulary; `moves: []` (what the sections should become is not the app's call).
- `p2-section` — the walk. `moves: []` for the same reason: he is naming a goal, and doing it for you would be exactly the dictate the spec forbids.
- `p2-next` — leaving the walk, heading to polish.

Delete the `{ kind: 'section-op'; op: CoachSectionOp }` member of `CoachMoveAction` and the `section-*` moves from `p2-section`. Update the lines to match the map (they currently say "every stem from the locked loop is on… subtracting is the only thing that changes it", which is the reversed rule and would now be wrong):

```ts
  {
    id: 'p2-section',
    phase: 'arrangement',
    label: 'walk the sections',
    lines: [
      'the map is the whole song at once. one column per section, one square per pass.',
      'every square is ordinary clips underneath. switch one off and the clip goes.',
      'this is the shape, filled in. change anything you like, or leave it.',
      'the map and the timeline are the same arrangement. the toggle up top swaps them.'
    ],
    moves: [],
    anchorSelector: TIMELINE
  },
```

Keep `p2-first`'s and `p2-next`'s existing structure; only their `lines` need rewriting, to the same rules as Task 3. Update `coachSteps.test.ts`'s assertions about which moves each row has.

- [ ] **Step 5: Run everything**

```bash
npx vitest run && npm run typecheck && npm run lint
grep -rn "coachPhase2\|draftSection\|SssketchySectionPanel\|section-op" src
```
Expected: suite green, typecheck clean, lint at its 4 known warnings, and **no hits** from the grep.

- [ ] **Step 6: Commit**

```bash
git add -A src
git commit -m "$(cat <<'EOF'
Carving one section at a time was the old way in

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

### Task 13: The tension pass, at the map's boundaries

Phase three plugs into the map's joins. Small on purpose: `coachSectionBoundaries` already derives the joins from the sections, so the map only has to **show** them and the walk only has to stand on them.

**Files:**
- Modify: `src/renderer/src/components/ArrangementMap.tsx`
- Modify: `src/renderer/src/components/SssketchyTensionPanel.tsx`

- [ ] **Step 1: Re-read `SssketchyTensionPanel.tsx`** — the riser agent has been in it.

- [ ] **Step 2: Mark an applied join on the map**

`ArrangementMap` already draws a `--ra-border-strong` divider after every section index in `boundaryAfter` (Task 8). Thicken it when something is actually switched on there, which is the one fact the map can report about a join:

```tsx
  const appliedAt = useMemo(
    () => new Set((coach?.tension ?? []).map((entry) => entry.sectionIndex)),
    [coach]
  )
```

and in both the header and the row loops, use `appliedAt.has(index) ? '2px solid var(--ra-text-2)' : '1px solid var(--ra-border-strong)'` for the divider. Monochrome — a join is structure, not audio information.

Deliberately **not** done here: the toggles themselves. They already live in the bubble (`SssketchyTensionPanel`, mounted while `p3-tension` is current), one row per join, and putting a second set on the map would be two ways to do one thing — exactly what the panel's own doc comment refuses for the listen button.

- [ ] **Step 3: Make the tension panel follow the walk**

In `SssketchyTensionPanel`, when the walk is running, put the boundary the user is standing next to first and dim the rest, so the tension pass reads as a continuation of the walk rather than a new list:

```tsx
  // The walk and the tension pass are the same journey seen twice, so the
  // join the user is standing next to leads. Sorted, never filtered: the
  // others are still there, because a pass that hid the joins you were not
  // on would be a flow you cannot skim.
  const ordered = useMemo(() => {
    const walkIndex = coach?.walkIndex ?? null
    if (walkIndex === null) return boundaries
    return [...boundaries].sort(
      (a, b) => Math.abs(a.index - walkIndex) - Math.abs(b.index - walkIndex)
    )
  }, [boundaries, coach])
```

and render `ordered` instead of `boundaries`. Leave the bridge registration reading `boundaries` — "play the first join" should mean the first in timeline order, not the nearest.

- [ ] **Step 4: Verify and commit**

```bash
npx vitest run && npm run typecheck && npm run lint
```

```bash
git add src/renderer/src/components
git commit -m "$(cat <<'EOF'
The seams show up where the columns meet

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

### Task 14: Changing the phrase re-sizes the map and re-lays the clips

The fragile one. Read it twice before starting.

**Files:**
- Modify: `src/renderer/src/state/coachMapPlacement.ts`
- Modify: `src/renderer/src/state/coachMapPlacement.test.ts`
- Modify: `src/renderer/src/components/ArrangementMap.tsx`

- [ ] **Step 1: Understand the problem before writing anything**

The spec says *"He can change it afterwards; the map re-sizes, it does not rebuild."* Foundations' `COACH_SET_PHRASE` does exactly that to the **sections** — ids, names, types and cells all survive, only `passes` and `startBar` move. But this plan made the **clips** the truth, and clips do not move when `passes` does. A re-size on its own would leave every section's window pointing at bars its clips no longer occupy, and the map would read garbage.

So a phrase change is three things in one batch: **read the current grid off the timeline, re-size the sections, and re-lay the clips from the grid that was read.** Ids, names and types survive, which is what "re-sizes, not rebuilds" means to the person looking at it — and the user's own edits survive too, because they are read out of the clips rather than out of stale build-time cells.

- [ ] **Step 2: Write the failing test**

Add to `src/renderer/src/state/coachMapPlacement.test.ts`:

```ts
describe('buildMapRebuildActions', () => {
  it('keeps every section id, name and type across a phrase change', () => {
    const built = buildMapRebuildActions(state, coach, 4)
    const rebuild = built.actions.find((a) => a.type === 'COACH_RECORD_MAP_PLACEMENT')
    expect(rebuild).toBeDefined()
    expect(built.sections.map((s) => s.id)).toEqual(coach.sections.map((s) => s.id))
    expect(built.sections.map((s) => s.name)).toEqual(coach.sections.map((s) => s.name))
  })

  it('keeps each section about the same number of BARS at the new phrase', () => {
    const before = sectionBars(coach.sections[0].passes, 8)
    const built = buildMapRebuildActions(state, coach, 4)
    expect(sectionBars(built.sections[0].passes, 4)).toBe(before)
  })

  it('carries a USER edit across, not the build-time cells', () => {
    // The kick was switched off in pass 1 of section 0 by a click on the
    // map, so the CLIP is gone but section.cells still says {}.
    const edited = withKickOffInPass(state, 1)
    const built = buildMapRebuildActions(edited, coach, 4)
    // At half the phrase, that one 8-bar pass is two 4-bar ones.
    expect(built.sections[0].cells['2|/kick.wav']).toBe(false)
    expect(built.sections[0].cells['3|/kick.wav']).toBe(false)
  })

  it('deletes the old clips after placing the new ones', () => {
    const built = buildMapRebuildActions(state, coach, 4)
    const deleteIndex = built.actions.findIndex((a) => a.type === 'DELETE_RIFFFS')
    const lastPlace = built.actions.map((a) => a.type).lastIndexOf('PLACE_LOOP_ON_TIMELINE')
    expect(deleteIndex).toBeGreaterThan(lastPlace)
  })

  it('does nothing at all when the phrase did not change', () => {
    expect(buildMapRebuildActions(state, coach, coach.phrase!.bars).actions).toEqual([])
  })
})
```

- [ ] **Step 3: Write `buildMapRebuildActions`**

In `coachMapPlacement.ts`, extending its imports with `resizeCoachMapToPhrase` from `@shared/coachMapTemplate`, `readRowPasses` and `rowPassesToCells` from `@shared/coachMapRead`, `remapCellsToPhrase` from `@shared/coachMapEdit`, `type CoachCells` from `@shared/coachCells`, and `coachMapRows` from `./coachMapRows`:

```ts
/**
 * The user changed his mind about the phrase length.
 *
 * "He can change it afterwards; the map RE-SIZES, it does not rebuild"
 * (spec). Ids, types and names all survive -- which is what re-sizing means
 * to the person looking at it -- and so do his own edits, because they are
 * READ OFF THE TIMELINE first (readRowPasses) rather than taken from
 * section.cells, which records only what the map was built from and has said
 * nothing true since the first click.
 *
 * The three steps, in one batch and therefore one undo:
 *   1. read every row's real grid at the OLD phrase,
 *   2. re-size the sections and carry the grid across proportionally
 *      (remapCellsToPhrase),
 *   3. place the clips again from that grid and delete the old ones.
 *
 * This is the most fragile thing in the feature and it is worth saying why
 * it exists at all: the alternative -- refusing to change the phrase once a
 * map is down -- would have been much simpler and would have quietly dropped
 * the one thing the spec is most insistent about, which is that the user
 * owns this number.
 */
export function buildMapRebuildActions(
  state: AppState,
  coach: CoachState,
  toPhraseBars: number
): CoachMapPlacement & { sections: CoachSection[] } {
  const fromPhraseBars = coach.phrase?.bars ?? coach.lockedClimax?.barLength ?? 1
  const empty = { actions: [] as Action[], placedGroupIds: {}, sections: [...coach.sections] }
  if (coach.lockedClimax === null || toPhraseBars === fromPhraseBars) return empty

  const rows = coachMapRows(state)
  const pathRows = rows.filter((row) => row.path !== null)
  const resized = resizeCoachMapToPhrase(coach.sections, fromPhraseBars, toPhraseBars)
  const sections = resized.map((section, index): CoachSection => {
    const old = coach.sections[index]
    let cells: CoachCells = {}
    for (const row of pathRows) {
      const read = rowPassesToCells(
        readRowPasses(row.clips, old, fromPhraseBars),
        row.path as string
      )
      cells = {
        ...cells,
        ...remapCellsToPhrase(read, [row.path as string], old.passes, section.passes)
      }
    }
    return { ...section, cells }
  })

  const built = buildCoachMapActions(state, { ...coach, sections }, sections)
  return { ...built, sections }
}
```

`buildCoachMapActions` already deletes every placed source rifff last, which for a re-lay means the whole previous map — exactly right.

- [ ] **Step 4: Offer it on the map**

In `ArrangementMap`, above the grid, render the phrase choice only when there is a measurement worth offering (`coach.phraseReading` is non-null and `loopPhraseIsWorthSaying`), and dispatch one batch:

```tsx
  const changePhrase = useCallback(
    (bars: number, source: CoachPhraseSource): void => {
      if (coach === null) return
      const built = buildMapRebuildActions(state, coach, bars)
      dispatch({
        type: 'BATCH',
        actions: [
          { type: 'COACH_SET_PHRASE', phrase: { bars, source } },
          ...built.actions,
          { type: 'COACH_RECORD_MAP_PLACEMENT', placedGroupIds: built.placedGroupIds }
        ]
      })
    },
    [coach, dispatch, state]
  )
```

`COACH_SET_PHRASE` re-sizes the sections in the reducer with the same `resizeCoachMapToPhrase` the builder used, from the same inputs, so the two agree. Add a reducer test in `store.test.ts` asserting that the sections the builder produced and the sections the reducer produced have the same `passes` and `startBar`.

- [ ] **Step 5: Run and commit**

Run: `npx vitest run && npm run typecheck && npm run lint`
Expected: green.

```bash
git add src/renderer/src/state src/renderer/src/components/ArrangementMap.tsx
git commit -m "$(cat <<'EOF'
Changing your mind about the phrase moves the squares, not the song

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h
EOF
)"
```

---

### Task 15: Whole-suite verification

**Files:** none.

- [ ] **Step 1: Run everything**

```bash
npx vitest run && npm run typecheck && npm run lint
```
Expected: suite green (note the new number), typecheck clean, lint at exactly its 4 pre-existing prettier warnings in unrelated files.

- [ ] **Step 2: Confirm nothing native changed**

```bash
git diff --stat master -- native-engine/
```
Expected: no output. This plan touches no C++ and requires no engine rebuild. If you found yourself needing one, you went off-plan — stop and report it.

- [ ] **Step 3: Confirm the map really is a projection**

```bash
grep -rn "\.cells" src --include='*.tsx' --include='*.ts' | grep -v test
```
Expected: `cells` is read only by `coachCells.ts`, `coachMapTemplate.ts`, `coachSections.ts`'s sanitiser, `coachMapPlacement.ts`'s two builders and the reducer cases that write it. **If `cells` is read anywhere inside `ArrangementMap.tsx` or `coachMapRows.ts`, Finding 1 has been broken** and the map has grown a second model.

```bash
grep -rn "useState" src/renderer/src/components/ArrangementMap.tsx
```
Expected: no hits. The map holds no state.

- [ ] **Step 4: Confirm the measurement still never sizes anything**

```bash
grep -rn "phraseReading" src | grep -v test
```
Expected: exactly the places that STORE or READ it — `coach.ts`, `store.ts`'s `COACH_SET_PHRASE_READING`, `AutoArrangeCoachStep.tsx`'s report block, `ArrangementMap.tsx`'s offer. **If `phraseReading` appears anywhere that computes a pass count, a bar count or a section length, the spec's central instruction has been broken.**

- [ ] **Step 5: Confirm sssketchy has exactly one way in**

```bash
grep -rn "COACH_START" src --include='*.tsx'
```
Expected: exactly one hit, in `AutoArrangeWizard.tsx`. The spec: *"The project-menu entry point — deleted. The auto-arranger is the only way in."*

- [ ] **Step 6: Confirm no colour was invented**

```bash
grep -rn "typeColorVar\|stemColorVar\|#[0-9a-fA-F]\{6\}" src/renderer/src/components/ArrangementMap.tsx \
        src/renderer/src/components/ArrangementMapCell.tsx \
        src/renderer/src/components/AutoArrangeCoachStep.tsx
grep -rn "border-radius\|borderRadius: [^0]" src/renderer/src/components/ArrangementMap.tsx \
        src/renderer/src/components/ArrangementMapCell.tsx
```
Expected: `typeColorVar` only, no raw hex, and every `borderRadius` exactly `0`.

- [ ] **Step 7: Commit anything outstanding, then report**

---

## Manual walkthrough (for Elling — an agent cannot do this)

Run `npm run dev`. A renderer reload is enough; nothing native changed.

1. Put a loop on the timeline — a rifff whose stems you know well. Open the gear menu and choose **auto-arrange**.
2. Confirm the roles. The length and shape controls are gone from that screen now; they belong to sssketchy.
3. He should ask **what this loop is** and nothing else. Answer it. Then he should ask **how long a journey**, showing the three shapes in letters (`A B D A`, `A B C D B C D A`, `A B C D E C D A`).
4. **The phrase report is the thing only you can judge.** If your loop is really the same four bars twice, he should say so — and offer you two bar counts, with nothing applied until you press one. If your loop genuinely takes all eight bars to say its piece, **he should say nothing at all**. Try both.
5. Press **build the map**. You should land on the map view, with him standing on the first column and a line saying what that section is for, plus a line somewhere saying he made the pre-fill call and that cmd+z puts everything back on.
6. **Press cmd+z once.** The whole thing — every clip, the map, the walk — should go back to the loop you started with, in one step.
7. Rebuild it. Now the round trip, which is the risky part:
   - Toggle a square off. The clip should go.
   - Toggle a square in the middle of a run off. You should get two clips, not three, and not one.
   - Switch to **timeline**, drag a clip one bar. Switch back to **map**. The squares should be unchanged.
   - Drag a clip a whole section's worth. The squares should move with it.
   - Delete a clip on the timeline. Its squares should go dark.
   - Resize a clip shorter. Its last square should go dark.
   - Undo each of those and check the map follows.
8. Walk the sections with **next section**. Each one should say what it is for, without telling you to do anything, and at least sometimes should say a section needs nothing at all. Press **leave the walk** halfway through: the map must be exactly as you left it.
9. Add a riser (right-click below the rows). It should appear on the map as its own **grey** row — no colour — and its squares should not be clickable.
10. Walk to `p3-tension` and switch a join on. The divider between those two columns on the map should thicken.
11. Save, quit, reopen. The map should come back. The walk should not resume on its own — nothing about this flow appears uninvited.

**What only you can judge:** whether the phrase measurement is right on real Endlesss loops; whether the map is legible at the sizes it draws at; whether a section's goal line reads as a friend leaning over your shoulder or as a teacher. All three are ears and eyes, and no agent here has either.

## Known limits, written down on purpose

- **The map's columns do not follow the music.** A section's window is the coach's own `startBar`/`passes`, so dragging a whole section's clips one section to the right shows them in the *next* column. That is honest — the map reports where material sits against the structure that was agreed — but it means the map and a heavily rearranged timeline will eventually describe different songs. Making the columns follow the clips would mean inferring section boundaries from audio, which is a whole other feature.
- **The map reads presence, never audibility.** `state.mute`, `muteRegions` and `RiserClip.muted` are not read. A muted row still shows filled squares. The alternative was worse: an off square that meant "muted" would have to be un-muted by a click on the grid, and a hand-drawn mute region would vanish behind it.
- **A clip crossing a section edge locks its squares.** Nothing is destroyed, but that cell simply cannot be toggled from the map, and the fix is to edit it on the timeline. Only clips a person made can be in this state; the map's own layout never straddles.
- **Two stems can end up sharing a row.** Drag stem B's clip onto stem A's map row and A's squares light up for material that is not A. The map reports what is on the row, and the row's toggle acts with A's stem. One toggle fixes it; the map never silently corrects it.
- **A cell toggle can cost a run's worth of per-clip work.** The plan removes every clip overlapping the run it disturbs and places fresh ones, so any per-clip automation, fade or offset inside that run goes. Runs the toggle did not touch keep everything. There is no warning for this, and it is the single most likely source of a surprised "where did my curve go".
- **The phrase re-lay is the most fragile code in the feature.** It reads the grid, re-sizes and re-places in one batch, and it carries cell edits across proportionally — so halving the phrase splits each square in two, and doubling it keeps the first of each pair and silently loses the second. There is no 8-bar answer that remembers two different 4-bar ones.
- **`'unsure'` silently means `'drop'`.** Inherited from foundations, defended in `COACH_LOOP_HOME_TYPE`'s own comment, and every cell it produces is one toggle from being fixed.
- **The suggested-drop table has never heard your track.** What changed with the pre-fill is that it is now *applied* rather than merely *marked* — legitimate only because the map shows the whole song at once and one cmd+z puts it all back.
- **`arrangeRoleToSlotKinds` never calls anything the hook.** A lead or a vocal keeps its place in a build, because the app cannot tell a hook apart from any other lead and under-flagging costs one click while over-flagging is an assertion it has not earned. The consequence is that builds may keep a hook.
- **No component tests.** `ArrangementMap.tsx`, `ArrangementMapCell.tsx`, `AutoArrangeCoachStep.tsx`, `AutoArrangeWizard.tsx`, `SssketchyCoach.tsx`, `Titlebar.tsx` and `App.tsx` are verified by typecheck, lint and the pure logic's own tests, then by the walkthrough above. This environment has no GUI or audio tooling and an agent cannot click through the app or hear it.
