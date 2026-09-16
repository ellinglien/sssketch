// src/main/discoverAdjacency.ts

/** Result of walking outward from a center index in both directions --
 * `newer`/`older` name the two directions unambiguously in real, wall-clock
 * time (not "earlier"/"later", which inverts depending on whether you mean
 * chronological order or DESC-rank order). `newer[0]`/`older[0]`, when
 * present, are always the CLOSEST match to the center in that direction --
 * the row a popover's own step ("skip to the next one this direction")
 * button should act on. */
export interface AdjacentWalkResult<Match> {
  newer: Match[]
  older: Match[]
}

/** Walks outward from `centerIndex` in `window` (already ordered so that a
 * SMALLER index means a row recorded chronologically LATER -- exactly what
 * listRiffs' own `ORDER BY CreationTime DESC` produces, rank 0 = newest) in
 * both directions, calling `matcher` on each row until `maxPerDirection`
 * non-null results are collected per direction OR that direction's rows are
 * exhausted, whichever comes first. Pure -- no I/O of its own; `matcher` may
 * do I/O (real usage resolves a candidate riff's stems over IPC/SQLite), but
 * this function itself has no side effects and is safe to unit test with
 * plain data. */
export async function walkAdjacentWindow<Row, Match>(
  window: Row[],
  centerIndex: number,
  matcher: (row: Row) => Promise<Match | null>,
  maxPerDirection: number
): Promise<AdjacentWalkResult<Match>> {
  // Smaller index = smaller rank = larger CreationTime = recorded AFTER the
  // center = "newer". Walking from centerIndex - 1 down to 0 walks outward,
  // closest-to-center first -- .reverse() after the slice, since slice
  // itself preserves ascending order (index 0 first).
  const newerRows = window.slice(0, centerIndex).reverse()
  // Larger index = larger rank = smaller CreationTime = recorded BEFORE the
  // center = "older". Already closest-to-center first after slicing.
  const olderRows = window.slice(centerIndex + 1)

  async function collect(rows: Row[]): Promise<Match[]> {
    const out: Match[] = []
    for (const row of rows) {
      if (out.length >= maxPerDirection) break
      const match = await matcher(row)
      if (match !== null) out.push(match)
    }
    return out
  }

  const [newer, older] = await Promise.all([collect(newerRows), collect(olderRows)])
  return { newer, older }
}
