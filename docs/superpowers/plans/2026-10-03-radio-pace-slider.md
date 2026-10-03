# Radio Pace Slider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace radio's slow / mid / fast chips with one `pace` slider (0-100) in sssketch's Discover radio and in ell.ing/radio's full mode.
- Today's three paces sit at fixed positions and play exactly as now.
- Above fast, the phrase grid shortens, then changes land on every loop top.
- From 80, changes land mid-loop on bar lines with more rows per change, up to `ludicrous`.
- Turnarounds keep their 16-bar phrase throughout, and moving the slider mid-stream takes nothing back.

**Spec:** `docs/superpowers/specs/2026-10-03-radio-pace-slider-design.md`. Read it first. Its table, its flags and its timing risks (section 8) are the review checklist.

**Architecture:** One pure profile and one cadence reader, shared by both radios.
- **The profile.** `src/shared/radioPace.ts` (`radioPaceProfile`) maps the level to:
  - the interval window;
  - a phrase cap;
  - a mid-loop bar grid;
  - rows per change.
- **The cadence reader.** `radioSchedule.ts`'s `radioCadenceOf(settings)` applies the profile to a runtime's own phrase, with fold mode's override. It is the only thing either radio reads cadence from.
- **The clock.** `advanceRadioClock` takes the turnaround's phrase as its own argument.
- **A move while running** goes through `radioClockForPace`: it shortens a too-long interval and re-anchors the change phrase on the turnaround's. Nothing else.
- **The build runs in three phases, each shippable on its own:**
  1. the slider (Tasks 1-4);
  2. mid-loop landings (Tasks 5-6);
  3. rows per change, "companions" (Tasks 7-9).

**Tech Stack:** TypeScript and vitest. sssketch is React and Electron; ell.ing/radio is plain DOM with Web Audio.

**Repos:**
- **sssketch** (`/Users/nickel/Claudecode/sssketch`): Tasks 1, 2, 4, 6, 7, 9 and 10. Base: `master` at `a965150`.
- **ell.ing/radio** (`/Users/nickel/Claudecode/ell.ing/radio`): Tasks 3, 5 and 8. Base: `main` at `bbee7a2`.
- **How the two connect.** The web repo imports sssketch's `src/shared` through `@shared`, from sssketch's **working tree**. So a web task needs its shared tasks checked out in sssketch first.

**Branches:** work on `radio-pace-slider` in each repo (`git switch -c radio-pace-slider`).

**Commits:** every commit message ends with exactly these two lines, after a blank line:

```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz
```

**Before you start, in both repos:**
- Run `git status --short`. Expect sssketch to show only `?? native-engine/.cache/`, and the radio to be clean.
- **sssketch:** run `npm test`, which should be green except the machine-dependent engine-spawn tests (memory: coreaudiod).
- **ell.ing/radio:** run `npx vitest run`, which should be green.
- **The diffs** in this plan were made against those two commits and applied cleanly, in task order, to fresh copies. If a file has moved on since, make the same edits by hand, anchored on the quoted context, not on line numbers.

---

## How this plan's code was checked

Every diff and file below was applied, in task order, to fresh copies of both repos in the planning scratchpad, and then:
- **sssketch:**
  - `npm run typecheck` gave 0 errors;
  - `npx vitest run src/shared src/main/discoverSettingsStore.test.ts` gave 2480 passed;
  - `npx eslint` on every touched file gave 0 errors and 0 warnings after `--fix`.
  - The full `npm test` was not run there, because the copy has no native engine. Run it in the real repo.
- **ell.ing/radio:**
  - `npm run typecheck` gave 0 errors;
  - `npx vitest run src` gave 695 passed. `scripts/buildFaust.test.ts` needs sssketch's native-engine tree, which the copy lacked; it is not touched here.
- **The red-to-green checks:**
  - Phase 1 alone (Tasks 1-4) typechecks and passes.
  - The phase 2 tests fail against phase 1 code (4 red) and pass after Task 5.
  - The phase 3 tests need Task 8's types.
- **Task 9 (desktop companions) is the one task NOT compiled here.** It is panel glue over the staged swap. Its shared pieces (Task 7) were compiled; its steps are written as precise instructions.

## Decisions made in planning (the spec's flags are the ones for Elling)

1. **Positions.** slow 0, mid 25, fast 50, ludicrous from 90. The phrase cap is 8 bars for 51-60, 4 for 61-70, and none (every loop top) from 71. The mid-loop grid is every 4 bars for 80-86, every 2 for 87-93, and every bar for 94-100. Rows per change are 1 up to 70, then rise linearly to 4 at 100.
2. **A RadioSettings with no `paceLevel` reads exactly as before** (`radioCadenceOf`: its `paceBars` window, one row). This is what lets every existing web test that pins a window (`paceBars: { min: 4, max: 4 }`) keep its meaning unchanged.
   - `WEB_RADIO_DEFAULTS` is untouched; `main.ts` passes the listener's level.
   - `pace` and `paceBars` stay on the type as legacy fields; no cleanup task removes them.
3. **Where things live.** `radioPace.ts` imports nothing at runtime, only a type from radioSchedule. Everything that needs the clock (`radioPaceGridBars`, `radioClockForPace`, `pickRadioSlotIds`) lives in `radioSchedule.ts`. So there is no import cycle.
4. **Rewriting the tests that relied on a pace re-arm.** Two web tests used a pace press to re-arm radio (the flags-weighting tests). They now re-arm through the due branch (`rearm()` in `step.test.ts`), which makes the same two draws in the same order.
5. **The web's mid-loop landing** reuses `Engine.scheduleSwapAt` (swap-now's path):
   - `landAt` and `cancel` carry `bar: true`;
   - a refused bar line goes to the loop top, as a refused swap-now does;
   - `BAR_LEAD_SEC = TURN_LEAD_SEC` (0.1 s).
6. **Web companions** are sent only after the engine accepts radio's own change.
   - Refused: dropped.
   - Taken back: taken back with it, the companions' cancels first.
   - Their take-back refused: committed when they land (`companionsLanding`).
   - A swap-now on a companion's row withdraws it on its own.
7. **Desktop companions** ride radio's change inside the same staged project (`mergeStageChanges`' new `companions`), so they are atomic with it.
8. **Phone remote:** no pace control exists, and none is added (spec flag 8).

## File map

**sssketch**
- Create `src/shared/radioPace.ts` and `src/shared/radioPace.test.ts` (Task 1).
- Modify `src/shared/radioSchedule.ts` (Task 2).
- Create `src/shared/radioCadence.test.ts` (Task 2).
- Modify the tests `src/shared/radioSchedule.test.ts` and `src/main/discoverSettingsStore.test.ts` (Task 2).
- Modify `src/renderer/src/components/DiscoverRadioMenu.tsx` (Task 4).
- Modify `src/renderer/src/components/DiscoverPanel.tsx` (Tasks 4, 6 and 9).
- Modify `src/shared/radioReadout.ts`, `src/shared/radioNextLanding.ts` and `src/shared/radioManualChanges.ts`, with their tests (Task 7).

**ell.ing/radio**
- Modify `src/radio/step.ts`, `src/radio/controller.ts` and `src/radio/step.test.ts` (Tasks 3, 5 and 8).
- Create `src/ui/pacePrefs.ts` and `src/ui/pacePrefs.test.ts` (Task 3).
- Modify `src/ui/full.ts`, `src/ui/fullModel.ts`, `src/ui/controlsModel.ts`, `src/ui/simple.ts`, `src/main.ts`, `src/dev/devRadio.ts` and `dev-radio.html` (Task 3).
- Modify the tests `src/radio/settings.test.ts`, `src/ui/controlsModel.test.ts` and `src/ui/fullModel.test.ts` (Task 3).

## Task graph

```
T1 radioPace (sssketch) ──> T2 cadence + clock (sssketch) ─┬─> T3 web slider ────────> T5 web mid-loop ──┐
                                                           ├─> T4 desktop slider ────> T6 desktop mid-loop ┼──┐
T7 shared companions (sssketch, independent) ──────────────┴───────────────────────────────────────────────┤  │
                                                                     T5 + T7 ─> T8 web companions ──────────┤  │
                                                                     T6 + T7 ─> T9 desktop companions ──────┘  │
                                                                                     all ─> T10 verify + handoff
```

- **Strictly in order:** T1 then T2. T3 then T5 then T8 (one file, `step.ts`). T4 then T6 then T9 (one file, `DiscoverPanel.tsx`).
- **In parallel:**
  - T3 and T4 after T2 (different repos);
  - T5 and T6;
  - T8 and T9;
  - T7 with anything after T1 (it touches only `radioReadout.ts`, `radioNextLanding.ts` and `radioManualChanges.ts`, and their tests).
- **Mind the shared checkout.** sssketch tasks running in parallel share one working tree. Commit each task's own files only (`git add <paths>`), never `git add -A`.
- **Ship points** (each is a place Elling can listen; deploy only with his go-ahead):
  - after T3 and T4 (the slider);
  - after T5 and T6 (mid-loop);
  - after T8 and T9.

---

### Task 1: The shared pace profile (`radioPace.ts`)

**Files:**
- Create: `/Users/nickel/Claudecode/sssketch/src/shared/radioPace.ts`
- Test: `/Users/nickel/Claudecode/sssketch/src/shared/radioPace.test.ts`

**Depends on:** nothing.

**Timing risk:** none. Pure numbers.

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_RADIO_PACE_LEVEL,
  RADIO_PACE_ANCHORS,
  RADIO_PACE_LABEL,
  RADIO_PACE_ROWS_MAX,
  RADIO_PACE_TOOLTIP,
  nextRadioPaceAnchor,
  normalizeRadioPaceLevel,
  radioPaceLabel,
  radioPaceLevelFromLegacy,
  radioPacePhraseBars,
  radioPaceProfile,
  radioPaceRowsThisChange
} from './radioPace'
import { RADIO_PACE_BARS, RADIO_PACE_OPTIONS } from './radioSchedule'

describe('the pace slider anchors', () => {
  it("slow, mid and fast reproduce today's windows exactly, one row, the runtime's phrase", () => {
    for (const word of RADIO_PACE_OPTIONS) {
      const p = radioPaceProfile(RADIO_PACE_ANCHORS[word])
      expect(p.window).toEqual(RADIO_PACE_BARS[word])
      expect(p.phraseCap).toBeNull()
      expect(p.barEvery).toBeNull()
      expect(p.rows).toBe(1)
    }
  })

  it('defaults to mid; copy is lowercase', () => {
    expect(DEFAULT_RADIO_PACE_LEVEL).toBe(RADIO_PACE_ANCHORS.mid)
    expect(RADIO_PACE_LABEL).toBe('pace')
    expect(RADIO_PACE_TOOLTIP).toBe(RADIO_PACE_TOOLTIP.toLowerCase())
  })
})

describe('radioPaceProfile', () => {
  it('never slows down as the level rises: both edges of the window are non-increasing', () => {
    let prev = radioPaceProfile(0).window
    for (let l = 1; l <= 100; l++) {
      const w = radioPaceProfile(l).window
      expect(w.min).toBeLessThanOrEqual(prev.min)
      expect(w.max).toBeLessThanOrEqual(prev.max)
      expect(w.min).toBeGreaterThanOrEqual(1)
      expect(w.max).toBeGreaterThanOrEqual(w.min)
      expect(Number.isInteger(w.min) && Number.isInteger(w.max)).toBe(true)
      prev = w
    }
  })

  it('the phrase cap steps 8 -> 4 -> every loop top above fast', () => {
    expect(radioPaceProfile(51).phraseCap).toBe(8)
    expect(radioPaceProfile(60).phraseCap).toBe(8)
    expect(radioPaceProfile(61).phraseCap).toBe(4)
    expect(radioPaceProfile(70).phraseCap).toBe(4)
    expect(radioPaceProfile(71).phraseCap).toBe(0)
    expect(radioPaceProfile(100).phraseCap).toBe(0)
  })

  it('mid-loop bar lines only from 80: every 4, then 2, then 1 bar', () => {
    expect(radioPaceProfile(79).barEvery).toBeNull()
    expect(radioPaceProfile(80).barEvery).toBe(4)
    expect(radioPaceProfile(86).barEvery).toBe(4)
    expect(radioPaceProfile(87).barEvery).toBe(2)
    expect(radioPaceProfile(94).barEvery).toBe(1)
    expect(radioPaceProfile(100).barEvery).toBe(1)
  })

  it('rows per change: 1 up to 70, then up to 4 at 100', () => {
    expect(radioPaceProfile(70).rows).toBe(1)
    expect(radioPaceProfile(80).rows).toBeCloseTo(2)
    expect(radioPaceProfile(90).rows).toBeCloseTo(3)
    expect(radioPaceProfile(100).rows).toBe(RADIO_PACE_ROWS_MAX)
  })

  it('normalises the level first', () => {
    expect(radioPaceProfile(-5)).toEqual(radioPaceProfile(0))
    expect(radioPaceProfile(400)).toEqual(radioPaceProfile(100))
    expect(radioPaceProfile(49.6).level).toBe(50)
  })
})

describe('normalizeRadioPaceLevel', () => {
  it('clamps and rounds; anything else is the fallback', () => {
    expect(normalizeRadioPaceLevel(37.4)).toBe(37)
    expect(normalizeRadioPaceLevel(-1)).toBe(0)
    expect(normalizeRadioPaceLevel(101)).toBe(100)
    expect(normalizeRadioPaceLevel('50')).toBe(DEFAULT_RADIO_PACE_LEVEL)
    expect(normalizeRadioPaceLevel(NaN, 50)).toBe(50)
  })
})

describe('radioPacePhraseBars', () => {
  it("the runtime's phrase up to fast, then capped; a base of 0 stays 0", () => {
    expect(radioPacePhraseBars(radioPaceProfile(50), 16)).toBe(16)
    expect(radioPacePhraseBars(radioPaceProfile(50), 32)).toBe(32)
    expect(radioPacePhraseBars(radioPaceProfile(55), 16)).toBe(8)
    expect(radioPacePhraseBars(radioPaceProfile(55), 32)).toBe(8)
    expect(radioPacePhraseBars(radioPaceProfile(65), 16)).toBe(4)
    expect(radioPacePhraseBars(radioPaceProfile(75), 16)).toBe(0)
    expect(radioPacePhraseBars(radioPaceProfile(55), 0)).toBe(0)
    expect(radioPacePhraseBars(radioPaceProfile(0), 0)).toBe(0)
  })
})

describe('radioPaceRowsThisChange', () => {
  it('never calls random while rows is whole', () => {
    const random = vi.fn(() => 0.5)
    expect(radioPaceRowsThisChange(radioPaceProfile(50), random)).toBe(1)
    expect(radioPaceRowsThisChange(radioPaceProfile(100), random)).toBe(4)
    expect(random).not.toHaveBeenCalled()
  })

  it('the fraction is the chance of one more row', () => {
    const p = radioPaceProfile(85) // 2.5 rows
    expect(radioPaceRowsThisChange(p, () => 0.49)).toBe(3)
    expect(radioPaceRowsThisChange(p, () => 0.5)).toBe(2)
  })
})

describe('radioPaceLabel', () => {
  it('words at the anchors and through ludicrous; bar lines in the mid-loop band; the window between', () => {
    expect(radioPaceLabel(0)).toBe('slow')
    expect(radioPaceLabel(25)).toBe('mid')
    expect(radioPaceLabel(50)).toBe('fast')
    expect(radioPaceLabel(90)).toBe('ludicrous')
    expect(radioPaceLabel(100)).toBe('ludicrous')
    expect(radioPaceLabel(80)).toBe('every 4 bars')
    expect(radioPaceLabel(88)).toBe('every 2 bars')
    expect(radioPaceLabel(60)).toBe('2-4 bars')
    expect(radioPaceLabel(12)).toMatch(/^\d+-\d+ bars$/)
  })
})

describe('radioPaceLevelFromLegacy', () => {
  it('a preset word is its anchor, with or without its own window', () => {
    expect(radioPaceLevelFromLegacy('slow')).toBe(0)
    expect(radioPaceLevelFromLegacy('mid', { min: 8, max: 16 })).toBe(25)
    expect(radioPaceLevelFromLegacy('fast', { ...RADIO_PACE_BARS.fast })).toBe(50)
    expect(radioPaceLevelFromLegacy(undefined)).toBe(DEFAULT_RADIO_PACE_LEVEL)
    expect(radioPaceLevelFromLegacy('nonsense', 'nonsense')).toBe(DEFAULT_RADIO_PACE_LEVEL)
  })

  it("a hand-tuned window is the nearest level at or below fast; another preset's window is that preset", () => {
    expect(radioPaceLevelFromLegacy('mid', { min: 3, max: 6 })).toBe(50)
    const between = radioPaceLevelFromLegacy('mid', { min: 12, max: 24 })
    expect(between).toBeGreaterThan(0)
    expect(between).toBeLessThan(25)
    expect(radioPaceLevelFromLegacy('fast', { min: 1, max: 2 })).toBe(50)
    expect(radioPaceLevelFromLegacy('slow', { min: 64, max: 64 })).toBe(0)
  })
})

describe('nextRadioPaceAnchor', () => {
  it('slow -> mid -> fast -> ludicrous -> slow, from wherever the level is', () => {
    expect(nextRadioPaceAnchor(0)).toBe(25)
    expect(nextRadioPaceAnchor(25)).toBe(50)
    expect(nextRadioPaceAnchor(50)).toBe(90)
    expect(nextRadioPaceAnchor(90)).toBe(0)
    expect(nextRadioPaceAnchor(33)).toBe(50)
    expect(nextRadioPaceAnchor(95)).toBe(0)
  })
})
```

- [ ] **Step 2: Run it and see it fail.**

Run: `cd /Users/nickel/Claudecode/sssketch && npx vitest run src/shared/radioPace.test.ts`
Expected: FAIL. `./radioPace` does not exist.

- [ ] **Step 3: Write the implementation.**

```ts
// src/shared/radioPace.ts
//
// THE PACE SLIDER (docs/superpowers/specs/2026-10-03-radio-pace-slider-design.md). One number,
// 0..100, replaces the slow / mid / fast chips in both radios. radioPaceProfile maps it to
// everything that sets how often radio changes something:
//
//   window    the bars drawn for each interval (geometric between knots, whole bars)
//   phrase    a cap on the phrase grid a change may land on (16 -> 8 -> 4 -> every loop top)
//   barEvery  in the top band, a change may land MID-LOOP on a bar line this many bars apart,
//             whatever the stems' lengths (Elling, 2026-10-03: "extreme should be extreme ... yes
//             mid loop is fine")
//   rows      how many rows one change turns over (fractional: the remainder is a chance)
//
// The three old chips are fixed positions and reproduce today exactly: slow 0, mid 25, fast 50.
// Pure numbers: this module imports nothing at runtime, so radioSchedule can import it.

import type { RadioPace } from './radioSchedule'

export const RADIO_PACE_LEVEL_MIN = 0
export const RADIO_PACE_LEVEL_MAX = 100

/** The words the readout uses at their positions. */
export type RadioPaceWord = 'slow' | 'mid' | 'fast' | 'ludicrous'

/** Where today's chips sit, and where `ludicrous` starts. slow/mid/fast reproduce
 * RADIO_PACE_BARS exactly (window, phrase, one row); half the slider is above today's fast,
 * because that is the territory Elling is asking to explore. */
export const RADIO_PACE_ANCHORS: Readonly<Record<RadioPaceWord, number>> = Object.freeze({
  slow: 0,
  mid: 25,
  fast: 50,
  ludicrous: 90
})

/** The desktop's default (its old default chip, mid). The web starts at fast. */
export const DEFAULT_RADIO_PACE_LEVEL = RADIO_PACE_ANCHORS.mid

/** The drawn window at each knot: [level, min bars, max bars]. Between knots each edge is
 * interpolated geometrically (bars are a ratio scale: 3 -> 6 is as big a step as 24 -> 48) and
 * rounded to whole bars. The first three knots are RADIO_PACE_BARS' slow, mid and fast. */
export const RADIO_PACE_WINDOW_KNOTS: readonly (readonly [number, number, number])[] =
  Object.freeze([
    [0, 24, 48],
    [25, 8, 16],
    [50, 3, 6],
    [60, 2, 4],
    [70, 1, 2],
    [100, 1, 1]
  ] as const)

/** The phrase cap above fast: at or below each level, the phrase is at most that many bars
 * (0 = no phrase grid: every loop top). The runtime's own phrase (the web's 16, the desktop's
 * `phrase` chip) applies at fast and below. */
export const RADIO_PACE_PHRASE_CAPS: readonly (readonly [number, number])[] = Object.freeze([
  [60, 8],
  [70, 4]
] as const)

/** From this level up, changes may land mid-loop on bar lines: every 4 bars, then 2, then 1. */
export const RADIO_PACE_BAR_BANDS: readonly (readonly [number, number])[] = Object.freeze([
  [80, 4],
  [87, 2],
  [94, 1]
] as const)

/** Rows per change: 1 up to this level, then rising linearly to RADIO_PACE_ROWS_MAX at 100. */
export const RADIO_PACE_ROWS_FROM = 70
export const RADIO_PACE_ROWS_MAX = 4

export interface RadioPaceProfile {
  level: number
  /** The interval window, whole bars, min <= max. */
  window: { min: number; max: number }
  /** The phrase cap, in bars: null = the runtime's own phrase; 0 = every loop top. */
  phraseCap: number | null
  /** Mid-loop landings on bar lines this many bars apart, or null (loop tops / own cycles). */
  barEvery: number | null
  /** Rows per change, 1..RADIO_PACE_ROWS_MAX; the fraction is the chance of one more. */
  rows: number
}

/** 0..100, whole numbers. Anything that is not a finite number: `fallback`. */
export function normalizeRadioPaceLevel(
  value: unknown,
  fallback = DEFAULT_RADIO_PACE_LEVEL
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.round(Math.min(RADIO_PACE_LEVEL_MAX, Math.max(RADIO_PACE_LEVEL_MIN, value)))
}

function geo(a: number, b: number, t: number): number {
  return Math.exp(Math.log(a) + (Math.log(b) - Math.log(a)) * t)
}

function windowAt(level: number): { min: number; max: number } {
  const knots = RADIO_PACE_WINDOW_KNOTS
  let i = 0
  while (i < knots.length - 2 && level > knots[i + 1][0]) i++
  const [l0, min0, max0] = knots[i]
  const [l1, min1, max1] = knots[i + 1]
  const t = Math.min(1, Math.max(0, (level - l0) / (l1 - l0)))
  const min = Math.max(1, Math.round(geo(min0, min1, t)))
  return { min, max: Math.max(min, Math.round(geo(max0, max1, t))) }
}

/** Everything the slider sets, at `level` (normalised first). Pure, no randomness. */
export function radioPaceProfile(level: number): RadioPaceProfile {
  const p = normalizeRadioPaceLevel(level)
  let phraseCap: number | null = null
  if (p > RADIO_PACE_ANCHORS.fast) {
    phraseCap = 0
    for (const [upTo, bars] of RADIO_PACE_PHRASE_CAPS) {
      if (p <= upTo) {
        phraseCap = bars
        break
      }
    }
  }
  let barEvery: number | null = null
  for (const [from, bars] of RADIO_PACE_BAR_BANDS) if (p >= from) barEvery = bars
  const rows =
    p <= RADIO_PACE_ROWS_FROM
      ? 1
      : 1 +
        ((RADIO_PACE_ROWS_MAX - 1) * (p - RADIO_PACE_ROWS_FROM)) /
          (RADIO_PACE_LEVEL_MAX - RADIO_PACE_ROWS_FROM)
  return { level: p, window: windowAt(p), phraseCap, barEvery, rows }
}

/** The phrase a change may land on: the runtime's own `basePhraseBars` (0 = none) under the
 * profile's cap. A base of 0 stays 0 -- there is nothing to shorten -- and a cap of 0 removes the
 * grid. Turnarounds never read this: they keep the base (radioCadence's turnaroundPhraseBars). */
export function radioPacePhraseBars(profile: RadioPaceProfile, basePhraseBars: number): number {
  if (!(basePhraseBars > 0)) return 0
  if (profile.phraseCap === null) return basePhraseBars
  if (profile.phraseCap === 0) return 0
  return Math.min(basePhraseBars, profile.phraseCap)
}

/** How many rows THIS change turns over: floor(rows), plus one with the fraction's chance.
 * Never calls `random` when rows is whole, so at every level up to RADIO_PACE_ROWS_FROM a seeded
 * radio's random stream is exactly what it was before the slider. */
export function radioPaceRowsThisChange(
  profile: Pick<RadioPaceProfile, 'rows'>,
  random: () => number
): number {
  const whole = Math.floor(profile.rows)
  const frac = profile.rows - whole
  if (frac <= 0) return whole
  return whole + (random() < frac ? 1 : 0)
}

/** The readout: the word at its position (slow, mid, fast) and through the ludicrous band; the
 * bar line cadence in the mid-loop band; the drawn window otherwise. Lowercase, short enough for
 * a phone. */
export function radioPaceLabel(level: number): string {
  const profile = radioPaceProfile(level)
  const p = profile.level
  if (p >= RADIO_PACE_ANCHORS.ludicrous) return 'ludicrous'
  if (p === RADIO_PACE_ANCHORS.slow) return 'slow'
  if (p === RADIO_PACE_ANCHORS.mid) return 'mid'
  if (p === RADIO_PACE_ANCHORS.fast) return 'fast'
  if (profile.barEvery !== null)
    return profile.barEvery === 1 ? 'every bar' : `every ${profile.barEvery} bars`
  const { min, max } = profile.window
  return min === max ? `${min} bar${min === 1 ? '' : 's'}` : `${min}-${max} bars`
}

export const RADIO_PACE_LABEL = 'pace'
export const RADIO_PACE_TOOLTIP = 'how often radio changes something'

/** The level a pre-slider setting means. A preset word is its anchor. A window (the desktop's
 * hand-tuned min/max steppers) is the level whose window is nearest in log space -- the same
 * ratio scale the knots interpolate on -- searched only up to fast, where the window is the only
 * thing that differs, so a migrated window never quietly turns on a shorter phrase, mid-loop
 * landings or extra rows. A window equal to any preset's is that preset; no usable window is the
 * word's own anchor. */
export function radioPaceLevelFromLegacy(pace: unknown, window?: unknown): number {
  const word: RadioPace | null =
    pace === 'slow' || pace === 'mid' || pace === 'fast' ? (pace as RadioPace) : null
  const anchor = word === null ? DEFAULT_RADIO_PACE_LEVEL : RADIO_PACE_ANCHORS[word]
  const raw = (typeof window === 'object' && window !== null ? window : {}) as {
    min?: unknown
    max?: unknown
  }
  const min = Number(raw.min)
  const max = Number(raw.max)
  if (!Number.isFinite(min) || !Number.isFinite(max) || min < 1 || max < min) return anchor
  // A window that IS a preset's (his own chip's, or one he stepped back onto) is that preset.
  for (const w of ['slow', 'mid', 'fast'] as const) {
    const at = radioPaceProfile(RADIO_PACE_ANCHORS[w]).window
    if (at.min === min && at.max === max) return RADIO_PACE_ANCHORS[w]
  }
  // Otherwise the nearest. Rounding makes neighbouring levels share a window, so a tie is
  // common: an anchor among the tied levels wins (a window past fast's is fast, not 48), else the
  // slowest of them.
  const anchors: readonly number[] = [
    RADIO_PACE_ANCHORS.slow,
    RADIO_PACE_ANCHORS.mid,
    RADIO_PACE_ANCHORS.fast
  ]
  let best = anchor
  let bestDistance = Number.POSITIVE_INFINITY
  for (let p = RADIO_PACE_LEVEL_MIN; p <= RADIO_PACE_ANCHORS.fast; p++) {
    const w = radioPaceProfile(p).window
    const d = Math.abs(Math.log(w.min / min)) + Math.abs(Math.log(w.max / max))
    const tie = Math.abs(d - bestDistance) <= 1e-12
    if (d < bestDistance - 1e-12 || (tie && anchors.includes(p) && !anchors.includes(best))) {
      best = p
      bestDistance = Math.min(d, bestDistance)
    }
  }
  return best
}

