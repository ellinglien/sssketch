# JUCE Engine Phase 2 — Native Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the app's real "Export" button a genuine native-engine code path — port
`exportMix.ts`'s offline-render logic to a real `render-export` IPC command, wire the
Electron main process to spawn the native engine and drive it over the actual socket
protocol (not a test-only C++ client, a real Node.js client), switch the live app's Export
button to use it, and once proven at parity, retire the old Web Audio
`OfflineAudioContext`-based export path.

**Scope boundary (read this first):** This phase covers **export only** — the offline,
one-shot "render the whole arrangement to a WAV file" operation. It deliberately does
**not** touch live playback (`AudioEngine.ts`, `StoreContext.tsx`'s real-time engine,
`AudioContext`-based scheduling). Swapping the *live playback* engine is a substantially
larger, higher-risk undertaking — it means running the native engine as a
long-lived process for the app's whole session (not a bounded per-export spawn), porting
`StoreContext.tsx`'s full reactive rescheduling logic (offset/tempo/snap/unlink/fade
changes mid-playback, loop-wrap handling), and building real crash-recovery UI — and
deserves its own dedicated phase and plan once this phase's patterns (subprocess spawning,
the Node IPC client, wire-format parity) are proven out here first. The design doc's
"Phase 2 — Native export" bullet is scoped this way deliberately.

**Architecture:** Phase 1 already built `PlaybackEngine::renderBlock` (the actual mixing
math) and proved it via a CLI-only `--render-test` mode. This phase exposes that same
rendering capability as a real IPC command (`render-export`) on the already-built
`IpcServer`, taking `(project, durationBars, outputPath)` and writing the WAV directly to
disk before replying with success/failure — avoiding streaming potentially large audio
bytes back over the socket, per the original design doc. On the Electron side: a new
Node.js-native IPC client (`src/main/engineClient.ts`) that speaks
`juce::InterprocessConnection`'s actual wire protocol directly (confirmed by reading JUCE's
own source: an 8-byte little-endian header — a 4-byte magic number `0xf2b49e2c` plus a
4-byte payload length — followed by the UTF-8 JSON payload; the same `{"type":...,
"payload":...}` message shape Phase 1's C++ side already uses). A new engine-process
manager (`src/main/engineProcess.ts`) spawns the compiled engine binary in `--serve <port>`
mode for the duration of one export, tears it down afterward — export is inherently a
bounded, one-shot operation, so there's no need for the always-running engine lifecycle a
live-playback cutover would require. `buildEngineProject`'s `resolveStretched` parameter
(currently untested-in-anger from Phase 1) gets wired to the real
`window.rifffApi.renderStretched` IPC call, with the try/catch-and-fallback behavior a
Phase 1 code review flagged as missing. Once an integration test proves native export
matches the existing Web Audio `renderMixToWav` reference for a realistic multi-stem
project, the app's real Export button switches over, and the old
`OfflineAudioContext`-based path is deleted.

