import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { encodeWavPCM16 } from '@shared/encodeWav'
import { importOneShot, importRecordedTake } from './importOneShot'

function writeTestWav(dir: string, name: string, seconds: number, sampleRate = 44100): string {
  const numSamples = Math.round(seconds * sampleRate)
  const channel = new Float32Array(numSamples).fill(0.5)
  const bytes = encodeWavPCM16([channel], sampleRate)
  const path = join(dir, name)
  writeFileSync(path, bytes)
  return path
}

describe('importOneShot', () => {
  it('builds a single-stem oneShot Rifff from a real WAV file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-oneshot-test-'))
    try {
      const path = writeTestWav(dir, 'kick.wav', 0.3)
      const rifff = importOneShot(path)
      expect(rifff).not.toBeNull()
      expect(rifff!.stems).toHaveLength(1)
      expect(rifff!.stems[0].oneShot).toBe(true)
      expect(rifff!.stems[0].durationSec).toBeCloseTo(0.3, 1)
      // Copied into the managed library, not left pointing at the original drop location.
      expect(rifff!.stems[0].path).not.toBe(path)
      expect(existsSync(rifff!.stems[0].path)).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('returns null for a non-WAV file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-oneshot-test-'))
    try {
      const path = join(dir, 'not-audio.txt')
      writeFileSync(path, 'hello')
      expect(importOneShot(path)).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('returns null for a path that does not exist, without throwing', () => {
    expect(importOneShot('/no/such/file.wav')).toBeNull()
  })
})

describe('importRecordedTake', () => {
  it("imports a recorded WAV as a non-one-shot stem, deriving barLength from the audio's own real duration", () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-recordedtake-test-'))
    try {
      // bpm 120 -> secPerBar = (60/120)*4 = 2s -- a 4-second take is
      // exactly 2 bars, so barLength should come out deterministically
      // rather than needing a fuzzy/approximate assertion.
      const testWavPath = writeTestWav(dir, 'take.wav', 4.0)
      const result = importRecordedTake(testWavPath, 120)
      expect(result).not.toBeNull()
      expect(result!.bpm).toBe(120)
      expect(result!.barLength).toBe(2)
      expect(result!.stems[0].oneShot).toBeUndefined()
      expect(result!.stems[0].barLength).toBe(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rounds barLength to the nearest whole bar rather than leaving a fractional one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-recordedtake-test-'))
    try {
      // secPerBar at 120bpm = 2s -- 4.6s is 2.3 bars, rounds to 2.
      const testWavPath = writeTestWav(dir, 'take.wav', 4.6)
      const result = importRecordedTake(testWavPath, 120)
      expect(result).not.toBeNull()
      expect(result!.barLength).toBe(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('returns null for a non-wav path', () => {
    expect(importRecordedTake('/tmp/not-a-wav.mp3', 120)).toBeNull()
  })
})
