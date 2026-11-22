// src/shared/stemCategoryModel.ts
//
// The one stem model (docs/superpowers/specs/2026-11-14-four-categories-design.md): a linear
// softmax over a stem's mean YAMNet embedding. Weights come from
// scripts/train-stem-category-model.mts; version 0 is the untrained placeholder.
import type { StemCategory } from './stemCategory'
import modelJson from './stemCategoryModel.json'

export interface StemCategoryModel {
  version: number
  dims: number
  /** Always drums, bass, back, front: the rows of `weights` and `bias`. */
  classes: StemCategory[]
  mean: number[]
  scale: number[]
  weights: number[][]
  bias: number[]
  report?: unknown
}

export type CategoryProbs = Record<StemCategory, number>

export interface CategoryGuess {
  category: StemCategory
  /** p(front) / (p(front) + p(back)); null for a drums or bass guess. */
  frontScore: number | null
}

export const STEM_CATEGORY_MODEL = modelJson as StemCategoryModel

/** Drums or bass only when the model is at least this sure (spec, "How a stem's category..."). */
export const CONFIDENT_DRUMS_BASS = 0.8

export function predictCategoryProbs(
  model: StemCategoryModel,
  embedding: readonly number[]
): CategoryProbs | null {
  if (model.version < 1 || embedding.length !== model.dims) return null
  const logits = model.bias.slice()
  for (let d = 0; d < model.dims; d++) {
    const x = embedding[d]
    if (!Number.isFinite(x)) return null
    const z = (x - model.mean[d]) / model.scale[d]
    for (let c = 0; c < logits.length; c++) logits[c] += model.weights[c][d] * z
  }
  const max = Math.max(...logits)
  const exps = logits.map((l) => Math.exp(l - max))
  const sum = exps.reduce((a, b) => a + b, 0)
  const out = {} as CategoryProbs
  model.classes.forEach((c, i) => (out[c] = exps[i] / sum))
  // A bad model (a zero scale) gives NaN or Infinity: no guess rather than a wrong one.
  if (!Object.values(out).every(Number.isFinite)) return null
  return out
}

export function guessFromProbs(p: CategoryProbs): CategoryGuess {
  if (p.drums >= CONFIDENT_DRUMS_BASS) return { category: 'drums', frontScore: null }
  if (p.bass >= CONFIDENT_DRUMS_BASS) return { category: 'bass', frontScore: null }
  const sum = p.front + p.back
  const frontScore = sum > 0 ? p.front / sum : 0.5
  return { category: frontScore >= 0.5 ? 'front' : 'back', frontScore }
}
