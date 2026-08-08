import {
  listSharedFeed,
  listRiffsInJam,
  resolveJamRiff,
  downloadMissingStemsFor,
  peekSharedFeedCache
} from './endlesssApi'
import type { FetchLike } from './endlesssApi'
import { loadOrCreateSyncIndex, saveSyncIndex } from './endlesssSyncIndex'
import type { LoreRiffSummary, LoreResolvedRiff } from '@shared/loreLibrary'

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
 * since it only ever has to walk past genuinely new content. No-ops if a
 * sync for this exact userName is already running.
 *
 * Each walked page's full riff+stem detail is captured immediately via
 * peekSharedFeedCache, right after that page's listSharedFeed call --
 * mirroring OUROVEON's own Shares::taskFetchLatest, which processes each
 * page's data as it's fetched rather than deferring to a separate pass
 * over the whole set. This matters here for a real reason, not just
 * consistency: listSharedFeed's cache reflects only the MOST RECENTLY
 * fetched page, so deferring resolution to a later phase (as an earlier
 * version of this function did) meant every page except the last one
 * silently failed to resolve once the walk moved on -- confirmed live,
 * where a first-ever sync walked all the way back to 2020 correctly, but
 * only that final, oldest page's ~46 riffs actually made it into the
 * index, with `complete` wrongly left true and every more-recent riff
 * quietly dropped. Stem downloads (downloadMissingStemsFor) still happen
 * afterward through the concurrency-capped pool, same as before -- only
 * the lookup of each riff's base resolved data moved earlier, before it
 * can be evicted.
 *
 * Note: since listSharedFeed itself has a sync-index fast path (see
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
    const baseResolvedByCID = new Map<string, LoreResolvedRiff>()
    let offset = 0
    let reachedEnd = false
    for (;;) {
      const page = await listSharedFeed(userName, offset, SYNC_SHARED_FEED_PAGE_SIZE, fetchImpl)
      const pageResolved = peekSharedFeedCache(page.riffs.map((r) => r.riffCID))
      for (const [riffCID, resolved] of pageResolved) baseResolvedByCID.set(riffCID, resolved)
      let hitBoundary = false
      for (const summary of page.riffs) {
        if (alreadySynced.has(summary.riffCID)) {
          hitBoundary = true
          break
        }
        newSummaries.push(summary)
      }
      // Reports progress as riffs are DISCOVERED, not just as they're
      // resolved/downloaded -- without this, a jam/feed needing many pages
      // to walk shows a bare "syncing…" with no moving number for however
      // long the walk takes, which reads as stalled/unresponsive (confirmed
      // live). done stays 0 here since nothing's been downloaded yet; total
      // grows page by page. The very last of these calls reports the same
      // {done:0, total} the old pre-resolve-phase call used to, so that
      // call is removed below rather than duplicated.
      onProgress({ done: 0, total: newSummaries.length })
      if (hitBoundary) break
      if (!page.hasMore) {
        reachedEnd = true
        break
      }
      offset = page.nextOffset
    }

    let done = 0
    const total = newSummaries.length
    await runWithConcurrency(newSummaries, SYNC_CONCURRENCY, async (summary) => {
      const baseResolved = baseResolvedByCID.get(summary.riffCID)
      const resolved = baseResolved
        ? await downloadMissingStemsFor(baseResolved, fetchImpl)
        : null
      if (resolved) {
        // summary.cachedStemCount is always 0 at listing time (listing
        // never touches disk) -- persisting that stale value here would
        // permanently show this riff's circle as uncached even once its
        // stems are genuinely on disk, since the index-fast-path browse
        // path re-serves this exact summary forever afterward.
        const syncedSummary = {
          ...summary,
          cachedStemCount: resolved.stems.filter((s) => s.path !== null).length
        }
        index.riffs[summary.riffCID] = { summary: syncedSummary, resolved }
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
      // See syncSharedFeed's identical call for why this reports progress
      // during discovery, not just resolution.
      onProgress({ done: 0, total: newSummaries.length })
      if (hitBoundary) break
      if (!page.hasMore) {
        reachedEnd = true
        break
      }
      offset = page.nextOffset
    }

    let done = 0
    const total = newSummaries.length
    await runWithConcurrency(newSummaries, SYNC_CONCURRENCY, async (summary) => {
      const resolved = await resolveJamRiff(jamId, summary.riffCID, fetchImpl)
      if (resolved) {
        // See syncSharedFeed's identical fixup for why this can't just
        // reuse the listing-time summary as-is.
        const syncedSummary = {
          ...summary,
          cachedStemCount: resolved.stems.filter((s) => s.path !== null).length
        }
        index.riffs[summary.riffCID] = { summary: syncedSummary, resolved }
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
