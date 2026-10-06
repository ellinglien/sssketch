# Radio: show moves as they happen

Elling, 2026-10-05: "is there a way to show when a transition action like a dropout or filter sweep is
taking place? maybe a quicker fade in and out." Approved as proposed ("yes, that sounds right").

## The idea

Today a move only flashes its word on the row, and the word fades slowly. Instead, **the row itself
shows the move while it sounds**, driven by the same curves the audio follows. Quick fades in and out.
Colourless: brightness and shape only, so it fits the design systems of both the web radio and
sssketch, which reserve colour for audio information.

## What each move looks like

| move (and where it comes from) | the row, while it sounds |
|---|---|
| drums out / low out / stop (turnarounds); breakdown rests (intensity arc); resting hooks; hole | waveform dims to about 25% brightness while silent, following the volume curve; fades in ~100 ms, back to full on the one |
| lift / dip (filter sweeps: turnarounds; filter-in arrivals) | waveform thins with the filter: lift (high-pass) fades its lower half's opacity, dip (low-pass) fades its upper detail. Shape follows the curve, back on the one |
| wash (reverb swell; bloom arrivals) | a soft glow or blur on the waveform that grows with the send, then clears |
| riser | a thin fill line on the row (or the ruler) sweeping toward the one |
| gap (riser gap / drop gap) | every silenced row dimmed; the one brings everything back at once |
| duck | a brief dip in brightness following the duck curve |
| throw (dub echo) | a short trailing ghost of the row's waveform, fading with the echo |

**Flash words:** the move's word stays on for the move's duration, then fades out fast (~150 ms),
replacing today's long fade.

## How

- **Drive the visuals from the plan, not from audio analysis.** Each runtime already holds the
  curves it schedules: turnaround plans (`radioTurnaround` merged row curves), gesture curves,
  throws and rests. A pure shared helper evaluates each row's visual state at a time:
  `radioRowVisualAt(plans, rowId, t)` returns `{ level, lowCut, highCut, wash, riser, ghost }`, each
  0..1. Both radios render from it, so they stay in sync and it can be tested.
- **Rendering:**
  - **Web:** CSS custom properties on the row (e.g. `--row-level`, `--row-wash`) updated per
    animation frame, with transitions short enough to read as following the music.
  - **Desktop:** the same through the row plates and the waveform cell's style.
  - Respect `prefers-reduced-motion`: show steady states, no sweeps or glows.
- **Cost:** one evaluation per row per frame, only while a plan is active, and idle otherwise.
- **Timing:** read the audio clock (the web's AudioContext time; the desktop's position tick) so the
  visuals land on the beat, not on React render timing.

## Sequencing and tests

- **Sequencing:** after the intensity arc's UI tasks (web full mode, desktop strip), because they
  touch the same row and strip files.
- **Tests:**
  - The shared helper is tested against known plan curves: level 0 during a drop, 1 on the one;
    lift and dip values; wash peak timing.
  - A headless screenshot pass covers the web at 320 and 390 px.
- **Walkthrough for Elling:** watch a drums-out, a lift, a wash, a riser into a gap, and a
  breakdown. Each should be visible while it sounds, with quick fades and nothing lingering.

## As built (2026-10-06)

Plan `docs/superpowers/plans/2026-10-05-radio-move-visuals.md`. Both repos on their main branch,
committed, **unpushed, not deployed**. No agent has heard either radio, seen the desktop app or held
a phone; the web was seen in headless Chrome only.

**Shared (sssketch `src/shared/`):**
- `055d90a2` Task 1, `radioMoveVisuals.ts`: the adapters (`radioTurnaroundVisuals`,
  `radioGestureVisuals`, `radioThrowVisual`, `radioRestVisual`), `radioRowVisualAt` (volumes
  multiply, the rest the strongest; a way in never under the fade, a way out a step on the one),
  `radioRowVisualVars`, steady states under reduced motion, prune and drop by key.
- `86e41394` Task 2, the flash's quick fades: `RadioFlash.until`, in 100 ms / out 150 ms.
- `ddb0395e` review minors on Tasks 1-2 (prune at the window's boundary, a NaN point drawn at rest,
  only a closed rest reopens, a turnaround's wash at its depth).
- `7da88967` a turnaround's visuals as the runtime laid it down (`heardRowIds`,
  `filterSkippedRowIds`).

**Desktop (sssketch `DiscoverPanel.tsx`, `DiscoverSlotRow.tsx`):**
- `1a060a2f` Task 6, the panel's log (`radioMoveVisualsTick` beside the flash tick, on the
  readout's clock).
