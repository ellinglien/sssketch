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

---

# PHASE C — the menu

> "more parameters .. maybe even a menu"

Six chip rows do not fit on the Discover actions row, and radio stays something you press and
listen to — so the controls live behind the radio button. This phase also **migrates the settings
into one nested object**, which is what stops the prop threading growing to sixteen props.

---

## Task 9: `RadioSettings` — the shape, the defaults, the migration

**Files:**
- Modify: `src/shared/radioSchedule.ts` (append)
- Modify: `src/shared/radioSchedule.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/shared/radioSchedule.test.ts` (extending the import with `DEFAULT_RADIO_SETTINGS`,
`RADIO_CHANNELS_MAX`, `RADIO_CHANNELS_MIN`, `RADIO_TURNOVER_OPTIONS`, `DEFAULT_RADIO_TURNOVER`,
`normalizeRadioSettings`, `normalizeRadioTurnover`, `radioStarterKinds`):

```ts
describe('RadioSettings', () => {
  it('defaults to mid, own loop, four channels, subtle, rare and even', () => {
    expect(DEFAULT_RADIO_SETTINGS).toEqual({
      pace: 'mid',
      grid: 'own loop',
      channels: 4,
      transitions: 'subtle',
      dropOuts: 'rare',
      turnover: 'even'
    })
  })

  it('normalizes a whole object, field by field, never throwing', () => {
    expect(normalizeRadioSettings({ pace: 'fast', grid: '4 bars', channels: 6 })).toEqual({
      pace: 'fast',
      grid: '4 bars',
      channels: 6,
      transitions: 'subtle',
      dropOuts: 'rare',
      turnover: 'even'
    })
    expect(normalizeRadioSettings(null)).toEqual(DEFAULT_RADIO_SETTINGS)
    expect(normalizeRadioSettings('nonsense')).toEqual(DEFAULT_RADIO_SETTINGS)
    expect(normalizeRadioSettings({ pace: 'glacial', grid: 99 })).toEqual(DEFAULT_RADIO_SETTINGS)
  })

  it('clamps the channel count to four through eight', () => {
    expect(RADIO_CHANNELS_MIN).toBe(4)
    expect(RADIO_CHANNELS_MAX).toBe(8)
    expect(normalizeRadioSettings({ channels: 1 }).channels).toBe(4)
    expect(normalizeRadioSettings({ channels: 40 }).channels).toBe(8)
    expect(normalizeRadioSettings({ channels: 6.5 }).channels).toBe(6)
    expect(normalizeRadioSettings({ channels: 'six' }).channels).toBe(4)
  })

  it('migrates a pre-2026-09-28 settings file, which stored the pace flat', () => {
    // Anyone running 1.3.0 has { radioPace: 'fast' } on disk and no
    // `radio` object at all. That value must survive, not throw and not
    // silently reset.
    expect(normalizeRadioSettings(undefined, 'fast')).toEqual({
      ...DEFAULT_RADIO_SETTINGS,
      pace: 'fast'
    })
    expect(normalizeRadioSettings(undefined, 'glacial').pace).toBe('mid')
    expect(normalizeRadioSettings({ pace: 'slow' }, 'fast').pace).toBe('slow')
  })

  it('offers even and random turnover, defaulting to even', () => {
    expect(RADIO_TURNOVER_OPTIONS).toEqual(['even', 'random'])
    expect(DEFAULT_RADIO_TURNOVER).toBe('even')
    expect(normalizeRadioTurnover('fair')).toBe('even')
  })
})

describe('radioStarterKinds', () => {
  it('lays down the shipped four at four', () => {
    expect(radioStarterKinds(4)).toEqual(['drums', 'bass', 'lead', 'warm'])
  })

  it('adds a second drum layer fifth -- a groove gets its top end from perc', () => {
    expect(radioStarterKinds(5)).toEqual(['drums', 'bass', 'lead', 'warm', 'drums'])
  })

  it('grows from the left, so every prefix still sounds like a band', () => {
    expect(radioStarterKinds(8)).toEqual([
      'drums',
      'bass',
      'lead',
      'warm',
      'drums',
      'bright',
      'rhythmic',
      'lead'
    ])
    for (let n = 4; n <= 8; n++) {
      expect(radioStarterKinds(n)).toEqual(radioStarterKinds(8).slice(0, n))
    }
  })

  it('clamps out of range rather than throwing', () => {
    expect(radioStarterKinds(0)).toHaveLength(4)
    expect(radioStarterKinds(99)).toHaveLength(8)
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/shared/radioSchedule.test.ts`
Expected: FAIL at import — `No "DEFAULT_RADIO_SETTINGS" export is defined`.

- [ ] **Step 3: Implement**

Append to `src/shared/radioSchedule.ts`:

```ts
/** How radio chooses WHICH layer turns over. `even` biases toward the
 * least-recently-changed; `random` is the memoryless draw that shipped
 * 2026-09-26. Elling hit a ~4.7-minute drought with the latter on
 * 2026-09-28 -- "this is good for consistency but i'd love to have some
 * control" -- so `random` is kept as a choice rather than removed. */
export type RadioTurnover = 'even' | 'random'

export const RADIO_TURNOVER_OPTIONS: RadioTurnover[] = ['even', 'random']

/** `even`. A five-minute hold nobody asked for reads as broken, and the
 * deliberate way to hold a layer is the hook. More channels makes the
 * drought worse (one change per interval across six layers is half the
 * rate of three), which is the strongest argument for this default. */
export const DEFAULT_RADIO_TURNOVER: RadioTurnover = 'even'

export function normalizeRadioTurnover(value: unknown): RadioTurnover {
  return RADIO_TURNOVER_OPTIONS.includes(value as RadioTurnover)
    ? (value as RadioTurnover)
    : DEFAULT_RADIO_TURNOVER
}

/** How many layers radio lays down when started on an EMPTY panel.
 * Elling, 2026-09-28: "see if more channels are feasible.. lots ideally...
 * but maybe slider up to 8?".
 *
 * This is NOT a cap on Discover. addSlot has no cap and never has -- he
 * ran twelve slots the same day -- and nothing here adds one. It is only
 * the size of the starting bed. */
export const RADIO_CHANNELS_MIN = 4
export const RADIO_CHANNELS_MAX = 8

/** The bed, in the order it grows. Every PREFIX has to sound like a band
 * on its own, because the chip row grows it from the left:
 *   1-4  the shipped set -- the smallest thing that sounds like a band
 *   5    a SECOND drum layer: a groove gets its top end from hats and
 *        perc over the kick-and-snare bed. Biggest gain per slot.
 *   6    bright -- the counterweight to warm; a high end that is not the
 *        lead
 *   7    rhythmic -- a texture chosen for MOVEMENT rather than instrument,
 *        filling the space between the bed and the lead
 *   8    a second lead -- a counter-line. Two melodic voices, not two
 *        basses: two basses fight, two leads converse. The dedupe pass in
 *        pickForSlot keeps it from drawing the same stem. */
const RADIO_STARTER_ORDER: DiscoverSlotKind[] = [
  'drums',
  'bass',
  'lead',
  'warm',
  'drums',
  'bright',
  'rhythmic',
  'lead'
]

export function radioStarterKinds(channels: number): DiscoverSlotKind[] {
  const n = Math.min(
    RADIO_CHANNELS_MAX,
    Math.max(RADIO_CHANNELS_MIN, Math.floor(Number(channels) || 0))
  )
  return RADIO_STARTER_ORDER.slice(0, n)
}

/** Everything the radio menu sets, in one object rather than six flat
 * fields on DiscoverSettings.
 *
 * Nested because the alternative is threading six pairs of props through
 * App.tsx -> LibraryBrowser.tsx -> DiscoverPanel.tsx, which is sixteen
 * props for what is one concept. `reach` and `character` are deliberately
 * absent: they ship in their own plans (spec 10, phases F and G) and a
 * field nothing reads is a lie. */
export interface RadioSettings {
  pace: RadioPace
  grid: RadioGrid
  channels: number
  transitions: RadioTransitions
  dropOuts: RadioDropOuts
  turnover: RadioTurnover
}

export const DEFAULT_RADIO_SETTINGS: RadioSettings = {
  pace: DEFAULT_RADIO_PACE,
  grid: DEFAULT_RADIO_GRID,
  channels: RADIO_CHANNELS_MIN,
  transitions: DEFAULT_RADIO_TRANSITIONS,
  dropOuts: DEFAULT_RADIO_DROP_OUTS,
  turnover: DEFAULT_RADIO_TURNOVER
}

/** Field by field, never throwing -- the same shape loadDiscoverSettings
 * already uses for traitMatchBar and radioPace.
 *
 * `legacyPace` is the MIGRATION. Anyone running 1.3.0 has a flat
 * `radioPace` on disk and no `radio` object, and their chosen pace must
 * survive the move rather than silently resetting to mid. An explicit
 * `radio.pace` always wins over it. */
export function normalizeRadioSettings(value: unknown, legacyPace?: unknown): RadioSettings {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Partial<RadioSettings>
  const pace =
    raw.pace !== undefined ? normalizeRadioPace(raw.pace) : normalizeRadioPace(legacyPace)
  const channels = Number(raw.channels)
  return {
    pace,
    grid: normalizeRadioGrid(raw.grid),
    channels: Number.isFinite(channels)
      ? Math.min(RADIO_CHANNELS_MAX, Math.max(RADIO_CHANNELS_MIN, Math.floor(channels)))
      : RADIO_CHANNELS_MIN,
    transitions: normalizeRadioTransitions(raw.transitions),
    dropOuts: normalizeRadioDropOuts(raw.dropOuts),
    turnover: normalizeRadioTurnover(raw.turnover)
  }
}
```

