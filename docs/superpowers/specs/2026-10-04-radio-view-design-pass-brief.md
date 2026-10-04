# Brief: design pass on the sssketch radio view

For a design session in Claude Code (Elling + Claude), 2026-10-04. The radio view was rebuilt today
(plan `plans/2026-10-04-sssketch-radio-view.md`, commits 29d6a6a..516dc5b) to put every setting out
front. It works, but it reads as a mess. This pass is about **layout, hierarchy and visual
consistency only**. Behaviour stays exactly as it is.

## What the view is for

You listen to a generative radio playing 3–6 stem rows, and you steer it while it plays. Two
kinds of use, in this order:

1. **Playing:** glancing at what's happening and what comes next, and the few things you touch
   live: skip, turn and the move chips, pace, hold/hook/dig on a row, mute/solo, tempo, level.
2. **Shaping:** set-and-tweak settings you change now and then (phrase, loop end, transitions,
   turnaround families and depth, builds, density, turnover, fold bend/mismatch/seed, source,
   matching, faves, artist, sound).

Everything stays visible: that's Elling's call ("everything out front"). But visible doesn't mean
equal weight. The first group should be easy to find and hit. The second can be quieter, as long
as it's still on screen.

## What's wrong today

Seen in the 2026-10-04 1.39 PM screenshot:

- **The strip has no structure.**
  - Six groups (play, picks, shape, fold, sound, mix) run together as centred, wrapping lines.
  - Shape breaks across two lines. Fold and sound share a line.
  - The group labels are near-invisible and sit at different x positions.
- **The controls are inconsistent.**
  - **Mixed selected states:** bordered box (selected) vs plain text (unselected).
  - **Mixed control types:** dials, sliders and chips sit side by side for the same kind of value (0–100).
  - **Odd ones out:**
    - `artist: elling` and `[x] my sounds` use a different style;
    - the move chips (drop, low drop, …) are tiny and dim;
    - the mix buttons are large;
    - the dice sits alone.
- **There's no hierarchy.** Everything is the same small caps at the same size and weight. The live
  controls (skip, turn, pace) don't stand out from set-once ones (loop end, phrase).
- **The rows' button lines are busy.**
  - There are two icon clusters, left and right.
  - Kind labels are duplicated (`drummy ▾  drummy: guess`).
  - The per-row tools compete with the waveform.
- **The top line is split up.** Stop and radio sit at the far left, the status line in the centre,
  undo/redo at the far right. A second status line (fold) stacks under the first.
- **There's leftover non-radio UI.** "add a stem that is: …" and "hold shift to combine" still show
  under the strip while radio runs.
- **The proportions are off.** The strip is denser and taller than it needs to be next to the rows.
  There's dead space at the left of the strip and right of the rows.

## Constraints (binding)

- **Design system:** `src/renderer/src/styles/tokens.css` is the single source of truth.
  - Silkscreen throughout, sharp corners (no border-radius), near-black monochrome shell.
  - Colour **only** on audio information: stem waveforms and type colours via `typeColorVar`, the
    playhead, mute/danger state. No colour on chrome.
  - Copy is lowercase, with no emoji and no exclamation marks.
  - Use the existing type scale (`--ra-fs-9` to `--ra-fs-19`) and spacing (`--ra-s-*`) tokens. Add
    tokens only if a real gap shows up, and say so.
- **Behaviour is unchanged:**
  - Every control keeps what it does, its commit-on-release timing, undo behaviour and keyboard
    behaviour.
  - Sliders give up focus after a mouse drag. Escape in the seed field stays local.
- **Nothing hidden:** every radio setting keeps a visible control while radio runs.
  `src/shared/radioStripModel.test.ts` fails if one goes missing, so keep it green. Grouping,
  ordering, renaming labels (lowercase) and choosing control types are all open.
