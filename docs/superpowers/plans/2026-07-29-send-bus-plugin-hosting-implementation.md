# Send-Bus Plugin Hosting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Four fixed send buses, each optionally hosting one VST3 plugin from a curated 5-plugin allowlist, live during playback — stems route a variable amount of signal into each bus, the bus's plugin processes the sum, and the result mixes back into the output.

**Architecture:** A new native `SendBus` class owns up to 4 live plugin instances and their per-block accumulation buffers, with a real-time-safe load/swap mechanism (background-thread instantiation, audio-thread check-and-swap at block boundaries). `PlaybackEngine::renderBlock` gains a parallel accumulation path alongside its existing direct stem mixing. `RenderExport` reuses the same `SendBus` synchronously (no real-time constraints offline). The renderer gets new state/actions, a small IPC round trip for loading a plugin onto a bus, and two UI pieces: a sends panel (TransportBar) and per-stem send-level controls (Inspector).

**Tech Stack:** JUCE 8 / C++20 (native-engine), Electron/React/TypeScript (renderer), existing IPC (JUCE InterprocessConnection over TCP, JSON messages).

**Spec:** `docs/superpowers/specs/2026-07-29-send-bus-plugin-hosting-design.md` — read this first for the full rationale behind every decision below. This plan implements it task-by-task; it does not re-derive the "why."

---

### Task 1: Curated plugin allowlist (native + renderer)

**Files:**
- Create: `native-engine/Source/SendPluginAllowlist.h`
- Create: `src/shared/sendPlugins.ts`
- Test: `src/shared/sendPlugins.test.ts`

The allowlist is a small, fixed table of 5 plugins, defined once on each side and kept in sync by hand — same convention as `computeStemSchedule`'s TS/C++ twin (`src/shared/schedulePlayback.ts` / `native-engine/Source/SchedulePlayback.cpp`).

- [ ] **Step 1: Write the native allowlist header**

```cpp
// native-engine/Source/SendPluginAllowlist.h
#pragma once
#include <juce_core/juce_core.h>
#include <array>

namespace ssstitch
{
    /** A curated, hardcoded set of plugins available on send buses — see
     * docs/superpowers/specs/2026-07-29-send-bus-plugin-hosting-design.md's
     * "Curated allowlist" section for why this isn't a live directory scan
     * (PHASE0_FINDINGS.md documents real scanning hazards: an AU-scanner
     * infinite-assertion-loop bug against certain system bundles, and
     * several installed plugins with no arm64 slice). All VST3 — matches
     * the format already proven end-to-end in the offline POC
     * (Main.cpp's runPluginProcess) and sidesteps AU's extra threading
     * constraints. Paths are hardcoded to this machine, matching this
     * app's single-user scope; a missing plugin at its expected path
     * surfaces as a load error, not a crash — see SendBus.h.
     *
     * Kept in sync by hand with src/shared/sendPlugins.ts — the id field
     * is the contract between the two; changing one without the other
     * will make the renderer's picker and the engine's loader disagree
     * about what a given id refers to. */
    struct SendPluginAllowlistEntry
    {
        const char* id;
        const char* displayName;
        const char* path;
    };

    inline const std::array<SendPluginAllowlistEntry, 5>& sendPluginAllowlist()
    {
        static const std::array<SendPluginAllowlistEntry, 5> table {{
            { "solid-bus-comp", "Solid Bus Comp", "/Library/Audio/Plug-Ins/VST3/Solid Bus Comp.vst3" },
            { "pro-q-3", "FabFilter Pro-Q 3", "/Library/Audio/Plug-Ins/VST3/FabFilter Pro-Q 3.vst3" },
            { "soothe2", "soothe2", "/Library/Audio/Plug-Ins/VST3/soothe2.vst3" },
            { "sausage-fattener", "Sausage Fattener", "/Library/Audio/Plug-Ins/VST3/SausageFattener.vst3" },
            { "sunset-sound-reverb", "Sunset Sound Studio Reverb", "/Library/Audio/Plug-Ins/VST3/TR5 Sunset Sound Studio Reverb.vst3" }
        }};
        return table;
    }

    /** Returns nullptr if `id` isn't in the allowlist. */
    inline const SendPluginAllowlistEntry* findSendPlugin(const juce::String& id)
    {
        for (const auto& entry : sendPluginAllowlist())
            if (id == entry.id)
                return &entry;
        return nullptr;
    }
}
```

- [ ] **Step 2: Write the failing renderer test**

```ts
// src/shared/sendPlugins.test.ts
import { describe, expect, it } from 'vitest'
import { SEND_PLUGIN_ALLOWLIST, findSendPlugin } from './sendPlugins'

describe('SEND_PLUGIN_ALLOWLIST', () => {
  it('has exactly 5 entries, matching the native allowlist', () => {
    expect(SEND_PLUGIN_ALLOWLIST).toHaveLength(5)
  })

  it('every entry has a unique id', () => {
    const ids = SEND_PLUGIN_ALLOWLIST.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('findSendPlugin', () => {
  it('finds an entry by id', () => {
    expect(findSendPlugin('solid-bus-comp')?.displayName).toBe('Solid Bus Comp')
  })

  it('returns undefined for an unknown id', () => {
    expect(findSendPlugin('not-a-real-plugin')).toBeUndefined()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/shared/sendPlugins.test.ts`
Expected: FAIL — `Cannot find module './sendPlugins'`

- [ ] **Step 4: Write the renderer allowlist module**

```ts
// src/shared/sendPlugins.ts

/** Renderer twin of native-engine/Source/SendPluginAllowlist.h — see that
 * file's own doc comment for the full rationale (curated, not scanned;
 * VST3-only; kept in sync by hand). Only `id` and `displayName` are needed
 * here — the plugin's file path only matters to the native engine, which
 * does the actual loading. */
export interface SendPluginAllowlistEntry {
  id: string
  displayName: string
}

export const SEND_PLUGIN_ALLOWLIST: SendPluginAllowlistEntry[] = [
  { id: 'solid-bus-comp', displayName: 'Solid Bus Comp' },
  { id: 'pro-q-3', displayName: 'FabFilter Pro-Q 3' },
  { id: 'soothe2', displayName: 'soothe2' },
  { id: 'sausage-fattener', displayName: 'Sausage Fattener' },
  { id: 'sunset-sound-reverb', displayName: 'Sunset Sound Studio Reverb' }
]

export function findSendPlugin(id: string): SendPluginAllowlistEntry | undefined {
  return SEND_PLUGIN_ALLOWLIST.find((p) => p.id === id)
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/shared/sendPlugins.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add native-engine/Source/SendPluginAllowlist.h src/shared/sendPlugins.ts src/shared/sendPlugins.test.ts
git commit -m "Add curated send-plugin allowlist (native + renderer twins)"
```

---

### Task 2: EngineProject wire format — sendBuses and per-stem sendLevels

**Files:**
- Modify: `native-engine/Source/EngineProject.h`
- Modify: `native-engine/Source/EngineProject.cpp`
- Test: `native-engine/Source/EngineProjectTests.cpp`

- [ ] **Step 1: Read the current test file to match its style**

Run: `cat native-engine/Source/EngineProjectTests.cpp`

This plan assumes the existing `beginTest("parses a full project with one rifff and one stem")` block builds a JSON string and calls `parseEngineProject`, then asserts on the resulting `EngineProject`/`EngineRifff`/`EngineStem` fields — extend that same JSON literal and assertion style for the new fields, don't restructure the file.

- [ ] **Step 2: Add the failing assertions to the existing "parses a full project" test**

Add to the JSON literal in that test's project string: a `"sendBuses"` array and, on the one stem, a `"sendLevels"` array:

```json
"sendBuses": [{"pluginId": "solid-bus-comp"}, {"pluginId": ""}, {"pluginId": ""}, {"pluginId": ""}]
```

and on the stem object:

```json
"sendLevels": [0.5, 0.0, 0.0, 0.0]
```

Add corresponding assertions after the existing ones in that test:

```cpp
expectEquals(project.sendBuses[0].pluginId, juce::String("solid-bus-comp"));
expectEquals(project.sendBuses[1].pluginId, juce::String(""));
expectEquals(project.rifffs[0].stems[0].sendLevels[0], 0.5);
expectEquals(project.rifffs[0].stems[0].sendLevels[1], 0.0);
```

- [ ] **Step 3: Add a new test for missing sendBuses/sendLevels (backward compatibility)**

```cpp
beginTest("defaults sendBuses to 4 empty slots and sendLevels to all-zero when omitted");
{
    const juce::String json = R"({
        "bpm": 120,
        "snapDiv": 16,
        "rifffs": [{
            "groupId": "r1",
            "startBar": 0,
            "barLength": 4,
            "stems": [{"stemKey": "r1:1", "resolvedPath": "/x.wav", "durationSec": 1, "barLength": 4}]
        }]
    })";
    EngineProject project;
    juce::String error;
    expect(parseEngineProject(json, project, error));
    for (const auto& bus : project.sendBuses)
        expect(bus.pluginId.isEmpty());
    for (double level : project.rifffs[0].stems[0].sendLevels)
        expectEquals(level, 0.0);
}
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd native-engine/build && cmake --build . --target ssstitch_engine -j 4 && ./ssstitch_engine_artefacts/Debug/ssstitch_engine --test`
Expected: build FAILS — `EngineProject`/`EngineStem` have no `sendBuses`/`sendLevels` members yet.

