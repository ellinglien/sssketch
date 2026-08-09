import type Database from 'better-sqlite3'
import type { LoreResolvedRiff } from '@shared/loreLibrary'

export function upsertJam(db: Database.Database, jamCID: string, publicName: string): void {
  db.prepare(
    `INSERT INTO Jams (JamCID, PublicName) VALUES (?, ?)
     ON CONFLICT(JamCID) DO UPDATE SET PublicName = excluded.PublicName`
  ).run(jamCID, publicName)
}

export function markJamSyncComplete(db: Database.Database, jamCID: string): void {
  db.prepare(`UPDATE Jams SET SyncComplete = 1 WHERE JamCID = ?`).run(jamCID)
}

export interface RiffSkeleton {
  riffCID: string
  creationTime: number
}

/** Cheap, safe to call for every riff on every walked page regardless of
 * whether it's already known -- ON CONFLICT DO NOTHING means re-discovering
 * an already-detailed riff is a no-op, not an overwrite. This (not a
 * "have I seen this ID before" boundary check) is what lets the sync walk
 * safely continue past a riff that was skeleton-inserted on a prior,
 * interrupted run but never resolved -- see loreWarehouseSync.ts. */
export function upsertRiffSkeletons(
  db: Database.Database,
  jamCID: string,
  riffs: RiffSkeleton[]
): void {
  const insert = db.prepare(
    `INSERT INTO Riffs (RiffCID, OwnerJamCID, CreationTime) VALUES (@riffCID, @jamCID, @creationTime)
     ON CONFLICT(RiffCID) DO NOTHING`
  )
  const txn = db.transaction((rows: RiffSkeleton[]) => {
    for (const row of rows)
      insert.run({ riffCID: row.riffCID, jamCID, creationTime: row.creationTime })
  })
  txn(riffs)
}

interface RiffDetailMeta {
  creationTime: number
  userName: string
}

/** Persists a fully-resolved riff (and every one of its stems) as real rows
 * -- AppVersion = 1 on the Riffs row is what marks it "no longer a gap" for
 * findRiffsNeedingDetail. Also skeleton-inserts (INSERT ... DO NOTHING) each
 * referenced stem before filling in its detail, so a stem shared across
 * riffs that hasn't been seen via any OTHER riff yet still gets a row.
 *
 * The Riffs upsert and the Stems skeleton+detail loop are wrapped in ONE
 * db.transaction so the whole function is all-or-nothing: if the process is
 * interrupted (crash/force-quit) or any statement throws partway through,
 * nothing commits -- AppVersion stays NULL and findRiffsNeedingDetail will
 * correctly pick this riff up again next pass. Splitting this into two
 * separately-committing operations would let AppVersion = 1 commit while
 * some/all of this riff's Stems rows are still bare (uninitialized)
 * skeletons, which is indistinguishable from "done" to every reader. */
export function writeRiffDetail(
  db: Database.Database,
  jamCID: string,
  meta: RiffDetailMeta,
  resolved: LoreResolvedRiff
): void {
  const upsertRiffRow = db.prepare(
    `INSERT INTO Riffs (
       RiffCID, OwnerJamCID, CreationTime, Root, Scale, BPMrnd, BarLength, UserName,
       StemCID_1, StemCID_2, StemCID_3, StemCID_4, StemCID_5, StemCID_6, StemCID_7, StemCID_8,
       GainsJSON, AppVersion
     ) VALUES (
       @riffCID, @jamCID, @creationTime, @root, @scale, @bpm, @barLength, @userName,
       @s1, @s2, @s3, @s4, @s5, @s6, @s7, @s8, @gainsJson, 1
     )
     ON CONFLICT(RiffCID) DO UPDATE SET
       OwnerJamCID = excluded.OwnerJamCID, CreationTime = excluded.CreationTime,
       Root = excluded.Root, Scale = excluded.Scale, BPMrnd = excluded.BPMrnd,
       BarLength = excluded.BarLength, UserName = excluded.UserName,
       StemCID_1 = excluded.StemCID_1, StemCID_2 = excluded.StemCID_2,
       StemCID_3 = excluded.StemCID_3, StemCID_4 = excluded.StemCID_4,
       StemCID_5 = excluded.StemCID_5, StemCID_6 = excluded.StemCID_6,
       StemCID_7 = excluded.StemCID_7, StemCID_8 = excluded.StemCID_8,
       GainsJSON = excluded.GainsJSON, AppVersion = 1`
  )
  const insertStemSkeleton = db.prepare(
    `INSERT INTO Stems (StemCID, OwnerJamCID) VALUES (?, ?) ON CONFLICT(StemCID) DO NOTHING`
  )
  const updateStemDetail = db.prepare(
    `UPDATE Stems SET
       CreationTime = @creationTime, FileEndpoint = @fileEndpoint, FileBucket = @fileBucket,
       FileKey = @fileKey, BPMrnd = @bpm, Instrument = @instrument, Length16s = @length16s,
       PresetName = @presetName, CreatorUserName = @creatorUserName
     WHERE StemCID = @stemCID`
  )

  const txn = db.transaction((riff: LoreResolvedRiff) => {
    const slots: (string | null)[] = Array.from({ length: 8 }, (_, i) => {
      const stem = riff.stems.find((s) => s.slot === i + 1)
      return stem?.stemCID ?? null
    })
    const gains: Record<string, number> = {}
    for (const stem of riff.stems) gains[String(stem.slot)] = stem.gain

    upsertRiffRow.run({
      riffCID: riff.riffCID,
      jamCID,
      creationTime: meta.creationTime,
      root: riff.root ?? null,
      scale: riff.scale ?? null,
      bpm: riff.bpm,
      barLength: riff.barLength,
      userName: meta.userName,
      s1: slots[0],
      s2: slots[1],
      s3: slots[2],
      s4: slots[3],
      s5: slots[4],
      s6: slots[5],
      s7: slots[6],
      s8: slots[7],
      gainsJson: JSON.stringify(gains)
    })

    for (const stem of riff.stems) {
      insertStemSkeleton.run(stem.stemCID, jamCID)
      updateStemDetail.run({
        stemCID: stem.stemCID,
        creationTime: meta.creationTime,
        fileEndpoint: stem.fileEndpoint ?? null,
        fileBucket: stem.fileBucket ?? null,
        fileKey: stem.fileKey ?? null,
        bpm: stem.bpm ?? null,
        instrument: stem.instrumentMask,
        length16s: Math.round(stem.barLength * 16),
        presetName: stem.presetName,
        creatorUserName: stem.creatorUserName
      })
    }
  })
  txn(resolved)
}

