# Radio Fold Follows Pace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fold mode follows the pace slider in both radios. At 50 and below it is exactly as it is
today. Above 50 its cadence speeds up to the slider's own by 80, its machine hurries above 70, and
from 80 changes land mid-loop: first on the rows the fold is not holding (phase 1), then on the
folded rows too, carrying their fold (phase 2).

**Spec:** `docs/superpowers/specs/2026-10-03-radio-fold-follows-pace-design.md`. Read it first. Its
table, its section 4 gate list, its timing risks (section 9) and its flags are the review checklist.

**Architecture:**
- **One shared fold profile.** `radioFoldPaceProfile` in `radioPace.ts`.
- **One cadence reader.** `radioCadenceOf`, as for the slider, with three new fields:
  `foldPaced`, `foldPreferWaitLaps` and `foldHurry`.
- **A hurry input** to `stepRadioFold`.
- **Pure helpers in `radioFold.ts`:** hold, carry and release.
- **The runtimes only wire them in.** The engines need no change: the native `CycleTable` is
  keyed by row, and the web needs a `carry` flag on `Timeline.swap` / `swapAt`.

**The build runs in three phases:**
1. the cadence, the hurry, and phase-1 mid-loop (Tasks 1-6);
2. carrying folds through changes (Tasks 7-11);
3. optional: the arc-owned top, gate 6 (Task 12).

Task 13 is the cross-repo verification.

**Tech Stack:** TypeScript and vitest (both repos), React and Electron (sssketch), plain DOM and
Web Audio (ell.ing/radio), JUCE `UnitTestRunner` (native).

**Repos:**
- **sssketch** (`/Users/nickel/Claudecode/sssketch`):
  - Tasks 1, 2, 3, 5, 6 (shared and desktop parts), 7, 8, 11 and 13.
  - Base: `master` at `8c07793`, plus whatever pace Task 9 and combos Task 5 commit first.
- **ell.ing/radio** (`/Users/nickel/Claudecode/ell.ing/radio`):
  - Tasks 4, 6 (web part), 9, 10 and 12.
  - Base: `main` at `230398d`, plus pace Task 5 follow-ups, pace Task 8 and combos Tasks 3-4,
    once committed.
- **How the two connect.** The web imports sssketch's `src/shared` through `@shared`, from
  sssketch's **working tree** (or `SSSKETCH_DIR`).

**Branches:** `radio-fold-follows-pace` in each repo (`git switch -c radio-fold-follows-pace`).
Branch from the tip after the concurrent tasks below are in.

**Commits:** every commit message ends with exactly these two lines, after a blank line:

```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz
```

Commit each task's own files only (`git add <paths>`), never `git add -A`: other agents share these
working trees.

**Before you start, in both repos:**
- Run `git status --short`. Note other agents' files and leave them alone.
- **sssketch:** run `npm test`, which should be green except the machine-dependent engine-spawn
  tests (memory: coreaudiod).
- **ell.ing/radio:** run `npx vitest run`, which should be green.
- **The diffs** in this plan were made against sssketch `8c07793` and ell.ing/radio `230398d`. If a
  file has moved on since, make the same edits by hand, anchored on the quoted context and the
  function names, never on line numbers.

---

## How this plan's code was checked

Planning scratchpad: `/private/tmp/claude-501/-Users-nickel-Claudecode-sssketch/16705ad5-406f-4f11-81e4-e91aab27bbc8/scratchpad/`
(`fold-pace/` is sssketch's `src/shared`; `webcopy/` is ell.ing/radio at `230398d` with `@shared`
pointed at it).

- **Shared, Tasks 1, 2, 3, 6 (shared part) and 7:**
  - applied to a copy of `src/shared`;
  - `tsc` (with `noUnusedLocals`) gave 0 errors;
  - `npx vitest run src/shared` gave 2423 passed, plus the 3 new files; 3 files could not load in
    the copy (they import `src/renderer`);
  - `prettier --check` and `eslint` with the repo's own configs were clean.
- **The pinned hash** of the fold machine (`0540eeea`) was computed from the **unmodified**
  `radioFold.ts` at `8c07793`, and reproduced with the hurry code, both with no hurry and with
  hurry 0.
- **Web, Task 4.** Applied to `step.ts` / `step.test.ts` at `230398d`:
  - `npm run typecheck` (main config) gave 0 errors;
  - `npx vitest run src/radio src/audio` gave 483 passed.
  - **A harness** comparing the action log of HEAD's `step.ts` with the new one, both over the new
    shared code, was **byte-identical** at no level, 0, 25 and 50, fold on and off, 2 seeds and
    400 s each.
  - **Measured** at bend 80, 5 rows and a 4-bar loop: 51, 37, 23, 13, 8, 8, 8, 8, 4, 2 and 2 s
    between changes at levels 50 to 100. No mid-loop landing went to a held row (4 seeds, 10
    minutes each, at 95).
- **Web, Task 9 (timeline only).** `carryAssign` passed 4 scratch tests, including a carried
  take-back that plays seamlessly (`xfade`), and the existing `timeline` and `schedule` suites.
  `engine.ts` and `controller.ts` were not compiled.
- **Not compiled, written as precise instructions:**
  - the desktop tasks (5, 11), because `DiscoverPanel.tsx` is under concurrent edit;
  - the native test (Task 8);
  - web Task 10;
  - the UI parts of Task 6.

## Decisions made in planning (the spec's flags are the ones for Elling)

1. **Fold's knots.** 50: 8-32, 60: 4-12, 70: 2-4, 80: 1-2 (the slider's own at 80). The
   preference is 2 laps up to 60, 1 up to 70, and 0 above. The hurry is linear from 0 at 70 to 1 at
   100.
2. **At 50 and below, fold returns literally today's values.** `radioFoldPaceProfile` does not
   interpolate there, so no rounding can creep in.
3. **The `RadioCadence` fields are required, not optional.** Both runtimes read `radioCadenceOf`
   only, and the one test that builds a cadence by `toEqual` is updated (Task 3).
4. **Phase 1's two helpers** (`radioCadenceBarEvery`, `radioFoldPickableIds`) are removed from the
   runtimes in phase 2 (Tasks 10, 11), and deleted from shared in Task 13 if nothing uses them.
5. **Carry is decided at the decision and rides the change** (`carry` / `foldCarry`). The machine is
   re-pointed at the landing. The "at least as long as the old stem" rule is what makes the gap
   between them safe (spec section 3).
6. **Native:** no engine change is expected for carry. Task 8 is a test first. If it fails, the
   minimal fix is in `PlaybackEngine::renderBlock`'s cycle path, and that is the task.

## File map

**sssketch**
- **Modify:**
  - `src/shared/radioPace.ts` (Tasks 1, 6);
  - `src/shared/radioFold.ts` (Tasks 2, 7);
  - `src/shared/radioSchedule.ts` (Task 3);
  - `src/shared/radioFoldLanes.ts` (Task 7);
  - `src/shared/radioCadence.test.ts` (Task 3).
- **Create:**
  - `src/shared/radioFoldPace.test.ts` (Tasks 1, 3, 6);
  - `src/shared/radioFoldHurry.test.ts` (Task 2);
  - `src/shared/radioFoldCarry.test.ts` (Task 7).
- **Modify `src/renderer/src/components/DiscoverPanel.tsx`** (Tasks 5, 11).
- **Modify `src/renderer/src/components/DiscoverRadioMenu.tsx`** (Task 6).
- **Modify `native-engine/Source/PlaybackEngineTests.cpp`** (Task 8).

**ell.ing/radio**
- `src/radio/step.ts` and `src/radio/step.test.ts` (Tasks 4, 10, 12).
- `src/audio/timeline.ts`, `src/audio/timeline.test.ts`, `src/audio/engine.ts` and
  `src/radio/controller.ts` (Task 9).
- `src/ui/fullModel.ts` and `src/ui/full.ts` (Task 6).

## Task graph, and the work already running

```
T1 fold profile ─┐
T2 fold machine ─┼─> T3 cadence ─┬─> T4 web phase 1 ──────────┐
                 │               ├─> T5 desktop phase 1 ──────┤
                 │               └─> T6 the label (both) ─────┤   ship point A
T7 carry helpers (after T2) ─┬─> T9 web timeline carry ─> T10 web phase 2 ──┐
                             └─> T8 native test ───────> T11 desktop phase 2 ┤   ship point B
                                               T12 (optional, after T10) ───┤
                                                        all ─> T13 verify + handoff
```

**Overlaps with the tasks other agents are running or still have queued:**

| this plan | its files | pace Task 8 (web `step.ts`, `step.test.ts`) | pace Task 9 (`DiscoverPanel.tsx`) | combos Task 2 (`radioReadout.ts`) | combos Task 3 (web `audio/turnaround.ts`; the working tree also has `audio/engine.ts` and `gestures.ts` changed) | combos Task 4 (web `step.ts`, `controller.ts`, `step.test.ts`) | combos Task 5 (`DiscoverPanel.tsx`) |
|---|---|---|---|---|---|---|---|
| T1, T2, T7 | shared `radioPace`, `radioFold`, `radioFoldLanes` + new tests | – | – | – | – | – | – |
| T3 | shared `radioSchedule`, `radioCadence.test` + new test | **changes the web's behaviour through `@shared`** (see below) | changes the desktop's behaviour the same way | – | – | the same | – |
| T4 | web `step.ts`, `step.test.ts` | **same files: after it** | – | – | – | **same files: after it** | – |
| T5 | `DiscoverPanel.tsx` | – | **same file: after it** | – | – | – | **same file: after it** |
| T6 | `radioPace.ts`, web `ui/full*.ts`, `DiscoverRadioMenu.tsx` | – | – | – | – | – | – |
| T8 | `PlaybackEngineTests.cpp` | – | – | – | – | – | – |
| T9 | web `audio/timeline.ts`, `audio/engine.ts`, `radio/controller.ts` | – | – | – | **`engine.ts` is dirty in the working tree: after combos Task 3 commits** | **`controller.ts`: after it** | – |
| T10, T12 | web `step.ts`, `step.test.ts` | after it | – | – | – | after it | – |
| T11 | `DiscoverPanel.tsx` | – | after it | – | – | – | after it |

- **T1, T2 and T7 can run now**, in parallel with everything else. They are additive and inert: no
  caller passes the new arguments yet.
- **T3 changes both radios' fold behaviour the moment it is in sssketch's working tree.** The web
  reads `@shared` from it. It turns three web tests red (the ones Task 4 rewrites) and gives the web
  mid-loop landings on folded rows before Task 4's held check exists. So **land T3 only when Task 4
  can follow at once**: after pace Task 8 and combos Task 4 have committed `step.ts`, so that their
  agents never see the three red tests. Don't deploy the web between T3 and T4.
- **Strictly in order:**
  - T4, then T10, then T12 (one file);
  - T5, then T11 (one file);
  - T7, then T9, then T10;
  - T7, then T8, then T11.
- **In parallel:** T4 with T5 (different repos), T9 with T8, T10 with T11.
- **Ship points** (Elling listens; deploy only with his go-ahead):
  - **A**, after T4, T5 and T6: fold fast at the top, folded layers holding.
  - **B**, after T10 and T11: folded layers carried through changes.

---

### Task 1: Fold's pace profile (`radioPace.ts`)

**Files:**
- Modify: `/Users/nickel/Claudecode/sssketch/src/shared/radioPace.ts`
- Create: `/Users/nickel/Claudecode/sssketch/src/shared/radioFoldPace.test.ts`

- [ ] **Step 1: Write the failing test.** Create `src/shared/radioFoldPace.test.ts`:

```ts
// Fold mode follows the pace slider (spec 2026-10-03-radio-fold-follows-pace-design.md): the
// profile (radioPace.ts) and the cadence it gives (radioSchedule.ts).
import { describe, expect, it } from 'vitest'
import {
  RADIO_FOLD_PACE_FROM,
  RADIO_FOLD_PACE_JOINS,
  RADIO_FOLD_PACE_WINDOW_KNOTS,
  radioFoldPaceProfile,
  radioPaceProfile
} from './radioPace'
import { FOLD_PACE_BARS, FOLD_PREFER_WAIT_LAPS } from './radioFold'

describe('radioFoldPaceProfile', () => {
  it('its first knot is FOLD_PACE_BARS and its preference FOLD_PREFER_WAIT_LAPS', () => {
    const [l, min, max] = RADIO_FOLD_PACE_WINDOW_KNOTS[0]
    expect(l).toBe(RADIO_FOLD_PACE_FROM)
    expect({ min, max }).toEqual(FOLD_PACE_BARS)
    expect(radioFoldPaceProfile(0).preferWaitLaps).toBe(FOLD_PREFER_WAIT_LAPS)
  })

  it('at or below fast: fold mode as it was, whatever the level', () => {
    for (let level = 0; level <= RADIO_FOLD_PACE_FROM; level++) {
      const p = radioFoldPaceProfile(level)
      expect(p.window).toEqual(FOLD_PACE_BARS)
      expect(p.phraseCap).toBeNull()
      expect(p.barEvery).toBeNull()
      expect(p.rows).toBe(1)
      expect(p.preferWaitLaps).toBe(FOLD_PREFER_WAIT_LAPS)
      expect(p.hurry).toBe(0)
    }
  })

  it('both window edges never grow with the level, never pass the slider, and meet it at 80', () => {
    for (let level = 1; level <= 100; level++) {
      const a = radioFoldPaceProfile(level - 1).window
      const b = radioFoldPaceProfile(level).window
      expect(b.min).toBeLessThanOrEqual(a.min)
      expect(b.max).toBeLessThanOrEqual(a.max)
      expect(b.min).toBeGreaterThanOrEqual(1)
      if (level > RADIO_FOLD_PACE_FROM) {
        expect(b.max).toBeGreaterThanOrEqual(radioPaceProfile(level).window.max)
        expect(b.min).toBeGreaterThanOrEqual(radioPaceProfile(level).window.min)
      }
    }
    for (let level = RADIO_FOLD_PACE_JOINS; level <= 100; level++) {
      const { preferWaitLaps, hurry, ...rest } = radioFoldPaceProfile(level)
      expect(rest).toEqual(radioPaceProfile(level))
      expect(preferWaitLaps).toBe(0)
      expect(hurry).toBeGreaterThan(0)
    }
  })

  it('the realignment preference fades 2 -> 1 -> 0, gone above 70; the hurry starts above 70', () => {
    expect(radioFoldPaceProfile(60).preferWaitLaps).toBe(2)
    expect(radioFoldPaceProfile(61).preferWaitLaps).toBe(1)
    expect(radioFoldPaceProfile(70).preferWaitLaps).toBe(1)
    expect(radioFoldPaceProfile(71).preferWaitLaps).toBe(0)
    expect(radioFoldPaceProfile(70).hurry).toBe(0)
    expect(radioFoldPaceProfile(85).hurry).toBeCloseTo(0.5)
    expect(radioFoldPaceProfile(100).hurry).toBe(1)
  })
})
```

- [ ] **Step 2: Run it and watch it fail.**
  - Run: `npx vitest run src/shared/radioFoldPace.test.ts`
  - Expected: FAIL, because `radioFoldPaceProfile` and its constants are not exported.

- [ ] **Step 3: Implement.** In `src/shared/radioPace.ts`:

  a. Let `windowAt` take its knots (replace its first two lines):

```ts
function windowAt(
  level: number,
  knots: readonly (readonly [number, number, number])[] = RADIO_PACE_WINDOW_KNOTS
): { min: number; max: number } {
```

  (Delete the old `const knots = RADIO_PACE_WINDOW_KNOTS` line. The body is unchanged.)

  b. Append at the end of the file:

```ts
// ---- fold mode follows the slider (docs/superpowers/specs/2026-10-03-radio-fold-follows-pace-design.md)

/** At or below this level fold mode keeps its own cadence exactly: FOLD_PACE_BARS (8-32), the
 * runtime's phrase, the realignment preference, one row, the fold machine unhurried. */
export const RADIO_FOLD_PACE_FROM = RADIO_PACE_ANCHORS.fast
/** At or above this level fold mode's change cadence IS the slider's (window, phrase, bar band,
 * rows); only the folded rows themselves differ (radioCadenceBarEvery). */
export const RADIO_FOLD_PACE_JOINS = 80
/** Fold's window above RADIO_FOLD_PACE_FROM: [level, min, max], geometric between knots like the
 * slider's. The first is FOLD_PACE_BARS (radioFold.ts; pinned equal by test, since this module
 * imports nothing at runtime); the last is the slider's own window at RADIO_FOLD_PACE_JOINS. */
export const RADIO_FOLD_PACE_WINDOW_KNOTS: readonly (readonly [number, number, number])[] =
  Object.freeze([
    [50, 8, 32],
    [60, 4, 12],
    [70, 2, 4],
    [80, 1, 2]
  ] as const)
/** The laps a change may wait past its draw for a realignment top (radioFoldIntervalBars): fold's
 * FOLD_PREFER_WAIT_LAPS (2) up to 60, 1 up to 70, none above -- "impolite" from the band where
 * every loop top is a landing. */
export const RADIO_FOLD_PREFER_WAIT_BANDS: readonly (readonly [number, number])[] = Object.freeze([
  [60, 2],
  [70, 1]
] as const)
/** The fold machine hurries above this level (radioFold's `hurry`, 0 here, 1 at 100). */
export const RADIO_FOLD_HURRY_FROM = 70

export interface RadioFoldPaceProfile extends RadioPaceProfile {
  /** Laps a change may wait for a realignment top. */
  preferWaitLaps: number
  /** 0..1: how much the fold machine's own timers shorten (stepRadioFold's `hurry`). */
  hurry: number
}

/** Fold mode's cadence at `level`. At or below RADIO_FOLD_PACE_FROM, fold's own exactly (8-32 bars,
 * no phrase cap, one row, a 2-lap realignment preference, no hurry) whatever the level, as before
 * the slider reached fold. Above, the window shrinks along RADIO_FOLD_PACE_WINDOW_KNOTS, the phrase
 * cap and rows are the slider's, the preference fades out by 71; from RADIO_FOLD_PACE_JOINS
 * everything but the hurry is the slider's profile, bar band included. Pure, no randomness. */
export function radioFoldPaceProfile(level: number): RadioFoldPaceProfile {
  const pace = radioPaceProfile(level)
  const p = pace.level
  if (p <= RADIO_FOLD_PACE_FROM) {
    return {
      level: p,
      window: { min: 8, max: 32 },
      phraseCap: null,
      barEvery: null,
      rows: 1,
      preferWaitLaps: 2,
      hurry: 0
    }
  }
  let preferWaitLaps = 0
  for (const [upTo, laps] of RADIO_FOLD_PREFER_WAIT_BANDS) {
    if (p <= upTo) {
      preferWaitLaps = laps
      break
    }
  }
  const hurry = Math.max(
    0,
    (p - RADIO_FOLD_HURRY_FROM) / (RADIO_PACE_LEVEL_MAX - RADIO_FOLD_HURRY_FROM)
  )
  const window =
    p >= RADIO_FOLD_PACE_JOINS ? pace.window : windowAt(p, RADIO_FOLD_PACE_WINDOW_KNOTS)
  return { ...pace, window: { ...window }, preferWaitLaps, hurry }
}
```

- [ ] **Step 4: Run it and watch it pass.**
  - Run: `npx vitest run src/shared/radioFoldPace.test.ts src/shared/radioPace.test.ts`
  - Expected: PASS. `radioPace.test.ts` is unchanged: the default knots keep `windowAt` as it was.

- [ ] **Step 5: Lint, typecheck, commit.**
  - Run: `npx eslint src/shared/radioPace.ts src/shared/radioFoldPace.test.ts` and
    `npm run typecheck`.
  - Commit: `git add src/shared/radioPace.ts src/shared/radioFoldPace.test.ts && git commit`.
  - Message: `radio fold follows pace: the shared profile -- fold's own 8-32 at 50 and below, its window shrinking to the slider's by 80 (knots 8-32, 4-12, 2-4, 1-2), the slider's phrase caps and rows above 50, the realignment preference 2/1/0 laps (gone above 70), a hurry from 0 at 70 to 1 at 100`, then the trailer.

### Task 2: The fold machine (`radioFold.ts`): the preference as an argument, the hurry, the held rows

**Files:**
- Modify: `/Users/nickel/Claudecode/sssketch/src/shared/radioFold.ts`
- Create: `/Users/nickel/Claudecode/sssketch/src/shared/radioFoldHurry.test.ts`

- [ ] **Step 1: Write the failing test.** Create `src/shared/radioFoldHurry.test.ts`:

```ts
// Fold mode follows the pace slider: the machine's side (radioFold.ts) -- the realignment
// preference as an argument, the hurry, and the rows it holds.
import { describe, expect, it } from 'vitest'
import {
  FOLD_PREFER_WAIT_LAPS,
  createRadioFold,
  radioFoldHoldsRow,
  radioFoldIntervalBars,
  radioFoldPickableIds,
  stepRadioFold,
  type RadioFoldRow,
  type RadioFoldStep
} from './radioFold'
import { hashText, seededRandom } from './seededRandom'

const R = (id: string, o: Partial<RadioFoldRow> = {}): RadioFoldRow => ({
  id,
  stemId: `${id}-1`,
  kinds: ['rhythmic'],
  barLength: 4,
  hooked: false,
  audible: true,
  percussive: false,
  ...o
})

/** A settled fold on a 4-bar loop, bend 40: a drums anchor and two 4-bar rhythmic rows. */
function foldedStep(): RadioFoldStep {
  const rows = [R('d', { kinds: ['drums'], percussive: true }), R('p'), R('q')]
  let s = createRadioFold('autech')
  for (let k = 0; k < 300; k++) {
    const st = stepRadioFold(s, { rows, loopBars: 4, bpm: 120, fold: 40 })
    s = st.state
    if (st.cycles.length > 0 && st.state.rows.some((r) => r.mode === 'settled')) return st
  }
  throw new Error('no fold settled')
}

describe('radioFoldIntervalBars preferWaitLaps', () => {
  it('0 is the draw itself; the default is FOLD_PREFER_WAIT_LAPS', () => {
    const rows = [R('d', { kinds: ['drums'], percussive: true }), R('p')]
    let s = createRadioFold('autech')
    let snapped = false
    for (let k = 0; k < 200 && !snapped; k++) {
      s = stepRadioFold(s, { rows, loopBars: 4, bpm: 120, fold: 40 }).state
      snapped = radioFoldIntervalBars(s, 4, 4) !== 4
    }
    expect(snapped).toBe(true)
    expect(radioFoldIntervalBars(s, 4, 4, 0, false, 0)).toBe(4)
    expect(radioFoldIntervalBars(s, 4, 4)).toBe(
      radioFoldIntervalBars(s, 4, 4, 0, false, FOLD_PREFER_WAIT_LAPS)
    )
  })
})

describe('stepRadioFold hurry', () => {
  // the trace's hash, recorded from radioFold.ts BEFORE the hurry was added (sssketch 8c07793)
  const BEFORE_HURRY = '0540eeea'
  function trace(hurry?: number): string {
    const row = (id: string, o: Partial<RadioFoldRow> = {}): RadioFoldRow =>
      R(id, { stemId: `${id}-a`, barLength: 2, ...o })
    const band = [
      row('drums', { kinds: ['drums'], barLength: 4 }),
      row('hats', { kinds: ['drums'], barLength: 1 }),
      row('perc'),
      row('clap', { barLength: 4 }),
      row('shaker', { barLength: 4 }),
      row('lead', { kinds: ['lead'], barLength: 4 })
    ]
    const out: string[] = []
    for (const seed of ['autech', 'k3x9pq', 'elling'])
      for (const bend of [0, 40, 55, 80, 100])
        for (const loopBars of [4, 8]) {
          let s = createRadioFold(seed)
          const churn = seededRandom(`churn-${seed}-${bend}-${loopBars}`)
          const rows = band.map((r) => ({ ...r }))
          for (let k = 0; k < 200; k++) {
            if (churn() < 0.15) {
              const i = Math.floor(churn() * rows.length)
              rows[i] = { ...rows[i], stemId: `${rows[i].id}-${k}` }
            }
            const st = stepRadioFold(s, {
              rows,
              loopBars,
              bpm: 120,
              fold: bend,
              ...(hurry !== undefined && { hurry })
            })
            s = st.state
            out.push(JSON.stringify([st.lap, st.marked, st.stretch, st.cycles, st.drift]))
          }
        }
    return out.join('\n')
  }

  it('no hurry, or a hurry of 0, draws and decides exactly what it did; a hurry does not', () => {
    expect(hashText(trace())).toBe(BEFORE_HURRY)
    expect(hashText(trace(0))).toBe(BEFORE_HURRY)
    expect(hashText(trace(1))).not.toBe(BEFORE_HURRY)
  })

  it('folds move more at full hurry than at none, from the same seed, and still fold', () => {
    const rows = [R('d', { kinds: ['drums'], percussive: true }), R('p'), R('q'), R('r')]
    const count = (hurry: number): { changes: number; folded: number } => {
      let s = createRadioFold('autech')
      let last = ''
      let changes = 0
      let folded = 0
      for (let k = 0; k < 400; k++) {
        const st = stepRadioFold(s, { rows, loopBars: 4, bpm: 120, fold: 60, hurry })
        s = st.state
        const key = JSON.stringify(st.cycles.map((c) => [c.rowId, c.cycleId]))
        if (key !== last) changes++
        if (st.cycles.length > 0) folded++
        last = key
      }
      return { changes, folded }
    }
    const calm = count(0)
    const hurried = count(1)
    expect(hurried.changes).toBeGreaterThan(calm.changes * 1.5)
    expect(hurried.folded).toBeGreaterThan(0)
  })
})

describe('the rows the machine holds', () => {
  it('radioFoldHoldsRow reads both steps', () => {
    const step = foldedStep()
    const id = step.cycles[0].rowId
    expect(radioFoldHoldsRow(null, step, id)).toBe(true)
    expect(radioFoldHoldsRow(step, null, id)).toBe(true)
    expect(radioFoldHoldsRow(null, null, id)).toBe(false)
    expect(radioFoldHoldsRow(step, step, 'nobody')).toBe(false)
  })

  it('radioFoldPickableIds drops held rows when active, falls back to all, is the same array when not', () => {
    const step = foldedStep()
    const id = step.cycles[0].rowId
    const ids = ['d', 'p', 'q']
    expect(radioFoldPickableIds(ids, null, step, false)).toBe(ids)
    expect(radioFoldPickableIds(ids, null, step, true)).not.toContain(id)
    expect(radioFoldPickableIds([id], null, step, true)).toEqual([id])
  })
})
```

