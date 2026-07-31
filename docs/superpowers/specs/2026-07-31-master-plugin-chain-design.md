# Master Plugin Chain — Design

**Goal:** Expose the native engine's plugin-hosting capability (proven offline via `--plugin-process`, commit `df0b409`; proven live via the now-reverted send-bus feature, commit range `7077c5b`..`21df0fb`) as a small fixed insert chain on the arranger's final master output — up to 4 plugins in series, from a curated VST3 allowlist, running live during playback and export, with real native editor windows for tweaking parameters.

**History this builds on:** A send-bus (parallel aux, per-stem send levels) version of plugin hosting was fully built, a real crash was found and fixed (bad sample rate/block size on plugin load; NaN contagion in the mix; a stuck failed-load state), and the whole feature was reverted 12 minutes later — not because it was still broken, but as a scope call ("core purpose is quick arranging... plugin hosting was real scope creep"). This design deliberately reuses everything from that arc that's still true (allowlist, real-time-safe load/swap, error handling, export parity), and changes the shape from parallel sends to a single master insert chain, which is simpler (no per-stem send-level state at all), plus adds real plugin editor windows, which the old design explicitly deferred.

**Not in scope for this pass** (explicitly deferred, not forgotten):
- Per-stem insert effects or sends (a different feature).
- A real, unattended directory scan for plugin discovery — the allowlist is hardcoded; adding a plugin later means editing the allowlist.
- A user-configurable number of chain slots — fixed at 4.
- Reordering slots — fixed series order 0→1→2→3.
- Subprocess-level crash isolation for hosted plugins — a plugin crash takes down the engine process, same as any other engine crash; recovery reuses the existing `onEngineRestarted` path.
- Automatically reopening editor windows after an engine restart/crash-recovery — transient UI state, not restored, matching this app's existing convention elsewhere.

---

## Architecture

### Signal flow

Four fixed insert slots (indices 0–3), always present, processed **in series** on the final mixed output. Each slot optionally hosts one plugin instance (or none — "off," pure passthrough).

`Transport::audioDeviceIOCallbackWithContext` currently calls `PlaybackEngine::renderBlock` one or more times per device callback (it splits at loop boundaries), each call accumulating into the same `outL`/`outR` buffers. A new `MasterChain` class processes that buffer **once per device callback**, after all of that callback's `renderBlock` calls have finished — not inside `renderBlock` itself, since a mid-split partial buffer isn't the real final mix yet. `MasterChain::process(outL, outR, numSamples)` runs each loaded slot's `processBlock` in order 0→1→2→3; an empty slot is skipped (pure passthrough, not a break in the chain).

`RenderExport.cpp`'s offline render loop calls the identical `MasterChain::process` on its own accumulated buffer after each render block, so an exported mix matches what was heard live. Export has no real-time deadline, so it can load plugins directly and synchronously for its own local instances — none of the real-time hand-off machinery below applies there (matches the old design's approach).

### Real-time-safe plugin load/swap

Reused unchanged from the send-bus design, since this part was already built, fixed, and proven correct:

1. A background thread performs `AudioPluginFormatManager::createPluginInstance` + `prepareToPlay` (using the **real** device sample rate / block size from `Transport`, not a hardcoded value — this exact bug caused the original crash) for the new instance. Never touches the audio thread.
2. Once ready, it's published via an atomic "pending swap" slot per chain slot, separate from the currently-active instance.
3. At the very start of each `MasterChain::process` call, the audio thread checks each slot's pending-swap slot; if non-null, atomically takes ownership as the new active instance. Cheap, non-blocking pointer swap.
4. The previously-active instance (if any) is handed off to a background cleanup thread for deletion.

`MasterChain::process` also drops any non-finite (NaN/Inf) sample after each slot's `processBlock`, before it reaches the next slot or the device output — one misbehaving plugin must not corrupt the whole chain or silence output entirely.

### Editor windows

The native engine (`native-engine`) changes its CMake target from `juce_add_console_app` to `juce_add_gui_app`, becoming a real `.app` bundle with full `NSApplication`/window-server integration, matching the standard pattern JUCE's own `AudioPluginHost` example uses. It stays a background/accessory app (no Dock icon, no stealing focus) until a window is actually opened. Electron continues to `spawn()` the binary at its normal path inside the bundle — no change to how it's launched from `src/main/engineProcess.ts`.

**Known risk, called out explicitly:** `Main.cpp` currently has a documented comment explaining that a blocking `runDispatchLoop()` (which relies on `[NSApp run]`) was observed returning immediately in this process's current headless configuration, which is why it polls with `runDispatchLoopUntil(50)` instead. Converting to a real GUI app target is the standard fix for that class of problem, but this has **not been spiked** before committing to this design (a deliberate choice, made with the user, to accept this risk rather than delay). If it surfaces unexpected problems during implementation, the chain's actual audio processing (load/swap/process/error-handling) is fully independent of the windowing piece and should keep working correctly regardless — only the "open editor" affordance would need a follow-up fix.

New IPC messages: `{type: 'open-master-plugin-editor', payload: {slot}}` constructs a `juce::DocumentWindow` wrapping that plugin's `AudioProcessorEditor` on the engine's message thread. `{type: 'close-master-plugin-editor', payload: {slot}}` destroys the window and editor component — the underlying plugin instance keeps loaded and processing either way. The window's own close button sends the same close message back to keep engine-side state in sync. On engine restart/crash-recovery, any open editor windows are simply gone (not reopened automatically).

---

## Data model

### Renderer state (`AppState`, `store.ts`)

```ts
masterChain: [string | null, string | null, string | null, string | null]
```

