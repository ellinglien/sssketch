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
  /** Overrides READINESS_TIMEOUT_MS for this one spawn. Same injection
   * convention as binaryPathOverride: it exists so a test can drive the
   * timeout path against the real binary (pass something unreachably
   * small) instead of mocking the clock. Production callers leave it
   * unset. */
  readinessTimeoutMs?: number
}

/**
 * How long spawnEngine() will wait for the engine to report readiness
 * before giving up. This bounds ONE failure shape only -- an engine that
 * starts but then hangs before it opens its socket. Every other way the
 * engine can be broken already fails in milliseconds and never reaches
 * this timer: a missing binary is rejected by the existsSync check below,
 * and a binary that won't exec, or crashes during init, rejects from the
 * 'error'/'exit' handlers. So this number is NOT how long a broken install
 * takes to report itself.
 *
 * History, so the next person doesn't re-guess it:
 *   5000  -> too tight, caught in CI across several engine-spawning tests.
 *   10000 -> too tight, caught in CI again on the v1.2.0 x64 release leg
 *            (run 36196299329, nativeExport.test.ts). That leg
 *            cross-compiles an x86_64 engine and runs it translated on an
 *            arm64 runner, so the very FIRST exec of the freshly built
 *            binary pays a one-time Rosetta AOT translation plus a
 *            Gatekeeper/AMFI first-run evaluation of the whole bundle.
 *            Measured from that run's own log: the first spawn on the
 *            machine hit this timer and was SIGKILLed at 10.0s, while
 *            every one of the ~150 spawns after it in the same run
 *            reported readiness in well under 1s (the arm64 leg's first
 *            spawn: ~2s). Because the slow one was killed, 10.0s is only a
 *            LOWER bound on what a cold start actually costs -- we never
 *            got to see the real number.
 *
 * This is not only a CI concern, which is the main reason the new ceiling
 * is deliberately generous rather than "a bit more than 10s": the same
 * first-exec cost is paid by a real user the first time they launch a
 * freshly downloaded, notarized build, when Gatekeeper verifies the nested
 * engine bundle for the first time. A ceiling tuned to a warm spawn turns
 * that into a scary "Playback engine failed to start" dialog on first
 * launch that mysteriously never reproduces on the second.
 *
 * 45000ms. What that costs in the only case it governs: the app's own
 * startup path does not block on this (see index.ts -- the window is up,
 * the "starting engine..." pill is showing, and export/everything else
 * works throughout), so the user is never staring at nothing; they just
 * learn that live playback is unavailable a bit later.
 *
 * Deliberately DEcoupled from the outer per-test vitest timeouts, which is
 * a change from how the 10000ms version was documented. Those (30000+ in
 * every file that spawns a real engine) bound the TEST; this bounds the
 * APP, and the app's tolerance should not be dictated by how long we are
 * willing to let a test hang. If a spawn ever does run past a test's own
 * budget, the progress lines below say so in the log, so the failure is
 * still legible without this message winning the race.
 */
export const READINESS_TIMEOUT_MS = 45_000

/** How often to log that a spawn is still in progress. The wait is
 * otherwise completely silent, which is exactly why the 10000ms ceiling
 * above had to be reconstructed from CI log timestamps rather than simply
 * read off. 5000ms is above every healthy spawn ever measured, so a normal
 * start logs nothing at all. */
const READINESS_PROGRESS_INTERVAL_MS = 5_000

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

    // See READINESS_TIMEOUT_MS's own doc comment for why this number is
    // what it is, and for the two CI failures that moved it.
    const timeoutMs = options.readinessTimeoutMs ?? READINESS_TIMEOUT_MS
    const startedAt = Date.now()

    // Says out loud that a spawn is taking an unusual amount of time,
    // while it is still taking it. Before this the wait was completely
    // silent right up until it either succeeded or threw, so the only way
    // to find out how long a slow-but-healthy start actually took was to
    // subtract CI log timestamps by hand -- which is exactly how the
    // 10000ms ceiling had to be diagnosed. A healthy spawn never reaches
    // the first interval, so this logs nothing on a normal run.
    const progress = setInterval(() => {
      if (settled) return
      const elapsedSec = Math.round((Date.now() - startedAt) / 1000)
      console.warn(
        `engineProcess: native engine still starting after ${elapsedSec}s (giving up at ${Math.round(timeoutMs / 1000)}s) -- ${binaryPath}`
      )
    }, READINESS_PROGRESS_INTERVAL_MS)

    const timer = setTimeout(() => {
      if (settled) return
      cleanup()
      proc.kill('SIGKILL')
      reject(
        new Error(
          `timed out waiting for the native engine to report readiness (${Math.round(timeoutMs / 1000)}s, binary ${binaryPath})`
        )
      )
    }, timeoutMs)

    /** Every settle path has to clear BOTH timers, so they all go through
     * here rather than clearing them one at a time at four call sites --
     * the progress interval is easy to forget, and a forgotten one keeps
     * logging (and, in the main process, keeps the handle alive) long
     * after the spawn it was reporting on has finished. Declared after
     * `timer` deliberately: it's a hoisted function declaration, and
     * nothing calls it until well after both timers exist. */
    function cleanup(): void {
      settled = true
      clearTimeout(timer)
      clearInterval(progress)
    }

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
        cleanup()
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
      cleanup()
      reject(err)
    })

    proc.once('exit', (code) => {
      if (settled) return
      cleanup()
      reject(new Error(`native engine exited early (code ${code}) before reporting readiness`))
    })
  })
}
