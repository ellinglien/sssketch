import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'fs'
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

    // The autosave is deleted on every save, so on most installs it isn't there: the project
    // library is where earlier plugin use and recordings are found.
    const libraryProject = (name: string, body: unknown, mtime?: Date): void => {
      // app.getPath is mocked to `dir` for every name, so the default library root is
      // <dir>/sssketch/projects (projectLibrary.ts).
      const folder = join(dir, 'sssketch', 'projects', name)
      mkdirSync(folder, { recursive: true })
      const file = join(folder, `${name}.sssketchproj`)
      writeFileSync(file, JSON.stringify(body))
      if (mtime) utimesSync(file, mtime, mtime)
    }

    it('is on when a project in the library has a plugin, with no autosave', async () => {
      libraryProject('a', { masterChain: [null, null, null, null] })
      libraryProject('b', { masterChain: [null, 'verb', null, null], channelPlugins: {} })
      const { loadAppFeatures } = await import('./appFeaturesStore')
      expect(loadAppFeatures()).toEqual(ON)
      expect(JSON.parse(readFileSync(join(dir, 'appFeatures.json'), 'utf-8')).migratedFrom).toEqual(
        ['projectUsesPlugins']
      )
    })

    it('is on when a project in the library has a channel plugin', async () => {
      libraryProject('a', {
        masterChain: [null, null, null, null],
        channelPlugins: { c: [null, 'p'] }
      })
      const { loadAppFeatures } = await import('./appFeaturesStore')
      expect(loadAppFeatures()).toEqual(ON)
    })

    it('is on when a project in the library holds a recorded take, with no autosave', async () => {
      libraryProject('a', {
        masterChain: [null, null, null, null],
        rifffs: { g: { stems: [{ path: '/x/g/sssketch-recording-1234.wav' }] } }
      })
      const { loadAppFeatures } = await import('./appFeaturesStore')
      expect(loadAppFeatures()).toEqual(ON)
      expect(JSON.parse(readFileSync(join(dir, 'appFeatures.json'), 'utf-8')).migratedFrom).toEqual(
        ['recordingsMade']
      )
    })

    it('is off when the library`s projects use neither', async () => {
      libraryProject('a', {
        masterChain: [null, null, null, null],
        channelPlugins: { c: [null, null] },
        rifffs: { g: { stems: [{ path: '/x/g/a.wav' }] } }
      })
      const { loadAppFeatures } = await import('./appFeaturesStore')
      expect(loadAppFeatures()).toEqual(OFF)
    })

    it('reads a bounded number of library projects, newest first', async () => {
      libraryProject('old', { masterChain: ['verb', null, null, null] }, new Date(2026, 0, 1))
      libraryProject('new1', { masterChain: [null, null, null, null] }, new Date(2026, 5, 1))
      libraryProject('new2', { masterChain: [null, null, null, null] }, new Date(2026, 5, 2))
      const { detectAdvancedUse } = await import('./appFeaturesStore')
      const projectLibraryDir = join(dir, 'sssketch', 'projects')
      expect(detectAdvancedUse(dir, { projectLibraryDir, maxProjects: 2 }).projectUsesPlugins).toBe(
        false
      )
      expect(detectAdvancedUse(dir, { projectLibraryDir, maxProjects: 3 }).projectUsesPlugins).toBe(
        true
      )
    })

    it('does not read the library when a cheap signal already decides on', async () => {
      write('pluginCatalog.json', { plugins: [{ id: 'a' }], favouriteIds: [] })
      libraryProject('a', { masterChain: ['verb', null, null, null] })
      const { detectAdvancedUse, loadAppFeatures } = await import('./appFeaturesStore')
      const signals = detectAdvancedUse(dir, {
        projectLibraryDir: join(dir, 'sssketch', 'projects')
      })
      expect(signals.pluginsScanned).toBe(true)
      expect(signals.projectUsesPlugins).toBe(false) // never looked
      expect(loadAppFeatures()).toEqual(ON)
      expect(JSON.parse(readFileSync(join(dir, 'appFeatures.json'), 'utf-8')).migratedFrom).toEqual(
        ['pluginsScanned']
      )
    })

    it('looks at a bounded number of library folders, by name, newest-dated first', async () => {
      // Generated names start with the date, so a descending name order is roughly newest first.
      libraryProject('2025-01-01-old-plugin', { masterChain: ['verb', null, null, null] })
      libraryProject('2026-06-01-a', { masterChain: [null, null, null, null] })
      libraryProject('2026-06-02-b', { masterChain: [null, null, null, null] })
      const { detectAdvancedUse } = await import('./appFeaturesStore')
      const projectLibraryDir = join(dir, 'sssketch', 'projects')
      expect(detectAdvancedUse(dir, { projectLibraryDir, maxFolders: 2 }).projectUsesPlugins).toBe(
        false
      )
      expect(detectAdvancedUse(dir, { projectLibraryDir, maxFolders: 3 }).projectUsesPlugins).toBe(
        true
      )
    })

    it('shrugs off unreadable library projects and a missing library', async () => {
      const folder = join(dir, 'sssketch', 'projects', 'broken')
      mkdirSync(folder, { recursive: true })
      writeFileSync(join(folder, 'broken.sssketchproj'), '{nope')
      const { detectAdvancedUse } = await import('./appFeaturesStore')
      expect(
        detectAdvancedUse(dir, { projectLibraryDir: join(dir, 'sssketch', 'projects') })
          .projectUsesPlugins
      ).toBe(false)
      expect(
        detectAdvancedUse(dir, { projectLibraryDir: join(dir, 'nowhere') }).projectUsesPlugins
      ).toBe(false)
    })

    it('is on when the autosaved project (rarely there) has a plugin', async () => {
      write('autosave.sssketchproj', {
        masterChain: [null, null, null, null],
        channelPlugins: { c: [null, 'p'] }
      })
      const { loadAppFeatures } = await import('./appFeaturesStore')
      expect(loadAppFeatures()).toEqual(ON)
    })

    it('is on when the phone remote was set up or has run', async () => {
      write('phoneRemoteSettings.json', { preferredAddress: null })
      const { loadAppFeatures } = await import('./appFeaturesStore')
      expect(loadAppFeatures()).toEqual(ON)
    })

    it('is on when a hearts key is saved', async () => {
      write('radio-hearts-key.enc', 'xxxx')
      const { loadAppFeatures } = await import('./appFeaturesStore')
      expect(loadAppFeatures()).toEqual(ON)
    })

    it('is on when sound defaults were saved', async () => {
      write('soundSettings.json', { saturation: 0.2 })
      const { loadAppFeatures } = await import('./appFeaturesStore')
      expect(loadAppFeatures()).toEqual(ON)
      expect(JSON.parse(readFileSync(join(dir, 'appFeatures.json'), 'utf-8')).migratedFrom).toEqual(
        ['soundDefaultsSet']
      )
    })

    it('is on when the autosaved project (rarely there) holds a recorded take', async () => {
      write('autosave.sssketchproj', {
        masterChain: [null, null, null, null],
        rifffs: { g: { stems: [{ path: '/x/g/sssketch-gated-take-1234.wav' }] } }
      })
      const { loadAppFeatures } = await import('./appFeaturesStore')
      expect(loadAppFeatures()).toEqual(ON)
    })

    it('never re-migrates an existing appFeatures.json, either way', async () => {
      write('appFeatures.json', { advancedFeatures: true, migratedFrom: ['pluginsScanned'] })
      const first = await import('./appFeaturesStore')
      expect(first.loadAppFeatures()).toEqual(ON) // nothing here would turn it on now
      vi.resetModules()
      write('appFeatures.json', { advancedFeatures: false })
      write('pluginCatalog.json', { plugins: [{ id: 'a' }], favouriteIds: [] })
      libraryProject('a', { masterChain: ['verb', null, null, null] })
      const second = await import('./appFeaturesStore')
      expect(second.loadAppFeatures()).toEqual(OFF)
      expect(JSON.parse(readFileSync(join(dir, 'appFeatures.json'), 'utf-8'))).toEqual({
        advancedFeatures: false
      })
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
        recordingsMade: false,
        soundDefaultsSet: false
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
