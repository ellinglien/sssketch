# Changelog

## Unreleased — 2026-10-08

### Added

- Added a docked Shape **Clip Inspector** with non-destructive Smooth Transpose and Detune controls for selected clips or dragged interior regions. Region transforms create their two clip edges as part of the same undoable action, and multi-clip selections support batch edits with mixed-value display.
- Added snapped Shape **Rate** controls (¼×, ½×, 1×, 2×, and 4×). Smooth Rate changes speed, pitch, and clip length together, previews the resulting extent before committing, overwrites covered material, participates in undo, and remains editable in saved Shape recipes.
- Added a compact Shape **Smooth** toggle. New and reset clips start with Smooth off (Raw): deterministic nearest-neighbour resampling preserves the skipped/repeated-sample staircase and aliasing of early tracker playback, then duration-corrects only independent pitch changes. The choice remains non-destructive and saved in the clip recipe.
- Expanded Shape **Transpose** from ±24 to ±512 semitones. Extreme Smooth shifts render in safe internal stages rather than overrunning Rubber Band's resampler; extreme Raw values also use that safe path once a nearest-neighbour intermediate would become sub-frame or impractically large.
- Added Shape's first **Process Clip** treatment: Wavefold. Drive and dry/wet Mix preview live in the riff, Before/After comparison is instant, Cancel restores the untouched draft, and Add renders the result into a durable 32-bit-float clip base as one undoable action.
- Expanded **Process Clip** with a single-choice catalog of Saturation, Hard Clip, Rectify, Bit Crush, Rate Crush, Ring Mod, Comb, and Smear treatments. Every treatment has multiple sound-shaping knobs plus Mix and exact numeric entry, uses the same non-destructive audition and render cache, and auto-bakes when added so another treatment can be applied immediately.
- Simplified processed-clip history: there is no separate Clear, Replace, Bake, or Original-reset state. Each added treatment is one Undo step, while Pitch/Rate/Raw controls remain editable and the immutable source audio is retained internally.
- Added project-session **interventions** to Shape's inspector. Multiple reusable offline treatment cards can remain visible with their own settings; Preview auditions one card at a time, Bake renders it as a single undoable clip edit, **+ Stem** renders the same preview to a new parallel lane without changing the source clip, and × removes only the reusable intervention without touching rendered audio.
- Added independent Shape **Formant** shifting from −12 to +12 semitones. It moves the spectral envelope without changing the clip's pitch, rate, or duration, works on clips and selected regions, remains editable after Bake, persists through project reopen, and uses cached high-quality R3 renders off the playback thread.
- Added the first **Shape Riff** editing slice for a single selected riff: split at the playhead, snapped or free fragment moves, Option-copy, duplicate, durable fragment/stem Disable, temporary Mute/Solo, reset, undo/redo, original/shaped A/B playback, and non-destructive save as a new shelf riff. Shape keeps the shelf visible and stores a versioned recipe against immutable source audio so results can be reopened and reset without generational quality loss.
- Added **Cross Riffs**, opened from exactly two selected riffs in Sketch, Arrange, Map, or the shelf. The three-column workspace can audition either source or the new center riff, move stems into the center by dragging or using inward buttons, generate matching stems, edit mute/solo/gain, undo and redo, change tempo, and add the result to the shelf or timeline.
- Added a draggable metronome-volume gesture while preserving click-to-toggle.
- Added clearer pre-commit re-one markers and recovery utilities for repairing older projects whose stems lost their shared phase lineage.
- Added focused tests for Cross assembly and playback, phase propagation, caching, import resolution, selection behavior, mixer state, save/quit handling, export naming, and native transport ordering.

### Changed