/** The web's simple-mode cycle (controlsModel's `pace` control): slow -> mid -> fast ->
 * ludicrous -> slow, from the first anchor above the level. */
export function nextRadioPaceAnchor(level: number): number {
  const p = normalizeRadioPaceLevel(level)
  const order = [
    RADIO_PACE_ANCHORS.slow,
    RADIO_PACE_ANCHORS.mid,
    RADIO_PACE_ANCHORS.fast,
    RADIO_PACE_ANCHORS.ludicrous
  ]
  return order.find((a) => a > p) ?? order[0]
}
```

- [ ] **Step 4: Run the tests and see them pass.**

Run: `npx vitest run src/shared/radioPace.test.ts`
Expected: 15 passed.

- [ ] **Step 5: Lint and typecheck.**

Run: `npx eslint --fix src/shared/radioPace.ts src/shared/radioPace.test.ts && npm run typecheck`
Expected: clean.

- [ ] **Step 6: Commit.**

```bash
git add src/shared/radioPace.ts src/shared/radioPace.test.ts
git commit -m "radio pace: the slider's profile (@shared/radioPace) -- one level 0..100 mapped to the interval window (geometric between knots; slow 0, mid 25, fast 50 reproduce RADIO_PACE_BARS), a phrase cap above fast (8, 4, every top), mid-loop bar lines from 80 (4, 2, 1 bars) and rows per change from 70 (to 4 at 100), its readout words, and the migration from a chip and a hand-tuned window

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz"
```

---

### Task 2: Cadence, the decoupled turnaround phrase, and the clock on a move (`radioSchedule.ts`)

**Files:**
- Modify: `/Users/nickel/Claudecode/sssketch/src/shared/radioSchedule.ts`
- Create: `/Users/nickel/Claudecode/sssketch/src/shared/radioCadence.test.ts`
- Modify: `/Users/nickel/Claudecode/sssketch/src/shared/radioSchedule.test.ts`, which gains `paceLevel` in three `toEqual`s.
- Modify: `/Users/nickel/Claudecode/sssketch/src/main/discoverSettingsStore.test.ts`, the same.

**Depends on:** Task 1.

**What it adds:**
- `RadioSettings.paceLevel?`, with its default (mid) and its migration in `normalizeRadioSettings`.
- `radioPaceLevelOf` and `radioCadenceOf`.
- `radioPaceGridBars` and `radioGridLineAtOrAfter`.
- `radioCadenceTransition` and `radioClockForPace`.
- `pickRadioSlotIds`.
- `advanceRadioClock`'s sixth argument, `turnaroundPhraseBars`, defaulting to `phraseBars`.

**Timing risks:**
1. **`advanceRadioClock`'s new argument must change nothing for existing callers.** The first test pins the five-argument call to the six-argument one.
2. **`radioClockForPace`'s re-anchor** is the one piece of new clock arithmetic. The property test runs it after 1, 2, 3 and 5 laps on 1-, 2-, 4- and 8-bar loops. A companion test shows the drift that happens without it.
3. **`pickRadioSlotIds` at count 1 must make exactly `pickRadioSlotId`'s random draws.** Tested over 50 seeds, including the next draw after it.

- [ ] **Step 1: Write the failing tests.**

Create `src/shared/radioCadence.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_RADIO_SETTINGS,
  RADIO_PACE_BARS,
  advanceRadioClock,
  createRadioClock,
  normalizeRadioSettings,
  pickRadioSlotId,
  pickRadioSlotIds,
  radioCadenceOf,
  radioCadenceTransition,
  radioClockForPace,
  radioGridBars,
  radioGridLineAtOrAfter,
  radioPaceGridBars,
  radioPaceLevelOf,
  type RadioClock,
  type RadioSettings
} from './radioSchedule'
import { FOLD_PACE_BARS } from './radioFold'
import { RADIO_PACE_ANCHORS } from './radioPace'

/** mulberry32 -- a small seeded PRNG. */
function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Run the clock at 30Hz for `laps` laps of a `loopBars` loop at 120bpm (a tick = 1/15 bar),
 * restarting the interval at every due as both radios do. */
function run(
  clock: RadioClock,
  laps: number,
  loopBars: number,
  phraseBars: number,
  turnaroundPhraseBars: number,
  intervalBars = 1
): { dues: number[]; dueLaps: number[]; turnaroundStarts: number[]; clock: RadioClock } {
  const dues: number[] = []
  const dueLaps: number[] = []
  const turnaroundStarts: number[] = []
  const tick = 1 / 15
  let total = 0
  let pos = clock.lastPos
  let c = clock
  for (let i = 0; i < Math.round((laps * loopBars) / tick); i++) {
    total += tick
    pos = (pos + tick) % loopBars
    const step = advanceRadioClock(c, pos, loopBars, loopBars, phraseBars, turnaroundPhraseBars)
    c = step.clock
    if (step.turnaroundLapStarts) turnaroundStarts.push(Math.round(total))
    if (step.due) {
      dues.push(Math.round(total))
      dueLaps.push(c.turnaroundLap ?? 0)
      c = { ...c, barsElapsed: 0, intervalBars }
    }
  }
  return { dues, dueLaps, turnaroundStarts, clock: c }
}

describe('advanceRadioClock: the turnaround phrase, decoupled', () => {
  it('defaults to the change phrase, so every existing caller is unchanged', () => {
    const a = run(createRadioClock(1, 0), 16, 4, 16, 16)
    const b = (() => {
      // the five-argument call, as every caller made it before
      const dues: number[] = []
      let c = createRadioClock(1, 0)
      let pos = 0
      let total = 0
      for (let i = 0; i < 16 * 4 * 15; i++) {
        total += 1 / 15
        pos = (pos + 1 / 15) % 4
        const s = advanceRadioClock(c, pos, 4, 4, 16)
        c = s.clock
        if (s.due) {
          dues.push(Math.round(total))
          c = { ...c, barsElapsed: 0, intervalBars: 1 }
        }
      }
      return dues
    })()
    expect(a.dues).toEqual(b)
  })

  it('a 4-bar change phrase changes every lap while turnarounds keep 16 bars', () => {
    const r = run(createRadioClock(1, 0), 16, 4, 4, 16)
    expect(r.dues).toEqual([4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64])
    // the last lap of each 16-bar phrase starts at bar 12, 28, ...
    expect(r.turnaroundStarts).toEqual([12, 28, 44, 60])
  })
})

describe('RadioSettings.paceLevel', () => {
  it('defaults to mid, and old settings migrate', () => {
    expect(DEFAULT_RADIO_SETTINGS.paceLevel).toBe(RADIO_PACE_ANCHORS.mid)
    expect(normalizeRadioSettings({}).paceLevel).toBe(RADIO_PACE_ANCHORS.mid)
    expect(normalizeRadioSettings({ pace: 'fast' }).paceLevel).toBe(RADIO_PACE_ANCHORS.fast)
    expect(normalizeRadioSettings({}, 'slow').paceLevel).toBe(RADIO_PACE_ANCHORS.slow)
    expect(normalizeRadioSettings({ pace: 'mid', paceBars: { min: 3, max: 6 } }).paceLevel).toBe(50)
    expect(normalizeRadioSettings({ pace: 'slow', paceLevel: 72 }).paceLevel).toBe(72)
    expect(normalizeRadioSettings({ paceLevel: 400 }).paceLevel).toBe(100)
  })

  it("radioPaceLevelOf reads a RadioSettings built without it (the web's) from its chip", () => {
    const web: RadioSettings = {
      ...DEFAULT_RADIO_SETTINGS,
      pace: 'fast',
      paceBars: { ...RADIO_PACE_BARS.fast },
      paceLevel: undefined
    }
    expect(radioPaceLevelOf(web)).toBe(RADIO_PACE_ANCHORS.fast)
    expect(radioPaceLevelOf({ ...web, paceLevel: 93 })).toBe(93)
  })
})

describe('radioCadenceOf', () => {
  const at = (paceLevel: number, phraseBars: number, foldMode = false): RadioSettings => ({
    ...DEFAULT_RADIO_SETTINGS,
    paceLevel,
    phraseBars,
    foldMode
  })

  it("reproduces today at the anchors: the chip's window, the runtime's phrase, one row", () => {
    for (const word of ['slow', 'mid', 'fast'] as const) {
      for (const base of [0, 16, 32]) {
        const c = radioCadenceOf(at(RADIO_PACE_ANCHORS[word], base))
        expect(c.window).toEqual(RADIO_PACE_BARS[word])
        expect(c.phraseBars).toBe(base)
        expect(c.turnaroundPhraseBars).toBe(base)
        expect(c.barEvery).toBeNull()
        expect(c.rows).toBe(1)
      }
    }
  })

  it('shortens the change phrase above fast; the turnaround phrase never moves', () => {
    for (let level = 0; level <= 100; level++) {
      const c = radioCadenceOf(at(level, 16))
      expect(c.turnaroundPhraseBars).toBe(16)
      expect(c.phraseBars).toBeLessThanOrEqual(16)
    }
    expect(radioCadenceOf(at(55, 16)).phraseBars).toBe(8)
    expect(radioCadenceOf(at(75, 16)).phraseBars).toBe(0)
  })

  it('no level: exactly the old reading -- the pinned window, the phrase, one row', () => {
    const legacy: RadioSettings = {
      ...DEFAULT_RADIO_SETTINGS,
      paceLevel: undefined,
      paceBars: { min: 4, max: 4 },
      phraseBars: 16
    }
    expect(radioCadenceOf(legacy)).toEqual({
      level: radioPaceLevelOf(legacy),
      window: { min: 4, max: 4 },
      phraseBars: 16,
      turnaroundPhraseBars: 16,
      barEvery: null,
      rows: 1
    })
  })

  it('fold mode keeps its own window, tops, one row', () => {
    const c = radioCadenceOf(at(100, 16, true))
    expect(c.window).toEqual(FOLD_PACE_BARS)
    expect(c.phraseBars).toBe(16)
    expect(c.barEvery).toBeNull()
    expect(c.rows).toBe(1)
  })
})

describe('radioPaceGridBars', () => {
  it('below the bar band it is radioGridBars', () => {
    for (const [loopEnd, loop, out, inc] of [
      [4, 8, 2, 2],
      [4, 8, 8, 2],
      [0, 8, 2, 2],
      [4, 8, null, 2]
    ] as const) {
      expect(radioPaceGridBars(null, loopEnd, loop, out, inc)).toBe(
        radioGridBars(loopEnd, loop, out === null || inc === null ? null : Math.max(out, inc))
      )
    }
  })

  it('in the band any stem no longer than the loop lands on the bar lines, stepped to divide the loop', () => {
    expect(radioPaceGridBars(4, 0, 8, 8, 8)).toBe(4)
    expect(radioPaceGridBars(2, 0, 8, 8, 8)).toBe(2)
    expect(radioPaceGridBars(1, 4, 8, 8, 8)).toBe(1)
    expect(radioPaceGridBars(4, 0, 6, 6, 6)).toBe(3)
    expect(radioPaceGridBars(4, 0, 2, 2, 2)).toBe(2)
    // a finer own cycle (a 1-bar stem under loop end 4) is kept
    expect(radioPaceGridBars(4, 4, 8, 1, 1)).toBe(1)
    // fractional stems enter at their matching position too
    expect(radioPaceGridBars(2, 0, 8, 8, 1.5)).toBe(2)
  })

  it('an unknown or longer incoming stem, or a fractional loop, still waits for the top', () => {
    expect(radioPaceGridBars(1, 0, 8, 8, null)).toBe(8)
    expect(radioPaceGridBars(1, 0, 4, 4, 8)).toBe(4)
    expect(radioPaceGridBars(1, 0, 2.5, 2.5, 2)).toBe(2.5)
  })
})

describe('radioGridLineAtOrAfter', () => {
  it('the next line in the lap, else the wrap', () => {
    expect(radioGridLineAtOrAfter(0.2, 1, 8)).toBe(1)
    expect(radioGridLineAtOrAfter(2, 2, 8)).toBe(2)
    expect(radioGridLineAtOrAfter(2.0000000001, 2, 8)).toBe(2)
    expect(radioGridLineAtOrAfter(6.5, 2, 8)).toBe(8)
    expect(radioGridLineAtOrAfter(7.9, 4, 8)).toBe(8)
    expect(radioGridLineAtOrAfter(3, 0, 8)).toBe(8)
  })
})

describe('radioCadenceTransition', () => {
  it('mid-loop in the bar band is a cut; a loop top keeps its transition; below the band nothing changes', () => {
    expect(radioCadenceTransition({ barEvery: 1 }, 'bloom', false)).toBe('cut')
    expect(radioCadenceTransition({ barEvery: 1 }, 'bloom', true)).toBe('bloom')
    expect(radioCadenceTransition({ barEvery: null }, 'bloom', false)).toBe('bloom')
  })
})

describe('radioClockForPace', () => {
  const clock = (over: Partial<RadioClock>): RadioClock => ({
    ...createRadioClock(12, 1.5),
    ...over
  })
  const cadence = (
    min: number,
    max: number,
    phraseBars: number,
    turnaroundPhraseBars = 16
  ): {
    window: { min: number; max: number }
    phraseBars: number
    turnaroundPhraseBars: number
  } => ({
    window: { min, max },
    phraseBars,
    turnaroundPhraseBars
  })

  it('redraws the interval only when it is longer than the new window; elapsed bars kept', () => {
    const random = vi.fn(() => 0)
    const faster = radioClockForPace(
      clock({ intervalBars: 40, barsElapsed: 7 }),
      cadence(1, 2, 0),
      4,
      random
    )
    expect(faster.intervalBars).toBe(1)
    expect(faster.barsElapsed).toBe(7)
    expect(random).toHaveBeenCalledTimes(1)
    const slower = radioClockForPace(clock({ intervalBars: 3 }), cadence(24, 48, 16), 4, random)
    expect(slower.intervalBars).toBe(3)
    expect(random).toHaveBeenCalledTimes(1)
  })

  it('re-anchors the change phrase on the turnaround phrase when it divides it', () => {
    // a 4-bar loop, lap 2 of the 16-bar turnaround phrase, change phrase counter out of step
    const c = clock({ turnaroundLap: 2, lapsSincePhrase: 0 })
    expect(radioClockForPace(c, cadence(3, 6, 8), 4).lapsSincePhrase).toBe(0) // 2 % 2
    expect(radioClockForPace(c, cadence(3, 6, 16), 4).lapsSincePhrase).toBe(2)
    expect(radioClockForPace({ ...c, turnaroundLap: 3 }, cadence(3, 6, 8), 4).lapsSincePhrase).toBe(
      1
    )
    // no change phrase: left alone (advanceRadioClock zeroes it)
    expect(
      radioClockForPace({ ...c, lapsSincePhrase: 5 }, cadence(1, 2, 0), 4).lapsSincePhrase
    ).toBe(5)
  })

  it('after a mid-stream move, a change phrase top is a turnaround phrase top (or a division of one)', () => {
    const random = seeded(7)
    for (const loop of [1, 2, 4, 8]) {
      for (const laps of [1, 2, 3, 5]) {
        // a 4-bar change phrase for a few laps, then slowed to 16: every change lands on lap 0
        // of the turnaround's phrase, where a phrase end's turnaround leads into it
        let r = run(createRadioClock(1, 0), laps, loop, 4, 16)
        r = run(
          radioClockForPace(r.clock, cadence(3, 6, 16), loop, random),
          64 / loop,
          loop,
          16,
          16
        )
        expect(r.dues.length).toBeGreaterThan(0)
        expect(r.dueLaps.every((l) => l === 0)).toBe(true)
        // and sped up to 8: every change on an even lap of it
        r = run(radioClockForPace(r.clock, cadence(3, 6, 8), loop, random), 64 / loop, loop, 8, 16)
        const per = Math.max(1, Math.round(8 / loop))
        expect(r.dueLaps.every((l) => l % per === 0)).toBe(true)
      }
    }
  })

  it('without the re-anchor, a phrase that grows mid-stream drifts off the turnarounds (why it exists)', () => {
    let r = run(createRadioClock(1, 0), 3, 4, 4, 16)
    r = run(r.clock, 16, 4, 16, 16)
    expect(r.dueLaps.some((l) => l !== 0)).toBe(true)
  })
})

describe('pickRadioSlotIds', () => {
  it("count 1 is pickRadioSlotId's answer with the same random calls", () => {
    for (let seed = 0; seed < 50; seed++) {
      const ids = ['a', 'b', 'c', 'd']
      const opts = { turnover: 'even' as const, changedAt: new Map([['a', 1]]), turn: 4 }
      const r1 = seeded(seed)
      const r2 = seeded(seed)
      expect(pickRadioSlotIds(ids, 'b', 1, { ...opts, random: r1 })).toEqual([
        pickRadioSlotId(ids, 'b', { ...opts, random: r2 })
      ])
      expect(r1()).toBe(r2())
    }
  })

  it('distinct rows, at most the eligible ones, none for none', () => {
    const r = seeded(3)
    const got = pickRadioSlotIds(['a', 'b', 'c'], null, 5, { random: r })
    expect(new Set(got).size).toBe(3)
    expect(pickRadioSlotIds([], null, 3)).toEqual([])
    expect(pickRadioSlotIds(['a', 'b'], 'a', 0)).toEqual([])
  })
})
```

Update the three whole-object assertions that now include `paceLevel`:

```diff
--- a/src/shared/radioSchedule.test.ts
+++ b/src/shared/radioSchedule.test.ts
@@ -1096,7 +1096,8 @@
       clash: 25,
       foldSeed: 'autech',
       density: 'arc',
-      faves: 0
+      faves: 0,
+      paceLevel: 25
     })
   })
 
@@ -1105,6 +1106,7 @@
       ...DEFAULT_RADIO_SETTINGS,
       pace: 'fast',
       paceBars: RADIO_PACE_BARS.fast,
+      paceLevel: 50,
       loopEndOverBars: 2,
       channels: 6
     })
@@ -1164,7 +1166,8 @@
     expect(normalizeRadioSettings(undefined, 'fast')).toEqual({
       ...DEFAULT_RADIO_SETTINGS,
       pace: 'fast',
-      paceBars: RADIO_PACE_BARS.fast
+      paceBars: RADIO_PACE_BARS.fast,
+      paceLevel: 50
     })
     expect(normalizeRadioSettings(undefined, 'glacial').pace).toBe('mid')
     expect(normalizeRadioSettings({ pace: 'slow' }, 'fast').pace).toBe('slow')
```

```diff
--- a/src/main/discoverSettingsStore.test.ts
+++ b/src/main/discoverSettingsStore.test.ts
@@ -130,7 +130,8 @@
         clash: 60,
         foldSeed: 'k3x9pq',
         density: 'off',
-        faves: 60
+        faves: 60,
+        paceLevel: 42
       }
     })
     expect(loadDiscoverSettings().radio).toEqual({
@@ -149,7 +150,8 @@
       clash: 60,
       foldSeed: 'k3x9pq',
       density: 'off',
-      faves: 60
+      faves: 60,
+      paceLevel: 42
     })
   })
 
@@ -177,6 +179,7 @@
       ...DEFAULT_RADIO_SETTINGS,
       pace: 'fast',
       paceBars: { min: 3, max: 6 },
+      paceLevel: 50,
       foldSeed: expect.stringMatching(FOLD_SEED)
     })
   })
@@ -205,6 +208,7 @@
       ...DEFAULT_RADIO_SETTINGS,
       pace: 'fast',
       paceBars: { min: 3, max: 6 },
+      paceLevel: 50,
       loopEndOverBars: 0,
       foldSeed: expect.stringMatching(FOLD_SEED)
     })
```

- [ ] **Step 2: Run them and see them fail.**

Run: `npx vitest run src/shared/radioCadence.test.ts src/shared/radioSchedule.test.ts src/main/discoverSettingsStore.test.ts`
Expected: FAIL. The new exports are missing, and `paceLevel` is absent from the settings.

- [ ] **Step 3: Implement.**

Apply this to `src/shared/radioSchedule.ts`:

```diff
--- a/src/shared/radioSchedule.ts
+++ b/src/shared/radioSchedule.ts
@@ -35,8 +35,16 @@
 import {
   DEFAULT_RADIO_TRANSITIONS,
   normalizeRadioTransitions,
+  type RadioTransitionKind,
   type RadioTransitions
 } from './radioTransition'
