# JUCE Engine Phase 0 — Toolchain Spike Findings

**Result: PASS.** JUCE + VST3 + AudioUnit hosting works on this machine, as a standalone
native console app entirely separate from the Electron/TS side of ssstitch. Both a real
VST3 (iZotope Neutron 4) and a real AudioUnit (Vital) load and process an audio buffer
successfully:

```
Loading VST3: Neutron 4
  OK: "Neutron 4" processed 512 samples, 2 output channel(s).
Loading AU: Vital
  OK: "Vital" processed 512 samples, 2 output channel(s).
Phase 0 spike result: VST3=PASS, AU=PASS
```

This is the deliverable Phase 1's plan should be written against.

## Environment

- macOS, Apple Silicon (arm64), Xcode **Command Line Tools only** (no full Xcode.app —
  `cmake -G Xcode` is unavailable; `Xcode 1.5 not supported` is what CMake reports when
  only CLT is present, not a real Xcode version)
- `clang` 17.0.0 (Apple clang-1700.0.13.5)
- CMake 4.2.0
- JUCE **8.0.4**, pinned via `FetchContent` in `native-engine/CMakeLists.txt`
- Generator: Unix Makefiles (the only viable option here — Xcode unavailable, Ninja not
  installed)

## Build time

A fully clean configure (JUCE cloned from scratch via `FetchContent`, plus building
JUCE's internal `juceaide` helper tool as part of configure) took **~100 seconds**.
Incremental configures after that (cache present, source unchanged) are ~1-2 seconds.
First full build of the console app plus every linked JUCE module (core, events, data
structures, graphics, gui_basics, audio_basics/processors/utils/formats/devices) took a
few minutes. Relevant for CI and dev-onboarding time expectations in later phases —
CI should cache `native-engine/build/_deps` between runs.

## Real findings (not just "it works")

### 1. AudioUnit hosting needs a running message loop, even headless

Calling `AudioPluginFormatManager::createPluginInstance` (or even just scanning) against
an AU without first running `juce::ScopedJuceInitialiser_GUI` **hangs indefinitely** —
confirmed by leaving a scan running for 8+ minutes at ~0.3% CPU with zero progress. AU
component instantiation relies on a CFRunLoop being pumped. Fix: construct a
`const juce::ScopedJuceInitialiser_GUI` at the top of `main()` before any plugin-format
work. This is a one-line fix but easy to miss — JUCE's own console-app template doesn't
include it by default, and the failure mode (silent hang, not an error) makes it easy to
mistake for an environment problem rather than a missing initialization call.

### 2. JUCE's AU scanner has a real bug against Apple's own system component bundles

Even with the message-loop fix, scanning `/System/Library/Components/AudioCodecs.component`
(an Apple-provided multi-type bundle, not a third-party plugin) triggers an **infinite
loop of assertion failures** in `juce_AudioUnitPluginFormat.mm` and `juce_AudioProcessor.cpp`
that never terminates — killed after producing 5GB of repeated assertion log lines.
Reproduced directly and in isolation via `--scan-one`. This is very likely why the
original full-directory scan (`/Library/Audio/Plug-Ins/{VST3,Components}`, ~350
installed plugins on this machine) also hung: at least one installed bundle likely hits
the same code path (aggregate/multi-type AU bundles are common — e.g. `WaveShell-AU
9.6.component` hosts dozens of Waves plugins behind one bundle).

**Implication for Phase 1+**: don't scan directories unattended in-process. Commercial
DAWs scan each plugin candidate in an isolated subprocess with a timeout and quarantine
list for exactly this class of problem — a crashed or hung scan of one plugin shouldn't
take down the whole scan. This wasn't attempted here (out of scope for a toolchain
spike) but is now a known, confirmed-necessary piece of Phase 1's design, not a
hypothetical.

### 3. Several installed plugins have no arm64 slice

