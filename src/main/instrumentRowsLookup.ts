// src/main/instrumentRowsLookup.ts
//
// A StemCID -> Stems.Instrument lookup over discoverCandidates.ts's
// in-memory instrument rows (one entry per row of a db's Stems table,
// loaded at startup by prewarmDiscoverCandidateCaches) -- so the overnight
// classifier can read a stem's mask from memory instead of an IN query
// against the external archive on USB for every batch (background scan
// audit item 2b, 2026-10-05).
//
// No extra copy of the rows: they arrive ordered by StemCID (both the live
// walk and the persisted cache read `ORDER BY StemCID`), so the lookup
// binary-searches that ordered prefix in place. A Map of the archive's
// ~900k rows would cost about 30 MB and 300 ms to build; the one ordering
// check here is a single pass. Rows appended later (a keep folds new stems
// in at the end -- appendToInMemoryDiscoverCaches) and any stretch the check
// finds out of order go into a small Map instead, built as they appear. The
// order the check relies on is JavaScript's own string order, never assumed
// from SQLite's collation, so a lookup is right for any array.
//
// Pure (no database, no 'electron'), so its test stays in CI.

export interface InstrumentRow {
  StemCID: string
  Instrument: number | null
  OwnerJamCID: string
}

/** The mask of `stemCID`'s row: a number, null when the row has none, or
 * undefined when the rows hold no such stem. The first row wins for a
 * repeated StemCID (Stems' primary key makes that impossible in practice). */
export type InstrumentRowsLookup = (stemCID: string) => number | null | undefined

export function createInstrumentRowsLookup(rows: readonly InstrumentRow[]): InstrumentRowsLookup {
  // rows[0, sortedLength) is strictly increasing by StemCID.
  let sortedLength = 0
  while (
    sortedLength < rows.length &&
    (sortedLength === 0 || rows[sortedLength - 1].StemCID < rows[sortedLength].StemCID)
  ) {
    sortedLength += 1
  }
  const tail = new Map<string, number | null>()
  let indexedTo = sortedLength

  function inSortedPrefix(stemCID: string): number | null | undefined {
    let lo = 0
    let hi = sortedLength - 1
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1
      const at = rows[mid].StemCID
      if (at === stemCID) return rows[mid].Instrument
      if (at < stemCID) lo = mid + 1
      else hi = mid - 1
    }
    return undefined
  }

  return (stemCID) => {
    const sorted = inSortedPrefix(stemCID)
    if (sorted !== undefined) return sorted
    for (; indexedTo < rows.length; indexedTo++) {
      const r = rows[indexedTo]
      if (!tail.has(r.StemCID)) tail.set(r.StemCID, r.Instrument)
    }
    return tail.get(stemCID)
  }
}
