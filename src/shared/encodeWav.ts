/**
 * Encodes planar Float32 channel data (the shape Web Audio's AudioBuffer exposes
 * via getChannelData) into a standard 16-bit PCM WAV file. All channels must be
 * the same length. Samples are clamped to [-1, 1] before quantizing, since an
 * offline render summing many sources can clip slightly above unity.
 */
export function encodeWavPCM16(channels: Float32Array[], sampleRate: number): Uint8Array {
  const numChannels = channels.length
  const numFrames = channels[0]?.length ?? 0
  const bytesPerSample = 2
  const blockAlign = numChannels * bytesPerSample
  const dataSize = numFrames * blockAlign

  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  function writeString(offset: number, s: string): void {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i))
  }

  writeString(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true) // fmt chunk size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true) // byte rate
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true) // bits per sample
  writeString(36, 'data')
  view.setUint32(40, dataSize, true)

  let offset = 44
  for (let frame = 0; frame < numFrames; frame++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channels[ch][frame]))
      view.setInt16(offset, Math.round(sample * (sample < 0 ? 0x8000 : 0x7fff)), true)
      offset += 2
    }
  }

  return new Uint8Array(buffer)
}
