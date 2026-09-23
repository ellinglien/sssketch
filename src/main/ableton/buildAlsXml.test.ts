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
    playedBars: {},
    leftCrop: {},
    muteRegions: {},
    busOf: {},
    dragVol: {},
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
  it('produces one AudioTrack + one GroupTrack for a single placed rifff/stem, and drops the return tracks entirely', () => {
    // ReturnTracks are excluded from the export -- see buildAlsXml.ts's own
    // doc comment for why: after 8 real, confirmed failed attempts to make
    // cloned tracks' <Sends> agree with Ableton's per-track send-knob
    // validation, dropping return tracks (so every track's <Sends> is
    // legitimately empty) is the only approach that actually loads.
    const state = emptyAppState({
      rifffs: { 'rifff-1': drumsRifff() },
      channelOrder: ['rifff-1'],
      channelOf: { 'rifff-1': 'rifff-1' }
    })
    const stemFileNames = new Map([['rifff-1:0', 'my-rifff-kick.wav']])

    const xml = buildAlsXml(TEMPLATE_XML, state, '/out', stemFileNames)
    const { tracks } = tracksOf(xml)

    expect(findAllChildren(tracks, 'ReturnTrack')).toHaveLength(0)
    expect(findAllChildren(tracks, 'GroupTrack')).toHaveLength(1)
    expect(findAllChildren(tracks, 'AudioTrack')).toHaveLength(1)
  })

  it('names the stem track "<rifff name> - <stem name>" and the group after its bus (aux, with no busOf entry)', () => {
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
    // Grouping is now by bus, not by channel -- with no busOf entry for
    // this stem, it falls back to 'aux' (see the 'bus clustering' describe
    // block below for dedicated bus-naming/grouping coverage). The group's
    // own name also carries a sound-type summary -- "AUX — DRUMS" here,
    // since drumsRifff()'s stem is type 'drums' -- a genuinely useful
    // signal that a drums-typed stem ended up unassigned in the fallback
    // bus, not just the bare bus id (see the 'bus clustering' > 'names
    // groups...' tests below for dedicated coverage of this summary).
    // Upper-cased -- purely decorative, see busGroupName's own doc comment.
    expect(attrs(groupEffName)['@_Value']).toBe('AUX — DRUMS')
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
    // CurrentStart/CurrentEnd are ABSOLUTE arrangement-beat positions (same
    // coordinate space as Time), not durations relative to it -- so
    // CurrentEnd = Time(36) + relative duration((playedBars=6 -
    // leftCropBars=1) * 4 = 20).
    expect(attrs(findChild(clipBody, 'CurrentStart')!)['@_Value']).toBe('36')
    expect(attrs(findChild(clipBody, 'CurrentEnd')!)['@_Value']).toBe('56')
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
    // CurrentEnd is absolute: Time(32) + playedBars(32)*4 relative = 160.
    expect(attrs(findChild(clipBody, 'CurrentEnd')!)['@_Value']).toBe('160')
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
    // CurrentEnd is absolute: Time(56) + (10 - 6) * 4 relative = 72.
    expect(attrs(findChild(clipBody, 'CurrentEnd')!)['@_Value']).toBe('72')
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
    // CurrentEnd is absolute: Time (startBar=4 * 4 = 16) + 3 relative beats.
    expect(Number(attrs(findChild(clipBody, 'CurrentEnd')!)['@_Value'])).toBeCloseTo(19, 10)
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
    // CurrentEnd is absolute: Time (startBar=4 * 4 = 16) + that relative span.
    const expectedBeats = 16 + 2.7317 * (120 / 60)
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
    // CurrentEnd is absolute (Time + relative span), and Time is identical
    // in both cases (same startBar, unaffected by bpm) -- so the 3x
    // relationship only holds on the span past CurrentStart, not on the
    // raw CurrentEnd values themselves.
    const startAt60 = Number(
      attrs(findChild(childArray(clipAt60, 'AudioClip'), 'CurrentStart')!)['@_Value']
    )
    const endAt60 = Number(
      attrs(findChild(childArray(clipAt60, 'AudioClip'), 'CurrentEnd')!)['@_Value']
    )
    const startAt180 = Number(
      attrs(findChild(childArray(clipAt180, 'AudioClip'), 'CurrentStart')!)['@_Value']
    )
    const endAt180 = Number(
      attrs(findChild(childArray(clipAt180, 'AudioClip'), 'CurrentEnd')!)['@_Value']
    )

    expect(startAt60).toBe(startAt180)
    expect((endAt180 - startAt180) / (endAt60 - startAt60)).toBeCloseTo(3, 9)
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

  it('empties Sends on every cloned AudioTrack/GroupTrack, drops ReturnTracks, and empties SendsPre to match', () => {
    // Regression test for the actual, final resolution of a long saga --
    // see the design spec's "Known risks" for the full history of 8 failed
    // attempts to make cloned tracks' <Sends> agree with Ableton's
    // per-track send-knob validation (renumbering the outer TrackSendHolder
    // Id, renumbering only its nested Ids, freezing the whole subtree,
    // emptying <Sends> while still keeping 2 ReturnTracks -- that last one
    // crashed Ableton outright, confirmed via a real crash report). All of
    // them failed, including ones verified byte-for-byte against real
    // decompiled Ableton output. The only approach that actually works:
    // drop ReturnTracks from the export entirely, so zero TrackSendHolders
    // per track is the only valid state, and empty the Set-level <SendsPre>
    // (tied to return-track count) to match.
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

    expect(findAllChildren(tracks, 'ReturnTrack')).toHaveLength(0)
    for (const audioTrack of findAllChildren(tracks, 'AudioTrack')) {
      expect(sendHolderIds(audioTrack, 'AudioTrack')).toEqual([])
    }
    for (const groupTrack of findAllChildren(tracks, 'GroupTrack')) {
      expect(sendHolderIds(groupTrack, 'GroupTrack')).toEqual([])
    }

    const sendsPre = findChild(liveSetChildren, 'SendsPre')!
    expect(findAllChildren(childArray(sendsPre, 'SendsPre'), 'SendPreBool')).toHaveLength(0)
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

  it('removes any leftover tempo automation envelope, so Manual actually takes effect', () => {
    // Regression test: template.xml carries a real leftover tempo
    // automation envelope (a single breakpoint pinning tempo to the
    // template's own original 123.400002, covering the whole timeline)
    // from whatever real Ableton project it was captured from. Ableton
    // honors an active envelope over Manual wherever it has a breakpoint --
    // confirmed via real user testing that a Set exported with this
    // envelope still intact displays the template's stale tempo, not
    // state.bpm, no matter what Manual says.
    const state = emptyAppState({ bpm: 135.5 })
    const xml = buildAlsXml(TEMPLATE_XML, state, '/out', new Map())
    const { liveSetChildren } = tracksOf(xml)
    const mainTrack = findChild(liveSetChildren, 'MainTrack')!
    const mainTrackBody = childArray(mainTrack, 'MainTrack')
    const deviceChain = findChild(mainTrackBody, 'DeviceChain')!
    const mixer = findChild(childArray(deviceChain, 'DeviceChain'), 'Mixer')!
    const tempo = findChild(childArray(mixer, 'Mixer'), 'Tempo')!
    const tempoAutomationTargetId = attrs(
      findChild(childArray(tempo, 'Tempo'), 'AutomationTarget')!
    )['@_Id']

    const autoEnvelopes = findChild(mainTrackBody, 'AutomationEnvelopes')!
    const envelopes = findChild(childArray(autoEnvelopes, 'AutomationEnvelopes'), 'Envelopes')!
    const remainingPointeeIds = childArray(envelopes, 'Envelopes').map((envelope) => {
      const target = findChild(childArray(envelope, 'AutomationEnvelope'), 'EnvelopeTarget')!
      return attrs(findChild(childArray(target, 'EnvelopeTarget'), 'PointeeId')!)['@_Value']
    })
    expect(remainingPointeeIds).not.toContain(tempoAutomationTargetId)
    expect(xml).not.toContain('123.400002')
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

  describe('mute region export', () => {
    it('emits a single unsplit clip when a stem has no mute regions (unchanged behavior)', () => {
      const rifff = drumsRifff() // startBar: 8, barLength: 4
      const state = emptyAppState({
        rifffs: { 'rifff-1': rifff },
        channelOrder: ['rifff-1'],
        channelOf: { 'rifff-1': 'rifff-1' }
      })
      const stemFileNames = new Map([['rifff-1:0', 'my-rifff-kick.wav']])
      const xml = buildAlsXml(TEMPLATE_XML, state, '/out', stemFileNames)
      const { tracks } = tracksOf(xml)
      const audioTrack = findChild(tracks, 'AudioTrack')!
      const body = childArray(audioTrack, 'AudioTrack')
      const deviceChain = findChild(body, 'DeviceChain')!
      const mainSeq = findChild(childArray(deviceChain, 'DeviceChain'), 'MainSequencer')!
      const sample = findChild(childArray(mainSeq, 'MainSequencer'), 'Sample')!
      const arrangerAuto = findChild(childArray(sample, 'Sample'), 'ArrangerAutomation')!
      const events = findChild(childArray(arrangerAuto, 'ArrangerAutomation'), 'Events')!
      const clips = findAllChildren(childArray(events, 'Events'), 'AudioClip')
      expect(clips).toHaveLength(1)
    })

    it('splits a stem into two clips around a muted middle span, with a real gap', () => {
      const rifff = drumsRifff() // startBar: 8, barLength: 4, stem barLength: 4
      const state = emptyAppState({
        rifffs: { 'rifff-1': rifff },
        channelOrder: ['rifff-1'],
        channelOf: { 'rifff-1': 'rifff-1' },
        playedBars: { 'rifff-1': 8 }, // clip spans [8,16) bars = beats [32,64)
        muteRegions: { 'rifff-1:0': [{ startBar: 10, endBar: 11 }] } // beats [40,44)
      })
      const stemFileNames = new Map([['rifff-1:0', 'my-rifff-kick.wav']])
      const xml = buildAlsXml(TEMPLATE_XML, state, '/out', stemFileNames)
      const { tracks } = tracksOf(xml)
      const audioTrack = findChild(tracks, 'AudioTrack')!
      const body = childArray(audioTrack, 'AudioTrack')
      const deviceChain = findChild(body, 'DeviceChain')!
      const mainSeq = findChild(childArray(deviceChain, 'DeviceChain'), 'MainSequencer')!
      const sample = findChild(childArray(mainSeq, 'MainSequencer'), 'Sample')!
      const arrangerAuto = findChild(childArray(sample, 'Sample'), 'ArrangerAutomation')!
      const events = findChild(childArray(arrangerAuto, 'ArrangerAutomation'), 'Events')!
      const clips = findAllChildren(childArray(events, 'Events'), 'AudioClip')
      expect(clips).toHaveLength(2)

      const first = childArray(clips[0], 'AudioClip')
      expect(attrs(findChild(first, 'CurrentStart')!)['@_Value']).toBe('32')
      expect(attrs(findChild(first, 'CurrentEnd')!)['@_Value']).toBe('40')
      const second = childArray(clips[1], 'AudioClip')
      expect(attrs(findChild(second, 'CurrentStart')!)['@_Value']).toBe('44')
      expect(attrs(findChild(second, 'CurrentEnd')!)['@_Value']).toBe('64')

      // Both clips' own @_Id (and every Id nested within each, e.g. WarpMarker
      // Ids) must be unique -- the second clip is a clone of the first plus
      // renumbering, not a raw duplicate.
      expect(attrs(clips[0])['@_Id']).not.toBe(attrs(clips[1])['@_Id'])
    })

    it('continues the tile phase correctly across a gap, not restarting from LoopStart', () => {
      // barLength=4 (16 beats/tile). Clip spans [8,16) bars = beats [32,64),
      // unmuted, LoopStart would be 0 (no crop). Mute region at bars [10,11)
      // = beats [40,44) -- 8 beats (2 bars) into the clip. The second segment
      // starts 12 beats (3 bars) into the clip's own original timeline (its
      // own Time is beats 44, clip started at beat 32 -- elapsed 12 beats),
      // so its own tile phase should be (0 + 12) mod 16 = 12 beats, NOT 0.
      const rifff = drumsRifff()
      const state = emptyAppState({
        rifffs: { 'rifff-1': rifff },
        channelOrder: ['rifff-1'],
        channelOf: { 'rifff-1': 'rifff-1' },
        playedBars: { 'rifff-1': 8 },
        muteRegions: { 'rifff-1:0': [{ startBar: 10, endBar: 11 }] }
      })
      const stemFileNames = new Map([['rifff-1:0', 'my-rifff-kick.wav']])
      const xml = buildAlsXml(TEMPLATE_XML, state, '/out', stemFileNames)
      const { tracks } = tracksOf(xml)
      const audioTrack = findChild(tracks, 'AudioTrack')!
      const body = childArray(audioTrack, 'AudioTrack')
      const deviceChain = findChild(body, 'DeviceChain')!
      const mainSeq = findChild(childArray(deviceChain, 'DeviceChain'), 'MainSequencer')!
      const sample = findChild(childArray(mainSeq, 'MainSequencer'), 'Sample')!
      const arrangerAuto = findChild(childArray(sample, 'Sample'), 'ArrangerAutomation')!
      const events = findChild(childArray(arrangerAuto, 'ArrangerAutomation'), 'Events')!
      const clips = findAllChildren(childArray(events, 'Events'), 'AudioClip')
      const second = childArray(clips[1], 'AudioClip')
      const loop = findChild(second, 'Loop')!
      const loopBody = childArray(loop, 'Loop')
      expect(attrs(findChild(loopBody, 'LoopStart')!)['@_Value']).toBe('12')
    })
  })

  describe('volume/fade export', () => {
    it("writes the stem's volume into the clip's SampleVolume", () => {
      const state = emptyAppState({
        rifffs: { 'rifff-1': drumsRifff() },
        channelOrder: ['rifff-1'],
        channelOf: { 'rifff-1': 'rifff-1' },
        vol: { 'rifff-1:0': 0.62 }
      })
      const stemFileNames = new Map([['rifff-1:0', 'my-rifff-kick.wav']])

      const xml = buildAlsXml(TEMPLATE_XML, state, '/out', stemFileNames)
      const { tracks } = tracksOf(xml)
      const audioTrack = findChild(tracks, 'AudioTrack')!
      const clip = findAudioClip(audioTrack)
      const clipBody = childArray(clip, 'AudioClip')

      expect(attrs(findChild(clipBody, 'SampleVolume')!)['@_Value']).toBe('0.62')
    })

    it('leaves SampleVolume at the template default (1) when no volume override is set', () => {
      const state = emptyAppState({
        rifffs: { 'rifff-1': drumsRifff() },
        channelOrder: ['rifff-1'],
        channelOf: { 'rifff-1': 'rifff-1' }
      })
      const stemFileNames = new Map([['rifff-1:0', 'my-rifff-kick.wav']])

      const xml = buildAlsXml(TEMPLATE_XML, state, '/out', stemFileNames)
      const { tracks } = tracksOf(xml)
      const audioTrack = findChild(tracks, 'AudioTrack')!
      const clip = findAudioClip(audioTrack)
      const clipBody = childArray(clip, 'AudioClip')

      expect(attrs(findChild(clipBody, 'SampleVolume')!)['@_Value']).toBe('1')
    })

    it('exports a fully-muted stem with SampleVolume 0, overriding whatever volume it also has, keeping the clip present (not skipped)', () => {
      const state = emptyAppState({
        rifffs: { 'rifff-1': drumsRifff() },
        channelOrder: ['rifff-1'],
        channelOf: { 'rifff-1': 'rifff-1' },
        vol: { 'rifff-1:0': 0.8 },
        mute: { 'rifff-1:0': true }
      })
      const stemFileNames = new Map([['rifff-1:0', 'my-rifff-kick.wav']])

      const xml = buildAlsXml(TEMPLATE_XML, state, '/out', stemFileNames)
      const { tracks } = tracksOf(xml)
      const audioTrack = findChild(tracks, 'AudioTrack')!
      const clip = findAudioClip(audioTrack)
      const clipBody = childArray(clip, 'AudioClip')

      expect(attrs(findChild(clipBody, 'SampleVolume')!)['@_Value']).toBe('0')
    })

    it("writes Fade + FadeInLength from the stem's own volume curve, as a sample count at the given sample rate", () => {
      const rifff = drumsRifff() // bpm irrelevant here -- project bpm (120, from emptyAppState) drives the conversion
      const state = emptyAppState({
        rifffs: { 'rifff-1': rifff },
        channelOrder: ['rifff-1'],
        channelOf: { 'rifff-1': 'rifff-1' },
        // A half-bar fade-in drawn on this clip's own volume automation
        // curve -- where a clip's fades live now (edgeFadeState reads the
        // length back out of the points). 0.5 bar (2 beats) at 120bpm = 1s;
        // 1 bar = 4 beats, the same bar semantics everything else in the
        // toolkit uses, NOT reinterpreted for this export.
        stemAutomation: {
          'rifff-1:0': {
            volume: [
              { bar: 0, value: 0 },
              { bar: 0.5, value: 1 }
            ]
          }
        }
      })
      const stemFileNames = new Map([['rifff-1:0', 'my-rifff-kick.wav']])
      const stemSampleRates = new Map([['rifff-1:0', 48000]])

      const xml = buildAlsXml(TEMPLATE_XML, state, '/out', stemFileNames, stemSampleRates)
      const { tracks } = tracksOf(xml)
      const audioTrack = findChild(tracks, 'AudioTrack')!
      const clip = findAudioClip(audioTrack)
      const clipBody = childArray(clip, 'AudioClip')

      expect(attrs(findChild(clipBody, 'Fade')!)['@_Value']).toBe('true')
      const fadesBody = childArray(findChild(clipBody, 'Fades')!, 'Fades')
      expect(attrs(findChild(fadesBody, 'FadeInLength')!)['@_Value']).toBe('48000') // 1s * 48000
      expect(attrs(findChild(fadesBody, 'FadeOutLength')!)['@_Value']).toBe('0')
    })

    it('leaves Fade/FadeInLength/FadeOutLength at template defaults when no curve or sample rate is set', () => {
      const state = emptyAppState({
        rifffs: { 'rifff-1': drumsRifff() },
        channelOrder: ['rifff-1'],
        channelOf: { 'rifff-1': 'rifff-1' }
      })
      const stemFileNames = new Map([['rifff-1:0', 'my-rifff-kick.wav']])

      const xml = buildAlsXml(TEMPLATE_XML, state, '/out', stemFileNames)
      const { tracks } = tracksOf(xml)
      const audioTrack = findChild(tracks, 'AudioTrack')!
      const clip = findAudioClip(audioTrack)
      const clipBody = childArray(clip, 'AudioClip')

      expect(attrs(findChild(clipBody, 'Fade')!)['@_Value']).toBe('false')
      const fadesBody = childArray(findChild(clipBody, 'Fades')!, 'Fades')
      expect(attrs(findChild(fadesBody, 'FadeInLength')!)['@_Value']).toBe('0')
      expect(attrs(findChild(fadesBody, 'FadeOutLength')!)['@_Value']).toBe('0')
    })

    it('writes fade-in only on the FIRST audible segment and fade-out only on the LAST, when muted regions split a stem into 3 segments', () => {
      const rifff = drumsRifff() // startBar: 8, barLength: 4, stem barLength: 4
      const state = emptyAppState({
        rifffs: { 'rifff-1': rifff },
        channelOrder: ['rifff-1'],
        channelOf: { 'rifff-1': 'rifff-1' },
        playedBars: { 'rifff-1': 8 }, // clip spans [8,16) bars = beats [32,64)
        muteRegions: {
          'rifff-1:0': [
            { startBar: 9, endBar: 10 }, // beats [36,40)
            { startBar: 12, endBar: 13 } // beats [48,52)
          ]
        }, // 3 audible segments: [8,9) [10,12) [13,16) bars
        // A 1-bar fade at each end of the clip's own 8-bar span, drawn on
        // the stem's volume curve.
        stemAutomation: {
          'rifff-1:0': {
            volume: [
              { bar: 0, value: 0 },
              { bar: 1, value: 1 },
              { bar: 7, value: 1 },
              { bar: 8, value: 0 }
            ]
          }
        }
      })
      const stemFileNames = new Map([['rifff-1:0', 'my-rifff-kick.wav']])
      const stemSampleRates = new Map([['rifff-1:0', 48000]])

      const xml = buildAlsXml(TEMPLATE_XML, state, '/out', stemFileNames, stemSampleRates)
      const { tracks } = tracksOf(xml)
      const audioTrack = findChild(tracks, 'AudioTrack')!
      const body = childArray(audioTrack, 'AudioTrack')
      const deviceChain = findChild(body, 'DeviceChain')!
      const mainSeq = findChild(childArray(deviceChain, 'DeviceChain'), 'MainSequencer')!
      const sample = findChild(childArray(mainSeq, 'MainSequencer'), 'Sample')!
      const arrangerAuto = findChild(childArray(sample, 'Sample'), 'ArrangerAutomation')!
      const events = findChild(childArray(arrangerAuto, 'ArrangerAutomation'), 'Events')!
      const clips = findAllChildren(childArray(events, 'Events'), 'AudioClip')
      expect(clips).toHaveLength(3)

      function fadeLengths(clip: AlsNode): { fadeOn: string; fadeIn: string; fadeOut: string } {
        const clipBody = childArray(clip, 'AudioClip')
        const fadesBody = childArray(findChild(clipBody, 'Fades')!, 'Fades')
        return {
          fadeOn: attrs(findChild(clipBody, 'Fade')!)['@_Value'],
          fadeIn: attrs(findChild(fadesBody, 'FadeInLength')!)['@_Value'],
          fadeOut: attrs(findChild(fadesBody, 'FadeOutLength')!)['@_Value']
        }
      }

      const first = fadeLengths(clips[0])
      expect(first.fadeOn).toBe('true')
      // Raw fade would be 1 bar (4 beats) at 120bpm = 2s, but this segment
      // ([8,9) bars = 1 bar = 2s duration) is only 2s long -- FadeGain.cpp's
      // own buildFadePoints clamps every fade to at most HALF the audible
      // segment's own duration (1s here), so the export must match: 1s *
      // 48000, not the naive (unclamped) 2s * 48000.
      expect(first.fadeIn).toBe('48000')
      expect(first.fadeOut).toBe('0')

      const middle = fadeLengths(clips[1])
      expect(middle.fadeOn).toBe('false')
      expect(middle.fadeIn).toBe('0')
      expect(middle.fadeOut).toBe('0')

      const last = fadeLengths(clips[2])
      expect(last.fadeOn).toBe('true')
      expect(last.fadeIn).toBe('0')
      expect(last.fadeOut).toBe('96000') // 1 bar (4 beats) at 120bpm = 2s * 48000
    })

    it('clamps an oversized fade-in to half the audible segment duration, matching FadeGain.cpp playback', () => {
      // A single, unmuted 1-bar segment (playedBars overridden down to 1,
      // well under rifff.barLength(4) -- the clip's own audible span is
      // exactly this 1 bar, no mute regions to split it further) at
      // 120bpm = 2s duration, half = 1s. The drawn fade-in covers the
      // clip's WHOLE 1-bar length (2s raw), so the export's own clamp has
      // to fire for this to come out at 1s.
      const rifff = drumsRifff() // startBar: 8, barLength: 4
      const state = emptyAppState({
        rifffs: { 'rifff-1': rifff },
        channelOrder: ['rifff-1'],
        channelOf: { 'rifff-1': 'rifff-1' },
        playedBars: { 'rifff-1': 1 }, // segment span = 1 bar = 2s at 120bpm
        stemAutomation: {
          'rifff-1:0': {
            volume: [
              { bar: 0, value: 0 },
              { bar: 1, value: 1 }
            ]
          }
        }
      })
      const stemFileNames = new Map([['rifff-1:0', 'my-rifff-kick.wav']])
      const stemSampleRates = new Map([['rifff-1:0', 44100]])

      const xml = buildAlsXml(TEMPLATE_XML, state, '/out', stemFileNames, stemSampleRates)
      const { tracks } = tracksOf(xml)
      const clip = findAudioClip(findChild(tracks, 'AudioTrack')!)
      const clipBody = childArray(clip, 'AudioClip')
      const fadesBody = childArray(findChild(clipBody, 'Fades')!, 'Fades')

      // Naive (unclamped) would be 2s * 44100 = 88200 -- must NOT be that.
      const fadeInLength = attrs(findChild(fadesBody, 'FadeInLength')!)['@_Value']
      expect(fadeInLength).toBe('44100') // half of the 2s segment (1s) * 44100
      expect(fadeInLength).not.toBe('88200')
    })
  })

  describe('bus clustering', () => {
    it('groups tracks by bus instead of by channel, using the bus name for the GroupTrack', () => {
      const rifffA = { ...drumsRifff(), groupId: 'rifff-a', name: 'kick-loop' }
      const rifffB: Rifff = {
        groupId: 'rifff-b',
        name: 'bass-loop',
        bpm: 140,
        barLength: 4,
        folderPath: '/fake/folder',
        startBar: 20, // well past rifff-a's own span, so nothing overlaps
        stems: [
          {
            slot: 0,
            author: 'someone',
            name: 'sub',
            type: 'bass',
            path: '/source/sub.wav',
            durationSec: (60 / 140) * 4 * 4,
            barLength: 4
          }
        ]
      }
      const state = emptyAppState({
        rifffs: { 'rifff-a': rifffA, 'rifff-b': rifffB },
        channelOrder: ['rifff-a', 'rifff-b'],
        channelOf: { 'rifff-a': 'rifff-a', 'rifff-b': 'rifff-b' },
        busOf: { 'rifff-a:0': 'drums', 'rifff-b:0': 'bass' }
      })
      const stemFileNames = new Map([
        ['rifff-a:0', 'kick.wav'],
        ['rifff-b:0', 'sub.wav']
      ])

      const xml = buildAlsXml(TEMPLATE_XML, state, '/out', stemFileNames)
      const { tracks } = tracksOf(xml)

      const groupTracks = findAllChildren(tracks, 'GroupTrack')
      const groupNames = groupTracks.map((g) => {
        const nameNode = findChild(childArray(g, 'GroupTrack'), 'Name')!
        return attrs(findChild(childArray(nameNode, 'Name'), 'EffectiveName')!)['@_Value']
      })
      // Fixed bus order (drums, bass, lead, backing, aux), only non-empty
      // buses emitted -- 'drums' before 'bass' regardless of input order.
      // Upper-cased -- purely decorative, see busGroupName's own doc comment.
      expect(groupNames).toEqual(['DRUMS', 'BASS'])
      expect(findAllChildren(tracks, 'AudioTrack')).toHaveLength(2)
    })

    it('falls back to the aux bus for a stem with no bus assignment yet', () => {
      const state = emptyAppState({
        rifffs: { 'rifff-1': drumsRifff() },
        channelOrder: ['rifff-1'],
        channelOf: { 'rifff-1': 'rifff-1' }
        // no busOf entry at all
      })
      const stemFileNames = new Map([['rifff-1:0', 'my-rifff-kick.wav']])

      const xml = buildAlsXml(TEMPLATE_XML, state, '/out', stemFileNames)
      const { tracks } = tracksOf(xml)
      const groupTrack = findChild(tracks, 'GroupTrack')!
      const nameNode = findChild(childArray(groupTrack, 'GroupTrack'), 'Name')!
      // "AUX — DRUMS", not bare "aux" -- drumsRifff()'s stem is type
      // 'drums', and the group name summarizes what's actually in it (see
      // the dedicated 'names groups with a sound-type summary' tests
      // below), which is genuinely useful signal for an unassigned stem
      // that landed in the fallback bus. Upper-cased, see busGroupName.
      expect(attrs(findChild(childArray(nameNode, 'Name'), 'EffectiveName')!)['@_Value']).toBe(
        'AUX — DRUMS'
      )
    })

    it('packs two non-overlapping stems from the same bus onto ONE shared audio track', () => {
      const rifffA: Rifff = {
        groupId: 'rifff-a',
        name: 'first',
        bpm: 140,
        barLength: 4,
        folderPath: '/fake/folder',
        startBar: 0,
        stems: [
          {
            slot: 0,
            author: 'someone',
            name: 'a',
            type: 'drums',
            path: '/source/a.wav',
            durationSec: (60 / 140) * 4 * 4,
            barLength: 4
          }
        ]
      }
      const rifffB: Rifff = {
        groupId: 'rifff-b',
        name: 'second',
        bpm: 140,
        barLength: 4,
        folderPath: '/fake/folder',
        startBar: 20, // well after rifff-a ends -- no overlap
        stems: [
          {
            slot: 0,
            author: 'someone',
            name: 'b',
            type: 'drums',
            path: '/source/b.wav',
            durationSec: (60 / 140) * 4 * 4,
            barLength: 4
          }
        ]
      }
      const state = emptyAppState({
        rifffs: { 'rifff-a': rifffA, 'rifff-b': rifffB },
        channelOrder: ['rifff-a', 'rifff-b'],
        channelOf: { 'rifff-a': 'rifff-a', 'rifff-b': 'rifff-b' },
        busOf: { 'rifff-a:0': 'drums', 'rifff-b:0': 'drums' }
      })
      const stemFileNames = new Map([
        ['rifff-a:0', 'a.wav'],
        ['rifff-b:0', 'b.wav']
      ])

      const xml = buildAlsXml(TEMPLATE_XML, state, '/out', stemFileNames)
      const { tracks } = tracksOf(xml)

      expect(findAllChildren(tracks, 'GroupTrack')).toHaveLength(1)
      const audioTracks = findAllChildren(tracks, 'AudioTrack')
      expect(audioTracks).toHaveLength(1) // both stems packed onto ONE track

      const body = childArray(audioTracks[0], 'AudioTrack')
      const deviceChain = findChild(body, 'DeviceChain')!
      const mainSeq = findChild(childArray(deviceChain, 'DeviceChain'), 'MainSequencer')!
      const sample = findChild(childArray(mainSeq, 'MainSequencer'), 'Sample')!
      const arrangerAuto = findChild(childArray(sample, 'Sample'), 'ArrangerAutomation')!
      const events = findChild(childArray(arrangerAuto, 'ArrangerAutomation'), 'Events')!
      const clips = findAllChildren(childArray(events, 'Events'), 'AudioClip')
      expect(clips).toHaveLength(2) // one clip per stem, same track
    })

    it('opens a second track when two stems from the same bus DO overlap in time', () => {
      const rifffA = { ...drumsRifff(), groupId: 'rifff-a', name: 'a' } // startBar: 8
      const rifffB: Rifff = {
        ...drumsRifff(),
        groupId: 'rifff-b',
        name: 'b',
        startBar: 8 // same start as rifff-a -- fully overlapping
      }
      const state = emptyAppState({
        rifffs: { 'rifff-a': rifffA, 'rifff-b': rifffB },
        channelOrder: ['rifff-a', 'rifff-b'],
        channelOf: { 'rifff-a': 'rifff-a', 'rifff-b': 'rifff-b' },
        busOf: { 'rifff-a:0': 'drums', 'rifff-b:0': 'drums' }
      })
      const stemFileNames = new Map([
        ['rifff-a:0', 'a.wav'],
        ['rifff-b:0', 'b.wav']
      ])

      const xml = buildAlsXml(TEMPLATE_XML, state, '/out', stemFileNames)
      const { tracks } = tracksOf(xml)
      expect(findAllChildren(tracks, 'AudioTrack')).toHaveLength(2)
    })

    it('names a group with a sound-type summary when it differs from the bare bus id', () => {
      // drumsRifff()'s one stem is type 'drums', assigned here to the
      // 'lead' bus (a real, plausible outcome of manual/clustered bus
      // assignment) -- the group name should say so, not just "lead".
      const state = emptyAppState({
        rifffs: { 'rifff-1': drumsRifff() },
        channelOrder: ['rifff-1'],
        channelOf: { 'rifff-1': 'rifff-1' },
        busOf: { 'rifff-1:0': 'lead' }
      })
      const stemFileNames = new Map([['rifff-1:0', 'my-rifff-kick.wav']])

      const xml = buildAlsXml(TEMPLATE_XML, state, '/out', stemFileNames)
      const { tracks } = tracksOf(xml)
      const groupTrack = findChild(tracks, 'GroupTrack')!
      const nameNode = findChild(childArray(groupTrack, 'GroupTrack'), 'Name')!
      // Upper-cased -- purely decorative, see busGroupName's own doc comment.
      expect(attrs(findChild(childArray(nameNode, 'Name'), 'EffectiveName')!)['@_Value']).toBe(
        'LEAD — DRUMS'
      )
    })

    it('colors the group, its track, and its clip all the same, per the assigned bus', () => {
      // Colors are Ableton's own fixed palette indices -- bass=0 here is
      // ABLETON_BUS_COLORS's post-swap value (drums/bass deliberately
      // swapped 2026-08-21, see that table's own doc comment); still not
      // an arbitrary test value, just no longer the original real-sampled
      // one (that's now on drums instead).
      const state = emptyAppState({
        rifffs: { 'rifff-1': drumsRifff() },
        channelOrder: ['rifff-1'],
        channelOf: { 'rifff-1': 'rifff-1' },
        busOf: { 'rifff-1:0': 'bass' }
      })
      const stemFileNames = new Map([['rifff-1:0', 'my-rifff-kick.wav']])

      const xml = buildAlsXml(TEMPLATE_XML, state, '/out', stemFileNames)
      const { tracks } = tracksOf(xml)

      const groupTrack = findChild(tracks, 'GroupTrack')!
      expect(attrs(findChild(childArray(groupTrack, 'GroupTrack'), 'Color')!)['@_Value']).toBe('0')

      const audioTrack = findChild(tracks, 'AudioTrack')!
      const audioTrackBody = childArray(audioTrack, 'AudioTrack')
      expect(attrs(findChild(audioTrackBody, 'Color')!)['@_Value']).toBe('0')

      const clip = findAudioClip(audioTrack)
      expect(attrs(findChild(childArray(clip, 'AudioClip'), 'Color')!)['@_Value']).toBe('0')
    })

    it('colors different buses differently', () => {
      const state = emptyAppState({
        rifffs: {
          'rifff-a': { ...drumsRifff(), groupId: 'rifff-a' },
          'rifff-b': { ...drumsRifff(), groupId: 'rifff-b' }
        },
        channelOrder: ['rifff-a', 'rifff-b'],
        channelOf: { 'rifff-a': 'rifff-a', 'rifff-b': 'rifff-b' },
        busOf: { 'rifff-a:0': 'drums', 'rifff-b:0': 'lead' }
      })
      const stemFileNames = new Map([
        ['rifff-a:0', 'a-kick.wav'],
        ['rifff-b:0', 'b-kick.wav']
      ])

      const xml = buildAlsXml(TEMPLATE_XML, state, '/out', stemFileNames)
      const { tracks } = tracksOf(xml)

      const groupColors = findAllChildren(tracks, 'GroupTrack').map(
        (g) => attrs(findChild(childArray(g, 'GroupTrack'), 'Color')!)['@_Value']
      )
      expect(new Set(groupColors)).toEqual(new Set(['65', '53'])) // drums, lead
    })

    it('sets UserName, not just EffectiveName, on both the group and its track', () => {
      // Real bug, confirmed via a real Ableton project: EffectiveName alone
      // is a computed/cached value Ableton silently recalculates (back to
      // its own defaults, e.g. "1-Group" or the raw sample filename) the
      // FIRST time the user saves inside Ableton itself -- only UserName
      // actually persists through a save. A name set on EffectiveName but
      // left with an empty UserName reads correctly in the freshly
      // exported file, then gets discarded the moment Ableton saves it.
      const state = emptyAppState({
        rifffs: { 'rifff-1': drumsRifff() },
        channelOrder: ['rifff-1'],
        channelOf: { 'rifff-1': 'rifff-1' },
        busOf: { 'rifff-1:0': 'drums' }
      })
      const stemFileNames = new Map([['rifff-1:0', 'my-rifff-kick.wav']])

      const xml = buildAlsXml(TEMPLATE_XML, state, '/out', stemFileNames)
      const { tracks } = tracksOf(xml)

      const groupTrack = findChild(tracks, 'GroupTrack')!
      const groupNameNode = findChild(childArray(groupTrack, 'GroupTrack'), 'Name')!
      const groupNameBody = childArray(groupNameNode, 'Name')
      const groupEffName = attrs(findChild(groupNameBody, 'EffectiveName')!)['@_Value']
      const groupUserName = attrs(findChild(groupNameBody, 'UserName')!)['@_Value']
      expect(groupUserName).toBe(groupEffName)
      expect(groupUserName).not.toBe('')

      const audioTrack = findChild(tracks, 'AudioTrack')!
      const trackNameNode = findChild(childArray(audioTrack, 'AudioTrack'), 'Name')!
      const trackNameBody = childArray(trackNameNode, 'Name')
      const trackEffName = attrs(findChild(trackNameBody, 'EffectiveName')!)['@_Value']
      const trackUserName = attrs(findChild(trackNameBody, 'UserName')!)['@_Value']
      expect(trackUserName).toBe(trackEffName)
      expect(trackUserName).not.toBe('')
    })

    it('gives two separately-packed shared tracks under the same bus DISTINCT names, even with identical composition', () => {
      // Two pairs of same-type ('drums'), same-bus stems -- within each
      // pair the two stems don't overlap (so they pack onto one shared
      // track together), but the pairs overlap EACH OTHER at both ends, so
      // packIntoTracks must open two separate physical tracks. Both tracks
      // end up with the exact same composition (2 'drums'-typed stems),
      // which previously would have produced the IDENTICAL literal name
      // "drums (shared)" on both -- indistinguishable in Ableton's own
      // track list. The second one must now get a disambiguating suffix.
      const a1: Rifff = { ...drumsRifff(), groupId: 'a1', startBar: 0 }
      const a2: Rifff = { ...drumsRifff(), groupId: 'a2', startBar: 20 }
      const b1: Rifff = { ...drumsRifff(), groupId: 'b1', startBar: 0 } // overlaps a1
      const b2: Rifff = { ...drumsRifff(), groupId: 'b2', startBar: 20 } // overlaps a2
      const state = emptyAppState({
        rifffs: { a1, a2, b1, b2 },
        channelOrder: ['a1', 'a2', 'b1', 'b2'],
        channelOf: { a1: 'a1', a2: 'a2', b1: 'b1', b2: 'b2' },
        busOf: { 'a1:0': 'drums', 'a2:0': 'drums', 'b1:0': 'drums', 'b2:0': 'drums' }
      })
      const stemFileNames = new Map([
        ['a1:0', 'a1.wav'],
        ['a2:0', 'a2.wav'],
        ['b1:0', 'b1.wav'],
        ['b2:0', 'b2.wav']
      ])

      const xml = buildAlsXml(TEMPLATE_XML, state, '/out', stemFileNames)
      const { tracks } = tracksOf(xml)
      const audioTracks = findAllChildren(tracks, 'AudioTrack')
      expect(audioTracks).toHaveLength(2) // two physical tracks, as expected

      const names = audioTracks.map((t) => {
        const nameNode = findChild(childArray(t, 'AudioTrack'), 'Name')!
        return attrs(findChild(childArray(nameNode, 'Name'), 'EffectiveName')!)['@_Value']
      })
      expect(names).toEqual(['drums (shared: drums)', 'drums (shared: drums) 2'])
      // Genuinely distinct, not a coincidence of the test data.
      expect(names[0]).not.toBe(names[1])
    })
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

// Navigates <trackTag> > DeviceChain > Mixer > Sends and returns its
// TrackSendHolder Ids in document order -- shared by
// AudioTrack/GroupTrack/ReturnTrack, which all share this same shape.
function sendHolderIds(track: AlsNode, trackTag: string): string[] {
  const body = childArray(track, trackTag)
  const deviceChain = findChild(body, 'DeviceChain')!
  const mixer = findChild(childArray(deviceChain, 'DeviceChain'), 'Mixer')!
  const sends = findChild(childArray(mixer, 'Mixer'), 'Sends')!
  return findAllChildren(childArray(sends, 'Sends'), 'TrackSendHolder').map((n) => attrs(n)['@_Id'])
}

// Navigates <trackTag> > AutomationEnvelopes > Envelopes and returns each
// envelope as the pair that actually matters: what it points at, and its
// events in document order.
function envelopesOf(
  track: AlsNode,
  trackTag: 'AudioTrack' | 'ReturnTrack' = 'AudioTrack'
): { pointeeId: string; events: { time: number; value: number }[] }[] {
  const body = childArray(track, trackTag)
  const automationEnvelopes = findChild(body, 'AutomationEnvelopes')!
  const envelopes = findChild(childArray(automationEnvelopes, 'AutomationEnvelopes'), 'Envelopes')!
  return findAllChildren(childArray(envelopes, 'Envelopes'), 'AutomationEnvelope').map((env) => {
    const envBody = childArray(env, 'AutomationEnvelope')
    const target = findChild(envBody, 'EnvelopeTarget')!
    const pointeeId = attrs(findChild(childArray(target, 'EnvelopeTarget'), 'PointeeId')!)[
      '@_Value'
    ]
    const automation = findChild(envBody, 'Automation')!
    const events = findChild(childArray(automation, 'Automation'), 'Events')!
    return {
      pointeeId,
      events: findAllChildren(childArray(events, 'Events'), 'FloatEvent').map((e) => ({
        time: Number(attrs(e)['@_Time']),
        value: Number(attrs(e)['@_Value'])
      }))
    }
  })
}

/** The devices on a track -- AudioTrack > DeviceChain > DeviceChain >
 * Devices, the INNER one (the outer holds the mixer and the sequencer). */
function devicesOfTrack(track: AlsNode): AlsNode[] {
  const body = childArray(track, 'AudioTrack')
  const outer = findChild(body, 'DeviceChain')!
  const inner = findChild(childArray(outer, 'DeviceChain'), 'DeviceChain')!
  return childArray(findChild(childArray(inner, 'DeviceChain'), 'Devices')!, 'Devices')
}

function manualOf(param: AlsNode, tag: string): number {
  return Number(attrs(findChild(childArray(param, tag), 'Manual')!)['@_Value'])
}

function automationTargetIdOf(param: AlsNode, tag: string): string {
  return attrs(findChild(childArray(param, tag), 'AutomationTarget')!)['@_Id']
}

function mixerBodyOf(
  track: AlsNode,
  trackTag: 'AudioTrack' | 'ReturnTrack' = 'AudioTrack'
): AlsNode[] {
  const body = childArray(track, trackTag)
  const deviceChain = findChild(body, 'DeviceChain')!
  return childArray(findChild(childArray(deviceChain, 'DeviceChain'), 'Mixer')!, 'Mixer')
}

const AUTO_FILTER_XML = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'autoFilter2.xml'),
  'utf-8'
)

/** Two stems on one bus that do NOT overlap in time -- the case packIntoTracks
 * exists for, and therefore the case that shows automation mode refusing to
 * pack. */
function twoStemState(): AppState {
  const early: Rifff = { ...drumsRifff(), groupId: 'a', name: 'early', startBar: 0 }
  const late: Rifff = { ...drumsRifff(), groupId: 'b', name: 'late', startBar: 16 }
  return emptyAppState({
    rifffs: { a: early, b: late },
    busOf: { 'a:0': 'drums', 'b:0': 'drums' },
    channelOrder: ['a', 'b'],
    channelOf: { a: 'a', b: 'b' }
  })
}

describe('the built-in sound toolkit', () => {
  const fileNames = new Map([['rifff-1:0', 'my-rifff-kick.wav']])
  function toolkitState(overrides: Partial<AppState>): AppState {
    return emptyAppState({
      rifffs: { 'rifff-1': drumsRifff() }, // startBar 8, 4 bars long
      channelOrder: ['rifff-1'],
      channelOf: { 'rifff-1': 'rifff-1' },
      ...overrides
    })
  }

  it('leaves a project that uses none of it byte-for-byte unchanged', () => {
    const state = toolkitState({})
    const before = buildAlsXml(TEMPLATE_XML, state, '/out', fileNames)
    const after = buildAlsXml(TEMPLATE_XML, state, '/out', fileNames, new Map(), {
      mode: 'bake',
      toolkitAudio: { bakedClips: new Map() },
      autoFilterXml: AUTO_FILTER_XML
    })
    expect(after).toBe(before)
  })

  describe('bake in', () => {
    it('references the baked render as one unwarped, unlooped clip at unity volume', () => {
      const state = toolkitState({
        vol: { 'rifff-1:0': 0.4 },
        stemAutomation: { 'rifff-1:0': { volume: [{ bar: 0, value: 0.2 }] } }
      } as Partial<AppState>)
      const xml = buildAlsXml(TEMPLATE_XML, state, '/out', new Map(), new Map(), {
        mode: 'bake',
        toolkitAudio: {
          bakedClips: new Map([['rifff-1:0', { fileName: 'baked.wav', tailBars: 2 }]])
        }
      })
      const { tracks } = tracksOf(xml)
      const clip = findAudioClip(findChild(tracks, 'AudioTrack'))
      const clipBody = childArray(clip, 'AudioClip')

      // startBar 8 -> beat 32; 4 bars of clip + 2 bars of rendered reverb
      // tail -> beat 32 + 24.
      expect(attrs(clip)['@_Time']).toBe('32')
      expect(attrs(findChild(clipBody, 'CurrentStart')!)['@_Value']).toBe('32')
      expect(attrs(findChild(clipBody, 'CurrentEnd')!)['@_Value']).toBe('56')
      expect(attrs(findChild(clipBody, 'IsWarped')!)['@_Value']).toBe('false')
      const loopBody = childArray(findChild(clipBody, 'Loop')!, 'Loop')
      expect(attrs(findChild(loopBody, 'LoopOn')!)['@_Value']).toBe('false')
      // The render is laid out on the arrangement's own timeline, so "where
      // in the file" is just "where on the timeline".
      expect(attrs(findChild(loopBody, 'LoopStart')!)['@_Value']).toBe('32')
      expect(attrs(findChild(loopBody, 'LoopEnd')!)['@_Value']).toBe('56')
      // The gain dial and the volume curve are both already in the audio.
      expect(attrs(findChild(clipBody, 'SampleVolume')!)['@_Value']).toBe('1')
      expect(attrs(findChild(clipBody, 'Fade')!)['@_Value']).toBe('false')
      const fileRef = findChild(
        childArray(findChild(clipBody, 'SampleRef')!, 'SampleRef'),
        'FileRef'
      )!
      expect(attrs(findChild(childArray(fileRef, 'FileRef'), 'RelativePath')!)['@_Value']).toBe(
        join('Samples', 'Imported', 'baked.wav')
      )
    })

    it('does not split a baked clip at its mute regions -- they are baked too', () => {
      const state = toolkitState({
        muteRegions: { 'rifff-1:0': [{ startBar: 9, endBar: 10 }] },
        stemSends: { 'rifff-1:0': 0.5 }
      } as Partial<AppState>)
      const xml = buildAlsXml(TEMPLATE_XML, state, '/out', new Map(), new Map(), {
        mode: 'bake',
        toolkitAudio: {
          bakedClips: new Map([['rifff-1:0', { fileName: 'baked.wav', tailBars: 0 }]])
        }
      })
      const { tracks } = tracksOf(xml)
      const body = childArray(findChild(tracks, 'AudioTrack')!, 'AudioTrack')
      const deviceChain = findChild(body, 'DeviceChain')!
      const mainSeq = findChild(childArray(deviceChain, 'DeviceChain'), 'MainSequencer')!
      const sample = findChild(childArray(mainSeq, 'MainSequencer'), 'Sample')!
      const arrangerAuto = findChild(childArray(sample, 'Sample'), 'ArrangerAutomation')!
      const events = findChild(childArray(arrangerAuto, 'ArrangerAutomation'), 'Events')!
      expect(findAllChildren(childArray(events, 'Events'), 'AudioClip')).toHaveLength(1)
    })

    it('still packs two non-overlapping stems onto one track', () => {
      const xml = buildAlsXml(
        TEMPLATE_XML,
        twoStemState(),
        '/out',
        new Map([
          ['a:0', 'early.wav'],
          ['b:0', 'late.wav']
        ])
      )
      const { tracks } = tracksOf(xml)
      expect(findAllChildren(tracks, 'AudioTrack')).toHaveLength(1)
    })
  })

  describe('export the automation', () => {
    it('gives every stem its own track, so no envelope is shared', () => {
      const xml = buildAlsXml(
        TEMPLATE_XML,
        twoStemState(),
        '/out',
        new Map([
          ['a:0', 'early.wav'],
          ['b:0', 'late.wav']
        ]),
        new Map(),
        { mode: 'automation', toolkitAudio: { bakedClips: new Map() } }
      )
      const { tracks } = tracksOf(xml)
      expect(findAllChildren(tracks, 'AudioTrack')).toHaveLength(2)
    })

    it('writes the volume curve onto the track Volume, dial multiplied through, in beats', () => {
      const state = toolkitState({
        vol: { 'rifff-1:0': 0.5 },
        stemAutomation: {
          'rifff-1:0': {
            volume: [
              { bar: 0, value: 1 },
              { bar: 4, value: 0 }
            ]
          }
        }
      } as Partial<AppState>)
      const xml = buildAlsXml(TEMPLATE_XML, state, '/out', fileNames, new Map(), {
        mode: 'automation',
        toolkitAudio: { bakedClips: new Map() },
        autoFilterXml: AUTO_FILTER_XML
      })
      const { tracks } = tracksOf(xml)
      const track = findChild(tracks, 'AudioTrack')!
      const volume = findChild(mixerBodyOf(track), 'Volume')!

      // The dial itself lands on the track's own Volume (the reference doc's
      // mapping for the gain dial) and comes OFF the clip, so it's applied
      // exactly once.
      expect(manualOf(volume, 'Volume')).toBe(0.5)
      expect(
        attrs(findChild(childArray(findAudioClip(track), 'AudioClip'), 'SampleVolume')!)['@_Value']
      ).toBe('1')

      const envelopes = envelopesOf(track)
      expect(envelopes).toHaveLength(1)
      expect(envelopes[0].pointeeId).toBe(automationTargetIdOf(volume, 'Volume'))
      expect(envelopes[0].events).toEqual([
        // The "before the timeline" sentinel carries the starting value.
        { time: -63072000, value: 0.5 },
        // Clip-relative bar 0 is the clip's own left edge, bar 8 -> beat 32;
        // bar 4 of the curve -> beat 48. Values are dial x curve.
        { time: 32, value: 0.5 },
        { time: 48, value: 0 }
      ])
    })

    it('does not also write clip fades when the volume curve is exported', () => {
      const state = toolkitState({
        stemAutomation: {
          'rifff-1:0': {
            volume: [
              { bar: 0, value: 0 },
              { bar: 1, value: 1 }
            ]
          }
        }
      } as Partial<AppState>)
      const xml = buildAlsXml(
        TEMPLATE_XML,
        state,
        '/out',
        fileNames,
        new Map([['rifff-1:0', 44100]]),
        {
          mode: 'automation',
          toolkitAudio: { bakedClips: new Map() }
        }
      )
      const { tracks } = tracksOf(xml)
      const clipBody = childArray(findAudioClip(findChild(tracks, 'AudioTrack')), 'AudioClip')
      expect(attrs(findChild(clipBody, 'Fade')!)['@_Value']).toBe('false')
    })

    it('keeps a dial on the clip for a stem nobody drew anything on', () => {
      // Only a stem whose toolkit does something gets a track Volume written
      // (applyTrackToolkit bails on a neutral one), so moving the dial off
      // the clip for everybody would quietly lose it -- a stem that isn't
      // using the toolkit at all would come out at full level.
      const state = toolkitState({ vol: { 'rifff-1:0': 0.3 } })
      const xml = buildAlsXml(TEMPLATE_XML, state, '/out', fileNames, new Map(), {
        mode: 'automation',
        toolkitAudio: { bakedClips: new Map() }
      })
      const { tracks } = tracksOf(xml)
      const track = findChild(tracks, 'AudioTrack')!
      const clipBody = childArray(findAudioClip(track), 'AudioClip')
      expect(attrs(findChild(clipBody, 'SampleVolume')!)['@_Value']).toBe('0.3')
      expect(manualOf(findChild(mixerBodyOf(track), 'Volume')!, 'Volume')).toBe(1)
    })

    it('keeps ONE reverb return, one send holder per track, and automates that send', () => {
      const state = toolkitState({
        stemSends: { 'rifff-1:0': 0.25 },
        stemAutomation: {
          'rifff-1:0': {
            reverbSend: [
              { bar: 0, value: 0 },
              { bar: 2, value: 1 }
            ]
          }
        }
      } as Partial<AppState>)
      const xml = buildAlsXml(TEMPLATE_XML, state, '/out', fileNames, new Map(), {
        mode: 'automation',
        toolkitAudio: { bakedClips: new Map() }
      })
      const { liveSetChildren, tracks } = tracksOf(xml)

      const returns = findAllChildren(tracks, 'ReturnTrack')
      expect(returns).toHaveLength(1)
      // Every track's send-holder count has to match the return count -- the
      // mismatch is what used to crash Ableton.
      expect(sendHolderIds(findChild(tracks, 'AudioTrack')!, 'AudioTrack')).toHaveLength(1)
      expect(sendHolderIds(findChild(tracks, 'GroupTrack')!, 'GroupTrack')).toHaveLength(1)
      expect(sendHolderIds(returns[0], 'ReturnTrack')).toHaveLength(1)
      const sendsPre = findChild(liveSetChildren, 'SendsPre')!
      expect(childArray(sendsPre, 'SendsPre')).toHaveLength(1)

      const track = findChild(tracks, 'AudioTrack')!
      const sends = findChild(mixerBodyOf(track), 'Sends')!
      const holder = findChild(childArray(sends, 'Sends'), 'TrackSendHolder')!
      const send = findChild(childArray(holder, 'TrackSendHolder'), 'Send')!
      const envelope = envelopesOf(track).find(
        (e) => e.pointeeId === automationTargetIdOf(send, 'Send')
      )!
      expect(envelope).toBeDefined()
      // A send bottoms out at -70dB, not at zero.
      expect(envelope.events[1]).toEqual({ time: 32, value: 0.0003162277571 })
      expect(envelope.events[2]).toEqual({ time: 40, value: 1 })
    })

    it('emits an Auto Filter with fresh ids and automates its frequency in real Hz', () => {
      const state = toolkitState({
        stemFilters: { 'rifff-1:0': { mode: 'lowpass', cutoff: 0.5, resonance: 0.3 } },
        stemAutomation: {
          'rifff-1:0': {
            filterCutoff: [
              { bar: 0, value: 0 },
              { bar: 4, value: 1 }
            ]
          }
        }
      } as Partial<AppState>)
      const xml = buildAlsXml(TEMPLATE_XML, state, '/out', fileNames, new Map(), {
        mode: 'automation',
        toolkitAudio: { bakedClips: new Map() },
        autoFilterXml: AUTO_FILTER_XML
      })
      const { liveSetChildren, tracks } = tracksOf(xml)
      const track = findChild(tracks, 'AudioTrack')!
      const device = findChild(devicesOfTrack(track), 'AutoFilter2')!
      const deviceBody = childArray(device, 'AutoFilter2')

      // Resonance is a knob, not a lane (spec 2c) -- it lands as a static
      // value on the device.
      expect(manualOf(findChild(deviceBody, 'Filter_Resonance')!, 'Filter_Resonance')).toBe(0.3)
      expect(manualOf(findChild(deviceBody, 'Filter_Type')!, 'Filter_Type')).toBe(0)

      const frequency = findChild(deviceBody, 'Filter_Frequency')!
      const freqTargetId = automationTargetIdOf(frequency, 'Filter_Frequency')
      // Fresh: the captured device's own AutomationTarget Id was 22230, and
      // two exported tracks must not point at one parameter.
      expect(freqTargetId).not.toBe('22230')

      const envelope = envelopesOf(track).find((e) => e.pointeeId === freqTargetId)!
      expect(envelope).toBeDefined()
      // REAL Hz, through the same log map the engine uses: 0 -> 20Hz,
      // 1 -> 20kHz. (REAPER's own parameter envelopes are normalised 0..1
      // instead; this is the conversion that differs between the two.)
      expect(envelope.events[1].value).toBeCloseTo(20, 6)
      expect(envelope.events[2].value).toBeCloseTo(20000, 3)
      expect(envelope.events[1].time).toBe(32)
      expect(envelope.events[2].time).toBe(48)

      // Ableton refuses to open a Set whose NextPointeeId is below an Id it
      // actually uses, and this mode hands out a lot of them.
      const nextPointeeId = Number(attrs(findChild(liveSetChildren, 'NextPointeeId')!)['@_Value'])
      expect(nextPointeeId).toBeGreaterThan(Number(freqTargetId))
    })

    it('leaves the filter out entirely when the cutoff is parked at its neutral end', () => {
      const state = toolkitState({
        stemFilters: { 'rifff-1:0': { mode: 'lowpass', cutoff: 1, resonance: 0.8 } },
        stemSends: { 'rifff-1:0': 0.5 }
      } as Partial<AppState>)
      const xml = buildAlsXml(TEMPLATE_XML, state, '/out', fileNames, new Map(), {
        mode: 'automation',
        toolkitAudio: { bakedClips: new Map() },
        autoFilterXml: AUTO_FILTER_XML
      })
      const { tracks } = tracksOf(xml)
      // A resonance dial with nothing moving the cutoff is inaudible -- the
      // same rule isStemToolkitNeutral applies to the wire.
      expect(
        findChild(devicesOfTrack(findChild(tracks, 'AudioTrack')!), 'AutoFilter2')
      ).toBeUndefined()
    })
  })

  describe('risers', () => {
    it('places one clip per riser on a track of their own, in both modes', () => {
      for (const mode of ['bake', 'automation'] as const) {
        const state = toolkitState({
          risers: {
            r1: {
              id: 'r1',
              channelId: 'rifff-1',
              startBar: 4,
              lengthBars: 2,
              startCutoffValue: 0.3,
              endCutoffValue: 0.95,
              curve: [],
              level: 0.6,
              name: 'riser 1',
              muted: false
            }
          }
        } as Partial<AppState>)
        const xml = buildAlsXml(TEMPLATE_XML, state, '/out', fileNames, new Map(), {
          mode,
          toolkitAudio: { bakedClips: new Map(), riserFileName: 'risers.wav' }
        })
        const { tracks } = tracksOf(xml)
        const riserTrack = findAllChildren(tracks, 'AudioTrack').find((t) => {
          const name = findChild(childArray(t, 'AudioTrack'), 'Name')!
          return (
            attrs(findChild(childArray(name, 'Name'), 'EffectiveName')!)['@_Value'] === 'risers'
          )
        })!
        expect(riserTrack).toBeDefined()
        const clip = findAudioClip(riserTrack)
        const clipBody = childArray(clip, 'AudioClip')
        expect(attrs(clip)['@_Time']).toBe('16')
        expect(attrs(findChild(clipBody, 'CurrentEnd')!)['@_Value']).toBe('24')
        expect(attrs(findChild(clipBody, 'IsWarped')!)['@_Value']).toBe('false')
        const fileRef = findChild(
          childArray(findChild(clipBody, 'SampleRef')!, 'SampleRef'),
          'FileRef'
        )!
        expect(attrs(findChild(childArray(fileRef, 'FileRef'), 'RelativePath')!)['@_Value']).toBe(
          join('Samples', 'Imported', 'risers.wav')
        )
      }
    })
  })
})
