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

/** Where the store lives (for messages). */
export function categoryCentroidStorePath(): string {
  return storePath()
}

/** One (stem, bus) pair whose features are in the store's bus axis. */
export interface TrainedBusPair {
  stemCID: string
  busId: string
}

/** What is on disk: no file yet, a file that won't load (unreadable, not a
 * store, or a malformed trainedPairs), or the store it holds and the
 * (stem, bus) pairs trained into it. Training reads this rather than
 * loadCategoryCentroidStore, so that it never mistakes a file that won't
 * load for an empty store and saves over it (review of b4d9924a, important
 * 1). trainedPairs is null for a file saved before the pairs were kept in it
 * (categoryCentroidTraining.ts seeds those once).
 *
 * The pairs live in the file itself, written in the same atomic save as the
 * samples, so the two can never disagree: the dev and the packaged app each
 * have their own file (userData), a deleted or new library db changes
 * nothing about what a file holds, and a backup restored brings its own
 * pairs with it. */
export type CategoryCentroidStoreFile =
  | { kind: 'missing' }
  | { kind: 'unreadable'; error: string }
  | { kind: 'ok'; store: CategoryCentroidStore; trainedPairs: TrainedBusPair[] | null }

function isTrainedBusPair(value: unknown): value is TrainedBusPair {
  if (typeof value !== 'object' || value === null) return false
  const pair = value as Record<string, unknown>
  return typeof pair.stemCID === 'string' && typeof pair.busId === 'string'
}

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
    const fields = parsed as Partial<CategoryCentroidStore> & { trainedPairs?: unknown }
    let trainedPairs: TrainedBusPair[] | null = null
    if (fields.trainedPairs !== undefined) {
      if (!Array.isArray(fields.trainedPairs) || !fields.trainedPairs.every(isTrainedBusPair)) {
        throw new Error('trainedPairs is not a list of { stemCID, busId }')
      }
      trainedPairs = fields.trainedPairs.map(({ stemCID, busId }) => ({ stemCID, busId }))
    }
    const empty = emptyCategoryCentroidStore()
    return {
      kind: 'ok',
      trainedPairs,
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
 * two saves in this process never share the temp file. `trainedPairs` (the
 * (stem, bus) pairs in the bus axis) goes into the same file, so the
 * samples and the record of them land in one rename, or neither does.
 * Readers never see it. True once saved. */
export function saveCategoryCentroidStore(
  store: CategoryCentroidStore,
  trainedPairs: readonly TrainedBusPair[]
): boolean {
  const path = storePath()
  const tmpPath = `${path}.tmp`
  try {
    const fd = openSync(tmpPath, 'w')
    try {
      const contents = { ...store, trainedPairs }
      writeFileSync(fd, JSON.stringify(contents), 'utf-8') // compact; loops until all written
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
