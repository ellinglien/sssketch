// src/main/discoverArtistScanQueue.ts
//
// "analyse overnight" (spec §1, §3): an artist's unanalysed stems queued
// for Discover's existing whole-library scan (DiscoverLibraryScan.tsx),
// which serves this queue first. In the OWN db, so a multi-night job
// survives restarts; the external archive is read-only. The priority tag
// is the Artist column plus the queue's existence.
import type Database from 'better-sqlite3'
import { loadUnavailableStemCIDs } from './stemUnavailableStore'
import type { ArtistStemRow } from './discoverArtistStems'

const DDL = `CREATE TABLE IF NOT EXISTS DiscoverArtistScanQueue (
  StemCID TEXT PRIMARY KEY,
  JamCID TEXT NOT NULL,
  Artist TEXT NOT NULL,
  QueuedAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS DiscoverArtistScanQueue_Order
  ON DiscoverArtistScanQueue (QueuedAt, StemCID);`

const ensured = new WeakSet<Database.Database>()
function ensure(ownDb: Database.Database): void {
  if (ensured.has(ownDb)) return
  ownDb.exec(DDL)
  ensured.add(ownDb)
}

export interface QueuedStem {
  stemCID: string
  jamCID: string
  artist: string
}

/** Returns how many were newly queued. Skips analysed and unavailable stems. */
export function queueArtistStems(
  ownDb: Database.Database,
  rows: readonly ArtistStemRow[],
  artist: string,
  now = Date.now()
): number {
  ensure(ownDb)
  const unavailable = loadUnavailableStemCIDs(ownDb)
  const analysed = ownDb.prepare(`SELECT 1 FROM StemFeatureCache WHERE StemCID = ?`)
  const insert = ownDb.prepare(
    `INSERT OR IGNORE INTO DiscoverArtistScanQueue (StemCID, JamCID, Artist, QueuedAt)
     VALUES (?, ?, ?, ?)`
  )
  let queued = 0
  ownDb.transaction(() => {
    for (const { stemCID, jamCID } of rows) {
      if (unavailable.has(stemCID) || analysed.get(stemCID)) continue
      queued += insert.run(stemCID, jamCID, artist, now).changes
    }
  })()
  return queued
}

export function peekArtistScanQueue(ownDb: Database.Database, limit: number): QueuedStem[] {
  ensure(ownDb)
  return ownDb
    .prepare(
      `SELECT StemCID AS stemCID, JamCID AS jamCID, Artist AS artist
       FROM DiscoverArtistScanQueue ORDER BY QueuedAt, StemCID LIMIT ?`
    )
    .all(limit) as QueuedStem[]
}

export function removeFromArtistScanQueue(ownDb: Database.Database, stemCIDs: string[]): void {
  ensure(ownDb)
  const del = ownDb.prepare(`DELETE FROM DiscoverArtistScanQueue WHERE StemCID = ?`)
  ownDb.transaction(() => {
    for (const id of stemCIDs) del.run(id)
  })()
}

export function artistScanQueueSize(ownDb: Database.Database): number {
  ensure(ownDb)
  return (ownDb.prepare(`SELECT COUNT(*) AS n FROM DiscoverArtistScanQueue`).get() as { n: number })
    .n
}
