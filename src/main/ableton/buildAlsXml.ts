// src/main/ableton/buildAlsXml.ts
import { join } from 'node:path'
import type { AppState } from '../../renderer/src/state/store'
import type { BusId, Rifff, Stem, SoundType } from '@shared/types'
import { stemKey } from '@shared/types'
import { parseKeyToAbletonScale } from './scaleMapping'
import { packIntoTracks } from '@shared/packIntoTracks'
import { clipLengthBars, edgeFadeState } from '@shared/automationEdit'
import { busGroupName, summarizeSoundTypes } from '@shared/busNaming'
import {
  filterCutoffHz,
  isStemToolkitNeutral,
  neutralCutoff,
  normaliseAutomationCurve,
  type AutomationPoint
} from '@shared/toolkit'
// TYPE-ONLY, and it has to stay that way: exportToolkitAudio.ts spawns engine
// subprocesses and imports Electron, while this file is a pure function with
// pure tests (see buildAlsXml's own doc comment).
import type { BakedClip, ToolkitExportOptions } from '../exportToolkitAudio'
import {
  parseAls,
  serializeAls,
  findChild,
  findAllChildren,
  childArray,
  attrs,
  setAttr,
  setColor,
  cloneNode,
  renumberIds,
  type AlsNode
} from './alsXmlHelpers'

// Ableton's own warp-mode enum (best-effort, based on commonly-documented
// community reverse-engineering, NOT independently verified against a real
// Ableton install -- see docs/superpowers/specs/
// 2026-08-04-ableton-export-design.md's "Known risks" section. If wrong,
// worst case a clip opens with the wrong (but still valid) warp mode --
// fixed with a couple of clicks per-clip in Ableton, not a file-corruption
// risk).
const WARP_MODE_BEATS = 0
const WARP_MODE_COMPLEX_PRO = 5

const PROJECT_BEATS_PER_BAR = 4

function secPerBarFor(projectBpm: number): number {
  return projectBpm > 0 ? (60 / projectBpm) * PROJECT_BEATS_PER_BAR : 0
}

// HYPOTHESIS, not verified against real Ableton (no Ableton available in
// the environment this was written in) -- see docs/superpowers/specs/
// 2026-08-11-ableton-volume-fade-export-design.md's "Real open question"
// section. Every OTHER timing field this file writes into a clip
// (CurrentStart/CurrentEnd/Time/WarpMarker BeatTime) is in arrangement
// beats, but FadeInLength/FadeOutLength are assumed here to be a
// different unit convention entirely -- an absolute sample count at the
// STEM'S OWN SOURCE FILE sample rate, a known Ableton .als XML quirk. If
// this turns out wrong, fix is confined to this one function.
function fadeSecToSampleCount(fadeSec: number, sampleRate: number): number {
  return Math.round(fadeSec * sampleRate)
}

/** Writes Fade/FadeInLength (or FadeOutLength) onto a clip, only when
 * there's an actual fade to write (fadeBars > 0) and a sample rate is
 * known to convert it with -- otherwise the template's own defaults
 * (Fade=false, length=0) are left untouched, which is exactly correct: no
 * fade. See fadeSecToSampleCount's own doc comment for the sample-count
 * unit caveat. */
function applyFade(
  clipBody: AlsNode[],
  fadeBars: number,
  projectBpm: number,
  sampleRate: number | undefined,
  segmentDurationBeats: number,
  field: 'FadeInLength' | 'FadeOutLength'
): void {
  if (fadeBars <= 0 || sampleRate === undefined) return
  // Matches FadeGain.cpp's own buildFadePoints halfDuration clamp -- real
  // playback never fades past half an audible segment's own length, so
  // the export shouldn't claim a longer fade than the clip could ever
  // actually contain.
  const segmentDurationSec =
    (segmentDurationBeats * secPerBarFor(projectBpm)) / PROJECT_BEATS_PER_BAR
  const maxFadeSec = segmentDurationSec / 2
  setAttr(findChild(clipBody, 'Fade')!, '@_Value', 'true')
  const fadesBody = childArray(findChild(clipBody, 'Fades')!, 'Fades')
  setAttr(
    findChild(fadesBody, field)!,
    '@_Value',
    String(
      fadeSecToSampleCount(Math.min(fadeBars * secPerBarFor(projectBpm), maxFadeSec), sampleRate)
    )
  )
}

// Ableton's own fixed palette index (0-69ish) per bus, applied to every
// group/track/clip that bus produces -- per direct feedback ("can we color
// code the groups and clips"). bass/lead/backing are NOT guesses: extracted
// directly from a real project the user hand-recolored in Ableton itself as
// a reference (2026-08-05-plush-nectar3234 project) -- bass's group, track,
// and every clip all used 65 originally; backing's used 67 uniformly the
// same way; lead's group+track used 53 (its own clips separately used 38,
// but this export keeps ONE color per bus end to end, matching the
// bass/backing majority pattern, rather than introducing a second "clip vs
// track" tier only lead had). drums/aux have no reference in that project
// (it didn't use either bus) -- drums was picked as a reasonably-distinct,
// unverified guess (0, a warm reddish tone, common "drums" convention in
// most DAWs), same "best-effort, adjust by hand afterward" caveat this
// file's own WARP_MODE_BEATS/WARP_MODE_COMPLEX_PRO constants already carry
// for a similarly unverifiable Ableton enum. drums/bass swapped 2026-08-21
// (same swap made in the renderer's busColorHex, theme/typeColor.ts, so the
// in-app tidied-view preview and this export still agree with each other)
// -- meaning drums now exports as 65 (bass's real sampled color) and bass
// as 0 (drums's unverified guess); neither index is what that bus showed
// in the reference project anymore.
//
// aux was originally 16 (a cool neutral grey) -- changed 2026-09-01 to 22
// (an unverified guess at a warm tan/khaki swatch), matching the same
// grey-reads-as-muted-clip fix made to busColorHex in theme/typeColor.ts
// (see that file's own longer comment for the full reasoning). Same
// "adjust by hand in Ableton if this index isn't actually the tan it's
// assumed to be" caveat as drums above -- unlike drums/bass/lead/backing,
// this one was never checked against a real opened project.
const ABLETON_BUS_COLORS: Record<BusId, number> = {
  drums: 65,
  bass: 0,
  lead: 53,
  backing: 67,
  aux: 22
}

// Mirrors src/renderer/src/state/selectors.ts's resolvePlayedBars
// (re-implemented here rather than imported wholesale, matching
// nativeExport.ts's own loopLengthBarsFor precedent -- selectors.ts also
// exports React-adjacent selectors that assume renderer context).
function resolvePlayedBarsFor(state: AppState, groupId: string): number {
  const rifff = state.rifffs[groupId]
  return state.playedBars[groupId] ?? rifff.barLength
}

/**
 * A clip's edge fades, in bars, read back out of that stem's own drawn
 * `volume` automation curve -- the one place a clip's fades live now (see
 * applyEdgeFade/edgeFadeState in src/shared/automationEdit.ts). This used
 * to be state.fadeIn/state.fadeOut, a per-RIFFF pair the old envelope drag
 * wrote; curves are per STEM, so two stems of the same rifff can now export
 * different fades, which is simply what the user drew.
 *
 * Only the fade's LENGTH survives into the exported project: a DAW clip
 * fade always ramps between silence and the clip's own level, so a curve
 * that isn't an edge fade -- a mid-clip dip, a slow rise across the whole
 * clip -- exports as no fade at all and is silently lost here. That is the
 * honest limit of "translate automation into clip fades"; writing real
 * automation envelopes into the target project is section 4 of
 * docs/superpowers/specs/2026-09-22-builtin-sound-toolkit-design.md and has
 * not been built. Exported AUDIO is unaffected either way -- the engine
 * bakes the whole curve when it renders the stems.
 */
function edgeFadesFor(
  state: AppState,
  rifff: Rifff,
  stem: Stem,
  playedBars: number,
  leftCropBars: number
): { fadeInBars: number; fadeOutBars: number } {
  // Optional-chained on the map itself, matching buildEngineProject.ts's own
  // `state.stemAutomation?.[key]`: an AppState that predates the toolkit (or
  // a hand-built one) simply has no such record.
  const curve = state.stemAutomation?.[stemKey(rifff.groupId, stem.slot)]?.volume ?? []
  if (curve.length === 0) return { fadeInBars: 0, fadeOutBars: 0 }
  const lengthBars = clipLengthBars({
    playedBars,
    leftCropBars,
    stretchOn: state.stretch[rifff.groupId] ?? true,
    rifffBpm: rifff.bpm,
    stateBpm: state.bpm
  })
  return {
    fadeInBars: edgeFadeState(curve, 'start', lengthBars).bars,
    fadeOutBars: edgeFadeState(curve, 'end', lengthBars).bars
  }
}

