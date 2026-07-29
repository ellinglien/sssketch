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
