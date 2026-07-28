import { findWavChunks } from './wavChunks'

/**
 * Rotates a WAV's audio payload so the frames before `rotationFrames` move to the
 * end — used to permanently bake a beat-picker correction into the file itself
 * (rather than only shifting playback timing). Total file size and every
 * non-audio byte are unchanged; only the data chunk's frame order is rearranged,
 * and always at frame boundaries so multi-channel audio never desyncs between
 * channels.
 */
export function rotateWavFrames(bytes: Uint8Array, rotationFrames: number): Uint8Array {
  const { dataOffset, dataSize, numChannels, bitsPerSample } = findWavChunks(bytes)
  const frameSize = numChannels * (bitsPerSample / 8)
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
  return out
}
