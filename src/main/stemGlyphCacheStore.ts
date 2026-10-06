// src/main/stemGlyphCacheStore.ts
//
// A stem's glyph rings and pitch line, persisted in the own db at the
// resolution they are drawn at (@shared/glyphBands), so opening a project
// stops decoding every stem again and running an FFT band pass and a pitch
// pass just to draw them (background scan audit 8(b), plan
// 2026-10-05-merge-background-scans T9, decision 12).
//
// Keys:
// - a library stem (isLibraryStemName: an extensionless 32-hex name) is
//   keyed by its StemCID with an empty stamp: the file is content-addressed,
//   so the same name is the same audio in every jam folder, and no disk is
//   touched;
// - any other file (drag-imported, baked, loop folder) is keyed by its path
//   and stamped `size:mtimeMs` (one async stat, on the internal disk): a read
//   under another stamp is a miss, and a write replaces the stamp, so a stem
//   re-baked in place overwrites its own row.
//
// Written only when a glyph or a pitch line is computed for a stem a screen
// or a project open asked for -- never by the library scan -- so storage is
// bounded by the stems actually shown.
import { promises as fsPromises } from 'fs'
import { basename } from 'path'
import type Database from 'better-sqlite3'
import { isLibraryStemName } from '@shared/stemPathKind'
import type { GlyphBands, StemGlyphCacheEntry, StemGlyphCacheWrite } from '@shared/glyphBands'
import { GLYPH_BAND_POINTS } from '@shared/glyphBands'
import { countWork } from './workCounters'

/** Created lazily on first use, like DiscoverJamUserPairs -- not in
 * riffLibrarySchema.ts. A cache: safe to drop. */
export const STEM_GLYPH_CACHE_DDL = `
CREATE TABLE IF NOT EXISTS StemGlyphCache (
  CacheKey TEXT PRIMARY KEY,
  Stamp TEXT NOT NULL,
  BandsJSON TEXT,
  PitchBlob BLOB,
  PitchFrames INTEGER,
  ExtractedAt INTEGER NOT NULL
);
`

const ensured = new WeakSet<Database.Database>()

function ensureTable(db: Database.Database): void {
  if (ensured.has(db)) return
  db.exec(STEM_GLYPH_CACHE_DDL)
  ensured.add(db)
}

export type StatFn = (path: string) => Promise<{ size: number; mtimeMs: number }>

export interface StemGlyphCacheKey {
  key: string
  stamp: string
}

/** The row key for `path`, or null when it is not a library stem and can't
 * be stat-ed (nothing to stamp it with: neither read nor written). */
export async function stemGlyphCacheKeyFor(
  path: string,
  stat: StatFn = fsPromises.stat
): Promise<StemGlyphCacheKey | null> {
  const name = basename(path)
  if (isLibraryStemName(name)) return { key: name, stamp: '' }
  try {
    const s = await stat(path)
    return { key: path, stamp: `${s.size}:${s.mtimeMs}` }
  } catch {
    return null
  }
}

function parseBands(json: string | null): GlyphBands | null {
  if (json === null) return null
  try {
    const parsed = JSON.parse(json) as GlyphBands
    const ok = (a: unknown): boolean =>
      Array.isArray(a) && a.length === GLYPH_BAND_POINTS && a.every((v) => typeof v === 'number')
    return ok(parsed.bass) && ok(parsed.mid) && ok(parsed.treble) ? parsed : null
  } catch {
    return null
  }
}

/** The persisted halves for `path`, or null when there is no row, its stamp
 * no longer matches the file, or neither half is readable. */
export async function getStemGlyphCache(
  db: Database.Database,
  path: string,
  stat?: StatFn
): Promise<StemGlyphCacheEntry | null> {
  const id = await stemGlyphCacheKeyFor(path, stat)
  if (!id) return null
  ensureTable(db)
  countWork('sql:stem-glyph-cache.get')
  const row = db
    .prepare(
      `SELECT Stamp, BandsJSON, PitchBlob, PitchFrames FROM StemGlyphCache WHERE CacheKey = ?`
    )
    .get(id.key) as
    | {
        Stamp: string
        BandsJSON: string | null
        PitchBlob: Buffer | null
        PitchFrames: number | null
      }
    | undefined
  if (!row || row.Stamp !== id.stamp) return null
  const bands = parseBands(row.BandsJSON)
  const pitch =
    row.PitchBlob !== null &&
    row.PitchFrames !== null &&
    row.PitchBlob.byteLength === row.PitchFrames * 4
      ? { numFrames: row.PitchFrames, bytes: row.PitchBlob }
      : null
  if (!bands && !pitch) return null
  return { bands, pitch }
}

/** Upserts the halves given. Under the row's own stamp the other half is
 * kept; under a new stamp (the file changed) it is dropped, so a half from
 * the old audio is never served with the new stamp. (In SQLite's DO UPDATE,
 * every SET expression reads the row's old values, so `Stamp` in the CASEs
 * is the old stamp.) */
export async function setStemGlyphCache(
  db: Database.Database,
  path: string,
  write: StemGlyphCacheWrite,
  extractedAt: number,
  stat?: StatFn
): Promise<void> {
  if (!write.bands && !write.pitch) return
  const id = await stemGlyphCacheKeyFor(path, stat)
  if (!id) return
  ensureTable(db)
  countWork('sql:stem-glyph-cache.set')
  const pitchBlob = write.pitch
    ? Buffer.from(
        write.pitch.bytes.buffer,
        write.pitch.bytes.byteOffset,
        write.pitch.bytes.byteLength
      )
    : null
  db.prepare(
    `INSERT INTO StemGlyphCache (CacheKey, Stamp, BandsJSON, PitchBlob, PitchFrames, ExtractedAt)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(CacheKey) DO UPDATE SET
       BandsJSON = CASE WHEN excluded.BandsJSON IS NOT NULL THEN excluded.BandsJSON
                        WHEN Stamp = excluded.Stamp THEN BandsJSON ELSE NULL END,
       PitchBlob = CASE WHEN excluded.PitchFrames IS NOT NULL THEN excluded.PitchBlob
                        WHEN Stamp = excluded.Stamp THEN PitchBlob ELSE NULL END,
       PitchFrames = CASE WHEN excluded.PitchFrames IS NOT NULL THEN excluded.PitchFrames
                          WHEN Stamp = excluded.Stamp THEN PitchFrames ELSE NULL END,
       Stamp = excluded.Stamp,
       ExtractedAt = excluded.ExtractedAt`
  ).run(
    id.key,
    id.stamp,
    write.bands ? JSON.stringify(write.bands) : null,
    pitchBlob,
    write.pitch ? write.pitch.numFrames : null,
    extractedAt
  )
}