- [ ] **Step 5: Add the struct fields**

In `native-engine/Source/EngineProject.h`, add to `EngineStem` (after the existing `muted` field):

```cpp
        bool muted = false;
        std::array<double, 4> sendLevels { 0.0, 0.0, 0.0, 0.0 };
```

Add `#include <array>` to the top of the file alongside the existing `#include <vector>`.

Add a new struct and field to `EngineProject`:

```cpp
    struct EngineSendBus
    {
        juce::String pluginId; // empty = no plugin loaded on this bus
    };

    struct EngineProject
    {
        double bpm = 120.0;
        double snapDiv = 16.0;
        std::vector<EngineRifff> rifffs;
        std::array<EngineSendBus, 4> sendBuses;
    };
```

- [ ] **Step 6: Parse the new fields**

In `native-engine/Source/EngineProject.cpp`, inside the stem-parsing loop, right after `stem.muted = getBool(stemVar, "muted", false);`, add:

```cpp
                        auto sendLevelsVar = stemVar.getProperty("sendLevels", juce::var());
                        if (auto* sendLevelsArray = sendLevelsVar.getArray())
                        {
                            for (int i = 0; i < 4 && i < sendLevelsArray->size(); ++i)
                                stem.sendLevels[(size_t) i] = (double) sendLevelsArray->getReference(i);
                        }
```

At the top of `parseEngineProject`, right after `project.snapDiv = getDouble(parsed, "snapDiv", 16.0);`, add:

```cpp
        auto sendBusesVar = parsed.getProperty("sendBuses", juce::var());
        if (auto* sendBusesArray = sendBusesVar.getArray())
        {
            for (int i = 0; i < 4 && i < sendBusesArray->size(); ++i)
            {
                const auto& busVar = sendBusesArray->getReference(i);
                project.sendBuses[(size_t) i].pluginId = busVar.getProperty("pluginId", "").toString();
            }
        }
```

Both are deliberately lenient (missing/short arrays leave the rest at their defaults — empty plugin id, zero send level) rather than treating a shorter-than-4 array as a parse error: this keeps old saved projects (made before this feature existed) loading exactly as before, matching how every other optional field in this parser already degrades.

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd native-engine/build && cmake --build . --target ssstitch_engine -j 4 && ./ssstitch_engine_artefacts/Debug/ssstitch_engine --test`
Expected: PASS, `EngineProject` tests included.

- [ ] **Step 8: Commit**

```bash
git add native-engine/Source/EngineProject.h native-engine/Source/EngineProject.cpp native-engine/Source/EngineProjectTests.cpp
git commit -m "Add sendBuses/sendLevels to the EngineProject wire format"
```

---

### Task 3: SendBus — accumulation and silent-when-empty behavior (no real plugin needed)

**Files:**
- Create: `native-engine/Source/SendBus.h`
- Create: `native-engine/Source/SendBus.cpp`
- Test: `native-engine/Source/SendBusTests.cpp`
- Modify: `native-engine/CMakeLists.txt`

This task builds the block-accumulation API and proves it's silent when no bus has a plugin loaded — everything testable without touching a real plugin file. Task 4 adds the load/swap mechanism on top.

`SendBus` stores plugin instances as `juce::AudioProcessor` (the base class), not the more specific `juce::AudioPluginInstance` — every method `SendBus` actually calls (`prepareToPlay`, `processBlock`, `getTotalNumInputChannels`, `getTotalNumOutputChannels`) is declared on `AudioProcessor` itself. This is what makes Task 4's tests possible without a real plugin: a trivial test `AudioProcessor` subclass is a few lines; a full `AudioPluginInstance` subclass would need to also stub plugin-specific metadata this code never uses.

- [ ] **Step 1: Write the header**

```cpp
// native-engine/Source/SendBus.h
#pragma once
#include <juce_audio_processors/juce_audio_processors.h>
#include <array>
#include <atomic>
#include <functional>
#include <memory>

namespace ssstitch
{
    static constexpr int kNumSendBuses = 4;

    /** Owns up to kNumSendBuses live plugin instances and the per-block
     * accumulation buffer each one processes. See
     * docs/superpowers/specs/2026-07-29-send-bus-plugin-hosting-design.md
     * for the full rationale — this class implements its "Real-time-safe
     * plugin load/swap" and signal-flow sections.
     *
     * Real-time (audio-thread) API: applyPendingSwaps(), beginBlock(),
     * addSample(), mixBackInto() — called from PlaybackEngine::renderBlock,
     * in that order, once per block.
     *
     * Off-thread API: requestLoad() (message thread, hands the actual work
     * to a background thread) and loadPluginSync() (any thread, blocking —
     * for the offline export path only, where nothing is concurrently
     * reading this bus from an audio callback). */
    class SendBus
    {
    public:
        /** A plugin id -> live processor instance factory. Production code
         * uses the default (the real allowlist + AudioPluginFormatManager,
         * see .cpp); tests inject a fake to exercise the swap/accumulation
         * logic without depending on a real installed plugin. An empty
         * `pluginId` must return nullptr with `errorOut` left empty (not an
         * error — "no plugin" is a valid, silent state, not a failure). */
        using Instantiator = std::function<std::unique_ptr<juce::AudioProcessor>(
            const juce::String& pluginId, double sampleRate, int blockSize, juce::String& errorOut)>;

        explicit SendBus(Instantiator instantiator = &SendBus::defaultInstantiate);
        ~SendBus();

        SendBus(const SendBus&) = delete;
        SendBus& operator=(const SendBus&) = delete;

        /** Message-thread API: kicks off loading `pluginId` (an allowlist id,
         * or an empty string for "no plugin") onto `busIndex` on a
         * background thread. Safe to call again before a previous load for
         * the same bus finishes — whichever completes last wins (see .cpp).
         * `onLoaded` runs on that background thread once the load finishes
         * or fails; callers needing the message thread (e.g. to send an IPC
         * reply) must hop back to it themselves. */
        void requestLoad(
            int busIndex,
            const juce::String& pluginId,
            double sampleRate,
            int blockSize,
            std::function<void(bool success, const juce::String& error)> onLoaded);

        /** Synchronous, blocking load — offline export only, where nothing
         * concurrently reads this bus from an audio thread. Returns false
         * (errorOut set) on failure, leaving the bus unchanged. */
        bool loadPluginSync(
            int busIndex, const juce::String& pluginId, double sampleRate, int blockSize, juce::String& errorOut);

        /** Audio-thread API: promotes any bus with a ready pending swap to
         * active; the instance it replaces is handed to a background
         * cleanup thread rather than deleted here (a plugin's destructor
         * can do real work). Call once per block, before beginBlock(). */
        void applyPendingSwaps();

        /** Audio-thread API: sizes/clears every loaded bus's scratch buffer
         * for a block of `numSamples`. Call once per block, before any
         * addSample() calls. */
        void beginBlock(int numSamples);

        /** Audio-thread API: true if bus `busIndex` currently has a plugin
         * loaded (and is therefore worth sending to at all). */
        bool hasPlugin(int busIndex) const;

        /** Audio-thread API: adds gain-adjusted `l`/`r` (already scaled by
         * this one stem's own gain/volume/fade) into bus `busIndex`'s
         * scratch buffer at `sampleIndex`, further scaled by `sendLevel`.
         * No-op if the bus has no plugin loaded or sendLevel <= 0. */
        void addSample(int busIndex, int sampleIndex, float l, float r, float sendLevel);

        /** Audio-thread API: runs every loaded bus's plugin over its own
         * scratch buffer and adds the result into outL/outR — the send's
         * "return." A bus with no plugin loaded contributes nothing (never
         * an unprocessed dry duplicate). Call once per block, after every
         * stem's addSample() calls for that block. Only reads back the
         * plugin's own channels 0/1 (its main stereo output) even if its
         * scratch buffer is wider to satisfy a larger input requirement —
         * see the design spec's note on Solid Bus Comp's 4-in/2-out
         * layout. */
        void mixBackInto(int numSamples, float* outL, float* outR);

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

        std::array<Slot, kNumSendBuses> slots;
        Instantiator instantiator;
    };
}
```

- [ ] **Step 2: Write the .cpp, accumulation/mix-back portion only (load/swap methods are stubs for this step)**

```cpp
// native-engine/Source/SendBus.cpp
#include "SendBus.h"
#include "SendPluginAllowlist.h"
#include <algorithm>
#include <thread>

namespace ssstitch
{
    SendBus::SendBus(Instantiator inst) : instantiator(std::move(inst)) {}

    SendBus::~SendBus()
    {
        // Any pending instance that never got promoted is still owned here.
        // A background load still in flight at destruction time only holds
        // this object's `slots` array by reference and a plain juce::String
        // copy of the plugin id — it finishes harmlessly into a Slot that's
        // about to go away, or the process exits first. Not a concern for
        // this app's actual lifecycle (a short-lived console engine process
        // killed by the parent Electron process on quit).
        for (auto& slot : slots)
            delete slot.pending.exchange(nullptr);
    }

