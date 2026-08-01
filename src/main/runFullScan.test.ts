import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let userDataDir: string

vi.mock('electron', () => ({
  app: { getPath: () => userDataDir }
}))

vi.mock('./pluginScan', () => ({
  listVst3Candidates: () => ['/a.vst3'],
  scanOneCandidate: async () => ({
    success: true,
    plugins: [{ name: 'A', manufacturer: 'M', identifierString: 'id-a', arch: 'arm64' }]
  })
}))

describe('runFullScan', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'ssstitch-fullscan-test-'))
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('preserves a favourite for a plugin not found in this scan', async () => {
    const { writeCatalog } = await import('./pluginCatalog')
    writeCatalog({
      plugins: [
        { id: 'id-gone', name: 'Gone', manufacturer: 'M', path: '/gone.vst3', arch: 'arm64' }
      ],
      favouriteIds: ['id-gone']
    })

    const { runFullScan } = await import('./runFullScan')
    const catalog = await runFullScan(() => {})

    expect(catalog.plugins.map((p) => p.id)).toEqual(['id-a'])
    expect(catalog.favouriteIds).toContain('id-gone')
  })

  it('reports progress once per candidate', async () => {
    const { runFullScan } = await import('./runFullScan')
    const progressCalls: unknown[] = []
    await runFullScan((p) => progressCalls.push(p))
    expect(progressCalls).toEqual([{ done: 1, total: 1 }])
  })
})
