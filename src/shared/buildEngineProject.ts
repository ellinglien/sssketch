import type { AppState } from '../renderer/src/state/store'
import { SNAP_DIVS } from '../renderer/src/state/store'
import { resolveOffsetKey, stemStartBar } from '../renderer/src/state/selectors'
import { stemKey } from './types'

export interface EngineStem {
  stemKey: string
  resolvedPath: string
  durationSec: number
  barLength: number
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
  rifffs: EngineRifff[]
}

export type StretchResolver = (path: string, ratio: number) => Promise<string>

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
    const ratio = stretchOn ? state.bpm / rifff.bpm : 1

    const stems: EngineStem[] = []
    for (const stem of rifff.stems) {
      let resolvedPath = stem.path
      if (Math.abs(ratio - 1) >= 0.001) {
        try {
          resolvedPath = await resolveStretched(stem.path, ratio)
        } catch (err) {
          // Missing rubberband or a bad render shouldn't fail the whole export
          // or playback session — fall back to native-tempo playback for just
          // this stem.
          console.error(
            `buildEngineProject: rubberband render failed for "${stem.path}" at ratio ${ratio}, falling back to native tempo`,
            err
          )
          resolvedPath = stem.path
        }
      }

      const key = stemKey(rifff.groupId, stem.slot)
      const offsetSteps = state.off[resolveOffsetKey(state, rifff.groupId, stem.slot)] ?? 0
      const override = state.unlinked[rifff.groupId]
        ? stemStartBar(state, rifff.groupId, stem.slot)
        : -1

      stems.push({
        stemKey: key,
        resolvedPath,
        durationSec: stem.durationSec,
        barLength: stem.barLength,
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

  return { bpm: state.bpm, snapDiv: SNAP_DIVS[state.snapIdx], rifffs }
}
