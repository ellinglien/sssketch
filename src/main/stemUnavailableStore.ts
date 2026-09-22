// src/main/stemUnavailableStore.ts
import type Database from 'better-sqlite3'
import { countWork } from './workCounters'

/** Stems whose audio is known to be unfetchable -- see @shared/
 * stemAvailability for the real situation this exists for (one of Endlesss's
 * storage buckets now answers anonymous GETs with 403). One row per stem,
 * written LAZILY: only ever when a real download attempt actually came back
 * with a permanent failure. There is deliberately no bulk backfill of the
 * ~97k stems on the dead host -- the learned-host set (in memory, session
 * scoped) is what stops the requests; this table is only the durable part
 * that survives a restart.
 *
 * Lives on sssketch's OWN writable db (openOwnRiffLibraryDb), never an
 * external LORE archive -- same rule as StemFavourite/StemAutoCategory/
 * StemFeatureCache (see riffLibrarySchema.ts): an external archive is opened
 * read-only by design, and this is sssketch's own knowledge about someone
 * else's data, not part of the LORE-compatible schema.
 *
 * Every function here is defensive about the table's existence, in the same
 * spirit as the per-db try/catch in discoverCandidates.ts: this is advisory
 * bookkeeping, and a missing/locked table must degrade to "nothing known"
 * rather than break a download or a roll.
 */

const UNAVAILABLE_SET_CACHE = new WeakMap<Database.Database, Set<string>>()

/** Every currently-unavailable StemCID, for candidate filtering. Cached
 * per db connection and kept current by the writers below (rather than
 * re-queried per roll): a roll filters several thousand candidates against
 * it, and the set only changes when a download actually fails. */
export function loadUnavailableStemCIDs(db: Database.Database): ReadonlySet<string> {
  const cached = UNAVAILABLE_SET_CACHE.get(db)
  if (cached) return cached
  const set = new Set<string>()
  try {
    countWork('sql:stem-unavailable.load')
    const rows = db.prepare(`SELECT StemCID FROM StemUnavailable`).all() as { StemCID: string }[]
    for (const row of rows) set.add(row.StemCID)
  } catch {
    // No such table (an ad-hoc/foreign db) -- nothing known, which is the
    // correct, safe answer: every stem stays eligible.
    return set
  }
  UNAVAILABLE_SET_CACHE.set(db, set)
  return set
}

/** Records that `stemCID` can't be downloaded, with a short human-readable
 * reason (describeDownloadFailure -- e.g. "http 403") and the time it was
 * last checked. Idempotent: re-marking updates the reason/time. */
export function markStemUnavailable(
  db: Database.Database,
  stemCID: string,
  reason: string,
  checkedAt: number
): void {
  try {
    countWork('sql:stem-unavailable.mark')
    db.prepare(
      `INSERT INTO StemUnavailable (StemCID, Reason, CheckedAt)
       VALUES (@stemCID, @reason, @checkedAt)
       ON CONFLICT(StemCID) DO UPDATE SET
         Reason = excluded.Reason,
         CheckedAt = excluded.CheckedAt`
    ).run({ stemCID, reason, checkedAt })
  } catch {
    return
  }
  UNAVAILABLE_SET_CACHE.get(db)?.add(stemCID)
}

/** Forgets a stem -- called when its audio actually lands, so a host that
 * comes back (or a file that arrives by some other route) heals itself
 * without anyone having to clear a cache. */
export function clearStemUnavailable(db: Database.Database, stemCID: string): void {
  try {
    countWork('sql:stem-unavailable.clear')
    db.prepare(`DELETE FROM StemUnavailable WHERE StemCID = ?`).run(stemCID)
  } catch {
    return
  }
  UNAVAILABLE_SET_CACHE.get(db)?.delete(stemCID)
}

export function isStemUnavailable(db: Database.Database, stemCID: string): boolean {
  return loadUnavailableStemCIDs(db).has(stemCID)
}

export function countUnavailableStems(db: Database.Database): number {
  return loadUnavailableStemCIDs(db).size
}
