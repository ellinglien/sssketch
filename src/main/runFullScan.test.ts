import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let userDataDir: string

vi.mock('electron', () => ({
  app: { getPath: () => userDataDir }
}))

const { getMtimeMsMock } = vi.hoisted(() => ({
  // Typed to match the real getMtimeMs(path: string) signature in
  // pluginScan.ts -- callers below need to branch on `path` when setting a
  // per-candidate mtime via mockImplementation.
  getMtimeMsMock: vi.fn((path: string): number | null => {
    void path
    return null
  })
}))

vi.mock('./pluginScan', () => ({
  listPluginCandidates: () => [
    '/a.vst3',
    '/Library/Audio/Plug-Ins/VST3/Solid Bus Comp.vst3',
    '/instrument.vst3'
  ],
  scanOneCandidate: vi.fn(async (path: string) => {
    if (path === '/a.vst3') {
      return {
        success: true,
        plugins: [
          {
            name: 'A',
            manufacturer: 'M',
            identifierString: 'id-a',
            arch: 'arm64',
            isInstrument: false
          }
        ]
      }
    }
    if (path === '/instrument.vst3') {
      return {
        success: true,
        plugins: [
          {
            name: 'Some Synth',
            manufacturer: 'M',
            identifierString: 'id-synth',
            arch: 'arm64',
            isInstrument: true
          }
        ]
      }
    }
    return {
      success: true,
      plugins: [
        {
          name: 'Solid Bus Comp',
          manufacturer: 'NI',
          identifierString: 'id-sbc',
          arch: 'universal',
          isInstrument: false
        }
      ]
    }
  }),
  getMtimeMs: getMtimeMsMock
}))

describe('runFullScan', () => {
  beforeEach(async () => {
    userDataDir = mkdtempSync(join(tmpdir(), 'sssketch-fullscan-test-'))
    getMtimeMsMock.mockReset().mockImplementation(() => null)
    const { scanOneCandidate } = await import('./pluginScan')
    vi.mocked(scanOneCandidate).mockClear()
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('preserves a favourite for a plugin not found in this scan, and does not auto-favourite on a non-first scan', async () => {
    const { writeCatalog } = await import('./pluginCatalog')
    writeCatalog({
      plugins: [
        {
          id: 'id-gone',
          name: 'Gone',
          manufacturer: 'M',
          path: '/gone.vst3',
          arch: 'arm64',
          mtimeMs: 1000
        }
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

  it('excludes instrument plugins from the catalog entirely', async () => {
    const { runFullScan } = await import('./runFullScan')
    const catalog = await runFullScan(() => {})
    expect(catalog.plugins.map((p) => p.id)).not.toContain('id-synth')
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
      { done: 1, total: 3 },
      { done: 2, total: 3 },
      { done: 3, total: 3 }
    ])
  })

  describe('caching by mtime', () => {
    it('reuses a previous entry without rescanning when the bundle mtime is unchanged', async () => {
      const { writeCatalog } = await import('./pluginCatalog')
      writeCatalog({
        plugins: [
          {
            id: 'id-a',
            name: 'A (cached)',
            manufacturer: 'M (cached)',
            path: '/a.vst3',
            arch: 'arm64',
            mtimeMs: 5000
          }
        ],
        favouriteIds: []
      })
      getMtimeMsMock.mockImplementation((path: string) => (path === '/a.vst3' ? 5000 : null))

      const scanCalls: string[] = []
      const { scanOneCandidate } = await import('./pluginScan')
      // Capture the shared mock's original implementation so it can be
      // restored after this test -- mockClear() in beforeEach only clears
      // call history, not the implementation, so an unrestored override
      // here would otherwise leak into every later test in this file.
      const originalImpl = vi.mocked(scanOneCandidate).getMockImplementation()
      vi.mocked(scanOneCandidate).mockImplementation(async (path: string) => {
        scanCalls.push(path)
        return { success: true, plugins: [] }
      })

      try {
        const { runFullScan } = await import('./runFullScan')
        const catalog = await runFullScan(() => {})

        expect(scanCalls).not.toContain('/a.vst3')
        const cachedEntry = catalog.plugins.find((p) => p.id === 'id-a')
        expect(cachedEntry).toEqual({
          id: 'id-a',
          name: 'A (cached)',
          manufacturer: 'M (cached)',
          path: '/a.vst3',
          arch: 'arm64',
          mtimeMs: 5000
        })
      } finally {
        vi.mocked(scanOneCandidate).mockImplementation(originalImpl!)
      }
    })

    it('rescans a candidate whose mtime differs from its stored value', async () => {
      const { writeCatalog } = await import('./pluginCatalog')
      writeCatalog({
        plugins: [
          {
            id: 'id-a-old',
            name: 'A (stale)',
            manufacturer: 'M',
            path: '/a.vst3',
            arch: 'arm64',
            mtimeMs: 1111
          }
        ],
        favouriteIds: []
      })
      // Stored mtime was 1111; this scan sees 2222 -- a real change.
      getMtimeMsMock.mockImplementation((path: string) => (path === '/a.vst3' ? 2222 : null))

      const { runFullScan } = await import('./runFullScan')
      const catalog = await runFullScan(() => {})

      // scanOneCandidate's default mock (from the top-level vi.mock) returns
      // id-a for '/a.vst3' -- if caching incorrectly kicked in, we'd see
      // 'id-a-old' instead.
      expect(catalog.plugins.map((p) => p.id)).toContain('id-a')
      expect(catalog.plugins.map((p) => p.id)).not.toContain('id-a-old')
      const rescannedEntry = catalog.plugins.find((p) => p.id === 'id-a')
      expect(rescannedEntry?.mtimeMs).toBe(2222)
    })

    it('scans a candidate with no previous catalog entry normally', async () => {
      // No writeCatalog call -- previous catalog is empty, so every
      // candidate is "new." getMtimeMsMock's default (from beforeEach)
      // already returns null for everything.
      const { runFullScan } = await import('./runFullScan')
      const catalog = await runFullScan(() => {})
      expect(catalog.plugins.map((p) => p.id).sort()).toEqual(['id-a', 'id-sbc'])
    })

    it('reports progress once per candidate even when some are cached', async () => {
      const { writeCatalog } = await import('./pluginCatalog')
      writeCatalog({
        plugins: [
          {
            id: 'id-a',
            name: 'A',
            manufacturer: 'M',
            path: '/a.vst3',
            arch: 'arm64',
            mtimeMs: 5000
          }
        ],
        favouriteIds: []
      })
      getMtimeMsMock.mockImplementation((path: string) => (path === '/a.vst3' ? 5000 : null))

      const { runFullScan } = await import('./runFullScan')
      const progressCalls: unknown[] = []
      await runFullScan((p) => progressCalls.push(p))
      expect(progressCalls).toEqual([
        { done: 1, total: 3 },
        { done: 2, total: 3 },
        { done: 3, total: 3 }
      ])
    })
  })
})
