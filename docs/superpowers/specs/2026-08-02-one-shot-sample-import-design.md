# One-Shot Sample Import — Design

**Goal:** Drag a single audio file straight from Finder onto the arranger and have it land as a placed clip that plays exactly once at its own native speed and pitch — no tile-looping, no automatic tempo-stretch — with resize handles that trim or (with Ctrl held) time-stretch the sample, unsnapped from the bar grid, on both edges.

**Architecture:** A one-shot is a lightweight variant of the existing Rifff/Stem model (a single-stem Rifff with `oneShot: true`), not a parallel data model — every existing mechanism (mute, solo, volume, undo/redo, serialization, export) keeps working unmodified because it's still fundamentally a Rifff. Three places get new, additive logic: the native engine's per-stem render loop (bypass tiling/resampling for a one-shot stem), the resize-handle UI (new unsnapped trim/stretch interaction, distinct from the existing bar-snapped `SET_PLAYED_BARS`/`RESIZE_LEFT` mechanism normal clips use), and the Finder-drop handler (a new direct-to-timeline import path, alongside the existing Shelf-drop path).

---

## Data model

Two new fields on `Stem` (`src/shared/types.ts`):

```ts
export interface Stem {
  // ...existing fields unchanged...
  oneShot?: boolean
  trimStartSec?: number // undefined = 0 (play from the very start)
  trimEndSec?: number   // undefined = the stem's own full durationSec
}
```

A one-shot Rifff always has exactly one stem. `Rifff.bpm`/`barLength` stay populated (existing serialization/Inspector code expects them, and the clip still needs *some* bar-based footprint for its on-screen position/width) but are cosmetic for a one-shot — the engine ignores them for tiling/resampling purposes whenever `stem.oneShot` is set.

Ctrl+drag-stretch does not add a new field. It re-renders the stem's underlying audio via rubberband and *replaces* `stem.path`/`stem.durationSec` with the result — exactly like the existing downbeat-rotation bake mechanism already does for normal stems. Afterward the stem looks like any other stem, just backed by different audio; `trimStartSec`/`trimEndSec` are re-validated against the new `durationSec` (clamped if now out of range).

## Drop flow

`Timeline`'s `resolveDrop` (`src/renderer/src/App.tsx`) gains a third branch, checked after the two existing internal-drag branches (`text/rifff-shelf-source-id`, `text/rifff-group-id`): if `e.dataTransfer.files.length > 0`, treat the drop as one-or-more one-shot imports rather than an internal rifff drag.

For each dropped file: resolve its real filesystem path via the existing `window.rifffApi.getPathForFile` bridge (already used by `Shelf.tsx`'s own Finder-drop handling), then call a new main-process handler, `importOneShot(path)`, modeled directly on `importRifff.ts`'s existing WAV-header-reading and library-copy logic but building a single-stem `oneShot: true` Rifff instead of a multi-stem one. **v1 supports WAV only** — the main process currently has no duration reader for any other format (`readWavDurationSeconds` is WAV-specific; there's no existing AIFF/MP3 parser to reuse), and adding one is out of scope here.

The renderer dispatches `ADD_TO_SHELF` immediately followed by `MOVE_TO_CHANNEL` at the drop's bar position and target channel — landing already-placed in one motion, not requiring a separate drag from the Shelf.

**Multiple files dropped at once:** each becomes its own independent one-shot Rifff. If dropped on an existing `ChannelRow`, all of them land on that channel (DAW mode already supports several clips sharing a channel). If dropped on empty/ghost space, each gets its own new channel — the same rule already applied to a single internal-drag drop, just applied per file.

## Native playback

`PlaybackEngine::renderBlock` (`native-engine/Source/PlaybackEngine.cpp`) gains one new branch inside its existing per-stem loop: if `stem.oneShot`, skip the tile-repeat loop (`totalTiles`/`tileIdx` math) entirely. Instead:

- Compute a single segment: starts at the rifff's own bar-derived trigger time (`(start + offsetBars) * spb`, matching how a normal stem's first tile is positioned — still bar/tempo-locked for *when* it fires, even though its own playback rate is untouched), ends at `trigger + min(trimEndSec ?? durationSec, durationSec) - (trimStartSec ?? 0)`.
- Reads source samples 1:1 against wall-clock time (no `secPerBarNative`/output-rate ratio scaling) — the stem plays at its own native rate regardless of project bpm. If project tempo changes later, the trigger *time* shifts (bar 4 arrives at a different wall-clock moment), but the sample's own internal speed/pitch never does.
- Starts reading from `trimStartSec ?? 0` into the source buffer.
- Still runs through the existing anti-click fade helper (`buildFadePoints`/`FadeConfig`) at the very start and end of the segment, so a hard trim boundary doesn't pop.

The Web Audio preview path (`previewLoop.ts`, used for Shelf-tile and SketchStrip previews) gets the equivalent non-looping treatment: a one-shot stem previews once and stops, rather than tiling.

## Resize handles

Both edges get a handle on a one-shot clip. All dragging here is continuous/unsnapped — pixel position maps directly to seconds, the same style already used for this codebase's existing fade-in/fade-out handle drags, deliberately *not* the bar-snapped `SET_PLAYED_BARS`/`RESIZE_LEFT` pattern normal looped clips use (a one-shot's natural length is typically a fraction of a bar, so bar-snapping would be useless here).

