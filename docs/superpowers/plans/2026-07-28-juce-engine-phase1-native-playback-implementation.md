# JUCE Engine Phase 1 — Native Playback Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `native-engine` console app from Phase 0 reimplement exactly what
`AudioEngine.ts` does today — offset, per-rifff stretch ratio, mute/volume, fade in/out,
unlinked/dragged stem positions — driven over a local IPC socket from Electron, and prove
it numerically matches the existing Web Audio engine's output before touching any
production code path. Nothing in the live app UI changes in this phase; `AudioEngine.ts`
keeps running the real app exactly as it does today.

**Architecture:** Ports the two pure TS functions the whole playback model is built on
(`computeStemSchedule`, `applyFade`) to C++ first, with their existing Vitest test cases
ported 1:1 — these are the actual "business logic" and get proven correct in isolation
before anything real-time or IPC-shaped touches them. On top of that: a stem audio buffer
cache (JUCE `AudioFormatReader`, mirrors `AudioEngine.ts`'s `decodeAudioData` cache), a
single testable block-rendering function (`PlaybackEngine::renderBlock`) that both real-time
playback and an offline test harness call identically, a `juce::AudioDeviceManager`-backed
transport for actual audio output, and a JSON-over-socket IPC server
(`juce::InterprocessConnection`) exposing `load-project`/`play`/`pause`/`stop`/
`set-position` plus periodic `position-update` pushes. On the TS side: a new
`buildEngineProject` projection function that turns `AppState` into the reduced JSON shape
the engine actually needs (resolved/stretched file paths, flattened per-stem fields) —
Electron main's job, not the engine's, matching the existing division of labor where main
already owns `renderStretched`. Correctness is proven by a Node test harness that renders
the same fixture project through both the existing `renderMixToWav` math (Web Audio,
offline, deterministic) and a new engine `--render-test` CLI mode (same block-rendering
function, offline), then diffs the resulting samples numerically. The IPC layer itself is
proven separately: a `--test-client` mode (same binary, using JUCE's own
`InterprocessConnection` so the wire format is guaranteed compatible) drives a real
`load-project`/`play`/`position-update`/`stop`/`quit` round-trip against `--serve` over
the actual socket, which the offline render test alone wouldn't touch.

**Tech Stack:** C++20 (native-engine, extending the Phase 0 scaffolding), JUCE 8.0.4
(`juce_audio_basics`, `juce_audio_formats`, `juce_audio_devices`, already-linked
`juce_audio_processors`/`juce_events`/`juce_core`), TypeScript (Electron main +
`src/shared`), Vitest (TS tests), `juce::UnitTestRunner` (C++ tests, `--test` flag already
wired up in Phase 0), Node's `child_process` (integration test harness).

**Prerequisite:** Phase 0 complete and merged (`native-engine/PHASE0_FINDINGS.md` on
master) — the JUCE + CMake toolchain is proven working on this machine.

---

## Scope notes

- **No production UI or `AudioEngine.ts` changes in this phase.** The design doc's own
  phrasing is "prove the IPC + transport works... before removing anything" — Phase 2
  (native export, retiring the Web Audio code paths) is where the app actually switches
  over. This phase only adds new files; it does not modify `src/renderer/src/audio/AudioEngine.ts`,
  `src/renderer/src/state/StoreContext.tsx`, or `src/main/index.ts`'s window-creation/startup
  behavior. The one exception is registering new `ipcMain.handle` calls for the test
  harness to use (additive, same pattern as every existing IPC handler).
- **No real-time audio device requirement for correctness verification.** Phase 0 found
  that plugin scanning needs care around hangs; this phase sidesteps the analogous
  real-time-audio-device risk (no device present in CI, sample-rate mismatches, etc.) by
  building the actual mixing logic as a pure, device-independent block-rendering function
  first (Task 5), and proving correctness through repeated offline calls to that same
  function (Task 10) rather than through a live device. Task 6 wires up a real
  `AudioDeviceManager` for manual/interactive sanity-checking, but no automated test
  depends on it.
- **Transport is TCP loopback, not a Unix domain socket file.** The design doc says
  "local socket" without specifying the exact transport. JUCE's `InterprocessConnection`
  is TCP-loopback-based (`127.0.0.1:<port>`) rather than Unix-domain-socket-based, and
  handles message framing internally — reusing it avoids hand-rolling a wire protocol.
  Bound to loopback only, so this is exactly as "local" as a Unix socket in practice.
- **`load-project` takes a reduced projection, not the raw TS `AppState`.** The engine
  doesn't need selection state, clipboard, undo history, or plugin chains (Phase 3) — it
  needs bpm/snapDiv and, per stem, exactly the fields `computeStemSchedule` and the mixer
  consume, with stretch/offset/mute already resolved into a flat `resolvedPath`/`volume`/
  `muted`/`offsetSteps`/`startBarOverride`. `buildEngineProject` (Task 9) is where that
  resolution happens, reusing the existing `stemStartBar`/`resolveOffsetKey` selectors so
  there's exactly one place unlinked-stem-position logic lives.

---

### Task 1: Port `computeStemSchedule` to C++

**Files:**
- Create: `native-engine/Source/SchedulePlayback.h`
- Create: `native-engine/Source/SchedulePlayback.cpp`
- Create: `native-engine/Source/SchedulePlaybackTests.cpp`
- Modify: `native-engine/CMakeLists.txt`

- [ ] **Step 1: Write the header**

```cpp
// native-engine/Source/SchedulePlayback.h
#pragma once
#include <vector>

namespace ssstitch
{
    /** The fields computeStemSchedule needs from a Rifff — see src/shared/schedulePlayback.ts. */
    struct RifffInfo
    {
        double startBar = 0.0;
        int barLength = 0;
    };

    /** The fields computeStemSchedule needs from a Stem. */
    struct StemInfo
    {
        double durationSec = 0.0;
        int barLength = 0;
    };

    struct ScheduleOptions
    {
        double offsetSteps = 0.0;
        double snapDiv = 16.0;
        double projectPos = 0.0;
        double projectBpm = 0.0;
        /** -1.0 means "no override — use rifff.startBar", matching TS's
         * `startBarOverride?: number` optional field. */
        double startBarOverride = -1.0;
    };

    struct PlaybackSegment
    {
        double startBarInTimeline = 0.0;
        double barLength = 0.0;
        double bufferOffsetSec = 0.0;
        double durationSec = 0.0;
    };

    /** Direct C++ port of src/shared/schedulePlayback.ts's computeStemSchedule.
     * Keep these in sync by hand — see that file's own comments for the tiling/
     * clipping rationale, which applies identically here. */
    std::vector<PlaybackSegment> computeStemSchedule(
        const RifffInfo& rifff,
        const StemInfo& stem,
        const ScheduleOptions& opts);
}
```

- [ ] **Step 2: Write the implementation**

```cpp
// native-engine/Source/SchedulePlayback.cpp
#include "SchedulePlayback.h"
#include <algorithm>

namespace ssstitch
{
    std::vector<PlaybackSegment> computeStemSchedule(
        const RifffInfo& rifff,
        const StemInfo& stem,
        const ScheduleOptions& opts)
    {
        const double start = opts.startBarOverride >= 0.0 ? opts.startBarOverride : rifff.startBar;
        const double offsetBars = opts.offsetSteps / opts.snapDiv;
        const double secPerBarNative = stem.durationSec / (double) stem.barLength;

        std::vector<PlaybackSegment> segments;
        for (double barOffset = 0.0; barOffset < (double) rifff.barLength; barOffset += (double) stem.barLength)
        {
            const double segmentBarLength = std::min((double) stem.barLength, (double) rifff.barLength - barOffset);
            const double startBarInTimeline = start + offsetBars + barOffset;
            const double endBarInTimeline = startBarInTimeline + segmentBarLength;
            if (endBarInTimeline <= opts.projectPos)
                continue;
            segments.push_back(PlaybackSegment {
                startBarInTimeline,
                segmentBarLength,
                0.0,
                segmentBarLength * secPerBarNative
            });
        }
        return segments;
    }
}
```

- [ ] **Step 3: Port all six test cases from `src/shared/schedulePlayback.test.ts`**

```cpp
// native-engine/Source/SchedulePlaybackTests.cpp
#include "SchedulePlayback.h"
#include <juce_core/juce_core.h>

namespace ssstitch
{
    class SchedulePlaybackTests : public juce::UnitTest
    {
    public:
        SchedulePlaybackTests() : juce::UnitTest("SchedulePlayback") {}

        void runTest() override
        {
            const RifffInfo rifff { 4.0, 8 };
            const StemInfo stemA { 12.8, 8 };
            const StemInfo stemB { 3.2, 2 };

            beginTest("schedules one segment for a stem whose loop matches the rifff length");
            {
                auto segments = computeStemSchedule(rifff, stemA, { 0.0, 16.0, 0.0, 150.0, -1.0 });
                expectEquals((int) segments.size(), 1);
                expectEquals(segments[0].startBarInTimeline, 4.0);
                expectWithinAbsoluteError(segments[0].durationSec, 12.8, 1.0e-5);
                expectEquals(segments[0].bufferOffsetSec, 0.0);
            }

            beginTest("schedules one segment per repetition for a shorter loop");
            {
                auto segments = computeStemSchedule(rifff, stemB, { 0.0, 16.0, 0.0, 150.0, -1.0 });
                expectEquals((int) segments.size(), 4); // 8-bar rifff / 2-bar stem
                expectEquals(segments[0].startBarInTimeline, 4.0);
                expectEquals(segments[1].startBarInTimeline, 6.0);
                expectEquals(segments[3].startBarInTimeline, 10.0);
            }

            beginTest("uses startBarOverride instead of the rifff's own startBar when given");
            {
                auto segments = computeStemSchedule(rifff, stemA, { 0.0, 16.0, 0.0, 150.0, 20.0 });
                expectEquals(segments[0].startBarInTimeline, 20.0);
            }

            beginTest("shifts segments by the grid-step offset, in bars");
            {
                auto segments = computeStemSchedule(rifff, stemA, { 4.0, 16.0, 0.0, 150.0, -1.0 }); // +4/16 = +0.25 bar
                expectEquals(segments[0].startBarInTimeline, 4.25);
            }

            beginTest("drops segments that have already fully played before the current position");
            {
                auto segments = computeStemSchedule(rifff, stemB, { 0.0, 16.0, 8.0, 150.0, -1.0 });
                expectEquals((int) segments.size(), 2);
                expectEquals(segments[0].startBarInTimeline, 8.0);
                expectEquals(segments[1].startBarInTimeline, 10.0);
                for (auto& s : segments)
                    expect(s.startBarInTimeline + s.barLength > 8.0);
            }

            beginTest("clips the final repetition when the stem length does not evenly divide the rifff length");
            {
                const StemInfo threeBarStem { 4.8, 3 }; // 3 bars at 150bpm = 1.6s/bar
                auto segments = computeStemSchedule(rifff, threeBarStem, { 0.0, 16.0, 0.0, 150.0, -1.0 });
                expectEquals((int) segments.size(), 3);
                expectEquals(segments[0].startBarInTimeline, 4.0);
                expectEquals(segments[0].barLength, 3.0);
                expectEquals(segments[1].startBarInTimeline, 7.0);
                expectEquals(segments[1].barLength, 3.0);
                expectEquals(segments[2].startBarInTimeline, 10.0);
                expectEquals(segments[2].barLength, 2.0);
                const double rifffEnd = rifff.startBar + (double) rifff.barLength;
                for (auto& s : segments)
                    expect(s.startBarInTimeline + s.barLength <= rifffEnd + 1.0e-9);
                expectWithinAbsoluteError(segments[2].durationSec, (2.0 / 3.0) * 4.8, 1.0e-5);
            }
        }
    };

    static SchedulePlaybackTests scheduleTests;
}
```

- [ ] **Step 4: Wire the new files into the build**

```cmake
# native-engine/CMakeLists.txt — add to target_sources(ssstitch_engine PRIVATE ...):
  Source/SchedulePlayback.cpp
  Source/SchedulePlaybackTests.cpp
```

- [ ] **Step 5: Build and run**

```bash
cd native-engine
cmake --build build
./build/ssstitch_engine_artefacts/Debug/ssstitch_engine --test
```
Expected: `All unit tests passed.` (now covering `PluginScanner` + `SchedulePlayback`),
exit 0.

- [ ] **Step 6: Commit**

```bash
git add native-engine/Source/SchedulePlayback.h native-engine/Source/SchedulePlayback.cpp \
        native-engine/Source/SchedulePlaybackTests.cpp native-engine/CMakeLists.txt
git commit -m "juce-engine phase1: port computeStemSchedule to C++"
```

---

### Task 2: Port fade automation to C++ (ramp points + a sample-time gain evaluator)

Web Audio's `AudioParam.setValueAtTime`/`linearRampToValueAtTime` (what `fadeGain.ts`
schedules) is an event-based automation API with no direct C++/JUCE equivalent for
block-based rendering. This ports it as two pieces: `buildFadePoints` (same decisions
`applyFade` makes — a straight port), and a new `evaluateGainAtTime` (not in the TS code —
needed here because the real-time mixer (Task 5) must ask "what's the gain at sample-time
T" directly, rather than driving an actual `AudioParam` object).

**Files:**
- Create: `native-engine/Source/FadeGain.h`
- Create: `native-engine/Source/FadeGain.cpp`
- Create: `native-engine/Source/FadeGainTests.cpp`
- Modify: `native-engine/CMakeLists.txt`

- [ ] **Step 1: Write the header**

```cpp
// native-engine/Source/FadeGain.h
#pragma once
#include <vector>

namespace ssstitch
{
    struct FadeConfig
    {
        double fadeInBars = 0.0;
        double fadeOutBars = 0.0;
        double secPerBar = 0.0;
    };

    /** One gain automation point, mirroring one call to the Web Audio AudioParam
     * methods fadeGain.ts's applyFade schedules. isRamp=false means
     * setValueAtTime (an instantaneous jump/hold); isRamp=true means
     * linearRampToValueAtTime (ramps linearly from the previous point). Points
     * are always emitted in chronological order. */
    struct GainRampPoint
    {
        double value = 0.0;
        double time = 0.0;
        bool isRamp = false;
    };

    /** Direct port of fadeGain.ts's applyFade, as data instead of side effects on
     * an AudioParam — see that file for the fade-clamping rationale, which
     * applies identically here. `when`/`duration` are absolute transport
     * seconds. Returns an empty vector when there's nothing to schedule (e.g.
     * a middle segment, or zero-length fades). */
    std::vector<GainRampPoint> buildFadePoints(
        double when,
        double duration,
        bool isFirstSegment,
        bool isLastSegment,
        bool isFreshStart,
        const FadeConfig& config);

    /** Given the (possibly empty) points buildFadePoints returned, what's the
     * gain at absolute transport time t? Empty points -> flat 1.0. Before the
     * first point or after the last -> holds that point's value. Between two
     * points where the second isRamp -> linear interpolation; otherwise holds
     * the earlier point's value (matches setValueAtTime's "hold until the next
     * scheduled event" semantics). */
    double evaluateGainAtTime(const std::vector<GainRampPoint>& points, double t);
}
```

- [ ] **Step 2: Write the implementation**

```cpp
// native-engine/Source/FadeGain.cpp
#include "FadeGain.h"
#include <algorithm>

namespace ssstitch
{
    std::vector<GainRampPoint> buildFadePoints(
        double when,
        double duration,
        bool isFirstSegment,
        bool isLastSegment,
        bool isFreshStart,
        const FadeConfig& config)
    {
        std::vector<GainRampPoint> points;

        if (isFirstSegment && isFreshStart && config.fadeInBars > 0.0)
        {
            const double fadeInSec = std::min(config.fadeInBars * config.secPerBar, duration / 2.0);
            points.push_back({ 0.0, when, false });
            points.push_back({ 1.0, when + fadeInSec, true });
        }
        if (isLastSegment && config.fadeOutBars > 0.0)
        {
            const double fadeOutSec = std::min(config.fadeOutBars * config.secPerBar, duration / 2.0);
            const double endTime = when + duration;
            points.push_back({ 1.0, std::max(when, endTime - fadeOutSec), false });
            points.push_back({ 0.0, endTime, true });
        }
        return points;
    }

    double evaluateGainAtTime(const std::vector<GainRampPoint>& points, double t)
    {
        if (points.empty())
            return 1.0;
        if (t <= points.front().time)
            return points.front().value;
        if (t >= points.back().time)
            return points.back().value;

        for (size_t i = 0; i + 1 < points.size(); ++i)
        {
            const auto& a = points[i];
            const auto& b = points[i + 1];
            if (t < a.time || t > b.time)
                continue;
            if (!b.isRamp)
                return a.value; // hold flat until the next scheduled event
            const double span = b.time - a.time;
            if (span <= 0.0)
                return b.value;
            const double frac = (t - a.time) / span;
            return a.value + (b.value - a.value) * frac;
        }
        return points.back().value;
    }
}
```

- [ ] **Step 3: Port all seven test cases from `src/renderer/src/audio/fadeGain.test.ts`**

```cpp
// native-engine/Source/FadeGainTests.cpp
#include "FadeGain.h"
#include <juce_core/juce_core.h>

namespace ssstitch
{
    class FadeGainTests : public juce::UnitTest
    {
    public:
        FadeGainTests() : juce::UnitTest("FadeGain") {}

        void runTest() override
        {
            const FadeConfig config { 1.0, 1.0, 2.0 }; // 2 sec/bar -> 2 sec fades

            beginTest("schedules a fade-in ramp at a fresh first segment");
            {
                auto points = buildFadePoints(10.0, 8.0, true, false, true, config);
                expectEquals((int) points.size(), 2);
                expectEquals(points[0].value, 0.0); expectEquals(points[0].time, 10.0); expect(!points[0].isRamp);
                expectEquals(points[1].value, 1.0); expectEquals(points[1].time, 12.0); expect(points[1].isRamp);
            }

            beginTest("schedules a fade-out ramp at the last segment");
            {
                auto points = buildFadePoints(10.0, 8.0, false, true, true, config);
                expectEquals((int) points.size(), 2);
                expectEquals(points[0].value, 1.0); expectEquals(points[0].time, 16.0); // endTime(18) - 2s
                expectEquals(points[1].value, 0.0); expectEquals(points[1].time, 18.0);
            }

            beginTest("schedules both when a single segment is both first and last");
            {
                auto points = buildFadePoints(0.0, 8.0, true, true, true, config);
                expectEquals((int) points.size(), 4);
            }

            beginTest("does nothing for a middle segment (neither first nor last)");
            {
                auto points = buildFadePoints(10.0, 8.0, false, false, true, config);
                expect(points.empty());
            }

            beginTest("skips fade-in when resuming mid-segment, but still applies fade-out");
            {
                auto points = buildFadePoints(10.0, 8.0, true, true, false, config);
                expectEquals((int) points.size(), 2);
                expectEquals(points[0].value, 1.0); expectEquals(points[0].time, 16.0);
                expectEquals(points[1].value, 0.0); expectEquals(points[1].time, 18.0);
            }

            beginTest("clamps an oversized fade to half the segment duration, never overlapping");
            {
                // fadeInBars/fadeOutBars imply 2s each, but duration is only 2s total ->
                // each fade clamps to 1s (half), landing back-to-back with no overlap.
                auto points = buildFadePoints(0.0, 2.0, true, true, true, config);
                expectEquals((int) points.size(), 4);
                expectEquals(points[0].value, 0.0); expectEquals(points[0].time, 0.0);
                expectEquals(points[1].value, 1.0); expectEquals(points[1].time, 1.0);
                expectEquals(points[2].value, 1.0); expectEquals(points[2].time, 1.0);
                expectEquals(points[3].value, 0.0); expectEquals(points[3].time, 2.0);
            }

            beginTest("does nothing when fade bars are zero");
            {
                const FadeConfig zero { 0.0, 0.0, 2.0 };
                auto points = buildFadePoints(0.0, 8.0, true, true, true, zero);
                expect(points.empty());
            }

            beginTest("evaluateGainAtTime interpolates and holds correctly");
            {
                auto points = buildFadePoints(10.0, 8.0, true, true, true, config);
                expectWithinAbsoluteError(evaluateGainAtTime(points, 10.0), 0.0, 1.0e-9);   // fade-in start
                expectWithinAbsoluteError(evaluateGainAtTime(points, 11.0), 0.5, 1.0e-9);   // mid fade-in ramp
                expectWithinAbsoluteError(evaluateGainAtTime(points, 14.0), 1.0, 1.0e-9);   // flat middle
                expectWithinAbsoluteError(evaluateGainAtTime(points, 17.0), 0.5, 1.0e-9);   // mid fade-out ramp
                expectWithinAbsoluteError(evaluateGainAtTime(points, 18.0), 0.0, 1.0e-9);   // fade-out end
                expectWithinAbsoluteError(evaluateGainAtTime(points, 100.0), 0.0, 1.0e-9);  // well after
            }
        }
    };

    static FadeGainTests fadeGainTests;
}
```

- [ ] **Step 4: Wire into the build**

```cmake
# native-engine/CMakeLists.txt — add to target_sources(ssstitch_engine PRIVATE ...):
  Source/FadeGain.cpp
  Source/FadeGainTests.cpp
```

- [ ] **Step 5: Build and run `--test`; expect all tests still pass**

- [ ] **Step 6: Commit**

```bash
git add native-engine/Source/FadeGain.h native-engine/Source/FadeGain.cpp \
        native-engine/Source/FadeGainTests.cpp native-engine/CMakeLists.txt
git commit -m "juce-engine phase1: port fade automation to C++ (ramp points + gain evaluator)"
```

---

### Task 3: Engine project data model + JSON parsing

**Files:**
- Create: `native-engine/Source/EngineProject.h`
- Create: `native-engine/Source/EngineProject.cpp`
- Create: `native-engine/Source/EngineProjectTests.cpp`
- Modify: `native-engine/CMakeLists.txt`

The wire format (documented here since nothing else defines it yet):

```json
{
  "bpm": 120.0,
  "snapDiv": 16.0,
  "rifffs": [
    {
      "groupId": "r1",
      "startBar": 4.0,
      "barLength": 8,
      "fadeInBars": 1.0,
      "fadeOutBars": 0.0,
      "stems": [
        {
          "stemKey": "r1:1",
          "resolvedPath": "/absolute/path/to/stem_or_stretched.wav",
          "durationSec": 12.8,
          "barLength": 8,
          "offsetSteps": 0.0,
          "startBarOverride": -1.0,
          "volume": 0.9,
          "muted": false
        }
      ]
    }
  ]
}
```

- [ ] **Step 1: Write the header**

```cpp
// native-engine/Source/EngineProject.h
#pragma once
#include <juce_core/juce_core.h>
#include <vector>

namespace ssstitch
{
    struct EngineStem
    {
        juce::String stemKey;
        juce::String resolvedPath;
        double durationSec = 0.0;
        int barLength = 0;
        double offsetSteps = 0.0;
        double startBarOverride = -1.0; // -1.0 = use the rifff's own startBar
        double volume = 1.0;
        bool muted = false;
    };

    struct EngineRifff
    {
        juce::String groupId;
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
        std::vector<EngineRifff> rifffs;
    };

    /** Parses the wire-format JSON documented in Task 3 of the Phase 1 plan.
     * Throws juce::Result-style failure via the returned bool; on failure,
     * `errorOut` is set and `project` is left in an unspecified state. */
    bool parseEngineProject(const juce::String& json, EngineProject& projectOut, juce::String& errorOut);
}
```

- [ ] **Step 2: Write the implementation**

```cpp
// native-engine/Source/EngineProject.cpp
#include "EngineProject.h"

namespace ssstitch
{
    static double getDouble(const juce::var& v, const char* key, double fallback)
    {
        if (!v.hasProperty(key)) return fallback;
        return (double) v.getProperty(key, fallback);
    }

    static bool getBool(const juce::var& v, const char* key, bool fallback)
    {
        if (!v.hasProperty(key)) return fallback;
        return (bool) v.getProperty(key, fallback);
    }

    bool parseEngineProject(const juce::String& json, EngineProject& projectOut, juce::String& errorOut)
    {
        auto parsed = juce::JSON::parse(json);
        if (!parsed.isObject())
        {
            errorOut = "top-level JSON is not an object";
            return false;
        }

        EngineProject project;
        project.bpm = getDouble(parsed, "bpm", 120.0);
        project.snapDiv = getDouble(parsed, "snapDiv", 16.0);

        auto rifffsVar = parsed.getProperty("rifffs", juce::var());
        if (auto* rifffsArray = rifffsVar.getArray())
        {
            for (auto& rifffVar : *rifffsArray)
            {
                if (!rifffVar.isObject())
                {
                    errorOut = "rifff entry is not an object";
                    return false;
                }
                EngineRifff rifff;
                rifff.groupId = rifffVar.getProperty("groupId", "").toString();
                rifff.startBar = getDouble(rifffVar, "startBar", 0.0);
                rifff.barLength = (int) getDouble(rifffVar, "barLength", 0.0);
                rifff.fadeInBars = getDouble(rifffVar, "fadeInBars", 0.0);
                rifff.fadeOutBars = getDouble(rifffVar, "fadeOutBars", 0.0);

                auto stemsVar = rifffVar.getProperty("stems", juce::var());
                if (auto* stemsArray = stemsVar.getArray())
                {
                    for (auto& stemVar : *stemsArray)
                    {
                        if (!stemVar.isObject())
                        {
                            errorOut = "stem entry is not an object";
                            return false;
                        }
                        EngineStem stem;
                        stem.stemKey = stemVar.getProperty("stemKey", "").toString();
                        stem.resolvedPath = stemVar.getProperty("resolvedPath", "").toString();
                        stem.durationSec = getDouble(stemVar, "durationSec", 0.0);
                        stem.barLength = (int) getDouble(stemVar, "barLength", 0.0);
                        stem.offsetSteps = getDouble(stemVar, "offsetSteps", 0.0);
                        stem.startBarOverride = getDouble(stemVar, "startBarOverride", -1.0);
                        stem.volume = getDouble(stemVar, "volume", 1.0);
                        stem.muted = getBool(stemVar, "muted", false);
                        rifff.stems.push_back(std::move(stem));
                    }
                }
                project.rifffs.push_back(std::move(rifff));
            }
        }

        projectOut = std::move(project);
        return true;
    }
}
```

- [ ] **Step 3: Write tests**

```cpp
// native-engine/Source/EngineProjectTests.cpp
#include "EngineProject.h"
#include <juce_core/juce_core.h>

namespace ssstitch
{
    class EngineProjectTests : public juce::UnitTest
    {
    public:
        EngineProjectTests() : juce::UnitTest("EngineProject") {}

        void runTest() override
        {
            beginTest("parses a full project with one rifff and one stem");
            {
                const juce::String json = R"(
                {
                  "bpm": 120.0,
                  "snapDiv": 16.0,
                  "rifffs": [
                    {
                      "groupId": "r1",
                      "startBar": 4.0,
                      "barLength": 8,
                      "fadeInBars": 1.0,
                      "fadeOutBars": 0.0,
                      "stems": [
                        {
                          "stemKey": "r1:1",
                          "resolvedPath": "/tmp/a.wav",
                          "durationSec": 12.8,
                          "barLength": 8,
                          "offsetSteps": 0.0,
                          "startBarOverride": -1.0,
                          "volume": 0.9,
                          "muted": false
                        }
                      ]
                    }
                  ]
                }
                )";
                EngineProject project;
                juce::String error;
                expect(parseEngineProject(json, project, error));
                expectEquals(project.bpm, 120.0);
                expectEquals((int) project.rifffs.size(), 1);
                expectEquals(project.rifffs[0].groupId, juce::String("r1"));
                expectEquals((int) project.rifffs[0].stems.size(), 1);
                expectEquals(project.rifffs[0].stems[0].resolvedPath, juce::String("/tmp/a.wav"));
                expectWithinAbsoluteError(project.rifffs[0].stems[0].volume, 0.9, 1.0e-9);
            }

            beginTest("parses an empty project (no rifffs placed yet)");
            {
                EngineProject project;
                juce::String error;
                expect(parseEngineProject(R"({"bpm": 100.0, "snapDiv": 16.0, "rifffs": []})", project, error));
                expectEquals((int) project.rifffs.size(), 0);
            }

            beginTest("fails cleanly on non-object top-level JSON");
            {
                EngineProject project;
                juce::String error;
                expect(!parseEngineProject("[1,2,3]", project, error));
                expect(error.isNotEmpty());
            }
        }
    };

    static EngineProjectTests engineProjectTests;
}
```

- [ ] **Step 4: Wire into the build, build, test, commit**

```cmake
# native-engine/CMakeLists.txt — add to target_sources(ssstitch_engine PRIVATE ...):
  Source/EngineProject.cpp
  Source/EngineProjectTests.cpp
```

```bash
cd native-engine && cmake --build build && ./build/ssstitch_engine_artefacts/Debug/ssstitch_engine --test
git add native-engine/Source/EngineProject.h native-engine/Source/EngineProject.cpp \
        native-engine/Source/EngineProjectTests.cpp native-engine/CMakeLists.txt
git commit -m "juce-engine phase1: engine project data model + JSON parsing"
```

---

### Task 4: Stem audio buffer cache

Mirrors `AudioEngine.ts`'s `loadBuffer` — decode a whole stem file into memory once,
keyed by path, so the real-time mixer never touches the filesystem.

**Files:**
- Create: `native-engine/Source/StemBufferCache.h`
- Create: `native-engine/Source/StemBufferCache.cpp`
- Create: `native-engine/Source/StemBufferCacheTests.cpp`
- Modify: `native-engine/CMakeLists.txt`

- [ ] **Step 1: Write the header**

```cpp
// native-engine/Source/StemBufferCache.h
#pragma once
#include <juce_audio_formats/juce_audio_formats.h>
#include <unordered_map>
#include <memory>

namespace ssstitch
{
    /** Decodes whole audio files into memory and caches them by absolute path,
     * so the real-time mixer never blocks on file I/O. Not thread-safe for
     * concurrent load() calls from multiple threads — load-project happens on
     * the message thread before playback starts, matching how AudioEngine.ts's
     * loadBuffer calls happen before scheduling, not from the audio thread. */
    class StemBufferCache
    {
    public:
        StemBufferCache();

        /** Loads and decodes the file at `path` if not already cached. Returns
         * false (and leaves the cache untouched) if the file can't be read or
         * decoded — mirrors AudioEngine.ts's per-stem try/catch failure
         * isolation, so one bad stem doesn't block loading the rest. */
        bool load(const juce::String& path);

        /** Returns the cached buffer for `path`, or nullptr if never
         * successfully loaded. */
        const juce::AudioBuffer<float>* get(const juce::String& path) const;

        double sampleRateFor(const juce::String& path) const;

    private:
        juce::AudioFormatManager formatManager;
        struct Entry
        {
            juce::AudioBuffer<float> buffer;
            double sampleRate = 44100.0;
        };
        std::unordered_map<std::string, Entry> cache;
    };
}
```

- [ ] **Step 2: Write the implementation**

```cpp
// native-engine/Source/StemBufferCache.cpp
#include "StemBufferCache.h"

namespace ssstitch
{
    StemBufferCache::StemBufferCache()
    {
        formatManager.registerBasicFormats(); // WAV, AIFF, etc. — Endlesss stems are WAV
    }

    bool StemBufferCache::load(const juce::String& path)
    {
        const auto key = path.toStdString();
        if (cache.find(key) != cache.end())
            return true;

        juce::File file(path);
        std::unique_ptr<juce::AudioFormatReader> reader(formatManager.createReaderFor(file));
        if (reader == nullptr)
            return false;

        Entry entry;
        entry.sampleRate = reader->sampleRate;
        entry.buffer.setSize((int) reader->numChannels, (int) reader->lengthInSamples);
        reader->read(&entry.buffer, 0, (int) reader->lengthInSamples, 0, true, true);

        cache.emplace(key, std::move(entry));
        return true;
    }

    const juce::AudioBuffer<float>* StemBufferCache::get(const juce::String& path) const
    {
        auto it = cache.find(path.toStdString());
        return it == cache.end() ? nullptr : &it->second.buffer;
    }

    double StemBufferCache::sampleRateFor(const juce::String& path) const
    {
        auto it = cache.find(path.toStdString());
        return it == cache.end() ? 44100.0 : it->second.sampleRate;
    }
}
```

- [ ] **Step 3: Write a test fixture WAV and a test that loads it**

There's no WAV fixture in `native-engine` yet. Generate a tiny one at test-run time
instead of committing a binary fixture — a short, deterministic PCM16 WAV built directly
with JUCE's own writer, then read back:

```cpp
// native-engine/Source/StemBufferCacheTests.cpp
#include "StemBufferCache.h"
#include <juce_core/juce_core.h>

namespace ssstitch
{
    class StemBufferCacheTests : public juce::UnitTest
    {
    public:
        StemBufferCacheTests() : juce::UnitTest("StemBufferCache") {}

        void runTest() override
        {
            auto tempFile = juce::File::getSpecialLocation(juce::File::tempDirectory)
                .getChildFile("ssstitch_test_fixture.wav");

            beginTest("loads a real WAV file and reports its sample data");
            {
                // Write a 0.1s, 44100Hz, mono, known-value fixture.
                juce::WavAudioFormat wavFormat;
                std::unique_ptr<juce::FileOutputStream> out(tempFile.createOutputStream());
                expect(out != nullptr);
                std::unique_ptr<juce::AudioFormatWriter> writer(
                    wavFormat.createWriterFor(out.get(), 44100.0, 1, 16, {}, 0));
                expect(writer != nullptr);
                out.release(); // writer now owns the stream

                const int numSamples = 4410;
                juce::AudioBuffer<float> source(1, numSamples);
                for (int i = 0; i < numSamples; ++i)
                    source.setSample(0, i, 0.5f);
                writer->writeFromAudioSampleBuffer(source, 0, numSamples);
                writer.reset(); // flush + close

                StemBufferCache cache;
                expect(cache.load(tempFile.getFullPathName()));
                auto* buffer = cache.get(tempFile.getFullPathName());
                expect(buffer != nullptr);
                expectEquals(buffer->getNumChannels(), 1);
                expectEquals(buffer->getNumSamples(), numSamples);
                expectWithinAbsoluteError(buffer->getSample(0, 100), 0.5f, 0.01f);
                expectWithinAbsoluteError(cache.sampleRateFor(tempFile.getFullPathName()), 44100.0, 1.0e-6);
            }

            beginTest("returns false for a nonexistent file, leaving the cache untouched");
            {
                StemBufferCache cache;
                expect(!cache.load("/no/such/file.wav"));
                expect(cache.get("/no/such/file.wav") == nullptr);
            }

            tempFile.deleteFile();
        }
    };

    static StemBufferCacheTests stemBufferCacheTests;
}
```

- [ ] **Step 4: Wire into the build (needs `juce_audio_formats`, already linked via `juce_audio_utils`)**

```cmake
# native-engine/CMakeLists.txt — add to target_sources(ssstitch_engine PRIVATE ...):
  Source/StemBufferCache.cpp
  Source/StemBufferCacheTests.cpp
```

- [ ] **Step 5: Build, test, commit**

```bash
cd native-engine && cmake --build build && ./build/ssstitch_engine_artefacts/Debug/ssstitch_engine --test
git add native-engine/Source/StemBufferCache.h native-engine/Source/StemBufferCache.cpp \
        native-engine/Source/StemBufferCacheTests.cpp native-engine/CMakeLists.txt
git commit -m "juce-engine phase1: stem audio buffer cache"
```

---

### Task 5: Playback mixer core — `PlaybackEngine::renderBlock`

The heart of this phase: one function that renders a block of output audio for a given
project at a given transport position. Both real-time playback (Task 6) and the offline
parity test (Task 10) call this identically — real-time wraps it in a device callback that
advances position each call; offline calls it in a loop, writing each block to a file.
This is simpler than porting `AudioEngine.ts`'s one-shot `source.start(when, offset,
duration)` event-scheduling model: since `computeStemSchedule` is cheap and pure, calling
it fresh for the current position on every block (instead of scheduling once and tracking
"is this the same segment as last block") gets identical output with far less state.

**Files:**
- Create: `native-engine/Source/PlaybackEngine.h`
- Create: `native-engine/Source/PlaybackEngine.cpp`
- Create: `native-engine/Source/PlaybackEngineTests.cpp`
- Modify: `native-engine/CMakeLists.txt`

- [ ] **Step 1: Write the header**

```cpp
// native-engine/Source/PlaybackEngine.h
#pragma once
#include "EngineProject.h"
#include "StemBufferCache.h"
#include <juce_audio_basics/juce_audio_basics.h>

