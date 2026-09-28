# Radio controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make radio's pace mean what it says, then give it arrangement gestures — a rare drum
drop-out, a menu of controls, a fair turnover with a hook, and transitions built from the sound
toolkit already on the wire.

**Architecture:** Five phases, each landing on its own and each leaving the app working. Phase A
is a change of default behaviour with **no setting and no UI** — the commit boundary moves from
the whole loop's wrap to the changing slot's own bar length, and the three pace windows are
retuned now that they are no longer silently doubled. Phase B adds drop-outs as a `volume`
automation curve in the preview project, which is the only mechanism in this codebase that can
land a gesture on the beat (§0A of the spec). Phase C builds the radio menu and migrates the
settings into one nested object. Phase D adds turnover fairness and the hook, both as weights in
one pure function. Phase E adds transitions using the same arm/clear cycle Phase B establishes.

**Tech Stack:** TypeScript, React 19, Electron renderer + main, vitest.

**Spec:** `docs/superpowers/specs/2026-09-28-radio-controls-design.md` (2026-09-28). Its §11 "not
now" list is the scope boundary — **if something is not named as in, it is out.**

**Elling's brief, verbatim:** *"radio mode seems quite slow to me"* … *"maybe transitions would be
the coolest new idea to focus on building"* … *"yep, holes = good. drop out the drums for a few
beats or something"* … *"also make sure to transition on the proper beat... that's key"* … *"not
just the downbeat, the proper start of the loop, i think"* … *"drums drop out rarely... rarely i
think. since it's working quite well currently."*

**NO NATIVE-ENGINE CHANGES.** Nothing in this plan reaches `native-engine/`. Every transition and
every gesture uses fields that are **already on the wire and already parsed** — `EngineStemToolkit`
and its `automation` lanes, and `EngineRiser`. `EngineProject` / `buildEngineProject.ts` are a
hand-synced pair (CLAUDE.md) and **this plan changes neither.** If you conclude a native-engine
change is needed, **STOP and report it rather than planning one.**

**Baseline (verified on `master`, 2026-09-28, commit `85e482e`):**

```
Test Files  198 passed (198)
     Tests  3165 passed (3165)
```

`npm run typecheck` — 0 errors. `npm run lint` — **0 errors, 4 pre-existing prettier warnings**
(`categoryCentroidStore.test.ts:30`, `categoryCentroidTraining.ts:59`,
`stemCategoriesBackfill.test.ts:69`). Those four are the baseline; do not fix them in this plan
and do not add a fifth.

---

