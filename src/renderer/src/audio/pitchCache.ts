import { computePitchContour, type PitchContour } from '@shared/pitchContour'
import { getAudioContext } from './peakCache'

const cache = new Map<string, Promise<PitchContour>>()

/** Per-path pitch-contour cache, mirroring peakCache.ts's own shape and
 * eviction-on-rejection behavior. Kept separate from bandEnergyCache.ts
 * (a different real FFT-based analysis, computePitchContour's own
 * autocorrelation pass rather than computeSpectrogram's) even though both
 * are "new cost" tiers — same reasoning as keeping BeatPicker.tsx's own
 * spectrogram and pitch computations as two separate calls rather than one
 * merged pass. */
export function getPitchContour(path: string): Promise<PitchContour> {
  const cached = cache.get(path)
  if (cached) return cached

  const promise = (async () => {
    try {
      const bytes = await window.rifffApi.readAudioFile(path)
      const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      const audioBuffer = await getAudioContext().decodeAudioData(arrayBuffer as ArrayBuffer)
      return computePitchContour(audioBuffer.getChannelData(0), audioBuffer.sampleRate)
    } catch (err) {
      cache.delete(path)
      throw err
    }
  })()

  cache.set(path, promise)
  return promise
}