    void SendBus::applyPendingSwaps()
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
                // Deleting a plugin instance can do real work (its own
                // destructor tearing down resources) — never on the audio
                // thread.
                auto* toDelete = old.release();
                std::thread([toDelete]() { delete toDelete; }).detach();
            }
        }
    }

    void SendBus::beginBlock(int numSamples)
    {
        for (auto& slot : slots)
        {
            if (slot.active == nullptr)
                continue;
            if (slot.scratch.getNumSamples() != numSamples || slot.scratch.getNumChannels() != slot.processChannels)
                slot.scratch.setSize(slot.processChannels, numSamples, false, false, true);
            slot.scratch.clear();
        }
    }

    bool SendBus::hasPlugin(int busIndex) const
    {
        return slots[(size_t) busIndex].active != nullptr;
    }

    void SendBus::addSample(int busIndex, int sampleIndex, float l, float r, float sendLevel)
    {
        auto& slot = slots[(size_t) busIndex];
        if (slot.active == nullptr || sendLevel <= 0.0f)
            return;
        slot.scratch.addSample(0, sampleIndex, l * sendLevel);
        slot.scratch.addSample(1, sampleIndex, r * sendLevel);
    }

    void SendBus::mixBackInto(int numSamples, float* outL, float* outR)
    {
        juce::MidiBuffer midi;
        for (auto& slot : slots)
        {
            if (slot.active == nullptr)
                continue;
            slot.active->processBlock(slot.scratch, midi);
            midi.clear();
            for (int i = 0; i < numSamples; ++i)
            {
                outL[i] += slot.scratch.getSample(0, i);
                outR[i] += slot.scratch.getSample(1, i);
            }
        }
    }

    // --- load/swap: implemented in Task 4 ---

    std::unique_ptr<juce::AudioProcessor> SendBus::defaultInstantiate(
        const juce::String&, double, int, juce::String& errorOut)
    {
        errorOut = "not implemented until Task 4";
        return nullptr;
    }

    void SendBus::requestLoad(int, const juce::String&, double, int, std::function<void(bool, const juce::String&)>)
    {
        // implemented in Task 4
    }

    bool SendBus::loadPluginSync(int, const juce::String&, double, int, juce::String& errorOut)
    {
        errorOut = "not implemented until Task 4";
        return false;
    }
}
```

- [ ] **Step 3: Write the failing tests**

```cpp
// native-engine/Source/SendBusTests.cpp
#include "SendBus.h"
#include <juce_core/juce_core.h>

namespace ssstitch
{
    class SendBusTests : public juce::UnitTest
    {
    public:
        SendBusTests() : juce::UnitTest("SendBus") {}

        void runTest() override
        {
            beginTest("a bus with no plugin loaded contributes nothing");
            {
                SendBus bus;
                std::vector<float> l(8, 0.0f), r(8, 0.0f);
                bus.applyPendingSwaps();
                bus.beginBlock(8);
                for (int i = 0; i < 8; ++i)
                    bus.addSample(0, i, 1.0f, 1.0f, 1.0f); // hasPlugin() is false -> no-op
                bus.mixBackInto(8, l.data(), r.data());
                for (float s : l) expectEquals(s, 0.0f);
                for (float s : r) expectEquals(s, 0.0f);
            }

            beginTest("hasPlugin is false for every bus when nothing is loaded");
            {
                SendBus bus;
                for (int i = 0; i < kNumSendBuses; ++i)
                    expect(!bus.hasPlugin(i));
            }
        }
    };

    static SendBusTests sendBusTests;
}
```

- [ ] **Step 4: Add the new files to CMakeLists.txt**

In `native-engine/CMakeLists.txt`, add to `target_sources`, alongside the existing `Source/StemBufferCache.cpp` / `Source/StemBufferCacheTests.cpp` pair:

```cmake
  Source/SendBus.cpp
  Source/SendBusTests.cpp
```

- [ ] **Step 5: Build and run tests**

Run: `cd native-engine/build && cmake --build . --target ssstitch_engine -j 4 && ./ssstitch_engine_artefacts/Debug/ssstitch_engine --test`
Expected: PASS — both `SendBus` tests pass. Task 4 adds the loaded-bus tests (accumulation, sendLevel scaling, the swap mechanism) once there's a way to load a plugin without depending on a real installed one.

- [ ] **Step 6: Commit**

```bash
git add native-engine/Source/SendBus.h native-engine/Source/SendBus.cpp native-engine/Source/SendBusTests.cpp native-engine/CMakeLists.txt
git commit -m "Add SendBus: block accumulation and silent-when-empty behavior"
```

---

### Task 4: SendBus — real-time-safe plugin load/swap

**Files:**
- Modify: `native-engine/Source/SendBus.cpp`
- Modify: `native-engine/Source/SendBusTests.cpp`

- [ ] **Step 1: Write the failing tests, using a fake instantiator (no real plugin)**

Replace the empty placeholder test from Task 3 and add new tests to `SendBusTests.cpp`, inside `runTest()`:

```cpp
            beginTest("loadPluginSync loads a fake processor and it becomes active");
            {
                bool created = false;
                SendBus bus([&](const juce::String& id, double, int, juce::String& err) -> std::unique_ptr<juce::AudioProcessor>
                {
                    if (id.isEmpty()) { return nullptr; }
                    created = true;
                    err = {};
                    return std::make_unique<GainDoublingProcessor>();
                });
                juce::String error;
                expect(bus.loadPluginSync(0, "fake-plugin", 44100.0, 512, error));
                expect(error.isEmpty());
                expect(created);
                expect(bus.hasPlugin(0));
                expect(!bus.hasPlugin(1)); // untouched buses stay empty
            }

            beginTest("a loaded bus doubles gain (proves mixBackInto actually runs processBlock)");
            {
                SendBus bus([](const juce::String&, double, int, juce::String& err) -> std::unique_ptr<juce::AudioProcessor>
                {
                    err = {};
                    return std::make_unique<GainDoublingProcessor>();
                });
                juce::String error;
                bus.loadPluginSync(0, "fake-plugin", 44100.0, 512, error);

                std::vector<float> l(4, 0.0f), r(4, 0.0f);
                bus.applyPendingSwaps();
                bus.beginBlock(4);
                bus.addSample(0, 0, 0.5f, 0.5f, 1.0f); // sendLevel 1.0 -> 0.5 into the bus -> doubled to 1.0
                bus.mixBackInto(4, l.data(), r.data());
                expectWithinAbsoluteError(l[0], 1.0f, 1.0e-6f);
                expectWithinAbsoluteError(r[0], 1.0f, 1.0e-6f);
            }

            beginTest("sendLevel scales what reaches a loaded bus");
            {
                SendBus bus([](const juce::String&, double, int, juce::String& err) -> std::unique_ptr<juce::AudioProcessor>
                {
                    err = {};
                    return std::make_unique<GainDoublingProcessor>();
                });
                juce::String error;
                bus.loadPluginSync(0, "fake-plugin", 44100.0, 512, error);

                std::vector<float> l(4, 0.0f), r(4, 0.0f);
                bus.applyPendingSwaps();
                bus.beginBlock(4);
                bus.addSample(0, 0, 1.0f, 1.0f, 0.25f); // 0.25 into the bus -> doubled to 0.5
                bus.mixBackInto(4, l.data(), r.data());
                expectWithinAbsoluteError(l[0], 0.5f, 1.0e-6f);
            }

            beginTest("addSample with sendLevel 0 does not contribute even on a loaded bus");
            {
                SendBus bus([](const juce::String&, double, int, juce::String& err) -> std::unique_ptr<juce::AudioProcessor>
                {
                    err = {};
                    return std::make_unique<GainDoublingProcessor>();
                });
                juce::String error;
                bus.loadPluginSync(0, "fake-plugin", 44100.0, 512, error);

                std::vector<float> l(4, 0.0f), r(4, 0.0f);
                bus.applyPendingSwaps();
                bus.beginBlock(4);
                bus.addSample(0, 0, 1.0f, 1.0f, 0.0f);
                bus.mixBackInto(4, l.data(), r.data());
                expectEquals(l[0], 0.0f);
            }

            beginTest("requestLoad instantiates on a background thread and applyPendingSwaps promotes it");
            {
                std::atomic<bool> instantiateRanOffAudioThread { false };
                const auto testThreadId = std::this_thread::get_id();
                SendBus bus([&](const juce::String&, double, int, juce::String& err) -> std::unique_ptr<juce::AudioProcessor>
                {
                    if (std::this_thread::get_id() != testThreadId)
                        instantiateRanOffAudioThread.store(true);
                    err = {};
                    return std::make_unique<GainDoublingProcessor>();
                });

                std::atomic<bool> loadedCallbackFired { false };
                bus.requestLoad(0, "fake-plugin", 44100.0, 512, [&](bool success, const juce::String&)
                {
                    loadedCallbackFired.store(success);
                });

                // requestLoad is async — poll briefly for the background
                // thread to finish, matching how the real IPC round trip
                // (Task 7) will also wait on a callback rather than a fixed
                // delay in production code; a bounded poll is fine in a test.
                for (int i = 0; i < 100 && !loadedCallbackFired.load(); ++i)
                    juce::Thread::sleep(10);

                expect(loadedCallbackFired.load());
                expect(instantiateRanOffAudioThread.load());
                expect(!bus.hasPlugin(0)); // not yet promoted -- applyPendingSwaps hasn't run
                bus.applyPendingSwaps();
                expect(bus.hasPlugin(0));
            }

            beginTest("loading an empty pluginId clears a bus back to no-plugin");
            {
                SendBus bus([](const juce::String& id, double, int, juce::String& err) -> std::unique_ptr<juce::AudioProcessor>
                {
                    err = {};
                    if (id.isEmpty()) return nullptr;
                    return std::make_unique<GainDoublingProcessor>();
                });
                juce::String error;
                bus.loadPluginSync(0, "fake-plugin", 44100.0, 512, error);
                expect(bus.hasPlugin(0));
                bus.loadPluginSync(0, "", 44100.0, 512, error);
                expect(error.isEmpty());
                expect(!bus.hasPlugin(0));
            }
