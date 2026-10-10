# Changelog

## Unreleased

### Added

- Added an EEEDIT metronome with the same toggle and drag-to-adjust volume behavior as the main transport.
- Added non-destructive per-stem rotate controls in EEEDIT, from 1/32 note through 8 bars, with an independent phase reset, project persistence, and one-step undo.
- Added grouped EEEDIT clip operations: adjacent selections move together, Command-drag bypasses snap, Option-drag copies the group, Command-D duplicates it, and Command-C/Command-V copy and paste at the insertion cursor while cropping cleanly at the riff boundary.
- Added a docked EEEDIT **clip inspector** with non-destructive smooth transpose and detune controls for selected clips or dragged interior regions. Region transforms create their two clip edges as part of the same undoable action, and multi-clip selections support batch edits with mixed-value display.
- Added snapped EEEDIT **rate** controls (¼×, ½×, 1×, 2×, and 4×). Smooth rate changes speed, pitch, and clip length together, previews the resulting extent before committing, overwrites covered material, participates in undo, and remains editable in saved EEEDIT recipes.
- Added a compact EEEDIT **smooth** toggle. New and reset clips start with smooth off (raw): deterministic nearest-neighbour resampling preserves the skipped/repeated-sample staircase and aliasing of early tracker playback, then duration-corrects only independent pitch changes. The choice remains non-destructive and saved in the clip recipe.
- Expanded EEEDIT **transpose** from ±24 to ±512 semitones. Extreme smooth shifts render in safe internal stages rather than overrunning Rubber Band's resampler; extreme raw values also use that safe path once a nearest-neighbour intermediate would become sub-frame or impractically large.
- Added EEEDIT's first **process clip** treatment: wavefold. Drive and dry/wet mix preview live in the riff, before/after comparison is instant, cancel restores the untouched draft, and add renders the result into a durable 32-bit-float clip base as one undoable action.
- Expanded **process clip** with a single-choice catalog of saturation, hard clip, rectify, bit crush, rate crush, ring mod, comb, and smear treatments. Every treatment has multiple sound-shaping knobs plus mix and exact numeric entry, uses the same non-destructive audition and render cache, and auto-bakes when added so another treatment can be applied immediately.
- Simplified processed-clip history: there is no separate clear, replace, bake, or original-reset state. Each added treatment is one undo step, while pitch/rate/raw controls remain editable and the immutable source audio is retained internally.
- Added project-session **interventions** to EEEDIT's inspector. Multiple reusable offline treatment cards can remain visible with their own settings; preview auditions one card at a time, bake renders it as a single undoable clip edit, **+ stem** renders the same preview to a new parallel lane without changing the source clip, and × removes only the reusable intervention without touching rendered audio.
- Expanded EEEDIT interventions with extreme-range compand distortion, codec damage, short room, true frequency shift, warm stereo/mono chorus, dj eq, and resonant tone processors. Their wide controls support subtle correction through deliberately broken, feedback-heavy, or overdriven settings.
- Added an EEEDIT-only donor tray: dragging a shelf riff onto the inspector opens its stems in a compact audition view with non-destructive mute/solo and one-click inward controls for adding individual stems to the current EEEDIT draft. Closing the tray restores the inspector without discarding an intervention in progress.
- Renamed the user-facing entry action to **EEEDIT** and made it follow the riff actually shown in the Sketch inspector, so stale shared-selection bookkeeping can no longer hide the button.
- EEEDIT's clip inspector now hides all transform and intervention controls when no clip or interior region is selected, replacing disabled controls with a quiet selection skeleton and brief interaction hint.
- Intervention preview render failures now leave the last valid riff preview playing instead of stopping transport. The **+ intervention** control also atomically collapses a clean expanded card and opens its picker, so reflow can no longer move the button out from under the click.
- Added independent EEEDIT **formant** shifting from −12 to +12 semitones. It moves the spectral envelope without changing the clip's pitch, rate, or duration, works on clips and selected regions, remains editable after bake, persists through project reopen, and uses cached high-quality R3 renders off the playback thread.
- Added the first **EEEDIT** editing slice for a single selected riff: split at the playhead, snapped or free fragment moves, Option-copy, duplicate, durable fragment/stem disable, temporary mute/solo, reset, undo/redo, original/shaped A/B playback, and non-destructive save as a new shelf riff. EEEDIT keeps the shelf visible and stores a versioned recipe against immutable source audio so results can be reopened and reset without generational quality loss.

