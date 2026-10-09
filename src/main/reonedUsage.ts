// Part 3 of the re-oned copies spec: which copies are used, how much is not, and the delete.
// Every project is read as raw text and scanned for copy names in 1 MB slices (decision D7),
// with async I/O only and a turn of the event loop between slices, so the main thread never
// blocks (AGENTS.md section 6). No electron and no better-sqlite3: reonedCopiesIpc.ts passes
// every root in, and this module's test stays off vitest.config.ts's CI exclude list.
import type { Dirent } from 'node:fs'
import { readdir, readFile, realpath, stat, unlink } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { CLEANUP_GRACE_MS } from '@shared/reonedCleanup'
import { isReonedCopyFileName, isStaleTempFileName, reonedNamesInText } from '@shared/reonedNames'
import { sessionKeptNames, withReonedCopiesLock } from './reonedCopiesSession'
import type { KnownProject } from './reonedCopiesStore'

const SLICE_CHARS = 1_000_000
/** Longer than any copy name, so a name cut by a slice boundary is found whole in one slice. */
const OVERLAP_CHARS = 128

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

export interface UsedNameSources {
  libraryRoot: string
  /** The autosave and its aside snapshot. Missing is fine; unreadable stops the pass. */
  userDataFiles: string[]
  /** Projects outside the library: read when reachable, else their remembered names count. */
  knownProjects: KnownProject[]
  /** What the renderer holds: the open project, its undo history, Cross and Discover. */
  inMemoryNames: Iterable<string>
  /** Copies main handed out this session, and copies named by a project it handed out or wrote
   * (reonedCopiesSession.ts's sessionKeptNames). */
  sessionIssued: Iterable<string>
}

export type UsedScan = { ok: true; used: Set<string> } | { ok: false; path: string }

const isNotFound = (err: unknown): boolean => (err as { code?: string } | null)?.code === 'ENOENT'

async function scanText(
  text: string,
  into: Set<string>,
  yieldFn: () => Promise<void>
): Promise<void> {
  for (let start = 0; start < text.length; start += SLICE_CHARS) {
    reonedNamesInText(text.slice(start, start + SLICE_CHARS + OVERLAP_CHARS), into)
    await yieldFn()
  }
}

/** Folders the walk never enters. The app's own caches hold audio, never a project:
 * `.bakes` (re-oned copies) and `.samples-cache` (export samples, projectLibrary.ts). The rest are
 * macOS's own bookkeeping at a volume's root, which can't be listed and would stop every pass for
 * a library kept at the top of a drive. */
const SKIPPED_FOLDERS = new Set([
  '.bakes',
  '.samples-cache',
  '.Trashes',
  '.Spotlight-V100',
  '.fseventsd',
  '.TemporaryItems',
  '.DocumentRevisions-V100'
])

const isProjectFileName = (name: string): boolean => name.toLowerCase().endsWith('.sssketchproj')

/** True when the library walk below reads `path`: under `root`, outside every skipped folder,
 * and a project file name or in a `.backups` folder. projectFile.ts remembers any project this
 * says false for (reonedCopiesStore.ts), so the two can never disagree. Lexical, as the walk's
 * paths are: a symlinked folder under the root counts as inside. */
export function isReadByLibraryWalk(path: string, root: string): boolean {
  const rel = relative(resolve(root), resolve(path))
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return false
  const parts = rel.split(sep)
  const fileName = parts.pop() as string
  if (parts.some((part) => SKIPPED_FOLDERS.has(part))) return false
  return isProjectFileName(fileName) || parts.at(-1) === '.backups'
}

type LibraryListing = { ok: true; files: string[] } | { ok: false; path: string }

/** Every project file anywhere under the library root, as projectFile.ts's isInsideLibrary sees
 * it (any path under the root counts as a library project, so it is never remembered on its
 * own): every `.sssketchproj` at any depth, dot-named folders included, and every file in any
 * `.backups` folder. Symlinked folders are followed; each real folder is walked once, so a link
 * back up the tree ends. Stops (ok: false, naming it) at a folder that can't be listed, or a
 * symlink whose target is away: either may hold projects whose copies would then be deleted.
 * Async, with a turn of the event loop after each folder. */