- [ ] **Step 2: Pin the hash on the unmodified machine first.**
  - Run: `npx vitest run src/shared/radioFoldHurry.test.ts -t "no hurry"`
  - Expected: vitest does not typecheck, so the unmodified machine just ignores `hurry`. The first
    two hash expectations pass at `0540eeea` (that is the pin), and the third fails (no hurry yet).
  - If the hash differs, `radioFold.ts` moved since `8c07793`. Record the hash that HEAD gives
    (temporarily comment out the two hurry expectations), put it in `BEFORE_HURRY`, and note it in
    the commit message.
  - The other tests fail on the missing exports.

- [ ] **Step 3: Implement.** In `src/shared/radioFold.ts`:

  a. After `export const FOLD_PREFER_WAIT_LAPS = 2`, add:

```ts
/** Fold following the pace slider above 70 (stepRadioFold's `hurry`, 0..1; 2026-10-03 fold
 * follows pace): stretches shrink to this share of their drawn bars at full hurry ... */
export const FOLD_HURRY_STRETCH_MIN_SCALE = 0.25
/** ... and a top that is not a realignment still opens (re-fold, rotation, an unfold's wait, a
 * second fold) with this chance at full hurry, drawn once per step and only while hurrying. */
export const FOLD_HURRY_OPEN_CHANCE = 0.5
```

  b. In `RadioFoldInput`, after `fold: number`:

```ts
  /** 0..1, from the pace slider above 70 (radioCadence.foldHurry): the machine's own timers
   * shorten -- stretches, fold-in and re-fold steps, the unfold wait, the realignments before a
   * rotation -- and any top may open like a realignment (FOLD_HURRY_OPEN_CHANCE). Absent or 0:
   * exactly as before, the same draws. */
  hurry?: number
```

  c. In `stepRadioFold`, right after
     `const f = normalizeFoldAmount(input.fold, DEFAULT_RADIO_FOLD) / 100`:

```ts
  const h = Math.min(1, Math.max(0, Number.isFinite(input.hurry) ? (input.hurry as number) : 0))
  /** A count of steps or laps, shortened by the hurry (never below `floor`); as drawn at 0. */
  const hurried = (n: number, floor: number): number =>
    h > 0 ? Math.max(floor, Math.round(n * (1 - h))) : n
  const stretchScale = h > 0 ? 1 - (1 - FOLD_HURRY_STRETCH_MIN_SCALE) * h : 1
```

  d. Right after `const marked = s.rows.some((r) => r.mode === 'settled' && realignsAt(r, lap, loopBeats))`:

```ts
  // Hurrying, a top that is not a realignment may still open for what waits on one. Drawn only
  // while hurrying, so an unhurried machine draws exactly what it always did. `marked` stays the
  // true realignment: the change and the turnaround prefer that one alone.
  const opensAnyway = h > 0 && draw() < FOLD_HURRY_OPEN_CHANCE * h
  const opens = (r: RadioFoldRowState): boolean => realignsAt(r, lap, loopBeats) || opensAnyway
```

  e. **Section 2 (stretches).** Multiply both drawn stretch lengths by `stretchScale`:
     `(0.75 + 0.5 * draw())` becomes `(0.75 + 0.5 * draw()) *\n        stretchScale` in both the
     straight and the folded branch.

  f. **Section 2b (realignment tops).** Three changes:
     - The guard
       `if (r.mode !== 'settled' || r.unfoldSince !== null || !realignsAt(r, lap, loopBeats)) continue`
       becomes `if (r.mode !== 'settled' || r.unfoldSince !== null || !opens(r)) continue`.
     - The rotation test `r.realigns >= (r.rotateAfter ?? FOLD_ROTATE_AFTER_REALIGNS.max)` becomes
       `r.realigns >= hurried(r.rotateAfter ?? FOLD_ROTATE_AFTER_REALIGNS.max, 1)`.
     - The re-fold path
       `radioFoldPath(r.cycleBeats, pick, 1 + Math.floor(draw() * 2))` becomes
       `radioFoldPath(r.cycleBeats, pick, hurried(1 + Math.floor(draw() * 2), 1))`.

  g. **Section 3 (unfolds).** In the `due` expression:
     - `realignsAt(r, lap, loopBeats) ||` becomes `opens(r) ||`;
     - `lap - r.unfoldSince >= FOLD_UNFOLD_MAX_WAIT_LAPS` becomes
       `lap - r.unfoldSince >= hurried(FOLD_UNFOLD_MAX_WAIT_LAPS, 0)`.

  h. **Section 5 (new folds).** Two changes:
     - `const may = s.rows.length < maxRows(f) && (active === 0 || (marked && draw() < 0.5))`
       becomes:

       ```ts
       const may =
         s.rows.length < maxRows(f) && (active === 0 || ((marked || opensAnyway) && draw() < 0.5))
       ```

     - `radioFoldPath(full, target, 2 + Math.floor(draw() * 3))` becomes
       `radioFoldPath(full, target, hurried(2 + Math.floor(draw() * 3), 1))`.

  i. `radioFoldIntervalBars` gains a last argument. Update its doc comment's first line to mention
     it ("at most `preferWaitLaps` laps, FOLD_PREFER_WAIT_LAPS by default"):

```ts
export function radioFoldIntervalBars(
  state: RadioFoldState | null,
  drawnBars: number,
  loopBars: number,
  fromBars = 0,
  stepOwed = false,
  preferWaitLaps: number = FOLD_PREFER_WAIT_LAPS
): number {
  if (state === null || !(loopBars > 0) || !(preferWaitLaps > 0)) return drawnBars
  const from = fromBars + (stepOwed ? loopBars : 0)
  const limit = drawnBars + preferWaitLaps * loopBars
```

  (The rest of the body is unchanged.)

  j. Append at the end of the file:

```ts
/** Whether the fold machine holds `rowId` in the lap playing (`now`) or the next (`next`): a
 * cycle for it in either step. Phase 1 of fold following the slider keeps such a row to its loop
 * tops (radioCadenceBarEvery); phase 2 lets it cut mid-loop, carrying its fold (radioFoldCarry). */
export function radioFoldHoldsRow(
  now: RadioFoldStep | null,
  next: RadioFoldStep | null,
  rowId: string
): boolean {
  return [now, next].some((st) => st?.cycles.some((c) => c.rowId === rowId) === true)
}

/** PHASE 1. The rows radio may pick from while fold mode runs in the slider's bar band (`active`):
 * every id the fold machine does not hold in the lap playing or the next (radioFoldHoldsRow), so
 * the folded layers keep their stems while the rest churn; all of `ids` when that leaves none, or
 * when not `active` (the same array, so nothing downstream draws differently). */
export function radioFoldPickableIds(
  ids: readonly string[],
  now: RadioFoldStep | null,
  next: RadioFoldStep | null,
  active: boolean
): readonly string[] {
  if (!active) return ids
  const free = ids.filter((id) => !radioFoldHoldsRow(now, next, id))
  return free.length > 0 ? free : ids
}
```

- [ ] **Step 4: Run them and watch them pass.**
  - Run: `npx vitest run src/shared/radioFoldHurry.test.ts src/shared/radioFold.test.ts src/shared/radioFoldStep.test.ts src/shared/radioFoldStatus.test.ts src/shared/radioFoldLanes.test.ts`
  - Expected: PASS. The existing fold suites pass unchanged, because no caller passes `hurry` or
    `preferWaitLaps`.

- [ ] **Step 5: Lint, typecheck, check the web, commit.**
  - Run `npx eslint` on both files and `npm run typecheck`.
  - In ell.ing/radio, run `npm run typecheck` (it compiles `@shared` from this tree).
  - Commit the two files: `radio fold follows pace: the machine -- stepRadioFold's optional hurry (stretches x(1-0.75h), fold-in and re-fold steps and the unfold wait shortened, rotation after fewer realignments, any top opening like a realignment with chance h/2, drawn only while hurrying: no hurry is the same hash 0540eeea), radioFoldIntervalBars' preferWaitLaps (default FOLD_PREFER_WAIT_LAPS), radioFoldHoldsRow and radioFoldPickableIds`, then the trailer.

### Task 3: The cadence (`radioSchedule.ts`)

**Files:**
- Modify: `/Users/nickel/Claudecode/sssketch/src/shared/radioSchedule.ts`
- Modify: `/Users/nickel/Claudecode/sssketch/src/shared/radioCadence.test.ts`
- Modify: `/Users/nickel/Claudecode/sssketch/src/shared/radioFoldPace.test.ts`

**Read the overlap note in the task graph before landing this.** It changes both radios' fold
behaviour at once. Land it only when Task 4 can follow directly.

- [ ] **Step 1: Write the failing tests.**

  a. In `radioFoldPace.test.ts`:
     - Change the vitest import to `import { describe, expect, it, vi } from 'vitest'`.
     - Add after the `./radioFold` import:

```ts
import {
  DEFAULT_RADIO_SETTINGS,
  createRadioClock,
  radioCadenceBarEvery,
  radioCadenceOf,
  radioClockForPace,
  type RadioSettings
} from './radioSchedule'

const at = (level: number, foldMode = true): RadioSettings => ({
  ...DEFAULT_RADIO_SETTINGS,
  paceLevel: level,
  phraseBars: 16,
  foldMode
})
```

  and append:

```ts
describe('radioCadenceOf in fold mode', () => {
  it("above fast the phrase caps are the slider's", () => {
    expect(radioCadenceOf(at(55)).phraseBars).toBe(8)
    expect(radioCadenceOf(at(65)).phraseBars).toBe(4)
    expect(radioCadenceOf(at(71)).phraseBars).toBe(0)
    expect(radioCadenceOf(at(71)).turnaroundPhraseBars).toBe(16)
  })
})

describe('radioClockForPace in fold mode', () => {
  it('above fast a long fold interval is redrawn from the window; at or below it is kept, no draw', () => {
    const random = vi.fn(() => 0)
    const c = { ...createRadioClock(30, 0), barsElapsed: 3 }
    expect(radioClockForPace(c, radioCadenceOf(at(50)), 4, random).intervalBars).toBe(30)
    expect(radioClockForPace(c, radioCadenceOf(at(40)), 4, random).intervalBars).toBe(30)
    expect(random).not.toHaveBeenCalled()
    const ludicrous = radioClockForPace(c, radioCadenceOf(at(95)), 4, random)
    expect(ludicrous.intervalBars).toBe(1)
    expect(ludicrous.barsElapsed).toBe(3)
    expect(random).toHaveBeenCalledTimes(1)
    // 55: the window's max plus 2 laps of the snap is the most a running interval keeps
    const p55 = radioCadenceOf(at(55))
    expect(p55.foldPreferWaitLaps).toBe(2)
    const keep = p55.window.max + 2 * 4
    expect(radioClockForPace({ ...c, intervalBars: keep }, p55, 4, random).intervalBars).toBe(keep)
    expect(random).toHaveBeenCalledTimes(1)
  })
})

describe('radioCadenceBarEvery', () => {
  it('fold mode keeps a held row to its tops; everything else takes the band', () => {
    const fold = radioCadenceOf(at(95))
    const plain = radioCadenceOf(at(95, false))
    expect(radioCadenceBarEvery(fold, true)).toBeNull()
    expect(radioCadenceBarEvery(fold, false)).toBe(1)
    expect(radioCadenceBarEvery(plain, true)).toBe(1)
  })
})
```

  b. In `radioCadence.test.ts`, the four tests that pinned "fold ignores the slider":
     - **`no level: exactly the old reading -- the pinned window, the phrase, one row`.** Its
       `toEqual` object gains `foldPaced: false, foldPreferWaitLaps: 0, foldHurry: 0` after
       `fold: false`.
     - **`fold mode keeps its own window, tops, one row`.** Replace it with:

```ts
  it('fold mode at or below fast keeps its own window, tops, one row, whatever the level', () => {
    for (const level of [0, 25, 50]) {
      const c = radioCadenceOf(at(level, 16, true))
      expect(c.window).toEqual(FOLD_PACE_BARS)
      expect(c.phraseBars).toBe(16)
      expect(c.turnaroundPhraseBars).toBe(16)
      expect(c.barEvery).toBeNull()
      expect(c.rows).toBe(1)
      expect(c.fold).toBe(true)
      expect(c.foldPaced).toBe(false)
      expect(c.foldPreferWaitLaps).toBe(FOLD_PREFER_WAIT_LAPS)
      expect(c.foldHurry).toBe(0)
    }
  })

  it('fold mode above fast follows the slider: from 80 it IS the slider (bar band included)', () => {
    for (let level = 80; level <= 100; level++) {
      const fold = radioCadenceOf(at(level, 16, true))
      const plain = radioCadenceOf(at(level, 16))
      expect(fold.window).toEqual(plain.window)
      expect(fold.phraseBars).toBe(plain.phraseBars)
      expect(fold.barEvery).toBe(plain.barEvery)
      expect(fold.rows).toBe(plain.rows)
      expect(fold.turnaroundPhraseBars).toBe(16)
      expect(fold.foldPreferWaitLaps).toBe(0)
      expect(fold.foldPaced).toBe(true)
    }
    expect(radioCadenceOf(at(55, 16, true)).phraseBars).toBe(8)
    expect(radioCadenceOf(at(65, 16, true)).phraseBars).toBe(4)
    expect(radioCadenceOf(at(71, 16, true)).phraseBars).toBe(0)
  })
```

     - **`fold mode: a move leaves fold's stretched interval alone (its snap to a realignment top), no draw`.**
       Rename it `fold mode at or below fast: a move leaves fold's stretched interval alone (its snap to a realignment top), no draw`,
       and set `paceLevel: 50` (was 100) in its `radioCadenceOf`. Nothing else changes.
     - **`fold on mid-stream above fast: the change phrase grows 0 -> 16 and stays on the turnarounds`.**
       Rename it `the change phrase growing 0 -> 16 mid-stream (pace 75, then fold on at fast) stays on the turnarounds`.
       In its `fold` cadence, set `paceLevel: 50` (was 75), with the comment
       `// fold at fast: its own cadence, the base phrase (above fast fold follows the slider's caps)`.
       Nothing else changes.

     The file already imports `FOLD_PACE_BARS` and `FOLD_PREFER_WAIT_LAPS` from `./radioFold`.

- [ ] **Step 2: Run them and watch them fail.**
  - Run: `npx vitest run src/shared/radioFoldPace.test.ts src/shared/radioCadence.test.ts`
  - Expected: FAIL. `radioCadenceBarEvery` is missing, the fold fields are undefined, and the fold
    cadence above fast is still 8-32.

- [ ] **Step 3: Implement.** In `src/shared/radioSchedule.ts`:

  a. Imports:
     - add `FOLD_PREFER_WAIT_LAPS,` to the `./radioFold` import (after `FOLD_PACE_BARS,`);
     - add `radioFoldPaceProfile,` and `RADIO_FOLD_PACE_FROM` to the `./radioPace` import.

  b. **`RadioCadence`.** Replace the `fold` field and its comment with:

```ts
  /** Fold mode is on. At or below fast (and with no level) its own cadence exactly; above, it
   * follows the slider (radioFoldPaceProfile). */
  fold: boolean
  /** Fold mode above fast: the slider moves its cadence, so radioClockForPace may redraw. */
  foldPaced: boolean
  /** Laps a change may wait past its draw for a realignment top (radioFoldIntervalBars'
   * `preferWaitLaps`): FOLD_PREFER_WAIT_LAPS at or below fast, fading to 0 above 70; 0 with fold
   * off. */
  foldPreferWaitLaps: number
  /** 0..1, stepRadioFold's `hurry`: 0 at or below 70 and with fold off. */
  foldHurry: number
```

  c. **`radioCadenceOf`.**
     - In the no-level branch, after `fold: Boolean(settings.foldMode)`, add:

       ```ts
       foldPaced: false,
       foldPreferWaitLaps: settings.foldMode ? FOLD_PREFER_WAIT_LAPS : 0,
       foldHurry: 0
       ```

     - Replace the `if (settings.foldMode) { return { ... } }` branch with:

```ts
  if (settings.foldMode) {
    const fold = radioFoldPaceProfile(level)
    return {
      level,
      window: { ...fold.window },
      phraseBars: radioPacePhraseBars(fold, base),
      turnaroundPhraseBars: base,
      barEvery: fold.barEvery,
      rows: fold.rows,
      fold: true,
      foldPaced: level > RADIO_FOLD_PACE_FROM,
      foldPreferWaitLaps: fold.preferWaitLaps,
      foldHurry: fold.hurry
    }
  }
```

     - In the final return, after `fold: false`, add:

       ```ts
       foldPaced: false,
       foldPreferWaitLaps: 0,
       foldHurry: 0
       ```

  d. Directly above `radioGridLineAtOrAfter`, add:

```ts
/** The bar band for a change on one row: the cadence's `barEvery`, except that in fold mode a
 * row the fold machine holds (a cycle in the lap playing or the next: radioFoldHoldsRow) keeps to
 * its loop tops -- phase 1 of fold following the slider. Pass the answer to radioPaceGridBars. */
export function radioCadenceBarEvery(
  cadence: Pick<RadioCadence, 'barEvery' | 'fold'>,
  rowFolded: boolean
): number | null {
  return cadence.fold && rowFolded ? null : cadence.barEvery
}
```

  e. **`radioClockForPace`.** Its parameter type becomes
     `Partial<Pick<RadioCadence, 'fold' | 'foldPaced' | 'foldPreferWaitLaps'>>`, and the interval
     line becomes:

