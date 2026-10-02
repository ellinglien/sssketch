# Radio Turnarounds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The end of every phrase on both radios (sssketch's Discover radio and ell.ing/radio) can sound like one: a drum drop, a low drop, a stop, a reverb wash, a high-pass lift, a low-pass dip or a riser, planned by one pure shared planner. It replaces the per-interval drop-out.

**Architecture:** One pure planner, `sssketch/src/shared/radioTurnaround.ts`, is tested in sssketch and imported by the web radio through its `@shared` alias. It returns plans in *beats before the wrap*. The shared `RadioClock` gains a turnaround lap count, and `RadioSettings` gains `turnarounds` (plus `turnaroundMoves` and `turnaroundDepth` for the controls). Each radio plays a plan its own way:
- sssketch writes it into the Discover preview project as stem automation lanes and a riser clip, with no engine change;
- the web radio writes it onto two new per-row Web Audio nodes and a riser voice.

The dead drop-out code goes last.

**Tech Stack:** TypeScript, vitest, React 19 (sssketch renderer), Electron, Web Audio (ell.ing/radio), headless-Chrome engine checks (`spike/engine-check`).

**Spec:** `docs/superpowers/specs/2026-10-02-radio-turnarounds-design.md`. Read it fully first, including §4a Controls, which is added in the same commit as this plan.

---

## Two repos, and how to work in them

| repo | path | verify |
|---|---|---|
| sssketch | `/Users/nickel/Claudecode/sssketch` | `npm run typecheck`; `npx vitest run <files>`; `npx eslint <files>`; `npm run lint` (baseline: **exactly 4** pre-existing prettier warnings, 0 errors); `npm test` |
| ell.ing/radio | `/Users/nickel/Claudecode/ell.ing/radio` | `npm run typecheck` (four tsconfigs); `npm test` (`vitest run`); `npx vitest run <files>`; `npm run build`; `node spike/engine-check/run.mjs <check>` (headless Chrome, offline renders). **It has no lint script.** |

- The web radio compiles sssketch's `src/shared` files directly (`tsconfig.json` `paths`: `@shared/* -> ../../sssketch/src/shared/*`). **A change to a shared file can break the radio's typecheck, and the radio's tsconfig has `noUnusedLocals`/`noUnusedParameters`.** Every task that changes a shared type runs the radio's `npm run typecheck`, and where the radio has to change too, the task does both repos.
- Formatting: sssketch is prettier-formatted (`singleQuote`, no semis, `printWidth: 100`, no trailing commas). Run `npx prettier --write <the files you created or edited>` before `npx eslint`. **Never run prettier on `DiscoverPanel.tsx` or `DiscoverRadioMenu.tsx` as a whole.** Format only your hunks by hand there; another session owns the rest of those files. The radio repo has no prettier config. Match its style (single quotes, no semis, wide lines).
- **Commits.** Other agents are working in both repos. `cd` into the repo, `git add` the exact paths each task lists, and **never** use `git add -A` or `git add .`. End every commit message with:

  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

- No agent can hear either radio, see the UI or click through the app. Never claim a UI or sound change was "tested". Say it was typechecked, unit-tested and (for the web engine) checked by offline render, and leave the listening to Elling (Task 17).

## Sequencing (read before starting)

Another session is editing sssketch's `DiscoverPanel.tsx`, and possibly `DiscoverRadioMenu.tsx`, for the next few hours. That session's radio sound plan Task 12 will also touch `src/shared/radioThrows.ts` and `src/shared/buildEngineProject.ts`. **This plan edits none of those four files except in the tasks marked BLOCKED.** `radioThrows.ts` and `buildEngineProject.ts` are never edited at all. The order:

1. **Tasks 1–5**: the shared planner (sssketch, TDD).
2. **Task 6**: `RadioSettings.turnarounds` with migration, in both repos, without touching the panel or the menu. See "Settings compatibility" below.
3. **Tasks 7–10**: the whole ell.ing/radio side.
4. **Tasks 11–13**: controls (`moves`, `depth`) in the planner, settings and web full mode.
5. **Tasks 14–15: BLOCKED until the radio-sound session reports done.** They are the sssketch `DiscoverPanel.tsx` integration, the `DiscoverRadioMenu.tsx` rename, and the menu's control rows.
6. **Task 16**: dead code and the compatibility mirror removed (needs 14–15).
7. **Task 17**: full verification in both repos, and the listening walkthrough for Elling.

Every commit leaves both repos typechecking and their tests green.

### Settings compatibility (Tasks 6–15)

`RadioSettings.turnarounds` arrives in Task 6, but the shipped menu and panel read and write `dropOuts` until Task 14. So from Task 6 to Task 16:

- `RadioSettings` keeps `dropOuts` as a **deprecated mirror**.
- `normalizeRadioSettings` sets both fields to the same value.
  - It reads `dropOuts` **first**, because during this window the shipped menu writes only `dropOuts`, so it is the newer of the two whenever they differ.
  - It falls back to `turnarounds`, then to the default.
- `WEB_RADIO_DEFAULTS` carries both (`'often'`).
- Task 10 moves the web radio's reader to `turnarounds`.
- Task 14 moves the panel's reader to `turnarounds`, and makes the menu write **both** fields.
- Task 16 deletes `dropOuts` from the type, and flips the order to the spec's: `turnarounds` first, an old `dropOuts` only when `turnarounds` is missing.

No `App.tsx` change is needed. That file is also being edited by someone else right now, so do not touch it.

## Spec points this plan had to resolve

1. **Phrase origin.** The turnaround count (`RadioClock.turnaroundLap`) starts at 0 on the lap radio starts in. That is the same origin `lapsSincePhrase` uses, so on any loop that divides the phrase, a turnaround ends on the change grid's phrase wrap. "The end of the first whole phrase" means the first phrase counted from that loop top.
   - ell.ing/radio always starts on a loop top.
   - sssketch can start mid-lap, and then its first phrase is shorter by the part of the lap before switch-on, which is the convention the change grid already uses.
   - Rolls happen only on wraps, so with a 1-lap phrase the first roll is at the first wrap.
2. **`ceil`, not `round`.** The spec's `turnaroundPhraseLaps` rounds up, while `radioPhraseLaps` (the change grid) rounds to nearest. On loops that do not divide 16 (3, 5, 6, 7 bars) the two grids can disagree, and a change may land on a wrap with no turnaround. The spec's rule is kept as written.
3. **"Steady".** `radioDensity` has no peak or trough *hold*: a leg turns round the moment it reaches its target. So `turnaroundArc(leg, count)` is:
   - `steady` with no leg, with density off, or when `count` is at or past the leg's target (about to turn);
   - otherwise the leg's phase.
4. **Unweighted length menus.** The spec weights only the stop (2 : 2 : 1). These are drawn uniformly:
   - low drop: 2 beats, 1 bar, 2 bars;
   - lift: 1 or 2 bars;
   - riser: 1, 2 or 4 bars.

   The drum drop uses `pickDropOutBeats` (0.2 / 0.5 / 0.3 over 1 / 2 / 4 beats).
5. **Curve representation.** Curve points are `{ beats, value }` in time order, with `beats` counted before the wrap. The last two points are both at `beats: 0`: first the value held into the one, then the resting value on it (a step). "Ends at full value" means the last point is the rest value:
   - volume 1;
   - high-pass cutoff 0 (open);
   - low-pass cutoff 1;
   - wash mix 0.
6. **The relative wash.** `reverbSend` is `{ peak, points }`, with each point's `value` a mix from the row's own send (0) to the peak (1). Each runtime resolves it with `turnaroundWashSend(wash, ownSend)`, which never dips a send that is already above the peak.
7. **Diminution.** A repeat re-picks rows by the move's own rule, so a drum drop may take a different drums row. It needs the move's arc weight to be above 0 and its guards to pass. The halved length is clamped to the cap. A 1-beat drum drop cannot diminish.
8. **A lead-in already armed for the lap keeps it.** If a hole or riser for a change is already armed for the lap when the roll comes, no turnaround is rolled, and the next phrase end is not "the one after a turnaround".
   - The roll runs before anything else can arm that lap, so this is defensive.
   - The spec's rule (the turnaround is the change's lead-in) applies in the normal order:
     - in sssketch, at the early and due decisions and in `drawManualTransitions`;
     - in the web radio, when a change is scheduled on the turnaround's wrap (`scheduleLed`).
9. **The filter guard.**
   - The planner skips rows its caller marks `inFilterIn`.
   - In sssketch the rule is *also* enforced when the preview is built. A stem that already carries a gesture `filterCutoff` curve keeps it, and keeps its low-pass mode, and the turnaround's filter is dropped for that stem. This is needed because a change landing at the same wrap arms its filter in after the roll.
   - In the web radio, a filter in (at most half the loop, from the top) and a filter move (at most half the loop, into the wrap) never overlap in time, so its gesture list is enough.
10. **Volume stacking.**
    - Volume shapes multiply, and then go under the master **once**. Scaling each curve under the master and then multiplying would apply the master twice.
    - Two ducks on one stem at one wrap still dip once, not twice.
    - A bloom and a wash on one stem take the max. So after a bloom dries out, that stem reads its own send rather than 0 for the rest of the lap.
11. **A staged swap mid-lap carries the turnaround.** A bare cut can be staged at a bar inside the turnaround's lap (`atBars`). The staged project replaces the live one there, so it must carry the turnaround or the move would vanish. A stage landing at the wrap never carries it.
12. **Throws.** Both radios treat an armed turnaround as the lap's leading gesture for the dub throws, so no throw arms on a turnaround lap. Drop-outs counted the same way before.
13. **Web: a turnaround does not block arc steps or tempo changes on its wrap.** Drop-outs did, because a web drop-out was a stem swap. A turnaround is automation on its own nodes. The arc's leaving row *is* what a thinning wash targets, so arc steps must be able to share the wrap.
14. **Web failure path.** `Engine.applyTurnaround` throws a `RangeError` when the plan's first point is less than `MIN_LEAD_SEC` ahead. The controller logs it and sends `turnaroundFailed`, which forgets the turnaround.
15. **Clearing in sssketch.** sssketch has no separate pause or seek path for radio gestures: drop-outs are cleared where `clearRadioGesture()` is called outside the clock effect. The turnaround is cleared at exactly those sites (radio off, a course change, the panel going) and at every wrap.
16. **Controls** (Elling's addition, spec §4a):
    - `turnaroundMoves`: the families `drops`, `wash`, `filters`, `riser`, all on by default. None enabled behaves as `off`.
    - `turnaroundDepth: subtle | bold`, default **`bold` on both radios**, because bold is the spec's own numbers. Subtle:
      - lift 0.35;
      - dip 0.6;
      - wash peak 0.6;
      - every move capped at 1 bar.
    - The web radio gets no rate control: `often` is fixed in `WEB_RADIO_DEFAULTS`.
    - The phone remote (`src/main/remotePage.ts`) exposes no radio settings, so it gets nothing.
17. **Where the web conversion lives.** The spec puts beats-to-seconds inside `gestures.ts`'s `applyTurnaround(plan, wrapTime)`. Here it is in a pure module, `src/audio/turnaround.ts` (`planTurnaroundTimes`), so it can be unit-tested without an `AudioContext`.
    - `Engine.applyTurnaround(plan, wrapTime)` is the spec's entry point. It converts on the clock in force before the wrap, then calls `Gestures.applyTurnaround(times, masterSend)`, which only writes the params.
    - A plan also carries `halvings` (0 to 2), which the never-twice and diminution memory needs.
18. **Randomness and draw order.** All randomness comes from the injected `random`. Guards are checked before any draw. The draws are, in order:
    1. whether it fires;
    2. which move;
    3. how long;
    4. which drums row (drum drop only).

    A diminution draws only whether it fires, plus the drum drop's row.

---

## File map

### sssketch

| file | | responsibility |
|---|---|---|
| `src/shared/radioTurnaround.ts` | create | the planner: setting, phrase arithmetic, curves, guards, weights, `rollTurnaround`, `combineRadioCurves`, controls |
| `src/shared/radioTurnaround.test.ts` | create | setting and phrase arithmetic |
| `src/shared/radioTurnaroundClock.test.ts` | create | `RadioClock.turnaroundLap` / `turnaroundLapStarts` |
| `src/shared/radioTurnaroundCurves.test.ts` | create | curve builders and conversions |
| `src/shared/radioTurnaroundRoll.test.ts` | create | `rollTurnaround`: rate, never-twice, diminution, guards, rows, weights, lengths |
| `src/shared/radioTurnaroundCombine.test.ts` | create | `combineRadioCurves`, `radioTransitionUnderTurnaround` |
| `src/shared/radioTurnaroundSettings.test.ts` | create | `RadioSettings.turnarounds` migration |
| `src/shared/radioTurnaroundControls.test.ts` | create | `moves` / `depth` |
| `src/shared/radioSchedule.ts` | modify | clock count; settings fields and normalisation |
| `src/shared/radioSchedule.test.ts` | modify | the default-settings literal |
| `src/main/discoverSettingsStore.ts` / `.test.ts` | modify | doc line; round-trip and migration tests |
| `src/shared/radioDropOut.ts` / `.test.ts` | modify (Task 16) | keep only `pickDropOutBeats` and `buildDropOutCurve` |
| `src/renderer/src/components/DiscoverPanel.tsx` | modify (**BLOCKED**, Task 14) | roll, arm, clear, merge and play the turnaround |
| `src/renderer/src/components/DiscoverRadioMenu.tsx` | modify (**BLOCKED**, Tasks 14, 15, 16) | `turnarounds` row, `moves` / `depth` rows |
| `docs/superpowers/specs/2026-10-02-radio-turnarounds-design.md` | modify (with this plan's commit) | §4a Controls |

### ell.ing/radio

| file | | responsibility |
|---|---|---|
| `src/audio/transitions.ts` / `.test.ts` | modify | `planRiser` extracted from `planTransition` |
| `src/audio/turnaround.ts` / `.test.ts` | create | a plan as timed points on the rows' nodes (pure) |
| `src/audio/rowVoice.ts` | modify | turnaround gain and neutral high-pass per row |
| `src/audio/gestures.ts` / `gestures.test.ts` (create) | modify | `applyTurnaround`, `cancelTurnaround`, prune, drop |
| `src/audio/engine.ts` | modify | `applyTurnaround`, `cancelTurnaround` |
| `spike/engine-check/check.ts` | modify | a `turnaround` offline-render check |
| `src/radio/step.ts` / `step.test.ts` | modify | roll and emit `turnaround`; `dropOut` removed |
| `src/radio/controller.ts` / `controller.test.ts` | modify | carry out `turnaround` / `cancelTurnaround`; throws gate; `setTurnaroundControls` |
| `src/radio/settings.ts` / `settings.test.ts` | modify | `turnarounds: 'often'`, moves, depth |
| `src/radio/density.test.ts`, `src/radio/indexPicker.test.ts`, `src/smoke.test.ts` | modify | drop-out references |
| `src/ui/turnaroundPrefs.ts` / `.test.ts` | create | `localStorage['radio.turnarounds']` |
| `src/ui/full.ts`, `src/main.ts` | modify | full-mode family and depth toggles |

---

## Task 1: The planner's setting and phrase arithmetic (sssketch)

**Files:**
- Create: `src/shared/radioTurnaround.ts`
- Test: `src/shared/radioTurnaround.test.ts`

- [ ] **Step 1: Write the failing test**

`src/shared/radioTurnaround.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RADIO_TURNAROUNDS,
  RADIO_TURNAROUNDS_OPTIONS,
  TURNAROUND_CHANCE,
  normalizeRadioTurnarounds,
  turnaroundCapBeats,
  turnaroundPhraseLaps
} from './radioTurnaround'

describe('the turnarounds setting', () => {
  it('offers off, rare and often, and defaults to rare', () => {
    expect(RADIO_TURNAROUNDS_OPTIONS).toEqual(['off', 'rare', 'often'])
    expect(DEFAULT_RADIO_TURNAROUNDS).toBe('rare')
  })

  it('reads an old drop-outs value only when turnarounds is missing or unreadable', () => {
    expect(normalizeRadioTurnarounds(undefined, 'often')).toBe('often')
    expect(normalizeRadioTurnarounds(undefined, 'off')).toBe('off')
    expect(normalizeRadioTurnarounds('always', 'off')).toBe('off')
    expect(normalizeRadioTurnarounds('rare', 'often')).toBe('rare')
  })

  it('falls back to rare for anything else', () => {
    expect(normalizeRadioTurnarounds(undefined)).toBe('rare')
    expect(normalizeRadioTurnarounds(3, 'loud')).toBe('rare')
  })

  it('fires one phrase end in three at rare, two in three at often, none when off', () => {
    expect(TURNAROUND_CHANCE).toEqual({ off: 0, rare: 1 / 3, often: 2 / 3 })
  })
})

describe('turnaroundPhraseLaps', () => {
  it('is the phrase in whole laps', () => {
    expect(turnaroundPhraseLaps(16, 4)).toBe(4)
    expect(turnaroundPhraseLaps(16, 8)).toBe(2)
    expect(turnaroundPhraseLaps(32, 8)).toBe(4)
    expect(turnaroundPhraseLaps(16, 0.5)).toBe(32)
  })

  it('rounds UP, so a phrase is never shorter than its bar count', () => {
    expect(turnaroundPhraseLaps(16, 3)).toBe(6) // 18 bars
    expect(turnaroundPhraseLaps(16, 2.5)).toBe(7) // 17.5 bars
    expect(turnaroundPhraseLaps(16, 16 / 3)).toBe(3) // float slack: exactly three laps
  })

  it('makes every wrap a phrase end on a loop of 16 bars or more', () => {
    expect(turnaroundPhraseLaps(16, 16)).toBe(1)
    expect(turnaroundPhraseLaps(16, 24)).toBe(1)
    expect(turnaroundPhraseLaps(16, 32)).toBe(1)
    // a 32-bar loop is one 32-bar phrase, not two 16-bar halves
    expect(turnaroundPhraseLaps(32, 32)).toBe(1)
  })

  it('counts a 16-bar phrase when there is no phrase grid (phraseBars 0)', () => {
    expect(turnaroundPhraseLaps(0, 4)).toBe(4)
    expect(turnaroundPhraseLaps(0, 16)).toBe(1)
  })

  it('is 0 for a loop it cannot count', () => {
    expect(turnaroundPhraseLaps(16, 0)).toBe(0)
    expect(turnaroundPhraseLaps(16, Number.NaN)).toBe(0)
    expect(turnaroundPhraseLaps(16, Number.POSITIVE_INFINITY)).toBe(0)
  })
})

describe('turnaroundCapBeats', () => {
  it('is min(half the loop, 4 bars), in beats', () => {
    expect(turnaroundCapBeats(32)).toBe(16)
    expect(turnaroundCapBeats(8)).toBe(16)
    expect(turnaroundCapBeats(4)).toBe(8)
    expect(turnaroundCapBeats(2)).toBe(4)
    expect(turnaroundCapBeats(1)).toBe(2)
    expect(turnaroundCapBeats(0)).toBe(0)
    expect(turnaroundCapBeats(Number.NaN)).toBe(0)
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd /Users/nickel/Claudecode/sssketch && npx vitest run src/shared/radioTurnaround.test.ts`
Expected: FAIL, `Failed to resolve import "./radioTurnaround"`.

- [ ] **Step 3: Write the minimal implementation**

`src/shared/radioTurnaround.ts`:

```ts
// src/shared/radioTurnaround.ts
//
// THE PHRASE TURNAROUND -- docs/superpowers/specs/2026-10-02-radio-turnarounds-design.md.
// Radio decorates a layer change well, but nothing marked the STRUCTURE: when no layer
// happened to change, a phrase ended like any other bar. At the end of a phrase, arranged loop
// music drops the drums for a beat, the low end for a bar, washes, lifts or dips a filter, or
// rises into the one. This is that, as one pure planner shared by both radios (sssketch's
// Discover radio and ell.ing/radio); each radio writes its own playback.
//
// What the planner promises its callers (spec section 7), so auto-arrange can be a third:
//   - all randomness comes from the injected `random`;
//   - rows are opaque ids (a radio slot or a timeline channel, it does not care which);
//   - a plan is in BEATS BEFORE THE WRAP it ends on (0 = the one), never in a runtime's clock;
//   - the density arc is an input; this file never reads radioDensity.
//
// It must not import radioSchedule: radioSchedule imports it.

/** How often a phrase end gets a turnaround. Absorbed the old `dropOuts` row (2026-10-02). */
export type RadioTurnarounds = 'off' | 'rare' | 'often'

export const RADIO_TURNAROUNDS_OPTIONS: RadioTurnarounds[] = ['off', 'rare', 'often']

/** sssketch's default, as drop-outs' was. The web radio's is `often` (WEB_RADIO_DEFAULTS),
 * Elling's drop-outs choice there. */
export const DEFAULT_RADIO_TURNAROUNDS: RadioTurnarounds = 'rare'

/** The rate, falling back to an old `dropOuts` value (the setting this one absorbs) when
 * `value` is missing or unreadable, then to the default. */
export function normalizeRadioTurnarounds(
  value: unknown,
  legacyDropOuts?: unknown
): RadioTurnarounds {
  const known = (v: unknown): v is RadioTurnarounds =>
    RADIO_TURNAROUNDS_OPTIONS.includes(v as RadioTurnarounds)
  if (known(value)) return value
  if (known(legacyDropOuts)) return legacyDropOuts
  return DEFAULT_RADIO_TURNAROUNDS
}

/** Chance a phrase end gets one. No source gives a frequency for phrase-end moves (spec
 * section 0): one in three and two in three are a guess, to tune by ear. */
export const TURNAROUND_CHANCE: Readonly<Record<RadioTurnarounds, number>> = {
  off: 0,
  rare: 1 / 3,
  often: 2 / 3
}

/** The phrase when `phraseBars` is 0 (no phrase grid): the turnaround still counts 16 bars. */
export const TURNAROUND_DEFAULT_PHRASE_BARS = 16

/** 4/4, as everywhere else in Discover. */
const BEATS_PER_BAR = 4

/** One hypermeasure: no move is longer (spec section 0, "Hypermeter"). */
export const TURNAROUND_MAX_BARS = 4

/** Laps of a `loopBars` loop in one turnaround phrase: the phrase is `phraseBars` (16 when it
 * is 0), rounded UP to whole laps, so a phrase is never shorter than its bar count and a loop
 * of 16 bars or more makes every wrap a phrase end (a 32-bar loop is one 32-bar phrase). 0 for
 * a loop it cannot count. The float slack keeps 16 / (16 / 3) at three laps. */
export function turnaroundPhraseLaps(phraseBars: number, loopBars: number): number {
  if (!(loopBars > 0) || !Number.isFinite(loopBars)) return 0
  const phrase = phraseBars > 0 ? phraseBars : TURNAROUND_DEFAULT_PHRASE_BARS
  return Math.max(1, Math.ceil(phrase / loopBars - 1e-9))
}

/** The longest any move may be, in beats: min(half the loop, 4 bars). Half the loop is the
 * rule every curve in radioTransition.ts already keeps (a gesture never runs into the wrap it
 * is anchored to); 4 bars is the hypermeasure. 0 for a loop it cannot place a move in. */
export function turnaroundCapBeats(loopBars: number): number {
  if (!(loopBars > 0) || !Number.isFinite(loopBars)) return 0
  return Math.min(loopBars / 2, TURNAROUND_MAX_BARS) * BEATS_PER_BAR
}
```

- [ ] **Step 4: Run it to make sure it passes**

Run: `npx vitest run src/shared/radioTurnaround.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Format, lint, typecheck**

```bash
cd /Users/nickel/Claudecode/sssketch
npx prettier --write src/shared/radioTurnaround.ts src/shared/radioTurnaround.test.ts
npx eslint src/shared/radioTurnaround.ts src/shared/radioTurnaround.test.ts
npm run typecheck
```
Expected: eslint prints nothing; typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
cd /Users/nickel/Claudecode/sssketch
git add src/shared/radioTurnaround.ts src/shared/radioTurnaround.test.ts
git commit -m "radio turnarounds Task 1: the planner's setting and phrase arithmetic -- turnaroundPhraseLaps rounds up, the cap is min(half the loop, 4 bars)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 2: The turnaround lap count on the shared clock (sssketch, radio typecheck)

The clock counts laps within the turnaround's phrase, **whatever `phraseBars` is**. Its origin is the same as `lapsSincePhrase`'s. `advanceRadioClock` reports when the lap that starts at a wrap is a phrase's last. `lapsSincePhrase` does not change.

**Files:**
- Modify: `src/shared/radioSchedule.ts` (the `RadioClock` interface; `createRadioClock`; `restartRadioInterval`; `RadioClockStep`; `advanceRadioClock`)
- Test: `src/shared/radioTurnaroundClock.test.ts` (create)

- [ ] **Step 1: Write the failing test**

`src/shared/radioTurnaroundClock.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  advanceRadioClock,
  createRadioClock,
  restartRadioInterval,
  type RadioClock
} from './radioSchedule'

/** Ticks `laps` whole laps of a `loopBars` loop, one tick a bar, and returns the wraps
 * (counted from 1) whose step said a turnaround lap starts there. Never true off a wrap. */
function turnaroundWraps(
  laps: number,
  loopBars: number,
  phraseBars: number,
  start: RadioClock = createRadioClock(1000, 0)
): number[] {
  let clock = start
  const out: number[] = []
  for (let lap = 1; lap <= laps; lap++) {
    for (let bar = 1; bar < loopBars; bar++) {
      const mid = advanceRadioClock(clock, bar, loopBars, loopBars, phraseBars)
      expect(mid.turnaroundLapStarts).toBe(false)
      clock = mid.clock
    }
    const wrap = advanceRadioClock(clock, 0, loopBars, loopBars, phraseBars)
    clock = wrap.clock
    if (wrap.turnaroundLapStarts) out.push(lap)
  }
  return out
}

describe('the turnaround lap count', () => {
  it("starts the last lap of each 16-bar phrase on a 4-bar loop, counted from radio's first loop top", () => {
    expect(turnaroundWraps(12, 4, 16)).toEqual([3, 7, 11])
  })

  it('runs with no phrase grid as 16 bars, where lapsSincePhrase stays at 0', () => {
    expect(turnaroundWraps(12, 4, 0)).toEqual([3, 7, 11])
    let clock = createRadioClock(1000, 0)
    for (let lap = 0; lap < 6; lap++) {
      clock = advanceRadioClock(clock, 2, 4, 4, 0).clock
      clock = advanceRadioClock(clock, 0, 4, 4, 0).clock
    }
    expect(clock.lapsSincePhrase).toBe(0)
    expect(clock.turnaroundLap).toBe(2) // six wraps: 1, 2, 3, 0, 1, 2
  })

  it('counts 32-bar phrases', () => {
    expect(turnaroundWraps(16, 4, 32)).toEqual([7, 15])
  })

  it('makes every wrap one on a loop of 16 bars or more', () => {
    expect(turnaroundWraps(3, 16, 16)).toEqual([1, 2, 3])
    expect(turnaroundWraps(3, 32, 32)).toEqual([1, 2, 3])
  })

  it("ends on the change grid's phrase wraps when the loop divides the phrase", () => {
    let clock = createRadioClock(1000, 0)
    const phraseWraps: number[] = []
    const turnaroundEnds: number[] = []
    for (let lap = 1; lap <= 12; lap++) {
      clock = advanceRadioClock(clock, 2, 4, 4, 16).clock
      const step = advanceRadioClock(clock, 0, 4, 4, 16)
      clock = step.clock
      if (clock.lapsSincePhrase === 0) phraseWraps.push(lap)
      if (step.turnaroundLapStarts) turnaroundEnds.push(lap + 1)
    }
    expect(phraseWraps).toEqual([4, 8, 12])
    expect(turnaroundEnds).toEqual([4, 8, 12])
  })

  it('a new interval keeps the count; a new clock starts it at 0', () => {
    const counted: RadioClock = { ...createRadioClock(8, 0), turnaroundLap: 2 }
    expect(restartRadioInterval(counted, 12, 1, 0).turnaroundLap).toBe(2)
    expect(createRadioClock(8, 2.5).turnaroundLap).toBe(0)
  })

  it('reads a clock written without the field as lap 0', () => {
    const old: RadioClock = { barsElapsed: 0, intervalBars: 1000, lastPos: 0, lapsSincePhrase: 0 }
    expect(turnaroundWraps(4, 4, 16, old)).toEqual([3])
  })

  it('folds a count left above a phrase that shrank back to the top', () => {
    // counted on a 2-bar loop (eight laps a phrase), and the loop grows to 8 bars (two laps)
    const counted: RadioClock = { ...createRadioClock(1000, 0), turnaroundLap: 5, lastPos: 4 }
    const step = advanceRadioClock(counted, 0, 8, 8, 16)
    expect(step.clock.turnaroundLap).toBe(0)
    expect(step.turnaroundLapStarts).toBe(false)
    const next = advanceRadioClock({ ...step.clock, lastPos: 4 }, 0, 8, 8, 16)
    expect(next.clock.turnaroundLap).toBe(1)
    expect(next.turnaroundLapStarts).toBe(true)
  })

  it('reports nothing on a tick it cannot read', () => {
    expect(advanceRadioClock(createRadioClock(8, 0), Number.NaN, 4).turnaroundLapStarts).toBe(false)
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd /Users/nickel/Claudecode/sssketch && npx vitest run src/shared/radioTurnaroundClock.test.ts`
Expected: FAIL. `turnaroundLapStarts` is `undefined` (`expected undefined to be false`) and `turnaroundLap` is `undefined`.

- [ ] **Step 3: Implement it in `src/shared/radioSchedule.ts`**

(a) Imports. Below the existing line `import { DEFAULT_RADIO_DROP_OUTS, normalizeRadioDropOuts, type RadioDropOuts } from './radioDropOut'`, add:

```ts
import { turnaroundPhraseLaps } from './radioTurnaround'
```

(b) `RadioClock`. Replace

```ts
  lapsSincePhrase: number
}

export function createRadioClock(intervalBars: number, startPos = 0): RadioClock {
  return { barsElapsed: 0, intervalBars, lastPos: startPos, lapsSincePhrase: 0 }
}
```

with

```ts
  lapsSincePhrase: number
  /** The lap playing, counted within the TURNAROUND's phrase (radioTurnaround.ts):
   * 0 .. turnaroundPhraseLaps - 1, advanced at every wrap. The same origin as
   * lapsSincePhrase -- the loop top radio started inside -- so on a loop that divides the
   * phrase a turnaround ends on the change grid's phrase wrap. Unlike lapsSincePhrase it runs
   * whatever phraseBars is (0 counts 16 bars): the spec's "the turnaround count must not be"
   * reset. Optional only so a clock written before it reads as lap 0; every function here
   * sets it. */
  turnaroundLap?: number
}

export function createRadioClock(intervalBars: number, startPos = 0): RadioClock {
  return { barsElapsed: 0, intervalBars, lastPos: startPos, lapsSincePhrase: 0, turnaroundLap: 0 }
}
```

(c) `restartRadioInterval`. Replace

```ts
  return {
    barsElapsed: overshoot,
    intervalBars,
    lastPos: pos,
    lapsSincePhrase: clock.lapsSincePhrase
  }
```

with

```ts
  return {
    barsElapsed: overshoot,
    intervalBars,
    lastPos: pos,
    lapsSincePhrase: clock.lapsSincePhrase,
    turnaroundLap: clock.turnaroundLap
  }
```

(d) `RadioClockStep`. Replace the end of the interface:

```ts
  due: boolean
}

/** One position tick.
```

with

```ts
  due: boolean
  /** The lap that STARTS at this wrap is the last lap of a turnaround phrase: roll the phrase
   * end's turnaround now (radioTurnaround.ts rollTurnaround). Only ever true on a wrap. */
  turnaroundLapStarts: boolean
}

/** One position tick.
```

(e) `advanceRadioClock`. Replace the early return

```ts
    return { clock, wrapped: false, due: false }
```

with

```ts
    return { clock, wrapped: false, due: false, turnaroundLapStarts: false }
```

and replace the final return

```ts
  return {
    clock: { ...clock, barsElapsed, lastPos: pos, lapsSincePhrase },
    wrapped,
    due: crossed && onPhrase && barsElapsed >= clock.intervalBars
  }
}
```

with

```ts
  // The turnaround's own count: every wrap, whatever phraseBars is, folding back to 0 at the
  // phrase end (and from anywhere above the phrase, should the loop have grown under it).
  const perTurnaround = turnaroundPhraseLaps(phraseBars, loopBars)
  let turnaroundLap = clock.turnaroundLap ?? 0
  if (wrapped) {
    turnaroundLap += 1
    if (turnaroundLap >= perTurnaround) turnaroundLap = 0
  }
  return {
    clock: { ...clock, barsElapsed, lastPos: pos, lapsSincePhrase, turnaroundLap },
    wrapped,
    due: crossed && onPhrase && barsElapsed >= clock.intervalBars,
    turnaroundLapStarts: wrapped && turnaroundLap === perTurnaround - 1
  }
}
```

- [ ] **Step 4: Run the new test and every clock-reading test**

Run: `npx vitest run src/shared/radioTurnaroundClock.test.ts src/shared/radioSchedule.test.ts src/shared/radioApproach.test.ts src/shared/radioDropOut.test.ts`
Expected: PASS. (`radioSchedule.test.ts:518` compares a `restartRadioInterval` result with `toEqual`. The clock there has no `turnaroundLap`, so the result carries `turnaroundLap: undefined`, which `toEqual` ignores.)

- [ ] **Step 5: Format, lint, typecheck both repos**

```bash
cd /Users/nickel/Claudecode/sssketch
npx prettier --write src/shared/radioSchedule.ts src/shared/radioTurnaroundClock.test.ts
npx eslint src/shared/radioSchedule.ts src/shared/radioTurnaroundClock.test.ts
npm run typecheck
cd /Users/nickel/Claudecode/ell.ing/radio && npm run typecheck && npm test
```
Expected: no eslint output, both typechecks exit 0, and the radio's tests pass. Nothing there reads the new fields yet.

- [ ] **Step 6: Commit (sssketch only)**

```bash
cd /Users/nickel/Claudecode/sssketch
git add src/shared/radioSchedule.ts src/shared/radioTurnaroundClock.test.ts
git commit -m "radio turnarounds Task 2: the clock counts the turnaround's phrase whatever phraseBars is, and says when a phrase's last lap starts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 3: The curves, in beats before the wrap (sssketch)

**Files:**
- Modify: `src/shared/radioTurnaround.ts`
- Test: `src/shared/radioTurnaroundCurves.test.ts` (create)

- [ ] **Step 1: Write the failing test**

`src/shared/radioTurnaroundCurves.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildDropOutCurve } from './radioDropOut'
import {
  TURNAROUND_DIP_FLOOR,
  TURNAROUND_LIFT_TOP,
  TURNAROUND_WASH_PEAK,
  turnaroundDipCurve,
  turnaroundDropCurve,
  turnaroundLiftCurve,
  turnaroundToLoopBars,
  turnaroundWashCurve,
  turnaroundWashSend,
  type TurnaroundPoint
} from './radioTurnaround'

function close(actual: TurnaroundPoint[], expected: TurnaroundPoint[]): void {
  expect(actual).toHaveLength(expected.length)
  actual.forEach((p, i) => {
    expect(p.beats).toBeCloseTo(expected[i].beats, 9)
    expect(p.value).toBeCloseTo(expected[i].value, 9)
  })
}

describe('the spec numbers', () => {
  it('lifts to 0.6, dips to 0.35, washes to 0.85', () => {
    expect([TURNAROUND_LIFT_TOP, TURNAROUND_DIP_FLOOR, TURNAROUND_WASH_PEAK]).toEqual([0.6, 0.35, 0.85])
  })
})

describe('turnaroundDropCurve', () => {
  it("is buildDropOutCurve counted back from the wrap, silent into it and full on the one", () => {
    // leaves 2 beats out, silent 0.02 bars (0.08 beats) later, back to 1 exactly on the one
    close(turnaroundDropCurve(8, 2), [
      { beats: 2, value: 1 },
      { beats: 1.92, value: 0 },
      { beats: 0, value: 0 },
      { beats: 0, value: 1 }
    ])
  })

  it('is empty when buildDropOutCurve cannot place it', () => {
    expect(turnaroundDropCurve(0, 2)).toEqual([])
    expect(turnaroundDropCurve(8, 0)).toEqual([])
  })
})

describe('the filter and wash curves', () => {
  it('a lift is a high-pass from open to the top, open again on the one', () => {
    expect(turnaroundLiftCurve(8)).toEqual({
      mode: 'highpass',
      cutoff: [
        { beats: 8, value: 0 },
        { beats: 0, value: 0.6 },
        { beats: 0, value: 0 }
      ]
    })
  })

  it('a dip is a low-pass from open down to the floor, open again on the one', () => {
    expect(turnaroundDipCurve(4)).toEqual({
      mode: 'lowpass',
      cutoff: [
        { beats: 4, value: 1 },
        { beats: 0, value: 0.35 },
        { beats: 0, value: 1 }
      ]
    })
  })

  it("a wash is relative: a mix from the row's own send (0) to the peak (1), and back", () => {
    expect(turnaroundWashCurve(4)).toEqual({
      peak: 0.85,
      points: [
        { beats: 4, value: 0 },
        { beats: 0, value: 1 },
        { beats: 0, value: 0 }
      ]
    })
  })

  it('takes other numbers where the depth asks for them', () => {
    expect(turnaroundLiftCurve(4, 0.35).cutoff[1].value).toBe(0.35)
    expect(turnaroundDipCurve(4, 0.6).cutoff[1].value).toBe(0.6)
    expect(turnaroundWashCurve(4, 0.6).peak).toBe(0.6)
  })
})

describe('turnaroundWashSend', () => {
  it("rises from the row's own send to the peak, and back to its own on the one", () => {
    close(turnaroundWashSend(turnaroundWashCurve(4), 0.25), [
      { beats: 4, value: 0.25 },
      { beats: 0, value: 0.85 },
      { beats: 0, value: 0.25 }
    ])
  })

  it('never dips a send already above the peak', () => {
    close(turnaroundWashSend(turnaroundWashCurve(4), 0.9), [
      { beats: 4, value: 0.9 },
      { beats: 0, value: 0.9 },
      { beats: 0, value: 0.9 }
    ])
  })

  it('treats an unreadable send as 0', () => {
    close(turnaroundWashSend(turnaroundWashCurve(4), Number.NaN), [
      { beats: 4, value: 0 },
      { beats: 0, value: 0.85 },
      { beats: 0, value: 0 }
    ])
  })
})

describe('turnaroundToLoopBars', () => {
  it('gives back buildDropOutCurve exactly, in clip-relative bars of the lap', () => {
    const back = turnaroundToLoopBars(turnaroundDropCurve(8, 2), 8)
    const want = buildDropOutCurve(8, 2)
    expect(back).toHaveLength(want.length)
    back.forEach((p, i) => {
      expect(p.bar).toBeCloseTo(want[i].bar, 9)
      expect(p.value).toBe(want[i].value)
    })
  })

  it('rests at bar 0, and puts the move into the wrap; the step on the one is the lap wrapping', () => {
    expect(turnaroundToLoopBars(turnaroundLiftCurve(4).cutoff, 8)).toEqual([
      { bar: 0, value: 0 },
      { bar: 7, value: 0 },
      { bar: 8, value: 0.6 }
    ])
    expect(turnaroundToLoopBars(turnaroundDipCurve(4).cutoff, 8)).toEqual([
      { bar: 0, value: 1 },
      { bar: 7, value: 1 },
      { bar: 8, value: 0.35 }
    ])
  })

  it('is empty for no points or no loop', () => {
    expect(turnaroundToLoopBars([], 8)).toEqual([])
    expect(turnaroundToLoopBars(turnaroundLiftCurve(4).cutoff, 0)).toEqual([])
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/shared/radioTurnaroundCurves.test.ts`
Expected: FAIL, with `turnaroundDropCurve is not a function` (and similar).

- [ ] **Step 3: Implement it**

In `src/shared/radioTurnaround.ts`, insert directly below the header comment (above `/** How often a phrase end gets a turnaround.`):

```ts
import { buildDropOutCurve } from './radioDropOut'
import type { AutomationPoint, FilterMode } from './toolkit'
```

Append to the end of the file:

```ts
// ---- the curves ----
//
// Every curve is a list of points in BEATS BEFORE THE WRAP the move ends on, in time order, so
// each runtime maps it onto its own clock (sssketch: clip-relative bars of the lap,
// turnaroundToLoopBars; ell.ing/radio: AudioContext seconds). The last two points are both on
// the one: the value held into it, then the resting value -- a step, since every move ends
// with every row back in full on the one (spec section 0, "release is return").

export interface TurnaroundPoint {
  /** Beats before the wrap (0 = the one). */
  beats: number
  value: number
}

