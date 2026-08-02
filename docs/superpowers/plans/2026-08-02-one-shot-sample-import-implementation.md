# One-Shot Sample Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drag a single WAV file from Finder straight onto the arranger and have it land as a placed, non-looping, non-tempo-stretched clip, with unsnapped trim/stretch resize handles on both edges (plain drag trims, Ctrl+drag time-stretches via rubberband on release).

**Architecture:** A one-shot is a lightweight variant of the existing Rifff/Stem model (`oneShot: true` on a single-stem Rifff), reusing every existing mechanism (mute, solo, volume, undo/redo, serialization, export) unmodified. New code is additive: a native-engine render branch that bypasses tiling/resampling, a new Finder-drop import path parallel to the existing Shelf import, new pure drag-math helpers, and a one-shot-aware branch in the existing resize-handle component.

**Tech Stack:** TypeScript/React (renderer), Node/Electron (main process), C++/JUCE (native engine), rubberband CLI (time-stretch).

**Full spec:** `docs/superpowers/specs/2026-08-02-one-shot-sample-import-design.md` — read it before starting; this plan assumes its content.

---

### Task 1: Shared types — `oneShot`/trim fields on `Stem`

**Files:**
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Add the new optional fields to `Stem`**

In `src/shared/types.ts`, replace the `Stem` interface:

```ts
export interface Stem {
  slot: number
  author: string
  name: string
  type: SoundType
  path: string
  durationSec: number
  barLength: number
  /** True for a one-shot sample dropped directly from Finder onto the
   * arranger (see docs/superpowers/specs/2026-08-02-one-shot-sample-import-design.md)
   * -- never tiled/looped, never auto-resampled to match project bpm.
   * Undefined/false for every normal LORE/folder-import-derived stem. */
  oneShot?: boolean
  /** Only meaningful when oneShot is true. How far into the source file
   * playback starts, in seconds. Undefined means 0 (play from the very
   * start). */
  trimStartSec?: number
  /** Only meaningful when oneShot is true. Where playback stops, in
   * seconds, measured from the same origin as trimStartSec (the source
   * file's own start -- NOT relative to trimStartSec). Undefined means
   * durationSec (play to the natural end). */
  trimEndSec?: number
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors (both new fields are optional, so every existing `Stem` literal in the codebase — none of which set them — still satisfies the type).

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "Add oneShot/trimStartSec/trimEndSec fields to Stem"
```

---

### Task 2: Native wire format — `EngineStem`

**Files:**
- Modify: `native-engine/Source/EngineProject.h`
- Modify: `native-engine/Source/EngineProject.cpp`
- Modify: `native-engine/Source/EngineProjectTests.cpp`

- [ ] **Step 1: Add the fields to the `EngineStem` struct**

In `native-engine/Source/EngineProject.h`, inside `struct EngineStem`, after the existing `muted` field:

```cpp
        bool muted = false;
        // See docs/superpowers/specs/2026-08-02-one-shot-sample-import-design.md.
        // When true, PlaybackEngine::renderBlock's one-shot branch is used
        // instead of the normal tile/resample path -- trimStartSec/trimEndSec
        // are only meaningful in that branch.
        bool oneShot = false;
        double trimStartSec = 0.0;
        // -1.0 = unset (play to the stem's own natural durationSec) -- same
        // sentinel convention as startBarOverride above.
        double trimEndSec = -1.0;
```

- [ ] **Step 2: Write the failing parse test**

In `native-engine/Source/EngineProjectTests.cpp`, add a new `beginTest` block right after the existing `"parses a full project with one rifff and one stem"` test (inside `runTest()`, before its closing brace):

```cpp
            beginTest("parses a one-shot stem's oneShot/trim fields");
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
                      "fadeInBars": 0.0,
                      "fadeOutBars": 0.0,
                      "stems": [
                        {
                          "stemKey": "r1:1",
                          "resolvedPath": "/tmp/kick.wav",
                          "durationSec": 0.6,
                          "barLength": 8,
                          "offsetSteps": 0.0,
                          "startBarOverride": -1.0,
                          "volume": 1.0,
                          "muted": false,
                          "oneShot": true,
                          "trimStartSec": 0.1,
                          "trimEndSec": 0.5
                        }
                      ]
                    }
                  ]
                }
                )";
                EngineProject project;
                juce::String error;
                expect(parseEngineProject(json, project, error));
                expect(project.rifffs[0].stems[0].oneShot);
                expectWithinAbsoluteError(project.rifffs[0].stems[0].trimStartSec, 0.1, 1.0e-9);
                expectWithinAbsoluteError(project.rifffs[0].stems[0].trimEndSec, 0.5, 1.0e-9);
            }

            beginTest("defaults oneShot to false and trimEndSec to -1 when omitted");
            {
                EngineProject project;
                juce::String error;
                expect(parseEngineProject(
                    R"({"bpm": 120.0, "snapDiv": 16.0, "rifffs": [{"groupId": "r1", "startBar": 0.0,
                       "barLength": 8, "fadeInBars": 0.0, "fadeOutBars": 0.0, "stems": [
                       {"stemKey": "r1:1", "resolvedPath": "/tmp/a.wav", "durationSec": 1.0,
                        "barLength": 8, "offsetSteps": 0.0, "startBarOverride": -1.0,
                        "volume": 1.0, "muted": false}]}]})",
                    project, error));
                expect(!project.rifffs[0].stems[0].oneShot);
                expectWithinAbsoluteError(project.rifffs[0].stems[0].trimEndSec, -1.0, 1.0e-9);
            }
```

Insert both `beginTest` blocks right before `runTest()`'s own closing brace (after the last pre-existing test).

- [ ] **Step 3: Build and run to verify the new tests fail**

Run:
```bash
cd native-engine/build && cmake --build . && ./sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine --test 2>&1 | grep -A 3 "one-shot"
```
Expected: FAIL — `oneShot`/`trimStartSec`/`trimEndSec` aren't parsed yet, so the first new test's `expect(project.rifffs[0].stems[0].oneShot)` fails (defaults to `false`).

- [ ] **Step 4: Parse the new fields**

In `native-engine/Source/EngineProject.cpp`, inside the stem-parsing loop, right after the existing `stem.muted = getBool(stemVar, "muted", false);` line:

```cpp
                        stem.muted = getBool(stemVar, "muted", false);
                        stem.oneShot = getBool(stemVar, "oneShot", false);
                        stem.trimStartSec = getDouble(stemVar, "trimStartSec", 0.0);
                        stem.trimEndSec = getDouble(stemVar, "trimEndSec", -1.0);
```

- [ ] **Step 5: Rebuild and verify the tests pass**

Run:
```bash
cd native-engine/build && cmake --build . && ./sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine --test 2>&1 | tail -5
```
Expected: `All unit tests passed.`

- [ ] **Step 6: Commit**

```bash
git add native-engine/Source/EngineProject.h native-engine/Source/EngineProject.cpp native-engine/Source/EngineProjectTests.cpp
git commit -m "Parse oneShot/trimStartSec/trimEndSec on the native EngineStem wire format"
```

---

### Task 3: `buildEngineProject.ts` — send the new fields over the wire

**Files:**
- Modify: `src/shared/buildEngineProject.ts`
- Test: `src/shared/buildEngineProject.test.ts`

- [ ] **Step 1: Add the fields to the `EngineStem` wire interface**

In `src/shared/buildEngineProject.ts`, replace the `EngineStem` interface:

```ts
export interface EngineStem {
  stemKey: string
  resolvedPath: string
  durationSec: number
  barLength: number
  playedBars: number
  offsetSteps: number
  startBarOverride: number // -1 means "use the rifff's own startBar"
  volume: number
  muted: boolean
  oneShot: boolean
  trimStartSec: number
  trimEndSec: number // -1 means "play to the stem's own natural durationSec"
}
```

