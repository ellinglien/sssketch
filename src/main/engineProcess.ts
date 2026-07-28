import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

export interface EngineHandle {
  process: ChildProcess
  port: number
  stop: () => void
}

interface SpawnEngineOptions {
  binaryPathOverride?: string
  portOverride?: number
}

function defaultBinaryPath(): string {
  // Dev-mode only — see this plan's scope note on packaging. app.getAppPath()
  // is the Electron app's root directory; native-engine/ lives alongside src/
  // at the repo root in dev mode.
  return join(
    app.getAppPath(),
    'native-engine/build/ssstitch_engine_artefacts/Debug/ssstitch_engine'
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

  return new Promise((resolve, reject) => {
    const proc = spawn(binaryPath, ['--serve', String(port)])
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      proc.kill('SIGKILL')
      reject(new Error('timed out waiting for the native engine to report readiness'))
    }, 5000)

    proc.stderr?.on('data', (chunk: Buffer) => {
      if (settled) return
      if (chunk.toString().includes(`serving on 127.0.0.1:${port}`)) {
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
