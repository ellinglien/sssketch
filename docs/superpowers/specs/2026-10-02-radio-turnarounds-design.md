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

The theory behind it is §0. It changed several numbers below.

This spec is the phrase turnaround. The full **breakdown → build → drop** section (controls spec
§4.7) is the natural follow-up, and gets its own design.

## Decisions (Elling, 2026-10-02)

- Turnarounds **absorb drop-outs**. The `drop-outs` row becomes `turnarounds: off / rare / often`,
  and today's drum drop-out is one move among several.
- They happen **only at phrase ends**, not once per interval.
- The palette is: **drops** (drums, low end, stop), **reverb wash**, **filter moves** (high-pass lift,
  low-pass dip) and the **riser**.
- Approach: one pure planner, shared by both radios. Each radio writes its own playback.
- The research in §0 is folded in: turnarounds are at most 4 bars long, a stop keeps a melodic row,
  bass and kick go first, thinning foreshadows what really leaves, the stop is rarer, and a shorter
  repeat may follow a turnaround.

## 0. The theory, and what it decides

Sources, read in full on 2026-10-02:
- **Solberg 2014**, "Waiting for the Bass to Drop", *Dancecult* 6(1);
- **Solberg & Dibben 2019**, *Music Perception* 36(4). It is peer-reviewed, and measured skin
  conductance;
- **Iler 2011**, "Formal Devices of Trance and House Music", MM thesis, UNT. It carries Butler's
  *Unlocking the Groove* model;
- **Garcia 2005**, *Music Theory Online* 11(4);
- **Glancey 2020**, an undergraduate study, treated as directional only.

[SB] means a source says it; [INF] means it is our inference.