- [ ] **Step 2: Write the failing test**

In `src/shared/buildEngineProject.test.ts`, find the existing test that builds a project from a simple one-rifff `AppState` and checks the resulting `EngineStem` fields (e.g. `volume`/`muted`) — add a case alongside it:

```ts
  it('carries a one-shot stem\'s oneShot/trim fields onto the wire, defaulting trimEndSec to -1 when unset', () => {
    const state = makeStateWithOneRifff({
      groupId: 'r1',
      stems: [
        {
          slot: 1,
          author: 'me',
          name: 'kick',
          type: 'drums',
          path: '/tmp/kick.wav',
          durationSec: 0.6,
          barLength: 8,
          oneShot: true,
          trimStartSec: 0.1
        }
      ]
    })
    const project = buildEngineProject(state)
    const stem = project.rifffs[0].stems[0]
    expect(stem.oneShot).toBe(true)
    expect(stem.trimStartSec).toBeCloseTo(0.1)
    expect(stem.trimEndSec).toBe(-1)
  })
```

If this file has no existing `makeStateWithOneRifff`-style helper, use whatever helper the file's existing tests already use to build a minimal one-rifff `AppState` (check the top of `buildEngineProject.test.ts` for its actual name before writing this step for real — the plan's intent is "reuse the existing fixture helper", not this exact name).

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run src/shared/buildEngineProject.test.ts`
Expected: FAIL — `stem.oneShot` is `undefined` (property doesn't exist on the built object yet).

- [ ] **Step 4: Populate the fields when building the wire stem**

In `src/shared/buildEngineProject.ts`, inside the `stems.push({...})` call, right after the existing `muted: state.mute[key] ?? false` line:

```ts
        volume: state.vol[key] ?? 1,
        muted: state.mute[key] ?? false,
        oneShot: stem.oneShot ?? false,
        trimStartSec: stem.trimStartSec ?? 0,
        trimEndSec: stem.trimEndSec ?? -1
      })
```

(This replaces the existing `muted: state.mute[key] ?? false\n      })` two-line ending with the five-line version above.)

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/shared/buildEngineProject.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/shared/buildEngineProject.ts src/shared/buildEngineProject.test.ts
git commit -m "Send oneShot/trim fields over the EngineProject wire format"
```

---

### Task 4: Native playback — the one-shot render branch

**Files:**
- Modify: `native-engine/Source/PlaybackEngine.cpp`
- Test: `native-engine/Source/PlaybackEngineTests.cpp`

This is the highest-risk task in the plan — it touches the real-time audio render path. Read `native-engine/Source/PlaybackEngine.cpp`'s `renderBlock` function in full before starting (roughly lines 30–270); this task adds one new branch inside its existing per-stem loop, it does not restructure anything else.

- [ ] **Step 1: Write the failing tests**

In `native-engine/Source/PlaybackEngineTests.cpp`, find the existing `beginTest` block that sets up a minimal one-rifff, one-stem project and checks `renderBlock`'s output (e.g. "renders a placed stem's samples at the right position, respects volume") — study its exact fixture-construction pattern (how it builds an `EngineRifff`/`EngineStem` and calls `engine.setProject(...)` then `engine.renderBlock(...)`), then add these three new tests using that same pattern, placed after the existing loop/tiling-related tests:

```cpp
            beginTest("a one-shot stem plays once, never tiled, even when the rifff's bound would imply many tiles");
            {
                auto oneShotFixture = writeFixtureWav("sssketch_pe_oneshot_fixture.wav", 0.8f, 4410); // 0.1s @44100Hz
                EngineProject project;
                project.bpm = 60.0; // secPerBar = 4.0
                project.snapDiv = 16.0;
                EngineRifff rifff;
                rifff.groupId = "r1";
                rifff.startBar = 0.0;
                rifff.barLength = 8; // a normal (non-one-shot) stem this short would tile many times across 8 bars
                EngineStem stem;
                stem.stemKey = "r1:1";
                stem.resolvedPath = oneShotFixture.getFullPathName();
                stem.durationSec = 0.1;
                stem.barLength = 8;
                stem.oneShot = true;
                rifff.stems.push_back(stem);
                project.rifffs.push_back(rifff);

                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry channelChains;
                engine.setProject(project);

                // First block: covers the one-shot's own 0.1s window -- expect real audio.
                std::vector<float> l1(4410, 0.0f), r1(4410, 0.0f);
                engine.renderBlock(0.0, 44100.0, 4410, l1.data(), r1.data(), channelChains);
                expect(std::abs(l1[200]) > 0.0f);

                // Second block: bar 4 (16s in) -- well past where a LOOPED version of
                // this same short stem would have tiled/repeated throughout the
                // rifff's 8-bar span, but still within that declared barLength (so a
                // non-one-shot stem would legitimately still be playing there).
                std::vector<float> l2(512, 0.0f), r2(512, 0.0f);
                engine.renderBlock(4.0, 44100.0, 512, l2.data(), r2.data(), channelChains);
                for (float s : l2) expectEquals(s, 0.0f);
            }

            beginTest("a one-shot stem's playback rate is unaffected by project bpm (no resampling)");
            {
                auto rampFixture = writeRampFixtureWav("sssketch_pe_oneshot_ramp.wav", 44100); // 1s ramp @44100Hz

                auto renderAtBpm = [&](double bpm) {
                    EngineProject project;
                    project.bpm = bpm;
                    project.snapDiv = 16.0;
                    EngineRifff rifff;
                    rifff.groupId = "r1";
                    rifff.startBar = 0.0;
                    rifff.barLength = 8;
                    EngineStem stem;
                    stem.stemKey = "r1:1";
                    stem.resolvedPath = rampFixture.getFullPathName();
                    stem.durationSec = 1.0;
                    stem.barLength = 8;
                    stem.oneShot = true;
                    rifff.stems.push_back(stem);
                    project.rifffs.push_back(rifff);

                    StemBufferCache cache;
                    PlaybackEngine engine(cache);
                    ChannelChainRegistry channelChains;
                    engine.setProject(project);
                    std::vector<float> l(512, 0.0f), r(512, 0.0f);
                    engine.renderBlock(0.0, 44100.0, 512, l.data(), r.data(), channelChains);
                    return l;
                };

                auto slow = renderAtBpm(60.0);
                auto fast = renderAtBpm(240.0);
                // Same trigger position (startBar 0.0 is t=0 regardless of bpm) and
                // same output sample rate -- a one-shot's own source-read position at
                // a given sample index must be identical either way, since bpm must
                // never affect its playback rate (unlike a normal, resampled stem).
                expectWithinAbsoluteError(slow[300], fast[300], 1.0e-6f);
            }

            beginTest("trimStartSec/trimEndSec are respected -- audio outside the trimmed window is silent");
            {
                auto trimFixture = writeFixtureWav("sssketch_pe_oneshot_trim.wav", 0.8f, 44100); // 1s @44100Hz
                EngineProject project;
                project.bpm = 60.0; // secPerBar = 4.0
                project.snapDiv = 16.0;
                EngineRifff rifff;
                rifff.groupId = "r1";
                rifff.startBar = 0.0;
                rifff.barLength = 8;
                EngineStem stem;
                stem.stemKey = "r1:1";
                stem.resolvedPath = trimFixture.getFullPathName();
                stem.durationSec = 1.0;
                stem.barLength = 8;
                stem.oneShot = true;
                stem.trimStartSec = 0.1; // skip the first 4410 samples
                stem.trimEndSec = 0.3;   // stop after 0.2s of played audio (8820 samples)
                rifff.stems.push_back(stem);
                project.rifffs.push_back(rifff);

                StemBufferCache cache;
                PlaybackEngine engine(cache);
                ChannelChainRegistry channelChains;
                engine.setProject(project);

                std::vector<float> l(11025, 0.0f), r(11025, 0.0f); // 0.25s -- covers the trimmed window plus margin
                engine.renderBlock(0.0, 44100.0, 11025, l.data(), r.data(), channelChains);
                // Segment plays from wall-clock 0 to 0.2s (trimEnd - trimStart), i.e.
                // samples [0, 8820) -- silent from 8820 onward.
                expect(std::abs(l[4000]) > 0.0f);   // well within the trimmed window
                expectEquals(l[10000], 0.0f);       // past trimEnd - trimStart -- trimmed off
            }
```

