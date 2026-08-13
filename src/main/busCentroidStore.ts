// src/main/busCentroidStore.ts
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type { BusCentroidStore } from '@shared/busCentroids'
import { emptyBusCentroidStore } from '@shared/busCentroids'

const STORE_FILENAME = 'busCentroids.json'

function storePath(): string {
  return join(app.getPath('userData'), STORE_FILENAME)
}

/** Mirrors pluginCatalog.ts's own loadCatalog exactly -- an empty store
 * (never a thrown error) both when nothing has ever been confirmed yet and
 * when reading one fails. Deliberately GLOBAL (not per-project, unlike most
 * of this app's persisted state) -- the whole point of a classifier here is
 * to generalize across every sketch the user tidies, not start over cold on
 * each new one (see busCentroids.ts's own doc comment for the shared-stats
 * reasoning this depends on). */
export function loadBusCentroidStore(): BusCentroidStore {
  const path = storePath()
  if (!existsSync(path)) return emptyBusCentroidStore()
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as BusCentroidStore
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`loadBusCentroidStore: failed to read ${path}: ${message}`)
    return emptyBusCentroidStore()
  }
}

export function saveBusCentroidStore(store: BusCentroidStore): void {
  try {
    writeFileSync(storePath(), JSON.stringify(store, null, 2), 'utf-8')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`saveBusCentroidStore: failed to write ${storePath()}: ${message}`)
  }
}
