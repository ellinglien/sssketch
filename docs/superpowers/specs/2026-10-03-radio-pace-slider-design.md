# Radio pace slider: from slow to ludicrous

**Date:** 2026-10-03
**Scope:** sssketch Discover radio (desktop), and ell.ing/radio full mode (web). The phone remote
has no pace control today and gets none here (see Out of scope).
**Builds on:**
- `2026-09-28-radio-controls-design.md` (pace windows, the phrase grid, loop end);
- `2026-10-02-radio-turnarounds-design.md` (the turnaround phrase);
- `2026-10-02-radio-fold-mode-design.md` and `2026-10-03-radio-fold-v2-design.md` (fold's own pace);
- `2026-10-03-radio-faves-dial-design.md` (a fader committed on release).

## Why

Elling, testing the web radio on his phone (2026-10-03):

- "changes are quite slow still, even at fast setting. maybe we could speed it up... even a
  slider? up to a ludicrous mode."
- "i'd like more ways to try to strike a balance and find the sweet spot.. even within a stream".
- Later the same day, on the top end: "extreme should be extreme! i can fine tune. yes mid loop is
  fine".

**Root cause, measured.** `fast` draws 3-6 bars (`RADIO_PACE_BARS`). But the web radio runs a 16-bar
phrase grid (`WEB_RADIO_DEFAULTS.phraseBars = 16`), and `comingWrapOnPhrase` / `advanceRadioClock`
only let a change land on a phrase wrap. So at 120 bpm the web changes at most every 32 s whatever
the pace. Simulated with the shared clock at 120 bpm:

| web today | 4-bar loop | 8-bar loop |
|---|---|---|
| slow | 90 s | 87 s |
| mid | 36 s | 36 s |
| fast | 32 s | 32 s |

On the web, mid and fast are almost the same thing. The desktop's default phrase is `loop` (0),
so its fast really is faster: 12 s on a 4-bar loop.

## Decisions (Elling and the coordinator, 2026-10-03)

1. **One `pace` value, 0-100,** replaces the slow / mid / fast chips in both radios. A pure shared
   function maps it to everything that sets cadence.
2. **Anchors.** slow, mid and fast each sit at a fixed position and reproduce today exactly there;
   on the web, fast includes phrase 16. Old saved settings migrate to a position.
3. **Above fast** the phrase grid shortens, the window shrinks, and (overriding the first brief,
   on Elling's later word) the top of the range lands changes **mid-loop on bar lines**, long stems
   included, down to every bar, with more rows per change. The lower range, up to and somewhat past
   fast, keeps landing on loop tops as now.
4. **Turnarounds keep their 16-bar cadence** at every pace.
5. **Live adjustment.** The slider commits on release and is heard from the next interval draw. It
   does not take back an armed turnaround, unfold fold, or cancel queued changes.
6. **Copy:** lowercase, no emoji. The label is `pace`; the readout is a word at the anchors and
   through ludicrous, and bars elsewhere.

## 1. The profile

`radioPaceProfile(level)` (new `src/shared/radioPace.ts`) is pure and has no randomness. It
returns four things:

- **`window`:** the bars drawn for each interval. These are knots, each edge interpolated
  **geometrically** between them and rounded to whole bars. Bars are a ratio scale: 3 to 6 is as
  big a step as 24 to 48.
  - The knots: 0: 24-48 (slow), 25: 8-16 (mid), 50: 3-6 (fast), 60: 2-4, 70: 1-2, 100: 1-1.
  - Both edges are non-increasing in the level (tested at every level).
- **`phraseCap`:** a cap on the phrase grid a change may land on.
  - `null` (the runtime's own phrase) up to 50.
  - 8 bars for 51-60, 4 bars for 61-70.
  - 0 (no phrase grid, so every loop top) above 70.
- **`barEvery`:** from 80 up, a change may also land **mid-loop**, on bar lines this many bars
  apart: every 4 bars for 80-86, 2 for 87-93, 1 for 94-100. `null` below 80.
- **`rows`:** rows changed per change.
  - 1 up to 70, then linear to 4 at 100: 1.5 at 75, 2 at 80, 3 at 90, 3.5 at 95.
  - The fraction is the chance of one more row (`radioPaceRowsThisChange`), which never draws
    randomness while `rows` is whole.

`radioCadenceOf(settings)` (in `radioSchedule.ts`) applies the profile to a runtime and is the
**only** thing either radio reads cadence from. It returns:

- `window`;
- `phraseBars`: the change phrase, which is the runtime's own phrase (web 16, desktop `phrase`
  chip) under the cap. A base of 0 stays 0;
- `turnaroundPhraseBars`: always the runtime's own phrase. The slider never moves it;
- `barEvery`;
- `rows`.

Two cases bypass the profile:

- **Fold mode on:** the result is fold's own window (`FOLD_PACE_BARS`), the base phrase, no
  mid-loop landings and one row, as today.
- **A settings object with no `paceLevel`:** it reads exactly as before the slider, using its
  `paceBars` window. That is how every web test pins a window, and none of them change meaning.

### The table

Simulated at 120 bpm (one bar = 2 s) with the shared clock (`advanceRadioClock` at 30 Hz,
intervals drawn from the window). "Desktop" is its defaults (`phrase` loop, `loop end` 4) with
stems as long as the loop. A desktop loop with shorter stems already turns them over on their own
2- or 4-bar cycles below the bar band.

| level | readout | window (bars) | change phrase (web) | mid-loop grid | rows / change | turnaround phrase | web, 4-bar loop | web, 8-bar loop | desktop, 4-bar | desktop, 8-bar |
|---|---|---|---|---|---|---|---|---|---|---|
| 0 | slow | 24-48 | 16 | – | 1 | 16 bars (32 s) | 90 s | 87 s | 79 s | 81 s |
| 12 | 14-28 bars | 14-28 | 16 | – | 1 | 16 | 60 s | 60 s | 47 s | 52 s |
| 25 | mid | 8-16 | 16 | – | 1 | 16 | 36 s | 36 s | 29 s | 32 s |
| 38 | 5-10 bars | 5-10 | 16 | – | 1 | 16 | 32 s | 32 s | 20 s | 22 s |
| 50 | fast | 3-6 | 16 | – | 1 | 16 | 32 s | 32 s | 12 s | 16 s |
| 55 | 2-5 bars | 2-5 | 8 | – | 1 | 16 | 16 s | 16 s | 10 s | 16 s |
| 60 | 2-4 bars | 2-4 | 8 | – | 1 | 16 | 16 s | 16 s | 8 s | 16 s |
| 65 | 1-3 bars | 1-3 | 4 | – | 1 | 16 | 8 s | 16 s | 8 s | 16 s |
| 70 | 1-2 bars | 1-2 | 4 | – | 1 | 16 | 8 s | 16 s | 8 s | 16 s |
| 75 | 1-2 bars | 1-2 | loop | – | 1.5 | 16 | 8 s | 16 s | 8 s | 16 s |
| 80 | every 4 bars | 1-2 | loop | 4 | 2 | 16 | 8 s | 8 s | 8 s | 8 s |
| 85 | every 4 bars | 1-1 | loop | 4 | 2.5 | 16 | 8 s | 8 s | 8 s | 8 s |
| 90 | ludicrous | 1-1 | loop | 2 | 3 | 16 | 4 s | 4 s | 4 s | 4 s |
| 95 | ludicrous | 1-1 | loop | 1 | 3.5 | 16 | 2 s | 2 s | 2 s | 2 s |
| 100 | ludicrous | 1-1 | loop | 1 | 4 | 16 | 2 s | 2 s | 2 s | 2 s |

Reading the table:

- **The columns.** The seconds are the time between changes. Multiply by rows per change for row
  turnovers.
- **The web's own runtime agrees.** The web's reducer, driven by its test harness (`step.test.ts`
  Sim, 4-bar loop, turnarounds `often`), measured 32, 16, 8, 8, 8, 4 and 2.2 s at 50, 55, 65, 75,
  80, 90 and 95. That matches the shared simulation; at 95 an occasional change misses its bar and
  lands at the wrap.
- **The desktop's 32-bar `phrase` chip** scales the same way. At 51 its cap of 8 takes it straight
  from 32 to 8 (flag 9).
- **At the top**, extra rows and a change every bar mean most of a 4-5 row bed turns over every
  2 s. That is what "extreme" was asked to be.

## 2. Anchors and migration

- **Anchors:** slow 0, mid 25, fast 50, ludicrous 90 (`RADIO_PACE_ANCHORS`).
  - At slow, mid and fast the window equals `RADIO_PACE_BARS`, the phrase cap is none, and there is
    one row and no mid-loop landing.
  - So on the web, fast is phrase 16 with 3-6 bars, exactly as now.
  - Half the slider lies above fast, because that is where he is asking to go.
- **Desktop settings** (`discoverSettings.json`, `RadioSettings`):
  - A new field, `paceLevel`. A saved level wins.
  - Otherwise the old `pace` word (or the flat 1.3.0 `radioPace`) and any `paceBars` window become
    a level (`radioPaceLevelFromLegacy`):
    - a window equal to a preset's is that preset;
    - a hand-tuned window is the level whose window is nearest in log space, searched **only up to
      fast**. A migrated setting therefore never quietly turns on a shorter phrase, mid-loop
      landings or extra rows;
    - on a rounding tie, an anchor wins.
  - `pace` and `paceBars` stay in the type, as legacy fields read only for migration and for the
    no-level reading above.
- **The desktop's min/max steppers are removed.** They existed because three chips were too
  coarse ("maybe allow for a specific range selection instead of just slow mid and fast?",
  2026-09-28). The slider is that range selection:
  - its window moves in whole-bar steps across 101 positions;
  - two controls writing one window would fight: a slider move would silently discard stepped
    edges, or steppers would leave the slider showing a position the clock is not drawing from.
  - A hand-tuned window survives as its nearest level.
- **Web:** nothing was ever stored for the chips; they reset to fast on every page load.
  - The level is new: `localStorage['radio.pace']`, missing or unreadable meaning fast (50).
  - `WEB_RADIO_DEFAULTS` is unchanged; `main.ts` passes the listener's level when it makes the
    radio.

## 3. Above fast

- **50-70: shorter phrases.** A change still lands only on a loop top that is a whole phrase from
  the last, now 8 bars and then 4. On the web that halves and then quarters the 32 s.
- **71-79: every loop top.** The phrase grid is off. On the desktop, short stems keep turning over
  on their own cycles (`loop end`), as they do today with its default phrase.
- **80-100: the bar band (mid-loop).** Elling: "extreme should be extreme ... yes mid loop is fine".
  - **Where it can land.** Any stem no longer than the loop may come in on a bar line every 4, 2 or
    1 bars (`radioPaceGridBars`, the grid stepped down to divide the loop).
  - **What still waits for the loop top**, as now:
    - a stem **longer than the loop**: it would lengthen the loop mid-lap, and the web's
      `Timeline.swapAt` refuses it;
    - a stem whose length is **not known yet**;
    - a loop of fractional bars.
  - **How it enters: at its matching position, not from its start.** A stem landing at bar 5 of an
    8-bar loop plays its own bar 5. This is the right choice:
    - **Both engines already do exactly this.** The web's `scheduleSwapAt` starts a stem at
      `rowOffset` with 3 ms anti-click fades. The desktop tiles every stem at its own length from
      the loop's top, and a staged project at `atBars` (`stage-project`) lands it in phase. That is
      how the desktop's own-cycle cuts work today. So the change needs no engine work at all.
    - **Every row stays phase-locked to the loop.** At the next wrap every stem is at its own zero
      together. A mid-loop entry reads as a part that was already playing and is now let in, like a
      DJ opening a channel.
    - **From its start** would put the stem's bar 1 at loop bar 5, then jump back at the wrap: a
      mid-phrase restart, audible as a stutter. It would also need a per-stem start offset in the
      engine project (`EngineProject` / `buildEngineProject`, the hand-synced wire-format pair),
      and it would break the fold `CycleTable`'s rule that a cycle's origin is a loop top.
    - This is exactly the "8-bar stem in halfway through itself" Elling heard on 2026-09-28
      (687641a). He has now accepted it for the top of the range only. Below 80 nothing changes.
  - **Mid-loop landings are cuts** (`radioCadenceTransition`):
    - an arrival gesture would be held to the loop top (`radioChangeWaitsForLoopTop`);
    - a leading gesture needs the lap before a wrap;
    - either would hand the pace back.
    - A change that lands on a loop top keeps its transition.
  - **Fold:** it is off in the bar band. Fold mode's cadence overrides the slider, and a folded row
    therefore never gets a mid-loop swap.
  - **Turnarounds** sit on each row's own nodes in both engines (the web's
    `Gestures.applyTurnaround`; the desktop's slot curves), independent of which stem is playing. A
    mid-loop cut during a turnaround's lap keeps the move. No extra rule is needed; the change that
    lands on the phrase wrap itself keeps only its arrival, as today.
- **Rows per change (70-100), "companions".** When radio arms its pick it also arms `n - 1`
  companion rows:
  - **How many and which:** `n` is drawn from `radioPaceRowsThisChange`. The rows come from
    `pickRadioSlotIds`, whose first id is exactly today's `pickRadioSlotId` with the same random
    draws, so `n = 1` is today.
  - **Warming:** companions are picked and warmed alongside the primary.
  - **At the decision**, the companions that are ready and still eligible ride it as cuts on the
    same line. Any that are not ready are dropped, never waited for; their rows go back to radio.
  - **Desktop** puts them in the same staged project, so they land or are taken back atomically
    with the primary.
  - **Web** schedules them right after the engine accepts the primary:
    - a companion the engine refuses is dropped;
    - a take-back of the primary takes them back too;
    - a companion whose take-back is refused (too late) is committed when its time comes, so the
      state never disagrees with the engine.
- **Nothing finer than a bar.** "Every bar or faster" is reached by rows per change: up to 4 rows
  on every bar at 100. Beat-level landings would need the web's `Timeline.swapAt` to accept beat
  lines and `radioGridBars`' integer grid to go fractional. That is not in this build (flag 1).

## 4. Live adjustment

The slider sends one value when it is released:

- **Web:** the range input's `change` event.
- **Desktop:** pointer-up, key-up or blur, the faves fader's pattern from `9171461`.

The readout follows the drag.

**Today a pace chip is a course change.** On both radios it does all of this:

- a new clock and a new phrase;
- the pick dropped and a held change cancelled;
- the turnaround taken back;
- fold reset;
- gestures cleared;
- on the desktop, the transport seeked to 0.

The slider does **none** of it. `radioClockForPace` is the whole of what happens (both radios),
and it does two things:

1. **The running interval is redrawn only if it is now longer than the new window allows.** The
   bars already elapsed are kept, so an interval already spent comes due at the next boundary.
   - Without this, moving from slow to ludicrous would wait out up to 48 bars (96 s) of a slow
     interval before anything was heard. That fails "find the sweet spot within a stream".
   - Moving slower lets the short interval finish; the next is drawn from the new window.
   - **This goes slightly beyond "from the next interval draw"** (flag 5). It is necessary for the
     slider to be audible within the stream.
2. **The change phrase is re-anchored on the turnaround's.**
   - **The mechanism:** the change gate counts `lapsSincePhrase`; turnarounds count
     `turnaroundLap`. They start together and agree while the two phrases are one number. If the
     change phrase grows mid-stream (from 4 bars back to 16, say), its counter carries on from
     wherever it was, and changes would land a lap or three off the turnaround's phrase end. The
     turnaround would then no longer be the change's lead-in, for the rest of the stream.
   - **The fix:** when the new change phrase divides the turnaround phrase (16, 8 or 4 bars of
     loops that divide 16), `lapsSincePhrase` becomes `turnaroundLap` modulo it.
   - **Proved by test:** after any move, every change lands on lap 0 of the turnaround phrase (or
     a division of it). Without the re-anchor a test shows the drift.
   - **This is required for correctness**, not taste.

**Kept as they are:**

- the pending pick and a decided change, scheduled or not, including a mid-loop one;
- an armed turnaround and a waiting turn;
- gestures already armed;
- fold and its machine;
- manual changes;
- the density arc;
- the transport.

**The desktop** applies `radioClockForPace` in an effect on `radioSettings.paceLevel`. It is
declared **before** the clock effect, so React runs it first in the commit that carries the new
setting, and the clock's next tick sees a re-anchored phrase.

## 5. Turnarounds, decoupled

- **Today one number does two jobs.** `advanceRadioClock` reads `phraseBars` both for the change
  gate (`radioPhraseLaps`) and for the turnaround's count (`turnaroundPhraseLaps`: 16 when the
  phrase is 0).
- **The fix:** it gains a sixth argument, `turnaroundPhraseBars`, which defaults to `phraseBars`,
  so every existing caller is unchanged (tested). Both radios pass `radioCadenceOf`'s
  `turnaroundPhraseBars`, which is the runtime's own phrase, whatever the level.
- **The same base goes everywhere the turnaround phrase is read:** `radioReadoutBars` (the phrase
  ruler) and the turnaround rolls (via `turnaroundLapStarts`).
- **Everywhere a change's landing is predicted, the change phrase is used:**
  `radioChangeDueAtNextWrap`, `radioChangeLandsAtBar`, `radioBarsUntilChange`, the web's
  `comingWrapOnPhrase` and its readout's `coming()`.
- **Result:** turnarounds every 16 bars (web) at every level. Between them, changes every 8, 4, 1
  bars or every loop top. The ruler still shows the 16-bar phrase.
- **Fold:** its "a phrase end on a realignment top prefers a turnaround" still reads the
  turnaround's phrase end, and is unchanged.

## 6. UI and copy

- **Web full mode:** the slow / mid / fast buttons become one `pace` knob, in the existing knob
  style, so it wraps on a phone.
  - Range 0-100, step 1.
  - The readout beside it is `radioPaceLabel`: `slow`, `mid`, `fast` at their positions;
    `ludicrous` from 90; `every 4 bars` / `every 2 bars` / `every bar` in the bar band;
    `3-6 bars`-style windows elsewhere.
  - Tooltip: `how often radio changes something`.
  - Remembered per visitor as `radio.pace`.
- **Web simple mode** has no pace control today ("i always just use fast myself") and gets none.
  - The `pace` control id stays, and `nextPace` now cycles the anchors: slow → mid → fast →
    ludicrous → slow.
  - No key is bound (none was).
  - The `pace-slow` / `pace-mid` / `pace-fast` control ids go.
- **Desktop radio menu:**
  - The pace chips and the `bars` steppers become one `pace` row: the slider and the same readout,
    committed on release.
  - In the **start** prompt the row is the slider plus a `start` chip, which starts radio at the
    slider's position (flag 3). The channels and density rows are unchanged.
  - The `loop end` and `phrase` rows stay. `phrase` is now the base the slider shortens above fast;
    `loop end` still sets own-cycle landings below the bar band.
- **Web dev page** (`dev-radio.html`): the pace buttons become levels 0, 25, 50, 75 and 90.

## 7. Architecture

- **Shared:**
  - **`src/shared/radioPace.ts` (new, numbers only):**
    - the profile, its knots and bands, and the anchors;
    - `radioPacePhraseBars` and `radioPaceRowsThisChange`;
    - `radioPaceLabel`, `RADIO_PACE_LABEL` and `RADIO_PACE_TOOLTIP`;
    - `radioPaceLevelFromLegacy`, `normalizeRadioPaceLevel` and `nextRadioPaceAnchor`.
  - **`radioSchedule.ts`:**
    - `RadioSettings.paceLevel?` and its default and migration;
    - `radioPaceLevelOf` and `radioCadenceOf`;
    - `radioPaceGridBars` and `radioGridLineAtOrAfter`;
    - `radioCadenceTransition` and `radioClockForPace`;
    - `pickRadioSlotIds`;
    - `advanceRadioClock`'s `turnaroundPhraseBars`.
    - It imports `radioPace`; `radioPace` imports only a type back, so there is no runtime cycle.
  - **`radioReadout.ts`:** `nextChange.with`, the companions. The status line reads
    `next: row 2 +2 → bloom`, and each companion row reads `next · cut`.
- **Web:**
  - **`step.ts`:**
    - a `pace` event with `level`;
    - `radioCadenceOf` everywhere cadence was read;
    - the bar band:
      - `RadioLed.atBars`;
      - early decisions through `radioChangeLandsAtBar`;
      - a due-branch landing on the next line at least `BAR_LEAD_SEC` ahead;
      - `landAt` and `cancel` carrying `bar: true`;
      - a refused bar going to the loop top;
    - then companions.
  - **`controller.ts`:** `setPace(level)`; `landAtBar` via `Engine.scheduleSwapAt`; a bar
    take-back re-schedules the playing stem at its bar (a 3 ms dip, flag 12).
  - **UI:** `ui/pacePrefs.ts`, `full.ts`, `fullModel.ts`, `controlsModel.ts` and `main.ts`.
- **Desktop:**
  - **`DiscoverRadioMenu.tsx`:** the slider and the start chip; the steppers and chips go.
  - **`DiscoverPanel.tsx`:**
    - `radioCadenceOf` per render;
    - the pace effect;
    - `startRadio(level)`;
    - `armRadioCourseChange` deleted;
    - the grid through `radioPaceGridBars`;
    - `radioCadenceTransition` at both decision points;
    - then companions in the pending pick, the held change and the staged project.

## 8. Timing risks

Review caught most of the last session's bugs in radio timing: same-tick ordering, the lap clock
against the renderer's lap count, and hold or pause desync. The risks this feature brings, each
with a test or a stated reason:

1. **The phrase re-anchor runs on the same tick as a wrap.** The web applies it inside the
   reducer's `pace` event, between ticks. The desktop's effect order is the rule in section 4. Test:
   a move followed by a run never puts a change off the turnaround's lap 0.
2. **A mid-loop change decided early, then its bar slips past** (a slow stretch, a refusal). Rules:
   - `scheduleLedAtBar` re-aims to the next line at least `BAR_LEAD_SEC` ahead;
   - a refusal goes to the wrap path;
   - a bar line is never scheduled closer than the lead.
   - Tests: a refused bar lands at the top; every landing time is on a bar line.
3. **The due branch's interval origin.** In the bar band the interval counts from the grid line it
   came due on, not 0. An early one counts from its `atBars`. This mirrors the "counted from the
   boundary" fix (sssketch `700cb19`). Getting it wrong quickens or slows the pace by up to a grid
   cell per change.
4. **Hold while a mid-loop change is scheduled.** It is cancelled with `bar: true`, and the engine
   re-plays the playing stem from that bar. Test included. The 3 ms dip is flagged.
5. **Tempo changes.** A bar change never schedules while a tempo change is on its way:
   `scheduleLed`'s existing `tempoLanding` guard, and the web Timeline refuses a swap before a
   pending retempo.
6. **Companions on the web** are a second lifecycle riding the first. They are sent only after the
   primary is accepted, dropped on refusal, taken back with it, and committed on time if their
   take-back fails. Each of those four paths needs its own test (plan Task 8).
   - The density arc must count a companion's row as busy (`ArcRow.busy`, the web's removal victim
     filter), or the arc could take out a row with a companion landing on it.
