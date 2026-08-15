# Plugin Playhead Position Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let hosted VST3/AU plugins (master chain + per-channel chains) know real transport bar/beat position (PPQ), not just tempo — so a tempo-synced delay, arpeggiator, gated effect, or synced LFO can actually lock onto the beat.

**Architecture:** Extend `PluginChain`'s existing private `BpmPlayHead` (already reports live BPM to every hosted plugin) with a second atomic, `positionBars`, converted to PPQ (`positionBars * 4.0`, fixed 4-beats-per-bar) inside `getPosition()`. Add `PluginChain::setPosition(double)` and `ChannelChainRegistry::setPosition(double)`, mirroring their existing `setBpm` methods exactly (same lock-free atomic-store pattern, same "remember for a chain created later" behavior). Push position from the two real call sites that already compute it: `Transport.cpp`'s two `masterChain.process()` call sites (for the master chain), and a single new call inside `PlaybackEngine::renderBlock()` (for every channel chain at once, since `renderBlock` is already shared by both live playback and offline export — confirmed by reading its own doc comment).

**Tech Stack:** C++/JUCE (native-engine only — this feature touches no TypeScript/renderer code).

---

## Read before starting

- `docs/superpowers/specs/2026-08-15-plugin-playhead-position-sync-design.md` — the approved design this plan implements.
- Root `CLAUDE.md`'s native-engine rebuild instructions — after every native-engine change in this plan, rebuild (`cmake --build build` from `native-engine/`) and **fully quit and relaunch** the Electron app before manually testing. A renderer reload is not enough.

## Working directly on master, no worktree

Matches this session's established convention for every prior task tonight, including native work of comparable and greater scope.

## Note on task ordering

Unlike some earlier native plans this session, this feature's tasks are purely *additive* at each step (new methods, then new call sites that use them) — there is no point where an earlier task's removal breaks a not-yet-updated caller. Each task should leave the tree in a buildable, testable state on its own. Still verify this for real at the end of each task rather than assuming it.

---

### Task 1: `PluginChain` — `positionBars` atomic + `setPosition()`, native test

**Files:**
- Modify: `native-engine/Source/PluginChain.h`
- Modify: `native-engine/Source/PluginChain.cpp`
- Modify: `native-engine/Source/PluginChainTests.cpp`

- [ ] **Step 1: Add `setPosition()`'s public declaration to `PluginChain.h`**

In `native-engine/Source/PluginChain.h`, right after the existing `setBpm` method's declaration:

```cpp
        /** Any thread: updates the project tempo every plugin in this chain
         * sees via its own AudioPlayHead::getPosition() query — e.g. a
         * tempo-synced delay's note-division times, or a modulation effect's
         * synced rate. BPM-only: this does NOT track real transport position
         * or play/pause state (isPlaying is reported unconditionally true,
         * since process() is only ever called while audio is actually being
         * rendered, live or export) — see the design spec's "tempo input"
         * addendum for why that scope was chosen over full playhead sync. */
        void setBpm(double bpm);
```

add:

```cpp
        /** Any thread: updates the transport position every plugin in this
         * chain sees via its own AudioPlayHead::getPosition() query, so a
         * tempo-synced delay/arpeggiator/gated effect/synced LFO can lock
         * onto the beat, not just match tempo (see setBpm just above -- this
         * is the position half of that same playhead). Time-signature-
         * agnostic: always reports PPQ as positionBars * 4.0 (a fixed
         * 4-beats-per-bar assumption) -- this app doesn't track a real time
         * signature today, and most plugins default sensibly to 4/4 without
         * one; per the design spec's own explicit decision to skip time
         * signature for this feature. Same real-time-safety story as
         * setBpm: a plain lock-free atomic store, safe to call from the
         * audio thread (and in practice always IS called from there, once
         * per renderBlock -- see PlaybackEngine::renderBlock and
         * Transport.cpp's own call sites). */
        void setPosition(double positionBars);
```

- [ ] **Step 2: Extend `BpmPlayHead` with the `positionBars` atomic**

