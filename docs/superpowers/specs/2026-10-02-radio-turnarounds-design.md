# Radio turnarounds: the end of a phrase sounds like one

**Date:** 2026-10-02
**Scope:** sssketch's Discover radio and ell.ing/radio, built together.

## Why

Radio decorates a **layer change** well: cut, hole, filter in, bloom, duck, riser. But nothing marks
the **structure**. When no layer happens to change, a phrase ends exactly like any other bar.

Arranged loop music marks its phrase ends with a turnaround: drums drop out for a beat, the bass
drops for a bar, a reverb wash, a filter lift, a riser. Sources Elling pointed at, and the research
that followed:
- edmprod, "turnarounds": silence, filter moves, FX builds, reversal and delay throws, on the last
  1–4 bars of an 8–16 bar phrase;
- subtractive arrangement: sections made by revealing and hiding loops that are already playing;
- the DJ rule that big moves land on phrase boundaries.

This spec is the phrase turnaround. The full **breakdown → build → drop** section (controls spec
§4.7) is the natural follow-up, and gets its own design.

## Decisions (Elling, 2026-10-02)

- Turnarounds **absorb drop-outs**. The `drop-outs` row becomes `turnarounds: off / rare / often`,
  and today's drum drop-out is one move among several.
- They happen **only at phrase ends**, not once per interval.
- The palette is: **drops** (drums, bass, stop), **reverb wash**, **filter moves** (high-pass lift,
  low-pass dip) and the **riser**.
- Approach: one pure planner, shared by both radios. Each radio writes its own playback.

## 1. When

- **Phrase length.**
  - When `phraseBars` is 16 or 32, the phrase is that long; when it is 0, the phrase is 16 bars.
  - `turnaroundPhraseLaps(phraseBars, loopBars) = max(1, ceil(phrase / loopBars))`. So a loop of 16
    bars or more makes every wrap a phrase end, and a phrase is never shorter than its bar count.
- **Counting.**
  - The turnaround clock counts laps since the last phrase end. It runs whatever `phraseBars` is:
    today `lapsSincePhrase` is reset when `phraseBars` is 0, and the turnaround count must not be.
  - The first possible turnaround is at the end of the first whole phrase after radio starts.
- **Roll.** At the start of the lap that ends a phrase, roll once:
  - `rare` fires 1 time in 3 and `often` 2 times in 3, from the injected random source;
  - **never at two phrase ends in a row**;
  - `off` never fires.
- **Anchor.** Every move **ends on the one** of the wrap that closes the phrase. It is counted
  backwards from that wrap, as the controls spec's rule (0A.4) requires.

## 2. The moves

Every duration is clamped to **half the loop**, the existing rule for radio curves. A move whose
shortest length does not fit is left out of the draw.