Add at the top of the file:

```ts
import type { DiscoverSlotKind } from './discoverSlotKind'
import { DEFAULT_RADIO_DROP_OUTS, normalizeRadioDropOuts, type RadioDropOuts } from './radioDropOut'
import {
  DEFAULT_RADIO_TRANSITIONS,
  normalizeRadioTransitions,
  type RadioTransitions
} from './radioTransition'
```

**`src/shared/radioTransition.ts` does not exist until Task 16.** Create it now as a three-export
stub so this task compiles, and Task 16 fills it in:

```ts
// src/shared/radioTransition.ts -- see Task 16 for the rest.
export type RadioTransitions = 'off' | 'subtle' | 'bold'
export const RADIO_TRANSITIONS_OPTIONS: RadioTransitions[] = ['off', 'subtle', 'bold']
export const DEFAULT_RADIO_TRANSITIONS: RadioTransitions = 'subtle'
export function normalizeRadioTransitions(value: unknown): RadioTransitions {
  return RADIO_TRANSITIONS_OPTIONS.includes(value as RadioTransitions)
    ? (value as RadioTransitions)
    : DEFAULT_RADIO_TRANSITIONS
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/shared/radioSchedule.test.ts src/shared/radioDropOut.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/radioSchedule.ts src/shared/radioSchedule.test.ts src/shared/radioTransition.ts
git commit -m "one object for everything the radio menu sets, and the old pace survives the move

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

---

## Task 10: Migrate the settings store

**Files:**
- Modify: `src/main/discoverSettingsStore.ts`
- Modify: `src/main/discoverSettingsStore.test.ts`

**Finding 14: every existing `toEqual` and every existing `saveDiscoverSettings({...})` in that
test file breaks.** Update all of them; do not reach for `expect.objectContaining`.

- [ ] **Step 1: Write the failing tests**

Replace every `radioPace: 'mid'` in an object literal in `src/main/discoverSettingsStore.test.ts`
with `radio: DEFAULT_RADIO_SETTINGS`, import `DEFAULT_RADIO_SETTINGS` from
`@shared/radioSchedule`, and rewrite the two radio-specific cases plus add the migration case:

```ts
  it('round-trips every radio setting', async () => {
    const { loadDiscoverSettings, saveDiscoverSettings } = await import('./discoverSettingsStore')
    saveDiscoverSettings({
      consentedToLibraryScan: true,
      traitMatchBar: 0.9,
      radio: {
        pace: 'fast',
        grid: '2 bars',
        channels: 7,
        transitions: 'bold',
        dropOuts: 'often',
        turnover: 'random'
      }
    })
    expect(loadDiscoverSettings().radio).toEqual({
      pace: 'fast',
      grid: '2 bars',
      channels: 7,
      transitions: 'bold',
      dropOuts: 'often',
      turnover: 'random'
    })
  })

  it('migrates a 1.3.0 file, which stored radioPace flat and had no radio object', async () => {
    writeFileSync(
      join(dir, 'discoverSettings.json'),
      JSON.stringify({ consentedToLibraryScan: true, traitMatchBar: 0.9, radioPace: 'fast' }),
      'utf-8'
    )
    const { loadDiscoverSettings } = await import('./discoverSettingsStore')
    const loaded = loadDiscoverSettings()
    expect(loaded.consentedToLibraryScan).toBe(true)
    expect(loaded.traitMatchBar).toBe(0.9)
    expect(loaded.radio).toEqual({ ...DEFAULT_RADIO_SETTINGS, pace: 'fast' })
  })

  it('defaults a nonsense radio object rather than throwing', async () => {
    writeFileSync(join(dir, 'discoverSettings.json'), JSON.stringify({ radio: 7 }), 'utf-8')
    const { loadDiscoverSettings } = await import('./discoverSettingsStore')
    expect(() => loadDiscoverSettings()).not.toThrow()
    expect(loadDiscoverSettings().radio).toEqual(DEFAULT_RADIO_SETTINGS)
  })
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/main/discoverSettingsStore.test.ts`
Expected: FAIL — type errors on `radio` not existing, and the migration case returning no `radio`.

- [ ] **Step 3: Implement**

In `src/main/discoverSettingsStore.ts`: change the import to
`import { DEFAULT_RADIO_SETTINGS, normalizeRadioSettings, type RadioSettings } from '@shared/radioSchedule'`,
replace the `radioPace` field on `DiscoverSettings` with:

```ts
  /** Everything the radio menu sets -- pace, change grid, starting channel
   * count, transitions, drop-out rate, turnover. One nested object rather
   * than six flat fields; see RadioSettings' own doc comment. Persisted
   * because re-picking them every launch is an annoyance with a four-line
   * fix. docs/superpowers/specs/2026-09-28-radio-controls-design.md. */
  radio: RadioSettings
```

set `radio: DEFAULT_RADIO_SETTINGS` in `DEFAULT_SETTINGS`, and in `loadDiscoverSettings`'s parse
branch replace the `radioPace` line with:

```ts
      // `parsed.radioPace` is the 1.3.0 shape -- flat, no `radio` object.
      // Passing it through migrates a real user's chosen pace rather than
      // silently resetting it. An explicit `radio.pace` always wins.
      radio: normalizeRadioSettings(
        parsed.radio,
        (parsed as { radioPace?: unknown }).radioPace
      )
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/main/discoverSettingsStore.test.ts && npm run typecheck`
Expected: PASS; typecheck will still fail in `App.tsx`/`LibraryBrowser.tsx`/`DiscoverPanel.tsx`,
which Task 11 fixes. That is expected and is why Tasks 10 and 11 are adjacent.

- [ ] **Step 5: Commit** (after Task 11 — this pair does not typecheck alone)

---

## Task 11: Collapse the prop threading

**Files:**
- Modify: `src/renderer/src/App.tsx:1659-1666`, `:1701-1706`, `:2761-2762`
- Modify: `src/renderer/src/components/LibraryBrowser.tsx:133-134`, `:174-175`, `:2283-2284`
- Modify: `src/renderer/src/components/DiscoverPanel.tsx:317-318`, `:375-378`

- [ ] **Step 1: App.tsx**

Replace `radioPace: DEFAULT_RADIO_PACE` in the `useState` literal with
`radio: DEFAULT_RADIO_SETTINGS`, replace `const radioPace = discoverSettings.radioPace` with
`const radioSettings = discoverSettings.radio`, and replace the `setRadioPace` function with:

```ts
  /** The one real setter for every radio menu control -- patches the
   * nested object and routes through updateDiscoverSettings, which MERGES
   * (App.tsx's own comment: saving a partial object "would silently wipe
   * traitMatchBar"). */
  async function setRadioSettings(patch: Partial<RadioSettings>): Promise<void> {
    await updateDiscoverSettings({ radio: { ...radioSettings, ...patch } })
  }