```

Add the fake processor above the `SendBusTests` class (inside the `ssstitch` namespace, in the same file):

```cpp
    /** Minimal AudioProcessor stand-in for tests: doubles every input
     * sample. Implements only the pure virtuals SendBus actually calls
     * (prepareToPlay/processBlock/channel counts) plus the handful
     * AudioProcessor itself requires a concrete override for. */
    class GainDoublingProcessor : public juce::AudioProcessor
    {
    public:
        GainDoublingProcessor()
            : juce::AudioProcessor(BusesProperties()
                .withInput("Input", juce::AudioChannelSet::stereo())
                .withOutput("Output", juce::AudioChannelSet::stereo()))
        {}

        void prepareToPlay(double, int) override {}
        void releaseResources() override {}
        void processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer&) override
        {
            buffer.applyGain(2.0f);
        }

        const juce::String getName() const override { return "GainDoublingProcessor"; }
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
```

Add `#include <thread>` and `#include <atomic>` to the top of `SendBusTests.cpp` if not already present via `SendBus.h`'s own includes (they are, transitively — no action needed, but worth confirming when running Step 2 below).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd native-engine/build && cmake --build . --target ssstitch_engine -j 4 && ./ssstitch_engine_artefacts/Debug/ssstitch_engine --test`
Expected: build succeeds (the fake processor and test structure compile fine against the existing stub methods), but the new tests FAIL — `loadPluginSync`/`requestLoad` are still stubs returning `"not implemented until Task 4"`.

- [ ] **Step 3: Implement `defaultInstantiate`, `loadPluginSync`, and `requestLoad`**

Replace the three stub implementations at the bottom of `SendBus.cpp`:

```cpp
    static std::unique_ptr<juce::AudioProcessor> instantiateFromAllowlist(
        const juce::String& pluginId, double sampleRate, int blockSize, juce::String& errorOut)
    {
        if (pluginId.isEmpty())
        {
            errorOut = {};
            return nullptr; // "no plugin" is a valid, silent state -- not an error
        }

        const auto* entry = findSendPlugin(pluginId);
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

    std::unique_ptr<juce::AudioProcessor> SendBus::defaultInstantiate(
        const juce::String& pluginId, double sampleRate, int blockSize, juce::String& errorOut)
    {
        return instantiateFromAllowlist(pluginId, sampleRate, blockSize, errorOut);
    }

    bool SendBus::loadPluginSync(
        int busIndex, const juce::String& pluginId, double sampleRate, int blockSize, juce::String& errorOut)
    {
        auto instance = instantiator(pluginId, sampleRate, blockSize, errorOut);
        if (!errorOut.isEmpty())
            return false;
        auto& slot = slots[(size_t) busIndex];
        slot.active = std::move(instance); // nullptr (empty pluginId) is a valid "no plugin" state
        slot.processChannels = slot.active != nullptr
            ? std::max({ 2, slot.active->getTotalNumInputChannels(), slot.active->getTotalNumOutputChannels() })
            : 2;
        return true;
    }

    void SendBus::requestLoad(
        int busIndex,
        const juce::String& pluginId,
        double sampleRate,
        int blockSize,
        std::function<void(bool, const juce::String&)> onLoaded)
    {
        auto& slot = slots[(size_t) busIndex];
        // A load already in flight for this bus is superseded, not queued —
        // only the newest request's result matters. The superseded thread
        // still runs to completion (a background juce::Thread can't safely
        // be cancelled mid-instantiation), but whichever publish into
        // `pending` happens last is what applyPendingSwaps() finds — the
        // atomic exchange below both publishes this thread's result and
        // safely discards whatever an in-between one left behind.
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
```

Note the `&slot` capture in `requestLoad`'s lambda: it's a reference into `this->slots`, safe only because a `SendBus` is expected to outlive every load it kicks off (it lives for the whole engine process's lifetime, owned by `runServe`/`RenderExport` — see Task 7). This is an accepted simplification for this app's specific lifecycle, not a general-purpose guarantee — flagged explicitly rather than silently assumed, matching the design spec's own "not a hardened pro-audio product" framing for similar tradeoffs.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd native-engine/build && cmake --build . --target ssstitch_engine -j 4 && ./ssstitch_engine_artefacts/Debug/ssstitch_engine --test`
Expected: PASS — all `SendBus` tests, including the async `requestLoad` one.

- [ ] **Step 5: Commit**

```bash
git add native-engine/Source/SendBus.cpp native-engine/Source/SendBusTests.cpp
git commit -m "Add SendBus real-time-safe plugin load/swap"
```

---

### Task 5: Wire SendBus into PlaybackEngine::renderBlock

**Files:**
- Modify: `native-engine/Source/PlaybackEngine.h`
- Modify: `native-engine/Source/PlaybackEngine.cpp`
- Modify: `native-engine/Source/PlaybackEngineTests.cpp`

`PlaybackEngine` gains a second reference member (`SendBus&`, alongside the existing `StemBufferCache&`), matching that existing pattern. `renderBlock`'s own signature is unchanged — no call-site changes needed at `Transport.cpp`/`RenderExport.cpp`'s call sites, only their `PlaybackEngine` *construction* changes (this task updates the test call sites; Task 6 updates `RenderExport.cpp`; Task 7 updates `Main.cpp`).

- [ ] **Step 1: Update the header**

In `native-engine/Source/PlaybackEngine.h`, add `#include "SendBus.h"` and change the constructor and private members:

```cpp
        explicit PlaybackEngine(StemBufferCache& bufferCache, SendBus& sendBus);
```

```cpp
    private:
        StemBufferCache& bufferCache;
        SendBus& sendBus;
        EngineProject currentProject;
```

- [ ] **Step 2: Update every existing PlaybackEngineTests.cpp construction site**

`PlaybackEngineTests.cpp` currently has 7 `beginTest` blocks, each with its own `StemBufferCache cache; PlaybackEngine engine(cache);` pair. Add a `SendBus sendBus;` (default-constructed — no plugin loaded on any bus) right after each `StemBufferCache cache;` line, and change every `PlaybackEngine engine(cache);` to `PlaybackEngine engine(cache, sendBus);`. This proves (once Step 4 below wires renderBlock to actually call SendBus) that every existing test's output is unaffected by an empty SendBus — the required regression-safety property.

Run: `grep -n "PlaybackEngine engine(cache)" native-engine/Source/PlaybackEngineTests.cpp` to find all 7 sites before editing.

- [ ] **Step 3: Run tests to verify they fail to build**

Run: `cd native-engine/build && cmake --build . --target ssstitch_engine -j 4`
Expected: build FAILS — `PlaybackEngine`'s constructor now requires two arguments; `PlaybackEngine.cpp`'s own constructor definition doesn't match the new header yet either.

- [ ] **Step 4: Update the constructor and renderBlock**

In `native-engine/Source/PlaybackEngine.cpp`:

```cpp
    PlaybackEngine::PlaybackEngine(StemBufferCache& cache, SendBus& sb) : bufferCache(cache), sendBus(sb) {}
```

At the very start of `renderBlock`, right after the existing early-return guard (`if (spb <= 0.0 || currentProject.rifffs.empty()) return;`), add:

```cpp
        sendBus.applyPendingSwaps();
        sendBus.beginBlock(numSamples);
```

Note: this means an empty/silent project (the early-return case) never touches SendBus at all for that block — matches the existing early-return's own "nothing to do" semantics, and means a swap that becomes ready during silence is applied on the next block that actually renders something, not immediately. This is an accepted, minor latency (at most one silent block's worth) rather than restructuring the early return.

Inside the per-stem loop, after the existing per-sample gain/output-accumulation lines (`outL[i2] += (float) (l * gain); outR[i2] += (float) (r * gain);`), add:

```cpp
                        for (int b = 0; b < kNumSendBuses; ++b)
                            sendBus.addSample(
                                b, i2, (float) (l * gain), (float) (r * gain), (float) stem.sendLevels[(size_t) b]);
```

Note this passes `l * gain`/`r * gain` — the same gain-adjusted values that go to the direct output on the line above — not the raw `l`/`r` samples. `SendBus::addSample`'s own doc comment expects already-gain-adjusted input (see Task 3), and `sendLevel` scales *that*, not the dry sample.

At the very end of `renderBlock`, after the closing brace of the outer `for (const auto& rifff : ...)` loop but still inside the function, add:

```cpp
        sendBus.mixBackInto(numSamples, outL, outR);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd native-engine/build && cmake --build . --target ssstitch_engine -j 4 && ./ssstitch_engine_artefacts/Debug/ssstitch_engine --test`
