import type Database from 'better-sqlite3'
import {
  listSharedFeed,
  peekSharedFeedCache,
  downloadMissingStemsFor,
  listRiffsInJam,
  resolveJamRiffOrFailure,
  deleteStemFiles,
  type FetchLike
} from './endlesssApi'
import { openOwnRiffLibraryDb } from './riffLibrarySchema'
import type {
  EndlesssFetchFailure,
  RiffLibraryResolvedRiff,
  RiffLibraryResolvedStem,
  RiffPage,
  SyncOutcome
} from '@shared/riffLibraryTypes'
import { dropInMemoryJamIndexes } from './discoverCandidates'
import { isValidSharedFeedKey, normalizeEndlesssUsername } from '@shared/endlesssUsername'
import {
  upsertJam,
  mergeSharedFeedCaseVariants,
  markJamSyncComplete,
  markJamSyncIncomplete,
  isJamSyncComplete,
  hasUnresolvedRiffs,
  countJamRiffs,
  healStemlessRiffs,
  upsertRiffSkeletons,
  writeRiffDetail,
  markStemDownloadFailed,
  areAllResolved,
  filterUnresolved,
  deleteJamRows
} from './riffLibraryWriter'

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

// Told the running-sync count whenever a sync starts or finishes -- index.ts
// forwards it so BackgroundWorkIndicator.tsx can say "syncing library" from
// anywhere, not only while LibraryBrowser.tsx (which started it) is open.
let syncsInFlightListener: ((count: number) => void) | null = null

export function setSyncsInFlightListener(fn: ((count: number) => void) | null): void {
  syncsInFlightListener = fn
}

export function activeSyncCount(): number {
  return syncsInFlight.size
}

function noteSyncsInFlightChanged(): void {
  syncsInFlightListener?.(syncsInFlight.size)
}

/** The key a sync of `key` runs under in syncsInFlight: a shared feed's is
 * always its lowercase name (syncSharedFeed), so `shared:Elling` -- the jam
 * row a capitalised login once synced, still listed until the next sync
 * folds it -- names the running `shared:elling` sync (review of 0e27db79).
 * A private jam's id is used as is. */
function inFlightKeyOf(key: string): string {
  if (!key.startsWith('shared:')) return key
  return `shared:${normalizeEndlesssUsername(key.slice('shared:'.length))}`
}

/** What a sync does with one walked page: resolve its riffs, walk on past it
 * (already done), or stop (the jam is complete). */
type WalkStep = 'resolve' | 'skip' | 'done'

interface ResumableWalk {
  /** Called once a page's skeletons are in. */
  beforeResolving: (pageFullyDone: boolean, page: RiffPage) => WalkStep
  /** A riff this run tried and could not resolve (not one a cancel cut off). */
  riffFailed: () => void
  /** The walk reached the jam's end, or a page done before a complete jam's
   * catch-up: complete, unless a riff failed this run. */
  reachedEnd: () => void
}

/** The stop rule both syncs share, which is what keeps a cut-short sync
 * resumable. A page whose riffs were all resolved before this run means
 * every older riff was too only once the walk has reached the jam's end
 * (SyncComplete): then the walk stops there. Before that -- a first sync, or
 * one cancelled or failed part-way -- the walk goes on past done pages
 * (listing them, resolving nothing) to wherever the last run stopped; it
 * used to stop at the first done page and mark the jam complete, so the
 * riffs past a cut were never fetched. A catch-up of a complete jam that
 * starts resolving new riffs first clears SyncComplete: if it is cut off
 * before it reaches a done page, the new riffs behind the cut would
 * otherwise sit past a page the next sync stops at.
 *
 * Complete is not taken at its word (review of b18e27fb): jams were marked
 * complete under the old rule with riffs past a failed page never listed,
 * or listed and never fetched (Night Owl, Techno!: 27 on its last page).
 * One with an unresolved riff, or whose page 0 says the jam has more riffs
 * than are held here (its totalCount comes free with that page; counted
 * after the page's own skeletons are in, so a catch-up's new riffs don't
 * count), is walked as an unfinished one. And a run in which any riff
 * failed does not mark the jam complete: the walk would stop above that
 * riff next time and never fetch it. */
function newResumableWalk(db: Database.Database, jamCID: string): ResumableWalk {
  const markedComplete = isJamSyncComplete(db, jamCID)
  let reachedEndBefore = markedComplete && !hasUnresolvedRiffs(db, jamCID)
  let markedUnfinished = false
  const takeBackComplete = (): void => {
    if (markedUnfinished) return
    markJamSyncIncomplete(db, jamCID)
    markedUnfinished = true
  }
  if (markedComplete && !reachedEndBefore) takeBackComplete()
  let firstPage = true
  let riffFailures = 0
  const reachedEnd = (): void => {
    if (riffFailures === 0) markJamSyncComplete(db, jamCID)
  }
  return {
    beforeResolving(pageFullyDone, page) {
      if (firstPage) {
        firstPage = false
        if (
          reachedEndBefore &&
          page.totalCount !== undefined &&
          page.totalCount > countJamRiffs(db, jamCID)
        ) {
          reachedEndBefore = false
          takeBackComplete()
        }
      }
      if (pageFullyDone && !reachedEndBefore) {
        if (page.hasMore) return 'skip'
        reachedEnd()
        return 'done'
      }
      if (!pageFullyDone && reachedEndBefore) takeBackComplete()
      return 'resolve'
    },
    riffFailed() {
      riffFailures++
    },
    reachedEnd
  }
}