```

and the two props at `:2761-2762` become
`radioSettings={radioSettings}` / `onRadioSettingsChange={setRadioSettings}`.

- [ ] **Step 2: LibraryBrowser.tsx and DiscoverPanel.tsx**

In both, rename the two destructured props and their two type entries:

```ts
  radioSettings,
  onRadioSettingsChange,
```

```ts
  /** Everything the radio menu sets (DiscoverSettings.radio), and its
   * persisting patch setter. See docs/superpowers/specs/2026-09-28-radio-
   * controls-design.md. */
  radioSettings: RadioSettings
  onRadioSettingsChange: (patch: Partial<RadioSettings>) => Promise<void>
```

In `DiscoverPanel.tsx`, replace every remaining `radioPace` reference with `radioSettings.pace`,
`DEFAULT_RADIO_GRID` (Task 4) with `radioSettings.grid`, and `DEFAULT_RADIO_DROP_OUTS` (Task 8)
with `radioSettings.dropOuts`. Add `radioSettings.pace` and `radioSettings.grid` to the clock
effect's dependency array in place of `radioPace`. Replace `RADIO_STARTER_KINDS` in `toggleRadio`
with `radioStarterKinds(radioSettings.channels)`.

- [ ] **Step 3: Verify**

```bash
npm run typecheck && npm run lint && npm test
```

Expected: 0 errors, 4 baseline warnings, suite green. Grep for `radioPace` across `src/` —
the only surviving hits should be `normalizeRadioPace`, `DEFAULT_RADIO_PACE`, `RadioPace` and
the migration read in `discoverSettingsStore.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/main/discoverSettingsStore.ts src/main/discoverSettingsStore.test.ts src/renderer/src/App.tsx src/renderer/src/components/LibraryBrowser.tsx src/renderer/src/components/DiscoverPanel.tsx
git commit -m "one radio settings object instead of a prop pair per dial

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

---

## Task 12: `DiscoverRadioMenu.tsx`

**Files:**
- Create: `src/renderer/src/components/DiscoverRadioMenu.tsx`
- Modify: `src/renderer/src/components/DiscoverPanel.tsx:2936-2998`

**Read `src/renderer/src/components/DiscoverKindPicker.tsx` in full before writing this.** It is
the template: the same `x`/`y`/`onClose`/`ignoreRef` props, the same `useLayoutEffect` viewport
clamp, the same click-outside-plus-Escape effect with the `setTimeout(…, 0)` guard, the same
`row(label, chips)` shape, the same `position: 'fixed'` / `zIndex: 1200` / `--ra-bg-bar` /
`--ra-border-strong` / `boxShadow: '0 6px 20px rgba(0,0,0,0.4)'` container. No component test —
finding 15.

- [ ] **Step 1: Create the menu**

```tsx
// src/renderer/src/components/DiscoverRadioMenu.tsx
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  RADIO_CHANNELS_MAX,
  RADIO_CHANNELS_MIN,
  RADIO_GRID_OPTIONS,
  RADIO_PACE_OPTIONS,
  RADIO_TURNOVER_OPTIONS,
  type RadioSettings
} from '@shared/radioSchedule'
import { RADIO_DROP_OUT_OPTIONS } from '@shared/radioDropOut'
import { RADIO_TRANSITIONS_OPTIONS } from '@shared/radioTransition'

const CHANNEL_OPTIONS: number[] = Array.from(
  { length: RADIO_CHANNELS_MAX - RADIO_CHANNELS_MIN + 1 },
  (_, i) => RADIO_CHANNELS_MIN + i
)

/** Radio's own controls, behind the radio button rather than spread across
 * the Discover screen -- Elling set that constraint himself: radio stays
 * something you press and listen to. Position, dismissal and chip styling
 * all mirror DiscoverKindPicker.tsx exactly.
 *
 * The pace chips MOVED here from the actions row, which is the argument
 * for this menu existing at all rather than just being somewhere to put
 * new things: the row used to grow three chips whenever radio was on and
 * now grows one chevron. The row gets simpler as the feature gets richer.
 *
 * `channels` is chips rather than the literal slider Elling asked for:
 * five values, two characters each, is smaller and more precise than a
 * drag and it matches every other row. It sets what radio STARTS with,
 * never what Discover allows -- there is no cap on addSlot and none is
 * being added. */
export function DiscoverRadioMenu({
  x,
  y,
  settings,
  onChange,
  onClose,
  ignoreRef
}: {
  x: number
  y: number
  settings: RadioSettings
  onChange: (patch: Partial<RadioSettings>) => void
  onClose: () => void
  ignoreRef: React.RefObject<HTMLElement | null>
}): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: x, top: y })

  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const margin = 8
    const left = Math.max(margin, Math.min(x, window.innerWidth - rect.width - margin))
    const top = Math.max(margin, Math.min(y, window.innerHeight - rect.height - margin))
    setPosition({ left, top })
  }, [x, y])

  useEffect(() => {
    function handleDismiss(e: MouseEvent): void {
      if (menuRef.current?.contains(e.target as Node)) return
      if (ignoreRef.current?.contains(e.target as Node)) return
      onClose()
    }
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    const id = setTimeout(() => {
      window.addEventListener('click', handleDismiss, true)
    }, 0)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      clearTimeout(id)
      window.removeEventListener('click', handleDismiss, true)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose, ignoreRef])

  function chip(label: string, on: boolean, onClick: () => void): React.JSX.Element {
    return (
      <button
        key={label}
        aria-pressed={on}
        onClick={onClick}
        style={{
          fontFamily: 'inherit',
          fontSize: 9,
          padding: 'var(--ra-s-0) 8px',
          background: on ? 'var(--ra-bg-row-active)' : 'transparent',
          border: `1px solid ${on ? 'var(--ra-text)' : 'var(--ra-border)'}`,
          color: on ? 'var(--ra-text)' : 'var(--ra-text-2)',
          cursor: 'pointer'
        }}
      >
        {label}
      </button>
    )
  }

  function row(label: string, chips: React.JSX.Element[]): React.JSX.Element {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span
          style={{
            width: 76,
            fontSize: 9,
            color: 'var(--ra-text-3)',
            textTransform: 'uppercase',
            letterSpacing: 'var(--ra-track-eyebrow)'
          }}
        >
          {label}
        </span>
        {chips}
      </div>
    )
  }

  return (
    <div
      ref={menuRef}
      role="dialog"
      aria-label="radio settings"
      style={{
        position: 'fixed',
        left: position.left,
        top: position.top,
        zIndex: 1200,
        background: 'var(--ra-bg-bar)',
        border: '1px solid var(--ra-border-strong)',
        padding: 8,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        boxShadow: '0 6px 20px rgba(0,0,0,0.4)'
      }}
    >
      {row(
        'pace',
        RADIO_PACE_OPTIONS.map((p) => chip(p, settings.pace === p, () => onChange({ pace: p })))
      )}
      {row(
        'change on',
        RADIO_GRID_OPTIONS.map((g) => chip(g, settings.grid === g, () => onChange({ grid: g })))
      )}
      {row(
        'channels',
        CHANNEL_OPTIONS.map((n) =>
          chip(String(n), settings.channels === n, () => onChange({ channels: n }))
        )
      )}
      {row(
        'transitions',
        RADIO_TRANSITIONS_OPTIONS.map((t) =>
          chip(t, settings.transitions === t, () => onChange({ transitions: t }))
        )
      )}
      {row(
        'drop-outs',
        RADIO_DROP_OUT_OPTIONS.map((d) =>
          chip(d, settings.dropOuts === d, () => onChange({ dropOuts: d }))
        )
      )}
      {row(
        'turnover',
        RADIO_TURNOVER_OPTIONS.map((t) =>
          chip(t, settings.turnover === t, () => onChange({ turnover: t }))
        )
      )}
      <span style={{ fontSize: 9, color: 'var(--ra-text-3)' }}>
        channels is what radio starts with
      </span>
    </div>
  )
}
```

