// src/main/categoryCentroidStore.ts
import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'fs'
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

/** Where the store lives: the key of its trained record in the own db. The
 * dev and the packaged app each have their own (userData) over one own db. */
export function categoryCentroidStorePath(): string {
  return storePath()
}

/** What is on disk: no file yet, a file that won't load (unreadable or not
 * a store), or the store it holds and its generation. Training reads this
 * rather than loadCategoryCentroidStore, so that it never mistakes a file
 * that won't load for an empty store and saves over it (review of b4d9924a,
 * important 1).
 *
 * The generation names one store file's lineage: a random id given to a new
 * file (or to one from before generations, null here) and kept by every save
 * of it. The own db records which generation its trained record describes
 * (categoryCentroidTraining.ts), so a file replaced, lost or recreated is
 * told apart from the one the record was built for. */
export type CategoryCentroidStoreFile =
  | { kind: 'missing' }
  | { kind: 'unreadable'; error: string }
  | { kind: 'ok'; store: CategoryCentroidStore; generation: string | null }

/** A pre-existing file from before arrangeRoles/drumSubRoles existed (shaped
 * {buses, global} only) loads correctly, with both new axes defaulted to {}
 * rather than causing a mismatched-shape bug -- real existing users'
 * already-trained bus data stays intact. */
export function readCategoryCentroidStoreFile(): CategoryCentroidStoreFile {
  const path = storePath()
  if (!existsSync(path)) return { kind: 'missing' }
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'))
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('not a JSON object')
    }
    const fields = parsed as Partial<CategoryCentroidStore> & { generation?: unknown }
    const empty = emptyCategoryCentroidStore()
    return {
      kind: 'ok',
      generation: typeof fields.generation === 'string' ? fields.generation : null,
      store: {
        buses: fields.buses ?? empty.buses,
        arrangeRoles: fields.arrangeRoles ?? empty.arrangeRoles,
        drumSubRoles: fields.drumSubRoles ?? empty.drumSubRoles,
        global: fields.global ?? empty.global
      }
    }
  } catch (err) {
    return { kind: 'unreadable', error: err instanceof Error ? err.message : String(err) }
  }
}

/** For the readers (the classifier, the renderer): mirrors pluginCatalog.ts's
 * own loadCatalog -- an empty store (never a thrown error) both when nothing
 * has ever been confirmed yet and when reading one fails. Training never
 * uses this: see readCategoryCentroidStoreFile. Deliberately GLOBAL (not
 * per-project), same reasoning as the original busCentroidStore.ts: the
 * whole point of a classifier here is to generalize across every sketch the
 * user tidies/arranges, not start over cold on each new one. */
export function loadCategoryCentroidStore(): CategoryCentroidStore {
  const file = readCategoryCentroidStoreFile()
  if (file.kind === 'ok') return file.store
  if (file.kind === 'unreadable') {
    console.error(`loadCategoryCentroidStore: failed to read ${storePath()}: ${file.error}`)
  }
  return emptyCategoryCentroidStore()
}

/** Written to a temp file beside it, then renamed over it: a crash or a full
 * disk mid-write leaves the previous store whole, never a truncated file
 * (which would load as an empty store and lose every sample trained so
 * far). The temp file is fsynced before the rename: without that, a power
 * loss can put the rename on disk before the data, leaving the renamed file
 * empty. The rename is atomic within the userData folder. Synchronous, so
 * two saves in this process never share the temp file. `generation` is
 * written beside the store (null only keeps a file from before generations
 * as it was). True once saved. */
export function saveCategoryCentroidStore(
  store: CategoryCentroidStore,
  generation: string | null
): boolean {
  const path = storePath()
  const tmpPath = `${path}.tmp`
  try {
    const fd = openSync(tmpPath, 'w')
    try {
      const contents = generation === null ? store : { generation, ...store }
      writeFileSync(fd, JSON.stringify(contents, null, 2), 'utf-8') // loops until all written
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    renameSync(tmpPath, path)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`saveCategoryCentroidStore: failed to write ${path}: ${message}`)
    try {
      rmSync(tmpPath, { force: true })
    } catch {
      // Best effort: a stray temp file is never read.
    }
    return false
  }
  // Retrained centroids can place stems the classifier couldn't before --
  // its pending lists rebuild on the next batch (background efficiency B4).
  noteAutoClassifyTrainingChanged()
  return true
}
