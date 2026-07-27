# Rifff Arranger ("bendlesss") — Design

## Overview

A lightweight arranger for stitching Endlesss rifffs (multi-stem jam recordings) into a
finished track. Not a DAW: no MIDI, no plugin instruments, no realtime FX chains, no
session/arrangement duality. Scope is exactly five things:

1. Drag-and-drop rifffs into the arranger as **linked, pre-aligned stem groups**,
   imported into a managed local library (see "Data / Import Pipeline" — this revises
   the original handoff spec's "reference only, nothing copied" framing; see note there)
2. **Unlink** to break a group into independent stems
3. **BPM-aware time-stretch** per rifff/stem, pitch preserved
4. **Grid-snapped offset** per stem/group for fine sync correction
5. **Per-stem volume**

The full visual/interaction spec lives in the handed-off design package
(`Rifff Arranger.dc.html`, `tokens.css`, `rifff-visuals.js`, `README.md`, screenshots) —
that package is **high-fidelity and final-intent** for colors, type, spacing, and control
behavior. This document covers what that package explicitly leaves open: the
implementation target. Only the recommended screen, **2a (shelf + collapsed rifff blocks +
inspector)**, is being built; 1a/1b/1c remain reference-only.

## Stack

- **Electron** (macOS only for v1) + **React** + **TypeScript**, scaffolded with
  `electron-vite`.
- Single window app. No multi-window, no web deployment target.
- State/store: a single store matching the spec's documented state shape (see
  "State & Persistence" below), implemented as a plain reducer — the shape is small and
  fully specified already, no need for a state library.

## Data / Import Pipeline

> **Revision to the visual handoff spec:** the original design package specifies
> reference-only import ("0 files copied", "reference only, nothing copied" in the
> drop-zone copy). Elling asked to change this after seeing the design: Endlesss exports
> often land somewhere transient (Downloads), and dragging stems directly out of the
> Endlesss app itself — not a Finder folder — is a workflow he wants supported. Both
> point at copy-on-import instead. **The titlebar/shelf copy text changes accordingly**
> ("N rifffs referenced · 0 files copied" → "N rifffs imported"); everything else about
> the visual spec (layout, colors, control behavior) is unaffected, since the UI never
> displayed a file path anywhere except the inspector's source-path line, which now shows
> the library copy's path instead of the original.

**Two drop sources, both produce one rifff group per drop event:**
1. **A folder dropped from Finder** — scanned one level deep (non-recursive) for `.wav`
   files, as before.
2. **One or more loose `.wav` files dropped directly** (e.g. dragged out of the Endlesss
   app's own UI, which hands the OS a flat file list rather than a folder) — every file
   in that single drop event is treated as one rifff's stems.

**Scanning:** filenames (from either source) are parsed against the convention confirmed
by both the spec and a real sample rifff Elling provided (`fixtures/sample-rifff/`):

```
{slot} - {author} - {stem name} - {bpm}BPM - {timestamp}.wav
```

Non-matching files are ignored (not every drop will be a valid rifff export — a drop
that yields zero matching stems is a no-op, see Error Handling).

**Copy on import:** every matching stem file is copied into a managed library at
`~/Music/Rifff Arranger Library/{rifff-id}/{original filename}`, where `{rifff-id}` is
the same `groupId` used throughout app state. This is a real byte copy (not a symlink),
so the app keeps working even if the original export folder/file is later moved or
deleted. `Stem.path` in app state always points at the library copy, never the original
location.

**Derived metadata:**
- Rifff name = the dropped folder's name (folder-drop case) with a trailing `" Stems"`
  suffix stripped if present, or the common prefix/timestamp shared by the dropped files
  (loose-file case) — falls back to `"untitled rifff"` if no reasonable name can be
  derived from a loose-file drop.
- Rifff BPM = the statistical mode of the per-stem BPMs parsed from filenames (they
  should all agree; mode is a defensive default if one file is mis-tagged).
- Author = author field from filenames (used for the inspector's "source: X and N more"
  line).
- Per-stem bar length = `round(duration / ((60 / bpm) * 4))`, duration read from the WAV
  header.
- Rifff bar length = `max(stem bar lengths)` — shorter stems loop within the rifff's
  span, per the spec's "loop-length handling" (draw one clip per repetition).

**Sound-type assignment:** Endlesss doesn't encode sound-type (drums/notes/bass/ext
inst/sampler/fx/ext fx/audio in) in the filename or in any sidecar file — confirmed by
the sample rifff, whose stem names (Highpass, Comb, Freezer, Channel, Saturator, Sunset)
give no reliable hint. So:
- Every stem defaults to one neutral type on import (`fx`).
- The type-swatch square (already present in the spec's inspector stem row and shelf
  chips) becomes **click-to-cycle** through the 8 types. This reuses existing visual
  real estate rather than adding a new control, keeping the recreation faithful to the
  spec's layout.
- The assignment is persisted per stem in the project file so it only has to be set once.

## Audio Engine

