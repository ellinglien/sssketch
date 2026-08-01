# x86_64 Plugin Bridge — Design

**Goal:** Let x86_64-only VST3/AU plugins (legacy plugins that never got an Apple Silicon build — e.g. FabFilter Pro-Q 3, confirmed x86_64-only on this machine) load and run as real, live, automatable inserts in the master chain and per-channel chains, indistinguishable in use from a native arm64 plugin — same picker, same editor window, same real-time processing — by running them in a second, x86_64-only helper process (launched under Rosetta 2) and streaming audio across the process boundary in real time.

**Why this is hard, stated up front:** everything else this app hosts runs in-process inside the arm64 engine. A process can only load code matching its own architecture, so an x86_64 plugin's code can never run inside the arm64 engine no matter how it's packaged — it needs its own process, and that process's audio has to reach the main mix with real-time (sub-block) latency, not just "eventually." This is the first genuinely real-time cross-process audio path in this codebase; everything upstream (IPC to Electron, plugin scanning) is either control-plane (not time-critical) or already in-process.

**Not in scope for this pass** (explicitly deferred, not forgotten):
- Windows/Linux — Rosetta 2 is macOS-only; this feature is macOS-only by nature.
- One bridge process per plugin instance — a single shared bridge process hosts every currently-loaded x86_64 plugin for the session (see "Roughly how many x86_64 plugins" — a handful, rarely more than one active — makes per-instance process isolation not worth its overhead right now). A crash still only affects bridged slots, not the arm64 engine or native plugins.
- Automatic retry/backoff loops on repeated bridge crashes — a single manual reload (re-selecting the plugin from its dropdown) is the whole recovery UI. No exponential backoff, no "give up after N attempts" state machine.
- A dedicated "bridge status" screen — the existing per-slot load-status indicator (idle/loading/loaded/error) already covers this; a bridged plugin just uses that same indicator with a bridge-specific error message when relevant.
- Parameter automation sync between the two processes beyond what a plugin's own editor already does — there's no automation lane in this app yet at all, so nothing new is needed here either.

---

## Architecture

### A second, separate native target

