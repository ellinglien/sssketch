import {
  existsSync,
  mkdirSync,
  writeFileSync,
  renameSync,
  readFileSync,
  readdirSync,
  rmSync
} from 'node:fs'
import { basename, join, dirname } from 'node:path'
import { app } from 'electron'
import Database from 'better-sqlite3'
import type {
  RiffLibraryJam,
  RiffLibraryRiffSummary,
  RiffLibraryResolvedRiff,
  RiffLibraryResolvedStem,
  RiffFilters,
  RiffPage
} from '@shared/riffLibraryTypes'
import { computeOwnerFraction, stemDownloadUrl, resolveKeyName } from '@shared/riffLibraryTypes'
import { isValidSharedFeedKey } from '@shared/endlesssUsername'
import { findRiffArchiveRoot, type RiffArchivePick } from '@shared/riffArchiveRoot'
import { openOwnRiffLibraryDb, ownRiffLibraryRoot } from './riffLibrarySchema'
import { columnStemSlots, mergeStemSlots, type StemSlotRef } from '@shared/riffStemSlots'
import { readExtraStemSlots } from './riffStemsExtra'
import { DISCOVERED_JAM_CID } from '@shared/discoveredRoom'
import {
  recordStemDownloadFailure,
  recordStemDownloadSuccess,
  shouldAttemptStemDownload
} from './stemAvailability'
import { isStemUnavailable } from './stemUnavailableStore'
import { isUsableStemFile } from './stemFile'
import type { StemDownloadStatus } from './discoverArtistScanQueue'
import { countWork } from './workCounters'
import { heartNameForRiff } from './radioHeartImportStore'
import {
  isScanCacheCurrent,
  newScanCacheState,
  readTableSignal,
  type ScanCacheState
} from './tableChangeSignal'
import { getTableWriteVersion } from './tableWriteVersion'

const RIFF_LIBRARY_PREFS_FILENAME = 'riffLibraryPrefs.json'

function riffLibraryPrefsPath(): string {
  return join(app.getPath('userData'), RIFF_LIBRARY_PREFS_FILENAME)
}

// Pre-rename filename -- see docs/superpowers/specs/
// 2026-08-14-riff-library-rename-design.md §3. Only ever read once, by
// carryForwardLegacyRiffLibraryPrefs' own one-time carry-forward below;
// never written again after this app version ships.
const LEGACY_RIFF_LIBRARY_PREFS_FILENAME = 'loreWarehousePrefs.json'

function legacyRiffLibraryPrefsPath(): string {
  return join(app.getPath('userData'), LEGACY_RIFF_LIBRARY_PREFS_FILENAME)
}

/** One-time carry-forward of a stored riff-library-root override from the
 * pre-rename prefs filename to the new one, so nobody's already-chosen
 * external LORE archive location silently reverts to the default just
 * because the prefs file itself was renamed -- mirrors
 * riffLibraryUsername.ts's own loadTypedRiffLibraryUsername() localStorage
 * carry-forward. Called at the top of both riffLibraryRootPath() and
 * hasStoredRiffLibraryRootOverride(), so it runs on whichever of those two
 * this process happens to call first -- self-terminating, since it's a
 * no-op the moment the new file exists. */
function carryForwardLegacyRiffLibraryPrefs(): void {
  const newPath = riffLibraryPrefsPath()
  if (existsSync(newPath)) return
  const legacyPath = legacyRiffLibraryPrefsPath()
  if (!existsSync(legacyPath)) return
  try {
    const contents = readFileSync(legacyPath, 'utf-8')
    writeFileSync(newPath, contents, 'utf-8')
    rmSync(legacyPath)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(
      `carryForwardLegacyRiffLibraryPrefs: failed to carry forward ${legacyPath}: ${message}`
    )
  }
}

/** Test-only seam: points the module at a fixture warehouse instead of the
 * real one, bypassing prefs entirely. Pass null to clear the override and
 * fall back to reading prefs again (for tests exercising riffLibraryRootPath
 * itself). Also resets the cached connection, since a previously-opened DB
 * handle would otherwise keep pointing at the old root. */
let riffLibraryRootOverride: string | null = null
export function setRiffLibraryRootForTests(root: string | null): void {
  riffLibraryRootOverride = root
  cachedRiffLibraryRoot = null
  closeRiffLibraryDb()
}

/** Where the user's riff library lives -- user-relocatable (see
 * setRiffLibraryRoot). Defaults to sssketch's own self-built riff library
 * (ownRiffLibraryRoot(), populated by riffLibrarySync.ts's background sync)
 * until a user explicitly points this at a real, externally-managed
 * OUROVEON/LORE-synced folder via the folder picker -- see the design
 * spec's Favourites + external-archive compatibility section
 * (docs/superpowers/specs/2026-08-09-lore-warehouse-sync-design.md). Once a
 * prefs file exists, whatever root is saved there always wins; this
 * default is only consulted on a genuinely first-ever launch. Read fresh
 * every call rather than cached, matching projectLibrary.ts's own
 * libraryRootPath convention. */
// Memoized -- real live freeze, profiled 2026-09-21 (typing lag + macOS
// beachball): resolveStemPath calls this once PER STEM, and
// listLibraryScanTargets resolves every stem in the library, so re-reading
// and re-parsing the prefs file (plus two existsSync calls) each time cost
// ~15s of main-process time per 25s sampled, in ~2s synchronous stalls.
// The root only ever changes through setRiffLibraryRoot (or the test seam
// above), both of which reset this.
let cachedRiffLibraryRoot: string | null = null

export function riffLibraryRootPath(): string {
  if (riffLibraryRootOverride !== null) return riffLibraryRootOverride
  if (cachedRiffLibraryRoot !== null) return cachedRiffLibraryRoot
  cachedRiffLibraryRoot = readRiffLibraryRootFromPrefs()
  return cachedRiffLibraryRoot
}

function readRiffLibraryRootFromPrefs(): string {
  carryForwardLegacyRiffLibraryPrefs()
  const path = riffLibraryPrefsPath()
  if (!existsSync(path)) return ownRiffLibraryRoot()
  try {
    const prefs = JSON.parse(readFileSync(path, 'utf-8')) as { root?: string }
    return prefs.root ?? ownRiffLibraryRoot()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`riffLibraryRootPath: failed to read ${path}: ${message}`)
    return ownRiffLibraryRoot()
  }
}

/** Persists a new riff library root and closes the cached DB connection,
 * since it would otherwise keep pointing at the old root's file. */
export function setRiffLibraryRoot(newRoot: string): void {
  try {
    writeFileSync(riffLibraryPrefsPath(), JSON.stringify({ root: newRoot }, null, 2), 'utf-8')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`setRiffLibraryRoot: failed to write ${riffLibraryPrefsPath()}: ${message}`)
  }
  cachedRiffLibraryRoot = null
  closeRiffLibraryDb()
}

/** The gear menu's "change riff archive location…" (share readiness S7, 2026-10-07): the picked
 * folder, or the archive root one level off it (@shared/riffArchiveRoot), becomes the root. A
 * pick with no single archive near it changes nothing; the caller says why. */
export function setRiffLibraryRootFromPick(picked: string): RiffArchivePick {
  const pick = findRiffArchiveRoot(picked, {
    exists: existsSync,
    childDirs: (dir) => {
      try {
        return readdirSync(dir, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => d.name)
      } catch {
        return []
      }
    }
  })
  if (pick.ok) setRiffLibraryRoot(pick.root)
  return pick
}

/** "use sssketch's own library": back from a linked archive. */
export function returnToOwnRiffLibrary(): void {
  setRiffLibraryRoot(ownRiffLibraryRoot())
}

/** True once the user has explicitly repointed the riff library away from
 * its own default (whether at sssketch's own self-built store or a real
 * external LORE archive) -- see setRiffLibraryRoot. Used by
 * riffLibraryMigration.ts to make sure the one-time default-location
 * migration never runs for someone who already made their own choice. */
