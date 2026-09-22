// src/main/traitQuantileCache.ts
//
// Library-wide quantile tables for Discover's trait fields (docs/
// superpowers/specs/2026-09-22-discover-promise-vs-delivery-design.md,
// Phase 1), built over EVERY StemFeatureCache row on ownDb.
//
// Main-process rules this follows (each one a real live freeze/crash this
// codebase has hit):
// - never one long synchronous block: rows are read in keyset pages
//   (`WHERE StemCID > ? ORDER BY StemCID LIMIT ?`, primary-key index, no
//   OFFSET cost) with a yield after every page, and a yield between each
//   field's sort;
// - `.all()` per page, never `.iterate()` across an await;
// - built once and cached per db (WeakMap), rebuilt only when the row count
//   has moved >= 5% since the last build -- a roll never re-parses the
//   table. Concurrent callers share one in-flight build.
import type Database from 'better-sqlite3'
import {
  TRAIT_FIELDS,
  buildQuantileTable,
  type TraitField,
  type TraitQuantileTables
} from '@shared/traitQuantiles'

/** Rows per keyset page. A FeaturesJSON blob is ~19 numbers (~400 bytes),
 * so one page is ~0.8 MB of JSON to parse -- a few ms of synchronous work
 * between yields. */
export const TRAIT_QUANTILE_PAGE_SIZE = 2000

/** Rebuild once the row count has moved by at least this fraction. */
const REBUILD_GROWTH = 0.05

interface CacheEntry {
  tables: TraitQuantileTables
  rowCount: number
}

const cache = new WeakMap<Database.Database, CacheEntry>()
const inFlight = new WeakMap<Database.Database, Promise<CacheEntry>>()

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

function countRows(db: Database.Database): number | null {
  try {
    return (db.prepare(`SELECT COUNT(*) AS n FROM StemFeatureCache`).get() as { n: number }).n
  } catch {
    return null // no table (yet) -- treat as "no tables"
  }
}

async function buildTables(db: Database.Database, rowCount: number): Promise<CacheEntry> {
  const valuesByField = new Map<TraitField, number[]>(TRAIT_FIELDS.map((f) => [f, []]))
  const page = db.prepare(
    `SELECT StemCID, FeaturesJSON FROM StemFeatureCache WHERE StemCID > ? ORDER BY StemCID LIMIT ?`
  )
  let after = ''
  for (;;) {
    const rows = page.all(after, TRAIT_QUANTILE_PAGE_SIZE) as {
      StemCID: string
      FeaturesJSON: string
    }[]
    for (const row of rows) {
      let features: Record<string, unknown>
      try {
        features = JSON.parse(row.FeaturesJSON) as Record<string, unknown>
      } catch {
        continue // malformed row -- contributes nothing
      }
      if (!features || typeof features !== 'object') continue
      for (const field of TRAIT_FIELDS) {
        const v = features[field]
        if (typeof v === 'number' && Number.isFinite(v)) valuesByField.get(field)!.push(v)
      }
    }
    if (rows.length < TRAIT_QUANTILE_PAGE_SIZE) break
    after = rows[rows.length - 1].StemCID
    await yieldToEventLoop()
  }

  const tables: TraitQuantileTables = {}
  for (const field of TRAIT_FIELDS) {
    await yieldToEventLoop()
    const table = buildQuantileTable(valuesByField.get(field)!)
    if (table) tables[field] = table
  }
  return { tables, rowCount }
}

function needsRebuild(entry: CacheEntry | undefined, count: number): boolean {
  if (!entry) return true
  if (count === entry.rowCount) return false
  return Math.abs(count - entry.rowCount) >= REBUILD_GROWTH * entry.rowCount
}

/** The current quantile tables for `db`'s StemFeatureCache (keyed by
 * field). {} when the table is missing/empty or a build fails -- callers
 * then just get null percentiles (unanalysed), never an error. */
export async function getTraitQuantileTables(db: Database.Database): Promise<TraitQuantileTables> {
  const count = countRows(db)
  if (count === null) return {}
  const entry = cache.get(db)
  if (!needsRebuild(entry, count)) return entry!.tables

  let build = inFlight.get(db)
  if (!build) {
    build = buildTables(db, count)
      .then((built) => {
        cache.set(db, built)
        return built
      })
      .finally(() => inFlight.delete(db))
    inFlight.set(db, build)
  }
  try {
    return (await build).tables
  } catch {
    return entry?.tables ?? {}
  }
}

/** Builds the tables ahead of the first trait roll (called once the
 * startup library warmup finishes). Never throws. */
export async function prewarmTraitQuantileTables(db: Database.Database): Promise<void> {
  try {
    await getTraitQuantileTables(db)
  } catch {
    // best-effort
  }
}
