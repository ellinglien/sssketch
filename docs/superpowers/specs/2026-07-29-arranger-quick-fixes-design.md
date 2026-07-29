# Arranger Quick Fixes & Polish — Design

**Goal:** Five small, independent corrections to the arranger, gathered from live testing after the Arranger Stem Controls plan shipped. This is the "Group A" slice of a larger post-testing feedback batch (the remaining groups — shelf improvements, playhead scrubbing, zoom/scroll, keyboard mute shortcuts — are separate, larger specs to be brainstormed individually).

All five items are UI-only, touch existing components already built this session, and require no new architecture. They're independent of each other and can ship as a single small plan.

---

## 1. Double-click a stem's waveform to reset its volume

Double-clicking anywhere on a stem's waveform (`StemWaveformRow`'s waveform container) resets that stem's volume back to its original import-time value — the same equal-power gain already computed once when the rifff was first added to the shelf (`sqrtGain(rifff.stems.length)`, in `store.ts`'s `ADD_TO_SHELF` reducer case). This is a straight recomputation of that deterministic formula, not a stored "original value" field — dispatches the existing `SET_VOLUME` action.

Does not affect mute state — only volume.

## 2. Reduce fade-drag sensitivity

The fade-in/fade-out drag handles currently map 1 bar of fade to 24px of drag (`deltaX / PPB`), inherited directly from the same conversion used for bar-snapped drags elsewhere. In practice this makes it very easy to overshoot to the 4-bar ceiling with a quick flick, producing a fade that sounds much stronger than intended — a regression in *feel* versus the original Inspector-panel nudge buttons (±0.25 bar per click), even though the underlying audio ramp math (linear gain, in `native-engine/Source/FadeGain.cpp`) is completely unchanged.

Fix: change the fade handlers' conversion factor from `deltaX / PPB` to `deltaX / (PPB * 4)` (96px per bar instead of 24px per bar) in both `handleFadeInStart` and `handleFadeOutStart` in `StemWaveformRow.tsx`. The drag gesture itself is unchanged — just less sensitive, so reaching a large fade requires a deliberately long drag instead of a flick. `FADE_MAX` (4 bars) stays as-is.

## 3. Rename "offset" to "nudge", with a finer, snap-independent step size

**Label:** Inspector's "offset" eyebrow (both the group-level section and its two adjacent controls) becomes "nudge".

**Precision:** Today, each nudge-button click moves `off[key]` by exactly 1 raw unit, where the *meaning* of that unit (`offsetBars = off[key] / snapDiv`) is tied to whatever the global timeline snap division (`state.snapIdx`, 4/8/16/32) currently is — so nudge granularity accidentally rides on a setting meant for clip placement, not fine drift correction. `off[key]` itself has no integer constraint (nothing in the reducer or downstream math requires it), and the wire format sent to the native engine already does plain floating-point division, so this needs no reducer or native-engine change.

Fix: at the nudge buttons' click handlers (in `Inspector.tsx`, both the group-level and per-stem-when-unlinked variants), compute the dispatched `delta` as whatever raw `off[]` value corresponds to a fixed **1ms** of real time at the rifff's current bpm and snap division, using the same conversion already used to display the ms readout (`offsetLabels`'s `msPerStep = (60/bpm)*4*1000/snapDiv` in `src/shared/visuals.ts`): `delta = 1 / msPerStep`. This is independent of whatever snap division happens to be selected elsewhere, and needs no new state field — `NUDGE_OFFSET`'s existing `±8`-raw-unit clamp is unchanged, and now represents a much larger real-world range in exchange for finer per-click steps (previously 8 clicks maxed it out; now roughly 8× as many clicks reach the same ceiling, deliberately, since 1ms taps are meant to be fine adjustments, not a fast way to move a long way).

**Display:** Since the step size is no longer expressed in the global snap grid's own units, the `±N/32`-style grid-fraction readout stops being a meaningful primary number. Swap emphasis in the nudge row so the millisecond value (`labels.ms`) is the prominent, bold readout, with the grid-fraction demoted to a small secondary label (or dropped entirely if it reads as redundant next to the ms value — implementer's call during Task-level polish, low-stakes either way).

