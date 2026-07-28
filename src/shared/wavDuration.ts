import { findWavChunks } from './wavChunks'

export function readWavDurationSeconds(bytes: Uint8Array): number {
  const { dataSize, sampleRate, numChannels, bitsPerSample } = findWavChunks(bytes)
  const bytesPerSecond = sampleRate * numChannels * (bitsPerSample / 8)
  if (!bytesPerSecond) throw new Error('WAV missing a valid fmt chunk')
  return dataSize / bytesPerSecond
}
