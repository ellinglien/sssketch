# Endlesss Direct: Ahead-of-Time Local Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the account's own shared feed and private jam(s) LORE-parity "instant" playback by
building a scoped-down local sync (walk the feed/jam to completion once, cache riff metadata +
resolved detail + stem audio locally), while leaving the existing on-demand path completely intact
as the fallback for anything not yet synced.

**Architecture:** Three new/changed main-process pieces. `endlesssSyncIndex.ts` (new, no
dependency on `endlesssApi.ts`) owns a per-source flat JSON index file (riff summaries + full
resolved detail, keyed by riffCID) plus pure read helpers. `endlesssApi.ts` (existing) grows a
thin "check the local index first" fast path in its four read functions
(`listSharedFeed`/`resolveSharedFeedRiff`/`listRiffsInJam`/`resolveJamRiff`) — transparent to
every existing caller, falling through to the exact same live-fetch behavior when nothing's
synced yet. `endlesssSync.ts` (new) is the actual sync orchestrator: walks a source to the newest
already-indexed riff (or the true end), resolves everything new through a concurrency-capped
worker pool reusing the existing (already retry/URL-fixed) resolve functions, and persists
incrementally so an interrupted sync resumes cleanly. IPC + a renderer trigger button/progress
UI round it out. Explicit, opt-in trigger only — never automatic — per direct confirmation.

**Tech Stack:** TypeScript, Node `fs` (flat JSON files, no new DB dependency), Vitest with
`vi.mock('electron')` narrow-mocking (matching this codebase's established main-process test
convention), Electron IPC (`ipcMain.handle` / `event.sender.send` push events, matching the
existing `scan-plugins`/`scan-progress` pattern exactly).

---

## Context for the implementer

Read `docs/superpowers/specs/2026-08-07-endlesss-stem-reliability-design.md` in full before
starting — specifically Part B ("Ahead-of-Time Local Sync") and the Grounding section above it,
which cites the real OUROVEON source this design is modeled on. Part A of that spec (stem
download retry, URL reconstruction, matching CDN headers) is **already implemented and shipped**
in `src/main/endlesssApi.ts` — this plan builds on top of it, doesn't touch it again.

The existing direct-Endlesss feature this plan extends is itself documented in
`docs/superpowers/specs/2026-08-07-endlesss-direct-import-design.md`. Read
`src/main/endlesssApi.ts` in full before touching it — it's ~900 lines and this plan's Task 2
modifies four specific functions inside it (`listSharedFeed`, `resolveSharedFeedRiff`,
`listRiffsInJam`, `resolveJamRiff`) without touching anything else in the file.

**Scope discipline, repeated because it matters**: this syncs exactly two sources — the logged-in
account's own shared feed, and its own private jam(s) (already narrowed to real personal jams via
`isPersonalJamName` in the renderer). Never anything wider. Never automatic — every sync run is
triggered by an explicit button click in the UI, confirmed directly with Elling.

---

### Task 1: `endlesssSyncIndex.ts` — index types, storage, and pure read helpers

**Files:**
- Create: `src/main/endlesssSyncIndex.ts`
- Test: `src/main/endlesssSyncIndex.test.ts`