// A stem's own native tempo, derived the same way buildEngineProject.ts
// derives it for stretch-ratio purposes -- reused here purely as a warp-
// marker reference for a TILED (non-one-shot) stem's WarpMarkers (NOT for
// stretching; this export never re-renders audio). NOT meaningful for a
// one-shot: every one-shot/recorded-take has a hardcoded, cosmetic
// barLength=1 (importOneShot.ts), so this function is only ever called for
// its result to be used by buildStemClips's tiled-stem warp-marker write,
// gated on isWarped -- see computeLoopWindow's own isWarped doc comment for
// why a one-shot must never use this value.
//
// One useful, exact (not approximate) consequence for the tiled case:
// since nativeBpm is DERIVED from durationSec/barLength, stem.barLength*4
// beats of warped time always equals precisely stem.durationSec real
// seconds -- i.e. the file's own full duration maps to exactly one tile
// cycle. computeLoopWindow's non-one-shot branch relies on this for its
// hiddenLoopEndBeats bound.
function nativeBpmFor(stem: Stem): number {
  const secPerBar = stem.durationSec / stem.barLength
  return 240 / secPerBar // (60 / secPerBar) beats/min-per-bar-unit * 4 beats/bar
}

function warpModeFor(stem: Stem): number {
  return stem.type === 'drums' ? WARP_MODE_BEATS : WARP_MODE_COMPLEX_PRO
}

interface LoopWindow {
  loopStartBeats: number
  loopEndBeats: number
  loopOn: boolean
  /** Added to rifff.startBar (in BARS, not beats) for the clip's own Time
   * attribute -- 0 for one-shots (no crop concept applies to them), raw
   * (unwrapped) leftCropBars for everything else. */
  timeShiftBars: number
  /** The clip's own CurrentEnd -- its arrangement-visible duration, in
   * beats. NOT the same thing as loopEndBeats (see the doc comment below):
   * for a tiled (non-one-shot) stem this can be far longer than one loop
   * cycle, since Ableton repeats [loopStartBeats, loopEndBeats) to fill it. */
  currentEndBeats: number
  /** Used for HiddenLoopEnd. For a tiled (non-one-shot) stem, the sample's
   * own real, full extent in beats -- stem.barLength*4 (see nativeBpmFor's
   * doc comment for why that's exact, not approximate). For a one-shot,
   * tracks loopEndBeats (the trim end) instead -- one-shots are never
   * tile-bounded, so this must stay a no-op relative to their own
   * LoopEnd/CurrentEnd (see computeLoopWindow's one-shot branch). */
  hiddenLoopEndBeats: number
  /** Whether this clip should be warped at all. true for a tiled
   * (non-one-shot) stem -- warping is what lets a short native-tempo file
   * play at the project's own tempo. false for a one-shot: forcing
   * IsWarped=true on a one-shot and deriving warp markers from
   * nativeBpmFor(stem) is a real bug this field exists to prevent -- every
   * one-shot/recorded-take stem has a hardcoded, cosmetic barLength=1 (see
   * importOneShot.ts), so nativeBpm is meaningless for them, and using it
   * anyway collapses every untrimmed one-shot's played length to exactly
   * one bar regardless of its real duration, then force-stretches the
   * whole sample to fit. Unwarped, the audio plays at its own true native
   * speed; loopStartBeats/loopEndBeats/currentEndBeats above are derived
   * from real seconds via the PROJECT's own current tempo instead (see
   * the one-shot branch below), which only changes how much
   * arrangement-timeline SPACE the clip occupies, never the audio's own
   * pitch/speed. */
  isWarped: boolean
}

// The copied audio file is only stem.barLength bars long (see
// nativeBpmFor's doc comment) -- NOT playedBars bars long. sssketch's own
// engine reaches a longer playedBars-bar clip by tiling (repeating) that
// short file via its own LoopSewing.cpp mechanism; this export relies on
// Ableton's own ordinary LoopOn=true clip-loop tiling to do the same, since
// the copied file itself is never re-rendered/extended. Concretely, for a
// NON-one-shot (tiled) stem:
//   - Loop*/HiddenLoop* define ONE TILE CYCLE (bounded by the sample's own
//     real duration, stem.barLength*4 beats) -- NOT the whole playedBars
//     span. leftCropBars only shifts which PHASE of that one tile Ableton
//     starts/loops from (wrapped mod stem.barLength) -- it can never push
//     LoopEnd past the sample's own real available audio, since there's no
//     more data to loop into past that point.
//   - The clip's own arrangement-visible span is a SEPARATE concern,
//     governed by Time (position) and CurrentEnd (duration): Time shifts by
//     the RAW (unwrapped) leftCropBars -- a genuine position change on the
//     arrangement timeline, confirmed against selectors.ts's own
//     clipGeometryFromFields ("leftPx: (startBar + leftCropBars) * ppb")
//     and native-engine/Source/PlaybackEngineTests.cpp's own "leftCropBars
//     clips the first tile without moving startBar" test. CurrentEnd =
//     (playedBars - leftCropBars) * 4 (clipGeometryFromFields's own
//     "visibleBars"). LoopOn=true makes Ableton repeat the loop cycle
//     automatically to fill however long CurrentEnd says the clip should
//     be, mirroring sssketch's own tiling without this export needing to
//     enumerate individual repeats itself. isWarped=true, since warping is
//     exactly what makes a short native-tempo file play at the project's
//     own tempo.
// ONE-SHOTS are unaffected by the tiling logic above (their own file
// already contains exactly the audio that should play, no tiling), but
// need their OWN tempo handling entirely separate from nativeBpm -- a real
// bug found in whole-feature review, not per-task review, since it only
// shows up when cross-referencing this file against importOneShot.ts's own
// "barLength=1 is cosmetic" convention. isWarped=false: LoopStart/LoopEnd/
// CurrentEnd/HiddenLoopEnd are all derived from real seconds via the
// PROJECT's own current tempo (the projectBpm parameter), not any per-stem
// "native" tempo -- unwarped audio plays at its own true native speed
// regardless of Set tempo, simply occupying proportionally more or less
// arrangement-timeline beats as the Set tempo changes. See
// docs/superpowers/specs/2026-08-04-ableton-export-design.md's mapping
// section (and its "Known risks" entries on the loop-cycle wrap
// approximation for a cropped stem, and on the unwarped-clip
// representation being unconfirmed against a real reference example) for
// the fuller reasoning.
function computeLoopWindow(
  stem: Stem,
  leftCropBars: number,
  playedBars: number,
  projectBpm: number
): LoopWindow {
  if (stem.oneShot) {
    const projectBeatsPerSecond = projectBpm / 60
    const loopStartBeats = (stem.trimStartSec ?? 0) * projectBeatsPerSecond
    const loopEndBeats = (stem.trimEndSec ?? stem.durationSec) * projectBeatsPerSecond
    return {
      loopStartBeats,
      loopEndBeats,
      loopOn: false,
      timeShiftBars: 0,
      currentEndBeats: loopEndBeats,
      hiddenLoopEndBeats: loopEndBeats,
      isWarped: false
    }
  }

  const hiddenLoopEndBeats = stem.barLength * 4
  const wrappedLeftCropBars = ((leftCropBars % stem.barLength) + stem.barLength) % stem.barLength
  return {
    loopStartBeats: wrappedLeftCropBars * 4,
    loopEndBeats: hiddenLoopEndBeats,
    loopOn: true,
    timeShiftBars: leftCropBars,
    // Assumes leftCropBars < playedBars, so this never goes to zero/
    // negative -- true today because the only way to set leftCropBars is
    // via StemWaveformRow.tsx/CollapsedRifffRow.tsx's drag handlers, both
    // of which clamp it to at most (playedBars - MIN_PLAYED_BARS) before
    // dispatching. Not re-enforced here since buildAlsXml.ts has no
    // reasonable fallback if that UI-level invariant were ever violated --
    // flagging the assumption rather than silently tolerating a negative
    // CurrentEnd.
    currentEndBeats: (playedBars - leftCropBars) * 4,
    hiddenLoopEndBeats,
    isWarped: true
  }
}

/**
 * Empties every `<TrackSendHolder>` out of a cloned track's own `<Sends>`
 * (found at `<trackTag> > DeviceChain > Mixer > Sends`), leaving the
 * `<Sends>` element itself present but childless. This is only safe because
 * `<ReturnTrack>`s are dropped from the export entirely (see buildAlsXml's
 * own handling below) -- Ableton's per-track send-knob validation turned
 * out to require every non-return track's `<Sends>` to have exactly one
 * `<TrackSendHolder>` per `<ReturnTrack>` in the Set, so emptying it while
 * still shipping 2 ReturnTracks previously crashed Ableton outright. With
 * zero ReturnTracks, zero TrackSendHolders is the only valid state, and
 * there's no longer any Id scheme to get right at all. See
 * docs/superpowers/specs/2026-08-04-ableton-export-design.md's "Known
 * risks" for the full history of what didn't work before this.
 */
