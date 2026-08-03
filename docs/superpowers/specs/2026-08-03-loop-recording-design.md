# Loop Recording — Design

**Goal:** A dedicated recording channel that captures live audio input (any
input device the user picks — loopback driver or microphone) into the
timeline, using a simple loop-pedal model: a user-defined loop region on the
ruler plays and re-records on every pass while armed, and disarming keeps
whichever pass most recently finished, placed as a normal clip on that
channel.

**Not a retrospective looper.** Endlesss' own "keep the last N bars from a
continuously-recorded buffer" model (the feature that originally inspired this)
was considered and explicitly simplified away during design — see "Rejected:
retrospective picker" below. What's built here is closer to a classic hardware
loop pedal: one fixed-length buffer, overwritten every pass, commit-on-stop.

## Not in scope for this pass

- More than one armed channel at a time.
- Overdubbing/layering multiple input sources onto one recording channel
  simultaneously.
- Any UI for choosing which pass to keep — see "Rejected: retrospective
  picker."
- Per-recording-channel device memory (which device was last used on THIS
  particular channel) — there's one global "current input device" selection
  for v1, described below, not a per-channel setting.

## Rejected: retrospective picker

The original ask (see this session's own brainstorming transcript) was a
4-zone "+8/+4/+2/+1 bars" picker matching Endlesss' own retrospective-record
screen, scaled to whatever loop length was set. This was dropped mid-design in
favor of the simpler loop-pedal model, for a concrete reason beyond just
"simpler to build": a true retrospective picker needs a capture buffer sized to
the *largest* offered option (so any of several bar-counts can be grabbed after
the fact), plus UI to present and disambiguate those options. The loop-pedal
model needs a buffer sized to exactly one loop length and no picker UI at all
— every one of the open questions below (buffer sizing, what "commit" means,
what a partial take does) has a single unambiguous answer instead of one per
offered zone size. If a real retrospective workflow turns out to be wanted
later, it's a layer that could be added on top of this same capture buffer
(a longer buffer, still overwritten on a ring rather than per-pass), not a
rebuild.

---

## Architecture

### Loop region (new timeline concept)

Independent of the project's overall length (`loopLengthBars`, which remains
"how long the whole arrangement plays before wrapping" and is untouched by
this feature). New state:

```ts
// store.ts, AppState
/** The loop-recording region, in bars — null until the user first drags one
 * out on the Ruler. Independent of loopLengthBars (the whole project's own
 * wrap point); this can be shorter, longer, or positioned anywhere. */
loopRegion: { startBar: number; endBar: number } | null
```

New reducer action `SET_LOOP_REGION` (`{ startBar, endBar } | null`, the
latter to clear it) — a plain field replacement, not part of
`TRANSIENT_ACTION_TYPES` (an intentional loop region is worth an undo step,
same reasoning as any other deliberate edit).

**Setting it:** click-and-drag directly on the Ruler (a new interaction
alongside its existing click-to-scrub and drag-to-scrub) sweeps out a new
region; grabbing either edge of an already-set region afterward adjusts that
edge, mirroring the DAW-standard loop-brace interaction (Ableton, Logic,
Cubase all work this way). Rendered as a bracket overlaid on the Ruler:
tinted fill + accent-colored top/side borders, using `--ra-type-audio-in`
(`#c56164` — already this app's color for the "audio in" sound type, and
happens to equal `--ra-playhead`/`--ra-mute-on`, so it reads as "recording/
input" without introducing a new token).

### Input device selection

A dropdown, not a future cut — loopback and microphone are mechanically
identical from the engine's point of view (JUCE's `AudioDeviceManager` opens
whichever input device it's told to, with no distinction between "a real mic"
and "a virtual loopback driver" — both just show up as named input devices to
CoreAudio), so supporting a picker at all means both are already supported,
with no separate code path for either.

**Where it lives:** one global dropdown near the "+ rec channel" button, not
a per-channel setting (see "Not in scope") — listing whatever input devices
CoreAudio currently reports, selected once per session rather than
remembered per recording channel. Renderer state:

```ts
// store.ts, AppState
/** Populated once from a `list-input-devices` IPC round-trip when the
 * dropdown first opens (see below) -- not fetched proactively on every
 * app launch, since enumerating audio devices is only relevant once the
 * user actually wants to record. Not persisted -- devices can change
 * between sessions (a USB interface plugged in/out), so this should
 * always reflect the current real hardware, not a stale save. */
availableInputDevices: string[]
/** Which of availableInputDevices to record from -- null means "not
 * chosen yet" (arming is disabled until something is selected, see
 * ChannelRow's own arm button). Not persisted, same reasoning as
 * availableInputDevices itself. */
selectedInputDevice: string | null
```