**Tech Stack:** C++ (native-engine, extending Phase 1's `IpcServer`), TypeScript/Node.js
(`src/main`, a genuinely new "TCP client speaking a binary framing protocol" piece for this
codebase), Vitest (both unit and cross-process integration tests, following Phase 1's
`native-engine/test/parity/` pattern).

**Prerequisite:** Phase 1 complete and merged (`native-engine/PHASE1_FINDINGS.md` on
master) — `PlaybackEngine`, `EngineProject`, `IpcServer`, and the `--serve`/`--test-client`
CLI infrastructure all already exist and are proven.

---

## Scope notes

- **Packaging/distribution of the compiled engine binary is explicitly out of scope.**
  This phase resolves the engine binary's path the same way Phase 1's tests do — a
  dev-mode-relative path from the repo root
  (`native-engine/build/ssstitch_engine_artefacts/Debug/ssstitch_engine`). How a *packaged,
  distributed* Electron app would locate/bundle a compiled native binary (code signing,
  universal binary builds, `electron-builder`'s `extraResources`, etc.) is a real, separate
  problem for whenever this app is actually packaged for distribution — not attempted here.
- **One engine process per export, not a persistent one.** `engineProcess.ts` spawns
  `--serve` fresh for each export and kills it when done. This is simpler and safer than
  process-pooling or keeping an engine alive across the app's session — correct given
  export is infrequent and not latency-sensitive the way live playback would be.
- **The wire protocol is JUCE's real `InterprocessConnection` framing, confirmed against
  actual JUCE 8.0.4 source** (`modules/juce_events/interprocess/juce_InterprocessConnection.cpp`,
  `sendMessage`/`readNextMessage`), not guessed: an 8-byte header — `uint32` magic number
  `0xf2b49e2c` then `uint32` payload length, both little-endian via
  `ByteOrder::swapIfBigEndian` (a no-op on this project's little-endian target platforms) —
  followed by exactly that many raw payload bytes. `IpcServer`'s existing C++ code (Phase 1)
  never overrode the default magic number, so this is the actual value in use.

---

### Task 1: `render-export` message handling on the native side

**Files:**
- Modify: `native-engine/Source/IpcServer.h`
- Modify: `native-engine/Source/IpcServer.cpp`
- Modify: `native-engine/Source/Main.cpp` (extract the offline-render loop into a shared, reusable function)
- Modify: `native-engine/CMakeLists.txt` (no new files, but confirm build still picks up the modified sources)

Phase 1's `Main.cpp` already has a working offline-render loop inside `runRenderTest` (calls
`PlaybackEngine::renderBlock` in a loop, writes a WAV via `juce::WavAudioFormat`). This task
extracts that into a function both the CLI mode and the new IPC handler call, so there's
exactly one implementation of "render this project offline to this path."

- [ ] **Step 1: Extract the render-to-file logic into a shared function**

```cpp
// native-engine/Source/Main.cpp — add above runRenderTest, replacing its body with a call to this:
static bool renderProjectToWavFile(
    const EngineProject& project,
    const juce::String& outputPath,
    double durationBars,
    juce::String& errorOut)
{
    StemBufferCache bufferCache;
    PlaybackEngine engine(bufferCache);
    engine.setProject(project);

    const double sampleRate = 44100.0;
    const double secPerBar = project.bpm > 0.0 ? (60.0 / project.bpm) * 4.0 : 0.0;
    if (secPerBar <= 0.0)
    {
        errorOut = "project has an invalid bpm";
        return false;
    }
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
    auto outFile = juce::File(outputPath);
    outFile.deleteFile();
    std::unique_ptr<juce::FileOutputStream> out(outFile.createOutputStream());
    if (out == nullptr)
    {
        errorOut = "failed to open output path for writing";
        return false;
    }
    std::unique_ptr<juce::AudioFormatWriter> writer(
        wavFormat.createWriterFor(out.get(), sampleRate, 2, 16, {}, 0));
    if (writer == nullptr)
    {
        errorOut = "failed to create WAV writer";
        return false;
    }
    out.release();
    writer->writeFromAudioSampleBuffer(output, 0, totalSamples);
    writer.reset();
    return true;
}

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

    if (!renderProjectToWavFile(project, outputWavPath, durationBars, error))
    {
        juce::Logger::writeToLog("runRenderTest: " + error);
        return 1;
    }

    juce::Logger::writeToLog("runRenderTest: wrote " + outputWavPath);
    return 0;
}
```

Note: `renderProjectToWavFile` needs to be visible to `IpcServer.cpp` (Step 2 below) — since
`Main.cpp` is a `.cpp` file, not a header, either (a) declare it in a small new header
(`native-engine/Source/RenderExport.h`) with the implementation in a new
`RenderExport.cpp`, moving it out of `Main.cpp` entirely, or (b) keep it in `Main.cpp` and
forward-declare it where `IpcServer.cpp` needs it. **Prefer (a)** — it's cleaner and matches
this codebase's established one-file-one-responsibility pattern from every other Phase 1
task. Concretely:

```cpp
// native-engine/Source/RenderExport.h
#pragma once
#include "EngineProject.h"
#include <juce_core/juce_core.h>

namespace ssstitch
{
    /** Renders `project` offline to a 16-bit stereo WAV at `outputPath`, covering
     * `durationBars` bars from position 0. Returns false (with errorOut set) on
     * any failure — invalid bpm, can't open the output path, can't create the
     * WAV writer. Shared by --render-test (Main.cpp) and the render-export IPC
     * message (IpcServer.cpp) — exactly one implementation of "render this
     * project to this file." */
    bool renderProjectToWavFile(
        const EngineProject& project,
        const juce::String& outputPath,
        double durationBars,
        juce::String& errorOut);
}
```

Move the function body from Step 1 into `native-engine/Source/RenderExport.cpp` (wrapped in
`namespace ssstitch { ... }`), update `Main.cpp` to `#include "RenderExport.h"` and call
`ssstitch::renderProjectToWavFile(...)` from a slimmed-down `runRenderTest`, and add both
new files to `CMakeLists.txt`'s `target_sources`.

- [ ] **Step 2: Add the `render-export` message type to `IpcConnection::messageReceived`**

```cpp
// native-engine/Source/IpcServer.h — add the include:
#include "RenderExport.h"
```

```cpp
// native-engine/Source/IpcServer.cpp — add a new branch in messageReceived, after the
// existing "set-position" branch and before "quit":
    else if (type == "render-export")
    {
        if (!payload.isObject())
        {
            sendJson(makeRenderExportResult(false, "render-export payload must be an object"));
            return;
        }
        const auto outputPath = payload.getProperty("outputPath", "").toString();
        const auto durationBars = (double) payload.getProperty("durationBars", 0.0);

        // Reuses whatever project was most recently set via load-project — the same
        // "load-project, then act on it" sequencing IPC clients already use for
        // play/pause/set-position, kept consistent rather than inventing a second
        // way to pass project data just for this one message type.
        juce::String error;
        const bool ok = renderProjectToWavFile(engine.currentProjectForExport(), outputPath, durationBars, error);
        sendJson(makeRenderExportResult(ok, ok ? juce::String() : error));
    }
```

This needs `PlaybackEngine` to expose whatever project it currently holds (previously
private, only used internally by `renderBlock`/`setProject`) — see Step 3.

Add the small JSON-building helper near `sendJson`:

```cpp
// native-engine/Source/IpcServer.cpp — add as a free function or private method:
static juce::var makeRenderExportResult(bool success, const juce::String& error)
{
    juce::DynamicObject::Ptr payload = new juce::DynamicObject();
    payload->setProperty("success", success);
    if (error.isNotEmpty())
        payload->setProperty("error", error);
    juce::DynamicObject::Ptr obj = new juce::DynamicObject();
    obj->setProperty("type", "render-export-result");
    obj->setProperty("payload", juce::var(payload.get()));
    return juce::var(obj.get());
}
```

- [ ] **Step 3: Expose the current project from `PlaybackEngine` for the export handler to read**

```cpp
// native-engine/Source/PlaybackEngine.h — add a public accessor:
    const EngineProject& currentProjectForExport() const { return currentProject; }
```

- [ ] **Step 4: Wire the new files into the build**

```cmake
# native-engine/CMakeLists.txt — add to target_sources(ssstitch_engine PRIVATE ...):
  Source/RenderExport.cpp
```

- [ ] **Step 5: Build, run the existing test suite, confirm no regression**

```bash
cd native-engine && cmake --build build && ./build/ssstitch_engine_artefacts/Debug/ssstitch_engine --test
```
Expected: still `All unit tests passed.` (this task doesn't add new C++ unit tests of its
own — `renderProjectToWavFile`'s actual behavior is already covered indirectly by Phase 1's
`render-parity.test.ts` via `--render-test`, and this task's new IPC path is covered by
Task 8's integration test, not a C++ unit test, since it's fundamentally an IPC-plus-file-I/O
integration concern).

- [ ] **Step 6: Manually smoke-test the new message type**

Using the existing `--serve`/`--test-client` infrastructure isn't quite enough here since
`--test-client` doesn't know about `render-export` yet — that's fine, Task 8's Node-side
integration test is the real verification. For a quick manual sanity check now: start
`--serve`, and in a scratch Node REPL or script, connect a raw socket and send a
hand-crafted `render-export` message using the wire format documented in this plan's
Architecture section, confirm you get back a `render-export-result` message and the WAV
file actually appears at the given path. This is optional but recommended before moving to
Task 3, since it de-risks Task 3's real client implementation.

- [ ] **Step 7: Commit**

```bash
git add native-engine/Source/RenderExport.h native-engine/Source/RenderExport.cpp \
        native-engine/Source/IpcServer.h native-engine/Source/IpcServer.cpp \
        native-engine/Source/PlaybackEngine.h native-engine/Source/Main.cpp \
        native-engine/CMakeLists.txt
git commit -m "juce-engine phase2: render-export IPC message on the native side"
```

---

### Task 2: `buildEngineProject`'s `resolveStretched` — real implementation + error handling

Phase 1 built `buildEngineProject` with a dependency-injected `resolveStretched` parameter,
tested with a mock, but never wired to the real IPC call — and a Phase 1 code review flagged
that it also lacks the try/catch-with-fallback pattern `AudioEngine.ts`/`exportMix.ts` both
use around the same underlying `renderStretched` call. This task closes both gaps.

**Files:**
- Modify: `src/shared/buildEngineProject.ts`
- Modify: `src/shared/buildEngineProject.test.ts`
- Create: `src/main/resolveStretchedForExport.ts` (the real, non-mocked resolver — lives in
  `src/main` since it's only ever called from the main process, per Task 5)

- [ ] **Step 1: Add the fallback-on-failure test**

```ts
// src/shared/buildEngineProject.test.ts — add a new test:
  it('falls back to the original path when the resolver rejects, rather than throwing', async () => {
    const resolveStretched = vi.fn().mockRejectedValue(new Error('rubberband binary missing'))
    const state = stateWith({ bpm: 100, stretch: { r1: true } })
    const project = await buildEngineProject(state, resolveStretched)
    expect(project.rifffs[0].stems[0].resolvedPath).toBe('/a.wav')
  })
```

- [ ] **Step 2: Run to confirm it fails**

```bash
npx vitest run buildEngineProject
```
Expected: FAIL on the new test (current code has no try/catch, the rejection propagates).

- [ ] **Step 3: Add the try/catch fallback**

```ts
// src/shared/buildEngineProject.ts — in the stem loop, replace:
      let resolvedPath = stem.path
      if (Math.abs(ratio - 1) >= 0.001) {
        resolvedPath = await resolveStretched(stem.path, ratio)
      }
// with:
      let resolvedPath = stem.path
      if (Math.abs(ratio - 1) >= 0.001) {
        try {
          resolvedPath = await resolveStretched(stem.path, ratio)
        } catch (err) {
          // Same failure-isolation pattern AudioEngine.ts's loadBuffer and
          // exportMix.ts's loadBufferForExport already use — a missing rubberband
          // binary or a bad render shouldn't fail the whole export, it should
          // fall back to native-tempo playback for just this stem.
          console.error(
            `buildEngineProject: rubberband render failed for "${stem.path}" at ratio ${ratio}, falling back to native tempo`,
            err
          )
          resolvedPath = stem.path
        }
      }
```

- [ ] **Step 4: Run again, confirm all 8 tests pass**

```bash
npx vitest run buildEngineProject
```

- [ ] **Step 5: Write the real (non-mocked) resolver for use by the main process**

```ts
// src/main/resolveStretchedForExport.ts
import { renderStretched } from './rubberband'
import type { StretchResolver } from '@shared/buildEngineProject'

/**
 * The real StretchResolver implementation for native export — calls the same
 * rubberband CLI wrapper the renderer's window.rifffApi.renderStretched IPC
 * handler already calls (see src/main/index.ts's 'render-stretched' handler),
 * but directly, since this runs in the main process already and doesn't need
 * to round-trip through IPC to reach itself.
 */
export const resolveStretchedForExport: StretchResolver = (stemPath, ratio) =>
  renderStretched(stemPath, ratio)
```

Read `src/main/rubberband.ts` first to confirm `renderStretched`'s actual exported signature
matches `(stemPath: string, ratio: number) => Promise<string>` — Phase 1's
`buildEngineProject.ts` already assumes this shape for its `StretchResolver` type, so this
should be a direct match, but verify rather than assume.

- [ ] **Step 6: Typecheck, lint, full suite**

```bash
npm run typecheck && npm run lint && npm test -- --run
```

- [ ] **Step 7: Commit**

```bash
git add src/shared/buildEngineProject.ts src/shared/buildEngineProject.test.ts \
        src/main/resolveStretchedForExport.ts
git commit -m "juce-engine phase2: buildEngineProject gets real stretch resolution + failure fallback"
```

---

### Task 3: Node.js IPC client speaking JUCE's real wire protocol

The genuinely new piece: a TCP client in the Electron main process (plain Node, no JUCE
involved) that speaks `InterprocessConnection`'s actual framing, confirmed against JUCE
8.0.4 source (see this plan's Architecture section).

**Files:**
- Create: `src/main/engineClient.ts`
- Create: `src/main/engineClient.test.ts`

- [ ] **Step 1: Write the failing tests — using a real Node TCP server as the test double, not a mock**

A hand-rolled binary protocol is exactly the kind of thing that's worth testing against a
real socket, not a mocked one — mocking `net.Socket` risks the test passing while the real
framing is subtly wrong.

```ts
// src/main/engineClient.test.ts
import { describe, expect, it, afterEach } from 'vitest'
import { createServer, type Server, type Socket } from 'node:net'
import { EngineClient, encodeMessage, MAGIC_NUMBER } from './engineClient'

let server: Server | undefined

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()))
    server = undefined
  }
})

function startEchoServer(): Promise<number> {
  return new Promise((resolve) => {
    server = createServer((socket: Socket) => {
      let buf = Buffer.alloc(0)
      socket.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk])
        while (buf.length >= 8) {
          const magic = buf.readUInt32LE(0)
          const len = buf.readUInt32LE(4)
          if (magic !== MAGIC_NUMBER) return // malformed — real server would drop the connection
          if (buf.length < 8 + len) break
          const payload = buf.subarray(8, 8 + len).toString('utf8')
          buf = buf.subarray(8 + len)
          const parsed = JSON.parse(payload)
          // Echo server: for a "load-project" message, reply with a fixed
          // render-export-result so EngineClient's request/response matching
          // can be tested without a real engine process.
          if (parsed.type === 'render-export') {
            socket.write(
              encodeMessage(JSON.stringify({ type: 'render-export-result', payload: { success: true } }))
            )
          }
        }
      })
    })
    server!.listen(0, '127.0.0.1', () => {
      const address = server!.address()
      if (address === null || typeof address === 'string') throw new Error('unexpected address')
      resolve(address.port)
    })
  })
}

describe('encodeMessage', () => {
  it('writes an 8-byte header (magic + length, both little-endian) followed by the UTF-8 payload', () => {
    const encoded = encodeMessage('{"type":"quit"}')
    expect(encoded.readUInt32LE(0)).toBe(MAGIC_NUMBER)
    expect(encoded.readUInt32LE(4)).toBe(Buffer.byteLength('{"type":"quit"}', 'utf8'))
    expect(encoded.subarray(8).toString('utf8')).toBe('{"type":"quit"}')
  })
})

describe('EngineClient', () => {
  it('connects, sends a message, and receives a correctly-framed response', async () => {
    const port = await startEchoServer()
    const client = new EngineClient()
    await client.connect(port)
    const response = await client.sendAndAwaitType('render-export', { outputPath: '/tmp/x.wav', durationBars: 1 }, 'render-export-result')
    expect(response).toEqual({ success: true })
    client.disconnect()
  })

  it('rejects with a clear error if connection fails (nothing listening on the port)', async () => {
    const client = new EngineClient()
    await expect(client.connect(1)).rejects.toThrow() // port 1 requires root, always refused
  })
})
```

- [ ] **Step 2: Run to confirm it fails**

```bash
npx vitest run src/main/engineClient.test.ts
```
Expected: FAIL (`engineClient.ts` doesn't exist).

- [ ] **Step 3: Implement**

```ts
// src/main/engineClient.ts
import { Socket } from 'node:net'

// Confirmed against JUCE 8.0.4's actual InterprocessConnection::sendMessage /
// readNextMessage (modules/juce_events/interprocess/juce_InterprocessConnection.cpp):
// an 8-byte header (uint32 magic number, uint32 payload length, both
// little-endian on this platform via ByteOrder::swapIfBigEndian) followed by
// exactly that many raw payload bytes. The magic number is
// InterprocessConnection's compiled-in default (0xf2b49e2c) — none of this
// codebase's C++ IpcConnection/IpcServer/TestClient classes override it.
export const MAGIC_NUMBER = 0xf2b49e2c

export function encodeMessage(jsonText: string): Buffer {
  const payload = Buffer.from(jsonText, 'utf8')
  const header = Buffer.alloc(8)
  header.writeUInt32LE(MAGIC_NUMBER, 0)
  header.writeUInt32LE(payload.length, 4)
  return Buffer.concat([header, payload])
}

interface IncomingMessage {
  type: string
  payload?: unknown
}

/**
 * A minimal client for the native engine's JSON-over-socket IPC protocol,
 * speaking InterprocessConnection's real wire framing directly (see
 * MAGIC_NUMBER above) — no JUCE involved on this side, just a Node TCP
 * socket. Used by the main process to drive one-shot export operations;
 * NOT used for live playback (out of scope for this phase, see the plan's
 * scope-boundary note).
 */
export class EngineClient {
  private socket: Socket | null = null
  private recvBuf = Buffer.alloc(0)
  private pendingWaiters: { type: string; resolve: (payload: unknown) => void; reject: (err: Error) => void }[] = []

  connect(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new Socket()
      const onError = (err: Error): void => reject(err)
      socket.once('error', onError)
      socket.connect(port, '127.0.0.1', () => {
        socket.off('error', onError)
        socket.on('error', (err) => this.failAllWaiters(err))
        socket.on('data', (chunk) => this.onData(chunk))
        this.socket = socket
        resolve()
      })
    })
  }

  disconnect(): void {
    this.socket?.destroy()
    this.socket = null
  }

  private onData(chunk: Buffer): void {
    this.recvBuf = Buffer.concat([this.recvBuf, chunk])
    for (;;) {
      if (this.recvBuf.length < 8) return
      const magic = this.recvBuf.readUInt32LE(0)
      const len = this.recvBuf.readUInt32LE(4)
      if (magic !== MAGIC_NUMBER) {
        this.failAllWaiters(new Error('engine sent a malformed message (bad magic number)'))
        return
      }
      if (this.recvBuf.length < 8 + len) return // wait for the rest of this message
      const payloadText = this.recvBuf.subarray(8, 8 + len).toString('utf8')
      this.recvBuf = this.recvBuf.subarray(8 + len)
      this.handleMessage(payloadText)
    }
  }

  private handleMessage(payloadText: string): void {
    let msg: IncomingMessage
    try {
      msg = JSON.parse(payloadText) as IncomingMessage
    } catch {
      return // malformed JSON from the engine — ignore rather than crash the client
    }
    const waiterIdx = this.pendingWaiters.findIndex((w) => w.type === msg.type)
    if (waiterIdx === -1) return // not something anyone's waiting for (e.g. a stray position-update)
    const [waiter] = this.pendingWaiters.splice(waiterIdx, 1)
    waiter.resolve(msg.payload)
  }

  private failAllWaiters(err: Error): void {
    for (const waiter of this.pendingWaiters) waiter.reject(err)
    this.pendingWaiters = []
  }

  send(type: string, payload?: unknown): void {
    if (!this.socket) throw new Error('EngineClient: not connected')
    const text = JSON.stringify(payload === undefined ? { type } : { type, payload })
    this.socket.write(encodeMessage(text))
  }

  /** Sends a message and waits for the first reply of the given response type
   * — sufficient for this phase's one-shot request/response messages
   * (render-export -> render-export-result). Does not attempt to correlate
   * multiple concurrent requests of the same type; this client is used for
   * one export at a time, matching engineProcess.ts's one-process-per-export
   * design (see Task 4). */
  sendAndAwaitType(type: string, payload: unknown, responseType: string, timeoutMs = 30000): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingWaiters = this.pendingWaiters.filter((w) => w.resolve !== resolve)
        reject(new Error(`timed out waiting for "${responseType}" after ${timeoutMs}ms`))
      }, timeoutMs)
      this.pendingWaiters.push({
        type: responseType,
        resolve: (payload) => {
          clearTimeout(timer)
          resolve(payload)
        },
        reject: (err) => {
          clearTimeout(timer)
          reject(err)
        }
      })
      this.send(type, payload)
    })
  }
}
```

- [ ] **Step 4: Run tests, confirm pass**

```bash
npx vitest run src/main/engineClient.test.ts
```
Expected: both tests pass.

- [ ] **Step 5: Typecheck, lint**

```bash
npm run typecheck && npm run lint
```

- [ ] **Step 6: Commit**

```bash
git add src/main/engineClient.ts src/main/engineClient.test.ts
git commit -m "juce-engine phase2: Node.js IPC client speaking JUCE's real wire protocol"
```

---

### Task 4: Engine process manager

**Files:**
- Create: `src/main/engineProcess.ts`
- Create: `src/main/engineProcess.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/main/engineProcess.test.ts
import { describe, expect, it, afterEach } from 'vitest'
import { spawnEngine, type EngineHandle } from './engineProcess'

let handle: EngineHandle | undefined

afterEach(() => {
  handle?.stop()
  handle = undefined
})

describe('spawnEngine', () => {
  it('spawns the engine, waits for readiness, and returns a connected port', async () => {
    handle = await spawnEngine()
    expect(handle.port).toBeGreaterThan(0)
    expect(handle.process.exitCode).toBeNull() // still running
  })

  it('stop() terminates the process', async () => {
    handle = await spawnEngine()
    const proc = handle.process
    handle.stop()
    await new Promise<void>((resolve) => {
      if (proc.exitCode !== null) return resolve()
      proc.once('exit', () => resolve())
    })
    expect(proc.exitCode).not.toBeNull()
    handle = undefined // already stopped, don't double-stop in afterEach
  })

  it('rejects if the engine binary does not exist at the resolved path', async () => {
    await expect(spawnEngine({ binaryPathOverride: '/no/such/binary' })).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run to confirm it fails**

```bash
npx vitest run src/main/engineProcess.test.ts
```
Expected: FAIL (`engineProcess.ts` doesn't exist).

- [ ] **Step 3: Implement**

```ts
// src/main/engineProcess.ts
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

export interface EngineHandle {
  process: ChildProcess
  port: number
  stop: () => void
}

interface SpawnEngineOptions {
  binaryPathOverride?: string
  portOverride?: number
}

function defaultBinaryPath(): string {
  // Dev-mode only — see this plan's scope note on packaging. app.getAppPath()
  // is the Electron app's root directory; native-engine/ lives alongside src/
  // at the repo root in dev mode.
  return join(
    app.getAppPath(),
    'native-engine/build/ssstitch_engine_artefacts/Debug/ssstitch_engine'
  )
}

function pickEphemeralPort(): number {
  // Fixed low-numbered ports (like Phase 1 tests' 45322) risk collisions when
  // multiple exports could theoretically overlap, or with leftover processes
  // from manual testing. A random high port is cheap insurance; the chance of
  // collision with another process is negligible in practice.
  return 40000 + Math.floor(Math.random() * 10000)
}

/**
 * Spawns the native engine in --serve mode and resolves once it's confirmed
 * listening (parsed from its own stderr readiness log line — see
 * native-engine/Source/Main.cpp's runServe, which explicitly logs "serving on
 * 127.0.0.1:<port>" once beginWaitingForSocket succeeds; JUCE's
 * Logger::writeToLog writes to stderr on macOS, confirmed during Phase 1).
 */
export function spawnEngine(options: SpawnEngineOptions = {}): Promise<EngineHandle> {
  const binaryPath = options.binaryPathOverride ?? defaultBinaryPath()
  const port = options.portOverride ?? pickEphemeralPort()

  if (!existsSync(binaryPath)) {
    return Promise.reject(new Error(`native engine binary not found at ${binaryPath}`))
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(binaryPath, ['--serve', String(port)])
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      proc.kill('SIGKILL')
      reject(new Error('timed out waiting for the native engine to report readiness'))
    }, 5000)

    proc.stderr?.on('data', (chunk: Buffer) => {
      if (settled) return
      if (chunk.toString().includes(`serving on 127.0.0.1:${port}`)) {
        settled = true
        clearTimeout(timer)
        resolve({
          process: proc,
          port,
          stop: () => {
            if (proc.exitCode === null) proc.kill('SIGKILL')
          }
        })
      }
    })

    proc.once('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(err)
    })

    proc.once('exit', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new Error(`native engine exited early (code ${code}) before reporting readiness`))
    })
  })
}
```

- [ ] **Step 4: Run tests, confirm pass**

```bash
npx vitest run src/main/engineProcess.test.ts
```
Note: these tests spawn the real compiled binary — confirm `native-engine/build/` is built
(`cd native-engine && cmake --build build`) before running.

- [ ] **Step 5: Typecheck, lint**

```bash
npm run typecheck && npm run lint
```

- [ ] **Step 6: Commit**

```bash
git add src/main/engineProcess.ts src/main/engineProcess.test.ts
git commit -m "juce-engine phase2: engine process manager (spawn --serve, wait for readiness, stop)"
```

---

### Task 5: `nativeExport` orchestration + new IPC handler

**Files:**
- Create: `src/main/nativeExport.ts`
- Modify: `src/main/index.ts` (register the new IPC handler)
- Modify: `src/preload/index.ts` (expose it to the renderer)

- [ ] **Step 1: Write `nativeExport.ts`**

```ts
// src/main/nativeExport.ts
import { readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AppState } from '../renderer/src/state/store'
import { buildEngineProject } from '../shared/buildEngineProject'
import { resolveStretchedForExport } from './resolveStretchedForExport'
import { spawnEngine } from './engineProcess'
import { EngineClient } from './engineClient'

