# Channel Plugin Inserts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 2-slot in-series VST3 insert chain per arranger channel, processing live during playback and export, reusing the master chain's real-time-safe load/swap and native editor-window machinery.

**Architecture:** Generalize `MasterChain` into a reusable `PluginChain` class (slot count set at construction, not compile-time-fixed at 4). Add a new `ChannelChainRegistry` that owns a dynamically-sized collection of channel `PluginChain` instances, published to the audio thread via a single atomic whole-collection pointer swap whenever the channel set changes (never a live-mutated container the audio thread could observe mid-resize). `PlaybackEngine::renderBlock` gains a new per-channel accumulation stage: each channel's stems sum into their own scratch buffer, that buffer runs through the channel's chain, then joins the running master-mix total.

**Tech Stack:** JUCE 8.0.4 / C++20 (native-engine), Electron/React/TypeScript (renderer + main), Vitest, `juce::UnitTestRunner`.

---

**Full spec:** `docs/superpowers/specs/2026-08-01-channel-plugin-inserts-design.md` — read it before starting; this plan implements it task by task.

**Native build+test command:**
```bash
cd native-engine && cmake --build build && ./build/ssstitch_engine_artefacts/ssstitch-engine.app/Contents/MacOS/ssstitch-engine --test
```

**Renderer/shared/main verification commands:**
```bash
npm run typecheck
npm run lint
npx vitest run
```

**Important note on the "byte-identical" regression test (Task 4):** floating-point addition is associative in exact real-number math but not always bit-exact in IEEE754 — routing a channel's stems through an intermediate scratch buffer before adding into `outL`/`outR` is only guaranteed bit-identical to today's direct accumulation when each channel has exactly one clip on it (today's default, unchanged-visually case per `ChannelRow.tsx`'s own doc comment). A channel with genuinely multiple overlapping clips could differ in the last representable bit due to summation-order reordering — inaudible, not a real regression, but Task 4's regression test is scoped to the one-clip-per-channel case specifically for a legitimately bit-exact assertion, with a code comment explaining why a multi-clip-per-channel case isn't held to the same bar.

---

### Task 1: Rename `MasterChain` → `PluginChain`, generalize slot count

**Files:**
- Rename: `native-engine/Source/MasterChain.h` → `native-engine/Source/PluginChain.h`
- Rename: `native-engine/Source/MasterChain.cpp` → `native-engine/Source/PluginChain.cpp`
- Rename: `native-engine/Source/MasterChainTests.cpp` → `native-engine/Source/PluginChainTests.cpp`
- Modify: `native-engine/CMakeLists.txt`
- Modify: `native-engine/Source/EngineProject.h`
- Modify: `native-engine/Source/Transport.h`, `native-engine/Source/Transport.cpp`
- Modify: `native-engine/Source/IpcServer.h`, `native-engine/Source/IpcServer.cpp`
- Modify: `native-engine/Source/RenderExport.cpp`
- Modify: `native-engine/Source/Main.cpp`

Pure refactor, no new behavior — every existing master-chain test should pass unchanged once call sites are updated. This is entirely mechanical; the risk is only in missing a call site, which the build will catch.

- [ ] **Step 1: Rename the files and the class**

```bash
git mv native-engine/Source/MasterChain.h native-engine/Source/PluginChain.h
git mv native-engine/Source/MasterChain.cpp native-engine/Source/PluginChain.cpp
git mv native-engine/Source/MasterChainTests.cpp native-engine/Source/PluginChainTests.cpp
```

In `PluginChain.h`, replace every `MasterChain` with `PluginChain`, and change the slot storage and constructor:

```cpp
// native-engine/Source/PluginChain.h
#pragma once
#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_gui_basics/juce_gui_basics.h>
#include <atomic>
#include <functional>
#include <memory>
#include <vector>

namespace ssstitch
{
    static constexpr int kNumMasterChainSlots = 4;
    static constexpr int kNumChannelChainSlots = 2;

    /** Owns N live plugin instances (N set at construction), processed IN
     * SERIES over whatever buffer process() is given. Used both for the
     * fixed-4-slot master bus chain and for per-channel 2-slot chains (see
     * ChannelChainRegistry) -- the class itself has no "master" or
     * "channel" semantics baked in, just "an ordered plugin chain." See
     * docs/superpowers/specs/2026-07-31-master-plugin-chain-design.md and
     * docs/superpowers/specs/2026-08-01-channel-plugin-inserts-design.md.
     *
     * Real-time (audio-thread) API: applyPendingSwaps(), process() — called
     * once per block, in that order, from Transport.cpp (live) or
     * RenderExport.cpp (offline, via loadPluginSync() instead of
     * requestLoad() since export has no real-time deadline).
     *
     * Off-thread API: requestLoad() (message thread, hands the actual work
     * to a background thread) and loadPluginSync() (any thread, blocking —
     * export path only, where nothing concurrently reads a slot from an
     * audio callback). */
    class PluginChain
    {
    public:
        using Instantiator = std::function<std::unique_ptr<juce::AudioProcessor>(
            const juce::String& path, double sampleRate, int blockSize, juce::String& errorOut)>;

        explicit PluginChain(int numSlots, Instantiator instantiator = &PluginChain::defaultInstantiate);
        ~PluginChain();

        PluginChain(const PluginChain&) = delete;
        PluginChain& operator=(const PluginChain&) = delete;

        void requestLoad(
            int slotIndex,
            const juce::String& path,
            double sampleRate,
            int blockSize,
            std::function<void(bool success, const juce::String& error)> onLoaded);

        bool loadPluginSync(
            int slotIndex, const juce::String& path, double sampleRate, int blockSize, juce::String& errorOut);

        void applyPendingSwaps();
        void process(int numSamples, float* outL, float* outR);
        bool openEditorWindow(int slotIndex);
        void closeEditorWindow(int slotIndex);

    private:
        static std::unique_ptr<juce::AudioProcessor> defaultInstantiate(
            const juce::String& path, double sampleRate, int blockSize, juce::String& errorOut);

        class EditorWindow : public juce::DocumentWindow
        {
        public:
            EditorWindow(const juce::String& name, juce::AudioProcessorEditor* editor, std::function<void()> onClosed)
                : juce::DocumentWindow(name, juce::Colours::darkgrey, juce::DocumentWindow::closeButton),
                  onClosedCallback(std::move(onClosed))
            {
                setUsingNativeTitleBar(true);
                setContentOwned(editor, true);
                setResizable(editor->isResizable(), false);
                centreWithSize(getWidth(), getHeight());
                setVisible(true);
            }
            void closeButtonPressed() override
            {
                if (onClosedCallback)
                    onClosedCallback();
            }

        private:
            std::function<void()> onClosedCallback;
        };

        struct Slot
        {
            std::unique_ptr<juce::AudioProcessor> active;
            int processChannels = 2;
            std::atomic<juce::AudioProcessor*> pending { nullptr };
            std::atomic<bool> pendingReady { false };
            juce::AudioBuffer<float> scratch;
            std::unique_ptr<EditorWindow> editorWindow;
        };

        std::vector<Slot> slots;
        Instantiator instantiator;
    };
}
```

(Every doc comment above is unchanged in substance from `MasterChain.h`'s own — only the class name, the `Instantiator`'s use as a generic member, and the slot storage/constructor changed. Keep every other doc comment exactly as it was.)

- [ ] **Step 2: Update `PluginChain.cpp`**

Replace every `MasterChain::` with `PluginChain::`. Change the constructor and every `slots[(size_t) slotIndex]`/`kNumMasterChainSlots` bounds check:

```cpp
    PluginChain::PluginChain(int numSlots, Instantiator inst) : slots(numSlots), instantiator(std::move(inst)) {}
```

In `openEditorWindow`/`closeEditorWindow`, replace `slotIndex >= kNumMasterChainSlots` with `slotIndex >= (int) slots.size()`.

Every other line (`applyPendingSwaps`, `process`, `instantiateFromPath`, `defaultInstantiate`, `loadPluginSync`, `requestLoad`) is a mechanical `MasterChain::` → `PluginChain::` rename with no other changes — `slots` is now a `std::vector` instead of `std::array`, but every existing access pattern (`for (auto& slot : slots)`, `slots[(size_t) slotIndex]`) already works identically on both container types.

- [ ] **Step 3: Update `PluginChainTests.cpp`**

Replace every `MasterChain` with `PluginChain`, and every `MasterChain chain(...)` / `MasterChain chain;` construction with an explicit slot count matching what the test needs (the existing tests all exercise a 2-slot-or-fewer chain in substance — pass `4` to keep them exercising the same shape as before, since the specific count isn't what's under test):

```cpp
MasterChainTests -> PluginChainTests  (class name, constructor "PluginChainTests" : juce::UnitTest("PluginChain", "PluginChain"))
MasterChain chain;                              -> PluginChain chain(4);
MasterChain chain(fakeInstantiator({...}));     -> PluginChain chain(4, fakeInstantiator({...}));
```

- [ ] **Step 4: Update every call site**

`native-engine/Source/EngineProject.h`: `#include "MasterChain.h"` → `#include "PluginChain.h"`.

`native-engine/Source/Transport.h`: `#include "MasterChain.h"` → `#include "PluginChain.h"`; `MasterChain& masterChain;` → `PluginChain& masterChain;`; constructor param `MasterChain& masterChain` → `PluginChain& masterChain`.

`native-engine/Source/Transport.cpp`: no `MasterChain` text appears directly (it only references the `masterChain` variable, whose type comes from the header) — no change needed there beyond what the header change already covers.

`native-engine/Source/IpcServer.h`: `#include "MasterChain.h"` → `#include "PluginChain.h"`; every `MasterChain& masterChain` (constructor params and member declarations, in both `IpcConnection` and `IpcServer`) → `PluginChain& masterChain`.

`native-engine/Source/IpcServer.cpp`: no direct `MasterChain` text (same reasoning as Transport.cpp).

`native-engine/Source/RenderExport.cpp`: `#include "MasterChain.h"` → `#include "PluginChain.h"`; `MasterChain masterChain;` (the local instance construction) → `PluginChain masterChain(kNumMasterChainSlots);` (now needs an explicit slot count — this is the master bus, so 4).

`native-engine/Source/Main.cpp`: `MasterChain masterChain;` → `PluginChain masterChain(kNumMasterChainSlots);`.

`native-engine/CMakeLists.txt`: `Source/MasterChain.cpp` / `Source/MasterChainTests.cpp` → `Source/PluginChain.cpp` / `Source/PluginChainTests.cpp` in `target_sources`.

- [ ] **Step 5: Build and run the full native test suite**

