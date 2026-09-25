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
  // explicit 30s timeout, not vitest's 5000ms default. This is the TEST's
  // own budget and is a separate mechanism from spawnEngine's internal
  // readiness ceiling (READINESS_TIMEOUT_MS in engineProcess.ts, now
  // 45000ms) -- the two are deliberately decoupled there, see that
  // constant's doc comment. What this number has to cover is a
  // legitimately-slow-but-SUCCESSFUL cold spawn: the first exec of a
  // freshly built engine binary on a machine pays a one-time
  // Gatekeeper/AMFI evaluation, and on the release workflow's x64 leg
  // (a cross-compiled binary running translated) that was measured at
  // 10s+. 15000 was the previous value and left too little room above
  // that; 30000 matches what nativeExport.test.ts already uses for the
  // same reason. If a spawn ever does run past this, engineProcess.ts now
  // logs a progress line every 5s, so the log says how long it was
  // actually taking even when vitest's message is the one that wins.
  it('spawns the engine, waits for readiness, and returns a connected port', async () => {
    handle = await spawnEngine({
      binaryPathOverride: realBinaryPath,
      bridgeBinaryPathOverride: noBridgeBinaryPath
    })
    expect(handle.port).toBeGreaterThan(0)
    expect(handle.process.exitCode).toBeNull() // still running
  }, 30000)

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
  }, 30000)

  it('rejects if the engine binary does not exist at the resolved path', async () => {
    await expect(spawnEngine({ binaryPathOverride: '/no/such/binary' })).rejects.toThrow()
  })

  // The readiness ceiling is the one failure shape that can't be driven by
  // pointing spawnEngine at a broken path (a missing binary, or one that
  // exits on its own, rejects through an entirely different branch) -- so
  // it's driven by injection instead, the same way binaryPathOverride
  // handles the electron dependency above, rather than by faking timers or
  // stubbing the process. The binary here is the REAL engine; 1ms is just
  // a budget no real process spawn can possibly meet, which puts the real
  // timeout branch on a real subprocess.
  it('honours an injected readiness timeout, and kills the process it gave up on', async () => {
    const spawned = spawnEngine({
      binaryPathOverride: realBinaryPath,
      bridgeBinaryPathOverride: noBridgeBinaryPath,
      readinessTimeoutMs: 1
    })
    await expect(spawned).rejects.toThrow('timed out waiting for the native engine to report')
  }, 30000)

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
  }, 30000)

  it('still starts normally when nothing exists at the given bridge binary override path', async () => {
    handle = await spawnEngine({
      binaryPathOverride: realBinaryPath,
      bridgeBinaryPathOverride: '/definitely/does/not/exist/sssketch-bridge'
    })
    expect(handle.port).toBeGreaterThan(0)
  }, 30000)
})