export function hasStoredRiffLibraryRootOverride(): boolean {
  carryForwardLegacyRiffLibraryPrefs()
  return existsSync(riffLibraryPrefsPath())
}

function riffLibraryDbPath(): string {
  return join(riffLibraryRootPath(), 'cache', 'common', 'warehouse.db3')
}

let cachedDb: Database.Database | null = null

/** How often an open external archive's warehouse file is looked for
 * (getRiffLibraryDb): one stat a second at most, on a path the per-stem
 * callers reach many times a second. */
const ARCHIVE_PRESENCE_CHECK_MS = 1_000
let archivePresenceCheckedAt = 0

/** Whether the open archive's file has gone (the USB drive unplugged, the
 * folder moved) -- looked at most once per ARCHIVE_PRESENCE_CHECK_MS, and
 * only for an external root: the own library is on the system disk. */
function archiveFileGone(): boolean {
  const now = Date.now()
  if (now - archivePresenceCheckedAt < ARCHIVE_PRESENCE_CHECK_MS) return false
  archivePresenceCheckedAt = now
  if (riffLibraryRootPath() === ownRiffLibraryRoot()) return false
  return !existsSync(riffLibraryDbPath())
}

/** Lazily opens the warehouse DB read-only, with a busy-timeout so a moment
 * of LORE writing concurrently degrades gracefully instead of hanging.
 * Returns null (never throws) if the file doesn't exist or can't be opened —
 * callers treat that as "library unavailable", not a crash.
 *
 * The drive coming and going (review of b859757c, 2026-10-07): an open
 * connection whose file has gone is closed here (archiveFileGone), so the
 * routing flips to the own db and nothing reads through a dead handle; a
 * file that is back is opened as a new connection, which drops everything
 * computed without it (the jam list, the own-jam routing). A dead handle
 * whose file is still there (pulled and pushed back in within the check) is
 * caught where a read fails: dropArchiveIfDead. */
function getRiffLibraryDb(): Database.Database | null {
  if (cachedDb) {
    if (!archiveFileGone()) return cachedDb
    console.error(`getRiffLibraryDb: ${riffLibraryDbPath()} is gone; closing its connection`)
    closeRiffLibraryDb()
  }
  if (!existsSync(riffLibraryDbPath())) return null
  try {
    cachedDb = new Database(riffLibraryDbPath(), {
      readonly: true,
      fileMustExist: true,
      timeout: 2000
    })
    archivePresenceCheckedAt = Date.now()
    // An archive that just came back (the drive remounted) takes its jams
    // back: the jam list and the routing were computed without it.
    ownRoutedMemo = null
    cachedJamsWithDb = null
    return cachedDb
  } catch (err) {
    console.error('getRiffLibraryDb: failed to open warehouse.db3:', err)
    return null
  }
}

/** A read error that means the connection itself is dead, not the query:
 * SQLite's I/O and can't-open codes (the volume went away under the handle,
 * or came back as a new mount the old handle can't read). */
function isDeadConnectionError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code
  return typeof code === 'string' && (code.startsWith('SQLITE_IOERR') || code === 'SQLITE_CANTOPEN')
}

/** Closes the archive connection when `err` says it is dead; true if it did.
 * The next getRiffLibraryDb opens a new one if the file is there. */
function dropArchiveIfDead(err: unknown): boolean {
  if (!cachedDb || !isDeadConnectionError(err)) return false
  console.error('riffLibraryStore: an archive read failed; closing its connection:', err)
  closeRiffLibraryDb()
  return true
}

function closeRiffLibraryDb(): void {
  try {
    cachedDb?.close()
  } catch (err) {
    // A connection busy with a statement can't be closed; drop it anyway
    // (better-sqlite3 closes it when it's collected).
    console.error('closeRiffLibraryDb: close failed:', err)
  }
  cachedDb = null
  cachedJamsWithDb = null
  ownRoutedMemo = null
  // Keyed by the Database object itself, so a new root can't collide
  // with the old archive's counts -- but the closed handle would sit in
  // this map forever if nothing dropped it.
  jamOwnershipCache.clear()
}

export function riffLibraryAvailable(): boolean {
  return getRiffLibraryDb() !== null
}

/** Whether every riff and stem a lookup might need is actually reachable
 * right now. Always true on sssketch's own library. On an external LORE
 * archive, false when its warehouse file is gone -- the drive unmounted,
 * the folder moved -- which a cached connection alone would not notice.
 * For "fetch radio hearts" (radioHeartsImport.ts): with the archive away,
 * every stem that lives there would look like missing audio, and a partial
 * import would be recorded as done. */
export function riffLibraryArchiveReachable(): boolean {
  if (riffLibraryRootPath() === ownRiffLibraryRoot()) return true
  return existsSync(riffLibraryDbPath()) && getRiffLibraryDb() !== null
}

/** Stem audio lives in one of two places depending on which warehouse is
 * currently active:
 *
 * - An EXTERNAL, real OUROVEON-synced folder: sharded by jam and by the
 *   first hex character of the StemCID --
 *   cache/common/stem_v2/<JamCID>/<first-hex-char>/<StemCID>, no file
 *   extension. Traced from real LORE-synced data, not guessed.
 * - sssketch's OWN self-built warehouse: loreWarehouseSync.ts's sync
 *   downloads stem audio via endlesssApi.ts's downloadMissingStemsFor,
 *   which reuses that module's own existing content-addressed cache
 *   (endlesss-cache/stems/<first-hex-char>/<StemCID>, keyed by stemCID
 *   alone, no jam-sharding) rather than duplicating storage into a second,
 *   jam-sharded layout nothing else needs. jamCID is accepted but unused in
 *   this branch, kept for signature parity with the external case.
 */
export function resolveStemPath(jamCID: string, stemCID: string): string {
  const shard = stemCID[0]
  const root = riffLibraryRootPath()
  // sssketch's own "discovered" room (see @shared/discoveredRoom): the
  // jam-sharded stem_v2 layout every external LORE jam room already uses,
  // but always under the OWN root regardless of where browsing currently
  // points -- these are copies the app made itself and they must not go
  // missing when the user repoints at a different archive. Same basename-
  // is-the-StemCID convention as everywhere else (stemCIDForPath), which
  // is what keeps StemCategories/StemFeatureCache/StemPeaksCache/
  // StemEmbeddingCache/StemAutoCategory/StemFavourite all hitting at the
  // copied path for free. Checked BEFORE the own-root branch below, which
  // would otherwise send it to the content-addressed endlesss-cache.
  if (jamCID === DISCOVERED_JAM_CID) {
    return join(
      ownRiffLibraryRoot(),
      'cache',
      'common',
      'stem_v2',
      DISCOVERED_JAM_CID,
      shard,
      stemCID
    )
  }
  // Shared Feed (and anything else auto-synced into sssketch's own
  // database -- see dbForJam below) always downloads its stems to the
  // same content-addressed endlesss-cache regardless of which root is
  // currently configured for browsing here -- an external LORE archive's
  // root never receives that data (riffLibrarySync.ts's syncSharedFeed
  // always writes through openOwnRiffLibraryDb, unconditionally). Checking
  // the jamCID directly, not just whether root === own root, is what keeps
  // this correct even while root is pointed elsewhere.
  // A jam sssketch synced itself and the archive has no riffs for
  // (ownRoutedJams, below) is read from the own db, and its audio is where
  // that sync put it: the same cache. Asked only with the root external, so
  // the own-root case pays nothing; a Set lookup otherwise.
  if (
    jamCID.startsWith('shared:') ||
    root === ownRiffLibraryRoot() ||
    ownRoutedJams().has(jamCID)
  ) {
    return join(app.getPath('userData'), 'endlesss-cache', 'stems', shard, stemCID)
  }
  return join(root, 'cache', 'common', 'stem_v2', jamCID, shard, stemCID)
}

