// src/shared/stemAnalysisNeeds.ts

/** Which of a stem's persisted analyses still need work -- true = missing
 * (or, for features, older than STEM_FEATURE_VERSION). Answered in batches
 * by main (get-stem-analysis-needs, stemAnalysisNeeds.ts) and consumed by
 * the renderer's analyzeStemOnce.
 *
 * `zeroShot` (background efficiency B5): the stem already has a persisted
 * embedding but its YAMNet zero-shot classification was never attempted
 * (the embedding predates that code) and nothing else has classified or
 * confirmed it yet -- the set the old per-session retroactive scan walked.
 * Never true together with `embedding`: a fresh embedding extraction runs
 * the zero-shot step itself. */
export interface StemAnalysisNeeds {
  peaks: boolean
  features: boolean
  embedding: boolean
  zeroShot: boolean
}

export const ALL_STEM_ANALYSIS_NEEDS: StemAnalysisNeeds = {
  peaks: true,
  features: true,
  embedding: true,
  zeroShot: false
}

export function needsAnyAnalysis(needs: StemAnalysisNeeds): boolean {
  return needs.peaks || needs.features || needs.embedding || needs.zeroShot
}
