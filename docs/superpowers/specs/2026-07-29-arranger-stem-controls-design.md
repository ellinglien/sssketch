# Arranger Stem Controls — Design

## Goal

Bring per-stem mute, volume, fade-in/out, and clip-length editing directly into the arranger
timeline, replacing indirect editing via the side Inspector panel. Today, mute and volume
exist in state and the native engine but are only settable from Inspector; fades are the same,
plus visualized (read-only) on the clip; resizing a clip's played length doesn't exist at all.
This phase makes all of it live, visible, and editable directly on each stem's own row in the
timeline, matching familiar DAW conventions (Reaper's item-volume-line, Ableton's clip fades).

## Scope boundary

This phase covers three of four originally-discussed features: **mute, volume+fade envelope,
and per-stem clip resize**. The fourth — selecting and silencing a sub-range in the middle of
a stem ("delete" as a silent gap, ripple/shorten explicitly deferred) — is architecturally
distinct enough (a new "cut ranges" concept, not a visual/interaction extension of the same
row) to be its own follow-up phase, not part of this one. **Solo was discussed and explicitly
dropped** for this phase — mute alone is judged sufficient for now.

## What retires

`RifffBlockRow`'s single top-level combined waveform (currently `Waveform` of `stems[0]`, plus
two black-gradient fade-triangle overlays) is removed. `StemSubRow` (currently only rendered
when a rifff row is expanded) is replaced by a new always-visible per-stem row — there is no
more expand/collapse toggle for stems; every stem in a placed rifff always shows its own row.

Inspector's mute button, volume slider, and fade-in/fade-out stepper buttons are removed —
those are now set directly on the arranger row. Inspector keeps offset nudge/zero, stretch
toggle, unlink/relink, and re-pick-beat, none of which have an arranger-row equivalent in this
phase.

## The stem row

Each stem gets one row, in this visual language (validated interactively via mockup iteration
before writing this doc — not a first-draft guess):

- **Waveform**, drawn twice stacked: a fully-desaturated (gray) copy underneath, and a full-color
  copy on top, clipped to a region defined by the stem's volume+fade envelope (below the
  envelope line = full color shows through; above it = only the gray copy is visible).
- **The envelope**: a single continuous curve per row — curves up from silence at the clip's
  start (fade-in), holds flat at the stem's volume level, curves back down to silence at the
  end (fade-out). Drawn as an SVG cubic-bezier path (not a straight diagonal — genuinely
  curved, matching the existing fade-triangle look's aesthetic but generalized across the
  whole clip instead of two isolated corners). The line itself is nearly invisible
  (`stroke-opacity: 0.1`) — the color-saturation split against the waveform is what actually
  reads, not the line.
- **Fade handles**: a small white circle at each of the envelope's two knee points (where the
  curve meets the flat plateau) — click-drag left/right to shorten/lengthen that fade.
- **Volume**: drag the flat plateau section of the envelope up/down to change the stem's
  volume — up increases volume (plateau rises toward the top of the row, more of the waveform
  reads full-color), down decreases it. The drag maps linearly to `state.vol`'s existing
  0–1(ish) range (unchanged storage format — see Data model below); a value tooltip appears
  only while the drag is active, following the pointer, and disappears on release. Whether
  that tooltip displays a raw 0–1 figure, a percentage, or a dB conversion is a presentation
  choice for the plan to settle (dB shown in the mockups was illustrative, not a data-model
  decision) — not persistent chrome either way.
- **Mute**: a single round dot button, positioned at a fixed spot on the row (bigger than the
  fade dots, vertically centered against the row's full height rather than pinned to a
  corner). **Filled = unmuted (active); hollow/outline = muted (off).** Clicking toggles it.
  When muted, the row's waveform is drawn fully desaturated end-to-end (the gray copy only,
  envelope clipping suppressed entirely) — mute always wins over whatever the volume/fade
  envelope would otherwise show.
- **Resize handles**: a thin white bar at the left and right edge of the row, `ew-resize`
  cursor, drag to extend or contract this stem's own played length (see below — this is
  per-stem, not per-whole-clip).

No solo, no separate always-on volume slider, no separate mute button elsewhere on the row —
everything lives in this one compact visual.

## Data model changes

**No new fields for mute, volume, or fades.** These already exist (`state.mute`,
`state.vol`, `state.fadeIn`, `state.fadeOut`) and already resolve per-stem-or-per-group via
`resolveOffsetKey` (mute/vol) or per-group only (fadeIn/fadeOut, unchanged by this phase —
extending fades to diverge per-stem when unlinked is a natural future follow-up, explicitly
out of scope here to avoid introducing an unconfirmed behavior). This phase only changes
*where* these are set (the arranger row instead of Inspector), not their shape.

**One new field, for resize:**

```ts
// AppState
playedBars: Record<string, number>
```

Same key-resolution pattern as `off`/`vol`/`mute` (via `resolveOffsetKey(state, groupId,
slot)`): one shared value per group while linked, independent per-stem values once unlinked.
**Unset means "use `rifff.barLength`"** — today's implicit behavior (every stem currently
tiles up to the shared rifff span) becomes the explicit default, so a project with no resize
edits behaves identically to today.

New reducer action: `SET_PLAYED_BARS` (groupId, slot, bars) — mirrors the existing
`SET_STEM_START` action's shape and clamping conventions (non-negative; no upper bound
enforced in the reducer, matching how `fadeIn`/`fadeOut` are also only loosely clamped there
with the real constraint enforced downstream).

