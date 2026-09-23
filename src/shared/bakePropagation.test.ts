import { describe, it, expect } from 'vitest'
import { groupIdsSharingStemPaths, placedClipsSharingStems } from './bakePropagation'
import type { Rifff, Stem } from './types'

function stem(slot: number, path: string): Stem {
  return { slot, author: 'a', name: `s${slot}`, type: 'drums', path, durationSec: 4, barLength: 1 }
}

function rifff(groupId: string, stems: Stem[], startBar?: number): Rifff {
  return { groupId, name: groupId, bpm: 120, barLength: 1, folderPath: '/f', stems, startBar }
}

/** One source rifff auto-arranged into three window-copies: three fresh
 * groupIds, one shared stem file. See selectors.ts's pasteStemWindowAction. */
const arranged: Record<string, Rifff> = {
  c1: rifff('c1', [stem(0, '/w/kick.baked.wav')], 0),
  c2: rifff('c2', [stem(0, '/w/kick.baked.wav')], 8),
  c3: rifff('c3', [stem(0, '/w/kick.baked.wav')], 16),
  other: rifff('other', [stem(0, '/w/bass.baked.wav')], 0)
}

describe('groupIdsSharingStemPaths', () => {
  it('finds every clip pointing at the same file, not just the one asked about', () => {
    expect(groupIdsSharingStemPaths(arranged, ['/w/kick.baked.wav'])).toEqual(['c1', 'c2', 'c3'])
  })

  it('leaves clips built from a different file alone', () => {
    expect(groupIdsSharingStemPaths(arranged, ['/w/bass.baked.wav'])).toEqual(['other'])
  })

  it('matches a multi-stem rifff on any one of its stems', () => {
    const rifffs = {
      r1: rifff('r1', [stem(0, '/w/a.wav'), stem(1, '/w/b.wav')]),
      r2: rifff('r2', [stem(0, '/w/b.wav')])
    }
    expect(groupIdsSharingStemPaths(rifffs, ['/w/b.wav'])).toEqual(['r1', 'r2'])
  })

  it('includes a shelf copy -- the file is the file, placed or not', () => {
    const rifffs = {
      placed: rifff('placed', [stem(0, '/w/a.wav')], 4),
      shelf: rifff('shelf', [stem(0, '/w/a.wav')])
    }
    expect(groupIdsSharingStemPaths(rifffs, ['/w/a.wav'])).toEqual(['placed', 'shelf'])
  })

  it('returns each groupId once however many of its stems matched', () => {
    const rifffs = { r1: rifff('r1', [stem(0, '/w/a.wav'), stem(1, '/w/a.wav')]) }
    expect(groupIdsSharingStemPaths(rifffs, ['/w/a.wav'])).toEqual(['r1'])
  })

  it('is empty when nothing matches, and when asked about nothing', () => {
    expect(groupIdsSharingStemPaths(arranged, ['/w/nope.wav'])).toEqual([])
    expect(groupIdsSharingStemPaths(arranged, [])).toEqual([])
  })
})

describe('placedClipsSharingStems', () => {
  it('counts every placed clip a downbeat pick will move, including the picked one', () => {
    expect(placedClipsSharingStems(arranged, 'c1')).toBe(3)
  })

  it('does not count shelf copies -- "clips" means things on the timeline', () => {
    const rifffs = {
      placed: rifff('placed', [stem(0, '/w/a.wav')], 4),
      shelf: rifff('shelf', [stem(0, '/w/a.wav')])
    }
    expect(placedClipsSharingStems(rifffs, 'shelf')).toBe(1)
  })

  it('is 0 for a groupId that is not there', () => {
    expect(placedClipsSharingStems(arranged, 'gone')).toBe(0)
  })

  it('is 1 for a lone clip nothing else shares', () => {
    expect(placedClipsSharingStems(arranged, 'other')).toBe(1)
  })
})