/** Where a kept group's copy of `stemCID` lives. One definition, shared by
 * the save path (which writes the copy) and every reader (which resolves
 * it through resolveStemPath) -- delegated rather than re-derived so the
 * two can never drift. */
export function discoveredStemPath(stemCID: string): string {
  return resolveStemPath(DISCOVERED_JAM_CID, stemCID)
}

/** Whichever db actually holds `jamCID`'s rows. Shared Feed jams (jamCID
 * prefixed "shared:") are ALWAYS synced into sssketch's own database
 * (openOwnRiffLibraryDb, via riffLibrarySync.ts's syncSharedFeed),
 * regardless of which root the user has configured for browsing here (e.g.
 * an external LORE archive) -- see riffLibrarySchema.ts's own doc comment.
 * So, with the root external, does a jam sssketch synced itself that the
 * archive has no riffs for (ownRoutedJams, below, 2026-10-07). Everything
 * else follows whatever root is currently configured (getRiffLibraryDb). */
function dbForJam(jamCID: string): Database.Database | null {
  if (jamCID.startsWith('shared:') || jamCID === DISCOVERED_JAM_CID) return openOwnRiffLibraryDb()
  if (riffLibraryRootPath() !== ownRiffLibraryRoot() && ownRoutedJams().has(jamCID)) {
    return openOwnRiffLibraryDb()
  }
  return getRiffLibraryDb()
}

// --- Own jams beside an external archive (2026-10-07) ----------------------
//
// docs/superpowers/plans/2026-10-07-merge-own-jams-with-lore.md. With the
// root on an external LORE archive, the jams sssketch synced itself (always
// into the own db, riffLibrarySync.ts) used to be invisible: dbForJam sent
// them to the archive, which on Elling's has only a name-only stub for 17 of
// them (20,051 stems). The rule, per jam:
//   an own regular jam (not shared:, not discovered) with at least one riff
//   in the own db and NONE in the archive is read from the own db, whole --
//   its riffs, its stems, its audio in the own cache (resolveStemPath).
// Any jam the archive has riffs for stays the archive's, whole: the archive
// wins every jam, riff and stem both have. (Splitting a jam across dbs would
// need stem-level dedupe in every consumer; the cost is the 97 own-only
// stems in 4 jams LORE also has, measured 2026-10-07.)
//
// Small reads only: the own db's Jams rows with an EXISTS riff seek each,
// then one EXISTS seek per candidate on the archive's OwnerJamCID index --
// never a walk of the archive. Memoised, because resolveStemPath asks once
// per stem: dropped when listJamsWithDb rebuilds (a table moved in either
// db), when the archive connection opens or closes (getRiffLibraryDb also
// closes one whose file is gone, and dropArchiveIfDead one that fails a read
// with an I/O error), when the own db is a different connection, and on
// every call checked against the own db's Jams/Riffs (this process's writes
// at once, another connection's at the change check's pace). Computed with
// the archive away or a seek failing, it is looked at again after
// OWN_ROUTING_RECHECK_MS, or at once when anything opens the archive: with
// the archive away every own jam is read from the own db (all its data is
// local), and the archive takes its jams back when it returns.
interface OwnRoutedJams {
  own: Database.Database
  /** The archive connection it was computed against (null: unreachable). */
  archive: Database.Database | null
  jams: ReadonlySet<string>
  /** False when the archive was away or a seek threw: recheck after a while. */
  settled: boolean
  computedAt: number
  ownJamsState: ScanCacheState
  ownRiffsState: ScanCacheState
  /** This process's writes to the own db's Jams/Riffs (tableWriteVersion.ts)
   * when it was computed: a sync landing a new jam moves them, checked on
   * every call for free. */
  ownJamsWrites: number
  ownRiffsWrites: number
}
let ownRoutedMemo: OwnRoutedJams | null = null
const OWN_ROUTING_RECHECK_MS = 30_000

/** The own jams read from the own db while the root is an external archive
 * (see above). Only meaningful with the root external.
 *
 * Every call (the per-stem path too) notices a jam synced into the own db
 * since: this process's own writes for free (tableWriteVersion.ts), another
 * connection's at the change check's pace. Before 2026-10-07's review only
 * listJams looked, so a newly synced own jam's stems resolved to the
 * archive's folder until the next jam-list rebuild. */
function ownRoutedJams(retryDeadArchive = true): ReadonlySet<string> {
  const own = openOwnRiffLibraryDb()
  const memo = ownRoutedMemo
  if (
    memo &&
    memo.own === own &&
    memo.ownJamsWrites === getTableWriteVersion(own, 'Jams') &&
    memo.ownRiffsWrites === getTableWriteVersion(own, 'Riffs') &&
    (memo.settled
      ? // getRiffLibraryDb, not cachedDb: its presence check is what notices
        // the drive gone when nothing else is asking.
        memo.archive === getRiffLibraryDb()
      : Date.now() - memo.computedAt < OWN_ROUTING_RECHECK_MS) &&
    isScanCacheCurrent(own, 'Jams', memo.ownJamsState) &&
    isScanCacheCurrent(own, 'Riffs', memo.ownRiffsState)
  ) {
    return memo.jams
  }
  countWork('sql:own-jam-routing')
  const archive = getRiffLibraryDb()
  // Signals read BEFORE the queries, as listJamsWithDb's.
  const ownJamsWrites = getTableWriteVersion(own, 'Jams')
  const ownRiffsWrites = getTableWriteVersion(own, 'Riffs')
  const ownJamsState = newScanCacheState(readTableSignal(own, 'Jams'))
  const ownRiffsState = newScanCacheState(readTableSignal(own, 'Riffs'))
  const candidates = (
    own
      .prepare(
        `SELECT j.JamCID AS jamCID FROM Jams j
         WHERE j.JamCID NOT LIKE 'shared:%' AND j.JamCID <> ?
           AND EXISTS (SELECT 1 FROM Riffs r WHERE r.OwnerJamCID = j.JamCID)`
      )
      .all(DISCOVERED_JAM_CID) as { jamCID: string }[]
  ).map((row) => row.jamCID)
  const jams = new Set<string>()
  let settled = archive !== null
  if (!archive) {
    for (const jamCID of candidates) jams.add(jamCID)
  } else if (candidates.length > 0) {
    try {
      const archiveHasRiffs = archive.prepare(`SELECT 1 FROM Riffs WHERE OwnerJamCID = ? LIMIT 1`)
      for (const jamCID of candidates) {
        if (archiveHasRiffs.get(jamCID) === undefined) jams.add(jamCID)
      }
    } catch (err) {
      // A dead connection (the drive went and came back): closed, and asked
      // again once through a new one, or the own db if the file is gone.
      if (dropArchiveIfDead(err) && retryDeadArchive) return ownRoutedJams(false)
      // The archive can't answer right now: leave every jam to it, as before
      // this rule, and look again shortly.
      console.error('ownRoutedJams: the archive could not be read:', err)
      jams.clear()
      settled = false
    }
  }
  ownRoutedMemo = {
    own,
    archive,
    jams,
    settled,
    computedAt: Date.now(),
    ownJamsState,
    ownRiffsState,
    ownJamsWrites,
    ownRiffsWrites
  }
  return jams
}

function queryJamsFromDb(db: Database.Database, filterText: string): RiffLibraryJam[] {
  return db
    .prepare(
      `SELECT j.JamCID as jamCID, j.PublicName as name, COALESCE(MAX(r.CreationTime), 0) as lastRiffTime
       FROM Jams j
       LEFT JOIN Riffs r ON r.OwnerJamCID = j.JamCID
       WHERE j.PublicName LIKE ?
       GROUP BY j.JamCID
       ORDER BY lastRiffTime DESC`
    )
    .all(`%${filterText}%`) as RiffLibraryJam[]
}

