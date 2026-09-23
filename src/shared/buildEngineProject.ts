import type { AppState } from '../renderer/src/state/store'
import { SNAP_DIVS } from '../renderer/src/state/store'
import { loopLengthBars, resolvePlayedBars } from '../renderer/src/state/selectors'
import { stemKey } from './types'
import type { PluginStatesMap } from './pluginStates'
import { stateForSlot } from './pluginStates'
import {
  DEFAULT_REVERB,
  defaultFilterSettings,
  isStemToolkitNeutral,
  neutralCutoff,
  normaliseAutomationCurve,
  type AutomationPoint,
  type FilterMode,
  type ProjectReverbSettings,
  type StemAutomation,
  type StemFilterSettings
} from './toolkit'
import { audibleRisers, type RiserClip } from './riser'

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
  /** The built-in sound toolkit on this one clip, or ABSENT when the clip's
   * toolkit is neutral. Absence is load-bearing, not an optimisation: a
   * project where nobody has drawn anything sends exactly the JSON it sent
   * before the toolkit existed, which is what keeps its render bit-identical
   * (see buildStemToolkit below and the engine's own regression test). */
  toolkit?: EngineStemToolkit
}

/** The built-in sound toolkit on the wire, per placed stem clip. Twin of
 * EngineStem::EngineStemToolkit (native-engine/Source/EngineProject.h) -- the
 * hand-synced pair CLAUDE.md warns about: change one side and you change the
 * other and every test that builds either.
 *
 * Unlike the renderer-side types in src/shared/toolkit.ts, every curve here
 * is a concrete array (never absent) and every static value is concrete,
 * because the engine's parser reads fixed keys. */
export interface EngineStemAutomation {
  filterCutoff: AutomationPoint[]
  /** ALWAYS EMPTY, and kept on the wire only because the engine's parser
   * reads four fixed keys (EngineProject.cpp) and this side is its
   * hand-synced twin. Resonance stopped being drawable and became a per-clip
   * dial (see AUTOMATION_PARAMS in toolkit.ts); its value now travels as the
   * STATIC EngineStemToolkit.filterResonance below, which the engine already
   * applies whenever this curve is empty. Nothing native needed changing for
   * that -- an empty curve was always a supported case. */
  filterResonance: AutomationPoint[]
  reverbSend: AutomationPoint[]
  volume: AutomationPoint[]
}

export interface EngineStemToolkit {
  filterMode: FilterMode
  filterCutoff: number
  filterResonance: number
  reverbSend: number
  /** The static level the `volume` curve sits under. Always 1.0 -- see
   * buildStemToolkit, which folds the clip's real gain into the CURVE's own
   * values instead.
   *
   * Why: the engine treats a non-empty volume curve as the clip's whole
   * level and ignores EngineStem.volume entirely (PlaybackEngine.cpp's
   * `volumeAutomated`), a rule written when the curve was meant to REPLACE
   * the old per-clip volume envelope. The gain dial makes that split
   * explicit instead -- the dial is the level, the curve is the shape, and
   * they multiply -- so this side sends a curve that already has the dial
   * multiplied through it. Leaving this at 1.0 is load-bearing: when the
   * curve is EMPTY the engine applies EngineStem.volume itself and then
   * multiplies by evaluate(curve, toolkit.volume), so anything but 1.0 here
   * would apply the gain twice. */
  volume: number
  /** The ABSOLUTE arrangement bar that clip-relative bar 0 sits on -- i.e.
   * this clip's own left edge, including its left crop and its re-one offset,
   * exactly as selectors.ts's clipGeometryFromFields draws it. Every point in
   * `automation` is measured from here, so the engine never needs to know how
   * a clip's on-screen extent is derived and the drawn lane can never
   * disagree with what is heard. See clipOriginBar below. */
  originBar: number
  automation: EngineStemAutomation
}

export interface EngineRifff {
  groupId: string
  channelId: string
  startBar: number
  barLength: number
  stems: EngineStem[]
}

