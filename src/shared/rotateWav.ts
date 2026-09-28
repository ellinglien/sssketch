import { LOOP_SEW_WINDOW_FRAMES, blendSeamInt16 } from './loopSewPCM16'
import { findWavChunks, type WavChunkInfo } from './wavChunks'

export interface RotateWavOptions {
  /** Frames of equal-power blend to lay across the rotation seam. Defaults to
   * LOOP_SEW_WINDOW_FRAMES; pass 0 for a bit-exact, lossless rotation. */
  seamBlendFrames?: number
}

/**
 * Rotates a WAV's audio payload so the frames before `rotationFrames` move to the
 * end — used to permanently bake a beat-picker correction into the file itself
 * (rather than only shifting playback timing). Total file size and every
 * non-audio byte are unchanged; only the data chunk's frame order is rearranged,
 * and always at frame boundaries so multi-channel audio never desyncs between
 * channels.
 *
 * NOT BIT-EXACT BY DEFAULT — a deliberate change of contract, 2026-09-28.
 * Rotating moves the source's own end→start junction from the edges of the file
 * into the MIDDLE of it, as a hard splice. The engine's loop sewing cannot help:
 * that declicks the seam where a file's end wraps onto its own start at playback
 * time, and after a rotation the offending junction is interior. So nothing
 * smoothed it, and it was baked into the bytes — which is why Elling could see
 * it drawn in the waveform, not just hear it: "a few stems that cut off
 * awkwardly ... it seems to end abruptly at the end without trailing off ...
 * especially for longer phrases" (a long phrase is still decaying at its
 * original end, so the splice cuts it dead; a short percussive loop usually ends
 * near silence and hid this).
 *
 * The blend costs `seamBlendFrames` frames of exactness in one place in exchange
 * for a musical result, so any caller that genuinely needs the old bit-exact
 * rotation has to ask for it (`{ seamBlendFrames: 0 }`) rather than get it by
 * accident. bakeOffset.ts does exactly that on a RE-bake — see its own comment.
 *
 * 16-bit PCM only: a WAV of any other depth is rotated losslessly and left
 * unblended, same restriction sewLoopPCM16 already carries. Every WAV that
 * reaches this function is 16-bit in practice (Endlesss's own export format, and
 * what native-engine/Source/BakeStem.cpp writes).
 */
export function rotateWavFrames(
  bytes: Uint8Array,
  rotationFrames: number,
  options: RotateWavOptions = {}
): Uint8Array {
  const info = findWavChunks(bytes)
  const { dataOffset, dataSize } = info
  const frameSize = info.numChannels * (info.bitsPerSample / 8)
  if (dataOffset < 0 || frameSize === 0) return bytes.slice()

  const totalFrames = Math.floor(dataSize / frameSize)
  if (totalFrames === 0) return bytes.slice()

  const frames = ((Math.round(rotationFrames) % totalFrames) + totalFrames) % totalFrames
  if (frames === 0) return bytes.slice()

  const rotationBytes = frames * frameSize
  const out = bytes.slice()
  const data = bytes.subarray(dataOffset, dataOffset + dataSize)
  out.set(data.subarray(rotationBytes), dataOffset)
  out.set(data.subarray(0, rotationBytes), dataOffset + dataSize - rotationBytes)

  blendSeamInPlace(out, info, totalFrames - frames, options.seamBlendFrames)
  return out
}

/**
 * The seam blend on its own, for audio that was already rotated somewhere else
 * — specifically native-engine/Source/BakeStem.cpp, which decodes and rotates
 * Ogg Vorbis (LORE-sourced) stems that the byte-level rotation above cannot
 * touch, and writes a 16-bit WAV. It has the same interior-splice problem and
 * no blend of its own, and post-processing its output here fixes it without a
 * native-engine change. `rotationFrames` is the rotation that PRODUCED `bytes`,
 * so the seam can be located the same way rotateWavFrames locates it.
 */
export function blendRotatedWavSeam(
  bytes: Uint8Array,
  rotationFrames: number,
  seamBlendFrames = LOOP_SEW_WINDOW_FRAMES
): Uint8Array {
  const info = findWavChunks(bytes)
  const frameSize = info.numChannels * (info.bitsPerSample / 8)
  if (info.dataOffset < 0 || frameSize === 0) return bytes.slice()

  const totalFrames = Math.floor(info.dataSize / frameSize)
  if (totalFrames === 0) return bytes.slice()

  const frames = ((Math.round(rotationFrames) % totalFrames) + totalFrames) % totalFrames
  if (frames === 0) return bytes.slice()

  const out = bytes.slice()
  blendSeamInPlace(out, info, totalFrames - frames, seamBlendFrames)
  return out
}

/** `seamFrame` is where the source's own frame 0 landed after the rotation, so
 * the frame before it is the source's last frame: exactly the pair the engine's
 * loop sewing treats at playback, just relocated. Anchoring on `seamFrame`
 * itself therefore reproduces LoopSewing.cpp's behaviour at the point that
 * actually needs it. */
function blendSeamInPlace(
  out: Uint8Array,
  info: WavChunkInfo,
  seamFrame: number,
  seamBlendFrames: number | undefined
): void {
  const windowFrames = seamBlendFrames ?? LOOP_SEW_WINDOW_FRAMES
  if (windowFrames <= 0 || info.bitsPerSample !== 16) return
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength)
  const byteOf = (frame: number, ch: number): number =>
    info.dataOffset + (frame * info.numChannels + ch) * 2
  blendSeamInt16(
    seamFrame,
    seamFrame,
    info.numChannels,
    windowFrames,
    (frame, ch) => view.getInt16(byteOf(frame, ch), true),
    (frame, ch, value) => view.setInt16(byteOf(frame, ch), value, true)
  )
}
