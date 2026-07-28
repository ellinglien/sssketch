import { describe, expect, it, afterEach } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ENGINE_BINARY = join(__dirname, '../../build/ssstitch_engine_artefacts/Debug/ssstitch_engine')
const TEST_PORT = 45322 // fixed dev port, matches the design doc's single-connection assumption

let serverProcess: ChildProcess | undefined

afterEach(() => {
  serverProcess?.kill('SIGKILL')
  serverProcess = undefined
})

// NOTE: JUCE's juce::Logger::writeToLog writes to stderr on macOS (confirmed
// during Task 8's review, via juce_SystemStats_mac.mm), not stdout — every
// "ssstitch-engine serving on...", "test-client: connected", "received ..."
// line this test needs to observe comes through stderr. Both helpers below
// listen on stderr accordingly.
function waitForLogLine(proc: ChildProcess, substring: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timed out waiting for "${substring}"`)),
      timeoutMs
    )
    proc.stderr?.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes(substring)) {
        clearTimeout(timer)
        resolve()
      }
    })
  })
}

function collectOutput(proc: ChildProcess): { text: () => string } {
  let buf = ''
  proc.stderr?.on('data', (chunk: Buffer) => {
    buf += chunk.toString()
  })
  return { text: () => buf }
}

describe('IPC round-trip: --serve <-> --test-client', () => {
  it('receives position-update pushes after play, advancing over time', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ssstitch-ipc-'))
    const projectPath = join(dir, 'project.json')
    // No real audio file needed — the project references a stem path that
    // doesn't exist. PlaybackEngine.setProject skips stems whose buffer fails
    // to load (Task 4/5 behavior) and keeps scheduling/position-tracking
    // working regardless — exactly what this test needs, since it's only
    // proving the IPC/transport layer, not re-proving renderBlock's mixing.
    writeFileSync(
      projectPath,
      JSON.stringify({
        bpm: 60,
        snapDiv: 16,
        rifffs: [
          {
            groupId: 'r1',
            startBar: 0,
            barLength: 4,
            fadeInBars: 0,
            fadeOutBars: 0,
            stems: [
              {
                stemKey: 'r1:1',
                resolvedPath: join(dir, 'missing.wav'),
                durationSec: 16,
                barLength: 4,
                offsetSteps: 0,
                startBarOverride: -1,
                volume: 1,
                muted: false
              }
            ]
          }
        ]
      })
    )

    serverProcess = spawn(ENGINE_BINARY, ['--serve', String(TEST_PORT)])
    const serverOutput = collectOutput(serverProcess)
    await waitForLogLine(serverProcess, `serving on 127.0.0.1:${TEST_PORT}`, 5000)

    const clientOutput: string[] = []
    await new Promise<void>((resolve, reject) => {
      const client = spawn(ENGINE_BINARY, ['--test-client', String(TEST_PORT), projectPath])
      client.stderr?.on('data', (chunk: Buffer) => clientOutput.push(chunk.toString()))
      client.on('exit', (code) =>
        code === 0 ? resolve() : reject(new Error(`test-client exited ${code}`))
      )
      client.on('error', reject)
    })

    const clientLog = clientOutput.join('')
    expect(clientLog).toContain('test-client: connected')
    // NOTE: JUCE's JSON::toString (used by TestClient::sendJson / the server's
    // replies) emits `"type": "position-update"` — a space after the colon —
    // not the compact `"type":"position-update"` the plan's original regex
    // assumed. Confirmed against real --test-client stderr output during
    // Task 11: the compact-form regex matched zero lines despite the log
    // genuinely containing position-update messages. \s* tolerates either form.
    const positionUpdates = [
      ...clientLog.matchAll(/received (\{.*"type":\s*"position-update".*\})/g)
    ]
    expect(positionUpdates.length).toBeGreaterThan(0)

    const positions = positionUpdates.map((m) => JSON.parse(m[1]).payload.pos as number)
    // Position should be non-decreasing across the pushes received while playing.
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThanOrEqual(positions[i - 1])
    }
    if (positions.length > 1) {
      expect(positions[positions.length - 1]).toBeGreaterThan(positions[0])
    }

    expect(serverOutput.text()).toContain('client connected')
    rmSync(dir, { recursive: true, force: true })
  }, 10000)
})
