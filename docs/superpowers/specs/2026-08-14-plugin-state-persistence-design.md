# Plugin State Persistence — Design

**Status:** Drafted through the brainstorming skill with Elling. Follows directly from a real bug
report: "i noticed that plugin settings weren't preserved on one plugin on save.... is that
something we overlooked?" — confirmed via code investigation to be a universal gap, not a
plugin-specific bug: hosted VST3/AU plugins have never had their internal parameter state
(knob positions, presets) persisted across save/reload/engine-restart/crash-recovery, for any
plugin, ever. Elling confirmed: "its knob positions were reset to default, so yeah, universal."

## Background

sssketch hosts VST3/AU plugins in a native JUCE/C++ engine subprocess: a 4-slot master chain
and a 2-slot chain per channel, both owned by `PluginChain` instances in
`native-engine/Source/PluginChain.h`/`.cpp`. Today, only a plugin's **identity** — its catalog
`pluginId` and file `path` — is ever persisted, via `EngineProject.h`'s `MasterChainSlot` struct
(native side) and the renderer's `state.masterChain`/`state.channelPlugins` fields (just
catalog-id strings or `null`), carried across the `buildEngineProject.ts`/`EngineProject` wire
boundary. On every project load, engine restart, or crash-recovery, `PluginChain::requestLoad()`
/`loadPluginSync()` instantiates a **fresh** `juce::AudioProcessor` from the plugin binary via
`formatManager.createPluginInstance(...)` — always starting from that plugin's own default
state. No code path anywhere calls JUCE's `getStateInformation()` (to capture) or
`setStateInformation()` (to restore).

The two design specs that originally built plugin hosting
(`docs/superpowers/specs/2026-07-31-master-plugin-chain-design.md` and
`2026-08-01-channel-plugin-inserts-design.md`) only discuss editor-**window** UI state
(open/closed) as "transient, not persisted" — they never actually address parameter **state**
as a requirement at all. This reads as an oversight in the original scoping, not a deliberate
tradeoff: this design closes that gap.

## Goal

A plugin's tweaked parameters survive an explicit Save and come back correctly on the next
project open, engine restart, or crash-recovery restore — for both the master chain and every
per-channel chain, using the exact same mechanism for both slot types.

## Non-goals

- **No live/continuous state syncing while working.** State is captured only at the moment of
  an explicit Save (Save button, Cmd+S, or the quit-time save prompt — i.e. everywhere
  `handleSave()` already runs) — never on the debounced crash-recovery autosave, and never
  speculatively in the background. If you crash before your next explicit save, plugin knob
  changes since the last save are lost, same as they always have been; only the *save* path
  itself starts actually capturing them.
- **No cross-plugin-version compatibility handling.** If a plugin's own state format changes
  between versions (e.g. after a plugin update), applying an old blob to a new version is left
  entirely to that plugin's own `setStateInformation` implementation to handle or reject —
  sssketch does no version negotiation or migration of its own.
- **No change to editor-window open/closed persistence** — already correctly unpersisted, not
  touched here.
- **No sidecar files.** State is embedded directly in the `.sssketchproj` JSON (see Design §2)
  — one file per project, no second file to keep in sync, copy, or orphan.

## Design

### 1. Where captured state lives

A new field alongside the existing `masterChain`/`channelPlugins` identity fields in the
serialized project JSON — call it `pluginStates`, keyed by the same slot addressing already
used elsewhere in this codebase for these two chain types: `master:<slotIndex 0-3>` and
`channel:<channelId>:<slotIndex 0-1>` (exact key format is an implementation detail for the
plan to pin down, matching whatever addressing convention `buildEngineProject.ts` already uses
internally for these two chain kinds). Each entry: `{ pluginId: string; stateBase64: string }`.
`pluginId` is stored alongside the blob (not just implied by the slot's own `masterChain`/
`channelPlugins` entry) specifically so the restore path (§3) can validate the blob still
matches whatever plugin is actually loaded in that slot before ever calling
`setStateInformation` with it.

