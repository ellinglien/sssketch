import { describe, expect, it } from 'vitest'
import { refineRoleWithCentroidSuggestion } from './roleCentroidRefinement'
import { resolveStemRole } from './stemRole'
import { emptyCategoryCentroidStore, recordConfirmedCategory } from './categoryCentroids'
import type { Stem } from './types'

const DIM = 19
function vec(fillValue: number): number[] {
  return new Array(DIM).fill(fillValue)
}

function fakeStem(overrides: Partial<Stem> = {}): Stem {
  return {
    slot: 1,
    author: 'someone',
    name: 'untitled',
    type: 'fx',
    path: '/lib/some-stem',
    durationSec: 4,
    barLength: 4,
    ...overrides
  }
}

describe('refineRoleWithCentroidSuggestion', () => {
  it('leaves a role with a confirmed busId completely untouched, even with a confident suggestion available', () => {
    let store = emptyCategoryCentroidStore()
    for (let i = 0; i < 5; i++) store = recordConfirmedCategory(store, 'arrangeRole', 'vocal', vec(0))
    const role = resolveStemRole(fakeStem(), 'k', 'drums')
    const refined = refineRoleWithCentroidSuggestion(role, vec(0), store)
    expect(refined).toEqual(role)
  })

  it('leaves the role untouched when no feature vector was scanned yet (null)', () => {
    const store = emptyCategoryCentroidStore()
    const role = resolveStemRole(fakeStem(), 'k', null)
    const refined = refineRoleWithCentroidSuggestion(role, null, store)
    expect(refined).toEqual(role)
  })

  it('leaves the role untouched when the classifier has no confident suggestion yet (cold start)', () => {
    const store = emptyCategoryCentroidStore()
    const role = resolveStemRole(fakeStem(), 'k', null)
    const refined = refineRoleWithCentroidSuggestion(role, vec(0), store)
    expect(refined).toEqual(role)
  })

  it('overrides arrangeRole with a confident suggestion, and clears uncertain', () => {
    let store = emptyCategoryCentroidStore()
    for (let i = 0; i < 5; i++) store = recordConfirmedCategory(store, 'arrangeRole', 'vocal', vec(0))
    const role = resolveStemRole(fakeStem({ type: 'fx' }), 'k', null)
    expect(role.uncertain).toBe(true)
    const refined = refineRoleWithCentroidSuggestion(role, vec(0), store)
    expect(refined.arrangeRole).toBe('vocal')
    expect(refined.uncertain).toBe(false)
  })

  it('also suggests a drumSubRole when the arrangeRole suggestion is drums and drumSubRole has a confident match', () => {
    let store = emptyCategoryCentroidStore()
    for (let i = 0; i < 5; i++) store = recordConfirmedCategory(store, 'arrangeRole', 'drums', vec(0))
    for (let i = 0; i < 5; i++) store = recordConfirmedCategory(store, 'drumSubRole', 'kick', vec(0))
    const role = resolveStemRole(fakeStem(), 'k', null)
    const refined = refineRoleWithCentroidSuggestion(role, vec(0), store)
    expect(refined.arrangeRole).toBe('drums')
    expect(refined.drumSubRole).toBe('kick')
  })

  it('does not set a drumSubRole when the suggested arrangeRole is not drums', () => {
    let store = emptyCategoryCentroidStore()
    for (let i = 0; i < 5; i++) store = recordConfirmedCategory(store, 'arrangeRole', 'vocal', vec(0))
    for (let i = 0; i < 5; i++) store = recordConfirmedCategory(store, 'drumSubRole', 'kick', vec(0))
    const role = resolveStemRole(fakeStem(), 'k', null)
    const refined = refineRoleWithCentroidSuggestion(role, vec(0), store)
    expect(refined.arrangeRole).toBe('vocal')
    expect(refined.drumSubRole).toBeUndefined()
  })

  it('overrides a PresetName-based guess too, not just the raw SoundType fallback -- centroid ranks above PresetName', () => {
    let store = emptyCategoryCentroidStore()
    for (let i = 0; i < 5; i++) store = recordConfirmedCategory(store, 'arrangeRole', 'vocal', vec(0))
    // 'Keymasher' is a real, known FX preset name -- resolveStemRole alone
    // would guess 'textureFx' from it.
    const role = resolveStemRole(fakeStem({ name: 'Keymasher', type: 'fx' }), 'k', null)
    expect(role.arrangeRole).toBe('textureFx')
    const refined = refineRoleWithCentroidSuggestion(role, vec(0), store)
    expect(refined.arrangeRole).toBe('vocal')
  })
})