Expected: PASS — every existing `PlaybackEngine` test still passes unchanged (empty `SendBus` contributes nothing, matching Task 3's own "silent when empty" test).

- [ ] **Step 6: Write a new integration test proving a loaded send bus actually reaches the output**

Add to `PlaybackEngineTests.cpp`:

```cpp
            beginTest("a stem's send level routes signal through a loaded send bus into the output");
            {
                EngineProject project;
                project.bpm = 60.0;
                project.snapDiv = 16.0;
                EngineRifff rifff;
                rifff.startBar = 0.0;
                rifff.barLength = 1;
                EngineStem stem;
                stem.resolvedPath = fixture.getFullPathName(); // constant 0.5, from the top of this file
                stem.durationSec = 4.0;
                stem.barLength = 1;
                stem.volume = 0.0; // muted from the direct/dry path...
                stem.sendLevels[0] = 1.0; // ...but fully sent to bus 0
                rifff.stems.push_back(stem);
                project.rifffs.push_back(rifff);

                StemBufferCache cache;
                SendBus sendBus([](const juce::String&, double, int, juce::String& err) -> std::unique_ptr<juce::AudioProcessor>
                {
                    err = {};
                    return std::make_unique<GainDoublingProcessor>(); // reuse SendBusTests.cpp's fixture — see note below
                });
                juce::String error;
                sendBus.loadPluginSync(0, "fake", 44100.0, 512, error);

                PlaybackEngine engine(cache, sendBus);
                engine.setProject(project);

                std::vector<float> l(512, 0.0f), r(512, 0.0f);
                engine.renderBlock(0.0, 44100.0, 512, l.data(), r.data());
                // stem.volume is 0, so the direct path contributes 0. The
                // send path contributes 0.5 (source) * 1.0 (sendLevel) = 0.5
                // into the bus, doubled by GainDoublingProcessor -> 1.0.
                expectWithinAbsoluteError(l[100], 1.0f, 0.01f);
            }
```

This test references `GainDoublingProcessor`, defined in `SendBusTests.cpp` (Task 4) — move that class's definition to a small shared header, `native-engine/Source/TestFixtures.h`, so both test files can use it without duplicating it or one test file depending on another's translation unit:

```cpp
// native-engine/Source/TestFixtures.h
#pragma once
#include <juce_audio_processors/juce_audio_processors.h>

namespace ssstitch
{
    /** Minimal AudioProcessor stand-in for tests: doubles every input
     * sample. Implements only the pure virtuals SendBus actually calls
     * (prepareToPlay/processBlock/channel counts) plus the handful
     * AudioProcessor itself requires a concrete override for. Shared
     * between SendBusTests.cpp and PlaybackEngineTests.cpp. */
    class GainDoublingProcessor : public juce::AudioProcessor
    {
    public:
        GainDoublingProcessor()
            : juce::AudioProcessor(BusesProperties()
                .withInput("Input", juce::AudioChannelSet::stereo())
                .withOutput("Output", juce::AudioChannelSet::stereo()))
        {}

        void prepareToPlay(double, int) override {}
        void releaseResources() override {}
        void processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer&) override
        {
            buffer.applyGain(2.0f);
        }

        const juce::String getName() const override { return "GainDoublingProcessor"; }
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
}
```

Remove the class definition from `SendBusTests.cpp` and add `#include "TestFixtures.h"` there instead; add the same include to `PlaybackEngineTests.cpp`.

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd native-engine/build && cmake --build . --target ssstitch_engine -j 4 && ./ssstitch_engine_artefacts/Debug/ssstitch_engine --test`
Expected: PASS, including the new send-routing integration test.

- [ ] **Step 8: Commit**

```bash
git add native-engine/Source/PlaybackEngine.h native-engine/Source/PlaybackEngine.cpp native-engine/Source/PlaybackEngineTests.cpp native-engine/Source/SendBusTests.cpp native-engine/Source/TestFixtures.h
git commit -m "Wire SendBus into PlaybackEngine::renderBlock"
```

---

### Task 6: RenderExport uses SendBus too

**Files:**
- Modify: `native-engine/Source/RenderExport.h`
- Modify: `native-engine/Source/RenderExport.cpp`

Export loads plugins synchronously (`loadPluginSync`) — no real-time hand-off needed, since nothing else reads this `SendBus` concurrently during an offline render.

- [ ] **Step 1: Update the header to accept send-bus plugin loading errors**

```cpp
    /** Renders `project` offline to a 16-bit stereo WAV at `outputPath`,
     * covering `durationBars` bars from position 0, including any send-bus
     * plugins the project specifies (loaded synchronously — export has no
     * real-time deadline to protect). Returns false (errorOut set) on any
     * failure — invalid bpm, a send-bus plugin failing to load, can't open
     * the output path, can't create the WAV writer. */
    bool renderProjectToWavFile(
        const EngineProject& project,
        const juce::String& outputPath,
        double durationBars,
        juce::String& errorOut);
```

- [ ] **Step 2: Update the implementation**

In `RenderExport.cpp`, add `#include "SendBus.h"`. Change the function body's opening:

```cpp
        StemBufferCache bufferCache;
        SendBus sendBus;
        for (size_t i = 0; i < project.sendBuses.size(); ++i)
        {
            if (project.sendBuses[i].pluginId.isEmpty())
                continue;
            juce::String loadError;
            if (!sendBus.loadPluginSync(
                    (int) i, project.sendBuses[i].pluginId, 44100.0, 512, loadError))
            {
                errorOut = "send bus " + juce::String(i) + " failed to load: " + loadError;
                return false;
            }
        }
        PlaybackEngine engine(bufferCache, sendBus);
        engine.setProject(project);
```

(replacing the existing `StemBufferCache bufferCache; PlaybackEngine engine(bufferCache); engine.setProject(project);` three lines).

`renderBlock`'s own per-block loop later in the function is unchanged — it already calls `engine.renderBlock(...)`, and that now internally drives `sendBus` via the exact same path Task 5 added, no different for offline vs. live.

- [ ] **Step 3: Build and run existing tests to verify nothing broke**

Run: `cd native-engine/build && cmake --build . --target ssstitch_engine -j 4 && ./ssstitch_engine_artefacts/Debug/ssstitch_engine --test`
Expected: PASS — no existing `RenderExport`-adjacent test changes required (there's no dedicated `RenderExportTests.cpp`; it's exercised via `--render-test`/the JS parity tests instead).

Run: `cd /Users/nickel/Claudecode/bendlesss && npx vitest run` (full JS suite, includes native render-parity tests that exercise this exact function via the rebuilt binary)
Expected: PASS, all files.

- [ ] **Step 4: Commit**

```bash
git add native-engine/Source/RenderExport.h native-engine/Source/RenderExport.cpp
git commit -m "RenderExport loads and applies send-bus plugins during offline render"
```

---

### Task 7: IpcServer — load-send-plugin message, and wiring SendBus into Main.cpp

**Files:**
- Modify: `native-engine/Source/IpcServer.h`
- Modify: `native-engine/Source/IpcServer.cpp`
- Modify: `native-engine/Source/Main.cpp`

- [ ] **Step 1: Update IpcServer.h to hold a SendBus reference**

```cpp
    class IpcConnection : public juce::InterprocessConnection, private juce::Timer
    {
    public:
        IpcConnection(PlaybackEngine& engine, Transport& transport, StemBufferCache& bufferCache, SendBus& sendBus);
        ...
    private:
        ...
        SendBus& sendBus;
    };

    class IpcServer : public juce::InterprocessConnectionServer
    {
    public:
        IpcServer(PlaybackEngine& engine, Transport& transport, StemBufferCache& bufferCache, SendBus& sendBus);

        juce::InterprocessConnection* createConnectionObject() override;

    private:
        ...
        SendBus& sendBus;
    };
```

Add `#include "SendBus.h"` to the top of the file.

- [ ] **Step 2: Update IpcServer.cpp's constructors and add the new message**

Update both constructors to take and store `SendBus& sb`:

```cpp
    IpcConnection::IpcConnection(PlaybackEngine& e, Transport& t, StemBufferCache& c, SendBus& sb)
        : engine(e), transport(t), bufferCache(c), sendBus(sb)
    {
    }
```

```cpp
    IpcServer::IpcServer(PlaybackEngine& e, Transport& t, StemBufferCache& c, SendBus& sb)
        : engine(e), transport(t), bufferCache(c), sendBus(sb)
    {
    }

    juce::InterprocessConnection* IpcServer::createConnectionObject()
    {
        return new IpcConnection(engine, transport, bufferCache, sendBus);
    }
```

Add a new branch in `messageReceived`, after the existing `else if (type == "set-position")` block:

```cpp
        else if (type == "load-send-plugin")
        {
            if (!payload.isObject())
                return;
            const int bus = (int) payload.getProperty("bus", -1);
            const auto pluginId = payload.getProperty("pluginId", "").toString();
            if (bus < 0 || bus >= kNumSendBuses)
                return;

            // IpcConnection itself is only ever touched from the message
            // thread (InterprocessConnection's own contract), but
            // requestLoad's onLoaded callback fires on SendBus's background
            // loader thread — sendJson (and `this` in general) must not be
            // touched from there directly. Post back to the message thread.
            sendBus.requestLoad(bus, pluginId, transport.isPlaying() ? 44100.0 : 44100.0, 512,
                [this, bus, pluginId](bool success, const juce::String& error)
                {
                    juce::MessageManager::callAsync([this, bus, pluginId, success, error]()
                    {
                        juce::DynamicObject::Ptr payloadObj = new juce::DynamicObject();
                        payloadObj->setProperty("bus", bus);
                        payloadObj->setProperty("pluginId", pluginId);
                        payloadObj->setProperty("success", success);
                        if (!success)
                            payloadObj->setProperty("error", error);
                        juce::DynamicObject::Ptr obj = new juce::DynamicObject();
                        obj->setProperty("type", "send-plugin-loaded");
                        obj->setProperty("payload", juce::var(payloadObj.get()));
                        sendJson(juce::var(obj.get()));
                    });
                });
        }
```

The sample rate is hardcoded to `44100.0` here rather than queried from `Transport` — this engine's device I/O consistently assumes 44.1kHz elsewhere too (`StemBufferCache`'s own default, `RenderExport`'s hardcoded render rate); a real device running at a different rate is an existing, pre-existing gap in this codebase, not one introduced here. `juce::MessageManager::callAsync` is what makes it safe to call `sendJson` (which ultimately touches the socket, message-thread-only per `InterprocessConnection`'s contract) from `requestLoad`'s background-thread callback.

