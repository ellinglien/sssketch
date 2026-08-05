# Clip Region Select-to-Mute Design

**Goal:** Change sssketch's clip-drag interaction so dragging only moves a clip/rifff when
started from its title bar; dragging anywhere else on a clip's body selects a time region,
which the user can then mute (or unmute) with Delete/Backspace — similar to how region
selection works in Ableton Live's Arrangement View.

## Background

Today, the entire waveform body of a stem row (`StemWaveformRow.tsx`) or a collapsed rifff
block (`CollapsedRifffRow.tsx`) is a native HTML5 drag target that moves the whole rifff —
`StemWaveformRow.tsx`'s own comment describes this as deliberately "exposed on a wider surface
than the label column alone." Separately, `RifffBlockRow.tsx` already renders a dedicated
18px-tall name bar (`NAME_BAR`) above the stem rows — `VIOLET CRICKET 0896E3F0 LORE` in a real
screenshot from this session — which is *always* rendered, in both collapsed and expanded view,
and already independently supports drag-to-move. This means every clip already has a title/move
area today; the only change needed is to stop the waveform body from *also* being a move target,
and give that space a new job.

Existing edge affordances (`handleLeftResizeStart`, `handleResizeStart`, `handleFadeInStart`,
`handleFadeOutStart` in `StemWaveformRow.tsx`) are unaffected by this change — they already claim
their own small hit-zones via their own `onMouseDown` handlers, so the new region-select
behavior only ever fires from the open middle area, same as today's move-drag did.

## Interaction model

- **Move**: unchanged. The rifff-level name bar (`RifffBlockRow.tsx`'s `NAME_BAR`) is the only
  drag-to-move target, in both collapsed and expanded view.
- **Region select**: dragging anywhere on the waveform body (`CollapsedRifffRow.tsx` or
  `StemWaveformRow.tsx`, outside the existing resize/fade hit-zones) starts a region selection
  instead of a move. A highlighted span renders live as the drag proceeds, using the same
  coordinate math the existing drag helpers already use (`mouseBarFromDragEvent`, `ppb`).
  - In the **expanded per-stem view**, the selection applies to that one stem only.
  - In the **collapsed rifff view**, the selection applies to every stem in that rifff at once.
- **Mute**: pressing Delete or Backspace while a selection is active mutes that span. Escape or
  clicking elsewhere cancels a pending selection without changing anything.
- **Precedence over the existing whole-clip Delete**: `App.tsx` already binds Delete/Backspace
  globally to remove the *entire* selected clip from the timeline (`REMOVE_FROM_TIMELINE`, around
  line 912). That handler must check `state.regionSelection` first and skip (falling through to
  region-mute/unmute instead) whenever a region selection is active — a user who just finished
  dragging a region expects Delete to act on *that*, not blow away the whole clip. This is a real
  conflict in the existing code, not a hypothetical one; it's resolved by extending that same
  `handleKeyDown` in place, not by adding a second, competing `keydown` listener.
- **Unmute**: clicking an already-muted span re-selects exactly that span. Delete/Backspace on it
  removes the mute — the same select-then-delete interaction, symmetrically applied to an
  existing mute instead of raw audio. No separate "unmute" UI is needed.
- **Muted-span appearance**: a diagonal hatch pattern replaces the waveform for that span (chosen
  over a blank/empty span or a dimmed-but-still-visible waveform during this design's visual
  review) — concretely, a 45° repeating stripe fill (approximately the row's own muted-red border
  color at low opacity against the row's dark background, matching the design-system's existing
  near-black/sharp-corners conventions rather than introducing a new color), distinct enough at a
  glance from both a normal waveform and an empty/undragged span.

## Data model

- **Persisted**: `state.muteRegions: Record<string, { startBar: number; endBar: number }[]>`,
  keyed by `stemKey(groupId, slot)` (matching the existing convention used by e.g.
  `state.dragVol`). `startBar`/`endBar` are absolute arrangement-bar positions — the same
  coordinate space `rifff.startBar` already lives in.
- **New reducer actions** (both real, undo-able edits — not added to `history.ts`'s
  `TRANSIENT_ACTION_TYPES`):
  - `ADD_MUTE_REGION { stemKeys: string[]; startBar: number; endBar: number }` — appends the
    region to each listed stem's list. A whole-rifff mute (collapsed view) dispatches this once
    with every stem's key; a single-stem mute (expanded view) dispatches it with just one.
  - `REMOVE_MUTE_REGION { stemKey: string; startBar: number; endBar: number }` — removes the
    exact matching region. Re-clicking an existing hatched span always re-selects its exact
    bounds, so there's never a fuzzy-match case to handle.
- **New transient UI state** (added to `TRANSIENT_ACTION_TYPES`, same treatment as
  `SET_DRAG_PREVIEW`): `state.regionSelection: { stemKeys: string[]; startBar: number; endBar:
  number; mode: 'mute' | 'unmute' } | null`, driven by `SET_REGION_SELECTION`. Holds the
  in-progress or pending-delete selection; renders the live highlight during drag and the
  pending-selection outline afterward. `mode` distinguishes "about to mute raw audio" from
  "about to unmute an existing region" so a global keydown listener knows which action
  Delete/Backspace should dispatch. Cleared on Escape, click-elsewhere, or after the mute/unmute
  commits.

## Playback / native engine

Muting only in the renderer's data model would be misleading — the region has to actually go
silent during real playback. This is the highest-risk part of the feature, in the same category
as this project's past `HIGH RISK`-tagged engine work (LiveDrag's `ProjectSnapshot` hardening,
LiveParam's `PlaybackEngine` integration).

- **Wire format** (`src/shared/buildEngineProject.ts` / `native-engine/Source/EngineProject.h`+
  `.cpp`): `EngineStem` gains `muteRegions: { startBar: number; endBar: number }[]`, alongside
  the existing `muted: boolean` (whole-stem mute, untouched). `buildEngineProject.ts` populates
  it from `state.muteRegions[stemKey]`.
- **Render loop** (`PlaybackEngine.cpp`): the existing `stem.muted || effectiveVolume <= 0.0`
  check is a whole-stem skip decided once per block, before any buffer read — a region mute is
  partial, so it can't be a skip-the-whole-stem check. For a stem with non-empty `muteRegions`,
  the per-block gain calculation must zero out just the portion of that block whose
  arrangement-time position falls inside a region. Where a region boundary falls mid-block, this
  reuses the existing anti-click fade infrastructure (`FadeGain.cpp`/`LoopBoundaryFade.h`,
  already used for loop-wrap and clip start/end declicking) rather than a hard cut, so a mute
  boundary doesn't pop.
- **Tests**: a `PlaybackEngineTests.cpp` case rendering across a mute-region boundary, asserting
  silence inside it, unchanged audio outside it, and no discontinuity at the boundary — mirroring
  the existing `stem.muted` test (line 159) plus a new boundary-declick assertion, run via the
  engine's own `--test` `UnitTestRunner`.

## Ableton export

`buildStemTrack` (in `src/main/ableton/buildAlsXml.ts`) currently emits exactly one `AudioClip`
per stem's `AudioTrack`. Representing a mute region as a real gap means splitting that into
**multiple clips on the same track** — Ableton natively supports many clips per track in
Arrangement view, so this isn't a structural stretch, but it changes the per-stem clip logic from
"compute one clip's attributes" to "compute the audible sub-spans (the stem's full span minus its
mute regions), then emit one clip per sub-span." Both `Time`/`CurrentStart`/`CurrentEnd` per
segment use the absolute-position convention fixed earlier this session (see this repo's own
`2026-08-04-ableton-export-design.md`).

