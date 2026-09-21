// src/shared/embeddingMatch.test.ts
import { describe, expect, it } from 'vitest'
import { suggestCategoryFromEmbedding, type ConfirmedEmbedding } from './embeddingMatch'

function vec(...values: number[]): number[] {
  return values
}

describe('suggestCategoryFromEmbedding', () => {
  it('returns null when fewer than 2 categories have enough confirmed samples', () => {
    const confirmed: ConfirmedEmbedding[] = [
      { category: 'drums', embedding: vec(1, 0, 0) },
      { category: 'drums', embedding: vec(1, 0, 0) },
      { category: 'drums', embedding: vec(1, 0, 0) }
    ]
    expect(suggestCategoryFromEmbedding(confirmed, vec(1, 0, 0))).toBeNull()
  })

  it('returns null when a query is far from any trained category, even with only one candidate', () => {
    const confirmed: ConfirmedEmbedding[] = [
      { category: 'drums', embedding: vec(1, 0, 0) },
      { category: 'drums', embedding: vec(1, 0, 0) },
      { category: 'drums', embedding: vec(1, 0, 0) }
    ]
    // Same regression scenario as categoryCentroids.ts's own 2026-09-14 fix
    // -- a single trained category must never force a match.
    expect(suggestCategoryFromEmbedding(confirmed, vec(0, 0, 1))).toBeNull()
  })

  it('picks the nearest (highest cosine similarity) category once at least 2 are trained', () => {
    const confirmed: ConfirmedEmbedding[] = [
      { category: 'drums', embedding: vec(1, 0, 0) },
      { category: 'drums', embedding: vec(1, 0, 0) },
      { category: 'drums', embedding: vec(1, 0, 0) },
      { category: 'vocal', embedding: vec(0, 1, 0) },
      { category: 'vocal', embedding: vec(0, 1, 0) },
      { category: 'vocal', embedding: vec(0, 1, 0) }
    ]
    expect(suggestCategoryFromEmbedding(confirmed, vec(0.9, 0.1, 0))).toBe('drums')
    expect(suggestCategoryFromEmbedding(confirmed, vec(0.1, 0.9, 0))).toBe('vocal')
  })

  it('declines to guess when the nearest and second-nearest DIFFERENT-category neighbors are too close to call', () => {
    const confirmed: ConfirmedEmbedding[] = [
      { category: 'drums', embedding: vec(1, 0, 0) },
      { category: 'drums', embedding: vec(1, 0, 0) },
      { category: 'drums', embedding: vec(1, 0, 0) },
      { category: 'vocal', embedding: vec(0, 1, 0) },
      { category: 'vocal', embedding: vec(0, 1, 0) },
      { category: 'vocal', embedding: vec(0, 1, 0) }
    ]
    // Exactly equidistant (45 degrees from both) -- must not force a pick.
    expect(suggestCategoryFromEmbedding(confirmed, vec(1, 1, 0))).toBeNull()
  })

  it('ignores a category with fewer than MIN_SAMPLES_PER_CATEGORY confirmed embeddings', () => {
    const confirmed: ConfirmedEmbedding[] = [
      { category: 'drums', embedding: vec(1, 0, 0) },
      { category: 'drums', embedding: vec(1, 0, 0) },
      { category: 'drums', embedding: vec(1, 0, 0) },
      // Only 2 vocal samples -- below the minimum, so 'vocal' isn't a real
      // candidate yet even though it exists in the confirmed list.
      { category: 'vocal', embedding: vec(0, 1, 0) },
      { category: 'vocal', embedding: vec(0, 1, 0) }
    ]
    expect(suggestCategoryFromEmbedding(confirmed, vec(0, 1, 0))).toBeNull()
  })

  it('returns null for an empty confirmed list', () => {
    expect(suggestCategoryFromEmbedding([], vec(1, 0, 0))).toBeNull()
  })

  it('finds the true global nearest-other-category with 3+ eligible categories, not just the first runner-up in list order', () => {
    const confirmed: ConfirmedEmbedding[] = [
      { category: 'drums', embedding: vec(1, 0, 0) },
      { category: 'drums', embedding: vec(1, 0, 0) },
      { category: 'drums', embedding: vec(1, 0, 0) },
      { category: 'vocal', embedding: vec(0, 1, 0) },
      { category: 'vocal', embedding: vec(0, 1, 0) },
      { category: 'vocal', embedding: vec(0, 1, 0) },
      { category: 'bass', embedding: vec(0, 0, 1) },
      { category: 'bass', embedding: vec(0, 0, 1) },
      { category: 'bass', embedding: vec(0, 0, 1) }
    ]
    // Close to drums, clearly far from both vocal and bass -- confirms the
    // margin check isn't accidentally comparing against the wrong runner-up
    // when more than 2 categories are present.
    expect(suggestCategoryFromEmbedding(confirmed, vec(0.95, 0.05, 0.05))).toBe('drums')
  })

  it('treats an all-zero query as 0 similarity to everything (not NaN/crash), and declines to guess', () => {
    const confirmed: ConfirmedEmbedding[] = [
      { category: 'drums', embedding: vec(1, 0, 0) },
      { category: 'drums', embedding: vec(1, 0, 0) },
      { category: 'drums', embedding: vec(1, 0, 0) },
      { category: 'vocal', embedding: vec(0, 1, 0) },
      { category: 'vocal', embedding: vec(0, 1, 0) },
      { category: 'vocal', embedding: vec(0, 1, 0) }
    ]
    expect(() => suggestCategoryFromEmbedding(confirmed, vec(0, 0, 0))).not.toThrow()
    expect(suggestCategoryFromEmbedding(confirmed, vec(0, 0, 0))).toBeNull()
  })

  it('excludes a confirmed embedding whose dimensionality does not match the query, rather than corrupting the comparison', () => {
    const confirmed: ConfirmedEmbedding[] = [
      { category: 'drums', embedding: vec(1, 0, 0) },
      { category: 'drums', embedding: vec(1, 0, 0) },
      { category: 'drums', embedding: vec(1, 0, 0) },
      // 'vocal' only has 2 REAL (matching-dimension) samples -- below
      // MIN_SAMPLES_PER_CATEGORY -- plus one mismatched-dimension entry
      // that must NOT count toward its sample total.
      { category: 'vocal', embedding: vec(0, 1, 0) },
      { category: 'vocal', embedding: vec(0, 1, 0) },
      { category: 'vocal', embedding: vec(0, 1) } // wrong length -- excluded
    ]
    expect(suggestCategoryFromEmbedding(confirmed, vec(0, 1, 0))).toBeNull()
  })
})

describe('createEmbeddingSuggester', () => {
  it('gives exactly the same answer as suggestCategoryFromEmbedding, for many queries against one prepared set', async () => {
    const { createEmbeddingSuggester } = await import('./embeddingMatch')
    let seed = 7
    const rand = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1
    const vec = (dim: number): number[] => Array.from({ length: dim }, rand)
    const confirmed = [
      ...Array.from({ length: 5 }, () => ({ category: 'drums', embedding: vec(16) })),
      ...Array.from({ length: 5 }, () => ({ category: 'bass', embedding: vec(16) })),
      ...Array.from({ length: 4 }, () => ({ category: 'lead', embedding: vec(16) })),
      { category: 'odd-dim', embedding: vec(8) }
    ]
    const suggest = createEmbeddingSuggester(confirmed)
    for (let i = 0; i < 200; i++) {
      const q = i % 20 === 0 ? new Array(16).fill(0) : vec(i % 17 === 0 ? 8 : 16)
      expect(suggest(q)).toBe(suggestCategoryFromEmbedding(confirmed, q))
    }
  })
})