async function libraryProjectFiles(
  root: string,
  yieldFn: () => Promise<void>
): Promise<LibraryListing> {
  const files: string[] = []
  const walked = new Set<string>()
  const pending: string[] = [root]
  while (pending.length > 0) {
    const folder = pending.pop() as string
    let entries: Dirent[]
    try {
      const real = await realpath(folder)
      if (walked.has(real)) continue
      walked.add(real)
      entries = await readdir(folder, { withFileTypes: true })
    } catch (err) {
      // The root itself must be there; a subfolder removed since its parent was listed is fine.
      if (folder !== root && isNotFound(err)) continue
      return { ok: false, path: folder }
    }
    const inBackups = basename(folder) === '.backups'
    for (const entry of entries) {
      const path = join(folder, entry.name)
      let isDirectory = entry.isDirectory()
      let isFile = entry.isFile()
      if (entry.isSymbolicLink()) {
        try {
          const target = await stat(path)
          isDirectory = target.isDirectory()
          isFile = target.isFile()
        } catch {
          return { ok: false, path }
        }
      }
      if (isDirectory) {
        if (!SKIPPED_FOLDERS.has(entry.name)) pending.push(path)
      } else if (isFile && (inBackups || isProjectFileName(entry.name))) {
        files.push(path)
      }
    }
    await yieldFn()
  }
  return { ok: true, files }
}

/** Every copy name any project, snapshot or session names. Stops (ok: false) at a library
 * project, backup or snapshot that exists but can't be read (decision D10): cleaning without it
 * could delete what it names. */
export async function collectUsedNames(
  src: UsedNameSources,
  yieldFn: () => Promise<void> = yieldToEventLoop
): Promise<UsedScan> {
  const used = new Set<string>([...src.inMemoryNames, ...src.sessionIssued])
  for (const p of src.knownProjects) for (const n of p.names) used.add(n)
  // A required file: missing is fine (deleted since listing, or no snapshot at all), unreadable
  // stops the pass.
  const scanRequired = async (path: string): Promise<boolean> => {
    let text: string
    try {
      text = await readFile(path, 'utf-8')
    } catch (err) {
      return isNotFound(err)
    }
    await scanText(text, used, yieldFn)
    return true
  }
  // The recovery files first: a recover deletes the autosave, so read it before the library's
  // slow walk gives one the chance (the session's project names cover a recover even earlier).
  for (const path of src.userDataFiles) {
    if (!(await scanRequired(path))) return { ok: false, path }
  }
  const library = await libraryProjectFiles(src.libraryRoot, yieldFn)
  if (!library.ok) return library
  for (const path of library.files) {
    if (!(await scanRequired(path))) return { ok: false, path }
  }
  for (const { path } of src.knownProjects) {
    let text: string
    try {
      text = await readFile(path, 'utf-8')
    } catch {
      continue // unplugged or gone: its remembered names already count
    }
    await scanText(text, used, yieldFn)
  }
  return { ok: true, used }
}

export interface BakesFile {
  name: string
  size: number
  mtimeMs: number
}

/** The files in `.bakes` that can go: copies no one names, and stale bake temporaries (a crash
 * mid-bake, decision D11), each more than a day old. Anything else in the folder is left alone. */
export async function surveyBakes(
  bakesDir: string,
  used: ReadonlySet<string>,
  now: number
): Promise<{ unused: BakesFile[]; unusedBytes: number }> {
  let names: string[]
  try {
    names = await readdir(bakesDir)
  } catch (err) {
    if (isNotFound(err)) return { unused: [], unusedBytes: 0 }
    throw err
  }
  const unused: BakesFile[] = []
  for (const name of names) {
    const candidate = isStaleTempFileName(name) || (isReonedCopyFileName(name) && !used.has(name))
    if (!candidate) continue
    try {
      const info = await stat(join(bakesDir, name))
      if (info.isFile() && now - info.mtimeMs >= CLEANUP_GRACE_MS) {
        unused.push({ name, size: info.size, mtimeMs: info.mtimeMs })
      }
    } catch {
      // gone meanwhile
    }
  }
  return { unused, unusedBytes: unused.reduce((sum, f) => sum + f.size, 0) }
}

/** Deletes the unused files, under the `.bakes` lock, so no bake can publish or hand out a copy
 * meanwhile. This session's names (copies handed out, and copies named by any project opened,
 * recovered or saved) are read inside the lock, not with the scan: a copy a re-one reused, or a
 * project that reached the renderer, after the scan started (and before this got the lock) is
 * then kept. The folder is surveyed again inside the lock too, so the age is checked right
 * before each delete. */
export function cleanBakes(
  bakesDir: string,
  used: ReadonlySet<string>,
  now: number,
  sessionNames: () => Iterable<string> = sessionKeptNames
): Promise<{ freedBytes: number; deletedCount: number; failedCount: number }> {
  return withReonedCopiesLock(async () => {
    const keep = new Set([...used, ...sessionNames()])
    const { unused } = await surveyBakes(bakesDir, keep, now)
    let freedBytes = 0
    let deletedCount = 0
    let failedCount = 0
    for (const file of unused) {
      try {
        await unlink(join(bakesDir, file.name))
        freedBytes += file.size
        deletedCount++
      } catch (err) {
        if (!isNotFound(err)) failedCount++
      }
      await yieldToEventLoop()
    }
    return { freedBytes, deletedCount, failedCount }
  })
}