/** Per-jam authorship counts for one db: how many riffs each jam has by
 * `targetUser`, and how many have no author recorded at all. Two grouped
 * queries for the whole library -- never one per jam, which on 5,056 jams
 * would be 10,112 round trips.
 *
 * Both hit the Riffs(UserName) index directly rather than scanning:
 * measured 2026-09-28 against Elling's real external archive (372,319
 * riffs, 541MB, USB/ExFAT), the pair takes 20 ms warm. The equivalent
 * single query with a CASE-based authored count planned as a full table
 * scan (SCAN Riffs USING INDEX Riff_IndexOwner2Ver) and took 100 ms, so
 * the split into two index seeks is deliberate -- don't "tidy" it back
 * into one.
 *
 * .all(), never .iterate() -- see the SQLite rule in CLAUDE.md. */
function queryJamOwnership(
  db: Database.Database,
  targetUser: string
): Map<string, { ownRiffCount: number; unknownAuthorRiffCount: number }> {
  const counts = new Map<string, { ownRiffCount: number; unknownAuthorRiffCount: number }>()
  const bump = (
    jamCID: string,
    field: 'ownRiffCount' | 'unknownAuthorRiffCount',
    n: number
  ): void => {
    const entry = counts.get(jamCID) ?? { ownRiffCount: 0, unknownAuthorRiffCount: 0 }
    entry[field] = n
    counts.set(jamCID, entry)
  }
  const own = db
    .prepare(
      `SELECT OwnerJamCID as jamCID, COUNT(*) as n FROM Riffs WHERE UserName = ? GROUP BY OwnerJamCID`
    )
    .all(targetUser) as { jamCID: string; n: number }[]
  for (const row of own) bump(row.jamCID, 'ownRiffCount', row.n)
  const unknown = db
    .prepare(
      `SELECT OwnerJamCID as jamCID, COUNT(*) as n FROM Riffs
       WHERE UserName IS NULL OR UserName = '' GROUP BY OwnerJamCID`
    )
    .all() as { jamCID: string; n: number }[]
  for (const row of unknown) bump(row.jamCID, 'unknownAuthorRiffCount', row.n)
  return counts
}

// Kept until the Riffs table it was read from actually moves, exactly
// like cachedJamsWithDb below -- the counts don't depend on the jam-name
// filter text, so without this every keystroke in "filter jams..." would
// re-run both queries against a removable drive. Keyed by db and then by
// username, since switching either has to produce different numbers.
// Cleared wholesale by closeRiffLibraryDb, which is what a change of
// archive root goes through and which no signal check could see.
const jamOwnershipCache = new Map<
  Database.Database,
  Map<string, { counts: ReturnType<typeof queryJamOwnership>; riffsState: ScanCacheState }>
>()

function cachedJamOwnership(
  db: Database.Database,
  targetUser: string
): ReturnType<typeof queryJamOwnership> {
  const perUser = jamOwnershipCache.get(db) ?? new Map()
  jamOwnershipCache.set(db, perUser)
  const hit = perUser.get(targetUser)
  if (hit && isScanCacheCurrent(db, 'Riffs', hit.riffsState)) return hit.counts
  // Signal read BEFORE the queries, so a write landing between the two
  // makes the cache look stale next call rather than being missed.
  const riffsState = newScanCacheState(readTableSignal(db, 'Riffs'))
  const counts = queryJamOwnership(db, targetUser)
  perUser.set(targetUser, { counts, riffsState })
  return counts
}

/** Attaches jamOwnership.ts's two count fields to rows read from `db`.
 *
 * A jam with no riffs in this archive at all comes out 0/0, same as one
 * whose riffs are all somebody else's -- both mean "nothing of his to
 * import from here." That case is the BULK of a real LORE archive, not a
 * corner: measured 2026-09-28 on his own, 5,014 of 5,056 Jams rows are
 * name-only stubs LORE knows of but has never synced a single riff for,
 * and only 43 jams have any content at all. Treating an empty jam as
 * "cannot say" would make the whole filter a no-op on the one library it
 * was built for. Membership is what rescues a jam he IS in but has never
 * synced -- see LibraryBrowser.tsx's own never-hidden set, which the
 * live Endlesss membership list feeds. */
function attachJamOwnership(
  rows: RiffLibraryJam[],
  db: Database.Database,
  targetUser: string
): RiffLibraryJam[] {
  const counts = cachedJamOwnership(db, targetUser)
  return rows.map((row) => ({
    ...row,
    ownRiffCount: counts.get(row.jamCID)?.ownRiffCount ?? 0,
    unknownAuthorRiffCount: counts.get(row.jamCID)?.unknownAuthorRiffCount ?? 0
  }))
}

/** The jams in the configured archive, newest-riff-first.
 *
 * `targetUser` is opt-in: pass it to get each jam's authorship counts
 * (jamOwnership.ts) attached, leave it off to skip those queries
 * entirely. listJamsWithDb below deliberately leaves it off -- it runs on
 * every Discover roll and has no use for them. */
export function listJams(filterText: string, targetUser?: string): RiffLibraryJam[] {
  // The routing first: it can close a dead archive connection (and open a
  // new one), and the rows below must come from whichever is current.
  const routed =
    riffLibraryRootPath() === ownRiffLibraryRoot() ? new Set<string>() : ownRoutedJams()
  const db = getRiffLibraryDb()
  const withCounts = (rows: RiffLibraryJam[], from: Database.Database): RiffLibraryJam[] =>
    targetUser && targetUser.trim() !== ''
      ? attachJamOwnership(rows, from, targetUser.trim())
      : rows
  // A shared feed under a name that isn't a username: the empty one an
  // email login synced before 2026-10-07 (@shared/endlesssUsername) -- left
  // in the db, never listed, so there's one "Shared Feed", not two.
  const listable = (jam: RiffLibraryJam): boolean =>
    !jam.jamCID.startsWith('shared:') || isValidSharedFeedKey(jam.jamCID)
  if (riffLibraryRootPath() === ownRiffLibraryRoot()) {
    return db ? withCounts(queryJamsFromDb(db, filterText).filter(listable), db) : []
  }
  // Root external. Shared Feed always lives in sssketch's own database (see
  // dbForJam), and so do the jams sssketch synced itself that the archive
  // has no riffs for (ownRoutedJams, 2026-10-07) -- merged in from there, so
  // they show their real lastRiffTime (and riffs) instead of reading as
  // never-synced. Each such jam replaces the archive's name-only stub row:
  // one row per JamCID.
  const rows = db
    ? withCounts(
        queryJamsFromDb(db, filterText).filter((j) => listable(j) && !routed.has(j.jamCID)),
        db
      )
    : []
  const ownDb = openOwnRiffLibraryDb()
  const ownRows = withCounts(
    queryJamsFromDb(ownDb, filterText).filter(
      (j) =>
        (j.jamCID.startsWith('shared:') && listable(j)) ||
        j.jamCID === DISCOVERED_JAM_CID ||
        routed.has(j.jamCID)
    ),
    ownDb
  )
  return [...rows, ...ownRows].sort((a, b) => b.lastRiffTime - a.lastRiffTime)
}

