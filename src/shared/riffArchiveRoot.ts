// src/shared/riffArchiveRoot.ts -- which folder the user meant when pointing at a LORE archive.
//
// Share readiness S7 (2026-10-07). A LORE (OUROVEON) archive's root is the folder holding
// cache/common/warehouse.db3 (riffLibraryStore.ts). Picking `cache`, `common`, another folder
// inside the root, or the folder above it used to save that folder as-is and then say "riff
// archive not found". Now the pick snaps to the root when one is near, or says what to pick.
// Pure: the filesystem is passed in (riffLibraryStore.ts uses the real one).

export const ARCHIVE_DB_RELATIVE = 'cache/common/warehouse.db3'

export type RiffArchivePick =
  | { ok: true; root: string }
  | { ok: false; reason: 'none' }
  | { ok: false; reason: 'several'; roots: string[] }

export interface ArchiveFs {
  exists: (path: string) => boolean
  /** Names of the folder's direct subfolders (empty when unreadable). */
  childDirs: (path: string) => string[]
}

function trimSlash(p: string): string {
  return p.length > 1 ? p.replace(/\/+$/, '') : p
}

function parentOf(p: string): string | null {
  const i = p.lastIndexOf('/')
  if (i <= 0) return p === '/' ? null : '/'
  return p.slice(0, i)
}

function join(a: string, b: string): string {
  return a.endsWith('/') ? a + b : `${a}/${b}`
}

/** In order: the pick itself; up to three levels up (from `common`, `cache`, or any folder inside
 * the root); then one level down (the folder above the root). */
export function findRiffArchiveRoot(picked: string, fs: ArchiveFs): RiffArchivePick {
  const isRoot = (p: string): boolean => fs.exists(join(p, ARCHIVE_DB_RELATIVE))
  const start = trimSlash(picked)
  let p: string | null = start
  for (let up = 0; up <= 3 && p !== null; up++) {
    if (isRoot(p)) return { ok: true, root: p }
    p = parentOf(p)
  }
  const below = fs
    .childDirs(start)
    .map((name) => join(start, name))
    .filter(isRoot)
  if (below.length === 1) return { ok: true, root: below[0] }
  if (below.length > 1) return { ok: false, reason: 'several', roots: below }
  return { ok: false, reason: 'none' }
}

/** What to tell the user when a pick finds no single archive. */
export function riffArchivePickMessage(
  pick: Extract<RiffArchivePick, { ok: false }>,
  picked: string
): string {
  if (pick.reason === 'several') {
    const names = pick.roots.map((r) => r.slice(r.lastIndexOf('/') + 1)).join(', ')
    return `more than one LORE archive in ${picked} (${names}). pick one of them.`
  }
  return `no LORE archive in ${picked}. pick the folder that holds ${ARCHIVE_DB_RELATIVE}.`
}
