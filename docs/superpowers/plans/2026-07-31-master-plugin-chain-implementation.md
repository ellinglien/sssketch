# Master Plugin Chain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 4-slot serial plugin insert chain on the arranger's master output — curated VST3 allowlist, real-time-safe load/swap, live playback + export parity, and real native plugin editor windows.

**Architecture:** A new native `MasterChain` class (ported from the reverted `SendBus`'s real-time-safe load/swap pattern) processes the mixed `outL`/`outR` buffer in series once per audio callback, in both `Transport.cpp` (live) and `RenderExport.cpp` (offline). `EngineProject` grows a `masterChain` field carried over the existing `load-project` IPC message; actual plugin loading is a separate `load-master-plugin` message. Editor windows require converting `native-engine`'s CMake target from a console app to a GUI app — flagged as the plan's highest-risk, unspiked task.

**Tech Stack:** JUCE 8.0.4 / C++20 (native-engine), Electron/React/TypeScript (renderer + main), Vitest, `juce::UnitTestRunner`.

---

**Full spec:** `docs/superpowers/specs/2026-07-31-master-plugin-chain-design.md` — read it before starting; this plan implements it task by task.

**Native build+test command** (used throughout this plan):
```bash
cd native-engine && cmake --build build && ./build/ssstitch_engine_artefacts/Debug/ssstitch_engine --test
```

**Renderer/shared/main verification commands** (used throughout this plan):
```bash
npm run typecheck
npm run lint
npx vitest run
```

---

### Task 1: Native `MasterChain` — in-series processing + NaN/Inf guard

**Files:**
- Create: `native-engine/Source/MasterChain.h`
- Create: `native-engine/Source/MasterChain.cpp`
- Create: `native-engine/Source/MasterChainTests.cpp`
- Modify: `native-engine/CMakeLists.txt:20-46` (add the three new files to `target_sources`)

No load/swap yet — this task only proves "process the buffer through N plugins in series, dropping NaN/Inf between stages" using a fake in-process instantiator, matching how the reverted `SendBus.h`'s `Instantiator` typedef let tests avoid depending on a real installed plugin.

- [ ] **Step 1: Write `MasterChain.h`**

```cpp
// native-engine/Source/MasterChain.h
#pragma once
#include <juce_audio_processors/juce_audio_processors.h>
#include <array>
#include <atomic>
#include <functional>
#include <memory>

namespace ssstitch
{
    static constexpr int kNumMasterChainSlots = 4;

    /** Owns up to kNumMasterChainSlots live plugin instances, processed IN
     * SERIES (slot 0 -> 1 -> 2 -> 3) over the final mixed master output. See
     * docs/superpowers/specs/2026-07-31-master-plugin-chain-design.md for
     * the full rationale — this is the master-insert-chain equivalent of
     * the reverted SendBus's parallel-send design, reusing its real-time-
     * safe load/swap pattern unchanged.
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
    class MasterChain
    {
    public:
        /** A plugin id -> live processor instance factory. Production code
         * uses the default (the real allowlist + AudioPluginFormatManager,
         * see .cpp); tests inject a fake to exercise the swap/processing
         * logic without depending on a real installed plugin. An empty
         * `pluginId` must return nullptr with `errorOut` left empty (not an
         * error — "no plugin" is a valid, silent/passthrough state). */
        using Instantiator = std::function<std::unique_ptr<juce::AudioProcessor>(
            const juce::String& pluginId, double sampleRate, int blockSize, juce::String& errorOut)>;

        explicit MasterChain(Instantiator instantiator = &MasterChain::defaultInstantiate);
        ~MasterChain();

        MasterChain(const MasterChain&) = delete;
        MasterChain& operator=(const MasterChain&) = delete;

        /** Message-thread API: kicks off loading `pluginId` (an allowlist
         * id, or an empty string for "no plugin") onto `slotIndex` on a
         * background thread. Safe to call again before a previous load for
         * the same slot finishes — whichever completes last wins (see
         * .cpp). `onLoaded` runs on that background thread once the load
         * finishes or fails; callers needing the message thread (e.g. to
         * send an IPC reply) must hop back to it themselves. */
        void requestLoad(
            int slotIndex,
            const juce::String& pluginId,
            double sampleRate,
            int blockSize,
            std::function<void(bool success, const juce::String& error)> onLoaded);

        /** Synchronous, blocking load — offline export only, where nothing
         * concurrently reads this slot from an audio thread. Returns false
         * (errorOut set) on failure, leaving the slot unchanged. */
        bool loadPluginSync(
            int slotIndex, const juce::String& pluginId, double sampleRate, int blockSize, juce::String& errorOut);

        /** Audio-thread API: promotes any slot with a ready pending swap to
         * active; the instance it replaces is handed to a background
         * cleanup thread rather than deleted here (a plugin's destructor
         * can do real work). Call once per block, before process(). */
        void applyPendingSwaps();

        /** Audio-thread API: runs outL/outR through every loaded slot's
         * plugin in series (slot 0 first), dropping any non-finite
         * (NaN/Inf) sample after each slot so one misbehaving plugin can't
         * corrupt the rest of the chain or the device output. An empty
         * slot is skipped (pure passthrough). Call once per device
         * callback, on the FINAL mixed output buffer for that callback —
         * not per PlaybackEngine::renderBlock call, since a callback can
         * split across multiple renderBlock calls at a loop boundary. */
        void process(int numSamples, float* outL, float* outR);

    private:
        static std::unique_ptr<juce::AudioProcessor> defaultInstantiate(
            const juce::String& pluginId, double sampleRate, int blockSize, juce::String& errorOut);

        struct Slot
        {
            std::unique_ptr<juce::AudioProcessor> active;
            int processChannels = 2; // max(active's total input, total output) once a plugin is loaded
            std::atomic<juce::AudioProcessor*> pending { nullptr };
            std::atomic<bool> pendingReady { false };
            juce::AudioBuffer<float> scratch;
        };

        std::array<Slot, kNumMasterChainSlots> slots;
        Instantiator instantiator;
    };
}
```

- [ ] **Step 2: Write `MasterChainTests.cpp` exercising in-series processing + the NaN guard**

```cpp
// native-engine/Source/MasterChainTests.cpp
#include "MasterChain.h"
#include <juce_audio_processors/juce_audio_processors.h>

namespace ssstitch
{
    namespace
    {
        /** A trivial test plugin: multiplies every sample by `gain`. Used to
         * prove slots run IN SERIES (order matters) rather than in parallel. */
        class GainTestPlugin : public juce::AudioProcessor
        {
        public:
            explicit GainTestPlugin(float g) : gain(g) {}
            const juce::String getName() const override { return "GainTestPlugin"; }
            void prepareToPlay(double, int) override {}
            void releaseResources() override {}
            void processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer&) override
            {
                buffer.applyGain(gain);
            }
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

        /** Writes a constant NaN into every sample it processes — proves
         * process() drops non-finite output before it reaches outL/outR. */
        class NanTestPlugin : public juce::AudioProcessor
        {
        public:
            const juce::String getName() const override { return "NanTestPlugin"; }
            void prepareToPlay(double, int) override {}
            void releaseResources() override {}
            void processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer&) override
            {
                for (int ch = 0; ch < buffer.getNumChannels(); ++ch)
                    buffer.clear(ch, 0, buffer.getNumSamples()), buffer.addSample(ch, 0, std::nanf(""));
            }
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
        };

        MasterChain::Instantiator fakeInstantiator(std::map<int, float> gainsBySlot, bool slotProducesNan = false)
        {
            // Captured by value into the returned std::function; slotIndex isn't
            // known at instantiation time (only pluginId is), so tests instead
            // encode "which slot" into the pluginId itself (e.g. "gain:0").
            return [gainsBySlot, slotProducesNan](
                       const juce::String& pluginId, double, int, juce::String& errorOut) -> std::unique_ptr<juce::AudioProcessor>
            {
                errorOut = {};
                if (pluginId.isEmpty())
                    return nullptr;
                if (pluginId == "nan-plugin")
                    return std::make_unique<NanTestPlugin>();
                if (pluginId.startsWith("gain:"))
                {
                    const int slot = pluginId.fromFirstOccurrenceOf(":", false, false).getIntValue();
                    return std::make_unique<GainTestPlugin>(gainsBySlot.at(slot));
                }
                errorOut = "unknown test plugin id";
                return nullptr;
            };
        }

        class MasterChainTests : public juce::UnitTest
        {
        public:
            MasterChainTests() : juce::UnitTest("MasterChain", "MasterChain") {}

            void runTest() override
            {
                beginTest("empty chain is a no-op passthrough");
                {
                    MasterChain chain;
                    chain.applyPendingSwaps();
                    float l[4] = { 1.0f, 2.0f, 3.0f, 4.0f };
                    float r[4] = { 1.0f, 2.0f, 3.0f, 4.0f };
                    chain.process(4, l, r);
                    expectEquals(l[0], 1.0f);
                    expectEquals(r[3], 4.0f);
                }

                beginTest("two slots process in series, order matters");
                {
                    // Slot 0 halves, slot 1 halves again -> net *0.25, not *0.5 as
                    // parallel accumulation would produce.
                    MasterChain chain(fakeInstantiator({ { 0, 0.5f }, { 1, 0.5f } }));
                    juce::String err;
                    expect(chain.loadPluginSync(0, "gain:0", 44100.0, 512, err));
                    expect(chain.loadPluginSync(1, "gain:1", 44100.0, 512, err));

                    float l[2] = { 8.0f, 4.0f };
                    float r[2] = { 8.0f, 4.0f };
                    chain.process(2, l, r);
                    expectWithinAbsoluteError(l[0], 2.0f, 0.0001f); // 8 * 0.5 * 0.5
                    expectWithinAbsoluteError(r[1], 1.0f, 0.0001f); // 4 * 0.5 * 0.5
                }

                beginTest("a non-finite sample from one slot is dropped, not propagated");
                {
                    MasterChain chain(fakeInstantiator({}, true));
                    juce::String err;
                    expect(chain.loadPluginSync(0, "nan-plugin", 44100.0, 512, err));

                    float l[1] = { 5.0f };
                    float r[1] = { 5.0f };
                    chain.process(1, l, r);
                    expect(std::isfinite(l[0]));
                    expect(std::isfinite(r[0]));
                }
            }
        };

        static MasterChainTests masterChainTests;
    }
}
```

- [ ] **Step 3: Write `MasterChain.cpp`** (in-series `process`, no load/swap logic used yet by the tests above beyond `loadPluginSync`)

```cpp
// native-engine/Source/MasterChain.cpp
#include "MasterChain.h"
#include <algorithm>
#include <cmath>
#include <thread>

namespace ssstitch
{
    MasterChain::MasterChain(Instantiator inst) : instantiator(std::move(inst)) {}

    MasterChain::~MasterChain()
    {
        // Any pending instance that never got promoted is still owned here.
        // A background load still in flight at destruction time only holds
        // this object's `slots` array by reference and a plain juce::String
        // copy of the plugin id — it finishes harmlessly into a Slot that's
        // about to go away, or the process exits first. Not a concern for
        // this app's actual lifecycle (a short-lived engine process killed
        // by the parent Electron process on quit).
        for (auto& slot : slots)
            delete slot.pending.exchange(nullptr);
    }

    void MasterChain::applyPendingSwaps()
    {
        for (auto& slot : slots)
        {
            if (!slot.pendingReady.exchange(false))
                continue;
            auto* newInstance = slot.pending.exchange(nullptr);
            if (newInstance == nullptr)
                continue; // defensive: shouldn't happen if pendingReady was true
            auto old = std::move(slot.active);
            slot.active.reset(newInstance);
            slot.processChannels = std::max(
                { 2, slot.active->getTotalNumInputChannels(), slot.active->getTotalNumOutputChannels() });
            if (old != nullptr)
            {
                auto* toDelete = old.release();
                std::thread([toDelete]() { delete toDelete; }).detach();
            }
        }
    }

    void MasterChain::process(int numSamples, float* outL, float* outR)
    {
        juce::MidiBuffer midi;
        for (auto& slot : slots)
        {
            if (slot.active == nullptr)
                continue; // empty slot = passthrough, not a break in the chain

            if (slot.scratch.getNumSamples() != numSamples || slot.scratch.getNumChannels() != slot.processChannels)
                slot.scratch.setSize(slot.processChannels, numSamples, false, false, true);
            slot.scratch.clear();
            for (int i = 0; i < numSamples; ++i)
            {
                slot.scratch.setSample(0, i, outL[i]);
                slot.scratch.setSample(1, i, outR[i]);
            }

            slot.active->processBlock(slot.scratch, midi);
            midi.clear();

            for (int i = 0; i < numSamples; ++i)
            {
                // Feeds the NEXT slot in the chain — a misbehaving plugin
                // (e.g. one loaded with a sample rate/block size that
                // doesn't match what it actually receives) can produce
                // NaN/Inf. Since this is a serial chain, letting one
                // through would corrupt every downstream slot AND the
                // device output. Treat it as silence instead.
                const float l = slot.scratch.getSample(0, i);
                const float r = slot.scratch.getSample(1, i);
                outL[i] = std::isfinite(l) ? l : 0.0f;
                outR[i] = std::isfinite(r) ? r : 0.0f;
            }
        }
    }

    static std::unique_ptr<juce::AudioProcessor> instantiateFromAllowlist(
        const juce::String& pluginId, double sampleRate, int blockSize, juce::String& errorOut);
    // Defined in Task 4 once MasterChainAllowlist.h exists; declared here so
    // defaultInstantiate below compiles standalone in this task. Task 4
    // provides the real definition and includes MasterChainAllowlist.h.

    std::unique_ptr<juce::AudioProcessor> MasterChain::defaultInstantiate(
        const juce::String& pluginId, double sampleRate, int blockSize, juce::String& errorOut)
    {
        return instantiateFromAllowlist(pluginId, sampleRate, blockSize, errorOut);
    }

    bool MasterChain::loadPluginSync(
        int slotIndex, const juce::String& pluginId, double sampleRate, int blockSize, juce::String& errorOut)
    {
        auto instance = instantiator(pluginId, sampleRate, blockSize, errorOut);
        if (!errorOut.isEmpty())
            return false;
        auto& slot = slots[(size_t) slotIndex];
        slot.active = std::move(instance); // nullptr (empty pluginId) is a valid "no plugin" state
        slot.processChannels = slot.active != nullptr
            ? std::max({ 2, slot.active->getTotalNumInputChannels(), slot.active->getTotalNumOutputChannels() })
            : 2;
        return true;
    }

    void MasterChain::requestLoad(
        int slotIndex,
        const juce::String& pluginId,
        double sampleRate,
        int blockSize,
        std::function<void(bool, const juce::String&)> onLoaded)
    {
        auto& slot = slots[(size_t) slotIndex];
        std::thread([this, &slot, pluginId, sampleRate, blockSize, onLoaded]()
        {
            juce::String error;
            auto instance = instantiator(pluginId, sampleRate, blockSize, error);
            const bool success = error.isEmpty();

            if (success)
            {
                auto* raw = instance.release();
                delete slot.pending.exchange(raw);
                slot.pendingReady.store(true);
            }

            if (onLoaded)
                onLoaded(success, error);
        }).detach();
    }
}
```

**Note for the implementer:** `instantiateFromAllowlist`'s forward declaration above is a placeholder that will NOT link (no definition exists yet) — this task's tests only exercise `loadPluginSync`/`requestLoad` with a fake `Instantiator` injected via the constructor, never `defaultInstantiate`, so the missing symbol is never actually called and the test binary should still link fine as long as it's never referenced from a code path the linker can't eliminate. If the linker complains, provide a minimal stub returning `nullptr` in this task and replace it for real in Task 4 — note which you did.

- [ ] **Step 4: Add the three new files to `CMakeLists.txt`**

```cmake
  Source/MasterChain.cpp
  Source/MasterChainTests.cpp
```
(inserted alongside the other `*Tests.cpp` entries in `target_sources`, e.g. right after `Source/PluginScanner.cpp`/`Source/PluginScannerTests.cpp`)

- [ ] **Step 5: Build and run tests**

```bash
cd native-engine && cmake --build build && ./build/ssstitch_engine_artefacts/Debug/ssstitch_engine --test
```
Expected: all existing suites still pass, plus the new `MasterChain` suite (3 tests) passes.

- [ ] **Step 6: Commit**

```bash
git add native-engine/Source/MasterChain.h native-engine/Source/MasterChain.cpp native-engine/Source/MasterChainTests.cpp native-engine/CMakeLists.txt
git commit -m "Add native MasterChain: in-series processing + NaN/Inf guard"
```

---

### Task 2: Native allowlist + real-time-safe load/swap

**Files:**
- Create: `native-engine/Source/MasterChainAllowlist.h`
- Modify: `native-engine/Source/MasterChain.cpp` (replace the Task 1 placeholder with the real `instantiateFromAllowlist`)
- Modify: `native-engine/CMakeLists.txt` (no new source files — header-only allowlist)

Reuses the reverted `SendPluginAllowlist.h`/`instantiateFromAllowlist` content unchanged in substance (recovered via `git show 21df0fb^:native-engine/Source/SendPluginAllowlist.h` and `git show 21df0fb^:native-engine/Source/SendBus.cpp`), renamed for this feature.

- [ ] **Step 1: Write `MasterChainAllowlist.h`**

```cpp
// native-engine/Source/MasterChainAllowlist.h
#pragma once
#include <juce_core/juce_core.h>
#include <array>

namespace ssstitch
{
    /** Curated, hardcoded VST3 allowlist for the master plugin chain — NOT a
     * directory scan (see docs/superpowers/specs/2026-07-31-master-plugin-chain-design.md
     * for why: JUCE's AU scanner has real bugs against some installed
     * bundles, per native-engine/PHASE0_FINDINGS.md). Kept in sync by hand
     * with the renderer twin, src/shared/masterChainAllowlist.ts — same
     * convention as this codebase's SchedulePlayback.cpp/schedulePlayback.ts
     * pair. Paths are hardcoded to this machine, matching the single-user
     * scope of this app. */
    struct MasterChainAllowlistEntry
    {
        const char* id;
        const char* path;
    };

    static constexpr std::array<MasterChainAllowlistEntry, 5> kMasterChainAllowlist { {
        { "solid-bus-comp", "/Library/Audio/Plug-Ins/VST3/Solid Bus Comp.vst3" },
        { "pro-q-3", "/Library/Audio/Plug-Ins/VST3/FabFilter Pro-Q 3.vst3" },
        { "soothe2", "/Library/Audio/Plug-Ins/VST3/soothe2.vst3" },
        { "sausage-fattener", "/Library/Audio/Plug-Ins/VST3/SausageFattener.vst3" },
        { "sunset-sound-reverb", "/Library/Audio/Plug-Ins/VST3/TR5 Sunset Sound Studio Reverb.vst3" }
    } };

    inline const MasterChainAllowlistEntry* findMasterChainPlugin(const juce::String& id)
    {
        for (const auto& entry : kMasterChainAllowlist)
            if (id == entry.id)
                return &entry;
        return nullptr;
    }
}
```

- [ ] **Step 2: Replace the Task 1 placeholder in `MasterChain.cpp`**

Remove the forward declaration + placeholder comment from Task 1's Step 3, and add near the top of the file:

```cpp
#include "MasterChainAllowlist.h"
```

Then replace the `instantiateFromAllowlist` forward declaration with its real definition, placed just above `MasterChain::defaultInstantiate`:

```cpp
    static std::unique_ptr<juce::AudioProcessor> instantiateFromAllowlist(
        const juce::String& pluginId, double sampleRate, int blockSize, juce::String& errorOut)
    {
        if (pluginId.isEmpty())
        {
            errorOut = {};
            return nullptr; // "no plugin" is a valid, silent/passthrough state -- not an error
        }

        const auto* entry = findMasterChainPlugin(pluginId);
        if (entry == nullptr)
        {
            errorOut = "unknown plugin id: " + pluginId;
            return nullptr;
        }

        juce::AudioPluginFormatManager formatManager;
        formatManager.addDefaultFormats();

        juce::Array<juce::PluginDescription> found;
        for (auto* format : formatManager.getFormats())
        {
            if (!format->fileMightContainThisPluginType(entry->path))
                continue;
            juce::KnownPluginList knownPlugins;
            juce::OwnedArray<juce::PluginDescription> typesFound;
            knownPlugins.scanAndAddFile(entry->path, false, typesFound, *format);
            for (auto* desc : typesFound)
                found.add(*desc);
        }
        if (found.isEmpty())
        {
            errorOut = "plugin not found at expected path: " + juce::String(entry->path);
            return nullptr;
        }

        auto instance = formatManager.createPluginInstance(found.getReference(0), sampleRate, blockSize, errorOut);
        if (instance == nullptr)
            return nullptr;
        instance->prepareToPlay(sampleRate, blockSize);
        return instance; // AudioPluginInstance IS-A AudioProcessor
    }
```

- [ ] **Step 3: Build and run tests**

```bash
cd native-engine && cmake --build build && ./build/ssstitch_engine_artefacts/Debug/ssstitch_engine --test
```
Expected: all suites still pass (Task 1's fake-instantiator tests are unaffected; `defaultInstantiate`/`instantiateFromAllowlist` aren't exercised by any test yet — that's Task 4's job, once real load/swap flows through IPC and can be verified manually against an actually-installed plugin).

- [ ] **Step 4: Commit**

```bash
git add native-engine/Source/MasterChainAllowlist.h native-engine/Source/MasterChain.cpp
git commit -m "Add master chain plugin allowlist + real instantiation path"
```

---

### Task 3: Wire `MasterChain` into `Transport.cpp` and `RenderExport.cpp`

**Files:**
- Modify: `native-engine/Source/Transport.h`
- Modify: `native-engine/Source/Transport.cpp`
- Modify: `native-engine/Source/RenderExport.h`
- Modify: `native-engine/Source/RenderExport.cpp`
- Modify: `native-engine/Source/TransportTests.cpp` (check existing tests still construct `Transport` correctly — this task changes its constructor)

This is the task most adjacent to real audio correctness in the whole plan — read `native-engine/Source/Transport.cpp:130-261` (`audioDeviceIOCallbackWithContext`) in full before starting. `MasterChain::process` must run exactly once per device callback, on the real `outL`/`outR` output buffer, AFTER `renderLoopAware` has finished writing to it (which may itself call `PlaybackEngine::renderBlock` more than once, for loop-boundary splitting) — but BEFORE the halt-fade/reposition-fade gain multiplication that follows in the same function, so a click-prevention fade is the very last thing applied to the signal, same as today. Skip it entirely on the "fully halted, true silence" early-return path (`return` at line 176) — there's no real audio content to process there, only an already-cleared silent buffer.

Also add the real device sample rate / block size accessors this task needs (these existed before the send-bus revert removed them — recovered via `git show 0e51549 -- native-engine/Source/Transport.h`).

- [ ] **Step 1: Add sample-rate/block-size accessors and a `MasterChain&` to `Transport`**

In `native-engine/Source/Transport.h`, add after `bool isPlaying() const { return playing.load(); }` (line 49):

```cpp
        /** The real audio device's own sample rate / callback block size —
         * used when loading a master-chain plugin live, so prepareToPlay()
         * is told the truth instead of an arbitrary hardcoded guess. A
         * plugin prepared for the wrong block size can be called with a
         * processBlock() buffer larger than it allocated internal storage
         * for (undefined behaviour, often a crash); a plugin prepared for
         * the wrong sample rate mistunes any rate-dependent internal
         * coefficients (envelope followers, filters). Defaults (44100Hz /
         * 512 samples) only apply before the device has ever started. */
        double currentSampleRate() const { return deviceSampleRate; }
        int currentBlockSize() const { return deviceBlockSize; }
```

Change the constructor signature (line 20) and add a `MasterChain&` member:

```cpp
        explicit Transport(PlaybackEngine& engine, MasterChain& masterChain);
```

Add `#include "MasterChain.h"` near the top, and add a private member near `PlaybackEngine& engine;` (line 82):

```cpp
        PlaybackEngine& engine;
        MasterChain& masterChain;
```

Add `int deviceBlockSize = 512;` right after `double deviceSampleRate = 44100.0;` (line 104).

- [ ] **Step 2: Update `Transport.cpp`**

Constructor (line 27):
```cpp
    Transport::Transport(PlaybackEngine& e, MasterChain& mc) : engine(e), masterChain(mc) {}
```

`audioDeviceAboutToStart` (line 263-266):
```cpp
    void Transport::audioDeviceAboutToStart(juce::AudioIODevice* device)
    {
        deviceSampleRate = device->getCurrentSampleRate();
        deviceBlockSize = device->getCurrentBufferSizeSamples();
    }
```

In `audioDeviceIOCallbackWithContext`, add `masterChain.applyPendingSwaps();` as the very first line of the function body (before the `numOutputChannels < 2` guard at line 135) — cheap, must run every callback regardless of playback state, matching the same "check every block" cadence the reverted `SendBus::applyPendingSwaps()` used.

Then insert `masterChain.process(numSamples, outL, outR);` at each of the three places real audio was just rendered into `outL`/`outR`, immediately after the render call and BEFORE that block's own fade-gain loop:

1. In the `if (repositioning)` branch (after line 204's `renderLoopAware` call, before line 205's `for` fade loop):
```cpp
            const double pos = positionBars.load();
            const double newPos = renderLoopAware(pos, numSamples, outL, outR);
            masterChain.process(numSamples, outL, outR);
            for (int i = 0; i < numSamples; ++i)
```

2. In the main path (after line 235's `renderLoopAware` call, before line 237's `if (fadingOut)`):
```cpp
        const double pos = positionBars.load();
        const double newPos = renderLoopAware(pos, numSamples, outL, outR);
        masterChain.process(numSamples, outL, outR);

        if (fadingOut)
```

Do **not** add a `masterChain.process` call inside `renderLoopAware` itself, and do not add one on the "fully halted" early return (line 168-177) — that path never calls `renderLoopAware` at all, `outL`/`outR` are already all-zero from the `FloatVectorOperations::clear` at the top of the function, and there's no real signal for the chain to process.

- [ ] **Step 3: Update `RenderExport.cpp`/`.h` for export parity**

In `RenderExport.h`, no signature change needed for `renderProjectToWavFile` (it already takes the whole `project`, which will carry `masterChain` once Task 4 lands) — but note in a comment that it now also processes the master chain; add this above the function declaration:

```cpp
    /** Renders `project` offline to a 16-bit stereo WAV at `outputPath`, covering
     * `durationBars` bars from position 0, including the project's own master
     * plugin chain (see EngineProject::masterChain) processed in series over
     * each rendered block — matches live playback exactly. Returns false (with
     * errorOut set) on any failure — invalid bpm, can't open the output path,
     * can't create the WAV writer, or a master-chain plugin failing to load
     * (see MasterChain::loadPluginSync). Shared by --render-test (Main.cpp) and
     * the render-export IPC message (IpcServer.cpp) — exactly one
     * implementation of "render this project to this file." */
```

In `RenderExport.cpp`, add `#include "MasterChain.h"`, construct a local `MasterChain` right after the local `PlaybackEngine`, load each of `project.masterChain`'s slots synchronously (export has no real-time deadline), and process every rendered block through it:

```cpp
    bool renderProjectToWavFile(
        const EngineProject& project,
        const juce::String& outputPath,
        double durationBars,
        juce::String& errorOut)
    {
        StemBufferCache bufferCache;
        PlaybackEngine engine(bufferCache);
        engine.setProject(project);

        const double sampleRate = 44100.0;
        const int blockSize = 512;

        MasterChain masterChain;
        for (int slot = 0; slot < kNumMasterChainSlots; ++slot)
        {
            const auto& pluginId = project.masterChain[(size_t) slot];
            juce::String slotError;
            if (!masterChain.loadPluginSync(slot, pluginId, sampleRate, blockSize, slotError))
            {
                errorOut = "master chain slot " + juce::String(slot) + " failed to load: " + slotError;
                return false;
            }
        }
        masterChain.applyPendingSwaps(); // loadPluginSync sets `active` directly, but this keeps the two code paths structurally identical -- harmless no-op here since there's never a pending swap from a sync load

        const double secPerBar = project.bpm > 0.0 ? (60.0 / project.bpm) * 4.0 : 0.0;
        if (secPerBar <= 0.0)
        {
            errorOut = "project has an invalid bpm";
            return false;
        }
        const int totalSamples = (int) std::ceil(durationBars * secPerBar * sampleRate);

        juce::AudioBuffer<float> output(2, juce::jmax(1, totalSamples));
        output.clear();

        for (int startSample = 0; startSample < totalSamples; startSample += blockSize)
        {
            const int numSamples = juce::jmin(blockSize, totalSamples - startSample);
            const double positionBars = (startSample / sampleRate) / secPerBar;
            auto* l = output.getWritePointer(0, startSample);
            auto* r = output.getWritePointer(1, startSample);
            engine.renderBlock(positionBars, sampleRate, numSamples, l, r);
            masterChain.process(numSamples, l, r);
        }

        juce::WavAudioFormat wavFormat;
        auto outFile = juce::File(outputPath);
        outFile.deleteFile();
        std::unique_ptr<juce::FileOutputStream> out(outFile.createOutputStream());
        if (out == nullptr)
        {
            errorOut = "failed to open output path for writing: " + outputPath;
            return false;
        }
        std::unique_ptr<juce::AudioFormatWriter> writer(
            wavFormat.createWriterFor(out.get(), sampleRate, 2, 16, {}, 0));
        if (writer == nullptr)
        {
            errorOut = "failed to create WAV writer for: " + outputPath;
            return false;
        }
        out.release();
        writer->writeFromAudioSampleBuffer(output, 0, totalSamples);
        writer.reset();
        return true;
    }
```

(`project.masterChain` doesn't exist yet — this compiles once Task 4 adds it to `EngineProject`. Do this task's Step 3 edit together with Task 4 if your toolchain won't let you commit non-compiling intermediate state; the plan lists them separately only because they're conceptually distinct changes.)

- [ ] **Step 4: Update `Main.cpp`'s `Transport` construction** (it constructs one directly)

Search `native-engine/Source/Main.cpp` for `Transport transport(engine);` and change to construct a `MasterChain` first:

```cpp
    MasterChain masterChain;
    Transport transport(engine, masterChain);
```

Also update `IpcServer`/`IpcConnection` construction call sites in the same file to pass `masterChain` through (their constructors change in Task 4).

- [ ] **Step 5: Update `TransportTests.cpp`** for the new constructor signature — find every `Transport transport(...)` or `Transport(...)` construction in the file and add a local `MasterChain masterChain;` plus pass it as the second argument, matching Step 4's pattern.

- [ ] **Step 6: Build and run tests**

```bash
cd native-engine && cmake --build build && ./build/ssstitch_engine_artefacts/Debug/ssstitch_engine --test
```
Expected: all suites pass, including `Transport` and `PlaybackEngine`'s existing suites (unaffected in behavior — an empty `MasterChain` is a no-op passthrough, per Task 1's own test).

