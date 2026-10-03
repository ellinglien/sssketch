# Radio fold mode follows the pace slider

**Date:** 2026-10-03
**Scope:** sssketch Discover radio (desktop) and ell.ing/radio (web), both through `src/shared`.
**Amends:** `2026-10-03-radio-pace-slider-design.md`, which said "fold mode ignores the slider"
(its flag 2, its "Out of scope"). Elling now overrides that.
**Builds on:**
- `2026-10-02-radio-fold-mode-design.md` (§5 is fold as built);
- `2026-10-03-radio-fold-v2-design.md` (re-fold, rotation, the 8-32 bar window);
- `2026-10-03-radio-pace-slider-design.md` (the profile, the phrase caps, the bar band, companions).

## Why

Elling, listening to the web radio with fold on (2026-10-03):

> "i find even ludicrous mode is slow in fold version. if it's really ludicrous i want it to be
> switching very very quickly.. right now it waits patiently for the exact right moment. lol. it's
> very polite for something called ludicrous :D"

Fold mode is the radio he mainly listens to, and the one he wants ludicrous in.

**The cause, from the code.** Fold mode is polite in five separate ways, and the slider reaches none
of them:

1. **Its own window.** `radioCadenceOf` replaces the slider's window with `FOLD_PACE_BARS` (8-32)
   whenever fold is on, at every level.
2. **The web's 16-bar phrase.** In fold, the change phrase is the runtime's base phrase, never
   capped. On the web that is 16, so a change can only land on every fourth top of a 4-bar loop.
3. **The realignment preference.** `radioFoldIntervalBars` moves a drawn interval up to 2 laps later
   to land on a realignment top (`FOLD_PREFER_WAIT_LAPS`).
4. **No bar band.** Mid-loop landings are off in fold.
5. **The fold machine waits too.** Re-folds, rotations, unfolds and second folds wait for a row's
   own realignment top, which is 30-120 s apart by construction. Stretches run 16-96 bars, and a
   fold steps in over 2-4 tops.

**Measured** with the shared clock at 120 bpm (one bar = 2 s), seconds between changes in fold mode
today. The range is without a settled fold and with one (a 7-beat fold realigns every 7 laps). It
is the same at every slider level:

| fold today | web, 4-bar loop | web, 8-bar loop | desktop, 4-bar | desktop, 8-bar |
|---|---|---|---|---|
| every level, 0 to 100 | 52-55 s | 51-57 s | 43-45 s | 46-51 s |

So ludicrous in fold changes something about once a minute: slower than plain `fast` (32 s on the
web).

## Decisions (coordinator brief, refined here; Elling to confirm the flags)