/** A filter move: the stem's filter in `mode`, its normalised cutoff over the move. */
export interface TurnaroundFilter {
  mode: FilterMode
  cutoff: TurnaroundPoint[]
}

/** The wash, RELATIVE: each point's value is a mix from the row's own send (0) to `peak` (1).
 * Each runtime puts the row's own send in (turnaroundWashSend). */
export interface TurnaroundWash {
  peak: number
  points: TurnaroundPoint[]
}

/** The spec's numbers (section 2) -- the `bold` depth. */
export const TURNAROUND_LIFT_TOP = 0.6
export const TURNAROUND_DIP_FLOOR = 0.35
export const TURNAROUND_WASH_PEAK = 0.85

/** A drop's `volume` curve: radioDropOut's buildDropOutCurve (full, a 0.02-bar ramp to
 * silence `beats` before the wrap, silent into it), counted back from the wrap, and back to
 * full on the one. Its bar-0 point is dropped: the lap's start is the runtime's business. [] for
 * anything buildDropOutCurve cannot place. */
export function turnaroundDropCurve(loopBars: number, beats: number): TurnaroundPoint[] {
  const curve = buildDropOutCurve(loopBars, beats)
  if (curve.length === 0) return []
  return [
    ...curve.slice(1).map((p) => ({ beats: (loopBars - p.bar) * BEATS_PER_BAR, value: p.value })),
    { beats: 0, value: 1 }
  ]
}

/** The lift: a high-pass from open (0) up to `top` over `beats`, open again on the one. */
export function turnaroundLiftCurve(beats: number, top = TURNAROUND_LIFT_TOP): TurnaroundFilter {
  return {
    mode: 'highpass',
    cutoff: [
      { beats, value: 0 },
      { beats: 0, value: top },
      { beats: 0, value: 0 }
    ]
  }
}

/** The dip: the low-pass from open (1) down to `floor` over `beats`, open again on the one. */
export function turnaroundDipCurve(beats: number, floor = TURNAROUND_DIP_FLOOR): TurnaroundFilter {
  return {
    mode: 'lowpass',
    cutoff: [
      { beats, value: 1 },
      { beats: 0, value: floor },
      { beats: 0, value: 1 }
    ]
  }
}

/** The wash: the send rises from the row's own to `peak` over `beats`, its own again on the one. */
export function turnaroundWashCurve(beats: number, peak = TURNAROUND_WASH_PEAK): TurnaroundWash {
  return {
    peak,
    points: [
      { beats, value: 0 },
      { beats: 0, value: 1 },
      { beats: 0, value: 0 }
    ]
  }
}

/** A wash in absolute send values, from the row's own send. Never dips a send already above the
 * peak; an unreadable send is 0. */
export function turnaroundWashSend(wash: TurnaroundWash, ownSend: number): TurnaroundPoint[] {
  const own = Number.isFinite(ownSend) ? Math.min(1, Math.max(0, ownSend)) : 0
  const peak = Math.max(own, wash.peak)
  return wash.points.map((p) => ({ beats: p.beats, value: own + (peak - own) * p.value }))
}

/** A curve as CLIP-RELATIVE bars of the lap that ends on the wrap -- what a Discover preview
 * stem's automation lane takes (sssketch). The resting value sits at bar 0, the move's points
 * at `loopBars - beats / 4`, and the step back to rest on the one is dropped: a lane repeats
 * every lap, so the lap wrapping IS that step. For a drop this gives back buildDropOutCurve
 * exactly. [] for no points or no loop. */
export function turnaroundToLoopBars(
  points: readonly TurnaroundPoint[],
  loopBars: number
): AutomationPoint[] {
  if (points.length === 0 || !(loopBars > 0)) return []
  const rest = points[points.length - 1].value
  return [
    { bar: 0, value: rest },
    ...points
      .slice(0, -1)
      .map((p) => ({ bar: loopBars - p.beats / BEATS_PER_BAR, value: p.value }))
  ]
}
```

- [ ] **Step 4: Run it to make sure it passes**

Run: `npx vitest run src/shared/radioTurnaroundCurves.test.ts src/shared/radioTurnaround.test.ts`
Expected: PASS.

- [ ] **Step 5: Format, lint, typecheck both repos**

```bash
cd /Users/nickel/Claudecode/sssketch
npx prettier --write src/shared/radioTurnaround.ts src/shared/radioTurnaroundCurves.test.ts
npx eslint src/shared/radioTurnaround.ts src/shared/radioTurnaroundCurves.test.ts
npm run typecheck
cd /Users/nickel/Claudecode/ell.ing/radio && npm run typecheck
```
Expected: clean.

- [ ] **Step 6: Commit**

```bash
cd /Users/nickel/Claudecode/sssketch
git add src/shared/radioTurnaround.ts src/shared/radioTurnaroundCurves.test.ts
git commit -m "radio turnarounds Task 3: the curves in beats before the wrap -- drop (buildDropOutCurve), lift, dip, relative wash -- and their lap-relative form

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 4: `rollTurnaround`, the moves and the draw (sssketch)

**Files:**
- Modify: `src/shared/radioTurnaround.ts`
- Test: `src/shared/radioTurnaroundRoll.test.ts` (create)

Draw values used by the tests below, with all seven moves in the draw while steady (weights 2, 2, 1, 1, 2, 1, 1; total 10):

| move draw | move |
|---|---|
| 0.05 | drum drop |
| 0.25 | low drop |
| 0.45 | stop |
| 0.55 | wash |
| 0.65 | lift |
| 0.85 | dip |
| 0.95 | riser |

Length draws:

| move | draw → length |
|---|---|
| drum drop (`pickDropOutBeats`) | 0.1 → 1, 0.5 → 2, 0.8 → 4 beats |
| low drop | 0 → 2, 0.5 → 4, 0.9 → 8 beats |
| stop (2 : 2 : 1) | 0 → 1, 0.5 → 2, 0.9 → 4 beats |
| lift | 0 → 4, 0.6 → 8 beats |
| riser | 0 → 1, 0.5 → 2, 0.9 → 4 bars |

The wash and the dip draw no length.

- [ ] **Step 1: Write the failing test**

`src/shared/radioTurnaroundRoll.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { DiscoverSlotKind } from './discoverSlotKind'
import {
  TURNAROUND_MOVES,
  TURNAROUND_WEIGHTS,
  rememberTurnaround,
  rollTurnaround,
  turnaroundArc,
  turnaroundCapBeats,
  turnaroundDipCurve,
  turnaroundDraw,
  turnaroundDropCurve,
  turnaroundLiftCurve,
  turnaroundStopKeeper,
  type TurnaroundInput,
  type TurnaroundMove,
  type TurnaroundRow
} from './radioTurnaround'

/** Exactly these draws, in order; a draw past them is a test failure. */
function seq(values: number[]): () => number {
  let i = 0
  return (): number => {
    if (i >= values.length) throw new Error(`drew ${i + 1} times, only ${values.length} scripted`)
    return values[i++]
  }
}

/** mulberry32 -- the same long run every time. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return (): number => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function row(id: string, kinds: DiscoverSlotKind[], extra: Partial<TurnaroundRow> = {}): TurnaroundRow {
  return { id, kinds, hooked: false, audible: true, inFilterIn: false, barLength: 4, ...extra }
}

const BED: TurnaroundRow[] = [
  row('d', ['drums']),
  row('b', ['bass']),
  row('l', ['lead']),
  row('w', ['warm'])
]

function input(over: Partial<TurnaroundInput> = {}): TurnaroundInput {
  return {
    rate: 'often',
    random: seq([]),
    loopBars: 8,
    lastPhrase: null,
    rows: BED,
    arc: 'steady',
    leavingRowId: null,
    ...over
  }
}

function draw(over: Partial<TurnaroundInput> = {}): TurnaroundMove[] {
  return turnaroundDraw(input(over))
}

function ids(over: Partial<TurnaroundInput>): string[] {
  const plan = rollTurnaround(input(over))
  if (plan === null) throw new Error('expected a turnaround')
  return plan.rows.map((r) => r.rowId)
}

function sorted(set: Set<number> | undefined): number[] {
  return [...(set ?? [])].sort((a, b) => a - b)
}

describe('the rate', () => {
  it('never fires when off, and spends no draw', () => {
    expect(rollTurnaround(input({ rate: 'off' }))).toBeNull()
  })

  it('fires below the rate only', () => {
    expect(rollTurnaround(input({ rate: 'rare', random: seq([0.34]) }))).toBeNull()
    expect(rollTurnaround(input({ rate: 'rare', random: seq([0.33, 0.95, 0]) }))?.move).toBe('riser')
    expect(rollTurnaround(input({ rate: 'often', random: seq([0.67]) }))).toBeNull()
    expect(rollTurnaround(input({ rate: 'often', random: seq([0.66, 0.95, 0]) }))?.move).toBe('riser')
  })

  it('fires about one in three at rare and two in three at often', () => {
    for (const [rate, want] of [
      ['rare', 1 / 3],
      ['often', 2 / 3]
    ] as const) {
      const random = mulberry32(7)
      let fired = 0
      for (let i = 0; i < 6000; i++) if (rollTurnaround(input({ rate, random })) !== null) fired++
      expect(fired / 6000).toBeGreaterThan(want - 0.03)
      expect(fired / 6000).toBeLessThan(want + 0.03)
    }
  })

  it('is the same plan for the same seed', () => {
    const run = (seed: number): unknown[] => {
      const random = mulberry32(seed)
      return Array.from({ length: 50 }, () => rollTurnaround(input({ random })))
    }
    expect(run(3)).toEqual(run(3))
  })

  it('spends no draw when nothing can sound', () => {
    const silent = BED.map((r) => ({ ...r, audible: false }))
    expect(rollTurnaround(input({ rows: silent }))).toBeNull()
  })
})

describe('never at two phrase ends in a row, except diminution', () => {
  it('skips the phrase end after a turnaround that cannot diminish, without a draw', () => {
    for (const move of ['stop', 'wash', 'dip', 'riser'] as const) {
      expect(rollTurnaround(input({ lastPhrase: { move, beats: 4, halvings: 0 } }))).toBeNull()
    }
  })

  it('repeats a drum drop, a low drop or a lift at half its length, at the same rate', () => {
    expect(
      rollTurnaround(input({ lastPhrase: { move: 'low drop', beats: 8, halvings: 0 }, random: seq([0]) }))
    ).toMatchObject({ move: 'low drop', beats: 4, halvings: 1 })
    expect(
      rollTurnaround(input({ lastPhrase: { move: 'lift', beats: 8, halvings: 1 }, random: seq([0]) }))
    ).toMatchObject({ move: 'lift', beats: 4, halvings: 2 })
    expect(
      rollTurnaround(
        input({ lastPhrase: { move: 'drum drop', beats: 4, halvings: 0 }, random: seq([0, 0]) })
      )
    ).toMatchObject({ move: 'drum drop', beats: 2, halvings: 1 })
    expect(
      rollTurnaround(input({ lastPhrase: { move: 'low drop', beats: 8, halvings: 0 }, random: seq([0.67]) }))
    ).toBeNull()
  })

  it('halves twice at most, and never below one beat', () => {
    expect(rollTurnaround(input({ lastPhrase: { move: 'low drop', beats: 2, halvings: 2 } }))).toBeNull()
    expect(rollTurnaround(input({ lastPhrase: { move: 'drum drop', beats: 1, halvings: 0 } }))).toBeNull()
    expect(
      rollTurnaround(
        input({ lastPhrase: { move: 'drum drop', beats: 2, halvings: 1 }, random: seq([0, 0]) })
      )
    ).toMatchObject({ beats: 1, halvings: 2 })
  })

  it('does not repeat a drop while the arc thins, nor a move that can no longer sound', () => {
    expect(
      rollTurnaround(input({ arc: 'thinning', lastPhrase: { move: 'low drop', beats: 8, halvings: 0 } }))
    ).toBeNull()
    expect(
      rollTurnaround(
        input({
          rows: BED.filter((r) => r.id !== 'd'),
          lastPhrase: { move: 'drum drop', beats: 4, halvings: 0 }
        })
      )
    ).toBeNull()
  })

  it('rememberTurnaround keeps the move, its length and its halvings; null for none', () => {
    const plan = rollTurnaround(input({ random: seq([0, 0.25, 0.5]) }))
    expect(rememberTurnaround(plan)).toEqual({ move: 'low drop', beats: 4, halvings: 0 })
    expect(rememberTurnaround(null)).toBeNull()
  })
})

describe('the guards (turnaroundDraw)', () => {
  it('puts every move in the draw for a full bed on a long loop, while steady', () => {
    expect(draw()).toEqual(['drum drop', 'low drop', 'stop', 'wash', 'lift', 'dip', 'riser'])
  })

  it('a drum drop needs a drums row; a low drop a drums or a bass row', () => {
    const melodic = [row('l', ['lead']), row('w', ['warm'])]
    // the stop is still in: it drops the warm row and keeps the lead
    expect(draw({ rows: melodic })).toEqual(['stop', 'wash', 'lift', 'dip', 'riser'])
    const bassAndLead = [row('b', ['bass']), row('l', ['lead'])]
    expect(draw({ rows: bassAndLead })).toEqual(['low drop', 'stop', 'wash', 'lift', 'dip', 'riser'])
  })

  it('drops and the stop need two audible rows; a row not heard does not count', () => {
    const lonely = [row('d', ['drums']), row('l', ['lead'], { audible: false })]
    expect(draw({ rows: lonely })).toEqual(['riser'])
  })

  it('never silences every row: no low drop over only drums and bass, no stop without a melodic row', () => {
    const low = [row('d', ['drums']), row('b', ['bass'])]
    expect(draw({ rows: low })).toEqual(['drum drop', 'wash', 'lift', 'dip', 'riser'])
  })

  it('the wash and the filters need a row that is not drums; the filters one not mid filter-in', () => {
    const drumsOnly = [row('d', ['drums']), row('d2', ['drums', 'rhythmic'])]
    expect(draw({ rows: drumsOnly })).toEqual(['drum drop', 'riser'])
    const sweeping = BED.map((r) => (r.id === 'd' ? r : { ...r, inFilterIn: true }))
    expect(draw({ rows: sweeping })).toEqual(['drum drop', 'low drop', 'stop', 'wash', 'riser'])
  })

  it('leaves out a move whose shortest length does not fit min(half the loop, 4 bars)', () => {
    expect(draw({ loopBars: 1 })).toEqual(['drum drop', 'low drop', 'stop']) // cap 2 beats
    expect(draw({ loopBars: 0.5 })).toEqual(['drum drop', 'stop']) // cap 1 beat
    expect(draw({ loopBars: 0 })).toEqual([])
  })

  it('follows the arc: thinning draws only the wash and the dip', () => {
    expect(draw({ arc: 'thinning' })).toEqual(['wash', 'dip'])
    expect(draw({ arc: 'growing' })).toEqual(['drum drop', 'low drop', 'stop', 'lift', 'riser'])
  })
})

describe('which rows', () => {
  it('a drum drop takes one drums row, drawn', () => {
    const rows = [...BED, row('d2', ['drums'])]
    const plan = rollTurnaround(input({ rows, random: seq([0, 0.05, 0.5, 0.9]) }))
    expect(plan?.move).toBe('drum drop')
    expect(plan?.beats).toBe(2)
    expect(plan?.rows.map((r) => r.rowId)).toEqual(['d2'])
    expect(plan?.rows[0].volume?.at(-1)).toEqual({ beats: 0, value: 1 })
  })

  it('a low drop takes every drums and every bass row together', () => {
    const rows = [...BED, row('db', ['drums', 'bass']), row('b2', ['bass'])]
    const plan = rollTurnaround(input({ rows, random: seq([0, 0.25, 0]) }))
    expect(plan?.move).toBe('low drop')
    expect(plan?.beats).toBe(2)
    expect(plan?.rows.map((r) => r.rowId)).toEqual(['d', 'b', 'db', 'b2'])
    for (const r of plan?.rows ?? []) expect(r.volume).toEqual(turnaroundDropCurve(8, 2))
  })

  it('the stop keeps one melodic row: the hook first, then a lead, then any', () => {
    expect(
      turnaroundStopKeeper([row('d', ['drums'], { hooked: true }), row('w', ['warm']), row('l', ['lead'])])?.id
    ).toBe('l')
    expect(turnaroundStopKeeper([row('l', ['lead']), row('w', ['warm'], { hooked: true })])?.id).toBe('w')
    expect(turnaroundStopKeeper([row('b', ['bass']), row('w', ['warm'])])?.id).toBe('w')
    expect(turnaroundStopKeeper([row('d', ['drums']), row('b', ['bass', 'warm'])])).toBeNull()
    expect(ids({ random: seq([0, 0.45, 0.5]) })).toEqual(['d', 'b', 'w']) // everything but the lead
  })

  it("the stop is never longer than the kept row's own loop", () => {
    const rows = [row('d', ['drums']), row('l', ['lead'], { barLength: 0.25 })]
    const plan = rollTurnaround(input({ rows, random: seq([0, 0.45, 0.9]) }))
    expect(plan?.move).toBe('stop')
    expect(plan?.beats).toBe(1)
  })

  it('the wash takes the row the arc removes at this wrap, else every row but drums', () => {
    expect(ids({ leavingRowId: 'd', random: seq([0, 0.55]) })).toEqual(['d'])
    expect(ids({ random: seq([0, 0.55]) })).toEqual(['b', 'l', 'w'])
    // a leaving row that is not heard is not the target
    const rows = BED.map((r) => (r.id === 'w' ? { ...r, audible: false } : r))
    expect(ids({ rows, leavingRowId: 'w', random: seq([0, 0.55]) })).toEqual(['b', 'l'])
  })

  it('the lift and the dip take every row but drums, and skip a row mid filter-in', () => {
    const rows = BED.map((r) => (r.id === 'l' ? { ...r, inFilterIn: true } : r))
    const lift = rollTurnaround(input({ rows, random: seq([0, 0.65, 0]) }))
    expect(lift?.move).toBe('lift')
    expect(lift?.beats).toBe(4)
    expect(lift?.rows.map((r) => r.rowId)).toEqual(['b', 'w'])
    expect(lift?.rows[0].filter).toEqual(turnaroundLiftCurve(4))
    const dip = rollTurnaround(input({ rows, random: seq([0, 0.85]) }))
    expect(dip?.move).toBe('dip')
    expect(dip?.rows[0].filter).toEqual(turnaroundDipCurve(4))
  })

  it('the riser has no rows, only its length in bars', () => {
    expect(rollTurnaround(input({ random: seq([0, 0.95, 0.5]) }))).toEqual({
      move: 'riser',
      beats: 8,
      halvings: 0,
      rows: [],
      riserBars: 2
    })
  })

  it('a thinning arc never drops a row', () => {
    const random = mulberry32(11)
    for (let i = 0; i < 2000; i++) {
      const plan = rollTurnaround(input({ arc: 'thinning', random }))
      if (plan === null) continue
      expect(['wash', 'dip']).toContain(plan.move)
      for (const r of plan.rows) expect(r.volume).toBeUndefined()
    }
  })
})

describe('the weights', () => {
  it('are the spec table', () => {
    expect(TURNAROUND_WEIGHTS).toEqual({
      growing: { 'drum drop': 2, 'low drop': 3, stop: 1, wash: 0, lift: 3, dip: 0, riser: 3 },
      thinning: { 'drum drop': 0, 'low drop': 0, stop: 0, wash: 3, lift: 0, dip: 3, riser: 0 },
      steady: { 'drum drop': 2, 'low drop': 2, stop: 1, wash: 1, lift: 2, dip: 1, riser: 1 }
    })
  })

  it('make the stop the rarest move drawn, everywhere', () => {
    for (const arc of ['growing', 'thinning', 'steady'] as const) {
      const w = TURNAROUND_WEIGHTS[arc]
      if (w.stop === 0) continue
      for (const m of TURNAROUND_MOVES.filter((x) => w[x] > 0)) expect(w.stop).toBeLessThanOrEqual(w[m])
    }
  })

  it('draw moves in proportion', () => {
    const random = mulberry32(5)
    const counts: Partial<Record<TurnaroundMove, number>> = {}
    let n = 0
    for (let i = 0; i < 20000; i++) {
      const plan = rollTurnaround(input({ arc: 'growing', random }))
      if (plan === null) continue
      n++
      counts[plan.move] = (counts[plan.move] ?? 0) + 1
    }
    // growing: drum drop 2, low drop 3, stop 1, lift 3, riser 3 -- of 12
    expect((counts['low drop'] ?? 0) / n).toBeCloseTo(3 / 12, 1)
    expect((counts.stop ?? 0) / n).toBeCloseTo(1 / 12, 1)
    expect(counts.wash).toBeUndefined()
    expect(counts.dip).toBeUndefined()
  })
})

describe('every plan', () => {
  it('ends every curve on the one at rest, and is at most min(half the loop, 4 bars)', () => {
    const random = mulberry32(9)
    for (const loopBars of [1, 2, 4, 8, 16, 32]) {
      for (const arc of ['growing', 'thinning', 'steady'] as const) {
        for (let i = 0; i < 200; i++) {
          const plan = rollTurnaround(input({ loopBars, arc, random }))
          if (plan === null) continue
          expect(plan.beats).toBeGreaterThanOrEqual(1)
          expect(plan.beats).toBeLessThanOrEqual(turnaroundCapBeats(loopBars))
          if (plan.riserBars !== undefined) expect(plan.riserBars * 4).toBe(plan.beats)
          for (const r of plan.rows) {
            if (r.volume) {
              expect(r.volume.at(-1)).toEqual({ beats: 0, value: 1 })
              expect(r.volume[0].beats).toBeCloseTo(plan.beats, 9)
            }
            if (r.filter) {
              const rest = r.filter.mode === 'highpass' ? 0 : 1
              expect(r.filter.cutoff.at(-1)).toEqual({ beats: 0, value: rest })
              expect(r.filter.cutoff[0].beats).toBe(plan.beats)
            }
            if (r.reverbSend) {
              expect(r.reverbSend.points.at(-1)).toEqual({ beats: 0, value: 0 })
              expect(r.reverbSend.points[0].beats).toBe(plan.beats)
            }
          }
        }
      }
    }
  })

  it('draws each length from its own menu', () => {
    const seen: Partial<Record<TurnaroundMove, Set<number>>> = {}
    const random = mulberry32(13)
    for (let i = 0; i < 6000; i++) {
      const plan = rollTurnaround(input({ loopBars: 32, random }))
      if (plan === null) continue
      const set = seen[plan.move] ?? new Set<number>()
      set.add(plan.beats)
      seen[plan.move] = set
    }
    expect(sorted(seen['drum drop'])).toEqual([1, 2, 4])
    expect(sorted(seen['low drop'])).toEqual([2, 4, 8])
    expect(sorted(seen.stop)).toEqual([1, 2, 4])
    expect(sorted(seen.wash)).toEqual([4])
    expect(sorted(seen.lift)).toEqual([4, 8])
    expect(sorted(seen.dip)).toEqual([4])
    expect(sorted(seen.riser)).toEqual([4, 8, 16])
  })

  it('clamps a drawn length to the loop', () => {
    // a 2-bar loop caps every move at 1 bar: an 8-beat low drop plays 4
    expect(rollTurnaround(input({ loopBars: 2, random: seq([0, 0.25, 0.9]) }))).toMatchObject({
      move: 'low drop',
      beats: 4
    })
  })
})

describe('turnaroundArc', () => {
  it("is steady with no leg or at the leg's target; else the leg's direction", () => {
    expect(turnaroundArc(null, 3)).toBe('steady')
    expect(turnaroundArc({ phase: 'growing', target: 5 }, 3)).toBe('growing')
    expect(turnaroundArc({ phase: 'growing', target: 5 }, 5)).toBe('steady')
    expect(turnaroundArc({ phase: 'thinning', target: 2 }, 4)).toBe('thinning')
    expect(turnaroundArc({ phase: 'thinning', target: 2 }, 2)).toBe('steady')
    // rows on the far side of the target: the leg is about to turn round
    expect(turnaroundArc({ phase: 'growing', target: 4 }, 5)).toBe('steady')
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/shared/radioTurnaroundRoll.test.ts`
Expected: FAIL, with `rollTurnaround is not a function` (and similar).