- [ ] **Step 2: Swap the pace chips for a chevron in DiscoverPanel**

Delete the `{radioOn && (<div>{RADIO_PACE_OPTIONS.map(...)}</div>)}` block at `:2978-2998`
entirely, and in its place put:

```tsx
        {radioOn && (
          <button
            ref={radioMenuButtonRef}
            onClick={(e) => {
              if (radioMenu) {
                closeRadioMenu()
                return
              }
              const rect = e.currentTarget.getBoundingClientRect()
              setRadioMenu({ x: rect.left, y: rect.bottom + 4 })
            }}
            aria-expanded={radioMenu !== null}
            data-tooltip="radio settings"
            aria-label="radio settings"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 22,
              height: 22,
              padding: 0,
              fontFamily: 'inherit',
              fontSize: 9,
              background: 'transparent',
              border: '1px solid var(--ra-border)',
              color: radioMenu ? 'var(--ra-text)' : 'var(--ra-text-3)',
              cursor: 'pointer'
            }}
          >
            v
          </button>
        )}
```

Add the state beside the other popovers (near `:3801`), and drop `RADIO_PACE_OPTIONS` from the
`@shared/radioSchedule` import if nothing else uses it:

```ts
  // Radio's own controls -- same position/dismissal pattern as nearbyMenu
  // and kindMenu above. See DiscoverRadioMenu.tsx.
  const [radioMenu, setRadioMenu] = useState<{ x: number; y: number } | null>(null)
  const radioMenuButtonRef = useRef<HTMLButtonElement>(null)
  // Stable identity -- same playhead-tick re-render reasoning as closeNearbyMenu.
  const closeRadioMenu = useCallback(() => setRadioMenu(null), [])
```

and render it next to the other popovers:

```tsx
      {radioMenu && (
        <DiscoverRadioMenu
          x={radioMenu.x}
          y={radioMenu.y}
          settings={radioSettings}
          onChange={(patch) => void onRadioSettingsChange(patch)}
          onClose={closeRadioMenu}
          ignoreRef={radioMenuButtonRef}
        />
      )}
```

- [ ] **Step 3: Verify**

```bash
npm run typecheck && npm run lint && npm test
```

Expected: 0 errors, 4 baseline warnings, suite green.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/DiscoverRadioMenu.tsx src/renderer/src/components/DiscoverPanel.tsx
git commit -m "the dials go behind the radio button, and the row gets simpler for it

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

---

# PHASE D — turnover and the hook

---

## Task 13: `pickRadioSlotId` draws by staleness, and the hook divides it

**Files:**
- Modify: `src/shared/radioSchedule.ts` (`pickRadioSlotId`)
- Modify: `src/shared/radioSchedule.test.ts`

The existing three-argument signature stays callable — the new options bag is optional, so no
existing test or call site breaks.

- [ ] **Step 1: Write the failing tests**

Add to `src/shared/radioSchedule.test.ts` (importing `HOOK_HOLD_FACTOR`):

```ts
describe('turnover fairness', () => {
  function lcg(seed: number): () => number {
    let s = seed
    return (): number => {
      s = (s * 1664525 + 1013904223) % 4294967296
      return s / 4294967296
    }
  }

  /** Runs `draws` turns and returns the longest run any slot went
   * untouched. */
  function longestDrought(
    turnover: 'even' | 'random',
    ids: string[],
    draws: number,
    random: () => number
  ): number {
    const changedAt = new Map<string, number>()
    let last: string | null = null
    let worst = 0
    for (let turn = 1; turn <= draws; turn++) {
      const picked = pickRadioSlotId(ids, last, { turnover, changedAt, turn, random })
      if (picked === null) continue
      changedAt.set(picked, turn)
      last = picked
      for (const id of ids) worst = Math.max(worst, turn - (changedAt.get(id) ?? 0))
    }
    return worst
  }

  it('reproduces the shipped uniform draw when no options are given', () => {
    expect(pickRadioSlotId(['a', 'b'], 'a', lcg(1))).toBe('b')
    expect(pickRadioSlotId([], null)).toBeNull()
    expect(pickRadioSlotId(['a'], 'a', lcg(1))).toBe('a')
  })

  it('random still strands a layer -- Elling watched one sit for five minutes', () => {
    // (2/3)^7 is about 6%, which over a session is close to certain.
    // This is kept as a CHOICE, not a bug: "this is good for consistency".
    const ids = ['a', 'b', 'c', 'd']
    expect(longestDrought('random', ids, 60, lcg(7))).toBeGreaterThanOrEqual(7)
  })

  it('even never strands a layer for anything like that long', () => {
    const ids = ['a', 'b', 'c', 'd']
    expect(longestDrought('even', ids, 60, lcg(7))).toBeLessThan(7)
  })

  it('weights a long-waiting slot far above a just-changed one', () => {
    const changedAt = new Map([['fresh', 10]])
    // 'stale' is unknown -> staleness 0 -> weight 1; 'fresh' changed at 10
    // out of turn 10 -> also weight 1. Give 'stale' six turns of waiting.
    const waited = new Map([
      ['fresh', 10],
      ['stale', 4]
    ])
    let staleWins = 0
    const random = lcg(3)
    for (let i = 0; i < 200; i++) {
      if (pickRadioSlotId(['fresh', 'stale'], null, {
        turnover: 'even',
        changedAt: waited,
        turn: 10,
        random
      }) === 'stale') {
        staleWins++
      }
    }
    // weights 1 and 7 -> stale should take roughly seven of every eight.
    expect(staleWins).toBeGreaterThan(150)
    expect(changedAt.size).toBe(1) // the function does not mutate its input
  })

  it('holds the hook eight times longer, under either turnover mode', () => {
    const random = lcg(11)
    let hookWins = 0
    for (let i = 0; i < 400; i++) {
      if (pickRadioSlotId(['hook', 'other'], null, {
        turnover: 'random',
        hookSlotId: 'hook',
        random
      }) === 'hook') {
        hookWins++
      }
    }
    expect(HOOK_HOLD_FACTOR).toBe(8)
    // weights 1/8 and 1 -> the hook should take about one in nine.
    expect(hookWins).toBeGreaterThan(10)
    expect(hookWins).toBeLessThan(100)
  })

  it('still turns the hook over eventually, because its staleness grows', () => {
    const ids = ['hook', 'b', 'c']
    const changedAt = new Map<string, number>()
    let last: string | null = null
    const random = lcg(5)
    let hookPicked = false
    for (let turn = 1; turn <= 200; turn++) {
      const picked = pickRadioSlotId(ids, last, {
        turnover: 'even',
        changedAt,
        turn,
        hookSlotId: 'hook',
        random
      })
      if (picked === null) continue
      if (picked === 'hook') hookPicked = true
      changedAt.set(picked, turn)
      last = picked
    }
    // A hook that NEVER turns over is the padlock, which already exists.
    expect(hookPicked).toBe(true)
  })

  it('never picks the same slot twice running when there is a choice', () => {
    const random = lcg(2)
    for (let i = 0; i < 50; i++) {
      expect(
        pickRadioSlotId(['a', 'b', 'c'], 'a', { turnover: 'even', random })
      ).not.toBe('a')
    }
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/shared/radioSchedule.test.ts`
Expected: FAIL — `No "HOOK_HOLD_FACTOR" export is defined`.