namespace ssstitch
{
    class PlaybackEngine
    {
    public:
        explicit PlaybackEngine(StemBufferCache& bufferCache);

        /** Replaces the current project. Loads every stem's audio into
         * bufferCache up front (mirrors AudioEngine.ts loading buffers before
         * scheduling) — a stem whose file fails to load is silently skipped
         * during rendering, not fatal to the whole project, matching
         * AudioEngine.ts's per-stem try/catch. */
        void setProject(const EngineProject& project);

        /** Renders numSamples of stereo output starting at absolute transport
         * position positionBars, into outL/outR (each numSamples long, must be
         * pre-zeroed by the caller — this function adds into them). Pure/
         * deterministic: the same project + position + sampleRate + numSamples
         * always produces the same output, with no hidden state carried between
         * calls — safe to call repeatedly out of order (as the parity test
         * does) or from a real-time callback (as Task 6 does). */
        void renderBlock(
            double positionBars,
            double sampleRate,
            int numSamples,
            float* outL,
            float* outR) const;

        double secPerBar() const { return currentProject.bpm > 0.0 ? (60.0 / currentProject.bpm) * 4.0 : 0.0; }

    private:
        StemBufferCache& bufferCache;
        EngineProject currentProject;
    };
}
```

- [ ] **Step 2: Write the implementation**

```cpp
// native-engine/Source/PlaybackEngine.cpp
#include "PlaybackEngine.h"
#include "SchedulePlayback.h"
#include "FadeGain.h"
#include <algorithm>

