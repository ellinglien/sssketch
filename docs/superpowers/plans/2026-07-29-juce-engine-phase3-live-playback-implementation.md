# JUCE Engine Phase 3 — Native Live Playback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `AudioEngine.ts`'s Web Audio playback with the native JUCE engine as the
app's only live-playback path, hard cutover matching Phase 2's export precedent, per the
approved design at
`docs/superpowers/specs/2026-07-29-juce-engine-phase3-live-playback-design.md`.

**Architecture:** The native engine already fully supports everything this phase needs —
`load-project`/`play`/`pause`/`stop`/`set-position` and 30Hz `position-update` push were all
built in Phase 1 and never wired to anything live (confirmed by reading
`native-engine/Source/IpcServer.cpp`'s current `messageReceived` before writing this plan —
no native-side changes are required). This phase is TS-side integration: extend
`EngineClient` (Phase 2) with a push-subscription capability alongside its existing
request/response method, spawn a second, independent, persistent engine process at app
startup (kept entirely separate from export's existing per-export spawned engine — see the
design doc's rationale), wire new IPC handlers + preload surface for playback, and rewrite
`StoreContext.tsx` to talk to the engine over IPC instead of `AudioEngine.ts`/Web Audio.
`EngineProject` construction moves to the renderer (via `buildEngineProject`, already
built, with a new renderer-side stretch resolver calling `window.rifffApi.renderStretched`
directly) rather than round-tripping full `AppState` through main on every reactive update,
since this effect can fire frequently during editing — unlike export, a rare one-shot
operation where Phase 2's full-state-JSON approach was fine.

**Tech Stack:** TypeScript (Electron main + renderer + shared), Vitest, reusing every
pattern Phases 1-2 already proved: real-TCP-server tests for wire-protocol code, real
compiled-binary tests for IPC round-trips, offline `--render-test` comparisons against
independently-computed reference math for numeric parity (not against `renderMixToWav` —
deleted in Phase 2 — or `AudioEngine.ts` directly, which can't run under this project's
`environment: 'node'` Vitest setup, the same constraint Phase 2 hit).

**Prerequisite:** Phase 2 complete and merged (`native-engine/PHASE2_FINDINGS.md` on
master) — `engineClient.ts`, `engineProcess.ts`, `buildEngineProject.ts`, and the native
`render-export`/`load-project`/`play`/`pause`/`stop`/`set-position` IPC surface all already
exist and are proven.

---

## Scope notes

- **No native C++ changes in this phase.** Verified directly against the current
  `IpcServer.cpp` before writing this plan — every message type this phase needs already
  exists and already works (proven by Phase 1's now-unused-until-now `position-update`
  timer and `play`/`pause`/`stop`/`set-position` handlers). If a task discovers this
  assumption doesn't hold at execution time (the codebase may have changed), stop and
  escalate rather than silently adding native-side work outside this plan's scope.
- **Two independent engine processes** — this phase's persistent playback engine and
  Phase 2's per-export spawned engine never share a `PlaybackEngine`/`currentProject`. See
  the design doc for why (a shared engine would let an export clobber the live project
  mid-playback).
- **`EngineProject` is built in the renderer, not main.** Reuses `buildEngineProject`
  (already in `src/shared/`) with a new renderer-side `StretchResolver` calling
  `window.rifffApi.renderStretched` (the existing IPC bridge to rubberband, already used by
  the pre-Phase-3 `AudioEngine.ts`) — the *built* `EngineProject`, not the full `AppState`,
  crosses the IPC boundary to main, which just forwards it to the engine.
- **Crash recovery's "silent" only means no visible error UI.** Main process pushes a
  lightweight event on reconnect so the renderer can dispatch the existing `STOP` action
  (already sets both `playing: false` and `pos: 0` — confirmed in `store.ts`) and keep state
  honest, without a banner.

---

### Task 1: Extend `EngineClient` with push-message subscription

**Files:**
- Modify: `src/main/engineClient.ts`
- Modify: `src/main/engineClient.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/main/engineClient.test.ts — add to the existing describe('EngineClient', ...) block:
  it('delivers pushed messages to a subscribed listener, repeatedly, without consuming a one-shot waiter', async () => {
    const port = await startEchoServer()
    const client = new EngineClient()
    await client.connect(port)

    const received: unknown[] = []
    const unsubscribe = client.on('position-update', (payload) => received.push(payload))

    // The existing echo server only replies to "render-export" — extend it inline
    // here isn't possible (it's a shared helper), so this test drives its own
    // minimal push-capable server instead of reusing startEchoServer().
    unsubscribe()
    client.disconnect()
  })
```

Read the *actual current* `startEchoServer()` helper in `engineClient.test.ts` before
writing this — it only replies to `"render-export"` with a single message, which isn't
enough to test a repeated push subscription. Write a **new** local helper in this test file
(don't modify `startEchoServer`, which existing tests depend on) that, on receiving a
`"subscribe-me"` message, sends three `position-update` pushes in a row (e.g. `pos: 0.1`,
`0.2`, `0.3`) with a short delay between each, then rewrite the test above to use that new
helper and assert all three pushes were received, in order, by the subscribed listener —
and that a second push arriving *after* `unsubscribe()` is called is NOT delivered (spin up
a fourth delayed push, unsubscribe before it arrives, assert `received.length` didn't grow).
Also add a second test confirming `client.on()` does not interfere with
`sendAndAwaitType`'s existing one-shot matching — e.g. subscribe to `'position-update'`,
then separately call `sendAndAwaitType('render-export', ..., 'render-export-result')`
against the existing echo server behavior, confirm both the subscription and the
request/response resolve correctly and independently.

- [ ] **Step 2: Run to confirm it fails**

```bash
npx vitest run src/main/engineClient.test.ts
```
Expected: FAIL (`client.on` doesn't exist yet).

- [ ] **Step 3: Implement**

```ts
// src/main/engineClient.ts — add a subscribers map alongside pendingWaiters, and
// change handleMessage to check it. Read the actual current file first (it has
// evolved since Phase 2's fix cycles — the null-payload/shape-validation guard,
// the bad-magic socket teardown) and make sure this integrates with the real
// current messageReceived/handleMessage structure, not an assumed older version.

// Add near the top of the class, alongside `pendingWaiters`:
  private subscribers = new Map<string, Set<(payload: unknown) => void>>()

// New public methods, alongside send/sendAndAwaitType:
  /** Subscribes to every message of the given type, indefinitely, until
   * unsubscribed — for the engine's own pushed events (position-update, and
   * this phase's new engine-restarted signal), which arrive repeatedly and
   * unprompted, unlike sendAndAwaitType's one-shot request/response messages.
   * Returns an unsubscribe function. */
  on(type: string, callback: (payload: unknown) => void): () => void {
    let set = this.subscribers.get(type)
    if (!set) {
      set = new Set()
      this.subscribers.set(type, set)
    }
    set.add(callback)
    return () => {
      set!.delete(callback)
      if (set!.size === 0) this.subscribers.delete(type)
    }
  }
```

Then, in `handleMessage`, after the existing `msg.type`/shape validation (keep that guard
exactly as-is — it protects both paths) and *before* (or after — order doesn't matter, they
serve different message types) the existing one-shot-waiter matching, add subscriber
dispatch:

```ts
// engineClient.ts — inside handleMessage, after the shape-validation guard that
// already exists (`typeof parsed !== 'object' || parsed === null || typeof ... !== 'string'`),
// add before or after the existing pendingWaiters lookup:
    const subs = this.subscribers.get(msg.type)
    if (subs) {
      for (const cb of subs) cb(msg.payload)
    }
```

Read the current `handleMessage` in full before editing — this needs to coexist with the
existing `waiterIdx`/`splice`/`resolve` one-shot logic without disturbing it (a message type
could theoretically have both a pending one-shot waiter AND a persistent subscriber; both
should fire independently — don't make this an `else` branch of the existing waiter check).

- [ ] **Step 4: Run tests, confirm pass**

```bash
npx vitest run src/main/engineClient.test.ts
```

- [ ] **Step 5: Typecheck, lint**

```bash
npm run typecheck && npm run lint
```

- [ ] **Step 6: Commit**

```bash
git add src/main/engineClient.ts src/main/engineClient.test.ts
git commit -m "juce-engine phase3: EngineClient push-message subscription (on/off)"
```

---

### Task 2: Renderer-side stretch resolver

Mirrors Phase 2's `resolveStretchedForExport.ts`, but for the renderer (where
`window.rifffApi.renderStretched` is directly available, unlike main).

**Files:**
- Create: `src/renderer/src/audio/resolveStretchedForPlayback.ts`

- [ ] **Step 1: Write it**

```ts
// src/renderer/src/audio/resolveStretchedForPlayback.ts
import type { StretchResolver } from '@shared/buildEngineProject'

/**
 * The renderer-side StretchResolver for live playback — calls the existing
 * window.rifffApi.renderStretched IPC bridge directly (the same one
 * AudioEngine.ts's loadBuffer already calls today), matching
 * resolveStretchedForExport.ts's main-process equivalent from Phase 2.
 */
export const resolveStretchedForPlayback: StretchResolver = (stemPath, ratio) =>
  window.rifffApi.renderStretched(stemPath, ratio)
```

No test file — this is a one-line pass-through with no logic of its own, matching Phase 2's
own precedent for `resolveStretchedForExport.ts` (also untested directly, reviewed and
accepted as appropriately thin).

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/audio/resolveStretchedForPlayback.ts
git commit -m "juce-engine phase3: renderer-side stretch resolver for live playback"
```

---

### Task 3: Main process — persistent playback engine lifecycle

**Files:**
- Create: `src/main/playbackEngineLifecycle.ts`
- Create: `src/main/playbackEngineLifecycle.test.ts`

This module owns the single, session-long `EngineClient` connection for live playback:
spawns the engine at startup, detects crashes, respawns/reconnects/re-sends the last-known
project, and exposes the small API `main/index.ts` needs (Task 4) without main having to
know engine-lifecycle details directly.

- [ ] **Step 1: Write the failing tests**

```ts
// src/main/playbackEngineLifecycle.test.ts
import { describe, expect, it, vi, afterEach } from 'vitest'

vi.mock('electron', () => ({ app: { getAppPath: () => process.cwd() } }))

const { startPlaybackEngine } = await import('./playbackEngineLifecycle')

describe('startPlaybackEngine', () => {
  let handle: Awaited<ReturnType<typeof startPlaybackEngine>> | undefined

  afterEach(() => {
    handle?.shutdown()
    handle = undefined
  })

  it('spawns the engine and the returned client can send load-project without throwing', async () => {
    handle = await startPlaybackEngine()
    // A minimal, valid empty project — proves the connection is live and the
    // engine accepts messages, without needing real stem files.
    handle.client.send('load-project', { bpm: 120, snapDiv: 16, rifffs: [] })
    // No response is expected for load-project (fire-and-forget, matching how
    // the native side already handles it) — just confirm send() doesn't throw
    // (i.e. the socket is genuinely connected).
    expect(handle.client).toBeDefined()
  })

  it('remembers the last project sent via sendLoadProject, for crash-recovery resend', async () => {
    handle = await startPlaybackEngine()
    const project = { bpm: 100, snapDiv: 8, rifffs: [] }
    handle.sendLoadProject(project)
    expect(handle.getLastProject()).toEqual(project)
  })
})
```

Before writing the implementation, decide (and note in your report) whether
`sendLoadProject`/`getLastProject` is the right minimal API shape, or whether it's cleaner
for `startPlaybackEngine`'s returned handle to expose the raw `EngineClient` plus a separate
tracked "last project" ref that `main/index.ts`'s own IPC handler updates directly. Either
is fine; pick one, keep it consistent with Task 4's actual usage, and don't over-build
beyond what Task 4 needs.

- [ ] **Step 2: Run to confirm it fails**

```bash
npx vitest run src/main/playbackEngineLifecycle.test.ts
```
Expected: FAIL (module doesn't exist).

- [ ] **Step 3: Implement**

```ts
// src/main/playbackEngineLifecycle.ts
import { spawnEngine, type EngineHandle } from './engineProcess'
import { EngineClient } from './engineClient'

export interface PlaybackEngineHandle {
  client: EngineClient
  sendLoadProject: (project: unknown) => void
  getLastProject: () => unknown
  /** Called when main.process itself is shutting down (app quit) — tears
   * down the connection and kills the engine process, no crash-recovery
   * respawn attempted (that's only for *unexpected* disconnects). */
  shutdown: () => void
  /** Subscribes to the crash-recovery signal — fires once per detected
   * crash+respawn+reconnect cycle, after the engine is reconnected and the
   * last-known project has been re-sent. Task 4 uses this to relay a
   * lightweight event to the renderer. */
  onRestarted: (callback: () => void) => () => void
}

/**
 * Spawns and owns the single, session-long native engine process used for
 * live playback — entirely separate from Phase 2's per-export spawned
 * engine (see the Phase 3 design doc for why they must not share a
 * PlaybackEngine/currentProject). Detects unexpected disconnects (the
 * engine process crashing, not a deliberate shutdown() call) and silently
 * respawns + reconnects + re-sends the last-known project.
 */
export async function startPlaybackEngine(): Promise<PlaybackEngineHandle> {
  let engineHandle: EngineHandle
  let client: EngineClient
  let lastProject: unknown = null
  let shuttingDown = false
  const restartListeners = new Set<() => void>()

  async function connect(): Promise<void> {
    engineHandle = await spawnEngine()
    client = new EngineClient()
    await client.connect(engineHandle.port)

    // Detect an unexpected process exit (crash) — but not the exit our own
    // shutdown() triggers deliberately, which sets shuttingDown first.
    engineHandle.process.once('exit', () => {
      if (shuttingDown) return
      console.error('playbackEngineLifecycle: engine process exited unexpectedly, respawning')
      void respawn()
    })
  }

  async function respawn(): Promise<void> {
    client.disconnect()
    await connect()
    if (lastProject !== null) {
      client.send('load-project', lastProject)
    }
    for (const cb of restartListeners) cb()
  }

  await connect()

  return {
    get client() {
      return client
    },
    sendLoadProject(project: unknown) {
      lastProject = project
      client.send('load-project', project)
    },
    getLastProject: () => lastProject,
    shutdown() {
      shuttingDown = true
      client.disconnect()
      engineHandle.stop()
    },
    onRestarted(callback: () => void) {
      restartListeners.add(callback)
      return () => restartListeners.delete(callback)
    }
  }
}
```

Note: the `get client()` getter pattern (rather than a plain `client: EngineClient` field
captured once) matters here — after a respawn, `client` is reassigned to a *new*
`EngineClient` instance, and callers (Task 4) always need the current one, not whichever
was live when they first received the handle. Verify this actually works as intended when
you write Task 4's code that reads `handle.client` repeatedly across calls (e.g. inside an
`ipcMain.handle` callback that runs long after `startPlaybackEngine()` resolved) — if the
getter approach has any issue in practice, an alternative is exposing `sendPlay`/
`sendPause`/etc. methods directly on the handle instead of exposing `client` at all, so
callers never hold a stale reference. Use your judgment; note which you chose and why.

- [ ] **Step 4: Run tests, confirm pass**

```bash
npx vitest run src/main/playbackEngineLifecycle.test.ts
```

- [ ] **Step 5: Typecheck, lint**

```bash
npm run typecheck && npm run lint
```

- [ ] **Step 6: Commit**

```bash
git add src/main/playbackEngineLifecycle.ts src/main/playbackEngineLifecycle.test.ts
git commit -m "juce-engine phase3: persistent playback engine lifecycle (spawn, crash recovery)"
```

---

### Task 4: Wire playback engine startup + IPC handlers + preload surface

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`

- [ ] **Step 1: Start the playback engine at app startup, register IPC handlers**

Read `src/main/index.ts`'s current full contents first (it has `nativeExport`'s handler
from Phase 2 already) and add to the existing `app.whenReady().then(() => { ... })` block —
don't restructure what's already there.

```ts
// src/main/index.ts — add the import:
import { startPlaybackEngine } from './playbackEngineLifecycle'
```

```ts
// src/main/index.ts — inside app.whenReady().then(async () => { ... }) — note this
// requires changing the existing arrow function to async if it isn't already;
// check its current signature before editing:
  const playbackEngine = await startPlaybackEngine()

  ipcMain.handle('engine-load-project', (_event, project: unknown) => {
    playbackEngine.sendLoadProject(project)
  })

  ipcMain.handle('engine-play', (_event, fromPos: number) => {
    playbackEngine.client.send('play', { fromPos })
  })

  ipcMain.handle('engine-pause', () => {
    playbackEngine.client.send('pause')
  })

  ipcMain.handle('engine-stop', () => {
    playbackEngine.client.send('stop')
  })

  ipcMain.handle('engine-set-position', (_event, pos: number) => {
    playbackEngine.client.send('set-position', { pos })
  })
```

- [ ] **Step 2: Relay pushed engine events to the renderer**

`position-update` and the crash-recovery signal both need to reach the renderer as pushed
events (not request/response) — the standard Electron pattern is
`webContents.send(channel, payload)` from main, `ipcRenderer.on(channel, listener)` in
preload.

```ts
// src/main/index.ts — after createWindow() is called (need the window reference
// to call webContents.send — read how createWindow() currently returns/exposes
// the BrowserWindow, or capture it: `const mainWindow = createWindow()` if it
// doesn't already return one, adjust createWindow()'s return type accordingly):
  playbackEngine.client.on('position-update', (payload) => {
    mainWindow.webContents.send('engine-position-update', payload)
  })

  playbackEngine.onRestarted(() => {
    mainWindow.webContents.send('engine-restarted')
  })
```

`createWindow()` currently has return type `void` — check its actual current signature and
either change it to return the `BrowserWindow` it creates, or restructure so the window
reference is available where this wiring needs it. This is a small, mechanical change; make
it cleanly rather than working around it with a global variable.

- [ ] **Step 3: Shut down the playback engine on app quit**

```ts
// src/main/index.ts — add near the existing app.on('window-all-closed', ...) handler:
app.on('before-quit', () => {
  playbackEngine?.shutdown()
})
```

`playbackEngine` needs to be reachable from this handler — since it's created inside the
`app.whenReady().then(...)` callback, either hoist a module-level variable it gets assigned
into, or restructure. Keep this simple and consistent with how the rest of `index.ts`
already scopes things.

- [ ] **Step 4: Expose the new API in the preload bridge**

```ts
// src/preload/index.ts — add to the api object:
  engineLoadProject: (project: unknown): Promise<void> =>
    ipcRenderer.invoke('engine-load-project', project),
  enginePlay: (fromPos: number): Promise<void> => ipcRenderer.invoke('engine-play', fromPos),
  enginePause: (): Promise<void> => ipcRenderer.invoke('engine-pause'),
  engineStop: (): Promise<void> => ipcRenderer.invoke('engine-stop'),
  engineSetPosition: (pos: number): Promise<void> =>
    ipcRenderer.invoke('engine-set-position', pos),
  onEnginePositionUpdate: (callback: (pos: number) => void): (() => void) => {
    const listener = (_event: unknown, payload: { pos: number }): void => callback(payload.pos)
    ipcRenderer.on('engine-position-update', listener)
    return () => ipcRenderer.removeListener('engine-position-update', listener)
  },
  onEngineRestarted: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('engine-restarted', listener)
    return () => ipcRenderer.removeListener('engine-restarted', listener)
  }
```

Check the actual shape of `position-update`'s payload as sent by the native side
(`native-engine/Source/IpcServer.cpp`'s `timerCallback` — `payload->setProperty("pos",
transport.currentPositionBars())`) to confirm `{ pos: number }` is correct before writing
the listener's destructuring.

- [ ] **Step 5: Typecheck, lint**

```bash
npm run typecheck && npm run lint
```
No automated test for this task — it's IPC/lifecycle wiring in `main/index.ts`, which
(consistent with this codebase's existing precedent — `index.ts` has never had its own test
file) is verified through Task 6's live integration test and Task 8's manual verification,
not a unit test of this file directly.

- [ ] **Step 6: Commit**

```bash
git add src/main/index.ts src/preload/index.ts
git commit -m "juce-engine phase3: wire playback engine startup, IPC handlers, preload surface"
```

---

### Task 5: Rewrite `StoreContext.tsx` to use the native engine

**Files:**
- Modify: `src/renderer/src/state/StoreContext.tsx`

This is the task that actually retires `AudioEngine.ts` from the live code path (deletion
itself is Task 9, once this is proven — but after this task, nothing should still construct
or call an `AudioEngine` instance).

- [ ] **Step 1: Read the current file in full**

Read `src/renderer/src/state/StoreContext.tsx` completely before editing — this plan was
written against its state as of Phase 2's merge, but re-confirm nothing has shifted. Pay
particular attention to: the `engineRef`-creation effect, the play/pause effect (with its
`requestAnimationFrame` loop and loop-wrap detection via `newPos < lastPos`), the
reschedule effect and its exact dependency list, and the `updateLiveGains` effect.

- [ ] **Step 2: Replace the engine creation effect**

The old code constructs an `AudioEngine` with a large `EngineDeps` object of getter
callbacks. The new version builds an `EngineProject` (via `buildEngineProject` +
`resolveStretchedForPlayback`, from Task 2) and sends it to the engine whenever relevant
state changes — there's no persistent local "engine instance" to construct, just IPC calls.

```tsx
// src/renderer/src/state/StoreContext.tsx — replace the `engineRef`/AudioEngine
// construction effect and the reschedule effect with:
import { buildEngineProject } from '@shared/buildEngineProject'
import { resolveStretchedForPlayback } from '../audio/resolveStretchedForPlayback'

// ... inside StoreProvider, replacing the old engineRef-based effects:

  // Keeps the native engine's picture of the project in sync with every
  // scheduling-relevant state change — playing or not. Sending load-project
  // to a paused engine is harmless and keeps it always current for whenever
  // play is next pressed; there's no separate "reschedule while playing"
  // code path the way AudioEngine.ts needed, because PlaybackEngine::renderBlock
  // recomputes scheduling fresh from whatever project is currently loaded on
  // every single audio block — see the Phase 3 design doc.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const project = await buildEngineProject(state, resolveStretchedForPlayback)
      if (!cancelled) {
        await window.rifffApi.engineLoadProject(project)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [
    state.off,
    state.bpm,
    state.snapIdx,
    state.unlinked,
    state.stretch,
    state.rifffs,
    state.stemStart,
    state.fadeIn,
    state.fadeOut,
    state.vol,
    state.mute
  ])
```

Note the dependency list now includes `state.vol`/`state.mute` too (the old code had a
*separate* `updateLiveGains` effect specifically for those, calling a cheap live-gain-only
update rather than a full reschedule, because `AudioEngine.ts`'s live gain nodes could be
adjusted without rebuilding the whole schedule). The native engine has no equivalent
cheap-path — `load-project` is the only way to change volume/mute, and it's not
prohibitively expensive (it's how Phase 1/2 already always work), so folding `vol`/`mute`
into this same effect instead of keeping a separate optimized path is the right
simplification here. If, during manual verification (Task 8), rapid volume-slider dragging
produces audibly choppy playback because of this, that's a legitimate finding — escalate it
rather than silently reintroducing a separate fast-path, since it wasn't anticipated by the
design doc and deserves a real decision.

- [ ] **Step 3: Replace the play/pause effect with IPC calls + position-update subscription**

```tsx
// src/renderer/src/state/StoreContext.tsx — replace the old play/pause effect
// (the one with the requestAnimationFrame loop) with:
  useEffect(() => {
    if (state.playing) {
      void window.rifffApi.enginePlay(state.pos)
    } else {
      void window.rifffApi.engineStop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally only re-runs on play/pause transitions, matching the old effect's behavior; state.pos is read once at play-start via closure, not tracked as a dependency
  }, [state.playing])
```

Wait — the old code distinguished `PAUSE` (engine keeps its position, can resume) from
`STOP` (resets to 0). Check: does `state.playing` alone carry enough information to know
whether this is a pause-then-resume or a stop? Re-read the reducer's `PAUSE`/`STOP` cases
(`store.ts`) and the old `AudioEngine.ts`-based effect's actual `else` branch (it called
`engineRef.current!.stop()` unconditionally whenever `state.playing` became false — meaning
the OLD code already didn't distinguish pause from stop at the engine level; pausing in this
app's UI has always meant "engine stops, but React `state.pos` is preserved for the next
`play()` to resume from," never a native transport-level pause/resume). Confirm this
understanding is correct by re-reading the old effect before assuming, then use
`window.rifffApi.engineStop()` for both the `PAUSE`-triggered and `STOP`-triggered false
transition, matching old behavior — *not* `enginePause()`/`engineSetPosition`, unless your
own reading of the old code says otherwise. If you find the old behavior actually did
distinguish them somehow, follow that instead and note the discrepancy from this plan's
assumption in your report.

Now the position-update subscription, replacing the rAF loop and its inline loop-wrap
detection:

```tsx
// src/renderer/src/state/StoreContext.tsx — add a new effect (runs once, not
// tied to play/pause — the subscription itself is cheap; it only produces
// dispatches while the engine is actually sending updates, i.e. while playing):
  useEffect(() => {
    return window.rifffApi.onEnginePositionUpdate((pos) => {
      const loopBars = loopLengthBars(stateRef.current)
      if (pos >= loopBars) {
        // Loop wrap-around: the native transport counts up monotonically
        // forever with no concept of loop length (that's a renderer-only
        // concept, computed from rifffs) — mirror the old AudioEngine.ts-era
        // wrap detection, just triggered by real engine events now instead
        // of a locally-computed value.
        const wrapped = pos % loopBars
        void window.rifffApi.engineSetPosition(wrapped)
        dispatch({ type: 'SET_POS', pos: wrapped })
      } else {
        dispatch({ type: 'SET_POS', pos })
      }
    })
  }, [dispatch])
```

Re-examine the old rAF loop's exact wrap condition (`if (newPos < lastPos) { engine.play(newPos) }`
— it detected wrap by the position *decreasing* between polls, since `AudioEngine.ts`'s own
`currentPos(loopBars)` already applied the modulo internally) versus this new version, which
receives the *raw, unwrapped* position from the native transport (confirmed: `Transport`'s
`positionBars` counts up forever, per `Transport.cpp`) and needs to compute the wrap itself.
Verify the `pos >= loopBars` / `pos % loopBars` logic above is actually correct by tracing
through a concrete example (e.g. `loopBars = 8`, transport position drifts to `8.02` on some
poll — wrapped should be `0.02`, and `engineSetPosition` should be called so the *next*
`renderBlock` call and the *next* position-update both reflect the corrected, wrapped
position) before trusting it as given.

- [ ] **Step 4: Subscribe to the crash-recovery signal**

```tsx
// src/renderer/src/state/StoreContext.tsx — add:
  useEffect(() => {
    return window.rifffApi.onEngineRestarted(() => {
      dispatch({ type: 'STOP' })
    })
  }, [dispatch])
```

- [ ] **Step 5: Remove now-dead imports/refs**

Remove the `AudioEngine` import, `engineRef`, `stateRef` if nothing else in this file still
needs it (check — `stateRef` might still be needed by the position-update effect above,
which reads `stateRef.current` for `loopLengthBars`; if so, keep it, just confirm it's
genuinely still used, not dead weight left over from the deleted engine-construction
effect).

- [ ] **Step 6: Typecheck, lint**

```bash
npm run typecheck && npm run lint
```
Expected: `AudioEngine.ts` itself isn't deleted yet (that's Task 9) — this task should
typecheck clean with `AudioEngine.ts` simply unimported/unused by `StoreContext.tsx`
anymore, not yet removed from the repo.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/state/StoreContext.tsx
git commit -m "juce-engine phase3: StoreContext talks to the native engine over IPC"
```

---

### Task 6: Live IPC integration test — proves the reactive `load-project`-while-playing sequence works

Mirrors Phase 1's `ipc-roundtrip.test.ts` pattern, extended to prove the specific sequence
this phase's architecture depends on: sending a new `load-project` message *while the
engine is already playing* doesn't error, disconnect, or otherwise break the connection —
the actual "does swapping the project mid-stream survive" contract this whole phase's
simplification rests on. (This test proves the IPC sequence is safe, not that the *audible
output* changed — that's Task 8's manual verification, since audio content isn't observable
over this socket.)

**Design note, already resolved while writing this plan (don't re-investigate):** the
obvious approach — spawn `--serve`, drive it with `--test-client` twice — doesn't work.
Checked directly against the current `native-engine/Source/Main.cpp`: `runTestClient`
unconditionally sends `stop` then `quit` at the end of its sequence, and `quit` (per
`IpcServer.cpp`'s `messageReceived`) calls `juce::JUCEApplicationBase::quit()`, which
terminates the *whole server process* — not just that one client's connection. Running
`--test-client` a second time against the same server would fail to connect at all, since
the first invocation's `quit` already killed it. Rather than adding a new native CLI flag to
work around this (out of this plan's stated "no native C++ changes" scope), this test uses
Task 1's own `EngineClient` directly from Node to drive the *entire* sequence over one
real connection — genuinely simpler than two spawned `--test-client` processes, and it
dogfoods the exact same client `main/index.ts` uses in production, so this test doubles as
extra confidence in `EngineClient` itself.

**Files:**
- Create: `src/main/liveReschedule.test.ts`

- [ ] **Step 1: Write the test**

```ts
// src/main/liveReschedule.test.ts
import { describe, expect, it, afterEach } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EngineClient } from './engineClient'

const ENGINE_BINARY = join(
  __dirname,
  '../../native-engine/build/ssstitch_engine_artefacts/Debug/ssstitch_engine'
)
const TEST_PORT = 45323 // distinct from Phase 1's ipc-roundtrip.test.ts's 45322

let serverProcess: ChildProcess | undefined

afterEach(() => {
  serverProcess?.kill('SIGKILL')
  serverProcess = undefined
})

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

describe('live reschedule: load-project while already playing', () => {
  it('accepts a second load-project mid-playback, keeps pushing position-update, and never disconnects', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ssstitch-live-reschedule-'))
    const projectA = {
      bpm: 60,
      snapDiv: 16,
      rifffs: [
        {
          groupId: 'r1', startBar: 0, barLength: 4, fadeInBars: 0, fadeOutBars: 0,
          stems: [{
            // No real stem file needed — PlaybackEngine.setProject skips stems
            // whose buffer fails to load and keeps scheduling/position-tracking
            // working regardless (same precedent Phase 1's ipc-roundtrip.test.ts
            // established). This test only proves the IPC/reschedule sequence,
            // not audio content.
            stemKey: 'r1:1', resolvedPath: join(dir, 'missing-a.wav'), durationSec: 16,
            barLength: 4, offsetSteps: 0, startBarOverride: -1, volume: 1, muted: false
          }]
        }
      ]
    }
    const projectB = {
      ...projectA,
      rifffs: [{ ...projectA.rifffs[0], groupId: 'r2' }] // a genuinely different project, not just a tweak
    }

    serverProcess = spawn(ENGINE_BINARY, ['--serve', String(TEST_PORT)])
    await waitForLogLine(serverProcess, `serving on 127.0.0.1:${TEST_PORT}`, 5000)

    const client = new EngineClient()
    await client.connect(TEST_PORT)

    const positionsBeforeReschedule: number[] = []
    const unsubscribeBefore = client.on('position-update', (payload) => {
      positionsBeforeReschedule.push((payload as { pos: number }).pos)
    })

    client.send('load-project', projectA)
    client.send('play', { fromPos: 0 })
    await new Promise((resolve) => setTimeout(resolve, 200))
    unsubscribeBefore()
    expect(positionsBeforeReschedule.length).toBeGreaterThan(0)

    // The actual thing this test exists to prove: sending a second
    // load-project WHILE the engine is still playing (no stop/pause in
    // between) must not error, hang, or drop the connection.
    const positionsAfterReschedule: number[] = []
    const unsubscribeAfter = client.on('position-update', (payload) => {
      positionsAfterReschedule.push((payload as { pos: number }).pos)
    })
    client.send('load-project', projectB)
    await new Promise((resolve) => setTimeout(resolve, 200))
    unsubscribeAfter()

    // Position-update pushes kept arriving after the reschedule — proves the
    // connection survived and the timer/transport kept running uninterrupted.
    expect(positionsAfterReschedule.length).toBeGreaterThan(0)

    client.send('stop')
    client.send('quit')
    client.disconnect()

    await new Promise((resolve) => {
      if (serverProcess?.exitCode !== null) return resolve(undefined)
      serverProcess?.once('exit', () => resolve(undefined))
    })
    expect(serverProcess?.exitCode).toBe(0)

    rmSync(dir, { recursive: true, force: true })
  }, 15000)
})
```

- [ ] **Step 2: Run it**

```bash
npx vitest run src/main/liveReschedule.test.ts
```
Expected: PASS. If it reveals the server can't handle a live `load-project` swap safely
(crashes, hangs, disconnects — e.g. `positionsAfterReschedule` stays empty, or the
`await client.connect` / `send` calls throw), that's a genuine, serious finding for this
phase — escalate it rather than working around it, since the entire "just send
load-project again" design depends on this working. Also confirm no stray
`ssstitch_engine` process is left running after the test (`pgrep -fl ssstitch_engine`).

- [ ] **Step 3: Commit**

```bash
git add src/main/liveReschedule.test.ts
git commit -m "juce-engine phase3: live reschedule IPC integration test"
```

---

### Task 7: Native-side stretch-ratio parity test — closes Phase 1/2's twice-deferred gap

**Files:**
- Modify: `native-engine/test/parity/render-parity.test.ts`

- [ ] **Step 1: Add a stretch-ratio scenario**

Read the current `render-parity.test.ts` in full first (it has 3 cases already: volume,
fade-in, invalid-bpm). Add a fourth: a project whose rifff bpm differs from the project bpm
enough to trigger real stretch resolution (`Math.abs(ratio - 1) >= 0.001`, per
`buildEngineProject.ts`'s threshold) — but note this test drives the native engine directly
via `--render-test` with a hand-built `EngineProject` JSON, which takes `resolvedPath`
already-resolved (i.e. the test itself is responsible for producing a pre-stretched fixture
file, not `buildEngineProject`/`resolveStretched`, since those are TS-side concerns this
native-only test doesn't invoke). Concretely: use `src/main/rubberband.ts`'s
`renderStretched` directly (import it — this test already runs under Node, and
`rubberband.ts` shells out to a CLI tool; confirm the tool is actually available in this
environment before relying on it, e.g. check for its binary the way other tests check for
the compiled engine binary) to pre-stretch a tone fixture at a known ratio, point the
`EngineProject`'s `resolvedPath` at the *stretched* output file, and compare against
reference math computed the same way the existing tests do (reading the stretched file's
own samples directly, scaled by volume — the stretch itself already happened before this
comparison, so the reference doesn't need to reimplement stretching, just the same
volume/mix math the other 3 cases already use).

If `rubberband` isn't available/reliable in the test environment, don't force it — this is
exactly the kind of environment constraint Phase 2's Task 6 hit twice already (jsdom,
Electron-under-Vitest). Investigate, and if genuinely blocked, report back with what you
found rather than skipping the requirement silently; this gap has already been deferred
twice and skipping it a third time without a clear, escalated reason would repeat the same
mistake.

- [ ] **Step 2: Run it**

```bash
npx vitest run native-engine/test/parity/render-parity.test.ts
```
Expected: PASS, or a genuine finding worth escalating (same framing as every other parity
test in this project's history — a real discrepancy here is valuable, not a test bug to
paper over).

- [ ] **Step 3: Commit**

```bash
git add native-engine/test/parity/render-parity.test.ts
git commit -m "juce-engine phase3: stretch-ratio parity test (closes Phase 1/2's deferred gap)"
```

---

### Task 8: Manual verification

**Files:** none (verification only, no commit unless issues found and fixed)

- [ ] **Step 1: Start the dev app and verify live playback end-to-end**

```bash
npm run dev
```

Perform, and report on each specifically:
1. Drag a rifff onto the timeline, press play. Confirm audio actually plays (real listening
   required, or the same rigorous programmatic-verification substitute Phase 2's Task 7
   used if literal listening isn't possible in your environment — waveform/RMS analysis of
   what should be audible, timing checks against expected playhead movement, etc.).
2. While playing, adjust a stem's volume, mute a stem, and change the offset. Confirm each
   takes effect audibly and immediately, without a stop/restart glitch.
3. Let playback run long enough for the loop to wrap around. Confirm it continues
   seamlessly — no glitch, no stop, no silence gap.
4. Press pause, then play again. Confirm it resumes correctly (per Task 5's finding about
   pause/stop being equivalent at the engine level — resuming means starting fresh from
   `state.pos`, not a native pause/resume; confirm this actually produces correct,
   expected behavior from a user's perspective, not just "technically what the code does").
5. If you can safely and reversibly do so, kill the native engine process manually while
   the app is running (`pgrep -fl ssstitch_engine`, `kill <pid>` for the *playback* engine's
   process specifically, not any export-time one) and confirm: playback stops, no visible
   error appears, and — critically — a **subsequent** play press works correctly again
   (proving the crash-recovery respawn+reconnect actually works, not just that the app
   doesn't crash). This is a real test of Task 3/4's crash-recovery logic, not optional.

- [ ] **Step 2: Report findings**

If anything in Step 1 reveals a real bug, fix it (in the relevant earlier task's files,
following that task's own conventions) before proceeding to Task 9's retirement step — do
not retire the old Web Audio path while native playback has a known issue.

---

### Task 9: Retire `AudioEngine.ts`

Only after Task 6, Task 7, and Task 8 all hold up — the "once verified at parity, retire"
step for live playback, matching Phase 2's export precedent.

**Files:**
- Delete: `src/renderer/src/audio/AudioEngine.ts`
- Delete: `src/renderer/src/audio/AudioEngine.test.ts` (if it exists — check)

- [ ] **Step 1: Confirm zero remaining references**

```bash
grep -rn "AudioEngine" src/ --include="*.ts" --include="*.tsx"
```
Expected: only the definition file itself (and its test file, if one exists) — `StoreContext.tsx`
should no longer import it after Task 5.

- [ ] **Step 2: Delete**

```bash
git rm src/renderer/src/audio/AudioEngine.ts
git rm src/renderer/src/audio/AudioEngine.test.ts 2>/dev/null || true
```

- [ ] **Step 3: Typecheck, lint, full suite**

```bash
npm run typecheck && npm run lint && npm test -- --run
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "juce-engine phase3: retire AudioEngine.ts — native engine is now the only playback path"
```

---

### Task 10: Write up Phase 3 findings

**Files:**
- Create: `native-engine/PHASE3_FINDINGS.md`

- [ ] **Step 1: Document what actually happened**

Follow `PHASE1_FINDINGS.md`/`PHASE2_FINDINGS.md`'s model. Cover: confirmation that no
native C++ changes were needed (or, if this plan's assumption turned out wrong during
execution, what actually needed to change and why); the `EngineClient.on()` subscription
mechanism and its test coverage; the crash-recovery mechanism and Task 8's manual test of it
(point 5 of Step 1 — what was observed when the engine process was killed and restarted);
confirmation the live `load-project`-while-playing sequence works (Task 6's actual result —
note the design already accounts for `--test-client`'s `quit` terminating the whole server,
which is why this test drives `EngineClient` directly instead); the
stretch-ratio parity test's actual result (closing a gap named in two previous findings
docs — say so explicitly); any bugs found and fixed, with the same technical specificity
prior findings docs used; and confirmation `AudioEngine.ts` is genuinely gone with zero
remaining references. Note explicitly what's still out of scope going forward (plugin
hosting, binary packaging/distribution — both already named as gaps in Phase 2's findings
and still unaddressed).

- [ ] **Step 2: Commit**

```bash
git add native-engine/PHASE3_FINDINGS.md
git commit -m "juce-engine phase3: findings write-up"
```