/** A 429 with no Retry-After waits this long; one asking for longer than
 * the cap waits the cap. */
const DEFAULT_RATE_LIMIT_BACKOFF_MS = 60_000
const MAX_RATE_LIMIT_BACKOFF_MS = 15 * 60_000

/** When Endlesss may next be asked, after a 429 (epoch ms). A sync started
 * before then makes no request: the auto-syncs on login (LibraryBrowser.tsx)
 * would otherwise ask again straight away. One for every sync -- the shared
 * feed and the jams are one account to Endlesss. */
let rateLimitedUntil = 0

function rateLimitedOutcome(): SyncOutcome {
  return { stopped: 'rate-limited', retryAt: rateLimitedUntil }
}

/** What a failed request means for the whole run: a 429 or no session ends
 * it and is told to the renderer (the backoff noted); anything else does not
 * (null). */
function stopFor(failure: EndlesssFetchFailure): SyncOutcome | null {
  if (failure.reason === 'logged-out') return { stopped: 'logged-out' }
  if (failure.reason !== 'rate-limited') return null
  const wait = Math.min(
    failure.retryAfterMs ?? DEFAULT_RATE_LIMIT_BACKOFF_MS,
    MAX_RATE_LIMIT_BACKOFF_MS
  )
  rateLimitedUntil = Math.max(rateLimitedUntil, Date.now() + wait)
  console.warn(
    `riffLibrarySync: Endlesss rate-limited the sync -- not asking again until ${new Date(rateLimitedUntil).toISOString()}`
  )
  return rateLimitedOutcome()
}

/** The one-time heal of riffs the old stem lookup saved stemless
 * (healStemlessRiffs), run by whichever sync comes first. One that throws is
 * logged and tried again next sync; it never costs the sync itself. */
function healStemlessRiffsOnce(db: Database.Database): void {
  try {
    const healed = healStemlessRiffs(db)
    if (healed.riffs > 0) {
      console.warn(
        `riffLibrarySync: ${healed.riffs} riff(s) in ${healed.jams} jam(s) were saved with no ` +
          `stems after a failed lookup; their jams will fetch them again`
      )
    }
  } catch (err) {
    console.error('riffLibrarySync: healing stemless riffs failed:', err)
  }
}

/** A stem with audio to fetch that has none on disk. */
function stemMissing(stem: RiffLibraryResolvedStem): boolean {
  return stem.path === null && stem.downloadUrl !== null
}

/** A riff whose stem downloads a cancel cut off: not written, so it stays
 * unresolved and the next sync fetches it again, rather than being saved as
 * resolved with its stems ledgered as failed downloads. */
function cutShortByCancel(resolved: RiffLibraryResolvedRiff, signal: AbortSignal): boolean {
  return signal.aborted && resolved.stems.some(stemMissing)
}

/** Requests that whichever sync is currently running for `key` stop as soon
 * as possible -- does NOT mark the jam as fully synced: a page fetch the
 * cancel cuts off comes back `failed`, not as the feed's end (see
 * newResumableWalk), so a re-sync later picks up wherever this one left
 * off, same as any other partial/interrupted sync. Returns false if nothing
 * was running for this key (nothing to abort, not an error). */
