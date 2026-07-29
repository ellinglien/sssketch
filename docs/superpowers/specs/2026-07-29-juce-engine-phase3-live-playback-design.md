# JUCE Engine Phase 3 — Native Live Playback Design

## Goal

Replace `AudioEngine.ts`'s Web Audio playback with the native JUCE engine as the app's only
live-playback path, retiring the Web Audio engine entirely once proven at parity — the same
hard-cutover pattern Phase 2 used for export. Builds directly on Phase 2's subprocess-
spawning (`engineProcess.ts`) and wire-protocol client (`engineClient.ts`).

## Scope boundary

This phase covers **live in-app playback only**: the transport (play/pause/position), and
keeping the engine's picture of the project in sync as the user edits while playing. It does
not touch plugin hosting (Phase 4+ per the original design doc) or `BeatPicker`'s own
tap-to-preview audio, which stays exactly as it is today — isolated, Web-Audio-based,
happening before a clip is ever on the timeline, with no reason to move.

## Architecture

### Two independent engine processes, not one shared

Phase 2's `nativeExport()` spawns a fresh, one-shot engine process per export and tears it
down afterward. This phase adds a **second, separate, persistent engine process for live
playback**, spawned once at app startup and kept alive for the whole session. These are
**deliberately independent processes**, not a shared engine instance.

This matters because of how the native side is actually built: `IpcServer`/`IpcConnection`
own one `PlaybackEngine` (and therefore one `currentProject`) per process, constructed once
in `runServe` and shared across whatever connections attach to it. If live playback and
export shared a single engine process, an export triggered mid-playback would call
`load-project` with the export's own project data and silently clobber whatever the user is
currently listening to — a real correctness bug, not a hypothetical one. Two separate
processes (two separate `--serve` invocations on two separate ports, one long-lived, one
spawned-and-killed per export exactly as Phase 2 already does) sidesteps this entirely, at
the cost of running two lightweight native processes when an export happens to overlap with
playback — an acceptable, cheap tradeoff.

### Process lifecycle

The playback engine spawns once during Electron main's startup (in `app.whenReady()`,
alongside window creation — not blocking window creation, since the engine takes ~1-3s to
report readiness per what Phase 1/2 measured). Main process owns a single, module-level
`EngineClient` connected to it for the app's entire session. The renderer never gets direct
access to this connection — only through `window.rifffApi`, matching the existing
`contextBridge` sandboxing model used for every other native/IPC-adjacent feature so far.

### `EngineClient` needs a new capability: push-message subscription

Phase 2's `EngineClient` (`src/main/engineClient.ts`) was built exclusively for one-shot
request/response: `sendAndAwaitType` registers a single waiter for a given response `type`,
resolves it on the first match, and removes it. That's sufficient for export's
`render-export` → `render-export-result` exchange, but live playback needs to react to a
continuous stream of `position-update` pushes from the engine's 30Hz timer (already
implemented server-side since Phase 1, never consumed until now) — an ongoing subscription,
not a one-time wait. This phase adds an event-emitter-style method to `EngineClient` —
something like `client.on(type, callback)` / `client.off(type, callback)` — used alongside
the existing `sendAndAwaitType`, not replacing it (export's request/response usage is
untouched). `handleMessage`'s dispatch needs to check persistent subscribers in addition to
one-time waiters for a given message type.

### Reactive state sync: simpler than what it replaces

`AudioEngine.ts` schedules Web Audio playback as a one-shot operation per `play()` call, so
`StoreContext.tsx` needs an explicit "reschedule" effect that detects state changes
(offset/tempo/snap/unlink/rifffs/stemStart/fadeIn/fadeOut) while playing and manually calls
`engine.play(engine.currentPos(...))` again to pick up the change.

The native engine doesn't need this. `PlaybackEngine::renderBlock` (Phase 1) already
recomputes `computeStemSchedule` fresh on *every single audio block*, driven by nothing but
"whatever `EngineProject` is currently loaded" and Transport's own continuously-advancing
position clock. A live edit while playing just means sending a fresh `load-project` message
with the updated state — the very next block picks it up automatically, mid-stream, with no
stop/restart and no separate "reschedule" code path to maintain. `StoreContext.tsx`'s
existing reschedule-effect dependency list (the same fields: `off`, `bpm`, `snapIdx`,
`unlinked`, `stretch`, `rifffs`, `stemStart`, `fadeIn`, `fadeOut`) becomes simply "send
`load-project` again whenever any of these change," with no special-casing for "while
playing" vs. "while paused" — sending a fresh project to a paused engine is harmless and
keeps it always in sync for whenever play is next pressed, which is arguably more correct
than today's paused-engine staleness.

### Position reporting and loop wrap-around