Still in `PluginChain.h`, replace the private `BpmPlayHead` class:

```cpp
        class BpmPlayHead : public juce::AudioPlayHead
        {
        public:
            void setBpm(double newBpm) { bpm.store(newBpm); }

            juce::Optional<PositionInfo> getPosition() const override
            {
                PositionInfo info;
                info.setBpm(bpm.load());
                info.setIsPlaying(true);
                return info;
            }

        private:
            std::atomic<double> bpm { 120.0 };
        };
```

with:

```cpp
        class BpmPlayHead : public juce::AudioPlayHead
        {
        public:
            void setBpm(double newBpm) { bpm.store(newBpm); }
            void setPosition(double newPositionBars) { positionBars.store(newPositionBars); }

            juce::Optional<PositionInfo> getPosition() const override
            {
                PositionInfo info;
                info.setBpm(bpm.load());
                info.setIsPlaying(true);
                info.setPpqPosition(positionBars.load() * 4.0);
                return info;
            }

        private:
            std::atomic<double> bpm { 120.0 };
            std::atomic<double> positionBars { 0.0 };
        };
```

- [ ] **Step 3: Implement `PluginChain::setPosition()` in `PluginChain.cpp`**

In `native-engine/Source/PluginChain.cpp`, right after:

```cpp
    void PluginChain::setBpm(double bpm) { playHead.setBpm(bpm); }
```

add:

```cpp
    void PluginChain::setPosition(double positionBars) { playHead.setPosition(positionBars); }
```

- [ ] **Step 4: Extend `BpmCapturingTestPlugin` to also capture PPQ, and add a position round-trip test**

In `native-engine/Source/PluginChainTests.cpp`, replace `BpmCapturingTestPlugin`'s `processBlock` method:

```cpp
            void processBlock(juce::AudioBuffer<float>&, juce::MidiBuffer&) override
            {
                auto* ph = getPlayHead();
                if (ph == nullptr)
                    return;
                auto position = ph->getPosition();
                if (position.hasValue() && position->getBpm().hasValue())
                    lastSeenBpm = *position->getBpm();
            }
```

with:

```cpp
            void processBlock(juce::AudioBuffer<float>&, juce::MidiBuffer&) override
            {
                auto* ph = getPlayHead();
                if (ph == nullptr)
                    return;
                auto position = ph->getPosition();
                if (position.hasValue() && position->getBpm().hasValue())
                    lastSeenBpm = *position->getBpm();
                if (position.hasValue() && position->getPpqPosition().hasValue())
                    lastSeenPpq = *position->getPpqPosition();
            }
```

Replace the member declaration right after it:

```cpp
            double lastSeenBpm = 0.0;
        };
```

with:

```cpp
            double lastSeenBpm = 0.0;
            double lastSeenPpq = 0.0;
        };
```

Add a new test right after the existing `"setBpm reaches a loaded plugin's own playhead, live on every block"` test block (i.e. right before the `"captureStateBase64 round-trips..."` test):

```cpp
                beginTest("setPosition reaches a loaded plugin's own playhead as PPQ "
                          "(positionBars * 4.0), live on every block");
                {
                    BpmCapturingTestPlugin* raw = nullptr;
                    PluginChain chain(4, bpmCaptureInstantiator(raw));
                    juce::String err;
                    expect(chain.loadPluginSync(0, "any-id", 44100.0, 512, err));
                    expect(raw != nullptr);

                    chain.setPosition(2.5); // 2.5 bars -> 10.0 PPQ (4 beats/bar, this app's fixed assumption)
                    float l[1] = { 0.0f };
                    float r[1] = { 0.0f };
                    chain.process(1, l, r);
                    expectWithinAbsoluteError(raw->lastSeenPpq, 10.0, 0.0001);

                    // Changing position after load must be reflected on the NEXT
                    // process() call too -- queried live each block, not
                    // snapshotted once at load time (same as bpm above).
                    chain.setPosition(1.0);
                    chain.process(1, l, r);
                    expectWithinAbsoluteError(raw->lastSeenPpq, 4.0, 0.0001);
                }
```