7. **The desktop staged swap at a bar, every bar.** Pushing a staged project every 2 s, with up to
   4 changed slots, is new load. It uses the existing path (`atBars`, already used by own-cycle
   cuts). Watch the `[radio]` trace for late stages at 95-100.
8. **Web fetch and stretch throughput at the top.** Companions that are not ready are dropped, so
   cadence degrades gracefully, but the realised rows per change at 95-100 may fall well under 4.
   Watch with `?dev`.

## 9. Testing

- **Shared (TDD, sssketch vitest):**
  - **`radioPace.test.ts`:**
    - the anchors reproduce `RADIO_PACE_BARS`;
    - both window edges are monotone at every level;
    - the phrase caps, bar bands and rows;
    - normalising;
    - the phrase-base rules;
    - rows draw no randomness when whole;
    - the labels;
    - the legacy migration, including ties;
    - the anchor cycle.
  - **`radioCadence.test.ts`:**
    - the decoupled `advanceRadioClock`, where the default keeps old callers identical and a
      4-bar change phrase runs alongside a 16-bar turnaround;
    - `paceLevel` migration;
    - `radioCadenceOf`: anchors, no-level legacy, fold;
    - `radioPaceGridBars`, `radioGridLineAtOrAfter` and `radioCadenceTransition`;
    - `radioClockForPace`: interval redraw only when longer; re-anchoring, with the property test
      and the drift it prevents;
    - `pickRadioSlotIds`: identical draws at count 1.
  - **`radioReadout.test.ts`:** companions in the status line and the rows.