1. **At 50 and below, fold is exactly as it is today**, in both radios: the same window, phrase,
   preference, one row, no hurry, the same draws. Proved by test (a pinned hash of the machine's
   decisions, the cadence at every level, and the web's action log against HEAD).
2. **Above 50 the slider scales fold's cadence.** The window shrinks from 8-32 toward the slider's
   own; the phrase caps are the slider's; the realignment preference fades out and is gone above
   70 ("impolite": no waiting for the right moment).
3. **From 80, fold's cadence is the slider's**, bar band and rows per change included.
4. **Mid-loop landings in fold, in two phases** (section 3):
   - **Phase 1:** the bar band on every row the fold machine is not holding. The folded rows (at
     most two) keep their stems while everything else churns.
   - **Phase 2:** the folded rows join the bar band too. A change on a folded row **carries the
     fold**: the new stem takes over the running cycle, entering at its matching place in it, so the
     polymeter goes on while its sound changes. A stem that cannot carry it cuts in straight, and
     that fold ends.
5. **Fold's own machine hurries above 70** (section 2). Stretches shorten, folds step in faster, and
   any top may open like a realignment. At 100 a fold changes about 2.5 times as often.
6. **Turnarounds keep their 16-bar phrase** in fold too (pace decision 4). A phrase end on a
   realignment top still prefers a turnaround.

## 1. The cadence

`radioFoldPaceProfile(level)` (new, in `radioPace.ts`) is fold's counterpart of
`radioPaceProfile`. It is pure, has no randomness, and returns the slider's fields plus two more:

- **`window`:**
  - 8-32 at 50 and below.
  - Above 50, geometric between the knots `RADIO_FOLD_PACE_WINDOW_KNOTS`: 50: 8-32, 60: 4-12,
    70: 2-4, 80: 1-2. The knots are rounded to whole bars like the slider's.
  - From 80, the slider's own window.
  - Tested:
    - both edges never grow with the level;
    - above 50, never shorter than the slider's;
    - equal to it from 80.
- **`phraseCap`, `barEvery`, `rows`:** the slider's (`radioPaceProfile`) above 50; none, none and 1
  at 50 and below. So the web's fold phrase becomes 8 at 51-60, 4 at 61-70, and none (every top)
  above 70. The bar band starts at 80 and companions at 71, as without fold.
- **`preferWaitLaps`:** how far a change may move to reach a realignment top. 2 up to 60, 1 up to
  70, 0 above. `radioFoldIntervalBars` takes it as a new last argument, which defaults to
  `FOLD_PREFER_WAIT_LAPS`, so every existing caller is unchanged.
- **`hurry`:** 0 up to 70, then linear to 1 at 100. It goes to `stepRadioFold` (section 2).

`radioCadenceOf` gains three fields: `foldPaced` (fold on and above 50), `foldPreferWaitLaps` and
`foldHurry`. All three are 0 or false with fold off, and with fold on at 50 and below they are
false, 2 and 0. A settings object with no `paceLevel` reads exactly as before.

### The table

Seconds between changes in fold, at 120 bpm, simulated with the shared clock
(`advanceRadioClock` at 30 Hz). Stems are as long as the loop. "web" has the 16-bar base phrase;
"desktop" is its default `phrase loop`. A range is without a settled fold and with one, where the
preference can move a change. Multiply by rows per change for row turnovers.

| level | window | change phrase (web) | mid-loop grid | rows / change | prefer (laps) | hurry | web, 4-bar | web, 8-bar | desktop, 4-bar | desktop, 8-bar |
|---|---|---|---|---|---|---|---|---|---|---|
| 0-50 | 8-32 | 16 | – | 1 | 2 | 0 | 52-55 s | 52-58 s | 43-45 s | 47-51 s |
| 55 | 6-20 | 8 | – | 1 | 2 | 0 | 33-35 s | 33-35 s | 28-31 s | 33-37 s |
| 60 | 4-12 | 8 | – | 1 | 2 | 0 | 23-25 s | 23-26 s | 19-20 s | 23-26 s |
| 65 | 3-7 | 4 | – | 1 | 1 | 0 | 13 s | 16 s | 13 s | 16 s |
| 70 | 2-4 | 4 | – | 1 | 1 | 0 | 8 s | 16 s | 8 s | 16 s |
| 75 | 1-3 | every top | – | 1.5 | 0 | 0.17 | 8 s | 16 s | 8 s | 16 s |
| 80 | 1-2 | every top | 4 | 2 | 0 | 0.33 | 8 s | 8 s | 8 s | 8 s |
| 85 | 1-1 | every top | 4 | 2.5 | 0 | 0.5 | 8 s | 8 s | 8 s | 8 s |
| 90 | 1-1 | every top | 2 | 3 | 0 | 0.67 | 4 s | 4 s | 4 s | 4 s |
| 95 | 1-1 | every top | 1 | 3.5 | 0 | 0.83 | 2 s | 2 s | 2 s | 2 s |
| 100 | 1-1 | every top | 1 | 4 | 0 | 1 | 2 s | 2 s | 2 s | 2 s |

- **The web's own reducer agrees.** A planning prototype of phase 1 on `step.ts` at HEAD
  (`230398d`), measured with the reducer at bend 80, 5 rows and a 4-bar loop, gave 51, 37, 23, 13,
  8, 8, 8, 8, 4, 2 and 2 s at levels 50, 55, 60, 65, 70, 75, 80, 85, 90, 95 and 100.
  - None of the mid-loop landings (4 seeds, 10 minutes each, at 95) went to a row the fold held.
  - Folds were heard on about 71% of tops at 95.
- **In phase 1, from 80 the mid-loop columns hold for the rows the fold is not holding.** The one or
  two folded rows change only when the machine lets them go (section 2's hurry shortens that to
  15-25 s at 100). In phase 2 they change at the same cadence as the rest.
- **The desktop's `phrase` chip and `loop end` behave as without fold.** A desktop loop with stems
  shorter than the loop already turns them over on their own cycles below the bar band, folded rows
  included (see section 4, gate 15).

## 2. Fold's own machine hurries (above 70)

`stepRadioFold`'s input gains an optional `hurry` (0..1, from `cadence.foldHurry`). Absent or 0
leaves the machine exactly as it was: the same draws in the same order, pinned by a hash of 6,000
seeded steps across seeds, bends, loops and stem churn (`0540eeea`, recorded before the change).
With `h > 0`:

- **Stretches** (folded 16-96 bars, straight 96-24) are scaled by `1 − 0.75h`: a quarter at 100.
- **A fold steps in** over `round(n × (1 − h))` tops, at least 1, where `n` is today's 2-4 draw. A
  re-fold steps over 1-2, scaled the same way. At full hurry a fold is a single crossfaded step.
  Elling's v1 rule "lengths move along curves, never jump" bends here: flag 4.
- **An unfold's wait** for its realignment top, at most 8 laps, becomes `round(8 × (1 − h))`. From
  `h` 0.94 (level 99) that is 0: the unfold starts in the very step that asks for it (a stretch
  ending, a rotation), on that top, without waiting for the next.
- **Rotation** comes after `round(drawn × (1 − h))` realignments, at least 1.
- **Any top may open.** Once per step, while hurrying, one draw decides whether this top counts as
  a realignment for everything that waits on one: re-fold, rotation, an unfold's wait, a second
  fold. Its chance is `0.5 × h`. `marked`, the true realignment that changes and turnarounds
  prefer, is unchanged.

**Measured** (seeded machine, 5 rows, seconds between fold changes at 120 bpm):

| | hurry 0 (≤70) | hurry 0.5 (85) | hurry 1 (100) |
|---|---|---|---|
| bend 40, 4-bar | 49 s | 34 s | 19 s |
| bend 40, 8-bar | 56 s | 50 s | 26 s |
| bend 60, 4-bar | 31 s | 24 s | 17 s |
| bend 80, 4-bar | 26 s | 20 s | 15 s |

Rows are still folded 41-72% of the time at full hurry.

Kept as they are:
- **The fold menus and the 30-120 s realignment window.** Which cycles are allowed is what makes a
  fold a fold.
- **Drift sweeps.** They are not a gate.
- **Fold steps land only on loop tops.** See section 3, "rejected".

## 3. Mid-loop landings in fold

### What the engines already do

- **Desktop.** The `CycleTable` is keyed by **row**, not stem. A stem folds when its project entry
  names its row (`cycleRow`), and the row has a live entry. A staged project at a bar
  (`stage-project` with `atBars`) swaps the stems and leaves the table and its origins alone.
- **Web.** `Timeline.swapAt` replaces a row's assignment from the bar on. `planVoices` plays an
  assignment that carries a cycle from wherever its cycle is at that moment
  (`cycleOffset(t, cycle)`).
- **Both** are therefore already able to cut a folded row at a bar to the new stem **straight**.
  The desktop does this today with `loop end` own-cycle cuts. Neither can move a cycle's origin
  off a loop top.

### Phase 1: the fold holds, the bed churns

In fold, from 80:
- **Rows the machine holds are not picked.** A row "held" has a cycle in the lap playing or the
  next: `radioFoldHoldsRow(foldNow, foldNext, row)`. They are left out of the list radio picks
  from (`radioFoldPickableIds`), unless that would leave nothing.
- **Every other row takes the bar band**, as without fold. That includes the anchor, under the
  slider's existing guards: a stem longer than the loop, or one that would shorten it, waits for
  the top.
- **A held row that is picked anyway** (the fallback, or a fold that starts on it after the pick)
  keeps to its loop tops: `radioCadenceBarEvery(cadence, held)` is null for it.
- **Companions on a row that became held** do not ride a mid-loop line: they are dropped, like a
  companion that is not ready.

This is sound with no engine work, and it keeps the polymeter audible. Up to 2 folded layers phase
against everything else turning over every bar. The hurried machine turns those layers over itself.

### Phase 2: the fold carries

From 80, the held rows join the bar band too. When a change lands on a folded row, at a bar line or
a top, it does one of two things:

- **Carry the fold.** `radioFoldCanCarry(state, row, incoming, anchor)` decides, at the decision,
  and the answer rides with the change (`carry`). It requires:
  - a fold that is folding in or settled (not one asked to leave or walking back);
  - an incoming stem that could fold here itself (`radioFoldCanFold`: rhythmic, at most 4 bars,
    not lead or bass, not hooked);
  - an incoming stem at least as long as the stem the fold was decided for.

  The last condition is what makes it safe. Every length the fold has played or can still step to
  is shorter than the old stem, so it fits the new one, whatever the machine decides between the
  decision and the landing.
- **Otherwise, cut straight.** This is what the desktop does today: the fold on that row ends now
  (`radioFoldRelease`), not at the next step, so the readout and the realignment preference stop
  naming a fold nobody hears.

**How each runtime plays a carry:**

- **Desktop.** The staged project names the row for the incoming stem
  (`radioFoldCycleRows(..., carried)`). The live `CycleTable` entry keeps its id and origin, so the
  incoming stem plays the running cycle from the bar. The cycles staged for the next top are keyed
  by row and apply to it. **No engine change is expected.** Plan Task 8 proves it with a native
  test first, as fold v1's first task did.
- **Web.** `Timeline.swapAt` / `swap` take `carry`:
  - the incoming stem takes the cycle in force at that moment (same id and origin);
  - every later assignment of the outgoing stem (the fold steps `setCycles` already put at the coming
    tops) is re-pointed to it.

  `planVoices` then enters it at its place in the cycle with the existing 10 ms seam fade. A
  take-back re-carries the old stem, and the voice carries on seamlessly (checked in the planning
  prototype).
- **Both machines** re-point the fold at the landing (`radioFoldCarry`). This moves nothing (id,
  origin, phase, path and walk are kept) and draws nothing. A row the machine has meanwhile let go is
  left alone, and the engines play whatever is in force there.

**How it enters.** A carried stem enters at its matching place in the running cycle, not from its
start. This is the bar band's own rule (pace spec section 3), applied to the cycle instead of the
loop.

### Rejected

- **Landing on a folded row's own cycle seams (tile edges) instead of bar lines.** A 7-beat cycle's
  seams fall every 1¾ bars, off the bar grid.
  - The web's `swapAt` accepts only bar lines.
  - Radio's whole grid (`radioPaceGridBars`, `radioChangeLandsAtBar`, the desktop's re-aim) is in
    whole bars.
  - A seam landing would save only a mid-tile entry, which both engines already handle everywhere
    else in the bar band.

  A later refinement could add it if a carried entry sounds wrong.