- [ ] **Step 3: Implement it**

In `src/shared/radioTurnaround.ts`, replace the import block added in Task 3:

```ts
import { buildDropOutCurve } from './radioDropOut'
import type { AutomationPoint, FilterMode } from './toolkit'
```

with

```ts
import type { DiscoverSlotKind } from './discoverSlotKind'
import { buildDropOutCurve, pickDropOutBeats } from './radioDropOut'
import type { AutomationPoint, FilterMode } from './toolkit'
```

Append to the end of the file:

```ts
// ---- the moves and the draw ----

export type TurnaroundMove = 'drum drop' | 'low drop' | 'stop' | 'wash' | 'lift' | 'dip' | 'riser'

/** Every move, in the order the draw walks them. */
export const TURNAROUND_MOVES: readonly TurnaroundMove[] = [
  'drum drop',
  'low drop',
  'stop',
  'wash',
  'lift',
  'dip',
  'riser'
]

/** Where the density arc is heading. An INPUT: the caller reads its own arc (turnaroundArc). */
export type TurnaroundArc = 'growing' | 'thinning' | 'steady'

/** Spec section 2. Thinning drops nothing (rows that come back on the one read as growth); the
 * stop, the biggest move here, is the rarest everywhere. */
export const TURNAROUND_WEIGHTS: Readonly<
  Record<TurnaroundArc, Readonly<Record<TurnaroundMove, number>>>
> = {
  growing: { 'drum drop': 2, 'low drop': 3, stop: 1, wash: 0, lift: 3, dip: 0, riser: 3 },
  thinning: { 'drum drop': 0, 'low drop': 0, stop: 0, wash: 3, lift: 0, dip: 3, riser: 0 },
  steady: { 'drum drop': 2, 'low drop': 2, stop: 1, wash: 1, lift: 2, dip: 1, riser: 1 }
}

/** One row as the planner sees it. `id` is opaque (a radio slot, a timeline channel). */
export interface TurnaroundRow {
  id: string
  kinds: readonly DiscoverSlotKind[]
  /** The row is held longer (radio's hook): the stop keeps it first, when it is melodic. */
  hooked: boolean
  /** Heard right now. A row that is not is never touched and does not count. */
  audible: boolean
  /** A change's filter in is sweeping it this lap: filter moves skip it. */
  inFilterIn: boolean
  /** Its own loop, in bars: a stop is never longer. */
  barLength: number
}

/** What a plan does to one row. Every curve is in beats before the wrap (see the curves). */
export interface TurnaroundRowCurves {
  rowId: string
  volume?: TurnaroundPoint[]
  filter?: TurnaroundFilter
  reverbSend?: TurnaroundWash
}

export interface TurnaroundPlan {
  move: TurnaroundMove
  /** The move's length in beats, ending on the wrap. */
  beats: number
  /** 0 for a fresh move; 1 or 2 for a diminution (the same move at half the length). */
  halvings: number
  rows: TurnaroundRowCurves[]
  /** The riser's length in bars (its own voice; `rows` is empty). */
  riserBars?: number
}

/** What a phrase end fired, kept for the next one: never twice in a row, except diminution. */
export interface TurnaroundMemory {
  move: TurnaroundMove
  beats: number
  halvings: number
}

export interface TurnaroundInput {
  rate: RadioTurnarounds
  random: () => number
  /** The loop the move plays in (its lap ends on the wrap). */
  loopBars: number
  /** rememberTurnaround of the previous phrase end, or null when nothing fired there. */
  lastPhrase: TurnaroundMemory | null
  rows: readonly TurnaroundRow[]
  arc: TurnaroundArc
  /** The row the arc removes at this wrap, if any: the wash's target. */
  leavingRowId: string | null
}

/** Length menus, in beats unless named bars. The spec weights only the stop's. */
const LOW_DROP_BEATS: readonly number[] = [2, 4, 8]
const STOP_BEATS: readonly { item: number; weight: number }[] = [
  { item: 1, weight: 2 },
  { item: 2, weight: 2 },
  { item: 4, weight: 1 }
]
const LIFT_BEATS: readonly number[] = [4, 8]
const RISER_BARS: readonly number[] = [1, 2, 4]
const WASH_BEATS = 4
const DIP_BEATS = 4

/** Each move's shortest length: a move whose shortest does not fit the cap is out of the draw. */
const SHORTEST_BEATS: Readonly<Record<TurnaroundMove, number>> = {
  'drum drop': 1,
  'low drop': 2,
  stop: 1,
  wash: 4,
  lift: 4,
  dip: 4,
  riser: 4
}

/** The moves a diminution may repeat (spec section 1). */
const DIMINISHING: readonly TurnaroundMove[] = ['drum drop', 'low drop', 'lift']
export const TURNAROUND_MAX_HALVINGS = 2

/** How far the filter and wash moves go. */
interface TurnaroundLooks {
  liftTop: number
  dipFloor: number
  washPeak: number
}

const BOLD_LOOKS: TurnaroundLooks = {
  liftTop: TURNAROUND_LIFT_TOP,
  dipFloor: TURNAROUND_DIP_FLOOR,
  washPeak: TURNAROUND_WASH_PEAK
}

const isDrums = (r: TurnaroundRow): boolean => r.kinds.includes('drums')
const isLow = (r: TurnaroundRow): boolean => isDrums(r) || r.kinds.includes('bass')
const isMelodic = (r: TurnaroundRow): boolean => !isLow(r)

/** The row a stop keeps playing: melodic, never drums or bass (the rest measure keeps a hook
 * line). The hook row if it is melodic, else a lead, else any melodic row; null for none. */
export function turnaroundStopKeeper(audible: readonly TurnaroundRow[]): TurnaroundRow | null {
  return (
    audible.find((r) => r.hooked && isMelodic(r)) ??
    audible.find((r) => isMelodic(r) && r.kinds.includes('lead')) ??
    audible.find(isMelodic) ??
    null
  )
}

/** The rows each move would act on, worked out once per roll, with no randomness. */
interface Bed {
  audible: TurnaroundRow[]
  drums: TurnaroundRow[]
  low: TurnaroundRow[]
  keeper: TurnaroundRow | null
  washed: TurnaroundRow[]
  filtered: TurnaroundRow[]
}

function bedOf(rows: readonly TurnaroundRow[], leavingRowId: string | null): Bed {
  const audible = rows.filter((r) => r.audible)
  const leaving = leavingRowId === null ? undefined : audible.find((r) => r.id === leavingRowId)
  return {
    audible,
    drums: audible.filter(isDrums),
    low: audible.filter(isLow),
    keeper: turnaroundStopKeeper(audible),
    washed: leaving !== undefined ? [leaving] : audible.filter((r) => !isDrums(r)),
    filtered: audible.filter((r) => !isDrums(r) && !r.inFilterIn)
  }
}

/** The guards (spec section 2): a move is in the draw only when it can sound and leaves music
 * playing. */
function canSound(move: TurnaroundMove, bed: Bed): boolean {
  const n = bed.audible.length
  switch (move) {
    case 'drum drop':
      return n >= 2 && bed.drums.length > 0
    case 'low drop':
      return n >= 2 && bed.low.length > 0 && bed.low.length < n
    case 'stop':
      return n >= 2 && bed.keeper !== null && bed.keeper.barLength * BEATS_PER_BAR >= 1
    case 'wash':
      return bed.washed.length > 0
    case 'lift':
    case 'dip':
      return bed.filtered.length > 0
    case 'riser':
      return n > 0
  }
}

function pickWeighted<T>(items: readonly { item: T; weight: number }[], random: () => number): T {
  const total = items.reduce((sum, x) => sum + x.weight, 0)
  let draw = random() * total
  for (const x of items) {
    draw -= x.weight
    if (draw < 0) return x.item
  }
  return items[items.length - 1].item
}

function pickEven<T>(items: readonly T[], random: () => number): T {
  return items[Math.min(items.length - 1, Math.floor(random() * items.length))]
}

function drawOf(bed: Bed, arc: TurnaroundArc, capBeats: number): TurnaroundMove[] {
  const weights = TURNAROUND_WEIGHTS[arc]
  return TURNAROUND_MOVES.filter(
    (m) => weights[m] > 0 && SHORTEST_BEATS[m] <= capBeats && canSound(m, bed)
  )
}

/** The moves a phrase end could draw right now, with no randomness: the guards, the cap and the
 * arc's weights. rollTurnaround draws from exactly this. */
export function turnaroundDraw(
  input: Pick<TurnaroundInput, 'rows' | 'leavingRowId' | 'loopBars' | 'arc'>
): TurnaroundMove[] {
  const capBeats = turnaroundCapBeats(input.loopBars)
  if (!(capBeats > 0)) return []
  return drawOf(bedOf(input.rows, input.leavingRowId), input.arc, capBeats)
}

function drawBeats(move: TurnaroundMove, bed: Bed, capBeats: number, random: () => number): number {
  switch (move) {
    case 'drum drop':
      return Math.min(pickDropOutBeats(random), capBeats)
    case 'low drop':
      return Math.min(pickEven(LOW_DROP_BEATS, random), capBeats)
    case 'stop': {
      // never longer than the kept row's own loop (canSound saw that 1 beat fits)
      const most = (bed.keeper?.barLength ?? 0) * BEATS_PER_BAR
      return Math.min(pickWeighted(STOP_BEATS.filter((o) => o.item <= most), random), capBeats)
    }
    case 'lift':
      return Math.min(pickEven(LIFT_BEATS, random), capBeats)
    case 'riser':
      return Math.min(pickEven(RISER_BARS, random) * BEATS_PER_BAR, capBeats)
    case 'wash':
      return Math.min(WASH_BEATS, capBeats)
    case 'dip':
      return Math.min(DIP_BEATS, capBeats)
  }
}

function build(
  move: TurnaroundMove,
  beats: number,
  halvings: number,
  bed: Bed,
  loopBars: number,
  random: () => number,
  looks: TurnaroundLooks
): TurnaroundPlan | null {
  const plan = (rows: TurnaroundRowCurves[]): TurnaroundPlan => ({ move, beats, halvings, rows })
  switch (move) {
    case 'drum drop': {
      const volume = turnaroundDropCurve(loopBars, beats)
      if (volume.length === 0) return null
      return plan([{ rowId: pickEven(bed.drums, random).id, volume }])
    }
    case 'low drop':
    case 'stop': {
      const volume = turnaroundDropCurve(loopBars, beats)
      if (volume.length === 0) return null
      const dropped = move === 'low drop' ? bed.low : bed.audible.filter((r) => r !== bed.keeper)
      return plan(dropped.map((r) => ({ rowId: r.id, volume: volume.map((p) => ({ ...p })) })))
    }
    case 'wash':
      return plan(
        bed.washed.map((r) => ({ rowId: r.id, reverbSend: turnaroundWashCurve(beats, looks.washPeak) }))
      )
    case 'lift':
      return plan(
        bed.filtered.map((r) => ({ rowId: r.id, filter: turnaroundLiftCurve(beats, looks.liftTop) }))
      )
    case 'dip':
      return plan(
        bed.filtered.map((r) => ({ rowId: r.id, filter: turnaroundDipCurve(beats, looks.dipFloor) }))
      )
    case 'riser':
      return { ...plan([]), riserBars: beats / BEATS_PER_BAR }
  }
}

/**
 * THE phrase end's roll -- once, at the start of the lap that ends a phrase (RadioClockStep's
 * turnaroundLapStarts). Null for "nothing this phrase end".
 *
 * - Never at two phrase ends in a row, except DIMINUTION: after a drum drop, a low drop or a
 *   lift, the next phrase end may repeat the same move at half its length -- two halvings at
 *   most, at the same rate, never below one beat, and only while the arc still weights it and
 *   its guards pass.
 * - Otherwise: the rate, then a move weighted by the arc among those that can sound and fit
 *   min(half the loop, 4 bars), then its length, then (a drum drop) its row.
 *
 * Guards are checked before any draw, so a phrase end that cannot have one costs no randomness.
 * Every move ends exactly on the one; only WHEN a phrase end gets one is rolled.
 */
export function rollTurnaround(input: TurnaroundInput): TurnaroundPlan | null {
  const { random, loopBars, lastPhrase, arc } = input
  const chance = TURNAROUND_CHANCE[input.rate] ?? 0
  const capBeats = turnaroundCapBeats(loopBars)
  if (!(chance > 0) || !(capBeats > 0)) return null
  const bed = bedOf(input.rows, input.leavingRowId)
  if (lastPhrase !== null) {
    const { move } = lastPhrase
    if (!DIMINISHING.includes(move) || lastPhrase.halvings >= TURNAROUND_MAX_HALVINGS) return null
    const beats = Math.min(lastPhrase.beats / 2, capBeats)
    if (beats < 1 || !(TURNAROUND_WEIGHTS[arc][move] > 0) || !canSound(move, bed)) return null
    if (!(random() < chance)) return null
    return build(move, beats, lastPhrase.halvings + 1, bed, loopBars, random, BOLD_LOOKS)
  }
  const moves = drawOf(bed, arc, capBeats)
  if (moves.length === 0 || !(random() < chance)) return null
  const move = pickWeighted(
    moves.map((m) => ({ item: m, weight: TURNAROUND_WEIGHTS[arc][m] })),
    random
  )
  return build(move, drawBeats(move, bed, capBeats, random), 0, bed, loopBars, random, BOLD_LOOKS)
}

/** What to remember of a phrase end for the next one. */
export function rememberTurnaround(plan: TurnaroundPlan | null): TurnaroundMemory | null {
  return plan === null ? null : { move: plan.move, beats: plan.beats, halvings: plan.halvings }
}

/** The arc's direction from a density leg (radioDensity's DensityLeg, or the web radio's
 * RadioDensity): steady with no leg, and at or past its target (it is about to turn round --
 * radioDensity has no hold); otherwise its phase. The caller passes `steady` with density off. */
export function turnaroundArc(
  leg: { phase: 'growing' | 'thinning'; target: number } | null,
  count: number
): TurnaroundArc {
  if (leg === null) return 'steady'
  if (leg.phase === 'growing') return count < leg.target ? 'growing' : 'steady'
  return count > leg.target ? 'thinning' : 'steady'
}
```

- [ ] **Step 4: Run it to make sure it passes**

Run: `npx vitest run src/shared/radioTurnaroundRoll.test.ts src/shared/radioTurnaroundCurves.test.ts src/shared/radioTurnaround.test.ts`
Expected: PASS.

- [ ] **Step 5: Format, lint, typecheck both repos**

```bash
cd /Users/nickel/Claudecode/sssketch
npx prettier --write src/shared/radioTurnaround.ts src/shared/radioTurnaroundRoll.test.ts
npx eslint src/shared/radioTurnaround.ts src/shared/radioTurnaroundRoll.test.ts
npm run typecheck
cd /Users/nickel/Claudecode/ell.ing/radio && npm run typecheck
```
Expected: clean.

- [ ] **Step 6: Commit**

```bash
cd /Users/nickel/Claudecode/sssketch
git add src/shared/radioTurnaround.ts src/shared/radioTurnaroundRoll.test.ts
git commit -m "radio turnarounds Task 4: rollTurnaround -- guards, arc weights, never twice but diminution, the stop keeps a melodic row, thinning drops nothing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 5: `combineRadioCurves` and the change under a turnaround (sssketch)

**Files:**
- Modify: `src/shared/radioTurnaround.ts`
- Test: `src/shared/radioTurnaroundCombine.test.ts` (create)

- [ ] **Step 1: Write the failing test**

`src/shared/radioTurnaroundCombine.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildDropOutCurve } from './radioDropOut'
import { buildBloomCurve, buildDuckCurve, buildFilterInCurve } from './radioTransition'
import {
  combineRadioCurves,
  radioTransitionUnderTurnaround,
  turnaroundLiftCurve,
  turnaroundToLoopBars,
  turnaroundWashCurve,
  turnaroundWashSend
} from './radioTurnaround'
import type { AutomationPoint } from './toolkit'

function close(actual: AutomationPoint[], expected: AutomationPoint[]): void {
  expect(actual).toHaveLength(expected.length)
  actual.forEach((p, i) => {
    expect(p.bar).toBeCloseTo(expected[i].bar, 9)
    expect(p.value).toBeCloseTo(expected[i].value, 9)
  })
}

describe('combineRadioCurves', () => {
  const drop = buildDropOutCurve(8, 4) // [{0,1},{7,1},{7.02,0},{8,0}]
  const duck = buildDuckCurve(8, 1) // [{0,0.45},{1,1}]

  it('multiplies volume, so a turnaround never cancels a duck, a hole or an arc exit', () => {
    close(combineRadioCurves(drop, duck, 'volume'), [
      { bar: 0, value: 0.45 },
      { bar: 1, value: 1 },
      { bar: 7, value: 1 },
      { bar: 7.02, value: 0 },
      { bar: 8, value: 0 }
    ])
  })

  it('keeps a step where either curve steps', () => {
    const stepping = [
      { bar: 0, value: 1 },
      { bar: 2, value: 1 },
      { bar: 2, value: 0 },
      { bar: 4, value: 0 }
    ]
    const half = [
      { bar: 0, value: 0.5 },
      { bar: 4, value: 0.5 }
    ]
    expect(combineRadioCurves(stepping, half, 'volume')).toEqual([
      { bar: 0, value: 0.5 },
      { bar: 2, value: 0.5 },
      { bar: 2, value: 0 },
      { bar: 4, value: 0 }
    ])
  })

  it('takes the larger send at each point', () => {
    const bloom = buildBloomCurve(8, 1) // [{0,0.7},{1,0}]
    const wash = turnaroundToLoopBars(turnaroundWashSend(turnaroundWashCurve(4), 0.2), 8)
    close(combineRadioCurves(bloom, wash, 'reverbSend'), [
      { bar: 0, value: 0.7 },
      { bar: 1, value: 0.2 },
      { bar: 7, value: 0.2 },
      { bar: 8, value: 0.85 }
    ])
  })

  it('keeps the filter curve already there: a row in a filter in is skipped by filter moves', () => {
    const sweep = buildFilterInCurve(8, 1)
    const lift = turnaroundToLoopBars(turnaroundLiftCurve(4).cutoff, 8)
    expect(combineRadioCurves(sweep, lift, 'filterCutoff')).toEqual(sweep)
    expect(combineRadioCurves([], lift, 'filterCutoff')).toEqual(lift)
  })

  it('an empty side is no curve', () => {
    expect(combineRadioCurves([], duck, 'volume')).toEqual(duck)
    expect(combineRadioCurves(duck, [], 'reverbSend')).toEqual(duck)
    expect(combineRadioCurves([], [], 'volume')).toEqual([])
  })

  it('leaves its inputs alone', () => {
    const a = buildDropOutCurve(8, 4)
    const b = buildDuckCurve(8, 1)
    combineRadioCurves(a, b, 'volume')
    expect(a).toEqual(buildDropOutCurve(8, 4))
    expect(b).toEqual(buildDuckCurve(8, 1))
  })
})

