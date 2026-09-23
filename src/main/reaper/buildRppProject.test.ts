import { describe, it, expect } from 'vitest'
import { buildRppProject } from './buildRppProject'
import { parseRpp, findChild, findAllChildren, type RppNode } from './rppNode'
import type { AppState } from '../../renderer/src/state/store'
import type { Rifff } from '@shared/types'
import type { RiserClip } from '@shared/riser'
// Type-only, same as buildRppProject.ts's own import: exportToolkitAudio.ts
// spawns the native engine, and this suite stays pure.
import type { BakedClip, ToolkitExportOptions } from '../exportToolkitAudio'

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

// 4 bars at 140bpm -- native bpm derives back out to exactly 140.
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
        durationSec: (60 / 140) * 4 * 4,
        barLength: 4
      }
    ]
  }
}

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

function tracksOf(rppText: string): { root: RppNode; tracks: RppNode[] } {
  const root = parseRpp(rppText)
  return { root, tracks: findAllChildren(root, 'TRACK') }
}

function firstItemOf(track: RppNode): RppNode {
  return findAllChildren(track, 'ITEM')[0]
}

function bakeOptions(
  bakedClips: [string, BakedClip][] = [],
  riserFileName?: string
): ToolkitExportOptions {
  return { mode: 'bake', toolkitAudio: { bakedClips: new Map(bakedClips), riserFileName } }
}

function automationOptions(riserFileName?: string): ToolkitExportOptions {
  return { mode: 'automation', toolkitAudio: { bakedClips: new Map(), riserFileName } }
}

/** Two builds of the same project can never be string-equal as-is: every
 * TRACK/ITEM carries a fresh GUID and the project header carries the wall
 * clock. Blanking exactly those two makes "is this byte-identical" an
 * answerable question about everything else. */
function stableText(rppText: string): string {
  return rppText
    .replace(/\{[0-9A-F-]{36}\}/g, '{GUID}')
    .replace(/^<REAPER_PROJECT .*$/m, '<REAPER_PROJECT')
}

function riser(overrides: Partial<RiserClip> = {}): RiserClip {
  return {
    id: 'riser-1',
    channelId: 'ch-1',
    startBar: 4,
    lengthBars: 2,
    startCutoffValue: 0.3,
    endCutoffValue: 0.95,
    curve: [],
    level: 0.6,
    name: 'riser 1',
    muted: false,
    ...overrides
  }
}

function trackNamed(tracks: RppNode[], name: string): RppNode[] {
  return tracks.filter((t) => findChild(t, 'NAME')?.params[0] === `"${name}"`)
}

function ptValuesOf(envelope: RppNode): { sec: number; value: number }[] {
  return findAllChildren(envelope, 'PT').map((pt) => ({
    sec: Number(pt.params[0]),
    value: Number(pt.params[1])
  }))
}

