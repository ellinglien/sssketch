# JUCE Engine Phase 0 — Toolchain Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the JUCE + VST3 + AudioUnit toolchain actually works on this machine — a
standalone native console app (no Electron involved) that scans for installed plugins,
loads one VST3 and one AudioUnit, and successfully processes an audio buffer through
each — before any integration work with the rest of ssstitch begins.

**Architecture:** A new `native-engine/` directory at the repo root, entirely separate
from `src/` (the existing Electron/TS app is untouched by this plan). CMake project,
JUCE pulled in via `FetchContent` (no manual submodule management, no Projucer GUI
tool). A single console executable that scans, loads, and reports results via stdout —
verification is "does it build, run, and print a clean PASS summary for both formats,"
the appropriate bar for a toolchain spike rather than a full test suite.

**Tech Stack:** C++20, CMake ≥ 3.22, JUCE (latest via FetchContent — includes a bundled
VST3 SDK; AU hosting uses Apple's system frameworks, no extra SDK needed), Xcode
Command Line Tools (already confirmed present on this machine — `clang` 17, `cmake`
4.2.0).

**Scope note:** This plan covers Phase 0 only (see
`docs/superpowers/specs/2026-07-28-juce-audio-engine-design.md`). Phases 1–5 (native
playback, native export, plugin hosting integrated into the real app, plugin editor
windows, real-time rubberband) each get their own plan once the prior phase's actual
results are in — writing all of them out now, before this toolchain is even proven to
work, would mean planning in the dark.

**Verification bar for this native code:** unlike the TS side of this repo, there is no
existing unit test framework wired up for `native-engine/`. Each task's "does it work"
check is: does it compile cleanly, and does running the resulting binary print the
expected diagnostic output. Task 2 additionally includes one genuinely unit-testable
pure function (path-suffix filtering), consistent with this project's existing
precedent of not forcing tests onto things that are fundamentally
integration-only (see `docs/superpowers/specs/2026-07-27-rifff-arranger-design.md`:
"Native audio + Electron drag-drop aren't practical to meaningfully unit-test").

---

### Task 1: Project scaffolding — CMake + JUCE fetch + hello world

**Files:**
- Create: `native-engine/CMakeLists.txt`
- Create: `native-engine/Source/Main.cpp`
- Create: `native-engine/.gitignore`

- [ ] **Step 1: Create the native-engine directory and a .gitignore for build output**

```bash
mkdir -p native-engine/Source
```

```gitignore
# native-engine/.gitignore
build/
_deps/
```

- [ ] **Step 2: Write the top-level CMakeLists.txt**

```cmake
# native-engine/CMakeLists.txt
cmake_minimum_required(VERSION 3.22)
project(ssstitch_engine VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

include(FetchContent)
FetchContent_Declare(
  JUCE
  GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
  GIT_TAG        8.0.4
  GIT_SHALLOW    TRUE
)
FetchContent_MakeAvailable(JUCE)

juce_add_console_app(ssstitch_engine
  PRODUCT_NAME "ssstitch-engine"
)

target_sources(ssstitch_engine PRIVATE
  Source/Main.cpp
)

target_compile_definitions(ssstitch_engine PRIVATE
  JUCE_USE_CURL=0
  JUCE_WEB_BROWSER=0
)

target_link_libraries(ssstitch_engine PRIVATE
  juce::juce_core
  juce::juce_recommended_config_flags
)
```

- [ ] **Step 3: Write a minimal Main.cpp**

```cpp
// native-engine/Source/Main.cpp
#include <juce_core/juce_core.h>

int main(int argc, char* argv[])
{
    juce::ignoreUnused(argc, argv);
    juce::Logger::writeToLog("ssstitch-engine Phase 0 spike: JUCE core linked OK.");
    return 0;
}
```

- [ ] **Step 4: Configure and build**

Run: `cd native-engine && cmake -B build -DCMAKE_BUILD_TYPE=Debug`
Expected: configure succeeds; the first run will take a few minutes while
`FetchContent` clones JUCE (~a few hundred MB) into `native-engine/build/_deps`.

Run: `cmake --build build`
Expected: builds without errors, producing
`native-engine/build/ssstitch_engine_artefacts/Debug/ssstitch-engine` (exact path may
vary slightly by CMake/JUCE version — check the actual build output for the binary's
real location if this path doesn't exist).

- [ ] **Step 5: Run it and confirm the log line prints**

Run the built binary directly.
Expected: prints `ssstitch-engine Phase 0 spike: JUCE core linked OK.` to stdout (or to
a JUCE log file, depending on platform log routing — check both) and exits 0.

- [ ] **Step 6: Commit**

```bash
git add native-engine/CMakeLists.txt native-engine/Source/Main.cpp native-engine/.gitignore
git commit -m "juce-engine phase0: project scaffolding, JUCE fetched via CMake, hello world"
```

---

### Task 2: Plugin directory scanning (with one genuinely unit-testable piece)

**Files:**
- Create: `native-engine/Source/PluginScanner.h`
- Create: `native-engine/Source/PluginScanner.cpp`
- Create: `native-engine/Source/PluginScannerTests.cpp`
- Modify: `native-engine/CMakeLists.txt`
- Modify: `native-engine/Source/Main.cpp`

- [ ] **Step 1: Write the pure, testable filter function first**

```cpp
// native-engine/Source/PluginScanner.h
#pragma once
#include <juce_core/juce_core.h>

namespace ssstitch
{
    /** True for files/bundles JUCE's plugin formats actually care about — filters an
     * arbitrary directory listing down to plausible plugin candidates before handing
     * them to the (much more expensive, not-unit-testable) real format scanners. */
    bool isPluginCandidate(const juce::String& filename);

    /** Full directory scan using JUCE's own KnownPluginList + AudioPluginFormatManager
     * machinery. Not unit tested directly (depends on what's actually installed on the
     * machine) — exercised via Main.cpp's own printed report instead. */
    juce::Array<juce::PluginDescription> scanForPlugins(
        juce::AudioPluginFormatManager& formatManager,
        const juce::Array<juce::File>& searchPaths);
}
```

- [ ] **Step 2: Implement isPluginCandidate**

```cpp
// native-engine/Source/PluginScanner.cpp
#include "PluginScanner.h"

namespace ssstitch
{
    bool isPluginCandidate(const juce::String& filename)
    {
        return filename.endsWithIgnoreCase(".vst3") || filename.endsWithIgnoreCase(".component");
    }

    juce::Array<juce::PluginDescription> scanForPlugins(
        juce::AudioPluginFormatManager& formatManager,
        const juce::Array<juce::File>& searchPaths)
    {
        juce::Array<juce::PluginDescription> found;
        juce::KnownPluginList knownPlugins;

        for (auto* format : formatManager.getFormats())
        {
            for (const auto& searchPath : searchPaths)
            {
                juce::FileSearchPath path(searchPath.getFullPathName());
                auto candidates = format->searchPathsForPlugins(path, true, true);

                for (const auto& candidate : candidates)
                {
                    juce::OwnedArray<juce::PluginDescription> typesFound;
                    knownPlugins.scanAndAddFile(candidate, false, typesFound, *format);
                    for (auto* desc : typesFound)
                        found.add(*desc);
                }
            }
        }
        return found;
    }
}
```

- [ ] **Step 3: Write the unit test for the pure function**

```cpp
// native-engine/Source/PluginScannerTests.cpp
#include "PluginScanner.h"
#include <juce_core/juce_core.h>

namespace ssstitch
{
    class PluginScannerTests : public juce::UnitTest
    {
    public:
        PluginScannerTests() : juce::UnitTest("PluginScanner") {}

        void runTest() override
        {
            beginTest("isPluginCandidate accepts .vst3 and .component, case-insensitively");
            expect(isPluginCandidate("Foo.vst3"));
            expect(isPluginCandidate("Foo.VST3"));
            expect(isPluginCandidate("Bar.component"));
            expect(isPluginCandidate("Bar.COMPONENT"));

            beginTest("isPluginCandidate rejects everything else");
            expect(!isPluginCandidate("readme.txt"));
            expect(!isPluginCandidate("Foo.vst"));   // VST2, deliberately not supported
            expect(!isPluginCandidate(".DS_Store"));
        }
    };

    static PluginScannerTests pluginScannerTests;
}
```

- [ ] **Step 4: Wire the new sources and a `--test` flag into the build**

```cmake
# native-engine/CMakeLists.txt — add to target_sources(ssstitch_engine PRIVATE ...):
  Source/PluginScanner.cpp
  Source/PluginScannerTests.cpp
```

```cmake
# add to target_link_libraries(ssstitch_engine PRIVATE ...):
  juce::juce_audio_processors
  juce::juce_audio_basics
  juce::juce_audio_utils
```

```cmake
# add near the other target_compile_definitions:
target_compile_definitions(ssstitch_engine PRIVATE
  JUCE_PLUGINHOST_VST3=1
  JUCE_PLUGINHOST_AU=1
)
```

- [ ] **Step 5: Update Main.cpp to run unit tests when invoked with --test**

```cpp
// native-engine/Source/Main.cpp
#include <juce_core/juce_core.h>
#include <juce_audio_processors/juce_audio_processors.h>
#include "PluginScanner.h"

static int runUnitTests()
{
    juce::UnitTestRunner runner;
    runner.runAllTests();

    for (int i = 0; i < runner.getNumResults(); ++i)
    {
        auto* result = runner.getResult(i);
        if (result->failures > 0)
        {
            juce::Logger::writeToLog("FAIL: " + result->unitTestName);
            return 1;
        }
    }
    juce::Logger::writeToLog("All unit tests passed.");
    return 0;
}

int main(int argc, char* argv[])
{
    if (argc > 1 && juce::String(argv[1]) == "--test")
        return runUnitTests();

    juce::Logger::writeToLog("ssstitch-engine Phase 0 spike: JUCE core linked OK.");
    return 0;
}
```

- [ ] **Step 6: Build and run the tests**

Run: `cmake --build build`
Run the built binary with `--test`.
Expected: `All unit tests passed.` and exit code 0. If a test fails, the failure
message names which `expect(...)` didn't hold — fix `PluginScanner.cpp` or the test
itself and rebuild.

- [ ] **Step 7: Commit**

```bash
git add native-engine/Source/PluginScanner.h native-engine/Source/PluginScanner.cpp \
        native-engine/Source/PluginScannerTests.cpp native-engine/CMakeLists.txt \
        native-engine/Source/Main.cpp
git commit -m "juce-engine phase0: plugin candidate filtering + JUCE unit test runner"
```

---

### Task 3: Scan real plugin directories and report what's found

**Files:**
- Modify: `native-engine/Source/Main.cpp`

- [ ] **Step 1: Add a scan-and-report path to Main.cpp**

```cpp
// native-engine/Source/Main.cpp — add above main():
static int runScanReport()
{
    juce::AudioPluginFormatManager formatManager;
    formatManager.addDefaultFormats(); // registers VST3 + AU given the build flags set

    juce::Array<juce::File> searchPaths {
        juce::File("/Library/Audio/Plug-Ins/VST3"),
        juce::File("/Library/Audio/Plug-Ins/Components"),
        juce::File("~/Library/Audio/Plug-Ins/VST3").getFullPathName(),
        juce::File("~/Library/Audio/Plug-Ins/Components").getFullPathName()
    };

    auto found = ssstitch::scanForPlugins(formatManager, searchPaths);
    juce::Logger::writeToLog("Found " + juce::String(found.size()) + " plugin(s):");
    for (const auto& desc : found)
        juce::Logger::writeToLog("  [" + desc.pluginFormatName + "] " + desc.name
            + " (" + desc.manufacturerName + ")");

    return found.isEmpty() ? 1 : 0;
}
```

```cpp
// in main(), add a branch before the default log line:
    if (argc > 1 && juce::String(argv[1]) == "--scan")
        return runScanReport();
```

- [ ] **Step 2: Build and run the scan**

Run: `cmake --build build`
Run the built binary with `--scan`.
Expected: prints a non-empty list including at least the plugins already confirmed
installed on this machine (e.g. entries under `/Library/Audio/Plug-Ins/VST3` and
`/Library/Audio/Plug-Ins/Components`). This step can take a while the first time —
JUCE's scanner instantiates each plugin briefly to read its metadata.

If it prints 0 plugins found: check that `JUCE_PLUGINHOST_VST3`/`JUCE_PLUGINHOST_AU`
are actually defined for this build (step back to Task 2 Step 4), and that the search
paths above match where `ls /Library/Audio/Plug-Ins/VST3` showed real files earlier in
this session.

- [ ] **Step 3: Commit**

```bash
git add native-engine/Source/Main.cpp
git commit -m "juce-engine phase0: scan and report installed VST3/AU plugins"
```

---

### Task 4: Load one VST3 and one AU, process a test buffer through each

**Files:**
- Modify: `native-engine/Source/Main.cpp`

- [ ] **Step 1: Add a load-and-process helper**

```cpp
// native-engine/Source/Main.cpp — add above main():
static bool loadAndProcessOne(
    juce::AudioPluginFormatManager& formatManager,
    const juce::PluginDescription& desc)
{
    juce::String errorMessage;
    auto instance = formatManager.createPluginInstance(desc, 44100.0, 512, errorMessage);

    if (instance == nullptr)
    {
        juce::Logger::writeToLog("  FAILED to load \"" + desc.name + "\": " + errorMessage);
        return false;
    }

    instance->prepareToPlay(44100.0, 512);

    juce::AudioBuffer<float> buffer(
        juce::jmax(1, instance->getTotalNumInputChannels()), 512);
    buffer.clear();
    // A quiet test tone rather than silence, so a plugin that only reacts to
    // non-zero input still has something to actually process.
    for (int ch = 0; ch < buffer.getNumChannels(); ++ch)
        for (int i = 0; i < buffer.getNumSamples(); ++i)
            buffer.setSample(ch, i, 0.1f * std::sin(i * 0.1f));

    juce::MidiBuffer midi;
    instance->processBlock(buffer, midi);

    instance->releaseResources();

    juce::Logger::writeToLog("  OK: \"" + desc.name + "\" processed "
        + juce::String(buffer.getNumSamples()) + " samples, "
        + juce::String(instance->getTotalNumOutputChannels()) + " output channel(s).");
    return true;
}
```

- [ ] **Step 2: Add a --spike mode that scans, then loads the first VST3 and first AU found**

```cpp
// native-engine/Source/Main.cpp — add above main():
static int runSpike()
{
    juce::AudioPluginFormatManager formatManager;
    formatManager.addDefaultFormats();

    juce::Array<juce::File> searchPaths {
        juce::File("/Library/Audio/Plug-Ins/VST3"),
        juce::File("/Library/Audio/Plug-Ins/Components")
    };
    auto found = ssstitch::scanForPlugins(formatManager, searchPaths);

    const juce::PluginDescription* firstVst3 = nullptr;
    const juce::PluginDescription* firstAu = nullptr;
    for (const auto& desc : found)
    {
        if (firstVst3 == nullptr && desc.pluginFormatName == "VST3")
            firstVst3 = &desc;
        if (firstAu == nullptr && desc.pluginFormatName == "AudioUnit")
            firstAu = &desc;
    }

    bool vst3Ok = false, auOk = false;

    if (firstVst3 != nullptr)
    {
        juce::Logger::writeToLog("Loading VST3: " + firstVst3->name);
        vst3Ok = loadAndProcessOne(formatManager, *firstVst3);
    }
    else
    {
        juce::Logger::writeToLog("No VST3 plugin found to test.");
    }

    if (firstAu != nullptr)
    {
        juce::Logger::writeToLog("Loading AU: " + firstAu->name);
        auOk = loadAndProcessOne(formatManager, *firstAu);
    }
    else
    {
        juce::Logger::writeToLog("No AU plugin found to test.");
    }

    juce::Logger::writeToLog(juce::String("Phase 0 spike result: VST3=")
        + (vst3Ok ? "PASS" : "FAIL") + ", AU=" + (auOk ? "PASS" : "FAIL"));

    return (vst3Ok && auOk) ? 0 : 1;
}
```

```cpp
// in main(), add a branch:
    if (argc > 1 && juce::String(argv[1]) == "--spike")
        return runSpike();
```

- [ ] **Step 3: Build and run the full spike**

Run: `cmake --build build`
Run the built binary with `--spike`.
Expected final line: `Phase 0 spike result: VST3=PASS, AU=PASS`, exit code 0.

If a specific plugin fails to load (some plugins expect to run inside a full DAW
session and reject unfamiliar hosts, or need license/authorization checks) — that's a
real, useful spike finding, not a bug in this code. Note which plugin failed and why in
the task's completion notes, and consider trying a different installed plugin as the
"first" one instead (e.g., hardcode a specific known-good plugin name temporarily to
unblock the spike, then revert once a plugin that Just Works has been confirmed).

- [ ] **Step 4: Commit**

```bash
git add native-engine/Source/Main.cpp
git commit -m "juce-engine phase0: load and process a real VST3 + AU plugin — spike complete"
```

---

### Task 5: Write up spike findings

**Files:**
- Create: `native-engine/PHASE0_FINDINGS.md`

- [ ] **Step 1: Document what actually happened**

Write a short findings doc covering: which plugins were successfully loaded and
processed, the exact JUCE version pinned in CMakeLists.txt, how long the FetchContent
build took (relevant for CI/dev-onboarding expectations later), any plugin-specific
quirks hit in Task 4, and confirmation that both `JUCE_PLUGINHOST_VST3` and
`JUCE_PLUGINHOST_AU` paths work end to end on this machine. This is the actual
deliverable Phase 1's plan will be written against.

- [ ] **Step 2: Commit**

```bash
git add native-engine/PHASE0_FINDINGS.md
git commit -m "juce-engine phase0: findings write-up"
```
