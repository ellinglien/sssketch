# Conducting radio: three knobs

Status: DRAFT for Elling to read (2026-11-22). The idea is approved ("yes those are great",
"yes sure"); the mapping below and the open questions at the end are not. Nothing is built.

Elling: "are there any ways the listener can gently 'conduct' ... simplifying to a set of changes
... a few knobs that could be turned up or down to change several parameters at once ... like an
orchestra conductor".

## What exists

Radio already has many settings, each its own control: `pace` (a 0-100 slider), `density` (off /
arc / intensity) with `channels`, `energy` and `drama` (the intensity arc's two dials, live only
in that mode), `turnover`, `transitions`, `turnarounds` with its moves and depth, `fold` with
`bend` and `mismatch`, `faves`, `source`, and Discover's matching dial. The simple view shows a
few of them. Each is one parameter; none says "more" or "less" of a feeling.

## The three knobs

Each is 0-100, shown in the simple view, and each **drives several settings at once**. The
settings stay real: the advanced view shows them moving, and setting one by hand there holds it
(see "A knob and a hand-set value").

| knob | 0 | 100 | drives |
|---|---|---|---|
| **size** | two or three sparse rows | four or five full rows | the arc's low and high row counts (`DENSITY_TROUGH`, `DENSITY_PEAK`, `DENSITY_MAX` become functions of it); the balance term's wanted presence (sparser picks low, fuller high); in intensity mode, `energy` |
| **motion** | long holds, few events | restless | `paceLevel`; how often a turnaround is drawn (`turnarounds`); how many rows may change together (`turnover`); in intensity mode, `drama` |
| **risk** | in key, close, familiar | far, clashing, surprising | Discover's matching (the reroll pool's size); `KEY_WEIGHT` (2 at 0, falling to 0 at 100); `fold` on above a threshold, with `bend` and `mismatch` rising; how far picks dig from the current jam; `faves` leaning to loved stems at the low end |

- **50 is today.** Each knob at 50 reproduces the current defaults exactly, so a listener who
  touches nothing hears no change. Tested, per setting.
- **A range, not a value.** The arcs still rise and fall; a knob moves the window they move in.
  Size at 30 is "between two and three rows", not "three rows".
- **Lands musically.** A turn takes effect at the next loop top: the density leg is redrawn from
  the current count toward the new window, picks made after the turn use the new weights, and
  nothing sounding is cut. A turn never removes a row at once.
- **The mapping is one pure module,** `src/shared/radioConductor.ts`: `conduct(knobs)` returns the
  settings patch and the ranking multipliers. Both radios read it, so the web radio gets the same
  three knobs.
- **Seen:** three sliders in the simple view's strip in place of `pace`, with one word each
  ("size", "motion", "risk"). No new readout.

## A knob and a hand-set value

In the advanced view, a setting a knob drives shows the knob's value. Changing it by hand pins
it: the knob stops driving that one setting until the knob is next moved, which takes it back.
A pinned setting is marked. (The alternative, knobs only in simple and settings only in
advanced, needs no pinning but lets the two views disagree.)

## The rotating focus (the earlier draft, `2026-11-22-radio-shape-design.md`)

Its four focuses (in key, locked, contrast, space) become what `risk` and `size` lean toward, not
a separate rotation: low risk favours `in key` and `locked`, high risk `contrast`; low size
favours `space`. The rotation still happens, inside what the knobs allow. That draft's key moves
and one-front sections are unchanged.

## Not in this

A hardware controller, saved knob "scenes", per-row knobs, automation of the knobs over time.

## Testing

`conduct`: 50 on every knob equals today's defaults, each driven setting is monotonic in its
knob, the ends are within each setting's legal range (unit). A density leg redrawn after a size
turn never jumps more than one row a step (unit). Listening is Elling's.

## Open questions for Elling

1. **Three knobs replace `pace` in the simple view,** or sit beside it? (Draft: replace; motion
   is pace plus more.)
2. **`energy` and `drama`:** folded under size and motion as above, or kept as their own two
   dials in intensity mode? (Draft: folded, still visible in advanced.)
3. **Risk and fold:** should high risk switch fold mode on by itself? Fold is a strong effect.
   (Draft: yes, above 70.)
4. **Risk and the key lean:** at full risk the key lean is off entirely. Too far? (Draft: off at
   100, half at 75.)
5. **Hand-set values pin** until the knob moves again, or should the advanced view simply be
   read-only for driven settings? (Draft: pin.)
6. **Web radio too,** in the same release? (Draft: yes, the mapping is shared.)
