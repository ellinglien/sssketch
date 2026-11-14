// src/shared/stemCategoryTraining.ts
//
// Offline training for stemCategoryModel.ts: multinomial logistic regression with balanced
// class weights and L2, plus cross-validation grouped by jam (a jam's stems never sit on both
// sides of a fold). Type-only imports: scripts/train-stem-category-model.mts loads this file
// straight from Node.
import type { StemCategory } from './stemCategory'
import type { StemCategoryModel } from './stemCategoryModel'

const CLASSES: StemCategory[] = ['drums', 'bass', 'back', 'front']

/** Mirrors CONFIDENT_DRUMS_BASS (stemCategoryModel.ts), which this file can't import (type-only
 * imports, so Node runs it); a test keeps the two equal. */
export const TRAINING_CONFIDENT_DRUMS_BASS = 0.8

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
  /** Under the shipped rule (see crossValidate). */
  fourWayAccuracy: number
  /** Balanced side recall among true back/front stems: the mean of back recall and front
   * recall, deciding by p(front) >= p(back). */
  frontBackAccuracy: number
  /** Under the shipped rule: drums if p(drums) >= the threshold, else bass if p(bass) >= it,
   * else front if p(front) >= p(back), else back. */
  perClass: Record<StemCategory, ClassReport>
  /** By plain argmax, for comparison in the printout. */
  perClassArgmax: Record<StemCategory, ClassReport>
}

/** What a model must reach to ship, measured through the shipped rule (perClass). Front/back:
 * the 2026-10-15 test had the centroid at 0.55, live guesses 0.24, the best model ~0.65 on unseen
 * jams. Drums and bass are judged on precision, not recall (Elling, 2026-11-14): Endlesss's tags
 * already place most of them, a missed one still sits in back/front on the dial, but a wrong
 * call hides a lead under drums, which was the old guesser's bug. */
export const FLOOR = { frontBack: 0.6, drumsPrecision: 0.5, bassPrecision: 0.5 }

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
  {
    folds = 5,
    confidentDrumsBass = TRAINING_CONFIDENT_DRUMS_BASS,
    ...fit
  }: FitOptions & { folds?: number; confidentDrumsBass?: number } = {}
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
  const at = (p: number[], c: StemCategory): number => p[CLASSES.indexOf(c)]
  // guessFromProbs' rule (stemCategoryModel.ts), the one the app ships.
  const shipped = (p: number[]): StemCategory =>
    at(p, 'drums') >= confidentDrumsBass
      ? 'drums'
      : at(p, 'bass') >= confidentDrumsBass
        ? 'bass'
        : at(p, 'front') >= at(p, 'back')
          ? 'front'
          : 'back'
  const perClassBy = (call: (p: number[]) => StemCategory): Record<StemCategory, ClassReport> => {
    const out = {} as Record<StemCategory, ClassReport>
    for (const c of CLASSES) {
      const truths = predicted.filter((r) => r.truth === c)
      const calls = predicted.filter((r) => call(r.probs) === c)
      const hits = truths.filter((r) => call(r.probs) === c).length
      out[c] = {
        n: truths.length,
        precision: calls.length ? hits / calls.length : 0,
        recall: truths.length ? hits / truths.length : 0
      }
    }
    return out
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
      ? predicted.filter((r) => shipped(r.probs) === r.truth).length / predicted.length
      : 0,
    frontBackAccuracy: (sideRecall('back') + sideRecall('front')) / 2,
    perClass: perClassBy(shipped),
    perClassArgmax: perClassBy(argmax)
  }
}

export function meetsFloor(report: CvReport): { ok: boolean; reasons: string[] } {
  const reasons: string[] = []
  if (report.frontBackAccuracy < FLOOR.frontBack)
    reasons.push(`front/back ${report.frontBackAccuracy.toFixed(3)} < ${FLOOR.frontBack}`)
  const { drums, bass } = report.perClass
  if (drums.precision < FLOOR.drumsPrecision)
    reasons.push(`drums precision ${drums.precision.toFixed(3)} < ${FLOOR.drumsPrecision}`)
  if (bass.precision < FLOOR.bassPrecision)
    reasons.push(`bass precision ${bass.precision.toFixed(3)} < ${FLOOR.bassPrecision}`)
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