export function abortSync(key: string): boolean {
  const controller = syncsInFlight.get(inFlightKeyOf(key))
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
  if (syncsInFlight.has(inFlightKeyOf(jamCID))) {
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
 * and the design spec's Background section). That stop holds only once the
 * feed has been walked to its end; until then the walk goes on past done
 * pages (newResumableWalk). No-ops if a sync for this exact userName is
 * already running. Stoppable mid-run via abortSync(key); a cancelled or
 * failed page fetch (`page.failed`) ends the run without marking the feed
 * complete. */
export async function syncSharedFeed(
  userName: string,
  onProgress: (progress: SyncProgress) => void,
  fetchImpl: FetchLike = fetch,
  db: Database.Database = openOwnRiffLibraryDb()
): Promise<SyncOutcome> {
  // Only a real username's feed, and always under its lowercase name (how
  // Endlesss stores it): an email login used to sync one under the email (an
  // empty duplicate "Shared Feed", 2026-10-07), and a login typed with a
  // capital one under `shared:Elling`.
  const name = normalizeEndlesssUsername(userName)
  const key = `shared:${name}`
  if (!isValidSharedFeedKey(key)) {
    console.warn(`syncSharedFeed: "${userName}" is not an Endlesss username -- not syncing`)
    return { stopped: null }
  }
  if (syncsInFlight.has(key)) return { stopped: null }
  if (Date.now() < rateLimitedUntil) return rateLimitedOutcome()
  const controller = new AbortController()
  syncsInFlight.set(key, controller)
  noteSyncsInFlightChanged()
  let outcome: SyncOutcome = { stopped: null }
  try {
    healStemlessRiffsOnce(db)
    // A capitalised feed from before: all of it becomes this one, once. A
    // fold that fails (all or nothing: nothing moved) must not cost the sync
    // itself -- logged, and tried again by the next sync, which finds the
    // same variant still there (review of 0e27db79).
    try {
      // Discover's in-memory indexes name each stem's jam: dropped, as a
      // forget does, since the rename moves no count or rowid they'd notice.
      if (mergeSharedFeedCaseVariants(db, key) > 0) dropInMemoryJamIndexes(db)
    } catch (err) {
      console.error(`syncSharedFeed: folding other spellings into ${key} failed:`, err)
    }
    upsertJam(db, key, 'Shared Feed')
    const walk = newResumableWalk(db, key)
    let offset = 0
    let resolvedCount = 0
    let bytesDone = 0
    for (;;) {
      if (controller.signal.aborted) break
      const page = await listSharedFeed(
        name,
        offset,
        SYNC_SHARED_FEED_PAGE_SIZE,
        fetchImpl,
        controller.signal
      )
      if (page.failed) {
        outcome = stopFor(page.failed) ?? outcome
        break
      }
      if (page.riffs.length === 0) {
        walk.reachedEnd()
        break
      }

      const cids = page.riffs.map((r) => r.riffCID)
      const pageFullyDone = areAllResolved(db, cids)

      upsertRiffSkeletons(
        db,
        key,
        page.riffs.map((r) => ({ riffCID: r.riffCID, creationTime: r.creationTime }))
      )

      const step = walk.beforeResolving(pageFullyDone, page)
      if (step === 'done') break
      if (step === 'skip') {
        offset = page.nextOffset
        continue
      }

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
          if (cutShortByCancel(resolved, controller.signal)) return
          const summary = page.riffs.find((r) => r.riffCID === riffCID)!
          writeRiffDetail(
            db,
            key,
            { creationTime: summary.creationTime, userName: summary.userName },
            resolved
          )
          for (const stem of resolved.stems) {
            if (stemMissing(stem)) markStemDownloadFailed(db, stem.stemCID)
          }
          resolvedCount++
          onProgress({ done: resolvedCount, total: resolvedCount, bytesDone })
        },
        controller.signal
      )

      if (controller.signal.aborted) break
      if (pageFullyDone || !page.hasMore) {
        walk.reachedEnd()
        break
      }
      offset = page.nextOffset
    }
  } finally {
    syncsInFlight.delete(key)
    noteSyncsInFlightChanged()
  }
  return outcome
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
): Promise<SyncOutcome> {
  if (syncsInFlight.has(jamId)) return { stopped: null }
  if (Date.now() < rateLimitedUntil) return rateLimitedOutcome()
  const controller = new AbortController()
  syncsInFlight.set(jamId, controller)
  noteSyncsInFlightChanged()
  let outcome: SyncOutcome = { stopped: null }
  try {
    healStemlessRiffsOnce(db)
    upsertJam(db, jamId, jamName)
    const walk = newResumableWalk(db, jamId)
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
      if (page.failed) {
        outcome = stopFor(page.failed) ?? outcome
        break
      }
      if (page.riffs.length === 0) {
        walk.reachedEnd()
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

      const step = walk.beforeResolving(pageFullyDone, page)
      if (step === 'done') break
      if (step === 'skip') {
        offset = page.nextOffset
        continue
      }

      await runWithConcurrency(
        needsResolve,
        SYNC_CONCURRENCY,
        async (riffCID) => {
          const result = await resolveJamRiffOrFailure(
            jamId,
            riffCID,
            fetchImpl,
            controller.signal,
            (bytes) => {
              bytesDone += bytes
            }
          )
          // Left unresolved, so the next sync fetches it again. A cancel
          // ends the run anyway; anything else keeps the jam from being
          // marked complete; a 429 or a lost session also ends the run --
          // aborting the requests in flight and every lane's next riff,
          // rather than asking for each remaining riff and failing it too.
          if ('failure' in result) {
            if (result.failure.reason === 'cancelled') return
            walk.riffFailed()
            const stop = stopFor(result.failure)
            if (stop && outcome.stopped === null) {
              outcome = stop
              controller.abort()
            }
            return
          }
          const resolved = result.riff
          if (cutShortByCancel(resolved, controller.signal)) return
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
            if (stemMissing(stem)) markStemDownloadFailed(db, stem.stemCID)
          }
          resolvedCount++
          onProgress({ done: resolvedCount, total: resolvedCount, bytesDone })
        },
        controller.signal
      )

      if (controller.signal.aborted) break
      if (pageFullyDone || !page.hasMore) {
        walk.reachedEnd()
        break
      }
      offset = page.nextOffset
    }
  } finally {
    syncsInFlight.delete(jamId)
    noteSyncsInFlightChanged()
  }
  return outcome
}