Position reporting switches from `StoreContext.tsx`'s current `requestAnimationFrame`
polling loop (which calls `engine.currentPos(loopLengthBars)` every ~55ms) to genuine
`position-update` push events from the engine, relayed by main process to the renderer
(main subscribes via the new `EngineClient.on('position-update', ...)`, forwards each one
over a dedicated IPC channel the preload bridge exposes as a subscribable event, e.g.
`window.rifffApi.onPositionUpdate(callback) => unsubscribe`). The renderer dispatches
`SET_POS` on each push.

Loop wrap-around stays a renderer-side concern, exactly as it is today — the native
`Transport`'s position clock counts up monotonically forever with no concept of "loop
length" (that's computed client-side from `rifffs` via the existing `loopLengthBars`
selector, and has no reason to move — the engine doesn't need to know it, only the UI does).
`StoreContext.tsx` watches incoming `position-update` pushes and, when the reported position
would meet or exceed the computed loop length, calls `set-position(wrapped)` (or replays
`play(0)`) — the same wrap-detection logic that exists today, just triggered by real engine
events instead of a local rAF-computed value.

### Crash recovery

Main process detects a dropped connection (the `EngineClient`'s underlying socket emitting
`'close'`/`'error'`, or the spawned `ChildProcess`'s `'exit'` event firing unexpectedly) and
responds by: silently respawning the engine process, reconnecting `EngineClient`, and
re-sending the current `load-project` state once reconnected (so the freshly-restarted
engine isn't left in an empty state). Playback stops (the audio was already interrupted —
nothing to preserve mid-stream), but no error is surfaced to the user and no action is
required from them; a console log records what happened for debugging.

**"Silent" means no visible error UI, not an inconsistent app state.** Leaving
`state.playing: true` with a frozen position after a respawn would look like a real bug (a
stuck playhead, a pause button that no longer does anything) — that's not what "silent" is
meant to buy. Main process pushes a lightweight event to the renderer as part of the
reconnect sequence (the same subscription mechanism `position-update` uses), and the
renderer's handler is simply `dispatch({ type: 'STOP' })` — reusing the existing `STOP`
action already in the reducer, no new action type needed, no banner, no user-facing
indication anything happened, but internal state stays honest.

## What moves to native vs. stays in TS

Same division as the original Phase 1 design doc's table: `AudioEngine.ts`'s scheduling and
playback logic (buffer loading, gain staging, fade automation, transport) is fully replaced
by the native engine via IPC. `BeatPicker`'s own tap-to-preview audio, the import pipeline,
project state/reducer/undo-redo, downbeat baking, and waveform peak generation are all
unaffected — none of them touch live playback scheduling.

## Retirement

Hard cutover, matching Phase 2's export precedent: prove parity (see Testing below), then
delete `AudioEngine.ts` and `StoreContext.tsx`'s Web Audio wiring (the `engineRef`, the
play/pause effect, the reschedule effect, the rAF position-polling loop) in the same phase —
not left behind as a fallback, not gated behind a flag, matching the explicit rollout
decision for this phase.

## Testing strategy

Reusing Phase 1's proven pattern, adapted for live (not offline) behavior:

- An automated parity test comparing what the native engine *would* schedule/play at a given
  position and project state against `AudioEngine.ts`'s current scheduling decisions, for
  scenarios covering offset, mute/volume, fades — and, new for this phase, a live mid-
  playback state change (start playing, mutate state, confirm the very next rendered block
  reflects the change without an explicit reschedule call, proving the "just send
  load-project again" architecture actually works as designed).
- **This phase's parity test also closes Phase 2's still-open stretch-ratio gap.** Phase 1
  and Phase 2's findings docs both named stretch-ratio correctness as having no automated
  numeric parity check anywhere in the codebase — deferred twice already. Both the
  parity-test pattern and the `rubberband`/`resolveStretchedForExport`-equivalent wiring
  already exist by this point, so closing it here is a small incremental addition (one more
  scenario: two rifffs at different native bpms than the project bpm, stretch on, comparing
  native vs. `AudioEngine.ts` output), not new infrastructure — and live playback is exactly
  where the stretch toggle matters most to get right. Not deferred again.
- Mandatory manual verification, matching Phase 2's bar: start the dev app, actually press
  play, actually listen, actually change a control (volume, mute, offset) mid-playback and
  confirm it takes effect immediately and correctly, and actually let a loop wrap around and
  confirm playback continues seamlessly rather than glitching or stopping.

## Out of scope

- Plugin hosting (a later phase, per the original design doc).
- Any change to `BeatPicker`'s own preview audio.
- Packaging/distribution of the compiled engine binary for a shipped app (still an open gap
  from Phase 2, unaddressed here too).