describe('radioTransitionUnderTurnaround', () => {
  it("turns a change's lead-in into a cut: the turnaround is its lead-in", () => {
    expect(radioTransitionUnderTurnaround('hole')).toBe('cut')
    expect(radioTransitionUnderTurnaround('riser')).toBe('cut')
  })

  it('keeps an arrival', () => {
    for (const kind of ['cut', 'filter in', 'bloom', 'duck'] as const) {
      expect(radioTransitionUnderTurnaround(kind)).toBe(kind)
    }
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/shared/radioTurnaroundCombine.test.ts`
Expected: FAIL, with `combineRadioCurves is not a function`.

- [ ] **Step 3: Implement it**

In `src/shared/radioTurnaround.ts`, replace the import block:

```ts
import type { DiscoverSlotKind } from './discoverSlotKind'
import { buildDropOutCurve, pickDropOutBeats } from './radioDropOut'
import type { AutomationPoint, FilterMode } from './toolkit'
```

with

```ts
import type { DiscoverSlotKind } from './discoverSlotKind'
import { buildDropOutCurve, pickDropOutBeats } from './radioDropOut'
import { radioGestureLeadsChange, type RadioTransitionKind } from './radioTransition'
import {
  evaluateAutomation,
  type AutomationParam,
  type AutomationPoint,
  type FilterMode
} from './toolkit'
```

(`radioTransition` imports neither `radioSchedule` nor this file, so there is no cycle.)

Append to the end of the file:

```ts
// ---- living with layer changes and other gestures (spec section 3) ----

/** A curve's value just BEFORE `bar` (its left limit): where a stacked pair steps, the earlier
 * value. evaluateAutomation is the right limit (the later value), as the engine reads it. */
function valueBefore(points: readonly AutomationPoint[], bar: number): number {
  if (bar <= points[0].bar) return points[0].value
  for (let i = 1; i < points.length; i++) {
    const b = points[i]
    if (b.bar < bar) continue
    const a = points[i - 1]
    return a.value + (b.value - a.value) * ((bar - a.bar) / (b.bar - a.bar))
  }
  return points[points.length - 1].value
}

/**
 * Two curves on one stem's lane, as one (clip-relative bars, normalised and ascending, as
 * every builder here and in radioTransition.ts returns them):
 *   - `volume` MULTIPLIES, so a turnaround's drop never cancels a hole, a duck or the arc's
 *     exit -- it stacks on them;
 *   - `reverbSend` takes the larger value at each point;
 *   - `filterCutoff` keeps `a`, the curve already there: a row in a change's filter in is
 *     skipped by filter moves (one filter, one mode, one lap).
 * An empty side is no curve. Evaluated at every breakpoint of either, keeping both sides of any
 * step, so between breakpoints it is linear like both inputs (a product of two ramps is not,
 * exactly; the drops and ducks it meets are steps and single ramps). Inputs untouched.
 */
export function combineRadioCurves(
  a: readonly AutomationPoint[],
  b: readonly AutomationPoint[],
  lane: AutomationParam
): AutomationPoint[] {
  if (a.length === 0) return b.map((p) => ({ ...p }))
  if (b.length === 0 || lane === 'filterCutoff') return a.map((p) => ({ ...p }))
  const join = lane === 'volume' ? (x: number, y: number): number => x * y : Math.max
  const bars = [...new Set([...a, ...b].map((p) => p.bar))].sort((x, y) => x - y)
  const out: AutomationPoint[] = []
  for (const bar of bars) {
    const before = join(valueBefore(a, bar), valueBefore(b, bar))
    const after = join(evaluateAutomation([...a], bar, 1), evaluateAutomation([...b], bar, 1))
    out.push({ bar, value: before })
    if (after !== before) out.push({ bar, value: after })
  }
  return out
}

/** A change landing on the wrap a turnaround ends on keeps only its arrival (filter in, bloom,
 * duck, or a cut): the turnaround is its lead-in, so a hole or a riser becomes a cut. */
export function radioTransitionUnderTurnaround(kind: RadioTransitionKind): RadioTransitionKind {
  return radioGestureLeadsChange(kind) ? 'cut' : kind
}
```

- [ ] **Step 4: Run it to make sure it passes**

Run: `npx vitest run src/shared/radioTurnaroundCombine.test.ts src/shared/radioTurnaroundRoll.test.ts src/shared/radioTurnaroundCurves.test.ts src/shared/radioTurnaround.test.ts`
Expected: PASS.

- [ ] **Step 5: Format, lint, typecheck both repos**

```bash
cd /Users/nickel/Claudecode/sssketch
npx prettier --write src/shared/radioTurnaround.ts src/shared/radioTurnaroundCombine.test.ts
npx eslint src/shared/radioTurnaround.ts src/shared/radioTurnaroundCombine.test.ts
npm run typecheck
cd /Users/nickel/Claudecode/ell.ing/radio && npm run typecheck
```
Expected: clean.

- [ ] **Step 6: Commit**

```bash
cd /Users/nickel/Claudecode/sssketch
git add src/shared/radioTurnaround.ts src/shared/radioTurnaroundCombine.test.ts
git commit -m "radio turnarounds Task 5: combineRadioCurves (volume multiplies, send takes the max, a filter in keeps its lane) and a change under a turnaround keeps only its arrival

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 6: `RadioSettings.turnarounds`, with migration (sssketch and ell.ing/radio)

`turnarounds` joins `RadioSettings`, and `dropOuts` stays as a deprecated mirror (see "Settings compatibility" at the top). The web radio's `WEB_RADIO_DEFAULTS` is a typed `RadioSettings`, so it has to gain the field **in this same task**, or its typecheck breaks. Nothing reads `turnarounds` yet.

**Files:**
- Modify: `src/shared/radioSchedule.ts` (imports; `RadioSettings`; `DEFAULT_RADIO_SETTINGS`; `normalizeRadioSettings`)
- Modify: `src/shared/radioSchedule.test.ts` (the default-settings literal)
- Test: `src/shared/radioTurnaroundSettings.test.ts` (create)
- Modify: `src/main/discoverSettingsStore.ts` (doc line), `src/main/discoverSettingsStore.test.ts`
- Radio: modify `src/radio/settings.ts`, `src/radio/settings.test.ts`

- [ ] **Step 1: Write the failing tests**

`src/shared/radioTurnaroundSettings.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { DEFAULT_RADIO_SETTINGS, normalizeRadioSettings } from './radioSchedule'

describe('RadioSettings.turnarounds', () => {
  it('defaults to rare, with the deprecated dropOuts mirror equal', () => {
    expect(DEFAULT_RADIO_SETTINGS.turnarounds).toBe('rare')
    expect(DEFAULT_RADIO_SETTINGS.dropOuts).toBe('rare')
  })

  it('carries an old drop-outs choice over', () => {
    expect(normalizeRadioSettings({ dropOuts: 'often' })).toMatchObject({
      turnarounds: 'often',
      dropOuts: 'often'
    })
    expect(normalizeRadioSettings({ dropOuts: 'off' })).toMatchObject({
      turnarounds: 'off',
      dropOuts: 'off'
    })
  })

  it('reads turnarounds when there is no drop-outs value', () => {
    expect(normalizeRadioSettings({ turnarounds: 'often' })).toMatchObject({
      turnarounds: 'often',
      dropOuts: 'often'
    })
  })

  it('while the shipped menu still writes dropOuts, that is the newer of the two', () => {
    expect(normalizeRadioSettings({ turnarounds: 'rare', dropOuts: 'off' })).toMatchObject({
      turnarounds: 'off',
      dropOuts: 'off'
    })
  })

  it('falls back to rare for junk', () => {
    expect(normalizeRadioSettings({ turnarounds: 'loud', dropOuts: 3 })).toMatchObject({
      turnarounds: 'rare',
      dropOuts: 'rare'
    })
  })
})
```

In `src/main/discoverSettingsStore.test.ts`, add this test inside the same `describe` as `'migrates a 1.3.0 file, which stored radioPace flat and had no radio object'`, directly after that test:

```ts
  it('carries a saved drop-outs choice over to turnarounds', async () => {
    writeFileSync(
      join(dir, 'discoverSettings.json'),
      JSON.stringify({ radio: { dropOuts: 'off' } }),
      'utf-8'
    )
    const { loadDiscoverSettings } = await import('./discoverSettingsStore')
    expect(loadDiscoverSettings().radio.turnarounds).toBe('off')
  })
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/shared/radioTurnaroundSettings.test.ts src/main/discoverSettingsStore.test.ts`
Expected: FAIL. `turnarounds` is `undefined`.

- [ ] **Step 3: Implement it in `src/shared/radioSchedule.ts`**

(a) Imports. Replace

```ts
import { DEFAULT_RADIO_DROP_OUTS, normalizeRadioDropOuts, type RadioDropOuts } from './radioDropOut'
import { turnaroundPhraseLaps } from './radioTurnaround'
```

with

```ts
import type { RadioDropOuts } from './radioDropOut'
import {
  DEFAULT_RADIO_TURNAROUNDS,
  normalizeRadioTurnarounds,
  turnaroundPhraseLaps,
  type RadioTurnarounds
} from './radioTurnaround'
```

(b) `RadioSettings`. Replace

```ts
  transitions: RadioTransitions
  dropOuts: RadioDropOuts
  turnover: RadioTurnover
```

with

```ts
  transitions: RadioTransitions
  /** How often a phrase end gets a turnaround (radioTurnaround.ts). Absorbed the old
   * `dropOuts` row (2026-10-02). */
  turnarounds: RadioTurnarounds
  /** DEPRECATED: equal to `turnarounds` (normalizeRadioSettings keeps it so). Kept only while
   * the shipped DiscoverRadioMenu and DiscoverPanel still read and write it -- the radio
   * turnarounds plan's Task 14 moves them over, and its Task 16 deletes this field. */
  dropOuts: RadioDropOuts
  turnover: RadioTurnover
```

(c) `DEFAULT_RADIO_SETTINGS`. Replace

```ts
  transitions: DEFAULT_RADIO_TRANSITIONS,
  dropOuts: DEFAULT_RADIO_DROP_OUTS,
```

with

```ts
  transitions: DEFAULT_RADIO_TRANSITIONS,
  turnarounds: DEFAULT_RADIO_TURNAROUNDS,
  dropOuts: DEFAULT_RADIO_TURNAROUNDS,
```

(d) `normalizeRadioSettings`. Replace

```ts
  const channels = Number(raw.channels)
  return {
```

with

```ts
  const channels = Number(raw.channels)
  // Turnarounds absorbed drop-outs. Until the plan's Task 16 the shipped menu writes only
  // `dropOuts`, so it is read FIRST -- whenever the two differ it is the newer -- and
  // `turnarounds` is the fallback. Task 16 flips this to the spec's order.
  const turnarounds = normalizeRadioTurnarounds(raw.dropOuts, raw.turnarounds)
  return {
```

and replace

```ts
    dropOuts: normalizeRadioDropOuts(raw.dropOuts),
```

with

```ts
    turnarounds,
    dropOuts: turnarounds,
```

(e) In `src/shared/radioSchedule.test.ts`, test `'defaults to mid, the mid window, four bars, no phrase grid, four channels, subtle, rare, even and the density arc'`. Replace

```ts
      transitions: 'subtle',
      dropOuts: 'rare',
```

with

```ts
      transitions: 'subtle',
      turnarounds: 'rare',
      dropOuts: 'rare',
```

(f) In `src/main/discoverSettingsStore.test.ts`, test `'round-trips every radio setting'`. In **both** the saved object and the expected one, replace

```ts
        transitions: 'bold',
        dropOuts: 'often',
```

with

```ts
        transitions: 'bold',
        turnarounds: 'often',
        dropOuts: 'often',
```

(The expected object is indented by two fewer spaces. Match each occurrence's own indentation.)

(g) In `src/main/discoverSettingsStore.ts`, in `DiscoverSettings.radio`'s doc comment, replace `transitions, drop-out rate, turnover.` with `transitions, turnarounds, turnover.`

- [ ] **Step 4: Run the sssketch tests**

Run: `npx vitest run src/shared/radioTurnaroundSettings.test.ts src/shared/radioSchedule.test.ts src/main/discoverSettingsStore.test.ts`
Expected: PASS.

- [ ] **Step 5: The web radio's defaults**

The radio typecheck now fails, as expected: `WEB_RADIO_DEFAULTS` lacks `turnarounds`. Check with `cd /Users/nickel/Claudecode/ell.ing/radio && npm run typecheck`. Expected: `Property 'turnarounds' is missing`.

In `src/radio/settings.ts`:

- replace the header table row

  ```ts
  //   drop-outs     dropOuts                'often'   :286
  ```

  with

  ```ts
  //   drop-outs     dropOuts                'often'   :286 (deprecated mirror; goes in the plan's Task 16)
  //   turnarounds   turnarounds             'often'   the drop-outs row, renamed (2026-10-02); his choice kept
  ```

- in `WEB_RADIO_DEFAULTS`, replace

  ```ts
    dropOuts: 'often',
  ```

  with

  ```ts
    dropOuts: 'often',
    turnarounds: 'often',
  ```

In `src/radio/settings.test.ts`, in `WEB_RADIO_DEFAULTS`'s field-by-field `toEqual`, replace

```ts
      dropOuts: 'often', // drop-outs: often
```

with

```ts
      dropOuts: 'often', // drop-outs: often (deprecated mirror)
      turnarounds: 'often', // turnarounds: the drop-outs row renamed, his choice kept
```

- [ ] **Step 6: Verify both repos**

```bash
cd /Users/nickel/Claudecode/sssketch
npx prettier --write src/shared/radioSchedule.ts src/shared/radioTurnaroundSettings.test.ts src/main/discoverSettingsStore.test.ts src/main/discoverSettingsStore.ts src/shared/radioSchedule.test.ts
npx eslint src/shared/radioSchedule.ts src/shared/radioTurnaroundSettings.test.ts src/main/discoverSettingsStore.test.ts src/main/discoverSettingsStore.ts src/shared/radioSchedule.test.ts
npm run typecheck
npx vitest run src/shared src/main/discoverSettingsStore.test.ts
cd /Users/nickel/Claudecode/ell.ing/radio && npm run typecheck && npm test
```
Expected: all green. (`DiscoverPanel.tsx` still reads `radioSettings.dropOuts` and the menu still writes it. Both keep working through the mirror.)

- [ ] **Step 7: Commit, per repo**

```bash
cd /Users/nickel/Claudecode/sssketch
git add src/shared/radioSchedule.ts src/shared/radioSchedule.test.ts src/shared/radioTurnaroundSettings.test.ts src/main/discoverSettingsStore.ts src/main/discoverSettingsStore.test.ts
git commit -m "radio turnarounds Task 6: RadioSettings.turnarounds, an old drop-outs choice carried over; dropOuts kept as a mirror until the panel moves

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
cd /Users/nickel/Claudecode/ell.ing/radio
git add src/radio/settings.ts src/radio/settings.test.ts
git commit -m "radio: turnarounds 'often' in WEB_RADIO_DEFAULTS (his drop-outs choice, renamed)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 7: `planRiser`, out of `planTransition` (ell.ing/radio)

A turnaround's riser is the change riser's timing and voice without a change. Pull it out so both can use it. This is a pure refactor plus a test, and the existing riser tests stay green unchanged.

**Files:**
- Modify: `src/audio/transitions.ts` (the riser branch of `planTransition`; new `planRiser`)
- Test: `src/audio/transitions.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/audio/transitions.test.ts`, change the import line `import { planTransition, riserTailGainAt } from './transitions'` to

```ts
import { planRiser, planTransition, riserTailGainAt } from './transitions'
```

and append:

```ts
describe('planRiser', () => {
  it("ends on the wrap, starts `bars` before it on the lap's clock, and draws its character only once it fits", () => {
    let drawn = 0
    const character = () => {
      drawn++
      return RISER_BEFORE
    }
    const r = planRiser('x', W, clock, 2, character)
    expect(r).not.toBeNull()
    expect(r!.id).toBe('radio-riser-x')
    expect(r!.start).toBe(W - 4) // 2 bars at 2 s a bar
    expect(r!.end).toBe(W)
    expect(r!.tailEnd).toBe(W + RISER_TAIL_BARS * 2)
    expect(r!.character).toBe(RISER_BEFORE)
    expect(drawn).toBe(1)
    expect(planRiser('x', W, { ...clock, loopBars: 0 }, 2, character)).toBeNull()
    expect(drawn).toBe(1)
  })

  it("is planTransition's riser exactly", () => {
    const p = planTransition({ kind: 'riser', riser: RISER_BEFORE }, W, clock, clock, 'r1')
    expect(planRiser('r1', W, clock, 2, () => RISER_BEFORE)).toEqual(p.riser)
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd /Users/nickel/Claudecode/ell.ing/radio && npx vitest run src/audio/transitions.test.ts`
Expected: FAIL, with `planRiser is not a function` (or a typecheck-free import error).

- [ ] **Step 3: Implement it**

In `src/audio/transitions.ts`, replace the riser branch of `planTransition`, which is everything from

```ts
    // riser
    const clip = buildTransitionRiser(rowId, before.loopBars, bars)
```

down to and including the `    }\n  }` that closes the leading branch, just above the blank line before `  const spb = secPerBar(after.bpm)`, with:

```ts
    // riser: the timing is sssketch's, always; only the character varies
    const riser = planRiser(rowId, atTime, before, bars, () => spec.riser ?? drawRiserCharacter(random))
    if (!riser) return { kind: 'cut', beats: 0, leadStart: null }
    return { kind, beats, leadStart: riser.start, riser }
  }
```

Then add this function directly after `planTransition` (at the end of the file):

```ts
/** A riser ending exactly on the wrap `atTime`, over the end of the lap before it on the clock
 * `before` (buildTransitionRiser's timing and level: at most half the loop), in a drawn
 * character. `character` is called only once the riser fits, so a riser that cannot be placed
 * costs no draw. `id` names it (buildTransitionRiser's `radio-riser-${id}`), which seeds its
 * noise. Null when it cannot be placed. A change's riser (planTransition) and a phrase
 * turnaround's (turnaround.ts) are both this. */
export function planRiser(
  id: string,
  atTime: number,
  before: LoopClockState,
  bars: number,
  character: () => RiserCharacter
): RiserPlan | null {
  const clip = buildTransitionRiser(id, before.loopBars, bars)
  if (!clip) return null
  const spb = secPerBar(before.bpm)
  const start = atTime - before.loopBars * spb + clip.startBar * spb
  const c = character()
  const level = clip.level * Math.pow(10, c.levelDb / 20)
  // the sweep: start + (end - start) * progress ^ curve over the riser's length (sssketch's
  // own is the straight line from 0.2 to 0.95, RISER_BEFORE)
  const sweep = Array.from({ length: SWEEP_POINTS }, (_, i) => {
    const p = i / (SWEEP_POINTS - 1)
    return { bar: p * clip.lengthBars, value: c.startCutoff + (c.endCutoff - c.startCutoff) * Math.pow(p, c.curve) }
  })
  return {
    id: clip.id,
    start,
    end: atTime,
    tailEnd: atTime + RISER_TAIL_BARS * spb,
    level,
    character: c,
    cutoffHz: cutoffCurveHz(curveToTimes(sweep, start, spb)),
    swell: sample((p) => level * riserEnvelopeAt(p)),
    tail: sample((p) => level * riserTailGainAt(p))
  }
}
```

`start` is computed as `atTime - loopBars * spb + startBar * spb`, the same arithmetic as the old `lapStartTime + clip.startBar * spb`. The `"is planTransition's riser exactly"` test pins it.

- [ ] **Step 4: Run it to make sure it passes**

Run: `npx vitest run src/audio/transitions.test.ts`
Expected: PASS, every old test included.

- [ ] **Step 5: Typecheck and the whole suite**

Run: `npm run typecheck && npm test`
Expected: green.

- [ ] **Step 6: Commit**

```bash
cd /Users/nickel/Claudecode/ell.ing/radio
git add src/audio/transitions.ts src/audio/transitions.test.ts
git commit -m "radio: planRiser out of planTransition -- a phrase turnaround's riser is the same voice without a change

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 8: A turnaround plan as timed automation (ell.ing/radio, pure)

**Files:**
- Create: `src/audio/turnaround.ts`
- Test: `src/audio/turnaround.test.ts`

- [ ] **Step 1: Write the failing test**

`src/audio/turnaround.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  turnaroundDipCurve,
  turnaroundDropCurve,
  turnaroundLiftCurve,
  turnaroundWashCurve,
  type TurnaroundPlan
} from '@shared/radioTurnaround'
import { cutoffHz, type TimedPoint } from './automation'
import { planTurnaroundTimes, turnaroundPointTimes } from './turnaround'

// 120 bpm: 2 s a bar, half a second a beat; a 4-bar loop; the move ends on the wrap W
const W = 100
const clock = { startTime: 60, loopBars: 4, bpm: 120 }
const SR = 48000
const plan = (over: Partial<TurnaroundPlan>): TurnaroundPlan => ({ move: 'low drop', beats: 4, halvings: 0, rows: [], ...over })
const r6 = (pts: TimedPoint[] | undefined) =>
  (pts ?? []).map((p) => ({ time: Math.round(p.time * 1e6) / 1e6, value: Math.round(p.value * 1e6) / 1e6 }))

describe('turnaroundPointTimes', () => {
  it('counts beats back from the wrap', () => {
    expect(
      turnaroundPointTimes(
        [
          { beats: 4, value: 1 },
          { beats: 0, value: 0 },
          { beats: 0, value: 1 }
        ],
        W,
        0.5
      )
    ).toEqual([
      { time: 98, value: 1 },
      { time: 100, value: 0 },
      { time: 100, value: 1 }
    ])
  })
})

describe('planTurnaroundTimes', () => {
  it("a drop: the row's turnaround gain leaves a bar before the wrap, silent into it, full on it", () => {
    const t = planTurnaroundTimes(plan({ rows: [{ rowId: 'd', volume: turnaroundDropCurve(4, 4) }] }), W, clock, 0.5, SR)
    expect(t.at).toBe(W)
    expect(r6(t.rows[0].gain)).toEqual([
      { time: 98, value: 1 },
      { time: 98.04, value: 0 },
      { time: 100, value: 0 },
      { time: 100, value: 1 }
    ])
    expect(t.start).toBeCloseTo(98, 9)
  })

  it('a lift: the high-pass from 20 Hz up to the lift, in Hz, and back to 0 Hz (neutral) on the one', () => {
    const t = planTurnaroundTimes(plan({ move: 'lift', rows: [{ rowId: 'l', filter: turnaroundLiftCurve(4) }] }), W, clock, 0.5, SR)
    expect(t.rows[0].highpassHz).toEqual([
      { time: 98, value: cutoffHz(0) },
      { time: 100, value: cutoffHz(0.6) },
      { time: 100, value: 0 }
    ])
    expect(t.rows[0].lowpassHz).toBeUndefined()
  })

  it("a dip: the row's own filter from 20 kHz down to the dip, and back to pass-through on the one", () => {
    const t = planTurnaroundTimes(plan({ move: 'dip', rows: [{ rowId: 'l', filter: turnaroundDipCurve(4) }] }), W, clock, 0.5, SR)
    expect(t.rows[0].lowpassHz).toEqual([
      { time: 98, value: cutoffHz(1) },
      { time: 100, value: cutoffHz(0.35) },
      { time: 100, value: SR / 2 }
    ])
    expect(t.rows[0].highpassHz).toBeUndefined()
  })

  it("a wash: the row's send rises from the master send to the peak and back on the one", () => {
    const t = planTurnaroundTimes(plan({ move: 'wash', rows: [{ rowId: 'w', reverbSend: turnaroundWashCurve(4) }] }), W, clock, 0.5, SR)
    expect(r6(t.rows[0].send)).toEqual([
      { time: 98, value: 0.5 },
      { time: 100, value: 0.85 },
      { time: 100, value: 0.5 }
    ])
  })

  it('a riser: its own voice, ending on the wrap', () => {
    const t = planTurnaroundTimes(plan({ move: 'riser', beats: 8, riserBars: 2 }), W, clock, 0.5, SR, () => 0.5)
    expect(t.rows).toEqual([])
    expect(t.riser?.id).toBe('radio-riser-turnaround')
    expect(t.riser?.start).toBe(W - 4)
    expect(t.riser?.end).toBe(W)
    expect(t.start).toBe(W - 4)
  })

  it('measures beats on the clock in force before the wrap', () => {
    const slow = { ...clock, bpm: 60 } // a second a beat
    const t = planTurnaroundTimes(plan({ rows: [{ rowId: 'd', volume: turnaroundDropCurve(4, 4) }] }), W, slow, 0.5, SR)
    expect(t.start).toBeCloseTo(96, 9)
  })

  it('with nothing to play, starts on the wrap', () => {
    expect(planTurnaroundTimes(plan({}), W, clock, 0.5, SR).start).toBe(W)
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/audio/turnaround.test.ts`
Expected: FAIL, with `Failed to resolve import "./turnaround"`.

- [ ] **Step 3: Implement it**

`src/audio/turnaround.ts`:

```ts
// src/audio/turnaround.ts -- a phrase turnaround (sssketch's @shared/radioTurnaround plan) as
// timed automation on a row's nodes. Pure: Gestures.applyTurnaround writes it.
//   volume  -> the row's TURNAROUND gain (its own node after the gesture gain, so a turnaround
//              and a hole or a duck multiply, as sssketch's combineRadioCurves multiplies them)
//   lift    -> the row's high-pass (neutral at 0 Hz), ramped in Hz exponentially -- linear in the
//              normalised cutoff, the native engine's mapping (automation.ts) -- 0 Hz on the one
//   dip     -> the row's own lowpass (the filter a filter in uses), back to pass-through on the one
//   wash    -> the row's send, from the master send up to the peak, the master send on the one
//   riser   -> its own noise voice (planRiser), ending on the wrap
// A plan is in BEATS BEFORE THE WRAP; a beat here is a quarter of a bar on the clock in force
// during the lap that ends at the wrap (`before`).
import { turnaroundWashSend, type TurnaroundPlan, type TurnaroundPoint } from '@shared/radioTurnaround'
import type { FilterMode } from '@shared/toolkit'
import { cutoffHz, type TimedPoint } from './automation'
import { secPerBar, type LoopClockState } from './loopClock'
import { filterFrequency } from './masterChain'
import { drawRiserCharacter } from './riserCharacter'
import { planRiser, type RiserPlan } from './transitions'

export interface TurnaroundRowTimes {
  rowId: string
  gain?: TimedPoint[]
  /** Play with shape 'exponential'; the last point (0 Hz) is a step. */
  highpassHz?: TimedPoint[]
  /** Play with shape 'exponential'. */
  lowpassHz?: TimedPoint[]
  send?: TimedPoint[]
}

export interface TurnaroundTimes {
  /** The wrap it ends on. */
  at: number
  /** When its first point (or its riser) starts: the engine must have it before then. */
  start: number
  rows: TurnaroundRowTimes[]
  riser?: RiserPlan
}

/** Beats before the wrap as AudioContext seconds. */
export function turnaroundPointTimes(points: readonly TurnaroundPoint[], wrapTime: number, secPerBeat: number): TimedPoint[] {
  return points.map((p) => ({ time: wrapTime - p.beats * secPerBeat, value: p.value }))
}

/** A cutoff curve in Hz: the ramp on the native mapping (20 Hz .. 20 kHz), the rest on the one
 * the mode's NEUTRAL (filterFrequency: 0 Hz for a high-pass, Nyquist for a low-pass). */
function cutoffTimes(points: readonly TurnaroundPoint[], mode: FilterMode, wrapTime: number, secPerBeat: number, sampleRate: number): TimedPoint[] {
  const last = points.length - 1
  return turnaroundPointTimes(points, wrapTime, secPerBeat).map((p, i) => ({
    time: p.time,
    value: i === last ? filterFrequency(mode, p.value, sampleRate) : Math.min(cutoffHz(p.value), sampleRate * 0.49)
  }))
}

/** The whole plan, ending on the wrap `wrapTime`, on the clock `before`. `masterSend` is each
 * row's own send (a wash rises from it). `random` draws the riser's character. */
export function planTurnaroundTimes(
  plan: TurnaroundPlan,
  wrapTime: number,
  before: LoopClockState,
  masterSend: number,
  sampleRate: number,
  random: () => number = Math.random
): TurnaroundTimes {
  const spBeat = secPerBar(before.bpm) / 4
  const rows = plan.rows.map((r) => {
    const out: TurnaroundRowTimes = { rowId: r.rowId }
    if (r.volume) out.gain = turnaroundPointTimes(r.volume, wrapTime, spBeat)
    if (r.filter?.mode === 'highpass') out.highpassHz = cutoffTimes(r.filter.cutoff, 'highpass', wrapTime, spBeat, sampleRate)
    else if (r.filter) out.lowpassHz = cutoffTimes(r.filter.cutoff, 'lowpass', wrapTime, spBeat, sampleRate)
    if (r.reverbSend) out.send = turnaroundPointTimes(turnaroundWashSend(r.reverbSend, masterSend), wrapTime, spBeat)
    return out
  })
  const riser =
    plan.riserBars !== undefined ? planRiser('turnaround', wrapTime, before, plan.riserBars, () => drawRiserCharacter(random)) : null
  const firsts = [
    ...rows.flatMap((r) => [r.gain, r.highpassHz, r.lowpassHz, r.send].map((pts) => pts?.[0]?.time)),
    riser?.start
  ].filter((t): t is number => t !== undefined)
  return {
    at: wrapTime,
    start: firsts.length > 0 ? Math.min(...firsts) : wrapTime,
    rows,
    ...(riser ? { riser } : {})
  }
}
```

- [ ] **Step 4: Run it to make sure it passes**

Run: `npx vitest run src/audio/turnaround.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and the whole suite**

Run: `npm run typecheck && npm test`
Expected: green.

- [ ] **Step 6: Commit**

```bash
cd /Users/nickel/Claudecode/ell.ing/radio
git add src/audio/turnaround.ts src/audio/turnaround.test.ts
git commit -m "radio: a phrase turnaround as timed automation -- beats before the wrap on the lap's clock, Hz on the native mapping, neutral on the one

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 9: Turnaround nodes, `Gestures.applyTurnaround`, `Engine.applyTurnaround` (ell.ing/radio)

**Files:**
- Modify: `src/audio/rowVoice.ts` (two nodes)
- Modify: `src/audio/gestures.ts` (apply, cancel, prune, drop)
- Test: `src/audio/gestures.test.ts` (create)
- Modify: `src/audio/engine.ts` (`applyTurnaround`, `cancelTurnaround`, `stop`)
- Modify: `spike/engine-check/check.ts` (a `turnaround` offline-render check)

- [ ] **Step 1: Write the failing unit test**

`src/audio/gestures.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { Gestures } from './gestures'
import type { RowVoice } from './rowVoice'
import type { TurnaroundTimes } from './turnaround'

type Call = [string, ...number[]]
function fakeParam(value: number) {
  const calls: Call[] = []
  const p = {
    calls,
    value,
    cancelScheduledValues: (t: number) => (calls.push(['cancel', t]), p),
    cancelAndHoldAtTime: (t: number) => (calls.push(['hold', t]), p),
    setValueAtTime: (v: number, t: number) => (calls.push(['set', v, t]), p),
    linearRampToValueAtTime: (v: number, t: number) => (calls.push(['linear', v, t]), p),
    exponentialRampToValueAtTime: (v: number, t: number) => (calls.push(['exp', v, t]), p),
    setTargetAtTime: (v: number, t: number, tau: number) => (calls.push(['target', v, t, tau]), p)
  }
  return p
}
function fakeRow(id: string) {
  return {
    id,
    turnaround: { gain: fakeParam(1) },
    highpass: { frequency: fakeParam(0) },
    filter: { frequency: fakeParam(24000) },
    send: { gain: fakeParam(0.5) },
    bloomUntil: Number.NEGATIVE_INFINITY
  }
}
function rig(now = 90) {
  const ctx = { currentTime: now, sampleRate: 48000 }
  const rows = new Map([
    ['d', fakeRow('d')],
    ['l', fakeRow('l')]
  ])
  const g = new Gestures(ctx as unknown as BaseAudioContext, {} as AudioNode, {} as AudioNode, rows as unknown as Map<string, RowVoice>, () => [])
  const clear = () => {
    for (const r of rows.values()) for (const p of [r.turnaround.gain, r.highpass.frequency, r.filter.frequency, r.send.gain]) p.calls.length = 0
  }
  return { g, rows, ctx, clear, d: rows.get('d')!, l: rows.get('l')! }
}

const W = 100
const TIMES: TurnaroundTimes = {
  at: W,
  start: 98,
  rows: [
    {
      rowId: 'd',
      gain: [
        { time: 98, value: 1 },
        { time: 98.04, value: 0 },
        { time: 100, value: 0 },
        { time: 100, value: 1 }
      ]
    },
    {
      rowId: 'l',
      highpassHz: [
        { time: 98, value: 20 },
        { time: 100, value: 1262 },
        { time: 100, value: 0 }
      ],
      send: [
        { time: 98, value: 0.5 },
        { time: 100, value: 0.85 },
        { time: 100, value: 0.5 }
      ]
    },
    { rowId: 'gone', gain: [{ time: 98, value: 0 }] }
  ]
}

describe('Gestures.applyTurnaround', () => {
  it('writes a drop on the turnaround gain from its first point, a step back to 1 on the one', () => {
    const { g, d } = rig()
    g.applyTurnaround(TIMES, 0.5)
    expect(d.turnaround.gain.calls).toEqual([
      ['hold', 98],
      ['set', 1, 98],
      ['linear', 0, 98.04],
      ['linear', 0, 100],
      ['set', 1, 100]
    ])
  })

  it('ramps a lift on the high-pass exponentially, landing on exactly 0 Hz on the one', () => {
    const { g, l } = rig()
    g.applyTurnaround(TIMES, 0.5)
    expect(l.highpass.frequency.calls).toEqual([
      ['hold', 98],
      ['set', 20, 98],
      ['exp', 1262, 100],
      ['set', 1e-6, 100],
      ['set', 0, 100]
    ])
  })

  it('a wash on the send, holding the master send off until the wrap', () => {
    const { g, l } = rig()
    g.applyTurnaround(TIMES, 0.5)
    expect(l.send.gain.calls).toEqual([
      ['hold', 98],
      ['set', 0.5, 98],
      ['linear', 0.85, 100],
      ['set', 0.5, 100]
    ])
    expect(l.bloomUntil).toBe(W)
  })

  it('touches nothing else, and skips a row the engine does not have', () => {
    const { g, d, l } = rig()
    expect(() => g.applyTurnaround(TIMES, 0.5)).not.toThrow()
    expect(d.highpass.frequency.calls).toEqual([])
    expect(d.filter.frequency.calls).toEqual([])
    expect(l.turnaround.gain.calls).toEqual([])
  })
})

describe('Gestures.cancelTurnaround', () => {
  it('glides every param it touched back to rest, from now', () => {
    const { g, ctx, clear, d, l } = rig()
    g.applyTurnaround(TIMES, 0.5)
    ctx.currentTime = 99
    clear()
    g.cancelTurnaround(W, 0.4)
    expect(d.turnaround.gain.calls).toEqual([
      ['hold', 99],
      ['target', 1, 99, 0.015]
    ])
    expect(l.highpass.frequency.calls).toEqual([
      ['hold', 99],
      ['target', 0, 99, 0.015],
      ['set', 0, 99.1]
    ])
    expect(l.send.gain.calls).toEqual([
      ['hold', 99],
      ['target', 0.4, 99, 0.015]
    ])
    expect(l.bloomUntil).toBe(Number.NEGATIVE_INFINITY)
  })

  it('only the turnaround on that wrap, and only once', () => {
    const { g, clear, d } = rig()
    g.applyTurnaround(TIMES, 0.5)
    clear()
    g.cancelTurnaround(W + 8, 0.5)
    expect(d.turnaround.gain.calls).toEqual([])
    g.cancelTurnaround(W, 0.5)
    clear()
    g.cancelTurnaround(W, 0.5)
    expect(d.turnaround.gain.calls).toEqual([])
  })

  it('forgets one whose wrap has passed, or when the engine stops', () => {
    const { g, clear, d } = rig()
    g.applyTurnaround(TIMES, 0.5)
    g.prune(W + 0.1)
    clear()
    g.cancelTurnaround(W, 0.5)
    expect(d.turnaround.gain.calls).toEqual([])
    g.applyTurnaround(TIMES, 0.5)
    g.dropTurnaround()
    clear()
    g.cancelTurnaround(W, 0.5)
    expect(d.turnaround.gain.calls).toEqual([])
  })

  it('a second turnaround replaces the first', () => {
    const { g, d } = rig()
    g.applyTurnaround(TIMES, 0.5)
    const later: TurnaroundTimes = { ...TIMES, at: W + 8, rows: [] }
    g.applyTurnaround(later, 0.5)
    // the first was taken back (a glide back to 1 at now)
    expect(d.turnaround.gain.calls.at(-1)).toEqual(['target', 1, 90, 0.015])
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/audio/gestures.test.ts`
Expected: FAIL, with `g.applyTurnaround is not a function`.

- [ ] **Step 3: Two nodes per row (`src/audio/rowVoice.ts`)**

(a) Header diagram. Replace

```ts
//   voice source -> voice gain --------------+-> filter -> gesture gain -> mute gain -> pan -> dry bus
//                                                                                          \-> send -> reverb
//
// filter: the row's own lowpass ("filter in"). gesture: hole and duck. mute: the row's play/mute.
```

with

```ts
//   voice source -> voice gain --------------+-> filter -> high-pass -> gesture gain -> turnaround gain -> mute gain -> pan -> dry bus
//                                                                                                                       \-> send -> reverb
//
// filter: the row's own lowpass ("filter in"; a turnaround's dip). high-pass: a turnaround's lift,
// neutral at 0 Hz (a BiquadFilterNode high-pass at exactly 0 Hz is an all-pass). gesture: hole and
// duck. turnaround: a phrase turnaround's drop, after the gesture gain so the two multiply.
// mute: the row's play/mute.
```

(b) Fields. Replace

```ts
  readonly filter: BiquadFilterNode
  readonly gesture: GainNode
```

with

```ts
  readonly filter: BiquadFilterNode
  /** A phrase turnaround's lift; neutral (0 Hz) otherwise. */
  readonly highpass: BiquadFilterNode
  readonly gesture: GainNode
  /** A phrase turnaround's drop; 1 otherwise. */
  readonly turnaround: GainNode
```

(c) Constructor. Replace

```ts
    this.gesture = new GainNode(ctx, { gain: 1 })
    this.mute = new GainNode(ctx, { gain: 1 })
    this.send = new GainNode(ctx, { gain: sendLevel })
    this.pan = new StereoPannerNode(ctx, { pan, channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers' })
    this.filter.connect(this.gesture).connect(this.mute).connect(this.pan)
```

with

```ts
    this.highpass = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 0, Q: biquadQ(0) })
    this.gesture = new GainNode(ctx, { gain: 1 })
    this.turnaround = new GainNode(ctx, { gain: 1 })
    this.mute = new GainNode(ctx, { gain: 1 })
    this.send = new GainNode(ctx, { gain: sendLevel })
    this.pan = new StereoPannerNode(ctx, { pan, channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers' })
    this.filter.connect(this.highpass).connect(this.gesture).connect(this.turnaround).connect(this.mute).connect(this.pan)
```

(d) `disconnect()`. Replace

```ts
    for (const n of [this.filter, this.gesture, this.mute, this.pan, this.send, this.delaySend]) n.disconnect()
```

with

```ts
    for (const n of [this.filter, this.highpass, this.gesture, this.turnaround, this.mute, this.pan, this.send, this.delaySend]) n.disconnect()
```

- [ ] **Step 4: Apply and cancel (`src/audio/gestures.ts`)**

(a) Header. Replace

```ts
//   riser      its own noise voice (riserVoice.ts) into the master after its level, and a send
//              into the reverb
```

with

```ts
//   riser      its own noise voice (riserVoice.ts) into the master after its level, and a send
//              into the reverb
// and a phrase turnaround (turnaround.ts), at most one on the timeline: its own gain and
// high-pass per row, the row's filter and send, and a riser.
```

(b) Imports. Replace

```ts
import type { TransitionPlan } from './transitions'
```

with

```ts
import type { TransitionPlan } from './transitions'
import type { TurnaroundTimes } from './turnaround'
```

(c) The field. Replace

```ts
  /** Every riser scheduled or sounding (tails included), until its source has ended. */
  private risers = new Set<(at: number) => void>()
```

with

```ts
  /** Every riser scheduled or sounding (tails included), until its source has ended. */
  private risers = new Set<(at: number) => void>()
  /** The phrase turnaround on the timeline, until its wrap passes: one phrase end at a time. */
  private turnaround: { times: TurnaroundTimes; stopRiser?: (at: number) => void } | null = null
```

(d) Methods. Insert directly above `  /** Fade out any riser still to come or sounding (the engine is stopping). */`:

```ts
  /** A phrase turnaround onto its rows' nodes (turnaround.ts): drops on the turnaround gain,
   * lifts on the high-pass, dips on the row filter, washes on the send (the master send waits
   * until the wrap), a riser as its own voice. Replaces one already on the timeline. A row the
   * engine does not have is skipped. */
  applyTurnaround(t: TurnaroundTimes, masterSend: number): void {
    if (this.turnaround) this.cancelTurnaround(this.turnaround.times.at, masterSend)
    const now = this.ctx.currentTime
    for (const r of t.rows) {
      const row = this.rows.get(r.rowId)
      if (!row) continue
      if (r.gain) applyTimedPoints(row.turnaround.gain, r.gain, { from: now })
      if (r.highpassHz) {
        applyTimedPoints(row.highpass.frequency, r.highpassHz, { from: now, shape: 'exponential' })
        // an exponential ramp floors at 1e-6: the rest on the one is exactly 0 Hz, the all-pass
        row.highpass.frequency.setValueAtTime(0, t.at)
      }
      if (r.lowpassHz) applyTimedPoints(row.filter.frequency, r.lowpassHz, { from: now, shape: 'exponential' })
      if (r.send) {
        applyTimedPoints(row.send.gain, r.send, { from: now })
        row.bloomUntil = Math.max(row.bloomUntil, t.at)
      }
    }
    let stopRiser: ((at: number) => void) | undefined
    if (t.riser) {
      const stop = playRiser(this.ctx, this.riserBus, this.sendBus, t.riser, now, () => this.risers.delete(stop))
      this.risers.add(stop)
      stopRiser = stop
    }
    this.turnaround = { times: t, stopRiser }
  }

  /** Take back the turnaround ending on the wrap `at` (hold, a pace change): every param it
   * touched glides back to rest from now, and its riser fades. */
  cancelTurnaround(at: number, masterSend: number): void {
    const armed = this.turnaround
    if (!armed || Math.abs(armed.times.at - at) > EPS) return
    this.turnaround = null
    const now = this.ctx.currentTime
    for (const r of armed.times.rows) {
      const row = this.rows.get(r.rowId)
      if (!row) continue
      if (r.gain) glide(row.turnaround.gain, 1, now)
      if (r.highpassHz) {
        glide(row.highpass.frequency, 0, now)
        // a glide only approaches 0: land on it, the all-pass
        row.highpass.frequency.setValueAtTime(0, now + 0.1)
      }
      if (r.lowpassHz) glide(row.filter.frequency, filterFrequency('lowpass', 1, this.ctx.sampleRate), now)
      if (r.send) {
        glide(row.send.gain, masterSend, now)
        row.bloomUntil = Number.NEGATIVE_INFINITY
      }
    }
    if (armed.stopRiser && armed.times.riser) armed.stopRiser(Math.max(now, armed.times.riser.start))
  }

  /** The engine stopped: forget the turnaround (its rows are going). */
  dropTurnaround(): void {
    this.turnaround = null
  }
```

(e) `prune`. Replace

```ts
    for (const r of this.rows.values()) if (r.armed && r.armed.at < now) r.armed = null
  }
```

with

```ts
    for (const r of this.rows.values()) if (r.armed && r.armed.at < now) r.armed = null
    if (this.turnaround && this.turnaround.times.at < now) this.turnaround = null
  }
```

- [ ] **Step 5: Run the unit test**

Run: `npx vitest run src/audio/gestures.test.ts`
Expected: PASS.

- [ ] **Step 6: The engine (`src/audio/engine.ts`)**

(a) Imports. Replace

```ts
import { planTransition, type TransitionPlan, type TransitionSpec } from './transitions'
```

with

```ts
import { planTransition, type TransitionPlan, type TransitionSpec } from './transitions'
import { planTurnaroundTimes } from './turnaround'
import type { TurnaroundPlan } from '@shared/radioTurnaround'
```

(b) Methods. Insert directly above `  /** Place a row in the stereo field, -1 (left) .. 1 (right), with a short glide from `atTime``:

```ts
  /** A phrase turnaround (@shared/radioTurnaround's plan, in beats before the wrap) ending on
   * the loop top `atTime`, measured on the clock in force during the lap before it. It goes on
   * the rows' own turnaround nodes (Gestures.applyTurnaround), so it never touches a swap, and
   * replaces a turnaround already on the timeline. Its first move must be at least
   * MIN_LEAD_SEC ahead: too late is a RangeError, and nothing changed. */
  applyTurnaround(plan: TurnaroundPlan, atTime: number): void {
    if (!this.tl.clocks.length) throw new RangeError('nothing is playing')
    const times = planTurnaroundTimes(plan, atTime, this.tl.clockBefore(atTime), this.masterSend, this.ctx.sampleRate, this.random)
    if (times.start < this.now + MIN_LEAD_SEC) {
      throw new RangeError(`the turnaround into ${atTime.toFixed(3)} starts at ${times.start.toFixed(3)}: too late`)
    }
    this.gestures.applyTurnaround(times, this.masterSend)
  }

  /** Take back the turnaround ending on `atTime`, if it is still on the timeline. */
  cancelTurnaround(atTime: number): void {
    this.gestures.cancelTurnaround(atTime, this.masterSend)
  }
```

(c) `stop()`. Replace

```ts
    this.gestures.stopRisers(this.now)
    for (const r of this.voices.values()) {
```

with

```ts
    this.gestures.stopRisers(this.now)
    this.gestures.dropTurnaround()
    for (const r of this.voices.values()) {
```

- [ ] **Step 7: An offline-render check (`spike/engine-check/check.ts`)**

(a) Imports. Below `import { stretchRatioForStem } from '@shared/stretchRatio'`, add:

```ts
import { turnaroundDropCurve, turnaroundLiftCurve, type TurnaroundPlan } from '@shared/radioTurnaround'
```

(b) Add this check directly above `async function nonDividingAndPhase() {`:

```ts
async function turnaround() {
  // rows d and l, DC 0.25 each, 4 bars. Into the second wrap W: a 4-beat low drop on d (gone for
  // the lap's last bar, back on the one), or a 1-bar lift on l (a high-pass, so its DC is gone,
  // back on the one), or the drop taken back before it starts. Bypass: the row sum, DRY_DELAY late.
  const W = START + 16
  const drop: TurnaroundPlan = { move: 'low drop', beats: 4, halvings: 0, rows: [{ rowId: 'd', volume: turnaroundDropCurve(4, 4) }] }
  const lift: TurnaroundPlan = { move: 'lift', beats: 4, halvings: 0, rows: [{ rowId: 'l', filter: turnaroundLiftCurve(4) }] }
  const run = (setup: (e: Engine) => void, later: [number, (e: Engine) => void][] = []) =>
    render(
      19,
      (ctx, e) => {
        e.setRow('d', row(dc(ctx, 4, 0.25), 4))
        e.setRow('l', row(dc(ctx, 4, 0.25), 4))
        e.pump(1)
        setup(e)
      },
      { bypass: true, at: later }
    )
  const x = await run((e) => e.applyTurnaround(drop, W))
  const y = await run((e) => e.applyTurnaround(lift, W))
  const z = await run((e) => e.applyTurnaround(drop, W), [[W - 4, (e) => e.cancelTurnaround(W)]])
  let tooLate = false
  {
    const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: SR, sampleRate: SR })
    const e = new Engine({ context: ctx, autoPump: false, bpm: BPM, faust: false })
    e.setRow('d', row(dc(ctx, 4, 0.25), 4))
    try {
      e.applyTurnaround(drop, 1) // its drop would start a second ago
    } catch (err) {
      tooLate = err instanceof RangeError
    }
    e.dispose()
  }
  const r = {
    dropBefore: r6(at(x, W - 3)), // 1.5 bars out: both rows in
    dropIn: r6(at(x, W - 1)), // the last bar: d gone
    dropAfter: r6(at(x, W + 1)), // both back on the one
    liftBefore: r6(at(y, W - 3)),
    liftIn: r6(at(y, W - 0.5)), // l's DC through the high-pass: gone
    liftAfter: r6(at(y, W + 1)),
    cancelledIn: r6(at(z, W - 1)),
    tooLate
  }
  out.turnaround = {
    ...r,
    pass:
      Math.abs(r.dropBefore - 0.5) < 1e-4 &&
      Math.abs(r.dropIn - 0.25) < 1e-4 &&
      Math.abs(r.dropAfter - 0.5) < 1e-4 &&
      Math.abs(r.liftBefore - 0.5) < 1e-4 &&
      Math.abs(r.liftIn - 0.25) < 1e-3 &&
      Math.abs(r.liftAfter - 0.5) < 1e-4 &&
      Math.abs(r.cancelledIn - 0.5) < 1e-4 &&
      r.tooLate
  }
}
```

(c) In the `all` map near the end of the file, add `turnaround,` after `removeExit,`.

- [ ] **Step 8: Verify**

```bash
cd /Users/nickel/Claudecode/ell.ing/radio
npm run typecheck && npm test
node spike/engine-check/run.mjs turnaround,removeExit,transitions,swapOnset
```
Expected: typecheck and tests green. The engine check prints JSON with `"turnaround": { ..., "pass": true }`, and the three existing checks still `"pass": true`. The process exits 0. If Chrome is not at `/Applications/Google Chrome.app`, set `CHROME=<path>`. If it cannot run at all, say so in the report rather than skipping silently.

- [ ] **Step 9: Commit**

```bash
cd /Users/nickel/Claudecode/ell.ing/radio
git add src/audio/rowVoice.ts src/audio/gestures.ts src/audio/gestures.test.ts src/audio/engine.ts spike/engine-check/check.ts
git commit -m "radio: each row gets a turnaround gain and a neutral high-pass; Engine.applyTurnaround/cancelTurnaround, checked by offline render

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 10: The web radio rolls turnarounds; the drop-out goes (ell.ing/radio)

`step.ts` rolls at the start of a phrase's last lap and emits `{ type: 'turnaround', time: wrapTime, plan }`. This replaces `rollDropOut` and the `dropOut` action. `controller.ts` carries it out, including the failure path. Step and controller change together, because removing the `dropOut` action from `RadioAction` breaks the controller's `case 'dropOut'`.

**Files:**
- Modify: `src/radio/step.ts`, `src/radio/controller.ts`
- Test: `src/radio/step.test.ts`, `src/radio/controller.test.ts`, `src/radio/settings.test.ts`, `src/radio/density.test.ts`, `src/radio/indexPicker.test.ts`

- [ ] **Step 1: Write the failing step tests**

In `src/radio/step.test.ts`:

(a) In `RULES`, replace `  dropOuts: 'off',` with `  turnarounds: 'off',`.

(b) Delete these three tests whole:
- the `describe('drop-outs', ...)` block (the due-branch drop-out and "never when the interval is one lap");
- the `describe('drop-outs once per interval (sssketch 06aa430, 046cfa1)', ...)` block;
- the test `it('a drop-out pending on the row is replaced by the swap', ...)` inside the swap-now describe.

(c) Append:

```ts
describe('turnarounds', () => {
  /** Ticks from 0 to `to` at ~30 Hz, noting each turnaround and the tick that emitted it. */
  function runNoting(sim: Sim, to: number): { at: number; emittedAt: number; move: string; beats: number }[] {
    const out: { at: number; emittedAt: number; move: string; beats: number }[] = []
    const n = Math.floor(to * 30)
    for (let i = 0; i <= n; i++) {
      const now = i / 30
      const before = sim.log.length
      sim.tick(now)
      for (const a of sim.log.slice(before)) {
        if (a.type === 'turnaround') out.push({ at: a.time, emittedAt: now, move: a.plan.move, beats: a.plan.beats })
      }
    }
    return out
  }

  it("rolls at the start of a phrase's last lap and ends on the phrase's wrap", () => {
    let seen = 0
    for (let seed = 1; seed <= 10; seed++) {
      const sim = new Sim({ turnarounds: 'often' }, seeded(seed))
      sim.send({ type: 'play' })
      for (const t of runNoting(sim, 40 * LAP)) {
        seen++
        expect(t.at % (4 * LAP)).toBe(0) // 16 bars (phraseBars 0 counts 16) = 4 laps of a 4-bar loop
        expect(t.emittedAt).toBeGreaterThanOrEqual(t.at - LAP)
        expect(t.emittedAt).toBeLessThan(t.at - LAP + 0.1)
      }
    }
    expect(seen).toBeGreaterThan(20)
  })

  it('never a drop-out, and nothing at all when off', () => {
    const sim = new Sim({ turnarounds: 'off' }, seeded(1))
    sim.send({ type: 'play' })
    sim.run(0, 40 * LAP)
    expect(sim.of('turnaround')).toHaveLength(0)
    expect(sim.log.some((a) => (a.type as string) === 'dropOut')).toBe(false)
  })

  it('often fires far more than rare; a phrase end right after one only repeats it, shorter', () => {
    const all = (turnarounds: 'rare' | 'often') => {
      const runs: { at: number; move: string; beats: number }[][] = []
      for (let seed = 1; seed <= 10; seed++) {
        const sim = new Sim({ turnarounds }, seeded(seed))
        sim.send({ type: 'play' })
        sim.run(0, 80 * LAP)
        runs.push(sim.of('turnaround').map((a) => ({ at: a.time, move: a.plan.move, beats: a.plan.beats })))
      }
      return runs
    }
    const often = all('often')
    const rare = all('rare')
    const count = (runs: unknown[][]) => runs.reduce((n, r) => n + r.length, 0)
    // about 0.49 vs 0.28 a phrase end once never-twice and diminution are in (often vs rare)
    expect(count(often)).toBeGreaterThan(1.3 * count(rare))
    expect(count(rare)).toBeGreaterThan(0)
    for (const run of [...often, ...rare]) {
      for (let i = 1; i < run.length; i++) {
        if (run[i].at - run[i - 1].at !== 4 * LAP) continue
        // back to back: a diminution -- the same move, half as long
        expect(['drum drop', 'low drop', 'lift']).toContain(run[i - 1].move)
        expect(run[i].move).toBe(run[i - 1].move)
        expect(run[i].beats).toBe(run[i - 1].beats / 2)
      }
    }
  })

  it("a change landing on a turnaround's wrap keeps only an arrival", () => {
    let shared = 0
    for (let seed = 1; seed <= 10; seed++) {
      const sim = new Sim({ turnarounds: 'often', transitions: 'bold', phraseBars: 16 }, seeded(seed))
      sim.send({ type: 'play' })
      sim.run(0, 60 * LAP)
      const ends = new Set(sim.of('turnaround').map((a) => a.time))
      for (const a of sim.of('landAt')) {
        if (!ends.has(a.time)) continue
        shared++
        for (const ch of a.changes) expect(['hole', 'riser']).not.toContain(ch.transition.kind)
      }
    }
    expect(shared).toBeGreaterThan(0)
  })

  it('hold takes back a turnaround still to come, and a failed one is forgotten', () => {
    let done = false
    for (let seed = 1; seed < 50 && !done; seed++) {
      const sim = new Sim({ turnarounds: 'often' }, seeded(seed))
      sim.send({ type: 'play' })
      const first = runNoting(sim, 4 * LAP - 0.5)[0]
      if (!first) continue
      done = true
      expect(sim.s.turnaround?.at).toBe(first.at)
      sim.send({ type: 'turnaroundFailed', at: first.at + 8 }) // not this one: kept
      expect(sim.s.turnaround?.at).toBe(first.at)
      sim.send({ type: 'hold', on: true })
      expect(sim.of('cancelTurnaround').at(-1)).toEqual({ type: 'cancelTurnaround', time: first.at })
      expect(sim.s.turnaround).toBeNull()
      expect(sim.s.lastTurnaround).toBeNull()
    }
    expect(done).toBe(true)
  })

  it('a refused turnaround is forgotten, and the next phrase end is not "after a turnaround"', () => {
    let done = false
    for (let seed = 1; seed < 50 && !done; seed++) {
      const sim = new Sim({ turnarounds: 'often' }, seeded(seed))
      sim.send({ type: 'play' })
      const first = runNoting(sim, 4 * LAP - 0.5)[0]
      if (!first) continue
      done = true
      sim.send({ type: 'turnaroundFailed', at: first.at })
      expect(sim.s.turnaround).toBeNull()
      expect(sim.s.lastTurnaround).toBeNull()
    }
    expect(done).toBe(true)
  })
})
```

The first turnaround's lap starts at the third wrap (24 s) and ends on the fourth (32 s), so running to `4 * LAP - 0.5` sees it emitted and not yet passed.

- [ ] **Step 2: Update the other web tests that named drop-outs**

- `src/radio/settings.test.ts`:
  - replace every `dropOuts: 'off'` inside a `sim({ ... })` call with `turnarounds: 'off'`. There are four, in `'phrase 16 (and loop end always)...'` and `'transitions bold...'`;
  - replace the whole test `it('drop-outs often: rolled far more than at rare, and never when off', ...)` with:

  ```ts
  it('turnarounds often: rolled far more than at rare, and never when off', () => {
    const count = (turnarounds: RadioSettings['turnarounds']) => {
      let n = 0
      for (let seed = 1; seed <= 10; seed++) {
        const r = sim({ turnarounds }, seed)
        r.run(200 * LAP)
        n += r.of('turnaround').length
      }
      return n
    }
    const often = count('often')
    const rare = count('rare')
    // about 0.49 vs 0.28 a phrase end once never-twice and diminution are in
    expect(often).toBeGreaterThan(1.3 * rare)
    expect(rare).toBeGreaterThan(0)
    expect(count('off')).toBe(0)
  })
  ```
- `src/radio/density.test.ts`: in the "on a wrap nothing else of radio's uses" set, replace

  ```ts
        ...r.of('swapAt').map((a) => a.time),
        ...r.of('dropOut').map((a) => a.time)
      ])
  ```

  with

  ```ts
        ...r.of('swapAt').map((a) => a.time)
      ])
  ```

  A turnaround may share an arc step's wrap: that is how a thinning wash reaches the leaving row.
- `src/radio/indexPicker.test.ts`: replace `        dropOuts: 'off',` with `        turnarounds: 'off',`.
- `src/radio/controller.test.ts`:
  - in `RULES`, replace `  dropOuts: 'off',` with `  turnarounds: 'off',`;
  - in `'thousands of laps with failing loads and stretches and tempo nudges...'`, replace `settings: { dropOuts: 'rare', transitions: 'subtle' }` with `settings: { turnarounds: 'rare', transitions: 'subtle' }`.

- [ ] **Step 3: Write the failing controller tests**

In `src/radio/controller.test.ts`:

(a) Imports. Add `import type { TurnaroundPlan } from '@shared/radioTurnaround'` below `import { radioGestureLeadsChange, type RadioTransitionKind } from '@shared/radioTransition'`.

(b) The `Call` union. Add two members before `  | { op: 'stop' }`:

```ts
  | { op: 'turnaround'; plan: TurnaroundPlan; at: number; now: number }
  | { op: 'cancelTurnaround'; at: number }
```

(c) `FakeEngine`. Add these members directly above `  stop(): void {`:

```ts
  /** Refuse a turnaround it matches (a lead-in already under way, say). */
  refuseTurnaround: ((at: number) => Error | null) | null = null
  applyTurnaround(plan: TurnaroundPlan, at: number): void {
    const err = this.refuseTurnaround?.(at)
    if (err) throw err
    if (!this.isWrap(at) || at < this.now + 0.05 - EPS) throw new RangeError(`not a loop top ahead: ${at}`)
    this.calls.push({ op: 'turnaround', plan, at, now: this.now })
  }
  cancelTurnaround(at: number): void {
    this.calls.push({ op: 'cancelTurnaround', at })
  }
  turnarounds() {
    return this.calls.filter((c): c is Extract<Call, { op: 'turnaround' }> => c.op === 'turnaround')
  }
```

(d) Append:

```ts
describe('turnarounds', () => {
  it("reaches the engine a lap ahead of the phrase's wrap, on a loop top", async () => {
    const r = rig({ seed: 3, settings: { turnarounds: 'often', phraseBars: 16 } })
    await started(r)
    await r.run(r.eng.lap() * 40)
    const ts = r.eng.turnarounds()
    expect(ts.length).toBeGreaterThan(0)
    for (const t of ts) {
      expect(r.eng.isWrap(t.at)).toBe(true)
      expect(t.at - t.now).toBeGreaterThan(r.eng.lap() - 0.1)
      expect(t.at - t.now).toBeLessThanOrEqual(r.eng.lap() + 1e-6)
    }
  })

  it('a refused turnaround is logged and forgotten; radio carries on', async () => {
    const r = rig({ seed: 3, settings: { turnarounds: 'often', phraseBars: 16 } })
    r.eng.refuseTurnaround = () => new RangeError('too late')
    await started(r)
    await r.run(r.eng.lap() * 40)
    expect(r.logs.some((m) => m.startsWith('radio: turnaround into'))).toBe(true)
    expect(r.ctl.state.turnaround).toBeNull()
    expect(r.ctl.view().phase).toBe('running')
  })

  it('hold takes a turnaround still to come back on the engine', async () => {
    const r = rig({ seed: 3, settings: { turnarounds: 'often', phraseBars: 16 } })
    await started(r)
    let t: Extract<Call, { op: 'turnaround' }> | undefined
    for (let i = 0; i < 160 && !t; i++) {
      await r.run(r.eng.lap() / 4)
      t = r.eng.turnarounds()[0]
    }
    expect(t).toBeDefined()
    r.ctl.hold(true)
    expect(r.eng.calls.some((c) => c.op === 'cancelTurnaround' && c.at === t!.at)).toBe(true)
  })
})
```

- [ ] **Step 4: Run them to make sure they fail**

Run: `cd /Users/nickel/Claudecode/ell.ing/radio && npx vitest run src/radio/step.test.ts src/radio/controller.test.ts`
Expected: FAIL. No `turnaround` actions are emitted, and `sim.s.turnaround` is `undefined`. (`npm run typecheck` fails as well until Step 6.)

- [ ] **Step 5: Implement it in `src/radio/step.ts`**

(a) Header comment. Replace

```ts
//               already held, else draw and hold the pending pick; with nothing to change, roll the
//               interval's drop-out and arm
//   drop-outs   rollIntervalDropOut, once per interval, wherever one starts: a change landing
//               (early or not) and the due branch that lands nothing (sssketch 06aa430, 046cfa1)
```

with

```ts
//               already held, else draw and hold the pending pick; with nothing to change, arm
//   turnaround  @shared/radioTurnaround rollTurnaround, once, at the start of a phrase's last lap
//               (advanceRadioClock's turnaroundLapStarts), ending on the phrase's wrap; a change
//               scheduled on that wrap keeps only its arrival (radioTransitionUnderTurnaround)
```

and replace

```ts
// - A drop-out is the engine's `hole` on a row swapped to its own stem: "a hole IS the drop-out,
//   attached to a change" (transitions.ts).
```

with

```ts
// - A turnaround is the engine's own per-row automation (Engine.applyTurnaround), never a swap:
//   it does not hold up a change, an arc step or a tempo change on its wrap.
```

(b) Imports. Replace

```ts
import { pickDropOutBeats, rollIntervalDropOut } from '@shared/radioDropOut'
```

with

```ts
import { pickDropOutBeats } from '@shared/radioDropOut'
import {
  radioTransitionUnderTurnaround,
  rememberTurnaround,
  rollTurnaround,
  turnaroundArc,
  type TurnaroundMemory,
  type TurnaroundPlan
} from '@shared/radioTurnaround'
```

(c) `RadioGesture`. Replace

```ts
  kind: RadioTransitionKind | 'drop-out'
  slot: string
  beats: number
  lapsLeft: number
  /** The wrap it is attached to, when it is on the engine's timeline (a drop-out, a lead-in). */
```

with

```ts
  kind: RadioTransitionKind
  slot: string
  beats: number
  lapsLeft: number
  /** The wrap it is attached to, when it is on the engine's timeline (a lead-in). */
```

(d) `RadioState`. Replace

```ts
  /** Swap-now requests by row, at most one each. */
  manual: Record<string, RadioManual>
}
```

with

```ts
  /** Swap-now requests by row, at most one each. */
  manual: Record<string, RadioManual>
  /** The phrase turnaround on the engine's timeline, ending on the wrap `at`; cleared once that
   * wrap has passed, or when it is taken back or refused. */
  turnaround: { at: number; plan: TurnaroundPlan } | null
  /** What the last phrase end fired (rememberTurnaround): never twice in a row, except
   * diminution. Null when nothing fired there. */
  lastTurnaround: TurnaroundMemory | null
}
```

(e) `RadioEvent`. Replace `  | { type: 'dropOutFailed'; slot: string; at: number }` with `  | { type: 'turnaroundFailed'; at: number }`.

(f) `RadioAction`. In its doc comment, replace `the first setRow of the bed (start), a drop-out, taking a scheduled swap back` with `the first setRow of the bed (start), a phrase turnaround, taking a scheduled swap back`. Then replace

```ts
  | { type: 'dropOut'; slot: string; time: number; beats: number; record: IndexRecord; bpm: number }
```

with

```ts
  /** A phrase turnaround (@shared/radioTurnaround's plan, in beats before the wrap) ending on
   * the loop top `time`. */
  | { type: 'turnaround'; time: number; plan: TurnaroundPlan }
  /** Take back the turnaround ending on `time` (hold, a pace change). */
  | { type: 'cancelTurnaround'; time: number }
```

(g) `initialRadioState`. Replace

```ts
    lastTick: null,
    manual: {}
  }
}
```

with

```ts
    lastTick: null,
    manual: {},
    turnaround: null,
    lastTurnaround: null
  }
}
```

(h) `reduce`, the `hold` case. Replace

```ts
      // a drop-out still to come is taken back too: radio does nothing while held
      if (event.on) cancelDropOuts(c)
