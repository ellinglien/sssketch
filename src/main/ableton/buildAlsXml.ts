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
}

// One-shots: trimStartSec/trimEndSec (source-relative seconds) converted to
// beats via the stem's own native tempo, LoopOn=false (play once, no
// tiling). Everything else: leftCropBars/playedBars, LoopOn=true --
// playedBars is already an ABSOLUTE end-boundary measured from the clip's
// own start (confirmed against selectors.ts's own clipGeometryFromFields:
// visibleBars = playedBars - leftCropBars, NOT playedBars + leftCropBars),
// so LoopEnd is playedBars*4, not (leftCropBars+playedBars)*4. See
// docs/superpowers/specs/2026-08-04-ableton-export-design.md's mapping
// section for why LoopStart/LoopEnd still define the played region even
// with LoopOn=false.
function computeLoopWindow(
  stem: Stem,
  nativeBpm: number,
  leftCropBars: number,
  playedBars: number
): LoopWindow {
  if (stem.oneShot) {
    const beatsPerSecond = nativeBpm / 60
    return {
      loopStartBeats: (stem.trimStartSec ?? 0) * beatsPerSecond,
      loopEndBeats: (stem.trimEndSec ?? stem.durationSec) * beatsPerSecond,
      loopOn: false
    }
  }
  return {
    loopStartBeats: leftCropBars * 4,
    loopEndBeats: playedBars * 4,
    loopOn: true
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
  setAttr(clip, '@_Time', String((rifff.startBar ?? 0) * 4))

  const clipBody = childArray(clip, 'AudioClip')
  setAttr(findChild(clipBody, 'Name')!, '@_Value', trackName)

  const nativeBpm = nativeBpmFor(stem)
  const { loopStartBeats, loopEndBeats, loopOn } = computeLoopWindow(
    stem,
    nativeBpm,
    leftCropBars,
    playedBars
  )

  setAttr(findChild(clipBody, 'CurrentStart')!, '@_Value', '0')
  setAttr(findChild(clipBody, 'CurrentEnd')!, '@_Value', String(loopEndBeats))

  const loop = findChild(clipBody, 'Loop')!
  const loopBody = childArray(loop, 'Loop')
  setAttr(findChild(loopBody, 'LoopStart')!, '@_Value', String(loopStartBeats))
  setAttr(findChild(loopBody, 'LoopEnd')!, '@_Value', String(loopEndBeats))
  setAttr(findChild(loopBody, 'LoopOn')!, '@_Value', loopOn ? 'true' : 'false')
  setAttr(findChild(loopBody, 'HiddenLoopStart')!, '@_Value', '0')
  setAttr(findChild(loopBody, 'HiddenLoopEnd')!, '@_Value', String(loopEndBeats))

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