- [ ] **Step 3: Wire SendBus into Main.cpp's runServe**

In `native-engine/Source/Main.cpp`, add `#include "SendBus.h"` at the top. In `runServe`:

```cpp
static int runServe(int port)
{
    StemBufferCache bufferCache;
    SendBus sendBus;
    PlaybackEngine engine(bufferCache, sendBus);
    Transport transport(engine);
    transport.openDefaultDevice();

    IpcServer server(engine, transport, bufferCache, sendBus);
    ...
```

(only the `SendBus sendBus;` line, the `PlaybackEngine engine(bufferCache, sendBus);` argument change, and the `IpcServer server(...)` argument change — the rest of `runServe` is unchanged).

- [ ] **Step 4: Build and run tests**

Run: `cd native-engine/build && cmake --build . --target ssstitch_engine -j 4 && ./ssstitch_engine_artefacts/Debug/ssstitch_engine --test`
Expected: PASS.

- [ ] **Step 5: Manual verification of the new IPC message**

This message type has no automated test in this plan (it's a thin wiring layer over already-tested `SendBus`/`IpcConnection` machinery, and the existing IPC round-trip test in `native-engine/test/parity/ipc-roundtrip.test.ts` covers the general request/response pattern already) — verify manually:

Run: `cd native-engine/build && ./ssstitch_engine_artefacts/Debug/ssstitch_engine --serve 45400 &`
Then, in another terminal, use the existing `--test-client` mode as a reference for how to send a raw JSON message over the socket (or defer full manual verification to Task 14's end-to-end UI check, once the renderer side can actually trigger this — noting that choice here rather than inventing a one-off client script for this task alone).

- [ ] **Step 6: Commit**

```bash
git add native-engine/Source/IpcServer.h native-engine/Source/IpcServer.cpp native-engine/Source/Main.cpp
git commit -m "Add load-send-plugin IPC message"
```

---

### Task 8: Renderer — buildEngineProject.ts sends sendBuses/sendLevels

**Files:**
- Modify: `src/shared/buildEngineProject.ts`
- Modify: `src/shared/buildEngineProject.test.ts`

- [ ] **Step 1: Read the current file and its test in full**

Run: `cat src/shared/buildEngineProject.ts src/shared/buildEngineProject.test.ts`

- [ ] **Step 2: Write the failing test**

Add to `buildEngineProject.test.ts`, following its existing style (construct a minimal `AppState`, call `buildEngineProject`, assert on the resulting `EngineProject`):

```ts
it('includes sendBuses and each stem\'s sendLevels', async () => {
  const state: AppState = {
    ...initialState,
    sendBusPlugins: ['solid-bus-comp', null, null, null],
    sendLevels: { 'r1:1': [0.5, 0, 0, 0] },
    rifffs: { r1: rifff } // reuse this file's existing minimal rifff fixture
  }
  const project = await buildEngineProject(state, stubResolver) // reuse existing stub resolver from this file
  expect(project.sendBuses).toEqual([
    { pluginId: 'solid-bus-comp' },
    { pluginId: null },
    { pluginId: null },
    { pluginId: null }
  ])
  expect(project.rifffs[0].stems[0].sendLevels).toEqual([0.5, 0, 0, 0])
})

it('defaults a stem with no sendLevels entry to all zero', async () => {
  const state: AppState = { ...initialState, rifffs: { r1: rifff } }
  const project = await buildEngineProject(state, stubResolver)
  expect(project.rifffs[0].stems[0].sendLevels).toEqual([0, 0, 0, 0])
})
```

Adjust fixture names (`rifff`, `stubResolver`) to match whatever this file's existing tests actually call them — read Step 1's output before writing this, don't guess.

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/shared/buildEngineProject.test.ts`
Expected: FAIL — `EngineProject`/`EngineStem` types don't have `sendBuses`/`sendLevels` yet, and `AppState` doesn't have `sendBusPlugins`/`sendLevels` yet either (this will actually fail to typecheck before it fails at runtime — that's fine, still "fails," per Step 2 of the standard TDD step pattern this plan follows elsewhere. `AppState`'s own fields are added in Task 9, which must land before this test can even compile — see the note at the end of this task).

- [ ] **Step 4: Add the wire-format types and build logic**

In `buildEngineProject.ts`, add to the `EngineStem` interface:

```ts
  sendLevels: [number, number, number, number]
```

Add to the `EngineProject` interface:

```ts
  sendBuses: [
    { pluginId: string | null },
    { pluginId: string | null },
    { pluginId: string | null },
    { pluginId: string | null }
  ]
```

In the function body, where each `EngineStem` is pushed (`stems.push({ stemKey: key, resolvedPath: resolved.path, ... volume: state.vol[key] ?? 1, muted: state.mute[key] ?? false })`), add a `sendLevels` field to that same object literal:

```ts
        sendLevels: state.sendLevels[key] ?? [0, 0, 0, 0],
```

(`key` is the existing `const key = stemKey(rifff.groupId, stem.slot)` already in scope there — reuse it, don't recompute).

Change the function's final return statement from `return { bpm: state.bpm, snapDiv: SNAP_DIVS[state.snapIdx], rifffs }` to:

```ts
  return {
    bpm: state.bpm,
    snapDiv: SNAP_DIVS[state.snapIdx],
    rifffs,
    sendBuses: state.sendBusPlugins.map((pluginId) => ({ pluginId })) as EngineProject['sendBuses']
  }
```

- [ ] **Step 5: Run test to verify it passes**

This task's test can only fully pass once Task 9 adds `sendBusPlugins`/`sendLevels` to `AppState`. If executing tasks in order, skip straight to Task 9, then return here — or, if executing Task 9 first is more convenient given the dependency, do so and note the reordering in the commit message. Either order is fine; the two tasks are tightly coupled by this one type dependency.

Run: `npx vitest run src/shared/buildEngineProject.test.ts`
Expected: PASS (once `AppState` has the needed fields).

- [ ] **Step 6: Commit**

```bash
git add src/shared/buildEngineProject.ts src/shared/buildEngineProject.test.ts
git commit -m "buildEngineProject includes sendBuses and per-stem sendLevels"
```

---

### Task 9: Renderer state — sendBusPlugins, sendLevels, and their actions

**Files:**
- Modify: `src/renderer/src/state/store.ts`
- Modify: `src/renderer/src/state/store.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `store.test.ts`, following this file's existing `describe(...)` block style:

```ts
describe('SET_SEND_LEVEL', () => {
  it('sets one bus\'s send level for a stem, defaulting others to 0', () => {
    let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeRifff() })
    state = reducer(state, { type: 'SET_SEND_LEVEL', stemKey: 'r1:1', bus: 2, level: 0.75 })
    expect(state.sendLevels['r1:1']).toEqual([0, 0, 0.75, 0])
  })

  it('clamps level to [0, 1]', () => {
    let state = reducer(initialState, { type: 'SET_SEND_LEVEL', stemKey: 'r1:1', bus: 0, level: 5 })
    expect(state.sendLevels['r1:1'][0]).toBe(1)
    state = reducer(state, { type: 'SET_SEND_LEVEL', stemKey: 'r1:1', bus: 0, level: -2 })
    expect(state.sendLevels['r1:1'][0]).toBe(0)
  })

  it('preserves other buses already set on the same stem', () => {
    let state = reducer(initialState, { type: 'SET_SEND_LEVEL', stemKey: 'r1:1', bus: 0, level: 0.3 })
    state = reducer(state, { type: 'SET_SEND_LEVEL', stemKey: 'r1:1', bus: 1, level: 0.6 })
    expect(state.sendLevels['r1:1']).toEqual([0.3, 0.6, 0, 0])
  })
})

describe('SET_SEND_BUS_PLUGIN', () => {
  it('sets a bus\'s plugin id', () => {
    const state = reducer(initialState, { type: 'SET_SEND_BUS_PLUGIN', bus: 1, pluginId: 'soothe2' })
    expect(state.sendBusPlugins).toEqual([null, 'soothe2', null, null])
  })

  it('setting pluginId to null clears a bus', () => {
    let state = reducer(initialState, { type: 'SET_SEND_BUS_PLUGIN', bus: 1, pluginId: 'soothe2' })
    state = reducer(state, { type: 'SET_SEND_BUS_PLUGIN', bus: 1, pluginId: null })
    expect(state.sendBusPlugins).toEqual([null, null, null, null])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/state/store.test.ts`
Expected: FAIL — `SET_SEND_LEVEL`/`SET_SEND_BUS_PLUGIN` aren't valid actions yet.

- [ ] **Step 3: Add the state fields and actions**

In `store.ts`, add to the `AppState` interface (near `vol`/`mute`, which follow the same per-stem-keyed-record convention):

```ts
  /** Each stem's send level per bus, [0,1] each, defaulting to all-zero
   * (a stem sends nothing anywhere until explicitly raised) — keyed by
   * stemKey, same convention as vol/mute. */
  sendLevels: Record<string, [number, number, number, number]>
  /** Which allowlist plugin id (or null, "off") is loaded on each of the 4
   * fixed send buses. See src/shared/sendPlugins.ts for the allowlist. */
  sendBusPlugins: [string | null, string | null, string | null, string | null]
```

Add to `initialState`:

```ts
  sendLevels: {},
  sendBusPlugins: [null, null, null, null],
```

Add to the `Action` union:

```ts
  | { type: 'SET_SEND_LEVEL'; stemKey: string; bus: 0 | 1 | 2 | 3; level: number }
  | { type: 'SET_SEND_BUS_PLUGIN'; bus: 0 | 1 | 2 | 3; pluginId: string | null }
```

Add reducer cases (near `SET_VOLUME`, which follows the same per-stem-key pattern):

```ts
    case 'SET_SEND_LEVEL': {
      const current = state.sendLevels[action.stemKey] ?? [0, 0, 0, 0]
      const next = [...current] as [number, number, number, number]
      next[action.bus] = Math.max(0, Math.min(1, action.level))
      return { ...state, sendLevels: { ...state.sendLevels, [action.stemKey]: next } }
    }

    case 'SET_SEND_BUS_PLUGIN': {
      const next = [...state.sendBusPlugins] as typeof state.sendBusPlugins
      next[action.bus] = action.pluginId
      return { ...state, sendBusPlugins: next }
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/src/state/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Return to Task 8 and verify its test now passes too**

Run: `npx vitest run src/shared/buildEngineProject.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/state/store.ts src/renderer/src/state/store.test.ts
git commit -m "Add sendLevels/sendBusPlugins state and their actions"
```

---

### Task 10: Preload + main-process IPC bridge for load-send-plugin

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/main/index.ts`

- [ ] **Step 1: Add the preload bridge method**

In `src/preload/index.ts`, add to the `api` object, near `engineLoadProject`/`onEnginePositionUpdate`:

```ts
  loadSendPlugin: (bus: number, pluginId: string | null): Promise<void> =>
    ipcRenderer.invoke('engine-load-send-plugin', bus, pluginId),
  onSendPluginLoaded: (
    callback: (result: { bus: number; pluginId: string; success: boolean; error?: string }) => void
  ): (() => void) => {
    const listener = (
      _event: unknown,
      payload: { bus: number; pluginId: string; success: boolean; error?: string }
    ): void => callback(payload)
    ipcRenderer.on('send-plugin-loaded', listener)
    return () => ipcRenderer.removeListener('send-plugin-loaded', listener)
  },
```

- [ ] **Step 2: Add the main-process handler**

In `src/main/index.ts`, find where `engine-load-project`/`engine-set-position` are handled (search for `ipcMain.handle('engine-`) and add, following the same pattern:

```ts
  ipcMain.handle('engine-load-send-plugin', (_event, bus: number, pluginId: string | null) => {
    playbackEngine?.sendLoadSendPlugin(bus, pluginId)
  })
```

This assumes `playbackEngine` (the object wrapping the persistent engine connection, already referenced by the existing `engine-load-project` handler via `playbackEngine?.sendLoadProject(project)`) needs a matching `sendLoadSendPlugin` method — check `src/main/playbackEngineLifecycle.ts` (or wherever `sendLoadProject` is actually defined) for its exact shape before adding the new method, and mirror it exactly: same message-sending mechanism, same `?.`-guarded optional-chaining call site convention already used for every other engine-* handler in this file.

Also wire the engine's `send-plugin-loaded` push message through to the renderer, alongside wherever `engine-position-update` is currently forwarded (likely also in `playbackEngineLifecycle.ts`, listening for a named message type from the persistent engine connection and calling `win.webContents.send('send-plugin-loaded', payload)`). Match that file's existing pattern for `engine-position-update`/`engine-restarted` exactly — read it in full before adding this.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no test covers this thin IPC-forwarding layer directly — it's exercised end-to-end in Task 14's manual verification).

- [ ] **Step 4: Commit**

```bash
git add src/preload/index.ts src/main/index.ts src/main/playbackEngineLifecycle.ts
git commit -m "Add load-send-plugin IPC bridge (preload + main process)"
```

---

### Task 11: StoreContext.tsx — dispatch load-send-plugin on SET_SEND_BUS_PLUGIN

**Files:**
- Modify: `src/renderer/src/state/StoreContext.tsx`

Read the current file in full before starting — it was substantially refactored this session (commit 223044d, splitting `pos`/`playing` into their own contexts) and has an established pattern worth matching exactly: `dispatch` is a `useCallback`-wrapped function that intercepts specific action types before forwarding everything else to `rawDispatch`.

- [ ] **Step 1: Extend the dispatch interceptor**

`SET_SEND_BUS_PLUGIN` needs to both update state (via the normal reducer, so it still flows to `rawDispatch`) *and* trigger the `loadSendPlugin` IPC call as a side effect. Unlike `PLAY`/`PAUSE`/`STOP`/`SET_POS` (which are intercepted *instead of* reaching the reducer), this one does both — forward to `rawDispatch` as normal, then also fire the IPC call:

In the `dispatch` callback's `switch` statement, add a case before the `default`:

```ts
      case 'SET_SEND_BUS_PLUGIN':
        rawDispatch(action)
        void window.rifffApi.loadSendPlugin(action.bus, action.pluginId)
        return
```

- [ ] **Step 2: Subscribe to send-plugin-loaded**

Add a new effect, near the existing `onEnginePositionUpdate`/`onEngineRestarted` subscriptions:

```tsx
  useEffect(() => {
    return window.rifffApi.onSendPluginLoaded(({ bus, success, error }) => {
      if (!success) {
        console.error(`StoreContext: send bus ${bus} failed to load plugin: ${error}`)
      }
    })
  }, [])
```

This deliberately only logs for now — Task 13's sends panel will read a richer loading/error state; this task's scope is just proving the round trip works, not yet building the UI that consumes it. (Task 13 replaces this bare console.error with real UI state — noted here so the two tasks don't silently diverge.)

- [ ] **Step 3: Typecheck and run the full test suite**

Run: `npm run typecheck && npx vitest run`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/state/StoreContext.tsx
git commit -m "Dispatch load-send-plugin IPC when SET_SEND_BUS_PLUGIN fires"
```

---

### Task 12: Sends panel (TransportBar)

**Files:**
- Modify: `src/renderer/src/components/TransportBar.tsx`
- Modify: `src/renderer/src/state/StoreContext.tsx` (loading/error state moves here from Task 11's placeholder)

- [ ] **Step 1: Move send-plugin-loaded tracking into real state**

Task 11 added a bare `console.error` subscription. Replace it with real state the sends panel can read. In `StoreContext.tsx`, this needs to live somewhere components can subscribe to — follow this file's existing `usePos`/`usePlaying` pattern (a small dedicated context, not bolted onto the main `AppState`, since load-status is transient UI feedback, not project data):

```tsx
export type SendBusStatus = 'idle' | 'loading' | 'loaded' | 'error'

const SendBusStatusCtx = createContext<[SendBusStatus, SendBusStatus, SendBusStatus, SendBusStatus]>([
  'idle', 'idle', 'idle', 'idle'
])
```

In `StoreProvider`, add:

```tsx
  const [sendBusStatus, setSendBusStatus] = useState<[SendBusStatus, SendBusStatus, SendBusStatus, SendBusStatus]>([
    'idle', 'idle', 'idle', 'idle'
  ])
```

Update the `SET_SEND_BUS_PLUGIN` dispatch case from Task 11 to also mark that bus as loading:

```ts
      case 'SET_SEND_BUS_PLUGIN':
        rawDispatch(action)
        setSendBusStatus((s) => {
          const next = [...s] as typeof s
          next[action.bus] = action.pluginId ? 'loading' : 'idle'
          return next
        })
        void window.rifffApi.loadSendPlugin(action.bus, action.pluginId)
        return
```

Replace Task 11's `onSendPluginLoaded` effect body:

```tsx
  useEffect(() => {
    return window.rifffApi.onSendPluginLoaded(({ bus, success, error }) => {
      if (!success) console.error(`StoreContext: send bus ${bus} failed to load plugin: ${error}`)
      setSendBusStatus((s) => {
        const next = [...s] as typeof s
        next[bus] = success ? 'loaded' : 'error'
        return next
      })
    })
  }, [])
```

Wrap the provider tree with `<SendBusStatusCtx.Provider value={sendBusStatus}>`, and export:

```tsx
// eslint-disable-next-line react-refresh/only-export-components -- context hook, not a component
export function useSendBusStatus(): [SendBusStatus, SendBusStatus, SendBusStatus, SendBusStatus] {
  return useContext(SendBusStatusCtx)
}
```

- [ ] **Step 2: Build the sends panel UI**

In `TransportBar.tsx`, add imports:

```ts
import { useState } from 'react' // already imported — just noting it's needed below
import { useSendBusStatus } from '../state/StoreContext'
import { SEND_PLUGIN_ALLOWLIST } from '@shared/sendPlugins'
```

Add local state for the panel's open/closed state, and the status hook, near the top of the component body:

```tsx
  const [sendsPanelOpen, setSendsPanelOpen] = useState(false)
  const sendBusStatus = useSendBusStatus()
```

Add a button next to the existing "envelope"/"compact" toggle buttons, matching their exact style convention:

```tsx
      <button
        onClick={() => setSendsPanelOpen((v) => !v)}
        aria-label="Toggle sends panel"
        style={{
          height: 22,
          borderRadius: 0,
          padding: '0 8px',
          fontSize: 10,
          background: sendsPanelOpen ? 'var(--ra-stretch-on-bg)' : 'var(--ra-bg-row-active)',
          border: `1px solid ${sendsPanelOpen ? 'var(--ra-stretch-on)' : 'var(--ra-border)'}`,
          color: sendsPanelOpen ? 'var(--ra-stretch-on)' : 'var(--ra-text-2)'
        }}
      >
        sends
      </button>
```

Add the panel itself, rendered conditionally at the end of the component's returned JSX (as a sibling to the transport bar's own root `<div>`, positioned absolutely below it):

```tsx
      {sendsPanelOpen && (
        <div
          style={{
            position: 'absolute',
            top: 46,
            right: 14,
            zIndex: 20,
            background: 'var(--ra-bg-bar)',
            border: '1px solid var(--ra-border-strong)',
            padding: 10,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            minWidth: 220
          }}
        >
          {([0, 1, 2, 3] as const).map((bus) => (
            <div key={bus} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 9, color: 'var(--ra-text-3)', width: 12 }}>{bus + 1}</span>
              <select
                value={state.sendBusPlugins[bus] ?? ''}
                onChange={(e) =>
                  dispatch({
                    type: 'SET_SEND_BUS_PLUGIN',
                    bus,
                    pluginId: e.target.value || null
                  })
                }
                style={{
                  flex: 1,
                  height: 22,
                  fontSize: 10,
                  background: 'var(--ra-bg-row-active)',
                  color: 'var(--ra-text)',
                  border: '1px solid var(--ra-border)'
                }}
              >
                <option value="">none</option>
                {SEND_PLUGIN_ALLOWLIST.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.displayName}
                  </option>
                ))}
              </select>
              <span
                style={{
                  fontSize: 9,
                  width: 44,
                  color:
                    sendBusStatus[bus] === 'error'
                      ? 'var(--ra-mute-on)'
                      : sendBusStatus[bus] === 'loaded'
                        ? 'var(--ra-text)'
                        : 'var(--ra-text-3)'
                }}
              >
                {sendBusStatus[bus]}
              </span>
            </div>
          ))}
        </div>
      )}
