import type Database from 'better-sqlite3'
import {
  listSharedFeed,
  peekSharedFeedCache,
  downloadMissingStemsFor,
  listRiffsInJam,
  resolveJamRiff,
  type FetchLike
} from './endlesssApi'
import { openOwnWarehouseDb } from './loreWarehouseSchema'
import {
  upsertJam,
  markJamSyncComplete,
  upsertRiffSkeletons,
  writeRiffDetail,
  markStemDownloadFailed,
  areAllResolved,
  filterUnresolved
} from './loreWarehouseWriter'

/** Runs `worker` over every item in `items`, with at most `limit` calls in
 * flight at once. Copied here from endlesssSync.ts's own identical helper --
 * NOT a move: endlesssSync.ts is still live and unmodified (this plan is
 * additive only, see its own Scope note), so both copies currently exist.
 * Same worker-pool shape, same rationale (see endlesssSync.ts's own doc
 * comment): a sync run touching hundreds of riffs needs a concurrency cap so
 * it doesn't compete with foreground UI clicks. Once Plan 2 retires
 * endlesssSync.ts, this should move to src/shared/ as the single copy. */
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

const syncsInFlight = new Set<string>()

/** Walks the account's own shared feed from the front (newest first),
 * skeleton-inserting every riff it sees and resolving whichever of each
 * page's riffs aren't already fully resolved (AppVersion IS NULL). Stops
 * once a page arrives where every riff was ALREADY fully resolved before
 * this call started (`pageFullyDone`) -- not merely "already known", which
 * is what the old JSON-index sync used and which could permanently skip a
 * riff that was seen but never resolved (see this plan's own header note
 * and the design spec's Background section). No-ops if a sync for this
 * exact userName is already running. */
export async function syncSharedFeed(
  userName: string,
  onProgress: (progress: SyncProgress) => void,
  fetchImpl: FetchLike = fetch,
  db: Database.Database = openOwnWarehouseDb()
): Promise<void> {
  const key = `shared:${userName}`
  if (syncsInFlight.has(key)) return
  syncsInFlight.add(key)
  try {
    upsertJam(db, key, 'Shared Feed')
    let offset = 0
    let resolvedCount = 0
    for (;;) {
      const page = await listSharedFeed(userName, offset, SYNC_SHARED_FEED_PAGE_SIZE, fetchImpl)
      if (page.riffs.length === 0) {
        markJamSyncComplete(db, key)
        break
      }

      const cids = page.riffs.map((r) => r.riffCID)
      const pageFullyDone = areAllResolved(db, cids)

      upsertRiffSkeletons(
        db,
        key,
        page.riffs.map((r) => ({ riffCID: r.riffCID, creationTime: r.creationTime }))
      )

      // The shared feed's own listing embeds full riff+stem detail already
      // (see peekSharedFeedCache's doc comment in endlesssApi.ts) -- no
      // second network round trip needed to get metadata, only to fetch
      // stem audio bytes (downloadMissingStemsFor), which IS worth
      // concurrency-capping since it's real per-riff network I/O.
      const pageResolved = [...peekSharedFeedCache(cids)]
      await runWithConcurrency(pageResolved, SYNC_CONCURRENCY, async ([riffCID, baseResolved]) => {
        const resolved = await downloadMissingStemsFor(baseResolved, fetchImpl)
        const summary = page.riffs.find((r) => r.riffCID === riffCID)!
        writeRiffDetail(
          db,
          key,
          { creationTime: summary.creationTime, userName: summary.userName },
          resolved
        )
        for (const stem of resolved.stems) {
          if (stem.path === null && stem.downloadUrl !== null)
            markStemDownloadFailed(db, stem.stemCID)
        }
        resolvedCount++
        onProgress({ done: resolvedCount, total: resolvedCount })
      })

      if (pageFullyDone || !page.hasMore) {
        markJamSyncComplete(db, key)
        break
      }
      offset = page.nextOffset
    }
  } finally {
    syncsInFlight.delete(key)
  }
}

const SYNC_JAM_PAGE_SIZE = 200 // matches DEFAULT_RIFF_PAGE_SIZE in endlesssApi.ts

/** Same shape as syncSharedFeed, walking a private jam via listRiffsInJam/
 * resolveJamRiff instead -- see syncSharedFeed's own doc comment for the
 * full rationale (pageFullyDone stop condition, why re-discovering an
 * already-done riff is a safe no-op). Unlike the shared feed, a jam's raw
 * listing view carries no per-riff BPM/userName/stem detail at all (see
 * listRiffsInJam's own doc comment in endlesssApi.ts) -- every
 * not-yet-resolved riff genuinely needs its own resolveJamRiff network
 * call, which IS what runWithConcurrency below is capping. */
export async function syncJam(
  jamId: string,
  jamName: string,
  onProgress: (progress: SyncProgress) => void,
  fetchImpl: FetchLike = fetch,
  db: Database.Database = openOwnWarehouseDb()
): Promise<void> {
  if (syncsInFlight.has(jamId)) return
  syncsInFlight.add(jamId)
  try {
    upsertJam(db, jamId, jamName)
    let offset = 0
    let resolvedCount = 0
    for (;;) {
      const page = await listRiffsInJam(jamId, { offset, limit: SYNC_JAM_PAGE_SIZE }, fetchImpl)
      if (page.riffs.length === 0) {
        markJamSyncComplete(db, jamId)
        break
      }

      const cids = page.riffs.map((r) => r.riffCID)
      const needsResolve = filterUnresolved(db, cids)
      const pageFullyDone = needsResolve.length === 0

      upsertRiffSkeletons(
        db,
        jamId,
        page.riffs.map((r) => ({ riffCID: r.riffCID, creationTime: r.creationTime }))
      )

      await runWithConcurrency(needsResolve, SYNC_CONCURRENCY, async (riffCID) => {
        const resolved = await resolveJamRiff(jamId, riffCID, fetchImpl)
        if (resolved) {
          const summary = page.riffs.find((r) => r.riffCID === riffCID)!
          // listRiffsInJam's raw view never carries a per-riff userName
          // (see its own doc comment in endlesssApi.ts) -- summary.userName
          // is always '' here, a known, pre-existing limitation of the jam
          // listing endpoint itself, not something introduced by this sync.
          writeRiffDetail(
            db,
            jamId,
            { creationTime: summary.creationTime, userName: summary.userName },
            resolved
          )
          for (const stem of resolved.stems) {
            if (stem.path === null && stem.downloadUrl !== null)
              markStemDownloadFailed(db, stem.stemCID)
          }
        }
        resolvedCount++
        onProgress({ done: resolvedCount, total: resolvedCount })
      })

      if (pageFullyDone || !page.hasMore) {
        markJamSyncComplete(db, jamId)
        break
      }
      offset = page.nextOffset
    }
  } finally {
    syncsInFlight.delete(jamId)
  }
}
