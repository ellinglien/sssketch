// src/main/ableton/buildAlsXml.test.ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { buildAlsXml } from './buildAlsXml'
import {
  parseAls,
  findChild,
  findAllChildren,
  childArray,
  attrs,
  type AlsNode
} from './alsXmlHelpers'
import type { AppState } from '../../renderer/src/state/store'
import type { Rifff } from '@shared/types'

// Mirrors engineProcess.test.ts / pluginScan.test.ts's own pattern for
// reading a real sibling file from a test -- __dirname isn't reliably
// available when vitest runs this file as ESM.
const TEMPLATE_PATH = join(dirname(fileURLToPath(import.meta.url)), 'template.xml')
const TEMPLATE_XML = readFileSync(TEMPLATE_PATH, 'utf-8')

function emptyAppState(overrides: Partial<AppState> = {}): AppState {
  return {
    bpm: 120,
    snapIdx: 0,
    vol: {},
    mute: {},
    off: {},
    stretch: {},
    fadeIn: {},
    fadeOut: {},
    playedBars: {},
    leftCrop: {},
    dragVol: {},
    dragFadeIn: {},
    dragFadeOut: {},
    dragPlayedBars: {},
    dragLeftCropBars: {},
    sel: null,
    channelOrder: [],
    channelOf: {},
    recordingChannelIds: {},
    rifffs: {},
    masterChain: [null, null, null, null],
    channelPlugins: {},
    mode: 'normal',
    ...overrides
  } as AppState
}

function drumsRifff(): Rifff {
  return {
    groupId: 'rifff-1',
    name: 'my-rifff',
    bpm: 140,
    barLength: 4,
    folderPath: '/fake/folder',
    startBar: 8,
    stems: [
      {
        slot: 0,
        author: 'someone',
        name: 'kick',
        type: 'drums',
        path: '/source/kick.wav',
        durationSec: (60 / 140) * 4 * 4, // exactly 4 bars at 140bpm
        barLength: 4
      }
    ]
  }
}

// A realistic one-shot fixture -- barLength: 1 is not an arbitrary test
// choice, it's what importOneShot.ts actually hardcodes for every real
// one-shot/recorded-take stem (its own doc comment: "cosmetic... the
// native engine ignores bpm/barLength for tiling/resampling purposes
// whenever a stem's oneShot is set"). durationSec is deliberately NOT a
// round multiple of any beat count, so a test using this fixture can't
// accidentally pass by coincidence the way it could with a duration that
// happens to land on a whole number of beats either way.
function realOneShotRifff(): Rifff {
  return {
    groupId: 'os-1',
    name: 'vox-hit',
    bpm: 120,
    barLength: 1,
    folderPath: '/fake/folder',
    startBar: 4,
    stems: [
      {
        slot: 0,
        author: 'someone',
        name: 'vox',
        type: 'sampler',
        path: '/source/vox.wav',
        durationSec: 2.7317,
        barLength: 1,
        oneShot: true
      }
    ]
  }
}

// Navigates from a parsed document down to the <Tracks> children array --
// every test below starts from here.
function tracksOf(xml: string): { liveSetChildren: AlsNode[]; tracks: AlsNode[] } {
  const doc = parseAls(xml)
  const ableton = findChild(doc, 'Ableton')!
  const liveSetBody = childArray(ableton, 'Ableton')
  const liveSet = findChild(liveSetBody, 'LiveSet')!
  const liveSetChildren = childArray(liveSet, 'LiveSet')
  const tracksNode = findChild(liveSetChildren, 'Tracks')!
  return { liveSetChildren, tracks: childArray(tracksNode, 'Tracks') }
}