+import {
+  DEFAULT_RADIO_PACE_LEVEL,
+  normalizeRadioPaceLevel,
+  radioPaceLevelFromLegacy,
+  radioPacePhraseBars,
+  radioPaceProfile
+} from './radioPace'
 
 /** The three speeds radio can run at. Literal values double as their own
  * UI text (the same convention DISCOVER_SLOT_KIND_OPTIONS uses for its
@@ -454,13 +462,17 @@
  * the slot that is about to change; passing loopBars reproduces the
  * pre-2026-09-28 behaviour exactly. `phraseBars` is the phrase ceiling
  * (RadioSettings.phraseBars); 0 is no phrase grid, which is the default
- * and changes nothing. */
+ * and changes nothing. `turnaroundPhraseBars` is the TURNAROUND's phrase (radioTurnaround's
+ * turnaroundPhraseLaps: 16 when 0), which defaults to `phraseBars` -- the two were one number until
+ * the pace slider (2026-10-03), which shortens the change phrase above fast while turnarounds keep
+ * the runtime's own (radioCadence.turnaroundPhraseBars). */
 export function advanceRadioClock(
   clock: RadioClock,
   pos: number,
   loopBars: number,
   gridBars: number = loopBars,
-  phraseBars: number = 0
+  phraseBars: number = 0,
+  turnaroundPhraseBars: number = phraseBars
 ): RadioClockStep {
   if (!(loopBars > 0) || !Number.isFinite(pos)) {
     return { clock, wrapped: false, due: false, turnaroundLapStarts: false }
@@ -500,7 +512,7 @@
   }
   // The turnaround's own count: every wrap, whatever phraseBars is, folding back to 0 at the
   // phrase end (and from anywhere above the phrase, should the loop have grown under it).
-  const perTurnaround = turnaroundPhraseLaps(phraseBars, loopBars)
+  const perTurnaround = turnaroundPhraseLaps(turnaroundPhraseBars, loopBars)
   let turnaroundLap = clock.turnaroundLap ?? 0
   if (wrapped) {
     turnaroundLap += 1
@@ -1080,6 +1092,10 @@
    * set this one value. Optional for the same reason as `density`; normalizeRadioSettings
    * always sets it, and absent reads as 0 (radioFavesOf). */
   faves?: number
+  /** The pace slider (@shared/radioPace), 0..100. Optional for the same reason as `density`;
+   * normalizeRadioSettings always sets it (migrating `pace` and a hand-tuned `paceBars`), and
+   * absent reads as what `pace` / `paceBars` mean (radioPaceLevelOf). */
+  paceLevel?: number
 }
 
 export function radioDensityOf(settings: RadioSettings): RadioDensity {
@@ -1106,7 +1122,8 @@
   clash: DEFAULT_RADIO_CLASH,
   foldSeed: DEFAULT_FOLD_SEED,
   density: DEFAULT_RADIO_DENSITY,
-  faves: DEFAULT_FAVES
+  faves: DEFAULT_FAVES,
+  paceLevel: DEFAULT_RADIO_PACE_LEVEL
 }
 
 /** The window the clock draws a change's interval from: fold mode's own (FOLD_PACE_BARS, 16-64
@@ -1166,6 +1183,181 @@
     foldSeed: normalizeFoldSeed(raw.foldSeed),
     density: normalizeRadioDensity(raw.density),
     // A saved `prefer faves: on` (the switch this replaced) reads as 50; a saved faves wins.
-    faves: normalizeFaves(raw.faves, (value as { preferFaves?: unknown } | null)?.preferFaves)
+    faves: normalizeFaves(raw.faves, (value as { preferFaves?: unknown } | null)?.preferFaves),
+    // The slider (2026-10-03): a saved level wins; otherwise the chip (or the flat 1.3.0
+    // radioPace) and any hand-tuned window become the nearest level (radioPaceLevelFromLegacy).
+    paceLevel:
+      typeof raw.paceLevel === 'number' && Number.isFinite(raw.paceLevel)
+        ? normalizeRadioPaceLevel(raw.paceLevel)
+        : radioPaceLevelFromLegacy(pace, raw.paceBars)
+  }
+}
+
+/** The slider's level for these settings: `paceLevel`, or -- for a RadioSettings built before it
+ * existed (the web radio's own objects) -- what its `pace` chip and window mean. */
+export function radioPaceLevelOf(settings: RadioSettings): number {
+  return settings.paceLevel !== undefined
+    ? normalizeRadioPaceLevel(settings.paceLevel)
+    : radioPaceLevelFromLegacy(settings.pace, settings.paceBars)
+}
+
+/** Everything that sets radio's cadence, for both radios, from one place: the slider's profile
+ * applied to the runtime's own phrase (`settings.phraseBars`: the web's 16, the desktop's chip),
+ * with fold mode's override. Fold mode keeps today's rule -- its own window (FOLD_PACE_BARS)
+ * replaces the pace's, changes land on tops, one row at a time -- so the slider does nothing
+ * while fold is on.
+ *
+ * A RadioSettings with NO `paceLevel` is read exactly as before the slider: its `paceBars` window,
+ * the runtime's phrase, one row, no mid-loop landings. That is every RadioSettings the web radio
+ * builds without the listener's level (its tests pin a window that way), and it is why the web
+ * can move to the slider without any of its timing tests changing meaning. The desktop's
+ * normalizeRadioSettings always sets a level. */
+export interface RadioCadence {
+  level: number
+  /** The interval window (nextRadioIntervalBarsInWindow). */
+  window: RadioPaceWindow
+  /** The CHANGE phrase: advanceRadioClock's / radioChangeDueAtNextWrap's `phraseBars`. */
+  phraseBars: number
+  /** The TURNAROUND phrase: advanceRadioClock's `turnaroundPhraseBars`, radioReadoutBars'. Never
+   * moved by the slider, so turnarounds keep their 16 (or the desktop chip's) at every pace. */
+  turnaroundPhraseBars: number
+  /** Mid-loop landings on bar lines this many bars apart (radioPaceGridBars), or null. */
+  barEvery: number | null
+  /** Rows per change (radioPaceRowsThisChange). */
+  rows: number
+}
+
+export function radioCadenceOf(settings: RadioSettings): RadioCadence {
+  const base = settings.phraseBars
+  const level = radioPaceLevelOf(settings)
+  if (settings.foldMode) {
+    return {
+      level,
+      window: { ...FOLD_PACE_BARS },
+      phraseBars: base,
+      turnaroundPhraseBars: base,
+      barEvery: null,
+      rows: 1
+    }
+  }
+  if (settings.paceLevel === undefined) {
+    return {
+      level,
+      window: { ...settings.paceBars },
+      phraseBars: base,
+      turnaroundPhraseBars: base,
+      barEvery: null,
+      rows: 1
+    }
+  }
+  const profile = radioPaceProfile(level)
+  return {
+    level,
+    window: { ...profile.window },
+    phraseBars: radioPacePhraseBars(profile, base),
+    turnaroundPhraseBars: base,
+    barEvery: profile.barEvery,
+    rows: profile.rows
+  }
+}
+
+/** The change grid at this cadence. Below the bar band it is radioGridBars, exactly as before.
+ * In it a change may also land on any bar line `barEvery` apart (stepped down to divide the
+ * loop, as radioGridBars steps a cycle), whatever the stems' lengths: the incoming stem enters
+ * at its matching position (both engines tile a stem at its own length from the loop's top), the
+ * outgoing one is cut. Two cases still wait for the loop top, as they do today:
+ *   - the incoming stem is not known yet (null): its length cannot be checked;
+ *   - the incoming stem is LONGER than the loop: it would lengthen the loop mid-lap (the web's
+ *     Timeline.swapAt refuses it outright).
+ * A loop that is not a whole number of bars has no bar lines to share: radioGridBars' answer. */
+export function radioPaceGridBars(
+  barEvery: number | null,
+  loopEndOverBars: number,
+  loopBars: number,
+  outgoingBars: number | null,
+  incomingBars: number | null
+): number {
+  const base = radioGridBars(loopEndOverBars, loopBars, radioChangeBars(outgoingBars, incomingBars))
+  if (barEvery === null || !(barEvery >= 1)) return base
+  if (!(loopBars > 0) || !Number.isInteger(loopBars)) return base
+  if (incomingBars === null || !(incomingBars > 0) || incomingBars > loopBars) return base
+  let step = Math.min(Math.floor(barEvery), loopBars)
+  while (step > 1 && loopBars % step !== 0) step -= 1
+  return Math.min(base, step)
+}
+
+/** The first line of a `gridBars` grid at or after `bars`, within the lap: `loopBars` (the wrap)
+ * when none is left in it. The web radio aims a mid-loop change here (with its lead added to
+ * `bars`). */
+export function radioGridLineAtOrAfter(bars: number, gridBars: number, loopBars: number): number {
+  if (!(loopBars > 0) || !Number.isFinite(bars)) return loopBars
+  const step = gridBars > 0 ? gridBars : loopBars
+  const line = Math.ceil(Math.max(0, bars) / step - BOUNDARY_EPSILON) * step
+  return line >= loopBars - BOUNDARY_EPSILON ? loopBars : line
+}
+
+/** A change landing mid-loop in the bar band is a cut: an arrival gesture would otherwise be held
+ * to the loop top (radioChangeWaitsForLoopTop) and a leading one needs the lap before a wrap, and
+ * either would take the pace back. Loop-top landings keep their transition. */
+export function radioCadenceTransition(
+  cadence: Pick<RadioCadence, 'barEvery'>,
+  kind: RadioTransitionKind,
+  atLoopTop: boolean
+): RadioTransitionKind {
+  return cadence.barEvery !== null && !atLoopTop ? 'cut' : kind
+}
+
+/** The slider moved while radio runs (spec section 4): the clock as it should be under the new
+ * cadence. Two things, nothing else -- the pick, a decided change, a turnaround and fold all
+ * stay:
+ *   - the running interval is redrawn from the new window ONLY when it is now longer than the
+ *     window allows (barsElapsed kept, so an interval already spent is due at the next
+ *     boundary). Moving faster is heard within a change, not after a slow one finishes; moving
+ *     slower lets the short interval running finish and draws the next from the new window.
+ *   - the change phrase is re-anchored on the turnaround's: when the new change phrase divides
+ *     the turnaround phrase (16 / 8 / 4 laps of a 4-bar loop), lapsSincePhrase becomes
+ *     turnaroundLap modulo it, so a phrase end's turnaround still leads into a change phrase's
+ *     top. Without it, a phrase that grows mid-stream would count from wherever its counter was
+ *     and drift off the turnarounds for good.
+ * `random` is drawn only when the interval is redrawn. */
+export function radioClockForPace(
+  clock: RadioClock,
+  cadence: Pick<RadioCadence, 'window' | 'phraseBars' | 'turnaroundPhraseBars'>,
+  loopBars: number,
+  random: () => number = Math.random
+): RadioClock {
+  const intervalBars =
+    clock.intervalBars > cadence.window.max
+      ? nextRadioIntervalBarsInWindow(cadence.window, random)
+      : clock.intervalBars
+  const perPhrase = radioPhraseLaps(cadence.phraseBars, loopBars)
+  const perTurnaround = turnaroundPhraseLaps(cadence.turnaroundPhraseBars, loopBars)
+  const lapsSincePhrase =
+    perPhrase > 0 && perTurnaround > 0 && perTurnaround % perPhrase === 0
+      ? (clock.turnaroundLap ?? 0) % perPhrase
+      : clock.lapsSincePhrase
+  return { ...clock, intervalBars, lapsSincePhrase }
+}
+
+/** Up to `count` DIFFERENT rows for one change, in order: the first is exactly pickRadioSlotId's
+ * answer (same draw, same random calls), each next one is pickRadioSlotId over what is left with
+ * the row just chosen as "last changed". So at count 1 nothing differs from today. */
+export function pickRadioSlotIds(
+  eligible: readonly string[],
+  lastChangedId: string | null,
+  count: number,
+  options: RadioPickOptions = {}
+): string[] {
+  const out: string[] = []
+  let left = [...eligible]
+  let last = lastChangedId
+  const n = Math.max(0, Math.floor(count))
+  while (out.length < n && left.length > 0) {
+    const id = pickRadioSlotId(left, last, options)
+    if (id === null) break
+    out.push(id)
+    left = left.filter((x) => x !== id)
+    last = id
   }
+  return out
 }
```

- [ ] **Step 4: Run the tests and see them pass.**

Run: `npx vitest run src/shared src/main/discoverSettingsStore.test.ts`
Expected: all pass. That was 2475 in planning: 2441 before, plus 15 in `radioPace.test.ts`, plus 19 in `radioCadence.test.ts`.

- [ ] **Step 5: Lint, typecheck, and keep the web radio green.**

Run:
```bash
npx eslint --fix src/shared/radioSchedule.ts src/shared/radioCadence.test.ts src/shared/radioSchedule.test.ts src/main/discoverSettingsStore.test.ts
npm run typecheck
cd /Users/nickel/Claudecode/ell.ing/radio && npm run typecheck && npx vitest run src
```
Expected: clean and green.
- The web reads the new exports only from Task 3 on.
- The new optional field is invisible to its `RadioSettings` objects.
- `radioPaceWindowOf` is untouched; the desktop stops using it in Task 4.

- [ ] **Step 6: Commit (in sssketch).**

```bash
git add src/shared/radioSchedule.ts src/shared/radioCadence.test.ts src/shared/radioSchedule.test.ts src/main/discoverSettingsStore.test.ts
git commit -m "radio pace: radioCadenceOf -- the slider's profile applied to a runtime's own phrase (fold mode's override; no level reads exactly as before), advanceRadioClock's turnaround phrase as its own argument (turnarounds keep 16 at every pace), the bar band's grid (radioPaceGridBars: any stem no longer than the loop on bar lines, matching position), radioClockForPace for a move while running (a too-long interval redrawn, the change phrase re-anchored on the turnaround's), pickRadioSlotIds, paceLevel persisted and migrated

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz"
```

---

### Task 3: Web radio, the slider (phase 1)

**Files (ell.ing/radio):**
- Modify: `src/radio/step.ts` and `src/radio/controller.ts`.
- Create: `src/ui/pacePrefs.ts` and `src/ui/pacePrefs.test.ts`.
- Modify: `src/ui/full.ts`, `src/ui/fullModel.ts`, `src/ui/controlsModel.ts`, `src/ui/simple.ts`, `src/main.ts`, `src/dev/devRadio.ts` and `dev-radio.html`.
- Tests: `src/radio/step.test.ts`, `src/radio/settings.test.ts`, `src/ui/controlsModel.test.ts` and `src/ui/fullModel.test.ts`.

**Depends on:** Task 2, checked out in sssketch's working tree.

**What changes:**
- **The `pace` event** carries a `level`. It is no longer a course change: `pace()` sets `paceLevel` and applies `radioClockForPace`, nothing else.
- **Cadence:**
  - every cadence read in `step.ts` goes through `radioCadenceOf`;
  - the clock gets the turnaround's phrase;
  - the readout ruler uses the turnaround phrase.
- **Full mode** gets a `pace` knob, committed on `change` (release), with the readout following the drag. It is remembered as `radio.pace` and passed to the radio by `main.ts`.
- **Control ids:** `pace-slow` / `pace-mid` / `pace-fast` go. The `pace` control cycles the anchors.

**Timing risks:**
1. **Re-anchoring between ticks.** `pace()` runs as a reducer event between ticks, using `s.lastTick.loopBars`. Before the first tick it only sets the level; there is no loop to re-anchor on.
2. **The early decision** (`radioChangeDueAtNextWrap`) and `comingWrapOnPhrase` must both read the **change** phrase. The readout's `coming()` must too, or the `next` marker disagrees with the landing. All three are in the diff.
3. **Nothing taken back.** The tests check that the decided change, the clock's elapsed bars, an armed turnaround and fold all survive a move.

- [ ] **Step 1: Write the failing tests.**

Create `src/ui/pacePrefs.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { DEFAULT_WEB_PACE_LEVEL, PACE_KEY, loadPaceLevel, savePaceLevel } from './pacePrefs'

function memory(): Pick<Storage, 'getItem' | 'setItem'> & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) }
}

describe('pacePrefs', () => {
  it('starts at fast, the web radio pace until now', () => {
    expect(DEFAULT_WEB_PACE_LEVEL).toBe(50)
    expect(loadPaceLevel(memory())).toBe(50)
    expect(loadPaceLevel(null)).toBe(50)
  })

  it('remembers a level, whole and clamped', () => {
    const s = memory()
    savePaceLevel(93.4, s)
    expect(s.data.get(PACE_KEY)).toBe('93')
    expect(loadPaceLevel(s)).toBe(93)
    savePaceLevel(400, s)
    expect(loadPaceLevel(s)).toBe(100)
  })

  it('anything unreadable is fast', () => {
    const s = memory()
    s.data.set(PACE_KEY, '{nope')
    expect(loadPaceLevel(s)).toBe(50)
    s.data.set(PACE_KEY, '"fast"')
    expect(loadPaceLevel(s)).toBe(50)
    const throwing = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }
    expect(loadPaceLevel(throwing)).toBe(50)
    expect(() => savePaceLevel(10, throwing)).not.toThrow()
  })
})
```

Update the reducer tests. The old `pace` tests asserted the course change, so they are replaced. `rearm()` stands in for the two tests that used a pace press to re-arm.

```diff
--- a/src/radio/step.test.ts
+++ b/src/radio/step.test.ts
@@ -1,5 +1,6 @@
 import { describe, expect, it } from 'vitest'
-import { pickRadioSlotId, RADIO_PACE_BARS } from '@shared/radioSchedule'
+import { pickRadioSlotId, RADIO_PACE_BARS, radioCadenceOf } from '@shared/radioSchedule'
+import { RADIO_PACE_ANCHORS, radioPaceProfile } from '@shared/radioPace'
 import { HOOK_HOLD_FACTOR, REPLACE_SOON_FACTOR } from '@shared/radioSlotFlags'
 import { radioFoldBeatsIn, radioFoldPhaseDot, radioFoldStatus } from '@shared/radioFoldStatus'
 import type { IndexRecord } from '../index/shapeRecord'
@@ -77,6 +78,15 @@
   }
 }
 
+/** Radio re-arms from nothing, as a pace press used to make it (the slider no longer does,
+ * 2026-10-03): nothing pending and its interval spent, the due branch at the coming wrap draws the
+ * next interval and then arms -- the same two draws, in the same order. RULES keep everything
+ * else on that wrap from drawing (no arc, no drift, no turnarounds, no phrase grid). */
+function rearm(s: RadioState, random: () => number): RadioState {
+  const spent: RadioState = { ...s, pending: null, clock: { ...s.clock!, barsElapsed: 1e9, lastPos: 3.9 } }
+  return step(spent, tickAt(LAP + 0.01), random).state
+}
+
 class Sim {
   s: RadioState
   log: RadioAction[] = []
@@ -137,7 +147,7 @@
     const snapshot = JSON.stringify({ ...before, changedAt: [...before.changedAt], requested: [...before.requested], ready: [...before.ready] })
     step(before, tickAt(8.05), seeded(2))
     reduce(before, { type: 'hook', slot: 'r1' })
-    reduce(before, { type: 'pace', pace: 'fast' })
+    reduce(before, { type: 'pace', level: 90 })
     expect(JSON.stringify({ ...before, changedAt: [...before.changedAt], requested: [...before.requested], ready: [...before.ready] })).toBe(snapshot)
   })
 
@@ -161,8 +171,7 @@
     // equal staleness: every row last changed at the current turn
     sim.s = { ...sim.s, changedAt: new Map(sim.s.rows.map((r) => [r.id, sim.s.turn])), lastSlot: null, pending: null }
     flags(sim)
