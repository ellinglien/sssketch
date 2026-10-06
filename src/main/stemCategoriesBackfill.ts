// src/main/stemCategoriesBackfill.ts
import { readFileSync, statSync } from 'node:fs'
import { basename } from 'node:path'
import type Database from 'better-sqlite3'
import { listLibrarySketches, sketchProjectPath } from './projectLibrary'
import type { StemBusCategoryEntry } from './stemCategoriesStore'
import { candidateDbsForRiff } from './riffLibraryStore'
import { recordStemCategoryBus } from './categoryCentroidTraining'
import type { BusId } from '@shared/types'
import { fileStamp, recordSeen, seenStamps } from './startupBackfillGate'

export interface BackfillSummary {
  scannedProjects: number
  /** Projects unchanged (same size and mtime) since a previous run backfilled
   * them: not parsed again. */
  unchangedProjects: number
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
 * the project library folder" wording.
 *
 * Gated per file (background scan audit "Minor", startupBackfillGate.ts): a
 * project whose `size:mtimeMs` matches the stamp recorded when it was last
 * backfilled completely is not read or parsed again -- it holds nothing new,
 * and its upserts would change nothing (they only ever replace an older
 * UpdatedAt). "Completely": every assignment whose stem is a library stem
 * (a basename without '.': plan decision 10) resolved to a Stems row, and
 * every trainable one the row agrees with is in the centroids. Until then
 * the file is parsed every launch as before, so a stem whose jam syncs
 * later, whose archive was unmounted, or which is analysed later still
 * lands and still trains. A file that fails to parse records no stamp
 * either (tried, and reported, again next launch). Parsing a file again
 * never trains a stem twice: each (stem, bus) pair is trained once, ever
 * (recordStemCategoryBus), here or in the live Tidy Up handler.
 * `readFile` is injectable for tests. */
export function backfillStemCategoriesFromProjectLibrary(
  db: Database.Database,
  options: { readFile?: (path: string) => string } = {}
): BackfillSummary {
  const readFile = options.readFile ?? ((path: string) => readFileSync(path, 'utf-8'))
  const sketches = listLibrarySketches()
  const seen = seenStamps(db)
  let categorizedStems = 0
  let unchangedProjects = 0
  const skippedProjects: string[] = []

  for (const sketch of sketches) {
    const projectPath = sketchProjectPath(sketch.name)
    // Stamped before the read: a write landing in between leaves an older
    // stamp, so the file is simply parsed again next launch.
    let stamp: string | null
    try {
      stamp = fileStamp(statSync(projectPath))
    } catch {
      stamp = null
    }
    if (stamp !== null && seen.get(projectPath) === stamp) {
      unchangedProjects += 1
      continue
    }
    let parsed: ParsedSketch
    try {
      parsed = JSON.parse(readFile(projectPath)) as ParsedSketch
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

    let unresolved: StemBusCategoryEntry[] = []
    let waiting: StemBusCategoryEntry[] = []
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
      // comment). Each (stem, bus) trains once (recordStemCategoryBus).
      ;({ unresolved, waiting } = recordStemCategoryBus(
        db,
        entries,
        'backfill',
        projectPath,
        sketch.mtimeMs / 1000,
        candidateDbsForRiff()
      ))
      categorizedStems += entries.length
    }
    // Complete once every library stem (a basename without '.': plan
    // decision 10) resolved to a Stems row, and every trainable assignment
    // the rows agree with is trained -- worked out by the training itself,
    // so no FeaturesJSON is read twice. A dropped file never resolves and
    // an aux assignment never trains: neither is waited for.
    const complete =
      waiting.length === 0 && unresolved.every((entry) => basename(entry.path).includes('.'))
    if (stamp !== null && complete) recordSeen(db, projectPath, stamp)
  }

  return { scannedProjects: sketches.length, unchangedProjects, categorizedStems, skippedProjects }
}
