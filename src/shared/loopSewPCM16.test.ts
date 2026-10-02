import { describe, expect, it } from 'vitest'
import { findWavChunks } from './wavChunks'
import { LOOP_SEW_WINDOW_FRAMES, sewLoopPCM16 } from './loopSewPCM16'
import { stereoPanFrame } from './radioPan'

/** A mono 16-bit WAV whose Nth frame is `value(n)`. Same header layout as
 * encodeWavPCM16 writes, so the fixture and the subject agree by
 * construction rather than by transcription. */
function monoWav(frames: number, value: (n: number) => number, sampleRate = 48000): Uint8Array {
  const dataSize = frames * 2
  const bytes = new Uint8Array(44 + dataSize)
  const view = new DataView(bytes.buffer)
  const put = (o: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i))
  }
  put(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  put(8, 'WAVE')
  put(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  put(36, 'data')
  view.setUint32(40, dataSize, true)
  for (let n = 0; n < frames; n++) view.setInt16(44 + n * 2, value(n), true)
  return bytes
}

function samplesOf(wav: Uint8Array): Int16Array {
  const { dataOffset, dataSize } = findWavChunks(wav)
  const out = new Int16Array(dataSize / 2)
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength)
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(dataOffset + i * 2, true)
  return out
}

describe('sewLoopPCM16 trimming', () => {
  it('cuts a file that is longer than the loop it declares', () => {
    // The real case: a LORE ogg stem's durationSec comes from bars x tempo,
    // and the decoded file is a few frames longer. The engine trims at the
    // metadata duration for exactly this reason (StemBufferCache.cpp:75) and
    // so does this.
    const out = sewLoopPCM16(
      monoWav(1000, (): number => 500),
      900,
      1
    )
    expect(samplesOf(out)).toHaveLength(900)
  })

  it('pads a file that is shorter, with silence, rather than looping early', () => {
    const out = sewLoopPCM16(
      monoWav(500, (): number => 500),
      900,
      1
    )
    const samples = samplesOf(out)
    expect(samples).toHaveLength(900)
    // Silence, not a second helping of the source. Checked OUTSIDE the seam
    // window: the blend runs after the pad and pulls the last 128 frames
    // onto the first, so the very last frame is the first one by design (the
    // next case). Everything between the source's end and that window is
    // untouched padding.
    expect(samples[499]).toBe(500)
    expect(samples[500]).toBe(0)
    expect(samples[899 - LOOP_SEW_WINDOW_FRAMES]).toBe(0)
  })

  it('still sews a padded tail, because silence meeting a signal is a click', () => {
    // The plan's own draft asserted the last padded frame was 0. It is not,
    // and it should not be: the seam blend runs after the pad and coeff is
    // exactly 1.0 at i = 0, so the last frame BECOMES the first. A hard step
    // from silence to the first sample, once a cycle forever, is precisely
    // the artefact LoopSewing.cpp exists to remove.
    const out = samplesOf(
      sewLoopPCM16(
        monoWav(500, (): number => 500),
        900,
        1
      )
    )
    expect(out[899]).toBe(500)
  })

  it('rewrites both size headers so the result is a valid wav', () => {
    const out = sewLoopPCM16(
      monoWav(1000, (): number => 500),
      900,
      1
    )
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength)
    expect(out.byteLength).toBe(44 + 1800)
    expect(view.getUint32(4, true)).toBe(36 + 1800)
    const { dataSize, sampleRate, numChannels, bitsPerSample } = findWavChunks(out)
    expect(dataSize).toBe(1800)
    expect(sampleRate).toBe(48000)
    expect(numChannels).toBe(1)
    expect(bitsPerSample).toBe(16)
  })
})

/** An interleaved stereo 16-bit WAV whose Nth frame is `left(n)` / `right(n)`.
 * The phone is served STEREO (PHONE_STEM_CHANNELS in remoteStemRenderer.ts),
 * so every one of these paths is the real one, not a generalisation kept
 * against a rainy day. */
function stereoWav(
  frames: number,
  left: (n: number) => number,
  right: (n: number) => number,
  sampleRate = 48000
): Uint8Array {
  const dataSize = frames * 4
  const bytes = new Uint8Array(44 + dataSize)
  const view = new DataView(bytes.buffer)
  const put = (o: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i))
  }
  put(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  put(8, 'WAVE')
  put(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 2, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 4, true)
  view.setUint16(32, 4, true)
  view.setUint16(34, 16, true)
  put(36, 'data')
  view.setUint32(40, dataSize, true)
  for (let n = 0; n < frames; n++) {
    view.setInt16(44 + n * 4, left(n), true)
    view.setInt16(46 + n * 4, right(n), true)
  }
  return bytes
}

