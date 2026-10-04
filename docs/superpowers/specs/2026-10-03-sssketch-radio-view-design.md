# sssketch radio view: aligned with the web radio's full mode

**Date:** 2026-10-03
**Scope:** sssketch Discover while radio is on (`DiscoverPanel.tsx`, `DiscoverRadioMenu.tsx`,
`DiscoverSlotRow`). The web radio (`~/Claudecode/ell.ing/radio`, `src/ui/full.ts`, `full.css`,
`fullModel.ts`) is the reference and is not changed. Discover with radio off is not changed.

## Why

Radio on the desktop hides most of itself: the settings sit in a popover behind a `v` chevron,
the readout is squeezed into the actions row with an ellipsis, and fold's readout is a column at the
far end of each row. The web radio's full mode puts everything in view while it plays, and Elling
likes it: "i like seeing all of the controls underneath as it's playing... align the interface as
much as you can", "show the settings out front", "everything out", "also the same notification
styles".

## Decisions (Elling, 2026-10-03)

1. **Scope A.** Only the radio view changes. It keeps sssketch's own look (tokens.css: Silkscreen,
   sharp corners, colour only on audio information, lowercase copy, no emoji, `typeColorVar`). It
   does not take the web's fonts or palette.
2. **When.** The new layout replaces Discover's two header rows and master strip while radio is on.
   With radio off, Discover looks exactly as it does now.
3. **Layout.** It has three parts:
   - a top line: play/stop, the readout's status line and phrase ruler, and fold's status line;
   - rows: the waveform at full width, the web's on-waveform plates, and the row buttons on one
     line above the waveform;
   - the strip underneath, always visible while radio is on, wrapping into groups.
4. **Everything out.** Every radio setting goes in the strip. Nothing stays behind a menu. The
   running radio menu popover goes away.
5. **The same notification styles.** The desktop takes the web's notification vocabulary, mapped
   to sssketch tokens.
6. **Behaviour unchanged.** Every control does what it does now and commits when it does now. Only
   placement and presentation change. The phone remote is not affected.
7. **Hook/dig roles** (spec `2026-10-03-radio-anointed-stems-design.md`, being written separately).
   This spec leaves a place for their row buttons and does not design them.
