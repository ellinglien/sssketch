import { existsSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import type {
  LoreJam,
  LoreRiffSummary,
  LoreResolvedRiff,
  LoreResolvedStem
} from '@shared/loreLibrary'
import { computeOwnerFraction } from '@shared/loreLibrary'

// Single-user, single-machine app — this is the actual synced folder on
// Elling's machine. See the design spec's "Background" section for why this
// is hardcoded rather than configurable.
let warehouseRoot = '/Volumes/Elling-Lien/ENDLESSS'

/** Test-only seam: points the module at a fixture warehouse instead of the
 * real one. Also resets the cached connection, since a previously-opened DB
 * handle would otherwise keep pointing at the old root. */
export function setWarehouseRootForTests(root: string): void {
  warehouseRoot = root
  closeWarehouseDb()
}

function warehouseDbPath(): string {
  return join(warehouseRoot, 'cache', 'common', 'warehouse.db3')
}

function stemCacheRoot(): string {
  return join(warehouseRoot, 'cache', 'common', 'stem_v2')
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

/** Stem audio is sharded by jam and by the first hex character of the
 * StemCID: cache/common/stem_v2/<JamCID>/<first-hex-char>/<StemCID>, no file
 * extension. Traced from real LORE-synced data, not guessed. */
export function resolveStemPath(jamCID: string, stemCID: string): string {
  const shard = stemCID[0]
  return join(stemCacheRoot(), jamCID, shard, stemCID)
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

export interface RiffFilters {
  dateFrom?: number
  dateTo?: number
  bpm?: number
  userName?: string
  onlyFullyCached?: boolean
  /** How many riffs (most-recent-first) to skip before this page — 0/undefined
   * for the first page. Paired with RIFF_PAGE_SIZE so a jam with thousands of
   * riffs (some of Elling's real jams have 20,000+) doesn't have to load or
   * render them all at once. */
  offset?: number
}

export interface RiffPage {
  riffs: LoreRiffSummary[]
  /** True if the underlying query (before the onlyFullyCached post-filter)
   * returned a full page — i.e. there's likely at least one more riff beyond
   * this page, regardless of how many survived that filter. */
  hasMore: boolean
  /** The `offset` to pass for the next page. Tracks raw SQL rows consumed
   * (offset + rows.length), NOT riffs.length — those diverge whenever
   * onlyFullyCached filters some rows out of a page, and paging by
   * riffs.length in that case would re-request (or skip) rows at the SQL
   * level. */
  nextOffset: number
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

const RIFF_PAGE_SIZE = 200

export function listRiffs(jamCID: string, filters: RiffFilters): RiffPage {
  const db = getWarehouseDb()
  const offset = filters.offset ?? 0
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
  if (filters.bpm !== undefined) {
    conditions.push('ROUND(BPMrnd) = ?')
    params.push(filters.bpm)
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
    .all(...params, RIFF_PAGE_SIZE, offset) as RiffRow[]

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
      ownerFraction: computeOwnerFraction(creatorNames)
    }
  })

  return {
    riffs: filters.onlyFullyCached
      ? summaries.filter((s) => s.cachedStemCount === s.stemCount)
      : summaries,
    // Computed from the raw page (rows.length), not the onlyFullyCached-
    // filtered summaries — otherwise a page where every riff happens to be
    // filtered out would look like "no more data" even though later pages
    // might have plenty.
    hasMore: rows.length === RIFF_PAGE_SIZE,
    nextOffset: offset + rows.length
  }
}

interface FullRiffRow extends RiffRow {
  OwnerJamCID: string
  GainsJSON: string | null
}

interface FullStemRow {
  StemCID: string
  CreatorUserName: string
  PresetName: string
  Instrument: number
  BPMrnd: number | null
  Length16s: number | null
}

export function resolveRiff(riffCID: string): LoreResolvedRiff | null {
  const db = getWarehouseDb()
  if (!db) return null

  const riffRow = db
    .prepare(
      `SELECT RiffCID, OwnerJamCID, CreationTime, BPMrnd, BarLength, UserName, GainsJSON,
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
        'SELECT StemCID, CreatorUserName, PresetName, Instrument, BPMrnd, Length16s FROM Stems WHERE StemCID = ?'
      )
      .get(stemCID) as FullStemRow | undefined
    const path = resolveStemPath(riffRow.OwnerJamCID, stemCID)
    // This stem's OWN bpm/length, not the riff's — a stem can be a shorter
    // loop tiled across a longer riff (the same distinction ssstitch's own
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
      barLength: stemBarLength
    }
  })

  return {
    riffCID: riffRow.RiffCID,
    bpm: riffRow.BPMrnd,
    barLength: riffRow.BarLength,
    stems
  }
}

export { getWarehouseDb }