describe('sewLoopPCM16 in stereo', () => {
  it('counts FRAMES, not samples, so a stereo trim is not half a loop', () => {
    const out = sewLoopPCM16(
      stereoWav(
        1000,
        (): number => 500,
        (): number => -500
      ),
      900,
      1
    )
    const { dataSize, numChannels, bitsPerSample } = findWavChunks(out)
    expect(numChannels).toBe(2)
    expect(bitsPerSample).toBe(16)
    expect(dataSize).toBe(900 * 4)
    expect(samplesOf(out)).toHaveLength(1800)
  })

  it('rewrites the block align and byte rate for two channels', () => {
    const out = sewLoopPCM16(
      stereoWav(
        1000,
        (): number => 500,
        (): number => -500
      ),
      900,
      1
    )
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength)
    expect(view.getUint16(32, true)).toBe(4)
    expect(view.getUint32(28, true)).toBe(48000 * 4)
  })

  it('sews each side onto its OWN first frame, never onto the other side', () => {
    // Two channels that meet themselves at different values. If the blend
    // read `samples[0]` for both, the right channel's last frame would land
    // on the LEFT channel's first -- audible as the seam pulling the image
    // across, once a cycle, forever.
    const out = samplesOf(
      sewLoopPCM16(
        stereoWav(
          1000,
          (n): number => (n === 0 ? 1000 : 8000),
          (n): number => (n === 0 ? -2000 : -8000)
        ),
        1000,
        1
      )
    )
    expect(out[999 * 2]).toBe(1000)
    expect(out[999 * 2 + 1]).toBe(-2000)
  })

  it('keeps the two sides independent away from the seam', () => {
    const out = samplesOf(
      sewLoopPCM16(
        stereoWav(
          1000,
          (n): number => n - 500,
          (n): number => 500 - n
        ),
        1000,
        1
      )
    )
    for (let n = 0; n < 1000 - LOOP_SEW_WINDOW_FRAMES; n++) {
      expect(out[n * 2]).toBe(n - 500)
      expect(out[n * 2 + 1]).toBe(500 - n)
    }
  })

  it('pads a short stereo file with silence in both channels', () => {
    const out = samplesOf(
      sewLoopPCM16(
        stereoWav(
          500,
          (): number => 500,
          (): number => -500
        ),
        900,
        1
      )
    )
    expect(out).toHaveLength(1800)
    // Outside the seam window, for the same reason as the mono case.
    const frame = 899 - LOOP_SEW_WINDOW_FRAMES
    expect(out[frame * 2]).toBe(0)
    expect(out[frame * 2 + 1]).toBe(0)
  })
})

describe('sewLoopPCM16 pan (the row pan, baked like the gain)', () => {
  const lr = (): Uint8Array =>
    stereoWav(
      1000,
      (n): number => 4000 + n,
      (n): number => -2000 - n
    )

  it('pan 0 is the unpanned output, byte for byte', () => {
    expect(sewLoopPCM16(lr(), 900, 0.8, 0)).toEqual(sewLoopPCM16(lr(), 900, 0.8))
  })

  it('applies the StereoPannerNode law after the gain, once rounded', () => {
    const out = samplesOf(sewLoopPCM16(lr(), 900, 0.5, 0.25))
    const plain = samplesOf(sewLoopPCM16(lr(), 900, 0.5))
    // A frame well clear of the seam blend at the end.
    const n = 100
    const [l, r] = stereoPanFrame((4000 + n) * 0.5, (-2000 - n) * 0.5, 0.25)
    expect(out[n * 2]).toBe(Math.round(l))
    expect(out[n * 2 + 1]).toBe(Math.round(r))
    expect(out[n * 2]).not.toBe(plain[n * 2])
  })

  it('leaves a mono file alone (no second side to pan into)', () => {
    const mono = monoWav(1000, (): number => 500)
    expect(sewLoopPCM16(mono, 900, 1, 0.25)).toEqual(sewLoopPCM16(mono, 900, 1))
  })
})

describe('sewLoopPCM16 gain', () => {
  it('scales every sample, and clamps rather than wrapping', () => {
    const out = samplesOf(
      sewLoopPCM16(
        monoWav(1000, (): number => 20000),
        1000,
        2
      )
    )
    // 40000 does not fit in an int16; it must saturate, not wrap to -25536.
    expect(out[10]).toBe(32767)
  })

  it('leaves unity gain bit-identical away from the seam', () => {
    const out = samplesOf(
      sewLoopPCM16(
        monoWav(1000, (n): number => n - 500),
        1000,
        1
      )
    )
    for (let n = 0; n < 1000 - LOOP_SEW_WINDOW_FRAMES; n++) expect(out[n]).toBe(n - 500)
  })
})

describe('sewLoopPCM16 seam blend', () => {
  it('lands the last frame exactly on the first, so the wrap is continuous', () => {
    // coeff is sqrt(0.5 * (1 - t)) with t = -1 at i = 0, i.e. exactly 1.0 --
    // the last frame BECOMES the first. Ported verbatim from
    // native-engine/Source/LoopSewing.cpp.
    const out = samplesOf(
      sewLoopPCM16(
        monoWav(1000, (n): number => (n === 0 ? 1000 : 8000)),
        1000,
        1
      )
    )
    expect(out[999]).toBe(1000)
  })

  it('touches exactly 128 frames and not one more', () => {
    expect(LOOP_SEW_WINDOW_FRAMES).toBe(128)
    const out = samplesOf(
      sewLoopPCM16(
        monoWav(1000, (n): number => (n === 0 ? 0 : 8000)),
        1000,
        1
      )
    )
    expect(out[1000 - LOOP_SEW_WINDOW_FRAMES - 1]).toBe(8000)
    expect(out[1000 - LOOP_SEW_WINDOW_FRAMES]).not.toBe(8000)
  })

  it('decays monotonically away from the seam', () => {
    const out = samplesOf(
      sewLoopPCM16(
        monoWav(1000, (n): number => (n === 0 ? 0 : 8000)),
        1000,
        1
      )
    )
    for (let i = 1; i < LOOP_SEW_WINDOW_FRAMES; i++) {
      expect(out[999 - i]).toBeGreaterThanOrEqual(out[999 - (i - 1)])
    }
  })

  it('does nothing at all to a loop too short to blend', () => {
    // The engine's own guard: clampedLoopEnd <= windowSize * 2 returns early.
    const out = samplesOf(
      sewLoopPCM16(
        monoWav(200, (): number => 8000),
        200,
        1
      )
    )
    for (let n = 0; n < 200; n++) expect(out[n]).toBe(8000)
  })
})