- [ ] **Step 2: Build and run to verify the new tests fail**

Run:
```bash
cd native-engine/build && cmake --build . && ./sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine --test 2>&1 | tail -30
```
Expected: FAIL — a one-shot stem currently falls into the existing tile loop (`stem.oneShot` is parsed but never checked), so it either renders nothing (if the fixture's short `durationSec`/`barLength` combination doesn't line up with the tile math) or tiles/resamples exactly like a normal stem.

- [ ] **Step 3: Add the one-shot render branch**

In `native-engine/Source/PlaybackEngine.cpp`, inside `renderBlock`'s per-stem loop, the existing code reads:

```cpp
                if (stem.muted || stem.volume <= 0.0)
                    continue;
                const auto entry = bufferCache.getEntry(stem.resolvedPath);
                if (entry.buffer == nullptr)
                    continue;
                if (stem.barLength <= 0)
                    continue;
```

Replace it with:

```cpp
                if (stem.muted || stem.volume <= 0.0)
                    continue;
                const auto entry = bufferCache.getEntry(stem.resolvedPath);
                if (entry.buffer == nullptr)
                    continue;

                if (stem.oneShot)
                {
                    // Never tiled, never resampled to project tempo -- see
                    // docs/superpowers/specs/2026-08-02-one-shot-sample-import-design.md.
                    // The trigger TIME is still bar-locked (fires in sync with
                    // the rest of the arrangement, re-times itself if project
                    // bpm later changes) -- only the sample-read RATE is fixed
                    // at 1:1 against wall-clock time, unlike the resampled tile
                    // loop below.
                    const double start = stem.startBarOverride >= 0.0 ? stem.startBarOverride : rifff.startBar;
                    const double triggerSec = start * spb;
                    const double trimStart = std::max(0.0, stem.trimStartSec);
                    const double trimEnd = stem.trimEndSec >= 0.0
                        ? std::min(stem.trimEndSec, stem.durationSec)
                        : stem.durationSec;
                    if (trimEnd <= trimStart)
                        continue;
                    const double segStartSec = triggerSec;
                    const double segEndSec = triggerSec + (trimEnd - trimStart);
                    if (segEndSec <= blockStartSec || segStartSec >= blockEndSec)
                        continue;

                    // fadeConfig is already in scope from this rifff's own
                    // declaration above the stem loop -- a one-shot is always
                    // exactly one segment, so isFirstSegment/isLastSegment are
                    // both unconditionally true here.
                    auto fadePoints = buildFadePoints(
                        segStartSec, segEndSec - segStartSec, true, true, true, fadeConfig);

                    for (int i2 = 0; i2 < numSamples; ++i2)
                    {
                        const double sampleTimeSec = blockStartSec + (double) i2 / sampleRate;
                        if (sampleTimeSec < segStartSec || sampleTimeSec >= segEndSec)
                            continue;
                        const double sourceTimeSec = trimStart + (sampleTimeSec - segStartSec);
                        const int srcSample = (int) std::llround(sourceTimeSec * entry.sampleRate);
                        if (srcSample < 0 || srcSample >= entry.buffer->getNumSamples())
                            continue;
                        const double gain = evaluateGainAtTime(fadePoints, sampleTimeSec) * stem.volume;
                        const int numCh = entry.buffer->getNumChannels();
                        const float l = entry.buffer->getSample(0, srcSample);
                        const float r = numCh > 1 ? entry.buffer->getSample(1, srcSample) : l;
                        chOutL[i2] += (float) (l * gain);
                        chOutR[i2] += (float) (r * gain);
                    }
                    continue; // handled -- skip the tile-loop path below entirely
                }

                if (stem.barLength <= 0)
                    continue;
```

- [ ] **Step 4: Rebuild and verify the tests pass**

