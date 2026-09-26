# Radio mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `radio` toggle in Discover that, while the preview loop plays, rerolls one unlocked layer at a time at a loosely-random interval, committing each change on a loop boundary.

**Architecture:** Radio is **Discover plus a scheduler plus a pin flag, and the pin flag already exists** (`slot.locked`). One new pure module, `src/shared/radioSchedule.ts`, holds everything testable: the three paces, the interval draw, a bar clock fed by the engine's existing 30 Hz `position-update` stream (already in `DiscoverPanel` as `usePos()`), and the "which slot changes next" choice. `DiscoverPanel.tsx` gains a small refactor — `rollForSlot` is split into `pickForSlot` (fetch, rank, pick) and the `setSlots` commit — so radio can pick a candidate a whole interval early, pre-warm the existing module-level `resolvedCandidateCache`, and then commit instantly at the next loop wrap. No second implementation of rolling, no new panel, no new engine surface.

**Tech Stack:** TypeScript, React 19, Electron renderer + main, vitest.

**Spec:** `docs/superpowers/specs/2026-09-26-radio-mode-design.md` (2026-09-26). Its "not now" list (§5) is the scope boundary — **if something is not named as in, it is out.**

**Elling's brief, verbatim:** *"what about a radio mode --- kind of like discovery, layers and layers of stems from the library, play them for x bars .. something kinda like that"*

**NO NATIVE-ENGINE CHANGES.** Nothing in this plan reaches `native-engine/`. The engine already pushes `position-update` in bars at 30 Hz and already wraps its own clock against the loaded project's `loopLengthBars`. `EngineProject` / `buildEngineProject.ts` are a hand-synced pair (CLAUDE.md) and **this plan changes neither.** If you conclude a native-engine change is needed, **STOP and report it rather than planning one.**

**Baseline (verified on `master`, 2026-09-26, commit `0e67434`):**

```
Test Files  190 passed (190)
     Tests  2872 passed (2872)
```

**`src/main/remoteServer.test.ts` (10 tests) is FLAKY in the full parallel run and green in isolation** — it binds a real HTTP port, and a colliding worker takes the whole file down (verified twice on a clean `master` at `0e67434`: one run reported `2 failed | 187 passed (189)` / `13 failed | 2851 passed (2864)`, the next reported the clean numbers above). If the full suite reports failures only in that file, re-run it alone (`npx vitest run src/main/remoteServer.test.ts`) and treat a clean isolated run as green. **No other file may fail.** Every test you add must pass in both the full run and in isolation.

---

## Findings that shaped this plan — read these before Task 1

1. **Pinning already exists and is called `locked`.** `DiscoverSlot.locked` (`src/renderer/src/components/DiscoverPanel.tsx:154-215`), toggled by `toggleLock` (`:1653`), with a padlock button per row (`:3661`, `data-tooltip={slot.locked ? 'unlock' : 'lock'}`). `rerollAll` already skips locked slots (`:1946`). **Radio adds no pinning UI. Do not add a "pin" button.**

2. **`pos` is the preview loop's position, in bars, already in this component.** `const pos = usePos()` at `DiscoverPanel.tsx:396`. While Discover owns the engine, `StoreContext.tsx:969-973` writes the engine's own already-wrapped bar position verbatim into `state.pos`. The engine wraps it in-thread against `loopLengthBars` (`Transport.cpp:345,384`), which for a Discover preview equals the preview rifff's `barLength`. DiscoverPanel already re-renders at 30 Hz because of this — **radio's clock costs no extra renders.**

3. **The loop length in bars is `maxBarLength`.** Computed twice already, from the same source: `Math.max(...resolvedBarLengthsRef.current.values())` in `syncPreviewToEngine` (`:812-815`) and `Math.max(...resolvedBarLengths.values())` for the playhead (`:2609-2610`). Over **all resolved slots**, not just audible ones, deliberately (`:786-800`). Reuse it; do not compute a third one differently.

4. **There is no bar event and no loop-wrap event.** A wrap is observable only as `pos` decreasing between two ticks. And **`pos` only ticks while playing** (`IpcServer.cpp` stops the 33 ms timer on `"pause"`), so radio's clock stops with the transport for free. Do not add a `setInterval`.

5. **Swapping a layer does not restart the loop.** `syncPreviewToEngine`'s seek-to-zero-and-play is gated behind `if (!previewLoadedRef.current)` (`:887-892`); every later rebuild hot-swaps the project under a running transport. And `reportSlotResolution`'s null branch (`:1002-1026`) is a **deliberate no-op** so a slot keeps playing its last resolved stem through a reroll window. Both are load-bearing for radio. **Do not "clean up" either.**

6. **`resolveCandidateStem` is module-level and memoised.** `resolvedCandidateCache` (`:95`) is a `Map<string, Promise<ResolvedCandidateStem | null>>` keyed `` `${candidate.riffCID}:${candidate.stemCID}` ``. Calling `resolveCandidateStem(candidate)` and discarding the promise **pre-warms it**. A `null` result deletes its own cache entry (`:144-146`), so a failed prefetch self-heals.

7. **Radio must NOT call `rerollSlot`.** `rerollSlot` (`:1834`) calls `pushUndoSnapshot()`. Radio firing every 20 bars would flood the undo stack. `rerollAll` already sets the precedent of bypassing it (`:1914-1917`, "calls `rollForSlot` directly below (not the public `rerollSlot` wrapper, which pushes its OWN snapshot per slot)"). **Radio changes are not undoable. That is the design (spec §3.4), not an oversight.**

8. **Tempo needs nothing new.** There is no `targetBpm` state; `rankCandidates({ targetBpm: bpm })` is passed `state.bpm` (`:1747`), the preview sets `stretch: { [groupId]: true }` (`:848`), and `seedBpm`'s auto-`SET_TEMPO` is gated on `!previewLoadedRef.current` (`:762`) so it can never fire while radio runs. **Add no tempo logic.**

9. **`rollForSlot` bumps `rerollGenerationRef` and `setRolledCount`.** Both must survive the Task 6 split exactly: `rerollGenerationRef` (`:1097`) is the stale-response guard shared with `rollRandomForSlot`, and `setRolledCount` feeds the phone page's counter. The generation claim happens **before the first `await`** — keep it there.

10. **`updateDiscoverSettings` merges.** `App.tsx:1673-1677` spreads `discoverSettings` then the patch, because "saving a partial object used to be fine with one field, but would silently wipe `traitMatchBar`". Adding a third field is safe *through that function*; do not call `setDiscoverSettings` directly from anywhere else.

