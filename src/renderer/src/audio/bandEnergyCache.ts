import { computeBandEnergy } from '@shared/bandEnergy'
import { glyphBandsFrom, type GlyphBands } from '@shared/glyphBands'
import { decodeStemFile } from './decodeStemFile'
import { countWork } from '../perf/workCounters'
import { readPersistedStemGlyph, writePersistedStemGlyph } from './stemGlyphCache'
import { createPrimedEntries } from './primedEntries'

const cache = new Map<string, Promise<GlyphBands>>()
/** Primed bands are bounded (primedEntries.ts); requested ones are not. */
const primed = createPrimedEntries((path) => cache.delete(path))

/** Caches `promise` for `path`, evicting it on rejection so a later call
 * retries (only if it's still the cached entry). */
function remember(path: string, promise: Promise<GlyphBands>): Promise<GlyphBands> {
  cache.set(path, promise)
  promise.catch(() => {
    if (cache.get(path) === promise) {
      cache.delete(path)
      primed.forget(path)
    }
  })
  return promise
}

/** Per-path glyph rings (bass/mid/treble at the 16 points PolarGlyph draws,
 * @shared/glyphBands), mirroring peakCache.ts's own shape and
 * eviction-on-rejection behavior. Kept separate from peakCache's own
 * WaveformAnalysis since computing it runs a real FFT pass (via
 * computeSpectrogram), a meaningfully heavier cost than peaks/brightness's
 * cheap bucket scan, and not every getPeaks caller needs it.
 *
 * Order (plan 2026-10-05-merge-background-scans T9): this session's entry
 * (computed, or primed by stemFeaturesCache.ts from its own analysis); then
 * the persisted row (stemGlyphCache.ts, one IPC shared with pitchCache.ts);
 * only then a decode + band pass, whose result is persisted for next time. */
export function getGlyphBands(path: string): Promise<GlyphBands> {
  const cached = cache.get(path)
  if (cached) {
    primed.promote(path)
    return cached
  }

  return remember(
    path,
    (async () => {
      const persisted = await readPersistedStemGlyph(path)
      if (persisted?.bands) return persisted.bands
      const audioBuffer = await decodeStemFile(path)
      countWork('analysis:band-energy')
      const bands = glyphBandsFrom(
        computeBandEnergy(audioBuffer.getChannelData(0), audioBuffer.sampleRate)
      )
      writePersistedStemGlyph(path, { bands })
      return bands
    })()
  )
}

/** Seeds the cache with bands computed elsewhere -- stemFeaturesCache.ts
 * gets them for free from its own full analysis (StemAnalysis.glyphBands),
 * so a stem the background scan already analyzed never pays a second decode
 * + FFT here. Not persisted (see writePersistedStemGlyph), and bounded like
 * pitchCache.ts's primes (primedEntries.ts). A path that's already cached
 * (or in flight) is left alone. */
export function primeGlyphBands(path: string, bands: GlyphBands): void {
  if (cache.has(path)) return
  cache.set(path, Promise.resolve(bands))
  primed.add(path)
}

/** Forgets this path's glyph bands -- see peakCache.ts's evictWaveform for
 * why an in-place rewrite is the one case that needs this. (The persisted
 * row needs nothing: a rewritten file's size:mtimeMs stamp no longer
 * matches it.) */
export function evictBandEnergy(path: string): void {
  cache.delete(path)
  primed.forget(path)
}
