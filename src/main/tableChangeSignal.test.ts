import { describe, expect, it } from 'vitest'
import {
  isTableSignalCurrent,
  SCAN_CACHE_INPLACE_TTL_MS,
  type TableSignal
} from './tableChangeSignal'

// Pure-decision tests only -- no database is opened here, so this file
// stays off vitest.config.ts's CI exclusion list (see its own doc comment).
// readTableSignal's SQL (and its shared COUNT memo) is tested in
// tableChangeSignalSql.test.ts, and through riffLibraryStore.test.ts.

const base: TableSignal = { count: 10, maxRowid: 10, writes: 0, dataVersion: 1 }

describe('isTableSignalCurrent', () => {
  it('is current when nothing moved', () => {
    expect(isTableSignalCurrent(base, { ...base }, 0, 1_000)).toBe(true)
  })

  it('is stale the moment a row is added or removed', () => {
    expect(isTableSignalCurrent(base, { ...base, count: 11 }, 0, 1)).toBe(false)
    expect(isTableSignalCurrent(base, { ...base, maxRowid: 11 }, 0, 1)).toBe(false)
  })

  it('is stale the moment THIS table is written in place, with no grace period', () => {
    // The whole point of the per-table counter: an in-place UPDATE this
    // process made (markJamSyncComplete, writeRiffDetail filling in a
    // skeleton) is known exactly, so it invalidates immediately rather
    // than waiting out SCAN_CACHE_INPLACE_TTL_MS.
    expect(isTableSignalCurrent(base, { ...base, writes: 1 }, 0, 1)).toBe(false)
  })

  it('ignores a foreign commit that has not aged past the in-place TTL', () => {
    // A data_version move means SOME other connection committed to this
    // FILE -- it cannot say which table, so it is only suggestive.
    const live = { ...base, dataVersion: 2 }
    expect(isTableSignalCurrent(base, live, 0, SCAN_CACHE_INPLACE_TTL_MS - 1)).toBe(true)
    expect(isTableSignalCurrent(base, live, 0, SCAN_CACHE_INPLACE_TTL_MS)).toBe(false)
  })

  it('does NOT go stale just because the connection wrote to some other table', () => {
    // The regression this whole change exists to fix. The background
    // classifier writes StemAutoCategory/StemFeatureCache on the SAME
    // connection, thousands of rows an hour. Under the old
    // total_changes() signal that made every Jams/Riffs cache stale on a
    // 5-minute timer forever. `writes` is per-table, so an unrelated
    // table's traffic simply does not appear here -- current even long
    // past the in-place TTL.
    const wellPastTtl = SCAN_CACHE_INPLACE_TTL_MS * 10
    expect(isTableSignalCurrent(base, { ...base }, 0, wellPastTtl)).toBe(true)
  })

  it('treats a table that cannot be read as unchanged only if it still cannot be read', () => {
    expect(isTableSignalCurrent(null, null, 0, 1)).toBe(true)
    expect(isTableSignalCurrent(base, null, 0, 1)).toBe(false)
    expect(isTableSignalCurrent(null, base, 0, 1)).toBe(false)
  })
})