describe('buildAlsXml', () => {
  it('produces one AudioTrack + one GroupTrack for a single placed rifff/stem, plus the two return tracks', () => {
    const state = emptyAppState({
      rifffs: { 'rifff-1': drumsRifff() },
      channelOrder: ['rifff-1'],
      channelOf: { 'rifff-1': 'rifff-1' }
    })
    const stemFileNames = new Map([['rifff-1:0', 'my-rifff-kick.wav']])

    const xml = buildAlsXml(TEMPLATE_XML, state, '/out', stemFileNames)
    const { tracks } = tracksOf(xml)

    expect(findAllChildren(tracks, 'ReturnTrack')).toHaveLength(2)
    expect(findAllChildren(tracks, 'GroupTrack')).toHaveLength(1)
    expect(findAllChildren(tracks, 'AudioTrack')).toHaveLength(1)
  })

  it('names the stem track "<rifff name> - <stem name>" and the group after the channel\'s earliest rifff', () => {
    const state = emptyAppState({
      rifffs: { 'rifff-1': drumsRifff() },
      channelOrder: ['rifff-1'],
      channelOf: { 'rifff-1': 'rifff-1' }
    })
    const stemFileNames = new Map([['rifff-1:0', 'my-rifff-kick.wav']])

    const xml = buildAlsXml(TEMPLATE_XML, state, '/out', stemFileNames)
    const { tracks } = tracksOf(xml)

    const audioTrack = findChild(tracks, 'AudioTrack')!
    const audioName = findChild(childArray(audioTrack, 'AudioTrack'), 'Name')!
    const audioEffName = findChild(childArray(audioName, 'Name'), 'EffectiveName')!
    expect(attrs(audioEffName)['@_Value']).toBe('my-rifff - kick')

    const groupTrack = findChild(tracks, 'GroupTrack')!
    const groupName = findChild(childArray(groupTrack, 'GroupTrack'), 'Name')!
    const groupEffName = findChild(childArray(groupName, 'Name'), 'EffectiveName')!
    expect(attrs(groupEffName)['@_Value']).toBe('my-rifff')
  })

  it('links the stem track to its group via TrackGroupId', () => {
    const state = emptyAppState({
      rifffs: { 'rifff-1': drumsRifff() },
      channelOrder: ['rifff-1'],
      channelOf: { 'rifff-1': 'rifff-1' }
    })
    const stemFileNames = new Map([['rifff-1:0', 'my-rifff-kick.wav']])

    const xml = buildAlsXml(TEMPLATE_XML, state, '/out', stemFileNames)
    const { tracks } = tracksOf(xml)

    const groupTrack = findChild(tracks, 'GroupTrack')!
    const groupId = attrs(groupTrack)['@_Id']

    const audioTrack = findChild(tracks, 'AudioTrack')!
    const trackGroupIdNode = findChild(childArray(audioTrack, 'AudioTrack'), 'TrackGroupId')!
    expect(attrs(trackGroupIdNode)['@_Value']).toBe(groupId)
  })

  it('places the clip at startBar*4 beats and sets its file path/relative path', () => {
    const state = emptyAppState({
      rifffs: { 'rifff-1': drumsRifff() }, // startBar: 8
      channelOrder: ['rifff-1'],
      channelOf: { 'rifff-1': 'rifff-1' }
    })
    const stemFileNames = new Map([['rifff-1:0', 'my-rifff-kick.wav']])

    const xml = buildAlsXml(TEMPLATE_XML, state, '/out', stemFileNames)
    const { tracks } = tracksOf(xml)
    const audioTrack = findChild(tracks, 'AudioTrack')!
    const clip = findAudioClip(audioTrack)

    expect(attrs(clip)['@_Time']).toBe('32') // 8 bars * 4 beats

    const clipBody = childArray(clip, 'AudioClip')
    const sampleRef = findChild(clipBody, 'SampleRef')!
    const fileRef = findChild(childArray(sampleRef, 'SampleRef'), 'FileRef')!
    const fileRefBody = childArray(fileRef, 'FileRef')
    expect(attrs(findChild(fileRefBody, 'Path')!)['@_Value']).toBe(
      '/out/Samples/Imported/my-rifff-kick.wav'
    )
    expect(attrs(findChild(fileRefBody, 'RelativePath')!)['@_Value']).toBe(
      'Samples/Imported/my-rifff-kick.wav'
    )
  })

  it('shifts Time by leftCropBars and shrinks CurrentEnd, for a cropped non-one-shot stem', () => {
    // The copied audio file is only stem.barLength (4) bars long -- sssketch's own engine
    // reaches playedBars (6) bars by tiling that short file, so this export relies on
    // Ableton's own LoopOn=true tiling to do the same, rather than enumerating repeats.
    const rifff = drumsRifff() // startBar: 8, barLength: 4
    const state = emptyAppState({
      rifffs: { 'rifff-1': rifff },
      channelOrder: ['rifff-1'],
      channelOf: { 'rifff-1': 'rifff-1' },
      leftCrop: { 'rifff-1': 1 },
      playedBars: { 'rifff-1': 6 }
    })
    const stemFileNames = new Map([['rifff-1:0', 'my-rifff-kick.wav']])

    const xml = buildAlsXml(TEMPLATE_XML, state, '/out', stemFileNames)
    const { tracks } = tracksOf(xml)
    const clip = findAudioClip(findChild(tracks, 'AudioTrack')!)
    const clipBody = childArray(clip, 'AudioClip')

    expect(attrs(clip)['@_Time']).toBe('36') // (startBar=8 + leftCropBars=1) * 4
    expect(attrs(findChild(clipBody, 'CurrentEnd')!)['@_Value']).toBe('20') // (playedBars=6 - leftCropBars=1) * 4
  })

  it('bounds the loop cycle to one tile (stem.barLength), never the full playedBars span, for a cropped stem', () => {
    const rifff = drumsRifff() // barLength: 4
    const state = emptyAppState({
      rifffs: { 'rifff-1': rifff },
      channelOrder: ['rifff-1'],
      channelOf: { 'rifff-1': 'rifff-1' },
      leftCrop: { 'rifff-1': 1 },
      playedBars: { 'rifff-1': 6 }
    })
    const stemFileNames = new Map([['rifff-1:0', 'my-rifff-kick.wav']])

    const xml = buildAlsXml(TEMPLATE_XML, state, '/out', stemFileNames)
    const { tracks } = tracksOf(xml)
    const clip = findAudioClip(findChild(tracks, 'AudioTrack')!)
    const clipBody = childArray(clip, 'AudioClip')
    const loop = findChild(clipBody, 'Loop')!
    const loopBody = childArray(loop, 'Loop')

    expect(attrs(findChild(loopBody, 'LoopStart')!)['@_Value']).toBe('4') // wrapped(1)*4
    expect(attrs(findChild(loopBody, 'LoopEnd')!)['@_Value']).toBe('16') // stem.barLength(4)*4 -- NOT (1+6)*4 or 6*4
    expect(attrs(findChild(loopBody, 'LoopOn')!)['@_Value']).toBe('true')
    expect(attrs(findChild(loopBody, 'HiddenLoopEnd')!)['@_Value']).toBe('16')
  })

  it('bounds the loop cycle to one tile even for an UNCROPPED stem extended well past its native length', () => {
    // The more common real-world case than cropping: a clip simply dragged/extended longer
    // than its own native pattern. LoopEnd must still never exceed the short source file's
    // own real duration, regardless of how long playedBars says the clip should be.
    const rifff = drumsRifff() // barLength: 4
    const state = emptyAppState({
      rifffs: { 'rifff-1': rifff },
      channelOrder: ['rifff-1'],
      channelOf: { 'rifff-1': 'rifff-1' },
      playedBars: { 'rifff-1': 32 } // 8x its own native 4-bar length, no crop
    })
    const stemFileNames = new Map([['rifff-1:0', 'my-rifff-kick.wav']])

    const xml = buildAlsXml(TEMPLATE_XML, state, '/out', stemFileNames)
    const { tracks } = tracksOf(xml)
    const clip = findAudioClip(findChild(tracks, 'AudioTrack')!)
    const clipBody = childArray(clip, 'AudioClip')
    const loop = findChild(clipBody, 'Loop')!
    const loopBody = childArray(loop, 'Loop')

    expect(attrs(clip)['@_Time']).toBe('32') // startBar*4, no crop
    expect(attrs(findChild(clipBody, 'CurrentEnd')!)['@_Value']).toBe('128') // playedBars(32)*4
    expect(attrs(findChild(loopBody, 'LoopStart')!)['@_Value']).toBe('0')
    expect(attrs(findChild(loopBody, 'LoopEnd')!)['@_Value']).toBe('16') // still just stem.barLength*4
  })

  it('wraps a leftCropBars larger than stem.barLength into the correct tile phase', () => {
    const rifff = drumsRifff() // barLength: 4
    const state = emptyAppState({
      rifffs: { 'rifff-1': rifff },
      channelOrder: ['rifff-1'],
      channelOf: { 'rifff-1': 'rifff-1' },
      leftCrop: { 'rifff-1': 6 }, // > barLength(4), should wrap to phase 2
      playedBars: { 'rifff-1': 10 }
    })
    const stemFileNames = new Map([['rifff-1:0', 'my-rifff-kick.wav']])

    const xml = buildAlsXml(TEMPLATE_XML, state, '/out', stemFileNames)
    const { tracks } = tracksOf(xml)
    const clip = findAudioClip(findChild(tracks, 'AudioTrack')!)
    const clipBody = childArray(clip, 'AudioClip')
    const loop = findChild(clipBody, 'Loop')!
    const loopBody = childArray(loop, 'Loop')

    expect(attrs(clip)['@_Time']).toBe('56') // (8 + 6) * 4 -- raw leftCropBars for position
    expect(attrs(findChild(loopBody, 'LoopStart')!)['@_Value']).toBe('8') // wrapped(6 % 4 = 2) * 4
    expect(attrs(findChild(clipBody, 'CurrentEnd')!)['@_Value']).toBe('16') // (10 - 6) * 4
  })

  it("sets warp markers from the stem's native tempo (durationSec/barLength vs a clean 1-beat span)", () => {
    // 4 bars at 140bpm = (60/140)*4*4 seconds. Native seconds-per-beat = 60/140.
    const state = emptyAppState({
      rifffs: { 'rifff-1': drumsRifff() },
      channelOrder: ['rifff-1'],
      channelOf: { 'rifff-1': 'rifff-1' }
    })
    const stemFileNames = new Map([['rifff-1:0', 'my-rifff-kick.wav']])

    const xml = buildAlsXml(TEMPLATE_XML, state, '/out', stemFileNames)
    const { tracks } = tracksOf(xml)
    const clip = findAudioClip(findChild(tracks, 'AudioTrack')!)
    const clipBody = childArray(clip, 'AudioClip')
    const warpMarkersNode = findChild(clipBody, 'WarpMarkers')!
    const markers = childArray(warpMarkersNode, 'WarpMarkers')

    expect(markers).toHaveLength(2)
    expect(attrs(markers[0])['@_SecTime']).toBe('0')
    expect(attrs(markers[0])['@_BeatTime']).toBe('0')
    expect(attrs(markers[1])['@_BeatTime']).toBe('1')
    expect(Number(attrs(markers[1])['@_SecTime'])).toBeCloseTo(60 / 140, 10)
  })

  it('sets warp mode Beats (0) for a drums stem and Complex Pro (5) for everything else', () => {
    const rifff = drumsRifff()
    const notesStem = { ...rifff.stems[0], slot: 1, name: 'lead', type: 'notes' as const }
    rifff.stems.push(notesStem)

    const state = emptyAppState({
      rifffs: { 'rifff-1': rifff },
      channelOrder: ['rifff-1'],
      channelOf: { 'rifff-1': 'rifff-1' }
    })
    const stemFileNames = new Map([
      ['rifff-1:0', 'my-rifff-kick.wav'],
      ['rifff-1:1', 'my-rifff-lead.wav']
    ])

    const xml = buildAlsXml(TEMPLATE_XML, state, '/out', stemFileNames)
    const { tracks } = tracksOf(xml)
    const audioTracks = findAllChildren(tracks, 'AudioTrack')
    const warpModes = audioTracks.map((t) => {
      const clip = findAudioClip(t)
      return attrs(findChild(childArray(clip, 'AudioClip'), 'WarpMode')!)['@_Value']
    })

    expect(warpModes).toContain('0')
    expect(warpModes).toContain('5')
  })

  it('gives a one-shot stem LoopOn=false, IsWarped=false, and maps trimStartSec/trimEndSec at the PROJECT tempo', () => {
    // Uses a realistic one-shot fixture (barLength: 1, matching what
    // importOneShot.ts actually produces for every one-shot/recorded-take)
    // -- NOT drumsRifff()'s barLength: 4, which would silently hide the
    // nativeBpm bug this test exists to catch (see realOneShotRifff's own
    // doc comment below).
    const rifff = realOneShotRifff()
    rifff.stems[0] = {
      ...rifff.stems[0],
      trimStartSec: 0.5, // 1 beat in, at the 120bpm project tempo below
      trimEndSec: 1.5 // 3 beats in
    }

    const state = emptyAppState({
      bpm: 120,
      rifffs: { 'os-1': rifff },
      channelOrder: ['os-1'],
      channelOf: { 'os-1': 'os-1' }
    })
    const stemFileNames = new Map([['os-1:0', 'vox-hit-vox.wav']])

    const xml = buildAlsXml(TEMPLATE_XML, state, '/out', stemFileNames)
    const { tracks } = tracksOf(xml)
    const clip = findAudioClip(findChild(tracks, 'AudioTrack')!)
    const clipBody = childArray(clip, 'AudioClip')
    const loop = findChild(clipBody, 'Loop')!
    const loopBody = childArray(loop, 'Loop')

    expect(attrs(findChild(loopBody, 'LoopOn')!)['@_Value']).toBe('false')
    expect(attrs(findChild(clipBody, 'IsWarped')!)['@_Value']).toBe('false')
    // 0.5s and 1.5s at 120bpm (2 beats/sec) = 1 beat and 3 beats -- via the
    // PROJECT's tempo, not any per-stem "native" tempo derived from the
    // cosmetic barLength: 1.
    expect(Number(attrs(findChild(loopBody, 'LoopStart')!)['@_Value'])).toBeCloseTo(1, 10)
    expect(Number(attrs(findChild(loopBody, 'LoopEnd')!)['@_Value'])).toBeCloseTo(3, 10)
    expect(Number(attrs(findChild(clipBody, 'CurrentEnd')!)['@_Value'])).toBeCloseTo(3, 10)
    // HiddenLoopEnd must track the trim end (loopEndBeats), NOT
    // stem.barLength*4 -- one-shots are never tile-bounded.
    expect(Number(attrs(findChild(loopBody, 'HiddenLoopEnd')!)['@_Value'])).toBeCloseTo(3, 10)
  })

  it('does NOT collapse an untrimmed one-shot to exactly one bar regardless of its real duration', () => {
    // Regression test for a real bug found in whole-feature review: every
    // one-shot/recorded-take has a hardcoded, cosmetic barLength: 1 (see
    // importOneShot.ts), so deriving warp/tempo from
    // durationSec/barLength (nativeBpmFor) is meaningless for one-shots --
    // it silently collapsed CurrentEnd to exactly 4 beats (one bar) no
    // matter how long the sample actually was, then relied on
    // IsWarped=true to force-stretch the whole file to fit.
    const rifff = realOneShotRifff() // durationSec: 2.7317, deliberately not a round beat count
    const state = emptyAppState({
      bpm: 120,
      rifffs: { 'os-1': rifff },
      channelOrder: ['os-1'],
      channelOf: { 'os-1': 'os-1' }
    })
    const stemFileNames = new Map([['os-1:0', 'vox-hit-vox.wav']])

    const xml = buildAlsXml(TEMPLATE_XML, state, '/out', stemFileNames)
    const { tracks } = tracksOf(xml)
    const clip = findAudioClip(findChild(tracks, 'AudioTrack')!)
    const clipBody = childArray(clip, 'AudioClip')

    // 2.7317s at 120bpm (2 beats/sec) = 5.4634 beats -- NOT 4 (one bar),
    // which is what the old nativeBpm-from-barLength=1 bug always produced.
    const expectedBeats = 2.7317 * (120 / 60)
    const actual = Number(attrs(findChild(clipBody, 'CurrentEnd')!)['@_Value'])
    expect(actual).toBeCloseTo(expectedBeats, 9)
    expect(attrs(findChild(clipBody, 'CurrentEnd')!)['@_Value']).not.toBe('4')
  })

  it("scales a one-shot's occupied beat-span with the project's own tempo, since it's unwarped", () => {
    // Unwarped audio plays at its own true native speed regardless of Set
    // tempo -- it just occupies proportionally more or less
    // arrangement-timeline space (beats) as the tempo changes. At 3x the
    // tempo, the same real-world duration should occupy exactly 3x the
    // beats.
    const rifffAt60 = realOneShotRifff()
    const rifffAt180 = realOneShotRifff()
    const stateAt60 = emptyAppState({
      bpm: 60,
      rifffs: { 'os-1': rifffAt60 },
      channelOrder: ['os-1'],
      channelOf: { 'os-1': 'os-1' }
    })
    const stateAt180 = emptyAppState({
      bpm: 180,
      rifffs: { 'os-1': rifffAt180 },
      channelOrder: ['os-1'],
      channelOf: { 'os-1': 'os-1' }
    })
    const stemFileNames = new Map([['os-1:0', 'vox-hit-vox.wav']])

    const clipAt60 = findAudioClip(
      findChild(
        tracksOf(buildAlsXml(TEMPLATE_XML, stateAt60, '/out', stemFileNames)).tracks,
        'AudioTrack'
      )!
    )
    const clipAt180 = findAudioClip(
      findChild(
        tracksOf(buildAlsXml(TEMPLATE_XML, stateAt180, '/out', stemFileNames)).tracks,
        'AudioTrack'
      )!
    )
    const endAt60 = Number(
      attrs(findChild(childArray(clipAt60, 'AudioClip'), 'CurrentEnd')!)['@_Value']
    )
    const endAt180 = Number(
      attrs(findChild(childArray(clipAt180, 'AudioClip'), 'CurrentEnd')!)['@_Value']
    )

    expect(endAt180 / endAt60).toBeCloseTo(3, 9)
  })

  it('leaves a normal (tiled) stem warped, with unchanged tile-cycle math', () => {
    // Confirms the one-shot fix above didn't regress the non-one-shot path.
    const state = emptyAppState({
      rifffs: { 'rifff-1': drumsRifff() },
      channelOrder: ['rifff-1'],
      channelOf: { 'rifff-1': 'rifff-1' }
    })
    const stemFileNames = new Map([['rifff-1:0', 'my-rifff-kick.wav']])

    const xml = buildAlsXml(TEMPLATE_XML, state, '/out', stemFileNames)
    const { tracks } = tracksOf(xml)
    const clip = findAudioClip(findChild(tracks, 'AudioTrack')!)
    const clipBody = childArray(clip, 'AudioClip')

    expect(attrs(findChild(clipBody, 'IsWarped')!)['@_Value']).toBe('true')
    const markers = childArray(findChild(clipBody, 'WarpMarkers')!, 'WarpMarkers')
    expect(markers).toHaveLength(2)
    expect(Number(attrs(markers[1])['@_SecTime'])).toBeCloseTo(60 / 140, 10)
  })

  it('skips a stem missing from stemFileNames instead of producing a broken track', () => {
    const rifff = drumsRifff()
    rifff.stems.push({ ...rifff.stems[0], slot: 1, name: 'missing-file' })

    const state = emptyAppState({
      rifffs: { 'rifff-1': rifff },
      channelOrder: ['rifff-1'],
      channelOf: { 'rifff-1': 'rifff-1' }
    })
    // Only slot 0 present -- slot 1's copy "failed".
    const stemFileNames = new Map([['rifff-1:0', 'my-rifff-kick.wav']])

    const xml = buildAlsXml(TEMPLATE_XML, state, '/out', stemFileNames)
    const { tracks } = tracksOf(xml)
    expect(findAllChildren(tracks, 'AudioTrack')).toHaveLength(1)
  })

  it('produces no GroupTrack for a channel with no placed rifffs', () => {
    const state = emptyAppState({
      rifffs: {},
      channelOrder: ['empty-channel'],
      channelOf: {}
    })
    const xml = buildAlsXml(TEMPLATE_XML, state, '/out', new Map())
    const { tracks } = tracksOf(xml)
    expect(findAllChildren(tracks, 'GroupTrack')).toHaveLength(0)
  })

  it('sets NextPointeeId above every Id actually used, so Ableton will open the file', () => {
    // Regression test: Ableton validates NextPointeeId >= every Id used
    // anywhere in the document before it will open a Set -- confirmed via
    // a real "document is corrupt... NextPointeeId is too low" error on
    // the first real export, not a guess. A multi-channel, multi-stem
    // scenario exercises plenty of Id allocation (each cloned track's own
    // ~69 internal automation-target/pointee Ids, per alsXmlHelpers.ts's
    // renumberIds doc comment).
    const rifff1 = drumsRifff()
    const rifff2: Rifff = { ...drumsRifff(), groupId: 'rifff-2', startBar: 16 }
    const state = emptyAppState({
      rifffs: { 'rifff-1': rifff1, 'rifff-2': rifff2 },
      channelOrder: ['rifff-1', 'rifff-2'],
      channelOf: { 'rifff-1': 'rifff-1', 'rifff-2': 'rifff-2' }
    })
    const stemFileNames = new Map([
      ['rifff-1:0', 'a.wav'],
      ['rifff-2:0', 'b.wav']
    ])

    const xml = buildAlsXml(TEMPLATE_XML, state, '/out', stemFileNames)
    const { liveSetChildren, tracks } = tracksOf(xml)
    const nextPointeeId = Number(attrs(findChild(liveSetChildren, 'NextPointeeId')!)['@_Value'])

    let maxId = 0
    function collectMaxId(node: AlsNode): void {
      const nodeAttrs = attrs(node)
      if ('@_Id' in nodeAttrs) maxId = Math.max(maxId, Number(nodeAttrs['@_Id']))
      for (const key of Object.keys(node)) {
        if (key === ':@') continue
        for (const child of childArray(node, key)) collectMaxId(child)
      }
    }
    for (const track of tracks) collectMaxId(track)

    expect(nextPointeeId).toBeGreaterThan(maxId)
  })

  it("empties Sends on cloned AudioTrack/GroupTrack instances, leaving ReturnTracks' own Sends untouched", () => {
    // Regression test for two real, confirmed Ableton load failures found
    // trying to PRESERVE this substructure across clones: renumbering
    // TrackSendHolder produced "Track has more send knobs than set has
    // return tracks"; freezing it (so every clone shares identical nested
    // Ids) produced "non-unique Pointee IDs" once duplicated across many
    // tracks. sssketch has no concept of send-to-return-track at all, so
    // the fix is to just not carry this substructure into cloned tracks.
    const rifff1 = drumsRifff()
    const rifff2: Rifff = { ...drumsRifff(), groupId: 'rifff-2', startBar: 16 }
    const state = emptyAppState({
      rifffs: { 'rifff-1': rifff1, 'rifff-2': rifff2 },
      channelOrder: ['rifff-1', 'rifff-2'],
      channelOf: { 'rifff-1': 'rifff-1', 'rifff-2': 'rifff-2' }
    })
    const stemFileNames = new Map([
      ['rifff-1:0', 'a.wav'],
      ['rifff-2:0', 'b.wav']
    ])

    const xml = buildAlsXml(TEMPLATE_XML, state, '/out', stemFileNames)
    const { tracks } = tracksOf(xml)

    for (const audioTrack of findAllChildren(tracks, 'AudioTrack')) {
      expect(sendHolderCount(audioTrack, 'AudioTrack')).toBe(0)
    }
    for (const groupTrack of findAllChildren(tracks, 'GroupTrack')) {
      expect(sendHolderCount(groupTrack, 'GroupTrack')).toBe(0)
    }
    // ReturnTracks were never cloned/touched -- their own real Sends (2
    // TrackSendHolders each, per the reference template) survive as-is.
    for (const returnTrack of findAllChildren(tracks, 'ReturnTrack')) {
      expect(sendHolderCount(returnTrack, 'ReturnTrack')).toBe(2)
    }
  })

  it('sets the Set-level tempo from state.bpm', () => {
    const state = emptyAppState({ bpm: 135.5 })
    const xml = buildAlsXml(TEMPLATE_XML, state, '/out', new Map())
    const { liveSetChildren } = tracksOf(xml)
    const mainTrack = findChild(liveSetChildren, 'MainTrack')!
    const deviceChain = findChild(childArray(mainTrack, 'MainTrack'), 'DeviceChain')!
    const mixer = findChild(childArray(deviceChain, 'DeviceChain'), 'Mixer')!
    const tempo = findChild(childArray(mixer, 'Mixer'), 'Tempo')!
    const manual = findChild(childArray(tempo, 'Tempo'), 'Manual')!
    expect(attrs(manual)['@_Value']).toBe('135.5')
  })

  it('sets the Set-level Scale from the earliest placed rifff that has a parseable key', () => {
    const early: Rifff = {
      ...drumsRifff(),
      groupId: 'early',
      startBar: 0,
      key: 'E Minor (Aeolian)'
    }
    const late: Rifff = { ...drumsRifff(), groupId: 'late', startBar: 16, key: 'C Major (Ionian)' }
    const state = emptyAppState({
      rifffs: { early, late },
      channelOrder: ['early', 'late'],
      channelOf: { early: 'early', late: 'late' }
    })
    const xml = buildAlsXml(
      TEMPLATE_XML,
      state,
      '/out',
      new Map([
        ['early:0', 'a.wav'],
        ['late:0', 'b.wav']
      ])
    )
    const { liveSetChildren } = tracksOf(xml)
    const scaleInfo = findChild(liveSetChildren, 'ScaleInformation')!
    const scaleBody = childArray(scaleInfo, 'ScaleInformation')
    expect(attrs(findChild(scaleBody, 'Root')!)['@_Value']).toBe('4')
    expect(attrs(findChild(scaleBody, 'Name')!)['@_Value']).toBe('1')
  })

  it('omits nothing special (leaves the template default) when no placed rifff has a parseable key', () => {
    const rifff: Rifff = { ...drumsRifff(), key: 'D Dorian' } // unmapped scale
    const state = emptyAppState({
      rifffs: { 'rifff-1': rifff },
      channelOrder: ['rifff-1'],
      channelOf: { 'rifff-1': 'rifff-1' }
    })
    // Should not throw, and should leave whatever the template's own
    // default ScaleInformation was rather than guessing.
    expect(() =>
      buildAlsXml(TEMPLATE_XML, state, '/out', new Map([['rifff-1:0', 'a.wav']]))
    ).not.toThrow()
  })
})

