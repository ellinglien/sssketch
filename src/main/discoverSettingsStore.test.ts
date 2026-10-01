import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { DEFAULT_RADIO_SETTINGS } from '@shared/radioSchedule'

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
      radio: DEFAULT_RADIO_SETTINGS
    })
  })

  it('persists consent across a save/load round trip', async () => {
    const { loadDiscoverSettings, saveDiscoverSettings } = await import('./discoverSettingsStore')
    saveDiscoverSettings({
      consentedToLibraryScan: true,
      traitMatchBar: 0.75,
      radio: DEFAULT_RADIO_SETTINGS
    })
    expect(loadDiscoverSettings()).toEqual({
      consentedToLibraryScan: true,
      traitMatchBar: 0.75,
      radio: DEFAULT_RADIO_SETTINGS
    })
  })

  it('defaults to not consented (not a thrown error) when the file is corrupted', async () => {
    const { loadDiscoverSettings, saveDiscoverSettings } = await import('./discoverSettingsStore')
    saveDiscoverSettings({
      consentedToLibraryScan: true,
      traitMatchBar: 0.75,
      radio: DEFAULT_RADIO_SETTINGS
    })
    writeFileSync(join(dir, 'discoverSettings.json'), 'not valid json{{{', 'utf-8')
    expect(() => loadDiscoverSettings()).not.toThrow()
    expect(loadDiscoverSettings()).toEqual({
      consentedToLibraryScan: false,
      traitMatchBar: 0.75,
      radio: DEFAULT_RADIO_SETTINGS
    })
  })

  it('persists the trait match bar, and falls back to the default for an unknown value', async () => {
    const { loadDiscoverSettings, saveDiscoverSettings } = await import('./discoverSettingsStore')
    saveDiscoverSettings({
      consentedToLibraryScan: true,
      traitMatchBar: 0.9,
      radio: DEFAULT_RADIO_SETTINGS
    })
    expect(loadDiscoverSettings().traitMatchBar).toBe(0.9)
    saveDiscoverSettings({
      consentedToLibraryScan: true,
      traitMatchBar: 0.33,
      radio: DEFAULT_RADIO_SETTINGS
    })
    expect(loadDiscoverSettings().traitMatchBar).toBe(0.75)
  })

  it('round-trips every radio setting', async () => {
    const { loadDiscoverSettings, saveDiscoverSettings } = await import('./discoverSettingsStore')
    saveDiscoverSettings({
      consentedToLibraryScan: true,
      traitMatchBar: 0.9,
      radio: {
        pace: 'fast',
        paceBars: { min: 5, max: 9 },
        loopEndOverBars: 2,
        phraseBars: 16,
        channels: 7,
        transitions: 'bold',
        dropOuts: 'often',
        turnover: 'random',
        density: 'off'
      }
    })
    expect(loadDiscoverSettings().radio).toEqual({
      pace: 'fast',
      paceBars: { min: 5, max: 9 },
      loopEndOverBars: 2,
      phraseBars: 16,
      channels: 7,
      transitions: 'bold',
      dropOuts: 'often',
      turnover: 'random',
      density: 'off'
    })
  })

  it('normalizes an unknown pace inside the radio object', async () => {
    const { loadDiscoverSettings } = await import('./discoverSettingsStore')
    writeFileSync(
      join(dir, 'discoverSettings.json'),
      JSON.stringify({ radio: { pace: 'glacial' } }),
      'utf-8'
    )
    expect(loadDiscoverSettings().radio.pace).toBe('mid')
  })

  it('migrates a 1.3.0 file, which stored radioPace flat and had no radio object', async () => {
    writeFileSync(
      join(dir, 'discoverSettings.json'),
      JSON.stringify({ consentedToLibraryScan: true, traitMatchBar: 0.9, radioPace: 'fast' }),
      'utf-8'
    )
    const { loadDiscoverSettings } = await import('./discoverSettingsStore')
    const loaded = loadDiscoverSettings()
    expect(loaded.consentedToLibraryScan).toBe(true)
    expect(loaded.traitMatchBar).toBe(0.9)
    expect(loaded.radio).toEqual({
      ...DEFAULT_RADIO_SETTINGS,
      pace: 'fast',
      paceBars: { min: 3, max: 6 }
    })
  })

  it('migrates a stored change-on grid to the threshold that replaced it', async () => {
    // 1.3.x wrote a `change on` word where the loop-end threshold now
    // goes. A real file has to keep meaning what it meant rather than
    // resetting -- `loop end` is `always`, i.e. 0.
    writeFileSync(
      join(dir, 'discoverSettings.json'),
      JSON.stringify({ radio: { pace: 'fast', grid: 'loop end' } }),
      'utf-8'
    )
    const { loadDiscoverSettings } = await import('./discoverSettingsStore')
    expect(loadDiscoverSettings().radio).toEqual({
      ...DEFAULT_RADIO_SETTINGS,
      pace: 'fast',
      paceBars: { min: 3, max: 6 },
      loopEndOverBars: 0
    })
  })

  it('defaults a nonsense radio object rather than throwing', async () => {
    writeFileSync(join(dir, 'discoverSettings.json'), JSON.stringify({ radio: 7 }), 'utf-8')
    const { loadDiscoverSettings } = await import('./discoverSettingsStore')
    expect(() => loadDiscoverSettings()).not.toThrow()
    expect(loadDiscoverSettings().radio).toEqual(DEFAULT_RADIO_SETTINGS)
  })

  it('defaults the radio settings for a file written before radio existed', async () => {
    const { loadDiscoverSettings } = await import('./discoverSettingsStore')
    writeFileSync(
      join(dir, 'discoverSettings.json'),
      JSON.stringify({ consentedToLibraryScan: true, traitMatchBar: 0.9 }),
      'utf-8'
    )
    expect(loadDiscoverSettings()).toEqual({
      consentedToLibraryScan: true,
      traitMatchBar: 0.9,
      radio: DEFAULT_RADIO_SETTINGS
    })
  })
})
