# Changelog

## Unreleased — 2026-10-08

### Added

- Added the first **Shape Riff** editing slice for a single selected riff: split at the playhead, snapped or free fragment moves, Option-copy, duplicate, durable fragment/stem Disable, temporary Mute/Solo, reset, undo/redo, original/shaped A/B playback, and non-destructive save as a new shelf riff. Shape keeps the shelf visible and stores a versioned recipe against immutable source audio so results can be reopened and reset without generational quality loss.
- Added **Cross Riffs**, opened from exactly two selected riffs in Sketch, Arrange, Map, or the shelf. The three-column workspace can audition either source or the new center riff, move stems into the center by dragging or using inward buttons, generate matching stems, edit mute/solo/gain, undo and redo, change tempo, and add the result to the shelf or timeline.
- Added a draggable metronome-volume gesture while preserving click-to-toggle.
- Added clearer pre-commit re-one markers and recovery utilities for repairing older projects whose stems lost their shared phase lineage.
- Added focused tests for Cross assembly and playback, phase propagation, caching, import resolution, selection behavior, mixer state, save/quit handling, export naming, and native transport ordering.

### Changed

- Expanded Shape Riff into a clip-oriented editor: clip headers select and drag, clip bodies place an insertion marker, a Razor tool cuts at the marker, right-click exposes duplicate/reverse/disable/delete, Cmd-1/Cmd-2 resize the grid, Space starts from the selected clip (or riff start), and Shift-Space resumes from the stopped playhead. Shape now also exposes Discover-style stem adding with one trailing empty lane, Add to Timeline, and a warning before discarding unpublished edits.
- Cross now keeps one trailing empty center slot, grows as needed, discards unsaved drafts without an unnecessary confirmation, remembers the Endlesss/Other source setting, and places its actions and close control consistently with the rest of the app.
- Cross playback now auditions one whole column at a time. Clicking a stem switches to that column, tiled waveforms match the audible loop, a dim playhead shows position, and the active column has a larger animated playback indicator.
- Arrange view now places its compact Mute, Solo, and Gain controls in a narrow mixer rail beside the inspector instead of embedding them in arrangement lanes.
- Riff selection is available consistently from Sketch, Arrange, Map, and the shelf. Cross appears beside the inspector's Discover action only when exactly two riffs are selected.
- Sketch and Shelf now render one shared riff selection, and that working set survives opening and closing Cross or Discover so a newly created riff can be placed without losing the source context.
- Sketch riff clicks now distinguish selection from transport: the circular glyph plays, stops, or switches riffs, while the exposed square corners only select. Dragging never toggles playback.
- Riff selection styling is centered on the circular glyph and uses a restrained, low-contrast pixel texture while keeping selected and playing states visually distinct.
- Shelf previews take ownership of playback instead of layering over the running arrangement, and their highlighting is easier to see.
- Import browsing preserves the selected jam while moving back and forth, and clicking an already-playing import preview stops it.

### Fixed

- Added a strict, atomic native Shape renderer: preview and saved results use the same float-WAV path; every lane must decode, tempo-prepare, render, and validate before any saved batch is published, and Re-1 establishes a fresh Shape baseline instead of reopening stale recipe provenance.
- Preserved a riff's common phase origin through re-one, import, Discover, shelf, timeline, duplication, and Cross operations so stems no longer drift out of phase. Source files remain untouched; offsets and tempo adaptation are non-destructive.
- Fixed cached/category progress getting stuck below the true completed count and made cache state propagation more reliable.
- Fixed silent or stale import and shelf previews, preview ownership races, and ordered native-engine Play handling at the audio callback boundary.
- Made Solo non-destructive throughout Arrange, Sketch/Map, Discover, and Cross. Durable **Disable**, temporary **Mute**, and temporary **Solo** are now separate layers; clearing Solo restores the exact prior Mute state, while disabled stems remain disabled.
- Prevented an accidental Delete/Backspace from silently unplacing an entire multi-selection in Sketch: multi-riff removal now confirms first and is recorded as one atomic Undo step.
- Fixed Cross source stems with saved zero gain being inaudible when explicitly soloed, misleading default Solo indicators, aggressive source-row outlines, and center-slot over-allocation.
- Added dismiss buttons to both startup/welcome overlays. Dismissing the recovery welcome only hides it for the current session and does not delete the recoverable autosave.
- Kept quit blocked until the current project is saved, isolated export materialization and filenames to avoid collisions, and hardened backup restoration and phone-remote pairing lockout.
