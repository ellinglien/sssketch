# Radio fold mode v2: livelier, explained, clearer

**Date:** 2026-10-03
**Scope:** sssketch Discover radio and ell.ing/radio.
**Builds on:** `2026-10-02-radio-fold-mode-design.md` (§5 records how that was built).

## Why

Elling, after hearing it live: "it ends up with long phrases that repeat but get boring without
change, even though the multi rhythm is interesting". He also could not tell what fold was doing,
or what `folded`, `clash` and `seed` mean.

The causes, from the code:
- **Changes are slow.** Fold mode spaces layer changes 16–64 bars apart.
- **A fold holds still.** Once a row settles on its length, it keeps it for the whole stretch.
- **The drift is too subtle to hear.** It is flat per lap, cutoff 0.62–1, sends ≤ 0.15.

v1 built the first half of Autechre's "loop it more than you should, but keep changing everything".
v2 builds the second.

## Decisions (Elling, 2026-10-03)

All of these are in: re-fold at realignment, rotate the folded row, faster changes, audible drift,
a per-row readout plus a status line, renamed controls with tooltips, and seeds from any text.

## 1. Livelier folding (shared rules, `src/shared/radioFold.ts`)

- **Re-fold at realignment.**
  - On a marked (realignment) top, a settled fold changes length or phase. The chance is
    `0.3 + 0.4 × bend/100` (30% at 0, 70% at 100).
  - The new target is drawn from the bend menu, never the current length, and must pass the same
    30–120 s window.
  - The fold moves to it in 1–2 steps, through the existing crossfades.
  - A phase-only change (same length, new offset) counts as a re-fold. It is allowed only where the
    menu has offsets, which means bend 50 and up.
- **Rotate the folded row.**
  - A fold that has stayed through 2–4 realignments (the number is drawn) and has a foldable
    replacement may rotate: it walks back out, and the replacement starts folding on the top where
    the walk-back ends.
  - Never more rows than bend allows (one below 60, two from 60).
- **Faster changes.** Fold mode's interval window is **8–32 bars**, down from 16–64. The
  realignment preference stays at up to 2 laps.
- **Audible drift.**
  - The ranges scale with bend `b = bend/100`:

    | parameter | range |
    |---|---|
    | cutoff | `1` down to `0.62 − 0.22b` (0.4 at bend 100) |
    | added reverb send | `0` to `0.15 + 0.15b` |
    | added echo send | `0` to `0.18 + 0.17b` |

  - It is still flat per lap, with sweeps of at least max(32 bars, 8 laps).
  - The filter is never closed, and sends are only ever added.
- **Determinism.** All of it draws from the seed, so the same seed and events give the same
  decisions. The fuzz invariants (window, max rows, walk-back) must hold.

## 2. Explanation

- **Shared status, `radioFoldStatus(state, step, loopBars, bpm, intervalBarsLeft)`, pure.** It
  returns:
  - `stretch: 'folded' | 'straight'`;
  - `rows: { rowId, cycleBeats, fullBeats, phaseBeats, mode: 'folding' | 'settled' | 'unfolding' | 'refolding' }[]`;
  - `realignsInLaps`: the next marked top;
  - `nextChangeBars`;
  - `summary`: the one line. Examples: `folded · 2 rows · realigns in 3 laps · next change ~20 bars`,
    and `straight · folding in 1 lap`.

  The copy is lowercase and terse.
- **Per-row readout.**
  - A folded row shows `7 / 16`, its cycle against the loop in beats. A half beat shows as `3½`.
  - A **phase dot** travels around the cycle and lands on the downbeat at realignment (a phase-shifted fold's dot lands on its offset just after the downbeat, which is where that cycle really restarts). Its position
    is `((lapPosBeats − phase) mod cycle) / cycle`.
  - A straight row shows nothing.
- **Where.**
  - Web full mode: on each row, and the status line in the fold group.
  - sssketch: on each Discover row (next to its existing row controls), and the status line in the
    radio bar while fold is on.
  - It shows only while fold mode is on.

## 3. Clearer controls

- **Renames:**
  - `folded` → **`bend`**, tooltip `how far layers bend off the beat`;
  - `clash` → **`mismatch`**, tooltip `how unlike the rest new layers are`.

  These tooltips exceed the usual 2–3 words. Elling asked for an explanation here, so they are a
  deliberate exception.
- The settings keys stay `fold` and `clash` internally, so saved settings keep working. Only the
  labels change.
- **Seed:**
  - Tooltip: `same seed, same folding. any text`.
  - It accepts **any text**. The text is hashed with a stable FNV-1a hash into the seed the machine
    uses, and the box shows what was typed.
  - `normalizeFoldSeed` keeps old six-character seeds exactly as they were, so a saved seed still
    replays. Any other text up to 32 characters is kept as typed and hashed.
  - `new` still draws a random six-character seed.
  - An empty box keeps the current seed.

- **Web start-screen switch (Elling, 2026-10-03).** The `fold` switch beside the centred play takes
  the same form and styling as the existing **`visuals` switch** on the intro (`.intro-visuals`, its
  `sw-name` / `sw-value` with `data-state`): a name plus an on/off value, with the same dimming and
  hover. It replaces the plain underlined word.
- **Full mode, fold off.** The fold settings (`bend`, `mismatch`, `seed`, `new`) stay **hidden** while
  fold is off, as today (Elling, 2026-10-03: "oh they can be hidden"). The status line and readout
  show only while fold is on.

## 4. Testing

- **Shared:**
  - re-fold chance and targets, always in the window;
  - rotation never exceeds the max rows;
  - interval 8–32;
  - drift range scaling and bounds;
  - same seed, same run;
  - any-text seeds: the hash is stable, and old seeds are unchanged;
  - `radioFoldStatus` for each state;
  - the fuzz invariants re-run.
- **Web:**
  - step tests;
  - the readout model (`fullModel`);
  - an offline render check that a re-fold at a top is click-free.
- **sssketch:**
  - typecheck and lint for the UI;
  - an engine test that a re-fold at a top crossfades. The existing cycle-change path should already
    cover it; confirm it does.
- **Elling's walkthrough:**
  1. Over a few minutes, folded rows change length and swap between layers.
  2. Changes are noticeably more frequent than before.
  3. Drift is audible at high bend.
  4. The readout and phase dot make sense, and the dot lands on the beat when a layer realigns.
  5. `elling` works as a seed and replays.
