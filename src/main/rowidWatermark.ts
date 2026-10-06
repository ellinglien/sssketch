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
