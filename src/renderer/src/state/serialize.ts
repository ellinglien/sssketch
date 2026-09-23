import { initialState, type AppState } from './store'
import { isSketchEligible } from './selectors'
import { snapToWholeBarIfNearlyExact } from '@shared/barLengthSnap'
import { applyEdgeFade, clipLengthBars } from '@shared/automationEdit'
import { stemKey } from '@shared/types'
import {
  averageAutomationValue,
  defaultFilterSettings,
  type AutomationPoint,
  type StemAutomation,
  type StemFilterSettings
} from '@shared/toolkit'
import type { PluginStatesMap } from '@shared/pluginStates'
import { sanitiseLoadedCoach } from '@shared/coach'
import { normaliseLoadedRisers } from '@shared/riser'

/** Everything persisted to a .sssketchproj file — the full AppState minus
 * transient UI-mode fields that never make sense to reopen into. Playback
 * position/running state aren't part of AppState at all anymore (they live
 * in StoreContext.tsx's own transport state, outside this reducer — see its
 * module doc comment), so there's nothing to exclude for those here the way
 * there used to be. */
export type PersistedProject = Omit<
  AppState,
  | 'mode'
  // Which view the arranger is showing, not a fact about the project --
  // same treatment as `mode` directly above.
  | 'mapView'
  | 'automationParamOf'
  | 'inspectorCollapsed'
  | 'metronomeEnabled'
  | 'armedChannelId'
  | 'recordingArmReminderChannelId'
  | 'availableInputDevices'
  | 'selectedInputDevice'
  | 'regionSelection'
  | 'tidiedView'
  | 'gatedRecordingEnabled'
  | 'gatedRecordingChannelId'
  | 'gatedRecordingTargetGroupId'
  | 'pendingLockInConfirm'
>

/** The shape of a .sssketchproj saved before channels replaced trackOrder —
 * accepted by deserializeProject's migration step below, so an old save
 * still opens correctly instead of silently losing every placed rifff's row
 * (channelOrder/channelOf would otherwise just be empty). */
export interface LegacyPersistedProject extends Omit<
  PersistedProject,
  'channelOrder' | 'channelOf'
> {
  trackOrder: string[]
}

export function serializeProject(state: AppState, pluginStates: PluginStatesMap = {}): string {
  // Rest destructure is how we drop the transient UI-mode fields;
  // ignoreRestSiblings isn't enabled project-wide, so the extracted-but-unused
  // bindings need an explicit disable.
  /* eslint-disable @typescript-eslint/no-unused-vars */
  const {
    mode,
    mapView,
    automationParamOf,
    inspectorCollapsed,
    metronomeEnabled,
    armedChannelId,
    recordingArmReminderChannelId,
    availableInputDevices,
    selectedInputDevice,
    regionSelection,
    tidiedView,
    gatedRecordingEnabled,
    gatedRecordingChannelId,
    gatedRecordingTargetGroupId,
    pendingLockInConfirm,
    ...rest
  } = state
  /* eslint-enable @typescript-eslint/no-unused-vars */
  // pluginStates lives outside AppState entirely (see pluginStates.ts's own
  // doc comment) -- merged in here, at the very last moment before
  // stringifying, rather than ever being carried on `state` itself.
  // Omitted from the output entirely when empty, so an old project with no
  // plugins ever loaded doesn't grow a permanent `"pluginStates": {}` line.
  const withPluginStates = Object.keys(pluginStates).length > 0 ? { ...rest, pluginStates } : rest
  return JSON.stringify(withPluginStates, null, 2)
}

// Reuses each old trackOrder entry's own groupId as its channel id, matching
// the same "own groupId as channel id" default a first-time PLACE_ON_TIMELINE
// already uses (see store.ts) — an old trackOrder entry basically WAS "this
// groupId's own solo row" already, so this reproduces the exact same
// rendering, one channel per clip, in the same order, with nothing visibly
// different until the user actually drags something onto a shared channel.
function migrateTrackOrder(trackOrder: string[]): Pick<AppState, 'channelOrder' | 'channelOf'> {
  const channelOrder: string[] = []
  const channelOf: Record<string, string> = {}
  for (const groupId of trackOrder) {
    channelOrder.push(groupId)
    channelOf[groupId] = groupId
  }
  return { channelOrder, channelOf }
}

