// src/renderer/src/audio/decodeStemFile.ts
import { countWork } from '../perf/workCounters'
import { getAudioContext } from './peakCache'

/** Reads a stem's bytes over IPC and decodes them on the shared
 * AudioContext -- the one read+decode every per-stem analysis cache below
 * used to spell out inline. Counted (dev-only, perf/workCounters.ts) so the
 * number of decodes a scan really does is visible. */
export async function decodeStemFile(path: string): Promise<AudioBuffer> {
  countWork('ipc:read-audio-file')
  const bytes = await window.rifffApi.readAudioFile(path)
  // Defensive copy: bytes.buffer may be a larger backing ArrayBuffer than the
  // Uint8Array's own view, so slice out exactly this view's byte range.
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  countWork('decode')
  return getAudioContext().decodeAudioData(arrayBuffer as ArrayBuffer)
}