function clearSends(
  track: AlsNode,
  trackTag: 'AudioTrack' | 'GroupTrack' | 'ReturnTrack',
  /** How many `<TrackSendHolder>`s to LEAVE in place -- 0 everywhere, except
   * in the toolkit's `automation` export mode, which keeps exactly one
   * ReturnTrack (the stock Reverb our single shared bus maps onto) and so
   * needs exactly one holder per track. The rule that matters, learned the
   * expensive way, is that the two counts must AGREE: it was 0 holders
   * against 2 returns that crashed Ableton outright, not the holders
   * themselves. */
  keep = 0
): void {
  const body = childArray(track, trackTag)
  const deviceChain = findChild(body, 'DeviceChain')!
  const mixer = findChild(childArray(deviceChain, 'DeviceChain'), 'Mixer')!
  const sends = findChild(childArray(mixer, 'Mixer'), 'Sends')!
  sends['Sends'] = childArray(sends, 'Sends').slice(0, keep)
}

/** The `<Mixer>` inside a track of any kind. */
function mixerOf(track: AlsNode, trackTag: 'AudioTrack' | 'GroupTrack' | 'ReturnTrack'): AlsNode {
  const body = childArray(track, trackTag)
  const deviceChain = findChild(body, 'DeviceChain')!
  return findChild(childArray(deviceChain, 'DeviceChain'), 'Mixer')!
}

/** The `<Devices>` list a track's own effects live in --
 * `DeviceChain > DeviceChain > Devices`, NOT the outer DeviceChain (which
 * holds the mixer and the sequencer). Empty on the template's audio track,
 * which is what the Auto Filter gets appended to. */
function devicesOf(track: AlsNode, trackTag: 'AudioTrack' | 'GroupTrack'): AlsNode {
  const body = childArray(track, trackTag)
  const outer = findChild(body, 'DeviceChain')!
  const inner = findChild(childArray(outer, 'DeviceChain'), 'DeviceChain')!
  return findChild(childArray(inner, 'DeviceChain'), 'Devices')!
}

/**
 * The Id a parameter element's own `<AutomationTarget>` carries -- the number
 * an envelope's `<PointeeId>` has to equal for Ableton to connect the two.
 * That linkage IS the trick (docs/superpowers/references/
 * ableton12-automation-mapping.md); a PointeeId pointing at nothing produces
 * a device with an envelope that silently does nothing at all.
 *
 * Only ever read AFTER the containing track/device has been cloned and
 * renumberIds'd, or it would hand back the template's own Id and every
 * exported track would point its envelopes at the same parameter.
 */
function automationTargetId(param: AlsNode, tag: string): string {
  return attrs(findChild(childArray(param, tag), 'AutomationTarget')!)['@_Id']
}

/** `<Manual Value="..."/>`, the static value of a parameter element -- what a
 * knob sits at when no envelope is overriding it. */
function setManual(param: AlsNode, tag: string, value: number): void {
  setAttr(findChild(childArray(param, tag), 'Manual')!, '@_Value', String(value))
}

/** Ableton's own "before the timeline starts" sentinel Time, carrying the
 * value a parameter holds from the beginning of the Set until the first real
 * breakpoint. Copied from a real captured project; without it a parameter
 * reads as whatever its Manual says right up until the envelope's first
 * point, which for a filter sweep means the wrong cutoff for the whole intro. */
const BEFORE_TIMELINE_SENTINEL = -63072000

/** One `<FloatEvent Id Time Value/>`. Time is in BEATS (4 = one bar at 4/4) --
 * the single most important unit fact about this file's envelopes, and the
 * one that differs from REAPER's (seconds). */
function floatEvent(nextId: () => number, timeBeats: number, value: number): AlsNode {
  return {
    FloatEvent: [],
    ':@': {
      '@_Id': String(nextId()),
      '@_Time': String(timeBeats),
      '@_Value': String(value)
    }
  }
}

/**
 * Appends one `<AutomationEnvelope>` to a track's own
 * `AutomationEnvelopes > Envelopes`, pointed at `pointeeId`.
 *
 * The element's shape (EnvelopeTarget, Automation > Events, and the
 * AutomationTransformViewState that Ableton writes after them) is copied from
 * the template's own MainTrack tempo envelope -- a real Ableton-produced
 * example already sitting in this repo -- rather than from the shorter
 * illustration in the reference doc.
 */
function addTrackEnvelope(
  trackBody: AlsNode[],
  nextId: () => number,
  pointeeId: string,
  points: { timeBeats: number; value: number }[]
): void {
  if (points.length === 0) return
  const automationEnvelopes = findChild(trackBody, 'AutomationEnvelopes')!
  const envelopes = findChild(childArray(automationEnvelopes, 'AutomationEnvelopes'), 'Envelopes')!
  const events: AlsNode[] = [
    // The value the parameter holds before the first real point.
    floatEvent(nextId, BEFORE_TIMELINE_SENTINEL, points[0].value),
    ...points.map((point) => floatEvent(nextId, point.timeBeats, point.value))
  ]
  const envelope: AlsNode = {
    AutomationEnvelope: [
      { EnvelopeTarget: [{ PointeeId: [], ':@': { '@_Value': pointeeId } }] },
      {
        Automation: [
          { Events: events },
          {
            AutomationTransformViewState: [
              { IsTransformPending: [], ':@': { '@_Value': 'false' } },
              { TimeAndValueTransforms: [] }
            ]
          }
        ]
      }
    ],
    ':@': { '@_Id': String(nextId()) }
  }
  envelopes['Envelopes'] = [...childArray(envelopes, 'Envelopes'), envelope]
}

/** A drawn curve as envelope points, in absolute arrangement BEATS with its
 * values mapped into the target parameter's own units. Curve bars are
 * CLIP-relative (0 = the clip's own left edge, spec section 2b), so
 * `originBar` -- the same number buildEngineProject sends the engine as
 * EngineStemToolkit.originBar -- is what puts them back on the timeline. */
function curvePoints(
  curve: AutomationPoint[],
  originBar: number,
  mapValue: (value: number) => number
): { timeBeats: number; value: number }[] {
  return normaliseAutomationCurve(curve).map((point) => ({
    timeBeats: (originBar + point.bar) * 4,
    value: mapValue(point.value)
  }))
}

/** A send's own floor: Ableton's Send parameter bottoms out at -70dB, not at
 * zero (docs/superpowers/references/ableton12-automation-mapping.md). Writing
 * a real 0 is out of range for the parameter, so silence is this instead. */
const SEND_MIN = 0.0003162277571

function sendValue(value: number): number {
  return Math.max(SEND_MIN, Math.min(1, value))
}

/** Auto Filter's `Filter_Type` enum for our two modes. 0 is the captured
 * device's own value and the device is a lowpass in the capture, so that one
 * is ground truth; 1 for highpass is the obvious neighbour in a 0..9 list but
 * is NOT verified against real Ableton (no Ableton in this environment) --
 * same best-effort caveat this file's WARP_MODE_* constants already carry. If
 * it's wrong the exported device opens as the wrong filter shape, fixable with
 * one click per track, not a corrupt file. */
const FILTER_TYPE_LOWPASS = 0
const FILTER_TYPE_HIGHPASS = 1

interface AudibleSegment {
  segStartBeats: number
  segEndBeats: number
}

/** Given a clip's full [clipStartBeats, clipEndBeats) span and a stem's own
 * muted bar-ranges (converted to the same absolute-beats space as
 * clipStartBeats/clipEndBeats), returns the disjoint AUDIBLE sub-spans
 * remaining. A mute range outside the clip's own span is ignored; one that
 * fully covers the clip produces zero segments (nothing audible left).
 * Overlapping/adjacent mute ranges simply merge into one gap. */
function subtractMutedRanges(
  clipStartBeats: number,
  clipEndBeats: number,
  mutedRanges: { startBar: number; endBar: number }[]
): AudibleSegment[] {
  const sorted = mutedRanges
    .map((r) => ({ startBeats: r.startBar * 4, endBeats: r.endBar * 4 }))
    .sort((a, b) => a.startBeats - b.startBeats)
  const segments: AudibleSegment[] = []
  let cursor = clipStartBeats
  for (const range of sorted) {
    const rangeStart = Math.max(range.startBeats, clipStartBeats)
    const rangeEnd = Math.min(range.endBeats, clipEndBeats)
    if (rangeEnd <= cursor) continue
    if (rangeStart > cursor) segments.push({ segStartBeats: cursor, segEndBeats: rangeStart })
    cursor = Math.max(cursor, rangeEnd)
  }
  if (cursor < clipEndBeats) segments.push({ segStartBeats: cursor, segEndBeats: clipEndBeats })
  return segments
}

