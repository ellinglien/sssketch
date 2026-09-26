import { existsSync, mkdirSync, writeFileSync, renameSync, readFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
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
import { openOwnRiffLibraryDb, ownRiffLibraryRoot } from './riffLibrarySchema'
import { DISCOVERED_JAM_CID } from '@shared/discoveredRoom'
import {
  recordStemDownloadFailure,
  recordStemDownloadSuccess,
  shouldAttemptStemDownload
} from './stemAvailability'
import { countWork } from './workCounters'

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
 * LibraryBrowser.tsx's own loadStoredRiffLibraryUsername() localStorage
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

/** Lazily opens the warehouse DB read-only, with a busy-timeout so a moment
 * of LORE writing concurrently degrades gracefully instead of hanging.
 * Returns null (never throws) if the file doesn't exist or can't be opened —
 * callers treat that as "library unavailable", not a crash. */
function getRiffLibraryDb(): Database.Database | null {
  if (cachedDb) return cachedDb
  if (!existsSync(riffLibraryDbPath())) return null
  try {
    cachedDb = new Database(riffLibraryDbPath(), {
      readonly: true,
      fileMustExist: true,
      timeout: 2000
    })
    return cachedDb
  } catch (err) {
    console.error('getRiffLibraryDb: failed to open warehouse.db3:', err)
    return null
  }
}

function closeRiffLibraryDb(): void {
  cachedDb?.close()
  cachedDb = null
  cachedJamsWithDb = null
}

export function riffLibraryAvailable(): boolean {
  return getRiffLibraryDb() !== null
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
  if (jamCID.startsWith('shared:') || root === ownRiffLibraryRoot()) {
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
 * Everything else follows whatever root is currently configured
 * (getRiffLibraryDb). */
function dbForJam(jamCID: string): Database.Database | null {
  return jamCID.startsWith('shared:') || jamCID === DISCOVERED_JAM_CID
    ? openOwnRiffLibraryDb()
    : getRiffLibraryDb()
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

export function listJams(filterText: string): RiffLibraryJam[] {
  const db = getRiffLibraryDb()
  const rows = db ? queryJamsFromDb(db, filterText) : []
  // Shared Feed always lives in sssketch's own database regardless of
  // which root is configured for browsing (see dbForJam) -- when that's
  // NOT the currently active root, merge its own real Jams row(s) in
  // separately, so "Shared Feed" still shows its real lastRiffTime instead
  // of silently reading as never-synced just because browsing is currently
  // pointed at an external archive.
  if (riffLibraryRootPath() === ownRiffLibraryRoot()) return rows
  const ownRows = queryJamsFromDb(openOwnRiffLibraryDb(), filterText).filter(
    (j) => j.jamCID.startsWith('shared:') || j.jamCID === DISCOVERED_JAM_CID
  )
  return [...rows, ...ownRows].sort((a, b) => b.lastRiffTime - a.lastRiffTime)
}

// TTL cache for listJamsWithDb, below -- direct live report: even after
// discoverCandidates.ts's own perf fixes (a same-day series of real,
// measured bottlenecks), rolling still took several real seconds every
// time, and the remaining cost traced back to THIS function -- a real
// JOIN+GROUP BY+ORDER BY over the whole Jams/Riffs tables (listJams's
// own queryJamsFromDb), re-run from scratch on EVERY single roll (each
// of get-discover-candidates/get-random-discover-candidate/
// get-discover-library-scan-targets calls this fresh, uncached, every
// time -- see main/index.ts's own call sites, the ONLY callers of this
// function in the whole codebase, all Discover-related). Confirmed live:
// 53ms-1.4s per call on a real 5,057-jam library, non-trivial and fully
// avoidable, since the real jam list doesn't change on human timescales
// (LORE sync isn't running every second). Invalidated by
// closeRiffLibraryDb (above) -- switching riff archive roots must never
// serve a stale jam list from the PREVIOUS archive.
const JAMS_WITH_DB_CACHE_TTL_MS = 60_000
let cachedJamsWithDb: {
  jams: { jamCID: string; db: Database.Database }[]
  computedAt: number
} | null = null

/** Resolves every currently-synced jam to the db its own Riffs/Stems rows
 * actually live in -- Discover's own library-wide candidate query
 * (discoverCandidates.ts) needs exactly this {jamCID, db} pairing, and
 * `dbForJam` above is this module's own established per-jam resolution
 * logic, just not previously exposed outside this file. */
export function listJamsWithDb(): { jamCID: string; db: Database.Database }[] {
  if (cachedJamsWithDb && Date.now() - cachedJamsWithDb.computedAt < JAMS_WITH_DB_CACHE_TTL_MS) {
    return cachedJamsWithDb.jams
  }
  const jams = listJams('')
    .map((jam) => {
      const db = dbForJam(jam.jamCID)
      return db ? { jamCID: jam.jamCID, db } : null
    })
    .filter((pair): pair is { jamCID: string; db: Database.Database } => pair !== null)
  cachedJamsWithDb = { jams, computedAt: Date.now() }
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
// bundled versions) that listRiffs' own stem-creator batch lookup below
// depends on -- worst case one page's rows reference up to 8 distinct
// StemCIDs each, i.e. 8000 placeholders in that IN (...) query, comfortably
// under the limit.
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

  // Batch-resolve every referenced StemCID's creator in one query, rather than
  // one query per stem — up to 8 stems x 200 riffs would otherwise be 1600
  // individual point lookups per page.
  const allStemCIDs = new Set<string>()
  for (const row of rows) {
    for (let slot = 1; slot <= 8; slot++) {
      const cid = row[`StemCID_${slot}` as keyof RiffRow] as string | null
      if (cid) allStemCIDs.add(cid)
    }
  }
  const stemCreators = new Map<string, string>()
  if (allStemCIDs.size > 0) {
    const cidList = [...allStemCIDs]
    const placeholders = cidList.map(() => '?').join(',')
    const stemRows = db
      .prepare(`SELECT StemCID, CreatorUserName FROM Stems WHERE StemCID IN (${placeholders})`)
      .all(...cidList) as StemLookupRow[]
    for (const s of stemRows) stemCreators.set(s.StemCID, s.CreatorUserName)
  }

  const summaries: RiffLibraryRiffSummary[] = rows.map((row) => {
    const stemCIDs: string[] = []
    for (let slot = 1; slot <= 8; slot++) {
      const cid = row[`StemCID_${slot}` as keyof RiffRow] as string | null
      if (cid) stemCIDs.push(cid)
    }
    const cachedStemCount = stemCIDs.filter((cid) =>
      existsSync(resolveStemPath(jamCID, cid))
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

function buildResolvedRiff(db: Database.Database, riffRow: FullRiffRow): RiffLibraryResolvedRiff {
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

  const slots: { slot: number; stemCID: string }[] = []
  for (let slot = 1; slot <= 8; slot++) {
    const cid = riffRow[`StemCID_${slot}` as keyof FullRiffRow] as string | null
    if (cid) slots.push({ slot, stemCID: cid })
  }

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
      path: existsSync(path) ? path : null,
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

  return {
    riffCID: riffRow.RiffCID,
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
    if (riffRow) return buildResolvedRiff(db, riffRow)
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
  const finalPath = resolveStemPath(jamCID, stemCID)
  // Local presence always wins over anything the availability list says.
  if (existsSync(finalPath)) return true
  const ownDb = openOwnRiffLibraryDb()
  if (!shouldAttemptStemDownload(ownDb, stemCID, downloadUrl)) return false
  try {
    const res = await fetch(downloadUrl)
    if (!res.ok) {
      recordStemDownloadFailure(ownDb, stemCID, downloadUrl, { kind: 'http', status: res.status })
      return false
    }
    const bytes = Buffer.from(await res.arrayBuffer())
    mkdirSync(dirname(finalPath), { recursive: true })
    const tmpPath = `${finalPath}.downloading`
    writeFileSync(tmpPath, bytes)
    renameSync(tmpPath, finalPath)
    recordStemDownloadSuccess(ownDb, stemCID)
    return true
  } catch {
    // A filesystem failure lands here too, not just a network one -- both
    // are genuinely retryable, and neither says anything about whether the
    // stem still exists on Endlesss's side.
    countWork('stem-download:threw')
    recordStemDownloadFailure(ownDb, stemCID, downloadUrl, { kind: 'network' })
    return false
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

export { getRiffLibraryDb }
