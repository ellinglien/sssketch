/**
 * Partitions `clips` into the minimum possible number of tracks such that
 * no two clips on the same track overlap in time -- the classic interval
 * partitioning ("minimum meeting rooms") problem. Half-open intervals:
 * a clip starting exactly when another ends is NOT an overlap (matches
 * buildAlsXml.ts's own [start, end) convention throughout its segment
 * math). Greedy: sort by start, place each clip on the first track whose
 * last-placed clip has already ended, else open a new track. Provably
 * yields the minimum track count for any input (the number of tracks
 * open at any point never exceeds the true max overlap depth, which is a
 * strict lower bound on any valid partition) -- this is a simple O(n*k)
 * scan (k = tracks opened so far) rather than the asymptotically-optimal
 * O(n log n) heap-based version, deliberately: real per-bus track counts
 * are small, so simplicity/obviousness of correctness wins here over the
 * asymptotic improvement. See
 * docs/superpowers/specs/2026-08-05-stem-bus-clustering-design.md.
 */
export function packIntoTracks<T>(
  clips: readonly T[],
  startBar: (c: T) => number,
  endBar: (c: T) => number
): T[][] {
  const sorted = [...clips].sort((a, b) => startBar(a) - startBar(b))
  const tracks: T[][] = []
  const trackEnds: number[] = []

  for (const clip of sorted) {
    const start = startBar(clip)
    let placedOnIndex = -1
    for (let i = 0; i < tracks.length; i++) {
      if (trackEnds[i] <= start) {
        placedOnIndex = i
        break
      }
    }
    if (placedOnIndex === -1) {
      tracks.push([clip])
      trackEnds.push(endBar(clip))
    } else {
      tracks[placedOnIndex].push(clip)
      trackEnds[placedOnIndex] = endBar(clip)
    }
  }

  return tracks
}
