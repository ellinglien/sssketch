# Channel Plugin Inserts — Design

**Goal:** Add a 2-slot in-series VST3 insert chain per arranger channel (DAW mode's row concept), processing live during playback, reusing the master chain's proven real-time-safe load/swap and native editor-window machinery, and the already-scanned plugin catalog + favourites system.

**History this builds on:** This session already shipped a 4-slot master output chain (`docs/superpowers/specs/2026-07-31-master-plugin-chain-design.md`) and a subprocess-isolated plugin scan + favourites system (`docs/superpowers/specs/2026-07-31-plugin-scan-favourites-design.md`). Both are reused here largely unchanged — the catalog itself is universal, and the master chain's `MasterChain` class already solved real-time-safe plugin load/swap and native editor windows. What's genuinely new is a per-channel accumulation stage in the native engine, since the engine currently has no channel concept at all (confirmed by reading `PlaybackEngine.cpp`'s `renderBlock`: every stem sums directly into the final `outL`/`outR`, with no per-channel buffer anywhere).

**Not in scope for this pass** (explicitly deferred, not forgotten):
- More than 2 slots per channel.
- Per-stem inserts (still channel-level only, matching the arranger's own channel-is-the-organizational-unit model).
- Preserving a channel's plugin assignment across it becoming empty — explicitly decided: delete immediately (see "Channel lifecycle" below).
- Renaming, reordering, or otherwise managing channels beyond what DAW mode already does.
- AU support (VST3 only, matching the master chain and scan feature's existing scope).

---

## Architecture

### Channel identity and lifecycle

A channel is not an independently persisted entity — confirmed by reading `store.ts`: a channel ID only exists as long as some clip's `channelOf` points at it (`channelHasAnyClip`), and is filtered out of `channelOrder` the moment the last clip leaves it (already implemented in `REMOVE_FROM_TIMELINE`, `DELETE_RIFFFS`, and `MOVE_TO_CHANNEL`'s existing cleanup). Per-channel plugin state follows the same rule: `AppState.channelPlugins: Record<string, [string | null, string | null]>` gets its entry for a channel ID deleted in the exact same reducer cases that already delete that channel from `channelOrder` — one shared cleanup path, not a second parallel one that could drift out of sync.

### Native class shape: `MasterChain` → `PluginChain`

`MasterChain` is already a generic "N-slot in-series plugin chain with real-time-safe load/swap and native editor windows" class in substance — it just happens to be named and sized for its first use (a fixed 4 slots for the master bus). Renamed to `PluginChain`, and its internal `std::array<Slot, kNumMasterChainSlots>` becomes a `std::vector<Slot>` sized at construction (`explicit PluginChain(int numSlots, Instantiator = &PluginChain::defaultInstantiate)`), so the engine can own one 4-slot instance for the master bus (unchanged behavior) and many independent 2-slot instances for channels, without templating or duplicating the class.

### New per-channel accumulation stage

`PlaybackEngine::renderBlock` currently loops rifff-by-rifff, stem-by-stem, writing gain-adjusted samples directly into `outL[i2] += ...`. This changes to: at `setProject` time (not per-block — this is precomputed once, not recomputed every audio callback), group `currentProject.rifffs` by their new `channelId` field into a `std::map<juce::String, std::vector<const EngineRifff*>>`. Inside `renderBlock`, for each channel: accumulate that channel's stems into a per-channel scratch buffer (the existing per-stem-per-tile sample math is unchanged, just redirected to write into this buffer instead of `outL`/`outR` directly), run the channel's `PluginChain::process()` on it, then add the result into the running `outL`/`outR` total — which afterward still passes through the unchanged master chain, same as today. A channel with no plugins loaded is a pure passthrough (its buffer's contribution is identical to today's direct-sum behavior), so an arrangement with zero channel plugins in use behaves byte-identically to before this feature existed.

### Real-time safety: the actual new risk here

The master chain's 4 slots are fixed-size and never resize — only their *contents* swap, via one atomic pointer per slot (`Slot::pending`/`pendingReady`). Channels are dynamic: a live collection of channel `PluginChain` instances being resized on the message thread while the audio thread iterates it every block is a genuine, new crash risk this feature introduces that the master chain never had.

**Fix:** a new `ChannelChainRegistry` class owns `std::atomic<const ChannelChainMap*> published` (`ChannelChainMap = std::unordered_map<juce::String, std::unique_ptr<PluginChain>>`). Whenever `load-project` changes the channel set (message thread only), the registry builds a **complete new map** — reusing the existing `PluginChain` instance (and whatever it has loaded) for any channel ID that's still present, constructing a fresh 2-slot instance only for genuinely new channel IDs — then publishes it via a single atomic pointer exchange, and hands the *old* map to a background thread for deletion (mirroring exactly how an individual plugin instance's own old pointer is already handed off in `MasterChain::applyPendingSwaps`). The audio thread reads the published pointer once per block (`published.load()`) and iterates that snapshot for the whole block; it never sees a map mid-mutation, because a mutation never happens in place — only a wholesale swap to a different, fully-built map. This is the same residual risk already accepted by the master chain's own per-slot atomic swap (a vanishingly narrow window between reading a pointer and a background thread freeing what it used to point to), not a new category of risk — just the same proven pattern applied one level up, to a whole collection instead of one instance.

### Export parity

`RenderExport.cpp` gets the same per-channel accumulation stage, loading each channel's plugins synchronously (mirroring the master chain's own export-time synchronous load) before rendering — no `ChannelChainRegistry` needed there, since export builds one throwaway `PluginChain` per channel directly, same as it already does for the master chain today.

---

## Data model

### Resolving a rifff's channel ID

`buildEngineProject.ts` sets each `EngineRifff.channelId` using the exact same fallback `selectors.ts`'s `channelsInOrder` already uses: `state.channelOf[rifff.groupId] ?? rifff.groupId` — a placed rifff with no explicit `channelOf` entry (e.g. an old save from before DAW mode) implicitly owns its own solo channel, named after its own groupId, matching how it already renders on its own row today.

### Wire protocol

```cpp
// EngineProject.h
struct EngineRifff {
    juce::String groupId;
    juce::String channelId; // NEW — which channel this rifff's clip is on
    // ... existing fields unchanged
};

struct EngineChannelChain {
    juce::String channelId;
    std::array<MasterChainSlot, kNumChannelChainSlots> slots; // kNumChannelChainSlots = 2
};

struct EngineProject {
    // ... existing fields unchanged
    std::vector<EngineChannelChain> channelChains; // only channels with at least one non-empty slot need an entry; an absent channelId is treated as "no plugins", identical to an entry with two empty slots
};
```

### Renderer state

```ts
// store.ts
channelPlugins: Record<string, [string | null, string | null]>
```
Reducer cleanup: added to the exact same code paths that already delete a channel from `channelOrder` (`REMOVE_FROM_TIMELINE`, `DELETE_RIFFFS`, `MOVE_TO_CHANNEL`'s previous-channel cleanup) — deleting `channelPlugins[channelId]` alongside filtering `channelOrder`, not a separate pass. No migration needed for old saves (a channel ID missing from `channelPlugins` is just "no plugins on this channel," the correct default).

`buildEngineProject.ts` resolves each `channelPlugins` entry's ids to real paths via the plugin catalog, exactly like `masterChain` already does — same `{pluginId, path}` resolution logic, just looped per channel instead of over 4 fixed slots.

---

## UI

Each `ChannelRow` gets a small "chain" button (same visual treatment as the master chain panel's own toggle button) opening a 2-slot version of `MasterChainPanel` scoped to that one channel — same favourites-filtered dropdown, scan button (shared, not per-channel — one catalog for the whole app), status dots, and "edit" buttons wired to per-channel editor-window IPC messages (`open-channel-plugin-editor` with a `channelId` + `slot`, mirroring `open-master-plugin-editor`'s `slot`-only shape).

---

## Error handling

Same conventions already established by the master chain and scan features: a failed plugin load surfaces as a status dot + error tooltip on that specific channel/slot and never crashes the engine; a channel that's deleted (last clip removed) while its `PluginChain` still has a plugin loaded just gets that instance cleaned up via the registry's normal old-map background-deletion path, no special-case teardown needed; a channel referenced in a save file whose plugins are no longer in the catalog behaves like the master chain's own "not found" case (empty path, passthrough).

---

## Testing

- **Native:** `PluginChain`'s existing test suite (from the master chain build) continues to cover the shared load/swap/process logic unchanged, just now also exercised via a 2-slot construction. New tests for `ChannelChainRegistry`: `updateChannelSet` reuses an existing chain for a still-present channel ID (proven by asserting the *same* loaded plugin instance survives, not just an equivalent one), creates a new chain for a new ID, and old chains for removed IDs get cleaned up without the audio thread ever observing a torn/partial map (a concurrent-access test similar in spirit to `MasterChain`'s own real-time-safety tests, exercising `published.load()` from a second thread while `updateChannelSet` runs repeatedly).
- **Renderer:** reducer tests confirming `channelPlugins` cleanup fires in lockstep with `channelOrder`'s own cleanup across all three affected actions.
- **Manual, end-to-end (required — not automatable):** load a plugin onto a channel, confirm it's audible during live playback and export; remove the last clip from that channel, confirm the plugin's status/UI disappears and doesn't reappear if a brand new clip later lands on a freshly-generated channel ID; open a channel plugin's editor window, confirm it behaves like the master chain's own (already proven this session against a real installed plugin).
