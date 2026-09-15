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

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA < 1e-10 || normB < 1e-10) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

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
  // Excludes any confirmed embedding whose dimensionality doesn't match the
  // query's -- cosineSimilarity's own loop runs to a.length regardless of
  // b's actual length, so a mismatch would otherwise silently produce
  // either NaN (b shorter -- NaN then sorts unpredictably, since
  // Array.prototype.sort treats a NaN comparator result as tied rather than
  // "last") or a numerically wrong-but-plausible-looking similarity (b
  // longer -- silently truncated). There's a single producer today (the
  // YAMNet worker, always 1024-dim), so this is currently latent, not
  // live, but a future model-version bump or a hand-edited DB row could
  // otherwise silently corrupt a suggestion instead of just being excluded
  // (2026-09-14 code quality review).
  const comparable = confirmed.filter((c) => c.embedding.length === queryEmbedding.length)

  const countsByCategory = new Map<string, number>()
  for (const c of comparable) {
    countsByCategory.set(c.category, (countsByCategory.get(c.category) ?? 0) + 1)
  }
  const eligibleCategories = new Set(
    [...countsByCategory.entries()]
      .filter(([, count]) => count >= MIN_SAMPLES_PER_CATEGORY)
      .map(([category]) => category)
  )
  if (eligibleCategories.size < MIN_CATEGORIES_FOR_SUGGESTION) return null

  const eligible = comparable.filter((c) => eligibleCategories.has(c.category))
  const withSimilarity = eligible
    .map((c) => ({
      category: c.category,
      similarity: cosineSimilarity(queryEmbedding, c.embedding)
    }))
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
