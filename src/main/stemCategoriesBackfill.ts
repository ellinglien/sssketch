// src/main/stemCategoriesBackfill.ts
import { readFileSync } from 'node:fs'
import type Database from 'better-sqlite3'
import { listLibrarySketches, sketchProjectPath } from './projectLibrary'
import { upsertStemCategoryBus, type StemBusCategoryEntry } from './stemCategoriesStore'
import { candidateDbsForRiff } from './riffLibraryStore'
import { trainCentroidsFromBusEntries } from './categoryCentroidTraining'
import type { BusId } from '@shared/types'

export interface BackfillSummary {
  scannedProjects: number
  categorizedStems: number
  /** Names of sketches whose .sssketchproj failed to parse as JSON --
   * reported, not thrown, so one corrupt project file doesn't abort the
   * whole backfill for every other sketch in the library. */
  skippedProjects: string[]
}

interface ParsedSketchStem {
  slot: number
  path: string
}

interface ParsedSketchRifff {
  groupId: string
  stems: ParsedSketchStem[]
}

interface ParsedSketch {
  busOf?: Record<string, string>
  rifffs?: Record<string, ParsedSketchRifff>
}

/** One-time-in-spirit, safe-to-call-on-every-startup migration recovering
 * Tidy Up's busOf assignments that are otherwise trapped inside whichever
 * .sssketchproj file happened to be open when they were made -- see the
 * design spec's §3 and Background. Only busOf is backfillable; ArrangeRole/
 * DrumSubRole corrections were never saved to any project file (confirmed
 * in the design spec's own Background), so there is nothing to recover for
 * them here.
 *
 * Idempotent via upsertStemCategoryBus's own conditional ON CONFLICT (see
 * stemCategoriesStore.ts) -- re-running this after some real forward-capture
 * writes have already happened can never regress a newer write with older
 * project-file data, and re-running it with nothing changed is a safe
 * no-op, matching riffFavouritesMigration.ts's own "safe to call on every
 * app startup" convention. Scoped to the project LIBRARY folder only
 * (listLibrarySketches) -- a sketch opened from an arbitrary external
 * Finder location is out of scope, matching the design spec's own "under
 * the project library folder" wording. */
export function backfillStemCategoriesFromProjectLibrary(db: Database.Database): BackfillSummary {
  const sketches = listLibrarySketches()
  let categorizedStems = 0
  const skippedProjects: string[] = []

  for (const sketch of sketches) {
    const projectPath = sketchProjectPath(sketch.name)
    let parsed: ParsedSketch
    try {
      parsed = JSON.parse(readFileSync(projectPath, 'utf-8')) as ParsedSketch
    } catch {
      skippedProjects.push(sketch.name)
      continue
    }

    const busOf = parsed.busOf ?? {}
    const rifffs = parsed.rifffs ?? {}
    const pathByStemKey = new Map<string, string>()
    for (const rifff of Object.values(rifffs)) {
      for (const stem of rifff.stems) {
        pathByStemKey.set(`${rifff.groupId}:${stem.slot}`, stem.path)
      }
    }

    const entries: StemBusCategoryEntry[] = []
    for (const [stemKeyValue, busId] of Object.entries(busOf)) {
      const path = pathByStemKey.get(stemKeyValue)
      if (path) entries.push({ path, busId: busId as BusId })
    }

    if (entries.length > 0) {
      // Deliberately NOT Math.floor()'d to whole seconds: unrounded
      // fractional-seconds-since-epoch is this whole subsystem's house
      // style for StemCategories.UpdatedAt (the live forward-capture IPC
      // handlers use the same `Date.now() / 1000`, unrounded), so there's
      // no scale mismatch to guard against here. Staying fractional also
      // preserves real sub-second ordering between two project files
      // modified within the same wall-clock second -- flooring would make
      // upsertStemCategoryBus's own "most recent wins" guard silently fall
      // back to iteration order instead, which is exactly what this
      // migration must not depend on (see this function's own doc
      // comment).
      const extraCandidateDbs = candidateDbsForRiff()
      upsertStemCategoryBus(
        db,
        entries,
        'backfill',
        projectPath,
        sketch.mtimeMs / 1000,
        extraCandidateDbs
      )
      trainCentroidsFromBusEntries(db, entries, extraCandidateDbs)
      categorizedStems += entries.length
    }
  }

  return { scannedProjects: sketches.length, categorizedStems, skippedProjects }
}