```

This is placed inside `TransportBar`'s returned JSX, so it needs `TransportBar`'s own root element to establish a `position: relative` context for the panel's `position: absolute` — check the existing root `<div>`'s style; if it doesn't already have `position: relative`, add it (it likely doesn't need one today since nothing inside it was previously absolutely positioned).

- [ ] **Step 3: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 4: Manual verification**

Run: `npm run dev`, open the app, click "sends," pick a plugin from bus 1's dropdown, confirm the status text moves `idle` → `loading` → `loaded` (or `error` if the plugin path doesn't resolve on this machine — expected if run somewhere other than the machine the allowlist paths were confirmed on).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/TransportBar.tsx src/renderer/src/state/StoreContext.tsx
git commit -m "Add sends panel to TransportBar"
```

---

### Task 13: Per-stem send-level controls (Inspector)

**Files:**
- Modify: `src/renderer/src/components/Inspector.tsx`

- [ ] **Step 1: Read the current stems section in full**

Run: `grep -n "STEMS" -A 60 src/renderer/src/components/Inspector.tsx`

This plan assumes each stem renders as a row with a type-cycle swatch, slot number, and an `EditableText` name (added this session for renaming) inside a `Fragment`, with an `unlinked &&` conditional block for per-stem nudge controls below it — match that existing structure exactly; add the send sliders as a further conditional-free addition inside the same per-stem `Fragment`, always visible (not gated behind `unlinked`).

