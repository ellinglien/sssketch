import { describe, expect, it, afterEach } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { spawnEngine, type EngineHandle } from './engineProcess'

// spawnEngine()'s default binary-path resolution (defaultBinaryPath() in
// engineProcess.ts) calls Electron's `app.getAppPath()`, which only behaves
// correctly inside a real, running Electron process — not under plain
// Vitest. Rather than mock the `electron` module (no precedent for that in
// this codebase: rubberband.ts also imports `app` from 'electron', and its
// test file, rubberband.test.ts, only exercises the pure `cacheKey` helper
// and never touches the electron-dependent code path), these tests instead
// compute the real compiled binary's path directly from this test file's own
// location and pass it in via `binaryPathOverride` — the same override
// mechanism spawnEngine() already exposes for exactly this kind of
// substitution. This exercises the real spawn/readiness/stop logic in
// engineProcess.ts without needing a working Electron runtime, and without
// asserting anything about defaultBinaryPath()'s internals (which would
// require either a running Electron app or a mocked one).
const realBinaryPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../native-engine/build/ssstitch_engine_artefacts/Debug/ssstitch_engine'
)

let handle: EngineHandle | undefined

afterEach(() => {
  handle?.stop()
  handle = undefined
})

describe('spawnEngine', () => {
  it('spawns the engine, waits for readiness, and returns a connected port', async () => {
    handle = await spawnEngine({ binaryPathOverride: realBinaryPath })
    expect(handle.port).toBeGreaterThan(0)
    expect(handle.process.exitCode).toBeNull() // still running
  })

  it('stop() terminates the process', async () => {
    handle = await spawnEngine({ binaryPathOverride: realBinaryPath })
    const proc = handle.process
    handle.stop()
    await new Promise<void>((resolve) => {
      if (proc.exitCode !== null || proc.signalCode !== null) return resolve()
      proc.once('exit', () => resolve())
    })
    // stop() kills via SIGKILL (see engineProcess.ts), and Node only populates
    // `exitCode` for a normal exit — a signal-terminated process instead has
    // `exitCode === null` and `signalCode` set to the signal name (confirmed
    // empirically against the real binary here; this is also documented
    // node:child_process behavior). Checking exitCode alone, as naively
    // written, would misreport a successfully-killed process as still
    // running. Either field being non-null means the process has exited.
    expect(proc.exitCode !== null || proc.signalCode !== null).toBe(true)
    expect(proc.signalCode).toBe('SIGKILL')
    handle = undefined // already stopped, don't double-stop in afterEach
  })

  it('rejects if the engine binary does not exist at the resolved path', async () => {
    await expect(spawnEngine({ binaryPathOverride: '/no/such/binary' })).rejects.toThrow()
  })
})
