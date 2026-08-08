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
  '../../native-engine/build/sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine'
)

let handle: EngineHandle | undefined

afterEach(() => {
  handle?.stop()
  handle = undefined
})

// Same reasoning as realBinaryPath above, now for defaultBridgeBinaryPath()
// (also electron-dependent, added alongside the x86_64 bridge feature) --
// every spawnEngine() call in this file must override this too, or it hits
// the same "app is undefined outside real Electron" crash defaultBinaryPath()
// itself would. Deliberately a path that doesn't exist, so these
// bridge-unrelated tests spawn the engine with no --bridge-binary flag at
// all -- the simplest, most orthogonal choice for tests that aren't
// actually about bridging.
const noBridgeBinaryPath = '/no/such/bridge/binary'

describe('spawnEngine', () => {
  // Every test in this file that spawns the real engine binary gets an
  // explicit 15s timeout, not vitest's 5000ms default -- that default
  // exactly matches spawnEngine's own internal readiness timeout
  // (engineProcess.ts), so any real spawn slowness under CI contention
  // (other engine-spawning tests in this same parallel run) has zero
  // margin before the test itself fails first. Caught for real via a
  // release run: "stop() terminates the process" timed out here despite
  // nothing being wrong, same class of flake as liveReschedule.test.ts/
  // ipc-roundtrip.test.ts already fixed this same way.
  it('spawns the engine, waits for readiness, and returns a connected port', async () => {
    handle = await spawnEngine({
      binaryPathOverride: realBinaryPath,
      bridgeBinaryPathOverride: noBridgeBinaryPath
    })
    expect(handle.port).toBeGreaterThan(0)
    expect(handle.process.exitCode).toBeNull() // still running
  }, 15000)

  it('stop() terminates the process', async () => {
    handle = await spawnEngine({
      binaryPathOverride: realBinaryPath,
      bridgeBinaryPathOverride: noBridgeBinaryPath
    })
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
  }, 15000)

  it('rejects if the engine binary does not exist at the resolved path', async () => {
    await expect(spawnEngine({ binaryPathOverride: '/no/such/binary' })).rejects.toThrow()
  })

  // The bridge binary is a genuinely optional, separate build target (see
  // native-engine-bridge/ and docs/superpowers/specs/2026-08-01-x86-plugin-bridge-design.md)
  // -- these two tests don't assert on the engine's spawned argv directly
  // (no process-inspection dependency in this codebase for that), just that
  // the engine still starts up and reports readiness normally either way,
  // proving the flag-construction logic itself doesn't throw or otherwise
  // break the spawn.
  it('still starts normally when a bridge binary exists at the given override path', async () => {
    handle = await spawnEngine({
      binaryPathOverride: realBinaryPath,
      bridgeBinaryPathOverride: realBinaryPath // reusing the real engine binary as a stand-in "exists" path
    })
    expect(handle.port).toBeGreaterThan(0)
  }, 15000)

  it('still starts normally when nothing exists at the given bridge binary override path', async () => {
    handle = await spawnEngine({
      binaryPathOverride: realBinaryPath,
      bridgeBinaryPathOverride: '/definitely/does/not/exist/sssketch-bridge'
    })
    expect(handle.port).toBeGreaterThan(0)
  }, 15000)
})