```ts
  // Fold mode at or below fast: never redrawn, as before. Above, the realignment snap's own
  // reach (the window plus the preferred wait) is the bound a running interval may keep.
  const longest =
    cadence.fold !== true
      ? cadence.window.max
      : cadence.foldPaced === true
        ? cadence.window.max +
          (cadence.foldPreferWaitLaps ?? FOLD_PREFER_WAIT_LAPS) * Math.max(0, loopBars)
        : Number.POSITIVE_INFINITY
  const intervalBars =
    clock.intervalBars > longest
      ? nextRadioIntervalBarsInWindow(cadence.window, random)
      : clock.intervalBars
```

  f. **Three doc comments** still say the slider does nothing in fold. Fix them:
     - **On `radioCadenceOf`.** Replace "Fold mode keeps today's rule -- its own window
       (FOLD_PACE_BARS) replaces the pace's, changes land on tops, one row at a time -- so the
       slider does nothing while fold is on." with: "Fold mode keeps today's rule at or below fast
       (its own window, FOLD_PACE_BARS, tops, one row) and follows the slider above it
       (radioFoldPaceProfile: by 80 it is the slider's cadence; spec
       2026-10-03-radio-fold-follows-pace-design)."
     - **On `radioClockForPace`.** Replace "In fold mode (`cadence.fold`) the interval is never
       redrawn: ... The slider does nothing in fold anyway." with: "In fold mode at or below fast
       the interval is never redrawn: radioFoldIntervalBars stretches a draw up to
       FOLD_PREFER_WAIT_LAPS laps past the window to reach a realignment top, and a redraw would
       drop that snap (and, on the web, spend a draw). Above fast (`foldPaced`) an interval longer
       than the window plus that reach is redrawn, as outside fold."
     - **On `radioPaceWindowOf`.** Its first sentence becomes: "The window the clock draws a
       change's interval from: radioCadenceOf's (fold mode's own, 8-32 bars, at or below fast;
       above, the slider's, through radioFoldPaceProfile)."

- [ ] **Step 4: Run the shared suite.**
  - Run: `npx vitest run src/shared`
  - Expected: PASS. Every test that reads a cadence outside fold is unchanged.

- [ ] **Step 5: The web's expected red.**
  - In ell.ing/radio, run `npx vitest run src/radio/step.test.ts`.
  - Expected: exactly three failures, which are the ones Task 4 rewrites:
    - `fold mode on and off above fast re-anchors the change phrase too (its phrase is the base)`;
    - `the pace slider leaves the machine alone (it reset it before the slider)`;
    - `fold mode overrides the bar band: changes land on loop tops`.
  - Anything else red is a regression: stop and look.

- [ ] **Step 6: Lint, typecheck (both repos), commit** the three sssketch files.
  - Message: `radio fold follows pace: the cadence -- radioCadenceOf's fold branch reads radioFoldPaceProfile (exactly today's at 50 and below; the slider's phrase caps, rows and from 80 its bar band above), RadioCadence.foldPaced / foldPreferWaitLaps / foldHurry, radioCadenceBarEvery (a held row keeps to its tops, phase 1), radioClockForPace redraws a fold interval above fast past the window plus the snap's reach; the four cadence tests that pinned fold ignoring the slider pin it at or below fast`, then the trailer.

### Task 4: Web radio, phase 1 (`step.ts`)

**Files (ell.ing/radio):**
- Modify: `src/radio/step.ts`
- Modify: `src/radio/step.test.ts`

**Depends on:**
- Tasks 1-3 in sssketch's working tree;
- pace Task 5 follow-ups, pace Task 8 and combos Task 4 committed (same files).

The diffs below are against `230398d`, where `arm()` has no companions. On the tip you will have
pace Task 8's `pickRadioSlotIds` there. Apply the same idea to its eligible list.

- [ ] **Step 1: Rewrite the three red tests and add three new ones in `step.test.ts`.**

  a. **`fold mode on and off above fast re-anchors the change phrase too (its phrase is the base)`.**
     Replace it with the version below. In fold at 60 the change phrase is now the slider's 8, so a
     toggle moves no phrase.

```ts
  it('fold mode on and off above fast keeps the change phrase the slider gives (8 bars at 60), on the turnarounds', () => {
    // fold follows the slider above fast (sssketch spec 2026-10-03-radio-fold-follows-pace-design):
    // at 60 its change phrase is the slider's 8 bars, as without it, so a toggle moves no phrase
    const sim = new Sim({ paceLevel: 60, phraseBars: 16, turnarounds: 'often', channels: 5 }, seeded(5))
    sim.send({ type: 'play' })
    sim.run(0, 50)
    const fold = { foldMode: true, fold: 40, clash: 25, foldSeed: WEB_RADIO_DEFAULTS.foldSeed }
    let before = sim.of('landed').length
    sim.send({ type: 'foldControls', ...fold })
    sim.run(50 + 1 / 30, 50 + 24 * LAP)
    let landed = sim.of('landed').slice(before).map((a) => a.time / LAP)
    expect(landed.length).toBeGreaterThan(3)
    for (const lap of landed) expect(lap % 2).toBe(0)
    const t = 50 + 24 * LAP
    before = sim.of('landed').length
    sim.send({ type: 'foldControls', ...fold, foldMode: false })
    sim.run(t + 1 / 30, t + 24 * LAP)
    landed = sim.of('landed').slice(before).map((a) => a.time / LAP)
    expect(landed.length).toBeGreaterThan(3)
    for (const lap of landed) expect(lap % 2).toBe(0)
  })
```

  b. **`the pace slider leaves the machine alone (it reset it before the slider)`.** Replace it with:

```ts
  it('the pace slider leaves the machine alone (it reset it before the slider); above fast it shortens a long interval', () => {
    const sim = new Sim(FOLD)
    sim.send({ type: 'play' })
    sim.run(0, 60)
    const fold = sim.s.fold
    const interval = sim.s.clock!.intervalBars
    // at or below fast fold keeps its own cadence: nothing to shorten
    sim.send({ type: 'pace', level: 40 })
    expect(sim.s.clock!.intervalBars).toBe(interval)
    // above, fold follows the slider (sssketch spec 2026-10-03-radio-fold-follows-pace-design): at
    // 100 the window is one bar, so the interval running is drawn again; the machine is untouched
    expect(interval).toBeGreaterThan(1)
    sim.send({ type: 'pace', level: 100 })
    expect(sim.s.fold).toBe(fold)
    expect(sim.s.foldClear).toBe(false)
    expect(sim.s.clock!.intervalBars).toBe(1)
  })
```

  c. **`fold mode overrides the bar band: changes land on loop tops`** (in the
     `the pace bar band: mid-loop landings` describe). Replace it with the three tests below:

```ts
  it('fold mode in the bar band: mid-loop cuts, never on a row the fold holds (phase 1)', () => {
    let bars = 0
    for (const seed of [10, 11, 12]) {
      const sim = new Sim({ paceLevel: 100, foldMode: true, fold: 80, channels: 5 }, seeded(seed))
      sim.send({ type: 'play' })
      // the rows in the last two fold events handed to the engine before each landAt
      let held: string[][] = [[], []]
      const n0 = sim.log.length
      sim.run(0, 30 * LAP)
      for (const a of sim.log.slice(n0)) {
        if (a.type === 'fold') held = [held[1], a.cycles.map((c) => c.rowId)]
        if (a.type !== 'landAt') continue
        if (a.bar) bars++
        else expect(onWrap(a.time)).toBe(true)
        if (a.bar) for (const c of a.changes) expect(held.flat()).not.toContain(c.slot)
      }
      expect(sim.of('fold').some((f) => f.cycles.length > 0)).toBe(true)
    }
    expect(bars).toBeGreaterThan(30)
  })

  it('above 70 the fold machine hurries: its cycles change more often at 100 than at 70', () => {
    // a fold arriving on a row, or settling on a new length: the rows and their targets per top
    const moves = (level: number): number => {
      let n = 0
      for (const seed of [3, 4, 5]) {
        const sim = new Sim({ paceLevel: level, foldMode: true, fold: 80, channels: 5 }, seeded(seed))
        sim.send({ type: 'play' })
        let last = ''
        for (let lap = 0; lap < 80; lap++) {
          sim.run(lap * LAP, (lap + 1) * LAP - 1 / 30)
          const key = JSON.stringify((sim.s.fold?.rows ?? []).map((r) => [r.rowId, r.targetBeats, r.phaseBeats]))
          if (key !== last) n++
          last = key
        }
      }
      return n
    }
    expect(moves(100)).toBeGreaterThan(moves(70))
  }, 30000)

  it('fold mode follows the slider: about 50 s a change at fast, a loop top at 70, a bar at 95', () => {
    const mean = (level: number): number => {
      const sim = new Sim({ paceLevel: level, foldMode: true, fold: 80, channels: 5, phraseBars: 16 }, seeded(3))
      sim.send({ type: 'play' })
      sim.run(0, 60 * LAP)
      const times = sim.of('landed').map((l) => l.time)
      const gaps = times.slice(1).map((x, i) => x - times[i])
      return gaps.reduce((a, b) => a + b, 0) / gaps.length
    }
    expect(mean(50)).toBeGreaterThan(40)
    expect(mean(70)).toBeCloseTo(LAP, 0)
    expect(mean(95)).toBeLessThan(2.6)
  }, 20000)
```

  The planning prototype measured 81 against 108 moves for the hurry test, and the margins in the
  cadence test are wide. If pace Task 8's companions change the seeded streams, re-check the
  numbers; don't loosen the assertions past the spec's table.

- [ ] **Step 2: Run them and watch them fail.**
  - Run: `npx vitest run src/radio/step.test.ts`
  - Expected: FAIL in the new held-row test (folded rows are cut mid-loop) and the hurry test (no
    hurry is passed). The rewritten (a) and (b) may already pass, because their behaviour comes
    from `@shared`.

- [ ] **Step 3: Implement** in `src/radio/step.ts`. The diff was checked at `230398d`:

  a. Imports:
     - add `radioCadenceBarEvery,` to the `@shared/radioSchedule` import;
     - add `radioFoldHoldsRow,` and `radioFoldPickableIds,` to the `@shared/radioFold` import.

  b. **`changeGrid`.** A row the fold holds keeps to its tops:

```ts
function changeGrid(s: RadioState, cadence: RadioCadence, loopBars: number, slot: string | null, record: IndexRecord | null): number {
  const outgoing = slot === null ? null : (rowOf(s, slot)?.record?.bars ?? null)
  const held = slot !== null && radioFoldHoldsRow(s.foldNow, s.foldNext, slot)
  return radioPaceGridBars(radioCadenceBarEvery(cadence, held), 0, loopBars, outgoing, record?.bars ?? null)
}
```

  Update its doc comment: "... its bar lines when the incoming stem is known and fits the loop,
  except on a row fold mode holds (radioCadenceBarEvery: its tops, phase 1)."

  c. **`arm`.** Pick from the rows the fold does not hold while fold runs in the band:

```ts
  const all = s.rows.filter((r) => eligible(s, r.id) && !s.manual[r.id] && s.removing?.slot !== r.id).map((r) => r.id)
  const cadence = radioCadenceOf(s.settings)
  // fold in the bar band (phase 1, sssketch spec 2026-10-03-radio-fold-follows-pace-design section
  // 3): the folded rows keep their stems while the rest churn; the same array otherwise
  const eligibleIds = radioFoldPickableIds(all, s.foldNow, s.foldNext, cadence.fold && cadence.barEvery !== null)
```

  Then pass `[...eligibleIds]` where `eligibleIds` was passed: `pickRadioSlotId` at `230398d`,
  `pickRadioSlotIds` after pace Task 8. Keep `radioPaceRowsThisChange(cadence, c.rnd)` drawing
  exactly where it draws now. Only the list changes.

  d. **Companions (after pace Task 8).** Where a companion that is not ready is dropped on a
     mid-loop decision (the bar path: `decide(..., 'cut', bar)`, or `scheduleLedAtBar`), also drop a
     companion whose row `radioFoldHoldsRow(s.foldNow, s.foldNext, k.slot)` says is held. Its row
     goes back to radio, as a not-ready one's does. A loop-top landing keeps it.
     - Test: in the held-row test above, also assert that no `landAt` with `bar: true` carries a
       held row among its `changes`. It already does: it checks every change.

  e. **`foldAtWrap`.** Pass the hurry. The spread keeps the input object as it was at 50 and below:

```ts
  const hurry = radioCadenceOf(s.settings).foldHurry
  const next = stepRadioFold(state, { rows, loopBars: t.loopBars, bpm, fold: s.settings.fold, ...(hurry > 0 && { hurry }) })
```

  f. **`interval`.** The preference comes from the cadence:

```ts
function interval(c: Ctx, fromBars = 0): number {
  const cadence = radioCadenceOf(c.s.settings)
  const drawn = nextRadioIntervalBarsInWindow(cadence.window, c.rnd)
  return c.s.settings.foldMode
    ? radioFoldIntervalBars(c.s.fold, drawn, c.s.lastTick?.loopBars ?? 0, fromBars, false, cadence.foldPreferWaitLaps)
    : drawn
}
```

  Update its doc comment: "fold mode's window and its realignment preference
  (radioCadence.foldPreferWaitLaps: 2 laps at fast and below, none above 70) while the mode is on".

  g. **The file's header comment** (the `fold` paragraph near the top) says "the pace slider leaves
     fold alone". Change it to: "the pace slider sets fold's cadence above fast (radioCadenceOf) and
     hurries its machine above 70 (foldHurry)".

- [ ] **Step 4: Run and watch it pass.**
  - Run: `npx vitest run src/radio src/audio`
  - Expected: PASS.

- [ ] **Step 5: Byte-identical at 50 and below (not committed).**
  - Copy the action-log harness pattern: `src/radio/zzActionlog.harness.test.ts`, if it is still in
    the tree, or the one in pace plan Task 5. It runs a seeded `reduce` loop with answered actions,
    hold, swap-now, Next and mute, and writes the log to `ACTIONLOG_OUT`.
  - Levels `[undefined, 0, 25, 50]` × fold `[false, true]` × seeds `[1, 2, 3]` × loop mix
    `[0, 1]`.
  - Run it with `ACTIONLOG_OUT=/tmp/...before` on a checkout of this task's parent commit (or
    `git stash`), and with `ACTIONLOG_OUT=/tmp/...after` on this task's commit, both against
    sssketch with Tasks 1-3.
  - `cmp` them. They must be identical. Delete the harness, and don't commit it.
  - Planning ran the same comparison against `230398d`: identical.

- [ ] **Step 6: Typecheck, commit.**
  - Run: `npm run typecheck`.
  - Commit `step.ts` and `step.test.ts`. Message: `radio: fold follows the pace slider, phase 1 -- the interval's realignment preference from @shared radioCadenceOf (2/1/0 laps), the fold step's hurry above 70, and in the bar band the rows the fold holds are not picked and keep to their tops (radioFoldPickableIds, radioCadenceBarEvery) while every other row cuts mid-loop; companions on a held row do not ride a mid-loop line. Action log byte-identical to the parent at no level, 0, 25 and 50, fold on and off. The three tests that pinned fold ignoring the slider now pin it following`, then the trailer.

### Task 5: Desktop, phase 1 (`DiscoverPanel.tsx`)

**Files (sssketch):** `src/renderer/src/components/DiscoverPanel.tsx`

**Depends on:** Tasks 1-3; pace Task 9 and combos Task 5 committed (same file).

These steps are not compiled (the file is under concurrent edit). Each names the exact call to
change.

- [ ] **Step 1: Imports.**
  - Add `radioCadenceBarEvery` to the `@shared/radioSchedule` import.
  - Add `radioFoldHoldsRow` and `radioFoldPickableIds` to the `@shared/radioFold` import.

- [ ] **Step 2: The interval.** In the function documented "a change's interval ... while the mode
  is on (radioCadence.window, radioFoldIntervalBars)" (it calls
  `radioFoldIntervalBars(radioFoldRef.current, ..., radioFoldStepOwedRef.current !== null)`), pass
  `radioCadence.foldPreferWaitLaps` as the new sixth argument. Update the comment the same way as
  web Task 4f.

- [ ] **Step 3: The hurry.** In `radioFoldAtWrap`'s deferred step, the `stepRadioFold(was ?? ..., { rows, loopBars, bpm, fold: radioSettings.fold })`
  call gains `...(radioCadence.foldHurry > 0 && { hurry: radioCadence.foldHurry })`.
  - `radioCadence` is the per-render `radioCadenceOf(radioSettings)`.
  - If the deferred closure could see a stale render, read the hurry from the same place it reads
    `radioSettings.fold`, so the two are from one render.

- [ ] **Step 4: The held-row grid, in both places it is computed.**
  - **The clock effect.** `const gridBars = radioPaceGridBars(radioCadence.barEvery, ...)`: the
    first argument becomes:

    ```ts
    radioCadenceBarEvery(
      radioCadence,
      pendingPick !== null &&
        radioFoldHoldsRow(radioFoldNowRef.current, radioFoldNextRef.current, pendingPick.slotId)
    )
    ```

  - **The stage-time re-aim** (`const grid = radioPaceGridBars(radioCadence.barEvery, radioSettings.loopEndOverBars, ...)`,
    in step (3), "A held mid-loop bar, checked again ..."): the same, with the held change's
    `slotId`.
    - This is spec timing risk 1. On the wrap tick the fold step is owed: it runs a microtask
      later, and `radioFoldStepOwedRef` already holds stages back for it. So the re-aim, which runs
      before any stage is built, sees the new `radioFoldNextRef`.
    - Confirm that order in the trace (`[radio]` stage-gate lines) during the walkthrough.

