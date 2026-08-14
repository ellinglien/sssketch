import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import { hasStoredRiffLibraryRootOverride } from './riffLibraryStore'
import { ownRiffLibraryDbPath, ownRiffLibraryRoot } from './riffLibrarySchema'

/** One-time, idempotent migration of sssketch's own riff-sync database off
 * its OLD default location (hidden inside `<userData>/lore-warehouse/`,
 * the literal pre-rename path -- ownRiffLibraryRoot() itself already
 * returns the NEW location by the time this runs, so the old one is
 * hardcoded here, same convention as stemCacheMigration.ts's own
 * OLD_SOURCES) onto the NEW default (`<Music>/sssketch/library/`, a
 * visible sibling of the project library's own relocated
 * `<Music>/sssketch/projects/` -- see projectLibraryMigration.ts and
 * docs/superpowers/specs/2026-08-14-riff-library-rename-design.md §2).
 *
 * Only ever runs for users relying on the silent default (no explicit
 * riffLibraryPrefs.json override -- see hasStoredRiffLibraryRootOverride):
 * anyone who already pointed sssketch at a real external LORE archive
 * keeps their own choice untouched. Safe to call on every app startup --
 * once the new location actually contains a riff library (its own db3
 * file, checked below -- NOT merely "the folder is non-empty"), this is a
 * no-op forever after. The db3-specific check matters because
 * projectLibraryMigration.ts deliberately excludes any sketch folder
 * literally named "library" or "projects" from its own move (to avoid
 * colliding with these sibling folder names) -- if a user happens to have
 * a real sketch named "library", it stays put at exactly this migration's
 * new root, and a bare "is anything there at all" check would have
 * mistaken that sketch's own files for an already-migrated riff library
 * and permanently skipped this migration.
 *
 * Prefers a single whole-directory renameSync (not a per-file copy) --
 * carries the db3 file AND its WAL/SHM sidecars (see riffLibrarySchema.ts's
 * WAL journal mode) along in one atomic step, so there's never a moment
 * with a db3 at the new path but its WAL sidecar still at the old one.
 * `renameSync` can't target an already-existing non-empty directory,
 * though (POSIX rename semantics) -- if newRoot already exists (the
 * "library"-named-sketch collision described above), falls back to moving
 * the old root's immediate children into the existing newRoot one at a
 * time instead; cache/common/'s db3 and its WAL sidecar are still
 * SIBLINGS within that one child move, so they still land together. MUST
 * run before anything in this process calls openOwnRiffLibraryDb() for the
 * first time this session -- moving the directory (or its contents) out
 * from under an already-open SQLite connection would corrupt it. Either
 * path empties/removes the old lore-warehouse/ directory entirely -- no
 * separate cleanup step needed, unlike the project library's own migration
 * (which only relocates individual sketch subfolders, leaving
 * <Music>/sssketch/ itself in place as the new shared parent).
 *
 * The whole body is wrapped in a top-level try/catch -- this runs
 * unguarded inside app.whenReady() before any window opens, so an
 * unexpected throw here (e.g. readdirSync/renameSync hitting an unusual
 * permissions or filesystem-state issue) must never be allowed to block
 * app startup; matches projectLibraryMigration.ts's own established
 * pattern. */
export function migrateRiffLibraryLocation(): void {
  try {
    if (hasStoredRiffLibraryRootOverride()) return
    const oldRoot = join(app.getPath('userData'), 'lore-warehouse')
    if (!existsSync(oldRoot)) return

    const newRoot = ownRiffLibraryRoot()
    if (existsSync(ownRiffLibraryDbPath())) return

    if (!existsSync(newRoot)) {
      mkdirSync(dirname(newRoot), { recursive: true })
      renameSync(oldRoot, newRoot)
      return
    }

    // newRoot already exists (per the doc comment above, almost certainly
    // an unrelated sketch folder the project-library migration deliberately
    // left in place) but doesn't contain a riff library yet -- merge the
    // old root's contents into it child by child instead of renaming the
    // container itself.
    for (const entry of readdirSync(oldRoot)) {
      renameSync(join(oldRoot, entry), join(newRoot, entry))
    }
    rmSync(oldRoot, { recursive: true, force: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`migrateRiffLibraryLocation: unexpected failure: ${message}`)
  }
}