// A save from before the source-side fix in src/main/importOneShot.ts
// (commit 033a1c7) can carry a rifff.barLength and/or stem.barLength
// polluted by sample-quantization noise instead of the clean integer it
// was designed to land on (e.g. 16.000003184020517 instead of 16) -- see
// src/shared/barLengthSnap.ts's own comment for the full mechanism and why
// it causes periodic tiling glitches in the native engine. That fix only
// prevents NEW noise from being written; it does nothing to repair a
// project that already has the noisy value baked into its saved JSON, so
// the same snap is reapplied here, at load time, to every rifff and every
// stem within it. Rebuilds the rifffs record only when something actually
// changed, so an already-clean project's state isn't needlessly
// reallocated.
function snapBarLengthNoise(rifffs: AppState['rifffs']): AppState['rifffs'] {
  let rifffsChanged = false
  const nextRifffs: AppState['rifffs'] = {}
  for (const [groupId, rifff] of Object.entries(rifffs)) {
    const snappedBarLength = snapToWholeBarIfNearlyExact(rifff.barLength)
    let stemsChanged = false
    const nextStems = rifff.stems.map((stem) => {
      const snappedStemBarLength = snapToWholeBarIfNearlyExact(stem.barLength)
      if (snappedStemBarLength === stem.barLength) return stem
      stemsChanged = true
      return { ...stem, barLength: snappedStemBarLength }
    })
    if (snappedBarLength === rifff.barLength && !stemsChanged) {
      nextRifffs[groupId] = rifff
      continue
    }
    rifffsChanged = true
    nextRifffs[groupId] = {
      ...rifff,
      barLength: snappedBarLength,
      stems: stemsChanged ? nextStems : rifff.stems
    }
  }
  return rifffsChanged ? nextRifffs : rifffs
}

// The built-in sound toolkit shipped per CHANNEL for exactly one day
// (2026-09-22) before the first live walkthrough moved it to per CLIP -- see
// the design doc's section 2b. A project saved in that window carries
// channelFilters/channelSends/channelAutomation, keyed by channelId, with
// curves in ABSOLUTE arrangement bars. There is no honest migration: a
// channel's curve belonged to every clip on that row at once, and the new
// curves are clip-relative, so re-keying one onto N clips would invent an
// edit the user never made and silently change what several clips sound
// like. These keys are therefore DROPPED (the deliberate choice recorded in
// the commit that made this change), leaving such a project with no
// automation rather than with wrong automation -- and, crucially, loading
// without crashing, which is the part that actually matters. Stripped by
// name rather than by an allow-list so an unrelated unknown key (a newer
// save opened in an older build) still passes through untouched, the way it
// always has.
type ChannelScopedToolkitKeys = {
  channelFilters?: unknown
  channelSends?: unknown
  channelAutomation?: unknown
}

function dropChannelScopedToolkit<T extends ChannelScopedToolkitKeys>(
  projectData: T
): Omit<T, keyof ChannelScopedToolkitKeys> {
  /* eslint-disable @typescript-eslint/no-unused-vars */
  const { channelFilters, channelSends, channelAutomation, ...rest } = projectData
  /* eslint-enable @typescript-eslint/no-unused-vars */
  return rest
}

/** A curve drawn while `filterResonance` was still a drawable parameter.
 * The saved JSON can carry one on any clip; today's StemAutomation type
 * can't express it, so it is read off the loose shape below and never
 * assigned back. */
interface LegacyResonanceCurves {
  filterResonance?: unknown
}

/** One saved curve, or null for anything that isn't a usable list of
 * breakpoints -- a `.sssketchproj` is plain JSON people can and do
 * hand-edit, and a load must never throw over one. Points themselves are
 * left exactly as found: averageAutomationValue normalises them itself. */
function legacyCurve(value: unknown): AutomationPoint[] | null {
  if (!Array.isArray(value)) return null
  const points = value.filter(
    (point): point is AutomationPoint =>
      typeof point === 'object' &&
      point !== null &&
      typeof (point as AutomationPoint).bar === 'number' &&
      typeof (point as AutomationPoint).value === 'number'
  )
  return points.length > 0 ? points : null
}

/**
 * Turns a project's drawn `filterResonance` curves into the per-clip
 * resonance DIAL that replaced them, and drops the curves.
 *
 * Resonance was a drawable lane for one day (2026-09-22) before Elling used
 * it -- "that's confusing to have it separate from cut though isn't it?" --
 * and it became a knob in the filter lane's own corner instead (see
 * AUTOMATION_PARAMS in @shared/toolkit for the full why). Unlike the
 * channel-scoped toolkit above, this one HAS an honest migration: the curve
 * and the dial are the same parameter in the same [0,1] units on the same
 * clip, so nothing has to be invented or re-keyed.
 *
 * **The rule, stated once: a curve becomes its own TIME-WEIGHTED AVERAGE.**
 * Not its value at bar 0, which a free-draw stroke often leaves at wherever
 * the hand happened to press, and not its peak, which would make every
 * migrated clip louder and sharper than it was. The average is "where this
 * parameter sat, most of the time" -- the one question a knob can answer.
 * averageAutomationValue weights by bars rather than by point count for the
 * same reason (see its own doc comment).
 *
 * The curve wins over any resonance already stored on the clip: there was
 * never a UI that could write that field, so in practice it is always 0,
 * and where a hand-edited file has both, the drawn one is the one somebody
 * actually made.
 *
 * An empty or malformed curve migrates to nothing at all -- the key is
 * simply dropped, leaving the clip's dial at whatever it already was, so a
 * lane someone opened and never drew in can't nudge a knob.
 */
