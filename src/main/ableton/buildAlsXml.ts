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
  findAllChildren,
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

// Counter for renumberIds, shared across every clone made during one
// buildAlsXml call so no two cloned elements anywhere in the output collide
// -- starts far above anything the template itself uses (its own Ids top
// out in the tens of thousands; see alsXmlHelpers.ts's renumberIds doc
// comment for why this is defensive, not a fix for a confirmed bug).
function makeIdAllocator(): () => number {
  let next = 1_000_000
  return () => next++
}

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
// marker reference (NOT for stretching; this export never re-renders
// audio). Meaningful for one-shots too: even though buildEngineProject.ts
// treats a one-shot's durationSec/barLength as "cosmetic" for its own
// ratio=1 stretch-skipping logic, they're still real, recorded numbers that
// make a perfectly good warp-marker reference for Ableton's own purposes.
//
// One useful, exact (not approximate) consequence: since nativeBpm is
// DERIVED from durationSec/barLength, stem.barLength*4 beats of warped time
// always equals precisely stem.durationSec real seconds -- i.e. the file's
// own full duration maps to exactly one tile cycle. computeLoopWindow below
// relies on this for its hiddenLoopEndBeats bound.
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
}

// The copied audio file is only stem.barLength bars long (see
// nativeBpmFor's doc comment) -- NOT playedBars bars long. sssketch's own
// engine reaches a longer playedBars-bar clip by tiling (repeating) that
// short file via its own LoopSewing.cpp mechanism; this export relies on
// Ableton's own ordinary LoopOn=true clip-loop tiling to do the same, since
// the copied file itself is never re-rendered/extended. Concretely:
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
//     enumerate individual repeats itself.
// One-shots are unaffected by any of this -- their own file already
// contains exactly the audio that should play (no tiling), so LoopOn=false
// and Loop*/CurrentEnd all come from trimStartSec/trimEndSec instead. See
// docs/superpowers/specs/2026-08-04-ableton-export-design.md's mapping
// section (and its "Known risks" entry on the loop-cycle wrap
// approximation for a cropped stem) for the fuller reasoning.
function computeLoopWindow(
  stem: Stem,
  nativeBpm: number,
  leftCropBars: number,
  playedBars: number
): LoopWindow {
  const beatsPerSecond = nativeBpm / 60

  if (stem.oneShot) {
    // hiddenLoopEndBeats is tied to loopEndBeats here, NOT stem.barLength*4
    // -- one-shots are never tile-bounded (see the doc comment above), so
    // this branch's HiddenLoopEnd stays exactly what it was before the
    // tile-cycle fix: the trim end, same as LoopEnd/CurrentEnd. Sharing
    // stem.barLength*4 across both branches here would silently widen a
    // trimmed one-shot's HiddenLoopEnd past its own trim end -- a real,
    // if low-impact (LoopOn=false, so inaudible unless someone manually
    // re-enables Loop on the clip in Ableton), unintended behavior change
    // caught in code review.
    const loopStartBeats = (stem.trimStartSec ?? 0) * beatsPerSecond
    const loopEndBeats = (stem.trimEndSec ?? stem.durationSec) * beatsPerSecond
    return {
      loopStartBeats,
      loopEndBeats,
      loopOn: false,
      timeShiftBars: 0,
      currentEndBeats: loopEndBeats,
      hiddenLoopEndBeats: loopEndBeats
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
    hiddenLoopEndBeats
  }
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
  playedBars: number
): AlsNode {
  const track = cloneNode(canonicalAudioTrack)
  renumberIds(track, nextId)

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
    hiddenLoopEndBeats
  } = computeLoopWindow(stem, nativeBpm, leftCropBars, playedBars)

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

  const relativePath = join('Samples', 'Imported', fileName)
  const absolutePath = join(outputDir, relativePath)
  const sampleRef = findChild(clipBody, 'SampleRef')!
  const fileRef = findChild(childArray(sampleRef, 'SampleRef'), 'FileRef')!
  const fileRefBody = childArray(fileRef, 'FileRef')
  setAttr(findChild(fileRefBody, 'Path')!, '@_Value', absolutePath)
  setAttr(findChild(fileRefBody, 'RelativePath')!, '@_Value', relativePath)

  setAttr(findChild(clipBody, 'WarpMode')!, '@_Value', String(warpModeFor(stem)))

  const warpMarkersNode = findChild(clipBody, 'WarpMarkers')!
  warpMarkersNode['WarpMarkers'] = [
    { WarpMarker: [], ':@': { '@_Id': String(nextId()), '@_SecTime': '0', '@_BeatTime': '0' } },
    {
      WarpMarker: [],
      ':@': { '@_Id': String(nextId()), '@_SecTime': String(60 / nativeBpm), '@_BeatTime': '1' }
    }
  ]

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
  const returnTracks = findAllChildren(tracks, 'ReturnTrack')

  const nextId = makeIdAllocator()
  const outTracks: AlsNode[] = [...returnTracks]

  const byChannel = placedRifffsByChannel(state)
  for (const channelId of state.channelOrder) {
    const rifffs = byChannel.get(channelId)
    if (!rifffs || rifffs.length === 0) continue

    const groupTrack = cloneNode(canonicalGroupTrack)
    renumberIds(groupTrack, nextId)
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
          playedBars
        )
        outTracks.push(track)
      }
    }
  }

  tracksNode['Tracks'] = outTracks

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
