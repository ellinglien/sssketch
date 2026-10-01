// src/renderer/src/audio/decodeStemFile.ts
import { countWork } from '../perf/workCounters'
import { getAudioContext } from './peakCache'
import { StemNotDownloadedError } from '@shared/stemNotDownloaded'

/** Decodes in flight right now, keyed by path -- NOT a buffer cache.
 *
 * Every per-stem analysis cache in this folder keeps its own small derived
 * result (peaks, a pitch contour, band energies) and drops the AudioBuffer,
 * which is right: a buffer is megabytes and the derived arrays are
 * kilobytes. What none of them did was notice that the OTHERS were
 * decoding the same file at the same moment -- a stem appearing in the UI
 * with a pitch line and a glyph cost peakCache + pitchCache +
 * bandEnergyCache + phraseCache, four independent read+copy+decode passes
 * of one file, every one of them live simultaneously.
 *
 * Measured 2026-09-28: the renderer reached a 4GB heap and died of
 * "Ineffective mark-compacts near heap limit" after seven minutes, with
 * ~1s mark-compact pauses on the way up. The allocation rate, not any
 * single retained structure, is what the collector could not outrun.
 *
 * Entries are dropped the moment the decode settles, so this shares work
 * between overlapping callers and retains nothing afterwards. Two calls
 * far apart in time still decode twice, deliberately. */
const inFlight = new Map<string, Promise<AudioBuffer>>()

/** Reads a stem's bytes over IPC and decodes them on the shared
 * AudioContext -- the one read+decode every per-stem analysis cache below
 * used to spell out inline. Counted (dev-only, perf/workCounters.ts) so the
 * number of decodes a scan really does is visible. Concurrent callers for
 * the same path share one read and one decode (see `inFlight` above). */
export function decodeStemFile(path: string): Promise<AudioBuffer> {
  const sharing = inFlight.get(path)
  if (sharing) {
    countWork('decode:shared')
    return sharing
  }

  const promise = (async () => {
    countWork('ipc:read-audio-file')
    const bytes = await window.rifffApi.readAudioFile(path)
    // A 0-byte placeholder (an unfinished LORE download, 2026-10-01) is a
    // stem not downloaded yet: say so, rather than let decodeAudioData
    // throw "EncodingError: Unable to decode audio data".
    if (bytes.byteLength === 0) throw new StemNotDownloadedError(path)
    // bytes.buffer may be a LARGER backing ArrayBuffer than this view, so
    // the range has to be exact -- but slicing when the view already
    // spans the whole buffer just doubles a multi-megabyte allocation for
    // nothing, and both copies then sit in the heap until the next
    // collection. Only copy when the view really is a window onto
    // something bigger.
    //
    // Handing the original over is safe precisely because
    // decodeAudioData DETACHES it: `bytes` is a fresh IPC result with no
    // other reader, and detaching releases the bytes promptly instead of
    // keeping a second copy alive alongside the decoded buffer.
    const spansWholeBuffer = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    const arrayBuffer = spansWholeBuffer
      ? bytes.buffer
      : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    countWork('decode')
    return getAudioContext().decodeAudioData(arrayBuffer as ArrayBuffer)
  })()

  inFlight.set(path, promise)
  // Released on BOTH paths, and only if this is still the entry -- a
  // failure must not strand the path (the next caller has to be able to
  // retry), and a success must not retain the buffer.
  const forget = (): void => {
    if (inFlight.get(path) === promise) inFlight.delete(path)
  }
  promise.then(forget, forget)
  return promise
}
