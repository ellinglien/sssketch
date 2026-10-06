// src/main/rowidWatermark.ts
//
// One copy of the rule every persisted index over an archive table uses to
// decide "extend or rebuild" (scan plan b21ea5a2 decision 2): a cache that
// has read every row up to rowid MaxRowid -- `count` rows, the last one
// carrying key `keyAtMax` -- can be brought up to date by reading only the
// rows past MaxRowid, when
// - the live count is at least the cached count;
// - the row at MaxRowid still carries the same key (else the file was
//   replaced, or VACUUM renumbered rowids);
// - cached count + COUNT(rowid > MaxRowid) is the live count (else rows at
//   or below the watermark were deleted, or deleted and replaced).
// Otherwise it is rebuilt. This was scanTargetCache.ts's canExtend (B6),
// unchanged; the riff index (T2), the instrument rows (T3) and the artist
// pairs (T4) now use it too.
//
// The rule holds for a PARTIAL walk as well: a rebuild that persisted its
// pages as it went (and was interrupted) left a watermark describing
// exactly what it saved, so the next launch extends from there instead of
// starting over.
//
// `COUNT(rowid > ?)` is a rowid range: it reads only the rows past the
// watermark, cheap even on the USB archive.
import type Database from 'better-sqlite3'

export type WatermarkTable = 'Riffs' | 'Stems'
export type WatermarkKeyColumn = 'RiffCID' | 'StemCID'

/** What a cache has read: `count` rows, through rowid `maxRowid` (null when
 * none), the last of which carries key `keyAtMax`. */
export interface RowidWatermark {
  count: number
  maxRowid: number | null
  keyAtMax: string | null
}

export function keyAtRowid(
  db: Database.Database,
  table: WatermarkTable,
  keyColumn: WatermarkKeyColumn,
  rowid: number
): string | null {
  const row = db.prepare(`SELECT ${keyColumn} AS k FROM ${table} WHERE rowid = ?`).get(rowid) as
    { k: string } | undefined
  return row?.k ?? null
}

export function canExtendByRowid(
  db: Database.Database,
  table: WatermarkTable,
  keyColumn: WatermarkKeyColumn,
  meta: RowidWatermark,
  live: { count: number; maxRowid: number | null }
): boolean {
  if (live.count < meta.count) return false
  if (meta.maxRowid === null) return meta.count === 0
  if (keyAtRowid(db, table, keyColumn, meta.maxRowid) !== meta.keyAtMax) return false
  const added = (
    db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE rowid > ?`).get(meta.maxRowid) as {
      n: number
    }
  ).n
  return meta.count + added === live.count
}

/** canExtendByRowid's answer, with the rows past the watermark counted in
 * rowid windows of `window` (a yield between them) instead of one
 * `COUNT(*) WHERE rowid > ?`. That count reads every new row's table page:
 * measured on Elling's USB archive after a 20,000-row sync, 354 ms (Riffs)
 * and 550 ms (Stems) cold, one statement each -- the longest main-thread
 * blocks of a launch that extends (faster startup, 2026-10-06). A window of
 * 2,000 rowids still took up to ~150 ms cold on Riffs; 1,000 is the default.
 * Same rule, same answer. */
export async function canExtendByRowidSliced(
  db: Database.Database,
  table: WatermarkTable,
  keyColumn: WatermarkKeyColumn,
  meta: RowidWatermark,
  live: { count: number; maxRowid: number | null },
  window = 1000
): Promise<boolean> {
  if (live.count < meta.count) return false
  if (meta.maxRowid === null) return meta.count === 0
  if (keyAtRowid(db, table, keyColumn, meta.maxRowid) !== meta.keyAtMax) return false
  const through = live.maxRowid ?? meta.maxRowid
  const count = db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE rowid > ? AND rowid <= ?`)
  let added = 0
  for (let after = meta.maxRowid; after < through; after += window) {
    // A yield between windows only: a check that fits one window (most
    // launches, and every in-session keep) answers without leaving the tick.
    if (after > meta.maxRowid) await new Promise((resolve) => setImmediate(resolve))
    added += (count.get(after, Math.min(after + window, through)) as { n: number }).n
    // Already more rows than the live count leaves room for: no need to read on.
    if (meta.count + added > live.count) return false
  }
  return meta.count + added === live.count
}