function migrateResonanceCurvesToFilterDials(state: AppState): AppState {
  let changed = false
  const stemFilters: Record<string, StemFilterSettings> = { ...state.stemFilters }
  const stemAutomation: Record<string, StemAutomation> = { ...state.stemAutomation }

  for (const [key, automation] of Object.entries(stemAutomation)) {
    if (typeof automation !== 'object' || automation === null) continue
    const legacy = automation as StemAutomation & LegacyResonanceCurves
    if (!('filterResonance' in legacy)) continue
    changed = true

    const { filterResonance, ...rest } = legacy

    // An automation record with nothing left in it is deleted rather than
    // kept as {} -- the same shape writeCurve (store.ts) leaves behind when
    // a lane is cleared, so a migrated project is indistinguishable from
    // one edited today.
    if (Object.keys(rest).length === 0) delete stemAutomation[key]
    else stemAutomation[key] = rest

    const points = legacyCurve(filterResonance)
    if (!points) continue
    const existing = stemFilters[key]
    stemFilters[key] = {
      ...(existing ?? defaultFilterSettings()),
      resonance: averageAutomationValue(points)
    }
  }

  return changed ? { ...state, stemFilters, stemAutomation } : state
}

/** A `.sssketchproj` saved before 2026-09-22 carries the per-RIFFF edge
 * fades the old envelope drag wrote, in bars, keyed by groupId. Both keys
 * are optional: a project that never had a fade simply doesn't have them,
 * and an older one might have only one. */
interface LegacyEdgeFadeKeys {
  fadeIn?: unknown
  fadeOut?: unknown
}

/** One saved fade length, or 0 for anything that isn't a usable number --
 * a `.sssketchproj` is plain JSON that people can and do hand-edit, and a
 * load must never throw over one. */
function legacyFadeBars(record: unknown, groupId: string): number {
  if (typeof record !== 'object' || record === null) return 0
  const value = (record as Record<string, unknown>)[groupId]
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0
  return value
}

/**
 * Turns an old project's saved fadeIn/fadeOut into the equivalent `volume`
 * automation curve on every stem of the rifff that had them, so a project
 * someone already made goes on sounding the way they made it.
 *
 * Why this is a faithful translation rather than an approximation:
 * applyEdgeFade is the SAME function the lane's own edge grabbers call, so
 * a migrated fade is byte-for-byte a fade the user could have dragged
 * themselves -- and the level the fade rises to comes off the curve, which
 * on an untouched clip is 1.0, i.e. "full", exactly as the old envelope's
 * plateau meant "this clip's own gain". That gain (state.vol) is untouched
 * here: it stays the clip's LEVEL, and the curve is only its SHAPE, which
 * is the split the gain dial and the volume curve keep from here on.
 *
 * Fades were a per-RIFFF field, so every stem of the rifff gets the same
 * curve -- the same fan-out SET_GROUP_VOLUME already does, and the same
 * thing a collapsed clip's own lane writes today. Expanding the clip
 * afterwards reveals per-stem lanes that can then diverge.
 *
 * One deliberate difference: the engine used to clamp a fade to half the
 * audible segment, so an oversized saved value (the old drag allowed up to
 * 4 bars, on a clip that might be 2) SOUNDED shorter than it was stored.
 * applyEdgeFade clamps to the clip's whole length instead, so such a fade
 * migrates to what was stored, not to what was heard. That only affects a
 * fade deliberately dragged longer than half its own clip.
 */
