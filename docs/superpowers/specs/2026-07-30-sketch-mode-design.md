# Sketch Mode Design

## Summary

A third arranger view mode — Normal, Compact, **Sketch** — for quickly sequencing rifffs into a straight line: drag a bunch in, reorder them by dragging, and they play one after another. No bar-position math to think about, no per-clip editing (fades, resize, unlinking) — just order.

Sketch mode is not a separate saved arrangement or a new data model. It's a constrained *view and interaction mode* layered on the exact same `rifff.startBar`/`playedBars`/`trackOrder` data every other mode already uses. A sketch-mode arrangement is, structurally, just a normal arrangement where every rifff happens to be linked, unedited, and stacked contiguously with no gaps starting at bar 0. Playback needs no changes at all — a gapless sequential arrangement already *is* "play one after another" under the existing scheduler.

Becomes the **default mode** for a fresh project.

Out of scope for this pass: multiple parallel sequences ("ungrouped channels" — each running independently), per-tile mute inside sketch mode, an unstretched/native-tempo playback option. Also out of scope: making Compact mode itself more visually condensed — that's a separate, much smaller follow-up (shrink its row height / bar scale), not part of this spec, though the mode-field refactor below (`compactMode: boolean` → a three-way `mode` field) makes room for it without another redesign.

## Mode field

`AppState.compactMode: boolean` is replaced with:

```ts
type ArrangerMode = 'normal' | 'compact' | 'sketch'
mode: ArrangerMode
```

`initialState.mode` defaults to `'sketch'`. `TOGGLE_COMPACT_MODE` is replaced with `CYCLE_ARRANGER_MODE`, cycling `normal → compact → sketch → normal`, wired to the same Tab key and TransportBar button as today. Like `compactMode` before it, `mode` is **not persisted** (excluded from `serializeProject`/`PersistedProject`, same convention as `volumeDragMode`/`inspectorCollapsed`) — every session/load starts from the default.

Loading a project (or the initial empty state) always starts in `'sketch'`. If the loaded arrangement isn't sketch-eligible (see below), the app falls back to `'normal'` immediately rather than showing a mode whose own toggle would be disabled — sketch is preferred, not forced.

## Eligibility

Sketch mode can only be entered — the toggle target is disabled (grayed out, with a tooltip explaining why) — when the current arrangement is already "plain." A pure function, `isSketchEligible(state): boolean`, true iff for every placed rifff (`placedRifffsInOrder(state)`):

