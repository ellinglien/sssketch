# Plugin Playhead Position Sync — Design

**Status:** Approved by Elling, ready for implementation planning.

## Goal

Let hosted VST3/AU plugins (master chain + per-channel chains) actually lock onto the beat — not just match the project's tempo (rate), but know *where in the bar* playback currently is (phase). A tempo-synced delay, arpeggiator, gated effect, or synced LFO needs both to behave correctly; today it only gets the first.

## Background

Investigated the current state in full before designing anything. Hosted plugins already receive real, live-updating BPM via `PluginChain`'s private `BpmPlayHead` (a `juce::AudioPlayHead` implementation, one shared instance per chain) — this was built deliberately in an earlier session (commit `f4112c0`) and is explicitly scoped as "BPM-only" in its own doc comment: *"this does NOT track real transport position or play/pause state... see the design spec's 'tempo input' addendum for why that scope was chosen over full playhead sync."* `isPlaying` is hardcoded `true` in `getPosition()`, justified by the fact that a hosted plugin's `processBlock()` (which is what triggers a `getPosition()` query) is only ever called while audio is genuinely being rendered, live or export — so that hardcoding is already correct for what it claims, not a bug.

What's genuinely missing: real bar/beat/PPQ position. No code path anywhere in `native-engine/Source/` ever calls `PositionInfo::setPpqPosition` or equivalent — grepped the whole plugin-hosting surface to confirm. `Transport` already tracks real position internally (`std::atomic<double> positionBars`, read/written every block in the real-time audio callback) — it's just never shared with the playhead object plugins query.

## Scope decision: position only, not play/stop state or time signature

Two things Elling explicitly confirmed are out of scope:
- **Time signature**: skipped. This app doesn't track time signature as a real project setting today; inventing one from scratch for this feature alone isn't worth it, and most plugins default sensibly to 4/4 without it.
- **Real play/pause state**: not needed as a *separate* change. The existing `isPlaying = true` hardcoding is already correct for the "on beat" goal — a plugin only ever gets a `processBlock()` call (and therefore only ever queries the playhead) while it's genuinely being rendered, so there's no case where a plugin would see `isPlaying=true` while actually silent. This isn't being touched.

So the entire scope of this feature is: **plumb real position into the same playhead that already plumbs real BPM.**

## Design

Extend `PluginChain`'s private `BpmPlayHead` with a second atomic, `positionBars`, alongside the existing `bpm` atomic — same lock-free pattern (`std::atomic<double>`, no locks), since `getPosition()` is called from inside a hosted plugin's `processBlock()`, potentially the audio thread. Add `PluginChain::setPosition(double positionBars)` (any-thread API, mirroring the existing `setBpm(double)` exactly) that writes the new atomic. `getPosition()` converts stored bars to PPQ (`positionBars * 4.0`, standard 4-beats-per-bar assumption matching the "skip time signature" decision above) and calls `PositionInfo::setPpqPosition(...)`.

`ChannelChainRegistry` gets the mirrored addition: `setPosition(double positionBars)`, broadcasting to every currently-published channel chain — same shape as its existing `setBpm()` (`ChannelChainRegistry.cpp:60-66`), including the same "also apply to a chain that's created after this point" behavior `setBpm` already has for newly-created channel chains.

**Call sites (two places position needs to be pushed, matching the two places `masterChain.process()`/channel-chain processing already happen):**

1. **Master chain**: `Transport.cpp`'s real-time audio callback already computes `const double pos = positionBars.load()` immediately before each `masterChain.process(numSamples, outL, outR)` call (three call sites in the callback's different playback-state branches — normal playback, loop-wrap, halt-fade). Add `masterChain.setPosition(pos)` right before each `.process()` call, using the `pos` value already in scope. `RenderExport.cpp` does the same thing for its own offline master-chain processing (`positionBars` computed locally at `RenderExport.cpp:84`, `masterChain.process(...)` at line 88) — same one-line addition there.

2. **Channel chains**: both the live callback (`Transport.cpp`) and offline export (`RenderExport.cpp`) already funnel channel-chain processing through the SAME shared `PlaybackEngine::renderBlock(pos, sampleRate, numSamples, outL, outR, channelChains)` function — `renderBlock` already takes `pos` as its first parameter for its own internal mixing math. Push `channelChains.setPosition(pos)` once, inside `renderBlock()` itself, rather than at each of its several call sites — this automatically covers live playback AND offline export in one place, since both already share this function (per `PlaybackEngine.h`'s own doc comment confirming this sharing).

## Real-time safety

Identical pattern to the already-shipped, already-audio-thread-proven BPM mechanism: a plain `std::atomic<double>` written from whatever thread calls `setPosition` (the real-time audio thread itself, in this case — `Transport.cpp`'s callback already runs there) and read lock-free from inside a hosted plugin's `processBlock()`. No new locking, no new risk class — this is a strictly smaller-risk change than the already-shipped BPM sync, since here the writer and the eventual reader are typically the *same* thread (the audio thread calls `setPosition` then immediately calls `process()`, which is what triggers the plugin's `processBlock()`/`getPosition()` query), whereas BPM's writer is a different thread (message-thread IPC) than its reader.

## Testing

Following this codebase's established convention: extend `PluginChainTests.cpp`'s existing `BpmCapturingTestPlugin` (or add a sibling test double) to also record whatever `PositionInfo::getPpqPosition()` reports, and add a JUCE `--test` case proving `setPosition()` reaches a loaded plugin's playhead query on the next `process()` call — same shape as the existing BPM round-trip test (`chain.setBpm(140.0)` → process → assert). Real position-locked plugin behavior (does a real synced delay/arp actually land on the beat) is, per this codebase's own documented convention, a manual-walkthrough item with a real plugin, not fakeable with a test double.

## Non-goals

- Time signature (explicitly skipped per Elling's decision above).
- Real play/pause state as a separate signal (already correct via the existing "only called while rendering" invariant, not touched).
- Loop points, `isRecording`, host name/version, or any other `AudioPlayHead::PositionInfo` field not discussed above.
