# Rifff Recording (Stem-Attach) Design

**Goal:** Let a double-clicked rifff become the destination for gated recording — a locked-in
take becomes a **new stem on that same rifff**, instead of a new standalone rifff on its own
channel. This is what makes gated recording possible in sketch mode at all (which has no
channel/Ruler concept to record onto today), and gives normal mode a second, more integrated
way to layer a take onto something that's already playing.

## Background

This session already shipped Endlesss-style gated ("always listening") loop recording:
threshold-triggered capture into a fixed-length buffer, a selectable loop region, buffer
persistence across laps, stereo capture, and (most recently) double-click-on-a-clip setting
`state.loopRegion` to that clip's own current on-screen span. All of that lives in **normal**
mode (`ArrangerMode: 'normal'`) — a locked-in take today always becomes a brand-new,
independently-named rifff, placed on a freshly-minted recording channel (`gatedRecordingChannelId`
in `AppState`, pinned at enable-time and rotated after each lock-in — see
`docs/superpowers/plans/2026-08-05-*` and this session's own history for that flow's full
design).

**Sketch mode** (`ArrangerMode: 'sketch'`, see `selectors.ts`'s `isSketchEligible` and
`SketchStrip.tsx`) is a different, simpler single-lane sequential view: uniform `PolarGlyph`
tiles, one per placed rifff, packed edge-to-edge with no overlaps. `Timeline` (`App.tsx`)
returns `<SketchStrip />` outright when `state.mode === 'sketch'`, which means the `Ruler`
component — and with it, the *only* existing way to set `state.loopRegion` via manual drag —
never renders in sketch mode at all. Recording is therefore not just clunky in sketch mode
today, it's **structurally impossible**: there is no path to a non-null `loopRegion`, so
`enableGatedRecording`'s own loop-region check always fails.

`isSketchEligible` also explains why a *standalone new rifff* was never going to work as
sketch mode's recording story: it requires every placed rifff to occupy a disjoint,
contiguous span starting at bar 0 — i.e., no two things can play at the same position. But
recording is inherently about layering: you play something that's already there and capture a
*new* loop simultaneously with it. A brand-new rifff placed alongside what's currently
playing is exactly the "two things at once" case sketch mode forbids.

The way through this, worked out during design discussion: a rifff already plays several stems
**simultaneously** by definition (that's what a multi-stem Endlesss rifff *is* — see
`buildRifff.ts`, where `rifff.barLength = Math.max(...stems.map(s => s.barLength))`, and each
stem already tiles independently at its own `barLength` via `schedulePlayback.ts`). So folding
a new take in as **another stem on the rifff being looped**, rather than a new top-level rifff,
sidesteps the "two things at once" problem entirely — from `isSketchEligible`'s point of view,
nothing new was placed; the existing rifff just grew another simultaneous layer, exactly like a
LORE-imported rifff already has several.

## Scope

- Applies in **both** normal and sketch mode, with identical semantics — double-click always
  means the same thing: loop this rifff's own span, and a locked-in take becomes a new stem on
  it. (Confirmed directly rather than assumed: a mode-dependent double-click meaning was
  considered and rejected as inconsistent.)
- Manual Ruler-drag loop-region setting (normal mode only, since sketch mode has no Ruler) is
  **unchanged** — it still produces a standalone new rifff on a fresh recording channel, exactly
  as shipped this session. This design only changes what happens when the loop region was set by
  **double-clicking a rifff**.
- Out of scope for this pass: a live waveform-in-place during capture (see "Live feedback"
  below), and any cap or warning on how many stems a rifff accumulates.

## Interaction model

Double-clicking a placed rifff's clip (`RifffBlockRow.tsx`'s name bar in normal mode; a tile in
`SketchStrip.tsx` — new there, see "Sketch mode" below) does two things at once, both already
partially true today:

1. Sets `state.loopRegion` to that clip's current on-screen span — **unchanged**, this part
   already shipped (`RifffBlockRow.tsx`'s `onDoubleClick`, deriving bars from `geo.leftPx`/
   `geo.widthPx` so it reflects the clip's actual rendered length, not its intrinsic
   `barLength`).
2. **New:** pins `state.gatedRecordingTargetGroupId` (a new field, see "Data model") to that
   rifff's own `groupId`.

