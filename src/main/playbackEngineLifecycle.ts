import type { ChildProcess } from 'node:child_process'
import { spawnEngine, type EngineHandle } from './engineProcess'
import { EngineClient } from './engineClient'

/** Thrown internally by connect() to unwind an in-flight respawn when
 * shutdown() has been called mid-spawn/mid-connect. Never surfaces to
 * callers — the respawn's own .catch() swallows it silently (it's not a
 * real failure, just a deliberate abort), and shutdown() waits for that
 * unwind to finish before declaring itself done. */
class ShutdownAbort extends Error {}

export interface PlaybackEngineHandle {
  client: EngineClient
  sendLoadProject: (project: unknown) => void
  /** Radio's scheduled swap: hands the engine a project NOW and asks it to
   * make it real at the next loop top -- or, with `atBars`, at that bar
   * of the current lap (IpcServer.cpp's stage-project handler). Deliberately a sibling of sendLoadProject rather than a flag
   * on it -- the two differ in when they take effect, and every other
   * caller in the app wants "now".
   *
   * Does NOT set lastProject. A staged project may still be cancelled or
   * superseded before it ever plays, and lastProject is what a crash
   * respawn re-sends -- restoring a project that never went live would
   * make a crash change what is playing. promoteStagedProject below is
   * what moves it across, once the engine says it landed. */
  sendStageProject: (token: number, project: unknown, atBars?: number) => void
  /** Withdraws a staged project, by token (or -1 for whatever is staged).
   * Radio re-checks a pick's eligibility late and can drop it; a stale
   * staged swap must never fire. */
  sendCancelStagedProject: (token: number) => void
  /** Called on the engine's `project-applied` ack: the staged project this
   * token named is now the live one, so it becomes what a crash respawn
   * would restore. Unknown tokens are ignored. */
  promoteStagedProject: (token: number) => void
  getLastProject: () => unknown
  /** Called when main.process itself is shutting down (app quit) — tears
   * down the connection and kills the engine process, no crash-recovery
   * respawn attempted (that's only for *unexpected* disconnects). Returns a
   * promise that resolves once any in-flight crash-recovery respawn has
   * been unwound and the (possibly just-replaced) engine process is
   * confirmed stopped — callers should await it before assuming no engine
   * subprocess is left running. */
  shutdown: () => Promise<void>
  /** Subscribes to the crash-recovery signal — fires once per detected
   * crash+respawn+reconnect cycle, after the engine is reconnected and the
   * last-known project has been re-sent. A later task uses this to relay a
   * lightweight event to the renderer. */
  onRestarted: (callback: () => void) => () => void
  /** Test-only seam: exposes the underlying engine ChildProcess so tests
   * can simulate a crash (`getEngineProcess().kill('SIGKILL')`) without an
   * internal mock. Not intended for use by main/index.ts's IPC handlers —
   * use `client` (or the future sendPlay/sendPause-style helpers) instead,
   * since the process reference goes stale across a respawn just like a
   * cached `client` reference would. */
  getEngineProcess: () => ChildProcess
}

/**
 * Spawns and owns the single, session-long native engine process used for
 * live playback — entirely separate from Phase 2's per-export spawned
 * engine (they must not share a PlaybackEngine/currentProject, since an
 * export's load-project would clobber whatever's currently playing).
 * Detects unexpected disconnects (the engine process crashing, not a
 * deliberate shutdown() call) and silently respawns + reconnects +
 * re-sends the last-known project.
 *
 * `client` is exposed as a getter (see the returned object below) rather
 * than a plain field: after a crash-triggered respawn(), the underlying
 * EngineClient instance is replaced wholesale (a fresh socket connected to
 * a fresh process), and callers that stash `handle.client` once — e.g.
 * inside an `ipcMain.handle` closure created right after
 * startPlaybackEngine() resolves, but invoked much later — must still
 * observe the *current* client on every access, not whichever one was live
 * at the time they read the property. A getter re-reads the live reference
 * on every property access, which is exactly what's needed here; a plain
 * field captured once would silently keep sending to a dead, disconnected
 * EngineClient after a respawn. Callers must still read `handle.client`
 * fresh each time they need it (not destructure it once into a local
 * variable) for this to hold.
 */