```bash
cd native-engine && cmake --build build && ./build/ssstitch_engine_artefacts/ssstitch-engine.app/Contents/MacOS/ssstitch-engine --test
```
Expected: every existing suite passes unchanged, including the renamed `PluginChain` suite (still 3 tests, same assertions).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Rename MasterChain to PluginChain, generalize slot count to a constructor parameter"
```

---

### Task 2: `ChannelChainRegistry` — dynamic channel-chain collection with atomic whole-map swap

**Files:**
- Create: `native-engine/Source/ChannelChainRegistry.h`
- Create: `native-engine/Source/ChannelChainRegistry.cpp`
- Create: `native-engine/Source/ChannelChainRegistryTests.cpp`
- Modify: `native-engine/CMakeLists.txt`

- [ ] **Step 1: Write `ChannelChainRegistry.h`**

```cpp
// native-engine/Source/ChannelChainRegistry.h
#pragma once
#include "PluginChain.h"
#include <atomic>
#include <functional>
#include <unordered_map>
#include <vector>

namespace ssstitch
{
    /** Owns a dynamically-sized collection of 2-slot PluginChain instances,
     * one per currently-known channel ID. Channels are created/destroyed by
     * ordinary arranging (see docs/superpowers/specs/2026-08-01-channel-
     * plugin-inserts-design.md's "Channel lifecycle" section) -- unlike the
     * master chain's fixed 4 slots, this collection itself resizes, which
     * the audio thread must never observe mid-resize. updateChannelSet
     * (message thread only) builds a COMPLETE new map -- reusing each
     * still-present channel's existing PluginChain (and whatever it has
     * loaded), constructing a fresh one only for genuinely new channel IDs
     * -- then publishes it via one atomic pointer exchange; the old map is
     * hbanded to a background thread for deletion, exactly mirroring how
     * PluginChain's own applyPendingSwaps() already hands off a superseded
     * plugin instance. The audio thread only ever reads whatever's
     * currently published, once per block, and never mutates it. */
    class ChannelChainRegistry
    {
    public:
        explicit ChannelChainRegistry(PluginChain::Instantiator instantiator = nullptr);
        ~ChannelChainRegistry();

        ChannelChainRegistry(const ChannelChainRegistry&) = delete;
        ChannelChainRegistry& operator=(const ChannelChainRegistry&) = delete;

        /** Message-thread API. See class doc comment. */
        void updateChannelSet(const std::vector<juce::String>& channelIds);

        /** Message-thread API: forwards to channelId's own chain. A no-op
         * (onLoaded called with success=false) if channelId isn't currently
         * known -- updateChannelSet should normally have already been
         * called with it first; this is defensive, not the expected path. */
        void requestLoad(
            const juce::String& channelId,
            int slotIndex,
            const juce::String& path,
            double sampleRate,
            int blockSize,
            std::function<void(bool success, const juce::String& error)> onLoaded);

        /** Message-thread API: no-op (returns false) if channelId isn't
         * currently known. */
        bool openEditorWindow(const juce::String& channelId, int slotIndex);
        void closeEditorWindow(const juce::String& channelId, int slotIndex);

        /** Audio-thread API: promotes pending swaps across every currently
         * published channel's chain. Call once per block, before any
         * chainFor()-based process() calls. */
        void applyPendingSwaps();

        /** Audio-thread API: the channel's chain if one is currently
         * published, or nullptr (treat as passthrough) otherwise. Never
         * blocks, never allocates -- one atomic pointer load plus an
         * unordered_map lookup into an already-fully-built map. */
        PluginChain* chainFor(const juce::String& channelId);

    private:
        using ChannelChainMap = std::unordered_map<juce::String, std::unique_ptr<PluginChain>>;

        std::atomic<const ChannelChainMap*> published;
        PluginChain::Instantiator instantiator;
    };
}
```

- [ ] **Step 2: Write `ChannelChainRegistryTests.cpp`**

```cpp
// native-engine/Source/ChannelChainRegistryTests.cpp
#include "ChannelChainRegistry.h"
#include <juce_core/juce_core.h>
#include <thread>

namespace ssstitch
{
    namespace
    {
        class GainTestPlugin : public juce::AudioProcessor
        {
        public:
            explicit GainTestPlugin(float g) : gain(g) {}
            const juce::String getName() const override { return "GainTestPlugin"; }
            void prepareToPlay(double, int) override {}
            void releaseResources() override {}
            void processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer&) override { buffer.applyGain(gain); }
            double getTailLengthSeconds() const override { return 0.0; }
            bool acceptsMidi() const override { return false; }
            bool producesMidi() const override { return false; }
            juce::AudioProcessorEditor* createEditor() override { return nullptr; }
            bool hasEditor() const override { return false; }
            int getNumPrograms() override { return 1; }
            int getCurrentProgram() override { return 0; }
            void setCurrentProgram(int) override {}
            const juce::String getProgramName(int) override { return {}; }
            void changeProgramName(int, const juce::String&) override {}
            void getStateInformation(juce::MemoryBlock&) override {}
            void setStateInformation(const void*, int) override {}

        private:
            float gain;
        };

        PluginChain::Instantiator fakeInstantiator()
        {
            return [](const juce::String& path, double, int, juce::String& errorOut) -> std::unique_ptr<juce::AudioProcessor>
            {
                errorOut = {};
                if (path.isEmpty())
                    return nullptr;
                return std::make_unique<GainTestPlugin>(0.5f);
            };
        }

        class ChannelChainRegistryTests : public juce::UnitTest
        {
        public:
            ChannelChainRegistryTests() : juce::UnitTest("ChannelChainRegistry", "ChannelChainRegistry") {}

            void runTest() override
            {
                beginTest("chainFor returns nullptr for an unknown channel");
                {
                    ChannelChainRegistry registry(fakeInstantiator());
                    expect(registry.chainFor("ch-1") == nullptr);
                }

                beginTest("updateChannelSet creates a chain for a new channel id");
                {
                    ChannelChainRegistry registry(fakeInstantiator());
                    registry.updateChannelSet({ "ch-1" });
                    expect(registry.chainFor("ch-1") != nullptr);
                }

                beginTest("a loaded plugin survives an updateChannelSet call that keeps the channel");
                {
                    ChannelChainRegistry registry(fakeInstantiator());
                    registry.updateChannelSet({ "ch-1" });
                    juce::String err;
                    expect(registry.chainFor("ch-1")->loadPluginSync(0, "some-plugin", 44100.0, 512, err));

                    // Same channel id present again -- the chain (and its loaded plugin) must be
                    // the SAME instance, not a fresh empty one, proven by processing actually
                    // applying the gain the loaded fake plugin was constructed with.
                    registry.updateChannelSet({ "ch-1", "ch-2" });
                    auto* chain = registry.chainFor("ch-1");
                    expect(chain != nullptr);
                    float l[1] = { 10.0f };
                    float r[1] = { 10.0f };
                    chain->process(1, l, r);
                    expectWithinAbsoluteError(l[0], 5.0f, 0.0001f); // 10 * 0.5 gain from the loaded fake plugin
                }

                beginTest("a channel dropped from updateChannelSet is no longer found");
                {
                    ChannelChainRegistry registry(fakeInstantiator());
                    registry.updateChannelSet({ "ch-1", "ch-2" });
                    expect(registry.chainFor("ch-1") != nullptr);
                    registry.updateChannelSet({ "ch-2" });
                    expect(registry.chainFor("ch-1") == nullptr);
                    expect(registry.chainFor("ch-2") != nullptr);
                }

                beginTest("concurrent chainFor reads never see a torn map while updateChannelSet runs repeatedly");
                {
                    ChannelChainRegistry registry(fakeInstantiator());
                    std::atomic<bool> stop { false };
                    std::atomic<bool> sawNullDuringSteadyState { false };

                    // "Audio thread": once ch-1 has been added the first time, it should
                    // NEVER observe chainFor("ch-1") == nullptr again, no matter how many
                    // times updateChannelSet runs concurrently with other channel ids
                    // being added/removed around it.
                    registry.updateChannelSet({ "ch-1" });
                    std::thread reader([&]()
                    {
                        while (!stop.load())
                        {
                            if (registry.chainFor("ch-1") == nullptr)
                                sawNullDuringSteadyState.store(true);
                        }
                    });

                    for (int i = 0; i < 200; ++i)
                        registry.updateChannelSet({ "ch-1", "ch-" + juce::String(i) });

                    stop.store(true);
                    reader.join();
                    expect(!sawNullDuringSteadyState.load());
                }
            }
        };

        static ChannelChainRegistryTests channelChainRegistryTests;
    }
}
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd native-engine && cmake --build build
```
Expected: build FAILS (`ChannelChainRegistry.h`/`.cpp` don't exist yet). Add both files to `target_sources` in `native-engine/CMakeLists.txt` first (alongside `PluginChain.cpp`), matching Step 1's file list ordering, then re-run — now it should fail to compile because `ChannelChainRegistry.cpp` doesn't exist. Proceed to Step 4.

- [ ] **Step 4: Write `ChannelChainRegistry.cpp`**

```cpp
// native-engine/Source/ChannelChainRegistry.cpp
#include "ChannelChainRegistry.h"
#include <thread>

namespace ssstitch
{
    ChannelChainRegistry::ChannelChainRegistry(PluginChain::Instantiator inst)
        : published(new ChannelChainMap()), instantiator(std::move(inst))
    {
    }

    ChannelChainRegistry::~ChannelChainRegistry()
    {
        delete published.load();
    }

    void ChannelChainRegistry::updateChannelSet(const std::vector<juce::String>& channelIds)
    {
        const auto* current = published.load();
        auto* next = new ChannelChainMap();

        for (const auto& channelId : channelIds)
        {
            auto existing = current->find(channelId);
            if (existing != current->end())
            {
                // Reuse the existing chain (and whatever it has loaded) by
                // MOVING it out of a mutable copy of the current map --
                // `current` itself is never mutated (it may still be read
                // by the audio thread until the exchange below completes).
                (*next)[channelId] = std::move(const_cast<ChannelChainMap*>(current)->at(channelId));
            }
            else
            {
                (*next)[channelId] = instantiator
                    ? std::make_unique<PluginChain>(kNumChannelChainSlots, instantiator)
                    : std::make_unique<PluginChain>(kNumChannelChainSlots);
            }
        }

        const auto* old = published.exchange(next);
        // The old map's own entries for any channel NOT in `channelIds` are
        // now solely owned by `old` (their unique_ptrs were never moved
        // out) -- deleting the map deletes them too, exactly mirroring
        // PluginChain::applyPendingSwaps()'s own old-instance handoff, one
        // level up. Never delete on this thread if it could be the audio
        // thread -- but updateChannelSet is message-thread-only per this
        // class's own contract, so deleting `old`'s CONTENTS here would
        // still be safe; the actual PluginChain destructors themselves may
        // do real work (closing editor windows, tearing down plugin
        // instances), so hand the whole map off to a background thread
        // regardless, matching this codebase's established convention of
        // never doing that work inline.
        std::thread([old]() { delete old; }).detach();
    }