`gatedRecordingTargetGroupId` and the existing `gatedRecordingChannelId` are mutually
exclusive — enabling recording via either path clears the other. Whichever is non-null when
`\` locks in a take determines what happens:

- `gatedRecordingChannelId` set → today's flow, unchanged: `importRecordedTake` builds a new
  standalone rifff, placed via `MOVE_TO_CHANNEL` onto the pinned (fresh, empty) channel.
- `gatedRecordingTargetGroupId` set → **new** flow: build a `Stem` (not a `Rifff`) and dispatch
  `ADD_STEM_TO_RIFFF` onto the targeted rifff instead. No channel bookkeeping at all — the
  target rifff already has a `channelOf` entry from wherever it was originally placed, and
  since a new stem doesn't get its own channel (only whole rifffs, via `groupId`, map to
  channels), there's nothing new to create or rotate.

**Re-targeting:** double-clicking a *different* rifff while one is already targeted (or while
`gatedRecordingChannelId` is set) re-targets — clears whichever field was set, pins the new
`groupId` — and goes through the *same* `confirmLockInIfRecording()` gate already built this
session ("Lock in the most recent recording pass first?") before doing so, so re-aiming can
never silently drop an in-progress pass.

**Re-clicking the same target:** double-clicking the rifff that's *already* the current target
just refreshes `loopRegion` to its current geometry (harmless — covers the case where the clip
was resized since targeting began) and leaves `gatedRecordingTargetGroupId` untouched.

**Disabling / stopping:** `disableGatedRecording`, `handleStop`, and the spacebar-pause path all
already route through `confirmLockInIfRecording()` (shipped this session) before clearing
`gatedRecordingEnabled`. They additionally clear `gatedRecordingTargetGroupId` to `null` (mirroring
how they already clear `gatedRecordingChannelId`), so a later `\` press with nothing armed can't
accidentally reuse a stale target.

## The new stem

`lockInGatedRecording`'s new branch (`gatedRecordingTargetGroupId` set) builds a `Stem` via a
new `importRecordedStem(path, rifffBpm, loopBars): Stem | null` function (sibling to
`importOneShot.ts`'s existing `importRecordedTake`, sharing its `copyIntoLibrary` helper) with:

- **Tempo compensation.** A rifff's stems all stretch together by one shared ratio,
  `state.bpm / rifff.bpm` (`stretchRatio` in `selectors.ts`) — but the newly captured audio was
  recorded live at the *current* project tempo (`state.bpm`), not at `rifff.bpm`. Naively giving
  it `barLength = loopBars` would mean it inherits the rifff's stretch ratio on top of already
  being correct, i.e. double-stretched, whenever `rifff.bpm !== state.bpm`. Fix: choose a
  synthetic `barLength` such that `nativeBpmFor(stem)` (`durationSec / barLength`-derived, see
  `buildAlsXml.ts`) resolves to `rifff.bpm`, not the literal capture tempo:

  ```
  durationSec = actual captured duration (loopBars * secPerBar at record time)
  barLength   = durationSec * rifff.bpm / 240
  ```

  With that `barLength`, the rifff's own shared stretch ratio (`state.bpm / rifff.bpm`) maps the
  stem's "native" tempo of `rifff.bpm` back to `state.bpm` — exactly the tempo it was actually
  captured at — regardless of how far `rifff.bpm` has drifted from the live project tempo. No
  restriction on when you're allowed to target a rifff; this always resolves correctly.
- **Slot.** `Math.max(-1, ...rifff.stems.map(s => s.slot)) + 1` — just avoids colliding with an
  existing stem's slot number; no attempt to reproduce real Endlesss instrument-slot semantics.
- **Name.** Same `${randomAdjectiveNoun()} ${new Date().toLocaleTimeString()}` convention
  `importRecordedTake` already uses — just becomes `stem.name`, not `rifff.name` (the rifff
  keeps its own existing name; only the new stem is freshly named).
- **Type/provenance.** `type: 'audioIn'`, `recordedInApp: true` — identical to today's gated
  takes, so the new stem still gets the distinct `--ra-recording-live` color treatment
  (`stemColorVar`) wherever stem identity color is shown.
- **oneShot.** Left unset (tiled), matching this session's earlier "gated takes tile like any
  other rifff" fix — never `true` for this path.

**Accumulation.** Each `\` lock-in while targeting the same rifff adds *another* stem — the same
"never silently overwrite, always additive" precedent this session already established for the
standalone-channel flow (which mints a fresh channel per lock-in rather than reusing/overwriting
one). No cap for v1.

## Data model

- **New `AppState` field:** `gatedRecordingTargetGroupId: string | null`. Not persisted (added
  to `serialize.ts`'s exclusion list, same treatment as `gatedRecordingChannelId`/
  `gatedRecordingEnabled`). Not undo-tracked (added to `history.ts`'s `TRANSIENT_ACTION_TYPES`,
  same category as `gatedRecordingChannelId`'s own `SET_GATED_RECORDING_CHANNEL` action — "how
  I'm currently working" bookkeeping, not a user edit).
- **New action:** `SET_GATED_RECORDING_TARGET { groupId: string | null }`, reducer case sets the
  field directly — mirrors `SET_GATED_RECORDING_CHANNEL` exactly.
- **New action:** `ADD_STEM_TO_RIFFF { groupId: string; stem: Stem }` — appends `stem` to
  `state.rifffs[groupId].stems`, and updates `rifff.barLength = Math.max(rifff.barLength,
  stem.barLength)` (mirrors `buildRifff.ts`'s own convention for how a multi-stem rifff's overall
  `barLength` is derived). A real, undo-able edit (not transient) — locking in a take is exactly
  the kind of thing a user would want to undo.
- **`importOneShot.ts`:** new `importRecordedStem(path: string, rifffBpm: number, loopBars:
  number): Stem | null`, sibling to the existing `importRecordedTake`, sharing `copyIntoLibrary`.
  Returns just the `Stem`, not a wrapping `Rifff` — the caller already has the rifff it's
  attaching to.

## Sketch mode: double-click support (new)

`SketchStrip.tsx` currently has no `onDoubleClick` handler at all (confirmed — `handleTileClick`
is the only interaction on a tile). Add one, applying the identical geometry-derived
loop-region logic `RifffBlockRow.tsx` already uses (tile's own current rendered span, not its
intrinsic `barLength`) plus the `gatedRecordingTargetGroupId` pin described above. No changes
needed to `isSketchEligible` itself or to how tiles are laid out — this only adds a new event
handler to the existing tile element.

## Live feedback

A small purple (`--ra-recording-live`) dot, using the exact same `ra-rec-pulse` keyframe
animation already built for the transport bar's rec indicator and the Ruler's loop bracket
(pulsing only while actually playing, per this session's earlier "not just armed" fix) —
rendered directly on the targeted rifff: on `RifffBlockRow.tsx`'s name bar in normal mode, on
the tile in `SketchStrip.tsx`. Visible whenever `state.gatedRecordingTargetGroupId === groupId`
(regardless of mode), same "reads gated recording state directly" pattern `ChannelRow.tsx`
already uses for its own overlay.

Deliberately **not** building a live waveform-in-place for this pass (Approach B, considered and
set aside during design discussion) — `SketchStrip`'s tiles are circular `PolarGlyph`s with no
existing waveform-strip concept, and building one there specifically for this feature is a
bigger lift than the rest of this design for a payoff that matters most in normal mode (which
already has richer feedback via the channel-based flow). The pulsing dot is enough signal that
recording is live and pointed at a specific rifff; a fuller live preview can be revisited later
if it turns out to matter.

## What does NOT change

- Manual Ruler-drag loop-region setting (normal mode only) — still produces a standalone rifff
  on a fresh channel, exactly as shipped this session.
- `GatedLoopRecorder` itself (native engine) — completely unaware of the distinction between
  "becomes a new rifff" and "becomes a new stem." Both paths call the same
  `engineCaptureGatedTake` IPC and get back the same `{ path, committed, latencyCompensationBars
  }`; the fork happens entirely in `lockInGatedRecording` (renderer), on what to *do* with that
  result.
- The "always create a fresh empty channel" invariant, the confirm-before-losing-a-take gate,
  the "don't jump the playhead" loop-region behavior, stereo capture, the peak-cache
  performance fix — all unchanged, all still apply identically regardless of which lock-in
  branch fires.

## Testing

- `store.test.ts` (or wherever reducer cases are tested): `ADD_STEM_TO_RIFFF` appends the stem
  and updates `barLength` correctly (including the no-op case where the new stem's `barLength`
  is already `<=` the rifff's existing one); `SET_GATED_RECORDING_TARGET` sets/clears the field;
  confirm it's excluded from `serializeProject`'s output and from undo history.
- `importOneShot.test.ts`: `importRecordedStem` — correct `barLength` compensation math for a
  handful of `rifff.bpm`/`state.bpm`/`loopBars` combinations (including the `rifff.bpm ===
  state.bpm` identity case, where compensation should be a no-op), correct slot assignment
  against an existing stem list, correct name/type/provenance fields, `null` return for a
  non-wav path (matching `importRecordedTake`'s own convention).
- Manual walkthrough (this codebase's own convention for React component behavior — see
  CLAUDE.md's "Testing conventions"): double-click a rifff in each mode, confirm the pulsing
  dot appears in the right place, record and lock in, confirm the new stem appears, plays in
  sync, and the rifff's own `barLength`/visual span updates correctly; re-target mid-recording
  and confirm the "lock in first?" prompt fires; verify a rifff whose `bpm` differs from the
  live project tempo still plays the new stem back at the correct pitch/speed.