- **A carried change restarting the cycle at the bar** (a new origin there). Both engines tie a
  cycle's origin to a loop top (`CycleTable::originFor`, `setCycles`), and so do the machine's
  realignment arithmetic and the phase dot. That would be engine work in both runtimes, and it would
  break the phasing.
- **Fold steps (re-fold, rotation) in mid-lap.** They would need lap-ahead decisions to become
  bar-ahead ones in both engines. The hurry gets the speed instead.

## 4. Other "politeness" gates

Every gate found that can hold a change back, with its verdict. Items 1-5 are fold's and covered
above.

| # | gate | where | verdict |
|---|---|---|---|
| 1 | fold's 8-32 window | `radioCadenceOf` | follows the slider above 50 |
| 2 | the web's 16-bar change phrase in fold | `radioCadenceOf` | the slider's caps above 50 |
| 3 | waiting up to 2 laps for a realignment top | `radioFoldIntervalBars` | 2 / 1 / 0 laps; gone above 70 |
| 4 | no bar band in fold | `radioCadenceOf` | phase 1: unheld rows; phase 2: all rows, carried |
| 5 | the machine waits for realignment tops; long stretches; 2-4 step folds | `stepRadioFold` | hurries above 70 |
| 6 | an arc step owns a wrap, so radio's change waits a **whole lap** (web `scheduleLed`: `arcStepAt`) | web, both modes | in the bar band, aim at the next lap's first line instead: optional Task 12 |
| 7 | the desktop arc's exit yields to any stage out (`arcExitHeldBack`); at 94+ a stage is out almost always, so the bed may never thin | desktop, both modes | **flag 9**: a walkthrough check, not fixed here |
| 8 | an arrival gesture must be spent before an early decision | both | already relaxed in the band (spent by the landing bar; a mid-loop cut does not wait); costs at most one grid cell. Keep |
| 9 | a leading transition (hole, riser) holds the one change in flight until its top | both | in the band it is decided only in the last grid cell before the wrap, so it costs at most a cell. Keep |
| 10 | one decided change at a time (`s.led` / `radioLedChangeRef`) | both | inherent; companions are the way past it. Keep |
| 11 | a primary whose stem is not ready waits for later lines (dropped after 2 wraps) | both | measure first (pace flag 7). Follow-up idea: a ready companion leads |
| 12 | turnarounds every 16 bars | both | keep (pace decision 4) |
| 13 | the density arc's legs | both | keep (minutes, not cadence) |
| 14 | drift sweeps, 32-128 bars | fold | not a gate. Keep |
| 15 | desktop `loop end` own-cycle cuts already cut **folded** rows mid-loop, straight, at every level (folded rows are 4 bars or less, `loop end` defaults to 4) | desktop, fold | pre-existing. Decided (phase 2): above 50, a mid-loop straight landing on a folded row releases its fold at once (`radioFoldRelease`, the row kept out of a new fold on the next top); from 80 it carries the fold instead when its stem can. Also above 50 (follow-up, 2026-10-03), a straight **top** landing the fold step did not anticipate releases at once: the machine's step for the lap it plays in still folds the row for the old stem (`radioFoldStaleFor`; a change decided after that step went out, a top swap-now / manual change / new bed), so the machine no longer stays folded for a lap the engine plays straight. One rule for both radios, radio's changes and manual ones alike: `radioFoldLandReleases` (band: always; 51-79: mid-loop or stale). At 50 and below it is unchanged: the wrap's own step lets the row go, as before |

