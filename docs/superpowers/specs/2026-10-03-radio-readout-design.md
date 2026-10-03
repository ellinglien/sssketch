# Radio readout: what's coming and why

**Date:** 2026-10-03
**Scope:** sssketch Discover radio and ell.ing/radio (full mode), with or without fold.

## Why

Elling liked fold's status line and dots: "can you think of other information we can display …
to make it more intelligible". Radio already knows what is coming and why; it just never says.

## Decisions (Elling, 2026-10-03)

Build:
1. **Next change.** Which row changes next, how it arrives, and a countdown.
2. **Phrase ruler.** Position in the phrase, and the turnaround armed for its end.
3. **Mix shape.** Where the density arc is heading.
4. **Gesture flash.** A brief word on a row when a gesture hits it.
5. **Row labels and age.** What each row was picked as, its author, and how long it has played.

Out of scope: the upcoming-events lane and the turnover "stale" hint.

## 1. Shared readout (`src/shared/radioReadout.ts`, pure, tested in sssketch)

### `radioReadout(input): RadioReadout`

**Input** (each runtime fills it from its own state):
- `bars`: bars into the phrase, phrase length in bars, loop bars;
- `nextChange`: `{ rowId, kind: transition kind, barsAway }`, or null;
- `armedTurnaround`: `{ move, isTurn: boolean }`, or null;
- `arc`:
  - `growing`, `thinning`, `steady` or `off`;
  - the current audible row count;
  - the target row count;
- `rows`: `{ rowId, kinds, author, laps, flash? }[]`.

**Output:**
- `statusLine`: built from the parts below, joined with ` · `.
  - Arc part:
    - `building ↑ 3 → 5` for a growing arc;
    - `thinning ↓ 5 → 3` for a thinning arc;
    - `steady · 4 rows` for a steady arc;
    - nothing when the arc is off.
  - Next-change part: `next: row 2 → filter in · 6 bars`.
    - The arrival word comes from the transition kind: `cut`, `hole`, `filter in`, `bloom`, `duck`,
      `riser`.
    - `next: soon` is used when the change has been decided but its bar is not known yet.
- `ruler`:
  - `{ ticks: phraseBars, filled: barsIntoPhrase, end: label | null }`;
  - `end` is the armed turnaround's move label (`TURNAROUND_MOVE_LABEL`), or `turn: <move>` for a
    manual turn.
- `rows`:
  - `{ rowId, label, age, isNext, nextKind, flash }`;
  - `label`, in order of preference:
    - the first mask kind (drums, bass or lead) plus a dominant trait word, e.g. `drums · bright`;
    - with no mask kind, the strongest trait (`warm`, `rhythmic` and so on);
    - with only a stem type, that type;
  - the author is appended as ` — name` when known;
  - `age` reads `12 laps` (`1 lap` in the singular).

**Copy:** lowercase, terse, no emoji. `↑` and `↓` are the only symbols.

### Gesture flash

- Each runtime records `{ rowId, word, atSec }` whenever it applies a gesture to a row:
  - a transition's leading or arrival gesture: `hole`, `filter in`, `bloom`, `duck`, `riser`;
  - a turnaround's or turn's per-row move: `drop`, `low drop`, `stop`, `wash`, `lift`, `dip`;
  - a dub throw, as `throw`.
- A row's flash is the word whose start lies within the last ~1 bar, measured from **when it
  sounds**, not when it was armed.

## 2. Display

### Web radio, full mode

- **Status line:** in the top strip; it wraps on mobile.
- **Fold status line:** stays on its own line beneath it while fold is on.
- **Phrase ruler:**
  - a 1px line beneath the status line;
  - one tick per bar, with the filled ticks brighter;
  - the end label sits at the right.
- **Per row:**
  - the label and age sit small and dim over the top left of the waveform, ellipsized on one line;
  - `next · filter in` goes on the row that is due;
  - the flash word fades in and out over about one bar, near the row's controls.

### sssketch Discover

- **Radio bar:** the same status line and ruler.
- **Rows:**
  - the label and age go in or near the row's existing name area;
  - `next` goes beside the row;
  - the flash word appears as on the web.
- **Style:** chrome tokens only (`--ra-text-3`, `--ra-border`), no colour, no border-radius.

Everything shows only while radio is running.

## 3. Testing

- **Shared:**
  - the status line for each arc state, with and without a next change;
  - the ruler, including turn vs turnaround;
  - row labels, with every kind and trait fallback;
  - age plurals;
  - the flash window.
- **Web:**
  - the model tests;
  - the readout in `RadioView`.
- **sssketch:** typecheck and lint, and the shared tests.
- **No agent can see or hear the radios.** Elling's walkthrough:
  1. The status matches what happens.
  2. `next` lands on the row that changes.
  3. The ruler fills, and its end label names the turnaround that plays.
  4. Flashes coincide with the sound.
  5. Mobile fits.