This file has **no dependency on `endlesssApi.ts`** — it's pure JSON-file I/O plus the query
helpers that slice a loaded index into the same `RiffPage`/`LoreResolvedRiff` shapes the rest of
the app already uses. This is what breaks what would otherwise be a circular import between
`endlesssApi.ts` (needs to read the index) and `endlesssSync.ts` (needs to write it, and calls
into `endlesssApi.ts`'s own listing/resolve functions to do so).

- [ ] **Step 1: Write the failing tests**

```typescript
// src/main/endlesssSyncIndex.test.ts
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LoreResolvedRiff, LoreRiffSummary } from '@shared/loreLibrary'

let userDataDir: string

vi.mock('electron', () => ({
  app: {
    getPath: () => userDataDir
  }
}))

beforeEach(() => {
  userDataDir = mkdtempSync(join(tmpdir(), 'sssketch-sync-index-test-'))
})

afterEach(() => {
  rmSync(userDataDir, { recursive: true, force: true })
})

function fakeSummary(riffCID: string): LoreRiffSummary {
  return {
    riffCID,
    creationTime: 1700000000,
    bpm: 120,
    barLength: 4,
    userName: 'elling',
    stemCount: 1,
    cachedStemCount: 1,
    ownerFraction: 1
  }
}

function fakeResolved(riffCID: string): LoreResolvedRiff {
  return { riffCID, bpm: 120, barLength: 4, stems: [] }
}

describe('endlesssSyncIndex', () => {
  it('loadSyncIndex returns null when no file exists yet', async () => {
    const { loadSyncIndex } = await import('./endlesssSyncIndex')
    expect(loadSyncIndex('shared', 'elling')).toBeNull()
  })

  it('loadSyncIndex returns null (never throws) on corrupt JSON', async () => {
    const { loadSyncIndex, saveSyncIndex } = await import('./endlesssSyncIndex')
    saveSyncIndex('shared', 'elling', { updatedAt: 1, complete: false, order: [], riffs: {} })
    const path = join(userDataDir, 'endlesss-cache', 'sync-index', 'shared-elling.json')
    writeFileSync(path, 'not json{{{')
    expect(loadSyncIndex('shared', 'elling')).toBeNull()
  })

  it('saveSyncIndex then loadSyncIndex round-trips exactly', async () => {
    const { loadSyncIndex, saveSyncIndex } = await import('./endlesssSyncIndex')
    const index = {
      updatedAt: 123,
      complete: true,
      order: ['riff_1', 'riff_2'],
      riffs: {
        riff_1: { summary: fakeSummary('riff_1'), resolved: fakeResolved('riff_1') },
        riff_2: { summary: fakeSummary('riff_2'), resolved: fakeResolved('riff_2') }
      }
    }
    saveSyncIndex('shared', 'elling', index)
    expect(loadSyncIndex('shared', 'elling')).toEqual(index)
  })

  it('sanitizes the key so an unsafe username still produces a valid, working path', async () => {
    const { saveSyncIndex, loadSyncIndex } = await import('./endlesssSyncIndex')
    saveSyncIndex('shared', 'weird/../name', {
      updatedAt: 1,
      complete: false,
      order: [],
      riffs: {}
    })
    expect(loadSyncIndex('shared', 'weird/../name')).not.toBeNull()
  })

  it('loadOrCreateSyncIndex returns a fresh empty index when nothing is saved yet', async () => {
    const { loadOrCreateSyncIndex } = await import('./endlesssSyncIndex')
    expect(loadOrCreateSyncIndex('jam', 'jam_abc')).toEqual({
      updatedAt: 0,
      complete: false,
      order: [],
      riffs: {}
    })
  })

  it('getSyncStatus returns null when nothing has been synced', async () => {
    const { getSyncStatus } = await import('./endlesssSyncIndex')
    expect(getSyncStatus('jam', 'jam_abc')).toBeNull()
  })

  it('getSyncStatus reports riffCount/updatedAt/complete from a saved index', async () => {
    const { saveSyncIndex, getSyncStatus } = await import('./endlesssSyncIndex')
    saveSyncIndex('jam', 'jam_abc', {
      updatedAt: 555,
      complete: true,
      order: ['riff_1'],
      riffs: { riff_1: { summary: fakeSummary('riff_1'), resolved: fakeResolved('riff_1') } }
    })
    expect(getSyncStatus('jam', 'jam_abc')).toEqual({
      riffCount: 1,
      updatedAt: 555,
      complete: true
    })
  })

  it('sliceSyncedPage returns a page when the requested range is fully covered', async () => {
    const { sliceSyncedPage } = await import('./endlesssSyncIndex')
    const index = {
      updatedAt: 1,
      complete: false,
      order: ['riff_1', 'riff_2', 'riff_3'],
      riffs: {
        riff_1: { summary: fakeSummary('riff_1'), resolved: fakeResolved('riff_1') },
        riff_2: { summary: fakeSummary('riff_2'), resolved: fakeResolved('riff_2') },
        riff_3: { summary: fakeSummary('riff_3'), resolved: fakeResolved('riff_3') }
      }
    }
    const page = sliceSyncedPage(index, 0, 2)
    expect(page).not.toBeNull()
    expect(page!.riffs.map((r) => r.riffCID)).toEqual(['riff_1', 'riff_2'])
    expect(page!.hasMore).toBe(true)
    expect(page!.nextOffset).toBe(2)
  })

  it('sliceSyncedPage returns null when the requested range exceeds what is synced', async () => {
    const { sliceSyncedPage } = await import('./endlesssSyncIndex')
    const index = {
      updatedAt: 1,
      complete: false,
      order: ['riff_1'],
      riffs: { riff_1: { summary: fakeSummary('riff_1'), resolved: fakeResolved('riff_1') } }
    }
    expect(sliceSyncedPage(index, 0, 5)).toBeNull()
  })

  it('sliceSyncedPage at the exact synced boundary reports hasMore based on `complete`', async () => {
    const { sliceSyncedPage } = await import('./endlesssSyncIndex')
    const index = {
      updatedAt: 1,
      complete: false,
      order: ['riff_1'],
      riffs: { riff_1: { summary: fakeSummary('riff_1'), resolved: fakeResolved('riff_1') } }
    }
    expect(sliceSyncedPage(index, 0, 1)!.hasMore).toBe(true)
    index.complete = true
    expect(sliceSyncedPage(index, 0, 1)!.hasMore).toBe(false)
  })

  it('sliceSyncedRiff returns resolved detail for a synced riff, null for an unsynced one', async () => {
    const { sliceSyncedRiff } = await import('./endlesssSyncIndex')
    const index = {
      updatedAt: 1,
      complete: false,
      order: ['riff_1'],
      riffs: { riff_1: { summary: fakeSummary('riff_1'), resolved: fakeResolved('riff_1') } }
    }
    expect(sliceSyncedRiff(index, 'riff_1')).toEqual(fakeResolved('riff_1'))
    expect(sliceSyncedRiff(index, 'riff_never_synced')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/main/endlesssSyncIndex.test.ts`
Expected: FAIL — `Cannot find module './endlesssSyncIndex'`

- [ ] **Step 3: Implement `endlesssSyncIndex.ts`**

```typescript
// src/main/endlesssSyncIndex.ts
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
 * synced, meaning the caller should fall back to a live fetch instead of
 * risking a falsely-truncated page. See the design spec's own note on this
 * boundary tradeoff (a v1 simplification: paginating past the synced
 * portion always does one live round trip rather than trying to splice
 * live+local results together). */
export function sliceSyncedPage(
  index: SyncIndexFile,
  offset: number,
  count: number
): RiffPage | null {
  if (offset + count > index.order.length) return null
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/main/endlesssSyncIndex.test.ts`
Expected: PASS, 11 tests

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/main/endlesssSyncIndex.ts src/main/endlesssSyncIndex.test.ts
git commit -m "Add endlesssSyncIndex.ts: local sync-index storage and read helpers"
```

---

### Task 2: `endlesssApi.ts` — fast-path integration for the four read functions

**Files:**
- Modify: `src/main/endlesssApi.ts:500-571` (`listSharedFeed`), `:697-744` (`listRiffsInJam`),
  `:804-` (`resolveJamRiff`) — read the current file first, these line numbers will have shifted
  slightly by the time this task runs since Task 1 doesn't touch this file but earlier work this
  session already has.
- Test: `src/main/endlesssApi.test.ts` (append a new `describe` block)

`resolveSharedFeedRiff` needs **no code change** — it already resolves purely from the in-memory
`sharedFeedCache` map, and `listSharedFeed`'s fast path (below) populates that same cache from the
synced index, so resolution "just works" once listing has run. This is deliberately simpler than
adding a parallel fast path to every function.

- [ ] **Step 1: Add the import**

At the top of `src/main/endlesssApi.ts`, alongside the existing `@shared/loreLibrary` import:

```typescript
import { loadSyncIndex, sliceSyncedPage, sliceSyncedRiff } from './endlesssSyncIndex'
```

- [ ] **Step 2: Write the failing tests**

Append to `src/main/endlesssApi.test.ts` (needs `mkdtempSync`/`rmSync`/`tmpdir`/`join`, already
imported at the top of that file for other `describe` blocks):

```typescript
describe('endlesssApi sync-index fast paths', () => {
  let userDataDir: string

  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'sssketch-endlesss-test-'))
    ;(globalThis as unknown as { __testUserDataDir: string }).__testUserDataDir = userDataDir
    vi.resetModules()
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
  })

  function fakeSharedEntry() {
    return {
      summary: {
        riffCID: 'riff_1',
        creationTime: 1700000000,
        bpm: 120,
        barLength: 4,
        userName: 'elling',
        stemCount: 0,
        cachedStemCount: 0,
        ownerFraction: 1
      },
      resolved: { riffCID: 'riff_1', bpm: 120, barLength: 4, stems: [] }
    }
  }

  it('listSharedFeed serves a page from a synced index without any network call', async () => {
    const { saveSyncIndex } = await import('./endlesssSyncIndex')
    saveSyncIndex('shared', 'elling', {
      updatedAt: 1,
      complete: true,
      order: ['riff_1'],
      riffs: { riff_1: fakeSharedEntry() }
    })
    const { listSharedFeed } = await import('./endlesssApi')
    const fakeFetch = vi.fn()
    const page = await listSharedFeed('elling', 0, 30, fakeFetch as unknown as typeof fetch)
    expect(page.riffs).toHaveLength(1)
    expect(page.riffs[0].riffCID).toBe('riff_1')
    expect(fakeFetch).not.toHaveBeenCalled()
  })

  it('listSharedFeed falls through to a live fetch when the index does not cover the requested range', async () => {
    const { saveSyncIndex } = await import('./endlesssSyncIndex')
    saveSyncIndex('shared', 'elling', { updatedAt: 1, complete: false, order: [], riffs: {} })
    const { listSharedFeed } = await import('./endlesssApi')
    const fakeFetch = vi.fn(
      async () => new Response(JSON.stringify({ data: [] }), { status: 200 })
    )
    await listSharedFeed('elling', 0, 30, fakeFetch as unknown as typeof fetch)
    expect(fakeFetch).toHaveBeenCalledTimes(1)
  })

  it('resolveSharedFeedRiff resolves a synced riff via the cache listSharedFeed warmed, with no network call', async () => {
    const { saveSyncIndex } = await import('./endlesssSyncIndex')
    saveSyncIndex('shared', 'elling', {
      updatedAt: 1,
      complete: true,
      order: ['riff_1'],
      riffs: { riff_1: fakeSharedEntry() }
    })
    const { listSharedFeed, resolveSharedFeedRiff } = await import('./endlesssApi')
    const fakeFetch = vi.fn()
    await listSharedFeed('elling', 0, 30, fakeFetch as unknown as typeof fetch)
    const resolved = await resolveSharedFeedRiff('riff_1', fakeFetch as unknown as typeof fetch)
    expect(resolved).not.toBeNull()
    expect(resolved!.riffCID).toBe('riff_1')
    expect(fakeFetch).not.toHaveBeenCalled()
  })

  function fakeJamEntry() {
    return {
      summary: {
        riffCID: 'riff_1',
        creationTime: 1700000000,
        bpm: 0,
        barLength: 0,
        userName: '',
        stemCount: 0,
        cachedStemCount: 0,
        ownerFraction: 0
      },
      resolved: { riffCID: 'riff_1', bpm: 0, barLength: 0, stems: [] }
    }
  }

  it('listRiffsInJam serves a page from a synced index without any network call', async () => {
    const { saveSyncIndex } = await import('./endlesssSyncIndex')
    saveSyncIndex('jam', 'jam_abc', {
      updatedAt: 1,
      complete: true,
      order: ['riff_1'],
      riffs: { riff_1: fakeJamEntry() }
    })
    const { listRiffsInJam } = await import('./endlesssApi')
    const fakeFetch = vi.fn()
    const page = await listRiffsInJam('jam_abc', {}, fakeFetch as unknown as typeof fetch)
    expect(page.riffs).toHaveLength(1)
    expect(fakeFetch).not.toHaveBeenCalled()
  })

  it('resolveJamRiff resolves a synced riff from the index without any network call or login', async () => {
    const { saveSyncIndex } = await import('./endlesssSyncIndex')
    saveSyncIndex('jam', 'jam_abc', {
      updatedAt: 1,
      complete: true,
      order: ['riff_1'],
      riffs: { riff_1: fakeJamEntry() }
    })
    const { resolveJamRiff } = await import('./endlesssApi')
    const fakeFetch = vi.fn()
    const resolved = await resolveJamRiff('jam_abc', 'riff_1', fakeFetch as unknown as typeof fetch)
    expect(resolved).not.toBeNull()
    expect(fakeFetch).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/main/endlesssApi.test.ts`
Expected: the 5 new tests FAIL (no fast path exists yet), all previously-existing tests still PASS

- [ ] **Step 4: Add the fast path to `listSharedFeed`**

Find the start of the function body (right after the JSDoc comment, before `const session =
activeSession()`) and insert:

```typescript
export async function listSharedFeed(
  userName: string,
  offset: number,
  count: number,
  fetchImpl: FetchLike = fetch
): Promise<RiffPage> {
  const syncIndex = loadSyncIndex('shared', userName)
  if (syncIndex) {
    const syncedPage = sliceSyncedPage(syncIndex, offset, count)
    if (syncedPage) {
      // Warm sharedFeedCache from the WHOLE synced index (not just this
      // page) so resolveSharedFeedRiff can resolve any riff currently
      // rendered from a synced page, not just the very last one fetched --
      // strictly better than the live path's own "only the last page is
      // resolvable" limitation, and free since the index is already loaded
      // into memory to slice it.
      const newCache = new Map<string, LoreResolvedRiff>()
      for (const riffCID of syncIndex.order) {
        newCache.set(riffCID, syncIndex.riffs[riffCID].resolved)
      }
      sharedFeedCache = newCache
      return syncedPage
    }
  }

  const session = activeSession()
  // ...rest of the existing function body is unchanged from here down
```

- [ ] **Step 5: Add the fast path to `listRiffsInJam`**

The existing function currently computes `offset` before its early `if (!session)` return, but
`limit` only afterward. Move the `limit` computation up so both are available for the fast-path
check, then insert the check right after:

```typescript
export async function listRiffsInJam(
  jamId: string,
  filters: RiffFilters,
  fetchImpl: FetchLike = fetch
): Promise<RiffPage> {
  const offset = filters.offset ?? 0
  const limit = filters.limit ?? DEFAULT_RIFF_PAGE_SIZE

  const syncIndex = loadSyncIndex('jam', jamId)
  if (syncIndex) {
    const syncedPage = sliceSyncedPage(syncIndex, offset, limit)
    if (syncedPage) return syncedPage
  }

  const session = activeSession()
  if (!session) return { riffs: [], hasMore: false, nextOffset: offset }

  // ...rest of the existing function body is unchanged from here down,
  // EXCEPT remove the now-duplicate `const limit = filters.limit ?? DEFAULT_RIFF_PAGE_SIZE`
  // line that used to appear after the session check
```

- [ ] **Step 6: Add the fast path to `resolveJamRiff`**

Insert before the existing `const session = activeSession()` line. Deliberately checked *before*
requiring login — a riff that's already fully synced to disk doesn't need a live session to view,
which is a nice side benefit (works even if the stored session has expired):

```typescript
export async function resolveJamRiff(
  jamId: string,
  riffCID: string,
  fetchImpl: FetchLike = fetch
): Promise<LoreResolvedRiff | null> {
  const syncIndex = loadSyncIndex('jam', jamId)
  if (syncIndex) {
    const synced = sliceSyncedRiff(syncIndex, riffCID)
    if (synced) return synced
  }

  const session = activeSession()
  // ...rest of the existing function body is unchanged from here down
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/main/endlesssApi.test.ts`
Expected: PASS, all tests (previously-existing plus the 5 new ones)

- [ ] **Step 8: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors

- [ ] **Step 9: Commit**

```bash
git add src/main/endlesssApi.ts src/main/endlesssApi.test.ts
git commit -m "endlesssApi: serve listing/resolve from the local sync index when available"
```

---

### Task 3: `endlesssSync.ts` — concurrency-capped worker pool

**Files:**
- Create: `src/main/endlesssSync.ts`
- Test: `src/main/endlesssSync.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/main/endlesssSync.test.ts
import { describe, expect, it, vi } from 'vitest'

describe('runWithConcurrency', () => {
  it('calls the worker exactly once for every item', async () => {
    const { runWithConcurrency } = await import('./endlesssSync')
    const seen: number[] = []
    await runWithConcurrency([1, 2, 3, 4, 5], 2, async (item) => {
      seen.push(item)
    })
    expect(seen.slice().sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5])
  })

  it('never runs more than `limit` workers concurrently', async () => {
    const { runWithConcurrency } = await import('./endlesssSync')
    let inFlight = 0
    let maxInFlight = 0
    await runWithConcurrency(
      Array.from({ length: 10 }, (_, i) => i),
      3,
      async () => {
        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 5))
        inFlight--
      }
    )
    expect(maxInFlight).toBeLessThanOrEqual(3)
  })

  it('handles an empty item list without error', async () => {
    const { runWithConcurrency } = await import('./endlesssSync')
    const worker = vi.fn()
    await runWithConcurrency([], 3, worker)
    expect(worker).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/main/endlesssSync.test.ts`
Expected: FAIL — `Cannot find module './endlesssSync'`

- [ ] **Step 3: Implement `runWithConcurrency`**

```typescript
// src/main/endlesssSync.ts

/** Runs `worker` over every item in `items`, with at most `limit` calls in
 * flight at once -- a small fixed-size worker pool, not a full queue
 * library. Each of `limit` "lanes" pulls the next unclaimed item off a
 * shared cursor until the list is exhausted. Roughly matches OUROVEON's
 * own per-riff stem-download parallelism (its 8-stems-per-riff cap,
 * further bounded by a shared thread pool) -- see the design spec's
 * Grounding section. Exists specifically because uncapped background
 * fetching already caused one real "competes with foreground clicks"
 * regression this session (see EndlesssLibraryBrowser.tsx's own
 * ownershipInFlightRef) -- a sync run touching hundreds of riffs needs
 * this discipline even more than that did. */
export async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let cursor = 0
  async function lane(): Promise<void> {
    while (cursor < items.length) {
      const item = items[cursor++]
      await worker(item)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => lane()))
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/main/endlesssSync.test.ts`
Expected: PASS, 3 tests

- [ ] **Step 5: Commit**

```bash
git add src/main/endlesssSync.ts src/main/endlesssSync.test.ts
git commit -m "Add runWithConcurrency: fixed-size worker pool for endlesssSync.ts"
```

---

### Task 4: `endlesssSync.ts` — `syncSharedFeed`

**Files:**
- Modify: `src/main/endlesssSync.ts` (append)
- Test: `src/main/endlesssSync.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

First, update the single `import ... from 'vitest'` line at the top of
`src/main/endlesssSync.test.ts` (from Task 3) to also pull in `beforeEach`/`afterEach`:

```typescript
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
```

Then add these new imports directly below it (new lines, not a second `from 'vitest'` statement):

```typescript
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
```

Then append the rest to the bottom of the file:

```typescript
vi.mock('electron', () => ({
  app: {
    getPath: () => (globalThis as unknown as { __testUserDataDir: string }).__testUserDataDir,
    getVersion: () => '0.0.0-test'
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString()
  }
}))

function sharedFeedEntry(riffCID: string, stemCID: string): Record<string, unknown> {
  return {
    _id: `shared_${riffCID}`,
    doc_id: riffCID,
    action_timestamp: 1700000000000,
    rifff: {
      _id: riffCID,
      state: {
        bps: 2.0,
        barLength: 4,
        playback: [
          { slot: { current: { on: true, currentLoop: stemCID, gain: 1 } } },
          ...Array.from({ length: 7 }, () => ({ slot: {} }))
        ]
      },
      userName: 'elling',
      created: 1700000000000,
      root: 0,
      scale: 5
    },
    loops: [
      {
        _id: stemCID,
        cdn_attachments: {
          oggAudio: {
            endpoint: 'ndls-att0.fra1.digitaloceanspaces.com',
            key: `attachments/oggAudio/1/${stemCID}`,
            url: `https://ndls-att0.fra1.digitaloceanspaces.com/attachments/oggAudio/1/${stemCID}`,
            length: 100
          }
        },
        bps: 2.0,
        length16ths: 64,
        presetName: 'Kick',
        creatorUserName: 'elling'
      },
      null,
      null,
      null,
      null,
      null,
      null,
      null
    ]
  }
}

