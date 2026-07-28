# JUCE Engine Phase 1 — Playback Parity Findings

**Result: PASS.** The native engine now reimplements `AudioEngine.ts`'s core playback
model — stem scheduling, offset/mute/volume, fade-in/fade-out, unlinked-stem positions,
multi-stem summation — in C++, and it has been proven correct against the existing Web
Audio math via an automated parity test, and proven to work over the real IPC socket via a
live round-trip test. Six real bugs were found and fixed along the way (detailed below);
none were cosmetic — three would have produced audibly wrong output or a hung process if
shipped.

## Test counts (independently re-run for this doc)

C++ side, `./build/ssstitch_engine_artefacts/Debug/ssstitch_engine --test`:

```
32 individual test cases, all passing (exit code 0)
  PluginScanner    2  (Phase 0)
  SchedulePlayback 6
  FadeGain         8
  EngineProject    5
  StemBufferCache  3
  PlaybackEngine   8
```

TS side, `npx vitest run` from the worktree root:

```
Test Files  19 passed (19)
     Tests  152 passed (152)
```

(Up from 142 tests / 17 files before Phase 1 started — the two new files are
`native-engine/test/parity/render-parity.test.ts` and
`native-engine/test/parity/ipc-roundtrip.test.ts`.)

All ported test cases passing — the 6 `SchedulePlayback` cases mirroring
`computeStemSchedule.test.ts`'s scenarios and the 8 `FadeGain` cases mirroring
`applyFade.test.ts`'s — is the evidence that those two ports produce identical behavior to
their TS originals across the same scenario matrix (loop-length matching, shorter loops,
`startBarOverride`, offset-step shifting, position-based dropping, final-repetition
clipping for `SchedulePlayback`; fresh fade-in, fade-out, first-and-last, middle segment,
resume-mid-segment, oversized-fade clamping, and `evaluateGainAtTime` interpolation for
`FadeGain`).

## Parity test numbers (the ones that matter for judging numeric headroom)

`native-engine/test/parity/render-parity.test.ts` renders a ~176,400-sample (4 s @ 44.1kHz)
buffer through the actual `--render-test` CLI path and diffs it, 16-bit-sample by
16-bit-sample, against the reference Web Audio math computed in TS. Re-run for this doc:

```
render-parity: volume-only test maxDiff = 1
render-parity: fade-in test maxDiff = 1
```

