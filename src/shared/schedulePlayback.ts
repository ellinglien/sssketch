import type { Rifff, Stem } from './types'

export interface ScheduleOptions {
  offsetSteps: number
  snapDiv: number
  /** current playhead position, in bars */
  projectPos: number
  projectBpm: number
  /** Where this stem actually starts, in bars. Defaults to rifff.startBar — only
   * diverges for an unlinked stem that's been dragged to its own position. */
  startBarOverride?: number
  /** Overrides rifff.barLength as this stem's own tiling bound. Undefined
   * means "use rifff.barLength" — today's implicit default, unchanged. */
  playedBars?: number
}

export interface PlaybackSegment {
  /** where this segment's audio starts, in bars along the 32-bar timeline */
  startBarInTimeline: number
  /** how many bars of the rifff's grid this segment occupies */
  barLength: number
  /** offset into the stem's own audio buffer to start playback from, in seconds */
  bufferOffsetSec: number
  /** how many seconds of audio to play for this segment */
  durationSec: number
}

export function computeStemSchedule(
  rifff: Rifff,
  stem: Stem,
  opts: ScheduleOptions
): PlaybackSegment[] {
  const start = opts.startBarOverride ?? rifff.startBar ?? 0
  const offsetBars = opts.offsetSteps / opts.snapDiv
  const secPerBarNative = stem.durationSec / stem.barLength
  const bound = opts.playedBars ?? rifff.barLength

  const segments: PlaybackSegment[] = []
  for (let barOffset = 0; barOffset < bound; barOffset += stem.barLength) {
    // Clip the final repetition so segments always tile exactly across the rifff's
    // own span, even when stem.barLength doesn't evenly divide rifff.barLength (e.g.
    // a 3-bar stem in an 8-bar rifff would otherwise produce a last repetition that
    // overruns into whatever follows on the timeline, or for a >50%-length stem,
    // leave the block's tail silent). Same failure mode already fixed for the visual
    // layer in Task 11's StemSubRow tiling.
    const segmentBarLength = Math.min(stem.barLength, bound - barOffset)
    const startBarInTimeline = start + offsetBars + barOffset
    const endBarInTimeline = startBarInTimeline + segmentBarLength
    if (endBarInTimeline <= opts.projectPos) continue // fully in the past
    segments.push({
      startBarInTimeline,
      barLength: segmentBarLength,
      // Mid-segment resume offset (e.g. resuming playback partway through a
      // segment) is computed by the audio engine (Task 15), not here.
      bufferOffsetSec: 0,
      durationSec: segmentBarLength * secPerBarNative
    })
  }
  return segments
}