### Changed

- The launch cleanup notice and the gear menu's "clean up re-oned stem copies…" also clear leftover EEEDIT render files (an interrupted render's folder, old preview renders) more than a day old. EEEDIT's saved stems are never cleaned: they can't be rebuilt.
- Widened EEEDIT's inspector and increased its compact typography. The header now pairs a left-aligned inspector label with the selected stem identity, its empty state includes concise clip and shelf-donor guidance, and the bottom help tray is easier to read.
- Regrouped EEEDIT's toolbar around transport/history, metronome/snap/editing tools, and riff reset. Removed the source/edited comparison toggle so playback consistently monitors the edited result, and used the lane's spare width to separate its gain knob from mute/solo.
- New compand distortion interventions now start at −16 dB output trim, providing safer headroom for their aggressive default drive without altering saved intervention settings.
- Kept EEEDIT's per-stem mute and solo controls available during live intervention previews while continuing to lock clip and stem edits, and removed the extra stop/restart cycle that caused a hitch when leaving solo.
- Fixed the EEEDIT donor tray's mute and solo buttons falling back to oversized native browser controls; they now match the compact in-app mixer styling.
- EEEDIT now auditions its working riff and donor riff as one mix. Donor stems start muted, share one Solo pool with the working lanes, provide a tray-level mute all/unmute all control, and transfer cleanly into the working riff without doubling their audio.
- Compacted EEEDIT's inspector: transform values now sit between their step buttons, intervention knobs and readouts use the quieter stem-gain styling, intervention A/B is one preview toggle, and clip-editor guidance lives in a collapsible bottom `?` tray.
- Tightened EEEDIT interventions further: inactive cards collapse to a compact clickable name with no separate activation button, the intervention picker uses a compact button, comb's four controls share one horizontal row, and inspector numeric readouts are less visually dominant.
- Clean intervention previews now collapse when clicking elsewhere and switch between cards in one click, while moving any intervention knob keeps that work open. Intervention headings avoid bright-white emphasis. Transform's detune control uses −10/+10 steps around an editable center value, and rate now uses cumulative ½×/2× buttons alongside an undo-style reset, smooth, and the current value.
- Intervention bake is now the brighter primary action, distinct from the quieter + stem action, and the before/after eye lives in the intervention header beside its close button.
- EEEDIT waveforms now compress or expand immediately with clip rate changes, without waiting for audio rendering, and intervention bake refreshes the waveform from the newly rendered clip base.
- Fixed unbaked intervention previews surviving an EEEDIT close or development remount and making a stem appear permanently processed. Closing EEEDIT now discards the live audition, and reopening repairs any stranded preview recipe without adding an undo step.
- Added an undoable per-stem × control to EEEDIT. It removes the lane and its local mixer/discovery state while preserving at least one stem in the riff.
- EEEDIT inspector values now separate numbers from their units and use a brighter border and ink when they differ from neutral. Removed the obsolete dotted rate-hover outline, which could be mistaken for clip selection now that rate updates the waveform directly.
- EEEDIT pitch processing now renders off the playback thread through Rubber Band's high-quality mode, reuses size-bounded cached source/pitch and assembled-lane renders, persists editable transform recipes in v2 provenance, and assembles different processed clips from explicit native source mappings. Inspector edits rebuild only changed lanes, and the clip inspector uses a denser aligned Transform layout.
- Expanded EEEDIT into a clip-oriented editor: clip headers select and drag, clip bodies place an insertion marker, a razor tool cuts at the marker, right-click exposes duplicate/reverse/disable/delete, Cmd-1/Cmd-2 resize the grid, Space starts from the selected clip (or riff start), and Shift-Space resumes from the stopped playhead. EEEDIT now also exposes Discover-style stem adding with one trailing empty lane, add to timeline, and a warning before discarding unpublished edits.

### Fixed

