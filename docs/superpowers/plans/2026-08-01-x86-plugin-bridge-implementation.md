# x86_64 Plugin Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let x86_64-only VST3/AU plugins load and run as real, live, automatable inserts in the master chain and per-channel chains, by running them in a second Rosetta-launched x86_64 process and streaming audio across the process boundary in real time via shared memory.

**Architecture:** A new, separate x86_64-only CMake target (`native-engine-bridge/`) hosts plugin instances and their editor windows, spawned lazily by the main arm64 engine and kept alive for the session. Audio crosses the process boundary through a lock-free shared-memory ring buffer per bridged slot, signaled with named POSIX semaphores and a hard per-block timeout that substitutes silence rather than ever blocking the real-time graph. `PluginChain` branches at load time on `detectPluginArchitecture(path)`: arm64/universal loads in-process exactly as today; x86_64 delegates to the bridge. No `EngineProject` wire-format change — architecture is re-derived from the plugin's path, not threaded through the project JSON.

**Tech Stack:** JUCE 8.0.4 / C++20 (both native targets), Electron/React/TypeScript (renderer + main), Vitest, `juce::UnitTestRunner`.

---

**Full spec:** `docs/superpowers/specs/2026-08-01-x86-plugin-bridge-design.md` — read it before starting; this plan implements it task by task.

**Main engine build+test command:**
```bash
cd native-engine && cmake --build build && ./build/sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine --test
```

**Bridge build command** (no `--test` mode of its own until Task 3, which brings its own unit tests into the MAIN engine's test binary — see that task's note on why):
```bash
cd native-engine-bridge && cmake --build build
```

**Renderer/shared/main verification commands:**
```bash
npm run typecheck
npm run lint
npx vitest run
```

