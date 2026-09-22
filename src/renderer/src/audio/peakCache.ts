import { peaksFromChannel, zcrFromChannel } from '@shared/visuals'
import { countWork } from '../perf/workCounters'
import { queueStemAnalysisWrite } from './analysisWriteQueue'

export interface WaveformAnalysis {
  peaks: number[]
  /** Per-bucket zero-crossing-rate brightness (see zcrFromChannel) — same
   * 128-bucket resolution as peaks, computed from the same decode so a
   * consumer wanting both (e.g. Waveform.tsx's brightness treatment)
   * doesn't pay for a second read+decode of the same file. */
  brightness: number[]
}

const cache = new Map<string, Promise<WaveformAnalysis>>()
// Populated once a cache entry's own promise actually SETTLES (success
// only -- see getAnalysis below) -- lets a fresh <Waveform> mount for an
// already-decoded path initialize its state synchronously instead of
// rendering null for its own first frame while re-awaiting a promise
// that's already resolved. Direct report, 2026-09-17 ("i still notice
// some blinking when loading"): DiscoverPanel.tsx's own index-keyed-tiles
// fix (see its own tile-mapping comment) stopped a re-tile from
// discarding/remounting ALREADY-SHOWN tiles when the shared loop-length
// reference grows as more slots resolve -- but a genuinely NEW tile
// index (one more repeat of the SAME stem, now needed to fill the longer
// loop) still mounts a brand new <Waveform> instance, and even a cache
// HIT only resolves on the next microtask (a Promise's own .then never
// runs synchronously) -- so that new instance's very first paint was
// still a blank frame regardless of the underlying data being ready
// immediately. peekPeaks/peekBrightness below close that last gap.
const settled = new Map<string, WaveformAnalysis>()
let sharedContext: AudioContext | null = null

function getContext(): AudioContext {
  if (!sharedContext) sharedContext = new AudioContext()
  return sharedContext
}

function getAnalysis(path: string): Promise<WaveformAnalysis> {
  const cached = cache.get(path)
  if (cached) return cached

  const promise = (async () => {
    try {
      // Persistent, cross-session cache first (stemPeaksCacheStore.ts, via
      // IPC) -- direct request, 2026-09-21 ("can prep work for the audio-
      // resolve step be done in advance, clustered with overall scans?
      // ... lets do it.... to make it all snappy"): the background
      // feature scan (BackgroundFeatureScan.tsx, via getStemFeatures'
      // own getBrightness call) already decodes every stem it visits --
      // this just gives that decode somewhere durable to land, mirroring
      // stemFeaturesCache.ts's own exact "persisted cache first, else
      // decode+persist" pattern. Returns null both for "never scanned"
      // and "not a real library stem," same as that function's own
      // doc comment -- either way, fall through to decoding fresh below.
      countWork('ipc:get-stem-peaks-cache')
      const persisted = await window.rifffApi.getStemPeaksCache(path)
      if (persisted) {
        settled.set(path, persisted)
        return persisted
      }

      countWork('ipc:read-audio-file')
      const bytes = await window.rifffApi.readAudioFile(path)
      // Defensive copy: bytes.buffer may be a larger backing ArrayBuffer than the
      // Uint8Array's own view (e.g. depending on how it was reconstituted across the
      // IPC boundary), so slice out exactly this view's byte range rather than
      // handing decodeAudioData the raw (possibly oversized) backing buffer.
      const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      countWork('decode')
      const audioBuffer = await getContext().decodeAudioData(arrayBuffer as ArrayBuffer)
      const result = waveformFromBuffer(audioBuffer)
      settled.set(path, result)
      // Fire-and-forget -- a real library stem's path persists for next
      // session (this session's own renderer-memory `cache`/`settled`
      // above already cover repeat calls within THIS session regardless
      // of whether this write succeeds); a non-library path is silently
      // skipped by the main-process side (see stemPeaksCacheStore.ts).
      countWork('ipc:set-stem-peaks-cache')
      void window.rifffApi.setStemPeaksCache(path, result)
      return result
    } catch (err) {
      // Don't let a transient failure (mid-copy read, permission hiccup, corrupt
      // file) permanently blacklist this path — evict so a future call retries
      // instead of reusing a forever-rejected promise.
      cache.delete(path)
      throw err
    }
  })()

  cache.set(path, promise)
  return promise
}

/** Peaks + zero-crossing brightness (128 buckets each) from an already
 * decoded buffer -- the one function that produces a WaveformAnalysis,
 * shared by this module's own decode and analyzeStemOnce.ts's single
 * decode. */
export function waveformFromBuffer(audioBuffer: AudioBuffer): WaveformAnalysis {
  const channel = audioBuffer.getChannelData(0)
  return {
    peaks: peaksFromChannel(channel, 128),
    brightness: zcrFromChannel(channel, 128)
  }
}

/** Installs a WaveformAnalysis computed elsewhere (analyzeStemOnce.ts) as
 * this path's entry, so getPeaks/getBrightness/peek* share it -- including
 * while it's still in flight, so an interactive call mid-analysis never
 * starts a second decode. Returns the installed promise, or null (nothing
 * installed) when the path already has an entry. Same eviction-on-
 * rejection as getAnalysis; `persist` also writes the result to the
 * persisted cache on success (same row as a fresh decode here, via the
 * ambient scans' batched write queue). */
export function adoptWaveformAnalysis(
  path: string,
  analysis: Promise<WaveformAnalysis>,
  { persist }: { persist: boolean }
): Promise<WaveformAnalysis> | null {
  if (cache.has(path)) return null
  const promise = analysis.then(
    (result) => {
      settled.set(path, result)
      // Batched with the stem's other writes (analysisWriteQueue.ts, B7).
      if (persist) {
        queueStemAnalysisWrite(path, {
          peaks: { peaks: result.peaks, brightness: result.brightness }
        })
      }
      return result
    },
    (err: unknown) => {
      if (cache.get(path) === promise) cache.delete(path)
      throw err
    }
  )
  cache.set(path, promise)
  return promise
}

/** True when this path already has an in-memory entry (settled or in
 * flight). */
export function hasWaveformEntry(path: string): boolean {
  return cache.has(path)
}

export function getPeaks(path: string): Promise<number[]> {
  return getAnalysis(path).then((a) => a.peaks)
}

/** Per-bucket "how much high-frequency content is here" — see
 * zcrFromChannel's own doc comment. Used by Waveform.tsx's brightness
 * treatment to make hi-hats/transients read brighter than sustained bass,
 * without a second decode of the same file getPeaks already triggered. */
export function getBrightness(path: string): Promise<number[]> {
  return getAnalysis(path).then((a) => a.brightness)
}

export function getAudioContext(): AudioContext {
  return getContext()
}

/** Synchronous peek at an already-decoded path's peaks, if any -- null if
 * nothing has resolved for this path yet (still in flight, never
 * requested, or failed). See `settled`'s own doc comment above for why
 * this exists: a lazy useState initializer in Waveform.tsx that can skip
 * the "renders null until the next microtask" gap entirely for a path
 * some OTHER instance already decoded. */
export function peekPeaks(path: string): number[] | null {
  return settled.get(path)?.peaks ?? null
}

/** Brightness counterpart to peekPeaks -- see its own doc comment. */
export function peekBrightness(path: string): number[] | null {
  return settled.get(path)?.brightness ?? null
}
