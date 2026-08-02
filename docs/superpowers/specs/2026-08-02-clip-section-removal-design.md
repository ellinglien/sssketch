# Non-Destructive Clip Section Removal Design

## Background

Every clip interaction in the arranger today acts on the whole stem: mute the whole thing (right-click), move the whole thing (drag the waveform or the name bar), trim/stretch a one-shot's edges (`oneShotResize.ts`). There's no way to cut an unwanted bit out of the *middle* of a clip without touching anything else — the closest existing tool is deleting the whole placed rifff and re-importing a manually-edited file.

This adds an Ableton-style "select a time range, delete it" gesture, implemented as a **mute**, not a real edit — the source audio file on disk is never touched. A stem can carry any number of these muted ranges; playback (and export) silently skips them, and they can be un-done just as easily as they were made.

## Data model

A new per-stem state field, `mutedRanges: Record<string, { start: number; end: number }[]>` (`AppState` in `store.ts`), keyed by the same `stemKey(groupId, slot)` string `mute` and `vol` already use — so it covers one-shots for free (they still have a single stem with a `stemKey`, no separate data path needed). `start`/`end` are bar positions absolute across the stem's own played timeline (bar 0 = the clip's own start, not the project's) — exactly the coordinate space the waveform itself is drawn in, so what you drag over is what gets removed, regardless of which loop repeat it visually falls in.

Two new undo-tracked actions:

```ts
| { type: 'ADD_MUTED_RANGE'; stemKey: string; start: number; end: number }
| { type: 'REMOVE_MUTED_RANGE'; stemKey: string; start: number; end: number }
```

`ADD_MUTED_RANGE` appends (rejecting an added range that exactly duplicates an existing one); `REMOVE_MUTED_RANGE` filters out the range matching both bounds exactly (the only way one is ever removed is via the marker's own reselect-and-delete gesture below, which always knows the exact bounds it's targeting). Neither action merges/splits overlapping ranges — dragging out a new selection that partially overlaps an existing muted range is allowed and simply produces two ranges that happen to overlap, which behaves identically to one merged range at playback time (silence is silence) and avoids a whole class of range-arithmetic edge cases for no real benefit.

`initialState.mutedRanges = {}`. Wired into the same cleanup/carry-over paths `vol`/`mute` already go through:
- Deleting a rifff: `mutedRanges: omitStems(state.mutedRanges)` alongside the existing `omitStems(state.vol)`/`omitStems(state.mute)`.
- Pasting/duplicating a rifff (`PASTE_RIFFF`): carries the source stem's muted ranges over to the new copy's stem keys, matching how `vol`/`mute`/`off` already do.
- `serialize.ts`: persisted and restored like every other per-stem map, same read/write shape.

A muted range is never actively deleted when it falls outside a stem's current played window (e.g. after shrinking `playedBars`) — it's simply inert (nothing to render, nothing audible) until/unless the window grows back to include it again. This avoids adding trim-time cleanup logic for a case that self-resolves.

## Interaction

### Gesture remap

Dragging directly on a stem's waveform today moves the whole clip (`StemWaveformRow`'s and `CollapsedRifffRow`'s own `draggable`/`onDragStart`, including for one-shots). That's removed. Moving a clip becomes the job of `RifffBlockRow`'s existing name-bar strip alone — it already supports drag-to-move today (`onDragStart` at `RifffBlockRow.tsx:57-65`), so this is a deletion, not new work, on the move side.

Freed up, a plain click-and-drag on the waveform body starts a region-select marquee instead:
- **Regular (looping) stems** — anywhere on `StemWaveformRow`'s waveform.
- **One-shots** — anywhere on `CollapsedRifffRow`'s one-shot waveform *except* the existing narrow edge-trim/stretch handle hit zones (the same 5-7px strips `oneShotResize.ts` already claims) — dragging near an edge is still "trim," dragging in the middle is "select."

Unaffected: click-with-no-drag still scrubs the playhead; right-click still mutes the whole stem; when `state.volumeDragMode` is on, drag still means volume adjustment (region-select is what plain drag does when that mode is off, replacing what "move" used to do there).

### Selecting and committing

The in-progress drag is local, ephemeral component state (`useState`, matching the existing `dragBarsFor`/`dragPlayedBars` pattern) — not written to the undo-tracked reducer while dragging. Releasing the drag leaves the selection visibly highlighted (a semi-transparent overlay over the selected span) rather than committing anything. From there:
- **Delete/Backspace** commits it — dispatches `ADD_MUTED_RANGE`, undo-tracked like any other edit.
- **Escape, or clicking elsewhere** clears the pending selection with no state change.

