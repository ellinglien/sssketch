// What the re-oned copies cleanup remembers between launches (decision D9 in the plan), in
// `userData/reonedCopies.json`:
// - the projects outside the library this app opened or saved, with the copy names each named
//   then, so a project on an unplugged drive still protects its copies;
// - when "not now" stops keeping the launch notice quiet.
// Read fresh on every call, as pluginCatalog/appFeaturesStore are. Remembering never fails a save
// or an open: every write is caught and logged. No better-sqlite3 here (the cleanup's tests stay
// off vitest.config.ts's CI exclude list).
//
// A store that exists but can't be read, or isn't what this module writes, may have held the
// only record of a project on an unplugged drive. So it is never overwritten: a corrupt one is
// moved aside to `reonedCopies.corrupt-<time>.json` (the next write starts a fresh store), and
// the cleanup stops (knownProjects() is not ok) while the store is unreadable or any moved-aside
// file is still there. Deleting that file is how someone says it held nothing worth keeping.
import { readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
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

const STORE_FILENAME = 'reonedCopies.json'
const CORRUPT_PREFIX = 'reonedCopies.corrupt-'

function storePath(): string {
  return join(app.getPath('userData'), STORE_FILENAME)
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

/** The parsed store, or null when it isn't exactly what writeStore writes. */
function parseStore(text: string): StoreFile | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const p = parsed as Partial<StoreFile>
  if (p.notNowUntil !== undefined && typeof p.notNowUntil !== 'number') return null
  if (p.knownProjects !== undefined) {
    if (!Array.isArray(p.knownProjects) || !p.knownProjects.every(isKnownProject)) return null
  }
  return {
    version: 1,
    ...(typeof p.notNowUntil === 'number' ? { notNowUntil: p.notNowUntil } : {}),
    knownProjects: p.knownProjects ?? []
  }
}

type StoreRead =
  | { ok: true; store: StoreFile }
  /** `writable`: false when the bad file is still in place, so writing would overwrite it. */
  | { ok: false; path: string; writable: boolean; store: StoreFile }

const EMPTY: StoreFile = { version: 1, knownProjects: [] }

function readStore(): StoreRead {
  const path = storePath()
  let text: string
  try {
    text = readFileSync(path, 'utf-8')
  } catch (err) {
    if ((err as { code?: string } | null)?.code === 'ENOENT') return { ok: true, store: EMPTY }
    console.error(`reonedCopiesStore: could not read ${path}:`, err)
    return { ok: false, path, writable: false, store: EMPTY }
  }
  const store = parseStore(text)
  if (store) return { ok: true, store }
  const aside = join(app.getPath('userData'), `${CORRUPT_PREFIX}${Date.now()}.json`)
  try {
    renameSync(path, aside)
    console.error(`reonedCopiesStore: ${path} is corrupt; moved it to ${aside}`)
    return { ok: false, path: aside, writable: true, store: EMPTY }
  } catch (err) {
    console.error(`reonedCopiesStore: ${path} is corrupt and could not be moved aside:`, err)
    return { ok: false, path, writable: false, store: EMPTY }
  }
}

/** A corrupt store moved aside earlier and not yet deleted, if any. */
function corruptStoreAside(): string | null {
  const dir = app.getPath('userData')
  try {
    const found = readdirSync(dir).find((f) => f.startsWith(CORRUPT_PREFIX))
    return found === undefined ? null : join(dir, found)
  } catch {
    return dir
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

/** Reads the store for a change and writes the result, unless the store on disk is bad and
 * still in place: then nothing is written over it. */
function updateStore(caller: string, change: (store: StoreFile) => StoreFile | null): void {
  try {
    const read = readStore()
    if (!read.ok && !read.writable) return
    const next = change(read.store)
    if (next !== null) writeStore(next, caller)
  } catch (err) {
    console.error(`reonedCopiesStore.${caller} failed:`, err)
  }
}

/** The remembered outside projects, for the cleanup's used set. Not ok (naming the file) while
 * the store can't be trusted: a corrupt or unreadable store, or a corrupt one moved aside and not
 * yet deleted, may have been the only record of a project whose drive is away. */
export function knownProjects():
  { ok: true; projects: KnownProject[] } | { ok: false; path: string } {
  const read = readStore()
  if (!read.ok) return { ok: false, path: read.path }
  const aside = corruptStoreAside()
  if (aside !== null) return { ok: false, path: aside }
  return { ok: true, projects: read.store.knownProjects }
}

/** Records a project outside the library and the copies its text names, newest first, once per
 * path, at most MAX_KNOWN_PROJECTS. */
export function rememberExternalProject(path: string, json: string, at: number = Date.now()): void {
  updateStore('rememberExternalProject', (store) => {
    const names = [...reonedNamesInText(json)]
    const rest = store.knownProjects.filter((p) => p.path !== path)
    return {
      ...store,
      knownProjects: [{ path, names, at }, ...rest].slice(0, MAX_KNOWN_PROJECTS)
    }
  })
}

export function renameKnownProject(oldPath: string, newPath: string): void {
  updateStore('renameKnownProject', (store) => {
    if (!store.knownProjects.some((p) => p.path === oldPath)) return null
    return {
      ...store,
      knownProjects: store.knownProjects
        .filter((p) => p.path !== newPath)
        .map((p) => (p.path === oldPath ? { ...p, path: newPath } : p))
    }
  })
}

export function notNowUntil(): number | null {
  return readStore().store.notNowUntil ?? null
}

/** "not now": the launch notice stays quiet for CLEANUP_NOT_NOW_MS from `now`. */
export function setNotNow(now: number = Date.now()): void {
  updateStore('setNotNow', (store) => ({ ...store, notNowUntil: now + CLEANUP_NOT_NOW_MS }))
}
