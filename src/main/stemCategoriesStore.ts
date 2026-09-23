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
  /** NO subcategoryNote. The column stays in riffLibrarySchema.ts and keeps
   * its rows -- dropping a SQLite column means rebuilding a table that also
   * holds the user's real library, for no gain, and anything already typed
   * into it would be destroyed. It simply stops gaining new ones: NOTHING
   * EVER READ IT (grepped across src/: the column, its migration and this
   * INSERT, and not one SELECT), its own tooltip said it did not affect
   * classifier training, and it occupied the busiest control row of the
   * busiest modal in the app -- on a surface whose whole value is that the
   * question can be answered in one click, a text box is the one control
   * that cannot. If a real consumer ever appears, the write path is four
   * lines. */
}

/** Column-scoped counterpart to upsertStemCategoryBus -- only ever touches
 * ArrangeRole/DrumSubRole/Source/SourceProject/UpdatedAt, never BusId and
 * never SubcategoryNote (see StemRoleCategoryEntry: the column survives
 * with its rows, so re-confirming a role must leave an existing note
 * exactly where it was rather than nulling it out on the way past). */
export function upsertStemCategoryRole(
  db: Database.Database,
  entries: StemRoleCategoryEntry[],
  source: string,
  sourceProject: string | null,
  updatedAt: number,
  extraCandidateDbs: Database.Database[] = []
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
      const stemCID = stemCIDForPath(db, row.path, extraCandidateDbs)
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

/** One path's confirmed role, as the renderer needs it. */
export interface StemRoleLookup {
  arrangeRole: ArrangeRole
  drumSubRole: DrumSubRole | null
}

// One IN-list query per chunk, matching the chunked lookups elsewhere in
// main/. 500 is well inside SQLite's own default variable limit.
const ROLE_LOOKUP_CHUNK_SIZE = 500

/**
 * Every CONFIRMED role among these paths, keyed by the path that was asked
 * about rather than by StemCID -- the renderer holds paths (map rows, flat
 * stems) and has no idea what a StemCID is.
 *
 * A path with no `Stems` row (a locally-dropped file, a one-shot, an in-app
 * recording) is simply absent from the result, as is a stem confirmed only
 * on the BUS axis. Absent means "nobody has said what this is", which is
 * exactly what the map's label chain needs to fall through on -- never an
 * empty string and never a guess.
 *
 * Read-only and synchronous: at the sizes this is called with (one
 * arrangement's stems, or one Tidy Up page) a chunked IN-list is cheap, and
 * it must not hold a statement open across an await -- see MEMORY.md's own
 * "never .iterate() across an await" rule.
 */
export function getStemCategoryRolesForPaths(
  db: Database.Database,
  paths: string[],
  extraCandidateDbs: Database.Database[] = []
): Record<string, StemRoleLookup> {
  const out: Record<string, StemRoleLookup> = {}
  const pathsByStemCID = new Map<string, string[]>()
  for (const path of paths) {
    const stemCID = stemCIDForPath(db, path, extraCandidateDbs)
    if (!stemCID) continue
    const existing = pathsByStemCID.get(stemCID)
    if (existing) existing.push(path)
    else pathsByStemCID.set(stemCID, [path])
  }
  const stemCIDs = [...pathsByStemCID.keys()]
  for (let start = 0; start < stemCIDs.length; start += ROLE_LOOKUP_CHUNK_SIZE) {
    const chunk = stemCIDs.slice(start, start + ROLE_LOOKUP_CHUNK_SIZE)
    countWork('sql:stem-category-roles')
    const placeholders = chunk.map(() => '?').join(',')
    const rows = db
      .prepare(
        `SELECT StemCID, ArrangeRole, DrumSubRole FROM StemCategories
         WHERE ArrangeRole IS NOT NULL AND StemCID IN (${placeholders})`
      )
      .all(...chunk) as { StemCID: string; ArrangeRole: string; DrumSubRole: string | null }[]
    for (const row of rows) {
      for (const path of pathsByStemCID.get(row.StemCID) ?? []) {
        out[path] = {
          arrangeRole: row.ArrangeRole as ArrangeRole,
          drumSubRole: row.DrumSubRole as DrumSubRole | null
        }
      }
    }
  }
  return out
}
