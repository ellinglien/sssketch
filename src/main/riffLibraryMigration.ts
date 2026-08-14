import { existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import { hasStoredRiffLibraryRootOverride } from './riffLibraryStore'
import { ownRiffLibraryRoot } from './riffLibrarySchema'

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
 * once the new location has anything in it (migrated, or a genuinely
 * fresh install), this is a no-op forever after.
 *
 * A whole-directory move (a single renameSync, not a per-file copy) --
 * carries the db3 file AND its WAL/SHM sidecars (see riffLibrarySchema.ts's
 * WAL journal mode) along in one atomic step, so there's never a moment
 * with a db3 at the new path but its WAL sidecar still at the old one.
 * MUST run before anything in this process calls openOwnRiffLibraryDb()
 * for the first time this session -- moving the directory out from under
 * an already-open SQLite connection would corrupt it. Since this moves the
 * ENTIRE old lore-warehouse/ directory (not just its db3 file) in one
 * renameSync, nothing is left behind at the old path afterward -- no
 * separate cleanup step needed, unlike the project library's own migration
 * (which only relocates individual sketch subfolders, leaving
 * <Music>/sssketch/ itself in place as the new shared parent).
 *
 * The whole body is wrapped in a top-level try/catch -- this runs
 * unguarded inside app.whenReady() before any window opens, so an
 * unexpected throw here (e.g. readdirSync/renameSync hitting an unusual
 * permissions or filesystem-state issue) must never be allowed to block
 * app startup; matches projectLibraryMigration.ts's own established
 * pattern. Unlike that migration's own multi-folder loop, this is a single
 * atomic directory move with no partial-failure scenario to worry about --
 * only the "don't let an unexpected throw crash startup" concern applies
 * here. */
export function migrateRiffLibraryLocation(): void {
  try {
    if (hasStoredRiffLibraryRootOverride()) return
    const oldRoot = join(app.getPath('userData'), 'lore-warehouse')
    if (!existsSync(oldRoot)) return

    const newRoot = ownRiffLibraryRoot()
    if (existsSync(newRoot) && readdirSync(newRoot).length > 0) return

    mkdirSync(dirname(newRoot), { recursive: true })
    renameSync(oldRoot, newRoot)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`migrateRiffLibraryLocation: unexpected failure: ${message}`)
  }
}
