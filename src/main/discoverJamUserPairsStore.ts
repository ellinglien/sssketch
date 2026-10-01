// src/main/discoverJammedWithStore.ts
//
// Discover artist mode's "people you've jammed with", saved to the own db
// (Elling's decision, 2026-10-01: computed once by the background walk,
// reused instantly on launch, recomputed only when a source db's Stems
// moves). Pure CRUD; discoverArtistIndex.ts decides when to trust it.
//
// The meta table records, per source db (SourceDbKey = db.name, the same
// key discoverIndexCache.ts uses), the Stems row count and MAX(rowid) the
// list was built from, plus the own username it was built for. Only those
// two signal fields persist: tableChangeSignal.ts's `writes` is per process
// and `data_version` per connection, so neither means anything after a
// relaunch.
import type Database from 'better-sqlite3'
import type { JammedWith } from '@shared/discoverArtist'

/** Created lazily on first use (ensureTables), like the plan's
 * DiscoverArtistScanQueue -- not in riffLibrarySchema.ts. A cache: safe to
 * drop. Exported so test fixtures can create it up front too. */
export const DISCOVER_JAMMED_WITH_DDL = `
CREATE TABLE IF NOT EXISTS DiscoverJammedWith (
  User TEXT PRIMARY KEY,
  SharedJams INTEGER NOT NULL,
  ComputedAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS DiscoverJammedWithMeta (
  SourceDbKey TEXT PRIMARY KEY,
  StemCount INTEGER,
  MaxRowid INTEGER,
  OwnUsername TEXT NOT NULL,
  ComputedAt INTEGER NOT NULL
);
`

const ensured = new WeakSet<Database.Database>()

function ensureTables(ownDb: Database.Database): void {
  if (ensured.has(ownDb)) return
  ownDb.exec(DISCOVER_JAMMED_WITH_DDL)
  ensured.add(ownDb)
}

export interface JammedWithSource {
  sourceDbKey: string
  /** Null when that db had no readable Stems table. */
  stemCount: number | null
  maxRowid: number | null
}

export interface SavedJammedWith {
  ownUsername: string
  sources: JammedWithSource[]
  list: JammedWith[]
}

/** Null when nothing was ever saved (or the tables are missing). */
export function loadSavedJammedWith(ownDb: Database.Database): SavedJammedWith | null {
  try {
    ensureTables(ownDb)
    const meta = ownDb
      .prepare(
        `SELECT SourceDbKey, StemCount, MaxRowid, OwnUsername FROM DiscoverJammedWithMeta
         ORDER BY SourceDbKey`
      )
      .all() as {
      SourceDbKey: string
      StemCount: number | null
      MaxRowid: number | null
      OwnUsername: string
    }[]
    if (meta.length === 0) return null
    const list = ownDb.prepare(`SELECT User, SharedJams FROM DiscoverJammedWith`).all() as {
      User: string
      SharedJams: number
    }[]
    return {
      ownUsername: meta[0].OwnUsername,
      sources: meta.map((m) => ({
        sourceDbKey: m.SourceDbKey,
        stemCount: m.StemCount,
        maxRowid: m.MaxRowid
      })),
      // Sorted in JS with jammedWithFromPairs's own order: SQLite's BINARY
      // collation is not localeCompare.
      list: list
        .map((r) => ({ user: r.User, sharedJams: r.SharedJams }))
        .sort((a, b) => b.sharedJams - a.sharedJams || a.user.localeCompare(b.user))
    }
  } catch {
    return null
  }
}

/** Replaces whatever was saved. A few hundred rows on the SSD own db: one
 * synchronous transaction. Never throws -- a failed save only costs a walk
 * on the next launch. */
export function saveJammedWith(
  ownDb: Database.Database,
  ownUsername: string,
  sources: readonly JammedWithSource[],
  list: readonly JammedWith[],
  now = Date.now()
): void {
  try {
    ensureTables(ownDb)
    const insertUser = ownDb.prepare(
      `INSERT INTO DiscoverJammedWith (User, SharedJams, ComputedAt) VALUES (?, ?, ?)`
    )
    const insertMeta = ownDb.prepare(
      `INSERT OR REPLACE INTO DiscoverJammedWithMeta
         (SourceDbKey, StemCount, MaxRowid, OwnUsername, ComputedAt) VALUES (?, ?, ?, ?, ?)`
    )
    ownDb.transaction(() => {
      ownDb.prepare(`DELETE FROM DiscoverJammedWith`).run()
      ownDb.prepare(`DELETE FROM DiscoverJammedWithMeta`).run()
      for (const { user, sharedJams } of list) insertUser.run(user, sharedJams, now)
      for (const s of sources) {
        insertMeta.run(s.sourceDbKey, s.stemCount, s.maxRowid, ownUsername, now)
      }
    })()
  } catch (err) {
    console.error('discoverJammedWithStore: save failed:', err)
  }
}
