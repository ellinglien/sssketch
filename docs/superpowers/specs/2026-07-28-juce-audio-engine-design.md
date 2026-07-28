# JUCE Native Audio Engine + VST3/AU Plugin Hosting — Design

## Goal

Add real per-channel and master-bus effects (VST3 + Audio Unit plugins) to ssstitch, by
replacing its Web Audio–based playback/export engine with a native JUCE audio engine —
while keeping the existing Electron/React UI (timeline, inspector, beat-picker, context
menu, undo/redo, drag-and-drop) exactly as it is.

## Why not stay in Web Audio, and why not a full native rewrite

Web Audio API (what the current `AudioEngine.ts`/`exportMix.ts` are built on) cannot host
native VST3/AU plugins under any circumstances — there is no bridge from a Chromium
renderer to a plugin binary. Getting real plugin support requires actual native code.

A full rewrite of the app in JUCE's own GUI framework was considered and rejected for v1:
it would mean redoing the timeline, waveforms, drag-and-drop, beat-picker (tap-to-mark,
live playhead sweep), context menu, and everything else already built, in a
much-slower-to-iterate language, for no benefit to the actual goal (plugin hosting). The
hybrid approach below keeps all of that UI investment intact.

## Architecture

Three processes:

1. **Electron main process** — unchanged in spirit: file I/O, project save/load, the
   import/copy pipeline, downbeat-rotation baking (`bakeOffset.ts`, pure WAV file
   manipulation, no real-time audio, no reason to move). New responsibility: spawns and
   supervises the JUCE engine as a child process, and proxies IPC between the renderer and
   the engine's socket connection (the renderer never gets direct native/socket access —
   same sandboxing model already in place via `contextBridge`).
2. **Electron renderer (React)** — unchanged: every component built so far. New: a
   plugin-chain UI (below), talking to the engine only through `window.rifffApi`.
3. **New: JUCE audio engine** — a standalone native executable (`ssstitch-engine` or
   similar), launched alongside the app on startup, communicating over a local socket
   (JSON messages, one connection, request/response + async push events). Owns: plugin
   hosting (scan/load/edit VST3 + AU via `juce::AudioPluginFormatManager`), real-time
   playback scheduling, offline export rendering, and the transport clock.

A crash in the native engine does not take down the whole app — the main process detects
the disconnect, surfaces an error state in the UI, and can restart the engine process.

## What moves to native vs. what stays in TypeScript

| Stays in TS/React (unchanged) | Moves to JUCE |
|---|---|
| All UI components | Real-time playback scheduling (replaces `AudioEngine.ts`) |
| Project state/reducer, undo/redo (`history.ts`) | Offline export rendering (replaces `exportMix.ts`) |
| Import pipeline, filename parsing (`parseFilename.ts`), type-guessing (`typeGuess.ts`) | All actual audio output |
| Downbeat baking / WAV rotation (`rotateWav.ts`, `bakeOffset.ts`) | Plugin hosting, scanning, editor windows |
| Waveform peak generation for display (`peakCache.ts`) | Master bus + per-channel effect chains |
| BeatPicker's own tap-to-preview audio (isolated auditioning at import time, before a clip is ever on the timeline or touched by plugins) | Fade automation (moves from Web Audio `GainNode` ramps — `fadeGain.ts` — to JUCE parameter smoothing) |

rubberband time-stretch stays exactly as it is today (a CLI subprocess producing
pre-rendered stretched files, invoked from the main process) for the first pass — folding
it into the native engine as true real-time stretching is a reasonable later optimization
(Phase 5), not a v1 requirement.

`computeStemSchedule` (`schedulePlayback.ts`) — the pure segment-timing math shared today
by both live playback and export — gets ported to C++ as the equivalent pure function in
the JUCE engine. It's simple, well-tested (already has a thorough Vitest suite to port
test cases from), and is the one piece of "business logic" that must exist on the native
side since both playback and export happen there now.

## Plugin hosting

JUCE's `AudioPluginFormatManager` handles VST3 + AudioUnit scanning and hosting directly.
On first run (or via an explicit "scan for plugins" action from the UI), the engine scans
the standard plugin directories (`~/Library/Audio/Plug-Ins/VST3`,
`~/Library/Audio/Plug-Ins/Components`, plus the system-wide equivalents) and reports back
a list — name, format, manufacturer, unique identifier — over the socket.

Each stem gets its own effect chain (an ordered list of plugin instances); there's also
one additional chain for the master bus, applied after all stems are summed.