```

with

```ts
      // a turnaround still to come is taken back too: radio does nothing while held
      if (event.on) cancelTurnaround(c)
```

(i) `reduce`, the failure event. Replace

```ts
    case 'dropOutFailed':
      s.gestures = s.gestures.filter((g) => !(g.kind === 'drop-out' && g.slot === event.slot && g.at === event.at))
      break
```

with

```ts
    case 'turnaroundFailed':
      // the engine refused it: it never plays, so the next phrase end is not "after a turnaround"
      if (s.turnaround && Math.abs(s.turnaround.at - event.at) <= EPS) {
        s.turnaround = null
        s.lastTurnaround = null
      }
      break
```

(j) `reduce`, `swapScheduled`. Replace

```ts
    case 'swapScheduled': {
      const m = s.manual[event.slot]
      if (!m || m.at !== event.at) break
      // anything else the row had from then on (a drop-out) the engine replaced
      s.gestures = s.gestures.filter((g) => !(g.slot === event.slot && g.kind === 'drop-out'))
      break
    }
```

with

```ts
    case 'swapScheduled':
      break
```

(k) `tick`. Replace

```ts
    if (s.tempoTarget === s.bpm) s.tempoTarget = null
  }

  const before = s.clock
```

with

```ts
    if (s.tempoTarget === s.bpm) s.tempoTarget = null
  }
  // a turnaround is over once its wrap has passed
  if (s.turnaround && now >= s.turnaround.at - EPS) s.turnaround = null

  const before = s.clock
```

Then replace

```ts
  if (led && led.at !== null && now >= led.at - EPS) {
    land(c, led, pos, nextWrap)
    return
  }
```

with

```ts
  if (led && led.at !== null && now >= led.at - EPS) {
    land(c, led, pos)
    // the lap starting here may be a phrase's last: its turnaround, after the landing (whose
    // arrival gesture is then on the list the roll reads)
    if (adv.turnaroundLapStarts) rollTurnaroundAt(c, t)
    return
  }
```

Then replace

```ts
  if (adv.wrapped && s.gestures.length > 0) {
    s.gestures = s.gestures.filter((g) => g.lapsLeft > 1).map((g) => ({ ...g, lapsLeft: g.lapsLeft - 1 }))
  }
```

with

```ts
  if (adv.wrapped && s.gestures.length > 0) {
    s.gestures = s.gestures.filter((g) => g.lapsLeft > 1).map((g) => ({ ...g, lapsLeft: g.lapsLeft - 1 }))
  }
  // THE PHRASE TURNAROUND: rolled at the start of a phrase's last lap, before anything can
  // decide a change for its wrap (the early decision and the due branch, below)
  if (adv.turnaroundLapStarts) rollTurnaroundAt(c, t)