- [ ] **Step 3: Implement**

In `src/shared/radioSchedule.ts`, replace `pickRadioSlotId` with:

```ts
/** How much longer the hook holds than everything else. A divisor on its
 * weight, which is why it composes with both turnover modes for free: at
 * `random` every base weight is 1 so the hook is simply drawn an eighth as
 * often, and at `even` its staleness keeps growing while it waits so it
 * climbs back toward eligibility on its own.
 *
 * That last part is the answer to "does the hook ever turn over?" -- yes,
 * and it has to, because a hook that never turns over IS the padlock and
 * the padlock already exists. The padlock is never; the hook is rarely. */
export const HOOK_HOLD_FACTOR = 8

export interface RadioPickOptions {
  /** `even` biases toward the least-recently-changed; `random` is the
   * memoryless draw that shipped 2026-09-26. Omitted behaves as `random`,
   * which is what keeps every pre-existing caller unchanged. */
  turnover?: RadioTurnover
  /** Logical turn number at which each slot last changed. NOT wall time --
   * it increments once per committed change, so it stops with the
   * transport for free, exactly like the clock. */
  changedAt?: ReadonlyMap<string, number>
  /** The current turn number. */
  turn?: number
  /** The one slot marked as the hook, held HOOK_HOLD_FACTOR times longer. */
  hookSlotId?: string | null
  random?: () => number
}

/** Which single layer turns over next.
 *
 * ONE at a time is the whole point (2026-09-26 spec 3.1). `eligible` is
 * decided by the caller through isRadioEligibleSlot; nothing here adds or
 * removes an eligibility condition, it only weights WITHIN the set.
 *
 * "Never the same one twice running" survives from the shipped version.
 * Under `even` the last-changed slot already has the lowest weight, but
 * the hard exclusion is free and removing it is a change nobody asked for.
 *
 * An UNKNOWN id counts as "just changed" (staleness 0, weight 1). That is
 * correct rather than convenient: addSlot performs a new slot's own first
 * roll, so a slot radio has never touched has in fact just changed. It
 * also means the map needs no seeding and a cold start falls back to a
 * uniform draw.
 *
 * Returns null only for an empty list, which is radio idling rather than
 * an error. Never mutates its arguments. */
export function pickRadioSlotId(
  eligible: readonly string[],
  lastChangedId: string | null,
  options: RadioPickOptions | (() => number) = {}
): string | null {
  // The shipped signature took `random` as the third argument. Accepting
  // both keeps every existing caller and test working unchanged.
  const opts: RadioPickOptions = typeof options === 'function' ? { random: options } : options
  const random = opts.random ?? Math.random
  const turnover = opts.turnover ?? 'random'
  const turn = opts.turn ?? 0
  const changedAt = opts.changedAt

  if (eligible.length === 0) return null
  const pool = eligible.length > 1 ? eligible.filter((id) => id !== lastChangedId) : eligible
  const choices = pool.length > 0 ? pool : eligible
  if (choices.length === 1) return choices[0]

  const weights = choices.map((id) => {
    // staleness + 1: a slot that just changed weighs 1, one that has
    // waited six turns weighs 7. The longer a drought runs the harder it
    // works against itself, so droughts get short without any one turn
    // ever becoming certain -- which matters, because strict round-robin
    // would be audible as a pattern, the exact failure the pace windows
    // exist to avoid.
    const base = turnover === 'even' ? Math.max(0, turn - (changedAt?.get(id) ?? turn)) + 1 : 1
    return id === opts.hookSlotId ? base / HOOK_HOLD_FACTOR : base
  })
  const total = weights.reduce((sum, w) => sum + w, 0)
  if (!(total > 0)) {
    return choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))]
  }
  let draw = random() * total
  for (let i = 0; i < choices.length; i++) {
    draw -= weights[i]
    if (draw < 0) return choices[i]
  }
  return choices[choices.length - 1]
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/shared/radioSchedule.test.ts && npm test`
Expected: PASS throughout, including every pre-existing `pickRadioSlotId` test.

- [ ] **Step 5: Commit**

```bash
git add src/shared/radioSchedule.ts src/shared/radioSchedule.test.ts
git commit -m "a layer that has waited longest is likeliest next, and the hook waits eight times over

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

---

## Task 14: Track recency in the panel

**Files:**
- Modify: `src/renderer/src/components/DiscoverPanel.tsx` — radio state block, the clock effect's
  commit branch, `armRadioPick`, `toggleRadio`

No component test — finding 15.

- [ ] **Step 1: Add the state**

Beside `radioLastSlotRef`:

```ts
  // Per-slot recency for `even` turnover. A logical turn counter, not wall
  // time, so it stops with the transport exactly as the clock does.
  //
  // PRUNED to the live slot ids on every commit, the same way
  // radioEligibleSlotIds re-reads slotsRef rather than trusting a
  // snapshot: a removed slot's entry is dropped rather than stranded, and
  // a re-added slot gets a fresh id anyway (freshSlotId), so recency can
  // never be resurrected.
  const radioChangedAtRef = useRef<Map<string, number>>(new Map())
  const radioTurnRef = useRef(0)
  // The one slot marked as the hook, or null. NOT persisted -- slot ids
  // are minted fresh each session, so a stored id would name a slot that
  // does not exist. At most one: setting it replaces.
  const [hookSlotId, setHookSlotId] = useState<string | null>(null)
  const hookSlotIdRef = useRef<string | null>(null)
  useEffect(() => {
    hookSlotIdRef.current = hookSlotId
  }, [hookSlotId])
```

- [ ] **Step 2: Record on commit**

In the deferred commit block, immediately after `radioLastSlotRef.current = pending.slotId`:

```ts
        radioTurnRef.current += 1
        radioChangedAtRef.current.set(pending.slotId, radioTurnRef.current)
        // Prune to the live ids so a removed slot cannot strand an entry.
        const liveIds = new Set(slotsRef.current.map((s) => s.id))
        for (const id of radioChangedAtRef.current.keys()) {
          if (!liveIds.has(id)) radioChangedAtRef.current.delete(id)
        }
```

- [ ] **Step 3: Use it when picking**

In `armRadioPick`, replace the `pickRadioSlotId` call:

```ts
    const slotId = pickRadioSlotId(eligible, radioLastSlotRef.current, {
      turnover: radioSettings.turnover,
      changedAt: radioChangedAtRef.current,
      turn: radioTurnRef.current,
      hookSlotId: hookSlotIdRef.current
    })
```

- [ ] **Step 4: Reset on stop**

In `toggleRadio`'s off branch, beside the other ref clears:

```ts
      radioChangedAtRef.current = new Map()
      radioTurnRef.current = 0
```

The hook is **not** cleared — it is a statement about the track, not about whether radio is
running, and clearing it would make him re-mark it every time he stops to listen.

- [ ] **Step 5: Verify and commit**

```bash
npm run typecheck && npm run lint && npm test
```

```bash
git add src/renderer/src/components/DiscoverPanel.tsx
git commit -m "radio remembers how long each layer has waited

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

---