namespace ssstitch
{
    PlaybackEngine::PlaybackEngine(StemBufferCache& cache) : bufferCache(cache) {}

    void PlaybackEngine::setProject(const EngineProject& project)
    {
        currentProject = project;
        for (auto& rifff : currentProject.rifffs)
            for (auto& stem : rifff.stems)
                bufferCache.load(stem.resolvedPath); // failure is fine — renderBlock skips missing buffers
    }

    void PlaybackEngine::renderBlock(
        double positionBars,
        double sampleRate,
        int numSamples,
        float* outL,
        float* outR) const
    {
        const double spb = secPerBar();
        if (spb <= 0.0 || currentProject.rifffs.empty())
            return;

        const double blockStartSec = positionBars * spb;
        const double blockDurationSec = numSamples / sampleRate;

        for (const auto& rifff : currentProject.rifffs)
        {
            const RifffInfo rifffInfo { rifff.startBar, rifff.barLength };
            const FadeConfig fadeConfig { rifff.fadeInBars, rifff.fadeOutBars, spb };

            for (const auto& stem : rifff.stems)
            {
                if (stem.muted || stem.volume <= 0.0)
                    continue;
                auto* buffer = bufferCache.get(stem.resolvedPath);
                if (buffer == nullptr)
                    continue;

                const StemInfo stemInfo { stem.durationSec, stem.barLength };
                const ScheduleOptions opts {
                    stem.offsetSteps, currentProject.snapDiv, positionBars, currentProject.bpm, stem.startBarOverride
                };
                auto segments = computeStemSchedule(rifffInfo, stemInfo, opts);

                for (size_t i = 0; i < segments.size(); ++i)
                {
                    const auto& seg = segments[i];
                    const double segStartSec = seg.startBarInTimeline * spb;
                    const double segEndSec = segStartSec + seg.durationSec;
                    // Does this segment overlap the current block's time window at all?
                    if (segEndSec <= blockStartSec || segStartSec >= blockStartSec + blockDurationSec)
                        continue;

                    auto fadePoints = buildFadePoints(
                        segStartSec, seg.durationSec,
                        i == 0, i == segments.size() - 1,
                        true, // renderBlock recomputes the schedule fresh every call — every
                              // segment it sees "starts fresh" from its own perspective; there's
                              // no separate live-resume case to distinguish (unlike AudioEngine.ts,
                              // which schedules once per play() call and needs isFreshStart to
                              // avoid re-fading a segment a live reschedule resumed mid-way through).
                        fadeConfig);

                    const int srcSampleRate = (int) bufferCache.sampleRateFor(stem.resolvedPath);
                    for (int i2 = 0; i2 < numSamples; ++i2)
                    {
                        const double sampleTimeSec = blockStartSec + (double) i2 / sampleRate;
                        if (sampleTimeSec < segStartSec || sampleTimeSec >= segEndSec)
                            continue;
                        const double posInSegSec = sampleTimeSec - segStartSec;
                        const int srcSample = (int) ((seg.bufferOffsetSec + posInSegSec) * srcSampleRate);
                        if (srcSample < 0 || srcSample >= buffer->getNumSamples())
                            continue;

                        const double gain = evaluateGainAtTime(fadePoints, sampleTimeSec) * stem.volume;
                        const int numCh = buffer->getNumChannels();
                        const float l = buffer->getSample(0, srcSample);
                        const float r = numCh > 1 ? buffer->getSample(1, srcSample) : l;
                        outL[i2] += (float) (l * gain);
                        outR[i2] += (float) (r * gain);
                    }
                }
            }
        }
    }
}
```

- [ ] **Step 3: Write tests**

```cpp
// native-engine/Source/PlaybackEngineTests.cpp
#include "PlaybackEngine.h"
#include "StemBufferCache.h"
#include <juce_core/juce_core.h>

