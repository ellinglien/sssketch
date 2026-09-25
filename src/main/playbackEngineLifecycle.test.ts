import { describe, expect, it, vi, afterEach } from 'vitest'

vi.mock('electron', () => ({ app: { getAppPath: () => process.cwd() } }))

const { startPlaybackEngine } = await import('./playbackEngineLifecycle')

/**
 * Polls `condition` at a short interval until it returns true, or rejects
 * after `timeoutMs`. Used instead of a fixed sleep-then-assert wherever this
 * file waits for position-update pushes from a real spawned engine process:
 * a fixed delay either wastes time when the machine is idle, or risks the
 * assertion running before a push has actually arrived when a full parallel
 * suite puts the CPU under contention.
 */
function waitFor(condition: () => boolean, timeoutMs = 10000, intervalMs = 10): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const check = (): void => {
      if (condition()) {
        resolve()
        return
      }
      if (Date.now() - start >= timeoutMs) {
        reject(new Error(`waitFor: condition not met within ${timeoutMs}ms`))
        return
      }
      setTimeout(check, intervalMs)
    }
    check()
  })
}

describe('startPlaybackEngine', () => {
  let handle: Awaited<ReturnType<typeof startPlaybackEngine>> | undefined

  afterEach(async () => {
    // shutdown() is async (it may need to wait out an in-flight
    // crash-recovery respawn before it can safely kill the current engine
    // process) — must be awaited so a leftover subprocess from one test
    // doesn't linger into the next.
    await handle?.shutdown()
    handle = undefined
  })

  // EVERY test in this describe spawns a real engine, so every one of them
  // carries an explicit 30s timeout rather than vitest's default 5000ms --
  // including the ones that look cheap. A cold spawn (the first time this
  // freshly-built binary has been launched on this machine) is measurably
  // slower than every later spawn in this same file (700ms-1.7s once warm)
  // and was measured at 10s+ on the release workflow's x64 leg, where the
  // binary is cross-compiled and runs translated. Caught for real on
  // GitHub Actions more than once, not hypothetical.
  //
  // This is the TEST's budget; spawnEngine's own readiness ceiling
  // (READINESS_TIMEOUT_MS in engineProcess.ts, 45000ms) is a separate,
  // deliberately decoupled mechanism -- see that constant's doc comment.
  // Which of the two reports a pathologically slow spawn doesn't matter
  // much any more, because engineProcess.ts now logs a progress line every
  // 5s while it waits.
  it('spawns the engine and the returned client can send load-project without throwing', async () => {
    handle = await startPlaybackEngine()
    // A minimal, valid empty project — proves the connection is live and the
    // engine accepts messages, without needing real stem files.
    handle.client.send('load-project', { bpm: 120, snapDiv: 16, rifffs: [] })
    // No response is expected for load-project (fire-and-forget, matching how
    // the native side already handles it) — just confirm send() doesn't throw
    // (i.e. the socket is genuinely connected).
    expect(handle.client).toBeDefined()
  }, 30000)

  it('remembers the last project sent via sendLoadProject, for crash-recovery resend', async () => {
    handle = await startPlaybackEngine()
    const project = { bpm: 100, snapDiv: 8, rifffs: [] }
    handle.sendLoadProject(project)
    expect(handle.getLastProject()).toEqual(project)
  }, 30000)

  it('detects a crashed engine process, respawns, reconnects, resends the last project, and notifies onRestarted', async () => {
    handle = await startPlaybackEngine()
    const project = { bpm: 90, snapDiv: 4, rifffs: [] }
    handle.sendLoadProject(project)

    const restarted = new Promise<void>((resolve) => {
      handle!.onRestarted(() => resolve())
    })

    // Simulate a real crash — kill the actual engine process out from
    // under the module, the same way an OS-level segfault or OOM kill
    // would, rather than mocking anything internal.
    handle.getEngineProcess().kill('SIGKILL')

    await restarted

    // handle.client is a getter — by the time onRestarted fires, it must
    // already point at the new, live EngineClient reconnected to the
    // respawned process, not the old dead one. Proving send() doesn't
    // throw here confirms respawn + reconnect actually completed, not
    // just that the crash was detected.
    expect(() => handle!.client.send('load-project', project)).not.toThrow()
  }, 30000)

  it('a one-time client.on() subscription (bound to a single snapshot instance) stops receiving pushes after a crash+respawn — callers must re-subscribe inside onRestarted', async () => {
    // This documents the sharp edge in the `client` getter's contract that
    // caused a real bug in main/index.ts's position-update relay (found and
    // fixed during Phase 3 Task 8 manual verification): the getter re-reads
    // the live EngineClient on every *property access*, but EngineClient.on()
    // subscribes onto whichever specific object instance it was called on —
    // so `handle.client.on(...)` called exactly once still binds forever to
    // that one snapshot, even though `handle.client.send(...)` called fresh
    // on every invocation (as the IPC handlers in main/index.ts already do)
    // correctly follows respawns. The old instance is disconnected and never
    // receives another push; the new instance starts with no listeners.
    handle = await startPlaybackEngine()
    handle.sendLoadProject({ bpm: 90, snapDiv: 4, rifffs: [] })

    const seenBeforeCrash: unknown[] = []
    handle.client.on('position-update', (payload) => seenBeforeCrash.push(payload))
    handle.client.send('play', { fromPos: 0 })
    // Poll for at least one position-update rather than sleeping a fixed
    // duration — under CPU contention from other tests in the same parallel
    // run spawning/killing their own real engine processes, a fixed sleep
    // can elapse before the engine has actually gotten around to pushing.
    await waitFor(() => seenBeforeCrash.length > 0)
    handle.client.send('stop')
    expect(seenBeforeCrash.length).toBeGreaterThan(0)

    const restarted = new Promise<void>((resolve) => handle!.onRestarted(() => resolve()))
    handle.getEngineProcess().kill('SIGKILL')
    await restarted
    const seenBeforeCrashCount = seenBeforeCrash.length

    const seenAfterCrash: unknown[] = []
    handle.client.on('position-update', (payload) => seenAfterCrash.push(payload))
    handle.client.send('play', { fromPos: 0 })
    await waitFor(() => seenAfterCrash.length > 0)
    handle.client.send('stop')

    // Pins the actual bug this test is named for: the stale subscription
    // never fires again post-respawn (its underlying EngineClient instance
    // is disconnected), while a fresh subscription created after onRestarted
    // — exactly like main/index.ts's fixed subscribeToPositionUpdates()
    // called from inside onRestarted — receives pushes fine on the new one.
    expect(seenBeforeCrash.length).toBe(seenBeforeCrashCount)
    expect(seenAfterCrash.length).toBeGreaterThan(0)
  }, 30000)
})