## 5. Live adjustment

- **`radioClockForPace` in fold.**
  - At 50 and below it never redraws the interval, as today.
  - Above 50 a running interval longer than `window.max + foldPreferWaitLaps × loopBars` (the
    snap's own reach) is redrawn, with `barsElapsed` kept, exactly as the slider does outside fold.
  - Moving from 50 to 95 in fold is therefore heard within a bar or two, not after up to 64 more
    bars.
- **The change phrase is re-anchored** on the turnaround's, as outside fold.
  `radioPhraseNeedsReanchor` already covers the fold branch now that the two phrases can differ
  there.
- **The hurry** applies from the next fold step. Nothing in the machine is reset or taken back.
- **Fold on or off** redraws the interval from the window that now applies (unchanged). From 80 the
  two windows are the same thing.

## 6. Determinism and byte-identity

- **The web stays seeded.** Every new draw comes from the fold seed (the machine) or the radio's
  `rnd` (intervals, picks), and only above 50 (cadence) or above 70 (hurry, companions). The same
  seed and the same events, slider moves included, give the same decisions.
- **At 50 and below, in both radios, nothing changes:**
  - **The cadence.** The fold branch returns `FOLD_PACE_BARS`, the base phrase, no band, one row,
    a 2-lap preference and no hurry, at every level from 0 to 50 (tested).
  - **The machine.** With no hurry it gives the same hash (tested).
  - **`radioFoldIntervalBars`.** Its default argument is today's constant.
  - **`radioClockForPace`.** Fold at 50 and below never redraws.
  - **Phase 1's filters** are no-ops while the band is off (the same array is returned, so the
    picks draw nothing new).
  - **The web reducer.** The action log is byte-identical to HEAD at no level, 0, 25 and 50, fold on
    and off. This was checked in planning, and plan Task 4 checks it again with the harness.
  - **The desktop** follows by construction: the same shared outputs feed it. There is no harness;
    the panel glue is untested by convention.

