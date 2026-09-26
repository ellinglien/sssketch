import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
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
    expect(loadDiscoverSettings()).toEqual({
      consentedToLibraryScan: false,
      traitMatchBar: 0.75,
      radioPace: 'mid'
    })
  })

  it('persists consent across a save/load round trip', async () => {
    const { loadDiscoverSettings, saveDiscoverSettings } = await import('./discoverSettingsStore')
    saveDiscoverSettings({
      consentedToLibraryScan: true,
      traitMatchBar: 0.75,
      radioPace: 'mid'
    })
    expect(loadDiscoverSettings()).toEqual({
      consentedToLibraryScan: true,
      traitMatchBar: 0.75,
      radioPace: 'mid'
    })
  })

  it('defaults to not consented (not a thrown error) when the file is corrupted', async () => {
    const { loadDiscoverSettings, saveDiscoverSettings } = await import('./discoverSettingsStore')
    saveDiscoverSettings({
      consentedToLibraryScan: true,
      traitMatchBar: 0.75,
      radioPace: 'mid'
    })
    writeFileSync(join(dir, 'discoverSettings.json'), 'not valid json{{{', 'utf-8')
    expect(() => loadDiscoverSettings()).not.toThrow()
    expect(loadDiscoverSettings()).toEqual({
      consentedToLibraryScan: false,
      traitMatchBar: 0.75,
      radioPace: 'mid'
    })
  })

  it('persists the trait match bar, and falls back to the default for an unknown value', async () => {
    const { loadDiscoverSettings, saveDiscoverSettings } = await import('./discoverSettingsStore')
    saveDiscoverSettings({ consentedToLibraryScan: true, traitMatchBar: 0.9, radioPace: 'mid' })
    expect(loadDiscoverSettings().traitMatchBar).toBe(0.9)
    saveDiscoverSettings({ consentedToLibraryScan: true, traitMatchBar: 0.33, radioPace: 'mid' })
    expect(loadDiscoverSettings().traitMatchBar).toBe(0.75)
  })

  it('round trips every radio pace, and normalizes an unknown one', async () => {
    const { loadDiscoverSettings, saveDiscoverSettings } = await import('./discoverSettingsStore')
    for (const pace of ['slow', 'mid', 'fast'] as const) {
      saveDiscoverSettings({ consentedToLibraryScan: false, traitMatchBar: 0.75, radioPace: pace })
      expect(loadDiscoverSettings().radioPace).toBe(pace)
    }
    writeFileSync(
      join(dir, 'discoverSettings.json'),
      JSON.stringify({ consentedToLibraryScan: false, traitMatchBar: 0.75, radioPace: 'glacial' }),
      'utf-8'
    )
    expect(loadDiscoverSettings().radioPace).toBe('mid')
  })

  it('defaults the radio pace for a settings file written before radio existed', async () => {
    const { loadDiscoverSettings } = await import('./discoverSettingsStore')
    writeFileSync(
      join(dir, 'discoverSettings.json'),
      JSON.stringify({ consentedToLibraryScan: true, traitMatchBar: 0.9 }),
      'utf-8'
    )
    expect(loadDiscoverSettings()).toEqual({
      consentedToLibraryScan: true,
      traitMatchBar: 0.9,
      radioPace: 'mid'
    })
  })
})
