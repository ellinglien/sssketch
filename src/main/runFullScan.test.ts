import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let userDataDir: string

vi.mock('electron', () => ({
  app: { getPath: () => userDataDir }
}))

vi.mock('./pluginScan', () => ({
  listPluginCandidates: () => ['/a.vst3', '/Library/Audio/Plug-Ins/VST3/Solid Bus Comp.vst3'],
  scanOneCandidate: async (path: string) => {
    if (path === '/a.vst3') {
      return {
        success: true,
        plugins: [{ name: 'A', manufacturer: 'M', identifierString: 'id-a', arch: 'arm64' }]
      }
    }
    return {
      success: true,
      plugins: [
        {
          name: 'Solid Bus Comp',
          manufacturer: 'NI',
          identifierString: 'id-sbc',
          arch: 'universal'
        }
      ]
    }
  }
}))

describe('runFullScan', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'sssketch-fullscan-test-'))
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('preserves a favourite for a plugin not found in this scan, and does not auto-favourite on a non-first scan', async () => {
    const { writeCatalog } = await import('./pluginCatalog')
    writeCatalog({
      plugins: [
        { id: 'id-gone', name: 'Gone', manufacturer: 'M', path: '/gone.vst3', arch: 'arm64' }
      ],
      favouriteIds: ['id-gone']
    })

    const { runFullScan } = await import('./runFullScan')
    const catalog = await runFullScan(() => {})

    expect(catalog.plugins.map((p) => p.id).sort()).toEqual(['id-a', 'id-sbc'])
    expect(catalog.favouriteIds).toContain('id-gone')
    // A catalog already existed before this scan (it had "Gone" in it), so
    // this isn't a first-ever scan -- Solid Bus Comp must NOT get
    // auto-favourited even though its path matches the old allowlist.
    expect(catalog.favouriteIds).not.toContain('id-sbc')
  })

  it('auto-favourites an old-allowlist plugin found on the very first scan (no catalog existed before)', async () => {
    const { runFullScan } = await import('./runFullScan')
    const catalog = await runFullScan(() => {})
    expect(catalog.favouriteIds).toContain('id-sbc')
    expect(catalog.favouriteIds).not.toContain('id-a') // not one of the 5 old allowlist paths
  })

  it('reports progress once per candidate', async () => {
    const { runFullScan } = await import('./runFullScan')
    const progressCalls: unknown[] = []
    await runFullScan((p) => progressCalls.push(p))
    expect(progressCalls).toEqual([
      { done: 1, total: 2 },
      { done: 2, total: 2 }
    ])
  })
})