/** For a TILED (non-one-shot) stem's clip, the tile phase (in beats,
 * wrapped into [0, tileLengthBeats)) `elapsedBeatsFromClipStart` beats past
 * the clip's own ORIGINAL Time position -- i.e. "if a segment starts this
 * many beats after the clip's true beginning, which point in the tile
 * cycle is that?" Used so a segment resuming after a muted gap picks up
 * the SAME tile phase it would have had if the gap didn't exist, rather
 * than restarting the loop from originalLoopStartBeats every time. Mirrors
 * computeLoopWindow's own wrappedLeftCropBars wrapping, generalized to an
 * arbitrary elapsed offset instead of just leftCropBars itself. */
function tilePhaseAtElapsedBeats(
  originalLoopStartBeats: number,
  elapsedBeatsFromClipStart: number,
  tileLengthBeats: number
): number {
  const raw = originalLoopStartBeats + elapsedBeatsFromClipStart
  return ((raw % tileLengthBeats) + tileLengthBeats) % tileLengthBeats
}

/** The template's own canonical AudioClip, found by traversing
 * `canonicalAudioTrack` directly (never cloned) -- a read-only source
 * every stem's own clip segments get cloned FROM. Kept separate from
 * building a real track so many different stems can share one physical
 * Ableton track (see buildSharedAudioTrack) while each still gets its own
 * fully-renumbered clip elements. */
function findCanonicalClip(canonicalAudioTrack: AlsNode): AlsNode {
  const body = childArray(canonicalAudioTrack, 'AudioTrack')
  const deviceChain = findChild(body, 'DeviceChain')!
  const mainSeq = findChild(childArray(deviceChain, 'DeviceChain'), 'MainSequencer')!
  const sample = findChild(childArray(mainSeq, 'MainSequencer'), 'Sample')!
  const arrangerAuto = findChild(childArray(sample, 'Sample'), 'ArrangerAutomation')!
  const events = findChild(childArray(arrangerAuto, 'ArrangerAutomation'), 'Events')!
  return findChild(childArray(events, 'Events'), 'AudioClip')!
}

interface StemClipsResult {
  clips: AlsNode[]
  trackName: string
  /** stemKey(groupId, slot) -- carried so the track-building pass can find
   * this stem's own curves/filter/send again when it's writing real
   * automation onto the track (the `automation` export mode). */
  key: string
  /** The ABSOLUTE bar this stem's clip-relative curves are measured from --
   * the clip's own left edge. The same number buildEngineProject.ts sends the
   * engine as EngineStemToolkit.originBar, derived the same way, so an
   * exported envelope lands where the drawn line was. */
  originBar: number
  /** This stem's own SoundType (drums/notes/bass/etc, see @shared/types) --
   * carried alongside the clip geometry purely so the bus/shared-track
   * naming below (busGroupName/uniqueSharedTrackName) can summarize what's
   * actually IN a bus, instead of just repeating the bare bus id on every
   * group and an indistinguishable "<bus> (shared)" on every packed
   * track. */
  soundType: SoundType
  /** This stem's own OVERALL span, pre-mute-region-trimming (the clip's
   * full un-split extent, not the narrower bounds of its actual audible
   * segments) -- used as ONE indivisible packable unit by packIntoTracks.
   * Deliberately conservative: if a mute region eats into the very start
   * or end, the true audible span is narrower than this, but using the
   * wider span only ever makes packIntoTracks open a track slightly
   * earlier/later than strictly necessary, never causes a real overlap to
   * go undetected. Same "packing doesn't go finer than stem granularity"
   * simplification as the internal-mute-gap case documented in
   * docs/superpowers/plans/2026-08-05-stem-bus-clustering-implementation.md's
   * Task 4. */
  startBeats: number
  endBeats: number
}

/**
 * Builds the AudioClip elements for one stem -- one per audible segment
 * (see subtractMutedRanges), each independently cloned from
 * `canonicalClipTemplate` and Id-renumbered via the shared `nextId`
 * counter. Does NOT build or clone a track -- callers combine multiple
 * stems' clips onto a shared AudioTrack via packIntoTracks, since
 * Ableton's own audio track can only play one clip at a time but
 * different (non-overlapping) stems can still share one.
 */
function buildStemClips(
  canonicalClipTemplate: AlsNode,
  nextId: () => number,
  rifff: Rifff,
  stem: Stem,
  fileName: string,
  outputDir: string,
  leftCropBars: number,
  playedBars: number,
  projectBpm: number,
  muteRegions: AppState['muteRegions'],
  colorIndex: number,
  volume: number,
  fadeInBars: number,
  fadeOutBars: number,
  sampleRate: number | undefined
): StemClipsResult {
  const trackName = `${rifff.name} - ${stem.name}`
  const nativeBpm = nativeBpmFor(stem)
  const {
    loopStartBeats,
    loopEndBeats,
    loopOn,
    timeShiftBars,
    currentEndBeats,
    hiddenLoopEndBeats,
    isWarped
  } = computeLoopWindow(stem, leftCropBars, playedBars, projectBpm)

  // CurrentStart/CurrentEnd are ABSOLUTE arrangement-beat positions -- the
  // same coordinate space as Time, NOT a duration relative to it. See the
  // module-level history note above computeLoopWindow for why (a real
  // Ableton "Repair... Delete clip because its length is too small" bug
  // this convention avoids).
  const clipStartBeats = ((rifff.startBar ?? 0) + timeShiftBars) * 4
  const clipEndBeats = clipStartBeats + currentEndBeats
  const muteRegionsForStem = muteRegions[stemKey(rifff.groupId, stem.slot)] ?? []
  const audibleSegments = subtractMutedRanges(clipStartBeats, clipEndBeats, muteRegionsForStem)

  const relativePath = join('Samples', 'Imported', fileName)
  const absolutePath = join(outputDir, relativePath)
  const tileLengthBeats = stem.barLength * 4

  const clips = audibleSegments.map((segment, segmentIndex) => {
    const segClip = cloneNode(canonicalClipTemplate)
    renumberIds(segClip, nextId)

    setAttr(segClip, '@_Time', String(segment.segStartBeats))
    const clipBody = childArray(segClip, 'AudioClip')
    setAttr(findChild(clipBody, 'Name')!, '@_Value', trackName)
    setAttr(findChild(clipBody, 'CurrentStart')!, '@_Value', String(segment.segStartBeats))
    setAttr(findChild(clipBody, 'CurrentEnd')!, '@_Value', String(segment.segEndBeats))

    const loop = findChild(clipBody, 'Loop')!
    const loopBody = childArray(loop, 'Loop')
    // For a tiled (non-one-shot) stem, a segment resuming after a muted gap
    // must continue the tile's phase as if the gap never happened -- NOT
    // restart the loop from loopStartBeats -- or the audio would jump phase
    // right after every mute gap. A one-shot has no tiling concept at all
    // (isWarped=false), so it just keeps the same loopStartBeats/loopEndBeats
    // computed once above for every segment.
    const segLoopStartBeats = isWarped
      ? tilePhaseAtElapsedBeats(
          loopStartBeats,
          segment.segStartBeats - clipStartBeats,
          tileLengthBeats
        )
      : loopStartBeats
    setAttr(findChild(loopBody, 'LoopStart')!, '@_Value', String(segLoopStartBeats))
    setAttr(findChild(loopBody, 'LoopEnd')!, '@_Value', String(loopEndBeats))
    setAttr(findChild(loopBody, 'LoopOn')!, '@_Value', loopOn ? 'true' : 'false')
    setAttr(findChild(loopBody, 'HiddenLoopStart')!, '@_Value', '0')
    setAttr(findChild(loopBody, 'HiddenLoopEnd')!, '@_Value', String(hiddenLoopEndBeats))

    setAttr(findChild(clipBody, 'IsWarped')!, '@_Value', isWarped ? 'true' : 'false')

    const sampleRef = findChild(clipBody, 'SampleRef')!
    const fileRef = findChild(childArray(sampleRef, 'SampleRef'), 'FileRef')!
    const fileRefBody = childArray(fileRef, 'FileRef')
    setAttr(findChild(fileRefBody, 'Path')!, '@_Value', absolutePath)
    setAttr(findChild(fileRefBody, 'RelativePath')!, '@_Value', relativePath)

    setAttr(findChild(clipBody, 'WarpMode')!, '@_Value', String(warpModeFor(stem)))
    setColor(clipBody, colorIndex)
    setAttr(findChild(clipBody, 'SampleVolume')!, '@_Value', String(volume))

    const segmentDurationBeats = segment.segEndBeats - segment.segStartBeats
    if (segmentIndex === 0) {
      applyFade(clipBody, fadeInBars, projectBpm, sampleRate, segmentDurationBeats, 'FadeInLength')
    }
    if (segmentIndex === audibleSegments.length - 1) {
      applyFade(
        clipBody,
        fadeOutBars,
        projectBpm,
        sampleRate,
        segmentDurationBeats,
        'FadeOutLength'
      )
    }

    // Only write custom warp markers when the clip is actually warped -- for
    // a one-shot (isWarped=false), nativeBpm is meaningless (see
    // computeLoopWindow's own doc comment), so leave the template's own
    // default WarpMarkers untouched rather than writing a fabricated value
    // that would be actively misleading if warp were ever manually
    // re-enabled on the clip in Ableton.
    if (isWarped) {
      const warpMarkersNode = findChild(clipBody, 'WarpMarkers')!
      warpMarkersNode['WarpMarkers'] = [
        { WarpMarker: [], ':@': { '@_Id': String(nextId()), '@_SecTime': '0', '@_BeatTime': '0' } },
        {
          WarpMarker: [],
          ':@': { '@_Id': String(nextId()), '@_SecTime': String(60 / nativeBpm), '@_BeatTime': '1' }
        }
      ]
    }

    return segClip
  })

  return {
    clips,
    trackName,
    key: stemKey(rifff.groupId, stem.slot),
    originBar: (rifff.startBar ?? 0) + (stem.oneShot ? 0 : leftCropBars),
    soundType: stem.type,
    startBeats: clipStartBeats,
    endBeats: clipEndBeats
  }
}