A selection below a small minimum width (matching the kind of guard `oneShotResize.ts` already applies to its own drags) is discarded on release rather than committed as a near-zero-width range.

### Visual treatment and restoring

A muted range renders no waveform at all inside its own span — a true gap, not a dimmed-out version of the audio that was there. A small marker sits centered in that gap (a thin dashed vertical line, distinct from the solid playhead line and from bar gridlines) that's itself clickable/draggable exactly like the waveform elsewhere: clicking it re-selects that exact `{start, end}` range (shown as the same highlighted marquee), and pressing Delete/Backspace again dispatches `REMOVE_MUTED_RANGE` for those exact bounds, restoring playback there. This reuses the select → Delete flow in both directions rather than inventing a separate "restore" affordance.

## Native engine

`EngineStem` (`src/shared/buildEngineProject.ts`) gains a field:

```ts
mutedRanges: { start: number; end: number }[]
```

serialized the same way `oneShot`/`trimStartSec` already are. `buildEngineProject.ts` resolves each stem's `state.mutedRanges[stemKey]` (defaulting to `[]`) into this field, same pattern as every other per-stem property.

On the native side (`PlaybackEngine.cpp`), both the one-shot sample loop and the tiled/looping stem loop already compute, per-sample, a `sampleTimeSec` and know the rifff's `startBar` and seconds-per-bar (`spb`) — converting that to a bar position absolute across the stem's played timeline is `(sampleTimeSec - rifff.startBar * spb) / spb` for a one-shot's trigger-relative case, or the equivalent tile-position math the loop branch already does for a looping stem. Each sample checks that bar position against `stem.mutedRanges` (a linear scan — these lists are expected to stay small, a handful of ranges at most, so no interval-tree is warranted) and contributes silence (skip the `chOutL/chOutR +=`) when inside one, exactly like the existing `if (stem.muted || stem.volume <= 0.0) continue;` whole-stem check just above it, but scoped to the sample instead of the whole stem.

This is the same `renderBlock` path both live playback and mix/stem export already share, so export respects muted ranges automatically — no separate work needed on the export side, matching how one-shot trim/fade already got this for free (Task 4 of the one-shot import feature).

`EngineProject.cpp`'s wire deserialization gains the matching `getArray`/loop to populate `stem.mutedRanges` from the incoming JSON, alongside where `stem.muted` is already parsed.

## Out of scope for this pass

- Fade in/out at a muted range's own edges (an abrupt cut, matching how the rest of this app's mute/volume changes already apply instantly rather than crossfading) — worth revisiting later if a hard cut sounds too harsh in practice, but adds real complexity (per-range fade state) for an unconfirmed need.
- Any cross-stem/whole-clip version of this (the earlier per-clip alternative considered and rejected in favor of per-stem).
- Sketch mode (`SketchStrip`'s `PolarGlyph` tiles have no linear waveform to drag across).

## Testing

The pure logic — muted-range containment checks, minimum-selection-width guard, and the reducer's add/remove/carry-over/cleanup behavior — gets full unit test coverage, matching this codebase's established convention (`oneShotResize.ts`, `zoomMath.ts`). The native engine's per-sample muting gets coverage in `PlaybackEngineTests.cpp` alongside the existing `stem.muted = true` case already there, rendering a block that spans a muted range and asserting silence in exactly that span and audio on either side of it. The actual drag/marquee/Delete-key UI wiring isn't covered by an automated test (no React interaction-test harness exists in this codebase) — verified manually instead, same precedent as every other drag gesture built this session.

## Manual verification checklist

Not automatable in this environment (no GUI interaction tooling):
1. Dragging on a regular stem's waveform shows a selection marquee instead of moving the clip; the name bar still moves the clip as before.
2. Delete/Backspace on an active selection removes that span's audio (silence on playback) and leaves a true gap with a restore marker in the waveform.
3. Clicking the restore marker and pressing Delete/Backspace again brings that section's audio back.
4. Escape (or clicking elsewhere) after dragging a selection discards it with no change.
5. The same flow works on a one-shot, without disturbing its existing edge trim/stretch handles.
6. Multiple non-overlapping (and one deliberately overlapping) muted ranges on the same stem all play back correctly.
7. A muted range survives save/reload and undo/redo correctly.
8. Exporting a mix/stems with a muted range present produces audio that matches live playback (the gap is silent in the export too).
9. Shrinking a stem's played length past a muted range and then extending it back restores that range's muting without needing to redo it.