`Vital.vst3` and an older installed build of `FabFilter Pro-Q 3.vst3` are x86_64/i386
only — `file` confirms no arm64 slice. Loading these from our arm64-native host fails
cleanly ("The bundle doesn't contain a version for the current architecture."), which is
a real, expected constraint (not a bug): a native arm64 host can't load an Intel-only
plugin binary without Rosetta translation, which JUCE doesn't do transparently. Real
DAWs handle this either by shipping a universal host binary that runs the *whole app*
under Rosetta when needed, or by explicitly building/running an x86_64 scan-and-host
subprocess for legacy-only plugins. Not a Phase 0 blocker (plenty of installed plugins
*are* universal — Neutron 4, RX 10, Vital's AU build, Youlean Loudness Meter 2 all have
arm64 slices), but worth remembering when Phase 1's plan picks which plugins to test
against.

### 4. Given the above, `--scan` and `--spike` use a curated allowlist, not a directory walk

`Main.cpp`'s `knownGoodPaths` lists 4 specific, confirmed-safe, arm64-native plugins (2
VST3, 2 AU) rather than sweeping the real plugin directories. A `--scan-one <path>`
diagnostic mode was added for probing individual plugins by exact path — useful for any
future bisection work when Phase 1 tackles proper sandboxed scanning.

### 5. Minor: instrument AU with 0 input channels trips a debug-only assertion

Loading and processing Vital (an instrument — 0 input channels, 2 output channels) hits
a debug-only JUCE assertion in `juce_AudioSampleBuffer.h:307`, around buffer
channel-count expectations. `processBlock` still completes and returns valid output —
this doesn't affect the PASS result — but Phase 3's real instrument-hosting code should
size buffers per-plugin (`getTotalNumInputChannels()` can legitimately be 0) rather than
assuming at least one channel uniformly, which is what this spike's quick-and-dirty
`loadAndProcessOne` helper does (`jmax(1, ...)`).

### 6. CMake gotcha: declare `LANGUAGES C CXX` at the top level, not just `CXX`

The single most time-consuming issue in this spike wasn't plugin hosting at all — it was
`cmake -B build` failing at the **Generate** step (not Configure) with:

```
CMake Error: Error required internal CMake variable not set, cmake may not be built correctly.
Missing variable is:
CMAKE_C_COMPILE_OBJECT
```

despite C compiler detection succeeding earlier in the same log. Root cause: the
top-level `project()` call only declared `LANGUAGES CXX`; JUCE implicitly enables C
later (for a bundled C dependency) from a nested scope, well into configure. That late,
nested `enable_language(C)` call doesn't fully populate the C rule variables that the
Unix Makefiles generator needs at Generate time, on this CMake version (4.2.0). Reliably
reproduced across three independent clean rebuilds (including a full wipe of
`build/_deps`) — this is deterministic, not cache corruption. **Fix**: declare
`project(ssstitch_engine VERSION 0.1.0 LANGUAGES C CXX)` up front. A minimal standalone
C+CXX test project outside JUCE configured and built fine either way, confirming this is
specifically a JUCE-plus-late-C-enable interaction, not a general toolchain problem.

Also note: the Command Line Tools were mid-reinstall for unrelated reasons earlier in
this session (see prior conversation history) — the compiler's reported build number
changed between the Task 1 and Task 2 builds (`clang-1700.0.6.03` → `clang-1700.0.13.5`).
That was a red herring for this particular bug (ruled out via repeated stable version
checks and a fully clean rebuild that still hit the identical error), but is worth
knowing about if the CMAKE_C_COMPILE_OBJECT error resurfaces on a machine with a
similarly interrupted CLT install.

## Confirmed working end-to-end

- [x] `JUCE_PLUGINHOST_VST3=1` — loads and processes a real installed VST3
- [x] `JUCE_PLUGINHOST_AU=1` — loads and processes a real installed AudioUnit
- [x] `FetchContent`-based JUCE dependency management (no Projucer, no manual submodule)
- [x] `juce::UnitTestRunner`-based unit tests wired into a `--test` CLI flag
