import type Database from 'better-sqlite3'
import { listFavouriteRiffCIDs } from './riffFavourites'

/** One-time-in-spirit, idempotent-in-practice migration copying every
 * riffCID from the old flat-JSON favourites file (riffFavourites.ts) into
 * the new warehouse's Tags table -- see docs/superpowers/plans/
 * 2026-08-09-lore-warehouse-favourites-migration.md. Safe to call on every
 * app startup: `INSERT ... ON CONFLICT(RiffCID) DO NOTHING` means an
 * already-migrated riff (whether still favourited or since un-favourited
 * through the new system) is left completely alone -- this migration only
 * ever ADDS a row for a legacy favourite it's never seen before, never
 * overwrites. riffFavourites.ts's own listFavouriteRiffCIDs() already
 * returns [] (never throws) when no favourites file exists yet, so no
 * separate existence check is needed here. */
export function migrateLegacyFavourites(db: Database.Database): void {
  const legacyRiffCIDs = listFavouriteRiffCIDs()
  if (legacyRiffCIDs.length === 0) return
  const insert = db.prepare(
    `INSERT INTO Tags (RiffCID, OwnerJamCID, Favour) VALUES (?, NULL, 1)
     ON CONFLICT(RiffCID) DO NOTHING`
  )
  const txn = db.transaction((riffCIDs: string[]) => {
    for (const riffCID of riffCIDs) insert.run(riffCID)
  })
  txn(legacyRiffCIDs)
}