/** One placed noise riser on the wire. Twin of EngineRiser
 * (native-engine/Source/EngineProject.h) -- the hand-synced pair CLAUDE.md
 * warns about: change one side and you change the other and every test that
 * builds either.
 *
 * Field-for-field identical to RiserClip (src/shared/riser.ts) rather than a
 * renamed projection of it, deliberately: a riser is already exactly the set
 * of numbers the engine's generator needs, so there is nothing to derive on
 * the way out and therefore nothing that can silently disagree. The one thing
 * that DOES happen here is normalisation (normaliseRiser), because this is the
 * last point before a hand-editable `.sssketchproj`'s numbers reach a
 * per-sample loop on a real-time callback.
 *
 * Two RiserClip fields are deliberately NOT here: `name` (a row label, which
 * the engine has no use for) and `muted` (expressed as absence -- see
 * buildEngineRisers). */
export interface EngineRiser {
  id: string
  channelId: string
  startBar: number
  lengthBars: number
  startCutoffValue: number
  endCutoffValue: number
  level: number
  /** CLIP-RELATIVE bars, values being normalised cutoffs. Empty means "the
   * plain startCutoffValue -> endCutoffValue ramp" -- the engine's
   * riserCutoffAt owns that rule, exactly as @shared/riser's own does. Note
   * that unlike a stem's automation, there is no originBar here: a riser has
   * no crop and no re-one offset, so its left edge IS startBar and the engine
   * subtracts that directly. */
  curve: AutomationPoint[]
}

/* NOTE, 2026-09-22: this interface used to carry fadeInBars/fadeOutBars,
 * the per-rifff edge fades the old envelope drag wrote. A clip's fades are
 * part of its own automation lane's `volume` curve now (applyEdgeFade in
 * src/shared/automationEdit.ts), so nothing produces those numbers any
 * more and they are gone from the wire. EngineRifff's twin in the engine
 * (native-engine/Source/EngineProject.h) still DECLARES them and still
 * parses them with a default of 0.0, which is exactly what an absent key
 * gives it -- so this is a compatible removal that needs no engine rebuild.
 * They can't simply be deleted over there: buildFadePoints is also what
 * applies the always-on ~3ms anti-click micro-fade at every clip edge (see
 * FadeGain.h), so removing the engine's fade path is a separate, careful
 * piece of work. */

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
  /** Every placed riser, earliest first. Always sent (as an empty array when
   * there are none), the same way channelChains and reverb already are -- the
   * engine's neutral fast path keys off the array being EMPTY, not off the
   * key being absent, so there is nothing for an omitted key to buy. See
   * buildEngineRisers. */
  risers: EngineRiser[]
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
  /** The shared reverb's own settings. Always sent (it is three numbers, and
   * the engine defaults them anyway) -- only ever audible once some clip has
   * a non-zero send. Deliberately still project-level after the per-clip
   * rescope (spec section 2b): one room everything sends into. */
  reverb: ProjectReverbSettings
}

export interface EngineMasterChainSlot {
  pluginId: string
  path: string
  stateBase64: string
}

export interface EngineChannelChain {
  channelId: string
  slots: [EngineMasterChainSlot, EngineMasterChainSlot]
}

/**
 * The ABSOLUTE arrangement bar a clip's own left edge sits on -- the origin
 * every clip-relative automation point is measured from.
 *
 * Deliberately the same three terms clipGeometryFromFields uses to place the
 * clip on screen (`(startBar + leftCropBars) * ppb + offsetSteps * ppb /
 * snapDiv`), divided back out of pixels: the lane IS the clip's waveform
 * rect, so "bar 0 of the curve" and "the left edge of the drawn clip" have to
 * be the same place or the line would not line up with what is heard. Kept
 * here rather than in the engine so the geometry formula exists once, on the
 * side that already owns it.
 */
export function clipOriginBar(fields: {
  startBar: number
  leftCropBars: number
  offsetSteps: number
  snapDiv: number
}): number {
  const { startBar, leftCropBars, offsetSteps, snapDiv } = fields
  const offsetBars = snapDiv > 0 ? offsetSteps / snapDiv : 0
  return startBar + leftCropBars + offsetBars
}

/**
 * Projects one clip's half of the toolkit down to the wire, or undefined when
 * the clip's toolkit does nothing.
 *
 * That `undefined` is the load-bearing part, not an optimisation: a stem with
 * no toolkit key on the wire is what makes the engine take its pre-toolkit
 * render path, which is what makes an old project sound bit-identical to how
 * it sounded before this feature existed (there is an engine-side test
 * asserting exactly that, sample for sample). isStemToolkitNeutral owns the
 * rule and is mirrored by stemToolkitIsNeutral() in PlaybackEngine.cpp.
 */