- **Uncertain when, certain that.** Listeners know a change is coming. The pleasure is in not
  knowing precisely when or how (Huron's model, as applied by Solberg p.67; Garcia [6.2]). [SB]
  - *So:* the turnaround's timing is rolled, but the move always lands exactly on the one.
- **Hypermeter.** Layers enter and leave "after 2, 4, 8, 16 or 32 bars" (Solberg p.66). Music groups
  in 4-bar hypermeasures (Iler pp.7–8). "Variation almost always occur[s] just before a… hypermetrical
  downbeat" (Butler 2006:189, via Iler p.38). [SB]
  - *So:* moves sit at the end of the phrase's last hypermeasure. They last at most 4 bars and
    default to the last bar.
- **Tension is additive, release is return.** "The return to a basic groove" is the release (Iler
  p.ix). Removing something gives contrast, and the reward is everything coming back at once. [SB]
  - *So:* every move ends with every row at full level on the one.
- **Bass and kick are the lever.** A breakdown removes "most importantly the bass and the bass drum"
  (Solberg p.67), and the drop is their return. A layer left playing shrinks the release (Iler p.9,
  pp.88–89). Cutting the kick for about 4 bars and bringing it back is "one of the most powerful
  things a DJ can do" (Butler, via Iler p.1). [SB]
  - *So:* a **low drop** (drums and bass together) is in the palette, and when a move removes rows,
    those go first.
- **Contract the spectrum, then expand it.** Energy moves into the highs before the return (Solberg
  pp.70–71). Opening a low-pass filter fully is another proven announcement (Solberg & Dibben
  p.380). [SB]
  - *So:* the lift and the dip.
- **The rest measure.** Just before the arrival, percussion stops while one hook line continues. This
  suspends the tension and makes the release stronger. It lasts from 1 beat to 2 bars, about the
  length of the line that keeps going (Iler p.27, pp.35–36). [SB]
  - *So:* the stop keeps a melodic row, never drums.
- **Diminution escalates.** The same move repeated shorter each time (4 bars, then 2, then 1)
  builds, as in Iler's false arrivals (pp.94–95). [SB]
  - *So:* a turnaround may follow a turnaround only as a shorter repeat of the same move.
- **Big moves are rare.** A track has about two break routines, and the second is the stronger
  (Solberg p.66; Solberg & Dibben p.373). [SB]
  - *So:* the stop, the biggest move here, is drawn less often. [INF] The full section belongs to
    the next spec.
- **A return reads as growth.** Removing rows that come back at the top is a mini-drop: tension and
  release, not thinning. [INF, consistent with Iler p.4 n.15, p.9 n.19]
  - *So:* while the arc thins, moves foreshadow what actually leaves, or soften the whole mix
    (wash, dip). They do not drop rows that will return.
- No source gives a frequency for phrase-end moves. The 1-in-3 and 2-in-3 rates are a guess to tune
  by ear. [INF]

## 1. When

- **Phrase length.**
  - When `phraseBars` is 16 or 32, the phrase is that long; when it is 0, the phrase is 16 bars.
  - `turnaroundPhraseLaps(phraseBars, loopBars) = max(1, ceil(phrase / loopBars))`. So a loop of 16
    bars or more makes every wrap a phrase end, and a phrase is never shorter than its bar count.
    A 32-bar loop therefore has a 32-bar phrase, not two 16-bar halves.
- **Counting.**
  - The turnaround clock counts laps since the last phrase end. It runs whatever `phraseBars` is:
    today `lapsSincePhrase` is reset when `phraseBars` is 0, and the turnaround count must not be.
  - The first possible turnaround is at the end of the first whole phrase after radio starts.
- **Roll.** At the start of the lap that ends a phrase, roll once:
  - `rare` fires 1 time in 3 and `often` 2 times in 3, from the injected random source;
  - **never at two phrase ends in a row**, with one exception, **diminution**: after a drum drop,
    low drop or lift, the next phrase end may repeat the same move at half its length. Two halvings
    at most, rolled at the same rate, and never below 1 beat (§0);
  - `off` never fires.
- **Anchor.** Every move **ends on the one** of the wrap that closes the phrase. It is counted
  backwards from that wrap, as the controls spec's rule (0A.4) requires.

## 2. The moves

Every duration is clamped to **min(half the loop, 4 bars)**: one hypermeasure at most (§0). A move
whose shortest length does not fit is left out of the draw.

| move | rows | shape over its length | length |
|---|---|---|---|
| **drum drop** | one drums row | volume 0, back to 1 on the one (today's `buildDropOutCurve`) | 1, 2 or 4 beats (`pickDropOutBeats`) |
| **low drop** | every drums row and every bass row | the same curve | 2 beats, 1 bar or 2 bars |
| **stop** | every audible row but one | the same curve | 1 beat, 2 beats or 1 bar (weighted 2 : 2 : 1), never longer than the kept row's own loop |
| **reverb wash** | a row leaving at that wrap if the arc removes one; else every non-drums row | send rises from the row's own send to 0.85, back to its own on the one | 1 bar |
| **high-pass lift** | every row but drums | high-pass cutoff rises 0 → 0.6, back to 0 (open) on the one | 1 or 2 bars |
| **low-pass dip** | every row but drums | low-pass cutoff falls 1 → 0.35, back to 1 on the one | 1 bar |
| **riser** | none (its own voice) | the existing riser, with its drawn character | 1, 2 or 4 bars |

- **Which row stays playing in a stop:** it is a melodic row, never drums or bass (§0, the rest
  measure). In order:
  - the hook row, if it is neither drums nor bass;
  - else a lead row;
  - else any row that is neither drums nor bass.
  With no such row, the stop is out of the draw.
- **Guards.** A move is only in the draw when it can sound and leaves music playing:
  - drum drop needs a drums row; low drop needs a drums or a bass row;
  - drops and stop need at least 2 audible rows;
  - wash needs a non-drums row;
  - filter moves need at least one row that isn't mid filter-in;
  - no move may silence every row.
- **Choosing a move.** It is weighted by where the density arc is heading (`radioDensity`):

| arc | drum drop | low drop | stop | wash | lift | dip | riser |
|---|---|---|---|---|---|---|---|
| growing | 2 | 3 | 1 | 0 | 3 | 0 | 3 |
| thinning | 0 | 0 | 0 | 3 | 0 | 3 | 0 |
| steady or off | 2 | 2 | 1 | 1 | 2 | 1 | 1 |

  - "Steady" means the arc is at a peak or trough hold, or density is off.
  - **The leaving row in the radios (found in review, 2026-10-02).** Both radios pull an exiting row
    with an 8-beat exit drop-out before the wrap, so a wash on that row would be silent. So the radios
    never pass `leavingRowId`; they mark the exiting row not audible for the roll, and the wash goes
    to the non-drums bed. A consumer whose exit really sounds up to the wrap, such as auto-arrange,
    may pass it.
  - **Thinning drops nothing.** Rows that come back on the one read as growth (§0). So a thinning arc
    washes the row that is leaving, or dips the whole mix.
  - The stop is the rarest move everywhere (§0).

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

## 4a. Controls (Elling, 2026-10-02, added with the plan)

Two lean controls beside the rate, and no other knobs. They are built in their own tasks after
the core, so the core can ship without them.

- **`moves`**: a multi-select of four families. All are on by default.
  - The families:
    - drops: drum drop, low drop, stop;
    - wash;
    - filters: lift, dip;
    - riser.
  - The draw skips a family that is off, and so does diminution.
  - With none enabled, turnarounds behave as `off`.
  - `RadioSettings.turnaroundMoves` is normalised: an unknown entry is dropped, and anything
    that is not a list reads as all four.
- **`depth: subtle / bold`**, `bold` by default on both radios. Bold is §2's own numbers.

| depth | lift top | dip floor | wash peak | longest move |
|---|---|---|---|---|
| bold | 0.6 | 0.35 | 0.85 | min(half the loop, 4 bars) |
| subtle | 0.35 | 0.6 | 0.6 | min(half the loop, 1 bar) |

  - The setting is `RadioSettings.turnaroundDepth`.
  - The planner takes both as optional inputs, `moves` and `depth`. Without them it behaves as
    all four families at `bold`.
- **Where they appear:**
  - **sssketch `DiscoverRadioMenu`:**
    - `moves` and `depth` chip rows sit under `turnarounds`, shown while it is not `off`;
    - tooltips are `which moves` and `how far`.
  - **ell.ing/radio full mode:**
    - four family toggles and a depth toggle sit beside the listener's effects (saturation,
      pump, echo);
    - they are remembered per visitor in `localStorage['radio.turnarounds']`;
    - simple mode gets nothing new;
    - the web radio has no rate control (`often`).
  - **The phone remote** shows no radio settings, so it gets nothing.

## 5. Architecture

### Shared: `sssketch/src/shared/radioTurnaround.ts` (pure, tested in sssketch)

- `turnaroundPhraseLaps(phraseBars, loopBars): number`
- `rollTurnaround(input): TurnaroundPlan | null`. The input is:
  - `rate`, `random`, `loopBars`;
  - `lastPhrase`: the move and length that fired at the previous phrase end, or null. It drives
    "never two in a row" and diminution;
  - `rows`: id, kinds, `hooked`, `audible`, `inFilterIn`, `barLength`;
  - `arc: 'growing' | 'thinning' | 'steady'`;
  - `leavingRowId`: the row the arc removes at this wrap, if any.
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
  - rate frequencies with a seeded random;
  - never two phrase ends in a row, except diminution: the same move, half the length, at most two
    halvings, never under 1 beat;
  - every guard, including that a move never silences everything, that the stop keeps a melodic row
    (never drums or bass) and is out of the draw without one, and that a thinning arc never drops a
    row;
  - the low drop removes every drums and bass row together;
  - the wash targets the leaving row when there is one;
  - direction weights;
  - every curve's last point is on the one at full value, and its length is clamped to min(half the
    loop, 4 bars);
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