- **Rows must not remount when radio toggles**, or the loop restarts audibly. Keep the same rows
  container and the same `DiscoverSlotRow` in both modes (see the radio-view spec's risks).
- **Window sizes:** minimum app window is 945×614. It should work there (wrapping is fine, clipping
  isn't) and look good at a typical laptop size (~1440 wide).
- **Discover with radio off isn't in scope.** It's the grid view and stays as is.

## Inventory: everything that must stay on screen while radio runs

- **Top line:**
  - play/stop, `radio` (with its interval line), undo/redo;
  - the status line, e.g. `building ↑ 4 → 5 · next: row 1 → filter in · 2 bars`, and the phrase ruler;
  - fold's status line when fold is on.
- **Each row:**
  - **Live buttons:** m, s, skip, 👍 (like; star shows favourited), 👎 (change next), hook, dig.
  - **Desktop extras:** any stem (shuffle), nearby, duplicate, kinds menu, match meter / "guess", lock, remove.
  - **Waveform:** full width, type colour.
  - **Plates on the waveform:**
    - label · age · role words (`hook · back in 16 bars`, `dig`);
    - cue flashes and `next`, plus `no fave fits` / `no near fits`;
    - the fold readout (`7 / 16` plus phase dot);
    - an away hook's dimmed name, clickable to bring it back.
  - A holding bar at the left edge when a hook is in, and the approach background (armed/held).
- **play:** tempo − / value / +, pace slider with its readout (`2-4 bars`, `ludicrous`, a fold window
  in fold mode), skip (flickers on each landing), new bed.
- **picks:** faves (0–100), source endlesss ↔ other (0–100), matching (0–100), artist, my sounds,
  density off/arc, channels (only while density is off), turnover even/random.
- **shape:** phrase (loop / 16 / 32 bars), loop end (2 / 4 / 8 bars / always), transitions
  (off / subtle / bold), builds (sized / off).
- **moves:**
  - turnarounds off / rare / often;
  - move families (drops, wash, filters, riser);
  - depth subtle / bold;
  - turn plus the move chips (drop, low drop, stop, wash, lift, dip, riser), which fire now and dim
    when they can't sound.
- **fold:** fold on/off, bend (0–100), mismatch (0–100), seed text and `new`.
- **sound:**
  - level, reverb, filter, res, filter mode (lo/hi pass);
  - saturation, pump, echo (these edit the project's sound and are undoable).
- **mix:** keep, fetch hearts, add to shelf, add to timeline, similar all (dice).
- **Start prompt** (when radio starts): pace, density, channels, `start`.

## Reference points

- **The web radio's full mode**, `~/Claudecode/ell.ing/radio/src/ui/full.css` and `full.ts`, live at
  ell.ing/radio. It has calm rows with plates on the waveform, the buttons on one line, and the
  strip as wrapping groups. Elling likes seeing all the controls underneath while it plays.
- **Elling's first draft** (screenshot 2026-10-04 1.43 PM), the direction to build from:
  - Status line in the header; rows as clean full-width waveforms with a type-coloured label.
  - "add a stem that is" as one tidy chip row.
  - A play bar: tempo, pace as a segmented bar, skip, new bed, then mix buttons on the right with
    `keep` emphasised.
  - Five titled columns (picks, shape, moves, fold, sound), each with a one-line subtitle ("which
    stems come up", "how long things last", "what happens between", "how far it drifts",
    "the output").
  - 0–100 values as **segmented bars** instead of dials or sliders.
  - Chips as equal-width segmented controls with a filled selected state.
  - Move chips as a "fire now" grid.

  Things the draft leaves out, which the real view still needs:
  - **Top line:** the stop/play and `radio` buttons, undo/redo, the phrase ruler, fold's status line.
  - **Rows:** the per-row tools (abbreviated in the draft), the plates, and the flashes.
  - **Missing controls:** channels, similar all (dice), the filter mode as a control (it shows as a
    `lo pass` field), and the sound group's greyed states.

  Open question from the draft: does "add a stem that is" belong in the radio view at all? It
  doesn't today in the brief's sense; it's leftover grid UI.

## Code map

All in `src/renderer/src/components/` unless noted.

| File | What it draws |
|---|---|
| `RadioTopLine.tsx` | sticky top line |
| `RadioStrip.tsx` | the strip groups; uses `RadioControls.tsx` widgets (`StripChip`, `StripWordSwitch`, `StripDial`, `StripGroup`, `PaceSlider`, `FoldSlider`, `FoldSeedInput`) |
| `RadioRowPlates.tsx` | plates over the waveform (pure model in `src/shared/radioRowPlates.ts`) |
| `DiscoverSlotRow.tsx` | the row; `layout="radio"` branch arranges its named parts |
| `RadioStartPrompt.tsx` | start prompt |
| `Dial.tsx` | the knob (has `disabled`) |
| `src/shared/radioStripModel.ts` | group/control model plus the coverage test |
| `DiscoverPanel.tsx` | state and wiring (~12k lines); try not to grow it |

## What done looks like

- **Groups:** the strip reads as clear groups at a glance, with live controls easy to find. At
  minimum width nothing clips; at ~1440 nothing feels cramped or sprawling.
- **One control language:** one way to show "selected", and one control type per kind of value.
  0–100 values should probably all be segmented bars, like the draft.
- **Calmer rows:** the waveform is the hero, the live buttons are grouped, and the extras are quieter.
- **Top line:** one coherent band.
- **No leftover non-radio UI** under the strip, unless Elling decides "add a stem" stays.
- **Checks pass:** typecheck, lint, `npm test` (strip coverage test included).
- **Walkthrough:** Elling checks the result in the app (Cmd+Q and relaunch `npm run dev`). No agent
  can see the app; use screenshots from Elling, or render components in isolation.
