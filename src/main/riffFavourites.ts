import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

export interface FavouritesFile {
  riffCIDs: string[]
}

const FAVOURITES_FILENAME = 'riffFavourites.json'

function favouritesPath(): string {
  return join(app.getPath('userData'), FAVOURITES_FILENAME)
}

/** Reads back the riff favourites file -- an empty list (never a thrown
 * error) both when no favourite has ever been set and when reading one
 * fails, matching pluginCatalog.ts's loadCatalog's own convention. */
function loadFavourites(): FavouritesFile {
  const path = favouritesPath()
  if (!existsSync(path)) return { riffCIDs: [] }
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as FavouritesFile
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`loadFavourites: failed to read ${path}: ${message}`)
    return { riffCIDs: [] }
  }
}

function writeFavourites(favourites: FavouritesFile): void {
  try {
    writeFileSync(favouritesPath(), JSON.stringify(favourites, null, 2), 'utf-8')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`writeFavourites: failed to write ${favouritesPath()}: ${message}`)
  }
}

export function listFavouriteRiffCIDs(): string[] {
  return loadFavourites().riffCIDs
}

/** Toggles a single riff's favourite status and persists immediately.
 * Not validated against any known-riffs list -- a riff can be favourited
 * from either library browser (LORE or direct-Endlesss) and later become
 * temporarily unavailable there without losing its favourite status,
 * matching pluginCatalog.ts's own toggleFavourite reasoning (a plugin can
 * be favourited then vanish on a later rescan without losing favourite
 * status). Returns the updated list so callers (the IPC handler) can hand
 * it straight back to the renderer without a second read. */
export function toggleFavouriteRiff(riffCID: string): string[] {
  const favourites = loadFavourites()
  const index = favourites.riffCIDs.indexOf(riffCID)
  if (index === -1) {
    favourites.riffCIDs.push(riffCID)
  } else {
    favourites.riffCIDs.splice(index, 1)
  }
  writeFavourites(favourites)
  return favourites.riffCIDs
}