- [ ] **Step 5: The pick.** In `armRadioPick` (the one place radio draws a row:
  `pickRadioSlotId` / `pickRadioSlotIds` over `radioEligibleSlotIds()`):
  - Wrap that list in
    `radioFoldPickableIds(ids, radioFoldNowRef.current, radioFoldNextRef.current, radioCadence.fold && radioCadence.barEvery !== null)`.
  - **Not `radioEligibleSlotIds()` itself.** It is also the "still eligible" test that withdraws
    staged and held changes, and a pick on a row that becomes held after it must still land (at its
    top, by Step 4).

- [ ] **Step 6: Companions on a held row** (pace Task 9's companions in the staged project).
  - When the held change is aimed at a bar (`atBars` set), leave out of the stage any companion
    whose row `radioFoldHoldsRow(...)` says is held, as one that is not ready is left out. Its row
    goes back to radio.
  - Do this where pace Task 9 filters not-ready companions for a bar stage.

- [ ] **Step 7: Verify, commit.**
  - Run: `npm run typecheck`, `npx eslint src/renderer/src/components/DiscoverPanel.tsx`, and
    `npx vitest run src/shared`.
  - No agent can run the app: say so. The walkthrough is Task 13's.
  - Commit `DiscoverPanel.tsx`. Message: `discover radio: fold follows the pace slider, phase 1 -- the interval's realignment preference and the fold step's hurry from radioCadenceOf, and in the bar band a row the fold holds is not picked and keeps to its tops (the clock's grid and the stage re-aim), its companions left off a bar stage`, then the trailer.

### Task 6: The pace readout names fold's cadence

**Files:**
- **sssketch:**
  - `src/shared/radioPace.ts`;
  - `src/shared/radioFoldPace.test.ts`;
  - `src/renderer/src/components/DiscoverRadioMenu.tsx`.
- **ell.ing/radio:** `src/ui/fullModel.ts` and `src/ui/full.ts`, plus `src/ui/fullModel.test.ts`
  if it pins the label.

This task depends on flag 5. If Elling says no, skip it.

- [ ] **Step 1: The failing test.**
  - Add `radioPaceLabel` to `radioFoldPace.test.ts`'s `./radioPace` import.
  - Append:

```ts
describe('radioPaceLabel in fold mode', () => {
  it("names fold's own window below 80, and the slider's words from there", () => {
    expect(radioPaceLabel(0, { fold: true })).toBe('8-32 bars')
    expect(radioPaceLabel(50, { fold: true })).toBe('8-32 bars')
    expect(radioPaceLabel(55, { fold: true })).toBe('6-20 bars')
    expect(radioPaceLabel(79, { fold: true })).toBe('1-2 bars')
    expect(radioPaceLabel(80, { fold: true })).toBe(radioPaceLabel(80))
    expect(radioPaceLabel(95, { fold: true })).toBe('ludicrous')
    expect(radioPaceLabel(50)).toBe('fast')
    expect(radioPaceLabel(50, {})).toBe('fast')
  })
})
```

- [ ] **Step 2: Implement.** In `radioPace.ts`, `radioPaceLabel` takes options:

```ts
export function radioPaceLabel(level: number, options: { fold?: boolean } = {}): string {
  const profile = radioPaceProfile(level)
  const p = profile.level
  // Fold mode (2026-10-03 fold follows pace): fold's own window up to where it joins the slider,
  // so the readout never names a word (slow / mid / fast) fold does not play.
  if (options.fold === true && p < RADIO_FOLD_PACE_JOINS) {
    const { min, max } = radioFoldPaceProfile(p).window
    return min === max ? `${min} bar${min === 1 ? '' : 's'}` : `${min}-${max} bars`
  }
```

  The rest of the function is unchanged. `RADIO_FOLD_PACE_JOINS` and `radioFoldPaceProfile` are
  declared further down the module; function hoisting and module-level `const` are both fine at call
  time.

- [ ] **Step 3: The callers.**
  - **Desktop.** `DiscoverRadioMenu.tsx`'s `PaceSlider` gains a `fold: boolean` prop, passed
    `radioSettings.foldMode` where it is rendered. Both of its `radioPaceLabel(shown)` calls become
    `radioPaceLabel(shown, { fold })`.
  - **Web.**
    - In `full.ts`, both `radioPaceLabel(...)` calls on the pace knob pass
      `{ fold: on.readFold().on }`.
    - When the fold switch flips (the `foldSwitch` handler, and the redraw from `readFold()`),
      refresh `paceWord`'s text too.
    - In `fullModel.ts`, `strip.paceLabel` needs the fold switch's state. Add it to the model's
      options where `full.ts` builds them (`foldOn: boolean`), and pass `{ fold: opts.foldOn }`.
    - Leave `src/dev/devRadio.ts` as it is (the dev line).

- [ ] **Step 4: Verify, commit (one commit per repo).**
  - **sssketch:** run `npx vitest run src/shared/radioFoldPace.test.ts src/shared/radioPace.test.ts`,
    `npm run typecheck` and eslint.
  - **ell.ing/radio:** run `npx vitest run src/ui` and `npm run typecheck`.
  - Messages:
    - sssketch: `radio pace readout in fold mode: fold's own window below 80 (8-32 bars at fast and below), the slider's words from there`;
    - web: `full mode: the pace readout names fold's window while fold is on`;
    - each followed by the trailer.

**Ship point A.**
- Run Task 13's suites for phase 1.
- Write the walkthrough into the handoff (Task 13 Step 3, items 1-4).
- Deploy the web only with Elling's go-ahead.

---

### Task 7: Shared carry helpers (`radioFold.ts`, `radioFoldLanes.ts`)

**Files (sssketch):**
- Modify: `src/shared/radioFold.ts`
- Modify: `src/shared/radioFoldLanes.ts`
- Create: `src/shared/radioFoldCarry.test.ts`

**Depends on:** Task 2. Inert until Tasks 10 and 11 call it, so it can land any time after Task 2.

- [ ] **Step 1: Write the failing test.** Create `src/shared/radioFoldCarry.test.ts`:

```ts
// Fold mode follows the pace slider, phase 2: a change on a folded row carries its fold, or
// releases it (radioFold.ts, radioFoldLanes.ts).
import { describe, expect, it } from 'vitest'
import {
  createRadioFold,
  radioFoldCanCarry,
  radioFoldCarry,
  radioFoldRelease,
  stepRadioFold,
  type RadioFoldRow,
  type RadioFoldStep
} from './radioFold'
import { radioFoldCycleRows } from './radioFoldLanes'

const R = (id: string, o: Partial<RadioFoldRow> = {}): RadioFoldRow => ({
  id,
  stemId: `${id}-1`,
  kinds: ['rhythmic'],
  barLength: 4,
  hooked: false,
  audible: true,
  percussive: false,
  ...o
})

function foldedStep(): { step: RadioFoldStep; rows: RadioFoldRow[] } {
  const rows = [R('d', { kinds: ['drums'], percussive: true }), R('p'), R('q')]
  let s = createRadioFold('autech')
  for (let k = 0; k < 300; k++) {
    const st = stepRadioFold(s, { rows, loopBars: 4, bpm: 120, fold: 40 })
    s = st.state
    if (st.cycles.length > 0 && st.state.rows.some((r) => r.mode === 'settled')) return { step: st, rows }
  }
  throw new Error('no fold settled')
}

describe('radioFoldCanCarry', () => {
  it("only a foldable stem at least as long as the fold's own carries it", () => {
    const { step } = foldedStep()
    const id = step.cycles[0].rowId
    const anchor = step.anchorId
    expect(radioFoldCanCarry(step.state, id, R(id, { stemId: 'new' }), anchor)).toBe(true)
    expect(radioFoldCanCarry(step.state, id, R(id, { stemId: 'new', barLength: 2 }), anchor)).toBe(
      false
    )
    expect(
      radioFoldCanCarry(step.state, id, R(id, { stemId: 'new', kinds: ['lead'] }), anchor)
    ).toBe(false)
    expect(radioFoldCanCarry(step.state, id, R(id, { stemId: 'new', hooked: true }), anchor)).toBe(
      false
    )
    expect(radioFoldCanCarry(null, id, R(id, { stemId: 'new' }), anchor)).toBe(false)
    const leaving = {
      ...step.state,
      rows: step.state.rows.map((r) => (r.rowId === id ? { ...r, unfoldSince: step.lap } : r))
    }
    expect(radioFoldCanCarry(leaving, id, R(id, { stemId: 'new' }), anchor)).toBe(false)
  })
})

describe('radioFoldCarry', () => {
  it('keeps the cycle id and runs on with the new stem; nothing is drawn', () => {
    const { step, rows } = foldedStep()
    const id = step.cycles[0].rowId
    const carried = radioFoldCarry(step, id, `${id}-2`, 4)
    expect(carried.cycles.find((c) => c.rowId === id)).toEqual({
      ...step.cycles.find((c) => c.rowId === id),
      stemId: `${id}-2`
    })
    expect(carried.state.draws).toBe(step.state.draws)
    // the next step keeps the fold for the new stem; an uncarried change would leave it
    const nextRows = rows.map((r) => (r.id === id ? { ...r, stemId: `${id}-2` } : r))
    const kept = stepRadioFold(carried.state, { rows: nextRows, loopBars: 4, bpm: 120, fold: 40 })
    expect(kept.state.rows.some((r) => r.rowId === id && r.stemId === `${id}-2`)).toBe(true)
    const dropped = stepRadioFold(step.state, { rows: nextRows, loopBars: 4, bpm: 120, fold: 40 })
    expect(dropped.state.rows.some((r) => r.rowId === id)).toBe(false)
    expect(radioFoldCarry(step, 'nobody', 'x', 4)).toBe(step)
  })
})

describe('radioFoldRelease', () => {
  it('the row leaves the state and the cycles, marked is recomputed, nothing drawn', () => {
    const { step } = foldedStep()
    const id = step.cycles[0].rowId
    const out = radioFoldRelease(step, id)
    expect(out.cycles.some((c) => c.rowId === id)).toBe(false)
    expect(out.state.rows.some((r) => r.rowId === id)).toBe(false)
    expect(out.marked).toBe(false)
    expect(out.state.draws).toBe(step.state.draws)
    expect(radioFoldRelease(step, 'nobody')).toBe(step)
  })
})

describe('radioFoldCycleRows carried', () => {
  it('names a carried row for its incoming stem; a changing row not carried stays unnamed', () => {
    const { step } = foldedStep()
    const id = step.cycles[0].rowId
    const members = [{ id, stemId: 'incoming' }]
    expect(radioFoldCycleRows([step], members, new Set([id])).has(id)).toBe(false)
    expect(radioFoldCycleRows([step], members, new Set([id]), new Set([id])).has(id)).toBe(true)
    expect(radioFoldCycleRows([step], [{ id, stemId: step.cycles[0].stemId }]).has(id)).toBe(true)
  })
})
```

  Add two tests that the spec's timing risk 2 calls for:
  - **A carry after the row started unfolding.** Make the state's row
    `{ ...r, mode: 'unfolding', path: [12, 16] }`, carry with `barLength` 4, and expect the path to
    end at `16` (the new full). Then step once and expect no throw, with the row still there or
    unfolded cleanly.
  - **A carry for a row the machine has let go.** `radioFoldCarry` on a step without the row
    returns the same object (already covered by `'nobody'`).

- [ ] **Step 2: Run it and watch it fail.**
  - Run: `npx vitest run src/shared/radioFoldCarry.test.ts`
  - Expected: FAIL on the missing exports and the 4-argument `radioFoldCycleRows`.

- [ ] **Step 3: Implement.**

  a. Append to `src/shared/radioFold.ts`:

```ts
/** PHASE 2. Whether a change bringing `incoming` onto a folded row may CARRY its fold: the new
 * stem takes over the row's running cycle (same id, origin and phase) instead of arriving
 * straight. Only a fold still on its way in or settled (never one asked to leave or walking back),
 * and only a stem that could fold here itself (radioFoldCanFold) and is at least as long as the
 * stem the fold was decided for -- so every length the fold has played or may still step through
 * (all shorter than the old stem) fits the new one, whatever the machine decides before it lands. */
export function radioFoldCanCarry(
  state: RadioFoldState | null,
  rowId: string,
  incoming: RadioFoldRow,
  anchorId: string | null
): boolean {
  const r = state?.rows.find((x) => x.rowId === rowId)
  if (r === undefined || r.mode === 'unfolding' || r.unfoldSince !== null) return false
  if (incoming.id !== rowId || incoming.stemId === null) return false
  if (!(incoming.barLength * 4 >= r.fullBeats)) return false
  return radioFoldCanFold({ ...incoming, audible: true }, anchorId)
}

/** PHASE 2. A carried change has landed on `rowId`: the fold now belongs to `stemId` (`barLength`
 * bars). The state's row and every step's cycle for it are re-pointed; nothing else moves (the
 * cycle id, origin, phase, path and walk are kept, so the engine's running cycle and the machine
 * agree) and nothing is drawn. A row the machine no longer holds is left alone: the engine plays
 * whatever is in force there (straight, if the fold has gone). Pure. */
export function radioFoldCarry(
  step: RadioFoldStep,
  rowId: string,
  stemId: string,
  barLength: number
): RadioFoldStep {
  if (
    !step.state.rows.some((r) => r.rowId === rowId) &&
    !step.cycles.some((c) => c.rowId === rowId)
  )
    return step
  const rows = step.state.rows.map((r) =>
    r.rowId === rowId
      ? {
          ...r,
          stemId,
          fullBeats: barLength * 4,
          ...(r.mode === 'unfolding' && r.path.length > 0
            ? { path: [...r.path.slice(0, -1), barLength * 4] }
            : {})
        }
      : r
  )
  return {
    ...step,
    state: { ...step.state, rows },
    cycles: step.cycles.map((c) => (c.rowId === rowId ? { ...c, stemId } : c))
  }
}

/** PHASE 2. A change landed STRAIGHT on a row the machine held (it could not carry, or a
 * mid-loop cut): the fold is over now, not at the next step. The row leaves the state and every
 * step's cycles, and `marked` is worked out again without it, so the readout and the turnaround's
 * realignment preference stop naming a fold no longer heard. Nothing is drawn. Pure. */
export function radioFoldRelease(step: RadioFoldStep, rowId: string): RadioFoldStep {
  if (
    !step.state.rows.some((r) => r.rowId === rowId) &&
    !step.cycles.some((c) => c.rowId === rowId)
  )
    return step
  const rows = step.state.rows.filter((r) => r.rowId !== rowId)
  const marked = marksTop(rows, step.lap, step.state.loopBeats)
  const rotate = step.state.rotate ?? null
  return {
    ...step,
    state: {
      ...step.state,
      rows,
      marked,
      rotate: rotate !== null && (rotate.from === rowId || rotate.to === rowId) ? null : rotate
    },
    cycles: step.cycles.filter((c) => c.rowId !== rowId),
    marked
  }
}
```

  b. `src/shared/radioFoldLanes.ts`, `radioFoldCycleRows`:
     - Add the parameter `carried: ReadonlySet<string> = new Set()` after `changing`.
     - Change the loop head to:

```ts
  for (const m of members) {
    if (m.stemId === null) continue
    // a change carrying the row's fold (radioFoldCanCarry): its incoming stem takes the running
    // cycle, so the row is named whatever stem the steps were decided for
    if (carried.has(m.id) && steps.some((s) => s?.cycles.some((c) => c.rowId === m.id))) {
      out.add(m.id)
      continue
    }
    if (changing.has(m.id)) continue
```

  The rest is unchanged. Extend its doc comment with "A row in `carried` (its change carries the
  fold) is named for its incoming stem."