// Mirrors src/renderer/src/state/selectors.ts's loopLengthBars but re-implemented
// here rather than imported, since that module is renderer-only (imports React-side
// selectors that assume renderer context) — this is the one piece of duplicated
// logic this task introduces; see Task 9's retirement step for the cleanup this
// enables (once the renderer-side exportMix.ts is deleted, loopLengthBars itself
// could move to src/shared if a future task wants to de-duplicate this further).
function loopLengthBarsFor(state: AppState): number {
  const DEFAULT_LOOP_BARS = 32
  const ends: number[] = []
  for (const rifff of Object.values(state.rifffs)) {
    if (rifff.startBar === undefined) continue
    ends.push(rifff.startBar + rifff.barLength)
  }
  return ends.length === 0 ? DEFAULT_LOOP_BARS : Math.max(...ends)
}

/**
 * Renders the full arrangement via the native engine and returns the WAV bytes
 * — the native-engine equivalent of src/renderer/src/audio/exportMix.ts's
 * renderMixToWav, but running entirely in the main process (spawn engine,
 * load-project, render-export to a temp file, read it back, tear down).
 */
export async function nativeExport(state: AppState): Promise<Uint8Array> {
  const project = await buildEngineProject(state, resolveStretchedForExport)
  const durationBars = loopLengthBarsFor(state)

  const engineHandle = await spawnEngine()
  const client = new EngineClient()
  const tempPath = join(tmpdir(), `ssstitch-export-${randomUUID()}.wav`)

  try {
    await client.connect(engineHandle.port)
    client.send('load-project', project)
    const result = (await client.sendAndAwaitType(
      'render-export',
      { outputPath: tempPath, durationBars },
      'render-export-result'
    )) as { success: boolean; error?: string }

    if (!result.success) {
      throw new Error(`native export failed: ${result.error ?? 'unknown error'}`)
    }

    return readFileSync(tempPath)
  } finally {
    client.disconnect()
    engineHandle.stop()
    rmSync(tempPath, { force: true })
  }
}
```

- [ ] **Step 2: Register the IPC handler**

```ts
// src/main/index.ts — add the import:
import { nativeExport } from './nativeExport'
```

```ts
// src/main/index.ts — add alongside the other ipcMain.handle calls:
  ipcMain.handle('export-mix-native', async (_event, stateJson: string) => {
    const state = JSON.parse(stateJson) as import('../renderer/src/state/store').AppState
    return nativeExport(state)
  })
