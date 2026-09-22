// src/shared/traitQuantiles.ts
//
// Library-wide percentiles for Discover's trait kinds -- docs/superpowers/
// specs/2026-09-22-discover-promise-vs-delivery-design.md, Phase 1. A trait
// roll used to rank only against the random ~1,000-stem slice it drew
// (pool-relative min-max), so a dull slice still produced a "sparkliest"
// winner. A quantile table per StemFeatures field, built over EVERY cached
// feature row (src/main/traitQuantileCache.ts), turns a raw value into
// "where this stem sits in the whole library" instead.
import {
  DISCOVER_TRAIT_DIRECTION,
  DISCOVER_TRAIT_FIELD,
  DISCOVER_TRAIT_PREFERRED_FIELD,
  type TraitField,
  type TraitFieldValues,
  type TraitValues
} from './discoverTraits'
import type { DiscoverTraitKind } from './discoverSlotKind'

/** 0th..100th percentile, inclusive. */
export const QUANTILE_BREAKPOINTS = 101

/** Index i = the value at the i-th percentile (non-decreasing). */
export type QuantileTable = readonly number[]

export type { TraitField }

/** Every StemFeatures field trait kinds read, preferred and fallback (five:
 * bright/warm share theirs, bassHeavy's are the same field). */
export const TRAIT_FIELDS: readonly TraitField[] = [
  ...new Set([
    ...Object.values(DISCOVER_TRAIT_FIELD),
    ...Object.values(DISCOVER_TRAIT_PREFERRED_FIELD)
  ])
]

/** One table per field (keyed by FIELD, not kind, so bright/warm share). */
export type TraitQuantileTables = Partial<Record<TraitField, QuantileTable>>

/** Library percentile per requested trait kind, in [0, 1], already
 * direction-adjusted (warm = low centroid -> high percentile). null = the
 * stem has no value for it, or no table exists yet. */
export type TraitPercentiles = Partial<Record<DiscoverTraitKind, number | null>>

/** Builds a 101-breakpoint quantile table (linear interpolation between
 * sorted values). Non-finite values are ignored; null when nothing is
 * left. Sorts a Float64Array copy (numeric sort, no comparator calls). */
export function buildQuantileTable(values: readonly number[]): QuantileTable | null {
  let n = 0
  const sorted = new Float64Array(values.length)
  for (const v of values) if (Number.isFinite(v)) sorted[n++] = v
  if (n === 0) return null
  const finite = sorted.subarray(0, n).sort()

  const table = new Array<number>(QUANTILE_BREAKPOINTS)
  for (let i = 0; i < QUANTILE_BREAKPOINTS; i++) {
    const pos = (i / (QUANTILE_BREAKPOINTS - 1)) * (n - 1)
    const lo = Math.floor(pos)
    const hi = Math.min(n - 1, lo + 1)
    table[i] = finite[lo] + (finite[hi] - finite[lo]) * (pos - lo)
  }
  return table
}

/** First index whose breakpoint is >= value (strict=false) or > value
 * (strict=true); table.length when none. */
function bound(table: QuantileTable, value: number, strict: boolean): number {
  let lo = 0
  let hi = table.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (strict ? table[mid] <= value : table[mid] < value) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Where `value` sits in `table`, in [0, 1]. Below the table -> 0, above
 * -> 1; between breakpoints -> linear interpolation; ON a run of equal
 * breakpoints (e.g. many stems with transientDensity exactly 0) -> the
 * middle of that run, so a common value doesn't read as either extreme.
 * Monotone non-decreasing in `value`. null for a missing/empty table or a
 * null/non-finite value. */
export function percentileOf(
  table: QuantileTable | null | undefined,
  value: number | null | undefined
): number | null {
  if (!table || table.length === 0) return null
  if (value === null || value === undefined || !Number.isFinite(value)) return null
  const last = table.length - 1
  if (last === 0) return value < table[0] ? 0 : value > table[0] ? 1 : 0.5

  const a = bound(table, value, false)
  const b = bound(table, value, true)
  if (a < b) return (a + b - 1) / 2 / last // exact match (run of a..b-1)
  if (a === 0) return 0
  if (a > last) return 1
  const below = table[a - 1]
  const above = table[a]
  return (a - 1 + (value - below) / (above - below)) / last
}

/** Turns a stem's TraitValues into TraitPercentiles for exactly the kinds
 * present in `values` (the requested ones -- traitValuesFromFeatures only
 * sets those). {} for {}.
 *
 * Phase 3 (preferred fields): with `fieldValues`, a kind is placed by its
 * PREFERRED field's table when the stem has that field AND the table
 * exists; otherwise by its FALLBACK field's value and table. So during the
 * re-extraction scan every stem gets a percentile from a table built over
 * the same field it's measured by -- a rescanned stem is compared with
 * other rescanned stems, an old row with every row's old field. Without
 * `fieldValues`, `values` are read as fallback-field values. */
export function traitPercentilesFromValues(
  values: TraitValues,
  tables: TraitQuantileTables,
  fieldValues?: TraitFieldValues
): TraitPercentiles {
  const out: TraitPercentiles = {}
  for (const kind of Object.keys(values) as DiscoverTraitKind[]) {
    const preferred = DISCOVER_TRAIT_PREFERRED_FIELD[kind]
    const fallback = DISCOVER_TRAIT_FIELD[kind]
    const preferredValue = fieldValues?.[preferred]
    let p: number | null
    if (
      typeof preferredValue === 'number' &&
      Number.isFinite(preferredValue) &&
      tables[preferred]
    ) {
      p = percentileOf(tables[preferred], preferredValue)
    } else {
      const fallbackValue =
        fieldValues && fallback in fieldValues ? fieldValues[fallback] : values[kind]
      p = percentileOf(tables[fallback], fallbackValue)
    }
    out[kind] = p === null ? null : DISCOVER_TRAIT_DIRECTION[kind] === 'low' ? 1 - p : p
  }
  return out
}
