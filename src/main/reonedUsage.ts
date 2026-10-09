// Part 3 of the re-oned copies spec: which copies are used, how much is not, and the delete.
// Every project is read as raw text and scanned for copy names in 1 MB slices (decision D7),
// with async I/O only and a turn of the event loop between slices, so the main thread never
// blocks (AGENTS.md section 6). No electron and no better-sqlite3: reonedCopiesIpc.ts passes
// every root in, and this module's test stays off vitest.config.ts's CI exclude list.
import { readdir, readFile, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { CLEANUP_GRACE_MS } from '@shared/reonedCleanup'
import { isReonedCopyFileName, isStaleTempFileName, reonedNamesInText } from '@shared/reonedNames'
import { sessionIssuedNames, withReonedCopiesLock } from './reonedCopiesSession'
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
  /** Copies main handed out this session (reonedCopiesSession.ts). */
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

/** Every .sssketchproj in the library: at its root, each sketch folder's own, and each sketch's
 * .backups. Dot folders at the root (.bakes, .samples-cache) hold no projects. */
async function libraryProjectFiles(root: string): Promise<string[]> {
  const files: string[] = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.sssketchproj')) files.push(join(root, entry.name))
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    for (const sub of [join(root, entry.name), join(root, entry.name, '.backups')]) {
      try {
        for (const f of await readdir(sub)) {
          if (f.endsWith('.sssketchproj')) files.push(join(sub, f))
        }
      } catch (err) {
        if (!isNotFound(err)) throw err
      }
    }
  }
  return files
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
  let libraryFiles: string[]
  try {
    libraryFiles = await libraryProjectFiles(src.libraryRoot)
  } catch {
    return { ok: false, path: src.libraryRoot }
  }
  const required = [...libraryFiles, ...src.userDataFiles]
  for (const path of required) {
    let text: string
    try {
      text = await readFile(path, 'utf-8')
    } catch (err) {
      if (isNotFound(err)) continue // deleted since listing, or no snapshot at all
      return { ok: false, path }
    }
    await scanText(text, used, yieldFn)
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
 * meanwhile. The names handed out this session are read inside the lock, not with the scan: a
 * copy a re-one reused after the scan (and before this got the lock) is then kept. The folder is
 * surveyed again inside the lock too, so the age is checked right before each delete. */
export function cleanBakes(
  bakesDir: string,
  used: ReadonlySet<string>,
  now: number,
  issuedNames: () => Iterable<string> = sessionIssuedNames
): Promise<{ freedBytes: number; deletedCount: number; failedCount: number }> {
  return withReonedCopiesLock(async () => {
    const keep = new Set([...used, ...issuedNames()])
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