describe('syncSharedFeed', () => {
  let userDataDir: string

  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'sssketch-sync-test-'))
    ;(globalThis as unknown as { __testUserDataDir: string }).__testUserDataDir = userDataDir
    vi.resetModules()
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('syncs every new riff on a first-ever run and marks the index complete', async () => {
    const audioBytes = new TextEncoder().encode('fake ogg bytes')
    const fakeFetch = vi.fn(async (url: string) => {
      if (url.includes('shared_by')) {
        return new Response(
          JSON.stringify({
            data: [sharedFeedEntry('riff_1', 'stem_1'), sharedFeedEntry('riff_2', 'stem_2')]
          }),
          { status: 200 }
        )
      }
      return new Response(audioBytes, { status: 200 })
    })
    const { syncSharedFeed } = await import('./endlesssSync')
    const progressCalls: { done: number; total: number }[] = []
    await syncSharedFeed(
      'elling',
      (p) => progressCalls.push({ ...p }),
      fakeFetch as unknown as typeof fetch
    )

    const { loadSyncIndex } = await import('./endlesssSyncIndex')
    const index = loadSyncIndex('shared', 'elling')
    expect(index).not.toBeNull()
    expect(index!.order).toEqual(['riff_1', 'riff_2'])
    expect(index!.complete).toBe(true)
    expect(index!.riffs.riff_1.resolved.stems[0].path).not.toBeNull()
    expect(progressCalls[progressCalls.length - 1]).toEqual({ done: 2, total: 2 })
  })

  it('a second sync run only processes riffs newer than what is already indexed', async () => {
    const audioBytes = new TextEncoder().encode('fake ogg bytes')
    let feedCallCount = 0
    const fakeFetch = vi.fn(async (url: string) => {
      if (url.includes('shared_by')) {
        feedCallCount++
        return new Response(JSON.stringify({ data: [sharedFeedEntry('riff_1', 'stem_1')] }), {
          status: 200
        })
      }
      return new Response(audioBytes, { status: 200 })
    })
    const { syncSharedFeed } = await import('./endlesssSync')
    await syncSharedFeed('elling', () => {}, fakeFetch as unknown as typeof fetch)
    const firstFeedCallCount = feedCallCount

    const progressCalls: { done: number; total: number }[] = []
    await syncSharedFeed(
      'elling',
      (p) => progressCalls.push({ ...p }),
      fakeFetch as unknown as typeof fetch
    )
    expect(progressCalls).toEqual([{ done: 0, total: 0 }])
    // One more listing call to discover "nothing new since last time" --
    // but zero additional resolve/download calls, since nothing new was found.
    expect(feedCallCount).toBe(firstFeedCallCount + 1)
  })

  it('does not start a second sync for the same userName while one is already running', async () => {
    let releaseGate: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve
    })
    let feedCallCount = 0
    const fakeFetch = vi.fn(async (url: string) => {
      if (url.includes('shared_by')) {
        feedCallCount++
        await gate
        return new Response(JSON.stringify({ data: [] }), { status: 200 })
      }
      return new Response(new Uint8Array(), { status: 200 })
    })
    const { syncSharedFeed } = await import('./endlesssSync')
    const first = syncSharedFeed('elling', () => {}, fakeFetch as unknown as typeof fetch)
    const second = syncSharedFeed('elling', () => {}, fakeFetch as unknown as typeof fetch)
    await second
    expect(feedCallCount).toBe(1)
    releaseGate!()
    await first
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/main/endlesssSync.test.ts`
Expected: FAIL — `syncSharedFeed` is not exported

- [ ] **Step 3: Implement `syncSharedFeed`**

Append to `src/main/endlesssSync.ts`:

```typescript
import { listSharedFeed, resolveSharedFeedRiff } from './endlesssApi'
import type { FetchLike } from './endlesssApi'
import { loadOrCreateSyncIndex, saveSyncIndex } from './endlesssSyncIndex'
import type { LoreRiffSummary } from '@shared/loreLibrary'

