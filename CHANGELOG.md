# Changelog

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

- Cross now keeps one trailing empty center slot, grows as needed, discards unsaved drafts without an unnecessary confirmation, remembers the Endlesss/Other source setting, and places its actions and close control consistently with the rest of the app.
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
- The save menu's copy items say which file you end up in: "save as a new version" moves you into the copy and leaves the original as last saved; "save a copy to a file…" writes a file and leaves you where you were. Each confirms with one line.
- The shelf tile of the riff Sketch is playing now gets the playhead-coloured edge, so it's easy to spot.
- Clearer tooltips: radio's turn, like, keep and add buttons, the source dial (Endlesss instruments to the left, audio-in recordings to the right), and the import view's multi-select (shift-click a run, cmd-click to add). The keys and gestures list has an import section.
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
- Kept quit blocked until the current project is saved, isolated export materialization and filenames to avoid collisions, and hardened backup restoration and phone-remote pairing lockout.