export async function startPlaybackEngine(): Promise<PlaybackEngineHandle> {
  let engineHandle: EngineHandle
  let client: EngineClient
  let lastProject: unknown = null
  // Staged projects the engine has been handed but has not yet said it
  // applied, by token. Normally holds at most one -- the engine supersedes
  // an older stage with a newer one -- but it is a Map rather than a
  // single slot because the ACKS are what empty it, and an ack for a
  // superseded token can arrive after the next one has already been sent.
  // Bounded by the same acks: every token gets exactly one
  // project-stage-result, and every token that goes live gets exactly one
  // project-applied (see IpcServer.h's own contract note).
  const stagedProjects = new Map<number, unknown>()
  let shuttingDown = false
  // Tracks a respawn triggered by an unexpected 'exit' so shutdown() can
  // wait for it to fully unwind (rather than kill()ing a stale/old
  // engineHandle while a new process is still being spawned behind its
  // back — see the crash-during-shutdown bug this closure structure fixes).
  let respawnInFlight: Promise<void> | null = null
  const restartListeners = new Set<() => void>()

  function attachExitListener(handle: EngineHandle): void {
    // Attached immediately after spawnEngine() resolves — before the
    // (slower) client.connect() await below — so a crash in that narrow
    // window is still detected instead of silently going unnoticed.
    handle.process.once('exit', () => {
      if (shuttingDown) return
      console.error('playbackEngineLifecycle: engine process exited unexpectedly, respawning')
      respawnInFlight = respawn()
        .catch((err: unknown) => {
          if (err instanceof ShutdownAbort) return
          // Deliberately not rethrown/left as an unhandled rejection: this
          // fires from inside a 'once' process-exit callback with nothing
          // downstream awaiting it, so an uncaught rejection here would
          // otherwise crash the whole Electron main process — precisely
          // when the engine is already struggling.
          console.error('playbackEngineLifecycle: respawn failed', err)
        })
        .finally(() => {
          respawnInFlight = null
        })
    })
  }

  async function connect(): Promise<void> {
    const newEngineHandle = await spawnEngine()
    attachExitListener(newEngineHandle)

    if (shuttingDown) {
      // shutdown() ran while this spawn was in flight — don't leave the
      // freshly spawned process orphaned and un-owned.
      newEngineHandle.stop()
      throw new ShutdownAbort()
    }

    const newClient = new EngineClient()
    await newClient.connect(newEngineHandle.port)

    if (shuttingDown) {
      newClient.disconnect()
      newEngineHandle.stop()
      throw new ShutdownAbort()
    }

    engineHandle = newEngineHandle
    client = newClient
  }

  async function respawn(): Promise<void> {
    client.disconnect()
    await connect()
    // Nothing the OLD engine was holding survives it. A staged project
    // that never got its ack is not going to get one now, and the fresh
    // process below is handed the last project that actually played.
    stagedProjects.clear()
    if (lastProject !== null) {
      client.send('load-project', lastProject)
    }
    for (const cb of restartListeners) cb()
  }

  await connect()

  return {
    get client(): EngineClient {
      return client
    },
    sendLoadProject(project: unknown) {
      lastProject = project
      // A load-project makes the engine drop whatever is staged
      // (resolveStagedBefore("load-project")), so nothing here can still
      // be waiting to become the live project.
      stagedProjects.clear()
      client.send('load-project', project)
    },
    sendStageProject(token: number, project: unknown, atBars?: number) {
      stagedProjects.set(token, project)
      // `atBars` is omitted, not sent as a null or a -1, when the swap is
      // for the loop top: the engine reads an absent field as "the wrap",
      // which is every staged swap there was before radio's mid-lap cuts
      // could be staged at all. One shape on the wire, one default.
      client.send(
        'stage-project',
        atBars === undefined ? { token, project } : { token, project, atBars }
      )
    },
    sendCancelStagedProject(token: number) {
      client.send('cancel-staged-project', { token })
    },
    promoteStagedProject(token: number) {
      if (!stagedProjects.has(token)) return
      lastProject = stagedProjects.get(token)
      stagedProjects.clear()
    },
    getLastProject: () => lastProject,
    async shutdown() {
      shuttingDown = true
      // If a crash-triggered respawn is mid-flight, wait for it to unwind
      // (connect()'s shuttingDown checks above make it abort and clean up
      // after itself) before touching engineHandle/client below — otherwise
      // we'd race it: killing today's (possibly already-dead, possibly
      // stale) engineHandle while respawn() is still spawning a *new* one
      // that nothing would ever then stop.
      if (respawnInFlight) {
        await respawnInFlight
      }
      client.disconnect()
      engineHandle.stop()
    },
    onRestarted(callback: () => void) {
      restartListeners.add(callback)
      return () => restartListeners.delete(callback)
    },
    getEngineProcess: () => engineHandle.process
  }
}
