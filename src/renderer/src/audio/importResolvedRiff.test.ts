import { describe, expect, it } from 'vitest'
import { buildImportedRifff } from './importResolvedRiff'
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
