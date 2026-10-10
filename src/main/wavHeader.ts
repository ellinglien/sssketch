// A WAV's format and data size from its header (the first 64 KB) and its size on disk, read with
// fs/promises: checking a render never reads a whole float file on the main thread (the library
// is often on a slow USB drive; AGENTS.md section 6).
import { open } from 'node:fs/promises'
import { findWavChunks } from '@shared/wavChunks'

const HEADER_BYTES = 64 * 1024

export interface WavHeader {
  audioFormat: number
  bitsPerSample: number
  sampleRate: number
  numChannels: number
  /** Bytes of audio, as declared, bounded by what the file holds. */
  dataSize: number
}

/** Throws `missing` for a file that is absent or empty. */
export async function readWavHeader(path: string, missing: string): Promise<WavHeader> {
  let handle: Awaited<ReturnType<typeof open>>
  try {
    handle = await open(path, 'r')
  } catch {
    throw new Error(missing)
  }
  try {
    const size = (await handle.stat()).size
    if (size === 0) throw new Error(missing)
    const head = Buffer.alloc(Math.min(size, HEADER_BYTES))
    await handle.read(head, 0, head.length, 0)
    const wav = findWavChunks(new Uint8Array(head.buffer, head.byteOffset, head.length))
    const base = {
      audioFormat: wav.audioFormat,
      bitsPerSample: wav.bitsPerSample,
      sampleRate: wav.sampleRate,
      numChannels: wav.numChannels
    }
    if (wav.dataOffset < 8) return { ...base, dataSize: 0 }
    // The header read is clamped: take the size the data chunk declares, bounded by the file.
    const declared = head.readUInt32LE(wav.dataOffset - 4)
    return { ...base, dataSize: Math.min(declared, Math.max(0, size - wav.dataOffset)) }
  } finally {
    await handle.close()
  }
}

export async function wavDurationSeconds(path: string): Promise<number> {
  const wav = await readWavHeader(path, `WAV is missing: ${path}`)
  const bytesPerSecond = wav.sampleRate * wav.numChannels * (wav.bitsPerSample / 8)
  if (!bytesPerSecond) throw new Error('WAV missing a valid fmt chunk')
  return wav.dataSize / bytesPerSecond
}
