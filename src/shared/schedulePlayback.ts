import type { Rifff, Stem } from './types'

export interface ScheduleOptions {
  offsetSteps: number
  snapDiv: number
  /** current playhead position, in bars */
  projectPos: number
  projectBpm: number
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
  const start = rifff.startBar ?? 0
  const offsetBars = opts.offsetSteps / opts.snapDiv
  const repetitions = Math.max(1, Math.round(rifff.barLength / stem.barLength))
  const secPerBarNative = stem.durationSec / stem.barLength

  const segments: PlaybackSegment[] = []
  for (let i = 0; i < repetitions; i++) {
    const startBarInTimeline = start + offsetBars + i * stem.barLength
    const endBarInTimeline = startBarInTimeline + stem.barLength
    if (endBarInTimeline <= opts.projectPos) continue // fully in the past
    segments.push({
      startBarInTimeline,
      barLength: stem.barLength,
      bufferOffsetSec: 0,
      durationSec: stem.barLength * secPerBarNative
    })
  }
  return segments
}
