# Radio turnarounds, combined: layered moves and the gap after a riser

**Date:** 2026-10-03
**Scope:** sssketch's Discover radio and ell.ing/radio, built together.
**Builds on:**
- `2026-10-02-radio-turnarounds-design.md` (the planner, the moves, §0's theory);
- `2026-10-02-radio-turn-button-design.md` (turns and chips);
- `2026-10-03-radio-readout-design.md` (the phrase ruler, gesture flashes);
- `2026-10-03-radio-pace-slider-design.md` (the turnaround phrase stays 16 bars, decoupled from the
  change phrase; `advanceRadioClock`'s 6th argument). Nothing here touches cadence.

## Why

Elling, listening to the web radio (2026-10-03):

- "i think usually there is a drop out after a riser to build tension... so having the riser go all
  the way to the transition isn't as common?"
- "sometimes the riser works without it though, but i think rarely goes all the way to the end... or
  those transitions are usually COMBINED.. at least 2 or 3 of them, right"

Today a turnaround is exactly one move, and the riser always runs into the one.

## Decisions (Elling and the coordinator, 2026-10-03)

1. **The riser leaves a gap, usually.** About 3 risers in 4 stop before the one. For the gap the bed
   drops out while the riser's tail and the room ring; everything returns on the one. The rest run
   to the one, as today.
   - The gap follows `depth`: about 1 beat at `subtle`, up to half a bar at `bold`. Longer risers get
     the longer gaps.
   - Sometimes one melodic row keeps playing through the gap, as the `stop` keeps one.
2. **Combined moves.** A turnaround is usually 2-3 moves layered:
   - a compatibility rule;
   - a count set by `depth` (subtle mostly one move, bold mostly two or three);
   - weights from the arc;
   - every part ends on the one.
3. **Turn chips:** a tapped chip is the lead move, and the planner may layer onto it (§4).
4. **Readout:** the ruler and the flashes name the combination, e.g. `riser + lift → gap`, and it
   must fit a phone.
5. **Both radios.** The planning is shared, in `src/shared`, built with TDD. Each runtime only plays
   the plan.
6. **Unchanged:** the `turnarounds` rate (off / rare / often), the families (`moves`), `depth`, the
   16-bar turnaround phrase, and the cap of min(half the loop, 4 bars), or 1 bar at subtle.

## 0. The theory, and what it decides

This adds to the turnarounds spec's §0, which still holds. Tags: [SB] means a source in that §0 says
it; [WEB] means a production guide (directional, like Glancey there); [INF] means it is our
inference.

- **The rest before the arrival.** Iler's rest measure (pp.27, 35-36) is a gap of 1 beat to 2 bars
  just before the downbeat, where most of the texture stops. [SB] Production guides describe the same
  thing after a build:
  - "a section of silence between the riser and the drop", where a reverb tail from the riser avoids
    awkwardness (edmprod, "The Ultimate Guide to Build-Ups");
  - "a half-bar micro-pause before the drop where everything cuts to silence except a sustained pad
    note" (myloops, "7 Ways to Create Better Buildups"). [WEB]
  - *So:* the gap is at most half a bar (the short end of Iler's range, at a 16-bar phrase). The
    room and the riser's own tail fill it, and sometimes one melodic row does (§3).
- **Release is return** (Iler p.ix). [SB] A gap is the strongest form of it: everything returns on
  the one from silence.
  - *So:* every part, and the gap, end exactly on the one, with every row back in full.
- **A build layers its devices.** The same guides stack, in one build:
  - a riser;
  - a high-pass on the mix ("removes the low-frequencies, and causes your drop to have more
    impact");
  - the kick and bass cut;
  - a reverb swell (edmprod; Point Blank, "Creating Tension and Release"). [WEB]

  Solberg's build has the bass and kick removed while energy moves up the spectrum (pp.67, 70-71).
  [SB]
  - *So:* the classic pairs are riser + lift, riser + low drop, low drop + lift, and the three
    together.
- **A thinning mix softens; it doesn't drop** (turnarounds §0). [SB/INF]
  - *So:* on a thinning arc the only combination is wash + dip.
- **The rest measure with a reverb throw.** A stop whose stopped rows were just washed rings into
  its rest. [INF]
  - *So:* stop + wash is a classic pair.
- **Diminution repeats what was heard** (Iler pp.94-95). [SB]
  - *So:* a combined phrase end diminishes as the parts of it that can diminish, together (§3).
- No source gives a frequency for how often moves combine, or how often a riser stops early. The
  3-in-4 gap is Elling's "rarely goes all the way to the end", and the count odds are his "at least
  2 or 3". Tune both by ear. [INF]

## 1. What may layer: the affinity table

There are seven moves. Writing **D** drum drop, **L** low drop, **S** stop, **W** wash, **H** lift,
**P** dip, **R** riser, the pairs score 0 (never), 1 (works) or 2 (classic). The table is symmetric
(`TURNAROUND_AFFINITY`).

| | D | L | S | W | H | P | R |
|---|---|---|---|---|---|---|---|
| **D** | – | 0 | 0 | 1 | 1 | 1 | 1 |
| **L** | 0 | – | 0 | 1 | 2 | 1 | 2 |
| **S** | 0 | 0 | – | 2 | 1 | 1 | 0 |
| **W** | 1 | 1 | 2 | – | 2 | 2 | 2 |
| **H** | 1 | 2 | 1 | 2 | – | 0 | 2 |
| **P** | 1 | 1 | 1 | 2 | 0 | – | 1 |
| **R** | 1 | 2 | 0 | 2 | 2 | 1 | – |

**The 0s:**
- **Lift and dip** fight over one parameter: the row's single filter, in opposite directions.
- **Drum drop, low drop and stop** contain one another. A low drop already drops the drums row, and
  a stop drops drums and bass. Two of them is just the larger one.
- **Stop and riser:** the riser's gap *is* a stop, at the end. A stop under a riser would be the gap
  twice.

**The 2s, from §0:**
- riser + lift, riser + low drop, low drop + lift: the build;
- riser + wash: the wash's tail fills the gap;
- wash + lift: a reverb swell with a high-pass;
- wash + dip: the thinning mix;
- stop + wash: the rest measure with a throw.

**The 1s:**
- **riser + dip:** a muffled bed snapping open on the one is real, but against the riser's upward
  energy;
- **drum drop with any of wash, lift, dip or riser:** the lighter cousins of the low drop;
- **low drop + dip, low drop + wash;**
- **stop + lift, stop + dip:** the kept hook line alone, filtered.

**Three moves are allowed only when all three pairs are non-zero.** Since lift and dip never meet,
and there is only one wash, no row ever gets two filter moves or two washes. Volume is the only
lane two parts can share, and drops are all the same shape, so the longer one wins (§3).

## 2. How many moves, and which

- **The lead** is drawn exactly as today, from the main random:
  - a phrase end: the rate, then the arc's weights (turnarounds §2), the length, and a drum drop's
    row;
  - a turn: a chip's move, or the planner's choice.
- **The count** is drawn from `TURNAROUND_LAYER_ODDS[depth]` (one / two / three moves):

  | depth | 1 | 2 | 3 |
  |---|---|---|---|
  | subtle | 0.75 | 0.25 | 0 |
  | bold | 0.3 | 0.5 | 0.2 |

- **Each added move** is drawn among the moves that:
  - are not in yet;
  - have their family switched on (`moves`);
  - can sound and fit the cap (the guards, unchanged).

  Its weight is the arc's weight times its affinity with every move already in:
  `TURNAROUND_WEIGHTS[arc][m] × Π AFFINITY[p][m]`. A zero anywhere removes it. Its length comes from
  its own menu (turnarounds §2), capped. Then its rows, for a drum drop.
- **Fewer than asked.** When nothing compatible is left, the turnaround has fewer moves. A thinning
  arc can only ever reach wash + dip.
- **The arc acts through the weights, not the count:**
  - growing favours riser, lift and low drop together;
  - thinning gives only wash and dip;
  - steady spreads.

**Simulated** with the shared planner: 20,000 rolls each, 8-bar loop, a bed of drums, bass, lead and
warm, `often`. The combinations are shown unordered.

| arc, depth | 1 / 2 / 3 moves | most common |
|---|---|---|
| growing, bold | 30 / 52 / 18 % | lift + low drop 11 %, riser + lift + low drop → gap 9 %, riser + low drop → gap 9 %, lift 8 %, riser + lift → gap 8 %, stop + lift 7 %, low drop 7 % |
| growing, subtle | 75 / 25 / 0 % | lift 19 %, low drop 18 %, riser → gap 14 %, drop 13 %, stop 6 %, lift + low drop 6 % |
| steady, bold | 30 / 50 / 19 % | lift + low drop 9 %, drop 6 %, lift 6 %, drop + lift 6 %, low drop 6 % |
| steady, subtle | 76 / 24 / 0 % | drop 16 %, lift 15 %, low drop 15 %, dip 8 %, stop 8 %, wash 7 % |
| thinning, bold | 30 / 70 / 0 % | wash + dip 70 %, dip 15 %, wash 15 % |
| thinning, subtle | 75 / 25 / 0 % | dip 38 %, wash 37 %, wash + dip 26 % |

Both radios default to `bold` (`WEB_RADIO_DEFAULTS`, and sssketch's `DEFAULT_TURNAROUND_DEPTH`). So
both will mostly play two moves at once.

## 3. Lengths, the gap, the keeper, diminution

### Lengths

- Each part keeps its own length (it is not stretched to match the others), and **every part ends
  on the one**. So a 2-bar lift starts first and a 2-beat low drop joins it near the end.
- That is how a build layers: long sweeps under short cuts.
- The plan's `beats` is its longest part, which is where it starts.
- The cap, min(half the loop, 4 bars) or 1 bar at subtle, holds for every part. A turn's late-press
  clamp (`force.maxBeats`) holds for every part too.

### The gap

It applies only when a riser is among the parts, spanning at least a bar, with at least two audible
rows.

- **Chance:** `TURNAROUND_GAP_CHANCE` = 3/4. Otherwise the riser runs to the one, as today.
- **Length** (`turnaroundGapBeats`):

  | riser span | subtle | bold |
  |---|---|---|
  | under 1 bar | none | none |
  | 1 bar | 1 beat | 1 beat |
  | 2 bars or more | 1 beat | 2 beats (half a bar) |

  At subtle a riser spans at most a bar (subtle's cap), so it is always 1 beat.
- **The gap is carved out of the riser's span, not added to it.** The riser sounds for its span
  minus the gap and ends where the gap starts; the plan's length, and so the cap, are unchanged.
  - `riserBars` is the **sounding** length.
  - The plan's `gapBeats` tells each runtime to end the riser that much early.
- **During the gap:**
  - Every audible row, except the keeper, gets the drop curve of the gap's length: today's
    `turnaroundDropCurve`, a 0.02-bar ramp to silence, silent into the one, full on it.
  - The riser's own decaying tail (`RISER_TAIL_BARS`, an eighth of a bar) and its reverb send ring
    into the gap.
  - So does the room: every row's send is post-fader in both engines, so the reverb keeps the tail
    of what was playing.
- **A lift, dip or wash in the same turnaround peaks where the gap starts** and holds through it, so
  its last audible moment is its peak. On the one it snaps back to rest, as now.
- **A drop part must be heard before the gap.** A drum drop or low drop no longer than the gap would
  be swallowed by it. So it moves to the next length on its own menu that is longer than the gap,
  within the cap. If none fits, there is no gap: the riser runs to the one. A stop never meets a
  riser.

### The keeper

- **Chance:** with a gap, a melodic row keeps playing through it 1 time in 3
  (`TURNAROUND_GAP_KEEP_CHANCE`).
- **Which row:** the stop's keeper rule (`turnaroundStopKeeper`): the hook row if it is melodic, else
  a lead, else any melodic row. Never drums or bass.
- **When it can't:** only when its own loop is at least as long as the gap (the stop's rule). With
  no such row, the gap is silence.

### Diminution

Turnarounds §1's rule, generalised:

- After a combined phrase end, the next phrase end may repeat **the parts of it that can diminish**
  (drum drop, low drop, lift), together, each at half its length.
- It does so at the same rate, at most two halvings, never under a beat, and only while the arc
  weights each part, its family is on and its guards pass.
- There is no new layering and no gap.
- When a combination has nothing that can diminish (wash + dip, riser + wash), the next phrase end
  is skipped, as after a wash today.
- A single move diminishes exactly as today.

### Families

- `moves` limits every part.
- A chip's lead ignores `moves`, as today. Its added moves obey it.

## 4. Turns and chips

**`turn`** (the planner's choice) layers like a phrase end. It still always fires, and it still
skips the rate, the never-twice rule and diminution.

**A chip** is the lead: it always plays, whatever the arc and `moves` say, and the planner may layer
compatible moves onto it under the same rules. A `riser` chip gets the gap rule.

**Why layer the chips** rather than keep them single:
- Elling's point is that real turnarounds are combined, and that a riser running to the one is the
  rare form. A single-only riser chip would play the uncommon version every time.
- He still has two ways to a single move:
  - `depth` subtle makes three in four single;
  - switching families off limits what can be layered: with only `drops` on, a `riser` chip can
    gain only a drum drop or low drop.

The alternative, single chips plus a separate combined `turn`, is flag 1.

Unchanged:
- The chips' dimming (`turnaroundMoveCanSound`) reads only the lead's guards.
- The turn's late-press clamp, last tap wins, and undo.
- The diminution memory is not written by a turn.

## 5. Playing it

Each runtime plays the plan it is given. The only new things in a plan are:
- `parts`;
- `gapBeats` (and `keeperId`);
- a riser that ends early;
- a lift, dip or wash curve with one extra point.

All of them go on the same lanes and nodes as today.

### ell.ing/radio (`src/audio/turnaround.ts`, `Gestures.applyTurnaround`)

- **Rows:** they are unchanged:
  - volume goes to the row's turnaround gain;
  - the lift to the high-pass;
  - the dip to the row filter;
  - the wash to the send.

  Each row has at most one curve per param (§1), so nothing new can collide.
- **The riser:** `planRiser('turnaround', wrap − gapBeats × secPerBeat, …)`.
  - `planRiser` already counts back from the end it is given, so the riser starts `riserBars`
    before the gap and its tail runs on into the gap.
  - The riser voice's send into the reverb (0.2-0.4, the web's riser character) is what rings.
- **The return on the one, de-clicked.** Today a turnaround's volume curve ends with a step from 0
  to 1 at the wrap (`setValueAtTime`). On drums the transient masks it. A whole bed returning from
  silence, a sustained bass or pad among it, would click.
  - **The fix:** the last point moves to `wrap + ANTI_CLICK_SEC` (3 ms), as a linear ramp. That is
    the same fade-in a swapped stem gets at the wrap (`schedule.ts`).
  - It applies to every turnaround drop, old ones included. A swap at the same wrap fades its new
    stem in over the same 3 ms, so the two agree.
- **Cancel** (hold, a refused plan): unchanged. Every param glides back, and the riser fades from its
  start.

### sssketch (`DiscoverPanel.tsx` → engine automation)

- **Rows:** unchanged. `turnaroundToLoopBars` maps every point, including the hold at the gap.
  Volume curves multiply through `combineRadioCurves`, as now.
- **The riser:** `buildTransitionRiser(..., { endBeforeBars: gapBeats / 4 })`, a new option. The clip
  starts at `loopBars − gap − riserBars` and ends gap-early. Riser and gap together stay within the
  half loop. With `endBeforeBars` 0 or absent, the riser is byte-identical to today's.
  - The engine's `NoiseRiser` plays its decaying tail after the clip's end, and its character's send
    when riser variety is on (the default).
  - With variety off a riser has no send, so the gap gets only the noise tail and the rows' own
    reverb (flag 5).
- **The return on the one.** Already de-clicked: per-stem volume is evaluated per block and smoothed
  per sample by a one-pole of τ 15 ms (`AutomationCurve.h`, `kAutomationSmoothingSec`). The
  transport splits its block at the wrap (`Transport.cpp`), so the ramp starts on the one, reaching
  63 % by 15 ms. No change, but see timing risk 2.

## 6. The readout

- **The ruler's end** names the combination: the moves joined with ` + `, the lead first, then
  ` → gap` when there is one.
  - Examples: `riser + lift → gap`, `wash + dip`, `drop`, and for a turn, `turn: lift + low drop`.
  - A single move reads exactly as today.
- **Phone width.** A label longer than 20 characters (`TURNAROUND_LABEL_MAX`) shortens to the lead
  and a count: `riser +2 → gap`, `turn: low drop +2 → gap`.
  - The web's ruler is at most 320 px wide, with a 9 px nowrap end label.
  - Every combination the planner can make is tested to be at most 20 characters, or 23 for a turn.
  - Checked at 320 and 390 px (plan Task 6).
- **Flashes:** each row flashes the word of each part acting on it, from where that part starts.
  The rows dropping out flash `gap` where the gap starts (`turnaroundFlashes`). So a row may read
  `lift`, then `gap`; the latest word inside its one-bar window wins, as now. The riser has no row,
  as now.
- **The status line is unchanged.** It already carries the arc and `next`, and it wraps on a phone.
  The ruler's end is where the turnaround lives (readout spec §1), so the combination goes there and
  nowhere else.

## 7. Randomness and determinism

- **`combine` absent** is today's planner, draw for draw. Every existing shared test scripts exact
  draws (`seq`), and they all pass unchanged.
- **`combine` on:** the lead is drawn exactly as today from the caller's random. Then the planner
  draws **one** more number and seeds a private stream with it (`turnaroundLayerRandom`, mulberry32
  over `seededRandom`).
  - That stream makes every layering choice: the count, each added move, its length and rows, the
    gap and the keeper.
  - **Which rolls spend the extra draw:** a fresh roll that fires, and every turn that fires.
  - **Which don't:** a roll that doesn't fire, a diminution, or a roll skipped by the never-twice
    rule.
- **What it does to the web's seeded stream.** The web reducer's `random` (`c.rnd`) is seeded in
  its tests. Everything drawn after a fired phrase end shifts by exactly one number: picks, the
  arc's legs, transitions and drift. Fold's own seeded rules don't share this stream.
  - Production uses `Math.random`, so nothing a listener could reproduce changes.
  - Three web tests changed meaning and are rewritten by intent (plan Task 4). No other web test
    depended on the shifted draws (688 green in the scratch run).
- **Auto-arrange** (turnarounds §7) stays deterministic: same seed, same plans.

## 8. Architecture

### Shared: `src/shared/radioTurnaround.ts`

- **Inputs and plans:**
  - `TurnaroundInput.combine?: boolean`.
  - `TurnaroundPlan` gains three optional fields, set only when `combine` is on:
    - `parts?: TurnaroundPart[]`, where a part is `{ move, beats, rowIds }`, the lead first;
    - `gapBeats?: number`;
    - `keeperId?: string`.

    `move` stays the lead, `beats` the longest part, `riserBars` the sounding length, and `rows`
    one merged entry per row.
  - `TurnaroundMemory.parts?`: a combined phrase end's moves, for diminution.
    `rememberTurnaround` writes it only for two or more parts.
- **Tables:**
  - `TURNAROUND_AFFINITY`, `TURNAROUND_LAYER_ODDS`;
  - `TURNAROUND_GAP_CHANCE`, `TURNAROUND_GAP_KEEP_CHANCE`, `TURNAROUND_GAP_WORD`.
- **Functions:**
  - `turnaroundGapBeats(riserBeats, depth)` and `turnaroundLayerRandom(draw)`;
  - the label and flash helpers: `turnaroundLabel(moves, gap, max)`, `TURNAROUND_LABEL_MAX`,
    `turnaroundPlanMoves(plan)`, `turnaroundFlashes(plan)`;
  - internal: `layerTurnaround`, `diminishParts`, `materialize`, `holdThroughGap`.
- **Unchanged:**
  - `turnaroundDraw`, `turnaroundMoveCanSound`, `turnaroundFitsLoop`, `turnaroundToLoopBars`,
    `combineRadioCurves`;
  - the weights, the menus, the cap, the rate.

### Shared: the rest

- **`src/shared/radioTransition.ts`:** `buildTransitionRiser`'s `endBeforeBars` option.
- **`src/shared/radioReadout.ts`:** `armedTurnaround` gains `parts?` and `gap?`. The ruler end goes
  through `turnaroundLabel`.

### ell.ing/radio

- **`step.ts`:** `combine: true` in `turnaroundInputOf` (phrase ends, turns, chips), and the readout's
  `parts` and `gap`.
- **`controller.ts`:** flashes through `turnaroundFlashes`.
- **`audio/turnaround.ts`:** the riser's early end and the de-clicked return.

### sssketch

- **`DiscoverPanel.tsx`:**
  - `combine: true` in `turnaroundInputNow`;
  - the riser's `endBeforeBars`;
  - flashes through `turnaroundFlashes`;
  - the readout's `parts` and `gap`;
  - the "a filter move that filtered nothing is forgotten" rule now applies only to a single-move
    plan.
- **No engine change.**

## 9. Timing risks

Last session's radio bugs were timing (same-tick ordering, lap clock vs lap counts, hold/pause
desync). This feature adds no new clock, event, arming path or tick-ordering. A plan is still one
object armed at the start of the phrase's last lap and cleared at its wrap, and every new value is
a point in beats before that wrap. What it does add:

1. **The gap must end exactly on the one.**
   - **Web:** the return is a 3 ms ramp starting at the wrap's AudioContext time, the same time a
     swap's fade-in starts. Tested (`turnaround.test.ts`).
   - **Desktop:** the volume lane's step lands on bar 0 of the lap. The transport splits its block
     at the wrap, so the smoother starts on the one (τ 15 ms). That is how every drop and hole
     already returns.
   - A whole bed returning softens the one's transient. If Elling hears the downbeat as soft, the
     fix is engine-side: a shorter τ for upward volume steps on a wrap. Not in this build (flag 6).
2. **The riser's early end.** Both runtimes count it from the plan's own wrap minus `gapBeats`:
   - web: seconds on the clock before the wrap (`clockBefore`), as every turnaround point;
   - desktop: bars of the lap.
   A tempo change landing on that wrap is the existing case: the plan is measured on the clock in
   force during its lap.
3. **The desktop's arm-then-clear.** A late clearing push lets a lap-repeating lane play the gap
   again at the end of the next lap. That is the existing risk for every turnaround (turnarounds §5);
   the gap does not widen it.
4. **Mid-loop cuts (pace slider, 80+).**
   - A bar-line swap landing inside the gap is silent until the one. On the web the gap is on the
     row's turnaround gain. On the desktop a stage at a bar carries the turnaround (pace §3), so the
     new stem lands under the gap.
   - The swap is not lost, just heard from the one. No rule is needed.
5. **Hold or pause mid-gap.** As today: the web glides every param back from now
   (`cancelTurnaround`), and the desktop clears the turnaround with the gesture lanes. The riser
   fades from `max(now, its start)`.
6. **The extra random draw.** It comes after every draw of today's roll, in the same tick. Nothing
   reads the stream in between, so it adds no ordering.

## 10. Testing

- **Shared (TDD, sssketch vitest):**
  - **`radioTurnaroundCombos.test.ts` (new):**
    - `combine` off is today's planner;
    - on, the lead equals the single roll's (move, length, rows), with exactly one more draw, and
      none when nothing fires;
    - no incompatible pair, at most 3 moves, every move weighted by the arc, and thinning gives
      wash/dip only;
    - the count odds by depth;
    - families limit the added moves, while a chip's lead ignores them;
    - the turn clamp covers every part;
    - the gap:
      - its rate, about 3 in 4;
      - its lengths;
      - the riser's sounding length;
      - every audible row but the keeper silent through it and full on the one;
      - the keeper melodic;
      - drops lengthened past the gap;
      - filter and wash peaks holding through it;
      - one row means no gap;
    - every plan fits its loop at 2, 4, 8 and 16 bars and both depths, every curve ending on the
      one, one entry per row;
    - diminution of a combination, its draw-free skip, and the memory;
    - labels and flashes;
    - `buildTransitionRiser`'s `endBeforeBars`.
  - **`radioReadoutTurnaround.test.ts` (new):** the ruler for single moves (as before) and
    combinations; every combination the planner can make fits 20 characters, or 23 for a turn.
- **Web (vitest):**
  - **`turnaround.test.ts`:** the 3 ms return; a gapped riser's start, end and tail; the gap's gain.
  - **`step.test.ts`:**
    - phrase ends layer and leave gaps;
    - diminution, generalised;
    - the turn ruler.
- **Desktop:** typecheck, lint and the shared tests. The panel glue has no tests, by convention.
- **No agent can hear either radio.** Elling's walkthrough:
  1. At `bold`, most phrase ends are two moves. A riser usually stops short: a beat or two of room,
     then everything on the one.
  2. Sometimes a lead line plays on through the gap.
  3. The one doesn't click on the web, and doesn't sound soft on the desktop.
  4. The ruler names the combination; check it on a phone.
  5. At `subtle`, mostly single moves with 1-beat gaps.
  6. A thinning arc gives wash, dip, or both.
  7. Chips: `riser` usually gaps and often gains a lift or low drop.

## Flags for Elling

1. **Chips layer.** A tapped chip is the lead and may gain companions. The alternative: chips stay
   exact single moves, and only `turn` and phrase ends combine.
2. **The gap only follows a riser.** A lift into a gap (high-pass sweep, then silence) is also a
   real move. It would be the same code with `lift` allowed to carry a gap.
3. **The numbers to tune by ear:**
   - a gap 3 in 4;
   - the keeper 1 in 3;
   - gaps of 1 and 2 beats;
   - the count odds 30/50/20 at bold and 75/25/0 at subtle.
4. **No new control.** Combining is always on in both radios; `subtle` is the way to get mostly
   single moves. An `on/off` for combining would be one setting if wanted.
5. **Desktop with riser variety off:** the riser has no reverb send, so its gap holds only the noise
   tail and the rows' own room. A send floor for gap risers would change the wire for variety off.
6. **The return on the one:**
   - **web:** now a 3 ms fade-in for every turnaround drop, including today's, instead of a hard
     step;
   - **desktop:** the engine's 15 ms smoothing, unchanged.
   If the desktop's one sounds soft after a gap, that needs an engine change.
7. **`stop + lift`** is common on a growing arc at bold (about 7 %): the stop is still the rarest
   lead, but when it leads it nearly always gains a lift. Lower its affinity to 0 if the filtered
   hook alone doesn't work.
8. **Diminution of a combination** repeats only its drop and lift parts, halved together. A riser +
   low drop is followed by a low drop alone at half length.

## Out of scope

- Gaps after a lift or a stop (flag 2).
- A combining on/off control (flag 4).
- Per-move knobs, and choosing moves by stem analysis.
- The breakdown → build → drop section, and auto-arrange's pass (turnarounds §7). Both get combined
  plans for free when they arrive.
- Engine work on the return's smoothing (flag 6).
- The phone remote. It shows no turnaround names today; `turn` and the chips there get combinations
  through the same planner, with no change.