The part needing real care: for a **tiled** (non-one-shot) stem, the loop repeats a short native
sample across the whole span — a segment resuming after a gap has to pick up the tile's phase
where it would naturally have been (continuing the same math `computeLoopWindow`'s
`wrappedLeftCropBars` already does for a clip's start), not restart the loop at phase 0. Getting
this wrong wouldn't break the file, just make the audio sound subtly wrong after a mute gap —
flagged here as an acknowledged risk area needing dedicated test coverage, in the same spirit as
that doc's existing "loop-cycle wrap approximation" risk. **One-shot** stems are simpler — no
tiling, so a mid-clip mute there is just a trim/split on a single audio blob.

## Testing

- Reducer logic (`ADD_MUTE_REGION`/`REMOVE_MUTE_REGION`/`SET_REGION_SELECTION`) —
  `store.test.ts`, plain TDD.
- `buildAlsXml.ts`'s clip-splitting — `buildAlsXml.test.ts`, including a dedicated test for the
  tile-phase-continuity case above.
- Native engine — `PlaybackEngineTests.cpp` via `--test`: silence inside a region, unchanged
  audio outside it, no click at the boundary.
- The drag/select UI itself — per this codebase's established convention, not directly unit-
  tested; verified by typecheck + lint + manual walkthrough.
- **Manual walkthrough (mandatory)**: select+delete a region in both collapsed and expanded
  view; re-select and delete again to unmute; confirm playback is actually silent in the region
  with no click at either edge; export to Ableton and confirm it **opens cleanly** and the gap is
  really there — non-negotiable given this exporter's own history this session (see
  `2026-08-04-ableton-export-design.md`'s "Known risks" and "Post-ship bugs" sections).

## Known risks / open questions

- **Tile-phase continuity across a gap** (Ableton export) — the trickiest correctness detail in
  this whole design, called out above; needs explicit test coverage, not just visual inspection.
- **Overlapping/adjacent mute regions**: this design doesn't merge overlapping regions on
  `ADD_MUTE_REGION` — a user muting two overlapping spans ends up with two separate stored
  regions rather than one merged one. Harmless for playback/export (the union still plays as
  silent), but means `REMOVE_MUTE_REGION`'s exact-match removal could leave a sliver of an
  adjacent region behind if the user's later re-selection doesn't land on an exact original
  boundary. Not expected to matter in practice given selections are always re-derived from an
  existing hatched span's own exact bounds, but worth a regression test.
- **One-shot region mute**: acknowledged above as structurally simpler than the tiled case, but
  not fully specified attribute-by-attribute here — left for the implementation plan to work out
  against `computeLoopWindow`'s existing one-shot branch.