## Task 15: The hook toggle on the row

**Files:**
- Modify: `src/renderer/src/components/DiscoverPanel.tsx:4105-4106` (the grid template), the
  column-6 spacer, the `DiscoverSlotRow` props, and the row's call site at `:3108`

**Re-read finding 19 before touching the grid.** Column 6 is the empty 14 px spacer
`<div style={{ gridColumn: 6 }} />`.

- [ ] **Step 1: Widen one track**

Change `gridTemplateColumns` from

```
'18px 18px 18px 18px 18px 14px 1fr 14px 110px 14px 16px 70px 70px 70px 70px'
```

to

```
'18px 18px 18px 18px 18px 18px 1fr 14px 110px 14px 16px 70px 70px 70px 70px'
```

— track six only, 14 px to 18 px. **No other track changes and no `gridColumn` on any child
changes**, which is what keeps the hard-won fix documented at `:4090-4104` intact.

- [ ] **Step 2: Put the toggle in the spacer**

Replace `<div style={{ gridColumn: 6 }} />` with:

```tsx
        {/* The hook -- "maybe have a way to select 'keep this one for a
            while' or .. 'this is the hook' or something" (2026-09-28).
            Lives in what used to be an empty spacer, so no other column
            moves.

            NOT the padlock next door, and the difference is one line: the
            padlock is never, the hook is rarely. A hooked layer is held
            HOOK_HOLD_FACTOR times longer but does still turn over, because
            a layer that never turns over is what the padlock is for. A
            slot can be both; the padlock wins.

            Monochrome on purpose. Colour here is spent only on things
            carrying audio information, and the padlock directly beside it
            is monochrome -- two adjacent state toggles disagreeing about
            colour is noise.

            Rendered always and hidden with `visibility` rather than
            unmounted, the same trick the radio progress rule uses, because
            a conditionally-rendered column in this grid is the exact bug
            the gridTemplateColumns comment above warns about. */}
        <button
          onClick={onToggleHook}
          data-tooltip={isHook ? 'release hook' : 'make hook'}
          aria-label={isHook ? 'release hook' : 'make hook'}
          aria-pressed={isHook}
          style={{
            gridColumn: 6,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 18,
            height: 18,
            padding: 0,
            fontFamily: 'inherit',
            fontSize: 9,
            visibility: radioOn ? 'visible' : 'hidden',
            pointerEvents: radioOn ? 'auto' : 'none',
            background: isHook ? 'var(--ra-bg-row-active)' : 'transparent',
            border: `1px solid ${isHook ? 'var(--ra-text)' : 'var(--ra-border)'}`,
            color: isHook ? 'var(--ra-text)' : 'var(--ra-text-3)',
            cursor: 'pointer'
          }}
        >
          H
        </button>
```

- [ ] **Step 3: Thread the three props**

Add to `DiscoverSlotRow`'s destructuring and its props type:

```ts
  /** Whether THIS slot is the hook -- radio holds it eight times longer
   * (HOOK_HOLD_FACTOR). At most one slot in the panel is. */
  isHook: boolean
  onToggleHook: () => void
  /** Whether radio is running; the hook toggle is only meaningful then. */
  radioOn: boolean
```

and at the call site (`:3108`, beside `onToggleLock`):

```tsx
            isHook={hookSlotId === slot.id}
            onToggleHook={() => setHookSlotId((prev) => (prev === slot.id ? null : slot.id))}
            radioOn={radioOn}
```

Setting it replaces rather than adds — a track has one hook; two hooks is two centres, which is no
centre.

- [ ] **Step 4: Drop a removed slot's hook**

Wherever `removeSlot` lives, add after its `setSlots`:

```ts
    setHookSlotId((prev) => (prev === id ? null : prev))
```

- [ ] **Step 5: Verify and commit**

```bash
npm run typecheck && npm run lint && npm test
```

```bash
git add src/renderer/src/components/DiscoverPanel.tsx
git commit -m "one layer can be the hook, and radio builds around it instead of over it

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

- [ ] **Step 6: STOP and report.** Phase D is complete. Do not start Phase E until he has heard it.

---

# PHASE E — transitions

> "maybe transitions would be the coolest new idea to focus on building"

**Everything here is one-stem.** A crossfade, a filter-out and an overlap all need the OUTGOING
stem still in the project, which collides with three renderer-side 1:1 assumptions
(`slotIndexById`'s `Map<string, number>`, `setRemoteLoop`'s positional id pairing, and the
"no unrelated `load-project` mid-transition" rule). **Those are spec §5.4 and they are a different
plan.** If a task here starts to need two stems at once, you have wandered out of scope — stop.

---

## Task 16: `radioTransition.ts` — which transition, given the temperament and the kind

**Files:**
- Modify: `src/shared/radioTransition.ts` (the Task 9 stub)
- Create: `src/shared/radioTransition.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RADIO_TRANSITIONS,
  RADIO_TRANSITIONS_OPTIONS,
  normalizeRadioTransitions,
  pickTransition
} from './radioTransition'

function seeded(values: number[]): () => number {
  let i = 0
  return (): number => values[i++ % values.length]
}

describe('transition temperament', () => {
  it('offers off, subtle and bold, defaulting to subtle', () => {
    expect(RADIO_TRANSITIONS_OPTIONS).toEqual(['off', 'subtle', 'bold'])
    expect(DEFAULT_RADIO_TRANSITIONS).toBe('subtle')
    expect(normalizeRadioTransitions('wild')).toBe('subtle')
  })

  it('is always a hard cut when off -- exactly what shipped', () => {
    expect(pickTransition('off', ['drums'], seeded([0]))).toBe('cut')
    expect(pickTransition('off', ['warm'], seeded([0.99]))).toBe('cut')
  })

  it('never blooms a drum layer, at any temperament', () => {
    for (const t of ['subtle', 'bold'] as const) {
      for (let i = 0; i < 20; i++) {
        expect(pickTransition(t, ['drums'], seeded([i / 20]))).not.toBe('bloom')
      }
    }
  })

  it('is mostly cut and hole on a drum layer at subtle', () => {
    const picks = Array.from({ length: 20 }, (_, i) =>
      pickTransition('subtle', ['drums'], seeded([i / 20]))
    )
    expect(picks.filter((p) => p === 'cut' || p === 'hole').length).toBeGreaterThan(14)
  })

  it('reaches for filter in and bloom on a pad', () => {
    const picks = new Set(
      Array.from({ length: 20 }, (_, i) => pickTransition('bold', ['warm'], seeded([i / 20])))
    )
    expect(picks.has('filter in')).toBe(true)
    expect(picks.has('bloom')).toBe(true)
  })

  it('only reaches riser and duck at bold', () => {
    const subtle = new Set(
      Array.from({ length: 40 }, (_, i) => pickTransition('subtle', ['lead'], seeded([i / 40])))
    )
    expect(subtle.has('riser')).toBe(false)
    expect(subtle.has('duck')).toBe(false)
    const bold = new Set(
      Array.from({ length: 40 }, (_, i) => pickTransition('bold', ['lead'], seeded([i / 40])))
    )
    expect(bold.has('riser') || bold.has('duck')).toBe(true)
  })

  it('falls back to cut for a kind set it has no opinion about', () => {
    expect(pickTransition('subtle', [], seeded([0.5]))).toBe('cut')
  })
})
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/shared/radioTransition.test.ts`
Expected: FAIL — `pickTransition is not a function`.

- [ ] **Step 3: Implement**

Replace the Task 9 stub's contents with the stub's four exports **plus**:

```ts
import type { DiscoverSlotKind } from './discoverSlotKind'

/** The one-stem palette. Every one of these acts on stems that are ALREADY
 * in the project after the commit, which is what keeps them clear of the
 * three 1:1 assumptions a crossfade would hit (spec 5.4). */
