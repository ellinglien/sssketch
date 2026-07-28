import { describe, expect, it } from 'vitest'
import { rotateWavFrames } from './rotateWav'
import { findWavChunks } from './wavChunks'

/** Builds a WAV whose samples are just the frame index (0, 1, 2, ...), so a
 * rotation's correctness can be checked by reading the values back out. */
function buildIndexedWav(opts: {
  sampleRate: number
  numChannels: number
  numFrames: number
}): Uint8Array {
  const { sampleRate, numChannels, numFrames } = opts
  const bitsPerSample = 16
  const blockAlign = numChannels * (bitsPerSample / 8)
  const dataBytes = numFrames * blockAlign
  const buf = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(buf)
  const writeStr = (offset: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i))
  }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitsPerSample, true)
  writeStr(36, 'data')
  view.setUint32(40, dataBytes, true)
  // Every sample in a frame carries the frame index, so channel alignment can be
  // verified independently of rotation correctness.
  for (let frame = 0; frame < numFrames; frame++) {
    for (let ch = 0; ch < numChannels; ch++) {
      view.setInt16(44 + (frame * numChannels + ch) * 2, frame, true)
    }
  }
  return new Uint8Array(buf)
}

function readFrames(bytes: Uint8Array, numChannels: number): number[][] {
  const { dataOffset, dataSize } = findWavChunks(bytes)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const frameSize = numChannels * 2
  const frames: number[][] = []
  for (let o = dataOffset; o < dataOffset + dataSize; o += frameSize) {
    const frame: number[] = []
    for (let ch = 0; ch < numChannels; ch++) frame.push(view.getInt16(o + ch * 2, true))
    frames.push(frame)
  }
  return frames
}

describe('rotateWavFrames', () => {
  it('moves the leading frames to the end, at frame boundaries', () => {
    const wav = buildIndexedWav({ sampleRate: 48000, numChannels: 2, numFrames: 10 })
    const rotated = rotateWavFrames(wav, 3)
    const frames = readFrames(rotated, 2)
    expect(frames).toEqual([
      [3, 3],
      [4, 4],
      [5, 5],
      [6, 6],
      [7, 7],
      [8, 8],
      [9, 9],
      [0, 0],
      [1, 1],
      [2, 2]
    ])
  })

  it('keeps channels aligned within each frame after rotation', () => {
    const wav = buildIndexedWav({ sampleRate: 48000, numChannels: 3, numFrames: 5 })
    const rotated = rotateWavFrames(wav, 2)
    const frames = readFrames(rotated, 3)
    for (const frame of frames) {
      expect(new Set(frame).size).toBe(1) // all channels in a frame still match
    }
  })

  it('wraps rotation amounts larger than the total frame count', () => {
    const wav = buildIndexedWav({ sampleRate: 48000, numChannels: 1, numFrames: 4 })
    const rotated = rotateWavFrames(wav, 6) // 6 % 4 == 2
    expect(readFrames(rotated, 1)).toEqual([[2], [3], [0], [1]])
  })

  it('wraps negative rotation amounts', () => {
    const wav = buildIndexedWav({ sampleRate: 48000, numChannels: 1, numFrames: 4 })
    const rotated = rotateWavFrames(wav, -1) // equivalent to rotating by 3
    expect(readFrames(rotated, 1)).toEqual([[3], [0], [1], [2]])
  })

  it('is a no-op for a zero rotation', () => {
    const wav = buildIndexedWav({ sampleRate: 48000, numChannels: 1, numFrames: 4 })
    const rotated = rotateWavFrames(wav, 0)
    expect(readFrames(rotated, 1)).toEqual([[0], [1], [2], [3]])
  })

  it('preserves total file size', () => {
    const wav = buildIndexedWav({ sampleRate: 48000, numChannels: 2, numFrames: 100 })
    const rotated = rotateWavFrames(wav, 37)
    expect(rotated.length).toBe(wav.length)
  })
})
