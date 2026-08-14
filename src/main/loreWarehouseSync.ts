import type Database from 'better-sqlite3'
import {
  listSharedFeed,
  peekSharedFeedCache,
  downloadMissingStemsFor,
  listRiffsInJam,
  resolveJamRiff,
  deleteStemFiles,
  type FetchLike
} from './endlesssApi'
import { openOwnRiffLibraryDb } from './riffLibrarySchema'
import {
  upsertJam,
  markJamSyncComplete,
  upsertRiffSkeletons,
  writeRiffDetail,
  markStemDownloadFailed,
  areAllResolved,
  filterUnresolved,
  deleteJamRows
} from './loreWarehouseWriter'

/** Runs `worker` over every item in `items`, with at most `limit` calls in
 * flight at once. Copied here from endlesssSync.ts's own identical helper --
 * NOT a move: endlesssSync.ts is still live and unmodified (this plan is
 * additive only, see its own Scope note), so both copies currently exist.
 * Same worker-pool shape, same rationale (see endlesssSync.ts's own doc
 * comment): a sync run touching hundreds of riffs needs a concurrency cap so
 * it doesn't compete with foreground UI clicks. Once Plan 2 retires
 * endlesssSync.ts, this should move to src/shared/ as the single copy.
 *
 * `signal`, when given, is checked at the top of each lane's loop -- once
 * aborted, no lane starts a NEW worker call, but whichever calls are already
 * in flight are left to resolve on their own (worker itself is expected to
 * pass the same signal down into its own network calls, per fetchWithTimeout
 * in endlesssApi.ts, so those settle quickly via real cancellation rather
 * than running to completion). */
export async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
  signal?: AbortSignal
): Promise<void> {
  let cursor = 0
  async function lane(): Promise<void> {
    while (cursor < items.length) {
      if (signal?.aborted) return
      const item = items[cursor++]
      await worker(item)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => lane()))
}

export interface SyncProgress {
  done: number
  total: number
  /** Running total of real bytes downloaded this sync run -- only counts
   * stems actually fetched over the network this call, not ones that were
   * already cached locally (see downloadMissingStemsFor's own
   * onStemDownloaded doc comment in endlesssApi.ts). Lets the UI show real
   * data amounts (LibraryBrowser.tsx), not just a riff counter. */
  bytesDone: number
}

const SYNC_CONCURRENCY = 3
const SYNC_SHARED_FEED_PAGE_SIZE = 100

// Keyed the same way onProgress/onLoreSyncProgress events already are (bare
// username for a shared-feed sync, jamId for a private jam) -- was a plain
// Set<string> until abortSync needed something to actually call .abort() on;
// membership-checking behavior (a key present means "already running, don't
// start a second one") is unchanged, just backed by a Map now.
const syncsInFlight = new Map<string, AbortController>()

/** Requests that whichever sync is currently running for `key` stop as soon
 * as possible -- does NOT mark the jam as fully synced (see syncSharedFeed/
 * syncJam's own page-loop abort checks, which skip markJamSyncComplete on
 * abort), so a re-sync later picks up wherever this one left off, same as
 * any other partial/interrupted sync. Returns false if nothing was running
 * for this key (nothing to abort, not an error). */
export function abortSync(key: string): boolean {
  const controller = syncsInFlight.get(key)
  if (!controller) return false
  controller.abort()
  return true
}

export interface RemoveJamSyncResult {
  riffsRemoved: number
  filesDeleted: number
}

/** Un-syncs a jam entirely -- deletes its Riffs/Tags rows and the Jams row
 * itself (via deleteJamRows), and, if `deleteFiles`, also deletes whichever
 * of its stems' local audio files aren't still referenced by a riff in some
 * OTHER synced jam (deleteJamRows itself works out which stems those are;
 * see its own doc comment for why that check -- not just wiping every stem
 * this jam happened to "own" -- is necessary). Works the same way for a
 * shared-feed key (`shared:<username>`) as a private jam, since both are
 * stored under the same OwnerJamCID convention. Throws if a sync is
 * currently running for this key -- deleting rows out from under an
 * in-flight writer would be a real race (lost writes, a jam left in a
 * half-deleted state), not just wasted work; the caller should offer
 * abortSync first and let that sync's own promise resolve before retrying. */
