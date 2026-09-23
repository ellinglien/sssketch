import { computeBandEnergy, type BandEnergy } from '@shared/bandEnergy'
import { decodeStemFile } from './decodeStemFile'

const cache = new Map<string, Promise<BandEnergy>>()

/** Per-path band-energy cache, mirroring peakCache.ts's own shape and
 * eviction-on-rejection behavior — kept as a separate cache (not merged
 * into peakCache's own WaveformAnalysis) since this decodes and runs a
 * real FFT pass (via computeSpectrogram), a meaningfully heavier cost than
 * peaks/brightness's cheap bucket scan, and not every getPeaks caller
 * needs it. */
export function getBandEnergy(path: string): Promise<BandEnergy> {
  const cached = cache.get(path)
  if (cached) return cached

  const promise = (async () => {
    try {
      const audioBuffer = await decodeStemFile(path)
      return computeBandEnergy(audioBuffer.getChannelData(0), audioBuffer.sampleRate)
    } catch (err) {
      cache.delete(path)
      throw err
    }
  })()

  cache.set(path, promise)
  return promise
}

/** Forgets this path's band energy -- see peakCache.ts's evictWaveform for
 * why an in-place rewrite is the one case that needs this. */
export function evictBandEnergy(path: string): void {
  cache.delete(path)
}
