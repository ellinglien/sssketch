import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readWavHeader, wavDurationSeconds } from './wavHeader'

function floatWav(frames: number, channels = 2, rate = 48000): Buffer {
  const bytes = Buffer.alloc(44 + frames * channels * 4)
  bytes.write('RIFF', 0)
  bytes.writeUInt32LE(bytes.length - 8, 4)
  bytes.write('WAVE', 8)
  bytes.write('fmt ', 12)
  bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(3, 20)
  bytes.writeUInt16LE(channels, 22)
  bytes.writeUInt32LE(rate, 24)
  bytes.writeUInt32LE(rate * channels * 4, 28)
  bytes.writeUInt16LE(channels * 4, 32)
  bytes.writeUInt16LE(32, 34)
  bytes.write('data', 36)
  bytes.writeUInt32LE(frames * channels * 4, 40)
  return bytes
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sssketch-wavheader-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('readWavHeader', () => {
  it('reads a file far larger than the header it reads, sizing the data from the file', async () => {
    const path = join(dir, 'big.wav')
    writeFileSync(path, floatWav(96000)) // 768 KB of data
    const wav = await readWavHeader(path, 'missing')
    expect(wav).toMatchObject({
      audioFormat: 3,
      numChannels: 2,
      sampleRate: 48000,
      bitsPerSample: 32
    })
    expect(wav.dataSize).toBe(96000 * 8)
    expect(await wavDurationSeconds(path)).toBeCloseTo(2, 6)
  })

  it('a truncated file counts only the data actually there', async () => {
    const path = join(dir, 'short.wav')
    writeFileSync(path, floatWav(96000).subarray(0, 44 + 800))
    expect((await readWavHeader(path, 'missing')).dataSize).toBe(800)
  })

  it('a missing or empty file throws the given message', async () => {
    await expect(readWavHeader(join(dir, 'nope.wav'), 'gone')).rejects.toThrow('gone')
    writeFileSync(join(dir, 'empty.wav'), '')
    await expect(readWavHeader(join(dir, 'empty.wav'), 'gone')).rejects.toThrow('gone')
  })
})