-    sim.send({ type: 'pace', pace: 'mid' }) // a pace press re-arms radio
-    return sim.s.pending!.slot
+    return rearm(sim.s, sim.rnd).pending!.slot
   }
 
   it('hold longer (hook) is drawn 1/HOOK_HOLD_FACTOR as often, change next (replace-soon) REPLACE_SOON_FACTOR times', () => {
@@ -189,8 +198,8 @@
     sim.send({ type: 'replaceSoon', slot: 'r3' })
     const s = { ...sim.s, pending: null }
     for (let seed = 1; seed <= 50; seed++) {
-      // a pace press: the new clock's interval draw, then the arm
-      const r = reduce(s, { type: 'pace', pace: 'mid' }, seeded(seed))
+      // the due branch: the interval draw, then the arm
+      const r = { state: rearm(s, seeded(seed)) }
       const random = seeded(seed)
       random()
       const expected = pickRadioSlotId(['r0', 'r1', 'r2', 'r3'], s.lastSlot, {
@@ -246,21 +255,63 @@
   })
 })
 
-describe('pace', () => {
-  it("a new clock on the pace's window; the held change taken back; a fresh pick", () => {
+describe('pace (the slider, sssketch spec 2026-10-03-radio-pace-slider-design)', () => {
+  it('takes nothing back: the decided change, the pick, the phrase and the clock run on', () => {
     const sim = new Sim({ paceBars: { min: 4, max: 4 } })
     sim.send({ type: 'play' })
     sim.run(0, 1)
     expect(sim.s.led?.at).toBe(LAP)
-    const token = sim.s.token
-    sim.send({ type: 'pace', pace: 'slow' })
-    expect(sim.of('cancel').at(-1)).toMatchObject({ time: LAP })
-    expect(sim.s.led).toBeNull()
+    const led = sim.s.led
+    const clock = sim.s.clock!
+    const cancels = sim.of('cancel').length
+    sim.send({ type: 'pace', level: RADIO_PACE_ANCHORS.slow })
+    expect(sim.of('cancel').length).toBe(cancels)
+    expect(sim.s.led).toEqual(led)
+    expect(sim.s.settings.paceLevel).toBe(RADIO_PACE_ANCHORS.slow)
+    // 4 bars is shorter than slow's window: it runs out, and the next is drawn from slow's
+    expect(sim.s.clock!.intervalBars).toBe(clock.intervalBars)
+    expect(sim.s.clock!.barsElapsed).toBe(clock.barsElapsed)
+    sim.run(1 + 1 / 30, LAP + 0.1)
+    expect(sim.of('landed').at(-1)).toMatchObject({ time: LAP })
     expect(sim.s.clock!.intervalBars).toBeGreaterThanOrEqual(RADIO_PACE_BARS.slow.min)
-    expect(sim.s.clock!.barsElapsed).toBe(0)
-    expect(sim.s.settings.paceBars).toEqual(RADIO_PACE_BARS.slow)
-    expect(sim.s.pending!.token).toBeGreaterThan(token)
   })
+
+  it('moving faster redraws an interval longer than the new window, from now', () => {
+    const sim = new Sim({ paceLevel: RADIO_PACE_ANCHORS.slow })
+    sim.send({ type: 'play' })
+    sim.run(0, 1)
+    expect(sim.s.clock!.intervalBars).toBeGreaterThanOrEqual(RADIO_PACE_BARS.slow.min)
+    sim.send({ type: 'pace', level: RADIO_PACE_ANCHORS.fast })
+    expect(sim.s.clock!.intervalBars).toBeLessThanOrEqual(RADIO_PACE_BARS.fast.max)
+  })
+
+  it('keeps an armed turnaround and fold, which a pace change took back before', () => {
+    const sim = new Sim({ paceLevel: 25, phraseBars: 16, turnarounds: 'often', transitions: 'off' }, seeded(4))
+    sim.send({ type: 'play' })
+    // run until a turnaround is armed, then move the slider
+    let t = 0
+    while (!sim.s.turnaround && t < 400) sim.run(t, (t += 1))
+    expect(sim.s.turnaround).not.toBeNull()
+    const armed = sim.s.turnaround
+    sim.send({ type: 'pace', level: 95 })
+    expect(sim.s.turnaround).toEqual(armed)
+    expect(sim.of('cancelTurnaround')).toHaveLength(0)
+  })
+
+  it('turnarounds keep 16 bars whatever the level; changes come faster', () => {
+    for (const level of [50, 55, 65, 75]) {
+      const sim = new Sim({ paceLevel: level, phraseBars: 16, turnarounds: 'often' }, seeded(9))
+      sim.send({ type: 'play' })
+      sim.run(0, 32 * LAP)
+      const ends = sim.of('turnaround').map((a) => a.time)
+      // a 4-bar loop: every phrase end is on a 4-lap boundary
+      for (const at of ends) expect((at / LAP) % 4).toBe(0)
+      const landed = sim.of('landed').length
+      const phrase = radioCadenceOf({ ...WEB_RADIO_DEFAULTS, paceLevel: level }).phraseBars
+      expect(phrase).toBe(radioPaceProfile(level).phraseCap === null ? 16 : Math.min(16, radioPaceProfile(level).phraseCap!))
+      if (level > 50) expect(landed).toBeGreaterThan(8)
+    }
+  })
 })
 
 describe('intervals from the wrap (sssketch 700cb19)', () => {
@@ -1224,23 +1275,17 @@
     expect(sim.s.foldNext!.cycles).toEqual(sim.of('fold').at(-1)!.cycles)
   })
 
-  it('a pace change starts the machine over: unfolded at the next top, a new machine the wrap after', () => {
+  it('the pace slider leaves the machine alone (it reset it before the slider)', () => {
     const sim = new Sim(FOLD)
     sim.send({ type: 'play' })
     sim.run(0, 60)
-    sim.send({ type: 'pace', pace: 'slow' })
-    expect(sim.s.fold).toBeNull()
-    expect(sim.s.foldNow).toBeNull()
-    expect(sim.s.foldNext).toBeNull()
-    // fold mode's own window, not the pace's
-    expect(sim.s.clock!.intervalBars).toBeGreaterThanOrEqual(16)
-    const before = sim.of('fold').length
-    sim.run(60 + 1 / 30, 66)
-    const after = sim.of('fold').slice(before)
-    expect(after[0]).toEqual({ type: 'fold', time: 64, cycles: [], drift: {}, clashRow: null })
-    // the wrap at 64 decides the lap at 72 afresh
-    expect(after.slice(1).map((f) => f.time)).toEqual([72])
-    expect(sim.s.fold!.lap).toBe(0)
+    const fold = sim.s.fold
+    const interval = sim.s.clock!.intervalBars
+    sim.send({ type: 'pace', level: 100 })
+    expect(sim.s.fold).toBe(fold)
+    expect(sim.s.foldClear).toBe(false)
+    // fold mode's own window still applies: nothing to shorten
+    expect(sim.s.clock!.intervalBars).toBe(interval)
   })
 
   it("the controls set the settings, and the clash's lean follows at once", () => {
```

```diff
--- a/src/radio/settings.test.ts
+++ b/src/radio/settings.test.ts
@@ -94,10 +94,11 @@
   it('is what a new radio starts with; the pace control starts on fast and still changes', () => {
     expect(initialRadioState().settings).toEqual(WEB_RADIO_DEFAULTS)
     const r = sim()
-    expect(view(r.s).pace).toBe('fast')
-    r.send({ type: 'pace', pace: 'mid' })
-    expect(r.s.settings.paceBars).toEqual(RADIO_PACE_BARS.mid)
-    expect(view(r.s).pace).toBe('mid')
+    // no level given (main.ts gives the listener's): the chip's own window, read as fast
+    expect(view(r.s).pace).toBe(50)
+    r.send({ type: 'pace', level: 25 })
+    expect(r.s.settings.paceLevel).toBe(25)
+    expect(view(r.s).pace).toBe(25)
     // the shared object itself is untouched
     expect(WEB_RADIO_DEFAULTS.paceBars).toEqual({ min: 3, max: 6 })
   })
```

```diff
--- a/src/ui/controlsModel.test.ts
+++ b/src/ui/controlsModel.test.ts
@@ -6,7 +6,7 @@
   bpm: 120,
   tempoTarget: null,
   held: false,
-  pace: 'mid',
+  pace: 25,
   ...over
 })
 const ids = (xs: { id: string }[]) => xs.map((x) => x.id)
@@ -46,7 +46,7 @@
 
   it('the bottom-right is only skip, on desktop and phone, whatever the pace or hold', () => {
     for (const phone of [false, true]) {
-      for (const over of [{ pace: 'fast' as const }, { pace: 'slow' as const, held: true }]) {
+      for (const over of [{ pace: 50 }, { pace: 0, held: true }]) {
         const br = controlsModel(view(over), { phone, intro: false }).br
         expect(br.map((x) => [x.id, x.label, x.aria])).toEqual([['next', 'skip', 'skip']])
       }
@@ -63,10 +63,12 @@
     expect(skip(undefined).label).toBe('skip')
   })
 
-  it('nextPace cycles slow, mid, fast (full mode and the pace key)', () => {
-    expect(nextPace('slow')).toBe('mid')
-    expect(nextPace('mid')).toBe('fast')
-    expect(nextPace('fast')).toBe('slow')
+  it('nextPace cycles the anchors: slow, mid, fast, ludicrous', () => {
+    expect(nextPace(0)).toBe(25)
+    expect(nextPace(25)).toBe(50)
+    expect(nextPace(50)).toBe(90)
+    expect(nextPace(90)).toBe(0)
+    expect(nextPace(60)).toBe(90)
   })
 
   it('puts ♥ then full in the top-right, full hidden until full mode exists', () => {
```

```diff
--- a/src/ui/fullModel.test.ts
+++ b/src/ui/fullModel.test.ts
@@ -40,7 +40,7 @@
   bpm: 120,
   tempoTarget: null,
   held: false,
-  pace: 'mid',
+  pace: 25,
   loopBars: 8,
   rows: [row()],
   ...over
@@ -92,8 +92,10 @@
     expect(fullModel(view({ phase: 'stopped' }), { failed: true }).strip.toggle).toBe('retry')
     expect(fullModel(view({ bpm: 119.6 })).strip.bpm).toBe(120)
     expect(fullModel(view({ tempoTarget: 123.4 })).strip.bpm).toBe(123)
-    const s = fullModel(view({ pace: 'fast', held: true })).strip
-    expect([s.pace, s.held, s.paces]).toEqual(['fast', true, ['slow', 'mid', 'fast']])
+    const s = fullModel(view({ pace: 50, held: true })).strip
+    expect([s.pace, s.held, s.paceLabel]).toEqual([50, true, 'fast'])
+    expect(fullModel(view({ pace: 60 })).strip.paceLabel).toBe('2-4 bars')
+    expect(fullModel(view({ pace: 95 })).strip.paceLabel).toBe('ludicrous')
   })
 })
 
```

- [ ] **Step 2: Run them and see them fail.**

Run: `cd /Users/nickel/Claudecode/ell.ing/radio && npx vitest run src/radio/step.test.ts src/radio/settings.test.ts src/ui`
Expected: FAIL. `pacePrefs` is missing, the `pace` event has no `level`, and the view's `pace` is still a word.

- [ ] **Step 3: Implement the reducer and the controller.**

```diff
--- a/src/radio/step.ts
+++ b/src/radio/step.ts
@@ -76,18 +76,19 @@
   createRadioClock,
   isRadioEligibleSlot,
   nextRadioIntervalBarsInWindow,
-  radioPaceWindowOf,
   pickRadioSlotId,
-  RADIO_PACE_BARS,
   radioBarsUntilChange,
+  radioCadenceOf,
   radioChangeDueAtNextWrap,
+  radioClockForPace,
+  radioPaceLevelOf,
   radioPhraseLaps,
   radioStarterKinds,
   RADIO_CHANNELS_MAX,
   restartRadioInterval,
-  type RadioClock,
-  type RadioPace
+  type RadioClock
 } from '@shared/radioSchedule'
+import { normalizeRadioPaceLevel } from '@shared/radioPace'
 import {
   forgetRadioSlotFlagOnChange,
   NO_RADIO_SLOT_FLAGS,
@@ -377,7 +378,8 @@
   | { type: 'stop' }
   | { type: 'next' }
   | { type: 'hold'; on: boolean }
-  | { type: 'pace'; pace: RadioPace }
+  /** The pace slider released (@shared/radioPace): 0..100. */
+  | { type: 'pace'; level: number }
   | { type: 'tempo'; bpm: number }
   | { type: 'hook'; slot: string }
   | { type: 'replaceSoon'; slot: string }
@@ -558,7 +560,7 @@
       if (event.on) cancelTurnaround(c)
       break
     case 'pace':
-      pace(c, event.pace)
+      pace(c, event.level)
       break
     case 'tempo':
       tempo(c, event.bpm)
@@ -727,7 +729,10 @@
   const before = s.clock
   // the change grid is the whole loop: every change lands at a loop top. That is `loop end:
   // always` (loopEndOverBars 0, radioGridBars' answer for it); the web has no other value.
-  const adv = advanceRadioClock(before, pos, loopBars, loopBars, s.settings.phraseBars)
+  // the pace slider's cadence (@shared/radioSchedule radioCadenceOf): the change phrase, and the
+  // turnaround's own phrase, which the slider never moves
+  const cadence = radioCadenceOf(s.settings)
+  const adv = advanceRadioClock(before, pos, loopBars, loopBars, cadence.phraseBars, cadence.turnaroundPhraseBars)
   let due = adv.due
   // hold freezes the duration since the last change; the lap bookkeeping carries on
   s.clock = s.held ? { ...adv.clock, barsElapsed: before.barsElapsed } : adv.clock
@@ -819,7 +824,7 @@
       p?.record &&
       isReady(s, p.record, s.bpm) &&
       eligible(s, p.slot) &&
-      radioChangeDueAtNextWrap(s.clock, pos, loopBars, loopBars, s.settings.phraseBars)
+      radioChangeDueAtNextWrap(s.clock, pos, loopBars, loopBars, cadence.phraseBars)
     ) {
       decide(c, p.slot, p.record, true, pickTransition(s.settings.transitions, kindsOf(s, p.slot), c.rnd))
     }
@@ -909,7 +914,7 @@
  * change that came due late (or was refused) to the next phrase wrap too, where sssketch commits
  * it on the phrase wrap it came due on. Always true with no phrase grid. */
 function comingWrapOnPhrase(s: RadioState, t: RadioTickInfo): boolean {
-  const perPhrase = radioPhraseLaps(s.settings.phraseBars, t.loopBars)
+  const perPhrase = radioPhraseLaps(radioCadenceOf(s.settings).phraseBars, t.loopBars)
   if (perPhrase === 0) return true
   if (!s.clock || t.nextWrap === null) return false
   // the wrap scheduled on must be the one ending this lap, not the one after it (a wrap too close
@@ -1828,26 +1833,18 @@
 
 // ---- controls ----
 
-/** armRadioCourseChange (DP:5733) without its seek (the engine has none): a new clock on the
- * new window (a new phrase), the pending pick and any held change and turnaround dropped, a
- * fresh pick. */
-function pace(c: Ctx, p: RadioPace): void {
+/** The pace slider released (sssketch spec 2026-10-03-radio-pace-slider-design section 4). No
+ * longer a course change: the level is in force from the next interval draw, and nothing radio
+ * has already decided is taken back -- the pick, a decided change (scheduled or not), an armed
+ * turnaround, a waiting turn, the gestures and fold all stay, and the phrase runs on.
+ * radioClockForPace shortens an interval now longer than the new window allows and re-anchors the
+ * change phrase on the turnaround's. Before the first tick there is no loop to re-anchor on: the
+ * level alone is set. */
+function pace(c: Ctx, level: number): void {
   const { s } = c
-  s.settings = { ...s.settings, pace: p, paceBars: { ...RADIO_PACE_BARS[p] } }
-  if (s.phase !== 'running' || !s.clock) return
-  // a course change starts the fold machine over (DP's resetRadioFold): unfolded at the next
-  // top, a new machine from the wrap after
-  resetFold(s)
-  // the window just set (fold mode's while it is on; the same draw as RADIO_PACE_BARS[p] off)
-  s.clock = createRadioClock(interval(c), s.clock.lastPos)
-  s.pending = null
-  if (s.led && !s.led.cancel) {
-    if (s.led.at !== null) cancelLed(c, 'drop')
-    else s.led = null
-  }
-  cancelTurnaround(c)
-  s.gestures = []
-  arm(c)
+  s.settings = { ...s.settings, paceLevel: normalizeRadioPaceLevel(level, radioPaceLevelOf(s.settings)) }
+  if (s.phase !== 'running' || !s.clock || !s.lastTick) return
+  s.clock = radioClockForPace(s.clock, radioCadenceOf(s.settings), s.lastTick.loopBars, c.rnd)
 }
 
 /** Fold mode switched on or off while running: the interval running was drawn from the other
@@ -2086,7 +2083,7 @@
  * otherwise. Counted from bar 0: every web interval restarts on a wrap except a swap-now's,
  * which passes the bar it landed on (DP's radioNextIntervalBars' boundaryBars). */
 function interval(c: Ctx, fromBars = 0): number {
-  const drawn = nextRadioIntervalBarsInWindow(radioPaceWindowOf(c.s.settings), c.rnd)
+  const drawn = nextRadioIntervalBarsInWindow(radioCadenceOf(c.s.settings).window, c.rnd)
   return c.s.settings.foldMode ? radioFoldIntervalBars(c.s.fold, drawn, c.s.lastTick?.loopBars ?? 0, fromBars) : drawn
 }
 
@@ -2156,7 +2153,8 @@
   /** How far the tempo in force (`bpm`) has drifted from the base, bpm (signed). */
   drift: number
   held: boolean
-  pace: RadioPace
+  /** The pace slider's level, 0..100 (@shared/radioPace). */
+  pace: number
   /** The loop and where the playhead is in it, as of the last tick (0 before one). */
   loopBars: number
   pos: number
@@ -2293,7 +2291,8 @@
   }
 
   let radio: Coming | null = null
-  const perPhrase = radioPhraseLaps(s.settings.phraseBars, loopBars)
+  const cadence = radioCadenceOf(s.settings)
+  const perPhrase = radioPhraseLaps(cadence.phraseBars, loopBars)
   const onPhrase = (k: number) => {
     if (perPhrase === 0) return true
     const f = Math.max(0, perPhrase - s.clock!.lapsSincePhrase - 1)
@@ -2315,7 +2314,7 @@
     const ready = !!s.pending.record && isReady(s, s.pending.record, s.bpm)
     // the wrap it comes due on (it is decided a lap ahead when ready, else on that wrap and lands
     // on the next one)
-    const until = radioBarsUntilChange(s.clock, t.pos, loopBars, loopBars, s.settings.phraseBars)
+    const until = radioBarsUntilChange(s.clock, t.pos, loopBars, loopBars, cadence.phraseBars)
     let bars: number | null = null
     if (until !== null) {
       const k = radioFrom(Math.round((until - toWrap) / loopBars) + (ready ? 0 : 1), Number.NEGATIVE_INFINITY)
@@ -2350,7 +2349,7 @@
   if (s.phase !== 'running' || !t || !s.clock) return null
   const barSec = 240 / s.bpm
   return radioReadout({
-    bars: radioReadoutBars(s.clock.turnaroundLap, t.pos, t.loopBars, s.settings.phraseBars),
+    bars: radioReadoutBars(s.clock.turnaroundLap, t.pos, t.loopBars, radioCadenceOf(s.settings).turnaroundPhraseBars),
     nextChange: next ? { rowId: next.slot, kind: next.kind, barsAway: next.bars, leaving: next.leaving } : null,
     armedTurnaround: s.turnRequest
       ? { move: s.turnRequest.move, isTurn: true }
@@ -2412,7 +2411,7 @@
     },
     drift: Math.round((s.bpm - s.tempoBase) * 100) / 100,
     held: s.held,
-    pace: s.settings.pace,
+    pace: radioPaceLevelOf(s.settings),
     loopBars,
     pos,
     progress: s.clock ? radioApproachProgress(s.clock.barsElapsed, s.clock.intervalBars) : 0,
```

```diff
--- a/src/radio/controller.ts
+++ b/src/radio/controller.ts
@@ -13,7 +13,6 @@
 import type { RankClash } from '@shared/radioClash'
 import type { FoldCycle } from '../audio/timeline'
 import { radioGestureLeadsChange, type RadioTransitionKind } from '@shared/radioTransition'
-import type { RadioPace } from '@shared/radioSchedule'
 import { TURNAROUND_MOVE_LABEL, type TurnaroundDepth, type TurnaroundFamily, type TurnaroundMove, type TurnaroundPlan } from '@shared/radioTurnaround'
 import { RADIO_THROW_WORD, dropRadioFlashes, pruneRadioFlashes, radioGestureFlashWord, type RadioFlash } from '@shared/radioReadout'
 import { NO_FAVE_FITS, normalizeFaves } from '@shared/discoverFaves'
@@ -205,8 +204,9 @@
   hold(on: boolean = !this.s.held): void {
     this.dispatch({ type: 'hold', on })
   }
-  setPace(pace: RadioPace): void {
-    this.dispatch({ type: 'pace', pace })
+  /** The pace slider's level, 0..100 (@shared/radioPace), released: from the next interval. */
+  setPace(level: number): void {
+    this.dispatch({ type: 'pace', level })
   }
   setTempo(bpm: number): void {
     this.dispatch({ type: 'tempo', bpm })
```

Then reword the comments in `step.ts` that still describe a pace change as taking things back. Find them with `grep -n "pace change" src/radio/step.ts`; at planning time there were 8, at lines 11, 33, 371, 440, 747, 1755, 1852 and 1861.
- The fold unfold, `cancelTurnaround` and `resetFold` are now reached by the mode going off and by hold only. Say so.
- The header's clock line should read: `createRadioClock at start (DP:5697); a pace move only re-anchors it (radioClockForPace)`.

- [ ] **Step 4: Implement the preference and the UI.**

Create `src/ui/pacePrefs.ts`:

```ts
// src/ui/pacePrefs.ts -- the listener's pace slider (full mode's strip; sssketch spec
// 2026-10-03-radio-pace-slider-design): 0..100, how often the radio changes something,
// remembered per visitor in localStorage['radio.pace'] and given to the radio when it is made,
// and on every release. Missing or unreadable: fast, the web radio's pace until now. Nothing
// was ever stored for the old chips (they reset to fast on every load), so there is nothing to
// migrate.
import { RADIO_PACE_ANCHORS, normalizeRadioPaceLevel } from '@shared/radioPace'

export const PACE_KEY = 'radio.pace'
/** The web radio's pace before the slider: fast (WEB_RADIO_DEFAULTS, Elling's panel). */
export const DEFAULT_WEB_PACE_LEVEL = RADIO_PACE_ANCHORS.fast

type PrefsStorage = Pick<Storage, 'getItem' | 'setItem'> | null

export function loadPaceLevel(storage: PrefsStorage): number {
  try {
    const raw = storage?.getItem(PACE_KEY)
    const v: unknown = raw ? JSON.parse(raw) : null
    return normalizeRadioPaceLevel(v, DEFAULT_WEB_PACE_LEVEL)
  } catch {
    return DEFAULT_WEB_PACE_LEVEL
  }
}

export function savePaceLevel(level: number, storage: PrefsStorage): void {
  try {
    storage?.setItem(PACE_KEY, JSON.stringify(normalizeRadioPaceLevel(level, DEFAULT_WEB_PACE_LEVEL)))
  } catch {
    // not remembered past this visit
  }
}
```

```diff
--- a/src/ui/fullModel.ts
+++ b/src/ui/fullModel.ts
@@ -12,8 +12,7 @@
 import { discoverSweepPct, discoverWindowLayout, type DiscoverWindowLayout } from '@shared/discoverWindowLayout'
 import type { RadioApproachState } from '@shared/radioApproach'
 import type { FilterMode } from '@shared/toolkit'
-import type { RadioPace } from '@shared/radioSchedule'
-import { RADIO_PACE_OPTIONS } from '@shared/radioSchedule'
+import { radioPaceLabel } from '@shared/radioPace'
 import { TURNAROUND_MOVE_LABEL, TURNAROUND_MOVES, type TurnaroundMove } from '@shared/radioTurnaround'
 import { radioFoldBeatsIn, radioFoldPhaseDot, radioFoldRowLabel } from '@shared/radioFoldStatus'
 import { radioFlashOpacity } from '@shared/radioReadout'
@@ -75,8 +74,10 @@
   /** play, stop, or retry after a failed start. */
   toggle: 'play' | 'stop' | 'retry'
   bpm: number
-  pace: RadioPace
-  paces: readonly RadioPace[]
+  /** The pace slider's level, 0..100, and its readout (radioPaceLabel: slow, mid, fast,
+   * ludicrous at their positions, bars between). */
+  pace: number
+  paceLabel: string
   held: boolean
   /** ♥ red: the combination playing is the one hearted. */
   heartLiked: boolean
@@ -175,7 +176,7 @@
       toggle: view.phase !== 'stopped' ? 'stop' : opts.failed ? 'retry' : 'play',
       bpm: Math.round(view.tempoTarget ?? view.bpm),
       pace: view.pace,
-      paces: RADIO_PACE_OPTIONS,
+      paceLabel: radioPaceLabel(view.pace),
       held: view.held,
       heartLiked: !!opts.heartLiked,
       nextPending: !!view.next,
```

```diff
--- a/src/ui/controlsModel.ts
+++ b/src/ui/controlsModel.ts
@@ -8,7 +8,7 @@
 //   bottom-right skip (next's action: one radio-chosen row swapped at the next bar). No pace or
 //                hold here (Elling: "i always just use fast myself"); full mode's strip has them.
 // Each page load shows the intro (intro.ts) above the centred play, and no corners until play.
-import { RADIO_PACE_OPTIONS, type RadioPace } from '@shared/radioSchedule'
+import { nextRadioPaceAnchor } from '@shared/radioPace'
 import type { RadioView } from '../radio/step'
 import { INTRO_BODY_ID } from './intro'
 
@@ -27,7 +27,6 @@
   | 'bpm'
   | 'faster'
   | 'pace'
-  | `pace-${RadioPace}`
   | 'next'
   | 'hold'
 
@@ -74,9 +73,10 @@
 /** ♥ with the text-style selector, so no platform draws it as a red emoji. */
 export const HEART = '\u2665\uFE0E'
 
-/** slow -> mid -> fast -> slow. */
-export function nextPace(pace: RadioPace): RadioPace {
-  return RADIO_PACE_OPTIONS[(RADIO_PACE_OPTIONS.indexOf(pace) + 1) % RADIO_PACE_OPTIONS.length]
+/** The `pace` control (no corner or key draws it today; kept so one can): slow -> mid -> fast ->
+ * ludicrous -> slow, from wherever the slider is (@shared/radioPace nextRadioPaceAnchor). */
+export function nextPace(level: number): number {
+  return nextRadioPaceAnchor(level)
 }
 
 export function controlsModel(view: ControlsView, opts: ControlsOptions): ControlsModel {
```

```diff
--- a/src/ui/full.ts
+++ b/src/ui/full.ts
@@ -20,6 +20,7 @@
 import type { FoldPrefs } from './foldPrefs'
 import { FOLD_SEED_TEXT_MAX, cleanFoldSeed, newFoldSeed } from '@shared/radioFold'
 import { FAVES_LABEL, FAVES_TOOLTIP } from '@shared/discoverFaves'
+import { RADIO_PACE_LABEL, RADIO_PACE_TOOLTIP, radioPaceLabel } from '@shared/radioPace'
 import type { PeaksCache } from './peaks'
 
 export type FullControlId = ControlId | 'simple'
@@ -49,6 +50,9 @@
   /** The faves dial, 0..100 (ui/favesPrefs.ts): read, and set. */
   readFaves(): number
   faves(n: number): void
+  /** The pace slider, 0..100 (ui/pacePrefs.ts): read, and set -- called on release only. */
+  readPace(): number
+  pace(level: number): void
   /** A turn at the next loop top: a chip's move, or null for the planner's choice. */
   turn(move: TurnaroundMove | null): void
   /** Fluoddity on or off (ui/visuals.ts): read, and set. */
@@ -365,13 +369,33 @@
   const tempo = h('div', 'grp')
   const bpm = h('span', 'w readout', '120')
   tempo.append(button('−', 'slower', () => on.control('slower')), bpm, button('+', 'faster', () => on.control('faster')))
-  const paceGrp = h('div', 'grp')
-  const paces = new Map<string, HTMLButtonElement>()
-  for (const p of ['slow', 'mid', 'fast'] as const) {
-    const b = button(p, `${p} pace`, () => on.control(`pace-${p}`))
-    paces.set(p, b)
-    paceGrp.append(b)
-  }
+  // the pace slider (sssketch spec 2026-10-03-radio-pace-slider-design): 0..100 in whole steps,
+  // its readout in words at slow / mid / fast / ludicrous and in bars between. The readout
+  // follows the drag; the radio hears the level only on release (`change`), as the desktop's
+  // faves fader commits, so a drag is one decision rather than thirty
+  const paceGrp = h('label', 'knob pace')
+  const paceInput = h('input')
+  paceInput.type = 'range'
+  paceInput.min = '0'
+  paceInput.max = '100'
+  paceInput.step = '1'
+  paceInput.value = String(on.readPace())
+  paceInput.setAttribute('aria-label', RADIO_PACE_LABEL)
+  const paceWord = h('span', 'w readout', radioPaceLabel(on.readPace()))
+  paceGrp.title = RADIO_PACE_TOOLTIP
+  paceGrp.append(h('span', '', RADIO_PACE_LABEL), paceInput, paceWord)
+  let paceDragging = false
+  paceInput.addEventListener('pointerdown', () => (paceDragging = true))
+  paceInput.addEventListener('input', () => {
+    paceWord.textContent = radioPaceLabel(Number(paceInput.value))
+    paceInput.setAttribute('aria-valuetext', paceWord.textContent)
+  })
+  paceInput.addEventListener('change', () => {
+    paceDragging = false
+    on.pace(Number(paceInput.value))
+    // a pointer lets go of focus afterwards, so the page keys work again (as range() does)
+    paceInput.blur()
+  })
   const next = button('skip', 'skip', () => on.control('next'))
   const hold = button('hold', 'hold this mix', () => on.control('hold'))
   const radioGrp = h('div', 'grp')
@@ -524,7 +548,12 @@
       toggle.setAttribute('aria-label', s.toggle === 'stop' ? 'stop the radio' : s.toggle === 'retry' ? 'could not start: try again' : 'play the radio')
       bpm.textContent = String(s.bpm)
       bpm.setAttribute('aria-label', `${s.bpm} bpm`)
-      for (const [p, b] of paces) pressed(b, p === s.pace)
+      // not while a drag is under way: the model still has the level from before it
+      if (!paceDragging) {
+        paceInput.value = String(s.pace)
+        paceWord.textContent = s.paceLabel
+        paceInput.setAttribute('aria-valuetext', s.paceLabel)
+      }
       pressed(hold, s.held)
       next.textContent = s.nextPending ? '…' : 'skip'
       next.setAttribute('aria-label', s.nextPending ? 'skipping' : 'skip')
```

```diff
--- a/src/ui/simple.ts
+++ b/src/ui/simple.ts
@@ -75,7 +75,7 @@
     x.hidden = !!e.hidden
     if (e.describedBy) x.setAttribute('aria-describedby', e.describedBy)
     else x.removeAttribute('aria-describedby')
-    if (x instanceof HTMLButtonElement && (e.id === 'hold' || e.id.startsWith('pace-'))) x.setAttribute('aria-pressed', String(!!e.active))
+    if (x instanceof HTMLButtonElement && e.id === 'hold') x.setAttribute('aria-pressed', String(!!e.active))
     return x
   }
 
```

```diff
--- a/src/main.ts
+++ b/src/main.ts
@@ -14,7 +14,6 @@
 // Every landing switches Fluoddity's preset and flickers `next`.
 // ♥ (spec §2.2): recorded while the radio runs; loved.json leans the picks, refreshed every 5 min.
 import { createFluoddity, type Fluoddity } from '@fluoddity/embed.js'
-import type { RadioPace } from '@shared/radioSchedule'
 import { DEFAULT_BPM, DEFAULT_ECHO, DEFAULT_PUMP, DEFAULT_REVERB_SEND, DEFAULT_SATURATION, Engine } from './audio/engine'
 import { keepRunning } from './audio/keepRunning'
 import { defaultStemsBase, indexUrls, loadIndexRecords, loadStem, type StemSource } from './audio/stemLoader'
@@ -49,6 +48,7 @@
 import { loadTurnaroundPrefs, saveTurnaroundPrefs, type TurnaroundPrefs } from './ui/turnaroundPrefs'
 import { FOLD_DEFAULTS, loadFoldPrefs, saveFoldPrefs, type FoldPrefs } from './ui/foldPrefs'
 import { loadFaves, saveFaves } from './ui/favesPrefs'
+import { loadPaceLevel, savePaceLevel } from './ui/pacePrefs'
 import { radioClashLean } from '@shared/radioClash'
 import { WEB_RADIO_DEFAULTS } from './radio/settings'
 import { createVisualsSwitch, loadVisuals, saveVisuals } from './ui/visuals'
@@ -243,6 +243,15 @@
 /** The faves dial (full mode's strip), remembered per visitor; 0 until set. Given to the radio when
  * it is made (withLoved), and on every change. */
 let faves = loadFaves(localStore())
+/** The pace slider (full mode's strip), remembered per visitor; fast until moved. Given to the radio
+ * when it is made, and on every release. */
+let paceLevel = loadPaceLevel(localStore())
+
+function setPaceLevel(level: number): void {
+  paceLevel = level
+  savePaceLevel(level, localStore())
+  radio?.setPace(level)
+}
 /** The fold controls changed (full mode's strip, or the intro's fold switch): kept, remembered,
  * given to the radio, and both places redrawn. */
 function setFold(p: FoldPrefs): void {
@@ -285,6 +294,8 @@
       saveFaves(n, localStore())
       radio?.setFaves(n)
     },
+    readPace: () => paceLevel,
+    pace: (level) => setPaceLevel(level),
     readVisuals: () => visuals.on,
     visuals: (on) => setVisuals(on),
     invert: (on) => {
@@ -450,6 +461,8 @@
         log,
         // the listener's turnaround controls (full mode); the rest is WEB_RADIO_DEFAULTS
         settings: {
+          // the listener's pace (full mode's slider; fast until moved)
+          paceLevel,
           turnaroundMoves: turnarounds.moves,
           turnaroundDepth: turnarounds.depth,
           // the listener's fold mode (full mode)
@@ -545,7 +558,7 @@
       bpm: DEFAULT_BPM,
       tempoTarget: null,
       held: false,
-      pace: 'mid',
+      pace: paceLevel,
       loopBars: 0,
       pos: 0,
       rows: []
@@ -603,11 +616,9 @@
     case 'hold':
       return radio?.hold()
     case 'pace':
-      return radio?.setPace(nextPace(view().pace))
+      return setPaceLevel(nextPace(paceLevel))
     case 'bpm':
       return
-    default:
-      return radio?.setPace(id.slice('pace-'.length) as RadioPace)
   }
 }
 
```

```diff
--- a/src/dev/devRadio.ts
+++ b/src/dev/devRadio.ts
@@ -2,7 +2,6 @@
 // for Elling's ears. Play/stop, tempo, pace, next, hold, per-row hold longer / change next /
 // mute, and a text readout of the rows and the next change. Nothing here is checked
 // automatically.
-import type { RadioPace } from '@shared/radioSchedule'
 import { DEFAULT_BPM, Engine } from '../audio/engine'
 import { defaultStemsBase, indexUrls, loadIndexRecords, loadStem, type StemSource } from '../audio/stemLoader'
 import { cancelQueued, markInUse, stretch, unmarkInUse } from '../audio/stretchClient'
@@ -64,7 +63,7 @@
 $('slower').onclick = () => radio?.nudgeTempo(-1)
 $('faster').onclick = () => radio?.nudgeTempo(1)
 for (const b of document.querySelectorAll<HTMLButtonElement>('[data-pace]')) {
-  b.onclick = () => radio?.setPace(b.dataset.pace as RadioPace)
+  b.onclick = () => radio?.setPace(Number(b.dataset.pace))
 }
 $('bypass').onchange = () => engine?.setMasteringBypass($<HTMLInputElement>('bypass').checked)
 
@@ -84,7 +83,7 @@
     const v = r.view()
     $('bpm').textContent = v.tempoTarget !== null ? `${v.bpm} -> ${v.tempoTarget}` : String(v.bpm)
     $('hold').className = v.held ? 'on' : ''
-    for (const b of document.querySelectorAll<HTMLButtonElement>('[data-pace]')) b.className = b.dataset.pace === v.pace ? 'on' : ''
+    for (const b of document.querySelectorAll<HTMLButtonElement>('[data-pace]')) b.className = Number(b.dataset.pace) === v.pace ? 'on' : ''
     // the table only when something in it changed, so its buttons stay clickable
     // (progress moves every frame: only the state and whole bars left go in the key)
     const key = JSON.stringify(v.rows.map((x) => ({ ...x, approach: x.approach && [x.approach.state, x.approach.barsLeft] })))
```

```diff
--- a/dev-radio.html
+++ b/dev-radio.html
@@ -44,7 +44,7 @@
       </div>
       <div>
         pace
-        <button data-pace="slow">slow</button><button data-pace="mid">mid</button><button data-pace="fast">fast</button>
+        <button data-pace="0">slow</button><button data-pace="25">mid</button><button data-pace="50">fast</button><button data-pace="75">75</button><button data-pace="90">ludicrous</button>
       </div>
       <div><label><input id="bypass" type="checkbox" /> bypass mastering</label></div>
     </fieldset>
```

- [ ] **Step 5: Run the tests and typecheck.**

Run: `npm run typecheck && npx vitest run src`
Expected: 0 errors. All of `src` passes (681 in planning; 89 of them in `step.test.ts`).

- [ ] **Step 6: Check the knob on a phone width.** No agent can hold a phone; this only checks the layout.
- Run `npm run dev` and open full mode in a headless browser at 390 px and 320 px wide (the faves knob was checked this way).
- Confirm the `pace` knob wraps with the other knobs and its readout (`ludicrous` is the widest) does not overflow.
- If no browser tool is available, say so in the report rather than claiming it.

- [ ] **Step 7: Commit (in ell.ing/radio).**

```bash
git add src/radio/step.ts src/radio/controller.ts src/radio/step.test.ts src/radio/settings.test.ts src/ui/pacePrefs.ts src/ui/pacePrefs.test.ts src/ui/full.ts src/ui/fullModel.ts src/ui/fullModel.test.ts src/ui/controlsModel.ts src/ui/controlsModel.test.ts src/ui/simple.ts src/main.ts src/dev/devRadio.ts dev-radio.html
git commit -m "full mode: the pace slider -- one knob 0..100 for slow / mid / fast, its readout in words (ludicrous from 90) or bars, committed on release and remembered per visitor (radio.pace, fast until moved); a pace move is no longer a course change: from the next interval (a too-long one redrawn), the change phrase re-anchored on the turnaround's, nothing taken back; changes read @shared radioCadenceOf, turnarounds keep their 16

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz"
```

---

### Task 4: Desktop, the slider (phase 1)

**Files (sssketch):**
- Modify: `src/renderer/src/components/DiscoverRadioMenu.tsx`
- Modify: `src/renderer/src/components/DiscoverPanel.tsx`

**Depends on:** Task 2. Runs in parallel with Task 3.

**What changes:**
- **The menu:**
  - the pace chips and the `bars` steppers become `PaceSlider`, committed on release;
  - the start prompt gets a `start` chip;
  - `onPace` becomes `onStart(level)`.
- **The panel:**
  - one `radioCadence = radioCadenceOf(radioSettings)` per render;
  - the clock gets the turnaround phrase;
  - every change prediction uses the change phrase, and the readout ruler the turnaround's;
  - `startRadio(level)`;
  - a `paceLevel` effect applies `radioClockForPace`;
  - `armRadioCourseChange` is deleted.

**Timing risks:**
1. **Effect order.** The pace effect must be declared **before** the clock effect, as the diff places it, right after the fold-mode effect. React runs a commit's effects in declaration order, so the first tick that sees the new cadence already has the re-anchored phrase. Do not move it below the clock effect.
2. **`startRadio` must use the level it is given,** not `radioSettings`, which still holds the old value. This is the same async-settings trap the old chip comment described.
3. **`radioCadence` is per render.** Every function that reads it (`stepRadioStage`, `radioNextIntervalBars`, the readout) is called from the same render's effects. Check no `useCallback` or stale closure captures an older one: `grep -n "radioCadence" DiscoverPanel.tsx` and read each use.

- [ ] **Step 1: The menu.**

```diff
--- a/src/renderer/src/components/DiscoverRadioMenu.tsx
+++ b/src/renderer/src/components/DiscoverRadioMenu.tsx
@@ -4,14 +4,11 @@
   RADIO_CHANNELS_MAX,
   RADIO_CHANNELS_MIN,
   RADIO_LOOP_END_OPTIONS,
-  RADIO_PACE_BARS,
-  RADIO_PACE_OPTIONS,
   RADIO_PHRASE_OPTIONS,
-  adjustRadioPaceWindow,
-  radioPaceWindowPreset,
-  type RadioPace,
+  radioPaceLevelOf,
   type RadioSettings
 } from '@shared/radioSchedule'
+import { RADIO_PACE_LABEL, RADIO_PACE_TOOLTIP, radioPaceLabel } from '@shared/radioPace'
 import {
   RADIO_TURNAROUNDS_OPTIONS,
   TURNAROUND_DEPTH_OPTIONS,
@@ -56,6 +53,53 @@
       />
       <span style={{ fontSize: 9, minWidth: 20, textAlign: 'right', color: 'var(--ra-text)' }}>
         {draft ?? value}
+      </span>
+    </span>
+  )
+}
+
+/** The pace slider (@shared/radioPace, spec 2026-10-03-radio-pace-slider-design), 0..100, with
+ * its readout in words (slow, mid, fast, ludicrous) or bars. Like FoldSlider it is local while
+ * dragging and commits only when the drag or key press ends -- one decision, one settings write,
+ * and in a running radio one radioClockForPace. `onDraft` reports the position as it moves, for
+ * the start chip, which starts at wherever the slider is even before a release has persisted. */
+function PaceSlider({
+  value,
+  onCommit,
+  onDraft
+}: {
+  value: number
+  onCommit: (v: number) => void
+  onDraft?: (v: number) => void
+}): React.JSX.Element {
+  const [draft, setDraft] = useState<number | null>(null)
+  const commit = (): void => {
+    if (draft !== null && draft !== value) onCommit(draft)
+    setDraft(null)
+  }
+  const shown = draft ?? value
+  return (
+    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
+      <input
+        type="range"
+        min={0}
+        max={100}
+        step={1}
+        aria-label={RADIO_PACE_LABEL}
+        aria-valuetext={radioPaceLabel(shown)}
+        value={shown}
+        onChange={(e) => {
+          const v = Number(e.target.value)
+          setDraft(v)
+          onDraft?.(v)
+        }}
+        onPointerUp={commit}
+        onKeyUp={commit}
+        onBlur={commit}
+        style={{ width: 96, accentColor: 'var(--ra-text)' }}
+      />
+      <span style={{ fontSize: 9, minWidth: 64, color: 'var(--ra-text)' }}>
+        {radioPaceLabel(shown)}
       </span>
     </span>
   )
@@ -134,18 +178,19 @@
  * otherwise changing course should reset the whole thing."
  *
  *   `start`   -- radio is off and the button was pressed. Pace is a
- *                PROMPT: picking one starts radio. Channels sits beside it
- *                because it is the other thing decided at the starting
- *                moment (it sizes the bed radio lays down), and nothing
- *                else is shown, because nothing else is a starting
- *                decision. No OK button -- the pace chip IS the commit,
- *                and Escape or a click outside cancels.
+ *                PROMPT: the slider and a `start` chip, which starts radio
+ *                at the slider's position (2026-10-03; three chips did it
+ *                before the slider). Channels sits beside it because it is
+ *                the other thing decided at the starting moment (it sizes
+ *                the bed radio lays down). Escape or a click outside
+ *                cancels.
  *   `running` -- radio is on and the chevron was pressed. Everything is
- *                here, and a pace chip is now a COURSE CHANGE: it resets
- *                the clock and rerolls the whole unlocked bed on the next
- *                loop top (see DiscoverPanel's armRadioCourseChange).
+ *                here. The pace slider is NOT a course change (it was a
+ *                chip that reset the clock and re-triggered the bed until
+ *                2026-10-03): it is heard from the next interval and takes
+ *                nothing back (DiscoverPanel's pace effect).
  *
- * The pace chips MOVED here from the actions row, which is the argument
+ * The pace control MOVED here from the actions row, which is the argument
  * for this menu existing at all rather than just being somewhere to put
  * new things: the row used to grow three chips whenever radio was on and
  * now grows one chevron. The row gets simpler as the feature gets richer.
@@ -172,7 +217,7 @@
   mode,
   settings,
   onChange,
-  onPace,
+  onStart,
   onNewBed,
   onClose,
   ignoreRef
@@ -182,10 +227,9 @@
   mode: 'start' | 'running'
   settings: RadioSettings
   onChange: (patch: Partial<RadioSettings>) => void
-  /** A pace CHIP, which is not an ordinary setting write: in `start` it
-   * starts radio, in `running` it is the dramatic course change. The panel
-   * owns both, so this only reports the chip. */
-  onPace: (pace: RadioPace) => void
+  /** The start prompt's `start` chip: radio starts at this pace level (the slider's position,
+   * which may not have persisted yet -- the panel must not read it back from settings). */
+  onStart: (level: number) => void
   /** Reroll every unlocked layer, landing together at the next loop top.
    * Separate from a pace change on purpose: changing how often a layer
    * turns over is not a request for different music. */
@@ -195,6 +239,8 @@
 }): React.JSX.Element {
   const menuRef = useRef<HTMLDivElement>(null)
   const [position, setPosition] = useState({ left: x, top: y })
+  // Where the pace slider is, for the start chip: the draft while dragging, else the setting.
+  const [paceDraft, setPaceDraft] = useState<number | null>(null)
 
   useLayoutEffect(() => {
     const el = menuRef.current
@@ -271,67 +317,36 @@
         </span>
         {chips}
       </div>
-    )
-  }
-
-  /** One edge of the pace window, as a value between two steppers.
-   *
-   * Elling, 2026-09-28: "maybe allow for a specific range selection
-   * instead of just slow mid and fast?". Steppers rather than a slider or
-   * a number field because the range is 1..64 -- too many for chips, and a
-   * drag cannot land on an exact bar count, which is the whole thing he
-   * asked for. Stepping an edge is deliberately NOT a course change: a
-   * reset per keypress while settling a number would be unusable. */
-  function stepper(edge: 'min' | 'max'): React.JSX.Element {
-    function step(delta: number): void {
-      onChange({ paceBars: adjustRadioPaceWindow(settings.paceBars, edge, delta) })
-    }
-    function arrow(label: string, delta: number, tooltip: string): React.JSX.Element {
-      return (
-        <button
-          onClick={() => step(delta)}
-          data-tooltip={tooltip}
-          aria-label={tooltip}
-          style={{
-            fontFamily: 'inherit',
-            fontSize: 9,
-            width: 16,
-            padding: 'var(--ra-s-0) 0',
-            background: 'transparent',
-            border: '1px solid var(--ra-border)',
-            color: 'var(--ra-text-2)',
-            cursor: 'pointer'
-          }}
-        >
-          {label}
-        </button>
-      )
-    }
-    return (
-      <span key={edge} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
-        {arrow('-', -1, `${edge} down`)}
-        <span style={{ fontSize: 9, minWidth: 16, textAlign: 'center', color: 'var(--ra-text)' }}>
-          {settings.paceBars[edge]}
-        </span>
-        {arrow('+', 1, `${edge} up`)}
-      </span>
     )
   }
 
-  // Lit from the WINDOW, not from the stored preset -- once he steps an
-  // edge the window is no longer `mid`, and a chip still claiming to be
-  // would be lying about what the clock is drawing from.
-  const activePreset = radioPaceWindowPreset(settings.paceBars)
+  // THE PACE SLIDER (2026-10-03) replaces the slow / mid / fast chips and the min / max bar
+  // steppers: one value, 0..100, whose readout says slow, mid, fast or ludicrous at those
+  // positions and the bars between. Committed on release. While radio runs it is NOT a course
+  // change any more: it is heard from the next interval (sooner when moved faster), and takes
+  // nothing back (DiscoverPanel's pace effect, radioClockForPace). In the start prompt a `start`
+  // chip beside it starts radio at the slider's position.
+  const paceLevel = radioPaceLevelOf(settings)
   const paceRow = row(
-    'pace',
-    RADIO_PACE_OPTIONS.map((p) =>
-      chip(p, activePreset === p, () => {
-        // Sets the window too: a preset IS its window, and the point of
-        // pressing one is to go back to a known place.
-        onChange({ pace: p, paceBars: { ...RADIO_PACE_BARS[p] } })
-        onPace(p)
-      })
-    )
+    RADIO_PACE_LABEL,
+    [
+      <PaceSlider
+        key="pace"
+        value={paceLevel}
+        onCommit={(v) => onChange({ paceLevel: v })}
+        onDraft={setPaceDraft}
+      />,
+      ...(mode === 'start'
+        ? [
+            chip('start', false, () => {
+              const level = paceDraft ?? paceLevel
+              onChange({ paceLevel: level })
+              onStart(level)
+            })
+          ]
+        : [])
+    ],
+    RADIO_PACE_TOOLTIP
   )
   // `density: arc` (2026-10-01, @shared/radioDensity) grows and thins the
   // rows itself, starting from two on an empty panel, so `channels` -- the
@@ -371,7 +386,6 @@
       }}
     >
       {paceRow}
-      {mode === 'running' && row('bars', [stepper('min'), stepper('max')])}
       {mode === 'running' &&
         row(
           'loop end',
@@ -514,8 +528,8 @@
           the menu grows to fit it. */}
       <span style={{ fontSize: 9, color: 'var(--ra-text-3)', maxWidth: 260 }}>
         {mode === 'start'
-          ? 'pick a pace to start'
-          : 'a new pace restarts the loop, keeping these stems. a layer longer than loop end changes at the top of the loop, a shorter one on its own cycle. phrase holds every change back to a 16 or 32 bar boundary, counted from where radio started. transitions decide how a layer arrives, and a hole or a riser holds its change to the top of the loop. density arc grows the rows to four or five and thins them to two or three, only ever removing rows radio added. turnarounds mark the end of each phrase. fold loops one or two short layers at odd lengths against the beat, and changes come every 8 to 32 bars while it is on'}
+          ? 'set a pace and start'
+          : 'pace is heard from the next change, and takes nothing back. above fast the phrase shortens, from 80 changes land mid-loop on bar lines, and from 70 a change turns over more than one row. a layer longer than loop end changes at the top of the loop, a shorter one on its own cycle. phrase holds every change back to a 16 or 32 bar boundary, counted from where radio started. transitions decide how a layer arrives, and a hole or a riser holds its change to the top of the loop. density arc grows the rows to four or five and thins them to two or three, only ever removing rows radio added. turnarounds mark the end of each phrase. fold loops one or two short layers at odd lengths against the beat, and changes come every 8 to 32 bars while it is on'}
       </span>
     </div>
   )
```

- [ ] **Step 2: The panel.**

```diff
--- a/src/renderer/src/components/DiscoverPanel.tsx
+++ b/src/renderer/src/components/DiscoverPanel.tsx
@@ -63,7 +63,6 @@
 import { manualChangesUndoneBy, UndoSnapshotSequence } from '@shared/discoverUndoWithdraw'
 import { applyTraitBar } from '@shared/traitBar'
 import {
-  RADIO_PACE_BARS,
   advanceRadioClock,
   radioBarsUntilChange,
   radioChangeDueAtNextWrap,
@@ -71,15 +70,15 @@
   createRadioClock,
   isRadioEligibleSlot,
   nextRadioIntervalBarsInWindow,
-  radioPaceWindowOf,
   pickRadioSlotId,
+  radioCadenceOf,
+  radioClockForPace,
   radioChangeBars,
   radioGridBars,
   radioDensityOf,
   radioStarterKinds,
   restartRadioInterval,
   type RadioClock,
-  type RadioPace,
   type RadioSettings,
   radioFavesOf
 } from '@shared/radioSchedule'
@@ -196,7 +195,6 @@
 import type { DiscoverCandidate } from '../../../main/discoverCandidates'
 import { buildEngineProject, withoutDubThrows } from '@shared/buildEngineProject'
 import {
-  FOLD_PACE_BARS,
   createRadioFold,
   radioFoldIntervalBars,
   radioFoldRestartAt,
@@ -2710,6 +2708,12 @@
   useEffect(() => {
     radioOnRef.current = radioOn
   }, [radioOn])
+  // Everything that sets radio's cadence, from the pace slider and the menu's `phrase` (and fold
+  // mode's override): the interval window, the CHANGE phrase, the TURNAROUND phrase (never moved by
+  // the slider), mid-loop bar lines and rows per change (@shared/radioSchedule radioCadenceOf,
+  // spec 2026-10-03-radio-pace-slider-design). Per render, so the clock effect and everything it
+  // calls read this render's settings, as they read radioSettings.
+  const radioCadence = radioCadenceOf(radioSettings)
 
   // Radio holds the ambient background scans off for as long as it runs.
   //
@@ -3751,7 +3755,7 @@
    * a wrap restarts it before that wrap's step has run: the machine's tops are then a lap behind
    * (radioFoldIntervalBars' stepOwed). */
   function radioNextIntervalBars(loopBars: number, boundaryBars: number): number {
-    const drawn = nextRadioIntervalBarsInWindow(radioPaceWindowOf(radioSettings))
+    const drawn = nextRadioIntervalBarsInWindow(radioCadence.window)
     return radioSettings.foldMode
       ? radioFoldIntervalBars(
           radioFoldRef.current,
@@ -3795,6 +3799,23 @@
     void window.rifffApi.engineStageCycles([], false)
     // eslint-disable-next-line react-hooks/exhaustive-deps -- only the switch itself restarts the interval; radioNextIntervalBars reads this render's settings
   }, [radioSettings.foldMode])
+  // The pace slider released while radio runs (spec 2026-10-03-radio-pace-slider-design section
+  // 4). NOT a course change: the clock alone moves (radioClockForPace) -- an interval now longer
+  // than the new window is redrawn, and the change phrase is re-anchored on the turnaround's.
+  // The pick, a held or staged change, the turnaround, fold and the transport are all left alone.
+  // Declared BEFORE the clock effect on purpose: React runs a commit's effects in order, so the
+  // tick that first sees the new cadence already has the re-anchored phrase.
+  const radioPaceLevelWasRef = useRef(radioSettings.paceLevel)
+  useEffect(() => {
+    if (radioPaceLevelWasRef.current === radioSettings.paceLevel) return
+    radioPaceLevelWasRef.current = radioSettings.paceLevel
+    const clock = radioClockRef.current
+    if (!radioOnRef.current || clock === null) return
+    const lengths = resolvedBarLengthsRef.current
+    const loopBars = lengths.size > 0 ? Math.max(...lengths.values()) : 0
+    radioClockRef.current = radioClockForPace(clock, radioCadence, loopBars)
+    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the level itself moves the clock; radioCadence is this render's
+  }, [radioSettings.paceLevel])
   /** Radio off or a course change: the armed turnaround comes off, and the next phrase end
    * starts fresh. Wherever drop-outs were cleared (clearRadioGesture outside the clock). */
   function clearRadioTurnaround(): void {
@@ -4015,7 +4036,7 @@
         radioClockRef.current?.turnaroundLap,
         pos,
         loopBars,
-        radioSettings.phraseBars
+        radioCadence.turnaroundPhraseBars
       ),
       nextChange,
       armedTurnaround:
@@ -4154,14 +4175,14 @@
                                   pos,
                                   loopBars,
                                   gridBars,
-                                  radioSettings.phraseBars
+                                  radioCadence.phraseBars
                                 ) ||
                                 radioChangeLandsAtBar(
                                   clock,
                                   pos,
                                   loopBars,
                                   gridBars,
-                                  radioSettings.phraseBars
+                                  radioCadence.phraseBars
                                 ) !== null
                               ? 'decide'
                               : `not-this-lap(interval ${clock.intervalBars} elapsed ${clock.barsElapsed.toFixed(2)})`
@@ -4208,10 +4229,10 @@
       // ordering is belt and braces rather than the guarantee.
       const dueAtWrap =
         clock !== null &&
-        radioChangeDueAtNextWrap(clock, pos, loopBars, gridBars, radioSettings.phraseBars)
+        radioChangeDueAtNextWrap(clock, pos, loopBars, gridBars, radioCadence.phraseBars)
       const landsAtBar =
         clock !== null && !dueAtWrap
-          ? radioChangeLandsAtBar(clock, pos, loopBars, gridBars, radioSettings.phraseBars)
+          ? radioChangeLandsAtBar(clock, pos, loopBars, gridBars, radioCadence.phraseBars)
           : null
       if (
         pending !== null &&
@@ -4553,7 +4574,7 @@
   // ceil(intervalBars / loopBars) * loopBars -- usually a doubling rather
   // than a rounding. See radioGridBars below.
   //
-  // The PHRASE grid (radioSettings.phraseBars) is the gate on top of
+  // The PHRASE grid (radioCadence.phraseBars) is the gate on top of
   // that: off by default, and when it is on a change may land only on a
   // 16- or 32-bar boundary counted in whole laps from where this clock
   // was created. It never drops a change, only holds it to the next
@@ -4595,7 +4616,14 @@
       pendingPick !== null ? (resolvedBarLengthsRef.current.get(pendingPick.slotId) ?? null) : null
     const changeBars = radioChangeBars(outgoingBars, pendingPick?.incomingBars ?? null)
     const gridBars = radioGridBars(radioSettings.loopEndOverBars, loopBars, changeBars)
-    const step = advanceRadioClock(clock, pos, loopBars, gridBars, radioSettings.phraseBars)
+    const step = advanceRadioClock(
+      clock,
+      pos,
+      loopBars,
+      gridBars,
+      radioCadence.phraseBars,
+      radioCadence.turnaroundPhraseBars
+    )
     radioClockRef.current = step.clock
     // The readout's clock (radioPlayRef): a lap more, and the bars of the lap that ended.
     if (step.wrapped) {
@@ -5005,7 +5033,8 @@
       radioCourseChangeRef.current = null
       // restartRadioInterval, not createRadioClock: the phrase was
       // anchored when the pace chip was pressed and the transport was
-      // seeked to 0 (armRadioCourseChange). This is the batch LANDING a
+      // seeked to 0 (the old pace course change, gone 2026-10-03; `new bed` re-anchors nothing).
+      // This is the batch LANDING a
       // lap or two later, and re-anchoring here would shove the phrase
       // origin forward by however long the slowest stem took to warm.
       radioClockRef.current = restartRadioInterval(
@@ -5069,7 +5098,7 @@
       barsUntilChange:
         radioLedChangeRef.current !== null
           ? (radioLedChangeRef.current.atBars ?? loopBars) - pos
-          : radioBarsUntilChange(step.clock, pos, loopBars, gridBars, radioSettings.phraseBars)
+          : radioBarsUntilChange(step.clock, pos, loopBars, gridBars, radioCadence.phraseBars)
     }
     void Promise.resolve().then(() => {
       setRadioProgress(progress)
@@ -7801,12 +7830,12 @@
    * does its own first roll per slot, so this is the same clicks the user
    * would otherwise make.
    *
-   * Takes the window from RADIO_PACE_BARS rather than radioSettings, on
-   * purpose: the menu's own persisting write of {pace, paceBars} is async
-   * and this render's radioSettings prop is still the OLD pace. Reading it
-   * here would start the clock at the pace he just replaced.
+   * Takes the level as an argument rather than from radioSettings, on
+   * purpose: the menu's own persisting write of paceLevel is async and this
+   * render's radioSettings prop is still the OLD pace. Reading it here would
+   * start the clock at the pace he just replaced.
    */
-  function startRadio(pace: RadioPace): void {
+  function startRadio(level: number): void {
     if (slotsRef.current.length === 0) {
       // With the density arc on, the bed starts minimal (drums, bass) and
       // the arc grows it; otherwise it is `channels` rows, as before.
@@ -7824,9 +7853,7 @@
     // which is the only anchor radio can see -- the transport wraps, so
     // there is no absolute bar 0 to count from.
     radioClockRef.current = createRadioClock(
-      nextRadioIntervalBarsInWindow(
-        radioSettings.foldMode ? FOLD_PACE_BARS : RADIO_PACE_BARS[pace]
-      ),
+      nextRadioIntervalBarsInWindow(radioCadenceOf({ ...radioSettings, paceLevel: level }).window),
       pos
     )
     radioLastSlotRef.current = null
@@ -7838,79 +7865,6 @@
     void armRadioPick()
   }
 
-  /** A pace chip pressed while radio is RUNNING. Elling, 2026-09-28:
-   * "changing course should reset the whole thing. okay to have it be
-   * dramatic."
-   *
-   * So this is not a re-tuning of the running clock. Four things happen:
-   *   - the clock restarts on the new window, immediately, so the progress
-   *     rule under the button visibly says something happened;
-   *   - the pending single pick is dropped, because it belonged to the old
-   *     section;
-   *   - any armed drop-out is cleared, so a half-finished gesture cannot
-   *     survive into the new one as a stuck layer;
-   *   - every eligible layer is re-picked and warmed now, and the whole
-   *     batch lands together on the next loop top (the wrap branch of the
-   *     clock effect).
-   *
-   * LOCKED LAYERS ARE NOT TOUCHED. radioEligibleSlotIds already excludes
-   * them, and that is the point: a padlock that a reset overrides is a
-   * padlock nobody can trust. Muted layers are out for the same reason
-   * they are out of every other radio path -- a change you cannot hear.
-   *
-   * Stepping a bar edge in the menu deliberately does NOT come through
-   * here. A reset per keypress while settling a number would be unusable;
-   * a preset is a course change, a stepper is an adjustment. */
-  function armRadioCourseChange(pace: RadioPace): void {
-    // Restart the loop from its top, immediately, KEEPING the stems that
-    // are there. Revised 2026-09-28 after he heard the first version:
-    // "oh instead of a dramatic change, just reload the stems that are
-    // there currently but fresh?"
-    //
-    // The first version re-picked every eligible layer, which is dramatic
-    // and also destroys the bed he had just spent a few minutes enjoying.
-    // A change of pace is a change of pace; it is not a request for
-    // different music.
-    //
-    // Note a plain reload would be SILENT: load-project deliberately never
-    // resets the transport (IpcServer.cpp), which is exactly what lets a
-    // new bed land without a jump. So the audible part is the seek. Every
-    // layer re-triggers together from its own zero, the mix survives, and
-    // it is a reset you can actually hear -- which "dramatic" was really
-    // asking for.
-    //
-    // Immediately rather than at the next loop top, on purpose: at the top
-    // everything is already at its zero, so a reset there would be
-    // inaudible. Snapping back mid-phrase is the whole gesture.
-    void window.rifffApi.engineSetPosition(0)
-    // lastPos 0, not `pos`: the transport is about to report ~0, and a
-    // clock still holding the old mid-loop position would read that as a
-    // wrap and bank a whole phantom lap on the very next tick.
-    //
-    // createRadioClock, so the PHRASE restarts here too. A course change
-    // is a new section and it seeks the transport to 0, so bar 0 of the
-    // new phrase and bar 0 of the transport are the same instant -- which
-    // is the one moment radio gets a phrase origin for free.
-    radioClockRef.current = createRadioClock(
-      nextRadioIntervalBarsInWindow(
-        radioSettings.foldMode ? FOLD_PACE_BARS : RADIO_PACE_BARS[pace]
-      ),
-      0
-    )
-    setRadioProgress(0)
-    setRadioPending(null)
-    radioCourseChangeRef.current = null
-    setRadioLedChange(null)
-    // A course change turns the whole bed over at the next wrap. A single
-    // staged layer aimed at that same wrap is a change from the section
-    // that is being left behind.
-    cancelStagedSwap('course-change')
-    clearRadioGesture()
-    clearRadioTurnaround()
-    resetRadioFold()
-    void armRadioPick()
-  }
-
   /** Picks and WARMS every eligible layer's next stem, then arms the batch.
    *
    * The warm is awaited here, unlike armRadioPick's fire-and-forget: a
@@ -8957,10 +8911,9 @@
             settings={radioSettings}
             onChange={(patch) => void onRadioSettingsChange(patch)}
             onNewBed={() => void collectRadioCourseChange()}
-            onPace={(pace) => {
+            onStart={(level) => {
               closeRadioMenu()
-              if (radioOn) armRadioCourseChange(pace)
-              else startRadio(pace)
+              startRadio(level)
             }}
             onClose={closeRadioMenu}
             ignoreRef={radioOn ? radioChevronRef : radioMenuButtonRef}
```

The diff also drops the now-unused `FOLD_PACE_BARS`, `RADIO_PACE_BARS`, `radioPaceWindowOf` and `RadioPace` imports. `radioPaceWindowOf` stays exported from shared, unused; leave it.

- [ ] **Step 3: Typecheck, lint, test.**

Run: `npm run typecheck && npx eslint src/renderer/src/components/DiscoverPanel.tsx src/renderer/src/components/DiscoverRadioMenu.tsx && npm test`
Expected:
- typecheck and lint clean;
- tests green apart from the known machine-dependent engine-spawn tests (memory: `coreaudiod_thread_leak.md`).

The panel glue has no tests, by convention. Say so in the report; do not claim a UI check happened.

- [ ] **Step 4: Commit.**

```bash
git add src/renderer/src/components/DiscoverRadioMenu.tsx src/renderer/src/components/DiscoverPanel.tsx
git commit -m "radio menu: the pace slider -- replaces the slow / mid / fast chips and the bars steppers, readout in words or bars, committed on release; the start prompt starts at the slider's position; a pace move while running is no longer a course change (no seek, nothing taken back): radioClockForPace in an effect ahead of the clock's; the clock, predictions and ruler read radioCadenceOf

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz"
```

---

### Task 5: Web radio, mid-loop landings (phase 2)

**Files (ell.ing/radio):** `src/radio/step.ts`, `src/radio/controller.ts` and `src/radio/step.test.ts`.

**Depends on:** Task 3.

**What changes:**
- **The grid.** In the bar band (`barEvery`), the change grid is `radioPaceGridBars` of the pending pick. That is its bar lines when the incoming stem fits the loop, else the loop as before.
- **Early decisions** also take `radioChangeLandsAtBar`, deciding a cut with `atBars`.
- **The due branch:**
  - it restarts the interval from the grid line it came due on;
  - it aims at the next line at least `BAR_LEAD_SEC` ahead, as a cut, or at the wrap with a transition when none is left.
- **Scheduling.** `scheduleLedAtBar` hands a mid-loop change over as `landAt { bar: true }`. It re-aims when its bar is now too close, and goes to the wrap path after a refusal.
- **The controller** lands `bar` changes with `Engine.scheduleSwapAt`, and takes them back by re-scheduling the playing stem at the bar.
- **The readout's `coming()`** counts a bar-band landing inside the lap.

**Timing risks:**
1. **The interval origin.** It is `dueAt` (the grid line it came due on) in the due branch and `led.atBars` for an early one. A slip here quickens or slows the pace by up to a grid cell per change: compare the realised spacing in the tests, which is about one change per bar at 95.
2. **Same-tick landing.** A mid-lap landing `return`s from `tick` after `land()`, as a wrap landing does. A due on the same crossing is consumed by the early decision, and one from the due branch's own restart is held by `if (s.led) return`. Do not add work after `land()`'s return without reading the tick order comment.
3. **Re-aiming.** `scheduleLedAtBar` never schedules closer than `BAR_LEAD_SEC`. A refusal (`notBefore` set) drops `atBars`, so the ordinary wrap path takes over: wrap scheduling, the phrase and arc checks, and `underTurnaround`.
4. **Hold or withdraw of a scheduled bar change** sends `cancel { bar: true }`. The controller must use `scheduleSwapAt` for it, because `scheduleSwap` refuses a time that is not a loop top.
5. **Tempo.** `scheduleLed`'s `tempoLanding` guard still runs first, so a bar change never goes out while a tempo change is on its way.

- [ ] **Step 1: Write the failing tests** (the Sim gains `refuseBars`).

```diff
--- a/src/radio/step.test.ts
+++ b/src/radio/step.test.ts
@@ -58,7 +58,8 @@
   a: RadioAction,
   n: { i: number },
   pickFor?: (slot: string) => IndexRecord | null,
-  cancelOk = true
+  cancelOk = true,
+  refuseBars = false
 ): RadioEvent[] {
   switch (a.type) {
     case 'arm':
@@ -68,6 +69,7 @@
     case 'start':
       return [{ type: 'started', ok: true }]
     case 'landAt':
+      if (a.bar && refuseBars) return a.changes.map((c) => ({ type: 'scheduleFailed', slot: c.slot, at: a.time }) as RadioEvent)
       return a.changes.map((c) => ({ type: 'scheduled', slot: c.slot, at: a.time, kind: c.transition.kind }) as RadioEvent)
     case 'cancel':
       return [{ type: 'unscheduled', slot: a.slot, at: a.time, ok: cancelOk }]
@@ -96,6 +98,8 @@
   pickFor?: (slot: string) => IndexRecord | null
   /** Whether the engine takes a scheduled swap back. */
   cancelOk = true
+  /** Whether the engine refuses a change at a bar line inside the lap. */
+  refuseBars = false
   /** Stretches answered later (release()), by stem id. */
   withhold = new Set<string>()
   private held: RadioEvent[] = []
@@ -119,7 +123,7 @@
       for (const a of r.actions) {
         this.log.push(a)
         if (a.type === 'landAt') this.early.push(!!this.s.led?.early)
-        for (const e of answer(a, this.n, this.pickFor, this.cancelOk)) {
+        for (const e of answer(a, this.n, this.pickFor, this.cancelOk, this.refuseBars)) {
           if (e.type === 'prepared' && this.withhold.has(e.stemId)) this.held.push(e)
           else q.push(e)
         }
@@ -1649,3 +1653,86 @@
     expect(at(now - 2.1)).toBeNull()
   })
 })
+
+describe('the pace bar band: mid-loop landings (sssketch spec 2026-10-03-radio-pace-slider-design section 3)', () => {
+  const onWrap = (t: number) => Math.abs(t / LAP - Math.round(t / LAP)) < 1e-6
+  const onBar = (t: number) => Math.abs(t / 2 - Math.round(t / 2)) < 1e-6
+
+  it('at every bar (95), changes land on bar lines inside the lap, cuts, about one a bar', () => {
+    const sim = new Sim({ paceLevel: 95, transitions: 'bold' }, seeded(2))
+    sim.send({ type: 'play' })
+    sim.run(0, 10 * LAP)
+    const lands = sim.of('landAt')
+    const mid = lands.filter((a) => !onWrap(a.time))
+    expect(mid.length).toBeGreaterThan(20)
+    for (const a of mid) {
+      expect(a.bar).toBe(true)
+      expect(onBar(a.time)).toBe(true)
+      expect(a.changes.every((c) => c.transition.kind === 'cut')).toBe(true)
+    }
+    // about every bar: 10 laps of 4 bars
+    expect(sim.of('landed').length).toBeGreaterThan(30)
+    // every landing is at a bar line, never between
+    for (const l of sim.of('landed')) expect(onBar(l.time)).toBe(true)
+  })
+
+  it('every 2 bars (90) lands on even bars only', () => {
+    const sim = new Sim({ paceLevel: 90 }, seeded(3))
+    sim.send({ type: 'play' })
+    sim.run(0, 10 * LAP)
+    const times = sim.of('landed').map((l) => l.time)
+    expect(times.length).toBeGreaterThan(15)
+    for (const t of times) expect(Math.abs(t / 4 - Math.round(t / 4))).toBeLessThan(1e-6)
+  })
+
+  it('below the band (75) every change still lands on a loop top', () => {
+    const sim = new Sim({ paceLevel: 75 }, seeded(3))
+    sim.send({ type: 'play' })
+    sim.run(0, 10 * LAP)
+    expect(sim.of('landed').length).toBeGreaterThan(5)
+    for (const a of sim.of('landAt')) {
+      expect(a.bar).toBeUndefined()
+      expect(onWrap(a.time)).toBe(true)
+    }
+  })
+
+  it('a stem longer than the loop waits for the top', () => {
+    const sim = new Sim({ paceLevel: 100 }, seeded(4))
+    sim.pickFor = (slot) => ({ ...rec(`long-${slot}-${sim.n.i++}`), bars: 8 })
+    sim.send({ type: 'play' })
+    sim.run(0, 6 * LAP)
+    const later = sim.of('landAt').filter((a) => a.changes.some((c) => c.record.bars === 8))
+    expect(later.length).toBeGreaterThan(0)
+    for (const a of later) expect(onWrap(a.time)).toBe(true)
+  })
+
+  it('a bar line the engine refuses goes to the loop top', () => {
+    const sim = new Sim({ paceLevel: 100 }, seeded(5))
+    sim.refuseBars = true
+    sim.send({ type: 'play' })
+    sim.run(0, 6 * LAP)
+    expect(sim.of('landed').length).toBeGreaterThan(3)
+    for (const l of sim.of('landed')) expect(onWrap(l.time)).toBe(true)
+  })
+
+  it('hold takes a mid-loop change back at its bar', () => {
+    const sim = new Sim({ paceLevel: 100 }, seeded(6))
+    sim.send({ type: 'play' })
+    let t = 0
+    while (!(sim.s.led?.at != null && sim.s.led.atBars !== undefined) && t < 20 * LAP) sim.run(t, (t += 1 / 30))
+    const led = sim.s.led!
+    sim.send({ type: 'hold', on: true })
+    expect(sim.of('cancel').at(-1)).toMatchObject({ slot: led.slot, time: led.at, bar: true })
+  })
+
+  it('moving into the band mid-stream: mid-loop changes from the next draw; the turnaround keeps its 16', () => {
+    const sim = new Sim({ paceLevel: 50, phraseBars: 16, turnarounds: 'often' }, seeded(7))
+    sim.send({ type: 'play' })
+    sim.run(0, 8 * LAP)
+    expect(sim.of('landed').every((l) => onWrap(l.time))).toBe(true)
+    sim.send({ type: 'pace', level: 95 })
+    sim.run(8 * LAP + 1 / 30, 24 * LAP)
+    expect(sim.of('landed').some((l) => !onWrap(l.time))).toBe(true)
+    for (const a of sim.of('turnaround')) expect((a.time / LAP) % 4).toBe(0)
+  })
+})
```

- [ ] **Step 2: Run them and see them fail.**

Run: `npx vitest run src/radio/step.test.ts`
Expected: typecheck errors for `bar` / `refuseBars`; with those stubbed, 4 failures. In planning: 95, 90, hold, and moving into the band.

- [ ] **Step 3: Implement.**

```diff
--- a/src/radio/step.ts
+++ b/src/radio/step.ts
@@ -80,12 +80,16 @@
   radioBarsUntilChange,
   radioCadenceOf,
   radioChangeDueAtNextWrap,
+  radioChangeLandsAtBar,
   radioClockForPace,
+  radioGridLineAtOrAfter,
+  radioPaceGridBars,
   radioPaceLevelOf,
   radioPhraseLaps,
   radioStarterKinds,
   RADIO_CHANNELS_MAX,
   restartRadioInterval,
+  type RadioCadence,
   type RadioClock
 } from '@shared/radioSchedule'
 import { normalizeRadioPaceLevel } from '@shared/radioPace'
@@ -162,6 +166,9 @@
 export const TURN_LEAD_SEC = 0.1
 /** How long full mode's turn says `nothing to turn`, in seconds. */
 export const TURN_NOTHING_SEC = 2
+/** A mid-loop change's lead: Engine.MIN_LEAD_SEC plus a driver tick, as TURN_LEAD_SEC. A bar line
+ * nearer than this is not aimed at; the next one is. */
+export const BAR_LEAD_SEC = TURN_LEAD_SEC
 export const MIN_BPM = 40
 export const MAX_BPM = 240
 
@@ -235,8 +242,11 @@
   beats: number
   /** Decided early (radioChangeDueAtNextWrap): the clock restarts when it lands. */
   early: boolean
-  /** The wrap it is scheduled on, null until the engine has it. */
+  /** The time it is scheduled on (a wrap, or its bar's time), null until the engine has it. */
   at: number | null
+  /** The bar of the lap playing it lands on, mid-loop (the pace slider's bar band: a cut, at the
+   * stem's matching position); absent for a loop top -- every change before the slider. */
+  atBars?: number
   /** Not scheduled at a wrap at or before this (a wrap the engine refused). */
   notBefore: number
   /** Wraps passed while it waited, unscheduled. */
@@ -432,7 +442,8 @@
     }
   | { type: 'prepare'; record: IndexRecord; bpm: number; priority: StretchPriority }
   | { type: 'start'; bpm: number; rows: { slot: string; record: IndexRecord; muted: boolean; pan: number }[] }
-  | { type: 'landAt'; time: number; changes: RadioChange[] }
+  /** `bar`: at a bar line inside the lap (the pace's bar band), a cut (Engine.scheduleSwapAt). */
+  | { type: 'landAt'; time: number; changes: RadioChange[]; bar?: true }
   | { type: 'setTempoAt'; time: number; bpm: number; rows: { slot: string; record: IndexRecord }[] }
   /** A phrase turnaround (@shared/radioTurnaround's plan, in beats before the wrap) ending on
    * the loop top `time`. */
@@ -445,7 +456,7 @@
   | { type: 'fold'; time: number; cycles: RadioFoldCycle[]; drift: Record<string, FoldDriftLap>; clashRow: string | null }
   /** Fold mode's clash leaning the master in (Engine.setFoldLean). */
   | { type: 'foldLean'; lean: number }
-  | { type: 'cancel'; slot: string; time: number; record: IndexRecord; bpm: number }
+  | { type: 'cancel'; slot: string; time: number; record: IndexRecord; bpm: number; bar?: true }
   | { type: 'cancelStale'; keepBpms: number[] }
   /** The arc adds a row: it joins at the loop top `time`, placed at `pan`, with an arrival
    * gesture (filter in or bloom), muted when another row is soloed. */
@@ -732,7 +743,10 @@
   // the pace slider's cadence (@shared/radioSchedule radioCadenceOf): the change phrase, and the
   // turnaround's own phrase, which the slider never moves
   const cadence = radioCadenceOf(s.settings)
-  const adv = advanceRadioClock(before, pos, loopBars, loopBars, cadence.phraseBars, cadence.turnaroundPhraseBars)
+  // the change grid: the whole loop (`loop end: always`), or in the pace's bar band its bar lines
+  // for a pick whose stem fits the loop (radioPaceGridBars)
+  const gridBars = changeGrid(s, cadence, loopBars, s.pending?.slot ?? null, s.pending?.record ?? null)
+  const adv = advanceRadioClock(before, pos, loopBars, gridBars, cadence.phraseBars, cadence.turnaroundPhraseBars)
   let due = adv.due
   // hold freezes the duration since the last change; the lap bookkeeping carries on
   s.clock = s.held ? { ...adv.clock, barsElapsed: before.barsElapsed } : adv.clock
@@ -820,13 +834,14 @@
     s.gestures.every((g) => radioArrivalGestureSpent(g, pos, loopBars))
   ) {
     const p = s.pending
-    if (
-      p?.record &&
-      isReady(s, p.record, s.bpm) &&
-      eligible(s, p.slot) &&
-      radioChangeDueAtNextWrap(s.clock, pos, loopBars, loopBars, cadence.phraseBars)
-    ) {
-      decide(c, p.slot, p.record, true, pickTransition(s.settings.transitions, kindsOf(s, p.slot), c.rnd))
+    if (p?.record && isReady(s, p.record, s.bpm) && eligible(s, p.slot)) {
+      if (radioChangeDueAtNextWrap(s.clock, pos, loopBars, gridBars, cadence.phraseBars)) {
+        decide(c, p.slot, p.record, true, pickTransition(s.settings.transitions, kindsOf(s, p.slot), c.rnd))
+      } else if (cadence.barEvery !== null) {
+        // the bar band: due at a bar line inside this lap -- decided now, a cut on that bar
+        const bar = radioChangeLandsAtBar(s.clock, pos, loopBars, gridBars, cadence.phraseBars)
+        if (bar !== null) decide(c, p.slot, p.record, true, 'cut', bar)
+      }
     }
   }
   scheduleLed(c, t)
@@ -837,16 +852,24 @@
     return
   }
   // THE DUE BRANCH (DP:3504). Restart the interval first.
-  // counted from the wrap it came due on (bar 0: the grid is the whole loop), not the tick
-  s.clock = restartRadioInterval(s.clock, interval(c), pos, 0)
+  // counted from the grid line it came due on (bar 0, a wrap, unless the pace's bar band put
+  // lines inside the lap), not the tick
+  const dueAt = gridBars < loopBars ? Math.floor(pos / gridBars + 1e-9) * gridBars : 0
+  s.clock = restartRadioInterval(s.clock, interval(c, dueAt), pos, dueAt)
   // a change already held: it lands first (DP:3524)
   if (s.led) return
   const p = s.pending
   s.pending = null
   if (p?.record && eligible(s, p.slot)) {
-    // never a second gesture while one is armed (DP:3563)
-    const kind = s.gestures.length === 0 ? pickTransition(s.settings.transitions, kindsOf(s, p.slot), c.rnd) : 'cut'
-    decide(c, p.slot, p.record, false, kind)
+    // the bar band: it cannot land on the line it came due on (that is now), so the next one far
+    // enough ahead, a cut -- or the wrap, with a transition as before, when none is left
+    const bar = gridBars < loopBars ? radioGridLineAtOrAfter(pos + leadBars(s), gridBars, loopBars) : loopBars
+    if (bar < loopBars) decide(c, p.slot, p.record, false, 'cut', bar)
+    else {
+      // never a second gesture while one is armed (DP:3563)
+      const kind = s.gestures.length === 0 ? pickTransition(s.settings.transitions, kindsOf(s, p.slot), c.rnd) : 'cut'
+      decide(c, p.slot, p.record, false, kind)
+    }
     scheduleLed(c, t)
     return
   }
@@ -861,7 +884,8 @@
   c.out.push({ type: 'landed', slot: led.slot, time: led.at!, kind: led.kind, record: led.record })
   commit(s, led.slot, led.record)
   s.lastSlot = led.slot
-  if (led.early) s.clock = restartRadioInterval(s.clock!, interval(c), pos, 0)
+  // an early one's interval counts from where it landed: the wrap, or its bar
+  if (led.early) s.clock = restartRadioInterval(s.clock!, interval(c, led.atBars ?? 0), pos, led.atBars ?? 0)
   s.led = null
   // the leading gesture has fired; an arrival gesture rides the change for one lap
   s.gestures = []
@@ -871,7 +895,7 @@
   arm(c)
 }
 
-function decide(c: Ctx, slot: string, record: IndexRecord, early: boolean, kind: RadioTransitionKind): void {
+function decide(c: Ctx, slot: string, record: IndexRecord, early: boolean, kind: RadioTransitionKind, atBars?: number): void {
   const beats = radioGestureBeats(kind, () => pickDropOutBeats(c.rnd))
   c.s.pending = null
   c.s.led = {
@@ -882,6 +906,7 @@
     beats,
     early,
     at: null,
+    ...(atBars !== undefined && { atBars }),
     notBefore: Number.NEGATIVE_INFINITY,
     waits: 0,
     fails: 0
@@ -894,7 +919,9 @@
   const led = s.led
   const nextWrap = t.nextWrap
   if (!led || led.at !== null || led.cancel || s.tempoLanding || nextWrap === null) return
-  if (nextWrap <= led.notBefore + EPS || !isReady(s, led.record, s.bpm)) return
+  if (!isReady(s, led.record, s.bpm)) return
+  if (led.atBars !== undefined && scheduleLedAtBar(c, led, t)) return
+  if (nextWrap <= led.notBefore + EPS) return
   if (!comingWrapOnPhrase(s, t)) return
   // an arc step has this wrap: radio's change takes the one after
   if (arcStepAt(s, nextWrap)) return
@@ -904,8 +931,48 @@
   c.out.push({
     type: 'landAt',
     time: nextWrap,
+    changes: [{ slot: led.slot, record: led.record, bpm: s.bpm, transition: { kind: led.kind, beats: led.beats } }]
+  })
+}
+
+/** A mid-loop change (the pace's bar band) to the engine: on its bar if that is still far enough
+ * ahead, else the next line of its grid in this lap; with none left, or the engine having refused
+ * a bar line (notBefore), it goes to the loop top instead (`atBars` dropped: the ordinary wrap
+ * path, as a refused swap-now goes topOnly). True when it was handed over. */
+function scheduleLedAtBar(c: Ctx, led: RadioLed, t: RadioTickInfo): boolean {
+  const { s } = c
+  if (led.notBefore > Number.NEGATIVE_INFINITY) {
+    led.atBars = undefined
+    return false
+  }
+  const grid = changeGrid(s, radioCadenceOf(s.settings), t.loopBars, led.slot, led.record)
+  const earliest = t.pos + leadBars(s)
+  const bar = led.atBars! >= earliest ? led.atBars! : radioGridLineAtOrAfter(earliest, grid, t.loopBars)
+  if (!(bar < t.loopBars) || grid >= t.loopBars) {
+    led.atBars = undefined
+    return false
+  }
+  led.atBars = bar
+  led.at = t.now + ((bar - t.pos) * 240) / s.bpm
+  c.out.push({
+    type: 'landAt',
+    time: led.at,
+    bar: true,
     changes: [{ slot: led.slot, record: led.record, bpm: s.bpm, transition: { kind: led.kind, beats: led.beats } }]
   })
+  return true
+}
+
+/** The grid a change of `slot` to `record` may land on (radioPaceGridBars): the loop, or the pace
+ * bar band's lines when the incoming stem fits the loop. The web's `loop end` is always (0). */
+function changeGrid(s: RadioState, cadence: RadioCadence, loopBars: number, slot: string | null, record: IndexRecord | null): number {
+  const outgoing = slot === null ? null : (rowOf(s, slot)?.record?.bars ?? null)
+  return radioPaceGridBars(cadence.barEvery, 0, loopBars, outgoing, record?.bars ?? null)
+}
+
+/** BAR_LEAD_SEC in bars at the tempo playing. */
+function leadBars(s: RadioState): number {
+  return (BAR_LEAD_SEC * s.bpm) / 240
 }
 
 /** The phrase grid (RadioSettings.phraseBars): a change lands only on a loop top that is a whole
@@ -1972,7 +2039,7 @@
   const row = rowOf(s, led.slot)
   if (!row?.record) return
   led.cancel = why
-  c.out.push({ type: 'cancel', slot: led.slot, time: led.at!, record: row.record, bpm: s.bpm })
+  c.out.push({ type: 'cancel', slot: led.slot, time: led.at!, record: row.record, bpm: s.bpm, ...(led.atBars !== undefined && { bar: true as const }) })
 }
 
 /** Hold takes a decided change back: its pick is kept, warm, for when hold is released. */
@@ -2305,6 +2372,7 @@
     const led = s.led
     let bars: number | null
     if (led.at !== null) bars = barsAt(led.at)
+    else if (led.atBars !== undefined) bars = isReady(s, led.record, s.bpm) ? Math.max(0, led.atBars - t.pos) : null
     else {
       const k = radioFrom(isReady(s, led.record, s.bpm) ? 0 : first + 1, led.notBefore)
       bars = k === null ? null : wrapBars(k)
@@ -2314,9 +2382,13 @@
     const ready = !!s.pending.record && isReady(s, s.pending.record, s.bpm)
     // the wrap it comes due on (it is decided a lap ahead when ready, else on that wrap and lands
     // on the next one)
-    const until = radioBarsUntilChange(s.clock, t.pos, loopBars, loopBars, cadence.phraseBars)
+    const grid = changeGrid(s, cadence, loopBars, s.pending.slot, s.pending.record)
+    const until = radioBarsUntilChange(s.clock, t.pos, loopBars, grid, cadence.phraseBars)
     let bars: number | null = null
-    if (until !== null) {
+    if (until !== null && grid < loopBars && t.pos + until < loopBars - EPS) {
+      // the bar band, inside this lap: decided there when ready (else a line or so later)
+      bars = ready ? until : null
+    } else if (until !== null) {
       const k = radioFrom(Math.round((until - toWrap) / loopBars) + (ready ? 0 : 1), Number.NEGATIVE_INFINITY)
       bars = k === null ? null : wrapBars(k)
     }
```

```diff
--- a/src/radio/controller.ts
+++ b/src/radio/controller.ts
@@ -387,7 +387,11 @@
         }
         return
       case 'landAt':
-        for (const ch of a.changes) this.land(ch.slot, this.stems.get(stretchKey(ch.record.id, ch.bpm)), a.time, ch.transition)
+        for (const ch of a.changes) {
+          const stem = this.stems.get(stretchKey(ch.record.id, ch.bpm))
+          if (a.bar) this.landAtBar(ch.slot, stem, a.time)
+          else this.land(ch.slot, stem, a.time, ch.transition)
+        }
         return
       case 'setTempoAt':
         try {
@@ -444,7 +448,9 @@
         this.flashes = dropRadioFlashes(this.flashes, `${a.slot}@${a.time}`)
         let ok = true
         try {
-          e.scheduleSwap(a.slot, this.stem(a.record, a.bpm), a.time, { kind: 'cut' })
+          // a mid-loop one: the playing stem again from that bar line, in phase (a 3 ms dip)
+          if (a.bar) e.scheduleSwapAt(a.slot, this.stem(a.record, a.bpm), a.time)
+          else e.scheduleSwap(a.slot, this.stem(a.record, a.bpm), a.time, { kind: 'cut' })
         } catch (err) {
           ok = false
           this.log(`radio: could not take back the swap on ${a.slot}`, err)
@@ -525,7 +531,25 @@
       case 'landed':
         this.deps.onLanding?.(a.time, a.slot, a.kind, a.record)
         return
+    }
+  }
+
+  /** A mid-loop change (the pace's bar band): a cut at the bar line `at`, in phase
+   * (Engine.scheduleSwapAt). Refused, radio takes it to the loop top. */
+  private landAtBar(slot: string, stem: RowStem | undefined, at: number): void {
+    if (!stem) {
+      this.events.push({ type: 'scheduleFailed', slot, at })
+      return
     }
+    try {
+      this.deps.engine.scheduleSwapAt(slot, stem, at)
+    } catch (err) {
+      this.log(`radio: swap on ${slot} at the bar ${at.toFixed(3)} refused; taking it to the loop top`, err)
+      this.events.push({ type: 'scheduleFailed', slot, at })
+      return
+    }
+    this.flash(slot, radioGestureFlashWord('cut'), at, `${slot}@${at}`)
+    this.events.push({ type: 'scheduled', slot, at, kind: 'cut' })
   }
 
   /** scheduleSwap; a leading gesture with no room left falls back to a cut, as radio does. */
```

- [ ] **Step 4: Run the tests and typecheck.**

Run: `npm run typecheck && npx vitest run src`
Expected: 0 errors. All pass (688 in planning; 96 in `step.test.ts`).

Optionally confirm the realised cadence with a throwaway test (delete it afterwards). Run the Sim at levels 50, 55, 65, 75, 80, 90 and 95 with `phraseBars: 16` for 30 laps. Planning measured mean gaps of 32, 16, 8, 8, 8, 4 and 2.2 s.

- [ ] **Step 5: Commit.**

```bash
git add src/radio/step.ts src/radio/controller.ts src/radio/step.test.ts
git commit -m "radio: the pace slider's bar band -- from 80 a change may land mid-loop on bar lines (every 4, 2, 1 bars), a cut at the stem's matching position (Engine.scheduleSwapAt), any stem no longer than the loop; decided early on its bar or aimed at the next line far enough ahead, its interval counted from that line; a refused bar goes to the loop top; hold takes it back at its bar

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz"
```

---

### Task 6: Desktop, mid-loop landings (phase 2)

**Files (sssketch):** `src/renderer/src/components/DiscoverPanel.tsx`

**Depends on:** Task 4. Runs in parallel with Task 5.

**What changes.** Very little, because the desktop already lands mid-lap cuts. `stage-project`'s `atBars` and `radioChangeLandsAtBar` are how its own-cycle cuts work today.
- The grid becomes `radioPaceGridBars(radioCadence.barEvery, loopEnd, loopBars, outgoing, incoming)`, which is exactly `radioGridBars` below 80.
- Both decision points pass the drawn transition through `radioCadenceTransition`, so a mid-loop landing is a cut and `radioChangeWaitsForLoopTop` lets it land where it came due:
  - the early one with `landsAtBar === null` as "at the loop top";
  - the due branch with `step.wrapped`.

**Timing risks:**
1. **Long stems now stage at `atBars`.** Below 80 only stems of `loop end` bars or fewer did. The engine tiles every stem from the loop top, so an 8-bar stem staged at bar 5 plays its bar 5. That is the same engine path; nothing native changes.
2. **A stage every bar at 94-100** is new load on `stage-project`. Watch the `[radio]` / `radioTrace` lines for late stages in the walkthrough.
3. **The due branch's mid-lap commit** (a cut not predicted early) still goes out as an immediate load-project, 20-65 ms late. That is today's behaviour for own-cycle cuts, now more frequent. Early decision covers most changes (`radioChangeLandsAtBar`).

- [ ] **Step 1: Implement.**

```diff
--- a/src/renderer/src/components/DiscoverPanel.tsx
+++ b/src/renderer/src/components/DiscoverPanel.tsx
@@ -72,9 +72,9 @@
   nextRadioIntervalBarsInWindow,
   pickRadioSlotId,
   radioCadenceOf,
+  radioCadenceTransition,
   radioClockForPace,
-  radioChangeBars,
-  radioGridBars,
+  radioPaceGridBars,
   radioDensityOf,
   radioStarterKinds,
   restartRadioInterval,
@@ -4247,7 +4247,13 @@
         const changing = slotsRef.current.find((sl) => sl.id === pending.slotId)
         // A turnaround armed for this lap ends on the wrap this change waits for: it is the
         // change's lead-in, so the change keeps only an arrival (spec section 3).
-        const drawnTransition = pickTransition(radioSettings.transitions, changing?.kinds ?? [])
+        // In the pace's bar band a change landing mid-loop is a cut (radioCadenceTransition):
+        // an arrival would wait for the top and give the pace back.
+        const drawnTransition = radioCadenceTransition(
+          radioCadence,
+          pickTransition(radioSettings.transitions, changing?.kinds ?? []),
+          landsAtBar === null
+        )
         const transition =
           turnaroundGateNow() === 'arrival'
             ? radioTransitionUnderTurnaround(drawnTransition)
@@ -4614,8 +4620,16 @@
     const pendingPick = radioPendingRef.current
     const outgoingBars =
       pendingPick !== null ? (resolvedBarLengthsRef.current.get(pendingPick.slotId) ?? null) : null
-    const changeBars = radioChangeBars(outgoingBars, pendingPick?.incomingBars ?? null)
-    const gridBars = radioGridBars(radioSettings.loopEndOverBars, loopBars, changeBars)
+    // In the pace slider's bar band (80+) the grid is also its bar lines, for an incoming stem no
+    // longer than the loop, whatever the lengths (radioPaceGridBars); below it this is exactly
+    // radioGridBars of the two lengths, as before.
+    const gridBars = radioPaceGridBars(
+      radioCadence.barEvery,
+      radioSettings.loopEndOverBars,
+      loopBars,
+      outgoingBars,
+      pendingPick?.incomingBars ?? null
+    )
     const step = advanceRadioClock(
       clock,
       pos,
@@ -5178,10 +5192,15 @@
         // has as much right to the lap as a transition does. (A phrase
         // turnaround is handled just below: the change keeps an arrival.)
         const changing = slotsRef.current.find((sl) => sl.id === pending.slotId)
-        const drawnTransition =
+        // The bar band: a change due on a mid-loop boundary is a cut (radioCadenceTransition), so
+        // radioChangeWaitsForLoopTop below lets it land where it came due.
+        const drawnTransition = radioCadenceTransition(
+          radioCadence,
           radioGestureRef.current.length === 0
             ? pickTransition(radioSettings.transitions, changing?.kinds ?? [])
-            : 'cut'
+            : 'cut',
+          step.wrapped
+        )
         // On the wrap that owes the phrase end's roll, that roll comes after this microtask
         // (radioTurnaroundAtWrap) -- but a lead-in drawn here would arm first and keep the lap,
         // and the turnaround would lose the wrap the two share. So the roll runs NOW, as if this
```

- [ ] **Step 2: Typecheck, lint, test.**

Run: `npm run typecheck && npx eslint src/renderer/src/components/DiscoverPanel.tsx && npm test`
Expected: clean and green, as in Task 4.

- [ ] **Step 3: Commit.**

```bash
git add src/renderer/src/components/DiscoverPanel.tsx
git commit -m "discover radio: the pace slider's bar band -- from 80 the change grid is radioPaceGridBars (any stem no longer than the loop on bar lines every 4, 2, 1 bars, staged at its bar like an own-cycle cut, entering at its matching position), and a mid-loop landing is a cut (radioCadenceTransition) so it is not held to the top

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz"
```

---

### Task 7: Shared pieces for rows per change

**Files (sssketch):**
- `src/shared/radioReadout.ts` (+ test): `nextChange.with`. The status line reads `next: row 2 +2 → bloom`, and each companion row reads `next · cut`.
- `src/shared/radioNextLanding.ts` (+ test): `led.with` and `pending.with`, passed through to `nextChange.with`.
- `src/shared/radioManualChanges.ts` (+ test): `mergeStageChanges`' `radioLed.companions`, cuts in the same stage. A manual change on a companion's row wins it.

**Depends on:** nothing in this plan; it uses no new export. Runs in parallel with anything; it is needed by Tasks 8 and 9.

**Timing risk:** none (pure). With `with` / `companions` absent or empty, every output is byte-identical to today's; the tests cover both.

- [ ] **Step 1: Write the failing tests.**

```diff
--- a/src/shared/radioReadout.test.ts
+++ b/src/shared/radioReadout.test.ts
@@ -300,5 +300,35 @@
     expect(radioFlashOpacity(0.5)).toBeCloseTo(1, 9)
     expect(radioFlashOpacity(1)).toBeCloseTo(0, 9)
     expect(radioFlashOpacity(Number.NaN)).toBe(0)
+  })
+})
+
+describe("the pace slider: companions riding radio's change", () => {
+  const rows = ['a', 'b', 'c', 'd'].map((rowId) => ({ rowId, kinds: ['drums' as const], laps: 1 }))
+  const base = {
+    bars: { intoPhrase: 0, phraseBars: 16, loopBars: 4 },
+    armedTurnaround: null,
+    arc: { state: 'off' as const, count: 4, target: 4 },
+    rows
+  }
+  it('the status line counts them; each reads next · cut', () => {
+    const r = radioReadout({
+      ...base,
+      nextChange: { rowId: 'b', kind: 'bloom', barsAway: 1, with: ['c', 'd'] }
+    })
+    expect(r.statusLine).toBe('next: row 2 +2 → bloom · 1 bar')
+    expect(r.rows.map((x) => x.nextLabel)).toEqual([
+      null,
+      'next · bloom',
+      'next · cut',
+      'next · cut'
+    ])
   })
+  it('none, or an empty list, reads as before', () => {
+    const r = radioReadout({
+      ...base,
+      nextChange: { rowId: 'b', kind: null, barsAway: 3, with: [] }
+    })
+    expect(r.statusLine).toBe('next: row 2 · 3 bars')
+  })
 })
```

```diff
--- a/src/shared/radioNextLanding.test.ts
+++ b/src/shared/radioNextLanding.test.ts
@@ -192,3 +192,30 @@
     expect(r.rows[1].nextLabel).toBe('next · bloom')
   })
 })
+
+describe('radioNextLanding: the pace slider companions', () => {
+  it("carries radio's companions on its next, held or armed", () => {
+    const base = { pos: 1, loopBars: 4, course: null, manual: [], arc: null }
+    expect(
+      radioNextLanding({
+        ...base,
+        led: { rowId: 'a', kind: 'cut', atBars: 2, with: ['b'] },
+        pending: null
+      })
+    ).toEqual({ rowId: 'a', kind: 'cut', barsAway: 1, with: ['b'] })
+    expect(
+      radioNextLanding({
+        ...base,
+        led: null,
+        pending: { rowId: 'a', barsUntil: 3, with: ['b', 'c'] }
+      })
+    ).toEqual({ rowId: 'a', kind: null, barsAway: 3, with: ['b', 'c'] })
+    expect(
+      radioNextLanding({ ...base, led: null, pending: { rowId: 'a', barsUntil: 3, with: [] } })
+    ).toEqual({
+      rowId: 'a',
+      kind: null,
+      barsAway: 3
+    })
+  })
+})
```

```diff
--- a/src/shared/radioManualChanges.test.ts
+++ b/src/shared/radioManualChanges.test.ts
@@ -313,5 +313,37 @@
     expect(radioGestureBeats('riser', () => 2)).toBe(8)
     expect(radioGestureBeats('bloom', () => 2)).toBe(4)
     expect(radioGestureBeats('cut', () => 2)).toBe(4)
+  })
+})
+
+describe('mergeStageChanges: the pace slider companions', () => {
+  it("ride radio's change as cuts; a manual change on a companion row wins it", () => {
+    const led = {
+      slotId: 'a',
+      stem: 'A',
+      arrival: { kind: 'bloom' as RadioTransitionKind, beats: 4 },
+      companions: [
+        { slotId: 'b', stem: 'B' },
+        { slotId: 'c', stem: 'C' }
+      ]
+    }
+    const manual = new Map([['c', { stem: 'C2', joining: false, arrival: null }]])
+    expect(mergeStageChanges(led, manual)).toEqual({
+      changes: [
+        { slotId: 'a', stem: 'A' },
+        { slotId: 'b', stem: 'B' },
+        { slotId: 'c', stem: 'C2' }
+      ],
+      joining: [],
+      arrivals: [{ slotId: 'a', kind: 'bloom', beats: 4 }]
+    })
   })
+
+  it('none, or no radio change, is as before', () => {
+    expect(mergeStageChanges(null, new Map()).changes).toEqual([])
+    expect(
+      mergeStageChanges({ slotId: 'a', stem: 'A', arrival: null, companions: [] }, new Map())
+        .changes
+    ).toEqual([{ slotId: 'a', stem: 'A' }])
+  })
 })
```

- [ ] **Step 2: Run them and see them fail.**

Run: `npx vitest run src/shared/radioReadout.test.ts src/shared/radioNextLanding.test.ts src/shared/radioManualChanges.test.ts`
Expected: FAIL. `with` and `companions` are unknown, and the status line lacks `+2`.

- [ ] **Step 3: Implement.**

```diff
--- a/src/shared/radioReadout.ts
+++ b/src/shared/radioReadout.ts
@@ -73,6 +73,9 @@
     adding?: boolean
     /** A course change: every row it turns over (`rowId` among them). */
     course?: readonly string[]
+    /** The pace slider's extra rows riding radio's change (its companions), cuts landing with
+     * it: `next: row 2 +2 → bloom`, and each of them reads `next · cut`. */
+    with?: readonly string[]
   } | null
   /** The turnaround armed for the phrase's end, or a turn waiting; `move` null while a turn
    * waits for its roll. */
@@ -221,7 +224,9 @@
   if (n === null) return null
   if (n.barsAway === null || !Number.isFinite(n.barsAway)) return 'next: soon'
   const i = input.rows.findIndex((r) => r.rowId === n.rowId)
-  const who = n.course ? 'course change' : i >= 0 && !n.adding ? `row ${i + 1}` : 'a new row'
+  const extra = !n.course && n.with && n.with.length > 0 ? ` +${n.with.length}` : ''
+  const who =
+    (n.course ? 'course change' : i >= 0 && !n.adding ? `row ${i + 1}` : 'a new row') + extra
   const how = n.course ? '' : n.leaving ? ' leaves' : n.kind !== null ? ` → ${n.kind}` : ''
   const bars = Math.max(1, Math.ceil(n.barsAway - 1e-6))
   return `next: ${who}${how} · ${plural(bars, 'bar')}`
@@ -244,10 +249,13 @@
     statusLine,
     ruler: { ticks, filled, end: rulerEnd(input.armedTurnaround) },
     rows: input.rows.map((r) => {
+      const companion =
+        next !== null && next.rowId !== r.rowId && (next.with?.includes(r.rowId) ?? false)
       const isNext =
-        next !== null && (next.rowId === r.rowId || (next.course?.includes(r.rowId) ?? false))
-      const leaving = isNext && !!next.leaving
-      const nextKind = isNext && !leaving ? next.kind : null
+        next !== null &&
+        (next.rowId === r.rowId || (next.course?.includes(r.rowId) ?? false) || companion)
+      const leaving = isNext && !companion && !!next.leaving
+      const nextKind = companion ? 'cut' : isNext && !leaving ? next.kind : null
       return {
         rowId: r.rowId,
         label: radioRowLabel(r),
```

```diff
--- a/src/shared/radioNextLanding.ts
+++ b/src/shared/radioNextLanding.ts
@@ -21,9 +21,15 @@
   course: readonly string[] | null
   /** Radio's held change: how it arrives, and the bar of this lap it lands on (undefined: the
    * top). */
-  led: { rowId: string; kind: RadioTransitionKind; atBars?: number } | null
+  led: {
+    rowId: string
+    kind: RadioTransitionKind
+    atBars?: number
+    /** The pace slider's companions riding it (radioReadout's `with`). */
+    with?: readonly string[]
+  } | null
   /** Radio's armed pick and the bars until it comes due (radioBarsUntilChange), null unknown. */
-  pending: { rowId: string; barsUntil: number | null } | null
+  pending: { rowId: string; barsUntil: number | null; with?: readonly string[] } | null
   /** Changes queued for the next top, the arc's joining row among them: how each arrives, and
    * whether its stem is warm (a cold one waits for a later top, bar unknown). */
   manual: readonly { rowId: string; kind: RadioTransitionKind | null; ready: boolean }[]
@@ -127,14 +133,16 @@
     candidates.push({
       rowId: input.led.rowId,
       kind: input.led.kind,
-      barsAway: Math.max(0, at - pos)
+      barsAway: Math.max(0, at - pos),
+      ...(input.led.with && input.led.with.length > 0 && { with: input.led.with })
     })
   } else if (input.pending !== null) {
     const b = input.pending.barsUntil
     candidates.push({
       rowId: input.pending.rowId,
       kind: null,
-      barsAway: b !== null && Number.isFinite(b) ? Math.max(0, b) : null
+      barsAway: b !== null && Number.isFinite(b) ? Math.max(0, b) : null,
+      ...(input.pending.with && input.pending.with.length > 0 && { with: input.pending.with })
     })
   }
 
```

```diff
--- a/src/shared/radioManualChanges.ts
+++ b/src/shared/radioManualChanges.ts
@@ -92,9 +92,18 @@
  *
  * A manual change on the row radio was about to turn over wins: the user
  * pointed at that row, radio only drew it. Generic over the stem type so
- * this stays free of the renderer's own stem shape. */
+ * this stays free of the renderer's own stem shape.
+ *
+ * `companions` (the pace slider's rows per change, 2026-10-03) ride radio's change as cuts in the
+ * same stage, so they land or are taken back with it, atomically. A manual change on a
+ * companion's row wins it, as on radio's own. */
 export function mergeStageChanges<S>(
-  radioLed: { slotId: string; stem: S; arrival: ManualArrival | null } | null,
+  radioLed: {
+    slotId: string
+    stem: S
+    arrival: ManualArrival | null
+    companions?: readonly { slotId: string; stem: S }[]
+  } | null,
   manual: ReadonlyMap<string, { stem: S; joining: boolean; arrival: ManualArrival | null }>
 ): {
   changes: { slotId: string; stem: S }[]
@@ -110,6 +119,10 @@
       arrivals.push({ slotId: radioLed.slotId, ...radioLed.arrival })
     }
   }
+  for (const k of radioLed?.companions ?? []) {
+    if (k.slotId === radioLed!.slotId || manual.has(k.slotId)) continue
+    changes.push({ slotId: k.slotId, stem: k.stem })
+  }
   for (const [slotId, change] of manual) {
     changes.push({ slotId, stem: change.stem })
     if (change.joining) joining.push(slotId)
```

- [ ] **Step 4: Run, lint, typecheck, and keep the web radio green.**

```bash
npx vitest run src/shared && npx eslint --fix src/shared/radioReadout.ts src/shared/radioReadout.test.ts src/shared/radioNextLanding.ts src/shared/radioNextLanding.test.ts src/shared/radioManualChanges.ts src/shared/radioManualChanges.test.ts && npm run typecheck
cd /Users/nickel/Claudecode/ell.ing/radio && npm run typecheck && npx vitest run src
```

- [ ] **Step 5: Commit (in sssketch).**

```bash
git add src/shared/radioReadout.ts src/shared/radioReadout.test.ts src/shared/radioNextLanding.ts src/shared/radioNextLanding.test.ts src/shared/radioManualChanges.ts src/shared/radioManualChanges.test.ts
git commit -m "radio: rows per change, the shared half -- the readout's next counts the companions riding radio's change (next: row 2 +2 -> bloom, each reads next · cut), radioNextLanding carries them, and mergeStageChanges stages them with radio's change as cuts (a manual change on one wins its row)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz"
```

---

### Task 8: Web radio, rows per change (phase 3)

**Files (ell.ing/radio):** `src/radio/step.ts` and `src/radio/step.test.ts`. `controller.ts` needs nothing: companions are ordinary `landAt` and `cancel` actions.

**Depends on:** Tasks 5 and 7.

**The lifecycle, all in `step.ts`:**
- **`arm()`** draws the row count, `radioPaceRowsThisChange(radioCadenceOf(settings), rnd)`, which makes no draw while it is 1. It picks the rows with `pickRadioSlotIds`, whose first is exactly today's pick. Rows after the first become `pending.companions`, each armed with its own token.
- **`picked()`** fills a companion's record, or drops the companion when nothing matches.
- **`wants()`** warms the companions' stems, and `pushArm`'s `usedElsewhere` includes them.
- **`decide()`** carries the companions that are warm, eligible, not manual and not leaving into `led.companions`. Any that are not ready are dropped.
- **The `scheduled` event** for radio's own change sends the companions (`sendCompanions`): one `landAt` for the same time, `bar` when the change is mid-loop, cuts. Each companion's own `scheduled` marks it `accepted`. A companion's `scheduleFailed` drops it.
- **`land()`** commits each accepted companion and emits its `landed`. Every row counts a turn, and `lastSlot` stays radio's own row.
- **`cancelLed()`** sends the companions' cancels **before** the change's own, so their answers arrive while `s.led` still exists. In `unscheduled()`, a companion whose take-back was refused goes to `companionsLanding` and is committed by `companionsLandingTick` at its time.
- **`dropCompanion()`** handles a swap-now on a companion's row, or the arc taking it out. It drops the companion if it is not yet sent; if it is sent, it marks it `withdrawn` and cancels it on its own.
- **`removalVictim`** excludes companion rows.
- **The readout's `coming()`** passes `with`.

**Timing risks.** These are the review's focus.
1. **The answer order inside one dispatch.** The companions are sent only in reaction to the change's own `scheduled`. Their `landAt` is emitted from that reducer call, after the change's. The Sim (and the controller's event loop) answers synchronously, in order; a test asserts that the companions' `landAt` shares the change's time.
2. **Cancel order.** The companions' cancels go first. If the change's `unscheduled` came first, `s.led` would be cleared (or turned back into a pending pick by `unholdLed`), and the companions' answers would find nothing: a desync, with the engine landing a stem the state never committed. A test checks the order.
3. **Too-late take-backs.** With `cancelOk = false`, the change itself lands as well (`led.cancel` cleared). The companion is in `companionsLanding` and must not also be committed by `land()`: `land()` skips companions removed from the list. A test checks the companion's row ends with the companion's record exactly once.
4. **No `random` draw below 70.** Every existing seeded test must be unchanged. If any existing test's numbers move, the draw order is wrong.
5. **The arc must not take out a companion's row.** If a later change touches `removalVictim`, keep the companion exclusion.

- [ ] **Step 1: Write the failing tests.**

```diff
--- a/src/radio/step.test.ts
+++ b/src/radio/step.test.ts
@@ -1734,5 +1734,111 @@
     sim.run(8 * LAP + 1 / 30, 24 * LAP)
     expect(sim.of('landed').some((l) => !onWrap(l.time))).toBe(true)
     for (const a of sim.of('turnaround')) expect((a.time / LAP) % 4).toBe(0)
+  })
+})
+
+describe('the pace: rows per change (companions; sssketch spec 2026-10-03-radio-pace-slider-design section 3)', () => {
+  it('up to 70 radio arms one row, with exactly the draws it always made', () => {
+    for (const level of [0, 50, 70]) {
+      const a = new Sim({ paceLevel: level, paceBars: { min: 4, max: 4 } }, seeded(11))
+      a.send({ type: 'play' })
+      a.run(0, 6 * LAP)
+      expect(a.of('arm').every((x) => a.of('arm').filter((y) => y.token === x.token).length === 1)).toBe(true)
+      expect(a.s.pending?.companions).toBeUndefined()
+      // one landing per landAt, never two rows at once
+      expect(a.of('landAt').every((x) => x.changes.length === 1)).toBe(true)
+    }
+  })
+
+  it('at 100 a change lands with three more rows, together, as cuts', () => {
+    const sim = new Sim({ paceLevel: 100 }, seeded(12))
+    sim.send({ type: 'play' })
+    const turn0 = sim.s.turn
+    sim.run(0, 8 * LAP)
+    const byTime = new Map<number, string[]>()
+    for (const l of sim.of('landed')) byTime.set(l.time, [...(byTime.get(l.time) ?? []), l.slot])
+    const sizes = [...byTime.values()].map((v) => v.length)
+    // four rows on the bed (the arc is off): the primary and up to three companions
+    expect(Math.max(...sizes)).toBe(4)
+    for (const rows of byTime.values()) expect(new Set(rows).size).toBe(rows.length)
+    // the companions' landAt follows the change's own, at its time, cuts
+    const lands = sim.of('landAt')
+    for (const a of lands.filter((x) => x.changes.length > 1)) {
+      expect(a.changes.every((ch) => ch.transition.kind === 'cut')).toBe(true)
+      expect(lands.some((b) => b !== a && b.time === a.time && b.changes.length === 1)).toBe(true)
+    }
+    // every row changed counts a turn
+    expect(sim.s.turn - turn0).toBe(sim.of('landed').length)
+  })
+
+  it('a companion not warm by the decision is dropped, never waited for', () => {
+    const sim = new Sim({ paceLevel: 100 }, seeded(13))
+    // a companion's stem never finishes stretching: picked while its arm is answered, it is held
+    let i = 0
+    sim.pickFor = (slot) => {
+      const r = rec(`p-${slot}-${i++}`)
+      if (sim.s.pending?.companions?.some((k) => k.slot === slot)) sim.withhold.add(r.id)
+      return r
+    }
+    sim.send({ type: 'play' })
+    sim.run(0, 4 * LAP)
+    const lands = sim.of('landed')
+    expect(lands.length).toBeGreaterThan(3)
+    const times = new Set(lands.map((l) => l.time))
+    expect(times.size).toBe(lands.length)
+  })
+
+  it('hold takes the change and its companions back', () => {
+    const sim = new Sim({ paceLevel: 100 }, seeded(14))
+    sim.send({ type: 'play' })
+    let t = 0
+    while (!(sim.s.led?.companions?.some((k) => k.accepted) && sim.s.led.at != null) && t < 20 * LAP) sim.run(t, (t += 1 / 30))
+    const led = sim.s.led!
+    const landedBefore = sim.of('landed').length
+    sim.send({ type: 'hold', on: true })
+    const cancels = sim.of('cancel').filter((a) => a.time === led.at)
+    expect(cancels.map((a) => a.slot).sort()).toEqual([led.slot, ...led.companions!.filter((k) => k.sent).map((k) => k.slot)].sort())
+    // the companions' cancels go first
+    expect(cancels.at(-1)!.slot).toBe(led.slot)
+    sim.run(t + 1 / 30, t + 2 * LAP)
+    expect(sim.of('landed').length).toBe(landedBefore)
   })
+
+  it('a companion the engine will not give back is committed when it lands', () => {
+    const sim = new Sim({ paceLevel: 100 }, seeded(15))
+    sim.send({ type: 'play' })
+    let t = 0
+    while (!(sim.s.led?.companions?.some((k) => k.accepted) && sim.s.led.at != null) && t < 20 * LAP) sim.run(t, (t += 1 / 30))
+    const led = sim.s.led!
+    const comp = led.companions!.find((k) => k.accepted)!
+    sim.cancelOk = false
+    sim.send({ type: 'hold', on: true })
+    // the change itself could not be taken back either: it lands, with its companion
+    sim.run(t + 1 / 30, led.at! + 0.1)
+    expect(sim.of('landed').some((l) => l.slot === comp.slot && l.time === led.at)).toBe(true)
+    expect(sim.s.rows.find((r) => r.id === comp.slot)!.record).toBe(comp.record)
+  })
+
+  it('a swap-now on a companion row takes the companion back on its own', () => {
+    const sim = new Sim({ paceLevel: 100 }, seeded(16))
+    sim.send({ type: 'play' })
+    let t = 0
+    while (!(sim.s.led?.companions?.some((k) => k.accepted) && sim.s.led.at != null) && t < 20 * LAP) sim.run(t, (t += 1 / 30))
+    const led = sim.s.led!
+    const comp = led.companions!.find((k) => k.accepted)!
+    sim.send({ type: 'swapNow', slot: comp.slot })
+    expect(sim.of('cancel').at(-1)).toMatchObject({ slot: comp.slot, time: led.at })
+    expect(sim.s.led?.companions?.some((k) => k.slot === comp.slot) ?? false).toBe(false)
+    sim.run(t + 1 / 30, led.at! + 0.1)
+    expect(sim.of('landed').some((l) => l.slot === comp.slot && l.time === led.at && l.record === comp.record)).toBe(false)
+  })
+
+  it('the readout counts the companions riding the next change', () => {
+    const sim = new Sim({ paceLevel: 100 }, seeded(17))
+    sim.send({ type: 'play' })
+    let t = 0
+    while (!sim.s.led?.companions?.length && t < 20 * LAP) sim.run(t, (t += 1 / 30))
+    const v = view(sim.s)
+    expect(v.readout!.statusLine).toMatch(/next: row \d \+\d/)
+  })
 })
```

- [ ] **Step 2: Run them and see them fail.**

Run: `npx vitest run src/radio/step.test.ts`
Expected: typecheck errors (`companions`), then failures.

- [ ] **Step 3: Implement.**

```diff
--- a/src/radio/step.ts
+++ b/src/radio/step.ts
@@ -85,6 +85,7 @@
   radioGridLineAtOrAfter,
   radioPaceGridBars,
   radioPaceLevelOf,
+  pickRadioSlotIds,
   radioPhraseLaps,
   radioStarterKinds,
   RADIO_CHANNELS_MAX,
@@ -92,7 +93,7 @@
   type RadioCadence,
   type RadioClock
 } from '@shared/radioSchedule'
-import { normalizeRadioPaceLevel } from '@shared/radioPace'
+import { normalizeRadioPaceLevel, radioPaceRowsThisChange } from '@shared/radioPace'
 import {
   forgetRadioSlotFlagOnChange,
   NO_RADIO_SLOT_FLAGS,
@@ -229,6 +230,22 @@
   slot: string
   token: number
   record: IndexRecord | null
+  /** The pace slider's extra rows for this change (rows per change, 70+): picked and warmed with
+   * it, riding it as cuts if ready when it is decided. Absent for one row. */
+  companions?: RadioPending[]
+}
+
+/** A companion riding a decided change (RadioLed.companions): sent to the engine only once the
+ * engine has accepted the change itself, landing with it on its time, as a cut. */
+export interface RadioLedCompanion {
+  slot: string
+  record: IndexRecord
+  /** Handed to the engine (a landAt for the led's time). */
+  sent: boolean
+  /** The engine accepted it. */
+  accepted: boolean
+  /** Taken back on its own (a swap-now on its row, the row leaving): its answer is awaited. */
+  withdrawn?: boolean
 }
 
 /** radioLedChangeRef: a change decided and waiting for its wrap. */
@@ -255,6 +272,8 @@
   fails: number
   /** A cancel is on its way to the engine: why. */
   cancel?: 'hold' | 'withdraw' | 'drop'
+  /** The pace slider's extra rows riding this change (RadioLedCompanion). */
+  companions?: RadioLedCompanion[]
 }
 
 export interface RadioTickInfo {
@@ -380,6 +399,9 @@
   /** The folds are owed an unfold at the next loop top the engine can take (the mode going off,
    * a pace change): the next tick hands the engine an empty table for it. */
   foldClear: boolean
+  /** Companions whose take-back the engine refused (too late): they land at `at` regardless, and
+   * are committed then, so the state never disagrees with what plays. */
+  companionsLanding: { slot: string; record: IndexRecord; at: number }[]
 }
 
 export type RadioEvent =
