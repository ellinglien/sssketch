import { describe, expect, it } from 'vitest'
import { encodeWavPCM16 } from './encodeWav'
import { readWavDurationSeconds } from './wavDuration'
import { findWavChunks } from './wavChunks'

describe('encodeWavPCM16', () => {
  it('produces a header readWavDurationSeconds/findWavChunks parse correctly', () => {
    const sampleRate = 44100
    const left = new Float32Array(sampleRate * 2) // 2 seconds
    const right = new Float32Array(sampleRate * 2)
    const wav = encodeWavPCM16([left, right], sampleRate)

    expect(readWavDurationSeconds(wav)).toBeCloseTo(2, 5)
    const chunks = findWavChunks(wav)
    expect(chunks.numChannels).toBe(2)
    expect(chunks.sampleRate).toBe(sampleRate)
    expect(chunks.bitsPerSample).toBe(16)
  })

  it('round-trips sample values through 16-bit quantization', () => {
    const sampleRate = 8000
    const channel = new Float32Array([0, 0.5, -0.5, 1, -1])
    const wav = encodeWavPCM16([channel], sampleRate)
    const { dataOffset } = findWavChunks(wav)
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength)

    const readSample = (i: number): number => view.getInt16(dataOffset + i * 2, true) / 0x8000
    expect(readSample(0)).toBeCloseTo(0, 3)
    expect(readSample(1)).toBeCloseTo(0.5, 2)
    expect(readSample(2)).toBeCloseTo(-0.5, 2)
    expect(readSample(3)).toBeCloseTo(1, 2)
    expect(readSample(4)).toBeCloseTo(-1, 2)
  })

  it('clamps samples outside [-1, 1] rather than wrapping', () => {
    const wav = encodeWavPCM16([new Float32Array([2, -3])], 8000)
    const { dataOffset } = findWavChunks(wav)
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength)
    expect(view.getInt16(dataOffset, true)).toBe(0x7fff)
    expect(view.getInt16(dataOffset + 2, true)).toBe(-0x8000)
  })

  it('interleaves multi-channel data correctly', () => {
    const left = new Float32Array([1, 0])
    const right = new Float32Array([0, 1])
    const wav = encodeWavPCM16([left, right], 8000)
    const { dataOffset } = findWavChunks(wav)
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength)
    // frame 0: L=1, R=0 ; frame 1: L=0, R=1
    expect(view.getInt16(dataOffset + 0, true)).toBeGreaterThan(30000) // L, frame 0
    expect(view.getInt16(dataOffset + 2, true)).toBe(0) // R, frame 0
    expect(view.getInt16(dataOffset + 4, true)).toBe(0) // L, frame 1
    expect(view.getInt16(dataOffset + 6, true)).toBeGreaterThan(30000) // R, frame 1
  })
})
