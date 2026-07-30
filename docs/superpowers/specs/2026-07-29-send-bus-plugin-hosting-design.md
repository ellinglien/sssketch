# Send-Bus Plugin Hosting — Design

**Goal:** Expose the native engine's plugin-hosting capability (proven offline via `--plugin-process`, commit df0b409) inside the arranger itself, as a small fixed set of send buses — shared aux buses that stems route a variable amount of signal into, each running one real VST3 plugin from a curated allowlist, live during playback.

**Not in scope for this pass** (explicitly deferred, not forgotten):
- In-app plugin parameter editing (no editor window, no parameter sliders) — a bus loads its plugin at default/factory settings.
- A real, unattended directory scan for plugin discovery — the allowlist is hardcoded; adding a plugin later means editing the allowlist.
- A user-configurable number of send buses — fixed at 4.
- Subprocess-level crash isolation for hosted plugins — a plugin crash takes down the engine process, same as any other engine crash; recovery reuses the existing `onEngineRestarted` path.
- Per-stem insert effects (a different feature — this is sends only).

---

## Architecture

### Signal flow

Four fixed send buses (indices 0–3), always present. Each bus optionally hosts one plugin instance (or none — "off"). Each stem has a per-bus send level in `[0, 1]`, defaulting to 0 — a stem contributes nothing to any bus until its level is raised.

`PlaybackEngine::renderBlock` currently accumulates each stem's gain-adjusted signal directly into `outL`/`outR`. This adds a parallel accumulation path: for every stem, in addition to the existing direct mix, also accumulate `sample * gain * stem.volume * sendLevel[bus]` into each of 4 per-block scratch buffers (one per bus), for every bus where that stem's send level is `> 0`. After every stem has been processed for the block, each bus that has a plugin loaded runs `processBlock` on its accumulated buffer, and the *processed* (wet) result is added into `outL`/`outR` — the send's "return." A bus with no plugin loaded contributes nothing (its scratch buffer is simply not added to the output) — an empty send must never sound like an unprocessed dry duplicate.

`RenderExport.cpp`'s offline render loop reuses the identical `SendBus` accumulate/process/mix-back logic, so an exported mix matches what was heard live. Export has no real-time deadline, so it can load plugins directly and synchronously — none of the real-time hand-off machinery below applies there.

### Real-time-safe plugin load/swap

Loading a plugin (`AudioPluginFormatManager::createPluginInstance`) does real file I/O and can take a non-trivial amount of time — it must never run on the audio thread, which has a hard ~10ms deadline per block on a typical buffer size.