A new, minimal x86_64-only JUCE app, `sssketch-bridge`, built from its own CMake project (`native-engine-bridge/`, not folded into `native-engine/`'s existing `CMakeLists.txt`) — genuinely separate from the main engine's arm64 build, not a second slice of the same universal binary. It only knows how to: load a plugin instance (VST3 or AU, same `AudioPluginFormatManager::addDefaultFormats()` as the main engine), process audio blocks handed to it, and open/close that plugin's editor window (reusing the exact same `EditorWindow`/`setAlwaysOnTop` code the main engine already uses — shared source file, compiled into both targets). It has no Transport, no scheduling, no knowledge of rifffs/channels/projects at all — it is purely a dumb plugin host, addressed by the main engine one plugin instance at a time.

Because it's compiled x86_64-only, macOS launches it under Rosetta 2 automatically — no `arch -x86_64` wrapper needed, no special handling beyond spawning it like any other subprocess.

### Lifecycle

The **main arm64 engine** (not Electron) owns spawning and talking to the bridge, since the engine already owns the whole `PluginChain` lifecycle and needs to reach it every audio block. The bridge is spawned lazily — only the first time a channel or master slot actually loads a plugin whose `detectArchitecture()` result is `x86_64` — and stays alive for the rest of the session (spawning it fresh per plugin load would mean paying Rosetta's cold-start cost every time). If every bridged plugin is later removed, the bridge is left running rather than torn down and respawned on the next load — cheap to keep idle, expensive to keep relaunching. It's shut down cleanly (a control message, then a short wait, then `SIGKILL` fallback) alongside the main engine's own subprocess teardown on app quit.

### Audio transport

Per bridged plugin instance, two shared-memory ring buffers (`shm_open` + `mmap`, lock-free single-producer/single-consumer, atomic read/write indices) — one for input audio (engine writes, bridge reads), one for output (bridge writes, engine reads) — each sized to hold 8 blocks' worth of audio, giving the two processes real headroom to drift out of lockstep from scheduling jitter without underrunning. (A starting value, not a hard constraint — tune up if manual testing under real load shows it's not enough.) Each shared-memory segment and its paired POSIX named semaphores are named with a per-session-unique id (not a fixed name), so a leftover segment from a previous crashed session can never collide with or be mistaken for the current one.

Each audio callback, for a slot delegated to the bridge: the engine writes this block's input into the ring buffer, signals the bridge via a named semaphore (`sem_post`), then waits on the output semaphore with a **hard timeout** of 5ms — at a typical 512-sample block (≈11.6ms at 44.1kHz), that leaves roughly half the block's period for the rest of that callback's work. (Also a starting value to tune from real measurements once this is running, not a number derived from profiling.) Two distinct outcomes:
- **Timeout on one block** (bridge briefly slow, not dead): that slot renders silence for just this block; the next block tries again independently. Self-healing — no persistent state changes.
- **Bridge process actually gone** (socket disconnect, or timeouts persisting across many consecutive blocks): the slot is marked errored (see Error Handling) and stays silent until manually reloaded — this is the case the UI surfaces, not a single missed block.

A block-size or sample-rate change from the audio device (same "always use the real device parameters, never a hardcoded value" rule the master-chain work already established, after that exact bug caused a real crash previously) tears down and recreates the affected shared-memory segment(s) rather than trying to resize them in place.

Control-plane messages (load plugin, open/close editor, teardown) go over a lightweight local socket using the same JSON-line protocol `IpcServer.cpp` already uses for Electron↔engine — a second instance of that same pattern, engine↔bridge. Nothing new invented here, just reused.

### Editor windows

Electron's existing "open editor" IPC message reaches the main engine as it does today; the engine checks whether that slot is bridged and, if so, forwards an "open editor" control message to the bridge over its socket instead of opening the window itself. The bridge opens a real, independent OS window — no forwarding trickery needed once a window exists in its own process; it behaves like any other window. Closing works the same in reverse. Same convention as the main engine's own windows: not automatically reopened after a crash/restart (transient UI state).

### No wire-format changes

`EngineProject`'s wire protocol is untouched. The engine re-derives a candidate plugin's architecture from its path at load time via `detectArchitecture()` (already written for `--scan-one-json`), rather than threading `arch` through the project JSON — loading branches purely on that: arm64/universal → load in-process exactly as today; x86_64 → delegate to the bridge (spawning it first if this is the session's first bridged load).

---

## Data model

No native wire-format changes (see above). The only data-shape change is on the renderer side, and it's small:

- **`PluginCatalogBrowser.tsx`**: the existing `entry.arch === 'arm64' || entry.arch === 'universal'` "loadable" check gains `|| entry.arch === 'x86_64'` — x86_64 entries become selectable instead of permanently disabled. A small badge/tag next to the entry (matching the existing tag styling already used elsewhere in this component, e.g. plugin-scan's own arch display) marks it as "bridged" — per the earlier decision to mark bridged plugins subtly rather than leave them looking identical to native ones.
- **`MasterChainPanel.tsx` / `ChannelChainPanel.tsx`** slot dropdowns: same enabling + same badge, since both already filter to favourites and render each candidate's own row.
- **No new error-state UI.** A bridge-load failure or a bridge crash both surface through the *existing* per-slot status indicator (idle/loading/loaded/error) that master/channel chains already have — just with a bridge-specific message ("bridge crashed" vs. "plugin failed to load"). Re-selecting the same plugin from its dropdown re-sends the existing load message and is the entire "reload" flow — no new button, no new IPC message shape.

---

## UI

Covered above — this feature deliberately adds no new screens or components. It extends two already-existing decision points (the loadable-arch check, the status indicator) rather than introducing a parallel "bridged plugin" UI surface.

---

## Error handling

- **Bridge fails to spawn** (binary missing from the packaged app, Rosetta 2 not installed on the machine): surfaces as a load error on that slot through the existing status indicator, exactly like a missing/corrupt native plugin does today. Never crashes the main engine.
- **Bridge process dies mid-session**: every slot currently delegated to it is marked errored and renders silence; other slots (native or on a still-alive bridge, if it's ever needed) are unaffected. Recovery is manual — re-selecting the plugin from its dropdown re-spawns the bridge if needed and reloads.
- **A single block's timeout expires** (bridge alive but momentarily slow): that block is silent for the affected slot only; not treated as a failure, no state change, no error surfaced — this must stay silent-but-invisible or it would spam errors during ordinary Rosetta/OS scheduling jitter.
- **NaN/Inf in the bridge's output**: covered by `PluginChain`'s existing per-slot NaN/Inf guard — no bridge-specific handling needed, the output ring buffer feeds into the same guarded path every other slot's output already goes through.
- **Channel-layout mismatch**: reuses the existing reshape-to-full-input/write-only-main-output approach already validated for native plugin hosting — the bridge's plugin instance is subject to the exact same rules, just fed via the ring buffer instead of a direct in-process call.

---

## Testing

- **Native, automatable:** ring-buffer read/write/wraparound and the timeout→silence-substitution logic, tested with both ends constructed in a single process (no real second process needed to test the algorithm itself) — matches this codebase's existing JUCE `UnitTestRunner` conventions.
- **Manual, end-to-end (required, not automatable — the real pass/fail signal for this feature):** spawn the real bridge, load a real installed x86_64-only plugin (FabFilter Pro-Q 3, already confirmed x86_64-only on this machine from earlier plugin-scan work), confirm audio actually passes through correctly during live playback; open its editor and confirm parameter changes audibly take effect; force-kill the bridge process mid-playback and confirm the engine stays up, the affected slot goes silent, and the rest of the mix is unaffected; re-select the plugin and confirm it reloads successfully; confirm the packaged/signed build still works with the bridge binary bundled as an extra resource (deferred to whenever the still-pending manual sign/notarize dry-run from the earlier signing work actually happens).