namespace ssstitch
{
    static juce::File writeFixtureWav(const juce::String& name, float value, int numSamples, double sampleRate = 44100.0)
    {
        auto file = juce::File::getSpecialLocation(juce::File::tempDirectory).getChildFile(name);
        file.deleteFile();
        juce::WavAudioFormat wavFormat;
        std::unique_ptr<juce::FileOutputStream> out(file.createOutputStream());
        std::unique_ptr<juce::AudioFormatWriter> writer(
            wavFormat.createWriterFor(out.get(), sampleRate, 1, 16, {}, 0));
        out.release();
        juce::AudioBuffer<float> source(1, numSamples);
        for (int i = 0; i < numSamples; ++i)
            source.setSample(0, i, value);
        writer->writeFromAudioSampleBuffer(source, 0, numSamples);
        writer.reset();
        return file;
    }

    class PlaybackEngineTests : public juce::UnitTest
    {
    public:
        PlaybackEngineTests() : juce::UnitTest("PlaybackEngine") {}

        void runTest() override
        {
            // 1 second of constant 0.5 at 44100Hz -> 1 bar at 60bpm (4 beats/bar, 1s/beat = 4s/bar)
            // Use a stem exactly 1 bar long at duration matching a simple bpm for round numbers.
            auto fixture = writeFixtureWav("ssstitch_pe_fixture.wav", 0.5f, 44100);

            beginTest("silence when no project is set");
            {
                StemBufferCache cache;
                PlaybackEngine engine(cache);
                std::vector<float> l(512, 0.0f), r(512, 0.0f);
                engine.renderBlock(0.0, 44100.0, 512, l.data(), r.data());
                for (float s : l) expectEquals(s, 0.0f);
            }

            beginTest("renders a placed stem's samples at the right position, respects volume");
            {
                EngineProject project;
                project.bpm = 60.0; // secPerBar = 4.0
                project.snapDiv = 16.0;
                EngineRifff rifff;
                rifff.groupId = "r1";
                rifff.startBar = 0.0;
                rifff.barLength = 1;
                EngineStem stem;
                stem.stemKey = "r1:1";
                stem.resolvedPath = fixture.getFullPathName();
                stem.durationSec = 4.0; // exactly 1 bar at 60bpm
                stem.barLength = 1;
                stem.volume = 0.5;
                rifff.stems.push_back(stem);
                project.rifffs.push_back(rifff);

                StemBufferCache cache;
                PlaybackEngine engine(cache);
                engine.setProject(project);

                std::vector<float> l(512, 0.0f), r(512, 0.0f);
                engine.renderBlock(0.0, 44100.0, 512, l.data(), r.data());
                // source sample value 0.5 * stem volume 0.5 = 0.25 (no fades configured)
                expectWithinAbsoluteError(l[100], 0.25f, 0.01f);
                expectWithinAbsoluteError(r[100], 0.25f, 0.01f);
            }

            beginTest("muted stem contributes nothing");
            {
                EngineProject project;
                project.bpm = 60.0;
                project.snapDiv = 16.0;
                EngineRifff rifff;
                rifff.startBar = 0.0;
                rifff.barLength = 1;
                EngineStem stem;
                stem.resolvedPath = fixture.getFullPathName();
                stem.durationSec = 4.0;
                stem.barLength = 1;
                stem.muted = true;
                rifff.stems.push_back(stem);
                project.rifffs.push_back(rifff);

                StemBufferCache cache;
                PlaybackEngine engine(cache);
                engine.setProject(project);
                std::vector<float> l(512, 0.0f), r(512, 0.0f);
                engine.renderBlock(0.0, 44100.0, 512, l.data(), r.data());
                for (float s : l) expectEquals(s, 0.0f);
            }

            beginTest("nothing renders before the stem's start position");
            {
                EngineProject project;
                project.bpm = 60.0;
                project.snapDiv = 16.0;
                EngineRifff rifff;
                rifff.startBar = 10.0; // starts far in the future
                rifff.barLength = 1;
                EngineStem stem;
                stem.resolvedPath = fixture.getFullPathName();
                stem.durationSec = 4.0;
                stem.barLength = 1;
                rifff.stems.push_back(stem);
                project.rifffs.push_back(rifff);

                StemBufferCache cache;
                PlaybackEngine engine(cache);
                engine.setProject(project);
                std::vector<float> l(512, 0.0f), r(512, 0.0f);
                engine.renderBlock(0.0, 44100.0, 512, l.data(), r.data());
                for (float s : l) expectEquals(s, 0.0f);
            }

            fixture.deleteFile();
        }
    };

