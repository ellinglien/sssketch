import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { LoreResolvedRiff, LoreRiffSummary, RiffPage } from '@shared/loreLibrary'

/** One fully-synced riff: both its listing summary (for instant paging) and
 * its fully-resolved detail (for instant preview/import) -- see
 * docs/superpowers/specs/2026-08-07-endlesss-stem-reliability-design.md's
 * Part B for why both are kept rather than just one. `resolved.stems[].path`
 * is whatever the sync actually achieved -- null for a stem that's
 * permanently undownloadable (FLAC-only) or exhausted its retries; a riff
 * still counts as synced either way, it just won't have every stem
 * playable. Re-syncing does not currently retry a previously-synced riff's
 * failed stems (v1 scope trim, see the spec's own non-goals). */
export interface SyncedRiffEntry {
  summary: LoreRiffSummary
  resolved: LoreResolvedRiff
}

export interface SyncIndexFile {
  updatedAt: number // unix ms
  // True only once a sync walk has actually reached the true end of the
  // feed/jam (the live API returned hasMore: false) at least once -- stays
  // true across later incremental (stop-early-at-the-boundary) syncs,
  // since anything already indexed extends back to a confirmed-complete
  // boundary. Drives sliceSyncedPage's hasMore calculation at the edge of
  // synced content.
  complete: boolean
  order: string[] // riffCIDs, newest-first -- paging is just a slice of this
  riffs: Record<string, SyncedRiffEntry>
}

function emptyIndex(): SyncIndexFile {
  return { updatedAt: 0, complete: false, order: [], riffs: {} }
}

// Filesystem-safe: usernames/jamIds shouldn't contain anything exotic, but
// this is cheap insurance against path traversal or invalid filename
// characters rather than trusting external input in a path.
function sanitizeIndexKey(key: string): string {
  return key.replace(/[^A-Za-z0-9_-]/g, '_')
}

function syncIndexPath(source: 'shared' | 'jam', key: string): string {
  return join(
    app.getPath('userData'),
    'endlesss-cache',
    'sync-index',
    `${source}-${sanitizeIndexKey(key)}.json`
  )
}

/** Never throws -- a missing or corrupt index just means "nothing synced
 * yet," matching this module's sibling endlesssApi.ts's own convention for
 * local persisted state (see its loadPersistedSession). */
export function loadSyncIndex(source: 'shared' | 'jam', key: string): SyncIndexFile | null {
  const path = syncIndexPath(source, key)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as SyncIndexFile
  } catch (err) {
    console.error(`endlesssSyncIndex: failed to load sync index ${path}:`, err)
    return null
  }
}

/** Writes via a `.tmp` sibling then renames into place -- same kill-safe
 * pattern as endlesssApi.ts's own stem-download write. */
export function saveSyncIndex(source: 'shared' | 'jam', key: string, index: SyncIndexFile): void {
  const path = syncIndexPath(source, key)
  mkdirSync(dirname(path), { recursive: true })
  const tmpPath = `${path}.tmp`
  writeFileSync(tmpPath, JSON.stringify(index))
  renameSync(tmpPath, path)
}

/** Loads the index if present, or a fresh empty one if not -- the shape a
 * sync run always wants to start from. */
export function loadOrCreateSyncIndex(source: 'shared' | 'jam', key: string): SyncIndexFile {
  return loadSyncIndex(source, key) ?? emptyIndex()
}

export interface SyncStatus {
  riffCount: number
  updatedAt: number
  complete: boolean
}

export function getSyncStatus(source: 'shared' | 'jam', key: string): SyncStatus | null {
  const index = loadSyncIndex(source, key)
  if (!index) return null
  return { riffCount: index.order.length, updatedAt: index.updatedAt, complete: index.complete }
}

/** Serves a listing page purely from the local index, matching
 * listSharedFeed/listRiffsInJam's own RiffPage shape -- or returns null if
 * the requested [offset, offset+count) range isn't fully covered by what's
 * synced AND we can't be sure that's the true end (index.complete is
 * false), meaning the caller should fall back to a live fetch instead of
 * risking a falsely-truncated page. See the design spec's own note on this
 * boundary tradeoff (a v1 simplification: paginating past the synced
 * portion always does one live round trip rather than trying to splice
 * live+local results together). When index.complete IS true, though, a
 * short/overflowing count is never "falsely" truncated -- a sync that
 * reached the real end of the feed/jam has already established there's
 * nothing beyond order.length, so it's served as-is (fewer riffs than
 * asked for, exactly like the live endpoints' own end-of-results shape). */
export function sliceSyncedPage(
  index: SyncIndexFile,
  offset: number,
  count: number
): RiffPage | null {
  if (offset + count > index.order.length && !index.complete) return null
  const slice = index.order.slice(offset, offset + count)
  return {
    riffs: slice.map((riffCID) => index.riffs[riffCID].summary),
    hasMore: offset + slice.length < index.order.length || !index.complete,
    nextOffset: offset + slice.length
  }
}

/** Serves one riff's full resolved detail purely from the local index, or
 * null if it isn't (yet) synced. */
export function sliceSyncedRiff(index: SyncIndexFile, riffCID: string): LoreResolvedRiff | null {
  return index.riffs[riffCID]?.resolved ?? null
}
