import type { StretchResolver } from '@shared/buildEngineProject'

/** A resolved stretch: where the audio actually is, and how long it
 * actually is. Structurally `StretchedStem`, redeclared here only so this
 * module does not depend on a type alias moving. */
interface Resolved {
  path: string
  durationSec: number
}

/** Why this cache exists (2026-09-28).
 *
 * Reported while listening to radio: "on new stem load the playing of the
 * stem doesn't start until the wave appears completely, which is usually a
 * moment or two after the loop has already started.. is pre-loading
 * happening?"
 *
 * It was, partly. `armRadioPick` warms the rubberband render a whole
 * interval early, so the expensive part -- the actual time-stretch -- is
 * already done. But `resolveStretchedForPlayback` was a bare IPC call with
 * no memo of any kind, and buildEngineProject's own comment records that
 * even a cache HIT "still round-trips through IPC and re-reads the whole
 * resolved file from disk just to measure its duration".
 *
 * So every change still paid N IPC round trips and N file reads at the
 * instant it was due -- on a main thread simultaneously decoding that same
 * audio to draw the waveform. That is precisely why the audio arrived when
 * the picture did: they were queued behind each other.
 *
 * Memoising by (path, ratio) means a stem warmed an interval ago costs
 * nothing at all when the change lands. The key is the same pair the
 * main-process stretch cache is keyed on, so the two cannot disagree about
 * what "the same stretch" means. */
const cache = new Map<string, Promise<Resolved>>()
const settled = new Map<string, Resolved>()

/** Enough for a long session of radio churning through layers, small
 * enough that it cannot become a leak. Each entry is two short strings and
 * a number; the audio itself lives on disk and in the engine, never here.
 * Oldest-first eviction, which for this access pattern is also
 * least-recently-warmed. */
export const STRETCH_RESOLVE_CACHE_LIMIT = 256

function keyFor(path: string, ratio: number): string {
  return `${path}::${ratio}`
}

function evictIfNeeded(): void {
  while (cache.size > STRETCH_RESOLVE_CACHE_LIMIT) {
    const oldest = cache.keys().next()
    if (oldest.done) return
    cache.delete(oldest.value)
    settled.delete(oldest.value)
  }
}

/** The answer for a stretch already warmed, or null. Synchronous on
 * purpose: this is what lets a commit skip the round trip entirely. */
export function peekStretchResolve(path: string, ratio: number): Resolved | null {
  return settled.get(keyFor(path, ratio)) ?? null
}

export function clearStretchResolveCache(): void {
  cache.clear()
  settled.clear()
}

/** Wraps a resolver so each (path, ratio) is asked for once. Concurrent
 * callers share the one in-flight promise rather than racing.
 *
 * A rejection is evicted rather than remembered -- the same
 * eviction-on-rejection rule `peakCache.ts` established, so a transient
 * network hiccup cannot poison a stem for the rest of the session. */
export function makeCachedStretchResolver(under: StretchResolver): StretchResolver {
  return (path: string, ratio: number): Promise<Resolved> => {
    const key = keyFor(path, ratio)
    const existing = cache.get(key)
    if (existing) return existing
    const promise = under(path, ratio)
      .then((resolved) => {
        settled.set(key, resolved)
        return resolved
      })
      .catch((err: unknown) => {
        cache.delete(key)
        settled.delete(key)
        throw err
      })
    cache.set(key, promise)
    evictIfNeeded()
    return promise
  }
}
