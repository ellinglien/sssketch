import { existsSync, mkdirSync, writeFileSync, renameSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { app } from 'electron'
import Database from 'better-sqlite3'
import type {
  LoreJam,
  LoreRiffSummary,
  LoreResolvedRiff,
  LoreResolvedStem,
  RiffFilters,
  RiffPage
} from '@shared/loreLibrary'
import { computeOwnerFraction, stemDownloadUrl, resolveKeyName } from '@shared/loreLibrary'
import { ownWarehouseRoot } from './loreWarehouseSchema'

const WAREHOUSE_PREFS_FILENAME = 'loreWarehousePrefs.json'

function warehousePrefsPath(): string {
  return join(app.getPath('userData'), WAREHOUSE_PREFS_FILENAME)
}

/** Test-only seam: points the module at a fixture warehouse instead of the
 * real one, bypassing prefs entirely. Pass null to clear the override and
 * fall back to reading prefs again (for tests exercising warehouseRootPath
 * itself). Also resets the cached connection, since a previously-opened DB
 * handle would otherwise keep pointing at the old root. */
let warehouseRootOverride: string | null = null
export function setWarehouseRootForTests(root: string | null): void {
  warehouseRootOverride = root
  closeWarehouseDb()
}

/** Where the user's LORE-style warehouse lives -- user-relocatable (see
 * setWarehouseRoot). Defaults to sssketch's own self-built warehouse
 * (ownWarehouseRoot(), populated by loreWarehouseSync.ts's background sync)
 * until a user explicitly points this at a real, externally-managed
 * OUROVEON-synced folder via the folder picker -- see the design spec's
 * Favourites + external-warehouse compatibility section
 * (docs/superpowers/specs/2026-08-09-lore-warehouse-sync-design.md).
 * Once a prefs file exists, whatever root is saved there always wins; this
 * default is only consulted on a genuinely first-ever launch. Read fresh
 * every call rather than cached, matching projectLibrary.ts's own
 * libraryRootPath convention. */
export function warehouseRootPath(): string {
  if (warehouseRootOverride !== null) return warehouseRootOverride
  const path = warehousePrefsPath()
  if (!existsSync(path)) return ownWarehouseRoot()
  try {
    const prefs = JSON.parse(readFileSync(path, 'utf-8')) as { root?: string }
    return prefs.root ?? ownWarehouseRoot()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`warehouseRootPath: failed to read ${path}: ${message}`)
    return ownWarehouseRoot()
  }
}

/** Persists a new warehouse root and closes the cached DB connection, since
 * it would otherwise keep pointing at the old root's file. */
export function setWarehouseRoot(newRoot: string): void {
  try {
    writeFileSync(warehousePrefsPath(), JSON.stringify({ root: newRoot }, null, 2), 'utf-8')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`setWarehouseRoot: failed to write ${warehousePrefsPath()}: ${message}`)
  }
  closeWarehouseDb()
}

function warehouseDbPath(): string {
  return join(warehouseRootPath(), 'cache', 'common', 'warehouse.db3')
}

let cachedDb: Database.Database | null = null

/** Lazily opens the warehouse DB read-only, with a busy-timeout so a moment
 * of LORE writing concurrently degrades gracefully instead of hanging.
 * Returns null (never throws) if the file doesn't exist or can't be opened —
 * callers treat that as "library unavailable", not a crash. */
function getWarehouseDb(): Database.Database | null {
  if (cachedDb) return cachedDb
  if (!existsSync(warehouseDbPath())) return null
  try {
    cachedDb = new Database(warehouseDbPath(), {
      readonly: true,
      fileMustExist: true,
      timeout: 2000
    })
    return cachedDb
  } catch (err) {
    console.error('loreWarehouse: failed to open warehouse.db3:', err)
    return null
  }
}

function closeWarehouseDb(): void {
  cachedDb?.close()
  cachedDb = null
}

export function warehouseAvailable(): boolean {
  return getWarehouseDb() !== null
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
  const root = warehouseRootPath()
  if (root === ownWarehouseRoot()) {
    return join(app.getPath('userData'), 'endlesss-cache', 'stems', shard, stemCID)
  }
  return join(root, 'cache', 'common', 'stem_v2', jamCID, shard, stemCID)
}