## 7. UI copy

The pace readout names what fold actually does (`radioPaceLabel(level, { fold: true })`), flag 5:
- at 50 and below in fold: `8-32 bars` (today it says `slow` / `mid` / `fast`, which fold ignores);
- 51-79: fold's window, e.g. `6-20 bars`;
- from 80: as without fold (`every 4 bars`, `every 2 bars`, `ludicrous`).

The tooltip, the knob and the copy rules are unchanged (lowercase, no emoji).

## 8. Architecture

- **Shared (sssketch `src/shared`):**
  - `radioPace.ts`: `radioFoldPaceProfile`, its knots and bands, and `windowAt` taking knots.
    The fold-aware `radioPaceLabel`.
  - `radioSchedule.ts`:
    - the fold branch of `radioCadenceOf`;
    - `RadioCadence.foldPaced`, `.foldPreferWaitLaps` and `.foldHurry`;
    - `radioCadenceBarEvery` (phase 1);
    - `radioClockForPace`'s fold bound;
    - doc comments that said "the slider does nothing in fold".
  - `radioFold.ts`:
    - `hurry` in `stepRadioFold`;
    - `radioFoldIntervalBars`' `preferWaitLaps`;
    - `radioFoldHoldsRow` and `radioFoldPickableIds` (phase 1);
    - `radioFoldCanCarry`, `radioFoldCarry` and `radioFoldRelease` (phase 2).
  - `radioFoldLanes.ts`: `radioFoldCycleRows`' `carried` (phase 2).
