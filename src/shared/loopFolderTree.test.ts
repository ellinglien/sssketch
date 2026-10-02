import { describe, expect, it } from 'vitest'
import {
  isPlayableLoopFile,
  isFormatOnlyFolder,
  loopGroupPath,
  loopDisplayName,
  buildLoopGroupTree,
  flattenLoopTreeOrder,
  countLoopsInGroup,
  defaultExpandedGroupKeys
} from './loopFolderTree'

describe('isPlayableLoopFile', () => {
  it('accepts the six playable formats, in any case', () => {
    for (const name of [
      'Creek Break 160.wav',
      'cw_amen08_165.WAV',
      'a.aif',
      'a.aiff',
      'a.flac',
      'a.mp3',
      'a.ogg',
      'Crot Break 165.Wav'
    ]) {
      expect(isPlayableLoopFile(name)).toBe(true)
    }
  })

  it('hides everything else, REX2 included', () => {
    for (const name of [
      'Creek Break 160.rx2',
      'info.txt',
      'cover.jpg',
      'loop.rex',
      'wav',
      'noext'
    ]) {
      expect(isPlayableLoopFile(name)).toBe(false)
    }
  })

  it('hides dot files: .DS_Store, and the ._ companions ExFAT volumes are full of', () => {
    expect(isPlayableLoopFile('.DS_Store')).toBe(false)
    expect(isPlayableLoopFile('._Creek Break 160.wav')).toBe(false)
    expect(isPlayableLoopFile('.hidden.wav')).toBe(false)
  })
})

describe('isFormatOnlyFolder', () => {
  it('knows the format folder names, in any case', () => {
    for (const name of [
      'WAV',
      'wav',
      'AIFF',
      'MP3',
      'FLAC',
      'OGG',
      'REX',
      'REX2',
      'rex2',
      'Audio',
      'AUDIO'
    ]) {
      expect(isFormatOnlyFolder(name)).toBe(true)
    }
  })

  it('leaves real folder names alone', () => {
    for (const name of ['Amen Breaks Volume 1', 'Wavs', 'Audio Loops', 'Amen Breaks Compilation']) {
      expect(isFormatOnlyFolder(name)).toBe(false)
    }
  })
})

describe('loopGroupPath', () => {
  it('flattens format folders into their parent', () => {
    expect(loopGroupPath(['Amen Breaks Volume 1', 'WAV'])).toEqual(['Amen Breaks Volume 1'])
    expect(loopGroupPath(['Amen Breaks Volume 1', 'REX2'])).toEqual(['Amen Breaks Volume 1'])
    expect(loopGroupPath(['WAV'])).toEqual([])
    expect(loopGroupPath([])).toEqual([])
  })

  it('keeps real folders on either side of a format folder', () => {
    expect(loopGroupPath(['Volume 2', 'Audio', 'Kicks'])).toEqual(['Volume 2', 'Kicks'])
  })
})

describe('loopDisplayName', () => {
  it('is the filename without its extension', () => {
    expect(loopDisplayName('Creek Break 160.wav')).toBe('Creek Break 160')
    expect(loopDisplayName('cw_amen08_165.WAV')).toBe('cw_amen08_165')
    expect(loopDisplayName('break.v2.aiff')).toBe('break.v2')
  })
})

const loop = (name: string, groupPath: string[]): { name: string; groupPath: string[] } => ({
  name,
  groupPath
})

describe('buildLoopGroupTree', () => {
  it('nests loops by group path, with groups and loops in natural order', () => {
    const tree = buildLoopGroupTree([
      loop('cw_amen08_165', ['Volume 1']),
      loop('Creek Break 160', ['Volume 1']),
      loop('Halftime Dnb Drums 1', ['Volume 10']),
      loop('Crot Break 165', ['Volume 2']),
      loop('root loop', [])
    ])
    expect(tree.depth).toBe(0)
    expect(tree.loops.map((l) => l.name)).toEqual(['root loop'])
    expect(tree.children.map((g) => g.name)).toEqual(['Volume 1', 'Volume 2', 'Volume 10'])
    expect(tree.children[0].loops.map((l) => l.name)).toEqual(['Creek Break 160', 'cw_amen08_165'])
    expect(tree.children[0].key).toBe('["Volume 1"]')
    expect(tree.children[0].depth).toBe(1)
  })

  it('nests deeper groups under their parents', () => {
    const tree = buildLoopGroupTree([
      loop('kick', ['Volume 2', 'Kicks']),
      loop('snare', ['Volume 2'])
    ])
    const volume2 = tree.children[0]
    expect(volume2.loops.map((l) => l.name)).toEqual(['snare'])
    expect(volume2.children[0]).toMatchObject({
      name: 'Kicks',
      key: '["Volume 2","Kicks"]',
      depth: 2
    })
  })

  it('an empty folder is an empty root', () => {
    expect(buildLoopGroupTree([])).toEqual({
      key: '[]',
      name: '',
      depth: 0,
      loops: [],
      children: []
    })
  })
})

describe('flattenLoopTreeOrder, countLoopsInGroup, defaultExpandedGroupKeys', () => {
  const tree = buildLoopGroupTree([
    loop('a', ['G1']),
    loop('b', ['G1']),
    loop('c', ['G1', 'Sub']),
    loop('d', ['G2']),
    loop('r', [])
  ])
  const names = (loops: { name: string }[]): string[] => loops.map((l) => l.name)

  it('lists a group’s own loops before its subgroups, root loops first', () => {
    expect(names(flattenLoopTreeOrder(tree, () => true))).toEqual(['r', 'a', 'b', 'c', 'd'])
  })

  it('leaves out a collapsed group and everything under it', () => {
    expect(names(flattenLoopTreeOrder(tree, (key) => key !== '["G1"]'))).toEqual(['r', 'd'])
    expect(names(flattenLoopTreeOrder(tree, (key) => key !== '["G1","Sub"]'))).toEqual([
      'r',
      'a',
      'b',
      'd'
    ])
  })

  it('counts every loop under a group', () => {
    expect(countLoopsInGroup(tree.children[0])).toBe(3)
    expect(countLoopsInGroup(tree)).toBe(5)
  })

  it('opens everything when there is at most one top-level group, nothing otherwise', () => {
    expect(defaultExpandedGroupKeys(tree)).toEqual([])
    const single = buildLoopGroupTree([loop('a', ['G1']), loop('c', ['G1', 'Sub'])])
    expect(defaultExpandedGroupKeys(single)).toEqual(['["G1"]', '["G1","Sub"]'])
    expect(defaultExpandedGroupKeys(buildLoopGroupTree([loop('r', [])]))).toEqual([])
  })
})
