export interface MergeStep {
  /** The two cluster ids merged at this step -- ids 0..n-1 are the
   * original singleton vectors; each merge produces a NEW id (n, n+1,
   * n+2, ...) representing the combined cluster, so later merges can
   * reference earlier merges' own results. Standard agglomerative-
   * clustering dendrogram encoding. */
  a: number
  b: number
  distance: number
}

function euclideanDistance(x: number[], y: number[]): number {
  let sum = 0
  for (let i = 0; i < x.length; i++) sum += (x[i] - y[i]) ** 2
  return Math.sqrt(sum)
}

/**
 * Agglomerative hierarchical clustering, average linkage, Euclidean
 * distance -- computes the FULL merge sequence (n singleton clusters
 * merging pairwise down to 1), so a caller can "cut" it at any cluster
 * count via cutAtK below without re-running this expensive part per cut.
 * O(n^3) (naive: n-1 merge rounds, each scanning all current cluster
 * pairs) -- fine for the realistic stem counts here (a few hundred at
 * most), not something that needs a faster algorithm.
 */
export function computeMergeSequence(vectors: number[][]): MergeStep[] {
  const n = vectors.length
  if (n <= 1) return []

  // clusterMembers[id] = original vector indices currently in that
  // cluster. Ids 0..n-1 start as singletons; each merge allocates a new
  // id for the combined result and RETIRES its two inputs (their own
  // members lists are left in place, harmlessly unread -- this array is
  // local to this function; cutAtK below only ever sees the returned
  // MergeStep[] and rebuilds its own member map independently).
  const clusterMembers: number[][] = vectors.map((_, i) => [i])
  const active = new Set<number>(vectors.map((_, i) => i))
  const merges: MergeStep[] = []
  let nextId = n

  while (active.size > 1) {
    let bestA = -1
    let bestB = -1
    let bestDist = Infinity

    const ids = [...active]
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const membersA = clusterMembers[ids[i]]
        const membersB = clusterMembers[ids[j]]
        let sum = 0
        for (const ai of membersA) {
          for (const bi of membersB) {
            sum += euclideanDistance(vectors[ai], vectors[bi])
          }
        }
        const avgDist = sum / (membersA.length * membersB.length)
        if (avgDist < bestDist) {
          bestDist = avgDist
          bestA = ids[i]
          bestB = ids[j]
        }
      }
    }

    const newId = nextId++
    clusterMembers[newId] = [...clusterMembers[bestA], ...clusterMembers[bestB]]
    active.delete(bestA)
    active.delete(bestB)
    active.add(newId)
    merges.push({ a: bestA, b: bestB, distance: bestDist })
  }

  return merges
}

/**
 * "Cuts" an already-computed merge sequence at cluster count `k`, without
 * re-running clustering -- replays the first (n - k) merges (the
 * CLOSEST/earliest ones) and stops, leaving k active clusters. k=1
 * replays every merge (everything ends up together); k=n replays none
 * (every original vector stays its own singleton).
 */
export function cutAtK(merges: MergeStep[], n: number, k: number): number[][] {
  const clusterMembers = new Map<number, number[]>()
  for (let i = 0; i < n; i++) clusterMembers.set(i, [i])
  const active = new Set<number>(Array.from({ length: n }, (_, i) => i))

  const mergesToApply = Math.max(0, Math.min(merges.length, n - k))
  let nextId = n
  for (let i = 0; i < mergesToApply; i++) {
    const { a, b } = merges[i]
    const newId = nextId++
    clusterMembers.set(newId, [...clusterMembers.get(a)!, ...clusterMembers.get(b)!])
    active.delete(a)
    active.delete(b)
    active.add(newId)
  }

  return [...active].map((id) => clusterMembers.get(id)!)
}
