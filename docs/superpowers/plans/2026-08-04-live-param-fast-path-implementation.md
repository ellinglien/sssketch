# Live Volume/Fade Fast Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the full-project-reload mechanism for live volume/fade drag updates (confirmed
to cause real audio glitching during manual testing) with a lightweight, targeted native IPC path
that updates just the one changed value.

**Architecture:** A new native class, `LiveParamOverrides`, holds three independently-published
maps (volume/fadeIn/fadeOut), mirroring `PlaybackEngine`'s own already-proven atomic-shared_ptr
publish pattern. `renderBlock()` checks these maps for an override before falling back to the
snapshot's own committed value. A new minimal IPC message (`set-live-param`) lets the renderer
push just one value, bypassing `buildEngineProject`/`setProject()` entirely. Overrides are never
explicitly cleared by the renderer — they're cleared automatically, as a side effect, every time
`IpcServer`'s existing `load-project` handler runs (which already happens once per drag's final
commit), guaranteeing the handoff between "live override" and "official committed value" is
always inaudible.

**Tech Stack:** JUCE/C++ (native engine), TypeScript/React (renderer), JUCE `UnitTestRunner`,
Vitest.

---

### Task 1: Native — `LiveParamOverrides` class + unit tests

**Files:**
- Create: `native-engine/Source/LiveParamOverrides.h`
- Create: `native-engine/Source/LiveParamOverrides.cpp`
- Create: `native-engine/Source/LiveParamOverridesTests.cpp`
- Modify: `native-engine/CMakeLists.txt`

- [ ] **Step 1: Create the header**

Write `native-engine/Source/LiveParamOverrides.h`:

```cpp
// native-engine/Source/LiveParamOverrides.h
#pragma once
#include <atomic>
#include <juce_core/juce_core.h>
#include <memory>
#include <optional>
#include <unordered_map>

namespace sssketch
{
    /** Holds in-progress "live" parameter values for an active volume/fade
     * drag, entirely separate from EngineProject/PlaybackEngine's own
     * published ProjectSnapshot -- see docs/superpowers/specs/
     * 2026-08-04-live-param-fast-path-design.md. Exists because pushing a
     * live value through a full setProject() reload (rebuilding the whole
     * project's scheduling state from scratch) at drag frequency (up to
     * ~60Hz) turned out to cause real, audible glitching -- confirmed by
     * manual testing, not theoretical. This class lets the message thread
     * update just one value at a time, cheaply, while the audio thread
     * checks for an override alongside its normal (committed) reads.
     *
     * Three independently-published maps -- volume keyed by stemKey
     * (EngineStem::stemKey), fadeIn/fadeOut each keyed by groupId
     * (EngineRifff::groupId) -- mirroring PlaybackEngine's own `published`
     * field pattern exactly: a plain std::shared_ptr<const
     * std::unordered_map<...>>, accessed only via
     * std::atomic_load_explicit/atomic_store_explicit (NOT
     * std::atomic<std::shared_ptr<T>>, the C++20 built-in specialization --
     * confirmed unavailable in this project's libc++ during the
     * live-drag-preview work, since it requires the held type to be
     * trivially copyable). Each setter rebuilds a small new map (1-8
     * entries typically, matching however many stems are in the dragged
     * rifff) and publishes it -- still dramatically cheaper than a full
     * project reload, since nothing about the rest of the project is
     * touched.
     *
     * clearAll() is called by IpcServer's own load-project handler, right
     * after every setProject() call -- that's the ENTIRE mechanism by
     * which a live override eventually gets cleared. No explicit "clear"
     * call from the renderer's own drag handlers is needed or sent: the
     * override holds the exact final dragged value for as long as it
     * takes the drag's own commit dispatch to trigger a full reload
     * (already guaranteed, since the committed fields are already in that
     * effect's dependency array), and since the override and the eventual
     * reload always agree on the value by construction, the handoff
     * between them is inaudible. */
    class LiveParamOverrides
    {
    public:
        LiveParamOverrides();

        LiveParamOverrides(const LiveParamOverrides&) = delete;
        LiveParamOverrides& operator=(const LiveParamOverrides&) = delete;

        /** Message-thread API. value == std::nullopt clears that one key
         * (kept for symmetry/testability -- the renderer's own drag
         * handlers never need to call with std::nullopt, see this class's
         * own doc comment on clearAll() above). */
        void setVolumeOverride(const juce::String& stemKey, std::optional<float> value);
        void setFadeInOverride(const juce::String& groupId, std::optional<float> value);
        void setFadeOutOverride(const juce::String& groupId, std::optional<float> value);

        /** Message-thread API: clears all three maps at once. */
        void clearAll();

        /** Audio-thread API: std::nullopt means "no override, use the
         * committed value." One atomic load + one hash lookup each, never
         * blocks (mirrors PlaybackEngine's own atomic_load_explicit
         * usage), never allocates. */
        std::optional<float> volumeFor(const juce::String& stemKey) const;
        std::optional<float> fadeInFor(const juce::String& groupId) const;
        std::optional<float> fadeOutFor(const juce::String& groupId) const;

    private:
        using OverrideMap = std::unordered_map<juce::String, float>;

        static void setOverride(
            std::shared_ptr<const OverrideMap>& published,
            const juce::String& key,
            std::optional<float> value);
        static std::optional<float> overrideFor(
            const std::shared_ptr<const OverrideMap>& published,
            const juce::String& key);

        std::shared_ptr<const OverrideMap> volumeOverrides;
        std::shared_ptr<const OverrideMap> fadeInOverrides;
        std::shared_ptr<const OverrideMap> fadeOutOverrides;
    };
}
```

- [ ] **Step 2: Create the implementation**

Write `native-engine/Source/LiveParamOverrides.cpp`:

```cpp
// native-engine/Source/LiveParamOverrides.cpp
#include "LiveParamOverrides.h"

namespace sssketch
{
    LiveParamOverrides::LiveParamOverrides()
        : volumeOverrides(std::make_shared<const OverrideMap>()),
          fadeInOverrides(std::make_shared<const OverrideMap>()),
          fadeOutOverrides(std::make_shared<const OverrideMap>())
    {
        // Plain (non-atomic) initialization is safe here -- no other thread
        // can possibly observe `this` until construction completes and a
        // reference is handed out, matching PlaybackEngine's own
        // constructor's identical reasoning for its `published` field.
    }

    void LiveParamOverrides::setOverride(
        std::shared_ptr<const OverrideMap>& published,
        const juce::String& key,
        std::optional<float> value)
    {
        const auto current = std::atomic_load_explicit(&published, std::memory_order_acquire);
        auto next = std::make_shared<OverrideMap>(*current);
        if (value.has_value())
            (*next)[key] = *value;
        else
            next->erase(key);
        std::atomic_store_explicit(
            &published, std::shared_ptr<const OverrideMap>(std::move(next)), std::memory_order_release);
    }

    std::optional<float> LiveParamOverrides::overrideFor(
        const std::shared_ptr<const OverrideMap>& published,
        const juce::String& key)
    {
        const auto current = std::atomic_load_explicit(&published, std::memory_order_acquire);
        const auto it = current->find(key);
        if (it == current->end())
            return std::nullopt;
        return it->second;
    }

    void LiveParamOverrides::setVolumeOverride(const juce::String& stemKey, std::optional<float> value)
    {
        setOverride(volumeOverrides, stemKey, value);
    }

    void LiveParamOverrides::setFadeInOverride(const juce::String& groupId, std::optional<float> value)
    {
        setOverride(fadeInOverrides, groupId, value);
    }

    void LiveParamOverrides::setFadeOutOverride(const juce::String& groupId, std::optional<float> value)
    {
        setOverride(fadeOutOverrides, groupId, value);
    }

    void LiveParamOverrides::clearAll()
    {
        // Every one of these three assignments MUST go through
        // atomic_store_explicit, not a plain `=` -- the audio thread may be
        // concurrently reading any of them via atomic_load_explicit at any
        // time. A plain assignment here would be exactly the class of bug
        // PlaybackEngine's own project-handoff hardening (see
        // docs/superpowers/plans/2026-08-04-live-drag-preview-implementation.md's
        // Task 4/5 correction) fixed -- don't reintroduce it here.
        std::atomic_store_explicit(
            &volumeOverrides, std::make_shared<const OverrideMap>(), std::memory_order_release);
        std::atomic_store_explicit(
            &fadeInOverrides, std::make_shared<const OverrideMap>(), std::memory_order_release);
        std::atomic_store_explicit(
            &fadeOutOverrides, std::make_shared<const OverrideMap>(), std::memory_order_release);
    }

    std::optional<float> LiveParamOverrides::volumeFor(const juce::String& stemKey) const
    {
        return overrideFor(volumeOverrides, stemKey);
    }

    std::optional<float> LiveParamOverrides::fadeInFor(const juce::String& groupId) const
    {
        return overrideFor(fadeInOverrides, groupId);
    }

    std::optional<float> LiveParamOverrides::fadeOutFor(const juce::String& groupId) const
    {
        return overrideFor(fadeOutOverrides, groupId);
    }
}
```

- [ ] **Step 3: Write the unit tests**

Write `native-engine/Source/LiveParamOverridesTests.cpp`:

```cpp
// native-engine/Source/LiveParamOverridesTests.cpp
#include "LiveParamOverrides.h"
#include <juce_core/juce_core.h>

namespace sssketch
{
    class LiveParamOverridesTests : public juce::UnitTest
    {
    public:
        LiveParamOverridesTests() : juce::UnitTest("LiveParamOverrides") {}

        void runTest() override
        {
            beginTest("volumeFor returns nullopt when no override is set");
            {
                LiveParamOverrides overrides;
                expect(!overrides.volumeFor("r1:1").has_value());
            }

            beginTest("setVolumeOverride then volumeFor returns the set value");
            {
                LiveParamOverrides overrides;
                overrides.setVolumeOverride("r1:1", 0.3f);
                const auto value = overrides.volumeFor("r1:1");
                expect(value.has_value());
                expectWithinAbsoluteError(*value, 0.3f, 0.0001f);
            }

            beginTest("setVolumeOverride with nullopt clears the override");
            {
                LiveParamOverrides overrides;
                overrides.setVolumeOverride("r1:1", 0.3f);
                overrides.setVolumeOverride("r1:1", std::nullopt);
                expect(!overrides.volumeFor("r1:1").has_value());
            }

            beginTest("fadeIn/fadeOut overrides are independent of volume and each other");
            {
                LiveParamOverrides overrides;
                overrides.setFadeInOverride("r1", 1.5f);
                overrides.setFadeOutOverride("r1", 0.5f);
                expect(!overrides.volumeFor("r1").has_value());
                const auto fadeIn = overrides.fadeInFor("r1");
                const auto fadeOut = overrides.fadeOutFor("r1");
                expect(fadeIn.has_value());
                expect(fadeOut.has_value());
                expectWithinAbsoluteError(*fadeIn, 1.5f, 0.0001f);
                expectWithinAbsoluteError(*fadeOut, 0.5f, 0.0001f);
            }

            beginTest("different keys don't affect each other");
            {
                LiveParamOverrides overrides;
                overrides.setVolumeOverride("r1:1", 0.3f);
                overrides.setVolumeOverride("r2:1", 0.9f);
                expectWithinAbsoluteError(*overrides.volumeFor("r1:1"), 0.3f, 0.0001f);
                expectWithinAbsoluteError(*overrides.volumeFor("r2:1"), 0.9f, 0.0001f);
            }

            beginTest("clearAll empties every map at once");
            {
                LiveParamOverrides overrides;
                overrides.setVolumeOverride("r1:1", 0.3f);
                overrides.setFadeInOverride("r1", 1.5f);
                overrides.setFadeOutOverride("r1", 0.5f);
                overrides.clearAll();
                expect(!overrides.volumeFor("r1:1").has_value());
                expect(!overrides.fadeInFor("r1").has_value());
                expect(!overrides.fadeOutFor("r1").has_value());
            }
        }
    };

    static LiveParamOverridesTests liveParamOverridesTests;
}
```

- [ ] **Step 4: Add both new files to the build**

In `native-engine/CMakeLists.txt`, inside the existing `target_sources(sssketch_engine PRIVATE ...)`
block, add two lines right after `Source/LoopRecorderTests.cpp` (the current last two lines
before the closing `)`):

```cmake
  Source/LoopRecorder.cpp
  Source/LoopRecorderTests.cpp
  Source/LiveParamOverrides.cpp
  Source/LiveParamOverridesTests.cpp
)
```

- [ ] **Step 5: Build and run the tests**

