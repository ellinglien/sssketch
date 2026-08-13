import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { emptyBusCentroidStore, recordConfirmedStem } from '@shared/busCentroids'

let userDataDir: string

vi.mock('electron', () => ({
  app: {
    getPath: () => userDataDir
  }
}))

describe('busCentroidStore', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'sssketch-bus-centroid-test-'))
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('loadBusCentroidStore returns an empty store when no file exists yet', async () => {
    const { loadBusCentroidStore } = await import('./busCentroidStore')
    expect(loadBusCentroidStore()).toEqual(emptyBusCentroidStore())
  })

  it('saveBusCentroidStore then loadBusCentroidStore round-trips', async () => {
    const { loadBusCentroidStore, saveBusCentroidStore } = await import('./busCentroidStore')
    let store = emptyBusCentroidStore()
    store = recordConfirmedStem(store, 'drums', new Array(19).fill(1))
    store = recordConfirmedStem(store, 'bass', new Array(19).fill(2))
    saveBusCentroidStore(store)
    expect(loadBusCentroidStore()).toEqual(store)
  })

  it('loadBusCentroidStore returns an empty store rather than throwing on a corrupt file', async () => {
    const { writeFileSync } = await import('node:fs')
    writeFileSync(join(userDataDir, 'busCentroids.json'), 'not valid json{{{')
    const { loadBusCentroidStore } = await import('./busCentroidStore')
    expect(loadBusCentroidStore()).toEqual(emptyBusCentroidStore())
  })
})
