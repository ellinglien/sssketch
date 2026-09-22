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
//
// Phase 3 (feature versions): tables exist per FIELD, fallback and
// preferred (five). While the background scan re-extracts old rows, the
// tables also rebuild once rows carrying the new fields have grown >= 5%
// -- tracked with an in-memory counter bumped by every feature-row write
// (noteStemFeatureRowWritten, called from stemFeatureCacheStore.ts), never
// by re-parsing or re-counting the table per roll.
//
// Background efficiency B1 (docs/superpowers/specs/2026-09-22-background-
// efficiency-design.md): the same build also keeps a compact per-stem
// TRAIT VALUE TABLE (TraitValueTable, below) -- StemCID -> the five trait
// fields -- so a Discover roll reads trait values from memory instead of
// re-reading and re-parsing FeaturesJSON. It's kept current between builds
// by the same write hook (noteStemFeatureRowWritten), and a roll only uses
// it while the live row count still matches what it accounts for
// (getTraitValueTable); otherwise the roll falls back to reading SQL.
import type Database from 'better-sqlite3'
import { DISCOVER_TRAIT_FIELD } from '@shared/discoverTraits'
import type { StemFeatures } from '@shared/stemFeatures'
import {
  TRAIT_FIELDS,
  buildQuantileTable,
  type TraitField,
  type TraitQuantileTables
} from '@shared/traitQuantiles'
import { countWork } from './workCounters'

/** Rows per keyset page. A FeaturesJSON blob is ~19 numbers (~400 bytes),
 * so one page is ~0.8 MB of JSON to parse -- a few ms of synchronous work
 * between yields. */
export const TRAIT_QUANTILE_PAGE_SIZE = 2000

/** Rebuild once the row count has moved by at least this fraction -- and,
 * separately, once rows with the Phase 3 fields have grown by it. */
const REBUILD_GROWTH = 0.05

/** A preferred-only field (rhythmicStrength, spectralCentroidFftHz) gets a
 * table only once at least min(this, half the parsed rows) rows carry it
 * -- a table from a handful of re-extracted stems would be noise. Until then its
 * stems are placed by their fallback field (traitPercentilesFromValues). */
export const PREFERRED_TABLE_MIN_ROWS = 200

/** Floor for the new-field growth base, so the first few re-extracted rows
 * don't each trigger a rebuild: growth is measured against
 * max(rows with new fields at the last build, min(this, row count)). */
const NEW_FIELD_GROWTH_FLOOR = 1000

const FALLBACK_FIELDS = new Set<TraitField>(Object.values(DISCOVER_TRAIT_FIELD))
const NEW_FIELDS = TRAIT_FIELDS.filter((f) => !FALLBACK_FIELDS.has(f))

interface CacheEntry {
  tables: TraitQuantileTables
  rowCount: number
  /** Rows carrying at least one Phase 3 field, at build time. */
  newFieldRows: number
}

const cache = new WeakMap<Database.Database, CacheEntry>()
const inFlight = new WeakMap<Database.Database, Promise<CacheEntry>>()
/** Feature-row writes carrying a Phase 3 field since the last build began.
 * Approximate on purpose (a rewrite of an already-new row counts too) --
 * it only decides WHEN to rebuild; the build itself recounts exactly. */
const newFieldWrites = new WeakMap<Database.Database, number>()

/** Column index of each trait field in TraitValueTable. */
const FIELD_COLUMN = new Map<TraitField, number>(TRAIT_FIELDS.map((f, i) => [f, i]))

/** Compact in-memory per-stem trait values (B1): one Float64Array column
 * per trait field (NaN = absent/non-finite) plus a StemCID -> row Map.
 * Holds every StemFeatureCache row whose FeaturesJSON parses to a truthy
 * value -- exactly the rows a roll's own JSON.parse path would have given
 * trait values to; anything else is "malformed" and gets none. */
export class TraitValueTable {
  private readonly rowByStemCID = new Map<string, number>()
  private readonly stemCIDs: string[] = []
  private columns: Float64Array[] = TRAIT_FIELDS.map(() => new Float64Array(0))
  private readonly malformed = new Set<string>()
  /** StemFeatureCache rows this table accounts for (parsed + malformed) --
   * compared against the live COUNT(*) before a roll trusts it. */
  rowsSeen = 0