export type RadioTransitionKind = 'cut' | 'hole' | 'filter in' | 'bloom' | 'duck' | 'riser'

/** THE TEMPERAMENT CHOOSES THE MOOD, THE KIND CHOOSES THE WEIGHTS.
 *
 * A single fixed transition is a rhythm -- the same failure the pace
 * windows exist to avoid; it would be perverse to randomise WHEN a change
 * happens and then make HOW it happens perfectly predictable. And a
 * per-kind matrix is musically right (a drum layer cutting while a pad
 * blooms is obviously correct) but it is a grid the user has to fill in,
 * which is a lot of UI for a control that should be pressed and listened
 * to.
 *
 * So the menu picks a temperament and the changing slot's kind picks the
 * weights inside it. Per-kind musicality, zero per-kind UI, and the whole
 * table is a pure value so it can be argued with and adjusted without
 * touching a component. */
type WeightTable = Partial<Record<RadioTransitionKind, number>>

const DRUMMY: { subtle: WeightTable; bold: WeightTable } = {
  // A drum layer wants a cut or a hole. A bloom on drums is a wash.
  subtle: { cut: 0.6, hole: 0.3, 'filter in': 0.1 },
  bold: { cut: 0.35, hole: 0.35, 'filter in': 0.1, duck: 0.1, riser: 0.1 }
}

const PADDY: { subtle: WeightTable; bold: WeightTable } = {
  // A pad or a texture is where a filter sweep and a reverb bloom belong.
  subtle: { cut: 0.4, 'filter in': 0.4, bloom: 0.2 },
  bold: { cut: 0.2, 'filter in': 0.3, bloom: 0.25, duck: 0.15, riser: 0.1 }
}

const MELODIC: { subtle: WeightTable; bold: WeightTable } = {
  subtle: { cut: 0.5, hole: 0.2, 'filter in': 0.3 },
  bold: { cut: 0.3, hole: 0.15, 'filter in': 0.25, bloom: 0.1, duck: 0.1, riser: 0.1 }
}

function tableFor(
  temperament: 'subtle' | 'bold',
  kinds: readonly DiscoverSlotKind[]
): WeightTable {
  if (kinds.includes('drums')) return DRUMMY[temperament]
  if (kinds.includes('bass') || kinds.includes('lead')) return MELODIC[temperament]
  if (kinds.length > 0) return PADDY[temperament]
  return { cut: 1 }
}

/** Which transition this change gets. `off` is always `cut`, which is
 * exactly what shipped 2026-09-26. */