/** The whole resumability mechanism: a riff whose AppVersion is still NULL
 * has been seen (skeleton-inserted) but never had writeRiffDetail called
 * for it -- whether because this is the first time it's being processed, or
 * because a prior sync run was interrupted before it got there. Batched
 * (`limit`) so a single call can't try to resolve an unbounded backlog at
 * once. Not currently called by syncSharedFeed/syncJam (loreWarehouseSync.ts) --
 * they check per-page candidate sets via areAllResolved/filterUnresolved
 * instead, since they already have the page's riffCIDs in hand. This
 * function is here for a future standalone "resume without re-walking"
 * pass or UI-facing "N riffs still need syncing" query, which don't have a
 * candidate set to check against and need to scan for gaps directly. */
export function findRiffsNeedingDetail(
  db: Database.Database,
  jamCID: string,
  limit: number
): string[] {
  const rows = db
    .prepare(`SELECT RiffCID FROM Riffs WHERE OwnerJamCID = ? AND AppVersion IS NULL LIMIT ?`)
    .all(jamCID, limit) as { RiffCID: string }[]
  return rows.map((r) => r.RiffCID)
}

/** Records that this stem's audio download exhausted its retries (see
 * endlesssApi.ts's own STEM_DOWNLOAD_RETRIES) -- bookkeeping only for now
 * (no dispatcher currently re-attempts a ledgered stem's download; there's
 * no standalone "fetch just this stem" task in this codebase's real API
 * surface, since stem audio is only ever fetched as a side effect of
 * resolving its parent riff). Idempotent: a stem already ledgered is left
 * alone rather than re-written on every repeat failure. */
export function markStemDownloadFailed(db: Database.Database, stemCID: string): void {
  db.prepare(
    `INSERT INTO StemLedger (StemCID, Type, Note) VALUES (?, 'download-failed', 'exhausted retries')
     ON CONFLICT(StemCID) DO NOTHING`
  ).run(stemCID)
}

export function isStemLedgered(db: Database.Database, stemCID: string): boolean {
  return db.prepare(`SELECT 1 FROM StemLedger WHERE StemCID = ?`).get(stemCID) !== undefined
}

/** True iff every one of `riffCIDs` already has a non-NULL AppVersion in
 * `Riffs` -- i.e., nothing in this list is a gap. Used by the sync engine's
 * per-page "is there anything left to do here" stop-check, distinct from
 * findRiffsNeedingDetail (which returns the gaps themselves, not a
 * yes/no over a specific candidate set). Delegates to filterUnresolved
 * rather than issuing its own copy of the same query, so the two can't
 * silently drift apart. */
export function areAllResolved(db: Database.Database, riffCIDs: string[]): boolean {
  return filterUnresolved(db, riffCIDs).length === 0
}

/** Which of `riffCIDs` do NOT yet have a resolved (non-NULL AppVersion)
 * Riffs row -- the complement of areAllResolved, but returning the actual
 * subset rather than a single boolean, for callers that need to know WHICH
 * ones still need resolving (not just whether any do). */
export function filterUnresolved(db: Database.Database, riffCIDs: string[]): string[] {
  if (riffCIDs.length === 0) return []
  const placeholders = riffCIDs.map(() => '?').join(',')
  const resolvedRows = db
    .prepare(
      `SELECT RiffCID FROM Riffs WHERE RiffCID IN (${placeholders}) AND AppVersion IS NOT NULL`
    )
    .all(...riffCIDs) as { RiffCID: string }[]
  const resolvedSet = new Set(resolvedRows.map((r) => r.RiffCID))
  return riffCIDs.filter((cid) => !resolvedSet.has(cid))
}

export interface WarehouseSyncStatus {
  riffCount: number
  /** True once the walk has reached the true end of the feed/jam's history
   * (or a page that's entirely already-resolved) -- NOT a guarantee that
   * every riff in `riffCount` is itself fully resolved. A riff can still be
   * a gap (AppVersion IS NULL) after `complete` is true, e.g. one whose
   * resolveJamRiff/downloadMissingStemsFor call failed on the final walked
   * page -- the next sync run will find and retry it via the same
   * pageFullyDone logic, but this flag alone doesn't promise zero gaps. */
  complete: boolean
}

export function getWarehouseSyncStatus(
  db: Database.Database,
  jamCID: string
): WarehouseSyncStatus | null {
  const jam = db.prepare(`SELECT SyncComplete FROM Jams WHERE JamCID = ?`).get(jamCID) as
    { SyncComplete: number } | undefined
  if (!jam) return null
  const { n } = db.prepare(`SELECT COUNT(*) as n FROM Riffs WHERE OwnerJamCID = ?`).get(jamCID) as {
    n: number
  }
  return { riffCount: n, complete: jam.SyncComplete === 1 }
}