**LINE NUMBERS ARE A GUIDE, NOT A CONTRACT.** `src/shared/radioSchedule.ts` gained
`RadioSlotEligibility` and `isRadioEligibleSlot` on 2026-09-28 while this plan was being written
(a live fix for *"if i start radio with stems already there.. it seems to not transition"* — a
seeded slot has no `candidate`, so radio's own filter made every layer ineligible). Every line
number below was accurate at `85e482e`; **grep for the identifier before trusting one.** Nothing
in this plan conflicts with that fix — `isRadioEligibleSlot` is the eligibility predicate and
this plan only ever changes *weights within* the eligible set, never the set itself.

## Findings that shaped this plan — read ALL of these before Task 1

1. **The slowness has one cause and it is one line.** `advanceRadioClock`
   (`src/shared/radioSchedule.ts:95`) ends with `due: wrapped && barsElapsed >= clock.intervalBars`.
   `wrapped` is the WHOLE preview loop restarting, so the effective interval is
   `ceil(drawn / loopBars) * loopBars`. At 120 bpm with an 8-bar loop, `mid` (12–24 bars) can only
   produce 32 s or 48 s. **Phase A replaces `wrapped` with "crossed a grid boundary" and nothing
   else.**

2. **`gridBars === loopBars` must reproduce today's behaviour exactly.** That is the safety
   property of the whole phase and there is a test for it in Task 3. Every existing
   `advanceRadioClock` test must keep passing with the new parameter defaulted.

3. **The phone already settled the grid arithmetic and it is not to be reinvented.**
   `src/main/remotePage.ts:995-1007`: clamp a grid longer than the loop down to the loop, then
   `while (step > 1 && bars % step !== 0) step = step - 1`. Read that function before writing
   Task 2.

4. **THE HARD REQUIREMENT: a gesture fired from the React tick is audibly wrong.** `pos` arrives
   at 30 Hz. A drop-out that returns 40 ms after the loop restarts sounds broken, and the whole
   value of the feature is that the drums come back exactly on the one. **Do not implement a
   drop-out with `scheduleLiveParamSync`, a `setTimeout`, or anything fired at the moment.** It
   must be a `volume` automation curve written into the project *in advance*, so the engine
   performs it. Spec §0A.

5. **There is no scheduled-event API on the engine.** `IpcServer.cpp` dispatches 28 message types
   and **all of them are immediate**. Nothing takes a bar number. Adding one would be
   native-engine work. **Do not look for one and do not add one.**

6. **Toolkit automation DOES reach the Discover preview, and this is why Phases B and E are
   possible.** `syncPreviewToEngine` (`DiscoverPanel.tsx:763-950`) has no project builder of its
   own — it assembles a full throwaway `AppState` from `initialState` (`:887-895`) and calls the
   SAME `buildEngineProject`, which reads `state.stemAutomation?.[key]`
   (`buildEngineProject.ts:519`) and `buildEngineRisers(state.risers ?? {})` (`:616`).
   `initialState` supplies `{}` for both (`store.ts:569,571`). **They are empty because nobody has
   populated them in the preview, not because they are unreachable.**

7. **A toolkit curve is clip-relative and therefore anchored to the loop top, automatically.**
   `originBar` is `startBar + leftCropBars + offsetSteps/snapDiv` (`buildEngineProject.ts:220-229`),
   which is 0 for a preview clip at `startBar: 0`, and the transport wraps at `loopLengthBars`. So
   **a curve repeats every lap and can only be anchored to the wrap.** That is exactly what Elling
   asked for. There is no bar arithmetic to get right and no wrap to detect.

8. **Because a curve repeats, every gesture is an ARM / CLEAR pair.** Write the curve in one
   `syncPreviewToEngine`, remove it in a later one. `isStemToolkitNeutral`
   (`toolkit.ts:171-182`) drops the whole `toolkit` key when nothing is drawn, so
   **the cleared project is byte-identical to what would have been sent without this feature.**
   That is the regression-safety property — preserve it.

9. **A `volume` curve makes `EngineStem.volume` inert.** `PlaybackEngine.cpp:325-329`'s
   `volumeAutomated` branch. The slot's gain is already folded in by `scaleCurveByGain`
   (`buildEngineProject.ts:251-256, 280`), so the gain dial still works *visually*, but
   `updateSlotGain`'s `scheduleLiveParamSync` fast path silently stops applying to a stem carrying
   a curve. The arm/clear cycle removes the curve, so this is contained — **but never leave a
   curve on a stem that is not mid-gesture.**

10. **Radio must NOT call `rerollSlot`, and must NOT push undo.** `rerollSlot` (`:2152`),
    `rerollRandomSlot` (`:2212`) and `swapSlotFromNearby` (`:1879`) all call `pushUndoSnapshot()`.
    Radio commits through `commitSlotPick` (`:2080`) directly, exactly as `rerollAll` bypasses
    `rerollSlot`. **Drop-outs and transitions push no undo either** — they are performance, not
    edits.

11. **`resolveCandidateStem` is module-level and memoised**, `resolvedCandidateCache` (`:95`) keyed
    `` `${riffCID}:${stemCID}` ``. `armRadioPick` (`:2293`) already pre-warms it a whole interval
    early. Untouched by this plan.

12. **`updateDiscoverSettings` merges** (`App.tsx:1676-1680`) because "saving a partial object used
    to be fine with one field, but would silently wipe `traitMatchBar`". Every settings write goes
    through it.

13. **`discoverSettingsStore.ts` is a plain JSON file**, not SQLite; its test mocks only
    `app.getPath`. **No `vitest.config.ts` change is needed and none may be made.** The 28-file CI
    exclusion list exists because better-sqlite3 crashes vitest workers on GitHub's macOS runners;
    this plan opens no database.

14. **`discoverSettingsStore.test.ts` asserts whole objects.** Every `toEqual({...})` and every
    `saveDiscoverSettings({...})` in it breaks when the shape changes. Task 10 updates all of them.
    Do not add `expect.objectContaining` to work around it.

15. **React components are NOT unit-tested in this codebase** (CLAUDE.md). Tasks 4, 8, 11, 12, 14,
    15 and 18 have **no component tests**, deliberately. They are verified by `npm run typecheck` +
    `npm run lint` + the full suite staying green, then by Elling listening. **This environment has
    no GUI or audio tooling — do not claim radio was heard, a button was clicked, or a timing was
    observed.**

16. **Lint rules that will bite.** This repo **errors** on a synchronous `setState` inside a React
    effect (`react-hooks/set-state-in-effect`; the established workaround is
    `void Promise.resolve().then(...)`), on render-time impurity (`react-hooks/purity` — **no
    `Math.random()`, `Date.now()` or `performance.now()` inside a component-scoped function**),
    and requires an **explicit return type on every function**, inline ones included. Prettier:
    `singleQuote: true`, `semi: false`, `printWidth: 100`, `trailingComma: none`.

17. **Randomness lives in `src/shared/`, injected.** Every new pure function taking randomness
    takes `random: () => number = Math.random`. That is what makes it testable and it keeps
    `Math.random()` out of the component (finding 16).

18. **Design tokens are the law** (`src/renderer/src/styles/tokens.css`): near-black monochrome,
    Silkscreen, **no `border-radius` anywhere**, lowercase copy, **no emoji, no exclamation
    marks**, colour only on things carrying audio information. **Tooltips are two or three words.
    Buttons are two words maximum, or an icon.**

19. **The slot row's grid must not reflow.** `DiscoverPanel.tsx:4105-4106` is a 15-track
    `gridTemplateColumns` with an explicit `gridColumn` on every child, and its doc comment
    (`:4090-4104`) is a long, hard-won warning about a real bug caused by conditionally-rendered
    columns. **Column 6 is an empty 14 px spacer** (`<div style={{ gridColumn: 6 }} />`) — Task 15
    puts the hook toggle there and widens that one track to 18 px. Render it always and hide it
    with `visibility`, the way the radio progress rule already does (`:2966`).

## Known limits, accepted on purpose (do not "fix" these)

- **The stem change is still tens of milliseconds late.** A React render, an rAF,
  `buildEngineProject`, one `engineLoadProject` round trip. Sample accuracy would need engine-side
  scheduling, which is out. **Gestures are not affected** — they are curves, armed early.
- **A gesture's edge is block-quantised** (5.3 ms at a 256-sample buffer, 10.7 ms at 512) and the
  gain then moves over a 15 ms `ParamSmoother` ramp. That ramp is a fade-in, not a delay: the
  onset is sample-aligned and only its first 15 ms is attenuated. This is already-shipped,
  already-tested engine behaviour and is not re-tested here.
- **A radio change is not undoable.** Finding 10.
- **Radio idles rather than stopping** when nothing is eligible.
- **The next pick is decided a whole interval early**, so `pickForSlot`'s dedupe pass can be that
  stale. Already documented as "a variety heuristic, not a correctness guarantee" (`:1725-1733`).

## File map

| File | Change |
|---|---|
| `src/shared/radioSchedule.ts` | retuned `RADIO_PACE_BARS`; **new** `RadioGrid`, `RADIO_GRID_OPTIONS`, `DEFAULT_RADIO_GRID`, `normalizeRadioGrid`, `radioGridBars`; `advanceRadioClock` gains `gridBars`; `pickRadioSlotId` gains `RadioPickOptions`; **new** `RadioTurnover`, `RadioDropOuts`, `RadioTransitions`, `RadioSettings`, `DEFAULT_RADIO_SETTINGS`, `normalizeRadioSettings`, `RADIO_CHANNELS_MIN/MAX`, `radioStarterKinds` |
| `src/shared/radioSchedule.test.ts` | extended throughout |
| `src/shared/radioDropOut.ts` | **NEW** — which layer, how long, how often, the curve |
| `src/shared/radioDropOut.test.ts` | **NEW** |
| `src/shared/radioTransition.ts` | **NEW** — the temperament × kind weighting and the curve builders |
| `src/shared/radioTransition.test.ts` | **NEW** |
| `src/main/discoverSettingsStore.ts` | `DiscoverSettings.radioPace` → `DiscoverSettings.radio`, with migration |
| `src/main/discoverSettingsStore.test.ts` | every existing assertion updated + migration cases |
| `src/renderer/src/App.tsx` | `radioPace`/`onRadioPaceChange` → `radioSettings`/`onRadioSettingsChange` |
| `src/renderer/src/components/LibraryBrowser.tsx` | the same two props, passed through |
| `src/renderer/src/components/DiscoverRadioMenu.tsx` | **NEW** — the popover |
| `src/renderer/src/components/DiscoverPanel.tsx` | the grid, the drop-out, the menu button, the hook toggle, the transition arm/clear |

**Nothing else is touched. No file is deleted. `vitest.config.ts` is NOT edited. `native-engine/`
is NOT edited.**

## Commands (run from `/Users/nickel/Claudecode/sssketch`)

```bash
npx vitest run src/shared/radioSchedule.test.ts    # one file
npm test                                            # full suite
npm run typecheck
npm run lint
```

---

# PHASE A — the slowness fix, alone

**This phase ships on its own.** No setting, no UI, no chips. It is a change of default behaviour
Elling can hear by pressing the button he already has. **Stop after Task 5 and let him listen
before starting Phase B.**

---

## Task 1: Retune the pace windows

**Files:**
- Modify: `src/shared/radioSchedule.ts:32-36`
- Modify: `src/shared/radioSchedule.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/shared/radioSchedule.test.ts`, inside the existing `describe('radio paces', …)`:

```ts
  it('sits every pace on a 3x ladder, retuned now the quantisation is gone', () => {
    expect(RADIO_PACE_BARS.fast).toEqual({ min: 2, max: 4 })
    expect(RADIO_PACE_BARS.mid).toEqual({ min: 6, max: 12 })
    expect(RADIO_PACE_BARS.slow).toEqual({ min: 18, max: 36 })
  })
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/shared/radioSchedule.test.ts`
Expected: FAIL — `expected { min: 6, max: 12 } to deeply equal { min: 2, max: 4 }`. The three
existing window tests (`2:1 bar window`, `slowest to fastest`) must still be passing.

- [ ] **Step 3: Retune**

In `src/shared/radioSchedule.ts`, replace the `RADIO_PACE_BARS` block (including its doc comment's
final paragraph) with:

```ts
/** Each pace is a WINDOW of bars, not a number. Exactly every N bars reads
 * as mechanical; a change landing somewhere in a range feels like
 * something is making decisions (spec 3.3).
 *
 * The 2:1 ratio is the decision; the absolute numbers are taste. 2:1 is
 * wide enough that you cannot count along with it and narrow enough that
 * it never feels stalled at the top or frantic at the bottom.
 *
 * RETUNED 2026-09-28. The old windows (24-48 / 12-24 / 6-12) were chosen
 * while advanceRadioClock was silently rounding every one of them UP to
 * the next whole multiple of the loop length -- at 120bpm with an 8-bar
 * loop, `mid` could only ever produce 32s or 48s, and `fast` could only
 * produce 16s or 32s. Elling, 2026-09-28: "radio mode seems quite slow to
 * me". Now that radioGridBars below lets a change land on the changing
 * slot's own cycle, the numbers finally describe the behaviour, so the
 * whole ladder moves down one notch and gains a genuinely fast bottom
 * rung. A clean 3x ladder with a 2:1 window at every step.
 *
 * At 120bpm in 4/4 (2s a bar): slow = 36-72s, mid = 12-24s, fast = 4-8s. */
export const RADIO_PACE_BARS: Record<RadioPace, { min: number; max: number }> = {
  slow: { min: 18, max: 36 },
  mid: { min: 6, max: 12 },
  fast: { min: 2, max: 4 }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/shared/radioSchedule.test.ts`
Expected: PASS, all of them. The `2:1` and `slowest to fastest` tests hold because 4 = 2×2,
12 = 6×2, 36 = 18×2 and 18 > 6 > 2.

- [ ] **Step 5: Commit**

```bash
git add src/shared/radioSchedule.ts src/shared/radioSchedule.test.ts
git commit -m "the pace windows say what they mean, now that nothing doubles them

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

---

## Task 2: The grid — clamp and step down to a divisor

**Files:**
- Modify: `src/shared/radioSchedule.ts` (append after `nextRadioIntervalBars`)
- Modify: `src/shared/radioSchedule.test.ts`

Read `src/main/remotePage.ts:995-1007` first. This is the same arithmetic and the same reasoning;
do not invent a second one.

- [ ] **Step 1: Write the failing tests**

Add a new `describe` block to `src/shared/radioSchedule.test.ts` (and add
`DEFAULT_RADIO_GRID, RADIO_GRID_OPTIONS, normalizeRadioGrid, radioGridBars` to the import at the
top of the file):

```ts
describe('radioGridBars', () => {
  it('offers the same five options, in the same words, as the phone', () => {
    expect(RADIO_GRID_OPTIONS).toEqual(['own loop', 'loop end', '8 bars', '4 bars', '2 bars'])
  })

  it('defaults to the changing slot own loop', () => {
    expect(DEFAULT_RADIO_GRID).toBe('own loop')
  })

  it('normalizes anything unrecognised to the default', () => {
    expect(normalizeRadioGrid('16 bars')).toBe('own loop')
    expect(normalizeRadioGrid(undefined)).toBe('own loop')
    expect(normalizeRadioGrid(4)).toBe('own loop')
    expect(normalizeRadioGrid(null)).toBe('own loop')
  })

  it('loop end is the whole loop -- exactly what shipped 2026-09-26', () => {
    expect(radioGridBars('loop end', 8, 2)).toBe(8)
    expect(radioGridBars('loop end', 3, 1)).toBe(3)
  })

  it('own loop is the changing slot own bar length', () => {
    expect(radioGridBars('own loop', 8, 2)).toBe(2)
    expect(radioGridBars('own loop', 8, 4)).toBe(4)
  })

  it('falls back to the whole loop when the slot bar length is unknown', () => {
    expect(radioGridBars('own loop', 8, null)).toBe(8)
    expect(radioGridBars('own loop', 8, 0)).toBe(8)
    expect(radioGridBars('own loop', 8, 2.5)).toBe(8)
    expect(radioGridBars('4 bars', 0, 2)).toBe(0)
  })

  it('caps a grid longer than the loop to the loop', () => {
    expect(radioGridBars('8 bars', 4, 1)).toBe(4)
    expect(radioGridBars('own loop', 4, 8)).toBe(4)
  })

  it('steps down to the largest divisor of the loop, as the phone does', () => {
    // remotePage.ts:995-1002 -- 4 over a 6-bar loop becomes 3, 8 over a
    // 12-bar loop becomes 6, 4 over an 8-bar loop stays 4.
    expect(radioGridBars('4 bars', 6, 1)).toBe(3)
    expect(radioGridBars('8 bars', 12, 1)).toBe(6)
    expect(radioGridBars('4 bars', 8, 1)).toBe(4)
  })

  it('never steps below 1, which divides everything', () => {
    expect(radioGridBars('2 bars', 5, 1)).toBe(1)
    expect(radioGridBars('own loop', 7, 3)).toBe(1)
  })

  it('handles a non-integer loop by falling back to the loop', () => {
    expect(radioGridBars('4 bars', 6.5, 2)).toBe(6.5)
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/shared/radioSchedule.test.ts`
Expected: FAIL at import — `No "RADIO_GRID_OPTIONS" export is defined`.

- [ ] **Step 3: Implement**

Append to `src/shared/radioSchedule.ts`, immediately after `nextRadioIntervalBars`:

```ts
/** Where a change is ALLOWED to land -- not how often one happens. The five
 * options and their exact words are the phone's (remotePage.ts's
 * SWAP_GRIDS, commit e0abb0e); two surfaces doing the same thing should
 * say it the same way, and re-labelling shipped copy is churn.
 *
 * Literal values double as their own UI text, the same convention
 * RadioPace and DISCOVER_SLOT_KIND_OPTIONS use, so there is no label
 * table. */
export type RadioGrid = 'own loop' | 'loop end' | '8 bars' | '4 bars' | '2 bars'

export const RADIO_GRID_OPTIONS: RadioGrid[] = [
  'own loop',
  'loop end',
  '8 bars',
  '4 bars',
  '2 bars'
]

/** `own loop`, NOT the `loop end` that shipped 2026-09-26.
 *
 * The phone kept its own shipped default because a value was already
 * stored on Elling's phone and a default that moved under him would be a
 * surprise. Here the reverse holds: this is a brand-new field with nothing
 * stored anywhere, and the surprise would be shipping a fix for "radio
 * mode seems quite slow to me" whose default is still the slow thing.
 * remotePage.ts:680-684 on `own loop`: "the most musical boundary for a
 * stem changing under eleven others is its own cycle ... this is the one
 * to try first." */
export const DEFAULT_RADIO_GRID: RadioGrid = 'own loop'

export function normalizeRadioGrid(value: unknown): RadioGrid {
  return RADIO_GRID_OPTIONS.includes(value as RadioGrid)
    ? (value as RadioGrid)
    : DEFAULT_RADIO_GRID
}

/** How many bars apart the boundaries a change may land on are.
 *
 * `loopBars` is the preview loop's own length (DiscoverPanel's
 * maxBarLength, which is what went to the engine as loopLengthBars).
 * `slotBars` is the CHANGING slot's own bar length, or null when nothing
 * has resolved it yet.
 *
 * Two edges, both settled on the phone (remotePage.ts:995-1007) and not
 * re-litigated here:
 *   - a grid longer than the loop is capped to the loop;
 *   - a grid that does not divide the loop steps DOWN to the largest
 *     divisor, so every boundary is the same place in the phrase on every
 *     cycle and the downbeats stay where they were. It can never step
 *     below 1, which divides everything.
 *
 * Anything without a whole positive bar count falls back to the whole
 * loop -- which is exactly the behaviour that shipped 2026-09-26, so the
 * fallback can never be worse than what is already out there. */
export function radioGridBars(
  grid: RadioGrid,
  loopBars: number,
  slotBars: number | null
): number {
  if (!(loopBars > 0)) return loopBars
  if (grid === 'loop end') return loopBars
  const requested =
    grid === 'own loop' ? slotBars : Number.parseInt(grid, 10)
  if (
    requested === null ||
    requested === undefined ||
    !Number.isFinite(requested) ||
    requested < 1
  ) {
    return loopBars
  }
  if (!Number.isInteger(loopBars)) return loopBars
  let step = Math.floor(requested)
  if (step > loopBars) step = loopBars
  while (step > 1 && loopBars % step !== 0) step -= 1
  return step
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/shared/radioSchedule.test.ts`
Expected: PASS. Note `radioGridBars('own loop', 8, 2.5)` returns 8 because
`Math.floor(2.5) = 2` would be wrong — check that case specifically; if it returns 2, add
`if (!Number.isInteger(requested)) return loopBars` before the floor and re-run.

- [ ] **Step 5: Commit**

```bash
git add src/shared/radioSchedule.ts src/shared/radioSchedule.test.ts
git commit -m "a change can land on a stem's own cycle, not only the whole loop's

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

---

## Task 3: `advanceRadioClock` commits on a grid boundary

**Files:**
- Modify: `src/shared/radioSchedule.ts:76-119`
- Modify: `src/shared/radioSchedule.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/shared/radioSchedule.test.ts`:

```ts
describe('advanceRadioClock on a grid', () => {
  it('reproduces the old behaviour exactly when the grid IS the loop', () => {
    // The safety property of the whole change: gridBars === loopBars must
    // be byte-for-byte what shipped 2026-09-26.
    const clock = { barsElapsed: 7.9, intervalBars: 6, lastPos: 7.9 }
    const notYet = advanceRadioClock(clock, 7.95, 8, 8)
    expect(notYet.due).toBe(false)
    const atWrap = advanceRadioClock(clock, 0.05, 8, 8)
    expect(atWrap.wrapped).toBe(true)
    expect(atWrap.due).toBe(true)
  })

  it('commits at a sub-loop boundary once the interval has elapsed', () => {
    // 8-bar loop, 2-bar grid, interval 3 bars: the old code would have
    // waited for bar 8. This lands at bar 4.
    const clock = { barsElapsed: 3.1, intervalBars: 3, lastPos: 3.9 }
    const step = advanceRadioClock(clock, 4.02, 8, 2)
    expect(step.wrapped).toBe(false)
    expect(step.due).toBe(true)
  })

  it('does NOT commit at a grid boundary before the interval has elapsed', () => {
    // The grid is a gate, not a trigger -- it can never make changes more
    // frequent than the pace asked for.
    const clock = { barsElapsed: 1.9, intervalBars: 6, lastPos: 3.9 }
    const step = advanceRadioClock(clock, 4.02, 8, 2)
    expect(step.due).toBe(false)
  })

  it('treats the wrap as a grid boundary, because 0 is always on the grid', () => {
    const clock = { barsElapsed: 9, intervalBars: 3, lastPos: 7.9 }
    const step = advanceRadioClock(clock, 0.02, 8, 3)
    expect(step.wrapped).toBe(true)
    expect(step.due).toBe(true)
  })

  it('does not fire twice inside one grid cell', () => {
    const clock = { barsElapsed: 5, intervalBars: 3, lastPos: 4.1 }
    expect(advanceRadioClock(clock, 4.5, 8, 2).due).toBe(false)
  })

  it('defaults the grid to the whole loop when it is not given', () => {
    const clock = { barsElapsed: 9, intervalBars: 3, lastPos: 3.9 }
    expect(advanceRadioClock(clock, 4.02, 8).due).toBe(false)
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/shared/radioSchedule.test.ts`
Expected: FAIL on `commits at a sub-loop boundary` — `expected false to be true`. The
reproduces-the-old-behaviour tests should already pass (the extra argument is ignored until
Step 3).

- [ ] **Step 3: Implement**

In `src/shared/radioSchedule.ts`, replace the `RadioClockStep.due` doc comment and the whole
`advanceRadioClock` function with:

```ts
export interface RadioClockStep {
  clock: RadioClock
  /** The loop restarted between the previous tick and this one. Still
   * reported separately from `due` because gestures (drop-outs,
   * transitions) are anchored to the loop top even when a CHANGE is not --
   * see the 2026-09-28 spec's 0A.5. */
  wrapped: boolean
  /** Commit a change NOW: the interval has elapsed AND we have just
   * crossed a boundary on the change grid.
   *
   * Until 2026-09-28 this was `wrapped && ...`, i.e. the grid was always
   * the whole loop, which made the effective interval
   * ceil(intervalBars / loopBars) * loopBars -- usually a DOUBLING rather
   * than a rounding, and the cause of "radio mode seems quite slow to me".
   * The grid is a GATE, not a trigger: the interval still has to elapse
   * first, so a finer grid can never make changes more frequent than the
   * pace asked for. It only stops the pace being silently rounded up. */
  due: boolean
}

/** One position tick. `loopBars` is the preview loop's own length --
 * DiscoverPanel's `maxBarLength`, which is exactly what went to the engine
 * as loopLengthBars, so the wrap this spots and the wrap the engine
 * performed are the same event. `gridBars` is radioGridBars' answer for
 * the slot that is about to change; passing loopBars reproduces the
 * pre-2026-09-28 behaviour exactly. */
export function advanceRadioClock(
  clock: RadioClock,
  pos: number,
  loopBars: number,
  gridBars: number = loopBars
): RadioClockStep {
  if (!(loopBars > 0) || !Number.isFinite(pos)) {
    return { clock, wrapped: false, due: false }
  }
  const wrapped = pos < clock.lastPos
  // Across a wrap, count the tail of the old pass as well as the head of
  // the new one -- otherwise every wrap silently loses up to a full bar.
  const delta = wrapped ? loopBars - clock.lastPos + pos : pos - clock.lastPos
  const barsElapsed = clock.barsElapsed + Math.max(0, delta)
  // A wrap is ALWAYS a boundary, because 0 is always on the grid. Between
  // wraps, a boundary is crossed when the cell index goes up.
  const step = gridBars > 0 ? gridBars : loopBars
  const crossed =
    wrapped || Math.floor(pos / step) > Math.floor(clock.lastPos / step)
  return {
    clock: { ...clock, barsElapsed, lastPos: pos },
    wrapped,
    due: crossed && barsElapsed >= clock.intervalBars
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/shared/radioSchedule.test.ts`
Expected: PASS, including every pre-existing `advanceRadioClock` test.

Then run the full suite: `npm test`
Expected: `Test Files 198 passed (198)` / `Tests` above 3165.

- [ ] **Step 5: Commit**

```bash
git add src/shared/radioSchedule.ts src/shared/radioSchedule.test.ts
git commit -m "the interval is a number of bars again, not a number rounded up to the loop

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

---

## Task 4: Wire the grid into the panel

**Files:**
- Modify: `src/renderer/src/components/DiscoverPanel.tsx:40-47` (imports), `:1202-1257` (the clock
  effect)

No component test — finding 15.

- [ ] **Step 1: Extend the import**

`src/renderer/src/components/DiscoverPanel.tsx`, the `@shared/radioSchedule` import at `:40-47`,
becomes:

```ts
import {
  advanceRadioClock,
  createRadioClock,
  nextRadioIntervalBars,
  pickRadioSlotId,
  radioGridBars,
  DEFAULT_RADIO_GRID,
  RADIO_PACE_OPTIONS,
  type RadioClock,
  type RadioPace
} from '@shared/radioSchedule'
```

- [ ] **Step 2: Resolve the grid inside the clock effect**

In the `useEffect` at `:1202`, replace the block that runs from `const loopBars =` down to
`const step = advanceRadioClock(clock, pos, loopBars)` with:

```ts
    const loopBars =
      resolvedBarLengthsRef.current.size > 0
        ? Math.max(...resolvedBarLengthsRef.current.values())
        : 0
    if (!(loopBars > 0)) return
    // WHERE a change may land (2026-09-28). The grid is the CHANGING
    // slot's own bar length: radio swaps one stem at a time, and the most
    // musical boundary for a stem changing under three others is its own
    // cycle, not the longest other stem's. Until this, the boundary was
    // always the whole loop's wrap, which rounded every drawn interval UP
    // to a multiple of loopBars -- usually a doubling. Elling, 2026-09-28:
    // "radio mode seems quite slow to me".
    //
    // The pending pick is what is about to change, so it is the slot whose
    // cycle matters. No pending pick (radio just started, or nothing was
    // eligible last time) falls back to the whole loop, which is exactly
    // the pre-2026-09-28 behaviour.
    const pendingSlotId = radioPendingRef.current?.slotId ?? null
    const slotBars =
      pendingSlotId !== null
        ? (resolvedBarLengthsRef.current.get(pendingSlotId) ?? null)
        : null
    const gridBars = radioGridBars(DEFAULT_RADIO_GRID, loopBars, slotBars)
    const step = advanceRadioClock(clock, pos, loopBars, gridBars)
```

`DEFAULT_RADIO_GRID` is used directly rather than read from a setting: **Phase A ships no
setting.** Phase C replaces this one identifier with `radioSettings.grid` and nothing else.

- [ ] **Step 3: Verify**

```bash
npm run typecheck
npm run lint
npm test
```

Expected: typecheck 0 errors, lint 0 errors + the 4 baseline prettier warnings, suite green.

If `resolvedBarLengthsRef.current.get(...)` does not typecheck, check the ref's declared value
type near `:786-800` — it is a `Map<string, number>` keyed by slot id, the same map
`maxBarLength` is taken over. Do not add a second map.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/DiscoverPanel.tsx
git commit -m "radio swaps a layer on that layer's own cycle

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

---

## Task 5: Phase A checkpoint

- [ ] **Step 1: Full verification**

```bash
npm test && npm run typecheck && npm run lint
```

Expected: `Test Files 198 passed (198)`, `Tests` ≥ 3165 + the tests added in Tasks 1–3; typecheck
0 errors; lint 0 errors + exactly 4 prettier warnings.

- [ ] **Step 2: STOP and report**

Phase A is complete and is the whole of what Elling asked for when he said radio was slow. Report
to him:

- at 120 bpm with an 8-bar loop and a 2-bar drum stem, `mid` now changes that layer every 6–12
  bars (12–24 s) instead of every 16 or 24 bars (32–48 s);
- `fast` is 2–4 bars (4–8 s);
- `loop end`, the old behaviour, is not yet reachable from the UI — Phase C adds the chips.

**Do not start Phase B until he has heard this.** State plainly that nothing was listened to: this
environment has no audio tooling.

---

# PHASE B — the rare drop-out

> "yep, holes = good. drop out the drums for a few beats or something"
> "drums drop out rarely... rarely i think. since it's working quite well currently."
> "also make sure to transition on the proper beat... that's key"
> "not just the downbeat, the proper start of the loop, i think"

**Re-read findings 4, 6, 7, 8 and 9 before starting.** A drop-out is a `volume` automation curve
written into the preview project in advance. It is **not** a `scheduleLiveParamSync` call, **not**
a `setTimeout`, and **not** anything fired from the position tick at the moment it should happen.
If you build it that way it will be tens of milliseconds late every single time and the feature is
worthless.

---

## Task 6: `radioDropOut.ts` — who, how long, how often

**Files:**
- Create: `src/shared/radioDropOut.ts`
- Create: `src/shared/radioDropOut.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/shared/radioDropOut.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RADIO_DROP_OUTS,
  DROP_OUT_ELIGIBLE_KINDS,
  RADIO_DROP_OUT_CHANCE,
  RADIO_DROP_OUT_OPTIONS,
  normalizeRadioDropOuts,
  pickDropOutBeats,
  pickDropOutSlotId,
  shouldScheduleDropOut
} from './radioDropOut'

/** A deterministic generator that walks a fixed list and then repeats it. */
function seeded(values: number[]): () => number {
  let i = 0
  return (): number => values[i++ % values.length]
}

describe('drop-out rate', () => {
  it('offers off, rare and often, and defaults to rare', () => {
    expect(RADIO_DROP_OUT_OPTIONS).toEqual(['off', 'rare', 'often'])
    expect(DEFAULT_RADIO_DROP_OUTS).toBe('rare')
  })

  it('normalizes anything unrecognised to rare', () => {
    expect(normalizeRadioDropOuts('always')).toBe('rare')
    expect(normalizeRadioDropOuts(undefined)).toBe('rare')
    expect(normalizeRadioDropOuts(1)).toBe('rare')
  })

  it('is sparse by default -- about one every sixty bars at mid pace', () => {
    // mid draws 6-12 bars, mean 9. 9 / 0.15 = 60 bars, about two minutes
    // at 120bpm. Elling: "rarely i think. since it's working quite well
    // currently."
    expect(RADIO_DROP_OUT_CHANCE.rare).toBe(0.15)
    expect(RADIO_DROP_OUT_CHANCE.often).toBe(0.4)
    expect(RADIO_DROP_OUT_CHANCE.off).toBe(0)
  })

  it('never schedules one when off', () => {
    expect(shouldScheduleDropOut('off', seeded([0]))).toBe(false)
    expect(shouldScheduleDropOut('off', seeded([0.99]))).toBe(false)
  })

  it('schedules one only below the rate', () => {
    expect(shouldScheduleDropOut('rare', seeded([0.1]))).toBe(true)
    expect(shouldScheduleDropOut('rare', seeded([0.2]))).toBe(false)
    expect(shouldScheduleDropOut('often', seeded([0.2]))).toBe(true)
  })
})

describe('which layer drops out', () => {
  it('is drums or bass and nothing else', () => {
    expect(DROP_OUT_ELIGIBLE_KINDS).toEqual(['drums', 'bass'])
  })

  it('ignores a lead, a pad and a trait-only layer', () => {
    const pool = [
      { id: 'a', kinds: ['lead' as const] },
      { id: 'b', kinds: ['warm' as const] },
      { id: 'c', kinds: ['rhythmic' as const] }
    ]
    expect(pickDropOutSlotId(pool, seeded([0]))).toBeNull()
  })

  it('returns null rather than dropping the only audible layer', () => {
    expect(pickDropOutSlotId([{ id: 'a', kinds: ['drums' as const] }], seeded([0]))).toBeNull()
  })

  it('weights drums three to one over bass', () => {
    const pool = [
      { id: 'd', kinds: ['drums' as const] },
      { id: 'b', kinds: ['bass' as const] }
    ]
    // Total weight 3 + 1 = 4. A draw below 0.75 lands on drums.
    expect(pickDropOutSlotId(pool, seeded([0.74]))).toBe('d')
    expect(pickDropOutSlotId(pool, seeded([0.76]))).toBe('b')
  })

  it('treats a combination slot containing drums as drums', () => {
    const pool = [
      { id: 'd', kinds: ['drums' as const, 'rhythmic' as const] },
      { id: 'x', kinds: ['lead' as const] }
    ]
    expect(pickDropOutSlotId(pool, seeded([0.5]))).toBe('d')
  })
})

describe('how long a drop-out is', () => {
  it('is two beats most of the time, one or four sometimes', () => {
    // weights 0.2 / 0.5 / 0.3 over [1, 2, 4]
    expect(pickDropOutBeats(seeded([0.1]))).toBe(1)
    expect(pickDropOutBeats(seeded([0.5]))).toBe(2)
    expect(pickDropOutBeats(seeded([0.8]))).toBe(4)
    expect(pickDropOutBeats(seeded([0.9999]))).toBe(4)
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/shared/radioDropOut.test.ts`
Expected: FAIL — `Failed to load ./radioDropOut`.

- [ ] **Step 3: Implement**

Create `src/shared/radioDropOut.ts`:

```ts
// src/shared/radioDropOut.ts
//
// Radio's standalone drop-out -- docs/superpowers/specs/2026-09-28-radio-
// controls-design.md section 4. Elling, 2026-09-28: "yep, holes = good.
// drop out the drums for a few beats or something", and then "drums drop
// out rarely... rarely i think. since it's working quite well currently."
//
// A drop-out is NOT a stem change. Radio occasionally mutes one layer for
// a few beats and brings it back at the top of the loop, and that is the
// whole feature. It is pure arrangement: nothing is chosen, fetched or
// rendered.
//
// Everything here is pure and takes its randomness injected, both so it
// can be tested deterministically and because this repo's
// react-hooks/purity rule rejects a bare Math.random() inside a
// component-scoped function.
import type { DiscoverSlotKind } from './discoverSlotKind'
import type { AutomationPoint } from './toolkit'

export type RadioDropOuts = 'off' | 'rare' | 'often'

export const RADIO_DROP_OUT_OPTIONS: RadioDropOuts[] = ['off', 'rare', 'often']

export const DEFAULT_RADIO_DROP_OUTS: RadioDropOuts = 'rare'

/** Chance that the coming interval contains a drop-out. Rolled ONCE per
 * interval, right where radio already picks its next stem -- no second
 * clock.
 *
 * `rare` is the default and it is deliberately sparse. `mid` draws 6-12
 * bars, mean 9, so 9 / 0.15 = a drop-out every 60 bars on average, about
 * two minutes at 120bpm. `often` gives about 22 bars, around forty-five
 * seconds. If it happened every lap it would be a rhythm rather than a
 * gesture, and the point of the feature would be gone. */
export const RADIO_DROP_OUT_CHANCE: Record<RadioDropOuts, number> = {
  off: 0,
  rare: 0.15,
  often: 0.4
}

export function normalizeRadioDropOuts(value: unknown): RadioDropOuts {
  return RADIO_DROP_OUT_OPTIONS.includes(value as RadioDropOuts)
    ? (value as RadioDropOuts)
    : DEFAULT_RADIO_DROP_OUTS
}

export function shouldScheduleDropOut(
  rate: RadioDropOuts,
  random: () => number = Math.random
): boolean {
  const chance = RADIO_DROP_OUT_CHANCE[rate]
  if (chance <= 0) return false
  return random() < chance
}

/** Only a drums or a bass layer. Dropping a pad or a texture is close to
 * inaudible and reads as a bug rather than a gesture: the move works
 * because the ear is COUNTING on the thing that disappears.
 *
 * `lead` is deliberately out -- dropping the melody for two beats is a
 * real move and also exactly what a mistake sounds like, and the
 * difference depends on material this cannot see. Trait-only slots
 * (chonky/rhythmic/sparkly/buttery) have no instrument identity at all.
 * Both are named on the spec's "not now" list rather than forgotten. */
export const DROP_OUT_ELIGIBLE_KINDS: DiscoverSlotKind[] = ['drums', 'bass']

/** Drums three to one over bass. Drums is the classic; bass is the other
 * one, because its absence sets up a return. */
const DROP_OUT_KIND_WEIGHT: Record<string, number> = { drums: 3, bass: 1 }

export interface DropOutCandidate {
  id: string
  kinds: DiscoverSlotKind[]
}

/** Which layer drops out, or null for "not this time".
 *
 * Null rather than an error for every legitimate reason: nothing eligible,
 * or only ONE audible layer -- a drop-out that leaves silence is a
 * different and much riskier move (the breakdown, spec 4.7, explicitly not
 * now). The caller passes only the slots that are currently audible, so
 * `candidates.length < 2` is exactly the "would leave silence" test.
 *
 * A combination slot counts as its strongest eligible kind, so a
 * drums+rhythmic slot is drums. */
export function pickDropOutSlotId(
  candidates: readonly DropOutCandidate[],
  random: () => number = Math.random
): string | null {
  if (candidates.length < 2) return null
  const weighted = candidates
    .map((c) => ({
      id: c.id,
      weight: Math.max(0, ...c.kinds.map((k) => DROP_OUT_KIND_WEIGHT[k] ?? 0))
    }))
    .filter((c) => c.weight > 0)
  if (weighted.length === 0) return null
  const total = weighted.reduce((sum, c) => sum + c.weight, 0)
  let draw = random() * total
  for (const c of weighted) {
    draw -= c.weight
    if (draw < 0) return c.id
  }
  return weighted[weighted.length - 1].id
}

/** How long, in beats. Weighted rather than fixed for the same reason the
 * pace is a window rather than a number: a fixed length is a rhythm, a
 * varied length is a gesture. Two beats is the safe and common one; a full
 * bar is the dramatic one. */
const DROP_OUT_BEAT_WEIGHTS: { beats: number; weight: number }[] = [
  { beats: 1, weight: 0.2 },
  { beats: 2, weight: 0.5 },
  { beats: 4, weight: 0.3 }
]

export function pickDropOutBeats(random: () => number = Math.random): number {
  let draw = random()
  for (const { beats, weight } of DROP_OUT_BEAT_WEIGHTS) {
    draw -= weight
    if (draw < 0) return beats
  }
  return DROP_OUT_BEAT_WEIGHTS[DROP_OUT_BEAT_WEIGHTS.length - 1].beats
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/shared/radioDropOut.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/radioDropOut.ts src/shared/radioDropOut.test.ts
git commit -m "which layer drops out, for how long, and how rarely

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

---

## Task 7: The drop-out curve

**Files:**
- Modify: `src/shared/radioDropOut.ts` (append)
- Modify: `src/shared/radioDropOut.test.ts`

This is the task that satisfies Elling's hard requirement, and it is testable as plain data
because **a curve is a value**.

- [ ] **Step 1: Write the failing tests**

Add `buildDropOutCurve` to the import in `src/shared/radioDropOut.test.ts` and append:

```ts
describe('the drop-out curve', () => {
  it('returns to full gain at bar 0 -- the top of the loop IS the anchor', () => {
    const curve = buildDropOutCurve(8, 2)
    expect(curve[0]).toEqual({ bar: 0, value: 1 })
  })

  it('leaves two beats before the wrap on an 8-bar loop', () => {
    // 2 beats of a 4/4 bar = 0.5 bars, so full gain holds to bar 7.5.
    const curve = buildDropOutCurve(8, 2)
    expect(curve[1]).toEqual({ bar: 7.5, value: 1 })
  })

  it('ramps down rather than stepping -- a hard gain step on a sounding source pops', () => {
    const curve = buildDropOutCurve(8, 2)
    expect(curve[2].bar).toBeGreaterThan(7.5)
    expect(curve[2].bar).toBeLessThan(7.55)
    expect(curve[2].value).toBe(0)
  })

  it('holds silence right through to the wrap', () => {
    const curve = buildDropOutCurve(8, 2)
    expect(curve[curve.length - 1]).toEqual({ bar: 8, value: 0 })
  })

  it('measures a one-beat and a four-beat drop backwards from the same wrap', () => {
    expect(buildDropOutCurve(8, 1)[1].bar).toBe(7.75)
    expect(buildDropOutCurve(8, 4)[1].bar).toBe(7)
  })

  it('works on a short loop', () => {
    const curve = buildDropOutCurve(2, 2)
    expect(curve[0]).toEqual({ bar: 0, value: 1 })
    expect(curve[1]).toEqual({ bar: 1.5, value: 1 })
    expect(curve[curve.length - 1]).toEqual({ bar: 2, value: 0 })
  })

  it('refuses to drop more than half the loop', () => {
    // A 4-beat drop on a 1-bar loop would silence the whole lap. Clamped
    // to half, the same rule FadeGain.cpp:33-51 already applies to fades.
    const curve = buildDropOutCurve(1, 4)
    expect(curve[1].bar).toBe(0.5)
  })

  it('returns an empty curve for a loop it cannot place a gesture in', () => {
    expect(buildDropOutCurve(0, 2)).toEqual([])
    expect(buildDropOutCurve(8, 0)).toEqual([])
  })

  it('is ascending in bar, which is what normaliseAutomationCurve expects', () => {
    const curve = buildDropOutCurve(8, 2)
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i].bar).toBeGreaterThan(curve[i - 1].bar)
    }
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/shared/radioDropOut.test.ts`
Expected: FAIL — `buildDropOutCurve is not a function`.

- [ ] **Step 3: Implement**

Append to `src/shared/radioDropOut.ts`:

```ts
/** 4/4, as everywhere else in Discover. */
const BEATS_PER_BAR = 4

/** The ramp in and out of silence, in bars. Short enough to read as a cut,
 * long enough not to pop -- the same order as FadeGain's own ~3ms
 * anti-click and the phone's 15ms MUTE_RAMP. At 120bpm 0.02 bars is 40ms;
 * at 160 it is 30ms. Expressed in bars rather than ms because everything
 * on an automation lane is, and because a bar-relative ramp means the same
 * thing at every tempo. */
const DROP_OUT_RAMP_BARS = 0.02

/**
 * The whole drop-out, as one `volume` curve in CLIP-RELATIVE bars, ready
 * to go into previewState.stemAutomation[stemKey(groupId, slot)].
 *
 * THIS IS THE ENTIRE REASON THE FEATURE IS ACCURATE. Elling, 2026-09-28:
 * "also make sure to transition on the proper beat... that's key" and then
 * "not just the downbeat, the proper start of the loop, i think".
 *
 * Radio's clock is a React effect fed at 30Hz, so a gesture FIRED from it
 * would be up to 33ms late plus a render plus an IPC round trip, every
 * time. A curve is different in kind: it is part of the material the
 * engine is already playing, evaluated per block and smoothed per sample
 * (AutomationCurve.h's ParamSmoother, kAutomationSmoothingSec = 0.015), so
 * the 30Hz tick is nowhere in the timed path. Arming can be a whole lap
 * early and a hundred milliseconds of jitter in WHEN it is armed has
 * exactly zero effect on WHEN it fires.
 *
 * And the anchor comes free. A toolkit curve is clip-relative (originBar,
 * which is 0 for a preview clip at startBar 0) and the transport wraps at
 * loopLengthBars, so the curve REPEATS EVERY LAP and can only be anchored
 * to the top of the loop. The constraint is the requirement.
 *
 * Read the shape: full gain at bar 0 (the return -- the curve resets here
 * on every wrap), holding until `beats` before the end, a short ramp to
 * silence, silent through to the wrap. Durations count BACKWARDS from the
 * return, never forwards from the trigger; building it the other way round
 * is the single most likely way to make this sound broken.
 *
 * Clamped to half the loop so a gesture can never run into the wrap it is
 * anchored to -- the same rule, for the same reason, that FadeGain.cpp
 * already applies to clip fades. Returns [] for anything it cannot place,
 * which the caller treats as "no drop-out this time" rather than an error.
 */
export function buildDropOutCurve(loopBars: number, beats: number): AutomationPoint[] {
  if (!(loopBars > 0) || !(beats > 0)) return []
  const wanted = beats / BEATS_PER_BAR
  const dropBars = Math.min(wanted, loopBars / 2)
  const leaveAt = loopBars - dropBars
  const silentAt = leaveAt + Math.min(DROP_OUT_RAMP_BARS, dropBars / 2)
  if (!(leaveAt > 0) || !(silentAt < loopBars)) return []
  return [
    { bar: 0, value: 1 },
    { bar: leaveAt, value: 1 },
    { bar: silentAt, value: 0 },
    { bar: loopBars, value: 0 }
  ]
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/shared/radioDropOut.test.ts`
Expected: PASS. Then `npm test` — 199 files, suite green.

- [ ] **Step 5: Commit**

```bash
git add src/shared/radioDropOut.ts src/shared/radioDropOut.test.ts
git commit -m "the drums come back exactly on the one, because the curve is already in the engine

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

---

## Task 8: Arm and clear the drop-out in the panel

**Files:**
- Modify: `src/renderer/src/components/DiscoverPanel.tsx` — imports, radio state block
  (`:1151-1200`), the clock effect (`:1202-1257`), `syncPreviewToEngine` (`:763-950`),
  `toggleRadio` (`:2316`)

No component test — finding 15.

- [ ] **Step 1: Add the imports and the state**

Add to the imports:

```ts
import {
  DEFAULT_RADIO_DROP_OUTS,
  buildDropOutCurve,
  pickDropOutBeats,
  pickDropOutSlotId,
  shouldScheduleDropOut
} from '@shared/radioDropOut'
import { stemKey } from '@shared/types'
import type { StemAutomation } from '@shared/toolkit'
```

(`stemKey` may already be imported — check before adding a duplicate.)

Add to the radio state block, immediately after `radioLastSlotRef` at `:1180`:

```ts
  // The armed drop-out: which slot is holding a volume curve, so the next
  // sync can clear it. A REF, for the same reason radioClockRef is one --
  // it is written from the 30Hz position effect and nothing renders it.
  //
  // `lapsLeft` counts laps, not milliseconds: the curve fires at the top
  // of the loop it is armed for, so it is cleared on the NEXT wrap after
  // that. Arming early is free (spec 0A); clearing late is harmless
  // (a repeated drop-out on one extra lap would be audible, so it is not
  // allowed to happen -- see the wrap branch of the clock effect).
  const radioDropOutRef = useRef<{ slotId: string; lapsLeft: number } | null>(null)
```

- [ ] **Step 2: Make `syncPreviewToEngine` write the curve**

In `syncPreviewToEngine`, find where `previewState` is built (`:887-895`). Immediately before it,
add:

```ts
    // The armed drop-out, as a volume automation curve on the dropped
    // slot's own stem. This is the ONLY way a gesture can land on the
    // beat in this codebase (spec 0A): the engine holds the curve and
    // performs it per sample, so radio's 30Hz React clock is nowhere in
    // the timed path. Arming is not timing-critical and clearing it is a
    // later sync writing {} here.
    //
    // buildEngineProject reads state.stemAutomation?.[key] and
    // isStemToolkitNeutral drops the whole toolkit key when nothing is
    // drawn, so an EMPTY record makes the project byte-identical to what
    // shipped before this feature existed. Do not "simplify" that away.
    const stemAutomation: Record<string, StemAutomation> = {}
    const armedDropOut = radioDropOutRef.current
    if (armedDropOut) {
      const slotIndex = members.findIndex((m) => m.id === armedDropOut.slotId) + 1
      const curve = buildDropOutCurve(maxBarLength, radioDropOutBeatsRef.current)
      if (slotIndex > 0 && curve.length > 0) {
        stemAutomation[stemKey(groupId, slotIndex)] = { volume: curve }
      }
    }
```

Then add `stemAutomation` to the `previewState` object literal, beside the `rifffs` replacement.

Add one more ref beside `radioDropOutRef`:

```ts
  // How long the armed drop-out is, in beats. Separate from the ref above
  // because the curve is rebuilt on every sync (maxBarLength can change
  // under it when another slot resolves) and the LENGTH must not be
  // re-drawn each time -- that would make one gesture change duration
  // mid-lap.
  const radioDropOutBeatsRef = useRef(2)
```

Check the names `members`, `groupId` and `maxBarLength` against the real function body before
writing — they are the locals at `:806-860`. If `groupId` is not in scope at that point, take it
from the `assembleDiscoverRifff` result the same way `currentPreviewMappingRef` does at `:929-932`,
and move the block below that call.

- [ ] **Step 3: Arm and clear it from the clock effect**

In the clock effect, immediately after `const step = advanceRadioClock(...)` and the
`radioClockRef.current = step.clock` assignment, add:

```ts
    // A drop-out is anchored to the loop top, so its lifetime is counted
    // in laps. One wrap after the lap it fired on, the curve comes off --
    // leaving it armed would repeat the gesture every lap, which is a
    // rhythm rather than a move.
    if (step.wrapped && radioDropOutRef.current !== null) {
      const armed = radioDropOutRef.current
      if (armed.lapsLeft <= 1) {
        radioDropOutRef.current = null
        scheduleSyncPreviewToEngine()
      } else {
        radioDropOutRef.current = { ...armed, lapsLeft: armed.lapsLeft - 1 }
      }
    }
```

Then, inside the deferred commit block (the `void Promise.resolve().then(...)` at `:1239`),
immediately before `void armRadioPick()`, add:

```ts
      // Roll ONCE per interval for a drop-out in the coming one -- no
      // second clock. Never on the slot that just changed and never in a
      // way that leaves silence: pickDropOutSlotId is handed only the
      // AUDIBLE slots and returns null below two of them.
      //
      // No pushUndoSnapshot, for the same reason the change above takes
      // none: a drop-out is performance, not an edit.
      if (radioDropOutRef.current === null && shouldScheduleDropOut(DEFAULT_RADIO_DROP_OUTS)) {
        const audible = slotsRef.current
          .filter((s) => previewingSlotIdsRef.current.has(s.id) && s.id !== pending?.slotId)
          .map((s) => ({ id: s.id, kinds: s.kinds }))
        const dropId = pickDropOutSlotId(audible)
        if (dropId !== null) {
          radioDropOutBeatsRef.current = pickDropOutBeats()
          radioDropOutRef.current = { slotId: dropId, lapsLeft: 1 }
          scheduleSyncPreviewToEngine()
        }
      }
```

`DEFAULT_RADIO_DROP_OUTS` is used directly: **Phase B ships no setting.** Phase C replaces this one
identifier with `radioSettings.dropOuts`.

- [ ] **Step 4: Clear it when radio stops**

In `toggleRadio`'s off branch (`:2317-2325`), beside `radioPendingRef.current = null`, add:

```ts
      radioDropOutRef.current = null
      scheduleSyncPreviewToEngine()
```

and do the same in the panel-reset teardown at `:1574-1575`. **A curve left on a stem after radio
stops would silently break that slot's gain dial** (finding 9).

- [ ] **Step 5: Verify**

```bash
npm run typecheck
npm run lint
npm test
```

Expected: typecheck 0 errors, lint 0 errors + the 4 baseline warnings, suite green.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/DiscoverPanel.tsx
git commit -m "every couple of minutes the drums leave for two beats and come back on the one

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

- [ ] **Step 7: STOP and report**

Phase B is complete. Tell Elling what to listen for — roughly one drop-out every couple of
minutes at the default pace, drums three times out of four, two beats most of the time, always
returning as the loop restarts. Say plainly that nothing was heard: this environment has no audio
tooling, so the *timing* claim rests on the curve being data the engine performs, which is asserted
in `radioDropOut.test.ts`, and not on anything anyone listened to.

**Do not start Phase C until he has heard this.**
