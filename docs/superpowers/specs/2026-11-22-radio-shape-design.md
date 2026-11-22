# Radio's shape: a rotating focus, key moves, one front

Status: DRAFT for Elling to read (written 2026-11-22). Not approved, not planned, not built.
Open questions are at the end; nothing here is decided until he answers them.

Second of three designs from "make the matching and the transitions more natural". The first
(`2026-11-21-picking-key-level-groove-design.md`) gave every pick a key lean, a level and a
balance. This one is about how radio **moves over time**. Both radios share it.

Elling, 2026-11-21: "matching for more things over time, or varying how things match ... yes
varying the method could be great ... and i think that would fix it" (radio feeling like too
many elements); "conflicting rhythms and combinations are cool"; drums in the balance "maybe
sometimes".

## 1. The focus

Radio holds one **focus** for a stretch, then moves to another. A focus doesn't add rules; it
turns the existing ranking terms up or down, so the mix keeps changing character without a new
control.

| focus | what it does | built from |
|---|---|---|
| **in key** | key lean doubled; nothing else changed | design 1's `key` term |
| **locked** | picks share the drums' feel (straight or swung) | the groove term, below |
| **contrast** | rhythm and tone pulled apart on purpose | fold mode's `clash` terms, at a fixed amount, with or without fold |
| **space** | one strong part, the rest sparse; drums count too | design 1's `balance` with `countDrums`, weight doubled |

- **Always on underneath:** design 1's key lean and balance at their normal weights. A focus
  changes the emphasis; it never switches the floor off. `contrast` clashes in time and tone and
  never in key (fold mode's own rule).
- **How long:** a focus lasts one leg of the density arc (96 to 192 bars) and changes when the
  leg turns, so the change of character lands with a change of size. In intensity mode it changes
  at the start of a build.
- **Which next:** a weighted draw from the injected random, never the same twice running.
  `locked` is left out of the draw until enough drum stems have a groove measurement (below).
- **Seen:** the top line names it in one word after the arc readout ("in key", "locked",
  "contrast", "space"). No new control in the simple view. In the advanced view, clicking the
  word pins the focus (and clicking again lets radio choose).
- **Discover without radio:** no clock, so no rotation: the steady mix. A pinned focus applies to
  manual rolls too.
- **Where:** one pure module, `src/shared/radioFocus.ts`: the focus type, the draw, and
  `focusTerms(focus)` returning the multipliers `pickForSlot` and the web's `pick.ts` apply to the
  terms they already pass. The focus lives in radio's state beside the density leg.

## 2. Groove (the `locked` focus)

Moved here from design 1.

- **Measurement:** `grooveTriplet`, 0 to 1 or null, per stem: of the onsets that fall off the
  beat and near a grid point, the share nearer a triplet eighth than a straight sixteenth (from
  the riff's bpm). Null under 8 such onsets. Written by the level pass.
- **Cost:** onset times aren't stored, so `STEM_LEVEL_VERSION` 2 re-runs the level pass over
  every analysed stem, once, in the background: hours on a library on a USB drive. Until a stem is
  re-measured it has no groove and is neutral.
- **The term:** `GROOVE_WEIGHT * (1 - |candidate - the sounding drums' mean|)`, only in `locked`.
  Drum picks are scored against the other drum rows.
- The level pass needs each stem's tempo. Whether the background scan's jobs can carry it is the
  one thing to check before planning; if not, this section changes.

## 3. Key moves

With design 1, radio drifts between related keys one row at a time. This makes a key change an
event.

- Radio keeps a **home key**: the key most of the sounding bass, back and front rows share.
- **While home holds,** picks are scored against the home key, not row by row, so a stray row
  doesn't pull the bed after it.
- **A move:** at a turnaround, radio may choose a new home that is close (a fifth up or down, or
  the relative major or minor) and change the bass and at least one back or front row together on
  that wrap, as companions of one change. Rows that already fit the new home stay.
- **How often:** at most once per density leg, and only at a turnaround marked for a change
  (never mid-phrase). `off / rare / often`, default rare, beside the turnarounds setting in the
  advanced view.
- **When it can't:** if the library has no bass in the new key at this tempo, no move.
- Top line: the home key is shown ("a minor"), and a move reads "→ e minor" while it is armed.

## 4. One front

Elling's "too many elements" is partly two lead parts talking over each other.

- Radio keeps **at most one front row sounding**. A second front row may exist only as the next
  one, arriving as the current one leaves.
- **The handover:** the outgoing front gets an exit gesture (echo tail or filter out) over the
  last bar or two while the incoming one enters on the wrap. One change, two rows.
- The density arc's starter order becomes drums, bass, back, front, and it never adds a second
  front; a fourth row beyond those is a second back.
- Rows the user adds by hand are his: two fronts he made stay, and radio only swaps them one at
  a time.
- Fold mode already never folds a front or a bass; unchanged.

## Not in this

- The mix (design 3): frequency room, the transition chosen by the sound, the bass swap, the
  tease, the front ducking the back.
- Transposing a stem into key.
- Scenes, a second bed and crossfader, a hardware controller, recording radio into a project.

## Depends on

Design 1 (`better-picks`), unmerged. Groove needs the rescan; the other three sections don't.

## Testing

- `radioFocus`: the draw never repeats, leaves `locked` out below the coverage bar, is
  deterministic from its random; `focusTerms` per focus (unit).
- `grooveTriplet`: straight, shuffled, mixed, sparse, no tempo (unit).
- Home key: the vote, the hold, the candidates for a move, the no-bass refusal (unit).
- One front: the arc never adds a second; a handover is one change (unit, in the shared step
  rules and the web's `step.ts`).
- Listening is Elling's.

## Open questions for Elling

1. **Does the focus rotate by itself in the simple view,** with only a word on the top line, or
   do you want to choose it? (Draft: rotates; pin it in the advanced view.)
2. **`contrast` without fold:** should it clash rhythm and tone on ordinary changes, or only
   while fold is on? (Draft: on ordinary changes, at a moderate fixed amount.)
3. **Key moves by default:** rare, or off until you've heard them? (Draft: rare.)
4. **One front:** a firm rule, or "usually one"? (Draft: firm for rows radio adds, yours are
   yours.)
5. **The groove rescan:** worth hours of background scanning for one focus of four? It could
   wait, and the rotation would run with three.
6. **Drums and the pump (carried over from design 1's review):** turning loud drum stems down
   also weakens the drum pump and lowers the level into the master glue. Options: leave drums
   untrimmed (my suggestion), or trim them and retune the pump.