Run:
```bash
cd native-engine/build && cmake --build . && ./sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine --test 2>&1 | tail -10
```
Expected: `All unit tests passed.` If a specific sample-index assertion is off by a small amount (e.g. the anti-click fade ramp hasn't fully risen yet at the chosen index), adjust that index the same way the existing "renders a placed stem's samples..." test already documents doing (its own comment explains picking index 200 specifically to land past the ~3ms fade floor) — not a sign the branch itself is wrong.

- [ ] **Step 5: Commit**

```bash
git add native-engine/Source/PlaybackEngine.cpp native-engine/Source/PlaybackEngineTests.cpp
git commit -m "Add one-shot render branch to PlaybackEngine::renderBlock (no tiling, no resampling)"
```

---

### Task 5: Main process — `importOneShot`

**Files:**
- Modify: `src/main/importRifff.ts` (export two existing helpers)
- Create: `src/main/importOneShot.ts`
- Test: `src/main/importOneShot.test.ts`

- [ ] **Step 1: Export the two helpers `importOneShot` needs to reuse**

In `src/main/importRifff.ts`, change:
```ts
function readWavHeaderBytes(path: string): Uint8Array {
```
to:
```ts
export function readWavHeaderBytes(path: string): Uint8Array {
```

And change:
```ts
function libraryRoot(): string {
```
to:
```ts
export function libraryRoot(): string {
```

- [ ] **Step 2: Write the failing test**

Create `src/main/importOneShot.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { encodeWavPCM16 } from '@shared/encodeWav'
import { importOneShot } from './importOneShot'

function writeTestWav(dir: string, name: string, seconds: number, sampleRate = 44100): string {
  const numSamples = Math.round(seconds * sampleRate)
  const channel = new Float32Array(numSamples).fill(0.5)
  const bytes = encodeWavPCM16([channel], sampleRate)
  const path = join(dir, name)
  writeFileSync(path, bytes)
  return path
}

describe('importOneShot', () => {
  it('builds a single-stem oneShot Rifff from a real WAV file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-oneshot-test-'))
    try {
      const path = writeTestWav(dir, 'kick.wav', 0.3)
      const rifff = importOneShot(path)
      expect(rifff).not.toBeNull()
      expect(rifff!.stems).toHaveLength(1)
      expect(rifff!.stems[0].oneShot).toBe(true)
      expect(rifff!.stems[0].durationSec).toBeCloseTo(0.3, 1)
      // Copied into the managed library, not left pointing at the original drop location.
      expect(rifff!.stems[0].path).not.toBe(path)
      expect(existsSync(rifff!.stems[0].path)).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('returns null for a non-WAV file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-oneshot-test-'))
    try {
      const path = join(dir, 'not-audio.txt')
      writeFileSync(path, 'hello')
      expect(importOneShot(path)).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('returns null for a path that does not exist, without throwing', () => {
    expect(importOneShot('/no/such/file.wav')).toBeNull()
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run src/main/importOneShot.test.ts`
Expected: FAIL — `./importOneShot` doesn't exist yet.

- [ ] **Step 4: Implement `importOneShot`**

Create `src/main/importOneShot.ts`:

```ts
// src/main/importOneShot.ts
import { statSync, mkdirSync, copyFileSync, rmSync } from 'fs'
import { join, basename } from 'path'
import { randomUUID } from 'crypto'
import { readWavHeaderBytes, libraryRoot } from './importRifff'
import { readWavDurationSeconds } from '../shared/wavDuration'
import type { Rifff } from '@shared/types'

/**
 * Imports a single file dropped directly onto the arranger as a one-shot
 * sample -- a single-stem Rifff with oneShot: true on its one stem. WAV
 * only for v1 (see docs/superpowers/specs/2026-08-02-one-shot-sample-import-design.md)
 * -- this process has no duration reader for any other format yet. Returns
 * null (never throws) for anything that isn't a readable .wav, matching
 * importRifff's own "can't build a rifff -> return null" convention.
 */
export function importOneShot(path: string): Rifff | null {
  if (!path.toLowerCase().endsWith('.wav')) return null

  let destDir: string | undefined
  try {
    if (!statSync(path).isFile()) return null

    const durationSec = readWavDurationSeconds(readWavHeaderBytes(path))
    if (durationSec <= 0) return null

    const groupId = randomUUID()
    destDir = join(libraryRoot(), groupId)
    mkdirSync(destDir, { recursive: true })
    const destPath = join(destDir, basename(path))
    copyFileSync(path, destPath)

    const displayName = basename(path, '.wav')
    return {
      groupId,
      name: displayName,
      // Cosmetic for a one-shot -- the native engine ignores bpm/barLength
      // for tiling/resampling purposes whenever a stem's oneShot is set
      // (see Stem's own doc comment). Kept populated because existing
      // serialization/Inspector code expects every Rifff to have them.
      bpm: 120,
      barLength: 1,
      folderPath: path,
      stems: [
        {
          slot: 1,
          author: '',
          name: displayName,
          type: 'fx',
          path: destPath,
          durationSec,
          barLength: 1,
          oneShot: true
        }
      ]
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`importOneShot: failed to import ${path}: ${message}`)
    if (destDir) {
      try {
        rmSync(destDir, { recursive: true, force: true })
      } catch (cleanupErr) {
        console.error(`importOneShot: failed to clean up partial import at ${destDir}:`, cleanupErr)
      }
    }
    return null
  }
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/main/importOneShot.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/main/importRifff.ts src/main/importOneShot.ts src/main/importOneShot.test.ts
git commit -m "Add importOneShot: WAV-only single-stem one-shot import"
```

---

### Task 6: IPC + preload wiring

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`

No dedicated test — matches this codebase's existing convention (`import-rifff`'s own IPC registration isn't unit tested either; `importRifff`/`importOneShot` themselves carry the real test coverage). Verified instead by Task 12's manual walkthrough.

- [ ] **Step 1: Register the IPC handler**

In `src/main/index.ts`, add the import near the existing `importRifff` import:

```ts
import { importRifff } from './importRifff'
import { importOneShot } from './importOneShot'
```

Then, right after the existing handler:

```ts
  ipcMain.handle('import-rifff', (_event, paths: string[]) => {
    return importRifff(paths)
  })

  ipcMain.handle('import-one-shot', (_event, path: string) => {
    return importOneShot(path)
  })
```

- [ ] **Step 2: Expose it to the renderer**

In `src/preload/index.ts`, right after the existing `importRifff` entry in the `api` object:

```ts
  importRifff: (paths: string[]): Promise<Rifff | null> =>
    ipcRenderer.invoke('import-rifff', paths),
  importOneShot: (path: string): Promise<Rifff | null> =>
    ipcRenderer.invoke('import-one-shot', path),
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/main/index.ts src/preload/index.ts
git commit -m "Wire importOneShot through IPC and the preload bridge"
```

---

### Task 7: Reducer — `SET_ONE_SHOT_TRIM` and `SET_ONE_SHOT_STRETCHED`

**Files:**
- Modify: `src/renderer/src/state/store.ts`
- Test: `src/renderer/src/state/store.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/renderer/src/state/store.test.ts`, add near the other resize-related `describe` blocks (e.g. next to `SET_GROUP_MUTE`):

```ts
  function makeOneShotRifff(overrides: Partial<Rifff> = {}): Rifff {
    return {
      groupId: 'r1',
      name: 'kick',
      bpm: 120,
      barLength: 1,
      folderPath: '/x/kick.wav',
      stems: [
        {
          slot: 1,
          author: '',
          name: 'kick',
          type: 'fx',
          path: '/x/kick.wav',
          durationSec: 0.6,
          barLength: 1,
          oneShot: true
        }
      ],
      ...overrides
    }
  }

  describe('SET_ONE_SHOT_TRIM', () => {
    it('sets trimStartSec/trimEndSec on the stem and startBar on the rifff', () => {
      let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeOneShotRifff() })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 0 })
      state = reducer(state, {
        type: 'SET_ONE_SHOT_TRIM',
        groupId: 'r1',
        trimStartSec: 0.1,
        trimEndSec: 0.4,
        startBar: 2
      })
      const stem = state.rifffs.r1.stems[0]
      expect(stem.trimStartSec).toBe(0.1)
      expect(stem.trimEndSec).toBe(0.4)
      expect(state.rifffs.r1.startBar).toBe(2)
    })

    it('clamps a negative startBar to 0', () => {
      let state = reducer(initialState, { type: 'ADD_TO_SHELF', rifff: makeOneShotRifff() })
      state = reducer(state, {
        type: 'SET_ONE_SHOT_TRIM',
        groupId: 'r1',
        trimStartSec: 0,
        trimEndSec: 0.5,
        startBar: -3
      })
      expect(state.rifffs.r1.startBar).toBe(0)
    })
  })

  describe('SET_ONE_SHOT_STRETCHED', () => {
    it('replaces the stem\'s path/durationSec, clears any prior trim, and updates startBar', () => {
      let state = reducer(initialState, {
        type: 'ADD_TO_SHELF',
        rifff: makeOneShotRifff({
          stems: [
            {
              slot: 1,
              author: '',
              name: 'kick',
              type: 'fx',
              path: '/x/kick.wav',
              durationSec: 0.6,
              barLength: 1,
              oneShot: true,
              trimStartSec: 0.1,
              trimEndSec: 0.4
            }
          ]
        })
      })
      state = reducer(state, { type: 'PLACE_ON_TIMELINE', groupId: 'r1', startBar: 4 })
      state = reducer(state, {
        type: 'SET_ONE_SHOT_STRETCHED',
        groupId: 'r1',
        path: '/x/kick-stretched.wav',
        durationSec: 0.9,
        startBar: 3
      })
      const stem = state.rifffs.r1.stems[0]
      expect(stem.path).toBe('/x/kick-stretched.wav')
      expect(stem.durationSec).toBe(0.9)
      expect(stem.trimStartSec).toBeUndefined()
      expect(stem.trimEndSec).toBeUndefined()
      expect(state.rifffs.r1.startBar).toBe(3)
    })
  })
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/renderer/src/state/store.test.ts -t "SET_ONE_SHOT_TRIM|SET_ONE_SHOT_STRETCHED"`
Expected: FAIL — both action types are unhandled by the reducer (TypeScript itself will also flag the dispatch calls as errors once you `tsc`, since the action union doesn't include them yet).

- [ ] **Step 3: Add the action types and reducer cases**

In `src/renderer/src/state/store.ts`, add to the action union, near `RESIZE_LEFT`:

```ts
  | { type: 'RESIZE_LEFT'; groupId: string; bars: number; startBar: number }
  | {
      type: 'SET_ONE_SHOT_TRIM'
      groupId: string
      trimStartSec: number
      trimEndSec: number
      startBar: number
    }
  | { type: 'SET_ONE_SHOT_STRETCHED'; groupId: string; path: string; durationSec: number; startBar: number }
