import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('electron', () => ({ app: { getAppPath: () => process.cwd() } }))

// Records how many event-loop turns had passed when each stem was rendered. A riff's stems on a
// USB library take 0.5-2.5 s to render and publish; rendered back to back in one turn, the main
// thread is blocked for all of it (AGENTS.md section 6).
let turns = 0
const renderedAtTurn: number[] = []
vi.mock('@shared/rotateWav', async (importOriginal) => {
  const original = await importOriginal<typeof import('@shared/rotateWav')>()
  return {
    ...original,
    rotateWavFrames: (...args: Parameters<typeof original.rotateWavFrames>) => {
      renderedAtTurn.push(turns)
      return original.rotateWavFrames(...args)
    }
  }
})

import { bakeOffset } from './bakeOffset'

function writeRampWav(path: string, numSamples: number, sampleRate = 1000): void {
  const dataSize = numSamples * 2
  const buf = Buffer.alloc(44 + dataSize)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataSize, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(dataSize, 40)
  for (let i = 0; i < numSamples; i++) {
    buf.writeInt16LE(Math.round((i / numSamples) * 32000), 44 + i * 2)
  }
  writeFileSync(path, buf)
}

describe('bakeOffset and the main thread', () => {
  it('yields to the event loop between stems, so a riff never renders in one turn', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-bake-async-'))
    let ticking = true
    const tick = (): void => {
      turns++
      if (ticking) setImmediate(tick)
    }
    setImmediate(tick)
    try {
      const jobs = [1, 2, 3, 4].map((n) => {
        const path = join(dir, `stem-${n}.wav`)
        writeRampWav(path, 4000)
        return { path, rotationSec: 1 }
      })
      const results = await bakeOffset(jobs, join(dir, 'bakes'))
      expect(results).toHaveLength(4)
      expect(renderedAtTurn).toHaveLength(4)
      for (let i = 1; i < renderedAtTurn.length; i++) {
        expect(renderedAtTurn[i]).toBeGreaterThan(renderedAtTurn[i - 1])
      }
    } finally {
      ticking = false
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