- **Web (`step.test.ts`):**
  - The pace event takes nothing back: the decided change, the clock, an armed turnaround and fold
    all stay.
  - A faster move redraws a long interval.
  - Turnarounds stay on 4-lap boundaries at 50-75 while changes speed up.
  - The bar band:
    - 95 lands about a cut a bar, every landing on a bar line;
    - 90 lands on even bars;
    - 75 lands on tops only;
    - a stem longer than the loop waits;
    - a refused bar goes to the top;
    - hold cancels with `bar: true`;
    - moving into the band mid-stream works, with turnarounds kept.
  - Companions (Task 8).
  - Also: `pacePrefs.test.ts`, `fullModel.test.ts`, `controlsModel.test.ts` and
    `settings.test.ts`.
- **Desktop:** typecheck, lint and the shared tests. The panel glue has no tests, by convention.
- **No agent can hear or see any of this.** Elling's walkthrough:
  1. **Web, phone, full mode:**
     - At fast it plays as before.
     - Dragging the pace knob updates the word; release is heard within a change.
     - At 55-65 changes come every 16 s, then 8 s.
     - From 80, mid-loop cuts.
     - At ludicrous, most of the bed every bar.
     - Turnarounds still every 16 bars throughout.
  2. **Mid-stream moves:**
     - An armed turnaround (on the ruler) survives a move.
     - Fold stays folded.
     - Moving back down settles.
  3. **Desktop:**
     - The start prompt starts at the slider's position.
     - A running move does not seek or reset.
     - A saved hand-tuned window shows as a nearby level.
     - The `phrase` chip still caps; `loop end` still works below 80.
  4. **Both, long stems at 90+:** an 8-bar stem enters mid-loop at its own matching bar. Elling
     to judge by ear whether that is the "extreme" he wanted.