@@ -529,7 +551,8 @@
     fold: null,
     foldNow: null,
     foldNext: null,
-    foldClear: false
+    foldClear: false,
+    companionsLanding: []
   }
 }
 
@@ -641,8 +664,16 @@
       break
     case 'scheduled': {
       const led = s.led
+      // a companion accepted
+      const comp = led?.companions?.find((k) => k.slot === event.slot && k.sent)
+      if (led && comp && led.slot !== event.slot && led.at === event.at) {
+        comp.accepted = true
+        break
+      }
       if (!led || led.slot !== event.slot || led.at !== event.at) break
       led.kind = event.kind
+      // the change itself is on the engine: its companions go now, for the same time, as cuts
+      sendCompanions(c, led)
       // the lap's one leading gesture, now on the outgoing stem (REPLACES the list, DP:2761)
       if (radioGestureLeadsChange(event.kind)) {
         s.gestures = [{ kind: event.kind, slot: led.slot, beats: led.beats, lapsLeft: 1, at: event.at }]
@@ -650,6 +681,11 @@
       break
     }
     case 'scheduleFailed':
+      // a companion refused: it is dropped, and its row keeps what it plays
+      if (s.led?.companions?.some((k) => k.slot === event.slot && k.sent) && s.led.slot !== event.slot) {
+        s.led.companions = s.led.companions.filter((k) => k.slot !== event.slot)
+        break
+      }
       if (s.led && s.led.slot === event.slot && s.led.at === event.at) {
         s.led.at = null
         s.led.notBefore = event.at
@@ -770,6 +806,8 @@
     if (!cleared) foldAtWrap(c, t)
   }
 
+  // companions the engine would not give back land on their time
+  companionsLandingTick(c, t)
   // swap-now: land what has reached its bar, schedule what is ready (radio's own landing below
   // may end this tick, and must not hold these up)
   manualTick(c, t)
@@ -836,11 +874,11 @@
     const p = s.pending
     if (p?.record && isReady(s, p.record, s.bpm) && eligible(s, p.slot)) {
       if (radioChangeDueAtNextWrap(s.clock, pos, loopBars, gridBars, cadence.phraseBars)) {
-        decide(c, p.slot, p.record, true, pickTransition(s.settings.transitions, kindsOf(s, p.slot), c.rnd))
+        decide(c, p.slot, p.record, true, pickTransition(s.settings.transitions, kindsOf(s, p.slot), c.rnd), undefined, p.companions)
       } else if (cadence.barEvery !== null) {
         // the bar band: due at a bar line inside this lap -- decided now, a cut on that bar
         const bar = radioChangeLandsAtBar(s.clock, pos, loopBars, gridBars, cadence.phraseBars)
-        if (bar !== null) decide(c, p.slot, p.record, true, 'cut', bar)
+        if (bar !== null) decide(c, p.slot, p.record, true, 'cut', bar, p.companions)
       }
     }
   }
