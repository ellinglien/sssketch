import { describe, expect, it, vi, afterEach } from 'vitest'

vi.mock('electron', () => ({ app: { getAppPath: () => process.cwd() } }))

const { startPlaybackEngine } = await import('./playbackEngineLifecycle')

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
  }, 20000)
})