**Playback graph:** Web Audio API in the renderer. One `AudioBufferSourceNode` →
`GainNode` (volume/mute) per stem, all scheduled against a single transport clock
derived from `AudioContext.currentTime` — not from UI frame timing — so stem sync stays
sample-accurate regardless of render load. The playhead UI redraw is throttled to ~18fps
per the spec, independent of the actual audio scheduling.

**Time-stretch:** native quality, via a bundled `rubberband` CLI binary (macOS
arm64) invoked from the Electron main process.
- On a stretch-relevant change (tempo committed, stretch toggled on, or a new rifff
  dropped while stretch is on), main renders a stretched WAV into an on-disk cache,
  keyed by `(stem absolute path, target ratio)`.
- Renderer swaps in the rendered buffer once the render completes; until then it keeps
  playing the previous buffer (or native, before the first render lands).
- Numeric/visual feedback (clip width, tempo readout, ms/step) updates immediately on
  every tempo tick per the spec — only the *audio* has render latency, which is an
  accepted trade-off for native-quality (vs. WASM) stretching.
- Offset, mute, and volume are plain Web Audio params — applied instantly, no rendering
  involved.

## State & Persistence

Store shape (matches the spec's documented state model, extended with the rifff
metadata this design adds):

```
playing        boolean
pos            number                        // playhead in bars (float), 0..32
bpm            number                        // project tempo, default 80
snapIdx        0..3                          // -> 1/4, 1/8, 1/16, 1/32
vol            { [stemKey]: 0..1 }
mute           { [stemKey]: boolean }
off            { [groupId|stemKey]: int }    // grid steps, -8..8
stretch        { [groupId]: boolean }
unlinked       { [groupId]: boolean }
sel            groupId
exp            { [groupId]: boolean }
rifffs         {
  [groupId]: {
    name, bpm, folderPath, barLength,
    stems: [{ slot, name, author, type, path, barLength }]
  }
}
```

**Project file:** JSON on disk, user-named and saved/loaded like any document (File >
Save/Open, matches the "untitled sketch 04" title bar affordance). Contains the state
above — including each stem's library-copy path and per-stem type assignments — plus the
original source folder path as provenance metadata only (not required for playback,
since the library copy is authoritative). Does **not** contain audio or peak data.

**Cache directory** (app support, not the project file): rendered stretched-audio
buffers and extracted peak arrays, both keyed by absolute stem path so they're reusable
across projects. Peaks are decoded once via Web Audio on first import and cached;
re-opening a project doesn't re-decode.

## UI

Direct port of the 2a layout from the design package into React components, pulling
exact values from `tokens.css` / the README's token tables rather than the prototype's
inline styles (per the handoff README's own instruction to treat the `.dc.html` as
reference, not code to lift):

- `Titlebar`
- `Shelf` (rifff cards + drop target)
- `TransportBar` (play/stop, position readout, tempo ±, snap chip)
- `Ruler`
- `RifffBlockRow` (+ `StemSubRow` when expanded)
- `Playhead` (overlay)
- `Inspector` (Header / Tempo / Offset / Stems sections)
- `PolarGlyph` (shared by shelf cards, inspector header, block header — sizes 40/34/30px)

`rifff-visuals.js`'s helpers (peak downsampling, clip waveform path, polar glyph path,
dB/offset/position formatting) are ported in directly rather than reimplemented.

## Error Handling

- **Dropped folder/files have no matching WAVs:** shelf drop target shows an inline
  message (reuses the existing hint-text styling) instead of adding a rifff; nothing
  enters state, nothing is copied.
- **Rubberband render fails** (bad binary, corrupt WAV): stem falls back to native-speed
  playback and the inspector's tempo note line shows the spec's existing "will drift
  against the grid" copy — no new UI needed, this is already a defined state for
  stretch-off.
- **Library copy is missing on load** (rare — the user would have to manually delete a
  file from `~/Music/Rifff Arranger Library`, since the app no longer depends on the
  original source folder staying put): rifff loads with its saved metadata but shows a
  "source not found" state in place of the waveform; stems are silent. The inspector's
  source-path line (already spec'd, `word-break: break-all`) becomes clickable and opens
  a file/folder picker to re-import, matched back onto the existing rifff's saved state
  (offsets, volumes, type assignments) rather than creating a new one.

## Testing

- **Vitest**, pure logic only: filename parsing, bar-length math, dB/offset/position
  formatting helpers (ported from `rifff-visuals.js`), and the reducer.
- **Manual verification** in the running Electron app against `fixtures/sample-rifff/`
  (6 real stems, 150 BPM, confirmed durations of 8/2/1 bars) for: drag-drop import,
  playback sync, time-stretch rendering, offset/volume/mute, unlink/relink, save/load.
  Native audio + Electron drag-drop aren't practical to meaningfully unit-test.

## Out of Scope for v1

Same as the source spec: MIDI, plugin instruments, realtime FX, automation,
fades/crossfades, clip trimming, multiple takes per lane, export/bounce, undo history
beyond the arranger's own actions, mobile layout, Windows/Linux packaging, screens
1a/1b/1c.
