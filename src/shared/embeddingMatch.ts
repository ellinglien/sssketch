// src/shared/embeddingMatch.ts

/** One confirmed stem's category (whichever axis the caller queried for --
 * this module is axis-agnostic, unlike categoryCentroids.ts's own
 * CategoryAxis-typed store, since the caller already filters to one axis
 * before calling, see roleEmbeddingRefinement.ts, a later task) alongside
 * its own persisted embedding. */
export interface ConfirmedEmbedding {
  category: string
  embedding: number[]
}

// Mirrors categoryCentroids.ts's own MIN_SAMPLES_PER_CATEGORY exactly --
// same reasoning, same value: a category needs at least this many confirmed
// samples before it's trusted enough to suggest from.
const MIN_SAMPLES_PER_CATEGORY = 3

// Mirrors categoryCentroids.ts's own MIN_TRAINED_CATEGORIES_FOR_SUGGESTION,
// added there 2026-09-14 after a real bug: a single trained category force-
// matched every query, since there was nothing to compare it against. Baked
// in here from the start rather than needing the same fix twice.
const MIN_CATEGORIES_FOR_SUGGESTION = 2

// The nearest DIFFERENT-category neighbor's cosine similarity must exceed
// the second-nearest DIFFERENT-category neighbor's by at least this much to
// count as a confident suggestion -- same "decline rather than force a
// close call" discipline as categoryCentroids.ts's own CONFIDENCE_RATIO,
// expressed as a similarity gap instead of a distance ratio (cosine
// similarity's own [-1, 1] range doesn't have a natural ratio
// interpretation the way a Euclidean distance ratio does).
//
// Loosened from the original 0.05 (2026-09-15, direct request after real-
// library testing against a real ~45,000-stem backlog showed the original
// value declining on effectively EVERY remaining sample -- diagnostic
// logging against Elling's own live, trained data showed real observed
// margins clustered well under 0.05, several in the 0.02-0.034 range that
// a slightly looser bar would confidently accept). Same accuracy/coverage
// trade-off as categoryCentroids.ts's own 0.7->0.85 fix, not a bug fix:
// more of the remaining backlog now gets auto-categorized, some of which
// will be wrong and need correcting by hand via Tidy Up.
const SIMILARITY_MARGIN = 0.02

/**
 * Nearest-neighbor classification for one new stem's embedding, over every
 * OTHER individually confirmed stem's own embedding on the same axis (not a
 * single running centroid per category, unlike categoryCentroids.ts's own
 * suggestCategory -- a rich learned embedding space benefits from real k-NN
 * instead of collapsing to one mean per category). Returns null (not a
 * forced guess) when fewer than MIN_CATEGORIES_FOR_SUGGESTION categories
 * have at least MIN_SAMPLES_PER_CATEGORY confirmed samples, or when the
 * nearest and second-nearest DIFFERENT-category matches are too close to
 * call confidently.
 */
export function suggestCategoryFromEmbedding(
  confirmed: ConfirmedEmbedding[],
  queryEmbedding: number[]
): string | null {
  return createEmbeddingSuggester(confirmed)(queryEmbedding)
}

interface PreparedEmbedding {
  category: string
  embedding: number[]
  /** Squared norm (sum of squares), precomputed once per confirmed vector
   * instead of once per query. */
  norm: number
}

/** Same answers as suggestCategoryFromEmbedding (above, whose doc comment
 * covers the rules), prepared ONCE for a fixed confirmed set and then
 * queried many times. Real live freeze, profiled 2026-09-21 (typing lag +
 * macOS beachball): the overnight classify scan called
 * suggestCategoryFromEmbedding once per stem, re-filtering, re-counting and
 * re-norming the whole confirmed set every time -- ~5s of main-process
 * cosine math per 25s sampled. Eligibility (per query dimensionality) and
 * every confirmed vector's norm are now computed once per set; each query
 * costs one dot product per eligible vector. Arithmetic is kept identical
 * (same dot order, same dot / (sqrt(normA) * sqrt(normB))) so results match
 * exactly, not just approximately. */
export function createEmbeddingSuggester(
  confirmed: ConfirmedEmbedding[]
): (queryEmbedding: number[]) => string | null {
  // Keyed by dimensionality -- a query is only ever compared against
  // confirmed embeddings of its own length (see the doc comment above).
  const eligibleByDim = new Map<number, PreparedEmbedding[] | null>()

  function eligibleFor(dim: number): PreparedEmbedding[] | null {
    const cached = eligibleByDim.get(dim)
    if (cached !== undefined) return cached
    const comparable = confirmed.filter((c) => c.embedding.length === dim)
    const countsByCategory = new Map<string, number>()
    for (const c of comparable) {
      countsByCategory.set(c.category, (countsByCategory.get(c.category) ?? 0) + 1)
    }
    const eligibleCategories = new Set(
      [...countsByCategory.entries()]
        .filter(([, count]) => count >= MIN_SAMPLES_PER_CATEGORY)
        .map(([category]) => category)
    )
    const result =
      eligibleCategories.size < MIN_CATEGORIES_FOR_SUGGESTION
        ? null
        : comparable
            .filter((c) => eligibleCategories.has(c.category))
            .map((c) => {
              let normB = 0
              for (let i = 0; i < c.embedding.length; i++) normB += c.embedding[i] * c.embedding[i]
              return { category: c.category, embedding: c.embedding, norm: normB }
            })
    eligibleByDim.set(dim, result)
    return result
  }

  return (queryEmbedding) => {
    const eligible = eligibleFor(queryEmbedding.length)
    if (!eligible) return null

    let normA = 0
    for (let i = 0; i < queryEmbedding.length; i++) normA += queryEmbedding[i] * queryEmbedding[i]

    const withSimilarity = eligible
      .map((c) => {
        let dot = 0
        for (let i = 0; i < queryEmbedding.length; i++) dot += queryEmbedding[i] * c.embedding[i]
        const similarity =
          normA < 1e-10 || c.norm < 1e-10 ? 0 : dot / (Math.sqrt(normA) * Math.sqrt(c.norm))
        return { category: c.category, similarity }
      })
      .sort((a, b) => b.similarity - a.similarity)

    const nearest = withSimilarity[0]
    const nearestOtherCategory = withSimilarity.find((w) => w.category !== nearest.category)
    if (
      nearestOtherCategory &&
      nearest.similarity - nearestOtherCategory.similarity < SIMILARITY_MARGIN
    ) {
      return null
    }
    return nearest.category
  }
}