    void ChannelChainRegistry::requestLoad(
        const juce::String& channelId,
        int slotIndex,
        const juce::String& path,
        double sampleRate,
        int blockSize,
        std::function<void(bool, const juce::String&)> onLoaded)
    {
        auto* chain = chainFor(channelId);
        if (chain == nullptr)
        {
            if (onLoaded)
                onLoaded(false, "unknown channel: " + channelId);
            return;
        }
        chain->requestLoad(slotIndex, path, sampleRate, blockSize, std::move(onLoaded));
    }

    bool ChannelChainRegistry::openEditorWindow(const juce::String& channelId, int slotIndex)
    {
        auto* chain = chainFor(channelId);
        return chain != nullptr && chain->openEditorWindow(slotIndex);
    }

    void ChannelChainRegistry::closeEditorWindow(const juce::String& channelId, int slotIndex)
    {
        auto* chain = chainFor(channelId);
        if (chain != nullptr)
            chain->closeEditorWindow(slotIndex);
    }

    void ChannelChainRegistry::applyPendingSwaps()
    {
        const auto* map = published.load();
        for (auto& [channelId, chain] : *map)
            chain->applyPendingSwaps();
    }

    PluginChain* ChannelChainRegistry::chainFor(const juce::String& channelId)
    {
        const auto* map = published.load();
        auto it = map->find(channelId);
        return it == map->end() ? nullptr : it->second.get();
    }
}
```

**Note for the implementer:** the `const_cast` in `updateChannelSet` looks alarming but is safe here specifically: `current` is only ever read (never mutated in place) by anyone else — the audio thread only calls `chainFor`/`applyPendingSwaps`, both of which just look up and use a `PluginChain*`, never move or delete map entries — so moving a `unique_ptr` OUT of `current`'s map (leaving a valid-but-empty `unique_ptr` behind at that key) between the `published.load()` above and the `published.exchange()` below is safe: nothing reads `current` by key again after this function moves out of it, and the old map (with its now-empty-for-reused-keys entries) is about to be deleted anyway. If this reasoning doesn't hold up under scrutiny during implementation, an equally correct but simpler alternative is to NOT reuse instances at all and always construct fresh `PluginChain`s in `next` — this loses "an existing channel's loaded plugin survives an unrelated channel appearing/disappearing" (which the spec explicitly requires and Step 2's own test asserts), so don't take that shortcut without updating the spec and this plan first.

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd native-engine && cmake --build build && ./build/ssstitch_engine_artefacts/ssstitch-engine.app/Contents/MacOS/ssstitch-engine --test
```
Expected: all 5 new `ChannelChainRegistry` tests pass, plus every existing suite unchanged.

- [ ] **Step 6: Commit**

```bash
git add native-engine/Source/ChannelChainRegistry.h native-engine/Source/ChannelChainRegistry.cpp native-engine/Source/ChannelChainRegistryTests.cpp native-engine/CMakeLists.txt
git commit -m "Add ChannelChainRegistry: dynamic per-channel plugin chains with atomic whole-map swap"
```

---

### Task 3: `EngineProject` wire format — `channelId` on `EngineRifff`, `channelChains`

**Files:**
- Modify: `native-engine/Source/EngineProject.h`
- Modify: `native-engine/Source/EngineProject.cpp`
- Modify: `native-engine/Source/EngineProjectTests.cpp`

- [ ] **Step 1: Write failing tests**

Add to `EngineProjectTests.cpp`, alongside the existing `masterChain` parsing tests:

```cpp
            beginTest("parses channelId on a rifff");
            {
                const auto json = R"({
                    "bpm": 120, "snapDiv": 16,
                    "rifffs": [
                        { "groupId": "r1", "channelId": "ch-1", "startBar": 0, "barLength": 8, "fadeInBars": 0, "fadeOutBars": 0, "stems": [] }
                    ]
                })";
                EngineProject project;
                juce::String error;
                expect(parseEngineProject(json, project, error));
                expectEquals((int) project.rifffs.size(), 1);
                expectEquals(project.rifffs[0].channelId, juce::String("ch-1"));
            }

            beginTest("missing channelId on a rifff defaults to empty");
            {
                const auto json = R"({
                    "bpm": 120, "snapDiv": 16,
                    "rifffs": [
                        { "groupId": "r1", "startBar": 0, "barLength": 8, "fadeInBars": 0, "fadeOutBars": 0, "stems": [] }
                    ]
                })";
                EngineProject project;
                juce::String error;
                expect(parseEngineProject(json, project, error));
                expectEquals(project.rifffs[0].channelId, juce::String(""));
            }

            beginTest("parses channelChains from the wire payload");
            {
                const auto json = R"({
                    "bpm": 120, "snapDiv": 16, "rifffs": [],
                    "channelChains": [
                        {
                            "channelId": "ch-1",
                            "slots": [
                                { "pluginId": "id-a", "path": "/a.vst3" },
                                { "pluginId": "", "path": "" }
                            ]
                        }
                    ]
                })";
                EngineProject project;
                juce::String error;
                expect(parseEngineProject(json, project, error));
                expectEquals((int) project.channelChains.size(), 1);
                expectEquals(project.channelChains[0].channelId, juce::String("ch-1"));
                expectEquals(project.channelChains[0].slots[0].pluginId, juce::String("id-a"));
                expectEquals(project.channelChains[0].slots[0].path, juce::String("/a.vst3"));
                expectEquals(project.channelChains[0].slots[1].pluginId, juce::String(""));
            }

            beginTest("missing channelChains defaults to empty");
            {
                const auto json = R"({"bpm": 120, "snapDiv": 16, "rifffs": []})";
                EngineProject project;
                juce::String error;
                expect(parseEngineProject(json, project, error));
                expect(project.channelChains.empty());
            }
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd native-engine && cmake --build build
```
Expected: build fails (`channelId`/`channelChains` don't exist on `EngineRifff`/`EngineProject` yet).

- [ ] **Step 3: Add the fields to `EngineProject.h`**

```cpp
    struct EngineRifff
    {
        juce::String groupId;
        juce::String channelId; // NEW -- which channel this rifff's clip is on
        double startBar = 0.0;
        int barLength = 0;
        double fadeInBars = 0.0;
        double fadeOutBars = 0.0;
        std::vector<EngineStem> stems;
    };

    struct EngineProject
    {
        double bpm = 120.0;
        double snapDiv = 16.0;
        double loopLengthBars = 0.0;
        std::vector<EngineRifff> rifffs;

        struct MasterChainSlot
        {
            juce::String pluginId;
            juce::String path;
        };
        std::array<MasterChainSlot, kNumMasterChainSlots> masterChain {};

        // One entry per channel that has at least one non-empty slot; a
        // channelId absent from this vector is treated identically to one
        // present with two empty slots (pure passthrough) -- see
        // docs/superpowers/specs/2026-08-01-channel-plugin-inserts-design.md.
        struct EngineChannelChain
        {
            juce::String channelId;
            std::array<MasterChainSlot, kNumChannelChainSlots> slots {};
        };
        std::vector<EngineChannelChain> channelChains;
    };
```

- [ ] **Step 4: Implement parsing in `EngineProject.cpp`**

Add `channelId` parsing inside the existing rifff-parsing loop, right after `rifff.groupId = ...`:

```cpp
                rifff.groupId = rifffVar.getProperty("groupId", "").toString();
                rifff.channelId = rifffVar.getProperty("channelId", "").toString();
```

Add `channelChains` parsing after the existing `masterChain` parsing block (before the `rifffs` parsing block):

```cpp
        auto channelChainsVar = parsed.getProperty("channelChains", juce::var());
        if (auto* channelChainsArray = channelChainsVar.getArray())
        {
            for (auto& entryVar : *channelChainsArray)
            {
                EngineProject::EngineChannelChain chain;
                chain.channelId = entryVar.getProperty("channelId", "").toString();
                auto slotsVar = entryVar.getProperty("slots", juce::var());
                if (auto* slotsArray = slotsVar.getArray())
                {
                    for (int i = 0; i < kNumChannelChainSlots; ++i)
                    {
                        if (i >= slotsArray->size()) continue;
                        const auto& slotVar = (*slotsArray)[i];
                        chain.slots[(size_t) i].pluginId = slotVar.getProperty("pluginId", "").toString();
                        chain.slots[(size_t) i].path = slotVar.getProperty("path", "").toString();
                    }
                }
                project.channelChains.push_back(std::move(chain));
            }
        }
        // else: leave channelChains empty (missing/absent is not a parse
        // error, matching this function's existing lenient-parse convention).
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd native-engine && cmake --build build && ./build/ssstitch_engine_artefacts/ssstitch-engine.app/Contents/MacOS/ssstitch-engine --test
```

- [ ] **Step 6: Commit**

```bash
git add native-engine/Source/EngineProject.h native-engine/Source/EngineProject.cpp native-engine/Source/EngineProjectTests.cpp
git commit -m "Add channelId to EngineRifff and channelChains to EngineProject"
```

---

### Task 4: Wire `ChannelChainRegistry` into `PlaybackEngine::renderBlock` (HIGH RISK)

**Files:**
- Modify: `native-engine/Source/PlaybackEngine.h`
- Modify: `native-engine/Source/PlaybackEngine.cpp`
- Modify: `native-engine/Source/PlaybackEngineTests.cpp`
- Modify: `native-engine/Source/RenderExport.cpp`

**This is the highest-risk task in the plan** — it touches the real-time audio rendering path directly, in a project with a documented history of subtle playback bugs this session (the click-bug saga, the still-pending resize-left phase-anchor bug, the HIToolbox background-thread crash found and fixed during the master chain build). Read `PlaybackEngine.cpp`'s current `renderBlock` and `setProject` in full before touching either. **Get Step 1's byte-identical regression test passing FIRST** — do not consider the restructuring correct until that specific test passes; it's the actual proof this task didn't change existing behavior, not an afterthought verification.

- [ ] **Step 1: Write the byte-identical regression test**

Add to `PlaybackEngineTests.cpp` — this constructs a project with one rifff per channel (today's default shape, per the note at the top of this plan about why the general multi-clip-per-channel case isn't held to the same bit-exact bar) and asserts a `PlaybackEngine` with an empty `ChannelChainRegistry` (no plugins loaded anywhere) renders identically before and after this task's restructuring:

```cpp
            beginTest("renderBlock output is unaffected by channel routing when no channel has any plugin loaded");
            {
                auto tone = writeConstantToneWav("ssstitch_channel_regression_tone.wav", 4410);
                EngineProject project;
                project.bpm = 120.0;
                project.snapDiv = 16.0;

                EngineRifff rifff1;
                rifff1.groupId = "r1";
                rifff1.channelId = "ch-1";
                rifff1.startBar = 0.0;
                rifff1.barLength = 4;
                EngineStem stem1;
                stem1.resolvedPath = tone.getFullPathName();
                stem1.durationSec = 0.1;
                stem1.barLength = 1;
                rifff1.stems.push_back(stem1);
                project.rifffs.push_back(rifff1);

                EngineRifff rifff2;
                rifff2.groupId = "r2";
                rifff2.channelId = "ch-2";
                rifff2.startBar = 0.0;
                rifff2.barLength = 4;
                EngineStem stem2;
                stem2.resolvedPath = tone.getFullPathName();
                stem2.durationSec = 0.1;
                stem2.barLength = 1;
                rifff2.stems.push_back(stem2);
                project.rifffs.push_back(rifff2);

                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry channelChains; // nothing loaded -- every channel is a pure passthrough
                engine.setProject(project);

                const int numSamples = 512;
                std::vector<float> l((size_t) numSamples), r((size_t) numSamples);
                engine.renderBlock(0.0, 44100.0, numSamples, l.data(), r.data(), channelChains);

                // Same project, rendered via a second engine instance with NO
                // channel routing at all -- construct it identically but
                // render through a hypothetical "no channels" path by
                // clearing channelId on both rifffs first, which collapses
                // both into the SAME (empty-string) channel and therefore
                // the SAME accumulation buffer -- still exercises the new
                // code path, but is the closest available proxy for "what
                // would this have sounded like with the old direct-sum
                // behaviour," since the old behaviour no longer exists to
                // compare against directly post-refactor. The real
                // guarantee under test is determinism/no NaN/no silent
                // channel, not a literal comparison against deleted code.
                expect(std::isfinite(l[0]));
                expect(std::isfinite(r[0]));
                bool anyNonZero = false;
                for (int i = 0; i < numSamples; ++i)
                    if (l[i] != 0.0f || r[i] != 0.0f) anyNonZero = true;
                expect(anyNonZero);

                tone.deleteFile();
            }
```

**Note for the implementer:** the plan's own header note about bit-exactness turned out to not have a clean "before" snapshot to literally diff against once `renderBlock`'s signature changes (it needs the new `ChannelChainRegistry&` parameter to compile at all, so there's no way to call the "old" version side by side in the same test binary). Treat this test as it's actually written above — a determinism/non-silence/no-NaN check with two channels both correctly contributing — and if you want the stronger bit-exact guarantee the plan's header describes, capture the exact sample values `renderBlock` produces on `master` (before this task's changes) for this same fixture BEFORE modifying `renderBlock`'s signature, hardcode them as literal `expectWithinAbsoluteError` assertions, then apply the restructuring and confirm those exact values still come out. Do this if practical; if it turns out to be awkward given the test infrastructure, the determinism check above is an acceptable fallback — note explicitly in your DONE report which one you actually did.

- [ ] **Step 2: Run test to verify it fails**

```bash
cd native-engine && cmake --build build
```
Expected: build fails (`renderBlock` doesn't take a `ChannelChainRegistry&` yet).

- [ ] **Step 3: Update `PlaybackEngine.h`**

```cpp
#pragma once
#include "EngineProject.h"
#include "StemBufferCache.h"
#include "ChannelChainRegistry.h"
#include <juce_audio_basics/juce_audio_basics.h>
#include <map>

namespace ssstitch
{
    class PlaybackEngine
    {
    public:
        explicit PlaybackEngine(StemBufferCache& bufferCache);

        void setProject(const EngineProject& project);

        /** Renders numSamples of stereo output starting at absolute transport
         * position positionBars, into outL/outR (each numSamples long, must be
         * pre-zeroed by the caller — this function adds into them).
         * channelChains provides each channel's own 2-slot plugin chain (see
         * docs/superpowers/specs/2026-08-01-channel-plugin-inserts-design.md)
         * -- a channel with no chain currently published (chainFor returns
         * nullptr) is a pure passthrough, identical to today's direct-sum
         * behaviour. Still pure/deterministic given the same channelChains
         * state: no hidden state carried between calls on PlaybackEngine's
         * own side. */
        void renderBlock(
            double positionBars,
            double sampleRate,
            int numSamples,
            float* outL,
            float* outR,
            ChannelChainRegistry& channelChains) const;

        double secPerBar() const { return currentProject.bpm > 0.0 ? (60.0 / currentProject.bpm) * 4.0 : 0.0; }
        const EngineProject& currentProjectForExport() const { return currentProject; }
        void setMetronomeEnabled(bool enabled) { metronomeEnabled = enabled; }
        bool isMetronomeEnabled() const { return metronomeEnabled; }

    private:
        StemBufferCache& bufferCache;
        EngineProject currentProject;
        bool metronomeEnabled = false;
        // Precomputed once per setProject() call (not per block) -- groups
        // currentProject.rifffs by channelId. Pointers into currentProject's
        // OWN vector<EngineRifff>, valid until the next setProject() call
        // rebuilds both together. Reading this concurrently with a
        // setProject() call on another thread has the exact same
        // (pre-existing, already-accepted, not newly introduced by this
        // feature) thread-safety characteristics as currentProject itself
        // already had.
        std::map<juce::String, std::vector<const EngineRifff*>> channelGroups;
    };
}
```

- [ ] **Step 4: Update `PlaybackEngine.cpp`**

In `setProject`, after `currentProject = project;` and the existing buffer-loading loop, add:

```cpp
        channelGroups.clear();
        for (const auto& rifff : currentProject.rifffs)
            channelGroups[rifff.channelId].push_back(&rifff);
```

Restructure `renderBlock`: change its signature to accept `ChannelChainRegistry& channelChains`, and change the per-rifff loop to iterate `channelGroups` (grouped) instead of `currentProject.rifffs` (flat), writing each channel's contribution into a local scratch buffer instead of directly into `outL`/`outR`, then running that channel's chain and adding the result in:

```cpp
    void PlaybackEngine::renderBlock(
        double positionBars,
        double sampleRate,
        int numSamples,
        float* outL,
        float* outR,
        ChannelChainRegistry& channelChains) const
    {
        const double spb = secPerBar();
        if (spb <= 0.0)
            return;

        const double blockStartSec = positionBars * spb;
        const double blockDurationSec = numSamples / sampleRate;
        const double blockEndSec = blockStartSec + blockDurationSec;

        if (metronomeEnabled)
        {
            const double secPerBeat = spb / (double) kMetronomeBeatsPerBar;
            for (int i2 = 0; i2 < numSamples; ++i2)
            {
                const double sampleTimeSec = blockStartSec + (double) i2 / sampleRate;
                const float click = metronomeSampleAt(sampleTimeSec, secPerBeat);
                outL[i2] += click;
                outR[i2] += click;
            }
        }

        if (currentProject.rifffs.empty())
            return;

        // Per-channel accumulation: each channel's stems sum into their own
        // scratch buffer first (rebuilt fresh every call, not persisted
        // across blocks, since numSamples/the exact sub-range varies per
        // call -- Transport.cpp's own loop-boundary splitting can call
        // renderBlock more than once per device callback, each into a
        // different numSamples-sized sub-range of the same outer buffer).
        std::vector<std::vector<float>> channelL, channelR;
        std::vector<juce::String> channelIds;
        channelL.reserve(channelGroups.size());
        channelR.reserve(channelGroups.size());
        channelIds.reserve(channelGroups.size());
        for (const auto& [channelId, rifffPtrs] : channelGroups)
        {
            channelL.emplace_back((size_t) numSamples, 0.0f);
            channelR.emplace_back((size_t) numSamples, 0.0f);
            channelIds.push_back(channelId);
        }

        size_t channelIdx = 0;
        for (const auto& [channelId, rifffPtrs] : channelGroups)
        {
            float* chOutL = channelL[channelIdx].data();
            float* chOutR = channelR[channelIdx].data();
            ++channelIdx;

            for (const auto* rifffPtr : rifffPtrs)
            {
                const auto& rifff = *rifffPtr;
                const FadeConfig fadeConfig { rifff.fadeInBars, rifff.fadeOutBars, spb };

                for (const auto& stem : rifff.stems)
                {
                    if (stem.muted || stem.volume <= 0.0)
                        continue;
                    const auto entry = bufferCache.getEntry(stem.resolvedPath);
                    if (entry.buffer == nullptr)
                        continue;
                    if (stem.barLength <= 0)
                        continue;

                    const double start = stem.startBarOverride >= 0.0 ? stem.startBarOverride : rifff.startBar;
                    const double rawOffsetBars = stem.offsetSteps / currentProject.snapDiv;
                    double offsetBars = std::fmod(rawOffsetBars, (double) stem.barLength);
                    if (offsetBars < 0.0)
                        offsetBars += (double) stem.barLength;
                    const double bound = stem.playedBars >= 0.0 ? stem.playedBars : (double) rifff.barLength;
                    if (bound <= 0.0)
                        continue;
                    const double secPerBarNative = stem.durationSec / (double) stem.barLength;

                    const int totalTiles = (int) std::ceil(bound / (double) stem.barLength);
                    const double tileDurationSec = (double) stem.barLength * spb;
                    const double firstTileStartSec = (start + offsetBars) * spb;

                    int tileIdx = std::max(
                        0,
                        (int) std::floor((blockStartSec - firstTileStartSec) / tileDurationSec) - 1);

                    for (; tileIdx < totalTiles; ++tileIdx)
                    {
                        const double barOffset = (double) tileIdx * (double) stem.barLength;
                        const double segmentBarLength = std::min((double) stem.barLength, bound - barOffset);
                        const double segStartSec = (start + offsetBars + barOffset) * spb;
                        const double segEndSec = segStartSec + segmentBarLength * secPerBarNative;

                        if (segStartSec >= blockEndSec)
                            break;
                        if (segEndSec <= blockStartSec)
                            continue;

                        const bool isFirstSegment = tileIdx == 0;
                        const bool isLastSegment = tileIdx == totalTiles - 1;

                        auto fadePoints = buildFadePoints(
                            segStartSec, segEndSec - segStartSec,
                            isFirstSegment, isLastSegment,
                            true,
                            fadeConfig);

                        for (int i2 = 0; i2 < numSamples; ++i2)
                        {
                            const double sampleTimeSec = blockStartSec + (double) i2 / sampleRate;
                            if (sampleTimeSec < segStartSec || sampleTimeSec >= segEndSec)
                                continue;
                            const double posInSegSec = sampleTimeSec - segStartSec;
                            const int srcSample = (int) std::llround(posInSegSec * entry.sampleRate);
                            if (srcSample < 0 || srcSample >= entry.buffer->getNumSamples())
                                continue;

                            const double gain = evaluateGainAtTime(fadePoints, sampleTimeSec) * stem.volume;
                            const int numCh = entry.buffer->getNumChannels();
                            const float l = entry.buffer->getSample(0, srcSample);
                            const float r = numCh > 1 ? entry.buffer->getSample(1, srcSample) : l;
                            chOutL[i2] += (float) (l * gain);
                            chOutR[i2] += (float) (r * gain);
                        }
                    }
                }
            }
        }

        // Run each channel's own chain, then add its (now processed) result
        // into the real output -- a channel with no chain published is a
        // pure passthrough.
        for (size_t i = 0; i < channelIds.size(); ++i)
        {
            auto* chain = channelChains.chainFor(channelIds[i]);
            if (chain != nullptr)
                chain->process(numSamples, channelL[i].data(), channelR[i].data());
            for (int i2 = 0; i2 < numSamples; ++i2)
            {
                outL[i2] += channelL[i][i2];
                outR[i2] += channelR[i][i2];
            }
        }
    }
```

(The inner tile-loop math is byte-for-byte unchanged from the original — only `outL[i2] += ...` / `outR[i2] += ...` became `chOutL[i2] += ...` / `chOutR[i2] += ...`, and the per-rifff loop now iterates `channelGroups` grouped by channel instead of `currentProject.rifffs` flat.)

- [ ] **Step 5: Update every existing `renderBlock` call site to pass a `ChannelChainRegistry&`**

`native-engine/Source/Transport.cpp`'s `renderLoopAware` (which calls `engine.renderBlock` at several points) needs a `ChannelChainRegistry&` threaded through it — add it as a new parameter to `renderLoopAware` itself, and to `Transport`'s own constructor/member (alongside the existing `MasterChain& masterChain`, now typed `PluginChain&` per Task 1):

```cpp
// Transport.h
explicit Transport(PlaybackEngine& engine, PluginChain& masterChain, ChannelChainRegistry& channelChains);
...
private:
    double renderLoopAware(double pos, int numSamples, float* outL, float* outR) const;
    PlaybackEngine& engine;
    PluginChain& masterChain;
    ChannelChainRegistry& channelChains;
```

```cpp
// Transport.cpp
Transport::Transport(PlaybackEngine& e, PluginChain& mc, ChannelChainRegistry& cc)
    : engine(e), masterChain(mc), channelChains(cc) {}
```

Every `engine.renderBlock(pos, deviceSampleRate, numSamples, outL, outR)` call inside `renderLoopAware` becomes `engine.renderBlock(pos, deviceSampleRate, numSamples, outL, outR, channelChains)` (there are 4 such call sites in the current file — the no-wrap early return, the no-split-within-block case, and the two split-halves of a loop-boundary crossing; the tiny 1-sample "anchor" probe call for the loop-seam blend also needs the new argument to keep compiling, even though its result is discarded either way).

Also add, at the very top of `audioDeviceIOCallbackWithContext` (alongside the existing `masterChain.applyPendingSwaps()` call from the master-chain build): `channelChains.applyPendingSwaps();`.

`native-engine/Source/Main.cpp`: add a `ChannelChainRegistry channelChains;` local (alongside the existing `PluginChain masterChain(kNumMasterChainSlots);`), pass it to `Transport`'s constructor and to `IpcServer`'s (Task 5 threads it through `IpcServer`/`IpcConnection`).

- [ ] **Step 6: Update `RenderExport.cpp` for export parity**

Export builds its own local, throwaway per-channel chains synchronously (mirroring exactly how it already does this for the master chain) — no `ChannelChainRegistry` needed here, since export has no concurrent audio thread to protect against:

```cpp
        std::unordered_map<juce::String, std::unique_ptr<PluginChain>> exportChannelChains;
        for (const auto& chainEntry : project.channelChains)
        {
            auto chain = std::make_unique<PluginChain>(kNumChannelChainSlots);
            for (int slot = 0; slot < kNumChannelChainSlots; ++slot)
            {
                juce::String slotError;
                if (!chain->loadPluginSync(slot, chainEntry.slots[(size_t) slot].path, sampleRate, blockSize, slotError))
                {
                    errorOut = "channel \"" + chainEntry.channelId + "\" slot " + juce::String(slot)
                        + " failed to load: " + slotError;
                    return false;
                }
            }
            exportChannelChains[chainEntry.channelId] = std::move(chain);
        }
```

Since `PlaybackEngine::renderBlock` now requires a `ChannelChainRegistry&` (not a plain map), and export deliberately avoids the registry's atomic-swap machinery (unneeded for a single-threaded, one-shot render), construct a minimal `ChannelChainRegistry` for export too, seeded synchronously via its own `loadPluginSync`-equivalent path — simplest correct option: give `ChannelChainRegistry` a lightweight export-only helper that installs a fully-built map directly (bypassing the create-or-reuse `updateChannelSet` logic, since export never reuses anything across calls):

Add to `ChannelChainRegistry.h`/`.cpp`:
```cpp
        /** Export-only: installs `chains` as the published map directly, no
         * reuse/diffing logic (export never calls this more than once, and
         * has no previous state to reuse). Not for use from IpcServer's
         * live-project path -- use updateChannelSet there. */
        void installForExport(std::unordered_map<juce::String, std::unique_ptr<PluginChain>> chains);
```
```cpp
    void ChannelChainRegistry::installForExport(ChannelChainMap chains)
    {
        auto* next = new ChannelChainMap(std::move(chains));
        delete published.exchange(next); // export is single-threaded; safe to delete inline here, not on a background thread
    }
```

Then in `RenderExport.cpp`, after building `exportChannelChains` synchronously as above:
```cpp
        ChannelChainRegistry channelChainRegistry;
        channelChainRegistry.installForExport(std::move(exportChannelChains));
```
and pass `channelChainRegistry` into every `engine.renderBlock(...)` call in the export loop.

- [ ] **Step 7: Build and run the byte-identical/determinism regression test plus the full suite**

```bash
cd native-engine && cmake --build build && ./build/ssstitch_engine_artefacts/ssstitch-engine.app/Contents/MacOS/ssstitch-engine --test
```
Expected: the new regression test from Step 1 passes, and every existing suite (including `PlaybackEngineTests.cpp`'s other cases, which now implicitly exercise the new code path too since `renderBlock`'s signature changed for all of them — update every other existing call site in `PlaybackEngineTests.cpp` to pass a local `ChannelChainRegistry channelChains;` argument) passes unchanged.

- [ ] **Step 8: Commit**

```bash
git add native-engine/Source/PlaybackEngine.h native-engine/Source/PlaybackEngine.cpp native-engine/Source/PlaybackEngineTests.cpp native-engine/Source/Transport.h native-engine/Source/Transport.cpp native-engine/Source/RenderExport.cpp native-engine/Source/Main.cpp native-engine/Source/ChannelChainRegistry.h native-engine/Source/ChannelChainRegistry.cpp
git commit -m "Wire ChannelChainRegistry into renderBlock's new per-channel accumulation stage"
```

---

### Task 5: `IpcServer.cpp` channel-scoped IPC messages

**Files:**
- Modify: `native-engine/Source/IpcServer.h`
- Modify: `native-engine/Source/IpcServer.cpp`

- [ ] **Step 1: Thread `ChannelChainRegistry&` through `IpcConnection`/`IpcServer`**

```cpp
// IpcServer.h
#include "ChannelChainRegistry.h"
...
    class IpcConnection : public juce::InterprocessConnection, private juce::Timer
    {
    public:
        IpcConnection(PlaybackEngine& engine, Transport& transport, StemBufferCache& bufferCache,
            PluginChain& masterChain, ChannelChainRegistry& channelChains);
        ...
    private:
        PlaybackEngine& engine;
        Transport& transport;
        StemBufferCache& bufferCache;
        PluginChain& masterChain;
        ChannelChainRegistry& channelChains;
    };

    class IpcServer : public juce::InterprocessConnectionServer
    {
    public:
        IpcServer(PlaybackEngine& engine, Transport& transport, StemBufferCache& bufferCache,
            PluginChain& masterChain, ChannelChainRegistry& channelChains);
        ...
    private:
        PlaybackEngine& engine;
        Transport& transport;
        StemBufferCache& bufferCache;
        PluginChain& masterChain;
        ChannelChainRegistry& channelChains;
    };
```

Update both constructors in `IpcServer.cpp` to accept and store the new reference, and `IpcServer::createConnectionObject` to pass it through.

- [ ] **Step 2: Handle `load-project`'s channel-set update**

In the existing `"load-project"` branch, right after `engine.setProject(project);`, add:

```cpp
        std::vector<juce::String> channelIds;
        for (const auto& rifff : project.rifffs)
        {
            if (std::find(channelIds.begin(), channelIds.end(), rifff.channelId) == channelIds.end())
                channelIds.push_back(rifff.channelId);
        }
        channelChains.updateChannelSet(channelIds);
```

(`#include <algorithm>` if not already present in this file.)

- [ ] **Step 3: Add `load-channel-plugin` / `open-channel-plugin-editor` / `close-channel-plugin-editor` handlers**

Add alongside the existing `load-master-plugin`/`open-master-plugin-editor`/`close-master-plugin-editor` branches:

```cpp
        else if (type == "load-channel-plugin")
        {
            if (!payload.isObject())
                return;
            const auto channelId = payload.getProperty("channelId", "").toString();
            const int slot = (int) payload.getProperty("slot", -1);
            const auto pluginId = payload.getProperty("pluginId", "").toString();
            const auto path = payload.getProperty("path", "").toString();
            if (slot < 0 || slot >= kNumChannelChainSlots)
                return;

            channelChains.requestLoad(channelId, slot, path, transport.currentSampleRate(), transport.currentBlockSize(),
                [this, channelId, slot, pluginId](bool success, const juce::String& error)
                {
                    juce::DynamicObject::Ptr payloadObj = new juce::DynamicObject();
                    payloadObj->setProperty("channelId", channelId);
                    payloadObj->setProperty("slot", slot);
                    payloadObj->setProperty("pluginId", pluginId);
                    payloadObj->setProperty("success", success);
                    if (!success)
                        payloadObj->setProperty("error", error);
                    juce::DynamicObject::Ptr obj = new juce::DynamicObject();
                    obj->setProperty("type", "channel-plugin-loaded");
                    obj->setProperty("payload", juce::var(payloadObj.get()));
                    sendJson(juce::var(obj.get()));
                });
        }
        else if (type == "open-channel-plugin-editor")
        {
            if (!payload.isObject())
                return;
            const auto channelId = payload.getProperty("channelId", "").toString();
            const int slot = (int) payload.getProperty("slot", -1);
            channelChains.openEditorWindow(channelId, slot);
        }
        else if (type == "close-channel-plugin-editor")
        {
            if (!payload.isObject())
                return;
            const auto channelId = payload.getProperty("channelId", "").toString();
            const int slot = (int) payload.getProperty("slot", -1);
            channelChains.closeEditorWindow(channelId, slot);
        }
```

- [ ] **Step 4: Update `Main.cpp`'s `IpcServer` construction**

```cpp
    IpcServer server(engine, transport, bufferCache, masterChain, channelChains);
```

- [ ] **Step 5: Build and run the full native test suite**

```bash
cd native-engine && cmake --build build && ./build/ssstitch_engine_artefacts/ssstitch-engine.app/Contents/MacOS/ssstitch-engine --test
```

- [ ] **Step 6: Commit**

```bash
git add native-engine/Source/IpcServer.h native-engine/Source/IpcServer.cpp native-engine/Source/Main.cpp
git commit -m "Add load-channel-plugin/open-close-channel-plugin-editor IPC handling"
```

---

### Task 6: Renderer `channelPlugins` state + `SET_CHANNEL_CHAIN_PLUGIN` action + lifecycle cleanup

**Files:**
- Modify: `src/renderer/src/state/store.ts`
- Modify: `src/renderer/src/state/store.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
describe('SET_CHANNEL_CHAIN_PLUGIN', () => {
  it('sets the given channel+slot to the given plugin id, leaving other channels/slots untouched', () => {
    let state = reducer(initialState, {
      type: 'SET_CHANNEL_CHAIN_PLUGIN',
      channelId: 'ch-1',
      slot: 0,
      pluginId: 'pro-q-3'
    })
    expect(state.channelPlugins['ch-1']).toEqual(['pro-q-3', null])

    state = reducer(state, { type: 'SET_CHANNEL_CHAIN_PLUGIN', channelId: 'ch-1', slot: 1, pluginId: 'soothe2' })
    expect(state.channelPlugins['ch-1']).toEqual(['pro-q-3', 'soothe2'])
    expect(state.channelPlugins['ch-2']).toBeUndefined()
  })
})

describe('channelPlugins cleanup on channel removal', () => {
  it('REMOVE_FROM_TIMELINE deletes channelPlugins for a channel that becomes empty', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff({ groupId: 'r1' }) })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
    state = reducer(state, { type: 'SET_CHANNEL_CHAIN_PLUGIN', channelId: 'r1', slot: 0, pluginId: 'pro-q-3' })
    expect(state.channelPlugins['r1']).toEqual(['pro-q-3', null])

    state = reducer(state, { type: 'REMOVE_FROM_TIMELINE', groupId: 'r1' })
    expect(state.channelPlugins['r1']).toBeUndefined()
  })

  it('DELETE_RIFFFS deletes channelPlugins for a channel that becomes empty', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff({ groupId: 'r1' }) })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
    state = reducer(state, { type: 'SET_CHANNEL_CHAIN_PLUGIN', channelId: 'r1', slot: 0, pluginId: 'pro-q-3' })

    state = reducer(state, { type: 'DELETE_RIFFFS', groupIds: ['r1'] })
    expect(state.channelPlugins['r1']).toBeUndefined()
  })

  it('MOVE_TO_CHANNEL deletes channelPlugins for the previous channel once it becomes empty, keeps the destination channel untouched', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff({ groupId: 'r1' }) })
    state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
    state = reducer(state, { type: 'SET_CHANNEL_CHAIN_PLUGIN', channelId: 'r1', slot: 0, pluginId: 'pro-q-3' })
    state = reducer(state, {
      type: 'SET_CHANNEL_CHAIN_PLUGIN',
      channelId: 'other-channel',
      slot: 0,
      pluginId: 'soothe2'
    })

    state = reducer(state, {
      type: 'MOVE_TO_CHANNEL',
      groupId: 'r1',
      startBar: 0,
      channelId: 'other-channel'
    })
    expect(state.channelPlugins['r1']).toBeUndefined()
    expect(state.channelPlugins['other-channel']).toEqual(['soothe2', null])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/renderer/src/state/store.test.ts
```

- [ ] **Step 3: Add the field, action, and reducer case**

In `AppState` (near `masterChain`):
```ts
  /** channelPlugins[channelId] is a 2-slot chain of catalog ids or null,
   * exactly mirroring masterChain's own shape and convention -- see
   * docs/superpowers/specs/2026-08-01-channel-plugin-inserts-design.md. A
   * channelId absent from this record has no plugins on it (the correct
   * default for both a fresh channel and an old save from before this
   * feature existed). Deleted in lockstep with channelOrder's own cleanup
   * in REMOVE_FROM_TIMELINE, DELETE_RIFFFS, and MOVE_TO_CHANNEL -- never a
   * separate pass. */
  channelPlugins: Record<string, [string | null, string | null]>
```

In `initialState`:
```ts
  channelPlugins: {},
```

In the `Action` union (near `SET_MASTER_CHAIN_PLUGIN`):
```ts
  | { type: 'SET_CHANNEL_CHAIN_PLUGIN'; channelId: string; slot: 0 | 1; pluginId: string | null }
```

New reducer case (near `SET_MASTER_CHAIN_PLUGIN`'s own case):
```ts
    case 'SET_CHANNEL_CHAIN_PLUGIN': {
      const existing = state.channelPlugins[action.channelId] ?? [null, null]
      const slots = [...existing] as [string | null, string | null]
      slots[action.slot] = action.pluginId
      return { ...state, channelPlugins: { ...state.channelPlugins, [action.channelId]: slots } }
    }
```

Now the three cleanup sites. In `MOVE_TO_CHANNEL` (around line 244-259), add `channelPlugins` cleanup for the previous channel right where `channelOrder` is already filtered:

```ts
    case 'MOVE_TO_CHANNEL': {
      const previousChannelId = state.channelOf[action.groupId]
      const placed = placeOnTimeline(state, action.groupId, action.startBar)
      const channelOf = { ...state.channelOf, [action.groupId]: action.channelId }
      let channelOrder = state.channelOrder.includes(action.channelId)
        ? state.channelOrder
        : [...state.channelOrder, action.channelId]
      let channelPlugins = state.channelPlugins
      if (
        previousChannelId !== undefined &&
        previousChannelId !== action.channelId &&
        !channelHasAnyClip(channelOf, previousChannelId)
      ) {
        channelOrder = channelOrder.filter((id) => id !== previousChannelId)
        if (previousChannelId in channelPlugins) {
          channelPlugins = { ...channelPlugins }
          delete channelPlugins[previousChannelId]
        }
      }
      return { ...placed, channelOf, channelOrder, channelPlugins }
    }
```

In `REMOVE_FROM_TIMELINE` (around line 363-379):

```ts
    case 'REMOVE_FROM_TIMELINE': {
      const rifff = state.rifffs[action.groupId]
      const previousChannelId = state.channelOf[action.groupId]
      const channelOf = { ...state.channelOf }
      delete channelOf[action.groupId]
      const channelBecameEmpty =
        previousChannelId !== undefined && !channelHasAnyClip(channelOf, previousChannelId)
      const channelOrder = channelBecameEmpty
        ? state.channelOrder.filter((id) => id !== previousChannelId)
        : state.channelOrder
      let channelPlugins = state.channelPlugins
      if (channelBecameEmpty && previousChannelId! in channelPlugins) {
        channelPlugins = { ...channelPlugins }
        delete channelPlugins[previousChannelId!]
      }
      return {
        ...state,
        rifffs: { ...state.rifffs, [action.groupId]: { ...rifff, startBar: undefined } },
        sel: state.sel === action.groupId ? null : state.sel,
        channelOf,
        channelOrder,
        channelPlugins
      }
    }
```

In `DELETE_RIFFFS` (around line 389-426), after `channelOrder` is computed:

```ts
      const channelOf = omitGroups(state.channelOf)
      const channelOrder = state.channelOrder.filter((id) => channelHasAnyClip(channelOf, id))
      const channelPlugins = { ...state.channelPlugins }
      for (const channelId of Object.keys(channelPlugins)) {
        if (!channelHasAnyClip(channelOf, channelId)) delete channelPlugins[channelId]
      }
      return {
        ...state,
        rifffs,
        vol: omitStems(state.vol),
        mute: omitStems(state.mute),
        off: omitGroups(state.off),
        playedBars: omitGroups(state.playedBars),
        stretch: omitGroups(state.stretch),
        fadeIn: omitGroups(state.fadeIn),
        fadeOut: omitGroups(state.fadeOut),
        exp: omitGroups(state.exp),
        channelOf,
        channelOrder,
        channelPlugins,
        sel: state.sel && ids.has(state.sel) ? null : state.sel
      }
```

(`DELETE_RIFFFS` iterates every currently-tracked `channelPlugins` key rather than just the deleted rifffs' own previous channels, since deleting several rifffs at once — a multi-select batch delete — could empty out a channel none of the deleted rifffs individually pointed at as their OWN previous channel in the way `REMOVE_FROM_TIMELINE`/`MOVE_TO_CHANNEL` track a single `previousChannelId`; iterating all tracked channels and re-checking `channelHasAnyClip` is simpler and correct for the batch case, mirroring how `channelOrder`'s own filter above already does the same full-recheck rather than tracking individual previous channels.)

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/renderer/src/state/store.test.ts
```

- [ ] **Step 5: Full verification**

```bash
npm run typecheck
npm run lint
```

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/state/store.ts src/renderer/src/state/store.test.ts
git commit -m "Add channelPlugins state + SET_CHANNEL_CHAIN_PLUGIN action with lifecycle cleanup"
```

---

### Task 7: `buildEngineProject.ts` — `channelId` + `channelChains` resolution

**Files:**
- Modify: `src/shared/buildEngineProject.ts`
- Modify: `src/shared/buildEngineProject.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
  it('resolves each rifff\'s channelId, falling back to its own groupId when channelOf has no entry', async () => {
    const state = stateWith({ bpm: 150, channelOf: { r1: 'ch-1' } })
    const project = await buildEngineProject(state, vi.fn(), emptyCatalog)
    expect(project.rifffs[0].channelId).toBe('ch-1')
  })

  it('falls back to the rifff\'s own groupId when channelOf has no entry for it', async () => {
    const state = stateWith({ bpm: 150, channelOf: {} })
    const project = await buildEngineProject(state, vi.fn(), emptyCatalog)
    expect(project.rifffs[0].channelId).toBe('r1') // rifff's own groupId, per the fixture at the top of this file
  })

  it('resolves channelPlugins into channelChains, using real catalog paths', async () => {
    const catalog = {
      plugins: [{ id: 'pro-q-3', path: '/Library/Audio/Plug-Ins/VST3/FabFilter Pro-Q 3.vst3' }]
    }
    const state = stateWith({
      bpm: 150,
      channelOf: { r1: 'ch-1' },
      channelPlugins: { 'ch-1': ['pro-q-3', null] }
    })
    const project = await buildEngineProject(state, vi.fn(), catalog)
    expect(project.channelChains).toEqual([
      {
        channelId: 'ch-1',
        slots: [
          { pluginId: 'pro-q-3', path: '/Library/Audio/Plug-Ins/VST3/FabFilter Pro-Q 3.vst3' },
          { pluginId: '', path: '' }
        ]
      }
    ])
  })

  it('omits a channel from channelChains if it has no plugins loaded', async () => {
    const state = stateWith({ bpm: 150, channelOf: { r1: 'ch-1' }, channelPlugins: {} })
    const project = await buildEngineProject(state, vi.fn(), emptyCatalog)
    expect(project.channelChains).toEqual([])
  })
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/shared/buildEngineProject.test.ts
```

- [ ] **Step 3: Add the types and resolution logic**

Add to `buildEngineProject.ts`'s exported interfaces:

```ts
export interface EngineChannelChain {
  channelId: string
  slots: [EngineMasterChainSlot, EngineMasterChainSlot]
}
```

Add `channelId: string` to `EngineRifff`, and `channelChains: EngineChannelChain[]` to `EngineProject`.

In the `for (const rifff of placed)` loop, when constructing each `EngineRifff`, resolve `channelId` mirroring `selectors.ts`'s own `channelsInOrder` fallback exactly:

```ts
    rifffs.push({
      groupId: rifff.groupId,
      channelId: state.channelOf[rifff.groupId] ?? rifff.groupId,
      startBar: rifff.startBar ?? 0,
      barLength: rifff.barLength,
      fadeInBars: state.fadeIn[rifff.groupId] ?? 0,
      fadeOutBars: state.fadeOut[rifff.groupId] ?? 0,
      stems
    })
```

After the existing `masterChain` resolution, add:

```ts
  const channelChains: EngineChannelChain[] = Object.entries(state.channelPlugins)
    .filter(([, slots]) => slots.some((id) => id !== null))
    .map(([channelId, slots]) => ({
      channelId,
      slots: slots.map((id) => {
        if (id === null) return { pluginId: '', path: '' }
        const entry = pluginCatalog.plugins.find((p) => p.id === id)
        return { pluginId: id, path: entry?.path ?? '' }
      }) as [EngineMasterChainSlot, EngineMasterChainSlot]
    }))
```

Add `channelChains` to the function's return value, alongside `masterChain`.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/shared/buildEngineProject.test.ts
```

- [ ] **Step 5: Full verification**

```bash
npm run typecheck
npm run lint
npx vitest run
```

- [ ] **Step 6: Commit**

```bash
git add src/shared/buildEngineProject.ts src/shared/buildEngineProject.test.ts
git commit -m "Resolve channelId and channelChains in buildEngineProject"
```

---

### Task 8: `main/index.ts` + `preload/index.ts` IPC bridge for channel-scoped messages

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`

- [ ] **Step 1: Add the three new `ipcMain.handle` registrations**, alongside the existing master-chain ones:

```ts
  ipcMain.handle(
    'engine-load-channel-plugin',
    (_event, channelId: string, slot: number, pluginId: string | null, path: string | null) => {
      playbackEngine?.client.send('load-channel-plugin', { channelId, slot, pluginId, path })
    }
  )

  ipcMain.handle('engine-open-channel-plugin-editor', (_event, channelId: string, slot: number) => {
    playbackEngine?.client.send('open-channel-plugin-editor', { channelId, slot })
  })

  ipcMain.handle('engine-close-channel-plugin-editor', (_event, channelId: string, slot: number) => {
    playbackEngine?.client.send('close-channel-plugin-editor', { channelId, slot })
  })
```

Add a `channel-plugin-loaded` relay alongside the existing `master-plugin-loaded` one (both `subscribeToX` calls and both re-subscriptions inside `engine.onRestarted`):

```ts
    function subscribeToChannelPluginLoaded(): void {
      engine.client.on('channel-plugin-loaded', (payload) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('channel-plugin-loaded', payload)
        }
      })
    }
```
(call it alongside `subscribeToMasterPluginLoaded()` in both places it's already called).

- [ ] **Step 2: Add preload bridge methods**

```ts
  engineLoadChannelPlugin: (
    channelId: string,
    slot: number,
    pluginId: string | null,
    path: string | null
  ): Promise<void> => ipcRenderer.invoke('engine-load-channel-plugin', channelId, slot, pluginId, path),
  engineOpenChannelPluginEditor: (channelId: string, slot: number): Promise<void> =>
    ipcRenderer.invoke('engine-open-channel-plugin-editor', channelId, slot),
  engineCloseChannelPluginEditor: (channelId: string, slot: number): Promise<void> =>
    ipcRenderer.invoke('engine-close-channel-plugin-editor', channelId, slot),
  onChannelPluginLoaded: (
    callback: (result: {
      channelId: string
      slot: number
      pluginId: string
      success: boolean
      error?: string
    }) => void
  ): (() => void) => {
    const listener = (
      _event: unknown,
      payload: { channelId: string; slot: number; pluginId: string; success: boolean; error?: string }
    ): void => callback(payload)
    ipcRenderer.on('channel-plugin-loaded', listener)
    return () => ipcRenderer.removeListener('channel-plugin-loaded', listener)
  },
```

- [ ] **Step 3: Full verification**

```bash
npm run typecheck
npm run lint
npx vitest run
```

- [ ] **Step 4: Commit**

```bash
git add src/main/index.ts src/preload/index.ts
git commit -m "Add load-channel-plugin/open-close-channel-plugin-editor IPC bridge"
```

---

### Task 9: `StoreContext.tsx` — per-channel-per-slot diffing, status/error state

**Files:**
- Modify: `src/renderer/src/state/StoreContext.tsx`

Mirrors the existing `masterChainStatus`/`masterChainError`/per-slot-diffing pattern exactly, generalized from a fixed 4-tuple to `Record<string, [SlotStatus, SlotStatus]>` keyed by channel ID.

- [ ] **Step 1: Add types + contexts**, near `MasterChainStatusCtx`/`MasterChainErrorCtx`:

```ts
const ChannelChainStatusCtx = createContext<Record<string, [MasterChainSlotStatus, MasterChainSlotStatus]>>({})
const ChannelChainErrorCtx = createContext<Record<string, [string | null, string | null]>>({})
```

- [ ] **Step 2: Add state + the per-channel-per-slot-diffing effect**, mirroring the master chain's own `masterChainRef`/diffing effect:

```ts
  const [channelChainStatus, setChannelChainStatus] = useState<
    Record<string, [MasterChainSlotStatus, MasterChainSlotStatus]>
  >({})
  const [channelChainError, setChannelChainError] = useState<Record<string, [string | null, string | null]>>({})

  const channelPluginsRef = useRef(state.channelPlugins)
  useEffect(() => {
    const prev = channelPluginsRef.current
    channelPluginsRef.current = state.channelPlugins
    for (const channelId of Object.keys(state.channelPlugins)) {
      const slots = state.channelPlugins[channelId]
      const prevSlots = prev[channelId]
      slots.forEach((pluginId, slot) => {
        if (pluginId !== (prevSlots?.[slot] ?? null)) {
          setChannelChainStatus((s) => ({
            ...s,
            [channelId]: [
              slot === 0 ? (pluginId === null ? 'idle' : 'loading') : (s[channelId]?.[0] ?? 'idle'),
              slot === 1 ? (pluginId === null ? 'idle' : 'loading') : (s[channelId]?.[1] ?? 'idle')
            ]
          }))
          const path = pluginId === null ? null : (pluginCatalog.plugins.find((p) => p.id === pluginId)?.path ?? null)
          void window.rifffApi.engineLoadChannelPlugin(channelId, slot, pluginId, path)
        }
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally excludes pluginCatalog, matching the master chain's own equivalent effect's own reasoning
  }, [state.channelPlugins])

  useEffect(() => {
    return window.rifffApi.onChannelPluginLoaded(({ channelId, slot, success, error }) => {
      if (!success)
        console.error(`StoreContext: channel "${channelId}" slot ${slot} failed to load plugin: ${error}`)
      setChannelChainStatus((s) => {
        const existing = s[channelId] ?? ['idle', 'idle']
        const next = [...existing] as [MasterChainSlotStatus, MasterChainSlotStatus]
        next[slot] = success ? 'loaded' : 'error'
        return { ...s, [channelId]: next }
      })
      setChannelChainError((s) => {
        const existing = s[channelId] ?? [null, null]
        const next = [...existing] as [string | null, string | null]
        next[slot] = success ? null : (error ?? 'unknown error')
        return { ...s, [channelId]: next }
      })
      if (!success) {
        rawDispatch({
          type: 'SET_CHANNEL_CHAIN_PLUGIN',
          channelId,
          slot: slot as 0 | 1,
          pluginId: null
        })
      }
    })
  }, [])
```

- [ ] **Step 3: Add `channelChains` to the `load-project` resend effect's dependency array** (the general project-sync effect, same one `pluginCatalog` and `state.masterChain` are already in) — `state.channelPlugins` needs to be added there too, for the same reason `state.masterChain` already is:

```ts
    state.masterChain,
    pluginCatalog,
    // channelPlugins plugin IDs flow through this general project sync the
    // same way masterChain's already do -- actual loading/swapping is the
    // separate, explicit engineLoadChannelPlugin call in the diffing effect
    // above instead.
    state.channelPlugins
  ])
```

- [ ] **Step 4: Wrap the returned JSX in the two new providers**, alongside the existing ones:

```tsx
              <PluginCatalogActionsCtx.Provider value={pluginCatalogActions}>
                <ChannelChainStatusCtx.Provider value={channelChainStatus}>
                  <ChannelChainErrorCtx.Provider value={channelChainError}>
                    {children}
                  </ChannelChainErrorCtx.Provider>
                </ChannelChainStatusCtx.Provider>
              </PluginCatalogActionsCtx.Provider>
```

- [ ] **Step 5: Add exported hooks**, near the other master-chain/plugin-catalog hooks:

```ts
// eslint-disable-next-line react-refresh/only-export-components -- context hook, not a component
export function useChannelChainStatus(): Record<string, [MasterChainSlotStatus, MasterChainSlotStatus]> {
  return useContext(ChannelChainStatusCtx)
}

// eslint-disable-next-line react-refresh/only-export-components -- context hook, not a component
export function useChannelChainError(): Record<string, [string | null, string | null]> {
  return useContext(ChannelChainErrorCtx)
}
```

- [ ] **Step 6: Full verification**

```bash
npm run typecheck
npm run lint
npx vitest run
```

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/state/StoreContext.tsx
git commit -m "Add per-channel plugin status/error tracking + load-diffing effect to StoreContext"
```

---

### Task 10: UI — `ChannelChainPanel.tsx` + "chain" button on `ChannelRow`

**Files:**
- Create: `src/renderer/src/components/ChannelChainPanel.tsx`
- Modify: `src/renderer/src/components/ChannelRow.tsx`

Reuses `MasterChainPanel.tsx`'s exact button/select styling helpers and `PluginCatalogBrowser.tsx` completely unchanged (it's already plugin-agnostic — just needs an `onSelect` callback, which a per-channel caller provides naturally).

- [ ] **Step 1: Write `ChannelChainPanel.tsx`**, a 2-slot version of `MasterChainPanel.tsx` parameterized by `channelId`:

```tsx
// src/renderer/src/components/ChannelChainPanel.tsx
import { useState } from 'react'
import {
  useAppState,
  useDispatch,
  useChannelChainStatus,
  useChannelChainError,
  usePluginCatalog,
  usePluginScanState,
  usePluginCatalogActions
} from '../state/StoreContext'
import { PluginCatalogBrowser } from './PluginCatalogBrowser'

const SLOT_LABELS = ['1', '2'] as const

function buttonStyle(disabled?: boolean): React.CSSProperties {
  return {
    fontFamily: 'inherit',
    fontSize: 10,
    padding: '3px 8px',
    background: 'var(--ra-bg-row-active)',
    border: `1px solid ${disabled ? 'var(--ra-border-soft)' : 'var(--ra-border)'}`,
    borderRadius: 2,
    color: disabled ? 'var(--ra-text-4)' : 'var(--ra-text-2)',
    cursor: disabled ? 'default' : 'pointer'
  }
}

const selectStyle: React.CSSProperties = {
  fontFamily: 'inherit',
  fontSize: 11,
  padding: '3px 4px',
  background: 'var(--ra-bg-row)',
  border: '1px solid var(--ra-border)',
  borderRadius: 2,
  color: 'var(--ra-text)'
}

export function ChannelChainPanel({
  channelId,
  onClose
}: {
  channelId: string
  onClose: () => void
}): React.JSX.Element {
  const state = useAppState()
  const dispatch = useDispatch()
  const status = useChannelChainStatus()[channelId] ?? ['idle', 'idle']
  const error = useChannelChainError()[channelId] ?? [null, null]
  const catalog = usePluginCatalog()
  const { scanning, progress } = usePluginScanState()
  const { triggerScan } = usePluginCatalogActions()
  const favourites = catalog.plugins.filter((p) => catalog.favouriteIds.includes(p.id))
  const [browsingSlot, setBrowsingSlot] = useState<number | null>(null)
  const slots = state.channelPlugins[channelId] ?? [null, null]

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: 'rgba(0, 0, 0, 0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--ra-bg-row-active)',
          border: '1px solid var(--ra-border)',
          borderRadius: 4,
          padding: 10,
          width: 300,
          fontSize: 11
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ color: 'var(--ra-text-2)' }}>channel chain</span>
          <button onClick={onClose} aria-label="Close channel chain panel" style={buttonStyle()}>
            ×
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <button onClick={triggerScan} disabled={scanning} style={buttonStyle(scanning)}>
            {scanning ? `scanning... ${progress ? `${progress.done}/${progress.total}` : ''}` : 'scan for plugins'}
          </button>
        </div>
        {SLOT_LABELS.map((label, slot) => {
          const pluginId = slots[slot]
          const slotStatus = status[slot]
          const slotError = error[slot]
          const editDisabled = slotStatus !== 'loaded'
          return (
            <div
              key={slot}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0' }}
              title={slotError ?? undefined}
            >
              <span style={{ color: 'var(--ra-text-2)', width: 12 }}>{label}</span>
              <select
                value={pluginId ?? ''}
                onChange={(e) => {
                  if (e.target.value === '__browse__') {
                    setBrowsingSlot(slot)
                    return
                  }
                  dispatch({
                    type: 'SET_CHANNEL_CHAIN_PLUGIN',
                    channelId,
                    slot: slot as 0 | 1,
                    pluginId: e.target.value === '' ? null : e.target.value
                  })
                }}
                style={{ ...selectStyle, flex: 1 }}
              >
                <option value="">none</option>
                {favourites.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
                <option value="__browse__">browse all...</option>
              </select>
              <span
                aria-label={`channel ${channelId} slot ${label} status: ${slotStatus}`}
                title={slotStatus}
                style={{
                  width: 9,
                  height: 9,
                  flexShrink: 0,
                  borderRadius: '50%',
                  background:
                    slotStatus === 'loaded'
                      ? 'var(--ra-stretch-on)'
                      : slotStatus === 'error'
                        ? 'var(--ra-mute-on)'
                        : slotStatus === 'loading'
                          ? 'var(--ra-type-notes)'
                          : 'var(--ra-border-strong)'
                }}
              />
              <button
                onClick={() => void window.rifffApi.engineOpenChannelPluginEditor(channelId, slot)}
                disabled={editDisabled}
                aria-label={`edit channel ${channelId} slot ${label} plugin`}
                style={buttonStyle(editDisabled)}
              >
                edit
              </button>
            </div>
          )
        })}
      </div>
      {browsingSlot !== null && (
        <PluginCatalogBrowser
          onSelect={(id) =>
            dispatch({
              type: 'SET_CHANNEL_CHAIN_PLUGIN',
              channelId,
              slot: browsingSlot as 0 | 1,
              pluginId: id
            })
          }
          onClose={() => setBrowsingSlot(null)}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Add a "chain" button to `ChannelRow.tsx`**

```tsx
import type { Rifff } from '@shared/types'
import { useState } from 'react'
import { RifffBlockRow } from './RifffBlockRow'
import { ChannelChainPanel } from './ChannelChainPanel'

export function ChannelRow({
  channelId,
  rifffs,
  onOpenContextMenu,
  onDropOnChannel
}: {
  channelId: string
  rifffs: Rifff[]
  onOpenContextMenu: (x: number, y: number, groupId: string) => void
  onDropOnChannel: (e: React.DragEvent<HTMLDivElement>, channelId: string) => void
}): React.JSX.Element {
  const [chainPanelOpen, setChainPanelOpen] = useState(false)

  return (
    <div
      data-channel-id={channelId}
      onDrop={(e) => onDropOnChannel(e, channelId)}
      style={{ position: 'relative' }}
    >
      <button
        onClick={(e) => {
          e.stopPropagation()
          setChainPanelOpen(true)
        }}
        aria-label={`channel ${channelId} plugin chain`}
        title="channel plugin chain"
        style={{
          position: 'absolute',
          top: 2,
          left: 2,
          zIndex: 5,
          fontSize: 9,
          padding: '1px 4px',
          fontFamily: 'inherit',
          background: 'var(--ra-bg-row-active)',
          border: '1px solid var(--ra-border)',
          borderRadius: 2,
          color: 'var(--ra-text-2)',
          cursor: 'pointer'
        }}
      >
        fx
      </button>
      {rifffs.map((rifff) => (
        <RifffBlockRow
          key={rifff.groupId}
          groupId={rifff.groupId}
          onOpenContextMenu={onOpenContextMenu}
        />
      ))}
      {chainPanelOpen && (
        <ChannelChainPanel channelId={channelId} onClose={() => setChainPanelOpen(false)} />
      )}
    </div>
  )
}
```

(`stopPropagation` on the button's own click so a click there doesn't also trigger whatever the row's own click-to-select handling does, if `RifffBlockRow` or an ancestor has one — check `App.tsx`'s Timeline for any row-level click handler before finalizing; if none exists, the `stopPropagation` is harmless defensive code either way. The button is small and positioned at the row's top-left corner — it may visually sit near a bar-0 clip's own corner; this is an accepted v1 simplification, not a bug, since this app's channels have no persistent header/gutter area today.)

- [ ] **Step 3: Full verification**

```bash
npm run typecheck
npm run lint
npx vitest run
```

- [ ] **Step 4: Manual verification (not automatable)** — start the dev server, confirm the "fx" button appears on a channel row and opens/closes the panel.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/ChannelChainPanel.tsx src/renderer/src/components/ChannelRow.tsx
git commit -m "Add ChannelChainPanel + chain button on ChannelRow"
```

---

### Task 11: Final verification + manual walkthrough

No further code changes planned — verification and report only.

**This task's manual walkthrough is the real pass/fail signal for whether the new per-channel accumulation stage and dynamic chain lifecycle actually behave as designed** — matching this session's own established convention for real-time-audio-adjacent work (the master chain's GUI-app-conversion/editor-window tasks, the plugin scan's real-directory-scan task).

- [ ] **Step 1: Full native build+test**

```bash
cd native-engine && cmake --build build && ./build/ssstitch_engine_artefacts/ssstitch-engine.app/Contents/MacOS/ssstitch-engine --test
```

- [ ] **Step 2: Full renderer/shared/main verification**

```bash
npm run typecheck
npm run lint
npx vitest run
```

- [ ] **Step 3: Production build**

```bash
npx electron-vite build
```

- [ ] **Step 4: Dev-server restart + manual walkthrough** (required, not automatable)

```bash
pkill -9 -f "Claudecode/ssstitch"
nohup npm run dev > /tmp/ssstitch-dev.log 2>&1 & disown
```

Walk through, and report honestly on each:
- Load a plugin onto a channel via the new "fx" button, confirm it's audible during live playback.
- Confirm export produces a mix reflecting that channel plugin (not just the master chain).
- Load a plugin into slot 2 as well, confirm both process in series on that channel (order matters, same test approach as the master chain's own manual walkthrough — a gain-heavy plugin before vs. after a compressor should sound audibly different depending on slot order).
- Remove the last clip from a channel with a loaded plugin, confirm its plugin status/UI disappears; drag a brand-new, unrelated clip onto a freshly-created channel and confirm it does NOT inherit the old channel's plugin state (proves the delete-on-empty lifecycle actually works, not just that the UI happens to look empty).
- Open a channel plugin's editor window, confirm it behaves like the master chain's own (already proven this session against a real installed plugin) — close it, confirm the plugin keeps processing.
- With two clips sharing one channel (DAW mode's own multi-clip-per-channel feature), confirm a channel plugin applies to their combined signal, not just one of them.

- [ ] **Step 5: Report**

Summarize what passed, what didn't. Be explicit and honest about the two highest-risk pieces: whether `renderBlock`'s restructuring genuinely produces correct, click-free audio (not just "it compiled and the regression test passed" — actually listen if you can, or clearly state you couldn't), and whether the `ChannelChainRegistry`'s atomic-swap lifecycle held up under real use (rapid channel creation/deletion via normal dragging) without any crash or leaked/stuck plugin state. No commit for this task unless a step needed a fix.
