/// <reference lib="webworker" />
// src/renderer/src/audio/stemAnalysisWorker.ts
//
// Runs analyzeStemSamples (@shared/stemAnalysis) off the renderer's main
// thread -- see that module's own header for why (2026-09-21: background
// library scans froze typing/clicks). Receives already-decoded samples (the
// first channel, plus the others for the level pass) from
// stemAnalysisClient.ts; never decodes audio itself.
//
// Message protocol (plain structured-clone objects):
//   In:  { requestId, kind: 'full' | 'pitch' | 'level', samples: Float32Array, sampleRate,
//          extraChannels?: Float32Array[] }  -- the buffer's other channels, for the level pass
//   Out: { type: 'result', requestId, payload: StemAnalysis | PitchContour | StemLevel }
//        { type: 'error', requestId, message: string }
// Relative import (not the @shared alias) -- a worker is bundled as its own
// entry, and a relative path can't depend on alias config reaching it.
import { analyzeStemSamples } from '../../../shared/stemAnalysis'
import { computePitchContour } from '../../../shared/pitchContour'
import { stemLevelFeatures } from '../../../shared/stemLevel'

interface InMessage {
  requestId: number
  kind: 'full' | 'pitch' | 'level'
  samples: Float32Array
  sampleRate: number
  /** Channels after the first (spec 2026-10-05-radio-intensity-arc-design 7.2): 'full' measures
   * the level too when present; 'level' measures only that. */
  extraChannels?: Float32Array[]
}

self.onmessage = (event: MessageEvent<InMessage>) => {
  const { requestId, kind, samples, sampleRate, extraChannels } = event.data
  try {
    // Transfer, not copy -- the contour's backing buffer is freshly
    // allocated here and never read again on this side.
    if (kind === 'level') {
      const level = stemLevelFeatures([samples, ...(extraChannels ?? [])], sampleRate)
      postMessage({ type: 'result', requestId, payload: level })
    } else if (kind === 'pitch') {
      const contour = computePitchContour(samples, sampleRate)
      postMessage({ type: 'result', requestId, payload: contour }, [contour.freqHz.buffer])
    } else {
      const analysis = analyzeStemSamples(samples, sampleRate, extraChannels)
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