function migrateEdgeFadesToVolumeCurves(state: AppState, legacy: LegacyEdgeFadeKeys): AppState {
  let changed = false
  const stemAutomation: Record<string, StemAutomation> = { ...state.stemAutomation }

  for (const [groupId, rifff] of Object.entries(state.rifffs)) {
    const fadeInBars = legacyFadeBars(legacy.fadeIn, groupId)
    const fadeOutBars = legacyFadeBars(legacy.fadeOut, groupId)
    if (fadeInBars === 0 && fadeOutBars === 0) continue

    const lengthBars = clipLengthBars({
      playedBars: state.playedBars[groupId] ?? rifff.barLength,
      leftCropBars: state.leftCrop[groupId] ?? 0,
      stretchOn: state.stretch[groupId] ?? true,
      rifffBpm: rifff.bpm,
      stateBpm: state.bpm
    })
    if (!(lengthBars > 0)) continue

    for (const stem of rifff.stems) {
      const key = stemKey(groupId, stem.slot)
      const existing = stemAutomation[key]
      let points = existing?.volume ?? []
      if (fadeInBars > 0) {
        points = applyEdgeFade(points, { edge: 'start', bars: fadeInBars, lengthBars })
      }
      if (fadeOutBars > 0) {
        points = applyEdgeFade(points, { edge: 'end', bars: fadeOutBars, lengthBars })
      }
      stemAutomation[key] = { ...existing, volume: points }
      changed = true
    }
  }

  return changed ? { ...state, stemAutomation } : state
}

export function deserializeProject(
  data: (PersistedProject | LegacyPersistedProject) & {
    pluginStates?: PluginStatesMap
  } & ChannelScopedToolkitKeys &
    LegacyEdgeFadeKeys
): { state: AppState; pluginStates: PluginStatesMap } {
  const { pluginStates, fadeIn, fadeOut, ...projectData } = data
  // Narrowed off projectData itself, not off the stripped copy below -- the
  // strip returns an Omit over a union, which loses the discriminant that
  // tells a legacy trackOrder save apart from a channelOrder one.
  const migrated = 'channelOrder' in projectData ? {} : migrateTrackOrder(projectData.trackOrder)
  // fadeIn/fadeOut are pulled out of `data` above rather than spread in
  // here: they aren't AppState fields any more, and the curve they become
  // is written below, once the state they're measured against is assembled.
  const state = { ...initialState, ...dropChannelScopedToolkit(projectData), ...migrated }
  // SNAP_DIVS has grown/shrunk twice now: [4,8,16,32] -> [4,8,16] (dropped
  // the finest option), then -> [1,2,4,8,16] (two new, COARSER options
  // added at the front -- see its own doc comment). There's no persisted
  // format-version field to tell "this snapIdx was saved under an older
  // array shape" apart from "already the current one", so -- matching the
  // first change's own precedent below -- this doesn't attempt a real
  // index remap, just clamps out-of-range values. An old save's snapIdx
  // landing on a different divisor than it meant when saved (specifically:
  // the front-insertion silently reinterprets old 0/1/2 as 1/2/4 instead of
  // their original 4/8/16) only affects a rifff with a currently-UNBAKED
  // nonzero offsetSteps at the moment of upgrade -- already-baked clips are
  // immune (APPLY_BAKE always resets their off entry to 0) -- and even then
  // only shifts which beat that rifff's spectrogram grid highlights until
  // it's re-picked, not anything already committed to audio.
  if (state.snapIdx > 4) state.snapIdx = 4
  state.rifffs = snapBarLengthNoise(state.rifffs)
  // Risers came before their `name` and `muted` fields did, and a
  // `.sssketchproj` is plain JSON people can and do hand-edit -- so every
  // saved riser is brought up to today's shape here, once, before anything
  // renders it. Without this a pre-2026-09-23 project's rows would be
  // labelled "undefined" until something happened to dispatch against them.
  state.risers = normaliseLoadedRisers(state.risers)
  // The guided flow's own load rules, in one place (see sanitiseLoadedCoach
  // for the full why): which step you got to and how long each phase took
  // come back; his visibility and his clock do not. A flow saved mid-step
  // reopens 'dismissed', and the auto-arranger's guided route resumes it
  // exactly where it was -- because he "never appears on his own, not even
  // on an empty project" (spec), and because runningSince is an absolute
  // timestamp from a previous session, which left alone would report days
  // of time on one step and fire the stuck nudge on open.
  state.coach = sanitiseLoadedCoach(state.coach)
  // After snapBarLengthNoise, deliberately: a clip's length in bars is what
  // a migrated fade is measured against, so it has to be the repaired one.
  const withMigratedFades = migrateEdgeFadesToVolumeCurves(state, { fadeIn, fadeOut })
  // Last, and independent of everything above: it only ever reads and
  // removes filterResonance curves, which nothing else here touches.
  const migratedState = migrateResonanceCurvesToFilterDials(withMigratedFades)
  return {
    // Only SKETCH mode has an eligibility requirement -- normal and
    // automation are always showable, so a project that can't be sketched
    // only gets forced back to normal if it somehow arrived in sketch mode
    // (mode isn't persisted at all, so in practice this is defence against
    // a hand-edited file, not a path a save/load round trip takes).
    state:
      migratedState.mode !== 'sketch' || isSketchEligible(migratedState)
        ? migratedState
        : { ...migratedState, mode: 'normal' },
    pluginStates: pluginStates ?? {}
  }
}