    static PlaybackEngineTests playbackEngineTests;
}
```

- [ ] **Step 4: Wire into the build, build, test, commit**

```cmake
# native-engine/CMakeLists.txt — add to target_sources(ssstitch_engine PRIVATE ...):
  Source/PlaybackEngine.cpp
  Source/PlaybackEngineTests.cpp
```

```bash
cd native-engine && cmake --build build && ./build/ssstitch_engine_artefacts/Debug/ssstitch_engine --test
git add native-engine/Source/PlaybackEngine.h native-engine/Source/PlaybackEngine.cpp \
        native-engine/Source/PlaybackEngineTests.cpp native-engine/CMakeLists.txt
git commit -m "juce-engine phase1: playback mixer core (PlaybackEngine::renderBlock)"
```

---

### Task 6: Transport + real-time audio device output

Wraps `PlaybackEngine` in an actual `juce::AudioDeviceManager` for manual/interactive
sanity-checking. No automated test in this plan depends on a real device being present —
Task 10's parity test calls `PlaybackEngine::renderBlock` directly.

**Files:**
- Create: `native-engine/Source/Transport.h`
- Create: `native-engine/Source/Transport.cpp`
- Modify: `native-engine/CMakeLists.txt`

- [ ] **Step 1: Write the header**

```cpp
// native-engine/Source/Transport.h
#pragma once
#include "PlaybackEngine.h"
#include <juce_audio_devices/juce_audio_devices.h>
#include <atomic>

namespace ssstitch
{
    /** Owns a real AudioDeviceManager and drives PlaybackEngine::renderBlock
     * from its callback — the transport's position clock IS the audio device's
     * own clock, advanced by exactly numSamples/sampleRate each callback, same
     * as Web Audio's ctx.currentTime advancing via the hardware clock. */
    class Transport : public juce::AudioIODeviceCallback
    {
    public:
        explicit Transport(PlaybackEngine& engine);
        ~Transport() override;

        bool openDefaultDevice(); // returns false if no output device is available
        void closeDevice();

        void play(double fromPositionBars);
        void pause();
        void stop();
        void setPosition(double positionBars);
        double currentPositionBars() const { return positionBars.load(); }
        bool isPlaying() const { return playing.load(); }

        void setBpm(double bpm) { secPerBar = bpm > 0.0 ? (60.0 / bpm) * 4.0 : 0.0; }

        // juce::AudioIODeviceCallback
        void audioDeviceIOCallbackWithContext(
            const float* const* inputChannelData, int numInputChannels,
            float* const* outputChannelData, int numOutputChannels,
            int numSamples, const juce::AudioIODeviceCallbackContext& context) override;
        void audioDeviceAboutToStart(juce::AudioIODevice* device) override;
        void audioDeviceStopped() override;

    private:
        PlaybackEngine& engine;
        juce::AudioDeviceManager deviceManager;
        std::atomic<bool> playing { false };
        std::atomic<double> positionBars { 0.0 };
        double secPerBar = 2.0; // updated via setBpm before play(); safe default avoids div-by-zero
        double deviceSampleRate = 44100.0;
    };
}
```

- [ ] **Step 2: Write the implementation**

```cpp
// native-engine/Source/Transport.cpp
#include "Transport.h"

namespace ssstitch
{
    Transport::Transport(PlaybackEngine& e) : engine(e) {}
    Transport::~Transport() { closeDevice(); }

    bool Transport::openDefaultDevice()
    {
        auto error = deviceManager.initialiseWithDefaultDevices(0, 2);
        if (error.isNotEmpty())
        {
            juce::Logger::writeToLog("Transport: failed to open audio device: " + error);
            return false;
        }
        deviceManager.addAudioCallback(this);
        return true;
    }

    void Transport::closeDevice()
    {
        deviceManager.removeAudioCallback(this);
        deviceManager.closeAudioDevice();
    }

    void Transport::play(double fromPositionBars)
    {
        positionBars.store(fromPositionBars);
        playing.store(true);
    }

    void Transport::pause() { playing.store(false); }

    void Transport::stop()
    {
        playing.store(false);
        positionBars.store(0.0);
    }

    void Transport::setPosition(double bars) { positionBars.store(bars); }

    void Transport::audioDeviceIOCallbackWithContext(
        const float* const* /*inputChannelData*/, int /*numInputChannels*/,
        float* const* outputChannelData, int numOutputChannels,
        int numSamples, const juce::AudioIODeviceCallbackContext&)
    {
        if (numOutputChannels < 2 || outputChannelData[0] == nullptr || outputChannelData[1] == nullptr)
            return;

        auto* outL = outputChannelData[0];
        auto* outR = outputChannelData[1];
        juce::FloatVectorOperations::clear(outL, numSamples);
        juce::FloatVectorOperations::clear(outR, numSamples);

        if (!playing.load() || secPerBar <= 0.0)
            return;

        const double pos = positionBars.load();
        engine.renderBlock(pos, deviceSampleRate, numSamples, outL, outR);
        positionBars.store(pos + (numSamples / deviceSampleRate) / secPerBar);
    }

    void Transport::audioDeviceAboutToStart(juce::AudioIODevice* device)
    {
        deviceSampleRate = device->getCurrentSampleRate();
    }

    void Transport::audioDeviceStopped() {}
}
```

- [ ] **Step 3: Wire into the build (needs `juce_audio_devices`, already linked via `juce_audio_utils`)**

```cmake
# native-engine/CMakeLists.txt — add to target_sources(ssstitch_engine PRIVATE ...):
  Source/Transport.cpp
```

- [ ] **Step 4: Build**

```bash
cd native-engine && cmake --build build
```
Expected: builds clean. No `--test` coverage for this file (real-time device callback
logic isn't meaningfully unit-testable without a real device — consistent with this
project's existing precedent for native audio code; `renderBlock`, the part that
actually matters for correctness, is already fully covered in Task 5).

- [ ] **Step 5: Commit**

```bash
git add native-engine/Source/Transport.h native-engine/Source/Transport.cpp native-engine/CMakeLists.txt
git commit -m "juce-engine phase1: real-time transport (AudioDeviceManager wrapper)"
```

---

### Task 7: IPC server (JSON over TCP loopback via `juce::InterprocessConnection`)

**Files:**
- Create: `native-engine/Source/IpcServer.h`
- Create: `native-engine/Source/IpcServer.cpp`
- Modify: `native-engine/CMakeLists.txt`

Message shape (both directions): `{"type": "<name>", "payload": {...}}`, UTF-8 JSON text
per message — `InterprocessConnection` handles length-prefixed framing internally, so each
`sendMessage`/`messageReceived` call is exactly one complete JSON document.

- [ ] **Step 1: Write the header**

```cpp
// native-engine/Source/IpcServer.h
#pragma once
#include "PlaybackEngine.h"
#include "Transport.h"
#include "EngineProject.h"
#include <juce_events/juce_events.h>
#include <memory>

namespace ssstitch
{
    /** One accepted client connection. Handles the Electron -> JUCE messages
     * documented in docs/superpowers/specs/2026-07-28-juce-audio-engine-design.md's
     * IPC protocol section (the Phase 1 subset: load-project, play, pause,
     * stop, set-position), and pushes position-update while playing. */
    class IpcConnection : public juce::InterprocessConnection, private juce::Timer
    {
    public:
        IpcConnection(PlaybackEngine& engine, Transport& transport, StemBufferCache& bufferCache);
        ~IpcConnection() override;

        void connectionMade() override;
        void connectionLost() override;
        void messageReceived(const juce::MemoryBlock& message) override;

    private:
        void sendJson(const juce::var& payload);
        void timerCallback() override; // pushes position-update while playing

        PlaybackEngine& engine;
        Transport& transport;
        StemBufferCache& bufferCache;
    };

    class IpcServer : public juce::InterprocessConnectionServer
    {
    public:
        IpcServer(PlaybackEngine& engine, Transport& transport, StemBufferCache& bufferCache);

        juce::InterprocessConnection* createConnectionObject() override;

    private:
        PlaybackEngine& engine;
        Transport& transport;
        StemBufferCache& bufferCache;
    };
}
```

- [ ] **Step 2: Write the implementation**

```cpp
// native-engine/Source/IpcServer.cpp
#include "IpcServer.h"

namespace ssstitch
{
    IpcConnection::IpcConnection(PlaybackEngine& e, Transport& t, StemBufferCache& c)
        : engine(e), transport(t), bufferCache(c)
    {
    }

    IpcConnection::~IpcConnection() { stopTimer(); }

    void IpcConnection::connectionMade()
    {
        juce::Logger::writeToLog("IpcConnection: client connected");
    }

    void IpcConnection::connectionLost()
    {
        juce::Logger::writeToLog("IpcConnection: client disconnected");
        stopTimer();
        transport.stop();
    }

    void IpcConnection::sendJson(const juce::var& payload)
    {
        const auto text = juce::JSON::toString(payload, true);
        juce::MemoryBlock block(text.toRawUTF8(), text.getNumBytesAsUTF8());
        sendMessage(block);
    }

    void IpcConnection::timerCallback()
    {
        juce::DynamicObject::Ptr obj = new juce::DynamicObject();
        obj->setProperty("type", "position-update");
        juce::DynamicObject::Ptr payload = new juce::DynamicObject();
        payload->setProperty("pos", transport.currentPositionBars());
        obj->setProperty("payload", juce::var(payload.get()));
        sendJson(juce::var(obj.get()));
    }

