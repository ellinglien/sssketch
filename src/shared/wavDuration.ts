export function readWavDurationSeconds(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const riff = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])
  if (riff !== 'RIFF') throw new Error('not a RIFF/WAV file')

  let offset = 12 // skip 'RIFF' size 'WAVE'
  let sampleRate = 0
  let numChannels = 0
  let bitsPerSample = 0
  let dataBytes = 0

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
      // really there so we return a correct (short) duration instead of a
      // plausible-looking but fabricated one.
      dataBytes = Math.min(chunkSize, Math.max(0, bytesAvailable))
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

  const bytesPerSecond = sampleRate * numChannels * (bitsPerSample / 8)
  if (!bytesPerSecond) throw new Error('WAV missing a valid fmt chunk')
  return dataBytes / bytesPerSecond
}
