// src/main/categoryCentroidStore.ts
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type { CategoryCentroidStore } from '@shared/categoryCentroids'
import { emptyCategoryCentroidStore } from '@shared/categoryCentroids'
import { noteAutoClassifyTrainingChanged } from './stemAutoClassifyWake'

// Filename intentionally UNCHANGED from busCentroidStore.ts's own -- real
// users already have this file on disk, shaped {buses, global}. Renaming
// it would orphan their already-trained bus data on next launch for no
// benefit; only the TypeScript module/function names changed, not the
// persisted artifact's own name.
const STORE_FILENAME = 'busCentroids.json'

function storePath(): string {
  return join(app.getPath('userData'), STORE_FILENAME)
}

/** Mirrors pluginCatalog.ts's own loadCatalog exactly -- an empty store
 * (never a thrown error) both when nothing has ever been confirmed yet and
 * when reading one fails. A pre-existing file from before arrangeRoles/
 * drumSubRoles existed (shaped {buses, global} only) loads correctly, with
 * both new axes defaulted to {} rather than causing a mismatched-shape
 * bug -- real existing users' already-trained bus data stays intact.
 * Deliberately GLOBAL (not per-project), same reasoning as the original
 * busCentroidStore.ts: the whole point of a classifier here is to
 * generalize across every sketch the user tidies/arranges, not start over
 * cold on each new one. */
export function loadCategoryCentroidStore(): CategoryCentroidStore {
  const path = storePath()
  if (!existsSync(path)) return emptyCategoryCentroidStore()
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<CategoryCentroidStore>
    const empty = emptyCategoryCentroidStore()
    return {
      buses: parsed.buses ?? empty.buses,
      arrangeRoles: parsed.arrangeRoles ?? empty.arrangeRoles,
      drumSubRoles: parsed.drumSubRoles ?? empty.drumSubRoles,
      global: parsed.global ?? empty.global
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`loadCategoryCentroidStore: failed to read ${path}: ${message}`)
    return emptyCategoryCentroidStore()
  }
}

export function saveCategoryCentroidStore(store: CategoryCentroidStore): void {
  try {
    writeFileSync(storePath(), JSON.stringify(store, null, 2), 'utf-8')
    // Retrained centroids can place stems the classifier couldn't before --
    // its pending lists rebuild on the next batch (background efficiency B4).
    noteAutoClassifyTrainingChanged()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`saveCategoryCentroidStore: failed to write ${storePath()}: ${message}`)
  }
}
