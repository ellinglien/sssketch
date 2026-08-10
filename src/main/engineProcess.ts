import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

export interface EngineHandle {
  process: ChildProcess
  port: number
  stop: () => void
}

export interface SpawnEngineOptions {
  binaryPathOverride?: string
  portOverride?: number
  bridgeBinaryPathOverride?: string
}

/** Mirrors defaultBinaryPath()'s own dev-vs-packaged branch exactly, for
 * the x86_64 bridge helper (see native-engine-bridge/ and
 * docs/superpowers/specs/2026-08-01-x86-plugin-bridge-design.md). */
function defaultBridgeBinaryPath(): string {
  if (app.isPackaged) {
    return join(
      process.resourcesPath,
      'native-engine-bridge/sssketch-bridge.app/Contents/MacOS/sssketch-bridge'
    )
  }
  return join(
    app.getAppPath(),
    'native-engine-bridge/build/sssketch_bridge_artefacts/sssketch-bridge.app/Contents/MacOS/sssketch-bridge'
  )
}

function defaultBinaryPath(): string {
  // Packaged mode: the engine bundle ships as an extraResources copy (see
  // electron-builder.yml) under the app's own Resources directory, at a path
  // matching what that config copies it to.
  if (app.isPackaged) {
    return join(
      process.resourcesPath,
      'native-engine/sssketch-engine.app/Contents/MacOS/sssketch-engine'
    )
  }

  // Dev-mode only — see this plan's scope note on packaging. app.getAppPath()
  // is the Electron app's root directory; native-engine/ lives alongside src/
  // at the repo root in dev mode.
  //
  // Path changed when native-engine's CMake target switched from
  // juce_add_console_app to juce_add_gui_app (needed for real plugin editor
  // windows, see PluginChain::openEditorWindow) — a GUI app target builds a
  // real .app bundle on macOS instead of a bare Mach-O binary, and (for this
  // JUCE version/generator combo, at least) drops the per-config "Debug/"
  // subdirectory the console-app target used to have. spawn() still just
  // execs the inner Mach-O binary directly; nothing about how the process is
  // launched or communicated with over IPC changes.
  return join(
    app.getAppPath(),
    'native-engine/build/sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine'
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

  // The bridge binary is a genuinely optional, separate build target --
  // only pass --bridge-binary when it actually exists, so bridging stays
  // optional/degradable in a dev environment where native-engine-bridge/
  // hasn't been built yet. The engine's own CLI parsing treats a missing
  // flag identically to bridging simply being unavailable this session.
  const bridgeBinaryPath = options.bridgeBinaryPathOverride ?? defaultBridgeBinaryPath()
  const engineArgs = ['--serve', String(port)]
  if (existsSync(bridgeBinaryPath)) {
    engineArgs.push('--bridge-binary', bridgeBinaryPath)
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(binaryPath, engineArgs)
    let settled = false
    // The readiness line isn't guaranteed to arrive in a single 'data' event —
    // OS pipe buffering can split one logical stderr write across multiple
    // chunks, or interleave other output before it. Checking only the latest
    // chunk in isolation would miss a split readiness line and spuriously
    // time out even though the engine started fine. Accumulate everything
    // seen so far and test the running buffer instead.
    let stderrBuffer = ''

    // 10000ms, not the original 5000ms -- a cold spawn of a freshly-built
    // binary (first launch ever, or first launch since a rebuild -- macOS
    // Gatekeeper/AMFI evaluates it before it can run) is measurably slower
    // than a warm one, and on a loaded/shared CI runner the old 5000ms had
    // ~zero margin: caught for real in CI, where this rejection fired
    // repeatedly across otherwise-unrelated tests (bakeOffset.test.ts,
    // playbackEngineLifecycle.test.ts) that each spawn the real engine.
    // Every test file that spawns the real engine already carries its own
    // generous outer vitest timeout (15000-20000ms) specifically to leave
    // margin above this constant -- keep this comfortably under the
    // smallest of those (see engineProcess.test.ts, playbackEngineLifecycle
    // .test.ts) if it's ever raised again.
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      proc.kill('SIGKILL')
      reject(new Error('timed out waiting for the native engine to report readiness'))
    }, 10000)

    proc.stderr?.on('data', (chunk: Buffer) => {
      // TEMP DIAGNOSTIC -- forward everything the engine logs to stderr,
      // not just up to the readiness line. Before this, any error the
      // engine logs AFTER reporting readiness (e.g. a failed audio device
      // open on the first play command) was silently discarded -- this
      // handler returned early once `settled` and never looked at the
      // chunk again. Investigating a real "no audio, no errors visible"
      // report; this is what's needed to actually see what the engine
      // says once real playback is attempted.
      console.log('[engine-stderr]', chunk.toString())
      if (settled) return
      stderrBuffer += chunk.toString()
      if (stderrBuffer.includes(`serving on 127.0.0.1:${port}`)) {
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

    // TEMP DIAGNOSTIC -- stdout wasn't captured at all before; forwarding it
    // too in case the engine logs anything relevant there instead of stderr.
    proc.stdout?.on('data', (chunk: Buffer) => {
      console.log('[engine-stdout]', chunk.toString())
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
