import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { emptyCategoryCentroidStore, recordConfirmedCategory } from '@shared/categoryCentroids'

let userDataDir: string

vi.mock('electron', () => ({
  app: {
    getPath: () => userDataDir
  }
}))

describe('categoryCentroidStore', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'sssketch-category-centroid-test-'))
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('loadCategoryCentroidStore returns an empty store when no file exists yet', async () => {
    const { loadCategoryCentroidStore } = await import('./categoryCentroidStore')
    expect(loadCategoryCentroidStore()).toEqual(emptyCategoryCentroidStore())
  })

  it('saveCategoryCentroidStore then loadCategoryCentroidStore round-trips', async () => {
    const { loadCategoryCentroidStore, saveCategoryCentroidStore } = await import(
      './categoryCentroidStore'
    )
    let store = emptyCategoryCentroidStore()
    store = recordConfirmedCategory(store, 'bus', 'drums', new Array(19).fill(1))
    store = recordConfirmedCategory(store, 'arrangeRole', 'vocal', new Array(19).fill(2))
    store = recordConfirmedCategory(store, 'drumSubRole', 'kick', new Array(19).fill(3))
    saveCategoryCentroidStore(store)
    expect(loadCategoryCentroidStore()).toEqual(store)
  })

  it('loadCategoryCentroidStore returns an empty store rather than throwing on a corrupt file', async () => {
    writeFileSync(join(userDataDir, 'busCentroids.json'), 'not valid json{{{')
    const { loadCategoryCentroidStore } = await import('./categoryCentroidStore')
    expect(loadCategoryCentroidStore()).toEqual(emptyCategoryCentroidStore())
  })

  it('loads a pre-existing bus-only file (from before arrangeRoles/drumSubRoles existed) with those two axes defaulted to empty', async () => {
    const legacyShape = {
      buses: { drums: { mean: new Array(19).fill(1), count: 3 } },
      global: { mean: new Array(19).fill(1), m2: new Array(19).fill(0), count: 3 }
    }
    writeFileSync(join(userDataDir, 'busCentroids.json'), JSON.stringify(legacyShape))
    const { loadCategoryCentroidStore } = await import('./categoryCentroidStore')
    const loaded = loadCategoryCentroidStore()
    expect(loaded.buses).toEqual(legacyShape.buses)
    expect(loaded.arrangeRoles).toEqual({})
    expect(loaded.drumSubRoles).toEqual({})
    expect(loaded.global).toEqual(legacyShape.global)
  })

  // Review of plan b21ea5a2 Task 13: the store was written in place, so a
  // crash or a full disk mid-write left a truncated file, which loads as an
  // empty store (every bus trained so far lost). Now: a temp file, renamed.
  it('a save that fails part-way leaves the previous file intact', async () => {
    const { loadCategoryCentroidStore, saveCategoryCentroidStore } =
      await import('./categoryCentroidStore')
    const before = recordConfirmedCategory(
      emptyCategoryCentroidStore(),
      'bus',
      'drums',
      new Array(19).fill(1)
    )
    saveCategoryCentroidStore(before)
    expect(readdirSync(userDataDir)).toEqual(['busCentroids.json'])

    // The temp file cannot be written: a directory stands in its place.
    mkdirSync(join(userDataDir, 'busCentroids.json.tmp'))
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    saveCategoryCentroidStore(recordConfirmedCategory(before, 'bus', 'bass', new Array(19).fill(2)))
    expect(errors).toHaveBeenCalled()
    errors.mockRestore()
    expect(loadCategoryCentroidStore()).toEqual(before)
  })
})
