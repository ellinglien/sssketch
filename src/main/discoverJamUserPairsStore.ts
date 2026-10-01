// src/main/discoverJamUserPairsStore.ts
//
// Discover artist mode's "people you've jammed with", saved to the own db
// (Elling's decision, 2026-10-01: computed by the background walk once,
// instant after that). What is saved is each SOURCE db's distinct
// (jam, user) pairs -- ~13k rows for Elling's archive -- not the final list,
// so a change to one db (the own db moves on every riff sync) re-walks only
// that db; the list itself is rebuilt in JS from the pairs (milliseconds).
// Pure CRUD; discoverArtistIndex.ts decides when to trust it.
//
// The meta row per source db (SourceDbKey = db.name, the same key
// discoverIndexCache.ts uses) records the Stems row count and MAX(rowid)
// the pairs were read at. Only those two persist: tableChangeSignal.ts's
// `writes` is per process and `data_version` per connection, so neither
// means anything after a relaunch. KNOWN GAP: an in-place UPDATE of a Stems
// row's OwnerJamCID or CreatorUserName between launches (no insert, no
// delete) moves neither, so the saved pairs would survive it. Within a
// session the full signal (writes, data_version) still catches it. Stems
// rows are written once by the sync and not edited in place today.
import type Database from 'better-sqlite3'

/** Created lazily on first use, like the plan's DiscoverArtistScanQueue --
 * not in riffLibrarySchema.ts. A cache: safe to drop. The two DROPs remove
 * an earlier unreleased shape (the final list, 2026-10-01). */
export const DISCOVER_JAM_USER_PAIRS_DDL = `
DROP TABLE IF EXISTS DiscoverJammedWith;
DROP TABLE IF EXISTS DiscoverJammedWithMeta;

CREATE TABLE IF NOT EXISTS DiscoverJamUserPairs (
  SourceDbKey TEXT NOT NULL,
  JamCID TEXT NOT NULL,
  User TEXT NOT NULL,
  PRIMARY KEY (SourceDbKey, JamCID, User)
);

CREATE TABLE IF NOT EXISTS DiscoverJamUserPairsMeta (
  SourceDbKey TEXT PRIMARY KEY,
  StemCount INTEGER,
  MaxRowid INTEGER,
  ComputedAt INTEGER NOT NULL
);
`

const ensured = new WeakSet<Database.Database>()

function ensureTables(ownDb: Database.Database): void {
  if (ensured.has(ownDb)) return
  ownDb.exec(DISCOVER_JAM_USER_PAIRS_DDL)
  ensured.add(ownDb)
}

export interface PairsSignal {
  /** Null when that db had no readable Stems table. */
  stemCount: number | null
  maxRowid: number | null
}

export interface SavedPairs extends PairsSignal {
  pairs: [string, string][]
}

/** One source db's saved pairs, or null when none were ever saved (or the
 * tables are unreadable). One query: ~13k short rows on the SSD own db. */
export function loadSavedPairs(ownDb: Database.Database, sourceDbKey: string): SavedPairs | null {
  try {
    ensureTables(ownDb)
    const meta = ownDb
      .prepare(`SELECT StemCount, MaxRowid FROM DiscoverJamUserPairsMeta WHERE SourceDbKey = ?`)
      .get(sourceDbKey) as { StemCount: number | null; MaxRowid: number | null } | undefined
    if (!meta) return null
    const rows = ownDb
      .prepare(`SELECT JamCID, User FROM DiscoverJamUserPairs WHERE SourceDbKey = ?`)
      .all(sourceDbKey) as { JamCID: string; User: string }[]
    return {
      stemCount: meta.StemCount,
      maxRowid: meta.MaxRowid,
      pairs: rows.map((r) => [r.JamCID, r.User])
    }
  } catch {
    return null
  }
}

/** Replaces one source db's saved pairs in one transaction. Never throws --
 * a failed save only costs that db's walk on the next launch. */
export function savePairs(
  ownDb: Database.Database,
  sourceDbKey: string,
  signal: PairsSignal,
  pairs: readonly (readonly [string, string])[],
  now = Date.now()
): void {
  try {
    ensureTables(ownDb)
    const insertPair = ownDb.prepare(
      `INSERT OR IGNORE INTO DiscoverJamUserPairs (SourceDbKey, JamCID, User) VALUES (?, ?, ?)`
    )
    const upsertMeta = ownDb.prepare(
      `INSERT OR REPLACE INTO DiscoverJamUserPairsMeta (SourceDbKey, StemCount, MaxRowid, ComputedAt)
       VALUES (?, ?, ?, ?)`
    )
    ownDb.transaction(() => {
      ownDb.prepare(`DELETE FROM DiscoverJamUserPairs WHERE SourceDbKey = ?`).run(sourceDbKey)
      for (const [jam, user] of pairs) insertPair.run(sourceDbKey, jam, user)
      upsertMeta.run(sourceDbKey, signal.stemCount, signal.maxRowid, now)
    })()
  } catch (err) {
    console.error('discoverJamUserPairsStore: save failed:', err)
  }
}