  get size(): number {
    return this.stemCIDs.length
  }

  rowOf(stemCID: string): number | undefined {
    return this.rowByStemCID.get(stemCID)
  }

  stemCIDAt(row: number): string {
    return this.stemCIDs[row]
  }

  /** The row's trait fields as a StemFeatures-shaped object -- fed to the
   * SAME traitValuesFromFeatures/traitFieldValuesFromFeatures a parsed
   * FeaturesJSON goes through (NaN reads as absent there, like a missing
   * or non-numeric field). */
  features(row: number): StemFeatures {
    const out: Record<string, number> = {}
    TRAIT_FIELDS.forEach((field, i) => {
      out[field] = this.columns[i][row]
    })
    return out as unknown as StemFeatures
  }

  /** One row as read by the build (counts toward rowsSeen). */
  addFromBuild(stemCID: string, parsed: unknown): void {
    this.rowsSeen += 1
    if (!parsed) {
      this.malformed.add(stemCID)
      return
    }
    this.set(stemCID, parsed)
  }

  /** One row written through the app's own store (upsert). */
  applyWrite(stemCID: string, features: unknown): void {
    if (!this.rowByStemCID.has(stemCID)) {
      if (this.malformed.has(stemCID)) this.malformed.delete(stemCID)
      else this.rowsSeen += 1
    }
    if (features) this.set(stemCID, features)
  }

  private set(stemCID: string, parsed: unknown): void {
    let row = this.rowByStemCID.get(stemCID)
    if (row === undefined) {
      row = this.stemCIDs.length
      if (row >= this.columns[0].length) this.grow(Math.max(64, row * 2))
      this.stemCIDs.push(stemCID)
      this.rowByStemCID.set(stemCID, row)
    }
    const record = parsed as Record<string, unknown>
    for (const [field, col] of FIELD_COLUMN) {
      const v = typeof record === 'object' ? record[field] : undefined
      this.columns[col][row] = typeof v === 'number' && Number.isFinite(v) ? v : NaN
    }
  }

  private grow(capacity: number): void {
    this.columns = this.columns.map((old) => {
      const next = new Float64Array(capacity)
      next.set(old)
      return next
    })
  }
}

const valueTables = new WeakMap<Database.Database, TraitValueTable>()
/** Writes noted while a build is reading pages, re-applied to the new table
 * once it's done (a write can land on a page already read). Present only
 * while a build is in flight. */
const pendingWrites = new WeakMap<Database.Database, Map<string, unknown>>()
/** A write without a StemCID landed mid-build: that build's table can't be
 * trusted either. */
const poisonedBuilds = new WeakSet<Database.Database>()

function hasNewField(features: Record<string, unknown>): boolean {
  return NEW_FIELDS.some((f) => {
    const v = features[f]
    return typeof v === 'number' && Number.isFinite(v)
  })
}

/** Called after every StemFeatureCache write (stemFeatureCacheStore.ts):
 * counts writes of rows carrying the Phase 3 fields, and keeps the trait
 * value table current -- O(1). Without a `stemCID` the table can't be
 * updated, so it's dropped (rolls fall back to SQL until the next build). */
export function noteStemFeatureRowWritten(
  db: Database.Database,
  features: StemFeatures,
  stemCID?: string
): void {
  if (stemCID === undefined) {
    valueTables.delete(db)
    if (pendingWrites.has(db)) poisonedBuilds.add(db)
  } else {
    pendingWrites.get(db)?.set(stemCID, features)
    valueTables.get(db)?.applyWrite(stemCID, features)
  }
  if (!hasNewField(features as unknown as Record<string, unknown>)) return
  newFieldWrites.set(db, (newFieldWrites.get(db) ?? 0) + 1)
}

/** The trait value table for `db`, or null when it isn't built yet or no
 * longer accounts for every StemFeatureCache row (a write this process
 * didn't see) -- the caller then reads SQL as before. One COUNT(*). */