`masterChain[i]` is an allowlist ID (see below) or `null` for an empty slot. No per-stem state is needed (unlike the old design's `sendLevels`) since this is a single shared chain on the master output, not a per-stem-routable send.

Persists normally through the existing `serializeProject`/`deserializeProject` — real arrangement data, not transient UI state.

New action:
```ts
{ type: 'SET_MASTER_CHAIN_PLUGIN'; slot: 0 | 1 | 2 | 3; pluginId: string | null }
```
Updates `masterChain` in state *and* triggers the `load-master-plugin` IPC message described below.

Editor-window open/closed state (per slot, which windows are currently open) is transient renderer UI state, not persisted — same convention as `volumeDragMode`/`compactMode`.

### Curated allowlist

Reused verbatim from the old design — same 5 plugins, same IDs, same paths:

| ID | Display name | Path |
|---|---|---|
| `solid-bus-comp` | Solid Bus Comp | `/Library/Audio/Plug-Ins/VST3/Solid Bus Comp.vst3` |
| `pro-q-3` | FabFilter Pro-Q 3 | `/Library/Audio/Plug-Ins/VST3/FabFilter Pro-Q 3.vst3` |
| `soothe2` | soothe2 | `/Library/Audio/Plug-Ins/VST3/soothe2.vst3` |
| `sausage-fattener` | Sausage Fattener | `/Library/Audio/Plug-Ins/VST3/SausageFattener.vst3` |
| `sunset-sound-reverb` | Sunset Sound Studio Reverb | `/Library/Audio/Plug-Ins/VST3/TR5 Sunset Sound Studio Reverb.vst3` |

All VST3, matching the format already proven end-to-end in the offline POC and the old send-bus feature. Defined once on each side (native C++ needs the path to load; the renderer needs the name to display), kept in sync by hand — same convention as this codebase's existing `computeStemSchedule` TS/C++ twin (`src/shared/schedulePlayback.ts` / `native-engine/Source/SchedulePlayback.cpp`). A missing plugin at its expected path surfaces as a load error (see Error Handling), not a crash.

### Wire protocol (`EngineProject`, native + `buildEngineProject.ts`)

```cpp
struct EngineProject {
    double bpm;
    double snapDiv;
    std::vector<EngineRifff> rifffs;
    std::array<juce::String, 4> masterChain; // NEW — empty string = no plugin loaded
};
```

`masterChain`'s plugin *IDs* flow through the existing `load-project` message (cheap data, resent on every relevant state change, same as today). Actually loading/swapping a plugin binary is a separate, explicit `load-master-plugin` IPC message (`{slot, pluginId}`), sent only when a slot's picker selection actually changes — never implicitly from a general project sync, so an unrelated arrangement edit never risks triggering a reload/swap glitch. The engine replies `{type: 'master-plugin-loaded', payload: {slot, pluginId, success, error}}` once the background load completes or fails.

On engine restart (`onEngineRestarted`, existing recovery path), the renderer resends master-chain plugin assignments the same way it already resends the project.

---

## UI

**Master panel:** a new "master" button in `TransportBar` (same visual treatment as the existing envelope/compact/sends-style toggle buttons) opens a small panel listing the 4 slots in order. Each row: a dropdown of the 5 allowlist plugins plus "none," a status indicator (idle / loading / loaded / error, with the error message available on hover), and an "edit" button — disabled until the slot is loaded, sends the open-editor IPC message when clicked.

No per-stem UI changes at all this time (no send knobs) — this is the whole reason the master-chain shape is simpler than the old send-bus one.

---

## Error handling

- **Plugin missing at its expected path, wrong architecture, or fails to instantiate:** the slot's status shows an error in the master panel (never a crash); the slot behaves as empty (pure passthrough) until a working plugin is selected.
- **Plugin crashes mid-processing:** out of scope to isolate (would need a full subprocess-per-plugin bridge, same as the old design's stance) — a crash takes down the engine process; the app's existing `onEngineRestarted` recovery path handles reconnection, and the renderer resends both the project and master-chain assignments on restart. Any open editor windows are lost (not reopened automatically).
- **A single slot producing NaN/Inf samples:** dropped before reaching the next slot in the chain or the device output, so one bad plugin can't corrupt everything downstream of it.
- **Channel-layout mismatch** (a plugin wanting a different channel count than the fixed stereo chain): reuses the reshape-to-full-input / write-only-main-output approach already validated in the offline POC and the old send-bus feature.
- **Editor window fails to open** (the NSApplication/windowing risk flagged above): surfaces as an error status on that slot's row in the panel; the engine keeps serving audio correctly regardless — a windowing failure must never take down playback.

---

## Testing

- **Native:** unit tests for `MasterChain`'s in-series processing (fixture-WAV style, matching `SendBusTests.cpp`'s old conventions — known input, known plugin behavior or a no-op test plugin, assert the processed output) and its NaN/Inf guard. The real-time swap hand-off's check-and-swap logic is tested in isolation where practical; an actual concurrent audio-thread race isn't practical to automate and is covered by manual verification instead.
- **Renderer:** reducer tests for `SET_MASTER_CHAIN_PLUGIN`, matching existing `store.test.ts` conventions.
- **Manual, end-to-end (required — not automatable):** load a plugin into a slot, confirm an audible change during live playback; load two plugins into two slots and confirm they process in series (order matters, e.g. a gain-boost plugin before a compressor sounds different than after); export and confirm the rendered mix matches what was heard live; open a plugin's editor window and confirm it renders and accepts input; close it and confirm the plugin keeps processing; explicitly flagged as the highest-risk manual-verification item given this is a new architecture (console app → GUI app) that hasn't been spiked ahead of time.