export function removeJamSync(
  jamCID: string,
  deleteFiles: boolean,
  db: Database.Database = openOwnRiffLibraryDb()
): RemoveJamSyncResult {
  if (syncsInFlight.has(jamCID)) {
    throw new Error(`cannot remove ${jamCID}: a sync is currently running for it`)
  }
  const before = db
    .prepare(`SELECT COUNT(*) as n FROM Riffs WHERE OwnerJamCID = ?`)
    .get(jamCID) as { n: number }
  const orphanedStemCIDs = deleteJamRows(db, jamCID)
  const filesDeleted =
    deleteFiles && orphanedStemCIDs.length > 0 ? deleteStemFiles(orphanedStemCIDs) : 0
  return { riffsRemoved: before.n, filesDeleted }
}

/** Walks the account's own shared feed from the front (newest first),
 * skeleton-inserting every riff it sees and resolving whichever of each
 * page's riffs aren't already fully resolved (AppVersion IS NULL). Stops
 * once a page arrives where every riff was ALREADY fully resolved before
 * this call started (`pageFullyDone`) -- not merely "already known", which
 * is what the old JSON-index sync used and which could permanently skip a
 * riff that was seen but never resolved (see this plan's own header note
 * and the design spec's Background section). No-ops if a sync for this
 * exact userName is already running. Stoppable mid-run via abortSync(key) --
 * see the page-loop's own `controller.signal.aborted` check below for why
 * an aborted run never calls markJamSyncComplete. */
export async function syncSharedFeed(
  userName: string,
  onProgress: (progress: SyncProgress) => void,
  fetchImpl: FetchLike = fetch,
  db: Database.Database = openOwnRiffLibraryDb()
): Promise<void> {
  const key = `shared:${userName}`
  if (syncsInFlight.has(key)) return
  const controller = new AbortController()
  syncsInFlight.set(key, controller)
  try {
    upsertJam(db, key, 'Shared Feed')
    let offset = 0
    let resolvedCount = 0
    let bytesDone = 0
    for (;;) {
      if (controller.signal.aborted) break
      const page = await listSharedFeed(
        userName,
        offset,
        SYNC_SHARED_FEED_PAGE_SIZE,
        fetchImpl,
        controller.signal
      )
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
      await runWithConcurrency(
        pageResolved,
        SYNC_CONCURRENCY,
        async ([riffCID, baseResolved]) => {
          const resolved = await downloadMissingStemsFor(
            baseResolved,
            fetchImpl,
            controller.signal,
            (bytes) => {
              bytesDone += bytes
            }
          )
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
          onProgress({ done: resolvedCount, total: resolvedCount, bytesDone })
        },
        controller.signal
      )

      if (controller.signal.aborted) break
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
  db: Database.Database = openOwnRiffLibraryDb()
): Promise<void> {
  if (syncsInFlight.has(jamId)) return
  const controller = new AbortController()
  syncsInFlight.set(jamId, controller)
  try {
    upsertJam(db, jamId, jamName)
    let offset = 0
    let resolvedCount = 0
    let bytesDone = 0
    for (;;) {
      if (controller.signal.aborted) break
      const page = await listRiffsInJam(
        jamId,
        { offset, limit: SYNC_JAM_PAGE_SIZE },
        fetchImpl,
        controller.signal
      )
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

      await runWithConcurrency(
        needsResolve,
        SYNC_CONCURRENCY,
        async (riffCID) => {
          const resolved = await resolveJamRiff(
            jamId,
            riffCID,
            fetchImpl,
            controller.signal,
            (bytes) => {
              bytesDone += bytes
            }
          )
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
          onProgress({ done: resolvedCount, total: resolvedCount, bytesDone })
        },
        controller.signal
      )

      if (controller.signal.aborted) break
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