- [ ] **Step 7: Commit**

```bash
git add native-engine/Source/Transport.h native-engine/Source/Transport.cpp native-engine/Source/RenderExport.h native-engine/Source/RenderExport.cpp native-engine/Source/TransportTests.cpp native-engine/Source/Main.cpp
git commit -m "Wire MasterChain into live playback and offline export"
```

---

### Task 4: `EngineProject.masterChain` field + IPC message handling

**Files:**
- Modify: `native-engine/Source/EngineProject.h`
- Modify: `native-engine/Source/EngineProject.cpp`
- Modify: `native-engine/Source/EngineProjectTests.cpp`
- Modify: `native-engine/Source/IpcServer.h`
- Modify: `native-engine/Source/IpcServer.cpp`
- Modify: `native-engine/Source/Main.cpp` (constructor call sites for `IpcServer`)

- [ ] **Step 1: Add `masterChain` to `EngineProject`**

In `native-engine/Source/EngineProject.h`, add `#include "MasterChain.h"` and add to the `EngineProject` struct (after `std::vector<EngineRifff> rifffs;`, line 44):

```cpp
        // "" (empty string) = no plugin loaded for that slot. Always exactly
        // kNumMasterChainSlots entries; parseEngineProject fills missing/short
        // wire-format arrays with empty strings rather than failing, matching
        // this file's existing lenient-parse convention for other fields.
        std::array<juce::String, kNumMasterChainSlots> masterChain {};
```