```

Then replace

```ts
  // nothing to change: roll the interval's drop-out, and arm (DP:3698-3730)
  rollDropOut(c, p?.slot ?? null, pos, loopBars, nextWrap)
  arm(c)
}
```

with

```ts
  // nothing to change: arm (DP:3698-3730)
  arm(c)
}
```

(l) `land`. Replace

```ts
/** A held change lands: commitSlotPick's bookkeeping, the clock for an early one (counted from
 * the wrap), its arrival gesture, the interval's drop-out roll, the next pick. */
function land(c: Ctx, led: RadioLed, pos: number, nextWrap: number | null): void {
```

with

```ts
/** A held change lands: commitSlotPick's bookkeeping, the clock for an early one (counted from
 * the wrap), its arrival gesture, the next pick. */
function land(c: Ctx, led: RadioLed, pos: number): void {
```

and replace

```ts
  // the interval starts here, early decision or not: its one drop-out roll, after the arrival
  // gesture (which keeps its lap), against the loop this landing makes -- the longest stem with
  // the incoming one in place (DP loopBarsAfterLanding; the rows hold it since the commit)
  const loopAfter = Math.max(0, ...s.rows.filter((r) => r.record).map((r) => r.record!.bars))
  rollDropOut(c, led.slot, pos, loopAfter, nextWrap)
  arm(c)
}
```

with

```ts
  arm(c)
}
```

(m) `scheduleLed`. Replace

```ts
  led.at = nextWrap
  c.out.push({
    type: 'landAt',
```

with

```ts
  led.at = nextWrap
  // a turnaround ending on this wrap is the change's lead-in: the change keeps only an arrival
  led.kind = underTurnaround(s, nextWrap, led.kind)
  c.out.push({
    type: 'landAt',
```

(n) Replace the whole `rollDropOut` function and its doc comment (from `/** The interval's one drop-out roll, @shared/radioDropOut's rollIntervalDropOut (DP` through that function's closing `}`) with:

```ts
/** The phrase end's turnaround (@shared/radioTurnaround rollTurnaround), rolled on the wrap
 * that starts a phrase's last lap and ending on the wrap that closes it -- `t.nextWrap`, when it
 * is that wrap (a wrap too close to schedule on is skipped by nextLoopTop). Not while held:
 * radio does nothing then. A change's lead-in already scheduled for that wrap keeps it (no roll;
 * the next phrase end is then not "after a turnaround"). The arc's leaving row at that wrap is the
 * wash's target, and its direction weights the move. */
function rollTurnaroundAt(c: Ctx, t: RadioTickInfo): void {
  const { s } = c
  const at = t.nextWrap
  const toWrapSec = ((t.loopBars - t.pos) * 240) / s.bpm
  const leadIn = (w: number) =>
    s.gestures.some((g) => radioGestureLeadsChange(g.kind) && g.at !== undefined && Math.abs(g.at - w) <= EPS)
  if (s.held || !s.clock || at === null || at - t.now > toWrapSec + 1e-3 || leadIn(at)) {
    s.lastTurnaround = null
    return
  }
  const leaving = s.removing && s.removing.at !== null && Math.abs(s.removing.at - at) <= EPS ? s.removing.slot : null
  const plan = rollTurnaround({
    rate: s.settings.turnarounds,
    random: c.rnd,
    loopBars: t.loopBars,
    lastPhrase: s.lastTurnaround,
    rows: s.rows
      .filter((r) => r.record)
      .map((r) => ({
        id: r.id,
        kinds: r.kinds,
        hooked: s.flags[r.id] === 'hook',
        audible: heard(s, r),
        inFilterIn: s.gestures.some((g) => g.slot === r.id && g.kind === 'filter in'),
        barLength: r.record!.bars
      })),
    arc: s.settings.densityArc?.on ? turnaroundArc(s.density, s.rows.length) : 'steady',
    leavingRowId: leaving
  })
  s.lastTurnaround = rememberTurnaround(plan)
  if (!plan) return
  s.turnaround = { at, plan }
  c.out.push({ type: 'turnaround', time: at, plan })
}

/** A change's transition when it lands on the wrap `wrap`: under a turnaround ending there, only
 * its arrival (radioTransitionUnderTurnaround). */
function underTurnaround(s: RadioState, wrap: number, kind: RadioTransitionKind): RadioTransitionKind {
  return s.turnaround && Math.abs(s.turnaround.at - wrap) <= EPS ? radioTransitionUnderTurnaround(kind) : kind
}
```

(o) `startRemove`. Replace

```ts
/** Which row leaves: the stalest that is not held longer (hook), soloed, changing (radio's
 * decided change, a swap-now) or dropping out. The bed always keeps its drums and its bass (so
```

with

```ts
/** Which row leaves: the stalest that is not held longer (hook), soloed or changing (radio's
 * decided change, a swap-now). The bed always keeps its drums and its bass (so
```

and delete the line

```ts
      !s.gestures.some((g) => g.slot === r.id && g.kind === 'drop-out') &&
```

(p) `wrapTaken`. Replace

```ts
/** Is anything else landing on the wrap at `t` (radio's change, a swap-now there, a drop-out, a
 * tempo change)? An arc step never shares a wrap with one. */
```

with

```ts
/** Is anything else landing on the wrap at `t` (radio's change, a swap-now there, a tempo
 * change)? An arc step never shares a wrap with one. A turnaround may: it is only automation, and
 * the arc's leaving row is what a thinning wash targets. */
```

and replace

```ts
    Object.values(s.manual).some((m) => at(m.at)) ||
    s.gestures.some((g) => g.kind === 'drop-out' && at(g.at))
  )
```

with

```ts
    Object.values(s.manual).some((m) => at(m.at))
  )
```

(q) `pace`. Replace

```ts
/** armRadioCourseChange (DP:5733) without its seek (the engine has none): a new clock on the
 * new window, the pending pick and any held change and drop-out dropped, a fresh pick. */
```

with

```ts
/** armRadioCourseChange (DP:5733) without its seek (the engine has none): a new clock on the
 * new window (a new phrase), the pending pick and any held change and turnaround dropped, a
 * fresh pick. */
```

and inside it replace `  cancelDropOuts(c)` with `  cancelTurnaround(c)`.

(r) Replace the whole `cancelDropOuts` function and its doc comment with:

```ts
/** Take back the turnaround still to come (hold, a pace change). It never plays, so the next
 * phrase end is not "after a turnaround" either. */
function cancelTurnaround(c: Ctx): void {
  const { s } = c
  const now = s.lastTick?.now ?? Number.NEGATIVE_INFINITY
  if (s.turnaround && s.turnaround.at > now) c.out.push({ type: 'cancelTurnaround', time: s.turnaround.at })
  s.turnaround = null
  s.lastTurnaround = null
}
```

(s) `maybeApplyTempo`. Replace

```ts
 * Not while a change is on the engine's timeline (retempoAll would drop it), nor over a drop-out
 * still to play. */
```

with

```ts
 * Not while a change is on the engine's timeline (retempoAll would drop it). A turnaround does
 * not hold it: its points all lie before the wrap, on the clock in force then. */
```

and delete the line

```ts
  if (s.gestures.some((g) => g.kind === 'drop-out' && g.at !== undefined && g.at >= nextWrap - EPS)) return
```

(t) `unscheduled`. Delete its last line:

```ts
  if (ok) s.gestures = s.gestures.filter((g) => !(g.kind === 'drop-out' && g.slot === slot && g.at === at))
```

(u) `stop`. Replace

```ts
  s.lastTick = null
}
```

(the end of `stop`) with

```ts
  s.lastTick = null
  s.turnaround = null
  s.lastTurnaround = null
}
```

(v) `draft`. Replace

```ts
    removing: s.removing && { ...s.removing }
  }
}
```

with

```ts
    removing: s.removing && { ...s.removing },
    turnaround: s.turnaround && { ...s.turnaround },
    lastTurnaround: s.lastTurnaround && { ...s.lastTurnaround }
  }
}
```

Then run `grep -n "drop-out\|dropOut\|DropOut" src/radio/step.ts`. Expected: only `pickDropOutBeats` (two or three hits) and the `'drop-out curve'` wording in `RadioAction`'s `removeRow` doc. That wording is about the exit curve and stays.

- [ ] **Step 6: Implement it in `src/radio/controller.ts`**

(a) Imports. Below `import type { RadioPace } from '@shared/radioSchedule'`, add:

```ts
import type { TurnaroundPlan } from '@shared/radioTurnaround'
```

(b) `RadioEngine`. Replace

```ts
  throwDelay(rowId: string, at: number, beats: number, timing: ThrowTiming, feedback: number): void
  stop(): void
}
```

with

```ts
  throwDelay(rowId: string, at: number, beats: number, timing: ThrowTiming, feedback: number): void
  applyTurnaround(plan: TurnaroundPlan, atTime: number): void
  cancelTurnaround(atTime: number): void
  stop(): void
}
```

(c) `throwTick`. Replace

```ts
      leadingArmed: s.gestures.some((g) => g.kind === 'hole' || g.kind === 'riser' || g.kind === 'drop-out'),
```

with

```ts
      // a hole, a riser or a phrase turnaround has the lap
      leadingArmed: s.gestures.some((g) => g.kind === 'hole' || g.kind === 'riser') || s.turnaround !== null,
```

(d) `run`. Replace the whole `case 'dropOut':` block

```ts
      case 'dropOut':
        try {
          // the row swapped to its own playing stem, with a hole: a drop-out and nothing else
          e.scheduleSwap(a.slot, this.stem(a.record, a.bpm), a.time, { kind: 'hole', beats: a.beats })
        } catch (err) {
          this.log(`radio: drop-out on ${a.slot} refused`, err)
          this.events.push({ type: 'dropOutFailed', slot: a.slot, at: a.time })
        }
        return
```

with

```ts
      case 'turnaround':
        try {
          e.applyTurnaround(a.plan, a.time)
        } catch (err) {
          this.log(`radio: turnaround into ${a.time.toFixed(3)} refused (${a.plan.move})`, err)
          this.events.push({ type: 'turnaroundFailed', at: a.time })
        }
        return
      case 'cancelTurnaround':
        try {
          e.cancelTurnaround(a.time)
        } catch (err) {
          this.log(`radio: could not take back the turnaround into ${a.time.toFixed(3)}`, err)
        }
        return
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run src/radio`
Expected: PASS, the new turnaround tests included.

- [ ] **Step 8: Typecheck and the whole suite**

```bash
cd /Users/nickel/Claudecode/ell.ing/radio && npm run typecheck && npm test && npm run build
```
Expected: green. `main.ts` passes the real `Engine`, which has `applyTurnaround` and `cancelTurnaround` since Task 9.

- [ ] **Step 9: Commit**

```bash
cd /Users/nickel/Claudecode/ell.ing/radio
git add src/radio/step.ts src/radio/controller.ts src/radio/step.test.ts src/radio/controller.test.ts src/radio/settings.test.ts src/radio/density.test.ts src/radio/indexPicker.test.ts
git commit -m "radio: turnarounds at phrase ends replace the per-interval drop-out; a change on the turnaround's wrap keeps only its arrival; hold and pace take it back

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 11: Controls in the planner: `moves` and `depth` (sssketch)

The planner takes two optional inputs:
- `moves`, the families switched on (`drops`, `wash`, `filters`, `riser`); all when absent, and none behaves as off;
- `depth`, `bold` by default. `subtle` lifts to 0.35, dips to 0.6, washes to 0.6, and caps every move at 1 bar.

Absent inputs give exactly Task 4's behaviour, so no caller has to change.

**Files:**
- Modify: `src/shared/radioTurnaround.ts`
- Test: `src/shared/radioTurnaroundControls.test.ts` (create)

- [ ] **Step 1: Write the failing test**

`src/shared/radioTurnaroundControls.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { DiscoverSlotKind } from './discoverSlotKind'
import {
  DEFAULT_TURNAROUND_DEPTH,
  TURNAROUND_DEPTH,
  TURNAROUND_DEPTH_OPTIONS,
  TURNAROUND_FAMILIES,
  TURNAROUND_FAMILY_OF,
  TURNAROUND_MOVES,
  normalizeTurnaroundDepth,
  normalizeTurnaroundMoves,
  rollTurnaround,
  toggleTurnaroundFamily,
  turnaroundDipCurve,
  turnaroundDraw,
  turnaroundLiftCurve,
  turnaroundWashCurve,
  type TurnaroundInput,
  type TurnaroundRow
} from './radioTurnaround'

function seq(values: number[]): () => number {
  let i = 0
  return (): number => {
    if (i >= values.length) throw new Error(`drew ${i + 1} times, only ${values.length} scripted`)
    return values[i++]
  }
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return (): number => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function row(id: string, kinds: DiscoverSlotKind[]): TurnaroundRow {
  return { id, kinds, hooked: false, audible: true, inFilterIn: false, barLength: 4 }
}

const BED: TurnaroundRow[] = [
  row('d', ['drums']),
  row('b', ['bass']),
  row('l', ['lead']),
  row('w', ['warm'])
]

function input(over: Partial<TurnaroundInput> = {}): TurnaroundInput {
  return {
    rate: 'often',
    random: seq([]),
    loopBars: 8,
    lastPhrase: null,
    rows: BED,
    arc: 'steady',
    leavingRowId: null,
    ...over
  }
}

describe('the move families', () => {
  it('are drops, wash, filters and riser, and every move belongs to one', () => {
    expect(TURNAROUND_FAMILIES).toEqual(['drops', 'wash', 'filters', 'riser'])
    expect(TURNAROUND_MOVES.map((m) => TURNAROUND_FAMILY_OF[m])).toEqual([
      'drops',
      'drops',
      'drops',
      'wash',
      'filters',
      'filters',
      'riser'
    ])
  })

  it('normalise: unknown entries dropped, canonical order, a non-array is all of them, empty stays empty', () => {
    expect(normalizeTurnaroundMoves(['riser', 'junk', 'wash'])).toEqual(['wash', 'riser'])
    expect(normalizeTurnaroundMoves(undefined)).toEqual(['drops', 'wash', 'filters', 'riser'])
    expect(normalizeTurnaroundMoves('drops')).toEqual(['drops', 'wash', 'filters', 'riser'])
    expect(normalizeTurnaroundMoves([])).toEqual([])
  })

  it('toggle one family, keeping the order', () => {
    expect(toggleTurnaroundFamily(TURNAROUND_FAMILIES, 'wash')).toEqual(['drops', 'filters', 'riser'])
    expect(toggleTurnaroundFamily(['riser'], 'drops')).toEqual(['drops', 'riser'])
    expect(toggleTurnaroundFamily(['riser'], 'riser')).toEqual([])
  })

  it('the draw skips a family that is off', () => {
    const base = { rows: BED, leavingRowId: null, loopBars: 8, arc: 'steady' as const }
    expect(turnaroundDraw({ ...base, moves: ['filters'] })).toEqual(['lift', 'dip'])
    expect(turnaroundDraw({ ...base, moves: ['drops', 'riser'] })).toEqual([
      'drum drop',
      'low drop',
      'stop',
      'riser'
    ])
    expect(turnaroundDraw(base)).toHaveLength(7)
  })

  it('none enabled behaves as off, and spends no draw', () => {
    expect(rollTurnaround(input({ moves: [] }))).toBeNull()
  })

  it('a family switched off is not repeated by a diminution', () => {
    expect(
      rollTurnaround(input({ moves: ['wash'], lastPhrase: { move: 'low drop', beats: 8, halvings: 0 } }))
    ).toBeNull()
  })

  it('only the families on are ever drawn', () => {
    const random = mulberry32(17)
    let seen = 0
    for (let i = 0; i < 2000; i++) {
      const plan = rollTurnaround(input({ moves: ['wash', 'riser'], random }))
      if (plan === null) continue
      seen++
      expect(['wash', 'riser']).toContain(plan.move)
    }
    expect(seen).toBeGreaterThan(0)
  })
})

describe('the depth', () => {
  it('is bold by default, subtle or bold, and normalises junk to bold', () => {
    expect(DEFAULT_TURNAROUND_DEPTH).toBe('bold')
    expect(TURNAROUND_DEPTH_OPTIONS).toEqual(['subtle', 'bold'])
    expect(normalizeTurnaroundDepth('subtle')).toBe('subtle')
    expect(normalizeTurnaroundDepth('deep')).toBe('bold')
  })

  it("bold is the spec's numbers; subtle is shallower and at most a bar", () => {
    expect(TURNAROUND_DEPTH).toEqual({
      bold: { liftTop: 0.6, dipFloor: 0.35, washPeak: 0.85, maxBeats: 16 },
      subtle: { liftTop: 0.35, dipFloor: 0.6, washPeak: 0.6, maxBeats: 4 }
    })
  })

  it('subtle lifts to 0.35, dips to 0.6, washes to 0.6', () => {
    const lift = rollTurnaround(input({ depth: 'subtle', random: seq([0, 0.65, 0]) }))
    expect(lift?.rows[0].filter).toEqual(turnaroundLiftCurve(4, 0.35))
    const dip = rollTurnaround(input({ depth: 'subtle', random: seq([0, 0.85]) }))
    expect(dip?.rows[0].filter).toEqual(turnaroundDipCurve(4, 0.6))
    const wash = rollTurnaround(input({ depth: 'subtle', random: seq([0, 0.55]) }))
    expect(wash?.rows[0].reverbSend).toEqual(turnaroundWashCurve(4, 0.6))
  })

  it('subtle caps every move at a bar, however long the loop', () => {
    const random = mulberry32(19)
    for (let i = 0; i < 3000; i++) {
      const plan = rollTurnaround(input({ depth: 'subtle', loopBars: 32, random }))
      if (plan === null) continue
      expect(plan.beats).toBeLessThanOrEqual(4)
      if (plan.riserBars !== undefined) expect(plan.riserBars).toBe(1)
    }
  })

  it('an input without a depth is bold', () => {
    const plain = rollTurnaround(input({ random: seq([0, 0.65, 0]) }))
    expect(plain?.rows[0].filter).toEqual(turnaroundLiftCurve(4))
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd /Users/nickel/Claudecode/sssketch && npx vitest run src/shared/radioTurnaroundControls.test.ts`
Expected: FAIL, with `TURNAROUND_FAMILIES` undefined (and similar).

- [ ] **Step 3: Implement it in `src/shared/radioTurnaround.ts`**

(a) `TurnaroundInput`. Replace

```ts
  /** The row the arc removes at this wrap, if any: the wash's target. */
  leavingRowId: string | null
}
```

with

```ts
  /** The row the arc removes at this wrap, if any: the wash's target. */
  leavingRowId: string | null
  /** The move families switched on (RadioSettings.turnaroundMoves); all when absent. None is
   * off. */
  moves?: readonly TurnaroundFamily[]
  /** How far the moves go (RadioSettings.turnaroundDepth); bold when absent. */
  depth?: TurnaroundDepth
}
```

(b) Delete the `BOLD_LOOKS` constant (the depth table below replaces it):

```ts
const BOLD_LOOKS: TurnaroundLooks = {
  liftTop: TURNAROUND_LIFT_TOP,
  dipFloor: TURNAROUND_DIP_FLOOR,
  washPeak: TURNAROUND_WASH_PEAK
}
```

(c) Replace `drawOf` and `turnaroundDraw`:

```ts
function drawOf(bed: Bed, arc: TurnaroundArc, capBeats: number): TurnaroundMove[] {
  const weights = TURNAROUND_WEIGHTS[arc]
  return TURNAROUND_MOVES.filter(
    (m) => weights[m] > 0 && SHORTEST_BEATS[m] <= capBeats && canSound(m, bed)
  )
}

/** The moves a phrase end could draw right now, with no randomness: the guards, the cap and the
 * arc's weights. rollTurnaround draws from exactly this. */
export function turnaroundDraw(
  input: Pick<TurnaroundInput, 'rows' | 'leavingRowId' | 'loopBars' | 'arc'>
): TurnaroundMove[] {
  const capBeats = turnaroundCapBeats(input.loopBars)
  if (!(capBeats > 0)) return []
  return drawOf(bedOf(input.rows, input.leavingRowId), input.arc, capBeats)
}
```

with

```ts
function drawOf(
  bed: Bed,
  arc: TurnaroundArc,
  capBeats: number,
  moves: readonly TurnaroundFamily[]
): TurnaroundMove[] {
  const weights = TURNAROUND_WEIGHTS[arc]
  return TURNAROUND_MOVES.filter(
    (m) =>
      weights[m] > 0 &&
      moves.includes(TURNAROUND_FAMILY_OF[m]) &&
      SHORTEST_BEATS[m] <= capBeats &&
      canSound(m, bed)
  )
}

/** min(half the loop, 4 bars), and never longer than the depth allows. */
function capOf(input: Pick<TurnaroundInput, 'loopBars' | 'depth'>): number {
  const depth = TURNAROUND_DEPTH[input.depth ?? DEFAULT_TURNAROUND_DEPTH]
  return Math.min(turnaroundCapBeats(input.loopBars), depth.maxBeats)
}

/** The moves a phrase end could draw right now, with no randomness: the guards, the cap, the
 * families switched on and the arc's weights. rollTurnaround draws from exactly this. */
export function turnaroundDraw(
  input: Pick<TurnaroundInput, 'rows' | 'leavingRowId' | 'loopBars' | 'arc' | 'moves' | 'depth'>
): TurnaroundMove[] {
  const capBeats = capOf(input)
  if (!(capBeats > 0)) return []
  return drawOf(
    bedOf(input.rows, input.leavingRowId),
    input.arc,
    capBeats,
    input.moves ?? TURNAROUND_FAMILIES
  )
}
```

(d) Replace the body of `rollTurnaround` (keep its doc comment, and add the line ` * - The families switched off (\`moves\`) are never drawn; none switched on is off.` at its end, before ` */`):

```ts
export function rollTurnaround(input: TurnaroundInput): TurnaroundPlan | null {
  const { random, loopBars, lastPhrase, arc } = input
  const moves = input.moves ?? TURNAROUND_FAMILIES
  const looks = TURNAROUND_DEPTH[input.depth ?? DEFAULT_TURNAROUND_DEPTH]
  const chance = TURNAROUND_CHANCE[input.rate] ?? 0
  const capBeats = capOf(input)
  if (!(chance > 0) || !(capBeats > 0) || moves.length === 0) return null
  const bed = bedOf(input.rows, input.leavingRowId)
  if (lastPhrase !== null) {
    const { move } = lastPhrase
    if (!DIMINISHING.includes(move) || lastPhrase.halvings >= TURNAROUND_MAX_HALVINGS) return null
    if (!moves.includes(TURNAROUND_FAMILY_OF[move])) return null
    const beats = Math.min(lastPhrase.beats / 2, capBeats)
    if (beats < 1 || !(TURNAROUND_WEIGHTS[arc][move] > 0) || !canSound(move, bed)) return null
    if (!(random() < chance)) return null
    return build(move, beats, lastPhrase.halvings + 1, bed, loopBars, random, looks)
  }
  const drawn = drawOf(bed, arc, capBeats, moves)
  if (drawn.length === 0 || !(random() < chance)) return null
  const move = pickWeighted(
    drawn.map((m) => ({ item: m, weight: TURNAROUND_WEIGHTS[arc][m] })),
    random
  )
  return build(move, drawBeats(move, bed, capBeats, random), 0, bed, loopBars, random, looks)
}
```

(e) Append to the end of the file:

```ts
// ---- the controls (spec section 4a) ----

/** The four families a listener switches: drops (drum drop, low drop, stop), wash, filters
 * (lift, dip) and the riser. */
export type TurnaroundFamily = 'drops' | 'wash' | 'filters' | 'riser'

export const TURNAROUND_FAMILIES: readonly TurnaroundFamily[] = ['drops', 'wash', 'filters', 'riser']

export const TURNAROUND_FAMILY_OF: Readonly<Record<TurnaroundMove, TurnaroundFamily>> = {
  'drum drop': 'drops',
  'low drop': 'drops',
  stop: 'drops',
  wash: 'wash',
  lift: 'filters',
  dip: 'filters',
  riser: 'riser'
}

/** The families switched on, in canonical order: an unknown entry is dropped, a non-array (a
 * fresh setting) is all of them. An empty list stays empty -- none enabled behaves as off. */
export function normalizeTurnaroundMoves(value: unknown): TurnaroundFamily[] {
  if (!Array.isArray(value)) return [...TURNAROUND_FAMILIES]
  return TURNAROUND_FAMILIES.filter((f) => value.includes(f))
}

/** One family switched, the rest kept, in canonical order. */
export function toggleTurnaroundFamily(
  moves: readonly TurnaroundFamily[],
  family: TurnaroundFamily
): TurnaroundFamily[] {
  const on = moves.includes(family)
  return TURNAROUND_FAMILIES.filter((f) => (f === family ? !on : moves.includes(f)))
}

export type TurnaroundDepth = 'subtle' | 'bold'

export const TURNAROUND_DEPTH_OPTIONS: TurnaroundDepth[] = ['subtle', 'bold']

/** `bold` on both radios: it is the spec's own numbers. */
export const DEFAULT_TURNAROUND_DEPTH: TurnaroundDepth = 'bold'

export function normalizeTurnaroundDepth(value: unknown): TurnaroundDepth {
  return value === 'subtle' || value === 'bold' ? value : DEFAULT_TURNAROUND_DEPTH
}

export interface TurnaroundDepthValues {
  liftTop: number
  dipFloor: number
  washPeak: number
  /** The longest move, in beats (the loop's own cap still applies under it). */
  maxBeats: number
}

/** What each depth does to the filter and wash moves, and how long any move may be. */
export const TURNAROUND_DEPTH: Readonly<Record<TurnaroundDepth, TurnaroundDepthValues>> = {
  bold: {
    liftTop: TURNAROUND_LIFT_TOP,
    dipFloor: TURNAROUND_DIP_FLOOR,
    washPeak: TURNAROUND_WASH_PEAK,
    maxBeats: TURNAROUND_MAX_BARS * BEATS_PER_BAR
  },
  subtle: { liftTop: 0.35, dipFloor: 0.6, washPeak: 0.6, maxBeats: BEATS_PER_BAR }
}
```

`build` still takes a `TurnaroundLooks`. A `TurnaroundDepthValues` is one, with an extra field.

- [ ] **Step 4: Run every planner test**

Run: `npx vitest run src/shared/radioTurnaround*.test.ts`
Expected: PASS, Tasks 1–5's tests unchanged.

- [ ] **Step 5: Format, lint, typecheck both repos**

```bash
cd /Users/nickel/Claudecode/sssketch
npx prettier --write src/shared/radioTurnaround.ts src/shared/radioTurnaroundControls.test.ts
npx eslint src/shared/radioTurnaround.ts src/shared/radioTurnaroundControls.test.ts
npm run typecheck
cd /Users/nickel/Claudecode/ell.ing/radio && npm run typecheck && npm test
```
Expected: clean.

- [ ] **Step 6: Commit**

```bash
cd /Users/nickel/Claudecode/sssketch
git add src/shared/radioTurnaround.ts src/shared/radioTurnaroundControls.test.ts
git commit -m "radio turnarounds Task 11: the planner's controls -- move families (none is off) and depth (subtle: shallower, at most a bar)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 12: The controls in `RadioSettings`, and the web radio reads them (sssketch and ell.ing/radio)

**Files:**
- Modify: `src/shared/radioSchedule.ts`, `src/shared/radioSchedule.test.ts`, `src/shared/radioTurnaroundSettings.test.ts`, `src/main/discoverSettingsStore.test.ts`
- Radio: modify `src/radio/settings.ts`, `src/radio/settings.test.ts`, `src/radio/step.ts`, `src/radio/step.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/shared/radioTurnaroundSettings.test.ts`:

```ts
describe('RadioSettings.turnaroundMoves and turnaroundDepth', () => {
  it('default to every family, bold', () => {
    expect(DEFAULT_RADIO_SETTINGS.turnaroundMoves).toEqual(['drops', 'wash', 'filters', 'riser'])
    expect(DEFAULT_RADIO_SETTINGS.turnaroundDepth).toBe('bold')
  })

  it('normalise: unknown families dropped, empty kept (off), junk depth bold', () => {
    expect(normalizeRadioSettings({ turnaroundMoves: ['riser', 'loud'] }).turnaroundMoves).toEqual([
      'riser'
    ])
    expect(normalizeRadioSettings({ turnaroundMoves: [] }).turnaroundMoves).toEqual([])
    expect(normalizeRadioSettings({}).turnaroundMoves).toEqual(['drops', 'wash', 'filters', 'riser'])
    expect(normalizeRadioSettings({ turnaroundDepth: 'subtle' }).turnaroundDepth).toBe('subtle')
    expect(normalizeRadioSettings({ turnaroundDepth: 'deep' }).turnaroundDepth).toBe('bold')
  })
})
```

In `src/radio/step.test.ts`, append inside `describe('turnarounds', ...)`:

```ts
  it('draws only the families switched on, and none is off', () => {
    let seen = 0
    for (let seed = 1; seed <= 10; seed++) {
      const sim = new Sim({ turnarounds: 'often', turnaroundMoves: ['riser'] }, seeded(seed))
      sim.send({ type: 'play' })
      sim.run(0, 40 * LAP)
      for (const a of sim.of('turnaround')) {
        seen++
        expect(a.plan.move).toBe('riser')
      }
    }
    expect(seen).toBeGreaterThan(0)
    const none = new Sim({ turnarounds: 'often', turnaroundMoves: [] }, seeded(1))
    none.send({ type: 'play' })
    none.run(0, 40 * LAP)
    expect(none.of('turnaround')).toHaveLength(0)
  })
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd /Users/nickel/Claudecode/sssketch && npx vitest run src/shared/radioTurnaroundSettings.test.ts`
Expected: FAIL, with `turnaroundMoves` undefined. (The radio test cannot typecheck yet. Its run comes in Step 5.)

- [ ] **Step 3: Implement it in `src/shared/radioSchedule.ts`**

(a) Imports. Replace

```ts
import {
  DEFAULT_RADIO_TURNAROUNDS,
  normalizeRadioTurnarounds,
  turnaroundPhraseLaps,
  type RadioTurnarounds
} from './radioTurnaround'
```

with

```ts
import {
  DEFAULT_RADIO_TURNAROUNDS,
  DEFAULT_TURNAROUND_DEPTH,
  TURNAROUND_FAMILIES,
  normalizeRadioTurnarounds,
  normalizeTurnaroundDepth,
  normalizeTurnaroundMoves,
  turnaroundPhraseLaps,
  type RadioTurnarounds,
  type TurnaroundDepth,
  type TurnaroundFamily
} from './radioTurnaround'
```

(b) `RadioSettings`. Replace

```ts
  dropOuts: RadioDropOuts
  turnover: RadioTurnover
