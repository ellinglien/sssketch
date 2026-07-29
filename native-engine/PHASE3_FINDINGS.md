# JUCE Engine Phase 3 — Native Live Playback Findings

**Result: PASS.** Live in-app playback — the transport, position reporting, loop wrap-around,
and reactive rescheduling while a project changes mid-playback — now runs entirely on the
native JUCE engine, driven over the same IPC wire protocol Phase 2 built for export. The old
Web Audio live-playback path (`AudioEngine.ts`, ~215 lines) has been fully deleted from the
codebase, not just stopped being called. Zero native C++ changes were needed — this phase's
own design assumption turned out correct. Six real bugs were found and fixed along the way
(detailed below), the most significant being a crash-recovery relay bug caught only by
literally killing the running engine process during manual verification, plus a final
holistic review — looking at the whole phase's diff at once, after all 10 tasks were
individually complete — that caught a startup-ordering regression no single task's review
could have seen in isolation.

## Test counts (independently re-run for this doc)

TS side, `npx vitest run` from the worktree root:

```
Test Files  24 passed (24)
     Tests  177 passed (177)
```

Up from Phase 2's 22 files / 168 tests — 2 new files this phase
(`playbackEngineLifecycle.test.ts`, `liveReschedule.test.ts`), plus new cases added to
existing files: `engineClient.test.ts` (extended for push-subscription) and
`render-parity.test.ts` (a fourth, stretch-ratio case).

C++ side, `native-engine/build/ssstitch_engine_artefacts/Debug/ssstitch_engine --test`:

```
32 individual test cases, all passing (exit code 0)
```

**Identical to Phase 1 and Phase 2's count.** This is the headline confirmation of this
phase's central design bet: **zero native C++ changes were needed for live playback.**
`IpcServer.cpp` already implemented every message type this phase needed (`load-project`,
`play`, `pause`, `stop`, `set-position`, and the 30Hz `position-update` push) since Phase 1 —
built for a hypothetical future live-playback consumer that never existed until now. This
phase's actual work was entirely on the TypeScript/Electron side: a persistent engine process
lifecycle, IPC wiring, and rewriting `StoreContext.tsx` to talk to it. Confirmed by this doc's
own re-run of the C++ test count, unchanged from Phase 2.

## Push-subscription: `EngineClient.on()` (Task 1)

