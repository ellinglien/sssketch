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
 * The seam blend itself, ported from LoopSewing.cpp and shared by both
 * JS-side callers: this file's loop trim (seam at the buffer's end, anchored
 * on frame 0) and rotateWav.ts's bake (seam in the MIDDLE of the file, where
 * the rotation put the original's end→start junction, anchored on the frame
 * just after it).
 *
 * Blends the `windowFrames` frames ENDING at `seamFrame - 1` toward the value
 * at `anchorFrame`, per channel: coeff is exactly 1.0 at the seam, so the last
 * frame before it BECOMES the anchor, decaying to 0 at the far edge of the
 * window on an equal-power curve. Equal-power rather than a linear fade to
 * silence so the perceived loudness stays constant through the blend instead
 * of dipping.
 *
 * Reads and writes go through callbacks because the two callers hold their
 * samples differently (a flat Int16Array here, a DataView over raw WAV bytes
 * there) — the curve, the window and the clamping live here once either way.
 *
 * No-op unless there is a clean, non-overlapping window of content before the
 * seam, mirroring LoopSewing.cpp's own guard. Since `seamFrame` is never more
 * than the total frame count, that also leaves any buffer shorter than twice
 * the window completely alone.
 */
export function blendSeamInt16(
  seamFrame: number,
  anchorFrame: number,
  numChannels: number,
  windowFrames: number,
  read: (frame: number, channel: number) => number,
  write: (frame: number, channel: number, value: number) => void
): void {
  if (windowFrames <= 0 || seamFrame <= windowFrames * 2) return
  for (let ch = 0; ch < numChannels; ch++) {
    // Read before writing: the guard above puts `anchorFrame` (either 0 or
    // `seamFrame` itself) outside the window this loop rewrites, so the
    // anchor can never be a value the blend already moved.
    const anchor = read(anchorFrame, ch)
    for (let i = 0; i < windowFrames; i++) {
      const frame = seamFrame - 1 - i
      const t = -1 + (i / windowFrames) * 2
      const coeff = Math.sqrt(0.5 * (1 - t))
      const value = read(frame, ch)
      write(frame, ch, clampInt16(value + (anchor - value) * coeff))
    }
  }
}

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

  // The seam here is the buffer's own end wrapping back onto its own head,
  // so the anchor is frame 0. Per channel, because a stereo stem's two sides
  // meet themselves at their own values.
  blendSeamInt16(
    target,
    0,
    channels,
    LOOP_SEW_WINDOW_FRAMES,
    (frame, ch) => samples[frame * channels + ch],
    (frame, ch, value) => {
      samples[frame * channels + ch] = value
    }
  )

  for (let n = 0; n < samples.length; n++) dst.setInt16(44 + n * 2, samples[n], true)
  return out
}

function clampInt16(value: number): number {
  const rounded = Math.round(value)
  if (rounded > 32767) return 32767
  if (rounded < -32768) return -32768
  return rounded
}
