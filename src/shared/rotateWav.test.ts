import { describe, expect, it } from 'vitest'
import { rotateWavFrames } from './rotateWav'
import { LOOP_SEW_WINDOW_FRAMES } from './loopSewPCM16'
import { findWavChunks } from './wavChunks'

/** Builds a 16-bit WAV whose sample values come from `sample(frame, channel)`.
 * Defaults to the frame index (0, 1, 2, ...) so a rotation's correctness can be
 * checked by reading the values back out; the seam-blend tests below pass their
 * own shapes instead, because a ramp's own values are indistinguishable from
 * the blend's output. */
function buildWav(
  opts: {
    sampleRate: number
    numChannels: number
    numFrames: number
  },
  sample: (frame: number, channel: number) => number = (frame) => frame
): Uint8Array {
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
  // With the default `sample`, every sample in a frame carries the frame index,
  // so channel alignment can be verified independently of rotation correctness.
  for (let frame = 0; frame < numFrames; frame++) {
    for (let ch = 0; ch < numChannels; ch++) {
      view.setInt16(44 + (frame * numChannels + ch) * 2, sample(frame, ch), true)
    }
  }
  return new Uint8Array(buf)
}

const buildIndexedWav = (opts: {
  sampleRate: number
  numChannels: number
  numFrames: number
}): Uint8Array => buildWav(opts)

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

/** A stem whose first half is silent and whose second half holds a loud,
 * sustained value — the shape of Elling's report ("ends abruptly ... does not
 * trail off"), reduced to something a test can assert on. Rotating this by
 * exactly half its length puts the loud tail immediately before the silent
 * head, so the seam is a bare 20000-count step. */
const HELD_TAIL = 20000
function buildHeldTailWav(numFrames = 1000, numChannels = 1): Uint8Array {
  return buildWav({ sampleRate: 48000, numChannels, numFrames }, (frame) =>
    frame < numFrames / 2 ? 0 : HELD_TAIL
  )
}

function readChannel(bytes: Uint8Array, numChannels: number, channel: number): number[] {
  return readFrames(bytes, numChannels).map((frame) => frame[channel])
}

function maxAbsDelta(values: number[]): number {
  let worst = 0
  for (let i = 1; i < values.length; i++)
    worst = Math.max(worst, Math.abs(values[i] - values[i - 1]))
  return worst
}

describe('rotateWavFrames seam blend', () => {
  it('leaves a hard step at the rotation seam when the blend is switched off', () => {
    const rotated = rotateWavFrames(buildHeldTailWav(), 500, { seamBlendFrames: 0 })
    const samples = readChannel(rotated, 1, 0)
    expect(samples[499]).toBe(HELD_TAIL)
    expect(samples[500]).toBe(0)
    expect(maxAbsDelta(samples)).toBe(HELD_TAIL)
  })

  it('smooths the rotation seam so the tail runs continuously into the head', () => {
    const rotated = rotateWavFrames(buildHeldTailWav(), 500)
    const samples = readChannel(rotated, 1, 0)

    // The frame immediately before the seam becomes exactly the frame after
    // it: no step at all, which is the whole point.
    expect(samples[499]).toBe(samples[500])
    expect(samples[499]).toBe(0)

    // Walking backwards from the seam, the tail rises monotonically back to
    // its original level — a descent into the seam, not a cliff.
    const window = samples.slice(500 - LOOP_SEW_WINDOW_FRAMES, 500)
    for (let i = 1; i < window.length; i++) expect(window[i]).toBeLessThanOrEqual(window[i - 1])

    // And what used to be a 20000-count jump in a single frame is now spread
    // out: the worst remaining frame-to-frame step is an order of magnitude
    // smaller.
    expect(maxAbsDelta(samples)).toBeLessThan(HELD_TAIL / 10)
  })

  it('touches only the window immediately before the seam', () => {
    const rotated = rotateWavFrames(buildHeldTailWav(), 500)
    const samples = readChannel(rotated, 1, 0)
    for (let i = 0; i < 500 - LOOP_SEW_WINDOW_FRAMES; i++) expect(samples[i]).toBe(HELD_TAIL)
    for (let i = 500; i < 1000; i++) expect(samples[i]).toBe(0)
  })

  it('blends each channel toward its own head value', () => {
    const wav = buildWav({ sampleRate: 48000, numChannels: 2, numFrames: 1000 }, (frame, ch) =>
      frame < 500 ? (ch === 0 ? 3000 : -4000) : ch === 0 ? HELD_TAIL : -15000
    )
    const rotated = rotateWavFrames(wav, 500)
    const left = readChannel(rotated, 2, 0)
    const right = readChannel(rotated, 2, 1)
    expect(left[500]).toBe(3000)
    expect(right[500]).toBe(-4000)
    expect(left[499]).toBe(3000)
    expect(right[499]).toBe(-4000)
  })

  it('is byte-identical to the input for a zero rotation', () => {
    const wav = buildHeldTailWav()
    expect(rotateWavFrames(wav, 0)).toEqual(wav)
  })

  it('is byte-identical to the input for a rotation equal to the frame count', () => {
    const wav = buildHeldTailWav()
    expect(rotateWavFrames(wav, 1000)).toEqual(wav)
  })

  it('leaves a buffer shorter than twice the window completely unblended', () => {
    // Mirrors LoopSewing.cpp's own guard: no room for a clean, non-overlapping
    // window means no blend at all, rather than a squeezed one.
    const wav = buildHeldTailWav(LOOP_SEW_WINDOW_FRAMES * 2)
    const rotated = rotateWavFrames(wav, LOOP_SEW_WINDOW_FRAMES)
    expect(rotated).toEqual(rotateWavFrames(wav, LOOP_SEW_WINDOW_FRAMES, { seamBlendFrames: 0 }))
  })

  it('keeps the frame count and every header byte unchanged', () => {
    const wav = buildHeldTailWav()
    const rotated = rotateWavFrames(wav, 500)
    expect(rotated.length).toBe(wav.length)
    expect(findWavChunks(rotated)).toEqual(findWavChunks(wav))
    expect(rotated.subarray(0, 44)).toEqual(wav.subarray(0, 44))
    expect(readFrames(rotated, 1)).toHaveLength(1000)
  })
})
