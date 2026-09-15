import { applyLoopMicroFade } from './microFade'

export interface PreviewStemInput {
  path: string
  /** This stem's own committed gain — state.vol[stemKey(...)] (already has
   * sqrtGain's stem-count headroom normalization baked in from import time,
   * see store.ts's ADD_TO_SHELF/ADD_STEM_TO_RIFFF reducer cases), exactly
   * as buildEngineProject.ts sends it to the native engine for real
   * arranger playback. Applied directly, with NO further sqrtGain
   * multiplication here — this function used to also compute a fresh
   * sqrtGain(stems.length) and multiply it in on top, double-applying the
   * same headroom factor and making every preview measurably quieter than
   * the arranger's own playback of the same rifff. Defaults to 1. */
  gain?: number
  /** This stem's true, bar-derived duration in seconds (Stem.durationSec) —
   * when provided, the loop point is locked to exactly this instead of the
   * decoded buffer's own raw length. Real bug this fixed: two stems that
   * are supposed to loop at exact bar-multiples of each other can still
   * decode to slightly different raw sample counts (encoder padding,
   * rounding), so looping each one at its own buffer's natural length
   * drifts them out of phase over many iterations even though they started
   * perfectly in sync. Optional so a caller without this metadata handy
   * still gets the old (buffer-length) behavior rather than a type error. */
  durationSec?: number
  /** Buffer offset (seconds) to START playback from, instead of the loop's
   * own beginning -- direct request, 2026-09-15: "any button press...
   * triggers the samples to start from the beginning." DiscoverPanel's own
   * restartMix uses this so a source joining an ALREADY-PLAYING mix (an
   * unmute, a reroll landing new audio) starts phase-aligned to wherever
   * the rest of the tempo-synced mix already is in its own loop, rather
   * than audibly retriggering at position 0 out of sync with everyone
   * else. Must be < durationSec (or < the decoded buffer's own duration
   * when durationSec is unset) to land within one loop's own length;
   * defaults to 0 (start of buffer), the previous, only behavior. */
  startOffsetSec?: number
}

/** One started preview source, paired with its own GainNode and the
 * INPUT stem it came from (by reference -- callers that need to find
 * "which pair is THIS stem" again later can compare by identity or by
 * `stem.path`, whichever fits). Exposing the gain node lets a caller
 * adjust volume LIVE (direct-node adjustment, no stop/restart) instead
 * of tearing down and re-starting playback just to change a level --
 * see startPreviewLoopWithGain's own doc comment for why this is a
 * separate function rather than changing startPreviewLoop's own return
 * type. */
export interface PreviewSourceWithGain {
  source: AudioBufferSourceNode
  gainNode: GainNode
  stem: PreviewStemInput
}

async function buildPreviewSources(
  ctx: AudioContext,
  stems: PreviewStemInput[],
  isCancelled: () => boolean
): Promise<PreviewSourceWithGain[]> {
  const decodeResults = await Promise.allSettled(
    stems.map(async (stem) => {
      const bytes = await window.rifffApi.readAudioFile(stem.path)
      const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      const buffer = await ctx.decodeAudioData(arrayBuffer as ArrayBuffer)
      return { stem, buffer }
    })
  )
  if (isCancelled()) return []

  const pairs: PreviewSourceWithGain[] = []
  for (const result of decodeResults) {
    if (result.status === 'rejected') {
      console.error('previewLoop: failed to decode preview audio:', result.reason)
      continue
    }
    const { stem, buffer } = result.value
    // Loop content isn't guaranteed to zero-cross exactly at the seam —
    // native buffer looping wraps sample-accurately with no per-iteration
    // hook to schedule a fade against, so a short one gets baked directly
    // into a copy of the decoded samples instead (see microFade.ts).
    const loopEndSec = stem.durationSec !== undefined ? stem.durationSec : buffer.duration
    const source = ctx.createBufferSource()
    source.buffer = applyLoopMicroFade(ctx, buffer, Math.min(loopEndSec, buffer.duration))
    source.loop = true
    if (stem.durationSec !== undefined) {
      source.loopStart = 0
      source.loopEnd = Math.min(stem.durationSec, buffer.duration)
    }
    const gainNode = ctx.createGain()
    gainNode.gain.value = stem.gain ?? 1
    source.connect(gainNode)
    gainNode.connect(ctx.destination)
    source.start(0, Math.max(0, stem.startOffsetSec ?? 0))
    pairs.push({ source, gainNode, stem })
  }
  return pairs
}