export interface SyncProgress {
  done: number
  total: number
}

const SYNC_CONCURRENCY = 3
const SYNC_SHARED_FEED_PAGE_SIZE = 100

// Prevents two overlapping sync runs for the same source+key -- e.g.
// double-clicking the sync button, or clicking it again while a prior run
// is still going. Keyed the same way the sync index file itself is.
const syncsInFlight = new Set<string>()

/** Walks the account's own shared feed from the front (newest first,
 * matching listSharedFeed's own order) until either the live API says
 * there's nothing more, or a riff already present in the local sync index
 * is reached -- the second condition is what makes a REPEAT sync fast,
 * since it only ever has to walk past genuinely new content. Newly
 * discovered riffs are resolved (full stem download included, reusing
 * resolveSharedFeedRiff exactly as the on-demand path already does --
 * retries, URL reconstruction, and headers all included) through a
 * concurrency-capped pool, with each riff's resolved detail saved to the
 * index as soon as it completes so an interrupted sync resumes cleanly
 * next time. No-ops if a sync for this exact userName is already running.
 *
 * Note: since listSharedFeed itself now has a sync-index fast path (see
 * endlesssApi.ts), the walk phase above transparently benefits from
 * whatever's already synced on a repeat/resumed run -- pages fully within
 * the already-known range serve instantly with no network call, and only
 * the genuinely new boundary triggers a live fetch. This is intentional,
 * not a coincidence to work around. */
