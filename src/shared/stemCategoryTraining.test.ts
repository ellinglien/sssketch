import { describe, expect, it } from 'vitest'
import {
  TRAINING_CONFIDENT_DRUMS_BASS,
  crossValidate,
  fitStemCategoryModel,
  meetsFloor,
  type ClassReport,
  type CvReport,
  type TrainingSample
} from './stemCategoryTraining'
import { CONFIDENT_DRUMS_BASS, predictCategoryProbs } from './stemCategoryModel'

// Four clusters in 8 dimensions, each jam holding a few of every class.
function synthetic(): TrainingSample[] {
  const centres = { drums: 0, bass: 2, back: 4, front: 6 } as const
  const out: TrainingSample[] = []
  let seed = 1
  const rand = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5
  for (let jam = 0; jam < 10; jam++) {
    for (const [category, axis] of Object.entries(centres)) {
      for (let k = 0; k < 5; k++) {
        const embedding = Array.from({ length: 8 }, (_, d) => (d === axis ? 3 : 0) + rand())
        out.push({
          embedding,
          category: category as TrainingSample['category'],
          group: `jam${jam}`
        })
      }
    }
  }
  return out
}

describe('stemCategoryTraining', () => {
  it('fits a model the inference code accepts', () => {
    const model = fitStemCategoryModel(synthetic(), { version: 3 })
    expect(model.version).toBe(3)
    expect(model.dims).toBe(8)
    const p = predictCategoryProbs(model, [0, 0, 0, 0, 0, 0, 3, 0])!
    expect(p.front).toBeGreaterThan(0.5)
  })

  it('cross-validates by group and passes the floor on separable data', () => {
    const report = crossValidate(synthetic(), { folds: 5 })
    expect(report.frontBackAccuracy).toBeGreaterThan(0.9)
    expect(report.perClass.drums.recall).toBeGreaterThan(0.9)
    expect(meetsFloor(report).ok).toBe(true)
  })

  it('measures the shipped rule: drums or bass only at the confidence threshold', () => {
    const report = crossValidate(synthetic(), { folds: 5, confidentDrumsBass: 1.01 })
    // Nothing reaches p > 1, so the rule never calls drums or bass...
    expect(report.perClass.drums.recall).toBe(0)
    expect(report.perClass.bass.recall).toBe(0)
    expect(report.fourWayAccuracy).toBeLessThan(0.6)
    // ...while argmax still does, for comparison.
    expect(report.perClassArgmax.drums.recall).toBeGreaterThan(0.9)
    // front/back is the side rule either way
    expect(report.frontBackAccuracy).toBeGreaterThan(0.9)
  })

  it('defaults to the threshold the app uses', () => {
    expect(TRAINING_CONFIDENT_DRUMS_BASS).toBe(CONFIDENT_DRUMS_BASS)
  })

  it('refuses a report below the floor', () => {
    const report = crossValidate(
      synthetic().map((s, i) => ({
        ...s,
        category: (['drums', 'bass', 'back', 'front'] as const)[i % 4]
      })),
      { folds: 5 }
    )
    const verdict = meetsFloor(report)
    expect(verdict.ok).toBe(false)
    expect(verdict.reasons.length).toBeGreaterThan(0)
  })

  it('judges drums and bass on precision, not recall', () => {
    const cls = (precision: number, recall: number): ClassReport => ({ n: 50, precision, recall })
    const base: CvReport = {
      n: 200,
      folds: 5,
      fourWayAccuracy: 0.5,
      frontBackAccuracy: 0.62,
      perClass: {
        drums: cls(0.66, 0.3),
        bass: cls(0.53, 0.3),
        back: cls(0.3, 0.4),
        front: cls(0.4, 0.4)
      },
      perClassArgmax: {
        drums: cls(0.66, 0.6),
        bass: cls(0.5, 0.6),
        back: cls(0.3, 0.3),
        front: cls(0.5, 0.4)
      }
    }
    expect(meetsFloor(base).ok).toBe(true)
    const wrongDrums = { ...base, perClass: { ...base.perClass, drums: cls(0.4, 0.9) } }
    expect(meetsFloor(wrongDrums)).toEqual({ ok: false, reasons: ['drums precision 0.400 < 0.5'] })
  })
})
