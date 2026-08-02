import {
  readdirSync,
  statSync,
  openSync,
  readSync,
  closeSync,
  mkdirSync,
  copyFileSync,
  rmSync,
  type Dirent
} from 'fs'
import { join, basename, dirname } from 'path'
import { homedir } from 'os'
import { buildRifff, type ScannedFile } from '@shared/buildRifff'
import type { Rifff } from '@shared/types'

/**
 * Reads just enough of each candidate WAV's header (fmt + data chunk metadata)
 * to compute duration, without reading the whole file's audio payload off disk.
 *
 * readWavDurationSeconds (Task 6) deliberately clamps duration when a chunk's
 * declared size exceeds `bytes.length`, to correctly detect files truncated
 * on disk (see wavDuration.test.ts). That means the returned array's `.length`
 * must reflect the file's *true* size, or every normal file looks "truncated"
 * to that guard purely because we chose not to read all of it. So: allocate a
 * buffer sized to the real file (zero-filled, no disk I/O for that), but only
 * actually read the leading header bytes from disk — the 'data' chunk's
 * declared size field lives in that header; the audio payload itself is never
 * touched.
 */
export function readWavHeaderBytes(path: string): Uint8Array {
  const size = statSync(path).size
  const headerSize = Math.min(size, 4096) // fmt/data chunk headers land well within this
  const fd = openSync(path, 'r')
  try {
    const buf = Buffer.alloc(size)
    readSync(fd, buf, 0, headerSize, 0)
    return new Uint8Array(buf)
  } finally {
    closeSync(fd)
  }
}

export function libraryRoot(): string {
  return join(homedir(), 'Music', 'sssketch Library')
}

/**
 * Accepts the paths handed over by a single drop event: either one folder path
 * (scanned one level deep for .wav files) or one-or-more loose file paths. Every
 * matching .wav is copied into the managed library, grouped into one rifff.
 */
export function importRifff(droppedPaths: string[]): Rifff | null {
  if (droppedPaths.length === 0) return null

  // Tracked outside the try block so a mid-copy failure (disk full, permission
  // revoked partway through, etc.) can clean up whatever was already written —
  // otherwise a fresh crypto.randomUUID() next attempt never points back at a
  // partial copy, and it's orphaned in the library forever.
  let destDir: string | undefined

  try {
    let candidateWavPaths: string[]
    let displayName: string
    let provenancePath: string

    if (droppedPaths.length === 1 && statSync(droppedPaths[0]).isDirectory()) {
      const folderPath = droppedPaths[0]
      const entries = readdirSync(folderPath, { withFileTypes: true })
      candidateWavPaths = entries
        .filter((e) => isUsableFile(e, folderPath) && e.name.toLowerCase().endsWith('.wav'))
        .map((e) => join(folderPath, e.name))
      displayName = basename(folderPath)
      provenancePath = folderPath
    } else {
      candidateWavPaths = droppedPaths.filter((p) => p.toLowerCase().endsWith('.wav'))
      displayName = 'untitled rifff'
      provenancePath = dirname(droppedPaths[0])
    }

    if (candidateWavPaths.length === 0) return null

    const scanned: ScannedFile[] = candidateWavPaths.map((path) => ({
      filename: basename(path),
      path,
      bytes: readWavHeaderBytes(path)
    }))

    const rifff = buildRifff(provenancePath, displayName, scanned)
    if (!rifff) return null

    destDir = join(libraryRoot(), rifff.groupId)
    mkdirSync(destDir, { recursive: true })
    const dir = destDir // narrow to a non-optional local for the closure below

    const copiedStems = rifff.stems.map((stem) => {
      const destPath = join(dir, basename(stem.path))
      copyFileSync(stem.path, destPath)
      return { ...stem, path: destPath }
    })

    return { ...rifff, stems: copiedStems }
  } catch (err) {
    // Permission-denied folder, a path vanishing between drop and processing, disk
    // full mid-copy, etc. — none of these should take down the IPC handler and leave
    // the renderer's `await` hanging on a rejected promise. Log and no-op, matching
    // the existing "can't build a rifff → return null" pattern used elsewhere here.
    const message = err instanceof Error ? err.message : String(err)
    console.error(`importRifff: failed to import from [${droppedPaths.join(', ')}]: ${message}`)
    if (destDir) {
      // A failure after mkdirSync (e.g. mid-copy) can leave a partial rifff folder
      // behind. Since groupId is freshly randomized every call, nothing will ever
      // reference that directory again — clean it up rather than orphaning it.
      try {
        rmSync(destDir, { recursive: true, force: true })
      } catch (cleanupErr) {
        console.error(`importRifff: failed to clean up partial import at ${destDir}:`, cleanupErr)
      }
    }
    return null
  }
}

/**
 * `Dirent.isFile()` reflects the raw directory-entry type and is `false` for a
 * symlink entry even when it resolves to a regular file — a documented Node
 * gotcha. Follow symlinks with `statSync` so a symlinked stem isn't silently
 * dropped; a broken symlink (dangling target) is treated as not usable.
 */
function isUsableFile(entry: Dirent, folderPath: string): boolean {
  if (entry.isFile()) return true
  if (entry.isSymbolicLink()) {
    try {
      return statSync(join(folderPath, entry.name)).isFile()
    } catch {
      return false
    }
  }
  return false
}