```

(Passing state as a JSON string across the IPC boundary, rather than the object directly,
matches this codebase's existing convention — see `save-project`'s `json: string`
parameter in the same file.)

- [ ] **Step 3: Expose it in the preload bridge**

```ts
// src/preload/index.ts — add to the api object:
  exportMixNative: (stateJson: string): Promise<Uint8Array> =>
    ipcRenderer.invoke('export-mix-native', stateJson),
```

- [ ] **Step 4: Typecheck (this task has no new automated tests of its own — Task 8's
integration test is where `nativeExport`'s actual correctness gets verified end-to-end;
`engineClient`/`engineProcess`, the pieces it composes, already have their own unit tests
from Tasks 3-4)**

```bash
npm run typecheck && npm run lint
```

- [ ] **Step 5: Commit**

```bash
git add src/main/nativeExport.ts src/main/index.ts src/preload/index.ts
git commit -m "juce-engine phase2: nativeExport orchestration + export-mix-native IPC handler"
```

---

### Task 6: Integration test — native export vs. reference math (multi-stem/multi-rifff)

The actual proof this phase exists to produce, mirroring Phase 1's `render-parity.test.ts`
approach but through the real production path (`nativeExport`, not a raw `--render-test`
CLI call) and against a realistic multi-stem, multi-rifff project — broader coverage than
Phase 1's single-stem parity test, closing part of the "stretch-ratio and multi-rifff
mixing aren't covered by an automated numeric test" gap Phase 1's findings doc flagged.

**Two confirmed environment constraints, resolved here rather than left for you to
discover** (checked directly before writing this: `vitest.config.ts` uses
`environment: 'node'` project-wide with no jsdom, and no `exportMix.test.ts` exists
anywhere in the repo):

1. **`renderMixToWav` (the Web Audio reference, in
   `src/renderer/src/audio/exportMix.ts`) cannot run under this test suite's environment at
   all** — it constructs a real `OfflineAudioContext`, which doesn't exist under Node, and
   jsdom (even if added) doesn't implement Web Audio either — jsdom is a DOM shim, not an
   audio engine. Don't attempt to import or call `renderMixToWav` in this test. Instead,
   follow the exact pattern Phase 1's `render-parity.test.ts` already established
   successfully for this same problem: compute the reference output directly with plain JS
   math (sum of each stem's sample value, scaled by volume, no fades needed for this
   fixture), rather than invoking the real Web-Audio-based function.
2. **`nativeExport(state)` internally calls `spawnEngine()` with no override**, which
   resolves the engine binary's path via `app.getAppPath()` from `'electron'` — this does
   not work under plain Vitest (no real Electron process is running), the same constraint
   Task 4 hit and solved for `engineProcess.test.ts` (by using `binaryPathOverride`, which
   isn't an option here since `nativeExport` itself has no such parameter). For this test,
   mock the `electron` module's `app.getAppPath()` to return the worktree root — in real
   dev-mode Electron, `app.getAppPath()` returns exactly the directory containing
   `package.json` (the project root), which is also where Vitest's own `process.cwd()`
   already points when tests run from the repo root, so `vi.mock('electron', () => ({
   app: { getAppPath: () => process.cwd() } }))` at the top of this test file is a faithful,
   minimal mock — not a workaround that changes what's being tested, just a substitute for
   the one piece of real Electron machinery this test can't run inside.

**Files:**
- Create: `src/main/nativeExport.test.ts`

- [ ] **Step 1: Write the test**

```ts
// src/main/nativeExport.test.ts
import { describe, expect, it, vi } from 'vitest'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// See this task's two environment-constraint notes above. app.getAppPath() must
// resolve to the worktree root for nativeExport's internal spawnEngine() call to
// find the real compiled engine binary at native-engine/build/... — matches what
// a real dev-mode Electron app's app.getAppPath() would return.
vi.mock('electron', () => ({ app: { getAppPath: () => process.cwd() } }))