describe('buildRppProject', () => {
  it('sets the project-level TEMPO from state.bpm, fixed 4/4', () => {
    const rppText = buildRppProject(emptyAppState({ bpm: 135.5 }), new Map())
    const { root } = tracksOf(rppText)
    expect(findChild(root, 'TEMPO')?.params).toEqual(['135.5', '4', '4'])
  })

  it('places one TRACK with one ITEM for a single placed rifff/stem', () => {
    const state = emptyAppState({
      rifffs: { 'rifff-1': drumsRifff() },
      busOf: { 'rifff-1:0': 'drums' }
    })
    const rppText = buildRppProject(state, new Map([['rifff-1:0', 'my-rifff-kick.wav']]))
    const { tracks } = tracksOf(rppText)

    expect(tracks).toHaveLength(1)
    expect(findAllChildren(tracks[0], 'ITEM')).toHaveLength(1)
  })

  it('positions the item at (startBar + leftCropBars) * secPerBarProject, LENGTH = (playedBars - leftCropBars) * secPerBarProject', () => {
    // state.bpm=120 -> secPerBarProject = (60/120)*4 = 2. startBar=8, no crop, playedBars
    // falls back to rifff.barLength=4.
    const state = emptyAppState({
      rifffs: { 'rifff-1': drumsRifff() },
      busOf: { 'rifff-1:0': 'drums' }
    })
    const rppText = buildRppProject(state, new Map([['rifff-1:0', 'my-rifff-kick.wav']]))
    const item = firstItemOf(tracksOf(rppText).tracks[0])

    expect(Number(findChild(item, 'POSITION')?.params[0])).toBeCloseTo(16, 9) // 8*2
    expect(Number(findChild(item, 'LENGTH')?.params[0])).toBeCloseTo(8, 9) // 4*2
  })

  it('sets PLAYRATE to projectBpm/nativeBpm for a tiled (non-one-shot) stem, preserving pitch', () => {
    // native bpm derives to exactly 140 (see drumsRifff's own doc comment).
    const state = emptyAppState({
      bpm: 210,
      rifffs: { 'rifff-1': drumsRifff() },
      busOf: { 'rifff-1:0': 'drums' }
    })
    const rppText = buildRppProject(state, new Map([['rifff-1:0', 'my-rifff-kick.wav']]))
    const item = firstItemOf(tracksOf(rppText).tracks[0])
    const playrate = findChild(item, 'PLAYRATE')!

    expect(Number(playrate.params[0])).toBeCloseTo(1.5, 9) // 210/140
    expect(playrate.params[1]).toBe('1') // preserve pitch
  })

  it('sets LOOP=1 for a tiled stem and LOOP=0 for a one-shot', () => {
    const tiledState = emptyAppState({
      rifffs: { 'rifff-1': drumsRifff() },
      busOf: { 'rifff-1:0': 'drums' }
    })
    const tiledItem = firstItemOf(
      tracksOf(buildRppProject(tiledState, new Map([['rifff-1:0', 'a.wav']]))).tracks[0]
    )
    expect(findChild(tiledItem, 'LOOP')?.params).toEqual(['1'])

    const oneShotState = emptyAppState({
      rifffs: { 'os-1': realOneShotRifff() },
      busOf: { 'os-1:0': 'drums' }
    })
    const oneShotItem = firstItemOf(
      tracksOf(buildRppProject(oneShotState, new Map([['os-1:0', 'b.wav']]))).tracks[0]
    )
    expect(findChild(oneShotItem, 'LOOP')?.params).toEqual(['0'])
  })

  it('wraps a leftCropBars larger than stem.barLength into the correct SOFFS tile phase, at NATIVE tempo', () => {
    const rifff = drumsRifff() // barLength: 4, native bpm 140
    const state = emptyAppState({
      rifffs: { 'rifff-1': rifff },
      busOf: { 'rifff-1:0': 'drums' },
      leftCrop: { 'rifff-1': 6 }, // > barLength(4), wraps to phase 2
      playedBars: { 'rifff-1': 10 }
    })
    const rppText = buildRppProject(state, new Map([['rifff-1:0', 'a.wav']]))
    const item = firstItemOf(tracksOf(rppText).tracks[0])

    // secPerBarNative(140) = (60/140)*4 = 1.7142857142857142; wrapped(6%4=2)*that.
    expect(Number(findChild(item, 'SOFFS')?.params[0])).toBeCloseTo(2 * ((60 / 140) * 4), 9)
    // POSITION uses the RAW (unwrapped) leftCropBars, at PROJECT tempo -- (8+6)*2.
    expect(Number(findChild(item, 'POSITION')?.params[0])).toBeCloseTo(28, 9)
    expect(Number(findChild(item, 'LENGTH')?.params[0])).toBeCloseTo(8, 9) // (10-6)*2
  })

  it('maps a one-shot stem via trimStartSec/trimEndSec at PROJECT tempo, SOFFS=trimStartSec, PLAYRATE=1', () => {
    const rifff = realOneShotRifff()
    rifff.stems[0] = { ...rifff.stems[0], trimStartSec: 0.5, trimEndSec: 1.5 }
    const state = emptyAppState({
      bpm: 120,
      rifffs: { 'os-1': rifff },
      busOf: { 'os-1:0': 'drums' }
    })
    const rppText = buildRppProject(state, new Map([['os-1:0', 'vox-hit-vox.wav']]))
    const item = firstItemOf(tracksOf(rppText).tracks[0])

    expect(Number(findChild(item, 'POSITION')?.params[0])).toBeCloseTo(8, 9) // startBar(4)*2
    expect(Number(findChild(item, 'LENGTH')?.params[0])).toBeCloseTo(1, 9) // 1.5-0.5
    expect(Number(findChild(item, 'SOFFS')?.params[0])).toBeCloseTo(0.5, 9)
    expect(findChild(item, 'PLAYRATE')?.params[0]).toBe('1')
  })

  it('sets item MUTE=1 for a fully-muted stem, WITHOUT zeroing its volume', () => {
    const state = emptyAppState({
      rifffs: { 'rifff-1': drumsRifff() },
      busOf: { 'rifff-1:0': 'drums' },
      mute: { 'rifff-1:0': true },
      vol: { 'rifff-1:0': 0.8 }
    })
    const rppText = buildRppProject(state, new Map([['rifff-1:0', 'a.wav']]))
    const item = firstItemOf(tracksOf(rppText).tracks[0])

    expect(findChild(item, 'MUTE')?.params).toEqual(['1'])
    expect(findChild(item, 'VOLPAN')?.params[0]).toBe('0.8')
  })

  it('splits a stem into multiple ITEMs around a partial mute region, with fade only on first/last', () => {
    // Mute region covers a real middle span of the clip -- 3 audible
    // segments should NOT be produced here since only one gap is cut (2
    // segments), but the fade-on-ends-only rule is what this test targets.
    const rifff = drumsRifff() // startBar 8, barLength 4 -> playedBars falls back to 4
    const state = emptyAppState({
      rifffs: { 'rifff-1': rifff },
      busOf: { 'rifff-1:0': 'drums' },
      muteRegions: { 'rifff-1:0': [{ startBar: 9, endBar: 9.5 }] },
      // A 1-bar fade in and out, drawn on this stem's own volume curve --
      // the only place a clip's fades live now. The clip is 4 bars long
      // (drumsRifff's barLength, no playedBars override), so the curve's
      // last point sits at bar 4.
      stemAutomation: {
        'rifff-1:0': {
          volume: [
            { bar: 0, value: 0 },
            { bar: 1, value: 1 },
            { bar: 3, value: 1 },
            { bar: 4, value: 0 }
          ]
        }
      }
    })
    const rppText = buildRppProject(state, new Map([['rifff-1:0', 'a.wav']]))
    const items = findAllChildren(tracksOf(rppText).tracks[0], 'ITEM')

    expect(items).toHaveLength(2)
    expect(findChild(items[0], 'FADEIN')?.params[0]).toBe('1') // has a fade
    expect(findChild(items[0], 'FADEOUT')?.params[0]).toBe('0') // no fade -- not the last segment
    expect(findChild(items[1], 'FADEIN')?.params[0]).toBe('0') // no fade -- not the first segment
    expect(findChild(items[1], 'FADEOUT')?.params[0]).toBe('1') // has a fade
  })

  it('skips a stem missing from stemFileNames instead of producing a broken item', () => {
    const rifff = drumsRifff()
    rifff.stems.push({ ...rifff.stems[0], slot: 1, name: 'missing-file' })
    const state = emptyAppState({
      rifffs: { 'rifff-1': rifff },
      busOf: { 'rifff-1:0': 'drums', 'rifff-1:1': 'drums' }
    })
    const rppText = buildRppProject(state, new Map([['rifff-1:0', 'a.wav']])) // slot 1 missing
    const { tracks } = tracksOf(rppText)
    expect(findAllChildren(tracks[0], 'ITEM')).toHaveLength(1)
  })

  it('colors each track via 0x01000000 | BGR-packed bus hex, and groups+labels the first per-bus track by busGroupName', () => {
    const state = emptyAppState({
      rifffs: { 'rifff-1': drumsRifff() },
      busOf: { 'rifff-1:0': 'drums' }
    })
    const rppText = buildRppProject(state, new Map([['rifff-1:0', 'a.wav']]))
    const track = tracksOf(rppText).tracks[0]

    // drums bus hex is #4a56ad (post drums/bass swap, 2026-08-21) -- r=0x4a, g=0x56, b=0xad.
    const expectedColor = 0x01000000 | (0xad << 16) | (0x56 << 8) | 0x4a
    expect(findChild(track, 'PEAKCOL')?.params).toEqual([String(expectedColor)])
    expect(findChild(track, 'NAME')?.params[0]).toBe('"DRUMS"')
  })

  it('keeps tracks for the same bus adjacent when packIntoTracks opens more than one', () => {
    // Two non-overlapping same-bus stems that DO overlap in time (forcing
    // packIntoTracks to open two physical tracks for this one bus).
    const rifffA: Rifff = { ...drumsRifff(), groupId: 'a', startBar: 0 }
    const rifffB: Rifff = { ...drumsRifff(), groupId: 'b', startBar: 0 } // same time span, overlaps
    const state = emptyAppState({
      rifffs: { a: rifffA, b: rifffB },
      busOf: { 'a:0': 'drums', 'b:0': 'drums' }
    })
    const rppText = buildRppProject(
      state,
      new Map([
        ['a:0', 'a.wav'],
        ['b:0', 'b.wav']
      ])
    )
    const { tracks } = tracksOf(rppText)
    expect(tracks).toHaveLength(2)
    tracks.forEach((t) => expect(findChild(t, 'NAME')?.params[0]).toMatch(/drums/i))
  })

  it('merges two non-overlapping-in-time same-bus stems onto one shared track', () => {
    // drumsRifff() has barLength 4 and no playedBars override, so each
    // rifff's own clip spans exactly 4 bars (playedBars falls back to
    // rifff.barLength) -- at the default state.bpm=120 that's 8 seconds
    // (secPerBarProject=2). rifffA occupies bars [0, 4) / seconds [0, 8);
    // rifffB starts at bar 4, exactly where A's own bar span ends, so its
    // seconds span is [8, 16) -- adjacent, not overlapping (packIntoTracks'
    // half-open [start, end) convention treats "starts exactly when the
    // other ends" as NOT an overlap), so both stems should land on the
    // same physical track.
    const rifffA: Rifff = { ...drumsRifff(), groupId: 'a', startBar: 0 }
    const rifffB: Rifff = { ...drumsRifff(), groupId: 'b', startBar: 4 }
    const state = emptyAppState({
      rifffs: { a: rifffA, b: rifffB },
      busOf: { 'a:0': 'drums', 'b:0': 'drums' }
    })
    const rppText = buildRppProject(
      state,
      new Map([
        ['a:0', 'a.wav'],
        ['b:0', 'b.wav']
      ])
    )
    const { tracks } = tracksOf(rppText)

    expect(tracks).toHaveLength(1) // merged onto ONE track, not two
    expect(findAllChildren(tracks[0], 'ITEM')).toHaveLength(2) // both stems' items present
  })
})