// Cache for listJamsWithDb, below -- direct live report: even after
// discoverCandidates.ts's own perf fixes (a same-day series of real,
// measured bottlenecks), rolling still took several real seconds every
// time, and the remaining cost traced back to THIS function -- a real
// JOIN+GROUP BY+ORDER BY over the whole Jams/Riffs tables (listJams's
// own queryJamsFromDb), re-run from scratch on EVERY single roll (each
// of get-discover-candidates/get-random-discover-candidate/
// get-discover-library-scan-work calls this fresh, uncached, every
// time -- see main/index.ts's own call sites, the ONLY callers of this
// function in the whole codebase, all Discover-related).
//
// Was a plain 60-second TTL. Re-measured 2026-09-28 against Elling's own
// archive (5,056 jams, 372,319 riffs, a 541MB warehouse.db3 on a USB/ExFAT
// volume) after a log showed the SAME call at 0ms, then 1365ms, then 0ms
// again in one session:
//
//   listJams('') run0  1389 ms   (cold OS page cache)
//   listJams('') run1    41 ms
//   listJams('') run2    48 ms
//
// So the spread was never the query plan (it uses a covering index) -- it
// was the TTL throwing away a perfectly good answer once a minute and
// re-reading a big file off a removable volume whose pages macOS does not
// hold on to. The jam list does not change on human timescales; a LORE
// sync is not running every second.
//
// Now kept until the tables it was built from actually move
// (tableChangeSignal.ts -- at most one cheap signal query per db+table per
// CACHE_CHANGE_CHECK_INTERVAL_MS, measured at 1-7ms warm against that same
// archive). Exactly the treatment background efficiency B3 already gave
// discoverCandidates.ts's own riff-index and instrument-row caches, which
// had the same expire-on-a-timer problem.
//
// Still invalidated outright by closeRiffLibraryDb (above) -- switching
// riff archive roots must never serve a stale jam list from the PREVIOUS
// archive, and a signal check cannot see a change of file.
interface JamsWithDbCache {
  jams: { jamCID: string; db: Database.Database }[]
  /** Every db the list was read from, with the per-table state to check it
   * against. Jams for the list itself, Riffs because each row's
   * lastRiffTime is a MAX() over that table and drives the ordering. */
  sources: { db: Database.Database; jamsState: ScanCacheState; riffsState: ScanCacheState }[]
  /** The archive connection it was built with (null: none, e.g. the drive
   * was away at launch). Any other now -- the drive came back, or went --
   * and the list is rebuilt (review of b859757c). */
  archive: Database.Database | null
}
let cachedJamsWithDb: JamsWithDbCache | null = null

/** The db connections listJams('') actually reads. MUST track listJams'
 * own branch directly above -- the configured root always, plus the own db
 * separately when browsing is pointed somewhere else (that's the branch
 * that merges Shared Feed / discovered rows back in). */
function jamListSourceDbs(): Database.Database[] {
  const dbs: Database.Database[] = []
  const configured = getRiffLibraryDb()
  if (configured) dbs.push(configured)
  if (riffLibraryRootPath() !== ownRiffLibraryRoot()) {
    const own = openOwnRiffLibraryDb()
    if (!dbs.includes(own)) dbs.push(own)
  }
  return dbs
}

/** Resolves every currently-synced jam to the db its own Riffs/Stems rows
 * actually live in -- Discover's own library-wide candidate query
 * (discoverCandidates.ts) needs exactly this {jamCID, db} pairing, and
 * `dbForJam` above is this module's own established per-jam resolution
 * logic, just not previously exposed outside this file. */
export function listJamsWithDb(): { jamCID: string; db: Database.Database }[] {
  // The archive as of now: opens one whose file is back, closes one whose
  // file is gone (getRiffLibraryDb) -- a stat at most once a second while
  // open, one per call while away (a missing path; cheap).
  const archive = getRiffLibraryDb()
  if (
    cachedJamsWithDb &&
    cachedJamsWithDb.archive === archive &&
    cachedJamsWithDb.sources.every(
      ({ db, jamsState, riffsState }) =>
        isScanCacheCurrent(db, 'Jams', jamsState) && isScanCacheCurrent(db, 'Riffs', riffsState)
    )
  ) {
    return cachedJamsWithDb.jams
  }
  // Counted because the log cannot tell the two expensive outcomes apart:
  // a rebuild and a check that PASSED both cost ~300ms on a cold ExFAT
  // page cache (the COUNT(*) over 372k Riffs rows is the same read either
  // way), so "listJamsWithDb 312ms" is ambiguous on its own. This counter
  // next to sql:cache-check.Riffs in the same [work] line says which.
  countWork('sql:list-jams-rebuild')
  try {
    return rebuildJamsWithDb()
  } catch (err) {
    // A read through a dead archive connection (the drive pulled and pushed
    // back in under it): closed, then built once more through a new one, or
    // from the own db alone if the file is gone. The routing may have closed
    // it already, which leaves this read failing on a closed handle.
    if (!dropArchiveIfDead(err) && !(archive && !archive.open)) throw err
    return rebuildJamsWithDb()
  }
}

function rebuildJamsWithDb(): { jamCID: string; db: Database.Database }[] {
  // A table moved in some source db: which own jams the archive lacks may
  // have moved with it (a LORE sync, or one of sssketch's own).
  ownRoutedMemo = null
  // Read BEFORE the query, so a write landing between the two makes the
  // cache look stale on the next call rather than being missed entirely.
  const sources = jamListSourceDbs().map((db) => ({
    db,
    jamsState: newScanCacheState(readTableSignal(db, 'Jams')),
    riffsState: newScanCacheState(readTableSignal(db, 'Riffs'))
  }))
  const listed = listJams('')
    .map((jam) => {
      const db = dbForJam(jam.jamCID)
      return db ? { jamCID: jam.jamCID, db } : null
    })
    .filter((pair): pair is { jamCID: string; db: Database.Database } => pair !== null)
  // The archive's pairs first, then the own db's (each in listJams' order):
  // every consumer groups jams by db in this order, and where a stem is in
  // both (the Shared Feed holds 4,869 archive stems), the first db's copy is
  // the one taken -- the archive wins (2026-10-07).
  const ownDb = riffLibraryRootPath() === ownRiffLibraryRoot() ? null : openOwnRiffLibraryDb()
  const jams = ownDb
    ? [...listed.filter((p) => p.db !== ownDb), ...listed.filter((p) => p.db === ownDb)]
    : listed
  // No sources means no readable db at all (an unmounted external drive,
  // a never-synced warehouse). Caching that would make `every` on an empty
  // array trivially true and pin an empty jam list forever -- so leave the
  // cache alone and let the next call, which is cheap precisely because
  // there is nothing to read, pick the drive up the moment it returns.
  cachedJamsWithDb = sources.length > 0 ? { jams, sources, archive: getRiffLibraryDb() } : null
  return jams
}

interface RiffRow {
  RiffCID: string
  CreationTime: number
  BPMrnd: number
  BarLength: number
  UserName: string
  StemCID_1: string | null
  StemCID_2: string | null
  StemCID_3: string | null
  StemCID_4: string | null
  StemCID_5: string | null
  StemCID_6: string | null
  StemCID_7: string | null
  StemCID_8: string | null
}

interface StemLookupRow {
  StemCID: string
  CreatorUserName: string
}

// Raised 5x (200 -> 1000) per direct user request: some of Elling's real
// jams have 20,000+ riffs and the old 200-per-page size meant hitting the
// scroll-load-more boundary constantly while browsing. 1000 stays well
// clear of SQLite's default SQLITE_MAX_VARIABLE_NUMBER (32766, modern
// bundled versions). A page's rows can reference up to
// MAX_RIFFF_STEM_SLOTS distinct StemCIDs each, so listRiffs' own
// stem-creator batch lookup below is chunked rather than relying on
// staying under SQLITE_MAX_VARIABLE_NUMBER.
const RIFF_PAGE_SIZE = 1000

