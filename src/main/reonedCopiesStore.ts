// What the re-oned copies cleanup remembers between launches (decision D9 in the plan), in
// `userData/reonedCopies.json`:
// - the projects outside the library this app opened or saved, with the copy names each named
//   then, so a project on an unplugged drive still protects its copies;
// - when "not now" stops keeping the launch notice quiet.
// Read fresh on every call, as pluginCatalog/appFeaturesStore are. Remembering never fails a save
// or an open: every write is caught and logged. No better-sqlite3 here (the cleanup's tests stay
// off vitest.config.ts's CI exclude list).
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { CLEANUP_NOT_NOW_MS } from '@shared/reonedCleanup'
import { reonedNamesInText } from '@shared/reonedNames'

export const MAX_KNOWN_PROJECTS = 50

export interface KnownProject {
  path: string
  /** The copy names (`<name>.baked.wav`) the project named when last opened or saved. */
  names: string[]
  at: number
}

interface StoreFile {
  version: 1
  notNowUntil?: number
  knownProjects: KnownProject[]
}

function storePath(): string {
  return join(app.getPath('userData'), 'reonedCopies.json')
}

function isKnownProject(value: unknown): value is KnownProject {
  const p = value as KnownProject | null
  return (
    typeof p?.path === 'string' &&
    Array.isArray(p.names) &&
    p.names.every((n) => typeof n === 'string') &&
    typeof p.at === 'number'
  )
}

function readStore(): StoreFile {
  try {
    const parsed = JSON.parse(readFileSync(storePath(), 'utf-8')) as Partial<StoreFile>
    return {
      version: 1,
      ...(typeof parsed.notNowUntil === 'number' ? { notNowUntil: parsed.notNowUntil } : {}),
      knownProjects: Array.isArray(parsed.knownProjects)
        ? parsed.knownProjects.filter(isKnownProject)
        : []
    }
  } catch {
    // Missing or corrupt: empty. The next write replaces it.
    return { version: 1, knownProjects: [] }
  }
}

function writeStore(next: StoreFile, caller: string): void {
  const path = storePath()
  const temporary = `${path}.${process.pid}.tmp`
  try {
    writeFileSync(temporary, JSON.stringify(next), 'utf-8')
    renameSync(temporary, path)
  } catch (err) {
    console.error(`reonedCopiesStore.${caller}: could not write ${path}:`, err)
  }
}

export function knownProjects(): KnownProject[] {
  return readStore().knownProjects
}

/** Records a project outside the library and the copies its text names, newest first, once per
 * path, at most MAX_KNOWN_PROJECTS. */
export function rememberExternalProject(path: string, json: string, at: number = Date.now()): void {
  try {
    const store = readStore()
    const names = [...reonedNamesInText(json)]
    const rest = store.knownProjects.filter((p) => p.path !== path)
    writeStore(
      {
        ...store,
        knownProjects: [{ path, names, at }, ...rest].slice(0, MAX_KNOWN_PROJECTS)
      },
      'rememberExternalProject'
    )
  } catch (err) {
    console.error('reonedCopiesStore.rememberExternalProject failed:', err)
  }
}

export function renameKnownProject(oldPath: string, newPath: string): void {
  try {
    const store = readStore()
    if (!store.knownProjects.some((p) => p.path === oldPath)) return
    writeStore(
      {
        ...store,
        knownProjects: store.knownProjects
          .filter((p) => p.path !== newPath)
          .map((p) => (p.path === oldPath ? { ...p, path: newPath } : p))
      },
      'renameKnownProject'
    )
  } catch (err) {
    console.error('reonedCopiesStore.renameKnownProject failed:', err)
  }
}

export function notNowUntil(): number | null {
  return readStore().notNowUntil ?? null
}

/** "not now": the launch notice stays quiet for CLEANUP_NOT_NOW_MS from `now`. */
export function setNotNow(now: number = Date.now()): void {
  writeStore({ ...readStore(), notNowUntil: now + CLEANUP_NOT_NOW_MS }, 'setNotNow')
}