## Engine/scheduling changes

**This is the one part of this phase that touches native C++.** Everything else (mute,
volume, fades) is pure state + UI — no engine changes, since those fields already flow to the
native engine unchanged.

`EngineStem` gains a field:

```ts
// src/shared/buildEngineProject.ts
export interface EngineStem {
  // ...existing fields...
  playedBars: number // this stem's own tiling bound — was implicitly rifff.barLength
}
```

`buildEngineProject.ts` resolves each stem's `playedBars` via the same key-resolution pattern
as `off`/`vol`/`mute`, defaulting to `rifff.barLength` when unset, and includes it on the
`EngineStem` it builds.

**Scheduling** (`src/shared/schedulePlayback.ts` and its hand-ported C++ twin
`native-engine/Source/SchedulePlayback.cpp`, kept in sync manually per the existing comment
at the top of the C++ file — **both must be updated together, same discipline already
established in this codebase**): the tiling loop's upper bound changes from always
`rifff.barLength` to `stem.playedBars` (which defaults to `rifff.barLength`, so a stem with no
override schedules identically to today):

```
// before: for (barOffset = 0; barOffset < rifff.barLength; barOffset += stem.barLength)
// after:  for (barOffset = 0; barOffset < stem.playedBars; barOffset += stem.barLength)
```

Everything else about the loop (tile-and-truncate: `segmentBarLength = min(stem.barLength,
stem.playedBars - barOffset)`) stays the same shape, just reading the new bound instead of the
old one. This is exactly the "extending beyond original length restarts it at the beginning"
behavior you asked for — it's the existing tiling behavior, just now reachable at a length the
user chooses instead of a fixed import-time value. Shortening a stem below `stem.barLength`
naturally truncates the single tile early, via the same `min(...)` clamp already in place.

**Testing for this part specifically needs the same rigor as the engine work in the JUCE
integration phases**: a `computeStemSchedule` unit test proving a `playedBars` override
changes the tiling bound as expected (both the TS reference implementation and, separately,
confirming the native C++ port was updated to match — not just trusting the comment that says
they're kept in sync), and a native-engine parity test (extending
`render-parity.test.ts`, following its established pattern) proving a stem resized beyond its
own `barLength` actually re-loops from its own beginning in the real rendered audio, not just
in the TS-side scheduling data structure.

## Interaction implementation notes (for the plan, not fully resolved here)

Three distinct drag gestures live on one row (fade-knee drag, volume-plateau drag, resize-handle
drag) plus a click toggle (mute). Worth designing a small shared "pointer-drag-to-value" pattern
(mousedown → track delta → convert pixels to a domain value, either bars for resize/fade or a
dB-like value for volume → dispatch) rather than three independently-reinvented gesture
handlers, but the exact shape of that shared utility is an implementation decision for the plan,
not this design doc. Likely question to resolve in the plan: does a volume/fade drag dispatch
continuously (one action per pointer-move) or buffer locally and dispatch once on release
(cheaper, avoids flooding undo history with every intermediate frame of a drag — worth checking
how history/undo already batches drag-derived actions elsewhere in this codebase, e.g. offset
nudging, before deciding).

## Testing strategy

- **Reducer/state**: `SET_PLAYED_BARS` action, `resolveOffsetKey`-based resolution for the new
  field, matching the existing test patterns for `vol`/`mute`/`off`.
- **`buildEngineProject.ts`**: extend `buildEngineProject.test.ts` for `playedBars` resolution
  (defaults to `rifff.barLength` when unset; per-stem override when unlinked).
- **Scheduling**: extend `schedulePlayback.ts`'s existing unit tests for the new bound: a stem
  resized beyond its own `barLength` produces multiple tiles restarting at
  `bufferOffsetSec: 0`; a stem resized below its own `barLength` produces one truncated tile.
  Port the equivalent case into the native C++ `SchedulePlayback.cpp` test suite.
  A new `render-parity.test.ts` case proving this holds in real rendered audio, not just the
  scheduling data structure — matching the established "measure the real thing, don't just
  trust the math" precedent from the JUCE phases' own parity tests.
- **UI/interaction**: consistent with how this project has always verified genuinely
  interactive drag/mouse behavior (no renderer component test framework in use here) — manual
  verification via the running dev app, covering: mute toggle (visual state + audible effect),
  volume drag (visual + audible + value tooltip appears/disappears correctly), fade-knee drag
  (visual curve updates + audible fade timing), resize-handle drag (visual row width change +
  audible loop-restart behavior when extended past the stem's own length, audible truncation
  when shortened), and confirming Inspector's removed controls are genuinely gone with no
  dangling dead code referencing them.

## Out of scope (explicitly deferred, not overlooked)

- Solo (dropped for this phase per direct discussion).
- Select-and-delete a mid-clip section (separate follow-up phase, already scoped in an earlier
  conversation as "silent gap in place," not ripple-and-shorten).
- Per-stem fade divergence when unlinked (fades stay per-group only in this phase).
- Whole-clip (not per-stem) resize as a distinct, separate control — this phase only does
  per-stem resize, which subsumes the "resize the whole rifff" case implicitly when a group is
  linked (all its stems' rows would need to be dragged individually, or — a possible plan-level
  UX addition — a linked group's rows could be resized together as one drag when linked, worth
  raising during planning, not resolved here).
