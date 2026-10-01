import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { DEFAULT_SOUND_SETTINGS, normalizeSoundSettings } from '@shared/radioSound'

vi.mock('electron', () => ({ app: { getPath: vi.fn() } }))

describe('soundSettingsStore (the app-wide default sound settings)', () => {
  let dir: string

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'sound-settings-test-'))
    const { app } = await import('electron')
    vi.mocked(app.getPath).mockReturnValue(dir)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    vi.resetModules()
  })

  it('a missing file gives every stage on, at the web values', async () => {
    const { loadSoundSettings } = await import('./soundSettingsStore')
    expect(loadSoundSettings()).toEqual(DEFAULT_SOUND_SETTINGS)
  })

  it('a set round-trips', async () => {
    const { loadSoundSettings, saveSoundSettings } = await import('./soundSettingsStore')
    const custom = normalizeSoundSettings(undefined)
    custom.mastering.on = false
    custom.glue.amount = 0.8
    custom.reverb.room = 'zita'
    custom.throws.rate = 'rare'
    saveSoundSettings(custom)
    expect(loadSoundSettings()).toEqual(custom)
  })

  it('junk is normalised: bad fields fall back to the defaults, amounts are clamped', async () => {
    writeFileSync(
      join(dir, 'soundSettings.json'),
      JSON.stringify({ glue: { on: 'yes', amount: 7 }, pump: null, reverb: { room: 'hall' } })
    )
    const { loadSoundSettings } = await import('./soundSettingsStore')
    const s = loadSoundSettings()
    expect(s.glue).toEqual({ on: true, amount: 1 })
    expect(s.pump).toEqual(DEFAULT_SOUND_SETTINGS.pump)
    expect(s.reverb.room).toBe('cavern')
  })

  it('a corrupt file gives the defaults, not a thrown error', async () => {
    writeFileSync(join(dir, 'soundSettings.json'), '{not json')
    const { loadSoundSettings } = await import('./soundSettingsStore')
    expect(loadSoundSettings()).toEqual(DEFAULT_SOUND_SETTINGS)
  })

  it('a save is normalised before it is written', async () => {
    const { saveSoundSettings } = await import('./soundSettingsStore')
    saveSoundSettings({ glue: { on: false, amount: -3 } } as never)
    const written = JSON.parse(readFileSync(join(dir, 'soundSettings.json'), 'utf-8'))
    expect(written.glue).toEqual({ on: false, amount: 0 })
    expect(written.mastering).toEqual(DEFAULT_SOUND_SETTINGS.mastering)
  })
})