const { nativeExport } = await import('./nativeExport')
const { initialState } = await import('../renderer/src/state/store')
const stateModule = await import('../renderer/src/state/store')
type AppState = InstanceType<typeof Object> extends never ? never : (typeof stateModule)['initialState']
// (If the dynamic-import dance above feels awkward, a plain top-level `import type { AppState } from '../renderer/src/state/store'`
// plus regular `import { initialState } from '../renderer/src/state/store'` and
// `import { nativeExport } from './nativeExport'` at the top of the file works
// identically as long as the vi.mock('electron', ...) call above is hoisted by
// Vitest before those imports execute — which it is, by Vitest's own vi.mock
// hoisting behavior. Use whichever form you're confident actually works; verify
// by running the test, don't guess.)
import type { Rifff } from '../shared/types'

function writeToneWavFixture(path: string, value: number, numSamples: number, sampleRate = 44100): void {
  const dataSize = numSamples * 2
  const buf = Buffer.alloc(44 + dataSize)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataSize, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(dataSize, 40)
  for (let i = 0; i < numSamples; i++) {
    buf.writeInt16LE(Math.round(value * 32767), 44 + i * 2)
  }
  writeFileSync(path, buf)
}

// Walks the RIFF chunk list to find "data" rather than assuming a fixed offset —
// JUCE's WavAudioFormat writer (the native side's output) inserts a JUNK padding
// chunk before "fmt ", pushing real audio data well past byte 44. This exact bug
// (assuming a fixed 44-byte header) was hit and fixed in Phase 1's
// render-parity.test.ts — don't reintroduce it here.
function findDataChunkOffset(buf: Uint8Array): number {
  let offset = 12 // skip "RIFF"[4 bytes size]"WAVE"
  while (offset + 8 <= buf.length) {
    const id = String.fromCharCode(buf[offset], buf[offset + 1], buf[offset + 2], buf[offset + 3])
    const size = buf[offset + 4] | (buf[offset + 5] << 8) | (buf[offset + 6] << 16) | (buf[offset + 7] << 24)
    if (id === 'data') return offset + 8
    offset += 8 + size + (size % 2) // chunks are word-aligned
  }
  throw new Error('no data chunk found')
}