## 4. Preserve grab-point offset when repositioning a placed clip

Dragging an already-placed rifff (via `RifffBlockRow`'s header) or an unlinked stem (via `StemWaveformRow`'s left label column, once reachable per the pointer-events fix already shipped) currently computes the drop position directly from the mouse's raw bar position (`barForClientX` in `App.tsx`), ignoring where within the clip the user actually grabbed it. The result: grabbing a clip anywhere other than its exact left edge causes it to visibly "jump" so its start snaps under the mouse on drop, rather than moving naturally as if picked up at that point.

Fix:
- At `onDragStart` (both `RifffBlockRow`'s header and `StemWaveformRow`'s label column), compute the grab offset in bars — the difference between the bar under the mouse at drag-start and the clip's own current start bar — and stash it in `dataTransfer` alongside the existing `'text/rifff-group-id'` / `'text/rifff-stem-key'` payload, as a new `'text/rifff-grab-offset-bars'` field (string-encoded number).
- At `handleDrop` and `handleDragOver` in `App.tsx`'s `Timeline`, read that offset back out (defaulting to `0` if absent — e.g. for a fresh shelf-to-timeline drag, where there's no established grab point on an unplaced clip) and subtract it from `barForClientX`'s result before dispatching `PLACE_ON_TIMELINE` / `SET_STEM_START`, and before positioning the `dropBar` preview line during `handleDragOver`.

This only changes *repositioning* of already-placed content. Placing a brand-new rifff from the shelf is unaffected — there's no prior on-timeline position to preserve an offset from, so the existing raw-mouse-position behavior stays correct there.

## 5. Trim explanatory UI text

Straightforward text/element removal, no behavior change:

- **`Shelf.tsx`:** remove the `"shelf"` eyebrow label and the `"drag one down into the arrangement · stems land linked and pre-aligned"` hint line. Replace the drop zone's two-line explanatory text (`"drop rifff folders, or stems straight from endlesss"` / `"copied into your rifff library"`) with a single centered `"+"`. Drag-and-drop behavior (`onDragOver`/`onDrop`) is unchanged — only the zone's visible label shrinks; it keeps the same clickable/droppable footprint.
- **`TransportBar.tsx`:** remove the trailing `"chevron opens stems · block selects"` hint (already stale — the chevron/expand toggle it describes was removed in the arranger-stem-controls plan). Remove the `"tempo"` eyebrow label above the BPM stepper (the stepper itself, with its ± buttons and numeric field, is self-explanatory without a label).
- **`Inspector.tsx`:** remove the `"tempo"` eyebrow label from the per-rifff tempo section (the `rifff.bpm → state.bpm` display and stretch toggle stay; just the label above them goes).

No state, action, or layout changes — purely deleting/replacing static JSX text and one now-empty-of-purpose label.

---

## Testing

All five are exercised through the existing manual dev-app verification pattern already established this session (start the dev app, interact with the arranger directly) plus targeted unit tests where there's real logic to cover:

- Item 1: manual only (a UI gesture dispatching an existing, already-tested action).
- Item 2: manual only (a constant change to existing drag math, no new logic).
- Item 3: a small `visuals.test.ts` or `Inspector`-adjacent unit test isn't warranted for a one-line `delta` computation reusing an existing, already-tested formula — manual verification (nudge a rifff, confirm the ms readout moves by ~1ms per click) is sufficient.
- Item 4: worth a unit test if the grab-offset math is extracted into a small pure function (e.g. `grabOffsetBars(mouseBar, clipStartBar): number` and its inverse) — implementer's call, but preferred over leaving it inline and untested given it's real, easy-to-get-backwards arithmetic (sign errors are the obvious failure mode).
- Item 5: manual only (text removal).