- **Web (ell.ing/radio):**
  - `step.ts`:
    - the interval's preference;
    - the step's hurry;
    - the held-row grid;
    - the pick filter, with companions;
    - phase 2: `carry` on decided changes and `landAt`, and carry or release at the landing.
  - `controller.ts` and `audio/engine.ts`: `carry` through to `Timeline.swap` / `swapAt`
    (phase 2).
  - `audio/timeline.ts`: `carryAssign` (phase 2).
  - `ui/fullModel.ts` / `full.ts`: the label.
- **Desktop (sssketch):**
  - `DiscoverPanel.tsx`:
    - the interval's preference;
    - the step's hurry;
    - the held-row grid (clock and stage re-aim);
    - the pick filter;
    - phase 2: `foldCarry` on the held change and companions, the stage naming, and carry or release
      at the landing.
  - `DiscoverRadioMenu.tsx`: the label.
  - Native: a test only (`PlaybackEngineTests.cpp` or `TransportTests.cpp`).

## 9. Timing risks

Review caught most of the last sessions' bugs in radio timing. These are the ones this feature
brings:

1. **Same tick, wrap and grid.** On a wrap tick the web computes the change grid before
   `foldAtWrap` makes the new `foldNext`, so an early decision on that tick reads the previous
   step's holds.
   - `scheduleLedAtBar` → `ledBarAim` recomputes the grid fresh before anything reaches the engine,
     so a row that just became held goes to the top.
   - The desktop's stage-time re-aim must apply the same held check.
   - Test: no mid-loop landing on a row that any fold event sent before it names (none in
     planning).
2. **Carry decided early, fold moved before the landing.** A wrap step between the decision and the
   landing may step, unfold or drop the fold. The carry rule (an incoming stem at least as long as
   the old one) keeps every possible cycle playable. Each engine carries whatever is in force at the
   bar, and the machine's carry is a no-op for a row it has let go. Tests: carry after an unfold
   starts; carry after the row left.
3. **The web's next-top fold assignment.** A carried bar swap re-points the next top's `setCycles`
   assignment to the new stem. Without that, `swapAt` would drop it and the row would play straight
   for a lap while the machine thought it folded (tested in planning).
4. **Take-back of a carried bar swap** (hold, Next, swap-now, mute). The playing stem is rescheduled
   at its bar **with carry**, so the cycle comes back, and the voice is seamless (`xfade`; tested in
   planning).
5. **Desktop: pause with a carried stage pending.** The engine applies a held stage at once when
   the transport stops, and fold origins reset on resume, both by existing design. Expected.
6. **Loop-length churn at ludicrous.** A longer or shorter stem landing on the anchor at a top
   changes the loop, and a changed loop restarts every cycle at that top (fold §5, as built). With
   2-4 rows a bar this can happen often, and folds then restart more than they phase. Flag 8.
7. **Desktop stage load.** Phase 2 adds `cycleRow` naming to stages that already go out every bar
   at 94+. There is no new IPC. Watch `[radio]` and `[radio-fold]`.

## 10. Testing

- **Shared (TDD, sssketch vitest):**
  - `radioFoldPace.test.ts`:
    - the profile: the knots, monotone edges, joining the slider at 80, the preference and hurry
      bands;
    - the cadence caps;
    - `radioClockForPace` in fold, at and above fast;
    - `radioCadenceBarEvery`.
  - `radioFoldHurry.test.ts`:
    - the pinned hash at no hurry and at 0;
    - the hurry makes folds move about 1.5 times as often or more;
    - `preferWaitLaps`;
    - holds and the pickable ids.
  - `radioFoldCarry.test.ts`: can-carry, carry, release, and the carried naming.
  - **`radioCadence.test.ts`.** Its four tests that pinned "fold ignores the slider" are rewritten to
    pin it at 50 and below, and to pin fold following the slider above.