- [ ] **Step 2: Add the send-level controls**

Add `import { SEND_PLUGIN_ALLOWLIST } from '@shared/sendPlugins'` near the top.

Inside the `.map((stem) => { ... return <Fragment key={stem.slot}> ... </Fragment> })` body, after the existing name/type row `<div>` and before the `{unlinked && (...)}` block, add:

```tsx
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 13, marginBottom: 4 }}>
                    {([0, 1, 2, 3] as const).map((bus) => {
                      const key = stemKey(groupId, stem.slot)
                      const level = state.sendLevels[key]?.[bus] ?? 0
                      const hasPlugin = state.sendBusPlugins[bus] !== null
                      return (
                        <input
                          key={bus}
                          type="range"
                          min={0}
                          max={1}
                          step={0.01}
                          value={level}
                          disabled={!hasPlugin}
                          title={
                            hasPlugin
                              ? `send to bus ${bus + 1} (${SEND_PLUGIN_ALLOWLIST.find((p) => p.id === state.sendBusPlugins[bus])?.displayName ?? state.sendBusPlugins[bus]})`
                              : `bus ${bus + 1}: no plugin loaded`
                          }
                          onChange={(e) =>
                            dispatch({
                              type: 'SET_SEND_LEVEL',
                              stemKey: key,
                              bus,
                              level: Number(e.target.value)
                            })
                          }
                          style={{ width: 32, opacity: hasPlugin ? 1 : 0.3 }}
                        />
                      )
                    })}
                  </div>
```

`stemKey` needs importing from `@shared/types` if not already imported in this file (check the existing import list — `Inspector.tsx` already uses `stemKey`-shaped strings elsewhere in this session's earlier edits, likely already imported; add it if not).

Sliders for a bus with no plugin loaded are disabled and dimmed rather than hidden — keeps all 4 slots always in the same visual position (predictable, no layout shift as buses get configured/cleared) while making clear that adjusting one currently does nothing audible, matching the design spec's "an empty send must never sound like an unprocessed dry duplicate" rule extended to the control itself (nothing to adjust if there's nothing to hear).

- [ ] **Step 3: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 4: Manual verification**

Run: `npm run dev`, load a plugin onto a bus via the sends panel (Task 12), select a rifff, raise one of its stems' send sliders for that bus during playback, confirm an audible change.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/Inspector.tsx
git commit -m "Add per-stem send-level sliders to Inspector"
```

---

### Task 14: Full verification and final review

- [ ] **Step 1: Native build and test**

```bash
cd native-engine/build && cmake --build . --target ssstitch_engine -j 4
./ssstitch_engine_artefacts/Debug/ssstitch_engine --test
```
Expected: PASS, all suites including the new `SendBus` and updated `PlaybackEngine`/`EngineProject` tests.

- [ ] **Step 2: Full JS/TS suite**

```bash
cd /Users/nickel/Claudecode/bendlesss
npm run typecheck
npm run lint
npx vitest run
```
Expected: PASS. Note: this session repeatedly hit real flakiness from native-engine spawn/socket-based tests (`playbackEngineLifecycle.test.ts`, `native-engine/test/parity/ipc-roundtrip.test.ts`) unrelated to actual code changes — a single re-run always resolved it. If a run fails only in one of those specific files, re-run once before treating it as a real regression.

- [ ] **Step 3: Full production build**

```bash
npx electron-vite build
```
Expected: succeeds (main + preload + renderer), matching this session's earlier verification pattern for large renderer-side changes.

- [ ] **Step 4: End-to-end manual verification**

With `npm run dev` running: load Solid Bus Comp onto send bus 1 via the sends panel; select a rifff with at least one stem; raise that stem's bus-1 send level during playback; confirm an audible compression effect on whatever's routed there. Then export the project and confirm the rendered mix reflects the same send (informally — by ear, not a byte-diff, since the real-time and offline paths use independently-loaded plugin instances that aren't guaranteed sample-identical the way the dry mixing path is).

- [ ] **Step 5: Self-review against the spec**

Re-read `docs/superpowers/specs/2026-07-29-send-bus-plugin-hosting-design.md` section by section and confirm each is implemented: signal flow (Task 5), real-time-safe swap (Task 4), data model (Tasks 8-9), wire protocol (Tasks 2, 8), allowlist (Task 1), UI (Tasks 12-13), error handling (Task 3's silent-when-empty, Task 12's error status), "not in scope" items genuinely absent (no parameter editing UI, no directory scan, no bus-count configuration, no crash isolation, no insert-effect UI).