This field lives in the persisted JSON but **not** in `AppState`/the reducer — it's never
`dispatch`ed, never flows through `serializeProject`'s normal state-to-JSON path the way
`masterChain`/`channelPlugins` do. It's fetched fresh from the engine at the moment of save
(§2) and merged into the outgoing JSON object at that point, then dropped again — there is no
reason for the renderer to hold a stale copy in memory between saves.

Embedding as base64 in the main project JSON (not a separate sidecar) was the explicit
trade-off Elling chose: simplest to reason about, no orphan-file risk, at the cost of the
project file growing by however much a given plugin's own state actually is (typically small —
a few KB — for parameter-only plugins; potentially larger for sample/preset-heavy synths, which
is an accepted trade-off, not treated as a size limit to enforce).

### 2. Capture flow (Save-time only)

A new request/response round trip, parallel to existing patterns in `IpcServer.cpp` (native)
and `engineClient.ts`/`engineProcess.ts` (main process) for the engine's other query-style
messages (e.g. how position/capture-level updates already flow engine→main→renderer, just
synchronous-request-shaped instead of a push stream):

1. Renderer's `handleSave()` (in `App.tsx`'s `Frame`, already the single place all explicit-save
   codepaths funnel through per the explicit-save-model work) gains a new step: before calling
   `serializeProject(state)`, request current plugin states from main via a new IPC channel
   (e.g. `get-plugin-states`).
2. Main forwards this to the engine subprocess over the existing local-socket connection
   (`engineClient.ts`).
3. The engine (`IpcServer.cpp`, new handler) iterates every currently-loaded plugin slot in both
   the master `PluginChain` and every channel's `PluginChain`, calling `getStateInformation()`
   on each live `juce::AudioProcessor`, base64-encoding the resulting `juce::MemoryBlock`, and
   replies with the full `pluginId`-keyed map described in §1.
4. `handleSave()` merges that map into the JSON object it's about to write, in the `pluginStates`
   field, then proceeds with the existing `saveProjectToLibrary`/`saveProjectInPlace` write.

