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

/** Builds a WAV with a JUNK chunk (padded to an even size) inserted between `fmt `
 * and `data`, mirroring the real Endlesss export fixtures — the chunk-walking loop
 * must skip over it rather than mis-locating `data`. */
function buildWavWithJunkChunk(opts: {
  sampleRate: number
  numChannels: number
  bitsPerSample: number
  numFrames: number
  junkPayloadSize: number
}): Uint8Array {
  const { sampleRate, numChannels, bitsPerSample, numFrames, junkPayloadSize } = opts
  const blockAlign = numChannels * (bitsPerSample / 8)
  const dataBytes = numFrames * blockAlign
  const junkPadded = junkPayloadSize + (junkPayloadSize % 2)
  const riffBodySize = 4 + (8 + 16) + (8 + junkPadded) + (8 + dataBytes)
  const buf = new ArrayBuffer(8 + riffBodySize)
  const view = new DataView(buf)
  const writeStr = (offset: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i))
  }
  let o = 0
  writeStr(o, 'RIFF')
  o += 4
  view.setUint32(o, riffBodySize, true)
  o += 4
  writeStr(o, 'WAVE')
  o += 4
  writeStr(o, 'fmt ')
  o += 4
  view.setUint32(o, 16, true)
  o += 4
  view.setUint16(o, 1, true) // PCM
  o += 2
  view.setUint16(o, numChannels, true)
  o += 2
  view.setUint32(o, sampleRate, true)
  o += 4
  view.setUint32(o, sampleRate * blockAlign, true)
  o += 4
  view.setUint16(o, blockAlign, true)
  o += 2
  view.setUint16(o, bitsPerSample, true)
  o += 2
  writeStr(o, 'JUNK')
  o += 4
  view.setUint32(o, junkPayloadSize, true)
  o += 4
  o += junkPadded // junk payload bytes are left zeroed, we just skip past them
  writeStr(o, 'data')
  o += 4
  view.setUint32(o, dataBytes, true)
  o += 4
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
  it('skips an interstitial JUNK chunk between fmt and data', () => {
    const wav = buildWavWithJunkChunk({
      sampleRate: 48000,
      numChannels: 2,
      bitsPerSample: 16,
      numFrames: 48000 * 3, // 3 seconds
      junkPayloadSize: 7 // odd size, exercises the even-padding logic too
    })
    expect(readWavDurationSeconds(wav)).toBeCloseTo(3, 5)
  })
  it('throws a descriptive error for a file truncated inside the fmt chunk', () => {
    const full = buildSyntheticWav({
      sampleRate: 44100,
      numChannels: 2,
      bitsPerSample: 16,
      numFrames: 100
    })
    // fmt chunk body starts at byte 20 and declares 16 bytes; keep only 4 of them.
    const truncated = full.slice(0, 24)
    expect(() => readWavDurationSeconds(truncated)).toThrow(/truncated/i)
  })
  it('clamps duration when the data chunk declares more bytes than are actually present', () => {
    const full = buildSyntheticWav({
      sampleRate: 44100,
      numChannels: 1,
      bitsPerSample: 16,
      numFrames: 44100 // header declares 1 second of data (88200 bytes)
    })
    // Simulate a file truncated/still-copying mid-payload: keep only half the
    // declared data bytes, while the data chunk header still claims the full size.
    const truncated = full.slice(0, 44 + 44100)
    expect(readWavDurationSeconds(truncated)).toBeCloseTo(0.5, 5)
  })
})
