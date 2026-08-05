import type { AppState } from '../renderer/src/state/store'
import { SNAP_DIVS } from '../renderer/src/state/store'
import { loopLengthBars, resolvePlayedBars } from '../renderer/src/state/selectors'
import { stemKey } from './types'

export interface EngineStem {
  stemKey: string
  resolvedPath: string
  durationSec: number
  barLength: number
  playedBars: number
  leftCropBars: number
  offsetSteps: number
  startBarOverride: number // -1 means "use the rifff's own startBar"
  volume: number
  muted: boolean
  muteRegions: { startBar: number; endBar: number }[]
  oneShot: boolean
  trimStartSec: number
  trimEndSec: number // -1 means "play to the stem's own natural durationSec"
}

export interface EngineRifff {
  groupId: string
  channelId: string
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
  /** pluginId "" (empty string) for an empty slot, matching the native
   * engine's own wire-format convention -- state.masterChain uses `null` on
   * the renderer side since that's this codebase's existing convention for
   * "unset" everywhere else (e.g. Rifff.startBar). path is only meaningful
   * when pluginId is non-empty -- the native engine has no access to
   * pluginCatalog.json itself (a main-process/renderer concept), so the
   * renderer resolves a scanned catalog id to its real file path here and
   * sends both. */
  masterChain: [
    EngineMasterChainSlot,
    EngineMasterChainSlot,
    EngineMasterChainSlot,
    EngineMasterChainSlot
  ]
  /** One entry per channel with at least one plugin loaded -- a channelId
   * absent from this array has no channel chain (pure passthrough), same
   * convention as channelPlugins itself on the renderer side. See
   * docs/superpowers/specs/2026-08-01-channel-plugin-inserts-design.md. */
  channelChains: EngineChannelChain[]
}

export interface EngineMasterChainSlot {
  pluginId: string
  path: string
}

export interface EngineChannelChain {
  channelId: string
  slots: [EngineMasterChainSlot, EngineMasterChainSlot]
}

/** Minimal shape buildEngineProject needs from the plugin catalog -- callers
 * pass the real PluginCatalog (src/main/pluginCatalog.ts), this just avoids
 * a cross-layer import for a type this function barely touches. */
export interface PluginCatalogForEngineProject {
  plugins: { id: string; path: string }[]
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
 * src/renderer/src/audio/resolveStretchedForPlayback.ts already use) ahead of
 * time, so the engine itself never needs to know about stretch ratios at all.
 * EngineStem.startBarOverride stays -1 unconditionally now — it used to
 * carry an unlinked stem's own diverged start position, but a stem can no
 * longer diverge from its rifff (see store.ts's UNGROUP: it becomes a fully
 * independent rifff instead, with its own ordinary startBar). Left in the
 * wire format rather than removed, since the native engine's own parsing
 * doesn't need to change either way and -1 is already its "no override"
 * case.
 */
export async function buildEngineProject(
  state: AppState,
  resolveStretched: StretchResolver,
  pluginCatalog: PluginCatalogForEngineProject
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
      // A one-shot's own durationSec/barLength are cosmetic (see Stem's own
      // doc comment) -- computing a ratio from them here would be
      // meaningless and would wrongly trigger a real tempo-stretch resolve
      // call for every one-shot. Always ratio 1 (native path, no resolve)
      // regardless of stretchOn/project bpm.
      const ratio = stem.oneShot ? 1 : stretchOn ? stemNativeSecPerBar / secPerBarAtProjectTempo : 1

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
      const offsetSteps = state.off[rifff.groupId] ?? 0

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
        playedBars: resolvePlayedBars(state, rifff.groupId),
        leftCropBars: state.leftCrop[rifff.groupId] ?? 0,
        offsetSteps,
        startBarOverride: -1,
        // Prefers an in-progress drag preview over the committed value --
        // see docs/superpowers/specs/2026-08-04-live-drag-preview-design.md.
        // NOT what makes a volume drag audible live any more, though --
        // that's now a separate, much lighter path (liveParamSync.ts's
        // scheduleLiveParamSync, see docs/superpowers/specs/
        // 2026-08-04-live-param-fast-path-design.md) that bypasses this
        // function/a full reload entirely. StoreContext.tsx's engine-sync
        // effect deliberately no longer depends on dragVol, so THIS
        // preference only ever matters as a harmless fallback -- e.g. if a
        // full reload happens to fire for some unrelated reason (bpm
        // change, undo, ...) while a drag is still in progress, the
        // reload's own snapshot reflects the live value too, rather than
        // momentarily reverting to the stale committed one.
        volume: state.dragVol[key] ?? state.vol[key] ?? 1,
        muted: state.mute[key] ?? false,
        muteRegions: state.muteRegions[key] ?? [],
        oneShot: stem.oneShot ?? false,
        trimStartSec: stem.trimStartSec ?? 0,
        trimEndSec: stem.trimEndSec ?? -1
      })
    }

    rifffs.push({
      groupId: rifff.groupId,
      // Same fallback selectors.ts's own channelsInOrder already uses -- a
      // placed rifff with no explicit channelOf entry (e.g. an old save
      // from before DAW mode) implicitly owns its own solo channel, named
      // after its own groupId.
      channelId: state.channelOf[rifff.groupId] ?? rifff.groupId,
      startBar: rifff.startBar ?? 0,
      barLength: rifff.barLength,
      // Same drag-preview preference (and the same "harmless fallback,
      // not what makes it live" caveat) as volume above.
      fadeInBars: state.dragFadeIn[rifff.groupId] ?? state.fadeIn[rifff.groupId] ?? 0,
      fadeOutBars: state.dragFadeOut[rifff.groupId] ?? state.fadeOut[rifff.groupId] ?? 0,
      stems
    })
  }

  const masterChain = state.masterChain.map((id) => {
    if (id === null) return { pluginId: '', path: '' }
    const entry = pluginCatalog.plugins.find((p) => p.id === id)
    return { pluginId: id, path: entry?.path ?? '' } // empty path = engine treats as empty/unresolvable
  }) as EngineProject['masterChain']

  const channelChains: EngineChannelChain[] = Object.entries(state.channelPlugins)
    .filter(([, slots]) => slots.some((id) => id !== null))
    .map(([channelId, slots]) => ({
      channelId,
      slots: slots.map((id) => {
        if (id === null) return { pluginId: '', path: '' }
        const entry = pluginCatalog.plugins.find((p) => p.id === id)
        return { pluginId: id, path: entry?.path ?? '' }
      }) as [EngineMasterChainSlot, EngineMasterChainSlot]
    }))

  return {
    bpm: state.bpm,
    snapDiv: SNAP_DIVS[state.snapIdx],
    loopLengthBars: loopLengthBars(state),
    masterChain,
    channelChains,
    rifffs
  }
}