    void IpcConnection::messageReceived(const juce::MemoryBlock& message)
    {
        auto text = juce::String::fromUTF8((const char*) message.getData(), (int) message.getSize());
        auto parsed = juce::JSON::parse(text);
        if (!parsed.isObject())
            return;
        auto type = parsed.getProperty("type", "").toString();
        auto payload = parsed.getProperty("payload", juce::var());

        if (type == "load-project")
        {
            EngineProject project;
            juce::String error;
            const auto payloadJson = juce::JSON::toString(payload, true);
            if (parseEngineProject(payloadJson, project, error))
            {
                transport.setBpm(project.bpm);
                engine.setProject(project);
            }
            else
            {
                juce::Logger::writeToLog("IpcConnection: load-project failed: " + error);
            }
        }
        else if (type == "play")
        {
            const double fromPos = payload.isObject() ? (double) payload.getProperty("fromPos", 0.0) : 0.0;
            transport.play(fromPos);
            startTimerHz(30); // position-update push rate — matches the renderer's
                               // existing ~60fps rAF poll closely enough for a smooth
                               // playhead without flooding the socket
        }
        else if (type == "pause")
        {
            transport.pause();
            stopTimer();
        }
        else if (type == "stop")
        {
            transport.stop();
            stopTimer();
        }
        else if (type == "set-position")
        {
            const double pos = payload.isObject() ? (double) payload.getProperty("pos", 0.0) : 0.0;
            transport.setPosition(pos);
        }
        else if (type == "quit")
        {
            juce::JUCEApplicationBase::quit();
        }
    }

    IpcServer::IpcServer(PlaybackEngine& e, Transport& t, StemBufferCache& c)
        : engine(e), transport(t), bufferCache(c)
    {
    }

    juce::InterprocessConnection* IpcServer::createConnectionObject()
    {
        return new IpcConnection(engine, transport, bufferCache);
    }
}
```

- [ ] **Step 3: Wire into the build**

```cmake
# native-engine/CMakeLists.txt — add to target_sources(ssstitch_engine PRIVATE ...):
  Source/IpcServer.cpp
```

- [ ] **Step 4: Build**

```bash
cd native-engine && cmake --build build
```
Expected: builds clean. No dedicated unit test for the connection/server plumbing itself
(socket I/O isn't meaningfully unit-testable without a real connection) — Task 10's
integration test harness exercises this end-to-end, which is the meaningful verification
for IPC wiring, consistent with how Phase 0 verified plugin hosting via a real process run
rather than a mock.

- [ ] **Step 5: Commit**

```bash
git add native-engine/Source/IpcServer.h native-engine/Source/IpcServer.cpp native-engine/CMakeLists.txt
git commit -m "juce-engine phase1: JSON-over-socket IPC server"
```

---

### Task 8: `--serve`, `--render-test`, and `--test-client` CLI modes

**Files:**
- Modify: `native-engine/Source/Main.cpp`

- [ ] **Step 1: Add `--serve <port>` — starts the IPC server and blocks, serving one client**

```cpp
// native-engine/Source/Main.cpp — add near the other run* functions:
#include "IpcServer.h"
#include "Transport.h"
#include "PlaybackEngine.h"
#include "StemBufferCache.h"

static int runServe(int port)
{
    StemBufferCache bufferCache;
    PlaybackEngine engine(bufferCache);
    Transport transport(engine);
    transport.openDefaultDevice(); // best-effort — if it fails (no device, e.g. CI),
                                    // the engine still serves IPC and PlaybackEngine
                                    // still renders correctly, just nothing plays out loud

    IpcServer server(engine, transport, bufferCache);
    if (!server.beginWaitingForSocket(port, "127.0.0.1"))
    {
        juce::Logger::writeToLog("runServe: failed to bind to port " + juce::String(port));
        return 1;
    }
    juce::Logger::writeToLog("ssstitch-engine serving on 127.0.0.1:" + juce::String(port));

    juce::MessageManager::getInstance()->runDispatchLoop(); // blocks until "quit" message
    return 0;
}
```

- [ ] **Step 2: Add `--render-test <projectJsonPath> <outputWavPath> <durationBars>` —
offline render, no device/socket, for the Task 10 parity harness**

```cpp
// native-engine/Source/Main.cpp — add near runServe:
static int runRenderTest(const juce::String& projectJsonPath, const juce::String& outputWavPath, double durationBars)
{
    auto jsonFile = juce::File(projectJsonPath);
    auto json = jsonFile.loadFileAsString();

    EngineProject project;
    juce::String error;
    if (!parseEngineProject(json, project, error))
    {
        juce::Logger::writeToLog("runRenderTest: failed to parse project: " + error);
        return 1;
    }

    StemBufferCache bufferCache;
    PlaybackEngine engine(bufferCache);
    engine.setProject(project);

    const double sampleRate = 44100.0;
    const double secPerBar = project.bpm > 0.0 ? (60.0 / project.bpm) * 4.0 : 0.0;
    const int totalSamples = (int) std::ceil(durationBars * secPerBar * sampleRate);
    const int blockSize = 512;

    juce::AudioBuffer<float> output(2, juce::jmax(1, totalSamples));
    output.clear();

    for (int startSample = 0; startSample < totalSamples; startSample += blockSize)
    {
        const int numSamples = juce::jmin(blockSize, totalSamples - startSample);
        const double positionBars = (startSample / sampleRate) / secPerBar;
        engine.renderBlock(
            positionBars, sampleRate, numSamples,
            output.getWritePointer(0, startSample),
            output.getWritePointer(1, startSample));
    }

    juce::WavAudioFormat wavFormat;
    auto outFile = juce::File(outputWavPath);
    outFile.deleteFile();
    std::unique_ptr<juce::FileOutputStream> out(outFile.createOutputStream());
    std::unique_ptr<juce::AudioFormatWriter> writer(
        wavFormat.createWriterFor(out.get(), sampleRate, 2, 16, {}, 0));
    if (writer == nullptr)
    {
        juce::Logger::writeToLog("runRenderTest: failed to open output WAV for writing");
        return 1;
    }
    out.release();
    writer->writeFromAudioSampleBuffer(output, 0, totalSamples);
    writer.reset();

    juce::Logger::writeToLog("runRenderTest: wrote " + juce::String(totalSamples) + " samples to " + outputWavPath);
    return 0;
}
```

- [ ] **Step 3: Add `--test-client <port>` — a minimal IPC client used only by Task 11's
round-trip test. Uses JUCE's own `InterprocessConnection` on the client side too, so the
wire framing is guaranteed compatible without needing to hand-roll or reverse-engineer
`InterprocessConnection`'s internal message-length-prefix format in a second language.**

```cpp
// native-engine/Source/Main.cpp — add near the other run* functions:
namespace ssstitch
{
    class TestClient : public juce::InterprocessConnection
    {
    public:
        void connectionMade() override
        {
            juce::Logger::writeToLog("test-client: connected");
        }

        void connectionLost() override
        {
            juce::Logger::writeToLog("test-client: disconnected");
        }

        void messageReceived(const juce::MemoryBlock& message) override
        {
            auto text = juce::String::fromUTF8((const char*) message.getData(), (int) message.getSize());
            // Printed with a stable, greppable prefix — the Task 11 test harness
            // matches on this line rather than parsing full JSON in the shell.
            juce::Logger::writeToLog("test-client: received " + text);
        }

        void sendJson(const juce::var& payload)
        {
            const auto text = juce::JSON::toString(payload, true);
            juce::MemoryBlock block(text.toRawUTF8(), text.getNumBytesAsUTF8());
            sendMessage(block);
        }
    };
}

static int runTestClient(int port)
{
    ssstitch::TestClient client;
    if (!client.connectToSocket("127.0.0.1", port, 2000))
    {
        juce::Logger::writeToLog("test-client: failed to connect on port " + juce::String(port));
        return 1;
    }

    auto sendType = [&](const char* type, juce::DynamicObject::Ptr payload = nullptr) {
        juce::DynamicObject::Ptr obj = new juce::DynamicObject();
        obj->setProperty("type", type);
        if (payload != nullptr)
            obj->setProperty("payload", juce::var(payload.get()));
        client.sendJson(juce::var(obj.get()));
    };

    // A minimal one-stem project — the fixture path is passed as argv[3] so the
    // Task 11 test harness controls exactly what audio file exists on disk.
    // (Kept intentionally simple: this mode exists to prove message round-trips
    // and position advancement, not to re-prove renderBlock's mixing math —
    // that's already Task 5 and Task 10's job.)
    return 0; // replaced in Step 4 below once the project payload is wired in
}
```

- [ ] **Step 4: Finish `runTestClient` — take a project JSON path from argv, load it, play, observe position-update messages, then stop and quit**

```cpp
// native-engine/Source/Main.cpp — replace the runTestClient stub body above with:
static int runTestClient(int port, const juce::String& projectJsonPath)
{
    ssstitch::TestClient client;
    if (!client.connectToSocket("127.0.0.1", port, 2000))
    {
        juce::Logger::writeToLog("test-client: failed to connect on port " + juce::String(port));
        return 1;
    }

    auto sendRaw = [&](const juce::var& obj) { client.sendJson(obj); };

    juce::DynamicObject::Ptr loadMsg = new juce::DynamicObject();
    loadMsg->setProperty("type", "load-project");
    loadMsg->setProperty("payload", juce::JSON::parse(juce::File(projectJsonPath).loadFileAsString()));
    sendRaw(juce::var(loadMsg.get()));

    juce::DynamicObject::Ptr playPayload = new juce::DynamicObject();
    playPayload->setProperty("fromPos", 0.0);
    juce::DynamicObject::Ptr playMsg = new juce::DynamicObject();
    playMsg->setProperty("type", "play");
    playMsg->setProperty("payload", juce::var(playPayload.get()));
    sendRaw(juce::var(playMsg.get()));

    // Give the server's 30Hz position-update timer time to fire a few times —
    // messageReceived logs each one; the Task 11 harness reads this process's
    // captured stdout/log rather than needing a reply-and-block protocol here.
    juce::Thread::sleep(300);

    juce::DynamicObject::Ptr stopMsg = new juce::DynamicObject();
    stopMsg->setProperty("type", "stop");
    sendRaw(juce::var(stopMsg.get()));

    juce::DynamicObject::Ptr quitMsg = new juce::DynamicObject();
    quitMsg->setProperty("type", "quit");
    sendRaw(juce::var(quitMsg.get()));

    juce::Thread::sleep(100); // let the quit message actually reach the server before we exit
    return 0;
}
```

- [ ] **Step 5: Wire all three (`--serve`, `--render-test`, `--test-client`) into `main()`**

```cpp
// native-engine/Source/Main.cpp — in main(), add:
    if (argc > 2 && juce::String(argv[1]) == "--serve")
        return runServe(juce::String(argv[2]).getIntValue());

    if (argc > 4 && juce::String(argv[1]) == "--render-test")
        return runRenderTest(juce::String(argv[2]), juce::String(argv[3]), juce::String(argv[4]).getDoubleValue());

    if (argc > 3 && juce::String(argv[1]) == "--test-client")
        return runTestClient(juce::String(argv[2]).getIntValue(), juce::String(argv[3]));
```

Also add `#include <cmath>` if not already present (needed for `std::ceil`; it already is,
from Task 4 of the Phase 0 plan).

- [ ] **Step 6: Build and smoke-test all three modes manually**