/**
 * Decodes every stem's audio in parallel, then starts them all looping
 * together in one synchronous pass. Starting each source right after its
 * own decode finishes (rather than after ALL decodes finish) staggers the
 * .start(0) calls by however long each stem's own fetch+decode took,
 * producing an audible desync on multi-stem previews — this is the exact
 * bug found in LoreLibraryBrowser's own preview and the reason this is a
 * shared utility rather than a third inline copy of the same logic.
 *
 * Returns only the sources that actually started (decode failures are
 * logged and skipped, matching the per-stem tolerance PolarGlyph's own
 * Promise.allSettled-based decode already uses) — the caller registers
 * them with its own stop mechanism (calling .stop() on each), since
 * ownership of "when to stop" varies by caller (unmount, reselect, toggle).
 */
export async function startPreviewLoop(
  ctx: AudioContext,
  stems: PreviewStemInput[],
  isCancelled: () => boolean
): Promise<AudioBufferSourceNode[]> {
  const pairs = await buildPreviewSources(ctx, stems, isCancelled)
  return pairs.map((p) => p.source)
}

/** Same as startPreviewLoop, but also returns each source's own GainNode
 * (and the stem it came from) -- direct request, 2026-09-15: "dragging
 * envelope/volume shouldn't retrigger start of samples... should not
 * affect playhead." DiscoverPanel's own multi-slot mix previously had no
 * way to change one slot's volume without a FULL restartMix (stop every
 * source, re-decode, re-start every source from position 0) -- audible
 * as every OTHER currently-playing slot's own loop position visibly
 * jumping back to its start, not just the one being adjusted. Exposing
 * the gain node lets a caller set `.gain.value` directly instead --
 * genuinely live, zero-latency, and touches only the one node being
 * adjusted, leaving every other source's own playback position (and the
 * preview's own playhead) completely undisturbed. A separate function
 * rather than changing startPreviewLoop's own return type, since three
 * OTHER callers (LibraryBrowser/Shelf/ProjectLibraryBrowser, none of
 * which need live per-stem gain access) already depend on its existing
 * `AudioBufferSourceNode[]` shape. */
export async function startPreviewLoopWithGain(
  ctx: AudioContext,
  stems: PreviewStemInput[],
  isCancelled: () => boolean
): Promise<PreviewSourceWithGain[]> {
  return buildPreviewSources(ctx, stems, isCancelled)
}

/** Stops every source in the list — safe to call on sources already
 * stopped (e.g. a looped source that was never actually started due to a
 * race), matching the existing try/catch-and-ignore convention already
 * used everywhere else a preview gets torn down. */
export function stopPreviewSources(sources: AudioBufferSourceNode[]): void {
  for (const source of sources) {
    try {
      source.stop()
    } catch {
      // already stopped
    }
  }
}

// Module-level, not component state: Shelf and LoreLibraryBrowser each own
// their own preview sources independently, with no shared parent that could
// otherwise coordinate "stop whatever anyone else is playing." A single
// registry slot for "whichever preview is currently active" lets any of them
// (and BeatPicker, which needs to silence any of the others the moment it
// opens — see the real bug this fixed: previewing a riff in the LORE
// browser, then importing it, left that preview playing underneath the
// downbeat picker) stop one another without knowing about each other's
// internals.
//
// Identified by an incrementing token rather than the stop function's own
// identity — a caller comparing "is this still me?" by closing over its own
// useCallback-returned function reference from inside that same callback's
// body trips this codebase's react-hooks/immutability lint rule (it can't
// prove the self-reference is runtime-safe, even though it is here). A
// token sidesteps that entirely: register() hands back a plain number, the
// caller stashes it in a ref, and unregister() compares against that.
let activeGeneration = 0
let activeStop: (() => void) | null = null

/** Registers `stop` as the currently-active preview's stop function,
 * immediately stopping whatever was previously registered (starting any new
 * preview always supersedes an old one, everywhere, not just within the
 * same component). Call this right after a preview actually starts
 * playing — not before, or a fast reselect could register-then-immediately-
 * get-stopped by the very same click that started it. Returns a token to
 * pass to unregisterActivePreview later. */
export function registerActivePreview(stop: () => void): number {
  activeStop?.()
  activeGeneration += 1
  activeStop = stop
  return activeGeneration
}

/** Clears the registry entry if (and only if) `token` matches the most
 * recent registerActivePreview() call — used when a component's own
 * preview ends on its own terms (toggled off, unmounted) so it doesn't
 * accidentally clear a *different*, newer preview that superseded it in
 * the meantime. */
export function unregisterActivePreview(token: number): void {
  if (token === activeGeneration) activeStop = null
}

/** Stops whichever preview is currently registered, from anywhere. Safe to
 * call when nothing is playing. Used by BeatPicker on open, so any preview
 * running elsewhere never keeps playing underneath it. */
export function stopActivePreview(): void {
  activeStop?.()
  activeStop = null
}
