// src/main/loopFolders.ts
import { createHash } from 'node:crypto'
import { statSync } from 'node:fs'
import { basename, isAbsolute, relative, resolve, sep } from 'node:path'
import type Database from 'better-sqlite3'
import { barsAtTempo, type LoopTempoSource } from '@shared/loopFolderTempo'
import {
  MAX_LOOP_TEMPO_OVERRIDE,
  MIN_LOOP_TEMPO_OVERRIDE,
  type LinkLoopFolderResult,
  type LoopEntry,
  type LoopFolderListing
} from '@shared/loopFolderTypes'

/** Linked loop folders (docs/superpowers/specs/2026-10-01-import-loop-
 * folders-design.md). sssketch-exclusive, own db only, created by
 * riffLibrarySchema.ts's SCHEMA_SQL like RiffStemsExtra.
 *
 * LoopFiles is keyed by Path, so a rescan is a cheap match on path + size
 * + mtime. LoopId is the stable identity: unique, derived from the
 * normalized path, and the key Phase 2's Discover would use (as the loop's
 * StemCID, via one fallback in stemCIDForPath). Duration, tempo and bars
 * are real columns for the same reason.
 *
 * GroupPath is a JSON array of folder names below the root, format
 * folders already flattened. OverrideBpm is the user's correction. A scan
 * never writes it, and a row holding one is hidden (Present = 0) rather
 * than deleted when its file goes missing, so the correction is still
 * there when the file comes back. */
export const LOOP_FOLDERS_DDL = `
CREATE TABLE IF NOT EXISTS LoopFolders (
  RootPath TEXT PRIMARY KEY,
  Name TEXT NOT NULL,
  Available INTEGER NOT NULL DEFAULT 1,
  LinkedAt INTEGER NOT NULL,
  LastScannedAt INTEGER
);
CREATE TABLE IF NOT EXISTS LoopFiles (
  Path TEXT PRIMARY KEY,
  LoopId TEXT NOT NULL UNIQUE,
  RootPath TEXT NOT NULL,
  GroupPath TEXT NOT NULL,
  Name TEXT NOT NULL,
  SizeBytes INTEGER NOT NULL,
  MtimeMs INTEGER NOT NULL,
  DurationSec REAL,
  Bpm REAL,
  Bars INTEGER,
  TempoSource TEXT,
  Irregular INTEGER NOT NULL DEFAULT 0,
  OverrideBpm REAL,
  Present INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_loopfiles_root ON LoopFiles(RootPath);
`

export interface LoopFileRow {
  Path: string
  LoopId: string
  RootPath: string
  GroupPath: string
  Name: string
  SizeBytes: number
  MtimeMs: number
  DurationSec: number | null
  Bpm: number | null
  Bars: number | null
  TempoSource: string | null
  Irregular: number
  OverrideBpm: number | null
  Present: number
}

/** resolve() for "..", trailing slashes and relative input; NFC because
 * macOS treats NFD and NFC spellings of a name as the same file. */
export function normalizeLoopPath(path: string): string {
  return resolve(path).normalize('NFC')
}

