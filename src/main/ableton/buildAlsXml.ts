// src/main/ableton/buildAlsXml.ts
import { join } from 'node:path'
import type { AppState } from '../../renderer/src/state/store'
import type { BusId, Rifff, Stem, SoundType } from '@shared/types'
import { stemKey } from '@shared/types'
import { parseKeyToAbletonScale } from './scaleMapping'
import { packIntoTracks } from '@shared/packIntoTracks'
import {
  parseAls,
  serializeAls,
  findChild,
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

// Ableton's own fixed palette index (0-69ish) per bus, applied to every
// group/track/clip that bus produces -- per direct feedback ("can we color
// code the groups and clips"). bass/lead/backing are NOT guesses: extracted
// directly from a real project the user hand-recolored in Ableton itself as
// a reference (2026-08-05-plush-nectar3234 project) -- bass's group, track,
// and every clip all used 65; backing's used 67 uniformly the same way;
// lead's group+track used 53 (its own clips separately used 38, but this
// export keeps ONE color per bus end to end, matching the bass/backing
// majority pattern, rather than introducing a second "clip vs track" tier
// only lead had). drums/aux have no reference in that project (it didn't
// use either bus) -- picked as reasonably-distinct, unverified guesses
// (0=a warm reddish tone, common "drums" convention in most DAWs; 16=a
// cooler neutral tone for the catch-all aux bus), same "best-effort,
// adjust by hand afterward" caveat this file's own WARP_MODE_BEATS/
// WARP_MODE_COMPLEX_PRO constants already carry for a similarly
// unverifiable Ableton enum.
const ABLETON_BUS_COLORS: Record<BusId, number> = {
  drums: 0,
  bass: 65,
  lead: 53,
  backing: 67,
  aux: 16
}

// Mirrors src/renderer/src/state/selectors.ts's resolvePlayedBars
// (re-implemented here rather than imported wholesale, matching
// nativeExport.ts's own loopLengthBarsFor precedent -- selectors.ts also
// exports React-adjacent selectors that assume renderer context).
function resolvePlayedBarsFor(state: AppState, groupId: string): number {
  const rifff = state.rifffs[groupId]
  return state.playedBars[groupId] ?? rifff.barLength
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
function clearSends(track: AlsNode, trackTag: 'AudioTrack' | 'GroupTrack'): void {
  const body = childArray(track, trackTag)
  const deviceChain = findChild(body, 'DeviceChain')!
  const mixer = findChild(childArray(deviceChain, 'DeviceChain'), 'Mixer')!
  const sends = findChild(childArray(mixer, 'Mixer'), 'Sends')!
  sends['Sends'] = []
}

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
  volume: number
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

  const clips = audibleSegments.map((segment) => {
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
    soundType: stem.type,
    startBeats: clipStartBeats,
    endBeats: clipEndBeats
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
  colorIndex: number
): AlsNode {
  const track = cloneNode(canonicalAudioTrack)
  renumberIds(track, nextId)
  clearSends(track, 'AudioTrack')

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

/** 'extInst' -> 'ext inst', 'audioIn' -> 'audio in' -- this app's own design
 * system calls for lowercase UI copy everywhere (see CLAUDE.md); SoundType's
 * own values are camelCase identifiers, not display text, so track names
 * built from them need this conversion rather than using them raw. */
function humanizeSoundType(type: SoundType): string {
  return type.replace(/([A-Z])/g, ' $1').toLowerCase()
}

/** The most common sound type(s) among a set of stems, as a short
 * human-readable summary -- e.g. "drums, notes" -- used to make bus/shared-
 * track names actually say something about what's IN them (see
 * busGroupName/uniqueSharedTrackName below), instead of just the bare bus
 * id repeated on every group and an indistinguishable "<bus> (shared)" on
 * every packed track. Capped at the top 3 types so a highly mixed bus
 * doesn't produce an unreadably long name. */
function summarizeSoundTypes(types: SoundType[]): string {
  const counts = new Map<SoundType, number>()
  for (const type of types) counts.set(type, (counts.get(type) ?? 0) + 1)
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1])
  return sorted
    .slice(0, 3)
    .map(([type]) => humanizeSoundType(type))
    .join(', ')
}

/** A bus's own GroupTrack name -- the bare bus id, plus a sound-type
 * summary UNLESS that summary would just repeat the bus id back verbatim
 * (e.g. a 'drums' bus made up entirely of 'drums'-typed stems gains nothing
 * from "drums — drums"). Upper-cased -- purely decorative, so the 5 fixed
 * bus groups stand out at a glance against the individual (lowercase)
 * track names inside them; this is Ableton-side export flavor, not this
 * app's own UI copy, so it doesn't conflict with sssketch's own
 * lowercase-everywhere design system convention. */
function busGroupName(busId: BusId, entries: StemClipsResult[]): string {
  const summary = summarizeSoundTypes(entries.map((e) => e.soundType))
  const name = summary === busId ? busId : `${busId} — ${summary}`
  return name.toUpperCase()
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
  stemFileNames: Map<string, string>
): string {
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
  const sendsPreNode = findChild(liveSetChildren, 'SendsPre')!
  sendsPreNode['SendsPre'] = []

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
      if (!fileName) continue

      // Computed before buildStemClips (not after, as this loop originally
      // did) so its own colorIndex can be threaded straight into the call
      // below -- see ABLETON_BUS_COLORS.
      const busId = state.busOf[key] ?? DEFAULT_BUS
      const result = buildStemClips(
        canonicalClipTemplate,
        nextId,
        rifff,
        stem,
        fileName,
        outputDir,
        leftCropBars,
        playedBars,
        state.bpm,
        state.muteRegions,
        ABLETON_BUS_COLORS[busId],
        state.vol[key] ?? 1
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
    clearSends(groupTrack, 'GroupTrack')
    const groupTrackId = attrs(groupTrack)['@_Id']
    const groupTrackBody = childArray(groupTrack, 'GroupTrack')
    setTrackName(findChild(groupTrackBody, 'Name')!, busGroupName(busId, entries))
    setColor(groupTrackBody, ABLETON_BUS_COLORS[busId])
    outTracks.push(groupTrack)

    const packed = packIntoTracks(
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
        ABLETON_BUS_COLORS[busId]
      )
      outTracks.push(track)
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
