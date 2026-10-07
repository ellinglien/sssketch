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
// rows are written once by the sync and not edited in place today, save by
// the shared-feed fold (riffLibraryWriter.ts mergeSharedFeedCaseVariants),
// which renames these pairs' JamCID in its own transaction.
//
// Since scan plan b21ea5a2 Task 4 the meta row also carries the StemCID at
// MaxRowid (WatermarkStemCID), so the saved pairs are a rowid watermark
// (rowidWatermark.ts): a launch after a sync EXTENDS them from the rows past
// MaxRowid instead of re-walking, and they're written page by page as the
// one shared Stems walk (stemsTableWalk.ts) goes, so an interrupted walk
// resumes. A meta row without WatermarkStemCID is legacy: trusted while its
// count and MAX(rowid) match, re-walked once when they move. The in-place
// UPDATE gap above is unchanged.
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
  const columns = ownDb.prepare(`PRAGMA table_info(DiscoverJamUserPairsMeta)`).all() as {
    name: string
  }[]
  if (!columns.some((c) => c.name === 'WatermarkStemCID')) {
    ownDb.exec(`ALTER TABLE DiscoverJamUserPairsMeta ADD COLUMN WatermarkStemCID TEXT`)
  }
  ensured.add(ownDb)
}

export interface PairsSignal {
  /** Null when that db had no readable Stems table. */
  stemCount: number | null
  maxRowid: number | null
}

export interface SavedPairs extends PairsSignal {
  /** The StemCID at maxRowid; null on a legacy row (no watermark). */
  watermarkStemCID: string | null
  pairs: [string, string][]
}

/** One source db's saved pairs, or null when none were ever saved (or the
 * tables are unreadable). One query: ~13k short rows on the SSD own db. */
export function loadSavedPairs(ownDb: Database.Database, sourceDbKey: string): SavedPairs | null {
  try {
    ensureTables(ownDb)
    const meta = ownDb
      .prepare(
        `SELECT StemCount, MaxRowid, WatermarkStemCID FROM DiscoverJamUserPairsMeta
         WHERE SourceDbKey = ?`
      )
      .get(sourceDbKey) as
      | { StemCount: number | null; MaxRowid: number | null; WatermarkStemCID: string | null }
      | undefined
    if (!meta) return null
    const rows = ownDb
      .prepare(`SELECT JamCID, User FROM DiscoverJamUserPairs WHERE SourceDbKey = ?`)
      .all(sourceDbKey) as { JamCID: string; User: string }[]
    return {
      stemCount: meta.StemCount,
      maxRowid: meta.MaxRowid,
      watermarkStemCID: meta.WatermarkStemCID,
      pairs: rows.map((r) => [r.JamCID, r.User])
    }
  } catch {
    return null
  }
}

/** Starts one source db's saved pairs over, at an empty watermark (count 0)
 * -- the first page of a full walk. Never throws; false when it failed (the
 * caller then saves none of the walk's pages: appended to the old copy,
 * they would sit under a watermark that no longer describes it). */
export function resetSavedPairs(
  ownDb: Database.Database,
  sourceDbKey: string,
  now = Date.now()
): boolean {
  try {
    ensureTables(ownDb)
    ownDb.transaction(() => {
      ownDb.prepare(`DELETE FROM DiscoverJamUserPairsMeta WHERE SourceDbKey = ?`).run(sourceDbKey)
      ownDb.prepare(`DELETE FROM DiscoverJamUserPairs WHERE SourceDbKey = ?`).run(sourceDbKey)
      ownDb
        .prepare(
          `INSERT INTO DiscoverJamUserPairsMeta (SourceDbKey, StemCount, MaxRowid, WatermarkStemCID, ComputedAt)
           VALUES (?, 0, NULL, NULL, ?)`
        )
        .run(sourceDbKey, now)
    })()
    return true
  } catch (err) {
    console.error('discoverJamUserPairsStore: reset failed:', err)
    return false
  }
}

/** One walked page's new pairs, and the watermark after it, in one small
 * transaction (a page brings a handful of new pairs at most). Never throws;
 * false when the write failed. The caller must then save no LATER page of
 * that walk: the next one's watermark would cover this page's pairs
 * without them, and they would never be read again. Stopped there, the
 * saved copy stays a whole-page prefix, and the next launch re-walks from
 * its last page. */
export function appendSavedPairs(
  ownDb: Database.Database,
  sourceDbKey: string,
  pairs: readonly (readonly [string, string])[],
  watermark: { count: number; maxRowid: number | null; keyAtMax: string | null },
  now = Date.now()
): boolean {
  try {
    ensureTables(ownDb)
    const insertPair = ownDb.prepare(
      `INSERT OR IGNORE INTO DiscoverJamUserPairs (SourceDbKey, JamCID, User) VALUES (?, ?, ?)`
    )
    ownDb.transaction(() => {
      for (const [jam, user] of pairs) insertPair.run(sourceDbKey, jam, user)
      ownDb
        .prepare(
          `INSERT OR REPLACE INTO DiscoverJamUserPairsMeta
             (SourceDbKey, StemCount, MaxRowid, WatermarkStemCID, ComputedAt)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(sourceDbKey, watermark.count, watermark.maxRowid, watermark.keyAtMax, now)
    })()
    return true
  } catch (err) {
    console.error('discoverJamUserPairsStore: append failed:', err)
    return false
  }
}
