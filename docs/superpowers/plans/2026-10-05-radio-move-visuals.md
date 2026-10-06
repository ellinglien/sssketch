# Radio Move Visuals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In both radios, a row shows a move **while it sounds**, driven by the same curves the
audio follows (Elling, 2026-10-05: "is there a way to show when a transition action like a dropout
or filter sweep is taking place? maybe a quicker fade in and out"):
- the waveform **dims** to 25% while its row is silent: drums out, low out, stop, a hole, the gap,
  a hook's rest, the intensity arc's breakdown rest; a **duck** dips it;
- a **lift** thins its lower half, a **dip** (and a filter in) its upper half, following the sweep;
- a **wash** (and a bloom) softens it, growing with the send and clearing;
- a **riser** fills a thin line toward the one: on the ruler for a turnaround's riser (its own
  voice), along the row's foot for a change's riser;
- a **throw** trails a ghost of the waveform, fading with the echo;
- **flash words** stay on for the move's duration, then fade out in ~150 ms (in: ~100 ms),
  replacing today's bar-long sine fade.

Brightness and shape only, never colour: sssketch's tokens spend colour only on audio information,
and the web radio's rows are ink.

**Spec:** `docs/superpowers/specs/2026-10-05-radio-move-visuals-design.md` (cc0bf316). Read it first.

**Architecture:**
- **One pure shared helper, TDD:** `src/shared/radioMoveVisuals.ts`.
  - A runtime logs a **visual** (one curve of one parameter on one row, on the runtime's own
    clock) for every move it schedules, keyed by what armed it, exactly as it logs gesture
    flashes today (`RadioFlash`).
  - **Adapters** turn each kind of plan into visuals from the same shared builders the engines
    play: `radioTurnaroundVisuals` (a turnaround's merged row curves, the gap, late rows, the
    riser), `radioGestureVisuals` (`buildDropOutCurve`, `buildFilterInCurve`, `buildBloomCurve`,
    `buildDuckCurve`, `buildTransitionRiser`), `radioThrowVisual`, `radioRestVisual`.
  - `radioRowVisualAt(visuals, rowId, t, fade)` returns `{ level, lowCut, highCut, wash, riser,
    ghost, ghostShiftBars }`, each 0..1 (the spec's six, plus how far the ghost trails). The
    volumes **multiply**, everything else takes the strongest, so a hook's rest, the arc's rest,
    the drop's gap and a duck compose without knowing about each other, and the one (where every
    curve steps back) brings everything back at once.
  - `radioRowVisualVars` turns a look into CSS custom properties (`--mv-bright`, `--mv-low`,
    `--mv-high`, `--mv-wash`, `--mv-riser`, `--mv-ghost`, `--mv-ghost-shift`), the steady states
    under reduced motion. Each runtime has its own CSS rules for them.
- **The flash's quick fades** are an optional `until` on `RadioFlash` and an optional `fade` on
  `radioFlashShown` / `pruneRadioFlashes` (`radioReadout.ts`). Absent, exactly today's.
- **The web** (ell.ing/radio): the controller keeps the visuals log beside its flash log; a pure
  `src/ui/moveFrame.ts` reads it every animation frame at the **AudioContext's** time; full mode's
  `frame()` writes the custom properties on each row's `.wave` (a ghost canvas, a riser line, the
  ruler's riser).
- **The desktop** (sssketch): `DiscoverPanel` builds the log every tick from what is armed (as
  `radioFlashTick` does), on the readout's clock (bars played), and the playhead's layout effect
  writes the custom properties at every position tick on each row's waveform cell and the top
  line's ruler.
- **No engine, wire format, reducer decision or draw changes.** Visuals only read what is already
  scheduled. Nothing here can change what either radio plays.