/**
 * Multiplies a drawn curve through by the clip's own static gain, so what
 * reaches the engine is "the dial times the shape" -- see
 * EngineStemToolkit.volume for why that has to happen HERE rather than on
 * the engine side. Values stay in [0,1] because both factors are (state.vol
 * is clamped into [0,1] by SET_VOLUME/SET_GROUP_VOLUME, curve values by
 * normaliseAutomationCurve), so nothing can be clipped by the clamp on the
 * other side of the wire.
 */
function scaleCurveByGain(points: AutomationPoint[], gain: number): AutomationPoint[] {
  if (points.length === 0) return points
  const safeGain = Number.isFinite(gain) ? Math.min(1, Math.max(0, gain)) : 1
  if (safeGain === 1) return points
  return points.map((point) => ({ bar: point.bar, value: point.value * safeGain }))
}

export function buildStemToolkit(
  filter: StemFilterSettings | undefined,
  reverbSend: number | undefined,
  automation: StemAutomation | undefined,
  originBar: number,
  /** This clip's static gain -- state.vol (or its in-progress drag
   * preview), the number the row's gain dial writes. Folded into the volume
   * curve rather than sent alongside it; see EngineStemToolkit.volume. */
  gain = 1
): EngineStemToolkit | undefined {
  if (isStemToolkitNeutral(filter, reverbSend, automation)) return undefined
  const mode = filter?.mode ?? 'lowpass'
  // Written out field by field rather than mapped over AUTOMATION_PARAMS:
  // the engine's parser reads these four fixed keys, so the wire type is
  // deliberately a closed shape, and spelling it out is what makes adding a
  // fifth parameter a compile error here rather than a silently missing key
  // at runtime.
  const curves: EngineStemAutomation = {
    filterCutoff: normaliseAutomationCurve(automation?.filterCutoff ?? []),
    // Never populated -- see EngineStemAutomation.filterResonance.
    filterResonance: [],
    reverbSend: normaliseAutomationCurve(automation?.reverbSend ?? []),
    volume: scaleCurveByGain(normaliseAutomationCurve(automation?.volume ?? []), gain)
  }
  return {
    filterMode: mode,
    // Falls back to THIS mode's own neutral end, not to a fixed 1 -- a clip
    // that only has a send set must not accidentally arrive with a highpass
    // parked at 20kHz (i.e. silence).
    filterCutoff: filter?.cutoff ?? neutralCutoff(mode),
    filterResonance: filter?.resonance ?? defaultFilterSettings(mode).resonance,
    reverbSend: reverbSend ?? 0,
    volume: 1, // see EngineStemToolkit.volume
    originBar,
    automation: curves
  }
}

/**
 * Projects the placed risers down to the wire, earliest first.
 *
 * A MUTED riser is simply not here. That absence is load-bearing, and it is
 * the whole reason muting a riser needs no native-engine change: a riser has
 * no stems, so there is no EngineStem.muted to set, and EngineRiser
 * deliberately has no `muted` field of its own (it is the hand-synced twin
 * of EngineRiser in native-engine/Source/EngineProject.h -- see CLAUDE.md --
 * and adding a field would mean a C++ change and a rebuild for something
 * "send one fewer array entry" already expresses). Same shape as a cleared
 * toolkit dropping its `toolkit` key (isStemToolkitNeutral): the engine's own
 * neutral path is already the one that runs when nothing is there.
 *
 * Ordering, normalisation and the mute rule all live in audibleRisers
 * (@shared/riser), so the wire and both DAW exports cannot disagree about
 * which risers exist -- see its own doc comment for why the order matters.
 */
