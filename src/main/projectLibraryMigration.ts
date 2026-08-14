import { existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { hasStoredLibraryRootOverride, libraryRootPath } from './projectLibrary'

/** One-time, idempotent migration of real sketch-project folders off the
 * OLD project-library default (directly in `<Music>/sssketch/`) onto the
 * NEW default (`<Music>/sssketch/projects/`, a sibling of the riff
 * library's own relocated `<Music>/sssketch/library/` -- see
 * riffLibraryMigration.ts and docs/superpowers/specs/
 * 2026-08-14-riff-library-rename-design.md §2). `<Music>/sssketch/` itself
 * is NOT emptied by this -- it becomes the shared parent of both
 * `projects/` and `library/` afterward, so there's nothing left to clean
 * up there.
 *
 * Only ever runs for users relying on the silent default (no explicit
 * libraryPrefs.json override -- see hasStoredLibraryRootOverride): anyone
 * who already pointed their project library elsewhere keeps their own
 * choice untouched. Safe to call on every app startup -- once the new
 * `projects/` folder has anything in it (migrated, or a genuinely fresh
 * install), this is a no-op forever after, and never merges/overwrites
 * into an already-populated new location.
 *
 * A folder directly under the old root counts as a real sketch project
 * only if it contains a `<name>.sssketchproj` matching its own folder
 * name -- the exact same test listLibrarySketches() already uses, which
 * naturally excludes `.samples-cache` and any stray non-sketch folder
 * without needing an explicit denylist. `projects`/`library` themselves
 * are also explicitly excluded, in case this ever runs against a
 * partially-migrated tree. A real MOVE (renameSync per folder), not a
 * copy. */
export function migrateProjectLibraryLocation(): void {
  if (hasStoredLibraryRootOverride()) return
  const oldRoot = join(app.getPath('music'), 'sssketch')
  if (!existsSync(oldRoot)) return

  const newRoot = libraryRootPath()
  if (existsSync(newRoot) && readdirSync(newRoot).length > 0) return

  const entries = readdirSync(oldRoot, { withFileTypes: true })
  const sketchDirNames = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name !== 'projects' && name !== 'library')
    .filter((name) => existsSync(join(oldRoot, name, `${name}.sssketchproj`)))

  if (sketchDirNames.length === 0) return

  mkdirSync(newRoot, { recursive: true })
  for (const name of sketchDirNames) {
    renameSync(join(oldRoot, name), join(newRoot, name))
  }
}
