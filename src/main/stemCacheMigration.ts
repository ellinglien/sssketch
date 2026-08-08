import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  renameSync,
  symlinkSync,
  unlinkSync
} from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

const OLD_SOURCES: ('shared' | 'jam')[] = ['shared', 'jam']

function stemsRoot(): string {
  return join(app.getPath('userData'), 'endlesss-cache', 'stems')
}

function oldSourceDir(source: 'shared' | 'jam'): string {
  return join(stemsRoot(), source)
}

function newStemPath(stemCID: string): string {
  return join(stemsRoot(), stemCID.slice(0, 1), stemCID)
}

/**
 * One-time, idempotent migration off the old source-partitioned stem cache
 * (endlesss-cache/stems/<shared|jam>/<riffCID>/<stemCID>) onto the new
 * content-addressed one (endlesss-cache/stems/<stemCID[0]>/<stemCID>) -- see
 * docs/superpowers/specs/2026-08-08-endlesss-cache-disk-efficiency-design.md.
 *
 * For every real file still sitting under the old trees: moves it to its
 * new content-addressed path, or -- if that path is already occupied (the
 * SAME stemCID already migrated from the other source: a true duplicate) --
 * deletes this copy instead. Either way, leaves a symlink at the old path
 * pointing at the new one. The symlink matters: a stem's path can already
 * be baked as a literal string into a saved .sssketchproj project file, and
 * a plain move+delete would silently break playback for any such project.
 *
 * Skips anything already migrated -- checked via lstatSync (not existsSync)
 * so a symlink is recognized as "already done" without following it, making
 * a second run on every app startup a fast no-op scan once migration has
 * actually happened, with no separate "did this already run" marker file
 * needed. Also discards stale `.downloading` leftovers from an interrupted
 * download (see downloadOneEndlesssStem in endlesssApi.ts) rather than
 * migrating one as if it were a real stemCID.
 */
export function migrateEndlesssStemCache(): void {
  for (const source of OLD_SOURCES) {
    const sourceDir = oldSourceDir(source)
    if (!existsSync(sourceDir)) continue
    for (const riffCID of readdirSync(sourceDir)) {
      const riffDir = join(sourceDir, riffCID)
      if (!lstatSync(riffDir).isDirectory()) continue
      for (const entryName of readdirSync(riffDir)) {
        const oldPath = join(riffDir, entryName)
        if (lstatSync(oldPath).isSymbolicLink()) continue
        if (entryName.endsWith('.downloading')) {
          unlinkSync(oldPath)
          continue
        }
        const stemCID = entryName
        const newPath = newStemPath(stemCID)
        if (existsSync(newPath)) {
          unlinkSync(oldPath)
        } else {
          mkdirSync(join(stemsRoot(), stemCID.slice(0, 1)), { recursive: true })
          renameSync(oldPath, newPath)
        }
        symlinkSync(newPath, oldPath)
      }
    }
  }
}