- Made multi-clip move, copy, and duplicate atomic so selected neighbors preserve their order and spacing instead of overwriting one another during sequential edits; each group gesture now creates a single undo checkpoint.
- EEEDIT intervention knobs now remain visually responsive while dragging but launch a single offline preview render when the gesture ends, preventing repeated mid-playback audio swaps and their crunchy zipper artifacts.
- Hardened rapid EEEDIT transform editing: cancelled previews now stop their private native render process, shared pitch/stretch cache WAVs publish atomically only after validation, extreme pitch uses smaller safe stages, and repeated add clicks cannot create duplicate baked assets.
- Fixed EEEDIT intervention bake getting stranded after a development hot reload, and set saturation's default drive to 9×.
- Live EEEDIT render replacement keeps the current playhead position and swaps under a 3 ms dip (fade out, swap, fade in) instead of a click. Only EEEDIT's preview swaps dip: radio turnovers and live edits elsewhere sound exactly as before.
- Hardened EEEDIT after review: unsaved drafts now participate in New/Open/Quit protection and are materialized into the exact saved project snapshot; Save As and project renames no longer detach the draft; stale async stem searches cannot alter a newer session; and gain-only edits no longer rebuild preview audio.
- Corrected reversed-clip slicing, overwrite, coalescing, and repeated-source seam healing; prevented incompatible EEEDIT provenance from creating silent tails after Cross changes loop length.
- Bounded native EEEDIT-preview memory with snapshot-pinned audio buffers, and fixed a smooth Solo handoff race that could leave the interface showing playback while the native transport was stopped.
- Added a strict, atomic native EEEDIT renderer: preview and saved results use the same float-WAV path; every lane must decode, tempo-prepare, render, and validate before any saved batch is published, and Re-1 establishes a fresh EEEDIT baseline instead of reopening stale recipe provenance.
- Routed ordinary transport starts through the native 3 ms declick ramp, removing the discontinuity heard when Space resumes Sketch playback mid-waveform without delaying the playhead.
- Prevented an accidental Delete/Backspace from silently unplacing an entire multi-selection in Sketch: multi-riff removal now confirms first and is recorded as one atomic undo step.
- Added two-way Shelf/Sketch hover correspondence: a flat frame, distinct from the crosshatched working selection, on every copied instance of the same riff.
- Added a compact corner drag handle for vertically reordering Cross center stems.
- Fixed **Discover This Riff** resetting seeded stems to full gain; seeded variations now inherit the source riff's per-stem balance.

## Unreleased — 2026-10-08

### Added

