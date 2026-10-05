// src/shared/stemAnalysisWrite.ts
import type { StemFeatures } from './stemFeatures'

/** The level pass's fields, merged into an existing feature row (stemAnalysisResultsWriter's
 * mergeStemFeatureLevel): never a whole row, never featureVersion. */
export type StemLevelWrite = Required<
  Pick<StemFeatures, 'loudnessLufs' | 'lowLevelDb' | 'activeFraction' | 'levelVersion'>
>

/** Everything an ambient-scan analysis of one stem persists, for the
 * batched set-stem-analysis-results IPC (background efficiency B7) --
 * each field optional, written exactly as its single-write IPC would:
 * peaks (set-stem-peaks-cache), features (set-stem-feature-cache),
 * embedding (set-stem-embedding-cache), zeroShotAttempted
 * (mark-yamnet-zeroshot-attempted), zeroShotClassIndex
 * (set-yamnet-zeroshot-category), then `level` (merged into the row the features field, or an
 * earlier write, left). Main applies them in that order. */
export interface StemAnalysisWrite {
  path: string
  peaks?: { peaks: number[]; brightness: number[] }
  features?: StemFeatures
  embedding?: number[]
  zeroShotAttempted?: boolean
  zeroShotClassIndex?: number
  level?: StemLevelWrite
}