Run (from `native-engine/`): `cmake -B build 2>&1 | tail -20` (re-run configure since new source
files were added — a plain `cmake --build build` alone won't pick up the CMakeLists.txt change).
Run: `cmake --build build 2>&1 | tail -40`
Expected: clean build.

Run: `native-engine/build/sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine --test 2>&1 | tail -20`
Expected: `All unit tests passed.`, including all 6 new `LiveParamOverrides` tests.

- [ ] **Step 6: Commit**

```bash
git add native-engine/Source/LiveParamOverrides.h native-engine/Source/LiveParamOverrides.cpp native-engine/Source/LiveParamOverridesTests.cpp native-engine/CMakeLists.txt
git commit -m "Add LiveParamOverrides: a lightweight, atomically-published store for live volume/fade values"
```

---

### Task 2: Native — `PlaybackEngine` integration

**Files:**
- Modify: `native-engine/Source/PlaybackEngine.h`
- Modify: `native-engine/Source/PlaybackEngine.cpp`
- Modify: `native-engine/Source/PlaybackEngineTests.cpp`

This is the task that actually makes `renderBlock()` real-time-audio-thread-safe to consult
`LiveParamOverrides` — treat it with the same care as the earlier project-snapshot hardening.

- [ ] **Step 1: Add `liveOverrides()` accessors and a member to `PlaybackEngine.h`**

Add `#include "LiveParamOverrides.h"` to the includes at the top of
`native-engine/Source/PlaybackEngine.h`, alongside the existing `#include "EngineProject.h"` etc.

Add these two public methods, right after the existing `isMetronomeEnabled()` method (before the
`private:` section):

```cpp
        /** Message-thread API: called by IpcServer's set-live-param handler
         * to push a new live volume/fade value, and by its load-project
         * handler to clear all overrides once a fresh project has been
         * published -- see LiveParamOverrides's own doc comment. */
        LiveParamOverrides& liveOverrides() { return liveParamOverrides; }

        /** Audio-thread API: renderBlock() reads through this const
         * overload. */
        const LiveParamOverrides& liveOverrides() const { return liveParamOverrides; }
```

Add the member itself, right after the existing `bool metronomeEnabled = false;` line in the
`private:` section:

```cpp
        LiveParamOverrides liveParamOverrides;
```

- [ ] **Step 2: Write the failing tests**

Add these test cases to `native-engine/Source/PlaybackEngineTests.cpp`, right after the existing
`"a non-finite leftCropBars falls back to no crop instead of corrupting tile math"` test (or
wherever the volume/fade-adjacent tests currently end — search for `beginTest("a later repeat of
a looping stem` to find a landmark right before where these should go):

```cpp
            beginTest("renderBlock() prefers a live volume override over the committed stem volume");
            {
                auto rampFixture = writeFixtureWav("sssketch_pe_liveoverride_vol.wav", 0.5f, 44100);
                EngineProject project;
                project.bpm = 60.0;
                project.snapDiv = 16.0;
                EngineRifff rifff;
                rifff.startBar = 0.0;
                rifff.barLength = 4;
                EngineStem stem;
                stem.stemKey = "r1:1";
                stem.resolvedPath = rampFixture.getFullPathName();
                stem.durationSec = 4.0;
                stem.barLength = 4;
                stem.playedBars = 4.0;
                stem.volume = 0.2; // committed, quiet
                rifff.stems.push_back(stem);
                project.rifffs.push_back(rifff);

                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry channelChains;
                engine.setProject(project);
                engine.liveOverrides().setVolumeOverride("r1:1", 0.9f);

                // 200 samples, not 4 -- see the crop-trim plan's own note on
                // FadeGain.cpp's kMicroFadeSec (3ms click-guard fade-in on
                // every fresh segment start): checking l[0] would measure
                // that unrelated fade, not this test's own subject.
                std::vector<float> l(200, 0.0f), r(200, 0.0f);
                engine.renderBlock(0.0, 44100.0, 200, l.data(), r.data(), channelChains);

                // 0.5 (fixture) * 0.9 (override) = 0.45 -- would be
                // 0.5 * 0.2 = 0.1 without the override.
                expect(l[199] > 0.4f);

                rampFixture.deleteFile();
            }

            beginTest("renderBlock() falls back to the committed stem volume when no override is set");
            {
                auto rampFixture = writeFixtureWav("sssketch_pe_nooverride_vol.wav", 0.5f, 44100);
                EngineProject project;
                project.bpm = 60.0;
                project.snapDiv = 16.0;
                EngineRifff rifff;
                rifff.startBar = 0.0;
                rifff.barLength = 4;
                EngineStem stem;
                stem.stemKey = "r1:1";
                stem.resolvedPath = rampFixture.getFullPathName();
                stem.durationSec = 4.0;
                stem.barLength = 4;
                stem.playedBars = 4.0;
                stem.volume = 0.2;
                rifff.stems.push_back(stem);
                project.rifffs.push_back(rifff);

                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry channelChains;
                engine.setProject(project);
                // No override set.

                std::vector<float> l(200, 0.0f), r(200, 0.0f);
                engine.renderBlock(0.0, 44100.0, 200, l.data(), r.data(), channelChains);
                expectWithinAbsoluteError(l[199], 0.1f, 0.02f); // 0.5 * 0.2

                rampFixture.deleteFile();
            }

            beginTest("a live volume override makes an otherwise-silent stem (committed volume 0) audible");
            {
                // Regression test for a specific ordering requirement: the
                // override must be resolved BEFORE the
                // `stem.muted || effectiveVolume <= 0.0` skip check, not
                // after -- otherwise a stem with committed volume 0 could
                // never be woken up by a live override at all.
                auto rampFixture = writeFixtureWav("sssketch_pe_liveoverride_wake.wav", 0.5f, 44100);
                EngineProject project;
                project.bpm = 60.0;
                project.snapDiv = 16.0;
                EngineRifff rifff;
                rifff.startBar = 0.0;
                rifff.barLength = 4;
                EngineStem stem;
                stem.stemKey = "r1:1";
                stem.resolvedPath = rampFixture.getFullPathName();
                stem.durationSec = 4.0;
                stem.barLength = 4;
                stem.playedBars = 4.0;
                stem.volume = 0.0; // committed silence
                rifff.stems.push_back(stem);
                project.rifffs.push_back(rifff);

                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry channelChains;
                engine.setProject(project);
                engine.liveOverrides().setVolumeOverride("r1:1", 0.7f);

                std::vector<float> l(200, 0.0f), r(200, 0.0f);
                engine.renderBlock(0.0, 44100.0, 200, l.data(), r.data(), channelChains);
                expect(l[199] > 0.3f); // 0.5 * 0.7 = 0.35 -- would be 0.0 without the override rescuing it from the skip

                rampFixture.deleteFile();
            }

            beginTest("renderBlock() prefers a live fadeIn override over the committed rifff.fadeInBars");
            {
                auto rampFixture = writeFixtureWav("sssketch_pe_liveoverride_fadein.wav", 0.5f, 44100);
                EngineProject project;
                project.bpm = 60.0; // secPerBar = 4.0
                project.snapDiv = 16.0;
                EngineRifff rifff;
                rifff.startBar = 0.0;
                rifff.barLength = 4;
                rifff.groupId = "r1";
                rifff.fadeInBars = 2.0; // committed: an 8-second fade-in -- early samples near-silent
                EngineStem stem;
                stem.stemKey = "r1:1";
                stem.resolvedPath = rampFixture.getFullPathName();
                stem.durationSec = 4.0;
                stem.barLength = 4;
                stem.playedBars = 4.0;
                stem.volume = 1.0;
                rifff.stems.push_back(stem);
                project.rifffs.push_back(rifff);

                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry channelChains;
                engine.setProject(project);
                engine.liveOverrides().setFadeInOverride("r1", 0.0f); // override: no fade-in

                std::vector<float> l(200, 0.0f), r(200, 0.0f);
                engine.renderBlock(0.0, 44100.0, 200, l.data(), r.data(), channelChains);
                // Past the unrelated 3ms micro-fade, should be near the
                // fixture's own 0.5 value -- NOT suppressed by the
                // committed 2-bar fade-in, since the override replaces it.
                expect(l[199] > 0.4f);

                rampFixture.deleteFile();
            }
```

- [ ] **Step 3: Run the tests to verify they fail**

Run (from `native-engine/`): `cmake --build build 2>&1 | tail -40`
Expected: build FAILS -- `engine.liveOverrides()` doesn't exist yet on `PlaybackEngine` (Step 1
of this task hasn't been wired into `renderBlock()`'s own logic yet, only the accessor exists).