- **Right edge, plain drag:** shrinks `trimEndSec`. Left edge/start-bar stays fixed. Clamped so it can't extend past the sample's real length (there's nothing to add without stretching).
- **Left edge, plain drag:** grows `trimStartSec`, and the clip's `startBar` moves forward by the equivalent bar amount, so the *right* edge (the end-of-playback point) stays fixed in time while the left edge trims inward. Conceptually mirrors the existing `RESIZE_LEFT` anchor logic for normal clips, but unsnapped and against `trimStartSec` instead of `playedBars`.
- **Ctrl+drag, either edge:** stretches via rubberband instead of trimming. Checked once at mousedown (not re-evaluated mid-drag) — if Ctrl was held when the drag started, the whole gesture is a stretch; otherwise the whole gesture is a trim. Live dragging only updates the clip's on-screen width (a visual preview of the target duration); the actual pitch-preserving rubberband render happens once, on release — this app's rubberband integration is an offline CLI subprocess (writes/reads WAV files via `execFile`), not something that can run per animation frame, so continuous live-audio stretch preview isn't feasible without a much larger native DSP change. Right-edge ctrl-stretch keeps the start fixed (end moves); left-edge ctrl-stretch keeps the end fixed (start-bar recomputed from the new duration).

New reducer actions: `SET_ONE_SHOT_TRIM` (groupId, trimStartSec, trimEndSec, startBar — startBar included since a left-edge trim moves it) and a stretch-completion action (dispatched once the main-process rubberband render resolves) that updates the stem's path/duration and re-clamps trim bounds.

New main-process IPC: `stretchOneShot(path, ratio)`, modeled directly on the existing `renderStretched`/bake-stem flow (same rubberband binary, same cache-by-path-and-ratio behavior).

**Known risk, called out honestly:** task #166 (still open) is a phase-anchor bug in the *existing* `RESIZE_LEFT` mechanism for normal clips — left-edge anchoring is a genuinely fiddly class of bug to get right. This one-shot implementation doesn't share code with `RESIZE_LEFT` (it's a fresh, simpler, unsnapped calculation), but it's the same category of math, so the implementation plan needs solid anchor-correctness tests (verify the non-dragged edge's absolute time position is bit-for-bit unchanged after a drag) rather than just "it looks right."

## Inspector

A one-shot rifff hides the bpm/stretch-toggle controls the Inspector currently shows for normal rifffs — they don't apply and showing them (even disabled) would be confusing rather than informative.

## Error handling

- A dropped file that isn't a `.wav` (or fails header parsing): silently ignored, matching `importRifff`'s existing "can't build a rifff → return null" convention. No new notification UI (this codebase doesn't have one yet for import failures generally).
- Ctrl-stretch render failure (rubberband binary missing, disk full, etc.): the clip's trim/stretch state doesn't change — same "fails safely, no partial state" precedent as the existing bake-stem error path.

## Testing

- **Reducer:** `SET_ONE_SHOT_TRIM` (both edges, including the startBar shift on a left-edge trim), clamping (can't trim past 0 or past the sample's own length), the stretch-completion action re-clamping trim bounds against a new duration.
- **Native engine (`PlaybackEngineTests.cpp`):** a one-shot stem renders once (not tiled) even when its rifff's `bound`/`barLength` would otherwise imply multiple tiles; a one-shot stem's playback rate is unaffected by project bpm (no resampling); `trimStartSec`/`trimEndSec` are respected (samples outside the trimmed window are silent); mute/volume/fades still apply normally to a one-shot stem, since it's still a normal `Stem` in every other respect.
- **Anchor-correctness (the flagged risk above):** after a left-edge trim or left-edge ctrl-stretch, the right edge's absolute wall-clock end time is unchanged; the mirror-image assertion for the right-edge operations.
- **Import (`importOneShot`):** reuses `importRifff.ts`'s existing WAV-header test fixtures where possible; a non-WAV file is rejected; the resulting Rifff has exactly one stem with `oneShot: true`.
- **Drop flow:** dropping a real file directly on an existing `ChannelRow` places it on that channel at the correct bar; dropping on empty space gives it a new channel; multiple files dropped together each become independent one-shots.

## Explicit scope decisions (not ambiguity — deliberate v1 boundaries)

- WAV only for one-shot import (no AIFF/MP3/Ogg parsing added this pass).
- No per-clip toggle back into loop/stretch-to-tempo behavior — a one-shot is always a one-shot.
- Ctrl-stretch is commit-on-release, not a continuous live-audio preview.