11. **`discoverSettingsStore.ts` is a plain JSON file**, not SQLite (`readFileSync`/`writeFileSync` against `app.getPath('userData')`). Its test mocks only `app.getPath`. **No `vitest.config.ts` CI-exclusion change is needed by this plan, and none may be made.** (The 28-file exclusion list exists because better-sqlite3 crashes vitest workers on GitHub's macOS runners — a new SQLite-opening main-process test file would block the next release. This plan opens no database.)

12. **Its existing test file asserts whole objects.** `src/main/discoverSettingsStore.test.ts` has four `toEqual({ consentedToLibraryScan, traitMatchBar })` assertions (lines 24, 30, 39) and three `saveDiscoverSettings({ ... })` calls (lines 29, 35, 44, 46) that construct a full `DiscoverSettings`. **Adding a field breaks all of them** — Task 4 updates every one.

13. **React components are NOT unit-tested in this codebase** (CLAUDE.md). Tasks 5, 6, 7, 8 and 9 have **no component tests**, deliberately. They are verified by `npm run typecheck` + `npm run lint` + the full suite staying green, then by Elling's manual walkthrough. **This environment has no GUI or audio tooling — do not claim radio was heard, do not claim a button was clicked, do not claim a timing was observed.**

14. **Design tokens are the law** (`src/renderer/src/styles/tokens.css`): near-black monochrome, Silkscreen, **no `border-radius` anywhere**, lowercase copy, **no emoji, no exclamation marks**, colour only on things carrying audio information. **Tooltips are two or three words. Buttons are two words maximum, or an icon.** Tooltips are one `data-tooltip="…"` attribute, never alongside `title` on the same node.

15. **Lint rules that will bite.** This repo **errors** on a synchronous `setState` inside a React effect (`react-hooks/set-state-in-effect`; the established workaround is deferring through `void Promise.resolve().then(...)`), on render-time impurity (`react-hooks/purity` — **no `Math.random()`, `Date.now()` or `performance.now()` inside a component-scoped function**, which is why `freshSlotId` and `pickRandomKind` live at module scope, `:1755-1757`), and requires an **explicit return type on every function**, inline ones included. Prettier: `singleQuote: true`, `semi: false`, `printWidth: 100`, `trailingComma: none`.

16. **Randomness lives in `src/shared/`, injected.** Every new pure function that needs randomness takes a `random: () => number` parameter defaulting to `Math.random` — that is what makes it testable, and it keeps `Math.random()` out of the component (finding 15). `pickReroll` (`src/shared/discoverRanking.ts`) uses bare `Math.random()` because it is already in `src/shared/`; the new module does better because its tests need determinism.

## Known limits, accepted on purpose (do not "fix" these)

- **A long loop at a fast pace is metronomic.** The commit quantises up to the next loop wrap, so an 8-bar loop at `fast` (6–12 bars) always fires at 8. Spec §2.2.
- **The commit lands tens of milliseconds after the downbeat** — a React render, an rAF, `buildEngineProject`, one `engineLoadProject` round trip. Sample accuracy would need engine-side scheduling, which is out. Spec §2.3.
- **The next pick is decided a whole interval early**, so `rollForSlot`'s dedupe-against-other-slots pass is stale by up to that long. It is already documented as "a variety heuristic, not a correctness guarantee" (`:1725-1733`).
- **Radio idles rather than stopping** when nothing is eligible (everything locked or muted). The clock runs, the commit is a no-op, it retries next boundary.
- **A radio change is not undoable.** Finding 7.

## File map

| File | Change |
|---|---|
| `src/shared/radioSchedule.ts` | **NEW** — `RadioPace`, `RADIO_PACE_OPTIONS`, `DEFAULT_RADIO_PACE`, `RADIO_PACE_BARS`, `normalizeRadioPace`, `nextRadioIntervalBars`, `RadioClock`, `createRadioClock`, `advanceRadioClock`, `pickRadioSlotId` |
| `src/shared/radioSchedule.test.ts` | **NEW** — full TDD |
| `src/main/discoverSettingsStore.ts` | `DiscoverSettings` gains `radioPace`; default + normalize |
| `src/main/discoverSettingsStore.test.ts` | existing assertions updated + one new case (**not** CI-excluded, and must not be added to the list) |
| `src/renderer/src/App.tsx` | initial `discoverSettings` literal gains `radioPace`; new `setRadioPace`; two props threaded |
| `src/renderer/src/components/LibraryBrowser.tsx` | passes `radioPace` / `onRadioPaceChange` straight through to `DiscoverPanel` |
| `src/renderer/src/components/DiscoverPanel.tsx` | `pickForSlot` extraction; radio state, clock effect, prefetch + commit; the button, the chips, the progress rule; the starter bed |

**Nothing else is touched. No file is deleted. `vitest.config.ts` is NOT edited.**

## Commands (run from `/Users/nickel/Claudecode/sssketch`)

```bash
npx vitest run src/shared/radioSchedule.test.ts     # one file
npm test                                            # full suite
npm run typecheck
npm run lint
```

---

## Task 1: The paces

**Files:**
- Create: `src/shared/radioSchedule.ts`
- Create: `src/shared/radioSchedule.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/shared/radioSchedule.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RADIO_PACE,
  RADIO_PACE_BARS,
  RADIO_PACE_OPTIONS,
  nextRadioIntervalBars,
  normalizeRadioPace
} from './radioSchedule'

describe('radio paces', () => {
  it('offers exactly slow, mid and fast, in that order', () => {
    expect(RADIO_PACE_OPTIONS).toEqual(['slow', 'mid', 'fast'])
  })

  it('defaults to mid', () => {
    expect(DEFAULT_RADIO_PACE).toBe('mid')
  })

  it('gives every pace a 2:1 bar window', () => {
    for (const pace of RADIO_PACE_OPTIONS) {
      const { min, max } = RADIO_PACE_BARS[pace]
      expect(max).toBe(min * 2)
    }
  })

  it('orders the paces slowest to fastest', () => {
    expect(RADIO_PACE_BARS.slow.min).toBeGreaterThan(RADIO_PACE_BARS.mid.min)
    expect(RADIO_PACE_BARS.mid.min).toBeGreaterThan(RADIO_PACE_BARS.fast.min)
  })

  it('normalizes an unknown value to the default', () => {
    expect(normalizeRadioPace('glacial')).toBe('mid')
    expect(normalizeRadioPace(undefined)).toBe('mid')
    expect(normalizeRadioPace(7)).toBe('mid')
    expect(normalizeRadioPace(null)).toBe('mid')
  })

  it('passes a known pace through untouched', () => {
    expect(normalizeRadioPace('fast')).toBe('fast')
    expect(normalizeRadioPace('slow')).toBe('slow')
  })
})

describe('nextRadioIntervalBars', () => {
  it('returns the window minimum when random() is 0', () => {
    expect(nextRadioIntervalBars('mid', () => 0)).toBe(12)
  })

  it('returns the window maximum when random() is just under 1', () => {
    expect(nextRadioIntervalBars('mid', () => 0.9999)).toBe(24)
  })

  it('returns a whole number of bars inside the window, for every pace', () => {
    for (const pace of RADIO_PACE_OPTIONS) {
      const { min, max } = RADIO_PACE_BARS[pace]
      for (const r of [0, 0.1, 0.25, 0.5, 0.75, 0.9999]) {
        const bars = nextRadioIntervalBars(pace, () => r)
        expect(Number.isInteger(bars)).toBe(true)
        expect(bars).toBeGreaterThanOrEqual(min)
        expect(bars).toBeLessThanOrEqual(max)
      }
    }
  })

  it('actually varies across the window rather than returning one value', () => {
    const seen = new Set<number>()
    for (let i = 0; i < 13; i++) seen.add(nextRadioIntervalBars('mid', () => i / 13))
    expect(seen.size).toBeGreaterThan(5)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/shared/radioSchedule.test.ts`
Expected: FAIL — `Failed to resolve import "./radioSchedule"`.

- [ ] **Step 3: Write the implementation**

Create `src/shared/radioSchedule.ts`:

```ts
// src/shared/radioSchedule.ts
//
// Radio mode's whole schedule -- docs/superpowers/specs/2026-09-26-radio-
// mode-design.md. Radio is Discover with a clock: every so often one
// unlocked layer rerolls on its own. Everything here is pure and injected
// with its own randomness, both so it can be tested deterministically and
// because this codebase's react-hooks/purity lint rule rejects a bare
// Math.random() inside a component-scoped function (see DiscoverPanel's
// own freshSlotId/pickRandomKind, which live at module scope for the same
// reason).

/** The three speeds radio can run at. Literal values double as their own
 * UI text (the same convention DISCOVER_SLOT_KIND_OPTIONS uses for its
 * non-camelCase kinds), so there is no label table. */
export type RadioPace = 'slow' | 'mid' | 'fast'

export const RADIO_PACE_OPTIONS: RadioPace[] = ['slow', 'mid', 'fast']

export const DEFAULT_RADIO_PACE: RadioPace = 'mid'

/** Each pace is a WINDOW of bars, not a number. Exactly every N bars reads
 * as mechanical; a change landing somewhere in a range feels like
 * something is making decisions (spec 3.3).
 *
 * The 2:1 ratio is the decision; the absolute numbers are taste. 2:1 is
 * wide enough that you cannot count along with it and narrow enough that
 * it never feels stalled at the top or frantic at the bottom. A 4:1 range
 * would give a change at 6 bars and then nothing for 24, which reads as
 * broken rather than loose.
 *
 * At 120bpm in 4/4 (2s a bar): slow = 48-96s, mid = 24-48s, fast =
 * 12-24s. */
export const RADIO_PACE_BARS: Record<RadioPace, { min: number; max: number }> = {
  slow: { min: 24, max: 48 },
  mid: { min: 12, max: 24 },
  fast: { min: 6, max: 12 }
}

/** Anything unrecognised (an older settings file, a hand-edited JSON)
 * becomes the default rather than throwing -- same shape as
 * normalizeTraitMatchBar (traitBar.ts). */
export function normalizeRadioPace(value: unknown): RadioPace {
  return RADIO_PACE_OPTIONS.includes(value as RadioPace) ? (value as RadioPace) : DEFAULT_RADIO_PACE
}

/** A fresh whole number of bars to wait, drawn uniformly across the pace's
 * own window (both ends inclusive). Drawn again after every change, which
 * is what stops radio being a metronome. */
export function nextRadioIntervalBars(
  pace: RadioPace,
  random: () => number = Math.random
): number {
  const { min, max } = RADIO_PACE_BARS[pace]
  const span = max - min + 1
  const offset = Math.min(span - 1, Math.floor(random() * span))
  return min + offset
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/shared/radioSchedule.test.ts`
Expected: PASS — 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/shared/radioSchedule.ts src/shared/radioSchedule.test.ts
git commit -m "Three speeds, each a window rather than a number"
```

---

## Task 2: The bar clock

The clock is fed by the engine's existing 30 Hz `position-update` stream and nothing else. It accumulates elapsed bars across loop wraps, and it says "due" **only at a wrap** — that is what quantises a change to the loop boundary rather than dropping it mid-phrase (spec §2.2).

**Files:**
- Modify: `src/shared/radioSchedule.ts`
- Test: `src/shared/radioSchedule.test.ts`

- [ ] **Step 1: Write the failing tests**

Add these imports to the top of `src/shared/radioSchedule.test.ts`, merging into the existing import block:

```ts
import {
  DEFAULT_RADIO_PACE,
  RADIO_PACE_BARS,
  RADIO_PACE_OPTIONS,
  advanceRadioClock,
  createRadioClock,
  nextRadioIntervalBars,
  normalizeRadioPace
} from './radioSchedule'
```

Then append this `describe` block to the same file:

```ts
describe('advanceRadioClock', () => {
  it('starts with no elapsed bars and the interval it was given', () => {
    const clock = createRadioClock(16)
    expect(clock.barsElapsed).toBe(0)
    expect(clock.intervalBars).toBe(16)
    expect(clock.lastPos).toBe(0)
  })

  it('accumulates forward motion inside one loop pass', () => {
    let clock = createRadioClock(16)
    clock = advanceRadioClock(clock, 1, 4).clock
    clock = advanceRadioClock(clock, 2.5, 4).clock
    expect(clock.barsElapsed).toBeCloseTo(2.5)
    expect(clock.lastPos).toBe(2.5)
  })

  it('counts the bars across a loop wrap without losing the tail', () => {
    let clock = createRadioClock(16)
    clock = advanceRadioClock(clock, 3.9, 4).clock
    // wrapped: 0.1 bars left in the old pass, plus 0.2 into the new one
    const step = advanceRadioClock(clock, 0.2, 4)
    expect(step.wrapped).toBe(true)
    expect(step.clock.barsElapsed).toBeCloseTo(4.2)
  })

  it('is not due before the interval has elapsed, even at a wrap', () => {
    let clock = createRadioClock(16)
    clock = advanceRadioClock(clock, 3.9, 4).clock
    const step = advanceRadioClock(clock, 0.0, 4)
    expect(step.wrapped).toBe(true)
    expect(step.due).toBe(false)
  })

  it('is not due past the interval when it is mid-loop', () => {
    let clock = createRadioClock(4)
    clock = advanceRadioClock(clock, 3.9, 4).clock
    clock = advanceRadioClock(clock, 0.0, 4).clock // wrap, 4 bars elapsed but interval is 4
    const step = advanceRadioClock(clock, 2, 4)
    expect(step.clock.barsElapsed).toBeCloseTo(6)
    expect(step.wrapped).toBe(false)
    expect(step.due).toBe(false)
  })

  it('is due at the first wrap at or after the interval', () => {
    let clock = createRadioClock(6)
    // one full 4-bar pass
    clock = advanceRadioClock(clock, 3.9, 4).clock
    expect(advanceRadioClock(clock, 0.0, 4).due).toBe(false) // 4 elapsed, interval 6
    clock = advanceRadioClock(clock, 0.0, 4).clock
    clock = advanceRadioClock(clock, 3.9, 4).clock // 7.9 elapsed
    const step = advanceRadioClock(clock, 0.0, 4)
    expect(step.wrapped).toBe(true)
    expect(step.due).toBe(true)
  })

  it('effectively rounds the interval up to a whole number of loops', () => {
    // interval 6, loop 4 -> fires at 8
    let clock = createRadioClock(6)
    let firedAt: number | null = null
    let pos = 0
    for (let tick = 0; tick < 400 && firedAt === null; tick++) {
      pos = (pos + 0.05) % 4
      const step = advanceRadioClock(clock, pos, 4)
      clock = step.clock
      if (step.due) firedAt = step.clock.barsElapsed
    }
    expect(firedAt).not.toBeNull()
    expect(firedAt as number).toBeCloseTo(8, 1)
  })

  it('resets elapsed bars and takes a fresh interval on restart', () => {
    let clock = createRadioClock(4)
    clock = advanceRadioClock(clock, 2.5, 4).clock
    const restarted = createRadioClock(20, clock.lastPos)
    expect(restarted.barsElapsed).toBe(0)
    expect(restarted.intervalBars).toBe(20)
    expect(restarted.lastPos).toBe(2.5)
  })

  it('treats a non-positive loop length as no motion rather than dividing by it', () => {
    const clock = createRadioClock(8)
    const step = advanceRadioClock(clock, 2, 0)
    expect(step.clock.barsElapsed).toBe(0)
    expect(step.due).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/shared/radioSchedule.test.ts`
Expected: FAIL — `advanceRadioClock is not exported` / `createRadioClock is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `src/shared/radioSchedule.ts`:

```ts
/** Radio's own sense of time. Fed ONLY by the engine's existing ~30Hz
 * position-update stream (IpcServer.cpp's 33ms kPositionTimerId ->
 * main's subscribeToPositionUpdates -> preload's onEnginePositionUpdate ->
 * StoreContext's SET_POS -> DiscoverPanel's usePos()). There is no
 * setInterval anywhere in radio, on purpose: the engine stops its timer on
 * "pause", so this clock stops with the transport and resumes exactly
 * where it was, for free. */
export interface RadioClock {
  /** Bars of real playback since the last change landed. Fractional. */
  barsElapsed: number
  /** The freshly-drawn target for THIS interval (nextRadioIntervalBars). */
  intervalBars: number
  /** The previous tick's position, so a wrap can be spotted as a decrease
   * -- the engine emits no loop-wrap event of any kind. */
  lastPos: number
}

export function createRadioClock(intervalBars: number, startPos = 0): RadioClock {
  return { barsElapsed: 0, intervalBars, lastPos: startPos }
}

export interface RadioClockStep {
  clock: RadioClock
  /** The loop restarted between the previous tick and this one. */
  wrapped: boolean
  /** Commit a change NOW: the interval has elapsed AND we are at a loop
   * boundary. Quantising to the wrap is deliberate (spec 2.2) -- a change
   * dropped at bar 7 of an 8-bar loop is a splice; a change dropped at the
   * wrap is a new section. The cost is that the effective interval is
   * ceil(intervalBars / loopBars) * loopBars, which for a long loop and a
   * short pace can collapse the pace's whole window onto one value. */
  due: boolean
}

/** One position tick. `loopBars` is the preview loop's own length --
 * DiscoverPanel's `maxBarLength`, which is exactly what went to the engine
 * as loopLengthBars, so the wrap this spots and the wrap the engine
 * performed are the same event. */
export function advanceRadioClock(
  clock: RadioClock,
  pos: number,
  loopBars: number
): RadioClockStep {
  if (!(loopBars > 0) || !Number.isFinite(pos)) {
    return { clock, wrapped: false, due: false }
  }
  const wrapped = pos < clock.lastPos
  // Across a wrap, count the tail of the old pass as well as the head of
  // the new one -- otherwise every wrap silently loses up to a full bar.
  const delta = wrapped ? loopBars - clock.lastPos + pos : pos - clock.lastPos
  const barsElapsed = clock.barsElapsed + Math.max(0, delta)
  return {
    clock: { ...clock, barsElapsed, lastPos: pos },
    wrapped,
    due: wrapped && barsElapsed >= clock.intervalBars
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/shared/radioSchedule.test.ts`
Expected: PASS — 19 tests.

- [ ] **Step 5: Commit**

```bash
git add src/shared/radioSchedule.ts src/shared/radioSchedule.test.ts
git commit -m "A clock that only strikes on the downbeat of the loop"
```

---

## Task 3: Which layer changes next

**Files:**
- Modify: `src/shared/radioSchedule.ts`
- Test: `src/shared/radioSchedule.test.ts`

- [ ] **Step 1: Write the failing tests**

Add `pickRadioSlotId` to the import block at the top of `src/shared/radioSchedule.test.ts`, then append:

```ts
describe('pickRadioSlotId', () => {
  it('returns null when nothing is eligible', () => {
    expect(pickRadioSlotId([], null, () => 0)).toBeNull()
  })

  it('returns the only eligible slot', () => {
    expect(pickRadioSlotId(['a'], null, () => 0)).toBe('a')
  })

  it('returns the only eligible slot even when it changed last', () => {
    expect(pickRadioSlotId(['a'], 'a', () => 0)).toBe('a')
  })

  it('never picks the slot that changed last when another is eligible', () => {
    for (const r of [0, 0.2, 0.4, 0.6, 0.8, 0.9999]) {
      expect(pickRadioSlotId(['a', 'b', 'c'], 'b', () => r)).not.toBe('b')
    }
  })

  it('can reach every other eligible slot', () => {
    const seen = new Set<string | null>()
    for (const r of [0, 0.34, 0.67, 0.9999]) {
      seen.add(pickRadioSlotId(['a', 'b', 'c'], 'a', () => r))
    }
    expect(seen).toEqual(new Set(['b', 'c']))
  })

  it('ignores a lastChangedId that is no longer eligible', () => {
    const seen = new Set<string | null>()
    for (const r of [0, 0.34, 0.67, 0.9999]) {
      seen.add(pickRadioSlotId(['a', 'b', 'c'], 'gone', () => r))
    }
    expect(seen).toEqual(new Set(['a', 'b', 'c']))
  })

  it('never returns an id that was not eligible', () => {
    for (let i = 0; i < 50; i++) {
      const picked = pickRadioSlotId(['x', 'y'], 'x', Math.random)
      expect(['x', 'y']).toContain(picked)
    }
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/shared/radioSchedule.test.ts`
Expected: FAIL — `pickRadioSlotId is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `src/shared/radioSchedule.ts`:

```ts
/** Which single layer turns over next.
 *
 * ONE at a time is the whole point (spec 3.1): everything changing
 * together is just a new loop on a timer, while one at a time lets a bed
 * you recognise evolve under you.
 *
 * `eligible` is decided by the caller -- unlocked, audible, already
 * holding a candidate, not mid-reroll. The only rule here is "not the same
 * one twice running", which is enough variety without a rotation nobody
 * asked for (a least-recently-changed order is an explicit "not now").
 * Returns null only for an empty list, which is radio idling rather than
 * an error: everything locked is a legitimate state and radio simply
 * retries at the next boundary. */
export function pickRadioSlotId(
  eligible: readonly string[],
  lastChangedId: string | null,
  random: () => number = Math.random
): string | null {
  if (eligible.length === 0) return null
  const pool = eligible.length > 1 ? eligible.filter((id) => id !== lastChangedId) : eligible
  const choices = pool.length > 0 ? pool : eligible
  const index = Math.min(choices.length - 1, Math.floor(random() * choices.length))
  return choices[index]
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/shared/radioSchedule.test.ts`
Expected: PASS — 26 tests.

- [ ] **Step 5: Run the whole suite and the checks**

Run: `npm test` then `npm run typecheck` then `npm run lint`
Expected: the baseline plus 26 tests, 0 type errors, 0 new lint warnings. (`src/main/remoteServer.test.ts` may be flaky in the parallel run — see the baseline note.)

- [ ] **Step 6: Commit**

```bash
git add src/shared/radioSchedule.ts src/shared/radioSchedule.test.ts
git commit -m "One layer turns over, and never the same one twice"
```

---

## Task 4: The pace persists

**Files:**
- Modify: `src/main/discoverSettingsStore.ts`
- Test: `src/main/discoverSettingsStore.test.ts`

**DO NOT add this test file to `vitest.config.ts`'s CI exclusion list.** It opens no database — it mocks only `app.getPath` and reads/writes one JSON file. The exclusion list is for better-sqlite3, which crashes vitest workers on GitHub's macOS runners.

- [ ] **Step 1: Write the failing tests**

In `src/main/discoverSettingsStore.test.ts`, update the four existing whole-object assertions and the `saveDiscoverSettings` calls to carry the new field, and add one new case. Replace the file's body from line 23 to the end with:

```ts
  it('defaults to not consented when no file exists yet', async () => {
    const { loadDiscoverSettings } = await import('./discoverSettingsStore')
    expect(loadDiscoverSettings()).toEqual({
      consentedToLibraryScan: false,
      traitMatchBar: 0.75,
      radioPace: 'mid'
    })
  })

  it('persists consent across a save/load round trip', async () => {
    const { loadDiscoverSettings, saveDiscoverSettings } = await import('./discoverSettingsStore')
    saveDiscoverSettings({
      consentedToLibraryScan: true,
      traitMatchBar: 0.75,
      radioPace: 'mid'
    })
    expect(loadDiscoverSettings()).toEqual({
      consentedToLibraryScan: true,
      traitMatchBar: 0.75,
      radioPace: 'mid'
    })
  })

  it('falls back to the defaults when the file is corrupt', async () => {
    const { loadDiscoverSettings, saveDiscoverSettings } = await import('./discoverSettingsStore')
    saveDiscoverSettings({
      consentedToLibraryScan: true,
      traitMatchBar: 0.75,
      radioPace: 'mid'
    })
    writeFileSync(join(dir, 'discoverSettings.json'), 'not json at all', 'utf-8')
    expect(loadDiscoverSettings()).toEqual({
      consentedToLibraryScan: false,
      traitMatchBar: 0.75,
      radioPace: 'mid'
    })
  })

  it('round trips every trait match bar option', async () => {
    const { loadDiscoverSettings, saveDiscoverSettings } = await import('./discoverSettingsStore')
    saveDiscoverSettings({ consentedToLibraryScan: true, traitMatchBar: 0.9, radioPace: 'mid' })
    expect(loadDiscoverSettings().traitMatchBar).toBe(0.9)
    saveDiscoverSettings({ consentedToLibraryScan: true, traitMatchBar: 0.33, radioPace: 'mid' })
    expect(loadDiscoverSettings().traitMatchBar).toBe(0.75)
  })

  it('round trips every radio pace, and normalizes an unknown one', async () => {
    const { loadDiscoverSettings, saveDiscoverSettings } = await import('./discoverSettingsStore')
    for (const pace of ['slow', 'mid', 'fast'] as const) {
      saveDiscoverSettings({ consentedToLibraryScan: false, traitMatchBar: 0.75, radioPace: pace })
      expect(loadDiscoverSettings().radioPace).toBe(pace)
    }
    writeFileSync(
      join(dir, 'discoverSettings.json'),
      JSON.stringify({ consentedToLibraryScan: false, traitMatchBar: 0.75, radioPace: 'glacial' }),
      'utf-8'
    )
    expect(loadDiscoverSettings().radioPace).toBe('mid')
  })

  it('defaults the radio pace for a settings file written before radio existed', async () => {
    const { loadDiscoverSettings } = await import('./discoverSettingsStore')
    writeFileSync(
      join(dir, 'discoverSettings.json'),
      JSON.stringify({ consentedToLibraryScan: true, traitMatchBar: 0.9 }),
      'utf-8'
    )
    expect(loadDiscoverSettings()).toEqual({
      consentedToLibraryScan: true,
      traitMatchBar: 0.9,
      radioPace: 'mid'
    })
  })
})
```

Then make sure the import line at the top of the file includes `writeFileSync`:

```ts
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
```

**Before editing, read the existing file top-to-bottom** — the four existing cases above are reproduced from it with the new field added; if any has drifted, keep its own assertions and only add `radioPace`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/main/discoverSettingsStore.test.ts`
Expected: FAIL — the `toEqual` assertions report a missing `radioPace` key, and the two new cases fail.

- [ ] **Step 3: Write the implementation**

In `src/main/discoverSettingsStore.ts`, add the import:

```ts
import { DEFAULT_RADIO_PACE, normalizeRadioPace, type RadioPace } from '@shared/radioSchedule'
```

Add the field to the interface, after `traitMatchBar`:

```ts
  /** How often radio mode turns a layer over -- 'slow' | 'mid' | 'fast',
   * each a window of bars (RADIO_PACE_BARS, @shared/radioSchedule).
   * Persisted because re-picking it every launch is an annoyance with a
   * four-line fix. See docs/superpowers/specs/2026-09-26-radio-mode-
   * design.md. */
  radioPace: RadioPace
```

Add it to the defaults:

```ts
const DEFAULT_SETTINGS: DiscoverSettings = {
  consentedToLibraryScan: false,
  traitMatchBar: DEFAULT_TRAIT_BAR,
  radioPace: DEFAULT_RADIO_PACE
}
```

And to the parse, inside `loadDiscoverSettings`:

```ts
    return {
      consentedToLibraryScan: parsed.consentedToLibraryScan ?? false,
      traitMatchBar: normalizeTraitMatchBar(parsed.traitMatchBar),
      radioPace: normalizeRadioPace(parsed.radioPace)
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/main/discoverSettingsStore.test.ts`
Expected: PASS — 6 tests (4 updated, 2 new).

- [ ] **Step 5: Verify `vitest.config.ts` is untouched**

Run: `git diff --name-only`
Expected: only `src/main/discoverSettingsStore.ts` and `src/main/discoverSettingsStore.test.ts`. **If `vitest.config.ts` appears, revert it.**

- [ ] **Step 6: Commit**

```bash
git add src/main/discoverSettingsStore.ts src/main/discoverSettingsStore.test.ts
git commit -m "The pace it was left at, next time it is opened"
```

---

## Task 5: Thread the pace down to the panel

No tests: this is prop plumbing through two React components, and **React components are not unit-tested in this codebase** (finding 13). It is verified by typecheck + lint.

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/components/LibraryBrowser.tsx`
- Modify: `src/renderer/src/components/DiscoverPanel.tsx`

- [ ] **Step 1: Add the initial value and the setter in `App.tsx`**

Find the `discoverSettings` state literal (around `App.tsx:1658`) and add the new field:

```tsx
  const [discoverSettings, setDiscoverSettingsState] = useState<DiscoverSettings>({
    consentedToLibraryScan: false,
    traitMatchBar: DEFAULT_TRAIT_BAR,
    radioPace: DEFAULT_RADIO_PACE
  })
  const discoverConsented = discoverSettings.consentedToLibraryScan
  const traitMatchBar = discoverSettings.traitMatchBar
  const radioPace = discoverSettings.radioPace
```

Add the import at the top of the file, beside the existing `@shared/traitBar` import:

```tsx
import { DEFAULT_RADIO_PACE, type RadioPace } from '@shared/radioSchedule'
```

Add the setter next to `setDiscoverConsented` (around `App.tsx:1687`):

```tsx
  /** The one real setter for radioPace -- goes through
   * updateDiscoverSettings so the save MERGES rather than wiping
   * consentedToLibraryScan/traitMatchBar (see its own doc comment). */
  async function setRadioPace(pace: RadioPace): Promise<void> {
    await updateDiscoverSettings({ radioPace: pace })
  }
```

- [ ] **Step 2: Pass both down to `LibraryBrowser`**

`App.tsx` renders `LibraryBrowser` in two places (around lines 2622 and 2750), each already passing `traitMatchBar={traitMatchBar}`. Add these two props immediately after it **in both**:

```tsx
            radioPace={radioPace}
            onRadioPaceChange={setRadioPace}
```

- [ ] **Step 3: Accept and forward them in `LibraryBrowser.tsx`**

Add to the destructured props (beside `traitMatchBar`, around line 131):

```tsx
  radioPace,
  onRadioPaceChange,
```

Add to the props interface (beside `traitMatchBar: number`, around line 167):

```tsx
  /** Radio mode's speed, and its setter -- both owned by App's
   * discoverSettings mirror and passed straight through to DiscoverPanel.
   * LibraryBrowser itself never reads either. */
  radioPace: RadioPace
  onRadioPaceChange: (pace: RadioPace) => Promise<void>
```

Add the type import at the top of the file:

```tsx
import type { RadioPace } from '@shared/radioSchedule'
```

And pass them to `<DiscoverPanel>` (around line 2274, beside `traitMatchBar={traitMatchBar}`):

```tsx
            radioPace={radioPace}
            onRadioPaceChange={onRadioPaceChange}
```

- [ ] **Step 4: Accept them in `DiscoverPanel.tsx`**

Add to the destructured props (beside `traitMatchBar`, around line 281):

```tsx
  radioPace,
  onRadioPaceChange,
```

Add to the props interface (beside `traitMatchBar: number`, around line 337):

```tsx
  /** Radio mode's speed (DiscoverSettings.radioPace), and its persisting
   * setter. See docs/superpowers/specs/2026-09-26-radio-mode-design.md. */
  radioPace: RadioPace
  onRadioPaceChange: (pace: RadioPace) => Promise<void>
```

Add to the imports at the top of the file:

```tsx
import {
  advanceRadioClock,
  createRadioClock,
  nextRadioIntervalBars,
  pickRadioSlotId,
  RADIO_PACE_OPTIONS,
  type RadioClock,
  type RadioPace
} from '@shared/radioSchedule'
```

(The runtime imports are unused until Task 7 — if lint complains about unused imports at this step, add only `type RadioPace` now and the rest in Task 7.)

- [ ] **Step 5: Verify it compiles and lints**

Run: `npm run typecheck` then `npm run lint`
Expected: 0 type errors. 0 new lint warnings.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/App.tsx src/renderer/src/components/LibraryBrowser.tsx src/renderer/src/components/DiscoverPanel.tsx
git commit -m "The pace reaches the panel, through the two it passes"
```

---

## Task 6: Split `rollForSlot` into a pick and a commit

A pure refactor with **no behaviour change**. Radio needs to choose a candidate a whole interval before it uses it (spec §2.4), and it must not push an undo snapshot (finding 7). Doing that without a second implementation of rolling means `rollForSlot` has to hand back its pick instead of only committing it. This is the same instinct as the discovered-library work's *"keep is keep. There is no second implementation."*

**Files:**
- Modify: `src/renderer/src/components/DiscoverPanel.tsx:1679-1828` (`rollForSlot`)

No tests: React component (finding 13). Correctness is established by the refactor being mechanical and by the full suite plus typecheck plus lint staying green.

- [ ] **Step 1: Read the current `rollForSlot` end to end**

Run: `sed -n '1674,1832p' src/renderer/src/components/DiscoverPanel.tsx`

Note the four things that must survive unchanged:
- the `rerollGenerationRef` claim happens **before the first `await`** (finding 9),
- `setRolledCount((n) => n + 1)` fires once per roll,
- `setRerollingSlotIds` is added in `try` and removed in `finally`, both generation-guarded,
- the `catch` block logs and **does not** touch `hasRerolled`.

- [ ] **Step 2: Add the `SlotPick` type at module scope**

Put this next to `DiscoverSlot`'s own declaration (around `DiscoverPanel.tsx:154`), at module scope rather than inside the component — it is referenced from a `useRef` in Task 7 that sits far above the functions that produce it, and a module-scope type is simply easier to find:

```tsx
/** What a roll RESOLVED TO, before anything is written to state. Split out
 * of rollForSlot (2026-09-26, radio mode) so radio can choose a candidate a
 * whole interval before it commits it -- picking early is what lets it
 * pre-warm resolveCandidateStem's own module-level cache and then swap the
 * layer in on a loop boundary without a download happening under the
 * downbeat. See docs/superpowers/specs/2026-09-26-radio-mode-design.md. */
export interface SlotPick {
  candidate: DiscoverCandidate | null
  barUsed: number | null
  barRequested: number
}
```

If the `react-refresh/only-export-components` rule objects to a new export from this file, drop the `export` — nothing outside this file needs it. (`freshSlotId` carries an explicit disable comment for that rule at `:1738`; a plain non-exported interface avoids needing one.)

- [ ] **Step 3: Replace `rollForSlot` with the split pair**

The body of `pickForSlot` below is the **existing** `rollForSlot` body, moved verbatim — every line from `const rollOptions = globalRollOptions` down to and including `const picked = pickReroll(ranked, chaos)`, with all of its comments. Do not retype it and do not paraphrase it: read `sed -n '1697,1758p' src/renderer/src/components/DiscoverPanel.tsx`, move that block, and change nothing inside it. The new shape:

```tsx
  /** The fetch/dedupe/bar/rank/pick half of a roll. Owns the
   * rerollGenerationRef claim, the rolled counter and the per-slot
   * spinner; returns null when a NEWER call for the same slot superseded
   * this one (the caller must then write nothing) or when the IPC call
   * genuinely failed. */
  async function pickForSlot(id: string, kinds: DiscoverSlotKind[]): Promise<SlotPick | null> {
    // Claimed BEFORE the first await -- see rerollGenerationRef's own doc
    // comment above. Any earlier call for this SAME slot id that's still
    // awaiting getDiscoverCandidates when THIS call resolves is now stale
    // and must not write its own (older) result over this one.
    const myGeneration = (rerollGenerationRef.current.get(id) ?? 0) + 1
    rerollGenerationRef.current.set(id, myGeneration)
    // The phone's "rolled" counter. Counted in the two functions every roll
    // path funnels through (this and rollRandomForSlot below) rather than at
    // each of addSlot/rerollSlot/rerollAll/changeSlotKinds.
    setRolledCount((n) => n + 1)
    setRerollingSlotIds((prev) => new Set(prev).add(id))
    try {
      // >>> the moved block goes here, unchanged: `const rollOptions =
      // globalRollOptions` through `const picked = pickReroll(ranked,
      // chaos)`, every comment included. <<<
      if (rerollGenerationRef.current.get(id) !== myGeneration) return null
      return { candidate: picked, barUsed, barRequested: traitMatchBar }
    } catch (err) {
      // Degrade gracefully, log, don't throw -- same convention as this
      // file's own resolveCandidateStem above and LibraryBrowser.tsx's
      // established try/catch + console.error-with-prefix handlers.
      console.error(`DiscoverPanel: pickForSlot(${slotKindsKey(kinds)}) failed:`, err)
      return null
    } finally {
      if (rerollGenerationRef.current.get(id) === myGeneration) {
        setRerollingSlotIds((prev) => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
      }
    }
  }

  /** Writes a pick onto a slot. The ONE place a rolled candidate lands, so
   * every roll path (hand-clicked, reroll-all, radio) produces the same
   * slot shape. No undo snapshot of its own -- every caller decides that
   * for itself (rerollSlot pushes one, rerollAll pushes one for the whole
   * batch, radio pushes none; see the spec's 3.4). */
  function commitSlotPick(id: string, pick: SlotPick): void {
    // hasRerolled set true in this same setSlots call, alongside
    // candidate -- see DiscoverSlot's own doc comment above for why this
    // only happens on the generation-guarded path (never for a stale,
    // discarded result) and why a genuine error deliberately leaves it
    // untouched.
    setSlots((prev) =>
      prev.map((s) =>
        s.id === id
          ? {
              ...s,
              candidate: pick.candidate,
              pickBar: pick.candidate
                ? {
                    candidate: pick.candidate,
                    barUsed: pick.barUsed,
                    barRequested: pick.barRequested
                  }
                : undefined,
              reclassified: undefined,
              hasRerolled: true,
              seedStem: undefined
            }
          : s
      )
    )
  }

  // Core roll logic, shared by addSlot (a brand-new slot's own first roll)
  // and rerollSlot (an existing slot's later rerolls) -- takes `kind`
  // directly rather than looking it up via `slots.find(...)`, since addSlot
  // needs to roll a slot in the SAME tick it mints it, before that slot has
  // made it into `slots` state (a plain function defined in this render
  // still closes over THIS render's `slots`, which doesn't include it yet).
  async function rollForSlot(id: string, kinds: DiscoverSlotKind[]): Promise<void> {
    const pick = await pickForSlot(id, kinds)
    if (pick === null) return
    commitSlotPick(id, pick)
  }
```

Note the one deliberate difference from before: the two `console.log` diagnostics that used to bracket the `setSlots` call now sit inside `pickForSlot` where the pick happens. Keep both (they are marked TEMPORARY but were never removed), adjusting only the function name in the message.

- [ ] **Step 4: Verify nothing else called into the old internals**

Run: `grep -n "rollForSlot\|pickForSlot\|commitSlotPick" src/renderer/src/components/DiscoverPanel.tsx`
Expected: `rollForSlot` is still called from `addSlot`, `rerollSlot`, `changeSlotKinds` and `rerollAll`, and from nowhere else. No caller needed changing.

- [ ] **Step 5: Verify the refactor**

Run: `npm run typecheck` then `npm run lint` then `npm test`
Expected: 0 type errors, 0 new lint warnings, the suite exactly as it was after Task 4.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/DiscoverPanel.tsx
git commit -m "A roll that can be chosen now and played later"
```

---

## Task 7: The clock, the prefetch and the commit

The feature itself. No tests: React component (finding 13).

**Files:**
- Modify: `src/renderer/src/components/DiscoverPanel.tsx`

- [ ] **Step 1: Add radio's state, next to the other panel state**

Put this immediately after the `rerollingSlotIds` state (around `DiscoverPanel.tsx:1098`):

```tsx
  // --- radio mode (docs/superpowers/specs/2026-09-26-radio-mode-design.md)
  //
  // Radio is Discover with a clock: while the preview plays, one unlocked,
  // audible layer rerolls on its own every so often. Everything schedulable
  // lives in @shared/radioSchedule; what is here is the wiring.
  const [radioOn, setRadioOn] = useState(false)
  // The live clock. A REF, not state: it is written from the position-tick
  // effect below at ~30Hz and re-rendering the whole panel for each tick
  // would be pointless (the panel already re-renders at that rate for the
  // playhead, and this value is read, not displayed, except through
  // radioProgress below which is derived at render time).
  const radioClockRef = useRef<RadioClock | null>(null)
  // What radio will play next, chosen a whole interval early so
  // resolveCandidateStem's module-level cache has time to warm (spec 2.4).
  const radioPendingRef = useRef<{ slotId: string; pick: SlotPick } | null>(null)
  // Which slot radio changed last -- so it never changes the same one
  // twice running (pickRadioSlotId).
  const radioLastSlotRef = useRef<string | null>(null)
  // Fraction of the current interval elapsed, 0..1, for the progress rule
  // under the button. State, not a ref, because it IS displayed -- but
  // written at most once per position tick, which the panel re-renders on
  // anyway.
  const [radioProgress, setRadioProgress] = useState(0)
```

- [ ] **Step 2: Add the eligibility helper and the pick-and-warm function**

Put these immediately after `rerollAll` (around `DiscoverPanel.tsx:1951`), so they sit with the other roll paths:

```tsx
  /** Which slots radio is allowed to change right now: unlocked, audible
   * (a muted slot is not part of what you are listening to, so changing it
   * would be a change you cannot hear), already holding a candidate, and
   * not already mid-roll. Read from slotsRef, not `slots`, for the same
   * stale-closure reason rerollAll does -- the position-tick effect below
   * runs from a closure that can be a render behind. */
  function radioEligibleSlotIds(): string[] {
    return slotsRef.current
      .filter(
        (s) =>
          !s.locked &&
          previewingSlotIdsRef.current.has(s.id) &&
          s.candidate !== null &&
          !rerollingSlotIds.has(s.id)
      )
      .map((s) => s.id)
  }

  /** Chooses radio's NEXT change and warms it. Called right after each
   * change lands (and once when radio starts), so the prefetch gets the
   * whole interval -- 12 to 48 bars, long enough for a cold stem to
   * download before it is needed.
   *
   * The warm is the load-bearing half: resolveCandidateStem memoises by
   * `${riffCID}:${stemCID}` in a module-level map, so calling it here and
   * throwing the promise away means DiscoverSlotRow's own resolve effect
   * hits a SETTLED promise when the candidate is finally committed. Without
   * it a radio change would land hundreds of milliseconds -- or a whole
   * download -- after the downbeat it was scheduled for. */
  async function armRadioPick(): Promise<void> {
    radioPendingRef.current = null
    const eligible = radioEligibleSlotIds()
    const slotId = pickRadioSlotId(eligible, radioLastSlotRef.current)
    if (slotId === null) return
    const slot = slotsRef.current.find((s) => s.id === slotId)
    if (!slot) return
    const pick = await pickForSlot(slotId, slot.kinds)
    if (pick === null || pick.candidate === null) return
    if (!radioOnRef.current) return
    // Warm the cache and deliberately ignore the result -- a null (network
    // hiccup, since-deleted riff) deletes its own cache entry, the slot
    // keeps its previous stem, and radio simply tries again at the next
    // boundary. Same soft degradation every other Discover path takes.
    void resolveCandidateStem(pick.candidate)
    radioPendingRef.current = { slotId, pick }
  }
```

- [ ] **Step 3: Add the `radioOn` ref that `armRadioPick` reads**

`armRadioPick` awaits, so it must not commit against a radio that was switched off mid-flight. Add beside the `radioOn` state from Step 1:

```tsx
  // Synchronously-current mirror of radioOn, for the same stale-closure
  // reason previewingSlotIdsRef and slotsRef exist: armRadioPick awaits a
  // real IPC round trip and must see a switch-off that happened during it.
  // Mirrored through an effect, NOT by assigning during render -- this
  // repo's react-hooks/purity rule rejects a render-time ref write, and
  // slotsRef (`:379-382`) already establishes the effect form as this
  // file's pattern. toggleRadio also sets it synchronously on switch-off,
  // so a stop takes effect before the next tick rather than a render
  // later.
  const radioOnRef = useRef(false)
  useEffect(() => {
    radioOnRef.current = radioOn
  }, [radioOn])
```

- [ ] **Step 4: Add the position-tick effect**

Put this immediately after the bpm-retune effect (around `DiscoverPanel.tsx:1064`), so it sits with the other `pos`-adjacent logic:

```tsx
  // Radio's clock. Driven ONLY by the engine's real position stream -- no
  // setInterval anywhere, on purpose: the engine stops its 33ms timer on
  // "pause" (IpcServer.cpp), so `pos` stops changing and this clock stops
  // and resumes with the transport for free.
  //
  // `due` is true only at a LOOP WRAP at or after the interval (spec 2.2):
  // a change dropped at bar 7 of an 8-bar loop is a splice; a change
  // dropped at the wrap is a new section. The effective interval is
  // therefore ceil(intervalBars / loopBars) * loopBars.
  // (armRadioPick, radioEligibleSlotIds and commitSlotPick are `function`
  // declarations further down this component body, so they are hoisted and
  // available here -- the effect only runs after render regardless.)
  useEffect(() => {
    if (!radioOn) return
    const clock = radioClockRef.current
    if (!clock) return
    const loopBars =
      resolvedBarLengthsRef.current.size > 0
        ? Math.max(...resolvedBarLengthsRef.current.values())
        : 0
    if (!(loopBars > 0)) return
    const step = advanceRadioClock(clock, pos, loopBars)
    radioClockRef.current = step.clock
    // Deferred out of the effect body: this repo ERRORS on a synchronous
    // setState inside an effect (react-hooks/set-state-in-effect), and the
    // established workaround in this codebase is a resolved-promise tick.
    const progress = Math.max(0, Math.min(1, step.clock.barsElapsed / step.clock.intervalBars))
    void Promise.resolve().then(() => setRadioProgress(progress))
    if (!step.due) return

    // Due. Draw a fresh interval and reset the clock FIRST, so a slow
    // commit below cannot fire a second change on the very next tick.
    radioClockRef.current = createRadioClock(nextRadioIntervalBars(radioPace), pos)
    void Promise.resolve().then(() => setRadioProgress(0))

    const pending = radioPendingRef.current
    radioPendingRef.current = null
    // The pick was made a whole interval ago, so the world may have moved:
    // the slot may since have been removed, locked or muted. Re-check, and
    // if it is no longer eligible drop the pick and arm a fresh one --
    // resolving a few hundred milliseconds late is strictly better than
    // swapping a layer the user just locked.
    const eligibleNow = radioEligibleSlotIds()
    // Everything below sets state, and this repo ERRORS on a synchronous
    // setState inside an effect -- commitSlotPick calls setSlots, and
    // armRadioPick reaches pickForSlot's setRolledCount/setRerollingSlotIds
    // BEFORE its first await. Both are deferred through the same
    // resolved-promise tick the progress write above uses.
    void Promise.resolve().then(() => {
      if (!radioOnRef.current) return
      if (pending !== null && eligibleNow.includes(pending.slotId)) {
        // No pushUndoSnapshot: radio firing every twenty bars would fill
        // the undo stack and make Cmd+Z useless for the edits the user
        // actually made by hand. A radio change is not undoable; the
        // padlock is the tool for "I liked that one" (spec 3.4).
        commitSlotPick(pending.slotId, pending.pick)
        radioLastSlotRef.current = pending.slotId
      }
      // Arm the next one whether or not this one landed -- nothing
      // eligible is radio idling, not an error, and it retries here at
      // every boundary.
      void armRadioPick()
    })
    // `pos` is the only real dependency; every function above is re-created
    // each render and reads through refs on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos, radioOn, radioPace])
```

- [ ] **Step 5: Add the start/stop function**

Put this immediately after `armRadioPick`:

```tsx
  /** The radio button. Starting lays down a bed if the panel is empty --
   * a button that does nothing on a fresh panel is not the thing he asked
   * for, and four layers is the smallest set that sounds like a band
   * rather than like a loop. addSlot does its own first roll per slot, so
   * this is the same four clicks the user would otherwise make. */
  function toggleRadio(): void {
    if (radioOn) {
      radioOnRef.current = false
      setRadioOn(false)
      radioClockRef.current = null
      radioPendingRef.current = null
      radioLastSlotRef.current = null
      setRadioProgress(0)
      return
    }
    if (slotsRef.current.length === 0) {
      for (const kind of RADIO_STARTER_KINDS) addSlot([kind])
    }
    radioOnRef.current = true
    radioClockRef.current = createRadioClock(nextRadioIntervalBars(radioPace), pos)
    radioLastSlotRef.current = null
    setRadioProgress(0)
    setRadioOn(true)
    void armRadioPick()
  }
```

And add the starter bed constant at module scope, beside `DEFAULT_GLOBAL_MODIFIERS` (around `DiscoverPanel.tsx:1748`):

```tsx
// What radio lays down when it is started on an empty panel -- four,
// because it is the smallest set that sounds like a band rather than like
// a loop. Deliberately not random: a predictable starting bed is easier to
// reason about than a surprising one, and every layer is one click from
// being changed anyway. See docs/superpowers/specs/2026-09-26-radio-mode-
// design.md 3.6.
const RADIO_STARTER_KINDS: DiscoverSlotKind[] = ['drums', 'bass', 'lead', 'warm']
```

- [ ] **Step 6: Stop radio when the panel unmounts**

Add to the existing unmount cleanup effect (the one at `DiscoverPanel.tsx:1352` that pushes the closed remote state), inside its returned function:

```tsx
      radioClockRef.current = null
      radioPendingRef.current = null
```

- [ ] **Step 7: Verify**

Run: `npm run typecheck` then `npm run lint` then `npm test`
Expected: 0 type errors, 0 new lint warnings, the suite unchanged from Task 4.

If `react-hooks/exhaustive-deps` or `react-hooks/set-state-in-effect` fires anywhere the disables above do not already cover, **fix the code, do not widen the disable** — the deferred-`setState` pattern in Step 4 is the sanctioned workaround.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/components/DiscoverPanel.tsx
git commit -m "Something decides, a loop later, to change its mind"
```

---

## Task 8: The button, the chips and the rule

No tests: React component (finding 13). Tokens are the law (finding 14).

**Files:**
- Modify: `src/renderer/src/components/DiscoverPanel.tsx` (the actions row, around `:2318`)

- [ ] **Step 1: Add the button, the progress rule and the pace chips**

Insert this **immediately before** the existing dice button (`onClick={() => void rerollAll()}`, around `DiscoverPanel.tsx:2521`), inside the same actions row:

```tsx
        {/* Radio -- docs/superpowers/specs/2026-09-26-radio-mode-design.md.
            Lit with --ra-play-on when on, exactly like the play/stop button
            in the settings row above: the transport is audio information
            and so is this. The label is `radio` either way; the lit state
            says the rest. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <button
            onClick={toggleRadio}
            data-tooltip="auto reroll"
            style={{
              fontFamily: 'inherit',
              fontSize: 10,
              padding: '6px 14px',
              background: radioOn ? 'var(--ra-play-on)' : 'transparent',
              border: '1px solid var(--ra-border-strong)',
              color: radioOn ? 'var(--ra-play-on-ink)' : 'var(--ra-text)',
              cursor: 'pointer'
            }}
          >
            radio
          </button>
          {/* How far through the current interval. Monochrome on purpose --
              this is chrome, not audio information, and colour in this app
              is spent only on things that carry audio information. A line
              rather than a number because a number that jitters at 30Hz is
              worse than a line that does. */}
          <div
            style={{
              height: 2,
              background: 'var(--ra-border)',
              visibility: radioOn ? 'visible' : 'hidden'
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${Math.round(radioProgress * 100)}%`,
                background: 'var(--ra-text-3)'
              }}
            />
          </div>
        </div>
        {radioOn && (
          <div style={{ display: 'flex', gap: 4 }}>
            {RADIO_PACE_OPTIONS.map((pace) => (
              <button
                key={pace}
                onClick={() => void onRadioPaceChange(pace)}
                style={{
                  fontFamily: 'inherit',
                  fontSize: 9,
                  padding: '4px 8px',
                  background:
                    pace === radioPace ? 'var(--ra-bg-row-active)' : 'transparent',
                  border: '1px solid var(--ra-border)',
                  color: pace === radioPace ? 'var(--ra-text)' : 'var(--ra-text-3)',
                  cursor: 'pointer'
                }}
              >
                {pace}
              </button>
            ))}
          </div>
        )}
```

No tooltip on the pace chips: the labels are the whole meaning, and the house rule is two or three words or nothing.

- [ ] **Step 2: Check every token rule by hand**

Run: `grep -n "borderRadius\|border-radius" src/renderer/src/components/DiscoverPanel.tsx`
Expected: no hits from anything added in this task. (If the file already had some, they are not yours.)

Then read back what you added and confirm: all copy lowercase; no emoji; no exclamation marks; the one tooltip is two words (`auto reroll`); the one button label is one word (`radio`); every colour is a `var(--ra-*)` token and none is hand-rolled.

- [ ] **Step 3: Verify**

Run: `npm run typecheck` then `npm run lint`
Expected: 0 type errors, 0 new lint warnings. Prettier in particular: `singleQuote`, no semicolons, 100-column width.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/DiscoverPanel.tsx
git commit -m "One lit word, and a line that says a change is coming"
```

---

## Task 9: Final gate

**Files:** none modified unless something below fails.

- [ ] **Step 1: Full suite**

Run: `npm test`
Expected: `Test Files 191 passed (191)` and `Tests 2900 passed (2900)` — the baseline of 190 / 2872, plus one new file (`src/shared/radioSchedule.test.ts`, 26 tests) and two extra cases in `discoverSettingsStore.test.ts` (4 existing become 6). If `src/main/remoteServer.test.ts` fails in the parallel run, re-run it alone (`npx vitest run src/main/remoteServer.test.ts`) and treat a clean isolated run as green — that file is flaky at baseline, it binds a real HTTP port. **No other failure is acceptable.**

- [ ] **Step 2: Typecheck and lint**

Run: `npm run typecheck` then `npm run lint`
Expected: 0 type errors. 0 new lint warnings (the repo has 4 pre-existing prettier warnings in unrelated files; any *new* one is yours).

- [ ] **Step 3: Confirm nothing forbidden was touched**

Run: `git diff --stat master@{u}...HEAD 2>/dev/null || git log --oneline --stat -8`

Confirm the changed files are exactly:
`src/shared/radioSchedule.ts`, `src/shared/radioSchedule.test.ts`,
`src/main/discoverSettingsStore.ts`, `src/main/discoverSettingsStore.test.ts`,
`src/renderer/src/App.tsx`, `src/renderer/src/components/LibraryBrowser.tsx`,
`src/renderer/src/components/DiscoverPanel.tsx`.

**`vitest.config.ts` must NOT appear** (finding 11). **Nothing under `native-engine/` must appear.** `src/shared/buildEngineProject.ts` must NOT appear.

- [ ] **Step 4: Write the walkthrough for Elling**

Report it; do not write a file. **You cannot do any of this yourself — this environment has no GUI and no audio.** Do not claim otherwise.

1. `npm run dev`. Open Discover on an empty panel. Press `radio`. Four layers should appear (drummy, bassish, leadesque, buttery) and start playing.
2. Leave it. Within roughly 24–48 seconds at 120 bpm, **one** layer should change — on the loop, not mid-phrase — and the others should keep playing without a restart.
3. When something good comes up, click the padlock on that row. Confirm it is never the one that changes.
4. Lock everything. Confirm radio goes quiet rather than erroring, and that unlocking one starts changes again.
5. Press `fast`. Confirm changes come more often, and that the setting survives a full quit and relaunch.
6. Press the transport stop in the settings row. Confirm radio stops counting, and resumes where it was on play.
7. Press `keep` while radio runs. Confirm the group lands in the `discovered` room in Browse.
8. The judgement call only he can make: **does the interval feel right, and does a change land where a change should land?** If a change sounds spliced rather than sectioned, the loop-boundary quantisation is not working and that is the first thing to look at.

- [ ] **Step 5: Commit nothing**

This task changes no files. If it did, something failed and that is the report.