```

with

```ts
  dropOuts: RadioDropOuts
  /** Which move families a turnaround may draw (radioTurnaround's TURNAROUND_FAMILIES). None
   * enabled behaves as `turnarounds: off`. */
  turnaroundMoves: readonly TurnaroundFamily[]
  /** How far the moves go: `bold` (the spec's numbers) or `subtle`. */
  turnaroundDepth: TurnaroundDepth
  turnover: RadioTurnover
```

(c) `DEFAULT_RADIO_SETTINGS`. Replace

```ts
  dropOuts: DEFAULT_RADIO_TURNAROUNDS,
```

with

```ts
  dropOuts: DEFAULT_RADIO_TURNAROUNDS,
  turnaroundMoves: [...TURNAROUND_FAMILIES],
  turnaroundDepth: DEFAULT_TURNAROUND_DEPTH,
```

(d) `normalizeRadioSettings`. Replace

```ts
    turnarounds,
    dropOuts: turnarounds,
```

with

```ts
    turnarounds,
    dropOuts: turnarounds,
    turnaroundMoves: normalizeTurnaroundMoves(raw.turnaroundMoves),
    turnaroundDepth: normalizeTurnaroundDepth(raw.turnaroundDepth),
```

(e) `src/shared/radioSchedule.test.ts`, the default-settings `toEqual`. Replace

```ts
      turnarounds: 'rare',
      dropOuts: 'rare',
```

with

```ts
      turnarounds: 'rare',
      dropOuts: 'rare',
      turnaroundMoves: ['drops', 'wash', 'filters', 'riser'],
      turnaroundDepth: 'bold',
```

(f) `src/main/discoverSettingsStore.test.ts`, `'round-trips every radio setting'`. In both objects, replace

```ts
        turnarounds: 'often',
        dropOuts: 'often',
```

with

```ts
        turnarounds: 'often',
        dropOuts: 'often',
        turnaroundMoves: ['wash', 'riser'],
        turnaroundDepth: 'subtle',
```

(Match each occurrence's own indentation.)

- [ ] **Step 4: Run the sssketch tests**

Run: `npx vitest run src/shared src/main/discoverSettingsStore.test.ts`
Expected: PASS.

- [ ] **Step 5: The web radio**

`npm run typecheck` in the radio repo now fails: `WEB_RADIO_DEFAULTS` lacks the two fields.

`src/radio/settings.ts`:
- imports: below the `@shared/radioSchedule` import, add `import { TURNAROUND_FAMILIES } from '@shared/radioTurnaround'`;
- header table, below the `turnarounds` row:

  ```ts
  //   moves         turnaroundMoves         all four  (spec 4a) full mode's toggles, per visitor
  //   depth         turnaroundDepth         'bold'    (spec 4a) full mode's toggle, per visitor
  ```
- `WEB_RADIO_DEFAULTS`, replace

  ```ts
    turnarounds: 'often',
  ```

  with

  ```ts
    turnarounds: 'often',
    turnaroundMoves: Object.freeze([...TURNAROUND_FAMILIES]),
    turnaroundDepth: 'bold',
  ```

`src/radio/settings.test.ts`, the field-by-field `toEqual`: replace

```ts
      turnarounds: 'often', // turnarounds: the drop-outs row renamed, his choice kept
```

with

```ts
      turnarounds: 'often', // turnarounds: the drop-outs row renamed, his choice kept
      turnaroundMoves: ['drops', 'wash', 'filters', 'riser'], // every family (full mode can switch)
      turnaroundDepth: 'bold', // the spec's numbers
```

`src/radio/step.ts`, in `rollTurnaroundAt`'s `rollTurnaround({ ... })`, replace

```ts
    arc: s.settings.densityArc?.on ? turnaroundArc(s.density, s.rows.length) : 'steady',
    leavingRowId: leaving
  })
```

with

```ts
    arc: s.settings.densityArc?.on ? turnaroundArc(s.density, s.rows.length) : 'steady',
    leavingRowId: leaving,
    moves: s.settings.turnaroundMoves,
    depth: s.settings.turnaroundDepth
  })
```

- [ ] **Step 6: Verify both repos**

```bash
cd /Users/nickel/Claudecode/sssketch
npx prettier --write src/shared/radioSchedule.ts src/shared/radioSchedule.test.ts src/shared/radioTurnaroundSettings.test.ts src/main/discoverSettingsStore.test.ts
npx eslint src/shared/radioSchedule.ts src/shared/radioSchedule.test.ts src/shared/radioTurnaroundSettings.test.ts src/main/discoverSettingsStore.test.ts
npm run typecheck
cd /Users/nickel/Claudecode/ell.ing/radio && npm run typecheck && npm test
```
Expected: green, including the new step test.

- [ ] **Step 7: Commit, per repo**

```bash
cd /Users/nickel/Claudecode/sssketch
git add src/shared/radioSchedule.ts src/shared/radioSchedule.test.ts src/shared/radioTurnaroundSettings.test.ts src/main/discoverSettingsStore.test.ts
git commit -m "radio turnarounds Task 12: turnaroundMoves and turnaroundDepth in RadioSettings, normalised

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
cd /Users/nickel/Claudecode/ell.ing/radio
git add src/radio/settings.ts src/radio/settings.test.ts src/radio/step.ts src/radio/step.test.ts
git commit -m "radio: turnarounds draw only the families switched on, at the depth set (defaults: all, bold)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 13: Full mode's turnaround toggles, remembered per visitor (ell.ing/radio)

These follow the listener effects' pattern: `src/ui/fx.ts` stores `localStorage['radio.fx']`, `full.ts` draws them, and `main.ts` applies them. There are four family toggles and a depth toggle, beside the effects. Simple mode gets nothing new, and there is no rate control (the web radio is `often`).

**Files:**
- Create: `src/ui/turnaroundPrefs.ts`, `src/ui/turnaroundPrefs.test.ts`
- Modify: `src/radio/step.ts` (event), `src/radio/controller.ts` (`setTurnaroundControls`), `src/ui/full.ts`, `src/main.ts`
- Test: `src/radio/step.test.ts`, `src/radio/controller.test.ts`

- [ ] **Step 1: Write the failing tests**

`src/ui/turnaroundPrefs.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { TURNAROUNDS_KEY, loadTurnaroundPrefs, saveTurnaroundPrefs, type TurnaroundPrefs } from './turnaroundPrefs'

const D: TurnaroundPrefs = { moves: ['drops', 'wash', 'filters', 'riser'], depth: 'bold' }
const memory = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init))
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }
}
const throwing = {
  getItem: () => {
    throw new Error('blocked')
  },
  setItem: () => {
    throw new Error('blocked')
  }
}

describe('the turnaround controls (radio.turnarounds)', () => {
  it("the radio's defaults until set; a set value is remembered", () => {
    const s = memory()
    expect(loadTurnaroundPrefs(s, D)).toEqual(D)
    saveTurnaroundPrefs({ moves: ['riser', 'wash'], depth: 'subtle' }, s)
    expect(JSON.parse(s.m.get(TURNAROUNDS_KEY)!)).toEqual({ moves: ['riser', 'wash'], depth: 'subtle' })
    // read back in canonical order
    expect(loadTurnaroundPrefs(s, D)).toEqual({ moves: ['wash', 'riser'], depth: 'subtle' })
  })

  it('every family off is remembered as off', () => {
    const s = memory()
    saveTurnaroundPrefs({ moves: [], depth: 'bold' }, s)
    expect(loadTurnaroundPrefs(s, D).moves).toEqual([])
  })

  it('missing or junk values fall back field by field', () => {
    expect(loadTurnaroundPrefs(memory({ [TURNAROUNDS_KEY]: JSON.stringify({ depth: 'subtle' }) }), D)).toEqual({ ...D, depth: 'subtle' })
    expect(loadTurnaroundPrefs(memory({ [TURNAROUNDS_KEY]: JSON.stringify({ moves: ['loud'], depth: 'deep' }) }), D)).toEqual({ moves: [], depth: 'bold' })
    expect(loadTurnaroundPrefs(memory({ [TURNAROUNDS_KEY]: 'not json' }), D)).toEqual(D)
    expect(loadTurnaroundPrefs(memory({ [TURNAROUNDS_KEY]: '[1,2]' }), D)).toEqual(D)
  })

  it('storage that throws, or none: the defaults, and saving does not throw', () => {
    expect(loadTurnaroundPrefs(throwing, D)).toEqual(D)
    expect(loadTurnaroundPrefs(null, D)).toEqual(D)
    expect(() => saveTurnaroundPrefs(D, throwing)).not.toThrow()
  })
})
```

In `src/radio/step.test.ts`, append inside `describe('turnarounds', ...)`:

```ts
  it("the listener's controls reach the settings the roll reads", () => {
    const sim = new Sim({ turnarounds: 'often' }, seeded(1))
    sim.send({ type: 'turnaroundControls', moves: ['riser', 'wash'], depth: 'subtle' })
    expect(sim.s.settings.turnaroundMoves).toEqual(['wash', 'riser'])
    expect(sim.s.settings.turnaroundDepth).toBe('subtle')
  })
```

In `src/radio/controller.test.ts`, append inside `describe('turnarounds', ...)`:

```ts
  it('setTurnaroundControls changes what the next phrase end may draw', async () => {
    const r = rig({ seed: 3, settings: { turnarounds: 'often', phraseBars: 16 } })
    await started(r)
    r.ctl.setTurnaroundControls(['riser'], 'subtle')
    expect(r.ctl.state.settings.turnaroundMoves).toEqual(['riser'])
    await r.run(r.eng.lap() * 40)
    const ts = r.eng.turnarounds()
    expect(ts.length).toBeGreaterThan(0)
    for (const t of ts) {
      expect(t.plan.move).toBe('riser')
      expect(t.plan.beats).toBeLessThanOrEqual(4) // subtle: at most a bar
    }
  })
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd /Users/nickel/Claudecode/ell.ing/radio && npx vitest run src/ui/turnaroundPrefs.test.ts src/radio/step.test.ts src/radio/controller.test.ts`
Expected: FAIL. The prefs module is missing, and the `turnaroundControls` event and `setTurnaroundControls` do not exist.

- [ ] **Step 3: `src/ui/turnaroundPrefs.ts`**

```ts
// src/ui/turnaroundPrefs.ts -- the listener's turnaround controls (full mode's strip: which move
// families a phrase end may draw, and how deep they go; spec 2026-10-02 section 4a), remembered
// per visitor in localStorage['radio.turnarounds'] and given to the radio when it is made, and on
// every change. Anything missing or unreadable falls back to the radio's defaults, field by field.
import {
  normalizeTurnaroundDepth,
  normalizeTurnaroundMoves,
  type TurnaroundDepth,
  type TurnaroundFamily
} from '@shared/radioTurnaround'

export const TURNAROUNDS_KEY = 'radio.turnarounds'

export interface TurnaroundPrefs {
  moves: readonly TurnaroundFamily[]
  depth: TurnaroundDepth
}

type PrefsStorage = Pick<Storage, 'getItem' | 'setItem'> | null

export function loadTurnaroundPrefs(storage: PrefsStorage, defaults: TurnaroundPrefs): TurnaroundPrefs {
  try {
    const raw = storage?.getItem(TURNAROUNDS_KEY)
    const v: unknown = raw ? JSON.parse(raw) : null
    const o = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
    return {
      moves: Array.isArray(o.moves) ? normalizeTurnaroundMoves(o.moves) : [...defaults.moves],
      depth: o.depth === 'subtle' || o.depth === 'bold' ? normalizeTurnaroundDepth(o.depth) : defaults.depth
    }
  } catch {
    return { moves: [...defaults.moves], depth: defaults.depth }
  }
}

export function saveTurnaroundPrefs(prefs: TurnaroundPrefs, storage: PrefsStorage): void {
  try {
    storage?.setItem(TURNAROUNDS_KEY, JSON.stringify({ moves: [...prefs.moves], depth: prefs.depth }))
  } catch {
    // not remembered past this visit
  }
}
```

- [ ] **Step 4: The event (`src/radio/step.ts`) and the controller (`src/radio/controller.ts`)**

`step.ts`:
- imports: extend the `@shared/radioTurnaround` import to

  ```ts
  import {
    normalizeTurnaroundDepth,
    normalizeTurnaroundMoves,
    radioTransitionUnderTurnaround,
    rememberTurnaround,
    rollTurnaround,
    turnaroundArc,
    type TurnaroundDepth,
    type TurnaroundFamily,
    type TurnaroundMemory,
    type TurnaroundPlan
  } from '@shared/radioTurnaround'
  ```
- `RadioEvent`: add `  | { type: 'turnaroundControls'; moves: readonly TurnaroundFamily[]; depth: TurnaroundDepth }` after `  | { type: 'solo'; slot: string }`.
- `reduce`: add, directly after the `case 'replaceSoon':` case,

  ```ts
      case 'turnaroundControls':
        // the listener's toggles (full mode): the next phrase end's roll reads them
        s.settings = {
          ...s.settings,
          turnaroundMoves: normalizeTurnaroundMoves(event.moves),
          turnaroundDepth: normalizeTurnaroundDepth(event.depth)
        }
        break
  ```

`controller.ts`:
- imports: replace `import type { TurnaroundPlan } from '@shared/radioTurnaround'` with `import type { TurnaroundDepth, TurnaroundFamily, TurnaroundPlan } from '@shared/radioTurnaround'`;
- add, directly after `toggleReplaceSoon(slot: string): void { ... }`:

  ```ts
    /** The listener's turnaround controls (full mode): which families a phrase end may draw, and
     * how deep. None switched on is off. */
    setTurnaroundControls(moves: readonly TurnaroundFamily[], depth: TurnaroundDepth): void {
      this.dispatch({ type: 'turnaroundControls', moves, depth })
    }
  ```

- [ ] **Step 5: Full mode (`src/ui/full.ts`)**

(a) Imports. Below `import { FX_NAMES, type Fx } from './fx'`, add:

```ts
import { TURNAROUND_FAMILIES, toggleTurnaroundFamily } from '@shared/radioTurnaround'
import type { TurnaroundPrefs } from './turnaroundPrefs'
```

(b) `FullHandlers`. Replace

```ts
  /** The listener's effects (ui/fx.ts): read, and set. */
  readFx(): Fx
  fx(f: Fx): void
```

with

```ts
  /** The listener's effects (ui/fx.ts): read, and set. */
  readFx(): Fx
  fx(f: Fx): void
  /** The listener's turnaround controls (ui/turnaroundPrefs.ts): read, and set. */
  readTurnarounds(): TurnaroundPrefs
  turnarounds(p: TurnaroundPrefs): void
```

(c) The strip. Replace

```ts
  const fxRanges = FX_NAMES.map((name) => range(name, name, fx0[name], (v) => on.fx({ ...on.readFx(), [name]: v })))
```

with

```ts
  const fxRanges = FX_NAMES.map((name) => range(name, name, fx0[name], (v) => on.fx({ ...on.readFx(), [name]: v })))
  // the turnaround controls, beside the effects (ui/turnaroundPrefs.ts): which families a phrase
  // end may draw (pressed = on; none = no turnarounds) and how deep they go (the word says which)
  const turns = h('div', 'knob')
  turns.append(h('span', '', 'turnarounds'))
  const familyButtons = TURNAROUND_FAMILIES.map((family) => {
    const b = button(family, `turnarounds: ${family}`, () => {
      const p = on.readTurnarounds()
      on.turnarounds({ ...p, moves: toggleTurnaroundFamily(p.moves, family) })
      drawTurns()
    })
    turns.append(b)
    return { family, b }
  })
  const depth = button('', 'turnarounds: depth', () => {
    const p = on.readTurnarounds()
    on.turnarounds({ ...p, depth: p.depth === 'bold' ? 'subtle' : 'bold' })
    drawTurns()
  })
  turns.append(depth)
  const drawTurns = () => {
    const p = on.readTurnarounds()
    for (const { family, b } of familyButtons) pressed(b, p.moves.includes(family))
    depth.textContent = p.depth
  }
  drawTurns()
```

(d) Put it in the master group. Replace

```ts
  masterGrp.append(level.wrap, reverb.wrap, ...fxRanges.map((r) => r.wrap), ...(opts.dev ? [cutoff.wrap, res.wrap, bypass] : []), invert, visualsBtn, ...(opts.dev ? [reduction] : []))
```

with

```ts
  masterGrp.append(level.wrap, reverb.wrap, ...fxRanges.map((r) => r.wrap), turns, ...(opts.dev ? [cutoff.wrap, res.wrap, bypass] : []), invert, visualsBtn, ...(opts.dev ? [reduction] : []))
```

- [ ] **Step 6: `src/main.ts`**

(a) Imports. Below `import { applyFx, loadFx, saveFx } from './ui/fx'`, add:

```ts
import { loadTurnaroundPrefs, saveTurnaroundPrefs, type TurnaroundPrefs } from './ui/turnaroundPrefs'
import { WEB_RADIO_DEFAULTS } from './radio/settings'
```

If `WEB_RADIO_DEFAULTS` is already imported from `./radio/settings`, merge the import rather than adding a second line.

(b) State. Directly below the `let fx = loadFx(...)` line, add:

```ts
/** The listener's turnaround controls (full mode's strip), remembered per visitor; the radio's
 * defaults until set. Given to the radio when it is made, and on every change. */
let turnarounds: TurnaroundPrefs = loadTurnaroundPrefs(localStore(), {
  moves: WEB_RADIO_DEFAULTS.turnaroundMoves,
  depth: WEB_RADIO_DEFAULTS.turnaroundDepth
})
```

(c) Handlers. In the `mountFull(app, { ... })` handler object, directly after the `fx: (f) => { ... },` entry, add:

```ts
    readTurnarounds: () => turnarounds,
    turnarounds: (p) => {
      turnarounds = p
      saveTurnaroundPrefs(p, localStore())
      radio?.setTurnaroundControls(p.moves, p.depth)
    },
```

(d) The radio. In `build()`'s `new RadioController({ ... })`, directly after `        log,`, add:

```ts
        // the listener's turnaround controls (full mode); the rest is WEB_RADIO_DEFAULTS
        settings: { turnaroundMoves: turnarounds.moves, turnaroundDepth: turnarounds.depth },
```

- [ ] **Step 7: Verify**

```bash
cd /Users/nickel/Claudecode/ell.ing/radio
npx vitest run src/ui/turnaroundPrefs.test.ts src/radio
npm run typecheck && npm test && npm run build
```
Expected: green. (No agent can see full mode. The toggles' look is for Elling's walkthrough, Task 17.)

- [ ] **Step 8: Commit**

```bash
cd /Users/nickel/Claudecode/ell.ing/radio
git add src/ui/turnaroundPrefs.ts src/ui/turnaroundPrefs.test.ts src/radio/step.ts src/radio/controller.ts src/radio/step.test.ts src/radio/controller.test.ts src/ui/full.ts src/main.ts
git commit -m "radio: full mode's turnaround toggles -- four families and a depth, remembered per visitor (radio.turnarounds)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 14 (BLOCKED until the radio-sound session reports done): sssketch plays turnarounds; the menu row is renamed

**Do not start this task until the coordinator says the radio-sound session is done with `DiscoverPanel.tsx` and `DiscoverRadioMenu.tsx`.** Then `git pull`/`git log` and **re-read both files**. Every edit below is anchored on quoted code. If an anchor has moved or been reworded, find its current form by grep, apply the same change there, and note it in the commit message. Do not run prettier over these files. Format your hunks by hand (2-space indent, no semis, single quotes, ≤100 columns).

What this task does in `DiscoverPanel.tsx`:
- **Rolled** on the wrap that starts a phrase's last lap (`step.turnaroundLapStarts`, from `advanceRadioClock`). The roll is deferred one microtask, queued right after `densityTick`'s, so the arc's removal at that wrap (`arcExitRef`) is already decided (the wash's target). Nothing else can arm that lap before it: the due branch's decision and a landing's arrivals run in microtasks queued later in the same tick.
- **Armed** in its own ref, `radioTurnaroundRef`, never in `radioGestureRef`. Every entry there holds radio's early decision until spent, and with a phrase grid the turnaround's lap is exactly the lap the next change is staged in.
- **Cleared** at every wrap: the one that played comes off, and the same wrap may roll the next. It is also cleared where drop-outs were (radio off, a course change, the panel going).
- **Built** into the **live** project only, plus a **mid-lap** stage (`stage.atBars !== undefined`), which replaces the live project inside the turnaround's lap. A stage landing at the wrap never carries it.
- **Merged** through `combineRadioCurves`:
  - volume shapes multiply, then go under the master once (replacing "first volume curve wins", while a stem still ducks once);
  - send takes the max;
  - a stem already carrying a gesture `filterCutoff` (a filter in) keeps it, and the turnaround's filter is skipped there.
- **The lift** sets that stem's `stemFilters[key]` to `{ mode: 'highpass', cutoff: 0, resonance: 0 }` for the lap, and its cutoff curve rises from 0.
- **The riser** is `buildTransitionRiser` with the turnaround's `armId`.
- **A change on the same wrap keeps only its arrival.** The early decision, the due branch and `drawManualTransitions` see the armed turnaround, and a drawn hole or riser becomes a cut.
- **`rollRadioDropOut`, `loopBarsAfterLanding` and both of their call sites go.**

No engine change. No `buildEngineProject.ts` change: `state.stemFilters` is already read there.

**Files:**
- Modify: `src/renderer/src/components/DiscoverPanel.tsx`
- Modify: `src/renderer/src/components/DiscoverRadioMenu.tsx`

- [ ] **Step 1: Imports (`DiscoverPanel.tsx`)**

Replace

```ts
import { buildDropOutCurve, pickDropOutBeats, rollIntervalDropOut } from '@shared/radioDropOut'
```

with

```ts
import { buildDropOutCurve, pickDropOutBeats } from '@shared/radioDropOut'
import {
  combineRadioCurves,
  radioTransitionUnderTurnaround,
  rememberTurnaround,
  rollTurnaround,
  turnaroundArc,
  turnaroundToLoopBars,
  turnaroundWashSend,
  type TurnaroundMemory,
  type TurnaroundPlan
} from '@shared/radioTurnaround'
```

- [ ] **Step 2: The refs**

Directly below

```ts
  const radioGestureRef = useRef<RadioGesture[]>([])
```

add

```ts
  // The phrase turnaround armed for the lap that is playing (@shared/radioTurnaround; spec
  // 2026-10-02-radio-turnarounds-design). Rolled at the wrap that starts a phrase's last lap
  // (radioTurnaroundAtWrap), read by syncPreviewToEngine into the LIVE project (and a mid-lap
  // stage, which replaces it inside the lap) -- never a stage landing at the wrap -- and taken
  // off at the next wrap. Its own ref rather than an entry in radioGestureRef, deliberately:
  // every gesture in that list holds radio's early decision until it is spent, and with a phrase
  // grid the turnaround's lap is exactly the lap the next change is staged in. `armId` keys its
  // riser (buildTransitionRiser), as a gesture's does.
  const radioTurnaroundRef = useRef<{ plan: TurnaroundPlan; armId: string } | null>(null)
  // What the last phrase end fired (rememberTurnaround): never two in a row, except diminution.
  const radioTurnaroundMemoryRef = useRef<TurnaroundMemory | null>(null)
```

- [ ] **Step 3: The build (`syncPreviewToEngine`)**

Replace the whole block that starts at

```ts
    const masterLevel01 = masterLevelRef.current / 100
    function underMaster(key: string, curve: AutomationPoint[]): AutomationPoint[] {
```

and ends with the closing `}` of `for (const gesture of gestureList) { ... }`, just above the blank line before `    // The armed dub throw (native radio sound plan, Task 11`, with:

```ts
    const masterLevel01 = masterLevelRef.current / 100
    function underMaster(key: string, curve: AutomationPoint[]): AutomationPoint[] {
      return masterScaledCurve(curve, (vol[key] ?? 1) * masterLevel01)
    }
    // VOLUME SHAPES per stem, multiplied together (combineRadioCurves) and put under the master
    // ONCE, at the end of this block -- scaling each under the master first and then multiplying
    // would apply the master twice. Multiplying is the turnarounds spec's rule (section 3): a
    // turnaround's drop never cancels a hole, a duck or the arc's exit; it stacks on them. Until
    // 2026-10-02 the first volume curve on a stem won and every later one was dropped.
    const volumeShapes = new Map<string, AutomationPoint[]>()
    function addVolume(key: string, curve: AutomationPoint[]): void {
      volumeShapes.set(key, combineRadioCurves(volumeShapes.get(key) ?? [], curve, 'volume'))
    }
    // A stem still ducks ONCE: two ducks landing at one wrap are one dip, not a deeper one.
    const ducked = new Set<string>()
    // A turnaround's lift switches its stems' filter to high-pass for the lap.
    const stemFilters: Record<string, StemFilterSettings> = {}
    // One pass per gesture, merging rather than overwriting: with several
    // rows changing at one wrap, a bloom on one row and a duck from another
    // row's change can land on the same stem key.
    for (const gesture of gestureList) {
      if (maxBarLength !== undefined && maxBarLength > 0) {
        const own = members.findIndex((m) => m.id === gesture.slotId) + 1
        // Every gesture measures itself in beats, so one conversion here
        // rather than four different units in the branches. 4/4, as
        // everywhere else in Discover.
        const bars = gesture.beats / 4
        if (gesture.kind === 'drop-out' || gesture.kind === 'hole') {
          // The same curve for both, and deliberately so: a hole IS the
          // drop-out, attached to a change. The difference is entirely in
          // WHOSE stem it lands on and when the change happens -- a
          // drop-out drops an untouched layer and puts it straight back, a
          // hole drops the OUTGOING layer and the new one lands in the
          // space at the wrap (see radioLedChangeRef).
          const curve = buildDropOutCurve(maxBarLength, gesture.beats)
          if (own > 0 && curve.length > 0) addVolume(stemKey(rifff.groupId, own), curve)
        } else if (gesture.kind === 'filter in') {
          const curve = buildFilterInCurve(maxBarLength, bars)
          if (own > 0 && curve.length > 0) {
            const key = stemKey(rifff.groupId, own)
            stemAutomation[key] = { ...stemAutomation[key], filterCutoff: curve }
          }
        } else if (gesture.kind === 'bloom') {
          const curve = buildBloomCurve(maxBarLength, bars)
          if (own > 0 && curve.length > 0) {
            const key = stemKey(rifff.groupId, own)
            stemAutomation[key] = {
              ...stemAutomation[key],
              reverbSend: combineRadioCurves(
                stemAutomation[key]?.reverbSend ?? [],
                curve,
                'reverbSend'
              )
            }
          }
        } else if (gesture.kind === 'duck') {
          // Every OTHER audible layer dips, so the new one lands in space.
          // "Other" means other than EVERY row changing in this stage, so a
          // duck never dips another arriving stem -- and on the live push
          // that follows a landing, other than every row that landed with
          // it (`spares`), so that push agrees with the stage it follows.
          //
          // A duck MULTIPLIES with any other volume curve on the stem (a
          // hole, the arc's exit, a turnaround's drop) -- but a stem ducks
          // once: a second duck at the same wrap is the same dip.
          const curve = buildDuckCurve(maxBarLength, bars)
          const changing = new Set(
            stage?.changes.map((c) => c.slotId) ?? gesture.spares ?? [gesture.slotId]
          )
          if (curve.length > 0) {
            members.forEach((m, i) => {
              if (!changing.has(m.id)) {
                const key = stemKey(rifff.groupId, i + 1)
                if (!ducked.has(key)) {
                  ducked.add(key)
                  addVolume(key, curve)
                }
              }
            })
          }
        } else if (gesture.kind === 'riser') {
          // The preview's one rifff sits on its own groupId channel
          // (buildEngineProject's state.channelOf fallback), so that is the
          // bus this sweep belongs on.
          //
          // With the project's riser variety on (native radio sound plan,
          // Task 6) it draws a character -- Q, colour, stereo, sweep, level
          // and a send into the room -- seeded from its id, as the web
          // radio's risers do. Off, it is today's riser exactly.
          const riser = buildTransitionRiser(rifff.groupId, maxBarLength, bars, {
            variety: normalizeSoundSettings(sound ?? appSoundDefaultsNow()).riserVariety.on,
            armId: gesture.armId
          })
          if (riser) risers[riser.id] = riser
        }
      }
    }
    // THE PHRASE TURNAROUND (@shared/radioTurnaround), as lanes on the lap it plays in: the live
    // project, and a stage landing at a BAR inside that lap (it replaces the live project there,
    // so it must carry the move or the move would vanish mid-lap). Never a stage landing at the
    // wrap: the turnaround ends on that wrap. Its curves are in beats before the wrap;
    // turnaroundToLoopBars puts them on the lap, so they end exactly on the loop top.
    const turnaround =
      radioOnRef.current && (!stage || stage.atBars !== undefined)
        ? radioTurnaroundRef.current
        : null
    if (turnaround !== null && maxBarLength !== undefined && maxBarLength > 0) {
      const ownSend = masterSendRef.current / 100
      for (const curves of turnaround.plan.rows) {
        const own = members.findIndex((m) => m.id === curves.rowId) + 1
        if (own === 0) continue
        const key = stemKey(rifff.groupId, own)
        if (curves.volume) addVolume(key, turnaroundToLoopBars(curves.volume, maxBarLength))
        if (curves.reverbSend) {
          // from the stem's own send (the master send, stemSends below) up to the peak
          const wash = turnaroundToLoopBars(
            turnaroundWashSend(curves.reverbSend, ownSend),
            maxBarLength
          )
          stemAutomation[key] = {
            ...stemAutomation[key],
            reverbSend: combineRadioCurves(
              stemAutomation[key]?.reverbSend ?? [],
              wash,
              'reverbSend'
            )
          }
        }
        if (curves.filter) {
          // A stem already in a change's filter in keeps it, and its low-pass: one filter, one
          // mode, one lap (combineRadioCurves keeps the curve already there).
          const had = stemAutomation[key]?.filterCutoff ?? []
          if (had.length === 0) {
            stemAutomation[key] = {
              ...stemAutomation[key],
              filterCutoff: combineRadioCurves(
                had,
                turnaroundToLoopBars(curves.filter.cutoff, maxBarLength),
                'filterCutoff'
              )
            }
            if (curves.filter.mode === 'highpass') {
              stemFilters[key] = {
                mode: 'highpass',
                cutoff: neutralCutoff('highpass'),
                resonance: 0
              }
            }
          }
        }
      }
      if (turnaround.plan.riserBars !== undefined) {
        const riser = buildTransitionRiser(rifff.groupId, maxBarLength, turnaround.plan.riserBars, {
          variety: normalizeSoundSettings(sound ?? appSoundDefaultsNow()).riserVariety.on,
          armId: turnaround.armId
        })
        if (riser) risers[riser.id] = riser
      }
    }
    for (const [key, shape] of volumeShapes) {
      stemAutomation[key] = { ...stemAutomation[key], volume: underMaster(key, shape) }
    }
```