**Four scope decisions made during planning, not explicit in the spec — read before starting Task 7:**
1. `PluginChain::loadPluginSync` (the offline export path) is **not** given bridge support. Export's `PluginChain` instances are always constructed with `bridgeClient = nullptr` (see Task 8's `RenderExport.cpp` — deliberately unchanged), so attempting to export a project with an x86_64 plugin loaded fails exactly the way it already does today, before this feature existed: JUCE's own in-process loader can't load foreign-architecture code, so `instantiator(...)` fails with a normal, already-handled error. This is a real, deliberate limitation (exported renders don't support bridged plugins yet) — flag it in your own final report, don't quietly build full export bridging support, which would be substantial undisclosed scope beyond the approved spec.
2. Per the spec's "single block timeout → silence, persistent bridge loss → silence + errored slot" behavior: "silence" means the chain's output **is actually zeroed** for that slot's contribution that block, not "bypass/pass the signal through unmodified." This matters for a series chain — a bypassed slot vs. a silenced one sound different. Implemented literally as "silence" in Task 7, matching the spec's own wording exactly.
3. **Bridged plugins are stereo-only (2 in / 2 out).** The spec's Error Handling section says a channel-layout mismatch "reuses the existing reshape-to-full-input/write-only-main-output approach already validated for native plugin hosting" — but that reshaping (see `PluginChain::process`'s existing `slot.scratch.setSize(slot.processChannels, ...)`, where `processChannels` grows to fit whatever a plugin actually wants) depends on a per-plugin-configurable channel count, which the shared-memory ring buffer's fixed interleaved-*stereo* frame layout (`SharedRingBuffer`, Task 3) doesn't support without a real redesign of the wire format between the two processes. Given nearly every legacy x86_64 plugin someone would actually want to bridge is a stereo effect (EQ, compressor, reverb — not a surround processor), this plan ships bridge support as stereo-only for this pass, and does NOT extend `SharedRingBuffer`/`SharedAudioChannel` to arbitrary channel counts. A plugin that insists on more than 2 channels either way will very likely fail to instantiate correctly on the bridge (`BridgeSlot`'s fixed `juce::AudioBuffer<float> scratch(2, blockSize)` in Task 5) — that failure surfaces through the same load-error path as any other bridge failure, not a crash, but report this limitation explicitly if you hit it during Task 11's manual walkthrough.
4. **A runtime block-size change is not specially handled for bridged slots**, despite the spec's "tears down and recreates the affected shared-memory segment(s)" language. Checked during planning: the EXISTING in-process path doesn't handle this either — `PluginChain`'s native plugin loading calls `prepareToPlay` exactly once, at load time, and never re-calls it if the device's block size changes mid-session. A bridged slot's `SharedAudioChannel` capacity is similarly fixed at creation (`blockSize * kBlocksOfHeadroom` frames, from whatever `blockSize` was current when that slot was loaded). This is consistent with the app's existing behavior on this exact question, not a new gap introduced by bridging — not implementing spec-described teardown/recreate logic for this pass, since there was nothing to make behaviorally consistent WITH (the in-process path doesn't handle a live block-size change gracefully either). If this ever becomes a real problem in practice, it's a pre-existing limitation to fix for BOTH paths together, not a bridge-specific patch.

---

### Task 1: `native-engine-bridge` CMake project skeleton

**Files:**
- Create: `native-engine-bridge/CMakeLists.txt`
- Create: `native-engine-bridge/Source/Main.cpp`
- Create: `native-engine-bridge/.gitignore`

This task only proves the x86_64 cross-compile and Rosetta launch actually work — no real plugin-hosting logic yet. Treat this the same way the master-plugin-chain plan treated its console→GUI-app conversion: a genuine unspiked risk, validated early and in isolation before anything is built on top of it.

- [ ] **Step 1: Write `native-engine-bridge/.gitignore`**

```
build/
```

- [ ] **Step 2: Write `native-engine-bridge/CMakeLists.txt`**

```cmake
cmake_minimum_required(VERSION 3.22)
project(sssketch_bridge VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# The one thing that actually makes this the "bridge": compiled x86_64-only,
# so macOS launches it under Rosetta 2 automatically -- no `arch -x86_64`
# wrapper, no special spawn handling. See
# docs/superpowers/specs/2026-08-01-x86-plugin-bridge-design.md.
set(CMAKE_OSX_ARCHITECTURES "x86_64")

include(FetchContent)
FetchContent_Declare(
  JUCE
  GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
  GIT_TAG        8.0.4
  GIT_SHALLOW    TRUE
)
FetchContent_MakeAvailable(JUCE)

# LSUIElement keeps this out of the Dock/Cmd+Tab -- same reasoning as
# native-engine/CMakeLists.txt's own main engine target: a background helper
# the main engine spawns, never launched by the user directly.
juce_add_gui_app(sssketch_bridge
  PRODUCT_NAME "sssketch-bridge"
  BUNDLE_ID "com.ellinglien.sssketch-bridge"
  PLIST_TO_MERGE "<key>LSUIElement</key><true/>"
)

target_sources(sssketch_bridge PRIVATE
  Source/Main.cpp
)

target_compile_definitions(sssketch_bridge PRIVATE
  JUCE_USE_CURL=0
  JUCE_WEB_BROWSER=0
  JUCE_PLUGINHOST_VST3=1
  JUCE_PLUGINHOST_AU=1
  JUCE_MODAL_LOOPS_PERMITTED=1
)

target_link_libraries(sssketch_bridge PRIVATE
  juce::juce_core
  juce::juce_recommended_config_flags
  juce::juce_audio_processors
  juce::juce_audio_basics
  juce::juce_audio_utils
  juce::juce_gui_basics
)
```

- [ ] **Step 3: Write a minimal `native-engine-bridge/Source/Main.cpp`**

```cpp
// native-engine-bridge/Source/Main.cpp
#include <juce_core/juce_core.h>
#include <juce_events/juce_events.h>

int main(int, char*[])
{
    juce::ScopedJuceInitialiser_GUI juceInit;
    juce::Logger::writeToLog("sssketch-bridge: started (skeleton, no real logic yet)");
    return 0;
}
```

- [ ] **Step 4: Build it**

```bash
cd native-engine-bridge && cmake -B build -S . && cmake --build build
```

Expected: succeeds. Takes a while the first time (JUCE fetch + full compile), same as `native-engine`'s own first build.

- [ ] **Step 5: Confirm the binary is genuinely x86_64 and runs under Rosetta**

```bash
file native-engine-bridge/build/sssketch_bridge_artefacts/sssketch-bridge.app/Contents/MacOS/sssketch-bridge
```
Expected output includes `Mach-O 64-bit executable x86_64` (NOT arm64 or "universal").

```bash
native-engine-bridge/build/sssketch_bridge_artefacts/sssketch-bridge.app/Contents/MacOS/sssketch-bridge 2>&1
```
Expected: runs without error (macOS silently launches it under Rosetta the first time — may take a couple seconds longer than a native binary the very first run), logs `sssketch-bridge: started (skeleton, no real logic yet)`, exits 0.

**If this step fails or behaves unexpectedly** (Rosetta not installed, `CMAKE_OSX_ARCHITECTURES` not actually producing an x86_64 binary, JUCE's FetchContent trying to build JUCE itself for the wrong architecture): stop here and report back — every other task in this plan depends on this working. Don't work around it by, e.g., building a universal binary instead; a universal *host process* still only runs as one architecture at a time, which defeats the entire point (see the spec's own "why this is hard" framing).

- [ ] **Step 6: Commit**

```bash
git add native-engine-bridge/
git commit -m "Add native-engine-bridge: x86_64-only CMake project skeleton, Rosetta-launch smoke test"
```

---

### Task 2: Extract shared native code — `PluginEditorWindow.h`, `PluginArchitecture.h`/`.cpp`

**Files:**
- Create: `native-engine/Source/PluginEditorWindow.h`
- Create: `native-engine/Source/PluginArchitecture.h`
- Create: `native-engine/Source/PluginArchitecture.cpp`
- Modify: `native-engine/Source/PluginChain.h`
- Modify: `native-engine/Source/PluginChain.cpp`
- Modify: `native-engine/Source/Main.cpp`
- Modify: `native-engine/CMakeLists.txt`

Pure refactor, no behavior change on the main engine — every existing test should pass unchanged. This pulls two pieces of code the bridge will also need (Tasks 5 and 7) out of their current homes (a private nested class in `PluginChain.h`, a file-local static in `Main.cpp`) into their own headers, so both `native-engine` and `native-engine-bridge` can compile the exact same source rather than maintaining two copies.

- [ ] **Step 1: Write `PluginEditorWindow.h`**

```cpp
// native-engine/Source/PluginEditorWindow.h
#pragma once
#include <juce_gui_basics/juce_gui_basics.h>
#include <functional>

namespace sssketch
{
    /** A DocumentWindow hosting one plugin's AudioProcessorEditor -- shared
     * between the main engine (PluginChain's own master/channel plugin
     * slots) and the x86_64 bridge process (see native-engine-bridge/),
     * compiled into both targets from this one source file. Mirrors the
     * DocumentWindow-hosting-an-AudioProcessorEditor pattern used by JUCE's
     * own AudioPluginHost example, simplified to this app's actual needs. */
    class PluginEditorWindow : public juce::DocumentWindow
    {
    public:
        PluginEditorWindow(const juce::String& name, juce::AudioProcessorEditor* editor, std::function<void()> onClosed)
            : juce::DocumentWindow(name, juce::Colours::darkgrey, juce::DocumentWindow::closeButton),
              onClosedCallback(std::move(onClosed))
        {
            setUsingNativeTitleBar(true);
            setContentOwned(editor, true);
            setResizable(editor->isResizable(), false);
            centreWithSize(getWidth(), getHeight());
            // Three different cross-process "activate the app so its window
            // comes to the front" mechanisms were tried and all failed in
            // practice for the main engine's own windows (self-activation,
            // `open -a` from Electron, NSRunningApplication::activateWithOptions:
            // from Electron) -- see git history. Sidestepping the problem
            // entirely: pin the window itself above everything at the
            // window-server level, which macOS enforces directly based on
            // window level, independent of which app is active. Applies
            // just as well to the bridge's own windows, which face the
            // identical backgrounded-helper-process activation problem.
            setAlwaysOnTop(true);
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
}
```

- [ ] **Step 2: Write `PluginArchitecture.h`**

```cpp
// native-engine/Source/PluginArchitecture.h
#pragma once
#include <juce_core/juce_core.h>

namespace sssketch
{
    /** Shells out to the system `file` command against a plugin bundle's
     * inner Mach-O binary to determine its architecture -- "arm64",
     * "x86_64", "universal", or "unknown" (bundle missing/unreadable).
     * Used both by the plugin scanner (--scan-one-json, see Main.cpp) and
     * by PluginChain at load time to decide whether to load a plugin
     * in-process or delegate to the x86_64 bridge (see
     * docs/superpowers/specs/2026-08-01-x86-plugin-bridge-design.md). */
    juce::String detectPluginArchitecture(const juce::String& bundlePath);
}
```

- [ ] **Step 3: Write `PluginArchitecture.cpp`** — moved verbatim out of `Main.cpp`'s existing file-local `detectArchitecture` function, just renamed and namespaced

```cpp
// native-engine/Source/PluginArchitecture.cpp
#include "PluginArchitecture.h"

namespace sssketch
{
    juce::String detectPluginArchitecture(const juce::String& bundlePath)
    {
        juce::File bundle(bundlePath);
        auto macOSDir = bundle.getChildFile("Contents").getChildFile("MacOS");
        auto binaries = macOSDir.findChildFiles(juce::File::findFiles, false);
        if (binaries.isEmpty())
            return "unknown";

        juce::ChildProcess fileProc;
        if (!fileProc.start(juce::StringArray { "file", binaries[0].getFullPathName() }))
            return "unknown";
        const auto output = fileProc.readAllProcessOutput();
        fileProc.waitForProcessToFinish(5000);

        const bool hasArm64 = output.containsIgnoreCase("arm64");
        const bool hasX86 = output.containsIgnoreCase("x86_64");
        if (hasArm64 && hasX86) return "universal";
        if (hasArm64) return "arm64";
        if (hasX86) return "x86_64";
        return "unknown";
    }
}
```

- [ ] **Step 4: Update `Main.cpp`**

Delete the existing file-local `static juce::String detectArchitecture(const juce::String& bundlePath) { ... }` function entirely (the whole block currently at lines ~55-87). Add `#include "PluginArchitecture.h"` near the top with the other local includes. Replace the one call site (`const auto arch = detectArchitecture(path);` inside `runScanOneJson`) with `const auto arch = detectPluginArchitecture(path);`.

- [ ] **Step 5: Update `PluginChain.h`**

Remove `#include <juce_gui_basics/juce_gui_basics.h>`'s now-redundant nested class — delete the entire private nested `class EditorWindow : public juce::DocumentWindow { ... }` block. Add `#include "PluginEditorWindow.h"` near the top. Change the one member that referenced it:

```cpp
std::unique_ptr<PluginEditorWindow> editorWindow;
```

(was `std::unique_ptr<EditorWindow> editorWindow;`, inside the private `Slot` struct.)

- [ ] **Step 6: Update `PluginChain.cpp`**

The only reference is in `openEditorWindow`:

```cpp
        slot.editorWindow = std::make_unique<PluginEditorWindow>(
            slot.active->getName(), editor, [this, slotIndex]() { closeEditorWindow(slotIndex); });
```

(was `std::make_unique<EditorWindow>(...)`.)

- [ ] **Step 7: Update `native-engine/CMakeLists.txt`**

Add the new `.cpp` to `target_sources` (the two new `.h` files don't need listing, matching this file's existing convention of only listing `.cpp`s):

```cmake
target_sources(sssketch_engine PRIVATE
  Source/Main.cpp
  Source/PluginArchitecture.cpp
  Source/PluginChain.cpp
  ...
```

- [ ] **Step 8: Build and run the full native test suite**

```bash
cd native-engine && cmake --build build && ./build/sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine --test
```
Expected: every existing suite passes unchanged. This is a pure refactor — if anything fails, it's a mechanical mistake in the extraction, not a real behavior change to chase.

- [ ] **Step 9: Manual smoke test — confirm plugin scanning still works**

```bash
native-engine/build/sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine --scan-one-json "/Library/Audio/Plug-Ins/VST3/Solid Bus Comp.vst3"
```
Expected: same JSON output shape as before (`{"success": true, "plugins": [{"name": "Solid Bus Comp", ..., "arch": "universal", "isInstrument": false}]}`) — confirms `detectPluginArchitecture` produces identical results to the old inline `detectArchitecture`.

- [ ] **Step 10: Commit**

```bash
git add native-engine/Source/PluginEditorWindow.h native-engine/Source/PluginArchitecture.h native-engine/Source/PluginArchitecture.cpp native-engine/Source/PluginChain.h native-engine/Source/PluginChain.cpp native-engine/Source/Main.cpp native-engine/CMakeLists.txt
git commit -m "Extract PluginEditorWindow and detectPluginArchitecture into shared headers for the upcoming x86_64 bridge"
```

---

### Task 3: `SharedRingBuffer` — lock-free SPSC ring buffer

**Files:**
- Create: `native-engine/Source/SharedRingBuffer.h`
- Create: `native-engine/Source/SharedRingBuffer.cpp`
- Create: `native-engine/Source/SharedRingBufferTests.cpp`
- Modify: `native-engine/CMakeLists.txt`

The core data structure underlying the whole audio transport, tested in complete isolation from shared memory/semaphores/cross-process concerns — a plain heap array and local atomics are enough to fully exercise the algorithm, per the design spec's own Testing section.

- [ ] **Step 1: Write `SharedRingBuffer.h`**

```cpp
// native-engine/Source/SharedRingBuffer.h
#pragma once
#include <atomic>
#include <cstdint>

namespace sssketch
{
    /** Lock-free single-producer/single-consumer ring buffer over a raw
     * float array the caller owns (backed by shared memory in production
     * -- see SharedAudioChannel -- a plain heap array in tests). Stores
     * interleaved stereo frames (2 floats per frame). Safe for exactly one
     * writer thread and one reader thread concurrently; never safe for
     * more than one of either. */
    class SharedRingBuffer
    {
    public:
        /** `buffer` must point to at least `capacityFrames * 2` floats and
         * outlive this object. `writeIndex`/`readIndex` must each point to
         * a single already-zero-initialized std::atomic<uint32_t> (also
         * caller-owned, so both can live in the same shared-memory block as
         * `buffer` for the cross-process case). */
        SharedRingBuffer(float* buffer, std::atomic<uint32_t>* writeIndex,
            std::atomic<uint32_t>* readIndex, uint32_t capacityFrames);

        /** Producer only. Returns the number of frames actually written --
         * less than numFrames if the buffer doesn't have room. Never
         * blocks. */
        uint32_t write(const float* interleavedStereo, uint32_t numFrames);

        /** Consumer only. Returns the number of frames actually read --
         * less than numFrames if fewer are available. Never blocks. */
        uint32_t read(float* outInterleavedStereo, uint32_t numFrames);

        /** Either thread: how many frames are currently available to read. */
        uint32_t availableToRead() const;

    private:
        float* buffer;
        std::atomic<uint32_t>* writeIndex;
        std::atomic<uint32_t>* readIndex;
        uint32_t capacityFrames;
    };
}
```

- [ ] **Step 2: Write `SharedRingBufferTests.cpp`**

```cpp
// native-engine/Source/SharedRingBufferTests.cpp
#include "SharedRingBuffer.h"
#include <juce_core/juce_core.h>
#include <vector>

namespace sssketch
{
    namespace
    {
        class SharedRingBufferTests : public juce::UnitTest
        {
        public:
            SharedRingBufferTests() : juce::UnitTest("SharedRingBuffer", "SharedRingBuffer") {}

            void runTest() override
            {
                beginTest("write then read returns exactly what was written");
                {
                    std::vector<float> mem(16 * 2, 0.0f);
                    std::atomic<uint32_t> w { 0 }, r { 0 };
                    SharedRingBuffer ring(mem.data(), &w, &r, 16);

                    float in[6] = { 1, 2, 3, 4, 5, 6 }; // 3 frames
                    expectEquals((int) ring.write(in, 3), 3);

                    float out[6] = {};
                    expectEquals((int) ring.read(out, 3), 3);
                    for (int i = 0; i < 6; ++i)
                        expectWithinAbsoluteError(out[i], in[i], 0.0001f);
                }

                beginTest("write beyond capacity truncates, does not overflow or crash");
                {
                    std::vector<float> mem(4 * 2, 0.0f); // capacity 4 frames
                    std::atomic<uint32_t> w { 0 }, r { 0 };
                    SharedRingBuffer ring(mem.data(), &w, &r, 4);

                    std::vector<float> in(10 * 2, 1.0f); // 10 frames, way over capacity
                    const uint32_t written = ring.write(in.data(), 10);
                    expect(written <= 4);
                }

                beginTest("read beyond what's available truncates, returns actual count");
                {
                    std::vector<float> mem(16 * 2, 0.0f);
                    std::atomic<uint32_t> w { 0 }, r { 0 };
                    SharedRingBuffer ring(mem.data(), &w, &r, 16);

                    float in[4] = { 1, 2, 3, 4 }; // 2 frames
                    ring.write(in, 2);

                    float out[20] = {};
                    expectEquals((int) ring.read(out, 10), 2);
                }

                beginTest("availableToRead reflects unread frames correctly");
                {
                    std::vector<float> mem(16 * 2, 0.0f);
                    std::atomic<uint32_t> w { 0 }, r { 0 };
                    SharedRingBuffer ring(mem.data(), &w, &r, 16);

                    expectEquals((int) ring.availableToRead(), 0);
                    float in[10] = { 0,0,0,0,0,0,0,0,0,0 }; // 5 frames
                    ring.write(in, 5);
                    expectEquals((int) ring.availableToRead(), 5);
                    float out[10] = {};
                    ring.read(out, 2);
                    expectEquals((int) ring.availableToRead(), 3);
                }

                beginTest("data integrity survives wrapping past the capacity boundary many times");
                {
                    std::vector<float> mem(4 * 2, 0.0f); // small capacity to force wraparound quickly
                    std::atomic<uint32_t> w { 0 }, r { 0 };
                    SharedRingBuffer ring(mem.data(), &w, &r, 4);

                    for (int round = 0; round < 100; ++round)
                    {
                        const float l = (float) round;
                        const float rr = (float) round + 0.5f;
                        float in[2] = { l, rr };
                        expectEquals((int) ring.write(in, 1), 1);
                        float out[2] = {};
                        expectEquals((int) ring.read(out, 1), 1);
                        expectWithinAbsoluteError(out[0], l, 0.0001f);
                        expectWithinAbsoluteError(out[1], rr, 0.0001f);
                    }
                }
            }
        };

        static SharedRingBufferTests sharedRingBufferTests;
    }
}
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd native-engine && cmake --build build
```
Expected: build fails (`SharedRingBuffer.h`/`.cpp` don't exist yet). Add `Source/SharedRingBuffer.cpp` and `Source/SharedRingBufferTests.cpp` to `target_sources` in `native-engine/CMakeLists.txt` first, then re-run — now it fails because `SharedRingBuffer.cpp` doesn't exist. Proceed to Step 4.

- [ ] **Step 4: Write `SharedRingBuffer.cpp`**

```cpp
// native-engine/Source/SharedRingBuffer.cpp
#include "SharedRingBuffer.h"
#include <algorithm>

namespace sssketch
{
    SharedRingBuffer::SharedRingBuffer(float* buf, std::atomic<uint32_t>* w, std::atomic<uint32_t>* r, uint32_t cap)
        : buffer(buf), writeIndex(w), readIndex(r), capacityFrames(cap)
    {
    }

    uint32_t SharedRingBuffer::availableToRead() const
    {
        const uint32_t w = writeIndex->load(std::memory_order_acquire);
        const uint32_t r = readIndex->load(std::memory_order_relaxed);
        // Unsigned subtraction wraps correctly even once w/r themselves
        // wrap past UINT32_MAX, as long as the producer never gets more
        // than ~4 billion frames ahead of the consumer -- true for any
        // real session, this is not a windowing/versioning scheme, just
        // plain modular arithmetic.
        return w - r;
    }

    uint32_t SharedRingBuffer::write(const float* src, uint32_t numFrames)
    {
        const uint32_t r = readIndex->load(std::memory_order_acquire);
        const uint32_t w = writeIndex->load(std::memory_order_relaxed);
        const uint32_t free = capacityFrames - (w - r);
        const uint32_t toWrite = std::min(numFrames, free);

        for (uint32_t i = 0; i < toWrite; ++i)
        {
            const uint32_t slot = (w + i) % capacityFrames;
            buffer[(size_t) slot * 2] = src[(size_t) i * 2];
            buffer[(size_t) slot * 2 + 1] = src[(size_t) i * 2 + 1];
        }

        writeIndex->store(w + toWrite, std::memory_order_release);
        return toWrite;
    }

    uint32_t SharedRingBuffer::read(float* dst, uint32_t numFrames)
    {
        const uint32_t w = writeIndex->load(std::memory_order_acquire);
        const uint32_t r = readIndex->load(std::memory_order_relaxed);
        const uint32_t available = w - r;
        const uint32_t toRead = std::min(numFrames, available);

        for (uint32_t i = 0; i < toRead; ++i)
        {
            const uint32_t slot = (r + i) % capacityFrames;
            dst[(size_t) i * 2] = buffer[(size_t) slot * 2];
            dst[(size_t) i * 2 + 1] = buffer[(size_t) slot * 2 + 1];
        }

        readIndex->store(r + toRead, std::memory_order_release);
        return toRead;
    }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd native-engine && cmake --build build && ./build/sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine --test
```
Expected: all 5 new `SharedRingBuffer` tests pass, plus every existing suite unchanged.

- [ ] **Step 6: Commit**

```bash
git add native-engine/Source/SharedRingBuffer.h native-engine/Source/SharedRingBuffer.cpp native-engine/Source/SharedRingBufferTests.cpp native-engine/CMakeLists.txt
git commit -m "Add SharedRingBuffer: lock-free SPSC ring buffer for cross-process audio"
```

---

### Task 4: `SharedAudioChannel` — shared memory + named semaphores (HIGH RISK)

**Files:**
- Create: `native-engine/Source/SharedAudioChannel.h`
- Create: `native-engine/Source/SharedAudioChannel.cpp`
- Create: `native-engine/Source/SharedAudioChannelTests.cpp`
- Modify: `native-engine/CMakeLists.txt`

**This is the riskiest task in the whole plan.** It's the first real cross-process primitive this codebase has ever needed — raw POSIX `shm_open`/`mmap`/`sem_open` calls, with real failure modes (name collisions, resource limits, leftover segments from a crashed prior session) that don't show up in a quick read of the code, only under actual testing. The tests below construct BOTH ends (owner and attacher) in the *same* test process — that's a legitimate, sufficient test of the real `shm_open`/`mmap`/`sem_open`/`sem_timedwait` mechanism (the OS primitives don't care whether the two ends happen to be the same process or different ones), but it does NOT prove the bridge process itself can attach successfully — that's Task 5's manual verification.

- [ ] **Step 1: Write `SharedAudioChannel.h`**

```cpp
// native-engine/Source/SharedAudioChannel.h
#pragma once
#include "SharedRingBuffer.h"
#include <juce_core/juce_core.h>
#include <semaphore.h>
#include <memory>

namespace sssketch
{
    /** One shared-memory audio connection between the main engine and the
     * x86_64 bridge process for a single bridged plugin slot -- two ring
     * buffers (engine-to-bridge input, bridge-to-engine output) plus a
     * pair of named POSIX semaphores for signaling. The engine process
     * CREATEs one of these per bridged slot (allocating and owning the
     * shared memory); the bridge process ATTACHes to the same name once
     * told about it over the control socket. See
     * docs/superpowers/specs/2026-08-01-x86-plugin-bridge-design.md's
     * "Audio transport" section. */
    class SharedAudioChannel
    {
    public:
        // Blocks' worth of headroom the ring buffers are sized for -- a
        // starting value from the design spec, not derived from
        // profiling. Tune up (here, and correspondingly in
        // PluginChain::process's read/write calls if that ever needs to
        // request more than one block at a time) if manual testing under
        // real load shows underruns.
        static constexpr int kBlocksOfHeadroom = 8;

        /** A process-and-counter-unique name safe to use in a POSIX
         * shared-memory/semaphore identifier. Combines the current process
         * id with a monotonically increasing in-process counter, so two
         * channels created in the same engine session never collide, and a
         * leftover segment from a previous crashed session's PID can never
         * collide with a currently-running one either. */
        static juce::String makeUniqueName();

        /** Owner side (main engine): allocates and zero-initializes new
         * shared memory and semaphores under `name`. Returns nullptr if
         * shm_open/mmap/sem_open fails for any reason -- treat as a load
         * failure for that slot, never a crash (see design spec's Error
         * Handling section, "bridge fails to spawn"). */
        static std::unique_ptr<SharedAudioChannel> create(const juce::String& name, int blockSize);

        /** Non-owner side (bridge): opens EXISTING shared memory and
         * semaphores under `name`, created by a prior create() call in the
         * other process. Returns nullptr if `name` doesn't exist yet or
         * any underlying open call fails. */
        static std::unique_ptr<SharedAudioChannel> attach(const juce::String& name, int blockSize);

        /** Unmaps this process's view and, for the owner, unlinks the
         * shared memory and semaphores from the filesystem namespace.
         * Other processes with an existing attach()'d mapping keep a valid
         * mapping until they unmap it themselves -- standard POSIX shm
         * unlink-while-mapped semantics. */
        ~SharedAudioChannel();

        SharedAudioChannel(const SharedAudioChannel&) = delete;
        SharedAudioChannel& operator=(const SharedAudioChannel&) = delete;

        /** Engine side: write this block's input, then wake the bridge. */
        void writeInputAndSignal(const float* interleavedStereo, uint32_t numFrames);

        /** Engine side: wait up to timeoutMs for the bridge to signal new
         * output is ready, then read up to numFrames of it. Returns frames
         * actually read -- 0 on timeout OR if the bridge produced less
         * than requested; both are legitimate silence-substitution
         * outcomes the caller (PluginChain::process) must treat
         * identically, not distinguished here. */
        uint32_t waitAndReadOutput(float* outInterleavedStereo, uint32_t numFrames, int timeoutMs);

        /** Bridge side: wait up to timeoutMs for the engine to signal new
         * input is ready, then read up to numFrames of it. Returns frames
         * actually read (0 on timeout). */
        uint32_t waitAndReadInput(float* outInterleavedStereo, uint32_t numFrames, int timeoutMs);

        /** Bridge side: write this block's processed output, then wake the
         * engine. */
        void writeOutputAndSignal(const float* interleavedStereo, uint32_t numFrames);

    private:
        SharedAudioChannel() = default;

        juce::String name;
        int shmFd = -1;
        void* mappedMemory = nullptr;
        size_t mappedSize = 0;
        bool isOwner = false;

        sem_t* inputReadySem = nullptr;
        sem_t* outputReadySem = nullptr;

        std::unique_ptr<SharedRingBuffer> inputRing;
        std::unique_ptr<SharedRingBuffer> outputRing;

        friend std::unique_ptr<SharedAudioChannel> openChannel(const juce::String&, int, bool);
    };
}
```

- [ ] **Step 2: Write `SharedAudioChannelTests.cpp`**

```cpp
// native-engine/Source/SharedAudioChannelTests.cpp
#include "SharedAudioChannel.h"
#include <juce_core/juce_core.h>

namespace sssketch
{
    namespace
    {
        class SharedAudioChannelTests : public juce::UnitTest
        {
        public:
            SharedAudioChannelTests() : juce::UnitTest("SharedAudioChannel", "SharedAudioChannel") {}

            void runTest() override
            {
                beginTest("create then attach both succeed for the same name");
                {
                    const auto name = SharedAudioChannel::makeUniqueName();
                    auto owner = SharedAudioChannel::create(name, 4);
                    expect(owner != nullptr);
                    auto attacher = SharedAudioChannel::attach(name, 4);
                    expect(attacher != nullptr);
                }

                beginTest("attach fails for a name nothing created");
                {
                    const auto name = SharedAudioChannel::makeUniqueName();
                    auto attacher = SharedAudioChannel::attach(name, 4);
                    expect(attacher == nullptr);
                }

                beginTest("input written by the owner is read back correctly on the attacher side");
                {
                    const auto name = SharedAudioChannel::makeUniqueName();
                    auto owner = SharedAudioChannel::create(name, 4);
                    auto attacher = SharedAudioChannel::attach(name, 4);
                    expect(owner != nullptr && attacher != nullptr);

                    float in[8] = { 1, 2, 3, 4, 5, 6, 7, 8 }; // 4 frames, interleaved stereo
                    owner->writeInputAndSignal(in, 4);

                    float out[8] = {};
                    const uint32_t got = attacher->waitAndReadInput(out, 4, 1000);
                    expectEquals((int) got, 4);
                    for (int i = 0; i < 8; ++i)
                        expectWithinAbsoluteError(out[i], in[i], 0.0001f);
                }

                beginTest("output written by the attacher is read back correctly on the owner side");
                {
                    const auto name = SharedAudioChannel::makeUniqueName();
                    auto owner = SharedAudioChannel::create(name, 4);
                    auto attacher = SharedAudioChannel::attach(name, 4);
                    expect(owner != nullptr && attacher != nullptr);

                    float in[8] = { 9, 8, 7, 6, 5, 4, 3, 2 };
                    attacher->writeOutputAndSignal(in, 4);

                    float out[8] = {};
                    const uint32_t got = owner->waitAndReadOutput(out, 4, 1000);
                    expectEquals((int) got, 4);
                    for (int i = 0; i < 8; ++i)
                        expectWithinAbsoluteError(out[i], in[i], 0.0001f);
                }

                beginTest("waitAndReadOutput actually waits and times out, returning 0, when nothing is signaled");
                {
                    const auto name = SharedAudioChannel::makeUniqueName();
                    auto owner = SharedAudioChannel::create(name, 4);
                    expect(owner != nullptr);

                    float out[8] = {};
                    const auto start = juce::Time::getMillisecondCounter();
                    const uint32_t got = owner->waitAndReadOutput(out, 4, 50);
                    const auto elapsed = juce::Time::getMillisecondCounter() - start;
                    expectEquals((int) got, 0);
                    expect(elapsed >= 45); // actually waited close to the requested timeout, didn't return instantly
                }

                beginTest("two channels created with different names never collide");
                {
                    const auto nameA = SharedAudioChannel::makeUniqueName();
                    const auto nameB = SharedAudioChannel::makeUniqueName();
                    expect(nameA != nameB);
                    auto a = SharedAudioChannel::create(nameA, 4);
                    auto b = SharedAudioChannel::create(nameB, 4);
                    expect(a != nullptr && b != nullptr);

                    float inA[8] = { 1,1,1,1,1,1,1,1 };
                    float inB[8] = { 2,2,2,2,2,2,2,2 };
                    a->writeInputAndSignal(inA, 4);
                    b->writeInputAndSignal(inB, 4);

                    auto attacherA = SharedAudioChannel::attach(nameA, 4);
                    float outA[8] = {};
                    expectEquals((int) attacherA->waitAndReadInput(outA, 4, 1000), 4);
                    expectWithinAbsoluteError(outA[0], 1.0f, 0.0001f);
                }
            }
        };

        static SharedAudioChannelTests sharedAudioChannelTests;
    }
}
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd native-engine && cmake --build build
```
Expected: build fails (`SharedAudioChannel.h`/`.cpp` don't exist yet). Add both new source files to `target_sources` in `native-engine/CMakeLists.txt`, re-run, now it fails because `SharedAudioChannel.cpp` doesn't exist. Proceed to Step 4.

- [ ] **Step 4: Write `SharedAudioChannel.cpp`**

```cpp
// native-engine/Source/SharedAudioChannel.cpp
#include "SharedAudioChannel.h"
#include <sys/mman.h>
#include <fcntl.h>
#include <unistd.h>
#include <ctime>

namespace sssketch
{
    namespace
    {
        // At the start of the mapped region: the four atomic ring-buffer
        // indices (two rings, one write index and one read index each).
        // Immediately following, in order: the input ring's float data
        // (capacityFrames * 2 floats), then the output ring's float data
        // (capacityFrames * 2 floats).
        struct SharedLayout
        {
            std::atomic<uint32_t> inputWriteIndex;
            std::atomic<uint32_t> inputReadIndex;
            std::atomic<uint32_t> outputWriteIndex;
            std::atomic<uint32_t> outputReadIndex;
        };

        size_t totalMappedSize(uint32_t capacityFrames)
        {
            return sizeof(SharedLayout) + 2 * (size_t) capacityFrames * 2 * sizeof(float);
        }

        juce::String shmPathFor(const juce::String& name) { return "/" + name + "-shm"; }
        juce::String inputSemNameFor(const juce::String& name) { return "/" + name + "-in"; }
        juce::String outputSemNameFor(const juce::String& name) { return "/" + name + "-out"; }
    }

    juce::String SharedAudioChannel::makeUniqueName()
    {
        static std::atomic<int> counter { 0 };
        return "sssketch-bridge-" + juce::String((int) getpid()) + "-" + juce::String(counter.fetch_add(1));
    }

    std::unique_ptr<SharedAudioChannel> openChannel(const juce::String& name, int blockSize, bool owner)
    {
        const uint32_t capacityFrames = (uint32_t) blockSize * (uint32_t) SharedAudioChannel::kBlocksOfHeadroom;
        const size_t mapSize = totalMappedSize(capacityFrames);
        const auto shmPath = shmPathFor(name);

        // O_EXCL on create is a real safety net, not just belt-and-braces:
        // it makes this call FAIL loudly if `name` somehow already exists,
        // rather than silently reusing (and corrupting the state of) an
        // unrelated segment -- see makeUniqueName()'s own doc comment on
        // why a collision should never happen in practice, but "never in
        // practice" isn't the same as "impossible."
        const int fd = owner
            ? shm_open(shmPath.toRawUTF8(), O_CREAT | O_EXCL | O_RDWR, 0600)
            : shm_open(shmPath.toRawUTF8(), O_RDWR, 0600);
        if (fd < 0)
            return nullptr;

        if (owner && ftruncate(fd, (off_t) mapSize) != 0)
        {
            close(fd);
            shm_unlink(shmPath.toRawUTF8());
            return nullptr;
        }

        void* mem = mmap(nullptr, mapSize, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
        if (mem == MAP_FAILED)
        {
            close(fd);
            if (owner) shm_unlink(shmPath.toRawUTF8());
            return nullptr;
        }

        const auto inSemName = inputSemNameFor(name);
        const auto outSemName = outputSemNameFor(name);
        sem_t* inSem = owner
            ? sem_open(inSemName.toRawUTF8(), O_CREAT | O_EXCL, 0600, 0)
            : sem_open(inSemName.toRawUTF8(), 0);
        sem_t* outSem = owner
            ? sem_open(outSemName.toRawUTF8(), O_CREAT | O_EXCL, 0600, 0)
            : sem_open(outSemName.toRawUTF8(), 0);
        if (inSem == SEM_FAILED || outSem == SEM_FAILED)
        {
            munmap(mem, mapSize);
            close(fd);
            if (owner)
            {
                shm_unlink(shmPath.toRawUTF8());
                if (inSem != SEM_FAILED) { sem_close(inSem); sem_unlink(inSemName.toRawUTF8()); }
                if (outSem != SEM_FAILED) { sem_close(outSem); sem_unlink(outSemName.toRawUTF8()); }
            }
            return nullptr;
        }

        auto* layout = static_cast<SharedLayout*>(mem);
        if (owner)
        {
            layout->inputWriteIndex.store(0);
            layout->inputReadIndex.store(0);
            layout->outputWriteIndex.store(0);
            layout->outputReadIndex.store(0);
        }

        auto* inputFloats = reinterpret_cast<float*>(reinterpret_cast<char*>(mem) + sizeof(SharedLayout));
        auto* outputFloats = inputFloats + (size_t) capacityFrames * 2;

        std::unique_ptr<SharedAudioChannel> channel(new SharedAudioChannel());
        channel->name = name;
        channel->shmFd = fd;
        channel->mappedMemory = mem;
        channel->mappedSize = mapSize;
        channel->isOwner = owner;
        channel->inputReadySem = inSem;
        channel->outputReadySem = outSem;
        channel->inputRing = std::make_unique<SharedRingBuffer>(
            inputFloats, &layout->inputWriteIndex, &layout->inputReadIndex, capacityFrames);
        channel->outputRing = std::make_unique<SharedRingBuffer>(
            outputFloats, &layout->outputWriteIndex, &layout->outputReadIndex, capacityFrames);
        return channel;
    }

    std::unique_ptr<SharedAudioChannel> SharedAudioChannel::create(const juce::String& name, int blockSize)
    {
        return openChannel(name, blockSize, true);
    }

    std::unique_ptr<SharedAudioChannel> SharedAudioChannel::attach(const juce::String& name, int blockSize)
    {
        return openChannel(name, blockSize, false);
    }

    SharedAudioChannel::~SharedAudioChannel()
    {
        if (mappedMemory != nullptr) munmap(mappedMemory, mappedSize);
        if (shmFd >= 0) close(shmFd);
        if (inputReadySem != nullptr) sem_close(inputReadySem);
        if (outputReadySem != nullptr) sem_close(outputReadySem);
        if (isOwner)
        {
            shm_unlink(shmPathFor(name).toRawUTF8());
            sem_unlink(inputSemNameFor(name).toRawUTF8());
            sem_unlink(outputSemNameFor(name).toRawUTF8());
        }
    }

    void SharedAudioChannel::writeInputAndSignal(const float* src, uint32_t numFrames)
    {
        inputRing->write(src, numFrames);
        sem_post(inputReadySem);
    }

    namespace
    {
        uint32_t waitAndRead(sem_t* sem, SharedRingBuffer& ring, float* dst, uint32_t numFrames, int timeoutMs)
        {
            struct timespec ts;
            clock_gettime(CLOCK_REALTIME, &ts);
            ts.tv_sec += timeoutMs / 1000;
            ts.tv_nsec += (long) (timeoutMs % 1000) * 1000000L;
            if (ts.tv_nsec >= 1000000000L) { ts.tv_sec += 1; ts.tv_nsec -= 1000000000L; }

            if (sem_timedwait(sem, &ts) != 0)
                return 0; // timed out or error -- caller substitutes silence, see design spec's Error Handling
            return ring.read(dst, numFrames);
        }
    }

    uint32_t SharedAudioChannel::waitAndReadOutput(float* dst, uint32_t numFrames, int timeoutMs)
    {
        return waitAndRead(outputReadySem, *outputRing, dst, numFrames, timeoutMs);
    }

    uint32_t SharedAudioChannel::waitAndReadInput(float* dst, uint32_t numFrames, int timeoutMs)
    {
        return waitAndRead(inputReadySem, *inputRing, dst, numFrames, timeoutMs);
    }

    void SharedAudioChannel::writeOutputAndSignal(const float* src, uint32_t numFrames)
    {
        outputRing->write(src, numFrames);
        sem_post(outputReadySem);
    }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd native-engine && cmake --build build && ./build/sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine --test
```
Expected: all 6 new `SharedAudioChannel` tests pass, plus every existing suite unchanged. If `sem_timedwait`/`shm_open` fail to link, confirm `<semaphore.h>`/`<sys/mman.h>` are being found — these are standard POSIX headers, no new library dependency needed on macOS.

**If Step 5's "actually waits and times out" test is flaky** (timing-sensitive by nature): widen the tolerance (`elapsed >= 45` for a 50ms timeout) rather than removing the test — the actual property under test (a timeout genuinely blocks for close to the requested duration, not "returns instantly with a false 0") is important enough to keep even if it needs a looser bound.

- [ ] **Step 6: Commit**

```bash
git add native-engine/Source/SharedAudioChannel.h native-engine/Source/SharedAudioChannel.cpp native-engine/Source/SharedAudioChannelTests.cpp native-engine/CMakeLists.txt
git commit -m "Add SharedAudioChannel: shared-memory + named-semaphore audio transport for the x86_64 bridge"
```

---

### Task 5: Bridge process real logic — plugin hosting, control socket, editor windows (HIGH RISK)

**Files:**
- Create: `native-engine-bridge/Source/BridgeIpcServer.h`
- Create: `native-engine-bridge/Source/BridgeIpcServer.cpp`
- Modify: `native-engine-bridge/Source/Main.cpp`
- Modify: `native-engine-bridge/CMakeLists.txt`

No automated tests for this task — it's the bridge's own real plugin-loading and audio-pumping logic, which fundamentally needs a real installed plugin and a real running counterpart process to mean anything, matching this codebase's own established convention for `--scan-one`/`--serve`/`--render-test` style integration code (see `Main.cpp`'s other CLI modes, none of which have unit tests either). Verified manually in Task 7's end-to-end walkthrough once the main engine can actually talk to this.

- [ ] **Step 1: Update `native-engine-bridge/CMakeLists.txt`**

Add the shared source files (from `native-engine/`, referenced by relative path — genuinely the same source compiled twice, once per architecture, not a shared library) and an include directory so `#include "PluginEditorWindow.h"` etc. resolve directly:

```cmake
target_sources(sssketch_bridge PRIVATE
  Source/Main.cpp
  Source/BridgeIpcServer.cpp
  ../native-engine/Source/SharedRingBuffer.cpp
  ../native-engine/Source/SharedAudioChannel.cpp
)

target_include_directories(sssketch_bridge PRIVATE ../native-engine/Source)
```

(This replaces the `target_sources` block Task 1 wrote, which only listed `Source/Main.cpp`.)

- [ ] **Step 2: Write `BridgeIpcServer.h`**

```cpp
// native-engine-bridge/Source/BridgeIpcServer.h
#pragma once
#include "PluginEditorWindow.h"
#include "SharedAudioChannel.h"
#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_events/juce_events.h>
#include <unordered_map>
#include <memory>

namespace sssketch
{
    /** One loaded plugin instance on the bridge side: the plugin itself,
     * its SharedAudioChannel (attached, not owned -- the main engine
     * created it), its editor window (if opened), and the background
     * thread that pumps audio through it for as long as this object
     * lives. */
    class BridgeSlot : private juce::Thread
    {
    public:
        BridgeSlot(std::unique_ptr<juce::AudioProcessor> plugin,
            std::unique_ptr<SharedAudioChannel> channel, int blockSize);
        ~BridgeSlot() override;

        bool openEditor();
        void closeEditor();

    private:
        void run() override;

        std::unique_ptr<juce::AudioProcessor> plugin;
        std::unique_ptr<SharedAudioChannel> channel;
        int blockSize;
        std::unique_ptr<PluginEditorWindow> editorWindow;
    };

    /** One control-socket connection from the main engine -- in practice
     * there's only ever one (the main engine is the only client this
     * server ever expects), but nothing here assumes that beyond
     * simplicity. Handles load/unload/open-editor/close-editor/shutdown
     * messages -- see docs/superpowers/specs/2026-08-01-x86-plugin-bridge-design.md's
     * "Control-plane messages" note. Every loaded plugin is identified by
     * an opaque `slotId` string the main engine assigns and reuses; the
     * bridge itself has no concept of master/channel/slot-index. */
    class BridgeIpcConnection : public juce::InterprocessConnection
    {
    public:
        BridgeIpcConnection();
        ~BridgeIpcConnection() override;

        void connectionMade() override;
        void connectionLost() override;
        void messageReceived(const juce::MemoryBlock& message) override;

    private:
        void sendJson(const juce::var& payload);

        std::unordered_map<juce::String, std::unique_ptr<BridgeSlot>> slots;
    };

    class BridgeIpcServer : public juce::InterprocessConnectionServer
    {
    public:
        juce::InterprocessConnection* createConnectionObject() override;
    };
}
```

- [ ] **Step 3: Write `BridgeIpcServer.cpp`**

```cpp
// native-engine-bridge/Source/BridgeIpcServer.cpp
#include "BridgeIpcServer.h"

namespace sssketch
{
    BridgeSlot::BridgeSlot(std::unique_ptr<juce::AudioProcessor> p,
        std::unique_ptr<SharedAudioChannel> c, int bs)
        : juce::Thread("BridgeSlot"), plugin(std::move(p)), channel(std::move(c)), blockSize(bs)
    {
        startThread();
    }

    BridgeSlot::~BridgeSlot()
    {
        stopThread(2000);
    }

    void BridgeSlot::run()
    {
        // Fixed stereo (2-channel) buffer -- see this plan's header, scope
        // decision 3, for why the bridge doesn't reshape to a plugin's own
        // wider channel count the way the in-process path does.
        std::vector<float> inFrames((size_t) blockSize * 2);
        juce::AudioBuffer<float> scratch(2, blockSize);
        juce::MidiBuffer midi;

        while (!threadShouldExit())
        {
            // A short wait slice (not the caller's 5ms real-time budget --
            // this loop runs continuously, independent of the engine's own
            // per-block timing, so it can afford to wait longer per
            // attempt and just loop back around if nothing showed up yet).
            const uint32_t got = channel->waitAndReadInput(inFrames.data(), (uint32_t) blockSize, 50);
            if (threadShouldExit())
                break;
            if (got == 0)
                continue;

            scratch.clear();
            for (uint32_t i = 0; i < got; ++i)
            {
                scratch.setSample(0, (int) i, inFrames[(size_t) i * 2]);
                scratch.setSample(1, (int) i, inFrames[(size_t) i * 2 + 1]);
            }

            plugin->processBlock(scratch, midi);
            midi.clear();

            std::vector<float> outFrames((size_t) got * 2);
            for (uint32_t i = 0; i < got; ++i)
            {
                outFrames[(size_t) i * 2] = scratch.getSample(0, (int) i);
                outFrames[(size_t) i * 2 + 1] = scratch.getSample(1, (int) i);
            }
            channel->writeOutputAndSignal(outFrames.data(), got);
        }
    }

    bool BridgeSlot::openEditor()
    {
        if (editorWindow != nullptr)
        {
            editorWindow->toFront(true);
            return true;
        }
        if (!plugin->hasEditor())
            return true;
        auto* editor = plugin->createEditorIfNeeded();
        if (editor == nullptr)
            return true;
        editorWindow = std::make_unique<PluginEditorWindow>(plugin->getName(), editor, [this]() { closeEditor(); });
        return true;
    }

    void BridgeSlot::closeEditor()
    {
        editorWindow.reset();
    }

    BridgeIpcConnection::BridgeIpcConnection() = default;

    BridgeIpcConnection::~BridgeIpcConnection()
    {
        disconnect(); // required before InterprocessConnection's own destructor runs -- same as IpcConnection.cpp's own dtor
    }

    void BridgeIpcConnection::connectionMade()
    {
        juce::Logger::writeToLog("BridgeIpcConnection: engine connected");
    }

    void BridgeIpcConnection::connectionLost()
    {
        juce::Logger::writeToLog("BridgeIpcConnection: engine disconnected");
        slots.clear(); // tears down every BridgeSlot -- stops each one's audio thread and closes any open editor windows
    }

    void BridgeIpcConnection::sendJson(const juce::var& payload)
    {
        const auto text = juce::JSON::toString(payload, true);
        juce::MemoryBlock block(text.toRawUTF8(), text.getNumBytesAsUTF8());
        sendMessage(block);
    }

    void BridgeIpcConnection::messageReceived(const juce::MemoryBlock& message)
    {
        auto text = juce::String::fromUTF8((const char*) message.getData(), (int) message.getSize());
        auto parsed = juce::JSON::parse(text);
        if (!parsed.isObject())
            return;
        auto type = parsed.getProperty("type", "").toString();
        auto payload = parsed.getProperty("payload", juce::var());
        if (!payload.isObject())
            return;

        if (type == "load-bridge-plugin")
        {
            const auto slotId = payload.getProperty("slotId", "").toString();
            const auto path = payload.getProperty("path", "").toString();
            const auto channelName = payload.getProperty("channelName", "").toString();
            const double sampleRate = (double) payload.getProperty("sampleRate", 44100.0);
            const int blockSize = (int) payload.getProperty("blockSize", 512);

            juce::AudioPluginFormatManager formatManager;
            formatManager.addDefaultFormats();
            juce::Array<juce::PluginDescription> found;
            for (auto* format : formatManager.getFormats())
            {
                if (!format->fileMightContainThisPluginType(path))
                    continue;
                juce::KnownPluginList knownPlugins;
                juce::OwnedArray<juce::PluginDescription> typesFound;
                knownPlugins.scanAndAddFile(path, false, typesFound, *format);
                for (auto* desc : typesFound)
                    found.add(*desc);
            }

            juce::String error;
            std::unique_ptr<juce::AudioProcessor> instance;
            if (found.isEmpty())
            {
                error = "plugin not found at expected path: " + path;
            }
            else
            {
                instance = formatManager.createPluginInstance(found.getReference(0), sampleRate, blockSize, error);
                if (instance != nullptr)
                    instance->prepareToPlay(sampleRate, blockSize);
            }

            bool success = instance != nullptr;
            if (success)
            {
                auto channel = SharedAudioChannel::attach(channelName, blockSize);
                if (channel == nullptr)
                {
                    success = false;
                    error = "failed to attach to shared audio channel: " + channelName;
                }
                else
                {
                    slots[slotId] = std::make_unique<BridgeSlot>(std::move(instance), std::move(channel), blockSize);
                }
            }

            juce::DynamicObject::Ptr payloadObj = new juce::DynamicObject();
            payloadObj->setProperty("slotId", slotId);
            payloadObj->setProperty("success", success);
            if (!success)
                payloadObj->setProperty("error", error);
            juce::DynamicObject::Ptr obj = new juce::DynamicObject();
            obj->setProperty("type", "bridge-plugin-loaded");
            obj->setProperty("payload", juce::var(payloadObj.get()));
            sendJson(juce::var(obj.get()));
        }
        else if (type == "open-bridge-plugin-editor")
        {
            const auto slotId = payload.getProperty("slotId", "").toString();
            auto it = slots.find(slotId);
            if (it != slots.end())
                it->second->openEditor();
        }
        else if (type == "close-bridge-plugin-editor")
        {
            const auto slotId = payload.getProperty("slotId", "").toString();
            auto it = slots.find(slotId);
            if (it != slots.end())
                it->second->closeEditor();
        }
        else if (type == "unload-bridge-plugin")
        {
            const auto slotId = payload.getProperty("slotId", "").toString();
            slots.erase(slotId);
        }
        else if (type == "shutdown")
        {
            juce::JUCEApplicationBase::quit();
        }
    }

    juce::InterprocessConnection* BridgeIpcServer::createConnectionObject()
    {
        return new BridgeIpcConnection();
    }
}
```

- [ ] **Step 4: Replace `native-engine-bridge/Source/Main.cpp`'s skeleton with the real `--serve-bridge` mode**

```cpp
// native-engine-bridge/Source/Main.cpp
#include "BridgeIpcServer.h"
#include <juce_core/juce_core.h>
#include <juce_events/juce_events.h>

static int runServeBridge(int port)
{
    juce::ScopedJuceInitialiser_GUI juceInit;
    sssketch::BridgeIpcServer server;
    if (!server.beginWaitingForSocket(port, "127.0.0.1"))
    {
        juce::Logger::writeToLog("runServeBridge: failed to bind to port " + juce::String(port));
        return 1;
    }
    juce::Logger::writeToLog("sssketch-bridge: serving on 127.0.0.1:" + juce::String(port));

    // Same polling-dispatch-loop reasoning as the main engine's own
    // Main.cpp runServe() -- see that function's comment for why
    // runDispatchLoop()/[NSApp run] isn't used here either. This loop
    // exits only via process termination (the main engine kills this
    // process on app quit, or the OS if the parent dies) -- there's no
    // in-process "clean exit" path other than the "shutdown" message
    // calling JUCEApplicationBase::quit(), which this loop doesn't
    // currently observe (see note below).
    while (true)
        juce::MessageManager::getInstance()->runDispatchLoopUntil(50);
}

int main(int argc, char* argv[])
{
    if (argc > 2 && juce::String(argv[1]) == "--serve-bridge")
        return runServeBridge(juce::String(argv[2]).getIntValue());

    juce::Logger::writeToLog("sssketch-bridge: no valid mode given (expected --serve-bridge <port>)");
    return 1;
}
```

**Note for the implementer:** the `while (true)` loop never actually observes `JUCEApplicationBase::quit()`'s request-to-quit flag (`runServeBridge` has no equivalent of the main engine's own `--serve` mode's shutdown handling, since this is a fresh mode written from scratch, not copied from a place that already solved this). In practice this doesn't matter for correctness — `BridgeClient` (Task 6) sends the "shutdown" message and then force-kills the process shortly after regardless (matching the design spec's "control message, then a short wait, then SIGKILL fallback" teardown), so a clean quit here is a nice-to-have, not load-bearing. If you want it anyway: check `JUCEApplicationBase::isStandaloneApp()`-style quit-requested state at the top of each loop iteration and `return 0;` instead of looping — verify this actually works via manual testing before relying on it, since this exact "does the polling loop correctly observe quit requests" question is untested territory here, unlike `runDispatchLoopUntil` itself (already proven in the main engine).

- [ ] **Step 5: Build**

```bash
cd native-engine-bridge && cmake --build build
```
Expected: succeeds.

- [ ] **Step 6: Manual smoke test — spawn the bridge and connect a raw client**

```bash
native-engine-bridge/build/sssketch_bridge_artefacts/sssketch-bridge.app/Contents/MacOS/sssketch-bridge --serve-bridge 45890 &
sleep 1
nc 127.0.0.1 45890 </dev/null
```
Expected: the `nc` command connects without error (confirms `beginWaitingForSocket` actually bound and is accepting connections — doesn't need to send/receive anything meaningful, `juce::InterprocessConnection` has its own message framing a raw netcat won't speak). Kill the background bridge process afterward (`kill %1` or find its PID and `kill` it).

This task's REAL verification — actually loading a plugin through it — happens in Task 7's end-to-end walkthrough, once `BridgeClient` exists to drive it from the engine side. Don't try to hand-craft a raw socket message to fully test this task in isolation; it's not worth the effort relative to just finishing Task 6 first.

- [ ] **Step 7: Commit**

```bash
git add native-engine-bridge/
git commit -m "Add bridge process real logic: plugin loading, per-slot audio thread, editor windows, control socket"
```

---

### Task 6: `BridgeClient` — main engine's connection to the bridge (HIGH RISK)

**Files:**
- Create: `native-engine/Source/BridgeClient.h`
- Create: `native-engine/Source/BridgeClient.cpp`
- Modify: `native-engine/CMakeLists.txt`

No automated tests for this task either, for the same reason as Task 5 — spawning a real second process and confirming a real load succeeds is what Task 7's manual walkthrough is for. `ensureRunning`'s retry-connect loop and `messageReceived`'s JSON handling are straightforward enough to review by reading, matching this codebase's own convention for `engineProcess.ts`'s own analogous spawn+connect logic (also untested directly, verified via the app actually working).

- [ ] **Step 1: Write `BridgeClient.h`**

```cpp
// native-engine/Source/BridgeClient.h
#pragma once
#include "SharedAudioChannel.h"
#include <juce_events/juce_events.h>
#include <atomic>
#include <functional>
#include <memory>
#include <unordered_map>

namespace sssketch
{
    /** The main engine's connection to the x86_64 bridge helper process --
     * one shared instance for the whole app session (see design spec's
     * Lifecycle section), used by every PluginChain slot that loads an
     * x86_64 plugin, across the master chain and every channel's chain.
     * Owns spawning the bridge (lazily, on first use), connecting to its
     * control socket, and the per-slot load/editor/unload API PluginChain
     * calls into.
     *
     * Message-thread API: ensureRunning(), loadPlugin(), openEditor(),
     * closeEditor(), unloadPlugin(). Audio-thread API: channelFor() and
     * isHealthy() only -- the actual per-block audio read/write calls are
     * methods on the SharedAudioChannel channelFor() returns, not on
     * BridgeClient itself, so the audio thread's hot path never touches
     * BridgeClient's own control-plane bookkeeping. */
    class BridgeClient : public juce::InterprocessConnection
    {
    public:
        /** `bridgeBinaryPath` is resolved by Electron (dev vs packaged,
         * mirroring how the main engine's own binary path is resolved --
         * see engineProcess.ts) and passed down via a CLI arg -- see
         * Main.cpp. An empty path means bridging is unavailable this
         * session (e.g. the bridge hasn't been built in dev mode yet) --
         * every method below degrades gracefully to "load failed" rather
         * than crashing. */
        explicit BridgeClient(juce::String bridgeBinaryPath);
        ~BridgeClient() override;

        void connectionMade() override;
        void connectionLost() override;
        void messageReceived(const juce::MemoryBlock& message) override;

        /** Message-thread API: spawns the bridge (if not already running)
         * and connects to it (if not already connected), retrying the
         * connect for a few seconds to absorb the process's own startup
         * time. Returns false if spawning or connecting fails outright.
         * loadPlugin() calls this internally -- most callers don't need to
         * call it directly. */
        bool ensureRunning();

        /** Message-thread API: creates a fresh SharedAudioChannel (owner
         * side) for `slotId`, sends a load-bridge-plugin control message,
         * and calls onLoaded once the bridge replies. `slotId` must be
         * unique across every currently-loaded bridged slot in the whole
         * session (master and every channel combined). */
        void loadPlugin(
            const juce::String& slotId,
            const juce::String& path,
            double sampleRate,
            int blockSize,
            std::function<void(bool success, const juce::String& error)> onLoaded);

        void unloadPlugin(const juce::String& slotId);
        void openEditor(const juce::String& slotId);
        void closeEditor(const juce::String& slotId);

        /** Audio-thread API: the slot's own SharedAudioChannel, or nullptr
         * if that slot isn't currently loaded on the bridge (never loaded,
         * failed to load, or the bridge crashed and it was torn down).
         * Never blocks, never allocates -- one map lookup into state only
         * ever mutated on the message thread, published via the same
         * atomic-whole-map-swap pattern ChannelChainRegistry already uses
         * (see its own doc comment) -- read with acquire semantics, never
         * mutated in place once published. */
        SharedAudioChannel* channelFor(const juce::String& slotId);

        /** Audio-thread API: true if the bridge connection is currently
         * considered healthy (connected). PluginChain checks this
         * alongside channelFor() -- see design spec's Error Handling
         * section, "bridge process dies mid-session." */
        bool isHealthy() const { return connected.load(); }

    private:
        void sendJson(const juce::var& payload);
        void publishChannels(std::function<void(std::unordered_map<juce::String, std::unique_ptr<SharedAudioChannel>>&)> mutator);

        juce::String bridgeBinaryPath;
        std::unique_ptr<juce::ChildProcess> bridgeProcess;
        std::atomic<bool> connected { false };

        using ChannelMap = std::unordered_map<juce::String, std::unique_ptr<SharedAudioChannel>>;
        std::atomic<const ChannelMap*> publishedChannels;

        std::unordered_map<juce::String, std::function<void(bool, const juce::String&)>> pendingLoads;
    };
}
```

- [ ] **Step 2: Write `BridgeClient.cpp`**

```cpp
// native-engine/Source/BridgeClient.cpp
#include "BridgeClient.h"
#include <thread>

namespace sssketch
{
    // Fixed control port -- unlike the main engine (which Electron spawns
    // once per session and picks a random port for, since multiple engine
    // instances could theoretically coexist), there is only ever one
    // bridge for the whole app session, so a fixed port is simpler and has
    // nothing to collide with in practice.
    static constexpr int kBridgeControlPort = 45890;

    BridgeClient::BridgeClient(juce::String path)
        : bridgeBinaryPath(std::move(path)), publishedChannels(new ChannelMap())
    {
    }

    BridgeClient::~BridgeClient()
    {
        if (connected.load())
        {
            juce::DynamicObject::Ptr obj = new juce::DynamicObject();
            obj->setProperty("type", "shutdown");
            obj->setProperty("payload", juce::var(new juce::DynamicObject()));
            sendJson(juce::var(obj.get()));
        }
        disconnect();
        if (bridgeProcess != nullptr && !bridgeProcess->waitForProcessToFinish(1000))
            bridgeProcess->kill();
        delete publishedChannels.load();
    }

    void BridgeClient::connectionMade()
    {
        connected.store(true);
    }

    void BridgeClient::connectionLost()
    {
        connected.store(false);
        // Every currently-published channel is now orphaned -- publish an
        // empty map so channelFor() stops handing out channels nothing
        // will ever service again. See design spec's "bridge process dies
        // mid-session": PluginChain checks isHealthy()/channelFor()
        // together and renders silence for any slot this leaves without a
        // channel.
        auto* old = publishedChannels.exchange(new ChannelMap());
        std::thread([old]() { delete old; }).detach();
    }

    bool BridgeClient::ensureRunning()
    {
        if (bridgeBinaryPath.isEmpty())
            return false;
        if (connected.load())
            return true;

        if (bridgeProcess == nullptr || !bridgeProcess->isRunning())
        {
            bridgeProcess = std::make_unique<juce::ChildProcess>();
            if (!bridgeProcess->start(
                    bridgeBinaryPath + " --serve-bridge " + juce::String(kBridgeControlPort)))
            {
                bridgeProcess.reset();
                return false;
            }
        }

        // Retry-connect: the bridge needs a moment to start listening
        // after spawning, especially the first time under Rosetta's
        // translation cold-start. 50 attempts * 100ms = 5 seconds total,
        // matching the main engine's own 5-second readiness timeout (see
        // engineProcess.ts's spawnEngine).
        for (int attempt = 0; attempt < 50; ++attempt)
        {
            if (connectToSocket("127.0.0.1", kBridgeControlPort, 200))
                return true;
            juce::Thread::sleep(100);
        }
        return false;
    }

    void BridgeClient::sendJson(const juce::var& payload)
    {
        const auto text = juce::JSON::toString(payload, true);
        juce::MemoryBlock block(text.toRawUTF8(), text.getNumBytesAsUTF8());
        sendMessage(block);
    }

    void BridgeClient::publishChannels(std::function<void(ChannelMap&)> mutator)
    {
        const auto* current = publishedChannels.load();
        auto* next = new ChannelMap();
        for (auto& [id, ch] : *current)
            (*next)[id] = std::move(const_cast<ChannelMap*>(current)->at(id));
        mutator(*next);
        auto* old = publishedChannels.exchange(next);
        std::thread([old]() { delete old; }).detach();
    }

    void BridgeClient::loadPlugin(
        const juce::String& slotId,
        const juce::String& path,
        double sampleRate,
        int blockSize,
        std::function<void(bool, const juce::String&)> onLoaded)
    {
        if (!ensureRunning())
        {
            if (onLoaded)
                onLoaded(false, "failed to start or connect to the x86_64 bridge process");
            return;
        }

        auto channelName = SharedAudioChannel::makeUniqueName();
        auto channel = SharedAudioChannel::create(channelName, blockSize);
        if (channel == nullptr)
        {
            if (onLoaded)
                onLoaded(false, "failed to create shared audio channel for bridged plugin");
            return;
        }

        // Published BEFORE the bridge confirms the load: channelFor() is
        // an audio-thread convenience for "is there a channel to try
        // sending to," not a promise the bridge has actually finished
        // loading -- PluginChain treats a channel with nothing coming back
        // yet exactly like a timeout (silence), so there's no unsafe
        // window here, just an ordinary startup ramp before the bridge's
        // own audio thread (Task 5's BridgeSlot::run) starts producing
        // output.
        publishChannels([&](ChannelMap& map) { map[slotId] = std::move(channel); });
        pendingLoads[slotId] = std::move(onLoaded);

        juce::DynamicObject::Ptr payloadObj = new juce::DynamicObject();
        payloadObj->setProperty("slotId", slotId);
        payloadObj->setProperty("path", path);
        payloadObj->setProperty("channelName", channelName);
        payloadObj->setProperty("sampleRate", sampleRate);
        payloadObj->setProperty("blockSize", blockSize);
        juce::DynamicObject::Ptr obj = new juce::DynamicObject();
        obj->setProperty("type", "load-bridge-plugin");
        obj->setProperty("payload", juce::var(payloadObj.get()));
        sendJson(juce::var(obj.get()));
    }

    void BridgeClient::unloadPlugin(const juce::String& slotId)
    {
        const auto* current = publishedChannels.load();
        if (current->find(slotId) == current->end())
            return;
        publishChannels([&](ChannelMap& map) { map.erase(slotId); });

        if (connected.load())
        {
            juce::DynamicObject::Ptr payloadObj = new juce::DynamicObject();
            payloadObj->setProperty("slotId", slotId);
            juce::DynamicObject::Ptr obj = new juce::DynamicObject();
            obj->setProperty("type", "unload-bridge-plugin");
            obj->setProperty("payload", juce::var(payloadObj.get()));
            sendJson(juce::var(obj.get()));
        }
    }

    void BridgeClient::openEditor(const juce::String& slotId)
    {
        if (!connected.load()) return;
        juce::DynamicObject::Ptr payloadObj = new juce::DynamicObject();
        payloadObj->setProperty("slotId", slotId);
        juce::DynamicObject::Ptr obj = new juce::DynamicObject();
        obj->setProperty("type", "open-bridge-plugin-editor");
        obj->setProperty("payload", juce::var(payloadObj.get()));
        sendJson(juce::var(obj.get()));
    }

    void BridgeClient::closeEditor(const juce::String& slotId)
    {
        if (!connected.load()) return;
        juce::DynamicObject::Ptr payloadObj = new juce::DynamicObject();
        payloadObj->setProperty("slotId", slotId);
        juce::DynamicObject::Ptr obj = new juce::DynamicObject();
        obj->setProperty("type", "close-bridge-plugin-editor");
        obj->setProperty("payload", juce::var(payloadObj.get()));
        sendJson(juce::var(obj.get()));
    }

    SharedAudioChannel* BridgeClient::channelFor(const juce::String& slotId)
    {
        const auto* map = publishedChannels.load();
        auto it = map->find(slotId);
        return it == map->end() ? nullptr : it->second.get();
    }

    void BridgeClient::messageReceived(const juce::MemoryBlock& message)
    {
        auto text = juce::String::fromUTF8((const char*) message.getData(), (int) message.getSize());
        auto parsed = juce::JSON::parse(text);
        if (!parsed.isObject())
            return;
        auto type = parsed.getProperty("type", "").toString();
        auto payload = parsed.getProperty("payload", juce::var());

        if (type == "bridge-plugin-loaded" && payload.isObject())
        {
            const auto slotId = payload.getProperty("slotId", "").toString();
            const bool success = payload.getProperty("success", false);
            const auto error = payload.getProperty("error", "").toString();
            auto it = pendingLoads.find(slotId);
            if (it != pendingLoads.end())
            {
                auto callback = std::move(it->second);
                pendingLoads.erase(it);
                if (!success)
                    unloadPlugin(slotId); // clean up the channel published speculatively in loadPlugin
                if (callback)
                    callback(success, error);
            }
        }
    }
}
```

**Note for the implementer:** `publishChannels`'s `const_cast` mirrors `ChannelChainRegistry::updateChannelSet`'s own `const_cast` reasoning exactly (see `ChannelChainRegistry.cpp`'s doc comment on that line) — `current` is only ever read by the audio thread via `channelFor`, never mutated in place, so moving a `unique_ptr` out of it between the `load()` and the `exchange()` here is safe. If that reasoning doesn't hold up under scrutiny during implementation, the simpler fallback (construct every entry fresh instead of reusing) is NOT viable here the way it might be elsewhere — `SharedAudioChannel` instances can't be cheaply reconstructed (they own real OS resources tied to a specific `channelName` the bridge process already attached to), so don't take that shortcut; ask before changing this pattern.

- [ ] **Step 3: Update `native-engine/CMakeLists.txt`**

```cmake
target_sources(sssketch_engine PRIVATE
  Source/Main.cpp
  Source/PluginArchitecture.cpp
  Source/BridgeClient.cpp
  Source/PluginChain.cpp
  ...
```

- [ ] **Step 4: Build**

```bash
cd native-engine && cmake --build build
```
Expected: succeeds. `BridgeClient` isn't wired into anything yet (Task 7 does that) — this step only confirms it compiles standalone.

- [ ] **Step 5: Commit**

```bash
git add native-engine/Source/BridgeClient.h native-engine/Source/BridgeClient.cpp native-engine/CMakeLists.txt
git commit -m "Add BridgeClient: main engine's spawn/connect/load/editor API for the x86_64 bridge"
```

---

### Task 7: Wire `BridgeClient` into `PluginChain`'s load and process (HIGHEST RISK)

**Files:**
- Modify: `native-engine/Source/PluginChain.h`
- Modify: `native-engine/Source/PluginChain.cpp`
- Modify: `native-engine/Source/PluginChainTests.cpp`

**This is the highest-risk task in the entire plan.** It changes `PluginChain`'s existing pending-load swap mechanism (already carefully built, tested, and proven correct across two previous features this session) to carry EITHER a local plugin instance OR a bridge slot id through the same atomic hand-off. Read `PluginChain.h`/`.cpp` in full before starting (small enough to hold in context at once). Get every existing test passing FIRST after this change before considering it correct — this task must not change behavior for any plugin that isn't x86_64.

- [ ] **Step 1: Update `PluginChain.h`**

Add the include and forward-related member. The `Instantiator`, public API, and everything about `EditorWindow`/`BpmPlayHead` stay exactly as they are after Task 2 — only the constructor signature, the `Slot` struct, and the `pending` field's type change:

```cpp
#include "BridgeClient.h"
```
(add near the top, alongside the existing includes)

Constructor:
```cpp
explicit PluginChain(int numSlots, Instantiator instantiator = &PluginChain::defaultInstantiate, BridgeClient* bridgeClient = nullptr);
```

Replace the `Slot` struct's `pending` field and add `bridgeSlotId`:
```cpp
    private:
        // Bundles what a completed background load hands off to the audio
        // thread via applyPendingSwaps() -- EITHER a local instance
        // (bridgeSlotId empty) OR a bridge slot id (localInstance nullptr),
        // never both. Deleting a PendingLoad that was never applied (e.g.
        // PluginChain destroyed mid-load) also deletes localInstance if
        // present -- mirrors the original design's "harmless" in-flight
        // teardown reasoning (see PluginChain::~PluginChain), just one
        // level deeper now that there are two kinds of pending state
        // instead of one.
        struct PendingLoad
        {
            juce::AudioProcessor* localInstance = nullptr;
            juce::String bridgeSlotId;
            ~PendingLoad() { delete localInstance; }
        };

        struct Slot
        {
            std::unique_ptr<juce::AudioProcessor> active;
            int processChannels = 2;
            std::atomic<PendingLoad*> pending { nullptr };
            std::atomic<bool> pendingReady { false };
            juce::AudioBuffer<float> scratch;
            std::unique_ptr<PluginEditorWindow> editorWindow;
            // Non-empty when this slot's plugin is running on the x86_64
            // bridge instead of in-process -- see
            // docs/superpowers/specs/2026-08-01-x86-plugin-bridge-design.md.
            // `active` stays nullptr for a bridged slot. Only ever written
            // by applyPendingSwaps() (audio thread), matching how `active`
            // itself is only ever written there too.
            juce::String bridgeSlotId;
            // Reused interleaved-stereo scratch for the bridged path,
            // resized only when numSamples changes -- mirrors `scratch`
            // above's own resize-only-if-changed pattern, for the exact
            // same reason: no heap allocation on the audio thread once
            // warmed up (numSamples is constant for the life of a session
            // in practice).
            std::vector<float> bridgeInputScratch;
            std::vector<float> bridgeOutputScratch;
        };

        std::vector<Slot> slots;
        Instantiator instantiator;
        BpmPlayHead playHead;
        BridgeClient* bridgeClient;
```

- [ ] **Step 2: Update `PluginChain.cpp`'s constructor and destructor**

```cpp
    PluginChain::PluginChain(int numSlots, Instantiator inst, BridgeClient* bc)
        : slots(numSlots), instantiator(std::move(inst)), bridgeClient(bc) {}

    PluginChain::~PluginChain()
    {
        for (auto& slot : slots)
            delete slot.pending.exchange(nullptr); // now a PendingLoad*, whose own destructor cleans up localInstance if set
    }
```

- [ ] **Step 3: Update `applyPendingSwaps`**

```cpp
    void PluginChain::applyPendingSwaps()
    {
        for (auto& slot : slots)
        {
            if (!slot.pendingReady.exchange(false))
                continue;
            auto* newPending = slot.pending.exchange(nullptr);
            if (newPending == nullptr)
                continue; // defensive: shouldn't happen if pendingReady was true

            auto oldActive = std::move(slot.active);
            slot.active.reset(newPending->localInstance);
            newPending->localInstance = nullptr; // ownership moved into slot.active -- don't let PendingLoad's dtor double-delete it
            slot.bridgeSlotId = newPending->bridgeSlotId;
            delete newPending;

            if (slot.active != nullptr)
            {
                slot.active->setPlayHead(&playHead);
                slot.processChannels = std::max(
                    { 2, slot.active->getTotalNumInputChannels(), slot.active->getTotalNumOutputChannels() });
            }
            else
            {
                slot.processChannels = 2;
            }

            if (oldActive != nullptr)
            {
                auto* toDelete = oldActive.release();
                std::thread([toDelete]() { delete toDelete; }).detach();
            }
        }
    }
```

- [ ] **Step 4: Update `process`**

```cpp
    void PluginChain::process(int numSamples, float* outL, float* outR)
    {
        juce::MidiBuffer midi;
        for (auto& slot : slots)
        {
            const bool isBridged = !slot.bridgeSlotId.isEmpty();
            if (slot.active == nullptr && !isBridged)
                continue; // empty slot = passthrough, not a break in the chain

            if (isBridged)
            {
                auto* channel = bridgeClient != nullptr && bridgeClient->isHealthy()
                    ? bridgeClient->channelFor(slot.bridgeSlotId)
                    : nullptr;
                if (channel == nullptr)
                {
                    // Bridge unavailable or this slot's channel is gone --
                    // see design spec's Error Handling, "bridge process
                    // dies mid-session": silence this slot's contribution,
                    // not a passthrough bypass.
                    std::fill(outL, outL + numSamples, 0.0f);
                    std::fill(outR, outR + numSamples, 0.0f);
                    continue;
                }

                if ((int) slot.bridgeInputScratch.size() != numSamples * 2)
                {
                    slot.bridgeInputScratch.resize((size_t) numSamples * 2);
                    slot.bridgeOutputScratch.resize((size_t) numSamples * 2);
                }
                for (int i = 0; i < numSamples; ++i)
                {
                    slot.bridgeInputScratch[(size_t) i * 2] = outL[i];
                    slot.bridgeInputScratch[(size_t) i * 2 + 1] = outR[i];
                }
                channel->writeInputAndSignal(slot.bridgeInputScratch.data(), (uint32_t) numSamples);

                std::fill(slot.bridgeOutputScratch.begin(), slot.bridgeOutputScratch.end(), 0.0f);
                // 5ms timeout -- a starting value from the design spec
                // (see SharedAudioChannel.h's own kBlocksOfHeadroom note),
                // not derived from profiling. At a typical 512-sample
                // block (~11.6ms at 44.1kHz) this leaves roughly half the
                // block's period for the rest of this callback's work.
                const uint32_t got = channel->waitAndReadOutput(
                    slot.bridgeOutputScratch.data(), (uint32_t) numSamples, 5);
                if (got < (uint32_t) numSamples)
                {
                    // Timed out or got a short block -- silence for this
                    // block only, per design spec. Self-healing: the next
                    // block tries again independently, no state changes
                    // here.
                    std::fill(outL, outL + numSamples, 0.0f);
                    std::fill(outR, outR + numSamples, 0.0f);
                    continue;
                }

                for (int i = 0; i < numSamples; ++i)
                {
                    const float l = slot.bridgeOutputScratch[(size_t) i * 2];
                    const float r = slot.bridgeOutputScratch[(size_t) i * 2 + 1];
                    outL[i] = std::isfinite(l) ? l : 0.0f;
                    outR[i] = std::isfinite(r) ? r : 0.0f;
                }
                continue;
            }

            // Existing in-process path, unchanged from before this task:
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
                const float l = slot.scratch.getSample(0, i);
                const float r = slot.scratch.getSample(1, i);
                outL[i] = std::isfinite(l) ? l : 0.0f;
                outR[i] = std::isfinite(r) ? r : 0.0f;
            }
        }
    }
```

- [ ] **Step 5: Update `requestLoad`**

```cpp
    void PluginChain::requestLoad(
        int slotIndex,
        const juce::String& path,
        double sampleRate,
        int blockSize,
        std::function<void(bool, const juce::String&)> onLoaded)
    {
        if (bridgeClient != nullptr && !path.isEmpty() && detectPluginArchitecture(path) == "x86_64")
        {
            static std::atomic<int> bridgeSlotCounter { 0 };
            const auto newBridgeSlotId = "bridge-slot-" + juce::String(bridgeSlotCounter.fetch_add(1));
            bridgeClient->loadPlugin(newBridgeSlotId, path, sampleRate, blockSize,
                [this, slotIndex, newBridgeSlotId, onLoaded](bool success, const juce::String& error)
                {
                    // Runs on the message thread (BridgeClient's own
                    // callback contract, mirroring requestLoad's existing
                    // callAsync path below) -- safe to touch `slots`
                    // directly.
                    if (success)
                    {
                        auto& slot = slots[(size_t) slotIndex];
                        auto* newPending = new PendingLoad { nullptr, newBridgeSlotId };
                        delete slot.pending.exchange(newPending);
                        slot.pendingReady.store(true);
                    }
                    if (onLoaded)
                        onLoaded(success, error);
                });
            return;
        }

        // Existing in-process path, unchanged from before this task
        // (see PluginChain.h's own doc comment on requestLoad for why this
        // runs on the message thread via callAsync rather than a raw
        // background std::thread):
        juce::MessageManager::callAsync([this, slotIndex, path, sampleRate, blockSize, onLoaded]()
        {
            auto& slot = slots[(size_t) slotIndex];
            juce::String error;
            auto instance = instantiator(path, sampleRate, blockSize, error);
            const bool success = error.isEmpty();

            if (success)
            {
                auto* newPending = new PendingLoad { instance.release(), {} };
                delete slot.pending.exchange(newPending);
                slot.pendingReady.store(true);
            }

            if (onLoaded)
                onLoaded(success, error);
        });
    }
```

- [ ] **Step 6: Update `openEditorWindow`/`closeEditorWindow` to route a bridged slot to the bridge**

**Easy to miss:** without this step, clicking "edit" on a bridged slot silently does nothing — `slot.active` is always null for a bridged slot, so the existing `if (slot.active == nullptr || !slot.active->hasEditor()) return true;` no-op branch swallows the request before it ever reaches the bridge. The actual editor window for a bridged plugin lives entirely in the bridge process (`BridgeSlot::openEditor`, Task 5) — this side only needs to forward the request, never manage a local `PluginEditorWindow` for that slot at all.

```cpp
    bool PluginChain::openEditorWindow(int slotIndex)
    {
        if (slotIndex < 0 || slotIndex >= (int) slots.size())
            return false;
        auto& slot = slots[(size_t) slotIndex];

        if (!slot.bridgeSlotId.isEmpty())
        {
            if (bridgeClient != nullptr)
                bridgeClient->openEditor(slot.bridgeSlotId);
            return true;
        }

        // Existing in-process path, unchanged from before this task:
        if (slot.editorWindow != nullptr)
        {
            slot.editorWindow->toFront(true);
            return true;
        }
        if (slot.active == nullptr || !slot.active->hasEditor())
            return true;

        auto* editor = slot.active->createEditorIfNeeded();
        if (editor == nullptr)
            return true;

        slot.editorWindow = std::make_unique<PluginEditorWindow>(
            slot.active->getName(), editor, [this, slotIndex]() { closeEditorWindow(slotIndex); });
        return true;
    }

    void PluginChain::closeEditorWindow(int slotIndex)
    {
        if (slotIndex < 0 || slotIndex >= (int) slots.size())
            return;
        auto& slot = slots[(size_t) slotIndex];
        if (!slot.bridgeSlotId.isEmpty())
        {
            if (bridgeClient != nullptr)
                bridgeClient->closeEditor(slot.bridgeSlotId);
            return;
        }
        slot.editorWindow.reset();
    }
```

- [ ] **Step 7: Add `#include "PluginArchitecture.h"` to `PluginChain.cpp`**

(needed for the `detectPluginArchitecture` call added in Step 5.)

- [ ] **Step 8: Build and run the full native test suite**

```bash
cd native-engine && cmake --build build && ./build/sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine --test
```
Expected: every existing `PluginChain` test passes unchanged — every existing test's fake `Instantiator` operates on paths `detectPluginArchitecture` will report as `"unknown"` (fake/nonexistent paths, not real x86_64 bundles), so they all fall straight through to the existing in-process branch exactly as before. If anything in this suite fails, it means the branch condition or the `PendingLoad`/`applyPendingSwaps` restructuring broke something real — do not proceed to Task 8 with a failing test here.

- [ ] **Step 9: Commit**

```bash
git add native-engine/Source/PluginChain.h native-engine/Source/PluginChain.cpp
git commit -m "Wire BridgeClient into PluginChain: load-time architecture branch, bridged process() path"
```

---

### Task 8: Wire `BridgeClient` ownership through `Main.cpp`/`ChannelChainRegistry`/`RenderExport.cpp`, and Electron's path-passing

**Files:**
- Modify: `native-engine/Source/Main.cpp`
- Modify: `native-engine/Source/ChannelChainRegistry.h`
- Modify: `native-engine/Source/ChannelChainRegistry.cpp`
- Modify: `native-engine/Source/RenderExport.cpp`
- Modify: `src/main/engineProcess.ts`
- Modify: `src/main/engineProcess.test.ts`

- [ ] **Step 1: Update `ChannelChainRegistry.h`/`.cpp` to accept and forward a `BridgeClient*`**

`ChannelChainRegistry` already takes a `PluginChain::Instantiator` in its constructor and passes it to every `PluginChain` it creates (see `updateChannelSet`'s "new channel" branch) — add a `BridgeClient*` alongside it, forwarded the same way:

```cpp
// ChannelChainRegistry.h
explicit ChannelChainRegistry(PluginChain::Instantiator instantiator = nullptr, BridgeClient* bridgeClient = nullptr);
...
private:
    ...
    BridgeClient* bridgeClient;
```

```cpp
// ChannelChainRegistry.cpp
ChannelChainRegistry::ChannelChainRegistry(PluginChain::Instantiator inst, BridgeClient* bc)
    : published(new ChannelChainMap()), instantiator(std::move(inst)), bridgeClient(bc)
{
}
```

In `updateChannelSet`'s "new channel" branch, add `bridgeClient` to both `PluginChain` constructions:
```cpp
                (*next)[channelId] = instantiator
                    ? std::make_unique<PluginChain>(kNumChannelChainSlots, instantiator, bridgeClient)
                    : std::make_unique<PluginChain>(kNumChannelChainSlots, &PluginChain::defaultInstantiate, bridgeClient);
```

(`#include "BridgeClient.h"` in `ChannelChainRegistry.h`.)

- [ ] **Step 2: Update `Main.cpp`**

Parse a new `--bridge-binary <path>` CLI arg (a value alongside `--serve <port>`, not a standalone mode), construct one `BridgeClient`, and pass it to both the master chain and the channel registry:

```cpp
    // Right before constructing masterChain/channelChains in runServe (or
    // wherever those locals currently live -- see this file's existing
    // `PluginChain masterChain(kNumMasterChainSlots);` /
    // `ChannelChainRegistry channelChains;` lines):
    juce::String bridgeBinaryPath;
    for (int i = 1; i < argc - 1; ++i)
    {
        if (juce::String(argv[i]) == "--bridge-binary")
        {
            bridgeBinaryPath = juce::String(argv[i + 1]);
            break;
        }
    }
    BridgeClient bridgeClient(bridgeBinaryPath); // empty path = bridging unavailable this session, degrades gracefully

    PluginChain masterChain(kNumMasterChainSlots, &PluginChain::defaultInstantiate, &bridgeClient);
    ChannelChainRegistry channelChains(nullptr, &bridgeClient);
```

(`#include "BridgeClient.h"` near the top, alongside the existing includes.)

**Note for the implementer:** find the exact current lines constructing `masterChain`/`channelChains` in `Main.cpp` before editing — Task 1 of the earlier channel-plugin-inserts plan put them as locals inside `runServe` (and a second set inside `main()`'s other modes, e.g. `--test-client`). Every construction site needs the new arguments; the CLI-arg parsing above only needs to run once, near the top of `runServe` specifically (the only mode that spawns a real bridge — `--test`, `--scan-one-json`, etc. never need one, so their own `PluginChain`/`ChannelChainRegistry` locals, if any, can keep passing `nullptr` for `bridgeClient` unchanged).

- [ ] **Step 3: Confirm `RenderExport.cpp` is deliberately unchanged**

Per this plan's own header note (see the top of this document): export's `PluginChain`/`ChannelChainRegistry` constructions stay exactly as they are, passing no `BridgeClient*` (defaulting to `nullptr`). Don't add bridging to export in this pass — an x86_64 plugin in an exported project fails to load with the same error JUCE has always produced for a foreign-architecture binary, which is an accepted, documented limitation (see this plan's header). No code change needed here; this step is a checkpoint to confirm you didn't accidentally touch it while working through the other files.

- [ ] **Step 4: Update `native-engine/CMakeLists.txt`'s `target_sources` if `ChannelChainRegistry.cpp` isn't already listed with `BridgeClient.cpp` nearby**

(Should already be covered by Task 6 Step 3 adding `Source/BridgeClient.cpp` — this step is just a sanity check, no new file to add.)

- [ ] **Step 5: Build and run the full native test suite**

```bash
cd native-engine && cmake --build build && ./build/sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine --test
```
Expected: every existing test passes unchanged — `ChannelChainRegistryTests.cpp`'s existing tests construct `ChannelChainRegistry` with zero or one argument, both of which now default `bridgeClient` to `nullptr`, so nothing about their behavior changes.

- [ ] **Step 6: Update `src/main/engineProcess.ts`**

Add a bridge-binary path resolver mirroring `defaultBinaryPath()`'s own dev-vs-packaged branch exactly, and pass it to the spawned engine — but only if the bridge binary actually exists, so bridging stays optional in dev mode until someone's actually built `native-engine-bridge/`:

```ts
function defaultBridgeBinaryPath(): string {
  if (app.isPackaged) {
    return join(
      process.resourcesPath,
      'native-engine-bridge/sssketch-bridge.app/Contents/MacOS/sssketch-bridge'
    )
  }
  return join(
    app.getAppPath(),
    'native-engine-bridge/build/sssketch_bridge_artefacts/sssketch-bridge.app/Contents/MacOS/sssketch-bridge'
  )
}
```

In `spawnEngine`, right before the `spawn(binaryPath, ...)` call:
```ts
  const bridgeBinaryPath = options.bridgeBinaryPathOverride ?? defaultBridgeBinaryPath()
  const engineArgs = ['--serve', String(port)]
  if (existsSync(bridgeBinaryPath)) {
    engineArgs.push('--bridge-binary', bridgeBinaryPath)
  }
```
and change the spawn call from `spawn(binaryPath, ['--serve', String(port)])` to `spawn(binaryPath, engineArgs)`.

Add `bridgeBinaryPathOverride?: string` to the `SpawnEngineOptions` interface (mirrors `binaryPathOverride`'s own existing shape, for the same test-injection reason).

- [ ] **Step 7: Update `src/main/engineProcess.test.ts`**

Check the existing test file for how it currently invokes `spawnEngine` (via `binaryPathOverride` pointing at the real compiled binary) — add a case confirming the `--bridge-binary` flag is included when a bridge binary exists at the override path, and omitted when it doesn't:

```ts
  it('passes --bridge-binary when the bridge binary exists at the given override path', async () => {
    handle = await spawnEngine({
      binaryPathOverride: realBinaryPath,
      bridgeBinaryPathOverride: realBinaryPath // reusing the real engine binary as a stand-in "exists" path -- this test only checks the flag/arg wiring, not that the engine does anything useful with a non-bridge binary at that path
    })
    // No direct way to inspect the spawned argv from here without a
    // process-inspection dependency this codebase doesn't otherwise use --
    // the meaningful assertion is that the engine still starts up and
    // reports readiness normally even with the extra flag present (proves
    // the engine's own CLI parsing in Main.cpp Step 2 above doesn't choke
    // on it), which the existing readiness-promise resolution already
    // covers implicitly. This test's real value is documentation + a
    // canary for a future engineProcess.ts refactor breaking the flag
    // construction outright (a syntax/logic error there would throw before
    // spawnEngine ever gets to spawn()).
    expect(handle.port).toBeGreaterThan(0)
  })

  it('omits --bridge-binary when nothing exists at the given override path', async () => {
    handle = await spawnEngine({
      binaryPathOverride: realBinaryPath,
      bridgeBinaryPathOverride: '/definitely/does/not/exist/sssketch-bridge'
    })
    expect(handle.port).toBeGreaterThan(0) // engine still starts fine without the flag
  })
```

**Note for the implementer:** check this test file's existing structure first (afterEach cleanup, `realBinaryPath` construction) and match its conventions exactly — the snippet above shows the assertions' *intent*, not necessarily the final exact syntax if the existing file's helper functions differ from what's assumed here.

- [ ] **Step 8: Run the renderer/main test suite**

```bash
npm run typecheck && npm run lint && npx vitest run
```
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add native-engine/Source/Main.cpp native-engine/Source/ChannelChainRegistry.h native-engine/Source/ChannelChainRegistry.cpp src/main/engineProcess.ts src/main/engineProcess.test.ts
git commit -m "Wire BridgeClient ownership through Main.cpp/ChannelChainRegistry, thread bridge binary path from Electron"
```

---

### Task 9: Packaging — bundle and codesign the bridge binary

**Files:**
- Modify: `electron-builder.yml`
- Modify: `build/afterSign.js`

- [ ] **Step 1: Add the bridge bundle to `electron-builder.yml`'s `extraResources`**

```yaml
extraResources:
  - from: native-engine/build/sssketch_engine_artefacts/sssketch-engine.app
    to: native-engine/sssketch-engine.app
  - from: native-engine-bridge/build/sssketch_bridge_artefacts/sssketch-bridge.app
    to: native-engine-bridge/sssketch-bridge.app
```

(Layout matches `defaultBridgeBinaryPath()` from Task 8 exactly — `process.resourcesPath + 'native-engine-bridge/sssketch-bridge.app/Contents/MacOS/sssketch-bridge'`.)

- [ ] **Step 2: Update `build/afterSign.js` to also sign the bridge bundle**

The bridge needs the exact same entitlements the main engine already has (`entitlements.engine.plist` — allow-jit, disable-library-validation for loading third-party plugin code, etc.), reused as-is rather than duplicated into a new file:

```js
// build/afterSign.js
const { execFileSync } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')

exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return

  const identity = process.env.CSC_NAME
  if (!identity) {
    console.log('afterSign: CSC_NAME not set, skipping engine signing (unsigned/local build)')
    return
  }

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  const entitlementsPath = path.join(__dirname, 'entitlements.engine.plist')

  const bundlesToSign = [
    path.join(appPath, 'Contents/Resources/native-engine/sssketch-engine.app'),
    path.join(appPath, 'Contents/Resources/native-engine-bridge/sssketch-bridge.app')
  ]

  for (const bundlePath of bundlesToSign) {
    // The bridge bundle is a genuinely new build target introduced by this
    // feature -- skip signing it gracefully if it wasn't built for this
    // particular packaging run, same "optional/degradable" philosophy as
    // engineProcess.ts's own existsSync check before passing --bridge-binary.
    if (!fs.existsSync(bundlePath)) {
      console.log(`afterSign: ${bundlePath} not found, skipping (not built this run)`)
      continue
    }
    console.log(`afterSign: signing nested bundle at ${bundlePath}`)
    execFileSync(
      'codesign',
      ['--deep', '--force', '--options', 'runtime', '--entitlements', entitlementsPath, '--sign', identity, bundlePath],
      { stdio: 'inherit' }
    )
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add electron-builder.yml build/afterSign.js
git commit -m "Package and codesign the x86_64 bridge bundle alongside the main engine"
```

(No build/run verification step here — this only matters for a real signed package build, which per the still-pending manual sign/notarize dry-run from the earlier signing work is its own separate, not-yet-reached milestone. `npm run build:mac` / `dist:mac` locally with `CSC_NAME` unset will still succeed and simply skip signing, per Step 2's own graceful-skip branch — a reasonable sanity check if you want one, but not required to consider this task done.)

---

### Task 10: Renderer UI — enable x86_64 selection, mark it subtly

**Files:**
- Modify: `src/renderer/src/components/PluginCatalogBrowser.tsx`
- Modify: `src/renderer/src/components/MasterChainPanel.tsx`
- Modify: `src/renderer/src/components/ChannelChainPanel.tsx`

- [ ] **Step 1: Update `PluginCatalogBrowser.tsx`**

```tsx
        {catalog.plugins.map((entry) => {
          const loadable = entry.arch === 'arm64' || entry.arch === 'universal' || entry.arch === 'x86_64'
          const isFavourite = catalog.favouriteIds.includes(entry.id)
          return (
```

(was `const loadable = entry.arch === 'arm64' || entry.arch === 'universal'`.)

The arch label already renders as plain text right next to each entry (`<span style={{ color: 'var(--ra-text-2)', fontSize: 9 }}>{entry.arch}</span>`) — that's the "mark it subtly" surface, per the design spec's decision, already half-built. Give x86_64 specifically an accent color instead of the plain muted grey every other arch value uses, so a bridged plugin reads as visually distinct without any new UI element:

```tsx
              <span
                style={{
                  color: entry.arch === 'x86_64' ? 'var(--ra-type-fx)' : 'var(--ra-text-2)',
                  fontSize: 9
                }}
              >
                {entry.arch}
              </span>
```

(was `<span style={{ color: 'var(--ra-text-2)', fontSize: 9 }}>{entry.arch}</span>`.)

- [ ] **Step 2: Update `MasterChainPanel.tsx`'s dropdown option label**

Native `<select>` `<option>` elements can't carry color styling — the only "mark it subtly" available here is a short text suffix, applied only to x86_64 entries so every other plugin's label is completely unchanged:

```tsx
                {favourites.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                    {entry.arch === 'x86_64' ? ' (bridged)' : ''}
                  </option>
                ))}
```

(was `<option key={entry.id} value={entry.id}>{entry.name}</option>`.)

- [ ] **Step 3: Apply the identical change to `ChannelChainPanel.tsx`**

Same diff, same reasoning, same surrounding structure (confirmed identical during planning — `favourites.map((entry) => (<option key={entry.id} value={entry.id}>{entry.name}</option>))`).

- [ ] **Step 4: Verify**

```bash
npm run typecheck && npm run lint && npx vitest run
```
Expected: all pass — this task has no new logic to unit test (no branching beyond a ternary in JSX), consistent with this codebase's own convention of not writing component tests for this class of change.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/PluginCatalogBrowser.tsx src/renderer/src/components/MasterChainPanel.tsx src/renderer/src/components/ChannelChainPanel.tsx
git commit -m "Enable selecting x86_64 plugins in the catalog/chain dropdowns, mark them subtly"
```

---

### Task 11: Final verification + manual end-to-end walkthrough

**Files:** none — verification only.

- [ ] **Step 1: Full native build + test, both targets**

```bash
cd native-engine && cmake --build build && ./build/sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine --test
cd ../native-engine-bridge && cmake --build build
```
Expected: main engine's full suite passes (every test from every task in this plan, plus everything that existed before it); bridge builds cleanly.

- [ ] **Step 2: Full renderer/main verification**

```bash
npm run typecheck && npm run lint && npx vitest run && npx electron-vite build
```
Expected: all pass, production build succeeds.

- [ ] **Step 3: Restart the app fully**

Per this project's own standing rule (see `CLAUDE.md`): a native engine change needs a full quit + relaunch, not just a renderer reload, since the engine subprocess is only spawned once at app startup. Quit the running dev app completely, then `npm run dev` fresh.

- [ ] **Step 4: Manual, end-to-end walkthrough (required — this is the real pass/fail signal for this whole feature)**

1. Open the plugin catalog browser (or trigger a fresh scan if needed). Confirm FabFilter Pro-Q 3 (or whichever x86_64-only plugin is installed on this machine — confirmed x86_64-only from earlier plugin-scan work this session) now shows with its arch label colored differently from the arm64/universal entries around it, and its "use" button is enabled (not greyed out).
2. Favourite it, load it into a master chain slot (or a channel slot). Confirm the status indicator shows "loading" then "loaded" — watch for how long this takes the first time (Rosetta's cold-start could make the first load noticeably slower than a native plugin; note the actual delay in your report).
3. Play back a project with audio routed through that slot. Confirm the plugin's effect is actually audible — not just "plays without crashing," genuinely confirm the sound changed compared to bypassing that slot.
4. Click "edit" on that slot. Confirm a real, separate window opens (not just the main app's own window) and comes to the front. Adjust a parameter in the plugin's own UI; confirm the audible effect changes in real time while still playing.
5. Close the editor window; confirm playback is unaffected.
6. While playback continues, find the bridge process's PID (`ps aux | grep sssketch-bridge`) and force-kill it (`kill -9 <pid>`). Confirm: the main engine does NOT crash, the rest of the mix keeps playing normally, and the bridged slot's contribution goes silent (not a click/pop, not garbage noise — actual silence).
7. Re-select the same plugin from that slot's dropdown (or reopen the catalog and re-favourite/re-select it). Confirm it reloads successfully — the bridge process respawns and the slot comes back to life.
8. Quit the whole app. Confirm the bridge process is no longer running afterward (`ps aux | grep sssketch-bridge` shows nothing) — no orphaned process left behind.

- [ ] **Step 5: Write an honest final report**

Cover explicitly: which of Step 4's checks passed as expected, which didn't (and what actually happened instead), the two scope decisions documented at the top of this plan (export bridging deliberately excluded; silence-not-bypass on timeout) and whether they held up as designed, and the actual Rosetta cold-start latency observed in 4.2 — that number matters for whether the 5-second connect-retry budget in `BridgeClient::ensureRunning` (Task 6) is actually enough headroom, or needs tuning. This is the highest-risk feature built this session; a report that only says "it works" without these specifics isn't sufficient.