## 7. Next: auto-arrange uses the same planner

The planner is pure, and it does not know who plays its plans. Auto-arrange is planned as a third
consumer, after the radios have been tuned by ear. It gets its own short spec.

- **The pass.** After `runAutoArrangeBuild`, one pass walks every section boundary. It calls
  `rollTurnaround` and writes each plan as clip automation on the timeline:
  - volume, filter cutoff and mode, and reverb send become ordinary toolkit lanes, at the last
    bars of the clips in the section that is ending;
  - a riser becomes a clip on the riser row.
  The output is visible, editable, and exported like any other automation.
- **Direction is known, not guessed.** Rows entering, or a boundary into build or peak, mean
  `growing`. Rows exiting, or a boundary into breakdown or outro, mean `thinning`. The row that
  exits is `leavingRowId`.
- **The build → peak boundary is the drop.** That boundary favours the low drop and the riser,
  Solberg's and Butler's central move (§0).
- **It runs once, at build time.** It stores no clip ids for later, per the arrangement map's lesson.

What this asks of the planner now:
- **All randomness comes from the injected `random`,** so a seeded auto-arrange rebuild gives the
  same turnarounds. The radios pass their own source.
- **Rows are identified by opaque ids.** The planner does not care whether an id is a radio slot or
  a timeline channel.
- **The plan is in beats before a boundary,** never in a runtime's own clock.
- **The arc is an input.** The planner never reads `radioDensity` itself.

## Out of scope

- The breakdown → build → drop section (next spec).
- Fills, loop roll, reverse and tape stop (engine work, controls spec §5.5).
- Delay throws (already in the native radio sound plan's Tasks 10–12).
- Choosing moves by stem analysis (transient density, brightness).