8. **The open questions, answered (Elling, 2026-10-04, the spec's defaults):** keep the start
   prompt; no whole-mix `hold` now; the strip's saturation, pump and echo edit the open project's
   sound (undoable, marks it unsaved). See the end of this spec.

## Updated for the tree as of 2026-10-04 (sssketch 209878f, ell.ing/radio 49b824d)

The tree moved while this spec waited: anointed stems (hooks, dig, resting exits, sized builds),
the pace slider, fold following pace, combined turnarounds, aimed throws and companions all
landed. The sections below are corrected in place where they were stale; this list is the
summary, and the plan (`docs/superpowers/plans/2026-10-04-sssketch-radio-view.md`) is built on it.

- **Sizes.** `DiscoverPanel.tsx` is 14,211 lines; `DiscoverSlotRow` and its helpers are lines
  12,307-14,211 (about 1,900).
- **The row grid** is 15 tracks, plus tracks 16-17 for `RadioRoleButtons` (hook: Phosphor
  `Repeat`; dig: `Shovel`) while radio runs, plus track **18** (not 16) for fold's readout while
  fold is on. The reserved `data-slot="radio-role"` slot is no longer empty: the hook and dig
  buttons exist and go there, after 👎, in the web's order (`m s skip 👍 👎 hook dig`).
- **Holding** is a hook in on the row (`hookIn`, `radioHookInRow`), not `radioFlag === 'hook'`:
  the flag was retired (`RadioSlotFlag` is `'replace-soon'` only).
- **The row readout's age already carries the role words** (`3 laps · hook · back in 16 bars`),
  so the web's info plate is split into a label (cut with an ellipsis) and a tail kept whole
  (ell.ing/radio 22de927). `radioRowPlates` returns `info: { label, tail }`.
- **The away hook's name** (`data-hook-away`, tap: bring it back) is a button today, in the
  readout's top line. On the web it sits at the waveform's bottom left, sharing one bar with the
  cue plate (the name shrinks, the cue stays whole). The radio view does the same; it is the one
  plate that takes clicks.
- **`builds: sized / off`** (`sizedBuilds`) is a radio menu row this spec did not list. It goes in
  the shape group.
- **`no near fits`** (dig's near-only draw finding nothing) is flashed on the row on the web
  (021f95c) and only logged on the desktop. It joins `no fave fits` in section 2.
- **Dials are not inputs.** `Dial` is a `div role="slider"`; the `t` handler skips only
  `INPUT`/`TEXTAREA`/`SELECT`, so `t` already works after a dial drag. Only the range inputs (pace,
  bend, mismatch) blur after a pointer gesture. `Dial` has no `disabled` prop yet; the strip needs
  one (additive).
- **Components are one flat folder.** `src/renderer/src/components/` has no subfolders, so the new
  files sit beside `DiscoverRadioMenu.tsx` with `Discover`/`Radio` prefixes, not in
  `components/discover/radio/`.
- **The row cannot move verbatim alone.** `resolveCandidateStem`, `peekResolvedCandidateStem` and
  their two caches are module-level in `DiscoverPanel.tsx` and used by both the panel and the row;
  the move lifts them into their own module first.
- **The landing flicker** fires from the panel's clock tick where a change lands (radio's held
  change, waiting manual changes, hook landings and arc rows, which ride the manual queue; and the
  course change's own branch). Both routes of the engine's staged swap (its ack, or the tick
  winning the race) converge there, so the ack itself is not the hook.
- **The web's full mode now also has** `hold` (not taken, decision 8), the hook and dig toggles,
  role words, the away name and `hook out` / `hook back` flashes: the desktop already has the last
  four.

## 1. The view

The radio view has four parts, top to bottom, inside the panel's existing scroll container
(`DiscoverPanel`'s outer `div`, `overflowY: auto`):

```
┌ top line (sticky top) ────────────────────────────────────────────────────────────┐
│ ■  radio      building ↑ 2 → 4 · next: row 1 → cut · 9 bars            ↶ ↷        │
│ ▔▔▔▔▔         ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ wash                              │
│               folded · 2 rows · realigns in 3 laps · next change ~20 bars          │
├ notes (artist / lingering, when shown) ───────────────────────────────────────────┤
│ rows                                                                               │
│  m s ⏭ 👍 👎 [hook/dig]                       ⇄ ◎ ⧉ [drums ▮▮▯] 🔒 ×                 │
│  ┌drums · heavy · 1 lap┐ ▁▃▇▃▁▁▃▇▃▁▁▃▇▃▁ │ ▁▃▇▃▁▁▃▇▃▁ ┌7 / 16┐  ...                  │
│  │                                  ...            └─•──┘   ┌throw  next┐          │
│  ...                                                                               │
├ strip (sticky bottom) ────────────────────────────────────────────────────────────┤
│ play  − 120 + bpm  pace ━━●━━ fast  skip  new bed                                   │
│ picks faves ◔  source endlesss ◑ other  matching ◔  artist: elling  [x] my sounds   │
│       density off arc  channels 2 3 4 5 6  turnover even random                     │
│ shape phrase ...  loop end ...  transitions ...  turnarounds ...  moves ...         │
│       depth ...  turn  drop wash filter riser ...                                   │
│ fold  fold: on  bend ━●━ 40  mismatch ━●━ 25  seed [k3j9qa] new                      │
│ sound level ◔  reverb ◔  filter ◔ res ◔ lo pass  saturation ◔  pump ◔  echo ◔        │
│ mix   similar all  keep  fetch hearts  add to shelf  add to timeline                │
├ add row (unchanged, less the four controls that moved to picks) ──────────────────┤
│ add a stem that is: drums bass ... | + random | + sample      hold shift to combine │
└────────────────────────────────────────────────────────────────────────────────────┘
```

(The glyphs in the sketch are placeholders. The real buttons are today's Phosphor icons and
letters. The copy has no emoji.)

- **Top line.** `position: sticky; top: 0`, on `--ra-bg-page`. It stays in view while the rows
  scroll.
- **Strip.** `position: sticky; bottom: 0`, on `--ra-bg-page`, with a 1px `--ra-border` rule above
  it. It is always in view while radio is on, which is the point of Elling's request. The add row
  comes after it in the document, so it shows when the panel is scrolled to the end, and the strip
  then sits above it.
- **Consent prompt** (`showConsentPrompt`). It stays where it is, above everything.

### 1.1 The top line

It mirrors the web's `.top`: a left corner, the readout centred between the corners, and a right
corner.

- **Left corner:**
  - **Play/stop.** It is today's transport toggle (`PLAY`/`PAUSE`, `■`/`▶`, lit with
    `--ra-play-on`). It is unchanged.
  - **`radio`.** It is lit with `--ra-play-on` as it is today. Pressing it stops radio
    (`stopRadio`), and that is the way back to the normal Discover layout. Under it is today's 2px
    interval-progress line (`radioProgress`). That line is desktop-only and stays.
- **Middle (`flex: 1 1 0; min-width: 0`, centred, `--ra-fs-9`, `--ra-text-2`):**
  - **The status line** (`radioReadoutNow.statusLine`). It wraps instead of being cut with an
    ellipsis (web `.status-line`). It is hidden when empty.
  - **The phrase ruler.** It is a 1px line with one tick per bar, up to 320px wide (web `.ruler`).
    Played bars are `--ra-text` and unplayed bars are `--ra-text-4`. The end label (`wash`,
    `turn: drop`) sits at the right in `--ra-text-3`.
  - **Fold's status line** (`radioFoldStatusNow.summary`). It shows only while fold is on, on its
    own line, and is cut with an ellipsis.
  - None of these lines is an `aria-live` region, as today and as on the web, because their counts
    change every bar.
- **Right corner:**
  - **Undo/redo.** These are today's buttons with today's behaviour, including undo withdrawing a
    waiting turn first.
  - They sit here because undo is how a turn or a manual change is taken back mid-performance. In
    the web's layout, the right corner is where a corner action goes.

**Notes.** These are the artist notice (`artistNotice`) and the lingering notice
(`lingeringNotice`). They keep today's text and `role="note"`, and sit on one line under the top
line, outside the sticky area.

### 1.2 The rows

Each row is a block of two lines. This replaces today's 15/16-track grid
(`DISCOVER_ROW_GRID_COLUMNS`) while radio is on.

1. **Button line** (`display: flex; align-items: center; gap: 4px; height: 20px`).
   - **The web's row buttons, left, in the web's order:**
     - `m`;
     - `s`;
     - **skip.** This is today's `SkipForward` "skip" (`onReroll`, similar), with Cmd for
       immediate;
     - **👍.** This is like (`likeSlot`). It now shows only the star, as described below;
     - **👎.** This is change soon (`onToggleReplaceSoon`);
     - **hook, dig** (`RadioRoleButtons`, in a `data-slot="radio-role"` wrapper): the anointed
       stems' toggles, which landed after this spec was written (2026-10-04 update).
   - **Desktop extras, pushed right (`margin-left: auto`), in this order:**
     - **any stem** (`Shuffle`, `onRerollRandom`);
     - **nearby jam** (`Compass`, popover unchanged);
     - **duplicate** (`Copy`);
     - **the kinds label with its match meter** (the 110px block from track 7: click for
       `DiscoverKindPicker`, reclassify, match meter, `no match`), laid out on one line (label,
       then meter) so the button line stays 20px tall;
     - **lock**;
     - **remove**, last and furthest from the gestures, because it is the destructive one.
   - Every button keeps its current size (18×18), tooltip, aria-label, disabled/dimmed/pulsing rule
     and Cmd-click meaning. 👎 is still hidden with `visibility` while radio is off, but that never
     happens in this layout.
2. **Waveform** (`height: DISCOVER_WAVEFORM_HEIGHT`, 40px, the full row width less the row's 6px
   side padding).
   - It is still the gain-drag surface (`handleGainDragStart`, `ns-resize`). Every plate on it has
     `pointer-events: none`.
   - The resolving placeholder, the failed state and the date tooltip are unchanged.
   - **Plates.** These are the web's `.info`, `.cue` and `.fold` rules, from commit `bbee7a2` on
     the radio repo. Each plate sits on `color-mix(in srgb, var(--ra-bg-page) 80%, transparent)`.
     It is only as wide as its words, `padding: 1px 3px`, Silkscreen 8px, `line-height: 1`, with
     no radius:
     - **label plate, top-left (`top: 2px; left: 4px`)**:
       - the label then the tail, e.g. `drums · heavy` + ` · 1 lap · hook · back in 16 bars`, in
         `--ra-text`;
       - it is one line at `max-width: calc(100% - 56px)`, so it stops short of the fold plate;
         the label is cut with an ellipsis and the tail (age and role words) is kept whole, as
         the web does since 22de927;
     - **away hook's name, bottom-left**, sharing one bar with the cue plate: the hooked stem's
       name in `--ra-text-2` on a plate, inside a transparent hit box (`data-hook-away`, tap:
       bring it back). The only plate with `pointer-events: auto`; it shrinks before the cue does;
     - **cue plate, bottom-right (`bottom: 2px; right: 4px; gap: 6px`)**:
       - it holds the flash word in `--ra-text`, at `radioFlashOpacity`, and `next · <arrival>` in
         `--ra-text-2`;
       - it is hidden when both are empty;
     - **fold plate, top-right (`top: 2px; right: 4px`)**:
       - it holds `7 / 16` in `--ra-text-2` and, under it, the 28px phase-dot track (`--ra-text-3`
         line, 3×3 `--ra-text` dot);
       - the dot keeps `data-fold-dot={slot.id}`, so the sweep layout effect that positions it
         (`querySelectorAll('[data-fold-dot]')`) works unchanged;
       - the plate is hidden on a row playing straight, and fold's grid track (18 since the
         role tracks came before it) goes away, with the role tracks 16-17.
3. **Row frame:**
   - `padding: 4px 6px; margin-bottom: 4px`;
   - the approach breath (armed/held) is today's `color-mix` on `--discover-breath`, unchanged,
     and it now covers the whole two-line block, as the web's `.row[data-approach]` does;
   - **Holding** (a hook in on the row: `hookIn`, since the flag was retired) is drawn as the web
     draws it: a 2px bar at the row's left edge (`top: 6px; bottom: 6px`,
     `color-mix(in srgb, var(--ra-text) 45%, transparent)`);
   - 👍 drops its inverted holding fill and shows only the star (`--ra-recording-live` border and
     fill, `weight="fill"`), so the button says "liked" and the bar says "holding";
   - `aria-description="holding longer"` stays on 👍.

