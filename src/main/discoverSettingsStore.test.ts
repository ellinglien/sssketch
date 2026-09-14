import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

vi.mock('electron', () => ({ app: { getPath: vi.fn() } }))

describe('discoverSettingsStore', () => {
  let dir: string

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'discover-settings-test-'))
    const { app } = await import('electron')
    vi.mocked(app.getPath).mockReturnValue(dir)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    vi.resetModules()
  })

  it('defaults to not consented when no file exists yet', async () => {
    const { loadDiscoverSettings } = await import('./discoverSettingsStore')
    expect(loadDiscoverSettings()).toEqual({ consentedToLibraryScan: false })
  })

  it('persists consent across a save/load round trip', async () => {
    const { loadDiscoverSettings, saveDiscoverSettings } = await import('./discoverSettingsStore')
    saveDiscoverSettings({ consentedToLibraryScan: true })
    expect(loadDiscoverSettings()).toEqual({ consentedToLibraryScan: true })
  })

  it('defaults to not consented (not a thrown error) when the file is corrupted', async () => {
    const { loadDiscoverSettings, saveDiscoverSettings } = await import('./discoverSettingsStore')
    saveDiscoverSettings({ consentedToLibraryScan: true })
    const { writeFileSync } = await import('fs')
    writeFileSync(join(dir, 'discoverSettings.json'), 'not valid json{{{', 'utf-8')
    expect(() => loadDiscoverSettings()).not.toThrow()
    expect(loadDiscoverSettings()).toEqual({ consentedToLibraryScan: false })
  })
})
