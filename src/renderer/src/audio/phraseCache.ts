import {
  measurePhrasePeriod,
  phraseFramesFromChannel,
  type PhraseFrames
} from '@shared/phrasePeriod'
import type { StemPhraseReading } from '@shared/coachPhrase'
import { decodeStemFile } from './decodeStemFile'
import { countWork } from '../perf/workCounters'

/**
 * Per-path phrase-frame cache, mirroring peakCache.ts's own shape and
 * eviction-on-rejection behaviour.
 *
 * ONE decode produces BOTH series (the envelope and the brightness), the
 * same choice peakCache.ts makes for peaks and zero-crossing brightness and
 * for the same reason: the two are cheap derivations of one read, and
 * splitting them would pay for the file twice.
 *
 * Keyed by PATH and by path only. The bar count a stem is read AGAINST is
 * not part of the key -- PhraseFrames is a fixed PHRASE_FRAME_COUNT-long
 * reduction of the whole file, and measurePhrasePeriod works out the
 * bar-relative resolution itself. So a stem read at 8 bars and then at 4
 * costs one decode, not two, and the cache cannot be polluted by a stale
 * bar count.
 */
const cache = new Map<string, Promise<PhraseFrames>>()
const settled = new Map<string, PhraseFrames>()

export function getStemPhraseFrames(path: string): Promise<PhraseFrames> {
  const cached = cache.get(path)
  if (cached) return cached

  const promise = (async () => {
    try {
      const audioBuffer = await decodeStemFile(path)
      countWork('analysis:phrase')
      const frames = phraseFramesFromChannel(audioBuffer.getChannelData(0))
      settled.set(path, frames)
      return frames
    } catch (err) {
      // Don't let a transient failure (mid-copy read, permission hiccup,
      // corrupt file) permanently blacklist this path -- evict so a future
      // call retries instead of reusing a forever-rejected promise.
      cache.delete(path)
      throw err
    }
  })()

  cache.set(path, promise)
  return promise
}

/**
 * One stem's reading: its frames, and the verdict for the bar count it is
 * being read at. A REPORT -- nothing downstream of this resizes anything
 * because of it (see phrasePeriod.ts's own module doc).
 */
export async function getStemPhrase(path: string, nominalBars: number): Promise<StemPhraseReading> {
  const frames = await getStemPhraseFrames(path)
  return { path, nominalBars, verdict: measurePhrasePeriod(frames, nominalBars) }
}

/** Synchronous peek at an already-decoded path, if any -- null when nothing
 * has resolved for it yet (still in flight, never requested, or failed).
 * Same reason peekPeaks exists: a lazy initialiser can skip the "renders
 * nothing until the next microtask" gap for a path something else already
 * decoded. */
export function peekStemPhraseFrames(path: string): PhraseFrames | null {
  return settled.get(path) ?? null
}