- Added **Cross Riffs**, opened from exactly two selected riffs in Sketch, Arrange, Map, or the shelf. The three-column workspace can audition either source or the new center riff, move stems into the center by dragging or using inward buttons, generate matching stems, edit mute/solo/gain, undo and redo, change the preview tempo (the project's own tempo is left alone), and add the result to the shelf or timeline.
- Added a draggable metronome-volume gesture while preserving click-to-toggle.
- Added clearer pre-commit re-one markers and recovery utilities for repairing older projects whose stems lost their shared phase lineage.
- Re-oned stem copies are now reused instead of duplicated, rebuilt automatically when one is missing, and can be cleaned up: a notice at launch from 200 MB of unused copies, or any time from the gear menu's "clean up re-oned stem copies…". Your rifffs, stems and projects are never touched.
- Added a **preview level** dial to the import view. It sets how loud every preview plays (import riffs, shelf tiles, loop folders, the project browser and the re-one picker), so you can talk over them, and it's remembered between sessions. The arrangement isn't affected.
- Added a **stop** button beside the playing preview in the import view. Clicking the playing riff again still stops it too.
- Added focused tests for Cross assembly and playback, phase propagation, caching, import resolution, selection behavior, mixer state, save/quit handling, export naming, and native transport ordering.

### Changed

- Cross now keeps one trailing empty center slot, grows as needed, discards unsaved drafts without an unnecessary confirmation, remembers the source setting, and places its actions and close control consistently with the rest of the app.
- Cross playback now auditions one whole column at a time. Clicking a stem switches to that column, tiled waveforms match the audible loop, a dim playhead shows position, and the active column has a larger animated playback indicator.
- Arrange view now places its compact Mute, Solo, and Gain controls in a narrow mixer rail beside the inspector instead of embedding them in arrangement lanes.
- Riff selection is available consistently from Sketch, Arrange, Map, and the shelf. Cross appears beside the inspector's Discover action only when exactly two riffs are selected.
- Sketch and Shelf now render one shared riff selection, and that working set survives opening and closing Cross or Discover so a newly created riff can be placed without losing the source context.
- Sketch riff clicks now distinguish selection from transport: the circular glyph plays, stops, or switches riffs, while the exposed square corners only select. Dragging never toggles playback.
- Riff selection styling is centered on the circular glyph and uses a restrained, low-contrast pixel texture while keeping selected and playing states visually distinct.
- Shelf previews take ownership of playback instead of layering over the running arrangement, and their highlighting is easier to see.
- Import browsing preserves the selected jam while moving back and forth, and clicking an already-playing import preview stops it.
- A re-one now bakes from the stem's original audio.
- While Discover, radio or Cross is open, Cmd+Z and Cmd+Shift+Z undo and redo there, not in the project hidden underneath.
- Keep in Discover and radio saves what you hear: with a row soloed, the other rows are kept silent (at gain 0), as a muted row already was.
- The save menu's copy items say which file you end up in: "save as a new version" moves you into the copy; "save a copy to a file…" writes a file and leaves you where you were. Each confirms with one line.
- "save as a new version" saves the original first, so its last save has your latest edits, then makes the numbered copy and moves you into it. If the original can't be saved, no copy is made and you see the save error.
- The source dial's ends are now "instruments" and "recorded" (they were "endlesss" and "other"), in Discover, Cross, the radio strip, the radio guide and the web radio, and its tooltip uses the same words.
- The shelf tile of the riff Sketch is playing now gets the playhead-coloured edge, so it's easy to spot.
- Clearer tooltips: radio's turn, like, keep and add buttons, the source dial (Endlesss instruments to the left, recorded audio-in to the right), and the import view's multi-select (shift-click a run, cmd-click to add). The keys and gestures list has an import section.
- The re-one picker draws each stem as a waveform in its own colour, like everywhere else, instead of a spectrogram with a pitch line. The waveform is finer than the arranger's, so drum hits and note onsets stand out as separate spikes.

### Fixed

- Preserved a riff's common phase origin through re-one, import, Discover, shelf, timeline, duplication, and Cross operations so stems no longer drift out of phase. Source files remain untouched; offsets and tempo adaptation are non-destructive.
- Fixed cached/category progress getting stuck below the true completed count and made cache state propagation more reliable.
- Fixed silent or stale import and shelf previews, preview ownership races, and ordered native-engine Play handling at the audio callback boundary.
- Made Solo non-destructive throughout Arrange, Sketch/Map, Discover, and Cross. Durable **Disable**, temporary **Mute**, and temporary **Solo** are now separate layers; clearing Solo restores the exact prior Mute state, while disabled stems remain disabled.
- Fixed Cross source stems with saved zero gain being inaudible when explicitly soloed, misleading default Solo indicators, aggressive source-row outlines, and center-slot over-allocation.
- Added dismiss buttons to both startup/welcome overlays. Dismissing the recovery welcome only hides it for the current session and does not delete the recoverable autosave; once you have unsaved work of your own, the autosave protects that instead.
- Closing the recovery welcome with its × no longer turns off crash autosave for the rest of the session.
- Closing the recovery welcome without recovering or discarding (its ×, or open, Endlesss or tour) no longer loses the old unsaved work: the next autosave or save keeps it as an older copy, offered again at the next launch.
- Cross opens correctly from a riff that mixes LORE and WAV stems with a live downbeat offset; each stem gets its own baked audio.
- A riser muted with the old row mute can be unmuted again from its row's m.
- Opening Discover from a riff with a live downbeat offset no longer marks the project unsaved.
- The metronome keeps its on/off and volume after the audio engine restarts.
- Stems that finish downloading after a riff was re-oned now join it at the same rotation when the riff is imported again. If that can't be done they're left out, with a notice, instead of coming in out of phase.
- A batch import now names the riffs whose re-one failed, instead of leaving them at their original phase without a word.
- Discover and radio seeded from a re-oned riff now play candidates from the seed's own jam at the seed's rotation, so they stay in phase with it. Lining up a roll's stems is quicker, a stem that can't be lined up is skipped with a notice, and once the seed's own rows are gone new stems come in at their own phase again. Stems from your discovered groups and the Shared Feed are never shifted.
- Adding a loop from Discover or radio keeps what you hear: muted rows, and every row but a soloed one, arrive disabled at their own level. Adding from Cross now does the same.
- A riff re-oned by whole bars no longer loses track of its rotation after taking short (1-bar) stems, so later stems still come in at the same rotation.
- Arrange's mute, solo and gain controls now stay in the mixer rail beside the inspector on any length of arrangement. On one longer than the window they used to sit at the far end of the timeline, and the rail itself didn't respond to clicks.
- "save a copy to a file…" no longer deletes the crash-recovery copy of the project you're still working in. That project stays unsaved, so its recovery copy stays too.
- Kept quit blocked until the current project is saved, isolated export materialization and filenames to avoid collisions, and hardened backup restoration and phone-remote pairing lockout.
