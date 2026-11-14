import { describe, expect, it } from 'vitest'
import {
  STEM_CATEGORY_MODEL,
  guessFromProbs,
  predictCategoryProbs,
  type StemCategoryModel
} from './stemCategoryModel'

const tiny: StemCategoryModel = {
  version: 1,
  dims: 2,
  classes: ['drums', 'bass', 'back', 'front'],
  mean: [0, 0],
  scale: [1, 1],
  weights: [
    [4, 0],
    [0, 4],
    [-2, -2],
    [-2, -2]
  ],
  bias: [0, 0, 0, 0.5]
}

describe('predictCategoryProbs', () => {
  it('returns softmax probabilities that sum to 1', () => {
    const p = predictCategoryProbs(tiny, [1, 0])!
    expect(p.drums + p.bass + p.back + p.front).toBeCloseTo(1, 9)
    expect(p.drums).toBeGreaterThan(0.9)
  })
  it('rejects a wrong-length or non-finite embedding, and an untrained model', () => {
    expect(predictCategoryProbs(tiny, [1])).toBeNull()
    expect(predictCategoryProbs(tiny, [NaN, 0])).toBeNull()
    expect(predictCategoryProbs({ ...tiny, version: 0 }, [1, 0])).toBeNull()
  })
})

describe('guessFromProbs', () => {
  it('drums or bass only at 0.8 or more', () => {
    expect(guessFromProbs({ drums: 0.8, bass: 0.1, back: 0.05, front: 0.05 })).toEqual({
      category: 'drums',
      frontScore: null
    })
    expect(guessFromProbs({ drums: 0.79, bass: 0.01, back: 0.1, front: 0.1 })).toEqual({
      category: 'front',
      frontScore: 0.5
    })
  })
  it('otherwise a dial, back below 0.5', () => {
    const g = guessFromProbs({ drums: 0.1, bass: 0.1, back: 0.6, front: 0.2 })
    expect(g.category).toBe('back')
    expect(g.frontScore).toBeCloseTo(0.25, 9)
  })
})

describe('the shipped model', () => {
  it('is trained and takes a 1024-d embedding', () => {
    expect(STEM_CATEGORY_MODEL.version).toBeGreaterThan(0)
    expect(predictCategoryProbs(STEM_CATEGORY_MODEL, new Array(1024).fill(0))).not.toBeNull()
  })
})
