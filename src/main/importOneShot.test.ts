import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { encodeWavPCM16 } from '@shared/encodeWav'
import { importOneShot, importLoop, importRecordedTake, importRecordedStem } from './importOneShot'

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

describe('importLoop', () => {
  it('builds a single-stem, non-oneShot Rifff whose bpm is back-solved from the given bar count and real duration', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-looptest-'))
    try {
      // 2 bars at exactly 120bpm (secPerBar = 2s) = 4 real seconds.
      const path = writeTestWav(dir, 'amen.wav', 4.0)
      const rifff = importLoop(path, 2)
      expect(rifff).not.toBeNull()
      expect(rifff!.bpm).toBeCloseTo(120, 1)
      expect(rifff!.barLength).toBe(2)
      expect(rifff!.stems).toHaveLength(1)
      expect(rifff!.stems[0].oneShot).toBeUndefined()
      expect(rifff!.stems[0].barLength).toBe(2)
      expect(rifff!.stems[0].durationSec).toBeCloseTo(4.0, 1)
      // Copied into the managed library, same as importOneShot.
      expect(rifff!.stems[0].path).not.toBe(path)
      expect(existsSync(rifff!.stems[0].path)).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('derives a different bpm for the same file when given a different bar count', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-looptest-'))
    try {
      const path = writeTestWav(dir, 'break.wav', 4.0)
      expect(importLoop(path, 1)!.bpm).toBeCloseTo(60, 1)
      expect(importLoop(path, 4)!.bpm).toBeCloseTo(240, 1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('returns null for a non-WAV file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-looptest-'))
    try {
      const path = join(dir, 'not-audio.txt')
      writeFileSync(path, 'hello')
      expect(importLoop(path, 4)).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('returns null for a path that does not exist, without throwing', () => {
    expect(importLoop('/no/such/file.wav', 4)).toBeNull()
  })
})

describe('importRecordedTake', () => {
  it('imports a manual arm/disarm take (no loopBars) as a one-shot stem, behaving like a dragged-in sample rather than tiling/stretching to a bar grid', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-recordedtake-test-'))
    try {
      const testWavPath = writeTestWav(dir, 'take.wav', 4.0)
      const result = importRecordedTake(testWavPath, 120)
      expect(result).not.toBeNull()
      // bpm is still the project's real bpm (accurate metadata), but
      // barLength is cosmetic -- see importRecordedTake's own doc comment.
      expect(result!.bpm).toBe(120)
      expect(result!.barLength).toBe(1)
      expect(result!.stems).toHaveLength(1)
      expect(result!.stems[0].oneShot).toBe(true)
      expect(result!.stems[0].barLength).toBe(1)
      expect(result!.stems[0].durationSec).toBeCloseTo(4.0, 1)
      expect(result!.stems[0].type).toBe('audioIn')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('imports a gated-recording take (loopBars passed) as a tiled/looped rifff, not a one-shot -- it should behave like any other imported rifff, replicating via handles', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-recordedtake-test-'))
    try {
      const testWavPath = writeTestWav(dir, 'take.wav', 4.0)
      const result = importRecordedTake(testWavPath, 120, 4)
      expect(result).not.toBeNull()
      expect(result!.bpm).toBe(120)
      expect(result!.barLength).toBe(4)
      expect(result!.stems).toHaveLength(1)
      expect(result!.stems[0].oneShot).toBeUndefined()
      expect(result!.stems[0].barLength).toBe(4)
      expect(result!.stems[0].type).toBe('audioIn')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('names every take a random "adjective noun" pair followed by the record time', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-recordedtake-test-'))
    try {
      const testWavPath = writeTestWav(dir, 'take.wav', 1.0)
      const result = importRecordedTake(testWavPath, 120)
      expect(result!.name).toMatch(/^[a-z]+ [a-z]+ .+$/)
      expect(result!.stems[0].name).toBe(result!.name)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('returns null for a non-wav path', () => {
    expect(importRecordedTake('/tmp/not-a-wav.mp3', 120)).toBeNull()
  })
})

describe('importRecordedStem', () => {
  it('returns a Stem (not a Rifff) with the compensated barLength when rifff.bpm differs from the live tempo', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-recordedstem-test-'))
    try {
      // 4 bars at 120bpm (2s/bar) = 8 real seconds captured.
      const testWavPath = writeTestWav(dir, 'take.wav', 8.0)
      // rifff.bpm=150 (the rifff's own fixed tempo), captured at 4 bars.
      const stem = importRecordedStem(testWavPath, 150, 4)
      expect(stem).not.toBeNull()
      // barLength = durationSec * rifff.bpm / 240 = 8 * 150 / 240 = 5.
      expect(stem!.barLength).toBeCloseTo(5, 5)
      expect(stem!.durationSec).toBeCloseTo(8.0, 1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('is a no-op compensation (barLength === loopBars) when rifff.bpm equals the capture tempo', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-recordedstem-test-'))
    try {
      // 4 bars at 120bpm (2s/bar) = 8 real seconds -- captured AT rifff.bpm
      // itself (120), so compensation should reduce to barLength=loopBars.
      const testWavPath = writeTestWav(dir, 'take.wav', 8.0)
      const stem = importRecordedStem(testWavPath, 120, 4)
      expect(stem!.barLength).toBeCloseTo(4, 5)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('assigns a slot one past the highest existing slot', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-recordedstem-test-'))
    try {
      const testWavPath = writeTestWav(dir, 'take.wav', 4.0)
      const stem = importRecordedStem(testWavPath, 120, 4, [1, 6, 3])
      expect(stem!.slot).toBe(7)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('snaps a barLength polluted by sample-quantization noise to the exact whole bar it was meant to be', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-recordedstem-test-'))
    try {
      // Chosen so durationSec * rifffBpm / 240 lands at 4.000003306878307
      // rather than exactly 4 -- the same shape of noise (~3e-6 bars) as
      // the real bug's confirmed 16.000003184020517, caused by 44100 not
      // dividing evenly into the ideal duration in floating point. See
      // this file's real-project repro in the handoff for the original
      // 3.18e-6 example this mirrors.
      const testWavPath = writeTestWav(dir, 'take.wav', (4 * 240) / 85)
      const stem = importRecordedStem(testWavPath, 85, 4)
      expect(stem).not.toBeNull()
      expect(stem!.barLength).toBe(4)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('does not snap a genuinely fractional, tempo-compensated barLength that is nowhere near a whole bar', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-recordedstem-test-'))
    try {
      // 4 bars captured at 120bpm (2s/bar) = 8s, compensated for a rifff
      // fixed at 232.5bpm: barLength = 8 * 232.5 / 240 = 7.75 -- a real,
      // deliberate fractional value from genuine tempo compensation, not
      // measurement noise, and must be left untouched.
      const testWavPath = writeTestWav(dir, 'take.wav', 8.0)
      const stem = importRecordedStem(testWavPath, 232.5, 4)
      expect(stem!.barLength).toBeCloseTo(7.75, 4)
      expect(stem!.barLength).not.toBe(8)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('assigns slot 0 when the rifff has no existing stems', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-recordedstem-test-'))
    try {
      const testWavPath = writeTestWav(dir, 'take.wav', 4.0)
      const stem = importRecordedStem(testWavPath, 120, 4, [])
      expect(stem!.slot).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('names the stem a random "adjective noun" pair followed by the record time, type audioIn, recordedInApp, no oneShot', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sssketch-recordedstem-test-'))
    try {
      const testWavPath = writeTestWav(dir, 'take.wav', 4.0)
      const stem = importRecordedStem(testWavPath, 120, 4, [])
      expect(stem!.name).toMatch(/^[a-z]+ [a-z]+ .+$/)
      expect(stem!.type).toBe('audioIn')
      expect(stem!.recordedInApp).toBe(true)
      expect(stem!.oneShot).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('returns null for a non-wav path', () => {
    expect(importRecordedStem('/tmp/not-a-wav.mp3', 120, 4, [])).toBeNull()
  })
})