describe('nativeExport — multi-stem/multi-rifff parity against reference math', () => {
  it('produces near-identical output for a two-stem, two-rifff project', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ssstitch-export-parity-'))
    const stemAPath = join(dir, 'a.wav')
    const stemBPath = join(dir, 'b.wav')
    const numSamples = 4 * 44100
    writeToneWavFixture(stemAPath, 0.3, numSamples)
    writeToneWavFixture(stemBPath, 0.2, numSamples)

    const rifffA: Rifff = {
      groupId: 'r1', name: 'a', bpm: 60, barLength: 1, folderPath: '/x', startBar: 0,
      stems: [{ slot: 1, author: 'e', name: 'a', type: 'fx', path: stemAPath, durationSec: 4, barLength: 1 }]
    }
    const rifffB: Rifff = {
      groupId: 'r2', name: 'b', bpm: 60, barLength: 1, folderPath: '/x', startBar: 0,
      stems: [{ slot: 1, author: 'e', name: 'b', type: 'fx', path: stemBPath, durationSec: 4, barLength: 1 }]
    }
    const state = {
      ...initialState,
      bpm: 60,
      rifffs: { r1: rifffA, r2: rifffB }
    }

    const nativeBytes = await nativeExport(state)

    // Reference: two unstretched, unmuted, unfaded stems at volume 1 (the
    // default — state.vol has no entries here), both starting at bar 0,
    // both exactly 1 bar long matching their rifff's own length — so the
    // expected output is simply the sample-wise sum of both tone fixtures,
    // clamped to int16 range. This mirrors exactly what exportMix.ts's real
    // Web Audio math would produce for this fixture, computed directly
    // instead of through OfflineAudioContext (see this task's constraint
    // notes above for why).
    const dataStart = 44 // both fixture WAVs here are hand-written with a plain 44-byte header
    const expectedSamples = new Int16Array(numSamples)
    for (let i = 0; i < numSamples; i++) {
      const a = Math.round(0.3 * 32767)
      const b = Math.round(0.2 * 32767)
      expectedSamples[i] = Math.max(-32768, Math.min(32767, a + b))
    }

    const nativeDataStart = findDataChunkOffset(nativeBytes)
    let maxDiff = 0
    for (let i = 0; i < expectedSamples.length; i++) {
      // native output is stereo (interleaved L/R); compare the left channel
      const n = nativeBytes[nativeDataStart + i * 4] | (nativeBytes[nativeDataStart + i * 4 + 1] << 8 << 16 >> 16)
      maxDiff = Math.max(maxDiff, Math.abs(n - expectedSamples[i]))
    }
    expect(maxDiff).toBeLessThanOrEqual(2)

    rmSync(dir, { recursive: true, force: true })
  }, 30000)
})
```

Note: the sample-reading arithmetic above (`nativeBytes[...] | (nativeBytes[...] << 8 << 16 >> 16)`)
is written to sign-extend a little-endian int16 from two bytes — double-check this is
correct by testing it, or replace with a clearer `new DataView(...).getInt16(offset, true)`
call instead, which is less error-prone than manual bit manipulation. Prefer clarity over
cleverness here; this is exactly the kind of hand-rolled bit-twiddling that's easy to get
subtly wrong, and Phase 1's own `render-parity.test.ts` used a `readWavSamples` helper
returning an `Int16Array` via `buf.readInt16LE(...)` (Node's `Buffer` method) rather than
manual bit-shifting — follow that precedent if `nativeBytes` can be treated as a `Buffer`
(it's typed `Uint8Array` from `readFileSync`, which IS a `Buffer` instance in Node — `Buffer`
extends `Uint8Array` — so `Buffer.from(nativeBytes.buffer, nativeBytes.byteOffset,
nativeBytes.byteLength).readInt16LE(offset)` or simply treating `nativeBytes` as already
being a `Buffer` if `readFileSync`'s return type allows it, works and is much safer than
manual shifting).

- [ ] **Step 2: Run it**

```bash
npx vitest run src/main/nativeExport.test.ts
```
Expected: PASS, but treat any failure here exactly as Phase 1's parity test framed it — a
genuinely useful diagnostic (either the native side or the reference math has a real bug),
not something to force-pass by loosening the tolerance. Given this is genuinely new
territory (Phase 1's own parity test only covered a single stem/rifff), a real discrepancy
here — e.g. in how multiple rifffs' outputs sum, or how `loopLengthBarsFor`'s duration
calculation compares to the renderer-side `loopLengthBars` it's mirroring — is a
legitimate, valuable finding, not a test-writing mistake to paper over. If the `vi.mock`
for `'electron'` doesn't work as sketched (module mocking + top-level dynamic import
ordering is genuinely fiddly in Vitest/ESM), investigate and fix rather than giving up on
testing the real `nativeExport` function — this is worth getting right since it's the
actual production code path.

- [ ] **Step 3: Commit**

```bash
git add src/main/nativeExport.test.ts
git commit -m "juce-engine phase2: multi-stem/multi-rifff export parity test"
```

---

### Task 7: Wire the app's real Export button to native export

**Files:**
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Read the current `handleExport` implementation**

```bash
grep -n "handleExport" -A 10 src/renderer/src/App.tsx
```

- [ ] **Step 2: Switch it to the native path**

```tsx
// src/renderer/src/App.tsx — replace handleExport's body:
  async function handleExport(): Promise<void> {
    setExporting(true)
    try {
      const wav = await window.rifffApi.exportMixNative(JSON.stringify(state))
      await window.rifffApi.exportMix(wav)
    } finally {
      setExporting(false)
    }
  }