export function listJams(filterText: string): LoreJam[] {
  const db = getWarehouseDb()
  if (!db) return []
  const rows = db
    .prepare(
      `SELECT j.JamCID as jamCID, j.PublicName as name, COALESCE(MAX(r.CreationTime), 0) as lastRiffTime
       FROM Jams j
       LEFT JOIN Riffs r ON r.OwnerJamCID = j.JamCID
       WHERE j.PublicName LIKE ?
       GROUP BY j.JamCID
       ORDER BY lastRiffTime DESC`
    )
    .all(`%${filterText}%`) as LoreJam[]
  return rows
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
  const db = getWarehouseDb()
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

  const summaries: LoreRiffSummary[] = rows.map((row) => {
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

export function resolveRiff(riffCID: string): LoreResolvedRiff | null {
  const db = getWarehouseDb()
  if (!db) return null

  const riffRow = db
    .prepare(
      `SELECT RiffCID, OwnerJamCID, CreationTime, BPMrnd, BarLength, UserName, GainsJSON, Root, Scale,
              StemCID_1, StemCID_2, StemCID_3, StemCID_4, StemCID_5, StemCID_6, StemCID_7, StemCID_8
       FROM Riffs WHERE RiffCID = ?`
    )
    .get(riffCID) as FullRiffRow | undefined
  if (!riffRow) return null

  // GainsJSON keys are slot numbers as strings (e.g. {"1": 0.8}) — malformed
  // or absent JSON just means every stem falls back to the default gain,
  // not a thrown error.
  let gains: Record<string, number> = {}
  if (riffRow.GainsJSON) {
    try {
      gains = JSON.parse(riffRow.GainsJSON) as Record<string, number>
    } catch (err) {
      console.error(`loreWarehouse: malformed GainsJSON for riff ${riffCID}:`, err)
    }
  }

  const slots: { slot: number; stemCID: string }[] = []
  for (let slot = 1; slot <= 8; slot++) {
    const cid = riffRow[`StemCID_${slot}` as keyof FullRiffRow] as string | null
    if (cid) slots.push({ slot, stemCID: cid })
  }

  const stems: LoreResolvedStem[] = slots.map(({ slot, stemCID }) => {
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
    stems
  }
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
  const db = getWarehouseDb()
  if (!db) return null

  const trimmed = riffCID.trim()
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
  if (!row) return null

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
    matchedRiffCID: row.RiffCID
  }
}

/** Downloads one stem's audio to exactly the local path resolveStemPath
 * already expects it at, so it becomes indistinguishable from a normally
 * LORE-synced file the moment it lands — every other reader (listRiffs'
 * cachedStemCount, resolveRiff's own path field, the native engine) just
 * sees it there. Writes to a `.downloading` sibling then renames into place,
 * so a killed/failed download never leaves a corrupt partial file sitting at
 * the real path. Returns false (never throws) on any network or filesystem
 * failure — the caller treats a failed stem as "still missing," not fatal to
 * the rest of the riff's downloads. */
async function downloadOneStem(
  jamCID: string,
  stemCID: string,
  downloadUrl: string
): Promise<boolean> {
  try {
    const res = await fetch(downloadUrl)
    if (!res.ok) {
      console.error(`loreWarehouse: download failed for stem ${stemCID}: HTTP ${res.status}`)
      return false
    }
    const bytes = Buffer.from(await res.arrayBuffer())
    const finalPath = resolveStemPath(jamCID, stemCID)
    mkdirSync(dirname(finalPath), { recursive: true })
    const tmpPath = `${finalPath}.downloading`
    writeFileSync(tmpPath, bytes)
    renameSync(tmpPath, finalPath)
    return true
  } catch (err) {
    console.error(`loreWarehouse: failed to download stem ${stemCID}:`, err)
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
export async function downloadMissingStems(riffCID: string): Promise<LoreResolvedRiff | null> {
  const db = getWarehouseDb()
  if (!db) return null
  const riffRow = db.prepare('SELECT OwnerJamCID FROM Riffs WHERE RiffCID = ?').get(riffCID) as
    { OwnerJamCID: string } | undefined
  if (!riffRow) return null

  const resolved = resolveRiff(riffCID)
  if (!resolved) return null
  const missing = resolved.stems.filter((s) => s.path === null && s.downloadUrl !== null)
  await Promise.all(
    missing.map((s) => downloadOneStem(riffRow.OwnerJamCID, s.stemCID, s.downloadUrl!))
  )
  return resolveRiff(riffCID)
}

export { getWarehouseDb }