export function buildEngineRisers(risers: Record<string, RiserClip>): EngineRiser[] {
  return audibleRisers(risers).map((riser) => ({
    id: riser.id,
    channelId: riser.channelId,
    startBar: riser.startBar,
    lengthBars: riser.lengthBars,
    startCutoffValue: riser.startCutoffValue,
    endCutoffValue: riser.endCutoffValue,
    level: riser.level,
    curve: riser.curve
  }))
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

// Real perf bug, found live 2026-09-15 via a direct report ("it's all very
// sluggish, the interface takes a while for buttons to register") traced
// to a real 409-placed-stem project: buildEngineProject used to resolve
// every stem's own stretch SEQUENTIALLY, one `await resolveStretched(...)`
// at a time -- meaning this whole function's wall-clock cost scaled
// linearly with placed-stem count, and re-ran on EVERY tracked state field
// change (StoreContext.tsx's own engine-sync effect -- bpm, vol, mute,
// vol, playedBars, leftCrop, ...), not just an actual tempo change.
// Even a cache HIT still round-trips through IPC and re-reads the whole
// resolved file from disk just to measure its duration (rubberband.ts's
// own renderStretched) -- 409 sequential round trips for that alone is a
// real, measured multi-second cost on every single edit. A bounded worker
// pool lets many stems' own resolveStretched calls run concurrently
// instead of queued one after another -- capped (not unbounded
// Promise.all) so a genuinely large project doesn't spawn hundreds of
// rubberband subprocesses at once and thrash CPU/disk contention instead
// of actually finishing faster.
const STRETCH_RESOLUTION_CONCURRENCY = 8

/** Runs `fn` over every item in `items`, at most `limit` calls in flight at
 * once, preserving each result at its own input index regardless of which
 * worker actually processed it (a fixed-size pool of `limit` workers, each
 * pulling the next unclaimed index until none remain) -- see
 * STRETCH_RESOLUTION_CONCURRENCY's own doc comment for why buildEngineProject
 * needs this rather than a plain sequential loop or an unbounded
 * Promise.all. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let nextIndex = 0
  async function worker(): Promise<void> {
    for (;;) {
      const i = nextIndex
      nextIndex += 1
      if (i >= items.length) return
      results[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
  return results
}

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
  pluginCatalog: PluginCatalogForEngineProject,
  pluginStates: PluginStatesMap = {}
): Promise<EngineProject> {
  const placed = Object.values(state.rifffs).filter((r) => r.startBar !== undefined)

  // Per-stem stretch ratio, computed once and reused by BOTH the gathering
  // pass below and the assembly pass further down -- pure/cheap (no I/O),
  // so recomputing would be harmless, but sharing it keeps the two passes
  // from ever silently disagreeing on what ratio a given stem resolved
  // against.
  function stretchRatioFor(
    rifff: (typeof placed)[number],
    stem: (typeof rifff.stems)[number]
  ): number {
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
    const stretchOn = state.stretch[rifff.groupId] ?? true
    const secPerBarAtProjectTempo = (60 / state.bpm) * 4
    const stemNativeSecPerBar = stem.durationSec / stem.barLength
    // A one-shot's own durationSec/barLength are cosmetic (see Stem's own
    // doc comment) -- computing a ratio from them here would be
    // meaningless and would wrongly trigger a real tempo-stretch resolve
    // call for every one-shot. Always ratio 1 (native path, no resolve)
    // regardless of stretchOn/project bpm.
    return stem.oneShot ? 1 : stretchOn ? stemNativeSecPerBar / secPerBarAtProjectTempo : 1
  }

  // Pass 1 (synchronous, no I/O): gather every stem that actually needs a
  // stretch resolved, across the WHOLE project -- not per-rifff -- so the
  // concurrency-limited resolution below (mapWithConcurrency) can keep
  // STRETCH_RESOLUTION_CONCURRENCY calls in flight across DIFFERENT
  // rifffs at once, not just within one.
  const tasks: { key: string; path: string; ratio: number }[] = []
  for (const rifff of placed) {
    for (const stem of rifff.stems) {
      const ratio = stretchRatioFor(rifff, stem)
      if (Math.abs(ratio - 1) >= 0.001) {
        tasks.push({ key: stemKey(rifff.groupId, stem.slot), path: stem.path, ratio })
      }
    }
  }

  // Pass 2: resolve every gathered task concurrently (bounded, see
  // STRETCH_RESOLUTION_CONCURRENCY's own doc comment), catching each
  // failure independently so one bad render still only falls back to
  // native-tempo playback for that ONE stem, exactly as the old sequential
  // version did -- never fails the whole build.
  const resolvedResults = await mapWithConcurrency(
    tasks,
    STRETCH_RESOLUTION_CONCURRENCY,
    async (task) => {
      try {
        return await resolveStretched(task.path, task.ratio)
      } catch (err) {
        // Missing rubberband or a bad render shouldn't fail the whole export
        // or playback session — fall back to native-tempo playback for just
        // this stem.
        console.error(
          `buildEngineProject: rubberband render failed for "${task.path}" at ratio ${task.ratio}, falling back to native tempo`,
          err
        )
        return null
      }
    }
  )
  const resolvedByKey = new Map<string, StretchedStem>()
  tasks.forEach((task, i) => {
    const result = resolvedResults[i]
    if (result) resolvedByKey.set(task.key, result)
  })

  // Pass 3 (synchronous, no I/O): assemble the final rifffs/stems in the
  // SAME order as the original single-pass loop, now just looking up each
  // stem's already-resolved stretch result instead of awaiting it inline.
  const rifffs: EngineRifff[] = []
  for (const rifff of placed) {
    const stems: EngineStem[] = []
    for (const stem of rifff.stems) {
      const key = stemKey(rifff.groupId, stem.slot)
      const resolved: StretchedStem = resolvedByKey.get(key) ?? {
        path: stem.path,
        durationSec: stem.durationSec
      }
      const offsetSteps = state.off[rifff.groupId] ?? 0
      const leftCropBars = state.leftCrop[rifff.groupId] ?? 0
      // Same drag-preview-over-committed preference as EngineStem.volume
      // below, and the same number -- the clip's gain has to reach the
      // engine exactly once, either as EngineStem.volume (no curve) or
      // multiplied through the curve (see buildStemToolkit).
      const gain = state.dragVol[key] ?? state.vol[key] ?? 1
      // Built per stem, not per rifff: the toolkit is per CLIP now (spec
      // section 2b), and two stems of the same rifff can carry entirely
      // different curves. The origin they share is the rifff's own left edge,
      // which is exactly what the lane is drawn over.
      const toolkit = buildStemToolkit(
        state.stemFilters?.[key],
        state.stemSends?.[key],
        state.stemAutomation?.[key],
        clipOriginBar({
          startBar: rifff.startBar ?? 0,
          leftCropBars,
          offsetSteps,
          snapDiv: SNAP_DIVS[state.snapIdx]
        }),
        gain
      )

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
        leftCropBars,
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
        volume: gain,
        muted: state.mute[key] ?? false,
        muteRegions: state.muteRegions[key] ?? [],
        oneShot: stem.oneShot ?? false,
        trimStartSec: stem.trimStartSec ?? 0,
        trimEndSec: stem.trimEndSec ?? -1,
        // Spread rather than `toolkit` so a neutral clip's stem object has no
        // `toolkit` key AT ALL -- the wire payload for a project nobody has
        // drawn on stays byte-for-byte what it was before this feature.
        ...(toolkit ? { toolkit } : {})
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
      stems
    })
  }

  const masterChain = state.masterChain.map((id, slot) => {
    if (id === null) return { pluginId: '', path: '', stateBase64: '' }
    const entry = pluginCatalog.plugins.find((p) => p.id === id)
    return {
      pluginId: id,
      path: entry?.path ?? '', // empty path = engine treats as empty/unresolvable
      stateBase64: stateForSlot(pluginStates, `master:${slot}`, id) ?? ''
    }
  }) as EngineProject['masterChain']

  const channelChains: EngineChannelChain[] = Object.entries(state.channelPlugins)
    .filter(([, slots]) => slots.some((id) => id !== null))
    .map(([channelId, slots]) => ({
      channelId,
      slots: slots.map((id, slot) => {
        if (id === null) return { pluginId: '', path: '', stateBase64: '' }
        const entry = pluginCatalog.plugins.find((p) => p.id === id)
        return {
          pluginId: id,
          path: entry?.path ?? '',
          stateBase64: stateForSlot(pluginStates, `channel:${channelId}:${slot}`, id) ?? ''
        }
      }) as [EngineMasterChainSlot, EngineMasterChainSlot]
    }))

  return {
    bpm: state.bpm,
    snapDiv: SNAP_DIVS[state.snapIdx],
    loopLengthBars: loopLengthBars(state),
    masterChain,
    channelChains,
    reverb: state.reverb ?? DEFAULT_REVERB,
    risers: buildEngineRisers(state.risers ?? {}),
    rifffs
  }
}