New IPC: `list-input-devices` (no params; replies with the current device
type's own input device name list, via JUCE's
`AudioDeviceManager::getCurrentDeviceTypeObject()->getDeviceNames(true)` —
`true` selects input names specifically, same API the "no usable input
device" fallback case below also depends on). Fetched lazily — the first
time the dropdown is opened, not on every app launch — since enumerating
devices is only relevant once the user is actually about to record.
`arm-recording` (see below) gains a `deviceName` field alongside `channelId`,
resolved from `selectedInputDevice` at arm time.

### Recording channels

A channel gains a kind, alongside the existing purely-derived
`channelOrder`/`channelOf` bookkeeping:

```ts
// store.ts, AppState
/** Channels created via "+ rec channel" -- everywhere else, a channel with
 * no entry here is a normal one (the vastly common case, so this only
 * grows for channels that are actually recording channels rather than
 * needing a per-channel 'normal' entry for everything). */
recordingChannelIds: Record<string, true>
/** Which recording channel, if any, is currently armed and capturing. At
 * most one at a time (see "Not in scope"). Not persisted (see serialize.ts)
 * -- armed state shouldn't survive a save/reload, matching volumeDragMode's
 * own "how I'm currently working" convention. */
armedChannelId: string | null
```

`ADD_RECORDING_CHANNEL` creates a brand new empty channel ID, appends it to
`channelOrder`, and adds it to `recordingChannelIds` — deliberately NOT tied
to any clip (unlike every other channel, which only exists as long as
`channelOf` points at least one clip at it — see `channelHasAnyClip` in
`store.ts`). A recording channel with nothing recorded onto it yet still
needs to exist and render as an empty row with its own arm button, so its
lifecycle is intentionally independent of clip membership.

This means the three existing reducer cases that already call
`channelHasAnyClip` to decide "did this channel just become empty, evict it
from `channelOrder`" (`REMOVE_FROM_TIMELINE`, `MOVE_TO_CHANNEL`'s
previous-channel cleanup, `DELETE_RIFFFS`) all need one additional
condition: don't evict if `recordingChannelIds[channelId]` is set. Without
it, deleting the clip that happens to be a recording channel's current take
(a completely ordinary "remove this clip" action, nothing recording-specific
about it) would silently delete the whole recording channel out from under
the user, since it would then have zero clips. Deleting the channel itself
is a separate, new "remove recording channel" action, which removes it from
`channelOrder` and `recordingChannelIds` together and disarms it first if it
was armed — the only path that should ever make a recording channel's row
disappear.

**Arming:** `ChannelRow`'s existing sticky m/s/fx button stack (App.tsx's
`Timeline`/`ChannelRow.tsx`) gains a fourth "r" button, rendered only when
`recordingChannelIds[channelId]` is set, and disabled (matching this app's
existing "30% opacity + not-allowed" disabled convention, tokens.css) while
`selectedInputDevice` is null — nothing to arm with yet. Toggling it
dispatches `ARM_RECORDING_CHANNEL`/`DISARM_RECORDING_CHANNEL` and calls a new
`engineArmRecording(channelId, deviceName)`/`engineDisarmRecording()` IPC
pair (see below). Arming also starts playback if it isn't already running,
seeked to `loopRegion.startBar` — jamming shouldn't require separately
hitting play first.

### Capture mechanic

