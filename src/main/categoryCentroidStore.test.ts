import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
})