export function getTraitValueTable(db: Database.Database): TraitValueTable | null {
  const table = valueTables.get(db)
  if (!table) return null
  countWork('sql:trait-value-table.count')
  const count = countRows(db)
  return count === table.rowsSeen ? table : null
}

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

interface BuiltTables extends CacheEntry {
  valueTable: TraitValueTable
}

async function buildTables(db: Database.Database, rowCount: number): Promise<BuiltTables> {
  // Writes from here on count toward the NEXT rebuild (a row written mid-
  // build may land on a page already read).
  newFieldWrites.set(db, 0)
  pendingWrites.set(db, new Map())
  const valueTable = new TraitValueTable()
  const valuesByField = new Map<TraitField, number[]>(TRAIT_FIELDS.map((f) => [f, []]))
  let parsedRows = 0
  let newFieldRows = 0
  const page = db.prepare(
    `SELECT StemCID, FeaturesJSON FROM StemFeatureCache WHERE StemCID > ? ORDER BY StemCID LIMIT ?`
  )
  let after = ''
  for (;;) {
    const rows = page.all(after, TRAIT_QUANTILE_PAGE_SIZE) as {
      StemCID: string
      FeaturesJSON: string
    }[]
    countWork('sql:trait-quantile.page')
    countWork('parse:stem-features', rows.length)
    for (const row of rows) {
      let features: Record<string, unknown>
      try {
        features = JSON.parse(row.FeaturesJSON) as Record<string, unknown>
      } catch {
        valueTable.addFromBuild(row.StemCID, null)
        continue // malformed row -- contributes nothing
      }
      valueTable.addFromBuild(row.StemCID, features)
      if (!features || typeof features !== 'object') continue
      parsedRows += 1
      if (hasNewField(features)) newFieldRows += 1
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
  const preferredMinRows = Math.min(PREFERRED_TABLE_MIN_ROWS, Math.ceil(parsedRows / 2))
  for (const field of TRAIT_FIELDS) {
    const values = valuesByField.get(field)!
    if (!FALLBACK_FIELDS.has(field) && values.length < preferredMinRows) continue
    await yieldToEventLoop()
    const table = buildQuantileTable(values)
    if (table) tables[field] = table
  }
  return { tables, rowCount, newFieldRows, valueTable }
}

/** Swaps in a finished build's value table, first re-applying every write
 * noted while it was reading pages. Synchronous -- no write can slip in
 * between. */
function installValueTable(db: Database.Database, table: TraitValueTable): void {
  const pending = pendingWrites.get(db)
  pendingWrites.delete(db)
  if (poisonedBuilds.has(db)) {
    poisonedBuilds.delete(db)
    return
  }
  if (pending) for (const [stemCID, features] of pending) table.applyWrite(stemCID, features)
  valueTables.set(db, table)
}

function needsRebuild(
  db: Database.Database,
  entry: CacheEntry | undefined,
  count: number
): boolean {
  if (!entry) return true
  if (
    count !== entry.rowCount &&
    Math.abs(count - entry.rowCount) >= REBUILD_GROWTH * entry.rowCount
  ) {
    return true
  }
  const growthBase = Math.max(
    entry.newFieldRows,
    Math.min(NEW_FIELD_GROWTH_FLOOR, entry.rowCount),
    1
  )
  return (newFieldWrites.get(db) ?? 0) >= REBUILD_GROWTH * growthBase
}

/** The current quantile tables for `db`'s StemFeatureCache (keyed by
 * field). {} when the table is missing/empty or a build fails -- callers
 * then just get null percentiles (unanalysed), never an error. */
export async function getTraitQuantileTables(db: Database.Database): Promise<TraitQuantileTables> {
  const count = countRows(db)
  if (count === null) return {}
  const entry = cache.get(db)
  if (!needsRebuild(db, entry, count)) return entry!.tables

  let build = inFlight.get(db)
  if (!build) {
    build = buildTables(db, count)
      .then(({ valueTable, ...built }) => {
        cache.set(db, built)
        installValueTable(db, valueTable)
        return built
      })
      .catch((err: unknown) => {
        pendingWrites.delete(db)
        poisonedBuilds.delete(db)
        throw err
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
