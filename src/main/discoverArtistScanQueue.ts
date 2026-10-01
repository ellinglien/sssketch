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

/** What one stem's download came to (riffLibraryStore's
 * downloadStemForAnalysis): `ok` (the audio is on disk), `unavailable`
 * (known unfetchable, durably -- StemUnavailable) or `transient` (anything
 * that may work later: a network error, a refused write on a drive pulled
 * mid-queue, this session's retries spent). */
export type StemDownloadStatus = 'ok' | 'unavailable' | 'transient'

export type ArtistScanBatch =
  /** The archive drive is not mounted: nothing downloaded, nothing removed. */
  | { status: 'paused'; remaining: number }
  | {
      status: 'ok'
      /** Downloaded, to analyse -- still queued until finished. */
      targets: { key: string; path: string }[]
      remaining: number
      /** Rows that failed temporarily: kept, moved to the back of the queue. */
      transient: number
    }

/** Moves rows to the back of the queue (a temporary failure). */
export function requeueArtistStems(
  ownDb: Database.Database,
  stemCIDs: string[],
  now: number
): void {
  ensure(ownDb)
  const bump = ownDb.prepare(`UPDATE DiscoverArtistScanQueue SET QueuedAt = ? WHERE StemCID = ?`)
  ownDb.transaction(() => {
    for (const id of stemCIDs) bump.run(now, id)
  })()
}

/** The scan's priority batch (final review, 2026-10-01). Only a stem that
 * downloaded or is known unfetchable ever leaves the queue: `ok` rows are
 * handed back to analyse (the renderer finishes them), `unavailable` rows
 * are dropped here, `transient` rows stay, moved to the back. With the
 * archive drive away, every archive stem would look missing -- so the
 * whole queue pauses instead, and nothing is downloaded or dropped. */
export async function takeArtistScanBatch(
  ownDb: Database.Database,
  limit: number,
  deps: {
    archiveReachable: () => boolean
    download: (
      jamCID: string,
      stemCID: string
    ) => Promise<{ status: StemDownloadStatus; path: string | null }>
    now?: () => number
  }
): Promise<ArtistScanBatch> {
  if (!deps.archiveReachable()) return { status: 'paused', remaining: artistScanQueueSize(ownDb) }
  const next = peekArtistScanQueue(ownDb, limit)
  const results = await Promise.all(
    next.map(async ({ stemCID, jamCID }) => ({
      stemCID,
      ...(await deps.download(jamCID, stemCID))
    }))
  )
  const targets: { key: string; path: string }[] = []
  const unavailable: string[] = []
  const transient: string[] = []
  for (const r of results) {
    if (r.status === 'ok' && r.path !== null) targets.push({ key: r.stemCID, path: r.path })
    else if (r.status === 'unavailable') unavailable.push(r.stemCID)
    else transient.push(r.stemCID)
  }
  removeFromArtistScanQueue(ownDb, unavailable)
  requeueArtistStems(ownDb, transient, (deps.now ?? Date.now)())
  return {
    status: 'ok',
    targets,
    remaining: artistScanQueueSize(ownDb),
    transient: transient.length
  }
}