/**
 * ONE clip for a stem whose toolkit was rendered into its own WAV (the
 * "bake in" export mode -- see exportToolkitAudio.ts).
 *
 * Simpler than buildStemClips in every direction, because everything that
 * function has to express in clip fields is already in the audio:
 * - the render is laid out on the ARRANGEMENT's own timeline, so the source
 *   offset is the clip's own start and Loop* collapse onto CurrentStart/
 *   CurrentEnd. Nothing is warped (the baked file is already at the project's
 *   tempo) and nothing loops (it is already as long as the clip);
 * - no mute-region splitting: the mutes are baked, and splitting the clip
 *   would ALSO chop off a reverb tail ringing through a muted gap, which
 *   playback keeps;
 * - no fades: the drawn volume curve, edge fades included, is in the audio;
 * - SampleVolume 1: the gain dial is in the audio too, and applying it again
 *   would square it.
 *
 * `tailBars` is the room the render left past the clip's own end for the
 * reverb tail; the clip has to be that much longer or the export would trim
 * off audio it deliberately rendered.
 */
function buildBakedStemClip(
  canonicalClipTemplate: AlsNode,
  nextId: () => number,
  rifff: Rifff,
  stem: Stem,
  baked: BakedClip,
  outputDir: string,
  leftCropBars: number,
  playedBars: number,
  projectBpm: number,
  colorIndex: number
): StemClipsResult {
  const trackName = `${rifff.name} - ${stem.name}`
  const startBar = rifff.startBar ?? 0
  const projectBeatsPerSecond = projectBpm / 60
  // A one-shot occupies its own trimmed real duration; everything else
  // occupies the bars it was resized to, starting at its cropped left edge.
  // Deliberately computed here rather than through computeLoopWindow: that
  // function's one-shot branch reports an END, not a duration, which is only
  // the same thing while trimStartSec is 0.
  const startBeats = stem.oneShot ? startBar * 4 : (startBar + leftCropBars) * 4
  const audibleBeats = stem.oneShot
    ? ((stem.trimEndSec ?? stem.durationSec) - (stem.trimStartSec ?? 0)) * projectBeatsPerSecond
    : (playedBars - leftCropBars) * 4
  const endBeats = startBeats + audibleBeats + baked.tailBars * 4

  const clip = cloneNode(canonicalClipTemplate)
  renumberIds(clip, nextId)
  setAttr(clip, '@_Time', String(startBeats))
  const clipBody = childArray(clip, 'AudioClip')
  setAttr(findChild(clipBody, 'Name')!, '@_Value', trackName)
  setAttr(findChild(clipBody, 'CurrentStart')!, '@_Value', String(startBeats))
  setAttr(findChild(clipBody, 'CurrentEnd')!, '@_Value', String(endBeats))

  const loopBody = childArray(findChild(clipBody, 'Loop')!, 'Loop')
  // For an UNWARPED clip these are sample time expressed in beats at the
  // project's own tempo (the same convention computeLoopWindow's one-shot
  // branch uses). The baked file's own time t seconds is arrangement beat
  // t * bps, so "where in the file does this clip start" is just its start.
  setAttr(findChild(loopBody, 'LoopStart')!, '@_Value', String(startBeats))
  setAttr(findChild(loopBody, 'LoopEnd')!, '@_Value', String(endBeats))
  setAttr(findChild(loopBody, 'LoopOn')!, '@_Value', 'false')
  setAttr(findChild(loopBody, 'HiddenLoopStart')!, '@_Value', '0')
  setAttr(findChild(loopBody, 'HiddenLoopEnd')!, '@_Value', String(endBeats))
  setAttr(findChild(clipBody, 'IsWarped')!, '@_Value', 'false')

  const relativePath = join('Samples', 'Imported', baked.fileName)
  const sampleRef = findChild(clipBody, 'SampleRef')!
  const fileRefBody = childArray(
    findChild(childArray(sampleRef, 'SampleRef'), 'FileRef')!,
    'FileRef'
  )
  setAttr(findChild(fileRefBody, 'Path')!, '@_Value', join(outputDir, relativePath))
  setAttr(findChild(fileRefBody, 'RelativePath')!, '@_Value', relativePath)

  setColor(clipBody, colorIndex)
  setAttr(findChild(clipBody, 'SampleVolume')!, '@_Value', '1')

  return {
    clips: [clip],
    trackName,
    key: stemKey(rifff.groupId, stem.slot),
    originBar: startBar + (stem.oneShot ? 0 : leftCropBars),
    soundType: stem.type,
    startBeats,
    endBeats
  }
}

/**
 * Sets a track/group's display name -- on BOTH EffectiveName and UserName,
 * not just EffectiveName alone. Confirmed the hard way (a real report, not
 * a guess): EffectiveName is a computed/cached value Ableton freely
 * recalculates from other data (the underlying sample's filename, or its
 * own auto-numbering scheme) the moment it does its own internal
 * normalize/save pass -- an exported name set only on EffectiveName reads
 * correctly in the freshly-exported file, but gets silently discarded and
 * replaced with Ableton's own defaults the moment the user saves inside
 * Ableton itself. UserName is the actual persistent override -- confirmed
 * by the ONE group a user manually renamed via Ableton's own UI (which
 * sets both fields) surviving a save intact, while every group/track this
 * export only set EffectiveName on did not.
 */
function setTrackName(nameNode: AlsNode, name: string): void {
  const nameBody = childArray(nameNode, 'Name')
  setAttr(findChild(nameBody, 'EffectiveName')!, '@_Value', name)
  setAttr(findChild(nameBody, 'UserName')!, '@_Value', name)
}

/**
 * Clones the template audio track once and populates it with the given
 * clips (already fully built/Id-renumbered by buildStemClips) -- used for
 * a bus's own packed tracks, where several non-overlapping stems' clips
 * can share one physical Ableton track. `trackName` is the label for this
 * specific physical track, not necessarily any one stem's own name (see
 * this task's caller in buildAlsXml, which picks a shared label when more
 * than one stem lands on the same track).
 */
function buildSharedAudioTrack(
  canonicalAudioTrack: AlsNode,
  nextId: () => number,
  groupTrackId: string,
  trackName: string,
  clips: AlsNode[],
  colorIndex: number,
  /** See clearSends: 0 normally, 1 in the mode that keeps a reverb return. */
  keepSends = 0
): AlsNode {
  const track = cloneNode(canonicalAudioTrack)
  renumberIds(track, nextId)
  clearSends(track, 'AudioTrack', keepSends)

  const trackBody = childArray(track, 'AudioTrack')
  setAttr(findChild(trackBody, 'TrackGroupId')!, '@_Value', groupTrackId)
  setTrackName(findChild(trackBody, 'Name')!, trackName)
  setColor(trackBody, colorIndex)

  const deviceChain = findChild(trackBody, 'DeviceChain')!
  const mainSeq = findChild(childArray(deviceChain, 'DeviceChain'), 'MainSequencer')!
  const sampleNode = findChild(childArray(mainSeq, 'MainSequencer'), 'Sample')!
  const arrangerAuto = findChild(childArray(sampleNode, 'Sample'), 'ArrangerAutomation')!
  const events = findChild(childArray(arrangerAuto, 'ArrangerAutomation'), 'Events')!
  events['Events'] = clips

  return track
}

