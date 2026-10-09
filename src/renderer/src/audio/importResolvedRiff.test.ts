import { describe, expect, it } from 'vitest'
import { buildImportedRifff, importedStemVolumes } from './importResolvedRiff'
import { friendlyRiffName } from '@shared/friendlyRiffName'
import type { RiffLibraryResolvedRiff } from '@shared/riffLibraryTypes'

function resolved(extra: Partial<RiffLibraryResolvedRiff> = {}): RiffLibraryResolvedRiff {
  return {
    riffCID: 'kept_1',
    bpm: 120,
    barLength: 4,
    stems: [
      {
        stemCID: 'a',
        slot: 1,
        path: '/x/a',
        gain: 1,
        creatorUserName: 'elling',
        presetName: 'thud',
        instrumentMask: 0,
        durationSec: 8,
        barLength: 4,
        downloadUrl: null
      }
    ],
    ...extra
  }
}

describe('buildImportedRifff', () => {
  it('names a radio-hearts riff by its ♥ label', () => {
    const result = buildImportedRifff(
      'kept_1',
      resolved({ name: '♥ 3 · misty kestrel' }),
      undefined,
      'library',
      'riff library'
    )
    expect(result?.rifff.name).toBe('♥ 3 · misty kestrel')
  })

  it('names every other riff from its id', () => {
    const result = buildImportedRifff('kept_1', resolved(), undefined, 'library', 'riff library')
    expect(result?.rifff.name).toBe(friendlyRiffName('kept_1', 'library'))
  })
})

describe('importedStemVolumes', () => {
  it('matches library preview by multiplying each source gain by shared headroom', () => {
    const riff = resolved({
      stems: [
        { ...resolved().stems[0], slot: 1, stemCID: 'a', gain: 1 },
        { ...resolved().stems[0], slot: 3, stemCID: 'b', gain: 0.81 },
        { ...resolved().stems[0], slot: 6, stemCID: 'c', gain: 0.5 }
      ]
    })

    const volumes = importedStemVolumes('g', riff, [1, 3, 6])
    expect(volumes['g:1']).toBeCloseTo(1 / Math.sqrt(3), 12)
    expect(volumes['g:3']).toBeCloseTo(0.81 / Math.sqrt(3), 12)
    expect(volumes['g:6']).toBeCloseTo(0.5 / Math.sqrt(3), 12)
  })

  it('sets only newly merged rows and counts only locally cached stems', () => {
    const riff = resolved({
      stems: [
        { ...resolved().stems[0], slot: 1, stemCID: 'old', gain: 0.9 },
        { ...resolved().stems[0], slot: 2, stemCID: 'new', gain: 0.8 },
        { ...resolved().stems[0], slot: 3, stemCID: 'missing', path: null, gain: 0.7 }
      ]
    })

    expect(importedStemVolumes('g', riff, [2])).toEqual({
      'g:2': 0.8 / Math.sqrt(2)
    })
  })
})
