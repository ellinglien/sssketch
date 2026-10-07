// src/main/stemAnalysisNeeds.ts
import { basename } from 'node:path'
import type Database from 'better-sqlite3'
import {
  stemFeatureVersionOf,
  stemLevelVersionOf,
  STEM_FEATURE_VERSION,
  type StemFeatures
} from '@shared/stemFeatures'
import { STEM_LEVEL_VERSION } from '@shared/stemLevel'
import type { StemAnalysisNeeds } from '@shared/stemAnalysisNeeds'
import { isLibraryStemName } from '@shared/stemPathKind'
import { countWork } from './workCounters'
import {
  getTraitValueTable,
  type StemRowVersions,
  type TraitValueTable
} from './traitQuantileCache'

const DEFAULT_CHUNK_SIZE = 500

/** Whether the YAMNet model shipped (yamnetModel.ts yamnetModelAvailable).
 * False: no stem needs the embedding or zero-shot step, since neither can
 * ever run -- otherwise every stem lacking an embedding (all of them, in a
 * build without the model: every release up to 1.4.0) stayed "needs work"
 * forever, and each scan pass decoded it again only to fail (share-readiness
 * audit B3). Absent: available. */
export interface YamnetAvailability {
  yamnetAvailable?: boolean
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

/** Rows in `table` for these StemCIDs -- one IN-list query per chunk. */
function presentStemCIDs(
  db: Database.Database,
  table: 'StemPeaksCache' | 'StemEmbeddingCache',
  stemCIDs: string[]
): Set<string> {
  countWork(`sql:stem-analysis-needs.${table}`)
  const placeholders = stemCIDs.map(() => '?').join(',')
  const rows = db
    .prepare(`SELECT StemCID FROM ${table} WHERE StemCID IN (${placeholders})`)
    .all(...stemCIDs) as { StemCID: string }[]
  return new Set(rows.map((r) => r.StemCID))
}

interface FeatureVersionSets {
  current: Set<string>
  needsLevel: Set<string>
}

/** THE rule for an existing feature row, wherever its versions were read from: current when
 * at STEM_FEATURE_VERSION, and then needing the level pass when that is older than
 * STEM_LEVEL_VERSION (spec 2026-10-05-radio-intensity-arc-design 7.3). A malformed row is
 * neither (it counts as missing). */
function featureRowState(versions: StemRowVersions | 'malformed'): {
  current: boolean
  needsLevel: boolean
} {
  if (versions === 'malformed') return { current: false, needsLevel: false }
  const current = versions.feature >= STEM_FEATURE_VERSION
  return { current, needsLevel: current && versions.level < STEM_LEVEL_VERSION }
}

/** A parsed FeaturesJSON's versions, or 'malformed' -- exactly what the value table stores. */
function parsedVersions(json: string): StemRowVersions | 'malformed' {
  try {
    const features = JSON.parse(json) as StemFeatures
    return { feature: stemFeatureVersionOf(features), level: stemLevelVersionOf(features) }
  } catch {
    return 'malformed' // unparseable, or a JSON null (a property read on it throws)
  }
}

/** The same rule as the JSON path below, read from the trait value table's version columns
 * (background scan audit 4(b)) -- no SQL, no parse. A malformed row counts as missing, as the
 * JSON path's `catch` does. */
function currentFeatureStemCIDsFromTable(
  table: TraitValueTable,
  stemCIDs: string[]
): FeatureVersionSets {
  countWork('stem-analysis-needs:value-table')
  const current = new Set<string>()
  const needsLevel = new Set<string>()
  for (const stemCID of stemCIDs) {
    const versions = table.versionsOf(stemCID)
    if (versions === undefined) continue
    const state = featureRowState(versions)
    if (state.current) current.add(stemCID)
    if (state.needsLevel) needsLevel.add(stemCID)
  }
  return { current, needsLevel }
}

/** StemCIDs whose feature row exists AND is at STEM_FEATURE_VERSION, and of those the ones whose
 * level pass is older than STEM_LEVEL_VERSION (or missing: spec 2026-10-05-radio-intensity-arc-
 * design 7.3) -- read in the same parse. The version lives inside FeaturesJSON (no json_extract
 * anywhere in this codebase), so it's parsed here in JS -- only for rows that exist, one chunk at
 * a time. An unparseable row counts as missing, matching getStemFeatureCache (which returns null
 * for it).
 *
 * While the trait value table accounts for every StemFeatureCache row (getTraitValueTable: one
 * COUNT on ownDb), its version columns give the same answer without the read or the parse
 * (audit 4(b)). */
function currentFeatureStemCIDs(db: Database.Database, stemCIDs: string[]): FeatureVersionSets {
  const table = getTraitValueTable(db)
  if (table) return currentFeatureStemCIDsFromTable(table, stemCIDs)
  countWork('sql:stem-analysis-needs.StemFeatureCache')
  const placeholders = stemCIDs.map(() => '?').join(',')
  const rows = db
    .prepare(
      `SELECT StemCID, FeaturesJSON FROM StemFeatureCache WHERE StemCID IN (${placeholders})`
    )
    .all(...stemCIDs) as { StemCID: string; FeaturesJSON: string }[]
  countWork('parse:stem-features', rows.length)
  const current = new Set<string>()
  const needsLevel = new Set<string>()
  for (const row of rows) {
    const state = featureRowState(parsedVersions(row.FeaturesJSON))
    if (state.current) current.add(row.StemCID)
    if (state.needsLevel) needsLevel.add(row.StemCID)
  }
  return { current, needsLevel }
}

/** Rows per keyset page / window in the whole-table passes below. */
const REWORK_PAGE_SIZE = 2000

/** Every StemCID whose feature row exists but still needs work -- malformed, older than
 * STEM_FEATURE_VERSION, or current without the level pass -- plus every stem whose zero-shot
 * step is pending (zeroShotPendingStemCIDs' rule, over the whole table): the analysed half of
 * the library scan's preselect (background scan audit 3). With a peaks, embedding and feature
 * row, a stem needs work exactly when it is in this set (for a library stem name), so the
 * scan never asks needs for, or touches the disk for, anything else that is analysed.
 *
 * Read from the trait value table while it accounts for every row (no SQL, no parse); else
 * one JSON pass over StemFeatureCache in keyset pages with a yield after each. The zero-shot
 * half reads StemEmbeddingCache in key windows of REWORK_PAGE_SIZE (bounded statements, a yield
 * between). Never `.iterate()`. */
export async function stemCIDsNeedingRework(
  db: Database.Database,
  options: YamnetAvailability = {}
): Promise<Set<string>> {
  const out = new Set<string>()
  const table = getTraitValueTable(db)
  if (table) {
    countWork('stem-analysis-needs:value-table')
    table.forEachVersions((stemCID, versions) => {
      const state = featureRowState(versions)
      if (!state.current || state.needsLevel) out.add(stemCID)
    })
  } else {
    let page: Database.Statement | null = null
    try {
      page = db.prepare(
        `SELECT StemCID, FeaturesJSON FROM StemFeatureCache WHERE StemCID > ? ORDER BY StemCID LIMIT ?`
      )
    } catch {
      // no table: nothing analysed
    }
    let after = ''
    while (page) {
      countWork('sql:stem-analysis-needs.rework-page')
      const rows = page.all(after, REWORK_PAGE_SIZE) as { StemCID: string; FeaturesJSON: string }[]
      countWork('parse:stem-features', rows.length)
      for (const row of rows) {
        const state = featureRowState(parsedVersions(row.FeaturesJSON))
        if (!state.current || state.needsLevel) out.add(row.StemCID)
      }
      if (rows.length < REWORK_PAGE_SIZE) break
      after = rows[rows.length - 1].StemCID
      await yieldToEventLoop()
    }
  }
  if (options.yamnetAvailable === false) return out
  for (const stemCID of await allZeroShotPendingStemCIDs(db)) out.add(stemCID)
  return out
}

/** zeroShotPendingStemCIDs' join over the whole of StemEmbeddingCache, in key windows: each
 * statement covers the next REWORK_PAGE_SIZE embedding rows (its upper key from one LIMIT 1
 * OFFSET probe on the primary key), so no one statement runs long. None when a table is
 * missing. */
async function allZeroShotPendingStemCIDs(db: Database.Database): Promise<string[]> {
  const out: string[] = []
  let bound: Database.Statement
  let windowed: Database.Statement
  let last: Database.Statement
  const pending = `JOIN Stems s ON s.StemCID = e.StemCID
     WHERE NOT EXISTS (SELECT 1 FROM StemYamnetZeroShotAttempted t WHERE t.StemCID = e.StemCID)
     AND NOT EXISTS (
       SELECT 1 FROM StemCategories c WHERE c.StemCID = e.StemCID AND c.ArrangeRole IS NOT NULL
     )
     AND NOT EXISTS (SELECT 1 FROM StemAutoCategory a WHERE a.StemCID = e.StemCID)`
  try {
    bound = db.prepare(
      `SELECT StemCID FROM StemEmbeddingCache WHERE StemCID > ? ORDER BY StemCID
       LIMIT 1 OFFSET ${REWORK_PAGE_SIZE - 1}`
    )
    windowed = db.prepare(
      `SELECT e.StemCID AS StemCID FROM StemEmbeddingCache e ${pending}
       AND e.StemCID > ? AND e.StemCID <= ?`
    )
    last = db.prepare(
      `SELECT e.StemCID AS StemCID FROM StemEmbeddingCache e ${pending} AND e.StemCID > ?`
    )
  } catch {
    return out
  }
  let after = ''
  for (;;) {
    countWork('sql:stem-analysis-needs.zeroShot-window')
    const upper = bound.get(after) as { StemCID: string } | undefined
    const rows = (upper ? windowed.all(after, upper.StemCID) : last.all(after)) as {
      StemCID: string
    }[]
    for (const row of rows) out.push(row.StemCID)
    if (!upper) return out
    after = upper.StemCID
    await yieldToEventLoop()
  }
}

/** StemCIDs (of these) that still need the YAMNet zero-shot step
 * (background efficiency B5): an embedding row exists, no attempt is
 * recorded, the stem has its own Stems row here, and it isn't confirmed or
 * auto-categorized by anything -- exactly the eligibility the old
 * per-session retroactive scan (listYamnetZeroShotRetroactiveTargets)
 * enumerated, now asked only for the paths being checked. A db missing one
 * of these tables answers "none". */
function zeroShotPendingStemCIDs(db: Database.Database, stemCIDs: string[]): Set<string> {
  countWork('sql:stem-analysis-needs.zeroShot')
  const placeholders = stemCIDs.map(() => '?').join(',')
  try {
    const rows = db
      .prepare(
        `SELECT e.StemCID AS StemCID FROM StemEmbeddingCache e
         JOIN Stems s ON s.StemCID = e.StemCID
         WHERE e.StemCID IN (${placeholders})
         AND NOT EXISTS (SELECT 1 FROM StemYamnetZeroShotAttempted t WHERE t.StemCID = e.StemCID)
         AND NOT EXISTS (
           SELECT 1 FROM StemCategories c WHERE c.StemCID = e.StemCID AND c.ArrangeRole IS NOT NULL
         )
         AND NOT EXISTS (SELECT 1 FROM StemAutoCategory a WHERE a.StemCID = e.StemCID)`
      )
      .all(...stemCIDs) as { StemCID: string }[]
    return new Set(rows.map((r) => r.StemCID))
  } catch {
    return new Set()
  }
}

/**
 * Which persisted analyses each path still needs (background-efficiency
 * spec, A3) -- lets the ambient scans skip already-analysed stems without
 * a per-stem "do you have it?" round trip. Result is index-aligned with
 * `paths`. StemCID = the path's basename (the content-addressed library
 * layout, see stemCIDForPath); a path with no cache rows simply needs
 * everything, exactly what the per-module getters would conclude -- except
 * that a path whose basename is not a library stem name (isLibraryStemName:
 * it contains `.`) never needs the embedding or zero-shot (YAMNet) step, nor
 * does any path when the model is missing (`options.yamnetAvailable`). Batched: one query per cache
 * table per chunk of `chunkSize` paths (via `.all()`, never `.iterate()`
 * across the yields), yielding to the event loop between chunks.
 */
export async function getStemAnalysisNeeds(
  db: Database.Database,
  paths: string[],
  chunkSize = DEFAULT_CHUNK_SIZE,
  options: YamnetAvailability = {}
): Promise<StemAnalysisNeeds[]> {
  const yamnet = options.yamnetAvailable !== false
  const out: StemAnalysisNeeds[] = []
  for (let start = 0; start < paths.length; start += chunkSize) {
    if (start > 0) await yieldToEventLoop()
    const chunkPaths = paths.slice(start, start + chunkSize)
    const stemCIDs = [...new Set(chunkPaths.map((p) => basename(p)))]
    const peaks = presentStemCIDs(db, 'StemPeaksCache', stemCIDs)
    const embeddings = presentStemCIDs(db, 'StemEmbeddingCache', stemCIDs)
    const features = currentFeatureStemCIDs(db, stemCIDs)
    const zeroShot = zeroShotPendingStemCIDs(db, stemCIDs)
    for (const path of chunkPaths) {
      const stemCID = basename(path)
      // Not a library stem name (a drag-imported, baked or loop-folder file):
      // its YAMNet result could never be stored, so it never needs one (audit
      // 6). Peaks and features stay needed -- they are used in-session.
      const library = isLibraryStemName(stemCID) && yamnet
      out.push({
        peaks: !peaks.has(stemCID),
        features: !features.current.has(stemCID),
        embedding: library && !embeddings.has(stemCID),
        zeroShot: library && zeroShot.has(stemCID),
        // only when it is needed: an answer without it reads as no level work
        ...(features.needsLevel.has(stemCID) && { level: true })
      })
    }
  }
  return out
}