export async function syncSharedFeed(
  userName: string,
  onProgress: (progress: SyncProgress) => void,
  fetchImpl: FetchLike = fetch
): Promise<void> {
  const key = `shared:${userName}`
  if (syncsInFlight.has(key)) return
  syncsInFlight.add(key)
  try {
    const index = loadOrCreateSyncIndex('shared', userName)
    const alreadySynced = new Set(Object.keys(index.riffs))

    const newSummaries: LoreRiffSummary[] = []
    let offset = 0
    let reachedEnd = false
    for (;;) {
      const page = await listSharedFeed(userName, offset, SYNC_SHARED_FEED_PAGE_SIZE, fetchImpl)
      let hitBoundary = false
      for (const summary of page.riffs) {
        if (alreadySynced.has(summary.riffCID)) {
          hitBoundary = true
          break
        }
        newSummaries.push(summary)
      }
      if (hitBoundary) break
      if (!page.hasMore) {
        reachedEnd = true
        break
      }
      offset = page.nextOffset
    }

    let done = 0
    const total = newSummaries.length
    onProgress({ done, total })
    await runWithConcurrency(newSummaries, SYNC_CONCURRENCY, async (summary) => {
      const resolved = await resolveSharedFeedRiff(summary.riffCID, fetchImpl)
      if (resolved) {
        index.riffs[summary.riffCID] = { summary, resolved }
        index.updatedAt = Date.now()
        saveSyncIndex('shared', userName, index)
      }
      done++
      onProgress({ done, total })
    })

    // Deterministic newest-first order, applied once at the end in the
    // original walk order -- individual index.riffs[...] entries above
    // already persisted incrementally per-riff for resumability; `order`
    // is just the display sequence and doesn't need that same
    // per-riff granularity (concurrent workers completing in
    // nondeterministic order would otherwise make a per-riff unshift here
    // produce a nondeterministic order).
    const newlySyncedInOrder = newSummaries
      .filter((s) => index.riffs[s.riffCID] !== undefined)
      .map((s) => s.riffCID)
    index.order = [...newlySyncedInOrder, ...index.order]
    if (reachedEnd) index.complete = true
    index.updatedAt = Date.now()
    saveSyncIndex('shared', userName, index)
  } finally {
    syncsInFlight.delete(key)
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/main/endlesssSync.test.ts`
Expected: PASS, all tests (the 3 from Task 3 plus the 3 new `syncSharedFeed` ones)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors. (This project's tsconfig has `noUnusedLocals`/`noUnusedParameters` on, so
only import exactly `listSharedFeed`/`resolveSharedFeedRiff` here, not `listRiffsInJam`/
`resolveJamRiff` yet — those get added to the same import line in Task 5, once `syncJam` actually
uses them.)

- [ ] **Step 6: Commit**

```bash
git add src/main/endlesssSync.ts src/main/endlesssSync.test.ts
git commit -m "Add syncSharedFeed: ahead-of-time sync for the account's own shared feed"
```

---

### Task 5: `endlesssSync.ts` — `syncJam`

**Files:**
- Modify: `src/main/endlesssSync.ts` (append)
- Test: `src/main/endlesssSync.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `src/main/endlesssSync.test.ts`:

```typescript
describe('syncJam', () => {
  let userDataDir: string

  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'sssketch-sync-test-'))
    ;(globalThis as unknown as { __testUserDataDir: string }).__testUserDataDir = userDataDir
    vi.resetModules()
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
  })

  async function loggedIn(): Promise<void> {
    const { loginWithCredentials } = await import('./endlesssApi')
    await loginWithCredentials(
      'elling',
      'hunter2',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              token: 't',
              password: 'p',
              user_id: 'u1',
              expires: Date.now() + 1000 * 60 * 60 * 24
            }),
            { status: 200 }
          )
      ) as unknown as typeof fetch
    )
  }

  function jamFakeFetch(audioBytes: Uint8Array): ReturnType<typeof vi.fn> {
    return vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('rifffLoopsByCreateTime')) {
        return new Response(
          JSON.stringify({
            total_rows: 1,
            rows: [{ id: 'riff_1', key: 1700000000000, value: ['stem_1'] }]
          }),
          { status: 200 }
        )
      }
      if (url.includes('_all_docs') && JSON.parse(init!.body as string).keys[0] === 'riff_1') {
        return new Response(
          JSON.stringify({
            total_rows: 1,
            rows: [
              {
                id: 'riff_1',
                doc: {
                  _id: 'riff_1',
                  state: {
                    bps: 2.0,
                    barLength: 4,
                    playback: [
                      { slot: { current: { on: true, currentLoop: 'stem_1', gain: 1 } } },
                      ...Array.from({ length: 7 }, () => ({ slot: {} }))
                    ]
                  },
                  userName: 'elling',
                  created: 1700000000000,
                  root: 0,
                  scale: 5
                }
              }
            ]
          }),
          { status: 200 }
        )
      }
      if (url.includes('_all_docs')) {
        return new Response(
          JSON.stringify({
            total_rows: 1,
            rows: [
              {
                id: 'stem_1',
                doc: {
                  _id: 'stem_1',
                  cdn_attachments: {
                    oggAudio: {
                      endpoint: 'ndls-att0.fra1.digitaloceanspaces.com',
                      key: 'attachments/oggAudio/1/stem_1',
                      url: 'https://ndls-att0.fra1.digitaloceanspaces.com/attachments/oggAudio/1/stem_1',
                      length: 100
                    }
                  },
                  bps: 2.0,
                  length16ths: 64,
                  presetName: 'Kick',
                  creatorUserName: 'elling'
                }
              }
            ]
          }),
          { status: 200 }
        )
      }
      return new Response(audioBytes, { status: 200 })
    })
  }

  it('syncs every new riff in a jam on a first-ever run and marks the index complete', async () => {
    await loggedIn()
    const fakeFetch = jamFakeFetch(new TextEncoder().encode('fake ogg bytes'))
    const { syncJam } = await import('./endlesssSync')
    const progressCalls: { done: number; total: number }[] = []
    await syncJam(
      'jam_abc',
      (p) => progressCalls.push({ ...p }),
      fakeFetch as unknown as typeof fetch
    )

    const { loadSyncIndex } = await import('./endlesssSyncIndex')
    const index = loadSyncIndex('jam', 'jam_abc')
    expect(index).not.toBeNull()
    expect(index!.order).toEqual(['riff_1'])
    expect(index!.complete).toBe(true)
    expect(index!.riffs.riff_1.resolved.stems[0].path).not.toBeNull()
    expect(progressCalls[progressCalls.length - 1]).toEqual({ done: 1, total: 1 })
  })

  it('does not start a second sync for the same jamId while one is already running', async () => {
    await loggedIn()
    let releaseGate: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve
    })
    let listCallCount = 0
    const fakeFetch = vi.fn(async (url: string) => {
      if (url.includes('rifffLoopsByCreateTime')) {
        listCallCount++
        await gate
        return new Response(JSON.stringify({ total_rows: 0, rows: [] }), { status: 200 })
      }
      return new Response(new Uint8Array(), { status: 200 })
    })
    const { syncJam } = await import('./endlesssSync')
    const first = syncJam('jam_abc', () => {}, fakeFetch as unknown as typeof fetch)
    const second = syncJam('jam_abc', () => {}, fakeFetch as unknown as typeof fetch)
    await second
    expect(listCallCount).toBe(1)
    releaseGate!()
    await first
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/main/endlesssSync.test.ts`
Expected: FAIL — `syncJam` is not exported

- [ ] **Step 3: Implement `syncJam`**

First, update the import line at the top of `src/main/endlesssSync.ts` (added in Task 4) to also
pull in `listRiffsInJam`/`resolveJamRiff`, which `syncJam` needs:

```typescript
import { listSharedFeed, listRiffsInJam, resolveSharedFeedRiff, resolveJamRiff } from './endlesssApi'
```

Then append to `src/main/endlesssSync.ts`:

```typescript
const SYNC_JAM_PAGE_SIZE = 200 // matches DEFAULT_RIFF_PAGE_SIZE in endlesssApi.ts

/** Same shape as syncSharedFeed, walking a private jam via listRiffsInJam/
 * resolveJamRiff instead. See syncSharedFeed's own doc comment for the
 * full rationale (incremental resume, concurrency cap, why the walk phase
 * also benefits from listRiffsInJam's own sync-index fast path). */
export async function syncJam(
  jamId: string,
  onProgress: (progress: SyncProgress) => void,
  fetchImpl: FetchLike = fetch
): Promise<void> {
  const key = `jam:${jamId}`
  if (syncsInFlight.has(key)) return
  syncsInFlight.add(key)
  try {
    const index = loadOrCreateSyncIndex('jam', jamId)
    const alreadySynced = new Set(Object.keys(index.riffs))

    const newSummaries: LoreRiffSummary[] = []
    let offset = 0
    let reachedEnd = false
    for (;;) {
      const page = await listRiffsInJam(jamId, { offset, limit: SYNC_JAM_PAGE_SIZE }, fetchImpl)
      let hitBoundary = false
      for (const summary of page.riffs) {
        if (alreadySynced.has(summary.riffCID)) {
          hitBoundary = true
          break
        }
        newSummaries.push(summary)
      }
      if (hitBoundary) break
      if (!page.hasMore) {
        reachedEnd = true
        break
      }
      offset = page.nextOffset
    }

    let done = 0
    const total = newSummaries.length
    onProgress({ done, total })
    await runWithConcurrency(newSummaries, SYNC_CONCURRENCY, async (summary) => {
      const resolved = await resolveJamRiff(jamId, summary.riffCID, fetchImpl)
      if (resolved) {
        index.riffs[summary.riffCID] = { summary, resolved }
        index.updatedAt = Date.now()
        saveSyncIndex('jam', jamId, index)
      }
      done++
      onProgress({ done, total })
    })

    const newlySyncedInOrder = newSummaries
      .filter((s) => index.riffs[s.riffCID] !== undefined)
      .map((s) => s.riffCID)
    index.order = [...newlySyncedInOrder, ...index.order]
    if (reachedEnd) index.complete = true
    index.updatedAt = Date.now()
    saveSyncIndex('jam', jamId, index)
  } finally {
    syncsInFlight.delete(key)
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/main/endlesssSync.test.ts`
Expected: PASS, all tests

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/main/endlesssSync.ts src/main/endlesssSync.test.ts
git commit -m "Add syncJam: ahead-of-time sync for the account's own private jam(s)"
```

---

### Task 6: IPC handlers + preload bridge

**Files:**
- Modify: `src/main/index.ts` (imports near the top + handlers near the existing `endlesss-*`
  block)
- Modify: `src/preload/index.ts` (bridge methods near the existing `endlesss*` block)

No dedicated test file for this task — IPC wiring isn't unit-tested elsewhere in this codebase
either (verified via typecheck + the manual walkthrough in Task 8), matching how every prior
`endlesss-*` channel was added.

- [ ] **Step 1: Add imports to `src/main/index.ts`**

Alongside the existing import from `./endlesssApi`:

```typescript
import { syncSharedFeed, syncJam } from './endlesssSync'
import { getSyncStatus } from './endlesssSyncIndex'
```

- [ ] **Step 2: Register the four new IPC handlers**

Immediately after the existing `endlesss-list-riff-ownership` handler:

```typescript
  ipcMain.handle('endlesss-start-sync-shared-feed', (event, userName: string) =>
    syncSharedFeed(userName, (progress) => {
      event.sender.send('endlesss-sync-progress', {
        source: 'shared' as const,
        key: userName,
        ...progress
      })
    })
  )
  ipcMain.handle('endlesss-start-sync-jam', (event, jamId: string) =>
    syncJam(jamId, (progress) => {
      event.sender.send('endlesss-sync-progress', {
        source: 'jam' as const,
        key: jamId,
        ...progress
      })
    })
  )
  ipcMain.handle('endlesss-sync-status-shared-feed', (_event, userName: string) =>
    getSyncStatus('shared', userName)
  )
  ipcMain.handle('endlesss-sync-status-jam', (_event, jamId: string) =>
    getSyncStatus('jam', jamId)
  )
```

This matches the exact `event.sender.send(...)` push-progress pattern the existing
`scan-plugins`/`scan-progress` channel already uses (`src/main/index.ts`, search for
`'scan-plugins'` to see it) — the `invoke` call itself resolves only once the whole sync
completes, with progress streamed via the separate push channel meanwhile.

- [ ] **Step 3: Add preload bridge methods**

In `src/preload/index.ts`, immediately after the existing `endlesssListRiffOwnership` method,
and following the exact `onScanProgress` shape already in that file for the push-event method:

```typescript
  endlesssStartSyncSharedFeed: (userName: string): Promise<void> =>
    ipcRenderer.invoke('endlesss-start-sync-shared-feed', userName),
  endlesssStartSyncJam: (jamId: string): Promise<void> =>
    ipcRenderer.invoke('endlesss-start-sync-jam', jamId),
  endlesssSyncStatusSharedFeed: (
    userName: string
  ): Promise<{ riffCount: number; updatedAt: number; complete: boolean } | null> =>
    ipcRenderer.invoke('endlesss-sync-status-shared-feed', userName),
  endlesssSyncStatusJam: (
    jamId: string
  ): Promise<{ riffCount: number; updatedAt: number; complete: boolean } | null> =>
    ipcRenderer.invoke('endlesss-sync-status-jam', jamId),
  onEndlesssSyncProgress: (
    callback: (progress: {
      source: 'shared' | 'jam'
      key: string
      done: number
      total: number
    }) => void
  ): (() => void) => {
    const listener = (
      _event: unknown,
      progress: { source: 'shared' | 'jam'; key: string; done: number; total: number }
    ): void => callback(progress)
    ipcRenderer.on('endlesss-sync-progress', listener)
    return () => ipcRenderer.removeListener('endlesss-sync-progress', listener)
  },
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/main/index.ts src/preload/index.ts
git commit -m "Wire up IPC + preload bridge for ahead-of-time sync start/status/progress"
```

---

### Task 7: `EndlesssLibraryBrowser.tsx` — sync trigger buttons + progress/status UI

**Files:**
- Modify: `src/renderer/src/components/EndlesssLibraryBrowser.tsx`

No dedicated test — React components in this codebase are verified via typecheck + lint + manual
walkthrough by convention (see CLAUDE.md's Testing Conventions section), not unit-tested
directly.

- [ ] **Step 1: Add sync status/progress state**

Near the other `useState`/`useRef` declarations at the top of the component body:

```typescript
  const [feedSyncStatus, setFeedSyncStatus] = useState<{
    riffCount: number
    updatedAt: number
    complete: boolean
  } | null>(null)
  const [jamSyncStatus, setJamSyncStatus] = useState<{
    riffCount: number
    updatedAt: number
    complete: boolean
  } | null>(null)
  // { done, total } while a sync for the CURRENTLY relevant source/jam is
  // running, null otherwise. Filtered from the broadcast onEndlesssSyncProgress
  // stream (which covers every source, not just whichever this component
  // cares about right now) down to just shared-feed and the selected jam.
  const [feedSyncProgress, setFeedSyncProgress] = useState<{ done: number; total: number } | null>(
    null
  )
  const [jamSyncProgress, setJamSyncProgress] = useState<{ done: number; total: number } | null>(
    null
  )
```

- [ ] **Step 2: Subscribe to sync progress on mount**

Add a new effect, near the other top-level effects:

```typescript
  useEffect(() => {
    return window.rifffApi.onEndlesssSyncProgress((progress) => {
      if (progress.source === 'shared' && progress.key === effectiveUsername) {
        setFeedSyncProgress({ done: progress.done, total: progress.total })
        if (progress.done === progress.total) {
          void window.rifffApi
            .endlesssSyncStatusSharedFeed(effectiveUsername)
            .then(setFeedSyncStatus)
        }
      }
      if (progress.source === 'jam' && progress.key === selectedJamCID) {
        setJamSyncProgress({ done: progress.done, total: progress.total })
        if (progress.done === progress.total && selectedJamCID) {
          void window.rifffApi.endlesssSyncStatusJam(selectedJamCID).then(setJamSyncStatus)
        }
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- effectiveUsername/selectedJamCID intentionally excluded so this subscription is set up once; the callback reads their latest values via closure since it's re-created fresh each render but the subscription itself doesn't need to be torn down and rebuilt on every keystroke/selection change
  }, [])
```

- [ ] **Step 3: Fetch sync status when the shared-feed tab/username changes**

Add near the existing shared-feed-list effect (the one keyed on `[tab, effectiveUsername]`):

```typescript
  useEffect(() => {
    if (tab !== 'shared-feed' || effectiveUsername === '') {
      setFeedSyncStatus(null)
      return
    }
    let cancelled = false
    window.rifffApi.endlesssSyncStatusSharedFeed(effectiveUsername).then((status) => {
      if (!cancelled) setFeedSyncStatus(status)
    })
    return () => {
      cancelled = true
    }
  }, [tab, effectiveUsername])
```

- [ ] **Step 4: Fetch sync status when the selected jam changes**

Add near the existing jam-riffs-list effect (the one keyed on `[selectedJamCID]`):

```typescript
  useEffect(() => {
    if (!selectedJamCID) {
      setJamSyncStatus(null)
      return
    }
    let cancelled = false
    window.rifffApi.endlesssSyncStatusJam(selectedJamCID).then((status) => {
      if (!cancelled) setJamSyncStatus(status)
    })
    return () => {
      cancelled = true
    }
  }, [selectedJamCID])
```

- [ ] **Step 5: Add the shared-feed sync button + status line**

In the shared-feed tab's header row (next to the existing `{feedRiffs.length} riffs{feedHasMore ?
'+' : ''}` span), add:

```tsx
              <span style={{ fontSize: 9, color: 'var(--ra-text-3)' }}>
                {feedSyncStatus
                  ? `synced: ${feedSyncStatus.riffCount} riffs${feedSyncStatus.complete ? '' : ' (partial)'}`
                  : 'not yet synced'}
              </span>
              <button
                onClick={() => {
                  setFeedSyncProgress({ done: 0, total: 0 })
                  void window.rifffApi.endlesssStartSyncSharedFeed(effectiveUsername)
                }}
                disabled={feedSyncProgress !== null && feedSyncProgress.done < feedSyncProgress.total}
                style={{
                  height: 20,
                  borderRadius: 0,
                  padding: '0 8px',
                  fontSize: 9,
                  border: '1px solid var(--ra-border)',
                  background: 'var(--ra-bg-row-active)',
                  color: 'var(--ra-text-2)'
                }}
              >
                {feedSyncProgress !== null && feedSyncProgress.done < feedSyncProgress.total
                  ? `syncing… ${feedSyncProgress.done}/${feedSyncProgress.total}`
                  : 'sync for instant playback'}
              </button>
```

- [ ] **Step 6: Add the jam sync button + status line**

In the private-jams tab, in the riff-panel header area shown once `selectedJamCID` is set (near
the `{jamRiffs.length}`-equivalent area, or directly above the riff grid if no such line
currently exists — place it just above the `jamGridRef` scroll container):

```tsx
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 9, color: 'var(--ra-text-3)' }}>
                  {jamSyncStatus
                    ? `synced: ${jamSyncStatus.riffCount} riffs${jamSyncStatus.complete ? '' : ' (partial)'}`
                    : 'not yet synced'}
                </span>
                <button
                  onClick={() => {
                    setJamSyncProgress({ done: 0, total: 0 })
                    void window.rifffApi.endlesssStartSyncJam(selectedJamCID)
                  }}
                  disabled={jamSyncProgress !== null && jamSyncProgress.done < jamSyncProgress.total}
                  style={{
                    height: 20,
                    borderRadius: 0,
                    padding: '0 8px',
                    fontSize: 9,
                    border: '1px solid var(--ra-border)',
                    background: 'var(--ra-bg-row-active)',
                    color: 'var(--ra-text-2)'
                  }}
                >
                  {jamSyncProgress !== null && jamSyncProgress.done < jamSyncProgress.total
                    ? `syncing… ${jamSyncProgress.done}/${jamSyncProgress.total}`
                    : 'sync this jam for instant playback'}
                </button>
              </div>
```

- [ ] **Step 7: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/components/EndlesssLibraryBrowser.tsx
git commit -m "EndlesssLibraryBrowser: add explicit sync trigger buttons + progress/status UI"
```

---

### Task 8: Full verification + manual walkthrough

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all tests pass, including every test added in Tasks 1-5

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no errors or warnings (run `npx eslint --fix <file>` for any auto-fixable formatting
issues, matching this session's established pattern)

- [ ] **Step 4: Restart the dev app**

The native engine isn't touched by this plan, so a renderer/main reload via `npm run dev`'s own
HMR should be sufficient — but since this touches `src/main/index.ts` (new IPC handlers,
main-process code doesn't hot-reload as reliably as the renderer), do a full `npm run dev`
restart before manual testing, matching this session's own established troubleshooting pattern
for main-process changes.

- [ ] **Step 5: Manual walkthrough (requires a real logged-in Endlesss account — cannot be done
  by an implementer without one; flag this explicitly if it can't be completed solo)**

- Open the Endlesss browser, log in, go to "my shared feed."
- Click "sync for instant playback." Confirm the button shows live progress
  (`syncing… N/total`) and the status line updates to `synced: N riffs` once done.
- Close and reopen the browser (or switch tabs and back). Confirm the shared feed now loads
  instantly (no visible loading delay) and `synced: N riffs` still shows.
- Click a few riffs across different scroll positions. Confirm they play back with no perceptible
  delay (this is the actual point of the feature).
- Click "sync for instant playback" again. Confirm it completes quickly (only genuinely new
  content since the first run gets processed) rather than re-walking/re-downloading everything.
- Repeat the same walkthrough for "my private jam" (select a jam, click "sync this jam",
  confirm progress/status/instant playback/fast re-sync).
- Quit the app mid-sync (Cmd+Q while a sync is still running) on a large-enough feed/jam that
  the first attempt doesn't finish. Relaunch, trigger sync again on the same source. Confirm it
  resumes rather than restarting from scratch (check the terminal/console for how many riffs it
  actually re-processes, or just confirm the total elapsed time on the second run is much
  shorter than a instantly-restarted-from-zero run would be).

- [ ] **Step 6: Final commit (if the walkthrough surfaced any fixes)**

```bash
git add -A
git commit -m "Endlesss ahead-of-time sync: fixes from manual walkthrough"
```

(Skip this step entirely if the walkthrough found nothing to fix.)