```

(Exact surrounding code — the `setExporting`/`finally` structure — should match whatever
the existing `handleExport` already does; this step only changes which function produces
the WAV bytes, not the surrounding UI state handling. Read the actual current
implementation in Step 1 and adapt precisely, don't guess at the surrounding structure.)

- [ ] **Step 3: Manual UI verification**

Start the dev app (`npm run dev`), drag a rifff onto the timeline, click Export, confirm
the save dialog appears and the resulting WAV file plays back correctly and sounds right —
this is a real user-facing behavior change (the actual bytes written to disk now come from
a different code path), so an automated test passing isn't a substitute for actually
exporting a real project once and listening to the result.

- [ ] **Step 4: Typecheck, lint, full suite**

```bash
npm run typecheck && npm run lint && npm test -- --run
```

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/App.tsx
git commit -m "juce-engine phase2: wire the Export button to native export"
```

---

### Task 8: Retire the Web Audio export path

Only after Task 6's parity test and Task 7's manual verification both hold up — this is the
"once verified at parity, retire" half of the design doc's Phase 2 description.

**Files:**
- Modify: `src/renderer/src/audio/exportMix.ts` (or delete, if nothing else references it)
- Modify: `src/main/exportMix.ts` (keep — this is the save-dialog-and-write-to-disk part,
  still used by the native path via `window.rifffApi.exportMix`; only the *rendering* logic
  is being retired, not the file-save mechanics)