Phase 2's `EngineClient` was built exclusively for one-shot request/response
(`sendAndAwaitType`, used by export's `render-export` → `render-export-result`). Live
playback needs a different shape entirely: reacting to a continuous, unprompted stream of
`position-update` pushes at 30Hz for as long as the engine is playing. `EngineClient` gained
`on(type, callback): () => void` / `off` (implicit via the returned unsubscribe function),
dispatched from `handleMessage` independent of — not as a fallback for — the existing
one-shot waiter logic, so both mechanisms can observe the same incoming message type without
interfering with each other.

Test coverage: ordered-delivery and unsubscribe-cutoff (a dedicated `startPushServer()` test
helper sends four delayed `position-update` pushes and confirms an unsubscribe mid-stream
stops further delivery), non-interference with `sendAndAwaitType` for a different message
type, and — added by the implementer during self-review, not originally scoped — a case
proving a single incoming message with both a matching persistent subscriber AND a matching
one-shot waiter fires both independently, neither one suppressing the other. Clean first pass;
no fix-and-re-review cycle needed for this task.

## Live `load-project`-while-playing sequence: proven safe (Task 6)

This is the architectural bet the whole phase's simplification rests on: `PlaybackEngine::
renderBlock` (built in Phase 1) recomputes scheduling fresh from "whatever `EngineProject` is
currently loaded" on every single audio block, so a live edit while playing is just "send
`load-project` again" — no separate reschedule code path, no stop/restart. If the engine
couldn't safely accept a second `load-project` mid-stream, this entire design would need
rethinking.

**Result: confirmed working.** `src/main/liveReschedule.test.ts` drives one continuous
`EngineClient` connection through `load-project A → play → load-project B (while still
playing, no stop/pause in between) → stop → quit`, asserting `position-update` pushes arrive
both before and after the swap (proving the connection survived and the transport kept
running uninterrupted) and that the server exits cleanly (code 0) afterward.

The plan's original sketch for this test spawned `--serve` and drove it with the native
`--test-client` CLI flag twice, mirroring Phase 1's `ipc-roundtrip.test.ts` pattern. This
doesn't work: confirmed directly against `Main.cpp` that `runTestClient` unconditionally sends
`stop` then `quit` at the end of its sequence, and `IpcServer.cpp`'s `quit` handler calls
`juce::JUCEApplicationBase::quit()`, terminating the *entire server process* — not just that
one connection. A second `--test-client` invocation could never connect, since the first
already killed the server. This was caught during the coordinator's own plan self-review,
**before any implementer touched it** — the plan was rewritten to use `EngineClient` (Task
1's own deliverable) directly from one Node-side test file instead, which is both simpler than
two spawned processes and dogfoods `EngineClient` itself as extra confidence, without touching
native C++ to add a workaround flag (respecting the phase's "no native C++ changes" scope).

A code-quality review found the test's temp-directory cleanup (`rmSync`) sat after all
`expect()` calls with no `try`/`finally` — the same weakness Phase 2's Task 6 parity test had
been caught and fixed for, now recurring in a new file. Fixed (`ca88285`), along with
strengthening "project B" to differ from project A by `bpm` (not just a renamed `groupId`),
since a pure metadata rename didn't actually exercise different scheduling math.

## Stretch-ratio parity test: closes a gap named in two previous findings docs (Task 7)

Phase 1's findings doc named "stretch-ratio and multi-rifff mixing" as the two open parity
gaps. Phase 2 closed multi-rifff mixing but explicitly, deliberately left stretch-ratio open
a second time (its multi-stem fixture set project bpm equal to both rifffs' own bpm, so the
stretch ratio was exactly 1 and rubberband was never exercised). **This phase closes it.**

`native-engine/test/parity/render-parity.test.ts` gained a 4th case: a project simulating an
80bpm rifff played back in a 60bpm project (`ratio = 0.75`, well past the `0.001`
no-op threshold), pre-stretched via `src/main/rubberband.ts`'s `renderStretched` (the same
function the app's real IPC handler calls) against the real `rubberband` CLI binary before
building the `EngineProject` — since `--render-test` only accepts already-resolved paths and
doesn't perform stretching itself. The stretched fixture's actual duration was *measured* from
the rendered file (5.333333s from a 4s source) rather than assumed, since rubberband's real
output length isn't a simple arithmetic formula on the ratio.

```
render-parity: stretch-ratio test maxDiff = 1
```

Within the same `<= 2` 16-bit-rounding tolerance the other three cases use — no loosening
required or applied. `rubberband` worked cleanly in the test environment on the first attempt;
this gap did not need a third deferral.

## The crash-recovery relay bug: found only by actually killing the process (Task 8)

Manual verification (Task 8) used Playwright's `_electron` driver against the real built app
— real stem import, real drag-and-drop onto the timeline, the real native engine subprocess —
and, since an AI agent cannot literally listen to audio, substituted rigorous quantitative
proxies: polling the `Playhead` DOM element's position over wall-clock time (observed
15.13px/s and 14.87px/s against a mathematically expected 15px/s), and capturing the exact
live `EngineProject` JSON the app sent over IPC and feeding it to `--render-test` directly
(same `PlaybackEngine::renderBlock` code path as live CoreAudio output, confirmed via
`Transport.cpp`/`RenderExport.cpp`) to verify non-silent, substantial audio content (100%
non-zero samples, RMS 0.242 over a full 8-bar render). Live volume/mute/offset edits were
confirmed to reach the audio (not just the UI) via before/after render comparisons — RMS
dropping monotonically as volume then mute were applied, a 100%-byte-diff render after an
offset change. Loop wrap-around was confirmed seamless (max gap between successful polls
159ms, no stall). Pause-then-resume was confirmed to freeze the playhead exactly at pause and
resume from that same position, not reset to 0 — matching the documented pause=stop-at-engine
design.

**Point 5 — killing the native engine process — is where a real bug was found.** The plan
explicitly called this out as "not optional," since it's the only way to actually prove
crash-recovery respawn+reconnect works, not merely that the app doesn't crash outright.
SIGKILLing the real playback-engine PID mid-playback confirmed: the playhead stopped, no
visible error appeared, a new PID appeared, and pressing Play again worked — **the first
time**. But this check was run twice, because it exposed a bug on its first pass.

`main/index.ts` subscribed to `playbackEngine.client.on('position-update', ...)` exactly once,
at startup. `playbackEngine.client` is a getter (built in Task 3, `playbackEngineLifecycle.ts`)
that re-reads the *live* `EngineClient` instance on every property access — specifically so
that after a crash+respawn swaps in a fresh instance, callers reach the current connection
rather than a stale one. But `EngineClient.on()` subscribes its listener onto whichever
*specific object instance* `.on()` was actually called on; the getter's indirection only helps
at the moment of the call, not retroactively. A one-time subscription at startup therefore
binds permanently to that one snapshot instance. After the first crash+respawn, the old
instance (dead socket) still nominally "has" the listener but never fires it again, and the
new instance starts with zero listeners — so the renderer's playhead would silently freeze
forever after the *first* crash-recovery cycle, even though play/pause/stop kept working fine
(those IPC handlers already read `playbackEngine?.client` fresh on every call, not once, so
they didn't share this bug).

Reproduced in isolation first (7 pushes observed before the kill, 0 after), then fixed
(`a072326`) by wrapping the subscription in a small `subscribeToPositionUpdates()` function
called once at startup **and again inside `onRestarted`**, so the relay re-attaches to
whichever `EngineClient` is actually live after every respawn cycle, not just the first. A
code-quality review caught that the accompanying regression test only asserted a *new*
post-crash subscription receives pushes (a fairly trivial property of any freshly-connected
socket) without actually pinning the bug — it never asserted the *stale* pre-crash
subscription goes quiet. Strengthened (`f3a2612`) to assert both: the old subscription's
count stays flat after the respawn, and a fresh one (matching the fixed pattern) grows.
Confirmed end-to-end in the full app afterward: playhead position genuinely advancing again
post-fix (`214.6px → 229.4px` across the second play press).

## Retiring the old path (Task 9): fully deleted, plus a wider stale-comment sweep than the plan asked for

Confirmed for this doc: `grep -rn "AudioEngine" src/ --include="*.ts" --include="*.tsx"`
returns exactly two matches, both in `StoreContext.tsx`, both deliberately historical
(explaining why the current code is shaped the way it is relative to the deleted system, not
claiming the file still exists) — left untouched on purpose. `AudioEngine.ts` itself (215
lines) was deleted via `git rm`, not just emptied; no `AudioEngine.test.ts` ever existed.

Beyond the plan's literal "delete the file and check for code references" scope, the
coordinator additionally had the implementer sweep for **stale comments elsewhere in the
codebase** that named `AudioEngine.ts` or `exportMix.ts` (a *different* renderer file, already
deleted in Phase 2) as if still architecturally current — since leaving them would actively
mislead a future reader, exactly the class of bug Phase 2's own Task 8 had already caught and
fixed once (a dangling doc comment pointing at a just-deleted file). Five such comments were
found and corrected in the main commit (`6bd8d9f`): a doc comment in `nativeExport.ts` falsely
claiming live playback "is still Web Audio-based, separately" (now false — it goes through
the native engine too, via a separate persistent process); two comments in
`buildEngineProject.ts` naming the now-deleted files as the source of "the same IPC
round-trip" and a specific failure-isolation pattern (updated to name the current resolver
files, `resolveStretchedForExport.ts`/`resolveStretchedForPlayback.ts`); and two comments in
`store.ts`/`RifffBlockRow.tsx` naming `(AudioEngine/exportMix)` as where fade math is applied
(updated to reference the native engine).

Two follow-up review cycles caught two more layers of the same defect class, each fixed in its
own small commit rather than folded silently into the main one:

- **`675b27e`**: the `buildEngineProject.ts` comment fix from the main commit had introduced a
  new, narrower inaccuracy — it described the rubberband-fallback catch block as being about
  "the whole export," but `buildEngineProject` is now called from *both* the export path
  (`nativeExport.ts`) and the live-playback path (`StoreContext.tsx`, via
  `resolveStretchedForPlayback`, this phase's own Task 2). Broadened to "export or playback
  session."
- **`6520101`**: a code-quality review of the retirement commit found two *more* stale
  `exportMix.ts` references, both pre-existing from Phase 2 and missed by the initial sweep —
  one in `render-parity.test.ts`, one in `nativeExport.test.ts`. The second was worse than
  merely stale: it also cross-referenced "this file's constraint note above" for why the
  reference math is computed independently rather than through a browser audio API, but that
  note (about mocking Electron's `app.getAppPath()`) has nothing to do with that reasoning —
  the cross-reference was pointing at the wrong thing even before the filename went stale.
  Both fixed to reference the native engine's mixing instead, and the second's misleading
  cross-reference was dropped rather than patched around.

Three passes were needed to fully close this out — a reminder that a "delete a file, fix
comments that reference it" task can have a wider blast radius across a codebase's history
than a single grep-and-fix pass catches, especially when an earlier phase already deleted a
similarly-named file and left comments of its own.

## Real bugs found and fixed during Phase 3

### 1. `playbackEngineLifecycle.ts` (Task 3) — shutdown/respawn race, unhandled rejection, zero crash-recovery test coverage

The highest-risk new module this phase built, and the one that received the most fix-and-
re-review cycles. Three real issues, all found by code review before any manual testing:

- **Shutdown racing an in-flight respawn.** If the engine crashed and a respawn was mid-flight
  (spawning a new process, reconnecting) exactly when `shutdown()` was called (e.g. app quit
  right after a crash), `shutdown()`'s `shuttingDown` flag only gated whether a *new* respawn
  could start — not whether an *already-started* one was allowed to complete. The in-flight
  respawn had no cancellation hook and wasn't tracked anywhere, so it could keep running after
  `shutdown()` returned: spawning a brand-new engine process nothing would ever clean up.
  Fixed by tracking the in-flight respawn as a promise, re-checking `shuttingDown` after each
  `await` inside `connect()` (killing/disconnecting whatever was just spawned/connected if it
  became true mid-flight, via a sentinel `ShutdownAbort` error for clean unwinding), and having
  `shutdown()` await any in-flight respawn before touching `engineHandle`/`client`.
- **`void respawn()` with no `.catch()`.** A failed respawn (missing binary, a crash-loop where
  the freshly-spawned process died again inside `spawnEngine`'s readiness wait) was an
  unhandled promise rejection — Node's default is fatal, so the exact moment the engine was
  struggling was the moment most likely to take down the whole Electron main process. Fixed
  with a `.catch()` that logs genuine failures and silently swallows the intentional
  `ShutdownAbort` unwind.
- **Zero automated coverage of the crash-recovery path itself.** The original two tests
  covered "spawn + send doesn't throw" and "`getLastProject` tracks what was sent" — neither
  touched crash detection, respawn, resend, or `onRestarted` firing, which is the module's
  actual reason for existing (and exactly where the two bugs above lived). Closed by adding a
  `getEngineProcess()` test-only seam and a third test that SIGKILLs the real spawned process,
  awaits `onRestarted`, and confirms `client.send(...)` doesn't throw afterward — a real,
  non-tautological proof that respawn+reconnect actually completed.

All three verified via a second, independent re-review that traced both race outcomes by hand
(respawn-aborts-cleanly vs. respawn-completes-then-shutdown-kills-the-new-one) and ran the
crash-recovery test four times back-to-back with no flakiness (commit `15fbb67`).

### 2. `main/index.ts` (Task 4) — stale window reference in the engine-event relay after macOS's close-all/reopen flow

`position-update`/`onRestarted` relay callbacks were wired once at startup, closing over the
`BrowserWindow` returned by that single `createWindow()` call. On macOS, `window-all-closed`
deliberately does not quit the app — closing the last window and reopening via the dock
(`activate`) creates a *new* window, but the relay closures still referenced the original,
now-destroyed one. `webContents.send()` on a destroyed window throws, and that throw happens
synchronously inside `EngineClient`'s raw socket `'data'` handler — an uncaught exception
there is capable of crashing the whole main process, and would fire continuously at 30Hz for
as long as the engine kept playing. Not a contrived edge case: the standard mac
close-all-then-reopen workflow. Fixed (`ab5d319`) by tracking the current live window in a
module-level variable reassigned on every `createWindow()` call (both call sites), with the
relay reading it fresh and guarding with `isDestroyed()`.

The same review also flagged a narrower race in `before-quit`'s fire-and-forget
`shutdown()` call — the common case resolves synchronously fast enough to be safe, but a
crash-triggered respawn in flight exactly at quit time could defer the actual process kill
past what Electron's quit sequence blocks on. Hardened in the same commit:
`event.preventDefault()`, await `shutdown()`, then re-call `app.quit()` inside `.finally()`,
guarded against re-entrant recursion. A follow-up review of *that* fix noted one more residual
gap — no timeout on the awaited `shutdown()` call, meaning a sufficiently pathological hang
inside it could make the app permanently unquittable, trading "possible orphaned subprocess"
for "possible unquittable app" in a narrow case. Closed with a 5-second `Promise.race` bound
(`34f7cac`), so quitting is never held hostage by the engine layer regardless of what happens
inside `shutdown()`.

### 3. `StoreContext.tsx` (Task 5) — post-stop stragglers could clobber a position reset

The rewritten `position-update` subscription had no guard against a push that was already
in flight when `stop` was sent: the native engine's 30Hz timer only stops once it *processes*
the incoming `stop` message, so a tick already queued before that lands anyway. Without a
guard, that straggler could dispatch a stale nonzero `SET_POS` right after `STOP` had just
reset `pos` to 0 — and a quick Stop-then-Play could then resume from the wrong position
instead of 0. Fixed (`0236cfa`) with a one-line guard checking `stateRef.current.playing`
at the top of the subscription handler before processing a push.

The same review pass also caught a stale comment on the `stateRef` mirror effect, left over
from before this task deleted the getter-callbacks object and rAF loop it used to describe —
fixed in the same commit to describe its actual sole remaining consumer (the position-update
subscription's `loopLengthBars` read).

### 4. The crash-recovery relay bug (Task 8) — covered in full above

The most significant bug this phase found, and the only one caught exclusively through manual
end-to-end testing rather than code review of freshly-written code — see the dedicated
section above.

### 5. The multi-pass stale-comment sweep (Task 9) — covered in full above

Not a functional bug, but worth counting: three separate passes were needed to fully close out
comment accuracy after deleting `AudioEngine.ts`, two of which were found by code review
rather than the original sweep. See the dedicated section above.

### 6. `main/index.ts` (final holistic review) — a failed engine spawn could silently prevent the app window from ever appearing

Found only by a final, whole-diff review looking across task boundaries, after all 10 tasks
were individually complete — none of the per-task reviews caught this, since each only saw
one task's diff in isolation. `app.whenReady().then(async () => {...})` had no `.catch()`,
and this phase's `playbackEngine = await startPlaybackEngine()` (Task 4) now sits *before*
`createWindow()` — a genuine ordering change from before this phase, when window creation had
no dependency on any native process succeeding. If `spawnEngine()` ever failed (binary
missing or not yet rebuilt, the 5s readiness timeout firing, a port bind failure), the async
callback would throw, become an unhandled rejection, and skip `createWindow()` entirely — the
app would launch with no window and no visible error, a real regression on a plausible
dev-workflow failure. Fixed by wrapping the `startPlaybackEngine()` call in `try`/`catch`:
on failure, log the error, show `dialog.showErrorBox` explaining live playback is unavailable
for this session, and continue — the engine-\* `ipcMain` handlers already guard every call
with `playbackEngine?.`, so leaving `playbackEngine` `undefined` and still calling
`createWindow()` degrades gracefully rather than failing silently.

The same review pass also found and removed two small pieces of leftover scaffolding that
survived every per-task review because neither was ever wrong on its own, only inconsistent
across the whole: the `engine-pause`/`enginePause` IPC channel and preload export (defined in
Tasks 4, never called anywhere — the app's actual pause behavior, confirmed correct in Task
8's manual verification, is "stop at the engine level, preserve `state.pos` in React," which
never needed a native pause message), and `engineClient.ts`'s class doc comment, which still
claimed the client was "NOT used for live playback" — untouched by any of the three
stale-comment sweeps in Task 9 because those were scoped to literal `AudioEngine`/`exportMix`
filename references, not broader scope-of-purpose claims like this one.

A related, narrower race was also found and **deliberately left open, not fixed**: if a user
quits (Cmd+Q, dock menu) in the brief window between `app.whenReady()` firing and
`startPlaybackEngine()` resolving, `before-quit`'s guard (`if (isQuitting || !playbackEngine)
return`) does nothing, since `playbackEngine` isn't assigned yet — and there is no handle
anywhere yet that owns the in-flight spawn, so a process started during that window (roughly
the duration of `spawnEngine`'s readiness wait) could outlive the quit. Narrow, low-probability,
and closing it properly would mean threading a cancellable handle out of `startPlaybackEngine()`
before it resolves — more machinery than this edge case currently justifies. Named explicitly
below rather than left implicit.

## Known gaps — explicitly not covered by this phase

- **A narrow quit-during-startup race can leak a native process.** Found during the final
  holistic review (see bug #6 above), deliberately left unfixed. If the app is quit in the
  brief window between `app.whenReady()` and `startPlaybackEngine()` resolving, the
  in-flight spawn has no owner yet and `before-quit`'s guard does nothing (`playbackEngine`
  is still `undefined`). Low-probability (a multi-second startup path, quit has to land in a
  window of roughly tens of milliseconds) and distinct from the already-known ephemeral-port
  collision gap below — this one is about process leakage, not port contention.

- **Binary packaging/distribution remains completely out of scope.** Named as a gap in Phase
  2's findings doc, still unaddressed here. The engine binary's path is still resolved via a
  dev-mode-relative path (`app.getAppPath()` plus a fixed relative path into
  `native-engine/build/...`) for *both* the export engine and this phase's new persistent
  playback engine. How a packaged, distributed Electron app would locate or bundle a compiled
  native binary has not been attempted or designed for.
- **Plugin hosting** — named in the original multi-phase design doc as a later phase, still
  entirely unaddressed.
- **`EngineClient.disconnect()` still doesn't reject in-flight requests.** Unchanged from
  Phase 2's known-gap list; still low-risk, no current caller (export or playback) disconnects
  mid-request.
- **Ephemeral port collision risk in `engineProcess.ts`.** Unchanged from Phase 2 — still a
  random port in the 40000-49999 range rather than an OS-assigned one, still low-probability
  and low-priority given today's usage pattern (one export engine spawned per export, one
  playback engine spawned per app session — the two kinds now coexist as of this phase, but
  each still gets its own random port draw, so the collision surface is marginally larger than
  Phase 2's export-only world, though still not a realistic concern in practice).
- **Rapid volume/mute dragging while playing was flagged, not fixed, during implementation.**
  Task 5 folded `vol`/`mute` into the single reactive `load-project` effect (previously a
  separate, cheap "just update live gain nodes" Web Audio path existed for these two — the
  native engine has no equivalent, so `load-project` is the only way to change them). The
  implementer flagged this could plausibly produce audibly choppy playback under rapid slider
  dragging, per the plan's own explicit instruction to flag rather than silently build a
  workaround. Task 8's manual verification tested volume/mute/offset changes and found each
  took effect correctly and immediately with no observed glitch — but did not specifically
  stress-test *rapid, continuous* dragging. Not confirmed to be a real problem; also not ruled
  out. Worth watching for in real usage.
- **A user-visible "plays the old arrangement for a beat, then jumps" window after an edit
  immediately followed by Play** — flagged by a code-quality review during Task 5, not fixed.
  The reactive `load-project` effect is async (can include a rubberband render round-trip); if
  a user edits and immediately presses Play, the play command can reach the engine before the
  edit's `load-project` does, briefly playing the pre-edit arrangement before the edit lands.
  Not data-corrupting (the engine recomputes scheduling fresh every block regardless), but a
  real, user-visible timing window that didn't exist in the old synchronous Web Audio design.
  Not confirmed as a real-world problem during manual verification; worth watching for.

## Confirmed working end-to-end

- [x] Zero native C++ changes needed — 32/32 C++ unit tests unchanged from Phase 1/2, all
      passing; this phase's design assumption that `IpcServer.cpp`'s existing message types
      were sufficient was correct.
- [x] `EngineClient.on()` push-subscription: ordered delivery, unsubscribe-cutoff,
      non-interference with one-shot `sendAndAwaitType`, and independent firing when both a
      subscriber and a one-shot waiter match the same incoming message.
- [x] Live `load-project`-while-playing: proven safe via a real IPC connection driving the
      full A→play→B(while playing)→stop→quit sequence against the real compiled engine.
- [x] Stretch-ratio parity: `maxDiff = 1` (within the existing `<=2` tolerance) against a
      genuinely rubberband-stretched fixture — closes a gap named in two previous findings
      docs, not deferred a third time.
- [x] Crash recovery, actually proven by killing the real process (not just asserted): after
      the fix, the renderer's playhead resumes advancing after a subsequent Play press, and
      this now holds for arbitrary repeated crash cycles, not just the first.
- [x] Manual end-to-end verification: real Playwright-driven UI, real drag-and-drop, real
      native engine — playhead advancement rate, live volume/mute/offset edits, loop
      wrap-around, and pause/resume all confirmed with quantitative evidence, not just "no
      error was thrown."
- [x] Old Web Audio live-playback path (`AudioEngine.ts`) fully deleted, zero remaining code
      references anywhere in the tree; a wider sweep than the plan's literal scope also
      caught and fixed 7 stale comments (across 3 separate commits/review passes) that would
      otherwise have described the current architecture incorrectly.
- [ ] Rapid volume/mute dragging while playing — flagged as a possible choppiness risk, not
      stress-tested, not confirmed either way. See Known Gaps above.
- [ ] Binary packaging/distribution — **still completely unaddressed**, unchanged from Phase 2.