- Compacted Shape's inspector: transform values now sit between their step buttons, intervention knobs and readouts use the quieter stem-gain styling, intervention A/B is one preview toggle, and clip-editor guidance lives in a collapsible bottom `?` tray.
- Tightened Shape interventions further: inactive cards collapse to a compact clickable name with no separate activation button, the intervention picker uses a compact button, Comb's four controls share one horizontal row, and inspector numeric readouts are less visually dominant.
- Clean intervention previews now collapse when clicking elsewhere and switch between cards in one click, while moving any intervention knob keeps that work open. Intervention headings avoid bright-white emphasis. Transform's Detune control uses −10/+10 steps around an editable center value, and Rate now uses cumulative ½×/2× buttons alongside an undo-style reset, Smooth, and the current value.
- Intervention Bake is now the subtly tinted primary action, distinct from the quieter + Stem action, and the before/after eye lives in the intervention header beside its close button.
- Shape waveforms now compress or expand immediately with clip Rate changes, without waiting for audio rendering, and intervention Bake refreshes the waveform from the newly rendered clip base.
- Fixed unbaked intervention previews surviving a Shape close or development remount and making a stem appear permanently processed. Closing Shape now discards the live audition, and reopening repairs any stranded preview recipe without adding an undo step.
- Added an undoable per-stem × control to Shape. It removes the lane and its local mixer/discovery state while preserving at least one stem in the riff.
- Shape inspector values now separate numbers from their units and use a restrained tinted border/background when they differ from neutral. Removed the obsolete dotted Rate-hover outline, which could be mistaken for clip selection now that Rate updates the waveform directly.
- Shape pitch processing now renders off the playback thread through Rubber Band's high-quality mode, reuses size-bounded cached source/pitch and assembled-lane renders, persists editable transform recipes in v2 provenance, and assembles different processed clips from explicit native source mappings. Inspector edits rebuild only changed lanes, and the Clip Inspector uses a denser aligned Transform layout.
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

- Hardened rapid Shape Transform editing: cancelled previews now stop their private native render process, shared pitch/stretch cache WAVs publish atomically only after validation, extreme pitch uses smaller safe stages, and repeated Add clicks cannot create duplicate baked assets.
- Fixed Shape intervention Bake getting stranded after a development hot reload, and set Saturation's default Drive to 9×.
- Live Shape render replacement now keeps the current playhead position and applies a microscopic native fade to the newly loaded audio instead of introducing a project-swap discontinuity.
- Hardened Shape after review: unsaved drafts now participate in New/Open/Quit protection and are materialized into the exact saved project snapshot; Save As and project renames no longer detach the draft; stale async stem searches cannot alter a newer session; and gain-only edits no longer rebuild preview audio.
- Corrected reversed-clip slicing, overwrite, coalescing, and repeated-source seam healing; prevented incompatible Shape provenance from creating silent tails after Cross changes loop length.
- Bounded native Shape-preview memory with snapshot-pinned audio buffers, and fixed a smooth Solo handoff race that could leave the interface showing playback while the native transport was stopped.
- Added a strict, atomic native Shape renderer: preview and saved results use the same float-WAV path; every lane must decode, tempo-prepare, render, and validate before any saved batch is published, and Re-1 establishes a fresh Shape baseline instead of reopening stale recipe provenance.
- Preserved a riff's common phase origin through re-one, import, Discover, shelf, timeline, duplication, and Cross operations so stems no longer drift out of phase. Source files remain untouched; offsets and tempo adaptation are non-destructive.
- Fixed cached/category progress getting stuck below the true completed count and made cache state propagation more reliable.
- Fixed silent or stale import and shelf previews, preview ownership races, and ordered native-engine Play handling at the audio callback boundary.
- Routed ordinary transport starts through the native 3 ms declick ramp, removing the discontinuity heard when Space resumes Sketch playback mid-waveform without delaying the playhead.
- Made Solo non-destructive throughout Arrange, Sketch/Map, Discover, and Cross. Durable **Disable**, temporary **Mute**, and temporary **Solo** are now separate layers; clearing Solo restores the exact prior Mute state, while disabled stems remain disabled.
- Prevented an accidental Delete/Backspace from silently unplacing an entire multi-selection in Sketch: multi-riff removal now confirms first and is recorded as one atomic Undo step.
- Fixed Cross source stems with saved zero gain being inaudible when explicitly soloed, misleading default Solo indicators, aggressive source-row outlines, and center-slot over-allocation.
- Added dismiss buttons to both startup/welcome overlays. Dismissing the recovery welcome only hides it for the current session and does not delete the recoverable autosave.
- Kept quit blocked until the current project is saved, isolated export materialization and filenames to avoid collisions, and hardened backup restoration and phone-remote pairing lockout.