- not unlinked (`!state.unlinked[groupId]`)
- no fade (`!state.fadeIn[groupId]` and `!state.fadeOut[groupId]`, i.e. 0 or unset)
- no resize override (`state.playedBars[groupId] === undefined` — using the rifff's natural `barLength`)
- zero offset (`(state.off[groupId] ?? 0) === 0`)

...AND the placed rifffs, sorted by `startBar`, are perfectly contiguous starting at bar 0: the first one's `startBar` is 0, and each subsequent one's `startBar` equals the previous one's `startBar + rifff.barLength` — no gaps, no overlaps.

An empty timeline (no placed rifffs) is trivially eligible — starting a fresh sketch is the common case, not an edge case.

Note there's no separate "track" concept in this app's data model beyond `trackOrder`'s render order — every placed rifff gets its own row regardless of whether its bars overlap another rifff's. The contiguity check above treats *every* placed rifff as one flat list that must be gapless and non-overlapping; two rifffs both starting at bar 0 (playing simultaneously, perfectly valid in Normal mode) correctly fails eligibility, since sketch mode has no way to represent "two things at once."

Mute and volume are **not** checked — they don't affect positioning or sequencing accuracy, only mix, so they don't disqualify sketch mode.

This check only gates *entering* sketch mode. Once inside, the interaction surface (below) makes it structurally impossible to leave the eligible state, so there's no "you're in sketch mode but it's not eligible anymore" case to handle.

## Data model / reordering

No new persisted fields. Reordering (dragging an existing tile to a new position, or dropping a new rifff in at some position) dispatches one new action:

```ts
{ type: 'SEQUENCE_RIFFFS'; groupIds: string[] }
```

`groupIds` is the complete new order. The reducer walks the list, assigning each one `startBar = <cumulative sum of every earlier groupId's rifff.barLength>`, starting at 0. This is bar-count math only — tempo-agnostic, since "bars" already account for stretch (see clipGeometry: a stretched clip occupies its full `barLength` width regardless of the rifff's native tempo vs. the project's). One dispatch, one undo entry, regardless of how many rifffs shifted.

Removing a rifff from the sequence is the existing `REMOVE_FROM_TIMELINE`, immediately followed by a `SEQUENCE_RIFFFS` dispatch for whatever remains (closing the gap). Adding a new rifff (dragged from the shelf or the LORE library) at a given position is a `PLACE_ON_TIMELINE`/paste followed by `SEQUENCE_RIFFFS` for the full resulting order with the new one spliced in at the drop index.

## Visual

Each placed rifff renders as its `PolarGlyph` (the same radial-waveform circle already used in the shelf and LORE library browser) at a **uniform size**, regardless of that rifff's actual bar length — duration is communicated entirely through playhead speed (below), not tile size, so the strip stays visually even. Tiles sit left to right in sequence order, packed edge to edge, in a single row replacing the normal Timeline area (same footprint Compact mode occupies today — shelf, transport bar, and Inspector are untouched).

## Playhead

A small dot orbits each tile's rim, one full lap exactly matching that rifff's own play-through — a short rifff's dot laps fast, a long one laps slow. Lap duration is real elapsed seconds at the *project* tempo (`rifff.barLength * (60 / state.bpm) * 4`), matching "stretched to project tempo" playback. The currently-playing tile also gets a very subtle glow (CSS box-shadow halo) — intentionally minimal; cut it if it reads as too much once it's actually running.

## Interactions

- **Click** a tile: select it (updates Inspector), and previews it the same way Shelf tiles already do (per the existing preview-loop registry).
- **Drag** a tile to a new position: reorders the sequence (`SEQUENCE_RIFFFS`). Dropping between two tiles inserts there — needs a visual insertion-line indicator during the drag, the same idea as the Timeline's existing bar-position drop indicator, but positioned between tile midpoints (by insertion index) rather than by bar.
- **Drag in** a new rifff from the shelf or LORE library: inserts at the drop position, same insertion-line indicator.
- **Delete/Backspace or right-click → remove**: removes the tile and closes the gap.
- Deliberately **no** mute, volume, fade, or resize controls inside sketch mode. This isn't just a smaller UI — it's what keeps every arrangement sketch mode itself produces automatically eligible for itself, with nothing to gate.

## Inspector auto-follow (sketch mode only)

While `state.mode === 'sketch'` and the transport is playing, the Inspector automatically shows whichever rifff currently contains the playhead — no manual click needed to follow along. This is scoped to sketch mode specifically: in Normal/Compact mode, multiple rifffs can be playing at once across different tracks, so "the currently playing one" is ambiguous; in sketch mode there's always exactly one.

Implementation: track the groupId auto-follow last selected (a ref, not new AppState). On each position tick during playback, compute which rifff's `[startBar, startBar + barLength)` currently contains `pos`. Only dispatch `SELECT` when that groupId **changes** from the tracked one (a transition into a new rifff) — not on every tick. This means a manual click on a different tile mid-playback sticks in the Inspector until the playhead actually crosses into another rifff, rather than snapping back within the next ~33ms position update.

Auto-follow does nothing while stopped/paused — selection is fully manual then, same as every other mode.

## Testing notes

`isSketchEligible` and the `SEQUENCE_RIFFFS` reducer case are pure functions over `AppState` — cover both with the same reducer-test-fixture conventions already used throughout `store.test.ts`/`selectors.test.ts` (no mocks, real state built via `ADD_TO_SHELF`/`PLACE_ON_TIMELINE`, etc.). The Inspector auto-follow transition logic (only re-selecting on a rifff boundary crossing, not every tick) is the one piece of real behavioral subtlety here and deserves its own focused test(s) once it has a home — likely a small pure helper (`groupIdAtPosition(state, pos): string | null`) extracted from the effect so the "which rifff contains this position" logic is itself directly testable, with the effect's own transition-detection left as a thin wrapper.