```

Then add the reducer cases near the existing `RESIZE_LEFT` case:

```ts
    case 'SET_ONE_SHOT_TRIM': {
      const rifff = state.rifffs[action.groupId]
      const stem = rifff.stems[0]
      return {
        ...state,
        rifffs: {
          ...state.rifffs,
          [action.groupId]: {
            ...rifff,
            startBar: Math.max(0, action.startBar),
            stems: [{ ...stem, trimStartSec: action.trimStartSec, trimEndSec: action.trimEndSec }]
          }
        }
      }
    }

    // Fired once rubberband's offline render resolves (see the ctrl+drag
    // stretch flow in CollapsedRifffRow.tsx) -- replaces the stem's own
    // audio, clearing any prior trim (the drag that produced this new
    // duration already represents the desired final length; a stale trim
    // from before the stretch has no coherent meaning against it).
    case 'SET_ONE_SHOT_STRETCHED': {
      const rifff = state.rifffs[action.groupId]
      const stem = rifff.stems[0]
      return {
        ...state,
        rifffs: {
          ...state.rifffs,
          [action.groupId]: {
            ...rifff,
            startBar: Math.max(0, action.startBar),
            stems: [
              {
                ...stem,
                path: action.path,
                durationSec: action.durationSec,
                trimStartSec: undefined,
                trimEndSec: undefined
              }
            ]
          }
        }
      }
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/renderer/src/state/store.test.ts -t "SET_ONE_SHOT_TRIM|SET_ONE_SHOT_STRETCHED"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/state/store.ts src/renderer/src/state/store.test.ts
git commit -m "Add SET_ONE_SHOT_TRIM and SET_ONE_SHOT_STRETCHED reducer actions"
```

---

### Task 8: Pure drag-math helpers — `oneShotResize.ts`

**Files:**
- Create: `src/renderer/src/components/oneShotResize.ts`
- Test: `src/renderer/src/components/oneShotResize.test.ts`

Extracting the trim/stretch pixel-math into pure functions (rather than inlining it into the drag handlers directly) matches this codebase's existing convention of pulling drag math out into testable siblings (e.g. `dragGrabOffset.ts`, `envelope.ts`) — the actual mousedown/mousemove wiring in Task 10 stays thin, and the arithmetic gets real unit tests instead of only being exercised by clicking around in a running app.

- [ ] **Step 1: Write the failing tests**

Create `src/renderer/src/components/oneShotResize.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  MIN_ONE_SHOT_SEC,
  trimRightEdge,
  trimLeftEdge,
  targetDurationForRightEdgeStretch,
  targetDurationForLeftEdgeStretch,
  stretchRatioForTargetDuration,
  oneShotWidthBars
} from './oneShotResize'

describe('trimRightEdge', () => {
  it('shrinks trimEndSec by the dragged amount', () => {
    expect(trimRightEdge(0.6, -0.2, 0, 0.6)).toBeCloseTo(0.4)
  })

  it('never exceeds the sample\'s natural duration', () => {
    expect(trimRightEdge(0.6, 0.5, 0, 0.6)).toBe(0.6)
  })

  it('never drops below trimStartSec + the minimum floor', () => {
    expect(trimRightEdge(0.6, -10, 0.2, 0.6)).toBeCloseTo(0.2 + MIN_ONE_SHOT_SEC)
  })
})

describe('trimLeftEdge', () => {
  it('grows trimStartSec by the dragged amount', () => {
    expect(trimLeftEdge(0, 0.15, 0.6)).toBeCloseTo(0.15)
  })

  it('never goes negative', () => {
    expect(trimLeftEdge(0.1, -5, 0.6)).toBe(0)
  })

  it('never reaches trimEndSec', () => {
    expect(trimLeftEdge(0.1, 10, 0.6)).toBeCloseTo(0.6 - MIN_ONE_SHOT_SEC)
  })
})

describe('targetDurationForRightEdgeStretch', () => {
  it('extending right grows duration', () => {
    expect(targetDurationForRightEdgeStretch(0.6, 0.4)).toBeCloseTo(1.0)
  })

  it('never drops below the minimum floor', () => {
    expect(targetDurationForRightEdgeStretch(0.6, -10)).toBe(MIN_ONE_SHOT_SEC)
  })
})

describe('targetDurationForLeftEdgeStretch', () => {
  it('dragging left (negative delta) grows duration -- mirror image of the right edge', () => {
    expect(targetDurationForLeftEdgeStretch(0.6, -0.4)).toBeCloseTo(1.0)
  })

  it('never drops below the minimum floor', () => {
    expect(targetDurationForLeftEdgeStretch(0.6, 10)).toBe(MIN_ONE_SHOT_SEC)
  })
})

describe('stretchRatioForTargetDuration', () => {
  it('a shorter target duration means a ratio > 1 (speed up), matching rubberband.ts\'s own convention', () => {
    expect(stretchRatioForTargetDuration(1.0, 0.5)).toBeCloseTo(2.0)
  })

  it('a longer target duration means a ratio < 1 (slow down)', () => {
    expect(stretchRatioForTargetDuration(1.0, 2.0)).toBeCloseTo(0.5)
  })

  it('clamps the target against the minimum floor rather than dividing by ~0', () => {
    expect(stretchRatioForTargetDuration(1.0, 0)).toBeCloseTo(1.0 / MIN_ONE_SHOT_SEC)
  })
})

describe('oneShotWidthBars', () => {
  it('converts a real duration into bars at the project tempo, independent of the rifff\'s own cosmetic bpm/barLength', () => {
    // 120bpm -> secPerBar = (60/120)*4 = 2s/bar. A 0.6s one-shot is 0.3 bars wide.
    expect(oneShotWidthBars(0.6, 120)).toBeCloseTo(0.3)
  })

  it('a longer duration produces proportionally more bars', () => {
    expect(oneShotWidthBars(4.0, 120)).toBeCloseTo(2.0)
  })
})
```

Note: this last `describe` block requires importing `oneShotWidthBars` too -- add it to the existing `import { ... } from './oneShotResize'` line at the top of the test file, alongside the other five names already listed there.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/renderer/src/components/oneShotResize.test.ts`
Expected: FAIL — `./oneShotResize` doesn't exist yet.

- [ ] **Step 3: Implement the helpers**

Create `src/renderer/src/components/oneShotResize.ts`:

```ts
// src/renderer/src/components/oneShotResize.ts

/** Never trim/stretch a one-shot to literally nothing -- a 10ms floor. */
export const MIN_ONE_SHOT_SEC = 0.01

/** Plain drag on the RIGHT edge: shrinks trimEndSec. Left edge/start stays
 * fixed -- the caller doesn't need to touch startBar for this one.
 * deltaSec is signed (negative = dragged left = shorter). Clamped so
 * trimEndSec never exceeds durationSec and never drops below
 * trimStartSec + MIN_ONE_SHOT_SEC. */
export function trimRightEdge(
  startTrimEndSec: number,
  deltaSec: number,
  trimStartSec: number,
  durationSec: number
): number {
  const requested = startTrimEndSec + deltaSec
  return Math.max(trimStartSec + MIN_ONE_SHOT_SEC, Math.min(durationSec, requested))
}

/** Plain drag on the LEFT edge: grows trimStartSec. The caller is
 * responsible for moving the clip's startBar forward by the bar-equivalent
 * of the same delta, so the right edge (end-of-playback point) stays fixed
 * in time. deltaSec positive = dragged right = trims more off the start.
 * Clamped so trimStartSec never goes negative and never reaches
 * trimEndSec. */
export function trimLeftEdge(startTrimStartSec: number, deltaSec: number, trimEndSec: number): number {
  const requested = startTrimStartSec + deltaSec
  return Math.max(0, Math.min(trimEndSec - MIN_ONE_SHOT_SEC, requested))
}

/** Ctrl+drag on the RIGHT edge: dragging right grows the target duration
 * (stretches longer), dragging left shrinks it. */
export function targetDurationForRightEdgeStretch(nativeDurationSec: number, deltaSec: number): number {
  return Math.max(MIN_ONE_SHOT_SEC, nativeDurationSec + deltaSec)
}

/** Ctrl+drag on the LEFT edge: mirror image of the right edge -- dragging
 * left (negative deltaSec) grows the target duration, dragging right
 * shrinks it. */
export function targetDurationForLeftEdgeStretch(nativeDurationSec: number, deltaSec: number): number {
  return Math.max(MIN_ONE_SHOT_SEC, nativeDurationSec - deltaSec)
}

/** The rubberband --tempo ratio a target duration implies, given the
 * sample's own native duration. ratio > 1 speeds up (shorter output),
 * ratio < 1 slows down (longer output) -- same convention
 * rubberband.ts's own renderStretched already documents and relies on.
 * The target is clamped against MIN_ONE_SHOT_SEC first so this never
 * divides by (near) zero. */
export function stretchRatioForTargetDuration(nativeDurationSec: number, targetDurationSec: number): number {
  const clampedTarget = Math.max(MIN_ONE_SHOT_SEC, targetDurationSec)
  return nativeDurationSec / clampedTarget
}

/** How many bars wide a one-shot clip's on-screen box should be at the
 * project's current tempo -- unlike a normal rifff, a one-shot's on-screen
 * width must represent its own REAL duration (durationSec, adjusted for
 * any trim), never state.stretch/rifff.bpm-based scaling (clipGeometry's
 * own formula, which a one-shot's cosmetic bpm/barLength would otherwise
 * feed nonsense into). Same (60/bpm)*4 = secPerBar formula this codebase
 * already duplicates inline in several other files (buildRifff.ts,
 * reOneScoring.ts, buildEngineProject.ts) rather than centralizing. */
export function oneShotWidthBars(durationSec: number, projectBpm: number): number {
  const secPerBar = (60 / projectBpm) * 4
  return durationSec / secPerBar
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/renderer/src/components/oneShotResize.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/oneShotResize.ts src/renderer/src/components/oneShotResize.test.ts
git commit -m "Add pure trim/stretch drag-math helpers for one-shot resize handles"
```

---

### Task 9: Renderer drop flow — direct-to-arranger Finder drop

**Files:**
- Modify: `src/renderer/src/App.tsx`