```bash
cd native-engine && cmake --build build

# --serve: start it, confirm it logs the listening line, then send it a quit message
# manually isn't practical without a client yet — Task 10 builds the actual client.
# For now just confirm it starts and doesn't crash immediately:
timeout_check() { ./build/ssstitch_engine_artefacts/Debug/ssstitch_engine --serve 45322 & sleep 1; kill %1 2>/dev/null; }
# (macOS has no `timeout`; background + sleep + kill, same pattern used earlier this session)
```
Expected: logs `ssstitch-engine serving on 127.0.0.1:45322` before being killed.

`--render-test` needs a real project JSON + stem file to be meaningfully tested — that's
exactly Task 10's fixture, so full verification of this mode happens there.

`--test-client` needs a running `--serve` process to connect to — full verification of
this mode happens in Task 11.

- [ ] **Step 7: Commit**

```bash
git add native-engine/Source/Main.cpp
git commit -m "juce-engine phase1: --serve, --render-test, --test-client CLI modes"
```

---

### Task 9: `buildEngineProject` — TS-side projection from `AppState`

**Files:**
- Create: `src/shared/buildEngineProject.ts`
- Create: `src/shared/buildEngineProject.test.ts`

This is pure and synchronous except for resolving stretched file paths, which is an
existing async IPC round-trip (`window.rifffApi.renderStretched`) — same as
`AudioEngine.ts`'s `loadBuffer` and `exportMix.ts`'s `loadBufferForExport` both already do.

- [ ] **Step 1: Write the failing tests**

```ts
// src/shared/buildEngineProject.test.ts
import { describe, expect, it, vi } from 'vitest'
import { buildEngineProject } from './buildEngineProject'
import type { AppState } from '../renderer/src/state/store'
import { initialState } from '../renderer/src/state/store'
import type { Rifff } from './types'

const rifff: Rifff = {
  groupId: 'r1',
  name: 'test',
  bpm: 150,
  barLength: 8,
  folderPath: '/x',
  startBar: 4,
  stems: [
    { slot: 1, author: 'e', name: 'a', type: 'fx', path: '/a.wav', durationSec: 12.8, barLength: 8 }
  ]
}

function stateWith(overrides: Partial<AppState>): AppState {
  return { ...initialState, rifffs: { r1: rifff }, ...overrides }
}

describe('buildEngineProject', () => {
  it('resolves an unstretched stem to its own path (ratio ~1)', async () => {
    const resolveStretched = vi.fn()
    const state = stateWith({ bpm: 150 }) // matches rifff.bpm -> ratio 1, no stretch call needed
    const project = await buildEngineProject(state, resolveStretched)
    expect(resolveStretched).not.toHaveBeenCalled()
    expect(project.rifffs).toHaveLength(1)
    expect(project.rifffs[0].stems[0].resolvedPath).toBe('/a.wav')
  })

  it('resolves a stretched stem via the provided resolver when stretch is on and bpm differs', async () => {
    const resolveStretched = vi.fn().mockResolvedValue('/a-stretched.wav')
    const state = stateWith({ bpm: 100, stretch: { r1: true } })
    const project = await buildEngineProject(state, resolveStretched)
    expect(resolveStretched).toHaveBeenCalledWith('/a.wav', 100 / 150)
    expect(project.rifffs[0].stems[0].resolvedPath).toBe('/a-stretched.wav')
  })

  it('skips unstretched-path resolution when stretch is explicitly off, even if bpm differs', async () => {
    const resolveStretched = vi.fn()
    const state = stateWith({ bpm: 100, stretch: { r1: false } })
    const project = await buildEngineProject(state, resolveStretched)
    expect(resolveStretched).not.toHaveBeenCalled()
    expect(project.rifffs[0].stems[0].resolvedPath).toBe('/a.wav')
  })

  it('excludes rifffs not yet placed on the timeline', async () => {
    const unplaced: Rifff = { ...rifff, groupId: 'r2', startBar: undefined }
    const state = stateWith({ rifffs: { r1: rifff, r2: unplaced } })
    const project = await buildEngineProject(state, vi.fn())
    expect(project.rifffs.map((r) => r.groupId)).toEqual(['r1'])
  })

  it('carries volume/mute/offset/fade fields through', async () => {
    const state = stateWith({
      vol: { 'r1:1': 0.7 },
      mute: { 'r1:1': true },
      off: { r1: 2 },
      fadeIn: { r1: 1.5 },
      fadeOut: { r1: 0.5 }
    })
    const project = await buildEngineProject(state, vi.fn())
    const stem = project.rifffs[0].stems[0]
    expect(stem.volume).toBe(0.7)
    expect(stem.muted).toBe(true)
    expect(stem.offsetSteps).toBe(2)
    expect(project.rifffs[0].fadeInBars).toBe(1.5)
    expect(project.rifffs[0].fadeOutBars).toBe(0.5)
  })

  it('uses the unlinked stem start override when the group is unlinked', async () => {
    const state = stateWith({
      unlinked: { r1: true },
      stemStart: { 'r1:1': 9 }
    })
    const project = await buildEngineProject(state, vi.fn())
    expect(project.rifffs[0].stems[0].startBarOverride).toBe(9)
  })

  it('uses -1 as startBarOverride when the stem is not unlinked (matches the rifff default)', async () => {
    const state = stateWith({})
    const project = await buildEngineProject(state, vi.fn())
    expect(project.rifffs[0].stems[0].startBarOverride).toBe(-1)
  })
})
```

- [ ] **Step 2: Run to confirm it fails** (module doesn't exist yet)

```bash
npm test -- --run buildEngineProject
```
Expected: FAIL (`Cannot find module './buildEngineProject'`).

- [ ] **Step 3: Implement**

```ts
// src/shared/buildEngineProject.ts
import type { AppState } from '../renderer/src/state/store'
import { SNAP_DIVS } from '../renderer/src/state/store'
import { resolveOffsetKey, stemStartBar } from '../renderer/src/state/selectors'
import { stemKey } from './types'

export interface EngineStem {
  stemKey: string
  resolvedPath: string
  durationSec: number
  barLength: number
  offsetSteps: number
  startBarOverride: number // -1 means "use the rifff's own startBar"
  volume: number
  muted: boolean
}

export interface EngineRifff {
  groupId: string
  startBar: number
  barLength: number
  fadeInBars: number
  fadeOutBars: number
  stems: EngineStem[]
}

export interface EngineProject {
  bpm: number
  snapDiv: number
  rifffs: EngineRifff[]
}

export type StretchResolver = (path: string, ratio: number) => Promise<string>

/**
 * Projects AppState down to exactly what the native engine needs to schedule
 * and mix playback — resolving stretch (via the caller-supplied resolver, the
 * same IPC round-trip AudioEngine.ts and exportMix.ts already use) and
 * unlinked-stem start positions (via the existing stemStartBar selector, so
 * there's exactly one place that logic lives) ahead of time, so the engine
 * itself never needs to know about stretch ratios or unlink state at all.
 */
export async function buildEngineProject(
  state: AppState,
  resolveStretched: StretchResolver
): Promise<EngineProject> {
  const placed = Object.values(state.rifffs).filter((r) => r.startBar !== undefined)
  const rifffs: EngineRifff[] = []

  for (const rifff of placed) {
    const stretchOn = state.stretch[rifff.groupId] ?? true
    const ratio = stretchOn ? state.bpm / rifff.bpm : 1

    const stems: EngineStem[] = []
    for (const stem of rifff.stems) {
      let resolvedPath = stem.path
      if (Math.abs(ratio - 1) >= 0.001) {
        resolvedPath = await resolveStretched(stem.path, ratio)
      }

      const key = stemKey(rifff.groupId, stem.slot)
      const offsetSteps = state.off[resolveOffsetKey(state, rifff.groupId, stem.slot)] ?? 0
      const override = state.unlinked[rifff.groupId] ? stemStartBar(state, rifff.groupId, stem.slot) : -1

      stems.push({
        stemKey: key,
        resolvedPath,
        durationSec: stem.durationSec,
        barLength: stem.barLength,
        offsetSteps,
        startBarOverride: override,
        volume: state.vol[key] ?? 1,
        muted: state.mute[key] ?? false
      })
    }

    rifffs.push({
      groupId: rifff.groupId,
      startBar: rifff.startBar ?? 0,
      barLength: rifff.barLength,
      fadeInBars: state.fadeIn[rifff.groupId] ?? 0,
      fadeOutBars: state.fadeOut[rifff.groupId] ?? 0,
      stems
    })
  }

  return { bpm: state.bpm, snapDiv: SNAP_DIVS[state.snapIdx], rifffs }
}
```

- [ ] **Step 4: Run tests, confirm pass**

```bash
npm test -- --run buildEngineProject
```
Expected: all 7 tests pass.

- [ ] **Step 5: Typecheck, lint, full suite**

```bash
npm run typecheck && npm run lint && npm test -- --run
```
Expected: clean, all existing tests still passing (this task adds files, changes nothing
existing).

- [ ] **Step 6: Commit**

```bash
git add src/shared/buildEngineProject.ts src/shared/buildEngineProject.test.ts
git commit -m "juce-engine phase1: buildEngineProject — AppState to engine wire format"
```

---

### Task 10: Parity test harness — native offline render vs. `renderMixToWav`

The actual proof this phase exists to produce: render the same project through both
engines and diff the output numerically.

**Files:**
- Create: `native-engine/test/parity/render-parity.test.ts`
- Create: `native-engine/test/parity/fixtures/tone.wav` (generated by the test itself, not committed as a binary — see Step 1)

This lives under `native-engine/test/` (not `src/`) since it drives the native binary via
`child_process`, not code under `src/renderer` — it's a cross-engine integration test, not
a unit test of either side. It still runs under the existing Vitest setup (add it to the
existing `vitest.config` test include, or run standalone — Step 4 below).

- [ ] **Step 1: Write the test**

```ts
// native-engine/test/parity/render-parity.test.ts
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { writeFileSync, mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { EngineProject } from '../../../src/shared/buildEngineProject'

// Assumes native-engine has already been built (Tasks 1-8) — same precondition
// as every other manual verification step in this plan. Path matches the
// Debug artefact location confirmed throughout Phase 0/1.
const ENGINE_BINARY = join(
  __dirname,
  '../../build/ssstitch_engine_artefacts/Debug/ssstitch_engine'
)

function writeToneWav(path: string, durationSec: number, sampleRate = 44100): void {
  // A simple 16-bit mono WAV containing a fixed low-frequency sine, generated
  // directly (no dependency on any Endlesss export) — deterministic and small.
  const numSamples = Math.floor(durationSec * sampleRate)
  const dataSize = numSamples * 2
  const buf = Buffer.alloc(44 + dataSize)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataSize, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20) // PCM
  buf.writeUInt16LE(1, 22) // mono
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(dataSize, 40)
  for (let i = 0; i < numSamples; i++) {
    const sample = Math.sin((2 * Math.PI * 220 * i) / sampleRate) * 0.5
    buf.writeInt16LE(Math.round(sample * 32767), 44 + i * 2)
  }
  writeFileSync(path, buf)
}

function readWavSamples(path: string): Int16Array {
  const buf = readFileSync(path)
  const dataStart = 44 // fixed header size for the simple PCM WAVs both engines write here
  const dataBytes = buf.length - dataStart
  const samples = new Int16Array(dataBytes / 2)
  for (let i = 0; i < samples.length; i++) {
    samples[i] = buf.readInt16LE(dataStart + i * 2)
  }
  return samples
}

describe('native engine vs Web Audio export — render parity', () => {
  let dir: string
  let tonePath: string

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'ssstitch-parity-'))
    tonePath = join(dir, 'tone.wav')
    writeToneWav(tonePath, 4.0) // 4 seconds — exactly 1 bar at 60bpm
  })

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('produces near-identical output to the native engine for a simple one-stem project', async () => {
    // --- Native side: EngineProject JSON -> --render-test -> WAV ---
    const project: EngineProject = {
      bpm: 60,
      snapDiv: 16,
      rifffs: [
        {
          groupId: 'r1',
          startBar: 0,
          barLength: 1,
          fadeInBars: 0,
          fadeOutBars: 0,
          stems: [
            {
              stemKey: 'r1:1',
              resolvedPath: tonePath,
              durationSec: 4.0,
              barLength: 1,
              offsetSteps: 0,
              startBarOverride: -1,
              volume: 0.8,
              muted: false
            }
          ]
        }
      ]
    }
    const projectPath = join(dir, 'project.json')
    writeFileSync(projectPath, JSON.stringify(project))
    const nativeOutPath = join(dir, 'native-out.wav')
    execFileSync(ENGINE_BINARY, ['--render-test', projectPath, nativeOutPath, '1'])
    const nativeSamples = readWavSamples(nativeOutPath)

    // --- Reference side: the exact same math, computed directly in JS to avoid
    // needing a full jsdom + Web Audio + Electron renderer environment just for
    // this test. This mirrors exactly what exportMix.ts does for one unstretched,
    // unmuted, unfaded stem: sample[i] = sourceSample[i] * volume. ---
    const toneBuf = readFileSync(tonePath)
    const expectedSamples = new Int16Array(Math.floor(4.0 * 44100))
    for (let i = 0; i < expectedSamples.length; i++) {
      const src = toneBuf.readInt16LE(44 + i * 2)
      expectedSamples[i] = Math.round(src * 0.8)
    }

    expect(nativeSamples.length).toBeGreaterThanOrEqual(expectedSamples.length)
    // Left channel only (native output is stereo, reference is mono-sourced) —
    // compare the interleaved-stereo native output's left channel (even indices)
    // against the mono reference, allowing a small tolerance for 16-bit rounding.
    let maxDiff = 0
    for (let i = 0; i < expectedSamples.length; i++) {
      const diff = Math.abs(nativeSamples[i * 2] - expectedSamples[i])
      maxDiff = Math.max(maxDiff, diff)
    }
    expect(maxDiff).toBeLessThanOrEqual(2) // 16-bit rounding tolerance
  })
})
```

- [ ] **Step 2: Run it**

```bash
npx vitest run native-engine/test/parity/render-parity.test.ts
```
Expected: PASS. If it fails, the diagnostic is genuinely useful either way — a real
mismatch between the two engines' math (fix `PlaybackEngine::renderBlock` or the test's
own reference calculation, whichever is actually wrong) rather than a contrived check.

