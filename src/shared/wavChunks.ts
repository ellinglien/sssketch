export interface WavChunkInfo {
  /** -1 if no 'data' chunk was found */
  dataOffset: number
  dataSize: number
  sampleRate: number
  numChannels: number
  bitsPerSample: number
}

/**
 * Walks a WAV file's RIFF chunks to locate the 'data' payload and 'fmt ' fields.
 * Shared by readWavDurationSeconds (just needs the sizes) and rotateWavFrames
 * (needs the actual byte range to rearrange) so the truncation/padding handling
 * — real Endlesss exports include odd-sized interstitial chunks — only lives once.
 */
export function findWavChunks(bytes: Uint8Array): WavChunkInfo {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const riff = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])
  if (riff !== 'RIFF') throw new Error('not a RIFF/WAV file')

  let offset = 12 // skip 'RIFF' size 'WAVE'
  let sampleRate = 0
  let numChannels = 0
  let bitsPerSample = 0
  let dataOffset = -1
  let dataSize = 0

  while (offset + 8 <= bytes.length) {
    const chunkId = String.fromCharCode(
      bytes[offset],
      bytes[offset + 1],
      bytes[offset + 2],
      bytes[offset + 3]
    )
    const chunkSize = view.getUint32(offset + 4, true)
    const bodyOffset = offset + 8
    const bytesAvailable = bytes.length - bodyOffset

    if (chunkId === 'data') {
      // A file that's truncated mid-write (or still being copied when scanned) can
      // declare a data size larger than the bytes actually present. Clamp to what's
      // really there so callers see a correct (short) size instead of a
      // plausible-looking but fabricated one.
      dataOffset = bodyOffset
      dataSize = Math.min(chunkSize, Math.max(0, bytesAvailable))
    } else {
      // Every other chunk (fmt, JUNK/LIST padding chunks, etc.) is expected to be
      // fully present. Check bounds *before* reading any of its body so a truncated
      // file fails with our own descriptive error instead of a low-level DataView
      // RangeError.
      if (chunkSize > bytesAvailable) {
        throw new Error(`WAV file is truncated inside the '${chunkId}' chunk`)
      }
      if (chunkId === 'fmt ') {
        if (chunkSize < 16) throw new Error('WAV fmt chunk is smaller than expected')
        numChannels = view.getUint16(bodyOffset + 2, true)
        sampleRate = view.getUint32(bodyOffset + 4, true)
        bitsPerSample = view.getUint16(bodyOffset + 14, true)
      }
    }
    offset = bodyOffset + chunkSize + (chunkSize % 2)
  }

  return { dataOffset, dataSize, sampleRate, numChannels, bitsPerSample }
}