Both assertions use `expect(maxDiff).toBeLessThanOrEqual(2)` (a "16-bit rounding
tolerance" per the test's own comment). So both tests are currently passing with exactly
**one unit of headroom** out of a tolerance of two — not comfortably clear of the bound.
That headroom is fully explained by ordinary int16 rounding in two independent
16-bit-quantization steps (JUCE's WAV writer and the TS reference path), not by any
remaining approximation error in the engine's math — but it does mean a later phase
attempting a real `render-export` parity check (multi-stem, stretch-ratio, multi-rifff)
should not assume there's several ULPs of slack to spend; if a later change nudges the
native math even slightly, this margin could tip into failure and would need
investigation rather than a reflexive tolerance bump.

## IPC round-trip

`native-engine/test/parity/ipc-roundtrip.test.ts` spawns a real `--serve` process and a
real `--test-client` process (not an in-process/bypassed connection — two separate OS
processes talking over a real `127.0.0.1` TCP socket) and drives the full message sequence
`load-project` → `play` → (a burst of `position-update` pushes) → `stop` → `quit`. Re-run
for this doc, 3 times, all green:

```
Test Files  1 passed (1)
     Tests  1 passed (1)
```

Also ran the two binaries manually outside the vitest harness (same message sequence) to
capture the actual position values pushed by the server's 30Hz position-update timer.
Three independent runs, all monotonically increasing as required:

```
run 1: 0.0116 → 0.0203 → 0.0319 → 0.0435 → 0.0493 → 0.0610 → 0.0697
run 2: 0.0116 → 0.0203 → 0.0319 → 0.0377 → 0.0493 → 0.0580 → 0.0668
run 3: 0.0087 → 0.0145 → 0.0261 → 0.0348 → 0.0464 → 0.0580 → 0.0668
```

(Values vary slightly run-to-run because the client's fixed 300ms sleep vs. the server's
30Hz timer isn't phase-locked — expected, not a bug.) The server process also exits with
code 0 after the `quit` message in every run, confirmed via `wait $PID; echo $?`.

## Real-time `AudioDeviceManager` path: NOT manually verified, and has two known code-level hazards

The `Transport`/`AudioDeviceManager` wrapper (`Source/Transport.cpp`, Task 6) compiles
clean and `runServe` calls `transport.openDefaultDevice()` best-effort at startup
(`Source/Main.cpp:196`). But per this phase's own design, no automated test exercises
actual audio device output, and — checked directly for this doc — nothing in the commit
history or test suite shows anyone running `--serve` with a real device attached and
listening to actual audio output on this machine. **This was not done.** Be aware that the
"plays audio for real" claim for the real-time path rests on `openDefaultDevice()`
succeeding and the code compiling/type-checking, not on anyone having heard sound come out
of the speakers. This is a real, not hypothetical, gap for whoever picks up the next phase.

The final holistic review of the whole phase (looking at `PlaybackEngine`, `IpcServer`, and
`Transport` together — something no single task's own review could see) surfaced two
additional, concrete risks in this specific path, neither of which is exercised by anything
in Phase 1 today but both of which need addressing before this path is actually driven by a
real UI:

- **Unsynchronized cross-thread access.** `IpcConnection::messageReceived` (message thread)
  calls `engine.setProject(project)`, which mutates `PlaybackEngine`'s plain (non-atomic,
  non-locked) `currentProject` member and `StemBufferCache`'s `std::unordered_map` via
  `bufferCache.load()`. Meanwhile `Transport::audioDeviceIOCallbackWithContext` (the
  real-time audio thread) reads both of those via `renderBlock()`. `StemBufferCache.h`'s doc
  comment asserts "load-project happens on the message thread before playback starts," but
  nothing in the IPC protocol actually enforces that ordering — a second `load-project`
  message arriving while a device callback is mid-flight is a real, currently-possible data
  race, not a hypothetical one.
- **Unbounded per-callback heap allocation.** `PlaybackEngine.cpp`'s own `TODO(Task 6)`
  comment (added during Task 5's fix) warned that a real-time callback built on `renderBlock`
  should not inherit `computeStemSchedule`'s per-block vector allocation, sized proportional
  to how many times a stem repeats across a project. Task 6 wired the real device callback
  directly to `renderBlock` without addressing this — the TODO was not acted on.

Both should be fixed (a lock or an enforced "load only while stopped" invariant; a bounded/
cached schedule lookup) before a later phase connects this path to live playback, not left
as an afterthought once it's already wired up and harder to unwind.

## Real bugs found and fixed during Phase 1

### 1. `EngineProject.cpp` (Task 3) — `juce::var::isObject()` also returns true for arrays

The plan's own sample code used `juce::var::isObject()` to reject non-object top-level
JSON. In JUCE 8.0.4 this is wrong — `isObject()` also returns true for JSON arrays, so a
top-level `[...]` payload would have silently passed validation meant to reject it. Fixed
by checking `getDynamicObject() == nullptr` instead, which only returns non-null for a
genuine JSON object. A follow-up review also found that malformed-but-*present*
`rifffs`/`stems` fields (wrong type, not just missing) were being silently treated as
empty rather than erroring; since this file parses whatever Electron sends over a socket —
a real trust boundary — it was changed to fail loudly with a descriptive error instead.
Covered by two dedicated `EngineProject` test cases (`fails cleanly when rifffs/stems is
present but not an array`).

### 2. `PlaybackEngine.cpp` (Task 5) — spurious fade-in on every repeat of a looping stem

The most significant correctness bug of the phase. The initial design passed the live,
continuously-advancing transport position into `computeStemSchedule`'s position-filter
argument on every block-render call. That function drops segments already "in the past"
relative to the given position — correct for `AudioEngine.ts`, which calls it once per
`play()`, but `PlaybackEngine::renderBlock` calls it fresh on *every single audio block*
with an ever-advancing position. The set of segments returned therefore shrank over time,
which meant whichever segment happened to land at array index 0 kept changing — and the
`isFirstSegment` check (`i == 0`) then wrongly identified later repeats of a looping stem
as "the first segment," applying a spurious fade-in to every repeat instead of only the
true first one.

Fixed by always passing `-infinity` as the position filter (so the full, stably-indexed
segment list is always returned) and using a separate absolute-time overlap check to
decide block relevance instead. Verified with a regression test
(`a later repeat of a looping stem does not get a spurious fade-in`) that reproducibly
computed gain `0.125` instead of the correct flat `0.5` before the fix, and passes after
it.

A related gap was also closed in this task: no existing test proved that multiple stems'
contributions in the same block actually *summed* in the output buffer rather than one
overwriting another. Added `two stems overlapping the same block sum their contributions
rather than overwriting`, and confirmed it's a real, catching test by temporarily changing
the mixing `+=` to `=` and watching the new test fail.

### 3. `IpcServer.cpp` (Task 7) — missing required `disconnect()` in destructor

JUCE's `InterprocessConnection` documents, in its own header/source comments, that derived
classes *must* call `disconnect()` in their destructor — skipping it risks undefined
behavior, since a pending posted message could invoke a pure-virtual method on a
partially-destroyed object. The plan's sample code only called `stopTimer()`. Fixed by
adding the required `disconnect()` call to both `IpcConnection`'s destructor and (later,
Task 11) `TestClient`'s destructor, which has the identical requirement.

### 4. `Main.cpp` (Task 8) — `runServe` didn't actually block; server exited almost immediately

The second most significant bug. `runServe` initially used
`juce::MessageManager::runDispatchLoop()`, which blocks via `[NSApp run]` on macOS. In this
environment it did not actually block — the server process exited within roughly 1-2
seconds instead of staying up to serve clients, confirmed directly via `ps -p $PID` showing
the process gone almost immediately after start. Root cause: `[NSApp run]` needs a full
Aqua/WindowServer session that a headless console process run from a terminal doesn't
reliably get. Fixed by replacing the single blocking call with a polling loop
(`while (!hasStopMessageBeenSent()) runDispatchLoopUntil(50);`), which required adding
`JUCE_MODAL_LOOPS_PERMITTED=1` to the CMake build — `runDispatchLoopUntil` is compiled out
without that flag. Verified independently that the server now (a) stays alive indefinitely
with no client connected, and (b) still quits promptly on a real `quit` IPC message — both
confirmed via direct process checks, not just log output.

### 5. Two bugs surfaced only by the parity test's realistic buffer size (Task 10)

Both of these were invisible to Task 5's small-buffer unit tests and only surfaced once a
~176,400-sample real render was exercised end-to-end through the actual `--render-test` CLI
path:

- **WAV header offset assumption.** The parity test's own WAV-reading helper assumed a
  fixed 44-byte header. JUCE's `WavAudioFormat` writer actually inserts a 52-byte `JUNK`
  padding chunk before the data chunk, so real audio data starts at byte 104, not 44.
  Reading from byte 44 would have compared garbage/misaligned samples. Fixed by walking the
  actual RIFF chunk structure instead of assuming a fixed offset.

- **Truncation instead of rounding in sample-index computation.** `PlaybackEngine::renderBlock`
  used a C-style `(int)` cast to convert a floating-point sample-index computation
  (position → seconds → sample index) to an integer. Ordinary IEEE-754 floating-point
  non-associativity in that round trip occasionally lands the computed value a hair below a
  whole number (e.g. `14.999999999999998` instead of `15.0`), and truncating in that case
  silently re-reads the previous sample instead of advancing — an intermittent
  repeated-sample glitch scattered through a render. Reproduced via a standalone numerical
  simulation of the same arithmetic: 11,011 of 176,400 samples (6.2%) would be affected by
  this off-by-one. Fixed by switching to `std::llround` (round-to-nearest) instead of
  truncation.

Both fixes are what get the parity test down to `maxDiff = 1` reported above — before the
rounding fix, the intermittent repeated-sample glitch pushed the diff well past the
tolerance of 2.

### 6. `Main.cpp` (Task 11) — `--test-client` never actually observed its own IPC callbacks

Found in already-shipped Task 8 code. `--test-client`'s `TestClient` class never observed
any of its own IPC callbacks firing — silently: `sendMessage` still returned success and
the process still exited 0, so nothing about the failure was visible without instrumenting
it directly. Root cause: `juce::InterprocessConnection` defaults to
`callbacksOnMessageThread = true`, which delivers callbacks via a posted `Message`
requiring an actively-pumped dispatch loop. `runServe` (fixed in Task 8, see bug 4) pumps
one; `runTestClient` only called `Thread::sleep()`, which pumps nothing. Fixed by
constructing `TestClient` with `callbacksOnMessageThread = false`, moving callback delivery
onto `InterprocessConnection`'s own background reader thread instead — verified safe
because `TestClient`'s only side effect is `Logger::writeToLog`, itself an ordinary
thread-safe `fputs` + `fflush`.

A reviewer independently reproduced this bug before accepting the fix: reverted the
`Main.cpp` change, rebuilt, confirmed zero client log lines appeared (the bug actually
manifested), then restored the fix.

A second, unrelated bug was fixed in the same task: the test's own regex for matching
`position-update` messages assumed JUCE's `JSON::toString` emits compact JSON
(`"type":"position-update"`). It actually emits a space after the colon
(`"type": "position-update"`), confirmed against real `--test-client` stderr output — the
original regex matched zero lines despite the log genuinely containing the messages.

## Known gaps — explicitly not covered by Phase 1's automated tests

- **The parity suite only covers two scenarios: volume scaling and a fade-in envelope, on
  a single-stem, single-rifff project.** Stretch-ratio correctness, fade-out, offset-steps,
  and unlinked/dragged stem positions are all covered by C++ unit tests in isolation
  (`SchedulePlayback`, `FadeGain`, `PlaybackEngine` — Tasks 1, 2, 5), and multi-stem
  summation is covered by a `PlaybackEngine` unit test (bug 2 above) — but none of these
  are exercised by an end-to-end numeric parity check against the reference math the way
  volume/fade-in are. **A later phase or a follow-up hardening pass should extend the
  parity suite to cover stretch-ratio and multi-rifff mixing before `AudioEngine.ts` is
  actually retired** — those are exactly the areas where a subtle math discrepancy between
  the TS and C++ implementations would currently go undetected by CI.

- **`src/shared/buildEngineProject.ts` has no live caller.** Nothing in the actual
  Electron app invokes it yet — it exists and is unit-tested (`buildEngineProject.test.ts`)
  but isn't wired to a real IPC resolver. A code review also noted it lacks the
  try/catch-with-fallback error handling that `AudioEngine.ts`/`exportMix.ts` use around
  the same `renderStretched` IPC call it wraps (confirmed: `resolveStretched(...)` at
  `src/shared/buildEngineProject.ts:56` is called with no surrounding try/catch). This
  should be added before a later phase wires it to a real resolver.

- **The real-time `Transport`/`AudioDeviceManager` path was not manually sanity-checked
  with actual audio output on this machine.** See the dedicated section above — this is
  worth restating here as a gap, not just a note, since it's the one part of Phase 1 with
  zero human-verified evidence it produces audible sound.

- **A JUCE leak-detector warning appears on `--serve`'s shutdown after a `quit` message.**
  Re-confirmed for this doc — the server's stderr on exit shows:

  ```
  *** Leaked objects detected: 1 instance(s) of class ConnectionThread
  *** Leaked objects detected: 1 instance(s) of class InterprocessConnection
  *** Leaked objects detected: 1 instance(s) of class StreamingSocket
  *** Leaked objects detected: 1 instance(s) of class Timer
  *** Leaked objects detected: 1 instance(s) of class SharedResourcePointer
  *** Leaked objects detected: 1 instance(s) of class TimerThread
  *** Leaked objects detected: 2 instance(s) of class Thread
  *** Leaked objects detected: 7 instance(s) of class WaitableEvent
  ```

  (a longer list than previously logged, likely because JUCE's internal timer/thread pool
  objects get pulled into the leak report transitively once the `IpcConnection` itself
  leaks). Non-fatal — exit code is still 0, confirmed across multiple runs both here and in
  Tasks 8/11's own testing — because `IpcServer`/`IpcConnection` (Task 7) don't explicitly
  tear down a still-connected client before the process exits. Flagged twice during code
  review as real but low-priority; not fixed in Phase 1.

- **Pre-existing, unrelated repo gap** (not part of Phase 1's scope, noticed during Task
  9's review): the repo's ESLint config doesn't exclude `native-engine/build/` (the JUCE
  `FetchContent`-vendored source tree), so a repo-wide `npm run lint` picks up thousands of
  pre-existing lint findings from vendored JUCE source, not this project's own code. Worth
  a one-line `eslint.config.js` ignore-pattern fix at some point; unrelated to this plan's
  own correctness.

## Environment notes

- Same toolchain as Phase 0: macOS 15.7.5 (arm64), Apple clang 17.0.0
  (clang-1700.0.13.5), CMake 4.2.0, JUCE **8.0.4** pinned via `FetchContent`, Unix Makefiles
  generator.
- **`JUCE_MODAL_LOOPS_PERMITTED=1`** is now required in `native-engine/CMakeLists.txt`
  (added in Task 8) — `runDispatchLoopUntil` is compiled out of JUCE without it, and
  `runServe`'s poll loop (bug 4 above) depends on it. This wasn't needed in Phase 0.
- The IPC transport is **TCP loopback** (`127.0.0.1:<port>`) via
  `juce::InterprocessConnection` / `InterprocessConnectionServer`, not a Unix domain socket
  file — a deliberate choice documented in the plan (avoids hand-rolling wire framing) that
  held up in practice with no issues.

## Confirmed working end-to-end

- [x] `computeStemSchedule`'s C++ port (`SchedulePlayback`) matches all 6 TS test
      scenarios
- [x] `applyFade`'s C++ port (`FadeGain`) matches all 8 TS test scenarios
- [x] Native offline render matches Web Audio reference math within 1 sample-unit
      (tolerance 2) for volume scaling and fade-in envelopes
- [x] Live IPC round-trip over a real TCP socket: `load-project` → `play` →
      `position-update` (observed advancing) → `stop` → `quit`, reliable across repeated
      runs
- [x] `--serve` stays alive indefinitely with no client, and quits cleanly (exit 0) on a
      real `quit` message
- [ ] Real-time `AudioDeviceManager` output — **not manually verified**; see gap above
- [ ] Full `AudioEngine.ts` parity (stretch ratios, multi-rifff mixing) — **not yet
      covered by an automated numeric test**; see gap above