**Failure handling** (per Elling's explicit choice): if the engine round trip fails or times out
— a hung plugin, a crashed engine subprocess, a malformed reply — `handleSave()` treats this the
same as any other save failure per the explicit-save-model work already shipped this session:
it does **not** proceed to write the project file, logs the error, and reports failure back to
whichever caller invoked it (the Save button, Cmd+S, the quit-time round trip, or the
discard-guard's "save" branch), consistent with `handleSave`'s existing `Promise<boolean>`
contract. The user sees the same "Save failed" alert path already in place — nothing silently
saves an incomplete project.

### 3. Restore flow (project open, engine restart, crash-recovery)

Every existing plugin-load path already funnels through `PluginChain::requestLoad()`/
`loadPluginSync()`, triggered by `IpcServer.cpp`'s `load-master-plugin`/`load-channel-plugin`
handlers (themselves fired by `StoreContext.tsx` diffing `state.masterChain`/
`state.channelPlugins` against a previous-value ref — this diffing/triggering mechanism is
unchanged by this design). This design adds one step to the END of that existing instantiation,
still inside `PluginChain`, before the newly-created processor becomes the chain's live one:

- If the just-opened project's `pluginStates` has an entry for this slot, AND that entry's
  `pluginId` matches the `pluginId` actually being loaded into this slot right now, call
  `setStateInformation()` with the decoded blob.
- Otherwise (no saved entry for this slot, or a mismatched `pluginId` — e.g. the project file
  was hand-edited, or a different plugin now occupies a slot number that used to hold something
  else), skip silently and let the fresh instance keep its own default state, exactly as today.
  This is not treated as an error case — a slot with nothing to restore is the expected, normal
  case for any newly-added plugin.

This makes restoration synchronous with load, exactly like plugin identity restoration already
is today — no new trigger, no waiting on an editor window to open, no separate user action.

**Real-time/audio-thread safety** (implementation detail, not a design decision requiring
Elling's input, but worth flagging for whoever writes the plan): JUCE's `setStateInformation()`
is not documented as safe to call while a processor is concurrently being pulled by the audio
thread. Because this call is inserted at the same point `requestLoad()`/`loadPluginSync()`
already perform their own instantiate-then-swap-in critical section (the new processor isn't
"live" in the chain's processing graph until that swap completes), this should already be a
safe insertion point — but the plan/implementation should explicitly confirm this against
`PluginChain.cpp`'s actual current locking/swap discipline rather than assume it, given this
project's own documented history of real threading bugs in exactly this class of code (see
`native-engine/PHASE0_FINDINGS.md` and the `LiveDrag` "Native ProjectSnapshot hardening"
work referenced in this repo's git history).

### 4. Wire-format changes (the flagged high-risk boundary)

Both halves of the already-flagged "hand-synced pair, not code-shared" boundary need extending,
carefully and in lockstep, per this project's own root `CLAUDE.md` warning:

- **`EngineProject.h`/`.cpp`** (native, C++): `MasterChainSlot` (and its per-channel-slot
  analog) gains an optional `stateBase64` field (or equivalent — exact shape for the plan to
  pin down) alongside the existing `pluginId`/`path`. `parseEngineProject` needs a matching
  read path.
- **`buildEngineProject.ts`** (TypeScript): the corresponding serialization gains a matching
  optional field, sourced from the save-time-only `pluginStates` map (§1) rather than from
  `AppState` directly, since — unlike every other field this function serializes — plugin state
  isn't reducer-tracked.
- **New engine-side methods** in `PluginChain.cpp`: a state-capture method (§2, called by the
  new `get-plugin-states` IPC handler) and the `setStateInformation`-applying step folded into
  the existing load path (§3).

No other part of the wire format changes. `masterChain`/`channelPlugins` (identity) and this new
`pluginStates` (parameter state) stay conceptually separate fields serving different purposes —
identity is reducer-tracked and always current; state is a save-time snapshot.

## Testing

- `PluginChain`'s new capture/apply methods are real-time-audio-adjacent C++ — this project's
  own convention (per root `CLAUDE.md`) is that some native functionality is verified via JUCE's
  `UnitTestRunner` (`--test` flag) where feasible, and via manual walkthrough where it genuinely
  requires a real plugin binary and real audio hardware. A base64 round-trip (encode a known
  `MemoryBlock`, decode it, confirm equality) is unit-testable without a real plugin; actually
  hosting a real VST3/AU and confirming its own parameters survive a save/reload cycle is not,
  and should be called out explicitly in the plan's manual-walkthrough checklist rather than
  faked with a mock processor that trivially always returns/accepts the same bytes.
- `buildEngineProject.ts`'s new field follows this project's existing TDD convention for
  `src/shared`/serialization logic — a real test, not a mock, covering the JSON shape with and
  without a `pluginStates` entry present.
- The `get-plugin-states` IPC round trip and `handleSave()`'s new failure path are integration
  points between real Electron/native-process code — per this project's established convention,
  covered by typecheck/lint plus a manual walkthrough (save a project with a plugin loaded and
  tweaked, reopen it, confirm the knob position survived; separately, simulate an engine
  failure — e.g. force-quit the engine subprocess mid-save if that's reproducible — and confirm
  Save reports failure rather than silently succeeding).

## Future work (explicitly out of scope now)

- Live/continuous state syncing (e.g. for a future "undo plugin parameter changes" feature) —
  would need a fundamentally different capture trigger than "only on Save."
- Any UI indicator distinguishing "this plugin's state will be saved" from "this plugin doesn't
  support state save" (some third-party plugins have known-incomplete `getStateInformation`
  implementations) — not surfaced to the user in this pass; a plugin that silently returns an
  empty/useless state block is treated the same as one with no state to save.
