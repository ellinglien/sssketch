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

describe('pluginCatalog', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'ssstitch-catalog-test-'))
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('loadCatalog returns an empty catalog when no file exists yet', async () => {
    const { loadCatalog } = await import('./pluginCatalog')
    expect(loadCatalog()).toEqual({ plugins: [], favouriteIds: [] })
  })

  it('writeCatalog then loadCatalog round-trips', async () => {
    const { writeCatalog, loadCatalog } = await import('./pluginCatalog')
    const catalog = {
      plugins: [
        {
          id: 'x',
          name: 'Solid Bus Comp',
          manufacturer: 'NI',
          path: '/a.vst3',
          arch: 'arm64' as const
        }
      ],
      favouriteIds: ['x']
    }
    writeCatalog(catalog)
    expect(loadCatalog()).toEqual(catalog)
  })

  it('toggleFavourite adds an id not already favourited, removes one that is', async () => {
    const { writeCatalog, toggleFavourite, loadCatalog } = await import('./pluginCatalog')
    writeCatalog({
      plugins: [{ id: 'x', name: 'A', manufacturer: 'M', path: '/a.vst3', arch: 'arm64' }],
      favouriteIds: []
    })
    toggleFavourite('x')
    expect(loadCatalog().favouriteIds).toEqual(['x'])
    toggleFavourite('x')
    expect(loadCatalog().favouriteIds).toEqual([])
  })
})
