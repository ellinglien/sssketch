# JUCE Engine Phase 2 — Native Export Findings

**Result: PASS.** The app's real Export button now writes bytes produced entirely by the
native JUCE engine: spawned as a one-shot subprocess per export, driven over a real
JSON-over-socket IPC connection from a hand-built Node.js client speaking JUCE's actual wire
protocol. The old Web Audio export path (`renderMixToWav`, `OfflineAudioContext`-based) has
been fully deleted from the codebase — not just stopped being called. Seven real bugs were
found and fixed along the way (detailed below). Live playback (`AudioEngine.ts`) is
untouched — still 100% Web Audio-based — per this phase's own scope boundary; see the
dedicated section at the end.

## Test counts (independently re-run for this doc)

TS side, `npx vitest run` from the worktree root:

```
Test Files  22 passed (22)
     Tests  168 passed (168)
```

Up from Phase 1's 19 files / 152 tests.

C++ side, `native-engine/build/ssstitch_engine_artefacts/Debug/ssstitch_engine --test`:

```
32 individual test cases, all passing (exit code 0)
  PluginScanner    2  (Phase 0)
  SchedulePlayback 6  (Phase 1)
  FadeGain         8  (Phase 1)
  EngineProject    5  (Phase 1)
  StemBufferCache  3  (Phase 1)
  PlaybackEngine   8  (Phase 1)
```

Identical to Phase 1's count — this phase added no new C++ unit tests of its own. The
`render-export` IPC message (Task 1) reuses Phase 1's already-tested
`PlaybackEngine::renderBlock`, and the render-to-file logic itself is covered on the TS side
instead: by Task 1's extension to `render-parity.test.ts` and by Task 6's
`nativeExport.test.ts`, both Vitest tests exercising the compiled binary from outside, not
new C++ `UnitTest` subclasses.

## Wire-protocol client: confirmed against a real socket, not just a mock (Task 3)

`src/main/engineClient.ts` is a hand-rolled Node.js client speaking JUCE's actual
`InterprocessConnection` wire protocol directly — no JUCE involved on the Node side. The
framing (an 8-byte header: 4-byte little-endian magic number, 4-byte little-endian payload
length, then raw UTF-8 JSON payload bytes) was confirmed byte-for-byte against JUCE 8.0.4's
real C++ source (`sendMessage`/`readNextMessage` in
`juce_InterprocessConnection.cpp`), not guessed. The magic number
(`0xf2b49e2c`, `MAGIC_NUMBER` in `engineClient.ts:10`) is `InterprocessConnection`'s
compiled-in default — none of this codebase's C++ `IpcConnection`/`IpcServer`/`TestClient`
classes override it, confirmed by grepping the C++ source for any override.

This was verified not just against a controlled echo-server test double (used for the
chunk-splitting/reassembly edge-case tests, where deterministic control over TCP framing
matters) but against the real compiled engine binary, multiple times, including a deliberate
stress test with zero delay between `load-project` and `render-export` sends — matching real
production sequencing rather than a comfortably-paced test — all passed, confirmed in commit
`e82afa3`'s own description of the re-verification.

Code review caught a real crash bug here: `JSON.parse('null')` succeeds with no exception
(`null` is valid JSON), and the code's subsequent `msg.type` access on that `null` then threw
a `TypeError` synchronously inside the socket's `'data'` event handler — an uncaught
exception with the potential to crash the entire Electron main process, not just the export
in flight. Fixed by validating the parsed value is a non-null object with a string `type`
field before trusting it (`engineClient.ts:94-100`), logging rather than throwing on both the
JSON-parse-failure and shape-validation-failure paths. A second gap — a bad-magic-number
frame left the socket in a desynced state with no way to know where the next real header
starts, able to silently accumulate garbage in the receive buffer forever — was also fixed:
the socket is now destroyed on that condition (`engineClient.ts:74-76`) instead of left
open. Both fixes, plus the chunk-splitting/coalescing edge cases, are covered by dedicated
regression tests in `engineClient.test.ts`.

One gap was found and deliberately left open, not fixed: `disconnect()`
(`engineClient.ts:57-60`) just calls `this.socket?.destroy()` — it does not reject any
in-flight `sendAndAwaitType` promises sitting in `pendingWaiters`. A caller disconnecting
mid-request would leave that promise pending until its own 30-second timeout rather than
failing immediately. Low risk today since no current caller does this, but worth naming as a
known limitation for whoever builds on this client next.

