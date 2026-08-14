# sssketch — user guide

sssketch is a desktop app for arranging Endlesss "rifff" stem exports into a
timeline/DAW-like project, with real-time playback and VST3/AU plugin hosting
handled by a native audio engine. This guide covers what the app does and how
to drive it. It does not cover installation/build — see the main `README.md`
for that.

> A couple of things below are flagged **(known issue)** — small gaps between
> what the UI implies and what it actually does right now. They're noted so
> you don't go looking for a feature that isn't there yet, or trust a label
> that doesn't update.

## Contents

- [Layout tour](#layout-tour)
- [Basic workflow](#basic-workflow)
- [Importing stems](#importing-stems)
- [The downbeat picker](#the-downbeat-picker)
- [Sketch mode vs. normal mode](#sketch-mode-vs-normal-mode)
- [Arranging clips](#arranging-clips)
- [Mute, solo, volume, fades](#mute-solo-volume-fades)
- [Plugins (VST3/AU)](#plugins-vst3au)
- [The riff library browser](#the-riff-library-browser)
- [One-shot samples](#one-shot-samples)
- [Project files, autosave, export](#project-files-autosave-export)
- [Key commands reference](#key-commands-reference)

---

## Layout tour

Top to bottom:

- **Titlebar** — app name and stem/rifff counts. The project-name text next
  to it is currently a static placeholder, not the real filename of your open
  project **(known issue)** — don't rely on it to tell you what's open.
- **Project menu** — new / save / open / export, right below the titlebar.
- **Shelf** — a horizontal tray of imported-but-not-yet-placed rifffs. This is
  also where you drag new folders/files to import them. Click a tile to
  preview it; drag it down onto the timeline to place it.
- **Transport bar** — play/pause, stop, position, tempo, snap-grid, the
  volume/envelope drag-mode toggle, the master plugin chain button, the
  sketch/normal mode toggle, metronome, undo/redo.
- **Ruler** — bar numbers; click or drag to scrub the playhead.
- **Timeline** — the arranger surface itself. Its shape depends on the mode
  (see [Sketch mode vs. normal mode](#sketch-mode-vs-normal-mode)).
- **Inspector** (right sidebar, collapsible) — details for whichever rifff is
  currently selected: rename, re-import, tempo/stretch, fine sync offset,
  re-pick beat, per-stem list, ungroup.

## Basic workflow

1. **Import** a rifff — drag an Endlesss export folder (or loose stem files)
   onto the Shelf, or pull one in from the [riff library browser](#the-riff-library-browser).
2. **Fix the downbeat** — the [downbeat picker](#the-downbeat-picker) opens
   automatically right after import so you can mark where the loop actually
   starts.
3. **Arrange** — drag the Shelf tile onto the timeline. In normal mode,
   position and channel are yours to set; in sketch mode, order is the only
   thing you control.
4. **Edit** — mute, adjust volume/fades, resize loop length, nudge for sync,
   ungroup a multi-stem rifff into independent clips (normal mode only).
5. **Add effects** — open the master chain and/or a channel's own effects
   chain, scan for installed plugins once, and assign them to slots.
6. **Play it back** — <kbd>Space</kbd> or the transport play button.
7. **Export** — mix down to one WAV, or export every stem to its own WAV.
8. **Save** — `.sssketchproj` project files, plus continuous autosave in the
   background.

## Importing stems

Drag either of these onto the **Shelf**:

- A folder of Endlesss export WAVs (scanned one level deep).
- Loose `.wav` stem files straight out of the Endlesss app.

sssketch parses Endlesss's filename convention (slot, author, stem name, BPM,
timestamp) and copies everything into a managed local library at
`~/Music/Rifff Arranger Library/<rifff-id>/`. The whole rifff — all its stems,
pre-aligned to each other — becomes one Shelf tile.

## The downbeat picker

Endlesss exports aren't always trimmed to start exactly on beat 1. Right after
import, a full-screen picker opens showing every stem's own spectrogram lane
over a beat grid. Click the beat where the loop should actually start; that
correction is baked into a rotated copy of the audio.

You can reopen this later from the Inspector's **re-pick beat** button if the
original guess was wrong.

When importing several rifffs at once (e.g. a batch from the riff library browser),
use <kbd>←</kbd>/<kbd>→</kbd> to move between them — the app pre-selects
whichever one it thinks most needs a correction.

## Sketch mode vs. normal mode

Toggle with <kbd>Tab</kbd> or the mode button in the transport bar.

| | Sketch mode | Normal mode |
|---|---|---|
| Look | One row of uniform circular tiles | Stacked channel rows; each clip sized/positioned by actual bar length and position |
| What you can do | Reorder by dragging — that's it | Full editing: mute, volume, fades, resize, nudge, ungroup, channel reassignment, plugin chains |
| Plays back | Strictly one rifff at a time, gapless | Any number of overlapping clips across any number of channels |
| Default for a new project | Yes | No |

Sketch mode is meant for quickly ordering ideas before you get into detailed
arranging. You can only switch **into** it if the current arrangement is
"plain" — every placed rifff linked, unfaded, unresized, at zero offset, and
gapless from bar 0. If it's not, the toggle button greys out with a tooltip
explaining why (an empty timeline always qualifies).

There used to be a third "compact" view mode; it's been removed in favor of
[timeline zoom](#key-commands-reference), so don't go looking for it.

## Arranging clips

In **normal mode**, each timeline row is a **channel** — an independent lane
any clip can be dragged onto, off of, or share with other clips (which then
simply overlap and mix, they don't collide/reject). Drag a Shelf tile down to
place it; drag a placed clip to reposition it in time or move it to a
different channel.

Each placed rifff can be shown two ways, toggled by clicking its name bar:

- **Collapsed** (default for a freshly-placed rifff) — one combined waveform
  block with small per-stem mute dots.
- **Expanded** — one full-detail row per stem, each with its own waveform,
  volume/fade envelope, and resize handles.

On an expanded stem's waveform:

- **Drag the body** — move the clip in time (or adjust volume/envelope, if
  [volume-drag mode](#key-commands-reference) is on).
- **Drag either edge** — resize how many bars the clip plays before its loop
  restarts.
- **Drag the envelope's flat plateau** — adjust volume.
- **Drag the envelope's knee points** — adjust fade-in/fade-out length.
- **Right-click** — mute that stem.
- **Double-click** — reset volume to its import-time default.

A multi-stem rifff can be **ungrouped** into independent single-stem clips
(name-bar right-click menu). This is one-way — there's no "regroup."

## Mute, solo, volume, fades

Mute and solo exist at three levels: per-stem, per-group (every stem in one
rifff), and per-channel (every clip on a row). Solo mutes everything *else*
that's currently placed.

- **Right-click** a stem or clip waveform → toggle mute.
- **Ctrl+right-click** → solo (that stem's rifff, or — from the name bar —
  the whole channel).
- Small **m**/**s** buttons on channel rows do the same thing without the
  modifier keys.

## Plugins (VST3/AU)

Two places to add effects:

- **Master chain** — a fixed 4-slot, in-series chain on the final mixed
  output, applied during both live playback and export. Open it from the
  **master** button in the transport bar.
- **Channel inserts** — a 2-slot chain per channel, opened from that
  channel's own **fx** button.

To use either:

1. Click **scan for plugins** (in the master chain panel) the first time —
   this probes everything in `/Library/Audio/Plug-Ins/VST3`, one plugin at a
   time in an isolated subprocess, so a single bad plugin can only cost its
   own timeout, never the whole scan.
2. Pick a plugin from a slot's dropdown. It shows your favourites by default;
   **browse all...** opens the full catalog, where you can star/unstar
   entries.
3. A colored dot on the slot shows idle/loading/loaded/error state (hover an
   error dot for the message).
4. Click **edit** on a loaded slot to open that plugin's own native editor
   window — a real separate window, not embedded in the app.

Legacy Intel-only plugins with no Apple Silicon build (tagged **(bridged)** in
the catalog) work the same way — sssketch runs them in a background helper
process automatically. Slot order is fixed (0→1→2→3 for the master chain,
0→1 for channel inserts) — there's no reordering UI.

## The riff library browser

sssketch keeps its own local, searchable library of your Endlesss riffs —
log in once and it syncs directly from Endlesss in the background, no
external tool required. Pick a jam, browse its riffs as a grid of small
circles (brightness shows your own contribution level to that riff; black
means it isn't fully downloaded locally yet), click a circle to preview it,
and import with one click.

- Paste a riff ID directly to jump straight to it.
- **Download missing stems** fetches anything not yet cached locally.
- <kbd>Esc</kbd> closes the panel.

If you already have a local archive synced by the separate, real LORE app
(OUROVEON), you can point sssketch at it instead from the settings menu's
**change riff archive location…** — an optional override, not required for
the browser to work.

## One-shot samples

Dragging a single `.wav` file straight onto the **timeline** (not the Shelf)
drops it in as a one-shot: it plays once, unlooped, at its own native
speed/pitch — no tempo-stretching.

- **Drag an edge** — trim.
- **Option+drag an edge** — pitch-preserving time-stretch instead of trim.
  (Not Ctrl — macOS treats Ctrl+drag as a secondary-click gesture, so Option
  is used instead.)

## Project files, autosave, export

- **Save/open** — `.sssketchproj` files (plain JSON) via the project menu.
  A fresh project gets an auto-generated name like `groovy-sparrow.sssketchproj`
  until you save it yourself.
- **Autosave** — runs continuously in the background to a separate file,
  independent of your own named saves. If sssketch finds one on next launch,
  it'll offer to recover it.
- **Export mix** — renders the full arrangement down to one stereo WAV.
- **Export stems** — renders one WAV per stem, each soloed for its own render
  (every other stem is force-muted for that pass, regardless of its actual
  mute state on screen).

Both export options go through the same native engine and plugin chains used
for live playback, so what you hear while arranging is what you get in the
file.

## Key commands reference

None of these are in a native menu bar (autoHideMenuBar just hides the OS
default, unused menu) — they're all live keyboard/mouse handlers, generally
disabled while a text field is focused.

### Transport & general

| Command | Action |
|---|---|
| <kbd>Space</kbd> | Play / pause |
| <kbd>Delete</kbd> / <kbd>Backspace</kbd> | Remove the selected clip (or Shelf item, or sketch tile — whichever panel it's in) |
| <kbd>Cmd</kbd>+<kbd>Z</kbd> | Undo |
| <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> | Redo |
| <kbd>Tab</kbd> | Toggle sketch mode ↔ normal mode |
| <kbd>V</kbd> | Toggle volume/envelope drag mode |
| <kbd>Option</kbd>, held | Volume/envelope drag mode while held |
| <kbd>Cmd</kbd>+drag on empty timeline background | Pan the timeline (grab cursor while Cmd is held) |
| <kbd>Cmd</kbd>+scroll (mostly-vertical gesture) | Zoom timeline horizontally, anchored under the cursor, 0.25x–4x |
| <kbd>Cmd</kbd>+<kbd>0</kbd> | Reset timeline zoom |

### Clicking on clips/stems

| Gesture | Action |
|---|---|
| Click a waveform | Scrub playhead to that point |
| Right-click a waveform | Toggle mute |
| <kbd>Ctrl</kbd>+right-click a waveform | Solo |
| Double-click a stem's waveform | Reset its volume to import-time default |
| Right-click a clip's name bar | Context menu: copy / duplicate / ungroup / re-bake downbeat / delete |
| Right-click empty timeline | Paste menu (if something's copied) |
| <kbd>Cmd</kbd>-drag a placed clip | Duplicate instead of move |
| Shift-click a tile (Shelf / sketch / riff library) | Range-select |
| <kbd>Cmd</kbd>-click a tile | Toggle individual selection |

### One-shot samples

| Gesture | Action |
|---|---|
| Drag an edge | Trim |
| <kbd>Option</kbd>+drag an edge | Pitch-preserving stretch |

### Downbeat picker

| Key | Action |
|---|---|
| <kbd>Esc</kbd> | Commit and close |
| <kbd>Space</kbd> | Start/stop preview loop, or mark the downbeat if already playing |
| <kbd>←</kbd> / <kbd>→</kbd> | Previous/next rifff in a batch import |

### riff library browser

| Key | Action |
|---|---|
| <kbd>Esc</kbd> | Close panel |
| <kbd>Enter</kbd> (in the riff-ID field) | Jump to that riff |

---

### Known issues worth knowing about

- The **titlebar's project name** is a static placeholder — it doesn't
  reflect your actual open filename.
- A **non-destructive "mute a section within a clip"** feature was designed
  (see `docs/superpowers/specs/2026-08-02-clip-section-removal-design.md`)
  but was never built — don't look for a marquee/region-select tool on
  waveforms, it isn't there.
- Plugin scanning currently covers **VST3 only** — AU plugins aren't scanned
  in this pass.
