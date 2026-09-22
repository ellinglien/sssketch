import { describe, expect, it, afterEach } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EngineClient } from './engineClient'

const ENGINE_BINARY = join(
  __dirname,
  '../../native-engine/build/sssketch_engine_artefacts/sssketch-engine.app/Contents/MacOS/sssketch-engine'
)
const TEST_PORT = 45323 // distinct from Phase 1's ipc-roundtrip.test.ts's 45322

let serverProcess: ChildProcess | undefined
let client: EngineClient | undefined

afterEach(() => {
  client?.disconnect()
  client = undefined
  serverProcess?.kill('SIGKILL')
  serverProcess = undefined
})

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

describe('live reschedule: load-project while already playing', () => {
  it('accepts a second load-project mid-playback, keeps pushing position-update, and never disconnects', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-live-reschedule-'))
    const projectA = {
      bpm: 60,
      snapDiv: 16,
      rifffs: [
        {
          groupId: 'r1',
          startBar: 0,
          barLength: 4,
          stems: [
            {
              // No real stem file needed — PlaybackEngine.setProject skips stems
              // whose buffer fails to load and keeps scheduling/position-tracking
              // working regardless (same precedent Phase 1's ipc-roundtrip.test.ts
              // established). This test only proves the IPC/reschedule sequence,
              // not audio content.
              stemKey: 'r1:1',
              resolvedPath: join(dir, 'missing-a.wav'),
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
    }
    const projectB = {
      ...projectA,
      // Different bpm (changes scheduling math, not just a metadata rename)
      // and a renamed rifff group — a real reschedule, not a no-op swap.
      bpm: 120,
      rifffs: [{ ...projectA.rifffs[0], groupId: 'r2' }]
    }

    try {
      serverProcess = spawn(ENGINE_BINARY, ['--serve', String(TEST_PORT)])
      // 15s, not 5s: on a loaded CI runner, several other tests in this same
      // parallel run also spawn+kill real engine processes (one measured at
      // 4365ms just to become ready even in a quiet run) -- a cold spawn
      // genuinely taking >5s under that contention isn't a hang, just real
      // startup time under load. Caught for real via a failed release build.
      await waitForLogLine(serverProcess, `serving on 127.0.0.1:${TEST_PORT}`, 15000)

      client = new EngineClient()
      await client.connect(TEST_PORT)

      const positionsBeforeReschedule: number[] = []
      const unsubscribeBefore = client.on('position-update', (payload) => {
        positionsBeforeReschedule.push((payload as { pos: number }).pos)
      })

      client.send('load-project', projectA)
      client.send('play', { fromPos: 0 })
      await new Promise((resolve) => setTimeout(resolve, 200))
      unsubscribeBefore()
      expect(positionsBeforeReschedule.length).toBeGreaterThan(0)

      // The actual thing this test exists to prove: sending a second
      // load-project WHILE the engine is still playing (no stop/pause in
      // between) must not error, hang, or drop the connection.
      const positionsAfterReschedule: number[] = []
      const unsubscribeAfter = client.on('position-update', (payload) => {
        positionsAfterReschedule.push((payload as { pos: number }).pos)
      })
      client.send('load-project', projectB)
      await new Promise((resolve) => setTimeout(resolve, 200))
      unsubscribeAfter()

      // Position-update pushes kept arriving after the reschedule — proves the
      // connection survived and the timer/transport kept running uninterrupted.
      expect(positionsAfterReschedule.length).toBeGreaterThan(0)

      client.send('stop')
      client.send('quit')
      client.disconnect()
      client = undefined

      await new Promise((resolve) => {
        if (serverProcess?.exitCode !== null) return resolve(undefined)
        serverProcess?.once('exit', () => resolve(undefined))
      })
      expect(serverProcess?.exitCode).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 30000)
})
