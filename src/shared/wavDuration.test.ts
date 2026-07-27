import { describe, expect, it } from 'vitest'
import { readWavDurationSeconds } from './wavDuration'

function buildSyntheticWav(opts: {
  sampleRate: number
  numChannels: number
  bitsPerSample: number
  numFrames: number
}): Uint8Array {
  const { sampleRate, numChannels, bitsPerSample, numFrames } = opts
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
  view.setUint32(16, 16, true) // fmt chunk size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true) // byte rate
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitsPerSample, true)
  writeStr(36, 'data')
  view.setUint32(40, dataBytes, true)
  return new Uint8Array(buf)
}

describe('readWavDurationSeconds', () => {
  it('computes duration from sample rate, channels, and data size', () => {
    const wav = buildSyntheticWav({
      sampleRate: 48000,
      numChannels: 2,
      bitsPerSample: 16,
      numFrames: 48000 * 4 // 4 seconds
    })
    expect(readWavDurationSeconds(wav)).toBeCloseTo(4, 5)
  })
  it('handles mono 24-bit audio', () => {
    const wav = buildSyntheticWav({
      sampleRate: 44100,
      numChannels: 1,
      bitsPerSample: 24,
      numFrames: 44100 * 2
    })
    expect(readWavDurationSeconds(wav)).toBeCloseTo(2, 5)
  })
})