export function listRiffs(jamCID: string, filters: RiffFilters): RiffPage {
  const db = dbForJam(jamCID)
  const offset = filters.offset ?? 0
  const limit = filters.limit ?? RIFF_PAGE_SIZE
  if (!db) return { riffs: [], hasMore: false, nextOffset: offset }

  const conditions = ['OwnerJamCID = ?']
  const params: (string | number)[] = [jamCID]
  if (filters.dateFrom !== undefined) {
    conditions.push('CreationTime >= ?')
    params.push(filters.dateFrom)
  }
  if (filters.dateTo !== undefined) {
    conditions.push('CreationTime <= ?')
    params.push(filters.dateTo)
  }
  if (filters.bpmMin !== undefined) {
    conditions.push('ROUND(BPMrnd) >= ?')
    params.push(filters.bpmMin)
  }
  if (filters.bpmMax !== undefined) {
    conditions.push('ROUND(BPMrnd) <= ?')
    params.push(filters.bpmMax)
  }
  if (filters.root !== undefined) {
    conditions.push('Root = ?')
    params.push(filters.root)
  }
  if (filters.scale !== undefined) {
    conditions.push('Scale = ?')
    params.push(filters.scale)
  }
  if (filters.userName !== undefined) {
    conditions.push('UserName = ?')
    params.push(filters.userName)
  }

  const rows = db
    .prepare(
      `SELECT RiffCID, CreationTime, BPMrnd, BarLength, UserName,
              StemCID_1, StemCID_2, StemCID_3, StemCID_4, StemCID_5, StemCID_6, StemCID_7, StemCID_8
       FROM Riffs
       WHERE ${conditions.join(' AND ')}
       ORDER BY CreationTime DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset) as RiffRow[]

  // ONE query for the whole page's slots 9+, not one per riff. Empty for
  // an external OUROVEON/LORE warehouse, which has no such table.
  const extraByRiff = readExtraStemSlots(
    db,
    rows.map((row) => row.RiffCID)
  )
  const slotsByRiff = new Map(
    rows.map((row) => [
      row.RiffCID,
      mergeStemSlots(
        columnStemSlots(row as unknown as Record<string, unknown>),
        extraByRiff.get(row.RiffCID) ?? []
      )
    ])
  )

  // Batch-resolve every referenced StemCID's creator in one query, rather than
  // one query per stem — up to 20 stems x 1000 riffs would otherwise be 20,000
  // individual point lookups per page.
  const allStemCIDs = new Set<string>()
  for (const slots of slotsByRiff.values()) {
    for (const { stemCID } of slots) allStemCIDs.add(stemCID)
  }
  const stemCreators = new Map<string, string>()
  if (allStemCIDs.size > 0) {
    const cidList = [...allStemCIDs]
    // Chunked, because the old "worst case 8000 placeholders, comfortably
    // under SQLITE_MAX_VARIABLE_NUMBER" arithmetic no longer holds: a page
    // of 1000 rifffs can now reference up to 20 distinct stems each, i.e.
    // 20,000. Still legal, no longer comfortable, and not worth being
    // clever about.
    for (let i = 0; i < cidList.length; i += 900) {
      const chunk = cidList.slice(i, i + 900)
      const placeholders = chunk.map(() => '?').join(',')
      const stemRows = db
        .prepare(`SELECT StemCID, CreatorUserName FROM Stems WHERE StemCID IN (${placeholders})`)
        .all(...chunk) as StemLookupRow[]
      for (const s of stemRows) stemCreators.set(s.StemCID, s.CreatorUserName)
    }
  }

  const summaries: RiffLibraryRiffSummary[] = rows.map((row) => {
    const stemCIDs = (slotsByRiff.get(row.RiffCID) ?? []).map((s) => s.stemCID)
    // One stat per stem, same count of syscalls as the existsSync this
    // was: a 0-byte placeholder is not a cached stem.
    const cachedStemCount = stemCIDs.filter((cid) =>
      isUsableStemFile(resolveStemPath(jamCID, cid))
    ).length
    const creatorNames = stemCIDs.map((cid) => stemCreators.get(cid) ?? '')
    return {
      riffCID: row.RiffCID,
      creationTime: row.CreationTime,
      bpm: row.BPMrnd,
      barLength: row.BarLength,
      userName: row.UserName,
      stemCount: stemCIDs.length,
      cachedStemCount,
      ownerFraction: computeOwnerFraction(creatorNames, filters.targetUser)
    }
  })

  let riffs = summaries
  if (filters.onlyFullyCached) riffs = riffs.filter((s) => s.cachedStemCount === s.stemCount)
  if (filters.onlyContainsUser) riffs = riffs.filter((s) => s.ownerFraction > 0)

  return {
    riffs,
    // Computed from the raw page (rows.length) against the LIMIT actually
    // used, not the onlyFullyCached-filtered summaries and not a hardcoded
    // RIFF_PAGE_SIZE -- otherwise a page where every riff happens to be
    // filtered out would look like "no more data" even though later pages
    // might have plenty, and a custom smaller `limit` would never report
    // hasMore correctly.
    hasMore: rows.length === limit,
    nextOffset: offset + rows.length
  }
}

interface FullRiffRow extends RiffRow {
  OwnerJamCID: string
  GainsJSON: string | null
  Root: number | null
  Scale: number | null
}

interface FullStemRow {
  StemCID: string
  CreatorUserName: string
  PresetName: string
  Instrument: number
  BPMrnd: number | null
  Length16s: number | null
  FileEndpoint: string | null
  FileBucket: string | null
  FileKey: string | null
}

/** Every db that might hold a bare riffCID's row, in lookup order: the
 * currently-configured browsing root first (the common case -- a real jam,
 * whether sssketch's own or an external LORE archive), then sssketch's own
 * database as a fallback. A bare riffCID lookup has no jamCID to route by
 * (unlike dbForJam), so a shared-feed riff -- which only ever lives in the
 * own database, see dbForJam's own doc comment -- would otherwise be
 * invisible to resolveRiff/resolveRiffWithContext/downloadMissingStems
 * whenever an external archive is the configured root. Skips the fallback
 * when the configured root already IS the own root, to avoid a redundant
 * second lookup against the exact same file. Also reused by
 * stemCategoriesStore.ts/stemFeatureCacheStore.ts to validate a stem's
 * StemCID against every db that might hold its Stems row -- the same
 * "which physical db files might have a real row" logic applies identically
 * whether the row in question is a Riffs row or a Stems row, since both
 * live in the same candidate database files. */
export function candidateDbsForRiff(): Database.Database[] {
  const primary = getRiffLibraryDb()
  const dbs: Database.Database[] = primary ? [primary] : []
  if (riffLibraryRootPath() !== ownRiffLibraryRoot()) dbs.push(openOwnRiffLibraryDb())
  return dbs
}

/** Whether any of `dbs` holds a riff. Share readiness S6: Discover and radio say what to do when
 * the library is empty, rather than rolling nothing and saying nothing. */
export function dbsHaveRiffs(dbs: readonly Database.Database[]): boolean {
  return dbs.some((db) => db.prepare('SELECT 1 FROM Riffs LIMIT 1').get() !== undefined)
}

/** dbsHaveRiffs over the library as it stands: the configured root's db (an archive may be
 * unreachable) and sssketch's own. */
export function riffLibraryHasRiffs(): boolean {
  return dbsHaveRiffs(candidateDbsForRiff())
}

function buildResolvedRiff(
  db: Database.Database,
  riffRow: FullRiffRow,
  // Slots 9+ from RiffStemsExtra, already read in one batched query by the
  // caller. Empty for an external OUROVEON/LORE warehouse, which has no
  // such table and cannot be given one -- so <=8 stems there is the same
  // code path as everything else, not a special case.
  extraSlots: readonly StemSlotRef[] = []
): RiffLibraryResolvedRiff {
  // GainsJSON keys are slot numbers as strings (e.g. {"1": 0.8}) — malformed
  // or absent JSON just means every stem falls back to the default gain,
  // not a thrown error.
  let gains: Record<string, number> = {}
  if (riffRow.GainsJSON) {
    try {
      gains = JSON.parse(riffRow.GainsJSON) as Record<string, number>
    } catch (err) {
      console.error(`resolveRiff: malformed GainsJSON for riff ${riffRow.RiffCID}:`, err)
    }
  }

  const slots = mergeStemSlots(
    columnStemSlots(riffRow as unknown as Record<string, unknown>),
    extraSlots
  )

  const stems: RiffLibraryResolvedStem[] = slots.map(({ slot, stemCID }) => {
    const stemRow = db
      .prepare(
        `SELECT StemCID, CreatorUserName, PresetName, Instrument, BPMrnd, Length16s,
                FileEndpoint, FileBucket, FileKey
         FROM Stems WHERE StemCID = ?`
      )
      .get(stemCID) as FullStemRow | undefined
    const path = resolveStemPath(riffRow.OwnerJamCID, stemCID)
    // This stem's OWN bpm/length, not the riff's — a stem can be a shorter
    // loop tiled across a longer riff (the same distinction sssketch's own
    // Stem.barLength vs Rifff.barLength already makes for drag-and-drop
    // imports). Length16s (the stem's native loop length in sixteenth
    // notes), not the Stems table's own BarLength column — verified against
    // 300 real cached stems' actual decoded audio: Length16s/16 matched
    // measured duration 300/300 times, BarLength matched essentially never
    // (1/300, coincidental). BarLength on this table isn't the stem's own
    // bar count; using it produced a durationSec many times longer than the
    // stem's real audio, which the native engine then padded with silence
    // to fill out each scheduled tile — the exact "starts, then goes silent"
    // bug reported for riff 5e203540. Falls back to the riff's own bpm/
    // 1-bar length only if this stem's row is somehow missing that data.
    const stemBpm = stemRow?.BPMrnd ?? riffRow.BPMrnd
    const stemBarLength = (stemRow?.Length16s ?? 16) / 16
    const durationSec = stemBarLength * (60 / stemBpm) * 4
    return {
      stemCID,
      slot,
      // A 0-byte placeholder (an unfinished LORE download) reads as not
      // downloaded, so every caller sends it through downloadMissingStems.
      path: isUsableStemFile(path) ? path : null,
      gain: gains[String(slot)] ?? 1.0,
      creatorUserName: stemRow?.CreatorUserName ?? '',
      presetName: stemRow?.PresetName ?? '',
      instrumentMask: stemRow?.Instrument ?? 0,
      durationSec,
      barLength: stemBarLength,
      // Kept on the returned object, not just consumed for downloadUrl below
      // -- RiffLibraryResolvedStem's own doc comment says a warehouse writer
      // needs these as their own columns, and writeRiffDetail's
      // updateStemDetail overwrites FileEndpoint/FileBucket/FileKey
      // unconditionally from exactly these fields. Dropping them here meant
      // writing a resolved riff back nulled out a real synced stem's
      // download columns.
      fileEndpoint: stemRow?.FileEndpoint ?? undefined,
      fileBucket: stemRow?.FileBucket ?? undefined,
      fileKey: stemRow?.FileKey ?? undefined,
      downloadUrl:
        stemRow?.FileEndpoint && stemRow?.FileKey
          ? stemDownloadUrl(stemRow.FileEndpoint, stemRow.FileBucket ?? '', stemRow.FileKey)
          : null
    }
  })

  // Kept riffs only live in the own db, the only one with RadioHeartImport.
  const heartName =
    riffRow.OwnerJamCID === DISCOVERED_JAM_CID ? heartNameForRiff(db, riffRow.RiffCID) : null

  return {
    riffCID: riffRow.RiffCID,
    ...(heartName !== null ? { name: heartName } : {}),
    bpm: riffRow.BPMrnd,
    barLength: riffRow.BarLength,
    key: resolveKeyName(riffRow.Root, riffRow.Scale),
    creationTime: riffRow.CreationTime,
    stems
  }
}

export function resolveRiff(riffCID: string): RiffLibraryResolvedRiff | null {
  for (const db of candidateDbsForRiff()) {
    const riffRow = db
      .prepare(
        `SELECT RiffCID, OwnerJamCID, CreationTime, BPMrnd, BarLength, UserName, GainsJSON, Root, Scale,
                StemCID_1, StemCID_2, StemCID_3, StemCID_4, StemCID_5, StemCID_6, StemCID_7, StemCID_8
         FROM Riffs WHERE RiffCID = ?`
      )
      .get(riffCID) as FullRiffRow | undefined
    if (riffRow) {
      return buildResolvedRiff(db, riffRow, readExtraStemSlots(db, [riffCID]).get(riffCID) ?? [])
    }
  }
  return null
}

export interface RiffContextResult {
  jamCID: string
  /** Offset to pass to listRiffs(jamCID, { offset }) to fetch a ~20-riff
   * page centered on the target riff (10 before, 10 after -- clamped to 0
   * for a riff near the very start of the jam). */
  offset: number
  /** The riffCID actually matched -- identical to the input except when the
   * typo-tolerant fallback below kicked in, so the caller can highlight the
   * right row even if the pasted ID had a case/whitespace mismatch. */
  matchedRiffCID: string
  /** This riff's own raw rank in its jam's CreationTime DESC ordering (0 =
   * newest) -- the number `offset` above is derived from (rank - 10,
   * clamped). Exposed separately for a downstream feature that needs to
   * center a differently-sized window around the real rank rather than
   * this function's own fixed "10 before" page. */
  rank: number
}

const RIFF_CONTEXT_WINDOW_BEFORE = 10

/** A LORE stem's durationSec as resolveRiff set it before any bake: its own Length16s and
 * BPMrnd. null for a path that isn't a LORE stem (one with an extension) or a stem no library
 * knows. The re-oned copy rebuild uses it (reonedRebuild.ts's setStemMetadataDurationLookup):
 * a stem's first re-one rotated by these seconds per bar, before APPLY_BAKE stored the measured
 * length. */
export function stemMetadataDurationSec(path: string): number | null {
  const stemCID = basename(path)
  if (stemCID.includes('.')) return null
  for (const db of candidateDbsForRiff()) {
    const row = db.prepare('SELECT BPMrnd, Length16s FROM Stems WHERE StemCID = ?').get(stemCID) as
      { BPMrnd: number | null; Length16s: number | null } | undefined
    if (row === undefined) continue
    if (!(row.BPMrnd && row.BPMrnd > 0)) return null
    return ((row.Length16s ?? 16) / 16) * (60 / row.BPMrnd) * 4
  }
  return null
}

/** Resolves which jam a riffCID belongs to and an offset centered on it,
 * for "jump straight to this riff" lookups -- unlike resolveRiff, this
 * doesn't fetch stem data; the caller re-uses the existing listRiffs(jamCID,
 * { offset }) to actually fetch the surrounding page, exactly like normal
 * jam browsing already does.
 *
 * The local warehouse is a flat cache: a riff's row is either fully present
 * or it isn't in the database at all -- there's no separate index of
 * "riffs known to exist but not synced" to fall back on. The one real
 * exception is user error, so a failed exact match retries once, trimmed
 * and case-insensitive, before giving up. Returns null (never throws) if
 * neither matches, or if the warehouse itself is unavailable. */
export function resolveRiffWithContext(riffCID: string): RiffContextResult | null {
  const trimmed = riffCID.trim()

  for (const db of candidateDbsForRiff()) {
    const exactRow = db
      .prepare(`SELECT RiffCID, OwnerJamCID, CreationTime FROM Riffs WHERE RiffCID = ?`)
      .get(trimmed) as { RiffCID: string; OwnerJamCID: string; CreationTime: number } | undefined
    const row =
      exactRow ??
      (db
        .prepare(
          `SELECT RiffCID, OwnerJamCID, CreationTime FROM Riffs WHERE RiffCID = ? COLLATE NOCASE`
        )
        .get(trimmed) as { RiffCID: string; OwnerJamCID: string; CreationTime: number } | undefined)
    if (!row) continue

    // Rank in the jam's most-recent-first ordering (listRiffs' own
    // `ORDER BY CreationTime DESC`, unchanged) -- how many riffs in this jam
    // are newer than this one. Riffs sharing the exact same unix-second
    // CreationTime have no stable secondary sort in listRiffs either; this is
    // an accepted, pre-existing simplification (see the design spec) that can
    // land the window a few positions off-center in that rare case.
    const { rank } = db
      .prepare(`SELECT COUNT(*) as rank FROM Riffs WHERE OwnerJamCID = ? AND CreationTime > ?`)
      .get(row.OwnerJamCID, row.CreationTime) as { rank: number }

    return {
      jamCID: row.OwnerJamCID,
      offset: Math.max(0, rank - RIFF_CONTEXT_WINDOW_BEFORE),
      matchedRiffCID: row.RiffCID,
      rank
    }
  }
  return null
}

/** Downloads one stem's audio to exactly the local path resolveStemPath
 * already expects it at, so it becomes indistinguishable from a normally
 * LORE-synced file the moment it lands — every other reader (listRiffs'
 * cachedStemCount, resolveRiff's own path field, the native engine) just
 * sees it there. Writes to a `.downloading` sibling then renames into place,
 * so a killed/failed download never leaves a corrupt partial file sitting at
 * the real path. Returns false (never throws) on any network or filesystem
 * failure — the caller treats a failed stem as "still missing," not fatal to
 * the rest of the riff's downloads.
 *
 * "On disk" means isUsableStemFile (2026-10-01): a 0-byte placeholder left
 * by an unfinished LORE download is downloaded over, and the rename
 * replaces it in place; an empty response body is never written.
 *
 * Availability (2026-09-22, see @shared/stemAvailability): a stem already on
 * disk is answered locally without any request at all; a stem already known
 * unfetchable, or one on a host learned to be refusing anonymous downloads,
 * is skipped before the fetch; a permanent failure (403/404/410) is
 * remembered durably, a soft one only spends a small in-session retry
 * budget. Per-failure console noise is gone on purpose — hundreds of
 * identical `HTTP 403` lines was the reported symptom, not the diagnosis —
 * replaced by one line per learned host plus the dev work counters' own
 * once-a-minute summary. */
async function downloadOneStem(
  jamCID: string,
  stemCID: string,
  downloadUrl: string
): Promise<boolean> {
  return (await downloadOneStemStatus(jamCID, stemCID, downloadUrl)) === 'ok'
}

/** downloadOneStem with the failure kind kept (artist "analyse overnight",
 * 2026-10-01): `unavailable` only when StemUnavailable now says so (a
 * permanent failure, or a denied host); everything else that failed --
 * the network, a refused write on a drive pulled mid-queue (EACCES on
 * mkdir), this session's retry budget spent -- is `transient`. */
async function downloadOneStemStatus(
  jamCID: string,
  stemCID: string,
  downloadUrl: string
): Promise<StemDownloadStatus> {
  const finalPath = resolveStemPath(jamCID, stemCID)
  // Local presence always wins over anything the availability list says.
  // A 0-byte placeholder is not presence: it is downloaded over, in place.
  if (isUsableStemFile(finalPath)) return 'ok'
  const ownDb = openOwnRiffLibraryDb()
  if (!shouldAttemptStemDownload(ownDb, stemCID, downloadUrl)) {
    return isStemUnavailable(ownDb, stemCID) ? 'unavailable' : 'transient'
  }
  try {
    const res = await fetch(downloadUrl)
    if (!res.ok) {
      recordStemDownloadFailure(ownDb, stemCID, downloadUrl, { kind: 'http', status: res.status })
      return isStemUnavailable(ownDb, stemCID) ? 'unavailable' : 'transient'
    }
    const bytes = Buffer.from(await res.arrayBuffer())
    // An empty body would become a new 0-byte placeholder: a soft failure.
    if (bytes.length === 0) {
      countWork('stem-download:empty-body')
      recordStemDownloadFailure(ownDb, stemCID, downloadUrl, { kind: 'network' })
      return 'transient'
    }
    mkdirSync(dirname(finalPath), { recursive: true })
    const tmpPath = `${finalPath}.downloading`
    writeFileSync(tmpPath, bytes)
    renameSync(tmpPath, finalPath)
    recordStemDownloadSuccess(ownDb, stemCID)
    return 'ok'
  } catch {
    // A filesystem failure lands here too, not just a network one -- both
    // are genuinely retryable, and neither says anything about whether the
    // stem still exists on Endlesss's side.
    countWork('stem-download:threw')
    recordStemDownloadFailure(ownDb, stemCID, downloadUrl, { kind: 'network' })
    return 'transient'
  }
}

/** Fetches every currently-uncached, populated stem for a riff directly from
 * its (public, unauthenticated — see stemDownloadUrl's doc comment) storage
 * URL, then re-resolves the riff so the caller gets back fresh path values
 * without a second round trip of its own. Downloads run in parallel (a riff
 * has at most 8 stems) rather than sequentially. Returns null if the riff
 * itself can't be resolved (unavailable warehouse, unknown riffCID) — same
 * "never throws" convention as every other warehouse function. */
export async function downloadMissingStems(
  riffCID: string
): Promise<RiffLibraryResolvedRiff | null> {
  // Same candidate-db search resolveRiff itself uses -- a shared-feed riff
  // only ever lives in sssketch's own database, invisible to a plain
  // getRiffLibraryDb() lookup whenever an external archive is the
  // configured root (see candidateDbsForRiff's own doc comment).
  let ownerJamCID: string | undefined
  for (const db of candidateDbsForRiff()) {
    const riffRow = db.prepare('SELECT OwnerJamCID FROM Riffs WHERE RiffCID = ?').get(riffCID) as
      { OwnerJamCID: string } | undefined
    if (riffRow) {
      ownerJamCID = riffRow.OwnerJamCID
      break
    }
  }
  if (ownerJamCID === undefined) return null

  const resolved = resolveRiff(riffCID)
  if (!resolved) return null
  const missing = resolved.stems.filter((s) => s.path === null && s.downloadUrl !== null)
  await Promise.all(missing.map((s) => downloadOneStem(ownerJamCID, s.stemCID, s.downloadUrl!)))
  return resolveRiff(riffCID)
}

/** One stem's audio for the artist analysis queue -- the SAME download
 * (local-first, StemUnavailable-aware, atomic rename) every riff download
 * uses, without resolving or downloading the rest of its riff. The caller
 * (takeArtistScanBatch) checks the archive is mounted first: with it away,
 * an archive stem is in no db here and would read as `unavailable`. */
export async function downloadStemForAnalysis(
  jamCID: string,
  stemCID: string
): Promise<{ status: StemDownloadStatus; path: string | null }> {
  const path = resolveStemPath(jamCID, stemCID)
  if (isUsableStemFile(path)) return { status: 'ok', path }
  for (const db of candidateDbsForRiff()) {
    let row:
      { FileEndpoint: string | null; FileBucket: string | null; FileKey: string | null } | undefined
    try {
      row = db
        .prepare(`SELECT FileEndpoint, FileBucket, FileKey FROM Stems WHERE StemCID = ?`)
        .get(stemCID) as typeof row
    } catch {
      // A db that cannot be read right now (the drive going away) -- retry later.
      return { status: 'transient', path: null }
    }
    if (!row) continue
    if (!row.FileEndpoint || !row.FileKey) return { status: 'unavailable', path: null }
    const url = stemDownloadUrl(row.FileEndpoint, row.FileBucket ?? '', row.FileKey)
    const status = await downloadOneStemStatus(jamCID, stemCID, url)
    return { status, path: status === 'ok' ? path : null }
  }
  // In no db at all, with every db reachable: the stem is gone.
  return { status: 'unavailable', path: null }
}

export { getRiffLibraryDb }
