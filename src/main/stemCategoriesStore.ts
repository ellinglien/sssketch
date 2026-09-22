// src/main/stemCategoriesStore.ts
import { basename } from 'node:path'
import type Database from 'better-sqlite3'
import type { BusId, ProjectRef } from '@shared/types'
import type { ArrangeRole, DrumSubRole } from '@shared/stemRole'
import { sketchProjectPath } from './projectLibrary'
import { countWork } from './workCounters'
import { bumpStemClassificationVersion } from './stemClassificationVersion'
import { noteAutoClassifyTrainingChanged } from './stemAutoClassifyWake'

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
 * real.
 *
 * `db` (the primary/first-checked argument) is what the resulting
 * StemCategories/StemFeatureCache row will actually be WRITTEN into
 * (always openOwnRiffLibraryDb() in real production use) and is also
 * checked first for the stem's existence. `extraCandidateDbs` are
 * additional databases -- typically the currently-configured browsing
 * root, when it differs from the own warehouse (e.g. an external LORE
 * archive, see riffLibraryStore.ts's candidateDbsForRiff) -- checked in
 * order after `db`, for a stem whose Stems row lives somewhere else
 * entirely. Defaults to empty so every existing caller (and every existing
 * test) is completely unaffected unless it explicitly opts in. */
export function stemCIDForPath(
  db: Database.Database,
  path: string,
  extraCandidateDbs: Database.Database[] = []
): string | null {
  const candidate = basename(path)
  for (const candidateDb of [db, ...extraCandidateDbs]) {
    countWork('sql:stemCIDForPath')
    const row = candidateDb.prepare(`SELECT 1 FROM Stems WHERE StemCID = ?`).get(candidate)
    if (row) return candidate
  }
  return null
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
  updatedAt: number,
  extraCandidateDbs: Database.Database[] = []
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
      const stemCID = stemCIDForPath(db, row.path, extraCandidateDbs)
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
  /** Free-text, user-typed specific label -- direct request, 2026-09-21:
   * "allow user to be specific with the tidy up category (and make a
   * note of it for future reference? for ML categorization perhaps?) but
   * keep bunched grouping for the exports." Purely a logged note for now
   * -- trainCentroidsFromRoleEntries (categoryCentroidTraining.ts) reads
   * only `arrangeRole`/`drumSubRole`/`path` from this same entry shape
   * and never this field, so recording a subcategory note has NO effect
   * on live centroid training, per Elling's own explicit "keep them the
   * same for centroid for the moment." Undefined when the user didn't
   * type anything for this assignment -- stored as SQL NULL, not an
   * empty string, so "no note" and "" are never conflated. */
  subcategoryNote?: string
}

/** Column-scoped counterpart to upsertStemCategoryBus -- only ever touches
 * ArrangeRole/DrumSubRole/SubcategoryNote/Source/SourceProject/UpdatedAt,
 * never BusId. */
export function upsertStemCategoryRole(
  db: Database.Database,
  entries: StemRoleCategoryEntry[],
  source: string,
  sourceProject: string | null,
  updatedAt: number,
  extraCandidateDbs: Database.Database[] = []
): void {
  const stmt = db.prepare(
    `INSERT INTO StemCategories (StemCID, ArrangeRole, DrumSubRole, SubcategoryNote, Source, SourceProject, UpdatedAt)
     VALUES (@stemCID, @arrangeRole, @drumSubRole, @subcategoryNote, @source, @sourceProject, @updatedAt)
     ON CONFLICT(StemCID) DO UPDATE SET
       ArrangeRole = excluded.ArrangeRole,
       DrumSubRole = excluded.DrumSubRole,
       SubcategoryNote = excluded.SubcategoryNote,
       Source = excluded.Source,
       SourceProject = excluded.SourceProject,
       UpdatedAt = excluded.UpdatedAt
     WHERE excluded.UpdatedAt >= StemCategories.UpdatedAt`
  )
  const txn = db.transaction((rows: StemRoleCategoryEntry[]) => {
    for (const row of rows) {
      const stemCID = stemCIDForPath(db, row.path, extraCandidateDbs)
      if (!stemCID) continue
      stmt.run({
        stemCID,
        arrangeRole: row.arrangeRole,
        drumSubRole: row.drumSubRole ?? null,
        subcategoryNote: row.subcategoryNote ?? null,
        source,
        sourceProject,
        updatedAt
      })
    }
  })
  txn(entries)
  // Discover's precomputed per-kind stem lists read ArrangeRole.
  bumpStemClassificationVersion(db)
  // A confirmation changes the classifier's training and eligibility --
  // its pending lists rebuild on the next batch (background efficiency B4).
  noteAutoClassifyTrainingChanged()
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