@@ -864,11 +902,11 @@
     // the bar band: it cannot land on the line it came due on (that is now), so the next one far
     // enough ahead, a cut -- or the wrap, with a transition as before, when none is left
     const bar = gridBars < loopBars ? radioGridLineAtOrAfter(pos + leadBars(s), gridBars, loopBars) : loopBars
-    if (bar < loopBars) decide(c, p.slot, p.record, false, 'cut', bar)
+    if (bar < loopBars) decide(c, p.slot, p.record, false, 'cut', bar, p.companions)
     else {
       // never a second gesture while one is armed (DP:3563)
       const kind = s.gestures.length === 0 ? pickTransition(s.settings.transitions, kindsOf(s, p.slot), c.rnd) : 'cut'
-      decide(c, p.slot, p.record, false, kind)
+      decide(c, p.slot, p.record, false, kind, undefined, p.companions)
     }
     scheduleLed(c, t)
     return
@@ -883,6 +921,12 @@
   const { s } = c
   c.out.push({ type: 'landed', slot: led.slot, time: led.at!, kind: led.kind, record: led.record })
   commit(s, led.slot, led.record)
+  // its companions the engine accepted land with it (one never accepted is not on the engine)
+  for (const k of led.companions ?? []) {
+    if (!k.accepted || k.withdrawn) continue
+    c.out.push({ type: 'landed', slot: k.slot, time: led.at!, kind: 'cut', record: k.record })
+    commit(s, k.slot, k.record)
+  }
   s.lastSlot = led.slot
   // an early one's interval counts from where it landed: the wrap, or its bar
   if (led.early) s.clock = restartRadioInterval(s.clock!, interval(c, led.atBars ?? 0), pos, led.atBars ?? 0)
