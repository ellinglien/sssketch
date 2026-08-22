import { describe, it, expect } from 'vitest'
import { buildRppProject } from './buildRppProject'
import { parseRpp, findChild, findAllChildren, type RppNode } from './rppNode'
import type { AppState } from '../../renderer/src/state/store'
import type { Rifff } from '@shared/types'

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
    muteRegions: {},
    busOf: {},
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
      fadeIn: { 'rifff-1': 1 },
      fadeOut: { 'rifff-1': 1 }
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
