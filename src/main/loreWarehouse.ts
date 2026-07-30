import { existsSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import type { LoreJam } from '@shared/loreLibrary'

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

export { getWarehouseDb }