**Phases** (each ends at a ship point; deploy only with Elling's go-ahead):
1. **Shared** (Tasks 1-2): the helper and the flash fades. Inert until a runtime calls them.
2. **The web** (Tasks 3-5): the log, full mode's rows, headless screenshots. Ship point A.
3. **The desktop** (Tasks 6-7). Ship point B.
4. Review, handoff, walkthrough (Task 8).

**Tech Stack:** TypeScript and vitest (both repos), React and Electron (sssketch), plain DOM, CSS
custom properties and canvas (ell.ing/radio).

**Repos:**
- **sssketch** (`/Users/nickel/Claudecode/sssketch`): Tasks 1, 2, 6, 7, 8. Base: `master` at this
  plan's commit. The shared code was written against `453bfb49`'s `src/shared`; the files it
  touches (`radioReadout.ts`, `radioRowPlates.ts`) and reads (`radioTurnaround.ts`,
  `radioTransition.ts`, `radioDropOut.ts`) are unchanged up to `14196c41`.
- **ell.ing/radio** (`/Users/nickel/Claudecode/ell.ing/radio`): Tasks 3, 4, 5. The web code was
  written against `4fde28f`; the web's own HEAD has moved on (see Sequencing).
- **How the two connect.** The web imports sssketch's `src/shared` through `@shared`, from
  sssketch's working tree (or `SSSKETCH_DIR`). Tasks 1-2 are additive: the web's
  `npm run typecheck` (with `noUnusedLocals`) and every web test stay green with them in
  (checked: see below).

**Branches:** `radio-move-visuals` in each repo (`git switch -c radio-move-visuals`), cut from
wherever the work in Sequencing has landed.

**Commits:** every commit message ends with exactly these two lines, after a blank line:

```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz
```

Commit each task's own files only (`git add <paths>` or `git commit --only <paths>`), never
`git add -A`. Other agents share these working trees.

**Before you start, in both repos:**
- Run `git status --short`. Note other agents' files and leave them alone.
- **sssketch:** `npm test` and `npm run typecheck`. Green except the machine-dependent
  engine-spawn tests (memory `coreaudiod_thread_leak`; in a checkout with no
  `native-engine/build`, "binary not found").
- **ell.ing/radio:** `npx vitest run` and `npm run typecheck`. The repo-wide `testTimeout` is 30 s.
- Nothing in this plan opens better-sqlite3, so `vitest.config.ts`'s CI exclude list is untouched.
- **Anchors, not line numbers.** `DiscoverPanel.tsx`, `controller.ts`, `full.ts` and `main.ts`
  change daily. Every runtime instruction names a function and quotes its context; line numbers
  are today's guide only.

---

## Sequencing: start after the intensity arc and the simple view

**Order.** This plan starts after:
1. **The intensity arc's UI tasks.** Web Task 7 (the reducer) landed as `82d3a53` and its review
   fixes (`75a52e8`, `51d3c41`, `483fc01`, `9182ad8`, `a0c0cb2`). **Web Task 8 (full mode) is in
   progress** in `src/ui` (`full.ts`, `full.css`, `fullModel.ts` + test, `main.ts`,
   `controller.ts`): wait for its commit. Desktop Task 10 and **Task 11** landed (`6b57ace0`,
   `7ede0231`).
2. **The radio simple / advanced view** (spec b89face5): landed in sssketch as `91db983e`,
   `2a450796`, `99a28ce6`, `98381e13`, `d4dcb64a` (`@shared/radioView`, `radioRowParts`,
   `DiscoverSlotRow`'s conditional parts, `RadioTopLine`'s switch). The web has no simple /
   advanced split of its own (its simple mode is a different thing: see decision 12).

Tasks 1-2 (shared, additive, new files and an optional parameter) may start at once; they touch
no file the work above is changing. Tasks 3-7 wait for web Task 8 and, on the desktop, rebase onto
whatever has landed.

**File overlaps:**

| file | who else touched it | what this plan does there | how to merge |
|---|---|---|---|
| sssketch `src/shared/radioReadout.ts` | intensity T5 (readout states, `narrow`) | Task 2: `RadioFlash.until`, `radioFlashShown`'s and `pruneRadioFlashes`' optional fade, two constants (the flash section only) | Additive; the diff below applies to `14196c41`. |
| sssketch `src/shared/radioRowPlates.ts` | radio view plan | Task 2: the flash's `opacity` when the readout carries one | One expression. |
| web `src/radio/controller.ts` | intensity T7 (`arcLanding`, `arcPhase`), T8 (`view({ narrow })`, setters) | Task 3: the visuals log beside the flash log; `until` on move flashes | Additive; anchored on `flash()`, `throwNow`, `land`, `hookSwap`, `hookRest`, `arcLanding`, `addRow`, `removeRow`, the `turnaround` / `cancel*` / `stop` cases. |
| web `src/radio/step.ts` | intensity T7 + review fixes (75a52e8 ... a0c0cb2) | Task 3: one line in `describe` (`radioFlashShown`'s fade) | One line, anchored on `flash: radioFlashShown(flashes, r.id, t.now, barSec)`. |
| web `src/ui/full.ts`, `full.css` | intensity T8 (density chips, dials, build / drop, rests' words) | Task 4: `makeRow` (ghost, riser), `draw` (the ghost copy; a resting row in ink), `frame` (the custom properties), the ruler's riser; CSS for both | T8 adds strip controls and the row's role words; this plan touches the row's `.wave`, `draw`, `frame` and `.ruler`. Rebase onto T8, re-anchor by function. |
| web `src/ui/fullModel.ts` (+ test) | intensity T8 | Task 4: `FullRow.resting` only if T8 did not add it | Check T8's `FullRow` first. |
| web `src/main.ts` | intensity T8 (`view(narrow)`, density prefs) | Task 4: one argument on the `full.frame(...)` call | One call. |
| web `src/ui/palette.test.ts` | nobody | Task 4: the wash's blur is the one other filter | Diff below. |
| sssketch `DiscoverPanel.tsx` | intensity T10, T11; simple view (`radioView` state, the switch) | Task 6: the move log tick beside `radioFlashTick`; `until` on its flashes; the readout's fade. Task 7: the layout effect writes the properties; the rows' `radioResting` prop; `<style>` rules; the top line's riser ref | Additive; anchored on `radioFlashTick`, `radioReadoutFrom`, the sweep layout effect, the row render, `<RadioTopLine`, the panel's `<style>`. |
| sssketch `DiscoverSlotRow.tsx` | simple view (`radioView`, `radioRowParts`, the lock mark) | Task 7: the waveform cell's `data-move-row`, the coloured layer's class, a ghost layer, a riser line; the coloured layer also for a resting row | The waveform cell is outside `radioRowParts` (the button line's parts): simple and advanced both draw it, so the moves show in both views with no `radioView.ts` change. |
| sssketch `RadioTopLine.tsx` | simple view (the switch beside undo / redo) | Task 7: a `riserRef` and the riser line under the ruler | The ruler is drawn in both views. |

**The simple view and this plan.** `radioView.ts` decides the button line's parts and the strip's
controls; the moves live in the waveform cell and the ruler, which both views keep. So
`radioView.test.ts`'s pinned lists need nothing. Check after rebasing that `DiscoverSlotRow`'s
waveform cell is still one element in both views (the simple view's "no remounts" rule).

---

## How this plan's code was checked

Planning scratchpad:
`/private/tmp/claude-501/-Users-nickel-Claudecode-sssketch/16705ad5-406f-4f11-81e4-e91aab27bbc8/scratchpad/move-visuals/`

| folder | what it is |
|---|---|
| `sssketch/` | sssketch at `453bfb49` (`git archive`), with Tasks 1 and 2 applied |
| `web/` | ell.ing/radio at `4fde28f`, `@shared` pointed at `../sssketch`, with Task 4's `moveFrame.ts` (+ test), `full.ts`, `full.css` and `palette.test.ts` applied |
| `shots/` | Task 5's harness (`index.html`, `harness.ts`, `run.mjs`) and its output (`out/*.png`, `out/measure.txt`) |
| `*.orig.*`, `*.diff` | the untouched files and the diffs quoted below |

- **Every code block below is the scratch copy's file or diff, verbatim**, for Tasks 1, 2 and 4's
  pure and page parts, and Task 5's harness.
- **sssketch, Tasks 1-2 in:**
  - `npm run typecheck` (node and web): clean;
  - `npx vitest run src/shared`: **176 files, 2933 tests passed** (174 files and 2890 tests
    without them);
  - `radioFlashFades.test.ts` against the unmodified `radioReadout.ts`: 5 of its 7 tests fail (red
    first, as TDD wants); `radioMoveVisuals.test.ts` cannot load without its module;
  - `eslint` and `prettier --check` on every changed file: clean.
- **The web against Tasks 1-2:** `npm run typecheck` clean, `npx vitest run src`: 870 passed. One
  file fails to load (`src/fluoddity.test.ts`, `@fluoddity/embed.js`): its alias reaches outside a
  scratch copy, so that is the copy, not the code. With Task 4's files in: `npx tsc --noEmit`
  clean, `src/ui` 23 files, 171 tests passed (palette.test.ts's amended rule included; without the
  amendment it fails on the wash's blur, as it should).
- **Screenshots:** Task 5's harness ran against the scratch `web/` (Chrome over CDP, the viewport
  at 320 and 390 px, light and dark, plus nothing sounding and reduced motion): every row shows
  its move, nothing at rest, no horizontal scroll (`scrollWidth` 320 / 390). Findings it forced:
  headless Chrome will not open a window under 500 px (`--window-size` is ignored below that),
  hence CDP's `Emulation.setDeviceMetricsOverride`; the ghost is the faintest look (risk 4).
- **The diffs apply:** `radioReadout.ts` and `radioRowPlates.ts` to sssketch `14196c41`
  (`git apply --check`); `full.ts`, `full.css` and `palette.test.ts` to ell.ing/radio `4fde28f`.
  Against the web's working tree with Task 8 in progress, `full.ts`'s import hunk no longer
  applies (Task 8 adds imports there): re-apply by hand, anchored on the functions.
- **Not compiled, written as precise instructions:** the runtime glue: Task 3 (`controller.ts`,
  one line of `step.ts`), Task 4's `main.ts` line and `FullRow.resting`, Tasks 6-7
  (`DiscoverPanel.tsx`, `DiscoverSlotRow.tsx`, `RadioTopLine.tsx`). They change daily.
- **No agent can hear either radio, see the desktop app or hold a phone.** The web's look was seen
  in headless Chrome only, on synthetic peaks. Nothing here claims more.

## Decisions made in planning

1. **A log of visuals per runtime, rebuilt from the shared builders.** Each runtime logs a move's
   visuals when it schedules it, with the shared adapters calling the same builders its engine
   plays (`turnaroundDropCurve` and the plan's merged rows; `buildDropOutCurve`,
   `buildFilterInCurve`, `buildBloomCurve`, `buildDuckCurve`, `buildTransitionRiser`). Not read
   back from the web engine's timed plans: those are in Hz and absolute sends, and the desktop has
   no such readback, so the two radios would drift apart. A gesture is logged as the engine
   **answered** it (`scheduleSwap(...).kind`: a lead-in with no room is a cut, and shows nothing).
2. **Clocks.**
   - The web logs in AudioContext seconds and reads `engine.now` every animation frame (the clock
     the playhead already uses), not the controller's ~30 Hz tick.
   - The desktop logs on the readout's clock (bars played since radio started:
     `radioPlayRef.startBars + pos`) and reads at every position tick, in the sweep layout effect,
     with the fold dots' trick for the wrap: the tick's snapshot carries the lap count it was taken
     at (`radioFoldMoveRef.current.laps`), and the effect adds `(laps now - laps then) * loopBars`.
     So it updates at the position stream's rate (~30 Hz), as its playhead does.
3. **Composition.** Volumes multiply (both engines multiply a turnaround's drop into a hole or a
   duck); filter thinning, wash, riser and ghost take the strongest. Rests are volume curves (0
   from the line). The drop closes the breakdown's rests on the same one the gap ends on, so every
   row comes back together; a hook's rest is its own and stays. Tested.
4. **Quick fades.** A move's way **in** is never quicker than `RADIO_VISUAL_FADE_SEC` (100 ms on the
   runtime's clock; a drop's own ramp is ~40 ms), so a dim reads as a fade, not a cut. Its way
   **out**, on the one, stays a step, so the one is seen on the beat. Flash words: in over
   `RADIO_FLASH_FADE_IN_SEC` (100 ms), on until the move's end (`until`), out over
   `RADIO_FLASH_FADE_OUT_SEC` (150 ms). A moment's word (hook out, dig, no fave fits, breakdown,
   drop, build) has no `until`: on for its window (one bar), then the same 150 ms. This replaces
   the sine over a bar for every word, which is the spec's "replacing today's long fade".
5. **Brightness.** Silent is 25% (`RADIO_VISUAL_DIM_FLOOR`), linear to full: a duck's 0.45 reads
   59%.
6. **Filters as height.** A lift (high-pass: the lows go) thins the waveform's **lower** half, a dip
   or a filter in (low-pass: the highs go) its **upper** half, by a mask gradient up to 85% at the
   bold move's extreme (`TURNAROUND_LIFT_TOP`, `TURNAROUND_DIP_FLOOR`); a subtle move thins less.
7. **The wash is a blur on the waveform only** (up to 2 px on the web's canvas, 1.5 px on the
   desktop's coloured layer). sssketch's `tokens.css` says "no gradients on chrome, no glow, no
   blur": the waveform is audio information, not chrome, and the spec Elling approved names "a
   soft glow or blur". The web's `palette.test.ts` ("nothing else on the page is filtered") is
   amended to allow exactly this blur. If Elling reads it as against the system, the fallback is a
   spread (a second copy scaled vertically, no filter): one CSS rule per runtime.
8. **The riser.** A turnaround's riser is its own voice, no row's: a line under the ruler (both
   radios). A change's riser announces that row's change: a line along that row's foot. Both fill
   from left to right toward the one, and are gone the moment it ends (the gap's start, or the
   one).
9. **The ghost.** A copy of the waveform over it, trailing by one repeat's delay, floored at 6 px
   (a dotted eighth is ~0.2 bars, a couple of pixels on a 32-bar window), at `0.45 x` the echo's
   level, clipped to the row. The repeats decay by `feedback` each; drawn gone under 5%.
10. **Reduced motion** (`prefers-reduced-motion: reduce`): steady states. Fades off (`fade` 0); a
    row silent for most of the moment sits at the floor, else full; a filter move is one steady
    60% thinning for its length; no wash, riser line or ghost (`radioRowVisualSteady`). Flash
    words keep their fades (a fade is not motion).
11. **A rest is a move, a mute is yours.** A row resting for radio (a hook's rest, the arc's
    breakdown) is drawn in ink (web) / with its coloured layer (desktop) at the dim floor, instead
    of faint / grey, so it fades with the music and reads differently from a mute, which stays
    faint / grey. The state is the truth: a row the view says is resting is dimmed even with no
    rest logged (a page loaded mid-rest, a missed landing).
12. **Simple modes.** The web's simple mode has no rows (four corner words over Fluoddity, which
    already follows the audio): it gets nothing. Ask Elling whether he wants anything there (a
    whispered move word, say). The desktop's simple view keeps the waveform cell and the ruler, so
    it shows every move as advanced does.
13. **Take-backs.**
    - The web drops a key's visuals the moment its move is taken back (`cancelTurnaround`, a
      `cancel`, `cancelThrow`), as its flashes; its audio glides back in the same breath.
    - The desktop reads what is armed every tick (`live` keys): a key gone drops its visuals
      **even mid-move** (its curve left the project with the push), except an echo already ringing
      (a throw's key goes when its send closes; the echo rings on).
    - A rest closed by a decided return (`closeRadioRestVisuals`) opens again if that return is
      taken back (`reopenRadioRestVisuals`). The web's 75a52e8 made a joining return never taken
      back, so this is a guard, not a path.
14. **A duck dips the rows the engine dips.** The web: every row with a stem at the wrap but the
    changing one; another row's change landing on the same wrap removes that row's duck visual
    (`Gestures.apply` skips rows changing on the wrap). The desktop: `previewingSlotIdsRef` minus
    the gesture's `slotId` and its `spares`, as the lane build does.
15. **Cost.** One evaluation per row per frame (web) or tick (desktop), only while
    `radioMoveVisualsSounding` (or a row rests). Otherwise the properties are cleared once and
    nothing runs. The CSS rules hang on `[data-mv]`, set only while a move sounds, so an idle row
    has no mask, filter or extra compositing.

## File map

**sssketch `src/shared/`**
- Create: `radioMoveVisuals.ts`, `radioMoveVisuals.test.ts` (T1); `radioFlashFades.test.ts` (T2).
- Modify: `radioReadout.ts`, `radioRowPlates.ts` (T2).

**ell.ing/radio**
- `src/radio/controller.ts` (+ `controller.test.ts`), `src/radio/step.ts` (one line) (T3).
- `src/ui/moveFrame.ts`, `src/ui/moveFrame.test.ts` (new), `src/ui/full.ts`, `src/ui/full.css`,
  `src/ui/palette.test.ts`, `src/main.ts`, maybe `src/ui/fullModel.ts` (+ test) (T4).
- No repo file for T5 (the harness lives in the scratchpad; see Task 5).

**sssketch desktop**
- `src/renderer/src/components/DiscoverPanel.tsx` (T6, T7).
- `src/renderer/src/components/DiscoverSlotRow.tsx`, `RadioTopLine.tsx` (T7).

## Task graph

```
Phase 1  T1 radioMoveVisuals ─┐
         T2 flash fades ──────┤   (both may start now: additive)
Phase 2  (web T8 lands) ─> T3 controller log ─> T4 full mode ─> T5 screenshots ── ship point A
Phase 3  (desktop T10/T11 + simple view: landed) ─> T6 panel log ─> T7 rows + top line ── ship point B
Last     all ─> T8 review, handoff, walkthrough
```

- T1 and T2 are independent of each other and of everything in Sequencing.
- T3 needs T1 and T2 and web Task 8's commit. T6 needs T1 and T2.
- The web phase (T3-T5) and the desktop phase (T6-T7) run in parallel.
- T2 crosses repos only by reading: the web keeps today's flash look until T3 passes the fade.

---

## Phase 1: shared

### Task 1: The helper (`radioMoveVisuals.ts`)

**Repo:** sssketch. **Parallel-safe.** **Depends on:** nothing.

**Files:**
- Create: `src/shared/radioMoveVisuals.ts`, `src/shared/radioMoveVisuals.test.ts`

- [ ] **Step 1: Write the failing test.** Create `src/shared/radioMoveVisuals.test.ts`:

```ts
// Radio's moves shown while they sound (spec 2026-10-05-radio-move-visuals-design): the shared
// helper against known plan curves, on both radios' clocks (the web's seconds, sssketch's bars).
import { describe, expect, it } from 'vitest'
import {
  RADIO_ROW_VISUAL_REST,
  RADIO_VISUAL_DIM_FLOOR,
  RADIO_VISUAL_ECHO_FLOOR,
  RADIO_VISUAL_STEADY_CUT,
  closeRadioRestVisuals,
  dropRadioMoveVisuals,
  pruneRadioMoveVisuals,
  radioGestureVisuals,
  radioMoveVisualsSounding,
  radioRestVisual,
  radioRowVisualAt,
  radioRowVisualSteady,
  radioRowVisualVars,
  radioThrowVisual,
  radioTurnaroundVisuals,
  radioVisualBrightness,
  reopenRadioRestVisuals,
  type RadioMoveVisual,
  type RadioRowVisual
} from './radioMoveVisuals'
import {
  TURNAROUND_DIP_FLOOR,
  TURNAROUND_LIFT_TOP,
  turnaroundDipCurve,
  turnaroundDropCurve,
  turnaroundLiftCurve,
  turnaroundWashCurve,
  type TurnaroundPlan
} from './radioTurnaround'

// sssketch's clock: bars played since radio started; one beat is a quarter bar
const BARS = { unitsPerBeat: 0.25 }
// the web's: AudioContext seconds at 120 bpm, half a second a beat
const SEC = { unitsPerBeat: 0.5 }
const at = (
  v: readonly RadioMoveVisual[],
  row: string | null,
  t: number,
  fade = 0
): RadioRowVisual => radioRowVisualAt(v, row, t, fade)

describe('a drop (drums out, low out, stop)', () => {
  // an 8-bar loop, drums out for the last 4 beats, ending on the wrap at bar 64
  const plan: TurnaroundPlan = {
    move: 'drum drop',
    beats: 4,
    halvings: 0,
    rows: [{ rowId: 'drums', volume: turnaroundDropCurve(8, 4) }]
  }
  const v = radioTurnaroundVisuals(plan, { wrapAt: 64, loopBars: 8, key: 'ta', ...BARS })

  it('is level 1 before, 0 while it sounds, and 1 on the one', () => {
    expect(at(v, 'drums', 62).level).toBe(1)
    expect(at(v, 'drums', 63).level).toBe(1) // the drop leaves at bar 63
    expect(at(v, 'drums', 63.5).level).toBe(0)
    expect(at(v, 'drums', 63.999).level).toBe(0)
    expect(at(v, 'drums', 64).level).toBe(1)
    expect(at(v, 'drums', 65).level).toBe(1)
  })

  it('touches no other row', () => {
    expect(at(v, 'bass', 63.5)).toEqual(RADIO_ROW_VISUAL_REST)
    expect(at(v, null, 63.5)).toEqual(RADIO_ROW_VISUAL_REST)
  })

  it('dims over the fade (never quicker), and is back on the one at once', () => {
    // the drop's own ramp is 0.02 bars; a 0.05-bar fade (0.1 s at 120 bpm) stretches it
    const fade = 0.05
    expect(at(v, 'drums', 63.025, fade).level).toBeCloseTo(0.5, 6)
    expect(at(v, 'drums', 63.05, fade).level).toBe(0)
    expect(at(v, 'drums', 63.999, fade).level).toBe(0)
    expect(at(v, 'drums', 64, fade).level).toBe(1)
  })

  it('lands on the web clock the same way (seconds before the wrap)', () => {
    const w = radioTurnaroundVisuals(plan, { wrapAt: 100, loopBars: 8, key: 'ta', ...SEC })
    expect(at(w, 'drums', 97.9).level).toBe(1) // leaves 2 s (4 beats) before
    expect(at(w, 'drums', 99).level).toBe(0)
    expect(at(w, 'drums', 100).level).toBe(1)
  })
})

describe('lift and dip', () => {
  const plan: TurnaroundPlan = {
    move: 'lift',
    beats: 8,
    halvings: 0,
    rows: [
      { rowId: 'pad', filter: turnaroundLiftCurve(8) },
      { rowId: 'lead', filter: turnaroundDipCurve(8) }
    ]
  }
  const v = radioTurnaroundVisuals(plan, { wrapAt: 32, loopBars: 8, key: 'ta', ...BARS })

  it('a lift thins the low end with the high-pass: 0 at its start, half way, all of it into the one', () => {
    expect(at(v, 'pad', 30).lowCut).toBe(0)
    expect(at(v, 'pad', 31).lowCut).toBeCloseTo(0.5, 9)
    expect(at(v, 'pad', 31.999).lowCut).toBeCloseTo(1, 2)
    expect(at(v, 'pad', 32).lowCut).toBe(0)
    expect(at(v, 'pad', 31).highCut).toBe(0)
    expect(at(v, 'pad', 31).level).toBe(1)
  })

  it('a dip thins the top with the low-pass, the same way', () => {
    expect(at(v, 'lead', 30).highCut).toBe(0)
    expect(at(v, 'lead', 31).highCut).toBeCloseTo(0.5, 9)
    expect(at(v, 'lead', 31.999).highCut).toBeCloseTo(1, 2)
    expect(at(v, 'lead', 32).highCut).toBe(0)
    expect(at(v, 'lead', 31).lowCut).toBe(0)
  })

  it('a subtle lift or dip thins less', () => {
    const subtle = radioTurnaroundVisuals(
      {
        ...plan,
        rows: [
          { rowId: 'pad', filter: turnaroundLiftCurve(8, 0.35) },
          { rowId: 'lead', filter: turnaroundDipCurve(8, 0.6) }
        ]
      },
      { wrapAt: 32, loopBars: 8, key: 'ta', ...BARS }
    )
    expect(at(subtle, 'pad', 31.999).lowCut).toBeCloseTo(0.35 / TURNAROUND_LIFT_TOP, 2)
    expect(at(subtle, 'lead', 31.999).highCut).toBeCloseTo(0.4 / (1 - TURNAROUND_DIP_FLOOR), 2)
  })
})

describe('the wash', () => {
  it('grows to its peak into the one, and clears on it', () => {
    const plan: TurnaroundPlan = {
      move: 'wash',
      beats: 8,
      halvings: 0,
      rows: [{ rowId: 'pad', reverbSend: turnaroundWashCurve(8) }]
    }
    const v = radioTurnaroundVisuals(plan, { wrapAt: 32, loopBars: 8, key: 'ta', ...BARS })
    expect(at(v, 'pad', 30).wash).toBe(0)
    expect(at(v, 'pad', 31).wash).toBeCloseTo(0.5, 9)
    expect(at(v, 'pad', 31.999).wash).toBeCloseTo(1, 2)
    expect(at(v, 'pad', 32).wash).toBe(0)
  })

  it('held from the gap: the peak where the row goes silent, held to the one', () => {
    // materialize's holdFrom: a wash on a gapped row peaks at the gap's start (2 beats out)
    const plan: TurnaroundPlan = {
      move: 'riser',
      beats: 8,
      halvings: 0,
      gapBeats: 2,
      riserBars: 1.5,
      rows: [
        {
          rowId: 'pad',
          reverbSend: {
            peak: 0.85,
            points: [
              { beats: 8, value: 0 },
              { beats: 2, value: 1 },
              { beats: 0, value: 1 },
              { beats: 0, value: 0 }
            ]
          },
          volume: turnaroundDropCurve(8, 2)
        }
      ],
      parts: [
        { move: 'riser', beats: 8, rowIds: [] },
        { move: 'wash', beats: 8, rowIds: ['pad'] }
      ]
    }
    const v = radioTurnaroundVisuals(plan, { wrapAt: 32, loopBars: 8, key: 'ta', ...BARS })
    expect(at(v, 'pad', 31.5).wash).toBeCloseTo(1, 9) // the gap's start
    expect(at(v, 'pad', 31.9).wash).toBe(1)
    expect(at(v, 'pad', 31.9).level).toBe(0) // silent in the gap, still washed
    expect(at(v, 'pad', 32)).toEqual(RADIO_ROW_VISUAL_REST)
  })
})

describe('a riser into a gap', () => {
  // riser + drums out, a 2-beat gap: the riser sounds 1.5 bars and stops where the gap starts;
  // every row but the keeper is silent through the gap
  const plan: TurnaroundPlan = {
    move: 'riser',
    beats: 8,
    halvings: 0,
    riserBars: 1.5,
    gapBeats: 2,
    keeperId: 'pad',
    rows: [
      { rowId: 'drums', volume: turnaroundDropCurve(8, 4) },
      { rowId: 'bass', volume: turnaroundDropCurve(8, 2) }
    ],
    parts: [
      { move: 'riser', beats: 8, rowIds: [] },
      { move: 'drum drop', beats: 4, rowIds: ['drums'] }
    ]
  }
  const v = radioTurnaroundVisuals(plan, {
    wrapAt: 32,
    loopBars: 8,
    key: 'ta',
    lateRowIds: ['late'],
    ...BARS
  })

  it('draws the riser on the mix, from its start to the gap', () => {
    expect(at(v, null, 29.9).riser).toBe(0)
    expect(at(v, null, 30).riser).toBe(0) // starts 2 bars out
    expect(at(v, null, 30.75).riser).toBeCloseTo(0.5, 9)
    expect(at(v, null, 31.499).riser).toBeCloseTo(1, 2)
    expect(at(v, null, 31.5).riser).toBe(0) // the gap
    expect(at(v, 'drums', 30.75).riser).toBe(0) // never on a row
  })

  it('dims every silenced row through the gap, the keeper heard, and the one brings all back', () => {
    for (const row of ['drums', 'bass', 'late']) expect(at(v, row, 31.75).level).toBe(0)
    expect(at(v, 'pad', 31.75).level).toBe(1)
    for (const row of ['drums', 'bass', 'late', 'pad']) expect(at(v, row, 32).level).toBe(1)
    expect(at(v, 'drums', 31.25).level).toBe(0) // its own longer drop
    expect(at(v, 'bass', 31.25).level).toBe(1)
  })
})

describe('gestures', () => {
  const lap = { loopBars: 8, unitsPerBar: 1 }
  const base = { rowId: 'r1', wrapAt: 64, before: lap, after: lap, key: 'r1@64' }

  it('a cut is nothing', () => {
    expect(radioGestureVisuals({ ...base, kind: 'cut', beats: 0 })).toEqual([])
  })

  it('a hole dims the outgoing row into the wrap; the new stem is full on it', () => {
    const v = radioGestureVisuals({ ...base, kind: 'hole', beats: 8 })
    expect(at(v, 'r1', 61.9).level).toBe(1)
    expect(at(v, 'r1', 63).level).toBe(0)
    expect(at(v, 'r1', 64).level).toBe(1)
  })

  it('the arc exit drop-out the same, on the row leaving', () => {
    const v = radioGestureVisuals({ ...base, kind: 'drop-out', beats: 8 })
    expect(v[0].move).toBe('drop-out')
    expect(at(v, 'r1', 63).level).toBe(0)
  })

  it('a filter in arrives closed and opens over its beats', () => {
    const v = radioGestureVisuals({ ...base, kind: 'filter in', beats: 4 })
    expect(at(v, 'r1', 63.9).highCut).toBe(0)
    expect(at(v, 'r1', 64).highCut).toBe(1) // stacked, no fade: closed on the wrap
    expect(at(v, 'r1', 64.05, 0.05).highCut).toBe(1) // with the fade, closed once it has faded in
    expect(at(v, 'r1', 64.5).highCut).toBeCloseTo(0.5 / (1 - TURNAROUND_DIP_FLOOR), 9)
    expect(at(v, 'r1', 65).highCut).toBe(0)
  })

  it('a bloom arrives washed and clears', () => {
    const v = radioGestureVisuals({ ...base, kind: 'bloom', beats: 4 })
    expect(at(v, 'r1', 64).wash).toBe(1)
    expect(at(v, 'r1', 64.5).wash).toBeCloseTo(0.5, 9)
    expect(at(v, 'r1', 65).wash).toBe(0)
  })

  it('a duck dips every other row for its beats, not the arriving one', () => {
    const v = radioGestureVisuals({ ...base, kind: 'duck', beats: 4, duckRowIds: ['r2', 'r3'] })
    expect(at(v, 'r1', 64).level).toBe(1)
    expect(at(v, 'r2', 64).level).toBeCloseTo(0.45, 9)
    expect(at(v, 'r3', 64.5).level).toBeCloseTo(0.725, 9)
    expect(at(v, 'r2', 65).level).toBe(1)
  })

  it("a change's riser is drawn on the row it announces, ending on the wrap", () => {
    const v = radioGestureVisuals({ ...base, kind: 'riser', beats: 8 })
    expect(at(v, 'r1', 61.9).riser).toBe(0)
    expect(at(v, 'r1', 63).riser).toBeCloseTo(0.5, 9)
    expect(at(v, 'r1', 64).riser).toBe(0)
    expect(at(v, null, 63).riser).toBe(0)
  })

  it('a lead-in measures in the lap before the wrap, an arrival in the lap after (a tempo change on the wrap)', () => {
    const v = radioGestureVisuals({
      ...base,
      kind: 'hole',
      beats: 4,
      wrapAt: 100,
      before: { loopBars: 4, unitsPerBar: 2 },
      after: { loopBars: 4, unitsPerBar: 1.5 }
    })
    expect(at(v, 'r1', 97.9).level).toBe(1)
    expect(at(v, 'r1', 99).level).toBe(0)
    const d = radioGestureVisuals({
      ...base,
      kind: 'duck',
      beats: 4,
      wrapAt: 100,
      duckRowIds: ['r2'],
      before: { loopBars: 4, unitsPerBar: 2 },
      after: { loopBars: 4, unitsPerBar: 1.5 }
    })
    expect(at(d, 'r2', 101.5).level).toBe(1) // one bar of 1.5 s after the wrap
  })
})

describe('a throw', () => {
  // 120 bpm on the web: a quarter-note echo (0.5 s), the send open a beat, feedback 0.5
  const v = radioThrowVisual({
    rowId: 'pad',
    at: 10,
    open: 0.5,
    delay: 0.5,
    feedback: 0.5,
    shiftBars: 0.25,
    key: 'throw@10'
  })!

  it('ghosts the row from its first repeat, fading with each one, and trails it by a delay', () => {
    expect(at([v], 'pad', 10.4).ghost).toBe(0)
    expect(at([v], 'pad', 10.6).ghost).toBe(1)
    expect(at([v], 'pad', 10.6).ghostShiftBars).toBe(0.25)
    expect(at([v], 'pad', 11.5).ghost).toBeCloseTo(0.5, 9)
    expect(at([v], 'pad', 12).ghost).toBeCloseTo(0.25, 9)
    expect(at([v], 'pad', 30).ghost).toBe(0)
    expect(at([v], 'pad', 10.6).level).toBe(1) // never dims the row
  })

  it('ends once a repeat is under the floor', () => {
    const last = v.points[v.points.length - 1]
    expect(last.value).toBe(0)
    expect(v.points[v.points.length - 2].value).toBeGreaterThanOrEqual(RADIO_VISUAL_ECHO_FLOOR)
  })

  it('is nothing for a throw that cannot echo', () => {
    expect(
      radioThrowVisual({
        rowId: 'p',
        at: 0,
        open: 0,
        delay: 1,
        feedback: 0.5,
        shiftBars: 0,
        key: 'k'
      })
    ).toBeNull()
    expect(
      radioThrowVisual({
        rowId: 'p',
        at: 0,
        open: 1,
        delay: 1,
        feedback: 1,
        shiftBars: 0,
        key: 'k'
      })
    ).toBeNull()
  })
})

describe('rests: hooks and the intensity arc, with the drop', () => {
  // the breakdown rests drums and bass from bar 32; a hook rests the lead from 40; the drop at
  // bar 64 brings drums and bass back under a riser and a gap that silences pad (no keeper)
  const drop: TurnaroundPlan = {
    move: 'riser',
    beats: 16,
    halvings: 0,
    riserBars: 3.5,
    gapBeats: 2,
    rows: [{ rowId: 'pad', volume: turnaroundDropCurve(8, 2) }],
    parts: [{ move: 'riser', beats: 16, rowIds: [] }]
  }
  const open = [
    radioRestVisual({ rowId: 'drums', from: 32, until: null, key: 'arc@32' }),
    radioRestVisual({ rowId: 'bass', from: 32, until: null, key: 'arc@32' }),
    radioRestVisual({ rowId: 'lead', from: 40, until: null, key: 'lead@40' })
  ]

  it('a rest dims its row from its line, and holds while it is open', () => {
    expect(at(open, 'drums', 31.9).level).toBe(1)
    expect(at(open, 'drums', 32).level).toBe(0)
    expect(at(open, 'drums', 500).level).toBe(0)
    expect(at(open, 'lead', 39).level).toBe(1)
    expect(radioMoveVisualsSounding(open, 500)).toBe(true)
  })

  it('fades in over the fade', () => {
    expect(at(open, 'drums', 32.025, 0.05).level).toBeCloseTo(0.5, 9)
    expect(at(open, 'drums', 32.05, 0.05).level).toBe(0)
  })

  it('the drop: the rests close on its one, the gap dims the rest, and the one brings everything back at once', () => {
    let v = closeRadioRestVisuals(open, 'drums', 64)
    v = closeRadioRestVisuals(v, 'bass', 64)
    v = [...v, ...radioTurnaroundVisuals(drop, { wrapAt: 64, loopBars: 8, key: 'ta@64', ...BARS })]
    expect(at(v, 'drums', 63.9).level).toBe(0)
    expect(at(v, 'bass', 63.9).level).toBe(0)
    expect(at(v, 'pad', 63.9).level).toBe(0) // the gap
    expect(at(v, 'pad', 63).level).toBe(1)
    expect(at(v, null, 62).riser).toBeGreaterThan(0)
    for (const row of ['drums', 'bass', 'pad']) expect(at(v, row, 64).level).toBe(1)
    expect(at(v, 'lead', 64).level).toBe(0) // the hook's rest is its own
  })

  it('a duck on a resting row multiplies: still silent', () => {
    const v = [
      ...open,
      ...radioGestureVisuals({
        kind: 'duck',
        rowId: 'pad',
        beats: 4,
        wrapAt: 48,
        before: { loopBars: 8, unitsPerBar: 1 },
        after: { loopBars: 8, unitsPerBar: 1 },
        duckRowIds: ['drums', 'lead'],
        key: 'pad@48'
      })
    ]
    expect(at(v, 'drums', 48).level).toBe(0)
  })

  it('a return taken back opens the rest again', () => {
    const closed = closeRadioRestVisuals(open, 'lead', 56)
    expect(at(closed, 'lead', 57).level).toBe(1)
    const again = reopenRadioRestVisuals(closed, 'lead', 56)
    expect(at(again, 'lead', 57).level).toBe(0)
    expect(again).toEqual(open)
  })

  it('a rest closed where it began is gone', () => {
    expect(closeRadioRestVisuals(open, 'lead', 40).filter((v) => v.rowId === 'lead')).toEqual([])
  })

  it('a closed rest from the start: silent between, heard after', () => {
    const v = [radioRestVisual({ rowId: 'r', from: 8, until: 16, key: 'k' })]
    expect(at(v, 'r', 12).level).toBe(0)
    expect(at(v, 'r', 16).level).toBe(1)
  })
})

describe('the log', () => {
  const plan: TurnaroundPlan = {
    move: 'drum drop',
    beats: 4,
    halvings: 0,
    rows: [{ rowId: 'drums', volume: turnaroundDropCurve(8, 4) }]
  }
  const ta = radioTurnaroundVisuals(plan, { wrapAt: 64, loopBars: 8, key: 'ta@64', ...BARS })
  const rest = radioRestVisual({ rowId: 'lead', from: 40, until: null, key: 'rest@lead' })

  it('a take-back drops its key', () => {
    expect(dropRadioMoveVisuals([...ta, rest], 'ta@64')).toEqual([rest])
  })

  it('prunes what is over, keeps what is to come and what holds', () => {
    expect(pruneRadioMoveVisuals([...ta, rest], 64.5)).toEqual([rest])
    expect(pruneRadioMoveVisuals([...ta, rest], 50)).toEqual([...ta, rest])
  })

  it('given the live keys: a move whose key is gone goes, sounding or not; an echo already ringing rings on', () => {
    const none = new Set<string>()
    expect(pruneRadioMoveVisuals([...ta, rest], 50, none)).toEqual([])
    expect(pruneRadioMoveVisuals([...ta, rest], 63.5, none)).toEqual([])
    expect(pruneRadioMoveVisuals([...ta, rest], 63.5, new Set(['rest@lead']))).toEqual([rest])
    const echo = radioThrowVisual({
      rowId: 'pad',
      at: 60,
      open: 0.25,
      delay: 0.1875,
      feedback: 0.5,
      shiftBars: 0.1875,
      key: 'throw@60'
    })!
    expect(pruneRadioMoveVisuals([echo], 60.1, none)).toEqual([]) // withdrawn before it rang
    expect(pruneRadioMoveVisuals([echo], 60.5, none)).toEqual([echo])
    expect(pruneRadioMoveVisuals([echo], 70, none)).toEqual([])
  })

  it("is sounding only between a move's first and last points", () => {
    expect(radioMoveVisualsSounding(ta, 62)).toBe(false) // the drop's first point is at 63
    expect(radioMoveVisualsSounding(ta, 63.5)).toBe(true)
    expect(radioMoveVisualsSounding(ta, 64)).toBe(false)
    expect(radioMoveVisualsSounding([], 1)).toBe(false)
  })
})

describe('drawing it', () => {
  it('brightness: the floor when silent, full when heard', () => {
    expect(radioVisualBrightness(0)).toBe(RADIO_VISUAL_DIM_FLOOR)
    expect(radioVisualBrightness(1)).toBe(1)
    expect(radioVisualBrightness(0.45)).toBeCloseTo(0.5875, 9)
  })

  it('the CSS custom properties, the ghost trailing by a share of the window', () => {
    expect(
      radioRowVisualVars(
        {
          level: 0,
          lowCut: 0.5,
          highCut: 0,
          wash: 0.25,
          riser: 1,
          ghost: 0.5,
          ghostShiftBars: 0.25
        },
        { windowBars: 32 }
      )
    ).toEqual({
      '--mv-bright': '0.250',
      '--mv-low': '0.500',
      '--mv-high': '0.000',
      '--mv-wash': '0.250',
      '--mv-riser': '1.000',
      '--mv-ghost': '0.500',
      '--mv-ghost-shift': '0.78%'
    })
    expect(radioRowVisualVars(RADIO_ROW_VISUAL_REST)['--mv-bright']).toBe('1.000')
  })

  it('reduced motion: steady states, no sweeps or glows', () => {
    const v = {
      level: 0.3,
      lowCut: 0.1,
      highCut: 0,
      wash: 0.8,
      riser: 0.5,
      ghost: 1,
      ghostShiftBars: 1
    }
    expect(radioRowVisualSteady(v)).toEqual({
      level: 0,
      lowCut: RADIO_VISUAL_STEADY_CUT,
      highCut: 0,
      wash: 0,
      riser: 0,
      ghost: 0,
      ghostShiftBars: 0
    })
    expect(radioRowVisualSteady({ ...RADIO_ROW_VISUAL_REST })).toEqual(RADIO_ROW_VISUAL_REST)
    const vars = radioRowVisualVars(v, { reducedMotion: true, windowBars: 32 })
    expect(vars['--mv-bright']).toBe('0.250')
    expect(vars['--mv-wash']).toBe('0.000')
    expect(vars['--mv-riser']).toBe('0.000')
    expect(vars['--mv-ghost']).toBe('0.000')
  })
})
```

- [ ] **Step 2: Run it, see it fail.**
  `npx vitest run src/shared/radioMoveVisuals.test.ts`: fails to load (no `./radioMoveVisuals`).
- [ ] **Step 3: Write the module.** Create `src/shared/radioMoveVisuals.ts`:

```ts
// src/shared/radioMoveVisuals.ts
//
// RADIO'S MOVES, SHOWN WHILE THEY SOUND -- docs/superpowers/specs/2026-10-05-radio-move-visuals-
// design.md. A drop, a filter sweep, a wash, a riser, a gap, a duck, a throw or a rest is drawn on
// the row it plays on, for as long as it plays, from the same curves the audio follows. Pure, and
// shared by both radios (ell.ing/radio's full mode and sssketch's radio view), so they show the
// same thing at the same moment.
//
// How a runtime uses it:
//   - when it SCHEDULES a move, it logs the move's visuals on its own clock (the web: AudioContext
//     seconds; sssketch: bars played since radio started, the readout's clock), keyed by what
//     armed it, as the gesture flashes are (radioReadout's RadioFlash). The adapters below turn
//     each kind of plan into visuals: radioTurnaroundVisuals, radioGestureVisuals,
//     radioThrowVisual, radioRestVisual;
//   - a take-back drops its key (dropRadioMoveVisuals); every tick prunes what is over
//     (pruneRadioMoveVisuals);
//   - every frame (the web) or position tick (sssketch), while anything sounds
//     (radioMoveVisualsSounding), it reads each row at the clock's now (radioRowVisualAt) and
//     writes the result as CSS custom properties (radioRowVisualVars).
//
// One visual is one curve of one parameter on one row (or on the mix: a turnaround's riser is its
// own voice, so it is drawn on the ruler, not a row):
//   volume    the row's gain, 0..1: a drop, a stop, a gap, a hole, a duck, a rest. At rest 1.
//   highpass  a lift's normalised cutoff, open at 0. At rest 0.
//   lowpass   a dip's or a filter in's normalised cutoff, open at 1. At rest 1.
//   wash      a wash's or a bloom's share of its peak, 0..1. At rest 0.
//   riser     a riser's progress, 0 where it starts .. 1 where it ends. At rest 0.
//   echo      a throw's echo, 0..1: full while what was sent repeats, then each repeat
//             `feedback` as loud. At rest 0.
// A row's look is all of them at once: the volumes MULTIPLY (as both engines multiply a
// turnaround's drop into a hole or a duck: combineRadioCurves, the web's separate gain nodes),
// everything else takes the strongest. So an intensity breakdown's rest, a hook's rest, the drop's
// gap and a duck compose without knowing about each other, and the one -- where every curve steps
// back to rest -- brings everything back at once.
//
// Quick fades (Elling, 2026-10-05: "maybe a quicker fade in and out"): a move's way IN is never
// shorter than `fade` (the runtime's RADIO_VISUAL_FADE_SEC on its clock), so a dim or a sweep's
// first step reads as a fade rather than a cut; its way OUT, on the one, stays a step, so the one
// is seen on the beat.

import { buildDropOutCurve } from './radioDropOut'
import {
  buildBloomCurve,
  buildDuckCurve,
  buildFilterInCurve,
  buildTransitionRiser,
  type RadioTransitionKind
} from './radioTransition'
import {
  TURNAROUND_DIP_FLOOR,
  TURNAROUND_LIFT_TOP,
  turnaroundDropCurve,
  type TurnaroundPlan,
  type TurnaroundPoint
} from './radioTurnaround'
import type { AutomationPoint } from './toolkit'

const BEATS_PER_BAR = 4

export type RadioVisualParam = 'volume' | 'highpass' | 'lowpass' | 'wash' | 'riser' | 'echo'

/** A point on the runtime's own clock. */
export interface RadioVisualPoint {
  at: number
  value: number
}

export interface RadioMoveVisual {
  /** What armed it (the flash's key): a take-back drops every visual it armed. */
  key: string
  /** The row it shows on; null for the mix as a whole (a turnaround's riser: the ruler). */
  rowId: string | null
  param: RadioVisualParam
  /** What it is, for the logs and the tests: drop, gap, lift, dip, wash, riser (a turnaround's),
   * a gesture's kind (hole, drop-out, filter in, bloom, duck, riser), throw, rest. */
  move: string
  /** Ascending on the runtime's clock; linear between, a stacked pair a step. Before the first
   * point and after the last, the param's rest value -- unless `holds`. */
  points: RadioVisualPoint[]
  /** An open rest: its last value holds after its last point, until it is closed
   * (closeRadioRestVisuals) or its key goes (pruneRadioMoveVisuals' `live`). */
  holds?: true
  /** An echo: how far its ghost trails the row, in bars (one repeat's delay). */
  shiftBars?: number
}

/** What a row looks like at a moment, every part 0..1 (spec: `{ level, lowCut, highCut, wash,
 * riser, ghost }`), plus how far the ghost trails. */
export interface RadioRowVisual {
  /** The volumes, multiplied: 1 heard, 0 silent. Drawn as brightness (radioVisualBrightness). */
  level: number
  /** A lift: how much of the low end the high-pass has taken (1 at the bold lift's top). */
  lowCut: number
  /** A dip or a filter in: how much of the top the low-pass has taken (1 at the bold dip's floor). */
  highCut: number
  wash: number
  riser: number
  ghost: number
  ghostShiftBars: number
}

export const RADIO_ROW_VISUAL_REST: Readonly<RadioRowVisual> = {
  level: 1,
  lowCut: 0,
  highCut: 0,
  wash: 0,
  riser: 0,
  ghost: 0,
  ghostShiftBars: 0
}

/** A silent row's brightness (spec: "dims to about 25% brightness while silent"). */
export const RADIO_VISUAL_DIM_FLOOR = 0.25
/** The shortest way into a move, in seconds (each runtime puts it on its clock). */
export const RADIO_VISUAL_FADE_SEC = 0.1
/** A sweep under prefers-reduced-motion: one steady thinning for the move's whole length. */
export const RADIO_VISUAL_STEADY_CUT = 0.6
/** An echo quieter than this is drawn as gone. */
export const RADIO_VISUAL_ECHO_FLOOR = 0.05

const REST: Readonly<Record<RadioVisualParam, number>> = {
  volume: 1,
  highpass: 0,
  lowpass: 1,
  wash: 0,
  riser: 0,
  echo: 0
}

const clamp01 = (x: number): number => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0)

/** The brightness a level is drawn at: the dim floor when silent, full when heard. */
export function radioVisualBrightness(level: number): number {
  return RADIO_VISUAL_DIM_FLOOR + (1 - RADIO_VISUAL_DIM_FLOOR) * clamp01(level)
}

// ---- evaluating ----

/** The points as drawn: stepping in from rest at the first point, the way in never shorter than
 * `fade`, and (unless it holds) stepping back to rest at the last. */
function drawnPoints(v: RadioMoveVisual, fade: number): RadioVisualPoint[] {
  const rest = REST[v.param]
  const src = v.points
  if (src.length === 0) return []
  const out: RadioVisualPoint[] = []
  if (src[0].value !== rest) out.push({ at: src[0].at, value: rest })
  for (const p of src) out.push({ at: p.at, value: p.value })
  if (v.holds !== true && out[out.length - 1].value !== rest) {
    out.push({ at: out[out.length - 1].at, value: rest })
  }
  if (fade > 0) {
    for (let i = 1; i < out.length; i++) {
      const a = out[i - 1]
      const b = out[i]
      // further from rest than the point before, too quickly: the way in, stretched to `fade`
      // (never past the next point, so the shape after it is untouched)
      if (Math.abs(b.value - rest) > Math.abs(a.value - rest) && b.at - a.at < fade) {
        const next = out[i + 1]
        b.at = Math.min(a.at + fade, next !== undefined ? next.at : Number.POSITIVE_INFINITY)
      }
    }
  }
  return out
}

/** One visual's value at `t`: linear between its points, a stacked pair a step to the later
 * value, the rest value outside them (the last value after them while it holds). */
export function radioMoveVisualValueAt(v: RadioMoveVisual, t: number, fade = 0): number {
  const rest = REST[v.param]
  const pts = drawnPoints(v, fade)
  if (pts.length === 0 || !Number.isFinite(t) || t < pts[0].at) return rest
  const last = pts[pts.length - 1]
  if (t >= last.at) return v.holds === true ? last.value : rest
  for (let i = 1; i < pts.length; i++) {
    const b = pts[i]
    if (t >= b.at) continue
    const a = pts[i - 1]
    const span = b.at - a.at
    return span <= 0 ? b.value : a.value + ((b.value - a.value) * (t - a.at)) / span
  }
  return rest
}

/** A row's look at `t` (rowId null: the mix's, for the ruler). `fade`: the shortest way into a
 * move on the visuals' clock (RADIO_VISUAL_FADE_SEC there; 0 under reduced motion). */
export function radioRowVisualAt(
  visuals: readonly RadioMoveVisual[],
  rowId: string | null,
  t: number,
  fade = 0
): RadioRowVisual {
  const out: RadioRowVisual = { ...RADIO_ROW_VISUAL_REST }
  for (const v of visuals) {
    if (v.rowId !== rowId) continue
    const x = radioMoveVisualValueAt(v, t, fade)
    switch (v.param) {
      case 'volume':
        out.level *= clamp01(x)
        break
      case 'highpass':
        out.lowCut = Math.max(out.lowCut, clamp01(x / TURNAROUND_LIFT_TOP))
        break
      case 'lowpass':
        out.highCut = Math.max(out.highCut, clamp01((1 - x) / (1 - TURNAROUND_DIP_FLOOR)))
        break
      case 'wash':
        out.wash = Math.max(out.wash, clamp01(x))
        break
      case 'riser':
        out.riser = Math.max(out.riser, clamp01(x))
        break
      case 'echo': {
        const g = clamp01(x)
        if (g > out.ghost) {
          out.ghost = g
          out.ghostShiftBars = v.shiftBars ?? 0
        }
        break
      }
    }
  }
  return out
}

/** Whether anything is sounding at `t` (a visual between its first and last points, or holding
 * after them). False: every row is at rest, and a runtime can skip its frame. */
export function radioMoveVisualsSounding(visuals: readonly RadioMoveVisual[], t: number): boolean {
  return visuals.some((v) => {
    if (v.points.length === 0) return false
    return t >= v.points[0].at && (v.holds === true || t < v.points[v.points.length - 1].at)
  })
}

/** Under prefers-reduced-motion: steady states, no sweeps or glows (spec "Rendering"). A row
 * silent for most of the moment is at the floor, else full; a filter move is one steady thinning
 * while it lasts; no wash, riser or ghost. Evaluate with `fade` 0 first. */
export function radioRowVisualSteady(v: RadioRowVisual): RadioRowVisual {
  return {
    level: v.level < 0.5 ? 0 : 1,
    lowCut: v.lowCut > 0 ? RADIO_VISUAL_STEADY_CUT : 0,
    highCut: v.highCut > 0 ? RADIO_VISUAL_STEADY_CUT : 0,
    wash: 0,
    riser: 0,
    ghost: 0,
    ghostShiftBars: 0
  }
}

/** The look as the CSS custom properties both radios style the row with (each its own rules):
 *   --mv-bright       the waveform's opacity (radioVisualBrightness)
 *   --mv-low          a lift's thinning of the waveform's lower half, 0..1
 *   --mv-high         a dip's thinning of its upper half, 0..1
 *   --mv-wash         the wash's soften, 0..1
 *   --mv-riser        a riser line's length, 0..1 of the row
 *   --mv-ghost        the echo's ghost's strength, 0..1
 *   --mv-ghost-shift  how far it trails, a percent of the row's window (`windowBars`; 0% without)
 * Under `reducedMotion`, the steady states (radioRowVisualSteady). */
export function radioRowVisualVars(
  v: RadioRowVisual,
  opts: { windowBars?: number; reducedMotion?: boolean } = {}
): Record<string, string> {
  const s = opts.reducedMotion === true ? radioRowVisualSteady(v) : v
  const w = opts.windowBars
  const shift = w !== undefined && w > 0 ? (s.ghostShiftBars / w) * 100 : 0
  return {
    '--mv-bright': radioVisualBrightness(s.level).toFixed(3),
    '--mv-low': s.lowCut.toFixed(3),
    '--mv-high': s.highCut.toFixed(3),
    '--mv-wash': s.wash.toFixed(3),
    '--mv-riser': s.riser.toFixed(3),
    '--mv-ghost': s.ghost.toFixed(3),
    '--mv-ghost-shift': `${shift.toFixed(2)}%`
  }
}

// ---- keeping the log ----

/** The log without the visuals `key` armed (a move taken back): its rows go back at once. */
export function dropRadioMoveVisuals(
  visuals: readonly RadioMoveVisual[],
  key: string
): RadioMoveVisual[] {
  return visuals.filter((v) => v.key !== key)
}

/** The log without what is over by `now`, and -- given `live`, the keys still armed (sssketch reads
 * them off what is armed every tick) -- without every move whose key is gone: taken back, its
 * curve has left the project, so its look goes too. Except an echo already ringing: it rings on
 * after its throw closes (and its key goes), as its audio does. */
export function pruneRadioMoveVisuals(
  visuals: readonly RadioMoveVisual[],
  now: number,
  live?: ReadonlySet<string>
): RadioMoveVisual[] {
  return visuals.filter((v) => {
    if (v.points.length === 0) return false
    const gone = live !== undefined && !live.has(v.key)
    if (gone && (v.param !== 'echo' || v.points[0].at > now)) return false
    if (v.holds === true) return true
    return v.points[v.points.length - 1].at >= now
  })
}

/** The row's open rests closed at `until` (its return is decided: it is heard again from there).
 * A rest that would close before it began is gone. */
export function closeRadioRestVisuals(
  visuals: readonly RadioMoveVisual[],
  rowId: string,
  until: number
): RadioMoveVisual[] {
  const out: RadioMoveVisual[] = []
  for (const v of visuals) {
    if (v.rowId !== rowId || v.move !== 'rest' || v.holds !== true) {
      out.push(v)
      continue
    }
    const from = v.points[0]?.at ?? until
    if (!(until > from)) continue
    out.push({
      key: v.key,
      rowId: v.rowId,
      param: v.param,
      move: v.move,
      points: [...v.points, { at: until, value: 0 }, { at: until, value: 1 }]
    })
  }
  return out
}

/** The row's rests closed at `until` open again (the return there was taken back). */
export function reopenRadioRestVisuals(
  visuals: readonly RadioMoveVisual[],
  rowId: string,
  until: number
): RadioMoveVisual[] {
  return visuals.map((v) => {
    const n = v.points.length
    if (
      v.rowId !== rowId ||
      v.move !== 'rest' ||
      v.holds === true ||
      n < 4 ||
      v.points[n - 1].at !== until
    ) {
      return v
    }
    return { ...v, points: v.points.slice(0, -2), holds: true }
  })
}

// ---- the adapters: each kind of plan as visuals ----

/** A curve in beats before a wrap, on the runtime's clock. */
function beforeWrap(
  points: readonly TurnaroundPoint[],
  wrapAt: number,
  unitsPerBeat: number
): RadioVisualPoint[] {
  return points.map((p) => ({ at: wrapAt - p.beats * unitsPerBeat, value: p.value }))
}

/** A curve in bars from a lap's start, on the runtime's clock. */
function fromLapStart(
  points: readonly AutomationPoint[],
  lapStartAt: number,
  unitsPerBar: number
): RadioVisualPoint[] {
  return points.map((p) => ({ at: lapStartAt + p.bar * unitsPerBar, value: p.value }))
}

/** A riser's line: from nothing where it starts to full where it ends, gone after. */
function riserPoints(start: number, end: number): RadioVisualPoint[] {
  return [
    { at: start, value: 0 },
    { at: end, value: 1 },
    { at: end, value: 0 }
  ]
}

export interface RadioTurnaroundVisualsAt {
  /** The wrap the turnaround ends on, on the runtime's clock. */
  wrapAt: number
  /** One beat on that clock, in the lap that ends on the wrap. */
  unitsPerBeat: number
  /** That lap's loop, in bars (the gap's drop and the riser are placed in it). */
  loopBars: number
  key: string
  /** Rows the plan never saw that the runtime silences through the gap
   * (turnaroundGapLateRowIds). */
  lateRowIds?: readonly string[]
}

/** A phrase turnaround (or a turn) as visuals: each row's volume (its drops, the stop and the gap,
 * merged by the planner), filter (a lift's high-pass or a dip's low-pass) and wash; each late row
 * silent through the gap; the riser, when there is one, on the mix -- from its start to where it
 * ends (the gap's start, or the one). */
export function radioTurnaroundVisuals(
  plan: TurnaroundPlan,
  at: RadioTurnaroundVisualsAt
): RadioMoveVisual[] {
  const { wrapAt, unitsPerBeat, key } = at
  const out: RadioMoveVisual[] = []
  for (const r of plan.rows) {
    if (r.volume !== undefined && r.volume.length > 0) {
      out.push({
        key,
        rowId: r.rowId,
        param: 'volume',
        move: 'drop',
        points: beforeWrap(r.volume, wrapAt, unitsPerBeat)
      })
    }
    if (r.filter !== undefined && r.filter.cutoff.length > 0) {
      const lift = r.filter.mode === 'highpass'
      out.push({
        key,
        rowId: r.rowId,
        param: lift ? 'highpass' : 'lowpass',
        move: lift ? 'lift' : 'dip',
        points: beforeWrap(r.filter.cutoff, wrapAt, unitsPerBeat)
      })
    }
    if (r.reverbSend !== undefined && r.reverbSend.points.length > 0) {
      out.push({
        key,
        rowId: r.rowId,
        param: 'wash',
        move: 'wash',
        points: beforeWrap(r.reverbSend.points, wrapAt, unitsPerBeat)
      })
    }
  }
  const gap = plan.gapBeats ?? 0
  if (gap > 0 && at.lateRowIds !== undefined && at.lateRowIds.length > 0) {
    const drop = turnaroundDropCurve(at.loopBars, gap)
    if (drop.length > 0) {
      for (const rowId of at.lateRowIds) {
        out.push({
          key,
          rowId,
          param: 'volume',
          move: 'gap',
          points: beforeWrap(drop, wrapAt, unitsPerBeat)
        })
      }
    }
  }
  if (plan.riserBars !== undefined && plan.riserBars > 0) {
    // buildTransitionRiser's placement, as both engines place it (planRiser on the web)
    const clip = buildTransitionRiser('visual', at.loopBars, plan.riserBars, {
      endBeforeBars: gap / BEATS_PER_BAR
    })
    if (clip !== null) {
      const unitsPerBar = unitsPerBeat * BEATS_PER_BAR
      const start = wrapAt - (at.loopBars - clip.startBar) * unitsPerBar
      out.push({
        key,
        rowId: null,
        param: 'riser',
        move: 'riser',
        points: riserPoints(start, start + clip.lengthBars * unitsPerBar)
      })
    }
  }
  return out
}

/** A lap on the runtime's clock: its loop in bars and one bar's length. */
export interface RadioVisualLap {
  loopBars: number
  unitsPerBar: number
}

export interface RadioGestureVisualInput {
  /** The gesture as it was scheduled (the engine's answer: a lead-in with no room is a cut). */
  kind: RadioTransitionKind | 'drop-out'
  rowId: string
  beats: number
  /** The wrap the change lands on (a drop-out: the wrap its row leaves on). */
  wrapAt: number
  /** The lap ending on the wrap: where a hole, a drop-out and a riser play. */
  before: RadioVisualLap
  /** The lap starting on it: where a filter in, a bloom and a duck play. */
  after: RadioVisualLap
  /** A duck's rows: every other heard row, none changing on the wrap. */
  duckRowIds?: readonly string[]
  key: string
}

/** A change's gesture as visuals, from radioTransition's own curve builders (the ones both engines
 * play): a hole or the arc's exit drop-out dims the row into the wrap, a riser draws its line on
 * the row it announces, a filter in thins the arriving row's top and opens, a bloom washes it and
 * clears, a duck dims every row in `duckRowIds`. A cut is nothing. */
export function radioGestureVisuals(g: RadioGestureVisualInput): RadioMoveVisual[] {
  const { kind, rowId, key, wrapAt, before, after } = g
  const lapStart = wrapAt - before.loopBars * before.unitsPerBar
  const bars = g.beats / BEATS_PER_BAR
  switch (kind) {
    case 'cut':
      return []
    case 'hole':
    case 'drop-out': {
      const curve = buildDropOutCurve(before.loopBars, g.beats)
      if (curve.length === 0) return []
      // the curve is silent into the wrap; the row is heard again on it (a new stem lands full,
      // or the row has left)
      const points = [
        ...fromLapStart(curve, lapStart, before.unitsPerBar),
        { at: wrapAt, value: 1 }
      ]
      return [{ key, rowId, param: 'volume', move: kind, points }]
    }
    case 'riser': {
      const clip = buildTransitionRiser(rowId, before.loopBars, bars)
      if (clip === null) return []
      const start = lapStart + clip.startBar * before.unitsPerBar
      return [
        {
          key,
          rowId,
          param: 'riser',
          move: 'riser',
          points: riserPoints(start, start + clip.lengthBars * before.unitsPerBar)
        }
      ]
    }
    case 'filter in': {
      const curve = buildFilterInCurve(after.loopBars, bars)
      if (curve.length === 0) return []
      return [
        {
          key,
          rowId,
          param: 'lowpass',
          move: kind,
          points: fromLapStart(curve, wrapAt, after.unitsPerBar)
        }
      ]
    }
    case 'bloom': {
      const curve = buildBloomCurve(after.loopBars, bars)
      const peak = Math.max(0, ...curve.map((p) => p.value))
      if (curve.length === 0 || !(peak > 0)) return []
      const points = fromLapStart(curve, wrapAt, after.unitsPerBar).map((p) => ({
        at: p.at,
        value: p.value / peak
      }))
      return [{ key, rowId, param: 'wash', move: kind, points }]
    }
    case 'duck': {
      const curve = buildDuckCurve(after.loopBars, bars)
      if (curve.length === 0) return []
      return (g.duckRowIds ?? []).map((id) => ({
        key,
        rowId: id,
        param: 'volume' as const,
        move: kind,
        points: fromLapStart(curve, wrapAt, after.unitsPerBar)
      }))
    }
  }
}

export interface RadioThrowVisualInput {
  rowId: string
  /** Where the send opens, on the runtime's clock. */
  at: number
  /** How long it stays open, on that clock. */
  open: number
  /** One repeat's delay, on that clock (throwDelaySec there). */
  delay: number
  feedback: number
  /** One repeat's delay in bars: how far the ghost trails. */
  shiftBars: number
  key: string
}

/** A dub throw's ghost: what the send caught repeats one delay later, at full while the send was
 * open, then each repeat `feedback` as loud, until it is under RADIO_VISUAL_ECHO_FLOOR. */
export function radioThrowVisual(t: RadioThrowVisualInput): RadioMoveVisual | null {
  if (!(t.open > 0) || !(t.delay > 0) || !(t.feedback > 0 && t.feedback < 1)) return null
  const first = t.at + t.delay
  const closed = first + t.open
  const points: RadioVisualPoint[] = [
    { at: first, value: 1 },
    { at: closed, value: 1 }
  ]
  let level = 1
  let k = 0
  while (level >= RADIO_VISUAL_ECHO_FLOOR && k < 64) {
    k += 1
    level *= t.feedback
    points.push({ at: closed + k * t.delay, value: level >= RADIO_VISUAL_ECHO_FLOOR ? level : 0 })
  }
  return {
    key: t.key,
    rowId: t.rowId,
    param: 'echo',
    move: 'throw',
    points,
    shiftBars: t.shiftBars
  }
}

/** A row resting (a hook's resting exit, the intensity arc's breakdown): silent from `from`, heard
 * again from `until` -- or, with `until` null, until it is closed (closeRadioRestVisuals). */
export function radioRestVisual(r: {
  rowId: string
  from: number
  until: number | null
  key: string
}): RadioMoveVisual {
  const points: RadioVisualPoint[] = [
    { at: r.from, value: 1 },
    { at: r.from, value: 0 }
  ]
  if (r.until === null)
    return { key: r.key, rowId: r.rowId, param: 'volume', move: 'rest', points, holds: true }
  return {
    key: r.key,
    rowId: r.rowId,
    param: 'volume',
    move: 'rest',
    points: [...points, { at: r.until, value: 0 }, { at: r.until, value: 1 }]
  }
}
```

- [ ] **Step 4: Run it, see it pass.** `npx vitest run src/shared/radioMoveVisuals.test.ts`: 36
  passed. Then `npm run typecheck`, `npx eslint src/shared/radioMoveVisuals*.ts`,
  `npx prettier --check src/shared/radioMoveVisuals*.ts`.
- [ ] **Step 5: Commit** both files. Message:
  `radio: moves shown while they sound, the shared helper (spec 2026-10-05-radio-move-visuals-design) -- radioMoveVisuals: a runtime logs each move it schedules as visuals on its own clock (keyed as its flashes), from the builders its engine plays (radioTurnaroundVisuals: the merged row curves, late rows through the gap, the riser on the mix; radioGestureVisuals: hole, drop-out, riser, filter in, bloom, duck; radioThrowVisual: the echo's repeats; radioRestVisual, closed and reopened); radioRowVisualAt reads a row's look at a moment (level, lowCut, highCut, wash, riser, ghost: volumes multiply, the rest the strongest; a move's way in never under the fade, its way out a step on the one); radioRowVisualVars as CSS custom properties, the steady states under reduced motion; prune and drop by key. Pure; nothing calls it yet`,
  then the trailer.

### Task 2: The flash's quick fades (`radioReadout.ts`, `radioRowPlates.ts`)

**Repo:** sssketch. **Parallel-safe.** **Depends on:** nothing.

**Files:**
- Create: `src/shared/radioFlashFades.test.ts`
- Modify: `src/shared/radioReadout.ts`, `src/shared/radioRowPlates.ts`

What changes: `RadioFlash.until` (the move's end), `RadioFlashShown.opacity`, two constants,
`radioFlashShown(..., fade?)` and `pruneRadioFlashes(..., fadeOut?)`. Absent, every caller and
every existing test reads exactly as today (`radioReadout.test.ts`, `radioRowPlates.test.ts`
unchanged and green).

- [ ] **Step 1: Write the failing test.** Create `src/shared/radioFlashFades.test.ts`:

```ts
// The flash's quick fades (spec 2026-10-05-radio-move-visuals-design, "Flash words"): a move's
// word on for the move's duration, then out fast; a moment's word for its window. radioReadout.ts.
import { describe, expect, it } from 'vitest'
import {
  RADIO_FLASH_FADE_IN_SEC,
  RADIO_FLASH_FADE_OUT_SEC,
  pruneRadioFlashes,
  radioFlashShown,
  type RadioFlash
} from './radioReadout'
import { radioRowPlates } from './radioRowPlates'

// the web's clock: seconds, a 2 s bar (120 bpm)
const FADE = { in: RADIO_FLASH_FADE_IN_SEC, out: RADIO_FLASH_FADE_OUT_SEC }
const log: RadioFlash[] = [
  // a lift over the last 2 bars before the wrap at 20
  { rowId: 'a', word: 'lift', at: 16, until: 20, key: 'ta@20' },
  // a moment's word: hook out on b at 20
  { rowId: 'b', word: 'hook out', at: 20, key: 'b@20' }
]

describe("a move's word", () => {
  it('fades in quickly, stays on for the move, and fades out fast after it', () => {
    expect(radioFlashShown(log, 'a', 15.9, 2, FADE)).toBeNull()
    expect(radioFlashShown(log, 'a', 16.05, 2, FADE)?.opacity).toBeCloseTo(0.5, 9)
    expect(radioFlashShown(log, 'a', 16.1, 2, FADE)?.opacity).toBe(1)
    expect(radioFlashShown(log, 'a', 19.99, 2, FADE)?.opacity).toBe(1) // longer than a bar: still on
    expect(radioFlashShown(log, 'a', 20.075, 2, FADE)?.opacity).toBeCloseTo(0.5, 9)
    expect(radioFlashShown(log, 'a', 20.15, 2, FADE)).toBeNull()
  })

  it("a moment's word: on for its window (a bar), then out fast", () => {
    expect(radioFlashShown(log, 'b', 21, 2, FADE)?.opacity).toBe(1)
    expect(radioFlashShown(log, 'b', 22.075, 2, FADE)?.opacity).toBeCloseTo(0.5, 9)
    expect(radioFlashShown(log, 'b', 22.2, 2, FADE)).toBeNull()
  })

  it('without the fades, exactly as before (one window from its start, no opacity)', () => {
    expect(radioFlashShown(log, 'a', 17, 2)).toEqual({ word: 'lift', t: 0.5 })
    expect(radioFlashShown(log, 'a', 19, 2)).toBeNull()
  })

  it('the latest start wins while both show', () => {
    const two: RadioFlash[] = [...log, { rowId: 'a', word: 'gap', at: 19, until: 20, key: 'ta@20' }]
    expect(radioFlashShown(two, 'a', 19.5, 2, FADE)?.word).toBe('gap')
    expect(radioFlashShown(two, 'a', 18, 2, FADE)?.word).toBe('lift')
  })

  it('on the bars clock the same (sssketch: a bar is 1, the fades in bars)', () => {
    const bars = { in: 0.05, out: 0.075 }
    const l: RadioFlash[] = [{ rowId: 'a', word: 'wash', at: 6, until: 8, key: 'k' }]
    expect(radioFlashShown(l, 'a', 7.5, 1, bars)?.opacity).toBe(1)
    expect(radioFlashShown(l, 'a', 8.0375, 1, bars)?.opacity).toBeCloseTo(0.5, 9)
  })

  it('is kept until its move and its fade out are over', () => {
    expect(pruneRadioFlashes(log, 19, 2, undefined, 0.15).map((f) => f.key)).toEqual([
      'ta@20',
      'b@20'
    ])
    expect(pruneRadioFlashes(log, 20.1, 2, undefined, 0.15).map((f) => f.key)).toEqual([
      'ta@20',
      'b@20'
    ])
    expect(pruneRadioFlashes(log, 20.2, 2, undefined, 0.15).map((f) => f.key)).toEqual(['b@20'])
    expect(pruneRadioFlashes(log, 22.2, 2, undefined, 0.15)).toEqual([])
  })

  it('the plates draw the opacity it carries', () => {
    const plates = radioRowPlates(
      {
        rowId: 'a',
        label: 'pad',
        age: '2 laps',
        nextLabel: null,
        flash: { word: 'lift', t: 0.9, opacity: 1 }
      },
      null
    )
    expect(plates.cue?.flash).toEqual({ word: 'lift', opacity: 1 })
  })
})
```

- [ ] **Step 2: Run it, see it fail.** `npx vitest run src/shared/radioFlashFades.test.ts`: 5 of 7
  fail (the two that pass are today's behaviour).
- [ ] **Step 3: The change.** `src/shared/radioReadout.ts`:

```diff
--- a/src/shared/radioReadout.ts
+++ b/src/shared/radioReadout.ts
@@ -34,12 +34,30 @@
   word: string
   at: number
   key: string
+  /** Where the move it names ends, on the same clock (spec 2026-10-05-radio-move-visuals-design:
+   * "the move's word stays on for the move's duration"). Absent: a moment's word (hook out, dig,
+   * no fave fits), shown for one window. */
+  until?: number
 }
 
-/** A flash showing now: its word, and how far through its window it is (0..1). */
+/** A flash showing now: its word, and how far through its window it is (0..1). `opacity` only
+ * when it was asked for with a fade (radioFlashShown's `fade`): drawn at that, not
+ * radioFlashOpacity(t). */
 export interface RadioFlashShown {
   word: string
   t: number
+  opacity?: number
+}
+
+/** The flash's quick fades, in seconds (each runtime puts them on its clock): in, and out once
+ * its move has ended (Elling, 2026-10-05: "maybe a quicker fade in and out"). */
+export const RADIO_FLASH_FADE_IN_SEC = 0.1
+export const RADIO_FLASH_FADE_OUT_SEC = 0.15
+
+/** Fades on a runtime's clock. */
+export interface RadioFlashFade {
+  in: number
+  out: number
 }
 
 /** `breakdown` and `drop`: the intensity arc's (radioReadoutIntensityArc). */
@@ -390,37 +408,70 @@
 /** The word a transition gesture flashes: its kind; none for a cut or the arc's exit. */
 export function radioGestureFlashWord(kind: RadioTransitionKind | 'drop-out'): string | null {
   return kind === 'cut' || kind === 'drop-out' ? null : kind
+}
+
+/** Where a flash's word stops showing at full: its move's end, or one window after it starts. */
+function flashEnd(f: RadioFlash, window: number): number {
+  return f.until !== undefined && f.until > f.at ? f.until : f.at + window
 }
 
 /** The row's flash at `now`: the latest word whose start lies within the last `window` (one
- * bar on the log's clock), or null. A word not sounding yet does not show. */
+ * bar on the log's clock), or null. A word not sounding yet does not show.
+ *
+ * With `fade` (the quick fades, RADIO_FLASH_FADE_IN_SEC / _OUT_SEC on the log's clock): a word
+ * shows from its start until its move ends (`until`; else one window), at full after a fade in,
+ * then fades out over `fade.out`; the latest start still wins. Its `opacity` says how visible it
+ * is, and `t` is how far through that whole showing it is. Without, exactly as before. */
 export function radioFlashShown(
   log: readonly RadioFlash[],
   rowId: string,
   now: number,
-  window: number
+  window: number,
+  fade?: RadioFlashFade
 ): RadioFlashShown | null {
   if (!(window > 0) || !Number.isFinite(now)) return null
+  if (fade === undefined) {
+    let best: RadioFlash | null = null
+    for (const f of log) {
+      if (f.rowId !== rowId || f.at > now + 1e-9 || now - f.at >= window) continue
+      if (best === null || f.at > best.at) best = f
+    }
+    return best === null
+      ? null
+      : { word: best.word, t: Math.min(1, Math.max(0, (now - best.at) / window)) }
+  }
+  const out = Math.max(0, fade.out)
   let best: RadioFlash | null = null
   for (const f of log) {
-    if (f.rowId !== rowId || f.at > now + 1e-9 || now - f.at >= window) continue
+    if (f.rowId !== rowId || f.at > now + 1e-9 || now >= flashEnd(f, window) + out) continue
     if (best === null || f.at > best.at) best = f
   }
-  return best === null
-    ? null
-    : { word: best.word, t: Math.min(1, Math.max(0, (now - best.at) / window)) }
+  if (best === null) return null
+  const end = flashEnd(best, window)
+  const fadeIn = fade.in > 0 ? Math.min(1, (now - best.at) / fade.in) : 1
+  const fadeOut = now < end ? 1 : out > 0 ? Math.max(0, 1 - (now - end) / out) : 0
+  return {
+    word: best.word,
+    t: Math.min(1, Math.max(0, (now - best.at) / (end + out - best.at))),
+    opacity: Math.min(1, Math.max(0, Math.min(fadeIn, fadeOut)))
+  }
 }
 
 /** The log without words whose window has passed, and -- given `live`, the keys still armed --
- * without words not sounding yet whose gesture has been taken back. */
+ * without words not sounding yet whose gesture has been taken back. `fadeOut` (the quick fade's,
+ * on the log's clock): a word is kept until its move's end (`until`, else its window) and its
+ * fade out are over. Absent, and with no `until`, exactly as before. */
 export function pruneRadioFlashes(
   log: readonly RadioFlash[],
   now: number,
   window: number,
-  live?: ReadonlySet<string>
+  live?: ReadonlySet<string>,
+  fadeOut = 0
 ): RadioFlash[] {
   return log.filter((f) =>
-    f.at > now ? live === undefined || live.has(f.key) : now - f.at < window
+    f.at > now
+      ? live === undefined || live.has(f.key)
+      : now < flashEnd(f, window) + Math.max(0, fadeOut)
   )
 }
 
```

  `src/shared/radioRowPlates.ts`:

```diff
--- a/src/shared/radioRowPlates.ts
+++ b/src/shared/radioRowPlates.ts
@@ -6,7 +6,8 @@
 //   info  top left: the readout's label, cut with an ellipsis, then its tail kept whole -- the age
 //         and the role words after it (`3 laps · hook · back in 16 bars`). The web's tail starts
 //         with a no-break space, since a flex item's leading space would collapse.
-//   cue   bottom right: the gesture flash (its word and opacity over its bar) and `next · ...`.
+//   cue   bottom right: the gesture flash (its word and opacity: the quick fades' when the
+//         readout carries one, else in and out over its bar) and `next · ...`.
 //         Hidden when it has neither.
 //   fold  top right: fold mode's `7 / 16` on a folded row; the phase dot under it is the
 //         panel's (data-fold-dot), never this module's.
@@ -33,7 +34,9 @@
   const age = row?.age ?? ''
   const tail = age === '' ? '' : label === '' ? age : `\u00a0· ${age}`
   const flash =
-    row?.flash != null ? { word: row.flash.word, opacity: radioFlashOpacity(row.flash.t) } : null
+    row?.flash != null
+      ? { word: row.flash.word, opacity: row.flash.opacity ?? radioFlashOpacity(row.flash.t) }
+      : null
   const next = row?.nextLabel != null && row.nextLabel !== '' ? row.nextLabel : null
   return {
     info: label === '' && tail === '' ? null : { label, tail },
```

- [ ] **Step 4: Run, see it pass.**
  `npx vitest run src/shared/radioFlashFades.test.ts src/shared/radioReadout.test.ts src/shared/radioRowPlates.test.ts`,
  then `npx vitest run src/shared` (176 files with Task 1), `npm run typecheck`, eslint and
  prettier on the three files. **And the web against it:** in ell.ing/radio,
  `npm run typecheck` and `npx vitest run src/ui` (it reads sssketch's working tree): green.
- [ ] **Step 5: Commit** the three files. Message:
  `radio: the flash's quick fades (spec 2026-10-05-radio-move-visuals-design, flash words) -- RadioFlash.until (the move's end on the log's clock), radioFlashShown's optional fade (in 100 ms, on until the move ends or for its window, out 150 ms: RADIO_FLASH_FADE_IN_SEC / _OUT_SEC, each runtime on its clock; RadioFlashShown.opacity) and pruneRadioFlashes' fadeOut; the plates draw the opacity it carries. Absent: today's sine over a bar, every caller unchanged`,
  then the trailer.

---

## Phase 2: the web

### Task 3: The controller's log (`controller.ts`)

**Repo:** ell.ing/radio. **Depends on:** Tasks 1, 2, and web Task 8's commit (it edits
`controller.ts` and `main.ts`).

**Files:** `src/radio/controller.ts`, `src/radio/controller.test.ts`, `src/radio/step.ts` (one
line).

Every visual is keyed as the flash for the same move is, so the existing `dropRadioFlashes` call
sites drop it too. Units: AudioContext seconds. `before(at)` = `e.clock(at - 1e-3)` (the clock in
force in the lap ending at `at`, as `planTurnaroundTimes`' `clockBefore`), `after(at)` =
`e.clock(at)`; one lap is `{ loopBars: c.loopBars, unitsPerBar: 240 / c.bpm }`; fall back to
`this.s.bpm` / `this.s.loopBars` when a clock is null.

- [ ] **Step 1: Failing tests** in `controller.test.ts`, with its fake engine (it already records
  `applyTurnaround`, `scheduleSwap`, `removeRow`, `throwDelay`; give `clock(t)` a fixed 120 bpm
  8-bar clock if it has none):
  - after a `turnaround` action into `W` with a drums-out plan, `moveVisuals()` holds the drums
    row's `volume` visual, and `radioRowVisualAt(c.moveVisuals(), 'drums', W - 0.5).level` is 0,
    at `W` it is 1;
  - a `cancelTurnaround` at `W` leaves no visual keyed `turnaround@W`;
  - a `land` with a `filter in` logs a `lowpass` visual on the row from `W`; with `hole` a volume
    visual into `W`; when the engine answers `cut` (a lead-in with no room), nothing;
  - a `duck` logs a volume visual on every other row with a stem, not on a row whose own change
    lands on the same `W` (land two rows at `W` in either order);
  - `throwNow` logs an `echo` keyed `throw@<at>`; `cancelThrow` drops it;
  - `hookRest(slot, at)` and `arcLanding(slot, ..., 'rest')` log an open rest; a return onto that
    row (`hookSwap(..., 'return', muted)` or `arcLanding(..., 'return')`) closes it at its `at`;
    a `cancel` of that return reopens it; a `cancel` of the rest drops it;
  - `stop` empties the log; `tick` prunes what is over;
  - the turnaround's flashes carry `until: W`; a hole's `until: W`; a filter in's
    `until: W + its beats` (at most half the loop); a throw's `until: at + beats * 60 / bpm`;
    `hook out` none.
- [ ] **Step 2: The log.**
  - Beside `private flashes: RadioFlash[] = []`: `private moves: RadioMoveVisual[] = []`, and
    `moveVisuals(): readonly RadioMoveVisual[] { return this.moves }` beside `flashLog()`.
  - `private flash(rowId, word, at, key, until?: number)`: pushes `until` when given.
  - `tick()`: after `this.flashes = pruneRadioFlashes(this.flashes, now, 240 / this.s.bpm)`, pass
    `undefined, RADIO_FLASH_FADE_OUT_SEC` to it, and add
    `this.moves = pruneRadioMoveVisuals(this.moves, now)`.
  - `case 'stop'`: `this.moves = []` beside `this.flashes = []`.
- [ ] **Step 3: Each move.**
  - `case 'turnaround'`: after `dropRadioFlashes(this.flashes, key)`, also
    `this.moves = dropRadioMoveVisuals(this.moves, key)`. After `e.applyTurnaround(...)` succeeds:
    `const b = e.clock(a.time - 1e-3)`, then
    `this.moves.push(...radioTurnaroundVisuals(a.plan, { wrapAt: a.time, unitsPerBeat: 60 / (b?.bpm ?? this.s.bpm), loopBars: b?.loopBars ?? this.s.loopBars, key }))`.
    Its flashes: `this.flash(f.rowId, f.word, a.time - f.beats * secPerBeat, key, a.time)`. (The
    web has no late gap rows: no `lateRowIds`.)
  - `case 'cancelTurnaround'`: drop `turnaround@${a.time}` from `moves` too.
  - `land()`, `hookSwap()` and `addRow`, once the engine has answered `kind`:
    `this.moves.push(...radioGestureVisuals({ kind, rowId: slot, beats: t.beats, wrapAt: at, before: lap(at - 1e-3), after: lap(at), duckRowIds, key: `${slot}@${at}` }))`, where
    `duckRowIds` (only for `duck`) = `this.s.rows` with a record, not `slot`, and not a row
    already holding a visual or flash keyed `${row}@${at}`. Then, for every kind, remove any
    `duck` visual on `slot` that starts at `at` (`v.move === 'duck' && v.rowId === slot &&
    Math.abs(v.points[0].at - at) < 1e-3`): this row changes on that wrap, so the engine does not
    dip it. The flash's `until`: a lead-in's `at`; an arrival's
    `at + Math.min(t.beats / 4, after.loopBars / 2) * after.unitsPerBar`.
  - `case 'removeRow'` (the arc's exit): after `e.removeRow(a.slot, a.time, { kind: 'hole', ... })`
    succeeds, `radioGestureVisuals({ kind: 'drop-out', rowId: a.slot, beats: a.exitBeats, wrapAt: a.time, before: lap(a.time - 1e-3), after: lap(a.time - 1e-3), key: `remove@${a.slot}@${a.time}` })`.
    Skip it on the fallback (a plain fade at the top).
  - `throwNow(p)`: after `e.throwDelay(...)`,
    `const bpm = this.s.bpm; const delay = throwDelaySec(bpm, p.timing); const v = radioThrowVisual({ rowId: p.slot, at: p.at, open: (p.beats * 60) / bpm, delay, feedback: p.feedback, shiftBars: delay / (240 / bpm), key: `throw@${p.at}` }); if (v) this.moves.push(v)`.
    Its flash: `until: p.at + (p.beats * 60) / bpm`.
  - `case 'cancelThrow'`: drop `throw@${a.at}` from `moves` too.
  - **Rests:** `hookRest(slot, at)` and `arcLanding(slot, ..., 'rest')`, once the engine took it:
    `this.moves.push(radioRestVisual({ rowId: slot, from: at, until: null, key: `${slot}@${at}` }))`.
    A return onto a resting row (`hookSwap` with `event === 'return'` and `muted !== undefined`,
    and `arcLanding(..., 'return')`): `this.moves = closeRadioRestVisuals(this.moves, slot, at)`
    and remember `this.restReturns.set(`${slot}@${at}`, { slot, at })`.
  - `case 'cancel'`: beside `dropRadioFlashes(this.flashes, `${a.slot}@${a.time}`)`: drop the
    same key from `moves`, and if `restReturns` has it, `reopenRadioRestVisuals(this.moves, slot,
    at)` and delete it. Clear `restReturns` on `stop`, and prune entries whose `at` has passed in
    `tick()`.
- [ ] **Step 4: `step.ts`'s `describe`.** The row's flash:
  `flash: radioFlashShown(flashes, r.id, t.now, barSec, { in: RADIO_FLASH_FADE_IN_SEC, out: RADIO_FLASH_FADE_OUT_SEC })`
  (import both from `@shared/radioReadout`). fullModel's `flashes()` then reads
  `opacity: r.flash.opacity ?? radioFlashOpacity(r.flash.t)` (Task 4).
- [ ] **Step 5: Verify, commit.** `npx vitest run src/radio`, `npm run typecheck`. The action log
  is untouched (the visuals are the controller's, never the reducer's): run the byte-identity
  harness of intensity Task 7 Step 3 if it is still in the tree, else say so. Message:
  `radio: the moves' visuals log (sssketch spec 2026-10-05-radio-move-visuals-design) -- the controller logs every move it schedules as @shared radioMoveVisuals, on the AudioContext's clock and keyed as its flashes: turnarounds (radioTurnaroundVisuals on the clock before the wrap), gestures as the engine answered them (a cut is nothing; a duck on the rows the engine dips), the arc's exit drop-out, throws' echoes, hook and arc rests (closed by their return, reopened if it is taken back); take-backs drop them with their words, stop clears them. Move words carry their move's end (until) and fade in 100 ms / out 150 ms (describe). Decisions unchanged: the action log is the reducer's`,
  then the trailer.

### Task 4: Full mode draws them (`moveFrame.ts`, `full.ts`, `full.css`, `main.ts`)

**Repo:** ell.ing/radio. **Depends on:** Task 3.

**Files:**
- Create: `src/ui/moveFrame.ts`, `src/ui/moveFrame.test.ts`
- Modify: `src/ui/full.ts`, `src/ui/full.css`, `src/ui/palette.test.ts`, `src/main.ts`; and
  `src/ui/fullModel.ts` (+ test) only for `FullRow.resting` and the flash opacity if Task 8 did
  not add them.

- [ ] **Step 1: The frame's model, test first.** Create `src/ui/moveFrame.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { radioRestVisual, radioTurnaroundVisuals } from '@shared/radioMoveVisuals'
import { turnaroundDropCurve, turnaroundLiftCurve, type TurnaroundPlan } from '@shared/radioTurnaround'
import type { RadioRowView } from '../radio/step'
import type { FullView } from './fullModel'
import { moveFrame } from './moveFrame'

const row = (slot: string, stemId: string | null = slot): RadioRowView => ({
  slot,
  stemId,
  bars: 4,
  kinds: ['drums'],
  audible: true,
  name: slot,
  jam: 'j',
  muted: false,
  flag: null,
  approach: null
})
const view = (phase: FullView['phase'] = 'running'): Pick<FullView, 'phase' | 'rows' | 'loopBars'> => ({
  phase,
  loopBars: 8,
  rows: [row('drums'), row('pad'), row('empty', null)]
})

// 120 bpm: a beat is 0.5 s; riser + drums out + lift on pad into the wrap at 100 s, a 2-beat gap
const plan: TurnaroundPlan = {
  move: 'riser',
  beats: 8,
  halvings: 0,
  riserBars: 1.5,
  gapBeats: 2,
  rows: [
    { rowId: 'drums', volume: turnaroundDropCurve(8, 4) },
    { rowId: 'pad', filter: turnaroundLiftCurve(8), volume: turnaroundDropCurve(8, 2) }
  ],
  parts: [
    { move: 'riser', beats: 8, rowIds: [] },
    { move: 'drum drop', beats: 4, rowIds: ['drums'] },
    { move: 'lift', beats: 8, rowIds: ['pad'] }
  ]
}
const v = radioTurnaroundVisuals(plan, { wrapAt: 100, unitsPerBeat: 0.5, loopBars: 8, key: 'turnaround@100' })

describe('moveFrame', () => {
  it('is null while nothing sounds, and when not running', () => {
    expect(moveFrame(v, view(), 90)).toBeNull()
    expect(moveFrame(v, view(), 100)).toBeNull() // the one: everything back
    expect(moveFrame(v, view('stopped'), 99)).toBeNull()
    expect(moveFrame([], view(), 99)).toBeNull()
  })

  it('styles every row with a stem while one sounds, and draws the riser on the ruler', () => {
    const f = moveFrame(v, view(), 98.5)!
    expect([...f.rows.keys()]).toEqual(['drums', 'pad'])
    expect(f.rows.get('drums')!['--mv-bright']).toBe('0.250') // drums out
    expect(f.rows.get('pad')!['--mv-bright']).toBe('1.000')
    expect(Number(f.rows.get('pad')!['--mv-low'])).toBeGreaterThan(0.5) // lifting
    expect(f.riser).toBeGreaterThan(0.5)
    const gap = moveFrame(v, view(), 99.75)!
    expect(gap.rows.get('pad')!['--mv-bright']).toBe('0.250') // the gap
    expect(gap.riser).toBe(0)
  })

  it('reduced motion: steady states, no riser', () => {
    const f = moveFrame(v, view(), 98.5, true)!
    expect(f.riser).toBe(0)
    expect(f.rows.get('pad')!['--mv-low']).toBe('0.600')
  })

  it('a resting row is dimmed by its state, even with no rest logged', () => {
    const v2 = { ...view(), rows: [row('drums'), { ...row('pad'), resting: 'arc' }] }
    expect(moveFrame([], v2, 400)!.rows.get('pad')!['--mv-bright']).toBe('0.250')
    expect(moveFrame([], v2, 400)!.rows.get('drums')!['--mv-bright']).toBe('1.000')
  })

  it('a resting row stays dimmed while its rest holds', () => {
    const f = moveFrame([radioRestVisual({ rowId: 'pad', from: 50, until: null, key: 'pad@50' })], view(), 400)!
    expect(f.rows.get('pad')!['--mv-bright']).toBe('0.250')
    expect(f.rows.get('drums')!['--mv-bright']).toBe('1.000')
  })
})
```

  Run `npx vitest run src/ui/moveFrame.test.ts`: fails to load. Create `src/ui/moveFrame.ts`:

```ts
// src/ui/moveFrame.ts -- full mode's move visuals for one frame (sssketch spec
// 2026-10-05-radio-move-visuals-design): each row's look while a move sounds on it (dims, filter
// thinning, the wash, a riser line, a throw's ghost), from the controller's log of what it
// scheduled (RadioController.moveVisuals), read at the AudioContext's time this frame -- the clock
// the audio follows, not the controller's ~30 Hz tick. Pure: full.ts's frame() writes the CSS
// custom properties it returns (@shared/radioMoveVisuals radioRowVisualVars).
import { discoverWindowLayout } from '@shared/discoverWindowLayout'
import {
  RADIO_VISUAL_FADE_SEC,
  radioMoveVisualsSounding,
  radioRowVisualAt,
  radioRowVisualVars,
  type RadioMoveVisual
} from '@shared/radioMoveVisuals'
import type { RadioRowView } from '../radio/step'
import type { FullView } from './fullModel'

export interface FullMoves {
  /** Each row's CSS custom properties (--mv-bright, --mv-low, ...), by slot. */
  rows: Map<string, Record<string, string>>
  /** A turnaround's riser on the ruler, 0..1 of its length (0 under reduced motion). */
  riser: number
}

/** A row as moveFrame reads it. `resting` (a hook's or the intensity arc's rest, RadioRowView's
 * from the intensity arc's Task 8): the row is silent whatever the log says. */
export type MoveFrameRow = Pick<RadioRowView, 'slot' | 'stemId' | 'bars'> & { resting?: string | null }

/** The frame's move visuals at `now` (AudioContext seconds). Null when nothing sounds -- not
 * running, no move between its first and last points, and no row resting -- so frame() puts every
 * row back at rest once and does nothing more until one does. `reducedMotion`: steady states, no
 * fades, sweeps or glows. */
export function moveFrame(
  visuals: readonly RadioMoveVisual[],
  view: Pick<FullView, 'phase' | 'loopBars'> & { rows: readonly MoveFrameRow[] },
  now: number,
  reducedMotion = false
): FullMoves | null {
  if (view.phase !== 'running') return null
  const resting = (r: MoveFrameRow): boolean => r.resting != null && r.resting !== ''
  if (!radioMoveVisualsSounding(visuals, now) && !view.rows.some(resting)) return null
  const fade = reducedMotion ? 0 : RADIO_VISUAL_FADE_SEC
  const rows = new Map<string, Record<string, string>>()
  for (const r of view.rows) {
    if (!r.stemId) continue
    const { windowBars } = discoverWindowLayout({ stemBars: r.bars, loopBars: view.loopBars })
    const look = radioRowVisualAt(visuals, r.slot, now, fade)
    // the state is the truth: a resting row is silent even with its rest not (or no longer) logged
    if (resting(r)) look.level = 0
    rows.set(r.slot, radioRowVisualVars(look, { windowBars, reducedMotion }))
  }
  return { rows, riser: reducedMotion ? 0 : radioRowVisualAt(visuals, null, now, fade).riser }
}
```

  Run it again: 5 passed. (`MoveFrameRow.resting` matches `RadioRowView.resting`, which web Task 7
  added as `'hook' | 'arc' | null`.)
- [ ] **Step 2: The page.** `src/ui/full.ts` (against 4fde28f; rebase onto Task 8's version,
  anchored on `makeRow`, `draw`, `frame` and the ruler's construction):

```diff
--- a/src/ui/full.ts
+++ b/src/ui/full.ts
@@ -24,6 +24,7 @@
 import { RADIO_PACE_LABEL, RADIO_PACE_TOOLTIP, radioPaceLabel } from '@shared/radioPace'
 import { RADIO_DIG_STOP_TOOLTIP, RADIO_DIG_TOOLTIP, RADIO_HOOK_BRING_BACK_TOOLTIP, RADIO_HOOK_RELEASE_TOOLTIP, RADIO_HOOK_TOOLTIP } from '@shared/radioHooks'
 import type { PeaksCache } from './peaks'
+import type { FullMoves } from './moveFrame'
 
 export type FullControlId = ControlId | 'simple'
 /** A row's buttons: mute, skip (swap this stem out now, at the next bar: Elling's "change it",
@@ -71,13 +72,14 @@
   readonly el: HTMLElement
   render(model: FullModel): void
   /** The playhead (percent of the window, null for none), the rows' breath (0..1), each folded
-   * row's phase dot (0..1 round its cycle, fullModel's foldDots), and each row's gesture flash
-   * (fullModel's flashes), by slot. */
+   * row's phase dot (0..1 round its cycle, fullModel's foldDots), each row's gesture flash
+   * (fullModel's flashes), by slot, and the moves sounding now (moveFrame; null: none). */
   frame(
     sweepPct: number | null,
     breath: number,
     foldDots?: ReadonlyMap<string, number>,
-    flashes?: ReadonlyMap<string, { word: string; opacity: number }>
+    flashes?: ReadonlyMap<string, { word: string; opacity: number }>,
+    moves?: FullMoves | null
   ): void
   /** The mastering chain's gain reduction, as text. */
   readout(text: string): void
@@ -176,6 +178,9 @@
 
 const dark = matchMedia('(prefers-color-scheme: dark)')
 
+/** The custom properties a move sets on a row's .wave (@shared/radioMoveVisuals radioRowVisualVars). */
+const MOVE_VARS = ['--mv-bright', '--mv-low', '--mv-high', '--mv-wash', '--mv-riser', '--mv-ghost', '--mv-ghost-shift']
+
 /** Call `fn` whenever devicePixelRatio changes (a window dragged to another screen, a zoom). */
 function onDprChange(fn: () => void): void {
   const q = matchMedia(`(resolution: ${devicePixelRatio}dppx)`)
@@ -193,6 +198,8 @@
   el: HTMLDivElement
   wave: HTMLDivElement
   canvas: HTMLCanvasElement
+  /** A throw's ghost: the waveform's copy, trailing it (moveFrame's --mv-ghost). */
+  ghost: HTMLCanvasElement
   ph: HTMLDivElement
   /** Fold mode's readout: the cycle against the loop, and the phase dot. */
   fold: HTMLDivElement
@@ -250,7 +257,10 @@
   ruler.setAttribute('aria-hidden', 'true')
   const rulerTicks = h('div', 'ruler-ticks')
   const rulerEnd = h('span', 'ruler-end')
-  ruler.append(rulerTicks, rulerEnd)
+  // a turnaround's riser, a line along the ticks filling toward the one while it sounds
+  const rulerTrack = h('div', 'ruler-track')
+  rulerTrack.append(rulerTicks, h('span', 'ruler-riser'))
+  ruler.append(rulerTrack, rulerEnd)
   top.append(toggle, status, tr)
 
   // ---- rows ----
@@ -271,8 +281,16 @@
     const el = h('div', 'row')
     el.setAttribute('role', 'group')
     const wave = h('div', 'wave')
-    const canvas = h('canvas')
+    const canvas = h('canvas', 'main')
     canvas.setAttribute('aria-hidden', 'true')
+    // a radio move's look while it sounds (sssketch spec 2026-10-05-radio-move-visuals-design): a
+    // throw's ghost over the waveform, trailing it and clipped to it, and a change's riser line along
+    // its foot
+    const ghostClip = h('div', 'mv-ghost')
+    const ghost = h('canvas')
+    ghost.setAttribute('aria-hidden', 'true')
+    ghostClip.append(ghost)
+    const riser = h('div', 'mv-riser')
     const ph = h('div', 'ph')
     // fold mode's readout (sssketch spec 2026-10-03-radio-fold-v2-design section 2): the row's cycle
     // against the loop in beats, and a dot going round the cycle, on the downbeat (left) when the
@@ -304,7 +322,7 @@
     cue.append(flash, nextNote)
     // the bottom bar: the away hook's name (its own, left, shrinking) and the cue (right, whole)
     const bottom = h('div', 'bottom')
-    wave.append(canvas, ph, fold, info, bottom)
+    wave.append(canvas, ghostClip, riser, ph, fold, info, bottom)
     const btns = h('div', 'btns')
     const mute = letterButton('m', 'mute', () => on.row(slot, 'mute'))
     const solo = letterButton('s', 'solo', () => on.row(slot, 'solo'))
@@ -336,7 +354,7 @@
     const roleNote = h('span', 'hold-note')
     roleNote.id = `role-${slot}`
     el.append(wave, btns, holdNote, roleNote)
-    const r: RowEls = { el, wave, canvas, ph, fold, foldLabel, foldDot, info, infoLabel, infoTail, nextNote, flash, mute, solo, skip, like, dislike, hook, dig, hookAway, hookAwayName, roleNote, row: null, drawn: '' }
+    const r: RowEls = { el, wave, canvas, ghost, ph, fold, foldLabel, foldDot, info, infoLabel, infoTail, nextNote, flash, mute, solo, skip, like, dislike, hook, dig, hookAway, hookAwayName, roleNote, row: null, drawn: '' }
     resize.observe(canvas)
     return r
   }
@@ -381,6 +399,15 @@
       }
     } else {
       g.fillRect(0, Math.floor(mid), W, Math.max(1, Math.round(dpr / 2))) // not decoded yet
+    }
+    // the ghost is the waveform alone, without the lines
+    const gh = r.ghost
+    if (gh.width !== W) gh.width = W
+    if (gh.height !== H) gh.height = H
+    const gg = gh.getContext('2d')
+    if (gg) {
+      gg.clearRect(0, 0, W, H)
+      gg.drawImage(c, 0, 0)
     }
     const lw = Math.max(1, Math.round(dpr))
     g.fillStyle = ink
@@ -738,7 +765,7 @@
         draw(r)
       }
     },
-    frame(pct, b, foldDots, flashes) {
+    frame(pct, b, foldDots, flashes, moves) {
       rowsEl.style.setProperty('--breath', b.toFixed(4))
       for (const [slot, r] of rows) {
         const show = pct !== null && !!r.row?.layout
@@ -753,7 +780,18 @@
           if (r.flash.textContent !== f.word) r.flash.textContent = f.word
           r.flash.style.opacity = f.opacity.toFixed(3)
         }
+        // the moves sounding now: the row's custom properties while one does, back at rest once
+        const vars = moves?.rows.get(slot)
+        if (vars) {
+          for (const k in vars) r.wave.style.setProperty(k, vars[k])
+          r.wave.dataset.mv = ''
+        } else if (r.wave.dataset.mv !== undefined) {
+          for (const k of MOVE_VARS) r.wave.style.removeProperty(k)
+          delete r.wave.dataset.mv
+        }
       }
+      if (moves) ruler.style.setProperty('--mv-riser', moves.riser.toFixed(3))
+      else ruler.style.removeProperty('--mv-riser')
     },
     readout(text) {
       if (reduction.textContent !== text) reduction.textContent = text
```

  `src/ui/full.css`:

```diff
--- a/src/ui/full.css
+++ b/src/ui/full.css
@@ -170,6 +170,24 @@
 .full .wave { position: relative; height: 40px; min-width: 0; }
 .full .wave canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
 .full .ph { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--mark); display: none; pointer-events: none; }
+/* a radio move while it sounds (sssketch spec 2026-10-05-radio-move-visuals-design; frame() sets the
+   custom properties from @shared/radioMoveVisuals on .wave, [data-mv] only while one sounds):
+   brightness and shape only. The waveform dims to 25% while its row is silent (a drop, the gap, a
+   rest), its lower half thins under a lift and its upper half under a dip or a filter in, it
+   softens under a wash; a throw's ghost trails it, clipped to the row; a change's riser fills a
+   line along its foot. Nothing is drawn at rest */
+.full .wave .mv-ghost { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
+.full .wave .mv-ghost canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; opacity: 0; }
+.full .wave .mv-riser { position: absolute; left: 0; right: 0; bottom: 0; height: 1px; background: var(--ink); transform: scaleX(0); transform-origin: left; pointer-events: none; }
+.full .wave[data-mv] canvas.main {
+  opacity: var(--mv-bright);
+  filter: blur(calc(var(--mv-wash) * 2px));
+  -webkit-mask-image: linear-gradient(to bottom, rgb(0 0 0 / calc(1 - 0.85 * var(--mv-high))), #000 50%, rgb(0 0 0 / calc(1 - 0.85 * var(--mv-low))));
+  mask-image: linear-gradient(to bottom, rgb(0 0 0 / calc(1 - 0.85 * var(--mv-high))), #000 50%, rgb(0 0 0 / calc(1 - 0.85 * var(--mv-low))));
+}
+/* one repeat's delay is a couple of pixels on a 32-bar window: the trail is at least 6px, so it reads */
+.full .wave[data-mv] .mv-ghost canvas { opacity: calc(var(--mv-ghost) * 0.45); transform: translateX(max(var(--mv-ghost-shift), 6px)); }
+.full .wave[data-mv] .mv-riser { transform: scaleX(var(--mv-riser)); }
 /* fold mode's readout on a folded row (full.ts): its cycle against the loop in beats over the
    waveform's top right, and under it the phase dot's track, the dot at its left end on the
    downbeat, where it sits when the row realigns */
@@ -190,7 +208,10 @@
 .full .status[hidden], .full .status-line[hidden], .full .ruler[hidden] { display: none; }
 .full .status-line { max-width: 100%; white-space: normal; overflow-wrap: anywhere; }
 .full .ruler { display: flex; align-items: center; gap: 6px; width: 100%; max-width: 320px; }
+.full .ruler-track { position: relative; flex: 1; display: flex; }
 .full .ruler-ticks { flex: 1; display: flex; gap: 1px; height: 1px; }
+/* a turnaround's riser (the mix's, @shared/radioMoveVisuals): a line under the ticks, filling toward the one */
+.full .ruler-riser { position: absolute; left: 0; right: 0; top: 3px; height: 1px; background: var(--ink); transform: scaleX(var(--mv-riser, 0)); transform-origin: left; pointer-events: none; }
 .full .ruler-ticks span { flex: 1; background: var(--faint); }
 .full .ruler-ticks span.on { background: var(--ink); }
 .full .ruler-end { font-size: 9px; line-height: 1; white-space: nowrap; }
```

- [ ] **Step 3: A rest is drawn in ink** (decision 11). `draw()` fills the peaks with
  `row.audible ? ink : css('--faint')`. A resting row is not `audible` (`sounding`), so it was
  faint. Make it `row.audible || row.resting ? ink : css('--faint')`, add `row?.resting` to
  `draw`'s redraw key, and give `FullRow` a `resting: boolean` (`r.resting != null` from the
  view), unless Task 8 already did (check `fullModel.ts`'s `FullRow` and its test first). A
  fullModel test: a row with `resting: 'hook'` and `audible: false` has `resting: true`.
- [ ] **Step 4: The flash's opacity.** fullModel's `flashes()`:
  `opacity: r.flash.opacity ?? radioFlashOpacity(r.flash.t)`; its test: a flash carrying
  `opacity` is drawn at it.
- [ ] **Step 5: `palette.test.ts`** (the wash's blur is the one other filter on the page,
  decision 7):

```diff
--- a/src/ui/palette.test.ts
+++ b/src/ui/palette.test.ts
@@ -1,6 +1,7 @@
 // The page's CSS, read as text: Fluoddity's canvas is only ever under one filter. Simple mode's
 // (its palette's invert) and full mode's (the light scheme's invert + hue-rotate) are keyed to
-// body[data-mode], which holds one mode at a time; nothing else on the page is filtered.
+// body[data-mode], which holds one mode at a time; nothing else on the page is filtered but a row's
+// wash while it sounds (a blur, full.css's move visuals).
 /// <reference types="node" />
 // (the files are read from disk: vitest hands CSS imports back empty, even ?raw)
 import { readFileSync } from 'node:fs'
@@ -30,7 +31,12 @@
   })
 
   it('filters only the canvas, once per mode, never both', () => {
-    const rules = [...filterRules(css.simple), ...filterRules(css.full), ...filterRules(css.intro)]
+    // the one other filter: a row's wash while it sounds (sssketch spec 2026-10-05-radio-move-
+    // visuals-design), a blur and nothing else -- never a palette change
+    const isWash = (r: { selector: string }) => r.selector === '.full .wave[data-mv] canvas.main'
+    const wash = filterRules(css.full).filter(isWash)
+    expect(wash).toEqual([{ selector: '.full .wave[data-mv] canvas.main', value: 'blur(calc(var(--mv-wash) * 2px))' }])
+    const rules = [...filterRules(css.simple), ...filterRules(css.full).filter((r) => !isWash(r)), ...filterRules(css.intro)]
     expect(rules.length).toBeGreaterThan(0)
     for (const r of rules) expect(r.selector).toMatch(/#fluoddity$/)
     const simple = rules.filter((r) => r.selector.includes("body[data-mode='simple']"))
```

- [ ] **Step 6: `main.ts`.** In `tick`'s full-mode branch, the `full.frame(...)` call gains a fifth
  argument:
  `playing && engine && radio ? moveFrame(radio.moveVisuals(), v, engine.now, reducedMotion.matches) : null`,
  with `const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')` at module level
  (beside `dark` / the other media queries). Keep the existing `if (playing || !frameIdle)`
  guard: the stopped frame passes null once, which clears every row.
- [ ] **Step 7: Verify, commit.** `npx vitest run src`, `npm run typecheck`, `npm run build`,
  `npm run check:engine`. Message:
  `full mode: radio's moves shown while they sound (sssketch spec 2026-10-05-radio-move-visuals-design) -- moveFrame reads the controller's log at the AudioContext's time every frame (null while nothing sounds and no row rests); frame() sets each row's --mv-* on .wave ([data-mv] only while a move sounds): the waveform at 25% while silent (drops, the gap, rests, a duck's dip), its lower half thinned by a lift and its upper half by a dip or a filter in, blurred by a wash, a throw's ghost trailing it (at least 6 px), a change's riser along its foot, a turnaround's riser under the ruler; steady states under reduced motion; a resting row drawn in ink at the floor, not faint; flashes at their quick fades. palette.test.ts: the wash's blur is the one other filter. Seen in headless Chrome only (Task 5); no agent heard it or held a phone`,
  then the trailer.

### Task 5: Headless screenshots at 320 and 390 px

**Repo:** ell.ing/radio (read only). **Depends on:** Task 4.

The harness mounts full mode with six synthetic rows, each in a different move at one moment 0.3 s
before a wrap (drums out, lift, dip, wash, throw, a change's riser; the ruler's riser), built with
the real adapters and `moveFrame`, and posts its measurements back to the dev server. It is in the
planning scratchpad (`shots/`); copy it to this session's scratchpad. Nothing goes in the repo.

- [ ] **Step 1: The harness.** `index.html`:

```html
<!doctype html><html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Silkscreen&display=swap" />
<style>html{background:#000}html,body{margin:0;height:100%;overflow:hidden;font-family:Silkscreen,monospace}</style></head>
<body data-mode="full"><div id="app"></div><script type="module" src="./harness.ts"></script></body></html>
```

  `harness.ts`:

```ts
// Headless screenshots of full mode's move visuals (plan 2026-10-05-radio-move-visuals, web Task
// step "screenshots"): five rows, each in a different move at one moment, the ruler's riser, at
// 320/390 px light and dark; ?state=rest draws the same rows with nothing sounding; ?reduced=1
// the reduced-motion steady states. Prints its measurements into <pre id="out">.
import { mountFull } from '/src/ui/full.ts'
import { fullModel } from '/src/ui/fullModel.ts'
import { moveFrame } from '/src/ui/moveFrame.ts'
import { PeaksCache } from '/src/ui/peaks.ts'
import { radioRestVisual, radioThrowVisual, radioTurnaroundVisuals, radioGestureVisuals } from '@shared/radioMoveVisuals'
import { turnaroundDipCurve, turnaroundDropCurve, turnaroundLiftCurve, turnaroundWashCurve } from '@shared/radioTurnaround'

const q = new URLSearchParams(location.search)
const state = q.get('state') ?? 'moves'
const reduced = q.get('reduced') === '1'
const noop = () => {}
const peaks = new PeaksCache()
const ids = ['a', 'b', 'c', 'd', 'e', 'f'].map((c) => c.repeat(32))
for (const id of ids) {
  const p = new Float32Array(400)
  let seed = id.charCodeAt(0)
  for (let i = 0; i < p.length; i++) {
    seed = (seed * 16807) % 2147483647
    p[i] = 0.25 + 0.65 * Math.abs(Math.sin(i * 0.37)) * (seed / 2147483647)
  }
  ;(peaks as any).map.set(id, p)
}
const handlers: any = new Proxy({}, { get: (_t, k) => {
  if (k === 'readMaster') return () => ({ reverb: 0.25, lp: 1, hp: 0, res: 0, bypass: false })
  if (k === 'readFx') return () => ({ saturation: 0.5, pump: 0.5, echo: 1 })
  if (k === 'readTurnarounds') return () => ({ moves: [], depth: 'bold' })
  if (k === 'readFold') return () => ({ on: false, seed: 'x', fold: 50, clash: 50 })
  if (k === 'readFaves') return () => 0
  if (k === 'readSource') return () => 95
  if (k === 'readPace') return () => 50
  if (k === 'readVisuals') return () => false
  if (k === 'readInvert') return () => false
  return noop
} })
const full = mountFull(document.getElementById('app')!, handlers, peaks)
const kinds: any[] = [['drums'], ['bass'], ['lead'], ['pad'], ['warm'], ['rhythmic']]
const names = ['kick thing', 'low wobble', 'shiny lead', 'soft pad', 'warm keys', 'shaker']
const rows = names.map((name, i) => ({ slot: `r${i}`, kinds: kinds[i], stemId: ids[i], audible: true, name, jam: 'jam one', bars: 4, muted: false, flag: null, approach: null, hook: null }))
const words = ['drums out', 'lift', 'dip', 'wash', 'throw', 'riser']
const readout = {
  statusLine: 'turn: drums out + lift → gap', ruler: { ticks: 16, filled: 15, end: 'turn' },
  rows: rows.map((r, i) => ({ rowId: r.slot, label: `${kinds[i][0]} · busy`, age: '3 laps', nextLabel: null, flash: null }))
}
const v: any = { phase: 'running', bpm: 120, tempoTarget: null, held: false, pace: 50, loopBars: 8, rows, readout }
full.render(fullModel(v, { narrow: innerWidth < 360 }))
full.el.hidden = false
full.el.style.display = ''
// one moment, 0.6 beats before the wrap at 100 s (120 bpm: a beat is 0.5 s)
const W = 100
const now = W - 0.3
const ta = radioTurnaroundVisuals(
  {
    move: 'riser', beats: 8, halvings: 0, riserBars: 2, gapBeats: 0,
    rows: [
      { rowId: 'r0', volume: turnaroundDropCurve(8, 4) },
      { rowId: 'r1', filter: turnaroundLiftCurve(8) },
      { rowId: 'r2', filter: turnaroundDipCurve(8) },
      { rowId: 'r3', reverbSend: turnaroundWashCurve(8) }
    ]
  },
  { wrapAt: W, unitsPerBeat: 0.5, loopBars: 8, key: `turnaround@${W}` }
)
const throwV = radioThrowVisual({ rowId: 'r4', at: W - 1.5, open: 0.5, delay: 0.375, feedback: 0.6, shiftBars: 0.1875, key: 'throw' })!
const change = radioGestureVisuals({ kind: 'riser', rowId: 'r5', beats: 8, wrapAt: W, before: { loopBars: 8, unitsPerBar: 2 }, after: { loopBars: 8, unitsPerBar: 2 }, key: `r5@${W}` })
const visuals = state === 'rest' ? [] : [...ta, throwV, ...change]
const moves = moveFrame(visuals, v, now, reduced)
const flashes = new Map(state === 'rest' ? [] : rows.map((r, i) => [r.slot, { word: words[i], opacity: 1 }] as [string, { word: string; opacity: number }]))
full.frame(50, 0.5, new Map(), flashes, moves)
setTimeout(() => {
  const out: any = { w: innerWidth, state, reduced, docScroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth, rows: [] }
  for (const el of document.querySelectorAll('.full .row')) {
    const wave = el.querySelector('.wave') as HTMLElement
    const main = getComputedStyle(wave.querySelector('canvas.main')!)
    const ghost = getComputedStyle(wave.querySelector('.mv-ghost canvas')!)
    const riser = getComputedStyle(wave.querySelector('.mv-riser')!)
    out.rows.push({ mv: wave.dataset.mv !== undefined, opacity: main.opacity, filter: main.filter, mask: main.maskImage?.slice(0, 60) || main.webkitMaskImage?.slice(0, 60), ghost: [ghost.opacity, ghost.transform], riser: riser.transform, waveRight: Math.round(wave.getBoundingClientRect().right) })
  }
  out.rulerRiser = getComputedStyle(document.querySelector('.ruler-riser')!).transform
  void fetch('/radio/__mvout', { method: 'POST', body: JSON.stringify(out) })
}, 1200)
```

  `run.mjs` (Chrome over CDP: headless Chrome will not open a window under 500 px, so the
  viewport is emulated):

```js
// node run.mjs -- full mode's move visuals in headless Chrome at 320 and 390 px, light and dark,
// plus nothing sounding and reduced motion. Vite serves the web copy (WEB_DIR, default ../web) with
// @shared from SSSKETCH_DIR (default ../sssketch); Chrome is driven over CDP so the viewport can be
// narrower than headless Chrome's 500 px window minimum. Screenshots and measure.txt go to ./out.
import { spawn } from 'node:child_process'
import { readFileSync, mkdtempSync, appendFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const H = new URL('.', import.meta.url).pathname.replace(/\/$/, '')
const WEB = process.env.WEB_DIR ?? join(H, '..', 'web')
process.env.SSSKETCH_DIR ??= join(H, '..', 'sssketch')
const { createServer } = await import(join(WEB, 'node_modules/vite/dist/node/index.js'))
const PORT = 5241
let measured = null
const server = await createServer({
  root: WEB, configFile: join(WEB, 'vite.config.ts'), logLevel: 'error',
  server: { port: PORT, strictPort: true, fs: { allow: [WEB, H, process.env.SSSKETCH_DIR] } },
  plugins: [{ name: 'mv', configureServer(s) {
    s.middlewares.use('/radio/__mvout', (req, res) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => { measured?.(b); res.end('ok') }) })
    s.middlewares.use('/radio/__mv', async (req, res) => {
      let html = readFileSync(H + '/index.html', 'utf8').replace('./harness.ts', '/@fs' + H + '/harness.ts')
      html = await s.transformIndexHtml('/radio/__mv', html)
      res.setHeader('content-type', 'text/html'); res.end(html)
    })
  } }]
})
await server.listen()
const CDP = 9341
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--mute-audio', '--disable-gpu', '--hide-scrollbars', '--no-first-run', `--remote-debugging-port=${CDP}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'mv-'))}`, 'about:blank'])
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
let list = null
for (let i = 0; i < 50 && !list; i++) { try { list = await (await fetch(`http://localhost:${CDP}/json/list`)).json() } catch { await wait(200) } }
const ws = new WebSocket(list.find((p) => p.type === 'page').webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
let id = 0
const pending = new Map()
ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id) } })
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
await send('Page.enable')
writeFileSync(H + '/out/measure.txt', '')
const cases = []
for (const w of [320, 390]) for (const scheme of ['light', 'dark']) cases.push([w, scheme, 'moves', '0'])
cases.push([390, 'dark', 'rest', '0'], [390, 'dark', 'moves', '1'])
for (const [w, scheme, state, reduced] of cases) {
  const name = `full-${w}-${scheme}-${state}${reduced === '1' ? '-reduced' : ''}`
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: 760, deviceScaleFactor: 2, mobile: true })
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }, { name: 'prefers-reduced-motion', value: reduced === '1' ? 'reduce' : 'no-preference' }] })
  const got = new Promise((r) => (measured = r))
  await send('Page.navigate', { url: `http://localhost:${PORT}/radio/__mv?state=${state}&reduced=${reduced}` })
  const m = await Promise.race([got, wait(20000).then(() => 'NO MEASURE')])
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`${H}/out/${name}.png`, Buffer.from(shot.result.data, 'base64'))
  appendFileSync(H + '/out/measure.txt', `${name} ${m}\n`)
  console.log(name, String(m).slice(0, 200))
}
ws.close(); chrome.kill(); await server.close(); process.exit(0)
```

- [ ] **Step 2: Run it** against the repo: `WEB_DIR=/Users/nickel/Claudecode/ell.ing/radio
  SSSKETCH_DIR=/Users/nickel/Claudecode/sssketch node run.mjs`. Six screenshots and
  `out/measure.txt`.
- [ ] **Step 3: Check, and say what was seen.**
  - Every case: `docScroll === client` (320, 390): no horizontal scroll; every row's
    `waveRight` inside the viewport.
  - `moves`: row 0 `opacity` 0.25; row 1's mask's lower stop and row 2's upper stop thinned; row 3
    `filter: blur(...)` above 1 px; row 4's ghost `opacity` above 0 and `translateX` at least
    6 px; row 5's riser and `rulerRiser` scaled above 0.5; the flash words on their plates, none
    clipped.
  - `rest`: no row has `data-mv`; `opacity` 1, no mask, no filter.
  - `moves-reduced`: no blur, no ghost, no riser; the filter rows at the steady 0.6.
  - Look at each PNG, light and dark: the dims, thinning, blur and lines read, nothing overlaps the
    readout or cue plates, and the riser lines sit inside the row and the ruler.
  - The planning run (scratch `web/`) passed all of these. Its ghost was the faintest look on
    dense synthetic peaks (risk 4). Judge it on real peaks in the walkthrough.
  - Say plainly: seen in headless Chrome only, on synthetic peaks.

**Ship point A.** Elling listens to and watches ell.ing/radio's local build (walkthrough items
1-6, 8-9 on the web). Upload and deploy wait for his go-ahead.

---

## Phase 3: the desktop

### Task 6: The panel's log (`DiscoverPanel.tsx`)

**Repo:** sssketch. **File:** `src/renderer/src/components/DiscoverPanel.tsx`.
**Depends on:** Tasks 1, 2. **Parallel with:** Tasks 3-5.

Units: bars played since radio started (the readout's clock, `radioPlayRef`). A beat is 1/4; a
second is `bpmRef.current / 240`. `fadeBars = RADIO_VISUAL_FADE_SEC * bpmRef.current / 240`;
the flash fades `{ in: RADIO_FLASH_FADE_IN_SEC * bpm / 240, out: RADIO_FLASH_FADE_OUT_SEC * bpm / 240 }`.

- [ ] **Step 1: Refs.** Beside `radioFlashLogRef` / `radioFlashSeenRef`:

```ts
  // THE MOVES SHOWN WHILE THEY SOUND (spec 2026-10-05-radio-move-visuals-design): what is armed,
  // as @shared/radioMoveVisuals on the readout's clock, rebuilt every tick (radioMoveVisualsTick),
  // with the bars played and the laps the sweep effect had counted when it was taken, so the
  // effect can read it at every position tick across a wrap (as the fold dots do).
  const radioMoveVisualsRef = useRef<{
    visuals: RadioMoveVisual[]
    startBars: number
    laps: number
  }>({ visuals: [], startBars: 0, laps: 0 })
  const radioMoveSeenRef = useRef<Set<string>>(new Set())
  // The rows resting for radio, as render needs them (the coloured layer, Task 7): set from the
  // tick when it changes.
  const [radioRestingShown, setRadioRestingShown] = useState<ReadonlySet<string>>(new Set())
