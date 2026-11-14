// Test-only reads of StemCategories / StemAutoCategory rows (no production caller).
import type Database from 'better-sqlite3'
import type { ArrangeRole, DrumSubRole } from '@shared/stemRole'
import type { BusId } from '@shared/types'

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

export function getAutoCategorizedStemCIDs(
  ownDb: Database.Database,
  arrangeRole: ArrangeRole
): Set<string> {
  const rows = ownDb
    .prepare(`SELECT StemCID FROM StemAutoCategory WHERE ArrangeRole = ?`)
    .all(arrangeRole) as { StemCID: string }[]
  return new Set(rows.map((r) => r.StemCID))
}