@@ -895,8 +939,22 @@
   arm(c)
 }
 
-function decide(c: Ctx, slot: string, record: IndexRecord, early: boolean, kind: RadioTransitionKind, atBars?: number): void {
+function decide(
+  c: Ctx,
+  slot: string,
+  record: IndexRecord,
+  early: boolean,
+  kind: RadioTransitionKind,
+  atBars?: number,
+  companions: readonly RadioPending[] = []
+): void {
+  const { s } = c
   const beats = radioGestureBeats(kind, () => pickDropOutBeats(c.rnd))
+  // the companions that can ride it now: warm, still radio's to change, not the change's own row.
+  // One not ready is dropped, never waited for -- its row is radio's again at the next arm
+  const riding = companions
+    .filter((k) => k.slot !== slot && k.record && isReady(s, k.record, s.bpm) && eligible(s, k.slot) && !s.manual[k.slot] && s.removing?.slot !== k.slot)
+    .map((k) => ({ slot: k.slot, record: k.record!, sent: false, accepted: false }))
   c.s.pending = null
   c.s.led = {
     slot,
@@ -907,6 +965,7 @@
     early,
     at: null,
     ...(atBars !== undefined && { atBars }),
+    ...(riding.length > 0 && { companions: riding }),
     notBefore: Number.NEGATIVE_INFINITY,
     waits: 0,
     fails: 0
@@ -1200,6 +1259,8 @@
     next
   }
   pushArm(c, slot, s.manual[slot].token)
+  // a companion on this row gives way to the press
+  dropCompanion(c, slot)
   let rearm = false
   if (s.pending?.slot === slot) {
     s.pending = null
@@ -1252,7 +1313,53 @@
     m.at = time
     m.mode = mode
     c.out.push({ type: 'swapAt', slot: m.slot, time, record: m.record, bpm, mode })
+  }
+}
+
+/** Companions whose take-back came too late: committed as they land. */
+function companionsLandingTick(c: Ctx, t: RadioTickInfo): void {
+  const { s } = c
+  if (s.companionsLanding.length === 0) return
+  const due = s.companionsLanding.filter((k) => t.now >= k.at - EPS)
+  s.companionsLanding = s.companionsLanding.filter((k) => t.now < k.at - EPS)
+  for (const k of due) {
+    c.out.push({ type: 'landed', slot: k.slot, time: k.at, kind: 'cut', record: k.record })
+    commit(s, k.slot, k.record)
+  }
+}
+
+/** The change itself is on the engine: its companions go for the same time, as cuts -- at a bar
+ * line when it is mid-loop. Sent once; the engine's answers mark each accepted, or drop it. */
+function sendCompanions(c: Ctx, led: RadioLed): void {
+  const { s } = c
+  const unsent = (led.companions ?? []).filter((k) => !k.sent)
+  if (unsent.length === 0 || led.at === null) return
+  for (const k of unsent) k.sent = true
+  c.out.push({
+    type: 'landAt',
+    time: led.at,
+    ...(led.atBars !== undefined && { bar: true as const }),
+    changes: unsent.map((k) => ({ slot: k.slot, record: k.record, bpm: s.bpm, transition: { kind: 'cut' as const, beats: 0 } }))
+  })
+}
+
+/** A row's companion is withdrawn (a swap-now pressed on it, the row going): not yet sent, it is
+ * simply dropped; already on the engine, it is taken back on its own. */
+function dropCompanion(c: Ctx, slot: string): void {
+  const { s } = c
+  if (s.pending?.companions?.some((k) => k.slot === slot)) s.pending.companions = s.pending.companions.filter((k) => k.slot !== slot)
+  const led = s.led
+  const comp = led?.companions?.find((k) => k.slot === slot)
+  if (!led || !comp) return
+  if (!comp.sent || led.at === null) {
+    led.companions = led.companions!.filter((k) => k !== comp)
+    return
   }
+  const row = rowOf(s, slot)
+  if (!row?.record) return
+  // answered by unscheduled(): taken back, it is gone; too late, it lands (companionsLanding)
+  comp.withdrawn = true
+  c.out.push({ type: 'cancel', slot, time: led.at, record: row.record, bpm: s.bpm, ...(led.atBars !== undefined && { bar: true as const }) })
 }
 
 /** commitSlotPick for a manual change: turn, changedAt, a replace-soon flag honoured. Radio's
@@ -1345,8 +1452,10 @@
   const victim = removalVictim(s)
   if (!victim) return
   s.removing = { slot: victim.id, at: null, notBefore: Number.NEGATIVE_INFINITY, fails: 0 }
-  // radio's pick for the leaving row is dropped, and radio picks again among the rest
+  // radio's pick for the leaving row is dropped, and radio picks again among the rest; a
+  // companion on it just goes
   if (s.pending?.slot === victim.id) arm(c)
+  else dropCompanion(c, victim.id)
 }
 
 /** startAdd's slot: the first of the starter order not on the bed, or null with every slot on it. */
@@ -1367,6 +1476,7 @@
       s.flags[r.id] !== 'hook' &&
       !s.manual[r.id] &&
       s.led?.slot !== r.id &&
+      !s.led?.companions?.some((k) => k.slot === r.id) &&
       !lastOfItsKind(r)
   )
   if (candidates.length === 0) return null
