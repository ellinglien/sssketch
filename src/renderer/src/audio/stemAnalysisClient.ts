// src/renderer/src/audio/stemAnalysisClient.ts
//
// Lazily owns the single stemAnalysisWorker.ts instance and wraps its
// message protocol in a promise -- same shape as yamnetClient.ts (request
// ids, crash recovery). Direct report, 2026-09-21: feature extraction used
// to run on the renderer's main thread and froze input during background
// scans; this moves it off.
import { analyzeStemSamples, type StemAnalysis } from '@shared/stemAnalysis'
import { computePitchContour, type PitchContour } from '@shared/pitchContour'
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

function request<T>(kind: 'full' | 'pitch', samples: Float32Array, sampleRate: number): Promise<T> {
  const requestId = nextRequestId++
  // COPIED before transfer -- callers usually pass an AudioBuffer's own
  // channel data, which must stay intact on this side.
  const copy = samples.slice()
  return new Promise<T>((resolve, reject) => {
    pending.set(requestId, { resolve: resolve as (payload: unknown) => void, reject })
    getWorker().postMessage({ requestId, kind, samples: copy, sampleRate }, [copy.buffer])
  })
}

/** analyzeStemSamples, off the main thread. Falls back to running inline
 * where no Worker exists (vitest), so callers don't need two code paths. */
export function analyzeStemSamplesOffThread(
  samples: Float32Array,
  sampleRate: number
): Promise<StemAnalysis> {
  countWork('analysis')
  if (typeof Worker === 'undefined') {
    return Promise.resolve(analyzeStemSamples(samples, sampleRate))
  }
  return request<StemAnalysis>('full', samples, sampleRate)
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