## Parity test numbers (Task 6) — broader coverage than Phase 1, with an honest caveat

`src/main/nativeExport.test.ts`'s `nativeExport — multi-stem/multi-rifff parity against
reference math` test is the first automated numeric parity check to exercise the full
production export path end-to-end: `nativeExport()` → `spawnEngine()` → `EngineClient` →
`render-export` IPC → the compiled engine binary → a real WAV file, for a project with **two
stems across two separate rifffs**, rather than Phase 1's single-stem, single-rifff
`render-parity.test.ts`. This is the first time multi-rifff mixing gets an automated numeric
check — Phase 1's parity suite covered volume and fade-in in isolation, on one stem.

Re-run independently for this doc:

```
nativeExport parity: two-stem/two-rifff maxDiff = 0
```

An exact match, not just within the `<= 2` 16-bit-rounding tolerance carried over from Phase
1's own parity test. Independently confirmed this is a genuine, non-hollow result and not a
silence-vs-silence false positive: the two fixture stems are constant-value WAVs at volumes
0.3 and 0.2, giving expected 16-bit sample values of `round(0.3 × 32767) = 9830` and
`round(0.2 × 32767) = 6553`, summing to `16383` — a real, non-trivial, non-zero value —
compared sample-by-sample across the full `4 × 44100 = 176,400`-sample buffer
(`nativeExport.test.ts:180-198`), not just a single spot-check.

**Important nuance, stated explicitly rather than glossed over**: this test computes its
reference via independent JS math (summing the two fixture values and clamping to int16),
not by invoking the real `renderMixToWav`/Web Audio code — because this project's Vitest
suite runs under `environment: 'node'` with no jsdom, and even jsdom doesn't implement
`OfflineAudioContext`, so there was no way to execute `renderMixToWav` under this test suite
at all. This mirrors the same pattern Phase 1's own single-stem parity test already used, for
the same reason.

More importantly: **the fixture project's bpm is deliberately set to match both rifffs' own
bpm** (`state.bpm: 60`, `rifffA.bpm: 60`, `rifffB.bpm: 60` — see
`nativeExport.test.ts:148-165`), so the stretch ratio is exactly 1 and
`resolveStretchedForExport`/rubberband is never actually exercised by this test. Phase 1's
findings doc named "stretch-ratio and multi-rifff mixing" together as the two parity gaps to
close. **Only multi-rifff mixing is closed by this test.** Stretch-ratio correctness still
has no automated numeric parity check anywhere in the codebase — see Known Gaps below. This
is a real, still-open gap; this doc is being explicit about it rather than letting Phase 1's
"stretch-ratio and multi-rifff mixing" phrasing get misread as both having been closed by
Phase 2.

A code-review-found temp-directory leak was also fixed here (commit `8ff7610`): the
`mkdtempSync`'d fixture directory's cleanup (`rmSync`) was the last statement in the test
body, after all `expect()` calls — if any assertion threw (the exact failure mode this test
exists to catch), the temp dir leaked. Wrapped the test body in `try`/`finally` so cleanup
always runs regardless of outcome.

## Real Export button: manually verified end-to-end (Task 7)

The App.tsx change itself was a clean, minimal swap (commit `04965e0`) — one import removed
(`renderMixToWav` from `./audio/exportMix`), one call site changed from
`await renderMixToWav(state)` to `await window.rifffApi.exportMixNative(JSON.stringify(state))`.
No bugs were found in this change itself.

The implementer verified it with a real end-to-end UI test using Playwright's `_electron`
driver against the actual built app: imported real stem files through the app's own IPC
calls, dragged a rifff onto the timeline via a genuine DOM drag-and-drop event simulation,
clicked the real Export button, and then verified the resulting WAV file programmatically
(an AI agent cannot literally listen to audio, so this was the substitute for "listening"):

- Confirmed via `afinfo`/`afplay` that the file is a well-formed WAV with the
  mathematically-correct duration for the test project (150bpm, 8 bars → 12.8s: at 150bpm,
  one bar of 4 beats is `60/150 × 4 = 1.6s`; `8 × 1.6s = 12.8s`).
- Verified via waveform/RMS analysis that the file contains real, continuous, non-silent
  multi-stem musical content — 100% non-zero samples, consistent RMS across the full
  duration, no dropouts — ruling out silence, corruption, or truncation.
- A separate code-quality review independently reproduced the same output byte count,
  **2,258,024 bytes**, via a standalone script calling the real production function, and
  explained the WAV-header-size math behind it rather than accepting the number at face
  value.

Independently re-derived that byte count for this doc, as a sanity check rather than a
literal re-run of the manual Playwright session (which was not committed to the repo as a
permanent test — it was a one-off manual verification script, consistent with this being a
manual-verification step rather than part of the automated suite): 12.8s at 44.1kHz is
`12.8 × 44100 = 564,480` sample-frames; stereo 16-bit is 4 bytes/frame, so
`564,480 × 4 = 2,257,920` data bytes. JUCE's `WavAudioFormat` writer inserts a `JUNK` padding
chunk before the data chunk (documented in Phase 1's findings doc, where the actual data
offset was found to be byte 104, not the conventional 44), so the file's total size is
`2,257,920 + 104 = 2,258,024` bytes — exactly the reported number. The arithmetic checks out
independently; this is not a fabricated or copied-without-checking figure.

## Retiring the old path (Task 8): fully deleted, not just unused

Confirmed for this doc: `grep -r "renderMixToWav"` across the entire tree (excluding
`node_modules` and the vendored `native-engine/build/` JUCE checkout) returns zero matches.
`src/renderer/src/audio/exportMix.ts` — the 125-line file containing `renderMixToWav` and the
`OfflineAudioContext`-based Web Audio graph it built — was deleted outright (`git log` shows
it removed in commit `39a428b`), not just had its exports emptied; nothing else lived in that
file, so there was nothing left behind to keep. It was **not** kept as a test-only reference —
Task 6's parity test was redesigned (see above) specifically so it would never need to invoke
`renderMixToWav`, which made keeping it around unnecessary.

`src/main/exportMix.ts` — a different, coincidentally similarly-named file that handles the
save-dialog/file-write side of export (unrelated to audio rendering) — was confirmed still
present and untouched, as intended; it is not part of what this phase retired.

A dangling doc comment that would have referenced the now-deleted renderer file was also
fixed in the same commit, per the coordinator's summary.

## Real bugs found and fixed during Phase 2

### 1. `RenderExport.cpp` (Task 1) — error messages missing the output path; untested invalid-bpm branch

Error messages for the `render-export` IPC message originally read just "failed to open
output path for writing" and "failed to create WAV writer", with no indication of which path
had failed — a real debuggability problem given this runs headless as a subprocess. Fixed to
include `outputPath` in both strings (commit `c87b403`). The same task also added a
`secPerBar <= 0.0` validation branch (guarding against an invalid/zero bpm) that goes beyond
what Phase 1's `runRenderTest` originally checked, and this branch was initially untested — a
code review caught the gap and a regression test was added exercising `bpm: 0` via
`--render-test`, asserting the process fails cleanly with a nonzero exit rather than crashing
or producing NaN/Inf output.

### 2. `engineClient.ts` (Task 3) — the highest-risk piece of this phase

Covered in full above: a hand-rolled wire-protocol client, verified against real JUCE source
and a real compiled binary, with a crash bug (`JSON.parse('null')` → uncaught `TypeError`)
and a desync-on-bad-magic-number bug both found and fixed, and one known gap
(`disconnect()` not rejecting in-flight requests) deliberately left open and documented.

### 3. `engineProcess.ts` (Task 4) — two bugs in the plan's own sample test code, one bug in the readiness check

(a) The plan's sample test called `spawnEngine()` with no override, which internally needs
Electron's `app.getAppPath()` — unavailable under plain Vitest, since no real Electron
process is running. Fixed by following existing precedent in this codebase
(`rubberband.ts`/`rubberband.test.ts` uses the identical pattern): pass an explicit
`binaryPathOverride`, computed from the test file's own location, instead of relying on
Electron machinery. (b) The sample test asserted `exitCode !== null` after calling `stop()`
(which sends `SIGKILL`), but Node leaves a signal-terminated process's `exitCode` as `null`
forever, setting `signalCode` instead — documented Node behavior, independently reproduced
from scratch to confirm before fixing the assertion to check either field (commit
`3a95088`).

Separately, a code review caught that the engine's readiness detection
(waiting for a specific log line on stderr before considering the subprocess ready) checked
only the latest stderr chunk in isolation, rather than an accumulated buffer — risking a
spurious timeout if the readiness log line happened to split across two OS pipe reads. Fixed
by accumulating into a running buffer and testing that instead (commit `1a46845`).

### 4. `nativeExport.ts` (Task 5) — `loopLengthBarsFor` silently truncated exports for a real, supported project shape

A genuine correctness bug, not a test/tooling issue. `loopLengthBarsFor` (computing the total
export duration in bars) was a simplified, incomplete duplicate of the renderer's real
`loopLengthBars` selector (`src/renderer/src/state/selectors.ts`) — it only used
`rifff.startBar + rifff.barLength`, omitting the case where an unlinked stem has been dragged
out past its own group's normal span, a supported, ordinary user action. For such a project,
`durationBars` would come out too short, and the exported WAV would be silently truncated
before that stem's tail finished playing — no error, just a shorter-than-expected file.
Caught by code review, fixed by porting the real selector's per-stem, `stemStartBar`-based end
calculation for unlinked groups into `loopLengthBarsFor` (commit `a5c7e0d`), and covered by a
dedicated regression test proving the specific dragged-stem scenario now produces the
correct, longer duration (`nativeExport.test.ts`'s `accounts for an unlinked stem dragged out
past its group span` case, verified: expects `28`, the correct end for a stem dragged to
`stemStart: 20` with `barLength: 8`, rather than the group's own `12`).

### 5. Multi-stem/multi-rifff parity test (Task 6) — two environment blockers found before dispatch, one temp-dir leak found during review

Covered in detail above. In summary: (a) the plan's original approach of comparing against
the real `renderMixToWav` directly was impossible under this project's Node-environment
Vitest suite (no `OfflineAudioContext` implementation available), so the task was corrected
before dispatch to compute the reference via independent JS math instead, mirroring Phase
1's own parity test's approach; (b) `nativeExport()`'s internal `spawnEngine()` call needed
`app.getAppPath()`, unavailable under plain Vitest — worked around by mocking the `electron`
module's `app.getAppPath()` to return `process.cwd()`, matching what a real dev-mode Electron
app actually returns when Vitest is run from the repo root. Both fixes worked; the actual
result was `maxDiff = 0`. A temp-directory leak on assertion failure (found by code review)
was fixed by wrapping the test body in `try`/`finally` (commit `8ff7610`).

### 6. Wiring the real Export button (Task 7) — no bugs found

A clean one-line swap (see above); the only "finding" here was the thoroughness of the
manual verification itself, which is worth recording as a positive: a real Playwright
`_electron` driver, real IPC-driven stem import, real DOM drag-and-drop, and rigorous
programmatic verification (`afinfo`/`afplay` + waveform/RMS analysis) of the resulting file,
plus an independent reproduction of the exact output byte count with the underlying math
explained rather than accepted at face value.

### 7. Retiring the old path (Task 8) — no bugs found

Clean: confirmed zero remaining references to `renderMixToWav` anywhere (not even as a test
reference, since Task 6 was redesigned not to need it), deleted the entire file, and fixed a
dangling doc comment that would otherwise have pointed at a now-nonexistent file.

## Known gaps — explicitly not covered by Phase 2's automated tests

- **Stretch-ratio correctness still has no automated numeric parity check.** Phase 1's
  findings doc named this as a gap alongside multi-rifff mixing. Phase 2's parity test closes
  the multi-rifff-mixing half but not this half — the multi-stem fixture deliberately sets
  project bpm equal to both rifffs' own bpm so the stretch ratio is exactly 1, meaning
  `resolveStretchedForExport`/rubberband is never exercised by the test that would otherwise
  be the natural place to check it. A follow-up test with a mismatched bpm (forcing a real
  rubberband render, then comparing native output against a stretched reference) would be
  needed to actually close this gap. Do not read Phase 2 as having closed both of Phase 1's
  named gaps — only one is closed.
- **`EngineClient.disconnect()` doesn't reject in-flight requests.** A known, low-risk,
  intentionally-deferred gap from Task 3 (see above) — a caller disconnecting mid-request
  would hang until the 30-second `sendAndAwaitType` timeout rather than failing immediately.
  No current caller does this.
- **Ephemeral port collision risk in `engineProcess.ts`.** `pickEphemeralPort()` picks a
  random port in the 40000-49999 range rather than asking the OS for a guaranteed-free one
  (e.g. via `listen(0)`). Known, low-probability, and explicitly deferred given today's
  one-shot-per-export usage — not a concern unless/until exports could run concurrently.
- **Binary packaging/distribution is completely out of scope.** The engine binary's path is
  resolved via a dev-mode-relative path (`app.getAppPath()` plus a fixed relative path into
  `native-engine/build/...`). How a packaged, distributed Electron app would locate or bundle
  a compiled native binary (code signing, universal binaries, `electron-builder`'s
  `extraResources`, etc.) has not been attempted or designed for at all in this phase.
- **Live playback (`AudioEngine.ts`) is completely untouched — still 100% Web Audio-based.**
  See the dedicated section below; this is a deliberate scope boundary, not an oversight.

## Live playback: still Web Audio-based, untouched, and out of scope for this phase

This phase's own plan states a scope boundary at the top: export only. Nothing in Phase 2
touches `src/renderer/src/audio/AudioEngine.ts` — confirmed for this doc by checking that no
commit in this phase's history modifies that file. Live in-app playback still runs entirely
on Web Audio (`AudioContext`, `AudioBufferSourceNode`, the reactive rescheduling logic in
`StoreContext.tsx`), exactly as it did before this phase started. Only the export path (a
bounded, one-shot render triggered by clicking Export) now goes through the native engine.

Swapping live playback to the native engine is a substantially larger, higher-risk
undertaking than export was — a persistent engine process running for the app's whole
session rather than a bounded per-export spawn, full reactive rescheduling logic ported from
`StoreContext.tsx`, and real crash-recovery UI (what happens to a playing project if the
native subprocess dies mid-session, versus export's simpler "the export failed, show an
error" case) — and deliberately deserves its own dedicated future phase. That phase can build
directly on what this one proved out: subprocess spawning (`engineProcess.ts`), the Node IPC
client speaking JUCE's real wire protocol (`engineClient.ts`), and the render/export
machinery's parity-testing pattern.

## Environment notes

- Same JUCE 8.0.4, CMake 4.2.0, Apple clang toolchain as Phase 0/1.
- New this phase: a hand-verified Node.js implementation of JUCE's
  `InterprocessConnection` wire protocol (magic number, header framing) in
  `src/main/engineClient.ts` — genuinely reusable code for any future phase needing another
  Node-side JUCE IPC client, most obviously the eventual live-playback phase discussed above.
- The worktree's own copy of this phase's plan file went stale partway through (the
  coordinator corrected Task 6's and Task 8's text on master after the worktree had already
  been created, once the `renderMixToWav`-under-Vitest impossibility was discovered). This
  caused one false-alarm "Critical" code review finding, where a reviewer read the stale
  worktree copy of the plan and flagged the (correct, already-approved) redesigned Task 6 as
  deviating from spec — resolved by cross-checking against master's actual current commit
  history. Not a process failure: the corrected instructions were given directly to each
  task's implementer at dispatch time, which is the authoritative source, not the plan file
  sitting in the worktree. This is a known, previously-seen quirk of the worktree-based
  execution model (it also happened once during Phase 1) — worth recognizing quickly in
  future phases rather than treating it as a real deviation.

## Confirmed working end-to-end

- [x] `engineClient.ts`'s hand-rolled wire protocol verified against real JUCE 8.0.4 source
      and a real compiled engine binary, including a zero-delay stress-test sequence
- [x] Multi-stem, multi-rifff export parity: `maxDiff = 0` against independently-computed
      reference math, through the real production `nativeExport()` path
- [x] Real Export button end-to-end: real stem import, real drag-and-drop, real click,
      resulting WAV confirmed well-formed, correct duration, and genuinely non-silent
      multi-stem content via waveform/RMS analysis
- [x] Old Web Audio export path (`renderMixToWav`, `src/renderer/src/audio/exportMix.ts`)
      fully deleted, zero remaining references anywhere in the tree
- [ ] Stretch-ratio correctness — **still no automated numeric parity check**; the multi-stem
      parity test's fixture deliberately avoids triggering it. See gap above.
- [ ] Live playback (`AudioEngine.ts`) — **untouched**, still Web Audio-based, deliberately
      out of scope for this phase; see the dedicated section above.