- [ ] **Step 1: Confirm nothing else references `renderMixToWav` besides `App.tsx` (now removed in Task 7) and Task 6's own parity test**

```bash
grep -rn "renderMixToWav" src/ native-engine/test/ --include="*.ts" --include="*.tsx"
```
Expected: only `src/renderer/src/audio/exportMix.ts` (the definition) and
`src/main/nativeExport.test.ts` (Task 6's reference comparison, which legitimately still
needs to call it — don't remove that reference).

- [ ] **Step 2: Delete `src/renderer/src/audio/exportMix.ts`'s `renderMixToWav` and its
now-unused helper `loadBufferForExport`, if nothing besides Task 6's test still imports them**

This is a judgment call given the codebase's actual state at execution time — if Task 6's
test still needs `renderMixToWav` as its reference implementation (it does, per Task 6's
own design), **do not delete the function** — keep it as a test-only reference. What
*should* go away is any remaining production code path that calls it outside of that one
test file (there shouldn't be any left after Task 7). If, on inspection, the function is
now only reachable from `nativeExport.test.ts`, that's the intended end state for this
phase — leave the file in place as a reference implementation rather than deleting it,
and note this explicitly in the findings doc (Task 9) rather than silently under-delivering
on the design doc's "retire" language. A full deletion of the Web Audio reference math
would remove the only independent check this test suite has for future native-engine
regressions — that's a real cost, worth surfacing to a human before doing, not deciding
unilaterally mid-task. If you reach this step and believe full deletion (not just
production-callsite removal) is still the right call, stop and flag it rather than
proceeding — this is exactly the kind of judgment call this plan's "STOP and escalate"
guidance exists for.

- [ ] **Step 3: Typecheck, lint, full suite**

```bash
npm run typecheck && npm run lint && npm test -- --run
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "juce-engine phase2: retire the Web Audio export code path from production use"
```

---

### Task 9: Write up Phase 2 findings

**Files:**
- Create: `native-engine/PHASE2_FINDINGS.md`

- [ ] **Step 1: Document what actually happened**

Follow `PHASE1_FINDINGS.md`'s model. Cover: confirmation the wire-protocol client (Task 3)
works correctly against a real socket, not just a mock; the actual parity numbers from Task
6's multi-stem/multi-rifff test (name the real maxDiff observed, and be explicit this is
broader coverage than Phase 1's single-stem test — first time stretch-ratio and multi-rifff
mixing get an automated numeric check); confirmation the real Export button was manually
verified end-to-end (Task 7 Step 3) and what was actually heard/confirmed; the actual
outcome of Task 8's retirement step (was `renderMixToWav` fully deleted, or kept as a
test-only reference, and why); any bugs found and fixed along the way (name them, with the
same technical specificity Phase 1's findings doc used); and an explicit statement that live
playback (`AudioEngine.ts`) is still Web Audio-based and untouched by this phase, remaining
a gap for a future phase, per this plan's own scope boundary.

- [ ] **Step 2: Commit**

```bash
git add native-engine/PHASE2_FINDINGS.md
git commit -m "juce-engine phase2: findings write-up"
```
