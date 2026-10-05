# sssketch radio: simple and advanced views

Elling, 2026-10-05: "maybe we should have a simple and advanced view for the sssketch radio mode as
well while we're at it, it's all quite complicated!" This mirrors the web radio, which has `simple` and
`full` modes.

## Decisions

- **Advanced** is today's radio view, unchanged: everything out front (the design pass of
  2026-10-04). The strip-coverage test ("every radio setting has a visible control while radio
  runs") applies to advanced.
- **Simple is the default** when radio starts (Elling: yes). The choice is remembered across sessions
  (app settings, like other radio settings). Switching never stops or restarts anything.
- **Switch:** a `simple / advanced` word switch in the top line, beside undo/redo, styled like the
  strip's word switches. Keyboard reachable; the tooltip says what the other view adds.

## What simple shows

- **Top line:** as in advanced. Play/stop, `radio` with its interval line, the status line, the
  ruler, fold's status line when fold is on, undo/redo, and the switch.
  - The mix actions (keep, fetch hearts, add to shelf, add to timeline, similar all): keep `keep` in
    simple and drop the rest. Keep is the one people reach for while listening.
- **Rows:** waveform, type-coloured label, and the plates (label · age · role words, cue/`next`,
  flashes, fold readout, away-hook name).
  - Keep the live button cluster: m, s, skip, 👍, 👎, hook, dig.
  - Hide the extras: any stem, nearby, duplicate, the kinds menu and match meter, lock, remove.
  - A locked row still shows that it's locked (the padlock as a status mark, not a button). Hiding
    an active lock would be confusing.
- **The live bar:** tempo, pace, skip, new bed, turn, level. When the intensity arc lands, add
  `energy` and `drama` here too.
  - The fire-now move chips (drums out, low out, stop, wash, lift, dip, riser) are hidden: `turn`
    alone picks for you.

## What simple hides

The five shaping columns (picks, shape, moves, fold, sound) and the move chips. Hidden settings keep
whatever they're set to and keep working. Simple changes only what's on screen, never behaviour.

## Notes for the build

- **Visibility only:** simple is a prop on `RadioStrip` / `RadioTopLine` / `DiscoverSlotRow`'s
  radio layout, not a different tree.
- **No remounts:** rows must not remount when the view switches, the same rule as the radio toggle.
  Hide parts with conditional children inside the row's existing containers, keeping the waveform
  cell in place.
- **Tests:**
  - A pure model helper (e.g. in `radioStripModel.ts`) says which controls and parts show in each
    view.
  - The coverage test runs against advanced.
  - A new test pins simple's list, so adding a setting doesn't silently land in simple.
- **Sequencing:** build after the intensity arc (both touch the strip and live bar), adding energy
  and drama to simple's live bar at that point.
- **Walkthrough for Elling:**
  - Start radio and confirm it opens in simple.
  - Switch to advanced and back mid-loop: no audible restart, the switch is remembered across a
    relaunch, and a locked row shows its lock in simple.
