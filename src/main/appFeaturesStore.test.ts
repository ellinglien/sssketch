import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

vi.mock('electron', () => ({ app: { getPath: vi.fn() } }))

const ON = { advancedFeatures: true }
const OFF = { advancedFeatures: false }

describe('appFeaturesStore', () => {
  let dir: string

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'app-features-test-'))
    const { app } = await import('electron')
    vi.mocked(app.getPath).mockReturnValue(dir)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    vi.resetModules()
  })

  const write = (name: string, body: unknown): void =>
    writeFileSync(join(dir, name), typeof body === 'string' ? body : JSON.stringify(body))

  describe('migration (no appFeatures.json yet)', () => {
    it('is off for a new install, and writes that down', async () => {
      const { loadAppFeatures } = await import('./appFeaturesStore')
      expect(loadAppFeatures()).toEqual(OFF)
      expect(JSON.parse(readFileSync(join(dir, 'appFeatures.json'), 'utf-8'))).toEqual({
        advancedFeatures: false,
        migratedFrom: []
      })
    })

    it('is off when a scan found no plugins', async () => {
      write('pluginCatalog.json', { plugins: [], favouriteIds: [] })
      const { loadAppFeatures } = await import('./appFeaturesStore')
      expect(loadAppFeatures()).toEqual(OFF)
    })

    it('is on when plugins were scanned', async () => {
      write('pluginCatalog.json', { plugins: [{ id: 'a' }], favouriteIds: [] })
      const { loadAppFeatures } = await import('./appFeaturesStore')
      expect(loadAppFeatures()).toEqual(ON)
      expect(JSON.parse(readFileSync(join(dir, 'appFeatures.json'), 'utf-8')).migratedFrom).toEqual(
        ['pluginsScanned']
      )
    })

    it('is on when the autosaved project has a plugin', async () => {
      write('autosave.sssketchproj', {
        masterChain: [null, null, null, null],
        channelPlugins: { c: [null, 'p'] }
      })
      const { loadAppFeatures } = await import('./appFeaturesStore')
      expect(loadAppFeatures()).toEqual(ON)
    })

    it('is on when the phone remote was set up', async () => {
      write('phoneRemoteSettings.json', { preferredAddress: '192.168.2.151' })
      const { loadAppFeatures } = await import('./appFeaturesStore')
      expect(loadAppFeatures()).toEqual(ON)
    })

    it('is on when a hearts key is saved', async () => {
      write('radio-hearts-key.enc', 'xxxx')
      const { loadAppFeatures } = await import('./appFeaturesStore')
      expect(loadAppFeatures()).toEqual(ON)
    })

    it('is on when the autosaved project holds a recorded take', async () => {
      write('autosave.sssketchproj', {
        masterChain: [null, null, null, null],
        rifffs: { g: { stems: [{ path: '/x/g/sssketch-gated-take-1234.wav' }] } }
      })
      const { loadAppFeatures } = await import('./appFeaturesStore')
      expect(loadAppFeatures()).toEqual(ON)
    })

    it('decides once: a scan after the first launch does not flip it', async () => {
      const { loadAppFeatures } = await import('./appFeaturesStore')
      expect(loadAppFeatures()).toEqual(OFF)
      write('pluginCatalog.json', { plugins: [{ id: 'a' }], favouriteIds: [] })
      expect(loadAppFeatures()).toEqual(OFF)
    })

    it('shrugs off unreadable signal files', async () => {
      write('pluginCatalog.json', '{nope')
      write('autosave.sssketchproj', '{nope')
      const { detectAdvancedUse } = await import('./appFeaturesStore')
      expect(detectAdvancedUse(dir)).toEqual({
        pluginsScanned: false,
        projectUsesPlugins: false,
        phoneRemoteUsed: false,
        heartsKeySet: false,
        recordingsMade: false
      })
    })
  })

  it('remembers the switch across a save/load round trip', async () => {
    const { loadAppFeatures, saveAppFeatures } = await import('./appFeaturesStore')
    saveAppFeatures(ON)
    expect(loadAppFeatures()).toEqual(ON)
    saveAppFeatures(OFF)
    expect(loadAppFeatures()).toEqual(OFF)
  })

  it('reads the current value without deciding a migration', async () => {
    write('pluginCatalog.json', { plugins: [{ id: 'a' }], favouriteIds: [] })
    const { currentAppFeatures } = await import('./appFeaturesStore')
    expect(currentAppFeatures()).toEqual(OFF)
    expect(() => readFileSync(join(dir, 'appFeatures.json'))).toThrow()
  })

  it('follows a save in the same process', async () => {
    const { currentAppFeatures, loadAppFeatures, saveAppFeatures } =
      await import('./appFeaturesStore')
    loadAppFeatures()
    saveAppFeatures(ON)
    expect(currentAppFeatures()).toEqual(ON)
  })

  it('reads a corrupt file as off', async () => {
    write('appFeatures.json', '{nope')
    const { loadAppFeatures } = await import('./appFeaturesStore')
    expect(loadAppFeatures()).toEqual(OFF)
  })

  describe("main's gates", () => {
    it('skips the plugin scan while off, and returns the stored catalog', async () => {
      const { scanPluginsUnlessOff } = await import('./appFeaturesStore')
      const scan = vi.fn(async () => 'scanned')
      expect(await scanPluginsUnlessOff(OFF, scan, () => 'stored')).toBe('stored')
      expect(scan).not.toHaveBeenCalled()
      expect(await scanPluginsUnlessOff(ON, scan, () => 'stored')).toBe('scanned')
      expect(scan).toHaveBeenCalledOnce()
    })

    it('starts the phone remote only while on', async () => {
      const { phoneRemoteStartAllowed } = await import('./appFeaturesStore')
      expect(phoneRemoteStartAllowed(OFF)).toBe(false)
      expect(phoneRemoteStartAllowed(ON)).toBe(true)
    })

    it('opens the audio input (the microphone request) only while on', async () => {
      const { engineAudioInputWanted } = await import('./appFeaturesStore')
      expect(engineAudioInputWanted(OFF)).toBe(false)
      expect(engineAudioInputWanted(ON)).toBe(true)
    })

    it('renders exports with no plugins while off', async () => {
      const { pluginCatalogForRender } = await import('./appFeaturesStore')
      const load = vi.fn(() => ({ plugins: [{ id: 'a', path: '/p' }] }))
      expect(pluginCatalogForRender(OFF, load)).toEqual({ plugins: [] })
      expect(load).not.toHaveBeenCalled()
      expect(pluginCatalogForRender(ON, load).plugins).toHaveLength(1)
    })
  })
})
