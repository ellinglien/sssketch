# Radio Intensity Arc Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the radio sections, in both radios (sssketch's Discover radio and ell.ing/radio):
- a **build** over 2-4 phrases, in which picks for drums and bass lean busier and heavier and rows
  are added;
- a **breakdown** on the one, in which drums thin or drop, the bass leaves, and pads and leads carry
  the bed;
- **the drop**: drums and bass come back with the full riser and gap, then a ride at the top;
- every few cycles, **a bigger peak**.

It is led by rhythm and low end (Elling, 2026-10-05). It is driven by a per-stem intensity score,
and two dials, `energy` and `drama`, control it. `build` and `drop` buttons force it. It runs only
under `density: intensity`. The web plays it for every visitor; the desktop stays on `arc` until
Elling switches.

**Spec:** `docs/superpowers/specs/2026-10-05-radio-intensity-arc-design.md` (c2ba5ca0, plus this
plan's commit, which records Elling's four answers as Decided). Read it first. Its review
checklist is §10 (byte-identity), §12 (timing risks) and §13 (tests and the walkthrough).

**Architecture:**
- **Pure rules in `src/shared/`, TDD:**
  - four new modules: `radioIntensity.ts` (the score and the lean), `radioIntensityArc.ts` (the
    machine), `stemLevel.ts` (loudness) and, through Task 5, the arc's words;
  - optional, absent-is-today parameters on existing modules: `rankCandidates` `intensity`,
    `RadioChangeForecast.arcRole`, `TurnaroundInput.drop`, `RadioHooksStepInput.dropAtNextWrap` /
    `inBreakdown` / row `arcResting`, `ThrowTick.dropAt`, the readout's `breakdown` / `drop`
    states, and the phone's `arc`.
- **Each runtime only drives them:** the web reducer (`ell.ing/radio src/radio/step.ts`) and the
  desktop panel (`DiscoverPanel.tsx`). Neither engine changes:
  - a rest is the hooks' resting landing, now with an owner;
  - the riser, the gap and the echo throw already exist;
  - the `EngineProject` wire format is untouched.
- **The analysis pipeline gains one measurement** (loudness, from every channel of the decode it
  already does), versioned as a sub-version (`levelVersion`). The ambient scans backfill it under
  their existing consent gates. The web index carries the score as `x`.
- **One guarantee:** with `density` not `intensity`, every shared function draws exactly what it
  drew before, pinned by fingerprints recorded from the unmodified code. The web's action log is
  byte-identical, and the fold fingerprint `0540eeea` holds.

**Phases** (each ends at a ship point Elling can listen to; deploy only with his go-ahead):
1. **The arc, heard on the web first** (Tasks 1-8). Ship point A. The score works from day one
   without loudness: it renormalises (spec §2.1).
2. **The desktop** (Tasks 9-11). Ship point B.
3. **Loudness** (Tasks 12-14). Ship point C: better scores. Task 12 is parallel-safe from the
   start, and Task 13 can land any time after it. Their backfill needs days of ambient scanning,
   so start them early.
4. Cross-repo verification, review, handoff, walkthrough (Task 15).

**Tech Stack:** TypeScript and vitest (both repos), React and Electron (sssketch), plain DOM and
Web Audio (ell.ing/radio).

**Repos:**
- **sssketch** (`/Users/nickel/Claudecode/sssketch`): Tasks 1-5, 9-13, 14 (the dev scan), 15.
  Base: `master` at this plan's commit (on b89face5, a spec-only commit over a9d68ef4, which the
  code was written against).
- **ell.ing/radio** (`/Users/nickel/Claudecode/ell.ing/radio`): Tasks 5 (one test line), 6, 7, 8,
  14 (the export). Base: `main` at `b9b5ae1`.
- **How the two connect.** The web imports sssketch's `src/shared` through `@shared`, from
  sssketch's **working tree** (or `SSSKETCH_DIR`).
  - Every shared task here is additive and keeps the web's `npm run typecheck` (with
    `noUnusedLocals`) and its tests green, with one exception.
  - Task 5's chip rename turns ONE web test red (`src/ui/fullModel.test.ts:340` pins the chip
    labels). Task 5 changes that line in the web repo in the same sitting and commits it there.

**Branches:** `radio-intensity-arc` in each repo (`git switch -c radio-intensity-arc`).

**Commits:** every commit message ends with exactly these two lines, after a blank line:

```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KK8TyKjVKvWU8ZjQCk3ozz
```

Commit each task's own files only (`git add <paths>` or `git commit --only <paths>`), never
`git add -A`. Other agents share these working trees.

**Before you start, in both repos:**
- Run `git status --short`. Note other agents' files and leave them alone.
- **sssketch:** run `npm test` and `npm run typecheck`. The suite is green except for the
  machine-dependent engine-spawn tests (memory `coreaudiod_thread_leak`); in a checkout with no
  `native-engine/build`, those fail with "binary not found".
- **ell.ing/radio:** run `npx vitest run` and `npm run typecheck`. The repo-wide `testTimeout` is
  30 s.
- **sssketch's CI** excludes test files that open better-sqlite3 (`vitest.config.ts`'s list).
  - Every main-process test in this plan goes into a file already on that list:
    `discoverCandidates.test.ts`, `traitQuantileCache.test.ts`,
    `stemAnalysisResultsWriter.test.ts`, `stemAnalysisNeeds.test.ts`.
  - `discoverSettingsStore.test.ts` opens no database.
  - **A new main test file that opens a database must be added to that list**, or the release
    build dies with dead workers and no failed test named.
- **The code** was written against sssketch `a9d68ef4` and ell.ing/radio `b9b5ae1`. If a file has
  moved on, make the same edits by hand, anchored on the quoted context and function names, never
  on line numbers.

---

## How this plan's code was checked

Planning scratchpad:
`/private/tmp/claude-501/-Users-nickel-Claudecode-sssketch/16705ad5-406f-4f11-81e4-e91aab27bbc8/scratchpad/intensity/`

| folder | what it is |
|---|---|
| `sssketch/` | sssketch at a9d68ef4 with every sssketch code block below applied: shared, main, renderer audio and preload |
| `staged/` | the same changes re-applied **task by task in this plan's order**, one commit per task (`git log`: T1, T2, T3, T4, T5, T12, T9, T13). Its final tree equals `sssketch/` (`diff -rq`: identical) |
| `stages/radioTurnaround.t4.ts` | Task 4's `radioTurnaround.ts`: the drop without Task 5's labels |
| `web/` | ell.ing/radio at b9b5ae1, `@shared` pointed at `../sssketch`, with Task 5's test line and Task 6's and Task 7's pure parts (`pick.ts`, `settings.ts`, `ui/densityPrefs.ts`) applied |
| `webbase/` | ell.ing/radio at b9b5ae1, untouched, `@shared` pointed at `../staged` |

- **Every code block below is the scratch copy's file or diff, verbatim**, for every shared task,
  the main-process and renderer-audio tasks (9, 13), and the web's pure parts (6, and Task 7's
  `pick.ts`, `settings.ts` and `densityPrefs.ts`).
- **sssketch, all tasks in:**
  - `npm run typecheck` (node and web configs): clean;
  - `npx vitest run src/shared`: **174 files, 2873 tests passed** (164 and 2772 at a9d68ef4);
  - the main and renderer suites the tasks touch (`discoverCandidates`, `traitQuantileCache`,
    `stemAnalysisResultsWriter`, `stemAnalysisNeeds`, `discoverSettingsStore`, `discoverAdjacency`,
    `remotePage`, `remoteServer`, `src/renderer/src/audio`): **28 files, 510 tests passed**;
  - the full `npx vitest run src`: everything passes except the engine-binary tests (no
    `native-engine/build` in a scratch copy);
  - `eslint` on `src/shared src/main src/renderer/src/audio src/preload`: 0 errors. Its 3 warnings
    are pre-existing prettier warnings in files this plan does not touch;
  - `prettier --check` on every changed file: clean.
- **Task order:** in `staged/`, after each task `npm run typecheck` is clean and that task's tests
  pass. Tasks 1, 2, 3 and 12 were also applied **alone** to a9d68ef4: typecheck clean.
- **The web against the shared code:**
  - the unmodified web (`webbase/`) after Tasks 1-4: typecheck clean, `npx vitest run src`: 864
    tests passed. One file fails to load (`src/fluoddity.test.ts`, `@fluoddity/embed.js`): its
    alias reaches outside a scratch copy, so that is the copy, not the code;
  - after Task 5: only `fullModel.test.ts:340` (the chip labels) fails, as expected;
  - `web/`, with Task 5's line and Tasks 6-7's pure parts: typecheck clean, **873 tests passed**
    (fluoddity as above).
- **Fingerprints (absent is today).** Each hash was recorded by running the test's own trace
  against the **unmodified** a9d68ef4 file (swapped in from git), then pinned. Each reproduces with
  the change in:
  - `rankCandidates` without `intensity`: `b6fdd2ab`, 2000 seeded rankings;
  - `stepRadioHooks` without the arc's inputs: `dd70db82`, 3000 seeded steps;
  - `stepThrows` without `dropAt`: `9207add6`, 20k seeded ticks;
  - the existing `ROLLS_BEFORE` and `TURNS_BEFORE` (`radioBuildSizeDraws.test.ts`) and the fold
    fingerprint `0540eeea` (`radioFoldHurry.test.ts`) pass unchanged with every task in.
- **Not compiled, written as precise instructions:** the runtime glue:
  - Task 7's `step.ts` and `controller.ts`, and Task 8's `full.ts`, `fullModel.ts` and `main.ts`;
  - Task 10's `DiscoverPanel.tsx`;
  - Task 11's `RadioStrip.tsx`, `remoteServer.ts` and `remotePage.ts`.

  `step.ts` and `DiscoverPanel.tsx` change daily. Every instruction is anchored on a function name
  and quoted context, with today's line numbers as a guide.
- **No agent can hear either radio, see the UI or hold a phone.** Nothing here claims otherwise.

## Decisions made in planning (Elling's are in the spec's Open questions, now all Decided)

1. **The chip rename is copy only.**
   - `TURNAROUND_MOVE_LABEL` reads `drums out` and `low out`. Every screen reads it: the desktop
     chips, the web chips, the phone's chips (`remotePage.ts` `TURN_CHIPS`), row flashes
     (`turnaroundFlashes`) and the ruler label (`turnaroundLabel`).
   - The ids `drum drop` and `low drop` stay. They are the phone's wire value (`/api/turn`'s
     `move`), the planner's tables and dozens of test names. Nothing user-facing shows them. The
     family name `drops` stays too.
   - `turnaroundLabel` gains a third, shorter form, the lead and the gap. A turn's ruler with a
     two-word lead (`turn: drums out +2 → gap`, 24 characters) broke the phone's 23-character
     test. It now reads `turn: drums out → gap`.
2. **A phase's length is drawn when the phase is decided**, not at its start.
   - This lets a one-lap phrase (loops of 16 bars or more) prepare two wraps ahead (spec §3.1).
   - It also makes "drop in N bars" exact from the breakdown's first bar.
   - §3.5's order becomes:
     1. radio's start: the first countdown, then the build's length;
     2. a cycle's decide wrap: the countdown when due, then the build's length;
     3. the breakdown's decide wrap: the echo throw's three draws, then its length;
     4. the drop's decide wrap: the renewals, then the ride's length.
   - A button's event draws nothing when pressed. Its length is drawn where it lands.
   - **The breakdown's echo throw draws three numbers** (beats, timing, feedback, the hook exit's
     own `drawThrowBeats` + `drawThrowEcho`). The spec said nothing is drawn there; the throw needs
     its shape.
3. **A build is raised to at least `adds + 1` phrases, always.** Adds land on the build's later
   phrase starts. The first build's first phrase start is radio's own start, where nothing can be
   decided ahead, so the spec's "else `adds`" would leave one add with no phrase start.
4. **`arcRole` gains a fifth value, `hold`.** It covers every other phrase end of a cycle (a
   build phrase with no add, the ride, a breakdown's middle). It is medium at most, with no
   promotion. This is spec §5.1's "every other phrase end ... capped at medium", made explicit.
5. **The drop's gap needs only one audible row** (`TurnaroundInput.drop`). Today a gap needs two.
   After a full breakdown with one carrier, the spec's "gaps at drama 50 and up are 100% of drops"
   could not hold otherwise, and silencing the lone carrier before the one is exactly the pre-drop
   silence.
6. **Hooks:**
   - `inBreakdown` means the next wrap is in a breakdown or starts one. Returns then wait for the
     drop, always: a breakdown is at most 2 phrases (plus the 1-phrase safety), so the spec's
     "when the drop is at most 2 phrases away" always holds.
   - A row's new `arcResting` stops a hooked-in row's clock and keeps its exit off.
7. **Throws aimed into the drop** (`ThrowTick.dropAt`) aim at the drop's downbeat, or at its gap's
   start when an armed turnaround's aim (`changeAt`) comes first. The send is post-fader, so the
   throw must close before the gap.
8. **Buttons:**
   - a forced drop renews nothing (renewals need a phrase of warming; spec §6 for the quick drop,
     and here for a pressed drop in a breakdown too);
   - a press is refused before the machine begins, and while held;
   - a press with its top already spoken for (an event decided for it) takes the top after
     (`forced`), and so does a `late` press.
9. **Loudness:**
   - `levelVersion` is a sub-version (spec §7.3). `StemAnalysisNeeds.level` is optional
     (absent = false), and main's answer carries `level: true` only when it is needed. So today's
     answers, today's test objects (`toEqual`) and an older main all read the same.
   - `AnalyzeStemOnceResult.level` is present only when asked for.
   - The merge is an `UPDATE` in place (`mergeStemFeatureLevelRow`). `ExtractedAt` and every other
     field are kept.
   - **The merge wakes only the value table** (`noteStemFeatureRowWritten`), not the overnight
     classifier: none of its inputs moved. The spec said `afterStemFeatureRowWritten`, which would
     wake the classifier once per backfilled stem for nothing.
   - The quantile tables need no new rebuild trigger. A merged row carries the Phase 3 fields, so
     the existing growth counter rebuilds the tables every 5% of the library backfilled.
   - `lowLevelDb` averages the channels (an identical-channel stereo stem reads as its mono).
     `loudnessLufs` sums them, as BS.1770 does. Values are rounded (0.01 dB, 0.001).
10. **`x` reaches a web candidate only while the lean runs** (`toCandidate`'s `withIntensity`).
    The pick result is in the action log, so an `intensity: null` on every candidate would break
    byte-identity.
11. **The phone:**
    - `RemoteState.arc?: RemoteArcView` (`{ phase, waiting, canBuild, canDrop }`) is the
      `turn`'s sibling;
    - `POST /api/arc` takes `{ action }`;
    - its answers are `building`, `dropping`, `not now` and `radio off` (`radio off` also when
      density is not `intensity`: the Mac sends no `arc`).
12. **The readout:**
    - `next: row 2 rests · 2 bars` keeps the bars, as every other `next` part does (the spec's
      table shows it without them);
    - a new input `narrow` gives the breakdown's short form (`breakdown · 12`);
    - the row word is the role words' `rests till the drop`, or `rests` on the phone.
13. **The strip:**
    - `build` and `drop` are `panel` controls in the play group, after `turn`;
    - `energy` and `drama` are `slider`s after `density`;
    - greyed, the tooltip ends `· with density intensity`, the strip's own pattern.
14. **The desktop warms an arc add a lap early**, as its density arc does (`radioWrapBeforeLastLap`),
    through `radioIntensityAddComing`. The web does the same through `addDecidesAt`.
15. **`releaseRadioIntensityRest`:** a resting row given back by hand (unmute, solo), changed by
    hand, locked or removed leaves the arc's rests and its decided lists. The drop still lands for
    the others.
16. **The value table grows from 5 to 8 columns** (`QUANTILE_FIELDS`), about +1.6 MB at 66k rows.

## File map

**sssketch `src/shared/`**
- **Create:**
  - `radioIntensitySettings.test.ts` (T1);
  - `radioIntensity.ts`, `radioIntensity.test.ts` (T2);
  - `radioIntensityArc.ts`, `radioIntensityArc.test.ts` (T3);
  - `radioIntensityBuilds.test.ts`, `radioIntensityHooks.test.ts`, `radioIntensityThrows.test.ts`
    (T4);
  - `radioReadoutIntensity.test.ts`, `remoteStateArc.test.ts` (T5);
  - `stemLevel.ts`, `stemLevel.test.ts`, `stemLevelFields.test.ts` (T12).
- **Modify:**
  - `radioSchedule.ts` (+ test), `radioStripModel.ts` (+ test) (T1);
  - `traitQuantiles.ts`, `discoverCandidate.ts`, `discoverRanking.ts` (T2);
  - `radioBuildSize.ts`, `radioTurnaround.ts` (the drop), `radioHooks.ts`, `radioThrows.ts`,
    `discoverThrows.ts` (T4);
  - `radioTurnaround.ts` (labels), `radioTurnaroundTurn.test.ts`, `radioTurnaroundCombos.test.ts`,
    `radioReadout.ts` (+ `radioReadout.test.ts`, `radioReadoutTurnaround.test.ts`),
    `remoteState.ts` (+ test) (T5);
  - `stemFeatures.ts`, `stemAnalysis.ts`, `stemAnalysisNeeds.ts`, `stemAnalysisWrite.ts` (T12).

**sssketch desktop**
- `src/main/discoverSettingsStore.test.ts` (T1).
- `src/main/traitQuantileCache.ts` (+ test), `discoverCandidates.ts` (+ test),
  `discoverAdjacency.ts`, `index.ts`, `src/preload/index.ts` (T9).
- `src/renderer/src/components/DiscoverPanel.tsx` (T10).
- `src/renderer/src/components/RadioStrip.tsx`, `src/main/remoteServer.ts` (+ test),
  `src/main/remotePage.ts` (+ test) (T11).
- `src/renderer/src/audio/stemAnalysisWorker.ts`, `stemAnalysisClient.ts`, `stemFeaturesCache.ts`,
  `analyzeStemOnce.ts`, `analyzeStemOnceLevel.test.ts` (new); `src/main/stemAnalysisNeeds.ts`
  (+ test), `stemFeatureCacheStore.ts`, `stemAnalysisResultsWriter.ts` (+ test) (T13).

**ell.ing/radio**
- `src/ui/fullModel.test.ts` (one line, T5).
- `src/index/intensityScores.ts` (new), `traitPercentiles.ts`, `shapeRecord.ts` (+ test),
  `buildIndex.ts` (+ test), `scripts/export-index.mjs` (header comment) (T6).
- `src/radio/pick.ts`, `pickIntensity.test.ts` (new), `settings.ts` (+ test),
  `src/ui/densityPrefs.ts` (+ test, new), `src/radio/step.ts`, `step.test.ts`, `density.test.ts`,
  `controller.ts` (+ test), `throwAim.ts` (T7).
- `src/ui/full.ts`, `full.css`, `fullModel.ts` (+ test), `src/main.ts` (T8).

## Task graph

```
Phase 1  T1 settings+strip ─┐
         T2 score+lean ─────┼──────────────────────────────┐
         T3 the machine ─┬─> T4 builds/drop/hooks/throws ──┤
                         └─> T5 words, chips, phone (+1 web test line)
         T2 ─> T6 web index `x`                            │
         T1..T6 ─> T7 web reducer ─> T8 web full mode ──────┴─ ship point A
Phase 2  T2 ─> T9 main: alsoIntensity, value table
         T3,T4,T5,T9 ─> T10 desktop panel ─> T11 desktop strip + phone ── ship point B
Phase 3  T12 level (shared) ─> T13 level pass + backfill (desktop) ─> T14 measured; index re-export ── ship point C
Last     all ─> T15 verify + handoff
```

- **Parallel-safe now** (new files, inert until a runtime calls them): T1, T2, T3, T12. T12 has
  no dependency at all, so start it first: its backfill takes days of ambient scanning.
- **Strictly in order:**
  - T3 → T4 (T4 imports T3's `RadioArcRole`);
  - T3 → T5 (T5's test imports T3's words);
  - T7 → T8 (both touch the web's view);
  - T10 → T11 (`DiscoverPanel.tsx`);
  - T12 → T13.
- **In parallel:**
  - T6 with T3-T5;
  - T9 with T3-T8;
  - the web phase (T7, T8) with the desktop phase (T10, T11);
  - T12 and T13 with everything.
- **T5 crosses repos:** commit the web's one line (`fullModel.test.ts`) right after T5's sssketch
  commit. The web reads sssketch's working tree, so it is red in between.
- **The web defaults flip in T7, not before.** Nothing on the web reads `settings.density` until
  T7's reducer does.

**Overlap with the simple / advanced view spec** (`2026-10-05-radio-simple-view-design.md`,
b89face5; not yet planned or built). That spec says to build after this arc, since both touch the
strip and the live bar.

| this plan | simple view | sequencing |
|---|---|---|
| T1: `energy` and `drama` sliders in the picks column | simple hides the columns; "when the intensity arc lands, add `energy` and `drama`" to simple's live bar | That spec's plan adds them to simple's live bar. Nothing here changes. |
| T11: `build` and `drop` fire buttons in the live bar, after `turn` | its live bar lists tempo, pace, skip, new bed, turn, level, and hides the move chips | `build` and `drop` are not move chips. That spec's plan decides whether simple shows them (ask Elling). Its pinned simple list must name them either way. |
| T1: the coverage test requires the two dials | its coverage test runs against advanced | No conflict. |

**Other agents' work:** check `git log` in both repos before each runtime task. `step.ts`,
`controller.ts` and `DiscoverPanel.tsx` are shared with other plans. Rebase onto their commits and
re-anchor by function name.

---

## Phase 1: the arc, heard on the web first

### Task 1: Settings and the strip (`radioSchedule.ts`, `radioStripModel.ts`)

**Parallel-safe.** **Depends on:** nothing.

**Files:**
- Modify: `src/shared/radioSchedule.ts`, `radioSchedule.test.ts`, `radioStripModel.ts`,
  `radioStripModel.test.ts`, `src/main/discoverSettingsStore.test.ts`
- Create: `src/shared/radioIntensitySettings.test.ts`

What changes:
- `RadioDensity` gains `intensity`.
- `RadioSettings` gains optional `energy` and `drama` (0-100, defaults 50 and 60, normalised).
- The strip gains:
  - the two dials after `density` (greyed unless intensity);
  - `build` and `drop` after `turn`;
  - the density hint sentence.
- The strip's coverage test (`STATES` iterates `RADIO_DENSITY_OPTIONS`) then requires the two
  dials.

**Inert in both runtimes until T7 and T10:**
- the desktop draws the two dials in its picks column at once, greyed unless density is
  `intensity` (`RadioShapingColumns`' generic `slider` case). Their double-click reset reads
  clash's default until T11 fixes the `defaultValue`. Its live bar draws controls by id, so
  `build` and `drop` stay invisible until T11;
- picking `intensity` on the desktop before T10 does what `off` does (`densityTick` returns
  unless `arc`). It is a branch, not a release.

- [ ] **Step 1: Write the failing tests.**
  - Create `src/shared/radioIntensitySettings.test.ts`:

```ts
// The intensity arc's settings (spec 2026-10-05-radio-intensity-arc-design section 8):
// radioSchedule.ts's `intensity` density, `energy` and `drama`.
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RADIO_SETTINGS,
  RADIO_DENSITY_OPTIONS,
  normalizeRadioDensity,
  normalizeRadioSettings,
  radioDensityOf,
  radioDramaOf,
  radioEnergyOf,
  radioIntensityOn
} from './radioSchedule'

describe('density intensity', () => {
  it('is an option, kept by normalize; the default stays arc', () => {
    expect(RADIO_DENSITY_OPTIONS).toEqual(['off', 'arc', 'intensity'])
    expect(normalizeRadioDensity('intensity')).toBe('intensity')
    expect(normalizeRadioDensity('loud')).toBe('arc')
    expect(DEFAULT_RADIO_SETTINGS.density).toBe('arc')
    expect(normalizeRadioSettings({ density: 'intensity' }).density).toBe('intensity')
    expect(radioIntensityOn(normalizeRadioSettings({ density: 'intensity' }))).toBe(true)
    expect(radioIntensityOn(DEFAULT_RADIO_SETTINGS)).toBe(false)
    expect(radioIntensityOn({})).toBe(false)
    expect(radioDensityOf({ ...DEFAULT_RADIO_SETTINGS, density: undefined })).toBe('arc')
  })
})

describe('energy and drama', () => {
  it('default to 50 and 60, clamped and rounded, a non-number taking the default', () => {
    expect(normalizeRadioSettings({})).toMatchObject({ energy: 50, drama: 60 })
    expect(normalizeRadioSettings({ energy: 120.4, drama: -3 })).toMatchObject({
      energy: 100,
      drama: 0
    })
    expect(normalizeRadioSettings({ energy: 33.6, drama: 'x' })).toMatchObject({
      energy: 34,
      drama: 60
    })
  })

  it('read as the defaults when absent (the web builds its own RadioSettings)', () => {
    expect(radioEnergyOf({})).toBe(50)
    expect(radioDramaOf({})).toBe(60)
    expect(radioEnergyOf({ energy: 7 })).toBe(7)
    expect(radioDramaOf({ drama: Number.NaN })).toBe(60)
  })
})
```

  - `radioStripModel.test.ts` (the order test, the greyed test, the dial test):

```diff
--- a/src/shared/radioStripModel.test.ts
+++ b/src/shared/radioStripModel.test.ts
@@ -3,6 +3,11 @@
 // a strip control fails it.
 import { describe, expect, it } from 'vitest'
 import {
+  RADIO_BUILD_TOOLTIP,
+  RADIO_DRAMA_TOOLTIP,
+  RADIO_DROP_TOOLTIP,
+  RADIO_ENERGY_TOOLTIP,
+  RADIO_WITH_INTENSITY,
   RADIO_CHANNEL_OPTIONS,
   RADIO_STRIP_GROUPS,
   RADIO_STRIP_HINTS,
@@ -144,7 +149,16 @@ describe('radioStripModel: groups and order', () => {
       settings({ density: 'off', turnarounds: 'rare', foldMode: true }),
       CTX
     )
-    expect(ids(g, 'play')).toEqual(['tempo', 'pace', 'skip', 'new-bed', 'turn', 'level'])
+    expect(ids(g, 'play')).toEqual([
+      'tempo',
+      'pace',
+      'skip',
+      'new-bed',
+      'turn',
+      'build',
+      'drop',
+      'level'
+    ])
     expect(ids(g, 'picks')).toEqual([
       'faves',
       'source',
@@ -152,6 +166,8 @@ describe('radioStripModel: groups and order', () => {
       'artist',
       'my-sounds',
       'density',
+      'energy',
+      'drama',
       'channels',
       'turnover'
     ])
@@ -193,6 +209,36 @@ describe('radioStripModel: greyed, not omitted', () => {
     }
   })
 
+  it('greys energy, drama, build and drop unless density is intensity, saying so', () => {
+    const want: Record<string, string> = {
+      energy: RADIO_ENERGY_TOOLTIP,
+      drama: RADIO_DRAMA_TOOLTIP,
+      build: RADIO_BUILD_TOOLTIP,
+      drop: RADIO_DROP_TOOLTIP
+    }
+    for (const d of RADIO_DENSITY_OPTIONS) {
+      const g = radioStripModel(settings({ density: d }), CTX)
+      for (const id of Object.keys(want)) {
+        const c = control(g, id)
+        expect(c?.disabled, `${id} ${d}`).toBe(d !== 'intensity')
+        expect(c?.tooltip, `${id} ${d}`).toBe(
+          d === 'intensity' ? want[id] : `${want[id]} · ${RADIO_WITH_INTENSITY}`
+        )
+      }
+    }
+  })
+
+  it('reads and patches energy and drama as sliders, the defaults when unset', () => {
+    const g = radioStripModel(settings({ density: 'intensity', energy: 30 }), CTX)
+    const e = control(g, 'energy')
+    const d = control(radioStripModel(settings({ drama: undefined }), CTX), 'drama')
+    if (e?.kind !== 'slider' || d?.kind !== 'slider') throw new Error('dials')
+    expect(e.value).toBe(30)
+    expect(e.patch(80)).toEqual({ energy: 80 })
+    expect(d.value).toBe(60)
+    expect(d.patch(10)).toEqual({ drama: 10 })
+  })
+
   it('greys families and depth while turnarounds is off', () => {
     for (const t of RADIO_TURNAROUNDS_OPTIONS) {
       const g = radioStripModel(settings({ turnarounds: t }), CTX)
```

  - `radioSchedule.test.ts` (the pinned defaults gain the two dials):

```diff
--- a/src/shared/radioSchedule.test.ts
+++ b/src/shared/radioSchedule.test.ts
@@ -1037,7 +1037,9 @@ describe('RadioSettings', () => {
       density: 'arc',
       faves: 0,
       paceLevel: 25,
-      sizedBuilds: true
+      sizedBuilds: true,
+      energy: 50,
+      drama: 60
     })
   })
 
```

  - `src/main/discoverSettingsStore.test.ts` (the round trip carries `intensity` and both dials):

```diff
--- a/src/main/discoverSettingsStore.test.ts
+++ b/src/main/discoverSettingsStore.test.ts
@@ -129,10 +129,12 @@ describe('discoverSettingsStore', () => {
         fold: 70,
         clash: 60,
         foldSeed: 'k3x9pq',
-        density: 'off',
+        density: 'intensity',
         faves: 60,
         paceLevel: 42,
-        sizedBuilds: false
+        sizedBuilds: false,
+        energy: 20,
+        drama: 85
       }
     })
     expect(loadDiscoverSettings().radio).toEqual({
@@ -150,10 +152,12 @@ describe('discoverSettingsStore', () => {
       fold: 70,
       clash: 60,
       foldSeed: 'k3x9pq',
-      density: 'off',
+      density: 'intensity',
       faves: 60,
       paceLevel: 42,
-      sizedBuilds: false
+      sizedBuilds: false,
+      energy: 20,
+      drama: 85
     })
   })
 
```

  - Run `npx vitest run src/shared/radioIntensitySettings.test.ts src/shared/radioStripModel.test.ts src/shared/radioSchedule.test.ts src/main/discoverSettingsStore.test.ts`.
    **Expected:** they FAIL. `intensity` is unknown, there are no dials, the order is missing
    `build`, `drop`, `energy` and `drama`, and normalize drops the fields.

- [ ] **Step 2: The settings.** `src/shared/radioSchedule.ts`:

```diff
--- a/src/shared/radioSchedule.ts
+++ b/src/shared/radioSchedule.ts
@@ -1053,12 +1053,26 @@ export function radioStarterKinds(channels: number): DiscoverSlotKind[] {
  * starts life as that preset's own numbers and diverges only if he steps
  * an edge. radioPaceWindowPreset reconciles the two for display. */
 /** The density arc (radioDensity.ts): `arc` grows and thins the rows while
- * radio runs; `off` keeps the count where it is. Elling likes it on. */
-export type RadioDensity = 'off' | 'arc'
-export const RADIO_DENSITY_OPTIONS: RadioDensity[] = ['off', 'arc']
+ * radio runs; `off` keeps the count where it is. Elling likes it on.
+ * `intensity` (radioIntensityArc.ts, spec 2026-10-05-radio-intensity-arc-design): builds, breaks
+ * down and drops, led by drums and bass -- it replaces the row-count arc while chosen, and drives
+ * the row count too. An older app reading a saved `intensity` normalises it to `arc`. */
+export type RadioDensity = 'off' | 'arc' | 'intensity'
+export const RADIO_DENSITY_OPTIONS: RadioDensity[] = ['off', 'arc', 'intensity']
 export const DEFAULT_RADIO_DENSITY: RadioDensity = 'arc'
 export function normalizeRadioDensity(value: unknown): RadioDensity {
-  return value === 'off' || value === 'arc' ? value : DEFAULT_RADIO_DENSITY
+  return value === 'off' || value === 'arc' || value === 'intensity' ? value : DEFAULT_RADIO_DENSITY
+}
+
+/** The intensity arc's two dials (spec 8), 0..100, whole: `energy` (where it sits, gentle with
+ * long breakdowns to driving with short ones) and `drama` (how far it swings, a subtle swell to
+ * the full breakdown and drop). */
+export const DEFAULT_RADIO_ENERGY = 50
+export const DEFAULT_RADIO_DRAMA = 60
+export function normalizeRadioDial(value: unknown, fallback: number): number {
+  return typeof value === 'number' && Number.isFinite(value)
+    ? Math.round(Math.min(100, Math.max(0, value)))
+    : fallback
 }
 
 export interface RadioSettings {
@@ -1104,6 +1118,24 @@ export interface RadioSettings {
    * turnarounds and arc timing exactly. normalizeRadioSettings sets it, on unless saved off; the
    * web radio's WEB_RADIO_DEFAULTS sets it on. */
   sizedBuilds?: boolean
+  /** The intensity arc's dials (DEFAULT_RADIO_ENERGY, DEFAULT_RADIO_DRAMA), 0..100. Optional for
+   * the same reason as `density`; normalizeRadioSettings always sets them, and absent reads as the
+   * defaults (radioEnergyOf, radioDramaOf). Nothing reads them unless density is `intensity`. */
+  energy?: number
+  drama?: number
+}
+
+/** Density is `intensity` for these settings: the intensity arc runs (radioIntensityArc.ts). */
+export function radioIntensityOn(settings: Pick<RadioSettings, 'density'>): boolean {
+  return settings.density === 'intensity'
+}
+
+export function radioEnergyOf(settings: Pick<RadioSettings, 'energy'>): number {
+  return normalizeRadioDial(settings.energy, DEFAULT_RADIO_ENERGY)
+}
+
+export function radioDramaOf(settings: Pick<RadioSettings, 'drama'>): number {
+  return normalizeRadioDial(settings.drama, DEFAULT_RADIO_DRAMA)
 }
 
 /** Sized builds are on for these settings (radioBuildSize.ts). */
@@ -1137,7 +1169,9 @@ export const DEFAULT_RADIO_SETTINGS: RadioSettings = {
   density: DEFAULT_RADIO_DENSITY,
   faves: DEFAULT_FAVES,
   paceLevel: DEFAULT_RADIO_PACE_LEVEL,
-  sizedBuilds: true
+  sizedBuilds: true,
+  energy: DEFAULT_RADIO_ENERGY,
+  drama: DEFAULT_RADIO_DRAMA
 }
 
 /** The window the clock draws a change's interval from: radioCadenceOf's (fold mode's own, 8-32
@@ -1209,7 +1243,10 @@ export function normalizeRadioSettings(value: unknown, legacyPace?: unknown): Ra
         ? normalizeRadioPaceLevel(raw.paceLevel)
         : radioPaceLevelFromLegacy(pace, raw.paceBars),
     // Sized builds (2026-10-03, Elling: on for everyone): on unless saved off.
-    sizedBuilds: raw.sizedBuilds !== false
+    sizedBuilds: raw.sizedBuilds !== false,
+    // The intensity arc's dials (2026-10-05): saved values clamped and rounded, else 50 and 60.
+    energy: normalizeRadioDial(raw.energy, DEFAULT_RADIO_ENERGY),
+    drama: normalizeRadioDial(raw.drama, DEFAULT_RADIO_DRAMA)
   }
 }
 
```

- [ ] **Step 3: The strip.** `src/shared/radioStripModel.ts`:

```diff
--- a/src/shared/radioStripModel.ts
+++ b/src/shared/radioStripModel.ts
@@ -6,8 +6,8 @@
 // what it says, and which RadioSettings patch a choice makes are decided (and tested) here.
 //
 // THE GROUPS, in order, each with a `place` (top line, live bar, or columns) and a subtitle:
-// play (live: tempo, pace, skip, new bed, turn, level), picks (columns: faves, source, matching,
-// artist, my sounds, density, channels, turnover), shape (phrase, loop end, transitions, builds),
+// play (live: tempo, pace, skip, new bed, turn, build, drop, level), picks (columns: faves, source,
+// matching, artist, my sounds, density, energy, drama, channels, turnover), shape (phrase, loop end, transitions, builds),
 // moves (turnarounds, families, depth), fold (the switch; bend, mismatch, seed), sound (reverb,
 // filter, res, filter mode; saturation, pump, echo), mix (top: similar all, fetch hearts, add to
 // shelf, add to timeline, keep).
@@ -20,6 +20,7 @@
 //
 // GREYED, NOT HIDDEN (Elling, 2026-10-04): every control is present in every state. One that does
 // not apply is `disabled`, with its tooltip saying what it needs: channels (with density off),
+// energy, drama, build and drop (with density intensity),
 // families and depth (with turnarounds on), bend, mismatch and the seed (with fold on).
 //
 // THE HINTS. The running radio menu's hint paragraph went with the menu; each of its sentences is
@@ -32,6 +33,8 @@ import {
   RADIO_PHRASE_OPTIONS,
   RADIO_TURNOVER_OPTIONS,
   radioDensityOf,
+  radioDramaOf,
+  radioEnergyOf,
   radioPaceLevelOf,
   radioSizedBuildsOf,
   type RadioSettings
@@ -169,7 +172,8 @@ export const RADIO_STRIP_HINTS = {
     'transitions decide how a layer arrives, and a hole or a riser holds its change to the top of the loop'
   ],
   density: [
-    'density arc grows the rows to four or five and thins them to two or three, only ever removing rows radio added'
+    'density arc grows the rows to four or five and thins them to two or three, only ever removing rows radio added',
+    'intensity builds, breaks down and drops, led by drums and bass'
   ],
   turnarounds: ['turnarounds mark the end of each phrase'],
   fold: [
@@ -202,6 +206,13 @@ export const RADIO_TURNOVER_TOOLTIP =
 export const RADIO_BUILDS_TOOLTIP = 'build-ups sized to the change; every turnaround paid off'
 export const RADIO_NEW_BED_TOOLTIP = 'every unlocked row at once, at the next loop top'
 export const RADIO_SOUND_TOOLTIP = 'project sound'
+/** The intensity arc's controls (spec 2026-10-05-radio-intensity-arc-design sections 6, 8, 9):
+ * greyed, not hidden, with density not `intensity`. */
+export const RADIO_WITH_INTENSITY = 'with density intensity'
+export const RADIO_ENERGY_TOOLTIP = 'gentle to driving'
+export const RADIO_DRAMA_TOOLTIP = 'how far it swings'
+export const RADIO_BUILD_TOOLTIP = 'build: go up now'
+export const RADIO_DROP_TOOLTIP = 'drop: the drop at the next top'
 
 /** The strip's sound dials, from the sound panel's own controls: [strip id, panel id, label]. */
 export const RADIO_STRIP_SOUND_DIALS: readonly (readonly [string, string, string])[] = [
@@ -273,6 +284,9 @@ export function radioStripModel(
   const turnaroundsOn = settings.turnarounds !== 'off'
   const foldOn = settings.foldMode
   const sizedBuilds = radioSizedBuildsOf(settings)
+  const intensity = density === 'intensity'
+  /** A tooltip, with what it needs while density is not intensity. */
+  const withIntensity = (t: string): string => (intensity ? t : `${t} · ${RADIO_WITH_INTENSITY}`)
 
   const play: RadioStripControl[] = [
     panel('tempo', 'tempo'),
@@ -289,6 +303,8 @@ export function radioStripModel(
     panel('skip', 'skip', { tooltip: 'skip a row' }),
     panel('new-bed', 'new bed', { tooltip: RADIO_NEW_BED_TOOLTIP }),
     panel('turn', 'turn', { tooltip: 'turn at the top' }),
+    panel('build', 'build', { tooltip: withIntensity(RADIO_BUILD_TOOLTIP), disabled: !intensity }),
+    panel('drop', 'drop', { tooltip: withIntensity(RADIO_DROP_TOOLTIP), disabled: !intensity }),
     panel('level', 'level', { tooltip: 'whole mix level', disabled: !ctx.sounding })
   ]
 
@@ -316,6 +332,26 @@ export function radioStripModel(
         (d) => ({ density: d })
       )
     },
+    {
+      kind: 'slider',
+      id: 'energy',
+      label: 'energy',
+      tooltip: withIntensity(RADIO_ENERGY_TOOLTIP),
+      sets: ['energy'],
+      disabled: !intensity,
+      value: radioEnergyOf(settings),
+      patch: (v: number) => ({ energy: v })
+    },
+    {
+      kind: 'slider',
+      id: 'drama',
+      label: 'drama',
+      tooltip: withIntensity(RADIO_DRAMA_TOOLTIP),
+      sets: ['drama'],
+      disabled: !intensity,
+      value: radioDramaOf(settings),
+      patch: (v: number) => ({ drama: v })
+    },
     {
       kind: 'chips',
       id: 'channels',
```

- [ ] **Step 4: Verify, commit.**
  - Run `npx vitest run src/shared src/main/discoverSettingsStore.test.ts`, `npm run typecheck`,
    `npx eslint src/shared/radioSchedule.ts src/shared/radioStripModel.ts`.
  - ell.ing/radio: `npm run typecheck` and `npx vitest run src`. **Expected:** green; the web
    reads none of it yet.
  - Message:
    `radio: density intensity, energy and drama (spec 2026-10-05-radio-intensity-arc-design section 8) -- RadioDensity off/arc/intensity (an older app reads intensity as arc), RadioSettings.energy/drama 0..100 (defaults 50/60, clamped, rounded; absent reads the defaults), the strip's energy and drama dials after density and build/drop after turn, greyed with density not intensity (tooltip "... · with density intensity"), the density hint's intensity sentence. Inert: no runtime reads them yet`,
    then the trailer.

### Task 2: The score and the lean (`radioIntensity.ts`, `traitQuantiles.ts`, `discoverRanking.ts`)

**Parallel-safe.** **Depends on:** nothing.

**Files:**
- Create: `src/shared/radioIntensity.ts`, `src/shared/radioIntensity.test.ts`
- Modify: `src/shared/traitQuantiles.ts` (`INTENSITY_FIELDS`, `QUANTILE_FIELDS`, the widened
  table type), `discoverCandidate.ts` (`intensity?`), `discoverRanking.ts` (`intensity`)

- [ ] **Step 1: Write the failing test.** Create `src/shared/radioIntensity.test.ts`:

```ts
// The per-stem intensity score and the lean on picks (spec 2026-10-05-radio-intensity-arc-design
// sections 2.1-2.3): radioIntensity.ts, and rankCandidates' `intensity`.
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  INTENSITY_BAND_CHANCE,
  INTENSITY_WEIGHTS,
  applyIntensityBand,
  intensityPoolRanks,
  intensityTerms,
  radioBedIntensity,
  radioIntensityRankOf,
  radioIntensityRoleWeight,
  roundIntensity,
  stemIntensityParts,
  stemIntensityScore,
  type IntensityValues
} from './radioIntensity'
import { buildQuantileTable, type TraitQuantileTables } from './traitQuantiles'
import { rankCandidates } from './discoverRanking'
import type { DiscoverCandidate } from './discoverCandidate'
import { seededRandom } from './seededRandom'

/** Tables where a value v in 0..100 sits at percentile v / 100 for every field. */
const linear = buildQuantileTable(Array.from({ length: 101 }, (_, i) => i))!
const TABLES: TraitQuantileTables = {
  transientDensity: linear,
  rhythmicStrength: linear,
  bassEnergyRatio: linear,
  lowLevelDb: linear,
  loudnessLufs: linear,
  activeFraction: linear,
  spectralCentroidHz: linear,
  spectralCentroidFftHz: linear
}
const ALL: IntensityValues = {
  transientDensity: 80,
  rhythmicStrength: 60,
  bassEnergyRatio: 40,
  lowLevelDb: 20,
  loudnessLufs: 50,
  activeFraction: 70,
  spectralCentroidHz: 10,
  spectralCentroidFftHz: 90
}

describe('stemIntensityScore', () => {
  it('weighs busy, low, full and bright 0.40, 0.35, 0.15, 0.10', () => {
    expect(INTENSITY_WEIGHTS).toEqual({ busy: 0.4, low: 0.35, full: 0.15, bright: 0.1 })
    const parts = stemIntensityParts(ALL, TABLES)
    expect(parts.busy).toBeCloseTo(0.6 * 0.8 + 0.4 * 0.6, 9)
    expect(parts.low).toBeCloseTo(0.5 * 0.4 + 0.5 * 0.2, 9)
    expect(parts.full).toBeCloseTo(0.5 * 0.5 + 0.5 * 0.7, 9)
    expect(parts.bright).toBeCloseTo(0.9, 9) // the FFT centroid wins when it has a table
    expect(stemIntensityScore(ALL, TABLES)).toBeCloseTo(
      0.4 * parts.busy! + 0.35 * parts.low! + 0.15 * parts.full! + 0.1 * parts.bright!,
      9
    )
  })

  it('renormalises inside a part when an input is missing (version 1, before the backfill)', () => {
    const v1 = { ...ALL, rhythmicStrength: undefined, lowLevelDb: null }
    const parts = stemIntensityParts(v1, TABLES)
    expect(parts.busy).toBeCloseTo(0.8, 9)
    expect(parts.low).toBeCloseTo(0.4, 9)
  })

  it('renormalises across parts when a part is missing', () => {
    const noFull = { ...ALL, loudnessLufs: null, activeFraction: undefined }
    const p = stemIntensityParts(noFull, TABLES)
    expect(p.full).toBeNull()
    expect(stemIntensityScore(noFull, TABLES)).toBeCloseTo(
      (0.4 * p.busy! + 0.35 * p.low! + 0.1 * p.bright!) / 0.85,
      9
    )
  })

  it('a field with no table yet counts as missing for every stem', () => {
    const early: TraitQuantileTables = { ...TABLES }
    delete early.lowLevelDb
    delete early.loudnessLufs
    delete early.activeFraction
    const before = stemIntensityScore(ALL, early)
    const p = stemIntensityParts(ALL, early)
    expect(p.full).toBeNull()
    expect(p.low).toBeCloseTo(0.4, 9)
    expect(before).toBeCloseTo((0.4 * p.busy! + 0.35 * 0.4 + 0.1 * p.bright!) / 0.85, 9)
  })

  it('bright falls back to the 3-band centroid without the FFT one or its table', () => {
    expect(stemIntensityParts({ ...ALL, spectralCentroidFftHz: null }, TABLES).bright).toBeCloseTo(
      0.1,
      9
    )
    const noFft: TraitQuantileTables = { ...TABLES }
    delete noFft.spectralCentroidFftHz
    expect(stemIntensityParts(ALL, noFft).bright).toBeCloseTo(0.1, 9)
  })

  it('is null with neither busy nor low, and stays in [0, 1]', () => {
    expect(
      stemIntensityScore({ loudnessLufs: 50, activeFraction: 50, spectralCentroidHz: 50 }, TABLES)
    ).toBeNull()
    expect(stemIntensityScore({}, TABLES)).toBeNull()
    const r = seededRandom('score-bounds')
    for (let i = 0; i < 2000; i++) {
      const v: IntensityValues = {}
      for (const k of Object.keys(ALL) as (keyof IntensityValues)[]) {
        if (r() < 0.7) v[k] = r() * 140 - 20
      }
      const s = stemIntensityScore(v, TABLES)
      if (s !== null) {
        expect(s).toBeGreaterThanOrEqual(0)
        expect(s).toBeLessThanOrEqual(1)
      }
    }
  })

  it('rounds for the index', () => {
    expect(roundIntensity(0.123456)).toBe(0.123)
    expect(roundIntensity(null)).toBeNull()
    expect(roundIntensity(Number.NaN)).toBeNull()
  })
})

describe('the role weight', () => {
  it('is the largest over the slot kinds', () => {
    expect(radioIntensityRoleWeight(['drums'])).toBe(1)
    expect(radioIntensityRoleWeight(['bass'])).toBe(1)
    expect(radioIntensityRoleWeight(['bassHeavy'])).toBe(0.8)
    expect(radioIntensityRoleWeight(['rhythmic'])).toBe(0.8)
    expect(radioIntensityRoleWeight(['lead'])).toBe(0.35)
    expect(radioIntensityRoleWeight(['bright'])).toBe(0.35)
    expect(radioIntensityRoleWeight(['warm'])).toBe(0.25)
    expect(radioIntensityRoleWeight(['warm', 'lead', 'rhythmic'])).toBe(0.8)
  })

  it('scales the term by 0.4 + 0.6 drama', () => {
    expect(radioIntensityRankOf(0.9, ['drums'], 0).weight).toBeCloseTo(0.4, 9)
    expect(radioIntensityRankOf(0.9, ['drums'], 100).weight).toBeCloseTo(1, 9)
    expect(radioIntensityRankOf(0.9, ['warm'], 60).weight).toBeCloseTo(0.25 * 0.76, 9)
    expect(radioIntensityRankOf(1.4, ['drums'], 50).target).toBe(1)
  })
})

const C = (intensity: number | null | undefined, id = String(intensity)): DiscoverCandidate => ({
  stemCID: id,
  jamCID: 'j',
  riffCID: 'r',
  presetName: '',
  creatorUserName: '',
  slotKinds: ['drums'],
  drumSubRole: null,
  riffBpm: 120,
  traitValues: {},
  traitPercentiles: {},
  kindSources: {},
  riffCreationTime: null,
  ...(intensity !== undefined && { intensity })
})

describe('pool ranks', () => {
  it('ranks by score in the pool, ties in the middle of their run, unscored none', () => {
    const pool = [C(0.9, 'a'), C(0.1, 'b'), C(null, 'c'), C(0.5, 'd'), C(0.5, 'e'), C(undefined)]
    const r = intensityPoolRanks(pool)
    expect(r.get(1)).toBe(0)
    expect(r.get(3)).toBeCloseTo(0.5, 9)
    expect(r.get(4)).toBeCloseTo(0.5, 9)
    expect(r.get(0)).toBe(1)
    expect(r.has(2)).toBe(false)
    expect(r.has(5)).toBe(false)
    expect(intensityPoolRanks([C(0.3)]).get(0)).toBe(0.5)
    expect(intensityPoolRanks([]).size).toBe(0)
  })

  it('the term is in [0, weight], neutral for the unscored', () => {
    const pool = [C(0.1, 'a'), C(0.9, 'b'), C(null, 'c')]
    const t = intensityTerms(pool, { target: 1, weight: 0.7 })
    expect(t[0]).toBeCloseTo(0, 9)
    expect(t[1]).toBeCloseTo(0.7, 9)
    expect(t[2]).toBeCloseTo(0.35, 9)
  })
})

describe('the band draw', () => {
  const big = Array.from({ length: 80 }, (_, i) => C(i / 79, `s${i}`))

  it('keeps only ranks near the target when drawn', () => {
    const r = applyIntensityBand(big, {
      target: 0.9,
      kinds: ['drums'],
      drama: 100,
      random: () => 0
    })
    expect(r.banded).toBe(true)
    expect(r.pool.length).toBeGreaterThanOrEqual(10)
    for (const c of r.pool)
      expect(Math.abs((c.intensity as number) - 0.9)).toBeLessThanOrEqual(0.2501)
  })

  it('draws once, at 0.5 w d', () => {
    let n = 0
    const counting = (v: number) => () => {
      n += 1
      return v
    }
    const half = INTENSITY_BAND_CHANCE * 0.35 * 0.6
    expect(
      applyIntensityBand(big, {
        target: 0.5,
        kinds: ['lead'],
        drama: 60,
        random: counting(half - 1e-6)
      }).banded
    ).toBe(true)
    expect(
      applyIntensityBand(big, { target: 0.5, kinds: ['lead'], drama: 60, random: counting(half) })
        .banded
    ).toBe(false)
    expect(n).toBe(2)
    // drama 0: never banded, still one draw
    expect(
      applyIntensityBand(big, { target: 0.5, kinds: ['drums'], drama: 0, random: counting(0) })
        .banded
    ).toBe(false)
    expect(n).toBe(3)
  })

  it('backs off when too few would remain (max(8, pool / 8))', () => {
    const small = Array.from({ length: 12 }, (_, i) => C(i / 11, `t${i}`))
    const r = applyIntensityBand(small, {
      target: 1,
      kinds: ['drums'],
      drama: 100,
      random: () => 0
    })
    expect(r).toMatchObject({ banded: false, backedOff: true })
    expect(r.pool).toHaveLength(12)
    const unscored = Array.from({ length: 40 }, (_, i) => C(null, `u${i}`))
    expect(
      applyIntensityBand(unscored, { target: 1, kinds: ['drums'], drama: 100, random: () => 0 })
        .backedOff
    ).toBe(true)
  })
})

describe('rankCandidates with intensity', () => {
  function pool(r: () => number, n: number): DiscoverCandidate[] {
    return Array.from({ length: n }, (_, i) => ({
      ...C(r() < 0.2 ? null : r(), `c${i}`),
      riffBpm: 90 + r() * 60,
      traitPercentiles: { rhythmic: r() < 0.3 ? null : r() },
      traitValues: { rhythmic: r() }
    }))
  }
  const hash = (x: unknown): string =>
    createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 8)

  it('without `intensity`, identical to the ranking it replaces (10k seeded pools)', () => {
    const r = seededRandom('rank-identity')
    for (let k = 0; k < 10000; k++) {
      const p = pool(r, 1 + Math.floor(r() * 12))
      const opts = { targetBpm: 120, targetTraits: ['rhythmic' as const] }
      const a = rankCandidates(p, opts)
      // the candidates' own `intensity` field changes nothing while the option is absent
      const b = rankCandidates(
        p.map((c) => {
          const plain = { ...c }
          delete plain.intensity
          return plain
        }),
        opts
      )
      expect(a.map((x) => [x.candidate.stemCID, x.score])).toEqual(
        b.map((x) => [x.candidate.stemCID, x.score])
      )
    }
  })

  it('pins the absent ranking (a hash of 2000 seeded rankings)', () => {
    const r = seededRandom('rank-fingerprint')
    const out: unknown[] = []
    for (let k = 0; k < 2000; k++) {
      const p = pool(r, 1 + Math.floor(r() * 10))
      out.push(
        rankCandidates(p, { targetBpm: 120, targetTraits: ['rhythmic'] }).map((x) => [
          x.candidate.stemCID,
          Math.round(x.score * 1e9)
        ])
      )
    }
    expect(hash(out)).toBe(RANK_FINGERPRINT)
  })

  it('leans toward the target, and an unscored pool ranks as before plus a constant', () => {
    const p = [C(0.1, 'low'), C(0.5, 'mid'), C(0.9, 'high')]
    const up = rankCandidates(p, { targetBpm: 120, intensity: { target: 1, weight: 1 } })
    expect(up[0].candidate.stemCID).toBe('high')
    const down = rankCandidates(p, { targetBpm: 120, intensity: { target: 0, weight: 1 } })
    expect(down[0].candidate.stemCID).toBe('low')
    const r = seededRandom('unscored')
    const u = pool(r, 9).map((c) => ({ ...c, intensity: null }))
    const base = rankCandidates(u, { targetBpm: 120 })
    const leaned = rankCandidates(u, { targetBpm: 120, intensity: { target: 0.8, weight: 0.6 } })
    expect(leaned.map((x) => x.candidate.stemCID)).toEqual(base.map((x) => x.candidate.stemCID))
    leaned.forEach((x, i) => expect(x.score - base[i].score).toBeCloseTo(0.3, 9))
  })
})

describe('the bed intensity', () => {
  it('is the role-weighted mean of the scored rows', () => {
    expect(
      radioBedIntensity([
        { kinds: ['drums'], score: 0.8 },
        { kinds: ['warm'], score: 0.2 },
        { kinds: ['lead'], score: null }
      ])
    ).toBeCloseTo((0.8 + 0.25 * 0.2) / 1.25, 9)
    expect(radioBedIntensity([{ kinds: ['drums'], score: null }])).toBeNull()
  })
})

/** Recorded from the unmodified discoverRanking.ts (a9d68ef4) by running this test's trace with
 * the `intensity` term not yet added. */
const RANK_FINGERPRINT = 'b6fdd2ab'
```

  - **The fingerprint.** Before you change `discoverRanking.ts`, record the hash with the test's
    trace against the unmodified file:
    - set `RANK_FINGERPRINT` to `'xxxxxxxx'`;
    - run `npx vitest run src/shared/radioIntensity.test.ts -t "pins the absent"`;
    - take the `Received` value. The planner's was `b6fdd2ab`.
  - The test imports `radioIntensity.ts`, so create it first (Step 2), then record, then Step 3.
  - Run `npx vitest run src/shared/radioIntensity.test.ts`. **Expected:** FAIL (the module is
    missing).

- [ ] **Step 2: The fields beside the traits.** `src/shared/traitQuantiles.ts`:

```diff
--- a/src/shared/traitQuantiles.ts
+++ b/src/shared/traitQuantiles.ts
@@ -34,8 +34,25 @@ export const TRAIT_FIELDS: readonly TraitField[] = [
   ])
 ]
 
+/** The level pass's fields (stemLevel.ts; spec 2026-10-05-radio-intensity-arc-design section
+ * 2.1): tables for the radio's intensity score (radioIntensity.ts), BESIDE the trait fields, never
+ * among them -- no trait kind reads them, so TRAIT_FIELDS and every trait percentile stay as they
+ * are. Preferred-only by tableForField's rule (none is a fallback field): a table exists once
+ * min(PREFERRED_TABLE_MIN_ROWS, half the rows) carry the field, so a half-backfilled library
+ * never compares a measured stem with nothing. */
+export type IntensityLevelField = 'lowLevelDb' | 'loudnessLufs' | 'activeFraction'
+export const INTENSITY_FIELDS: readonly IntensityLevelField[] = [
+  'lowLevelDb',
+  'loudnessLufs',
+  'activeFraction'
+]
+
+/** Every field a quantile table is built for: the trait fields, then the level fields. */
+export type QuantileField = TraitField | IntensityLevelField
+export const QUANTILE_FIELDS: readonly QuantileField[] = [...TRAIT_FIELDS, ...INTENSITY_FIELDS]
+
 /** The fields every analysed row carries, of every feature version. */
-export const FALLBACK_FIELDS: ReadonlySet<TraitField> = new Set<TraitField>(
+export const FALLBACK_FIELDS: ReadonlySet<QuantileField> = new Set<QuantileField>(
   Object.values(DISCOVER_TRAIT_FIELD)
 )
 
@@ -45,8 +62,9 @@ export const FALLBACK_FIELDS: ReadonlySet<TraitField> = new Set<TraitField>(
  * stems are placed by their fallback field (traitPercentilesFromValues). */
 export const PREFERRED_TABLE_MIN_ROWS = 200
 
-/** One table per field (keyed by FIELD, not kind, so bright/warm share). */
-export type TraitQuantileTables = Partial<Record<TraitField, QuantileTable>>
+/** One table per field (keyed by FIELD, not kind, so bright/warm share), the level fields
+ * included once enough rows carry them. */
+export type TraitQuantileTables = Partial<Record<QuantileField, QuantileTable>>
 
 /** Library percentile per requested trait kind, in [0, 1], already
  * direction-adjusted (warm = low centroid -> high percentile). null = the
@@ -78,7 +96,7 @@ export function buildQuantileTable(values: readonly number[]): QuantileTable | n
  * only once min(PREFERRED_TABLE_MIN_ROWS, half the parsed rows) carry it.
  * null when skipped or when nothing finite is left. */
 export function tableForField(
-  field: TraitField,
+  field: QuantileField,
   values: readonly number[],
   parsedRows: number
 ): QuantileTable | null {
```

- [ ] **Step 3: The score, the role weight, the ranks, the band, the term.** Create
  `src/shared/radioIntensity.ts`:

```ts
// src/shared/radioIntensity.ts
//
// THE PER-STEM INTENSITY SCORE, and the lean it puts on radio's picks
// (docs/superpowers/specs/2026-10-05-radio-intensity-arc-design.md sections 2.1-2.3).
//
// Elling, 2026-10-05: intensity is led by rhythm -- busier drums and heavier bass drive it
// ("that's where the buildups come from"); loudness, fullness and brightness ride along. So a
// stem's score is four parts, each a LIBRARY PERCENTILE (percentileOf over the same quantile
// tables traits use, built over the whole library on the desktop, over the exported stems on the
// web), weighted 0.40 busy, 0.35 low, 0.15 full, 0.10 bright. A missing input drops out of its
// part and a missing part out of the score, both renormalised; with neither busy nor low the
// stem is unscored (null).
//
// The lean (section 2.3) runs only while radio runs with density `intensity`: a band draw that
// keeps the candidates whose RANK in the pool is near the arc's target (applyIntensityBand), and a
// ranking term toward it (rankCandidates' `intensity`, RankIntensity). Ranks are inside the pool,
// so "busier" means "busier among what this slot can play". Both are weighted by the slot's role:
// most on drums and bass rows. Pure; the band's one draw comes from the caller's random.

import type { DiscoverCandidate } from './discoverCandidate'
import type { DiscoverSlotKind } from './discoverSlotKind'
import {
  INTENSITY_FIELDS,
  percentileOf,
  type QuantileField,
  type TraitQuantileTables
} from './traitQuantiles'

export { INTENSITY_FIELDS }

/** Every StemFeatures field the score reads. */
export type IntensityInputField = Extract<
  QuantileField,
  | 'transientDensity'
  | 'rhythmicStrength'
  | 'bassEnergyRatio'
  | 'lowLevelDb'
  | 'loudnessLufs'
  | 'activeFraction'
  | 'spectralCentroidHz'
  | 'spectralCentroidFftHz'
>

export const INTENSITY_INPUT_FIELDS: readonly IntensityInputField[] = [
  'transientDensity',
  'rhythmicStrength',
  'bassEnergyRatio',
  'lowLevelDb',
  'loudnessLufs',
  'activeFraction',
  'spectralCentroidHz',
  'spectralCentroidFftHz'
]

/** A stem's raw values for the score (absent, null or non-finite: missing). */
export type IntensityValues = Partial<Record<IntensityInputField, number | null>>

export type IntensityPart = 'busy' | 'low' | 'full' | 'bright'

/** The parts' weights (Decision 1: rhythm and low end 0.75, the rest 0.25). [INF] */
export const INTENSITY_WEIGHTS: Readonly<Record<IntensityPart, number>> = {
  busy: 0.4,
  low: 0.35,
  full: 0.15,
  bright: 0.1
}

/** Inside each part: its inputs and their weights. `bright` is one percentile: the FFT centroid
 * when the stem has it and its table exists, else the 3-band centroid (the bright trait's rule). */
const PART_INPUTS: Readonly<
  Record<Exclude<IntensityPart, 'bright'>, readonly (readonly [IntensityInputField, number])[]>
> = {
  busy: [
    ['transientDensity', 0.6],
    ['rhythmicStrength', 0.4]
  ],
  low: [
    ['bassEnergyRatio', 0.5],
    ['lowLevelDb', 0.5]
  ],
  full: [
    ['loudnessLufs', 0.5],
    ['activeFraction', 0.5]
  ]
}

const finite = (v: number | null | undefined): v is number =>
  typeof v === 'number' && Number.isFinite(v)

/** One input's library percentile, or null when the stem lacks it or no table exists yet. */
function pct(
  values: IntensityValues,
  tables: TraitQuantileTables,
  field: IntensityInputField
): number | null {
  const v = values[field]
  return finite(v) ? percentileOf(tables[field], v) : null
}

/** A part from its present inputs, their weights renormalised; null when none is present. */
function part(
  values: IntensityValues,
  tables: TraitQuantileTables,
  inputs: readonly (readonly [IntensityInputField, number])[]
): number | null {
  let sum = 0
  let weight = 0
  for (const [field, w] of inputs) {
    const p = pct(values, tables, field)
    if (p === null) continue
    sum += w * p
    weight += w
  }
  return weight > 0 ? sum / weight : null
}

/** Each part's value for a stem (null: missing). */
export function stemIntensityParts(
  values: IntensityValues,
  tables: TraitQuantileTables
): Record<IntensityPart, number | null> {
  const fft = finite(values.spectralCentroidFftHz) && tables.spectralCentroidFftHz !== undefined
  return {
    busy: part(values, tables, PART_INPUTS.busy),
    low: part(values, tables, PART_INPUTS.low),
    full: part(values, tables, PART_INPUTS.full),
    bright: pct(values, tables, fft ? 'spectralCentroidFftHz' : 'spectralCentroidHz')
  }
}

/** The score, in [0, 1], or null (unscored: neither busy nor low). Pure, no randomness. */
export function stemIntensityScore(
  values: IntensityValues,
  tables: TraitQuantileTables
): number | null {
  const parts = stemIntensityParts(values, tables)
  if (parts.busy === null && parts.low === null) return null
  let sum = 0
  let weight = 0
  for (const k of Object.keys(INTENSITY_WEIGHTS) as IntensityPart[]) {
    const p = parts[k]
    if (p === null) continue
    sum += INTENSITY_WEIGHTS[k] * p
    weight += INTENSITY_WEIGHTS[k]
  }
  return sum / weight
}

/** The score rounded to 3 places (the web index's `x`), or null. */
export function roundIntensity(score: number | null): number | null {
  return score === null || !Number.isFinite(score) ? null : Math.round(score * 1000) / 1000
}

// ---- the lean on picks (section 2.3) ----

/** How much the lean counts on a slot, by kind (the largest over its kinds). [INF] */
export const INTENSITY_ROLE_WEIGHT: Readonly<Record<DiscoverSlotKind, number>> = {
  drums: 1,
  bass: 1,
  bassHeavy: 0.8,
  rhythmic: 0.8,
  lead: 0.35,
  bright: 0.35,
  warm: 0.25
}

export function radioIntensityRoleWeight(kinds: readonly DiscoverSlotKind[]): number {
  let w = 0
  for (const k of kinds) w = Math.max(w, INTENSITY_ROLE_WEIGHT[k] ?? 0)
  return w
}

/** The band draw's chance at full role weight and full drama. */
export const INTENSITY_BAND_CHANCE = 0.5
/** How far from the target a rank may sit and stay in the band. */
export const INTENSITY_BAND_HALF_WIDTH = 0.25
/** The band backs off when fewer than max(this, ceil(pool / 8)) candidates would remain. */
export const INTENSITY_BAND_MIN = 8
/** The ranking term's most (one trait's worth, under the favourite boost's 1.5). */
export const INTENSITY_WEIGHT = 1
/** The term's closeness for an unscored candidate: neutral. */
export const INTENSITY_UNSCORED_CLOSENESS = 0.5

/** What rankCandidates needs for the term: the arc's target and the slot's weight
 * (radioIntensityRankOf). */
export interface RankIntensity {
  target: number
  weight: number
}

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0)

/** The term's input for a slot: weight = w * (0.4 + 0.6 d), d = drama / 100. */
export function radioIntensityRankOf(
  target: number,
  kinds: readonly DiscoverSlotKind[],
  drama: number
): RankIntensity {
  const d = clamp01(drama / 100)
  return { target: clamp01(target), weight: radioIntensityRoleWeight(kinds) * (0.4 + 0.6 * d) }
}

/**
 * Each scored candidate's rank by score inside `pool`, in [0, 1]: 0 the lowest, 1 the highest;
 * a run of equal scores takes the middle of its run (as percentileOf does); a lone scored
 * candidate is 0.5. Unscored candidates (intensity null or absent) have no rank. Keyed by
 * position in `pool`.
 */
export function intensityPoolRanks(
  pool: readonly Pick<DiscoverCandidate, 'intensity'>[]
): Map<number, number> {
  const scored: { i: number; v: number }[] = []
  pool.forEach((c, i) => {
    if (finite(c.intensity)) scored.push({ i, v: c.intensity })
  })
  const out = new Map<number, number>()
  if (scored.length === 0) return out
  if (scored.length === 1) {
    out.set(scored[0].i, 0.5)
    return out
  }
  scored.sort((a, b) => a.v - b.v)
  const last = scored.length - 1
  for (let lo = 0; lo < scored.length;) {
    let hi = lo
    while (hi + 1 < scored.length && scored[hi + 1].v === scored[lo].v) hi += 1
    const r = (lo + hi) / 2 / last
    for (let j = lo; j <= hi; j++) out.set(scored[j].i, r)
    lo = hi + 1
  }
  return out
}

/** The ranking term for each candidate of `pool` (rankCandidates adds it): INTENSITY_WEIGHT *
 * weight * closeness, closeness = 1 - |r - target| (unscored: 0.5). In [0, weight]. */
export function intensityTerms(
  pool: readonly Pick<DiscoverCandidate, 'intensity'>[],
  lean: RankIntensity
): number[] {
  const ranks = intensityPoolRanks(pool)
  const target = clamp01(lean.target)
  const weight = Number.isFinite(lean.weight) ? Math.max(0, lean.weight) : 0
  return pool.map((_, i) => {
    const r = ranks.get(i)
    const closeness = r === undefined ? INTENSITY_UNSCORED_CLOSENESS : 1 - Math.abs(r - target)
    return INTENSITY_WEIGHT * weight * closeness
  })
}

export interface IntensityBandResult<T> {
  pool: T[]
  /** The draw kept only the band. */
  banded: boolean
  /** The draw asked for the band but too few were in it: the pool as it was. */
  backedOff: boolean
}

/**
 * THE BAND DRAW, like the faves draw: ONE draw `< INTENSITY_BAND_CHANCE * w * d` keeps only the
 * candidates whose rank is within INTENSITY_BAND_HALF_WIDTH of the target -- unless fewer than
 * max(INTENSITY_BAND_MIN, ceil(pool / 8)) would remain, when the pool stays as it was
 * (`backedOff`; applyTraitBar's back-off). The draw is always made (one number) when called; the
 * caller calls it only while intensity runs, after dig's near draw. Order kept.
 */
export function applyIntensityBand<T extends Pick<DiscoverCandidate, 'intensity'>>(
  pool: readonly T[],
  o: { target: number; kinds: readonly DiscoverSlotKind[]; drama: number; random: () => number }
): IntensityBandResult<T> {
  const d = clamp01(o.drama / 100)
  const chance = INTENSITY_BAND_CHANCE * radioIntensityRoleWeight(o.kinds) * d
  if (!(o.random() < chance)) return { pool: [...pool], banded: false, backedOff: false }
  const ranks = intensityPoolRanks(pool)
  const target = clamp01(o.target)
  const kept = pool.filter((_, i) => {
    const r = ranks.get(i)
    return r !== undefined && Math.abs(r - target) <= INTENSITY_BAND_HALF_WIDTH + 1e-9
  })
  const least = Math.max(INTENSITY_BAND_MIN, Math.ceil(pool.length / 8))
  if (kept.length < least) return { pool: [...pool], banded: false, backedOff: true }
  return { pool: kept, banded: true, backedOff: false }
}

/** The bed's intensity (sims and tests): the role-weighted mean score of the sounding rows that
 * are scored; null when none is. */
export function radioBedIntensity(
  rows: readonly { kinds: readonly DiscoverSlotKind[]; score: number | null }[]
): number | null {
  let sum = 0
  let weight = 0
  for (const r of rows) {
    if (!finite(r.score)) continue
    const w = radioIntensityRoleWeight(r.kinds)
    sum += w * r.score
    weight += w
  }
  return weight > 0 ? sum / weight : null
}
```

- [ ] **Step 4: The candidate and the ranking.** `src/shared/discoverCandidate.ts`:

```diff
--- a/src/shared/discoverCandidate.ts
+++ b/src/shared/discoverCandidate.ts
@@ -78,4 +78,8 @@ export interface DiscoverCandidate {
    * through duplicates, nearby picks and undo/redo. It drives the radio
    * turnover after a switch and the keep block while such stems remain. */
   pickedUnderArtist?: string
+  /** The radio's intensity score (@shared/radioIntensity stemIntensityScore), [0, 1], or null
+   * when the stem is unscored. Attached only when a roll asks for it (getDiscoverCandidates'
+   * `alsoIntensity`, the web index's `x`): absent on every other roll. */
+  intensity?: number | null
 }
```

  `src/shared/discoverRanking.ts`:

```diff
--- a/src/shared/discoverRanking.ts
+++ b/src/shared/discoverRanking.ts
@@ -8,6 +8,7 @@ import {
 import type { DiscoverTraitKind } from './discoverSlotKind'
 import { radioClashBedScore, radioClashTraitScore, type RankClash } from './radioClash'
 import { DIG_WEIGHT, radioDigCloseness, type RankDig } from './radioDig'
+import { intensityTerms, type RankIntensity } from './radioIntensity'
 
 export interface RankedCandidate {
   candidate: DiscoverCandidate
@@ -85,7 +86,8 @@ export function rankCandidates(
     favouriteScale = 1,
     targetTraits = [],
     clash,
-    dig
+    dig,
+    intensity
   }: {
     targetBpm: number
     favouriteStemCIDs?: ReadonlySet<string>
@@ -106,6 +108,11 @@ export function rankCandidates(
     /** Radio's dig (@shared/radioDig): every candidate gains DIG_WEIGHT * its closeness to the
      * dug stem (0 to 0.75). Absent: no term, exactly the ranking without it. */
     dig?: RankDig
+    /** Radio's intensity lean (@shared/radioIntensity, spec 2026-10-05-radio-intensity-arc-design
+     * 2.3): every candidate gains INTENSITY_WEIGHT * weight * (1 - |its rank by score in this pool
+     * - target|), an unscored one the neutral 0.5 closeness. Absent: no term, exactly the ranking
+     * without it. */
+    intensity?: RankIntensity
   }
 ): RankedCandidate[] {
   // Pool-relative values per kind, for candidates without a library
@@ -147,8 +154,9 @@ export function rankCandidates(
   }
 
   const boost = FAVOURITE_BOOST * clampWeight(favouriteScale)
+  const leaned = intensity ? intensityTerms(candidates, intensity) : null
   return candidates
-    .map((candidate) => {
+    .map((candidate, i) => {
       const bpmDistance = Math.abs(candidate.riffBpm - targetBpm)
       let score = Math.max(0, 1 - bpmDistance / BPM_FALLOFF)
       if (favouriteStemCIDs?.has(candidate.stemCID)) score += boost
@@ -170,6 +178,7 @@ export function rankCandidates(
       }
       if (clash) score += radioClashBedScore(candidate.traitPercentiles ?? {}, clash)
       if (dig) score += DIG_WEIGHT * radioDigCloseness(dig, candidate)
+      if (leaned) score += leaned[i]
       return { candidate, score }
     })
     .sort((a, b) => b.score - a.score)
```

- [ ] **Step 5: Verify, commit.**
  - Run `npx vitest run src/shared/radioIntensity.test.ts src/shared/discoverRanking.test.ts src/shared/traitQuantiles.test.ts`,
    `npm run typecheck`, and the web's `npm run typecheck` + `npx vitest run src`.
  - **Expected:** green, and the absent fingerprint is today's.
  - Message:
    `radio: the per-stem intensity score and its lean (spec 2026-10-05-radio-intensity-arc-design 2.1-2.3) -- stemIntensityScore: four parts of library percentiles (busy 0.40 = 0.6 transient density + 0.4 rhythmic strength; low 0.35 = 0.5 bass ratio + 0.5 low level; full 0.15 = loudness + active fraction; bright 0.10), a missing input or part renormalised, null with neither busy nor low; INTENSITY_FIELDS (the level pass's three) get quantile tables beside TRAIT_FIELDS, never in them (QUANTILE_FIELDS); the role weight (drums/bass 1, bassHeavy/rhythmic 0.8, lead/bright 0.35, warm 0.25); pool ranks with ties in their run's middle; the band draw (one draw < 0.5 w d keeps |r - target| <= 0.25, backing off under max(8, pool/8)); rankCandidates' intensity term (weight w (0.4 + 0.6 d) x closeness, unscored 0.5). Absent: rankCandidates is today's (fingerprint b6fdd2ab, recorded from a9d68ef4; 10k seeded pools identical)`,
    then the trailer.

### Task 3: The arc machine (`radioIntensityArc.ts`)

**Parallel-safe.** **Depends on:** nothing.

**Files:**
- Create: `src/shared/radioIntensityArc.ts`, `src/shared/radioIntensityArc.test.ts`

The machine is pure and seeded. The runtime steps it at every wrap, after the lap bookkeeping and
before hooks, the fold step and the turnaround roll (spec §3.1):
- an event is decided at the wrap that starts a phrase's last lap (binding), and lands on the
  phrase start after it;
- what needs warming is prepared a phrase ahead, or two wraps ahead with a one-lap phrase.

Its test file carries a small runtime (`simulate`) that does what the machine says, so the
cycle's shape, the clock, never-silence and the buttons are checked end to end. The runtimes'
own sims (Tasks 7, 10) check the same against the real reducers.

- [ ] **Step 1: Write the failing test.** Create `src/shared/radioIntensityArc.test.ts`:

```ts
// The intensity arc: build, breakdown, drop (spec 2026-10-05-radio-intensity-arc-design sections
// 3, 4, 6): radioIntensityArc.ts.
import { describe, expect, it } from 'vitest'
import {
  INTENSITY_PHRASES,
  NO_RADIO_INTENSITY_ARC,
  newRadioIntensityArc,
  pressRadioIntensity,
  radioBreakdownDepth,
  radioBreakdownRests,
  radioCarryKind,
  radioIntensityArcRole,
  radioIntensityBend,
  radioIntensityButtonLabel,
  radioIntensityDropInBars,
  radioIntensityHookInputs,
  radioIntensityStarted,
  radioIntensityStopped,
  radioIntensityTarget,
  radioIntensityTargets,
  radioIntensityTurnaroundArc,
  releaseRadioIntensityRest,
  stepRadioIntensityArc,
  type RadioIntensityArc,
  type RadioIntensityDecided,
  type RadioIntensityRow,
  type RadioIntensityStepInput,
  type RadioIntensityStepResult
} from './radioIntensityArc'
import { DENSITY_MAX, DENSITY_MIN, nextArcKind } from './radioDensity'
import { turnaroundPhraseLaps } from './radioTurnaround'
import { seededRandom } from './seededRandom'
import type { DiscoverSlotKind } from './discoverSlotKind'

// ---- a small runtime: rows, rests, the clock ----

interface SimRow {
  id: string
  kinds: DiscoverSlotKind[]
  score: number | null
  staleness: number
  resting: boolean
  locked?: boolean
  muted?: boolean
}

interface Trace {
  wrap: number
  lap: number
  applied: RadioIntensityDecided | null
  decided: RadioIntensityDecided | null
  prepare: RadioIntensityStepResult['prepare']
  phase: RadioIntensityArc['phase']
  rows: number
  sounding: number
  low: boolean
}

/** Runs the arc for `wraps` loop tops on a `loopBars` loop, doing what it says. */
function simulate(o: {
  loopBars: number
  wraps: number
  energy?: number
  drama?: number
  seed?: string
  rows?: SimRow[]
  held?: (wrap: number) => boolean
  press?: (wrap: number, arc: RadioIntensityArc) => 'build' | 'drop' | null
}): { trace: Trace[]; arc: RadioIntensityArc } {
  const random = seededRandom(o.seed ?? 'arc')
  const P = turnaroundPhraseLaps(16, o.loopBars)
  let n = 0
  const row = (kinds: DiscoverSlotKind[]): SimRow => ({
    id: `r${n++}`,
    kinds,
    score: random(),
    staleness: 0,
    resting: false
  })
  const rows: SimRow[] = o.rows ?? [row(['drums']), row(['bass'])]
  const energy = o.energy ?? 50
  const drama = o.drama ?? 60
  const view = (): RadioIntensityRow[] =>
    rows.map((r) => ({
      id: r.id,
      kinds: r.kinds,
      score: r.score,
      staleness: r.staleness,
      sounding: !r.resting && !r.muted,
      restable: !r.locked && !r.muted && !r.resting
    }))
  let arc = radioIntensityStarted({
    energy,
    drama,
    min: DENSITY_MIN,
    max: DENSITY_MAX,
    count: rows.length,
    random
  })
  const trace: Trace[] = []
  let lap = 0
  let carry = false
  const warm = new Set<string>()
  for (let w = 1; w <= o.wraps; w++) {
    lap = (lap + 1) % P
    for (const r of rows) r.staleness += 1
    const held = o.held?.(w) ?? false
    const step = stepRadioIntensityArc(arc, {
      energy,
      drama,
      loopBars: o.loopBars,
      lap,
      phraseLaps: P,
      held,
      count: rows.length,
      min: DENSITY_MIN,
      max: DENSITY_MAX,
      rows: view(),
      canAdd: rows.length < DENSITY_MAX && nextArcKind(rows.map((r) => r.kinds)) !== null,
      canStrip: rows.length > DENSITY_MIN,
      carryReady: carry,
      renewReady: (id) => warm.has(id),
      random
    })
    arc = step.state
    const a = step.applied
    if (a?.event === 'cycle' && a.strip && rows.length > DENSITY_MIN) {
      // the stalest that is not the last drums or bass
      const ok = rows.filter(
        (r) =>
          !(['drums', 'bass'] as const).some(
            (k) => r.kinds.includes(k) && !rows.some((x) => x !== r && x.kinds.includes(k))
          )
      )
      const victim = ok.sort((x, y) => y.staleness - x.staleness)[0]
      if (victim) rows.splice(rows.indexOf(victim), 1)
    }
    if (a?.event === 'add') {
      const k = nextArcKind(rows.map((r) => r.kinds))
      if (k !== null) rows.push(row([k]))
    }
    if (a?.event === 'breakdown') {
      for (const r of rows) if (a.rest.includes(r.id)) r.resting = true
      if (a.carry) rows.push(row([radioCarryKind(rows)]))
      carry = false
    }
    if (a?.event === 'drop') {
      for (const r of rows) {
        if (a.returning.includes(r.id)) r.resting = false
        if (a.renew.includes(r.id)) {
          r.score = Math.min(1, (r.score ?? 0.5) + 0.2)
          r.staleness = 0
        }
      }
      warm.clear()
    }
    if (step.prepare?.carry) carry = true
    for (const id of step.prepare?.renew ?? []) warm.add(id)
    const pressed = o.press?.(w, arc) ?? null
    if (pressed !== null) {
      const next = pressRadioIntensity(arc, pressed, { lap, phraseLaps: P, late: false })
      if (next !== null) arc = next
    }
    const sounding = rows.filter((r) => !r.resting && !r.muted)
    trace.push({
      wrap: w,
      lap,
      applied: a,
      decided: step.decided,
      prepare: step.prepare,
      phase: arc.phase,
      rows: rows.length,
      sounding: sounding.length,
      low: sounding.some((r) => r.kinds.includes('drums') || r.kinds.includes('bass'))
    })
  }
  return { trace, arc }
}

const changes = (t: Trace[]): Trace[] => t.filter((x) => x.applied !== null)

describe('targets', () => {
  it('match the knots (section 3.2)', () => {
    const at = (e: number, d: number, big = false): number[] => {
      const t = radioIntensityTargets(e, d, big)
      return [Math.round(t.lo * 100) / 100, Math.round(t.hi * 100) / 100]
    }
    expect(at(0, 0)).toEqual([0.2, 0.5])
    expect(at(50, 60)).toEqual([0.14, 0.86])
    expect(at(100, 100)).toEqual([0.15, 1])
    expect(at(50, 60, true)).toEqual([0.14, 1])
    expect(at(0, 0, true)).toEqual([0.2, 0.65])
  })

  it('rise by phrase through the build, lo in the breakdown, hi in the drop', () => {
    const arc: RadioIntensityArc = { ...newRadioIntensityArc(), begun: true, phrases: 4 }
    const { lo, hi } = radioIntensityTargets(50, 60, false)
    const ks = [0, 1, 2, 3].map((done) => radioIntensityTarget({ ...arc, done }, 50, 60))
    ks.forEach((t, k) => expect(t).toBeCloseTo(lo + ((hi - lo) * (k + 1)) / 4, 9))
    expect(radioIntensityTarget({ ...arc, phase: 'breakdown' }, 50, 60)).toBeCloseTo(lo, 9)
    expect(radioIntensityTarget({ ...arc, phase: 'drop' }, 50, 60)).toBeCloseTo(hi, 9)
  })
})

describe('lengths', () => {
  it('draw from the energy menus (big: build and ride +1)', () => {
    expect(INTENSITY_PHRASES).toEqual({
      build: { low: [3, 4], mid: [2, 3, 4], high: [2, 3] },
      breakdown: { low: [2], mid: [1, 2], high: [1] },
      drop: { low: [1], mid: [1, 2], high: [2, 3] }
    })
    for (const [energy, band] of [
      [0, 'low'],
      [33, 'low'],
      [34, 'mid'],
      [66, 'mid'],
      [67, 'high'],
      [100, 'high']
    ] as const) {
      const { trace } = simulate({ loopBars: 4, wraps: 2400, energy, seed: `len${energy}` })
      const seen = { breakdown: new Set<number>(), drop: new Set<number>() }
      for (const c of changes(trace)) {
        const a = c.applied!
        if (a.event === 'breakdown') seen.breakdown.add(a.next!.phrases)
        if (a.event === 'drop' && a.next) seen.drop.add(a.next.phrases)
      }
      expect([...seen.breakdown].sort(), `${energy}`).toEqual([
        ...INTENSITY_PHRASES.breakdown[band]
      ])
      for (const p of seen.drop) {
        const menu = INTENSITY_PHRASES.drop[band]
        expect(menu.includes(p) || menu.includes(p - 1), `${energy} drop ${p}`).toBe(true)
      }
    }
  })

  it('a build is raised to fit its adds: one per phrase start after the first', () => {
    // energy 50 can draw a 2-phrase build; from 2 rows to 5 needs 3 adds, so 4 phrases
    for (const seed of ['a', 'b', 'c', 'd']) {
      const arc = radioIntensityStarted({
        energy: 60,
        drama: 60,
        min: 2,
        max: 5,
        count: 2,
        random: seededRandom(seed)
      })
      expect(arc.peakRows).toBe(5)
      expect(arc.phrases).toBeGreaterThanOrEqual(4)
      expect(arc.first).toBe(true)
      expect(arc.big).toBe(false)
    }
  })

  it('a cycle at the defaults averages about six phrases', () => {
    const { trace } = simulate({ loopBars: 4, wraps: 4 * 2000, seed: 'mean' })
    const starts = changes(trace).filter((c) => c.applied!.event === 'cycle')
    const span = (starts[starts.length - 1].wrap - starts[0].wrap) / (starts.length - 1) / 4
    expect(span).toBeGreaterThan(5)
    expect(span).toBeLessThan(7.5)
  })
})

describe('the clock', () => {
  it('changes phase only on phrase starts, at loops of 1 to 32 bars', () => {
    for (const loopBars of [1, 2, 3, 4, 5, 8, 16, 32]) {
      const { trace } = simulate({ loopBars, wraps: 600, seed: `clock${loopBars}` })
      const phaseChanges = changes(trace).filter((c) => c.applied!.event !== 'add')
      expect(phaseChanges.length, `${loopBars}`).toBeGreaterThan(3)
      for (const c of changes(trace)) expect(c.lap, `${loopBars} wrap ${c.wrap}`).toBe(0)
    }
  })

  it('decides one wrap ahead (binding), and prepares a phrase ahead of the decision', () => {
    for (const loopBars of [2, 4, 16]) {
      const { trace } = simulate({ loopBars, wraps: 800, seed: `ahead${loopBars}` })
      for (let i = 1; i < trace.length; i++) {
        if (trace[i].applied !== null) expect(trace[i].applied).toEqual(trace[i - 1].decided)
      }
      const P = turnaroundPhraseLaps(16, loopBars)
      for (const t of trace) {
        if (t.applied?.event !== 'drop') continue
        const prep = trace.filter((x) => x.wrap < t.wrap && (x.prepare?.renew.length ?? 0) > 0)
        const last = prep[prep.length - 1]
        expect(last, `${loopBars}: a drop at ${t.wrap} was prepared`).toBeDefined()
        // prepared before it was decided (two wraps with a one-lap phrase)
        expect(t.wrap - last.wrap, `${loopBars}`).toBeGreaterThanOrEqual(Math.max(P, 2))
      }
    }
  })

  it('held: the clock stops and nothing is decided; a decided event still lands', () => {
    const arc = radioIntensityStarted({
      energy: 50,
      drama: 60,
      min: 2,
      max: 5,
      count: 2,
      random: () => 0
    })
    let draws = 0
    const input: RadioIntensityStepInput = {
      energy: 50,
      drama: 60,
      loopBars: 4,
      lap: 3,
      phraseLaps: 4,
      held: true,
      count: 2,
      min: 2,
      max: 5,
      rows: [],
      canAdd: true,
      canStrip: false,
      carryReady: false,
      renewReady: () => true,
      random: () => {
        draws += 1
        return 0
      }
    }
    const r = stepRadioIntensityArc(arc, input)
    expect(r.state).toEqual(arc)
    expect(r.decided).toBeNull()
    expect(draws).toBe(0)
    const decided: RadioIntensityArc = { ...arc, decided: { event: 'add' } }
    const landed = stepRadioIntensityArc(decided, { ...input, lap: 0 })
    expect(landed.applied).toEqual({ event: 'add' })
    expect(landed.state.decided).toBeNull()
    expect(landed.state.done).toBe(arc.done)
  })

  it('a machine switched on mid-run begins at the next phrase start, drawing nothing before', () => {
    let draws = 0
    const random = (): number => {
      draws += 1
      return 0.5
    }
    const base = {
      energy: 50,
      drama: 60,
      loopBars: 4,
      phraseLaps: 4,
      held: false,
      count: 4,
      min: 2,
      max: 5,
      rows: [],
      canAdd: true,
      canStrip: true,
      carryReady: false,
      renewReady: () => false,
      random
    }
    let arc = newRadioIntensityArc()
    for (const lap of [2, 3]) arc = stepRadioIntensityArc(arc, { ...base, lap }).state
    expect(arc.begun).toBe(false)
    expect(draws).toBe(0)
    arc = stepRadioIntensityArc(arc, { ...base, lap: 0 }).state
    expect(arc).toMatchObject({ begun: true, phase: 'build', done: 0, first: true })
    expect(draws).toBeGreaterThan(0)
  })
})

describe('the cycle', () => {
  it('runs build, breakdown, drop, build ... and strips back at each later build', () => {
    const { trace } = simulate({ loopBars: 4, wraps: 1200, seed: 'cycle' })
    const order = changes(trace)
      .map((c) => c.applied!.event)
      .filter((e) => e !== 'add')
    for (let i = 0; i < order.length; i++) {
      expect(order[i]).toBe(['breakdown', 'drop', 'cycle'][i % 3])
    }
    for (const c of changes(trace))
      if (c.applied!.event === 'cycle') expect(c.applied).toMatchObject({ strip: true })
  })

  it('grows one row per phrase start to the peak, and the drop keeps the count', () => {
    const { trace } = simulate({ loopBars: 4, wraps: 1200, energy: 80, seed: 'peak' })
    let last = 2
    for (const t of trace) {
      expect(Math.abs(t.rows - last)).toBeLessThanOrEqual(1)
      last = t.rows
      if (t.applied?.event === 'breakdown') expect(t.rows).toBeGreaterThanOrEqual(4)
    }
  })

  it('bigger peaks: never the first cycle, then every 3-4 cycles', () => {
    const { trace } = simulate({ loopBars: 4, wraps: 4 * 600, seed: 'big' })
    const cycles = changes(trace).filter((c) => c.applied!.event === 'cycle')
    const bigs = cycles
      .map((c, i) => ({ i: i + 2, big: (c.applied as { next?: { big?: boolean } }).next?.big }))
      .filter((c) => c.big)
      .map((c) => c.i)
    expect(bigs.length).toBeGreaterThan(5)
    expect(bigs[0]).toBeGreaterThanOrEqual(4)
    for (let i = 1; i < bigs.length; i++) expect([3, 4]).toContain(bigs[i] - bigs[i - 1])
  })

  it('a big cycle heads for DENSITY_MAX and breaks down one level deeper', () => {
    expect(radioBreakdownDepth(10, false)).toBe('swell')
    expect(radioBreakdownDepth(10, true)).toBe('thin')
    expect(radioBreakdownDepth(40, false)).toBe('thin')
    expect(radioBreakdownDepth(40, true)).toBe('full')
    expect(radioBreakdownDepth(60, false)).toBe('full')
    expect(radioBreakdownDepth(100, true)).toBe('full')
    const { trace } = simulate({ loopBars: 4, wraps: 4 * 300, energy: 20, seed: 'bigpeak' })
    for (const c of changes(trace)) {
      const a = c.applied!
      if (a.event === 'cycle' && a.next?.big) expect(a.next.peakRows).toBe(DENSITY_MAX)
    }
  })
})

describe('the breakdown', () => {
  const R = (
    id: string,
    kinds: DiscoverSlotKind[],
    o: Partial<RadioIntensityRow> = {}
  ): RadioIntensityRow => ({
    id,
    kinds,
    score: 0.5,
    staleness: 0,
    sounding: true,
    restable: true,
    ...o
  })

  it('swell rests nothing; thin keeps the sparsest drums; full rests every drums and bass row', () => {
    const bed = [
      R('d1', ['drums'], { score: 0.9 }),
      R('d2', ['drums'], { score: 0.2 }),
      R('b', ['bass']),
      R('l', ['lead']),
      R('w', ['warm'])
    ]
    expect(radioBreakdownRests(bed, 'swell', false).rest).toEqual([])
    expect(radioBreakdownRests(bed, 'thin', false)).toMatchObject({
      depth: 'thin',
      rest: ['d1', 'b'],
      throwRowId: 'd1'
    })
    expect(radioBreakdownRests(bed, 'full', false)).toMatchObject({
      depth: 'full',
      rest: ['d1', 'd2', 'b'],
      throwRowId: 'd1',
      carry: false
    })
  })

  it('counts a combination row as low; bassHeavy and rhythmic are not', () => {
    const bed = [R('db', ['drums', 'bass']), R('h', ['bassHeavy']), R('r', ['rhythmic'])]
    expect(radioBreakdownRests(bed, 'full', false).rest).toEqual(['db'])
  })

  it('unknown scores read 0.5, ties go to the stalest; an unrestable drums row is the kept one', () => {
    const bed = [
      R('a', ['drums'], { score: null, staleness: 1 }),
      R('b', ['drums'], { score: 0.5, staleness: 9 }),
      R('l', ['lead'])
    ]
    expect(radioBreakdownRests(bed, 'thin', false).rest).toEqual(['a'])
    const locked = [R('a', ['drums'], { restable: false }), R('b', ['drums']), R('l', ['lead'])]
    expect(radioBreakdownRests(locked, 'thin', false).rest).toEqual(['b'])
  })

  it('with no carrier: a carry row when one is ready, else full falls to thin', () => {
    const bed = [R('d', ['drums']), R('b', ['bass'])]
    expect(radioBreakdownRests(bed, 'full', true)).toMatchObject({ rest: ['d', 'b'], carry: true })
    expect(radioBreakdownRests(bed, 'full', false)).toMatchObject({ depth: 'thin', rest: ['b'] })
    expect(radioCarryKind([{ kinds: ['drums'] }])).toBe('lead')
    expect(radioCarryKind([{ kinds: ['lead'] }])).toBe('warm')
  })

  it('never silence: something always sounds (10k random beds)', () => {
    const r = seededRandom('never-silence')
    const kinds: DiscoverSlotKind[] = ['drums', 'bass', 'lead', 'warm', 'bright', 'rhythmic']
    for (let i = 0; i < 10000; i++) {
      const n = 1 + Math.floor(r() * 6)
      const bed: RadioIntensityRow[] = Array.from({ length: n }, (_, j) => {
        const ks: DiscoverSlotKind[] = [kinds[Math.floor(r() * kinds.length)]]
        if (r() < 0.15) ks.push(kinds[Math.floor(r() * kinds.length)])
        const sounding = r() < 0.85
        return R(`x${j}`, ks, {
          score: r() < 0.2 ? null : r(),
          staleness: Math.floor(r() * 10),
          sounding,
          restable: sounding && r() < 0.8
        })
      })
      if (!bed.some((x) => x.sounding)) continue
      const depth = (['thin', 'full'] as const)[Math.floor(r() * 2)]
      const carry = r() < 0.5
      const out = radioBreakdownRests(bed, depth, carry)
      const left = bed.filter((x) => x.sounding && !out.rest.includes(x.id))
      expect(left.length > 0 || out.carry, JSON.stringify({ bed, out })).toBe(true)
      for (const id of out.rest) {
        const row = bed.find((x) => x.id === id)!
        expect(row.restable && row.sounding).toBe(true)
        expect(row.kinds.includes('drums') || row.kinds.includes('bass')).toBe(true)
      }
      if (out.throwRowId !== null) {
        expect(out.rest).toContain(out.throwRowId)
        expect(bed.find((x) => x.id === out.throwRowId)!.kinds).toContain('drums')
      }
    }
  })

  it('in a run, the low end is missing only in a breakdown, and nothing is ever silent', () => {
    for (const drama of [0, 40, 100]) {
      const { trace } = simulate({ loopBars: 4, wraps: 2000, drama, seed: `low${drama}` })
      for (const t of trace) {
        expect(t.sounding, `${drama} wrap ${t.wrap}`).toBeGreaterThan(0)
        if (!t.low) expect(t.phase, `${drama} wrap ${t.wrap}`).toBe('breakdown')
      }
      const breakdowns = trace.filter((t) => t.phase === 'breakdown')
      const lowShare = breakdowns.filter((t) => t.low).length / Math.max(1, breakdowns.length)
      if (drama >= 60) expect(lowShare).toBeLessThan(0.5)
      if (drama < 25) expect(lowShare).toBe(1)
    }
  })

  it('ends after phrases + 1 phrase starts in any case (overran)', () => {
    const arc: RadioIntensityArc = {
      ...newRadioIntensityArc(),
      begun: true,
      phase: 'breakdown',
      phrases: 1,
      done: 1,
      rests: ['d']
    }
    const r = stepRadioIntensityArc(arc, {
      energy: 50,
      drama: 60,
      loopBars: 4,
      lap: 0,
      phraseLaps: 4,
      held: false,
      count: 3,
      min: 2,
      max: 5,
      rows: [],
      canAdd: false,
      canStrip: false,
      carryReady: false,
      renewReady: () => false,
      random: () => 0.5
    })
    expect(r.overran).toBe(true)
    expect(r.decided).toMatchObject({ event: 'drop', returning: ['d'] })
  })
})

describe('the drop', () => {
  it('brings every rested row back; renews warm drums and bass at 0.25 + 0.5 drama', () => {
    const counts = { renewed: 0, returning: 0 }
    for (let s = 0; s < 40; s++) {
      const { trace } = simulate({ loopBars: 4, wraps: 600, drama: 60, seed: `renew${s}` })
      for (const c of changes(trace)) {
        const a = c.applied!
        if (a.event !== 'drop') continue
        counts.returning += a.returning.length
        counts.renewed += a.renew.length
        for (const id of a.renew) expect(a.returning).toContain(id)
      }
    }
    expect(counts.returning).toBeGreaterThan(100)
    expect(counts.renewed / counts.returning).toBeGreaterThan(0.45)
    expect(counts.renewed / counts.returning).toBeLessThan(0.65)
  })

  it('a renewal not warm by the decide wrap is the own stem, with no draw', () => {
    const arc: RadioIntensityArc = {
      ...newRadioIntensityArc(),
      begun: true,
      phase: 'breakdown',
      phrases: 1,
      done: 0,
      rests: ['d', 'b']
    }
    const draws: number[] = []
    const r = stepRadioIntensityArc(arc, {
      energy: 50,
      drama: 60,
      loopBars: 4,
      lap: 3,
      phraseLaps: 4,
      held: false,
      count: 3,
      min: 2,
      max: 5,
      rows: [
        { id: 'd', kinds: ['drums'], score: 0.5, staleness: 0, sounding: false, restable: false },
        { id: 'b', kinds: ['bass'], score: 0.5, staleness: 0, sounding: false, restable: false },
        { id: 'l', kinds: ['lead'], score: 0.5, staleness: 0, sounding: true, restable: true }
      ],
      canAdd: false,
      canStrip: false,
      carryReady: false,
      renewReady: (id) => id === 'b',
      random: () => {
        draws.push(0)
        return 0
      }
    })
    expect(r.decided).toMatchObject({ event: 'drop', returning: ['d', 'b'], renew: ['b'] })
    // one renewal draw (b), then the ride's length (energy 50: {1, 2})
    expect(draws).toHaveLength(2)
  })
})

describe('the buttons', () => {
  const at = (
    phase: RadioIntensityArc['phase'],
    o: Partial<RadioIntensityArc> = {}
  ): RadioIntensityArc => ({
    ...newRadioIntensityArc(),
    begun: true,
    phase,
    phrases: 3,
    done: 1,
    ...o
  })
  const where = { lap: 1, phraseLaps: 4, late: false }

  it('build in the ride: a new cycle at the next top', () => {
    expect(pressRadioIntensity(at('drop'), 'build', where)?.decided).toEqual({
      event: 'cycle',
      strip: true,
      forced: true
    })
  })

  it('build in the build: an add at the top, the remaining phrases halved', () => {
    const r = pressRadioIntensity(at('build', { phrases: 5, done: 1 }), 'build', where)!
    expect(r.decided).toEqual({ event: 'add', forced: true })
    expect(r.phrases).toBe(3)
    expect(pressRadioIntensity(at('build', { phrases: 2, done: 1 }), 'build', where)!.phrases).toBe(
      2
    )
  })

  it('build in the breakdown: the drop at the next phrase start whose decide wrap has not passed', () => {
    const b = at('breakdown', { phrases: 2, done: 0 })
    expect(pressRadioIntensity(b, 'build', where)).toMatchObject({ phrases: 1, decided: null })
    expect(pressRadioIntensity(b, 'build', { ...where, lap: 3 })).toMatchObject({ phrases: 2 })
  })

  it('drop in the breakdown: the rested rows back at the top, no renewals', () => {
    expect(pressRadioIntensity(at('breakdown', { rests: ['d'] }), 'drop', where)?.decided).toEqual({
      event: 'drop',
      returning: ['d'],
      renew: [],
      forced: true
    })
  })

  it('drop while building or riding: a quick drop, then a fresh ride', () => {
    for (const p of ['build', 'drop'] as const) {
      expect(pressRadioIntensity(at(p), 'drop', where)?.decided).toEqual({
        event: 'drop',
        returning: [],
        renew: [],
        quick: true,
        forced: true
      })
    }
  })

  it('late, or with the top already spoken for: the top after; labels say it waits', () => {
    const late = pressRadioIntensity(at('drop'), 'build', { ...where, late: true })!
    expect(late).toMatchObject({ forced: 'build', decided: null })
    expect(radioIntensityButtonLabel('build', late)).toBe('building')
    expect(radioIntensityButtonLabel('drop', late)).toBe('drop')
    const taken = pressRadioIntensity(at('build', { decided: { event: 'add' } }), 'drop', where)!
    expect(taken).toMatchObject({ forced: 'drop', decided: { event: 'add' } })
    expect(radioIntensityButtonLabel('drop', taken)).toBe('dropping')
    const now = pressRadioIntensity(at('build'), 'drop', where)!
    expect(radioIntensityButtonLabel('drop', now)).toBe('dropping')
    expect(radioIntensityButtonLabel('build', now)).toBe('build')
    expect(pressRadioIntensity(newRadioIntensityArc(), 'drop', where)).toBeNull()
  })

  it('every press lands in a run, and the cycle goes on', () => {
    const { trace } = simulate({
      loopBars: 4,
      wraps: 800,
      seed: 'press',
      press: (w) => (w % 37 === 0 ? 'drop' : w % 53 === 0 ? 'build' : null)
    })
    expect(changes(trace).some((c) => (c.applied as { quick?: boolean }).quick === true)).toBe(true)
    for (const t of trace) expect(t.sounding).toBeGreaterThan(0)
  })
})

describe('what the rest of radio reads', () => {
  const arc = (o: Partial<RadioIntensityArc>): RadioIntensityArc => ({
    ...newRadioIntensityArc(),
    begun: true,
    ...o
  })
  const bd: RadioIntensityDecided = {
    event: 'breakdown',
    depth: 'full',
    rest: [],
    throwRowId: null,
    throw: null,
    carry: false
  }
  const drop: RadioIntensityDecided = { event: 'drop', returning: [], renew: [] }

  it('the arcRole and the turnaround arc follow the decided event', () => {
    expect(radioIntensityArcRole(arc({}))).toBe('hold')
    expect(radioIntensityArcRole(arc({ decided: { event: 'add' } }))).toBe('build')
    expect(radioIntensityArcRole(arc({ decided: { event: 'cycle', strip: true } }))).toBe('strip')
    expect(radioIntensityArcRole(arc({ decided: { event: 'cycle', strip: false } }))).toBe('build')
    expect(radioIntensityArcRole(arc({ decided: bd }))).toBe('breakdown')
    expect(radioIntensityArcRole(arc({ decided: drop }))).toBe('drop')
    expect(radioIntensityTurnaroundArc(arc({ phase: 'build' }))).toBe('growing')
    expect(radioIntensityTurnaroundArc(arc({ phase: 'build', decided: bd }))).toBe('thinning')
    expect(radioIntensityTurnaroundArc(arc({ phase: 'breakdown' }))).toBe('thinning')
    expect(radioIntensityTurnaroundArc(arc({ phase: 'breakdown', decided: drop }))).toBe('growing')
    expect(radioIntensityTurnaroundArc(arc({ phase: 'drop' }))).toBe('steady')
  })

  it("the hooks' inputs", () => {
    expect(radioIntensityHookInputs(arc({ phase: 'build' }))).toEqual({
      dropAtNextWrap: false,
      inBreakdown: false
    })
    expect(radioIntensityHookInputs(arc({ phase: 'build', decided: bd }))).toEqual({
      dropAtNextWrap: false,
      inBreakdown: true
    })
    expect(radioIntensityHookInputs(arc({ phase: 'breakdown' }))).toEqual({
      dropAtNextWrap: false,
      inBreakdown: true
    })
    expect(radioIntensityHookInputs(arc({ phase: 'breakdown', decided: drop }))).toEqual({
      dropAtNextWrap: true,
      inBreakdown: false
    })
  })

  it('the bend: about +-15 at the default drama, clamped', () => {
    expect(radioIntensityBend(40, 60, 0.86)).toBeCloseTo(40 + 25 * 0.6 * 0.72, 9)
    expect(radioIntensityBend(40, 60, 0.14)).toBeCloseTo(40 - 25 * 0.6 * 0.72, 9)
    expect(radioIntensityBend(95, 100, 1)).toBe(100)
    expect(radioIntensityBend(5, 100, 0)).toBe(0)
    expect(radioIntensityBend(40, 0, 1)).toBe(40)
  })

  it('bars to the drop in a breakdown', () => {
    const b = arc({ phase: 'breakdown', phrases: 2, done: 0 })
    expect(radioIntensityDropInBars(b, { lap: 1, phraseLaps: 4, loopBars: 4, pos: 2 })).toBe(
      (4 + 3) * 4 - 2
    )
    expect(
      radioIntensityDropInBars(arc({ phase: 'build' }), {
        lap: 1,
        phraseLaps: 4,
        loopBars: 4,
        pos: 2
      })
    ).toBeNull()
    expect(
      radioIntensityDropInBars(arc({ phase: 'breakdown', decided: drop }), {
        lap: 3,
        phraseLaps: 4,
        loopBars: 4,
        pos: 1
      })
    ).toBe(3)
  })

  it('a row given back by hand leaves the rests and the decided lists', () => {
    const resting = arc({
      phase: 'breakdown',
      rests: ['d', 'b'],
      decided: { ...drop, returning: ['d', 'b'], renew: ['b'] }
    })
    const r = releaseRadioIntensityRest(resting, 'b')
    expect(r.rests).toEqual(['d'])
    expect(r.decided).toEqual({ ...drop, returning: ['d'], renew: [] })
    const soon = arc({
      phase: 'build',
      decided: {
        ...bd,
        rest: ['d'],
        throwRowId: 'd',
        throw: { beats: 1, timing: 'quarter', feedback: 0.5 }
      }
    })
    expect(releaseRadioIntensityRest(soon, 'd').decided).toMatchObject({
      rest: [],
      throwRowId: null,
      throw: null
    })
    const plain = arc({ phase: 'drop' })
    expect(releaseRadioIntensityRest(plain, 'x')).toBe(plain)
  })

  it('stopping puts every rested row back (and the ones about to rest)', () => {
    const r = radioIntensityStopped(
      arc({ phase: 'build', rests: ['a'], decided: { ...bd, rest: ['b'] } })
    )
    expect(r.unrest.sort()).toEqual(['a', 'b'])
    expect(r.state).toEqual(newRadioIntensityArc())
    expect(NO_RADIO_INTENSITY_ARC.begun).toBe(false)
  })
})

describe('draws (section 3.5)', () => {
  it('draw only at a cycle, a phase change and the renewals: nothing on a plain wrap', () => {
    let draws = 0
    const random = (): number => {
      draws += 1
      return 0.3
    }
    let arc = radioIntensityStarted({ energy: 50, drama: 60, min: 2, max: 5, count: 4, random })
    expect(draws).toBe(2) // the countdown, the build's length
    draws = 0
    const input = (lap: number): RadioIntensityStepInput => ({
      energy: 50,
      drama: 60,
      loopBars: 4,
      lap,
      phraseLaps: 4,
      held: false,
      count: 4,
      min: 2,
      max: 5,
      rows: [],
      canAdd: false,
      canStrip: true,
      carryReady: false,
      renewReady: () => false,
      random
    })
    // a build's middle laps: no draws
    for (const lap of [1, 2]) arc = stepRadioIntensityArc(arc, input(lap)).state
    expect(draws).toBe(0)
  })

  it('a breakdown with a drums row resting draws the throw (3), then its length', () => {
    const order: string[] = []
    let k = 0
    const random = (): number => {
      order.push(`d${k++}`)
      return 0.4
    }
    const arc: RadioIntensityArc = {
      ...newRadioIntensityArc(),
      begun: true,
      phase: 'build',
      phrases: 2,
      done: 1
    }
    const r = stepRadioIntensityArc(arc, {
      energy: 50,
      drama: 80,
      loopBars: 4,
      lap: 3,
      phraseLaps: 4,
      held: false,
      count: 3,
      min: 2,
      max: 5,
      rows: [
        { id: 'd', kinds: ['drums'], score: 0.5, staleness: 0, sounding: true, restable: true },
        { id: 'b', kinds: ['bass'], score: 0.5, staleness: 0, sounding: true, restable: true },
        { id: 'l', kinds: ['lead'], score: 0.5, staleness: 0, sounding: true, restable: true }
      ],
      canAdd: false,
      canStrip: false,
      carryReady: false,
      renewReady: () => false,
      random
    })
    expect(r.decided).toMatchObject({
      event: 'breakdown',
      depth: 'full',
      rest: ['d', 'b'],
      throwRowId: 'd'
    })
    expect(order).toHaveLength(4)
  })

  it('the same seed replays the same arc', () => {
    const a = simulate({ loopBars: 4, wraps: 500, seed: 'replay' }).trace
    const b = simulate({ loopBars: 4, wraps: 500, seed: 'replay' }).trace
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})
```

  - Run `npx vitest run src/shared/radioIntensityArc.test.ts`. **Expected:** FAIL (the module is
    missing).

- [ ] **Step 2: The machine.** Create `src/shared/radioIntensityArc.ts`:

```ts
// src/shared/radioIntensityArc.ts
//
// THE INTENSITY ARC: build, breakdown, drop (docs/superpowers/specs/2026-10-05-radio-intensity-
// arc-design.md sections 3-6). While radio runs with density `intensity`, the bed moves through
// cycles: a BUILD over 2-4 phrases (the picks for drums and bass lean busier and heavier, rows are
// added one per phrase start), a BREAKDOWN on the one for 1-2 phrases (drums thin or drop, the
// bass leaves, pads and leads carry it), then THE DROP: drums and bass back with the full riser and
// gap, and a ride at the top. Every few cycles a bigger peak: higher, longer, a deeper breakdown.
//
// Two dials: `energy` moves where the time goes (gentle with long breakdowns to driving with long
// rides), `drama` how far the targets and rows swing (a subtle swell to the full breakdown).
//
// The machine is pure and seeded: the runtime steps it at every loop top (after the lap
// bookkeeping, before hooks, the fold step and the turnaround roll: section 3.1) and does what it
// says -- removes a row (the strip-back), adds one, rests rows, brings them back. Like hooks, an
// event is DECIDED at the wrap starting a phrase's last lap (binding) and lands on the phrase start
// after it; what needs warming is PREPARED a phrase ahead.
//
// THE CLOCK is the turnaround phrase (16 bars at every pace): `lap` is the clock's turnaroundLap
// starting at this wrap, `phraseLaps` turnaroundPhraseLaps. A phrase start is a wrap with lap 0;
// the decide wrap has lap phraseLaps - 1 (with a one-lap phrase every wrap is both, and an event
// is prepared two wraps ahead). Held: the clock stops and nothing is decided; a decided event
// still lands.
//
// DRAWS (section 3.5), from the caller's one random, in this order and nowhere else. A phase's
// length is drawn when the phase is DECIDED (so a one-lap phrase can prepare two wraps ahead):
//   1. radio's start (radioIntensityStarted): the first cycle's countdown, then its build's length;
//   2. a cycle's decide wrap: the bigger-peak countdown when it is due (it reaches 0), then the
//      build's length;
//   3. the breakdown's decide wrap: the echo throw's three (beats, timing, feedback) when a drums
//      row rests -- the hook exit's own draws (radioThrows' drawThrowBeats, drawThrowEcho) --
//      then the breakdown's length;
//   4. the drop's decide wrap: one renewal draw per returning drums or bass row whose fresh pick
//      is warm, in row order, then the ride's length.
// A one-value length menu draws nothing. A button's event is decided without a draw; its phase's
// length (and a cycle's countdown) is drawn where it lands.

import type { DiscoverSlotKind } from './discoverSlotKind'
import type { RadioHookThrow } from './radioHooks'
import { drawThrowBeats, drawThrowEcho } from './radioThrows'
import type { TurnaroundArc } from './radioTurnaround'

export type RadioIntensityPhase = 'build' | 'breakdown' | 'drop'
export type RadioBreakdownDepth = 'swell' | 'thin' | 'full'
export type RadioIntensityAction = 'build' | 'drop'

/** The phase an event begins, worked out (and drawn) when it is decided. Absent on a button's
 * event: drawn where it lands. */
export interface RadioIntensityNext {
  phrases: number
  /** A cycle's: this cycle is a bigger peak, the countdown after it, its build's peak. */
  big?: boolean
  untilBig?: number | null
  peakRows?: number
}

/** An event decided at a decide wrap (or by a button), landing at the NEXT wrap: binding. */
export type RadioIntensityDecided =
  | {
      /** A new cycle's build begins: `strip` -- one row leaves first (pickArcRemoval). */
      event: 'cycle'
      strip: boolean
      next?: RadioIntensityNext
      forced?: true
    }
  | { event: 'add'; forced?: true }
  | {
      event: 'breakdown'
      depth: RadioBreakdownDepth
      /** Rows that go silent on the one (rested, not removed), in row order. */
      rest: string[]
      /** The one drums row that leaves with an echo throw ending on the one, and its shape. */
      throwRowId: string | null
      throw: RadioHookThrow | null
      /** The prepared carry row joins on the one (no carrier would sound otherwise). */
      carry: boolean
      next?: RadioIntensityNext
    }
  | {
      event: 'drop'
      /** Rows the breakdown rested, back on the one. */
      returning: string[]
      /** The returning (or, at swell depth, playing) drums and bass rows that come back on their
       * fresh, heavier pick instead of their own stem. */
      renew: string[]
      /** A button's quick drop (pressed while building or riding): the planner's low drop in the
       * lap before, no rests, no renewals, then a fresh ride. */
      quick?: true
      next?: RadioIntensityNext
      forced?: true
    }

export interface RadioIntensityArc {
  /** False until the first phrase start the machine sees (a switch from `arc` mid-run waits for
   * one); radioIntensityStarted begins it at radio's own start. */
  begun: boolean
  phase: RadioIntensityPhase
  /** The phase's length in phrases, drawn at its start. */
  phrases: number
  /** Phrase starts passed in this phase. */
  done: number
  /** This cycle is a bigger peak. */
  big: boolean
  /** Cycles until the next bigger peak; null before the first cycle. */
  untilBig: number | null
  /** The row count this cycle's build heads for. */
  peakRows: number
  /** The first build after radio starts: it grows from DENSITY_MIN and strips nothing. */
  first: boolean
  /** The breakdown's depth (decided at its decide wrap), null outside one. */
  depth: RadioBreakdownDepth | null
  /** Rows the breakdown rested. */
  rests: string[]
  /** A button's press waiting for a top whose wrap is free. */
  forced: RadioIntensityAction | null
  /** The event landing at the next wrap, or null. */
  decided: RadioIntensityDecided | null
  /** The runtime was asked to prepare for the phase change coming (once per change). */
  prepared: boolean
}

export const NO_RADIO_INTENSITY_ARC: RadioIntensityArc = Object.freeze({
  begun: false,
  phase: 'build',
  phrases: 0,
  done: 0,
  big: false,
  untilBig: null,
  peakRows: 0,
  first: true,
  depth: null,
  rests: Object.freeze([]) as unknown as string[],
  forced: null,
  decided: null,
  prepared: false
}) as RadioIntensityArc

// ---- the numbers (section 3; every one [INF], to tune by ear) ----

/** Cycles between bigger peaks, drawn evenly. */
export const INTENSITY_UNTIL_BIG: readonly number[] = [3, 4]
/** A bigger peak's lift on the top target. */
export const INTENSITY_BIG_LIFT = 0.15
/** Energy thresholds for the length menus (e < LOW; e <= HIGH; above). */
export const INTENSITY_ENERGY_LOW = 0.34
export const INTENSITY_ENERGY_HIGH = 0.66
/** Drama thresholds for the breakdown's depth: under SWELL, swell; under FULL, thin; else full. */
export const INTENSITY_DRAMA_THIN = 25
export const INTENSITY_DRAMA_FULL = 60
/** A renewal's chance is BASE + SPAN * drama / 100 (Elling, 2026-10-05: as proposed). */
export const INTENSITY_RENEW_BASE = 0.25
export const INTENSITY_RENEW_SPAN = 0.5
/** A breakdown ends after `phrases` + this many phrase starts in any case. */
export const INTENSITY_BREAKDOWN_OVERRUN = 1
/** The fold bend's swing at full drama: bend + SWING * d * (2 tau - 1). */
export const INTENSITY_BEND_SWING = 25

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0)
const pickEven = <T>(items: readonly T[], random: () => number): T =>
  items[Math.min(items.length - 1, Math.floor(random() * items.length))]
/** A length menu draws only when it has a choice. */
const drawLength = (menu: readonly number[], random: () => number): number =>
  menu.length === 1 ? menu[0] : pickEven(menu, random)

type Band = 'low' | 'mid' | 'high'
function energyBand(energy: number): Band {
  const e = clamp01(energy / 100)
  return e < INTENSITY_ENERGY_LOW ? 'low' : e <= INTENSITY_ENERGY_HIGH ? 'mid' : 'high'
}

/** Each phase's length menu, in phrases, by energy (section 3.2; before a big cycle's +1). */
export const INTENSITY_PHRASES: Readonly<
  Record<RadioIntensityPhase, Record<Band, readonly number[]>>
> = {
  build: { low: [3, 4], mid: [2, 3, 4], high: [2, 3] },
  breakdown: { low: [2], mid: [1, 2], high: [1] },
  drop: { low: [1], mid: [1, 2], high: [2, 3] }
}

/** The targets (section 3.2): mid = 0.35 + 0.30 e, swing = 0.15 + 0.35 d; hi = min(1, mid +
 * swing) (+0.15 on a big cycle), lo = max(0, mid - swing). */
export function radioIntensityTargets(
  energy: number,
  drama: number,
  big: boolean
): { lo: number; hi: number } {
  const e = clamp01(energy / 100)
  const d = clamp01(drama / 100)
  const mid = 0.35 + 0.3 * e
  const swing = 0.15 + 0.35 * d
  const hi = Math.min(1, mid + swing)
  return { lo: Math.max(0, mid - swing), hi: big ? Math.min(1, hi + INTENSITY_BIG_LIFT) : hi }
}

/** The target for picks now: rising by phrase through the build (phrase k of n: lo + (hi - lo)
 * (k + 1) / n), lo in the breakdown, hi in the drop. Before the machine has begun: lo. */
export function radioIntensityTarget(
  arc: RadioIntensityArc,
  energy: number,
  drama: number
): number {
  const { lo, hi } = radioIntensityTargets(energy, drama, arc.big)
  if (!arc.begun) return lo
  switch (arc.phase) {
    case 'build': {
      const n = Math.max(1, arc.phrases)
      return lo + ((hi - lo) * (Math.min(arc.done, n - 1) + 1)) / n
    }
    case 'breakdown':
      return lo
    case 'drop':
      return hi
  }
}

/** The breakdown's depth from drama, a big cycle one level deeper (`full` stays `full`). */
export function radioBreakdownDepth(drama: number, big: boolean): RadioBreakdownDepth {
  const base: RadioBreakdownDepth =
    drama < INTENSITY_DRAMA_THIN ? 'swell' : drama < INTENSITY_DRAMA_FULL ? 'thin' : 'full'
  if (!big) return base
  return base === 'swell' ? 'thin' : 'full'
}

/** A bigger peak's countdown, drawn. */
function drawUntilBig(random: () => number): number {
  return pickEven(INTENSITY_UNTIL_BIG, random)
}

// ---- which rows go silent (section 4.1) ----

/** One row as the breakdown sees it, in row order. */
export interface RadioIntensityRow {
  id: string
  kinds: readonly DiscoverSlotKind[]
  /** Its stem's intensity score (null: unscored, read as 0.5). */
  score: number | null
  /** Turns since it last changed (higher is staler). */
  staleness: number
  /** Heard now, and not resting (for a hook or the arc). */
  sounding: boolean
  /** The arc may rest it: not locked, not soloed or outside the solo, not muted by the user, no
   * manual change or swap-now for the line, not resting for a hook. */
  restable: boolean
}

const isLow = (kinds: readonly DiscoverSlotKind[]): boolean =>
  kinds.includes('drums') || kinds.includes('bass')

/** A row that carries a breakdown: not drums or bass, and sounding. */
export function radioBreakdownCarrier(r: RadioIntensityRow): boolean {
  return r.sounding && !isLow(r.kinds)
}

/** The kind of a carry row (section 4.1 rule 2): a lead, or a warm row when a lead is already on
 * the bed. */
export function radioCarryKind(
  rows: readonly { kinds: readonly DiscoverSlotKind[] }[]
): DiscoverSlotKind {
  return rows.some((r) => r.kinds.includes('lead')) ? 'warm' : 'lead'
}

/**
 * The rows a breakdown rests (section 4.1), a SEPARATE rule from the arc's removal: it breaks the
 * last-drums-and-bass rule on purpose, bounded in time (the breakdown) and in reach (something
 * always sounds).
 *   - swell: nothing;
 *   - thin: every bass row; every drums row but one -- the kept one is a sounding drums row the
 *     arc may not rest (it stays anyway), else the lowest-scored (unknown 0.5, ties to the
 *     stalest);
 *   - full: every drums and every bass row.
 * A row is low when its kinds include drums or bass (a combination row counts; bassHeavy and
 * rhythmic do not). With no carrier, a carry row joins when `carryReady`; else `full` falls to
 * `thin`. Last: if nothing would sound, the lowest-scored low row keeps sounding. An empty rest
 * reads as `swell`. The throw goes on the first resting drums row in row order.
 */
export function radioBreakdownRests(
  rows: readonly RadioIntensityRow[],
  depth: RadioBreakdownDepth,
  carryReady: boolean
): { depth: RadioBreakdownDepth; rest: string[]; carry: boolean; throwRowId: string | null } {
  const none = { depth: 'swell' as const, rest: [], carry: false, throwRowId: null }
  if (depth === 'swell') return none
  const carriers = rows.filter(radioBreakdownCarrier)
  let carry = false
  let d = depth
  if (carriers.length === 0) {
    if (carryReady) carry = true
    else if (d === 'full') d = 'thin'
  }
  const score = (r: RadioIntensityRow): number =>
    typeof r.score === 'number' && Number.isFinite(r.score) ? r.score : 0.5
  const sparsest = (rs: readonly RadioIntensityRow[]): RadioIntensityRow | null =>
    rs.reduce<RadioIntensityRow | null>(
      (best, r) =>
        best === null ||
        score(r) < score(best) ||
        (score(r) === score(best) && r.staleness > best.staleness)
          ? r
          : best,
      null
    )
  const candidates = rows.filter((r) => r.sounding && r.restable && isLow(r.kinds))
  let rest: RadioIntensityRow[]
  if (d === 'full') rest = candidates
  else {
    const drums = rows.filter((r) => r.sounding && r.kinds.includes('drums'))
    const stays = drums.find((r) => !r.restable) ?? sparsest(drums)
    rest = candidates.filter((r) => r !== stays)
  }
  // never silence: something keeps sounding
  const stillSounding = rows.some((r) => r.sounding && !rest.includes(r))
  if (!stillSounding && !carry && rest.length > 0) {
    const keep = sparsest(rest)
    rest = rest.filter((r) => r !== keep)
  }
  if (rest.length === 0) return { ...none, carry: false }
  const thrown = rest.find((r) => r.kinds.includes('drums'))
  return { depth: d, rest: rest.map((r) => r.id), carry, throwRowId: thrown?.id ?? null }
}

// ---- the step (sections 3.1-3.4, 4.3-4.4) ----

export interface RadioIntensityStepInput {
  energy: number
  drama: number
  loopBars: number
  /** The turnaroundLap starting at this wrap. */
  lap: number
  /** The turnaround phrase in laps (turnaroundPhraseLaps). */
  phraseLaps: number
  held: boolean
  /** Rows on the bed (the arc's count), before anything landing at this wrap. */
  count: number
  /** The arc's fewest and most rows (DENSITY_MIN, DENSITY_MAX; the web's densityArc). */
  min: number
  max: number
  /** In row order. */
  rows: readonly RadioIntensityRow[]
  /** The arc can add a row (nextArcKind has a kind, a place is free, no add on its way). */
  canAdd: boolean
  /** The arc can strip one back (pickArcRemoval has a row). */
  canStrip: boolean
  /** The carry row prepared for this breakdown is warm and has a place. */
  carryReady: boolean
  /** A returning drums or bass row's fresh pick is warm. */
  renewReady: (rowId: string) => boolean
  random: () => number
}

export interface RadioIntensityStepResult {
  state: RadioIntensityArc
  /** The event that landed at THIS wrap (decided at the last), now applied to the state. */
  applied: RadioIntensityDecided | null
  /** Decided now, landing at the next wrap: binding. */
  decided: RadioIntensityDecided | null
  /** Warm what the coming phase change needs: a carry row for the breakdown, fresh picks for
   * the returning drums and bass rows at the drop (leaned to the top target at full weight). */
  prepare: { carry: boolean; renew: string[] } | null
  /** A breakdown ran past its time and is ended now (logged `[radio-intensity] breakdown
   * overran`). */
  overran: boolean
}

/** A machine waiting for its first phrase start. */
export function newRadioIntensityArc(): RadioIntensityArc {
  return { ...NO_RADIO_INTENSITY_ARC, rests: [] }
}

/** A cycle's build, worked out: the bigger-peak countdown (drawn when due), the peak, the length
 * (drawn, raised to fit its adds: one per phrase start after the first). `count`: the rows it
 * starts from. */
function nextBuild(
  arc: RadioIntensityArc,
  input: Pick<RadioIntensityStepInput, 'energy' | 'min' | 'max' | 'random'>,
  count: number,
  first: boolean
): Required<RadioIntensityNext> {
  let untilBig = arc.untilBig
  let big = false
  if (first || untilBig === null) untilBig = drawUntilBig(input.random)
  else {
    untilBig -= 1
    if (untilBig <= 0) {
      big = true
      untilBig = drawUntilBig(input.random)
    }
  }
  const lo = Math.max(1, input.min)
  const peak = big ? input.max : clamp01(input.energy / 100) < 0.5 ? 4 : 5
  const peakRows = Math.min(input.max, Math.max(lo, peak))
  const adds = Math.max(0, peakRows - count)
  const drawn = drawLength(INTENSITY_PHRASES.build[energyBand(input.energy)], input.random)
  return { phrases: Math.max(drawn + (big ? 1 : 0), adds + 1), big, untilBig, peakRows }
}

function applyBuild(
  arc: RadioIntensityArc,
  next: Required<RadioIntensityNext>,
  first: boolean
): RadioIntensityArc {
  return {
    ...arc,
    begun: true,
    phase: 'build',
    phrases: next.phrases,
    done: 0,
    big: next.big,
    untilBig: next.untilBig,
    peakRows: next.peakRows,
    first,
    depth: null,
    rests: [],
    prepared: false
  }
}

/** A breakdown's or a ride's length, drawn. */
function nextLength(
  phase: 'breakdown' | 'drop',
  arc: RadioIntensityArc,
  input: Pick<RadioIntensityStepInput, 'energy' | 'random'>
): RadioIntensityNext {
  const drawn = drawLength(INTENSITY_PHRASES[phase][energyBand(input.energy)], input.random)
  return { phrases: drawn + (phase === 'drop' && arc.big ? 1 : 0) }
}

/** Radio started (or density turned to `intensity` at a phrase start): the first build begins
 * now, from the rows as they are. Its draws (section 3.5's first) come from `random`. */
export function radioIntensityStarted(
  input: Pick<RadioIntensityStepInput, 'energy' | 'min' | 'max' | 'random' | 'count'>
): RadioIntensityArc {
  const arc = newRadioIntensityArc()
  return applyBuild(arc, nextBuild(arc, input, input.count, true), true)
}

/** Applies a landed event: phases change here (a button's event draws its length here). */
function land(
  arc: RadioIntensityArc,
  d: RadioIntensityDecided,
  input: RadioIntensityStepInput
): RadioIntensityArc {
  const base = { ...arc, decided: null }
  switch (d.event) {
    case 'cycle': {
      const next = d.next ?? nextBuild(base, input, input.count - (d.strip ? 1 : 0), false)
      return applyBuild(base, next as Required<RadioIntensityNext>, false)
    }
    case 'add':
      return base
    case 'breakdown':
      return {
        ...base,
        phase: 'breakdown',
        phrases: (d.next ?? nextLength('breakdown', base, input)).phrases,
        done: 0,
        depth: d.depth,
        rests: [...d.rest],
        prepared: false
      }
    case 'drop':
      return {
        ...base,
        phase: 'drop',
        phrases: (d.next ?? nextLength('drop', base, input)).phrases,
        done: 0,
        depth: null,
        rests: [],
        prepared: false
      }
  }
}

/** What the phase change at the coming phrase start (or a pending press) is, decided now. */
function decide(
  arc: RadioIntensityArc,
  input: RadioIntensityStepInput,
  forcedNow: RadioIntensityAction | null
): RadioIntensityDecided | null {
  if (forcedNow !== null) return forcedEvent(arc, forcedNow)
  const ending = arc.done + 1 >= arc.phrases
  switch (arc.phase) {
    case 'build': {
      if (ending) return breakdownEvent(arc, input)
      if (input.canAdd && input.count < arc.peakRows) return { event: 'add' }
      return null
    }
    case 'breakdown':
      return ending ? dropEvent(arc, input) : null
    case 'drop':
      if (!ending) return null
      return {
        event: 'cycle',
        strip: input.canStrip,
        next: nextBuild(arc, input, input.count - (input.canStrip ? 1 : 0), false)
      }
  }
}

function breakdownEvent(
  arc: RadioIntensityArc,
  input: RadioIntensityStepInput
): RadioIntensityDecided {
  const r = radioBreakdownRests(
    input.rows,
    radioBreakdownDepth(input.drama, arc.big),
    input.carryReady
  )
  const shape: RadioHookThrow | null =
    r.throwRowId === null
      ? null
      : { beats: drawThrowBeats(input.random), ...drawThrowEcho(input.random) }
  return {
    event: 'breakdown',
    depth: r.depth,
    rest: r.rest,
    throwRowId: r.throwRowId,
    throw: shape,
    carry: r.carry,
    next: nextLength('breakdown', arc, input)
  }
}

/** The rows a drop renews from (section 4.4): the rested drums and bass rows, or -- at swell
 * depth, nothing rested -- the sounding ones. */
function renewalRows(arc: RadioIntensityArc, rows: readonly RadioIntensityRow[]): string[] {
  if (arc.rests.length > 0) {
    return rows.filter((r) => arc.rests.includes(r.id) && isLow(r.kinds)).map((r) => r.id)
  }
  return rows.filter((r) => r.sounding && isLow(r.kinds)).map((r) => r.id)
}

function dropEvent(arc: RadioIntensityArc, input: RadioIntensityStepInput): RadioIntensityDecided {
  const chance = INTENSITY_RENEW_BASE + INTENSITY_RENEW_SPAN * clamp01(input.drama / 100)
  const renew: string[] = []
  for (const id of renewalRows(arc, input.rows)) {
    if (!input.renewReady(id)) continue
    if (input.random() < chance) renew.push(id)
  }
  return { event: 'drop', returning: [...arc.rests], renew, next: nextLength('drop', arc, input) }
}

/** A button's event (section 6), landing at the next top. */
function forcedEvent(
  arc: RadioIntensityArc,
  action: RadioIntensityAction
): RadioIntensityDecided | null {
  if (action === 'drop') {
    if (arc.phase === 'breakdown') {
      return { event: 'drop', returning: [...arc.rests], renew: [], forced: true }
    }
    return { event: 'drop', returning: [], renew: [], quick: true, forced: true }
  }
  // build
  if (arc.phase === 'drop') return { event: 'cycle', strip: true, forced: true }
  if (arc.phase === 'build') return { event: 'add', forced: true }
  return null // in a breakdown, `build` only shortens it (pressRadioIntensity)
}

/**
 * One loop top. In order:
 *   1. the event decided at the last wrap lands (a phase change draws its length);
 *   2. unless held: at a phrase start the phase counts it (or the machine begins, at its first);
 *      a breakdown past its time is ended (overran);
 *   3. unless held: at the decide wrap, the coming phrase start's event -- or a button's press
 *      waiting for a free top -- is decided, binding;
 *   4. unless held: prepares, a phrase ahead of a breakdown (a carry row when nothing would
 *      carry it) and of a drop (fresh picks for the returning drums and bass).
 */
export function stepRadioIntensityArc(
  arc: RadioIntensityArc,
  input: RadioIntensityStepInput
): RadioIntensityStepResult {
  const P = Math.max(1, Math.floor(input.phraseLaps))
  const lap = ((Math.floor(input.lap) % P) + P) % P
  let state = arc
  let applied: RadioIntensityDecided | null = null
  // 1. land
  if (state.decided !== null) {
    applied = state.decided
    state = land(state, applied, input)
  }
  const out = (
    decided: RadioIntensityDecided | null,
    prepare: RadioIntensityStepResult['prepare'],
    overran = false
  ): RadioIntensityStepResult => ({ state, applied, decided, prepare, overran })
  if (input.held || !(input.loopBars > 0)) return out(null, null)
  // 2. count
  const phraseStart = lap === 0
  let overran = false
  if (!state.begun) {
    if (!phraseStart) return out(null, null)
    state = applyBuild(state, nextBuild(state, input, input.count, true), true)
  } else if (phraseStart && applied === null) {
    state = { ...state, done: state.done + 1 }
  } else if (phraseStart && applied !== null && applied.event === 'add') {
    state = { ...state, done: state.done + 1 }
  }
  if (
    state.phase === 'breakdown' &&
    state.done >= state.phrases + INTENSITY_BREAKDOWN_OVERRUN &&
    state.decided === null
  ) {
    overran = true
    const d = dropEvent(state, input)
    state = { ...state, decided: d }
    return out(d, null, overran)
  }
  // 3. decide
  let decided: RadioIntensityDecided | null = null
  const decideWrap = lap === P - 1
  const pending = state.forced
  if (pending !== null && state.decided === null) {
    decided = forcedEvent(state, pending)
    state = { ...state, forced: null, decided }
  } else if (decideWrap && state.decided === null) {
    decided = decide(state, input, null)
    if (decided !== null) state = { ...state, decided }
  }
  // 4. prepare: a phrase ahead (two wraps with a one-lap phrase), once per phase change
  let prepare: RadioIntensityStepResult['prepare'] = null
  const ending = (): RadioIntensityPhase | null => {
    if (P >= 2) return phraseStart && state.done + 1 >= state.phrases ? state.phase : null
    // one-lap phrase: the change two wraps on -- the phase decided to begin at the next wrap,
    // when it lasts one phrase, else this phase when it ends then
    const d = state.decided
    if (d !== null && d.event !== 'add') {
      const begins: RadioIntensityPhase =
        d.event === 'cycle' ? 'build' : d.event === 'breakdown' ? 'breakdown' : 'drop'
      return d.next !== undefined && d.next.phrases <= 1 ? begins : null
    }
    return state.done + 2 >= state.phrases ? state.phase : null
  }
  const endingPhase = state.prepared ? null : ending()
  if (endingPhase === 'build') {
    const depth = radioBreakdownDepth(input.drama, state.big)
    const carriers = input.rows.filter(radioBreakdownCarrier)
    prepare = { carry: depth !== 'swell' && carriers.length === 0, renew: [] }
  } else if (endingPhase === 'breakdown') {
    const d = state.decided
    const rests = d?.event === 'breakdown' ? d.rest : state.rests
    prepare = { carry: false, renew: renewalRows({ ...state, rests }, input.rows) }
  }
  if (prepare !== null) state = { ...state, prepared: true }
  return out(decided, prepare, overran)
}

/**
 * A button (section 6), pressed mid-lap: it lands at the next loop top, or -- `late` (pressed in
 * the lap's last stretch, too late to arm) or with an event already decided for that top -- the
 * top after. Returns the new state; the press is null when it does nothing here:
 *   - build in the ride: the next cycle's build (its strip-back) at the top;
 *   - build in the build: the next add at the top, and the remaining phrases halve (at least 1);
 *   - build in the breakdown: the drop at the next phrase start whose decide wrap has not passed
 *     (the breakdown shortened; nothing lands at the top);
 *   - drop in the breakdown: the rested rows back at the top;
 *   - drop in the build or the ride: a quick drop at the top.
 */
export function pressRadioIntensity(
  arc: RadioIntensityArc,
  action: RadioIntensityAction,
  where: { lap: number; phraseLaps: number; late: boolean }
): RadioIntensityArc | null {
  if (!arc.begun) return null
  const P = Math.max(1, Math.floor(where.phraseLaps))
  if (action === 'build' && arc.phase === 'breakdown') {
    // the decide wrap of the next phrase start begins the last lap: passed once we are in it
    const passed = where.lap >= P - 1
    const phrases = arc.done + (passed ? 2 : 1)
    return phrases < arc.phrases ? { ...arc, phrases } : arc
  }
  const halved =
    action === 'build' && arc.phase === 'build'
      ? arc.done + Math.max(1, Math.floor((arc.phrases - arc.done) / 2))
      : arc.phrases
  if (where.late || arc.decided !== null) return { ...arc, phrases: halved, forced: action }
  const decided = forcedEvent(arc, action)
  if (decided === null) return null
  return { ...arc, phrases: halved, decided }
}

/** A rested row is no longer the arc's (spec 4.2): unmuted or soloed by hand (it plays at once),
 * removed, locked or changed by hand. It leaves the rests, and a decided breakdown's or drop's
 * lists; the drop still lands for the others. */
export function releaseRadioIntensityRest(
  arc: RadioIntensityArc,
  rowId: string
): RadioIntensityArc {
  const d = arc.decided
  const decided: RadioIntensityDecided | null =
    d?.event === 'breakdown'
      ? {
          ...d,
          rest: d.rest.filter((id) => id !== rowId),
          throwRowId: d.throwRowId === rowId ? null : d.throwRowId,
          throw: d.throwRowId === rowId ? null : d.throw
        }
      : d?.event === 'drop'
        ? {
            ...d,
            returning: d.returning.filter((id) => id !== rowId),
            renew: d.renew.filter((id) => id !== rowId)
          }
        : d
  if (!arc.rests.includes(rowId) && decided === d) return arc
  return { ...arc, rests: arc.rests.filter((id) => id !== rowId), decided }
}

/** Radio stopped, or density left `intensity`: the rows to put back with their own stems (rested,
 * or about to be), and a fresh machine. */
export function radioIntensityStopped(arc: RadioIntensityArc): {
  state: RadioIntensityArc
  unrest: string[]
} {
  const soon = arc.decided?.event === 'breakdown' ? arc.decided.rest : []
  return { state: newRadioIntensityArc(), unrest: [...new Set([...arc.rests, ...soon])] }
}

// ---- what the rest of radio reads (section 5) ----

/** The forecast's arcRole for the coming phrase end (radioBuildSize): its decided event's, or
 * `hold` -- every other phrase end in an intensity cycle (capped at medium, no promotion). */
export type RadioArcRole = 'build' | 'strip' | 'breakdown' | 'drop' | 'hold'

export function radioIntensityArcRole(arc: RadioIntensityArc): RadioArcRole {
  const d = arc.decided
  if (d === null) return 'hold'
  switch (d.event) {
    case 'cycle':
      return d.strip ? 'strip' : 'build'
    case 'add':
      return 'build'
    case 'breakdown':
      return 'breakdown'
    case 'drop':
      return 'drop'
  }
}

/** An add is coming at the next decide wrap (the build's next phrase start has room for one):
 * the desktop picks and warms the row a lap early (radioWrapBeforeLastLap), as its density arc
 * does, so the add is warm by the phrase end's roll. */
export function radioIntensityAddComing(arc: RadioIntensityArc, count: number): boolean {
  return (
    arc.begun &&
    arc.phase === 'build' &&
    arc.decided === null &&
    arc.forced === null &&
    arc.done + 1 < arc.phrases &&
    count < arc.peakRows
  )
}

/** The arc a phrase end's turnaround is drawn for (section 5.6): growing through the build and
 * into the drop, thinning into and through the breakdown, steady in the ride. */
export function radioIntensityTurnaroundArc(arc: RadioIntensityArc): TurnaroundArc {
  const d = arc.decided
  if (d?.event === 'drop') return 'growing'
  if (d?.event === 'breakdown' || arc.phase === 'breakdown') return 'thinning'
  if (d?.event === 'cycle' || arc.phase === 'build') return 'growing'
  return 'steady'
}

/** Hooks' inputs (section 5.2). */
export function radioIntensityHookInputs(arc: RadioIntensityArc): {
  dropAtNextWrap: boolean
  inBreakdown: boolean
} {
  const d = arc.decided?.event
  return {
    dropAtNextWrap: d === 'drop',
    inBreakdown: d !== 'drop' && (arc.phase === 'breakdown' || d === 'breakdown')
  }
}

/** The fold step's bend under intensity (section 5.3): clamp(bend + 25 d (2 tau - 1), 0, 100). */
export function radioIntensityBend(bend: number, drama: number, target: number): number {
  const b = Number.isFinite(bend) ? bend : 0
  const v = b + INTENSITY_BEND_SWING * clamp01(drama / 100) * (2 * clamp01(target) - 1)
  return Math.min(100, Math.max(0, v))
}

/** Bars from the playhead to the drop's planned top, in a breakdown; null otherwise. `pos` is the
 * bars into the lap playing, `lap` its turnaroundLap. */
export function radioIntensityDropInBars(
  arc: RadioIntensityArc,
  at: { lap: number; phraseLaps: number; loopBars: number; pos: number }
): number | null {
  if (!arc.begun || !(at.loopBars > 0)) return null
  if (arc.decided?.event === 'drop') return Math.max(0, at.loopBars - at.pos)
  if (arc.phase !== 'breakdown') return null
  const P = Math.max(1, Math.floor(at.phraseLaps))
  const lap = ((Math.floor(at.lap) % P) + P) % P
  const phrasesLeft = Math.max(1, arc.phrases - arc.done)
  const laps = (phrasesLeft - 1) * P + (P - lap)
  return Math.max(0, laps * at.loopBars - at.pos)
}

// ---- words (section 9) ----

export const RADIO_BUILD_WORD = 'build'
export const RADIO_BUILDING_WORD = 'building'
export const RADIO_DROP_WORD = 'drop'
export const RADIO_DROPPING_WORD = 'dropping'
export const RADIO_BREAKDOWN_WORD = 'breakdown'
/** A row the breakdown rests (19 characters), and the phone's short form. */
export const RADIO_ARC_REST_WORD = 'rests till the drop'
export const RADIO_ARC_REST_SHORT = 'rests'

/** A button's label: its word, or while its press waits for the top, its -ing word. */
export function radioIntensityButtonLabel(
  action: RadioIntensityAction,
  arc: RadioIntensityArc
): string {
  const d = arc.decided
  const pressed = d !== null && 'forced' in d && d.forced === true
  const waiting =
    arc.forced === action ||
    (pressed && (action === 'drop' ? d.event === 'drop' : d.event !== 'drop'))
  if (action === 'build') return waiting ? RADIO_BUILDING_WORD : RADIO_BUILD_WORD
  return waiting ? RADIO_DROPPING_WORD : RADIO_DROP_WORD
}
```

- [ ] **Step 3: Verify, commit.**
  - Run `npx vitest run src/shared/radioIntensityArc.test.ts`, `npm run typecheck`, and the
    web's `npm run typecheck`.
  - Message:
    `radio: the intensity arc's machine (spec 2026-10-05-radio-intensity-arc-design sections 3, 4, 6) -- build, breakdown, drop by turnaround phrases (decided a lap ahead at the phrase's last lap, binding; prepared a phrase ahead, two wraps with a one-lap phrase); targets by energy and drama; lengths drawn when decided (planning decision 2) from the energy menus, a build raised to adds + 1; the bigger peak every 3-4 cycles, never the first (DENSITY_MAX rows, +0.15, a deeper breakdown, +1 phrase); radioBreakdownRests (swell/thin/full, the kept drums the sparsest, a carry row with no carrier, never silence); the drop's renewals at 0.25 + 0.5 drama, only when warm; the buttons (build: a new cycle / an add and halved / the drop brought forward; drop: the rested rows back / a quick drop), late or spoken-for presses take the top after; held freezes the clock; the arcRole, the turnaround arc, the hooks' inputs, the bend, bars to the drop, releasing a rest, the words. Pure; nothing calls it yet`,
    then the trailer.

### Task 4: Builds, the drop roll, hooks, throws

**Depends on:** Task 3 (`RadioArcRole`). **Parallel with:** Task 5.

**Files:**
- Modify: `src/shared/radioBuildSize.ts`, `radioTurnaround.ts` (the drop only, not the labels),
  `radioHooks.ts`, `radioThrows.ts`, `discoverThrows.ts`
- Create: `src/shared/radioIntensityBuilds.test.ts`, `radioIntensityHooks.test.ts`,
  `radioIntensityThrows.test.ts`

- [ ] **Step 1: Write the failing tests.**
  - Create `src/shared/radioIntensityBuilds.test.ts`:

```ts
// The drop is the moment (spec 2026-10-05-radio-intensity-arc-design 4.4, 5.1): the forecast's
// arcRole in radioBuildSize.ts, and rollTurnaround's `drop` in radioTurnaround.ts.
import { describe, expect, it } from 'vitest'
import type { DiscoverSlotKind } from './discoverSlotKind'
import {
  NO_CHANGE_FORECAST,
  NO_RADIO_BUILDS,
  radioArcRoleTier,
  radioPayoffMet,
  radioPhraseEndBuild,
  type RadioChangeForecast
} from './radioBuildSize'
import {
  TURNAROUND_FAMILIES,
  TURNAROUND_GAP_CHANCE,
  rollTurnaround,
  turnaroundCapBeats,
  turnaroundDropGapChance,
  type TurnaroundInput,
  type TurnaroundRow
} from './radioTurnaround'
import { seededRandom } from './seededRandom'

const F = (o: Partial<RadioChangeForecast> = {}): RadioChangeForecast => ({
  ...NO_CHANGE_FORECAST,
  ...o
})
const FREE = { clock: NO_RADIO_BUILDS, aheadBars: 4, phraseBars: 16 }
/** A large build one bar ago: the budget would hold any other large back. */
const JUST = { clock: { sinceBuild: 0, sinceLarge: 0 }, aheadBars: 1, phraseBars: 16 }

describe('arcRole sizes a phrase end', () => {
  it('build, strip, breakdown and hold are medium at most; an arc add is no longer large', () => {
    for (const arcRole of ['build', 'strip', 'breakdown', 'hold'] as const) {
      expect(radioPhraseEndBuild(F({ arcRole, arcStep: 'add', rows: 1 }), 0, FREE).size).toBe(
        'medium'
      )
      expect(radioPhraseEndBuild(F({ arcRole, rows: 3 }), 3, FREE).size, arcRole).toBe('medium')
    }
    expect(radioPhraseEndBuild(F({ arcStep: 'add', rows: 1 }), 0, FREE).size).toBe('large')
  })

  it('the drop with the low end back is large, exempt from the budget', () => {
    const drop = F({ arcRole: 'drop', lowEndReturn: true, rows: 0 })
    expect(radioPhraseEndBuild(drop, 0, JUST)).toEqual({
      skip: false,
      size: 'large',
      payoff: 'large'
    })
    // without the role, the same forecast falls to the budget
    expect(radioPhraseEndBuild({ ...drop, arcRole: undefined }, 0, JUST).size).not.toBe('large')
  })

  it('a swell drop (nothing rested) is medium at most: no gap', () => {
    expect(radioPhraseEndBuild(F({ arcRole: 'drop', rows: 3 }), 0, FREE).size).toBe('medium')
    expect(radioArcRoleTier(F({ arcRole: 'drop' }), 'large')).toBe('medium')
    expect(radioArcRoleTier(F({ arcRole: 'drop' }), 'small')).toBe('small')
  })

  it('never promotes under an arc role', () => {
    const f = F({ rows: 2 })
    const old = { clock: { sinceBuild: 64, sinceLarge: 64 }, aheadBars: 4, phraseBars: 16 }
    expect(radioPhraseEndBuild(f, 1, old).size).toBe('large') // promoted today
    expect(radioPhraseEndBuild({ ...f, arcRole: 'hold' }, 1, old).size).toBe('medium')
  })

  it('the breakdown pays off a medium build with nothing landing', () => {
    expect(radioPayoffMet(F({ arcRole: 'breakdown' }), 'medium')).toBe(true)
    expect(radioPayoffMet(F({ arcRole: 'breakdown' }), 'large')).toBe(false)
    expect(radioPhraseEndBuild(F({ arcRole: 'breakdown' }), 0, FREE)).toMatchObject({
      skip: false,
      size: 'medium',
      payoff: 'medium'
    })
    expect(radioPhraseEndBuild(F({ arcRole: 'hold' }), 0, FREE).skip).toBe(true)
  })
})

function row(id: string, kinds: DiscoverSlotKind[], o: Partial<TurnaroundRow> = {}): TurnaroundRow {
  return { id, kinds, hooked: false, audible: true, inFilterIn: false, barLength: 4, ...o }
}
// the breakdown's last lap: drums and bass rest (not audible), two rows carry
const CARRIED: TurnaroundRow[] = [
  row('d', ['drums'], { audible: false }),
  row('b', ['bass'], { audible: false }),
  row('l', ['lead']),
  row('w', ['warm'])
]
function input(over: Partial<TurnaroundInput> = {}): TurnaroundInput {
  return {
    rate: 'often',
    random: seededRandom('drop-roll'),
    loopBars: 4,
    lastPhrase: null,
    rows: CARRIED,
    arc: 'growing',
    leavingRowId: null,
    combine: true,
    size: 'large',
    payoff: 'large',
    ...over
  }
}

describe('the drop roll', () => {
  it('leads with the riser at its longest, with no draw for move or length', () => {
    for (const loopBars of [2, 4, 8, 16]) {
      const r = seededRandom(`riser${loopBars}`)
      for (let i = 0; i < 200; i++) {
        const plan = rollTurnaround(input({ loopBars, random: r, drop: { gapChance: 1 } }))!
        expect(plan.move, `${loopBars}`).toBe('riser')
        expect(plan.parts![0].beats, `${loopBars}`).toBe(turnaroundCapBeats(loopBars))
      }
    }
  })

  it('draws the gap with its chance: every drop at drama 50 and up, one row enough', () => {
    expect(turnaroundDropGapChance(50)).toBe(1)
    expect(turnaroundDropGapChance(49)).toBe(TURNAROUND_GAP_CHANCE)
    const r = seededRandom('gaps')
    for (let i = 0; i < 500; i++) {
      const plan = rollTurnaround(input({ random: r, drop: { gapChance: 1 } }))!
      expect(plan.gapBeats).toBeGreaterThan(0)
    }
    const lone = [row('d', ['drums'], { audible: false }), row('l', ['lead'])]
    expect(rollTurnaround(input({ rows: lone, drop: { gapChance: 1 } }))!.gapBeats).toBeGreaterThan(
      0
    )
    expect(rollTurnaround(input({ rows: lone }))!.gapBeats ?? 0).toBe(0) // today: two rows to gap
    let gaps = 0
    for (let i = 0; i < 2000; i++) {
      const plan = rollTurnaround(input({ random: r, drop: { gapChance: TURNAROUND_GAP_CHANCE } }))!
      if ((plan.gapBeats ?? 0) > 0) gaps += 1
    }
    expect(gaps / 2000).toBeGreaterThan(0.6)
    expect(gaps / 2000).toBeLessThan(0.85)
  })

  it('with the riser family off, or at a loop too short for it, rolls as a large phrase end', () => {
    const noRiser = TURNAROUND_FAMILIES.filter((f) => f !== 'riser')
    for (let s = 0; s < 50; s++) {
      const a = rollTurnaround(
        input({ random: seededRandom(`f${s}`), moves: noRiser, drop: { gapChance: 1 } })
      )
      const b = rollTurnaround(input({ random: seededRandom(`f${s}`), moves: noRiser }))
      expect(a).toEqual(b)
      const short = { loopBars: 1, random: seededRandom(`s${s}`) }
      expect(rollTurnaround(input({ ...short, drop: { gapChance: 1 } }))?.move).not.toBe('riser')
    }
  })

  it('below large it is ignored, draw for draw', () => {
    for (let s = 0; s < 200; s++) {
      for (const size of ['medium', 'small', undefined] as const) {
        const a = rollTurnaround(
          input({ size, random: seededRandom(`m${s}`), drop: { gapChance: 0.75 } })
        )
        const b = rollTurnaround(input({ size, random: seededRandom(`m${s}`) }))
        expect(a).toEqual(b)
      }
    }
  })

  it("a turn keeps its own move and length, and takes the drop's gap chance", () => {
    const r = seededRandom('turn-drop')
    let gaps = 0
    for (let i = 0; i < 300; i++) {
      const plan = rollTurnaround(
        input({ random: r, force: { move: 'riser', maxBeats: 8 }, drop: { gapChance: 1 } })
      )!
      expect(plan.move).toBe('riser')
      if ((plan.gapBeats ?? 0) > 0) gaps += 1
    }
    expect(gaps).toBe(300)
  })
})
```

  - Create `src/shared/radioIntensityHooks.test.ts`. Record `HOOKS_BEFORE` against the
    unmodified `radioHooks.ts` first, as in Task 2. The planner's was `dd70db82`.

```ts
// Hooks prefer the drop (spec 2026-10-05-radio-intensity-arc-design 5.2): stepRadioHooks'
// dropAtNextWrap, inBreakdown and a row's arcResting.
import { describe, expect, it } from 'vitest'
import {
  NO_RADIO_HOOKS,
  stepRadioHooks,
  toggleRadioHookStem,
  type RadioHook,
  type RadioHookRowInput,
  type RadioHooksState,
  type RadioHooksStepInput
} from './radioHooks'
import { hashText, seededRandom } from './seededRandom'

const ROWS: RadioHookRowInput[] = [
  { id: 'd', stemId: 'd-1', kinds: ['drums'], eligible: true, lastLowHeard: true },
  { id: 'b', stemId: 'b-1', kinds: ['bass'], eligible: true, lastLowHeard: true },
  { id: 'l', stemId: 'l-1', kinds: ['lead'], eligible: true, lastLowHeard: false }
]

function withHook(o: Partial<RadioHook>, row = 'd'): RadioHooksState {
  const set = toggleRadioHookStem(NO_RADIO_HOOKS, {
    rowId: row,
    stemId: `${row}-1`,
    rowCount: 8,
    paceLevel: 50,
    random: () => 0.5
  }).state
  return { ...set, hooks: set.hooks.map((h) => ({ ...h, ...o })) }
}

function input(o: Partial<RadioHooksStepInput> = {}): RadioHooksStepInput {
  return {
    loopBars: 4,
    lap: 3, // the next wrap is a phrase start
    phraseLaps: 4,
    paceLevel: 50,
    held: false,
    rows: ROWS,
    ready: () => true,
    changeAtNextWrap: false,
    calmLandings: 0,
    arcThinning: false,
    canRest: false,
    random: () => 0.9,
    ...o
  }
}

describe('hooks and the intensity arc', () => {
  it('a return due within a phrase after the drop is decided for it, with no calm wait', () => {
    // 8 bars short of due at the line (8 + 4 counted + 4 to the line = 16 of 24): not today; for
    // the drop, yes (a 16-bar phrase early at most)
    const away = withHook({ state: 'away', bars: 8, targetBars: 24 })
    expect(stepRadioHooks(away, input()).decided).toEqual([])
    const r = stepRadioHooks(away, input({ dropAtNextWrap: true, random: () => 0 }))
    expect(r.decided).toHaveLength(1)
    expect(r.decided[0]).toMatchObject({ event: 'return', rowId: 'd', awayBars: 16 })
    // more than a phrase short: not even for the drop
    const far = withHook({ state: 'away', bars: 0, targetBars: 32 })
    expect(stepRadioHooks(far, input({ dropAtNextWrap: true })).decided).toEqual([])
  })

  it('a return due in a breakdown waits for the drop', () => {
    const due = withHook({ state: 'away', bars: 24, targetBars: 24 })
    expect(stepRadioHooks(due, input({ random: () => 0.9 })).decided).toHaveLength(1)
    expect(stepRadioHooks(due, input({ inBreakdown: true })).decided).toEqual([])
    expect(
      stepRadioHooks(due, input({ inBreakdown: true, dropAtNextWrap: true })).decided
    ).toHaveLength(1)
  })

  it('no exit into a breakdown, through one, or onto the drop', () => {
    const tired = withHook({ state: 'in', bars: 64, targetBars: 16 }, 'l')
    expect(stepRadioHooks(tired, input()).decided).toHaveLength(1)
    expect(stepRadioHooks(tired, input({ inBreakdown: true })).decided).toEqual([])
    expect(stepRadioHooks(tired, input({ dropAtNextWrap: true })).decided).toEqual([])
  })

  it("a hooked-in row the breakdown rests keeps its hook, its clock stopped, and doesn't exit", () => {
    const hook = withHook({ state: 'in', bars: 4, targetBars: 64 })
    const rows = ROWS.map((r) => (r.id === 'd' ? { ...r, arcResting: true } : r))
    const r = stepRadioHooks(hook, input({ lap: 0, rows }))
    expect(r.state.hooks[0]).toMatchObject({ state: 'in', bars: 4 })
    const tired = withHook({ state: 'in', bars: 64, targetBars: 16 })
    expect(stepRadioHooks(tired, input({ rows })).decided).toEqual([])
  })

  it('absent, every step is what it was (a fingerprint of 3000 seeded steps)', () => {
    const r = seededRandom('hooks-fp')
    const lines: string[] = []
    for (let i = 0; i < 3000; i++) {
      const state = withHook(
        {
          state: (['in', 'away', 'resting'] as const)[Math.floor(r() * 3)],
          bars: Math.floor(r() * 12) * 4,
          targetBars: 8 + Math.floor(r() * 8) * 4,
          waited: r() < 0.3,
          returns: Math.floor(r() * 4)
        },
        ROWS[Math.floor(r() * 3)].id
      )
      const step = stepRadioHooks(state, {
        ...input({
          lap: Math.floor(r() * 4),
          phraseLaps: 4,
          calmLandings: Math.floor(r() * 3),
          changeAtNextWrap: r() < 0.3,
          arcThinning: r() < 0.3,
          canRest: r() < 0.5,
          random: seededRandom(`h${i}`)
        })
      })
      lines.push(JSON.stringify([step.state, step.applied, step.prepare, step.decided]))
    }
    expect(hashText(lines.join('\n'))).toBe(HOOKS_BEFORE)
  })
})

/** Recorded from the unmodified radioHooks.ts (a9d68ef4) with this test's trace. */
const HOOKS_BEFORE = 'dd70db82'
```

  - Create `src/shared/radioIntensityThrows.test.ts`. Record `THROWS_BEFORE` first. The
    planner's was `9207add6`.

```ts
// Throws aimed into the drop (spec 2026-10-05-radio-intensity-arc-design 5.5): stepThrows'
// dropAt and stepDiscoverThrows' dropInBars.
import { describe, expect, it } from 'vitest'
import { initialThrowState, stepThrows, type ThrowState, type ThrowTick } from './radioThrows'
import { initialDiscoverThrowState, stepDiscoverThrows } from './discoverThrows'
import { hashText, seededRandom } from './seededRandom'

const BPM = 120
const BAR = 2 // seconds
const ROWS: ThrowTick['rows'] = [
  { slot: 'd', kinds: ['drums'], audible: false },
  { slot: 'l', kinds: ['lead'], audible: true },
  { slot: 'w', kinds: ['warm'], audible: true }
]
const tick = (now: number, o: Partial<ThrowTick> = {}): ThrowTick => ({
  now,
  bpm: BPM,
  nextBeat: Math.ceil((now + 0.25) / 0.5) * 0.5,
  held: false,
  leadingArmed: false,
  rows: ROWS,
  ...o
})

describe('throws and the drop', () => {
  it('a throw falling due in the breakdown waits for the drop and ends on its downbeat', () => {
    const due: ThrowState = { ...initialThrowState(), barsUntil: 0.5, lastNow: 0, barsSince: 30 }
    const dropAt = 12 * BAR
    let state = due
    let plan = null
    for (let now = 0; now < dropAt && plan === null; now += 0.25) {
      const r = stepThrows(state, tick(now, { dropAt }), seededRandom(`w${now}`))
      state = r.state
      plan = r.plan
    }
    expect(plan).not.toBeNull()
    expect(plan!.at + (plan!.beats * 60) / BPM).toBeCloseTo(dropAt, 9)
    expect(['l', 'w']).toContain(plan!.slot)
  })

  it("aims at the drop's gap when an armed turnaround's aim comes first", () => {
    const due: ThrowState = { ...initialThrowState(), barsUntil: 0, lastNow: 0, barsSince: 30 }
    const dropAt = 4 * BAR
    const gapAt = dropAt - 1
    const r = stepThrows(due, tick(dropAt - 1.75, { dropAt, changeAt: gapAt }), () => 0)
    expect(r.plan).not.toBeNull()
    expect(r.plan!.at + (r.plan!.beats * 60) / BPM).toBeCloseTo(gapAt, 9)
  })

  it('not due: nothing changes', () => {
    const early: ThrowState = { ...initialThrowState(), barsUntil: 20, lastNow: 0, barsSince: 2 }
    expect(stepThrows(early, tick(1, { dropAt: 4 * BAR }), () => 0).plan).toBeNull()
  })

  it('the desktop arms it on the loop, ending on the drop', () => {
    let s = {
      ...initialDiscoverThrowState(),
      throws: { ...initialThrowState(), barsUntil: 0, lastNow: 0, barsSince: 30 }
    }
    let armed = null
    for (let pos = 0; pos < 4 && armed === null; pos += 0.125) {
      const r = stepDiscoverThrows(
        s,
        {
          pos,
          loopBars: 4,
          bpm: BPM,
          playing: true,
          canArm: true,
          leadingArmed: false,
          dropInBars: 4 - pos,
          rows: ROWS,
          everyBars: [16, 32]
        },
        () => 0.3
      )
      s = r.state
      if (r.change === 'armed') armed = s.armed
    }
    expect(armed).not.toBeNull()
    expect(armed!.aimed).toBe(true)
    expect(armed!.atBar + armed!.beats / 4).toBeCloseTo(4, 9)
  })

  it('absent, every tick is what it was (a fingerprint of 20k seeded ticks)', () => {
    const r = seededRandom('throws-fp')
    let state = initialThrowState()
    const out: unknown[] = []
    let now = 0
    for (let i = 0; i < 20000; i++) {
      now += 0.1 + r() * 0.4
      const change = r() < 0.2 ? now + r() * 6 : null
      const step = stepThrows(
        state,
        tick(now, {
          held: r() < 0.05,
          leadingArmed: r() < 0.1,
          changeAt: change,
          silenced: r() < 0.2 ? ['l'] : []
        }),
        r
      )
      state = step.state
      out.push(step.plan)
    }
    expect(hashText(JSON.stringify([out, state]))).toBe(THROWS_BEFORE)
  })
})

/** Recorded from the unmodified radioThrows.ts (a9d68ef4) with this test's trace. */
const THROWS_BEFORE = '9207add6'
```

  - Run `npx vitest run src/shared/radioIntensityBuilds.test.ts src/shared/radioIntensityHooks.test.ts src/shared/radioIntensityThrows.test.ts`.
    **Expected:** FAIL (no `arcRole`, `drop`, `dropAtNextWrap` or `dropAt`). The fingerprints
    pass.

- [ ] **Step 2: arcRole.** `src/shared/radioBuildSize.ts`:

```diff
--- a/src/shared/radioBuildSize.ts
+++ b/src/shared/radioBuildSize.ts
@@ -15,6 +15,7 @@
 // from what is due (radio's armed pick, its companions, spare picks).
 
 import type { TurnaroundArc, TurnaroundPlan } from './radioTurnaround'
+import type { RadioArcRole } from './radioIntensityArc'
 
 /** How big a build a change earns. */
 export type RadioBuildSize = 'none' | 'small' | 'medium' | 'large'
@@ -41,6 +42,12 @@ export interface RadioChangeForecast {
   arcStep: 'add' | 'remove' | null
   /** A desktop course change at this top (every row at once). */
   course: boolean
+  /** The intensity arc's part in this top (radioIntensityArc's radioIntensityArcRole; spec
+   * 2026-10-05-radio-intensity-arc-design 5.1), set only while density is `intensity`: `build` (an
+   * add) and `strip` (the build's strip-back) and `breakdown` medium at most, `drop` large when
+   * the low end comes back (exempt from the budget), `hold` every other phrase end of a cycle
+   * (medium at most). Promotion is off under any role. Absent: today. */
+  arcRole?: RadioArcRole
 }
 
 export const NO_CHANGE_FORECAST: RadioChangeForecast = Object.freeze({
@@ -190,6 +197,8 @@ export function radioBuildArc(f: RadioChangeForecast, legArc: TurnaroundArc): Tu
 export function radioPayoffMet(f: RadioChangeForecast, need: RadioPayoff): boolean {
   if (need === 'none') return true
   if (f.lowEndReturn || f.course) return true
+  // the breakdown pays off a medium build (spec 5.1): the drums and bass going is the change
+  if (need === 'medium' && f.arcRole === 'breakdown') return true
   if (need === 'medium') return f.rows >= 2 || f.hookReturn !== null || f.arcStep !== null
   // an arc add is a large change (spec Decision 5: an arc step gets the riser and the gap)
   return f.rows >= 3 || (f.hookReturn !== null && f.rows >= 2) || f.arcStep === 'add'
@@ -242,14 +251,18 @@ export function radioPhraseEndBuild(
 ): { skip: boolean; size: RadioBuildSize; payoff: RadioPayoff } {
   const best = radioForecastWithRows(f, Math.max(0, Math.floor(spare)))
   const payoff = radioPayoffOf(best)
-  const raw = radioBuildTier(f, opts.hookScale)
+  const raw = radioArcRoleTier(f, radioBuildTier(f, opts.hookScale))
   const floored: RadioBuildSize = radioBuildSizeAtLeast(raw, 'medium') ? raw : 'medium'
   const budget = { ...opts, phraseEnd: true }
+  // the drop is the cycle's moment: exempt from the once-a-phrase rule and the spacing (spec 5.1)
+  if (f.arcRole === 'drop' && floored === 'large')
+    return { skip: payoff === 'none', size: 'large', payoff }
   let size = radioApplyBuildBudget(floored, budget)
   // the gap's return (spec 4.4): a medium phrase end the spares can pay off large is promoted to
   // large once the last large build is PROMOTE_PHRASES[arc] phrases back -- otherwise sized
-  // builds would leave almost no phrase end large enough for a gap. Pure: no draw.
-  if (size === 'medium' && payoff === 'large') {
+  // builds would leave almost no phrase end large enough for a gap. Pure: no draw. Never under the
+  // intensity arc: the gap belongs to its drop.
+  if (size === 'medium' && payoff === 'large' && f.arcRole === undefined) {
     const ahead = Number.isFinite(opts.aheadBars) && opts.aheadBars > 0 ? opts.aheadBars : 0
     const since =
       opts.clock.sinceLarge === null ? Number.POSITIVE_INFINITY : opts.clock.sinceLarge + ahead
@@ -261,6 +274,15 @@ export function radioPhraseEndBuild(
   return { skip: payoff === 'none', size, payoff }
 }
 
+/** A phrase end's tier under the intensity arc (spec 5.1): the drop is large when the low end
+ * comes back (at swell depth it is the renewals and the lean: medium at most); every other role
+ * is medium at most. No role: the tier as it is. */
+export function radioArcRoleTier(f: RadioChangeForecast, tier: RadioBuildSize): RadioBuildSize {
+  if (f.arcRole === undefined) return tier
+  if (f.arcRole === 'drop' && f.lowEndReturn) return 'large'
+  return radioBuildSizeAtLeast(tier, 'medium') ? 'medium' : tier
+}
+
 /** Phrases since the last large build before a medium phrase end whose spares can pay off a large
  * change is promoted to large (radioPhraseEndBuild), by the build's arc: a growing mix earns its
  * gap sooner, a steady one later, a thinning one never (a thinning mix softens; it does not drop). */
```

- [ ] **Step 3: The drop's roll.** `src/shared/radioTurnaround.ts`. These are the drop's hunks
  only; Task 5 renames the labels:

```diff
--- a/src/shared/radioTurnaround.ts
+++ b/src/shared/radioTurnaround.ts
@@ -599,12 +599,10 @@
   return left >= 1 ? left : null
 }
 
-/** Each move's chip, lowercase, at most two words. The drop-outs read as what they take OUT
- * (Elling, 2026-10-05): `drop` now means the intensity arc's drop, the low end coming BACK. The
- * move ids stay (`drum drop`, `low drop`): the phone's wire and every test name them. */
+/** Each move's chip, lowercase, at most two words. */
 export const TURNAROUND_MOVE_LABEL: Readonly<Record<TurnaroundMove, string>> = {
-  'drum drop': 'drums out',
-  'low drop': 'low out',
+  'drum drop': 'drop',
+  'low drop': 'low drop',
   stop: 'stop',
   wash: 'wash',
   lift: 'lift',
@@ -1275,9 +1273,8 @@
 /** The longest a turnaround's label may be before it is shortened to its lead and a count. */
 export const TURNAROUND_LABEL_MAX = 20
 
-/** A turnaround in words, the lead first: `riser + lift → gap`, `wash + dip`, `drums out`. Longer
- * than `max`: the lead and how many more, `riser +2 → gap`; still longer (a two-word lead, since
- * the drop-outs became `drums out` and `low out`): the lead and the gap, `drums out → gap`. */
+/** A turnaround in words, the lead first: `riser + lift → gap`, `wash + dip`, `drop`. Longer than
+ * `max`: the lead and how many more, `riser +2 → gap`. */
 export function turnaroundLabel(
   moves: readonly TurnaroundMove[],
   gap: boolean,
@@ -1287,8 +1284,7 @@
   const tail = gap ? ` → ${TURNAROUND_GAP_WORD}` : ''
   const full = moves.map((m) => TURNAROUND_MOVE_LABEL[m]).join(' + ') + tail
   if (full.length <= max || moves.length === 1) return full
-  const counted = `${TURNAROUND_MOVE_LABEL[moves[0]]} +${moves.length - 1}${tail}`
-  return counted.length <= max ? counted : `${TURNAROUND_MOVE_LABEL[moves[0]]}${tail}`
+  return `${TURNAROUND_MOVE_LABEL[moves[0]]} +${moves.length - 1}${tail}`
 }
 
 /** A plan's moves, the lead first (a single move's plan is just its move). */
```

- [ ] **Step 4: The hooks.** `src/shared/radioHooks.ts`:

```diff
--- a/src/shared/radioHooks.ts
+++ b/src/shared/radioHooks.ts
@@ -443,6 +443,10 @@ export interface RadioHookRowInput {
    * whose engine drops a removed row from the loop; the desktop's loop counts every resolved row,
    * heard or not.) */
   restShrinksLoop?: boolean
+  /** The intensity arc's breakdown rests this row (spec 2026-10-05-radio-intensity-arc-design
+   * 5.2): a hook in on it keeps its state with its clock stopped, and no exit is decided for it.
+   * Absent: false. */
+  arcResting?: boolean
 }
 
 export interface RadioHooksStepInput {
@@ -469,6 +473,13 @@ export interface RadioHooksStepInput {
    * rest draw is never made. */
   canRest: boolean
   random: () => number
+  /** The intensity arc (radioIntensityArc's radioIntensityHookInputs; spec 5.2). Absent: today.
+   *   - `dropAtNextWrap`: the drop lands on the next wrap -- a return due within a phrase after it
+   *     is decided for it now (up to a phrase early), with no calm wait; no exit;
+   *   - `inBreakdown`: the next wrap is in a breakdown or starts one -- returns wait for the drop
+   *     (a breakdown is at most two phrases, so the drop is never further), and no exit. */
+  dropAtNextWrap?: boolean
+  inBreakdown?: boolean
 }
 
 export interface RadioHooksStepResult {
@@ -539,7 +550,12 @@ export function stepRadioHooks(
         decided: null
       }
     }
-    return input.held || loopBars === 0 ? h : { ...h, bars: h.bars + loopBars }
+    if (input.held || loopBars === 0) return h
+    // a hook in on a row the arc's breakdown rests: its clock stops (it comes back at the drop)
+    if (h.state === 'in' && input.rows.some((r) => r.id === h.rowId && r.arcResting === true)) {
+      return h
+    }
+    return { ...h, bars: h.bars + loopBars }
   })
   if (input.held || loopBars === 0) {
     return applied.length === 0 ? none : { ...none, state: withHooks(state, hooks), applied }
@@ -557,16 +573,20 @@ export function stepRadioHooks(
     hooks = hooks.map((x) => (x === h ? next : x))
   }
   const byRow = [...hooks].sort((a, b) => order(a) - order(b))
-  // 3a. returns, on phrase starts only
-  if (line === 'phrase') {
+  const drop = input.dropAtNextWrap === true
+  const waitForDrop = input.inBreakdown === true && !drop
+  // 3a. returns, on phrase starts only -- pulled to the drop (a phrase early at most), and held
+  // through a breakdown until it
+  if (line === 'phrase' && !waitForDrop) {
     for (const h of byRow) {
       if (h.state === 'in' || h.decided !== null) continue
       const row = rowOf(h.rowId)
       if (row === undefined || !row.eligible) continue
-      if (h.bars + loopBars < h.targetBars - 1e-9) continue
+      const early = drop ? phraseBars : 0
+      if (h.bars + loopBars < h.targetBars - early - 1e-9) continue
       if (!input.ready(h.rowId, 'return')) continue
       const calm = input.calmLandings <= HOOK_CALM_LANDINGS
-      if (!input.changeAtNextWrap && calm && !h.waited && !h.broughtBack) {
+      if (!drop && !input.changeAtNextWrap && calm && !h.waited && !h.broughtBack) {
         if (input.random() < HOOK_CALM_WAIT_CHANCE) {
           set(h, { ...h, targetBars: h.targetBars + phraseBars, waited: true })
           continue
@@ -581,8 +601,9 @@ export function stepRadioHooks(
       decided.push({ rowId: h.rowId, stemId: h.stemId, ...d })
     }
   }
-  // 3b. at most one exit, on a line, none while another hook is out
-  if (line !== null) {
+  // 3b. at most one exit, on a line, none while another hook is out -- and none into a
+  // breakdown, through one, or onto the drop
+  if (line !== null && !drop && input.inBreakdown !== true) {
     const now = { hooks, seq: state.seq }
     const due = [...hooks]
       .filter((h) => {
@@ -591,6 +612,7 @@ export function stepRadioHooks(
         return (
           row !== undefined &&
           row.eligible &&
+          row.arcResting !== true &&
           row.stemId === h.stemId &&
           h.bars + loopBars >= h.targetBars - 1e-9 &&
           !anyOut(now, h.rowId)
```

- [ ] **Step 5: The throws.** `src/shared/radioThrows.ts`:

```diff
--- a/src/shared/radioThrows.ts
+++ b/src/shared/radioThrows.ts
@@ -67,6 +67,12 @@ export interface ThrowTick {
    * drops before the one): the send is post-fader, so a throw there would be heard as nothing. */
   silenced?: readonly string[]
   rows: readonly { slot: string; kinds: readonly DiscoverSlotKind[]; audible: boolean }[]
+  /** The intensity arc's drop, on the beat grid, passed only in the breakdown's last phrase (spec
+   * 2026-10-05-radio-intensity-arc-design 5.5): a throw falling due (within THROW_PREFER_SHARE of
+   * the shortest spacing) waits for it, however long, and ends on its downbeat -- or where the
+   * drop's gap starts, when `changeAt` (an armed turnaround's aim) comes first -- on a carrying
+   * row. Absent or null: today. */
+  dropAt?: number | null
 }
 
 export const initialThrowState = (): ThrowState => ({
@@ -166,6 +172,31 @@ export function stepThrows(
   const audible = tick.rows.filter(
     (r) => r.audible && !r.kinds.some((k) => NEVER.includes(k)) && !silenced.includes(r.slot)
   )
+  const dropAt =
+    tick.dropAt !== undefined &&
+    tick.dropAt !== null &&
+    Number.isFinite(tick.dropAt) &&
+    tick.dropAt > tick.nextBeat + EPS
+      ? tick.dropAt
+      : null
+  if (dropAt !== null && barsUntil <= prefer && (barsSince === null || barsSince >= prefer - EPS)) {
+    // aimed into the drop: wait for it (or its gap) to come within reach, then end on it
+    const aim = changeAt !== null && changeAt <= dropAt + EPS ? changeAt : dropAt
+    if (aim - tick.nextBeat > THROW_AIM_REACH_BEATS * beatSec + EPS)
+      return { state: next, plan: null }
+    redraw()
+    if (audible.length === 0) return { state: next, plan: null }
+    const slot = audible[Math.min(audible.length - 1, Math.floor(random() * audible.length))].slot
+    let beats = drawThrowBeats(random)
+    const { timing, feedback } = drawThrowEcho(random)
+    if (aim - beats * beatSec < tick.nextBeat - EPS) beats = THROW_BEATS[0]
+    if (aim - beats * beatSec < tick.nextBeat - EPS) return { state: next, plan: null }
+    return throwPlanned(
+      next,
+      { slot, at: aim - beats * beatSec, beats, timing, feedback },
+      tick.bpm
+    )
+  }
   if (
     changeAt !== null &&
     barsUntil <= prefer &&
```

  `src/shared/discoverThrows.ts` (the desktop's tick, in bars):

```diff
--- a/src/shared/discoverThrows.ts
+++ b/src/shared/discoverThrows.ts
@@ -155,6 +155,9 @@ export interface DiscoverThrowTick {
   changeInBars?: number | null
   /** Rows the build-up before it silences (stepThrows' silenced). */
   silenced?: readonly string[]
+  /** Bars from the playhead to the intensity arc's drop, in the breakdown's last phrase
+   * (stepThrows' dropAt). Absent or null: today. */
+  dropInBars?: number | null
   /** Every row in the panel: its slot, kinds, and whether it is heard. */
   rows: readonly { slot: string; kinds: readonly DiscoverSlotKind[]; audible: boolean }[]
   /** The spacing, from the sound settings' rate (radioSound.ts throwEveryBars). */
@@ -212,6 +215,10 @@ export function stepDiscoverThrows(
     tick.changeInBars !== undefined && tick.changeInBars !== null && tick.changeInBars > 0
       ? tick.changeInBars
       : null
+  const dropInBars =
+    tick.dropInBars !== undefined && tick.dropInBars !== null && tick.dropInBars > 0
+      ? tick.dropInBars
+      : null
   const r = stepThrows(
     next.throws,
     {
@@ -222,20 +229,23 @@ export function stepDiscoverThrows(
       leadingArmed: tick.leadingArmed,
       changeAt: changeInBars === null ? null : next.elapsedSec + changeInBars * secPerBar,
       silenced: tick.silenced,
-      rows: tick.rows
+      rows: tick.rows,
+      ...(dropInBars !== null && { dropAt: next.elapsedSec + dropInBars * secPerBar })
     },
     random,
     tick.everyBars
   )
   next.throws = r.state
   if (r.plan === null) return { state: next, change: null }
-  // where stepThrows put it: the start found above, or (aimed) its beats before the change
+  // where stepThrows put it: the start found above, or (aimed) its beats before the change or
+  // the drop
   const ends = (r.plan.at - next.elapsedSec) / secPerBar + r.plan.beats / 4
-  const aimed = changeInBars !== null && Math.abs(ends - changeInBars) < 1e-6
+  const aimAt = [changeInBars, dropInBars].find((t) => t !== null && Math.abs(ends - t) < 1e-6)
+  const aimed = aimAt !== undefined && aimAt !== null
   let ahead = start.ahead
   let atBar = start.atBar
   if (aimed) {
-    ahead = changeInBars - r.plan.beats / 4
+    ahead = aimAt - r.plan.beats / 4
     // on the loop's beat grid (the change is a loop top or a beat of the loop)
     atBar = Math.round(((tick.pos + ahead) % tick.loopBars) / BEAT_BARS) * BEAT_BARS
     // a start that does not fit the loop (a caller's change off the grid) is not armed
```

- [ ] **Step 6: Verify, commit.**
  - Run `npx vitest run src/shared`. **Expected:** green. `radioBuildSizeDraws.test.ts`'s
    `ROLLS_BEFORE` / `TURNS_BEFORE` and `radioFoldHurry.test.ts`'s `0540eeea` pass unchanged.
  - Run `npm run typecheck`, and the web's typecheck and tests.
  - Message:
    `radio: the drop is the moment (spec 2026-10-05-radio-intensity-arc-design 4.4, 5.1, 5.2, 5.5) -- RadioChangeForecast.arcRole (build/strip/breakdown/hold medium at most, no promotion under any role; the drop large with the low end back, exempt from the budget; a swell drop medium; the breakdown pays off medium); TurnaroundInput.drop (at large: the riser leads at the cap with no draw for move or length; the gap drawn at gapChance, 1 from drama 50, and needing one row; a turn keeps its move); hooks' dropAtNextWrap (a return within a phrase pulled to the drop, no calm wait) and inBreakdown (returns wait for it; no exits into, through or onto it), and a row's arcResting (its hook's clock stops); ThrowTick.dropAt / DiscoverThrowTick.dropInBars (a due throw waits for the drop, or its gap, and ends on it). Absent: today (hooks dd70db82, throws 9207add6, ROLLS_BEFORE, TURNS_BEFORE, fold 0540eeea)`,
    then the trailer.

### Task 5: The words: chips renamed, the readout, the phone's arc

**Depends on:** Task 3 (the word constants). **Parallel with:** Task 4.
**Crosses repos:** one line in ell.ing/radio.

**Files:**
- Modify: `src/shared/radioTurnaround.ts` (labels, `turnaroundLabel`),
  `radioTurnaroundTurn.test.ts`, `radioTurnaroundCombos.test.ts`, `radioReadout.ts`,
  `radioReadout.test.ts`, `radioReadoutTurnaround.test.ts`, `remoteState.ts`,
  `remoteState.test.ts`
- Create: `src/shared/radioReadoutIntensity.test.ts`, `src/shared/remoteStateArc.test.ts`
- ell.ing/radio: `src/ui/fullModel.test.ts` (line 340)

**Every place the words `drop` / `low drop` reach a screen** (the planner's grep of both repos;
all read `TURNAROUND_MOVE_LABEL`, so this task's one table change covers them):

| where | file:line (today) | reads |
|---|---|---|
| desktop turn chips (label, tooltip, aria) | `RadioStrip.tsx:462-466` | `TURNAROUND_MOVE_LABEL` |
| row flashes (both radios) | `radioTurnaround.ts:1305, :1311` (`turnaroundFlashes`) | the same |
| the ruler's turnaround label (both radios) | `radioTurnaround.ts:1257` via `radioReadout.ts:277` | the same |
| the phone's chips | `remotePage.ts:185` (`TURN_CHIPS`) | the same |
| web chips | `ui/full.ts:519`, `ui/fullModel.ts:121` | the same |

What does NOT change:
- `drops` (the family button, `TURNAROUND_FAMILIES`);
- `coachSections.ts`'s unrelated `drop` (the coach's section label);
- `remotePage.ts:1828`'s CSS class `drop` (the row's remove button);
- the step reducer's `cancel: 'drop'`;
- the ids `drum drop` and `low drop`.

- [ ] **Step 1: Write the failing tests.**
  - Create `src/shared/radioReadoutIntensity.test.ts`:

```ts
// The intensity arc's words (spec 2026-10-05-radio-intensity-arc-design section 9):
// radioReadout.ts, radioIntensityArc.ts's words, the renamed chips.
import { describe, expect, it } from 'vitest'
import {
  radioReadout,
  radioReadoutIntensityArc,
  type RadioReadoutInput,
  type RadioReadoutRowInput
} from './radioReadout'
import {
  RADIO_ARC_REST_SHORT,
  RADIO_ARC_REST_WORD,
  RADIO_BREAKDOWN_WORD,
  RADIO_BUILDING_WORD,
  RADIO_BUILD_WORD,
  RADIO_DROPPING_WORD,
  RADIO_DROP_WORD
} from './radioIntensityArc'
import { RADIO_ROLE_WORDS_MAX } from './radioHooks'
import { TURNAROUND_LABEL_MAX, TURNAROUND_MOVE_LABEL, turnaroundLabel } from './radioTurnaround'

const row = (rowId: string, o: Partial<RadioReadoutRowInput> = {}): RadioReadoutRowInput => ({
  rowId,
  kinds: ['drums'],
  laps: 3,
  ...o
})
const input = (over: Partial<RadioReadoutInput> = {}): RadioReadoutInput => ({
  bars: { intoPhrase: 5.5, phraseBars: 16, loopBars: 4 },
  nextChange: null,
  armedTurnaround: null,
  arc: { state: 'off', count: 3, target: 3 },
  rows: [row('a'), row('b', { kinds: ['bass'] }), row('c', { kinds: ['lead'] })],
  ...over
})
const line = (o: Partial<RadioReadoutInput>): string => radioReadout(input(o)).statusLine

describe('the status line under intensity', () => {
  it('says the phase: building, a bigger peak, the breakdown with its drop, the drop', () => {
    expect(line({ arc: { state: 'growing', count: 3, target: 5 } })).toBe('building ↑ 3 → 5')
    expect(line({ arc: { state: 'growing', count: 3, target: 5, big: true } })).toBe(
      'building ↑↑ 3 → 5'
    )
    expect(line({ arc: { state: 'breakdown', count: 4, target: 4, dropInBars: 11.5 } })).toBe(
      'breakdown · drop in 12 bars'
    )
    expect(line({ arc: { state: 'breakdown', count: 4, target: 4, dropInBars: 1 } })).toBe(
      'breakdown · drop in 1 bar'
    )
    expect(
      line({ arc: { state: 'breakdown', count: 4, target: 4, dropInBars: 12 }, narrow: true })
    ).toBe('breakdown · 12')
    expect(line({ arc: { state: 'breakdown', count: 4, target: 4, dropInBars: null } })).toBe(
      'breakdown'
    )
    expect(line({ arc: { state: 'drop', count: 5, target: 5 } })).toBe('drop · 5 rows')
    expect(line({ arc: { state: 'drop', count: 5, target: 5 }, held: true })).toBe('held · 5 rows')
  })

  it('reads the machine: growing to its peak, then steady; before it begins, steady', () => {
    const m = { begun: true, phase: 'build' as const, peakRows: 5, big: false }
    expect(radioReadoutIntensityArc(m, 3, null)).toEqual({ state: 'growing', count: 3, target: 5 })
    expect(radioReadoutIntensityArc({ ...m, big: true }, 3, null)).toMatchObject({ big: true })
    expect(radioReadoutIntensityArc(m, 5, null).state).toBe('steady')
    expect(radioReadoutIntensityArc({ ...m, phase: 'breakdown' }, 4, 8)).toEqual({
      state: 'breakdown',
      count: 4,
      target: 4,
      dropInBars: 8
    })
    expect(radioReadoutIntensityArc({ ...m, phase: 'drop' }, 4, null).state).toBe('drop')
    expect(radioReadoutIntensityArc({ ...m, begun: false }, 2, null).state).toBe('steady')
  })

  it('next: the drop, and the rows the breakdown rests', () => {
    expect(
      line({
        arc: { state: 'breakdown', count: 3, target: 3, dropInBars: 4 },
        nextChange: { rowId: 'a', kind: null, barsAway: 4, drop: true }
      })
    ).toBe('breakdown · drop in 4 bars · next: drop · 4 bars')
    const r = radioReadout(
      input({
        arc: { state: 'growing', count: 3, target: 3 },
        nextChange: { rowId: 'b', kind: null, barsAway: 2, rests: true }
      })
    )
    expect(r.statusLine).toBe('building ↑ 3 → 3 · next: row 2 rests · 2 bars')
    expect(r.rows[1].nextLabel).toBe('next · rests')
  })
})

describe('words', () => {
  it('are lowercase, and the row words fit the row', () => {
    for (const w of [
      RADIO_BUILD_WORD,
      RADIO_BUILDING_WORD,
      RADIO_DROP_WORD,
      RADIO_DROPPING_WORD,
      RADIO_BREAKDOWN_WORD,
      RADIO_ARC_REST_WORD,
      RADIO_ARC_REST_SHORT
    ]) {
      expect(w).toBe(w.toLowerCase())
      expect(w.length).toBeLessThanOrEqual(RADIO_ROLE_WORDS_MAX)
    }
    expect(RADIO_ARC_REST_WORD).toBe('rests till the drop')
  })

  it('the drop-out chips no longer say drop; a turn with a long lead keeps its gap', () => {
    expect(TURNAROUND_MOVE_LABEL['drum drop']).toBe('drums out')
    expect(TURNAROUND_MOVE_LABEL['low drop']).toBe('low out')
    expect(turnaroundLabel(['drum drop', 'lift', 'riser'], true)).toBe('drums out +2 → gap')
    expect(turnaroundLabel(['drum drop', 'lift', 'riser'], true, TURNAROUND_LABEL_MAX - 6)).toBe(
      'drums out → gap'
    )
    expect(
      radioReadout(
        input({
          armedTurnaround: {
            move: 'drum drop',
            isTurn: true,
            parts: ['drum drop', 'lift', 'riser'],
            gap: true
          }
        })
      ).ruler.end
    ).toBe('turn: drums out → gap')
  })
})
```

  - Create `src/shared/remoteStateArc.test.ts`:

```ts
// The phone's build and drop (spec 2026-10-05-radio-intensity-arc-design 6): remoteState.ts.
import { describe, expect, it } from 'vitest'
import {
  parseRemoteArcAction,
  remoteArcAnswer,
  remoteStateFromSlots,
  type RemoteArcView,
  type RemoteStateMeta
} from './remoteState'

const META: RemoteStateMeta = {
  discoverOpen: true,
  playing: true,
  kept: 0,
  rolled: 0,
  lastKeptName: null,
  loopBars: 4
}
const ARC: RemoteArcView = { phase: 'breakdown', waiting: null, canBuild: true, canDrop: true }

describe('the arc on the phone', () => {
  it('leaves only a real phase, and nothing without one', () => {
    expect(remoteStateFromSlots([], { ...META, arc: ARC }).arc).toEqual(ARC)
    expect(remoteStateFromSlots([], META).arc).toBeNull()
    const odd = { ...ARC, phase: 'peak', waiting: 'soon', canBuild: 1 } as unknown as RemoteArcView
    expect(remoteStateFromSlots([], { ...META, arc: odd }).arc).toBeNull()
    const loose = { ...ARC, waiting: 'soon', canBuild: 1 } as unknown as RemoteArcView
    expect(remoteStateFromSlots([], { ...META, arc: loose }).arc).toEqual({
      ...ARC,
      waiting: null,
      canBuild: false
    })
  })

  it('parses the action and answers it', () => {
    expect(parseRemoteArcAction('build')).toBe('build')
    expect(parseRemoteArcAction('drop')).toBe('drop')
    expect(parseRemoteArcAction('turn')).toBeNull()
    expect(parseRemoteArcAction(undefined)).toBeNull()
    expect(remoteArcAnswer(null, 'drop')).toBe('radio off')
    expect(remoteArcAnswer(ARC, 'build')).toBe('building')
    expect(remoteArcAnswer(ARC, 'drop')).toBe('dropping')
    expect(remoteArcAnswer({ ...ARC, canDrop: false }, 'drop')).toBe('not now')
  })
})
```

  - Update the tests that pin the old words, by intent:

```diff
--- a/src/shared/radioTurnaroundTurn.test.ts
+++ b/src/shared/radioTurnaroundTurn.test.ts
@@ -214,12 +214,15 @@ describe('turnaroundMoveCanSound', () => {
 })
 
 describe('TURNAROUND_MOVE_LABEL', () => {
-  it('names every move in lowercase, at most two words; the drum drop is `drop`', () => {
+  it('names every move in lowercase, at most two words; the drop-outs say what goes out', () => {
     for (const move of TURNAROUND_MOVES) {
       const label = TURNAROUND_MOVE_LABEL[move]
       expect(label).toBe(label.toLowerCase())
       expect(label.split(' ').length).toBeLessThanOrEqual(2)
     }
-    expect(TURNAROUND_MOVE_LABEL['drum drop']).toBe('drop')
+    // Elling, 2026-10-05: `drop` is the intensity arc's drop (the low end back), never a chip
+    expect(TURNAROUND_MOVE_LABEL['drum drop']).toBe('drums out')
+    expect(TURNAROUND_MOVE_LABEL['low drop']).toBe('low out')
+    expect(Object.values(TURNAROUND_MOVE_LABEL)).not.toContain('drop')
   })
 })
```

```diff
--- a/src/shared/radioTurnaroundCombos.test.ts
+++ b/src/shared/radioTurnaroundCombos.test.ts
@@ -508,7 +508,8 @@ describe('saying it', () => {
   it('names the moves, the lead first, and the gap', () => {
     expect(turnaroundLabel(['riser', 'lift'], true)).toBe('riser + lift → gap')
     expect(turnaroundLabel(['wash', 'dip'], false)).toBe('wash + dip')
-    expect(turnaroundLabel(['drum drop'], false)).toBe('drop')
+    expect(turnaroundLabel(['drum drop'], false)).toBe('drums out')
+    expect(turnaroundLabel(['drum drop', 'lift'], true)).toBe('drums out +1 → gap')
     expect(turnaroundLabel(['riser'], true)).toBe('riser → gap')
     expect(turnaroundLabel(['riser', 'low drop', 'lift'], true)).toBe('riser +2 → gap')
   })
@@ -550,8 +551,8 @@ describe('saying it', () => {
         rows: [{ rowId: 'd' }, { rowId: 'b' }]
       })
     ).toEqual([
-      { rowId: 'd', word: 'low drop', beats: 4 },
-      { rowId: 'b', word: 'low drop', beats: 4 }
+      { rowId: 'd', word: 'low out', beats: 4 },
+      { rowId: 'b', word: 'low out', beats: 4 }
     ])
   })
 })
```

```diff
--- a/src/shared/radioReadout.test.ts
+++ b/src/shared/radioReadout.test.ts
@@ -129,7 +129,7 @@ describe('radioReadout: the phrase ruler', () => {
   it("a phrase end's turnaround is its move's label; a turn is turn: <move>", () => {
     expect(
       radioReadout(input({ armedTurnaround: { move: 'drum drop', isTurn: false } })).ruler.end
-    ).toBe('drop')
+    ).toBe('drums out')
     expect(radioReadout(input({ armedTurnaround: { move: 'wash', isTurn: true } })).ruler.end).toBe(
       'turn: wash'
     )
```

```diff
--- a/src/shared/radioReadoutTurnaround.test.ts
+++ b/src/shared/radioReadoutTurnaround.test.ts
@@ -41,7 +41,7 @@ function combinations(): TurnaroundMove[][] {
 
 describe('the ruler names a combined turnaround (combos spec section 6)', () => {
   it('reads a single move exactly as before', () => {
-    expect(end({ move: 'drum drop', isTurn: false })).toBe('drop')
+    expect(end({ move: 'drum drop', isTurn: false })).toBe('drums out')
     expect(end({ move: 'wash', isTurn: true })).toBe('turn: wash')
     expect(end({ move: null, isTurn: true })).toBe('turn')
     expect(end({ move: null, isTurn: false })).toBeNull()
```

```diff
--- a/src/shared/remoteState.test.ts
+++ b/src/shared/remoteState.test.ts
@@ -201,6 +201,7 @@ describe('remoteStateFromSlots', () => {
       radio: null,
       fold: null,
       turn: null,
+      arc: null,
       slots: []
     })
   })
```

  - Run `npx vitest run src/shared/radioReadout*.test.ts src/shared/radioTurnaround*.test.ts src/shared/remoteState*.test.ts`.
    **Expected:** FAIL.

- [ ] **Step 2: The labels.** `src/shared/radioTurnaround.ts` (Task 4's file to the final one):

```diff
--- a/src/shared/radioTurnaround.ts
+++ b/src/shared/radioTurnaround.ts
@@ -599,10 +599,12 @@
   return left >= 1 ? left : null
 }
 
-/** Each move's chip, lowercase, at most two words. */
+/** Each move's chip, lowercase, at most two words. The drop-outs read as what they take OUT
+ * (Elling, 2026-10-05): `drop` now means the intensity arc's drop, the low end coming BACK. The
+ * move ids stay (`drum drop`, `low drop`): the phone's wire and every test name them. */
 export const TURNAROUND_MOVE_LABEL: Readonly<Record<TurnaroundMove, string>> = {
-  'drum drop': 'drop',
-  'low drop': 'low drop',
+  'drum drop': 'drums out',
+  'low drop': 'low out',
   stop: 'stop',
   wash: 'wash',
   lift: 'lift',
@@ -1273,8 +1275,9 @@
 /** The longest a turnaround's label may be before it is shortened to its lead and a count. */
 export const TURNAROUND_LABEL_MAX = 20
 
-/** A turnaround in words, the lead first: `riser + lift → gap`, `wash + dip`, `drop`. Longer than
- * `max`: the lead and how many more, `riser +2 → gap`. */
+/** A turnaround in words, the lead first: `riser + lift → gap`, `wash + dip`, `drums out`. Longer
+ * than `max`: the lead and how many more, `riser +2 → gap`; still longer (a two-word lead, since
+ * the drop-outs became `drums out` and `low out`): the lead and the gap, `drums out → gap`. */
 export function turnaroundLabel(
   moves: readonly TurnaroundMove[],
   gap: boolean,
@@ -1284,7 +1287,8 @@
   const tail = gap ? ` → ${TURNAROUND_GAP_WORD}` : ''
   const full = moves.map((m) => TURNAROUND_MOVE_LABEL[m]).join(' + ') + tail
   if (full.length <= max || moves.length === 1) return full
-  return `${TURNAROUND_MOVE_LABEL[moves[0]]} +${moves.length - 1}${tail}`
+  const counted = `${TURNAROUND_MOVE_LABEL[moves[0]]} +${moves.length - 1}${tail}`
+  return counted.length <= max ? counted : `${TURNAROUND_MOVE_LABEL[moves[0]]}${tail}`
 }
 
 /** A plan's moves, the lead first (a single move's plan is just its move). */
```

- [ ] **Step 3: The readout.** `src/shared/radioReadout.ts`:

```diff
--- a/src/shared/radioReadout.ts
+++ b/src/shared/radioReadout.ts
@@ -42,7 +42,8 @@ export interface RadioFlashShown {
   t: number
 }
 
-export type RadioReadoutArcState = 'growing' | 'thinning' | 'steady' | 'off'
+/** `breakdown` and `drop`: the intensity arc's (radioReadoutIntensityArc). */
+export type RadioReadoutArcState = 'growing' | 'thinning' | 'steady' | 'off' | 'breakdown' | 'drop'
 
 export interface RadioReadoutRowInput {
   rowId: string
@@ -80,6 +81,11 @@ export interface RadioReadoutInput {
     /** A hook leaving (`out`) or coming back (`back`) on that row (radioHooks.ts):
      * `next: row 2 → hook back · 4 bars`. */
     hook?: 'out' | 'back'
+    /** The intensity arc's drop is decided for that top: `next: drop · 4 bars` (`rowId` one of
+     * the rows coming back). */
+    drop?: boolean
+    /** The breakdown rests that row there: `next: row 2 rests · 4 bars`. */
+    rests?: boolean
     /* Which rows ride (held, locked or muted ones excluded) is the caller's call at decision
      * time; the readout only shows the ones that are rows and not the led row, once each. */
   } | null
@@ -92,7 +98,17 @@ export interface RadioReadoutInput {
     parts?: readonly TurnaroundMove[]
     gap?: boolean
   } | null
-  arc: { state: RadioReadoutArcState; count: number; target: number }
+  arc: {
+    state: RadioReadoutArcState
+    count: number
+    target: number
+    /** A breakdown: bars to the drop's planned top (null: not known). */
+    dropInBars?: number | null
+    /** A bigger peak's build: `building ↑↑`. */
+    big?: boolean
+  }
+  /** Under 360 px: the short forms (`breakdown · 12`). */
+  narrow?: boolean
   /** Radio is held: the arc part reads `held` (it goes nowhere while held). The runtime passes as
    * `nextChange` only what still lands while held (an arc step already on the timeline), or null. */
   held?: boolean
@@ -227,11 +243,45 @@ export function radioAgeLabel(laps: number): string {
   return plural(Number.isFinite(laps) ? Math.max(0, Math.floor(laps)) : 0, 'lap')
 }
 
-function arcPart(arc: RadioReadoutInput['arc'], held: boolean): string | null {
+/** The intensity arc as the readout reads it (spec 2026-10-05-radio-intensity-arc-design 9): the
+ * build as `growing` toward its peak (`big` on a bigger peak), the breakdown with the bars to its
+ * drop, the ride as `drop`. Before the machine has begun: steady. */
+export function radioReadoutIntensityArc(
+  arc: {
+    begun: boolean
+    phase: 'build' | 'breakdown' | 'drop'
+    peakRows: number
+    big: boolean
+  },
+  count: number,
+  dropInBars: number | null
+): RadioReadoutInput['arc'] {
+  if (!arc.begun) return { state: 'steady', count, target: count }
+  switch (arc.phase) {
+    case 'build':
+      return count < arc.peakRows
+        ? { state: 'growing', count, target: arc.peakRows, ...(arc.big && { big: true }) }
+        : { state: 'steady', count, target: count }
+    case 'breakdown':
+      return { state: 'breakdown', count, target: count, dropInBars }
+    case 'drop':
+      return { state: 'drop', count, target: count }
+  }
+}
+
+function arcPart(arc: RadioReadoutInput['arc'], held: boolean, narrow: boolean): string | null {
   if (held) return arc.state === 'off' ? 'held' : `held · ${plural(arc.count, 'row')}`
   switch (arc.state) {
     case 'growing':
-      return `building ↑ ${arc.count} → ${arc.target}`
+      return `building ${arc.big === true ? '↑↑' : '↑'} ${arc.count} → ${arc.target}`
+    case 'breakdown': {
+      const bars = arc.dropInBars
+      if (bars === null || bars === undefined || !Number.isFinite(bars)) return 'breakdown'
+      const n = Math.max(1, Math.ceil(bars - 1e-6))
+      return narrow ? `breakdown · ${n}` : `breakdown · drop in ${plural(n, 'bar')}`
+    }
+    case 'drop':
+      return `drop · ${plural(arc.count, 'row')}`
     case 'thinning':
       return `thinning ↓ ${arc.count} → ${arc.target}`
     case 'steady':
@@ -251,17 +301,21 @@ function nextPart(input: RadioReadoutInput): string | null {
     ? []
     : [...new Set(n.with ?? [])].filter((id) => id !== n.rowId && present.has(id))
   const extra = companions.length > 0 ? ` +${companions.length}` : ''
+  const bars0 = Math.max(1, Math.ceil(n.barsAway - 1e-6))
+  if (n.drop === true) return `next: drop · ${plural(bars0, 'bar')}`
   const who =
     (n.course ? 'course change' : i >= 0 && !n.adding ? `row ${i + 1}` : 'a new row') + extra
   const how = n.course
     ? ''
-    : n.hook !== undefined
-      ? ` → hook ${n.hook}`
-      : n.leaving
-        ? ' leaves'
-        : n.kind !== null
-          ? ` → ${n.kind}`
-          : ''
+    : n.rests === true
+      ? ' rests'
+      : n.hook !== undefined
+        ? ` → hook ${n.hook}`
+        : n.leaving
+          ? ' leaves'
+          : n.kind !== null
+            ? ` → ${n.kind}`
+            : ''
   const bars = Math.max(1, Math.ceil(n.barsAway - 1e-6))
   return `next: ${who}${how} · ${plural(bars, 'bar')}`
 }
@@ -279,7 +333,7 @@ function rulerEnd(t: RadioReadoutInput['armedTurnaround']): string | null {
 }
 
 export function radioReadout(input: RadioReadoutInput): RadioReadout {
-  const statusLine = [arcPart(input.arc, !!input.held), nextPart(input)]
+  const statusLine = [arcPart(input.arc, !!input.held, input.narrow === true), nextPart(input)]
     .filter((p): p is string => p !== null)
     .join(' · ')
   const ticks = Math.max(0, Math.round(input.bars.phraseBars))
@@ -307,13 +361,15 @@ export function radioReadout(input: RadioReadoutInput): RadioReadout {
         nextKind,
         nextLabel: !isNext
           ? null
-          : !companion && next.hook !== undefined
-            ? `next · hook ${next.hook}`
-            : leaving
-              ? 'next · leaves'
-              : nextKind !== null
-                ? `next · ${nextKind}`
-                : 'next',
+          : !companion && next.rests === true
+            ? 'next · rests'
+            : !companion && next.hook !== undefined
+              ? `next · hook ${next.hook}`
+              : leaving
+                ? 'next · leaves'
+                : nextKind !== null
+                  ? `next · ${nextKind}`
+                  : 'next',
         flash: r.flash ?? null
       }
     })
```

- [ ] **Step 4: The phone's arc.** `src/shared/remoteState.ts`:

```diff
--- a/src/shared/remoteState.ts
+++ b/src/shared/remoteState.ts
@@ -108,6 +108,18 @@ export interface RemoteTurnView {
   moves: TurnaroundMove[]
 }
 
+/** The intensity arc, as the phone needs it (spec 2026-10-05-radio-intensity-arc-design 6): its
+ * phase and the `build` and `drop` buttons. Sent only while radio runs with density `intensity`;
+ * null or absent otherwise, and the phone shows no buttons. Phase words and booleans name nothing,
+ * so the boundary is unchanged. */
+export interface RemoteArcView {
+  phase: 'build' | 'breakdown' | 'drop'
+  /** A press waiting for its top: the button reads `building` or `dropping`. */
+  waiting: 'build' | 'drop' | null
+  canBuild: boolean
+  canDrop: boolean
+}
+
 export interface RemoteState {
   /** False when Discover is not open on the Mac -- the page then says
    * "open discover on the mac" and offers nothing else. It does not
@@ -147,6 +159,9 @@ export interface RemoteState {
   /** Radio's turn; null or absent while radio is off (an older Mac never sends it). It is what
    * POST /api/turn answers from (remoteTurnAnswer). */
   turn?: RemoteTurnView | null
+  /** The intensity arc; null or absent unless radio runs with density `intensity` (an older Mac
+   * never sends it). POST /api/arc answers from it (remoteArcAnswer). */
+  arc?: RemoteArcView | null
   slots: RemoteSlotView[]
 }
 
@@ -220,6 +235,8 @@ export interface RemoteStateMeta {
   fold?: boolean | null
   /** Radio's turn while radio runs; absent or null while it is off. */
   turn?: RemoteTurnView | null
+  /** The intensity arc while it runs; absent or null otherwise. */
+  arc?: RemoteArcView | null
   /** Radio's roles by slot id while radio runs (hooks, dig); absent while it is off. */
   roles?: ReadonlyMap<string, RemoteSlotRole>
 }
@@ -260,6 +277,7 @@ export function remoteStateFromSlots(
     radio: normalizeRemoteRadio(meta.radio ?? null, slots),
     fold: typeof meta.fold === 'boolean' ? meta.fold : null,
     turn: normalizeRemoteTurn(meta.turn ?? null),
+    arc: normalizeRemoteArc(meta.arc ?? null),
     slots: slots.map((slot) => ({
       id: slot.id,
       kindLabel: slotKindsLabel(slot.kinds),
@@ -305,6 +323,18 @@ function normalizeRemoteTurn(turn: RemoteTurnView | null): RemoteTurnView | null
   }
 }
 
+/** Only a real phase leaves; anything else is no arc at all. */
+function normalizeRemoteArc(arc: RemoteArcView | null): RemoteArcView | null {
+  if (arc === null) return null
+  if (arc.phase !== 'build' && arc.phase !== 'breakdown' && arc.phase !== 'drop') return null
+  return {
+    phase: arc.phase,
+    waiting: arc.waiting === 'build' || arc.waiting === 'drop' ? arc.waiting : null,
+    canBuild: arc.canBuild === true,
+    canDrop: arc.canDrop === true
+  }
+}
+
 function normalizeRemoteRadio(
   radio: RemoteRadioView | null,
   slots: readonly CoachSlotSnapshot[]
@@ -360,6 +390,9 @@ export type RemoteCommand =
   /** Radio's turn at the next loop top: a chip's `move`, absent for the planner's choice
    * (2026-10-02). Forwarded only when remoteTurnAnswer says `turning`. */
   | { kind: 'turn'; move?: TurnaroundMove }
+  /** The intensity arc's `build` or `drop` at the next loop top (2026-10-05). Forwarded only when
+   * remoteArcAnswer says `building` or `dropping`. */
+  | { kind: 'arc'; action: 'build' | 'drop' }
 
 /** The fold switch's body (`{ on }`): only a boolean is an answer; anything else is null, and the
  * route refuses the request (the same rule as parseRemoteSlotKinds). */
@@ -428,6 +461,26 @@ export function remoteTurnAnswer(
   return can ? 'turning' : 'nothing to turn'
 }
 
+/** POST /api/arc's `action`: exactly `build` or `drop`; anything else is null and the route
+ * refuses the request. */
+export function parseRemoteArcAction(value: unknown): 'build' | 'drop' | null {
+  return value === 'build' || value === 'drop' ? value : null
+}
+
+/** The phone's flash for a build or drop press, and the route's answer: `radio off` with no arc in
+ * the state (radio off, or density not intensity), `not now` when the Mac says that button cannot
+ * act now, else `building` or `dropping`. */
+export type RemoteArcAnswer = 'building' | 'dropping' | 'not now' | 'radio off'
+
+export function remoteArcAnswer(
+  arc: RemoteArcView | null | undefined,
+  action: 'build' | 'drop'
+): RemoteArcAnswer {
+  if (arc === null || arc === undefined) return 'radio off'
+  if (action === 'build') return arc.canBuild ? 'building' : 'not now'
+  return arc.canDrop ? 'dropping' : 'not now'
+}
+
 /** The whole trust boundary for the action sheet, in one pure function --
  * same shape and the same rule as parseRemoteSlotKinds below: an unknown
  * value is not coerced, dropped or best-guessed, it fails the whole
```

- [ ] **Step 5: The web's one line.** In ell.ing/radio `src/ui/fullModel.test.ts:340`:

```diff
--- a/src/ui/fullModel.test.ts
+++ b/src/ui/fullModel.test.ts
@@ -337,7 +337,7 @@ describe('the strip: turn', () => {
 
   it("holds the waiting move's chip; a chip that cannot sound now is not now", () => {
     const chips = fullModel(view({ turn: turn({ waiting: true, move: 'wash', canSound: ['wash', 'riser'] }) })).strip.turn.chips
-    expect(chips.map((c) => c.label)).toEqual(['drop', 'low drop', 'stop', 'wash', 'lift', 'dip', 'riser'])
+    expect(chips.map((c) => c.label)).toEqual(['drums out', 'low out', 'stop', 'wash', 'lift', 'dip', 'riser'])
     expect(chips.filter((c) => c.held).map((c) => c.move)).toEqual(['wash'])
     expect(chips.filter((c) => !c.notNow).map((c) => c.move)).toEqual(['wash', 'riser'])
   })
```

- [ ] **Step 6: Verify, commit (both repos, back to back).**
  - sssketch: `npx vitest run src/shared src/main/remotePage.test.ts src/main/remoteServer.test.ts`
    and `npm run typecheck`.
  - ell.ing/radio: `npm run typecheck` and `npx vitest run src`. **Expected:** green.
  - sssketch message:
    `radio: the intensity arc's words (spec 2026-10-05-radio-intensity-arc-design section 9; Elling's open question 1) -- the drop-out chips read "drums out" and "low out" (TURNAROUND_MOVE_LABEL: chips, flashes, the ruler, the phone; the move ids stay, they are the phone's wire), a turn's ruler with a two-word lead keeps its gap ("turn: drums out → gap", within the phone's 23); the readout's breakdown ("breakdown · drop in 12 bars", narrow "breakdown · 12") and drop ("drop · 5 rows") states, a bigger peak's "building ↑↑", "next: drop · 4 bars" and "next: row 2 rests · 2 bars"; the phone's RemoteArcView (phase, waiting, canBuild, canDrop), POST /api/arc's action and answers. Inert: nothing sends them yet`,
    then the trailer.
  - ell.ing/radio message:
    `full mode: the drop-out chips are "drums out" and "low out" (sssketch's TURNAROUND_MOVE_LABEL, Elling 2026-10-05) -- the chip test follows`,
    then the trailer.

### Task 6: Web index: the score as `x`

**Repo:** ell.ing/radio. **Depends on:** Task 2. **Parallel with:** Tasks 3-5.

**Files:**
- Create: `src/index/intensityScores.ts`
- Modify: `src/index/traitPercentiles.ts`, `shapeRecord.ts` (+ test), `buildIndex.ts` (+ test),
  `scripts/export-index.mjs` (the header comment)

**Style:** this repo has no prettier config and its files are not prettier-formatted. Do not run
prettier on them; match the file's own style (single quotes, no semicolons, long lines).

- [ ] **Step 1: The failing tests.**
  - `src/index/buildIndex.test.ts`:

```diff
--- a/src/index/buildIndex.test.ts
+++ b/src/index/buildIndex.test.ts
@@ -25,7 +25,7 @@ describe('buildIndex', () => {
     expect(built.index.header).toEqual({
       generated: '2026-09-30T00:00:00.000Z',
       count: 2,
-      coverage: { role: 2, roleConfirmed: 1, traits: 2 },
+      coverage: { role: 2, roleConfirmed: 1, traits: 2, intensity: 2, loudness: 0 },
       dropped: { noLength: 1, noAudio: 0 }
     })
     const [a, b] = built.index.records
@@ -34,6 +34,9 @@ describe('buildIndex', () => {
     // placed within the exported, playable stems only -- neither dropped 'c'
     // nor 'elsewhere' is in the pool, so 'b' tops it
     expect(b.traits).toEqual({ bassHeavy: 1, rhythmic: 1, bright: 1, warm: 0 })
+    // the intensity score, over the same pool: b is busier and heavier than a
+    expect(b.x).toBe(1)
+    expect(a.x).toBe(0)
     const url = (id: string) => `https://ndls-att0.fra1.digitaloceanspaces.com/k/${id}`
     expect(built.manifest).toEqual([
       { key: 'k/a', bytes: 100, mime: 'audio/ogg', jam: 'jam1', url: url('a') },
@@ -78,3 +81,24 @@ describe('buildIndex', () => {
     expect(built.index.records[1].traits?.bassHeavy).toBe(1)
   })
 })
+
+describe('the intensity score in the index (spec 2026-10-05 2.2)', () => {
+  it('scores every exported stem with busy or low, and counts the level coverage', () => {
+    const lv = (v: number, loud: number | null) =>
+      ({ bassEnergyRatio: v, transientDensity: v, spectralCentroidHz: v, loudnessLufs: loud }) as unknown as StemFeatures
+    const built = buildIndex(
+      [row('a'), row('b'), row('c'), row('d')],
+      {
+        confirmedRoles: new Map(),
+        autoRoles: new Map(),
+        features: new Map([['a', lv(0, -20)], ['b', lv(1, -10)], ['c', { spectralCentroidHz: 3 } as unknown as StemFeatures]])
+      },
+      new Date(0)
+    )
+    const [a, b, c, d] = built.index.records
+    expect(b.x).toBeGreaterThan(a.x!)
+    expect(c.x).toBeUndefined() // neither busy nor low: unscored
+    expect(d.x).toBeUndefined() // no features
+    expect(built.index.header.coverage).toMatchObject({ intensity: 2, loudness: 2 })
+  })
+})
```

  - `src/index/shapeRecord.test.ts`:

```diff
--- a/src/index/shapeRecord.test.ts
+++ b/src/index/shapeRecord.test.ts
@@ -36,3 +36,11 @@ describe('shapeRecord', () => {
     expect(shapeRecord({ ...stemRow, Length16s: 0 }, {})).toBeNull()
   })
 })
+
+describe('x', () => {
+  it('carries the intensity score rounded to 3 places, and nothing for none', () => {
+    expect(shapeRecord(stemRow, { intensity: 0.123456 })?.x).toBe(0.123)
+    expect(shapeRecord(stemRow, { intensity: null })).not.toHaveProperty('x')
+    expect(shapeRecord(stemRow, {})).not.toHaveProperty('x')
+  })
+})
```

  - Run `npx vitest run src/index`. **Expected:** FAIL.

- [ ] **Step 2: The code.**
  - Create `src/index/intensityScores.ts`:

```ts
// src/index/intensityScores.ts
//
// The radio's per-stem intensity score (sssketch @shared/radioIntensity, spec
// 2026-10-05-radio-intensity-arc-design 2.2), computed once at export time over the exported
// stems -- the page's whole pool, as the trait percentiles are -- and carried as the record's `x`.
// Every rule is the shared one; only the gather is here.
import {
  INTENSITY_INPUT_FIELDS,
  roundIntensity,
  stemIntensityScore,
  type IntensityValues
} from '@shared/radioIntensity'
import type { StemFeatures } from '@shared/stemFeatures'
import { QUANTILE_FIELDS } from '@shared/traitQuantiles'
import { buildTraitTables } from './traitPercentiles'

function valuesOf(features: StemFeatures): IntensityValues {
  const out: IntensityValues = {}
  const f = features as unknown as Record<string, unknown>
  for (const field of INTENSITY_INPUT_FIELDS) {
    const v = f[field]
    if (typeof v === 'number' && Number.isFinite(v)) out[field] = v
  }
  return out
}

/** Each stem's score, rounded to 3 places; an unscored stem (neither busy nor low) is left out.
 * Tables are built over `featuresByStem` itself, every quantile field (the level pass's included
 * once enough stems carry it: tableForField's rule). */
export function intensityByStem(featuresByStem: ReadonlyMap<string, StemFeatures>): Map<string, number> {
  const tables = buildTraitTables([...featuresByStem.values()], QUANTILE_FIELDS)
  const out = new Map<string, number>()
  for (const [stemCID, features] of featuresByStem) {
    const x = roundIntensity(stemIntensityScore(valuesOf(features), tables))
    if (x !== null) out.set(stemCID, x)
  }
  return out
}

/** The stem carries the level pass (its loudness was measured). */
export function hasLoudness(features: StemFeatures | undefined): boolean {
  return typeof features?.loudnessLufs === 'number' && Number.isFinite(features.loudnessLufs)
}
```

  - `src/index/traitPercentiles.ts` (the table builder takes its fields):

```diff
--- a/src/index/traitPercentiles.ts
+++ b/src/index/traitPercentiles.ts
@@ -13,6 +13,7 @@ import type { StemFeatures } from '@shared/stemFeatures'
 import {
   TRAIT_FIELDS,
   tableForField,
+  type QuantileField,
   traitPercentilesFromValues,
   type TraitPercentiles,
   type TraitQuantileTables
@@ -30,11 +31,14 @@ export const INDEX_TRAIT_KINDS: readonly DiscoverTraitKind[] = [
   'warm'
 ]
 
-/** Quantile tables over `features` (one per trait field), by the same
+/** Quantile tables over `features` (one per field: the trait fields unless told), by the same
  * rule traitQuantileCache.ts applies. */
-export function buildTraitTables(features: readonly StemFeatures[]): TraitQuantileTables {
+export function buildTraitTables(
+  features: readonly StemFeatures[],
+  fields: readonly QuantileField[] = TRAIT_FIELDS
+): TraitQuantileTables {
   const tables: TraitQuantileTables = {}
-  for (const field of TRAIT_FIELDS) {
+  for (const field of fields) {
     const values: number[] = []
     for (const f of features) {
       const v = (f as unknown as Record<string, unknown>)[field]
```

  - `src/index/shapeRecord.ts`:

```diff
--- a/src/index/shapeRecord.ts
+++ b/src/index/shapeRecord.ts
@@ -34,6 +34,8 @@ export interface RecordExtras {
   /** Library percentile per trait kind (src/index/traitPercentiles.ts);
    * null/absent kinds are left out of the record. */
   traits?: TraitPercentiles
+  /** The radio's intensity score (src/index/intensityScores.ts), [0, 1]; null/absent: unscored. */
+  intensity?: number | null
 }
 
 export interface IndexRecord {
@@ -55,6 +57,9 @@ export interface IndexRecord {
   role?: ArrangeRole
   roleSource?: 'confirmed' | 'auto'
   traits?: IndexTraits
+  /** The intensity score, 3 places (spec 2026-10-05-radio-intensity-arc-design 2.2). Its own key,
+   * not in `traits`: traits pass straight through as traitPercentiles. Absent: unscored. */
+  x?: number
 }
 
 const round3 = (v: number): number => Math.round(v * 1000) / 1000
@@ -97,5 +102,9 @@ export function shapeRecord(row: StemRow, extras: RecordExtras): IndexRecord | n
     if (Object.keys(traits).length > 0) record.traits = traits
   }
 
+  if (typeof extras.intensity === 'number' && Number.isFinite(extras.intensity)) {
+    record.x = round3(extras.intensity)
+  }
+
   return record
 }
```

  - `src/index/buildIndex.ts`:

```diff
--- a/src/index/buildIndex.ts
+++ b/src/index/buildIndex.ts
@@ -7,6 +7,7 @@ import type { ArrangeRole } from '@shared/stemRole'
 import type { StemFeatures } from '@shared/stemFeatures'
 import { isPlayable, shapeRecord, type IndexRecord, type StemRow } from './shapeRecord'
 import { traitPercentilesByStem } from './traitPercentiles'
+import { hasLoudness, intensityByStem } from './intensityScores'
 
 export interface ExportStemRow extends StemRow {
   FileMIME: string | null
@@ -19,7 +20,16 @@ export interface ExportStemRow extends StemRow {
 export interface IndexHeader {
   generated: string
   count: number
-  coverage: { role: number; roleConfirmed: number; traits: number }
+  coverage: {
+    role: number
+    roleConfirmed: number
+    traits: number
+    /** Records with an intensity score (`x`). */
+    intensity: number
+    /** Records whose stem carries the level pass (its loudness): how far the desktop's backfill
+     * had got when this was exported. */
+    loudness: number
+  }
   dropped: Dropped
 }
 
@@ -86,13 +96,15 @@ export function buildIndex(
     if (features && isPlayable(row)) pool.set(row.StemCID, features)
   }
   const percentiles = traitPercentilesByStem(pool)
+  const intensity = intensityByStem(pool)
   const records: IndexRecord[] = []
   const manifest: ManifestEntry[] = []
   for (const { row, entry } of kept) {
     const record = shapeRecord(row, {
       confirmedRole: own.confirmedRoles.get(row.StemCID),
       autoRole: own.autoRoles.get(row.StemCID),
-      traits: percentiles.get(row.StemCID)
+      traits: percentiles.get(row.StemCID),
+      intensity: intensity.get(row.StemCID) ?? null
     })
     if (!record) {
       dropped.noLength += 1
@@ -107,7 +119,9 @@ export function buildIndex(
     coverage: {
       role: records.filter((r) => r.role).length,
       roleConfirmed: records.filter((r) => r.roleSource === 'confirmed').length,
-      traits: records.filter((r) => r.traits).length
+      traits: records.filter((r) => r.traits).length,
+      intensity: records.filter((r) => r.x !== undefined).length,
+      loudness: records.filter((r) => hasLoudness(pool.get(r.id))).length
     },
     dropped
   }
```

  - `scripts/export-index.mjs`: in the header comment's `TRAIT KEYS` block (:12-32), add one
    paragraph:
    - `x`: the radio's intensity score (sssketch `radioIntensity.ts`), 3 places, placed over the
      exported stems. Absent for an unscored stem.
    - `header.coverage.intensity` counts the records that carry it.
    - `header.coverage.loudness` counts the stems the desktop's level backfill has reached; until
      it covers the archive, scores renormalise without the level parts.

    Print the two new coverage counts beside the existing ones (:160-165).

- [ ] **Step 3: Export locally, measure, commit.**
  - Run `npx vitest run src/index` and `npm run typecheck`.
  - Run `npm run export-index` to the local `out/` only. This reads the USB archive (it may be
    unplugged; say so and stop if it is). **Never upload.**
  - Record in the commit message:
    - the gzipped index size before and after (spec estimate +150-200 KB on 2.2 MB);
    - `coverage.intensity` (expected near `traits`' 65,285);
    - `coverage.loudness` (0 until Task 13's backfill).
  - Message:
    `index: the radio's intensity score as x (sssketch spec 2026-10-05-radio-intensity-arc-design 2.2) -- @shared stemIntensityScore over the exported stems' own quantile tables (every QUANTILE_FIELD; the level pass's once 200 stems carry it), rounded to 3 places, its own key (traits pass straight through); header.coverage gains intensity and loudness. Exported locally: <sizes>, intensity <n>, loudness <n>. Not uploaded`,
    then the trailer.

### Task 7: Web radio: the arc in the reducer

**Repo:** ell.ing/radio. **Depends on:** Tasks 1-6. **Files:**
- `src/radio/pick.ts`, `src/radio/pickIntensity.test.ts` (new), `src/radio/settings.ts`
  (+ test), `src/ui/densityPrefs.ts` (+ test, new);
- `src/radio/step.ts`, `step.test.ts`, `density.test.ts`, `controller.ts`
  (+ `controller.test.ts`), `src/radio/throwAim.ts`.

**What changes, in the tick's order** (`tickBody`'s wrap block, step.ts:1110-1139: `driftAtWrap`
:1115 → the lap bookkeeping :1119-1123 → `notePlayed` :1124 → `densityAtWrap` :1131 →
`hooksAtWrap` :1135 → `foldAtWrap` :1138; then `turnAt` and `rollTurnaroundAt`, :1165-1178):
1. the arc runs where the density arc runs (`intensityAtWrap` in `densityAtWrap`'s place), so
   hooks see its decision for the next wrap and the roll's forecast sees its event (spec §3.1;
   timing risk 1);
2. hooks get the arc's inputs;
3. the fold step's bend follows the target;
4. the phrase end's roll carries the `arcRole`, the arc's turnaround arc, the breakdown's
   `exiting` rows and the drop;
5. picks lean (`pushArm`).

**`intensityOn(s)`** = `s.settings.density === 'intensity' && s.settings.densityArc?.on === true`
(spec §8: `densityArc.on` follows `off`; `arc` and `intensity` keep it on, and its min, max and
starter order bound the rows). Every change below is gated on it. Off, nothing below is
called and radio draws exactly what it drew before.

- [ ] **Step 1: The pure parts (the planner compiled these).**
  - `src/radio/pick.ts`:

```diff
--- a/src/radio/pick.ts
+++ b/src/radio/pick.ts
@@ -38,6 +38,7 @@
 import { pickReroll, rankCandidates } from '@shared/discoverRanking'
 import { favesDraw } from '@shared/discoverFaves'
 import { digNearDraw, isNearForDig, NO_NEAR_FITS, rankDigOf, type RadioDigAnchor } from '@shared/radioDig'
+import { applyIntensityBand, radioIntensityRankOf } from '@shared/radioIntensity'
 import type { RankClash } from '@shared/radioClash'
 import type { DiscoverCandidate } from '@shared/discoverCandidate'
 import {
@@ -116,6 +117,11 @@ export interface PickOptions {
   /** Radio's dig (@shared/radioDig): the dug row's anchor. Present: the near draw (one per pick,
    * after the faves draw) and the ranking's lean. Absent: exactly as before, no draw. */
   dig?: RadioDigAnchor
+  /** The intensity arc's lean (@shared/radioIntensity, spec 2026-10-05-radio-intensity-arc-design
+   * 2.3): the arc's target for this pick and the drama dial (a renewal at the drop passes 100: the
+   * full weight). Present: every candidate carries its index score (`x`), one band draw after
+   * applyTraitBar, and the ranking's term. Absent: exactly as before, no draw. */
+  intensity?: { target: number; drama: number }
   random?: () => number
 }
 
@@ -132,6 +138,9 @@ export interface Pick {
    * fit, so a normal pick; 'no jam' an anchor with no jam to draw from (a normal pick). Absent:
    * no near draw (no dig, the draw missed, or the faves draw went loved-only). */
   dig?: 'near' | typeof NO_NEAR_FITS | 'no jam'
+  /** The intensity band was drawn but too few candidates were in it: the pool as it was
+   * (logged `[radio-intensity] band too small`). */
+  bandBackedOff?: true
 }
 
 function classificationOf(r: IndexRecord): StemSlotClassification {
@@ -253,7 +262,8 @@ function poolFor(
   maskKinds: DiscoverMaskKind[],
   source: DiscoverSoundSourceFilter,
   random: () => number,
-  keep?: (r: IndexRecord) => boolean
+  keep?: (r: IndexRecord) => boolean,
+  withIntensity = false
 ): Pool {
   const records = new Map<string, IndexRecord>()
   const candidates: DiscoverCandidate[] = []
@@ -271,7 +281,8 @@ function poolFor(
     traitValues: {},
     traitPercentiles: r.traits ?? {},
     kindSources: {},
-    riffCreationTime: r.t
+    riffCreationTime: r.t,
+    ...(withIntensity && { intensity: r.x ?? null })
   })
   if (maskKinds.length === 0) {
     for (const r of sampleTraitPool(keep ? index.withTraits.filter(keep) : index.withTraits, source, random)) {
@@ -314,6 +325,7 @@ export function pickStem(index: PickIndex, opts: PickOptions): Pick | null {
     clash,
     faves = 0,
     dig,
+    intensity,
     random = Math.random
   } = opts
   const slotKinds = normalizeSlotKinds(opts.kinds)
@@ -331,9 +343,10 @@ export function pickStem(index: PickIndex, opts: PickOptions): Pick | null {
   const drawPool = (keep?: (r: IndexRecord) => boolean): { pool: Pool; source: DiscoverSoundSourceFilter } => {
     const draw = drawSoundSource(sourceLean, random)
     let source = draw.first
-    let pool = poolFor(index, slotKinds, maskKinds, draw.first, random, keep)
+    const leaned = intensity !== undefined
+    let pool = poolFor(index, slotKinds, maskKinds, draw.first, random, keep, leaned)
     if (!pool.candidates.some(unused) && draw.fallback !== null) {
-      const fallback = poolFor(index, slotKinds, maskKinds, draw.fallback, random, keep)
+      const fallback = poolFor(index, slotKinds, maskKinds, draw.fallback, random, keep, leaned)
       if (fallback.candidates.some(unused) || pool.candidates.length === 0) {
         pool = fallback
         source = draw.fallback
@@ -373,12 +386,17 @@ export function pickStem(index: PickIndex, opts: PickOptions): Pick | null {
   const deduped = candidates.filter(unused)
   const barInput = deduped.length > 0 ? deduped : candidates
   const { pool: barred, barUsed } = applyTraitBar(barInput, traitKinds, { bar: traitBar })
-  const ranked = rankCandidates(barred, {
+  // the intensity lean (spec 2.3): one band draw, then the ranking's term -- only while it runs
+  const band = intensity
+    ? applyIntensityBand(barred, { target: intensity.target, kinds: slotKinds, drama: intensity.drama, random })
+    : null
+  const ranked = rankCandidates(band?.pool ?? barred, {
     targetBpm,
     targetTraits: traitKinds,
     favouriteWeight: loved,
     ...(clash ? { clash } : {}),
-    ...(dig ? { dig: rankDigOf(dig) } : {})
+    ...(dig ? { dig: rankDigOf(dig) } : {}),
+    ...(intensity ? { intensity: radioIntensityRankOf(intensity.target, slotKinds, intensity.drama) } : {})
   })
   const candidate = pickReroll(ranked, chaos, random)
   if (!candidate) return null
@@ -388,6 +406,7 @@ export function pickStem(index: PickIndex, opts: PickOptions): Pick | null {
     barUsed,
     source: sourceName(source),
     ...(favesFallback ? { favesFallback: true as const } : {}),
-    ...(digDraw ? { dig: digDraw } : {})
+    ...(digDraw ? { dig: digDraw } : {}),
+    ...(band?.backedOff ? { bandBackedOff: true as const } : {})
   }
 }
```

  - Create `src/radio/pickIntensity.test.ts`:

```ts
// The intensity lean on the web's picks (sssketch spec 2026-10-05-radio-intensity-arc-design 2.3):
// pickStem's `intensity`, the index's `x`.
import { describe, expect, it } from 'vitest'
import type { IndexRecord } from '../index/shapeRecord'
import { buildPickIndex, pickStem, type PickOptions } from './pick'

const DRUMS = 1 << 1

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
const rec = (id: string, x?: number): IndexRecord => ({
  id,
  jam: 'jam1',
  t: 1_600_000_000,
  key: `k/${id}`,
  bpm: 120,
  bars: 4,
  mask: DRUMS,
  name: id,
  ...(x !== undefined && { x })
})
// scores unrelated to the records' order (a seeded shuffle), so the plain pick sits near 0.5
const ORDER = (() => {
  const r = seeded(99)
  const xs = Array.from({ length: 200 }, (_, i) => i / 199)
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    ;[xs[i], xs[j]] = [xs[j], xs[i]]
  }
  return xs
})()
const RECORDS = ORDER.map((x, i) => rec(`s${i}`, x))
const INDEX = buildPickIndex(RECORDS)
const base: PickOptions = {
  kinds: ['drums'],
  targetBpm: 120,
  chaos: 75,
  sourceLean: 0
}

function meanX(opts: PickOptions, runs = 400): number {
  let sum = 0
  for (let s = 1; s <= runs; s++) sum += pickStem(INDEX, { ...opts, random: seeded(s) })!.record.x!
  return sum / runs
}

describe('pickStem: the intensity lean', () => {
  it('leans drums picks toward the target: high in the drop, low in the build', () => {
    const plain = meanX(base)
    const high = meanX({ ...base, intensity: { target: 0.86, drama: 60 } })
    const low = meanX({ ...base, intensity: { target: 0.14, drama: 60 } })
    expect(high).toBeGreaterThan(plain + 0.15)
    expect(low).toBeLessThan(plain - 0.15)
  })

  it('carries x as the candidate intensity only while leaning', () => {
    const leaned = pickStem(INDEX, {
      ...base,
      intensity: { target: 0.5, drama: 60 },
      random: seeded(3)
    })!
    expect(leaned.candidate.intensity).toBe(leaned.record.x)
    const plain = pickStem(INDEX, { ...base, random: seeded(3) })!
    expect('intensity' in plain.candidate).toBe(false)
  })

  it('absent, picks are what they were (no band draw)', () => {
    for (let s = 1; s <= 200; s++) {
      const a = pickStem(INDEX, { ...base, random: seeded(s) })
      const b = pickStem(buildPickIndex(RECORDS.map((r) => ({ ...r, x: undefined }))), {
        ...base,
        random: seeded(s)
      })
      expect(a?.record.id).toBe(b?.record.id)
    }
  })

  it('an unscored index still picks, and the band backs off', () => {
    const bare = buildPickIndex(RECORDS.map((r) => rec(r.id)))
    let backed = 0
    for (let s = 1; s <= 100; s++) {
      const p = pickStem(bare, {
        ...base,
        intensity: { target: 1, drama: 100 },
        random: seeded(s)
      })
      expect(p).not.toBeNull()
      if (p!.bandBackedOff) backed += 1
    }
    expect(backed).toBeGreaterThan(20)
  })
})
```

  - `src/radio/settings.ts` and its pinned test (the default flips to `intensity` here, Elling's
    open question 3):

```diff
--- a/src/radio/settings.ts
+++ b/src/radio/settings.ts
@@ -22,6 +22,8 @@
 // is the only value the web honours; any other is treated as always (no bar-level landing in A).
 import {
   DEFAULT_RADIO_CHANNELS,
+  DEFAULT_RADIO_DRAMA,
+  DEFAULT_RADIO_ENERGY,
   DEFAULT_RADIO_TURNOVER,
   RADIO_PACE_BARS,
   type RadioSettings
@@ -103,6 +105,12 @@ export const WEB_RADIO_DEFAULTS: Readonly<WebRadioSettings> = Object.freeze({
   // build-ups sized to the change, and every turnaround paid off (@shared/radioBuildSize).
   // Elling, 2026-10-03: on for everyone (spec anointed-stems Decided 3)
   sizedBuilds: true,
+  // Elling, 2026-10-05: the intensity arc for every visitor (spec 2026-10-05-radio-intensity-arc-
+  // design, open question 3); the dials at the spec's defaults. densityArc stays on: its min, max
+  // and starter order bound the rows under intensity too.
+  density: 'intensity',
+  energy: DEFAULT_RADIO_ENERGY,
+  drama: DEFAULT_RADIO_DRAMA,
   // Elling: slow steps
   tempoDrift: Object.freeze({
     on: false, // off (Elling, 2026-10-01); the code stays for when it comes back
```

```diff
--- a/src/radio/settings.test.ts
+++ b/src/radio/settings.test.ts
@@ -84,6 +84,9 @@ describe('WEB_RADIO_DEFAULTS', () => {
       clash: 25, // the spec's default
       foldSeed: 'autech', // DEFAULT_FOLD_SEED
       sizedBuilds: true, // build-ups sized to the change, every turnaround paid off (Elling, 2026-10-03)
+      density: 'intensity', // build, breakdown, drop for every visitor (Elling, 2026-10-05)
+      energy: 50, // the spec's default
+      drama: 60, // the spec's default
       tempoDrift: { on: false, range: 10, stepMin: 1, stepMax: 3, everyBars: [32, 64] }, // off (Elling, 2026-10-01)
       densityArc: { on: true, min: 2, max: 5, peak: [4, 5], trough: [2, 3], legBars: [96, 192] } // Elling: slow arc 2→5
     })
```

  - Create `src/ui/densityPrefs.ts` and `src/ui/densityPrefs.test.ts`:

```ts
// src/ui/densityPrefs.ts -- the listener's density and its two dials (full mode's strip; sssketch
// spec 2026-10-05-radio-intensity-arc-design section 8): `density` off / arc / intensity, and the
// intensity arc's `energy` and `drama`, 0..100. Remembered per visitor in localStorage
// ['radio.density'], ['radio.energy'], ['radio.drama'], given to the radio when it is made and on
// every change. Missing or unreadable: WEB_RADIO_DEFAULTS' (Elling, 2026-10-05: intensity for
// every visitor, energy 50, drama 60).
import { normalizeRadioDensity, normalizeRadioDial, type RadioDensity } from '@shared/radioSchedule'
import { WEB_RADIO_DEFAULTS } from '../radio/settings'

export const DENSITY_KEY = 'radio.density'
export const ENERGY_KEY = 'radio.energy'
export const DRAMA_KEY = 'radio.drama'

type PrefsStorage = Pick<Storage, 'getItem' | 'setItem'> | null

export interface DensityPrefs {
  density: RadioDensity
  energy: number
  drama: number
}

export function webDensityDefaults(): DensityPrefs {
  return {
    density: WEB_RADIO_DEFAULTS.density ?? 'intensity',
    energy: WEB_RADIO_DEFAULTS.energy ?? 50,
    drama: WEB_RADIO_DEFAULTS.drama ?? 60
  }
}

function read(storage: PrefsStorage, key: string): unknown {
  try {
    const raw = storage?.getItem(key)
    return raw ? JSON.parse(raw) : undefined
  } catch {
    return undefined
  }
}

export function loadDensityPrefs(storage: PrefsStorage): DensityPrefs {
  const d = webDensityDefaults()
  const density = read(storage, DENSITY_KEY)
  return {
    density: density === undefined ? d.density : normalizeRadioDensity(density),
    energy: normalizeRadioDial(read(storage, ENERGY_KEY), d.energy),
    drama: normalizeRadioDial(read(storage, DRAMA_KEY), d.drama)
  }
}

export function saveDensityPrefs(prefs: Partial<DensityPrefs>, storage: PrefsStorage): void {
  const d = webDensityDefaults()
  try {
    if (prefs.density !== undefined) {
      storage?.setItem(DENSITY_KEY, JSON.stringify(normalizeRadioDensity(prefs.density)))
    }
    if (prefs.energy !== undefined) {
      storage?.setItem(ENERGY_KEY, JSON.stringify(normalizeRadioDial(prefs.energy, d.energy)))
    }
    if (prefs.drama !== undefined) {
      storage?.setItem(DRAMA_KEY, JSON.stringify(normalizeRadioDial(prefs.drama, d.drama)))
    }
  } catch {
    // not remembered past this visit
  }
}
```

```ts
import { describe, expect, it } from 'vitest'
import { DENSITY_KEY, DRAMA_KEY, ENERGY_KEY, loadDensityPrefs, saveDensityPrefs } from './densityPrefs'

function store(init: Record<string, string> = {}): Pick<Storage, 'getItem' | 'setItem'> & {
  data: Record<string, string>
} {
  const data = { ...init }
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v
    }
  }
}

describe('densityPrefs', () => {
  it('a visitor with nothing saved gets intensity, energy 50, drama 60 (Elling, 2026-10-05)', () => {
    expect(loadDensityPrefs(store())).toEqual({
      density: 'intensity',
      energy: 50,
      drama: 60
    })
    expect(loadDensityPrefs(null)).toEqual({
      density: 'intensity',
      energy: 50,
      drama: 60
    })
  })

  it('remembers each, normalised; garbage reads as the default', () => {
    const s = store()
    saveDensityPrefs({ density: 'arc', energy: 72.4, drama: 130 }, s)
    expect(s.data).toEqual({
      [DENSITY_KEY]: '"arc"',
      [ENERGY_KEY]: '72',
      [DRAMA_KEY]: '100'
    })
    expect(loadDensityPrefs(s)).toEqual({
      density: 'arc',
      energy: 72,
      drama: 100
    })
    const bad = store({
      [DENSITY_KEY]: '{',
      [ENERGY_KEY]: '"x"',
      [DRAMA_KEY]: 'null'
    })
    expect(loadDensityPrefs(bad)).toEqual({
      density: 'intensity',
      energy: 50,
      drama: 60
    })
    expect(loadDensityPrefs(store({ [DENSITY_KEY]: '"loud"' })).density).toBe('arc')
  })

  it('a throwing storage is no storage', () => {
    const angry = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      }
    }
    expect(loadDensityPrefs(angry)).toEqual({
      density: 'intensity',
      energy: 50,
      drama: 60
    })
    expect(() => saveDensityPrefs({ drama: 10 }, angry)).not.toThrow()
  })
})
```

- [ ] **Step 2: Pin today's tests to `density: 'arc'`, by intent.** The default is now
  `intensity`. Any test that runs the density arc with defaults would now run the arc machine
  instead.
  - `step.test.ts` `RULES` (:28-38): `densityArc.on` is false there, so intensity cannot run.
    Add `density: 'arc'` anyway, so a later test that turns `densityArc` on means the row arc.
  - `density.test.ts` `radio()` (:26): `{ density: 'arc', sizedBuilds: false, ...settings }`.
    Its arc timings are the row arc's.
  - `controller.test.ts`'s `RULES` and `settings.test.ts`'s `sim()` (:24): the same.
  - Run `npx vitest run src` and, for every other failure, decide by intent:
    - a test about something else that merely runs on the defaults gets `density: 'arc'`;
    - a test ABOUT the defaults gains the fields.
  - List each in the commit message.

- [ ] **Step 3: The failing tests** (`step.test.ts`, a new `describe('the intensity arc')`).
  - **Setup:** a Sim with
    `{ density: 'intensity', densityArc: { ...WEB_RADIO_DEFAULTS.densityArc, on: true }, sizedBuilds: true, turnarounds: 'often', transitions: 'bold', phraseBars: 16 }`,
    records with `x` (`rec(id, { x })`, spread 0..1 per kind), 4-bar loops unless said.
  - **Byte-identity (the harness).**
    - Copy HEAD's `step.ts`, `pick.ts` and `controller.ts` beside the new ones as `*.head.ts`.
    - Run both Sims and compare with `expect(JSON.stringify(log)).toBe(...)`, at
      `density: 'arc'` and `'off'`:
      - 600 s, seeds 1-3;
      - 10 configurations (fold off and on at bend 40 and 100, sized on and off, hooks r0/r2, dig
        on one row, the source dial at 50 and 95);
      - with holds, turns, swap-nows, Next and mutes.
    - That is 60 runs, as the anointed checks ran.
    - Delete the `*.head.ts` files before committing, or keep the comparison as a scratch test
      (the fold-follows-pace plan's way), and record the result in the message.
  - **The clock:** every `breakdown` and `drop` (logged by the reducer, Step 6) is at a time
    where the clock's `turnaroundLap` is 0 on the next tick, at loops of 1, 2, 4, 8 and 16 bars.
    The buttons are the one exception (spec §3.1).
  - **Never silent:** no tick with zero sounding rows (`sounding()`), 3 seeds × 900 s, drama 0,
    60 and 100.
  - **The low end goes only in a breakdown or a turnaround move:** every tick with no sounding
    drums and no sounding bass row is inside a breakdown, or inside a turnaround plan's window
    (its `beats` before its `at`).
  - **The rests are the arc's:**
    - at the breakdown's line, every row in its `rest` list has `resting === 'arc'`;
    - the first resting drums row gets a `throw` action whose plan ends on the line
      (`radioThrowEndingAt`);
    - a bass row gets no throw;
    - at the drop, every one is back (`resting` undefined) with its own record, or a renewal's.
  - **The drop is the moment:**
    - every drop with something rested has a `turnaround` action at its time, with
      `plan.parts[0].move === 'riser'` and `plan.gapBeats > 0` at drama 60;
    - no other phrase end in an intensity run has `gapBeats > 0`.
  - **Hooks:** a drums hook rests through the breakdown (its hook stays `in`, `bars` frozen) and
    is back on the drop. An away hook's return due during the breakdown lands on the drop.
  - **Buttons:**
    - `{ type: 'arc', action: 'drop' }` in a breakdown: the rested rows are back at the next top
      under a riser turnaround;
    - `drop` while building: a `turnaround` at the next top led by `low drop`, then the phase is
      `drop`;
    - `build` in the ride: a removal at the next top and the phase is `build`;
    - pressed in the last 1.5 beats of a lap: the top after.
  - **Stop:** every arc rest is released (`resting` gone), and `s.intensity` is null.
  - **Measure, not assert** (a scratch test, numbers into the commit message):
    - per bar, over 4 seeds × 900 s at each energy × drama of {0, 50, 100}², 4-bar and 8-bar
      loops: the sounding count; the bed intensity (`radioBedIntensity` over sounding rows'
      `record.x`); low presence; the phase; the turnaround at each phrase end;
    - the mean pool rank of drums and bass picks in the drop and in the build's first phrase
      (spec §13 targets: ≥ 0.65 and ≤ 0.45);
    - the mean cycle length against §3.2's table;
    - big cycles every 3-4;
    - band back-offs under 10% of draws;
    - null picks no more often than with `density: 'arc'`.
  - Run `npx vitest run src/radio/step.test.ts`. **Expected:** the new tests FAIL. The
    byte-identity runs pass (nothing changed yet).

- [ ] **Step 4: State.** In `RadioState` (step.ts:483-602) add, with `initialRadioState`
  (:753-808) values:

```ts
  /** The intensity arc (@shared/radioIntensityArc; sssketch spec 2026-10-05-radio-intensity-arc-
   * design). Null unless radio runs with density intensity (intensityOn). */
  intensity: RadioIntensityArc | null   // null
  /** The breakdown's carry row, picked when prepared (a lead or warm row: radioCarryKind), landing
   * on the breakdown's one when the decision says `carry`. */
  carry: RadioPending | null            // null
  /** Fresh picks for the drop's returning drums and bass rows, prepared a phrase ahead and leaned
   * to the top target at full weight; used when the drop's decision renews the row. */
  renew: Record<string, RadioPending>   // {}
```

  - `RadioRow.resting` (:273) becomes `resting?: 'hook' | 'arc'`.
    - Every `row.resting = true` becomes `'hook'` (`landRest` :2444 sets the owner from the
      landing: `m.arc ? 'arc' : 'hook'`).
    - Every truthy check (`sounding` :4206, `resting()` :2983, `radioThrowRows` in `throwAim.ts`)
      works unchanged.
  - `RadioManual` (:375-420 area) gains `arc?: 'rest' | 'return'`, the arc's own landings (as
    `hook`). Every place that branches on `m.hook` for "a landing that is not a manual change"
    (never clears a hook, never counts as a manual change, `scheduleHookLandings` :2760) treats
    `m.arc` the same way.
  - `draft` (:4149): copy `intensity` as
    `{ ...i, rests: [...i.rests], decided: i.decided && { ...i.decided } }`, `carry` as
    `{ ...k }`, and `renew` entry by entry.
  - `stop` (:3560):
    - `radioIntensityStopped`: every `unrest` row's `resting` deleted (they play their stems with
      the next play, as hook rests do: :3562);
    - `s.intensity = null`, `s.carry = null`, `s.renew = {}`.

- [ ] **Step 5: Start and switch.**
  - **Play:** today `if (s.settings.densityArc?.on) newLeg(c, 'growing')` (:3548).
    - Under `intensityOn`: `s.intensity = radioIntensityStarted({ energy, drama, min: arc.min, max: arc.max, count: s.rows.length, random: c.rnd })`
      instead. This is §3.5's first draws, from the stream, at play.
    - Otherwise as today.
  - **A density change while running:** new event `{ type: 'density'; density; energy; drama }`
    (the controller's `setDensity`, Task 8).
    - It sets the three settings, and `densityArc.on = density !== 'off'`.
    - `arc` → `intensity`: `s.intensity = newRadioIntensityArc()` (it begins at the next phrase
      start, spec §5.7), `s.density = null`.
    - `intensity` → `arc` or `off`:
      - `radioIntensityStopped`; each `unrest` row gets a joining return at the next top (an arc
        `return` landing with its own record, Step 7's path);
      - `s.intensity = null`;
      - for `arc`, `newLeg(c, 'growing')`.
    - Only the dials changed: the settings only (read at every wrap).

- [ ] **Step 6: The arc at the wrap.**
  - `densityAtWrap` (:2903) returns at once under `intensityOn`. Call a new
    `intensityAtWrap(c, t, loopBars, adv.turnaroundLapStarts, nextWrap)` right after it (:1131)
    whenever `intensityOn`, held or not: a decided event still lands while held, and the machine
    stops its own clock (`held` in its input).
  - `intensityAtWrap`, in order:
    1. **Before the step** (a lap early, as `densityAtWrap`'s adds are: `addDecidesAt` :2945).
       When `radioIntensityAddComing(s.intensity, s.rows.length)` and
       `addDecidesAt(perT, lap)` and no `s.adding`: `startAdd(c)`, aimed at the phrase start
       (`added.aim = nextWrap + loopBars * 240 / s.bpm`, `aimWraps = 2`, as :2930-2934 does).
    2. **The step:**

```ts
  const r = stepRadioIntensityArc(s.intensity, {
    energy: radioEnergyOf(s.settings),
    drama: radioDramaOf(s.settings),
    loopBars,
    lap: s.clock?.turnaroundLap ?? 0,
    phraseLaps: turnaroundPhraseLaps(radioCadenceOf(s.settings).turnaroundPhraseBars, loopBars),
    held: s.held,
    count: s.rows.length,
    min: s.settings.densityArc.min,
    max: s.settings.densityArc.max,
    rows: s.rows.map((r) => ({
      id: r.id,
      kinds: r.kinds,
      score: r.record?.x ?? null,
      staleness: s.turn - (s.changedAt.get(r.id) ?? s.turn),
      sounding: sounding(s, r),
      // the arc rests only what radio may silence (spec 4.1's "never rested" list)
      restable:
        !!r.record && !r.muted && !r.soloed && !s.rows.some((o) => o.soloed && o !== r) &&
        !r.resting && !s.manual[r.id] && !landingLate(s, r.id) &&
        !(radioHookOf(s.hooks, r.id)?.decided?.event === 'exit')
    })),
    canAdd: !!s.adding && !!s.adding.record && isReady(s, s.adding.record, s.bpm),
    canStrip: removalVictim(s) !== null,
    carryReady: !!s.carry?.record && isReady(s, s.carry.record, s.bpm) && addIndex(s) !== null,
    renewReady: (id) => !!s.renew[id]?.record && isReady(s, s.renew[id].record!, s.bpm),
    random: c.rnd
  })
  s.intensity = r.state
  if (r.overran) c.out.push({ type: 'log', message: '[radio-intensity] breakdown overran' })
```

    3. **`r.prepare`:**
       - `carry`: `s.carry = { slot: newRow(addIndex(s)!).id, token: ++s.token, record: null }`,
         then `pushArm` with kinds `[radioCarryKind(s.rows)]`;
       - for each `renew` id: `s.renew[id] = { slot: id, token: ++s.token, record: null }` and
         `pushArm(c, id, token, kindsOf(s, id), { intensity: { target: hi, drama: 100 } })`
         (`hi` = `radioIntensityTargets(e, d, s.intensity.big).hi`);
       - `picked` (:1831) fills a matching token's record.
    4. **`r.decided`**, landing at `nextWrap` (W):
       - `cycle` with `strip`: `startRemove(c)`. It takes W, as a removal decided at `lapStarts`
         does today. Log `[radio-intensity] strip`.
       - `add`: nothing more (the add started in 1 is aimed at W; `densityTick` schedules it when
         ready). Not ready by W: it lands at a later top, as today.
       - `breakdown`:
         - for each `rest` row, `arcRest(c, t, id, W)`: a `RadioManual` like `hookDecided`'s rest
           (:2692-2722), with `arc: 'rest'`, `rest: true`, `record` the row's own, `wrapAt: W`,
           `transition: cut`;
         - on `throwRowId`: `radioThrowEndingAt(id, decided.throw, W, s.bpm)`, a `throw` action,
           `m.throwAt` (the controller counts it on its throw clock with `noteRadioExitThrow`, as
           a hook exit's);
         - with `carry` and `s.carry` warm: `s.adding = { ...carry fields, kinds: [radioCarryKind(s.rows)], transition: { kind: 'bloom', beats } }`,
           aimed at W;
         - log `[radio-intensity] breakdown <depth>: rests <ids>`.
       - `drop`: for each `returning` row still on the bed and still `resting === 'arc'`:
         - `arcReturn(c, id, W, record)`: a `RadioManual` with `arc: 'return'`, a joining return
           (the `swapAt` with `muted` that a hook return onto a resting row uses, :2741-2744),
           `transition: cut`;
         - its record is `s.renew[id].record` when `id` is in `renew`, else its own;
         - log `[radio-intensity] drop: back <ids>, renewed <ids>`;
         - then `s.renew = {}`.
       - Every arc landing goes to the engine through `scheduleHookLandings`' path (:2760),
         after the tick's roll.
    5. **`r.applied`** (the event decided last wrap landed now): the landings already happened
       through the manual path (`landRest` sets `resting: 'arc'`; a return clears it).
       - Output a `log` for the flash: `{ type: 'arcPhase', phase, time }`. A new action, so the
         controller flashes `breakdown` on the rested rows and `drop` on the returning rows (Task
         8 draws the words).
       - Reconcile: a rest the engine refused leaves the row playing, so call
         `releaseRadioIntensityRest`.
  - **The bookkeeping that reads the arc's rests:**
    - `removalVictim` (:2990) and `hooksAtWrap`'s `lastLowHeard` (:2615) already read
      `resting()` (truthy: arc rests count as unheard), so no change;
    - `restEnds` (:2461) is for hook rests only: return early when `row.resting === 'arc'`;
    - a mute, solo or swap-now on an arc-resting row calls
      `s.intensity = releaseRadioIntensityRest(s.intensity, id)` and joins the row again (the
      web's mute toggle keeps a hook rest resting, 49b824d; an ARC rest given back by hand plays:
      spec §4.2);
    - a row removed or pruned: release too.

- [ ] **Step 7: Hooks, fold, the roll, the turn.**
  - `hooksAtWrap` (:2594). Under `intensityOn`, spread `...radioIntensityHookInputs(s.intensity)`
    into `stepRadioHooks`' input (:2623-2638), and give each row
    `arcResting: r.resting === 'arc' || (decided breakdown's rest includes r.id)`. Its
    `arcThinning` stays false (the arc is not the row arc).
  - `foldAtWrap` (:3737). Under `intensityOn`, `fold` becomes
    `radioIntensityBend(s.settings.fold, drama, radioIntensityTarget(s.intensity, energy, drama))`.
  - `turnaroundInputOf` (:1591). Under `intensityOn`, `arc` becomes
    `radioIntensityTurnaroundArc(s.intensity)`.
  - `turnaroundRowsOf` (:1564-1589). A row in a decided breakdown's `rest` gets `exiting: true`,
    so no move silences it before its throw and a wash prefers it (spec §4.3; timing risk 6).
  - **`forecastAt` (:1720)**, under `intensityOn`:
    - set `arcRole: radioIntensityArcRole(s.intensity)` on `forecast`, `full` and `certain`;
    - for a decided `drop`, count `returning` rows still `resting === 'arc'` as rows, and
      `lowEndReturn` when any has drums or bass;
    - a decided `breakdown` counts no rows (its rests are not changes).
  - **`rollTurnaroundAt` (:1492):**
    - pass the arc's arc (as above);
    - when `arcRole === 'drop'`, pass
      `drop: { gapChance: turnaroundDropGapChance(radioDramaOf(s.settings)) }`;
    - the phrase end's `radioPhraseEndBuild` does the rest: large and exempt with the low end
      back, medium elsewhere, no promotion.
  - **`turnAt` (:1647). A turn pressed for the drop's top merges with it** (spec §5.6). When
    `s.intensity?.decided?.event === 'drop'` and `at` is its W, the forced roll gets the same
    `drop` and `payoff: 'large'`.
  - **The turnarounds-off case** (spec §4.4) needs nothing: `rollTurnaroundAt` rolls nothing, and
    the returns land as joining cuts.

- [ ] **Step 8: Picks lean.**
  - `pushArm` (:3189, today `(c, slot, token, kinds = kindsOf(...))`) gains an optional fifth
    parameter `lean?: { target: number; drama: number }`. Under `intensityOn` and running, every
    arm carries `intensity: lean ?? { target: radioIntensityTarget(s.intensity, e, d), drama: d }`.
    Only the renewals pass their own. The arm action (:663-675) gains `intensity?`.
  - `controller.ts`'s arm (:407-439) passes it to `indexPicker` → `pickStem`.
  - A pick with `bandBackedOff` logs `[radio-intensity] band too small`.
  - The picker's draw order is faves, dig, band (pick.ts).

- [ ] **Step 9: The buttons.**
  - New event `{ type: 'arc'; action: 'build' | 'drop' }` → `arcPress(c, action)`:
    - Nothing unless `intensityOn` and running and not held.
    - `late` = `turnaroundTurnBeats((nextWrap - now) / beat, TURN_LEAD_SEC / beat) === null`, the
      turn's own rule.
    - `s.intensity = pressRadioIntensity(s.intensity, action, { lap, phraseLaps, late }) ?? s.intensity`.
  - Then, when the press decided a `drop` for the coming top: set the turn request
    (`s.turnRequest`, :1614's shape) with a new `drop: true`:
    - in a breakdown: `{ move: 'riser' }`, a riser fitted to the lap;
    - a quick drop: `{ move: 'low drop' }`, `maxBeats` clamped to 8 (2 bars).

    `turnAt` passes `drop: { gapChance }` and `payoff: 'large'` for a request with `drop`. A
    press too late takes the top after (`forced`), and the turn request waits with it.
  - A decided quick drop needs no rests: its `low drop` is the silence. A pressed `build` in the
    ride decides a `cycle` with `strip`: `startRemove(c)` at once, for the coming top.
  - `RadioView` (`describe` :4644) gains:

```ts
  arc: {
    phase: RadioIntensityPhase
    big: boolean
    build: string   // radioIntensityButtonLabel('build', s.intensity): `build` / `building`
    drop: string    // `drop` / `dropping`
    canBuild: boolean
    canDrop: boolean
  } | null
```

  - `canDrop` is false in a build or ride when `turnaroundMoveCanSound(input, 'low drop')` is false
    (no other row to keep sounding). It is null unless `intensityOn`.

- [ ] **Step 10: Throws into the drop** (`throwAim.ts`, controller `throwTick` :343-362):
  - Add `radioThrowDropAt(s, nextBeat, bpm): number | null`: the drop's W time when the arc is in
    its breakdown's last phrase (`phase === 'breakdown' && done + 1 >= phrases`, or a decided
    `drop`), on the beat grid, else null.
  - The tick passes `dropAt`.
  - A hook exit's or breakdown's throw is counted by `noteRadioExitThrow` as today.

- [ ] **Step 11: The readout.** `readoutView` (:4604), under `intensityOn`:
  - `arc` is
    `radioReadoutIntensityArc(s.intensity, s.rows.length, radioIntensityDropInBars(s.intensity, { lap, phraseLaps, loopBars, pos }))`;
  - `nextChange` gains `drop: true` (a decided drop: its first returning row) and `rests: true`
    (a decided breakdown's first rest);
  - `narrow` comes from the view's caller (Task 8 passes `FullOptions.narrow`).

- [ ] **Step 12: Run, harness, typecheck, commit.**
  - Run `npx vitest run src` and `npm run typecheck`.
  - Byte-identity (Step 3's harness): identical to HEAD at `density: 'arc'` and `'off'`, 60 runs.
    Record "identical" (or the first difference).
  - Measure and record Step 3's numbers.
  - Message:
    `radio: the intensity arc (sssketch spec 2026-10-05-radio-intensity-arc-design; Elling: intensity for every visitor, energy 50, drama 60) -- density intensity (WEB_RADIO_DEFAULTS, densityPrefs) runs @shared's machine where the density arc ran (before hooks, fold and the roll): a build adding rows on phrase starts and leaning picks (pushArm: the band draw and the term, x on the index), the breakdown resting drums and bass (RadioRow.resting 'arc', the hooks' resting landing; the first drums row's echo throw ends on the line; a carry row when nothing melodic plays), the drop bringing them back (own stems, or renewals at 0.25 + 0.5 drama warmed a phrase ahead) under a riser at its longest and a gap from drama 50; arcRole on the forecast (the drop large and exempt, the rest medium, no promotion), the arc's turnaround arc, the breakdown's rows exiting; hooks pulled to the drop and held through the breakdown; fold's bend by the target; throws aimed into the drop; the build and drop buttons (a quick drop is the planner's low drop); a turn on the drop's top merges with it. Tests pinned to density arc by intent: <list>. density arc/off: action log byte-identical to HEAD (<result>). Measured: <numbers>. No agent heard it`,
    then the trailer.

### Task 8: Web full mode: density, the dials, build and drop

**Repo:** ell.ing/radio. **Depends on:** Task 7. **Files:** `src/ui/full.ts`, `full.css`,
`fullModel.ts` (+ test), `src/radio/controller.ts` (setters), `src/main.ts`.

- [ ] **Step 1: The model's failing tests** (`fullModel.test.ts`):
  - `FullStrip` gains `density: { chips: { label: 'off' | 'arc' | 'intensity'; on: boolean }[] }`,
    `energy` and `drama` (0..100), and `arc: { build, drop, canBuild, canDrop } | null` from
    `view.arc`.
  - The buttons are present only while `view.arc` is non-null (spec §6: "the web shows them only
    then").
  - Labels are `build` / `building` and `drop` / `dropping`, with tooltips `RADIO_BUILD_TOOLTIP`
    / `RADIO_DROP_TOOLTIP` (sssketch `radioStripModel.ts`).
  - `fullKey` (:226) redraws on them.
  - The status line already comes from the shared readout.
  - The row's role words gain `RADIO_ARC_REST_WORD` (narrow: `RADIO_ARC_REST_SHORT`) for a row
    `resting === 'arc'`. `RadioRowView` carries `resting: 'hook' | 'arc' | null`.
- [ ] **Step 2: The controller.**
  - `setDensity({ density?, energy?, drama? })` dispatches Task 7's `density` event.
  - `arc(action)` dispatches `{ type: 'arc', action }`, as `turn()` (:299) does.
  - Flashes: on an `arcPhase` action:
    - `breakdown` on each rested row at its line;
    - `drop` on each returning row at W;
    - `build` on every row at a pressed build's top.

    Keyed so a take-back drops them (as hook landings are).
- [ ] **Step 3: The page.**
  - In `full.ts`'s strip (`masterGrp.append`, :610), after the faves and source knobs:
    - a `density` chip group (`off`, `arc`, `intensity`; `RADIO_STRIP_HINTS.density` as its
      title);
    - two knobs, `energy` (title `gentle to driving`) and `drama` (title `how far it swings`), as
      `range()` builds the faves knob (:478-486), dimmed while density is not intensity. Their
      words are the strip model's constants.
  - In `turnGrp` (:514-522), after the turn button: `build` and `drop` buttons, shown only while
    `model.arc` is non-null.
  - Phone width (`FullOptions.narrow`): the readout's `narrow`, and the role word's short form.
    Check 320 and 390 px light and dark in headless Chrome (the t8shots harness of the anointed
    plan): no overlap, no horizontal scroll.
- [ ] **Step 4: `main.ts`.**
  - `loadDensityPrefs(localStore())` gives the controller its settings at construction
    (:475-485): `density`, `energy`, `drama`, and `densityArc.on = density !== 'off'`.
  - The `mountFull` callbacks (:283-310) gain `density` / `energy` / `drama` setters, which call
    `saveDensityPrefs` and `radio?.setDensity(...)`.
  - Simple mode gets no controls and plays the stored or default values.
- [ ] **Step 5: Verify, commit.**
  - Run `npx vitest run src`, `npm run typecheck`, `npm run build`, `npm run check:engine`.
  - Screenshots at 320/390, light and dark: headless Chrome only. Say so.
  - Message:
    `full mode: density, energy, drama, build and drop (sssketch spec 2026-10-05-radio-intensity-arc-design sections 6, 8, 9) -- a density chip group and two dials beside faves and source (remembered per visitor: densityPrefs), build and drop in the turn group while intensity runs (building/dropping while waiting), breakdown/drop/build flashed on their rows, "rests till the drop" on a resting row (rests under 360 px). Seen in headless Chrome only; no agent heard it or held a phone`,
    then the trailer.

**Ship point A.** Elling listens to ell.ing/radio's local build (walkthrough items 1-7). Upload
and deploy wait for his go-ahead.

---

## Phase 2: the desktop

### Task 9: Main: intensity on every candidate, and the value table's level columns

**Repo:** sssketch. **Depends on:** Task 2. **Parallel with:** Tasks 3-8.

**Files:**
- Modify: `src/main/traitQuantileCache.ts` (+ test), `discoverCandidates.ts` (+ test),
  `discoverAdjacency.ts`, `index.ts`, `src/preload/index.ts`
- These tests are already in `vitest.config.ts`'s CI exclude list (they open sqlite). Nothing to
  add there.

- [ ] **Step 1: The failing tests.**
  - `src/main/traitQuantileCache.test.ts`:

```diff
--- a/src/main/traitQuantileCache.test.ts
+++ b/src/main/traitQuantileCache.test.ts
@@ -323,3 +323,68 @@ describe('trait value table (B1)', () => {
     ).toEqual({ rhythmic: 999 })
   })
 })
+
+describe('the level fields (spec 2026-10-05-radio-intensity-arc-design 2.1)', () => {
+  function insertLevelled(db: Database.Database, from: number, to: number): void {
+    const stmt = db.prepare(
+      `INSERT INTO StemFeatureCache (StemCID, FeaturesJSON, ExtractedAt) VALUES (?, ?, 0)`
+    )
+    for (let i = from; i < to; i++) {
+      stmt.run(
+        `lvl${String(i).padStart(6, '0')}`,
+        JSON.stringify({
+          transientDensity: i,
+          bassEnergyRatio: 0.1,
+          spectralCentroidHz: 100,
+          mfcc: [],
+          loudnessLufs: -30 + (i % 20),
+          lowLevelDb: -40 + (i % 30),
+          activeFraction: (i % 10) / 10,
+          levelVersion: 1
+        })
+      )
+    }
+  }
+
+  it('get tables beside the trait fields once PREFERRED_TABLE_MIN_ROWS carry them', async () => {
+    const db = freshDb()
+    insert(db, 0, 1000)
+    insertLevelled(db, 0, PREFERRED_TABLE_MIN_ROWS - 1)
+    expect((await getTraitQuantileTables(db)).loudnessLufs).toBeUndefined()
+    const more = freshDb()
+    insert(more, 0, 1000)
+    insertLevelled(more, 0, PREFERRED_TABLE_MIN_ROWS)
+    const tables = await getTraitQuantileTables(more)
+    for (const f of ['loudnessLufs', 'lowLevelDb', 'activeFraction'] as const) {
+      expect(tables[f], f).toBeDefined()
+    }
+    expect(percentileOf(tables.loudnessLufs, -30)).toBeLessThan(0.1)
+    expect(tables.transientDensity).toBeDefined()
+  })
+
+  it('the value table carries them, and a merged write updates them', async () => {
+    const db = freshDb()
+    insert(db, 0, 10)
+    await getTraitQuantileTables(db)
+    const table = getTraitValueTable(db)!
+    const row = table.rowOf('stem000003')!
+    expect(
+      Number.isNaN((table.features(row) as unknown as { loudnessLufs: number }).loudnessLufs)
+    ).toBe(true)
+    noteStemFeatureRowWritten(
+      db,
+      {
+        transientDensity: 3,
+        loudnessLufs: -12,
+        lowLevelDb: -20,
+        activeFraction: 1
+      } as StemFeatures,
+      'stem000003'
+    )
+    expect(table.features(row)).toMatchObject({
+      loudnessLufs: -12,
+      lowLevelDb: -20,
+      activeFraction: 1
+    })
+  })
+})
```

  - `src/main/discoverCandidates.test.ts`:

```diff
--- a/src/main/discoverCandidates.test.ts
+++ b/src/main/discoverCandidates.test.ts
@@ -1805,6 +1805,30 @@ describe('getDiscoverCandidates (kind sets)', () => {
     expect(c.traitValues).toEqual({ warm: 900, rhythmic: 0.6, bright: 900 })
   })
 
+  it('alsoIntensity: every candidate carries its intensity score; absent, none does', async () => {
+    const own = freshDb()
+    seedRiff(own, 'r1', 'jam1', 128, ['busy', 'calm', 'none'])
+    seedStem(own, 'busy', 'jam1', { instrument: DRUM })
+    seedStem(own, 'calm', 'jam1', { instrument: DRUM })
+    seedStem(own, 'none', 'jam1', { instrument: DRUM })
+    seedFeatures(own, 'busy', featuresJSON({ transientDensity: 9, bassEnergyRatio: 0.9 }))
+    seedFeatures(own, 'calm', featuresJSON({ transientDensity: 1, bassEnergyRatio: 0.1 }))
+    const roll = (alsoIntensity?: boolean): ReturnType<typeof getDiscoverCandidates> =>
+      getDiscoverCandidates({
+        ownDb: own,
+        jams: [{ jamCID: 'jam1', dbForJam: own }],
+        kinds: ['drums'],
+        ...(alsoIntensity !== undefined && { alsoIntensity })
+      })
+    const leaned = await roll(true)
+    const of = (id: string): number | null | undefined =>
+      leaned.find((c) => c.stemCID === id)!.intensity
+    expect(of('busy')!).toBeGreaterThan(of('calm')!)
+    expect(of('none')).toBeNull()
+    for (const c of await roll()) expect('intensity' in c).toBe(false)
+    for (const c of await roll(false)) expect('intensity' in c).toBe(false)
+  })
+
   it('an empty kind set returns []', async () => {
     const own = freshDb()
     expect(
```

  - Run `npx vitest run src/main/traitQuantileCache.test.ts src/main/discoverCandidates.test.ts`.
    **Expected:** FAIL.

- [ ] **Step 2: The value table and the tables over every quantile field.**
  `src/main/traitQuantileCache.ts`:

```diff
--- a/src/main/traitQuantileCache.ts
+++ b/src/main/traitQuantileCache.ts
@@ -16,7 +16,9 @@
 //   table. Concurrent callers share one in-flight build.
 //
 // Phase 3 (feature versions): tables exist per FIELD, fallback and
-// preferred (five). While the background scan re-extracts old rows, the
+// preferred (five), and the level pass's three for the radio's intensity score (QUANTILE_FIELDS;
+// a level-backfilled row carries the Phase 3 fields too, so the same growth counter rebuilds the
+// tables as the backfill proceeds). While the background scan re-extracts old rows, the
 // tables also rebuild once rows carrying the new fields have grown >= 5%
 // -- tracked with an in-memory counter bumped by every feature-row write
 // (noteStemFeatureRowWritten, called from stemFeatureCacheStore.ts), never
@@ -35,9 +37,10 @@ import type { StemFeatures } from '@shared/stemFeatures'
 import {
   FALLBACK_FIELDS,
   PREFERRED_TABLE_MIN_ROWS,
+  QUANTILE_FIELDS,
   TRAIT_FIELDS,
   tableForField,
-  type TraitField,
+  type QuantileField,
   type TraitQuantileTables
 } from '@shared/traitQuantiles'
 import { countWork } from './workCounters'
@@ -77,17 +80,18 @@ const inFlight = new WeakMap<Database.Database, Promise<CacheEntry>>()
 const newFieldWrites = new WeakMap<Database.Database, number>()
 
 /** Column index of each trait field in TraitValueTable. */
-const FIELD_COLUMN = new Map<TraitField, number>(TRAIT_FIELDS.map((f, i) => [f, i]))
+const FIELD_COLUMN = new Map<QuantileField, number>(QUANTILE_FIELDS.map((f, i) => [f, i]))
 
 /** Compact in-memory per-stem trait values (B1): one Float64Array column
- * per trait field (NaN = absent/non-finite) plus a StemCID -> row Map.
+ * per quantile field -- the trait fields and, since the intensity arc (spec 2026-10-05 2.2), the
+ * level pass's three (NaN = absent/non-finite) -- plus a StemCID -> row Map.
  * Holds every StemFeatureCache row whose FeaturesJSON parses to a truthy
  * value -- exactly the rows a roll's own JSON.parse path would have given
  * trait values to; anything else is "malformed" and gets none. */
 export class TraitValueTable {
   private readonly rowByStemCID = new Map<string, number>()
   private readonly stemCIDs: string[] = []
-  private columns: Float64Array[] = TRAIT_FIELDS.map(() => new Float64Array(0))
+  private columns: Float64Array[] = QUANTILE_FIELDS.map(() => new Float64Array(0))
   private readonly malformed = new Set<string>()
   /** StemFeatureCache rows this table accounts for (parsed + malformed) --
    * compared against the live COUNT(*) before a roll trusts it. */
@@ -111,7 +115,7 @@ export class TraitValueTable {
    * or non-numeric field). */
   features(row: number): StemFeatures {
     const out: Record<string, number> = {}
-    TRAIT_FIELDS.forEach((field, i) => {
+    QUANTILE_FIELDS.forEach((field, i) => {
       out[field] = this.columns[i][row]
     })
     return out as unknown as StemFeatures
@@ -229,7 +233,7 @@ async function buildTables(db: Database.Database, rowCount: number): Promise<Bui
   newFieldWrites.set(db, 0)
   pendingWrites.set(db, new Map())
   const valueTable = new TraitValueTable()
-  const valuesByField = new Map<TraitField, number[]>(TRAIT_FIELDS.map((f) => [f, []]))
+  const valuesByField = new Map<QuantileField, number[]>(QUANTILE_FIELDS.map((f) => [f, []]))
   let parsedRows = 0
   let newFieldRows = 0
   const page = db.prepare(
@@ -255,7 +259,7 @@ async function buildTables(db: Database.Database, rowCount: number): Promise<Bui
       if (!features || typeof features !== 'object') continue
       parsedRows += 1
       if (hasNewField(features)) newFieldRows += 1
-      for (const field of TRAIT_FIELDS) {
+      for (const field of QUANTILE_FIELDS) {
         const v = features[field]
         if (typeof v === 'number' && Number.isFinite(v)) valuesByField.get(field)!.push(v)
       }
@@ -266,7 +270,7 @@ async function buildTables(db: Database.Database, rowCount: number): Promise<Bui
   }
 
   const tables: TraitQuantileTables = {}
-  for (const field of TRAIT_FIELDS) {
+  for (const field of QUANTILE_FIELDS) {
     await yieldToEventLoop()
     const table = tableForField(field, valuesByField.get(field)!, parsedRows)
     if (table) tables[field] = table
```

- [ ] **Step 3: `alsoIntensity`.** `src/main/discoverCandidates.ts`:

```diff
--- a/src/main/discoverCandidates.ts
+++ b/src/main/discoverCandidates.ts
@@ -24,6 +24,11 @@ import {
   type TraitValues
 } from '@shared/discoverTraits'
 import { traitPercentilesFromValues } from '@shared/traitQuantiles'
+import {
+  INTENSITY_INPUT_FIELDS,
+  stemIntensityScore,
+  type IntensityValues
+} from '@shared/radioIntensity'
 import { getTraitQuantileTables, getTraitValueTable } from './traitQuantileCache'
 import { countWork } from './workCounters'
 import type { StemFeatures } from '@shared/stemFeatures'
@@ -860,7 +865,8 @@ export async function getDiscoverCandidates({
   targetUser,
   soundSource = { endlesss: true, audioIn: true },
   artistStemCIDs,
-  alsoTraits = []
+  alsoTraits = [],
+  alsoIntensity = false
 }: {
   ownDb: Database.Database
   jams: JamDbPair[]
@@ -878,6 +884,42 @@ export async function getDiscoverCandidates({
    * candidate against the bed. They never filter and never change `slotKinds`; empty (every
    * other roll) takes today's path untouched. */
   alsoTraits?: readonly DiscoverTraitKind[]
+  /** The radio's intensity arc (@shared/radioIntensity, spec 2026-10-05-radio-intensity-arc-design
+   * 2.2): attach every candidate's `intensity` score. False (every other roll): nothing attached,
+   * the payload as before. */
+  alsoIntensity?: boolean
+}): Promise<DiscoverCandidate[]> {
+  const pool = await getDiscoverCandidatesPool({
+    ownDb,
+    jams,
+    kinds,
+    onlyOwnStems,
+    targetUser,
+    soundSource,
+    artistStemCIDs,
+    alsoTraits
+  })
+  return alsoIntensity ? attachDiscoverIntensity(ownDb, pool) : pool
+}
+
+async function getDiscoverCandidatesPool({
+  ownDb,
+  jams,
+  kinds,
+  onlyOwnStems,
+  targetUser,
+  soundSource,
+  artistStemCIDs,
+  alsoTraits
+}: {
+  ownDb: Database.Database
+  jams: JamDbPair[]
+  kinds: readonly DiscoverSlotKind[]
+  onlyOwnStems: boolean
+  targetUser?: string
+  soundSource: DiscoverSoundSourceFilter
+  artistStemCIDs?: ReadonlySet<string>
+  alsoTraits: readonly DiscoverTraitKind[]
 }): Promise<DiscoverCandidate[]> {
   const normalized = normalizeSlotKinds(kinds)
   const maskKinds = normalized.filter(isMaskSlotKind)
@@ -955,6 +997,98 @@ export async function attachDiscoverTraits(
   return attachTraitPercentiles(ownDb, attachTraitValues(ownDb, pool, kinds))
 }
 
+/** The radio's intensity score on every candidate of a pool (spec 2026-10-05-radio-intensity-arc-
+ * design 2.2): its values from the in-memory value table (traitQuantileCache.ts, which carries the
+ * level pass's fields too) or, until that table is current, ownDb's feature rows; the library
+ * percentiles from the cached quantile tables. A stem with no row, or neither busy nor low, is
+ * null (unscored). Same order, same length; yields like attachTraitPercentiles. Radio's dig near
+ * pool (discoverAdjacency.ts) takes it too. */
+export async function attachDiscoverIntensity(
+  ownDb: Database.Database,
+  pool: DiscoverCandidate[]
+): Promise<DiscoverCandidate[]> {
+  if (pool.length === 0) return pool
+  const tables = await getTraitQuantileTables(ownDb)
+  const valuesOf = intensityValueSource(
+    ownDb,
+    pool.map((c) => c.stemCID)
+  )
+  const out: DiscoverCandidate[] = []
+  let sinceYield = 0
+  for (const c of pool) {
+    const values = valuesOf(c.stemCID)
+    out.push({ ...c, intensity: values === null ? null : stemIntensityScore(values, tables) })
+    sinceYield += 1
+    if (sinceYield >= CLASSIFY_YIELD_EVERY) {
+      sinceYield = 0
+      await yieldToEventLoop()
+    }
+  }
+  countWork('discover:intensity-attached', out.length)
+  return out
+}
+
+/** Each stem's intensity inputs: from the value table when it is current, else read from ownDb's
+ * StemFeatureCache (chunked, as attachTraitValues' fallback). Null: no (parseable) row. */
+function intensityValueSource(
+  ownDb: Database.Database,
+  stemCIDs: readonly string[]
+): (stemCID: string) => IntensityValues | null {
+  const pick = (f: Record<string, unknown>): IntensityValues => {
+    const v: IntensityValues = {}
+    for (const field of INTENSITY_INPUT_FIELDS) {
+      const x = f[field]
+      if (typeof x === 'number' && Number.isFinite(x)) v[field] = x
+    }
+    return v
+  }
+  const table = getTraitValueTable(ownDb)
+  if (table) {
+    return (stemCID) => {
+      const row = table.rowOf(stemCID)
+      return row === undefined
+        ? null
+        : pick(table.features(row) as unknown as Record<string, unknown>)
+    }
+  }
+  const rows = featureRowsByStemCID(ownDb, stemCIDs)
+  return (stemCID) => {
+    const f = rows.get(stemCID)
+    return f === undefined ? null : pick(f as unknown as Record<string, unknown>)
+  }
+}
+
+/** Parsed StemFeatureCache rows for these stems, chunked; a malformed row is left out. */
+function featureRowsByStemCID(
+  ownDb: Database.Database,
+  stemCIDs: readonly string[]
+): Map<string, StemFeatures> {
+  const featuresByStemCID = new Map<string, StemFeatures>()
+  for (const cidChunk of chunk([...stemCIDs], CANDIDATE_QUERY_CHUNK_SIZE)) {
+    const placeholders = cidChunk.map(() => '?').join(', ')
+    let rows: FeatureCandidateRow[]
+    try {
+      countWork('sql:discover.feature-rows')
+      rows = ownDb
+        .prepare(
+          `SELECT StemCID, FeaturesJSON FROM StemFeatureCache WHERE StemCID IN (${placeholders})`
+        )
+        .all(...cidChunk) as FeatureCandidateRow[]
+    } catch {
+      continue
+    }
+    countWork('parse:stem-features', rows.length)
+    for (const row of rows) {
+      try {
+        featuresByStemCID.set(row.StemCID, JSON.parse(row.FeaturesJSON) as StemFeatures)
+      } catch {
+        // malformed row -- this stem just gets no values
+      }
+    }
+  }
+  return featuresByStemCID
+}
+
 /** Library-wide trait percentiles (docs/superpowers/specs/2026-09-22-
  * discover-promise-vs-delivery-design.md, Phase 1) for every candidate
  * that has trait values, from the cached quantile tables
@@ -1015,32 +1149,10 @@ function attachTraitValues(
     })
   }
 
-  const featuresByStemCID = new Map<string, StemFeatures>()
-  for (const cidChunk of chunk(
-    pool.map((c) => c.stemCID),
-    CANDIDATE_QUERY_CHUNK_SIZE
-  )) {
-    const placeholders = cidChunk.map(() => '?').join(', ')
-    let rows: FeatureCandidateRow[]
-    try {
-      countWork('sql:discover.feature-rows')
-      rows = ownDb
-        .prepare(
-          `SELECT StemCID, FeaturesJSON FROM StemFeatureCache WHERE StemCID IN (${placeholders})`
-        )
-        .all(...cidChunk) as FeatureCandidateRow[]
-    } catch {
-      continue
-    }
-    countWork('parse:stem-features', rows.length)
-    for (const row of rows) {
-      try {
-        featuresByStemCID.set(row.StemCID, JSON.parse(row.FeaturesJSON) as StemFeatures)
-      } catch {
-        // malformed row -- this stem just gets no trait values
-      }
-    }
-  }
+  const featuresByStemCID = featureRowsByStemCID(
+    ownDb,
+    pool.map((c) => c.stemCID)
+  )
   return pool.map((c) => {
     const features = featuresByStemCID.get(c.stemCID)
     return features
```

  `src/main/discoverAdjacency.ts` (dig's near pool):

```diff
--- a/src/main/discoverAdjacency.ts
+++ b/src/main/discoverAdjacency.ts
@@ -1,5 +1,6 @@
 // src/main/discoverAdjacency.ts
 import { basename } from 'node:path'
+import type Database from 'better-sqlite3'
 import { instrumentMaskToSoundType, type DiscoverSoundSourceFilter } from '@shared/riffLibraryTypes'
 import type { SoundType } from '@shared/types'
 import type { ArrangeRole } from '@shared/stemRole'
@@ -31,6 +32,7 @@ import { openOwnRiffLibraryDb } from './riffLibrarySchema'
 import { loadUnavailableStemCIDs } from './stemUnavailableStore'
 import { stemIsUsable } from '@shared/stemAvailability'
 import {
+  attachDiscoverIntensity,
   attachDiscoverTraits,
   getRiffIndexForDb,
   type DiscoverCandidate
@@ -128,6 +130,9 @@ export interface AdjacentDiscoverOptions {
    * own trait kinds plus these, so the trait bar, the ranking's trait terms, fold's clash and
    * dig's closeness read them. Absent: traitPercentiles stays {} (today's). */
   percentileTraits?: readonly DiscoverTraitKind[]
+  /** The radio's intensity arc (spec 2026-10-05 2.2): attach each candidate's intensity score
+   * (attachDiscoverIntensity), so dig's near pool is leaned like getDiscoverCandidates' own. */
+  intensity?: boolean
 }
 
 /** A DiscoverCandidate plus its own already-resolved local file path --
@@ -306,7 +311,24 @@ export async function getAdjacentDiscoverCandidates(
     )
   }
 
-  const percentileTraits = options.percentileTraits
+  const traited = await attachAdjacentTraits(ownDb, result, traitKinds, options.percentileTraits)
+  if (options.intensity !== true) return traited
+  const withIntensity = async (
+    list: AdjacentDiscoverCandidate[]
+  ): Promise<AdjacentDiscoverCandidate[]> => {
+    const attached = await attachDiscoverIntensity(ownDb, list)
+    return list.map((c, i) => ({ ...c, intensity: attached[i].intensity ?? null }))
+  }
+  return { newer: await withIntensity(traited.newer), older: await withIntensity(traited.older) }
+}
+
+/** Trait values and percentiles for `percentileTraits` (plus the slot's own) on both directions. */
+async function attachAdjacentTraits(
+  ownDb: Database.Database,
+  result: { newer: AdjacentDiscoverCandidate[]; older: AdjacentDiscoverCandidate[] },
+  traitKinds: readonly DiscoverTraitKind[],
+  percentileTraits: readonly DiscoverTraitKind[] | undefined
+): Promise<{ newer: AdjacentDiscoverCandidate[]; older: AdjacentDiscoverCandidate[] }> {
   if (percentileTraits === undefined) return result
   const valueKinds = [...traitKinds, ...percentileTraits.filter((k) => !traitKinds.includes(k))]
   if (valueKinds.length === 0) return result
```

  `src/main/index.ts` and `src/preload/index.ts` (the IPC parameter, after `onlyStemCIDs`):

```diff
--- a/src/main/index.ts
+++ b/src/main/index.ts
@@ -1392,7 +1392,8 @@ app.whenReady().then(async () => {
       soundSource?: DiscoverSoundSourceFilter,
       artist?: string,
       alsoTraits?: DiscoverTraitKind[],
-      onlyStemCIDs?: string[]
+      onlyStemCIDs?: string[],
+      alsoIntensity?: boolean
     ): Promise<DiscoverCandidate[]> => {
       // TEMPORARY diagnostic log (2026-09-15) -- a live report of rolling
       // staying stuck with no console errors made it impossible to tell,
@@ -1426,7 +1427,9 @@ app.whenReady().then(async () => {
         // Fold mode's clash (radioClash): the renderer only ever sends 'rhythmic' and 'bright'.
         alsoTraits: (Array.isArray(alsoTraits) ? alsoTraits : []).filter(
           (k) => k === 'rhythmic' || k === 'bright'
-        )
+        ),
+        // The radio's intensity arc (@shared/radioIntensity): only an explicit true attaches it.
+        alsoIntensity: alsoIntensity === true
       })
       console.log(
         `get-discover-candidates(${kinds.join('+')}): getDiscoverCandidates -- ${result.length} candidates in ${Date.now() - t1}ms`
```

```diff
--- a/src/preload/index.ts
+++ b/src/preload/index.ts
@@ -370,7 +370,9 @@ const api = {
     /** Radio fold mode's clash: trait percentiles to attach on top of the slot's own. */
     alsoTraits?: DiscoverTraitKind[],
     /** The faves dial's favourites-only draw: only these stems, before the sample. */
-    onlyStemCIDs?: string[]
+    onlyStemCIDs?: string[],
+    /** The radio's intensity arc: attach each candidate's intensity score. */
+    alsoIntensity?: boolean
   ): Promise<DiscoverCandidate[]> =>
     ipcRenderer.invoke(
       'get-discover-candidates',
@@ -380,7 +382,8 @@ const api = {
       soundSource,
       artist,
       alsoTraits,
-      onlyStemCIDs
+      onlyStemCIDs,
+      alsoIntensity
     ),
   getRandomDiscoverCandidate: (
     kinds: DiscoverSlotKind[],
```

- [ ] **Step 4: Verify, commit.**
  - Run `npx vitest run src/main/traitQuantileCache.test.ts src/main/discoverCandidates.test.ts src/main/discoverAdjacency.test.ts src/main/stemAnalysisResultsWriter.test.ts`
    and `npm run typecheck`.
  - Message:
    `discover: the radio's intensity score on every candidate when asked (spec 2026-10-05-radio-intensity-arc-design 2.2) -- getDiscoverCandidates' alsoIntensity (the IPC's last parameter) and dig's near pool (discoverAdjacency's intensity option) attach stemIntensityScore from the in-memory value table (now every QUANTILE_FIELD: the level pass's three columns too) or ownDb's rows, and the cached quantile tables (built over every QUANTILE_FIELD; the level fields' once 200 rows carry them). Absent: nothing attached, the payload as before`,
    then the trailer.

### Task 10: Desktop panel: the arc

**Repo:** sssketch. **File:** `src/renderer/src/components/DiscoverPanel.tsx`.
**Depends on:** Tasks 3, 4, 5, 9. **Parallel with:** Tasks 7-8.

**`intensityOn`** = `radioDensityOf(radioSettings) === 'intensity'`. Gate every change below on
it. The desktop's settings are normalized, so `energy` and `drama` are always set
(`radioEnergyOf` / `radioDramaOf`). The desktop default stays `arc`.

- [ ] **Step 1: Refs.**
  - Beside `densityLegRef` (:2941):

```ts
  /** The intensity arc (@shared/radioIntensityArc): null unless radio runs with density intensity. */
  const intensityArcRef = useRef<RadioIntensityArc | null>(null)
  /** The breakdown's carry row, picked and warmed when prepared. */
  const intensityCarryRef = useRef<{ pick: SlotPick; stem: ResolvedCandidateStem | null } | null>(null)
  /** Fresh picks for the drop's returning drums and bass rows (rowId -> warm pick). */
  const intensityRenewRef = useRef(new Map<string, { pick: SlotPick; stem: ResolvedCandidateStem | null }>())
```

  - `radioRestingRef` (:3083) becomes `useRef(new Map<string, 'hook' | 'arc'>())`. Its readers:
    - `.has` stays;
    - `.add(id)` becomes `.set(id, 'hook')` (:6940);
    - `.delete` stays;
    - `[...radioRestingRef.current]` becomes `[...radioRestingRef.current.keys()]` (:4965, :10463);
    - the sweep at :4965-4973 (ending rests no hook backs) skips `'arc'` entries.
  - `resetDensityArc` (:10053) also resets the three new refs.
  - `stopRadio` (:10446-10466) puts arc rests back too (its loop already joins every resting
    row).
  - `startRadio` (:10553), under `intensityOn`:
    `intensityArcRef.current = radioIntensityStarted({ energy, drama, min: DENSITY_MIN, max: DENSITY_MAX, count: DENSITY_MIN, random: Math.random })`.
    The bed starts at `DENSITY_MIN`, as the arc's does.

- [ ] **Step 2: The arc at the wrap.**
  - `densityTick` (:10069) runs under `arc` OR `intensity`. In its microtask, under `intensity`
    call `intensityAtWrap(loopBars, lapStarts)` instead of `densityAtWrap`. It sits before the
    hook step (:6647) in the clock effect's order, as the density arc does (timing risk 1).
  - `intensityAtWrap`:
    1. **A lap early** (`radioWrapBeforeLastLap(lap, laps)`, the density arc's `queueHeldArcAdd`
       rule): when `radioIntensityAddComing(arc, slotsRef.current.length)`, call
       `void arcAddRow(nextArcKind(kinds)!, true)`. It is held and warmed (`arcAddingRef.held`).
    2. **The step**, with `rows` from `slotsRef.current`:
       - `score`: the slot's candidate's `intensity` (Step 5 attaches it), else null;
       - `staleness`: the slot's turns, as `arcRemovalCandidate` (:10148) computes;
       - `sounding`: `previewingSlotIdsRef.current.has(id) && !radioRestingRef.current.has(id)`;
       - `restable`: unlocked (padlock), not soloed or outside a solo, not user-muted, no
         `manualChangesRef` entry, not resting, not a decided hook rest.

       The other inputs:
       - `canAdd`: `arcAddingRef.current?.held !== undefined && arcAddingRef.current.warm === true`;
       - `canStrip`: `arcRemovalCandidate() !== null`;
       - `carryReady`: `intensityCarryRef.current?.stem != null`;
       - `renewReady`: `(id) => intensityRenewRef.current.get(id)?.stem != null`;
       - `random: Math.random`;
       - `held: false` (the desktop's clock stops on pause: timing risk 5).
    3. **prepare:**
       - `carry`: `pickForSlot(newId, [radioCarryKind(kinds)], { yieldRow: true, intensity: τ })`,
         then `resolveAndWarmPick`, stored in `intensityCarryRef`;
       - each `renew` id: `pickForSlot(id, slot.kinds, { avoidOwnStem: true, yieldRow: true, intensity: { target: hi, drama: 100 } })`,
         then `resolveAndWarmPick`, stored in `intensityRenewRef`.
    4. **decided:**
       - `cycle` + `strip`: `arcExitRef.current = { slotId: arcRemovalCandidate(), phase: 'waiting', lap }`
         (the density arc's removal path, :10125-10130);
       - `add`: `queueHeldArcAdd()` (:10246);
       - `breakdown`:
         - for each `rest` id: `queueManualChange(id, ownPick, false, seq, true, null, { arc: 'rest', rest: true, stem })`.
           `queueManualChange`'s `opts` (:9690) gains `arc?: 'rest' | 'return'`; an arc landing
           is treated as a hook landing everywhere one is (never a manual change, never clears a
           hook);
         - the first drums row's throw: `armDiscoverExitThrow` with `decided.throw`, as the hook
           exit does (:5092-5104), when throws are on;
         - a `carry`: `arcAddRow` with the carry pick, arriving with a bloom (`densityArrival`);
       - `drop`: for each `returning` id still resting for the arc:
         `queueManualChange(id, renewed ? renewPick : ownPick, true, seq, true, { kind: 'cut', beats: 0 }, { arc: 'return', stem })`.
         It joins at the top (the hook return's joining path, :6957);
       - log `[radio-intensity] …` for each, as the web does.
    5. **At the line** (the landing loop, :6928-6957): a `change.arc === 'rest'` is handled as
       `change.rest`:
       - `radioRestingRef.current.set(slotId, 'arc')`, then `dropFromPreviewingMix`;
       - the "last row in the mix" guard (:6929-6937) withdraws it with
         `releaseRadioIntensityRest` instead of the hook's withdraw;
       - `change.arc === 'return'` deletes the rest (as :6957 does for hooks).
  - **By hand:** `radioRestReturnsByHand` (:4811) checks the owner. An `'arc'` rest calls
    `intensityArcRef.current = releaseRadioIntensityRest(arc, id)`, deletes the rest and joins the
    row. A removed or locked row releases too (`removeSlot`, the padlock toggle).

- [ ] **Step 3: Hooks, fold, the roll, the turn.**
  - The hook step (`stepRadioHooks` at :4984):
    - spread `radioIntensityHookInputs(arc)`;
    - give each row `arcResting` (`radioRestingRef.current.get(id) === 'arc'` or in a decided
      breakdown's `rest`);
    - `arcThinning` stays `arc`-only (:5017-5021).
  - The fold step (:5171-5175): `fold` becomes `radioIntensityBend(radioSettings.fold, drama, target)`.
  - `turnaroundInputNow` (:3852-3855): `arc` becomes `radioIntensityTurnaroundArc(arc)` under
    intensity. `discoverTurnaroundRows` gets the decided breakdown's rows as `exiting`.
  - `radioForecastNow` (:3959): set `arcRole: radioIntensityArcRole(arc)`. A decided drop's
    resting low rows count as rows, with `lowEndReturn`.
  - `rollRadioTurnaround` (:3709-3820): pass `drop` when `arcRole === 'drop'`.
  - `radioTurnTick` (:4477): a turn on the drop's top merges (as Task 7 Step 7).

- [ ] **Step 4: The buttons and the readout.**
  - `intensityPress(action)`:
    - `pressRadioIntensity(arc, action, { lap, phraseLaps, late })`. `late` is the turn's rule
      (`turnaroundTurnBeats(...) === null` at the panel's lead).
    - A decided drop arms a turn (`radioTurnPendingRef`, :3193) with `move: 'riser'` (in a
      breakdown) or `'low drop'` (quick, `maxBeats` ≤ 8), plus a `drop` flag that
      `rollRadioTurnaround`'s turn branch turns into `drop: { gapChance }` and `payoff: 'large'`.
    - A decided `cycle` sets `arcExitRef` for the coming top.
  - State for the strip: `radioArcShown` (`{ phase, build, drop, canBuild, canDrop }`), refreshed
    when the arc changes.
  - `radioReadoutFrom` (:5635), under intensity: `arc` becomes
    `radioReadoutIntensityArc(arc, rows.length, radioIntensityDropInBars(arc, { lap, phraseLaps, loopBars, pos }))`.
    `nextChange` gets `drop` and `rests` as on the web.
  - Flashes (`radioFlashTick` :5570): `breakdown` / `drop` / `build` on their rows at their tops,
    keyed by the landing.
  - Row role words: `rests till the drop` on an arc-resting row.

- [ ] **Step 5: Picks lean, and the throws.**
  - `pickForSlot` (:8770) gains an option `intensity?: { target: number; drama: number }`.
    Default: while radio runs under intensity,
    `{ target: radioIntensityTarget(arc, e, d), drama: d }`.
  - Its fetches (:8858-8879) pass `alsoIntensity` (the new last argument of
    `getDiscoverCandidates`). Dig's near fetch passes `intensity: true` in its options.
  - After `applyTraitBar` (:9000), call `applyIntensityBand(pool, { target, kinds, drama, random: Math.random })`.
    Log a back-off.
  - `rankCandidates` (:9001) gets `intensity: radioIntensityRankOf(target, kinds, drama)`.
  - Throws: `radioThrowTick` (:5494) passes `dropInBars` in the breakdown's last phrase.

- [ ] **Step 6: Verify, commit.**
  - Run `npm run typecheck`, `npx eslint src/renderer/src/components/DiscoverPanel.tsx`,
    `npx vitest run src/shared`.
  - The panel glue has no tests, by convention. Say so, and that no agent heard it.
  - Message:
    `discover radio: the intensity arc (spec 2026-10-05-radio-intensity-arc-design) -- density intensity runs @shared's machine where the density arc ran: adds warmed a lap early and landed on phrase starts, the strip-back, the breakdown resting drums and bass through the hook rest's path (radioRestingRef with an owner; his rows rest too, unlocked ones; a carry row when nothing melodic plays; the first drums row's echo throw), the drop bringing them back (own stems or renewals warmed a phrase ahead) under a riser at its longest and a gap from drama 50; arcRole on the forecast, the arc's turnaround arc, exiting rows; hooks pulled to the drop and held through the breakdown; fold's bend by the target; picks leaned (alsoIntensity, the band, the term); throws into the drop; the readout's phases and flashes; a hand-unmuted resting row plays at once and leaves the arc. No panel tests (convention); unheard by any agent`,
    then the trailer.

### Task 11: Desktop strip and phone: build, drop, the dials

**Repo:** sssketch. **Depends on:** Task 10.

**Files:**
- `src/renderer/src/components/RadioStrip.tsx`
- `src/main/remoteServer.ts` (+ test)
- `src/main/remotePage.ts` (+ test)
- `DiscoverPanel.tsx` (wiring)

- [ ] **Step 1: The live bar.**
  - `RadioLiveBar` (:292), in the `fire now` field after the turn button (:448-455): two
    `FireButton`s, `build` and `drop`.
  - Labels come from the panel's `radioArcShown` (`building` / `dropping` while waiting).
  - `held` while waiting; `disabled` from `byId('build')?.disabled` (the strip model greys them
    with density not intensity); `notNow` when `can*` is false.
  - Tooltips are `byId(...).tooltip`.
  - `RadioStripProps` gains `arc: { shown, onPress }`.
  - The energy and drama dials are `slider` controls, drawn by `RadioShapingColumns`' generic
    case (:527-540) and patched through `onSettingsChange`. Its `defaultValue` (the double-click
    reset) is `c.id === 'bend' ? fold : clash` today. Make it a map by id: `bend` →
    `DEFAULT_RADIO_SETTINGS.fold`, `mismatch` → `.clash`, `energy` → `DEFAULT_RADIO_ENERGY`,
    `drama` → `DEFAULT_RADIO_DRAMA`.
- [ ] **Step 2: The phone.**
  - `remoteServer.ts`: `POST /api/arc` beside `/api/turn` (:437-447):
    - `parseRemoteArcAction((await readJsonBody(req)).action)`; null gives 400;
    - `remoteArcAnswer(options.getState().arc, action)`; on `building` / `dropping`,
      `options.onCommand({ kind: 'arc', action })`;
    - respond with the answer;
    - update the route count comment (:232).
  - `remoteServer.test.ts`: the route's 400, `radio off`, `not now`, and the forwarded command.
  - `remotePage.ts`:
    - beside the turn section (:2518-2552), `build` and `drop` buttons, shown only while
      `state.arc` is non-null, painted from `arc.waiting`;
    - the press's answer is flashed as the turn's is;
    - the row's role words carry `rests` (the short form).
  - `remotePage.test.ts`: the buttons' presence follows `arc`, and the words fit at 320 px.
  - `DiscoverPanel.tsx`:
    - `radioArcRemote` (beside `radioTurnRemote` :7852-7865) goes into `remoteStateFromSlots`'
      meta (:7911-7925) as `arc` while intensity runs;
    - `remoteCommandRef` (:8040) handles `arc` (→ `intensityPress`).
- [ ] **Step 3: Verify, commit.**
  - Run `npm run typecheck`, `npx vitest run src/main/remoteServer.test.ts src/main/remotePage.test.ts src/shared`,
    `npx eslint` on the touched files.
  - Message:
    `discover radio: build and drop on the strip and the phone (spec 2026-10-05-radio-intensity-arc-design 6) -- two fire-now buttons after turn (building/dropping while waiting, greyed with density not intensity, not now when they cannot act), energy and drama in the picks column; POST /api/arc and the phone's two buttons while intensity runs. No panel tests (convention); unseen by any agent at a real screen or phone`,
    then the trailer.

**Ship point B.** Elling switches the desktop to `intensity` (walkthrough items 1-9 on the
desktop).

---

## Phase 3: loudness

### Task 12: The level measurement (`stemLevel.ts`, the feature row's fields)

**Parallel-safe** (start it first). **Depends on:** nothing.

**Files:**
- Create: `src/shared/stemLevel.ts`, `stemLevel.test.ts`, `stemLevelFields.test.ts`
- Modify: `src/shared/stemFeatures.ts`, `stemAnalysis.ts`, `stemAnalysisNeeds.ts`,
  `stemAnalysisWrite.ts`

**Inert until Task 13:** no caller passes the other channels yet, so `analyzeStemSamples` and
`assembleStemFeatures` return exactly today's objects. `needsAnyAnalysis` reads `level` only when
main sends it.

- [ ] **Step 1: The failing tests.** Create `src/shared/stemLevel.test.ts`:

```ts
// The loudness measurement (spec 2026-10-05-radio-intensity-arc-design section 7): stemLevel.ts.
import { describe, expect, it } from 'vitest'
import { kWeightingHighPass, kWeightingShelf, stemLevelFeatures, type Biquad } from './stemLevel'

/** A sine of `seconds` at `hz`, peak `dbfs`, at `fs`. */
function sine(hz: number, dbfs: number, seconds: number, fs: number): Float32Array {
  const a = Math.pow(10, dbfs / 20)
  const out = new Float32Array(Math.round(seconds * fs))
  for (let i = 0; i < out.length; i++) out[i] = a * Math.sin((2 * Math.PI * hz * i) / fs)
  return out
}

const close = (b: Biquad, want: number[]): void => {
  const got = [b.b0, b.b1, b.b2, b.a1, b.a2]
  got.forEach((v, i) => expect(v).toBeCloseTo(want[i], 8))
}

describe('K-weighting', () => {
  it("matches BS.1770's 48 kHz table", () => {
    close(
      kWeightingShelf(48000),
      [1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585]
    )
    close(kWeightingHighPass(48000), [1, -2, 1, -1.99004745483398, 0.99007225036621])
  })
})

describe('stemLevelFeatures', () => {
  it('a 997 Hz sine at -20 dBFS: mono -23.0 LUFS, identical stereo -20.0', () => {
    const s = sine(997, -20, 10, 48000)
    expect(stemLevelFeatures([s], 48000).loudnessLufs).toBeCloseTo(-23.0, 1)
    expect(stemLevelFeatures([s, s.slice()], 48000).loudnessLufs).toBeCloseTo(-20.0, 1)
  })

  it('EBU Tech 3341 cases 1 and 2 (stereo 1 kHz at -23 and -33 dBFS)', () => {
    for (const db of [-23, -33]) {
      const s = sine(1000, db, 20, 48000)
      const l = stemLevelFeatures([s, s.slice()], 48000).loudnessLufs!
      expect(Math.abs(l - db)).toBeLessThanOrEqual(0.1)
    }
  })

  it('reads the same at 44.1 and 48 kHz', () => {
    for (const hz of [60, 997, 6000]) {
      const a = stemLevelFeatures([sine(hz, -18, 8, 44100)], 44100).loudnessLufs!
      const b = stemLevelFeatures([sine(hz, -18, 8, 48000)], 48000).loudnessLufs!
      expect(Math.abs(a - b), `${hz} Hz`).toBeLessThanOrEqual(0.1)
    }
  })

  it('gates silence: half the stem silent keeps the loudness, and about half is active', () => {
    const fs = 48000
    const tone = sine(997, -20, 10, fs)
    const half = new Float32Array(tone.length * 2)
    half.set(tone, 0)
    const full = stemLevelFeatures([tone], fs)
    const halved = stemLevelFeatures([half], fs)
    expect(Math.abs(halved.loudnessLufs! - full.loudnessLufs!)).toBeLessThanOrEqual(0.1)
    expect(full.activeFraction).toBe(1)
    expect(halved.activeFraction).toBeGreaterThan(0.45)
    expect(halved.activeFraction).toBeLessThan(0.55)
  })

  it('lowLevelDb: a 50 Hz sine sits 30 dB or more above a 5 kHz one at the same level', () => {
    const lo = stemLevelFeatures([sine(50, -12, 6, 48000)], 48000).lowLevelDb!
    const hi = stemLevelFeatures([sine(5000, -12, 6, 48000)], 48000).lowLevelDb!
    expect(lo - hi).toBeGreaterThanOrEqual(30)
    // a full-scale-ish 50 Hz sine at -12 dBFS peak: mean square a^2/2 -> -15.0 dBFS
    expect(lo).toBeCloseTo(-15.0, 0)
  })

  it('lowLevelDb is a level, not a balance: a sparse kick reads under a rolling one', () => {
    const fs = 48000
    const rolling = sine(55, -12, 4, fs)
    const sparse = new Float32Array(rolling.length)
    for (let i = 0; i < sparse.length; i++) if (i % fs < fs / 8) sparse[i] = rolling[i]
    const a = stemLevelFeatures([rolling], fs).lowLevelDb!
    const b = stemLevelFeatures([sparse], fs).lowLevelDb!
    expect(a - b).toBeGreaterThan(6)
  })

  it('silence, and nothing at all, give nulls', () => {
    const quiet = stemLevelFeatures([new Float32Array(48000 * 4)], 48000)
    expect(quiet).toEqual({ loudnessLufs: null, lowLevelDb: null, activeFraction: 0 })
    expect(stemLevelFeatures([], 48000)).toEqual({
      loudnessLufs: null,
      lowLevelDb: null,
      activeFraction: 0
    })
  })

  it('a stem shorter than a block still reads', () => {
    const r = stemLevelFeatures([sine(997, -20, 0.25, 48000)], 48000)
    expect(r.loudnessLufs).toBeCloseTo(-23.0, 0)
    expect(r.activeFraction).toBe(1)
  })
})
```

  Create `src/shared/stemLevelFields.test.ts`:

```ts
// The level pass in the feature row (spec 2026-10-05-radio-intensity-arc-design section 7.2-7.3):
// stemAnalysis.ts's extraChannels, stemFeatures.ts's levelVersion, stemAnalysisNeeds' `level`.
import { describe, expect, it } from 'vitest'
import { analyzeStemSamples, assembleStemFeatures } from './stemAnalysis'
import { stemLevelVersionOf, toFeatureArray, STEM_FEATURE_VERSION } from './stemFeatures'
import { ALL_STEM_ANALYSIS_NEEDS, needsAnyAnalysis } from './stemAnalysisNeeds'
import { STEM_LEVEL_VERSION } from './stemLevel'

const fs = 22050
const tone = (hz: number, a: number): Float32Array => {
  const out = new Float32Array(fs * 2)
  for (let i = 0; i < out.length; i++) out[i] = a * Math.sin((2 * Math.PI * hz * i) / fs)
  return out
}

describe('the level pass in the analysis', () => {
  it('runs only when the other channels are handed over, and reads them all', () => {
    const left = tone(220, 0.3)
    expect(analyzeStemSamples(left, fs).level).toBeUndefined()
    const mono = analyzeStemSamples(left, fs, []).level!
    const stereo = analyzeStemSamples(left, fs, [left.slice()]).level!
    expect(stereo.loudnessLufs! - mono.loudnessLufs!).toBeCloseTo(3.01, 1)
  })

  it('leaves every other field exactly as it was', () => {
    const left = tone(220, 0.3)
    const without = { ...analyzeStemSamples(left, fs, [tone(330, 0.1)]) }
    delete without.level
    expect(without).toEqual(analyzeStemSamples(left, fs))
  })

  it('stamps levelVersion on a fresh row, and stays out of toFeatureArray', () => {
    const a = analyzeStemSamples(tone(220, 0.3), fs, [])
    const f = assembleStemFeatures(a, [0.5])
    expect(f.featureVersion).toBe(STEM_FEATURE_VERSION)
    expect(f.levelVersion).toBe(STEM_LEVEL_VERSION)
    expect(typeof f.loudnessLufs).toBe('number')
    expect(stemLevelVersionOf(f)).toBe(STEM_LEVEL_VERSION)
    const rest = { ...f }
    delete rest.loudnessLufs
    delete rest.lowLevelDb
    delete rest.activeFraction
    delete rest.levelVersion
    expect(toFeatureArray(f)).toEqual(toFeatureArray(rest))
    expect(stemLevelVersionOf(rest)).toBe(0)
    const plain = assembleStemFeatures(analyzeStemSamples(tone(220, 0.3), fs), [0.5])
    expect('levelVersion' in plain).toBe(false)
  })
})

describe('the level need', () => {
  it('counts as work, and a fresh extraction asks for none', () => {
    expect(ALL_STEM_ANALYSIS_NEEDS.level).toBe(false)
    const none = { peaks: false, features: false, embedding: false, zeroShot: false }
    expect(needsAnyAnalysis(none)).toBe(false)
    expect(needsAnyAnalysis({ ...none, level: true })).toBe(true)
  })
})
```

  - Run `npx vitest run src/shared/stemLevel.test.ts src/shared/stemLevelFields.test.ts`.
    **Expected:** FAIL.

- [ ] **Step 2: The measurement.** Create `src/shared/stemLevel.ts`:

```ts
// src/shared/stemLevel.ts
//
// THE LOUDNESS MEASUREMENT (spec 2026-10-05-radio-intensity-arc-design section 7): three numbers
// per stem from ALL channels of the buffer the analysis already decoded -- the radio's intensity
// score (radioIntensity.ts) reads them as library percentiles. Pure, no allocation beyond one
// block-power array; runs in the analysis worker (stemAnalysisWorker.ts).
//
// - loudnessLufs: integrated loudness, ITU-R BS.1770-4 (as EBU R 128 uses it): K-weighting (the
//   pre-filter shelf and the RLB high-pass, designed for the buffer's own sample rate by the
//   bilinear transform, so 44.1 and 48 kHz agree), 400 ms blocks every 100 ms, channel energies
//   summed (weight 1 each), an absolute gate at -70 LUFS and a relative gate 10 LU under the
//   absolute-gated loudness. Null when no block passes (silence).
// - lowLevelDb: the level under ~150 Hz in dBFS -- the mean square over the whole stem, ungated,
//   after a 2nd-order Butterworth low-pass, averaged over the channels (an identical-channel
//   stereo stem reads as its mono). How much low end a loop puts down over its length: a sparse
//   kick weighs less than a rolling bassline. Null for silence.
// - activeFraction: the share of the 100 ms hops whose block is within ACTIVE_WINDOW_LU of
//   loudnessLufs and above the absolute gate. How much of the loop sounds. In [0, 1]; 0 for
//   silence.

/** The level pass's version, stored as StemFeatures.levelVersion. Bump to re-measure every stem
 * (the backfill re-runs only this pass, on the one decode). */
export const STEM_LEVEL_VERSION = 1

export interface StemLevel {
  loudnessLufs: number | null
  lowLevelDb: number | null
  activeFraction: number
}

/** BS.1770's block and hop, in seconds. */
export const LOUDNESS_BLOCK_SEC = 0.4
export const LOUDNESS_HOP_SEC = 0.1
export const LOUDNESS_ABSOLUTE_GATE = -70
export const LOUDNESS_RELATIVE_GATE_LU = -10
/** A hop is "active" when its block is within this many LU of the stem's loudness. */
export const ACTIVE_WINDOW_LU = 20
/** The low band's corner. */
export const LOW_LEVEL_CUTOFF_HZ = 150
/** Below this mean square (-140 dBFS) a stem has no low end to speak of: null. */
const SILENT_MEAN_SQUARE = 1e-14

export interface Biquad {
  b0: number
  b1: number
  b2: number
  a1: number
  a2: number
}

/** BS.1770's stage 1 (the head's high shelf), for `fs` -- the bilinear design libebur128 and
 * pyloudnorm use; at 48 kHz it is the standard's own table. */
export function kWeightingShelf(fs: number): Biquad {
  const f0 = 1681.974450955533
  const G = 3.999843853973347
  const Q = 0.7071752369554196
  const K = Math.tan((Math.PI * f0) / fs)
  const Vh = Math.pow(10, G / 20)
  const Vb = Math.pow(Vh, 0.4996667741545416)
  const a0 = 1 + K / Q + K * K
  return {
    b0: (Vh + (Vb * K) / Q + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0
  }
}

/** BS.1770's stage 2 (the RLB high-pass), for `fs`. */
export function kWeightingHighPass(fs: number): Biquad {
  const f0 = 38.13547087602444
  const Q = 0.5003270373238773
  const K = Math.tan((Math.PI * f0) / fs)
  const a0 = 1 + K / Q + K * K
  return {
    b0: 1,
    b1: -2,
    b2: 1,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0
  }
}

/** A 2nd-order Butterworth low-pass at `fc` (Q = 1/sqrt 2), by the bilinear transform. */
export function butterworthLowPass(fc: number, fs: number): Biquad {
  const K = Math.tan((Math.PI * Math.min(fc, fs * 0.49)) / fs)
  const Q = Math.SQRT1_2
  const a0 = 1 + K / Q + K * K
  return {
    b0: (K * K) / a0,
    b1: (2 * K * K) / a0,
    b2: (K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0
  }
}

/** Runs `x` through the biquads in series (direct form II transposed), returning the squared
 * output per sample through `sink`. */
function filterSquares(
  x: Float32Array,
  stages: readonly Biquad[],
  sink: (i: number, y2: number) => void
): void {
  const z1 = new Float64Array(stages.length)
  const z2 = new Float64Array(stages.length)
  for (let i = 0; i < x.length; i++) {
    let v = x[i]
    for (let s = 0; s < stages.length; s++) {
      const f = stages[s]
      const y = f.b0 * v + z1[s]
      z1[s] = f.b1 * v - f.a1 * y + z2[s]
      z2[s] = f.b2 * v - f.a2 * y
      v = y
    }
    sink(i, v * v)
  }
}

const lufsOf = (power: number): number => -0.691 + 10 * Math.log10(power)
const round = (v: number, places: number): number => {
  const k = Math.pow(10, places)
  return Math.round(v * k) / k
}

/** The three numbers for a decoded stem (`channels`: one Float32Array per channel, equal
 * lengths; a shorter one counts as silent past its end). Rounded to 0.01 dB and 0.001. */
export function stemLevelFeatures(
  channels: readonly Float32Array[],
  sampleRate: number
): StemLevel {
  const silent: StemLevel = { loudnessLufs: null, lowLevelDb: null, activeFraction: 0 }
  const n = channels.reduce((m, c) => Math.max(m, c.length), 0)
  if (channels.length === 0 || n === 0 || !(sampleRate > 0)) return silent

  // K-weighted energy per 100 ms hop, summed over channels (G = 1 each)
  const hop = Math.max(1, Math.round(LOUDNESS_HOP_SEC * sampleRate))
  const hops = Math.floor(n / hop)
  const hopEnergy = new Float64Array(Math.max(1, hops))
  const k = [kWeightingShelf(sampleRate), kWeightingHighPass(sampleRate)]
  const lp = [butterworthLowPass(LOW_LEVEL_CUTOFF_HZ, sampleRate)]
  let lowSum = 0
  for (const ch of channels) {
    filterSquares(ch, k, (i, y2) => {
      const h = Math.floor(i / hop)
      if (h < hops) hopEnergy[h] += y2
    })
    filterSquares(ch, lp, (_i, y2) => {
      lowSum += y2
    })
  }
  const lowMeanSquare = lowSum / (n * channels.length)
  const lowLevelDb =
    lowMeanSquare > SILENT_MEAN_SQUARE ? round(10 * Math.log10(lowMeanSquare), 2) : null

  // 400 ms blocks = 4 hops, every hop (75% overlap). A stem under one block is one short block.
  const perBlock = Math.round(LOUDNESS_BLOCK_SEC / LOUDNESS_HOP_SEC)
  const blockSamples = perBlock * hop
  const blocks: number[] = []
  if (hops >= perBlock) {
    let run = 0
    for (let h = 0; h < hops; h++) {
      run += hopEnergy[h]
      if (h >= perBlock) run -= hopEnergy[h - perBlock]
      if (h >= perBlock - 1) blocks.push(run / blockSamples)
    }
  } else if (hops > 0) {
    let run = 0
    for (let h = 0; h < hops; h++) run += hopEnergy[h]
    blocks.push(run / (hops * hop))
  }
  const absolute = blocks.filter((p) => p > 0 && lufsOf(p) > LOUDNESS_ABSOLUTE_GATE)
  if (absolute.length === 0) return { ...silent, lowLevelDb }
  const absMean = absolute.reduce((a, b) => a + b, 0) / absolute.length
  const relGate = lufsOf(absMean) + LOUDNESS_RELATIVE_GATE_LU
  const gated = absolute.filter((p) => lufsOf(p) > relGate)
  const power = gated.reduce((a, b) => a + b, 0) / gated.length
  const loudness = lufsOf(power)
  const active = blocks.filter((p) => {
    if (!(p > 0)) return false
    const l = lufsOf(p)
    return l > LOUDNESS_ABSOLUTE_GATE && l >= loudness - ACTIVE_WINDOW_LU
  }).length
  return {
    loudnessLufs: round(loudness, 2),
    lowLevelDb,
    activeFraction: round(active / blocks.length, 3)
  }
}
```

- [ ] **Step 3: The row's fields, the analysis, the need, the write.**
  - `src/shared/stemFeatures.ts`:

```diff
--- a/src/shared/stemFeatures.ts
+++ b/src/shared/stemFeatures.ts
@@ -38,6 +38,26 @@ export interface StemFeatures {
    * STEM_FEATURE_VERSION get re-extracted by the ambient background scans
    * (stemFeaturesCache.ts's requireCurrentVersion). */
   featureVersion?: number
+
+  // ---- the level pass (docs/superpowers/specs/2026-10-05-radio-intensity-arc-design.md
+  // section 7, stemLevel.ts), all optional: rows measured before it lack them, and the backfill
+  // adds them in place (levelVersion) without re-extracting anything else. NOT part of
+  // toFeatureArray, as for the Phase 3 fields. Null: silence.
+
+  /** Integrated loudness, BS.1770-4, from every channel. */
+  loudnessLufs?: number | null
+  /** The level under ~150 Hz, dBFS, ungated mean square (a level, not bassEnergyRatio's balance). */
+  lowLevelDb?: number | null
+  /** The share of 100 ms hops within 20 LU of the loudness, [0, 1]. */
+  activeFraction?: number
+  /** Which level pass measured this row (stemLevel.ts STEM_LEVEL_VERSION); absent: none yet. */
+  levelVersion?: number
+}
+
+/** A row's level-pass version: 0 when it has none. */
+export function stemLevelVersionOf(features: StemFeatures): number {
+  const v = features.levelVersion
+  return typeof v === 'number' && Number.isFinite(v) ? v : 0
 }
 
 /** Current StemFeatures extraction version. 2 = Phase 3 fields added
```

  - `src/shared/stemAnalysis.ts`:

```diff
--- a/src/shared/stemAnalysis.ts
+++ b/src/shared/stemAnalysis.ts
@@ -14,6 +14,7 @@ import { computeBandEnergy } from './bandEnergy'
 import { computePitchContour, voicedPitchFeatures, type PitchContour } from './pitchContour'
 import { computeMfccAndCentroid } from './mfcc'
 import { STEM_FEATURE_VERSION, type StemFeatures } from './stemFeatures'
+import { STEM_LEVEL_VERSION, stemLevelFeatures, type StemLevel } from './stemLevel'
 
 export interface StemAnalysis {
   /** Also handed to pitchCache.ts, so Waveform/PolarGlyph never need a
@@ -28,6 +29,9 @@ export interface StemAnalysis {
   spectralCentroidFftHz: number
   onsetRegularity: number
   rhythmicStrength: number
+  /** The level pass (stemLevel.ts), from every channel -- present when the caller handed the
+   * other channels over (`extraChannels`), so a fresh extraction measures both in one message. */
+  level?: StemLevel
 }
 
 // Geometric-mean center frequency of each of computeBandEnergy's own fixed
@@ -65,7 +69,13 @@ function spectralCentroidFromBandEnergy(
   return totalEnergy > 1e-10 ? weightedSum / totalEnergy : 0
 }
 
-export function analyzeStemSamples(samples: Float32Array, sampleRate: number): StemAnalysis {
+/** `extraChannels`: the buffer's channels after the first (`samples`), for the level pass. Absent:
+ * no level (the analysis is today's, channel 0 only). */
+export function analyzeStemSamples(
+  samples: Float32Array,
+  sampleRate: number,
+  extraChannels?: readonly Float32Array[]
+): StemAnalysis {
   const bandEnergy = computeBandEnergy(samples, sampleRate)
   // One onset pass feeds both transientDensity (identical to typeGuess.ts's
   // transientDensity -- onsets per second) and the regularity measure.
@@ -85,7 +95,22 @@ export function analyzeStemSamples(samples: Float32Array, sampleRate: number): S
     mfcc,
     spectralCentroidFftHz: fftCentroid,
     onsetRegularity: regularity,
-    rhythmicStrength: rhythmicStrength(density, regularity)
+    rhythmicStrength: rhythmicStrength(density, regularity),
+    ...(extraChannels !== undefined && {
+      level: stemLevelFeatures([samples, ...extraChannels], sampleRate)
+    })
+  }
+}
+
+/** A level as the fields a feature row stores, stamped with the pass's version. */
+export function stemLevelFields(
+  level: StemLevel
+): Required<Pick<StemFeatures, 'loudnessLufs' | 'lowLevelDb' | 'activeFraction' | 'levelVersion'>> {
+  return {
+    loudnessLufs: level.loudnessLufs,
+    lowLevelDb: level.lowLevelDb,
+    activeFraction: level.activeFraction,
+    levelVersion: STEM_LEVEL_VERSION
   }
 }
 
@@ -104,6 +129,7 @@ export function assembleStemFeatures(analysis: StemAnalysis, brightness: number[
     spectralCentroidFftHz: analysis.spectralCentroidFftHz,
     onsetRegularity: analysis.onsetRegularity,
     rhythmicStrength: analysis.rhythmicStrength,
-    featureVersion: STEM_FEATURE_VERSION
+    featureVersion: STEM_FEATURE_VERSION,
+    ...(analysis.level !== undefined && stemLevelFields(analysis.level))
   }
 }
```

  - `src/shared/stemAnalysisNeeds.ts`:

```diff
--- a/src/shared/stemAnalysisNeeds.ts
+++ b/src/shared/stemAnalysisNeeds.ts
@@ -10,21 +10,28 @@
  * (the embedding predates that code) and nothing else has classified or
  * confirmed it yet -- the set the old per-session retroactive scan walked.
  * Never true together with `embedding`: a fresh embedding extraction runs
- * the zero-shot step itself. */
+ * the zero-shot step itself.
+ *
+ * `level` (spec 2026-10-05-radio-intensity-arc-design section 7.3): the feature row is current
+ * but its level pass is older than STEM_LEVEL_VERSION (or missing) -- one decode, the level pass
+ * alone, merged into the row. Never true together with `features`: a fresh extraction measures
+ * the level itself. Optional so an older main's answer (none) reads as false. */
 export interface StemAnalysisNeeds {
   peaks: boolean
   features: boolean
   embedding: boolean
   zeroShot: boolean
+  level?: boolean
 }
 
 export const ALL_STEM_ANALYSIS_NEEDS: StemAnalysisNeeds = {
   peaks: true,
   features: true,
   embedding: true,
-  zeroShot: false
+  zeroShot: false,
+  level: false
 }
 
 export function needsAnyAnalysis(needs: StemAnalysisNeeds): boolean {
-  return needs.peaks || needs.features || needs.embedding || needs.zeroShot
+  return needs.peaks || needs.features || needs.embedding || needs.zeroShot || needs.level === true
 }
```

  - `src/shared/stemAnalysisWrite.ts`:

```diff
--- a/src/shared/stemAnalysisWrite.ts
+++ b/src/shared/stemAnalysisWrite.ts
@@ -1,13 +1,20 @@
 // src/shared/stemAnalysisWrite.ts
 import type { StemFeatures } from './stemFeatures'
 
+/** The level pass's fields, merged into an existing feature row (stemAnalysisResultsWriter's
+ * mergeStemFeatureLevel): never a whole row, never featureVersion. */
+export type StemLevelWrite = Required<
+  Pick<StemFeatures, 'loudnessLufs' | 'lowLevelDb' | 'activeFraction' | 'levelVersion'>
+>
+
 /** Everything an ambient-scan analysis of one stem persists, for the
  * batched set-stem-analysis-results IPC (background efficiency B7) --
  * each field optional, written exactly as its single-write IPC would:
  * peaks (set-stem-peaks-cache), features (set-stem-feature-cache),
  * embedding (set-stem-embedding-cache), zeroShotAttempted
  * (mark-yamnet-zeroshot-attempted), zeroShotClassIndex
- * (set-yamnet-zeroshot-category). Main applies them in that order. */
+ * (set-yamnet-zeroshot-category), then `level` (merged into the row the features field, or an
+ * earlier write, left). Main applies them in that order. */
 export interface StemAnalysisWrite {
   path: string
   peaks?: { peaks: number[]; brightness: number[] }
@@ -15,4 +22,5 @@ export interface StemAnalysisWrite {
   embedding?: number[]
   zeroShotAttempted?: boolean
   zeroShotClassIndex?: number
+  level?: StemLevelWrite
 }
```

- [ ] **Step 4: Verify, commit.**
  - Run `npx vitest run src/shared src/renderer/src/audio` and `npm run typecheck`.
  - Message:
    `analysis: the level pass (spec 2026-10-05-radio-intensity-arc-design section 7) -- stemLevelFeatures from every channel: integrated loudness by BS.1770-4 (K-weighting designed for the buffer's rate, 400 ms blocks every 100 ms, gates at -70 LUFS and -10 LU; a 997 Hz sine at -20 dBFS reads -23.0 mono, -20.0 stereo; EBU Tech 3341 cases 1-2; 44.1 and 48 kHz within 0.1 LU), lowLevelDb (an ungated 150 Hz Butterworth low-pass level, channels averaged), activeFraction (hops within 20 LU); StemFeatures' loudnessLufs, lowLevelDb, activeFraction and levelVersion (a sub-version: STEM_FEATURE_VERSION stays 2; not in toFeatureArray); analyzeStemSamples' extraChannels; the needs' optional level; the write's level. Inert: nothing passes the channels yet`,
    then the trailer.

### Task 13: The level pass on the one decode, and its backfill

**Repo:** sssketch. **Depends on:** Task 12.

**Files:**
- Modify: `src/renderer/src/audio/stemAnalysisWorker.ts`, `stemAnalysisClient.ts`,
  `stemFeaturesCache.ts`, `analyzeStemOnce.ts`; `src/main/stemAnalysisNeeds.ts` (+ test),
  `stemFeatureCacheStore.ts`, `stemAnalysisResultsWriter.ts` (+ test)
- Create: `src/renderer/src/audio/analyzeStemOnceLevel.test.ts`
- The main tests are already in the CI exclude list; the renderer test opens no database.

**The rule kept** (CLAUDE.md, the peakCache rule; spec §7.2):
- **one read and one decode per stem.** A stem needing only the level pass is decoded once, its
  channels go to the worker (copied, transferred), and nothing else is computed;
- a fresh extraction measures the level in the same `'full'` message;
- the backfill rides the two ambient scans that already exist, through `needsAnyAnalysis`, with
  no new scan:
  - `DiscoverLibraryScan` (the whole library) keeps its consent gate (`discoverConsented`);
  - `BackgroundFeatureScan` scans only placed stems.

- [ ] **Step 1: The failing tests.**
  - Create `src/renderer/src/audio/analyzeStemOnceLevel.test.ts`:

```ts
// The level pass on the one decode (spec 2026-10-05-radio-intensity-arc-design 7.2-7.3):
// analyzeStemOnce's needs.level, and a fresh extraction's level from every channel.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stemLevelFeatures } from '@shared/stemLevel'

const NONE = { peaks: false, features: false, embedding: false, zeroShot: false }

const n = 22050
const left = new Float32Array(n)
const right = new Float32Array(n)
for (let i = 0; i < n; i++) {
  left[i] = 0.4 * Math.sin((2 * Math.PI * 110 * i) / 44100)
  right[i] = 0.2 * Math.sin((2 * Math.PI * 330 * i) / 44100)
}
function stereo(): AudioBuffer {
  return {
    getChannelData: (c: number) => (c === 0 ? left : right),
    sampleRate: 44100,
    length: n,
    duration: n / 44100,
    numberOfChannels: 2
  } as unknown as AudioBuffer
}

describe('analyzeStemOnce: the level pass', () => {
  let api: Record<string, ReturnType<typeof vi.fn>>
  let decode: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules()
    decode = vi.fn().mockImplementation(async () => stereo())
    api = {
      readAudioFile: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3, 4])),
      getStemPeaksCache: vi.fn().mockResolvedValue(null),
      setStemPeaksCache: vi.fn().mockResolvedValue(undefined),
      getStemFeatureCache: vi.fn().mockResolvedValue(null),
      setStemFeatureCache: vi.fn().mockResolvedValue(undefined),
      setStemAnalysisResults: vi.fn().mockResolvedValue(undefined)
    }
    vi.stubGlobal('window', { rifffApi: api })
    vi.stubGlobal(
      'AudioContext',
      class {
        decodeAudioData = decode
      }
    )
  })

  afterEach(async () => {
    await (await import('./analysisWriteQueue')).flushStemAnalysisWrites()
    vi.unstubAllGlobals()
  })

  async function writes(): Promise<Record<string, unknown>[]> {
    await (await import('./analysisWriteQueue')).flushStemAnalysisWrites()
    return (api.setStemAnalysisResults.mock.calls as [Record<string, unknown>[]][]).flatMap(
      ([b]) => b
    )
  }

  it('level alone: one read, one decode, every channel measured, one `level` write', async () => {
    const { analyzeStemOnce } = await import('./analyzeStemOnce')
    const result = await analyzeStemOnce('/lib/cid-l', { ...NONE, level: true })
    expect(result).toEqual({
      peaks: 'skipped',
      features: 'skipped',
      embedding: 'skipped',
      zeroShot: 'skipped',
      level: 'done'
    })
    expect(api.readAudioFile).toHaveBeenCalledTimes(1)
    expect(decode).toHaveBeenCalledTimes(1)
    const want = stemLevelFeatures([left, right], 44100)
    expect(await writes()).toEqual([{ path: '/lib/cid-l', level: { ...want, levelVersion: 1 } }])
    expect(api.setStemFeatureCache).not.toHaveBeenCalled()
  })

  it('a fresh extraction carries the level in its feature row, from both channels', async () => {
    const { analyzeStemOnce } = await import('./analyzeStemOnce')
    const result = await analyzeStemOnce('/lib/cid-f', { ...NONE, features: true, level: true })
    expect(result.features).toBe('done')
    expect(result.level).toBe('skipped')
    expect(decode).toHaveBeenCalledTimes(1)
    const [w] = await writes()
    const want = stemLevelFeatures([left, right], 44100)
    expect(w.features).toMatchObject({ ...want, levelVersion: 1 })
    expect('level' in w).toBe(false)
  })

  it('no level asked: the result has no `level` (today, exactly)', async () => {
    const { analyzeStemOnce } = await import('./analyzeStemOnce')
    expect(await analyzeStemOnce('/lib/cid-n', { ...NONE, peaks: true })).toEqual({
      peaks: 'done',
      features: 'skipped',
      embedding: 'skipped',
      zeroShot: 'skipped'
    })
  })
})
```

  - `src/main/stemAnalysisNeeds.test.ts`:

```diff
--- a/src/main/stemAnalysisNeeds.test.ts
+++ b/src/main/stemAnalysisNeeds.test.ts
@@ -1,6 +1,7 @@
 import { describe, expect, it } from 'vitest'
 import Database from 'better-sqlite3'
 import { STEM_FEATURE_VERSION } from '@shared/stemFeatures'
+import { STEM_LEVEL_VERSION } from '@shared/stemLevel'
 import { getStemAnalysisNeeds } from './stemAnalysisNeeds'
 
 function freshDb(): Database.Database {
@@ -37,7 +38,12 @@ function addEmbedding(db: Database.Database, stemCID: string): void {
   db.prepare(`INSERT INTO StemEmbeddingCache VALUES (?, '[1]', 0)`).run(stemCID)
 }
 
-const current = JSON.stringify({ mfcc: [], featureVersion: STEM_FEATURE_VERSION })
+const current = JSON.stringify({
+  mfcc: [],
+  featureVersion: STEM_FEATURE_VERSION,
+  levelVersion: STEM_LEVEL_VERSION
+})
+const noLevel = JSON.stringify({ mfcc: [], featureVersion: STEM_FEATURE_VERSION })
 const v1 = JSON.stringify({ mfcc: [] })
 
 describe('getStemAnalysisNeeds', () => {
@@ -115,6 +121,32 @@ describe('getStemAnalysisNeeds', () => {
     expect(needs[5].embedding).toBe(true)
   })
 
+  it('asks for the level pass only on a current row without it (spec 2026-10-05 7.3)', async () => {
+    const db = freshDb()
+    addFeatures(db, 'done', current)
+    addFeatures(db, 'unlevelled', noLevel)
+    addFeatures(
+      db,
+      'old-level',
+      JSON.stringify({ mfcc: [], featureVersion: STEM_FEATURE_VERSION, levelVersion: 0 })
+    )
+    addFeatures(db, 'stale', v1)
+    const needs = await getStemAnalysisNeeds(db, [
+      '/lib/jam/done',
+      '/lib/jam/unlevelled',
+      '/lib/jam/old-level',
+      '/lib/jam/stale',
+      '/lib/jam/never'
+    ])
+    expect(needs.map((n) => [n.features, n.level ?? false])).toEqual([
+      [false, false],
+      [false, true],
+      [false, true],
+      [true, false],
+      [true, false]
+    ])
+  })
+
   it('returns an empty list for no paths without querying', async () => {
     expect(await getStemAnalysisNeeds(freshDb(), [])).toEqual([])
   })
```

  - `src/main/stemAnalysisResultsWriter.test.ts`:

```diff
--- a/src/main/stemAnalysisResultsWriter.test.ts
+++ b/src/main/stemAnalysisResultsWriter.test.ts
@@ -189,3 +189,56 @@ describe('writeStemAnalysisResults (B7)', () => {
     expect(db.prepare(`SELECT COUNT(*) AS n FROM StemEmbeddingCache`).get()).toEqual({ n: 30 })
   })
 })
+
+describe('the level backfill (spec 2026-10-05-radio-intensity-arc-design 7.3)', () => {
+  const LEVEL = { loudnessLufs: -14.2, lowLevelDb: -21.5, activeFraction: 0.9, levelVersion: 1 }
+
+  it('merges into the existing row, keeping every other field, featureVersion and ExtractedAt', async () => {
+    const db = freshDb()
+    addStem(db, 'cid-1')
+    await writeStemAnalysisResults(db, [{ path: '/lib/cid-1', features: features(3) }], 111)
+    const before = db.prepare(`SELECT * FROM StemFeatureCache`).get() as {
+      FeaturesJSON: string
+      ExtractedAt: number
+    }
+    await writeStemAnalysisResults(db, [{ path: '/lib/cid-1', level: LEVEL }], 222)
+    const after = db.prepare(`SELECT * FROM StemFeatureCache`).get() as {
+      FeaturesJSON: string
+      ExtractedAt: number
+    }
+    expect(after.ExtractedAt).toBe(111)
+    expect(JSON.parse(after.FeaturesJSON)).toEqual({ ...JSON.parse(before.FeaturesJSON), ...LEVEL })
+  })
+
+  it('writes nothing without a current row to merge into', async () => {
+    const db = freshDb()
+    addStem(db, 'cid-2')
+    addStem(db, 'cid-3')
+    db.prepare(`INSERT INTO StemFeatureCache VALUES ('cid-3', '{"mfcc":[]}', 5)`).run()
+    await writeStemAnalysisResults(
+      db,
+      [
+        { path: '/lib/cid-2', level: LEVEL },
+        { path: '/lib/cid-3', level: LEVEL }
+      ],
+      9
+    )
+    expect(db.prepare(`SELECT StemCID, FeaturesJSON FROM StemFeatureCache`).all()).toEqual([
+      { StemCID: 'cid-3', FeaturesJSON: '{"mfcc":[]}' }
+    ])
+  })
+
+  it('tells the value table, and does not wake the classifier', async () => {
+    const db = freshDb()
+    addStem(db, 'cid-4')
+    await writeStemAnalysisResults(db, [{ path: '/lib/cid-4', features: features(1) }], 1)
+    const noted = vi.spyOn(traitQuantileCache, 'noteStemFeatureRowWritten')
+    const woke = vi.spyOn(wake, 'noteAutoClassifyInputRow')
+    await writeStemAnalysisResults(db, [{ path: '/lib/cid-4', level: LEVEL }], 2)
+    expect(noted).toHaveBeenCalledTimes(1)
+    expect(noted.mock.calls[0][1]).toMatchObject(LEVEL)
+    expect(woke).not.toHaveBeenCalled()
+    noted.mockRestore()
+    woke.mockRestore()
+  })
+})
```

  - Run `npx vitest run src/renderer/src/audio/analyzeStemOnceLevel.test.ts src/main/stemAnalysisNeeds.test.ts src/main/stemAnalysisResultsWriter.test.ts`.
    **Expected:** FAIL.

- [ ] **Step 2: The worker and its client.**
  - `stemAnalysisWorker.ts`:

```diff
--- a/src/renderer/src/audio/stemAnalysisWorker.ts
+++ b/src/renderer/src/audio/stemAnalysisWorker.ts
@@ -7,31 +7,39 @@
 // from stemAnalysisClient.ts; never decodes audio itself.
 //
 // Message protocol (plain structured-clone objects):
-//   In:  { requestId, kind: 'full' | 'pitch', samples: Float32Array, sampleRate }
-//   Out: { type: 'result', requestId, payload: StemAnalysis | PitchContour }
+//   In:  { requestId, kind: 'full' | 'pitch' | 'level', samples: Float32Array, sampleRate,
+//          extraChannels?: Float32Array[] }  -- the buffer's other channels, for the level pass
+//   Out: { type: 'result', requestId, payload: StemAnalysis | PitchContour | StemLevel }
 //        { type: 'error', requestId, message: string }
 // Relative import (not the @shared alias) -- a worker is bundled as its own
 // entry, and a relative path can't depend on alias config reaching it.
 import { analyzeStemSamples } from '../../../shared/stemAnalysis'
 import { computePitchContour } from '../../../shared/pitchContour'
+import { stemLevelFeatures } from '../../../shared/stemLevel'
 
 interface InMessage {
   requestId: number
-  kind: 'full' | 'pitch'
+  kind: 'full' | 'pitch' | 'level'
   samples: Float32Array
   sampleRate: number
+  /** Channels after the first (spec 2026-10-05-radio-intensity-arc-design 7.2): 'full' measures
+   * the level too when present; 'level' measures only that. */
+  extraChannels?: Float32Array[]
 }
 
 self.onmessage = (event: MessageEvent<InMessage>) => {
-  const { requestId, kind, samples, sampleRate } = event.data
+  const { requestId, kind, samples, sampleRate, extraChannels } = event.data
   try {
     // Transfer, not copy -- the contour's backing buffer is freshly
     // allocated here and never read again on this side.
-    if (kind === 'pitch') {
+    if (kind === 'level') {
+      const level = stemLevelFeatures([samples, ...(extraChannels ?? [])], sampleRate)
+      postMessage({ type: 'result', requestId, payload: level })
+    } else if (kind === 'pitch') {
       const contour = computePitchContour(samples, sampleRate)
       postMessage({ type: 'result', requestId, payload: contour }, [contour.freqHz.buffer])
     } else {
-      const analysis = analyzeStemSamples(samples, sampleRate)
+      const analysis = analyzeStemSamples(samples, sampleRate, extraChannels)
       postMessage({ type: 'result', requestId, payload: analysis }, [
         analysis.pitchContour.freqHz.buffer
       ])
```

  - `stemAnalysisClient.ts`:

```diff
--- a/src/renderer/src/audio/stemAnalysisClient.ts
+++ b/src/renderer/src/audio/stemAnalysisClient.ts
@@ -7,6 +7,7 @@
 // scans; this moves it off.
 import { analyzeStemSamples, type StemAnalysis } from '@shared/stemAnalysis'
 import { computePitchContour, type PitchContour } from '@shared/pitchContour'
+import { stemLevelFeatures, type StemLevel } from '@shared/stemLevel'
 import { countWork } from '../perf/workCounters'
 
 let worker: Worker | null = null
@@ -45,28 +46,60 @@ function getWorker(): Worker {
   return w
 }
 
-function request<T>(kind: 'full' | 'pitch', samples: Float32Array, sampleRate: number): Promise<T> {
+function request<T>(
+  kind: 'full' | 'pitch' | 'level',
+  samples: Float32Array,
+  sampleRate: number,
+  extraChannels?: readonly Float32Array[]
+): Promise<T> {
   const requestId = nextRequestId++
   // COPIED before transfer -- callers usually pass an AudioBuffer's own
-  // channel data, which must stay intact on this side.
+  // channel data, which must stay intact on this side. The other channels (the level pass) are
+  // transient copies too.
   const copy = samples.slice()
+  const extra = extraChannels?.map((c) => c.slice())
   return new Promise<T>((resolve, reject) => {
     pending.set(requestId, { resolve: resolve as (payload: unknown) => void, reject })
-    getWorker().postMessage({ requestId, kind, samples: copy, sampleRate }, [copy.buffer])
+    getWorker().postMessage(
+      { requestId, kind, samples: copy, sampleRate, ...(extra && { extraChannels: extra }) },
+      [copy.buffer, ...(extra ?? []).map((c) => c.buffer)]
+    )
   })
 }
 
+/** An AudioBuffer's channels after the first (the level pass reads every channel). */
+export function channelsAfterFirst(buffer: AudioBuffer): Float32Array[] {
+  const out: Float32Array[] = []
+  for (let c = 1; c < buffer.numberOfChannels; c++) out.push(buffer.getChannelData(c))
+  return out
+}
+
 /** analyzeStemSamples, off the main thread. Falls back to running inline
  * where no Worker exists (vitest), so callers don't need two code paths. */
 export function analyzeStemSamplesOffThread(
   samples: Float32Array,
-  sampleRate: number
+  sampleRate: number,
+  extraChannels?: readonly Float32Array[]
 ): Promise<StemAnalysis> {
   countWork('analysis')
   if (typeof Worker === 'undefined') {
-    return Promise.resolve(analyzeStemSamples(samples, sampleRate))
+    return Promise.resolve(analyzeStemSamples(samples, sampleRate, extraChannels))
+  }
+  return request<StemAnalysis>('full', samples, sampleRate, extraChannels)
+}
+
+/** The level pass alone (@shared/stemLevel), off the main thread -- the backfill of a stem whose
+ * feature row is current (analyzeStemOnce's needs.level). Same inline fallback. */
+export function measureStemLevelOffThread(
+  channels: readonly Float32Array[],
+  sampleRate: number
+): Promise<StemLevel> {
+  countWork('analysis:level')
+  if (channels.length === 0) return Promise.resolve(stemLevelFeatures([], sampleRate))
+  if (typeof Worker === 'undefined') {
+    return Promise.resolve(stemLevelFeatures(channels, sampleRate))
   }
-  return request<StemAnalysis>('full', samples, sampleRate)
+  return request<StemLevel>('level', channels[0], sampleRate, channels.slice(1))
 }
 
 /** computePitchContour, off the main thread -- pitchCache.ts's own path
```

- [ ] **Step 3: A fresh extraction, and the backfill.**
  - `stemFeaturesCache.ts`:

```diff
--- a/src/renderer/src/audio/stemFeaturesCache.ts
+++ b/src/renderer/src/audio/stemFeaturesCache.ts
@@ -4,7 +4,7 @@ import { countWork } from '../perf/workCounters'
 import { decodeStemFile } from './decodeStemFile'
 import { getBrightness } from './peakCache'
 import { primePitchContour } from './pitchCache'
-import { analyzeStemSamplesOffThread } from './stemAnalysisClient'
+import { analyzeStemSamplesOffThread, channelsAfterFirst } from './stemAnalysisClient'
 import { queueStemAnalysisWrite } from './analysisWriteQueue'
 
 const cache = new Map<string, Promise<StemFeatures>>()
@@ -138,9 +138,11 @@ async function featuresFromDecoded(
   brightness: number[],
   persist: (features: StemFeatures) => void = (features) => persistFeaturesNow(path, features)
 ): Promise<StemFeatures> {
+  // every channel goes over: a fresh row measures the level pass too (spec 2026-10-05 7.2)
   const analysis = await analyzeStemSamplesOffThread(
     audioBuffer.getChannelData(0),
-    audioBuffer.sampleRate
+    audioBuffer.sampleRate,
+    channelsAfterFirst(audioBuffer)
   )
   primePitchContour(path, analysis.pitchContour)
   const features = assembleStemFeatures(analysis, brightness)
```

  - `analyzeStemOnce.ts`:

```diff
--- a/src/renderer/src/audio/analyzeStemOnce.ts
+++ b/src/renderer/src/audio/analyzeStemOnce.ts
@@ -6,6 +6,9 @@ import { decodeStemFile } from './decodeStemFile'
 import { isStemNotDownloadedError } from '@shared/stemNotDownloaded'
 import { adoptWaveformAnalysis, hasWaveformEntry, waveformFromBuffer } from './peakCache'
 import { adoptStemFeaturesFromBuffer, peekStemFeaturesEntry } from './stemFeaturesCache'
+import { channelsAfterFirst, measureStemLevelOffThread } from './stemAnalysisClient'
+import { queueStemAnalysisWrite } from './analysisWriteQueue'
+import { stemLevelFields } from '@shared/stemAnalysis'
 import {
   adoptStemEmbeddingFromBuffer,
   adoptZeroShotFromBuffer,
@@ -20,6 +23,8 @@ export interface AnalyzeStemOnceResult {
   features: StemAnalysisOutcome
   embedding: StemAnalysisOutcome
   zeroShot: StemAnalysisOutcome
+  /** Present only when `needs.level` asked for the level pass. */
+  level?: StemAnalysisOutcome
 }
 
 const ALL_SKIPPED: AnalyzeStemOnceResult = {
@@ -29,6 +34,9 @@ const ALL_SKIPPED: AnalyzeStemOnceResult = {
   zeroShot: 'skipped'
 }
 
+/** Level passes in flight, by path: a second scan asking for the same stem shares it. */
+const levelInFlight = new Map<string, Promise<void>>()
+
 /**
  * "Analyse once" (docs/superpowers/specs/2026-09-22-background-efficiency-
  * design.md, A2): ONE read + ONE decode of a stem, then only the outputs
@@ -91,7 +99,12 @@ export async function analyzeStemOnce(
   const wantPeaks = needs.peaks && !hasWaveformEntry(path)
   const wantEmbedding = needs.embedding && !hasStemEmbeddingEntry(path)
   const wantZeroShot = needs.zeroShot && !wantEmbedding && !hasZeroShotEntry(path)
-  if (!wantPeaks && !wantFeatures && !wantEmbedding && !wantZeroShot) return ALL_SKIPPED
+  // the level backfill (spec 2026-10-05-radio-intensity-arc-design 7.3): a current row without
+  // the level pass. A fresh feature extraction measures it itself.
+  const wantLevel = needs.level === true && !wantFeatures && !levelInFlight.has(path)
+  if (!wantPeaks && !wantFeatures && !wantEmbedding && !wantZeroShot && !wantLevel) {
+    return ALL_SKIPPED
+  }
 
   const decoded = decodeStemFile(path)
   // Rejections are handled by each consumer below; this only stops an
@@ -121,12 +134,31 @@ export async function analyzeStemOnce(
 
   const embeddingPromise = wantEmbedding ? adoptStemEmbeddingFromBuffer(path, decoded) : null
   const zeroShotPromise = wantZeroShot ? adoptZeroShotFromBuffer(path, decoded) : null
+  // the SAME decode, every channel, merged into the row by main (never a second decode)
+  const levelPromise = wantLevel
+    ? decoded
+        .then((buffer) =>
+          measureStemLevelOffThread(
+            [buffer.getChannelData(0), ...channelsAfterFirst(buffer)],
+            buffer.sampleRate
+          )
+        )
+        .then((level) => queueStemAnalysisWrite(path, { level: stemLevelFields(level) }))
+    : null
+  if (levelPromise !== null) {
+    levelInFlight.set(path, levelPromise)
+    void levelPromise.then(
+      () => levelInFlight.delete(path),
+      () => levelInFlight.delete(path)
+    )
+  }
 
-  const [peaks, features, embedding, zeroShot] = await Promise.allSettled([
+  const [peaks, features, embedding, zeroShot, level] = await Promise.allSettled([
     peaksPromise,
     featuresPromise,
     embeddingPromise,
-    zeroShotPromise
+    zeroShotPromise,
+    levelPromise
   ])
 
   // One short line per stem, never one stack trace per output: a decode
@@ -148,6 +180,9 @@ export async function analyzeStemOnce(
     if (features.status === 'rejected') {
       console.error(`analyzeStemOnce: features failed for ${path}: ${describe(features.reason)}`)
     }
+    if (level.status === 'rejected') {
+      console.error(`analyzeStemOnce: level failed for ${path}: ${describe(level.reason)}`)
+    }
   }
 
   return {
@@ -172,7 +207,10 @@ export async function analyzeStemOnce(
         ? 'skipped'
         : zeroShot.status === 'fulfilled' && zeroShot.value
           ? 'done'
-          : 'failed'
+          : 'failed',
+    ...(needs.level === true && {
+      level: levelPromise === null ? 'skipped' : level.status === 'fulfilled' ? 'done' : 'failed'
+    })
   }
 }
 
```

- [ ] **Step 4: Main: the need, the merge.**
  - `src/main/stemAnalysisNeeds.ts`:

```diff
--- a/src/main/stemAnalysisNeeds.ts
+++ b/src/main/stemAnalysisNeeds.ts
@@ -1,7 +1,13 @@
 // src/main/stemAnalysisNeeds.ts
 import { basename } from 'node:path'
 import type Database from 'better-sqlite3'
-import { stemFeatureVersionOf, STEM_FEATURE_VERSION, type StemFeatures } from '@shared/stemFeatures'
+import {
+  stemFeatureVersionOf,
+  stemLevelVersionOf,
+  STEM_FEATURE_VERSION,
+  type StemFeatures
+} from '@shared/stemFeatures'
+import { STEM_LEVEL_VERSION } from '@shared/stemLevel'
 import type { StemAnalysisNeeds } from '@shared/stemAnalysisNeeds'
 import { countWork } from './workCounters'
 
@@ -25,12 +31,16 @@ function presentStemCIDs(
   return new Set(rows.map((r) => r.StemCID))
 }
 
-/** StemCIDs whose feature row exists AND is at STEM_FEATURE_VERSION. The
- * version lives inside FeaturesJSON (no json_extract anywhere in this
- * codebase), so it's parsed here in JS -- only for rows that exist, one
- * chunk at a time. An unparseable row counts as missing, matching
- * getStemFeatureCache (which returns null for it). */
-function currentFeatureStemCIDs(db: Database.Database, stemCIDs: string[]): Set<string> {
+/** StemCIDs whose feature row exists AND is at STEM_FEATURE_VERSION, and of those the ones whose
+ * level pass is older than STEM_LEVEL_VERSION (or missing: spec 2026-10-05-radio-intensity-arc-
+ * design 7.3) -- read in the same parse. The version lives inside FeaturesJSON (no json_extract
+ * anywhere in this codebase), so it's parsed here in JS -- only for rows that exist, one chunk at
+ * a time. An unparseable row counts as missing, matching getStemFeatureCache (which returns null
+ * for it). */
+function currentFeatureStemCIDs(
+  db: Database.Database,
+  stemCIDs: string[]
+): { current: Set<string>; needsLevel: Set<string> } {
   countWork('sql:stem-analysis-needs.StemFeatureCache')
   const placeholders = stemCIDs.map(() => '?').join(',')
   const rows = db
@@ -39,15 +49,19 @@ function currentFeatureStemCIDs(db: Database.Database, stemCIDs: string[]): Set<
     )
     .all(...stemCIDs) as { StemCID: string; FeaturesJSON: string }[]
   const current = new Set<string>()
+  const needsLevel = new Set<string>()
   for (const row of rows) {
     try {
       const features = JSON.parse(row.FeaturesJSON) as StemFeatures
-      if (stemFeatureVersionOf(features) >= STEM_FEATURE_VERSION) current.add(row.StemCID)
+      if (stemFeatureVersionOf(features) >= STEM_FEATURE_VERSION) {
+        current.add(row.StemCID)
+        if (stemLevelVersionOf(features) < STEM_LEVEL_VERSION) needsLevel.add(row.StemCID)
+      }
     } catch {
       // missing, as above
     }
   }
-  return current
+  return { current, needsLevel }
 }
 
 /** StemCIDs (of these) that still need the YAMNet zero-shot step
@@ -108,9 +122,11 @@ export async function getStemAnalysisNeeds(
       const stemCID = basename(path)
       out.push({
         peaks: !peaks.has(stemCID),
-        features: !features.has(stemCID),
+        features: !features.current.has(stemCID),
         embedding: !embeddings.has(stemCID),
-        zeroShot: zeroShot.has(stemCID)
+        zeroShot: zeroShot.has(stemCID),
+        // only when it is needed: an answer without it reads as no level work
+        ...(features.needsLevel.has(stemCID) && { level: true })
       })
     }
   }
```

  - `src/main/stemFeatureCacheStore.ts`:

```diff
--- a/src/main/stemFeatureCacheStore.ts
+++ b/src/main/stemFeatureCacheStore.ts
@@ -1,6 +1,7 @@
 // src/main/stemFeatureCacheStore.ts
 import type Database from 'better-sqlite3'
-import type { StemFeatures } from '@shared/stemFeatures'
+import { isCurrentStemFeatureVersion, type StemFeatures } from '@shared/stemFeatures'
+import type { StemLevelWrite } from '@shared/stemAnalysisWrite'
 import { stemCIDForPath } from './stemCategoriesStore'
 import { countWork } from './workCounters'
 import { noteStemFeatureRowWritten } from './traitQuantileCache'
@@ -99,3 +100,36 @@ export function afterStemFeatureRowWritten(
   // Wakes the overnight classifier with this stem (background efficiency B4).
   noteAutoClassifyInputRow(db, 'feature', stemCID)
 }
+
+/** The level pass's backfill (spec 2026-10-05-radio-intensity-arc-design 7.3): merges `level` into
+ * the stem's existing feature row -- read, merge, write, inside the caller's transaction -- and
+ * returns the merged row, or null when there is no row to merge into (none, unparseable, or
+ * older than STEM_FEATURE_VERSION: the scan's fresh extraction measures the level itself). Every
+ * other field, featureVersion and ExtractedAt stay as they were. Pair with
+ * noteStemFeatureRowWritten once committed (not the classifier's wake: none of its inputs moved). */
+export function mergeStemFeatureLevelRow(
+  db: Database.Database,
+  stemCID: string,
+  level: StemLevelWrite
+): StemFeatures | null {
+  countWork('sql:stem-feature-cache.merge-level')
+  const row = db
+    .prepare(`SELECT FeaturesJSON FROM StemFeatureCache WHERE StemCID = ?`)
+    .get(stemCID) as { FeaturesJSON: string } | undefined
+  if (!row) return null
+  let features: StemFeatures
+  try {
+    features = JSON.parse(row.FeaturesJSON) as StemFeatures
+  } catch {
+    return null
+  }
+  if (!features || typeof features !== 'object' || !isCurrentStemFeatureVersion(features)) {
+    return null
+  }
+  const merged: StemFeatures = { ...features, ...level }
+  db.prepare(`UPDATE StemFeatureCache SET FeaturesJSON = ? WHERE StemCID = ?`).run(
+    JSON.stringify(merged),
+    stemCID
+  )
+  return merged
+}
```

  - `src/main/stemAnalysisResultsWriter.ts`:

```diff
--- a/src/main/stemAnalysisResultsWriter.ts
+++ b/src/main/stemAnalysisResultsWriter.ts
@@ -4,7 +4,12 @@ import type Database from 'better-sqlite3'
 import type { StemAnalysisWrite } from '@shared/stemAnalysisWrite'
 import { countWork } from './workCounters'
 import { writeStemPeaksRow } from './stemPeaksCacheStore'
-import { afterStemFeatureRowWritten, writeStemFeatureRow } from './stemFeatureCacheStore'
+import {
+  afterStemFeatureRowWritten,
+  mergeStemFeatureLevelRow,
+  writeStemFeatureRow
+} from './stemFeatureCacheStore'
+import { noteStemFeatureRowWritten } from './traitQuantileCache'
 import { afterStemEmbeddingRowWritten, writeStemEmbeddingRow } from './stemEmbeddingCacheStore'
 import { applyYamnetZeroShotCategory, markYamnetZeroShotAttempted } from './stemAutoCategoryStore'
 
@@ -92,6 +97,11 @@ export async function writeStemAnalysisResults(
         if (result.zeroShotClassIndex !== undefined) {
           applyYamnetZeroShotCategory(db, stemCID, result.zeroShotClassIndex, extractedAt)
         }
+        // the level backfill: merged into the row as it now stands (spec 2026-10-05 7.3)
+        if (result.level) {
+          const merged = mergeStemFeatureLevelRow(db, stemCID, result.level)
+          if (merged !== null) followUps.push(() => noteStemFeatureRowWritten(db, merged, stemCID))
+        }
       } while (index < results.length && performance.now() - start < TRANSACTION_BUDGET_MS)
     })()
     for (const followUp of followUps) followUp()
```

- [ ] **Step 5: Verify, commit.**
  - Run `npx vitest run src/renderer src/main/stemAnalysisNeeds.test.ts src/main/stemAnalysisResultsWriter.test.ts src/main/stemFeatureCacheStore.test.ts src/main/traitQuantileCache.test.ts`
    and `npm run typecheck`.
  - Message:
    `analysis: the level pass on the one decode, and its backfill (spec 2026-10-05-radio-intensity-arc-design 7.2-7.3) -- the worker's 'level' message and 'full' with the other channels (copies, transferred); a fresh extraction measures it (featuresFromDecoded passes every channel); analyzeStemOnce's needs.level decodes once, measures, and queues a level write (in-flight shared per path); main answers level for a current row without the pass (in the same FeaturesJSON parse) and merges a level write into the row in place (mergeStemFeatureLevelRow: every other field, featureVersion and ExtractedAt kept; the value table told, the overnight classifier not woken: none of its inputs moved). It rides the existing ambient scans and their consent; no new scan`,
    then the trailer.

### Task 14: The backfill, measured; the web index re-exported

**Repos:** both. **Depends on:** Tasks 13, 6, 9. Nothing is uploaded or deployed.

- [ ] **Step 1: The desktop's dev scan.**
  - Run `npm run dev` with Discover's library scan consented, on Elling's library, as the
    background-efficiency checks did.
  - Read the dev `[work]` counters:
    - `decode:*` per stem must stay 1 for a level-only stem;
    - `analysis:level` and its time;
    - `ipc:set-stem-analysis-results`;
    - `sql:stem-feature-cache.merge-level`.
  - Note UI responsiveness while it runs (the counters, not a claim of feel).
  - **No number is claimed before it is read** (spec §7.3).
- [ ] **Step 2: The tables.** Once 200 rows carry the level fields, a Discover roll's quantile
  tables gain them (Task 9's test proves the rule). Check one roll's `discover:intensity-attached`
  counter and a spot candidate's `intensity` in the dev console.
- [ ] **Step 3: The web re-export.**
  - Only once the backfill has covered the archive (or Elling says export now): `npm run
    export-index` locally.
  - Record `coverage.loudness` against `count` and the size.
  - Uploading and deploying wait for his go-ahead.
- [ ] **Step 4: Commit the measurements** as a note in the handoff (Task 15), not code.

**Ship point C.** Scores with loudness on both radios.

---

## Last

### Task 15: Cross-repo verification, review, handoff, walkthrough

- [ ] **Step 1: Both repos green.**
  - sssketch: `npm test`, `npm run typecheck`, `npm run lint`.
  - ell.ing/radio: `npx vitest run`, `npm run typecheck`, `npm run build`, `npm run check:engine`.
- [ ] **Step 2: Byte-identity once more.**
  - The web harness (Task 7 Step 3) at `density: 'arc'` and `'off'` against b9b5ae1's reducer:
    identical.
  - The shared fingerprints: `b6fdd2ab`, `dd70db82`, `9207add6`, `ROLLS_BEFORE`, `TURNS_BEFORE`
    and `0540eeea` all pass.
- [ ] **Step 3: Review** with superpowers:requesting-code-review against the spec's §10, §12 and
  §13 and this plan's decisions.
- [ ] **Step 4: Handoff.**
  - Add a memory note (`radio_intensity_arc_shipped.md`): what is live, what is unpushed, the
    Task 7 and Task 14 measurements, and that it needs Elling's walkthrough.
  - Add its line to `MEMORY.md`.
  - **Do not push or deploy.**
- [ ] **Step 5: The walkthrough** (Elling's; spec §13). No agent can hear either radio, see the UI
  or hold a phone.
  1. Density `intensity` at the defaults. Over 5 minutes: a build (rows join, drums get busier).
     Then on a phrase start the drums echo out and the bass goes, the pads carry, and 16-32 bars
     later the riser and gap bring them back as the drop.
  2. Drama 10: a swell, with nothing dropped out and no gap. Drama 100: full breakdowns.
  3. Energy 0: long builds and two-phrase breakdowns. Energy 100: short breakdowns, long rides.
  4. A bigger peak within about 15 minutes: five rows, a second drums layer, a deeper breakdown.
  5. The buttons:
     - `build` in the ride: the build starts at the next top;
     - `drop` in a breakdown: the drop at the next top;
     - `drop` while building: a quick low drop (drums and bass out for a bar or two) and back on
       the one.
  6. A hook on the drums rests through the breakdown and is back on the drop. An away hook comes
     back at the drop.
  7. Fold on: more bend at the drop, less in the breakdown.
  8. Unmute a resting row (desktop): it plays at once, and the drop still lands for the others.
  9. The phone: build and drop work, and the words fit at 320 px. The chips read `drums out` and
     `low out`.
  10. The backfill runs in the background without slowing the UI (the dev counters).

## Timing risks, per task

- **T3 (the machine):**
  - Phrase starts and decide wraps come from the clock's `turnaroundLap`. A loop-length change in
    a breakdown recomputes `P` at each wrap, and lengths are in phrases (spec §12.4).
  - A one-lap phrase prepares two wraps ahead (planning decision 2).
  - The overrun safety ends a breakdown at `phrases + 1` phrase starts.
- **T4 (builds, roll, hooks, throws):**
  - The drop's roll reads the forecast a lap ahead. A rested row muted, locked or removed after
    the roll keeps the plan; the reducer logs `[radio-build] oversold` (spec §12.3).
  - A throw aimed at the drop must close before the gap: `changeAt` wins when it comes first.
- **T7 (web):**
  - Order at the wrap: the arc before hooks before fold before the roll. A test pins it in the
    trace.
  - A renewal not warm at the decide wrap: the own stem, no draw, the drop still large (spec
    §12.2).
  - A rest the engine refuses: the row plays; release it from the arc.
  - A button and an armed turnaround on the same top: the press's turn replaces the armed one
    while it can be taken back, else the top after (spec §12.7).
  - A tempo change on its way holds a joining add (`addDecidesAt`'s rule), and the arc's
    breakdown and drop too: a rest on a moving top waits.
- **T10 (desktop):**
  - The clock stops on pause and the arc counts only the wraps it sees (fold's and hooks' rule,
    spec §12.5).
  - The add is warmed a lap early.
  - The "last row in the mix" guard withdraws an arc rest at the line.
  - A hand unmute releases the rest.
- **T11 (phone):** the answer is from the last pushed state, a push behind, as `/api/turn`'s is.
- **T13 (level):**
  - The worker gets copies, so the AudioBuffer stays intact.
  - The level-only pass is shared per path while in flight.
  - Between the pass and the queue's flush (≤ 1 s), main still says `level`. A second scan in
    that window measures again: harmless and rare.
- **T6 / T14 (index):** an export before the backfill renormalises without the level parts.
  `coverage.loudness` says how far it got.