- [ ] **Step 5: Rebuild and run the native test suite**

Run:
```bash
cd native-engine && cmake --build build
native-engine/build/sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine --test
```
Expected: no failures, including the new "setPosition reaches a loaded plugin's own playhead as PPQ..." test.

- [ ] **Step 6: Commit**

```bash
git add native-engine/Source/PluginChain.h native-engine/Source/PluginChain.cpp native-engine/Source/PluginChainTests.cpp
git commit -m "$(cat <<'EOF'
PluginChain: add setPosition(), extend BpmPlayHead to report PPQ

Mirrors the existing setBpm/bpm atomic exactly (same lock-free store,
same any-thread contract). getPosition() now reports PPQ as
positionBars * 4.0 -- a fixed 4-beats-per-bar assumption, since this
app has no real time signature concept today (explicitly out of scope
for this feature). Nothing calls setPosition() yet; that's the next
few tasks.
EOF
)"
```

---

### Task 2: `ChannelChainRegistry` — `setPosition()` mirroring `setBpm()`

**Files:**
- Modify: `native-engine/Source/ChannelChainRegistry.h`
- Modify: `native-engine/Source/ChannelChainRegistry.cpp`

- [ ] **Step 1: Add `setPosition()`'s declaration + `currentPositionBars` member to `ChannelChainRegistry.h`**

In `native-engine/Source/ChannelChainRegistry.h`, right after:

```cpp
        /** Message-thread API: forwards the project tempo to every currently
         * published channel's chain (see PluginChain::setBpm), and remembers
         * it so a channel created later by updateChannelSet starts with the
         * current tempo too, instead of defaulting to something stale until
         * the next explicit setBpm call. */
        void setBpm(double bpm);
```

add:

```cpp
        /** Audio-thread API (unlike setBpm just above) -- called once per
         * block from PlaybackEngine::renderBlock (see PluginChain::
         * setPosition's own doc comment for why this is safe there).
         * Forwards the current transport position to every currently
         * published channel's chain, and remembers it so a channel created
         * later by updateChannelSet starts already synced to the current
         * position, instead of defaulting to bar 0 until the next block.
         * Same lock-free load-then-iterate pattern as setBpm. */
        void setPosition(double positionBars);
```

Replace the private `currentBpm` member:

```cpp
    private:
        std::atomic<const ChannelChainMap*> published;
        PluginChain::Instantiator instantiator;
        BridgeClient* bridgeClient;
        std::atomic<double> currentBpm { 120.0 };
    };
```

with:

```cpp
    private:
        std::atomic<const ChannelChainMap*> published;
        PluginChain::Instantiator instantiator;
        BridgeClient* bridgeClient;
        std::atomic<double> currentBpm { 120.0 };
        std::atomic<double> currentPositionBars { 0.0 };
    };
```

- [ ] **Step 2: Implement `setPosition()` in `ChannelChainRegistry.cpp`, and apply it to newly-created chains**

In `native-engine/Source/ChannelChainRegistry.cpp`, in `updateChannelSet`'s "new channel" branch, replace:

```cpp
            else
            {
                (*next)[channelId] = instantiator
                    ? std::make_shared<PluginChain>(kNumChannelChainSlots, instantiator, bridgeClient)
                    : std::make_shared<PluginChain>(kNumChannelChainSlots, &PluginChain::defaultInstantiate, bridgeClient);
                (*next)[channelId]->setBpm(currentBpm.load());
            }
```

with:

```cpp
            else
            {
                (*next)[channelId] = instantiator
                    ? std::make_shared<PluginChain>(kNumChannelChainSlots, instantiator, bridgeClient)
                    : std::make_shared<PluginChain>(kNumChannelChainSlots, &PluginChain::defaultInstantiate, bridgeClient);
                (*next)[channelId]->setBpm(currentBpm.load());
                (*next)[channelId]->setPosition(currentPositionBars.load());
            }
```

