import { sqrtGain } from '@shared/mixGain'

export interface PreviewStemInput {
  path: string
  /** Extra per-stem gain multiplier beyond the shared sqrtGain headroom
   * normalization (e.g. a stem's own saved volume) — defaults to 1. */
  gain?: number
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
  const gain = sqrtGain(stems.length)
  const decodeResults = await Promise.allSettled(
    stems.map(async (stem) => {
      const bytes = await window.rifffApi.readAudioFile(stem.path)
      const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      const buffer = await ctx.decodeAudioData(arrayBuffer as ArrayBuffer)
      return { stem, buffer }
    })
  )
  if (isCancelled()) return []

  const sources: AudioBufferSourceNode[] = []
  for (const result of decodeResults) {
    if (result.status === 'rejected') {
      console.error('previewLoop: failed to decode preview audio:', result.reason)
      continue
    }
    const { stem, buffer } = result.value
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.loop = true
    const gainNode = ctx.createGain()
    gainNode.gain.value = gain * (stem.gain ?? 1)
    source.connect(gainNode)
    gainNode.connect(ctx.destination)
    source.start(0)
    sources.push(source)
  }
  return sources
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