export function pickTransition(
  temperament: RadioTransitions,
  kinds: readonly DiscoverSlotKind[],
  random: () => number = Math.random
): RadioTransitionKind {
  if (temperament === 'off') return 'cut'
  const table = tableFor(temperament, kinds)
  const entries = Object.entries(table) as [RadioTransitionKind, number][]
  const total = entries.reduce((sum, [, w]) => sum + w, 0)
  if (!(total > 0)) return 'cut'
  let draw = random() * total
  for (const [kind, weight] of entries) {
    draw -= weight
    if (draw < 0) return kind
  }
  return 'cut'
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/shared/radioTransition.test.ts`
Expected: PASS. If the `mostly cut and hole` assertion fails, the weights are the thing to adjust,
not the test — it encodes the design.

- [ ] **Step 5: Commit**

```bash
git add src/shared/radioTransition.ts src/shared/radioTransition.test.ts
git commit -m "a drum layer cuts and a pad blooms, without a grid to fill in

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

---

## Task 17: The transition curves

**Files:**
- Modify: `src/shared/radioTransition.ts` (append)
- Modify: `src/shared/radioTransition.test.ts`

Same anchor rule as Task 7 and the same reason. **Every curve is loop-relative and therefore
anchored to the loop top.**

- [ ] **Step 1: Write the failing tests**

```ts
describe('transition curves', () => {
  it('filter in opens from closed at the loop top', () => {
    const c = buildFilterInCurve(8, 1)
    expect(c[0]).toEqual({ bar: 0, value: 0 })
    expect(c[c.length - 1]).toEqual({ bar: 1, value: 1 })
  })

  it('bloom starts drenched and dries out', () => {
    const c = buildBloomCurve(8, 2)
    expect(c[0]).toEqual({ bar: 0, value: 0.7 })
    expect(c[c.length - 1]).toEqual({ bar: 2, value: 0 })
  })

  it('duck dips the other layers and recovers', () => {
    const c = buildDuckCurve(8, 1)
    expect(c[0]).toEqual({ bar: 0, value: 0.45 })
    expect(c[c.length - 1]).toEqual({ bar: 1, value: 1 })
  })

  it('clamps every curve to half the loop, so none runs into its own anchor', () => {
    expect(buildFilterInCurve(1, 4)[1].bar).toBe(0.5)
    expect(buildBloomCurve(1, 4)[1].bar).toBe(0.5)
    expect(buildDuckCurve(1, 4)[1].bar).toBe(0.5)
  })

  it('returns nothing for a loop it cannot place a gesture in', () => {
    expect(buildFilterInCurve(0, 1)).toEqual([])
    expect(buildBloomCurve(8, 0)).toEqual([])
    expect(buildDuckCurve(-1, 1)).toEqual([])
  })

  it('builds a riser that ENDS at the loop top it announces', () => {
    const r = buildTransitionRiser('chan-1', 8, 2)
    expect(r).not.toBeNull()
    expect(r!.startBar).toBe(6)
    expect(r!.lengthBars).toBe(2)
    expect(r!.endCutoffValue).toBeGreaterThan(r!.startCutoffValue)
    expect(r!.channelId).toBe('chan-1')
  })

  it('will not build a riser longer than half the loop', () => {
    expect(buildTransitionRiser('c', 2, 4)!.lengthBars).toBe(1)
  })
})
```

- [ ] **Step 2: Run and watch it fail.** Run: `npx vitest run src/shared/radioTransition.test.ts`
Expected: FAIL — `buildFilterInCurve is not a function`.

- [ ] **Step 3: Implement.** Append to `src/shared/radioTransition.ts`:

```ts
import type { AutomationPoint } from './toolkit'
import type { RiserClip } from './riser'

/** No gesture may run into the wrap it is anchored to. The same rule, for
 * the same reason, that FadeGain.cpp:33-51 already applies to clip fades. */
function clampToHalfLoop(loopBars: number, bars: number): number {
  return Math.min(bars, loopBars / 2)
}

/** The new layer sweeps open from closed over `bars`, starting at the loop
 * top. Values are normalised cutoffs; buildStemToolkit defaults an
 * un-set filter to lowpass, so a bare filterCutoff curve is a lowpass
 * sweep with no other field needed.
 *
 * This is the recommended flagship. It is the app's own signature move, it
 * is usually more musical than a fade, and it needs exactly one curve on
 * one stem that is already in the project. */
export function buildFilterInCurve(loopBars: number, bars: number): AutomationPoint[] {
  if (!(loopBars > 0) || !(bars > 0)) return []
  return [
    { bar: 0, value: 0 },
    { bar: clampToHalfLoop(loopBars, bars), value: 1 }
  ]
}

/** How wet the incoming layer arrives. 0.7 rather than 1 because a send at
 * full is a wash rather than a bloom. */
const BLOOM_SEND = 0.7

/** The new layer arrives drenched and dries out. */
export function buildBloomCurve(loopBars: number, bars: number): AutomationPoint[] {
  if (!(loopBars > 0) || !(bars > 0)) return []
  return [
    { bar: 0, value: BLOOM_SEND },
    { bar: clampToHalfLoop(loopBars, bars), value: 0 }
  ]
}

/** How far the OTHER layers dip so the new one lands in space. About 7dB. */
const DUCK_FLOOR = 0.45

/** Applied to every audible slot EXCEPT the changing one. */
export function buildDuckCurve(loopBars: number, bars: number): AutomationPoint[] {
  if (!(loopBars > 0) || !(bars > 0)) return []
  return [
    { bar: 0, value: DUCK_FLOOR },
    { bar: clampToHalfLoop(loopBars, bars), value: 1 }
  ]
}

/** A noise sweep INTO the change: it ends exactly at the loop top it
 * announces, so it is placed at loopBars - lengthBars.
 *
 * Generated live by the engine (NoiseRiser.cpp, straight into the
 * channel's bus) -- there is no file, no render and no cache. Risers are
 * rendered audio only on EXPORT.
 *
 * Unlike the stem curves this is NOT clip-relative: EngineRiser has no
 * originBar, so startBar is already the loop-relative bar the engine
 * subtracts directly. `id` is stable per channel so a re-sync of the same
 * armed riser does not produce two. */
export function buildTransitionRiser(
  channelId: string,
  loopBars: number,
  bars: number
): RiserClip | null {
  if (!(loopBars > 0) || !(bars > 0)) return null
  const lengthBars = clampToHalfLoop(loopBars, bars)
  return {
    id: `radio-riser-${channelId}`,
    channelId,
    startBar: loopBars - lengthBars,
    lengthBars,
    startCutoffValue: 0.2,
    endCutoffValue: 0.95,
    curve: [],
    level: 0.35
  }
}
```

Check `RiserClip`'s real field list in `src/shared/riser.ts` before writing this — it also carries
`name` and `muted` in some call sites. Add whatever the type requires; `name` should be
`'radio'` and `muted` `false`.

- [ ] **Step 4: Run the tests.** `npx vitest run src/shared/radioTransition.test.ts && npm test`
Expected: PASS, 200 test files.

- [ ] **Step 5: Commit**

```bash
git add src/shared/radioTransition.ts src/shared/radioTransition.test.ts
git commit -m "what a sweep, a bloom, a duck and a riser look like as plain data

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

---

## Task 18: Arm and clear a transition

**Files:**
- Modify: `src/renderer/src/components/DiscoverPanel.tsx` — the radio state block, the clock
  effect, `syncPreviewToEngine`

This generalises the Task 8 machinery. No component test — finding 15.

- [ ] **Step 1: Generalise the armed-gesture ref**

Replace `radioDropOutRef` / `radioDropOutBeatsRef` with one ref covering both:

```ts
  // The armed gesture -- a drop-out (no stem change) or a transition
  // (attached to one). Both are the same thing to the engine: curves in
  // previewState, armed a lap early and cleared a lap later. Elling,
  // 2026-09-28: "also make sure to transition on the proper beat... that's
  // key" / "not just the downbeat, the proper start of the loop, i think".
  //
  // A curve is clip-relative and the transport wraps at loopLengthBars, so
  // it can ONLY be anchored to the top of the loop. The constraint is the
  // requirement, and it is why nothing here reads the clock at the moment
  // the gesture fires.
  const radioGestureRef = useRef<{
    kind: 'drop-out' | RadioTransitionKind
    slotId: string
    beats: number
    lapsLeft: number
  } | null>(null)
```

Update Task 8's arm site to write `{ kind: 'drop-out', slotId: dropId, beats: pickDropOutBeats(), lapsLeft: 1 }`
and its clear branch to read `radioGestureRef`.

- [ ] **Step 2: Arm a transition on commit**

In the deferred commit block, immediately after `commitSlotPick(pending.slotId, pending.pick)`:

```ts
        // The transition rides the change it decorates. `cut` arms
        // nothing, which is what keeps the project byte-identical to
        // pre-2026-09-28 whenever transitions are off.
        const changing = slotsRef.current.find((s) => s.id === pending.slotId)
        const transition = pickTransition(radioSettings.transitions, changing?.kinds ?? [])
        if (transition !== 'cut') {
          radioGestureRef.current = {
            kind: transition,
            slotId: pending.slotId,
            beats: 4,
            lapsLeft: 1
          }
        }
```

- [ ] **Step 3: Write the curves in `syncPreviewToEngine`**

Extend the Task 8 block to switch on the gesture kind. All four write into the same
`stemAutomation` record; `riser` writes `risers` instead:

```ts
    const stemAutomation: Record<string, StemAutomation> = {}
    const risers: Record<string, RiserClip> = {}
    const gesture = radioGestureRef.current
    if (gesture && maxBarLength > 0) {
      const indexOf = (id: string): number => members.findIndex((m) => m.id === id) + 1
      const own = indexOf(gesture.slotId)
      const bars = gesture.beats / 4
      if (gesture.kind === 'drop-out' && own > 0) {
        const curve = buildDropOutCurve(maxBarLength, gesture.beats)
        if (curve.length > 0) stemAutomation[stemKey(groupId, own)] = { volume: curve }
      } else if (gesture.kind === 'hole' && own > 0) {
        // The hole is the drop-out attached to a change: same curve, and
        // the new stem lands in the space it leaves.
        const curve = buildDropOutCurve(maxBarLength, gesture.beats)
        if (curve.length > 0) stemAutomation[stemKey(groupId, own)] = { volume: curve }
      } else if (gesture.kind === 'filter in' && own > 0) {
        const curve = buildFilterInCurve(maxBarLength, bars)
        if (curve.length > 0) stemAutomation[stemKey(groupId, own)] = { filterCutoff: curve }
      } else if (gesture.kind === 'bloom' && own > 0) {
        const curve = buildBloomCurve(maxBarLength, bars)
        if (curve.length > 0) stemAutomation[stemKey(groupId, own)] = { reverbSend: curve }
      } else if (gesture.kind === 'duck') {
        // Every OTHER audible layer dips, so the new one lands in space.
        const curve = buildDuckCurve(maxBarLength, bars)
        if (curve.length > 0) {
          members.forEach((m, i) => {
            if (m.id !== gesture.slotId) stemAutomation[stemKey(groupId, i + 1)] = { volume: curve }
          })
        }
      } else if (gesture.kind === 'riser') {
        const riser = buildTransitionRiser(groupId, maxBarLength, bars)
        if (riser) risers[riser.id] = riser
      }
    }
```

and add both `stemAutomation` and `risers` to the `previewState` literal.

**`isStemToolkitNeutral` drops the whole `toolkit` key when nothing is drawn and
`buildEngineRisers({})` emits an empty array, so an unarmed sync is byte-identical to what
shipped before this feature.** That is the regression-safety property of the whole phase — do not
let a refactor lose it.

- [ ] **Step 4: Verify**

```bash
npm run typecheck && npm run lint && npm test
```

Expected: 0 errors, 4 baseline warnings, suite green.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/DiscoverPanel.tsx
git commit -m "a layer can sweep in, bloom or rise into the loop instead of just appearing

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016ERhqomCvGmAzs5Uncec3h"
```

- [ ] **Step 6: Final verification and report**

```bash
npm test && npm run typecheck && npm run lint
git log --oneline -20
```

Report to Elling: the pace now means what it says, a drum layer drops out for a couple of beats
every couple of minutes and returns exactly as the loop restarts, every control is behind the
radio button, no layer sits untouched for five minutes any more, one layer can be marked as the
hook, and a change can sweep, bloom, duck or rise into the loop instead of simply appearing.

**State plainly that none of it was heard.** This environment has no GUI or audio tooling. The
*timing* claims rest on `radioDropOut.test.ts` and `radioTransition.test.ts` asserting the exact
curves the engine performs — not on anyone listening. What still needs his ears: whether `subtle`
is subtle enough, whether `rare` is rare enough, and whether `own loop` is the right default grid.

Phases F (reach), G (character + `more like this`) and H (two-stem transitions, pre-rendered
one-shots) are designed in the spec and each needs its own plan.
