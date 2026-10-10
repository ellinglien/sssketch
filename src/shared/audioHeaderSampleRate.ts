import { findWavChunks } from './wavChunks'

/** \x01vorbis: the start of an Ogg Vorbis identification packet. */
const VORBIS_ID = [0x01, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73]
/** The identification packet sits in the first page; it never needs a long search. */
const OGG_SEARCH_BYTES = 512

/** The sample rate a source decodes at, read from the first bytes of the file only, so a
 * re-oned copy's recipe (src/main/reonedRecipe.ts) can name its rotation in samples before any
 * audio is decoded. WAV (an import), Ogg Vorbis (a LORE stem, path with no extension) and FLAC.
 * null for anything else: the recipe then keys the rotation in seconds instead. */
export function sampleRateFromHeader(bytes: Uint8Array): number | null {
  if (bytes.length < 12) return null
  const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])
  if (tag === 'RIFF') {
    try {
      // findWavChunks clamps a data chunk that runs past the bytes it was given, so a header
      // read is enough; it throws only on a truncated fmt (or other non-data) chunk.
      return findWavChunks(bytes).sampleRate || null
    } catch {
      return null
    }
  }
  if (tag === 'OggS') {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const last = Math.min(bytes.length - 16, OGG_SEARCH_BYTES)
    for (let i = 0; i <= last; i++) {
      if (VORBIS_ID.every((value, k) => bytes[i + k] === value)) {
        const rate = view.getUint32(i + 12, true)
        return rate > 0 ? rate : null
      }
    }
    return null
  }
  if (tag === 'fLaC' && bytes.length >= 21) {
    const rate = (bytes[18] << 12) | (bytes[19] << 4) | (bytes[20] >> 4)
    return rate > 0 ? rate : null
  }
  return null
}
