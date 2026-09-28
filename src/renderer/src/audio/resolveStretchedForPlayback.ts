import type { StretchResolver } from '@shared/buildEngineProject'
import { makeCachedStretchResolver } from './stretchResolveCache'

/** Memoised by (path, ratio) since 2026-09-28. The IPC call underneath is
 * unchanged; what changed is that buildEngineProject no longer pays for it
 * once per stem on every single sync.
 *
 * Reported while listening to radio: "the playing of the stem doesn't
 * start until the wave appears completely". Both the audio and the picture
 * were waiting on the same busy main thread -- the picture on a decode,
 * the audio on N IPC round trips that each re-read a whole file from disk
 * just to measure a duration it had already measured before.
 *
 * See stretchResolveCache.ts for the eviction and in-flight-sharing rules. */
export const resolveStretchedForPlayback: StretchResolver = makeCachedStretchResolver(
  (stemPath, ratio) => window.rifffApi.renderStretched(stemPath, ratio)
)