## Flags for Elling

1. **Nothing finer than a bar.** "Every bar or faster" is every bar plus up to 4 rows per change.
   Beat-level landings are possible later, but need engine-side grid work in both runtimes.
2. **Fold mode ignores the slider**, as it ignored the pace chips: fold has its own 8-32 bar
   window. Should the slider scale fold's window too?
3. **Desktop start prompt:** the slider plus a `start` chip replaces "pick slow / mid / fast to
   start".
4. **The desktop course change is gone.** A pace change no longer seeks to 0 and re-triggers the
   bed. `new bed` stays for a dramatic turnover.
5. **Faster moves take effect at once.** Moving faster also shortens the interval running, so the
   move is heard within the stream.
6. **The desktop's hand-tuned min/max steppers are removed.** A saved window becomes its nearest
   level at or below fast.
7. **Web throughput may cap the top.** The web may not fetch and stretch 3-4 stems a bar; the
   companions that are not ready are dropped. Check what 95-100 really does on a phone.
8. **The phone remote has no pace control** (it never had one). An `/api/pace` and a slider there
   is a small follow-up if wanted.
9. **A desktop `phrase` of 32** jumps to 8 just above fast, with the cap stepping 8 → 4 → loop.
10. **On the web, slow / mid / fast stay nearly the same** (90, 36, 32 s): the anchors reproduce
    today faithfully, phrase 16 included. If you want them to differ, the web's base phrase could
    drop below 16, but that would change today's fast.
11. **Mid-loop landings are always cuts.** Transitions remain on loop-top landings.
12. **Web: hold or skip taking back a scheduled mid-loop change** replays the playing stem from
    that bar, which gives a 3 ms anti-click dip.
13. **`ludicrous` starts at 90** (every 2 bars, 3 rows per change). 80-89 reads `every 4 bars` /
    `every 2 bars`.

## Out of scope

- Beat-level landings.
- The slider scaling fold's window.
- A phone remote pace control.
- Per-stem onset compensation (handoff open thread 1).
- Changing the density arc's leg lengths. The arc is the bed's size over minutes, not how often
  things change.
- Changing turnaround rates. `rare` / `often` per phrase end are unchanged; the phrase stays 16.
