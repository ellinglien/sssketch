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
   * last-known project has been re-sent. A later task uses this to relay a
   * lightweight event to the renderer. */
  onRestarted: (callback: () => void) => () => void
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
 * `client` is exposed as a getter (see the class below) rather than a plain
 * field: after a crash-triggered respawn(), the underlying EngineClient
 * instance is replaced wholesale (a fresh socket connected to a fresh
 * process), and callers that stash `handle.client` once — e.g. inside an
 * `ipcMain.handle` closure created right after startPlaybackEngine()
 * resolves, but invoked much later — must still observe the *current*
 * client on every access, not whichever one was live at the time they read
 * the property. A getter re-reads the live reference on every property
 * access, which is exactly what's needed here; a plain field captured once
 * would silently keep sending to a dead, disconnected EngineClient after a
 * respawn. Callers must still read `handle.client` fresh each time they
 * need it (not destructure it once into a local variable) for this to hold.
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
    get client(): EngineClient {
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