**Correction from an earlier draft of this doc:** the original version of
this section assumed loop wrap-around was renderer-driven, based on a
comment in `StoreContext.tsx`'s `onEnginePositionUpdate` describing the
native transport as having "no concept of loop length." That comment is
stale — confirmed by actually reading `Transport.h`/`Transport.cpp`: the
engine already does sample-accurate, in-thread loop wrapping today
(`Transport::setLoopLengthBars`, consumed by `renderLoopAware`, which
splits a render across the wrap point and applies its own declick fade at
the seam, all on the audio thread, driven by `EngineProject.loopLengthBars`
at load-project time — see `IpcServer.cpp`'s `"load-project"` handler). The
renderer's own wrap-detection code is leftover from before this existed and
no longer meaningfully fires; not this feature's problem to clean up, but
important to know it's not the real mechanism. This is a better foundation
than the original draft assumed, and simplifies the design below
considerably — in particular, **manual scrubbing does not need to be
disabled while armed**, which the earlier draft required as a workaround
for an ambiguity that turns out not to exist.

The recording loop region is a second, independent instance of exactly this
same native mechanism, not a reuse of `loopLengthBars` itself (which stays
"the whole project's own wrap point," untouched). `Transport` gains:

```cpp
// Transport.h
void setRecordingLoop(double startBar, double endBar); // endBar <= startBar disables it
```

`arm-recording` (IPC, see below) calls this with `loopRegion`'s bounds
(converted from bars to seconds internally the same way
`setLoopLengthBars`/`renderLoopAware` already work in bars against
`secPerBar`); `disarm-recording` calls it with `(0, 0)` to disable. Whether
or not this recording loop is active is completely independent of whether
the project's own `loopLengthBars` wrap is active — both can be set at
once (a short recording loop inside a much longer overall arrangement is
the normal case), and `renderLoopAware` needs to account for both wrap
points falling within the same block, not just one.

While a recording loop is active, `Transport`'s audio-thread callback
already recomputes `pos + blockDurationBars` every block and detects
whether that crosses `loopBars` (see `renderLoopAware`'s own
`distToEnd`/`blockDurationBars` math) — the exact same per-block check,
parameterized on the recording loop's own bounds instead, is what tells a
new `LoopRecorder` instance "a pass just completed" natively, sample-
accurately, with **no IPC round-trip involved at all** and no ambiguity
with a manual seek (a manual `set-position` while armed just moves the
read/write position like it always does; it was never actually a
meaningful uncertainty once loop-wrap detection lives entirely in the audio
thread's own per-block math rather than in a renderer-observed tick).
`LoopRecorder` owns a buffer sized to exactly one pass
(`(endBar - startBar) * secPerBar * sampleRate`, where `secPerBar =
(60 / bpm) * 4` — the same 4/4 bars-to-seconds conversion
`buildEngineProject.ts` already uses for stretch-ratio math, and the same
value `Transport::setBpm` already derives and stores); every new pass
overwrites it from the start — there is exactly one buffer, never a
growing history.

Disarming (`DISARM_RECORDING_CHANNEL`/`engineDisarmRecording()`) commits
whichever pass most recently **completed**. A pass in progress at the
moment of disarming is discarded — nothing partial ever gets committed, and
if the recording loop hasn't completed even one full pass yet, disarming
produces no clip at all. `LoopRecorder` tracks "has at least one full pass
completed since the buffer was last reset" as a plain bool, flipped by the
same per-block wrap-crossing check above and read at disarm time.

**Retake behavior:** each successful commit **replaces** whatever clip
previously existed on that recording channel — matching directly the
"the last recorded take is the recorded audio" framing from design
discussion. Implemented as: if the recording channel already has a placed
rifff (query `channelOf`/`rifffs` for any groupId currently on this
channel), dispatch `REMOVE_FROM_TIMELINE` for it before placing the new one.
Only one take exists on a recording channel at a time; nothing extra to
clean up.

### Live capture feedback

While armed, the channel shows a waveform building up left-to-right across
the loop region as the current pass progresses — bars already captured
solid, not-yet-captured bars dim, no glow/animation effects (explicitly
requested — "it appearing will be enough"). This needs the engine to push
approximate level data as it captures, since the renderer has no other way
to see live input:

```
// New engine → renderer push, same shape/cadence as the existing
// position-update (30Hz, IPC "type" field, see IpcServer.cpp):
{ "type": "capture-level-update", "channelId": "...", "peaksSoFar": [0.4, 0.7, 0.2, ...] }
```

`peaksSoFar` grows (or refills from index 0 on a new pass) each tick — same
per-bucket peak representation `@shared/visuals`' `peaksFromChannel` already
produces for waveform rendering elsewhere, so the renderer-side drawing code
can reuse the existing `polarGlyph`/waveform-bar rendering helpers rather
than inventing a new visual primitive.

### Committing a take

On disarm, the engine writes the committed pass to a temp WAV file (mirroring
how `--render-test`/export already write WAV output) and replies with its
path. The renderer then reuses the **existing** stem-import pipeline rather
than any new transfer format:

- New `importRecordedTake(path, bpm, barLength): Rifff | null` in
  `src/main/importOneShot.ts` (a sibling to `importOneShot`, sharing its
  file-copy-into-library-folder and WAV-duration-reading internals) —
  differs from `importOneShot` in exactly one respect: the resulting stem is
  **not** `oneShot: true`. A loop recording should tile/stretch/loop like any
  other rifff, at the project's own bpm and the loop region's own bar
  length, not play once and stop.
- Renderer flow on receiving the committed path: `window.rifffApi
  .importRecordedTake(path, state.bpm, loopRegion.endBar - loopRegion.startBar)`
  → `dispatch({ type: 'ADD_TO_SHELF', rifff })` → remove any previous take on
  that channel (above) → `dispatch({ type: 'MOVE_TO_CHANNEL', groupId,
  startBar: loopRegion.startBar, channelId })`. Every step here is an
  existing action/import function; nothing new needed beyond
  `importRecordedTake` itself.

### Native engine changes

Confirmed by reading `Transport.cpp`:
`audioDeviceIOCallbackWithContext`'s `inputChannelData`/`numInputChannels`
parameters are currently unused entirely (`/*inputChannelData*/`,
`/*numInputChannels*/` — deliberately unnamed) — there is no input-capture
code anywhere in the engine today. This needs:

1. `AudioDeviceManager` initialised with at least 1 input channel requested
   (`openDefaultDevice`'s `initialiseWithDefaultDevices(0, 2)` call
   requests 0 input/2 output today — becomes `initialiseWithDefaultDevices(1, 2)`
   or a subsequent `setAudioDeviceSetup` call once a specific device is
   picked at arm time, keeping the existing output side unchanged) — falls
   back gracefully (no crash, arm simply fails with an error surfaced the
   same way a failed plugin load already does) if the named device has
   vanished since `list-input-devices` was last fetched (unplugged between
   listing and arming) or offers no input channels.
2. A new `LoopRecorder` class (new file, `native-engine/Source/`) owning
   the one-pass capture buffer, the WAV-writing-on-commit step (via JUCE's
   `AudioFormatWriter`, same API `RenderExport.cpp` already uses for its
   own WAV output), and the "has a full pass completed" bool. `Transport`
   gains a `LoopRecorder*` (nullptr when nothing's armed) and the new
   `setRecordingLoop(startBar, endBar)` method described above.
   `audioDeviceIOCallbackWithContext` feeds `inputChannelData` to the
   recorder only while it's non-null, and `renderLoopAware`'s own
   wrap-detection math (already computing whether the current block
   crosses a loop boundary, today only for `loopLengthBars`) runs the same
   check a second time against the recording loop's bounds when a
   `LoopRecorder` is attached, calling into it exactly at the crossing
   point to finalize/reset the pass. The unarmed case (`LoopRecorder*` is
   nullptr) costs one extra pointer check per block, nothing more.
3. New IPC message types (`IpcServer.cpp`, alongside the existing
   kebab-case set): `list-input-devices` (no params; replies with the
   current input device name list), `arm-recording` (`channelId`,
   `deviceName`), `disarm-recording` (replies with the committed WAV path,
   or a "no complete pass" status if nothing was ready to commit).

---

## Error handling

- `list-input-devices` returns an empty list (no input hardware at all):
  the dropdown shows a plain "no input devices found" state instead of an
  empty/broken-looking menu, and the "r" arm button stays disabled — same
  disabled treatment as "no device selected yet," just a different tooltip.
- Selected device vanished between listing and arming (unplugged), or
  otherwise offers zero input channels: arming fails immediately, surfaced
  as an inline error (matching the existing master/channel-plugin-chain
  status-dot + tooltip convention) rather than a silent no-op.
- Disarming with no completed pass yet: no clip is created, no error either
  — this is a normal, unremarkable outcome ("I armed and immediately changed
  my mind"), not a failure state.
- Deleting a recording channel while armed: disarm first (discarding any
  in-progress pass, same as a manual disarm with nothing to commit), then
  proceed with normal channel removal.

## Testing

- **Native:** `LoopRecorder` unit tests (JUCE `UnitTestRunner`, this
  project's existing native test convention) covering buffer-overwrite-per-
  pass behavior and the "was a full pass completed" flag transitions, driven
  by synthetic sample blocks rather than a real audio device — matches how
  `PlaybackEngine`'s own render logic is already tested without real
  hardware.
- **Renderer:** reducer tests for `SET_LOOP_REGION`,
  `ADD_RECORDING_CHANNEL`/its removal, `ARM_RECORDING_CHANNEL`/
  `DISARM_RECORDING_CHANNEL` (including that arming is a no-op with
  `selectedInputDevice` still null), and the "replace previous take"
  cleanup logic. `importRecordedTake` tested the same way
  `importOneShot.test.ts` already tests its sibling (real temp WAV fixture
  on disk, not a mock).
- **Manual, end-to-end (required, not automatable in this environment — no
  audio-device access from a coding agent):** set a loop region by dragging
  on the Ruler; open the input device dropdown and confirm it lists real
  devices, including both a loopback driver (BlackHole or similar) and the
  built-in microphone; add a recording channel, select the loopback device,
  and arm it; confirm playback loops the region and the live waveform
  builds up each pass; disarm and confirm the committed clip lands
  correctly positioned and plays back in tempo; arm again and confirm a
  second take replaces the first; switch the selected device to the
  built-in microphone and confirm a take actually captures mic input, not
  stale loopback audio; confirm a device that's been unplugged since the
  list was fetched fails to arm with a visible error instead of hanging or
  crashing the engine.