// Navigates AudioTrack > DeviceChain > MainSequencer > Sample >
// ArrangerAutomation > Events > AudioClip -- shared by several tests above.
function findAudioClip(audioTrack: ReturnType<typeof findChild>): AlsNode {
  const body = childArray(audioTrack!, 'AudioTrack')
  const deviceChain = findChild(body, 'DeviceChain')!
  const mainSeq = findChild(childArray(deviceChain, 'DeviceChain'), 'MainSequencer')!
  const sample = findChild(childArray(mainSeq, 'MainSequencer'), 'Sample')!
  const arrangerAuto = findChild(childArray(sample, 'Sample'), 'ArrangerAutomation')!
  const events = findChild(childArray(arrangerAuto, 'ArrangerAutomation'), 'Events')!
  return findChild(childArray(events, 'Events'), 'AudioClip')!
}

// Navigates <trackTag> > DeviceChain > Mixer > Sends and counts its
// TrackSendHolder children -- shared by AudioTrack/GroupTrack/ReturnTrack,
// which all share this same shape.
function sendHolderCount(track: AlsNode, trackTag: string): number {
  const body = childArray(track, trackTag)
  const deviceChain = findChild(body, 'DeviceChain')!
  const mixer = findChild(childArray(deviceChain, 'DeviceChain'), 'Mixer')!
  const sends = findChild(childArray(mixer, 'Mixer'), 'Sends')!
  return findAllChildren(childArray(sends, 'Sends'), 'TrackSendHolder').length
}
