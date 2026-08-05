// src/main/ableton/buildAlsXml.ts
import { join } from 'node:path'
import type { AppState } from '../../renderer/src/state/store'
import type { Rifff, Stem } from '@shared/types'
import { stemKey } from '@shared/types'
import { parseKeyToAbletonScale } from './scaleMapping'
import {
  parseAls,
  serializeAls,
  findChild,
  childArray,
  attrs,
  setAttr,
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

// Mirrors src/renderer/src/state/selectors.ts's resolvePlayedBars
// (re-implemented here rather than imported wholesale, matching
// nativeExport.ts's own loopLengthBarsFor precedent -- selectors.ts also
// exports React-adjacent selectors that assume renderer context).
function resolvePlayedBarsFor(state: AppState, groupId: string): number {
  const rifff = state.rifffs[groupId]
  return state.playedBars[groupId] ?? rifff.barLength
}

// Mirrors selectors.ts's channelsInOrder grouping (without the ordering/
// recording-channel concerns, which don't apply here -- a recording channel
// with nothing recorded onto it has nothing to export by definition).
function placedRifffsByChannel(state: AppState): Map<string, Rifff[]> {
  const byChannel = new Map<string, Rifff[]>()
  for (const rifff of Object.values(state.rifffs)) {
    if (rifff.startBar === undefined) continue
    const channelId = state.channelOf[rifff.groupId] ?? rifff.groupId
    const list = byChannel.get(channelId)
    if (list) list.push(rifff)
    else byChannel.set(channelId, [rifff])
  }
  return byChannel
}

function earliestRifff(rifffs: Rifff[]): Rifff {
  return [...rifffs].sort((a, b) => (a.startBar ?? 0) - (b.startBar ?? 0))[0]
}

// A stem's own native tempo, derived the same way buildEngineProject.ts
// derives it for stretch-ratio purposes -- reused here purely as a warp-
// marker reference for a TILED (non-one-shot) stem's WarpMarkers (NOT for
// stretching; this export never re-renders audio). NOT meaningful for a
// one-shot: every one-shot/recorded-take has a hardcoded, cosmetic
// barLength=1 (importOneShot.ts), so this function is only ever called for
// its result to be used by buildStemTrack's tiled-stem warp-marker write,
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

function findAudioClip(audioTrack: AlsNode): AlsNode {
  const body = childArray(audioTrack, 'AudioTrack')
  const deviceChain = findChild(body, 'DeviceChain')!
  const mainSeq = findChild(childArray(deviceChain, 'DeviceChain'), 'MainSequencer')!
  const sample = findChild(childArray(mainSeq, 'MainSequencer'), 'Sample')!
  const arrangerAuto = findChild(childArray(sample, 'Sample'), 'ArrangerAutomation')!
  const events = findChild(childArray(arrangerAuto, 'ArrangerAutomation'), 'Events')!
  return findChild(childArray(events, 'Events'), 'AudioClip')!
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

function buildStemTrack(
  canonicalAudioTrack: AlsNode,
  nextId: () => number,
  rifff: Rifff,
  stem: Stem,
  fileName: string,
  outputDir: string,
  groupTrackId: string,
  leftCropBars: number,
  playedBars: number,
  projectBpm: number
): AlsNode {
  const track = cloneNode(canonicalAudioTrack)
  renumberIds(track, nextId)
  clearSends(track, 'AudioTrack')

  const trackBody = childArray(track, 'AudioTrack')
  setAttr(findChild(trackBody, 'TrackGroupId')!, '@_Value', groupTrackId)

  const trackName = `${rifff.name} - ${stem.name}`
  const nameNode = findChild(trackBody, 'Name')!
  setAttr(findChild(childArray(nameNode, 'Name'), 'EffectiveName')!, '@_Value', trackName)

  const clip = findAudioClip(track)

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

  setAttr(clip, '@_Time', String(((rifff.startBar ?? 0) + timeShiftBars) * 4))

  const clipBody = childArray(clip, 'AudioClip')
  setAttr(findChild(clipBody, 'Name')!, '@_Value', trackName)

  setAttr(findChild(clipBody, 'CurrentStart')!, '@_Value', '0')
  setAttr(findChild(clipBody, 'CurrentEnd')!, '@_Value', String(currentEndBeats))

  const loop = findChild(clipBody, 'Loop')!
  const loopBody = childArray(loop, 'Loop')
  setAttr(findChild(loopBody, 'LoopStart')!, '@_Value', String(loopStartBeats))
  setAttr(findChild(loopBody, 'LoopEnd')!, '@_Value', String(loopEndBeats))
  setAttr(findChild(loopBody, 'LoopOn')!, '@_Value', loopOn ? 'true' : 'false')
  setAttr(findChild(loopBody, 'HiddenLoopStart')!, '@_Value', '0')
  setAttr(findChild(loopBody, 'HiddenLoopEnd')!, '@_Value', String(hiddenLoopEndBeats))

  setAttr(findChild(clipBody, 'IsWarped')!, '@_Value', isWarped ? 'true' : 'false')

  const relativePath = join('Samples', 'Imported', fileName)
  const absolutePath = join(outputDir, relativePath)
  const sampleRef = findChild(clipBody, 'SampleRef')!
  const fileRef = findChild(childArray(sampleRef, 'SampleRef'), 'FileRef')!
  const fileRefBody = childArray(fileRef, 'FileRef')
  setAttr(findChild(fileRefBody, 'Path')!, '@_Value', absolutePath)
  setAttr(findChild(fileRefBody, 'RelativePath')!, '@_Value', relativePath)

  setAttr(findChild(clipBody, 'WarpMode')!, '@_Value', String(warpModeFor(stem)))

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

  return track
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

  const byChannel = placedRifffsByChannel(state)
  for (const channelId of state.channelOrder) {
    const rifffs = byChannel.get(channelId)
    if (!rifffs || rifffs.length === 0) continue

    const groupTrack = cloneNode(canonicalGroupTrack)
    renumberIds(groupTrack, nextId)
    clearSends(groupTrack, 'GroupTrack')
    const groupTrackId = attrs(groupTrack)['@_Id']
    const groupName = earliestRifff(rifffs).name
    const groupNameNode = findChild(childArray(groupTrack, 'GroupTrack'), 'Name')!
    setAttr(findChild(childArray(groupNameNode, 'Name'), 'EffectiveName')!, '@_Value', groupName)
    outTracks.push(groupTrack)

    for (const rifff of rifffs) {
      const playedBars = resolvePlayedBarsFor(state, rifff.groupId)
      const leftCropBars = state.leftCrop[rifff.groupId] ?? 0

      for (const stem of rifff.stems) {
        const key = stemKey(rifff.groupId, stem.slot)
        const fileName = stemFileNames.get(key)
        if (!fileName) continue

        const track = buildStemTrack(
          canonicalAudioTrack,
          nextId,
          rifff,
          stem,
          fileName,
          outputDir,
          groupTrackId,
          leftCropBars,
          playedBars,
          state.bpm
        )
        outTracks.push(track)
      }
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
  const mtDeviceChain = findChild(childArray(mainTrack, 'MainTrack'), 'DeviceChain')!
  const mtMixer = findChild(childArray(mtDeviceChain, 'DeviceChain'), 'Mixer')!
  const tempoNode = findChild(childArray(mtMixer, 'Mixer'), 'Tempo')!
  setAttr(findChild(childArray(tempoNode, 'Tempo'), 'Manual')!, '@_Value', String(state.bpm))

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
