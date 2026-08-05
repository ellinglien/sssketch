import { describe, it, expect } from 'vitest'
import { computeMergeSequence, cutAtK } from './agglomerativeCluster'

describe('computeMergeSequence', () => {
  it('produces exactly n-1 merges for n input vectors', () => {
    const vectors = [
      [0, 0],
      [1, 0],
      [10, 0],
      [11, 0]
    ]
    const merges = computeMergeSequence(vectors)
    expect(merges).toHaveLength(3)
  })

  it('merges the two closest points first', () => {
    const vectors = [
      [0, 0],
      [0.1, 0],
      [10, 0]
    ]
    const merges = computeMergeSequence(vectors)
    // The first merge should combine indices 0 and 1 (0.1 apart), not
    // either with index 2 (10 apart).
    const firstMerge = merges[0]
    expect(new Set([firstMerge.a, firstMerge.b])).toEqual(new Set([0, 1]))
  })

  it('returns merges in non-decreasing distance order', () => {
    const vectors = [
      [0, 0],
      [0.1, 0],
      [5, 0],
      [5.05, 0],
      [20, 0]
    ]
    const merges = computeMergeSequence(vectors)
    for (let i = 1; i < merges.length; i++) {
      expect(merges[i].distance).toBeGreaterThanOrEqual(merges[i - 1].distance - 1e-9)
    }
  })

  it('handles a single input vector with zero merges', () => {
    expect(computeMergeSequence([[1, 2, 3]])).toEqual([])
  })

  it('handles empty input', () => {
    expect(computeMergeSequence([])).toEqual([])
  })
})

describe('cutAtK', () => {
  it('returns one cluster containing everything when k=1', () => {
    const vectors = [
      [0, 0],
      [0.1, 0],
      [10, 0],
      [10.1, 0]
    ]
    const merges = computeMergeSequence(vectors)
    const clusters = cutAtK(merges, vectors.length, 1)
    expect(clusters).toHaveLength(1)
    expect(clusters[0].sort()).toEqual([0, 1, 2, 3])
  })

  it('returns n singleton clusters when k=n (no merges applied)', () => {
    const vectors = [
      [0, 0],
      [0.1, 0],
      [10, 0]
    ]
    const merges = computeMergeSequence(vectors)
    const clusters = cutAtK(merges, vectors.length, 3)
    expect(clusters).toHaveLength(3)
    expect(clusters.flat().sort()).toEqual([0, 1, 2])
  })

  it('groups two obviously-close points together before an obviously-far one, at an intermediate k', () => {
    const vectors = [
      [0, 0],
      [0.1, 0],
      [50, 0]
    ]
    const merges = computeMergeSequence(vectors)
    const clusters = cutAtK(merges, vectors.length, 2)
    expect(clusters).toHaveLength(2)
    const clusterContaining = (idx: number): number[] => clusters.find((c) => c.includes(idx))!
    expect(clusterContaining(0)).toEqual(clusterContaining(1))
    expect(clusterContaining(2)).not.toEqual(clusterContaining(0))
  })

  it('every original index appears in exactly one resulting cluster, for any k', () => {
    const vectors = [
      [0, 0],
      [1, 1],
      [5, 5],
      [6, 6],
      [20, 20]
    ]
    const merges = computeMergeSequence(vectors)
    for (let k = 1; k <= vectors.length; k++) {
      const clusters = cutAtK(merges, vectors.length, k)
      const allIndices = clusters.flat().sort((a, b) => a - b)
      expect(allIndices).toEqual([0, 1, 2, 3, 4])
    }
  })
})