No dedicated unit test — `resolveDrop` is a closure inside `Timeline`, not exported, and this codebase has no existing test harness for drag/drop event handlers (the two existing internal-drag branches it already handles aren't unit tested either). Verified by Task 12's manual walkthrough instead.

- [ ] **Step 1: Make `resolveDrop` async and add the file-drop branch**

In `src/renderer/src/App.tsx`, change the function signature:

```ts
  function resolveDrop(e: DragEvent<HTMLDivElement>, targetChannelId: string | undefined): void {
```

to:

```ts
  async function resolveDrop(e: DragEvent<HTMLDivElement>, targetChannelId: string | undefined): Promise<void> {
```

Then find:

```ts
    const groupId = e.dataTransfer.getData('text/rifff-group-id')
    if (!groupId) return
```

and replace it with:

```ts
    const groupId = e.dataTransfer.getData('text/rifff-group-id')
    if (!groupId) {
      // A real Finder drop, not an internal rifff drag -- each dropped file
      // becomes its own independent one-shot. Sharing targetChannelId (if
      // any) means several files dropped together on an existing
      // ChannelRow all land on that same channel; dropping on empty/ghost
      // space instead calls crypto.randomUUID() fresh per file, giving
      // each its own new channel -- same rule already used for a single
      // internal-drag drop above, just applied per file. See
      // docs/superpowers/specs/2026-08-02-one-shot-sample-import-design.md.
      const files = Array.from(e.dataTransfer.files)
      if (files.length === 0) return
      for (const file of files) {
        const path = window.rifffApi.getPathForFile(file)
        const rifff = await window.rifffApi.importOneShot(path)
        if (!rifff) continue
        dispatch({ type: 'ADD_TO_SHELF', rifff })
        const channelId = targetChannelId ?? crypto.randomUUID()
        dispatch({ type: 'MOVE_TO_CHANNEL', groupId: rifff.groupId, startBar, channelId })
      }
      return
    }
```

- [ ] **Step 2: Mark the two call sites as deliberately-unawaited**

`resolveDrop` is now async but its two callers (`handleDrop`, `handleDropOnChannel`) are plain `onDrop` event handlers that don't await it — matching this codebase's own existing convention for fire-and-forget IPC calls (e.g. `void window.rifffApi.engineSetPosition(bar)` elsewhere in this same file). Find:

```ts
  function handleDropOnChannel(e: DragEvent<HTMLDivElement>, channelId: string): void {
    resolveDrop(e, channelId)
  }
```

and change the call to:

```ts
  function handleDropOnChannel(e: DragEvent<HTMLDivElement>, channelId: string): void {
    void resolveDrop(e, channelId)
  }
```

Then find `handleDrop`'s own call to `resolveDrop` (the Timeline container's own background-drop handler, a few lines below `resolveDrop`'s definition) and apply the identical `void` prefix there too.

- [ ] **Step 3: Typecheck and lint**

Run: `npx tsc --noEmit -p . && npx eslint src/renderer/src/App.tsx`
Expected: no errors. If eslint flags a floating-promise warning anywhere `resolveDrop` is called without `void`, add `void` there too.

- [ ] **Step 4: Run the full test suite to confirm nothing broke**

Run: `npx vitest run`
Expected: all existing tests still pass (this task doesn't change any tested behavior — the two existing drag branches are untouched, only a new branch was added below them).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/App.tsx
git commit -m "Handle direct Finder-to-arranger drops as one-shot imports"
```

---

### Task 10: `CollapsedRifffRow` — one-shot resize handles

**Files:**
- Modify: `src/renderer/src/components/CollapsedRifffRow.tsx`

This is the second highest-risk task in the plan (see the spec's own flagged risk: left-edge anchoring is a genuinely fiddly class of bug — task #166, still open, is exactly that class of bug in the *existing* `RESIZE_LEFT` mechanism). No dedicated unit test for this component — matches this codebase's existing convention (neither of `CollapsedRifffRow`'s current resize handlers has one either; the underlying math they'd need to test was already extracted and tested in Task 8). Verified by Task 12's manual walkthrough, with special attention to the anchor behavior called out in Step 4 below.

A one-shot rifff always has exactly one stem (enforced by `importOneShot`), so `CollapsedRifffRow` is the only row-rendering component that needs to change — Task 11 makes sure a one-shot never reaches the *other* per-stem view (`StemWaveformRow`) at all, so that component needs no changes here.

- [ ] **Step 1: Add imports and one-shot derived state**

In `src/renderer/src/components/CollapsedRifffRow.tsx`, add to the top-of-file imports:

```ts
import {
  trimRightEdge,
  trimLeftEdge,
  targetDurationForRightEdgeStretch,
  targetDurationForLeftEdgeStretch,
  stretchRatioForTargetDuration,
  oneShotWidthBars
} from './oneShotResize'
```

Then, inside `CollapsedRifffRow`, right after the existing `const firstStem = rifff.stems[0]` line, add:

```ts
  const isOneShot = rifff.stems.length === 1 && !!firstStem.oneShot
  const oneShotStem = isOneShot ? firstStem : null
  const secPerBar = (60 / state.bpm) * 4
```

And, alongside the existing `dragPlayedBars`/`dragLeftResize` state declarations, add:

```ts
  // One-shot-only live drag preview -- separate from dragPlayedBars/
  // dragLeftResize above, which a one-shot never uses (its resize handles
  // are unsnapped seconds-based trim/stretch, not bar-snapped playedBars).
  const [oneShotDragPreview, setOneShotDragPreview] = useState<{
    durationSec: number
    startBar: number
  } | null>(null)
```

- [ ] **Step 2: Override geometry for a one-shot**

Find the existing geometry block:

```ts
  const geo = clipGeometry(state, groupId, PPB)
  const nudgeOffsetPx = geo.leftPx - baseStartBar * PPB
  const displayedStartBar = dragLeftResize?.startBar ?? baseStartBar
  const leftPx = displayedStartBar * PPB + nudgeOffsetPx
  const widthPx =
    dragPlayedBars !== null
      ? dragPlayedBars * PPB
      : dragLeftResize !== null
        ? dragLeftResize.playedBars * PPB
        : geo.widthPx
```

Replace it with:

```ts
  const geo = clipGeometry(state, groupId, PPB)
  const nudgeOffsetPx = geo.leftPx - baseStartBar * PPB
  const oneShotCommittedDurationSec =
    oneShotStem != null
      ? (oneShotStem.trimEndSec ?? oneShotStem.durationSec) - (oneShotStem.trimStartSec ?? 0)
      : 0
  const displayedStartBar = isOneShot
    ? (oneShotDragPreview?.startBar ?? baseStartBar)
    : (dragLeftResize?.startBar ?? baseStartBar)
  const leftPx = displayedStartBar * PPB + nudgeOffsetPx
  const widthPx = isOneShot
    ? oneShotWidthBars(oneShotDragPreview?.durationSec ?? oneShotCommittedDurationSec, state.bpm) * PPB
    : dragPlayedBars !== null
      ? dragPlayedBars * PPB
      : dragLeftResize !== null
        ? dragLeftResize.playedBars * PPB
        : geo.widthPx
```

- [ ] **Step 3: Add the one-shot resize handlers**

Right after the existing `handleLeftResizeStart` function (which stays unchanged — it's only reachable for a non-one-shot rifff after Step 4 below wires the handles conditionally), add:

```ts
  function handleOneShotRightEdgeStart(e: React.MouseEvent): void {
    if (!oneShotStem) return
    const isStretch = e.ctrlKey
    const trimStartSec = oneShotStem.trimStartSec ?? 0
    const committedTrimEndSec = oneShotStem.trimEndSec ?? oneShotStem.durationSec
    const nativeDurationSec = oneShotStem.durationSec
    let finalDurationSec = committedTrimEndSec - trimStartSec
    let finalTrimEndSec = committedTrimEndSec
    startPointerDrag(
      e,
      (deltaX) => {
        const deltaSec = (deltaX / PPB) * secPerBar
        if (isStretch) {
          finalDurationSec = targetDurationForRightEdgeStretch(nativeDurationSec, deltaSec)
        } else {
          finalTrimEndSec = trimRightEdge(committedTrimEndSec, deltaSec, trimStartSec, nativeDurationSec)
          finalDurationSec = finalTrimEndSec - trimStartSec
        }
        setOneShotDragPreview({ durationSec: finalDurationSec, startBar: baseStartBar })
      },
      (moved) => {
        if (moved) {
          if (isStretch) {
            const ratio = stretchRatioForTargetDuration(nativeDurationSec, finalDurationSec)
            void window.rifffApi
              .renderStretched(oneShotStem.path, ratio)
              .then((result) => {
                dispatch({
                  type: 'SET_ONE_SHOT_STRETCHED',
                  groupId,
                  path: result.path,
                  durationSec: result.durationSec,
                  startBar: baseStartBar
                })
              })
              .catch((err) => {
                // Fails safely -- no dispatch, so the clip's trim/stretch
                // state is left exactly as it was before this drag. Same
                // "fails safely, no partial state" precedent as the
                // existing bake-stem error path.
                console.error('One-shot ctrl-drag stretch failed:', err)
              })
          } else {
            dispatch({
              type: 'SET_ONE_SHOT_TRIM',
              groupId,
              trimStartSec,
              trimEndSec: finalTrimEndSec,
              startBar: baseStartBar
            })
          }
        }
        setOneShotDragPreview(null)
      }
    )
  }

  function handleOneShotLeftEdgeStart(e: React.MouseEvent): void {
    if (!oneShotStem) return
    const isStretch = e.ctrlKey
    const committedTrimStartSec = oneShotStem.trimStartSec ?? 0
    const trimEndSec = oneShotStem.trimEndSec ?? oneShotStem.durationSec
    const committedDurationSec = trimEndSec - committedTrimStartSec
    const nativeDurationSec = oneShotStem.durationSec
    const startPosBar = baseStartBar
    let finalDurationSec = committedDurationSec
    let finalTrimStartSec = committedTrimStartSec
    let finalStartBar = startPosBar
    startPointerDrag(
      e,
      (deltaX) => {
        const deltaSec = (deltaX / PPB) * secPerBar
        if (isStretch) {
          finalDurationSec = targetDurationForLeftEdgeStretch(nativeDurationSec, deltaSec)
        } else {
          finalTrimStartSec = trimLeftEdge(committedTrimStartSec, deltaSec, trimEndSec)
          finalDurationSec = trimEndSec - finalTrimStartSec
        }
        // The right edge (end-of-playback point) must stay fixed in
        // absolute time -- startBar shifts by exactly the change in
        // duration, so only the visible LEFT edge appears to move. This is
        // the exact anchor invariant Step 4's tests below check.
        finalStartBar = Math.max(
          0,
          startPosBar + oneShotWidthBars(committedDurationSec - finalDurationSec, state.bpm)
        )
        setOneShotDragPreview({ durationSec: finalDurationSec, startBar: finalStartBar })
      },
      (moved) => {
        if (moved) {
          if (isStretch) {
            const ratio = stretchRatioForTargetDuration(nativeDurationSec, finalDurationSec)
            void window.rifffApi
              .renderStretched(oneShotStem.path, ratio)
              .then((result) => {
                dispatch({
                  type: 'SET_ONE_SHOT_STRETCHED',
                  groupId,
                  path: result.path,
                  durationSec: result.durationSec,
                  startBar: finalStartBar
                })
              })
              .catch((err) => {
                console.error('One-shot ctrl-drag stretch failed:', err)
              })
          } else {
            dispatch({
              type: 'SET_ONE_SHOT_TRIM',
              groupId,
              trimStartSec: finalTrimStartSec,
              trimEndSec,
              startBar: finalStartBar
            })
          }
        }
        setOneShotDragPreview(null)
      }
    )
  }
```

- [ ] **Step 4: Wire the two handles to the new handlers for a one-shot**

Find the two existing resize-handle `<div>`s (`onMouseDown={handleLeftResizeStart}` and `onMouseDown={handleResizeStart}`). Change their `onMouseDown` props to branch on `isOneShot`:

```tsx
          <div
            onMouseDown={isOneShot ? handleOneShotLeftEdgeStart : handleLeftResizeStart}
            onContextMenu={(e) => e.stopPropagation()}
            title={
              isOneShot
                ? 'drag to trim · ctrl+drag to stretch'
                : `${displayedPlayedBars} bars`
            }
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: 0,
              width: 5,
              cursor: 'ew-resize',
              background: 'var(--ra-text)',
              opacity: 0.12,
              zIndex: 3
            }}
          />
          <div
            onMouseDown={isOneShot ? handleOneShotRightEdgeStart : handleResizeStart}
            onContextMenu={(e) => e.stopPropagation()}
            title={
              isOneShot
                ? 'drag to trim · ctrl+drag to stretch'
                : `${displayedPlayedBars} bars`
            }
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              right: 0,
              width: 5,
              cursor: 'ew-resize',
              background: 'var(--ra-text)',
              opacity: 0.12,
              zIndex: 3
            }}
          />