describe('buildRppProject: a project that uses none of the toolkit', () => {
  it('produces byte-identical output with and without an options argument', () => {
    // The load-bearing guarantee of the whole feature: adding the toolkit
    // must not change one byte of an export that predates it. Two rifffs,
    // two buses, a crop, a mute region and a fade -- i.e. most of this
    // exporter's surface -- and NO toolkit data at all.
    const rifffA: Rifff = { ...drumsRifff(), groupId: 'a', startBar: 0 }
    const rifffB: Rifff = { ...drumsRifff(), groupId: 'b', startBar: 4 }
    const state = emptyAppState({
      rifffs: { a: rifffA, b: rifffB, 'os-1': realOneShotRifff() },
      busOf: { 'a:0': 'drums', 'b:0': 'bass', 'os-1:0': 'lead' },
      leftCrop: { b: 1 },
      playedBars: { b: 6 },
      muteRegions: { 'a:0': [{ startBar: 1, endBar: 2 }] },
      vol: { 'b:0': 0.4 }
    })
    const fileNames = new Map([
      ['a:0', 'a.wav'],
      ['b:0', 'b.wav'],
      ['os-1:0', 'vox.wav']
    ])

    const withoutOptions = buildRppProject(state, fileNames)
    const withDefaultOptions = buildRppProject(state, fileNames, bakeOptions())
    const withAutomationMode = buildRppProject(state, fileNames, automationOptions())

    expect(stableText(withDefaultOptions)).toBe(stableText(withoutOptions))
    // Even automation MODE changes nothing when there is no automation --
    // except that nothing can share a track any more, which is the one
    // deliberate difference. Everything else about the text is the same.
    expect(findAllChildren(parseRpp(withAutomationMode), 'TRACK')).toHaveLength(3)
  })
})

