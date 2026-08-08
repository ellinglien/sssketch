import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let userDataDir: string

vi.mock('electron', () => ({
  app: {
    getPath: () => userDataDir
  }
}))

describe('riffFavourites', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'sssketch-favourites-test-'))
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('listFavouriteRiffCIDs returns an empty list when no file exists yet', async () => {
    const { listFavouriteRiffCIDs } = await import('./riffFavourites')
    expect(listFavouriteRiffCIDs()).toEqual([])
  })

  it('toggleFavouriteRiff adds a riffCID not already favourited, removes one that is', async () => {
    const { toggleFavouriteRiff, listFavouriteRiffCIDs } = await import('./riffFavourites')
    expect(toggleFavouriteRiff('riff_1')).toEqual(['riff_1'])
    expect(listFavouriteRiffCIDs()).toEqual(['riff_1'])
    expect(toggleFavouriteRiff('riff_1')).toEqual([])
    expect(listFavouriteRiffCIDs()).toEqual([])
  })

  it('toggleFavouriteRiff persists multiple favourites independently', async () => {
    const { toggleFavouriteRiff, listFavouriteRiffCIDs } = await import('./riffFavourites')
    toggleFavouriteRiff('riff_1')
    toggleFavouriteRiff('riff_2')
    expect(listFavouriteRiffCIDs().slice().sort()).toEqual(['riff_1', 'riff_2'])
    toggleFavouriteRiff('riff_1')
    expect(listFavouriteRiffCIDs()).toEqual(['riff_2'])
  })
})
