import { describe, expect, it } from 'vitest'
import type { StemRoleInfo } from '@shared/stemRole'
import type { Stem } from '@shared/types'
import { roleConfirmationsFromStemRoles } from './stemCategoryCapture'
import type { FlatStem } from './usePlacedFlatStems'

function flat(stemKey: string, path: string): FlatStem {
  const stem: Stem = {
    slot: 1,
    author: 'e',
    name: path,
    type: 'audioIn',
    path,
    durationSec: 4,
    barLength: 4
  }
  return { stem, groupId: 'g', stemKey }
}

function info(partial: Partial<StemRoleInfo> & { stemKey: string }): StemRoleInfo {
  return {
    soundType: 'audioIn',
    busId: null,
    arrangeRole: 'aux',
    uncertain: false,
    included: true,
    frequency: 'occasional',
    ...partial
  }
}

describe('roleConfirmationsFromStemRoles', () => {
  it('turns included roles into path-keyed confirmations', () => {
    const byKey = new Map([['k1', flat('k1', 'a.wav')]])
    expect(
      roleConfirmationsFromStemRoles([info({ stemKey: 'k1', arrangeRole: 'bass' })], byKey)
    ).toEqual([{ path: 'a.wav', arrangeRole: 'bass', drumSubRole: undefined }])
  })

  it('drops a stem the user excluded', () => {
    const byKey = new Map([['k1', flat('k1', 'a.wav')]])
    expect(
      roleConfirmationsFromStemRoles([info({ stemKey: 'k1', included: false })], byKey)
    ).toEqual([])
  })

  it('drops a stem key with no flat stem behind it', () => {
    expect(roleConfirmationsFromStemRoles([info({ stemKey: 'gone' })], new Map())).toEqual([])
  })

  it('carries a drum sub-role', () => {
    const byKey = new Map([['k1', flat('k1', 'a.wav')]])
    const out = roleConfirmationsFromStemRoles(
      [info({ stemKey: 'k1', arrangeRole: 'drums', drumSubRole: 'kick' })],
      byKey
    )
    expect(out[0].drumSubRole).toBe('kick')
  })
})