describe('buildRppProject: bake mode', () => {
  it('references the baked file instead of the dry stem, laid out on the arrangement timeline', () => {
    // drumsRifff: startBar 8, 4 bars; state.bpm 120 -> secPerBar 2, so the
    // clip is seconds [16, 24). tailBars 1 -> one extra bar of reverb tail.
    const state = emptyAppState({
      rifffs: { 'rifff-1': drumsRifff() },
      busOf: { 'rifff-1:0': 'drums' },
      vol: { 'rifff-1:0': 0.5 }
    })
    const rppText = buildRppProject(
      state,
      new Map([['rifff-1:0', 'dry-kick.wav']]),
      bakeOptions([['rifff-1:0', { fileName: 'my-rifff-kick-toolkit.wav', tailBars: 1 }]])
    )
    const item = firstItemOf(tracksOf(rppText).tracks[0])

    expect(findChild(findChild(item, 'SOURCE')!, 'FILE')?.params[0]).toBe(
      '"Samples/Imported/my-rifff-kick-toolkit.wav"'
    )
    expect(Number(findChild(item, 'POSITION')?.params[0])).toBeCloseTo(16, 9)
    // The identity mapping: bar 0 of the render is bar 0 of the arrangement,
    // so the source offset is simply the clip's own start.
    expect(Number(findChild(item, 'SOFFS')?.params[0])).toBeCloseTo(16, 9)
    // 4 bars of clip + 1 bar of rendered reverb tail, at 2 sec/bar.
    expect(Number(findChild(item, 'LENGTH')?.params[0])).toBeCloseTo(10, 9)
    expect(findChild(item, 'LOOP')?.params).toEqual(['0'])
    expect(findChild(item, 'PLAYRATE')?.params).toEqual(['1', '1', '0', '-1', '0', '-1'])
    // Gain and fades are already in the samples -- applying either again
    // would apply it twice.
    expect(findChild(item, 'VOLPAN')?.params).toEqual(['1', '0', '1', '-1'])
    expect(findChild(item, 'FADEIN')?.params).toEqual(['0', '0', '0', '1', '0', '0'])
    expect(findChild(item, 'FADEOUT')?.params).toEqual(['0', '0', '0', '1', '0', '0'])
  })

  it('does NOT split a baked clip around its mute regions', () => {
    // The dry path splits this into 2 items (see the existing mute-region
    // test). The baked render already contains the silence -- and any
    // reverb tail ringing through the gap -- so splitting would chop audio
    // that was deliberately rendered.
    const state = emptyAppState({
      rifffs: { 'rifff-1': drumsRifff() },
      busOf: { 'rifff-1:0': 'drums' },
      muteRegions: { 'rifff-1:0': [{ startBar: 9, endBar: 9.5 }] },
      stemAutomation: {
        'rifff-1:0': {
          volume: [
            { bar: 0, value: 0 },
            { bar: 1, value: 1 }
          ]
        }
      }
    })
    const dry = buildRppProject(state, new Map([['rifff-1:0', 'a.wav']]))
    expect(findAllChildren(tracksOf(dry).tracks[0], 'ITEM')).toHaveLength(2)

    const baked = buildRppProject(
      state,
      new Map([['rifff-1:0', 'a.wav']]),
      bakeOptions([['rifff-1:0', { fileName: 'baked.wav', tailBars: 0 }]])
    )
    const items = findAllChildren(tracksOf(baked).tracks[0], 'ITEM')
    expect(items).toHaveLength(1)
    expect(Number(findChild(items[0], 'LENGTH')?.params[0])).toBeCloseTo(8, 9)
  })

  it('still packs two non-overlapping same-bus stems onto one track', () => {
    // Same scenario as the dry-path packing test -- baking changes the
    // audio a clip references, not where it lands.
    const rifffA: Rifff = { ...drumsRifff(), groupId: 'a', startBar: 0 }
    const rifffB: Rifff = { ...drumsRifff(), groupId: 'b', startBar: 4 }
    const state = emptyAppState({
      rifffs: { a: rifffA, b: rifffB },
      busOf: { 'a:0': 'drums', 'b:0': 'drums' }
    })
    const rppText = buildRppProject(
      state,
      new Map([
        ['a:0', 'a.wav'],
        ['b:0', 'b.wav']
      ]),
      bakeOptions([['a:0', { fileName: 'a-toolkit.wav', tailBars: 0 }]])
    )
    const { tracks } = tracksOf(rppText)
    expect(tracks).toHaveLength(1)
    expect(findAllChildren(tracks[0], 'ITEM')).toHaveLength(2)
  })
})

