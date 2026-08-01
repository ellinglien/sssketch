import { computeBandEnergy, type BandEnergy } from '@shared/bandEnergy'
import { getAudioContext } from './peakCache'

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
      const bytes = await window.rifffApi.readAudioFile(path)
      const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      const audioBuffer = await getAudioContext().decodeAudioData(arrayBuffer as ArrayBuffer)
      return computeBandEnergy(audioBuffer.getChannelData(0), audioBuffer.sampleRate)
    } catch (err) {
      cache.delete(path)
      throw err
    }
  })()

  cache.set(path, promise)
  return promise
}