| move | rows | shape over its length | length |
|---|---|---|---|
| **drum drop** | one drums row | volume 0, back to 1 on the one (today's `buildDropOutCurve`) | 1, 2 or 4 beats (`pickDropOutBeats`) |
| **bass drop** | one bass row | the same curve | 2 or 4 beats |
| **stop** | every audible row but one | the same curve | 1 or 2 beats |
| **reverb wash** | every non-drums row | send rises from the row's own send to 0.85, back to its own on the one | 1 bar |
| **high-pass lift** | every row but drums | high-pass cutoff rises 0 → 0.6, back to 0 (open) on the one | 1 or 2 bars |
| **low-pass dip** | every row but drums | low-pass cutoff falls 1 → 0.35, back to 1 on the one | 1 bar |
| **riser** | none (its own voice) | the existing riser, with its drawn character | 1, 2 or 4 bars |

- **Which row stays playing in a stop:** the hook row if there is one, else a lead row, else any row
  that is not bass, else any row.
- **Guards.** A move is only in the draw when it can sound and leaves music playing:
  - drum drop needs a drums row; bass drop needs a bass row;
  - drops and stop need at least 2 audible rows;
  - wash needs a non-drums row;
  - filter moves need at least one row that isn't mid filter-in;
  - no move may silence every row.
- **Choosing a move.** It is weighted by where the density arc is heading (`radioDensity`):

| arc | drum drop | bass drop | stop | wash | lift | dip | riser |
|---|---|---|---|---|---|---|---|
| growing | 1 | 0 | 2 | 0 | 3 | 0 | 3 |
| thinning | 2 | 2 | 0 | 3 | 0 | 3 | 0 |
| steady or off | 1 | 1 | 1 | 1 | 1 | 1 | 1 |

  "Steady" means the arc is at a peak or trough hold, or density is off.

## 3. Living with layer changes and other gestures

- **A change landing on the same wrap:** the turnaround is that change's lead-in. The change keeps
  only an arrival gesture (`filter in`, `bloom`, or none). Its leading gesture (`hole`, `riser`) is
  not armed. This also applies to manual changes: the turnaround is the lap's one leading gesture
  (`drawManualTransitions`).
- **Stacking on a row**, through a shared `combineRadioCurves`:
  - **volume** curves multiply, so a turnaround never cancels a hole, a duck or an arc exit;
  - **reverb send** takes the larger value at each point;
  - **filter:** a row already in a change's filter in is skipped by filter moves.
- The density arc's exit drop-out (`ARC_EXIT_BEATS`) is unchanged. It is an exit, not a turnaround,
  and multiplies like any volume curve.
- Hold, pause, a seek or radio off clears an armed turnaround, the same as drop-outs today.

## 4. Settings

- `RadioSettings.dropOuts` becomes `turnarounds: 'off' | 'rare' | 'often'`.
  - `normalizeRadioSettings` reads an old `dropOuts` when `turnarounds` is missing, so both apps
    carry over saved settings.
  - Defaults: sssketch `rare`; the web radio `often`, Elling's existing drop-outs choice in
    `WEB_RADIO_DEFAULTS`.
- **Menu (sssketch, `DiscoverRadioMenu`):** the `drop-outs` row is renamed `turnarounds`, with the
  same three chips. The tooltip is `end of phrase`.

## 5. Architecture

### Shared: `sssketch/src/shared/radioTurnaround.ts` (pure, tested in sssketch)

- `turnaroundPhraseLaps(phraseBars, loopBars): number`
- `rollTurnaround(input): TurnaroundPlan | null`. The input is:
  - `rate`, `random`, `firedLastPhrase`, `loopBars`;
  - `rows`: id, kinds, `hooked`, `audible`, `inFilterIn`;
  - `arc: 'growing' | 'thinning' | 'steady'`.
- `TurnaroundPlan = { move, beats, rows: TurnaroundRowCurves[], riserBars?: number }`
  - `TurnaroundRowCurves = { rowId, volume?, filter?: { mode, cutoff }, reverbSend? }`
  - Curves are points in **beats before the wrap** (0 = the one), so each runtime maps them onto
    its own clock.
  - The wash's send curve is relative (×1 at the edges, peaking at 0.85 absolute). Each runtime
    puts in the row's own send.
- `combineRadioCurves(a, b, lane)`: multiply for volume, max for send.
- `radioDropOut.ts` keeps `buildDropOutCurve` and `pickDropOutBeats`, which the planner uses.
  `rollIntervalDropOut` and `shouldScheduleDropOut` go once neither radio calls them.
- `radioSchedule.ts` gains a turnaround lap counter in `RadioClock` that runs whatever
  `phraseBars` is. `lapsSincePhrase`'s own behaviour is unchanged.

### sssketch (`DiscoverPanel.tsx`)

- On the wrap that starts a phrase's last lap, the panel calls `rollTurnaround` and arms the plan:
  - row curves become `stemAutomation` lanes on that lap, anchored to the loop top;
  - the lift sets the row's `filterMode` to high-pass for that lap;
  - the riser goes in through the existing riser clips.
- It clears them at the wrap, with the same arm-then-clear pattern as drop-outs and
  `clearRadioGesture`.
- The per-interval `rollRadioDropOut` call is removed.
- Curves are merged through `combineRadioCurves` where the panel builds a stem's lanes. That replaces
  "first volume curve wins".
- **No engine change:** volume, filter (with mode), reverb send and risers are all automatable today.

### ell.ing/radio

- **`src/radio/step.ts`** emits `{ type: 'turnaround', time: wrapTime, plan }` at the start of a
  phrase's last lap. This replaces `rollDropOut` and the `dropOut` event, and goes through
  `controller.ts` as `dropOut` does today, including the failure path.
- **`src/audio/rowVoice.ts`:** each row gains two nodes:
  - a **turnaround gain**, chained with the gesture gain, so the two stack by multiplying;
  - a **high-pass biquad**, neutral at 0 Hz.
- **`src/audio/gestures.ts`** gains `applyTurnaround(plan, wrapTime)`:
  - beats before the wrap are converted to seconds at the current bpm;
  - volume goes on the turnaround gain;
  - the lift goes on the high-pass;
  - the dip goes on the row filter, unless the row is in a filter in;
  - the wash goes on `send.gain` from the row's own send;
  - the riser goes through `playRiser`.
  It is cancelled on the same paths that cancel drop-outs (`cancelDropOuts`).
- `WEB_RADIO_DEFAULTS.turnarounds = 'often'`. Simple and full modes behave the same.

## 6. Testing

- **Shared (vitest, sssketch):**
  - `turnaroundPhraseLaps` across loop lengths, including fractional and ≥ 16 bars;
  - rate frequencies with a seeded random, and never two phrase ends in a row;
  - every guard, including that a move never silences everything and that the stop keeps the
    right row;
  - direction weights;
  - every curve's last point is on the one at full value, and its length is clamped to half the
    loop;
  - `combineRadioCurves`;
  - settings migration from `dropOuts`;
  - the clock's turnaround count with `phraseBars` 0, 16 and 32.
- **Web (vitest, radio repo):**
  - `step.ts` emits turnarounds only on phrase-end laps and never a `dropOut`;
  - `gestures.ts` schedules the right params at the right times, on the existing automation test
    pattern;
  - cancellation.
- **sssketch panel:** typecheck and lint; it has no component tests, by convention.
- **No agent can hear either radio.** Elling's walkthrough on both:
  1. With turnarounds `often`, phrase ends are audible.
  2. Each move ends exactly on the one.
  3. Moves follow the arc: lifts and risers while the mix grows, washes and dips while it thins.
  4. A layer change on a phrase end is led in by the turnaround.
  5. Old drop-out settings carried over.
  6. `off` is silent.

## Out of scope

- The breakdown → build → drop section (next spec).
- Fills, loop roll, reverse and tape stop (engine work, controls spec §5.5).
- Delay throws (already in the native radio sound plan's Tasks 10–12).
- Choosing moves by stem analysis (transient density, brightness).
