// src/main/appFeaturesStore.ts -- the advanced features switch's own file, and main's gates.
//
// appFeatures.json in userData, beside discoverSettings.json and phoneRemoteSettings.json: a
// per-machine preference, never project data. See @shared/features for the rule and
// docs/superpowers/plans/2026-10-07-advanced-features-toggle.md for every place it reaches.
//
// MIGRATION. With no file yet, the switch's starting value comes from what this install has
// already used (advancedFeaturesDefault): a handful of small files in userData, and the newest
// MAX_LIBRARY_PROJECTS projects of the project library (the autosave alone missed nearly
// everyone: it is deleted on every save). Never a walk of the stem library (23k folders on
// Elling's machine). The decision is written straight away, so it is made once: a later scan or
// key never flips it behind his back, and an existing appFeatures.json is never re-decided.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { libraryRootPath } from './projectLibrary'
import {
  ADVANCED_FEATURES_OFF,
  advancedFeaturesDefault,
  featureEnabled,
  projectUsesPlugins,
  type AdvancedUseSignals,
  type AppFeatureSettings
} from '@shared/features'

const STORE_FILENAME = 'appFeatures.json'

function storePath(): string {
  return join(app.getPath('userData'), STORE_FILENAME)
}

/** The file names the signals are read from. Each is owned by its own store; only existence or
 * a quick parse is asked of them here. */
const PLUGIN_CATALOG_FILE = 'pluginCatalog.json'
const PHONE_REMOTE_SETTINGS_FILE = 'phoneRemoteSettings.json'
const RADIO_HEARTS_KEY_FILE = 'radio-hearts-key.enc'
const AUTOSAVE_FILE = 'autosave.sssketchproj'
const SOUND_SETTINGS_FILE = 'soundSettings.json'

/** How many of the library's projects the migration reads, newest first, and the largest it
 * reads at all: enough to find someone who uses plugins or records, cheap on a big library. */
const MAX_LIBRARY_PROJECTS = 50
const MAX_PROJECT_BYTES = 16 * 1024 * 1024

/** The engine names its takes this way (IpcServer.cpp, arm-recording and the gated pass), and
 * importRecordedTake keeps the basename when it copies one into the library. */
const TAKE_FILE_MARKERS = ['sssketch-recording-', 'sssketch-gated-take-']

function readJson(path: string): unknown {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return null
  }
}

function readText(path: string): string {
  try {
    return existsSync(path) ? readFileSync(path, 'utf-8') : ''
  } catch {
    return ''
  }
}

/** What one project file says, from only the fields asked about: its chains (parsed) and whether
 * any stem is an engine take (a plain text search, no walk of its rifffs). */
function projectSignals(text: string): { plugins: boolean; takes: boolean } {
  if (text === '') return { plugins: false, takes: false }
  let chains: {
    masterChain?: (string | null)[]
    channelPlugins?: Record<string, (string | null)[]>
  } | null = null
  try {
    const parsed = JSON.parse(text) as Record<string, unknown> | null
    if (parsed !== null && typeof parsed === 'object') {
      chains = {
        masterChain: Array.isArray(parsed.masterChain)
          ? (parsed.masterChain as (string | null)[])
          : undefined,
        channelPlugins:
          parsed.channelPlugins !== null && typeof parsed.channelPlugins === 'object'
            ? (parsed.channelPlugins as Record<string, (string | null)[]>)
            : undefined
      }
    }
  } catch {
    chains = null
  }
  return {
    plugins:
      chains !== null &&
      projectUsesPlugins(
        chains.masterChain,
        Object.fromEntries(
          Object.entries(chains.channelPlugins ?? {}).filter(([, slots]) => Array.isArray(slots))
        )
      ),
    takes: TAKE_FILE_MARKERS.some((m) => text.includes(m))
  }
}

/** The library's project files (`<root>/<name>/<name>.sssketchproj`, projectLibrary.ts), newest
 * first, at most `max`. A missing or unreadable library is an empty one. */
