// src/shared/stemAnalysisNeeds.ts

/** Which of a stem's persisted analyses still need work -- true = missing
 * (or, for features, older than STEM_FEATURE_VERSION). Answered in batches
 * by main (get-stem-analysis-needs, stemAnalysisNeeds.ts) and consumed by
 * the renderer's analyzeStemOnce.
 *
 * `level` (spec 2026-10-05-radio-intensity-arc-design section 7.3): the feature row is current
 * but its level pass is older than STEM_LEVEL_VERSION (or missing) -- one decode, the level pass
 * alone, merged into the row. Never true together with `features`: a fresh extraction measures
 * the level itself. Optional so an older main's answer (none) reads as false. */
export interface StemAnalysisNeeds {
  peaks: boolean
  features: boolean
  embedding: boolean
  level?: boolean
}

export const ALL_STEM_ANALYSIS_NEEDS: StemAnalysisNeeds = {
  peaks: true,
  features: true,
  embedding: true,
  level: false
}

export function needsAnyAnalysis(needs: StemAnalysisNeeds): boolean {
  return needs.peaks || needs.features || needs.embedding || needs.level === true
}
