// src/shared/stemCategoryTraining.ts
//
// Offline training for stemCategoryModel.ts: multinomial logistic regression with balanced
// class weights and L2, plus cross-validation grouped by jam (a jam's stems never sit on both
// sides of a fold). Type-only imports: scripts/train-stem-category-model.mts loads this file
// straight from Node.
import type { StemCategory } from './stemCategory'
import type { StemCategoryModel } from './stemCategoryModel'

const CLASSES: StemCategory[] = ['drums', 'bass', 'back', 'front']

export interface TrainingSample {
  embedding: number[]
  category: StemCategory
  /** The jam, for grouped folds. */
  group: string
}

export interface FitOptions {
  version?: number
  iterations?: number
  learningRate?: number
  l2?: number
}

export interface ClassReport {
  n: number
  precision: number
  recall: number
}

export interface CvReport {
  n: number
  folds: number
  fourWayAccuracy: number
  /** Balanced accuracy of front vs back among true back/front stems (the larger of the two wins). */
  frontBackAccuracy: number
  perClass: Record<StemCategory, ClassReport>
}

/** The 2026-10-15 test: centroid 0.55, live guesses 0.24, best model ~0.65 on unseen jams. */
export const FLOOR = { frontBack: 0.6, drumsRecall: 0.6, bassRecall: 0.6 }

export function fitStemCategoryModel(
  samples: TrainingSample[],
  { version = 1, iterations = 300, learningRate = 0.1, l2 = 0.01 }: FitOptions = {}
): StemCategoryModel {
  const dims = samples[0]?.embedding.length ?? 0
  const mean = new Array<number>(dims).fill(0)
  const scale = new Array<number>(dims).fill(0)
  for (const s of samples) for (let d = 0; d < dims; d++) mean[d] += s.embedding[d] / samples.length
  for (const s of samples)
    for (let d = 0; d < dims; d++) scale[d] += (s.embedding[d] - mean[d]) ** 2 / samples.length
  for (let d = 0; d < dims; d++) scale[d] = Math.sqrt(scale[d]) || 1

  const z = samples.map((s) => s.embedding.map((x, d) => (x - mean[d]) / scale[d]))
  const y = samples.map((s) => CLASSES.indexOf(s.category))
  const counts = CLASSES.map((_, c) => y.filter((v) => v === c).length)
  const present = counts.filter((n) => n > 0).length
  const classWeight = counts.map((n) => (n > 0 ? samples.length / (present * n) : 0))
  const totalWeight = y.reduce((a, c) => a + classWeight[c], 0)

  const W = CLASSES.map(() => new Array<number>(dims).fill(0))
  const b = CLASSES.map(() => 0)
  const vW = CLASSES.map(() => new Array<number>(dims).fill(0))
  const vb = CLASSES.map(() => 0)
  for (let it = 0; it < iterations; it++) {
    const gW = CLASSES.map(() => new Array<number>(dims).fill(0))
    const gb = CLASSES.map(() => 0)
    for (let i = 0; i < z.length; i++) {
      const p = softmax(CLASSES.map((_, c) => dot(W[c], z[i]) + b[c]))
      const w = classWeight[y[i]] / totalWeight
      for (let c = 0; c < CLASSES.length; c++) {
        const g = w * (p[c] - (c === y[i] ? 1 : 0))
        gb[c] += g
        const row = gW[c]
        const zi = z[i]
        for (let d = 0; d < dims; d++) row[d] += g * zi[d]
      }
    }
    for (let c = 0; c < CLASSES.length; c++) {
      for (let d = 0; d < dims; d++) {
        vW[c][d] = 0.9 * vW[c][d] - learningRate * (gW[c][d] + l2 * W[c][d])
        W[c][d] += vW[c][d]
      }
      vb[c] = 0.9 * vb[c] - learningRate * gb[c]
      b[c] += vb[c]
    }
  }
  return { version, dims, classes: CLASSES.slice(), mean, scale, weights: W, bias: b }
}

export function crossValidate(
  samples: TrainingSample[],
  { folds = 5, ...fit }: FitOptions & { folds?: number } = {}
): CvReport {
  const foldOf = (s: TrainingSample): number => fnv1a(s.group) % folds
  const predicted: { truth: StemCategory; probs: number[] }[] = []
  for (let f = 0; f < folds; f++) {
    const train = samples.filter((s) => foldOf(s) !== f)
    const test = samples.filter((s) => foldOf(s) === f)
    if (train.length === 0 || test.length === 0) continue
    const model = fitStemCategoryModel(train, fit)
    for (const s of test) {
      const zs = s.embedding.map((x, d) => (x - model.mean[d]) / model.scale[d])
      predicted.push({
        truth: s.category,
        probs: softmax(model.weights.map((row, c) => dot(row, zs) + model.bias[c]))
      })
    }
  }
  const argmax = (p: number[]): StemCategory => CLASSES[p.indexOf(Math.max(...p))]
  const perClass = {} as Record<StemCategory, ClassReport>
  for (const c of CLASSES) {
    const truths = predicted.filter((r) => r.truth === c)
    const calls = predicted.filter((r) => argmax(r.probs) === c)
    const hits = truths.filter((r) => argmax(r.probs) === c).length
    perClass[c] = {
      n: truths.length,
      precision: calls.length ? hits / calls.length : 0,
      recall: truths.length ? hits / truths.length : 0
    }
  }
  const sideRecall = (side: 'back' | 'front'): number => {
    const truths = predicted.filter((r) => r.truth === side)
    const right = truths.filter((r) => {
      const front = r.probs[CLASSES.indexOf('front')]
      const back = r.probs[CLASSES.indexOf('back')]
      return side === 'front' ? front >= back : back > front
    })
    return truths.length ? right.length / truths.length : 0
  }
  return {
    n: predicted.length,
    folds,
    fourWayAccuracy: predicted.length
      ? predicted.filter((r) => argmax(r.probs) === r.truth).length / predicted.length
      : 0,
    frontBackAccuracy: (sideRecall('back') + sideRecall('front')) / 2,
    perClass
  }
}

export function meetsFloor(report: CvReport): { ok: boolean; reasons: string[] } {
  const reasons: string[] = []
  if (report.frontBackAccuracy < FLOOR.frontBack)
    reasons.push(`front/back ${report.frontBackAccuracy.toFixed(3)} < ${FLOOR.frontBack}`)
  if (report.perClass.drums.recall < FLOOR.drumsRecall)
    reasons.push(`drums recall ${report.perClass.drums.recall.toFixed(3)} < ${FLOOR.drumsRecall}`)
  if (report.perClass.bass.recall < FLOOR.bassRecall)
    reasons.push(`bass recall ${report.perClass.bass.recall.toFixed(3)} < ${FLOOR.bassRecall}`)
  return { ok: reasons.length === 0, reasons }
}

function dot(a: number[], b: number[]): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

function softmax(logits: number[]): number[] {
  const max = Math.max(...logits)
  const e = logits.map((l) => Math.exp(l - max))
  const sum = e.reduce((a, v) => a + v, 0)
  return e.map((v) => v / sum)
}

function fnv1a(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}
