import { findWavChunks } from './wavChunks'

/** 128 frames, ~2.7ms at 48kHz. NOT a number to tune.
 *
 * It is `windowSize`'s default in native-engine/Source/LoopSewing.h, itself
 * a verbatim port of OUROVEON's Stem::applyLoopSewingBlend, and that header
 * records that widening it -- up to 4096, and per-stem adaptive -- was tried
 * and REVERTED: a longer blend suppresses the natural amplitude swing at the
 * end of a bar and reads as a loudness dip rather than as a declick. */
export const LOOP_SEW_WINDOW_FRAMES = 128

/**
 * Takes a 16-bit PCM WAV and returns the audio the phone should loop:
 * trimmed (or silence-padded) to exactly `frames` FRAMES, scaled by `gain`,
 * and with its last LOOP_SEW_WINDOW_FRAMES blended onto its own first frame
 * so the wrap is continuous.
 *
 * `frames` is a FRAME count, not a sample count: an interleaved stereo file
 * of N frames holds 2N samples, and the blend runs per channel so the pull
 * onto the head happens independently in left and right -- exactly as
 * LoopSewing.cpp does it, which loops over getNumChannels() and takes
 * `data[0]` per channel.
 *
 * WHY THE TRIM IS NOT OPTIONAL, and why `frames` comes from the caller rather
 * than from the file: a LORE Ogg stem's EngineStem.durationSec is derived
 * from bars x tempo, not measured, and the decoded file is routinely a few
 * frames longer. native-engine/Source/StemBufferCache.cpp:75 computes
 * `loopEndSample = round(trueDurationSec * sampleRate)` and blends THERE for
 * exactly this reason -- blending at the file's own end would declick a seam
 * that is never read, and looping there would drift a few frames per cycle.
 * Trimming here means the phone's `buffer.duration` IS durationSec by
 * construction, so no duration has to travel on the wire and the two ends
 * cannot disagree about where the loop is.
 *
 * Works on Int16 rather than converting to float and back: afconvert hands us
 * 16-bit and the result is re-encoded as 16-bit, so a float round trip would
 * only add rounding error to samples this function never touches. At unity
 * gain every frame outside the blend window is bit-identical.
 */
export function sewLoopPCM16(wav: Uint8Array, frames: number, gain: number): Uint8Array {
  const info = findWavChunks(wav)
  if (info.dataOffset < 0 || info.numChannels < 1 || info.bitsPerSample !== 16) {
    throw new Error('sewLoopPCM16 expects a 16-bit PCM wav')
  }
  const channels = info.numChannels
  const bytesPerFrame = channels * 2
  const target = Math.max(0, Math.floor(frames))
  const available = Math.floor(info.dataSize / bytesPerFrame)
  const dataSize = target * bytesPerFrame

  const src = new DataView(wav.buffer, wav.byteOffset, wav.byteLength)
  const out = new Uint8Array(44 + dataSize)
  const dst = new DataView(out.buffer)

  const put = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) dst.setUint8(offset + i, text.charCodeAt(i))
  }
  put(0, 'RIFF')
  dst.setUint32(4, 36 + dataSize, true)
  put(8, 'WAVE')
  put(12, 'fmt ')
  dst.setUint32(16, 16, true)
  dst.setUint16(20, 1, true)
  dst.setUint16(22, channels, true)
  dst.setUint32(24, info.sampleRate, true)
  dst.setUint32(28, info.sampleRate * bytesPerFrame, true)
  dst.setUint16(32, bytesPerFrame, true)
  dst.setUint16(34, 16, true)
  put(36, 'data')
  dst.setUint32(40, dataSize, true)

  const samples = new Int16Array(target * channels)
  const copy = Math.min(target, available) * channels
  for (let n = 0; n < copy; n++) {
    samples[n] = clampInt16(src.getInt16(info.dataOffset + n * 2, true) * gain)
  }
  // Anything past `copy` is already 0 -- silence padding, not a wrapped loop.

  // The seam blend, ported from LoopSewing.cpp. coeff is exactly 1.0 at
  // i = 0, so the final frame BECOMES the first; it decays to 0 at the far
  // edge of the window on an equal-power curve. Per channel, because a
  // stereo stem's two sides meet themselves at their own values.
  if (target > LOOP_SEW_WINDOW_FRAMES * 2) {
    for (let ch = 0; ch < channels; ch++) {
      const first = samples[ch]
      for (let i = 0; i < LOOP_SEW_WINDOW_FRAMES; i++) {
        const index = (target - 1 - i) * channels + ch
        const t = -1 + (i / LOOP_SEW_WINDOW_FRAMES) * 2
        const coeff = Math.sqrt(0.5 * (1 - t))
        const value = samples[index]
        samples[index] = clampInt16(value + (first - value) * coeff)
      }
    }
  }

  for (let n = 0; n < samples.length; n++) dst.setInt16(44 + n * 2, samples[n], true)
  return out
}

function clampInt16(value: number): number {
  const rounded = Math.round(value)
  if (rounded > 32767) return 32767
  if (rounded < -32768) return -32768
  return rounded
}