```

  `resetRadioReadout` also resets the two refs and `setRadioRestingShown(new Set())`.
- [ ] **Step 2: `radioMoveVisualsTick(pos, loopBars)`**, called right after
  `radioFlashTick(pos, loopBars)` in the clock effect's microtask. Like `radioFlashTick`, it
  adds each armed thing's visuals once (by key, `radioMoveSeenRef`), collects `live`, and prunes:
  - `lapStart = radioPlayRef.current.startBars`, `now = lapStart + pos`,
    `lap = { loopBars, unitsPerBar: 1 }`.
  - **Gestures** (`radioGestureRef.current`), key `g.armId`: `radioGestureVisuals({ kind: g.kind,
    rowId: g.slotId, beats: g.beats, wrapAt: leads ? lapStart + loopBars : lapStart, before: lap,
    after: lap, duckRowIds, key: g.armId })`, `leads` as `radioFlashTick` computes it (a
    `drop-out` leads too: it plays into the wrap), `duckRowIds` =
    `[...previewingSlotIdsRef.current]` minus `g.slotId` and `g.spares`.
  - **The turnaround** (`radioTurnaroundRef.current`), key `ta.armId`, only when
    `turnaroundFitsLoop(ta.plan, loopBars)` (the lane build drops a plan that does not fit):
    `radioTurnaroundVisuals(ta.plan, { wrapAt: lapStart + loopBars, unitsPerBeat: 0.25, loopBars, key: ta.armId, lateRowIds: turnaroundGapLateRowIds(ta.plan, [...previewingSlotIdsRef.current]) })`.
  - **The throw** (`radioThrowRef.current.armed`), key `throw@${armed.startBars}`:
    `at = now + (armed.startBars - throws.elapsedBars)`, `open = armed.endBars - armed.startBars`,
    `delay = throwDelaySec(bpm, armed.timing) * bpm / 240`, `shiftBars = delay`.
  - **Rests**, key `rest@${rowId}`, live while `radioRestingRef.current.has(rowId)` or a decided
    landing `manualChangesRef.current.get(rowId)?.rest === true`. Added once:
    `from = lapStart + loopBars` for a decided one not landed yet, else `now`. Then each tick:
    - a return decided for a resting row (`m.hook === 'return'` or `m.arc === 'return'` on a row in
      `radioRestingRef`): `closeRadioRestVisuals(v, rowId, lapStart + loopBars)` if its rest is
      still open;
    - no return decided any more and the row still resting:
      `reopenRadioRestVisuals(v, rowId, <the until it was closed at>)` (keep a small
      `Map<rowId, until>` beside the seen set).
  - `pruneRadioMoveVisuals(visuals, now, live)` (a key gone drops its visuals mid-move, except an
    echo already ringing: decision 13).
  - Store `{ visuals, startBars: lapStart, laps: radioFoldMoveRef.current.laps }`.
  - The resting set: `const resting = new Set(radioRestingRef.current.keys())`; when it differs
    from `radioRestingShown`, `setRadioRestingShown(resting)` (this runs in a microtask: the
    repo's no-setState-in-effect rule holds).
- [ ] **Step 3: The flashes' `until`** in `radioFlashTick`:
  - a gesture's: a lead-in `lapStart + loopBars`; an arrival
    `lapStart + Math.min(g.beats / 4, loopBars / 2)`;
  - a turnaround's: `lapStart + loopBars`;
  - the throw's: its `at + (armed.endBars - armed.startBars)`;
  - hook landings and the intensity arc's words: none (a moment's words).

  Its prune: `pruneRadioFlashes(log, now, 1, live, fadeOutBars)`. `radioReadoutFrom`'s row flash:
  `radioFlashShown(radioFlashLogRef.current, s.id, now, 1, flashFadeBars)`.
- [ ] **Step 4: Verify, commit.** `npm run typecheck`,
  `npx eslint src/renderer/src/components/DiscoverPanel.tsx`, `npx vitest run src/shared`. The
  panel glue has no tests, by convention: say so. Message:
  `discover radio: the moves' visuals log (spec 2026-10-05-radio-move-visuals-design) -- radioMoveVisualsTick, beside the flash tick: what is armed every tick as @shared radioMoveVisuals on the readout's clock (gestures from radioGestureRef, the turnaround when it fits the loop with its late gap rows, the armed throw's echo, hook and arc rests closed by a decided return), keyed by what armed them, so a take-back drops them; the resting rows for render; flashes carry their move's end and fade in 100 ms / out 150 ms. No panel tests (convention); unseen by any agent`,
  then the trailer.

### Task 7: The rows and the top line draw them

**Repo:** sssketch. **Depends on:** Task 6.

**Files:** `DiscoverPanel.tsx`, `DiscoverSlotRow.tsx`, `RadioTopLine.tsx`.

- [ ] **Step 1: The row** (`DiscoverSlotRow.tsx`, the radio layout only; the grid is untouched):
  - a new prop `radioResting: boolean` (the panel passes `radioRestingShown.has(slot.id)`);
  - `waveformCell`'s outer div gains `data-move-row={radioLayout ? slot.id : undefined}`;
  - the coloured layer renders on `previewing || (radioLayout && radioResting)` (decision 11); its
    wrapper div (the one with `clipPath: inset(${gainClipPct}% 0 0 0)`) gains
    `className="mv-colour"`. Filter and mask on that wrapper reach the masked
    `RepeatedWaveform` inside it (a filter on the masked element itself would be cut away by its
    own mask);
  - after it, in the radio layout only, a ghost: `<div className="mv-ghost"><div
    className="mv-ghost-inner"><RepeatedWaveform path={resolvedStem.path}
    color={stemColorVar(resolvedStem)} tileWidthPct={...} /></div></div>`, and a riser line
    `<div className="mv-riser" />`. Both `aria-hidden`, `pointerEvents: 'none'`;
  - the cell stays one element in both views (the simple view's "no remounts").
- [ ] **Step 2: The rules**, in the panel's `<style>` (beside `.radio-plate-away`), scoped to the
  radio view:

```css
        /* a radio move while it sounds (spec 2026-10-05-radio-move-visuals-design): the sweep
           effect sets --mv-* on the row's waveform cell, [data-mv] only while one sounds. The stem's
           own colour, dimmed and shaped: never a new colour */
        [data-radio-view] [data-move-row] .mv-ghost { position: absolute; inset: 0; overflow: hidden; pointer-events: none; opacity: 0; }
        [data-radio-view] [data-move-row] .mv-ghost-inner { position: absolute; inset: 0; }
        [data-radio-view] [data-move-row] .mv-riser { position: absolute; left: 0; right: 0; bottom: 0; height: 1px; background: var(--ra-text); transform: scaleX(0); transform-origin: left; pointer-events: none; }
        [data-radio-view] [data-move-row][data-mv] .mv-colour {
          opacity: var(--mv-bright);
          filter: blur(calc(var(--mv-wash) * 1.5px));
          -webkit-mask-image: linear-gradient(to bottom, rgb(0 0 0 / calc(1 - 0.85 * var(--mv-high))), #000 50%, rgb(0 0 0 / calc(1 - 0.85 * var(--mv-low))));
          mask-image: linear-gradient(to bottom, rgb(0 0 0 / calc(1 - 0.85 * var(--mv-high))), #000 50%, rgb(0 0 0 / calc(1 - 0.85 * var(--mv-low))));
        }
        [data-radio-view] [data-move-row][data-mv] .mv-ghost { opacity: calc(var(--mv-ghost) * 0.45); }
        [data-radio-view] [data-move-row][data-mv] .mv-ghost-inner { transform: translateX(max(var(--mv-ghost-shift), 6px)); }
        [data-radio-view] [data-move-row][data-mv] .mv-riser { transform: scaleX(var(--mv-riser)); }
```

  The grey base layer stays at full: a dimmed coloured layer shows grey through it, the row's
  "grey means quieter" language (the gain envelope's). No `border-radius` anywhere; tokens only
  (`--ra-text`).
- [ ] **Step 3: The top line.** `RadioTopLine` gains `riserRef: React.RefObject<HTMLSpanElement |
  null>`; inside the ruler's `<span style={{ display: 'flex', gap: rulerGap, flex: 1, height: 4 }}>`,
  make it `position: 'relative'` and append
  `<span ref={riserRef} aria-hidden style={{ position: 'absolute', left: 0, right: 0, bottom: -3, height: 1, background: 'var(--ra-text)', transform: 'scaleX(0)', transformOrigin: 'left', pointerEvents: 'none' }} />`.
  The panel passes `radioRiserRef` (a new `useRef<HTMLSpanElement>(null)`).
- [ ] **Step 4: The sweep layout effect writes them**, after the fold dots and before the line:
  - `const mv = radioMoveVisualsRef.current`;
    `const t = mv.startBars + (radioFoldMoveRef.current.laps - mv.laps) * previewLoopBars + pos`;
  - `const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches` (a module-level
    `MediaQueryList`, read per call);
  - when `radioOn && playing && (radioMoveVisualsSounding(mv.visuals, t) || radioRestingRef.current.size > 0)`:
    for each `rowsRef.current.querySelectorAll<HTMLElement>('[data-move-row]')`: `look =
    radioRowVisualAt(mv.visuals, el.dataset.moveRow, t, reduced ? 0 : fadeBars)`; a row in
    `radioRestingRef` gets `look.level = 0` (decision 11);
    `radioRowVisualVars(look, { windowBars, reducedMotion: reduced })` (windowBars: the effect's
    own `discoverWindowLayout(...)`), each `el.style.setProperty`, `el.dataset.mv = ''`; the
    riser: `radioRiserRef.current?.style.setProperty('transform', `scaleX(${reduced ? 0 : radioRowVisualAt(mv.visuals, null, t).riser})`)`;
    `movesShownRef.current = true`;
  - otherwise, once (`movesShownRef.current`): remove the seven properties and `data-mv` from
    every cell, reset the riser to `scaleX(0)`, `movesShownRef.current = false`;
  - `fadeBars` from `bpmRef.current`. Runs at the position stream's rate (~30 Hz), as the playhead
    does (decision 2).
- [ ] **Step 5: Verify, commit.** `npm run typecheck`, `npm run lint`, `npx vitest run src/shared`.
  No panel or row tests by convention: say so, and that no agent saw the app. Message:
  `discover radio: moves shown on the rows while they sound (spec 2026-10-05-radio-move-visuals-design) -- the sweep effect reads the panel's log at every position tick (the readout's clock, carried across the wrap as the fold dots do) and sets --mv-* on each radio row's waveform cell ([data-mv] only while a move sounds): the stem's colour layer at 25% while silent, its lower half thinned by a lift and its upper half by a dip or a filter in, blurred by a wash, a throw's ghost layer trailing it, a change's riser along its foot, a turnaround's riser under the top line's ruler; a resting row keeps its colour layer at the floor (a rest is radio's move, a mute is yours); steady states under reduced motion; both views. No panel tests (convention); unseen by any agent`,
  then the trailer.

**Ship point B.** Elling watches the desktop radio (walkthrough items 1-9 on the desktop).

---

## Last

### Task 8: Review, handoff, walkthrough

- [ ] **Step 1: Both repos green.** sssketch: `npm test`, `npm run typecheck`, `npm run lint`.
  ell.ing/radio: `npx vitest run`, `npm run typecheck`, `npm run build`, `npm run check:engine`.
- [ ] **Step 2: Review** with superpowers:requesting-code-review against the spec and this plan's
  decisions, with Task 5's screenshots.
- [ ] **Step 3: Handoff.** A memory note (`radio_move_visuals_shipped.md`): what is live, what is
  unpushed, the screenshot findings, open question (web simple mode), that it needs Elling's
  walkthrough. Its line in `MEMORY.md`. **Do not push or deploy.**
- [ ] **Step 4: The walkthrough** (Elling's). No agent can hear either radio or see the desktop
  app; the web was seen in headless Chrome only. Turnarounds on, depth bold; then density
  intensity.
  1. **Drums out** (the `drums out` chip, or a turn): the drums row dims as the drums leave,
     within a beat of hearing it, and is full again exactly on the one. Its word is on for the
     move and gone quickly after.
  2. **Lift** (`lift` chip): the rows' lower halves thin as the high-pass rises, back on the one.
     **Dip**: the upper halves.
  3. **Wash** (`wash` chip): the washed rows soften as the send grows, clear on the one.
  4. **A riser into a gap** (turn until a riser with `→ gap` shows on the ruler, or drama 50+ and
     `drop`): the line under the ruler fills toward the one; at the gap it is gone and every row
     dims but the keeper; the one brings everything back at once.
  5. **A breakdown** (density intensity, or `drop` twice): the drums and bass rows dim at the
     breakdown's line (a quick fade, not a cut), stay dim through it, and come back with the drop
     on its one together with the gap's rows. A drums row's echo throw trails a ghost into the
     rest.
  6. **A change's gestures:** a hole dims the outgoing row into the wrap; a filter in opens the
     new row's top; a bloom washes it and clears; a duck dips the others for a beat; a change's
     riser fills a line along its row.
  7. **A hook's rest** (hook a row; wait for `hook out` while the arc thins): it dims at its line
     and stays dim until it comes back. A muted row stays grey / faint, not dimmed: different.
  8. **Nothing lingers:** after each move the rows are exactly as before; with nothing happening,
     nothing on the rows moves.
  9. **Reduced motion** (System Settings, Accessibility, Display, Reduce motion): dims and filter
     thinning as steady states, no blur, ghost or riser lines.
  10. The desktop's simple view shows all of the above too; advanced the same.
  11. The web's simple mode: nothing new (decision 12). Does he want something there?

## Timing risks, per task

1. **The web (T3-T4):** the visuals read `engine.now`, which is what is being rendered, not yet
   heard: output latency (tens of ms, more on Bluetooth) puts the look slightly AHEAD of the
   sound, as the playhead already is. If Elling sees moves early, subtract
   `AudioContext.outputLatency` in `moveFrame`'s `now` for both the playhead and the moves, never
   one alone.
2. **The desktop (T6-T7):** the look steps at the position stream's ~30 Hz, as the playhead does;
   CSS custom properties do not transition (not registered), so a 100 ms fade is three steps.
   Good enough to read as a fade; if not, an `opacity` transition of one tick (33 ms) on
   `.mv-colour` smooths the dims (the mask and blur stay stepped).
3. **The desktop's wrap:** the tick runs a microtask after the layout effect, so for one frame at
   each wrap the effect reads a snapshot taken before the wrap; the laps correction covers it (the
   fold dots' proven path). A loop-length change on the wrap can misplace that one frame.
4. **The ghost is the faintest look.** A trail of one repeat (floored at 6 px) over a dense
   waveform barely shows in the planning screenshots. Judge it on real stems (walkthrough 5). If
   it does not read: trail by a whole beat instead of one repeat, or draw it only where the
   waveform is quiet (both one line of CSS / one constant).
5. **Take-backs (desktop):** a turnaround taken back mid-move goes at the next tick (its key is
   gone), the audio at the push: they can differ by a tick and a push.
6. **The web's tempo change on a wrap:** turnarounds and lead-ins use the clock before the wrap,
   arrivals the one after (as the engine), so a tempo change on the wrap places both right; a
   tempo change scheduled after a move was logged does not move it (the engine does not either).
7. **The gap's late rows (desktop):** computed from the rows previewing at the tick the
   turnaround is first seen; a row joining later in that lap is silenced by the lane build but not
   shown dim. Rare; the next tick does not add it (the key is seen). Acceptable, or recompute the
   late rows every tick while the turnaround is armed.