@@ -1469,16 +1579,23 @@
   s.rearmAtWrap = false
   // never a row with a swap-now waiting: it wins the row (armRadioPick skips waiting rows, DP:5566)
   const eligibleIds = s.rows.filter((r) => eligible(s, r.id) && !s.manual[r.id] && s.removing?.slot !== r.id).map((r) => r.id)
-  const slot = pickRadioSlotId(eligibleIds, s.lastSlot, {
+  // rows per change (the pace slider, 70+): no draw while it is one, and then the first row is
+  // exactly pickRadioSlotId's, with the same draws (pickRadioSlotIds)
+  const rows = radioPaceRowsThisChange(radioCadenceOf(s.settings), c.rnd)
+  const [slot, ...more] = pickRadioSlotIds(eligibleIds, s.lastSlot, rows, {
     turnover: s.settings.turnover,
     changedAt: s.changedAt,
     turn: s.turn,
     flags: s.flags,
     random: c.rnd
   })
-  if (slot === null) return
+  if (slot === undefined) return
   s.pending = { slot, token: ++s.token, record: null }
   pushArm(c, slot, s.pending.token)
+  if (more.length > 0) {
+    s.pending.companions = more.map((id) => ({ slot: id, token: ++s.token, record: null }))
+    for (const k of s.pending.companions) pushArm(c, k.slot, k.token)
+  }
 }
 
 function pushArm(c: Ctx, slot: string, token: number, kinds: readonly DiscoverSlotKind[] = kindsOf(s0(c), slot)): void {
@@ -1495,7 +1612,9 @@
       ...s.rows.filter((r) => r.record).map((r) => r.record!.id),
       ...Object.values(s.manual).flatMap((m) => (m.record ? [m.record.id] : [])),
       // and radio's incoming stems, so a swap-now does not land the one radio is about to
-      ...[s.pending?.record, s.led?.record, s.adding?.record].flatMap((r) => (r ? [r.id] : []))
+      ...[s.pending?.record, s.led?.record, s.adding?.record].flatMap((r) => (r ? [r.id] : [])),
+      // and the stems riding radio's change
+      ...[...(s.pending?.companions ?? []), ...(s.led?.companions ?? [])].flatMap((k) => (k.record ? [k.record.id] : []))
     ],
     targetBpm: s.tempoTarget ?? s.tempoLanding?.bpm ?? s.bpm,
     ...clashFor(s, slot)
@@ -1534,6 +1653,13 @@
     else dropManual(c, m, 'nothing to pick')
     return
   }
+  // a companion's pick: kept, or with no match dropped (the change goes ahead with fewer rows)
+  const comp = s.phase === 'running' ? s.pending?.companions?.find((k) => k.token === token && k.slot === slot) : undefined
+  if (comp) {
+    if (record) comp.record = record
+    else s.pending!.companions = s.pending!.companions!.filter((k) => k !== comp)
+    return
+  }
   if (s.phase !== 'running' || !s.pending || s.pending.token !== token || s.pending.slot !== slot) return
   // no match: radio idles until the next due, which arms again (DP:5583)
   if (!record) s.pending = null
@@ -1558,7 +1684,7 @@
   }
   if (s.phase !== 'running') return w
   const target = s.tempoTarget
-  for (const x of [s.pending, s.led]) {
+  for (const x of [s.pending, s.led, ...(s.pending?.companions ?? []), ...(s.led?.companions ?? [])]) {
     if (!x?.record) continue
     w.push({ record: x.record, bpm: s.bpm, priority: 'now' })
     if (target !== null) w.push({ record: x.record, bpm: target, priority: 'now' })
@@ -2039,7 +2165,14 @@
   const row = rowOf(s, led.slot)
   if (!row?.record) return
   led.cancel = why
-  c.out.push({ type: 'cancel', slot: led.slot, time: led.at!, record: row.record, bpm: s.bpm, ...(led.atBars !== undefined && { bar: true as const }) })
+  const bar = led.atBars !== undefined ? { bar: true as const } : {}
+  // its companions first, so their answers come back while the change is still held (the
+  // change's own answer can end it)
+  for (const k of led.companions ?? []) {
+    const krow = rowOf(s, k.slot)
+    if (k.sent && krow?.record) c.out.push({ type: 'cancel', slot: k.slot, time: led.at!, record: krow.record, bpm: s.bpm, ...bar })
+  }
+  c.out.push({ type: 'cancel', slot: led.slot, time: led.at!, record: row.record, bpm: s.bpm, ...bar })
 }
 
 /** Hold takes a decided change back: its pick is kept, warm, for when hold is released. */
@@ -2058,6 +2191,13 @@
 function unscheduled(c: Ctx, slot: string, at: number, ok: boolean): void {
   const { s } = c
   const led = s.led
+  // a companion taken back -- or too late to: then it lands, and is committed when it does
+  const comp = led?.companions?.find((k) => k.slot === slot && k.sent)
+  if (led && comp && led.slot !== slot && led.at === at && (led.cancel || comp.withdrawn)) {
+    led.companions = led.companions!.filter((k) => k !== comp)
+    if (!ok && comp.accepted) s.companionsLanding.push({ slot, record: comp.record, at })
+    return
+  }
   if (led && led.slot === slot && led.at === at && led.cancel) {
     if (!ok) {
       // too late to take back: it lands
@@ -2083,8 +2223,12 @@
     settings: { ...s.settings, paceBars: { ...s.settings.paceBars } },
     rows: s.rows.map((r) => ({ ...r })),
     clock: s.clock && { ...s.clock },
-    pending: s.pending && { ...s.pending },
-    led: s.led && { ...s.led },
+    pending: s.pending && {
+      ...s.pending,
+      ...(s.pending.companions && { companions: s.pending.companions.map((k) => ({ ...k })) })
+    },
+    led: s.led && { ...s.led, ...(s.led.companions && { companions: s.led.companions.map((k) => ({ ...k })) }) },
+    companionsLanding: s.companionsLanding.map((k) => ({ ...k })),
     gestures: s.gestures.map((g) => ({ ...g })),
     changedAt: new Map(s.changedAt),
     seedTries: { ...s.seedTries },
@@ -2296,6 +2440,8 @@
   kind: RadioTransitionKind | null
   bars: number | null
   leaving: boolean
+  /** The pace slider's companions riding radio's change. */
+  with?: string[]
 }
 
 function coming(s: RadioState): { radio: Coming | null; arc: Coming | null } {
@@ -2377,7 +2523,8 @@
       const k = radioFrom(isReady(s, led.record, s.bpm) ? 0 : first + 1, led.notBefore)
       bars = k === null ? null : wrapBars(k)
     }
-    radio = { slot: led.slot, kind: led.kind, bars, leaving: false }
+    const riding = (led.companions ?? []).filter((k) => !k.withdrawn).map((k) => k.slot)
+    radio = { slot: led.slot, kind: led.kind, bars, leaving: false, ...(riding.length > 0 && { with: riding }) }
   } else if (s.pending && !s.held) {
     const ready = !!s.pending.record && isReady(s, s.pending.record, s.bpm)
     // the wrap it comes due on (it is decided a lap ahead when ready, else on that wrap and lands
@@ -2392,7 +2539,8 @@
       const k = radioFrom(Math.round((until - toWrap) / loopBars) + (ready ? 0 : 1), Number.NEGATIVE_INFINITY)
       bars = k === null ? null : wrapBars(k)
     }
-    radio = { slot: s.pending.slot, kind: null, bars, leaving: false }
+    const riding = (s.pending.companions ?? []).map((k) => k.slot)
+    radio = { slot: s.pending.slot, kind: null, bars, leaving: false, ...(riding.length > 0 && { with: riding }) }
   }
   if (addFrom !== null) {
     const radioWrap = radio?.bars == null ? null : Math.round((radio.bars - toWrap) / loopBars)
@@ -2422,7 +2570,9 @@
   const barSec = 240 / s.bpm
   return radioReadout({
     bars: radioReadoutBars(s.clock.turnaroundLap, t.pos, t.loopBars, radioCadenceOf(s.settings).turnaroundPhraseBars),
-    nextChange: next ? { rowId: next.slot, kind: next.kind, barsAway: next.bars, leaving: next.leaving } : null,
+    nextChange: next
+      ? { rowId: next.slot, kind: next.kind, barsAway: next.bars, leaving: next.leaving, ...(next.with && { with: next.with }) }
+      : null,
     armedTurnaround: s.turnRequest
       ? { move: s.turnRequest.move, isTurn: true }
       : s.turnaround
```

- [ ] **Step 4: Run the tests and typecheck.**

Run: `npm run typecheck && npx vitest run src`
Expected: 0 errors. All pass (695 in planning; 103 in `step.test.ts`).

- [ ] **Step 5: Commit.**

```bash
git add src/radio/step.ts src/radio/step.test.ts
git commit -m "radio: rows per change -- from 70 a change takes companions (to 4 rows at 100): armed and warmed with radio's pick, riding its change as cuts when ready (never waited for), sent once the engine has the change, taken back with it (theirs first), committed on time when the engine will not give one back; a swap-now on a companion's row withdraws it; the arc never takes one out; the readout counts them

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz"
```

---

### Task 9: Desktop, rows per change (phase 3)

**Files (sssketch):** `src/renderer/src/components/DiscoverPanel.tsx`

**Depends on:** Tasks 6 and 7.

**This task was not compiled in planning.** It is panel glue over the staged swap. Follow the steps exactly and keep the invariants. Hand it to a reviewer who reads `stepRadioStage`, the wrap landing and `radioTakesBackLed` end to end.

**The invariant that makes this simpler than the web.** Companions go **inside radio's staged project** (`mergeStageChanges`' `companions`, Task 7). So they land, or are withdrawn, atomically with radio's change. There is no second lifecycle: every take-back path that already exists for the held change (`radioTakesBackLed`, `cancelStagedSwap`, `setRadioLedChange(null)`) takes the companions with it.

- [ ] **Step 1: The pending pick carries companions.**
- Extend the `radioPendingRef` type and `setRadioPending`'s parameter with
  `companions: { slotId: string; pick: SlotPick; stem: ResolvedCandidateStem | null; incomingBars: number | null }[]`.
  Every existing `setRadioPending({...})` call passes `companions: []`, or spreads the current value where it updates `incomingBars` / `stem`.
- In `armRadioPick`, after the eligibility filter, replace the single `pickRadioSlotId` call with:
  ```ts
  // rows per change (the pace slider, 70+): no draw while it is one; the first row is exactly
  // pickRadioSlotId's
  const rows = radioPaceRowsThisChange(radioCadence, Math.random)
  const [slotId, ...more] = pickRadioSlotIds(eligible, radioLastSlotRef.current, rows, {
    turnover: radioSettings.turnover,
    changedAt: radioChangedAtRef.current,
    turn: radioTurnRef.current,
    flags: radioSlotFlagsRef.current
  })
  if (slotId === undefined) return
  ```
- Pick the primary as today. Then pick each of `more` with `pickForSlot(id, kinds, { avoidOwnStem: true })`, in parallel (`Promise.all`).
  - **Check the arm is still current.** After the awaits, re-check `radioArmTokenRef.current !== myArm` exactly as the primary does.
  - **Drop companions you cannot use:** any with a null pick or candidate, any on a row now in `manualChangesRef`, and any whose `candidate.stemCID` equals the primary's or an earlier companion's (two drum rows can draw one stem).
- Set `setRadioPending({ slotId, pick, incomingBars: null, stem: null, companions })`.
- Warm each companion with `resolveAndWarmPick`. In its `.then`, update only that companion's `stem` and `incomingBars`, and only if `radioPendingRef.current?.pick === pick`, the same guard the primary uses.
- Imports: `pickRadioSlotIds` from `@shared/radioSchedule`, `radioPaceRowsThisChange` from `@shared/radioPace`.

- [ ] **Step 2: The grid sees every incoming stem.** In the clock effect, where `outgoingBars` and `pendingPick?.incomingBars` feed `radioPaceGridBars`, use these instead:
- **outgoing:** the max of the primary's and every companion's resolved length (`resolvedBarLengthsRef`), or null if any is unknown;
- **incoming:** the max of the primary's and every companion's `incomingBars`, or null if any is still null.

A companion with a long stem must hold the whole change to the loop top, exactly as a long primary does.

- [ ] **Step 3: The held change carries the ready companions.**
- Extend `radioLedChangeRef`'s type and `setRadioLedChange` with `companions?: { slotId: string; pick: SlotPick; stem: ResolvedCandidateStem }[]`.
- At **both** decision points (the early `setRadioLedChange` in `stepRadioStage`, and the due branch's `setRadioLedChange` calls), set:
  ```ts
  companions: pending.companions.flatMap((k) =>
    k.stem !== null &&
    k.slotId !== pending.slotId &&
    radioEligibleSlotIds().includes(k.slotId) &&
    !manualChangesRef.current.has(k.slotId)
      ? [{ slotId: k.slotId, pick: k.pick, stem: k.stem }]
      : []
  )
  ```
- A companion that is not ready is dropped, not waited for.

- [ ] **Step 4: The stage carries them.**
- In the stage build, find where radio's held change is passed to `mergeStageChanges(radioLed, manual)` (around the `radioStageRef` / `stage.manual` code). Pass `companions: led.companions?.map((k) => ({ slotId: k.slotId, stem: k.stem }))` on the `radioLed` argument.
- Add the companions' slot ids to the stage's `slotIds`.
- `ledSlotId` stays radio's own row. The per-tick eligibility withdraw checks only that row; a companion whose row turns ineligible after staging simply lands, as a manual change does.

- [ ] **Step 5: The landing commits them.** Wherever the held change commits, both on the staged-stage landing and on the unstaged commit-at-the-wrap or commit-on-the-boundary path, commit each companion right after the primary, in the same microtask. Model it on the `new bed` batch loop (`radioCourseChangeRef`, "The course change lands HERE"):
  ```ts
  for (const k of led.companions ?? []) {
    if (manualLandedIds.has(k.slotId)) continue // a manual change on its row won it
    commitSlotPick(k.slotId, k.pick)
    noteTurnaroundLanding(k.slotId, k.stem.barLength)
    holdSyncUntilResolved(k.slotId)
  }
  ```
  `radioLastSlotRef` stays radio's own row. `noteFoldLanding` is not needed: rows per change is 1 whenever fold is on.

- [ ] **Step 6: The arc and the readout.**
- In the arc's `ArcRow` construction, mark a row `busy` when it is a companion of the pending pick or the held change, so the arc never takes it out mid-change.
- In the `radioNextLanding` input (`led` and `pending`), pass `with: led.companions?.map((k) => k.slotId)` and `with: pending.companions.map((k) => k.slotId)`.

- [ ] **Step 7: Typecheck, lint, test.**

Run: `npm run typecheck && npx eslint src/renderer/src/components/DiscoverPanel.tsx && npm test`
Expected: clean and green.

Then grep the take-back paths and confirm each clears the companions with the held change: `grep -n "setRadioLedChange(null)\|radioTakesBackLed\|cancelStagedSwap(" DiscoverPanel.tsx`. Every one already goes through `setRadioLedChange(null)` or replaces the held change; note any that does not in the report.

- [ ] **Step 8: Commit.**

```bash
git add src/renderer/src/components/DiscoverPanel.tsx
git commit -m "discover radio: rows per change -- from 70 radio arms companions with its pick (pickRadioSlotIds, radioPaceRowsThisChange), warms them, and stages the ready ones inside its own change (mergeStageChanges' companions), so they land or are taken back with it; a long companion holds the change to the top; the arc never takes one out; the readout counts them

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz"
```

---

### Task 10: Cross-repo verification, review, and handoff

**Depends on:** all.

- [ ] **Step 1: Run the full suites in the real repos.**
- **sssketch:** `npm run typecheck && npm run lint && npm test`. Expect the 4 known prettier warnings and the machine-dependent engine-spawn tests, nothing else.
- **ell.ing/radio:** `npm run typecheck && npx vitest run`.

- [ ] **Step 2: Final review.** An independent reviewer checks:
- every item of the spec's section 8 (timing risks) against the code;
- the anchors: at slow, mid and fast with no `phraseBars` change, the web and desktop behave exactly as before. Confirm by running the web Sim at levels 0, 25 and 50 against the pre-change commit with the same seed: the landed times must be identical. The 3-6 / 8-16 / 24-48 windows, phrase 16 and one row are unchanged, and there are no extra random draws below 70.

- [ ] **Step 3: Memory and handoff** (sssketch auto-memory, `~/.claude/projects/-Users-nickel-Claudecode-sssketch/memory/`).
- Add `radio_pace_slider_shipped.md`, covering:
  - what shipped and on which branches;
  - unpushed or deployed (deploy the web only on Elling's go-ahead);
  - the walkthrough below;
  - the spec's flags.
- Add a line to `MEMORY.md`.
- Update `ell.ing/radio/CLAUDE.md`'s "Radio settings" line: pace is now a slider, fast (50) until moved, remembered as `radio.pace`.

- [ ] **Step 4: Elling's walkthrough.** No agent can hear or see this; say so in the report.
1. **Web, phone, full mode:**
   - At `fast` it plays as before.
   - Dragging the pace knob updates the word; on release the change is heard within the interval.
   - At 55-65 changes come every 16 s, then 8 s.
   - From 80, mid-loop cuts.
   - At `ludicrous`, most of the bed turns over every bar.
   - Turnarounds still every 16 bars; watch the ruler.
2. **Mid-stream moves:**
   - An armed turnaround (shown at the ruler's end) survives a move.
   - Fold stays folded.
   - Moving back down settles.
3. **Desktop:**
   - The start prompt starts at the slider's position.
   - A running move does not seek or reset.
   - A saved hand-tuned window shows as a nearby level.
   - `phrase` still caps; `loop end` still works below 80.
4. **Both, at 90+ with 8-bar stems:** a long stem enters mid-loop at its own matching bar. Is that the "extreme" he wanted?
5. **Web, 95-100 on a phone:** do the extra rows actually come (fetch and stretch throughput), or mostly one row? Check with `?dev`.

