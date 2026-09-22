// src/shared/stemAnalysisWrite.ts
import type { StemFeatures } from './stemFeatures'

/** Everything an ambient-scan analysis of one stem persists, for the
 * batched set-stem-analysis-results IPC (background efficiency B7) --
 * each field optional, written exactly as its single-write IPC would:
 * peaks (set-stem-peaks-cache), features (set-stem-feature-cache),
 * embedding (set-stem-embedding-cache), zeroShotAttempted
 * (mark-yamnet-zeroshot-attempted), zeroShotClassIndex
 * (set-yamnet-zeroshot-category). Main applies them in that order. */
export interface StemAnalysisWrite {
  path: string
  peaks?: { peaks: number[]; brightness: number[] }
  features?: StemFeatures
  embedding?: number[]
  zeroShotAttempted?: boolean
  zeroShotClassIndex?: number
}