describe('buildRppProject: automation mode', () => {
  it('gives every stem its own track where bake mode packs two onto one', () => {
    const rifffA: Rifff = { ...drumsRifff(), groupId: 'a', startBar: 0 }
    const rifffB: Rifff = { ...drumsRifff(), groupId: 'b', startBar: 4 }
    const state = emptyAppState({
      rifffs: { a: rifffA, b: rifffB },
      busOf: { 'a:0': 'drums', 'b:0': 'drums' }
    })
    const fileNames = new Map([
      ['a:0', 'a.wav'],
      ['b:0', 'b.wav']
    ])

    expect(tracksOf(buildRppProject(state, fileNames, bakeOptions())).tracks).toHaveLength(1)

    const { tracks } = tracksOf(buildRppProject(state, fileNames, automationOptions()))
    expect(tracks).toHaveLength(2)
    // Each is named the way a single-entry packed track already is -- a
    // track envelope belongs to the whole track, so naming the first one
    // after the whole bus would misdescribe what is on it.
    expect(tracks.map((t) => findChild(t, 'NAME')?.params[0])).toEqual([
      '"DRUMS - my-rifff - kick"',
      '"DRUMS - my-rifff - kick"'
    ])
    tracks.forEach((t) => expect(findAllChildren(t, 'ITEM')).toHaveLength(1))
  })

  it('writes a VOLENV2 whose times are SECONDS and whose values are the dial times the curve', () => {
    // startBar 8 at 120bpm -> the clip's left edge is second 16, and the
    // curve's bars are CLIP-relative, so bar 2 is second 16 + 2*2 = 20.
    const state = emptyAppState({
      rifffs: { 'rifff-1': drumsRifff() },
      busOf: { 'rifff-1:0': 'drums' },
      vol: { 'rifff-1:0': 0.5 },
      stemAutomation: {
        'rifff-1:0': {
          volume: [
            { bar: 0, value: 0 },
            { bar: 2, value: 1 },
            { bar: 4, value: 0.5 }
          ]
        }
      }
    })
    const rppText = buildRppProject(state, new Map([['rifff-1:0', 'a.wav']]), automationOptions())
    const track = tracksOf(rppText).tracks[0]
    const env = findChild(track, 'VOLENV2')!

    expect(findChild(env, 'VOLTYPE')?.params).toEqual(['1'])
    expect(findChild(env, 'ACT')?.params).toEqual(['1', '-1'])
    expect(findChild(env, 'ARM')?.params).toEqual(['1'])
    expect(findChild(env, 'DEFSHAPE')?.params).toEqual(['0', '-1', '-1'])
    // The engine MULTIPLIES dial by curve (buildEngineProject's
    // scaleCurveByGain), so the export has to as well.
    expect(ptValuesOf(env)).toEqual([
      { sec: 16, value: 0 },
      { sec: 20, value: 0.5 },
      { sec: 24, value: 0.25 }
    ])
  })

  it('lets the volume envelope own the level: the item keeps gain 1 and no fades', () => {
    // The very same curve exports as clip FADES on the dry path (the
    // existing mute-region test pins that). With a real envelope carrying
    // the shape, keeping the fades would ramp the audio twice.
    const state = emptyAppState({
      rifffs: { 'rifff-1': drumsRifff() },
      busOf: { 'rifff-1:0': 'drums' },
      vol: { 'rifff-1:0': 0.8 },
      stemAutomation: {
        'rifff-1:0': {
          volume: [
            { bar: 0, value: 0 },
            { bar: 1, value: 1 },
            { bar: 3, value: 1 },
            { bar: 4, value: 0 }
          ]
        }
      }
    })
    const fileNames = new Map([['rifff-1:0', 'a.wav']])

    const dryItem = firstItemOf(tracksOf(buildRppProject(state, fileNames)).tracks[0])
    expect(findChild(dryItem, 'FADEIN')?.params[0]).toBe('1')
    expect(findChild(dryItem, 'VOLPAN')?.params[0]).toBe('0.8')

    const item = firstItemOf(
      tracksOf(buildRppProject(state, fileNames, automationOptions())).tracks[0]
    )
    expect(findChild(item, 'FADEIN')?.params).toEqual(['0', '0', '0', '1', '0', '0'])
    expect(findChild(item, 'FADEOUT')?.params).toEqual(['0', '0', '0', '1', '0', '0'])
    expect(findChild(item, 'VOLPAN')?.params[0]).toBe('1')
  })

  it('puts ONE reverb bus track last, with the AUXRECV naming the source track INDEX', () => {
    // Two buses -> drums is track 0, bass is track 1 (BUS_IDS order). Both
    // send, so both AUXRECVs live on the one appended bus track.
    const rifffA: Rifff = { ...drumsRifff(), groupId: 'a', startBar: 0 }
    const rifffB: Rifff = { ...drumsRifff(), groupId: 'b', startBar: 0 }
    const state = emptyAppState({
      rifffs: { a: rifffA, b: rifffB },
      busOf: { 'a:0': 'drums', 'b:0': 'bass' },
      stemSends: { 'a:0': 0.25, 'b:0': 0.75 }
    })
    const rppText = buildRppProject(
      state,
      new Map([
        ['a:0', 'a.wav'],
        ['b:0', 'b.wav']
      ]),
      automationOptions()
    )
    const { tracks } = tracksOf(rppText)

    expect(trackNamed(tracks, 'reverb bus')).toHaveLength(1)
    expect(findChild(tracks[tracks.length - 1], 'NAME')?.params[0]).toBe('"reverb bus"')

    const bus = tracks[2]
    const recvs = findAllChildren(bus, 'AUXRECV')
    expect(recvs).toHaveLength(2)
    // Field 0 is the SOURCE track index, field 2 the static send level.
    expect(recvs[0].params[0]).toBe('0')
    expect(Number(recvs[0].params[2])).toBeCloseTo(0.25, 9)
    expect(recvs[1].params[0]).toBe('1')
    expect(Number(recvs[1].params[2])).toBeCloseTo(0.75, 9)
    // A static send has no curve, so there is no envelope to write.
    expect(findAllChildren(bus, 'AUXVOLENV')).toHaveLength(0)
    // Stock ReaVerbate, so the project opens with nothing to install.
    const vst = findChild(findChild(bus, 'FXCHAIN')!, 'VST')!
    expect(vst.params[0]).toBe('"VST: ReaVerbate (Cockos)"')
  })

  it('puts the send ENVELOPE on the receiving bus track, not on the sending track', () => {
    // The one thing the reference doc warns is easy to get backwards.
    const state = emptyAppState({
      rifffs: { 'rifff-1': drumsRifff() },
      busOf: { 'rifff-1:0': 'drums' },
      stemSends: { 'rifff-1:0': 0.5 },
      stemAutomation: {
        'rifff-1:0': {
          reverbSend: [
            { bar: 0, value: 0 },
            { bar: 4, value: 0.8 }
          ]
        }
      }
    })
    const { tracks } = tracksOf(
      buildRppProject(state, new Map([['rifff-1:0', 'a.wav']]), automationOptions())
    )
    const source = tracks[0]
    const bus = tracks[1]

    expect(findAllChildren(source, 'AUXVOLENV')).toHaveLength(0)
    expect(findAllChildren(source, 'AUXRECV')).toHaveLength(0)

    const env = findChild(bus, 'AUXVOLENV')!
    expect(findChild(env, 'VOLTYPE')?.params).toEqual(['1'])
    // Clip-relative bars against the clip's own left edge (second 16), in
    // seconds; values pass through as linear send gain.
    expect(ptValuesOf(env)).toEqual([
      { sec: 16, value: 0 },
      { sec: 24, value: 0.8 }
    ])
    // With an envelope carrying the level, the AUXRECV fader sits at unity
    // -- which is exactly what doop.RPP's own captured send does.
    expect(findChild(bus, 'AUXRECV')?.params[2]).toBe('1')
  })

  it('emits the captured ReaEQ and a cutoff PARMENV whose values are normalised 0..1, not Hz', () => {
    const state = emptyAppState({
      rifffs: { 'rifff-1': drumsRifff() },
      busOf: { 'rifff-1:0': 'drums' },
      stemFilters: { 'rifff-1:0': { mode: 'lowpass', cutoff: 0.25, resonance: 0 } },
      stemAutomation: {
        'rifff-1:0': {
          filterCutoff: [
            { bar: 0, value: 0.25 },
            { bar: 4, value: 0.75 }
          ]
        }
      }
    })
    const track = tracksOf(
      buildRppProject(state, new Map([['rifff-1:0', 'a.wav']]), automationOptions())
    ).tracks[0]
    const chain = findChild(track, 'FXCHAIN')!
    const vst = findChild(chain, 'VST')!

    expect(vst.params[0]).toBe('"VST: ReaEQ (Cockos)"')
    // The base64 state is what makes band 1 a Low Pass, which is what makes
    // "Freq-Low Pass 1" exist as a parameter at all.
    expect(vst.children?.length).toBe(5)
    expect(vst.children?.[0].tag).toBe(
      'cWVlcu5e7f4CAAAAAQAAAAAAAAACAAAAAAAAAAIAAAABAAAAAAAAAAIAAAAAAAAAzQAAAAEAAAAAABAA'
    )

    const parmenvs = findAllChildren(chain, 'PARMENV')
    expect(parmenvs).toHaveLength(1) // resonance is 0 -- see the next test
    expect(parmenvs[0].params.slice(0, 5)).toEqual([
      '0:_Freq_Low_Pass_1',
      '0',
      '1',
      '0.5',
      '"Freq-Low Pass 1 / ReaEQ"'
    ])
    // THE ASSERTION THAT MATTERS: 0.25 comes out as 0.25. REAPER's
    // parameter envelopes are normalised, our cutoff dial already is, so
    // this conversion is a no-op -- unlike Ableton's, which is real Hz.
    expect(ptValuesOf(parmenvs[0])).toEqual([
      { sec: 16, value: 0.25 },
      { sec: 24, value: 0.75 }
    ])
    expect(findChild(chain, 'PARM_TCP')?.params).toEqual(['0:_Freq_Low_Pass_1'])
  })

  it('writes a single flat cutoff point for a static non-neutral cutoff with no curve', () => {
    const state = emptyAppState({
      rifffs: { 'rifff-1': drumsRifff() },
      busOf: { 'rifff-1:0': 'drums' },
      stemFilters: { 'rifff-1:0': { mode: 'lowpass', cutoff: 0.4, resonance: 0 } }
    })
    const chain = findChild(
      tracksOf(buildRppProject(state, new Map([['rifff-1:0', 'a.wav']]), automationOptions()))
        .tracks[0],
      'FXCHAIN'
    )!
    expect(ptValuesOf(findAllChildren(chain, 'PARMENV')[0])).toEqual([{ sec: 16, value: 0.4 }])
  })

  it('leaves out the ReaEQ entirely for a clip whose cutoff is at its neutral end', () => {
    // A lowpass parked fully open does nothing, so exporting a device for it
    // would be noise -- the same rule isStemToolkitNeutral already owns.
    const state = emptyAppState({
      rifffs: { 'rifff-1': drumsRifff() },
      busOf: { 'rifff-1:0': 'drums' },
      stemFilters: { 'rifff-1:0': { mode: 'lowpass', cutoff: 1, resonance: 0.9 } }
    })
    const track = tracksOf(
      buildRppProject(state, new Map([['rifff-1:0', 'a.wav']]), automationOptions())
    ).tracks[0]
    expect(findChild(track, 'FXCHAIN')).toBeUndefined()
  })

  it('writes resonance as a STATIC one-point bandwidth PARMENV, and only when the dial was turned up', () => {
    const base = {
      rifffs: { 'rifff-1': drumsRifff() },
      busOf: { 'rifff-1:0': 'drums' as const }
    }
    const fileNames = new Map([['rifff-1:0', 'a.wav']])

    const withResonance = tracksOf(
      buildRppProject(
        emptyAppState({
          ...base,
          stemFilters: { 'rifff-1:0': { mode: 'lowpass', cutoff: 0.4, resonance: 0.5 } }
        }),
        fileNames,
        automationOptions()
      )
    ).tracks[0]
    const parmenvs = findAllChildren(findChild(withResonance, 'FXCHAIN')!, 'PARMENV')
    expect(parmenvs).toHaveLength(2)
    expect(parmenvs[1].params[0]).toBe('2:_BW_Low_Pass_1')
    expect(parmenvs[1].params[4]).toBe('"BW-Low Pass 1 / ReaEQ"')
    // ONE point -- resonance is a dial, not a lane (spec section 2c) -- and
    // normalised into [0,1], narrower (lower) as the dial goes up, since
    // bandwidth is the inverse of Q.
    const points = ptValuesOf(parmenvs[1])
    expect(points).toHaveLength(1)
    expect(points[0].sec).toBe(16)
    expect(points[0].value).toBeGreaterThan(0)
    expect(points[0].value).toBeLessThan(1)

    const noResonance = tracksOf(
      buildRppProject(
        emptyAppState({
          ...base,
          stemFilters: { 'rifff-1:0': { mode: 'lowpass', cutoff: 0.4, resonance: 0 } }
        }),
        fileNames,
        automationOptions()
      )
    ).tracks[0]
    // Untouched dial -> ReaEQ keeps the bandwidth baked into the captured
    // state rather than being overridden by our inferred parameter.
    expect(findAllChildren(findChild(noResonance, 'FXCHAIN')!, 'PARMENV')).toHaveLength(1)
  })

  it('turning the dial further up narrows the exported bandwidth', () => {
    const bandwidthFor = (resonance: number): number => {
      const state = emptyAppState({
        rifffs: { 'rifff-1': drumsRifff() },
        busOf: { 'rifff-1:0': 'drums' },
        stemFilters: { 'rifff-1:0': { mode: 'lowpass', cutoff: 0.4, resonance } }
      })
      const chain = findChild(
        tracksOf(buildRppProject(state, new Map([['rifff-1:0', 'a.wav']]), automationOptions()))
          .tracks[0],
        'FXCHAIN'
      )!
      return ptValuesOf(findAllChildren(chain, 'PARMENV')[1])[0].value
    }
    expect(bandwidthFor(1)).toBeLessThan(bandwidthFor(0.5))
    expect(bandwidthFor(0.5)).toBeLessThan(bandwidthFor(0.01))
  })
})