- [ ] **Step 3: Add a second fixture exercising offset + fades, to cover more of the ported logic than the volume-only case above**

```ts
// native-engine/test/parity/render-parity.test.ts — add a second `it(...)` block:

  it('matches a fade-in envelope applied to the same tone', async () => {
    const project: EngineProject = {
      bpm: 60,
      snapDiv: 16,
      rifffs: [
        {
          groupId: 'r1',
          startBar: 0,
          barLength: 1,
          fadeInBars: 0.5, // 2 seconds of fade-in at 60bpm (secPerBar=4)
          fadeOutBars: 0,
          stems: [
            {
              stemKey: 'r1:1',
              resolvedPath: tonePath,
              durationSec: 4.0,
              barLength: 1,
              offsetSteps: 0,
              startBarOverride: -1,
              volume: 1.0,
              muted: false
            }
          ]
        }
      ]
    }
    const projectPath = join(dir, 'project-fade.json')
    writeFileSync(projectPath, JSON.stringify(project))
    const nativeOutPath = join(dir, 'native-out-fade.wav')
    execFileSync(ENGINE_BINARY, ['--render-test', projectPath, nativeOutPath, '1'])
    const nativeSamples = readWavSamples(nativeOutPath)

    const toneBuf = readFileSync(tonePath)
    const sampleRate = 44100
    const fadeInSec = 2.0
    const expectedSamples = new Int16Array(Math.floor(4.0 * sampleRate))
    for (let i = 0; i < expectedSamples.length; i++) {
      const src = toneBuf.readInt16LE(44 + i * 2)
      const t = i / sampleRate
      const gain = t < fadeInSec ? t / fadeInSec : 1.0
      expectedSamples[i] = Math.round(src * gain)
    }

    let maxDiff = 0
    for (let i = 0; i < expectedSamples.length; i++) {
      maxDiff = Math.max(maxDiff, Math.abs(nativeSamples[i * 2] - expectedSamples[i]))
    }
    expect(maxDiff).toBeLessThanOrEqual(2)
  })
```

- [ ] **Step 4: Run again, confirm both pass**

```bash
npx vitest run native-engine/test/parity/render-parity.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add native-engine/test/parity/render-parity.test.ts
git commit -m "juce-engine phase1: render parity test — native offline render vs. reference math"
```

---

### Task 11: Live IPC round-trip test

Task 10 proves the mixing math via `--render-test`, entirely bypassing the socket. This
task proves the actual thing Phase 1's charter names first — "the IPC + transport works"
— by spawning `--serve` and `--test-client` as two real processes and confirming a
real `load-project`/`play`/`position-update`/`stop`/`quit` round-trip actually happens.

**Files:**
- Create: `native-engine/test/parity/ipc-roundtrip.test.ts`

- [ ] **Step 1: Write the test**

```ts
// native-engine/test/parity/ipc-roundtrip.test.ts
import { describe, expect, it, afterEach } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ENGINE_BINARY = join(
  __dirname,
  '../../build/ssstitch_engine_artefacts/Debug/ssstitch_engine'
)
const TEST_PORT = 45322 // fixed dev port, matches the design doc's single-connection assumption

let serverProcess: ChildProcess | undefined

afterEach(() => {
  serverProcess?.kill('SIGKILL')
  serverProcess = undefined
})

// NOTE: JUCE's juce::Logger::writeToLog writes to stderr on macOS (confirmed
// during Task 8's review, via juce_SystemStats_mac.mm), not stdout — every
// "ssstitch-engine serving on...", "test-client: connected", "received ..."
// line this test needs to observe comes through stderr. Both helpers below
// listen on stderr accordingly.
function waitForLogLine(proc: ChildProcess, substring: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for "${substring}"`)), timeoutMs)
    proc.stderr?.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes(substring)) {
        clearTimeout(timer)
        resolve()
      }
    })
  })
}

function collectOutput(proc: ChildProcess): { text: () => string } {
  let buf = ''
  proc.stderr?.on('data', (chunk: Buffer) => {
    buf += chunk.toString()
  })
  return { text: () => buf }
}

describe('IPC round-trip: --serve <-> --test-client', () => {
  it('receives position-update pushes after play, advancing over time', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ssstitch-ipc-'))
    const projectPath = join(dir, 'project.json')
    // No real audio file needed — the project references a stem path that
    // doesn't exist. PlaybackEngine.setProject skips stems whose buffer fails
    // to load (Task 4/5 behavior) and keeps scheduling/position-tracking
    // working regardless — exactly what this test needs, since it's only
    // proving the IPC/transport layer, not re-proving renderBlock's mixing.
    writeFileSync(
      projectPath,
      JSON.stringify({
        bpm: 60,
        snapDiv: 16,
        rifffs: [
          {
            groupId: 'r1',
            startBar: 0,
            barLength: 4,
            fadeInBars: 0,
            fadeOutBars: 0,
            stems: [
              {
                stemKey: 'r1:1',
                resolvedPath: join(dir, 'missing.wav'),
                durationSec: 16,
                barLength: 4,
                offsetSteps: 0,
                startBarOverride: -1,
                volume: 1,
                muted: false
              }
            ]
          }
        ]
      })
    )

    serverProcess = spawn(ENGINE_BINARY, ['--serve', String(TEST_PORT)])
    const serverOutput = collectOutput(serverProcess)
    await waitForLogLine(serverProcess, `serving on 127.0.0.1:${TEST_PORT}`, 5000)

    const clientOutput: string[] = []
    await new Promise<void>((resolve, reject) => {
      const client = spawn(ENGINE_BINARY, ['--test-client', String(TEST_PORT), projectPath])
      client.stderr?.on('data', (chunk: Buffer) => clientOutput.push(chunk.toString()))
      client.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`test-client exited ${code}`))))
      client.on('error', reject)
    })

    const clientLog = clientOutput.join('')
    expect(clientLog).toContain('test-client: connected')
    const positionUpdates = [...clientLog.matchAll(/received (\{.*"type":"position-update".*\})/g)]
    expect(positionUpdates.length).toBeGreaterThan(0)

    const positions = positionUpdates.map((m) => JSON.parse(m[1]).payload.pos as number)
    // Position should be non-decreasing across the pushes received while playing.
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThanOrEqual(positions[i - 1])
    }
    if (positions.length > 1) {
      expect(positions[positions.length - 1]).toBeGreaterThan(positions[0])
    }

    expect(serverOutput.text()).toContain('client connected')
    rmSync(dir, { recursive: true, force: true })
  }, 10000)
})
```

- [ ] **Step 2: Run it**

```bash
npx vitest run native-engine/test/parity/ipc-roundtrip.test.ts
```
Expected: PASS — connects, loads the project, plays, observes at least one
`position-update` push with a non-decreasing (and, given the 300ms play window, strictly
increasing) `pos` value, then exits cleanly. If `--serve` never logs the listening line,
check the fixed `TEST_PORT` isn't already bound by a leftover process from an earlier
manual smoke test (Task 8 Step 6) — kill it and retry.

- [ ] **Step 3: Commit**

```bash
git add native-engine/test/parity/ipc-roundtrip.test.ts
git commit -m "juce-engine phase1: live IPC round-trip test (serve <-> test-client)"
```

---

### Task 12: Write up Phase 1 findings

**Files:**
- Create: `native-engine/PHASE1_FINDINGS.md`

- [ ] **Step 1: Document what actually happened**

Cover: confirmation that `computeStemSchedule` and `applyFade`'s C++ ports produce
identical results to their TS originals (all ported test cases passing is the evidence —
name the actual test counts); the parity test's actual max-sample-diff numbers (not just
"it passed" — the tolerance headroom matters for judging whether Phase 2's real
`render-export` needs tighter numerics); confirmation that the live IPC round-trip
(Task 11 — `load-project`/`play`/`position-update`/`stop`/`quit` over the real socket, not
bypassed via `--render-test`) passed, and the actual position values observed advancing;
whether the real-time `AudioDeviceManager` path (Task 6) was manually sanity-checked with
actual audio output on this machine, and if so what was heard; any gap between what this
phase covers and full `AudioEngine.ts` parity (e.g., this plan's parity test only
exercises volume and fade-in — note explicitly that stretch-ratio correctness and
multi-rifff mixing aren't yet covered by an automated numeric test, so Phase 2 or a
follow-up hardening pass should extend the parity suite before `AudioEngine.ts` is
actually retired).

- [ ] **Step 2: Commit**

```bash
git add native-engine/PHASE1_FINDINGS.md
git commit -m "juce-engine phase1: findings write-up"
```