export function loopIdForPath(path: string): string {
  return `loop-${createHash('sha1').update(normalizeLoopPath(path)).digest('hex')}`
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

/** What the renderer sees: the stored guess, unless the user corrected
 * it -- then their tempo, with bars and irregularity worked out from it. */
export function loopEntryFromRow(row: LoopFileRow): LoopEntry {
  const base = {
    loopId: row.LoopId,
    rootPath: row.RootPath,
    path: row.Path,
    name: row.Name,
    groupPath: JSON.parse(row.GroupPath) as string[],
    durationSec: row.DurationSec
  }
  if (row.OverrideBpm !== null) {
    const fit = row.DurationSec !== null ? barsAtTempo(row.DurationSec, row.OverrideBpm) : null
    return {
      ...base,
      bpm: row.OverrideBpm,
      bars: fit?.bars ?? null,
      source: 'user',
      irregular: fit?.irregular ?? false
    }
  }
  return {
    ...base,
    bpm: row.Bpm,
    bars: row.Bars,
    source: row.TempoSource as LoopTempoSource | null,
    irregular: row.Irregular === 1
  }
}

interface LoopFolderRow {
  RootPath: string
  Name: string
  Available: number
  LastScannedAt: number | null
}

/** Two .all() reads, no disk access: this is what IMPORT shows the moment
 * it opens, before the rescan (loopFolderScan.ts) catches up. */
export function listLoopFolders(db: Database.Database): LoopFolderListing[] {
  const folders = db
    .prepare(
      `SELECT RootPath, Name, Available, LastScannedAt FROM LoopFolders
       ORDER BY Name COLLATE NOCASE, RootPath`
    )
    .all() as LoopFolderRow[]
  const rows = db.prepare(`SELECT * FROM LoopFiles WHERE Present = 1`).all() as LoopFileRow[]
  const byRoot = new Map<string, LoopEntry[]>()
  for (const row of rows) {
    const list = byRoot.get(row.RootPath) ?? []
    list.push(loopEntryFromRow(row))
    byRoot.set(row.RootPath, list)
  }
  return folders.map((f) => ({
    rootPath: f.RootPath,
    name: f.Name,
    available: f.Available === 1,
    lastScannedAt: f.LastScannedAt,
    loops: byRoot.get(f.RootPath) ?? []
  }))
}

/** Records the link only. The caller scans it next (index.ts's
 * loop-folders-link). Nested links are refused both ways: LoopFiles is
 * keyed by Path, so one file under two roots would flip between them on
 * every rescan. */
export function linkLoopFolder(
  db: Database.Database,
  rawPath: string,
  now: number = Date.now()
): LinkLoopFolderResult {
  const rootPath = normalizeLoopPath(rawPath)
  let isDirectory = false
  try {
    isDirectory = statSync(rootPath).isDirectory()
  } catch {
    isDirectory = false
  }
  if (!isDirectory) return { ok: false, reason: 'not a folder' }

  const roots = db.prepare(`SELECT RootPath FROM LoopFolders`).all() as { RootPath: string }[]
  for (const { RootPath: other } of roots) {
    if (other === rootPath) return { ok: false, reason: 'already linked' }
    if (isInside(other, rootPath)) return { ok: false, reason: 'inside a linked folder' }
    if (isInside(rootPath, other)) return { ok: false, reason: 'contains a linked folder' }
  }

  const name = basename(rootPath)
  db.prepare(
    `INSERT INTO LoopFolders (RootPath, Name, Available, LinkedAt, LastScannedAt)
     VALUES (?, ?, 1, ?, NULL)`
  ).run(rootPath, name, now)
  return { ok: true, folder: { rootPath, name, available: true, lastScannedAt: null, loops: [] } }
}

/** Never touches the files. Rows holding a correction are hidden rather
 * than deleted, so relinking the same folder gets the corrections back. */
export function unlinkLoopFolder(db: Database.Database, rawPath: string): void {
  const rootPath = normalizeLoopPath(rawPath)
  db.transaction(() => {
    db.prepare(`DELETE FROM LoopFolders WHERE RootPath = ?`).run(rootPath)
    db.prepare(`DELETE FROM LoopFiles WHERE RootPath = ? AND OverrideBpm IS NULL`).run(rootPath)
    db.prepare(`UPDATE LoopFiles SET Present = 0 WHERE RootPath = ?`).run(rootPath)
  })()
}

/** null clears the correction, bringing the guess back. Returns the
 * updated entry, or null for a tempo out of range or an unknown id. */
export function setLoopTempoOverride(
  db: Database.Database,
  loopId: string,
  bpm: number | null
): LoopEntry | null {
  if (
    bpm !== null &&
    !(Number.isFinite(bpm) && bpm >= MIN_LOOP_TEMPO_OVERRIDE && bpm <= MAX_LOOP_TEMPO_OVERRIDE)
  ) {
    return null
  }
  const { changes } = db
    .prepare(`UPDATE LoopFiles SET OverrideBpm = ? WHERE LoopId = ?`)
    .run(bpm, loopId)
  if (changes === 0) return null
  const row = db.prepare(`SELECT * FROM LoopFiles WHERE LoopId = ?`).get(loopId) as
    LoopFileRow | undefined
  return row ? loopEntryFromRow(row) : null
}
