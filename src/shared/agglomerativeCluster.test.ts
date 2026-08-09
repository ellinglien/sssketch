import { describe, it, expect } from 'vitest'
import { computeMergeSequence, cutAtK, cutAtKWithIds, splitNode } from './agglomerativeCluster'

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

describe('cutAtKWithIds', () => {
  it('returns the same member partition as cutAtK, just with each cluster tagged by its own dendrogram node id', () => {
    const vectors = [
      [0, 0],
      [0.1, 0],
      [50, 0],
      [50.1, 0]
    ]
    const merges = computeMergeSequence(vectors)
    const plain = cutAtK(merges, vectors.length, 2)
    const withIds = cutAtKWithIds(merges, vectors.length, 2)
    expect(withIds).toHaveLength(2)
    const plainSorted = plain.map((c) => [...c].sort((a, b) => a - b))
    const idSorted = withIds.map((c) => [...c.members].sort((a, b) => a - b))
    expect(new Set(idSorted.map((c) => JSON.stringify(c)))).toEqual(
      new Set(plainSorted.map((c) => JSON.stringify(c)))
    )
  })

  it('assigns ids >= n to any cluster formed by at least one merge, and ids < n only to untouched singletons', () => {
    const vectors = [
      [0, 0],
      [0.1, 0],
      [50, 0]
    ]
    const merges = computeMergeSequence(vectors)
    const withIds = cutAtKWithIds(merges, vectors.length, 2)
    for (const cluster of withIds) {
      if (cluster.members.length > 1) {
        expect(cluster.id).toBeGreaterThanOrEqual(vectors.length)
      } else {
        expect(cluster.id).toBeLessThan(vectors.length)
      }
    }
  })
})

describe('splitNode', () => {
  it('splits a merged cluster into exactly the two children it was formed from', () => {
    const vectors = [
      [0, 0],
      [0.1, 0],
      [50, 0],
      [50.1, 0]
    ]
    const merges = computeMergeSequence(vectors)
    const withIds = cutAtKWithIds(merges, vectors.length, 1) // one cluster containing everything
    const [{ id: rootId, members: rootMembers }] = withIds
    expect(rootMembers.sort((a, b) => a - b)).toEqual([0, 1, 2, 3])

    const children = splitNode(merges, vectors.length, rootId)
    expect(children).not.toBeNull()
    const [childA, childB] = children!
    const allChildMembers = [...childA.members, ...childB.members].sort((a, b) => a - b)
    expect(allChildMembers).toEqual([0, 1, 2, 3])
    // The two children shouldn't overlap, and neither should be empty --
    // otherwise "splitting" would be a no-op or a data-loss bug.
    expect(childA.members.length).toBeGreaterThan(0)
    expect(childB.members.length).toBeGreaterThan(0)
    expect(new Set(childA.members).size + new Set(childB.members).size).toBe(4)
  })

  it('returns null for an original singleton (nothing to split further)', () => {
    const vectors = [
      [0, 0],
      [50, 0]
    ]
    const merges = computeMergeSequence(vectors)
    expect(splitNode(merges, vectors.length, 0)).toBeNull()
    expect(splitNode(merges, vectors.length, 1)).toBeNull()
  })

  it('returns null for an id with no corresponding merge step (out of range)', () => {
    const vectors = [
      [0, 0],
      [50, 0]
    ]
    const merges = computeMergeSequence(vectors)
    expect(splitNode(merges, vectors.length, 999)).toBeNull()
  })

  it('splitting repeatedly down to singletons recovers every original index exactly once', () => {
    const vectors = [
      [0, 0],
      [0.1, 0],
      [0.2, 0],
      [50, 0]
    ]
    const merges = computeMergeSequence(vectors)
    const [{ id: rootId }] = cutAtKWithIds(merges, vectors.length, 1)

    // Recursively split every node all the way down to singletons and
    // collect their member arrays.
    const leaves: number[][] = []
    function expand(id: number): void {
      const children = splitNode(merges, vectors.length, id)
      if (!children) {
        leaves.push([id])
        return
      }
      expand(children[0].id)
      expand(children[1].id)
    }
    expand(rootId)

    const allIndices = leaves.flat().sort((a, b) => a - b)
    expect(allIndices).toEqual([0, 1, 2, 3])
  })
})
