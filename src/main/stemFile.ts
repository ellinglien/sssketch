// src/main/stemFile.ts
import { statSync } from 'node:fs'

/** Whether a stem's audio is really on disk: the file exists, is a file,
 * and has bytes in it. Existence alone is not enough -- a 0-byte
 * placeholder from an unfinished LORE download (2,361 of them in Elling's
 * archive, 2026-10-01) exists but is not audio, and must go through the
 * download like a missing file does.
 *
 * One stat per call: use it where ONE stem is about to be loaded, played,
 * stretched, analysed or downloaded. Bulk listings (discoverLibraryStems.ts)
 * deliberately use one readdirSync per folder instead -- don't put this in
 * a per-stem loop over a whole library. Never throws. */
export function isUsableStemFile(path: string): boolean {
  try {
    const stat = statSync(path)
    return stat.isFile() && stat.size > 0
  } catch {
    return false
  }
}
