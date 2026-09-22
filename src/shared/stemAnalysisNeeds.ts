// src/shared/stemAnalysisNeeds.ts

/** Which of a stem's persisted analyses still need work -- true = missing
 * (or, for features, older than STEM_FEATURE_VERSION). Answered in batches
 * by main (get-stem-analysis-needs, stemAnalysisNeeds.ts) and consumed by
 * the renderer's analyzeStemOnce. */
export interface StemAnalysisNeeds {
  peaks: boolean
  features: boolean
  embedding: boolean
}

export const ALL_STEM_ANALYSIS_NEEDS: StemAnalysisNeeds = {
  peaks: true,
  features: true,
  embedding: true
}

export function needsAnyAnalysis(needs: StemAnalysisNeeds): boolean {
  return needs.peaks || needs.features || needs.embedding
}