Right after the existing `setBpm` implementation:

```cpp
    void ChannelChainRegistry::setBpm(double bpm)
    {
        currentBpm.store(bpm);
        const auto* map = published.load();
        for (auto& [channelId, chain] : *map)
            chain->setBpm(bpm);
    }
```

add:

```cpp
    void ChannelChainRegistry::setPosition(double positionBars)
    {
        currentPositionBars.store(positionBars);
        const auto* map = published.load();
        for (auto& [channelId, chain] : *map)
            chain->setPosition(positionBars);
    }
```

- [ ] **Step 3: Rebuild and run the native test suite**

Run:
```bash
cd native-engine && cmake --build build
native-engine/build/sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine --test
```
Expected: no failures (no new automated coverage for `ChannelChainRegistry` itself in this task — it has no existing dedicated test file for this kind of broadcast method per a quick check of the test suite's file list; this step just confirms nothing broke). If you find an existing `ChannelChainRegistryTests.cpp`, mirror whatever pattern its own `setBpm` test (if one exists) already uses for a `setPosition` test; if none exists for `setBpm` either, don't add one here — stay consistent with existing coverage rather than introducing an inconsistent one-off.

- [ ] **Step 4: Commit**

```bash
git add native-engine/Source/ChannelChainRegistry.h native-engine/Source/ChannelChainRegistry.cpp
git commit -m "$(cat <<'EOF'
ChannelChainRegistry: add setPosition(), mirroring setBpm exactly

Same lock-free load-then-iterate broadcast pattern as setBpm, same
"remember for a channel created later" behavior via a new
currentPositionBars atomic. Unlike setBpm (message-thread, called on
an explicit tempo change), this is an audio-thread API -- called once
per block from PlaybackEngine::renderBlock, added in a later task.
Nothing calls it yet.
EOF
)"
```

---

### Task 3: `Transport.cpp` — push master-chain position at both real call sites

**Files:**
- Modify: `native-engine/Source/Transport.cpp`

There are exactly two `masterChain.process(numSamples, outL, outR);` call sites in this file (confirmed by reading the current file in full) — one inside the `repositioning` branch, one in the main (normal-playback/halt-fade-shared) path. Both already have the exact position (`pos`) they're about to render already loaded into a local variable right above.

- [ ] **Step 1: Add `masterChain.setPosition(pos)` in the `repositioning` branch**

Replace:

```cpp
        if (repositioning)
        {
            const double pos = positionBars.load();
            const double newPos = renderLoopAware(pos, numSamples, outL, outR);
            masterChain.process(numSamples, outL, outR);
```

with:

```cpp
        if (repositioning)
        {
            const double pos = positionBars.load();
            const double newPos = renderLoopAware(pos, numSamples, outL, outR);
            masterChain.setPosition(pos);
            masterChain.process(numSamples, outL, outR);
```

- [ ] **Step 2: Add `masterChain.setPosition(pos)` in the main path**

Replace:

```cpp
        const double pos = positionBars.load();
        const double newPos = renderLoopAware(pos, numSamples, outL, outR);
        masterChain.process(numSamples, outL, outR);
```

with:

```cpp
        const double pos = positionBars.load();
        const double newPos = renderLoopAware(pos, numSamples, outL, outR);
        masterChain.setPosition(pos);
        masterChain.process(numSamples, outL, outR);
```

(This exact 3-line snippet appears only once in the file — the `repositioning` branch's version, edited in Step 1, has different surrounding lines (`if (repositioning)` and the `const double pos = positionBars.load();` inside that block) even though the middle line is textually identical; edit each occurrence in its own surrounding context, not via a blind global replace-all.)

Note: channel-chain position (every `engine.renderBlock(...)` call inside `renderLoopAware`, several call sites) needs NO changes in this file — that's handled once, centrally, inside `PlaybackEngine::renderBlock()` itself in Task 5, which every one of those call sites already goes through.

- [ ] **Step 3: Rebuild and run the native test suite**

Run:
```bash
cd native-engine && cmake --build build
native-engine/build/sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine --test
```
Expected: no failures (`Transport.cpp` has no dedicated unit tests exercising `audioDeviceIOCallbackWithContext` directly against a real device per this codebase's own established convention — this step just confirms the build still compiles and nothing else regressed).

- [ ] **Step 4: Commit**

```bash
git add native-engine/Source/Transport.cpp
git commit -m "$(cat <<'EOF'
Transport: push master-chain playhead position every block

masterChain.setPosition(pos) right before both real
masterChain.process() call sites (repositioning branch, main path),
using the same pos value already loaded for renderLoopAware -- so a
hosted master-chain plugin can now query real bar/beat position, not
just tempo. Channel-chain position is unaffected here (handled
centrally in PlaybackEngine::renderBlock, a later task) since every
engine.renderBlock() call in this file already funnels through it.
EOF
)"
```

---

### Task 4: `RenderExport.cpp` — push master-chain position for offline export

**Files:**
- Modify: `native-engine/Source/RenderExport.cpp`

- [ ] **Step 1: Add `masterChain.setPosition(positionBars)` before its `process()` call**

Replace:

```cpp
        for (int startSample = 0; startSample < totalSamples; startSample += blockSize)
        {
            const int numSamples = juce::jmin(blockSize, totalSamples - startSample);
            const double positionBars = (startSample / sampleRate) / secPerBar;
            auto* l = output.getWritePointer(0, startSample);
            auto* r = output.getWritePointer(1, startSample);
            engine.renderBlock(positionBars, sampleRate, numSamples, l, r, channelChainRegistry);
            masterChain.process(numSamples, l, r);
        }
```

with:

```cpp
        for (int startSample = 0; startSample < totalSamples; startSample += blockSize)
        {
            const int numSamples = juce::jmin(blockSize, totalSamples - startSample);
            const double positionBars = (startSample / sampleRate) / secPerBar;
            auto* l = output.getWritePointer(0, startSample);
            auto* r = output.getWritePointer(1, startSample);
            engine.renderBlock(positionBars, sampleRate, numSamples, l, r, channelChainRegistry);
            masterChain.setPosition(positionBars);
            masterChain.process(numSamples, l, r);
        }
```

(Channel-chain position for this same loop is handled automatically once Task 5 lands, since `engine.renderBlock(...)` right above already funnels through `PlaybackEngine::renderBlock()`.)

- [ ] **Step 2: Rebuild and run the native test suite**

Run:
```bash
cd native-engine && cmake --build build
native-engine/build/sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine --test
```
Expected: no failures.

- [ ] **Step 3: Commit**

```bash
git add native-engine/Source/RenderExport.cpp
git commit -m "$(cat <<'EOF'
RenderExport: push master-chain playhead position for offline export

Mirrors Transport.cpp's live-playback change -- a synced master-chain
plugin now hears correct position during a mixdown export too, not
just live playback.
EOF
)"
```

---

### Task 5: `PlaybackEngine::renderBlock` — push channel-chain position once, centrally

**Files:**
- Modify: `native-engine/Source/PlaybackEngine.cpp`

This single call covers every channel-chain position update this feature needs — both live playback (`Transport.cpp`'s several `engine.renderBlock(...)` call sites inside `renderLoopAware`) and offline export (`RenderExport.cpp`'s own `engine.renderBlock(...)` call), since both already share this one function (confirmed via `PlaybackEngine.h`'s own doc comment on `renderBlock`).

- [ ] **Step 1: Add `channelChains.setPosition(positionBars)` right after the early-return null check**

In `native-engine/Source/PlaybackEngine.cpp`, replace:

```cpp
        const auto snap = std::atomic_load_explicit(&published, std::memory_order_acquire);
        if (snap == nullptr)
            return;

        // Single, genuinely lock-free check -- see hasAnyOverride()'s own
```

with:

```cpp
        const auto snap = std::atomic_load_explicit(&published, std::memory_order_acquire);
        if (snap == nullptr)
            return;

        // Pushed once per renderBlock call, covering every channel chain at
        // once -- both live playback (Transport.cpp's several
        // engine.renderBlock() call sites inside renderLoopAware, e.g. a
        // loop-wrap split render) and offline export (RenderExport.cpp's
        // own call) already funnel through this one function, so this is
        // the single place a hosted channel-chain plugin's playhead
        // position needs to be kept in sync -- see
        // ChannelChainRegistry::setPosition's own doc comment for why it's
        // safe to call this from a real-time thread every block.
        channelChains.setPosition(positionBars);

        // Single, genuinely lock-free check -- see hasAnyOverride()'s own
```

- [ ] **Step 2: Rebuild and run the native test suite**

Run:
```bash
cd native-engine && cmake --build build
native-engine/build/sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine --test
```
Expected: no failures, including the existing `PlaybackEngineTests.cpp` suite (its own concurrent setProject()/renderBlock() stress test and parity tests should be unaffected — this is an additive, cheap atomic-store call).

- [ ] **Step 3: Commit**

```bash
git add native-engine/Source/PlaybackEngine.cpp
git commit -m "$(cat <<'EOF'
PlaybackEngine: push channel-chain playhead position once, centrally

channelChains.setPosition(positionBars) right after renderBlock's own
early-return null check -- covers every channel-chain plugin's
position sync for BOTH live playback and offline export in one place,
since both already share this one function. Completes the playhead
position sync feature: master chain gets position from Transport.cpp/
RenderExport.cpp directly (previous two tasks), channel chains get it
from here.
EOF
)"
```

---

### Task 6: Full verification + manual walkthrough

**Files:** none (verification only)

- [ ] **Step 1: Full native rebuild + test suite**

Run:
```bash
cd native-engine && cmake --build build
native-engine/build/sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine --test
```
Expected: no failures, including both new tests from Task 1 (`"setBpm reaches..."` unchanged, `"setPosition reaches a loaded plugin's own playhead as PPQ..."` new).

- [ ] **Step 2: Full TypeScript typecheck, lint, and test suite (nothing in this plan touches TS, but confirm the tree is still whole)**

Run:
```bash
npm run typecheck
npm run lint
npx vitest run
```
Expected: no errors, no new failures — this feature is native-only, so these should be identical to their state before this plan started.

- [ ] **Step 3: Manual walkthrough — flag explicitly, don't claim it was done**

Per root `CLAUDE.md`'s Testing conventions, real synced-plugin behavior can't be automated. Before this ships, a human needs to, after a full rebuild + **fully quitting and relaunching** the Electron app (a renderer reload alone will NOT pick up these native-engine changes):

1. Load a genuinely tempo/position-synced plugin (a synced delay, arpeggiator, gated effect, or synced LFO/tremolo — something whose sound audibly depends on WHERE in the bar playback is, not just tempo) onto either the master chain or a channel chain.
2. Press play from bar 0 and confirm the synced effect lands on the beat immediately, rather than starting mid-phase.
3. Seek/scrub to a new position mid-playback (e.g. double-click a clip, drag the ruler) and confirm the synced effect re-locks to the new position rather than continuing to run from wherever it happened to be.
4. If practical, export a mixdown containing the same synced plugin and confirm the offline export sounds phase-locked the same way live playback does (this exercises `RenderExport.cpp`'s side of this feature, which live playback alone doesn't cover).
5. Confirm no audible glitch/dropout was introduced by this feature's added per-block atomic stores — play for at least 30-60 continuous seconds with a plugin loaded on both a channel and the master chain.

Say so explicitly in any completion report — this needs a real synced plugin and cannot be completed by an implementer subagent solo.

- [ ] **Step 4: Commit (only if Steps 1-2 required any fixes not already committed)**

```bash
git add -A
git commit -m "$(cat <<'EOF'
Fix verification issues found in full-suite run
EOF
)"
```