- [ ] **Step 2: Write a failing test in `EngineProjectTests.cpp`** for parsing `masterChain` from JSON

Find the existing test file's pattern for parsing a field (e.g. search for how `loopLengthBars` is tested) and add an analogous case:

```cpp
                beginTest("parses masterChain from the wire payload");
                {
                    const auto json = R"({
                        "bpm": 120, "snapDiv": 16, "rifffs": [],
                        "masterChain": ["pro-q-3", "", "soothe2", ""]
                    })";
                    EngineProject project;
                    juce::String error;
                    expect(parseEngineProject(json, project, error));
                    expectEquals(project.masterChain[0], juce::String("pro-q-3"));
                    expectEquals(project.masterChain[1], juce::String(""));
                    expectEquals(project.masterChain[2], juce::String("soothe2"));
                    expectEquals(project.masterChain[3], juce::String(""));
                }

                beginTest("missing masterChain defaults to all-empty slots");
                {
                    const auto json = R"({"bpm": 120, "snapDiv": 16, "rifffs": []})";
                    EngineProject project;
                    juce::String error;
                    expect(parseEngineProject(json, project, error));
                    for (const auto& slot : project.masterChain)
                        expectEquals(slot, juce::String(""));
                }
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd native-engine && cmake --build build && ./build/ssstitch_engine_artefacts/Debug/ssstitch_engine --test
```
Expected: FAIL on both new cases (masterChain not yet parsed).