New `SendBus` class (native engine) owns up to 4 live plugin instances and implements this pattern:
1. When the renderer requests a plugin change for a bus (see IPC below), a background thread performs the full `createPluginInstance` + `prepareToPlay` for the new instance. This never touches the audio thread.
2. Once ready, the background thread publishes the new instance via an atomic "pending swap" slot, separate from the bus's currently-active instance.
3. At the very start of each `renderBlock` call (a safe, well-defined boundary — never mid-block, never while a bus's plugin is being processed), the audio thread checks each bus's pending-swap slot; if non-null, it atomically takes ownership of the new instance as the active one. This check-and-swap is a cheap pointer operation, not a blocking one.
4. The previously-active instance (if any) is handed off to a background cleanup thread for deletion, not deleted immediately or on the audio thread.

This means: the expensive/blocking work (plugin instantiation) never touches the audio thread, and the audio thread's own involvement in a swap is a fast, non-blocking pointer check at a safe point between blocks.

---

## Data model

### Renderer state (`AppState`, `store.ts`)

```ts
sendBusPlugins: [string | null, string | null, string | null, string | null]
sendLevels: Record<string, [number, number, number, number]>
```

`sendBusPlugins[i]` is an allowlist ID (see below) or `null` for an empty bus. `sendLevels` is keyed by `stemKey` (same convention as `vol`/`mute`), one 0–1 level per bus; a stem with no entry defaults to `[0, 0, 0, 0]`.

Both fields persist normally through the existing `serializeProject`/`deserializeProject` — this is real arrangement data, not transient UI state (unlike `volumeDragMode`/`compactMode`, which are explicitly excluded from persistence).

New actions:
```ts
{ type: 'SET_SEND_LEVEL'; stemKey: string; bus: 0 | 1 | 2 | 3; level: number } // clamped to [0, 1], same convention as SET_VOLUME
{ type: 'SET_SEND_BUS_PLUGIN'; bus: 0 | 1 | 2 | 3; pluginId: string | null }
```
`SET_SEND_BUS_PLUGIN` both updates `sendBusPlugins` in state *and* triggers the `load-send-plugin` IPC message described below.

### Curated allowlist

A small, fixed table — stable ID, display name, exact plugin file path. Defined once on each side (native C++ needs the path to load; the renderer needs the name to display in the picker), kept in sync by hand — the same convention this codebase already uses for `computeStemSchedule` (documented TS/C++ twin in `src/shared/schedulePlayback.ts` / `native-engine/Source/SchedulePlayback.cpp`).

| ID | Display name | Path |
|---|---|---|
| `solid-bus-comp` | Solid Bus Comp | `/Library/Audio/Plug-Ins/VST3/Solid Bus Comp.vst3` |
| `pro-q-3` | FabFilter Pro-Q 3 | `/Library/Audio/Plug-Ins/VST3/FabFilter Pro-Q 3.vst3` |
| `soothe2` | soothe2 | `/Library/Audio/Plug-Ins/VST3/soothe2.vst3` |
| `sausage-fattener` | Sausage Fattener | `/Library/Audio/Plug-Ins/VST3/SausageFattener.vst3` |
| `sunset-sound-reverb` | Sunset Sound Studio Reverb | `/Library/Audio/Plug-Ins/VST3/TR5 Sunset Sound Studio Reverb.vst3` |

All VST3 (not AU) — matches the format already proven end-to-end in the offline POC, and sidesteps AU's extra threading constraints noted in `PHASE0_FINDINGS.md`. Paths are hardcoded to this machine, matching the single-user scope of this app; a missing plugin at its expected path surfaces as a load error (see Error Handling), not a crash.

### Wire protocol (`EngineProject`, native + `buildEngineProject.ts`)

```cpp
struct EngineSendBus { juce::String pluginId; }; // empty string = no plugin loaded

struct EngineProject {
    double bpm;
    double snapDiv;
    std::vector<EngineRifff> rifffs;
    std::array<EngineSendBus, 4> sendBuses; // NEW
};
```

`EngineStem` gains `std::array<double, 4> sendLevels = {0,0,0,0}`.

`sendLevels` and `sendBuses`' plugin *IDs* flow through the existing `load-project` message (cheap data, resent on every relevant state change, same as today). Actually loading/swapping a plugin binary is a separate, explicit `load-send-plugin` IPC message (`{bus, pluginId}`), sent only when the picker's selection for a bus actually changes — never implicitly from the general project sync. This separation is deliberate: an unrelated edit elsewhere in the arrangement (moving a clip, adjusting a fade) must never accidentally trigger a plugin reload or swap-related glitch. The engine replies with `{type: 'send-plugin-loaded', payload: {bus, pluginId, success, error}}` once the background load completes (or fails), so the UI can clear its "loading…" state or show the error.

On engine restart (`onEngineRestarted`, existing recovery path), the renderer resends send-bus plugin assignments the same way it already resends the project.

---

## UI

**Sends panel:** a new "sends" button in `TransportBar` (same visual treatment as the existing envelope/compact toggle buttons) opens a small panel listing the 4 buses. Each row: a dropdown of the 5 allowlist plugins plus "none," and a status indicator (idle / loading / loaded / error, with the error message available on hover).

**Per-stem send controls:** in `Inspector.tsx`'s existing per-stem row (alongside the current mute swatch, slot number, name, type-cycle button), each stem gets 4 small level controls, one per bus, defaulting to 0 — a compact mini-fader per bus. Dispatches `SET_SEND_LEVEL` on change.

---

## Error handling

- **Plugin missing at its expected path, wrong architecture, or fails to instantiate:** the bus's status shows an error in the sends panel (never a crash); the bus behaves as if empty (its accumulation contributes silence) until a working plugin is selected.
- **Plugin crashes mid-processing:** out of scope to isolate (would need a full subprocess-per-plugin bridge — noted as future work in `PHASE0_FINDINGS.md` too, not newly deferred here). A crash takes down the engine process; the app's existing `onEngineRestarted` recovery path handles reconnection, and the renderer resends both the project and send-bus assignments on restart.
- **Channel-layout mismatch** (e.g. a plugin wanting more input channels than its main output, as confirmed with Solid Bus Comp's 4-in/2-out layout): reuses the exact reshape-to-full-input / write-only-main-output-bus approach already validated in the offline POC (`Main.cpp`'s `runPluginProcess`).

---

## Testing

- **Native:** unit tests for `SendBus`'s accumulate → process → mix-back logic, fixture-WAV style matching `PlaybackEngineTests.cpp`'s existing conventions (known input, known plugin behavior or a no-op test plugin, assert the mixed output). The real-time swap hand-off itself is tested for the check-and-swap logic in isolation where practical; testing an actual concurrent audio-thread race is not practical to automate and is covered by manual verification instead.
- **Renderer:** reducer tests for `SET_SEND_LEVEL`/`SET_SEND_BUS_PLUGIN`, matching existing `store.test.ts` conventions.
- **Manual, end-to-end:** load a plugin onto a bus, raise a stem's send level, confirm an audible change during live playback; export and confirm the rendered mix matches what was heard live.
