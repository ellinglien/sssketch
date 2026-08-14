import { existsSync, mkdirSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { hasStoredLibraryRootOverride, libraryRootPath } from './projectLibrary'

// Marker written only after a run migrates every candidate it found without
// error -- NOT the same as "newRoot is non-empty", which would wrongly treat
// a partial failure (some folders moved, one renameSync threw) as "fully
// migrated" and strand the rest forever, since sketchDirNames is
// recomputed fresh from oldRoot on every call and a stranded folder would
// otherwise never be reconsidered once anything at all existed at newRoot.
const MIGRATION_MARKER_FILENAME = '.project-library-migration-complete'

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
 * choice untouched. Safe to call on every app startup: once a run migrates
 * everything it found without error, it writes MIGRATION_MARKER_FILENAME
 * into the new root and every later call short-circuits on that marker --
 * this is what makes "new content later added directly under the old root"
 * correctly NOT get swept in after a completed migration. If a run fails
 * partway (a single folder's renameSync throws -- logged and skipped, not
 * fatal), the marker is withheld, so the next startup naturally retries
 * only the folders still actually present at the old root; nothing is
 * merged/overwritten at the new root either way, since a folder that
 * already made it across no longer exists at oldRoot to be re-attempted.
 *
 * A folder directly under the old root counts as a real sketch project
 * only if it contains a `<name>.sssketchproj` matching its own folder
 * name -- the exact same test listLibrarySketches() already uses, which
 * naturally excludes `.samples-cache` and any stray non-sketch folder
 * without needing an explicit denylist. `projects`/`library` themselves
 * are also explicitly excluded, in case this ever runs against a
 * partially-migrated tree. A real MOVE (renameSync per folder), not a
 * copy.
 *
 * The whole body is wrapped in a top-level try/catch -- this runs unguarded
 * inside app.whenReady() alongside other startup work, so an unexpected
 * throw here (e.g. readdirSync failing on a permissions-denied oldRoot)
 * must never be allowed to block the rest of startup or prevent a window
 * from opening; matches libraryRootPath's own established read-and-log
 * convention in projectLibrary.ts. */
export function migrateProjectLibraryLocation(): void {
  try {
    if (hasStoredLibraryRootOverride()) return
    const oldRoot = join(app.getPath('music'), 'sssketch')
    if (!existsSync(oldRoot)) return

    const newRoot = libraryRootPath()
    if (existsSync(join(newRoot, MIGRATION_MARKER_FILENAME))) return

    const entries = readdirSync(oldRoot, { withFileTypes: true })
    const sketchDirNames = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => name !== 'projects' && name !== 'library')
      .filter((name) => existsSync(join(oldRoot, name, `${name}.sssketchproj`)))

    if (sketchDirNames.length === 0) return

    mkdirSync(newRoot, { recursive: true })
    let allSucceeded = true
    for (const name of sketchDirNames) {
      try {
        renameSync(join(oldRoot, name), join(newRoot, name))
      } catch (err) {
        allSucceeded = false
        const message = err instanceof Error ? err.message : String(err)
        console.error(`migrateProjectLibraryLocation: failed to move "${name}": ${message}`)
      }
    }

    if (allSucceeded) {
      writeFileSync(join(newRoot, MIGRATION_MARKER_FILENAME), '')
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`migrateProjectLibraryLocation: unexpected failure: ${message}`)
  }
}
