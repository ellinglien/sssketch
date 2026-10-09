// The Discover candidate -> local stem resolver, shared by DiscoverPanel and DiscoverSlotRow (moved verbatim from DiscoverPanel.tsx, radio view plan Task 4).
import { instrumentMaskToSoundType } from '@shared/riffLibraryTypes'
import { guessSoundTypeFromPresetName } from '@shared/presetNames'
import { type SoundType } from '@shared/types'
import type { DiscoverCandidate } from '../../../main/discoverCandidates'

export interface ResolvedCandidateStem {
  author: string
  name: string
  type: SoundType
  path: string
  durationSec: number
  barLength: number
  phaseSourcePath?: string
  phaseBars?: number
  /** The owning riff's own creation time (RiffLibraryResolvedRiff.
   * creationTime, Unix seconds) -- see @shared/types's Stem.creationTime
   * doc comment. Undefined only if the resolved riff itself predates this
   * field (the live Endlesss API path). */
  creationTime?: number
}

// Speed: DiscoverSlotRow's own preview resolve effect and resolveDiscoverRifff
// (called from both addToTimeline and addToShelf) both call resolveCandidateStem
// for the SAME candidate -- a row resolves it once already just to show its
// waveform, then resolveDiscoverRifff re-resolves the identical riffCID/stemCID
// from scratch (a real IPC round trip PLUS, often, the exact download
// riffLibraryDownloadMissingStems just did moments earlier). Cached by promise
// (not just by settled result), same "cache the in-flight promise itself"
// convention peakCache.ts already established -- this also dedupes two
// callers that happen to ask for the same candidate concurrently (row
// preview + a fast add-to-timeline/add-to-shelf click) into one
// real request instead of two. Evicted on a null (failed) result, same
// "don't let a transient failure permanently poison the cache" reasoning
// peakCache.ts's own eviction-on-rejection uses -- resolveCandidateStem
// itself never throws (see its own doc comment), so eviction keys off a
// null return here instead of a caught rejection.
const resolvedCandidateCache = new Map<string, Promise<ResolvedCandidateStem | null>>()
/** The SETTLED half of resolvedCandidateCache, readable without an await.
 *
 * A promise can only be read a microtask later, so a row whose candidate
 * had been resolved a whole interval ago (radio's armRadioPick warms it)
 * still drew its "resolving" placeholder for the first render after the
 * commit, and the new waveform arrived one resolve later -- 20 to 150ms
 * behind a swap the engine had already made on the beat. Same keys, same
 * lifetime: written when the promise settles non-null, dropped with it. */
const settledCandidateStems = new Map<string, ResolvedCandidateStem>()

export function peekResolvedCandidateStem(
  candidate: DiscoverCandidate
): ResolvedCandidateStem | null {
  return settledCandidateStems.get(`${candidate.riffCID}:${candidate.stemCID}`) ?? null
}

/** Resolves one Discover candidate down to a real, locally-downloaded
 * `Stem` -- reused verbatim by both this component's own slot-preview
 * rendering (Step 1 below) and Task 11's "plunk in arranger" placement,
 * since both need exactly the same download-then-resolve step, just for
 * different reasons (a waveform preview vs. a real placed clip).
 * Downloads the candidate's own riff's missing stems on demand (same
 * `riffLibraryDownloadMissingStems` call `LibraryBrowser.tsx`'s own
 * `ensureStemsDownloaded` already makes) -- a candidate isn't guaranteed
 * to be cached locally just because it's in the library-wide index (Task
 * 1's own query reads DB metadata only, never touches the filesystem).
 * Returns null (never throws) for a riff that fails to resolve/download
 * (network hiccup, since-deleted riff) -- callers treat that the same as
 * "no candidate yet" rather than surfacing an error for what's ultimately
 * a soft, retryable failure (reroll picks something else regardless). */
export function resolveCandidateStem(
  candidate: DiscoverCandidate
): Promise<ResolvedCandidateStem | null> {
  const key = `${candidate.riffCID}:${candidate.stemCID}`
  const cached = resolvedCandidateCache.get(key)
  if (cached) return cached

  const promise = (async (): Promise<ResolvedCandidateStem | null> => {
    try {
      const resolved = await window.rifffApi.riffLibraryResolveRiff(candidate.riffCID)
      if (!resolved) return null
      const withStems = resolved.stems.some((s) => s.path === null)
        ? ((await window.rifffApi.riffLibraryDownloadMissingStems(candidate.riffCID)) ?? resolved)
        : resolved
      const stem = withStems.stems.find((s) => s.stemCID === candidate.stemCID)
      if (!stem || stem.path === null) return null
      return {
        author: stem.creatorUserName,
        name: stem.presetName,
        type:
          instrumentMaskToSoundType(stem.instrumentMask) ??
          guessSoundTypeFromPresetName(stem.presetName) ??
          'fx',
        path: stem.path,
        durationSec: stem.durationSec,
        barLength: stem.barLength,
        creationTime: resolved.creationTime
      }
    } catch (err) {
      console.error('resolveCandidateStem: failed to resolve candidate', candidate.riffCID, err)
      return null
    }
  })()

  resolvedCandidateCache.set(key, promise)
  void promise.then((result) => {
    if (result === null) resolvedCandidateCache.delete(key)
    else settledCandidateStems.set(key, result)
  })
  return promise
}