describe('buildRppProject: risers', () => {
  it('emits one item per riser at the right seconds, in BOTH modes', () => {
    // Risers are generated, so they always come out as rendered audio
    // whichever mode the user picked (spec section 4, Elling's decision).
    const state = emptyAppState({
      bpm: 120, // secPerBar 2
      risers: {
        'riser-1': riser({ id: 'riser-1', startBar: 4, lengthBars: 2 }),
        'riser-2': riser({ id: 'riser-2', startBar: 12, lengthBars: 4 })
      }
    })

    for (const options of [bakeOptions([], 'risers.wav'), automationOptions('risers.wav')]) {
      const { tracks } = tracksOf(buildRppProject(state, new Map(), options))
      const riserTracks = trackNamed(tracks, 'risers')
      expect(riserTracks).toHaveLength(1) // they don't overlap
      const items = findAllChildren(riserTracks[0], 'ITEM')
      expect(items).toHaveLength(2)

      expect(Number(findChild(items[0], 'POSITION')?.params[0])).toBeCloseTo(8, 9)
      expect(Number(findChild(items[0], 'LENGTH')?.params[0])).toBeCloseTo(4, 9)
      // Same identity mapping a baked clip uses: every riser lives in the
      // one file, laid out on the arrangement's own timeline.
      expect(Number(findChild(items[0], 'SOFFS')?.params[0])).toBeCloseTo(8, 9)
      expect(findChild(items[0], 'LOOP')?.params).toEqual(['0'])
      expect(findChild(items[0], 'VOLPAN')?.params).toEqual(['1', '0', '1', '-1'])
      expect(findChild(findChild(items[0], 'SOURCE')!, 'FILE')?.params[0]).toBe(
        '"Samples/Imported/risers.wav"'
      )

      expect(Number(findChild(items[1], 'POSITION')?.params[0])).toBeCloseTo(24, 9)
      expect(Number(findChild(items[1], 'LENGTH')?.params[0])).toBeCloseTo(8, 9)
    }
  })

  it('opens a second risers track when two risers overlap in time', () => {
    const state = emptyAppState({
      risers: {
        'riser-1': riser({ id: 'riser-1', startBar: 4, lengthBars: 4 }),
        'riser-2': riser({ id: 'riser-2', startBar: 6, lengthBars: 4 })
      }
    })
    const { tracks } = tracksOf(buildRppProject(state, new Map(), bakeOptions([], 'risers.wav')))
    const riserTracks = trackNamed(tracks, 'risers')
    expect(riserTracks).toHaveLength(2)
    riserTracks.forEach((t) => expect(findAllChildren(t, 'ITEM')).toHaveLength(1))
  })

  it('emits no risers track at all when nothing was rendered for them', () => {
    const state = emptyAppState({ risers: { 'riser-1': riser() } })
    const { tracks } = tracksOf(buildRppProject(state, new Map(), bakeOptions()))
    expect(trackNamed(tracks, 'risers')).toHaveLength(0)
  })
})
