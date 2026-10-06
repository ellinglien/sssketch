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
// preferred (five), and the level pass's three for the radio's intensity score (QUANTILE_FIELDS;
// a level-backfilled row carries the Phase 3 fields too, so the same growth counter rebuilds the
// tables as the backfill proceeds). While the background scan re-extracts old rows, the
// tables also rebuild once rows carrying the new fields have grown >= 5%
// -- tracked with an in-memory counter bumped by every feature-row write
// (noteStemFeatureRowWritten, called from stemFeatureCacheStore.ts), never
// by re-parsing or re-counting the table per roll.
//
// Background efficiency B1 (docs/superpowers/specs/2026-09-22-background-
// efficiency-design.md): the same build also keeps a compact per-stem
// TRAIT VALUE TABLE (TraitValueTable, below) -- StemCID -> the five trait
// fields (and the level pass's three) -- so a Discover roll reads trait values from memory instead of
// re-reading and re-parsing FeaturesJSON. It's kept current between builds
// by the same write hook (noteStemFeatureRowWritten), and a roll only uses
// it while the live row count still matches what it accounts for
// (getTraitValueTable); otherwise the roll falls back to reading SQL.
//
// Background scan audit item 4 (2026-10-05): a REBUILD reads that same
// value table too, while it accounts for every row -- a sort of its columns
// (~90 ms on Elling's 146k rows) instead of re-parsing all 88.7 MB of
// FeaturesJSON (0.8 s warm, 3.8 s cold), which the level backfill used to
// trigger about 20 times, each awaited inside a radio pick. Only the first
// build, or one after the value table lost track of a write, re-parses SQL,
// and once tables exist that one runs in the background while they're
// served.
//
// Background scan audit 4(b): the value table also carries each row's
// feature and level versions (two Uint16 columns, ~0.6 MB at 146k rows), so
// the analysis needs (stemAnalysisNeeds.ts) answer "current / needs the
// level pass" from memory instead of parsing every FeaturesJSON again.
import type Database from 'better-sqlite3'
import { stemFeatureVersionOf, stemLevelVersionOf, type StemFeatures } from '@shared/stemFeatures'
import {
  FALLBACK_FIELDS,
  PREFERRED_TABLE_MIN_ROWS,
  QUANTILE_FIELDS,
  TRAIT_FIELDS,
  tableForField,
  type QuantileField,
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

/** The preferred-field row minimum now lives with the rule that applies it
 * (tableForField, @shared/traitQuantiles); re-exported for this file's tests. */
export { PREFERRED_TABLE_MIN_ROWS }

/** Floor for the new-field growth base, so the first few re-extracted rows
 * don't each trigger a rebuild: growth is measured against
 * max(rows with new fields at the last build, min(this, row count)). */
const NEW_FIELD_GROWTH_FLOOR = 1000

const NEW_FIELDS = TRAIT_FIELDS.filter((f) => !FALLBACK_FIELDS.has(f))

interface CacheEntry {
  tables: TraitQuantileTables
  rowCount: number
  /** Rows carrying at least one Phase 3 field, at build time. */
  newFieldRows: number
}

const cache = new WeakMap<Database.Database, CacheEntry>()
const inFlight = new WeakMap<Database.Database, Build>()
/** Feature-row writes carrying a Phase 3 field since the last build began.
 * Approximate on purpose (a rewrite of an already-new row counts too) --
 * it only decides WHEN to rebuild; the build itself recounts exactly. */
const newFieldWrites = new WeakMap<Database.Database, number>()

/** A version as the Uint16 columns hold it: floored and clamped to [0, 65535].
 * For any integer threshold T in that range, `stored >= T` iff `v >= T`, so
 * every comparison the needs make (`>= STEM_FEATURE_VERSION`, `<
 * STEM_LEVEL_VERSION`) answers exactly as the parsed number would. */
function storedVersion(v: number): number {
  return Math.min(65535, Math.max(0, Math.floor(v)))
}

/** A row's versions in the value table (audit 4(b)). */
export interface StemRowVersions {
  feature: number
  level: number
}

/** Column index of each trait field in TraitValueTable. */
const FIELD_COLUMN = new Map<QuantileField, number>(QUANTILE_FIELDS.map((f, i) => [f, i]))

/** Compact in-memory per-stem trait values (B1): one Float64Array column
 * per quantile field -- the trait fields and, since the intensity arc (spec 2026-10-05 2.2), the
 * level pass's three (NaN = absent/non-finite) -- plus a StemCID -> row Map.
 * Holds every StemFeatureCache row whose FeaturesJSON parses to a truthy
 * value -- exactly the rows a roll's own JSON.parse path would have given
 * trait values to; anything else is "malformed" and gets none. */
export class TraitValueTable {
  private readonly rowByStemCID = new Map<string, number>()
  private readonly stemCIDs: string[] = []
  private columns: Float64Array[] = QUANTILE_FIELDS.map(() => new Float64Array(0))
  /** stemFeatureVersionOf / stemLevelVersionOf per row (storedVersion). */
  private featureVersion = new Uint16Array(0)
  private levelVersion = new Uint16Array(0)
  private readonly malformed = new Set<string>()
  /** Rows whose parsed value is truthy but not an object (`5`, `"x"`,
   * `true`): a row here, all NaN, but not one of the build's parsedRows. */
  private readonly nonObject = new Set<string>()
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
    QUANTILE_FIELDS.forEach((field, i) => {
      out[field] = this.columns[i][row]
    })
    return out as unknown as StemFeatures
  }

  /** The row's feature and level versions, read exactly as the JSON path
   * (stemFeatureVersionOf / stemLevelVersionOf of the parsed value) would:
   * 'malformed' for a row that didn't parse to a truthy value (the JSON
   * path's `catch`: counts as missing), undefined for no row at all. */
  versionsOf(stemCID: string): StemRowVersions | 'malformed' | undefined {
    if (this.malformed.has(stemCID)) return 'malformed'
    const row = this.rowByStemCID.get(stemCID)
    if (row === undefined) return undefined
    return { feature: this.featureVersion[row], level: this.levelVersion[row] }
  }

  /** Every row this table accounts for, with versionsOf's answer (audit 3:
   * the library scan's stale set). Synchronous; malformed rows first. */
  forEachVersions(visit: (stemCID: string, versions: StemRowVersions | 'malformed') => void): void {
    for (const stemCID of this.malformed) visit(stemCID, 'malformed')
    for (let row = 0; row < this.stemCIDs.length; row++) {
      visit(this.stemCIDs[row], {
        feature: this.featureVersion[row],
        level: this.levelVersion[row]
      })
    }
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

  /** What buildTables would collect from the rows this table holds, read in
   * one synchronous pass (background scan audit item 4): each quantile
   * field's finite values (unordered -- the table sorts them), the rows
   * that parsed to an object, and those carrying a Phase 3 field. */
  quantileInputs(): { values: number[][]; parsedRows: number; newFieldRows: number } {
    const values: number[][] = QUANTILE_FIELDS.map(() => [])
    const newFieldColumns = NEW_FIELDS.map((f) => this.columns[FIELD_COLUMN.get(f)!])
    let newFieldRows = 0
    for (let row = 0; row < this.stemCIDs.length; row++) {
      for (let col = 0; col < this.columns.length; col++) {
        const v = this.columns[col][row]
        if (!Number.isNaN(v)) values[col].push(v)
      }
      if (newFieldColumns.some((column) => !Number.isNaN(column[row]))) newFieldRows += 1
    }
    return { values, parsedRows: this.stemCIDs.length - this.nonObject.size, newFieldRows }
  }

  private set(stemCID: string, parsed: unknown): void {
    let row = this.rowByStemCID.get(stemCID)
    if (row === undefined) {
      row = this.stemCIDs.length
      if (row >= this.columns[0].length) this.grow(Math.max(64, row * 2))
      this.stemCIDs.push(stemCID)
      this.rowByStemCID.set(stemCID, row)
    }
    if (typeof parsed === 'object') this.nonObject.delete(stemCID)
    else this.nonObject.add(stemCID)
    const record = parsed as Record<string, unknown>
    for (const [field, col] of FIELD_COLUMN) {
      const v = typeof record === 'object' ? record[field] : undefined
      this.columns[col][row] = typeof v === 'number' && Number.isFinite(v) ? v : NaN
    }
    // parsed is truthy here, so property reads are safe on any JSON value
    this.featureVersion[row] = storedVersion(stemFeatureVersionOf(parsed as StemFeatures))
    this.levelVersion[row] = storedVersion(stemLevelVersionOf(parsed as StemFeatures))
  }

  private grow(capacity: number): void {
    this.columns = this.columns.map((old) => {
      const next = new Float64Array(capacity)
      next.set(old)
      return next
    })
    const feature = new Uint16Array(capacity)
    feature.set(this.featureVersion)
    this.featureVersion = feature
    const level = new Uint16Array(capacity)
    level.set(this.levelVersion)
    this.levelVersion = level
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
  const valuesByField = new Map<QuantileField, number[]>(QUANTILE_FIELDS.map((f) => [f, []]))
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
      for (const field of QUANTILE_FIELDS) {
        const v = features[field]
        if (typeof v === 'number' && Number.isFinite(v)) valuesByField.get(field)!.push(v)
      }
    }
    if (rows.length < TRAIT_QUANTILE_PAGE_SIZE) break
    after = rows[rows.length - 1].StemCID
    await yieldToEventLoop()
  }

  const tables: TraitQuantileTables = {}
  for (const field of QUANTILE_FIELDS) {
    await yieldToEventLoop()
    const table = tableForField(field, valuesByField.get(field)!, parsedRows)
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

/** A rebuild from the value table (audit item 4): one synchronous pass
 * over its columns, then the same tableForField per field (sorts, with a
 * yield before each) as buildTables -- no SQL, no JSON. Identical tables
 * by construction: the columns are exactly the parsed rows (applyWrite
 * keeps them in step with every store write, level merges included), and
 * tableForField sorts, so order doesn't matter. */
async function buildTablesFromValueTable(
  db: Database.Database,
  table: TraitValueTable,
  rowCount: number
): Promise<CacheEntry> {
  // Same rule as buildTables: writes from here on count toward the NEXT
  // rebuild. The snapshot below is synchronous, so none can slip into it.
  newFieldWrites.set(db, 0)
  const { values, parsedRows, newFieldRows } = table.quantileInputs()
  const tables: TraitQuantileTables = {}
  for (let i = 0; i < QUANTILE_FIELDS.length; i++) {
    await yieldToEventLoop()
    const built = tableForField(QUANTILE_FIELDS[i], values[i], parsedRows)
    if (built) tables[QUANTILE_FIELDS[i]] = built
  }
  return { tables, rowCount, newFieldRows }
}

interface Build {
  promise: Promise<CacheEntry>
  /** Re-parsing every FeaturesJSON (the first build, or a value table that
   * no longer accounts for every row). */
  fromSql: boolean
}

function startBuild(db: Database.Database, count: number): Build {
  const started = performance.now()
  const table = valueTables.get(db)
  if (table && table.rowsSeen === count) {
    countWork('trait-quantile:rebuild.memory')
    const promise = buildTablesFromValueTable(db, table, count).then((built) => {
      cache.set(db, built)
      countWork('ms:trait-quantile.rebuild.memory', Math.round(performance.now() - started))
      return built
    })
    return { promise, fromSql: false }
  }
  countWork('trait-quantile:rebuild.sql')
  const promise = buildTables(db, count)
    .then(({ valueTable, ...built }) => {
      cache.set(db, built)
      installValueTable(db, valueTable)
      countWork('ms:trait-quantile.rebuild.sql', Math.round(performance.now() - started))
      return built
    })
    .catch((err: unknown) => {
      pendingWrites.delete(db)
      poisonedBuilds.delete(db)
      throw err
    })
  return { promise, fromSql: true }
}

/** The current quantile tables for `db`'s StemFeatureCache (keyed by
 * field). {} when the table is missing/empty or a build fails -- callers
 * then just get null percentiles (unanalysed), never an error.
 *
 * A rebuild comes from the in-memory value table whenever it accounts for
 * every row (tens of ms; awaited). Only the first build, or one after the
 * value table lost track, re-parses the whole table from SQL -- and when
 * tables already exist that one runs in the background while the existing
 * tables are served: a radio pick awaits this, and must never wait on a
 * full re-parse (background scan audit item 4). */
export async function getTraitQuantileTables(db: Database.Database): Promise<TraitQuantileTables> {
  countWork('sql:trait-quantile.count')
  const count = countRows(db)
  if (count === null) return {}
  const entry = cache.get(db)
  if (!needsRebuild(db, entry, count)) return entry!.tables

  let build = inFlight.get(db)
  if (!build) {
    const started = startBuild(db, count)
    const settled = started.promise.finally(() => inFlight.delete(db))
    // Handled here too: a background build nobody awaits must not surface
    // as an unhandled rejection (callers that do await still see it).
    settled.catch(() => undefined)
    build = { promise: settled, fromSql: started.fromSql }
    inFlight.set(db, build)
  }
  if (entry && build.fromSql) {
    countWork('trait-quantile:served-stale')
    return entry.tables
  }
  try {
    return (await build.promise).tables
  } catch {
    return entry?.tables ?? {}
  }
}

/** Resolves once any build in flight for `db` has settled (tests, and
 * anything that wants the fresh tables rather than the served ones). */
export async function awaitTraitQuantileBuild(db: Database.Database): Promise<void> {
  try {
    await inFlight.get(db)?.promise
  } catch {
    // a failed build keeps the old tables -- nothing to wait for
  }
}

/** What the current tables were built against (row count, rows carrying a
 * Phase 3 field) -- null before the first build. For tests: a rebuild from
 * memory and one from SQL must agree on these too, since they decide when
 * the next rebuild happens. */
export function getTraitQuantileBuildInfo(
  db: Database.Database
): { rowCount: number; newFieldRows: number } | null {
  const entry = cache.get(db)
  return entry ? { rowCount: entry.rowCount, newFieldRows: entry.newFieldRows } : null
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
