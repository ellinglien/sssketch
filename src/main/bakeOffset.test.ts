import { describe, expect, it, vi } from 'vitest'
import { writeFileSync, mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Same mock as nativeExport.test.ts (see its own doc comment for why this is
// a faithful stand-in, not a workaround) — bakeOffset's native-routed path
// spawns a real engine process via engineProcess.ts's spawnEngine(), whose
// defaultBinaryPath() resolves through app.getAppPath().
vi.mock('electron', () => ({ app: { getAppPath: () => process.cwd() } }))

import { bakeOffset } from './bakeOffset'

/** A 16-bit mono WAV ramping linearly from 0 to just under full scale, so a
 * rotation can be verified by checking which sample value now sits at
 * offset 0 — mirrors native-engine/Source/BakeStemTests.cpp's identical
 * fixture, kept as its own local copy per this codebase's existing
 * convention (each test file owns its own fixture helpers). */
function writeRampWav(path: string, numSamples: number, sampleRate = 1000): void {
  const dataSize = numSamples * 2
  const buf = Buffer.alloc(44 + dataSize)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataSize, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20) // PCM
  buf.writeUInt16LE(1, 22) // mono
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(dataSize, 40)
  for (let i = 0; i < numSamples; i++) {
    const sample16 = Math.round((i / numSamples) * 32000)
    buf.writeInt16LE(sample16, 44 + i * 2)
  }
  writeFileSync(path, buf)
}

function findDataChunkOffset(buf: Buffer): number {
  let offset = 12
  while (offset + 8 <= buf.length) {
    const chunkId = buf.toString('ascii', offset, offset + 4)
    const chunkSize = buf.readUInt32LE(offset + 4)
    if (chunkId === 'data') return offset + 8
    offset += 8 + chunkSize + (chunkSize % 2)
  }
  throw new Error(`no "data" chunk found in WAV (${buf.length} bytes)`)
}

describe('bakeOffset', () => {
  it('bakes a .wav job via the existing JS rotation, unaffected by the native routing added alongside it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ssstitch-bake-test-'))
    try {
      const path = join(dir, 'source.wav')
      writeRampWav(path, 1000, 1000)
      const results = await bakeOffset([{ path, rotationSec: 0.25 }])
      expect(results).toHaveLength(1)
      expect(results[0].bakedPath).toBe(join(dir, 'source.baked.wav'))
      const bytes = readFileSync(results[0].bakedPath)
      const dataOffset = findDataChunkOffset(bytes)
      expect(bytes.readInt16LE(dataOffset)).toBeCloseTo(0.25 * 32000, -2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('bakes an extensionless (LORE-style) job through the native engine, writing a .baked.wav sibling next to the original', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ssstitch-bake-test-'))
    try {
      // No extension at all — matches loreWarehouse.ts's resolveStemPath
      // exactly (the path is just the raw StemCID).
      const path = join(dir, 'abcdef0123456789')
      writeRampWav(path, 1000, 1000)

      const results = await bakeOffset([{ path, rotationSec: 0.25 }])
      expect(results).toHaveLength(1)
      expect(results[0].path).toBe(path)
      expect(results[0].bakedPath).toBe(`${path}.baked.wav`)
      expect(existsSync(results[0].bakedPath)).toBe(true)

      // Rotating a ramp by 0.25s (sample 250 of 1000) should put that sample's
      // value at the very start of the baked output.
      const bytes = readFileSync(results[0].bakedPath)
      const dataOffset = findDataChunkOffset(bytes)
      expect(bytes.readInt16LE(dataOffset)).toBeCloseTo(0.25 * 32000, -2)

      // The original source file must be untouched — never overwritten.
      const originalBytes = readFileSync(path)
      expect(originalBytes.readInt16LE(44)).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 20000)

  it('skips (and logs, does not throw) a WAV job with no usable fmt chunk', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ssstitch-bake-test-'))
    try {
      const path = join(dir, 'bad.wav')
      writeFileSync(path, Buffer.from('not a real wav file'))
      const results = await bakeOffset([{ path, rotationSec: 0.1 }])
      expect(results).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
