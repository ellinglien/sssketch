// src/renderer/src/audio/stemAnalysisClient.ts
//
// Lazily owns the single stemAnalysisWorker.ts instance and wraps its
// message protocol in a promise -- same shape as yamnetClient.ts (request
// ids, crash recovery). Direct report, 2026-09-21: feature extraction used
// to run on the renderer's main thread and froze input during background
// scans; this moves it off.
import { analyzeStemSamples, type StemAnalysis } from '@shared/stemAnalysis'
import { computePitchContour, type PitchContour } from '@shared/pitchContour'
import { stemLevelFeatures, type StemLevel } from '@shared/stemLevel'
import { countWork } from '../perf/workCounters'

let worker: Worker | null = null
let nextRequestId = 0
const pending = new Map<
  number,
  { resolve: (payload: unknown) => void; reject: (err: Error) => void }
>()

type OutMessage =
  | { type: 'result'; requestId: number; payload: unknown }
  | { type: 'error'; requestId: number; message: string }

function getWorker(): Worker {
  if (worker) return worker
  const w = new Worker(new URL('./stemAnalysisWorker.ts', import.meta.url), { type: 'module' })
  w.onmessage = (event: MessageEvent<OutMessage>) => {
    const msg = event.data
    const entry = pending.get(msg.requestId)
    pending.delete(msg.requestId)
    if (!entry) return
    if (msg.type === 'result') entry.resolve(msg.payload)
    else entry.reject(new Error(msg.message))
  }
  // A real crash never posts back for in-flight requests -- reject them so
  // callers (whose caches evict on rejection) can retry, and drop this
  // worker so the next call starts a fresh one. Identity-guarded, same
  // reasoning as yamnetClient.ts's own onerror.
  w.onerror = (event: ErrorEvent) => {
    const err = new Error(`stemAnalysisClient: worker crashed: ${event.message}`)
    for (const p of pending.values()) p.reject(err)
    pending.clear()
    if (worker === w) worker = null
  }
  worker = w
  return w
}

function request<T>(
  kind: 'full' | 'pitch' | 'level',
  samples: Float32Array,
  sampleRate: number,
  extraChannels?: readonly Float32Array[]
): Promise<T> {
  const requestId = nextRequestId++
  // COPIED before transfer -- callers usually pass an AudioBuffer's own
  // channel data, which must stay intact on this side. The other channels (the level pass) are
  // transient copies too.
  const copy = samples.slice()
  const extra = extraChannels?.map((c) => c.slice())
  return new Promise<T>((resolve, reject) => {
    pending.set(requestId, { resolve: resolve as (payload: unknown) => void, reject })
    getWorker().postMessage(
      { requestId, kind, samples: copy, sampleRate, ...(extra && { extraChannels: extra }) },
      [copy.buffer, ...(extra ?? []).map((c) => c.buffer)]
    )
  })
}

/** An AudioBuffer's channels after the first (the level pass reads every channel). */
export function channelsAfterFirst(buffer: AudioBuffer): Float32Array[] {
  const out: Float32Array[] = []
  for (let c = 1; c < buffer.numberOfChannels; c++) out.push(buffer.getChannelData(c))
  return out
}

/** analyzeStemSamples, off the main thread. Falls back to running inline
 * where no Worker exists (vitest), so callers don't need two code paths. */
export function analyzeStemSamplesOffThread(
  samples: Float32Array,
  sampleRate: number,
  extraChannels?: readonly Float32Array[]
): Promise<StemAnalysis> {
  countWork('analysis')
  if (typeof Worker === 'undefined') {
    return Promise.resolve(analyzeStemSamples(samples, sampleRate, extraChannels))
  }
  return request<StemAnalysis>('full', samples, sampleRate, extraChannels)
}

/** The level pass alone (@shared/stemLevel), off the main thread -- the backfill of a stem whose
 * feature row is current (analyzeStemOnce's needs.level). Same inline fallback. */
export function measureStemLevelOffThread(
  channels: readonly Float32Array[],
  sampleRate: number
): Promise<StemLevel> {
  countWork('analysis:level')
  if (channels.length === 0) return Promise.resolve(stemLevelFeatures([], sampleRate))
  if (typeof Worker === 'undefined') {
    return Promise.resolve(stemLevelFeatures(channels, sampleRate))
  }
  return request<StemLevel>('level', channels[0], sampleRate, channels.slice(1))
}

/** computePitchContour, off the main thread -- pitchCache.ts's own path
 * (Waveform/PolarGlyph pitch overlays). Same inline fallback. */
export function computePitchContourOffThread(
  samples: Float32Array,
  sampleRate: number
): Promise<PitchContour> {
  countWork('analysis:pitch')
  if (typeof Worker === 'undefined') {
    return Promise.resolve(computePitchContour(samples, sampleRate))
  }
  return request<PitchContour>('pitch', samples, sampleRate)
}