- [ ] **Step 4: Run it and watch it pass.**
  - Run: `npx vitest run src/shared/radioFold*.test.ts`
  - Expected: PASS.

- [ ] **Step 5: Lint, typecheck (both repos), commit** the three files.
  - Message: `radio fold, carried changes (shared): radioFoldCanCarry (a folding or settled fold, a foldable incoming stem at least as long as the old one), radioFoldCarry and radioFoldRelease (pure, no draws), radioFoldCycleRows names a carried row for its incoming stem`, then the trailer.

### Task 8: Native, a carried cycle across a stem swap (test first)

**Files (sssketch):** `native-engine/Source/PlaybackEngineTests.cpp`. Add `PlaybackEngine.cpp` only
if the test fails.

- [ ] **Step 1: Write the test.**
  - Put it after `a fold tail is matched by row and audio file, so it survives a project swap at the same top`.
  - It uses that block's `foldProject`, `foldRow` and `writeRampFixtureWav`. `foldProject` is 60 bpm,
    a 4-bar (16 s) loop, and a 7-beat cycle of 7 s.

```cpp
            // Radio fold, phase 2 (spec 2026-10-03-radio-fold-follows-pace-design section 3): a
            // change landing mid-lap on a folded row whose incoming stem names the row CARRIES the
            // fold -- the cycle table is keyed by row, so the live entry keeps its id and origin,
            // and the incoming stem plays the running cycle from where it is. One whose stem does
            // not name the row plays straight.
            beginTest("a stem swapped into a folded row mid-lap that names the row plays the running cycle on, origin kept");
            {
                auto ramp = writeRampFixtureWav("sssketch_pe_fold_carry_a.wav", 16 * 44100);
                auto other = writeRampFixtureWav("sssketch_pe_fold_carry_b.wav", 16 * 44100);
                StemBufferCache cache;
                ChannelChainRegistry channelChains;
                PlaybackEngine engine(cache);
                engine.setProject(foldProject(ramp, "perc"));
                engine.stageCycles(foldRow(7.0 / 4.0, 0.0), true);
                expect(engine.applyStagedCycles(false));
                const at = [&](double lapSec, double baseBars) {
                    float l = 0.0f, r = 0.0f;
                    engine.renderBlock(lapSec / 4.0, 44100.0, 1, &l, &r, channelChains, LapClock { baseBars, 1 });
                    return l;
                };
                // lap 0 stamps the origin at 0; lap 1 (base 4 bars, 16 s on the grid) runs on it
                expectWithinAbsoluteError(at(0.5, 0.0), 0.5f / 16.0f, 0.002f);
                expectWithinAbsoluteError(at(7.5, 4.0), 2.5f / 16.0f, 0.002f); // 23.5 mod 7
                // carried: another file, the same row, swapped in at bar 2 of lap 1
                auto carried = foldProject(other, "perc");
                carried.rifffs[0].stems[0].stemKey = "fold-carried:1";
                carried.rifffs[0].stems[0].cycleStemHash = cycleStemHashOf(carried.rifffs[0].stems[0]);
                engine.setProject(carried);
                expectWithinAbsoluteError(at(8.5, 4.0), 3.5f / 16.0f, 0.002f); // 24.5 mod 7, not 8.5
                expectWithinAbsoluteError(at(9.5, 4.0), 4.5f / 16.0f, 0.002f);
                // straight: the same file, its row not named -- the loop's own position
                engine.setProject(foldProject(other, ""));
                expectWithinAbsoluteError(at(10.5, 4.0), 10.5f / 16.0f, 0.002f);
                ramp.deleteFile();
                other.deleteFile();
            }
```

- [ ] **Step 2: Build and run.**
  - Run:
    `cd native-engine && cmake --build build && build/sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine --test PlaybackEngine`
  - Expected: PASS with no engine change. The table is not reset by `setProject`, and
    `cycleTable.find(stem.cycleRowKey)` keys on the row.
  - **If it fails,** find what resets or re-keys the live entry on a project change, and make the
    smallest fix that keeps every existing `--test` passing. The fix is part of this task.
  - If the whole-suite run trips the machine-dependent engine-spawn tests, see memory coreaudiod.

- [ ] **Step 3: The whole native suite.**
  - Run: `.../sssketch-engine --test`
  - Expected: green, apart from the known machine-dependent ones.

- [ ] **Step 4: Commit.**
  - Message: `engine: a stem swapped into a folded row that names the row plays the running cycle on, origin kept (radio fold carry); one that does not plays straight -- test only, no engine change needed`
    (or describe the fix), then the trailer.
  - Remind in the handoff: **Cmd+Q and relaunch** if the engine changed.

### Task 9: Web audio, carrying a fold through a swap (`timeline.ts`, `engine.ts`, `controller.ts`)

**Files (ell.ing/radio):**
- `src/audio/timeline.ts`
- `src/audio/timeline.test.ts`
- `src/audio/engine.ts`
- `src/radio/controller.ts`
- `src/radio/controller.test.ts`, if it covers `landAt`

**Depends on:** Task 7 (types only). Combos Task 3 must have committed: `engine.ts` is dirty in the
working tree. Combos Task 4 must have committed: it edits `controller.ts`.

- [ ] **Step 1: Write the failing timeline tests.** Append to `src/audio/timeline.test.ts`, which has
  `stem`, `BPM`, `LEAD` and `MIN` already:

```ts
describe('Timeline: carrying a fold through a swap (radio fold, phase 2)', () => {
  function folded() {
    const tl = new Timeline<TimelineStem>(BPM)
    const a = stem(4)
    tl.setRow('a', a, 0, LEAD, MIN) // the loop at 0.1, 8 s laps
    tl.setRow('d', stem(4), 0.001, LEAD, MIN)
    tl.setCycles(8.1, [{ rowId: 'a', id: 'a~1', bars: 1.75, phaseBars: 0, stemId: a.stemId }], 1, MIN)
    tl.setCycles(16.1, [{ rowId: 'a', id: 'a~2', bars: 1.5, phaseBars: 0, stemId: a.stemId }], 9, MIN)
    return { tl, a }
  }

  it('a carried bar swap keeps the running cycle and re-points the next top fold step', () => {
    const { tl } = folded()
    const b = stem(4)
    tl.swapAt('a', b, 8.1 + 2 * 2, 9, MIN, true) // bar 2 of the lap from 8.1
    const row = tl.rows.get('a')!
    expect(row.find((x) => Math.abs(x.from - 12.1) < 1e-9)).toEqual({ from: 12.1, stem: b, cycle: { id: 'a~1', bars: 1.75, phaseBars: 0, origin: 8.1 } })
    expect(row.find((x) => Math.abs(x.from - 16.1) < 1e-9)).toEqual({ from: 16.1, stem: b, cycle: { id: 'a~2', bars: 1.5, phaseBars: 0, origin: 16.1 } })
    // the incoming voice enters at its place in the cycle: 4 s past an 8.1 origin, 3.5 s a cycle
    const v = planVoices(tl.clocks, row, 12.1, 13).find((x) => x.stem === b)!
    expect(v.offset).toBeCloseTo((12.1 - 8.1) % 3.5, 9)
    expect(v.cycle?.id).toBe('a~1')
  })

  it('without carry exactly as before: straight, and the fold steps after it dropped', () => {
    const { tl } = folded()
    const b = stem(4)
    tl.swapAt('a', b, 12.1, 9, MIN)
    const row = tl.rows.get('a')!
    expect(row[row.length - 1]).toEqual({ from: 12.1, stem: b })
  })

  it('a carried swap at a top takes the cycle setCycles put there', () => {
    const { tl } = folded()
    const b = stem(4)
    tl.swap('a', b, 16.1, 9, MIN, true)
    const row = tl.rows.get('a')!
    expect(row[row.length - 1]).toEqual({ from: 16.1, stem: b, cycle: { id: 'a~2', bars: 1.5, phaseBars: 0, origin: 16.1 } })
  })

  it('a take-back (the old stem carried back at the same bar) restores both, seamlessly', () => {
    const { tl, a } = folded()
    const b = stem(4)
    tl.swapAt('a', b, 12.1, 9, MIN, true)
    tl.swapAt('a', a, 12.1, 9.5, MIN, true)
    const row = tl.rows.get('a')!
    expect(row.filter((x) => x.from >= 12.1 - 1e-9).map((x) => [x.from, x.stem, x.cycle])).toEqual([
      [12.1, a, { id: 'a~1', bars: 1.75, phaseBars: 0, origin: 8.1 }],
      [16.1, a, { id: 'a~2', bars: 1.5, phaseBars: 0, origin: 16.1 }]
    ])
    const at = planVoices(tl.clocks, row, 11, 13).find((x) => Math.abs(x.start - 12.1) < 1e-9)
    expect(at === undefined || at.fadeIn === 'xfade').toBe(true)
  })
})
```

  Add `import { planVoices } from './schedule'` if the file lacks it.

- [ ] **Step 2: Run it and watch it fail.**
  - Run: `npx vitest run src/audio/timeline.test.ts`
  - Expected: FAIL. The carried tests see straight assignments, because the `carry` argument is
    ignored.

- [ ] **Step 3: Implement `timeline.ts`.**
  - `swap` and `swapAt` gain a last parameter, `carry = false`.
  - In each, `assign(d, rowId, atTime, stem)` becomes:

    ```ts
    if (carry) carryAssign(d, rowId, atTime, stem)
    else assign(d, rowId, atTime, stem)
    ```

  - Add to the doc comments: "With `carry` (radio fold, phase 2), the row's fold carries on with
    `stem` (carryAssign)."
  - Below `assign`, add:

```ts
/** Radio fold mode, a change CARRYING a row's fold (@shared radioFoldCanCarry): `stem` takes over
 * what the row plays at `from` -- its cycle, same id and origin, so it enters at its matching
 * place in the running cycle -- and every later assignment of the outgoing stem (the fold's own
 * steps at the coming tops, which setCycles made for it) is re-pointed to `stem`, cycle and all.
 * Anything else later (another stem's change) is dropped, as assign drops it. A row with no cycle
 * at `from` is an ordinary assign. */
function carryAssign<S>(d: State<S>, rowId: string, from: number, stem: S): void {
  const old = d.rows.get(rowId) ?? []
  const cur = assignmentAt(old, from)
  const row: Assignment<S>[] = old.filter((a) => a.from < from - EPS)
  row.push(cur?.stem && cur.cycle ? { from, stem, cycle: cur.cycle } : { from, stem })
  for (const a of old) {
    if (a.from <= from + EPS || !cur?.stem || a.stem !== cur.stem) continue
    row.push(a.cycle ? { from: a.from, stem, cycle: a.cycle } : { from: a.from, stem })
  }
  d.rows.set(rowId, row)
}
```

- [ ] **Step 4: `engine.ts` and `controller.ts`.**
  - **`Engine`.**
    - `scheduleSwap(rowId, stem, atTime, transition?, carry = false)` passes `carry` to
      `this.tl.swap(..., MIN_LEAD_SEC, carry)`.
    - `scheduleSwapAt(rowId, stem, atTime, carry = false)` passes it to `this.tl.swapAt`.
    - The deps interface in `controller.ts` (`scheduleSwap(...)` / `scheduleSwapAt(...)`) gains the
      same optional parameter.
  - **`controller.ts`.**
    - The `landAt` action's change carries an optional `carry?: true`. Its type lives in `step.ts`'s
      `RadioAction`; add the field there in this task, unused by the reducer until Task 10.
    - Where `landAt` is applied, pass `c.carry === true` to `scheduleSwapAt` (when `a.bar`) or
      `scheduleSwap`.
    - The bar take-back's reschedule of the playing stem (the `cancel` with `bar: true`) must carry
      too when the row is folded, so its cycle comes back. Give `cancel` an optional `carry?: true`,
      and pass it to `scheduleSwapAt`.
  - Test, in `controller.test.ts` if it has a `landAt` harness: a `landAt` change with
    `carry: true` reaches the engine double with `carry` true.

- [ ] **Step 5: Run, typecheck, commit.**
  - Run: `npx vitest run src/audio src/radio` and `npm run typecheck`.
  - Commit the files. Message: `fold carry (web audio): Timeline.swap / swapAt carry a row's fold -- the incoming stem takes the cycle in force (same id and origin, entering at its place in the cycle) and the outgoing stem's later fold steps are re-pointed to it; a carried take-back plays seamlessly; Engine and the controller pass carry from landAt and a bar cancel`, then the trailer.

### Task 10: Web radio, phase 2 (`step.ts`)

**Files (ell.ing/radio):** `src/radio/step.ts`, `src/radio/step.test.ts`

**Depends on:** Tasks 4, 7 and 9.

- [ ] **Step 1: Write the failing tests** in the `the pace bar band` describe, after the phase-1
  test:
  - **`fold mode in the bar band (phase 2): a folded row cuts mid-loop, carried when the stem can, its cycle id running on`.**
    - At 100, fold 80, 5 rows, seeds 10-12.
    - Collect every `landAt` with `bar: true` whose change has `carry: true`. Expect at least one.
    - For each, the next `fold` event that names its row keeps the row's last `cycleId` (carried,
      not restarted), unless the machine stepped it.
    - Phase 1's "never on a held row" test is **replaced** by this. In the band, held rows now
      land mid-loop.
  - **`a straight landing on a held row releases its fold at once`.**
    - Force a pick that cannot carry: `sim.pickFor = () => rec2bars` (a 2-bar record) for the
      folded row.
    - After it lands, `sim.s.foldNow` / `sim.s.foldNext` no longer name that row, and
      `readoutView`'s fold status shows it straight.
  - **`hold takes back a carried bar change with carry`.** The `cancel` action carries
    `carry: true`.
  - **`at 79 and below nothing carries`.** No `carry` on any `landAt` at 75 in fold. Byte identity
    at 50 and below is Step 4's harness.

- [ ] **Step 2: Run them and watch them fail** (no `carry` in any `landAt`).

- [ ] **Step 3: Implement.**
  - **Remove phase 1's restrictions:**
    - `arm` goes back to the unfiltered list. Drop `radioFoldPickableIds`: the same array, so no
      draw changes in or out of the band.
    - `changeGrid` passes `cadence.barEvery`. Drop `radioCadenceBarEvery`.
    - The held-companion drop goes.
  - **`RadioLed`, and each companion** (pace Task 8's shape), gain `carry?: boolean`. In `decide`
    (and where companions are decided), set it when:
    - `cadence.fold && cadence.barEvery !== null`;
    - the row is held (`radioFoldHoldsRow(s.foldNow, s.foldNext, slot)`);
    - `radioFoldCanCarry(s.fold, slot, rowNow, radioFoldAnchor(foldRows(s, nextWrap)))`, where
      `rowNow` is the incoming row as `foldRows` builds one for that row with the incoming record:
      its stem id, `record.bars`, the row's kinds, `hooked` from the flags, and `percussive` from
      the record's mask.
  - **`scheduleLed`, `scheduleLedAtBar` and the companions' `landAt` changes** carry
    `...(led.carry && { carry: true })`.
  - **Every bar take-back** (`cancelLed` with `bar: true`, and the companions') carries `carry: true`
    when the row is held, so the cycle comes back.
  - **`land` (and the companions' landing).** On a held row:
    - `led.carry`: set `s.foldNext = radioFoldCarry(s.foldNext, slot, record.id, record.bars)`,
      then `s.fold = s.foldNext.state`, and `s.foldNow = radioFoldCarry(s.foldNow, ...)` when it
      names the row.
    - Otherwise: `radioFoldRelease` on `s.foldNext` and `s.foldNow` the same way.
    - Each of these does nothing when the step is null.
  - **Header comment and `changeGrid`'s doc:** "phase 2: a folded row lands mid-loop too, carrying
    its fold (radioFoldCanCarry) or releasing it".

- [ ] **Step 4: Run, byte-identity, typecheck, commit.**
  - Run: `npx vitest run src/radio src/audio`.
  - Re-run Task 4's harness: identical to Task 4's commit at no level, 0, 25 and 50, fold on and
    off. Carry is only ever set in the band.
  - Commit. Message: `radio: fold follows the pace slider, phase 2 -- in the bar band a folded row lands mid-loop too: a stem that can carry the fold (radioFoldCanCarry) takes over the running cycle (landAt carry, re-pointed with radioFoldCarry at the landing), one that cannot cuts straight and releases the fold at once (radioFoldRelease); bar take-backs carry; phase 1's pick filter and held grid removed`, then the trailer.

### Task 11: Desktop, phase 2 (`DiscoverPanel.tsx`)

**Files (sssketch):** `src/renderer/src/components/DiscoverPanel.tsx`

**Depends on:** Tasks 5, 7 and 8.

- [ ] **Step 1: Remove phase 1's restrictions.**
  - `armRadioPick` goes back to the unfiltered list.
  - Both grids pass `radioCadence.barEvery`.
  - The held-companion filter goes.

- [ ] **Step 2: Decide the carry** where the held change is set (both the early decision in step
  (2) and the due branch), and per companion.
  - `foldCarry: true` when:
    - `radioCadence.fold && radioCadence.barEvery !== null`;
    - `radioFoldHoldsRow(radioFoldNowRef.current, radioFoldNextRef.current, slotId)`;
    - `radioFoldCanCarry(radioFoldRef.current, slotId, incomingRow, anchorId)`.
  - `incomingRow` is that row as `radioFoldRowsAt` would see it with the incoming stem: its CID,
    `incomingBars`, the slot's kinds, `hooked`, and `percussive` from the stem's sound type.
  - `anchorId` is `radioFoldNextRef.current?.anchorId ?? null`.
  - Store `foldCarry` on `RadioLedChange` and on each companion.

- [ ] **Step 3: Name carried rows in the stage.** In the project build's fold block,
  `radioFoldCycleRows([...], members, changing)` gains a fourth argument: the set of slot ids in
  `stage.changes` whose change has `foldCarry`.
  - A carried row then keeps `cycleRow` for its incoming stem, and the engine plays the running
    cycle (Task 8).
  - Drift: a bar stage already uses `radioFoldNowRef`'s drift (unchanged).

- [ ] **Step 4: Re-point the machine at the landing.**
  - Where a staged change is committed (the landing branch's `commitSlotPick` for radio's row and
    each companion), on a row `radioFoldHoldsRow` says is held:
    - **`foldCarry`:** run `radioFoldCarry(step, slotId, stemCID, bars)` on
      `radioFoldNextRef.current` and `radioFoldNowRef.current`, and set
      `radioFoldRef.current = radioFoldNextRef.current.state`.
    - **Otherwise:** `radioFoldRelease` on the same.
  - Then `publishRadioFoldStatus(loopBars)`, so the row's `7 / 16` readout stays (carry) or clears
    (release).
  - **At a top, the wrap's step is owed** (`radioFoldStepOwedRef`) and runs after the landings, so
    the carry is applied to the state that step reads. Keep the order: landing commit, then
    carry/release, then the deferred step. Note it on the line.

- [ ] **Step 5: Verify, commit.**
  - Run typecheck, eslint and `npx vitest run src/shared`.
  - Commit. Message: `discover radio: fold follows the pace slider, phase 2 -- in the bar band a folded row lands mid-loop too: the change carries the fold when its stem can (foldCarry; the stage names the row for the incoming stem, the engine's cycle runs on; radioFoldCarry at the landing) or cuts straight and releases it (radioFoldRelease); phase 1's pick filter and held grid removed`, then the trailer.

**Ship point B.**

---

### Task 12 (optional, spec gate 6): A change that loses its top to the arc takes the next lap's first line (web)

**Files (ell.ing/radio):** `src/radio/step.ts`, `src/radio/step.test.ts`

**Depends on:** Task 10. Do it only if Elling wants flag 10.

- [ ] **Step 1: The failing test.**
  - At 95 (fold off and on), with the density arc on, find a `landAt` that was refused its top by
    an arc step (`arcStepAt`).
  - Expect it to land at the first bar line of the next lap at least `BAR_LEAD_SEC` ahead, not at
    the following top.

- [ ] **Step 2: Implement.** In `scheduleLed`, where `if (arcStepAt(s, nextWrap)) return`:
  - In the band, when the change's grid is finer than the loop (`changeGrid(...) < t.loopBars`), set
    a flag on the led (`afterArc: true`).
  - At the wrap, the existing "a mid-loop change still waiting ... atBars = 0" line also turns
    `afterArc` into `atBars = 0`, so `scheduleLedAtBar` aims it at the first line far enough ahead.
  - Below the band nothing changes.

- [ ] **Step 3: Run, harness at 50 and below** (identical), **commit.**

### Task 13: Cross-repo verification, review, and handoff

- [ ] **Step 1: Full suites in the real repos.**
  - **sssketch:** `npm test` (the engine-spawn tests are machine-dependent), `npm run typecheck`,
    and `npm run lint` (the 4 known prettier warnings are fine).
  - **Native:** `--test`.
  - **ell.ing/radio:** `npx vitest run` and `npm run typecheck`.
  - If neither runtime calls `radioCadenceBarEvery` or `radioFoldPickableIds` any more (after
    Tasks 10 and 11), delete them and their tests in one sssketch commit.
- [ ] **Step 2: An independent reviewer per phase** (superpowers:requesting-code-review), with spec
  sections 3 and 9 as the checklist. Keep reviewers on radio-timing code: same-tick order, carry
  between decision and landing, take-backs, pause.
- [ ] **Step 3: Handoff.**
  - Add a section to `docs/superpowers/HANDOFF-2026-10-03.md`, or a new dated handoff.
  - Write a memory file `radio_fold_follows_pace_shipped.md` with a `MEMORY.md` line.
  - Say plainly that no agent has heard it.
  - The walkthrough is spec section 10's.
  - The flags still open are spec flags 1-10.
  - If Task 8 changed the engine: Cmd+Q and relaunch.
- [ ] **Step 4: Deploy only with Elling's go-ahead** (`deploy/deploy-page.sh`).