/** Name for one physical track that several non-overlapping stems share
 * (packIntoTracks packed them together) -- summarizes what's actually on
 * THIS track, not the whole bus, so sibling shared tracks under the same
 * bus read as distinct rather than all being the literal same string (a
 * real usability problem: several "<bus> (shared)" tracks in Ableton's own
 * track list are otherwise impossible to tell apart). `usedNames` is
 * per-bus, threaded in by the caller, so a genuine remaining collision
 * (two shared tracks with an identical type summary) still gets a
 * disambiguating numeric suffix rather than silently duplicating a name. */
function uniqueSharedTrackName(
  busId: BusId,
  trackEntries: StemClipsResult[],
  usedNames: Map<string, number>
): string {
  const summary = summarizeSoundTypes(trackEntries.map((e) => e.soundType))
  const base = `${busId} (shared: ${summary})`
  const count = (usedNames.get(base) ?? 0) + 1
  usedNames.set(base, count)
  return count === 1 ? base : `${base} ${count}`
}

/** Whether any placed stem sends into the shared reverb at all -- either a
 * raised static send or a drawn `reverbSend` curve. The one question that
 * decides whether an exported Set carries a return track, so it's asked once,
 * up front, over the same placed stems the clip loop walks. */
function anyStemSends(state: AppState): boolean {
  for (const rifff of Object.values(state.rifffs)) {
    if (rifff.startBar === undefined) continue
    for (const stem of rifff.stems) {
      const key = stemKey(rifff.groupId, stem.slot)
      if ((state.stemSends?.[key] ?? 0) > 0) return true
      if ((state.stemAutomation?.[key]?.reverbSend?.length ?? 0) > 0) return true
    }
  }
  return false
}

/** Whether `tag` appears anywhere in this subtree -- used to pick the stock
 * Reverb return track out of the template's returns by what it CONTAINS
 * rather than by its position or its name, neither of which is guaranteed. */
function containsTag(node: AlsNode, tag: string): boolean {
  for (const key of Object.keys(node)) {
    if (key === ':@') continue
    if (key === tag) return true
    const children = node[key]
    if (!Array.isArray(children)) continue
    for (const child of children) if (containsTag(child, tag)) return true
  }
  return false
}

/**
 * Writes one stem's toolkit onto its own exported track as real Ableton
 * automation -- the `automation` export mode.
 *
 * Every mapping here comes from a real project Elling drew in Live 12.4.6 and
 * captured for this purpose (docs/superpowers/references/
 * ableton12-automation-mapping.md):
 * - gain dial -> the track's `Mixer/Volume` (linear gain, 1.0 = 0dB);
 * - `volume` curve -> an envelope on that same parameter, the dial multiplied
 *   THROUGH the curve, exactly as buildEngineProject.ts's scaleCurveByGain
 *   does for the engine, so what's exported is what's heard;
 * - `reverbSend` -> the track's one `TrackSendHolder`'s Send, floored at
 *   -70dB (Ableton's own bottom for that parameter, not zero);
 * - `filterCutoff` -> an Auto Filter emitted from the captured device, its
 *   `Filter_Frequency` automated in REAL Hz (this is the conversion REAPER's
 *   normalised parameter envelopes don't need);
 * - resonance -> that device's static `Filter_Resonance`, a knob, not a lane
 *   (spec section 2c).
 *
 * Only ever called with the track that holds exactly this one stem: in
 * automation mode tracks aren't packed, precisely because a track envelope
 * belongs to the whole track and would otherwise apply one stem's sweep to
 * whatever else shared it.
 */
function applyTrackToolkit(
  track: AlsNode,
  nextId: () => number,
  state: AppState,
  entry: StemClipsResult,
  autoFilterTemplate: AlsNode | undefined
): void {
  const key = entry.key
  const automation = state.stemAutomation?.[key]
  const filter = state.stemFilters?.[key]
  const send = state.stemSends?.[key] ?? 0
  if (isStemToolkitNeutral(filter, send, automation)) return

  const trackBody = childArray(track, 'AudioTrack')
  const mixerBody = childArray(mixerOf(track, 'AudioTrack'), 'Mixer')
  const gain = state.vol[key] ?? 1

  const volume = findChild(mixerBody, 'Volume')!
  setManual(volume, 'Volume', gain)
  const volumeCurve = automation?.volume ?? []
  if (volumeCurve.length > 0) {
    addTrackEnvelope(
      trackBody,
      nextId,
      automationTargetId(volume, 'Volume'),
      curvePoints(volumeCurve, entry.originBar, (value) => value * gain)
    )
  }

  const sendCurve = automation?.reverbSend ?? []
  const holder = findChild(childArray(findChild(mixerBody, 'Sends')!, 'Sends'), 'TrackSendHolder')
  if (holder && (send > 0 || sendCurve.length > 0)) {
    const sendParam = findChild(childArray(holder, 'TrackSendHolder'), 'Send')!
    setManual(sendParam, 'Send', sendValue(send))
    if (sendCurve.length > 0) {
      addTrackEnvelope(
        trackBody,
        nextId,
        automationTargetId(sendParam, 'Send'),
        curvePoints(sendCurve, entry.originBar, sendValue)
      )
    }
  }

  const cutoffCurve = automation?.filterCutoff ?? []
  const mode = filter?.mode ?? 'lowpass'
  const cutoff = filter?.cutoff ?? neutralCutoff(mode)
  const filterDoesSomething =
    cutoffCurve.length > 0 || Math.abs(cutoff - neutralCutoff(mode)) > 1e-6
  if (!filterDoesSomething || !autoFilterTemplate) return

  // An Auto Filter is far too big to synthesise by hand (21KB of parameters),
  // so it's emitted from the captured device with fresh Ids -- the same
  // clone-and-renumberIds treatment every exported track already gets, which
  // is what stops two tracks' devices pointing their envelopes at one
  // parameter.
  const device = cloneNode(autoFilterTemplate)
  renumberIds(device, nextId)
  const deviceBody = childArray(device, 'AutoFilter2')
  const frequency = findChild(deviceBody, 'Filter_Frequency')!
  setManual(frequency, 'Filter_Frequency', filterCutoffHz(cutoff))
  setManual(findChild(deviceBody, 'Filter_Resonance')!, 'Filter_Resonance', filter?.resonance ?? 0)
  setManual(
    findChild(deviceBody, 'Filter_Type')!,
    'Filter_Type',
    mode === 'lowpass' ? FILTER_TYPE_LOWPASS : FILTER_TYPE_HIGHPASS
  )
  const devices = devicesOf(track, 'AudioTrack')
  devices['Devices'] = [...childArray(devices, 'Devices'), device]

  if (cutoffCurve.length > 0) {
    addTrackEnvelope(
      trackBody,
      nextId,
      automationTargetId(frequency, 'Filter_Frequency'),
      curvePoints(cutoffCurve, entry.originBar, filterCutoffHz)
    )
  }
}

/** One riser's clip. Risers are generated audio with no source file at all,
 * so they are ALWAYS exported as rendered audio, in both modes (Elling's
 * decision, spec section 4) -- every placed riser is in ONE file laid out on
 * the arrangement's own timeline, so this is the same identity mapping a
 * baked clip uses. */
function buildRiserClip(
  canonicalClipTemplate: AlsNode,
  nextId: () => number,
  riser: { id: string; startBar: number; lengthBars: number },
  fileName: string,
  outputDir: string,
  colorIndex: number
): AlsNode {
  const clip = cloneNode(canonicalClipTemplate)
  renumberIds(clip, nextId)
  const startBeats = riser.startBar * 4
  const endBeats = (riser.startBar + riser.lengthBars) * 4
  setAttr(clip, '@_Time', String(startBeats))
  const clipBody = childArray(clip, 'AudioClip')
  setAttr(findChild(clipBody, 'Name')!, '@_Value', 'riser')
  setAttr(findChild(clipBody, 'CurrentStart')!, '@_Value', String(startBeats))
  setAttr(findChild(clipBody, 'CurrentEnd')!, '@_Value', String(endBeats))
  const loopBody = childArray(findChild(clipBody, 'Loop')!, 'Loop')
  setAttr(findChild(loopBody, 'LoopStart')!, '@_Value', String(startBeats))
  setAttr(findChild(loopBody, 'LoopEnd')!, '@_Value', String(endBeats))
  setAttr(findChild(loopBody, 'LoopOn')!, '@_Value', 'false')
  setAttr(findChild(loopBody, 'HiddenLoopStart')!, '@_Value', '0')
  setAttr(findChild(loopBody, 'HiddenLoopEnd')!, '@_Value', String(endBeats))
  setAttr(findChild(clipBody, 'IsWarped')!, '@_Value', 'false')
  const relativePath = join('Samples', 'Imported', fileName)
  const sampleRef = findChild(clipBody, 'SampleRef')!
  const fileRefBody = childArray(
    findChild(childArray(sampleRef, 'SampleRef'), 'FileRef')!,
    'FileRef'
  )
  setAttr(findChild(fileRefBody, 'Path')!, '@_Value', join(outputDir, relativePath))
  setAttr(findChild(fileRefBody, 'RelativePath')!, '@_Value', relativePath)
  setColor(clipBody, colorIndex)
  setAttr(findChild(clipBody, 'SampleVolume')!, '@_Value', '1')
  return clip
}

