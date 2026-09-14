// src/shared/roleEmbeddingRefinement.test.ts
import { describe, expect, it } from 'vitest'
import { refineRoleWithEmbeddingOrCentroidSuggestion } from './roleEmbeddingRefinement'
import { resolveStemRole } from './stemRole'
import { emptyCategoryCentroidStore, recordConfirmedCategory } from './categoryCentroids'
import type { ConfirmedEmbedding } from './embeddingMatch'
import type { Stem } from './types'

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

describe('refineRoleWithEmbeddingOrCentroidSuggestion', () => {
  it('leaves a role with a confirmed busId completely untouched', () => {
    const confirmedArrangeRoles: ConfirmedEmbedding[] = [
      { category: 'vocal', embedding: [1, 0, 0] },
      { category: 'vocal', embedding: [1, 0, 0] },
      { category: 'vocal', embedding: [1, 0, 0] },
      { category: 'drums', embedding: [0, 1, 0] },
      { category: 'drums', embedding: [0, 1, 0] },
      { category: 'drums', embedding: [0, 1, 0] }
    ]
    const role = resolveStemRole(fakeStem(), 'k', 'drums')
    const refined = refineRoleWithEmbeddingOrCentroidSuggestion(
      role,
      [1, 0, 0],
      emptyCategoryCentroidStore(),
      { arrangeRoles: confirmedArrangeRoles, drumSubRoles: [] }
    )
    expect(refined).toEqual(role)
  })

  it('prefers a confident embedding match over the centroid classifier', () => {
    let centroidStore = emptyCategoryCentroidStore()
    for (let i = 0; i < 5; i++) {
      centroidStore = recordConfirmedCategory(
        centroidStore,
        'arrangeRole',
        'bass',
        new Array(19).fill(0)
      )
    }
    for (let i = 0; i < 5; i++) {
      centroidStore = recordConfirmedCategory(
        centroidStore,
        'arrangeRole',
        'lead',
        new Array(19).fill(50)
      )
    }
    const confirmedArrangeRoles: ConfirmedEmbedding[] = [
      { category: 'vocal', embedding: [1, 0, 0] },
      { category: 'vocal', embedding: [1, 0, 0] },
      { category: 'vocal', embedding: [1, 0, 0] },
      { category: 'drums', embedding: [0, 1, 0] },
      { category: 'drums', embedding: [0, 1, 0] },
      { category: 'drums', embedding: [0, 1, 0] }
    ]
    const role = resolveStemRole(fakeStem(), 'k', null)
    const refined = refineRoleWithEmbeddingOrCentroidSuggestion(
      role,
      new Array(19).fill(0), // would match 'bass' via the centroid classifier
      centroidStore,
      { arrangeRoles: confirmedArrangeRoles, drumSubRoles: [] },
      [1, 0, 0] // but this embedding confidently matches 'vocal'
    )
    expect(refined.arrangeRole).toBe('vocal')
  })

  it('falls back to the centroid classifier when there is no embedding yet', () => {
    let centroidStore = emptyCategoryCentroidStore()
    for (let i = 0; i < 5; i++) {
      centroidStore = recordConfirmedCategory(
        centroidStore,
        'arrangeRole',
        'bass',
        new Array(19).fill(0)
      )
    }
    for (let i = 0; i < 5; i++) {
      centroidStore = recordConfirmedCategory(
        centroidStore,
        'arrangeRole',
        'lead',
        new Array(19).fill(50)
      )
    }
    const role = resolveStemRole(fakeStem(), 'k', null)
    const refined = refineRoleWithEmbeddingOrCentroidSuggestion(
      role,
      new Array(19).fill(0),
      centroidStore,
      { arrangeRoles: [], drumSubRoles: [] },
      null // no embedding extracted yet for this stem
    )
    expect(refined.arrangeRole).toBe('bass')
  })

  it('falls back to the centroid classifier when the embedding match declines to guess', () => {
    let centroidStore = emptyCategoryCentroidStore()
    for (let i = 0; i < 5; i++) {
      centroidStore = recordConfirmedCategory(
        centroidStore,
        'arrangeRole',
        'bass',
        new Array(19).fill(0)
      )
    }
    for (let i = 0; i < 5; i++) {
      centroidStore = recordConfirmedCategory(
        centroidStore,
        'arrangeRole',
        'lead',
        new Array(19).fill(50)
      )
    }
    // Only one embedding-trained category -- suggestCategoryFromEmbedding
    // declines (same guard as categoryCentroids.ts's own fix).
    const confirmedArrangeRoles: ConfirmedEmbedding[] = [
      { category: 'vocal', embedding: [1, 0, 0] },
      { category: 'vocal', embedding: [1, 0, 0] },
      { category: 'vocal', embedding: [1, 0, 0] }
    ]
    const role = resolveStemRole(fakeStem(), 'k', null)
    const refined = refineRoleWithEmbeddingOrCentroidSuggestion(
      role,
      new Array(19).fill(0),
      centroidStore,
      { arrangeRoles: confirmedArrangeRoles, drumSubRoles: [] },
      [1, 0, 0]
    )
    expect(refined.arrangeRole).toBe('bass')
  })

  it('also suggests a drumSubRole from embeddings when the embedding-suggested arrangeRole is drums', () => {
    const confirmedArrangeRoles: ConfirmedEmbedding[] = [
      { category: 'drums', embedding: [0, 1, 0] },
      { category: 'drums', embedding: [0, 1, 0] },
      { category: 'drums', embedding: [0, 1, 0] },
      { category: 'vocal', embedding: [1, 0, 0] },
      { category: 'vocal', embedding: [1, 0, 0] },
      { category: 'vocal', embedding: [1, 0, 0] }
    ]
    const confirmedDrumSubRoles: ConfirmedEmbedding[] = [
      { category: 'kick', embedding: [0, 1, 0] },
      { category: 'kick', embedding: [0, 1, 0] },
      { category: 'kick', embedding: [0, 1, 0] },
      { category: 'snare', embedding: [0, 0, 1] },
      { category: 'snare', embedding: [0, 0, 1] },
      { category: 'snare', embedding: [0, 0, 1] }
    ]
    const role = resolveStemRole(fakeStem(), 'k', null)
    const refined = refineRoleWithEmbeddingOrCentroidSuggestion(
      role,
      null,
      emptyCategoryCentroidStore(),
      { arrangeRoles: confirmedArrangeRoles, drumSubRoles: confirmedDrumSubRoles },
      [0, 1, 0]
    )
    expect(refined.arrangeRole).toBe('drums')
    expect(refined.drumSubRole).toBe('kick')
  })
})