- `f106f05b` Task 7, the rows and the top line draw them (`--mv-*` on each waveform cell,
  `[data-mv]` only while a move sounds, `[data-mv-rest]` for a resting row, the ruler's riser).

**Web (ell.ing/radio):**
- `ed1f700` Task 3, the controller's log on the AudioContext's clock, as the engine answered each
  move.
- `b178d8b` Tasks 4-5, full mode draws them (`moveFrame` every animation frame, the ruler's riser);
  headless screenshots at 320 and 390 px, light and dark.

**Review fixes:**
- `4f239ab4` a row ducks once at a wrap (two ducks at one wrap were multiplied to about 0.2).
- `723da70d` a turnaround's visuals and words placed every tick on the wrap that ends this lap (it
  was stamped once, from the loop length of the tick it was first seen on).
- `04f8df4d` a logged rest draws itself (the blanket `level = 0` made its fade, close and reopen
  dead code), and a resting row writes nothing it already wrote.
- `0a24de4d` `placeRadioRestVisual`: a decided rest is placed on the coming wrap every tick until it
  lands, so a rest that slips a wrap never dims a row that is still playing.
- `1d0073c` (web) a logged rest draws itself; a muted or soloed-out row shows no move; a resting
  row's floor is drawn at 45% ink (the 25% read fainter than a mute); a steady duck under reduced
  motion; the grid lines are on their own canvas, never dimmed; the ghost canvas is lazy; coarse
  steps on phones.
- `55c7023` (web) a stem landing on a row ends its rest (critical: a swap-now on a resting row left
  it drawn at 25% for good); the state has the last word on rests; a refused turnaround keeps the
  one shown; a throw taken back inside its lead; a failed visual never fails its engine call.
- `dd4923e2` gestures re-placed every tick too, as 723da70d did for turnarounds
  (`placeRadioGestureVisuals`, `placeRadioGestureFlash`): a lead-in on the wrap ending this lap and
  an arrival clamped to half the loop, both at the loop's length now.

**Deviations from the plan:**
- **The rest's floor on the web is 45% ink**, not 25% (`1d0073c`, full.css only; the shared
  `RADIO_VISUAL_DIM_FLOOR` stays 0.25). The desktop is unchanged: its resting row keeps the full
  grey layer under the stem colour at 25%, so a rest is always the grey of a mute plus a tint of
  the stem's colour (about 1.3-1.6x the mute's luminance across the type colours), never fainter.
  The same reading on both: a rest is radio's move, a mute is yours.
- **A muted row shows no move** on the web (`1d0073c`); on the desktop a muted row has no colour
  layer, so there is nothing for a move to dim.
- **Placed every tick, not logged once (desktop):** turnarounds (`723da70d`), rests (`0a24de4d`)
  and gestures (`dd4923e2`) are re-placed from what is armed at every tick, so a loop length learned
  late, a slipped rest or a rows change follow what the lane build lays down. Only the throw's echo
  is logged once (it rings on after its key goes). Plan risk 7 (the gap's late rows) went with
  this: they are read as they are now, every tick.
- **The web's simple mode gets nothing** (decision 12), confirmed by Elling on 2026-10-06, as is
  the wash's blur on waveforms only (decision 7).

**Checks** (2026-10-06, sssketch at `dd4923e2`, web at `55c7023`):
- sssketch: `npm test` 320 files, 5406 tests green; typecheck clean; lint 0 errors (one prettier
  warning in `scripts/generate-x64-test-config.js`, not this work).
- ell.ing/radio: vitest 68 files, 1064 tests green; typecheck clean; build clean; `check:engine`
  all passed.
- The move-visuals tests: `radioMoveVisuals.test.ts`, `radioReadout.test.ts`, and the web's
  `moveFrame.test.ts` and controller tests.

**Open, for Elling's eye:**
- **The throw's ghost is faint.** It is the faintest look (one repeat's trail, floored at 6 px, at
  0.45 of the echo). If it doesn't read on real stems: trail by a whole beat, or draw it only where
  the waveform is quiet (plan risk 4).
- **The throw's word ends before the echo.** The word is on until the send closes; the echo you
  hear rings on after it. Say if it should stay on for the echo.
- **The desktop steps at ~30 Hz.** The look follows the position stream, as the playhead does, so
  a 100 ms fade is about three steps. If it reads as steppy: an `opacity` transition of one tick
  (33 ms) on `.mv-colour` smooths the dims (plan risk 2).
- **The web runs slightly ahead of the sound** by the output latency (plan risk 1); subtract
  `AudioContext.outputLatency` for both the playhead and the moves if he sees it.

**Elling's walkthrough** (plan Task 8 step 4). Turnarounds on, depth bold; then density
intensity.
1. **Drums out** (the `drums out` chip, or a turn): the drums row dims as the drums leave, within
   a beat of hearing it, and is full again exactly on the one. Its word is on for the move and
   gone quickly after.
2. **Lift** (`lift` chip): the rows' lower halves thin as the high-pass rises, back on the one.
   **Dip**: the upper halves.
3. **Wash** (`wash` chip): the washed rows soften as the send grows, clear on the one.
4. **A riser into a gap** (turn until a riser with `→ gap` shows on the ruler, or drama 50+ and
   `drop`): the line under the ruler fills toward the one; at the gap it is gone and every row
   dims but the keeper; the one brings everything back at once.
5. **A breakdown** (density intensity, or `drop` twice): the drums and bass rows dim at the
   breakdown's line (a quick fade, not a cut), stay dim through it, and come back with the drop on
   its one together with the gap's rows. A drums row's echo throw trails a ghost into the rest.
6. **A change's gestures:** a hole dims the outgoing row into the wrap; a filter in opens the new
   row's top; a bloom washes it and clears; a duck dips the others for a beat; a change's riser
   fills a line along its row. With a longer stem landing on the lap's top, each still lands on
   the wrap you hear.
7. **A hook's rest** (hook a row; wait for `hook out` while the arc thins): it dims at its line
   and stays dim until it comes back. A muted row stays grey / faint, not dimmed: different.
8. **Nothing lingers:** after each move the rows are exactly as before; with nothing happening,
   nothing on the rows moves.
9. **Reduced motion** (System Settings, Accessibility, Display, Reduce motion): dims and filter
   thinning as steady states, no blur, ghost or riser lines.
10. The desktop's simple view shows all of the above too; advanced the same.
11. The web's simple mode: nothing new (decision 12, confirmed).
