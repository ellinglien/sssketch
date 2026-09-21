/// <reference lib="webworker" />
// src/renderer/src/audio/stemAnalysisWorker.ts
//
// Runs analyzeStemSamples (@shared/stemAnalysis) off the renderer's main
// thread -- see that module's own header for why (2026-09-21: background
// library scans froze typing/clicks). Receives already-decoded mono samples
// from stemAnalysisClient.ts; never decodes audio itself.
//
// Message protocol (plain structured-clone objects):
//   In:  { requestId, kind: 'full' | 'pitch', samples: Float32Array, sampleRate }
//   Out: { type: 'result', requestId, payload: StemAnalysis | PitchContour }
//        { type: 'error', requestId, message: string }
// Relative import (not the @shared alias) -- a worker is bundled as its own
// entry, and a relative path can't depend on alias config reaching it.
import { analyzeStemSamples } from '../../../shared/stemAnalysis'
import { computePitchContour } from '../../../shared/pitchContour'

interface InMessage {
  requestId: number
  kind: 'full' | 'pitch'
  samples: Float32Array
  sampleRate: number
}

self.onmessage = (event: MessageEvent<InMessage>) => {
  const { requestId, kind, samples, sampleRate } = event.data
  try {
    // Transfer, not copy -- the contour's backing buffer is freshly
    // allocated here and never read again on this side.
    if (kind === 'pitch') {
      const contour = computePitchContour(samples, sampleRate)
      postMessage({ type: 'result', requestId, payload: contour }, [contour.freqHz.buffer])
    } else {
      const analysis = analyzeStemSamples(samples, sampleRate)
      postMessage({ type: 'result', requestId, payload: analysis }, [
        analysis.pitchContour.freqHz.buffer
      ])
    }
  } catch (err) {
    postMessage({
      type: 'error',
      requestId,
      message: err instanceof Error ? err.message : String(err)
    })
  }
}