- [ ] **Step 4: Implement parsing in `EngineProject.cpp`**

Find `parseEngineProject`'s existing handling of a top-level array/scalar field (e.g. how `loopLengthBars` or `rifffs` is read from the parsed `juce::var`) and add, before the function returns success:

```cpp
        auto masterChainVar = parsed.getProperty("masterChain", juce::var());
        if (auto* arr = masterChainVar.getArray())
        {
            for (int i = 0; i < kNumMasterChainSlots; ++i)
                projectOut.masterChain[(size_t) i] = i < arr->size() ? (*arr)[i].toString() : juce::String();
        }
        // else: leave the default-constructed all-empty masterChain as-is
```

(Exact insertion point depends on the surrounding function's structure — read `EngineProject.cpp` in full first and place this alongside the parsing of other top-level fields, before the final `return true;`.)

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd native-engine && cmake --build build && ./build/ssstitch_engine_artefacts/Debug/ssstitch_engine --test
```
Expected: PASS.

- [ ] **Step 6: Add `MasterChain&` to `IpcServer`/`IpcConnection` and handle `load-master-plugin`**

In `native-engine/Source/IpcServer.h`, add `#include "MasterChain.h"`, and thread a `MasterChain&` through both classes exactly like the reverted `SendBus&` was threaded (recovered via `git show 21df0fb^:native-engine/Source/IpcServer.h`):

```cpp
        IpcConnection(PlaybackEngine& engine, Transport& transport, StemBufferCache& bufferCache, MasterChain& masterChain);
        // ...
        PlaybackEngine& engine;
        Transport& transport;
        StemBufferCache& bufferCache;
        MasterChain& masterChain;
```

```cpp
        IpcServer(PlaybackEngine& engine, Transport& transport, StemBufferCache& bufferCache, MasterChain& masterChain);
        // ...
        MasterChain& masterChain;
```

In `native-engine/Source/IpcServer.cpp`, update both constructors to take and store the new reference, update `createConnectionObject` to pass it through, and add a `load-master-plugin` branch to `messageReceived` (modeled on the reverted `load-send-plugin` handler recovered above), inserted alongside the existing `else if (type == "set-metronome")` branch:

```cpp
        else if (type == "load-master-plugin")
        {
            if (!payload.isObject())
                return;
            const int slot = (int) payload.getProperty("slot", -1);
            const auto pluginId = payload.getProperty("pluginId", "").toString();
            if (slot < 0 || slot >= kNumMasterChainSlots)
                return;

            // Use the real device's own sample rate / block size, not a
            // hardcoded guess -- prepareToPlay()'ing a plugin for the wrong
            // block size means processBlock() can later be called with a
            // buffer larger than it allocated internal storage for
            // (undefined behaviour, often a crash that takes the whole
            // engine process down, silencing the dry mix too).
            //
            // IpcConnection itself is only ever touched from the message
            // thread (InterprocessConnection's own contract), but
            // requestLoad's onLoaded callback fires on MasterChain's
            // background loader thread -- sendJson (and `this` in general)
            // must not be touched from there directly. Post back to the
            // message thread.
            masterChain.requestLoad(slot, pluginId, transport.currentSampleRate(), transport.currentBlockSize(),
                [this, slot, pluginId](bool success, const juce::String& error)
                {
                    juce::MessageManager::callAsync([this, slot, pluginId, success, error]()
                    {
                        juce::DynamicObject::Ptr payloadObj = new juce::DynamicObject();
                        payloadObj->setProperty("slot", slot);
                        payloadObj->setProperty("pluginId", pluginId);
                        payloadObj->setProperty("success", success);
                        if (!success)
                            payloadObj->setProperty("error", error);
                        juce::DynamicObject::Ptr obj = new juce::DynamicObject();
                        obj->setProperty("type", "master-plugin-loaded");
                        obj->setProperty("payload", juce::var(payloadObj.get()));
                        sendJson(juce::var(obj.get()));
                    });
                });
        }
```

- [ ] **Step 7: Update `Main.cpp`'s `IpcServer` construction** to pass the `masterChain` local from Task 3 Step 4:

```cpp
    IpcServer server(engine, transport, bufferCache, masterChain);
```

- [ ] **Step 8: Build and run tests**

```bash
cd native-engine && cmake --build build && ./build/ssstitch_engine_artefacts/Debug/ssstitch_engine --test
```
Expected: all suites pass, including the two new `EngineProject` cases.

- [ ] **Step 9: Commit**

```bash
git add native-engine/Source/EngineProject.h native-engine/Source/EngineProject.cpp native-engine/Source/EngineProjectTests.cpp native-engine/Source/IpcServer.h native-engine/Source/IpcServer.cpp native-engine/Source/Main.cpp
git commit -m "Add EngineProject.masterChain field + load-master-plugin IPC handling"
```

---

### Task 5: Renderer `masterChain` state + `SET_MASTER_CHAIN_PLUGIN` action

**Files:**
- Modify: `src/renderer/src/state/store.ts`
- Modify: `src/renderer/src/state/store.test.ts`

- [ ] **Step 1: Write failing reducer tests** in `store.test.ts` — find the file's existing pattern for a simple field-setting action test (e.g. `SET_TEMPO`) and add:

```ts
describe('SET_MASTER_CHAIN_PLUGIN', () => {
  it('sets the given slot to the given plugin id, leaving other slots untouched', () => {
    let state = reducer(initialState, {
      type: 'SET_MASTER_CHAIN_PLUGIN',
      slot: 1,
      pluginId: 'pro-q-3'
    })
    expect(state.masterChain).toEqual([null, 'pro-q-3', null, null])

    state = reducer(state, { type: 'SET_MASTER_CHAIN_PLUGIN', slot: 3, pluginId: 'soothe2' })
    expect(state.masterChain).toEqual([null, 'pro-q-3', null, 'soothe2'])
  })

  it('clears a slot back to null', () => {
    let state = reducer(initialState, {
      type: 'SET_MASTER_CHAIN_PLUGIN',
      slot: 0,
      pluginId: 'pro-q-3'
    })
    state = reducer(state, { type: 'SET_MASTER_CHAIN_PLUGIN', slot: 0, pluginId: null })
    expect(state.masterChain).toEqual([null, null, null, null])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/renderer/src/state/store.test.ts
```
Expected: FAIL (`masterChain` doesn't exist on `AppState`, `SET_MASTER_CHAIN_PLUGIN` isn't a known action).

- [ ] **Step 3: Add the field to `AppState`, `initialState`, the `Action` union, and a reducer case**

In `src/renderer/src/state/store.ts`, add to the `AppState` interface (near `channelOf: Record<string, string>`, line 83):

```ts
  /** masterChain[i] is an allowlist id (see src/shared/masterChainAllowlist.ts)
   * or null for an empty slot. Persists normally -- real arrangement data, not
   * transient UI state. See docs/superpowers/specs/2026-07-31-master-plugin-chain-design.md. */
  masterChain: [string | null, string | null, string | null, string | null]
```

Add to `initialState` (near `channelOf: {},`, line 123):

```ts
  masterChain: [null, null, null, null],
```

Add to the `Action` union (near `| { type: 'MOVE_TO_CHANNEL'; ... }`, line 141):

```ts
  | { type: 'SET_MASTER_CHAIN_PLUGIN'; slot: 0 | 1 | 2 | 3; pluginId: string | null }
```

Add a reducer case (find the `switch (action.type)` block and add a case near other simple single-field setters like `SET_TEMPO`):

```ts
    case 'SET_MASTER_CHAIN_PLUGIN': {
      const masterChain = [...state.masterChain] as AppState['masterChain']
      masterChain[action.slot] = action.pluginId
      return { ...state, masterChain }
    }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/renderer/src/state/store.test.ts
```
Expected: PASS.

- [ ] **Step 5: Full verification**

```bash
npm run typecheck
npm run lint
npx vitest run
```

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/state/store.ts src/renderer/src/state/store.test.ts
git commit -m "Add masterChain state + SET_MASTER_CHAIN_PLUGIN action"
```

---

### Task 6: Shared allowlist twin + `buildEngineProject.ts` wiring

**Files:**
- Create: `src/shared/masterChainAllowlist.ts`
- Create: `src/shared/masterChainAllowlist.test.ts`
- Modify: `src/shared/buildEngineProject.ts`
- Modify: `src/shared/buildEngineProject.test.ts`

- [ ] **Step 1: Write `masterChainAllowlist.ts`** (renderer twin of `MasterChainAllowlist.h`, same convention as the reverted `sendPlugins.ts`)

```ts
// src/shared/masterChainAllowlist.ts
/** Renderer twin of native-engine/Source/MasterChainAllowlist.h -- see that
 * file's own doc comment for the full rationale (curated, not scanned;
 * VST3-only; kept in sync by hand). Only `id` and `displayName` are needed
 * here -- the plugin's file path only matters to the native engine, which
 * does the actual loading. */
export interface MasterChainAllowlistEntry {
  id: string
  displayName: string
}

export const MASTER_CHAIN_ALLOWLIST: MasterChainAllowlistEntry[] = [
  { id: 'solid-bus-comp', displayName: 'Solid Bus Comp' },
  { id: 'pro-q-3', displayName: 'FabFilter Pro-Q 3' },
  { id: 'soothe2', displayName: 'soothe2' },
  { id: 'sausage-fattener', displayName: 'Sausage Fattener' },
  { id: 'sunset-sound-reverb', displayName: 'Sunset Sound Studio Reverb' }
]

export function findMasterChainPlugin(id: string): MasterChainAllowlistEntry | undefined {
  return MASTER_CHAIN_ALLOWLIST.find((p) => p.id === id)
}
```

- [ ] **Step 2: Write `masterChainAllowlist.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { MASTER_CHAIN_ALLOWLIST, findMasterChainPlugin } from './masterChainAllowlist'

describe('findMasterChainPlugin', () => {
  it('finds a known entry by id', () => {
    expect(findMasterChainPlugin('pro-q-3')).toEqual({ id: 'pro-q-3', displayName: 'FabFilter Pro-Q 3' })
  })

  it('returns undefined for an unknown id', () => {
    expect(findMasterChainPlugin('nope')).toBeUndefined()
  })

  it('has exactly 5 curated entries', () => {
    expect(MASTER_CHAIN_ALLOWLIST).toHaveLength(5)
  })
})
```

- [ ] **Step 3: Run tests to verify they pass**

```bash
npx vitest run src/shared/masterChainAllowlist.test.ts
```

- [ ] **Step 4: Write a failing test in `buildEngineProject.test.ts`** for `masterChain` flowing through to `EngineProject`

Find the existing test file's pattern for asserting a top-level `EngineProject` field (e.g. how `snapDiv` or `loopLengthBars` is asserted) and add:

```ts
it('includes masterChain in the built project, using "" for an empty slot', async () => {
  const state = { ...initialState, masterChain: [null, 'pro-q-3', null, 'soothe2'] as AppState['masterChain'] }
  const project = await buildEngineProject(state, fakeResolveStretched)
  expect(project.masterChain).toEqual(['', 'pro-q-3', '', 'soothe2'])
})
```

(Match the exact fixture/helper names already used elsewhere in the file, e.g. whatever the existing tests call their resolve-stretched stub.)

- [ ] **Step 5: Run test to verify it fails**

```bash
npx vitest run src/shared/buildEngineProject.test.ts
```
Expected: FAIL (`masterChain` not yet in the returned `EngineProject`).

- [ ] **Step 6: Add `masterChain` to `EngineProject` interface and `buildEngineProject`'s return value**

In `src/shared/buildEngineProject.ts`, add to the `EngineProject` interface (after `rifffs: EngineRifff[]`, line 41):

```ts
  /** "" (empty string) for an empty slot, matching the native engine's own
   * wire-format convention (see MasterChainAllowlist.h) -- state.masterChain
   * uses `null` on the renderer side since that's this codebase's existing
   * convention for "unset" everywhere else (e.g. Rifff.startBar). */
  masterChain: [string, string, string, string]
```

In `buildEngineProject`'s return statement (line 151-156), add:

```ts
  return {
    bpm: state.bpm,
    snapDiv: SNAP_DIVS[state.snapIdx],
    loopLengthBars: loopLengthBars(state),
    masterChain: state.masterChain.map((id) => id ?? '') as [string, string, string, string],
    rifffs
  }
```

- [ ] **Step 7: Run tests to verify they pass**

```bash
npx vitest run src/shared/buildEngineProject.test.ts
```

- [ ] **Step 8: Full verification**

```bash
npm run typecheck
npm run lint
npx vitest run
```

- [ ] **Step 9: Commit**

```bash
git add src/shared/masterChainAllowlist.ts src/shared/masterChainAllowlist.test.ts src/shared/buildEngineProject.ts src/shared/buildEngineProject.test.ts
git commit -m "Add renderer master-chain allowlist twin + wire into buildEngineProject"
```

---

### Task 7: `main/index.ts` + `preload/index.ts` IPC bridge for `load-master-plugin`

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`

Editor-window IPC (`open-master-plugin-editor`/`close-master-plugin-editor`) is deliberately NOT added in this task — that's Task 12, once Task 10/11's native windowing support actually exists to receive those messages.

- [ ] **Step 1: Add the `engine-load-master-plugin` handler to `src/main/index.ts`**

Add right after the existing `engine-set-metronome` handler:

```ts
  ipcMain.handle('engine-load-master-plugin', (_event, slot: number, pluginId: string | null) => {
    playbackEngine?.client.send('load-master-plugin', { slot, pluginId })
  })
```

Add a `master-plugin-loaded` relay alongside the existing `position-update` relay (inside the `if (playbackEngine)` block near the bottom of `app.whenReady().then(...)`), following the exact same `subscribeToX`/`onRestarted` re-subscription pattern already used for `subscribeToPositionUpdates`:

```ts
    function subscribeToMasterPluginLoaded(): void {
      engine.client.on('master-plugin-loaded', (payload) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('master-plugin-loaded', payload)
        }
      })
    }
    subscribeToPositionUpdates()
    subscribeToMasterPluginLoaded()

    engine.onRestarted(() => {
      subscribeToPositionUpdates()
      subscribeToMasterPluginLoaded()
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('engine-restarted')
      }
    })
```

(This replaces the existing `subscribeToPositionUpdates(); engine.onRestarted(() => { subscribeToPositionUpdates(); ... })` block — add the new subscribe calls alongside the existing ones, don't duplicate the existing structure.)

- [ ] **Step 2: Add the bridge methods to `src/preload/index.ts`**

Add to the `api` object, near the existing `engineSetMetronome`:

```ts
  engineLoadMasterPlugin: (slot: number, pluginId: string | null): Promise<void> =>
    ipcRenderer.invoke('engine-load-master-plugin', slot, pluginId),
  onMasterPluginLoaded: (
    callback: (result: { slot: number; pluginId: string; success: boolean; error?: string }) => void
  ): (() => void) => {
    const listener = (
      _event: unknown,
      payload: { slot: number; pluginId: string; success: boolean; error?: string }
    ): void => callback(payload)
    ipcRenderer.on('master-plugin-loaded', listener)
    return () => ipcRenderer.removeListener('master-plugin-loaded', listener)
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
git commit -m "Add load-master-plugin IPC bridge (preload + main process)"
```

---

### Task 8: `StoreContext.tsx` wiring — resend on change, listen for `master-plugin-loaded`

**Files:**
- Modify: `src/renderer/src/state/StoreContext.tsx`

- [ ] **Step 1: Add `masterChain` to the `load-project` resend effect's dependency array**

In the `useEffect` at `src/renderer/src/state/StoreContext.tsx:130-161`, add `state.masterChain` to the dependency array (matching the existing comment style explaining why each field is there — this one's plugin *identity* flows through the general project sync, matching the design spec's "IDs flow through load-project, loading is a separate message" split):

```ts
    // masterChain plugin IDs flow through this general project sync (the
    // native engine's own EngineProject.masterChain field just needs to
    // stay current); actually LOADING/swapping the plugin binary is a
    // separate, explicit engineLoadMasterPlugin call below instead -- see
    // the SET_MASTER_CHAIN_PLUGIN dispatch-side effect.
    state.masterChain
  ])
```

- [ ] **Step 2: Add an effect that calls `engineLoadMasterPlugin` when a slot's assignment changes**

Add a new `useEffect` after the existing `state.metronomeEnabled` effect (line 172-174), tracking each slot individually so only the ONE slot that actually changed gets reloaded:

```ts
  const masterChainRef = useRef(state.masterChain)
  useEffect(() => {
    const prev = masterChainRef.current
    masterChainRef.current = state.masterChain
    state.masterChain.forEach((pluginId, slot) => {
      if (pluginId !== prev[slot]) {
        void window.rifffApi.engineLoadMasterPlugin(slot, pluginId)
      }
    })
  }, [state.masterChain])
```

- [ ] **Step 3: Track load status/error per slot and clear a failed slot back to `null`**

Add new contexts near the top of the file, alongside `PosCtx`/`PlayingCtx`:

```ts
export type MasterChainSlotStatus = 'idle' | 'loading' | 'loaded' | 'error'

const MasterChainStatusCtx = createContext<
  [MasterChainSlotStatus, MasterChainSlotStatus, MasterChainSlotStatus, MasterChainSlotStatus]
>(['idle', 'idle', 'idle', 'idle'])
const MasterChainErrorCtx = createContext<[string | null, string | null, string | null, string | null]>([
  null,
  null,
  null,
  null
])
```

Inside `StoreProvider`, add state and wire it up:

```ts
  const [masterChainStatus, setMasterChainStatus] = useState<
    [MasterChainSlotStatus, MasterChainSlotStatus, MasterChainSlotStatus, MasterChainSlotStatus]
  >(['idle', 'idle', 'idle', 'idle'])
  const [masterChainError, setMasterChainError] = useState<
    [string | null, string | null, string | null, string | null]
  >([null, null, null, null])
```

Update the Step 2 effect to also set `'loading'` status right before dispatching the IPC call:

```ts
  useEffect(() => {
    const prev = masterChainRef.current
    masterChainRef.current = state.masterChain
    state.masterChain.forEach((pluginId, slot) => {
      if (pluginId !== prev[slot]) {
        setMasterChainStatus((s) => {
          const next = [...s] as typeof s
          next[slot] = pluginId === null ? 'idle' : 'loading'
          return next
        })
        void window.rifffApi.engineLoadMasterPlugin(slot, pluginId)
      }
    })
  }, [state.masterChain])
```

Add a listener effect, modeled directly on the reverted `onSendPluginLoaded` handler (recovered via `git show 21df0fb^:src/renderer/src/state/StoreContext.tsx`), right after the `onEngineRestarted` effect:

```ts
  useEffect(() => {
    return window.rifffApi.onMasterPluginLoaded(({ slot, success, error }) => {
      if (!success) console.error(`StoreContext: master chain slot ${slot} failed to load plugin: ${error}`)
      setMasterChainStatus((s) => {
        const next = [...s] as typeof s
        next[slot] = success ? 'loaded' : 'error'
        return next
      })
      setMasterChainError((s) => {
        const next = [...s] as typeof s
        next[slot] = success ? null : (error ?? 'unknown error')
        return next
      })
      if (!success) {
        // A failed load must not leave state.masterChain[slot] pointing at the
        // plugin id that just failed -- otherwise a later, unrelated engine
        // crash-recovery restart would keep resending load-master-plugin for
        // the same known-bad id forever. rawDispatch (not dispatch) since this
        // is plain state cleanup, not a user edit worth its own undo step; the
        // SET_MASTER_CHAIN_PLUGIN case above would also reset
        // masterChainStatus/masterChainError back to 'idle'/null and fire
        // another (pointless) engineLoadMasterPlugin IPC call right back --
        // acceptable, matches the reverted send-bus feature's own precedent.
        rawDispatch({ type: 'SET_MASTER_CHAIN_PLUGIN', slot: slot as 0 | 1 | 2 | 3, pluginId: null })
      }
    })
  }, [])
```

Wrap the returned JSX in the two new providers, alongside the existing ones:

```tsx
  return (
    <StateCtx.Provider value={state}>
      <DispatchCtx.Provider value={dispatch}>
        <PosCtx.Provider value={pos}>
          <PlayingCtx.Provider value={playing}>
            <HistoryCtx.Provider value={historyControls}>
              <MasterChainStatusCtx.Provider value={masterChainStatus}>
                <MasterChainErrorCtx.Provider value={masterChainError}>
                  {children}
                </MasterChainErrorCtx.Provider>
              </MasterChainStatusCtx.Provider>
            </HistoryCtx.Provider>
          </PlayingCtx.Provider>
        </PosCtx.Provider>
      </DispatchCtx.Provider>
    </StateCtx.Provider>
  )
```

Add hooks near the file's other `useX` exports:

```ts
// eslint-disable-next-line react-refresh/only-export-components -- context hook, not a component
export function useMasterChainStatus(): [
  MasterChainSlotStatus,
  MasterChainSlotStatus,
  MasterChainSlotStatus,
  MasterChainSlotStatus
] {
  return useContext(MasterChainStatusCtx)
}

// eslint-disable-next-line react-refresh/only-export-components -- context hook, not a component
export function useMasterChainError(): [string | null, string | null, string | null, string | null] {
  return useContext(MasterChainErrorCtx)
}
```

- [ ] **Step 4: Full verification**

```bash
npm run typecheck
npm run lint
npx vitest run
```

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/state/StoreContext.tsx
git commit -m "Wire masterChain load/status/error into StoreContext"
```

---

### Task 9: `TransportBar.tsx` master panel UI

**Files:**
- Create: `src/renderer/src/components/MasterChainPanel.tsx`
- Modify: `src/renderer/src/components/TransportBar.tsx`

No editor "edit" button yet — that's Task 12. This task is just the slot list, dropdown, and status indicator.

- [ ] **Step 1: Write `MasterChainPanel.tsx`**

```tsx
// src/renderer/src/components/MasterChainPanel.tsx
import { useAppState, useDispatch, useMasterChainStatus, useMasterChainError } from '../state/StoreContext'
import { MASTER_CHAIN_ALLOWLIST } from '@shared/masterChainAllowlist'

const SLOT_LABELS = ['1', '2', '3', '4'] as const

export function MasterChainPanel({ onClose }: { onClose: () => void }): React.JSX.Element {
  const state = useAppState()
  const dispatch = useDispatch()
  const status = useMasterChainStatus()
  const error = useMasterChainError()

  return (
    <div
      style={{
        position: 'absolute',
        top: 32,
        right: 8,
        zIndex: 20,
        background: 'var(--ra-bg-row-active)',
        border: '1px solid var(--ra-border)',
        borderRadius: 4,
        padding: 8,
        width: 260,
        fontSize: 11
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ color: 'var(--ra-text-2)' }}>master chain</span>
        <button onClick={onClose} aria-label="Close master chain panel">
          ×
        </button>
      </div>
      {SLOT_LABELS.map((label, slot) => {
        const pluginId = state.masterChain[slot]
        const slotStatus = status[slot]
        const slotError = error[slot]
        return (
          <div
            key={slot}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0' }}
            title={slotError ?? undefined}
          >
            <span style={{ color: 'var(--ra-text-2)', width: 12 }}>{label}</span>
            <select
              value={pluginId ?? ''}
              onChange={(e) =>
                dispatch({
                  type: 'SET_MASTER_CHAIN_PLUGIN',
                  slot: slot as 0 | 1 | 2 | 3,
                  pluginId: e.target.value === '' ? null : e.target.value
                })
              }
              style={{ flex: 1, fontSize: 11 }}
            >
              <option value="">none</option>
              {MASTER_CHAIN_ALLOWLIST.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.displayName}
                </option>
              ))}
            </select>
            <span
              aria-label={`slot ${label} status: ${slotStatus}`}
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background:
                  slotStatus === 'loaded'
                    ? 'var(--ra-stretch-on)'
                    : slotStatus === 'error'
                      ? '#e05555'
                      : slotStatus === 'loading'
                        ? '#d9c34f'
                        : 'var(--ra-border)'
              }}
            />
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Add the toggle button to `TransportBar.tsx`**

Add `useState` for panel visibility (the component already imports `useState`, line 1) and render `MasterChainPanel` conditionally. Add near the existing `envelope` button (after line 219):

```tsx
      <button
        onClick={() => setMasterChainPanelOpen((open) => !open)}
        aria-label="Toggle master chain panel"
        title="master plugin chain"
        style={{
          height: 22,
          borderRadius: 0,
          padding: '0 8px',
          fontSize: 10,
          background: masterChainPanelOpen ? 'var(--ra-stretch-on-bg)' : 'var(--ra-bg-row-active)',
          border: `1px solid ${masterChainPanelOpen ? 'var(--ra-stretch-on)' : 'var(--ra-border)'}`,
          color: masterChainPanelOpen ? 'var(--ra-stretch-on)' : 'var(--ra-text-2)'
        }}
      >
        master
      </button>
      {masterChainPanelOpen && <MasterChainPanel onClose={() => setMasterChainPanelOpen(false)} />}
```

Add the state declaration near the top of `TransportBar()` (alongside `tempoText`/`tempoFocused`):

```ts
  const [masterChainPanelOpen, setMasterChainPanelOpen] = useState(false)
```

Add the import at the top of the file:

```ts
import { MasterChainPanel } from './MasterChainPanel'
```

Note: `TransportBar`'s own root element needs `position: 'relative'` for the panel's `position: 'absolute'` to anchor correctly — check the existing root `<div>`'s style (around line 40) and add `position: 'relative'` if it isn't already set to something other than `static`.

- [ ] **Step 3: Full verification**

```bash
npm run typecheck
npm run lint
npx vitest run
```

- [ ] **Step 4: Manual verification (not automatable — UI)**

Start the dev server (`npm run dev`), click the new "master" button, confirm the panel opens listing 4 slots each with a dropdown and status dot, and closes via the × button.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/MasterChainPanel.tsx src/renderer/src/components/TransportBar.tsx
git commit -m "Add master chain panel UI to TransportBar"
```

---

### Task 10: Convert `native-engine` from console app to GUI app (HIGH RISK, UNSPIKED)

**Files:**
- Modify: `native-engine/CMakeLists.txt`

**This is the plan's highest-risk task.** The spec explicitly flags that `Main.cpp`'s own existing comment documents `[NSApp run]`/`runDispatchLoop()` "was observed returning immediately in a headless console process here" — the exact reason the engine currently polls with `runDispatchLoopUntil(50)` instead. Converting to a full GUI app target is the standard fix for that class of problem, but this has **not been spiked** ahead of committing to this plan. Real plugin editor windows (Task 11) depend on this task succeeding.

**Report honestly.** If this task doesn't work cleanly — the engine fails to launch, IPC breaks, audio playback breaks, or anything about its current behavior regresses — report `BLOCKED` or `DONE_WITH_CONCERNS` with the exact failure, rather than forcing something that doesn't actually work. This task is deliberately scoped to ONLY the CMake target type change, verified against everything that already works TODAY, before Task 11 adds any new window-opening code on top — so a failure here is cheap to isolate and revert.

- [ ] **Step 1: Change the CMake target type**

In `native-engine/CMakeLists.txt`, change line 16:

```cmake
juce_add_gui_app(ssstitch_engine
  PRODUCT_NAME "ssstitch-engine"
)
```

JUCE's `juce_add_gui_app` (unlike `juce_add_console_app`) builds a `.app` bundle on macOS, which typically wants `MACOSX_BUNDLE_GUI_IDENTIFIER` set (JUCE usually defaults one from the product name, but verify — if the build fails complaining about a missing bundle identifier, add `BUNDLE_ID "com.ellinglien.ssstitch-engine"` as an additional argument to `juce_add_gui_app`). Since this process should stay a background helper (no Dock icon, no menu bar, no stealing focus at launch — it's spawned silently by Electron, not user-launched), also add:

```cmake
juce_add_gui_app(ssstitch_engine
  PRODUCT_NAME "ssstitch-engine"
  MICROPHONE_PERMISSION_ENABLED FALSE
)
```
then, after the `juce_add_gui_app` call, set the bundle to run as an accessory (no Dock icon) via JUCE's plist-injection mechanism:

```cmake
set_target_properties(ssstitch_engine PROPERTIES
  XCODE_ATTRIBUTE_INFOPLIST_PREPROCESS YES
)
juce_add_bundle_resources_directory(ssstitch_engine "${CMAKE_CURRENT_SOURCE_DIR}/Resources")
```

**Note for the implementer:** the exact CMake incantation for "no Dock icon" (`LSUIElement = YES` in the bundle's `Info.plist`) varies by JUCE version and isn't verified here — JUCE's own CMake API docs (`docs/CMake API.md` in the vendored JUCE source at `native-engine/build/_deps/juce-src/docs/CMake API.md`) are the authoritative reference; read that file's `juce_add_gui_app`/Info.plist section before finalizing this step, and adjust the above to whatever that JUCE version actually supports. If no clean mechanism exists, it's acceptable for this pass to ship with a visible Dock icon (cosmetic issue, not a functional blocker) and note it as a known follow-up rather than block this task on it.

- [ ] **Step 2: Rebuild and locate the new binary path**

```bash
cd native-engine && rm -rf build && cmake -B build && cmake --build build
find build/ssstitch_engine_artefacts -maxdepth 3
```
Report the exact resulting binary path (it may now be inside a `.app` bundle, e.g. `build/ssstitch_engine_artefacts/Debug/ssstitch-engine.app/Contents/MacOS/ssstitch-engine`, or may remain a plain binary depending on JUCE's behavior for this target type on this platform — don't assume, check).

- [ ] **Step 3: Update `src/main/engineProcess.ts`'s `defaultBinaryPath()` if the path changed**

Read `src/main/engineProcess.ts:17-25`'s `defaultBinaryPath()`. If Step 2 found a different binary path than today's `native-engine/build/ssstitch_engine_artefacts/Debug/ssstitch_engine`, update the `join(...)` call to match exactly. If unchanged, no edit needed — note that explicitly in this task's completion report.

- [ ] **Step 4: Run the FULL existing native test suite** (regression check — nothing about existing behavior should change)

```bash
cd native-engine && ./build/ssstitch_engine_artefacts/Debug/ssstitch_engine --test
```
(adjust the path per Step 2/3's findings)
Expected: every existing suite still passes, unchanged.

- [ ] **Step 5: Manual verification — full app smoke test (required, not automatable)**

```bash
pkill -9 -f "Claudecode/ssstitch"
nohup npm run dev > /tmp/ssstitch-dev.log 2>&1 &
```
Confirm via `/tmp/ssstitch-dev.log` and the Electron window that: the app launches, the native engine spawns and reports readiness (check the log for "serving on 127.0.0.1:"), a project loads and plays audio correctly, position updates arrive, and the master chain panel (Task 9) can still load a plugin. This is the task's real pass/fail signal — a clean build with broken runtime behavior is a failure, report it as such.

- [ ] **Step 6: Commit** (only if Step 4 and Step 5 both genuinely pass)

```bash
git add native-engine/CMakeLists.txt src/main/engineProcess.ts
git commit -m "Convert native-engine to a GUI app target (needed for plugin editor windows)"
```

If Step 4 or Step 5 fails and can't be resolved within this task's scope, STOP — report `BLOCKED` with the exact failure mode, and do not proceed to Task 11 (editor windows have no foundation without this working). Tasks 1-9 remain fully shippable on their own (master chain load/process/swap works correctly as a console app — editor windows are the only thing gated on this task).

---

### Task 11: Native editor-window IPC handlers

**Files:**
- Modify: `native-engine/Source/MasterChain.h`
- Modify: `native-engine/Source/MasterChain.cpp`
- Modify: `native-engine/Source/IpcServer.cpp`

**Second highest-risk task — do not start unless Task 10 is fully committed and its manual verification passed.** Reference JUCE's own `AudioPluginHost` example (vendored at `native-engine/build/_deps/juce-src/extras/AudioPluginHost/Source/UI/PluginWindow.h`) for the concrete `DocumentWindow`/`AudioProcessorEditor` hosting pattern — read that file in full before starting this task, it's a proven, working reference implementation of exactly this.

- [ ] **Step 1: Add editor-window methods to `MasterChain`**

In `MasterChain.h`, add to the public API:

```cpp
        /** Message-thread API: opens a DocumentWindow hosting slotIndex's
         * plugin's own AudioProcessorEditor, if that slot has a plugin
         * loaded and doesn't already have an open window. No-op (not an
         * error) if the slot is empty or already has a window open --
         * mirrors this app's existing "silently do nothing" convention for
         * a redundant UI action (e.g. re-clicking an already-selected
         * rifff). Returns false only if slotIndex is out of range. */
        bool openEditorWindow(int slotIndex);

        /** Message-thread API: closes slotIndex's editor window if one is
         * open. The underlying plugin instance keeps loaded and processing
         * either way -- closing the editor is purely a UI action. No-op if
         * no window is open for that slot. */
        void closeEditorWindow(int slotIndex);
```

Add a private nested class and member to the `Slot` struct:

```cpp
        struct EditorWindow : public juce::DocumentWindow
        {
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
```

and, inside the existing `Slot` struct:

```cpp
            std::unique_ptr<EditorWindow> editorWindow;
```

- [ ] **Step 2: Implement `openEditorWindow`/`closeEditorWindow` in `MasterChain.cpp`**

```cpp
    bool MasterChain::openEditorWindow(int slotIndex)
    {
        if (slotIndex < 0 || slotIndex >= kNumMasterChainSlots)
            return false;
        auto& slot = slots[(size_t) slotIndex];
        if (slot.active == nullptr || slot.editorWindow != nullptr || !slot.active->hasEditor())
            return true; // no-op: nothing to open, or already open

        auto* editor = slot.active->createEditorIfNeeded();
        if (editor == nullptr)
            return true;

        slot.editorWindow = std::make_unique<EditorWindow>(
            slot.active->getName(), editor, [this, slotIndex]() { closeEditorWindow(slotIndex); });
        return true;
    }

    void MasterChain::closeEditorWindow(int slotIndex)
    {
        if (slotIndex < 0 || slotIndex >= kNumMasterChainSlots)
            return;
        slots[(size_t) slotIndex].editorWindow.reset();
    }
```

- [ ] **Step 3: Add `open-master-plugin-editor`/`close-master-plugin-editor` IPC handling**

In `IpcServer.cpp`'s `messageReceived`, add two branches alongside the `load-master-plugin` one from Task 4:

```cpp
        else if (type == "open-master-plugin-editor")
        {
            if (!payload.isObject())
                return;
            const int slot = (int) payload.getProperty("slot", -1);
            masterChain.openEditorWindow(slot);
        }
        else if (type == "close-master-plugin-editor")
        {
            if (!payload.isObject())
                return;
            const int slot = (int) payload.getProperty("slot", -1);
            masterChain.closeEditorWindow(slot);
        }
```

- [ ] **Step 4: Build**

```bash
cd native-engine && cmake --build build
```
Expected: clean build (no new automated test for actual window display — not practically testable via `juce::UnitTestRunner`; see Task 13's manual checklist).

- [ ] **Step 5: Manual verification (required — this is the task's real pass/fail signal)**

With the dev server running and a real allowlisted plugin actually installed at its expected path (per `MasterChainAllowlist.h`), load it into a slot via the Task 9 panel, then (once Task 12 wires the button) trigger `open-master-plugin-editor` for that slot — confirm a real native window appears showing that plugin's own UI, and that it can be closed via its own close button without crashing the engine. If NO real editor window appears, or the engine crashes/hangs, report `BLOCKED` or `DONE_WITH_CONCERNS` with the exact observed failure — do not mark this task done on a clean compile alone, since compiling was never the actual risk here.

- [ ] **Step 6: Commit**

```bash
git add native-engine/Source/MasterChain.h native-engine/Source/MasterChain.cpp native-engine/Source/IpcServer.cpp
git commit -m "Add native plugin editor window support to MasterChain"
```

---

### Task 12: Renderer editor-window IPC bridge + "edit" button

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/components/MasterChainPanel.tsx`

- [ ] **Step 1: Add `main/index.ts` handlers**

```ts
  ipcMain.handle('engine-open-master-plugin-editor', (_event, slot: number) => {
    playbackEngine?.client.send('open-master-plugin-editor', { slot })
  })

  ipcMain.handle('engine-close-master-plugin-editor', (_event, slot: number) => {
    playbackEngine?.client.send('close-master-plugin-editor', { slot })
  })
```

- [ ] **Step 2: Add `preload/index.ts` bridge methods**

```ts
  engineOpenMasterPluginEditor: (slot: number): Promise<void> =>
    ipcRenderer.invoke('engine-open-master-plugin-editor', slot),
  engineCloseMasterPluginEditor: (slot: number): Promise<void> =>
    ipcRenderer.invoke('engine-close-master-plugin-editor', slot),
```

- [ ] **Step 3: Add an "edit" button per slot in `MasterChainPanel.tsx`**

Inside the per-slot row's JSX (after the status dot `<span>`), add:

```tsx
            <button
              onClick={() => void window.rifffApi.engineOpenMasterPluginEditor(slot)}
              disabled={slotStatus !== 'loaded'}
              aria-label={`edit slot ${label} plugin`}
              style={{ fontSize: 10, padding: '1px 6px' }}
            >
              edit
            </button>
```

- [ ] **Step 4: Full verification**

```bash
npm run typecheck
npm run lint
npx vitest run
```

- [ ] **Step 5: Manual verification (not automatable)**

With Task 11's native support in place, load a plugin into a slot, click "edit," confirm a real editor window opens; close it via the window's own close button and confirm the "edit" button can reopen it.

- [ ] **Step 6: Commit**

```bash
git add src/main/index.ts src/preload/index.ts src/renderer/src/components/MasterChainPanel.tsx
git commit -m "Wire editor-window open/close IPC into the master chain panel"
```

---

### Task 13: Final full-suite verification + manual walkthrough

No code changes — verification and report only.

- [ ] **Step 1: Full native build+test**

```bash
cd native-engine && cmake --build build && ./build/ssstitch_engine_artefacts/Debug/ssstitch_engine --test
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

- [ ] **Step 4: Dev-server restart + manual walkthrough** (the spec's own Testing section checklist — all required, not automatable)

```bash
pkill -9 -f "Claudecode/ssstitch"
nohup npm run dev > /tmp/ssstitch-dev.log 2>&1 &
```

Walk through, and report honestly on each:
- Load a plugin into slot 1, confirm an audible change during live playback.
- Load a second plugin into slot 2, confirm they process in series (order matters — e.g. try swapping which slot has a gain-heavy plugin vs. a compressor and confirm the audible result actually differs by order).
- Export and confirm the rendered mix matches what was heard live.
- Open a plugin's editor window (Task 12's "edit" button), confirm it renders and accepts real mouse/keyboard input, close it, confirm the plugin keeps processing afterward.
- Trigger an engine crash-recovery restart (however this app's existing testing convention does so — check prior plans for the established method) and confirm master-chain assignments are resent and reload correctly.

- [ ] **Step 5: Report**

Summarize what passed, what didn't, and — critically — be explicit about Tasks 10/11's outcome (did editor windows genuinely work, or were they blocked/degraded) rather than glossing over it. No commit for this task.