## Data model

`AppState` gains one new field:

```ts
pluginChains: Record<string, PluginInstance[]>  // keyed by stemKey, or "master" for the master bus

interface PluginInstance {
  id: string          // instance id, stable across reorders
  pluginId: string     // which scanned plugin (matches the engine's scan-result identifier)
  bypassed: boolean
  state: string        // base64 blob — the plugin's own serialized state, opaque to the app
}
```

The app never needs to understand individual plugin parameters generically — VST3/AU
plugins serialize their own complete internal state as a blob that JUCE can get/set on
request. Because this lives in `AppState` like everything else, save/load and undo/redo
work for plugin chains for free, through the existing reducer/history machinery — no
special-casing needed there.

## UI additions

- A **plugins** section in the Inspector, under the currently-selected stem: the chain as
  an ordered list, with add / remove / reorder / bypass / edit controls, matching the
  existing control style (buttons, nudge-style reordering) rather than a drag-and-drop
  rack for v1.
- A **master** panel — likely docked near the TransportBar — showing the master bus chain
  with the same controls.
- A **plugin browser** modal, fed by the engine's scan results, with a search box (plugin
  lists can be large).

Clicking "edit" on a plugin instance sends `open-plugin-editor` to the engine, which opens
that plugin's real native editor window — a genuine OS-level window, positioned near (but
independent of) the Electron window. This sidesteps the genuinely hard problem of
embedding a native plugin's own GUI inside a webview, at the cost of it being a separate
window rather than an in-app panel.

## IPC protocol (JSON over a local socket)

**Electron → JUCE:**
- `load-project(state)` — full state sync (rifffs, offsets, stretch, mute/volume, fades,
  plugin chains)
- `play(fromPos)` / `pause()` / `stop()` / `set-position(pos)`
- `scan-plugins()` → plugin list
- `add-plugin(channelKey, pluginId)` / `remove-plugin(channelKey, instanceId)` /
  `reorder-plugin(...)` / `set-bypass(channelKey, instanceId, bypassed)`
- `open-plugin-editor(channelKey, instanceId)`
- `render-export(state, outputPath)` → writes the WAV directly to `outputPath` and
  returns success/failure, rather than streaming potentially large audio bytes back over
  the socket

**JUCE → Electron:**
- `position-update(pos)` — pushed periodically while playing, replacing today's
  `requestAnimationFrame` polling loop in `StoreContext.tsx` with real events from the
  engine's own clock
- `plugin-editor-closed(channelKey, instanceId)`
- `engine-error(message)`

## Phased roadmap

This is a multi-phase effort; plugin hosting isn't real until Phase 3.

- **Phase 0 — Spike.** A minimal standalone JUCE app (no Electron involved at all) that
  scans and loads one VST3 and one AU plugin, processes a test signal. Proves the
  toolchain — Xcode, JUCE itself, VST3 SDK licensing terms — works end to end before any
  integration work begins.
- **Phase 1 — Native playback, no plugins.** The JUCE engine reimplements exactly what
  `AudioEngine.ts` does today (offset, stretch, mute/volume, fades, unlinked/dragged stem
  positions). Prove the IPC + transport works, A/B against the current Web Audio engine
  for correctness before removing anything.
- **Phase 2 — Native export.** Port `exportMix.ts`'s logic to the engine's
  `render-export`. Once verified at parity, retire the Web Audio playback/export code
  paths (`AudioEngine.ts`, `exportMix.ts`'s `OfflineAudioContext` usage).
- **Phase 3 — Plugin hosting.** Scanning, loading, per-channel + master chains, add/
  remove/bypass UI. This is the actual "plugins work" milestone.
- **Phase 4 — Plugin editor windows.** Native window handling for `open-plugin-editor`,
  plus state-blob persistence in the project file (save/load round-trips a plugin's exact
  settings).
- **Phase 5 (stretch).** Consider migrating rubberband into the native engine as
  real-time processing instead of pre-rendered files.

## Out of scope for this design

Same non-goals as the original app, plus: Windows/Linux support (macOS only, matching the
existing app and its rubberband/Endlesss-workflow assumptions), AAX hosting, embedding
plugin editor UIs inside the Electron window, MIDI/plugin instruments (this hosts audio
effects, not instruments — there's no MIDI content in Endlesss stems to drive one),
automatable plugin parameters exposed at the app level (state is opaque per-plugin, not
individually automatable from ssstitch's own UI).
