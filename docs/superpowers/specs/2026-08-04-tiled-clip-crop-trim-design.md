# Tiled Clip Left-Handle Crop Trim

**Status:** approved, ready for implementation plan.

**Revision note:** This spec replaces an earlier version (implemented, then reverted after real
testing exposed a flaw). The original approach shifted `offsetSteps` in lockstep with `startBar`
to keep audio content continuous. That part worked — but `offsetSteps` also directly drives the
clip's on-screen position (`clipGeometryFromFields`'s `leftPx = startBar*ppb + offsetSteps*ppb/
snapDiv`), and the fix's own math made `startBar + offsetSteps` — the same quantity driving both
audio phase AND visual position — deliberately invariant. That's correct for audio continuity,
but it means the clip's left edge never visually moves on screen at all: exactly the "shifts
back to the original starting point" bug reported during manual testing. This revision fixes
the actual problem: introduce a genuinely new, independent field for "how much is cropped from
the left," modeled directly on how the right handle already works via `playedBars`, so neither
`startBar` nor `offsetSteps` ever needs to move for a resize again.

## Problem

Dragging a tiled/looped clip's LEFT resize handle needs to behave like a Final Cut-style
crop: the clip's own timeline position doesn't move, the box's left edge shrinks/grows to
reflect how much is cropped, and the content visible in the remaining window keeps playing
whatever it always would have at each position (not restarting from the pattern's own
beginning).

The RIGHT handle already gets this right, structurally: `playedBars` (`SET_PLAYED_BARS`) defines
how far the visible window extends from `startBar`, and `startBar` never moves for a right-edge
drag. The LEFT handle has no equivalent — today, `RESIZE_LEFT` is the only way to represent "less
of the pattern is visible from the left," and it does so by actually moving `startBar`, which
(as the revision note above explains) is fundamentally the wrong lever to pull, because
`startBar` (and, as tried in the reverted version, `offsetSteps`) also determines on-screen
position.

## Fix

Give the left edge the same kind of field the right edge already has, symmetric in every way:

- **New state field**, `leftCrop: Record<string, number>` — bars cropped from the clip's left,
  keyed by `groupId`, mirroring `playedBars`'s own shape and defaulting to `0` (no crop) exactly
  like `playedBars` defaults to `rifff.barLength`.
- **New action**, `SET_LEFT_CROP_BARS { groupId, bars }`, replacing `RESIZE_LEFT` entirely
  (including its own recent, now-reverted `offsetSteps` field) — mirrors `SET_PLAYED_BARS`'s
  existing shape exactly: one field, no `startBar` involved at all.
- **The visible/audible window becomes `[startBar + leftCropBars, startBar + playedBars)`.**
  Neither `startBar` nor `offsetSteps` moves during ANY resize, ever again (left or right). This
  isn't a workaround — it's simpler than the reverted version, which had to atomically co-move
  two fields for a left-drag; this only ever touches one.