Actually: since Step 1 already added the `liveOverrides()` accessors, the build itself will
succeed, but the 4 new tests will FAIL at runtime (the override is set but `renderBlock()` doesn't
consult it yet, so every test observes the committed/unoverridden behavior instead). Run:
`native-engine/build/sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine --test 2>&1 | tail -30`
Expected: the 4 new tests FAIL (e.g. the first one sees `l[199]` around 0.1, not > 0.4).

- [ ] **Step 4: Wire `renderBlock()` to consult the overrides**

In `native-engine/Source/PlaybackEngine.cpp`, replace:

```cpp
            for (const auto* rifffPtr : rifffPtrs)
            {
            const auto& rifff = *rifffPtr;
            const FadeConfig fadeConfig { rifff.fadeInBars, rifff.fadeOutBars, spb };

            for (const auto& stem : rifff.stems)
            {
                if (stem.muted || stem.volume <= 0.0)
                    continue;
```

with:

```cpp
            for (const auto* rifffPtr : rifffPtrs)
            {
            const auto& rifff = *rifffPtr;
            // Prefers a live drag-override over the committed
            // fadeInBars/fadeOutBars, exactly like effectiveVolume below
            // does for stem.volume -- see LiveParamOverrides.h's own doc
            // comment. Falls back to the committed value when no drag is
            // currently touching this rifff's own fades.
            const FadeConfig fadeConfig {
                liveParamOverrides.fadeInFor(rifff.groupId).value_or(rifff.fadeInBars),
                liveParamOverrides.fadeOutFor(rifff.groupId).value_or(rifff.fadeOutBars),
                spb
            };

            for (const auto& stem : rifff.stems)
            {
                // Prefers a live volume-drag override over the committed
                // stem.volume -- see LiveParamOverrides.h's own doc
                // comment. Read once per stem, used for both the mute/
                // silence check below and every gain multiplication in
                // this stem's own one-shot/tile-loop branch, so a live
                // override can both silence an audible stem AND make a
                // fully-silent one (committed volume 0) audible again --
                // this MUST be resolved before the skip check below, not
                // after.
                const double effectiveVolume = liveParamOverrides.volumeFor(stem.stemKey).value_or(stem.volume);
                if (stem.muted || effectiveVolume <= 0.0)
                    continue;
```