function newestLibraryProjects(root: string, max: number): string[] {
  let names: string[]
  try {
    names = readdirSync(root)
  } catch {
    return []
  }
  const files: { path: string; mtimeMs: number }[] = []
  for (const name of names) {
    const path = join(root, name, `${name}.sssketchproj`)
    try {
      const stat = statSync(path)
      if (stat.isFile() && stat.size <= MAX_PROJECT_BYTES)
        files.push({ path, mtimeMs: stat.mtimeMs })
    } catch {
      // not a sketch folder
    }
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return files.slice(0, max).map((f) => f.path)
}

/** What this install has already used, read only -- never writes. Exported so the migration can
 * be checked against a real userData folder without running the app. `projectLibraryDir`: the
 * project library's root (none: not looked at). */
export function detectAdvancedUse(
  userDataDir: string,
  options: { projectLibraryDir?: string | null; maxProjects?: number } = {}
): AdvancedUseSignals {
  const catalog = readJson(join(userDataDir, PLUGIN_CATALOG_FILE)) as {
    plugins?: unknown[]
  } | null
  const found = projectSignals(readText(join(userDataDir, AUTOSAVE_FILE)))
  if (options.projectLibraryDir) {
    for (const path of newestLibraryProjects(
      options.projectLibraryDir,
      options.maxProjects ?? MAX_LIBRARY_PROJECTS
    )) {
      if (found.plugins && found.takes) break
      const project = projectSignals(readText(path))
      found.plugins ||= project.plugins
      found.takes ||= project.takes
    }
  }
  return {
    pluginsScanned: Array.isArray(catalog?.plugins) && catalog.plugins.length > 0,
    projectUsesPlugins: found.plugins,
    phoneRemoteUsed: existsSync(join(userDataDir, PHONE_REMOTE_SETTINGS_FILE)),
    heartsKeySet: existsSync(join(userDataDir, RADIO_HEARTS_KEY_FILE)),
    recordingsMade: found.takes,
    soundDefaultsSet: existsSync(join(userDataDir, SOUND_SETTINGS_FILE))
  }
}

/** The last value loaded or saved in this process, for the gates' cheap reads. */
let current: AppFeatureSettings | null = null

function readStored(path: string): AppFeatureSettings {
  const parsed = readJson(path) as Partial<AppFeatureSettings> | null
  if (parsed === null) {
    console.error(`loadAppFeatures: could not read ${path}, advanced features off`)
    return { ...ADVANCED_FEATURES_OFF }
  }
  return { advancedFeatures: parsed.advancedFeatures === true }
}

/** The switch. Never throws: a missing file is decided once from earlier use and written; an
 * unreadable one reads as off (a settings file must never be able to stop the app starting).
 * Main calls this once at startup, before the engine spawns or a window opens. */
export function loadAppFeatures(): AppFeatureSettings {
  const path = storePath()
  if (existsSync(path)) {
    current = readStored(path)
    return { ...current }
  }
  const decided = advancedFeaturesDefault(
    detectAdvancedUse(app.getPath('userData'), { projectLibraryDir: libraryRootPath() })
  )
  const settings: AppFeatureSettings = { advancedFeatures: decided.on }
  writeSettings(settings, decided.because)
  if (decided.on) {
    console.log(
      `loadAppFeatures: advanced features on, already used: ${decided.because.join(', ')}`
    )
  }
  current = settings
  return { ...settings }
}

/** The switch as this process last saw it -- for the gates, which run long after startup.
 * Read-only: with nothing loaded yet it reads the file without deciding (no file: off), so a
 * caller outside the app (a test) never writes a migration. */
export function currentAppFeatures(): AppFeatureSettings {
  if (current !== null) return { ...current }
  const path = storePath()
  return existsSync(path) ? readStored(path) : { ...ADVANCED_FEATURES_OFF }
}

/** The gear menu's switch. */
export function saveAppFeatures(settings: AppFeatureSettings): void {
  current = { advancedFeatures: settings.advancedFeatures === true }
  writeSettings(current)
}

function writeSettings(settings: AppFeatureSettings, migratedFrom?: string[]): void {
  // `migratedFrom` is only ever written by the first-run decision: a note for whoever opens the
  // file, never read back.
  const body = migratedFrom === undefined ? settings : { ...settings, migratedFrom }
  try {
    writeFileSync(storePath(), JSON.stringify(body, null, 2), 'utf-8')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`saveAppFeatures: failed to write ${storePath()}: ${message}`)
  }
}

// ---------------------------------------------------------------------------------------------
// Main's gates. Each takes the settings and the work, so a test can see the work skipped.

/** `scan-plugins`: no scan while plugins are off -- the stored catalog comes back untouched. */
export async function scanPluginsUnlessOff<T>(
  settings: AppFeatureSettings,
  scan: () => Promise<T>,
  stored: () => T
): Promise<T> {
  return featureEnabled('plugins', settings) ? scan() : stored()
}

/** `start-phone-remote`: the server only starts with the phone remote on. */
export function phoneRemoteStartAllowed(settings: AppFeatureSettings): boolean {
  return featureEnabled('phoneRemote', settings)
}

/** The playback engine opens an audio input at launch -- which is what asks macOS for the
 * microphone -- only with recording on. */
export function engineAudioInputWanted(settings: AppFeatureSettings): boolean {
  return featureEnabled('recording', settings)
}

/** The catalog an offline render resolves plugin paths through: empty while plugins are off, so
 * an export matches what is heard and no plugin code is loaded. */
export function pluginCatalogForRender<T extends { plugins: unknown[] }>(
  settings: AppFeatureSettings,
  load: () => T
): T | { plugins: never[] } {
  return featureEnabled('plugins', settings) ? load() : { plugins: [] }
}