- Since `startBar`/`offsetBars` (the loop's phase anchor) never move, audio content at any given
  absolute bar position is unchanged by construction — there's no invariant to maintain via
  compensating math, because nothing shifts in the first place. Cropping is purely a windowing
  operation over a pattern whose own phase never moves.
- Extending LEFT (the "41234" case — revealing more of the loop before the original start) is
  the same mechanism with `leftCropBars` going negative, symmetric with how `playedBars` can
  already exceed `rifff.barLength` to extend the loop rightward.

### Rendering (`clipGeometryFromFields`, `src/renderer/src/state/selectors.ts`)

`ClipGeometryFields` gains `leftCropBars: number`. Formula becomes:

- `leftPx = (startBar + leftCropBars) * ppb + offsetPx` (`offsetPx`, the existing small
  sub-bar nudge term from `offsetSteps`, is untouched — genuinely unrelated now)
- `shownBars = stretchOn ? (playedBars - leftCropBars) : (playedBars - leftCropBars) * (rifffBpm / stateBpm)`
- `widthPx = shownBars * ppb`

### Drag handlers (`StemWaveformRow.tsx`, `CollapsedRifffRow.tsx`)

Both files' own independent copies of `handleLeftResizeStart` (see the earlier implementation
attempt's own discovery that these are two separate, previously-identical functions) simplify:
track a single `finalLeftCropBars`, updated directly from the drag delta
(`startLeftCropBars + Math.round(deltaX / ppb)`, clamped — see Clamping below), dispatch
`SET_LEFT_CROP_BARS` on release. The existing `dragLeftResize` live-preview state and the
`nudgeOffsetPx`/`displayedStartBar` reconciliation trick (which existed specifically to fake a
startBar-based preview while the real state hadn't committed yet) are no longer needed in their
current form: since rendering never depends on a moving `startBar` during a left-drag anymore,
the live preview can compute `leftPx`/`widthPx` directly from a previewed `leftCropBars` using
the exact same formula real (committed) rendering uses. One formula, no separate
preview-reconciliation path.

**Clamping:** `leftCropBars` must keep `startBar + leftCropBars >= 0` (can't extend before the
project's own bar 0) and `playedBars - leftCropBars >= MIN_PLAYED_BARS` (can't collapse the
window to nothing). Both bounds are computed from the values captured at drag-start (matching
the reverted version's own convention of clamping against drag-start snapshots, not a
continuously-recomputed target).

### Native engine wire format

New `EngineStem.leftCropBars` (double, default `0.0`) in `EngineProject.h`/`.cpp` (native) and
`buildEngineProject.ts` (TS) — same treatment as `playedBars`, which already lives on
`EngineStem` even though it's set uniformly per-group in practice (matching `RESIZE_LEFT`'s own
existing group-level-only scope, not touching per-stem overrides).

### Native playback (`PlaybackEngine.cpp`)

The tile loop currently only clips the LAST tile against `playedBars` (`segmentBarLength =
min(barLength, bound - barOffset)`, `bound` = `playedBars`). This needs symmetric treatment for
a new lower bound:

- `tileStart = max(barOffset, leftCropBars)`, `tileEnd = min(barOffset + barLength, playedBars)`
  — one shared clamp handles both the first tile (clipped from the left, if `leftCropBars` falls
  mid-tile) and the last tile (clipped from the right, as today), uniformly.
- `tileIdx` must be allowed to go negative (`floor(leftCropBars / barLength)` when
  `leftCropBars < 0`, for the extend-left case) — today's loop hardcodes a floor of `0`.
- The existing "one tile of slack" fast-forward optimization (skipping tiles that can't possibly
  overlap the current audio block, so the real-time callback doesn't do unbounded per-block work
  on a long arrangement) needs its own floor adjusted from a hardcoded `0` to the new first tile
  index — this needs care in the implementation plan to keep it correct under the new bounds,
  not just fast.
- `RenderExport.cpp` calls this exact same `engine.renderBlock(...)` for offline export, so this
  one fix covers both live playback and export automatically — no separate export-path change
  needed.

### Explicitly out of scope

`src/shared/schedulePlayback.ts` / `native-engine/Source/SchedulePlayback.cpp`
(`computeStemSchedule`, both languages) — traced every call site in the codebase and confirmed
neither version is called by any production code anymore (both are exercised only by their own
test suites; `PlaybackEngine.cpp` has its own independent tile loop, described in its own
comments as a "hand-optimized reimplementation," that superseded them for the real-time path,
and `RenderExport.cpp` never called them either). Leaving these as-is rather than updating them
to match — they're already a stale reference algorithm independent of this feature, not
something this feature is newly making stale.

### Persistence

Automatic — `serializeProject` (`src/renderer/src/state/serialize.ts`) persists `AppState` via
an exclude-list (only naming the transient UI fields to drop), so a new `leftCrop` field needs
no changes there; it's included in every save/load automatically once it exists on `AppState`.

## Testing

- `SET_LEFT_CROP_BARS`'s reducer case gets unit test coverage in `store.test.ts`, mirroring
  `SET_PLAYED_BARS`'s own existing tests (sets the value, clamps at the documented bounds).
- `clipGeometryFromFields`'s new `leftCropBars` handling gets unit test coverage wherever its
  existing tests live — confirming `leftPx`/`widthPx` shift correctly for both a crop
  (`leftCropBars > 0`) and an extend (`leftCropBars < 0`).
- Native: `PlaybackEngineTests.cpp` gets new cases mirroring its existing `playedBars`-truncation
  tests, but for the new lower bound — including a case exercising negative `tileIdx` (extend
  case) and a case checking the "one tile of slack" optimization still renders correctly right
  at the edge of a nonzero `leftCropBars` (the trickiest part of this whole change to get
  right, per the note above).
- Manual walkthrough (drag-handler UI changes aren't automated per this codebase's convention —
  see CLAUDE.md's testing-conventions section): crop and extend, in both the expanded and
  collapsed clip views, confirming the box's left edge visually moves this time (the whole point
  of the fix) AND the audible content is continuous, not restarting.