**The playhead.** There is still one line over every row (Elling, 2026-09-30: "one long one moving
across all of them").

- The overlay no longer mirrors a grid. It is an absolutely positioned box over the rows wrapper,
  inset by the rows' 6px side padding, and the line's `left` is the same percentage
  (`discoverSweepPct`) that `sweepLineRef`'s layout effect already writes.
- The line crosses the button lines. They are 20px tall and the line is 1px, with
  `pointer-events: none`.
- With radio off, the grid overlay (`discoverRowGridColumns`) stays as it is.

### 1.3 The strip

```
display: flex; flex-wrap: wrap; align-items: center; justify-content: center;
gap: 4px 24px; padding: 8px 12px 10px;
```

These are the web's `.strip` numbers. The strip holds six groups. Each group is a flex item that
may shrink to the strip's width (`min-width: 0; max-width: 100%`) and wraps its own controls
(`flex-wrap: wrap; gap: 4px 10px`). Each group starts with a caption in `--ra-text-4`, `--ra-fs-9`
(`play`, `picks`, `shape`, `fold`, `sound`, `mix`), so a wrapped strip still reads as groups. The
web has no captions, but its strip is shorter. Each group is `role="group"` with
`aria-label="<caption>"`.

Controls use sssketch's widgets, and each control keeps its current widget and commit rule:

- **Dials stay dials.** They render at `size={22}` with the caption to the right on one line, as
  the faves dial in the add row does today. They keep wheel and double-click-to-default.
- **Sliders stay sliders** (pace, bend, mismatch): `PaceSlider` and `FoldSlider`, 72px wide.
- **Chips stay chips.** These use the radio menu's chip: 1px `--ra-border`, `--ra-text-2`. When
  on, a chip has a `--ra-text` border and ink on `--ra-bg-row-active`.

A pointer drag on any strip slider gives up focus on release, as the web's `range()` does.
That way `t` (turn) works straight after a drag, since today's handler ignores keys while an
`INPUT` has focus. Keyboard focus reached by Tab keeps focus. (Dials need nothing: `Dial` is a
`div role="slider"`, which the `t` handler does not skip.) Strip dials that cannot act take a new
`disabled` prop on `Dial`: `--ra-text-4`, inert, no wheel, no keys.

#### play

| control | today | in the strip |
|---|---|---|
| tempo | header row 1: `−`, typed field, `+`, `bpm` (`SET_TEMPO`, blur/Enter commits) | same |
| match seed | header row 1, only when `seedTempo !== bpm` | same, same condition |
| pace | radio menu, `PaceSlider`, release commits (`paceLevel`) | same, with `fold` for its readout, `RADIO_PACE_TOOLTIP` |
| skip | header row 2, `SkipForward` square (`skipRadio`) | a word button, `skip` (the web's word); it flickers on a landing (section 2) |
| new bed | radio menu `reroll: new bed` (`collectRadioCourseChange`) | a button, `new bed` |

#### picks

| control | today | in the strip |
|---|---|---|
| faves | add row dial (`previewFaves`/`commitFaves`), and a slider in the radio menu (same value) | the dial; dimmed in artist mode, as now |
| source | add row dial with `endlesss` / `other` captions (`changeSourceLean`, live) | same dial and captions |
| matching | add row dial (`100 - chaos`, live) | same |
| artist | header row 2 button plus `DiscoverArtistPicker` popover, with its `analyse overnight` footer | same button and popover |
| my sounds | add row `[x]` toggle (`globalModifiers`) | same toggle, same disabled rules |
| density | radio menu chips `off` / `arc` | same |
| channels | radio menu chips, shown only with density `off` | same rule |
| turnover | **no control today** (setting exists, read by radio's picks via `nextTurnoverSlotId`) | chips `even` / `random` (`RADIO_TURNOVER_OPTIONS`) |

Turnover is the one setting that gains a control. Radio already reads it, so the chips change
nothing about radio itself. Before this, it was settable only by editing the settings file. The
menu's comment saying it has "no row yet" is stale and goes with the menu.

#### shape

| control | today | in the strip |
|---|---|---|
| phrase | radio menu chips (`loop`, `16 bars`, ...) | same |
| loop end | radio menu chips (`always`, `N bars`) | same |
| transitions | radio menu chips | same |
| turnarounds | radio menu chips (how often) | same |
| moves | radio menu family chips, only while turnarounds is not `off` | same rule |
| depth | radio menu chips, same condition | same rule |
| builds | radio menu chips `sized` / `off` (`sizedBuilds`; added 2026-10-03 with the anointed stems, missing from this spec's first draft) | same chips, always shown |
| turn and move chips | header row 2: `turn` / `turning` / `nothing to turn` and the chips (held: inverted; can't sound: `--ra-text-4`, tooltip `not now`) | same states, same look; the turn button keeps its inverted fill while a turn waits |

#### fold

| control | today | in the strip |
|---|---|---|
| fold | radio menu chips `off` / `on` | a word switch, `fold: on` / `fold: off`, as on the web; the state word is `--ra-text` when on and `--ra-text-3` when off |
| bend, mismatch | radio menu `FoldSlider`s, only with fold on | same, same rule (Elling chose "hidden as before, not disabled" for the web on 2026-10-03) |
| seed, new | radio menu `FoldSeedInput` plus `new` chip, only with fold on | same |

With fold off, the group shows only its caption and the switch, so the strip does not keep an
empty gap. The seed input now stops Escape from propagating and reverts its draft, for the reason
given in section 6 (Escape).

#### sound

| control | today | in the strip |
|---|---|---|
| level | master strip dial (live) | same |
| reverb | master strip dial (master send, commits on release) | same |
| filter, res, lo/hi pass | master strip dials and word button | same; the web hides these without `?dev`, but "everything out" keeps them on the desktop |
| saturation | sound panel (TransportBar `sound`): `saturation.amount`, `SET_SOUND_SETTINGS`, release commits | a dial, release commits through the same `SET_SOUND_SETTINGS` patch |
| pump | sound panel: `pump.depthDb` (0..8) | a dial, same patch rule |
| echo | sound panel: `throws.level` (the web's `echo` is `Engine.setEcho`, the throws' send) | a dial, same patch rule |

- **Whether the stages run.** Saturation, pump and echo read and write the open project's sound
  settings (`state.sound`), exactly as the sound panel does. Their greyed state comes from
  `soundPanelModel`:
  - saturation needs mastering on;
  - each stage's own switch can be off.
  The tooltip says why, as the panel does. Their on/off switches stay in the sound panel, and the
  panel is still the only place for the other stages.
- **When the sound controls are live.** Today the master strip shows only while something sounds
  (`previewingSlotIds.size > 0`). In the radio view the group is always there, and level, reverb,
  filter and res are disabled while nothing sounds, so the strip does not jump.

#### mix

| control | today | in the strip |
|---|---|---|
| similar all | header row 2 dice (`rerollAll`, Cmd-aware) | same dice icon |
| keep | header row 2 (`keepGroup`), `keeping…` / kept label, `discover-add-pulse` | same |
| fetch hearts | header row 2 (`fetchHearts`), `RadioHeartsKeyModal` | same |
| add to shelf, add to timeline | header row 2, `✓ added`, pulse, listen-only dimming | same |

#### The radio menu's hint paragraph

The paragraph at the foot of the running menu goes. Each of its sentences becomes the tooltip
(`data-tooltip`) of the control it explains:

- pace: `RADIO_PACE_TOOLTIP`, plus the sentences about fast, 71, 80 and 100;
- `loop end`, `phrase`, `transitions`, `density`, `turnarounds` and `fold` each get their own
  sentence.

The words are kept as they are, cut at the sentence boundaries, with two exceptions:
`loop end`'s sentence drops its leading `below that,` (its `that` was the pace sentence before
it), and `turnarounds` takes its sentence in place of today's `end of phrase`, which says the same
thing. The new `turnover` chips get their own tooltip (`which row changes next: even, the one that
has gone longest; random, any`).

### 1.4 Starting radio

The `start` mode of `DiscoverRadioMenu` is the one part of the menu that is not a running setting.
It is Elling's 2026-09-28 rule: "the initial prompt should be slow mid fast so the app knows how to
start everything". It stays.

- It becomes `RadioStartPrompt.tsx`: the pace slider, the `start` chip, density, and channels when
  density is `off`.
- It keeps today's position, dismissal and Escape capture.
- `start` calls `startRadio(level)` as now. The radio view then appears, and focus moves to the
  top line's `radio` button.

The running menu's chevron (`v`, `radioChevronRef`) and `DiscoverRadioMenu.tsx` itself are
deleted.

## 2. Notifications: the web's vocabulary on the desktop

**Token map** (web `full.css`, then sssketch):

| web | sssketch |
|---|---|
| `--ink` | `--ra-text` |
| `--mid` | `--ra-text-2` |
| `--faint` | `--ra-text-3` (words), `--ra-text-4` (rules, controls that cannot act) |
| `--page` | `--ra-bg-page` |
| `--well` | `--ra-bg-row-active` |
| `--mark` (playhead, landing flicker) | `--ra-playhead` |

`--ra-playhead` is a colour on chrome only in the landing flicker, and that flicker marks an audio
event: the web uses its playhead colour for it for that reason.

**Each current desktop radio notification, and what it becomes:**

| desktop today | web equivalent | in the radio view |
|---|---|---|
| status line in header row 2, `nowrap` with ellipsis, `--ra-text-3` | `.status-line`, wraps, centred | top line, wraps, `--ra-text-2` |
| phrase ruler, 160px, played `--ra-text-3` / unplayed `--ra-border` | `.ruler`, up to 320px, played ink / unplayed faint | top line, up to 320px, `--ra-text` / `--ra-text-4` |
| fold status line in header row 2 | `.fold-status` under the ruler | under the ruler |
| row readout: one line across the top, `--ra-text-3`, 8px, no plate | `.info` plate top-left (ink), `.cue` plate bottom-right | label plate top-left `--ra-text`; cue plate bottom-right |
| gesture flashes (transition words, turnaround moves, `gap`, `throw`) in the row's top-right run | `.flash` in `.cue`, opacity over its bar | in the cue plate, `radioFlashOpacity` as now |
| `next · <arrival>` in the row's top-right run | `.next-note` in `.cue` | in the cue plate, `--ra-text-2` |
| fold readout, grid track 18, outside the waveform | `.fold` plate over the waveform's top-right | fold plate on the waveform; tracks 16-18 go |
| approach breath, armed/held, on the row background | `.row[data-approach]`, same mix | unchanged, now the whole two-line block |
| holding: 👍 inverted fill | `.row.holding::before`, 2px bar at the left edge | the bar; 👍 shows only the star |
| 👎 filled while set | 👎 filled while set | unchanged |
| skip pulsing while its roll is in flight (`discover-slot-pulse`) | `.pending`, slow pulse | unchanged (same idea) |
| none | the strip's `skip` flickers in the mark colour when a change lands | **new**: the strip's `skip` flickers (`--ra-playhead`, 600ms, the web's `full-flicker`) once per landing moment |
| `no fave fits`: console only (`pickForSlot`) | row flash `no fave fits` (`NO_FAVE_FITS`, `onFavesFallback`) | **new**: the same row flash on the desktop |
| `no near fits` (dig): console only (`pickForSlot`) | row flash `no near fits` (`NO_NEAR_FITS`, `onNearFallback`, 021f95c) | **new**: the same row flash on the desktop |
| `hook out` / `hook back`, `dig` flashes; role words in the age; away hook's name | the same (ell.ing/radio 00af232, 22de927) | unchanged words; the away name moves to the bottom bar |
| turn button `turning` / `nothing to turn` (2s) plus held chip and `not now` chips | same words and states | unchanged, in the shape group |
| radio button lit plus 2px interval-progress line | (none; play/stop is the radio) | unchanged, top line left |
| manual change waiting: rerolls dimmed | (none) | desktop-only, unchanged |
| resolving placeholder (`LoadingLoader`), `no match` (`--ra-mute-on`), failed pulse | (none) | desktop-only, unchanged |
| keep / fetch hearts / add labels and `discover-add-pulse` | (none) | desktop-only, unchanged, in the mix group |
| artist and lingering notices | (none) | desktop-only, unchanged, under the top line |

**The landing flicker:**

- **When.** It fires when radio's change (or a course change, a density-arc add, a hook's exit or
  return, or a manual change waiting for the top) is heard: in the panel's clock tick, in the
  branch that lands them at the wrap or a held bar, and in the course change's own branch. A
  staged change's engine swap (ack or tick, whichever wins) and an unstaged commit both pass
  there. (The first draft named the ack and `commitSlotPick`; the ack races the tick, and
  `commitSlotPick` also runs for manual Cmd changes, so neither is the right hook.)
- **Once.** Several rows landing on one wrap flicker once, coalesced within 50ms as the web's
  `onLanding` does.
- **Never from a manual Cmd change.** It answers the question "did radio's change just happen",
  and a manual Cmd change is not one.
- **Reduced motion.** With `prefers-reduced-motion`, there is no animation.

**`no fave fits` and `no near fits`.**

- **What.** The fallback branches in `pickForSlot`, which today log the messages, also push a
  `RadioFlash` for that row onto `radioFlashLogRef`. The flashes have the words `NO_FAVE_FITS` and
  `NO_NEAR_FITS` and the keys `fave@<row>@<roll generation>` and `near@<row>@<roll generation>`
  (the web keys its by the arm token), and they are shown by the readout's existing flash path.
- **Who sees it.** It is radio-only: a pick with radio off has no readout to show it in.
- **What it changes.** It is the only notification in this spec that adds a write to readout
  state. It changes nothing about the pick.

## 3. Component structure

`DiscoverPanel.tsx` is 14,211 lines (12,192 when this spec was first written). The radio view must
not add to it, so the rendering moves out and the state stays where it is: refs, effects and
callbacks remain in `DiscoverPanel`, which passes values and handlers down.

All new files sit in `src/renderer/src/components/` itself, which has no subfolders (the first
draft put them in `components/discover/` and `components/discover/radio/`).

- **`components/discoverCandidateStem.ts`.** `ResolvedCandidateStem`, `resolveCandidateStem`,
  `peekResolvedCandidateStem` and their two caches, moved out of `DiscoverPanel.tsx` verbatim,
  because both the panel and the row use them.
- **`components/DiscoverSlotRow.tsx`.** This is today's `DiscoverSlotRow`, with its
  helpers (`RowIconButton`, `LockGlyph`, `RadioRoleButtons`, the grid constants), moved verbatim
  first as its own commit with no change. It then gains `layout: 'grid' | 'radio'`. `grid` is today's row. `radio`
  is section 1.2, built from the same child elements, so every button keeps one implementation.
- **`components/RadioRowPlates.tsx`.** It draws the label, cue, away-name and fold plates.
  Props are the row's `RadioReadoutRow`, the fold label and `slot.id` (for `data-fold-dot`). It is
  used only by the radio layout.
- **`components/RadioTopLine.tsx`.** It draws play/stop, `radio` with its progress
  line, status, ruler, fold status, and undo/redo. Props are values and callbacks only.
- **`components/RadioStrip.tsx`.** It draws the six groups from `radioStripModel`
  (section 4). Props come in bundles, so the call site stays readable:
  - `settings` and `onRadioSettingsChange`;
  - `play`: tempo, `seedTempo`, `skip`, `newBed`, `skipFlickerKey`;
  - `picks`: faves, source, matching, artist field and menu, modifiers;
  - `turn`: `shown`, `can`, `flash`, `onTurn`;
  - `sound`: master values and setters, project sound and `onSoundPatch`, `sounding`;
  - `mix`: the five actions and their labels.
- **`components/RadioControls.tsx`.** It holds `PaceSlider`, `FoldSlider` and
  `FoldSeedInput` (moved out of `DiscoverRadioMenu.tsx`), plus the strip's `Chip`, `WordSwitch` and
  `StripDial`. `StripDial` is a `Dial` at size 22 with the caption beside it, which blurs after a
  pointer gesture.
- **`components/RadioStartPrompt.tsx`.** It is section 1.4.

**In `DiscoverPanel`'s return**, the header rows and master strip become
`radioOn ? <RadioTopLine/> : <today's two rows/>` and `radioOn ? null : <master strip/>`. The rows
wrapper (`rowsRef`) stays the same element in both modes, at the same place in the tree, so
switching radio on or off re-renders the rows without remounting them. A remount would lose each
row's local state: nearby popover, `rerollAction`, an in-progress gain drag, and `Waveform`'s
memo. `<RadioStrip/>` renders after the rows wrapper only when radio is on. In the add row, the
faves dial, the `[x]` modifiers, source and matching render only when radio is off.

No new contexts or reducers are added. The phone remote reads panel state over IPC
(`remoteCommandRef`, the sofa push) and is untouched.

## 4. Pure helpers and tests

React components are untested by convention. The logic they draw goes in pure, tested helpers, as
the web's `fullModel.ts` does and as `@shared/soundPanelModel` already does for the sound panel.

- **`src/shared/radioStripModel.ts`.** It maps
  `radioStripModel(settings, { artistMode, hasUsername, sound, sounding })` to the groups, in
  order. Each group carries its controls with `id`, `label`, `kind` (`chips | slider | switch |
  seed | sound | panel`: `sound` carries the sound panel's own slider control, `panel` is drawn by
  the panel from its own state), `sets` (the `RadioSettings` keys it writes), `disabled`,
  `dimmed`, `tooltip`, and the patch each choice makes. A control that does not show is not in its
  group. `soundDialPosition` / `soundDialValue` map a 0..100 dial onto a sound slider's range and
  step. The visibility rules live here:
  - channels shows only with density `off`;
  - moves and depth show only while turnarounds is not `off`;
  - bend, mismatch, seed and `new` show only with fold on.
  Tests:
  - **Nothing hidden.** Every key of `DEFAULT_RADIO_SETTINGS` except the legacy `pace` and
    `paceBars` (superseded by `paceLevel`, kept only for migration) is set by some control. A new
    radio setting without a strip control fails this test.
  - The visibility rules at each state.
  - Option lists equal the `@shared` constants (`RADIO_PHRASE_OPTIONS`, `RADIO_LOOP_END_OPTIONS`,
    `RADIO_TURNOVER_OPTIONS`, `TURNAROUND_FAMILIES` and the rest), so a new option shows up
    without a UI edit.
  - Every label and tooltip is lowercase, with no emoji and no `!`.
  - Each hint-paragraph sentence (section 1.3) lands on exactly one control.
  - The saturation, pump and echo dials' greyed state equals `soundPanelModel`'s for the same
    settings, and their patches equal the panel's.
- **`src/shared/radioRowPlates.ts`.** It maps `radioRowPlates(readoutRow, foldLabel)` to
  `{ info: { label, tail } | null; cue: { flash, next } | null; fold: string | null }`. This is the
  web's `full.ts` render logic (the label and its whole tail, the cue hidden when empty), lifted so
  both runtimes can share it. Scope A does not change the web, so the web keeps its own copy for
  now. Tests: the split, role words kept in the tail, the empty cases, a folded row, and a flash
  with no `next`.
- **`src/shared/radioLanding.ts`.** It holds `shouldFlickerLanding(prevAt, at, source)`: the
  50ms coalescing, and manual-Cmd changes excluded. Tested.
- **Checks.** `npm run typecheck`, `npm run lint` and `npm test` must pass.
- **The walkthrough is Elling's.** No agent can see or hear the app. The plan ends with a
  walkthrough checklist for Elling covering:
  - 945px, 1440px and full-screen widths;
  - fold on and off;
  - artist mode;
  - the landing flicker;
  - `no fave fits` with faves at 100 and no starred stem of a kind;
  - Escape in the seed field;
  - `t` after a slider drag;
  - switching radio off mid-change.

## 5. Widths and keyboard

**Widths.** The minimum window is 945×614 (`src/main/index.ts`), and Discover fills the library
view's width less 10px of padding on each side. These figures are estimated from Silkscreen at
9–10px and must be checked by eye:

- **945px:** the strip wraps to five or six lines (about 150px). Picks and shape each take two
  lines. The top line is about 60px with fold on. At 614px tall, about three rows show at once, and
  the rest scroll between the sticky top line and strip.
- **1440px:** the strip is three or four lines.
- **1920px and up:** the strip is two or three lines. Rows are capped at `max-width: 1200px`,
  centred, as on the web, so the waveforms stay readable rather than very long.
- **The rows.** The row's button line holds its 10 buttons plus the 110px kinds block, about
  340px. It fits at every width the app allows, so it never wraps. The waveform takes whatever
  width is left: all of it.

**Keyboard and accessibility:**

- **Tab order follows reading order:** top line, then each row (its button line left to right,
  then the waveform's gain button), then the strip, group by group, then the add row.
- **`t`** works as today. The strip's sliders and dials blur after a pointer gesture (section 1.3).
- **Escape.** It no longer closes a menu, because there is none. In the seed field it reverts the
  draft and stops propagation (section 6). The artist picker, nearby popover, kind picker and start
  prompt keep their own Escape capture.
- **Grouping.** Groups are `role="group"` with their caption as `aria-label`.
- **Row buttons** keep their aria-labels and `aria-pressed`.
- **Plates** are `aria-hidden`, as on the web and as today's overlay is. The readout's row label is
  added to each row's `aria-label`, e.g. `row 2: drums · heavy`. This is the only accessibility
  name the radio layout adds, and the web does the same.
- **Reduced motion.** With `prefers-reduced-motion`, the flicker and the pending pulse do not
  animate. The breath still follows the music, as it is a slow luminance change and not motion.

## 6. Migration risks

- **Remounting rows.** If the radio layout renders rows in a different parent, React remounts every
  row on radio on/off. The rows wrapper must be the same element in both modes (section 3).
- **Imperative writes.** `rowsRef` (`--discover-breath`), `sweepLineRef` and `[data-fold-dot]` are
  written outside React by the sweep layout effect. The radio layout must keep the same ref and
  attribute, and the plan must check each by grep.
- **The playhead overlay.** The grid overlay is kept for the grid layout and replaced for the
  radio layout. Forgetting the split misplaces the line in one of them.
- **Escape.** Escape while typing a seed used to be caught by the menu's capture-phase handler. In
  the strip it would reach `LibraryBrowser`'s window-level Escape and close the whole library. The
  seed field must stop propagation.
- **Project sound from Discover.** Saturation, pump and echo edit the open project
  (`SET_SOUND_SETTINGS`). A change is undoable with Cmd+Z in the arrangement, marks the project
  unsaved, and reloads the engine project once per release, exactly as the sound panel does. The
  dials' tooltip says `project sound`. Decided 3 (end of this spec): this is what Elling wants.
- **Two faves widgets become one.** In the radio view only the strip's dial sets faves. The add
  row's dial returns with radio off. Both use `previewFaves`/`commitFaves`, so there is no
  divergence.
- **The anointed-stems spec.** It has landed (2026-10-04 update): its hook and dig buttons
  (`RadioRoleButtons`) move from grid tracks 16-17 into the button line, its role words ride the
  label plate's tail, and its away hook's name moves to the bottom bar. Nothing of it may be
  dropped in the move.
- **File size.** Moving `DiscoverSlotRow` out (about 1,900 lines with its helpers, plus the
  candidate-stem resolver) is a pure move. It goes first, alone, and typecheck and lint must pass before anything else changes, because explicit
  `gridColumn` numbers have caused off-by-one bugs here before.
- **Sticky strip at the minimum height.** Five or six strip lines plus the top line leave about
  three rows visible at 614px. That is acceptable: the rows scroll. If Elling finds it cramped,
  the fix is narrower captions or chip rows, not hiding settings.

## Decided (Elling, 2026-10-04): the three open questions, answered with this spec's defaults

1. **Starting radio.** Keep the start prompt (pace, density, channels, `start`), as section 1.4
   proposes.
2. **`hold`.** No whole-mix hold now. The strip has no `hold`; a real mix hold would be its own
   small spec.
3. **Saturation, pump and echo.** The strip's dials change the open project's sound, the same
   settings the sound panel edits: undoable, saved with the project, marking it unsaved.

## As built (2026-10-04, sssketch 29d6a6a..0255dfa; final review, plan Task 14)

**Shipped.** The three pure modules (`@shared/radioStripModel`, `radioRowPlates`, `radioLanding`,
TDD), the row moved out of `DiscoverPanel.tsx` (`DiscoverSlotRow.tsx`, with
`discoverCandidateStem.ts` and `discoverRowGrid.ts`), its parts named, the radio row layout over
the same `rowsRef` wrapper, the strip (play, picks, shape, fold, sound, mix), its sound group, the
sticky top line, `RadioStartPrompt` with `DiscoverRadioMenu.tsx` deleted, the landing flicker and
the `no fave fits` / `no near fits` flashes, and the grid's dead radio branches removed (15 tracks
again). `npm run typecheck`, `npm run lint` (0 errors; 4 warnings in unrelated files) and
`npm test` (287 files, 4783 tests) are green at 0255dfa. The plan's grep sweep holds: one
`ref={rowsRef}`, one `ref={sweepLineRef}`, `data-fold-dot=` only in `RadioRowPlates.tsx`, no
`DiscoverRadioMenu` / `radioChevronRef` anywhere, no grid track 16-18, the seed field's Escape
stops propagation.

**Decided while building.**
- The sticky bars sit on `--ra-bg-bar`, not `--ra-bg-page`: that is the library box's own fill
  (`LibraryBrowser`), so the bars do not read as a band (`RADIO_STICKY_BACKGROUND`).
- Every setting the running menu made, the strip makes (inventory against the deleted menu:
  pace, loop end, phrase, density, channels, turnarounds, moves, depth, builds, transitions, faves,
  fold, bend, mismatch, seed and `new`, `new bed`), plus `turnover`, which had no control before.
  The start prompt keeps exactly the menu's start mode (pace and `start`, density, channels).
- The switch between layouts keeps every `DiscoverSlotRow` mounted (its state, its resolution),
  but the row's inner DOM is regrouped (a button line and the waveform in radio, grid cells
  otherwise), so the waveform's element is rebuilt on the switch from the peak cache's
  synchronous peek.

**Known gaps from the final review** (see the review for file and line):
- The lingering and artist notes keep their `marginTop: -6`, which tucked them under header row
  2's 10px margin; under the sticky top line (no margin, opaque, `zIndex: 2`) their top 6px would
  be painted over.
- The strip's `skip` would flicker once each time radio starts after a landing in an earlier run
  (`radioSkipFlicker` is not reset, and the strip remounts with the class on).
- Several comments still name "the radio menu" (`DiscoverPanel.tsx`, `App.tsx`,
  `LibraryBrowser.tsx`, `radioSchedule.ts`).

**Not seen by any agent.** No agent can run the app, see it, hear it or click it. Everything
above is typecheck, lint, the shared tests, grep checks and reading the code.

**Elling's walkthrough** (14 items; none done yet):
1. **Widths.** At the 945px minimum, at 1440px and full screen: the top line, rows and strip fit
   with no horizontal scroll; the strip wraps into captioned groups; at 945x614 about three rows
   show and the rest scroll between the sticky top line and strip; rows stop at 1200px wide and
   centre on a big screen.
2. **No remount.** With a loop playing, start radio and stop it: the music does not restart or
   drop out, and no waveform blinks to the loading line.
3. Open a row's kind picker or nearby popover, then press `t`: it stays open; a reroll in flight
   (its button pulsing) keeps pulsing across a radio start.
4. **The playhead** runs over the waveforms (not the buttons' column) in both layouts, also after
   switching while paused; the breath (armed, held) lights the whole two-line row.
5. **Rows:** every button works as before, Cmd-click included (skip, any stem, nearby, duplicate
   land at once); hook and dig toggle; holding shows the left bar and 👍 shows only the star; the
   away hook's name sits bottom left, tap brings it back; the label cuts before the age and role
   words do; the cue (flash, `next · ...`) bottom right; folded rows show `7 / 16` with a moving
   dot top right.
6. **The strip:** each control does what the menu or old place did (pace's readout in fold mode,
   phrase, loop end, transitions, turnarounds, moves/depth appearing with turnarounds on, builds,
   density, channels appearing with density off, turnover now settable, fold switch and its
   hidden-when-off sliders and seed, `new`).
7. **Sound:** saturation greyed with mastering off (tooltip says so); pump / echo greyed when
   switched off in the sound panel; a saturation change is undone by Cmd+Z in the arrangement and
   marks the project unsaved; level, reverb, filter, res greyed while nothing sounds.
8. **Escape in the seed field** reverts the text and the library stays open.
9. **`t` after a pace or bend drag** turns at once.
10. **Start prompt:** `radio` (off) opens it as before; `start` starts at the slider's pace and the
    top line's `radio` has focus; pressing it stops radio, returns the normal layout and focuses
    the header's `radio`.
11. **Landing flicker:** `skip` in the strip flickers once when radio's change lands (once for a
    combined change), not for a Cmd change; with reduced motion on (System Settings >
    Accessibility > Display), no flicker and no pulse in the radio view.
12. **`no fave fits`:** faves at 100 with no starred stem of a row's kind: the row flashes it.
    **`no near fits`:** dig a row whose jam has nothing near: the row flashes it.
13. Switching radio off mid-change (a row breathing, a turn waiting): the normal layout comes back
    and the change lands or withdraws as it did before this work. Also check: with an artist
    picked or the lingering notice showing, its note under the top line is fully readable.
14. The phone remote works as before.