Then replace both remaining `stem.volume` reads (the one-shot branch's gain calculation and the
tile-loop branch's gain calculation) with `effectiveVolume`. Replace:

```cpp
                        const double gain = evaluateGainAtTime(fadePoints, sampleTimeSec) * stem.volume;
```

with (this exact line appears TWICE in the file -- once inside the one-shot branch, once inside
the tile-loop branch's per-sample loop -- replace BOTH occurrences):

```cpp
                        const double gain = evaluateGainAtTime(fadePoints, sampleTimeSec) * effectiveVolume;
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cmake --build build 2>&1 | tail -40`
Expected: clean build.

Run: `native-engine/build/sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine --test 2>&1 | tail -30`
Expected: `All unit tests passed.` -- including the 4 new tests, AND every pre-existing test
(since `liveParamOverrides` starts empty, every formula above reduces exactly to the prior
behavior when no override is set -- any pre-existing test newly failing means a mistake in this
step, not a legitimate behavior change).

- [ ] **Step 6: Add the concurrent stress test**

Add this test to `native-engine/Source/PlaybackEngineTests.cpp`, right after the 4 tests just
added:

```cpp
            beginTest("concurrent setVolumeOverride() and renderBlock() calls do not crash");
            {
                // Mirrors the existing "concurrent setProject() and
                // renderBlock() calls do not crash" stress test -- same
                // reasoning, applied to LiveParamOverrides' own atomic
                // shared_ptr publish mechanism (the exact pattern already
                // proven correct there).
                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry channelChains;

                EngineProject project;
                project.bpm = 120.0;
                project.snapDiv = 16.0;
                EngineRifff rifff;
                rifff.startBar = 0.0;
                rifff.barLength = 4;
                EngineStem stem;
                stem.stemKey = "r1:1";
                stem.resolvedPath = "/nonexistent.wav"; // never actually decoded, see StemBufferCache::load's own doc comment
                stem.durationSec = 4.0;
                stem.barLength = 4;
                stem.playedBars = 4.0;
                rifff.stems.push_back(stem);
                project.rifffs.push_back(rifff);
                engine.setProject(project);

                std::atomic<bool> stop { false };
                std::thread overrideThread([&]() {
                    float v = 0.0f;
                    while (!stop.load())
                    {
                        v = std::fmod(v + 0.01f, 1.0f);
                        engine.liveOverrides().setVolumeOverride("r1:1", v);
                    }
                });

                std::thread renderThread([&]() {
                    std::vector<float> l(512, 0.0f), r(512, 0.0f);
                    double positionBars = 0.0;
                    const double secPerBar = (60.0 / project.bpm) * 4.0;
                    for (int i = 0; i < 20000; ++i)
                    {
                        l.assign(512, 0.0f);
                        r.assign(512, 0.0f);
                        engine.renderBlock(positionBars, 44100.0, 512, l.data(), r.data(), channelChains);
                        positionBars += (512.0 / 44100.0) / secPerBar;
                    }
                });

                renderThread.join();
                stop = true;
                overrideThread.join();

                // Reaching here at all -- no crash, no hang -- is the
                // actual assertion.
                expect(true);
            }
```

Confirm `#include <atomic>` and `#include <thread>` are already present at the top of
`PlaybackEngineTests.cpp` (they were added for the earlier concurrent-`setProject` stress test) --
if not, add them.

- [ ] **Step 7: Build and run the full suite, multiple times**

Run: `cmake --build build 2>&1 | tail -40`
Expected: clean build.

Run 3 times in a row:
```bash
for i in 1 2 3; do
  native-engine/build/sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine --test 2>&1 | tail -3
done
```
Expected: `All unit tests passed.` on every run.

- [ ] **Step 8: Commit**

```bash
git add native-engine/Source/PlaybackEngine.h native-engine/Source/PlaybackEngine.cpp native-engine/Source/PlaybackEngineTests.cpp
git commit -m "PlaybackEngine: consult LiveParamOverrides for live volume/fade values"
```

---

### Task 3: Native — `set-live-param` IPC message + auto-clear on reload

**Files:**
- Modify: `native-engine/Source/IpcServer.cpp`

- [ ] **Step 1: Add the `set-live-param` handler**

In `native-engine/Source/IpcServer.cpp`'s `IpcConnection::messageReceived`, add a new `else if`
branch, right after the existing `else if (type == "set-loop-region")` block (find it by
searching for that exact string -- it ends with `transport.setRecordingLoop(startBar, endBar);`
followed by a closing `}`):

```cpp
        else if (type == "set-live-param")
        {
            // Bypasses EngineProject/setProject() entirely -- see
            // LiveParamOverrides.h's own doc comment for why. `value < 0`
            // means "clear this key," matching this wire format's existing
            // sentinel convention for "unset" numeric fields (e.g.
            // EngineStem::startBarOverride/trimEndSec both use -1 the same
            // way) rather than encoding a separate JSON null case.
            if (payload.isObject())
            {
                const auto field = payload.getProperty("field", "").toString();
                const auto key = payload.getProperty("key", "").toString();
                const double rawValue = (double) payload.getProperty("value", -1.0);
                const std::optional<float> value =
                    rawValue < 0.0 ? std::nullopt : std::optional<float>((float) rawValue);
                if (field == "volume")
                    engine.liveOverrides().setVolumeOverride(key, value);
                else if (field == "fadeIn")
                    engine.liveOverrides().setFadeInOverride(key, value);
                else if (field == "fadeOut")
                    engine.liveOverrides().setFadeOutOverride(key, value);
            }
        }
```

- [ ] **Step 2: Add `#include <optional>`**

Confirm `#include <optional>` is available (it's already included transitively via
`LiveParamOverrides.h`, itself included via `PlaybackEngine.h`, already included at the top of
`IpcServer.cpp` -- no new include needed, but double check by searching for `#include
"PlaybackEngine.h"` near the top of the file to confirm).

- [ ] **Step 3: Auto-clear overrides on every full reload**

In the same file, find the existing `load-project` handler (search for `if (type ==
"load-project")`). Right after the line `engine.setProject(project);`, add one line:

```cpp
                engine.setProject(project);
                engine.liveOverrides().clearAll();
```

- [ ] **Step 4: Build and run the full test suite**

Run (from `native-engine/`): `cmake --build build 2>&1 | tail -40`
Expected: clean build.

Run: `native-engine/build/sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine --test 2>&1 | tail -10`
Expected: `All unit tests passed.` -- no `IpcServer`-specific automated tests exist in this
codebase (IPC message handling is verified manually, per this project's own testing
conventions), so this step is a regression check confirming the change compiles and doesn't
break anything else, not a direct test of the new handler.

- [ ] **Step 5: Commit**

```bash
git add native-engine/Source/IpcServer.cpp
git commit -m "IpcServer: handle set-live-param, auto-clear live overrides on every full reload"
```

---

### Task 4: Renderer — `engineSetLiveParam` bridge (main/preload/engineClient)

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/main/index.ts`

- [ ] **Step 1: Add the preload bridge function**

In `src/preload/index.ts`, add to the `api` object, right after the existing `engineSetPosition`
entry:

```ts
  engineSetPosition: (pos: number): Promise<void> => ipcRenderer.invoke('engine-set-position', pos),
  engineSetLiveParam: (
    field: 'volume' | 'fadeIn' | 'fadeOut',
    key: string,
    value: number
  ): Promise<void> => ipcRenderer.invoke('engine-set-live-param', field, key, value),
```

(Only the new `engineSetLiveParam` entry is being added -- `engineSetPosition` above it is shown
for placement context and is already there, unchanged.)

- [ ] **Step 2: Add the main-process IPC handler**

In `src/main/index.ts`, add a new `ipcMain.handle` call, right after the existing
`'engine-set-position'` handler:

```ts
  ipcMain.handle('engine-set-position', (_event, pos: number) => {
    playbackEngine?.client.send('set-position', { pos })
  })

  ipcMain.handle(
    'engine-set-live-param',
    (_event, field: 'volume' | 'fadeIn' | 'fadeOut', key: string, value: number) => {
      playbackEngine?.client.send('set-live-param', { field, key, value })
    }
  )
```

(Only the new `'engine-set-live-param'` handler is being added -- `'engine-set-position'` above
it is shown for placement context and is already there, unchanged.)

- [ ] **Step 3: Run typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/preload/index.ts src/main/index.ts
git commit -m "Add engineSetLiveParam IPC bridge (main/preload)"
```

---

### Task 5: Renderer — `liveParamSync.ts` shared throttle helper

**Files:**
- Create: `src/renderer/src/components/liveParamSync.ts`

No automated tests for this file — it's a thin, side-effecting wrapper around
`requestAnimationFrame` and an IPC call, in the same category this codebase already treats as
manually-verified (matching `dragUtils.ts`'s own convention, which also has no direct unit
tests).

- [ ] **Step 1: Create the file**

Write `src/renderer/src/components/liveParamSync.ts`:

```ts
/** Pushes a live volume/fade value straight to the native engine, bypassing
 * the full buildEngineProject/engineLoadProject reload path entirely -- see
 * docs/superpowers/specs/2026-08-04-live-param-fast-path-design.md. Call
 * this directly from a drag handler's onMove callback, alongside (not
 * instead of) the existing SET_DRAG_PREVIEW dispatch that drives the visual
 * preview.
 *
 * Coalesces via requestAnimationFrame: multiple calls for different keys
 * arriving before the next frame are all remembered (keyed by
 * `${field}:${key}`, latest value wins per key) and flushed together, once
 * per frame -- so e.g. a group-volume drag's fan-out across several stems
 * updates them all in the same frame rather than staggered across several.
 * A fast mouse can fire far more often than the display refreshes, so this
 * caps the actual IPC traffic at ~60Hz regardless of drag speed.
 *
 * No "dirty during in-flight" concern the way StoreContext.tsx's own
 * full-reload throttle needs (see its own doc comment) -- each
 * engineSetLiveParam call is a small, synchronous socket write plus a tiny
 * native map rebuild, not an async chain that can meaningfully overlap
 * itself; there's nothing to guard against by the time the next frame's
 * flush would run. */

type LiveParamField = 'volume' | 'fadeIn' | 'fadeOut'

const pending = new Map<string, { field: LiveParamField; key: string; value: number }>()
let flushScheduled = false

export function scheduleLiveParamSync(field: LiveParamField, key: string, value: number): void {
  pending.set(`${field}:${key}`, { field, key, value })
  if (flushScheduled) return
  flushScheduled = true
  requestAnimationFrame(() => {
    flushScheduled = false
    const toSend = Array.from(pending.values())
    pending.clear()
    for (const entry of toSend) {
      void window.rifffApi.engineSetLiveParam(entry.field, entry.key, entry.value)
    }
  })
}
```

- [ ] **Step 2: Run typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/liveParamSync.ts
git commit -m "Add scheduleLiveParamSync: rAF-coalesced live volume/fade push to the engine"
```

---

### Task 6: `StemWaveformRow.tsx` — call the fast path

**Files:**
- Modify: `src/renderer/src/components/StemWaveformRow.tsx`

- [ ] **Step 1: Import `scheduleLiveParamSync`**

Add to the imports at the top of `src/renderer/src/components/StemWaveformRow.tsx`, alongside the
existing `import { startPointerDrag, suppressNextSyntheticClick } from './dragUtils'` line:

```ts
import { startPointerDrag, suppressNextSyntheticClick } from './dragUtils'
import { scheduleLiveParamSync } from './liveParamSync'
```

- [ ] **Step 2: Call it from `handleFadeInStart`/`handleFadeOutStart`/`handleVolumeStart`**

Replace (current content):

```ts
  function handleFadeInStart(e: React.MouseEvent): void {
    const startFadeIn = fadeIn
    let finalFadeIn = startFadeIn
    startPointerDrag(
      e,
      (deltaX) => {
        finalFadeIn = Math.max(
          0,
          Math.min(FADE_MAX, startFadeIn + deltaX / (ppb * FADE_DRAG_SLOWDOWN))
        )
        dispatch({ type: 'SET_DRAG_PREVIEW', field: 'fadeIn', key: groupId, value: finalFadeIn })
      },
      (moved) => {
        if (moved) dispatch({ type: 'SET_FADE_IN', groupId, bars: finalFadeIn })
        dispatch({ type: 'SET_DRAG_PREVIEW', field: 'fadeIn', key: groupId, value: undefined })
      }
    )
  }

  function handleFadeOutStart(e: React.MouseEvent): void {
    const startFadeOut = fadeOut
    let finalFadeOut = startFadeOut
    startPointerDrag(
      e,
      // foStart = width - fadeOutPx, so a LONGER fade-out means a SMALLER
      // foStart, which means the knee needs to move LEFT. deltaX moving left
      // is negative, so subtracting it (startFadeOut - deltaX) is what makes
      // "drag left" translate to "fadeOutPx grows" — the mirror image of
      // fade-in's `startFadeIn + deltaX`, where dragging right grows fadeIn.
      (deltaX) => {
        finalFadeOut = Math.max(
          0,
          Math.min(FADE_MAX, startFadeOut - deltaX / (ppb * FADE_DRAG_SLOWDOWN))
        )
        dispatch({ type: 'SET_DRAG_PREVIEW', field: 'fadeOut', key: groupId, value: finalFadeOut })
      },
      (moved) => {
        if (moved) dispatch({ type: 'SET_FADE_OUT', groupId, bars: finalFadeOut })
        dispatch({ type: 'SET_DRAG_PREVIEW', field: 'fadeOut', key: groupId, value: undefined })
      }
    )
  }
```

with:

```ts
  function handleFadeInStart(e: React.MouseEvent): void {
    const startFadeIn = fadeIn
    let finalFadeIn = startFadeIn
    startPointerDrag(
      e,
      (deltaX) => {
        finalFadeIn = Math.max(
          0,
          Math.min(FADE_MAX, startFadeIn + deltaX / (ppb * FADE_DRAG_SLOWDOWN))
        )
        dispatch({ type: 'SET_DRAG_PREVIEW', field: 'fadeIn', key: groupId, value: finalFadeIn })
        scheduleLiveParamSync('fadeIn', groupId, finalFadeIn)
      },
      (moved) => {
        if (moved) dispatch({ type: 'SET_FADE_IN', groupId, bars: finalFadeIn })
        dispatch({ type: 'SET_DRAG_PREVIEW', field: 'fadeIn', key: groupId, value: undefined })
      }
    )
  }

  function handleFadeOutStart(e: React.MouseEvent): void {
    const startFadeOut = fadeOut
    let finalFadeOut = startFadeOut
    startPointerDrag(
      e,
      // foStart = width - fadeOutPx, so a LONGER fade-out means a SMALLER
      // foStart, which means the knee needs to move LEFT. deltaX moving left
      // is negative, so subtracting it (startFadeOut - deltaX) is what makes
      // "drag left" translate to "fadeOutPx grows" — the mirror image of
      // fade-in's `startFadeIn + deltaX`, where dragging right grows fadeIn.
      (deltaX) => {
        finalFadeOut = Math.max(
          0,
          Math.min(FADE_MAX, startFadeOut - deltaX / (ppb * FADE_DRAG_SLOWDOWN))
        )
        dispatch({ type: 'SET_DRAG_PREVIEW', field: 'fadeOut', key: groupId, value: finalFadeOut })
        scheduleLiveParamSync('fadeOut', groupId, finalFadeOut)
      },
      (moved) => {
        if (moved) dispatch({ type: 'SET_FADE_OUT', groupId, bars: finalFadeOut })
        dispatch({ type: 'SET_DRAG_PREVIEW', field: 'fadeOut', key: groupId, value: undefined })
      }
    )
  }
```

Replace (current content):

```ts
  function handleVolumeStart(e: React.MouseEvent): void {
    const startVolume = volume
    let finalVolume = startVolume
    startPointerDrag(
      e,
      // Up (negative deltaY) increases volume — hence the subtraction.
      (_dx, deltaY) => {
        finalVolume = Math.max(0, Math.min(1, startVolume - deltaY / ROW_HEIGHT))
        dispatch({ type: 'SET_DRAG_PREVIEW', field: 'volume', key, value: finalVolume })
      },
      (moved) => {
        if (moved) dispatch({ type: 'SET_VOLUME', stemKey: key, volume: finalVolume })
        dispatch({ type: 'SET_DRAG_PREVIEW', field: 'volume', key, value: undefined })
      }
    )
  }
```

with:

```ts
  function handleVolumeStart(e: React.MouseEvent): void {
    const startVolume = volume
    let finalVolume = startVolume
    startPointerDrag(
      e,
      // Up (negative deltaY) increases volume — hence the subtraction.
      (_dx, deltaY) => {
        finalVolume = Math.max(0, Math.min(1, startVolume - deltaY / ROW_HEIGHT))
        dispatch({ type: 'SET_DRAG_PREVIEW', field: 'volume', key, value: finalVolume })
        scheduleLiveParamSync('volume', key, finalVolume)
      },
      (moved) => {
        if (moved) dispatch({ type: 'SET_VOLUME', stemKey: key, volume: finalVolume })
        dispatch({ type: 'SET_DRAG_PREVIEW', field: 'volume', key, value: undefined })
      }
    )
  }
```

- [ ] **Step 3: Run typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/StemWaveformRow.tsx
git commit -m "StemWaveformRow: push live volume/fade values via the fast path during a drag"
```

---

### Task 7: `CollapsedRifffRow.tsx` fast path + `StoreContext.tsx` dependency cleanup

**Files:**
- Modify: `src/renderer/src/components/CollapsedRifffRow.tsx`
- Modify: `src/renderer/src/state/StoreContext.tsx`

- [ ] **Step 1: Import `scheduleLiveParamSync` in `CollapsedRifffRow.tsx`**

Add to the imports, alongside the existing `import { startPointerDrag, suppressNextSyntheticClick } from './dragUtils'` line:

```ts
import { startPointerDrag, suppressNextSyntheticClick } from './dragUtils'
import { scheduleLiveParamSync } from './liveParamSync'
```

- [ ] **Step 2: Call it from `handleFadeInStart`/`handleFadeOutStart`/`handleVolumeStart`**

Replace (current content):

```ts
  function handleFadeInStart(e: React.MouseEvent): void {
    const startFadeIn = fadeIn
    let finalFadeIn = startFadeIn
    startPointerDrag(
      e,
      (deltaX) => {
        finalFadeIn = Math.max(
          0,
          Math.min(FADE_MAX, startFadeIn + deltaX / (PPB * FADE_DRAG_SLOWDOWN))
        )
        dispatch({ type: 'SET_DRAG_PREVIEW', field: 'fadeIn', key: groupId, value: finalFadeIn })
      },
      (moved) => {
        if (moved) dispatch({ type: 'SET_FADE_IN', groupId, bars: finalFadeIn })
        dispatch({ type: 'SET_DRAG_PREVIEW', field: 'fadeIn', key: groupId, value: undefined })
      }
    )
  }

  function handleFadeOutStart(e: React.MouseEvent): void {
    const startFadeOut = fadeOut
    let finalFadeOut = startFadeOut
    startPointerDrag(
      e,
      (deltaX) => {
        finalFadeOut = Math.max(
          0,
          Math.min(FADE_MAX, startFadeOut - deltaX / (PPB * FADE_DRAG_SLOWDOWN))
        )
        dispatch({ type: 'SET_DRAG_PREVIEW', field: 'fadeOut', key: groupId, value: finalFadeOut })
      },
      (moved) => {
        if (moved) dispatch({ type: 'SET_FADE_OUT', groupId, bars: finalFadeOut })
        dispatch({ type: 'SET_DRAG_PREVIEW', field: 'fadeOut', key: groupId, value: undefined })
      }
    )
  }
```

with:

```ts
  function handleFadeInStart(e: React.MouseEvent): void {
    const startFadeIn = fadeIn
    let finalFadeIn = startFadeIn
    startPointerDrag(
      e,
      (deltaX) => {
        finalFadeIn = Math.max(
          0,
          Math.min(FADE_MAX, startFadeIn + deltaX / (PPB * FADE_DRAG_SLOWDOWN))
        )
        dispatch({ type: 'SET_DRAG_PREVIEW', field: 'fadeIn', key: groupId, value: finalFadeIn })
        scheduleLiveParamSync('fadeIn', groupId, finalFadeIn)
      },
      (moved) => {
        if (moved) dispatch({ type: 'SET_FADE_IN', groupId, bars: finalFadeIn })
        dispatch({ type: 'SET_DRAG_PREVIEW', field: 'fadeIn', key: groupId, value: undefined })
      }
    )
  }

  function handleFadeOutStart(e: React.MouseEvent): void {
    const startFadeOut = fadeOut
    let finalFadeOut = startFadeOut
    startPointerDrag(
      e,
      (deltaX) => {
        finalFadeOut = Math.max(
          0,
          Math.min(FADE_MAX, startFadeOut - deltaX / (PPB * FADE_DRAG_SLOWDOWN))
        )
        dispatch({ type: 'SET_DRAG_PREVIEW', field: 'fadeOut', key: groupId, value: finalFadeOut })
        scheduleLiveParamSync('fadeOut', groupId, finalFadeOut)
      },
      (moved) => {
        if (moved) dispatch({ type: 'SET_FADE_OUT', groupId, bars: finalFadeOut })
        dispatch({ type: 'SET_DRAG_PREVIEW', field: 'fadeOut', key: groupId, value: undefined })
      }
    )
  }
```

Replace (current content):

```ts
  function handleVolumeStart(e: React.MouseEvent): void {
    const startVolume = volume
    let finalVolume = startVolume
    startPointerDrag(
      e,
      (_dx, deltaY) => {
        finalVolume = Math.max(0, Math.min(1, startVolume - deltaY / ROW_HEIGHT))
        dispatch({ type: 'SET_DRAG_PREVIEW_GROUP_VOLUME', groupId, value: finalVolume })
      },
      (moved) => {
        if (moved) dispatch({ type: 'SET_GROUP_VOLUME', groupId, volume: finalVolume })
        dispatch({ type: 'SET_DRAG_PREVIEW_GROUP_VOLUME', groupId, value: undefined })
      }
    )
  }
```

with:

```ts
  function handleVolumeStart(e: React.MouseEvent): void {
    const startVolume = volume
    let finalVolume = startVolume
    startPointerDrag(
      e,
      (_dx, deltaY) => {
        finalVolume = Math.max(0, Math.min(1, startVolume - deltaY / ROW_HEIGHT))
        dispatch({ type: 'SET_DRAG_PREVIEW_GROUP_VOLUME', groupId, value: finalVolume })
        // Fans out to every stem in the rifff, matching
        // SET_DRAG_PREVIEW_GROUP_VOLUME's own fan-out -- this drag
        // controls the whole rifff's volume together, so every stem's own
        // live override needs updating, not just one.
        for (const stem of rifff.stems) {
          scheduleLiveParamSync('volume', stemKey(groupId, stem.slot), finalVolume)
        }
      },
      (moved) => {
        if (moved) dispatch({ type: 'SET_GROUP_VOLUME', groupId, volume: finalVolume })
        dispatch({ type: 'SET_DRAG_PREVIEW_GROUP_VOLUME', groupId, value: undefined })
      }
    )
  }
```

(`rifff` and `stemKey` are already in scope in this file -- `rifff` from the existing `const rifff
= useAppSelector((s) => s.rifffs[groupId])` near the top of the component, `stemKey` from the
existing `import { stemKey } from '@shared/types'`.)

- [ ] **Step 3: Remove `dragVol`/`dragFadeIn`/`dragFadeOut` from `StoreContext.tsx`'s full-reload
  effect dependency array**

In `src/renderer/src/state/StoreContext.tsx`, find the engine-sync effect's dependency array
(search for `state.leftCrop,` to locate it). Replace:

```ts
    state.leftCrop,
    // Live volume/fade preview during an active drag -- NOT
    // dragPlayedBars/dragLeftCropBars, which stay commit-on-release only
    // (pushing a length/crop change to the engine mid-drag risks an audible
    // scheduling jump if the playhead is inside the tile being resized; see
    // docs/superpowers/specs/2026-08-04-live-drag-preview-design.md's
    // "Explicitly out of scope" section).
    state.dragVol,
    state.dragFadeIn,
    state.dragFadeOut,
    // masterChain plugin IDs flow through this general project sync (the
```

with:

```ts
    state.leftCrop,
    // dragVol/dragFadeIn/dragFadeOut deliberately NOT here -- they used to
    // be, triggering a full project reload on every drag step, which
    // turned out to cause real, audible glitching at drag frequency (see
    // docs/superpowers/specs/2026-08-04-live-param-fast-path-design.md).
    // Live volume/fade updates now go through a separate, much lighter
    // path (liveParamSync.ts's scheduleLiveParamSync, called directly from
    // the drag handlers) that bypasses this whole effect entirely. The
    // COMMITTED fields (state.vol/fadeIn/fadeOut, above) stay here
    // unchanged -- a drag's final commit still triggers exactly one full
    // reload, same as any other edit, and that reload is what eventually
    // clears the live override on the native side (see IpcServer.cpp's
    // load-project handler) -- no explicit "clear" is ever dispatched from
    // here.
    // masterChain plugin IDs flow through this general project sync (the
```

- [ ] **Step 4: Run typecheck, lint, and the full test suite**

Run: `npm run typecheck && npm run lint && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/CollapsedRifffRow.tsx src/renderer/src/state/StoreContext.tsx
git commit -m "CollapsedRifffRow: push live volume/fade via the fast path; remove drag fields from the full-reload effect"
```

---

### Task 8: Full verification

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: PASS

- [ ] **Step 3: Full TS test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 4: Native build + test suite**

Run (from `native-engine/`): `cmake --build build`
Run: `native-engine/build/sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine --test`
Expected: `All unit tests passed.`

- [ ] **Step 5: Full quit-and-relaunch (native engine changed)**

Per this repo's own CLAUDE.md: the native engine does NOT hot-reload, and a renderer reload alone
is not enough. Fully quit (Cmd+Q, or `kill -9` every `Electron`/`electron-vite`/
`sssketch-engine --serve` process) and run `npm run dev` again.

- [ ] **Step 6: Manual walkthrough**

Repeat the live-drag-preview plan's own audio checks, now specifically confirming the glitching
reported in that plan's own walkthrough is actually gone, not just reduced:

1. While playing, drag a stem's volume envelope (expanded view) for 10+ seconds continuously,
   moving quickly. Confirm the audible volume changes live AND smoothly -- no crackle/glitch
   beyond what's expected from just moving a fader quickly.
2. Same, for a fade-in/fade-out handle.
3. Collapse the rifff, drag its group-level volume envelope while playing, same duration/speed.
   Confirm smooth, and confirm every stem's own volume actually moved together (this is a
   multi-key fan-out through the new fast path -- worth specifically confirming all stems track,
   not just the first).
4. Drag several different stems' volumes in quick succession, in both expanded and collapsed
   views, while playing. Confirm no crash, no stuck/stale volume on any stem.
5. Drag a volume all the way to 0 (silence) while playing, hold, then drag it back up. Confirm it
   actually goes silent and comes back, live (regression check for the "override wakes a
   committed-silent stem" case).
6. Drag a volume/fade handle, release, and IMMEDIATELY drag it again (a fast double-drag).
   Confirm no audible glitch/jump at the handoff between the first drag's live override, its
   eventual full-reload-triggered clear, and the second drag's own new override starting up.
7. General stability: drag length/crop handles too (these still go through the ORIGINAL
   drag-preview mechanism, unaffected by this plan) and confirm they still behave exactly as
   before (live sibling-sync in the expanded view, no live audio change until release).
8. Confirm the visible UI stutter reported in the live-drag-preview plan's walkthrough (item 8:
   "things blink a bit when i move the handles") -- likely unrelated to this specific fix (that
   plan's own code review attributed it to `useAppState()` broad re-renders, not the audio
   pipeline) -- report whether it's also improved, unchanged, or still present, since removing a
   large chunk of effect churn from every drag step could plausibly help it too even though that
   wasn't this plan's direct target.

Report back what you see.

## Self-Review Notes

**Spec coverage:** every section of `docs/superpowers/specs/2026-08-04-live-param-fast-path-design.md`
is covered — native storage (Task 1), `PlaybackEngine` integration (Task 2), IPC message + auto-clear
(Task 3), renderer bridge (Task 4), throttle helper (Task 5), component wiring (Tasks 6-7), dependency
cleanup (Task 7), testing (native tests throughout Tasks 1-2, manual walkthrough in Task 8).

**Explicitly out of scope, confirmed untouched by this plan:** length/crop live push,
`buildEngineProject.ts`'s existing drag-draft preference (left in place as a harmless fallback,
per the spec's own reasoning), the separate `useAppState()` re-render-fan-out concern (Task 8's
manual walkthrough asks about it but doesn't fix it).