- [ ] **Step 4: `previewState` carries the high-pass**

In the `const previewState: AppState = { ... }` literal, replace

```ts
      stemAutomation,
      risers,
```

with

```ts
      stemAutomation,
      // A turnaround's lift: the stems it high-passes for the lap (a cutoff curve rising from 0,
      // above). Empty otherwise, which is initialState's own {}, so nothing else changes.
      stemFilters,
      risers,
```

- [ ] **Step 5: Roll, arm, clear, near `clearRadioGesture`**

Directly after the closing `}` of `function clearRadioGesture(): void { ... }`, add:

```ts
  /** The turnaround at a wrap, from the clock effect. The one that played comes off; the wrap
   * that starts a phrase's last lap rolls the next. The roll is DEFERRED one microtask, queued
   * right after densityTick's, so the arc's removal at this wrap (arcExitRef) is decided first --
   * it is the wash's target -- while nothing else has armed the lap yet: the due branch's
   * decision and a landing's arrivals run in microtasks queued later in the same tick. */
  function radioTurnaroundAtWrap(lapStarts: boolean, loopBars: number): void {
    const had = radioTurnaroundRef.current !== null
    radioTurnaroundRef.current = null
    if (!lapStarts) {
      if (had) scheduleSyncPreviewToEngine(previewingSlotIdsRef.current)
      return
    }
    void Promise.resolve().then(() => {
      if (!radioOnRef.current) return
      rollRadioTurnaround(loopBars)
      if (had || radioTurnaroundRef.current !== null) {
        scheduleSyncPreviewToEngine(previewingSlotIdsRef.current)
      }
    })
  }
  /** The phrase end's roll (rollTurnaround). Math.random is passed, not called here (this
   * repo's react-hooks/purity rule). No pushUndoSnapshot: a turnaround is performance, not an
   * edit. A change's own lead-in already armed for this lap keeps it: no roll, and the next
   * phrase end is not "after a turnaround". */
  function rollRadioTurnaround(loopBars: number): void {
    const leadArmed = radioGestureRef.current.some(
      (g) => g.kind !== 'drop-out' && radioGestureLeadsChange(g.kind)
    )
    if (leadArmed) {
      radioTurnaroundMemoryRef.current = null
      return
    }
    const previewing = previewingSlotIdsRef.current
    const lengths = resolvedBarLengthsRef.current
    const plan = rollTurnaround({
      rate: radioSettings.turnarounds,
      random: Math.random,
      loopBars,
      lastPhrase: radioTurnaroundMemoryRef.current,
      rows: slotsRef.current.map((s) => ({
        id: s.id,
        kinds: s.kinds,
        hooked: radioSlotFlagsRef.current[s.id] === 'hook',
        audible: previewing.has(s.id) && lengths.has(s.id),
        inFilterIn: radioGestureRef.current.some(
          (g) => g.slotId === s.id && g.kind === 'filter in'
        ),
        barLength: lengths.get(s.id) ?? loopBars
      })),
      arc:
        radioDensityOf(radioSettings) === 'arc'
          ? turnaroundArc(densityLegRef.current, slotsRef.current.length)
          : 'steady',
      leavingRowId: arcExitRef.current?.slotId ?? null,
      moves: radioSettings.turnaroundMoves,
      depth: radioSettings.turnaroundDepth
    })
    radioTurnaroundMemoryRef.current = rememberTurnaround(plan)
    radioTurnaroundRef.current = plan === null ? null : { plan, armId: newArmId() }
  }
  /** Radio off or a course change: the armed turnaround comes off, and the next phrase end
   * starts fresh. Wherever drop-outs were cleared (clearRadioGesture outside the clock). */
  function clearRadioTurnaround(): void {
    radioTurnaroundMemoryRef.current = null
    if (radioTurnaroundRef.current === null) return
    radioTurnaroundRef.current = null
    scheduleSyncPreviewToEngine(previewingSlotIdsRef.current)
  }
```

- [ ] **Step 6: The clock effect calls it**

Replace

```ts
    // The density arc gets every tick, before any branch below can return.
    densityTick(step.wrapped, pos, loopBars)
```

with

```ts
    // The density arc gets every tick, before any branch below can return.
    densityTick(step.wrapped, pos, loopBars)
    // The phrase turnaround: off at every wrap, rolled on the wrap that starts a phrase's last
    // lap. After densityTick, whose microtask decides the arc's removal at this wrap first.
    if (step.wrapped) radioTurnaroundAtWrap(step.turnaroundLapStarts, loopBars)
```

- [ ] **Step 7: A change on the turnaround's wrap keeps only its arrival**

(a) The early decision in `stepRadioStage`. Replace

```ts
        const changing = slotsRef.current.find((sl) => sl.id === pending.slotId)
        const transition = pickTransition(radioSettings.transitions, changing?.kinds ?? [])
        const beats = radioGestureBeats(transition, pickDropOutBeats)
        setRadioPending(null)
```

with

```ts
        const changing = slotsRef.current.find((sl) => sl.id === pending.slotId)
        // A turnaround armed for this lap ends on the wrap this change waits for: it is the
        // change's lead-in, so the change keeps only an arrival (spec section 3).
        const drawnTransition = pickTransition(radioSettings.transitions, changing?.kinds ?? [])
        const transition =
          radioTurnaroundRef.current !== null
            ? radioTransitionUnderTurnaround(drawnTransition)
            : drawnTransition
        const beats = radioGestureBeats(transition, pickDropOutBeats)
        setRadioPending(null)
```

(b) The due branch. Replace

```ts
        const transition =
          radioGestureRef.current.length === 0
            ? pickTransition(radioSettings.transitions, changing?.kinds ?? [])
            : 'cut'
```

with

```ts
        const drawnTransition =
          radioGestureRef.current.length === 0
            ? pickTransition(radioSettings.transitions, changing?.kinds ?? [])
            : 'cut'
        // Under this lap's turnaround a lead-in would land on its wrap: the turnaround is the
        // change's lead-in, so it keeps only an arrival (spec section 3).
        const transition =
          radioTurnaroundRef.current !== null
            ? radioTransitionUnderTurnaround(drawnTransition)
            : drawnTransition
```

(c) The manual changes' draw (`drawManualTransitions`'s options). Replace

```ts
            // A hole, a riser or a standalone drop-out -- radio's own or an
            // earlier manual one. At most one leading gesture per lap.
            leadingArmed: radioGestureRef.current.some(
              (g) => g.kind === 'drop-out' || radioGestureLeadsChange(g.kind)
            ),
```

with

```ts
            // A hole, a riser or a drop-out -- radio's own or an earlier
            // manual one -- or this lap's turnaround, which is the lap's
            // lead-in. At most one leading gesture per lap.
            leadingArmed:
              radioTurnaroundRef.current !== null ||
              radioGestureRef.current.some(
                (g) => g.kind === 'drop-out' || radioGestureLeadsChange(g.kind)
              ),
```

(d) The dub throws (`radioThrowTick`'s `stepDiscoverThrows` input). Replace

```ts
        leadingArmed: radioGestureRef.current.some(
          (g) => g.kind === 'drop-out' || radioGestureLeadsChange(g.kind)
        ),
        rows: slotsRef.current.map((s) => ({
```

with

```ts
        // A turnaround has the lap, as a hole, a riser or a drop-out does.
        leadingArmed:
          radioTurnaroundRef.current !== null ||
          radioGestureRef.current.some(
            (g) => g.kind === 'drop-out' || radioGestureLeadsChange(g.kind)
          ),
        rows: slotsRef.current.map((s) => ({
```

- [ ] **Step 8: Clear it where drop-outs were cleared**

(a) `stopRadio`. Replace

```ts
    cancelStagedSwap('radio-off')
    clearRadioGesture()
```

with

```ts
    cancelStagedSwap('radio-off')
    clearRadioGesture()
    clearRadioTurnaround()
```

(b) The course change. Replace

```ts
    cancelStagedSwap('course-change')
    clearRadioGesture()
```

with

```ts
    cancelStagedSwap('course-change')
    clearRadioGesture()
    clearRadioTurnaround()
```

(c) The unmount teardown. Replace

```ts
      radioGestureRef.current = []
      radioThrowRef.current = initialDiscoverThrowState()
```

with

```ts
      radioGestureRef.current = []
      radioTurnaroundRef.current = null
      radioTurnaroundMemoryRef.current = null
      radioThrowRef.current = initialDiscoverThrowState()
```

- [ ] **Step 9: The per-interval drop-out goes**

(a) Delete the whole function `rollRadioDropOut`, from its doc comment `  /** The interval's one drop-out roll (rollIntervalDropOut), made wherever` through its closing `  }`.

(b) Delete the whole function `loopBarsAfterLanding`, from its doc comment `  /** The loop length once these rows have turned over -- the preview's` through its closing `  }`. Its only callers are the two below.

(c) In the landing branch's microtask, delete from the comment line

```ts
        // Radio's own change landed (or was dropped at the boundary), so its
```

through the closing `}` of the `if (led !== null && !ledOverridden) { rollRadioDropOut(...) }` block that follows it.

(d) In the due branch's microtask, delete from

```ts
      // Roll ONCE per interval for a drop-out in the coming one -- no
```

through the closing `)` of the `rollRadioDropOut(...)` call that follows it (the call ends with `          : loopBars\n      )`).

(e) Check: `grep -n "rollRadioDropOut\|loopBarsAfterLanding\|rollIntervalDropOut\|radioSettings.dropOuts" src/renderer/src/components/DiscoverPanel.tsx`. Expected: no output.

- [ ] **Step 10: The menu row (`DiscoverRadioMenu.tsx`)**

(a) Imports. Replace

```ts
import { RADIO_DROP_OUT_OPTIONS } from '@shared/radioDropOut'
```

with

```ts
import { RADIO_TURNAROUNDS_OPTIONS } from '@shared/radioTurnaround'
```

(b) `row` takes a tooltip. Replace

```tsx
  function row(label: string, chips: React.JSX.Element[]): React.JSX.Element {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span
          style={{
```

with

```tsx
  function row(label: string, chips: React.JSX.Element[], tooltip?: string): React.JSX.Element {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span
          data-tooltip={tooltip}
          style={{
```

(c) The row. Replace

```tsx
      {mode === 'running' &&
        row(
          'drop-outs',
          RADIO_DROP_OUT_OPTIONS.map((d) =>
            chip(d, settings.dropOuts === d, () => onChange({ dropOuts: d }))
          )
        )}
```

with

```tsx
      {/* The drop-outs row, renamed (2026-10-02, @shared/radioTurnaround): how often a phrase
          end gets a turnaround -- a drop, a wash, a filter move or a riser. Writes the
          deprecated dropOuts mirror too, until the plan's Task 16 deletes it. */}
      {mode === 'running' &&
        row(
          'turnarounds',
          RADIO_TURNAROUNDS_OPTIONS.map((d) =>
            chip(d, settings.turnarounds === d, () => onChange({ turnarounds: d, dropOuts: d }))
          ),
          'end of phrase'
        )}
```

(d) The hint. In the `running` hint string, replace the ending

```ts
density arc grows the rows to four or five and thins them to two or three, only ever removing rows radio added'}
```

with

```ts
density arc grows the rows to four or five and thins them to two or three, only ever removing rows radio added. turnarounds mark the end of each phrase'}
```

- [ ] **Step 11: Verify**

```bash
cd /Users/nickel/Claudecode/sssketch
npm run typecheck
npx eslint src/renderer/src/components/DiscoverPanel.tsx src/renderer/src/components/DiscoverRadioMenu.tsx
npx prettier --check src/renderer/src/components/DiscoverPanel.tsx src/renderer/src/components/DiscoverRadioMenu.tsx
npm run lint
npm test
```
Expected:
- typecheck exits 0, and eslint prints nothing for the two files;
- `prettier --check` passes. If it does not, fix **your** hunks by hand, never by `--write`;
- `npm run lint` shows exactly the 4 baseline prettier warnings, 0 errors;
- `npm test` is green (the only CI-excluded suite is the one `vitest.config.ts` already excludes).

**No agent can hear this or click it**: it is unit-tested only through the shared planner. Say so in the report.

- [ ] **Step 12: Commit**

```bash
cd /Users/nickel/Claudecode/sssketch
git add src/renderer/src/components/DiscoverPanel.tsx src/renderer/src/components/DiscoverRadioMenu.tsx
git commit -m "radio turnarounds Task 14: Discover rolls a turnaround at each phrase's last lap, plays it as lanes (volume multiplies, a lift high-passes), a change on its wrap keeps only its arrival; the drop-outs row is now turnarounds

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 15 (BLOCKED, as Task 14): The menu's `moves` and `depth` rows (sssketch)

**Files:**
- Modify: `src/renderer/src/components/DiscoverRadioMenu.tsx`

- [ ] **Step 1: Imports**

Replace

```ts
import { RADIO_TURNAROUNDS_OPTIONS } from '@shared/radioTurnaround'
```

with

```ts
import {
  RADIO_TURNAROUNDS_OPTIONS,
  TURNAROUND_DEPTH_OPTIONS,
  TURNAROUND_FAMILIES,
  toggleTurnaroundFamily
} from '@shared/radioTurnaround'
```

- [ ] **Step 2: The two rows**

Directly after the `turnarounds` row added in Task 14 (the `{mode === 'running' && row('turnarounds', ...)}` expression), add:

```tsx
      {/* The turnarounds' controls (spec section 4a), only while they are on: which families a
          phrase end may draw (none is off) and how deep they go. */}
      {mode === 'running' &&
        settings.turnarounds !== 'off' &&
        row(
          'moves',
          TURNAROUND_FAMILIES.map((f) =>
            chip(f, settings.turnaroundMoves.includes(f), () =>
              onChange({ turnaroundMoves: toggleTurnaroundFamily(settings.turnaroundMoves, f) })
            )
          ),
          'which moves'
        )}
      {mode === 'running' &&
        settings.turnarounds !== 'off' &&
        row(
          'depth',
          TURNAROUND_DEPTH_OPTIONS.map((d) =>
            chip(d, settings.turnaroundDepth === d, () => onChange({ turnaroundDepth: d }))
          ),
          'how far'
        )}
```

- [ ] **Step 3: Verify**

```bash
cd /Users/nickel/Claudecode/sssketch
npm run typecheck
npx eslint src/renderer/src/components/DiscoverRadioMenu.tsx
npx prettier --check src/renderer/src/components/DiscoverRadioMenu.tsx
npm run lint
```
Expected: typecheck 0; eslint clean; prettier passes (fix your hunks by hand otherwise); lint at the 4-warning baseline.

- [ ] **Step 4: Commit**

```bash
cd /Users/nickel/Claudecode/sssketch
git add src/renderer/src/components/DiscoverRadioMenu.tsx
git commit -m "radio turnarounds Task 15: the radio menu's moves and depth rows, shown while turnarounds are on

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 16: Remove the dead drop-out code and the compatibility mirror (both repos; needs 14 and 15)

Neither radio calls `rollIntervalDropOut` or `shouldScheduleDropOut` any more (Tasks 10 and 14), and nothing reads `dropOuts`. Only `pickDropOutBeats` and `buildDropOutCurve` stay in `radioDropOut.ts`: a hole, the arc's exit and every turnaround drop are made of them. `normalizeRadioSettings` takes the spec's order: `turnarounds`, then an old `dropOuts` when `turnarounds` is missing.

**Files:**
- Modify: `src/shared/radioDropOut.ts`, `src/shared/radioDropOut.test.ts`, `src/shared/radioSchedule.ts`, `src/shared/radioSchedule.test.ts`, `src/shared/radioTurnaroundSettings.test.ts`, `src/shared/radioTransition.ts` (a comment), `src/main/discoverSettingsStore.test.ts`, `src/renderer/src/components/DiscoverRadioMenu.tsx`
- Radio: modify `src/radio/settings.ts`, `src/radio/settings.test.ts`, `src/smoke.test.ts`

- [ ] **Step 1: Make sure nothing else calls the dead code**

```bash
cd /Users/nickel/Claudecode/sssketch
grep -rn "rollIntervalDropOut\|shouldScheduleDropOut\|pickDropOutSlotId\|RADIO_DROP_OUT\|DEFAULT_RADIO_DROP_OUTS\|normalizeRadioDropOuts\|DropOutCandidate\|DROP_OUT_ELIGIBLE_KINDS\|IntervalDropOut\|RadioDropOuts" src --include='*.ts' --include='*.tsx' | grep -v "^src/shared/radioDropOut"
grep -rn "\.dropOuts\|dropOuts:" src --include='*.ts' --include='*.tsx'
cd /Users/nickel/Claudecode/ell.ing/radio
grep -rn "rollIntervalDropOut\|shouldScheduleDropOut\|dropOuts" src scripts server spike 2>/dev/null
```

Expected:
- sssketch first grep: only `src/shared/radioSchedule.ts` (`import type { RadioDropOuts }` and the `dropOuts: RadioDropOuts` field).
- sssketch second grep: `radioSchedule.ts` (the mirror), `radioSchedule.test.ts`, `radioTurnaroundSettings.test.ts`, `discoverSettingsStore.test.ts`, and `DiscoverRadioMenu.tsx`'s `dropOuts: d`.
- radio: `src/smoke.test.ts` (`shouldScheduleDropOut`) and `src/radio/settings.ts` / `settings.test.ts` (`dropOuts`).

Anything else is a caller this plan missed. Stop, and move it to `turnarounds` first.

- [ ] **Step 2: `src/shared/radioDropOut.ts`**

Replace everything from the top of the file down to, but not including, the doc comment `/** How long, in beats. Weighted rather than fixed for the same reason the` with:

```ts
// src/shared/radioDropOut.ts
//
// The two pieces of radio's standalone drop-out that outlived it: how long a drop is
// (pickDropOutBeats) and the curve that plays it (buildDropOutCurve). The drop-out itself --
// one layer muted for a few beats now and then (docs/superpowers/specs/2026-09-28-radio-
// controls-design.md section 4) -- became one move of the phrase turnaround on 2026-10-02
// (radioTurnaround.ts; docs/superpowers/specs/2026-10-02-radio-turnarounds-design.md). A hole,
// the density arc's exit and every turnaround drop are made of these two.
//
// Pure, with its randomness injected.
import type { AutomationPoint } from './toolkit'

```

Keep `DROP_OUT_BEAT_WEIGHTS`, `pickDropOutBeats`, `BEATS_PER_BAR`, `DROP_OUT_RAMP_BARS` and `buildDropOutCurve`, with their comments, **unchanged**. Then delete everything after `buildDropOutCurve`'s closing `}`: `CLEAR_OF_WRAP_BARS`, `IntervalDropOutInput`, `IntervalDropOut` and `rollIntervalDropOut`, with their comments. Afterwards the file exports exactly `pickDropOutBeats` and `buildDropOutCurve`.

- [ ] **Step 3: `src/shared/radioDropOut.test.ts`**

Replace the import block at the top with:

```ts
import { describe, expect, it } from 'vitest'
import { buildDropOutCurve, pickDropOutBeats } from './radioDropOut'
```

Keep the `seeded` helper and the two blocks `describe('how long a drop-out is', ...)` and `describe('the drop-out curve', ...)` unchanged. Delete every other `describe` block (`'drop-out rate'`, `'which layer drops out'`, `'the interval roll'`, `'drop-outs happen at the documented rate when every change is decided early'`), along with the `mulberry32` helper and the `BED` constant they used.

- [ ] **Step 4: `src/shared/radioSchedule.ts` and its tests**

(a) Delete the line `import type { RadioDropOuts } from './radioDropOut'`.

(b) `RadioSettings`: delete

```ts
  /** DEPRECATED: equal to `turnarounds` (normalizeRadioSettings keeps it so). Kept only while
   * the shipped DiscoverRadioMenu and DiscoverPanel still read and write it -- the radio
   * turnarounds plan's Task 14 moves them over, and its Task 16 deletes this field. */
  dropOuts: RadioDropOuts
```

(c) `DEFAULT_RADIO_SETTINGS`: delete `  dropOuts: DEFAULT_RADIO_TURNAROUNDS,`.

(d) `normalizeRadioSettings`. Replace

```ts
  // Turnarounds absorbed drop-outs. Until the plan's Task 16 the shipped menu writes only
  // `dropOuts`, so it is read FIRST -- whenever the two differ it is the newer -- and
  // `turnarounds` is the fallback. Task 16 flips this to the spec's order.
  const turnarounds = normalizeRadioTurnarounds(raw.dropOuts, raw.turnarounds)
```

with

```ts
  // Turnarounds absorbed drop-outs (2026-10-02): an old saved `dropOuts` is read only when
  // there is no `turnarounds`, so a choice made before the rename carries over.
  const turnarounds = normalizeRadioTurnarounds(
    raw.turnarounds,
    (value as { dropOuts?: unknown } | null)?.dropOuts
  )
```

and replace

```ts
    turnarounds,
    dropOuts: turnarounds,
```

with

```ts
    turnarounds,
```

(e) `src/shared/radioSchedule.test.ts`, the default-settings literal: delete `      dropOuts: 'rare',`.

(f) `src/main/discoverSettingsStore.test.ts`, `'round-trips every radio setting'`: delete the `dropOuts: 'often',` line in both objects.

(g) `src/shared/radioTurnaroundSettings.test.ts`: replace the whole first block, `describe('RadioSettings.turnarounds', ...)`, with:

```ts
describe('RadioSettings.turnarounds', () => {
  it('defaults to rare, and there is no dropOuts field any more', () => {
    expect(DEFAULT_RADIO_SETTINGS.turnarounds).toBe('rare')
    expect(DEFAULT_RADIO_SETTINGS).not.toHaveProperty('dropOuts')
    expect(normalizeRadioSettings({})).not.toHaveProperty('dropOuts')
  })

  it('carries an old drop-outs choice over when there is no turnarounds value', () => {
    expect(normalizeRadioSettings({ dropOuts: 'often' }).turnarounds).toBe('often')
    expect(normalizeRadioSettings({ dropOuts: 'off' }).turnarounds).toBe('off')
  })

  it('a turnarounds value wins over an old drop-outs one', () => {
    expect(normalizeRadioSettings({ turnarounds: 'rare', dropOuts: 'off' }).turnarounds).toBe('rare')
  })

  it('falls back to rare for junk', () => {
    expect(normalizeRadioSettings({ turnarounds: 'loud', dropOuts: 3 }).turnarounds).toBe('rare')
  })
})
```

- [ ] **Step 5: Two leftovers**

(a) `src/renderer/src/components/DiscoverRadioMenu.tsx`. Replace

```tsx
      {/* The drop-outs row, renamed (2026-10-02, @shared/radioTurnaround): how often a phrase
          end gets a turnaround -- a drop, a wash, a filter move or a riser. Writes the
          deprecated dropOuts mirror too, until the plan's Task 16 deletes it. */}
```

with

```tsx
      {/* The drop-outs row, renamed (2026-10-02, @shared/radioTurnaround): how often a phrase
          end gets a turnaround -- a drop, a wash, a filter move or a riser. */}
```

and replace `onChange({ turnarounds: d, dropOuts: d })` with `onChange({ turnarounds: d })`.

(b) `src/shared/radioTransition.ts`, in `tableFor`'s doc comment, replace `eligible kind wins" reading radioDropOut's own weighting uses. The four` with `eligible kind wins" reading the old drop-out weighting used. The four`.

- [ ] **Step 6: The web radio**

- `src/radio/settings.ts`:
  - delete the header row `//   drop-outs     dropOuts                'often'   :286 (deprecated mirror; goes in the plan's Task 16)`;
  - in `WEB_RADIO_DEFAULTS`, delete `  dropOuts: 'often',`.
- `src/radio/settings.test.ts`: delete `      dropOuts: 'often', // drop-outs: often (deprecated mirror)`.
- `src/smoke.test.ts`:
  - replace `import { shouldScheduleDropOut } from '@shared/radioDropOut'` with

    ```ts
    import { pickDropOutBeats } from '@shared/radioDropOut'
    import { rollTurnaround } from '@shared/radioTurnaround'
    ```

  - replace `    ['radioDropOut', shouldScheduleDropOut],` with

    ```ts
        ['radioDropOut', pickDropOutBeats],
        ['radioTurnaround', rollTurnaround],
    ```

- [ ] **Step 7: Verify both repos**

```bash
cd /Users/nickel/Claudecode/sssketch
npx prettier --write src/shared/radioDropOut.ts src/shared/radioDropOut.test.ts src/shared/radioSchedule.ts src/shared/radioSchedule.test.ts src/shared/radioTurnaroundSettings.test.ts src/shared/radioTransition.ts src/main/discoverSettingsStore.test.ts
npx eslint src/shared/radioDropOut.ts src/shared/radioDropOut.test.ts src/shared/radioSchedule.ts src/shared/radioSchedule.test.ts src/shared/radioTurnaroundSettings.test.ts src/shared/radioTransition.ts src/main/discoverSettingsStore.test.ts src/renderer/src/components/DiscoverRadioMenu.tsx
npx prettier --check src/renderer/src/components/DiscoverRadioMenu.tsx
npm run typecheck && npm run lint && npm test
grep -rn "dropOuts\|rollIntervalDropOut\|shouldScheduleDropOut" src --include='*.ts' --include='*.tsx'
cd /Users/nickel/Claudecode/ell.ing/radio
npm run typecheck && npm test && npm run build
grep -rn "dropOuts\|rollIntervalDropOut\|shouldScheduleDropOut" src
```

Expected:
- everything green, and lint at the 4-warning baseline;
- the sssketch grep finds only the legacy read in `radioSchedule.ts` (`?.dropOuts`) and the migration tests (`radioTurnaroundSettings.test.ts`, `discoverSettingsStore.test.ts`'s `'carries a saved drop-outs choice over to turnarounds'`);
- the radio grep finds nothing.

- [ ] **Step 8: Commit, per repo**

```bash
cd /Users/nickel/Claudecode/sssketch
git add src/shared/radioDropOut.ts src/shared/radioDropOut.test.ts src/shared/radioSchedule.ts src/shared/radioSchedule.test.ts src/shared/radioTurnaroundSettings.test.ts src/shared/radioTransition.ts src/main/discoverSettingsStore.test.ts src/renderer/src/components/DiscoverRadioMenu.tsx
git commit -m "radio turnarounds Task 16: the per-interval drop-out and the dropOuts mirror go; an old dropOuts is read only when turnarounds is missing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
cd /Users/nickel/Claudecode/ell.ing/radio
git add src/radio/settings.ts src/radio/settings.test.ts src/smoke.test.ts
git commit -m "radio: dropOuts gone from the defaults; the smoke test reaches radioTurnaround

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 17: Full verification, and Elling's listening walkthrough

No agent can hear either radio, see either UI or hold a phone. This task proves what can be proved, and hands the rest to Elling plainly.

- [ ] **Step 1: sssketch, the whole thing**

```bash
cd /Users/nickel/Claudecode/sssketch
npm run typecheck
npm run lint        # exactly the 4 pre-existing prettier warnings, 0 errors
npm test
git status --short  # nothing of this plan's left unstaged
```

No native-engine change was made, so there is no engine rebuild. (`cmake --build` is only needed for `native-engine/Source` edits.)

- [ ] **Step 2: ell.ing/radio, the whole thing**

```bash
cd /Users/nickel/Claudecode/ell.ing/radio
npm run typecheck
npm test
npm run build
node spike/engine-check/run.mjs turnaround,transitions,removeExit,swapOnset,riserCharacters,rowPan
git status --short
```
Expected: green, and every listed check `"pass": true`.

- [ ] **Step 3: Check the spec against the code**

Go through spec §1–§5 and §4a and point at the test or the line for each point:
- `turnaroundPhraseLaps` (16 or 32 bars, 0 counts as 16, rounding up, at least 1 lap);
- the count runs whatever `phraseBars` is;
- the roll happens at the start of the last lap;
- the rates (1/3, 2/3), never twice in a row, and diminution (at most two halvings, never under 1 beat);
- every move ends on the one, with the cap of min(half the loop, 4 bars) and a move out of the draw when its shortest length does not fit;
- each move's rows: the stop's keeper, low drop takes all drums and bass, the wash's leaving row, filter moves skip a filter in;
- the guards;
- the weights table, with thinning dropping nothing;
- the change on the same wrap (radio's and manual) keeps only its arrival;
- the merge rules: volume multiplies, send takes the max, a filter in keeps its lane;
- the arc exit is unchanged;
- clearing at hold, pause, seek and off;
- the settings migration and defaults (sssketch `rare`, web `often`), the menu row and its tooltip;
- §5's shared API (opaque ids, beats before the wrap, the arc as an input, injected randomness);
- the web nodes, `applyTurnaround` and its cancellation;
- §4a's controls.

If one has no test or no code, it is a gap. Fix it before reporting.

- [ ] **Step 4: Report to Elling, with this walkthrough**

On **both** radios: sssketch is `npm run dev` with Discover radio on, and ell.ing/radio is `npm run dev` (or the dev engine). On ell.ing/radio check both simple and full mode.

1. With turnarounds `often` (the web radio is always `often`), phrase ends are audible. Every 16 bars by default, something marks the end: a drop, a wash, a lift or a dip, or a riser.
2. Each move ends exactly on the one. Everything comes back together on the downbeat, not a beat late.
3. Moves follow the density arc. Lifts, risers and drops come while the mix grows, and only washes and dips come while it thins (no row drops out and comes back while thinning).
4. A layer change on a phrase end is led in by the turnaround. Nothing hole-then-riser'd on top of it: the change arrives with its cut, filter in, bloom or duck.
5. Old drop-out settings carried over. sssketch's menu now says `turnarounds` with the old choice lit, and its tooltip is `end of phrase`.
6. `off` (sssketch), or every family switched off (web full mode), is silent: no turnarounds.
7. Controls:
   - in sssketch, the `moves` and `depth` rows show while turnarounds are on;
   - in web full mode, the four family toggles and the depth toggle sit beside saturation, pump and echo, are remembered after a reload, and simple mode shows nothing new;
   - `subtle` is gentler and never longer than a bar.
8. Nothing regressed: a duck, a hole and the arc's exit still sound as before, and they stack with a turnaround rather than one cancelling the other. The dub throws never land on a turnaround lap.

Say plainly that none of this was heard by an agent. Ask Elling to tune `TURNAROUND_CHANCE` and the weights by ear (spec §0: "a guess to tune by ear").
