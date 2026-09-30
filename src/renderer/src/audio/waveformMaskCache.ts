import { waveformMaskDataUrl } from '@shared/waveformMaskSvg'
import { getBrightness, getPeaks, peekPeaks, peekBrightness } from './peakCache'

// Path-keyed, like the other analysis caches here (CLAUDE.md "Analysis
// caches"): a stem's mask SVG (waveformMaskSvg.ts) is built once from its
// peaks + brightness and reused by every Discover row showing it. A data:
// URL rather than a Blob object URL, so eviction never has to revoke a URL
// a still-mounted row might be painting with. Only successes are stored --
// a failed decode leaves nothing here, and peakCache itself already evicts
// on rejection, so the next ask retries.
const masks = new Map<string, string>()

/** The mask URL if this path's peaks are already decoded, else null --
 * synchronous, so a fresh row mount paints on its first frame when the
 * peaks are warm (the same gap peekPeaks closes for <Waveform>). */
export function peekWaveformMask(path: string): string | null {
  const hit = masks.get(path)
  if (hit) return hit
  const peaks = peekPeaks(path)
  const brightness = peekBrightness(path)
  if (!peaks || !brightness) return null
  const url = waveformMaskDataUrl(peaks, brightness)
  masks.set(path, url)
  return url
}

export async function getWaveformMask(path: string): Promise<string> {
  const hit = peekWaveformMask(path)
  if (hit) return hit
  const [peaks, brightness] = await Promise.all([getPeaks(path), getBrightness(path)])
  const url = waveformMaskDataUrl(peaks, brightness)
  masks.set(path, url)
  return url
}

/** Called alongside evictWaveform (evictStemAnalysis.ts), so a re-baked
 * stem's next mount rebuilds its mask from the new peaks. */
export function evictWaveformMask(path: string): void {
  masks.delete(path)
}