- **Web (`step.test.ts`):**
  - **Its three tests that pinned "fold ignores the slider" are rewritten:**
    - fold on/off above fast;
    - a pace move leaves fold alone;
    - fold overrides the bar band.
  - **New:**
    - the fold cadence by level (the table's web column within tolerance);
    - no mid-loop landing on a held row (phase 1);
    - a pace move in fold above fast shortens a long interval and takes nothing back;
    - hurry reaches the step;
    - phase 2: carried landings keep the row's cycle id across the bar and the next top;
    - a straight landing releases;
    - take-back with carry.
  - **`timeline.test.ts`:** `carryAssign` at a bar and at a top, with take-back.
  - **The action-log harness** (not committed), byte-identical to HEAD at no level, 0, 25 and 50,
    fold on and off.
- **Desktop:**
  - typecheck, lint and the shared tests;
  - native `--test`: a carried cycle across a bar-aimed stage.
- **No agent can hear any of this.** Elling's walkthrough:
  1. **Web, fold on, bend 60.** At fast it is as before. At 60 changes come about every 20-25 s;
     at 70, every top. From 90, bar cuts with folded layers still phasing (phase 1), then folded
     layers changing sound without losing their cycle (phase 2).
  2. **Ludicrous in fold:** "very very quickly", not polite. The folded rows still read as odd
     against the beat.
  3. **The fold machine at 100:** folds come and go every 15-25 s, and a fold steps in as one
     crossfaded move, not a curve. Is that too abrupt (flag 4)?
  4. **Turnarounds still every 16 bars.**
  5. **Desktop, the same,** plus: the bed still thins at 94+ (flag 9), and a carried row keeps its
     `7 / 16` readout through a stem change.

## Flags for Elling

1. **The shape between fast and 80.** Fold reaches every-top changes at about 70-75, and the
   slider's own cadence at 80. A steeper or gentler slope is a change of four numbers
   (`RADIO_FOLD_PACE_WINDOW_KNOTS`).
2. **At 50 and below fold stays one speed** (8-32 bars, about 50 s on the web), as today. Slow, mid
   and fast sound the same in fold. Should slow be slower there?
3. **Phase 1 versus phase 2.**
   - Phase 1 keeps the folded layers' sounds fixed while everything else churns, a strong contrast.
   - Phase 2 lets them churn too, keeping only their rhythm (the cycle).
   - Recommended: build both, listen to phase 1 first; phase 2 is one ship point later.
4. **Hurry bends the "curves, never jumps" rule.** At 100 a fold steps in as one crossfaded move,
   and any top may re-fold. The alternative keeps 2-step curves at all levels: slower fold motion
   (about 25 s instead of 19 s at bend 40).
5. **The pace label in fold** says `8-32 bars` at 50 and below instead of slow / mid / fast, and
   fold's window up to 80. Is that clearer, or confusing next to the same knob without fold?
6. **Carry needs a stem at least as long as the old one.** A shorter incoming stem cuts in
   straight and ends that fold. Looser rules (any stem longer than the current cycle) are possible,
   but riskier: the machine's remaining steps would need clamping.
7. **Turnarounds stay 16 bars in fold.** A realignment top still makes a phrase end's turnaround
   `often`.
8. **Loop-length churn at ludicrous restarts folds.** A follow-up could make the anchor row prefer
   stems of its own length in fold from 80.
9. **Desktop, outside fold too:** at 94+ the density arc's exits may never arm, because a stage is
   out nearly all the time (`arcExitHeldBack`). This is worth a look in the walkthrough. It is not
   fixed here.
10. **Gate 6 (optional Task 12):** a change that loses its top to an arc step waits a whole lap on
    the web. In the bar band it could take the next lap's first line instead.

## Out of scope

- Fold steps mid-lap; landing on cycle seams; a cycle restarted at a bar (section 3, "rejected").
- Beat-level landings (pace flag 1).
- The stem-readiness idea (gate 11), until measured.
- The desktop arc starvation (flag 9).
- The phone remote (no pace control).
- Glitch phase 2 (fold handoff thread 2).
