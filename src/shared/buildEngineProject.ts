import type { AppState } from '../renderer/src/state/store'
import { SNAP_DIVS } from '../renderer/src/state/store'
import {
  loopLengthBars,
  resolveOffsetKey,
  resolvePlayedBars,
  stemStartBar
} from '../renderer/src/state/selectors'
import { stemKey } from './types'

export interface EngineStem {
  stemKey: string
  resolvedPath: string
  durationSec: number
  barLength: number
  playedBars: number
  offsetSteps: number
  startBarOverride: number // -1 means "use the rifff's own startBar"
  volume: number
  muted: boolean
}

export interface EngineRifff {
  groupId: string
  startBar: number
  barLength: number
  fadeInBars: number
  fadeOutBars: number
  stems: EngineStem[]
}

export interface EngineProject {
  bpm: number
  snapDiv: number
  /** The whole arrangement's own loop length, in bars — lets the native
   * transport wrap `positionBars` back to 0 itself, sample-accurately and
   * in-thread, instead of relying on the renderer to notice (via the ~30Hz
   * position-update poll) and round-trip a correcting `set-position` over
   * IPC. That round trip let playback run up to one poll tick past the true
   * loop boundary before jumping back — a jump with no anti-click treatment
   * at all, since it isn't any individual clip's own start/end (see
   * FadeGain.cpp) and isn't a single stem's own tiling repeat (see
   * LoopSewing.cpp) either. See LoopBoundaryFade.h for the declick fade
   * applied right at this wrap point. */
  loopLengthBars: number
  rifffs: EngineRifff[]
}

export interface StretchedStem {
  path: string
  /** The ACTUAL real-world duration of the audio at `path`, in seconds — not
   * the original source stem's duration. When a stretch was applied, this
   * must be the resolved (stretched) file's own measured duration, not the
   * pre-stretch source's, or the native engine's per-bar timing math
   * (durationSec / barLength) silently desyncs from the project's own tempo
   * and produces trailing silence or overlap at the end of the loop. */
  durationSec: number
}

export type StretchResolver = (path: string, ratio: number) => Promise<StretchedStem>

/**
 * Projects AppState down to exactly what the native engine needs to schedule
 * and mix playback — resolving stretch (via the caller-supplied resolver, the
 * same IPC round-trip src/main/resolveStretchedForExport.ts and
 * src/renderer/src/audio/resolveStretchedForPlayback.ts already use) and
 * unlinked-stem start positions (via the existing stemStartBar selector, so
 * there's exactly one place that logic lives) ahead of time, so the engine
 * itself never needs to know about stretch ratios or unlink state at all.
 */
export async function buildEngineProject(
  state: AppState,
  resolveStretched: StretchResolver
): Promise<EngineProject> {
  const placed = Object.values(state.rifffs).filter((r) => r.startBar !== undefined)
  const rifffs: EngineRifff[] = []

  for (const rifff of placed) {
    const stretchOn = state.stretch[rifff.groupId] ?? true

    const stems: EngineStem[] = []
    for (const stem of rifff.stems) {
      // Per-stem, not state.bpm / rifff.bpm once for the whole rifff — a
      // rifff's own declared bpm is what MOST of its stems were recorded
      // at, but not always: LORE riffs can (and, in the wild, do) mix in a
      // stem that was originally captured at a different native tempo,
      // still perfectly loop-locked to the riff (same bar count, sample-
      // accurate), just at a different real-world seconds-per-bar. Deriving
      // the ratio from THIS stem's own measured durationSec/barLength
      // (rather than trusting rifff.bpm to apply uniformly) is exactly
      // "measured, not assumed" — same principle as durationSec itself
      // elsewhere in this file — and produces the identical ratio as the
      // old formula whenever a stem DOES share the riff's own tempo, so
      // this is a strict correctness fix, not a behavior change for the
      // common case. Real bug this fixes: specific stems in a riff audibly
      // playing at the wrong speed relative to the others, because they'd
      // been recorded at a different native tempo than the riff's own
      // declared bpm and were being stretched by the wrong ratio.
      const secPerBarAtProjectTempo = (60 / state.bpm) * 4
      const stemNativeSecPerBar = stem.durationSec / stem.barLength
      const ratio = stretchOn ? stemNativeSecPerBar / secPerBarAtProjectTempo : 1

      let resolved: StretchedStem = { path: stem.path, durationSec: stem.durationSec }
      if (Math.abs(ratio - 1) >= 0.001) {
        try {
          resolved = await resolveStretched(stem.path, ratio)
        } catch (err) {
          // Missing rubberband or a bad render shouldn't fail the whole export
          // or playback session — fall back to native-tempo playback for just
          // this stem.
          console.error(
            `buildEngineProject: rubberband render failed for "${stem.path}" at ratio ${ratio}, falling back to native tempo`,
            err
          )
        }
      }

      const key = stemKey(rifff.groupId, stem.slot)
      const offsetSteps = state.off[resolveOffsetKey(state, rifff.groupId, stem.slot)] ?? 0
      const override = state.unlinked[rifff.groupId]
        ? stemStartBar(state, rifff.groupId, stem.slot)
        : -1

      stems.push({
        stemKey: key,
        resolvedPath: resolved.path,
        // Must be the RESOLVED (possibly stretched) file's own real duration,
        // not stem.durationSec — the native engine derives its per-bar timing
        // as durationSec / barLength, and after a stretch that only stays
        // correct (matching the project's own tempo) if durationSec reflects
        // the stretched file's actual length. Using the pre-stretch duration
        // here previously left a trailing silence gap whenever a rifff was
        // slowed down relative to its own native bpm.
        durationSec: resolved.durationSec,
        barLength: stem.barLength,
        playedBars: resolvePlayedBars(state, rifff.groupId, stem.slot),
        offsetSteps,
        startBarOverride: override,
        volume: state.vol[key] ?? 1,
        muted: state.mute[key] ?? false
      })
    }

    rifffs.push({
      groupId: rifff.groupId,
      startBar: rifff.startBar ?? 0,
      barLength: rifff.barLength,
      fadeInBars: state.fadeIn[rifff.groupId] ?? 0,
      fadeOutBars: state.fadeOut[rifff.groupId] ?? 0,
      stems
    })
  }

  return {
    bpm: state.bpm,
    snapDiv: SNAP_DIVS[state.snapIdx],
    loopLengthBars: loopLengthBars(state),
    rifffs
  }
}
