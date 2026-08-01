// src/main/pluginCatalog.ts
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

export interface CatalogEntry {
  id: string // native engine's PluginDescription::createIdentifierString()
  name: string
  manufacturer: string
  path: string
  arch: 'arm64' | 'x86_64' | 'universal' | 'unknown'
}

export interface PluginCatalog {
  plugins: CatalogEntry[]
  favouriteIds: string[]
}

const CATALOG_FILENAME = 'pluginCatalog.json'

function catalogPath(): string {
  return join(app.getPath('userData'), CATALOG_FILENAME)
}

/** Reads back the plugin catalog -- an empty catalog (never a thrown error)
 * both when no scan has ever run and when reading one fails, matching
 * projectFile.ts's loadAutosave's own "nothing to offer, return the empty
 * case" convention. */
export function loadCatalog(): PluginCatalog {
  const path = catalogPath()
  if (!existsSync(path)) return { plugins: [], favouriteIds: [] }
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as PluginCatalog
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`loadCatalog: failed to read ${path}: ${message}`)
    return { plugins: [], favouriteIds: [] }
  }
}

export function writeCatalog(catalog: PluginCatalog): void {
  try {
    writeFileSync(catalogPath(), JSON.stringify(catalog, null, 2), 'utf-8')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`writeCatalog: failed to write ${catalogPath()}: ${message}`)
  }
}

/** Toggles a single plugin id's favourite status and persists immediately.
 * A no-op (still persists cleanly) if the id isn't in the current catalog's
 * plugins list at all -- favouriting is deliberately not validated against
 * the plugins list, since a plugin can be favourited, then temporarily
 * disappear from a later rescan (external drive unmounted, etc.) without
 * losing its favourite status -- see the design spec's error-handling
 * section on this exact scenario. */
export function toggleFavourite(id: string): void {
  const catalog = loadCatalog()
  const index = catalog.favouriteIds.indexOf(id)
  if (index === -1) {
    catalog.favouriteIds.push(id)
  } else {
    catalog.favouriteIds.splice(index, 1)
  }
  writeCatalog(catalog)
}