```

- [ ] **Step 5: Typecheck, lint, and full test suite**

Run: `npx tsc --noEmit -p . && npx eslint src/renderer/src/components/CollapsedRifffRow.tsx && npx vitest run`
Expected: no errors; all existing tests still pass (this task only adds a new conditional branch — the non-one-shot path through both handlers and the geometry block is byte-for-byte unchanged).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/CollapsedRifffRow.tsx
git commit -m "Wire one-shot trim/ctrl-stretch resize handles into CollapsedRifffRow"
```

---

### Task 11: `RifffBlockRow` force-collapsed + `Inspector` hides bpm/stretch controls

**Files:**
- Modify: `src/renderer/src/components/RifffBlockRow.tsx`
- Modify: `src/renderer/src/components/Inspector.tsx`

No dedicated test — both are small, low-risk conditional-rendering changes. Verified by Task 12's manual walkthrough.

- [ ] **Step 1: Force a one-shot to always render collapsed**

In `src/renderer/src/components/RifffBlockRow.tsx`, find:

```ts
  const expanded = !!state.exp[groupId]
```

Replace it with:

```ts
  // A one-shot always has exactly one stem (enforced by importOneShot) --
  // there's nothing extra an expanded per-stem view would show that
  // CollapsedRifffRow doesn't already, and CollapsedRifffRow is the only
  // place the one-shot-aware trim/stretch resize handles are wired (Task
  // 10) -- StemWaveformRow's own handles are still the bar-snapped
  // playedBars/RESIZE_LEFT ones, which would be wrong for a one-shot.
  const isOneShot = rifff.stems.length === 1 && !!rifff.stems[0].oneShot
  const expanded = !!state.exp[groupId] && !isOneShot
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 3: Hide the bpm/stretch section in the Inspector for a one-shot**

In `src/renderer/src/components/Inspector.tsx`, add right after the existing `const stretchOn = state.stretch[groupId] ?? true` line:

```ts
  const isOneShot = rifff.stems.length === 1 && !!rifff.stems[0].oneShot
```

Then find the bpm/stretch section — it starts with:

```tsx
      {section(
        <>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginTop: 8
            }}
          >
            <div>
              <span style={{ fontSize: 19, fontWeight: 700 }}>{formatBpm(rifff.bpm)}</span>
```

and ends with (immediately before the next `{section(` call):

```tsx
          </div>
        </>
      )}
```

Wrap the whole thing (from `{section(` to its matching `)}`) in `{!isOneShot && ( ... )}` — i.e. change the opening from `{section(` to `{!isOneShot && section(`, and leave the closing `)}` as-is (it already closes both the `section(...)` call and, with the added `&&`, the new conditional). Concretely, change only the very first line of this block:

```tsx
      {!isOneShot && section(
        <>
```

(everything else in the block — the bpm display, the stretch toggle button, the "stretched X% to fit..." caption — stays completely unchanged).

- [ ] **Step 4: Typecheck and lint**

Run: `npx tsc --noEmit -p . && npx eslint src/renderer/src/components/Inspector.tsx src/renderer/src/components/RifffBlockRow.tsx`
Expected: no errors.

- [ ] **Step 5: Full test suite**

Run: `npx vitest run`
Expected: all tests pass (both changes are purely conditional — the non-one-shot path is unchanged).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/RifffBlockRow.tsx src/renderer/src/components/Inspector.tsx
git commit -m "Force one-shot rifffs to render collapsed; hide bpm/stretch controls in Inspector"
```

---

### Task 12: Final verification + manual walkthrough

**Files:** none (verification only)

- [ ] **Step 1: Full native engine rebuild + test**

```bash
cd native-engine/build && cmake --build . && ./sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine --test 2>&1 | tail -15
```
Expected: `All unit tests passed.`, zero compiler warnings in the build output above it.

- [ ] **Step 2: Full JS/TS verification**

```bash
npx tsc --noEmit -p . && npx eslint . && npx vitest run
```
Expected: no typecheck errors, no lint errors/warnings, all tests pass (this will include every test added across Tasks 1–11).

- [ ] **Step 3: Manual walkthrough**

This feature is fundamentally drag-and-drop and mouse-drag interaction — it can't be exercised through a scripted wire-protocol test the way a headless engine feature could (see how the x86 plugin bridge's own final verification substituted a raw-socket script for GUI interaction; that approach doesn't apply here since there's no way to synthesize a real OS-level Finder drag from a script). This step needs a real run of the app:

```bash
npm run dev
```

Then, by hand:
1. Drag a real `.wav` file from Finder directly onto an empty area of the arranger. Confirm it lands placed immediately (no separate Shelf-then-drag step), on its own new channel, at the bar position dropped.
2. Play the project. Confirm the sample plays once, at its natural pitch/speed, and does not repeat/tile even if the clip visually spans multiple bars.
3. Change the project bpm. Confirm the one-shot's own playback speed/pitch is unaffected (it should sound identical, just trigger at a different point in the bar grid).
4. Drag the right edge left (plain drag). Confirm the clip visually shortens and playback is cut short at the new boundary, with no pop/click at the cut.
5. Drag the right edge right past the sample's natural length. Confirm it clamps — no silence padding, no looping.
6. Ctrl+drag the right edge right. Confirm the clip visually extends live while dragging, and on release the sample plays back audibly slower and longer, with its pitch unchanged (not lower — that would mean plain resampling instead of a real time-stretch).
7. Drag the left edge right (plain drag). Confirm the clip trims from the start AND the right edge's playback end point does not move (play the project and listen for the tail landing at the same moment as before the drag).
8. Ctrl+drag the left edge. Confirm the same right-edge-anchored behavior, but via stretch (slower/faster playback, not truncation) — this is the specific anchor behavior flagged as a risk in the design spec; take extra care checking it.
9. Drop several `.wav` files at once directly onto an existing channel with a clip already on it. Confirm each becomes its own one-shot, all sharing that channel.
10. Drop several `.wav` files at once onto empty space. Confirm each gets its own new channel.
11. Select a placed one-shot and check the Inspector — confirm no bpm/stretch controls are shown.
12. Click a one-shot's name bar (the expand/collapse toggle spot). Confirm it does not expand into a per-stem detail view.
13. Confirm mute, solo, volume-drag, and fade handles all still work normally on a one-shot clip (they're untouched by this plan — this just confirms nothing else broke).
14. Save the project, reload it, confirm the one-shot's placement/trim state survives serialization (this plan doesn't touch `serialize.ts` deliberately — `Stem`'s new optional fields round-trip through the existing generic serialization automatically, but this step confirms that assumption holds in practice).

- [ ] **Step 4: Report results**

Summarize which of the 14 manual checks passed, and file anything that didn't as a follow-up rather than leaving it silently unverified.

---

## Explicit scope decisions carried over from the design spec

- WAV only for v1 — no AIFF/MP3/Ogg import.
- No per-clip toggle back into loop/stretch-to-tempo behavior.
- Ctrl-stretch is commit-on-release, not continuous live-audio preview.
- Left-edge trim/stretch is included (this was added during spec review — not deferred).

