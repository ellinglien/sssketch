// src/main/appFeaturesStore.ts -- the advanced features switch's own file, and main's gates.
//
// appFeatures.json in userData, beside discoverSettings.json and phoneRemoteSettings.json: a
// per-machine preference, never project data. See @shared/features for the rule and
// docs/superpowers/plans/2026-10-07-advanced-features-toggle.md for every place it reaches.
//
// MIGRATION. With no file yet, the switch's starting value comes from what this install has
// already used (advancedFeaturesDefault), read from a handful of small files in userData -- never
// a walk of the stem library (23k folders on Elling's machine). The decision is written straight
// away, so it is made once: a later scan or key never flips it behind his back.
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
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

/** What this install has already used, read only -- never writes. Exported so the migration can
 * be checked against a real userData folder without running the app. */
export function detectAdvancedUse(userDataDir: string): AdvancedUseSignals {
  const catalog = readJson(join(userDataDir, PLUGIN_CATALOG_FILE)) as {
    plugins?: unknown[]
  } | null
  const autosavePath = join(userDataDir, AUTOSAVE_FILE)
  let autosaveText = ''
  try {
    if (existsSync(autosavePath)) autosaveText = readFileSync(autosavePath, 'utf-8')
  } catch {
    autosaveText = ''
  }
  let autosave: {
    masterChain?: (string | null)[]
    channelPlugins?: Record<string, (string | null)[]>
  } | null = null
  try {
    autosave = autosaveText === '' ? null : JSON.parse(autosaveText)
  } catch {
    autosave = null
  }
  return {
    pluginsScanned: Array.isArray(catalog?.plugins) && catalog.plugins.length > 0,
    projectUsesPlugins: projectUsesPlugins(autosave?.masterChain, autosave?.channelPlugins),
    phoneRemoteUsed: existsSync(join(userDataDir, PHONE_REMOTE_SETTINGS_FILE)),
    heartsKeySet: existsSync(join(userDataDir, RADIO_HEARTS_KEY_FILE)),
    recordingsMade: TAKE_FILE_MARKERS.some((m) => autosaveText.includes(m))
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
  const decided = advancedFeaturesDefault(detectAdvancedUse(app.getPath('userData')))
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
