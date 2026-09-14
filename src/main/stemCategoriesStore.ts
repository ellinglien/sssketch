// src/main/stemCategoriesStore.ts
import { basename } from 'node:path'
import type Database from 'better-sqlite3'
import type { BusId, ProjectRef } from '@shared/types'
import type { ArrangeRole, DrumSubRole } from '@shared/stemRole'
import { sketchProjectPath } from './projectLibrary'

/** Resolves a renderer-supplied ProjectRef into the real absolute path
 * StemCategories.SourceProject should carry -- a library-kind sketch is
 * identified by name only in the renderer (App.tsx's own CurrentSketch),
 * but this column needs the same real .sssketchproj path the backfill
 * migration (stemCategoriesBackfill.ts) already writes for the SAME file,
 * so the two are directly comparable rather than looking like two different
 * projects. Called once per IPC write (not per entry) by index.ts's own
 * handlers -- see stemCategoriesBackfill.ts for the migration's own,
 * already-resolved-path case. */
export function resolveSourceProjectPath(project: ProjectRef): string | null {
  if (project === null) return null
  return project.kind === 'library' ? sketchProjectPath(project.name) : project.path
}

/** A stem's on-disk path is content-addressed by its own StemCID for any
 * stem that actually came from the synced riff library (resolveStemPath,
 * riffLibraryStore.ts:167-182 -- the basename IS the StemCID, no
 * extension). A locally-dropped file, one-shot sample, or in-app recording
 * has no such relationship, so the candidate is validated against the real
 * Stems table before anything is written -- silently skipped (not an
 * error) rather than writing a StemCategories row for a StemCID that isn't
 * real. */
function stemCIDForPath(db: Database.Database, path: string): string | null {
  const candidate = basename(path)
  const row = db.prepare(`SELECT 1 FROM Stems WHERE StemCID = ?`).get(candidate)
  return row ? candidate : null
}

export interface StemBusCategoryEntry {
  path: string
  busId: BusId
}

/** Column-scoped: only ever touches BusId/Source/SourceProject/UpdatedAt,
 * never ArrangeRole/DrumSubRole -- a bus write must never clobber an
 * independently-confirmed role on the same row. The `WHERE
 * excluded.UpdatedAt >= StemCategories.UpdatedAt` guard makes this safe to
 * call in any order across multiple sources (forward capture, backfill)
 * without needing to sort by recency first. */
export function upsertStemCategoryBus(
  db: Database.Database,
  entries: StemBusCategoryEntry[],
  source: string,
  sourceProject: string | null,
  updatedAt: number
): void {
  const stmt = db.prepare(
    `INSERT INTO StemCategories (StemCID, BusId, Source, SourceProject, UpdatedAt)
     VALUES (@stemCID, @busId, @source, @sourceProject, @updatedAt)
     ON CONFLICT(StemCID) DO UPDATE SET
       BusId = excluded.BusId,
       Source = excluded.Source,
       SourceProject = excluded.SourceProject,
       UpdatedAt = excluded.UpdatedAt
     WHERE excluded.UpdatedAt >= StemCategories.UpdatedAt`
  )
  const txn = db.transaction((rows: StemBusCategoryEntry[]) => {
    for (const row of rows) {
      const stemCID = stemCIDForPath(db, row.path)
      if (!stemCID) continue
      stmt.run({ stemCID, busId: row.busId, source, sourceProject, updatedAt })
    }
  })
  txn(entries)
}

export interface StemRoleCategoryEntry {
  path: string
  arrangeRole: ArrangeRole
  drumSubRole?: DrumSubRole
}

/** Column-scoped counterpart to upsertStemCategoryBus -- only ever touches
 * ArrangeRole/DrumSubRole/Source/SourceProject/UpdatedAt, never BusId. */
export function upsertStemCategoryRole(
  db: Database.Database,
  entries: StemRoleCategoryEntry[],
  source: string,
  sourceProject: string | null,
  updatedAt: number
): void {
  const stmt = db.prepare(
    `INSERT INTO StemCategories (StemCID, ArrangeRole, DrumSubRole, Source, SourceProject, UpdatedAt)
     VALUES (@stemCID, @arrangeRole, @drumSubRole, @source, @sourceProject, @updatedAt)
     ON CONFLICT(StemCID) DO UPDATE SET
       ArrangeRole = excluded.ArrangeRole,
       DrumSubRole = excluded.DrumSubRole,
       Source = excluded.Source,
       SourceProject = excluded.SourceProject,
       UpdatedAt = excluded.UpdatedAt
     WHERE excluded.UpdatedAt >= StemCategories.UpdatedAt`
  )
  const txn = db.transaction((rows: StemRoleCategoryEntry[]) => {
    for (const row of rows) {
      const stemCID = stemCIDForPath(db, row.path)
      if (!stemCID) continue
      stmt.run({
        stemCID,
        arrangeRole: row.arrangeRole,
        drumSubRole: row.drumSubRole ?? null,
        source,
        sourceProject,
        updatedAt
      })
    }
  })
  txn(entries)
}

export interface StemCategoryRow {
  stemCID: string
  arrangeRole: ArrangeRole | null
  drumSubRole: DrumSubRole | null
  busId: BusId | null
  source: string
  sourceProject: string | null
  updatedAt: number
}

export function getStemCategory(db: Database.Database, stemCID: string): StemCategoryRow | null {
  const row = db
    .prepare(
      `SELECT StemCID, ArrangeRole, DrumSubRole, BusId, Source, SourceProject, UpdatedAt
       FROM StemCategories WHERE StemCID = ?`
    )
    .get(stemCID) as
    | {
        StemCID: string
        ArrangeRole: string | null
        DrumSubRole: string | null
        BusId: string | null
        Source: string
        SourceProject: string | null
        UpdatedAt: number
      }
    | undefined
  if (!row) return null
  return {
    stemCID: row.StemCID,
    arrangeRole: row.ArrangeRole as ArrangeRole | null,
    drumSubRole: row.DrumSubRole as DrumSubRole | null,
    busId: row.BusId as BusId | null,
    source: row.Source,
    sourceProject: row.SourceProject,
    updatedAt: row.UpdatedAt
  }
}