/** What the toolkit adds to an Ableton export: which mode the user picked,
 * what audio was rendered for it, and the captured Auto Filter device to
 * emit. `autoFilterXml` is passed in as TEXT for exactly the reason
 * templateXml is (see exportAbleton.ts's own note): vitest has no
 * electron-vite plugin to resolve a `?asset` import, so this function reads
 * no files at all. */
export interface AlsToolkitOptions extends ToolkitExportOptions {
  autoFilterXml?: string
}

/**
 * Builds the finished (ungzipped) .als XML text for the current arrangement.
 * Pure: no filesystem access beyond string path-joining (path.join never
 * touches disk). `stemFileNames` (keyed by stemKey(groupId, slot)) tells
 * this function which stems actually have audio to reference and under what
 * filename -- a stem missing from the map is skipped entirely (its copy
 * presumably failed; see exportAbleton.ts, Task 4). See
 * docs/superpowers/specs/2026-08-04-ableton-export-design.md for the full
 * mapping rationale.
 */
export function buildAlsXml(
  templateXml: string,
  state: AppState,
  outputDir: string,
  stemFileNames: Map<string, string>,
  stemSampleRates: Map<string, number> = new Map(),
  /** Defaults to "bake, with nothing rendered" -- which is exactly what a
   * project that uses none of the toolkit is, so such a project's export is
   * byte-for-byte what it was before this existed. */
  toolkit: AlsToolkitOptions = { mode: 'bake', toolkitAudio: { bakedClips: new Map() } }
): string {
  const automationMode = toolkit.mode === 'automation'
  const { bakedClips, riserFileName } = toolkit.toolkitAudio
  const autoFilterTemplate =
    automationMode && toolkit.autoFilterXml
      ? findChild(parseAls(toolkit.autoFilterXml), 'AutoFilter2')
      : undefined
  const doc = parseAls(templateXml)
  const ableton = findChild(doc, 'Ableton')!
  const abletonBody = childArray(ableton, 'Ableton')
  const liveSet = findChild(abletonBody, 'LiveSet')!
  const liveSetChildren = childArray(liveSet, 'LiveSet')
  const tracksNode = findChild(liveSetChildren, 'Tracks')!
  const tracks = childArray(tracksNode, 'Tracks')

  const canonicalAudioTrack = findChild(tracks, 'AudioTrack')!
  const canonicalGroupTrack = findChild(tracks, 'GroupTrack')!

  // <ReturnTrack>s are dropped from the export entirely -- not carried
  // over, not cloned. sssketch has no concept of sends/return-track
  // routing in its own data model, and after 8 real, confirmed failed
  // attempts to make cloned tracks' <Sends> agree with Ableton's own
  // (still not fully understood) per-track send-knob validation -- see
  // docs/superpowers/specs/2026-08-04-ableton-export-design.md's "Known
  // risks" for the full history -- the only approach that actually works
  // is removing the return tracks so there's no send-knob scheme to get
  // right at all: zero ReturnTracks means zero TrackSendHolders is the
  // only valid state for every other track's own <Sends> (see
  // clearSends). The exported project simply opens without the 2 default
  // reverb/delay returns pre-configured; the user adds their own once
  // they start mixing in Ableton.
  //
  // The `automation` export mode is the one exception, and it keeps exactly
  // ONE return: the stock Reverb our single shared reverb bus maps onto
  // (docs/superpowers/references/ableton12-automation-mapping.md -- "our
  // single shared reverb maps to ONE return track"). The history above isn't
  // a reason not to: what crashed Ableton was a MISMATCH -- tracks with zero
  // TrackSendHolders while the Set still declared 2 ReturnTracks. One return
  // and one holder per track is the same rule satisfied at a different count,
  // and every track this export emits goes through clearSends, so the count
  // is the same on all of them by construction. Unverifiable here (no Ableton
  // in this environment); this is the part of the export most worth opening
  // first.
  const keepReverbReturn = automationMode && anyStemSends(state)
  const sendsPreNode = findChild(liveSetChildren, 'SendsPre')!
  sendsPreNode['SendsPre'] = childArray(sendsPreNode, 'SendsPre').slice(0, keepReverbReturn ? 1 : 0)

  // A plain closure over an outer-scope counter (not a separate
  // makeIdAllocator helper) specifically so nextIdValue can be read back
  // after every clone/renumber is done, below -- Ableton's own
  // <NextPointeeId> element must be updated to reflect the highest Id this
  // export actually allocated, or Ableton refuses to open the file at all
  // (confirmed via a real "document is corrupt... NextPointeeId is too
  // low" error, not a guess). Starts far above anything the template
  // itself uses (its own Ids top out in the tens of thousands).
  let nextIdValue = 1_000_000
  const nextId = (): number => nextIdValue++
  const outTracks: AlsNode[] = []

  const BUS_IDS: BusId[] = ['drums', 'bass', 'lead', 'backing', 'aux']
  const DEFAULT_BUS: BusId = 'aux'
  const canonicalClipTemplate = findCanonicalClip(canonicalAudioTrack)

  const byBus = new Map<BusId, StemClipsResult[]>()
  for (const busId of BUS_IDS) byBus.set(busId, [])

  const placedForBuses = Object.values(state.rifffs).filter((r) => r.startBar !== undefined)
  for (const rifff of placedForBuses) {
    const playedBars = resolvePlayedBarsFor(state, rifff.groupId)
    const leftCropBars = state.leftCrop[rifff.groupId] ?? 0

    for (const stem of rifff.stems) {
      const key = stemKey(rifff.groupId, stem.slot)
      const fileName = stemFileNames.get(key)
      const baked = bakedClips.get(key)
      // A baked stem deliberately has no dry copy in Samples/Imported at all
      // (materializeStemsForExport skips it), so "no fileName" is normal for
      // one -- it's the stems with NEITHER that have nothing to reference.
      if (!baked && !fileName) continue

      // Computed before buildStemClips (not after, as this loop originally
      // did) so its own colorIndex can be threaded straight into the call
      // below -- see ABLETON_BUS_COLORS.
      const busId = state.busOf[key] ?? DEFAULT_BUS
      if (baked) {
        byBus
          .get(busId)!
          .push(
            buildBakedStemClip(
              canonicalClipTemplate,
              nextId,
              rifff,
              stem,
              baked,
              outputDir,
              leftCropBars,
              playedBars,
              state.bpm,
              ABLETON_BUS_COLORS[busId]
            )
          )
        continue
      }
      // In automation mode the gain dial becomes the TRACK's own Volume (see
      // applyTrackToolkit), so leaving it on the clip as well would apply it
      // twice; and a real volume envelope already contains the edge fades
      // edgeFadesFor exists to rescue, so writing clip fades too would fade
      // twice. Both drop out here rather than inside buildStemClips, which
      // knows nothing about export modes.
      //
      // Gated on this stem's toolkit doing something, because applyTrackToolkit
      // is: a clip nobody has drawn on gets no track Volume written, so moving
      // its dial off the clip as well would simply lose it.
      const toolkitOnThisStem =
        automationMode &&
        !isStemToolkitNeutral(
          state.stemFilters?.[key],
          state.stemSends?.[key],
          state.stemAutomation?.[key]
        )
      const volumeAutomated =
        automationMode && (state.stemAutomation?.[key]?.volume?.length ?? 0) > 0
      const edgeFades = volumeAutomated
        ? { fadeInBars: 0, fadeOutBars: 0 }
        : edgeFadesFor(state, rifff, stem, playedBars, leftCropBars)
      const result = buildStemClips(
        canonicalClipTemplate,
        nextId,
        rifff,
        stem,
        fileName!,
        outputDir,
        leftCropBars,
        playedBars,
        state.bpm,
        state.muteRegions,
        ABLETON_BUS_COLORS[busId],
        // A fully-muted stem exports its clip at SampleVolume 0, not
        // whatever its own volume knob was -- rather than skipping the
        // stem entirely (as a fully-covered mute REGION does, see
        // muteRegions below), keeping it present at 0 lets it be
        // re-enabled with a single fader move directly in Ableton, which
        // isn't possible for a clip that was never exported.
        state.mute[key] ? 0 : toolkitOnThisStem ? 1 : (state.vol[key] ?? 1),
        edgeFades.fadeInBars,
        edgeFades.fadeOutBars,
        stemSampleRates.get(key)
      )
      if (result.clips.length === 0) continue // fully muted -- nothing to place

      byBus.get(busId)!.push(result)
    }
  }

  for (const busId of BUS_IDS) {
    const entries = byBus.get(busId)!
    if (entries.length === 0) continue

    const groupTrack = cloneNode(canonicalGroupTrack)
    renumberIds(groupTrack, nextId)
    clearSends(groupTrack, 'GroupTrack', keepReverbReturn ? 1 : 0)
    const groupTrackId = attrs(groupTrack)['@_Id']
    const groupTrackBody = childArray(groupTrack, 'GroupTrack')
    setTrackName(findChild(groupTrackBody, 'Name')!, busGroupName(busId, entries))
    setColor(groupTrackBody, ABLETON_BUS_COLORS[busId])
    outTracks.push(groupTrack)

    // In automation mode every stem gets its own track, deliberately: an
    // Ableton automation envelope belongs to the TRACK, so two stems packed
    // onto one would share one filter, one send and one volume shape between
    // them -- the first stem's sweep would be heard on the second. More
    // tracks is the honest price of envelopes that mean what they say.
    const packed = automationMode
      ? entries.map((entry) => [entry])
      : packIntoTracks(
          entries,
          (e) => e.startBeats,
          (e) => e.endBeats
        )
    const usedSharedTrackNames = new Map<string, number>()
    for (const trackEntries of packed) {
      const allClips = trackEntries.flatMap((e) => e.clips)
      // If only one stem landed on this physical track, use its own name
      // -- otherwise several stems share it (packed together because they
      // don't overlap in time), so name it from what's actually on it
      // instead of picking one arbitrarily.
      const trackName =
        trackEntries.length === 1
          ? trackEntries[0].trackName
          : uniqueSharedTrackName(busId, trackEntries, usedSharedTrackNames)
      const track = buildSharedAudioTrack(
        canonicalAudioTrack,
        nextId,
        groupTrackId,
        trackName,
        allClips,
        ABLETON_BUS_COLORS[busId],
        keepReverbReturn ? 1 : 0
      )
      if (automationMode) {
        applyTrackToolkit(track, nextId, state, trackEntries[0], autoFilterTemplate)
      }
      outTracks.push(track)
    }
  }

  // Risers: one top-level track (TrackGroupId -1 -- a riser belongs to a
  // channel, and a channel is not a bus, so there is no group to put it in),
  // packed the same way stems are so two overlapping risers don't land on one
  // Ableton track, which can only play one clip at a time. Present in BOTH
  // modes: a riser is generated, so it always exports as audio.
  if (riserFileName) {
    const risers = Object.values(state.risers ?? {}).sort(
      (a, b) => a.startBar - b.startBar || (a.id < b.id ? -1 : 1)
    )
    const packedRisers = packIntoTracks(
      risers,
      (r) => r.startBar,
      (r) => r.startBar + r.lengthBars
    )
    packedRisers.forEach((riserGroup, index) => {
      const clips = riserGroup.map((riser) =>
        buildRiserClip(
          canonicalClipTemplate,
          nextId,
          riser,
          riserFileName,
          outputDir,
          ABLETON_BUS_COLORS.aux
        )
      )
      outTracks.push(
        buildSharedAudioTrack(
          canonicalAudioTrack,
          nextId,
          '-1',
          index === 0 ? 'risers' : `risers ${index + 1}`,
          clips,
          ABLETON_BUS_COLORS.aux,
          keepReverbReturn ? 1 : 0
        )
      )
    })
  }

  // The one kept return track goes LAST, where Ableton's own Sets put their
  // returns (see the template) and where every track's single
  // TrackSendHolder is understood to point.
  if (keepReverbReturn) {
    const reverbReturn = findAllChildren(tracks, 'ReturnTrack').find((t) =>
      containsTag(t, 'Reverb')
    )
    if (reverbReturn) {
      const returnTrack = cloneNode(reverbReturn)
      renumberIds(returnTrack, nextId)
      clearSends(returnTrack, 'ReturnTrack', 1)
      const returnBody = childArray(returnTrack, 'ReturnTrack')
      setTrackName(findChild(returnBody, 'Name')!, 'reverb')
      // Whatever the captured project had automated on this return is not
      // ours and has nothing pointing at it here.
      const returnEnvelopes = findChild(returnBody, 'AutomationEnvelopes')
      if (returnEnvelopes) {
        const envelopes = findChild(childArray(returnEnvelopes, 'AutomationEnvelopes'), 'Envelopes')
        if (envelopes) envelopes['Envelopes'] = []
      }
      outTracks.push(returnTrack)
    }
  }

  tracksNode['Tracks'] = outTracks

  // Ableton validates NextPointeeId >= every Id actually used anywhere in
  // the document before it will open a Set -- confirmed the hard way (a
  // real "document is corrupt... NextPointeeId is too low" error), not
  // assumed. nextIdValue is already one past the highest Id allocated
  // above (every setter increments it before handing out a value), which
  // is exactly the field's own semantics ("next Id available to hand
  // out").
  const nextPointeeIdNode = findChild(liveSetChildren, 'NextPointeeId')!
  setAttr(nextPointeeIdNode, '@_Value', String(nextIdValue))

  // Set-level tempo.
  const mainTrack = findChild(liveSetChildren, 'MainTrack')!
  const mainTrackBody = childArray(mainTrack, 'MainTrack')
  const mtDeviceChain = findChild(mainTrackBody, 'DeviceChain')!
  const mtMixer = findChild(childArray(mtDeviceChain, 'DeviceChain'), 'Mixer')!
  const tempoNode = findChild(childArray(mtMixer, 'Mixer'), 'Tempo')!
  const tempoBody = childArray(tempoNode, 'Tempo')
  setAttr(findChild(tempoBody, 'Manual')!, '@_Value', String(state.bpm))

  // The template carries a leftover tempo AUTOMATION ENVELOPE, captured
  // from whatever real Ableton project template.xml was built from (see
  // MainTrack's own AutomationEnvelopes list). Confirmed the hard way (a
  // real "exported Set's tempo displays as the template's original
  // 123.4 no matter what Manual above says" report, not a guess): Ableton
  // always honors an active automation envelope over the raw Manual value
  // wherever it has a breakpoint, and this template's envelope has exactly
  // one, covering the whole timeline from the very start. sssketch has no
  // per-project tempo-automation concept of its own, so the fix is
  // removing the matching envelope entirely (found by Id, via the Tempo
  // element's own AutomationTarget) -- NOT rewriting its curve to track
  // state.bpm, which would just be re-deriving the same "one flat
  // breakpoint" shape by hand for no benefit.
  const tempoAutomationTargetId = attrs(findChild(tempoBody, 'AutomationTarget')!)['@_Id']
  const autoEnvelopesNode = findChild(mainTrackBody, 'AutomationEnvelopes')
  const envelopesNode = autoEnvelopesNode
    ? findChild(childArray(autoEnvelopesNode, 'AutomationEnvelopes'), 'Envelopes')
    : undefined
  if (envelopesNode) {
    envelopesNode['Envelopes'] = childArray(envelopesNode, 'Envelopes').filter((envelope) => {
      const target = findChild(childArray(envelope, 'AutomationEnvelope'), 'EnvelopeTarget')!
      const pointeeId = attrs(findChild(childArray(target, 'EnvelopeTarget'), 'PointeeId')!)[
        '@_Value'
      ]
      return pointeeId !== tempoAutomationTargetId
    })
  }

  // Set-level scale, from the earliest placed rifff with a parseable key.
  const placed = Object.values(state.rifffs)
    .filter((r) => r.startBar !== undefined)
    .sort((a, b) => (a.startBar ?? 0) - (b.startBar ?? 0))
  for (const rifff of placed) {
    const scale = parseKeyToAbletonScale(rifff.key)
    if (!scale) continue
    const scaleInfo = findChild(liveSetChildren, 'ScaleInformation')!
    const scaleBody = childArray(scaleInfo, 'ScaleInformation')
    setAttr(findChild(scaleBody, 'Root')!, '@_Value', String(scale.root))
    setAttr(findChild(scaleBody, 'Name')!, '@_Value', String(scale.name))
    break
  }

  return serializeAls(doc)
}
