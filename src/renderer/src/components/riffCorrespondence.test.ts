import { describe, expect, it } from 'vitest'
import type { Rifff, Stem } from '@shared/types'
import { riffCorrespondenceKey } from './riffCorrespondence'

function stem(slot: number, path: string, phaseSourcePath?: string): Stem {
  return {
    slot,
    author: 'elling',
    name: `stem ${slot}`,
    type: 'drums',
    path,
    phaseSourcePath,
    durationSec: 1,
    barLength: 1
  }
}

function rifff(groupId: string, stems: Stem[]): Rifff {
  return {
    groupId,
    name: groupId,
    bpm: 120,
    barLength: 4,
    folderPath: '',
    stems
  }
}

describe('riffCorrespondenceKey', () => {
  it('matches independent copies of the same riff regardless of group id or stem array order', () => {
    const first = rifff('first', [stem(1, '/kick.wav'), stem(2, '/bass.wav')])
    const copy = rifff('copy', [stem(2, '/bass.wav'), stem(1, '/kick.wav')])
    expect(riffCorrespondenceKey(copy)).toBe(riffCorrespondenceKey(first))
  })

  it('continues matching after one copy receives an immutable phase bake', () => {
    const first = rifff('first', [stem(1, '/kick.wav')])
    const rebakedCopy = rifff('copy', [stem(1, '/bakes/kick-rotated.wav', '/kick.wav')])
    expect(riffCorrespondenceKey(rebakedCopy)).toBe(riffCorrespondenceKey(first))
  })

  it('does not equate a variation with a different set of stems', () => {
    const first = rifff('first', [stem(1, '/kick.wav'), stem(2, '/bass.wav')])
    const variation = rifff('variation', [stem(1, '/kick.wav'), stem(2, '/lead.wav')])
    expect(riffCorrespondenceKey(variation)).not.toBe(riffCorrespondenceKey(first))
  })
})
