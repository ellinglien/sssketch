// src/main/instrumentMaskCategoryBackfill.ts
import type Database from 'better-sqlite3'
import { upsertStemCategoryRole, type StemRoleCategoryEntry } from './stemCategoriesStore'
import { resolveStemPath, candidateDbsForRiff } from './riffLibraryStore'

export interface InstrumentMaskBackfillSummary {
  categorizedStems: number
}

const DRUMS_BIT = 1 << 1
const BASS_BIT = 1 << 3

interface EligibleStemRow {
  StemCID: string
  OwnerJamCID: string
  Instrument: number
}

/** Backfills Endlesss's own performer-set Instrument bitmask into
 * StemCategories for the two categories that bit reliably, unambiguously
 * identifies -- drums and bass -- as a new, distinct Source ('instrumentMask')
 * so it stays inspectable/reversible and never gets confused with a real
 * human Tidy Up confirmation. Deliberately requires a CLEAN, single-bit
 * mask (exactly the drums bit or exactly the bass bit, nothing else set) --
 * a stem with multiple bits, or with the notes/audioIn bits this backfill
 * doesn't cover, is left alone rather than guessed at.
 *
 * Idempotent and safe to call on every app startup, same convention as
 * backfillStemCategoriesFromProjectLibrary (stemCategoriesBackfill.ts) --
 * upsertStemCategoryRole's own ON CONFLICT guard (never regress a newer
 * existing row) means a stem already covered by ANY source (a real human
 * confirmation, or this same backfill from a previous run) is left
 * untouched; this function's own SQL also excludes anything already in
 * StemCategories up front, so re-running costs one cheap SELECT once the
 * backlog is fully covered. */
export function backfillInstrumentMaskCategories(
  db: Database.Database
): InstrumentMaskBackfillSummary {
  const rows = db
    .prepare(
      `SELECT StemCID, OwnerJamCID, Instrument FROM Stems
       WHERE (Instrument = ? OR Instrument = ?)
       AND NOT EXISTS (SELECT 1 FROM StemCategories c WHERE c.StemCID = Stems.StemCID)`
    )
    .all(DRUMS_BIT, BASS_BIT) as EligibleStemRow[]

  if (rows.length === 0) return { categorizedStems: 0 }

  const entries: StemRoleCategoryEntry[] = rows.map((row) => ({
    path: resolveStemPath(row.OwnerJamCID, row.StemCID),
    arrangeRole: row.Instrument === DRUMS_BIT ? 'drums' : 'bass'
  }))

  const extraCandidateDbs = candidateDbsForRiff()
  const updatedAt = Date.now() / 1000
  upsertStemCategoryRole(db, entries, 'instrumentMask', null, updatedAt, extraCandidateDbs)

  return { categorizedStems: entries.length }
}
